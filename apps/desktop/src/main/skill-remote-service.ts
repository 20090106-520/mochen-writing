import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  SKILL_CONTENT_MAX_BYTES,
  SKILL_FETCH_MAX_BYTES,
  SKILL_FETCH_TIMEOUT_MS,
  SKILL_FILE_NAME,
  composeSkillMd,
  githubDirUrl,
  hasFrontmatter,
  lastSegmentOf,
  marketTargetDir,
  parseSkillUrl,
  skillDirNameOf,
  sourceUrlOf,
  type RemoteInstallResult,
  type RemoteListResult,
  type RemoteSkillEntry,
  type RemoteSkillPreview,
  type SkillUrlTarget
} from "@mochen/contracts";
import { parseFrontmatter, scanSkills } from "@mochen/fs-store";
import { handleTrusted } from "./ipc-guard.js";

/** electron 的 ipcMain.handle 的窄形状（与本目录其它服务同款）：装配处传真 ipcMain，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** 只用到的两格 fetch 面。测试注入一个本地 http 服务就能覆盖「列/取/装」全过程，不必 mock 网络。 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<FetchResponseLike>;

/**
 * 在线技能源的主进程真身（2026-11-10）。
 *
 * 【它解决的是什么】
 * `skill-market-service.ts` 装的是仓里写死的二十条说明书；用户要的是「网上真有什么就装什么」。
 * 于是这里只有三条真通路：**列出源里有哪些技能 → 取一份正文给人看 → 装进全局技能目录**。
 * 正文不预先存在仓里，也不改写：从上游逐字取，装出来与上游同一份。
 *
 * 【三条写盘守卫（与市场/兑换码同一条边界）】
 * 1. 只写**全局**技能目录。书是用户的作品，应用不往里塞文件。
 * 2. 目录名一律过 `skillDirNameOf` + `marketTargetDir`，拿它拼绝对路径；拼接失败直接拒。
 * 3. **绝不覆盖**：目标已有 SKILL.md 就当装过了。用户改过它是常事，覆盖等于毁掉。
 *
 * 【网络这一层怎么保证「说了实话」】
 * - 超时 12 秒，超时就报超时；请求体超 256 KB 就不读了并说明原因（技能正文本身只认 64 KB）。
 * - raw 域名在国内常不可达，取文件失败时按序回退到只读镜像 `ghproxy.net`，
 *   并在 `fetchedFrom` 里回报**实际**取到的地址——回退过就说回退过，不装作是从原地址拿的。
 * - GitHub API 有速率限制。列目录用 `git/trees?recursive=1` 一次拿全（1 次请求，不是 N 次），
 *   正文只在用户点开某一条时才取。被限流时原样把 GitHub 那句英文提示交回去。
 */
export interface SkillRemoteService {
  list(idOrUrl: string): Promise<RemoteListResult>;
  preview(url: string): Promise<RemoteSkillPreview>;
  install(url: string): Promise<RemoteInstallResult>;
}

const GITHUB_API = "https://api.github.com";
const RAW_HOST = "https://raw.githubusercontent.com";
/** 只读镜像：raw 取不到时的回退（只用于 GET 原文，不涉及任何写）。 */
const RAW_MIRROR = "https://ghproxy.net/";

const API_HEADERS = { accept: "application/vnd.github+json", "user-agent": "mochen" };

export function createSkillRemoteService(deps: {
  /** 借只读那套的 `dirOf`：`<appData>/skills` 只在一处拼。 */
  dirOf: (source: "global" | "book") => string | null;
  fetchImpl?: FetchLike;
}): SkillRemoteService {
  const doFetch: FetchLike =
    deps.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponseLike>);
  /** 同一地址在一次运行里只取一次正文：列表里点来点去不该把速率配额耗光。 */
  const previewCache = new Map<string, RemoteSkillPreview>();
  /** 仓库默认分支的缓存（一次运行内不变）。 */
  const defaultRefs = new Map<string, string>();

  async function getText(url: string, headers: Record<string, string>): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SKILL_FETCH_TIMEOUT_MS);
    try {
      const response = await doFetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 200);
        throw new Error(
          `HTTP ${response.status}${body === "" ? "" : `：${body.replace(/\s+/g, " ")}`}`
        );
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > SKILL_FETCH_MAX_BYTES) {
        throw new Error(`取回来的内容超过 ${Math.round(SKILL_FETCH_MAX_BYTES / 1024)} KB，不读了`);
      }
      return text;
    } catch (err) {
      if (controller.signal.aborted)
        throw new Error(`请求超时（${SKILL_FETCH_TIMEOUT_MS / 1000} 秒）`, { cause: err });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson(url: string): Promise<unknown> {
    return JSON.parse(await getText(url, API_HEADERS)) as unknown;
  }

  /** 仓库内某条路径的 contents API 地址。ref 为空时交给 GitHub 用默认分支。 */
  function contentsUrl(target: SkillUrlTarget, filePath: string): string {
    const suffix = target.ref === "" ? "" : `?ref=${encodeURIComponent(target.ref)}`;
    return `${GITHUB_API}/repos/${target.owner}/${target.repo}/contents/${encodePath(filePath)}${suffix}`;
  }

  function rawUrlOf(target: SkillUrlTarget, filePath: string): string {
    return `${RAW_HOST}/${target.owner}/${target.repo}/${encodeURIComponent(target.ref || "HEAD")}/${encodePath(filePath)}`;
  }

  /**
   * 取一份文件正文。三条路顺序试，第二条起是回退：
   * ① contents API（国内可达，返回 base64）；② raw 原域；③ 只读镜像。
   * 每次回退都记下**实际**成功的地址，回给界面。
   */
  async function readFile(
    target: SkillUrlTarget,
    filePath: string
  ): Promise<{ text: string; from: string }> {
    if (target.absolute !== null) {
      return {
        text: await getText(target.absolute, { "user-agent": "mochen" }),
        from: target.absolute
      };
    }
    const apiUrl = contentsUrl(target, filePath);
    try {
      const json = await getJson(apiUrl);
      const encoded = (json as { content?: string; encoding?: string }).content;
      if (typeof encoded === "string" && encoded !== "") {
        const text = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
        return { text, from: apiUrl };
      }
      throw new Error("contents 接口没给出正文");
    } catch (apiError) {
      const raw = rawUrlOf(target, filePath);
      const candidates = [raw, `${RAW_MIRROR}${raw}`];
      const reasons: string[] = [reasonOf(apiError)];
      for (const url of candidates) {
        try {
          return { text: await getText(url, { "user-agent": "mochen" }), from: url };
        } catch (err) {
          reasons.push(reasonOf(err));
        }
      }
      throw new Error(`取不到 ${filePath}：${reasons.join("；")}`, { cause: apiError });
    }
  }

  async function installedNames(): Promise<Set<string>> {
    const root = deps.dirOf("global");
    if (root === null) return new Set();
    const refs = await scanSkills(root, "global");
    return new Set(refs.map((one) => one.dirName));
  }

  /**
   * 这一条该用哪个 ref。地址里写了就用它；没写就问仓库的默认分支。
   * 为什么不直接拿 `HEAD`：trees 接口认 HEAD，contents 接口不认，
   * 于是「列出来了、点开却取不到正文」——那是最让人恼火的一种半通。
   */
  async function refOf(target: SkillUrlTarget): Promise<string> {
    if (target.ref !== "") return target.ref;
    if (target.owner === "" || target.repo === "") return "HEAD";
    const key = `${target.owner}/${target.repo}`;
    const cached = defaultRefs.get(key);
    if (cached !== undefined) return cached;
    const json = (await getJson(`${GITHUB_API}/repos/${target.owner}/${target.repo}`)) as {
      default_branch?: string;
    };
    const branch =
      typeof json.default_branch === "string" && json.default_branch !== ""
        ? json.default_branch
        : "HEAD";
    defaultRefs.set(key, branch);
    return branch;
  }

  async function list(idOrUrl: string): Promise<RemoteListResult> {
    const source = sourceUrlOf(idOrUrl);
    const parsed = parseSkillUrl(source);
    if (!parsed.ok) return { entries: [], listed: false, notice: parsed.notice, source };
    const target = parsed.target;
    if (target.absolute !== null) {
      return {
        entries: [],
        listed: false,
        notice:
          "这个地址是一份具体的 .md，直接点「看内容」预览就能装；列目录要用 GitHub 仓库地址。",
        source
      };
    }

    const names = await installedNames();
    try {
      const ref = await refOf(target);
      // 文件地址：它自己就是一条候选（父目录名当技能名）。
      if (target.kind === "file") {
        const dir = parentOf(target.path);
        const dirName = skillDirNameOf(lastSegmentOf(dir));
        return {
          entries: [
            {
              url: githubDirUrl(target.owner, target.repo, ref, dir),
              path: dir,
              dirName,
              label: lastSegmentOf(dir),
              installed: names.has(dirName)
            }
          ],
          listed: true,
          notice: "",
          source
        };
      }

      const tree = (await getJson(
        `${GITHUB_API}/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
      )) as { tree?: { path?: string; type?: string }[]; truncated?: boolean };
      const all = Array.isArray(tree.tree) ? tree.tree : [];
      const prefix = target.path === "" ? "" : `${target.path}/`;
      const seen = new Set<string>();
      const entries: RemoteSkillEntry[] = [];
      for (const node of all) {
        const nodePath = typeof node.path === "string" ? node.path : "";
        if (!nodePath.endsWith(`/${SKILL_FILE_NAME}`)) continue;
        const dir = parentOf(nodePath);
        if (prefix !== "" && dir !== target.path && !dir.startsWith(prefix)) continue;
        if (seen.has(dir)) continue;
        seen.add(dir);
        const label = lastSegmentOf(dir);
        const dirName = skillDirNameOf(label);
        entries.push({
          url: githubDirUrl(target.owner, target.repo, ref, dir),
          path: dir,
          dirName,
          label,
          installed: names.has(dirName)
        });
      }
      entries.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
      return {
        entries,
        listed: true,
        notice:
          entries.length === 0
            ? "这个地址下没找到 SKILL.md——换到有技能的那一层目录，或直接粘某一份 SKILL.md 的链接。"
            : tree.truncated === true
              ? `列出了 ${entries.length} 条，不过 GitHub 说这棵树太大、可能没列全（只读了前一部分）。`
              : "",
        source
      };
    } catch (err) {
      return {
        entries: [],
        listed: false,
        notice: `没列出来：${reasonOf(err)}。地址对不对、网络通不通，GitHub 会在上面这句里说。`,
        source
      };
    }
  }

  async function preview(urlInput: string): Promise<RemoteSkillPreview> {
    const key = urlInput.trim();
    const cached = previewCache.get(key);
    if (cached !== undefined) return cached;

    const parsed = parseSkillUrl(key);
    if (!parsed.ok) return emptyPreview(parsed.notice);
    const target = parsed.target;
    const filePath =
      target.absolute !== null
        ? ""
        : target.kind === "file"
          ? target.path
          : target.path === ""
            ? SKILL_FILE_NAME
            : `${target.path}/${SKILL_FILE_NAME}`;

    try {
      const { text, from } = await readFile(target, filePath);
      const { data, body } = parseFrontmatter(text);
      const nameOf = scalarOf(data.name);
      const labelDir = skillDirNameOf(
        target.absolute !== null
          ? lastSegmentOf(filePath || basenameOfUrl(target.absolute))
          : lastSegmentOf(target.kind === "file" ? parentOf(target.path) : target.path)
      );
      const synthesized = !hasFrontmatter(text);
      const skillMd = synthesized
        ? composeSkillMd({
            displayName: nameOf || labelDir,
            description: scalarOf(data.description),
            stages: listOf(data.stage),
            appliesTo: listOf(data.appliesTo),
            body
          })
        : `${text.replace(/\r\n/g, "\n").trimEnd()}\n`;
      const bytes = Buffer.byteLength(skillMd, "utf8");
      if (bytes > SKILL_CONTENT_MAX_BYTES) {
        return emptyPreview(
          `这份正文 ${Math.round(bytes / 1024)} KB，超过技能读取上限 ${Math.round(SKILL_CONTENT_MAX_BYTES / 1024)} KB。装进来也读不全，先别装。`
        );
      }
      const result: RemoteSkillPreview = {
        ok: true,
        notice: synthesized
          ? "上游这份没有 frontmatter，我按它的目录名补了 name / description，正文一个字没改。"
          : "",
        dirName: labelDir,
        displayName: nameOf || labelDir,
        description: scalarOf(data.description),
        stages: listOf(data.stage),
        appliesTo: listOf(data.appliesTo),
        skillMd,
        synthesized,
        bytes,
        fetchedFrom: from
      };
      previewCache.set(key, result);
      return result;
    } catch (err) {
      return emptyPreview(`取不到这份技能：${reasonOf(err)}`);
    }
  }

  async function install(urlInput: string): Promise<RemoteInstallResult> {
    const previewed = await preview(urlInput);
    if (!previewed.ok) return { ok: false, notice: previewed.notice, dirName: "", displayName: "" };
    const root = deps.dirOf("global");
    if (root === null)
      return { ok: false, notice: "装不上：全局技能目录还没配好。", dirName: "", displayName: "" };
    const dir = marketTargetDir(root, previewed.dirName);
    if (dir === null) {
      return {
        ok: false,
        notice: `装不上《${previewed.displayName}》：它的目录名不合法。`,
        dirName: "",
        displayName: previewed.displayName
      };
    }
    const names = await installedNames();
    if (names.has(previewed.dirName)) {
      return {
        ok: false,
        notice: `《${previewed.displayName}》已经装过了（同名目录 ${previewed.dirName}），没有覆盖你已有的那份。想换版本先删掉它。`,
        dirName: previewed.dirName,
        displayName: previewed.displayName
      };
    }
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, SKILL_FILE_NAME), previewed.skillMd, "utf8");
    } catch (err) {
      return {
        ok: false,
        notice: `装不上《${previewed.displayName}》：${reasonOf(err)}`,
        dirName: previewed.dirName,
        displayName: previewed.displayName
      };
    }
    return {
      ok: true,
      notice: `装好了《${previewed.displayName}》（${previewed.dirName}）。列表里点「挂入」才进这一轮上下文；打开自动技能的话，它会自己按需挂上。`,
      dirName: previewed.dirName,
      displayName: previewed.displayName
    };
  }

  return { list, preview, install };
}

/** 四条通道。渲染层只递一个地址字符串——路径、目录名、落盘位置全由主进程自己解析。 */
export function registerSkillRemoteIpc(handle: Handler, remote: SkillRemoteService): void {
  handleTrusted(handle, IPC_CHANNELS.skillsRemoteList, (_event, idOrUrl) =>
    remote.list(String(idOrUrl))
  );
  handleTrusted(handle, IPC_CHANNELS.skillsRemotePreview, (_event, url) =>
    remote.preview(String(url))
  );
  handleTrusted(handle, IPC_CHANNELS.skillsRemoteInstall, (_event, url) =>
    remote.install(String(url))
  );
}

function emptyPreview(notice: string): RemoteSkillPreview {
  return {
    ok: false,
    notice,
    dirName: "",
    displayName: "",
    description: "",
    stages: [],
    appliesTo: [],
    skillMd: "",
    synthesized: false,
    bytes: 0,
    fetchedFrom: ""
  };
}

function parentOf(filePath: string): string {
  const at = filePath.lastIndexOf("/");
  return at <= 0 ? "" : filePath.slice(0, at);
}

function basenameOfUrl(url: string): string {
  const clean = url.split("#")[0] ?? url;
  const last =
    clean
      .split("/")
      .filter((one) => one !== "")
      .at(-1) ?? "skill";
  return last.replace(/\.md$/i, "");
}

/** 路径按段编码：上游目录名里有中文与空格，整段 encode 比手搓斜杠安全。 */
function encodePath(filePath: string): string {
  return filePath
    .split("/")
    .filter((one) => one !== "")
    .map((one) => encodeURIComponent(one))
    .join("/");
}

function scalarOf(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return "";
}

function listOf(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((one) => one.trim()).filter((one) => one !== "");
  const one = scalarOf(value);
  return one === "" ? [] : [one];
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

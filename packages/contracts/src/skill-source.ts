/**
 * 在线技能源（2026-11-10 用户裁定：
 * 「可以自己创建技能，然后自己根据需要的技能自己调用，再从网上寻找开源的或者好用的……不是模板的」）。
 *
 * 【这一层与 skill-market-service.ts 的分工】
 * 市场那张表是**代码里的常量**：说明书正文写死在仓里，装出来的东西与上游无关。
 * 用户那句话否掉的正是这一点——他要的是「网上真有什么，就装什么」。
 * 所以这里只定义**怎么认一个网上地址**，正文一律运行时从网络上取。
 *
 * 【为什么判据放 contracts 而不是主进程】
 * 渲染层要拿同一份解析做预览（在点「装」之前把将装什么摊开给人看），
 * 主进程要拿它决定去哪儿取。两处各写一遍，就会出现「预览的是 A、装进来的是 B」——
 * 那是本仓反复列为最坏状态的那一类（界面在撒谎）。
 *
 * 【只认 https】
 * 主进程会用这些地址去发请求。`file://`、`http://`、`data:` 一律拒：
 * 前两个能把本机文件当成"远端技能"读出来，后者根本不是远端。
 * 拒绝时给一句中文，绝不静默降级成「大概读一下」。
 */
import { z } from "zod";
import { MARKET_DIR_NAME_RE } from "./market.js";

/** 一份技能正文的取用上限。技能正文读上限是 64 KB（SKILL.md 的既有口径），留一倍余量放 frontmatter 与上游注释。 */
export const SKILL_FETCH_MAX_BYTES = 256 * 1024;

/** 单次请求的超时。超时就报超时——网络卡住时最不该做的是让按钮一直转。 */
export const SKILL_FETCH_TIMEOUT_MS = 12_000;

/** GitHub 的 raw 域名在部分网络下不可达，取文件失败时按序回退到镜像（镜像只读、只用于取原文）。 */
export const RAW_MIRROR_PREFIX = "https://ghproxy.net/";

/** 一个网上地址解析出来的形状：仓库坐标 + 仓库内路径。 */
export interface SkillUrlTarget {
  /** file = 直接指向一份 SKILL.md；dir = 指向一个目录（仓库根也算 dir，path 为空串）。 */
  kind: "file" | "dir";
  owner: string;
  repo: string;
  /** 分支/标签/提交。空串 = 用仓库默认分支（由 GitHub API 自己解，不在这里猜 main）。 */
  ref: string;
  /** 仓库内路径，`/` 分隔，无前后斜杠；仓库根为空串。 */
  path: string;
  /** 非 GitHub 的直链（例如某个站点上的 SKILL.md）：原样 GET，不带仓库坐标。 */
  absolute: string | null;
}

export type SkillUrlParse = { ok: true; target: SkillUrlTarget } | { ok: false; notice: string };

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;
/** 路径分段：允许空格与中文（上游目录名确实长这样），但排除一切能用来跳目录的字符。 */
const PATH_SEGMENT_RE = /^[^/\\:*?"<>|]+$/;

function fail(notice: string): SkillUrlParse {
  return { ok: false, notice };
}

/**
 * 解析用户粘进来的地址。收这几种：
 * - `https://github.com/o/r`                        → 整仓
 * - `https://github.com/o/r/tree/main/skills/x`     → 目录
 * - `https://github.com/o/r/blob/main/skills/x/SKILL.md` → 文件
 * - `https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md` → 文件
 * - `https://ghproxy.net/https://raw.githubusercontent.com/…`     → 同 raw
 * - 别的 `https://…/SKILL.md`（或任意 .md）          → 直链文件
 * - `o/r`、`o/r/tree/main/x`（省掉域名的简写）       → 同上
 */
export function parseSkillUrl(input: string): SkillUrlParse {
  const raw = input.trim();
  if (raw === "") return fail("先粘一个地址：GitHub 仓库、某个技能目录，或一份 SKILL.md 的链接。");

  // 简写：`o/r[/tree/…]` 补成完整 GitHub 地址再走同一条解析，避免第二套分支逻辑。
  const shorthand = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/|$)/.test(raw) ? raw : "";
  const text = shorthand !== "" ? `https://github.com/${shorthand}` : raw;

  let url: URL;
  try {
    url = new URL(text.split("#")[0] ?? text);
  } catch {
    return fail("这不像一个链接。粘完整的 https 地址，或写成 owner/repo。");
  }
  if (url.protocol !== "https:") {
    return fail(`只支持 https 链接（这条是 ${url.protocol.replace(":", "")}），别的协议不去取。`);
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname
    .split("/")
    .filter((one) => one !== "")
    .map(decodeSegment);

  // 镜像地址：剥掉前缀回到 raw 域名，后面与 raw 走同一条。
  if (host === "ghproxy.net" && segments[0] === "https:")
    return parseSkillUrl(
      segments
        .slice(1)
        .join("/")
        .replace(/^([^/]+)\//, "https://$1/")
    );

  if (host === "github.com") return parseGithub(segments);
  if (host === "raw.githubusercontent.com") return parseRaw(segments);

  // 其他站点：只接受指向一份 .md 的直链。指向目录的地址没有通用办法列内容，
  // 与其猜一个 listing 协议，不如直接说清「这里只认一份 .md」。
  const last = segments.at(-1) ?? "";
  if (!/\.md$/i.test(last)) {
    return fail("这个站点只支持直接指向一份 .md 的链接；要装整个仓库请用 GitHub 地址。");
  }
  return {
    ok: true,
    target: { kind: "file", owner: "", repo: "", ref: "", path: "", absolute: url.toString() }
  };
}

function decodeSegment(one: string): string {
  try {
    return decodeURIComponent(one);
  } catch {
    return one;
  }
}

function parseGithub(segments: string[]): SkillUrlParse {
  const [owner = "", repo = "", kind, ref = "", ...rest] = segments;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo.replace(/\.git$/, ""))) {
    return fail("地址里缺 owner/repo，例如 https://github.com/anthropics/skills");
  }
  const cleanRepo = repo.replace(/\.git$/, "");
  if (kind === undefined) {
    return {
      ok: true,
      target: { kind: "dir", owner, repo: cleanRepo, ref: "", path: "", absolute: null }
    };
  }
  if (kind !== "tree" && kind !== "blob") {
    // `issues`、`pulls`、`releases` 这些也是 /owner/repo/xxx 的形状，但它们不是技能位置。
    return fail(
      `这个地址指向仓库的「${kind}」，不是代码目录。用仓库首页或 …/tree/分支/目录 的地址。`
    );
  }
  const path = rest.join("/");
  const bad = checkPath(path);
  if (bad !== "") return fail(bad);
  if (kind === "blob" && !/\.md$/i.test(path)) {
    return fail("blob 地址要指向一份 .md（技能正文是 SKILL.md）。");
  }
  return {
    ok: true,
    target: {
      kind: kind === "blob" ? "file" : "dir",
      owner,
      repo: cleanRepo,
      ref,
      path,
      absolute: null
    }
  };
}

function parseRaw(segments: string[]): SkillUrlParse {
  const [owner = "", repo = "", ref = "", ...rest] = segments;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo) || ref === "") {
    return fail("raw 地址要写成 /owner/repo/分支/路径/SKILL.md 的形状。");
  }
  const path = rest.join("/");
  const bad = checkPath(path);
  if (bad !== "") return fail(bad);
  if (!/\.md$/i.test(path)) return fail("raw 地址要指向一份 .md 文件。");
  return { ok: true, target: { kind: "file", owner, repo, ref, path, absolute: null } };
}

/** 路径守卫：分段非空、不含 `..`、不含任何分隔符变体。拼 API 地址与拼落盘目录都要它。 */
function checkPath(path: string): string {
  if (path === "") return "";
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return `地址里的路径不合法：${path}`;
    if (!PATH_SEGMENT_RE.test(segment)) return `地址里的路径含不认识的字符：${segment}`;
  }
  return "";
}

/** 仓库内路径的末段（`skills/x` → `x`），给「目录名候选」用。 */
export function lastSegmentOf(path: string): string {
  const parts = path.split("/").filter((one) => one !== "");
  return parts.at(-1) ?? "skill";
}

/**
 * 上游目录名 → 合法技能目录名。
 * 上游常用 kebab-case，正好过守卫；不合法（中文、空格、大写开头以外的情况）时
 * 转写成 ASCII 并补一段稳定哈希，保证「同名总同名、不同名基本不撞」。
 */
export function skillDirNameOf(name: string): string {
  const trimmed = name.trim();
  if (MARKET_DIR_NAME_RE.test(trimmed)) return trimmed;
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 40);
  let hash = 2166136261;
  for (const char of trimmed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${ascii || "skill"}-${(hash >>> 0).toString(36).slice(0, 6)}`;
}

/* ───────────────────────────── 内置源（只有坐标，没有正文） ───────────────────────────── */

/**
 * 一条内置源。**只有仓库坐标**：标题、一句说明、许可状态是给用户判断的，技能正文一个字都不预先存在这里。
 * 这是本文件与 `skill-catalog.ts` 的关键差别——那张表里每一条都带着正文。
 */
export interface SkillSourcePreset {
  id: string;
  title: string;
  summary: string;
  owner: string;
  repo: string;
  ref: string;
  path: string;
  /** 上游许可。**核实到哪一步就写到哪一步**，不写「免费」这种含糊说法。 */
  license: string;
  /** 这个源适合拿来做什么 / 不适合做什么，一句话。 */
  fit: string;
}

export const SKILL_SOURCE_PRESETS: readonly SkillSourcePreset[] = [
  {
    id: "anthropic-skills",
    title: "Anthropic 官方技能集",
    summary: "官方维护的 Agent Skills 仓库：文档处理、设计、技能写作、文档共创等。",
    owner: "anthropics",
    repo: "skills",
    ref: "main",
    path: "skills",
    license: "仓库未声明 SPDX 许可（README 未给出），装前请自行确认可否使用",
    fit: "通用写作与文档类最相关；其中 skill-creator 就是「教你怎么写技能」的那一枚。"
  },
  {
    id: "superpowers",
    title: "Superpowers（obra）",
    summary: "MIT 许可的技能集，偏工程：头脑风暴、系统调试、TDD、计划执行。",
    owner: "obra",
    repo: "superpowers",
    ref: "main",
    path: "skills",
    license: "MIT",
    fit: "写小说用得上的是「头脑风暴」那几枚；其余是编程流程，按需装。"
  }
];

/** 源 → 可解析的地址（UI 与主进程共用，免得两处各拼一次 URL）。 */
export function presetUrl(preset: SkillSourcePreset): string {
  const base = `https://github.com/${preset.owner}/${preset.repo}`;
  return preset.path === "" ? base : `${base}/tree/${preset.ref}/${preset.path}`;
}

/**
 * 仓库内某个目录 → 可解析的地址。列表里每一条的 `url` 都由它拼出来，
 * 于是「点开的是哪一条」与「装的是哪一条」用的是同一句形，不会各拼一份。
 */
export function githubDirUrl(owner: string, repo: string, ref: string, path: string): string {
  const base = `https://github.com/${owner}/${repo}`;
  if (path === "") return base;
  return `${base}/tree/${ref}/${path}`;
}

/** 把「源的 id」或「一段地址」统一成一个地址；认不出的 id 原样当地址交给 parseSkillUrl 去拒绝。 */
export function sourceUrlOf(idOrUrl: string): string {
  const preset = SKILL_SOURCE_PRESETS.find((one) => one.id === idOrUrl.trim());
  return preset === undefined ? idOrUrl.trim() : presetUrl(preset);
}

/* ───────────────────────────── IPC 结果形状 ───────────────────────────── */

/** 浏览一个源时的一条候选。**不含正文**：正文在点开那一条时才取（省请求，也省得列表里塞满无关文本）。 */
export interface RemoteSkillEntry {
  /**
   * 这一条自己的地址（主进程按 owner/ref/目录名拼好）。
   * 为什么由主进程给、而不是渲染层拿 owner+ref 自己拼：拼 URL 的规则只该有一份，
   * 两处拼就会出现「列表里点开的」与「装进来的」不是同一个位置的错位。
   */
  url: string;
  /** 上游仓库内路径（目录）。装的时候要拿它拼 SKILL.md 的地址。 */
  path: string;
  /** 规划出来的落盘目录名（已过 MARKET_DIR_NAME_RE）。 */
  dirName: string;
  /** 上游目录名原文——列表就显示它，不编一个更好听的假名。 */
  label: string;
  /** 已经装在全局技能目录里了。 */
  installed: boolean;
}

/** skills:remote-list 的返回。`listed` 与「一条都没有」必须分得开（同 MarketListResult 的理由）。 */
export interface RemoteListResult {
  entries: RemoteSkillEntry[];
  listed: boolean;
  notice: string;
  /** 这次列的是哪儿（回显给界面，让人确认自己看的是哪个源）。 */
  source: string;
}

/** 一份远端技能的预览：装之前把「将装进来什么」摊开。 */
export interface RemoteSkillPreview {
  ok: boolean;
  notice: string;
  dirName: string;
  displayName: string;
  description: string;
  stages: string[];
  appliesTo: string[];
  /** 会逐字写进盘的那份全文（缺 frontmatter 时已按上游目录名补一份，`synthesized` 为 true）。 */
  skillMd: string;
  synthesized: boolean;
  bytes: number;
  /** 最终来自哪个地址（镜像回退时与用户粘的不同，要说清）。 */
  fetchedFrom: string;
}

export interface RemoteInstallResult {
  ok: boolean;
  notice: string;
  dirName: string;
  displayName: string;
}

/* ───────────────────────────── 自己写技能 ───────────────────────────── */

/**
 * 「自己创建技能」的草稿。正文由用户写，frontmatter 由 `composeSkillMd` 按这四个字段拼——
 * 用户在界面上填的是「名字/说明/阶段」，不该被要求手写 YAML。
 */
export const skillAuthorDraftSchema = z.object({
  dirName: z.string().regex(MARKET_DIR_NAME_RE, "目录名只能用小写英文、数字、点、下划线、短横线"),
  displayName: z.string().min(1, "技能名不能为空").max(80),
  description: z.string().max(400),
  stages: z.array(z.string().max(24)).max(8),
  appliesTo: z.array(z.string().max(24)).max(8),
  body: z.string().min(1, "正文不能为空"),
  /** 同名已存在时是否覆盖。默认 false：覆盖用户写过的技能必须是显式动作。 */
  overwrite: z.boolean()
});
export type SkillAuthorDraft = z.infer<typeof skillAuthorDraftSchema>;

export interface SkillAuthorResult {
  ok: boolean;
  notice: string;
  dirName: string;
  displayName: string;
}

/** 正文里若已经带 frontmatter，就原样用它——不叠第二层，那会让 `parseFrontmatter` 只认到第一段。 */
export function hasFrontmatter(text: string): boolean {
  return /^\s*---\r?\n/.test(text);
}

/** YAML 标量里不能出现换行；引号只在与内容冲突时才加，保持上游/用户写法原样。 */
function yamlScalar(value: string): string {
  const one = value.replace(/\r?\n/g, " ").trim();
  return /^[A-Za-z0-9\u4e00-\u9fa5（）、，。：·—\s/._-]*$/.test(one)
    ? one
    : `"${one.replace(/"/g, '\\"')}"`;
}

/**
 * 拼一份 SKILL.md。frontmatter 只有四格（name / description / stage / appliesTo），
 * 与 `scanSkills` 真会读的那几格一一对应——多写的格子没人读，等于假装支持。
 */
export function composeSkillMd(draft: {
  displayName: string;
  description: string;
  stages: readonly string[];
  appliesTo: readonly string[];
  body: string;
}): string {
  const body = draft.body.replace(/\r\n/g, "\n").trim();
  if (hasFrontmatter(body)) return `${body}\n`;
  const lines = ["---", `name: ${yamlScalar(draft.displayName)}`];
  const description = draft.description.trim() || draft.displayName.trim();
  lines.push(`description: ${yamlScalar(description)}`);
  if (draft.stages.length > 0) lines.push(`stage: ${yamlScalar(draft.stages.join("、"))}`);
  if (draft.appliesTo.length > 0)
    lines.push(`appliesTo: ${yamlScalar(draft.appliesTo.join("、"))}`);
  lines.push("---", "", body);
  return `${lines.join("\n")}\n`;
}

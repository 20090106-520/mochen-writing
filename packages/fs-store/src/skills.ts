import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  SKILL_CONTENT_MAX_BYTES,
  SKILL_FILE_NAME,
  skillIdOf,
  type SkillRef,
  type SkillSource
} from "@mochen/contracts";
import { parseFrontmatter } from "./frontmatter.js";
import { isPathUnderRoot, realPath, type LinkResolver } from "./paths.js";

export type { SkillRef, SkillSource };

/**
 * 技能库的只读扫描（plan3 spec §11）。
 *
 * 刻意**不动 scanBook**：`.mochen` 被跳过是既有正确行为（文稿扫描不该看见会话/备份/技能），
 * 为技能破例改它等于让技能混进文稿树。技能走自己这一份，两个来源各扫一次。
 *
 * 目录形状只有一个：`<dirName>/SKILL.md`。别的文件（README、附件、分卷）一律不看——
 * 「技能长什么样」不是渲染层该猜的事，形状钉死在这一处。
 */

/** 目录名 → SkillRef。目录名非法、SKILL.md 读不回的，整条跳过，不让一个坏技能掀掉整张表。 */
export async function scanSkills(dir: string, source: SkillSource): Promise<SkillRef[]> {
  const entries = await readdirSafely(dir);
  const out: SkillRef[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const ref = await readSkillRef(path.join(dir, entry.name), entry.name, source);
    if (ref !== null) out.push(ref);
  }
  return out;
}

/**
 * 目录读不回就当它没有技能，而不是报错。
 * 技能目录是「用户还没建过」的那种可选目录：第一次运行时它根本不存在，
 * 那是常态而不是故障，抛 ENOENT 出去只会让整张技能表取不到。
 */
async function readdirSafely(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSkillRef(
  dir: string,
  dirName: string,
  source: SkillSource
): Promise<SkillRef | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, SKILL_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  return {
    id: skillIdOf(source, dirName),
    source,
    dirName,
    // 显示名优先取 frontmatter 的 name；没有就用目录名（目录名是用户自己起的，不难看）。
    displayName: text(data.name) || dirName,
    description: text(data.description) || firstLine(body),
    stages: listOf(data.stage),
    appliesTo: listOf(data.appliesTo),
    relPath: `${dirName}/${SKILL_FILE_NAME}`
  };
}

/** frontmatter 的值既可能是标量也可能是列表；这里统一收成「非空的字符串」。 */
function text(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return "";
}

function listOf(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter((item) => item !== "");
  const one = text(value);
  return one === "" ? [] : [one];
}

/** 没有 description 时拿正文第一段顶上：一句都不给的那张卡在 UI 上是个空壳。标题行整行跳过（那是标题，不是说明）。 */
function firstLine(body: string): string {
  const kept: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || /^#{1,6}\s/.test(line)) continue;
    kept.push(line.replace(/^[-+*]\s+/, ""));
  }
  return kept.join(" ");
}

/**
 * 读取守卫（spec §11 的三条安全，逐条都配了反向用例）：
 * ① relPath 必须逐字是 `<单层目录名>/SKILL.md`——多层目录、别的文件名、绝对路径一律拒。
 * ② 拼出来的绝对路径必须仍在 `skillsDir` 内：符号链接把 `x/SKILL.md` 指到目录外也要拒。
 * ③ 正文按字节截在 64 KB，截了就把 `truncated` 如实标出来。
 *
 * 返回值永远是**整份**的 bytes 读完之后在内存里截，不做流式读：
 * 这里的对手不是超大文件而是恶意路径，文件本身是用户自己放的。
 */
export async function readSkillFile(
  skillsDir: string,
  relPath: string,
  /** 位置闸的真实路径解法缝；默认 `fs.realpath`，测试注入「解到目录外」来造软链那一档（P2-2）。 */
  resolve?: LinkResolver
): Promise<{ relPath: string; content: string; truncated: boolean }> {
  const posix = relPath.replaceAll("\\", "/");
  const segments = posix.split("/");
  if (
    segments.length !== 2 ||
    segments[0] === "" ||
    segments[0] === "." ||
    segments[0] === ".." ||
    segments[1] !== SKILL_FILE_NAME
  ) {
    throw new Error(`技能路径必须是「<目录名>/${SKILL_FILE_NAME}」，收到：${relPath}`);
  }
  const root = path.resolve(skillsDir);
  const full = path.join(root, segments[0]!, SKILL_FILE_NAME);
  // ② 真实路径必须仍在 skills 目录内。这一条拦的是符号链接：`<目录>/SKILL.md` 可以是个指向
  //    目录外的软链，形状检查逐字都对，只有 realpath 才看得穿。
  //    判定住在 `paths.ts` 的 `isPathUnderRoot`（P2-2：整仓只许一份「在根之下」的口径，
  //    原来这里与 `changes.ts` 各写了一份，而读正文与写正文两条路一份都没有）。
  //    解不出真实路径时它退到父目录再判——父目录也在目录外才算越界，读不到由下面的 readFile 报。
  if (!(await isPathUnderRoot(full, root, resolve ?? realPath)))
    throw new Error(`技能路径越界：${relPath}`);
  let raw: string;
  try {
    raw = await readFile(full, "utf8");
  } catch {
    throw new Error(`读不到这份技能：${relPath}`);
  }
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes <= SKILL_CONTENT_MAX_BYTES) return { relPath, content: raw, truncated: false };
  // 按字节截，再退到字符边界上：直接 slice 会把多字节字符劈成半个，渲染出乱码。
  const clipped = Buffer.from(raw, "utf8").subarray(0, SKILL_CONTENT_MAX_BYTES).toString("utf8");
  return { relPath, content: clipped.replace(/�+$/, ""), truncated: true };
}

/** 合并两个来源的技能表：按目录名去重，**书内优先**（spec §11）。 */
export function mergeSkillRefs(global: readonly SkillRef[], book: readonly SkillRef[]): SkillRef[] {
  const byDir = new Map<string, SkillRef>();
  for (const ref of global) byDir.set(ref.dirName, ref);
  for (const ref of book) byDir.set(ref.dirName, ref);
  return [...byDir.values()].sort((a, b) => a.dirName.localeCompare(b.dirName, "zh-CN"));
}

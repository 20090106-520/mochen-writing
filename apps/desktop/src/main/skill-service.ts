import path from "node:path";
import {
  IPC_CHANNELS,
  type SkillContent,
  type SkillRef,
  type SkillSource
} from "@mochen/contracts";
import { mergeSkillRefs, readSkillFile, scanSkills } from "@mochen/fs-store";

/** electron 的 ipcMain.handle 的窄形状（与 appearance-store 同款）：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 技能库的主进程真身（plan3 spec §11）：**只读**。这一层没有写通道，
 * 也没有删除/导入——技能由用户自己在磁盘上放，应用这边只负责列出来、读出来。
 *
 * 两个来源的根目录在这里汇成一张表：
 * - global：`<appData>/…/skills`（跟着 secretDir 走，F-4 改目录名时它自然跟着搬）
 * - book：`<书目录>/.mochen/skills`（书内的，跟着书走）
 *
 * 书目录是运行时才有的，所以 listSkills 每次都现问 book.current()，不缓存——
 * 换书之后表必须跟着换，缓存下来的旧表就是骗人的。
 */
export interface SkillService {
  list(): Promise<SkillRef[]>;
  read(source: SkillSource, relPath: string): Promise<SkillContent>;
  /** 某个来源的 skills 根目录。挂入装配与 read 走它，路径只在这里拼一次。 */
  dirOf(source: SkillSource): string | null;
}

export function createSkillService(deps: {
  /** 全局技能根：`<appData>/…/skills`。 */
  globalSkillsDir: string;
  /** 当前书目录；null = 还没打开作品（书内技能那一份自然也就没有）。 */
  bookRoot(): string | null;
}): SkillService {
  function dirOf(source: SkillSource): string | null {
    if (source === "global") return deps.globalSkillsDir;
    const root = deps.bookRoot();
    return root === null ? null : path.join(root, ".mochen", "skills");
  }

  async function list(): Promise<SkillRef[]> {
    const global = await scanSkills(deps.globalSkillsDir, "global");
    const bookDir = dirOf("book");
    const book = bookDir === null ? [] : await scanSkills(bookDir, "book");
    return mergeSkillRefs(global, book);
  }

  async function read(source: SkillSource, relPath: string): Promise<SkillContent> {
    const dir = dirOf(source);
    if (dir === null) throw new Error("还没打开作品目录，读不到书内技能。");
    return readSkillFile(dir, relPath);
  }

  return { list, read, dirOf };
}

/** 只注册白名单里的两条技能通道：列与读。写路径压根不存在，所以这里不可能漏一道写闸。 */
export function registerSkillIpc(handle: Handler, skills: SkillService): void {
  handle(IPC_CHANNELS.skillsList, () => skills.list());
  handle(IPC_CHANNELS.skillsRead, (_event, source, relPath) =>
    skills.read(source as SkillSource, relPath as string)
  );
}

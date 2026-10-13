import { mkdir, open, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";

/**
 * 原子写：先把整篇写进同目录的临时文件，落到盘上，再一次改名盖住正文（2026-10-09 全仓扫描 P0-1）。
 *
 * **为什么非做不可**：`writeFile(target, content)` 是「先截断再写」。写到一半遇上 ENOSPC、进程被强杀、
 * 断电，或 Windows 上杀软/OneDrive 正在读这个文件，留下的就是**半截正文**；而用户不会看见任何提示，
 * 下次打开这一章就是那半截。对写作产品来说这是最坏的一类失败——丢的是内容本身。
 * 改名（`rename`）在同一目录内是原子的：外界要么看到旧稿，要么看到新稿，永远不会看到中间态。
 *
 * **为什么把 fs 收成注入点**：本体要防的失败恰好是「某一步系统调用抛错」，而这在真文件系统上
 * 无法稳定复现。默认实现用真 fs（并且带 fsync），测试注入「只坏一步」的实现来证明拦截有效。
 * 同仓先例：`webSearch(query, { fetchImpl })`。
 */
export type AtomicWriteFs = {
  writeFile: (target: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (target: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
};

/**
 * 产品真用的那份 fs：测试要注入「只坏一步」的实现时**在这份之上**改，别再抄一份（铁律 6）。
 *
 * 写完再 sync 一次：rename 只保证「目录项换了」，不保证内容字节已经离开系统缓存。
 * 断电这一档不必把 Windows 也拖进同步元数据那条慢路——正文不半截已经是要守的那条线。
 */
export const defaultAtomicFs: AtomicWriteFs = {
  writeFile: async (target, data) => {
    const handle = await open(target, "w");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => rename(from, to),
  // force: true ⇒ 文件本来就不在不算失败（清理路径上「不在」就是已经清理好了）。
  unlink: (target) => rm(target, { force: true }),
  mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined)
};

/**
 * 临时件名的中段。生产方（tmpPathOf）与认出它的人（isWriteScratchName）共用这一份形状——
 * 谁都不许在旁边再写一遍字面量（铁律 6）。
 */
const SCRATCH_INFIX = ".mochen-tmp-";

/** 临时文件名：跟着目标走（同目录才能原子改名），后缀刻意**不**以 .md 结尾，免得被书目扫描认成正文。 */
function tmpPathOf(target: string): string {
  return `${target}${SCRATCH_INFIX}${randomBytes(4).toString("hex")}`;
}

/**
 * 这个文件名是不是某次原子写留下的半成品。
 *
 * 【为什么需要它】半成品只在「写完、改名之前」那几十毫秒里存在，扫书看不见它（名字不以 .md 结尾），
 * 但**整书备份的 copyTree 是全仓唯一走遍书里所有文件的地方**——它会把那一刻的半成品原样抄进备份，
 * 还计入 fileCount，于是对话框上写着「已备份 2 个文件」而其中 1 件是垃圾。
 * 2026-10-11 真机量到的现场：`.mochen-tmp/p545/backup-count.mjs` 造的书，
 * 备份目录 book-2026-10-11-11-27-52/ 里躺着 `chapters/01.md.mochen-tmp-9e4a8d8c`。
 */
export function isWriteScratchName(name: string): boolean {
  return name.includes(SCRATCH_INFIX);
}

/**
 * 「这个文件此刻正被别人拿着」那一族错误码——只有它们值得再试一次改名。
 *
 * Windows 上这一族是常态而不是异常：杀软实时扫描、索引服务、OneDrive 同步、编辑器自己留的句柄，
 * 都会让 `rename` 在几百毫秒内返回 EPERM/EACCES/EBUSY，然后自己就好。本机 2026-10-09 的压测里
 * 亲眼见到 50 连写中第 30、49 次撞上它——**盘上什么都没有坏**，可旧实现直接把它当成写失败报出去，
 * 用户看到的就是「保存失败」，而稍后再存一次反而成功。这种假失败必须自己吞掉。
 *
 * 反过来，ENOSPC / EROFS / ENOENT 这类重试一百次还是同一个结果的码**绝不重试**：
 * 那只会把一次该立刻露出来的失败拖成一串无意义的等待。
 */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** 改名最多试几次（含第一次）。四次 + 递增退避，最坏约 140ms，仍在一次自动保存的容忍范围内。 */
const DEFAULT_RENAME_ATTEMPTS = 4;

export type AtomicWriteOptions = {
  /** 改名尝试次数上限，含第一次；小于 1 按 1 算。 */
  readonly attempts?: number;
  /** 两次改名之间的等待，参数是「第几次已经失败」；测试注入立即返回的实现，免得用例真等退避。 */
  readonly wait?: (failedAttempt: number) => Promise<void>;
};

async function defaultWait(failedAttempt: number): Promise<void> {
  await sleep(20 * 2 ** (failedAttempt - 1));
}

function isTransientRenameError(error: unknown): boolean {
  return TRANSIENT_RENAME_CODES.has((error as { code?: string }).code ?? "");
}

/** 只重试改名这一步：临时文件已经 fsync 过，内容早在盘上了，撞的只是目录项换不了。 */
async function renameWithRetry(
  tmp: string,
  target: string,
  fs: AtomicWriteFs,
  options: AtomicWriteOptions
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_RENAME_ATTEMPTS);
  const wait = options.wait ?? defaultWait;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(tmp, target);
      return;
    } catch (error) {
      if (attempt >= attempts || !isTransientRenameError(error)) throw error;
      await wait(attempt);
    }
  }
}

export async function writeFileAtomic(
  target: string,
  content: string,
  fs: AtomicWriteFs = defaultAtomicFs,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const tmp = tmpPathOf(target);
  try {
    await fs.mkdir(path.dirname(target));
    await fs.writeFile(tmp, content);
    await renameWithRetry(tmp, target, fs, options);
  } catch (error) {
    try {
      await fs.unlink(tmp);
    } catch {
      // 清不掉就留在盘上：下一次同名写会换一个新临时名，不会盖到它；
      // 但这里绝不能把清理失败抛出去——那会把真正的失败原因（ENOSPC/EPERM）换成一句无关的话。
    }
    throw error;
  }
}

import { realpath } from "node:fs/promises";
import path from "node:path";
// 保留名的判定与那句人话住在 contracts 的 book.ts（渲染层起名、主进程兜底、这里落盘前，
// 三处闸吃同一份真身，铁律 6）。fs-store 依赖 contracts 已有先例（book-meta.ts 引 parseBookMeta）。
import { windowsReservedNameProblem } from "@mochen/contracts";

export function toPosixRelPath(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

export function assertSafeRelPath(relPath: string): string {
  if (!relPath || relPath.trim() === "") throw new Error("invalid-path: 空路径");
  const posix = toPosixRelPath(relPath);
  if (posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix))
    throw new Error(`invalid-path: 需要书内相对路径，收到 ${relPath}`);
  const segments = posix.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) throw new Error(`outside-book: 路径越界 ${relPath}`);
  // Windows 保留名（P2-2 的后半）：`chapters/CON.txt` 写法逐字合法，但在 Windows 上根本落不了盘——
  // 而且本机实测 `fs.writeFile` **不抛错**（文件真能建出来），所以只能在这一层当场拒，
  // 并且不分平台一律拒（同一本书迟早被拷回 Windows）。理由那句由 contracts 那份真身给。
  const reserved = windowsReservedNameProblem(posix);
  if (reserved !== null) throw new Error(`invalid-path: ${reserved}`);
  return segments.join("/");
}

/**
 * 「怎么把一条路径解成真实路径」的注入点。默认是 `fs.realpath`；
 * 测试注入一个把目标解到书外的实现，就等于造了一个软链——本机是非开发者模式，
 * `fs.symlink` 直接 EPERM，造不出真软链，所以这道判定必须留缝（同 `atomic-write.ts` 的 fs 缝）。
 */
export type LinkResolver = (target: string) => Promise<string>;

/** 产品真用的那份解法：整仓只有这一处直接调 `fs.realpath`（要注入就换注入点，别抄一份）。 */
export const realPath: LinkResolver = (target) => realpath(target);

/** 同一台 Windows 机器上 realpath 会回大小写不同、甚至 8.3 短名，逐字相等会把合法路径判成越界。 */
export function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * **整仓唯一的一份**「这条路径的真实位置还在根里面吗」（2026-10-10 扫描总单 P2-2）。
 *
 * 为什么非要收成一份：`assertSafeRelPath` 只看路径的**写法**，`..` 与绝对路径它挡得住，
 * 挡不住书目录里一个指向书外的软链——写法逐字合法，读到的却是 `~/.ssh/id_eddsa`，
 * 保存也会顺着它盖写到书外。别人发来的书、从旧盘拷回来的工程目录都会带软链。
 * 原来这个判定在仓里有两份（`changes.ts` 的 `isUnder`、`skills.ts` 里就地写的 realpath 比对），
 * 而读正文与写正文那两条路一份都没有；两份迟早会不一样，那比没闸更坏。
 *
 * 为什么「在根之下」而不是「父目录逐字相等」：后者会把嵌套目录里的合法文稿全判成越界。
 * 为什么目标不存在时要退到父目录：新建一章时文件还没落盘，realpath 必抛；
 * 这时能判的只有「它的父目录在不在书里」——留在书内的新文件是合法写，不是越界。
 * 为什么解不出真实路径一律回 false：解不出＝这一秒读不到（权限、并发删、盘没挂），
 * 按「不能证明它在书里」处理，比放行去写要诚实。
 */
export async function isPathUnderRoot(
  child: string,
  parent: string,
  resolve: LinkResolver = (target) => realpath(target)
): Promise<boolean> {
  let realParent: string;
  try {
    realParent = await resolve(parent);
  } catch {
    return false;
  }
  const prefix = realParent.endsWith(path.sep) ? realParent : realParent + path.sep;
  let probe = child;
  // 「往上退了几层」必须记下来：退到根那一层时「解出来就是根」是合法落点，
  // 而**第一次就**解成根（或解析器把所有东西都解成同一串）证明不了 child 在书里。
  let walkedUp = false;
  for (;;) {
    try {
      const real = await resolve(probe);
      if (samePath(real, realParent)) return walkedUp;
      return samePath(real.slice(0, prefix.length), prefix);
    } catch {
      const up = path.dirname(probe);
      // 走到文件系统顶还解不出：没有任何东西能证明它在书里。
      if (up === probe) return false;
      walkedUp = true;
      probe = up;
    }
  }
}

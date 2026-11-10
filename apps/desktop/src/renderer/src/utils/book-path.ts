/**
 * 作品库那一行只放得下一行路径。
 *
 * 直接 `text-overflow: ellipsis` 是从**尾部**截：`C:\Users\17863\Downloa…`——
 * 最有用的那截（文件夹名）正好被切掉，用户看到的全是每台机器都一样的
 * 「C:\Users\<用户名>\」。这里从中间收：前面的盘符与用户目录省掉，留住最后两段。
 *
 * 平台各按自己的分隔符拼回去，不把 `/` 改写成 `\`（macOS 上那样拼出来是错的路径）。
 */
export function shortenRootPath(path: string, keep = 2): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed === "") return "";
  const sep = trimmed.includes("\\") ? "\\" : "/";
  const parts = trimmed.split(/[\\/]+/);
  if (parts.length <= keep) return trimmed;
  return `…${sep}${parts.slice(-keep).join(sep)}`;
}

/** 路径末段（盘上那一级目录名）。收尾分隔符先去掉，`C:\书稿\` 与 `C:\书稿` 同解。 */
export function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed === "") return "";
  const parts = trimmed.split(/[\\/]+/);
  return parts[parts.length - 1] ?? "";
}

/**
 * 这一串是不是**路径**而不是书名（2026-11-10）。
 *
 * 真机撞到的：左栏作品库里两行都是 `1…/Desktop/新建文件夹`——书名与路径一模一样。
 * 查下去是 `book.json` 里 `title` 存的就是目录路径（早期「打开目录」那条通路
 * 把目录名当书名写了进去）。这不是显示层能改的**数据**，但显示层能兜：
 * 标题里只要有路径分隔符或盘符，它就不是一个书名。
 *
 * 为什么不顺手把盘上的 title 改掉：那是用户的书，擅自改 `book.json` 属于越界；
 * 而「名字读起来像路径」这件事，每台机器的老书都可能有一本。
 */
export function looksLikePath(title: string): boolean {
  return /[\\/]/.test(title) || /^[A-Za-z]:/.test(title);
}

/**
 * 作品库/作品切换器上显示的书名。
 *
 * 三种输入各有各的落点：
 * ① 正常书名 → 原样；
 * ② 标题是路径 → 取末段（`1…/Desktop/新建文件夹` → `新建文件夹`），空则退到作品目录的末段；
 * ③ 标题是空串 → 退到作品目录末段，仍是空就给「未命名作品」。
 * 兜底顺序是「标题末段 → 目录末段 → 占位」，不许出现空标签：
 * 一行没有名字的作品，用户没法在列表里指认它。
 */
export function bookDisplayTitle(title: string, rootPath: string): string {
  const trimmed = title.trim();
  if (trimmed !== "" && !looksLikePath(trimmed)) return trimmed;
  const fromTitle = trimmed === "" ? "" : basenameOf(trimmed);
  return fromTitle || basenameOf(rootPath) || "未命名作品";
}

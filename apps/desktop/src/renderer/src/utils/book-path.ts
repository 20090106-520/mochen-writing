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

/**
 * 作品库同名目录的辨识口径（2026-11-15）。
 *
 * 真机撞到的：两台机器（或两个父目录）下各有一个「新建文件夹」，作品库两行
 * 标题与路径都一模一样，点哪行全靠猜。`shortenRootPath` 只留两段是好看的默认值，
 * 但**不能保证唯一**——这里只给撞车的那几行逐级多留一段，直到彼此不同；
 * 其余行仍走原口径，不因为一处重名把整列路径都拉长。
 *
 * 最坏退到完整路径；连完整路径都相同（同一条目录被登记两次）时补行号，绝不给出两行同字。
 */
export function uniqueRootPathLabels(rootPaths: readonly string[], keep = 2): string[] {
  const segmentsOf = (path: string) =>
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]+/)
      .filter(Boolean).length;
  const maxDepth = Math.max(keep, ...rootPaths.map(segmentsOf));
  return rootPaths.map((rootPath, index) => {
    for (let depth = keep; depth <= maxDepth; depth += 1) {
      const label = shortenRootPath(rootPath, depth);
      const collides = rootPaths.some(
        (other, otherIndex) => otherIndex !== index && shortenRootPath(other, depth) === label
      );
      if (!collides) return label;
    }
    return `${shortenRootPath(rootPath, maxDepth)}（${index + 1}）`;
  });
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

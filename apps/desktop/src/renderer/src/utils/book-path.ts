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

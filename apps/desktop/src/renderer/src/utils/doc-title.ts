import { splitFrontmatter } from "@mochen/contracts";

export interface RenameTitleResult {
  ok: boolean;
  /** ok 时是改好 title 行的整份内容；不 ok 时原样返回，调用方一律不得写盘。 */
  content: string;
  /** 不 ok 的单句中文理由；ok 时为 null。 */
  reason: "empty" | "newline" | "no-fence" | null;
}

/**
 * 把 frontmatter 里的 title 行改成新标题（只动元数据那一行，relPath 与文件名一概不动）。
 * 写入格式与 fs-store/parsePairs 的解析对偶：`title: 行内其余`，不做引号转义——
 * 解析侧同样只按「键: 行内其余」读，冒号引号都原样往返。
 * 没有合法围栏的文件返回 no-fence：半截元数据不是这里能替作者补的东西。
 */
export function renameTitleInContent(raw: string, nextTitle: string): RenameTitleResult {
  const title = nextTitle.trim();
  if (title === "") return { ok: false, content: raw, reason: "empty" };
  if (/[\r\n]/.test(title)) return { ok: false, content: raw, reason: "newline" };

  const { block, body } = splitFrontmatter(raw);
  if (block === null) return { ok: false, content: raw, reason: "no-fence" };

  const lines = block.split("\n");
  const line = lines.findIndex((row, index) => index > 0 && /^title:(\s|$)/.test(row));
  if (line === -1) {
    // 有围栏没 title 行：补在开栏之后第一行——元数据键的顺序里 title 排头是本仓模板的既成事实。
    lines.splice(1, 0, `title: ${title}`);
  } else {
    lines[line] = `title: ${title}`;
  }
  return { ok: true, content: lines.concat(body === "" ? [] : [body]).join("\n"), reason: null };
}

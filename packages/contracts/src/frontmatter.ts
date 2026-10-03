/**
 * frontmatter 围栏切分的唯一实现点。
 *
 * 为什么从 `fs-store` 上收到 `contracts`：磁盘上那三根横线「什么算元数据、什么算正文」是一个规则，
 * 但消费它的是两侧——主进程扫描要按它取 title/excerpt/chars，渲染层页脚要按它算「正文 N 字」。
 * 渲染层进不了 `fs-store`（包边界门禁），于是两侧各写一遍的风险就变成「页脚把 `---` 和 `title:` 算成字数」。
 *
 * 刻意只做切分，不解析键值：YAML 那套（标量 / 列表 / 缩进容错）仍住 `fs-store/frontmatter.ts`，
 * 它现在从这里拿 `block` 与 `body`，全仓只剩一处认围栏。
 */
export const FRONTMATTER_FENCE = "---";

/** Windows 编辑器会在文件头塞一个零宽 BOM；它不是正文字符，也不该参与「有没有围栏」的判定。 */
const BOM = String.fromCharCode(0xfeff); // 源文件里不写裸 BOM 字符：它不可见，改的人看不见自己删了什么

export interface FrontmatterSplit {
  /** 含首尾两行 `---` 的整块原文；`null` ⇒ 这篇没有合法围栏。 */
  block: string | null;
  /** 剥掉围栏后的正文（BOM 已去掉）；没有围栏时就是去 BOM 后的原文。 */
  body: string;
}

export function splitFrontmatter(raw: string): FrontmatterSplit {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (!text.startsWith(`${FRONTMATTER_FENCE}\n`)) return { block: null, body: text };
  const lines = text.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === FRONTMATTER_FENCE) {
      close = i;
      break;
    }
  }
  // 有开栏没闭栏：整篇按正文算。半截元数据既不是键值对，也不该被当成「不存在的字」。
  if (close === -1) return { block: null, body: text };
  return {
    block: lines.slice(0, close + 1).join("\n"),
    body: lines.slice(close + 1).join("\n")
  };
}

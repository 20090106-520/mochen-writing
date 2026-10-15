/**
 * 字面替换（2026-10-15 全书替换那一刀）。
 *
 * 【为什么有这一层】「什么叫字面命中」在本仓必须只有一份判定：
 *   - 文档内查找替换（`useFindReplaceStore.compileSearchRegex` 的非正则支）；
 *   - 全书替换（主进程 `book:replace-all`，逐篇读 → 换 → 写）。
 * 两处若各写一份转义正则，将来一处改了另一处不跟着，用户看到的就是
 * 「面板里找得到、全书替换却换不掉」（铁律 6）。
 *
 * 【为什么不收正则】全书替换的入口在全文搜索面板里，而那个面板的检索口径是
 * **字面子串**（大小写不敏感）。替换若偷偷按正则解释，`小明.` 这种查询会把
 * 「小明」后随便一个字一起吃掉——面板上看是 3 处、盘上换掉的东西却是另一回事。
 * 要正则的用户走文档内 Ctrl+F 那套（那边三个开关是显式的）。
 *
 * 判定是纯函数：无 IO、无状态，主进程与渲染层吃同一份。
 */

/**
 * 正则元字符转义：把一段**字面文本**变成能安全塞进 `new RegExp` 的模式串。
 * 少了这一步，查询里的 `.` `*` `(` 会被当元字符解释 —— 找「1.5 米」会连「1x5 米」一起命中。
 */
export function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface LiteralPatternOptions {
  /** 只看整词：模式串两侧加 `\b`。默认 false（与查找面板的默认档一致）。 */
  wholeWord?: boolean;
}

/**
 * 字面模式串 = 转义 +（可选）整词括起。
 * 查找面板与全书替换都从这里取模式串，转义只写这一遍。
 */
export function literalPattern(query: string, options: LiteralPatternOptions = {}): string {
  const escaped = escapeRegExpLiteral(query);
  return options.wholeWord === true ? `\\b${escaped}\\b` : escaped;
}

export interface LiteralReplaceOptions extends LiteralPatternOptions {
  /** 区分大小写。默认 false —— 与全文搜索面板的检索口径一致。 */
  caseSensitive?: boolean;
}

/** 替换后的正文与**换掉的处数**。处数是给界面如实报数用的，不是估算。 */
export interface LiteralReplaceOutcome {
  text: string;
  count: number;
}

/**
 * 把 `text` 里所有字面命中一次性换成 `replacement`，返回新正文与实际处数。
 *
 * - 替换串一律当**字面**（用回调形式，`$1`／`$&` 不会被当组引用吃掉）——
 *   全书替换没有「正则捕获组」这个入口，`$` 出现在替换串里就该原样落进正文；
 * - `query` 为空直接原样返回、处数 0：空模式会匹配到每一处间隙，
 *   那不是「替换」而是把整篇切碎（入口那一侧也会先把空查询拦掉，这里是第二道，不是第二份判据）。
 */
export function replaceLiteral(
  text: string,
  query: string,
  replacement: string,
  options: LiteralReplaceOptions = {}
): LiteralReplaceOutcome {
  if (query === "") return { text, count: 0 };
  const flags = options.caseSensitive === true ? "g" : "gi";
  const re = new RegExp(literalPattern(query, options), flags);
  let count = 0;
  const next = text.replace(re, () => {
    count += 1;
    return replacement;
  });
  return { text: next, count };
}

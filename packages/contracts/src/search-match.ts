/**
 * 检索容错（2026-10-10）：全文搜索的一字之差兜底。
 *
 * 【为什么有这一层】专有名词（人名、地名、功法名）是最常被搜、也最容易记错一个字的
 * ——「林潮生」记成「林潮升」，精确子串匹配一无所获，用户只看到「没有找到」，
 * 而那份材料明明就在书里。精确匹配永远先行；**整书精确零命中**才走这一层兜底，
 * 所以它对正常搜索零开销，也永远不会把「精确命中」挤下去。
 *
 * 【为什么是编辑距离 ≤1 而不是拼音】拼音首字母要一张几万条的汉字映射表，
 * 为一个兜底功能背一张表违背本仓零依赖铁律；一字之差（升↔生、玥↔月、峰↔锋）
 * 覆盖了绝大多数「记错字」场景。拼音容错如果真有需求，等真的有人提再说。
 *
 * 判定是纯函数：无 IO、无状态，主进程（search_docs）与渲染层（SearchPanel）吃同一份。
 */

/** 查询超过这个长度就不做容错（长句多一个字少一个字太常见，容错等于乱命中）。 */
export const FUZZY_QUERY_MAX_CHARS = 20;

/**
 * 两串是否至多差一次编辑（插入 / 删除 / 替换各算一次）。
 * 经典双指针：长度差超过 maxEdits 直接假；同位字符不同就记一次错并让短串追一步。
 */
export function isWithinEdits(a: string, b: string, maxEdits: number): boolean {
  if (Math.abs(a.length - b.length) > maxEdits) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > maxEdits) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  // 收尾剩下的就是尾部逐字插入/删除（循环退出时必有一侧耗尽，剩余全在同一侧，
  // 每个字符各算一次编辑；尾部整段删除两个字符就是两次编辑，不是一次）。
  edits += a.length - i + (b.length - j);
  return edits <= maxEdits;
}

export interface FuzzyHit {
  /** 命中窗口 [start, end)，落在原行上（不是小写化后的副本上）。 */
  start: number;
  end: number;
}

/**
 * 在一行里找第一个「与 query 至多差一字」的窗口（窗口长取 query 长度的 -1/0/+1 三档，
 * 覆盖插入、删除、替换三种错法）。找不到回 null。
 *
 * 三档按**降序**扫（len+1 → len → len-1）：长窗带足上下文、优先命中；若升序扫，
 * len-1 档会让「林潮」这种纯前缀抢先命中「林潮生」，错字窗口被切短还制造噪声。
 * 行是搜索的基本单位、长度有限，三档滑窗整扫是 O(len·L)——只在精确零命中后跑，够快。
 */
export function fuzzyFindInLine(line: string, query: string): FuzzyHit | null {
  const length = query.length;
  if (length === 0) return null;
  for (let window = length + 1; window >= length - 1; window -= 1) {
    if (window <= 0) continue;
    for (let start = 0; start + window <= line.length; start += 1) {
      if (isWithinEdits(line.slice(start, start + window), query, 1)) {
        return { start, end: start + window };
      }
    }
  }
  return null;
}

/** 这一轮查询要不要启用容错（空串与超长查询都不启用）。 */
export function fuzzyEligible(query: string): boolean {
  return query.length > 0 && query.length <= FUZZY_QUERY_MAX_CHARS;
}

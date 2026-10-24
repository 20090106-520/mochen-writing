/**
 * 网搜来的结果 → 素材卡（2026-10-24）。
 *
 * 【为什么抽成纯函数且带单测】卡片标题来自**别人写的网页**，而它会被拿去当文件名与
 * frontmatter 的 title（`importTxtCommit` 走 `planDocRelPath`）。所以三件事必须在纯函数里定死：
 *
 * ① **长度收口**：搜索结果的标题动辄三四十字，还有整句带副标题的——树里那一行撑不住；
 * ② **文件名安全**：网页标题里常有 `：` `?` `|` 这些 Windows 不许进文件名的字符。
 *    判定住在 contracts 的 `sanitizeDocFileName`（唯一一份），这里**直接引它**——
 *    自己另抄一份就会出现「面板看着干净、落盘时才报错」的错位，而那句报错还要求用户
 *    「改好标题再导」，而这个界面上根本没有改标题的地方：那是死路。
 * ③ **正文里必须留下出处**：素材最容易腐坏的地方就是「过几天没人知道这行字是从哪抄的」。
 *    收录日期也一并写下来——网页会烂，读者要能判断它有多旧。
 *
 * 撞名（书里已有同名文稿）不在这里判：那是导入那条通路的语义，它回一句「改好标题再导」，
 * 同样是个死路。面板那条路的解法是**自动改名重试**（`materialCardTitleVariant`），
 * 不覆盖已有内容，也不把用户堵在一条没有出口的提示上。
 */
import { sanitizeDocFileName } from "@mochen/contracts";
import type { MaterialsSearchHit } from "@mochen/contracts";

/** 卡片标题上限：够放下一句完整标题，又不至于把文稿树那一行撑爆。 */
export const MATERIAL_CARD_TITLE_MAX = 60;

/** 空标题的兜底名字：宁可叫「网上搜到的素材」，也不要落一篇没有名字的文稿。 */
export const MATERIAL_CARD_FALLBACK_TITLE = "网上搜到的素材";

export function materialCardTitle(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat === "") return MATERIAL_CARD_FALLBACK_TITLE;
  const capped =
    flat.length <= MATERIAL_CARD_TITLE_MAX ? flat : `${flat.slice(0, MATERIAL_CARD_TITLE_MAX)}…`;
  // 保留名（CON / NUL 之类）过不了 sanitizeDocFileName——那种名字落不了盘，
  // 与其让写入那一步报错（而这一层没有改标题的地方），不如就地换成兜底名。
  const safe = sanitizeDocFileName(capped);
  return safe === null || safe === "" ? MATERIAL_CARD_FALLBACK_TITLE : safe;
}

/**
 * 撞名时的改名：加一个序号后缀（`（2）`、`（3）`……），**绝不覆盖已有内容**——
 * 这是导入那条通路一直守着的那句承诺，这里换一种不让人无路可走的做法兑现它。
 */
export function materialCardTitleVariant(base: string, attempt: number): string {
  const n = Math.max(1, Math.trunc(attempt));
  const suffix = `（${n + 1}）`;
  // 后缀也得算进长度上限里——不然「标题（2）」反而比标题还长。
  const room = Math.max(1, MATERIAL_CARD_TITLE_MAX - suffix.length);
  const head = base.length > room ? base.slice(0, room) : base;
  const safe = sanitizeDocFileName(`${head}${suffix}`);
  return safe === null || safe === "" ? `${MATERIAL_CARD_FALLBACK_TITLE}${suffix}` : safe;
}

/** 抓回来的那一页正文（`materialsFetch` 的回执里那一份）。 */
export interface MaterialCardPage {
  text: string;
  /** 只取了前面一段（不是全文）。素材里必须写明这一点，否则读者会当成全文引用。 */
  truncated: boolean;
}

/**
 * 卡片正文：出处 + 收录日期 + 内容。
 *
 * 内容按**手上有什么**分三档写，不含糊：
 * - 抓到正文 → 写正文，并注明「只取了前面一段」（截断时）；
 * - 只有摘要 → 写摘要，并**如实说正文没取到**（读者才知道自己手上的是纸片）；
 * - 两样都没有 → 什么都不编，只指出下一步（打开上面的链接）。
 */
export function materialCardBody(
  hit: MaterialsSearchHit,
  at: string,
  page?: MaterialCardPage
): string {
  const lines = [`来源：${hit.url}`];
  if (at !== "") lines.push(`收录：${at}`);
  const text = page?.text ?? "";
  if (text !== "") {
    lines.push(
      "",
      page?.truncated === true
        ? "（下面是这一页的正文，太长了，只取前面一段。）"
        : "（下面是这一页的正文。）",
      text
    );
  } else if (hit.snippet !== "") {
    lines.push("", "（搜索源只给了摘要，正文没取到——打开上面的链接自己看一眼。）", hit.snippet);
  } else {
    lines.push("", "（这一条什么也没给——打开上面的链接自己看一眼。）");
  }
  return lines.join("\n");
}

/** 收录日期按 `YYYY-MM-DD` 记（本地时区），够人判断新旧，又不带一堆没用的时分秒。 */
export function materialCardStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 来源站点（给人看的那一眼）：只取主机名，去掉 `www.` 前缀。
 * 解析不出来就返回空串——**不编一个站点名**，宁可空着。
 */
export function materialCardHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

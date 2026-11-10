/**
 * 这段字是不是以中文为主（2026-11-10）。
 *
 * 【为什么需要】思考摘要那一格折叠时会露一行正文（批次 5-⑭ 加的：三行纯标签信息量为零，
 * 看着像卡住）。可模型的推理常常是英文——真机上那条是
 * 「The user is greeting me with 你好…」。露出来就是一屏英文，用户说
 * 「输出的东西全是中文」，有一半是在说它。
 *
 * 提示词那头已经要求用中文思考（`DIALOGUE_REPLY_INSTRUCTION` 第 ⑥ 条），
 * 但**存量消息改不回来**，所以折叠预览这一处按语种决定露不露。
 *
 * 【为什么不翻译】渲染层不编造内容：原文一个字不改，只是不让它占据折叠态的第一行。
 * 展开后照样看得到完整原文，信息一点没丢。
 */

const CJK = /[\u3400-\u9fff]/gu;

/**
 * 非空白字符里中文占三成以上。阈值取 0.3 而不是 0.5：
 * 「他点开 outline/大纲.md 看了一眼」这种夹杂着路径的中文句子，中文占七成；
 * 而英文句子里偶尔引用一个中文词，占比个位数——两边都离 0.3 很远，阈值不敏感。
 */
export function isMostlyChinese(text: string, threshold = 0.3): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length === 0) return false;
  const cjk = (text.match(CJK) ?? []).length;
  return cjk / compact.length >= threshold;
}

/**
 * 叙述人称读数（2026-11-15）：数一数这本书**叙述部分**（引号外）里的第一／第三人称代词。
 *
 * 【为什么值得单开一格】既有十段动态读数没有一段在读「叙述用第几人称」。AI 连写多章时最刺眼的一种
 * 断裂，是第三人称的书里忽然整段用「我」讲——不是人物开口（那在引号里），是叙述本身换了人。
 * 句长、标点、段长、五感都量不到这一层。
 *
 * 【只数代词，不猜视角】真正的叙事视角要读叙述距离与信息落差（§一百零五 取舍），那要语义判断。
 * 代词计数是**代理读数**：它只说明「叙述里出现了多少个『我』、多少个『他/她/祂/它』」，
 * 不宣布「本书是第一人称小说」。人名会替代第三人称代词，所以 `third` 天然是**下界**。
 *
 * 【为什么要先剥引号】人物说的话里「我」满篇都是；不剥，一本第三人称书只要对白多，
 * 就会被读成第一人称。剥引号走 `dialogue.ts` 的 `narrationOf`（引号配对的唯一实现）。
 */
import { narrationOf } from "./dialogue.js";
import { STYLE_PROFILE_MIN_CHARS } from "./style-profile.js";

/** 第一人称代词：单字数。「我们」「咱们」各计 1 次（数的是代词出现，不是字数）。 */
const FIRST_PERSON = /[我咱]/g;

/**
 * 第三人称代词：单字数。「其他」「其它」里的「他/它」不是人称代词，用负向后顾排除。
 * 注：人名（「林夜」「阿雾」）承担了多数第三人称指代，所以这个数是下界，不是全量。
 */
const THIRD_PERSON = /(?<!其)[他她祂它]/g;

export interface NarrationPerson {
  /** 叙述（引号外）里第一人称代词的出现次数。 */
  first: number;
  /** 叙述里第三人称代词的出现次数（下界：人名不计入）。 */
  third: number;
  /** 两数比较的结果；两数都是 0 时为 "none"。 */
  dominant: "first" | "third" | "tie" | "none";
}

/**
 * 从各章正文量一份叙述人称读数。contents 是各章正文（按文档顺序）。
 *
 * 样本门槛与腔调档案同一枚：叙述非空白字数不足 `STYLE_PROFILE_MIN_CHARS` 返回 null——
 * 「样本不够」不是「这本书没有人称」，报一份 0/0 会让模型以为叙述里一个代词都没有。
 */
export function narrationPersonOf(contents: readonly string[]): NarrationPerson | null {
  return narrationPersonOfText(narrationOf(contents.join("\n")));
}

/**
 * 直接从**已剥好的叙述文本**数（2026-11-16 合并全书扫描）：生成端已经用 `scanQuoted`
 * 拿到叙述原文时，不必再对它跑一遍引号扫描。门槛与 `narrationPersonOf` 完全一致。
 */
export function narrationPersonOfText(narration: string): NarrationPerson | null {
  if (narration.replace(/\s+/g, "").length < STYLE_PROFILE_MIN_CHARS) return null;
  const first = narration.match(FIRST_PERSON)?.length ?? 0;
  const third = narration.match(THIRD_PERSON)?.length ?? 0;
  return { first, third, dominant: dominantOf(first, third) };
}

function dominantOf(first: number, third: number): NarrationPerson["dominant"] {
  if (first === 0 && third === 0) return "none";
  if (first === third) return "tie";
  return first > third ? "first" : "third";
}

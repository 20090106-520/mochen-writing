/**
 * 系统提示里「上下文包」这一段的拼装（2026-11-10，从 agent-service.ts 为 800 行预算拆出）。
 *
 * 拆法与 agent-session-read / turn-context / agent-context-preview 同款：这里只做**纯字符串拼接**，
 * 不读书、不跑 turn、不碰状态，所以搬走不新增第二份判据。
 *
 * 【为什么这三段合成一串】P0-3 起 token 要按三路分（系统提示 / 上下文包 / 历史），
 * 上下文包必须能单独量一格。条目正文、技能清单提示、技能库索引三者都随「这次装配了什么」变化，
 * 归在同一格，预算判据才只有一处。
 *
 * 【2026-11-10 多了【技能库】】只摆已挂入的那几枚，模型根本不知道库里还有什么，
 * 「按需自己调用技能」实际退化成了「用手挑」。这一段把整库摊开（只列名字与一句说明，
 * 正文仍由 use_skill 现读），模型才可能自己决定读哪一份。
 */
import type { BookDigest, SkillIndexResult } from "@mochen/contracts";

/**
 * 「标注技能的那些其实只是清单」这句提醒（2026-11-12 从 agent-service 搬来）。
 *
 * 【为什么只在这里说一次】技能的读法原先是**每行清单行尾各缀一遍**（「正文未载入，需要时用
 * use_skill 读取」）——挂 12 条就是同一句制式话在提示词里出现 12 遍。模型读到的是一段复读机，
 * 正是它最擅长模仿的形状；而写小说时的模板腔，有一半是从提示词自己的复读里学去的。
 * 现在清单行只说「这一条是什么」（`skillBriefLine`），读法由这一句统一交代。
 *
 * 【为什么强调 id】清单行带 id（`名称（id）：说明`），照抄它调 `use_skill` 就行；
 * 只说「用 use_skill」不给形状，模型会自己编一个参数名。
 */
export const SKILL_HINT =
  "上面标注「技能」的那些条目只是清单（名称、id、用途与适用面），正文没有载入；" +
  '要按其中一份方法动笔，先用 use_skill("<id>") 读出全文，别凭名字猜它的做法。';

/**
 * 有自动预读时的那一句（2026-11-17）。
 *
 * 【为什么不复用上面那句】预读段已经把榜首的正文整份递过去了，再说「正文没有载入」
 * 就会和下一段自相矛盾——模型读到「没载入」会去 use_skill 再读一遍，白烧一轮。
 * 两句话住同一处（本文件），改口径时不会只改一半。
 */
export const SKILL_HINT_WITH_PRELOAD =
  "上面标注「技能」的条目里，除下面【本轮自动预读】那一份外都只是清单（名称、id、用途与适用面）；" +
  '要按其余某一份方法动笔，先用 use_skill("<id>") 读出全文，别凭名字猜它的做法。';

/** 自动预读回来的正文（与 turn-context 的 `PreloadedSkill` 同形，避免 main 内多一份拷贝）。 */
export interface PreloadedSkillBlock {
  title: string;
  text: string;
  clipped: boolean;
}

/**
 * 全书状态卡那一段（2026-11-20）。
 *
 * 【为什么单独一段、放在最前】它回答的是「故事到哪儿了、谁现在什么处境」，
 * 不属于「这一轮装配了哪些文稿」的条目清单，却每轮都该看见。放最前面，
 * 模型先拿到全局，再读本章与前情，不容易把已经发生的事当成新起点。
 *
 * 【为什么空值整段不出现】老书没生成过状态卡、或后台那次失败了，都该保持
 * 与升级前逐字一致的提示词，而不是留一个空标题让人以为漏装了内容。
 */
export function bookDigestBlock(digest: BookDigest | null | undefined): string {
  if (digest === undefined || digest === null) return "";
  const summary = digest.summary.trim();
  if (summary === "") return "";
  const lines = ["【全书摘要与人物状态】", `一句话：${summary}`];
  const cast = digest.cast.trim();
  if (cast !== "") lines.push("人物：", cast);
  return lines.join("\n");
}

export interface ContextPackInput {
  /** `renderContextBlock` 的产物；空串＝这一轮没有可装的条目。 */
  contextBlock: string;
  /** 「标注技能的那些只是清单，正文没载入」那句提醒；没有技能条目时是空串（见 `SKILL_HINT`）。 */
  skillHint: string;
  /** 技能库里没挂入的那些（`skillIndexBlock` 的结果）。 */
  skillIndex: SkillIndexResult;
  /**
   * 自动预读的唯一榜首正文（2026-11-17）。null / 缺省 = 这一轮没预读，
   * 整段不出现——不是写一个空标题。
   */
  preload?: PreloadedSkillBlock | null;
}

/**
 * @param digest 全书滚动状态（2026-11-20）。空 / 缺省 = 这一轮没有状态卡，整段不出现。
 *   作为第二个参数而不是 `ContextPackInput` 的一格：调用方只有 agent-service 一处，
 *   放进来会把那行调用撑成七行（800 行预算贴着线）。
 */
export function buildContextPack(
  input: ContextPackInput,
  digest?: BookDigest | null | undefined
): string {
  const parts: string[] = [];
  // 状态卡放最前：它是全局定位，先于「这一轮装进来的条目」。
  const digestBlock = bookDigestBlock(digest);
  if (digestBlock !== "") parts.push(digestBlock);
  if (input.contextBlock !== "") {
    parts.push(`【已装配的上下文】\n${input.contextBlock}`);
    if (input.skillHint !== "") parts.push(input.skillHint);
  }
  // 预读段紧跟技能清单：模型刚看到「这一轮该用哪一份」，下一眼就是它的方法全文。
  // 截断必须如实说：读到半份方法却以为读全了，比没读更危险。
  const preload = input.preload ?? null;
  if (preload !== null) {
    const body = preload.clipped
      ? `${preload.text}\n（正文过长，已截断；需要全文用 use_skill 重新读。）`
      : preload.text;
    parts.push(`【本轮自动预读的技能：${preload.title}】\n${body}`);
  }
  // 技能库索引**不挂在**上下文那一段下面：它不是「这一轮装进来的东西」，
  // 而是「库里还有什么」。空串时不写标题——留一个空标题比不写更让人以为漏了内容。
  if (input.skillIndex.text !== "") parts.push(`【技能库】\n${input.skillIndex.text}`);
  return parts.length === 0 ? "" : `\n\n${parts.join("\n\n")}`;
}

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
import type { SkillIndexResult } from "@mochen/contracts";

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

export interface ContextPackInput {
  /** `renderContextBlock` 的产物；空串＝这一轮没有可装的条目。 */
  contextBlock: string;
  /** 「标注技能的那些只是清单，正文没载入」那句提醒；没有技能条目时是空串（见 `SKILL_HINT`）。 */
  skillHint: string;
  /** 技能库里没挂入的那些（`skillIndexBlock` 的结果）。 */
  skillIndex: SkillIndexResult;
}

export function buildContextPack(input: ContextPackInput): string {
  const parts: string[] = [];
  if (input.contextBlock !== "") {
    parts.push(`【已装配的上下文】\n${input.contextBlock}`);
    if (input.skillHint !== "") parts.push(input.skillHint);
  }
  // 技能库索引**不挂在**上下文那一段下面：它不是「这一轮装进来的东西」，
  // 而是「库里还有什么」。空串时不写标题——留一个空标题比不写更让人以为漏了内容。
  if (input.skillIndex.text !== "") parts.push(`【技能库】\n${input.skillIndex.text}`);
  return parts.length === 0 ? "" : `\n\n${parts.join("\n\n")}`;
}

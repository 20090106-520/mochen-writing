import {
  WEB_SEARCH_TOOL_NAME,
  WORK_MODE_LABELS,
  type AgentProfile,
  type DocRef
} from "@mochen/contracts";
import type { AssembledContext } from "@mochen/agent-runtime";

/**
 * 提示词装配（2026-10-08 从 agent-service.ts 拆出）。
 *
 * 拆的理由只有一个、而且是硬的那种：agent-service.ts 贴着 800 行的行数预算
 * （tools/check-source-line-budget.mjs，超限门禁直接红）。这里放的是「把一轮的现场
 * 排成一段人读的话」那半件事，跟服务编排（跑 turn、管会话、裁决提案）没有共享状态，
 * 分开后两边都能各自长大。approval-read.ts、plugin-host.ts 是为同一道预算拆出去的。
 */

/** 装配一段系统提示词需要的全部现场——少任何一项都会拼出一段说错话的提示词。 */
export interface PromptContext {
  title: string;
  stageName: string;
  chapter: DocRef | null;
  permissionLabel: string;
  /** 工作模式（2026-10-05 批次 4）：`plan` 时追加「先讲打算，别动稿」那一段。 */
  workModeLabel: string;
  /** 解析出来的智能体档案（spec §5.1）。它的 prompt 决定这一轮的人设与写入范围上限。 */
  profile: AgentProfile;
  /** 装配好的上下文包（正文已切片）。渲染成提示词块的那一份。 */
  context: AssembledContext;
  /**
   * 这一轮联网搜索开关（2026-10-08）。
   *
   * 提示词必须跟着它走：关掉时出站 tools 里根本没有 `web_search`（映射在 wireToolsFor），
   * 再教模型「联网搜索用 web_search」就是让它去调一枚不存在的工具，换来一句「没有这个工具」。
   */
  webSearchEnabled: boolean;
}

/**
 * 计划模式那一段的措辞（2026-10-05 批次 4）。
 *
 * 为什么要单独一段而不是只靠 writeVerdict 拦：闸只在**模型已经想动手**的时候才拦得住，
 * 而模型是看不到闸的。不先告诉它「这一轮别动稿」，它会照常起草再吃一个拒，
 * 然后换个写法重试几轮——白白烧 token，还把对话搅浑。
 *
 * 这段话的落点必须是**可批准的东西**：改哪几篇、每篇改什么、为什么。
 * 只说「别写」模型会转而输出一段散文式的建议，用户批不了。
 */
export const PLAN_MODE_INSTRUCTION =
  "这一轮是「先计划」：不要写入、不要提改动方案，只把打算讲清楚——" +
  "要改哪几篇文稿、每一篇具体改什么、为什么这么改，以及有没有你不确定的地方。" +
  "用编号列出，等用户批准后才会真正落盘。";

/**
 * 联网那一段措辞（只在开关打开时进提示词）。
 *
 * 工具名从 contracts 的 `WEB_SEARCH_TOOL_NAME` 拼，不手抄字符串：提示词里教的名字和
 * 出站 tools 里那枚 function 的名字必须是同一个真身，否则模型照着提示词调一枚不存在的工具。
 */
export const WEB_SEARCH_INSTRUCTION =
  `联网搜索用 ${WEB_SEARCH_TOOL_NAME}（免费源）：query 用 2–4 个关键词（例：「漕运制度」「科幻 黑暗森林 设定」），` +
  "别把整句问题原样塞进去——源只认开头的词，整句会被拆成词义查询，回来的资料跟问题对不上。" +
  "搜到的资料要保存时，整理成文稿写进 materials/ 或 skills/。";

/**
 * Plan 2 的临时装配：只带作品名、阶段名、当前文稿与权限档。
 * Plan 3 起在末尾接上「档案提示词 + 上下文包」——spec §5 的上下文包（#6 档案线）由
 * agent-runtime 的 assembleContext 装，本函数只负责把它排成一段人读的话。
 */
export function defaultPromptFor(context: PromptContext): string {
  return [
    "你是墨宸 AI 的写作智能体，在用户本地的一本书上工作，能直接操控这本书的资料库。",
    // 档案先说：人设与写入范围上限都出自它（spec §5.1）。
    context.profile.prompt,
    `当前作品：《${context.title}》；创作阶段：${context.stageName}；` +
      `当前文稿：${context.chapter?.relPath ?? "（用户还没打开文稿）"}。`,
    `权限档：${context.permissionLabel}。提案只有在用户批准后才写入磁盘。`,
    // 工作模式：只在「先计划」时多这一段。动手模式不摆它——摆一句「你可以直接写」
    // 反而像在鼓励它动手，而那本来就是默认行为，不需要叮嘱。
    ...(context.workModeLabel === WORK_MODE_LABELS.plan ? [PLAN_MODE_INSTRUCTION] : []),
    "书稿共 12 类，目录即类型：chapters/章节、volumes/分卷、outline/大纲、worldview/世界观、" +
      "characters/人物、factions/势力组织、locations/地图、timeline/时间线、plot/剧情、" +
      "materials/素材库、glossary/专有名词、skills/技能库。",
    "用户让你生成或补全世界观、人物、设定等内容时，直接用 write_doc 写进对应目录" +
      "（如 worldview/北境.md），文件名用简短中文标题；用户批准后左侧文稿树会自动出现。",
    // 联网段跟着开关走：关掉时这枚工具根本不出站，留着这段就是教模型调一枚不存在的工具。
    ...(context.webSearchEnabled ? [WEB_SEARCH_INSTRUCTION] : []),
    "改动已有文稿用 propose_patch（给 doc/anchor/replace/why），整篇新建或重写用 write_doc。",
    "anchor 必须是文中逐字存在且唯一出现的片段；不确定就先 read_doc。",
    "只读档下不要承诺写入。"
  ].join("\n");
}

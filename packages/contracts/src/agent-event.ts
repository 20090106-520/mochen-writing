import { z } from "zod";
import type { DraftReading } from "./draft-rank.js";
import { draftSampleCountSchema } from "./draft-rank.js";
import { editProposalSchema, PROPOSAL_DECISIONS } from "./patch.js";
import { thinkingLevelSchema } from "./per-run.js";
import { SKILL_PATH_MAX_LEN, skillPathsSchema } from "./skill.js";

const id = z.string().min(1);
const ts = z.string().min(1);
const turn = { id, ts, turnId: id };

export const AGENT_EVENT_TYPES = [
  "user-message",
  "reasoning",
  "plan",
  "message",
  "tool-call",
  "proposal",
  "decision",
  "written",
  "interrupted",
  "error",
  "usage"
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const sessionMetaSchema = z.object({
  type: z.literal("session-meta"),
  sessionId: id,
  docRelPath: z.string().min(1),
  stageId: z.string().min(1),
  model: z.string().min(1),
  startedAt: ts
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;

/**
 * 一条联网搜索的来源（2026-10-06 批次 5-⑨）。
 *
 * 为什么是结构化的一条独立字段，而不是从 `resultText` 里把 URL 抠出来再拼：
 * 那是把「这轮搜了谁」这件事在渲染层**第二次**猜一遍。回执文本是人读的排版，改个版式
 * 抠出来的链接就全错；来源是数据，就该一路带着走。url 只收 http/https——这是要交给
 * 渲染层去点开的地址，不是随便什么 scheme。
 */
export const webSourceSchema = z.object({
  title: z.string(),
  url: z.string().regex(/^https?:\/\//),
  snippet: z.string()
});
export type WebSource = z.infer<typeof webSourceSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...turn, type: z.literal("user-message"), text: z.string() }),
  z.object({ ...turn, type: z.literal("reasoning"), text: z.string(), interrupted: z.boolean() }),
  z.object({
    ...turn,
    type: z.literal("plan"),
    items: z.array(z.object({ text: z.string().min(1), done: z.boolean() })).min(1)
  }),
  z.object({ ...turn, type: z.literal("message"), text: z.string(), interrupted: z.boolean() }),
  z.object({
    ...turn,
    type: z.literal("tool-call"),
    callId: id,
    // 【2026-10-07 批次 5-㉘：改成钉新形状】原来是 z.enum(AGENT_TOOL_NAMES)。
    // 插件注册进来的工具名**运行时才知道**，枚举装不下它们，于是这一轮事件根本发不出去。
    // 保证没变小的部分：派发前仍然过 `isCallableTool`——花名册那五个照旧是闭集，
    // 不在闭集里、又没被任何插件注册的名字，仍然被中文回执拒掉（见 tool-loop）。
    // 也就是说「叫不叫得动」这道闸没有松，只是闸后面的名单从 5 个变成 5 + N 个。
    tool: z.string(),
    args: z.string(),
    ok: z.boolean(),
    resultText: z.string(),
    // 只有 web_search 会带：那一轮搜到的来源（标题/链接/摘要）。可选，老会话里没有这个字段。
    sources: z.array(webSourceSchema).optional(),
    // 跑通了但没东西可给（2026-10-06 批次 5-⑮）。只有 web_search 会带，老会话里没有。
    // 刻意**不**并进 ok：ok 答的是「有没有出错」，而「源都能用、只是没搜着」不是错。
    empty: z.boolean().optional()
  }),
  z.object({ ...turn, type: z.literal("proposal"), proposal: editProposalSchema }),
  z.object({
    ...turn,
    type: z.literal("decision"),
    proposalId: id,
    decision: z.enum(PROPOSAL_DECISIONS),
    guidance: z.string(),
    auto: z.boolean()
  }),
  z.object({
    ...turn,
    type: z.literal("written"),
    proposalId: id,
    docRelPath: z.string().min(1),
    fingerprint: z.string().min(1),
    backupRelPath: z.string().nullable()
  }),
  z.object({ ...turn, type: z.literal("interrupted"), pendingProposals: z.number().int().min(0) }),
  /**
   * 错误事件。`proposalId` 只在「这条提案已经确定失效」的三处出现（指纹不符 / 锚点不唯一 /
   * 写盘撞指纹）：那三处 pending 已删，卡上的状态必须随回放存活（缺陷③）。
   * 权限挡下与读盘失败**刻意不带**——提案还在待审队列里，标了就是谎报失效。
   *
   * 这条同时是**所有「轮级事实」的唯一上屏通路**（2026-10-12 收口 P1-3 的另一半）：
   * 历史被切掉多少条那句「更早的 N 条没有发给模型（约 M 字）。」就挂在这里，
   * 而不是像原先设想的那样另发一条 `history-truncated` 事件。为什么：
   * ① 截断发生在**发请求之前**，而 `turn-end.message` 只在 `status==="failed"` 时才被界面摆出来
   *    （见 useAgentStore 的 turn-end 分支），挂在那儿等于「只有失败才看得见」——
   *    正常回答完的一轮，用户永远不知道模型其实没读过前十轮；
   * ② 句子与数字只有 `historyNotice` 那一份（铁律 6），主进程切窗与 runtime 兜底切窗说的是同一句话；
   *    再开一个事件类型就是第二种说法。而它在本仓**没有任何消费方**：渲染层 utils/agent-thread.ts:160
   *    拿 `AGENT_EVENT_TYPES` 这张白名单拦陌生类型，那张表 10 种里从来不含它——
   *    真发出来只会得到一句「无法识别的智能体事件类型」，那句该给人看的截断话就此消失。
   * 删除本枚枚举不存在回放风险：它在本仓**任何一版可发布的形态下都没被发出过**
   * （runtime 切窗与主进程先切窗是同一个提交 `b1fc79a` 落地的，此后主进程只递切好的那一段）。
   */
  z.object({
    ...turn,
    type: z.literal("error"),
    message: z.string().min(1),
    proposalId: id.optional()
  }),
  /**
   * 本轮 token 用量（2026-10-15）。
   *
   * 【为什么不挂在 error / message 上】那是两个不同的事实：error 答「这一轮有没有出错」，
   * message 是模型正文；用量答「这一轮烧了多少 token」。塞进任何一方都会让回放与消费方
   * 多一条「顺便读一下某字段」的隐式契约，而它需要 requests/reported 两个计数，
   * 单靠一个字符串字段装不下。
   *
   * 【三枚数是什么】只有**上游回过用量的那几次请求之和**。没回报的那几次**不估算、不补零**：
   * `reported < requests` 就是「有几发上游没给数」这件事本身，如实说出来，绝不拿两个数凑第三个。
   *
   * 【requests / reported 的语义】requests = 这一轮发了几次请求（连接期失败也算发过一次）；
   * reported = 其中几次上游回了用量。reported === 0 时**不发**这枚事件（runTurn 只在其 >0 时发）
   * ——让失败轮/打断轮不往时间线上刷一行「用量」噪音。
   *
   * 【进不进模型历史】不进。`rollout.ts` 的 `eventsToMessages` 有 default 分支天然忽略它；
   * `agent-thread.ts` 的 `malformedPush` 读 AGENT_EVENT_TYPES 自动放行。两处都不用改。
   */
  z.object({
    ...turn,
    type: z.literal("usage"),
    requests: z.number().int().min(0),
    reported: z.number().int().min(0),
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0)
  })
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const AGENT_DELTA_KINDS = ["reasoning", "message"] as const;
export type AgentDeltaKind = (typeof AGENT_DELTA_KINDS)[number];
export const TURN_END_STATUSES = ["done", "interrupted", "failed"] as const;
export type TurnEndStatus = (typeof TURN_END_STATUSES)[number];

/** 主进程 → 渲染层的唯一外发载荷；delta 不落盘，event 已落盘。 */
export type AgentOutbound =
  | { type: "turn-start"; turnId: string; threadKey: string }
  | {
      type: "delta";
      turnId: string;
      threadKey: string;
      deltaKind: AgentDeltaKind;
      text: string;
    }
  | { type: "event"; turnId: string; threadKey: string; event: AgentEvent }
  | {
      type: "turn-end";
      turnId: string;
      threadKey: string;
      status: TurnEndStatus;
      message: string;
    }
  /**
   * 多稿采样收尾时把 N 稿摆给用户的那一枚（P0-②，2026-10-19）。
   *
   * 【为什么是一枚**仅在途**载荷而不是事件】它不是这一轮发生过的「事实」，而是
   * 「接下来等着你选」的**暂存态**：稿子还在主进程内存里，一个字都没落盘、也不进模型历史。
   * 所以它不进 `AGENT_EVENT_TYPES`（那张表是**要落盘**的事件名册），
   * 也不进 `agentEventSchema`——它是 `AgentOutbound` 的一个变体，只走推送通道。
   *
   * 【渲染层必须认得它】`utils/agent-thread.ts` 的 `malformedPush` 拦陌生推送类型，
   * 少一个 `case "candidates"` 就会当场报「未知推送类型」——候选面板一个字都显示不出来。
   *
   * 【落选稿的去处】`drafts` 全量摆出来（含每稿的读数），用户点一稿才走落盘，
   * 点「丢弃」则连集一起删——不自动择优落盘是用户裁定。
   */
  | {
      type: "candidates";
      turnId: string;
      threadKey: string;
      draftSetId: string;
      drafts: DraftCandidate[];
    };

/**
 * 一稿候选：`text` 是该稿的**新增正文**（该轮 `message` 正文 + 该轮提案的 `replace` 文本，
 * `\n\n` 相接），`reading` 是本仓 AI 味判据跑出来的读数（见 `contracts/draft-rank.ts`）。
 *
 * `text` 是给人看的预览，落盘与否由 `pickDraft` 按集里存的**原始事件**回放，不靠这段文本再解析一次。
 */
export interface DraftCandidate {
  /** 第几次生成（0 起算）；与 `reading.index` 同一个数。 */
  index: number;
  text: string;
  reading: DraftReading;
}

/**
 * userText 的上限。同一个数被三处用：这里的拒绝句、输入区的 `n/20000` 计数条、
 * 以及测试里的越界用例——写在两处就会差一，所以只住在这一处。
 */
export const USER_TEXT_MAX_LEN = 20000;

/**
 * 渲染层可控输入进入服务边界的校验（与 decideInputSchema 同层）：
 * 分工是「业务规则走事件，请求形状与上限走拒绝」——
 * 空/纯空白的 userText、空 threadKey（未打开文稿标签即 unbound 线程）都是合法业务态，
 * 由 agent-service 的优雅路径发中文事件 + turn-end{failed}，这里绝不挡；
 * 本 schema 只挡形状与上限：缺字段、类型不符、threadKey/userText/stageId 超长、
 * stageId 为空（装配处无对应的优雅分支），且每条错误都是用户看得见的中文。
 * 跨字段一致性（裁定 o）：空 threadKey 是「没打开文稿标签」的独立线程态，
 * 此时 docRelPath 必须为 null——否则有当前章的一轮会被塞进 unbound 会话桶，
 * 造成不同章共用同一份 JSONL 历史、session-meta 自述与提案所改文件互相打脸、
 * accept-session 的自动批准授权跨所有空 threadKey 复用。这类组合走中文拒绝。
 * 字段名与可选性和原 interface 一字不改——除了 #101 加的每轮两枚（thinkingLevel / webSearchEnabled），
 * 它们是新边界，从渲染层到主进程必须逐字同名，否则「开关按了但没送出去」在链路中间查不出来。
 */
export const startTurnInputSchema = z
  .object({
    threadKey: z.string().max(200, "会话线程标识过长（最多 200 字）"),
    /** null = 还没打开文稿标签，此时只能问不能改。 */
    docRelPath: z.string().nullable(),
    stageId: z.string().min(1, "创作阶段标识不能为空").max(200, "创作阶段标识过长（最多 200 字）"),
    userText: z.string().max(USER_TEXT_MAX_LEN, `输入内容过长（最多 ${USER_TEXT_MAX_LEN} 字）`),
    /**
     * 每轮开关，无默认值：缺字段就是渲染层忘了传，必须在边界上炸出中文，
     * 而不是悄悄按「关」发出去——那样真机上「开关坏了」和「用户没打开」就分不出来。
     */
    thinkingLevel: thinkingLevelSchema,
    webSearchEnabled: z.boolean({ error: "联网搜索开关必须是真或假" }),
    /**
     * 本轮显式挂入的技能（spec §11）。必填、无默认值：与两枚每轮开关同一条理由——
     * 缺字段就是渲染层忘了传，在边界上炸中文，比悄悄按「没挂技能」发出去好查得多。
     */
    skillPaths: skillPathsSchema,
    /**
     * 本轮自动预读正文的那一份技能 id（2026-11-17，可选）。
     *
     * 自动识别只在「榜首唯一领先」时传它，主进程据此把该技能**正文**注入系统提示，
     * 省掉「模型先 use_skill 再动笔」的一轮往返。可选：不传 ⇒ 与从前逐字一致
     * （用户手挂、并列第一、没命中都不预读）。
     *
     * 它必须同时出现在 `skillPaths` 里（渲染层保证）——预读只是给已挂入的某一枚
     * 多递一份正文，不是第二条挂入通路；主进程不为此再加一份交叉校验。
     */
    preloadSkillId: z.string().min(1).max(SKILL_PATH_MAX_LEN).optional(),
    /**
     * 本轮的采样稿数（P0-②）：1 = 关（行为一字不变），2 / 3 = 一轮里静默跑几稿。
     * **必填、无默认值**：与上两枚每轮开关同一条理由——缺字段就是渲染层忘了传，
     * 在边界上炸中文，比悄悄按「关」发出去好查得多。
     */
    sampleCount: draftSampleCountSchema,
    /**
     * 这一轮在工具面板里被关掉的工具名（2026-10-21，可选）。
     *
     * 用字符串而不是枚举：工具名还有插件注册进来的那一批，枚举表只在 agent-runtime 的花名册里。
     * 多余/不存在的名字由 runtime 按「不在本轮清单里」自然忽略，不必在这里逐条校验。
     */
    disabledTools: z.array(z.string().max(80, "工具名过长（最多 80 字）")).max(64).optional(),
    /**
     * 本轮临时移除的设定（2026-11-20 W-01 补完，可选）：值是 `bible:<类型>:<id>`。
     * 不传 ⇒ 与从前逐字一致（装配照常带入）。条目不存在 / 已被删掉的名字自然忽略，
     * 由装配层按「不在清单里」处理，这里不逐条校验。
     */
    excludedBible: z
      .array(z.string().max(160, "设定条目标识过长（最多 160 字）"))
      .max(200)
      .optional()
  })
  .superRefine((value, ctx) => {
    if (value.threadKey.trim() === "" && value.docRelPath !== null)
      ctx.addIssue({
        code: "custom",
        message: "没打开文稿标签时才算独立线程：会话线程为空就不能再指定文稿路径，两者不能同时给。",
        path: ["threadKey"]
      });
  });
export type StartTurnInput = z.infer<typeof startTurnInputSchema>;

export const decideInputSchema = z
  .object({
    proposalId: z.string().min(1, "提案标识不能为空"),
    decision: z.enum(PROPOSAL_DECISIONS),
    guidance: z.string()
  })
  .superRefine((value, ctx) => {
    if (value.decision === "deny-with-guidance" && value.guidance.trim() === "")
      ctx.addIssue({
        code: "custom",
        message: "拒绝并说明时必须写清该怎么改",
        path: ["guidance"]
      });
  });
export type DecideInput = z.infer<typeof decideInputSchema>;

/**
 * 选用某一稿的入参（P0-②）。`draftSetId` 是那一轮候选集的句柄，`index` 是第几稿（0 起算）。
 *
 * 只递这两个——**不许递正文**：落盘走的是集里存的原始事件（消息 + 提案），
 * 让渲染层再把正文递回来就等于把「盘上写什么字」交给渲染层决定，那是第二种写盘通路。
 */
export const pickDraftInputSchema = z.object({
  draftSetId: z.string({ error: "候选集标识不能为空" }).min(1, "候选集标识不能为空"),
  index: z.number({ error: "稿序号必须是整数" }).int("稿序号必须是整数").min(0, "稿序号不能是负数")
});
export type PickDraftInput = z.infer<typeof pickDraftInputSchema>;

/** 丢弃整集候选的入参（P0-②）：只递句柄，一个字节都不落盘。 */
export const discardDraftsInputSchema = z.object({
  draftSetId: z.string({ error: "候选集标识不能为空" }).min(1, "候选集标识不能为空")
});
export type DiscardDraftsInput = z.infer<typeof discardDraftsInputSchema>;

/**
 * 三条失败理由各配一句中文（**单一真身在这里**，渲染层照抄不得）。
 *
 * 为什么要分开说：三件事用户该做的完全不同——
 * `gone` 是这集已经作废（换过书、或同一集已被选/丢过），只能重发一轮；
 * `no-book` 是没开书，去打开一本书；`busy` 是这条线程上还有一轮在跑，等它收尾再点。
 * 压成一句「操作失败」会让人对着一个不知道该干什么的提示反复试。
 */
export const DRAFT_SET_FAIL_MESSAGES: Record<"gone" | "no-book" | "busy", string> = {
  gone: "这几稿已经不在了（可能已被选用、丢弃，或者中途换过书），重新发一轮吧。",
  "no-book": "还没打开作品目录，这一稿落不到任何地方。",
  busy: "这条线程上还有一轮在跑，等它结束再来选这一稿。"
};
export type DraftSetFailReason = keyof typeof DRAFT_SET_FAIL_MESSAGES;

/** 选用 / 丢弃的回执：成功只说成了，失败带三档理由与对应中文。 */
export type DraftSetResult =
  { ok: true } | { ok: false; reason: DraftSetFailReason; message: string };

export type DecisionResult =
  | {
      ok: true;
      docRelPath: string;
      fingerprint: string;
      backupRelPath: string | null;
      auto: boolean;
    }
  | {
      ok: false;
      reason: "permission-denied" | "stale" | "not-pending" | "cancelled" | "denied" | "io";
      message: string;
    };

/**
 * 重启后回放一条线程的取数结果（F-6 / spec §4.1）。
 * found:true 是「读到了」——即便 events 为空也算读到（确实没有历史的线程首行仍在）；
 * found:false 只有两种失败：没开书 / 这本书里没这条线程。首行坏不在此表达，
 * 那是 readSession 直接抛中文（spec §4.2 第 3 步），由 IPC 层透传、渲染层收成一条 notice。
 */
export const sessionLoadResultSchema = z.discriminatedUnion("found", [
  z.object({
    found: z.literal(true),
    relPath: z.string().min(1),
    meta: sessionMetaSchema,
    events: z.array(agentEventSchema),
    droppedLines: z.array(z.number().int().min(0))
  }),
  z.object({
    found: z.literal(false),
    reason: z.enum(["no-book", "no-session"]),
    message: z.string().min(1)
  })
]);
export type SessionLoadResult = z.infer<typeof sessionLoadResultSchema>;

/**
 * 会话线程键的「未绑定」哨兵（裁定 o：threadKey 恒等于 docRelPath，没开任何文稿标签时就是它）。
 *
 * 住在 contracts 而不是两边各写一份：主进程按 `threadKey === UNBOUND` 判「审批时没有当前章」，
 * 渲染层按它认「这一轮不属于任何文稿」。两侧是**同一个跨进程契约**——
 * 曾经各有一份 `const UNBOUND = "unbound"`，只靠渲染层那句「与主进程同名常量必须一致」维系，
 * 而那句注释里写的行号当场就漂了（写着 agent-service.ts:38，实际在 50 行）。注释不是类型系统。
 */
export const UNBOUND = "unbound";

/**
 * 书内会话总览的一行（#113e「历史对话」面板的数据源）。
 * 五个字段全部来自盘上真数据：前四个是 rollout 首行的 SessionMeta，title 是该文件里
 * **第一条** user-message 事件（折叠空白后截断）；这条会话一句用户输入都没有时为空串，
 * 不拿章名或模型名冒充标题。
 */
export const sessionListItemSchema = z.object({
  sessionId: id,
  /** 这条会话属于哪条线程：章节相对路径，或 UNBOUND（发轮时没开任何标签页）。 */
  docRelPath: z.string().min(1),
  model: z.string().min(1),
  startedAt: ts,
  title: z.string()
});
export type SessionListItem = z.infer<typeof sessionListItemSchema>;

import { defineStore } from "pinia";
import {
  nextThinkingLevel,
  type AgentEvent,
  type AgentOutbound,
  type DecideInput,
  type DecisionResult,
  type DraftCandidate,
  type DraftSampleCount,
  type ProposalDecision,
  type SessionListItem,
  type SessionLoadResult,
  type StartTurnInput,
  type ContextPreview,
  type ContextPreviewQuery,
  type SkillContent,
  type SkillRef
} from "@mochen/contracts";
import { SKILL_FILE_NAME, effectiveSkillIds, skillPolicyOf, splitSkillId } from "@mochen/contracts";
import {
  CLEAR_VIEW_SENTENCE,
  EMPTY_STREAM,
  ProposalView,
  ThreadView,
  UNBOUND,
  decisionViewPatch,
  enqueueText,
  malformedPush,
  newThread,
  pendingCountOf,
  plainList,
  purgeThreadProposals,
  reasonOf,
  runningSeconds,
  threadKeyFor
} from "../utils/agent-thread";
import { DRAFT_DISCARD_DONE, nextDraftSampleCount, resolveDraft } from "../utils/draft-candidates";
import { useBibleExclusionStore } from "./useBibleExclusionStore";
import { readRemote } from "../utils/agent-requests";
import { replayProposalStatuses } from "../utils/timeline";
import { type SlashCommand } from "../utils/slash-commands";
import { prefillText } from "../utils/composer-draft";
import { clearComposerAfterSend } from "../utils/auto-behavior-preference";
import { resumeAffordanceOf } from "../utils/turn-resume";
import { sessionRowAction, type SessionRowAction } from "../utils/session-row-action";
import { useAutoSkillStore } from "./useAutoSkillStore";
import {
  loadWebSearchDefault,
  saveWebSearchDefault,
  webSearchPreferenceStorage
} from "../utils/web-search-preference";
import {
  initialThinkingLevel,
  loadThinkingRemember,
  persistThinkingRemember,
  saveThinkingLevel,
  thinkingPreferenceStorage
} from "../utils/thinking-preference";
import { dispatchSlashCommand } from "./agent-slash-dispatch";
import { useAutoCheckupStore } from "./useAutoCheckupStore";
import { useBookStore } from "./useBookStore";

export * from "../utils/agent-thread";

export const useAgentStore = defineStore("agent", {
  state: () => ({
    threads: {} as Record<string, ThreadView>,
    /** 历史对话面板的数据源：这本书全部会话的一行概览（主进程按时间倒序给）。 */
    sessions: [] as SessionListItem[],
    /** 上下文占用条的数据源；null = 还没问过主进程（占用条不显形，不是「0 条」）。 */
    contextPreview: null as ContextPreview | null,
    /**
     * 技能库那张表（spec §11）。空数组 = 还没列过，与「列了但一个都没有」由 `skillsListed` 区分。
     */
    skills: [] as SkillRef[],
    skillsListed: false,
    /**
     * 线程级技能覆盖（P0-4）。**键在 = 本会话临时改过**（空数组也留着，表示「本会话明确一个都不挂」）；
     * 键不在 = 继承书级默认（`book.json` 的 `skillPolicy.enabled`）。覆盖只活在内存里，不写回书。
     */
    skillPathsByThread: {} as Record<string, string[]>,
    proposals: {} as Record<string, ProposalView>,
    notice: "",
    seconds: 0,
    /**
     * 中栏订阅的**唯一真身**：preload `onAgentEvent` 交回的那只退订函数。
     * 原先这里是一枚 `listening` 布尔，而布尔只决定「还要不要再注册」，**撤不掉已经注册的那一只**
     * ——台账 `README.md:12` Plan 2 遗留那条就是这么来的。改成存句柄之后，
     * 「挂没挂」与「怎么摘」用的是同一份判据，不可能各说一套。
     */
    agentEventOff: null as (() => void) | null,
    /** 同线程并发 ensureHydrated 合流到同一个 promise（Task 5 用；本任务先建位）。 */
    hydrateInflight: {} as Record<string, Promise<void>>,
    /** 输入框的值上收到的顶层 map（设计决定 3）：键是 threadKey，不进 ThreadView，切章不丢字。 */
    composerDrafts: {} as Record<string, string>,
    /**
     * 「这一轮发出去的是什么字」——只记用户亲手打的，不记「继续」的内置文案（那是机器的话，
     * 不该塞回用户的地盘）。真机上吞字走的是事件路径：主进程把三类 pre-flight 与 try 里的一切异常
     * 都转成 turn-end{failed}，startTurn 照样 resolve，所以 `.catch` 那条拒绝支到不了。
     * 判据是「该轮有没有发过 user-message」：发过 ⇒ 字已经在中栏转录里，绝不再回填成第二份。
     */
    pendingSend: {} as Record<string, string>,
    /** 两枚每轮开关（task #101）：描述「下一条请求长什么样」，住顶层不进 ThreadView，切章不换档。 */
    thinkingLevel: initialThinkingLevel(thinkingPreferenceStorage()),
    webSearchEnabled: loadWebSearchDefault(webSearchPreferenceStorage()),
    /** 「记住思考档」开关（设置页那枚）：默认关 = 原行为，切档不留痕。 */
    thinkingRemembered: loadThinkingRemember(thinkingPreferenceStorage()),
    /** 多稿档（P0-②）：1=关；**刻意不跨重启记忆**——它是 N 倍 token 成本的开关，每次启动回到关，与「联网/深度」两枚持久偏好是两条规矩。 */
    sampleCount: 1 as DraftSampleCount,
    /**
     * 工具面板里被关掉的工具（2026-10-21）。
     *
     * 从下一次请求起生效：主进程在 `toolsFor`（发给模型的 tools）与 `toolGateOf`（模型硬调时的闸）
     * 两处同时摘掉，所以关掉是真的不出站，不是只在界面上藏一行。
     * 与多稿档同一条规矩：**不跨重启记忆**——启动回到全带，免得某天忘了自己关过什么。
     */
    disabledTools: [] as string[],
    /** 多稿候选集（P0-②）：键是 threadKey；值里那几稿已由主进程按 rankDrafts 排好序，换轮/选稿/丢稿都会清掉它。 */
    draftSets: {} as Record<string, { draftSetId: string; drafts: DraftCandidate[] }>
  }),

  getters: {
    pendingOf:
      (state) =>
      (threadKey: string): number =>
        pendingCountOf(state.proposals, threadKey)
  },

  actions: {
    /**
     * 线程视图的唯一取处。新建时必须**回读** `this.threads[key]` 而不是返回手里的裸对象：
     * 写进 pinia state 的那份会被 Vue 包成响应式代理，裸对象与代理是「同一个 target、两套拦截」，
     * 拿着裸对象改字段真值是对的、依赖通知却一次不发。跨 await 握引用时最要命——建线程那次的
     * 通知被渲染帧消费掉后再写的值（hydrating / 回放 items）永久停在旧缓存，真机表现为占位卡在
     * 「正在恢复这一条线程…」（回归用例见 useAgentStore.hydrate.test.ts）。
     */
    viewOf(threadKey: string): ThreadView {
      const existing = this.threads[threadKey];
      if (existing) return existing;
      this.threads[threadKey] = newThread();
      return this.threads[threadKey];
    },

    /** 读某一格输入框的当前值；缺省空串（老状态从未写过草稿）。 */
    draftOf(threadKey: string): string {
      return this.composerDrafts[threadKey] ?? "";
    },

    setDraft(threadKey: string, value: string): void {
      this.composerDrafts[threadKey] = value;
      // 自动技能看的就是「输入框里正敲的字」：草稿一变，这一轮该挂谁跟着变。
      // 判据在 utils/skill-auto.ts，清单没变时 sync 一个字都不写（不会每敲一键就重渲染）。
      useAutoSkillStore().sync(threadKey);
    },

    /**
     * F-A 预填唯一入口：判定在 prefillText（一处实现）、写入只走 setDraft（一处写者），这里只负责「被挡时写一句中文」。
     * 被挡 = 已有非空草稿、预填没进去（prefillText 原样还回 current）。
     */
    prefillComposer(threadKey: string, value: string): void {
      const current = this.draftOf(threadKey);
      const next = prefillText(current, value);
      this.setDraft(threadKey, next);
      if (next === current && current.trim() !== "")
        this.notice = "输入框里已经有内容，预填没有覆盖你正在写的字。";
    },

    /** 发送成功后清这一格（残留会把上一句带进下一次输入）。 */
    clearDraft(threadKey: string): void {
      delete this.composerDrafts[threadKey];
    },

    /** 深度思考 chip：走一格（顺序表在 contracts 的 nextThinkingLevel）；记着档就顺手写记忆档。 */
    cycleThinking(): void {
      this.thinkingLevel = nextThinkingLevel(this.thinkingLevel);
      if (!this.thinkingRemembered) return;
      const storage = thinkingPreferenceStorage();
      if (storage !== null) saveThinkingLevel(storage, this.thinkingLevel);
    },

    /** 「记住思考档」开关（设置页）：落库真身 persistThinkingRemember（关掉连档位记忆一起清）。 */
    toggleThinkingRemember(): void {
      this.thinkingRemembered = !this.thinkingRemembered;
      const storage = thinkingPreferenceStorage();
      if (storage !== null) {
        persistThinkingRemember(storage, this.thinkingRemembered, this.thinkingLevel);
      }
    },

    /** 联网开关：切一格并顺手记住（记忆档住 utils/web-search-preference；无存储只切不记）。 */
    toggleWebSearch(): void {
      this.webSearchEnabled = !this.webSearchEnabled;
      const storage = webSearchPreferenceStorage();
      if (storage !== null) saveWebSearchDefault(storage, this.webSearchEnabled);
    },

    /** 多稿档循环（P0-②）：关 → ×2 → ×3 → 关；次序从 contracts 的 DRAFT_SAMPLE_COUNTS 现拼，不留第二份档位表。 */
    cycleDraftSample(): void {
      this.sampleCount = nextDraftSampleCount(this.sampleCount);
    },

    /**
     * 工具面板里切一枚（2026-10-21）：已关的点回「带上」，带着的点成「已关」。
     * 只改下一次请求的清单——正在跑的那一轮带出去什么，在它启动那一刻就定了。
     */
    toggleTool(name: string): void {
      this.disabledTools = this.disabledTools.includes(name)
        ? this.disabledTools.filter((item) => item !== name)
        : [...this.disabledTools, name];
    },

    /** 中栏唯一的订阅入口：装配处挂载时调一次，重复调用不叠加监听。 */
    startListening(): void {
      if (this.agentEventOff !== null) return;
      // 交回来的那只函数**必须存下**：它是 preload 按引用 removeListener 的唯一凭据
      // （`preload/renderer-api.ts` 的 `createIpcOn`，包装后的箭头不是原始 listener，摘的时候只认这个引用）。
      this.agentEventOff = window.mochen.onAgentEvent((payload) => {
        this.apply(payload);
      });
    },

    /**
     * 撤掉中栏订阅，线程态一个字都不动（「迟到的旧轮推送」另有 `apply` 里的 turnId 守卫挡）。
     *
     * **中栏卸载时不许调它**——设置中心整页化会卸载中栏，而 `turn-end` 除了收尾那一轮还负责发队首的下一条
     * （裁定 G3），监听一摘那条推送就没人接，界面停在「进行中」且排队不再往下走。
     * 后果由 `useAgentStore.listening.test.ts` 末条用例量出来，防线由 `center-column-listening-wiring.test.ts` 钉住。
     * 真正的摘除点是窗口销毁（随 renderer 一起没），所以这一只现在的作用是：**句柄有处可放，不再丢在地上**。
     */
    stopListening(): void {
      const off = this.agentEventOff;
      if (off === null) return;
      this.agentEventOff = null;
      off();
    },

    apply(outbound: AgentOutbound): void {
      // 裁定 m2：畸形推送在这里止步——忽略、留痕，绝不抛异常、绝不新建或污染线程。
      const malformed = malformedPush(outbound);
      if (malformed !== "") {
        this.notice = `已忽略一条无法归约的智能体推送：${malformed}`;
        return;
      }
      // 事件按「载荷自带的 threadKey」归位（Important 1）：delta / event / turn-end 都不能退回按
      // 激活页路由，否则别的线程的残字与错误会串进当前章视图，激活页看起来「凭空冒字」。
      const thread = this.viewOf(outbound.threadKey);
      if (outbound.type === "turn-start") {
        thread.turnId = outbound.turnId;
        thread.running = true;
        thread.startedAt = Date.now();
        thread.streaming = { ...EMPTY_STREAM };
        thread.lastError = "";
        thread.endedAs = "";
        this.seconds = 0;
        // 换轮即作废（P0-②）：上一轮的候选集在这一刻过期，留着它会让「挑一稿」落进新轮的地盘。
        delete this.draftSets[outbound.threadKey];
        // 上一轮的体检结论同理作废，否则会挂在新一轮的对话流末尾。
        useAutoCheckupStore().clear(outbound.threadKey);
        return;
      }
      // Important 2：迟到的旧轮推送一律忽略。判据是**本轮推送的 turnId 必须等于当前轮的 turnId**，
      // 不一致就 return——同线程连发两轮时新 turnId 已被 turn-start 占位，旧轮的就会撞在这里；
      // 迟到的 turn-end 同理。
      //
      // 这里**不能**写成 `thread.turnId !== null && ...`：turn-end 会把 turnId 置 null（见下），
      // 于是「轮次已收束」这个最该防迟到 delta 的时刻，前半段为 false、整个守卫短路，
      // 迟到的 delta 照旧累积进 streaming、迟到的 event 照旧落进 items——
      // 用户在流式输出中按 Esc 之后，屏幕上会凭空多出一段没人写过的字。
      // turn-end 自身到达时 turnId 仍等于本轮，过得了这道门，收束逻辑照常走。
      if (thread.turnId !== outbound.turnId) return;
      // 多稿候选集（P0-②）：N 稿都只是**等着你挑**的暂存态，一个字都不落盘；换轮即作废（上面 turn-start 清）。
      if (outbound.type === "candidates") {
        const { threadKey, draftSetId, drafts } = outbound;
        this.draftSets[threadKey] = { draftSetId, drafts };
        return;
      }
      if (outbound.type === "delta") {
        thread.streaming[outbound.deltaKind] += outbound.text;
        return;
      }
      if (outbound.type === "event") {
        // 字已经落到中栏转录里（user-message 是「受理」的唯一凭据）⇒ 这一轮不再需要还字。
        if (outbound.event.type === "user-message") delete this.pendingSend[outbound.threadKey];
        // 写后自动体检：触发点是**真写成的那一条 written 事件**，不是 turn-end——
        // 本仓的提案往往在回合结束之后才被作者批准写盘，挂在 turn-end 上会永远等不到。
        // 回放路径走 reduceEvent(absorbWrites:false)，不经过这里，重启不会把历史写入重跑一遍。
        if (outbound.event.type === "written") {
          void useAutoCheckupStore().run(outbound.threadKey, [outbound.event.docRelPath]);
        }
        this.reduceEvent(thread, outbound.event);
        return;
      }
      thread.running = false;
      thread.turnId = null;
      thread.streaming = { ...EMPTY_STREAM };
      thread.endedAs = outbound.status;
      if (outbound.status === "failed") thread.lastError = outbound.message;
      // 真机上「这一轮没能启动」走的是这里，不是 send 的 `.catch`：主进程把 pre-flight 与 try 里的
      // 异常全转成 turn-end{failed} 后照样 resolve。所以还字也必须在这一处收口——
      // 只有 failed 且该格已被入口乐观清空才还；「继续」的内置文案从不进这张表（见 state.pendingSend）。
      const unsent = this.pendingSend[outbound.threadKey];
      delete this.pendingSend[outbound.threadKey];
      if (
        outbound.status === "failed" &&
        unsent !== undefined &&
        this.draftOf(outbound.threadKey) === ""
      ) {
        this.setDraft(outbound.threadKey, unsent);
      }
      // 裁定 G3 的顺序（与计划文本相反）：先自动发队首，再谈水合。规则：turn-end{interrupted}
      // 照样自动发下一条（打断不清队，spec §5.1），一轮只发一条。
      // 发了这一条就必须在这里收口——水合的同步前缀若在同一 tick 抢跑，历史会重放进
      // 正要起新轮的这条线程（running 要等 turn-start 推送才置真，规则 2 此刻还挡不住）。
      // 新轮的 turn-end 到达时规则 2 已放行，水合照常补做。
      const next = thread.queued.shift();
      if (next !== undefined) {
        this.send(next);
        return;
      }
      // 规则2 的另一半：轮次跑完才允许补一次水合（running 时上面早退过了）。
      if (!thread.hydrated) void this.ensureHydrated(outbound.threadKey);
    },

    reduceEvent(
      thread: ThreadView,
      event: AgentEvent,
      options?: { fetchDiff?: boolean; absorbWrites?: boolean }
    ): void {
      thread.items.push(event);
      if (event.type === "reasoning") {
        thread.streaming.reasoning = "";
        return;
      }
      if (event.type === "message") {
        thread.streaming.message = "";
        return;
      }
      if (event.type === "proposal") {
        this.proposals[event.proposal.id] = {
          proposal: event.proposal,
          status: "pending",
          message: "",
          diff: ""
        };
        // 实时路径默认取 diff；回放路径显式传 false，重启后绝不给每条历史提案白打一次 IPC（M1）。
        if (options?.fetchDiff !== false) void this.loadDiff(event.proposal.id);
        return;
      }
      if (event.type === "error") {
        thread.lastError = event.message;
        // 缺陷③的 live 半边（评审 T3-1）：带 proposalId 的 error 是主进程「这条提案已确定失效」的
        // 实时口径——applyDecision 只在 pending 已删的三条分支带上它。自动批准（accept-session /
        // accept-prefix）跑在主进程的 autos 队列里，渲染层拿不到 DecisionResult，失败只剩这一条
        // error，于是那张已死的卡在重启前一直显示可批准——卡不许说谎。
        // 规则：只在那张卡仍是 pending 时收编成 stale（严格 ===，written / cancelled / rejected /
        // expired / stale / failed 一律不重判）。不带 proposalId 的 error（模型 503、读盘 io、
        // 档位收紧）一个字都不动：那几条分支的 pending 还在，卡仍可批准，改判就是说谎。
        // 这条只减授权：不造 pending、不动 queued；回放侧仍以 replayProposalStatuses 为权威
        // （水合规则 6 会用它覆盖这些卡的 status，两条路对同一张盘给出同一个答案）。
        if (event.proposalId !== undefined) {
          const card = this.proposals[event.proposalId];
          if (card !== undefined && card.status === "pending") card.status = "stale";
        }
        return;
      }
      if (event.type === "written") {
        const written = this.proposals[event.proposalId];
        if (written) {
          written.status = "written";
          written.message = "";
        }
        // D1：status/message 是规则6/规则8 的依赖，回放也必须落；但实时提示与文档重读
        // 属实时路径副作用——回放 N 条历史 written 若照常吸收，会在重启瞬间打 N 次
        // readDoc 并用陈旧文案覆盖实时 notice，故由 absorbWrites 单独关闸（默认开）。
        if (options?.absorbWrites !== false) {
          this.notice = `已写入 ${event.docRelPath}${event.backupRelPath ? "，原稿已备份" : ""}`;
          // absorbAgentWrite 内部已把重读失败收成中文 notice（Wave A 偏离 2），这里不再包 try。
          void useBookStore().absorbAgentWrite(event.docRelPath, event.fingerprint);
        }
        return;
      }
      if (event.type !== "decision") return;
      const view = this.proposals[event.proposalId];
      if (!view) return;
      // 批准类的终态由 written / decide 返回值落，这里只处理两种即时裁决。
      if (event.decision === "cancel") view.status = "cancelled";
      if (event.decision === "deny-with-guidance") {
        view.status = "rejected";
        view.message = event.guidance;
      }
    },

    /** 裁定 m1：diff 取回失败必须让用户看见，卡片保持待审而不是空着一块。 */
    async loadDiff(proposalId: string): Promise<void> {
      const view = this.proposals[proposalId];
      if (!view) return;
      const read = await readRemote(
        () => window.mochen.proposalDiff(proposalId),
        "提案差异取回失败"
      );
      view.diff = read.ok ? read.value : "";
      if (!read.ok) this.notice = read.notice;
    },

    /**
     * 中栏唯一的审批出口：主进程是唯一写盘通路，这里只反映结果。
     * 成功等 written 事件；失败一律保持 pending（spec §9：写盘失败可重试）。
     * 裁定 m1：跨 IPC 的拒绝也写成中文贴在卡片上，卡片保持待审可重试。
     */
    async decide(proposalId: string, decision: ProposalDecision, guidance: string): Promise<void> {
      const input: DecideInput = { proposalId, decision, guidance };
      let result: DecisionResult;
      try {
        result = await window.mochen.decideProposal(input);
      } catch (err) {
        const reason = reasonOf(err);
        const card = this.proposals[proposalId];
        if (card) card.message = reason;
        this.notice = `审批没能送达主进程：${reason}`;
        return;
      }
      const view = this.proposals[proposalId];
      const patch = decisionViewPatch(result, guidance);
      if (!view || patch === null) return;
      if (patch.status !== undefined) view.status = patch.status;
      if (patch.message !== undefined) view.message = patch.message;
    },

    /**
     * 发一轮。
     *
     * `rememberForRestore` = 要不要把这句话记进「还字账」（见 state.pendingSend）。
     * 不传时读「送出后清空输入框」那一枚偏好：入口清了输入框，失败时就得把字还回去。
     * 「继续」那一枚显式传 false——它重发的是**早就发出去过**的那句，
     * 已经在中栏转录里了，再还一次就是第二份（与 state.pendingSend 那段注释同一条口径）。
     */
    send(text: string, options?: { rememberForRestore?: boolean }): void {
      const book = useBookStore();
      const threadKey = threadKeyFor(book.activeDocTab);
      // 自动识别的唯一榜首（2026-11-17）：这一轮把它的正文一起递过去，省掉「先 use_skill 再动笔」
      // 的一轮往返。判据（空榜 / 并列第一 / 唯一榜首）住 utils/skill-auto.ts，这里只取结果。
      const preload = useAutoSkillStore().preloadIdOf(threadKey);
      const excludedKeys = book.meta === null ? [] : useBibleExclusionStore().keysOf(book.meta.id);
      // userText 只放用户敲的那一句，一字不多。上下文包（当前章/大纲/人物/前情提要）
      // 由主进程按档案装配后并进**系统提示**——渲染层再拼一份前缀就成了同一份上下文的两个实现，
      // 而且那串东西会被原样写进会话 JSONL，往后每一轮回放都跟着重发一遍。
      const input: StartTurnInput = {
        threadKey: threadKeyFor(book.activeDocTab),
        docRelPath: book.activeDocTab,
        stageId: book.meta?.activeStage ?? "draft",
        userText: text,
        // 每轮开关的当下值：字段是必填的，主进程边界缺一个就整轮拒收（不静默按 off 发）。
        thinkingLevel: this.thinkingLevel,
        webSearchEnabled: this.webSearchEnabled,
        // 多稿档（P0-②）：必填字段，开着时主进程一轮静默跑 N 次生成再把 N 稿一起推回来。
        sampleCount: this.sampleCount,
        // 工具面板里关掉的几枚（2026-10-21）：一枚没关就不带这个字段——整轮请求与从前一字不差；
        // 关了才摊一份递过去，别把响应式数组的引用交出去。
        ...(this.disabledTools.length > 0 ? { disabledTools: [...this.disabledTools] } : {}),
        // 本线程显式挂入的技能（spec §11）：只传 id，正文由主进程按同一套读取守卫取。
        // 摊一份再递 —— 见 utils/agent-thread.ts 的 plainList，那段记着为什么这条路不通过一次。
        skillPaths: plainList(this.skillPathsOf(threadKeyFor(book.activeDocTab))),
        // 不预读时整条字段缺席（不是空串）：请求与从前逐字一致，老路径一个字节都不变。
        ...(preload === "" ? {} : { preloadSkillId: preload }),
        // 本轮被点掉「不带」的设定（表在 useBibleExclusionStore，2026-11-20）：一条没点就不带这个字段。
        ...(excludedKeys.length > 0 ? { excludedBible: excludedKeys } : {})
      };
      // startTurn 的 promise 要等整轮跑完才兑现；turnId 走 turn-start 推送，这里不等。
      // running 只由 turn-start / turn-end 拥有，被拒的这一轮从未开始，自然不会停在「工作中」。
      //
      // 还字账只在「入口把这一格清空了」时才记（2026-10-06 批次 5-⑧）：设置页那枚
      // 「送出后清空输入框」关掉时字还在格子里，根本不需要还。不记这条账的原因不是省事——
      // 记了的话，用户手动删掉那段字之后迟到的失败回执会把它**又填回去**，
      // 变成「我没点发送，它自己又出现了」。
      const remember = options?.rememberForRestore ?? clearComposerAfterSend();
      if (remember) this.pendingSend[input.threadKey] = text;
      window.mochen.startTurn(input).catch((err: unknown) => {
        const reason = reasonOf(err);
        this.viewOf(input.threadKey).lastError = reason;
        this.notice = `这一轮没能启动：${reason}`;
        if (!remember) return;
        // 发送被拒：把用户这一格刚被入口乐观清掉的文本原样还回去（清空是乐观的，失败才回写）。
        // 仅当该线程当前草稿仍是空——失败回执回来前用户可能又打了字，绝不覆盖新输入（本波「不吞字」承诺）。
        // 这条支路一旦还过字，事件路径那份账就地销掉，免得迟到的 turn-end 再还一次把新打的字盖掉。
        delete this.pendingSend[input.threadKey];
        if (this.draftOf(input.threadKey) === "") this.setDraft(input.threadKey, text);
      });
    },

    /**
     * 「继续」：把上一句用户指令**原样再发一次**（同一线程，带着上文）。
     *
     * 【为什么是"再发一次"而不是"发一句机器话"】
     * 早先的裁定说「不记『继续』的内置文案（那是机器的话，不该塞回用户的地盘）」——
     * 那是"内置文案"那条路的理由。这里走另一条：**用户自己说过的那句原样重发**。
     * 字是他的、上下文是同一线程的，模型看到自己上一轮写了一半的内容与同一句指令，
     * 接上去继续做还是重做那一段，由它自己判断——界面不替它决定。
     *
     * 【判据只有一份】挂点判定在 utils/turn-resume.ts（`resumeAffordanceOf`），
     * 这里只负责发起。拿不到可重发的内容就返回 false：一个字都不写、不发。
     *
     * 【为什么显式不记还字账】重发的是**早就发出去过**的那句，它已经在中栏转录里了；
     * 失败时再还回输入框就是第二份（同 state.pendingSend 的口径）。
     */
    resumeLastTurn(): boolean {
      const thread = this.viewOf(threadKeyFor(useBookStore().activeDocTab));
      const affordance = resumeAffordanceOf(thread);
      if (affordance === null) return false;
      this.send(affordance.text, { rememberForRestore: false });
      return true;
    },

    /** 运行中按 Tab：判定在 enqueueText（一处实现），这里只负责「被拒时写一句中文」。 */
    queueText(threadKey: string, text: string): boolean {
      const { ok, notice } = enqueueText(this.viewOf(threadKey), text);
      if (notice !== "") this.notice = notice;
      return ok;
    },

    /** 「用这一稿」（P0-②）：index 是候选集里的位次（0 = 主进程按 rankDrafts 排在推荐位的那一稿）。 */
    async pickDraft(index: number): Promise<void> {
      const key = threadKeyFor(useBookStore().activeDocTab);
      const notice = await resolveDraft(this.draftSets, key, index, "");
      if (notice !== "") this.notice = notice;
    },

    /** 「丢弃全部」（P0-②）：不落盘，一个字的稿都不进盘；成功回一句实话（文案在 utils/draft-candidates.ts）。 */
    async discardDrafts(): Promise<void> {
      const key = threadKeyFor(useBookStore().activeDocTab);
      const notice = await resolveDraft(this.draftSets, key, null, DRAFT_DISCARD_DONE);
      if (notice !== "") this.notice = notice;
    },

    /** 裁定 m1：打断的拒绝同样写成中文并返回 false，调用位（Esc/按钮）不需要再包 try。 */
    async stop(): Promise<boolean> {
      const thread = this.threads[threadKeyFor(useBookStore().activeDocTab)];
      const turnId = thread?.turnId;
      if (!turnId) return false;
      try {
        return await window.mochen.interruptTurn(turnId);
      } catch (err) {
        const reason = reasonOf(err);
        if (thread) thread.lastError = reason;
        this.notice = `打断没能送达主进程：${reason}`;
        return false;
      }
    },

    /** 水合入口：八条规则逐字照 spec §4.3。判定与取数全在 store，组件只触发。 */
    async ensureHydrated(threadKey: string): Promise<void> {
      const thread = this.viewOf(threadKey);
      if (thread.hydrated) return; // 规则1 幂等
      if (thread.running) return; // 规则2 running 时不抢顺序
      if (thread.hydrating) {
        // 规则3 并发合流：复用同一次在途取数，不发第二条 IPC
        const inflight = this.hydrateInflight[threadKey];
        if (inflight !== undefined) await inflight;
        return;
      }
      thread.hydrating = true;
      const task = this.runHydrate(threadKey, thread);
      this.hydrateInflight[threadKey] = task;
      try {
        await task;
      } finally {
        delete this.hydrateInflight[threadKey];
      }
    },

    async runHydrate(threadKey: string, thread: ThreadView): Promise<void> {
      let result: SessionLoadResult;
      try {
        result = await window.mochen.loadSession(threadKey);
      } catch (err) {
        // 规则3 失败回滚：首行坏 / IPC 抛 ⇒ 留待用户再按 /resume 重试
        thread.hydrating = false;
        this.notice = `这条线程的历史没有读回来：${reasonOf(err)}`;
        return;
      }
      thread.hydrating = false;
      if (!result.found) {
        // 规则5：no-session 视为确实没有历史 ⇒ 置位；no-book 不置位（下次开书还得能水合）
        if (result.reason === "no-session") thread.hydrated = true;
        return;
      }
      this.applyReplay(thread, result);
      thread.hydrated = true;
    },

    /** 回放载荷落进线程视图的共用一段（`/resume` 与面板指名切换同一条通路）：按事件 id 去重（规则4）、派生扫描覆盖卡片状态（规则6）、只有 interrupted 结尾才复活「继续」（规则8）、坏行如实播报（规则7）；回放路径既关 diff 取数（M1），也关写盘回吸收与实时提示覆盖（D1）。 */
    applyReplay(thread: ThreadView, result: Extract<SessionLoadResult, { found: true }>): void {
      // 规则4：只归约 items 里不存在该事件 id 的那些
      const known = new Set(thread.items.map((item) => item.id));
      for (const event of result.events) {
        if (known.has(event.id)) continue;
        known.add(event.id);
        this.reduceEvent(thread, event, { fetchDiff: false, absorbWrites: false });
      }
      // 规则6：派生扫描覆盖这些卡的 status（expired 卡已在规则4 里没请求 diff）
      const replayed = replayProposalStatuses(result.events);
      for (const [id, status] of Object.entries(replayed)) {
        const view = this.proposals[id];
        if (view) view.status = status;
      }
      // 规则8：只有最后一条是 interrupted 才复活「继续」；error 保守不标 failed
      const last = result.events[result.events.length - 1];
      if (last?.type === "interrupted") thread.endedAs = "interrupted";
      thread.sessionId = result.meta.sessionId;
      // 规则7：坏行如实播报，不伪造事件、不静默
      if (result.droppedLines.length > 0)
        this.notice = `这条线程有 ${result.droppedLines.length} 行没能读回，其余内容已恢复。`;
    },

    /** 面板打开时的取数：失败只写 notice、不清空已显示的行——把「读不到」伪装成「没有历史」比报错更坏。 */
    async refreshSessions(): Promise<void> {
      const read = await readRemote(() => window.mochen.listSessions(), "历史对话没有读回来");
      if (read.ok) this.sessions = read.value;
      else this.notice = read.notice;
    },

    /**
     * 技能库的取数（spec §11）。失败只写 notice、**不清空已显示的那张表**：
     * 与 refreshSessions 同一策略——读不到就还摆着上一次读到的，不装作「一个技能都没有」。
     */
    async refreshSkills(): Promise<void> {
      const read = await readRemote(() => window.mochen.listSkills(), "技能库没有列出来");
      if (read.ok) {
        this.skills = read.value;
        this.skillsListed = true;
        // 盘上技能变了（兑换 / 市场安装 / 换书）就重算一次自动挂入，否则新技能要等下次敲字才被看见。
        useAutoSkillStore().sync(threadKeyFor(useBookStore().activeDocTab));
      } else this.notice = read.notice;
    },

    /** 读一份技能正文（只读）。读不到时把主进程那句中文原样摆出来，不留一张空卡。 */
    async readSkill(id: string): Promise<SkillContent | null> {
      const parsed = splitSkillId(id);
      if (parsed === null) {
        this.notice = `认不出这份技能：${id}。`;
        return null;
      }
      try {
        return await window.mochen.readSkill(parsed.source, `${parsed.dirName}/${SKILL_FILE_NAME}`);
      } catch (err) {
        this.notice = `这份技能没有读出来：${reasonOf(err)}`;
        return null;
      }
    },

    /**
     * 挂入 / 取下**本线程**的技能（spec §11）。**这是唯一让技能进入上下文的动作**：
     * 点技能行、浏览技能库都不产生任何装配效果（spec §10 第 4 条）。
     *
     * P0-4：第一次点就写下显式覆盖（**不再「取到空就删键」**）——删键会退回书级默认，
     * 「本会话把最后一条也取下」就永远表达不出来。空数组是一个明确的「本会话一个都不挂」。
     */
    toggleSkillForThread(threadKey: string, id: string): void {
      const current = this.skillPathsOf(threadKey);
      const pinnedNow = !current.includes(id);
      const next = pinnedNow ? [...current, id] : current.filter((one) => one !== id);
      this.skillPathsByThread[threadKey] = next;
      // 亲手取下 = 否决这枚技能的自动挂入；亲手挂回 = 解除否决。所有入口都经这里。
      useAutoSkillStore().noteManual(threadKey, id, pinnedNow);
    },

    /**
     * 本线程这一轮实际会带进上下文的技能 id：
     * 有覆盖就用覆盖，没有就继承书级默认（`skillPolicy.enabled`）；两边都剔除已停用的。
     * 判定与增删全在本 store，组件不许自己拿那份数组去 filter。
     */
    skillPathsOf(threadKey: string): string[] {
      const policy = skillPolicyOf(useBookStore().meta);
      const override = Object.prototype.hasOwnProperty.call(this.skillPathsByThread, threadKey)
        ? this.skillPathsByThread[threadKey]
        : null;
      return effectiveSkillIds(policy, override);
    },

    /** 本线程有没有显式覆盖：界面据此区分「书级默认」与「本会话临时改过」。 */
    hasSkillOverride(threadKey: string): boolean {
      return Object.prototype.hasOwnProperty.call(this.skillPathsByThread, threadKey);
    },

    /** 「恢复书级默认」：删掉覆盖键，这一条会话回到继承状态。 */
    resetSkillOverride(threadKey: string): void {
      delete this.skillPathsByThread[threadKey];
    },

    /**
     * 上下文占用条的数据源（spec §5）。与 startTurn 在主进程走同一条装配路径，
     * 所以这里显示的条目与字数就是这一轮真会发出去的那些。
     * 失败静默：占用条是辅助信息，为它弹一句 notice 只会打断正在写的东西（与 refreshSessions 相反——
     * 那条读的是用户主动点开的面板，读不到必须说）。
     */
    async refreshContextPreview(query: ContextPreviewQuery): Promise<void> {
      try {
        // pinned 摊一份再出网（见 utils/agent-thread.ts 的 plainList）：占用条那份来自
        // computed，数组是响应式的；这里若原样递，contextBridge 会在进 preload 之前就拒掉。
        this.contextPreview = await window.mochen.contextPreview({
          ...query,
          // `?? []` 不是可有可无的：pinned 在契约里是**可选**的，
          // 而 plainList(undefined) 会抛（展开 undefined）——
          // 偏偏这个 try 是静默的，抛了就只是「数字不更新」，
          // 占用条于是悄悄留着上一次那份，看起来像「没挂任何技能」。
          pinned: plainList(query.pinned ?? []),
          // 已移除的设定也要如实出网：占用条不按它扣，报的就是「全带」的假数字。
          excludedBible: plainList(query.excludedBible ?? [])
        });
      } catch {
        // 留住上一次读到的：旧数字仍然大致对得上，比整条消失诚实。
      }
    },

    /**
     * 面板每一行的当下判定。判定本体在 utils/session-row-action.ts（一处实现），
     * 这里是唯一的上下文装配点：`unbound` 用的是本文件那份 UNBOUND 口径，组件不许自己猜。
     */
    rowActionFor(item: SessionListItem): SessionRowAction {
      const book = useBookStore();
      const viewed = this.threads[threadKeyFor(book.activeDocTab)];
      return sessionRowAction(item, {
        currentSessionId: viewed?.sessionId ?? "",
        existingDocPaths: book.docs.map((doc) => doc.relPath),
        responding: viewed?.running === true,
        unbound: item.docRelPath === UNBOUND
      });
    },

    /** 覆盖式切换用的清空：显示态归零，并删掉这一条线程名下的提案卡（旧会话的卡不许留在新视图上）。 */
    resetThreadView(threadKey: string): void {
      const thread = this.viewOf(threadKey);
      thread.items = [];
      thread.streaming = { ...EMPTY_STREAM };
      thread.lastError = "";
      thread.endedAs = "";
      thread.sessionId = "";
      purgeThreadProposals(this.proposals, threadKey);
    },

    /** 点面板一行 = 切到那条会话接着聊。与 `/resume` 的分别是「最近那条」对「指名的那条」：主进程 loadSession 收到 sessionId 会把这一条线程的写入目标改过去，下一轮就续在它后面。 */
    async showSession(item: SessionListItem): Promise<void> {
      const action = this.rowActionFor(item);
      if (action.kind !== "open") {
        this.notice = action.reason;
        return;
      }
      const threadKey = item.docRelPath; // 裁定 o：绑定线程的键恒等于文稿路径
      const book = useBookStore();
      // 抢在换标签之前置位：openDocTab 会让组件补一次「最近那条」的自动水合，那一读若先回来就把
      // 用户亲手点开的这一条盖掉了；读失败再照原值退回，`/resume` 还能重试。
      const wasHydrated = this.viewOf(threadKey).hydrated;
      this.viewOf(threadKey).hydrated = true;
      if (book.activeDocTab !== threadKey) await book.openDocTab(threadKey);
      let result: SessionLoadResult;
      try {
        result = await window.mochen.loadSession(threadKey, item.sessionId);
      } catch (err) {
        this.viewOf(threadKey).hydrated = wasHydrated;
        this.notice = `这条线程的历史没有读回来：${reasonOf(err)}`;
        return;
      }
      this.resetThreadView(threadKey);
      this.notice = "";
      if (!result.found) {
        // 主进程那句中文就是全部实话：不假装切过去了，也不留下上一条会话的显示。
        this.notice = result.message;
        return;
      }
      this.applyReplay(this.viewOf(threadKey), result);
    },

    /** `/` 面板唯一派发口：switch 表住在 `agent-slash-dispatch`（本文件贴到 800 行预算后拆出），这里只转交。 */
    runSlashCommand(command: SlashCommand, argument: string): void {
      dispatchSlashCommand(this, command, argument);
    },

    /**
     * `/clear` 的真实边界（spec §6）：只清渲染层视图——不动 JSONL、不动主进程 pending、不生成 boundary 事件。
     * `hydrated` 置真 ⇒ Task 5 的三处自动水合时机不会把刚清掉的内容立刻倒回来；
     * 恢复办法就是确认文案里那句「重启后仍会完整回放」。
     * `queued` 不清：那是用户还没发出去的指令，不是显示内容。
     */
    clearThreadView(threadKey: string): void {
      const thread = this.viewOf(threadKey);
      const pendingCards = pendingCountOf(this.proposals, threadKey);
      thread.hydrated = true;
      this.resetThreadView(threadKey);
      this.notice =
        pendingCards === 0
          ? CLEAR_VIEW_SENTENCE
          : `${CLEAR_VIEW_SENTENCE} 本页还有 ${pendingCards} 条待审批提案，清空后这一轮里点不到它们；重启后会以「上次会话未处理」回来。`;
    },

    tick(): void {
      this.seconds = runningSeconds(this.threads);
    }
  }
});

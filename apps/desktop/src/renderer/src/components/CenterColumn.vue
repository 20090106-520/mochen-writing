<!-- 中栏骨架（conversation-pane / conversation-header / conversation-scroll-shell / conversation-empty）
     取自 deepwrite；卡片与时间线为自有。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BOOK_DATA_LABELS,
  PROPOSAL_STATUS_LABELS,
  presentableFailureMessage,
  workModeOf,
  type AgentEvent,
  type ProposalDecision
} from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import AgentTimeline from "./AgentTimeline.vue";
import AutoCheckupCard from "./AutoCheckupCard.vue";
import ProposalCard from "./ProposalCard.vue";
import ComposerBox from "./ComposerBox.vue";
import DraftCandidates from "./DraftCandidates.vue";
import ContextMeter from "./ContextMeter.vue";
import ToolRoster from "./ToolRoster.vue";
import ModelSelect from "./ModelSelect.vue";
import BookWorkbench from "./BookWorkbench.vue";
import ConversationHistoryMenu from "./ConversationHistoryMenu.vue";
import { cardTurnLabel, splitProposalCards, turnAnchors } from "../utils/timeline";
import { showContextBar } from "../utils/composer-context";
import { clearComposerAfterSend } from "../utils/auto-behavior-preference";
import { conversationTitleLabel } from "../utils/profile-options";
import {
  WORKBENCH_CARD_PREFILL,
  workbenchCards,
  workbenchSuggestions,
  workbenchTarget,
  type WorkbenchCardId,
  type WorkbenchSuggestion
} from "../utils/workbench-state";
import { useBookStore } from "../stores/useBookStore";
import { bookDataFlushFailedKeys, retryFailedBookData } from "../composables/bookDataRegistry";
import { useWritingGoalStore } from "../stores/useWritingGoalStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useProviderStore } from "../stores/useProviderStore";
import { useReferenceMenuStore } from "../stores/useReferenceMenuStore";
import {
  CLEAR_VIEW_SENTENCE,
  composeStatusLine,
  threadKeyFor,
  useAgentStore,
  type ProposalView,
  type ThreadView
} from "../stores/useAgentStore";
import { assistantEmotion } from "../utils/emotion-signal";
import { resumeAffordanceOf } from "../utils/turn-resume";
import { isStuckToBottom, streamKey, type ScrollMetrics } from "../utils/stick-to-bottom";
import { useNotificationStore } from "../stores/useNotificationStore";
import { PREFILL_NOTICE } from "../utils/message-actions";
import { turnProgressOf } from "../utils/turn-progress";

/**
 * `leftCollapsed` 与 `toggleLeft` 在 2026-10-17 一并退役：那枚「展开左侧栏」搬去了
 * `PaneEdgeToggle`（恒挂 shell，四页都在），中栏这一支不再是它的落点。
 * 撤了按钮还留着 prop 与 emit，就是本仓反复吃过的那种「零消费者的死接线」。
 */
defineProps<{ rightCollapsed: boolean }>();
/**
 * 头部动作区（2026-10-07 用户裁定）：原先这里还挂着一枚「写作目标环」——圆圈里写着 0%，
 * 常年 0%（今天一个字没写时它是 0%，点开才是面板）。用户裁定不要它，于是整枚退役。
 *
 * 目标**面板本身没动**，它仍由 App.vue 的 `panelShortcut("goals")`（Ctrl+Shift+G）开合，
 * `<WritingGoalPanel>` 也仍挂在 App.vue。退役的只是那一枚常驻的圆环按钮与它的 openGoal 事件——
 * 留着一条没人 emit 的监听，就是本仓反复吃过的那种「零写者的死接线」。
 */
const emit = defineEmits<{ toggleRight: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const goal = useWritingGoalStore();
const layout = useLayoutStore();
const provider = useProviderStore();
const notif = useNotificationStore();
/**
 * 换书时没落进上一本目录的设定（2026-11-15）：状态栏给「查看 / 重试保存」两枚按钮。
 * 清单本身只由 bookDataRegistry 写；这里只负责展示与重试的瞬时态。
 */
const flushRetrying = ref(false);
const flushFailedNames = computed(() =>
  bookDataFlushFailedKeys.value.map((key) => BOOK_DATA_LABELS[key]).join("、")
);
function revealFlushFailures(): void {
  book.notice = `没存进目录的设定：${flushFailedNames.value}。可点「重试保存」，或到对应面板重新保存一次。`;
}
async function retryFlush(): Promise<void> {
  if (flushRetrying.value) return;
  flushRetrying.value = true;
  try {
    book.notice = await retryFailedBookData();
  } finally {
    flushRetrying.value = false;
  }
}
/** #106 裁定 D1：`/` 的真身只剩行内引用菜单一处，唤起态也跟着它住进 store（键位层要能派下来）。 */
const referenceMenu = useReferenceMenuStore();
/** 工具 ▾ 的浮层是瞬时 UI 态，不进 store（计划决定 6），关掉不带走任何状态。 */
const rosterOpen = ref(false);
/** 模型 ▾ 也是瞬时 UI 态；名单本身归 useProviderStore（切完模型它还活着，关掉浮层不该重拉）。 */
const modelsOpen = ref(false);
/**
 * 下拉浮层的锚点 = 点开它的那枚 chip（2026-10-07 用户裁定：贴 chip 弹，不居中遮罩）。
 *
 * 元素住在 ComposerBox 的模板里，所以随 `open-model-select` 事件一起交上来。
 * 拿不到元素就不开浮层——弹一个没有锚点的下拉，它会飞到屏幕左上角，
 * 而「模型选择器跑到左上角」这种 bug 从代码上完全看不出原因（#5-㉔ 同族的坑：量对了图不对）。
 */
const modelAnchor = ref<HTMLElement | null>(null);
const EMPTY_ITEMS: AgentEvent[] = [];
const EMPTY_TAIL = { reasoning: "", message: "" };

const threadKey = computed(() => threadKeyFor(book.activeDocTab));
const thread = computed<ThreadView | undefined>(() => agent.threads[threadKey.value]);
/** 本线程的多稿候选集（P0-②）：没有就是 undefined（面板不显形）。换轮 / 选稿 / 丢稿都会在 store 里清掉它。 */
const draftSet = computed(() => agent.draftSets[threadKey.value]);
const items = computed(() => thread.value?.items ?? EMPTY_ITEMS);
const tail = computed(() => thread.value?.streaming ?? EMPTY_TAIL);
const running = computed(() => thread.value?.running ?? false);
const hydrating = computed(() => thread.value?.hydrating ?? false);
const hydratedEmpty = computed(
  () => thread.value?.hydrated === true && (thread.value?.items.length ?? 0) === 0
);
/** 本线程的**全部**卡（含已裁决）。以前这份就叫 pending，名不副实且把卡全摊在最底部。 */
const threadCards = computed<ProposalView[]>(() =>
  Object.values(agent.proposals).filter((view) => view.proposal.threadKey === threadKey.value)
);
// 判定层在 utils（本仓没有组件测试）：轮次锚点、待审/已裁决分组、卡头标签文字全部走纯函数。
const anchors = computed(() => turnAnchors(items.value));
const cardSplit = computed(() => splitProposalCards(threadCards.value, anchors.value));
const openCards = computed(() => cardSplit.value.open);
const settledCards = computed(() => cardSplit.value.settled);
const expiredCards = computed(() => cardSplit.value.expired);
/**
 * 「这一格还是空的」的唯一判据：时间线没有事件、本轮没在跑、没在水合，且三类提案卡全为空。
 * 两个消费者共用它——工作台式的空状态（原先这串条件裸写在模板里）与 #113c 输入卡上方的绑定条。
 */
const messagesEmpty = computed(
  () =>
    items.value.length === 0 &&
    !running.value &&
    !hydrating.value &&
    openCards.value.length === 0 &&
    settledCards.value.length === 0 &&
    expiredCards.value.length === 0
);
const contextBarVisible = computed(() =>
  showContextBar({ hasBook: book.hasBook, threadEmpty: messagesEmpty.value })
);
/**
 * 欢迎首页（2026-11-09 用户给的参考图）：**只有「没打开作品 + 这一格还没有消息」才是首页**。
 * 有书的空线程仍摆作品工作台（五张能力卡），有消息就是正常对话——首页不接管那两态。
 * 这一格判据只有这一份，中栏的 is-welcome 与输入卡的 welcome 都读它，不各写一遍。
 */
const welcomeHome = computed(() => messagesEmpty.value && !book.hasBook);
/**
 * 助手头像这一刻的表情（2026-10-21）：判定真身在 utils/emotion-signal.ts，
 * 这里只负责把本线程的六路信号喂进去——不在这写第二份「running ? …」。
 */
const assistantFace = computed(() =>
  assistantEmotion({
    running: running.value,
    items: items.value,
    tail: tail.value,
    endedAs: thread.value?.endedAs ?? "",
    lastError: thread.value?.lastError ?? "",
    pendingProposals: openCards.value.length,
    hydrating: hydrating.value
  })
);
/**
 * 对话自动跟随（2026-11-10 用户原话：「对话自动往下拉」）。
 *
 * **原来整仓一处滚动代码都没有**：中栏 `.conversation-scroll` 是原生滚动容器，
 * 模型吐字时它只会老老实实变高，**谁也不会往下走**——用户得自己一路跟着拖滚动条。
 * 这一块补的就是这件事，规则只有两条：
 * ① 贴着底（离底 ≤ `STICK_SLACK`）⇒ 一有新内容就继续贴住；
 * ② 他自己往上翻了 ⇒ **松手**，一个像素都不许动，改成在右下角报一句「有新内容」。
 * 只做 ① 就是抢滚动条：用户回去读上一段，字一吐就把他拽回底部。
 *
 * 判据（什么算贴底、什么算有新内容）住在 `utils/stick-to-bottom.ts`，这里只接线。
 */
const scrollEl = ref<HTMLElement | null>(null);
/** 现在是不是允许跟着走。用户的每一次滚动都重算它，不许有第二个写者。 */
const sticking = ref(true);
/** 松手期间下面来了新内容——给那一刻才出的那枚钮用。 */
const unseenBelow = ref(false);
/** 本帧的挂起句柄（`0` = 没有挂着的）。 */
let pinFrame = 0;

/**
 * 内容形状：**只有它变了才谈滚不滚**。
 * 不能 watch `tail` 那个对象——store 收 delta 是 `thread.streaming.message += text`（就地改写），
 * 引用自始至终不变，watch 一次都不会响（真机踩过：跟随「写好了但不动」）。
 * 所以这里读的是**长度**，见 utils/stick-to-bottom.ts 的 streamKey。
 */
const streamShape = computed(() =>
  streamKey({
    itemCount: items.value.length,
    messageChars: tail.value.message.length,
    reasoningChars: tail.value.reasoning.length,
    openCards: openCards.value.length,
    settledCards: settledCards.value.length,
    expiredCards: expiredCards.value.length
  })
);

function scrollMetrics(): ScrollMetrics | null {
  const el = scrollEl.value;
  if (el === null) return null;
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

/** 贴到底。**不做平滑滚动**：正在吐字时动画每帧都会被新内容打断，抖得比直接跳更难看。 */
function pinToBottom(): void {
  const el = scrollEl.value;
  if (el === null) return;
  el.scrollTop = el.scrollHeight;
}

/**
 * 推迟到下一帧再贴。
 *
 * 直接写 `scrollTop` 会读到**还没排完版**的 `scrollHeight`——delta 是一帧好几个地到的，
 * 每次渲染后都同步贴一次，贴出来的位置会落后半行到一行。一帧只贴一次，且贴在排版之后。
 *
 * **但窗口不可见时浏览器根本不产帧**（真机撞过：开发窗口被别的窗口挡住，
 * `visibilityState` 是 `hidden`，`requestAnimationFrame` 的回调一次也不来），
 * 那种时候跟随会静静地停住。所以可见性不是 `visible` 就直接贴：
 * 没有渲染就没有「贴早了」这回事，而排版照样在算，`scrollHeight` 是准的。
 */
function schedulePin(): void {
  if (document.visibilityState !== "visible") {
    pinToBottom();
    return;
  }
  if (pinFrame !== 0) return;
  pinFrame = requestAnimationFrame(() => {
    pinFrame = 0;
    pinToBottom();
  });
}

/**
 * 窗口重新可见时补一次。
 *
 * 挂后台那段时间里布局可能已经长了好几屏（那一轮还在跑），回来看到的是「半截」。
 * 只在仍处于跟随状态时补：他自己滚上去的那一段位置不该被这次回前台冲掉。
 */
function onWindowVisibility(): void {
  if (document.visibilityState !== "visible") return;
  if (sticking.value) schedulePin();
}

/** 用户的滚动：唯一的重算点。滚回底部即恢复跟随，并把「有新内容」收掉。 */
function onConversationScroll(): void {
  const metrics = scrollMetrics();
  if (metrics === null) return;
  sticking.value = isStuckToBottom(metrics);
  if (sticking.value) unseenBelow.value = false;
}

watch(
  streamShape,
  () => {
    if (sticking.value) {
      schedulePin();
      return;
    }
    // 松手时不抢滚动条，但要让他知道下面在长东西。只在跑的时候报；
    // 回放历史那一波（水合）不该弹一枚「有新内容」。
    if (running.value) unseenBelow.value = true;
  },
  { flush: "post" }
);

/**
 * 换线程（换章 / 换书 / 新建对话）：回到「跟着最新那一条」。
 * 内容还没到时先贴一次——同一格原来是别的线程的滚动位置，留着它等于开新章先看到半截。
 */
watch(
  threadKey,
  () => {
    sticking.value = true;
    unseenBelow.value = false;
    void nextTick(pinToBottom);
  },
  { flush: "post" }
);

/** 松手之后点这枚钮：回去，并恢复跟随。 */
function jumpToBottom(): void {
  sticking.value = true;
  unseenBelow.value = false;
  pinToBottom();
}

function turnLabel(card: ProposalView): string {
  return cardTurnLabel(anchors.value, card.proposal.turnId);
}
// 水合时机（spec §4.4）：开书后（rootPath 落定）与切文稿标签（threadKey 变）各触发一次。
// 判定与取数全在 store；immediate 让「已开书状态下重新挂载」也能回放。
// （/resume 走 Task 8 的面板动作，调同一个 ensureHydrated，靠规则1 幂等。）
// 这里必须 watch rootPath 本身，不能换成 book.hasBook 布尔源：从书 A 直接切到书 B 时
// hasBook 恒为 true 不触发，ensureHydrated 会被静默跳过——那是行为回归，不是重复谓词。
watch(
  [() => book.rootPath, threadKey],
  ([root]) => {
    if (root !== null) void agent.ensureHydrated(threadKeyFor(book.activeDocTab));
  },
  { immediate: true }
);
// W-06：进度读数只从事件流与在途残字推，不让模型自报；目标字数取逐章设置（0 = 没设）。
// 两者都在装配层算好递给状态文案的唯一入口，组件模板一个字没改。
const turnProgress = computed(() => turnProgressOf(thread.value));
const statusLine = computed(() =>
  composeStatusLine(
    thread.value,
    agent.seconds,
    agent.pendingOf(threadKey.value),
    thread.value?.queued.length ?? 0,
    {
      progress: turnProgress.value,
      targetChars: goal.chapterTargetOf(book.activeDocTab ?? undefined)
    }
  )
);
const ready = computed(() => book.hasBook);

/**
 * 「继续」这一枚钮的挂点判定（2026-11-20 · 主线第一刀）。
 *
 * 状态行原来写着「已打断 · 可点「继续」」，而那句话是纯文本 `<span>`——全仓没有一枚
 * 「继续」按钮，作者被一句点不动的话晾在原地。现在这枚是真能点的：
 * 把上一句用户指令原样再发一次（同一线程，带着上文）。
 *
 * 判定只有一份（utils/turn-resume.ts 的 `resumeAffordanceOf`），这里只读它、只派发。
 */
const resumeAffordance = computed(() => resumeAffordanceOf(thread.value));
function resumeTurn(): void {
  agent.resumeLastTurn();
}

// 顶栏标题报的是**当前档案的名字**（墨宸 · 主笔 / 墨宸 · 审稿…），
// 不再是「正文智能体」那种 `${stage.name}智能体` 的功能泛称——
// 泛称回答不了「现在是谁在写」。判定在 utils/profile-options 的 conversationTitleLabel。
const agentLabel = computed(() => conversationTitleLabel(book.meta));
const contextTitle = computed(() => {
  if (!book.meta) return "无";
  const chapter = book.docs.find((doc) => doc.relPath === book.activeDocTab);
  return `${book.meta.title} · ${chapter ? chapter.title : "未打开章节"}`;
});
// 档位 chip 的判定唯一来自 permissionChipView（设计决定 4）——#105 起这枚 chip 连弹层一起住进输入卡，
// 头部不再自行算一份（composerChips 内部还是只调 permissionChipView 一次，真身没有第二份）。

/**
 * 装配层去重（Wave A 顾虑 1）：`error` 事件既进 items（时间线里的 error 块），
 * 又写 thread.lastError（useAgentStore.ts:237-240），同一句中文会显示两遍。
 * 但 lastError 还有三类**不产生时间线块**的来源——send 被边界拒绝（:320-324）、
 * stop 被拒绝（:340-345）、turn-end{failed}（:214）——所以不能简单砍掉单列段。
 * 规则：与时间线里最后一条 error 文本相同就不重复渲染，其余照旧显示。
 * 刻意不改 store 与 timeline 的语义（那是上游契约）。
 *
 * 【2026-10-25】去重比对的是**原始**文本（event.message 对 thread.lastError），
 * 翻译只发生在**显示**那一步（两处都走 contracts 的 presentableFailureMessage）——
 * 所以去重不会因为两边都翻过而错位。
 */
const lastTimelineError = computed(() => {
  const list = items.value;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index];
    if (event?.type === "error") return event.message;
  }
  return "";
});
const orphanError = computed(() => {
  const text = thread.value?.lastError ?? "";
  if (text === "" || text === lastTimelineError.value) return "";
  // 与时间线那条同一个真身（contracts）：屏上不出现原始英文异常。
  return presentableFailureMessage(text);
});

// 作品工作台（F-A + 示意稿 A）：判定全在 utils/workbench-state，这里只接线；hasBook 不设本地 computed，
// 统一读 store getter（T7-1 单一真身）。
const cards = computed(() =>
  workbenchCards({ hasBook: book.hasBook, docs: book.docs, activeChapter: book.activeDocTab })
);
const suggestions = computed(() =>
  workbenchSuggestions({ hasBook: book.hasBook, docs: book.docs, activeChapter: book.activeDocTab })
);
/** 往「这一章的线程」里填一句人话：卡片与 pill 共用这一条通路，差别只是句子从哪张表来。 */
function prefillChapterThread(target: string, text: string): void {
  void book.openDocTab(target); // 右栏进文稿态，线程随 threadKeyFor 绑定；预填才看得见
  agent.prefillComposer(threadKeyFor(target), text); // Task 4 通路
}

/**
 * 【§173】对话链上的「改一改再问」/「再问一次」：把那句话填回**这一格**的输入框。
 *
 * 为什么不自己写草稿：草稿的唯一写者是 `useAgentStore.setDraft`（F-A 定的纪律），
 * 预填的唯一入口是 `prefillComposer`（它还管「输入框里已经有字时不许覆盖」）。
 * 这里只补一句「成了没有」的话：被挡时那句中文由 store 自己说（摆在状态栏上），
 * 不在这里重复报一次。
 */
function onPrefillFromTimeline(text: string): void {
  const before = agent.draftOf(threadKey.value);
  agent.prefillComposer(threadKey.value, text);
  if (agent.draftOf(threadKey.value) !== before) notif.notify(PREFILL_NOTICE);
}
// 卡的点击协调（跨 book / agent 两个 store）只在这一处：空卡 ⇒ 引导去建，填字卡 ⇒ 开章 + 预填，其余 ⇒ 浏览。
// 2026-10-05 裁定：目标取卡片自带的 target（workbenchCards 算好的那一份），这里不重算第二遍。
function onWorkbenchPick(id: WorkbenchCardId): void {
  const card = cards.value.find((item) => item.id === id);
  if (card === undefined) return;
  const target = card.target;
  if (target === null) {
    // 这一类还没有文档：不再灰着点不动，而是请左栏展开该分组并进入行内新建（真身 guideToDoc）。
    layout.requestDocGroup(card.kind);
    return;
  }
  const text = WORKBENCH_CARD_PREFILL[id];
  if (text !== null) {
    prefillChapterThread(target, text);
    return;
  }
  const ref = book.refOf(target); // character / world / outline ⇒ 浏览，不动 docTabs / 草稿
  if (ref) book.browse(ref);
}
// pill 的两条出路（表在 workbench-state）：palette ⇒ 与 Ctrl+/, / 键同一个开关；prefill ⇒ 填进当前章线程。
function onWorkbenchSuggestion(suggestion: WorkbenchSuggestion): void {
  if (suggestion.kind === "palette") {
    // 裁定 D1：出路仍是「与裸 / 键、`/ 命令` chip 同一个入口」，真身换成行内菜单。
    referenceMenu.summon("/");
    return;
  }
  const target = workbenchTarget({
    id: "chief-write",
    docs: book.docs,
    activeChapter: book.activeDocTab
  });
  if (target === null) return; // pill 只在有目标时出场（workbenchSuggestions 已经这么判了）。
  prefillChapterThread(target, suggestion.prefill);
}

function decide(proposalId: string, decision: ProposalDecision, guidance: string): void {
  void agent.decide(proposalId, decision, guidance);
}

/**
 * 模型 ▾（#104）：打开即拉一次名单。缓存判定（「这一版配置拉过没有」）在 useProviderStore，
 * 这里只负责「什么时候要」；重试是同一件事的强制版，故传 true。
 *
 * 2026-10-07：随事件收下触发它的那枚 chip，下拉浮层贴在它下面（原先是居中模态遮罩）。
 */
function openModelSelect(anchor: HTMLElement): void {
  modelAnchor.value = anchor;
  modelsOpen.value = true;
  void provider.loadModels();
}

/**
 * 选中一条 = 切过去（2026-10-08 批次 5-㊺ 修的就是这一行）。
 *
 * 过去这里写的是 `provider.select(name)`，把**裸模型名**当草稿发下去；主进程收的是
 * `{model, connectionId}`，zod 当场拒收抛 "Invalid input"，错误又被吞进只在设置页渲染的
 * `error` ⇒ 点一行没反应、屏上零解释（真机实测，见 utils/model-switch.ts 的 WHY）。
 *
 * 现在只交模型名：连哪条连接由 store 从「启用中那条」取（那正是这份名单的来路），
 * 线格式由 utils/model-switch.ts 独占。组件不该知道 ProfileDraft 长什么样——
 * 它知道的只有「用户点了一行」，那是它真正知道的全部。
 *
 * 写回成功才关浮层：失败时浮层留着，用户要在原地看见 `provider.switchError`。
 */
async function chooseModel(name: string): Promise<void> {
  if (await provider.switchModel(name)) modelsOpen.value = false;
}

/**
 * 失败态的「去模型设置」出口（2026-10-05）：名单拉不到的原因多半是地址/密钥不对，
 * 而重试治不了它。走 layout 的唯一真身 showSettings（默认页就是 model），不另捏一条开设置的路。
 * 浮层随之关闭——设置中心是整页视图，浮层留着也没有宿主（App.vue 会把中栏整块换掉）。
 */
function openModelSettings(): void {
  modelsOpen.value = false;
  layout.showSettings("model");
}

/** 发送 = 投递这一轮 + 清掉这一格草稿（值已进对话流，留着会把上一句带进下一次输入）。
 * 这里的清空是乐观的：那一轮若被边界拒绝，`useAgentStore.send` 的 catch 是真身，会把这一格原样还回来。
 *
 * 「送出后清空输入框」那枚开关关掉时不清（2026-10-06 批次 5-⑧）：消息照发，
 * 字留在格子里由自己删。清空点只有这一处与 useHotkeys 的 submit 分支，两处读同一枚偏好。 */
function onComposerSend(text: string): void {
  agent.send(text);
  // 自己刚发的话必须先出现在眼前：他可能刚刚翻到上面在读，这一下要算「主动回到最新」，
  // 而不是「松手状态继续松着」（松手的话他连自己那句都看不见）。
  sticking.value = true;
  unseenBelow.value = false;
  schedulePin();
  if (clearComposerAfterSend()) {
    agent.clearDraft(threadKey.value);
  }
}

/**
 * 键位接线（spec §5）：全局 keydown 有且只有一处——现在住 App.vue（设置中心整页化后
 * 本组件在设置视图会被卸载，监听上移才能让 Ctrl+, / Esc 在设置页继续活着），这里不再装。
 * 这里删掉了原先的 onGlobalEscape —— 它的「Esc = 打断」已被 resolveEscape 的裁决（含收浮层那一支）取代，
 * 保留两处监听会变成两份 Esc 裁决（裁定 G5）。
 */

// 设置的可见性真身是 layout.currentView（设计决定 2）：
// 左栏的两枚入口、Ctrl+,、/model、Esc 全部读写同一个 currentView；整页视图挂载在 App.vue。

/**
 * 头部「新建对话」（照他的钮，动作走本仓已有的唯一真身）：清空**本页**显示，
 * 与左栏「本章新对话」调的是同一个 store action、同一个 threadKey computed，不另起第二份判据。
 * 没有开章时 threadKey 就是独立线程那一格——清的正是在看的那一条，所以这一枚不必禁用。
 */
function startNewConversation(): void {
  agent.clearThreadView(threadKey.value);
}

let timer: number | undefined;
onMounted(() => {
  agent.startListening();
  document.addEventListener("visibilitychange", onWindowVisibility);
  // 挂载就先贴一次底：切页回来 / 从设置中心回对话时，这一格里已经有整段历史，
  // 它默认停在最顶上——那是「上一轮的结尾」，不是「现在」。watch 只在**变化**时响，
  // 这一下只能在这里补。
  void nextTick(pinToBottom);
  // 挂载即读配置并**预拉模型清单**（2026-10-11）：过去名单只在点开「模型 ▾」那一刻才拉，
  // 首开必等一次网络往返；预拉进缓存后点开就是秒开。失败不落缓存，真打开时再试。
  void provider.warmModelCache();
  timer = window.setInterval(() => agent.tick(), 1000);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onWindowVisibility);
  if (pinFrame !== 0) cancelAnimationFrame(pinFrame);
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <main class="conversation-pane" :class="{ 'is-welcome': welcomeHome }" aria-label="智能体对话">
    <header class="conversation-header">
      <div class="conversation-heading-start">
        <div>
          <strong>{{ agentLabel }}</strong>
          <!-- 无书时不渲染这一行：没有书就没有「主上下文」，写个「无」只是把
               上面那句「未选择作品」再说一遍（恒真的空信息比没有更误导）。 -->
          <span v-if="book.meta" class="context-caption" :title="`主上下文：${contextTitle}`"
            >主上下文：{{ contextTitle }}</span
          >
        </div>
      </div>
      <div class="conversation-header-actions">
        <!-- #113e：他的头部动作区第一枚就是「历史对话」（AgentConversation.vue:274），排在「新建对话」之前。 -->
        <ConversationHistoryMenu />
        <!-- #105：权限档 chip 与 PermissionMenu 弹层真身一起搬进输入卡右端（deepwrite 的「更多」那一端）；
             头部再挂一枚就是同一个开关两份真身，故整块退役。
             #113d：同一格里改挂他的「新建对话」（AgentConversation.vue:281-288）。 -->
        <button
          class="header-text-button"
          type="button"
          :title="CLEAR_VIEW_SENTENCE"
          @click="startNewConversation"
        >
          <AppIcon name="plus" :size="16" />
          <!-- 批次 5-㉓：与历史对话那枚同一件事——文案包一层，窄栏只藏文字留图标。 -->
          <span class="header-text-button-label">新建对话</span>
        </button>
        <button
          v-if="rightCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开文本内容栏"
          @click="emit('toggleRight')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <div class="conversation-scroll-shell">
      <div
        ref="scrollEl"
        class="conversation-scroll transient-scrollbar"
        @scroll.passive="onConversationScroll"
      >
        <div v-if="messagesEmpty" class="conversation-empty">
          <BookWorkbench
            :has-book="book.hasBook"
            :agent-label="agentLabel"
            :cards="cards"
            :suggestions="suggestions"
            @pick="onWorkbenchPick"
            @suggestion="onWorkbenchSuggestion"
          />
          <p v-if="orphanError" class="error-line">{{ orphanError }}</p>
        </div>

        <div v-else-if="hydrating && !hydratedEmpty" class="conversation-empty">
          <p class="hydrating-line">正在恢复这一条线程…</p>
        </div>

        <div v-else class="message-list agent-column">
          <AgentTimeline
            :items="items"
            :tail="tail"
            :running="running"
            :emotion="assistantFace"
            @prefill="onPrefillFromTimeline"
          />

          <div v-if="openCards.length" class="proposal-stack">
            <ProposalCard
              v-for="card in openCards"
              :key="card.proposal.id"
              :view="card"
              :turn-label="turnLabel(card)"
              @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
            />
          </div>

          <!-- 已裁决的卡默认折叠（F-1：不再把「已写入」也摊在最底部抢位置）。 -->
          <details v-if="settledCards.length" class="settled-stack">
            <summary class="settled-summary">已裁决的提案 · {{ settledCards.length }} 条</summary>
            <div class="settled-cards">
              <ProposalCard
                v-for="card in settledCards"
                :key="card.proposal.id"
                :view="card"
                :turn-label="turnLabel(card)"
                @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
              />
            </div>
          </details>

          <!-- 上次会话未处理（D1）：回放的未裁决卡，按钮禁用，绝不伪装成可批准。 -->
          <details v-if="expiredCards.length" class="expired-stack">
            <summary class="expired-summary">
              {{ PROPOSAL_STATUS_LABELS.expired }} · {{ expiredCards.length }} 条
            </summary>
            <div class="expired-cards">
              <ProposalCard
                v-for="card in expiredCards"
                :key="card.proposal.id"
                :view="card"
                :turn-label="turnLabel(card)"
                @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
              />
            </div>
          </details>

          <p v-if="orphanError" class="turn-error">{{ orphanError }}</p>

          <!-- 写后自动体检：只在真的写过、且查出东西时出现（store 已把「没跑过」与「跑过没毛病」分开）。 -->
          <AutoCheckupCard :thread-key="threadKey" />
        </div>
      </div>

      <!-- 松手之后才会出现（`unseenBelow`）：下面在长东西，给一枚回去的钮。
           它挂在 scroll-shell 上、不跟着滚——挂在滚动容器里的话，滚上去之后它自己也滚没了。 -->
      <button v-if="unseenBelow" class="scroll-to-bottom" type="button" @click="jumpToBottom">
        <AppIcon class="scroll-to-bottom-icon" name="chevron" :size="13" />
        <span>回到最新</span>
      </button>
    </div>

    <!-- 多稿候选面板（P0-②）：贴在中栏转录区与输入区之间——它说的是「刚刚这一轮跑出来的几稿」，
         属于转录区那一段内容，不该被挤到状态栏下面（状态栏贴着输入卡，还兼顾挑完之后的回执）。 -->
    <DraftCandidates
      v-if="draftSet"
      :drafts="draftSet.drafts"
      :draft-set-id="draftSet.draftSetId"
      @pick="(index) => void agent.pickDraft(index)"
      @discard="void agent.discardDrafts()"
    />

    <div class="agent-statusbar">
      <span class="status-line">{{ statusLine }}</span>
      <!-- 「继续」这一枚（2026-11-20）：上一轮收得不好时给一条真出口。
           它在状态栏里而不是时间线上，因为状态栏本来就是"上一轮怎么了"的那一行；
           悬停说明写清这一下会发生什么（重发上一句），不许让它变成一句黑箱按钮。 -->
      <button
        v-if="resumeAffordance"
        class="status-action status-action-resume"
        type="button"
        :title="resumeAffordance.title"
        @click="resumeTurn"
      >
        {{ resumeAffordance.label }}
      </button>
      <span v-if="book.notice" class="status-note">{{ book.notice }}</span>
      <span v-if="agent.notice" class="status-note status-note-agent">{{ agent.notice }}</span>
      <!-- 落盘失败不能只报不救：查看是哪几份、再存一次，都在这条状态栏上。 -->
      <span v-if="flushFailedNames" class="status-flush">
        <span class="status-note">设定未存好</span>
        <button type="button" class="status-action" @click="revealFlushFailures">查看</button>
        <button type="button" class="status-action" :disabled="flushRetrying" @click="retryFlush">
          {{ flushRetrying ? "正在重试…" : "重试保存" }}
        </button>
      </span>
      <!-- 上下文占用读数（2026-11-20 · 主线第一刀）：原先挂在输入卡上方的绑定条里，
           而绑定条只在「这一格还没有消息」时显形——于是对话一开始，这个读数就永久消失，
           而那恰恰是长会话最需要它的时候（这一轮还能塞下多少）。
           状态栏是常驻的那一行：作者每轮结束都会扫它一眼，读数落在这里才对。 -->
      <ContextMeter />
    </div>

    <ComposerBox
      :welcome="welcomeHome"
      :running="running"
      :ready="ready"
      :model-value="agent.draftOf(threadKey)"
      :has-book="book.hasBook"
      :context-bar-visible="contextBarVisible"
      :permission-mode="book.meta?.permissionMode ?? null"
      :work-mode="workModeOf(book.meta ?? {})"
      :permission-saving="book.metaSaving"
      :permission-menu-open="book.hasBook && book.permissionMenuOpen"
      :thinking-level="agent.thinkingLevel"
      :thinking-wire="provider.activeThinkingWire"
      :web-search-enabled="agent.webSearchEnabled"
      :sample-count="agent.sampleCount"
      :disabled-tools="agent.disabledTools"
      :model-label="provider.modelLabel"
      :base-url="provider.activeBaseURL"
      @update:model-value="agent.setDraft(threadKey, $event)"
      @send="onComposerSend"
      @stop="agent.stop()"
      @open-permission-menu="book.togglePermissionMenu()"
      @close-permission-menu="book.closePermissionMenu()"
      @toggle-work-mode="void book.toggleWorkMode()"
      @cycle-thinking="agent.cycleThinking()"
      @toggle-web-search="agent.toggleWebSearch()"
      @cycle-draft-sample="agent.cycleDraftSample()"
      @open-tool-roster="rosterOpen = true"
      @toggle-tool="agent.toggleTool($event)"
      @open-model-select="openModelSelect"
      @open-palette="referenceMenu.summon('/')"
      @run-command="referenceMenu.runCommand($event)"
      @open-mention="referenceMenu.summon('@')"
    />

    <!-- #106 裁定 D1：`/` 的真身只剩输入卡里那份行内菜单（ComposerBox 挂的 ComposerReferenceMenu），
         旧的第二块命令面板连同它的样式段一并退役——留着它就是同一张命令表两份渲染。 -->
    <ToolRoster
      v-if="rosterOpen"
      :web-search-enabled="agent.webSearchEnabled"
      :disabled-tools="agent.disabledTools"
      @toggle="agent.toggleTool"
      @close="rosterOpen = false"
    />
    <!-- 贴 chip 的下拉（2026-10-07）：锚点是点开它的那枚 chip，元素随事件一起交上来。
         v-if 上多一个 modelAnchor —— 没有锚点就不渲染，绝不弹一个飞到屏幕角落的黑盒。 -->
    <ModelSelect
      v-if="modelsOpen && modelAnchor"
      :anchor="modelAnchor"
      :result="provider.models"
      :loading="provider.modelsLoading"
      :current="provider.modelLabel"
      :switching="provider.switching"
      :switch-error="provider.switchError"
      @close="modelsOpen = false"
      @retry="provider.loadModels(true)"
      @open-settings="openModelSettings"
      @select="(name) => void chooseModel(name)"
    />
  </main>
</template>

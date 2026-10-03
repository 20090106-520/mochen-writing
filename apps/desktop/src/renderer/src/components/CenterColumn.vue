<!-- 中栏骨架（conversation-pane / conversation-header / conversation-scroll-shell / conversation-empty）
     取自 deepwrite（Apache-2.0）；卡片与时间线为自有。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PROPOSAL_STATUS_LABELS, type AgentEvent, type ProposalDecision } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import AgentTimeline from "./AgentTimeline.vue";
import ProposalCard from "./ProposalCard.vue";
import ComposerBox from "./ComposerBox.vue";
import ProviderSettings from "./ProviderSettings.vue";
import ToolRoster from "./ToolRoster.vue";
import ModelSelect from "./ModelSelect.vue";
import BookWorkbench from "./BookWorkbench.vue";
import { cardTurnLabel, splitProposalCards, turnAnchors } from "../utils/timeline";
import {
  WORKBENCH_CARD_PREFILL,
  workbenchCards,
  workbenchSuggestions,
  workbenchTarget,
  type WorkbenchCardId,
  type WorkbenchSuggestion
} from "../utils/workbench-state";
import { useGlobalHotkeys } from "../composables/useHotkeys";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useProviderStore } from "../stores/useProviderStore";
import { useReferenceMenuStore } from "../stores/useReferenceMenuStore";
import {
  composeStatusLine,
  threadKeyFor,
  useAgentStore,
  type ProposalView,
  type ThreadView
} from "../stores/useAgentStore";

defineProps<{ leftCollapsed: boolean; rightCollapsed: boolean }>();
const emit = defineEmits<{ toggleLeft: []; toggleRight: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const layout = useLayoutStore();
const provider = useProviderStore();
const showSettings = computed(() => layout.currentView === "settings");
/** #106 裁定 D1：`/` 的真身只剩行内引用菜单一处，唤起态也跟着它住进 store（键位层要能派下来）。 */
const referenceMenu = useReferenceMenuStore();
/** 工具 ▾ 的浮层是瞬时 UI 态，不进 store（计划决定 6），关掉不带走任何状态。 */
const rosterOpen = ref(false);
/** 模型 ▾ 也是瞬时 UI 态；名单本身归 useProviderStore（切完模型它还活着，关掉浮层不该重拉）。 */
const modelsOpen = ref(false);
const EMPTY_ITEMS: AgentEvent[] = [];
const EMPTY_TAIL = { reasoning: "", message: "" };

const threadKey = computed(() => threadKeyFor(book.activeDocTab));
const thread = computed<ThreadView | undefined>(() => agent.threads[threadKey.value]);
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
const statusLine = computed(() =>
  composeStatusLine(
    thread.value,
    agent.seconds,
    agent.pendingOf(threadKey.value),
    thread.value?.queued.length ?? 0
  )
);
const ready = computed(() => book.hasBook);

const agentLabel = computed(() => {
  const stage = book.meta?.stages.find((item) => item.id === book.meta?.activeStage);
  return stage ? `${stage.name}智能体` : "未选择作品";
});
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
  return text === "" || text === lastTimelineError.value ? "" : text;
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
// 卡的点击协调（跨 book / agent 两个 store）只在这一处：填字卡 ⇒ 开章 + 预填，其余 ⇒ 浏览。
function onWorkbenchPick(id: WorkbenchCardId): void {
  const target = workbenchTarget({ id, docs: book.docs, activeChapter: book.activeDocTab });
  if (target === null) return; // disabled 卡点不到；防御性早退。
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
 */
function openModelSelect(): void {
  modelsOpen.value = true;
  void provider.loadModels();
}

/** 选中一条 = 只改 model 那一个字段（baseURL 与密钥原样留在主进程），写回成功才关浮层。 */
async function chooseModel(name: string): Promise<void> {
  if (await provider.select(name)) modelsOpen.value = false;
}

/** 发送 = 投递这一轮 + 清掉这一格草稿（值已进对话流，留着会把上一句带进下一次输入）。
 * 这里的清空是乐观的：那一轮若被边界拒绝，`useAgentStore.send` 的 catch 是真身，会把这一格原样还回来。 */
function onComposerSend(text: string): void {
  agent.send(text);
  agent.clearDraft(threadKey.value);
}

/**
 * 键位接线（spec §5）：全局 keydown 有且只有一处，就在 useGlobalHotkeys 里。
 * 这里删掉了原先的 onGlobalEscape —— 它的「Esc = 打断」已被 resolveEscape 的裁决（含收浮层那一支）取代，
 * 保留两处监听会变成两份 Esc 裁决（裁定 G5）。判断一律在 utils，本组件只接线。
 */
useGlobalHotkeys({ openPalette: () => referenceMenu.summon("/") });

// 设置浮层可见性的唯一真身是 layout.currentView === "settings"（设计决定 2）：
// 按钮、Ctrl+,、/model、Esc 收浮层全部读写同一个 currentView，不再有两处真相。
function closeSettings(): void {
  layout.showWorkspace();
}

let timer: number | undefined;
onMounted(() => {
  agent.startListening();
  // 模型 chip 一挂出来就要报得出当前模型名：配置读一次，失败由 store 收成一句中文理由。
  void provider.refresh();
  timer = window.setInterval(() => agent.tick(), 1000);
});
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <main class="conversation-pane" aria-label="智能体对话">
    <header class="conversation-header">
      <div class="conversation-heading-start">
        <button
          v-if="leftCollapsed"
          class="icon-button"
          type="button"
          aria-label="展开左侧栏"
          @click="emit('toggleLeft')"
        >
          <AppIcon name="panel-left" :size="18" />
        </button>
        <div>
          <strong>{{ agentLabel }}</strong>
          <span class="context-caption">主上下文：{{ contextTitle }}</span>
        </div>
      </div>
      <div class="conversation-header-actions">
        <!-- #105：权限档 chip 与 PermissionMenu 弹层真身一起搬进输入卡右端（deepwrite 的「更多」那一端）；
             头部再挂一枚就是同一个开关两份真身，故整块退役。 -->
        <button class="header-text-button" type="button" @click="layout.showSettings()">
          <AppIcon name="settings" :size="15" />
          <span>模型设置</span>
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
      <div class="conversation-scroll transient-scrollbar">
        <div
          v-if="
            items.length === 0 &&
            !running &&
            !hydrating &&
            openCards.length === 0 &&
            settledCards.length === 0 &&
            expiredCards.length === 0
          "
          class="conversation-empty"
        >
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
          <AgentTimeline :items="items" :tail="tail" />

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
        </div>
      </div>
    </div>

    <div class="agent-statusbar">
      <span class="status-line">{{ statusLine }}</span>
      <span v-if="book.notice" class="status-note">{{ book.notice }}</span>
      <span v-if="agent.notice" class="status-note status-note-agent">{{ agent.notice }}</span>
    </div>

    <ComposerBox
      :running="running"
      :ready="ready"
      :can-continue="agent.canContinue(threadKey)"
      :model-value="agent.draftOf(threadKey)"
      :has-book="book.hasBook"
      :permission-mode="book.meta?.permissionMode ?? null"
      :permission-saving="book.metaSaving"
      :permission-menu-open="book.hasBook && book.permissionMenuOpen"
      :thinking-level="agent.thinkingLevel"
      :web-search-enabled="agent.webSearchEnabled"
      :model-label="provider.modelLabel"
      :base-url="provider.view?.baseURL ?? ''"
      @update:model-value="agent.setDraft(threadKey, $event)"
      @send="onComposerSend"
      @stop="agent.stop()"
      @resume="agent.continueTurn()"
      @open-permission-menu="book.togglePermissionMenu()"
      @close-permission-menu="book.closePermissionMenu()"
      @cycle-thinking="agent.cycleThinking()"
      @toggle-web-search="agent.toggleWebSearch()"
      @open-tool-roster="rosterOpen = true"
      @open-model-select="openModelSelect"
      @open-palette="referenceMenu.summon('/')"
      @open-mention="referenceMenu.summon('@')"
    />

    <ProviderSettings v-if="showSettings" @close="closeSettings" />

    <!-- #106 裁定 D1：`/` 的真身只剩输入卡里那份行内菜单（ComposerBox 挂的 ComposerReferenceMenu），
         旧的第二块命令面板连同它的样式段一并退役——留着它就是同一张命令表两份渲染。 -->
    <ToolRoster v-if="rosterOpen" @close="rosterOpen = false" />
    <ModelSelect
      v-if="modelsOpen"
      :result="provider.models"
      :loading="provider.modelsLoading"
      :current="provider.modelLabel"
      :switching="provider.switching"
      @close="modelsOpen = false"
      @retry="provider.loadModels(true)"
      @select="(name) => void chooseModel(name)"
    />
  </main>
</template>

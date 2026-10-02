<!-- 中栏骨架（conversation-pane / conversation-header / conversation-scroll-shell / conversation-empty）
     取自 deepwrite（Apache-2.0）；卡片与时间线为自有。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  type AgentEvent,
  type ProposalDecision
} from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import AgentTimeline from "./AgentTimeline.vue";
import ProposalCard from "./ProposalCard.vue";
import ComposerBox from "./ComposerBox.vue";
import ProviderSettings from "./ProviderSettings.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { cardTurnLabel, splitProposalCards, turnAnchors } from "../utils/timeline";
import { useBookStore } from "../stores/useBookStore";
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
const showSettings = ref(false);
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
watch(
  [() => book.rootPath, threadKey],
  ([root]) => {
    if (root !== null) void agent.ensureHydrated(threadKeyFor(book.activeDocTab));
  },
  { immediate: true }
);
const statusLine = computed(() =>
  composeStatusLine(thread.value, agent.seconds, agent.pendingOf(threadKey.value))
);
const ready = computed(() => book.meta !== null);

const agentLabel = computed(() => {
  const stage = book.meta?.stages.find((item) => item.id === book.meta?.activeStage);
  return stage ? `${stage.name}智能体` : "未选择作品";
});
const contextTitle = computed(() => {
  if (!book.meta) return "无";
  const chapter = book.docs.find((doc) => doc.relPath === book.activeDocTab);
  return `${book.meta.title} · ${chapter ? chapter.title : "未打开章节"}`;
});
// 档位文案的唯一来源是 contracts（主进程的拒绝文案与系统提示都读它）；
// 这里手抄三元链的话，两处迟早漂——与 TOOL_LABELS 用 AgentToolName 穷尽同一道理。
const permissionLabel = computed(
  () => PERMISSION_LABELS[book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE]
);

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

function decide(proposalId: string, decision: ProposalDecision, guidance: string): void {
  void agent.decide(proposalId, decision, guidance);
}

function onGlobalEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // 卡内的 Esc 已在 ProposalCard 里 stopPropagation；走到这里只剩「打断」这一义（spec §6.2）。
  if (running.value) void agent.stop();
}

let timer: number | undefined;
onMounted(() => {
  agent.startListening();
  timer = window.setInterval(() => agent.tick(), 1000);
  document.addEventListener("keydown", onGlobalEscape);
});
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
  document.removeEventListener("keydown", onGlobalEscape);
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
        <span class="permission-chip">{{ permissionLabel }}</span>
        <button class="header-text-button" type="button" @click="showSettings = true">
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
          <span class="empty-agent-mark">
            <img :src="brandMark" alt="" width="52" height="52" />
          </span>
          <h1>{{ agentLabel }}</h1>
          <p>
            说人话就行——它会自己读文档、给出逐条待审的改稿提案；
            你不点批准，它一个字也写不进作品目录。
          </p>
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
              :running="running"
              :turn-label="turnLabel(card)"
              @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
              @interrupt="agent.stop()"
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
                :running="running"
                :turn-label="turnLabel(card)"
                @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
                @interrupt="agent.stop()"
              />
            </div>
          </details>

          <!-- 上次会话未处理（D1）：回放的未裁决卡，按钮禁用，绝不伪装成可批准。 -->
          <details v-if="expiredCards.length" class="expired-stack">
            <summary class="expired-summary">上次会话未处理 · {{ expiredCards.length }} 条</summary>
            <div class="expired-cards">
              <ProposalCard
                v-for="card in expiredCards"
                :key="card.proposal.id"
                :view="card"
                :running="running"
                :turn-label="turnLabel(card)"
                @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
                @interrupt="agent.stop()"
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
      @send="agent.send($event)"
      @stop="agent.stop()"
      @resume="agent.continueTurn()"
    />

    <ProviderSettings v-if="showSettings" @close="showSettings = false" />
  </main>
</template>

<!-- #113e 中栏头部「历史对话」浮层。真身：deepwrite components/ConversationHistoryMenu.vue——
     容器/遮罩/section[role=dialog]/行内三件套的 DOM 与 a11y 属性一字对齐，数值住在同名的全局表
     styles/conversation-history.css（他那份也是全局表，不在 scoped 里）。
     三处刻意的不同，都因为本仓没有他那份契约：
     1) 数据源：他从上层传 conversationHistory/currentSessionId/responding 四个 prop；本仓的会话总览
        只有 agent:list-sessions 一条通道，直接读 store 反而少一层同名中转（先例：ComposerContextBar）。
     2) 删除/恢复/导出/「全部-已删除」页签四件不复用：主进程只有读（listSessions/loadSession），
        没有软删通道也没有导出通道，搬进来就是点了没反应的假控件（铁律⑥）。
     3) 行的禁用理由不在组件里拼句子：unbound/文稿已删/正在看/正在回复四档只住在
        utils/session-row-action.ts 一份，store 的 rowActionFor 是唯一装配点（铁律①）。
     标题也不照他的 preview 副行抄：SessionListItem 没有 preview 字段，副行改放这条会话属于哪一篇文稿。 -->
<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { formatHistoryTime } from "../utils/history-time";
import { useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { sessionDocLabel, sessionTitle } from "../utils/work-items";
import { type SessionListItem } from "@mochen/contracts";

const agent = useAgentStore();
const book = useBookStore();

// 开合与读取中都是这一格的局部 UI 态（关掉不带走状态），不进 store。
const open = ref(false);
const loading = ref(false);
const panelId = useId();

// 没有书就没有会话可列（listSessions 在主干直接以「未选作品目录」拒绝），所以这一格缺书时是真空状态而非空列表。
const triggerReason = computed(() =>
  book.hasBook ? "历史对话" : "还没有打开作品目录，没有历史对话可看。"
);

watch(open, async (value) => {
  if (!value) return;
  loading.value = true;
  await agent.refreshSessions();
  loading.value = false;
});

function rowOf(item: SessionListItem) {
  return agent.rowActionFor(item);
}

function docLabel(item: SessionListItem): string {
  // 2026-10-23：没绑文稿的线程，docRelPath 就是哨兵 "unbound"——真机上副行直接印着这串英文，
  // 那是跨进程契约里的值，不是给人看的字。这里只换这一种，查不到真名时仍退回路径（名字可以土，不能假）。
  //
  // 【§174】这段判据搬进了 utils/work-items.ts：**左栏那枚「工作项」面板也用同一份**，
  // 两块面板各写一遍文案，改一边忘了另一边，两边就会对不上（铁律 6）。
  return sessionDocLabel(item, (relPath) => book.refOf(relPath)?.title ?? relPath);
}

function titleOf(item: SessionListItem): string {
  const action = rowOf(item);
  return action.kind === "open" ? docLabel(item) : action.reason;
}

async function pick(item: SessionListItem): Promise<void> {
  open.value = false;
  await agent.showSession(item);
}
</script>

<template>
  <div class="conversation-history-control" @keydown.esc.stop="open = false">
    <button
      class="header-text-button"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="panelId"
      aria-label="历史对话"
      :title="triggerReason"
      :disabled="!book.hasBook"
      @click="open = !open"
    >
      <AppIcon name="history" :size="16" />
      <!-- 批次 5-㉓：文案包一层 span，窄栏那一级才能只藏文字、留下图标。
           裸文本节点没法被 display:none 选中（CSS 选不中文本节点），所以必须是元素。 -->
      <span class="header-text-button-label">历史对话</span>
    </button>
    <div
      v-if="open"
      class="conversation-history-dismiss"
      aria-hidden="true"
      @mousedown="open = false"
    />
    <section
      v-if="open"
      :id="panelId"
      class="conversation-history-panel"
      role="dialog"
      aria-label="历史对话"
    >
      <header>
        <div class="conversation-history-heading">
          <strong>历史对话</strong>
          <span>{{ agent.sessions.length }} 条</span>
        </div>
        <button type="button" aria-label="关闭历史对话" @click="open = false">
          <AppIcon name="close" :size="15" />
        </button>
      </header>
      <div v-if="agent.sessions.length" class="conversation-history-list">
        <button
          v-for="item in agent.sessions"
          :key="item.sessionId"
          class="conversation-history-item"
          :class="{ 'is-current': rowOf(item).kind === 'current' }"
          :aria-current="rowOf(item).kind === 'current' ? 'true' : undefined"
          type="button"
          :disabled="rowOf(item).kind !== 'open'"
          :title="titleOf(item)"
          @click="pick(item)"
        >
          <span class="conversation-history-copy">
            <span class="conversation-history-title-row">
              <strong>{{ sessionTitle(item) }}</strong>
              <time :datetime="item.startedAt">{{ formatHistoryTime(item.startedAt) }}</time>
            </span>
            <small>{{ docLabel(item) }}</small>
          </span>
        </button>
      </div>
      <div v-else class="conversation-history-empty">
        <AppIcon name="history" :size="22" />
        <strong>{{ loading ? "正在读取对话" : "还没有历史对话" }}</strong>
      </div>
    </section>
  </div>
</template>

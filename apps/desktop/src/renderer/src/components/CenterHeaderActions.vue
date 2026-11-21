<!--
  中栏头部的动作区（2026-11-20 自 CenterColumn 拆出）。

  【为什么拆】CenterColumn 贴着 800 行预算，这一轮挂通知中心时越线了 11 行。
  拆的依据是「不共享状态」：头部动作区（历史对话 / 通知中心 / 新建对话 / 展开右栏）
  与消息流、滚动跟随、体检卡装配不共享任何状态——它只读 agent/book 两个 store，
  唯一的对外事件是「展开右栏」。
-->
<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import ConversationHistoryMenu from "./ConversationHistoryMenu.vue";
import NotificationCenter from "./NotificationCenter.vue";
import { CLEAR_VIEW_SENTENCE, threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

defineProps<{ rightCollapsed: boolean }>();
const emit = defineEmits<{ toggleRight: [] }>();

const agent = useAgentStore();
const book = useBookStore();
const threadKey = computed(() => threadKeyFor(book.activeDocTab));

/**
 * 头部「新建对话」（照他的钮，动作走本仓已有的唯一真身）：清空**本页**显示，
 * 与左栏「本章新对话」调的是同一个 store action、同一个 threadKey computed，不另起第二份判据。
 * 没有开章时 threadKey 就是独立线程那一格——清的正是在看的那一条，所以这一枚不必禁用。
 */
function startNewConversation(): void {
  agent.clearThreadView(threadKey.value);
}
</script>

<template>
  <div class="conversation-header-actions">
    <!-- #113e：他的头部动作区第一枚就是「历史对话」（AgentConversation.vue:274），排在「新建对话」之前。 -->
    <ConversationHistoryMenu />
    <!-- 通知中心（2026-11-20 通知整修 A2）：store 里攒了 50 条历史与未读数，一直没 UI 出口——
         这一格是那个出口。Toast 的「+N」徽章与这枚触发钮开的是同一份开合真身。 -->
    <NotificationCenter />
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
</template>

<!-- 中栏：结构与类名取自 deepwrite（Apache-2.0）的 AgentConversation.vue / ConversationMessageList.vue -->
<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { useBookStore } from "../stores/useBookStore";

defineProps<{ leftCollapsed: boolean; rightCollapsed: boolean }>();
const emit = defineEmits<{ toggleLeft: []; toggleRight: [] }>();

const book = useBookStore();

const agentLabel = computed(() => {
  const stage = book.meta?.stages.find((s) => s.id === book.meta?.activeStage);
  return stage ? `${stage.name}智能体` : "未选择作品";
});

const contextTitle = computed(() => {
  if (!book.meta) return "无";
  const chapter = book.docs.find((doc) => doc.relPath === book.activeDocTab);
  return `${book.meta.title} · ${chapter ? chapter.title : "未打开章节"}`;
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
        <div class="conversation-empty">
          <span class="empty-agent-mark">
            <img :src="brandMark" alt="" width="52" height="52" />
          </span>
          <h1>{{ agentLabel }}</h1>
          <p>
            对话、思考过程与受控改稿在下一切片接入；本壳已就位的是三栏布局、
            作品上下文与文稿审批通路。
          </p>
        </div>
      </div>
    </div>
  </main>
</template>

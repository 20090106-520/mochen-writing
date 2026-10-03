<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { IconName } from "../types/icons";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { useBookStore } from "../stores/useBookStore";
import type { WorkbenchCard, WorkbenchCardId } from "../utils/workbench-state";

defineProps<{ hasBook: boolean; agentLabel: string; cards: WorkbenchCard[] }>();
const emit = defineEmits<{ pick: [id: WorkbenchCardId] }>();

const book = useBookStore();
const CARD_ICONS: Record<WorkbenchCardId, IconName> = {
  "chief-write": "wand",
  character: "user",
  world: "globe",
  outline: "list"
};
// 无书降级的「打开作品目录」走 book.pickAndOpen() —— 与左栏、Ctrl+O 同一真身，不复制逻辑。
async function openBook(): Promise<void> {
  await book.pickAndOpen();
}
</script>

<template>
  <div class="book-workbench">
    <span class="empty-agent-mark">
      <img :src="brandMark" alt="" width="52" height="52" />
    </span>
    <h1>{{ agentLabel }}</h1>
    <p class="workbench-lead">
      说人话就行——它会自己读文档、给出逐条待审的改稿提案；你不点批准，它一个字也写不进作品目录。
    </p>

    <nav v-if="hasBook" class="workbench-cards" aria-label="作品工作台">
      <button
        v-for="card in cards"
        :key="card.id"
        class="workbench-card"
        type="button"
        :disabled="!card.enabled"
        :title="card.hint"
        @click="emit('pick', card.id)"
      >
        <AppIcon :name="CARD_ICONS[card.id]" :size="18" />
        <span class="workbench-card-label">{{ card.label }}</span>
        <span class="workbench-card-hint">{{ card.hint }}</span>
      </button>
    </nav>

    <div v-else class="workbench-empty-book">
      <p>还没有打开作品目录。先打开一个，工作台的四张卡才会各就各位。</p>
      <button class="workbench-open-book" type="button" @click="openBook">
        <AppIcon name="directory" :size="16" />
        <span>打开作品目录</span>
      </button>
    </div>
  </div>
</template>

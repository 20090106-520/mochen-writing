<!-- / 命令面板：↑↓ 选择、Enter 执行、Esc 关闭。四个键在组件内吃掉并 stopPropagation
     （spec §5 护栏 5）——全局 keydown 因此拿不到面板的 Esc，resolveEscape 不加第四优先级。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import {
  SLASH_COMMAND_DESCRIPTIONS,
  filterCommands,
  parseSlashInput,
  paletteOwnsKey,
  type SlashCommand
} from "../utils/slash-commands";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const emit = defineEmits<{ close: [] }>();

const agent = useAgentStore();
const book = useBookStore();
const typed = ref("/");
const cursor = ref(0);
const box = ref<HTMLInputElement | null>(null);

const candidates = computed<SlashCommand[]>(() =>
  filterCommands(typed.value, {
    hasBook: book.rootPath !== null,
    turnRunning: agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false
  })
);
const parsed = computed(() => parseSlashInput(typed.value));

// 光标越界（过滤后列表变短）时收回最后一行：唯一的越界处理，写在 computed 里避免副作用。
const shownCursor = computed(() =>
  candidates.value.length === 0 ? 0 : Math.min(cursor.value, candidates.value.length - 1)
);

function argumentFor(command: SlashCommand): string {
  return parsed.value.command === command ? parsed.value.argument : "";
}

function move(delta: number): void {
  const total = candidates.value.length;
  if (total === 0) return;
  cursor.value = (cursor.value + delta + total) % total;
}

function run(): void {
  // 执行的是用户眼前高亮的那一行：cursor 可能大于过滤后列表（列表变短只由 shownCursor 夹住显示），
  // 若这里读 cursor 就会「有高亮却 Enter 空转」。与显示口径保持一致。
  const command = candidates.value[shownCursor.value];
  if (!command) return;
  agent.runSlashCommand(command, argumentFor(command));
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (!paletteOwnsKey(event.key, event.isComposing === true)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowDown") move(1);
  if (event.key === "ArrowUp") move(-1);
  if (event.key === "Enter") run();
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  void nextTick(() => box.value?.focus());
});
</script>

<template>
  <div class="slash-mask" @click.self="emit('close')">
    <div
      class="slash-palette"
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      @keydown="onKeydown"
    >
      <input
        ref="box"
        v-model="typed"
        class="slash-input"
        type="text"
        spellcheck="false"
        placeholder="/ 命令（↑↓ 选择，Enter 执行，Esc 关闭）"
        @input="cursor = 0"
      />
      <ul v-if="candidates.length" class="slash-list" role="listbox" aria-label="可用命令">
        <li
          v-for="(command, index) in candidates"
          :key="command"
          :class="['slash-row', { 'is-cursor': index === shownCursor }]"
          role="option"
          :aria-selected="index === shownCursor"
          @mouseenter="cursor = index"
          @click="run"
        >
          <code class="slash-name">/{{ command }}</code>
          <span class="slash-desc">{{ SLASH_COMMAND_DESCRIPTIONS[command] }}</span>
        </li>
      </ul>
      <p v-else class="slash-empty">没有匹配的命令——这一步还没接通的通路不会列出来。</p>
    </div>
  </div>
</template>

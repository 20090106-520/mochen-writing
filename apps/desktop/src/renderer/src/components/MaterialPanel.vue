<!-- 素材库面板（2026-10-23）。
     入口是右栏头部一枚按钮，锚点就是那颗按钮本身（与伏笔台账 / 时间线核对 / 人物核对同一套路子）。

     它解决的是「素材库只是一个文稿分组、没有自己的地方」：这里把全书 materials/ 下的每一篇列出来，
     并给两条真动作——导入存量文本到素材库、让 AI 把读到的资料整理成素材卡。
     清单直接从 book.docs 派生（不落第二本账），样式在 styles/material-panel.css。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const layout = useLayoutStore();
const agent = useAgentStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 430 }
);

/** 素材 = kind 为 material 的文稿。清单是派生的，没有第二份账。 */
const entries = computed(() => book.docs.filter((doc) => doc.kind === "material"));

/** 点某一篇 → 右栏打开它，浮层收起（与另外三张台账同一条口径）。 */
async function openEntry(relPath: string): Promise<void> {
  await book.openDocTab(relPath);
  emit("close");
}

/**
 * 导入存量文本到素材库：走既有那条导入通路（`layout.openImportTxt` → ImportTxtDialog，
 * 那里已带「章节 / 素材库」目标开关）。这里不另造一套导入，只把入口摆到素材库手边。
 */
function importInto(): void {
  emit("close");
  layout.openImportTxt("material");
}

/**
 * 让 AI 整理入库：预填一句指令，**不自动发送**（发送权在用户手里，
 * 与去 AI 味 / 书稿体检 / 左栏检查同一条纪律）。落库那一步仍受 write_doc 的逐条审批。
 */
function askAgent(): void {
  emit("close");
  agent.prefillComposer(
    threadKeyFor(book.activeDocTab),
    "请把这次找到的资料整理成素材卡：先用 web_search / web_read 取到要用的原文，再逐篇用 " +
      "write_doc 写进 materials/ 下的文稿（一篇一个主题，标题写清是什么东西），" +
      "每篇开头用一句话说清它是什么、能用在哪儿。写完列一下你建了哪几篇。"
  );
}

function keydown(event: KeyboardEvent): void {
  const mods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  // 组合态里那一键归输入法：判据是 imeOwnsKey 这一份真身，不在下面再抄一遍裸比较。
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "Tab") tab(event);
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="material-panel"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="素材库"
      @keydown="keydown"
    >
      <header class="material-panel-head">
        <strong>素材库</strong>
        <span class="material-panel-count">{{ entries.length }} 篇</span>
        <button class="context-picker-close" type="button" aria-label="关闭素材库" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="material-panel-note">
        素材是给 AI 读的参考材料（设定、资料、灵感），落在 <code>materials/</code> 下。
        写稿时它们会一起进上下文，模型据此保持前后一致。
      </p>

      <p v-if="entries.length === 0" class="material-panel-empty">
        这本书还没有素材。点下面「导入文本到素材库」把存量的设定 / 资料导进来， 或点「让 AI
        整理入库」把刚查到的资料整理成卡片。
      </p>

      <ul v-else class="material-panel-list">
        <li v-for="doc in entries" :key="doc.relPath">
          <button class="material-entry" type="button" @click="void openEntry(doc.relPath)">
            <AppIcon name="archive" :size="14" />
            <span class="material-entry-title">{{ doc.title }}</span>
            <span class="material-entry-meta"
              >{{ (doc.chars ?? 0).toLocaleString("zh-CN") }} 字</span
            >
          </button>
        </li>
      </ul>

      <footer class="material-panel-actions">
        <button class="material-action" type="button" @click="importInto">
          <AppIcon name="plus" :size="14" />
          导入文本到素材库
        </button>
        <button class="material-action" type="button" :disabled="!book.hasBook" @click="askAgent">
          <AppIcon name="sparkles" :size="14" />
          让 AI 整理入库
        </button>
      </footer>
    </section>
  </Teleport>
</template>

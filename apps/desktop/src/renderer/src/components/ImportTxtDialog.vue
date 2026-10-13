<!-- 导入 TXT 对话框（2026-10-11）：选文件 → 预览切章 → 确认落盘。
     开合真身是 layout.importTxtOpen（App.vue 按 v-if 挂载，与 NewBookDialog 同一套开合法）。
     选文件与切章在主进程（import:pick-preview）；这里只负责「让人看清切出了什么、改名、确认」。
     成功后把新章节登记进 chapterOrder（书内次序的真身），再刷新文稿树——顺序不靠文件名猜。 -->
<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";
import type { TxtChapterDraft } from "@mochen/contracts";

const emit = defineEmits<{ close: [] }>();
const book = useBookStore();

// 焦点与 Esc 的真身在 useModalFocus；入场动效与 NewBookDialog 同一条弹簧时间轴。
const dialogRoot = ref<HTMLElement>();
useModalFocus({ root: dialogRoot, close: () => emit("close") });
useDialogMotion({ root: dialogRoot });

/** idle：还没选文件；preview：切章清单已就绪。两态之间只有「选文件」一条路。 */
const phase = ref<"idle" | "preview">("idle");
/** 本地持有的错误：与 NewBookDialog 同一条纪律——不读全局 notice，自己的错自己亮。 */
const error = ref("");
/** 主进程报上来的文件名 / 编码（预览头一句话要用）。 */
const fileName = ref("");
const encoding = ref<"utf-8" | "gbk">("utf-8");
/** 切出的章目：title 可编辑（改名就改文件名），included 勾掉的不导。 */
const chapters = ref<(TxtChapterDraft & { included: boolean })[]>([]);
/** 成功导入的篇数：亮在确认按钮的位置，比一句「完成」多点信息。 */
const importedCount = ref<number | null>(null);
const working = ref(false);

const includedCount = (): number => chapters.value.filter((c) => c.included).length;

async function pick(): Promise<void> {
  error.value = "";
  working.value = true;
  const result = await window.mochen.importTxtPreview();
  working.value = false;
  // canceled 是用户点了取消——正常操作，不弹红字、不换态。
  if (!result.ok) {
    if (result.reason !== "canceled") error.value = result.message;
    return;
  }
  fileName.value = result.fileName;
  encoding.value = result.encoding;
  chapters.value = result.chapters.map((c) => ({ ...c, included: true }));
  phase.value = "preview";
}

async function commit(): Promise<void> {
  const chosen = chapters.value
    .filter((c) => c.included)
    .map((c) => ({ title: c.title, content: c.content }));
  if (chosen.length === 0) {
    error.value = "一章都没勾——勾上要导的章节，或者直接关闭。";
    return;
  }
  working.value = true;
  error.value = "";
  const result = await window.mochen.importTxtCommit({ chapters: chosen });
  if (!result.ok) {
    working.value = false;
    error.value = result.message;
    return;
  }
  // 新章登记进 chapterOrder（书的次序真身）：按 txt 里的先后排，不靠文件名的拼音序猜
  // （「第一章/第二章/第三章」按拼音排是 二、三、一——次序必须显式登记）。
  // 打开这本书才进得到这个对话框（入口有 need-book 闸），meta 理应非空；兜一层防外力。
  const order = [...(book.meta?.chapterOrder ?? []), ...result.created];
  await book.persistMeta({ chapterOrder: order }, "导入的章节顺序没存住");
  await book.refreshDocs();
  working.value = false;
  importedCount.value = result.created.length;
}
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        ref="dialogRoot"
        class="workspace-dialog import-txt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-txt-title"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">存量稿进书</span>
            <h2 id="import-txt-title">导入 TXT</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭导入" @click="emit('close')">
            ×
          </button>
        </header>
        <div class="dialog-content">
          <template v-if="phase === 'idle'">
            <p class="dialog-description">
              选一本存量的 txt 文件，主进程会自动辨认编码（UTF-8 / GBK）、按章节标题切章，
              然后在这里预览——确认后落成这本书「章节」分组下的一篇篇文稿。
            </p>
            <p class="dialog-description">
              不会覆盖书里已有的内容：撞名的章节会在导入前整批拦下，改个标题再导就行。
            </p>
            <button
              class="dialog-primary-button import-pick-button"
              type="button"
              :disabled="working"
              @click="pick"
            >
              <AppIcon name="download" :size="15" />
              {{ working ? "正在读取…" : "选择 TXT 文件…" }}
            </button>
          </template>

          <template v-else>
            <p class="dialog-description">
              「{{ fileName }}」按 {{ encoding === "gbk" ? "GBK" : "UTF-8" }} 解码，切出
              {{ chapters.length }} 章。标题可以直接改（改的就是文件名与章名）；不想要的章把勾去掉。
            </p>
            <ul class="import-chapter-list">
              <li v-for="(chapter, index) in chapters" :key="index" class="import-chapter-row">
                <label class="import-chapter-include">
                  <input v-model="chapter.included" type="checkbox" />
                  <span class="sr-only">导入这一章</span>
                </label>
                <input
                  v-model="chapter.title"
                  class="import-chapter-title"
                  type="text"
                  :aria-label="`第 ${index + 1} 章标题`"
                />
                <span class="import-chapter-chars">{{ chapter.chars }} 字</span>
              </li>
            </ul>
            <button
              class="dialog-primary-button import-pick-button"
              type="button"
              :disabled="working"
              @click="commit"
            >
              {{ working ? "正在导入…" : `导入这 ${includedCount()} 章` }}
            </button>
          </template>

          <p v-if="importedCount !== null" class="dialog-description import-done-line">
            已导入 {{ importedCount }} 章，都在左侧「章节」分组里。
          </p>
          <p v-if="error !== '' && !working" class="provider-error">{{ error }}</p>
        </div>

        <div class="dialog-actions">
          <button class="dialog-secondary-button" type="button" @click="emit('close')">
            {{ importedCount !== null ? "完成" : "关闭" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.import-txt-dialog {
  width: min(560px, calc(100vw - 64px));
}

.import-pick-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.import-chapter-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  max-height: 42vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.import-chapter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.import-chapter-row:last-child {
  border-bottom: none;
}

.import-chapter-include {
  display: flex;
  align-items: center;
}

.import-chapter-title {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 3px 6px;
}

.import-chapter-title:hover,
.import-chapter-title:focus {
  border-color: var(--border);
  background: var(--surface-main, #ffffff);
  outline: none;
}

.import-chapter-chars {
  flex: none;
  font-size: 0.8rem;
  opacity: 0.65;
  white-space: nowrap;
}

.import-done-line {
  color: var(--accent, #4a7dff);
}
</style>

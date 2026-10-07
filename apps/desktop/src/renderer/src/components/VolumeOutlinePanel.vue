<!-- 卷纲 → 章纲结构化（2026-10-05，批次 5-②）。
     入口在右栏头部那颗按钮上——只在打开的是分卷/大纲时亮，因为拆章纲拆的是这两类。

     判定与拼装在 contracts/volume-outline（44 条真单测，含「生成后再解析，缺的仍然是缺的」那条），
     样式在 styles/outline.css。

     诚实边界（与去 AI 味、审稿打分、时间线核对同一条）：这里只把**已经写下的字段**摆成一张表，
     不判断章与章之间成不成立，也不替作者补上没写的那一项——缺就是缺，列在行里让人自己定。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { popoverOwnsKey } from "../utils/slash-commands";
import {
  CHAPTER_OUTLINE_FIELDS,
  CHAPTER_OUTLINE_LABELS,
  VOLUME_OUTLINE_BLIND_SPOTS,
  chapterCompleteness,
  planDocRelPath,
  type ChapterOutlineField,
  type ParsedChapter
} from "@mochen/contracts";
import { useVolumeOutlineStore } from "../stores/useVolumeOutlineStore";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const outline = useVolumeOutlineStore();
const panel = ref<HTMLElement>();
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

/** 这一行的完整度（0~1）：写全的章一条满格，没写字段的章条短——不是打分，是「还差几项」。 */
function completeness(chapter: ParsedChapter): number {
  return chapterCompleteness(chapter);
}

/** 只列出**没写**的那几项（写了的当没看见——面板不是复读机）。全写时给一句肯定话，不留空标签。 */
function missingLabels(chapter: ParsedChapter): string {
  if (chapter.missing.length === 0) return `${CHAPTER_OUTLINE_FIELDS.length} 项都写了`;
  return chapter.missing.map((field) => CHAPTER_OUTLINE_LABELS[field]).join("、");
}

/** 每个字段格的状态：写了的实一点、没写的虚线——两态必须**长得不一样**，不能只靠有无文字区分。 */
function fieldClass(chapter: ParsedChapter, field: ChapterOutlineField): string {
  return chapter.fields[field] === "" ? "outline-field is-blank" : "outline-field";
}

/**
 * 目标字数合计。**不用 formatByteSize**：那是给文件字节数用的，
 * 「三千二百字」按字节格式化出来是 3.2 KB——单位说错了比不写更坏。
 * 读不出数字的那几章单列，不折成 0 混进合计。
 */
const words = computed(() => {
  const total = outline.wordTotal.toLocaleString("zh-CN");
  return outline.wordUnreadable === 0
    ? `目标字数合计 ${total}`
    : `目标字数合计 ${total}（另有 ${outline.wordUnreadable} 章写了数字但没读出来，不计入）`;
});

/** 生成一章的结果：成功失败都要说一句，静默失败会让作者以为已经生成。 */
const lastMessage = ref("");
const lastMessageFailed = ref(false);

async function generate(chapter: ParsedChapter): Promise<void> {
  const result = await outline.generateChapter(chapter);
  lastMessage.value = result.message;
  lastMessageFailed.value = !result.ok;
}

/**
 * 「已经有一篇同名大纲」——路径**必须**问 `planDocRelPath`（铁律 6）。
 * 在这里另写一份文件名清洗，早晚和 contracts 那份对不上，
 * 对不上的后果是按钮亮着、点了却被主进程拒，用户读到的还是「建不了」。
 */
function existsAlready(chapter: ParsedChapter): boolean {
  const relPath = planDocRelPath("outline", chapter.title);
  return relPath !== null && book.docs.some((d) => d.relPath === relPath);
}

function keydown(event: KeyboardEvent): void {
  const mods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (popoverOwnsKey(event.key, mods, close)) {
    event.preventDefault();
    return;
  }
  if (event.key === "Escape") {
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
      class="volume-outline"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="卷纲转章纲"
      @keydown="keydown"
    >
      <header class="volume-outline-head">
        <strong>卷纲 → 章纲</strong>
        <span v-if="outline.chapters.length > 0" class="volume-outline-count">
          {{ outline.chapters.length }} 章
        </span>
        <button
          class="context-picker-close"
          type="button"
          aria-label="关闭卷纲转章纲"
          @click="close"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="volume-outline-note">
        纯本地拆分，不联网、不花 token。用 <code>## 标题</code> 开一章、下面写
        <code>- 视角：</code> 这样的字段行；没写的那几项会照实留在行里。
      </p>

      <p v-if="outline.notice !== ''" class="volume-outline-error">{{ outline.notice }}</p>

      <p v-else-if="outline.busy" class="volume-outline-empty">
        正在读《{{ outline.sourceTitle }}》…
      </p>

      <p v-else-if="outline.chapters.length === 0" class="volume-outline-empty">
        {{ outline.verdict }}
      </p>

      <template v-else>
        <p class="volume-outline-verdict" :class="{ 'is-clean': outline.looseCount === 0 }">
          {{ outline.verdict }} · {{ words }}
        </p>

        <div class="volume-outline-body">
          <ol class="volume-outline-list">
            <li
              v-for="chapter in outline.chapters"
              :key="chapter.order"
              class="outline-chapter"
              :class="{ 'is-loose': chapter.isLoose }"
            >
              <div class="outline-chapter-head">
                <span class="outline-order">{{ chapter.order }}</span>
                <span class="outline-chapter-title">{{ chapter.title }}</span>
                <span
                  class="outline-meter"
                  :style="{ '--fill': String(Math.round(completeness(chapter) * 100)) }"
                  :aria-label="`${CHAPTER_OUTLINE_FIELDS.length - chapter.missing.length} / ${CHAPTER_OUTLINE_FIELDS.length} 项已写`"
                />
              </div>

              <p v-if="chapter.isLoose" class="outline-loose-note">
                这一节一个字段都没写——可能是个分组标题，不像一章。你自己定，要不要按章纲生成。
              </p>

              <dl class="outline-fields">
                <div
                  v-for="field in CHAPTER_OUTLINE_FIELDS"
                  :key="field"
                  :class="fieldClass(chapter, field)"
                >
                  <dt>{{ CHAPTER_OUTLINE_LABELS[field] }}</dt>
                  <dd>{{ chapter.fields[field] || "没写" }}</dd>
                </div>
              </dl>

              <p class="outline-chapter-foot">
                <span class="outline-missing">还缺：{{ missingLabels(chapter) }}</span>
                <button
                  class="outline-generate"
                  type="button"
                  :disabled="
                    outline.generating.includes(chapter.order) ||
                    existsAlready(chapter) ||
                    chapter.isLoose
                  "
                  @click="void generate(chapter)"
                >
                  <AppIcon name="wand" :size="12" />
                  {{
                    outline.generating.includes(chapter.order)
                      ? "生成中…"
                      : existsAlready(chapter)
                        ? "已有同名大纲"
                        : "生成章纲"
                  }}
                </button>
              </p>
            </li>
          </ol>

          <!-- 盲区块放进**滚动区内**（2026-10-05 真机撞出来的）：
               它是说明文字、里面没有按钮，放外面会跟说明、总结一起把滚动区挤没。
               实测在 475px 高的窗口里，盲区块在外面时列表只剩 40px——能滚，但等于看不见。
               行内的「生成章纲」按钮仍在滚动区内，跟着自己那一行走，这是 4-② 的那条纪律。 -->
          <section class="volume-outline-blind">
            <h4 class="volume-outline-blind-title">这个面板算不出来的事</h4>
            <ul>
              <li v-for="spot in VOLUME_OUTLINE_BLIND_SPOTS" :key="spot">{{ spot }}</li>
            </ul>
          </section>
        </div>

        <p
          v-if="lastMessage !== ''"
          class="volume-outline-last"
          :class="{ 'is-failed': lastMessageFailed }"
        >
          {{ lastMessage }}
        </p>
      </template>
    </section>
  </Teleport>
</template>

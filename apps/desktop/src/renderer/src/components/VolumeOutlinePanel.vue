<!-- 卷纲 → 章纲结构化（2026-10-05，批次 5-②）。
     入口在右栏头部那颗按钮上——只在打开的是分卷/大纲时亮，因为拆章纲拆的是这两类。

     判定与拼装在 contracts/volume-outline（44 条真单测，含「生成后再解析，缺的仍然是缺的」那条），
     样式在 styles/outline.css。

     2026-11 W-02：六项字段可以直接在格子里改，保存时写回卷纲原文——当前打开的正文走
     useBookStore 的既有保存链（备份、指纹、冲突都在那一处），不新开 IPC。
     第二步：每章多一枚「按纲起草」，只把六项字段拼成结构化指令预填进输入框，
     不自动发送；目标不是眼前那篇时，面板点名会写到哪一篇。
     诚实边界（与去 AI 味、审稿打分、时间线核对同一条）：仍不判断章与章之间成不成立，
     也不替作者补上没写的那一项——空字段允许保存，但照实标成「还缺」。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  CHAPTER_OUTLINE_FIELDS,
  CHAPTER_OUTLINE_LABELS,
  VOLUME_OUTLINE_BLIND_SPOTS,
  chapterCompleteness,
  planDocRelPath,
  workModeOf,
  type ChapterOutlineField,
  type ParsedChapter
} from "@mochen/contracts";
import { useVolumeOutlineStore } from "../stores/useVolumeOutlineStore";
import { useStoryBibleStore } from "../stores/useStoryBibleStore";
import { voiceBriefs, type VoiceBrief } from "../utils/voice-brief";
import { useBookStore } from "../stores/useBookStore";
import { useAgentStore } from "../stores/useAgentStore";
import { threadKeyFor } from "../utils/agent-thread";
import { activeProfileOf } from "../utils/profile-options";
import {
  DRAFT_PROFILE_ID,
  DRAFT_WORK_MODE,
  chapterDraftPrompt,
  chapterDraftTargetHint
} from "../utils/chapter-draft";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const bible = useStoryBibleStore();
const outline = useVolumeOutlineStore();
const agent = useAgentStore();
const panel = ref<HTMLElement>();
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 480 }
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
 * 就地编辑（2026-11 W-02 第一步）：只记**改过**的格子，键是「章序:字段」。
 * 没改过的格子直接显示解析结果——不另存一份「整章副本」，否则一保存完就得整份对齐。
 */
const edits = ref<Record<string, string>>({});

function editKey(chapter: ParsedChapter, field: ChapterOutlineField): string {
  return `${chapter.order}:${field}`;
}

function fieldValue(chapter: ParsedChapter, field: ChapterOutlineField): string {
  return edits.value[editKey(chapter, field)] ?? chapter.fields[field];
}

/**
 * 本章人物嗓音（2026-11 W-09）：只认章纲六项字段里点到的名字，设定里没写嗓音的人物不占行。
 * 读的是编辑中的值而不是盘上的值——「按纲起草」用的就是眼前这一格，两处必须同源。
 */
function chapterVoices(chapter: ParsedChapter): VoiceBrief[] {
  if (bible.activeEntries.length === 0) return [];
  const text = CHAPTER_OUTLINE_FIELDS.map((field) => fieldValue(chapter, field)).join("\n");
  return voiceBriefs(bible.activeEntries, text, 2);
}

function onFieldInput(chapter: ParsedChapter, field: ChapterOutlineField, event: Event): void {
  edits.value[editKey(chapter, field)] = (event.target as HTMLInputElement).value;
}

/**
 * 这一章真正改动的字段（trim 后比较；空串也算改动——清空就是把这一项从原文里删掉）。
 * 返回空对象 = 没有可保存的改动，按钮据此禁用（点下去也不会写盘、不会多一次备份）。
 */
function changedFields(chapter: ParsedChapter): Partial<Record<ChapterOutlineField, string>> {
  const changed: Partial<Record<ChapterOutlineField, string>> = {};
  for (const field of CHAPTER_OUTLINE_FIELDS) {
    const value = fieldValue(chapter, field).trim();
    if (value !== chapter.fields[field]) changed[field] = value;
  }
  return changed;
}

function hasEdits(chapter: ParsedChapter): boolean {
  return Object.keys(changedFields(chapter)).length > 0;
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
 * 保存这一章改过的字段（2026-11 W-02 第一步）。写回通路在 store 里：
 * 当前打开的正文走 useBookStore 的既有保存链（备份、指纹、冲突判定都在那一处），
 * 不新开 IPC；失败的原因原样上屏（`volume-outline-last.is-failed`），不吞。
 * 成功时 store 已按写回后的原文重算解析结果（完整度/还缺哪几项随之刷新），这里只清掉本格的暂存值。
 */
async function saveFields(chapter: ParsedChapter): Promise<void> {
  const fields = changedFields(chapter);
  if (Object.keys(fields).length === 0) return;
  const result = await outline.saveChapter(chapter, fields);
  lastMessage.value = result.message;
  lastMessageFailed.value = !result.ok;
  if (result.ok) {
    for (const field of CHAPTER_OUTLINE_FIELDS) delete edits.value[editKey(chapter, field)];
  }
}

/**
 * 本卷纲里这一章的上一章：按出场次序往前找，跳过「一个字段都没写」的分组节。
 * 只用来在指令里指名「先读哪一篇的结尾」，不参与排序判定（排序仍由解析层定）。
 */
function previousChapterOf(chapter: ParsedChapter): ParsedChapter | null {
  const index = outline.chapters.findIndex((item) => item.order === chapter.order);
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = outline.chapters[i];
    if (candidate !== undefined && !candidate.isLoose) return candidate;
  }
  return null;
}

/** 这一章正文的目标路径——文件名清洗必须问 contracts，不在这里自己拼目录名。 */
function chapterTarget(chapter: ParsedChapter): string | null {
  return planDocRelPath("chapter", chapter.title);
}

/**
 * 按纲起草（2026-11 W-02 第二步）：
 * ① 只预填、**不自动发送**——`prefillComposer` 把指令放进输入框，用户改完自己发；
 * ② 指令由 `utils/chapter-draft` 拼，六项有值的进指令，缺的照实列进「请勿自行补设定」；
 * ③ 顺手切到正文用的档案与「直接动手」模式，已经是这一档就不重复写盘；
 * ④ 目标不是眼前那篇时，把「会写到哪一篇」写进面板提示，避免误以为在改眼前这篇。
 */
async function draftFromOutline(chapter: ParsedChapter): Promise<void> {
  // 有未保存的改动时先别拼指令：指令会按盘上旧字段写，而用户眼前是新值——两次说的不是一回事。
  if (hasEdits(chapter)) {
    lastMessage.value =
      "这一章还有没保存的改动——先点「保存本章」，再按纲起草；否则指令里用的是盘上的旧字段。";
    lastMessageFailed.value = true;
    return;
  }
  const targetRelPath = chapterTarget(chapter);
  if (targetRelPath === null) {
    lastMessage.value = `这一章的标题「${chapter.title}」落不了盘（可能是空标题或 Windows 保留名），没按纲起草；先把标题改好再试。`;
    lastMessageFailed.value = true;
    return;
  }

  const previous = previousChapterOf(chapter);
  const targetExists = book.docs.some((doc) => doc.relPath === targetRelPath);

  if (book.meta !== null) {
    if (activeProfileOf(book.meta).id !== DRAFT_PROFILE_ID) {
      await book.setActiveProfile(DRAFT_PROFILE_ID);
    }
    if (workModeOf(book.meta) !== DRAFT_WORK_MODE) await book.setWorkMode(DRAFT_WORK_MODE);
  }

  const threadKey = threadKeyFor(targetRelPath);
  const before = agent.draftOf(threadKey);
  const prompt = chapterDraftPrompt({
    chapter,
    previousTitle: previous?.title ?? null,
    previousRelPath: previous === null ? null : chapterTarget(previous),
    targetRelPath,
    targetExists
  });
  agent.prefillComposer(threadKey, prompt);

  // 预填不覆盖已有草稿（既有规则）。目标那一篇不在眼前时，agent 的 notice 看不到，所以这里再说一遍。
  if (before.trim() !== "" && agent.draftOf(threadKey) !== prompt) {
    lastMessage.value = `《${chapter.title}》那一篇的输入框里已经有内容，预填没有覆盖；先把那一篇的内容发出去或清空，再点一次按纲起草。`;
    lastMessageFailed.value = true;
    return;
  }

  const hint = chapterDraftTargetHint({
    chapterTitle: chapter.title,
    targetRelPath,
    targetExists,
    activeRelPath: book.activeDocTab,
    activeTitle: book.docs.find((doc) => doc.relPath === book.activeDocTab)?.title ?? null
  });
  if (hint !== "") {
    lastMessage.value = hint;
    lastMessageFailed.value = false;
  }
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
                <span class="outline-chapter-title" :title="chapter.title">{{
                  chapter.title
                }}</span>
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
                  <dd>
                    <input
                      class="outline-field-input"
                      type="text"
                      :value="fieldValue(chapter, field)"
                      :placeholder="'没写'"
                      :aria-label="`${CHAPTER_OUTLINE_LABELS[field]}（第 ${chapter.order} 章）`"
                      @input="onFieldInput(chapter, field, $event)"
                    />
                  </dd>
                </div>
              </dl>

              <p v-if="chapterVoices(chapter).length > 0" class="outline-voices">
                <span
                  v-for="one in chapterVoices(chapter)"
                  :key="one.name"
                  class="outline-voice"
                  :title="`${one.name}：${one.line}`"
                >
                  <span class="outline-voice-name">{{ one.name }}</span
                  >{{ one.line }}
                </span>
              </p>

              <p class="outline-chapter-foot">
                <span class="outline-missing">还缺：{{ missingLabels(chapter) }}</span>
                <button
                  class="outline-draft"
                  type="button"
                  :disabled="outline.saving.includes(chapter.order) || chapter.isLoose"
                  :title="
                    chapter.isLoose
                      ? '这一节一个字段都没写，不像一章，没纲可按'
                      : '把本章六项字段拼成起草指令，预填到输入框；不会自动发送'
                  "
                  @click="void draftFromOutline(chapter)"
                >
                  <AppIcon name="pen" :size="12" />
                  按纲起草
                </button>
                <button
                  class="outline-save"
                  type="button"
                  :disabled="outline.saving.includes(chapter.order) || !hasEdits(chapter)"
                  @click="void saveFields(chapter)"
                >
                  <AppIcon name="check" :size="12" />
                  {{ outline.saving.includes(chapter.order) ? "保存中…" : "保存本章" }}
                </button>
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

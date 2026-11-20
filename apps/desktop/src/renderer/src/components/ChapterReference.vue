<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import SubmissionChecklist from "./SubmissionChecklist.vue";
import { useBookStore } from "../stores/useBookStore";
import { useStoryBibleStore } from "../stores/useStoryBibleStore";
import { useSubmissionChecklistStore } from "../stores/useSubmissionChecklistStore";
import { voiceBriefs } from "../utils/voice-brief";
import {
  ambiguousOutlineText,
  briefFields,
  briefForeshadows,
  EMPTY_FIELDS_TEXT,
  FORESHADOW_LOADING_TEXT,
  foreshadowTag,
  lookupChapterOutline,
  mentionedCharacters,
  NO_CHARACTER_CARDS_TEXT,
  NO_DOC_TEXT,
  NO_FORESHADOWS_TEXT,
  NO_NAMED_CHARACTERS_TEXT,
  NO_OUTLINE_FOR_CAST_TEXT,
  NO_PENDING_FORESHADOWS_TEXT,
  noOutlineText,
  notChapterText,
  OUTLINE_LOADING_TEXT,
  outlineText,
  type OutlineLookup
} from "../utils/chapter-reference";

/**
 * 本章参考（2026-11-09 W-03）：右栏常驻的一条只读参考带，位置在视图切换条与正文之间。
 *
 * 它不做任何写入：章纲与人物只走 `book.docs` + `readDoc`，伏笔只读既有 store 台账。
 * 「本章」永远指 `activeDocTab` 指的那一篇；没打开文稿或打开的不是章节时，
 * 如实显示空态，绝不拿上一章的数据顶着。
 */

const book = useBookStore();
const bible = useStoryBibleStore();
const checklist = useSubmissionChecklistStore();
const checkAnchor = ref<HTMLElement>();
const collapsed = ref(false);
const lookup = ref<OutlineLookup>({ kind: "none" });
const searching = ref(false);
/** 换章 / 换书时的竞态闸门：只有最后一次发起的读取能落地。 */
let reloadToken = 0;

const visible = computed(() => book.meta !== null && book.rightPaneMode === "manuscript");

/** 离开文稿态就把体检浮层收掉，免得它跟着飘到别的视图上。 */
watch(visible, (on) => {
  if (!on) checklist.close();
});

const activeDoc = computed(() => {
  const relPath = book.activeDocTab;
  if (relPath === null) return null;
  return book.docs.find((doc) => doc.relPath === relPath) ?? null;
});

/** 只有章节正文才谈得上「本章」；其它文稿一律走 notChapterText。 */
const chapterDoc = computed(() => (activeDoc.value?.kind === "chapter" ? activeDoc.value : null));
const chapterTitle = computed(() => chapterDoc.value?.title ?? "");
const activeRelPath = computed(() => chapterDoc.value?.relPath ?? "");

const docsSignature = computed(() =>
  book.docs.map((doc) => `${doc.relPath}\u0000${doc.title}\u0000${doc.kind}`).join("\u0001")
);

const characterCards = computed(() => book.docs.filter((doc) => doc.kind === "character"));

const summaryFields = computed(() => {
  const value = lookup.value;
  return value.kind === "ok" ? briefFields(value.match.chapter) : [];
});

const namedCharacters = computed(() => {
  const value = lookup.value;
  if (value.kind !== "ok") return [];
  return mentionedCharacters(characterCards.value, outlineText(value.match.chapter));
});

/** 人物嗓音（W-09）：只摘本章提到、又在设定里写了嗓音三格的人物；空数组就不占版面。 */
const voices = computed(() => {
  const value = lookup.value;
  if (value.kind !== "ok") return [];
  return voiceBriefs(bible.activeEntries, outlineText(value.match.chapter));
});

const foreshadow = computed(() => briefForeshadows(book.foreshadowRows, activeRelPath.value));

const foreshadowError = computed(() =>
  book.foreshadowRows.length === 0 && book.notice.includes("伏笔台账没读回来") ? book.notice : ""
);

/** 章纲读取：标题变了就先清空，避免把上一章的摘要留在新标题底下。 */
async function reloadOutline(): Promise<void> {
  const token = ++reloadToken;
  const title = chapterTitle.value;
  lookup.value = { kind: "none" };
  if (title === "") {
    searching.value = false;
    return;
  }
  searching.value = true;
  const next = await lookupChapterOutline(book.docs, title, (relPath) =>
    window.mochen.readDoc(relPath)
  );
  if (token !== reloadToken) return;
  lookup.value = next;
  searching.value = false;
}

watch([docsSignature, chapterTitle], () => void reloadOutline(), { immediate: true });

/**
 * 伏笔台账走既有 store 通道；只在「这本书还没读过 / 文稿清单变了」时读一次。
 * store 自己带在途标志，两边同时打开也不会并发读。
 */
watch(
  [() => book.meta?.id ?? "", docsSignature],
  () => {
    if (book.docs.length === 0 || book.foreshadowsBusy) return;
    void book.loadForeshadows();
  },
  { immediate: true }
);

const sourceLabel = computed(() => {
  const value = lookup.value;
  if (value.kind !== "ok") return "";
  return `取自《${value.match.sourceTitle}》第 ${value.match.chapter.order} 章`;
});
</script>

<template>
  <section v-if="visible" class="chapter-brief" aria-label="本章参考">
    <div class="chapter-brief-head">
      <button
        class="chapter-brief-toggle"
        type="button"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <AppIcon
          class="chapter-brief-chevron"
          :class="{ 'is-collapsed': collapsed }"
          name="chevron"
          :size="11"
        />
        <strong>本章参考</strong>
        <span v-if="chapterTitle" class="chapter-brief-who">《{{ chapterTitle }}》</span>
      </button>
      <button
        ref="checkAnchor"
        class="chapter-brief-check"
        type="button"
        aria-label="交稿体检"
        title="交稿体检：汇总本章既有检查里还没收拾的条目"
        @click="checklist.toggle()"
      >
        <AppIcon name="check" :size="10" />
        体检
      </button>
    </div>

    <div v-if="!collapsed" class="chapter-brief-body">
      <p v-if="activeDoc === null" class="chapter-brief-empty">{{ NO_DOC_TEXT }}</p>
      <p v-else-if="chapterDoc === null" class="chapter-brief-empty">
        {{ notChapterText(activeDoc?.title ?? "") }}
      </p>

      <template v-else>
        <div class="chapter-brief-block">
          <p class="chapter-brief-label">本章章纲摘要</p>
          <p v-if="searching" class="chapter-brief-empty">{{ OUTLINE_LOADING_TEXT }}</p>
          <p v-else-if="lookup.kind === 'none'" class="chapter-brief-empty">
            {{ noOutlineText(chapterTitle) }}
          </p>
          <p v-else-if="lookup.kind === 'ambiguous'" class="chapter-brief-empty">
            {{ ambiguousOutlineText(chapterTitle, lookup.count) }}
          </p>
          <template v-else>
            <p class="chapter-brief-source">{{ sourceLabel }}</p>
            <dl v-if="summaryFields.length > 0" class="chapter-brief-fields">
              <div v-for="item in summaryFields" :key="item.field" class="chapter-brief-field">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
            <p v-else class="chapter-brief-empty">{{ EMPTY_FIELDS_TEXT }}</p>
          </template>
        </div>

        <div class="chapter-brief-block">
          <p class="chapter-brief-label">出场人物</p>
          <p v-if="searching" class="chapter-brief-empty">{{ OUTLINE_LOADING_TEXT }}</p>
          <p
            v-else-if="lookup.kind === 'none' || lookup.kind === 'ambiguous'"
            class="chapter-brief-empty"
          >
            {{ NO_OUTLINE_FOR_CAST_TEXT }}
          </p>
          <p v-else-if="characterCards.length === 0" class="chapter-brief-empty">
            {{ NO_CHARACTER_CARDS_TEXT }}
          </p>
          <p v-else-if="namedCharacters.length === 0" class="chapter-brief-empty">
            {{ NO_NAMED_CHARACTERS_TEXT }}
          </p>
          <ul v-else class="chapter-brief-people">
            <li v-for="name in namedCharacters" :key="name" class="chapter-brief-person">
              {{ name }}
            </li>
          </ul>
        </div>

        <div v-if="voices.length > 0" class="chapter-brief-block">
          <p class="chapter-brief-label">人物嗓音</p>
          <ul class="chapter-brief-voices">
            <li v-for="one in voices" :key="one.name" class="chapter-brief-voice-row">
              <span class="chapter-brief-voice-name">{{ one.name }}</span>
              <span class="chapter-brief-voice">{{ one.line }}</span>
            </li>
          </ul>
        </div>

        <div class="chapter-brief-block">
          <p class="chapter-brief-label">待回收伏笔</p>
          <p
            v-if="book.foreshadowsBusy && book.foreshadowRows.length === 0"
            class="chapter-brief-empty"
          >
            {{ FORESHADOW_LOADING_TEXT }}
          </p>
          <p v-else-if="foreshadowError !== ''" class="chapter-brief-empty">
            {{ foreshadowError }}
          </p>
          <p v-else-if="book.foreshadowRows.length === 0" class="chapter-brief-empty">
            {{ NO_FORESHADOWS_TEXT }}
          </p>
          <template v-else>
            <p v-if="foreshadow.pendingTotal === 0" class="chapter-brief-empty">
              {{ NO_PENDING_FORESHADOWS_TEXT }}
            </p>
            <ul v-else class="chapter-brief-foreshadows">
              <li
                v-for="row in foreshadow.rows"
                :key="row.relPath"
                class="chapter-brief-foreshadow"
              >
                <span class="chapter-brief-tag">{{ foreshadowTag(row, activeRelPath) }}</span>
                <span class="chapter-brief-foreshadow-title">{{ row.title }}</span>
              </li>
            </ul>
            <p v-if="foreshadow.pendingTotal > foreshadow.rows.length" class="chapter-brief-more">
              另有 {{ foreshadow.pendingTotal - foreshadow.rows.length }} 条待回收，去「审稿 →
              伏笔台账」看全部。
            </p>
            <p v-if="foreshadow.brokenTotal > 0" class="chapter-brief-note">
              另有 {{ foreshadow.brokenTotal }} 条状态字段没认出来，去伏笔台账看一眼。
            </p>
            <p v-if="foreshadow.unknownTotal > 0" class="chapter-brief-note">
              另有 {{ foreshadow.unknownTotal }} 条原文读不到，状态未知。
            </p>
          </template>
        </div>
      </template>
    </div>

    <SubmissionChecklist
      v-if="checklist.open && checkAnchor"
      :anchor="checkAnchor"
      :chapter-rel-path="activeRelPath"
      :chapter-title="chapterTitle"
      @close="checklist.close()"
    />
  </section>
</template>

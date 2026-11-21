<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BOOK_DIGEST_CAST_MAX_CHARS,
  BOOK_DIGEST_SUMMARY_MAX_CHARS,
  sortDocs
} from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();

const summary = ref("");
const cast = ref("");
const saving = ref(false);

/**
 * 换书、或摘要旁路刚生成完时重新灌值。
 * 只认 `book.meta.digest` 这一格：它是渲染层能看到的唯一真身，别处不另存一份草稿。
 */
watch(
  () => book.meta?.digest,
  (digest) => {
    summary.value = digest?.summary ?? "";
    cast.value = digest?.cast ?? "";
  },
  { immediate: true }
);

const dirty = computed(
  () =>
    summary.value.trim() !== (book.meta?.digest?.summary ?? "") ||
    cast.value.trim() !== (book.meta?.digest?.cast ?? "")
);

async function save(): Promise<void> {
  if (!dirty.value || saving.value) return;
  const nextSummary = summary.value.trim();
  const nextCast = cast.value.trim();
  // 两格都清空 = 用户想删掉这段记忆；传 undefined 才能让 JSON 里这一格真的消失。
  const digest =
    nextSummary === "" && nextCast === "" ? undefined : { summary: nextSummary, cast: nextCast };
  saving.value = true;
  const ok = await book.persistMeta({ digest }, "记忆没有保存");
  saving.value = false;
  if (ok) book.notice = "AI 记忆已保存。";
}

/**
 * 各章前情摘要（只读）。顺序跟章节次序走；盘上还有摘要、正文却被删掉的，
 * 排在最后并把 relPath 亮出来——不凭空隐藏一条已经有内容的事实。
 */
const recapRows = computed(() => {
  const recaps = book.meta?.recaps ?? {};
  const ordered = sortDocs(book.docs, book.meta?.chapterOrder ?? []).map((doc) => doc.relPath);
  const known = new Set(ordered);
  const orphans = Object.keys(recaps)
    .filter((rel) => !known.has(rel))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  return [...ordered, ...orphans]
    .filter((rel) => (recaps[rel] ?? "") !== "")
    .map((rel) => ({
      rel,
      title: book.docs.find((doc) => doc.relPath === rel)?.title ?? rel,
      text: recaps[rel] ?? ""
    }));
});
</script>

<template>
  <div class="memory-panel">
    <section class="settings-group">
      <h2 class="settings-group-title">全书摘要</h2>
      <p class="settings-group-note">
        每写完一章，系统会自动更新这段记忆，并在下一轮对话里交给模型。你可以随时改。
      </p>
      <div class="settings-card memory-card">
        <label class="memory-field">
          <span class="memory-label">一句话摘要</span>
          <textarea
            v-model="summary"
            class="memory-input"
            rows="2"
            :maxlength="BOOK_DIGEST_SUMMARY_MAX_CHARS"
            placeholder="故事讲到哪儿了？例如：主角逃出北境，正在寻找第三块残碑。"
          ></textarea>
          <span class="memory-count">
            {{ summary.length }} / {{ BOOK_DIGEST_SUMMARY_MAX_CHARS }}
          </span>
        </label>

        <label class="memory-field">
          <span class="memory-label">人物状态</span>
          <textarea
            v-model="cast"
            class="memory-input"
            rows="6"
            :maxlength="BOOK_DIGEST_CAST_MAX_CHARS"
            placeholder="一行一人。例如：沈青崖——左臂受伤，已到云州。"
          ></textarea>
          <span class="memory-count"> {{ cast.length }} / {{ BOOK_DIGEST_CAST_MAX_CHARS }} </span>
        </label>

        <div class="memory-actions">
          <button
            class="memory-save"
            type="button"
            :disabled="!dirty || saving || book.metaSaving"
            @click="save"
          >
            {{ saving ? "保存中…" : "保存记忆" }}
          </button>
          <span v-if="!book.meta" class="memory-empty">还没有打开作品。</span>
        </div>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="settings-group-title">各章前情摘要</h2>
      <p class="settings-group-note">
        每章写完自动生成，只读。改了正文后，下一轮生成的摘要会自然替换旧的。
      </p>
      <div v-if="recapRows.length === 0" class="settings-card memory-empty-card">
        还没有前情摘要——写完一章后会自动生成。
      </div>
      <div v-else class="settings-card memory-recap-list">
        <article v-for="row in recapRows" :key="row.rel" class="memory-recap">
          <h3 class="memory-recap-title">{{ row.title }}</h3>
          <p class="memory-recap-text">{{ row.text }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.memory-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.memory-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px;
}

.memory-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.memory-label {
  font-size: 0.928571rem;
  color: var(--text-soft);
}

.memory-input {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-control);
  background: var(--editor);
  color: var(--text);
  font: inherit;
  line-height: 1.7;
}

.memory-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.memory-count {
  align-self: flex-end;
  font-size: 0.857143rem;
  color: var(--text-faint);
}

.memory-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.memory-save {
  padding: 6px 16px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-control);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.memory-save:disabled {
  opacity: 0.45;
  cursor: default;
}

.memory-empty {
  font-size: 0.857143rem;
  color: var(--text-faint);
}

.memory-empty-card {
  padding: 16px 18px;
  color: var(--text-faint);
}

.memory-recap-list {
  display: flex;
  flex-direction: column;
}

.memory-recap {
  padding: 12px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.memory-recap:last-child {
  border-bottom: none;
}

.memory-recap-title {
  margin: 0 0 4px;
  font-size: 0.928571rem;
  font-weight: 600;
}

.memory-recap-text {
  margin: 0;
  font-size: 0.928571rem;
  line-height: 1.7;
  color: var(--text-soft);
  white-space: pre-wrap;
}
</style>

<!-- 时间线一致性检查（2026-10-05，批次 5-①）。
     入口在左栏「小说大脑 → 时间线」那一项，与伏笔台账同一套路子。

     判定与日期算术在 contracts/timeline-check，样式在 styles/timeline.css。
     这个浮层只报**算术上确凿**的矛盾（日期读不出 / 先后写反 / 正文说几天但日期对不上）；
     「谁该不该在场」「事件该不该发生」是判断不是算术，底部单列一块明写查不出来。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { TIMELINE_BLIND_NOTE, TIMELINE_BLIND_SPOT } from "@mochen/contracts";
import { useTimelineStore } from "../stores/useTimelineStore";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const timeline = useTimelineStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

/** 有日期问题的行才需要上标记色（琥珀），正常的行不吵。 */
function rowClass(relPath: string): string {
  const row = timeline.rows.find((r) => r.relPath === relPath);
  if (row === undefined) return "timeline-row";
  if (row.dateProblem !== "") return "timeline-row is-unknown";
  if (row.date === null) return "timeline-row is-undated";
  return "timeline-row";
}

/** 点某一行 → 右栏打开那篇时间线、台账收起（与伏笔台账同一条口径）。 */
async function openEntry(relPath: string): Promise<void> {
  await book.openDocTab(relPath);
  emit("close");
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

const issueCount = computed(() => timeline.issues.length);
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="timeline-check"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="时间线一致性检查"
      @keydown="keydown"
    >
      <header class="timeline-check-head">
        <strong>时间线</strong>
        <span v-if="timeline.rows.length > 0" class="timeline-check-count">
          {{ timeline.rows.length }} 条 · {{ issueCount }} 处要核
        </span>
        <button class="context-picker-close" type="button" aria-label="关闭时间线" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="timeline-check-note">
        纯本地核对，不联网、不花 token。每条时间线是一篇文稿，日期写在这篇的
        <code>date:</code> 里（<code>YYYY-MM-DD</code>）；没写日期的照列，只是排不进顺序。
      </p>

      <p v-if="timeline.notice !== ''" class="timeline-check-error">{{ timeline.notice }}</p>

      <p v-else-if="timeline.busy" class="timeline-check-empty">正在读全书的时间线…</p>

      <p v-else-if="timeline.rows.length === 0" class="timeline-check-empty">
        这本书还没有时间线。在左栏「时间线」里新建一篇，给它写上 <code>date:</code> 就能排进顺序。
      </p>

      <template v-else>
        <p class="timeline-check-verdict" :class="{ 'is-clean': issueCount === 0 }">
          {{ timeline.verdict }}
        </p>

        <div class="timeline-check-body">
          <ul v-if="timeline.issues.length > 0" class="timeline-check-issues">
            <li v-for="(issue, i) in timeline.issues" :key="`i${i}`" class="timeline-issue">
              <span class="timeline-issue-text">{{ issue.text }}</span>
              <span v-if="issue.reading !== ''" class="timeline-issue-reading">{{
                issue.reading
              }}</span>
              <span class="timeline-issue-links">
                <button
                  v-for="rel in issue.relPaths"
                  :key="rel"
                  class="timeline-issue-link"
                  type="button"
                  @click="void openEntry(rel)"
                >
                  {{ rel.split("/").pop() }}
                </button>
              </span>
            </li>
          </ul>

          <ul class="timeline-check-list">
            <li v-for="row in timeline.rows" :key="row.relPath" :class="rowClass(row.relPath)">
              <span class="timeline-date">
                {{ row.date ?? (row.dateProblem !== "" ? "读不出" : "未排期") }}
              </span>
              <button class="timeline-title" type="button" @click="void openEntry(row.relPath)">
                {{ row.title }}
              </button>
              <span v-if="row.dateProblem !== ''" class="timeline-problem">{{
                row.dateProblem
              }}</span>
              <span v-else-if="row.gist !== ''" class="timeline-gist">{{ row.gist }}</span>
            </li>
          </ul>
        </div>

        <section class="timeline-blind">
          <h4 class="timeline-blind-title">{{ TIMELINE_BLIND_NOTE }}</h4>
          <ul>
            <li v-for="m in TIMELINE_BLIND_SPOT" :key="m.label">
              <b>{{ m.label }}</b
              >：{{ m.hint }}
            </li>
          </ul>
        </section>
      </template>
    </section>
  </Teleport>
</template>

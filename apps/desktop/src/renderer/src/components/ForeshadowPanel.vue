<!-- 伏笔台账（2026-10-05）。
     一条伏笔就是一篇 `foreshadow/` 下的普通文稿，元数据在 frontmatter：
     `status: planted|paid|dropped` + `planted:` / `paid:` 指向章节。

     存在的理由：六枚档案里「总编」的职责写着「伏笔埋设与回收」，但那只是提示词里的一句话——
     全仓没有一处能查「哪条埋了、埋在哪、收了没有」。长篇写到一百万字时，伏笔只能靠人脑记。

     判定在 contracts/foreshadow（状态机与解析）+ utils/foreshadow（行组装与统计），
     读盘在 useBookStore.loadForeshadows，本组件只渲染与派发。样式在 styles/foreshadow.css。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { popoverOwnsKey } from "../utils/slash-commands";
import { foreshadowStats, plantToneLabel } from "../utils/foreshadow";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

const rows = computed(() => book.foreshadowRows);
const stats = computed(() => foreshadowStats(rows.value));

/** 点一行：去右栏打开那篇伏笔，把台账和正文对上。 */
async function openRow(relPath: string): Promise<void> {
  await book.openDocTab(relPath);
  close();
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

onMounted(() => {
  if (rows.value.length === 0) void book.loadForeshadows();
});
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="foreshadow-ledger"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="伏笔台账"
      @keydown="keydown"
    >
      <header class="foreshadow-head">
        <strong>伏笔台账</strong>
        <span class="foreshadow-count">{{ stats.total }} 条</span>
        <button class="context-picker-close" type="button" aria-label="关闭伏笔台账" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="foreshadow-note">
        每条伏笔是一篇伏笔文稿，元数据写在文首：<code>status: planted / paid / dropped</code>，
        <code>planted:</code> 与 <code>paid:</code> 写章节。点一行去正文里改。
      </p>

      <p v-if="book.foreshadowsBusy && rows.length === 0" class="foreshadow-empty">
        正在读伏笔台账…
      </p>
      <p v-else-if="rows.length === 0" class="foreshadow-empty">
        还没有伏笔。在左栏「故事规划」里新建一篇「伏笔」文稿，埋下一个再回来登记。
      </p>

      <template v-else>
        <dl class="foreshadow-stats">
          <div>
            <dt>待回收</dt>
            <dd>{{ stats.pending }}</dd>
          </div>
          <div>
            <dt>已回收</dt>
            <dd>{{ stats.paid }}</dd>
          </div>
          <div>
            <dt>已弃用</dt>
            <dd>{{ stats.dropped }}</dd>
          </div>
          <div v-if="stats.broken > 0" class="is-broken">
            <dt>状态坏了</dt>
            <dd>{{ stats.broken }}</dd>
          </div>
        </dl>

        <ul class="foreshadow-list">
          <li v-for="row in rows" :key="row.relPath">
            <!-- 语气 class 用字面量三元而不是 `is-${row.tone}` 模板串：
                 styles/dead-css-guard 靠静态扫类名确认每条规则都有消费者，动态拼的它认不出。 -->
            <button
              class="foreshadow-row"
              type="button"
              :class="
                row.tone === 'broken'
                  ? 'is-broken'
                  : row.tone === 'unknown'
                    ? 'is-unknown'
                    : row.tone === 'pending'
                      ? 'is-pending'
                      : row.tone === 'paid'
                        ? 'is-paid'
                        : 'is-dropped'
              "
              @click="void openRow(row.relPath)"
            >
              <AppIcon name="pin" :size="13" />
              <span class="foreshadow-title">{{ row.title }}</span>
              <span class="foreshadow-status">{{ row.statusLabel }}</span>
              <span class="foreshadow-where">
                <template v-if="row.plantedIn">埋于 {{ row.plantedIn }}</template>
                <template v-else>没写埋在哪</template>
                <template v-if="row.paidIn"> · 收于 {{ row.paidIn }}</template>
              </span>
              <span class="foreshadow-hint">{{ plantToneLabel(row.tone) }}</span>
            </button>
          </li>
        </ul>
      </template>
    </section>
  </Teleport>
</template>

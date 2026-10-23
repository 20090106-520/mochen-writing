<!-- 人物设定核对（2026-10-22）。
     与伏笔台账、时间线核对同一套路子：入口是右栏头部一枚按钮，锚点就是那颗按钮本身。

     判定真身在 contracts/character-card，读盘在 stores/useCastCheckStore，样式在 styles/cast-check.css。
     这张表只判**作者自己在人物卡上声明过**的三格（aliases / voice / exit），
     不做语义推断；底部那块明写查不出来的是什么。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { CAST_BLIND_NOTE, CAST_BLIND_SPOT } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { castGroups, useCastCheckStore } from "../stores/useCastCheckStore";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const cast = useCastCheckStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 430 }
);

const groups = computed(() => castGroups(cast.findings));

/** 点某一处 → 右栏打开那一篇（章节或人物卡），浮层收起（与另外两张台账同一条口径）。 */
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
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="cast-check"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="人物设定核对"
      @keydown="keydown"
    >
      <header class="cast-check-head">
        <strong>人物核对</strong>
        <span v-if="cast.findings.length > 0" class="cast-check-count">
          硬伤 {{ cast.defectCount }} · 疑似 {{ cast.suspectCount }} · 缺口 {{ cast.gapCount }}
        </span>
        <button class="context-picker-close" type="button" aria-label="关闭人物核对" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="cast-check-note">
        纯本地核对，不联网、不花 token。只判人物卡 frontmatter 里写明的三格：
        <code>aliases</code>（别名算出场）、<code>voice</code>（专属说法）、
        <code>exit</code>（退场章）。没写的角色不参与。
      </p>

      <p v-if="cast.notice !== ''" class="cast-check-error">{{ cast.notice }}</p>

      <p v-else-if="cast.busy" class="cast-check-empty">正在读全书的人物卡与章节…</p>

      <p v-else-if="cast.cardCount === 0" class="cast-check-empty">
        这本书还没有人物卡。在左栏「人物」里建一张，写上 <code>aliases</code> / <code>voice</code> /
        <code>exit</code> 就能参与核对。
      </p>

      <template v-else>
        <p class="cast-check-verdict" :class="{ 'is-clean': cast.findings.length === 0 }">
          {{ cast.verdict }}
        </p>

        <div class="cast-check-body">
          <section v-for="group in groups" :key="group.level" class="cast-group">
            <h4 class="cast-group-title">{{ group.label }}（{{ group.rows.length }}）</h4>
            <ul class="cast-group-list">
              <li v-for="(row, i) in group.rows" :key="`${group.level}-${i}`" class="cast-finding">
                <p class="cast-finding-message">{{ row.message }}</p>
                <p v-if="row.chapter !== ''" class="cast-finding-place">
                  在
                  <button
                    class="cast-finding-link"
                    type="button"
                    @click="void openEntry(row.chapter)"
                  >
                    {{ row.chapter.split("/").pop() }}
                  </button>
                  第 {{ row.line }} 行
                  <span v-if="row.quote !== ''" class="cast-finding-quote"
                    >「{{ row.quote }}」</span
                  >
                </p>
                <button
                  class="cast-finding-link"
                  type="button"
                  @click="void openEntry(row.cardPath)"
                >
                  打开「{{ row.card }}」这张卡
                </button>
              </li>
            </ul>
          </section>
        </div>

        <section class="cast-blind">
          <h4 class="cast-blind-title">{{ CAST_BLIND_NOTE }}</h4>
          <ul>
            <li v-for="m in CAST_BLIND_SPOT" :key="m.label">
              <b>{{ m.label }}</b
              >：{{ m.hint }}
            </li>
          </ul>
        </section>
      </template>
    </section>
  </Teleport>
</template>

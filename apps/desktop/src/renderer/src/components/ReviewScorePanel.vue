<!-- 多视角审稿打分（2026-10-05，批次 4-②）。
     入口挂在左栏「审核检查」组，与那三项 AI 检查做邻居但**分工是硬的**：
     那三项要调 AI（烧 token、要等、还得联网），所以至今只预填一句提问；
     这一项**不调模型**，四个维度的分数都是从正文本身数出来的，查表即得、离线可用。
     同一个面板里明写「算不出哪几项」——本地数不了的就说数不了，绝不编一个分。

     判定与文案在 utils/review-score.ts，样式在 styles/review.css。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  MISSING_METRICS,
  METRIC_MISSING_NOTE,
  NEUTRAL_SCORE,
  SCORE_BANDS,
  reviewReport,
  scoreBandOf,
  scoreBarWidth,
  type ReviewScore
} from "../utils/review-score";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

/** 扫的是**活动文稿的当前草稿**（含未保存手改），与去 AI 味同一条口径。 */
const report = computed(() => reviewReport(book.draft));
const docTitle = computed(
  () => book.docs.find((d) => d.relPath === book.activeDocTab)?.title ?? "这一篇"
);

/** 分数条的中性刻度位置：60 分在 0-100 的条上落在哪儿（界面上标出来，免得看成「还差 60 分」）。 */
const neutralMark = `${NEUTRAL_SCORE}%`;

function bandOf(score: ReviewScore): string {
  return SCORE_BANDS[scoreBandOf(score.score)];
}

/**
 * 把读数交给 AI 追问——**只预填不自动发送**（与左栏 AI 检查、去 AI 味同一条口径：
 * 用户保留最后一道编辑权）。给的是读数不是结论，让 AI 去看具体是哪几处。
 */
function askAi(): void {
  if (book.activeDocTab === null) return;
  const lines = report.value.scores
    .map((s) => `- ${s.label}（${bandOf(s)}，${s.score} 分）：${s.reading}——${s.hint}`)
    .join("\n");
  agent.prefillComposer(
    threadKeyFor(book.activeDocTab),
    `我在写「${docTitle.value}」，下面是本地统计出来的读数。请你**不要给分数**，只针对每一项指出具体是哪几句、该怎么改：\n${lines}\n\n顺带看看剧情推进与人物动机有没有问题——那两项本地给不出分，需要你通读判断。`
  );
  close();
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
      class="review-score"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="多视角审稿打分"
      @keydown="keydown"
    >
      <header class="review-score-head">
        <strong>审稿打分</strong>
        <span v-if="report.scores.length > 0" class="review-score-overall">
          综合 {{ report.overall }}
        </span>
        <button class="context-picker-close" type="button" aria-label="关闭审稿打分" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <!-- 滚动体：说明、四个维度、算不出的那几项都在这里滚。
           主操作留在浮层本体不滚——2026-10-05 真机截图：按钮跟着内容一起滚到列表中间，
           把后两个维度和「算不出那两项」全压在下面看不见了。改稿历史那次的同款教训。 -->
      <div class="review-score-body">
        <p class="review-score-note">
          纯本地统计，不联网、不花 token。分数**量的是写法有多常规，不是写得好不好**—— 60
          是中性基准，<b>不是及格线</b>；同一段文字换个题材，常规的样子就不同。
        </p>

        <p v-if="book.draft.trim() === ''" class="review-score-empty">
          这一篇还没有正文，没什么可数的。
        </p>

        <template v-else>
          <p class="review-score-summary">{{ report.summary }}</p>

          <ul class="review-score-list">
            <li
              v-for="score in report.scores"
              :key="score.metric"
              class="review-score-item"
              :class="{ 'is-low': scoreBandOf(score.score) === 'low' }"
            >
              <div class="review-score-row">
                <span class="review-score-label">{{ score.label }}</span>
                <span class="review-score-band">{{ bandOf(score) }}</span>
                <span class="review-score-num">{{ score.score }}</span>
              </div>
              <div
                class="review-score-bar"
                role="img"
                :aria-label="`${score.label} ${score.score} 分`"
              >
                <span class="review-score-fill" :style="{ width: scoreBarWidth(score.score) }" />
                <span class="review-score-mark" :style="{ left: neutralMark }" />
              </div>
              <span class="review-score-reading">{{ score.reading }}</span>
              <span class="review-score-hint">{{ score.hint }}</span>
            </li>
          </ul>

          <section class="review-score-missing">
            <h4 class="review-score-missing-title">{{ METRIC_MISSING_NOTE }}</h4>
            <ul>
              <li v-for="m in MISSING_METRICS" :key="m.label">
                <b>{{ m.label }}</b
                >：{{ m.hint }}
              </li>
            </ul>
          </section>
          <p class="review-score-fineprint">
            那三项检查（一致性 / 剧情 / 逻辑）仍在左栏——它们要调模型，看的是这一篇对不对得上全书。
          </p>
        </template>
      </div>

      <button
        v-if="book.draft.trim() !== ''"
        class="review-score-hand"
        type="button"
        @click="askAi"
      >
        让 AI 看具体是哪几句
      </button>
    </section>
  </Teleport>
</template>

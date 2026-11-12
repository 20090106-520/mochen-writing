<!-- 去 AI 味检查（2026-10-05）。
     与左栏「一致性 / 剧情 / 逻辑」三项的分工：那三项**要调 AI**（烧 token、要等、要联网），
     这一项是**纯本地查表**——零成本、零延迟、离线可用，所以它敢常驻在右栏随手点。

     判定与文案在 utils/ai-slop.ts，样式在 styles/ai-slop.css。
     面板只做三件事：把命中逐条摆出来、说清强信号与弱信号的区别、把清单交给 AI 去改。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { findAiSlop, slopChecklistPrompt, slopGateOf, slopVerdict } from "../utils/ai-slop";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useReviewIssuesStore } from "../stores/useReviewIssuesStore";
import type { IssueStatus } from "../utils/review-issues";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const notify = useNotificationStore();
const issues = useReviewIssuesStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 420 }
);

/** 扫的是**活动文稿的当前草稿**（含还没落盘的手改），不是盘上那份——否则扫出来的东西用户没写过。 */
const hits = computed(() => findAiSlop(book.draft));
const verdict = computed(() => slopVerdict(hits.value, book.draft));
/**
 * 退稿闸预演：闸自己的判决，不在这边重判一遍。
 * 写完一章交出去之前先看这一格——闸拦的稿模型得重写一轮，那一轮的时间本来能用来写下一章。
 */
const gate = computed(() => slopGateOf(book.draft));
const strongHits = computed(() => hits.value.filter((h) => h.strength === "strong"));
const suspectHits = computed(() => hits.value.filter((h) => h.strength === "suspect"));
const docTitle = computed(
  () => book.docs.find((d) => d.relPath === book.activeDocTab)?.title ?? "这一篇"
);

/* ───── 本章问题清单（W-04 第一刀）：留存的是「上次体检的结论」，不是这一秒的扫描 ───── */

/** 命中列表是实时的 computed，清单是按章留存的——两者分开摆，别让作者以为改一个字就改了结论。 */
const savedIssues = computed(() =>
  book.activeDocTab === null ? [] : issues.issuesFor(book.activeDocTab)
);
const openIssues = computed(
  () => savedIssues.value.filter((item) => item.status === "open").length
);
const issueSummary = computed(() => {
  if (book.activeDocTab === null) return "打开一章后才能留存问题。";
  if (savedIssues.value.length === 0) return "本章还没有留存的问题。";
  return openIssues.value > 0 ? `本章还有 ${openIssues.value} 条待修。` : "本章清单都处理完了。";
});
const issueButtonLabel = computed(() =>
  savedIssues.value.length > 0 ? "复检这一章" : "记进本章清单"
);

/** 只在用户点按钮时并一次：跟着输入实时跑会把清单抖成「已修 / 待修」来回翻。 */
function recordCheck(): void {
  const rel = book.activeDocTab;
  if (rel === null) return;
  issues.check(rel, hits.value);
  notify.notify({
    title: "交稿问题",
    message: "这一章的结论已记下，改完再点一次复检。",
    level: "info"
  });
}

function setIssueStatus(id: string, status: IssueStatus): void {
  const rel = book.activeDocTab;
  if (rel === null) return;
  issues.setStatus(rel, id, status);
}

function statusLabel(status: IssueStatus): string {
  return status === "open" ? "待修" : status === "fixed" ? "已修" : "已忽略";
}

/**
 * 把本地清单交给 AI 改。
 * 与左栏 AI 检查同一条口径：**只预填不自动发送**——用户保留最后一道编辑权。
 */
function handToAi(): void {
  if (book.activeDocTab === null) return;
  agent.prefillComposer(
    threadKeyFor(book.activeDocTab),
    slopChecklistPrompt(hits.value, docTitle.value, gate.value)
  );
  notify.notify({
    title: "去 AI 味",
    message: "改写清单已填进输入框，你看过再发送。",
    level: "info"
  });
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
  // Tab 在浮层里循环，不许跑到后面的正文输入框去（这层是真焦点陷阱）。
  if (event.key === "Tab") tab(event);
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="ai-slop"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="去 AI 味检查"
      @keydown="keydown"
    >
      <header class="ai-slop-head">
        <strong>去 AI 味</strong>
        <!-- 判定 class 用字面量对象绑定而不是 `is-${level}` 模板串：
             styles/dead-css-guard 靠静态扫类名确认每条规则都有消费者，动态拼的它认不出，
             那条规则就会被当成死 CSS 拦下。 -->
        <span class="ai-slop-verdict" :class="{ 'is-heavy': verdict.level === 'heavy' }">{{
          verdict.label
        }}</span>
        <button class="context-picker-close" type="button" aria-label="关闭去 AI 味" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="ai-slop-note">
        纯本地查表，不联网、不花 token。查的是套话与万能句式，<b>报出来是提醒，不是判你写错了</b>。
      </p>

      <!-- 本章清单（W-04 第一刀）：上面这句是「这一秒的扫描」，这一栏是「上次体检留下的结论」。
           两者分开摆，免得作者以为改一个字就等于改了结论。只在点按钮时并一次。 -->
      <div class="ai-slop-issue-bar">
        <span class="ai-slop-issue-summary">{{ issueSummary }}</span>
        <button
          class="ai-slop-issue-record"
          type="button"
          :disabled="book.activeDocTab === null"
          @click="recordCheck"
        >
          {{ issueButtonLabel }}
        </button>
      </div>
      <p v-if="issues.saveError !== ''" class="ai-slop-note">{{ issues.saveError }}</p>

      <section v-if="savedIssues.length > 0" class="ai-slop-saved">
        <h4 class="ai-slop-section-title">本章清单（{{ openIssues }} 条待修）</h4>
        <ul class="ai-slop-saved-list">
          <li v-for="item in savedIssues" :key="item.id" class="ai-slop-saved-item">
            <span class="ai-slop-saved-state" :class="{ 'is-open': item.status === 'open' }">{{
              statusLabel(item.status)
            }}</span>
            <span class="ai-slop-saved-word">{{ item.matched }}</span>
            <span class="ai-slop-saved-line">第 {{ item.line }} 行</span>
            <button
              class="ai-slop-saved-action"
              type="button"
              @click="setIssueStatus(item.id, item.status === 'ignored' ? 'open' : 'ignored')"
            >
              {{ item.status === "ignored" ? "恢复" : "忽略" }}
            </button>
          </li>
        </ul>
      </section>

      <p v-if="book.draft.trim() === ''" class="ai-slop-empty">这一篇还没有正文。</p>

      <template v-else>
        <p v-if="hits.length === 0" class="ai-slop-empty">
          这一篇没扫出 AI 腔——按这个手感继续写就行。
        </p>

        <section v-if="strongHits.length > 0" class="ai-slop-section">
          <h4 class="ai-slop-section-title">套话 · 建议改（{{ strongHits.length }}）</h4>
          <ul class="ai-slop-list">
            <li
              v-for="(hit, index) in strongHits"
              :key="`s${hit.line}-${index}`"
              class="ai-slop-item"
            >
              <span class="ai-slop-line">第 {{ hit.line }} 行</span>
              <span class="ai-slop-word">{{ hit.matched }}</span>
              <span class="ai-slop-why">{{ hit.why }}</span>
              <span class="ai-slop-excerpt">{{ hit.excerpt }}</span>
            </li>
          </ul>
        </section>

        <section v-if="suspectHits.length > 0" class="ai-slop-section">
          <h4 class="ai-slop-section-title is-mild">
            常见句式 · 先留着自己判断（{{ suspectHits.length }}）
          </h4>
          <ul class="ai-slop-list">
            <li
              v-for="(hit, index) in suspectHits"
              :key="`m${hit.line}-${index}`"
              class="ai-slop-item is-mild"
            >
              <span class="ai-slop-line">第 {{ hit.line }} 行</span>
              <span class="ai-slop-word">{{ hit.matched }}</span>
              <span class="ai-slop-excerpt">{{ hit.excerpt }}</span>
            </li>
          </ul>
        </section>

        <!-- 退稿闸预演：词表查的是「哪一行有套话」，这一格查的是「整篇交上去会不会被退回」。
             两者判据不同（前者逐行、后者看节奏与结构），所以并排放，互相替不了。 -->
        <section class="ai-slop-gate" :class="{ 'is-blocked': !gate.pass }">
          <h4 class="ai-slop-section-title">退稿闸预演</h4>
          <p v-if="gate.headline !== ''" class="ai-slop-gate-line">{{ gate.headline }}</p>
          <ul v-else class="ai-slop-gate-list">
            <li v-for="(reason, index) in gate.reasons" :key="`g${index}`">{{ reason }}</li>
          </ul>
        </section>

        <p class="ai-slop-caveat">
          共 {{ verdict.hits }} 处，每千字 {{ verdict.perThousand }} 处。改完这一篇再点一次复查。
        </p>

        <button class="ai-slop-hand" type="button" @click="handToAi">把这份清单交给 AI 改</button>
      </template>
    </section>
  </Teleport>
</template>

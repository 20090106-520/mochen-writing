<!-- 去 AI 味检查（2026-10-05）。
     与左栏「一致性 / 剧情 / 逻辑」三项的分工：那三项**要调 AI**（烧 token、要等、要联网），
     这一项是**纯本地查表**——零成本、零延迟、离线可用，所以它敢常驻在右栏随手点。

     判定与文案在 utils/ai-slop.ts，样式在 styles/ai-slop.css。
     面板做四件事：把命中逐条摆出来、说清强信号与弱信号的区别、把清单交给 AI 去改，
     以及按章留存「本章清单」——那一栏收的是审稿五套检查的结论，不只这一项词表命中。 -->
<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  findAiSlop,
  slopChecklistPrompt,
  slopGateOf,
  slopVerdict,
  type SlopHit
} from "../utils/ai-slop";
import { revealEditorLine } from "../utils/editor-reveal";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useReviewIssuesStore } from "../stores/useReviewIssuesStore";
import {
  ISSUE_SOURCE_LABELS,
  openSlopHitsOf,
  slopOpenCount,
  type IssueSource,
  type IssueStatus,
  type ReviewIssue
} from "../utils/review-issues";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const notify = useNotificationStore();
const issues = useReviewIssuesStore();
const panel = ref<HTMLElement>();
/** 跳原文没定位到时如实说一句：清单里的行号是上次体检的快照，正文可能已经改过。 */
const jumpNotice = ref("");
/** 收齐五套检查是异步读盘，得给一个「正在收」和一句失败说明。 */
const collecting = ref(false);
const collectError = ref("");

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
  savedIssues.value.length > 0 ? "复检这一章" : "收齐本章检查"
);

/**
 * 交给 AI 改的那份清单：**有留存结论时只交待修的「去 AI 味」条目**。
 * 清单现在装着五套来源，而这颗按钮的指令是「逐条改掉这些套话」；把人物卡缺字段、
 * 伏笔待回收当成套话递给模型，它只会照着编一段不存在的文字。所以按 `slopOpenCount`
 * 单独数，两种情形回退实时命中：
 * ① 还没体检过——不强迫先点一次「收齐本章检查」才能用主操作；
 * ② 词表条目全处理完——退稿闸是整篇判据、根本不在清单里，仍要能交出去让它改节奏。
 */
const slopOpen = computed(() => slopOpenCount(savedIssues.value));
const pendingHits = computed<SlopHit[]>(() =>
  slopOpen.value > 0 ? openSlopHitsOf(savedIssues.value) : hits.value
);
const handLabel = computed(() =>
  slopOpen.value > 0 ? `把本章待修的 ${slopOpen.value} 条交给 AI 改` : "把这份清单交给 AI 改"
);

/**
 * 点行号跳原文（W-04 第二刀）。
 *
 * 【行号口径】`findAiSlop` 是按 `book.draft` 原始草稿逐行数的（含 frontmatter），
 * 与编辑框里的行号一模一样，所以直接 `revealEditorLine`；`draftLineOfBodyLine` 那道换算
 * 只给「按剥掉 frontmatter 之后的正文数行」的判据用（交稿体检的人物核对），这里用了反倒偏几行。
 *
 * 预览态没有 textarea，先切回 edit，等一帧再找编辑框。定位成功时 `revealEditorLine`
 * 会 `el.focus()`，浮层通路的 focusin 监听顺手把面板收掉（「别挡着看正文」是现成口径，
 * 这里不必手动 close）；失败时面板留着，正好显示 jumpNotice。
 */
async function jumpToLine(line: number): Promise<void> {
  jumpNotice.value = "";
  if (book.editorViewMode === "preview") book.editorViewMode = "edit";
  await nextTick();
  if (!revealEditorLine(line)) {
    jumpNotice.value = `没能定位到第 ${line} 行（正文可能已经改过，先点一次「复检这一章」）。`;
  }
}

/** v1 档没存 locate：那时只有词表条目，有行号就是能跳行。 */
function locateOf(item: ReviewIssue): "line" | "doc" | "none" {
  return item.locate ?? (item.line > 0 ? "line" : "none");
}

function sourceLabel(source: IssueSource): string {
  return ISSUE_SOURCE_LABELS[source];
}

/**
 * 文稿级条目：跳到那篇文稿，与 SearchPanel.jumpToHit 同一条路（章节进标签、其余浏览）。
 * 不给行号就不调 revealEditorLine，浮层不会因 focusin 自动收起，所以这里手动 close。
 * 篇级读数（审稿打分那类）连文稿都归不上，UI 干脆不给按钮，不伪造一个落点。
 */
async function jumpToDoc(item: ReviewIssue): Promise<void> {
  const rel = item.relPath ?? book.activeDocTab;
  if (rel === null || rel === "") return;
  const ref = book.refOf(rel);
  if (!ref) return;
  if (ref.kind === "chapter") await book.openDocTab(rel);
  else book.browse(ref);
  close();
}

/**
 * 收齐本章五套检查并记一次。只在用户点按钮时并一次：跟着输入实时跑会把清单抖成
 * 「已修 / 待修」来回翻。判据与异步汇总都在 store 那头，这里只管按钮态和一句失败说明。
 */
async function recordCheck(): Promise<void> {
  const rel = book.activeDocTab;
  if (rel === null || collecting.value) return;
  collecting.value = true;
  collectError.value = "";
  try {
    await issues.collect(rel, book.draft);
    notify.notify({
      title: "交稿问题",
      message: "本章五套检查的结论已记下，改完再点一次复检。",
      level: "info"
    });
  } catch (err) {
    collectError.value = `没能收齐本章检查：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    collecting.value = false;
  }
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
 * 把清单交给 AI 改。
 * 与左栏 AI 检查同一条口径：**只预填不自动发送**——用户保留最后一道编辑权。
 * 喂的是 `pendingHits`（留存清单的待修 / 实时命中），不是这一秒的 `hits`：
 * 否则 W-04 跟踪了半天的结论在最后一步被绕过去。
 */
function handToAi(): void {
  if (book.activeDocTab === null) return;
  agent.prefillComposer(
    threadKeyFor(book.activeDocTab),
    slopChecklistPrompt(pendingHits.value, docTitle.value, gate.value)
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
        下面「本章清单」收齐审稿五套检查的结论，按章留在书里。
      </p>

      <!-- 本章清单（W-04 第一刀）：上面这句是「这一秒的扫描」，这一栏是「上次体检留下的结论」。
           两者分开摆，免得作者以为改一个字就等于改了结论。只在点按钮时并一次。 -->
      <div class="ai-slop-issue-bar">
        <span class="ai-slop-issue-summary">{{ issueSummary }}</span>
        <button
          class="ai-slop-issue-record"
          type="button"
          :disabled="book.activeDocTab === null || collecting"
          @click="recordCheck"
        >
          {{ collecting ? "正在收齐…" : issueButtonLabel }}
        </button>
      </div>
      <p v-if="issues.saveError !== ''" class="ai-slop-note">{{ issues.saveError }}</p>
      <p v-if="collectError !== ''" class="ai-slop-note">{{ collectError }}</p>
      <p v-if="jumpNotice !== ''" class="ai-slop-note">{{ jumpNotice }}</p>

      <section v-if="savedIssues.length > 0" class="ai-slop-saved">
        <h4 class="ai-slop-section-title">本章清单（{{ openIssues }} 条待修）</h4>
        <ul class="ai-slop-saved-list">
          <li v-for="item in savedIssues" :key="item.id" class="ai-slop-saved-item">
            <span class="ai-slop-saved-state" :class="{ 'is-open': item.status === 'open' }">{{
              statusLabel(item.status)
            }}</span>
            <span class="ai-slop-saved-source">{{ sourceLabel(item.source) }}</span>
            <span class="ai-slop-saved-word">{{ item.title ?? item.matched }}</span>
            <button
              v-if="locateOf(item) === 'line'"
              class="ai-slop-saved-line ai-slop-jump"
              type="button"
              :aria-label="`跳到第 ${item.line} 行`"
              @click="jumpToLine(item.line)"
            >
              第 {{ item.line }} 行
            </button>
            <button
              v-else-if="locateOf(item) === 'doc'"
              class="ai-slop-saved-line ai-slop-jump"
              type="button"
              aria-label="打开这一条指向的文稿"
              @click="jumpToDoc(item)"
            >
              打开文稿
            </button>
            <span v-else class="ai-slop-saved-line">篇级</span>
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
              <button
                class="ai-slop-line ai-slop-jump"
                type="button"
                :aria-label="`跳到第 ${hit.line} 行`"
                @click="jumpToLine(hit.line)"
              >
                第 {{ hit.line }} 行
              </button>
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
              <button
                class="ai-slop-line ai-slop-jump"
                type="button"
                :aria-label="`跳到第 ${hit.line} 行`"
                @click="jumpToLine(hit.line)"
              >
                第 {{ hit.line }} 行
              </button>
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

        <button class="ai-slop-hand" type="button" @click="handToAi">{{ handLabel }}</button>
      </template>
    </section>
  </Teleport>
</template>

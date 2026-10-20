<!-- 书稿体检（SideNavNoticeDialog 的 terms 形态，2026-10-11 从 SideNavNoticeDialog.vue 拆出）。
     为什么拆：那一支自己就占 272 行模板 + 一整套计算（八类报告、9 个检查函数、5 个 label 函数），
     而另外五支形态（规划中 / 未打开作品 / 统计 / 回收站 / 备份）合计不到 60 行。
     混在一个文件里，于是「打开回收站要滚动 400 行才找得到」——**这是体量问题，不是职责问题**：
     六支都是同一个对话框的不同内容，共享外层那格 backdrop / 焦点 / Esc / 入场动画，所以
     **对话框外壳留在父组件，这一支只搬内容**。

     【搬走了什么、留下了什么】
     搬走：八类报告的全部状态与计算、docLabel / aiFlavorLabel / dialogueLabel / driftLabel /
     spreadLabel 五个展示名函数、rewriteWithAgent 一键改写、以及 openCheckupDoc / openCharacterCard
     两个「点条目直达文稿」的落点。
     留下（父组件仍然拥有）：对话框外壳、焦点与 Esc（useModalFocus）、入场动画（useDialogMotion）、
     回收站与备份两支、stats 表格、以及 close / onAction 那两个 emit 出口。
     所以 `close` 从 props 进来而不是本组件自己 emit —— **出口仍然只有父组件一处**。

     【判定真身一个都没动】
     八类检查的判定仍在 utils/doc-checkup 与 contracts，本组件只做「逐篇拉全文 → 各算一遍 → 摆出来」；
     展示名仍读 contracts 里的 *_LABELS，界面不另抄一份。拆的是文件，不是判定。 -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { useAgentStore } from "../stores/useAgentStore";
import { useLayoutStore } from "../stores/layoutStore";
import { threadKeyFor } from "../stores/useAgentStore";
import {
  AI_FLAVOR_CATEGORY_LABELS,
  AI_FLAVOR_TIER_LABELS,
  DIALOGUE_VERDICT_LABELS,
  type AiFlavorCategory,
  type AiFlavorReport,
  type AiFlavorTier,
  type DialogueVerdict
} from "@mochen/contracts";
import {
  analyzeAiFlavor,
  chapterDialogueRows,
  chapterReadoutRows,
  findDuplicateSentences,
  findPunctuationIssues,
  findTermVariants,
  findVoiceDrift,
  loadAllDocContents,
  topPhrases,
  trackCharacterAppearances,
  type ChapterDialogueRow,
  type ChapterReadoutRow,
  type CharacterAppearance,
  type DuplicateSentence,
  type PhraseRow,
  type PunctuationIssue,
  type TermVariantSuspect,
  type VoiceDriftSuspect
} from "../utils/doc-checkup";
import { styleCheckPrompt } from "../utils/side-nav";
import type { BookDoc } from "../types/book-doc";

/**
 * `open` 就是父组件那一格 v-else-if 的判据真身（notice.kind === "terms"）。
 * 父组件渲染到这一支才为真，所以「开门现算」在这里自动成立，
 * 不必再抄一份 watch（铁律 6：同一处判定只留一份）。
 */
const props = defineProps<{ open: boolean }>();
/** 收掉对话框：出口仍在父组件（close / onAction 都归它），这里只通知一声。 */
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const agent = useAgentStore();
const layout = useLayoutStore();

const termsScanning = ref(false);
const termSuspects = ref<TermVariantSuspect[]>([]);
const punctuationIssues = ref<PunctuationIssue[]>([]);
const duplicateSentences = ref<DuplicateSentence[]>([]);
const characterRows = ref<CharacterAppearance[]>([]);
/** AI 味扫描（第五类）：判定真身住 contracts，与提示词文风硬约束同一份词库。 */
const aiReport = ref<AiFlavorReport | null>(null);
/** 对话占比（第六类）与角色腔调漂移（第七类）：判定真身住 doc-checkup / contracts。 */
const dialogueRows = ref<ChapterDialogueRow[]>([]);
const driftRows = ref<VoiceDriftSuspect[]>([]);
/** 高频词口头禅榜（第八类）：信息榜不是判线，照出你自己的用词习惯。 */
const phraseRows = ref<PhraseRow[]>([]);
/** 逐章活性／退化读数（2026-10-20）：纯读数表，不判定、不排序（真身住 contracts）。 */
const chapterReadouts = ref<ChapterReadoutRow[]>([]);
/** 有问题的篇（标点/重复句按 docIndex 报），映射回篇名给表格用。 */
const checkupDocs = ref<BookDoc[]>([]);

/** 开门现算——书是活的，缓存会撒谎。 */
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    termSuspects.value = [];
    punctuationIssues.value = [];
    duplicateSentences.value = [];
    characterRows.value = [];
    aiReport.value = null;
    dialogueRows.value = [];
    driftRows.value = [];
    phraseRows.value = [];
    chapterReadouts.value = [];
    checkupDocs.value = [];
    if (book.docs.length === 0) return;
    termsScanning.value = true;
    void loadAllDocContents(book.docs)
      .then((docs) => {
        checkupDocs.value = docs;
        const contents = docs.map((doc) => doc.content);
        termSuspects.value = findTermVariants(contents);
        punctuationIssues.value = findPunctuationIssues(contents);
        duplicateSentences.value = findDuplicateSentences(contents);
        aiReport.value = analyzeAiFlavor(contents);
        phraseRows.value = topPhrases(contents);
        const chapterEntries = docs
          .map((doc, idx) => ({
            docIndex: idx,
            kind: doc.kind,
            title: doc.title,
            content: doc.content
          }))
          .filter((entry) => entry.kind === "chapter");
        dialogueRows.value = chapterDialogueRows(chapterEntries);
        chapterReadouts.value = chapterReadoutRows(chapterEntries);
        const characterNames = book.docs
          .filter((doc) => doc.kind === "character")
          .map((doc) => doc.title);
        characterRows.value = trackCharacterAppearances(
          characterNames,
          chapterEntries.map(({ title, content }) => ({ title, content }))
        );
        driftRows.value = findVoiceDrift(characterNames, chapterEntries);
      })
      .finally(() => {
        termsScanning.value = false;
      });
  },
  { immediate: true }
);

/**
 * AI 味一键改写（2026-10-10 二段）：拿**当前章**真扫出的命中清单预填对话——
 * 与审核检查同一句真身（展开右栏面板 + prefillComposer，不自动发送，发送权在用户）。
 * 模型拿到的是具体词表与次数，不是一句泛泛的「去去 AI 味」。
 */
async function rewriteWithAgent(): Promise<void> {
  layout.setPaneCollapsed("right", false);
  const relPath = book.activeDocTab;
  if (relPath === null) return;
  const loaded = await window.mochen.readDoc(relPath).catch(() => null);
  const report = loaded === null ? null : analyzeAiFlavor([loaded.content]);
  agent.prefillComposer(threadKeyFor(relPath), styleCheckPrompt(report));
}

/** 标点/重复句条目按 docIndex 找回篇名（找不到就回落到序号，不编名字）。 */
function docLabel(docIndex: number): string {
  return checkupDocs.value[docIndex]?.title ?? `第 ${docIndex + 1} 篇`;
}

/** AI 味类目的中文展示名（labels 真身住 contracts，界面不另抄一份）。 */
function aiFlavorLabel(category: AiFlavorCategory): string {
  return AI_FLAVOR_CATEGORY_LABELS[category];
}

/** AI 味处置档位的中文展示名（labels 真身住 contracts，界面不另抄一份）。 */
function aiTierLabel(tier: AiFlavorTier): string {
  return AI_FLAVOR_TIER_LABELS[tier];
}

/**
 * AI 味条目的展示顺序（2026-10-20 P2-⑧）：阻断档（单独可退稿）排在前面，同档保持契约原序。
 * 只在界面排——契约的 order 仍按次数降序，「本书套话回流」取前 5 那两处注入不受影响。
 */
const aiEntries = computed(() => {
  const entries = aiReport.value?.entries ?? [];
  return [...entries].sort((x, y) => (x.tier === y.tier ? 0 : x.tier === "blocking" ? -1 : 1));
});

/** 阻断档条数（单独可退稿的条目），给表头一句话说清「这份报告里哪几条真的会拦稿」。 */
const aiBlockingCount = computed(
  () => aiEntries.value.filter((entry) => entry.tier === "blocking").length
);

/** 对话占比判读的中文展示名（labels 真身住 contracts，界面不另抄一份）。 */
function dialogueLabel(verdict: DialogueVerdict): string {
  return DIALOGUE_VERDICT_LABELS[verdict];
}

/** 漂移方向的说法（判定已在 doc-checkup 里做掉，这里只把方向说成人话）。 */
function driftLabel(row: VoiceDriftSuspect): string {
  return row.chapterMean > row.baselineMean ? "话变多了" : "话变短了";
}

/**
 * 句长波动的判读：0.5 以下算「偏均匀」——连续句子长短雷同是机器味的特征之一；
 * 阈值是经验值，报判读也报原始数，不拿结论吞数字。
 */
function spreadLabel(spread: number | null): string {
  if (spread === null) return "篇幅太短，不好判断";
  if (spread < 0.5) return "偏均匀（机器味特征之一）";
  if (spread < 0.8) return "正常";
  return "起伏大";
}

/**
 * 体检条目点击直达：打开对应文稿——章节进标签、其余浏览，
 * 与 SearchPanel.jumpToHit 同一条路。对话框顺手收掉，别挡着看正文。
 */
function openCheckupDoc(docIndex: number): void {
  const doc = checkupDocs.value[docIndex];
  if (doc === undefined) return;
  const ref = book.refOf(doc.relPath);
  if (ref === null) return;
  if (ref.kind === "chapter") void book.openDocTab(doc.relPath);
  else book.browse(ref);
  emit("close");
}

/** 角色行点击直达角色卡（角色卡不是章节，走浏览）。 */
function openCharacterCard(name: string): void {
  const doc = book.docs.find((d) => d.kind === "character" && d.title === name);
  if (doc === undefined) return;
  const ref = book.refOf(doc.relPath);
  if (ref === null) return;
  book.browse(ref);
  emit("close");
}
</script>

<template>
  <div class="stats-table-wrap">
    <p v-if="termsScanning" class="dialog-description">正在逐篇扫描全书……</p>
    <template v-else>
      <p class="stats-section-head">术语疑似（{{ termSuspects.length }}）</p>
      <table v-if="termSuspects.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">写法一</th>
            <th scope="col">写法二</th>
            <th scope="col" class="num">出现次数</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="suspect in termSuspects"
            :key="`${suspect.a}|${suspect.b}`"
            class="is-openable"
            :title="`样例行：${suspect.sample}`"
            @click="openCheckupDoc(suspect.sampleDocIndex)"
          >
            <td>{{ suspect.a }}</td>
            <td>{{ suspect.b }}</td>
            <td class="num">{{ suspect.countA }} / {{ suspect.countB }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">没有发现疑似不一致的术语。</p>

      <p class="stats-section-head">标点硬伤（{{ punctuationIssues.length }}）</p>
      <table v-if="punctuationIssues.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">篇</th>
            <th scope="col" class="num">行</th>
            <th scope="col">问题</th>
            <th scope="col">原文</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="issue in punctuationIssues"
            :key="`${issue.docIndex}-${issue.line}`"
            class="is-openable"
            :title="`点开《${docLabel(issue.docIndex)}》查看`"
            @click="openCheckupDoc(issue.docIndex)"
          >
            <td>{{ docLabel(issue.docIndex) }}</td>
            <td class="num">{{ issue.line }}</td>
            <td>{{ issue.kind === "repeated" ? "句读连写" : "汉字间半角标点" }}</td>
            <td>{{ issue.excerpt }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">没有发现标点硬伤。</p>

      <p class="stats-section-head">重复句（{{ duplicateSentences.length }}）</p>
      <table v-if="duplicateSentences.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">句子</th>
            <th scope="col" class="num">次数</th>
            <th scope="col">出现在</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="dupe in duplicateSentences"
            :key="dupe.sentence"
            class="is-openable"
            :title="`点开《${docLabel(dupe.docIndexes[0] ?? 0)}》查看`"
            @click="dupe.docIndexes[0] !== undefined && openCheckupDoc(dupe.docIndexes[0])"
          >
            <td>{{ dupe.sentence }}</td>
            <td class="num">{{ dupe.count }}</td>
            <td>{{ dupe.docIndexes.map(docLabel).join("、") }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">没有发现反复出现的长句。</p>

      <p class="stats-section-head">角色出场（{{ characterRows.length }}）</p>
      <table v-if="characterRows.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">角色</th>
            <th scope="col" class="num">总次数</th>
            <th scope="col" class="num">章数</th>
            <th scope="col">最近出场</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in characterRows"
            :key="row.name"
            class="is-openable"
            :title="`点开角色卡《${row.name}》`"
            @click="openCharacterCard(row.name)"
          >
            <td>{{ row.name }}</td>
            <td class="num">{{ row.total }}</td>
            <td class="num">{{ row.chapterCount }}</td>
            <td>{{ row.lastChapterTitle ?? "全书还没出场" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">
        这本书还没有角色卡——在左栏「角色」下建一篇，角色名取篇名，这里就能追踪出场。
      </p>

      <p class="stats-section-head">
        AI 味扫描（{{ aiReport?.entries.length ?? 0 }}）· 每千字 {{ aiReport?.perThousand ?? 0 }} 处
        · 阻断档 {{ aiBlockingCount }} 条（单独可退稿，已排在前面）
      </p>
      <table v-if="aiReport !== null && aiReport.entries.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">写法</th>
            <th scope="col">类型</th>
            <th scope="col">档位</th>
            <th scope="col" class="num">次数</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in aiEntries"
            :key="entry.term"
            class="is-openable"
            :title="`点开《${docLabel(entry.first.docIndex)}》查看`"
            @click="openCheckupDoc(entry.first.docIndex)"
          >
            <td>{{ entry.term }}</td>
            <td>{{ aiFlavorLabel(entry.category) }}</td>
            <td>{{ aiTierLabel(entry.tier) }}</td>
            <td class="num">{{ entry.count }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">没扫到词库里的 AI 味写法。</p>
      <p v-if="book.activeDocTab !== null" class="stats-note">
        <button class="dialog-secondary-button" type="button" @click="rewriteWithAgent">
          让 AI 智能体按这份词库改写当前章
        </button>
        ——把命中清单一并预填给它，你确认后才发送；改法走替换提案，批准才落盘。
      </p>
      <p v-else class="stats-note">想一键改写，先在编辑器里打开一章再点这个按钮。</p>
      <p class="stats-note">
        平均句长 {{ aiReport?.meanSentenceLength ?? "—" }} 字，句长波动
        {{ aiReport?.sentenceSpread ?? "—" }}（{{
          spreadLabel(aiReport?.sentenceSpread ?? null)
        }}）——连续句子长短雷同是机器味的特征之一。 词库里禁的词与 AI
        智能体写稿时被拦的词是同一份：写的时候拦一道，写完这里再扫一遍。
      </p>

      <p class="stats-section-head">对话占比（{{ dialogueRows.length }}）</p>
      <table v-if="dialogueRows.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">章</th>
            <th scope="col" class="num">对话占比</th>
            <th scope="col">判读</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in dialogueRows"
            :key="row.docIndex"
            class="is-openable"
            :title="`点开《${docLabel(row.docIndex)}》查看`"
            @click="openCheckupDoc(row.docIndex)"
          >
            <td>{{ docLabel(row.docIndex) }}</td>
            <td class="num">{{ row.percent }}%</td>
            <td>{{ dialogueLabel(row.verdict) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">这本书还没有章节，对话占比无从算起。</p>
      <p class="stats-note">
        排序把话太密和全叙述的章顶在最前。一章全是你一句我一句就没了呼吸，全是叙述就没了戏——占比过
        65% 或低于 3% 值得回章里找补节拍。
      </p>

      <p class="stats-section-head">角色腔调漂移（{{ driftRows.length }}）</p>
      <table v-if="driftRows.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">角色</th>
            <th scope="col">章</th>
            <th scope="col" class="num">该章均长</th>
            <th scope="col" class="num">基线</th>
            <th scope="col">判读</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in driftRows"
            :key="`${row.name}-${row.docIndex}`"
            class="is-openable"
            :title="`点开《${docLabel(row.docIndex)}》查看`"
            @click="openCheckupDoc(row.docIndex)"
          >
            <td>{{ row.name }}</td>
            <td>{{ docLabel(row.docIndex) }}</td>
            <td class="num">{{ row.chapterMean }} 字</td>
            <td class="num">{{ row.baselineMean }} 字</td>
            <td>{{ driftLabel(row) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">
        没有发现明显的腔调漂移——或者对白大多没写说话人（「他说」对不回人物卡），归属不上。
      </p>
      <p class="stats-note">
        归属口径：一行引语的**叙述部分**恰好出现一个角色名才记到他头上，一行两个名字不猜。基线是引语字数的中位数，某章突然变得话多或话少才报——报的是「疑似」，人物成长式的改变要你来认定。
      </p>

      <p class="stats-section-head">高频词口头禅榜（TOP {{ phraseRows.length }}）</p>
      <table v-if="phraseRows.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">词</th>
            <th scope="col" class="num">全书次数</th>
            <th scope="col" class="num">每千字</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in phraseRows" :key="row.phrase">
            <td>{{ row.phrase }}</td>
            <td class="num">{{ row.count }}</td>
            <td class="num">{{ row.perThousand }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">书还太空，还没有可统计的词。</p>
      <p class="stats-note">
        这一类不是「疑似」判定，是面镜子：语法常用词已滤掉，剩下的都是内容词——
        「瞬间」「当即」「目光」这类你自己的习惯用词高频到扎眼时，改不改由你。
      </p>

      <p class="stats-section-head">逐章活性／退化读数（{{ chapterReadouts.length }}）</p>
      <table v-if="chapterReadouts.length > 0" class="stats-table">
        <thead>
          <tr>
            <th scope="col">章</th>
            <th scope="col" class="num">字数</th>
            <th scope="col" class="num">句长突发度</th>
            <th scope="col" class="num">虚词密度</th>
            <th scope="col" class="num">短句占比</th>
            <th scope="col" class="num">平均句长</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in chapterReadouts"
            :key="row.docIndex"
            class="is-openable"
            :title="`点开《${docLabel(row.docIndex)}》查看`"
            @click="openCheckupDoc(row.docIndex)"
          >
            <td>{{ docLabel(row.docIndex) }}</td>
            <td class="num">{{ row.charCount }}</td>
            <td class="num">{{ row.burstiness ?? "—" }}</td>
            <td class="num">{{ row.particlePerThousand ?? "—" }}</td>
            <td class="num">{{ row.shortSentenceRatio ?? "—" }}</td>
            <td class="num">{{ row.meanSentenceLength ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="stats-note">这本书还没有章节，逐章读数无从算起。</p>
      <p class="stats-note">
        这一节**只摆数、不作判据**：突发度越大越错落、虚词密度越低越像被删平、短句占比越高越像电报体——
        改不改由你看着数拍板。熵与字多样性**不上这张表**：它们随字数变长而偏高，逐章并排是拿不同长度的章比长短，会误读成「长章更活」。
        「—」是样本太短算不出（不足 10 句），不是没有。
      </p>

      <p class="stats-note">
        前七类都是启发式「疑似」报告：术语对是不是同一个名字、语气标点是不是有意为之、重复句是不是刻意的呼应、AI
        味写法是不是刻意的风格，最终要你来判断。常用词已过滤，仍可能有误报。报告里能点的行——直接跳到对应的文稿。
      </p>
    </template>
  </div>
</template>

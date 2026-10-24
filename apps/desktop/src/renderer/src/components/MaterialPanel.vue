<!-- 素材库面板（2026-10-23）。
     入口是右栏头部一枚按钮，锚点就是那颗按钮本身（与伏笔台账 / 时间线核对 / 人物核对同一套路子）。

     它解决的是「素材库只是一个文稿分组、没有自己的地方」：这里把全书 materials/ 下的每一篇列出来，
     并给两条真动作——导入存量文本到素材库、让 AI 把读到的资料整理成素材卡。
     清单直接从 book.docs 派生（不落第二本账），样式在 styles/material-panel.css。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { MaterialsSearchHit } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  materialCardBody,
  materialCardHost,
  materialCardStamp,
  materialCardTitle,
  materialCardTitleVariant,
  type MaterialCardPage
} from "../utils/material-card";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const layout = useLayoutStore();
const agent = useAgentStore();
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  // 打开就落在搜索框上：这一面板如今的主动作就是「搜点什么」，
  // 让用户自己先 Tab 过去是白等一趟（焦点归位那套判定在 composable 里，判据只有一份）。
  { widthPx: 430, focusSelector: ".material-search-input" }
);

/** 素材 = kind 为 material 的文稿。清单是派生的，没有第二份账。 */
const entries = computed(() => book.docs.filter((doc) => doc.kind === "material"));

/* ── 从网上搜（2026-10-24） ───────────────────────────────────────────────── */

const search = ref("");
const searching = ref(false);
/** 失败说明 / 空手说明：一句话，摆出来就完事（不弹、不拦）。 */
const searchNote = ref("");
/** 答上这一轮的源的中文名——结果不能看起来像凭空来的。 */
const searchSource = ref("");
const hits = ref<MaterialsSearchHit[]>([]);
/** 正在落卡的那一条：同一时刻只让一条在飞，点两下不会落两张卡。 */
const addingUrl = ref("");
/** 加入成功后的那句话（与 searchNote 可以同时出现：一个说成了，一个说没成）。 */
const added = ref("");

/**
 * 搜一次。出网在主进程（web-search.ts 那条源链，冷却与判重都在它里面）。
 *
 * 【失败时为什么不抹掉上一批结果】用户可能正盯着那几条读呢。一句「没搜着」就把人家的东西
 * 擦掉，是把工具的失败算到了用户头上——失败只**加**一句说明，结果原样留着。
 */
async function runSearch(): Promise<void> {
  const query = search.value.trim();
  if (query === "") {
    // 空词当场说清楚：主进程那句「先给一个搜索词。」在这条路上永远走不到（它压根没被叫起来）。
    searchNote.value = "先给一个搜索词。";
    added.value = "";
    return;
  }
  if (searching.value) return;
  searching.value = true;
  searchNote.value = "";
  added.value = "";
  try {
    const result = await window.mochen.materialsSearch(query);
    if (result.ok) {
      hits.value = result.hits;
      searchSource.value = result.sourceLabel;
      // 一条都没有：如实说没搜着，别把空手说成「搜完了」。
      if (result.hits.length === 0)
        searchNote.value = `没搜着「${query}」的相关结果——换个说法再搜一次。`;
    } else {
      searchNote.value = result.message;
    }
  } catch {
    searchNote.value = "搜索那边没接上——稍后再试一次。";
  } finally {
    searching.value = false;
  }
}

function clearSearch(): void {
  hits.value = [];
  searchSource.value = "";
  searchNote.value = "";
  added.value = "";
}

/**
 * 回车即搜。
 *
 * **不用模板修饰符 `.prevent`**：那是无条件执行的，输入法组合态里的回车会被它吃掉
 * （仓规点名过这一条，判据是 `imeOwnsKey` 这一份真身）。非 Enter 或组合态里那一键，一概放行。
 */
function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || imeOwnsKey(event)) return;
  event.preventDefault();
  void runSearch();
}

/** 一条结果的来源站点（给人看的那一眼）。解析不出来就明说「看不出站点」，不编。 */
function hitHost(hit: MaterialsSearchHit): string {
  const host = materialCardHost(hit.url);
  return host === "" ? "（看不出站点）" : host;
}

/**
 * 点开原页。走**既有那条**通道（`app:open-web-source`）——主进程按 http/https 白名单放行，
 * 别的 scheme 一律拒，不新开一条递 URL 的口子。
 */
async function openSource(url: string): Promise<void> {
  try {
    await window.mochen.openWebSource(url);
  } catch {
    searchNote.value = "这个链接打不开（只认 http/https）。";
  }
}

/** 撞名时自动改名的重试上限：连撞 5 次就认了（那说明书里真有一堆同名）。 */
const MATERIAL_CARD_CONFLICT_RETRIES = 5;

/**
 * 把一条结果落成素材卡。
 *
 * 【为什么先抓全文再落盘】搜索回执只有摘要，一两句话——摘要当素材是纸片，
 * 写稿时要的是那一页真正写了什么。所以先取一次正文（主进程 `web-read.ts` 那条链），
 * 取不到就退回收摘要那一档（**不整条作废**），并在界面上说明手上的是摘要。
 *
 * 【写盘不另造通路】走既有的 `importTxtCommit(targetKind: "material")`——路径规划、
 * 批内重名、原子写都由主进程那一条链负责（与「导入文本到素材库」同一扇门）。
 *
 * 【撞名不把人堵死】导入那条通路撞名时回的是「改好标题再导」，而这个界面上**没有改标题的地方**——
 * 那是一句把人引到死路的话。这里改成自动加序号重试（`materialCardTitleVariant`），
 * 不覆盖已有内容，也不让一次「加入」变成一件做不到的事。
 */
async function addHit(hit: MaterialsSearchHit): Promise<void> {
  if (addingUrl.value !== "") return;
  addingUrl.value = hit.url;
  added.value = "";
  try {
    let page: MaterialCardPage | undefined;
    let fetchNote = "";
    try {
      const fetched = await window.mochen.materialsFetch(hit.url);
      if (fetched.ok) page = { text: fetched.page.text, truncated: fetched.page.truncated };
      else fetchNote = fetched.message;
    } catch {
      fetchNote = "正文没抓回来。";
    }
    const body = materialCardBody(hit, materialCardStamp(new Date()), page);
    const base = materialCardTitle(hit.title);
    let title = base;
    let result = await window.mochen.importTxtCommit({
      targetKind: "material",
      chapters: [{ title, content: body }]
    });
    let attempt = 1;
    while (
      !result.ok &&
      result.reason === "name-conflict" &&
      attempt <= MATERIAL_CARD_CONFLICT_RETRIES
    ) {
      title = materialCardTitleVariant(base, attempt);
      result = await window.mochen.importTxtCommit({
        targetKind: "material",
        chapters: [{ title, content: body }]
      });
      attempt += 1;
    }
    if (!result.ok) {
      searchNote.value = result.message;
      return;
    }
    searchNote.value = fetchNote === "" ? "" : `正文没取到（${fetchNote}）——这条只收了搜索摘要。`;
    added.value = `已加入素材库：${title}`;
    await book.refreshDocs();
  } catch {
    searchNote.value = "没加进去——写盘那一步没接上，稍后再试一次。";
  } finally {
    addingUrl.value = "";
  }
}

/** 点某一篇 → 右栏打开它，浮层收起（与另外三张台账同一条口径）。 */
async function openEntry(relPath: string): Promise<void> {
  await book.openDocTab(relPath);
  emit("close");
}

/**
 * 导入存量文本到素材库：走既有那条导入通路（`layout.openImportTxt` → ImportTxtDialog，
 * 那里已带「章节 / 素材库」目标开关）。这里不另造一套导入，只把入口摆到素材库手边。
 */
function importInto(): void {
  emit("close");
  layout.openImportTxt("material");
}

/**
 * 让 AI 整理入库：预填一句指令，**不自动发送**（发送权在用户手里，
 * 与去 AI 味 / 书稿体检 / 左栏检查同一条纪律）。落库那一步仍受 write_doc 的逐条审批。
 */
function askAgent(): void {
  emit("close");
  agent.prefillComposer(
    threadKeyFor(book.activeDocTab),
    "请把这次找到的资料整理成素材卡：先用 web_search / web_read 取到要用的原文，再逐篇用 " +
      "write_doc 写进 materials/ 下的文稿（一篇一个主题，标题写清是什么东西），" +
      "每篇开头用一句话说清它是什么、能用在哪儿。写完列一下你建了哪几篇。"
  );
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
      class="material-panel"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="素材库"
      @keydown="keydown"
    >
      <header class="material-panel-head">
        <strong>素材库</strong>
        <span class="material-panel-count">{{ entries.length }} 篇</span>
        <button class="context-picker-close" type="button" aria-label="关闭素材库" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <p class="material-panel-note">
        素材是给 AI 读的参考材料（设定、资料、灵感），落在 <code>materials/</code> 下。
        写稿时它们会一起进上下文，模型据此保持前后一致。
      </p>

      <!-- 从网上搜（2026-10-24）：本面板的第二条入口——不绕对话，搜到的直接落成素材卡。 -->
      <div class="material-search">
        <input
          v-model="search"
          class="material-search-input"
          type="text"
          aria-label="搜索网上的素材"
          placeholder="搜点什么，直接从网上找素材……"
          :disabled="!book.hasBook"
          maxlength="120"
          @keydown="onSearchKeydown"
        />
        <button
          class="material-action"
          type="button"
          :disabled="!book.hasBook || searching"
          @click="void runSearch()"
        >
          {{ searching ? "搜…" : "搜" }}
        </button>
      </div>

      <div class="material-panel-body">
        <p v-if="searchNote !== ''" class="material-panel-empty">{{ searchNote }}</p>
        <p v-if="added !== ''" class="material-panel-note">{{ added }}</p>

        <!-- 搜索结果与素材清单**并存**：搜到东西不该把「我的素材」整块顶掉，
             加进去的那一张也不该要用户点「收起」才看得见。 -->
        <template v-if="hits.length > 0">
          <p class="material-panel-note">
            搜索结果（{{ searchSource }}）——点「加入素材库」就落进 <code>materials/</code>：
          </p>
          <ul class="material-panel-list">
            <li v-for="(hit, index) in hits" :key="`${hit.url}#${index}`" class="material-hit">
              <span class="material-hit-title">{{ hit.title }}</span>
              <span class="material-hit-meta">{{ hitHost(hit) }}</span>
              <span class="material-hit-snippet">{{
                hit.snippet === "" ? "（这条没给摘要）" : hit.snippet
              }}</span>
              <span class="material-hit-actions">
                <button class="material-action" type="button" @click="void openSource(hit.url)">
                  打开原页
                </button>
                <button
                  class="material-action"
                  type="button"
                  :disabled="addingUrl !== ''"
                  @click="void addHit(hit)"
                >
                  {{ addingUrl === hit.url ? "取全文…" : "加入素材库" }}
                </button>
              </span>
            </li>
          </ul>
          <button class="material-action" type="button" @click="clearSearch">收起搜索结果</button>
        </template>

        <p v-if="entries.length === 0" class="material-panel-empty">
          <template v-if="book.hasBook">
            这本书还没有素材。点下面「导入文本到素材库」把存量的设定 / 资料导进来， 或点「让 AI
            整理入库」把刚查到的资料整理成卡片。
          </template>
          <template v-else>
            还没打开作品——先在左栏打开一本（或建一本新书），素材要落进那一本的
            <code>materials/</code> 才读得到。
          </template>
        </p>

        <ul v-else class="material-panel-list">
          <li v-for="doc in entries" :key="doc.relPath">
            <button class="material-entry" type="button" @click="void openEntry(doc.relPath)">
              <AppIcon name="archive" :size="14" />
              <span class="material-entry-title">{{ doc.title }}</span>
              <span class="material-entry-meta"
                >{{ (doc.chars ?? 0).toLocaleString("zh-CN") }} 字</span
              >
            </button>
          </li>
        </ul>
      </div>

      <footer class="material-panel-actions">
        <button class="material-action" type="button" @click="importInto">
          <AppIcon name="plus" :size="14" />
          导入文本到素材库
        </button>
        <button class="material-action" type="button" :disabled="!book.hasBook" @click="askAgent">
          <AppIcon name="sparkles" :size="14" />
          让 AI 整理入库
        </button>
      </footer>
    </section>
  </Teleport>
</template>

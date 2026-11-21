<!-- #113c 输入卡上方「书 / 阶段」绑定条。真身：deepwrite components/ComposerContextBar.vue——
     DOM（role=group 的一条 + 两枚 composer-context-item）、类名、scoped 里的每一个数值都对齐
     （样式按本仓惯例落在 styles/agent-pane.css 的卡片分段，值一字不改）。
     两处刻意的不同，都是因为本仓没有他那份的契约：
     1) 他不注入导航注册表（COMPOSER_CONTEXT_NAVIGATION），直接读 useBookStore——本仓的书目/阶段都在 meta 里，
        再套一层 provide/inject 只是把 store 换个名字传。
     2) 书那一格开不出弹层：全仓没有 recent-books / 资料库列表（无 book:list 通道），
        所以它不挂 aria-haspopup、不带下拉三角，点下去是真动作 book.pickAndOpen()（与书架空态钮、Ctrl+O 同一真身）。
        阶段那一格有真契约（meta.stages + bookSaveMeta），弹层照他的做全套。 -->
<script setup lang="ts">
import { computed, shallowRef } from "vue";
import AppIcon from "./AppIcon.vue";
import ComposerContextMenu from "./ComposerContextMenu.vue";
import ProfileChip from "./ProfileChip.vue";
import { stageContextOptions, stageLabelOf } from "../utils/composer-context";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import { splitFrontmatter } from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import { useAgentStore } from "../stores/useAgentStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useBibleExclusionStore } from "../stores/useBibleExclusionStore";
import { BIBLE_DIVISION_NOTE, bibleBriefOf, type BibleBriefRow } from "../utils/bible-brief";

const props = defineProps<{ running: boolean }>();

const book = useBookStore();
const agent = useAgentStore();
// 设定库的可见入口（2026-11-20）：此前设定库只有 Ctrl+B 能开（全仓唯一引用），
// 不知道快捷键的用户进不去；现在这枚钮与它同一扇门（真身见 layoutStore.requestStoryBible）。
const layout = useLayoutStore();
// 弹层开合是这一格的局部 UI 态（同 ToolRoster / ModelSelect：关掉不带走状态），不进 store。
const menuOpen = shallowRef(false);
const anchor = shallowRef<HTMLElement>();

const bookTitle = computed(() => book.meta?.title ?? "无");
const stageLabel = computed(() => stageLabelOf(book.meta));
// 落盘在途与本轮在跑都算忙：忙时两枚都不许再点（他的 responding 门同一义）。
const busy = computed(() => book.metaSaving || props.running);
const options = computed(() => stageContextOptions(book.meta, busy.value));
// W-01 补完：只读主进程那一轮真装进来的设定条目，名字摆到输入区；没有条目就不占位。
// 用 <details> 而不是另起一套弹层状态：原生展开/收起与键盘可达都是白送的。
const bibleBrief = computed(() => bibleBriefOf(agent.contextPreview));
// 「本轮不带」（2026-11-20）：按书 id 存的临时排除表，不落盘、不跨重启；切书自然换一份。
const exclusion = useBibleExclusionStore();
const excludedBible = computed(() => (book.meta === null ? [] : exclusion.rowsOf(book.meta.id)));
// 排除后的标题只能靠这份快照——主进程按「已移除」装配后就不再返回这一条了。
const excludedChipText = computed(() => `已排除 ${excludedBible.value.length} 条`);

function excludeBible(row: BibleBriefRow): void {
  if (book.meta === null) return;
  exclusion.exclude(book.meta.id, row);
}

function restoreBible(key: string): void {
  if (book.meta === null) return;
  exclusion.include(book.meta.id, key);
}

function restoreAllBible(): void {
  if (book.meta === null) return;
  exclusion.clear(book.meta.id);
}

// 文档绑定胶囊的数据源：当前活动标签对应的 DocRef 与摘要字数。
const activeDocRef = computed(() =>
  book.activeDocTab !== null ? book.refOf(book.activeDocTab) : null
);
const activeDocKindLabel = computed(() => {
  const ref = activeDocRef.value;
  return ref ? (BOOK_KIND_LABELS[ref.kind] ?? "文档") : "";
});
const activeDocTitle = computed(() => {
  const title = activeDocRef.value?.title ?? "";
  return title.length > 20 ? `${title.slice(0, 20)}…` : title;
});
const activeDocChars = computed(() => {
  const { body } = splitFrontmatter(book.draft);
  const trimmed = body.trim();
  return trimmed.length;
});

function showMenu(event: MouseEvent): void {
  anchor.value = event.currentTarget as HTMLElement;
  menuOpen.value = true;
}

async function choose(id: string): Promise<void> {
  const before = book.meta?.activeStage;
  await book.setActiveStage(id);
  // 只有真的换成了点的那一档才收起；同档早退与被主进程拒绝都留着，给用户当场重试的通路
  // （与权限档弹层同一条裁定：收起与否由「有没有落盘成功」裁决，不由组件猜）。
  if (before !== id && book.meta?.activeStage === id) menuOpen.value = false;
}

async function openAnotherBook(): Promise<void> {
  await book.pickAndOpen();
}

/** 解除文档绑定：关掉当前文稿标签，线程键回到 UNBOUND，下一轮对话不带文档上下文。 */
function unbindDoc(): void {
  if (book.activeDocTab !== null) void book.closeTab(book.activeDocTab);
}
</script>

<template>
  <div
    class="composer-context-bar"
    role="group"
    :aria-label="`当前绑定：书籍 ${bookTitle}，阶段 ${stageLabel}`"
  >
    <button
      class="composer-context-item composer-book-context"
      type="button"
      title="打开另一部作品目录（与书架空态钮、Ctrl+O 同一个入口）"
      :aria-label="`打开另一部作品目录，当前：${bookTitle}`"
      :disabled="busy"
      @click="void openAnotherBook()"
    >
      <AppIcon name="book" :size="16" />
      <strong>{{ bookTitle }}</strong>
    </button>
    <!-- 文档绑定胶囊：显示当前文档标题（最多 20 字截断）、类型与字数；点 × 解除绑定。 -->
    <button
      v-if="activeDocRef"
      class="composer-context-item composer-doc-context"
      type="button"
      :title="`当前绑定文档：${activeDocRef.title}（${activeDocKindLabel} · ${activeDocChars} 字）；点击解除绑定`"
      :aria-label="`当前绑定文档 ${activeDocRef.title}，点击解除绑定`"
      @click="unbindDoc"
    >
      <AppIcon name="file" :size="16" />
      <strong>{{ activeDocTitle }}</strong>
      <span class="doc-context-kind">{{ activeDocKindLabel }} · {{ activeDocChars }}字</span>
      <AppIcon class="context-chevron" name="close" :size="11" />
    </button>
    <!-- 智能体档案（spec §5.1）：排在阶段之后，语义上「这一档由谁来做」比「现在什么阶段」更靠后。 -->
    <ProfileChip :running="props.running" />
    <!-- W-01：这一轮带入了哪几条设定，名字要看得见；点「不带」只影响下一轮，不落盘。 -->
    <details v-if="bibleBrief.count > 0 || excludedBible.length > 0" class="bible-brief">
      <summary
        class="bible-brief-chip"
        :title="bibleBrief.count > 0 ? bibleBrief.fullText : excludedChipText"
      >
        <AppIcon name="ledger" :size="14" />
        <span class="bible-brief-chip-text">
          {{ bibleBrief.count > 0 ? bibleBrief.chipText : excludedChipText }}
        </span>
      </summary>
      <div class="bible-brief-pop" role="group" aria-label="本章带入的设定">
        <p class="bible-brief-pop-head">本轮带入 {{ bibleBrief.count }} 条设定</p>
        <ul v-if="bibleBrief.count > 0" class="bible-brief-list">
          <li v-for="row in bibleBrief.rows" :key="row.key" class="bible-brief-row">
            <span class="bible-brief-type">{{ row.typeLabel }}</span>
            <span class="bible-brief-name">{{ row.title }}</span>
            <span class="bible-brief-chars">{{ row.chars }} 字</span>
            <button
              class="bible-brief-drop"
              type="button"
              :title="`本轮不带「${row.title}」，不影响设定本身`"
              :aria-label="`本轮不带 ${row.title}`"
              @click="excludeBible(row)"
            >
              不带
            </button>
          </li>
        </ul>
        <p v-else class="bible-brief-empty">这一轮没有带入任何设定。</p>
        <div v-if="excludedBible.length > 0" class="bible-brief-excluded">
          <p class="bible-brief-excluded-head">
            <span>本轮不带 {{ excludedBible.length }} 条</span>
            <button class="bible-brief-restore-all" type="button" @click="restoreAllBible">
              全部恢复
            </button>
          </p>
          <ul class="bible-brief-list">
            <li v-for="row in excludedBible" :key="row.key" class="bible-brief-row">
              <span class="bible-brief-type">{{ row.typeLabel }}</span>
              <span class="bible-brief-name">{{ row.title }}</span>
              <button
                class="bible-brief-restore"
                type="button"
                :title="`把「${row.title}」带回本轮`"
                :aria-label="`带回 ${row.title}`"
                @click="restoreBible(row.key)"
              >
                带回
              </button>
            </li>
          </ul>
        </div>
        <p class="bible-brief-note">{{ BIBLE_DIVISION_NOTE }}</p>
      </div>
    </details>
    <!-- 设定库入口（2026-11-20）：无论本轮带了几条设定都在——它通向的是设定库本身，
         不是这份本轮摘要；藏在 <details> 里的话，没带设定时就找不到门了。 -->
    <button
      class="composer-context-item composer-bible-entry"
      type="button"
      title="打开设定库（人物 / 地点 / 时间线；快捷键 Ctrl+B）"
      aria-label="打开设定库"
      @click="layout.requestStoryBible()"
    >
      <AppIcon name="brain" :size="16" />
      <strong>设定库</strong>
    </button>
    <button
      class="composer-context-item composer-stage-context"
      type="button"
      title="选择当前书籍的阶段"
      :aria-label="`选择阶段，当前：${stageLabel}`"
      aria-haspopup="dialog"
      :aria-expanded="menuOpen"
      :disabled="busy"
      @click="showMenu"
    >
      <AppIcon name="wand" :size="16" />
      <strong>{{ stageLabel }}</strong>
      <AppIcon class="context-chevron" name="chevron" :size="12" />
    </button>
  </div>
  <ComposerContextMenu
    v-if="menuOpen && anchor"
    :anchor="anchor"
    :options="options"
    :busy="book.metaSaving"
    heading="选择本书阶段"
    search-placeholder="搜索阶段名称"
    empty-title="这本书没有可切的阶段"
    empty-hint="阶段列在作品目录的 book.json 里"
    @select="void choose($event)"
    @close="menuOpen = false"
  />
</template>

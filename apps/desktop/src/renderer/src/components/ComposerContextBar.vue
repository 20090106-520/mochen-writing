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
import ContextMeter from "./ContextMeter.vue";
import ProfileChip from "./ProfileChip.vue";
import { stageContextOptions, stageLabelOf } from "../utils/composer-context";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import { splitFrontmatter } from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ running: boolean }>();

const book = useBookStore();
// 弹层开合是这一格的局部 UI 态（同 ToolRoster / ModelSelect：关掉不带走状态），不进 store。
const menuOpen = shallowRef(false);
const anchor = shallowRef<HTMLElement>();

const bookTitle = computed(() => book.meta?.title ?? "无");
const stageLabel = computed(() => stageLabelOf(book.meta));
// 落盘在途与本轮在跑都算忙：忙时两枚都不许再点（他的 responding 门同一义）。
const busy = computed(() => book.metaSaving || props.running);
const options = computed(() => stageContextOptions(book.meta, busy.value));

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
    <!-- 上下文占用条（spec §5）：只读的「这一轮会带多少」读数，排在档案之后——
         它是「已经定了」的量，不是可以再点的开关，所以排在两个选择器后面。 -->
    <ContextMeter />
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
    @select="void choose($event)"
    @close="menuOpen = false"
  />
</template>

<!-- 作品工作项面板（2026-10-25 · §174）：左栏常驻的那一列。
     形态照 MiniMax Code 的会话列表（每行一件东西、标题 + 副行 + 右格、点一行直达），
     只不过上面显示的是**小说的**东西。判据与文案全在 utils/work-items.ts，这里只接线。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import {
  WORK_ITEMS_TITLE,
  workItemCount,
  workItemGroups,
  type WorkItemRow
} from "../utils/work-items";

const agent = useAgentStore();
const book = useBookStore();
const layout = useLayoutStore();

/** 组头开合：默认全开（这一族是「一眼看见还欠着什么」，折起来就白做了）。 */
const collapsed = ref<Record<string, boolean>>({});

/**
 * 面板自己有滚动区：对话那一组可能有十几条（这本书每一问算一条），
 * 全铺开会把下面的文稿树顶出视野——**树还要用**。所以列表区封顶、自己滚。
 * 滚动条走左栏那套 transient（滚起来才显，停下来自己藏）。
 */
const scrollbar = createTransientScrollbarController();
function handleScroll(event: Event): void {
  const element = event.currentTarget;
  if (element instanceof HTMLElement) scrollbar.reveal(element);
}
onBeforeUnmount(() => scrollbar.dispose());

/**
 * 相对路径 → 文稿标题；查不到就回落到路径本身。
 * **名字可以土，不能假**——编一个标题比显示路径更坏（与 utils/work-items 里那句同一纪律）。
 */
function docTitleOf(relPath: string): string {
  return book.refOf(relPath)?.title ?? relPath;
}

const groups = computed(() =>
  workItemGroups({
    sessions: agent.sessions,
    // 会话行的可点性走**现成那一份**（utils/session-row-action.ts），面板不自己判。
    sessionActionOf: (item) => agent.rowActionFor(item),
    proposals: Object.values(agent.proposals),
    foreshadows: book.foreshadowRows,
    docTitleOf
  })
);

const count = computed(() => workItemCount(groups.value));

/**
 * 面板的数据源：会话（主进程那份清单）与伏笔台账（读盘那份）。
 * 两份都随「换书」重读——换了一本书，上一本书的会话与伏笔都不能还摆在这儿。
 */
async function refresh(): Promise<void> {
  if (!book.hasBook) return;
  await agent.refreshSessions();
  await book.loadForeshadows();
}

watch(
  () => book.rootPath,
  () => {
    void refresh();
  },
  { immediate: true }
);

/**
 * 「有没有一轮正在跑」——这一格一变，就说明刚刚有过一轮对话。
 *
 * 为什么盯着它：**会话是每一问写一个文件的**，所以刚聊完的那一条在盘上已经落好，
 * 可会话清单是开书时读的那一份。不重读的话，面板会一直少显示最新那一条——
 * 而最新那一条恰恰是最可能被点回去的。
 * 这一格在一轮里翻两次（开跑 → 收尾），每翻一次重读一次会话清单，
 * 代价只有一次 IPC；伏笔那一族跟着一起重读（智能体写下的新伏笔也是这一轮里落盘的）。
 */
const turnRunning = computed(() => Object.values(agent.threads).some((thread) => thread.running));

watch(turnRunning, () => {
  void refresh();
});

function toggle(groupId: string): void {
  collapsed.value[groupId] = !collapsed.value[groupId];
}

/**
 * 点一行 = 走过去接着干。三个落点都是**现成的真身**，面板不自己造通路：
 * - 会话 → `agent.showSession`（与中栏「历史对话」浮层同一条路）；
 * - 待审 → 打开那一章（提案卡在中栏那格里）；
 * - 伏笔 → 有埋设章就跳埋设章（那才是作者要重看的一篇），没有就打开伏笔文稿本身。
 */
async function open(row: WorkItemRow): Promise<void> {
  if (row.disabled) return;
  // 正在看的那一条：亮着就够了，点它不用再走过去（点了也就是原地不动）。
  if (row.current) return;
  const target = row.target;
  if (target.kind === "session") {
    await agent.showSession(target.item);
    return;
  }
  layout.setPaneCollapsed("right", false);
  if (target.kind === "doc") {
    await book.openDocTab(target.relPath);
    return;
  }
  const relPath = target.plantedIn !== "" ? target.plantedIn : target.relPath;
  const ref = book.refOf(relPath);
  if (!ref) return;
  if (ref.kind === "chapter") await book.openDocTab(relPath);
  else book.browse(ref);
}
</script>

<template>
  <section class="work-items" aria-label="作品工作项">
    <header class="work-items-head">
      <AppIcon name="list" :size="15" />
      <strong>{{ WORK_ITEMS_TITLE }}</strong>
      <span v-if="count">{{ count }} 件</span>
    </header>

    <div
      v-if="groups.length"
      class="work-items-groups transient-scrollbar"
      @scroll.passive="handleScroll"
    >
      <section v-for="group in groups" :key="group.id" class="work-items-group">
        <button
          class="work-items-group-head"
          type="button"
          :aria-expanded="!collapsed[group.id]"
          @click="toggle(group.id)"
        >
          <AppIcon :name="group.icon" :size="13" />
          <span class="work-items-group-label">{{ group.label }}</span>
          <em class="work-items-group-count">{{ group.rows.length }}</em>
          <AppIcon class="work-items-chevron" name="chevron" :size="12" />
        </button>
        <ul v-if="!collapsed[group.id]" class="work-items-list">
          <li v-for="row in group.rows" :key="row.id">
            <button
              class="work-items-row"
              :class="{ 'is-current': row.current }"
              type="button"
              :disabled="row.disabled"
              :title="row.hint"
              @click="open(row)"
            >
              <AppIcon class="work-items-row-icon" :name="row.icon" :size="14" />
              <span class="work-items-copy">
                <span class="work-items-title">{{ row.title }}</span>
                <small class="work-items-detail">{{ row.detail }}</small>
              </span>
              <span class="work-items-meta">{{ row.meta }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <p v-else class="work-items-empty">这本书眼下没有在等着你的事。</p>
  </section>
</template>

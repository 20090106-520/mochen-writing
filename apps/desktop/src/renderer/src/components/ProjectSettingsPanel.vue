<!-- 项目管理面板（设置浮层的「项目管理」页签）：当前作品、操作按钮、最近作品列表。
     清单真身在主进程（`<appData>/recent-books.json`，book:recent / book:forget），
     渲染层只读 useBookStore 里那份镜像；当前作品读同一份 book.meta——
     原先挂的 useProjectManagerStore 从未被写入过（registerProject 零调用点），
     面板因此永远显示「尚未打开 / 没有任何作品」，与中栏已开的书对不上。
     移除只从清单划掉，不动磁盘文件。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import DeleteBookConfirm from "./DeleteBookConfirm.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { useBookStore } from "../stores/useBookStore";

const layout = useLayoutStore();
const book = useBookStore();

const currentBookTitle = computed(() => book.meta?.title ?? null);

/** 最近打开时间（清单里是 ISO 字符串）：今天显示时分，同年显示月-日，跨年显示年-月-日 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  const options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }
  return date.toLocaleDateString("zh-CN", options);
}

/** 打开作品目录 = 选目录 + 开书 + 主进程记账（只 pick 不开书会把回执丢掉）。 */
function openProjectDir(): void {
  void book.pickAndOpen();
}

function createBook(): void {
  layout.openNewBook();
}

async function switchProject(entry: { rootPath: string }): Promise<void> {
  await book.openBook(entry.rootPath);
}

/** 删除作品（2026-11-24）：确认条与作品库列表共用 DeleteBookConfirm，这里只持有「待删的那本」。 */
const pendingDelete = ref<{ rootPath: string; title: string } | null>(null);

function askDelete(entry: { rootPath: string; title: string }): void {
  pendingDelete.value = { rootPath: entry.rootPath, title: entry.title };
}

/** 清单只在开书后刷新；先进设置页的人也得看见现有的最近作品。 */
onMounted(() => {
  void book.loadRecentBooks();
});
</script>

<template>
  <div class="project-settings">
    <section class="settings-group">
      <h2 class="settings-group-title">当前作品</h2>
      <!-- 前两组也套卡片（2026-11-12）：下面「最近作品」那张清单本来就是一张卡
           （`.project-list` 自己带描边、圆角、surface-card 与 shadow-sm），
           于是这一页原先读起来像「两段裸字 + 一张卡」——同一栏目录里
           模型配置 / 智能体 / 快捷键 / 关于 / 远程备份全是卡。
           这里补的是外壳，不是新控件：文字与按钮一个没动。 -->
      <div class="settings-card">
        <p class="settings-static-text project-current">{{ currentBookTitle ?? "尚未打开" }}</p>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="settings-group-title">操作</h2>
      <div class="settings-card">
        <div class="project-actions">
          <button class="settings-btn" type="button" @click="openProjectDir">
            <AppIcon name="folder" :size="14" /> 打开作品目录
          </button>
          <button class="settings-btn" type="button" @click="createBook">
            <AppIcon name="plus" :size="14" /> 创建新书
          </button>
        </div>
      </div>
    </section>

    <section class="settings-group">
      <h2 class="settings-group-title">最近作品</h2>
      <ul v-if="book.recentBooks.length > 0" class="project-list">
        <li
          v-for="entry in book.recentBooks"
          :key="entry.rootPath"
          class="project-row"
          :class="{ 'is-active': book.rootPath === entry.rootPath }"
        >
          <button class="project-row-main" type="button" @click="switchProject(entry)">
            <AppIcon name="book" :size="12" />
            <span class="project-row-title" :title="entry.title">{{ entry.title }}</span>
            <span class="project-row-meta">{{ formatTime(entry.lastOpenedAt) }}</span>
          </button>
          <button
            class="project-row-remove"
            type="button"
            :aria-label="`移除项目 ${entry.title}`"
            @click="book.forgetRecentBook(entry.rootPath)"
          >
            <AppIcon name="close" :size="10" />
          </button>
          <button
            class="project-row-remove is-trash"
            type="button"
            :aria-label="`删除作品 ${entry.title}（移入回收站）`"
            title="删除作品（移入系统回收站，可还原）"
            @click="askDelete(entry)"
          >
            <AppIcon name="trash" :size="11" />
          </button>
        </li>
      </ul>
      <p v-else class="settings-static-text">还没有任何作品，点「创建新书」开始写作。</p>

      <!-- 删除作品确认（2026-11-24）：与作品库列表共用的同一个模态（DeleteBookConfirm）。 -->
      <DeleteBookConfirm
        v-if="pendingDelete !== null"
        :root-path="pendingDelete.rootPath"
        :title="pendingDelete.title"
        @close="pendingDelete = null"
      />
    </section>
  </div>
</template>

<style scoped>
.project-settings {
  max-width: var(--settings-measure, 880px);
}

.settings-static-text {
  margin: 0;
  color: var(--text-soft);
  font-size: 0.928571rem;
  line-height: 1.5;
}

/* 卡片自己只有 6px 0：行的那 18px 由里面这一行给（与 `.settings-item` 同一族口径）。 */
.project-current {
  padding: 14px 18px;
}

.project-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 14px 18px;
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  color: var(--text);
  font: inherit;
  font-size: 0.928571rem;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out-soft),
    box-shadow var(--dur-fast) var(--ease-out-soft),
    border-color var(--dur-fast) var(--ease-out-soft);
}

.settings-btn:hover {
  background: var(--hover);
  box-shadow: var(--shadow-md);
  border-color: var(--accent-soft);
}

.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.project-row {
  display: flex;
  align-items: center;
  gap: 4px;
  /* 10px + 行内 8px = 18px：与 `.settings-item` 那族同一条竖线。
     原先 4px 起算，清单里的书名离卡片左边只有 12px，比同屏其它列表都紧一档。 */
  padding: 1px 10px;
  transition: background var(--dur-fast) var(--ease-out-soft);
}

.project-row:not(:last-child) {
  border-bottom: 1px solid var(--line-soft);
}

.project-row.is-active {
  background: color-mix(in srgb, var(--accent-soft) 40%, var(--surface-card));
}

.project-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 10px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.project-row-main:hover {
  color: var(--accent);
}

.project-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 590;
}

.project-row-meta {
  flex-shrink: 0;
  color: var(--text-soft);
  font-size: 0.857143rem;
}

.project-row-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out-soft),
    color var(--dur-fast) var(--ease-out-soft);
}

.project-row-remove:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

/* 删除作品那颗（2026-11-24）：与「移除记录」同形状同色族，语义更重的是它——
   常驻带一圈 danger 淡描边，让「× 是划掉、垃圾桶是真删」第一眼分得开。 */
.project-row-remove.is-trash {
  margin-left: 2px;
  color: var(--danger);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 32%, transparent);
}
</style>

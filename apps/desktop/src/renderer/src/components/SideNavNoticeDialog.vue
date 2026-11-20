<!-- 侧边栏导航的统一响应对话框（2026-10-04：全部可点、点哪都有真响应）。
     六种形态，都不撒谎：
     - planned   —— 功能还没落地：明说「规划中」，不放假按钮。
     - need-book —— 还没打开作品：两个按钮都是现成真身（打开目录=book.pickAndOpen，
                     与 Ctrl+O 同一路；新建作品=layout.openNewBook，与「我的作品」组头「+」同一路）。
     - stats     —— 数据统计：表格里全是 book.docs 的真实数字（篇数与字数来自扫描元数据）。
     - trash     —— 回收站（2026-10-10）：列出这本书删过的文稿，恢复按钮走 trash store 真身。
     - backup    —— 整书备份（2026-10-10）：列这本书的备份，立即备份/恢复走 backup store 真身。
     - terms     —— 书稿体检（2026-10-10）：一次扫描全书出八类报告——术语疑似 / 标点硬伤 /
                     重复句 / 角色出场 / AI 味扫描 / 对话占比 / 角色腔调漂移 / 口头禅榜，
                     判定真身都在 utils/doc-checkup 与 contracts（启发式，报「疑似」）。

     【2026-10-11 体量拆分】terms 那一支自己就占 272 行模板 + 一整套计算，而另外五支合计不到 60 行，
     混在一处于是「打开回收站要滚 400 行才找得到」。已把 **terms 的内容整体搬进 SideNavTermsReport.vue**，
     本文件降到 268 行。**搬的是内容，不是外壳**：backdrop / 焦点 / Esc（useModalFocus）/
     入场动画（useDialogMotion）仍在这一层，因为六支都是同一个模态的不同内容；
     `close` 与 `onAction` 两个出口也仍归这里，子组件的 close 是 emit 上来而不是自己收口。
     六种形态的判定真身一个都没动（铁律 6）。 -->
<script setup lang="ts">
import { ref, toRef, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import SideNavTermsReport from "./SideNavTermsReport.vue";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";
import { useTrashStore } from "../stores/useTrashStore";
import { useBackupStore } from "../stores/useBackupStore";
import type { SideNavStatsRow } from "../utils/stats-rows";

export interface SideNavNotice {
  kind: "planned" | "need-book" | "stats" | "trash" | "backup" | "terms";
  label: string;
  /** stats 形态的行数据（由 LeftSidebar 从 book.docs 算好传入，组件只展示）。 */
  rows?: SideNavStatsRow[];
}

const props = defineProps<{ notice: SideNavNotice | null }>();
const emit = defineEmits<{ close: []; openWorkdir: []; newBook: [] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus 那一处（批次 5-㊱）：这一层以前开着时焦点还留在左栏那颗
 * 「数据统计」上，于是 Esc 按不动、Tab 一下就跳出弹层。它传 isOpen 是因为本组件常驻，
 * 开合是 backdrop 那一格自己的 v-if。
 */
const dialogRoot = ref<HTMLElement>();
/** 开合判据只有这一份，Esc/焦点与入场动画读同一个 ref（同 SaveConflictDialog 的理由）。 */
const dialogOpen = toRef(() => props.notice !== null);
useModalFocus({
  root: dialogRoot,
  close: () => emit("close"),
  isOpen: dialogOpen
});
useDialogMotion({ root: dialogRoot, isOpen: dialogOpen });

/** 回收站形态：开门那一下现取清单（换书后条目跟着当前书走，缓存会撒谎）。 */
const trash = useTrashStore();
watch(
  () => props.notice?.kind === "trash",
  (open) => {
    if (open) {
      trash.clearError();
      void trash.list();
    }
  },
  { immediate: true }
);

/** 整书备份形态：开门现取清单，与回收站同一口径。 */
const backup = useBackupStore();
watch(
  () => props.notice?.kind === "backup",
  (open) => {
    if (open) {
      backup.clearError();
      void backup.list();
    }
  },
  { immediate: true }
);

function close(): void {
  emit("close");
}

function onAction(action: "openWorkdir" | "newBook"): void {
  emit(action);
  emit("close");
}

/** stats 形态的合计（props 只读，computed 求一次）。 */
const totals = (): { count: number; chars: number } => {
  const rows = props.notice?.rows ?? [];
  return {
    count: rows.reduce((sum, row) => sum + row.count, 0),
    chars: rows.reduce((sum, row) => sum + row.chars, 0)
  };
};

/** ISO 时间戳转本机可读（空串/坏值原样不编）。 */
function trashedAtLabel(iso: string): string {
  if (iso === "") return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function restore(trashName: string): void {
  void trash.restore(trashName);
}

function backupNow(): void {
  void backup.create("manual");
}

function restoreBackup(name: string): void {
  void backup.restore(name);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="notice" class="dialog-backdrop" @mousedown.self="close">
      <div
        ref="dialogRoot"
        class="workspace-dialog side-nav-notice-dialog"
        :class="{ 'is-report': notice.kind === 'terms' }"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-label="notice.label"
      >
        <header>
          <p class="dialog-eyebrow">墨宸 AI</p>
          <h2>{{ notice.label }}</h2>
          <button class="dialog-close" type="button" aria-label="关闭" @click="close">
            <AppIcon name="close" :size="15" />
          </button>
        </header>
        <div class="dialog-content">
          <p v-if="notice.kind === 'planned'" class="dialog-description">
            这个功能还在规划中，还没落地。入口先留在这里，落地后点这里直接能用。
          </p>
          <p v-else-if="notice.kind === 'need-book'" class="dialog-description">
            这个功能要有打开的作品才有内容可用。先打开一个作品目录，或者直接新建一本。
          </p>
          <div v-else-if="notice.kind === 'trash'" class="stats-table-wrap">
            <p v-if="trash.error !== null" class="dialog-description">{{ trash.error }}</p>
            <table v-if="trash.entries.length > 0" class="stats-table">
              <thead>
                <tr>
                  <th scope="col">标题</th>
                  <th scope="col">原路径</th>
                  <th scope="col">移入时间</th>
                  <th scope="col" class="num">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in trash.entries" :key="entry.trashName">
                  <td>{{ entry.title }}</td>
                  <td>{{ entry.relPath }}</td>
                  <td>{{ trashedAtLabel(entry.trashedAt) }}</td>
                  <td class="num">
                    <button
                      class="dialog-secondary-button"
                      type="button"
                      :disabled="trash.busy"
                      @click="restore(entry.trashName)"
                    >
                      还原
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else-if="trash.error === null" class="stats-note">
              回收站是空的。树行「…」菜单里的「移入回收站」会把文稿先放到这里——东西没销毁，随时能还原。
            </p>
            <p class="stats-note">
              还原回原路径；原位置已经有同名文稿时会被拒绝（先处理那篇再来还原），绝不盖写。
            </p>
          </div>
          <div v-else-if="notice.kind === 'backup'" class="stats-table-wrap">
            <p v-if="backup.error !== null" class="dialog-description">{{ backup.error }}</p>
            <p v-else-if="backup.receipt !== null" class="stats-note">{{ backup.receipt }}</p>
            <div class="dialog-actions" style="margin: 0 0 10px">
              <button
                class="dialog-primary-button"
                type="button"
                :disabled="backup.busy"
                @click="backupNow"
              >
                立即备份整本书
              </button>
            </div>
            <table v-if="backup.entries.length > 0" class="stats-table">
              <thead>
                <tr>
                  <th scope="col">备份</th>
                  <th scope="col">时间</th>
                  <th scope="col" class="num">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in backup.entries" :key="entry.name">
                  <td>{{ entry.name }}</td>
                  <td>{{ entry.createdAt }}</td>
                  <td class="num">
                    <button
                      class="dialog-secondary-button"
                      type="button"
                      :disabled="backup.busy"
                      @click="restoreBackup(entry.name)"
                    >
                      恢复
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else-if="backup.error === null" class="stats-note">
              这本书还没有备份。打开作品时会自动每天备一份；想现在备一份就按上面的按钮。
            </p>
            <p class="stats-note">
              备份存在书目录的 .mochen/backups/ 里（保留最近 20 份）；恢复会把内容复制到书旁的
              新目录，当前这本书一个字都不会动。
            </p>
          </div>
          <SideNavTermsReport v-else-if="notice.kind === 'terms'" :open="true" @close="close" />
          <div v-else class="stats-table-wrap">
            <table class="stats-table">
              <thead>
                <tr>
                  <th scope="col">分组</th>
                  <th scope="col" class="num">篇数</th>
                  <th scope="col" class="num">字数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in notice.rows" :key="row.label">
                  <td>{{ row.label }}</td>
                  <td class="num">{{ row.count }}</td>
                  <td class="num">{{ row.chars }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>合计</td>
                  <td class="num">{{ totals().count }}</td>
                  <td class="num">{{ totals().chars }}</td>
                </tr>
              </tfoot>
            </table>
            <p class="stats-note">
              数字来自这本书的扫描结果：篇数是现有文档数，字数按正文非空白字符计。
            </p>
          </div>
        </div>
        <div v-if="notice.kind === 'need-book'" class="dialog-actions">
          <button class="dialog-secondary-button" type="button" @click="onAction('openWorkdir')">
            打开作品目录
          </button>
          <button class="dialog-primary-button" type="button" @click="onAction('newBook')">
            新建作品
          </button>
        </div>
        <div v-else class="dialog-actions">
          <button class="dialog-primary-button" type="button" @click="close">知道了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

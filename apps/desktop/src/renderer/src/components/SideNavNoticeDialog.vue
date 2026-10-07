<!-- 侧边栏导航的统一响应对话框（2026-10-04：全部可点、点哪都有真响应）。
     三种形态，都不撒谎：
     - planned   —— 功能还没落地：明说「规划中」，不放假按钮。
     - need-book —— 还没打开作品：两个按钮都是现成真身（打开目录=book.pickAndOpen，
                     与 Ctrl+O 同一路；新建作品=layout.openNewBook，与「我的作品」组头「+」同一路）。
     - stats     —— 数据统计：表格里全是 book.docs 的真实数字（篇数与字数来自扫描元数据）。 -->
<script setup lang="ts">
import { ref, toRef } from "vue";
import AppIcon from "./AppIcon.vue";
import { useModalFocus } from "../composables/useModalFocus";

export interface SideNavStatsRow {
  label: string;
  count: number;
  chars: number;
}

export interface SideNavNotice {
  kind: "planned" | "need-book" | "stats";
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
useModalFocus({
  root: dialogRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.notice !== null)
});

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
</script>

<template>
  <Teleport to="body">
    <div v-if="notice" class="dialog-backdrop" @mousedown.self="close">
      <div
        ref="dialogRoot"
        class="workspace-dialog side-nav-notice-dialog"
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

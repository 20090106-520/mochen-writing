<!-- 弹窗：结构与类名取自 deepwrite的对话框 markup（dialog-backdrop / workspace-dialog / dialog-actions） -->
<script setup lang="ts">
import { ref, toRef } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";

const book = useBookStore();

/**
 * Esc 与焦点的真身在 useModalFocus（批次 5-㊱）。
 *
 * 原来这里是 backdrop 上的一行 `@keydown.esc.stop="dismiss"`：冒泡要经过 backdrop 的子树才收得到，
 * 而这一层从来没把焦点挪进来，于是那行等于白写。焦点进出与 Esc 一起交给 composable 一处，
 * backdrop 上那行 `@keydown.esc` 同批删掉——留着它就是同一判定的第二份实现。
 */
const dialogRoot = ref<HTMLElement>();

function dismiss(): void {
  book.conflict = null;
  book.notice = "仍保留本机草稿，未覆盖盘上文件";
}

useModalFocus({
  root: dialogRoot,
  close: dismiss,
  isOpen: toRef(() => book.conflict !== null)
});

function reloadFromDisk(): void {
  void book.reloadActive();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="book.conflict" class="dialog-backdrop" @mousedown.self="dismiss">
      <section
        ref="dialogRoot"
        class="workspace-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-description"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">保存被拒绝</span>
            <h2 id="conflict-title">文件在外部被改过</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭冲突提示" @click="dismiss">
            ×
          </button>
        </header>

        <div class="dialog-content">
          <p id="conflict-description" class="dialog-description">
            盘上内容已与你打开时的指纹不一致。为避免覆盖别人的改动，本次保存没有写文件；
            你的草稿仍完整保留在编辑器里。
          </p>
          <p class="dialog-note">
            盘上指纹：{{ book.conflict.currentFingerprint }} · 本机草稿指纹：{{
              book.savedFingerprint
            }}
          </p>
        </div>

        <div class="dialog-actions">
          <button class="dialog-secondary-button" type="button" @click="dismiss">先看草稿</button>
          <button class="dialog-primary-button is-danger" type="button" @click="reloadFromDisk">
            放弃草稿并重载盘上内容
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

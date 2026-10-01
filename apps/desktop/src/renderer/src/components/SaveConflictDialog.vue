<!-- 弹窗：结构与类名取自 deepwrite（Apache-2.0）的对话框 markup（dialog-backdrop / workspace-dialog / dialog-actions） -->
<script setup lang="ts">
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();

function dismiss(): void {
  book.conflict = null;
  book.notice = "仍保留本机草稿，未覆盖盘上文件";
}

function reloadFromDisk(): void {
  void book.reloadActive();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="book.conflict"
      class="dialog-backdrop"
      @mousedown.self="dismiss"
      @keydown.esc.stop="dismiss"
    >
      <section
        class="workspace-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-description"
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

          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="dismiss">先看草稿</button>
            <button class="dialog-primary-button is-danger" type="button" @click="reloadFromDisk">
              放弃草稿并重载盘上内容
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

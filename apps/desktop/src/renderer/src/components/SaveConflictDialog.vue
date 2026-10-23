<!-- 弹窗：结构与类名取自 deepwrite的对话框 markup（dialog-backdrop / workspace-dialog / dialog-actions） -->
<script setup lang="ts">
import { ref, toRef } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";

const book = useBookStore();

/**
 * Esc 与焦点的真身在 useModalFocus（批次 5-㊱）。
 *
 * 原来这里是 backdrop 上的一行 `@keydown.esc.stop="dismiss"`：冒泡要经过 backdrop 的子树才收得到，
 * 而这一层从来没把焦点挪进来，于是那行等于白写。焦点进出与 Esc 一起交给 composable 一处，
 * backdrop 上那行 `@keydown.esc` 同批删掉——留着它就是同一判定的第二份实现。
 */
const dialogRoot = ref<HTMLElement>();

/**
 * 开合判据只有这一份，Esc/焦点与入场动画读同一个 ref。
 * 为第二个消费者把 `book.conflict !== null` 再写一遍，就是同一判定两份实现——
 * 哪天只改了其中一处，就会出现「弹窗开得起来、Esc 却不管」或者「动效在、焦点不在」这种半开状态。
 */
const dialogOpen = toRef(() => book.conflict !== null);

function dismiss(): void {
  book.conflict = null;
  book.notice = "仍保留本机草稿，未覆盖盘上文件";
}

useModalFocus({ root: dialogRoot, close: dismiss, isOpen: dialogOpen });
useDialogMotion({ root: dialogRoot, isOpen: dialogOpen });

/**
 * 「放弃草稿并重载」是不可逆动作（草稿是本应用最不可逆的资产），一次误点全没——
 * 所以先落在二次确认上，不直接重载。确认态与动作分成三粒，直接点击那一枚不写盘。
 */
const confirmingDiscard = ref(false);

function requestDiscard(): void {
  confirmingDiscard.value = true;
}

function cancelDiscard(): void {
  confirmingDiscard.value = false;
}

function confirmDiscard(): void {
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
          <template v-if="!confirmingDiscard">
            <button class="dialog-secondary-button" type="button" @click="dismiss">先看草稿</button>
            <button class="dialog-primary-button is-danger" type="button" @click="requestDiscard">
              放弃草稿并重载盘上内容
            </button>
          </template>
          <template v-else>
            <span class="dialog-note">草稿不可恢复，确定放弃？</span>
            <button class="dialog-secondary-button" type="button" @click="cancelDiscard">
              取消
            </button>
            <button class="dialog-primary-button is-danger" type="button" @click="confirmDiscard">
              确定放弃并重载
            </button>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>

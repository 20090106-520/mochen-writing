<!-- 删除作品确认条（2026-11-24）：作品库列表与项目设置面板两处入口**共用**的同一个模态。
     真删进系统回收站前的最后一道口：书名、路径、正在写警告与「可还原」都摆明面，
     主按钮用 is-danger 档。由父组件 v-if 挂载 ⇒ 挂载即开（与 NewBookDialog 同一支，不传 isOpen）。
     真身是 useBookStore.trashBook：先关书（若删的是当前书）→ 整个书目录进系统回收站 → 清单同步移除。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";

const props = defineProps<{ rootPath: string; title: string }>();
const emit = defineEmits<{ close: [] }>();
const book = useBookStore();

const dialogRoot = ref<HTMLElement>();
useModalFocus({ root: dialogRoot, close: () => emit("close") });
useDialogMotion({ root: dialogRoot });

const deleting = ref(false);
/** 正在写的那一本也允许删（删的是当前书时 store 会把界面复位到未打开状态），但要多说一句。 */
const isCurrent = computed(() => book.rootPath === props.rootPath);

async function confirmDelete(): Promise<void> {
  if (deleting.value) return;
  deleting.value = true;
  const ok = await book.trashBook(props.rootPath);
  deleting.value = false;
  if (ok) emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        ref="dialogRoot"
        class="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-book-title"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">删除作品</span>
            <h2 id="delete-book-title">移入回收站</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="取消删除" @click="emit('close')">
            ×
          </button>
        </header>
        <div class="dialog-content">
          <p class="delete-book-lead">
            《{{ title }}》将连同章节、设定与 AI 对话记录一起移进
            <strong>系统回收站</strong>——误删可以在系统回收站里还原。
          </p>
          <p class="new-book-hint">{{ rootPath }}</p>
          <p v-if="isCurrent" class="provider-error">
            这就是你现在正在写的那一本，删除后会回到「没有打开作品」的状态。
          </p>
        </div>
        <div class="dialog-actions">
          <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
          <button
            class="dialog-primary-button is-danger"
            type="button"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? "正在删除…" : "移入回收站" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

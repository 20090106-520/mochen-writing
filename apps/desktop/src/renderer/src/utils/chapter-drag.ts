import type { DocRef } from "@mochen/contracts";
import { ref, type Ref } from "vue";

/**
 * 章节拖拽重排（原生 HTML5 DnD，仅 chapter 分组）的状态机。
 *
 * 为什么拆：拖起 / 悬停 / 延迟清除 / 落点结算是一条自洽的 DOM 状态机，
 * 而本仓的 `.vue` 不进类型程序（裸 tsc + vue-shim）——五个 handler 写在组件里
 * 就是一段零类型检查、零测试覆盖的逻辑。左栏只接线（谁分给下标、谁落盘），判定住这里。
 */
export interface ChapterDragDeps {
  /** 目标章在章节分组里的下标；分组未挂或目标不在内 ⇒ -1（与 indexOf 的「找不到」同码）。 */
  targetIndexOf(target: DocRef): number;
  moveChapter(fromRelPath: string, targetIndex: number): void;
}

/** 拖拽高亮要读的两个状态（模板的 is-drag-over / dragging 类都认它们）。 */
export interface ChapterDragState {
  dragFromRelPath: Ref<string | null>;
  dragOverRelPath: Ref<string | null>;
}

export interface ChapterDrag {
  state: ChapterDragState;
  onChapterDragStart(event: DragEvent, relPath: string): void;
  onChapterDragOver(event: DragEvent, relPath: string): void;
  onChapterDragLeave(): void;
  onChapterDrop(event: DragEvent, targetNode: DocRef): void;
  onChapterDragEnd(): void;
  /** 组件卸载时摘掉挂起的 dragLeave 定时器（回调不能对着已卸载的组件置值）。 */
  dispose(): void;
}

export function createChapterDrag(deps: ChapterDragDeps): ChapterDrag {
  const dragFromRelPath = ref<string | null>(null);
  const dragOverRelPath = ref<string | null>(null);
  let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  function onChapterDragStart(event: DragEvent, relPath: string): void {
    dragFromRelPath.value = relPath;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", relPath);
    }
  }

  function onChapterDragOver(event: DragEvent, relPath: string): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    // 延迟清除 dragLeave 状态，避免子元素切换时闪烁
    if (dragLeaveTimer !== null) {
      clearTimeout(dragLeaveTimer);
      dragLeaveTimer = null;
    }
    dragOverRelPath.value = relPath;
  }

  function onChapterDragLeave(): void {
    // 微延迟：子元素切换会触发 li 的 dragleave，用定时器过滤掉
    if (dragLeaveTimer !== null) clearTimeout(dragLeaveTimer);
    dragLeaveTimer = setTimeout(() => {
      dragOverRelPath.value = null;
      dragLeaveTimer = null;
    }, 30);
  }

  function onChapterDrop(event: DragEvent, targetNode: DocRef): void {
    event.preventDefault();
    event.stopPropagation();
    const from = dragFromRelPath.value;
    dragFromRelPath.value = null;
    dragOverRelPath.value = null;
    if (dragLeaveTimer !== null) {
      clearTimeout(dragLeaveTimer);
      dragLeaveTimer = null;
    }
    if (from === null) return;
    const targetIndex = deps.targetIndexOf(targetNode);
    if (targetIndex === -1) return;
    // 落盘通路是异步的（走 useBookStore.persistMeta，失败会进 notice）：这里不 await，
    // 但要把「我知道它是异步、不接 rejection」写在字面上，别留成未处理拒绝。
    deps.moveChapter(from, targetIndex);
  }

  function onChapterDragEnd(): void {
    dragFromRelPath.value = null;
    dragOverRelPath.value = null;
    if (dragLeaveTimer !== null) {
      clearTimeout(dragLeaveTimer);
      dragLeaveTimer = null;
    }
  }

  function dispose(): void {
    if (dragLeaveTimer !== null) clearTimeout(dragLeaveTimer);
  }

  return {
    state: { dragFromRelPath, dragOverRelPath },
    onChapterDragStart,
    onChapterDragOver,
    onChapterDragLeave,
    onChapterDrop,
    onChapterDragEnd,
    dispose
  };
}

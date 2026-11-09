<!--
  输入卡下方常驻的一行「选择作品」（2026-11-09 参考图③）。
  参考图这一层是「选择文件夹 / 本地 + 场景预设」：本仓照落前半截，且只落有真通路的入口——
  新建作品 / 打开作品目录 / 最近作品；远程项目、不需要项目、场景预设都没有契约，一条都不编。

  与卡上方 ComposerContextBar 的关系：**并存，互不接管**。那一条是「已开书 + 空线程」时的
  书/阶段/文档绑定，显隐逻辑原样不动；这一行是随时可按的作品入口（不开书时也能开，
  所以没有 v-if）。样式复用绑定条那一枚胶囊（.composer-context-item），弹层复用
  ComposerContextMenu 那一份通用面——键盘（↑↓ 高亮 / Enter 选高亮 / Esc 收起并还焦点）
  与玻璃材质都只有一份实现。
-->
<script setup lang="ts">
import { computed, shallowRef } from "vue";
import AppIcon from "./AppIcon.vue";
import ComposerContextMenu from "./ComposerContextMenu.vue";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import {
  PROJECT_NEW_ID,
  PROJECT_PICK_ID,
  projectBookPath,
  projectPickOptions
} from "../utils/composer-project";

const props = defineProps<{ running: boolean }>();

const book = useBookStore();
const layout = useLayoutStore();

/** 弹层开合是这一行的局部 UI 态，不进 store（同阶段弹层：关掉不带走状态）。 */
const menuOpen = shallowRef(false);
const anchor = shallowRef<HTMLElement>();

const options = computed(() =>
  projectPickOptions({
    books: book.recentBooks,
    currentRoot: book.rootPath,
    busy: props.running
  })
);

function toggleMenu(event: MouseEvent): void {
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  anchor.value = event.currentTarget as HTMLElement;
  // 打开前顺手刷一次作品库：清单是主进程的只读镜像，左栏只在挂载时读一次，
  // 期间若在别的入口建过书，这里不刷就会少一行（这条通路本身不写任何数据）。
  void book.loadRecentBooks();
  menuOpen.value = true;
}

/**
 * 选中一条：三个动作各自走现成入口，渲染层不新增任何 IPC 或数据字段。
 * 收起时机与阶段弹层一致：动作走完就收起（换书/建书不是「留着让你再点一次」的场景）。
 */
async function choose(id: string): Promise<void> {
  if (id === PROJECT_NEW_ID) {
    layout.openNewBook();
    menuOpen.value = false;
    return;
  }
  if (id === PROJECT_PICK_ID) {
    await book.pickAndOpen();
    menuOpen.value = false;
    return;
  }
  const rootPath = projectBookPath(id);
  if (rootPath === null) return;
  // 点的就是正在写的这一本：不发第二次 IPC，直接收起（与作品库那一行同一条口径）。
  if (rootPath !== book.rootPath) await book.openBook(rootPath);
  menuOpen.value = false;
}
</script>

<template>
  <div class="composer-project-row">
    <button
      class="composer-context-item composer-project-trigger"
      type="button"
      title="选择作品：新建作品、打开作品目录，或从最近作品里挑一本"
      aria-haspopup="dialog"
      :aria-expanded="menuOpen"
      :disabled="running"
      @click="toggleMenu"
    >
      <AppIcon name="folder" :size="15" />
      <strong>选择作品</strong>
      <AppIcon class="context-chevron" name="chevron" :size="12" />
    </button>
  </div>
  <ComposerContextMenu
    v-if="menuOpen && anchor"
    :anchor="anchor"
    :options="options"
    :busy="running"
    heading="选择作品"
    search-placeholder="搜索作品名称"
    empty-title="还没有可选的作品"
    empty-hint="新建一本，或打开一个已有 book.json 的目录"
    @select="void choose($event)"
    @close="menuOpen = false"
  />
</template>

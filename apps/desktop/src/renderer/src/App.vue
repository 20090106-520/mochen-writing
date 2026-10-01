<!-- 三栏壳：DOM 结构与类名取自 deepwrite（Apache-2.0）的 WorkspaceShell.vue
     https://github.com/20090106-520/deepwrite -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { createDefaultAppearanceSettings, type AppearanceColorScheme } from "@abyss/contracts";
import LeftSidebar from "./components/LeftSidebar.vue";
import CenterColumn from "./components/CenterColumn.vue";
import DocumentPane from "./components/DocumentPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import { applyAppearanceThemeToDocument } from "./composables/appearanceThemeRuntime";
import { LEFT_PANE_MAX, LEFT_PANE_MIN, RIGHT_PANE_MIN, useLayoutStore } from "./stores/layoutStore";

const layout = useLayoutStore();
const {
  desktopShell,
  shellClasses,
  shellStyle,
  leftCollapsed,
  rightCollapsed,
  leftPaneWidth,
  rightPaneWidth
} = storeToRefs(layout);

const appearance = createDefaultAppearanceSettings();

function preferredScheme(): AppearanceColorScheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(): void {
  const scheme = preferredScheme();
  applyAppearanceThemeToDocument({
    scheme,
    theme: appearance[scheme],
    uiFontFamily: appearance.uiFontFamily,
    editorFontFamily: appearance.editorFontFamily
  });
}

const rightPaneMax = computed(() => layout.writingRightPaneViewModel.maxWidth);

let schemeQuery: MediaQueryList | undefined;

onMounted(() => {
  applyTheme();
  schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  schemeQuery.addEventListener("change", applyTheme);
  window.addEventListener("resize", layout.reconcilePaneWidths);
});

onBeforeUnmount(() => {
  schemeQuery?.removeEventListener("change", applyTheme);
  window.removeEventListener("resize", layout.reconcilePaneWidths);
});
</script>

<template>
  <div
    ref="desktopShell"
    class="desktop-shell"
    :class="shellClasses"
    :style="shellStyle"
    data-testid="desktop-shell"
  >
    <LeftSidebar v-if="!leftCollapsed" @collapse="layout.togglePane('left')" />

    <CenterColumn
      :left-collapsed="leftCollapsed"
      :right-collapsed="rightCollapsed"
      @toggle-left="layout.togglePane('left')"
      @toggle-right="layout.togglePane('right')"
    />

    <DocumentPane v-if="!rightCollapsed" @collapse="layout.togglePane('right')" />

    <div
      v-if="!leftCollapsed"
      class="pane-resizer pane-resizer-left"
      role="separator"
      aria-label="调整左侧栏宽度"
      aria-orientation="vertical"
      :aria-valuemin="LEFT_PANE_MIN"
      :aria-valuemax="LEFT_PANE_MAX"
      :aria-valuenow="leftPaneWidth"
      tabindex="0"
      @pointerdown="layout.startPaneResize('left', $event)"
      @keydown="layout.handleResizeKeydown('left', $event)"
    />

    <div
      v-if="!rightCollapsed"
      class="pane-resizer pane-resizer-right"
      role="separator"
      aria-label="调整右侧内容栏宽度"
      aria-orientation="vertical"
      :aria-valuemin="RIGHT_PANE_MIN"
      :aria-valuemax="rightPaneMax"
      :aria-valuenow="rightPaneWidth"
      tabindex="0"
      @pointerdown="layout.startPaneResize('right', $event)"
      @keydown="layout.handleResizeKeydown('right', $event)"
    />

    <SaveConflictDialog />
  </div>
</template>

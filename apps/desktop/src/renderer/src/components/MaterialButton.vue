<!-- 素材库（2026-10-23）：右栏头部那一枚按钮 + 它自己的浮层。
     抽成组件是为了 DocumentPane 的行数预算（那个文件贴着 800 行上限），
     形态与人物核对 / 人物设定核对一样：锚点就是你点的按钮，浮层 Teleport 到 body。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import MaterialPanel from "./MaterialPanel.vue";
import { useMaterialStore } from "../stores/useMaterialStore";
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();
const material = useMaterialStore();
const button = ref<HTMLElement>();
const anchor = computed<HTMLElement | null>(() => button.value ?? null);
</script>

<template>
  <button
    ref="button"
    class="icon-button"
    type="button"
    aria-label="素材库"
    title="素材库：给 AI 读的参考材料，可导入文本、让 AI 整理入库"
    :disabled="!book.meta"
    @click="material.toggle()"
  >
    <AppIcon name="archive" :size="17" />
  </button>

  <MaterialPanel v-if="material.open && anchor" :anchor="anchor" @close="material.close()" />
</template>

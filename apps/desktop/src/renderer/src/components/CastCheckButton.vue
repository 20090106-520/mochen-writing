<!-- 人物设定核对（2026-10-22）：右栏头部那一枚按钮 + 它自己的浮层。
     抽成组件是为了 DocumentPane 的行数预算（那个文件已贴着 800 行上限），
     形态与时间线核对一样：锚点就是你点的按钮，浮层 Teleport 到 body。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import CastCheckPanel from "./CastCheckPanel.vue";
import { useCastCheckStore } from "../stores/useCastCheckStore";
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();
const cast = useCastCheckStore();
const button = ref<HTMLElement>();
const anchor = computed<HTMLElement | null>(() => button.value ?? null);
</script>

<template>
  <button
    ref="button"
    class="icon-button"
    type="button"
    aria-label="人物设定核对"
    title="人物设定核对：别名出场、专属说法归属、退场后是否仍在场"
    :disabled="!book.meta"
    @click="void cast.toggle()"
  >
    <AppIcon name="user" :size="17" />
  </button>

  <CastCheckPanel v-if="cast.open && anchor" :anchor="anchor" @close="cast.close()" />
</template>

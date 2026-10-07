<!-- 智能体档案选择器（spec §5.1 墨宸花名册）。
     真身：utils/profile-options.ts 的 profileOptions / activeProfileLabel——判定全在那边，
     本组件只渲染与派发。弹层直接复用阶段那一枚 ComposerContextMenu（行形状同源），不造第二个。

     这枚 chip 存在的理由：六枚档案是数据，不接线就是摆设（§2.7）。选中的档案走
     book.setActiveProfile → bookSaveMeta 落盘，重启后仍在；切档案不换会话线程。 -->
<script setup lang="ts">
import { computed, shallowRef } from "vue";
import AppIcon from "./AppIcon.vue";
import ComposerContextMenu from "./ComposerContextMenu.vue";
import { activeProfileLabel, activeProfileOf, profileOptions } from "../utils/profile-options";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ running: boolean }>();

const book = useBookStore();
const menuOpen = shallowRef(false);
const anchor = shallowRef<HTMLElement>();

const busy = computed(() => book.metaSaving || props.running);
const label = computed(() => activeProfileLabel(book.meta));
const options = computed(() => profileOptions(book.meta, busy.value));
// 有书的阶段可能只登记一枚档案（不可切）。那就不给下拉三角，也不挂 aria-haspopup——
// 「点开只有一项」的选择器是假控件，不如就是一枚只读标签。
const switchable = computed(() => options.value.length > 1);

function showMenu(event: MouseEvent): void {
  anchor.value = event.currentTarget as HTMLElement;
  menuOpen.value = true;
}

async function choose(id: string): Promise<void> {
  const before = book.meta?.activeProfile ?? null;
  await book.setActiveProfile(id);
  // 与阶段弹层同一条裁定：收起与否由「有没有落盘成功」裁决，不由组件猜。
  if (before !== id && activeProfileOf(book.meta).id === id) menuOpen.value = false;
}
</script>

<template>
  <component
    :is="switchable ? 'button' : 'span'"
    class="composer-context-item composer-profile-context"
    :class="{ 'is-static': !switchable }"
    :type="switchable ? 'button' : undefined"
    :title="
      switchable
        ? `切换智能体档案（当前：${activeProfileOf(book.meta).name}）`
        : `当前智能体档案：${label}（本阶段只有这一枚可切）`
    "
    :aria-label="`智能体档案，当前：${label}`"
    :aria-haspopup="switchable ? 'dialog' : undefined"
    :aria-expanded="switchable ? menuOpen : undefined"
    @click="switchable ? showMenu($event) : undefined"
  >
    <AppIcon name="bot" :size="16" />
    <strong>{{ label }}</strong>
    <AppIcon v-if="switchable" class="context-chevron" name="chevron" :size="12" />
  </component>
  <ComposerContextMenu
    v-if="menuOpen && anchor"
    :anchor="anchor"
    :options="options"
    :busy="book.metaSaving"
    @select="void choose($event)"
    @close="menuOpen = false"
  />
</template>

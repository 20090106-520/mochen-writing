<!-- #113c 阶段选择弹层。真身：deepwrite components/ComposerContextMenu.vue + composer-context-menu.css
     ，DOM 结构、类名与键盘操作逐条对齐：搜索过滤、当前项打勾、上下键在可用项间环移、
     Enter 选中第一条、Tab 触边交还焦点、Esc 关闭。
     删掉的只有他那份的 book / library 两个分支——本仓没有书目/资料库注册表（无 book:list 通道），
     留着就是永不为真的判断；类名与 CSS 一律沿用他的，日后对上游 diff 是机械活。
     样式不住这里：本仓 .vue 不写 style 段，全部进 styles/agent-pane.css 的卡片分段（见 composer-card-wiring 契约）。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { popoverOwnsKey } from "../utils/slash-commands";
import type { ContextOption } from "../utils/composer-context";
import type { HotkeyMods } from "../utils/hotkeys";

const props = defineProps<{
  anchor: HTMLElement;
  options: readonly ContextOption[];
  busy: boolean;
}>();
const emit = defineEmits<{ close: []; select: [id: string] }>();
const titleId = useId();
const query = ref("");
const search = ref<HTMLInputElement>();
const panel = ref<HTMLElement>();
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return props.options.filter((option) =>
    `${option.label} ${option.detail}`.toLocaleLowerCase().includes(term)
  );
});

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

function keydown(event: KeyboardEvent): void {
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  // 裸 Esc（且不在输入法组合中）才归弹层：判定与权限档弹层共用 popoverOwnsKey，模板里不写裸比较。
  if (popoverOwnsKey(event.key, mods, event.isComposing === true)) {
    event.stopPropagation();
    close();
    return;
  }
  const buttons = Array.from(
    panel.value?.querySelectorAll<HTMLButtonElement>(".context-option:not(:disabled)") ?? []
  );
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next =
      index < 0
        ? event.key === "ArrowDown"
          ? 0
          : buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  if (event.key === "Enter" && event.target === search.value) {
    event.preventDefault();
    buttons[0]?.click();
  }
  tab(event);
}

onMounted(async () => {
  await nextTick();
  // 【5-㊵ 退役】原先这里还有一句 search.value?.focus()，已删。
  // 它落在一个**看不见**的窗口里：面板的 style 初值是 { visibility: "hidden" }，由 composable 的
  // position() 换掉，而对 visibility:hidden 的元素调 focus() 是静默失败——p536nb 逐帧量到
  // t≈40ms 时 computed visibility 仍是 hidden、t≈120ms 才 visible，一次都没进去且无人重试。
  // 「焦点进层」的真身现在是 useComposerContextPopover.focusFirstWhenVisible()，那一族共用它；
  // 留着这里就是同一件事的第二份实现，而且偏偏是那个不生效的。
  panel.value?.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
});
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="composer-context-menu"
      :style="style"
      tabindex="-1"
      role="dialog"
      :aria-labelledby="titleId"
      :aria-busy="busy"
      @keydown="keydown"
    >
      <header class="context-picker-heading">
        <strong :id="titleId">选择本书阶段</strong>
        <button class="context-picker-close" type="button" aria-label="关闭选择浮层" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>
      <div class="context-picker-body">
        <label class="context-search">
          <AppIcon name="search" :size="17" />
          <input
            ref="search"
            v-model="query"
            type="search"
            placeholder="搜索阶段名称"
            aria-label="搜索阶段名称"
          />
        </label>
        <div class="context-picker-list">
          <button
            v-for="option in filtered"
            :key="option.id"
            class="context-option"
            type="button"
            :class="{ 'is-current': option.current }"
            :aria-current="option.current ? 'true' : undefined"
            :disabled="busy || option.disabled"
            @click="emit('select', option.id)"
          >
            <span class="context-option-icon"><AppIcon :name="option.icon" :size="17" /></span>
            <span class="context-option-copy"
              ><strong :title="option.label">{{ option.label }}</strong
              ><small v-if="option.detail || option.disabled" :title="option.detail">{{
                option.disabled ? "暂不可用" : option.detail
              }}</small></span
            >
            <span v-if="option.current" class="context-current"
              ><AppIcon name="check" :size="15"
            /></span>
            <AppIcon v-else name="chevron" :size="14" />
          </button>
          <div v-if="!filtered.length" class="context-picker-empty">
            <AppIcon name="search" :size="26" /><strong>{{
              query.trim() ? "没有找到匹配项" : "这本书没有可切的阶段"
            }}</strong
            ><span>{{ query.trim() ? "试试其他关键词" : "阶段列在作品目录的 book.json 里" }}</span>
          </div>
        </div>
      </div>
    </section>
  </Teleport>
</template>

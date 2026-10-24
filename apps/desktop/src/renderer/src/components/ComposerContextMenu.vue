<!-- #113c 阶段选择弹层。真身：deepwrite components/ComposerContextMenu.vue + composer-context-menu.css
     ，DOM 结构、类名与键盘操作逐条对齐：搜索过滤、当前项打勾、上下键在可用项间环移、
     Tab 触边交还焦点、Esc 关闭。
     删掉的只有他那份的 book / library 两个分支——本仓没有书目/资料库注册表（无 book:list 通道），
     留着就是永不为真的判断；类名与 CSS 一律沿用他的，日后对上游 diff 是机械活。
     样式不住这里：本仓 .vue 不写 style 段，全部进 styles/agent-pane.css 的卡片分段（见 composer-card-wiring 契约）。

     【2026-10-25 按墨宸自己那份 @ 引用菜单的范式重做键盘这一半】
     改之前：↑↓ **搬真焦点**（一按方向键，焦点就离开搜索框了，于是「再打两个字」打不进去），
     Enter 选的是 **buttons[0]**（第一条），不是用户正指着的那条——高亮在两个地方各算各的。
     ⇒ 现在与那一族同一形状：↑↓ 走**高亮**（下标，焦点留在搜索框）、Enter 选高亮那条、
       悬停与高亮同步、名单是 listbox/option + aria-selected、底部一枚 kbd 提示行。
       高亮判据只有一份（composables/useListHighlight.ts + utils/list-highlight.ts）。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { useListHighlight } from "../composables/useListHighlight";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
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

/**
 * 能被选的那几项：禁用的不参与导航（旧实现也是 `:not(:disabled)` 那一套口径），
 * 忙时整列都禁 ⇒ 名单为空，高亮自然失效。
 */
const selectable = computed<ContextOption[]>(() =>
  filtered.value.filter((option) => !option.disabled && !props.busy)
);

/** 行元素句柄：高亮行要能滚进视野（长名单时高亮可能停在视口外）。 */
const optionEls = new Map<string, HTMLElement>();
function setOptionRef(id: string, el: unknown): void {
  if (el instanceof HTMLElement) optionEls.set(id, el);
  else optionEls.delete(id);
}

/**
 * 高亮（2026-10-25）：这一族浮层共用的那一份。
 * 初值落在「当前那一档」上——用户最可能要改的正是现在这一档。
 */
const highlight = useListHighlight<string>({
  items: () => selectable.value.map((option) => option.id),
  initialIndex: () => selectable.value.findIndex((option) => option.current),
  onPick: (id) => emit("select", id),
  elementOf: (id) => optionEls.get(id) ?? null
});
/** 屏幕上高亮的那一项。 */
const activeId = computed<string>(() => highlight.activeItem.value ?? "");

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { focusSelector: ".context-search-input" }
);

function keydown(event: KeyboardEvent): void {
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  // 裸 Esc（且不在输入法组合中）才归弹层：判定与权限档弹层共用 popoverOwnsKey，模板里不写裸比较。
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.stopPropagation();
    close();
    return;
  }
  // ↑ / ↓ 走高亮（不是搬真焦点）：焦点留在搜索框里，用户才能边打字边选。
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlight.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  // Enter 选**高亮那条**，不是第一条。输入法合成中的 Enter 不算（imeOwnsKey）。
  if (event.key === "Enter" && event.target === search.value) {
    if (imeOwnsKey(event)) return;
    event.preventDefault();
    highlight.pickActive();
    return;
  }
  tab(event);
}

/** 鼠标划过就把高亮挪过去（键盘与鼠标共用同一个高亮）。 */
function setActive(id: string): void {
  const index = selectable.value.findIndex((option) => option.id === id);
  if (index >= 0) highlight.activate(index);
}

onMounted(async () => {
  await nextTick();
  // 【5-㊵ 退役】原先这里还有一句 search.value?.focus()，已删。
  // 它落在一个**看不见**的窗口里：面板的 style 初值是 { visibility: "hidden" }，由 composable 的
  // position() 换掉，而对 visibility:hidden 的元素调 focus() 是静默失败——p536nb 逐帧量到
  // t≈40ms 时 computed visibility 仍是 hidden、t≈120ms 才 visible，一次都没进去且无人重试。
  // 「焦点进层」的真身现在是 useComposerContextPopover.focusFirstWhenVisible()，那一族共用它；
  // 留着这里就是同一件事的第二份实现，而且偏偏是那个不生效的。
  //
  // 焦点现在**落在搜索框**（focusSelector 走共用的合成器选项），于是「当前那一档」要自己滚进视野：
  // 那是高亮的初值所在，不滚进去就看不见自己正指着哪一条。
  highlight.reveal();
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
            class="context-search-input"
            type="search"
            placeholder="搜索阶段名称"
            aria-label="搜索阶段名称"
          />
        </label>
        <div class="context-picker-list" role="listbox" aria-label="本书阶段">
          <button
            v-for="option in filtered"
            :key="option.id"
            :ref="(el) => setOptionRef(option.id, el)"
            class="context-option"
            type="button"
            role="option"
            :class="{ 'is-current': option.current, 'is-selected': activeId === option.id }"
            :aria-selected="activeId === option.id"
            :aria-current="option.current ? 'true' : undefined"
            :disabled="busy || option.disabled"
            @click="emit('select', option.id)"
            @mouseenter="setActive(option.id)"
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
        </div>
        <div v-if="!filtered.length" class="context-picker-empty">
          <AppIcon name="search" :size="26" /><strong>{{
            query.trim() ? "没有找到匹配项" : "这本书没有可切的阶段"
          }}</strong
          ><span>{{ query.trim() ? "试试其他关键词" : "阶段列在作品目录的 book.json 里" }}</span>
        </div>
      </div>
      <!-- 键位提示行（2026-10-25）：与 @ 引用菜单、模型选择器、权限档同一枚形状，
           排版走 styles.css 的 `.list-keys` 一处。 -->
      <footer class="context-picker-keys list-keys">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>Enter</kbd> 切换</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </footer>
    </section>
  </Teleport>
</template>

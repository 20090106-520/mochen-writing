<!-- 模型 ▾ 的下拉（2026-10-07 用户裁定：「不应该在上面，应该像第四张图片那样点击那个，它会弹出来，可以直接切换」）。
     原先是全屏遮罩 + 变暗 + 居中模态：为了换一个模型先打断整窗。改成贴 chip 的下拉——
     名单只来自 provider:list-models（主进程按自己的配置出网，密钥不进 URL），点哪一行就切哪一行。
     定位/关闭/焦点全部走共用的 useComposerContextPopover + <Teleport to="body">，不造第二套机制。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { ModelListResult } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { groupModels, modelKindOf, type ModelGroupKind } from "../utils/model-picker";
import type { HotkeyMods } from "../utils/hotkeys";

const props = defineProps<{
  /** 触发它的那枚 chip（ComposerBox 把元素随 open-model-select 事件一起交上来）。下拉贴在它下面。 */
  anchor: HTMLElement;
  result: ModelListResult | null;
  loading: boolean;
  current: string;
  switching: boolean;
  /**
   * 切换失败的理由（空串 = 没失败）。
   *
   * **这一行是「点了没反应」的反面**：切不过去时浮层**不关**，理由必须摆在原地
   * （`store.switchError`，由装配处转交）。本组件仍然不碰 `window.mochen`——
   * 出网判定全在主进程，这里只把已经判好的话显示出来。
   */
  switchError: string;
}>();
const emit = defineEmits<{ close: []; retry: []; "open-settings": []; select: [model: string] }>();
const panel = ref<HTMLElement>();

/** 名单与理由都从 props 来：本组件不碰 window.mochen，出网判定全在主进程。 */
const rows = computed<string[]>(() =>
  props.result !== null && props.result.ok ? props.result.models : []
);
const failReason = computed(() =>
  props.result !== null && !props.result.ok ? props.result.reason : ""
);

/**
 * 搜索（2026-10-21）：名单可以有几十个，纯按顺序扫太慢。
 * 只做**本地子串过滤**——不额外问主进程，也不给模型编「类型/能力」这类主进程没给的标签。
 */
const query = ref("");
const filtered = computed<string[]>(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle === "") return rows.value;
  return rows.value.filter((name) => name.toLowerCase().includes(needle));
});

/**
 * 分组与模态标记（2026-10-22）。
 *
 * 真机事故：名单是**平铺**的，图像/视频模型和对话模型混在一起，点错一行就会切到
 * `agnes-image-2.1-flash`，下一句话必然被上游 400 顶回来（「is an image model」）。
 * 名单本身不带类型字段，所以这里只用 `modelKindOf` 的**名字猜测**做两件事：
 * 把不能对话的排到后面，并在那一行标出「图像 / 视频」——不隐藏、不禁用任何一个模型
 * （猜错只是标记多余，不会让一个能用的模型消失）。
 */
const groups = computed(() => groupModels(filtered.value));
const hasNonChat = computed(() =>
  groups.value.some((group) => group.kind !== "chat" && group.items.length > 0)
);

/** 行尾那枚模态标记：对话模型不标（那是默认），只标猜出来不能对话的。 */
function modalityTagOf(name: string): string {
  const kind: ModelGroupKind = modelKindOf(name);
  if (kind === "image") return "图像";
  if (kind === "video") return "视频";
  return "";
}

// 点外面 / Esc / Tab 触边 / 关闭钮，四条关闭通路都在这一个合成器里（含「关完把焦点还给那枚 chip」）。
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

/**
 * 点一行就是切过去（用户要的是「可以直接切换」，不是再按一次「改用」）。
 *
 * 当前那一行点下去**收起**，不重复写同一个模型名——它挂着 ✓，再写一遍既没有效果
 * 又会让用户以为没生效。原先那一行干脆不是按钮（徽章），那是模态框时代的折法：
 * 整行不可点时「为什么这一行点不动」只能靠猜。改成整行可点 + ✓ 之后，
 * 「按了没反应」这一类摆设就没有立足之地了：要么切，要么收起。
 */
function pick(name: string): void {
  if (name === props.current) {
    close();
    return;
  }
  emit("select", name);
}

// 只有裸 Esc 归弹层；键的判定走 popoverOwnsKey 纯函数，模板里不写裸比较（裁定 G5）。
function onKeydown(event: KeyboardEvent): void {
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.stopPropagation();
    close();
    return;
  }
  // ↑ / ↓ 在名单里走焦点（2026-10-21）：几十行时用键盘比鼠标稳。到边界回绕。
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Tab") tab(event);
}

/**
 * 行元素句柄（2026-10-21）：↑↓ 靠它走焦点。不在这里 `querySelector`——
 * 组件不自己去 DOM 里搜节点，句柄只从模板的 ref 收集器里拿（同 ComposerBox 的 setChipRef 口径）。
 */
const rowEls = new Map<string, HTMLElement>();
function setRowRef(name: string, el: unknown): void {
  if (el instanceof HTMLElement) rowEls.set(name, el);
  else rowEls.delete(name);
}

/** 焦点在行间移动；当前行被筛掉了就从头/尾重新落。输入框里的 ↑↓ 仍归输入框自己。 */
function moveFocus(delta: 1 | -1): void {
  const names = filtered.value;
  if (names.length === 0) return;
  const index = names.findIndex((name) => rowEls.get(name) === document.activeElement);
  const next =
    index < 0
      ? delta === 1
        ? 0
        : names.length - 1
      : (index + delta + names.length) % names.length;
  rowEls.get(names[next] ?? "")?.focus();
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="model-select"
      :style="style"
      role="menu"
      aria-label="选择模型"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header class="model-select-head">
        <strong>这一轮用哪个模型</strong>
        <span v-if="rows.length" class="model-select-count"
          >{{ filtered.length }} / {{ rows.length }}</span
        >
        <button
          v-if="rows.length && !loading"
          class="model-select-refresh"
          type="button"
          :disabled="switching"
          title="重新向模型设置里的地址拉一次名单"
          @click="emit('retry')"
        >
          刷新
        </button>
        <button class="model-select-close" type="button" aria-label="关闭模型列表" @click="close">
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <label v-if="rows.length > 6" class="model-select-search">
        <input
          v-model="query"
          type="search"
          class="model-select-search-input"
          placeholder="搜模型名…"
          aria-label="按名字筛选模型"
        />
      </label>

      <p v-if="loading" class="model-select-note">正在拉取模型名单…</p>
      <ul v-else-if="groups.length" class="model-select-list">
        <template v-for="group in groups" :key="group.kind">
          <!-- 只有一种分组时不加标题：名单全是对话模型时，多一行「对话 / 写作」只是噪声。 -->
          <li v-if="groups.length > 1" class="model-select-group-head">{{ group.label }}</li>
          <li v-for="name in group.items" :key="name">
            <button
              :ref="(el) => setRowRef(name, el)"
              type="button"
              role="menuitem"
              class="model-select-row"
              :class="{ 'is-current': name === current }"
              :aria-current="name === current ? 'true' : undefined"
              :disabled="switching"
              @click="pick(name)"
            >
              <span class="model-select-name">{{ name }}</span>
              <!-- 名字猜出来不能对话的，行字后面直接标出来——用户点它之前就该知道这一行发不出话。 -->
              <span v-if="modalityTagOf(name)" class="model-select-tag">{{
                modalityTagOf(name)
              }}</span>
              <AppIcon v-if="name === current" class="model-select-check" name="check" :size="14" />
            </button>
          </li>
        </template>
      </ul>
      <p v-else-if="rows.length" class="model-select-note">没有匹配「{{ query }}」的模型。</p>
      <template v-else>
        <p v-if="failReason" class="model-select-error">{{ failReason }}</p>
        <p v-else class="model-select-error">还没拿到名单。</p>
        <!-- 失败态要给两条出路：重试治「网络抖了一下」，去模型设置治「地址/密钥本身不对」。
             少了后者，报错里那句「请在设置里重新填写 API Key」就只是一句指点路的话——
             用户得自己关掉浮层、去左栏底找齿轮、再翻到模型页。2026-10-05 用户截图实锤的死路。 -->
        <div class="model-select-actions">
          <button class="model-select-retry" type="button" @click="emit('retry')">再试一次</button>
          <button class="model-select-settings" type="button" @click="emit('open-settings')">
            去模型设置
          </button>
        </div>
      </template>
      <p v-if="hasNonChat" class="model-select-note">
        带「图像 / 视频」标记的模型不能用来对话，选中后发送会直接失败。
      </p>
      <!-- 忙态理由必须是看得见的文字：disabled 按钮在 Chromium 里不弹 title，光靠禁用等于没说。 -->
      <p v-if="switching" class="model-select-note">正在写回模型名…</p>
      <!-- 切换失败：浮层刻意不关（装配处只在写回成功时关），所以理由得摆在这里而不是让人去设置页找。
           2026-10-08 真机：这一行不存在时点名单任何一行都是「chip 不变、浮层不关、屏上零动静」。 -->
      <p v-if="switchError" class="model-select-error">{{ switchError }}</p>
      <p class="model-select-foot">
        名单来自 provider:list-models（主进程按模型设置里的 baseURL
        出网）。改地址、换密钥或手填模型名，都在模型设置里做。
      </p>
    </section>
  </Teleport>
</template>

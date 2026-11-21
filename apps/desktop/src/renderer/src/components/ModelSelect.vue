<!-- 模型 ▾ 的下拉（2026-10-07 用户裁定：「不应该在上面，应该像第四张图片那样点击那个，它会弹出来，可以直接切换」）。
     原先是全屏遮罩 + 变暗 + 居中模态：为了换一个模型先打断整窗。改成贴 chip 的下拉——
     名单只来自 provider:list-models（主进程按自己的配置出网，密钥不进 URL），点哪一行就切哪一行。
     定位/关闭/焦点全部走共用的 useComposerContextPopover + <Teleport to="body">，不造第二套机制。

     【2026-10-25：两刀】
     ① 用户裁定「我这是写小说的，应该只显示写作模型，其他的模型不显示」——
        名单里**只列能用来写这一轮对话的模型**（判据 utils/model-picker 的 isWritableModel）。
        这比 2026-10-22 那版「分组 + 行尾标记」更彻底：标记只是提醒，藏掉才是根治。
        （代价写在 model-picker.ts 的文件头：判据是按名字猜的，猜错就等于藏了一个能用的模型；
          所以规矩是「宁可多列一个不能写的，也不要藏掉一个能写的」。）
     ② 交互与观感**照墨宸自己那份选择器**来（@ 引用菜单 ComposerReferenceMenu，
        同一个输入区、同一类浮层，它做得最全）：
          高亮在下标上（`useListHighlight`）、悬停与高亮同步、名单是 listbox/option + aria-selected、
          底部一枚 kbd 提示行、高亮底色走 `--selected` 那一档、搜索框左边带 search 图标。
        ⇒ 这一族浮层（模型选择器 / 权限档 / 阶段选择 / 设置页的模型名单）共用同一份高亮判据，
          不再各写一遍（铁律 6）。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { ModelListResult } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { useListHighlight } from "../composables/useListHighlight";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  MODEL_PICKER_LIST_LIMIT,
  MODEL_WRITABLE_ONLY_NOTE,
  filterModels,
  modalityLabelOf,
  splitByCurrentModel,
  versionBadgeOf,
  writableModels
} from "../utils/model-picker";
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

/**
 * 面板宽度与高度上限（2026-10-25）。
 *
 * 共用的合成器默认给 320 宽 / 380 高（`POPOVER_WIDTH` / `POPOVER_MAX_HEIGHT`），
 * 那是给「挑一个选项」那类短菜单的。模型名是一长串 ASCII（`agnes-2.5-pro-alpha`）
 * 加上右端那枚模态标记，320 装下就挤成两行 ⇒ 宽度自报 380。
 *
 * 高度同理：模型名单动辄十几个，加上一段「正在用」与两句说明，
 * 380 会把列表切在半行上（真机读数：9 个模型只露 5 行，且第五行被切成半截）。
 * ⇒ 上限自报 560。**底线没松**：合成器那侧仍是 `min(limitPx, spacePx)`，
 * 贴着窗口下沿打开时不会有一截跑到屏幕外面去（同一个 `limitPx` 口子，技能库那类面板早就在用）。
 */
const PANEL_WIDTH = 380;
const PANEL_MAX_HEIGHT = 560;

/** 上游给的全部模型名（未过滤、未封顶）。名单与理由都从 props 来：本组件不碰 window.mochen。 */
const allModels = computed<string[]>(() =>
  props.result !== null && props.result.ok ? props.result.models : []
);
/**
 * **只留能用来写这一轮的模型**（2026-10-25 用户裁定：这是写小说的软件）。
 * 判据在 utils/model-picker.ts 的 `writableModels`（只有一份），这里不自己判。
 */
const upstream = computed<string[]>(() => writableModels(allModels.value));
const failReason = computed(() =>
  props.result !== null && !props.result.ok ? props.result.reason : ""
);

/**
 * 搜索（2026-10-21）：名单可以有几十个，纯按顺序扫太慢。
 * 只做**本地子串过滤**——不额外问主进程，也不给模型编「类型/能力」这类主进程没给的标签。
 *
 * 判据用 `utils/model-picker.ts` 的 `filterModels`（那份本来就在，组件里那份同款逻辑是
 * 第二份实现，2026-10-25 收掉）——同一判定不许有第二份实现。
 */
const query = ref("");
const queryActive = computed(() => query.value.trim() !== "");
const matched = computed<string[]>(() => filterModels(upstream.value, query.value));

/**
 * 名单封顶（2026-10-25）：有些 hub 的 `/models` 会回几百条，全铺开会把浮层撑到要滚页面。
 * 上限沿用 `MODEL_PICKER_LIST_LIMIT`（设置页那份模型选择器早就在用同一个数）。
 * **先过滤再封顶**：不然位置在第 300 名的模型永远搜不到。
 */
const rows = computed<string[]>(() => matched.value.slice(0, MODEL_PICKER_LIST_LIMIT));
const truncated = computed(() => matched.value.length > rows.value.length);

/**
 * 「正在用」那一行要不要摆着。
 *
 * 没在搜 ⇒ 摆着（哪怕上游名单里根本没有它：手填的模型名上游未必列得出来，
 * 但此刻确实在用，不摆着就等于面板不认账）。
 * 在搜 ⇒ 只在当前模型**也匹配**这次搜索时才摆（搜「image」的时候占一行「正在用 agnes-3.0」
 * 是噪声）；判据那一半（切分）在 `splitByCurrentModel` 里。
 */
const showCurrent = computed(() => {
  if (props.current === "") return false;
  if (!queryActive.value) return true;
  // 「当前模型算不算这次搜索的结果」也走那一份 filterModels：
  // 组件里不另写一遍子串比较（同一判定不许有第二份实现）。
  return filterModels([props.current], query.value).length > 0;
});

const split = computed(() => splitByCurrentModel(rows.value, props.current, showCurrent.value));

/**
 * 面板里从上到下所有可点的行（当前那一行在最前）。
 * 高亮按这个次序走——所以「正在用」那一行永远是第一项。
 */
const visibleNames = computed<string[]>(() => [...split.value.current, ...split.value.rest]);

/** 头部那枚计数：没搜时是「几个」，搜时是「匹配几个 / 一共几个」。 */
const countText = computed(() => {
  if (queryActive.value) return `${matched.value.length} / ${upstream.value.length} 匹配`;
  if (truncated.value) return `前 ${MODEL_PICKER_LIST_LIMIT} 个`;
  return `${upstream.value.length} 个`;
});

/**
 * 行元素句柄：高亮走的是**下标**（焦点始终留在搜索框里），这里留的是元素引用——
 * 高亮行要能滚进视野（几十个模型时高亮可能停在视口外，Enter 切一个看不见的模型就白切了）。
 * 组件不自己去 DOM 里搜节点，句柄只从模板的 ref 收集器里拿（同 ComposerBox 的 setChipRef 口径）。
 */
const rowEls = new Map<string, HTMLElement>();
function setRowRef(name: string, el: unknown): void {
  if (el instanceof HTMLElement) rowEls.set(name, el);
  else rowEls.delete(name);
}

/**
 * 高亮：这一族浮层共用的那一份（2026-10-25 抽成 composables/useListHighlight.ts）。
 * 它管的是「高亮在第几项、Enter 交出去哪一项、悬停落在哪一项」，
 * 不管焦点在哪儿——焦点留给搜索框（能边打字边选）。
 */
const highlight = useListHighlight<string>({
  items: () => visibleNames.value,
  onPick: (name) => pick(name),
  elementOf: (name) => rowEls.get(name) ?? null
});
/** 屏幕上高亮的那一行。 */
const activeName = computed<string>(() => highlight.activeItem.value ?? "");

/** 搜索框：打开就把光标放进来（合成器的 focusSelector 走的是同一个共用机制）。 */
const searchInput = ref<HTMLInputElement | null>(null);

// 点外面 / Esc / Tab 触边 / 关闭钮，四条关闭通路都在这一个合成器里（含「关完把焦点还给那枚 chip」）。
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  {
    focusSelector: ".model-select-search-input",
    widthPx: PANEL_WIDTH,
    limitPx: PANEL_MAX_HEIGHT
  }
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
  // ↑ / ↓ 在名单里走高亮（2026-10-25 从「搬真焦点」改过来）：焦点留在搜索框里，
  // 用户才能边打字边选——搬走了就打字打不进去，那才是真不好用。
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlight.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  // Home / End：跳首尾。几十个模型时省得一路按 ↓。
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    highlight.activate(event.key === "Home" ? 0 : visibleNames.value.length - 1);
    highlight.reveal();
    return;
  }
  // Enter 只在**搜索框**里由这里接管：行本身是 <button>，Enter 会触发它自己的 click，
  // 在面板根上再接一次就是「按一下切两次」。输入法合成中的 Enter 不算（imeOwnsKey）。
  if (event.key === "Enter" && event.target === searchInput.value) {
    if (imeOwnsKey(event)) return;
    event.preventDefault();
    highlight.pickActive();
    return;
  }
  if (event.key === "Tab") tab(event);
}

/** 鼠标划过一行就把高亮挪过去（键盘与鼠标共用同一个高亮，不会各走各的）。 */
function setActive(name: string): void {
  const index = visibleNames.value.indexOf(name);
  if (index >= 0) highlight.activate(index);
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="model-select"
      :style="style"
      aria-label="切换模型"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header class="model-select-head">
        <strong>切换模型</strong>
        <span v-if="upstream.length" class="model-select-count">{{ countText }}</span>
        <button class="model-select-close" type="button" aria-label="关闭模型列表" @click="close">
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <!-- 搜索框常驻（名单里只要有一个模型就在）：它同时是「这个面板可以搜」的信号，
           也是打开时光标落的地方（合成器的 focusSelector）。原先是「超过六行才出现」，
           于是多数时候没有搜索框，用户也就不知道能搜。 -->
      <label v-if="upstream.length" class="model-select-search">
        <AppIcon class="model-select-search-icon" name="search" :size="15" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          class="model-select-search-input"
          placeholder="搜模型名…"
          aria-label="按名字筛选模型"
        />
      </label>

      <!-- 状态区（2026-10-25 从列表底下挪到列表上面）：写回中与切换失败的理由必须在第一屏。
           原来它们排在脚注前头，名单一长就被推到滚动区下面——用户看不见就只剩「点了没反应」。 -->
      <p v-if="switching" class="model-select-note">正在写回模型名…</p>
      <!-- 切换失败：浮层刻意不关（装配处只在写回成功时关），所以理由得摆在这里而不是让人去设置页找。
           2026-10-08 真机：这一行不存在时点名单任何一行都是「chip 不变、浮层不关、屏上零动静」。 -->
      <p v-if="switchError" class="model-select-error">{{ switchError }}</p>

      <p v-if="loading" class="model-select-note">正在拉取模型名单…</p>
      <ul
        v-else-if="visibleNames.length"
        class="model-select-list"
        role="listbox"
        aria-label="模型名单"
      >
        <!-- 「正在用」：当前模型单开一段摆到最上面。它不在下面的名单里（不重复出现），
             免得「同一个模型名出现两次」让人以为有两个。
             <li> 只是排版用的壳（role="presentation" 把它从无障碍树里摘掉），
             真正的 option 是壳里那枚按钮——与 @ 引用菜单那份同一形状。 -->
        <li v-if="split.current.length" class="model-select-section-head" role="presentation">
          正在用
        </li>
        <li v-for="name in split.current" :key="name" role="presentation">
          <button
            :ref="(el) => setRowRef(name, el)"
            type="button"
            role="option"
            class="model-select-row is-current"
            :class="{ 'is-selected': activeName === name }"
            :aria-selected="activeName === name"
            aria-current="true"
            :disabled="switching"
            @click="pick(name)"
            @mouseenter="setActive(name)"
          >
            <span class="model-select-row-icon" aria-hidden="true">
              <AppIcon name="model" :size="12" />
            </span>
            <span class="model-select-name">{{ name }}</span>
            <!-- 【诚实边界】当前在用的这一枚**可能不是写作模型**（手填的模型名，
                 或者早先误切留下的图像模型）。名单已经只留写作模型，这一行照常摆着，
                 所以它写不了这件事得标出来——标出来是诚实，藏起来才是骗人。 -->
            <span v-if="modalityLabelOf(name)" class="model-select-tag">{{
              modalityLabelOf(name)
            }}</span>
            <!-- 右缘元信息位（参考图那个 x 倍率的位置）：放的是名字里自带的版本号，不放假倍率。 -->
            <span class="model-select-meta">{{ versionBadgeOf(name) }}</span>
            <AppIcon class="model-select-check" name="check" :size="14" />
          </button>
        </li>
        <li v-for="name in split.rest" :key="name" role="presentation">
          <button
            :ref="(el) => setRowRef(name, el)"
            type="button"
            role="option"
            class="model-select-row"
            :class="{ 'is-selected': activeName === name }"
            :aria-selected="activeName === name"
            :disabled="switching"
            @click="pick(name)"
            @mouseenter="setActive(name)"
          >
            <span class="model-select-row-icon" aria-hidden="true">
              <AppIcon name="model" :size="12" />
            </span>
            <span class="model-select-name">{{ name }}</span>
            <span class="model-select-meta">{{ versionBadgeOf(name) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="upstream.length" class="model-select-note">没有匹配「{{ query }}」的模型。</p>
      <p v-else-if="allModels.length" class="model-select-note">
        上游给的模型里没有能用来写这一轮的。{{ MODEL_WRITABLE_ONLY_NOTE }}
      </p>
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

      <!-- 封顶时的那句：不说「只列了 120 个」，用户会以为这就是全部。 -->
      <p v-if="truncated" class="model-select-note">
        名单太长，这里只列了前 {{ MODEL_PICKER_LIST_LIMIT }} 个；用搜索找其余的。
      </p>
      <!-- 刷新搬到底部文字行（2026-11-20，照用户参考图的结构）：此前是头部图标钮——
           但「重新拉名单」是排障动作，参考图把它摆在面板末尾与说明同区，主路径更干净。
           通道名仍在悬停提示里（铁律：控件要报得出自己走哪条通道）。 -->
      <button
        v-if="upstream.length && !loading"
        class="model-select-refresh"
        type="button"
        :disabled="switching"
        title="重新拉取模型名单（provider:list-models）"
        @click="emit('retry')"
      >
        <AppIcon name="refresh" :size="13" />
        刷新模型列表
      </button>
      <!-- 脚注（2026-10-25 去术语）：只说「去哪儿改」；通道名在上面刷新钮的悬停提示里。
           2026-11-20 照参考图加「*」前缀——它是元信息，不是正文。 -->
      <p class="model-select-foot">
        * 名单来自「模型设置」里填的地址。改地址、换密钥或手填模型名，都在那儿改。
      </p>
      <!-- 键位提示行（2026-10-25 照 @ 引用菜单那份来）：那个浮层是同一族里做得最全的，
           底部一枚 kbd 提示行把「能怎么用」说清楚，不用猜。 -->
      <p class="model-select-keys list-keys">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>Enter</kbd> 切换</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </p>
    </section>
  </Teleport>
</template>

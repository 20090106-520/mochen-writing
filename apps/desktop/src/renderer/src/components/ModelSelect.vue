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
  if (event.key === "Tab") tab(event);
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
        <button class="model-select-close" type="button" aria-label="关闭模型列表" @click="close">
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <p v-if="loading" class="model-select-note">正在拉取模型名单…</p>
      <ul v-else-if="rows.length" class="model-select-list">
        <li v-for="name in rows" :key="name">
          <button
            type="button"
            role="menuitem"
            class="model-select-row"
            :class="{ 'is-current': name === current }"
            :aria-current="name === current ? 'true' : undefined"
            :disabled="switching"
            @click="pick(name)"
          >
            <span class="model-select-name">{{ name }}</span>
            <AppIcon v-if="name === current" class="model-select-check" name="check" :size="14" />
          </button>
        </li>
      </ul>
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

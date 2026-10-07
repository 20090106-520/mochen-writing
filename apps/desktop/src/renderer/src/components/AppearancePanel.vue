<!-- 外观设置页（设置浮层的「外观」页签）。
     数据真身在 useAppearanceStore；改任何一项都整份写回 appearance:save，成功才生效。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { Moon, Sun, Monitor } from "lucide";
import { MorphIcon } from "morphicons/vue";
import { APPEARANCE_FONT_FAMILY_LABELS, type AppearanceMode } from "@mochen/contracts";
import { useAppearanceStore } from "../stores/useAppearanceStore";
import { useLayoutStore } from "../stores/layoutStore";
import { findAppearanceSkin } from "../composables/appearanceSkins";
import {
  applyReducedMotion,
  loadReducedMotion,
  motionPreferenceStorage,
  saveReducedMotion
} from "../utils/motion-preference";

const appearance = useAppearanceStore();
const layout = useLayoutStore();

const MODE_OPTIONS: Array<{ value: AppearanceMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" }
];

// morphicons 的变形时刻：一枚图标随显示模式在 显示器/太阳/月亮 之间变形（弹簧物理）。
const MODE_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const modeIcon = computed(() => MODE_ICONS[appearance.settings.mode]);

/** 现在用的是哪一套皮肤的名字。取不到时如实说「未知」而不是静默显示空白——
 *  取不到只有一种情形：盘上存的那个 skin id 不在表里（表被改过、或换了版本）。
 *  那种时候界面必须承认「不认识」，因为用户点「去皮肤广场」之后
 *  在那里看到的会是另一套，而这里什么都不说就成了两处互相矛盾。 */
const currentSkinLabel = computed(() => {
  const skin = findAppearanceSkin(appearance.settings.light.skin);
  return skin ? `${skin.label} · ${skin.tagline}` : "未知的一套（在皮肤广场里挑一个就好）";
});

/** 去皮肤广场。走 layout 真身——左栏那枚钮是同一条通路。 */
function openSkinGallery(): void {
  layout.showCenter("skins");
}

function setMode(mode: AppearanceMode): void {
  void appearance.update({ mode });
}

function setUiFont(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  void appearance.update({ uiFontFamily: value as typeof appearance.settings.uiFontFamily });
}

function setEditorFont(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  void appearance.update({
    editorFontFamily: value as typeof appearance.settings.editorFontFamily
  });
}

// 字号档位：schema 边界 [10,24] 内取常用档；默认 14（界面）/ 13（代码）。
// uiFontSize / codeFontSize / translucentSidebar 住在 light / dark 两套主题里（不在 settings
// 顶层）——写时两套一并应用（与主题配色同款先例），显示读浅色那套；两套恒等，不存在分裂。
const UI_FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20];
const CODE_FONT_SIZE_OPTIONS = [11, 12, 13, 14, 16, 18, 20];

function setUiFontSize(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  void appearance.update({
    light: { ...appearance.settings.light, uiFontSize: value },
    dark: { ...appearance.settings.dark, uiFontSize: value }
  });
}

function setCodeFontSize(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  void appearance.update({
    light: { ...appearance.settings.light, codeFontSize: value },
    dark: { ...appearance.settings.dark, codeFontSize: value }
  });
}

function setTranslucentSidebar(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  void appearance.update({
    light: { ...appearance.settings.light, translucentSidebar: enabled },
    dark: { ...appearance.settings.dark, translucentSidebar: enabled }
  });
}

/**
 * 减少动效（2026-10-05）：偏好住 localStorage（utils/motion-preference），落点是
 * `html[data-reduced-motion]`（motion.css 的总闸）；顺手把本面板那枚 morphicons
 * 的动效档一起切掉，开关当场见效不用重挂。
 */
const reducedMotion = ref(loadReducedMotion(motionPreferenceStorage()));

function setReducedMotion(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  const storage = motionPreferenceStorage();
  if (storage !== null) saveReducedMotion(storage, enabled);
  applyReducedMotion(document.documentElement, enabled);
  reducedMotion.value = enabled;
}

const uiFontOptions = Object.entries(APPEARANCE_FONT_FAMILY_LABELS).filter(([value]) =>
  ["system", "sans", "yuan"].includes(value)
);
const editorFontOptions = Object.entries(APPEARANCE_FONT_FAMILY_LABELS).filter(([value]) =>
  ["song", "kai", "fangsong", "sans", "yuan"].includes(value)
);
</script>

<template>
  <div class="appearance-panel">
    <div class="appearance-field">
      <span class="appearance-field-label appearance-mode-label">
        <!-- stroke-width 对齐全仓 1.8 描边语言（morphicons 默认 2）；动效档跟着「减少动效」走。 -->
        <MorphIcon
          :icon="modeIcon"
          :size="14"
          :stroke-width="1.8"
          :reduced-motion="reducedMotion ? 'always' : 'user'"
        />显示模式
      </span>
      <div class="appearance-segment" role="radiogroup" aria-label="显示模式">
        <button
          v-for="option in MODE_OPTIONS"
          :key="option.value"
          class="appearance-segment-button"
          :class="{ 'is-active': appearance.settings.mode === option.value }"
          type="button"
          role="radio"
          :aria-checked="appearance.settings.mode === option.value"
          @click="setMode(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="appearance-field">
      <span class="appearance-field-label">主题皮肤</span>
      <!-- 【2026-10-07 批次 5-㊴：这里原先摆着一整块配色预设网格，现在退役了】
           皮肤（配色三色 + 质感四层）搬到左栏那枚「皮肤广场」入口后面，
           而那一处才是能改的地方。留两处的话，用户在设置里点了一个皮肤、
           又在广场里换了另一个，两边显示的「当前」会各说各话——
           那是两份真相（铁律 6）。

           这里仍留一枚字钮与一行当前皮肤名：
           ① 用户是从设置里进来的，不给一条路等于把功能藏起来了；
           ② 「现在用的是哪一套」本来就该在外观页看得见，
              它是状态而不是入口——所以它是只读的，不带第二套判定。 -->
      <div class="appearance-current-skin">
        <span class="appearance-current-skin-name">{{ currentSkinLabel }}</span>
        <button class="appearance-current-skin-go" type="button" @click="openSkinGallery">
          去皮肤广场挑
        </button>
      </div>
    </div>

    <label class="appearance-field appearance-select-row">
      <span class="appearance-field-label">界面字体</span>
      <select
        class="appearance-select"
        :value="appearance.settings.uiFontFamily"
        @change="setUiFont($event)"
      >
        <option v-for="[value, label] in uiFontOptions" :key="value" :value="value">
          {{ label }}
        </option>
      </select>
    </label>

    <label class="appearance-field appearance-select-row">
      <span class="appearance-field-label">正文字体（编辑器）</span>
      <select
        class="appearance-select"
        :value="appearance.settings.editorFontFamily"
        @change="setEditorFont($event)"
      >
        <option v-for="[value, label] in editorFontOptions" :key="value" :value="value">
          {{ label }}
        </option>
      </select>
    </label>

    <div class="appearance-field appearance-twin-row">
      <label class="appearance-select-row">
        <span class="appearance-field-label">界面字号</span>
        <select
          class="appearance-select"
          :value="appearance.settings.light.uiFontSize"
          @change="setUiFontSize($event)"
        >
          <option v-for="size in UI_FONT_SIZE_OPTIONS" :key="size" :value="size">
            {{ size }}px
          </option>
        </select>
      </label>
      <label class="appearance-select-row">
        <span class="appearance-field-label">代码字号（对话流）</span>
        <select
          class="appearance-select"
          :value="appearance.settings.light.codeFontSize"
          @change="setCodeFontSize($event)"
        >
          <option v-for="size in CODE_FONT_SIZE_OPTIONS" :key="size" :value="size">
            {{ size }}px
          </option>
        </select>
      </label>
    </div>

    <label class="appearance-field appearance-toggle-row">
      <span class="appearance-field-label">半透明侧栏（毛玻璃）</span>
      <input
        class="appearance-toggle"
        type="checkbox"
        role="switch"
        :checked="appearance.settings.light.translucentSidebar"
        @change="setTranslucentSidebar($event)"
      />
    </label>

    <label class="appearance-field appearance-toggle-row">
      <span class="appearance-field-label">减少动效</span>
      <input
        class="appearance-toggle"
        type="checkbox"
        role="switch"
        :checked="reducedMotion"
        @change="setReducedMotion($event)"
      />
    </label>

    <p v-if="appearance.error" class="appearance-error">{{ appearance.error }}</p>
  </div>
</template>

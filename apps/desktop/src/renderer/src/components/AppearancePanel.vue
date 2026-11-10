<!-- 外观设置页（设置浮层的「外观」页签）。
     数据真身在 useAppearanceStore；改任何一项都整份写回 appearance:save，成功才生效。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { Moon, Sun, Monitor } from "lucide";
import { MorphIcon } from "morphicons/vue";
import {
  APPEARANCE_FONT_FAMILY_LABELS,
  type AppearanceDensity,
  type AppearanceLiquidGlass,
  type AppearanceLiquidGlassIntensity,
  type AppearanceMode
} from "@mochen/contracts";
import { useAppearanceStore } from "../stores/useAppearanceStore";
import { useLayoutStore } from "../stores/layoutStore";
import { findAppearanceSkin, defaultAppearanceSkin } from "../composables/appearanceSkins";
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

/**
 * 现在用的是哪一套皮肤的名字。
 *
 * 【2026-10-08 第二刀之后这里只剩两档】
 * 上一版这里有三级兜底：广场表 → 配色底版表（`appearanceTones`）→ 「未知」，
 * 第二档说的是「素面配色，不在广场里卖（配色照旧能用）」。
 * 用户那句裁定是「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」，
 * 于是那张底版表连同 `themePresets` 投影一起删了，这一档跟着没。
 * 回落挪到了数据层：`useAppearanceStore.load()` 会把盘上那个已经不存在的 id
 * 换成广场第一套（只改内存、不写盘），所以下面第一档今天就应该命中。
 *
 * 【那为什么还留着「未知的一套」】
 * 它是数据层以外那半条路的保险：`settings` 在 load 之前是 contracts 默认值，
 * 而任何一处把陌生 id 带进来时，界面必须承认不认识它，而不是编一个名字。
 * 这一档今天走不到——走不到正是对的，`appearance-panel-wiring.test.ts` 钉着
 * 「不许再 import 已删的那张表」，所以它也不会被复活成第三档。
 */
const currentSkinLabel = computed(() => {
  const found = findAppearanceSkin(appearance.settings.light.skin);
  if (found) return `${found.label} · ${found.tagline}`;
  return "未知的一套（在皮肤广场里挑一个就好）";
});

/**
 * 盘上那套已被删除时多说一句实话。
 *
 * 【为什么不静默换掉就好】
 * 回落换掉的是**人家存的主题**。什么都不说，用户看到的是「我从来没选过皮肤」；
 * 说一句，他就知道是我们删的、现在用的是哪一套、以及想换可以去广场。
 * 措辞刻意带上原 id（`paper` 这种），因为那是他盘上文件的原话，不是我们编的名字。
 *
 * 【为什么写「已经删除」而不是「已下架」】
 * 5-㊷ 那一版说「下架不等于销毁」时它确实还活着；第二刀之后那张表整个没了，
 * 再说「下架」就是把「我们删了」说成「暂时没摆出来」，用户会去广场找它并找不到。
 */
const retiredSkinNote = computed(() => {
  const retired = appearance.replacedSkinId;
  if (retired === null) return null;
  return `你原来存的「${retired}」已经删除——那一套没有画面，不在这批「只保留带画面的皮肤」的名单里。现在用的是${defaultAppearanceSkin.label}，想去广场换一套随时可以。`;
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
 * 界面密度（2026-10-15 Wave 3，出处是设计稿变体 B「密度」）。
 *
 * 【这一档按的是界面 chrome 的节奏，不是正文版式】
 * 导航行、页签、输入卡 chip、工作台卡内距那几族控件各降一档；正文的行距 / 字号 / 列宽
 * 住在「写作」页那三档（`--editor-leading` 等），这里碰一下就成两份真相，
 * 所以「界面密度」这四个字是边界而不是修辞。
 *
 * 【档位住 settings 顶层而不是 light / dark 两套里】
 * 字号那两枚住在两套主题里是因为换皮肤会带着各自的字号走；密度与配色无关，
 * 顶层一枚值就够，也没有「浅色紧凑、深色标准」这种要各自记的分裂态。
 */
const DENSITY_OPTIONS: Array<{ value: AppearanceDensity; label: string }> = [
  { value: "standard", label: "标准" },
  { value: "compact", label: "紧凑" }
];

function setDensity(density: AppearanceDensity): void {
  void appearance.update({ density });
}

/**
 * 液态玻璃材质（2026-11-09）：一层可开关的材质，不是又一套皮肤。
 * `auto` 读皮肤自己的玻璃档——素面皮（`glass: "none"`）在 auto 下就是关的。
 */
const LIQUID_GLASS_OPTIONS: Array<{ value: AppearanceLiquidGlass; label: string }> = [
  { value: "auto", label: "跟随皮肤" },
  { value: "on", label: "开" },
  { value: "off", label: "关" }
];

function setLiquidGlass(liquidGlass: AppearanceLiquidGlass): void {
  void appearance.update({ liquidGlass });
}

/**
 * 玻璃浓度（2026-11-10）：克制=出厂观感，浓郁=网上那种重模糊+高光环的「湿」玻璃。
 * 只在玻璃本体开着时才有意义——关着时这行连 DOM 都不渲染，不摆一个拨不动的钮。
 */
const LIQUID_GLASS_INTENSITY_OPTIONS: Array<{
  value: AppearanceLiquidGlassIntensity;
  label: string;
}> = [
  { value: "calm", label: "克制" },
  { value: "vivid", label: "浓郁" }
];

function setLiquidGlassIntensity(liquidGlassIntensity: AppearanceLiquidGlassIntensity): void {
  void appearance.update({ liquidGlassIntensity });
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
      <!-- 盘上那套已下架时这一行才出现（`replacedSkinId` 非 null）。
           写在名字**下面**而不是替掉名字：屏幕上此刻渲染的确实就是回落后的那一套，
           名字要说真话，那句「你原来存的已经不在了」也要说真话，两句不互相替代。 -->
      <p v-if="retiredSkinNote" class="appearance-retired-skin">{{ retiredSkinNote }}</p>
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

    <div class="appearance-field">
      <span class="appearance-field-label">界面密度</span>
      <div class="appearance-segment" role="radiogroup" aria-label="界面密度">
        <button
          v-for="option in DENSITY_OPTIONS"
          :key="option.value"
          class="appearance-segment-button"
          :class="{ 'is-active': appearance.settings.density === option.value }"
          type="button"
          role="radio"
          :aria-checked="appearance.settings.density === option.value"
          @click="setDensity(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <!-- 那句边界说明要写在屏上：稿子里的「密度」连着把正文列宽从 760 放宽到 820，
         而正文版式在这儿已经有三档（写作页），不写清就会有人以为这一档也管正文。 -->
    <p class="settings-group-note">
      紧凑只把导航行、页签、输入卡与卡片内距各降一档，一屏多看几行；正文的行距、字号与列宽照旧由「写作」页那三档决定。
    </p>

    <div class="appearance-field">
      <span class="appearance-field-label">液态玻璃</span>
      <div class="appearance-segment" role="radiogroup" aria-label="液态玻璃">
        <button
          v-for="option in LIQUID_GLASS_OPTIONS"
          :key="option.value"
          class="appearance-segment-button"
          :class="{ 'is-active': appearance.settings.liquidGlass === option.value }"
          type="button"
          role="radio"
          :aria-checked="appearance.settings.liquidGlass === option.value"
          @click="setLiquidGlass(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <div v-if="appearance.settings.liquidGlass !== 'off'" class="appearance-field">
      <span class="appearance-field-label">玻璃浓度</span>
      <div class="appearance-segment" role="radiogroup" aria-label="玻璃浓度">
        <button
          v-for="option in LIQUID_GLASS_INTENSITY_OPTIONS"
          :key="option.value"
          class="appearance-segment-button"
          :class="{ 'is-active': appearance.settings.liquidGlassIntensity === option.value }"
          type="button"
          role="radio"
          :aria-checked="appearance.settings.liquidGlassIntensity === option.value"
          @click="setLiquidGlassIntensity(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <p class="settings-group-note">
        浓郁档把模糊、高光与边缘那圈亮光整体推上去，是网上流行的那种「湿玻璃」；克制档保持出厂观感。
      </p>
    </div>
    <!-- 边界同样写在屏上：玻璃只给「浮在内容之上」的表面，正文区刻意不玻璃化。
         2026-11-10 补一句指针高光：那一笔是这次「像玻璃」的关键，不写就没人会去试。 -->
    <p class="settings-group-note">
      玻璃只加在输入卡、菜单、检查浮层、对话框、标题带与状态提示上；正文阅读区保持不透明，长文不掉对比度。输入卡上那枚高光会跟着指针走。出厂默认开；选跟随皮肤时，素面皮肤不启用。
    </p>

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

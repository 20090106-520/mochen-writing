<!-- 皮肤广场（中栏 + 右栏一整个页面，2026-10-07 批次 5-㊴ 建，5-㊵ 换了四层）。
     【为什么它是中栏那一格而不是整页】
     与插件/技能那一处同款裁定（5-㉜/5-㉝，用户两次指正）：
     **左栏是恒定的导航轴**，任何时候都不该消失；皮肤广场换的是中栏那一格，
     并吃掉右栏两格（CSS 里 `grid-column: 2 / -1`）。那条裁定与理由不重述。

     【数据流：一条都不许在模板里现算】
     筛选与搜索的判定在 stores/useSkinBrowse.ts，
     四层的换算在 composables/appearanceThemeRuntime.ts 的 skinStyleVariables，
     皮肤表在 composables/appearanceSkins.ts。模板只 v-for、只绑。 -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { useAppearanceStore } from "../stores/useAppearanceStore";
import { useSkinBrowseStore } from "../stores/useSkinBrowse";
import {
  APPEARANCE_BACKDROP_LABELS,
  APPEARANCE_GLASS_LABELS,
  APPEARANCE_GRID_LABELS,
  APPEARANCE_SURFACE_LABELS,
  appearanceSkins,
  type AppearanceSkin
} from "../composables/appearanceSkins";
import { skinStyleVariables } from "../composables/appearanceThemeRuntime";

const layout = useLayoutStore();
const appearance = useAppearanceStore();
const browse = useSkinBrowseStore();

const conditions = computed(() => browse.conditions);
const rows = computed(() => browse.filterRows);
const skins = computed(() => browse.visibleSkins(appearanceSkins));

/** 显示模式：卡片预览要按「用户现在实际看到的那一版」来画，不是永远浅色。
 *  判据是真身在布局 store 那一处（mode 为 system 时跟系统走），
 *  而实际生效的是哪一版由 App.vue 落进 `<html data-theme>`。 */
const prefersDark = ref(document.documentElement.dataset.theme === "dark" ? true : false);
watch(prefersDark, () => undefined);
// 系统跟随时 listen 一次变化就够了：mode 一旦不是 system，就不再跟系统。
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
systemDark.addEventListener("change", (event) => {
  if (appearance.settings.mode === "system") {
    prefersDark.value = event.matches;
  }
});
watch(
  () => appearance.settings.mode,
  (mode) => {
    if (mode !== "system") {
      prefersDark.value = mode === "dark";
      return;
    }
    prefersDark.value = systemDark.matches;
  },
  { immediate: true }
);

/** 一套皮肤的卡片预览块要内联的那份 `--skin-*`。
 *
 *  **必须传齐 accent / ink / paper / scheme**（5-㊵ 扩的四层多了三个吃色相的量）：
 *  玻璃的角落光与对话框的压边都要 accent，图案与对话框底要 ink/paper。
 *  漏传的话色值会算成 NaN，而 CSS 会把整条声明丢掉——
 *  表现是「那一层没生效」，但没有任何报错。 */
function previewStyle(skin: AppearanceSkin): Record<string, string> {
  const tone = toneOf(skin);
  return skinStyleVariables({
    backdrop: skin.backdrop,
    glass: skin.glass,
    surface: skin.surface,
    grid: skin.grid,
    accent: tone.accent,
    ink: tone.foreground,
    paper: tone.background,
    scheme: prefersDark.value ? "dark" : "light"
  });
}

function toneOf(skin: AppearanceSkin) {
  return prefersDark.value ? skin.dark : skin.light;
}

/** 预览块自己的底色/字色。这一层不能靠 CSS 变量：卡片上摆的是**别的那套**皮肤的
 *  颜色，而 `:root` 上那份是「当前生效的」那套。 */
function previewTone(skin: AppearanceSkin): Record<string, string> {
  const tone = toneOf(skin);
  return { background: tone.background, color: tone.foreground };
}

/** 现在用的是哪一套。判定只在这里有一份：浅色那套的 skin 字段。 */
function isActive(skin: AppearanceSkin): boolean {
  return appearance.settings.light.skin === skin.id;
}

/**
 * 换皮肤 = 一次写回三样：skin id、三色、视觉四层，浅深两套一并应用。
 *
 * **为什么必须浅深两套一起写**（与 AppearancePanel 的 applyPreset 同款理由）：
 * 只改一边就会得到「浅色新皮肤、深色旧皮肤」的精神分裂，
 * 而 mode 可以是 system——那就是有一半时间在看不相配的那一版。
 *
 * **字号与半透明侧栏保持现值**（那两项是用户自己调过的偏好，不是皮肤的一部分）。
 */
function applySkin(skin: AppearanceSkin): void {
  const visual = {
    backdrop: skin.backdrop,
    glass: skin.glass,
    surface: skin.surface,
    grid: skin.grid
  };
  void appearance.update({
    light: {
      ...appearance.settings.light,
      preset: skin.id,
      skin: skin.id,
      ...skin.light,
      ...visual
    },
    dark: {
      ...appearance.settings.dark,
      preset: skin.id,
      skin: skin.id,
      ...skin.dark,
      ...visual
    }
  });
}

function backToChat(): void {
  layout.showWorkspace();
}
</script>

<template>
  <section class="skin-gallery" aria-label="皮肤广场">
    <header class="skin-gallery-head">
      <h2 class="skin-gallery-title">皮肤广场</h2>
      <button
        class="icon-button skin-gallery-close"
        type="button"
        aria-label="回到对话"
        title="回到对话"
        @click="backToChat"
      >
        <AppIcon name="close" :size="15" />
      </button>
    </header>

    <div class="skin-gallery-tools">
      <form class="skin-gallery-search" role="search" @submit.prevent="browse.submitSearch()">
        <AppIcon name="search" :size="15" />
        <input
          v-model="conditions.draft"
          type="search"
          class="skin-gallery-search-input"
          placeholder="搜皮肤名、说明或出处"
          aria-label="搜索"
        />
        <button class="skin-gallery-search-go" type="submit">搜索</button>
      </form>

      <!-- 四层筛选。每行一组，组标签占固定宽度让四行的档横向对齐。
           点已选中的那枚 = 收回这一层（判定在 store 的 setFilter 里）。 -->
      <div v-for="row in rows" :key="row.key" class="skin-filter-row">
        <span class="skin-filter-label">{{ row.label }}</span>
        <button
          v-for="value in row.values"
          :key="value"
          class="skin-filter"
          :class="{ 'is-active': row.current === value }"
          :aria-pressed="row.current === value"
          type="button"
          @click="browse.setFilter(row.key, value)"
        >
          {{ row.labels[value] }}
        </button>
      </div>

      <div v-if="browse.hasConditions" class="skin-filter-row">
        <button
          class="skin-filter skin-gallery-clear"
          type="button"
          @click="browse.clearConditions()"
        >
          清空条件
        </button>
      </div>
    </div>

    <div class="skin-gallery-body">
      <p class="skin-gallery-note">
        一套皮肤 = 配色三色 + 视觉四层（背景 / 玻璃 / 表面 / 图案），浅色与深色一并应用。
        带出处的那五条改编自 DeepSeek Harness 的开源换装插件（MIT）：背景、玻璃参数与网格
        都是从上游源码里搬的数值，不是本仓另配的一套。
      </p>

      <p v-if="skins.length === 0" class="skin-gallery-empty">
        没有匹配的皮肤。换个条件，或者点「清空条件」。
      </p>

      <ul v-else class="skin-gallery-grid">
        <li v-for="skin in skins" :key="skin.id" class="skin-card" :style="previewStyle(skin)">
          <!-- 预览块：**真机渲染那一层效果**，不是画个示意图。
               背景层铺在 `skin-card-preview-backdrop` 上（那张卡片的弥散光），
               网格铺在 `skin-card-preview-grid`，玻璃与表面落在前景那两块上——
               与真正应用时 CSS 挂的位置一致，所以卡片上看到的就是换上之后的样子。 -->
          <div class="skin-card-preview" :style="previewTone(skin)">
            <div class="skin-card-preview-backdrop" />
            <div class="skin-card-preview-grid" />
            <div class="skin-card-preview-panel">
              <div class="skin-card-preview-row">
                <span class="skin-card-dot" :style="{ background: toneOf(skin).accent }" />
                <span
                  class="skin-card-bar"
                  :style="{ background: toneOf(skin).accent, flex: '1 1 auto' }"
                />
              </div>
              <div class="skin-card-preview-row">
                <span
                  class="skin-card-bar"
                  :style="{ background: toneOf(skin).foreground, flex: '1 1 60%' }"
                />
                <span
                  class="skin-card-bar"
                  :style="{ background: toneOf(skin).accent, flex: '1 1 30%' }"
                />
              </div>
            </div>
          </div>

          <div class="skin-card-head">
            <div class="skin-card-title">
              <strong :title="skin.id">{{ skin.label }}</strong>
            </div>
            <span v-if="isActive(skin)" class="skin-badge">在用</span>
          </div>

          <p class="skin-card-desc">{{ skin.tagline }}</p>
          <p class="skin-card-origin">{{ skin.origin }} · {{ skin.license }}</p>

          <div class="skin-card-foot">
            <span class="skin-card-feel">
              <span>{{ APPEARANCE_BACKDROP_LABELS[skin.backdrop] }}</span>
              <span>{{ APPEARANCE_GLASS_LABELS[skin.glass] }}</span>
              <span>{{ APPEARANCE_SURFACE_LABELS[skin.surface] }}</span>
              <span>{{ APPEARANCE_GRID_LABELS[skin.grid] }}</span>
            </span>
            <button
              class="skin-btn"
              type="button"
              :disabled="isActive(skin)"
              @click="applySkin(skin)"
            >
              {{ isActive(skin) ? "当前这套" : "换上" }}
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

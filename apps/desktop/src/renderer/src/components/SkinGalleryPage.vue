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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import PageNote from "./PageNote.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { useAppearanceStore } from "../stores/useAppearanceStore";
import { useSkinBrowseStore } from "../stores/useSkinBrowse";
import {
  APPEARANCE_ART_LABELS,
  APPEARANCE_BACKDROP_LABELS,
  APPEARANCE_GLASS_LABELS,
  APPEARANCE_GRID_LABELS,
  APPEARANCE_ORNAMENT_LABELS,
  APPEARANCE_SURFACE_LABELS,
  appearanceSkins,
  defaultAppearanceSkin,
  type AppearanceSkin
} from "../composables/appearanceSkins";
import { skinStyleVariables } from "../composables/appearanceThemeRuntime";
import { patchSettingsWithSkin } from "../composables/appearanceSkinPreview";

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
    art: skin.art,
    ornament: skin.ornament,
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
 *  颜色，而 `:root` 上那份是「当前生效的」那套。
 *
 *  `--window-paper` / `--window-ink` 是给整窗模型（并排对比）那两块面板用的：
 *  真实 CSS 里中栏底读 `--surface-main`、正文线读前景色，而这两枚是**运行时写在 `<html>` 上的**，
 *  并排的两扇窗不可能各自有一份 `<html>`。所以这里在同一处把「这一套的纸色/墨色」
 *  递给模型层，让它走自己那一份——**没有覆写 `--surface-main`**：
 *  覆写一个全局 token 会让这一格里的别的消费（图标、边框）跟着串味，而那不在皮肤的作用范围里。 */
function previewTone(skin: AppearanceSkin): Record<string, string> {
  const tone = toneOf(skin);
  return {
    background: tone.background,
    color: tone.foreground,
    "--window-paper": tone.background,
    "--window-ink": tone.foreground
  };
}

/** 现在用的是哪一套。判定只在这里有一份：浅色那套的 skin 字段。 */
function isActive(skin: AppearanceSkin): boolean {
  return appearance.settings.light.skin === skin.id;
}

/**
 * 换上 = 落盘：走 appearance store 的 update（唯一写者，成功才生效）。
 *
 * **拼法在 `patchSettingsWithSkin` 那一份里**：整窗预览读的是同一个函数，
 * 于是「预览看到的」与「点下换上得到的」不可能长成两套。
 * 浅深两套一并应用、字号与半透明侧栏保持现值——那两条理由都写在那份函数上面。
 */
function applySkin(skin: AppearanceSkin): void {
  void appearance.update(patchSettingsWithSkin(appearance.settings, skin));
  // 预览的那一套一旦真的换上，预览就该退场：留着它，屏幕上会出现两个来源同一套皮肤的样子，
  // 而收条上那句「未落盘」立刻变成假话。
  browse.clearPreview();
}

/** 整窗预览：把这一套刷到屏幕上，但**一个字节都不落盘**。
 *  真身在 App.vue 的 applyTheme —— 它是 `--skin-*` 的唯一作者，这里只写「预览中了哪套」。
 *  再点一次同一枚 = 退出预览。 */
function togglePreview(skin: AppearanceSkin): void {
  browse.togglePreview(skin.id);
}

/** 预览/对比的开合都在 browse store 的 getter 上（`previewSkin` / `isComparing` / `compareSkins`），
 *  模板直接读它们——这里不再包一层 computed，那是同一个事实的第二个名字。 */
function toggleCompare(skin: AppearanceSkin): void {
  browse.toggleCompare(skin.id);
}

/** 离开皮肤广场：预览与对比都收干净（判据与理由在 store 的 leaveGallery 上）。
 *  挂在 onBeforeUnmount 而不是只挂在「回到对话」那枚钮上：从**左栏**切走也是一次离开，
 *  而预览是不落盘的临时刷写——人走了它还留在 `<html>` 上就成了「屏幕一套、设置一套」。 */
onBeforeUnmount(() => {
  browse.leaveGallery();
});

function backToChat(): void {
  layout.showWorkspace();
}
</script>

<template>
  <section class="skin-gallery" aria-label="皮肤广场">
    <header class="skin-gallery-head titlebar-drag titlebar-inset-right">
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
        <!-- 档整组单独一层：折行要发生在「标签右侧那一组」里。让折行落在 `.skin-filter-row`
             本身上，第二行的档会回到组标签左边、跟标签起始位对齐着掉下来；
             包成这一层之后，续行从第一枚档的 x 起排，四行的档仍横向对齐。 -->
        <span class="skin-filter-values">
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
        </span>
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
      <!-- 这段话是**这一页的入场条件**本身，所以它必须逐句对上代码：
           「只收带画的」由 `appearance-skins.test.ts` 那条 `art !== "none"` 钉着；
           「十套素面已删除」是 2026-10-08 用户第二刀的原文裁定，
           上一版这里写的还是「下架不等于销毁：十套出厂配色仍在『设置 · 外观』里作为配色底版可用」，
           那一族已经不存在了，留着这句话就是假话。
           回落点一律写 `defaultAppearanceSkin.label`，**不许写死皮肤名**——
           它是「广场第一套」，将来继续增加带画皮肤时这一句要跟着自己变。

           【第二刀之后这里少了一句什么】
           上一版这里还写着「它们从上游搬来的数值仍留在视觉表里，因为老用户盘上存着那些
           四层取值，运行时还得按原值渲染」。这句在 5-㊷ 是真的（那时只下架条目、不动层值），
           但第二刀的回落走的是 `patchSettingsWithSkin`——它把 `backdrop/glass/surface/grid/art`
           **连同一组三色整份覆写**成广场第一套。也就是说盘上那些老层取值从此不再上屏，
           这句话就成了假话，而它指的事（按原值渲染）在界面上恰好**看不出来**
           （回落后的画面本来就是第一套的样子，谁也不会去对旧层值）。
           ⇒ 所以这句从用户可见文案里删掉。数值表与枚举**为什么还留着**上游那些档名，
             真实理由只剩一条：过不了 zod 就整份退默认（`appearance-store.test.ts` 那条），
             连「哪一套被换掉了」这句都说不成——那条理由写给维护者，归代码注释，
             并由 `appearance-skins.test.ts` 的「老层取值仍解析得动」钉住。

           【为什么切成四段，而不是一段长文】
           prettier 会把 `<p>` 里的长串中文按 printWidth **折行并在折点补一个空格**，
           而浏览器把那个换行当真空格画出来——上一版就在这里画出了「』。 「设置 ·
           外观」这种半角空格，还把「设置 · 外观」这个书名号词拦腰截断。
           切成短句之后每段都在一行以内，页面看到的与源码写的就是同一句；
           `appearance-skin-plaza-wiring.test.ts` 里那三条逐句断言也才钉得住
           （它原先读的是整段原文，折点一挪就红，而红的原因是排版不是文案）。

           【2026-11-12：整段收进 `<PageNote>` 折叠条】
           真机量过：这九段合计 246.6px，902px 高的窗口里卡片网格要等到 y=670 才开始，
           首屏只看得到一排卡。说明本身没错，错在它**一直摊开展厅门口**。
           现在收起后只占一行，展开态与原来逐字一致（正文段落一个都没动，类名也没改，
           上面那几条守卫读源码照样读得到）。
           第一句「一套 = 配色三色 + 视觉四层 + 一层画面 + 一枚挂件」搬去当了折叠条的标题——
           它是这一页最该被看见的一句，收起时也该在屏幕上，而不是要用户先点一下才看得到。 -->
      <PageNote summary="一套皮肤 = 配色三色 + 视觉四层 + 一层画面 + 一枚挂件">
        <p class="skin-gallery-note">视觉四层是背景 / 玻璃 / 表面 / 图案，浅色与深色一并应用。</p>
        <p class="skin-gallery-note">
          画面是盖满整窗的那张画，挂件是窗角那一枚小件——两样不是一回事，每套各有一份。
        </p>
        <p class="skin-gallery-note">十六套的四层与挂件两两不同，不只换画。</p>
        <p class="skin-gallery-note">上一批那五条改编自上游的开源换装插件（MIT），搬的都是参数。</p>
        <p class="skin-gallery-note">换上去读起来仍然只是「换了个色调」。</p>
        <p class="skin-gallery-note">
          那五条与原先十套<strong>没有画面的出厂配色，已经整套删除</strong>。
        </p>
        <p class="skin-gallery-note">
          盘上存着它们的，打开会自动回到这里的『{{ defaultAppearanceSkin.label }}』。
        </p>
        <p class="skin-gallery-note">「设置 · 外观」那一页会说明是哪一套被换掉了。</p>
      </PageNote>

      <!-- 并排对比：勾满两套才出现。每一块都是**一整扇窗**的模型（三栏 + 五层），
           不是把卡片放大——要对比的正是「整窗换上之后各是什么样子」。
           五层各落在与真正应用时相同的那几个类上（backdrop / art / grid / 玻璃 / 表面），
           所以这里看到的与换上之后是同一套换算，不是一张示意图。 -->
      <div v-if="browse.isComparing" class="skin-compare">
        <div class="skin-compare-head">
          <strong>并排对比</strong>
          <span class="skin-compare-hint"
            >勾第三套会换掉最早那一套；两块并排才看得出玻璃与画面的差别</span
          >
          <button class="skin-btn" type="button" @click="browse.clearCompare()">收起</button>
        </div>
        <div class="skin-compare-pair">
          <figure
            v-for="skin in browse.compareSkins"
            :key="skin.id"
            class="skin-compare-item"
            :style="previewStyle(skin)"
          >
            <div class="skin-window" :data-skin-art="skin.art" :style="previewTone(skin)">
              <div class="skin-window-backdrop" />
              <div class="skin-window-art" />
              <div class="skin-window-grid" />
              <div class="skin-window-ornament" />
              <div class="skin-window-nav" />
              <div class="skin-window-main">
                <span class="skin-window-bar" :style="{ background: toneOf(skin).accent }" />
                <span class="skin-window-line" />
                <span class="skin-window-line" />
                <span class="skin-window-line is-short" />
              </div>
              <div class="skin-window-side" />
            </div>
            <figcaption class="skin-compare-name">
              {{ skin.label }}
              <span class="skin-compare-tag">{{ APPEARANCE_ART_LABELS[skin.art] }}</span>
            </figcaption>
          </figure>
        </div>
      </div>

      <p v-if="skins.length === 0" class="skin-gallery-empty">
        没有匹配的皮肤。换个条件，或者点「清空条件」。
      </p>

      <ul v-else class="skin-gallery-grid">
        <!-- 卡片**本体**不吃 `previewStyle`：那套 token 里有一条 `--skin-glass-card-fill`，
             而 `.skin-card` 的背景正是它（theme-runtime.css 那条玻璃规则）。
             挂在 `<li>` 上 = 把「候选那套」的卡面铺到**装着页面字色的那一片**上，
             于是浅色模式下四套夜皮的卡面合成出 `rgb(143,161,168)` 这一档中间灰，
             而卡上的说明/出处还是页面的 `--text-secondary/tertiary`（`rgb(80,107,120)`）——
             2026-10-08 真机 6×6 无损采样量到 **2.11 / 2.08:1**，AA 要 4.5，整片读不清。
             候选皮肤的颜色只留给预览块（下面那层，本来就该它管），
             卡片其余部分跟着**当前生效**的那套走：字与底同源，静态守卫算的才等于屏幕上画的。 -->
        <li v-for="skin in skins" :key="skin.id" class="skin-card">
          <!-- 预览块：**真机渲染那一层效果**，不是画个示意图。
               背景层铺在 `skin-card-preview-backdrop` 上（那张卡片的弥散光），
               网格铺在 `skin-card-preview-grid`，玻璃与表面落在前景那两块上——
               与真正应用时 CSS 挂的位置一致，所以卡片上看到的就是换上之后的样子。 -->
          <div class="skin-card-preview" :style="{ ...previewStyle(skin), ...previewTone(skin) }">
            <div class="skin-card-preview-backdrop" />
            <div class="skin-card-preview-art" />
            <div class="skin-card-preview-grid" />
            <div class="skin-card-preview-ornament" />
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
              <span>{{ APPEARANCE_ART_LABELS[skin.art] }}</span>
              <span>{{ APPEARANCE_BACKDROP_LABELS[skin.backdrop] }}</span>
              <span>{{ APPEARANCE_GLASS_LABELS[skin.glass] }}</span>
              <span>{{ APPEARANCE_SURFACE_LABELS[skin.surface] }}</span>
              <span>{{ APPEARANCE_GRID_LABELS[skin.grid] }}</span>
              <span>{{ APPEARANCE_ORNAMENT_LABELS[skin.ornament] }}</span>
            </span>
            <button
              class="skin-btn"
              type="button"
              :aria-pressed="browse.previewId === skin.id"
              @click="togglePreview(skin)"
            >
              {{ browse.previewId === skin.id ? "退出预览" : "整窗预览" }}
            </button>
            <button
              class="skin-btn"
              type="button"
              :aria-pressed="browse.compareIds.includes(skin.id)"
              @click="toggleCompare(skin)"
            >
              {{ browse.compareIds.includes(skin.id) ? "移出对比" : "对比" }}
            </button>
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

    <!-- 整窗预览的收条：预览中**一定**要有这一条，而且必须说清「还没落盘」。
         没有它，用户看到的是一整扇换了皮肤的窗，而设置里一个字都没写——
         他会以为已经换上了，关掉广场才发现没换。
         两个出口都在条上：「换回去」只退预览，「就用它」把这一套真的写进设置。
         Esc 走的是同一条（收最外那一层，见 escape-policy 的 close-skin-overlay）。 -->
    <div v-if="browse.previewSkin" class="skin-preview-bar" role="status" aria-live="polite">
      <span class="skin-preview-label">
        正在预览「{{ browse.previewSkin.label }}」——整窗效果，<strong>还没保存</strong>
      </span>
      <span class="skin-preview-actions">
        <button class="skin-btn" type="button" @click="browse.clearPreview()">换回去</button>
        <button class="skin-btn is-primary" type="button" @click="applySkin(browse.previewSkin)">
          就用它
        </button>
      </span>
    </div>
  </section>
</template>

// 结构出处见 docs/ATTRIBUTION.md。
// 仅把 @deepwrite/contracts/renderer 换成 @mochen/contracts。

import {
  APPEARANCE_ARTS,
  APPEARANCE_BACKDROPS,
  APPEARANCE_FONT_SIZE_LIMITS,
  APPEARANCE_GLASSES,
  APPEARANCE_GRIDS,
  APPEARANCE_ORNAMENTS,
  APPEARANCE_SURFACES,
  createDefaultAppearanceTheme,
  resolveAppearanceEditorFontStack,
  resolveAppearanceUiFontStack,
  type AppearanceColorScheme,
  type AppearanceDensity,
  type AppearanceEditorFontSelection,
  type AppearanceLiquidGlass,
  type AppearanceThemeConfig,
  type AppearanceUiFontSelection
} from "@mochen/contracts";

/* 颜色换算的真身在 appearanceColor.ts。这里 import 供本文件用，并 re-export 出去，
   让既有调用方（守卫的 __testingMixRgba 等）**一行都不用改**。
   依赖方向因此是单向的：appearanceColor ← appearanceThemeRuntime ← appearanceSkinVisual。 */
import { hexToRgb, mix, mixChannels, mixHex, mixRgba, rgba } from "./appearanceColor";
import { liquidGlassMaterial } from "./appearanceLiquidGlass";
export { mixChannels, mixHex, mixRgba, rgba };

export const FONT_SIZE_LIMITS = APPEARANCE_FONT_SIZE_LIMITS;

/* ── `themePresets` 已随「素面配色」那一族一起删除（2026-10-08 第二刀） ──────
   【它原先是什么】批次 5-⑧ 起的一张「只有三色的主题配色预设」表，
   5-㊴ 改成从皮肤表按出处筛，5-㊷ 改成从 `appearanceTones.ts` 那十套底版投影。
   【为什么这次不是换投影源而是整族删掉】
   用户那句裁定是「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」。
   `themePresets` 按定义就是「只有三色、没有画面」的那一族——
   换任何投影源都还是在实现那句被推翻的安排。
   而且它**在界面上没有一处入口**：5-㊴ 把外观页那块配色网格退役之后，
   全仓消费者只剩守卫自己（`grep -rn themePresets` 当时只剩 .test.ts 与本文件）。
   ⇒ 一份没人读、内容又是用户明确不要的表，删。
   【删掉之后那些守卫去哪儿】
   可读性（正文 ≥ 7:1、按钮字 ≥ 4.5:1、accent ≥ 2.5:1、深色不纯黑、深浅不许做成同一套）
   全部**重指到皮肤表**——见 `appearance-theme-readability.test.ts`，
   那边现在遍历 `appearanceSkins` 并先钉「表非空」；
   「出厂默认 = 广场第一套」的逐字段对照在 `appearance-skins.test.ts` 的
   「出厂默认 · 只能是广场里那套带画的皮肤」那一组。
   （**重指而不是删松**：本仓的口径是删掉一条守卫要写清楚它钉的那件事由谁接着钉。） */

export function defaultAppearanceTheme(scheme: AppearanceColorScheme): AppearanceThemeConfig {
  return createDefaultAppearanceTheme(scheme);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function sanitizeFontSize(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number }
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= limits.min &&
    value <= limits.max
    ? Math.round(value * 2) / 2
    : fallback;
}

/**
 * 四层的 sanitize：取值必须落在 contracts 的枚举里，否则退回出厂值。
 *
 * **为什么不用 `includes()` 就完事**：那需要一个字符串数组，而那份数组的真身在
 * contracts 里（`APPEARANCE_BACKDROPS` 等）。在这里另写一份字面量，
 * 就是同一份清单写两遍——加一档时改了一处漏了另一处，
 * 漏的那一处会静默地把所有新档判成「非法、退回平涂」（铁律 6）。
 */
function sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function sanitizeAppearanceTheme(
  value: unknown,
  scheme: AppearanceColorScheme
): AppearanceThemeConfig {
  const fallback = defaultAppearanceTheme(scheme);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<AppearanceThemeConfig>;
  return {
    preset: typeof candidate.preset === "string" ? candidate.preset : fallback.preset,
    skin: typeof candidate.skin === "string" ? candidate.skin : fallback.skin,
    accent: isHexColor(candidate.accent) ? candidate.accent.toUpperCase() : fallback.accent,
    background: isHexColor(candidate.background)
      ? candidate.background.toUpperCase()
      : fallback.background,
    foreground: isHexColor(candidate.foreground)
      ? candidate.foreground.toUpperCase()
      : fallback.foreground,
    uiFontSize: sanitizeFontSize(
      candidate.uiFontSize,
      fallback.uiFontSize,
      FONT_SIZE_LIMITS.uiFontSize
    ),
    codeFontSize: sanitizeFontSize(
      candidate.codeFontSize,
      fallback.codeFontSize,
      FONT_SIZE_LIMITS.codeFontSize
    ),
    translucentSidebar:
      typeof candidate.translucentSidebar === "boolean"
        ? candidate.translucentSidebar
        : fallback.translucentSidebar,
    backdrop: sanitizeEnum(candidate.backdrop, APPEARANCE_BACKDROPS, fallback.backdrop),
    glass: sanitizeEnum(candidate.glass, APPEARANCE_GLASSES, fallback.glass),
    surface: sanitizeEnum(candidate.surface, APPEARANCE_SURFACES, fallback.surface),
    grid: sanitizeEnum(candidate.grid, APPEARANCE_GRIDS, fallback.grid),
    art: sanitizeEnum(candidate.art, APPEARANCE_ARTS, fallback.art),
    ornament: sanitizeEnum(candidate.ornament, APPEARANCE_ORNAMENTS, fallback.ornament)
  };
}

/** WCAG 相对亮度：sRGB 八位 → 线性化 → 加权。守卫也用它判「深色版够暗、浅色版够亮」。 */
export function relativeLuminance(hex: string): number {
  const [r8, g8, b8] = hexToRgb(hex);
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r8) + 0.7152 * lin(g8) + 0.0722 * lin(b8);
}

/** WCAG 对比度，1 ~ 21。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ACCENT_TEXT_LIGHT = "#FFFFFF";
const ACCENT_TEXT_DARK = "#17191C";

/**
 * accent 上那行字用白还是用深色。
 *
 * **2026-10-06 换掉了魔法阈值**：原来按感知亮度 158 二选一
 * （`(r*299 + g*587 + b*114)/1000 > 158`），量出来有三处不合格，而且**两处就在出厂默认里**：
 * Codex 浅色的白字压 `#339CFF` 只有 2.86:1、暖纸浅色 4.19:1，都不到 AA 的 4.5:1。
 * 感知亮度那条公式对**蓝色系统性地高估**——蓝在亮度里权重只有 0.114，
 * 于是「挺亮的蓝」被判成该用深字，落到白字上就花了。
 *
 * 改成**两个候选各算一遍对比度，谁高用谁**：这不依赖任何阈值，
 * 将来调 accent 也不会再出现「阈值没错但结果不可读」。
 */
function readableAccentText(hex: string): string {
  const onLight = contrastRatio(hex, ACCENT_TEXT_LIGHT);
  const onDark = contrastRatio(hex, ACCENT_TEXT_DARK);
  return onLight >= onDark ? ACCENT_TEXT_LIGHT : ACCENT_TEXT_DARK;
}

/**
 * 同一个判定，导出一份给守卫用（2026-10-06 批次 5-⑧）。
 *
 * **为什么要有这个别名**：配色可读性那条守卫要验「按钮上那行字读不读得清」，
 * 而那行字是 `readableAccentText` 挑的。守卫里**重新实现一遍**等于出现第二份判定
 * （铁律 6）——它会跟着主实现漂移，主实现改了阈值守卫还按旧的算，结论全错。
 * 这里只是把私有函数原样再导出一份，没有第二份逻辑。
 */
export { readableAccentText as readableAccentTextForTest };

/* 视觉四层（背景 / 玻璃 / 表面 / 图案 → `--skin-*`）搬到 appearanceSkinVisual.ts 了。
   理由与那边的文件头一致：行数预算 + 那些是**要跟上游对账**的常量，不该与主题上色混在一处。
   这里 re-export 是为了**既有调用方一行都不用改**（皮肤广场的 .vue 与守卫都从这里 import）。 */
import { skinStyleVariables } from "./appearanceSkinVisual";
export { skinStyleVariables };

/**
 * 表面阶梯第四级（卡片）与**次要文字**的混合系数——从上面那个 `setProperty` 循环里拎出来做成常量，
 * 只有一个理由：可读性守卫要按**应用自己那一份**算，系数写在调用行里，守卫就只能重抄一遍数字，
 * 那正是铁律 6 禁的「同一判定两份实现」。
 *
 * ## 为什么浅色的次要文字是 0.71 而不是原来的 0.67
 *
 * 2026-10-08 波3 补漏那轮真机量出来的（`.superpowers/sdd/tmp-w3-contrast.mjs`：
 * 把字设成 transparent、在字原本所在的方块中心取 6×6 无损 PNG 采样，拿到**真正垫在字底下的颜色**）：
 *
 * - 「汐·昼阁」整窗预览时，广场卡说明（`.skin-card-desc`，`color: var(--text-secondary)`）
 *   实测字色 `rgb(89,115,127)` 压在采样底 `rgb(218,238,242)` 上，**对比度 4.18:1**；
 * - 把广场页底色钉回放行前那一档实底再量，是 **4.33:1**——
 *   也就是说这不到 AA（4.5:1）不是「带画才放行」带来的，掉幅只有 3.5%，**是系数本身就浅**；
 * - 静态按同一公式扫一遍 12 组浅色（10 套出厂底版 + 广场两套），对卡面不到 4.5 的有三组：
 *   汐·昼阁 4.33、墨宸·青金 4.42、tone-03 4.47。
 *
 * 提到 **0.71** 之后：12 组浅色对页底最低 5.11、对卡面最低 4.88。
 * 之所以要留到 4.88 而不是刚好 4.5：真机采样比静态算出来的低一档（画层 + 那层纱 + 阅读区放行
 * 会把垫底压暗，实测差 0.15～0.37），刚好 4.5 的静态值一上真机就破线。
 *
 * ## 2026-10-22 注：放行档已从 52% 收到 76%（广场 84%）
 *
 * 用户反馈明亮插画下整片阅读区泛光、小灰字读不出来。收档之后垫底更实，
 * 上面那条「真机比静态低 0.15～0.37」的余量只会更宽松，不再反过来咬这条线。
 * 档位与判据的唯一出处仍在 theme-runtime.css 那段注释里，这里只留这句交代。
 *
 * ## 深色为什么**不跟着动**
 *
 * 0.72 在 12 组深色上对卡面最低 6.36，本来就过线。为了「两边对称」去改一个没坏的数，
 * 是把守卫变成装饰。
 *
 * ## 这次**没**顺手改的那一处（要单独定线，别混在这个数里）
 *
 * ⚠ 下面这段的**病因判断已经作废**（2026-10-12 推翻，看紧跟着的那一节），留着只因为
 * 那两个数字（4.38 / 4.09）仍是量对了的——错的是「要动阶梯」那句结论。
 *
 * 次要文字压在 `--surface-hover`（浅 0.085）/ `--surface-selected`（浅 0.12）上时，
 * 0.71 仍只有 4.38 / 4.09。病因在**表面阶梯一层比一层深**，不在文字色——
 * 要修得动阶梯（或让 hover 换字色），那是全站列表的事，另开一条。
 *
 * （原先这里还挂着第二处「`--text-tertiary` 浅 0.5 对页底最低 2.87、对卡面 2.74，未定线」——
 * 同日下一轮解决了，推导与影响面见下面的 `TERTIARY_TEXT_MIX`，判据在皮肤守卫里。）
 *
 * ## 2026-10-12 清单第 4 项：那条「另开一条」开了，结论与上面这句话不一样
 *
 * 上面写的「病因在阶梯」当场量过就站不住：把 16 组（八套皮肤 × 明暗）逐档算完，
 * 阶梯对**正文档**全员 ≥ 7.60（最低那一格是深底 `selected`，「汐 · 昼阁」），它没病；
 * 有病的是「灰字落进状态档」这件事本身——浅底上 0.71 的灰要过 4.5，深度上限只有 **0.068**，
 * 要按上一轮那条「留 0.2 留量」的口径回到 4.7，上限只剩 **0.048**，
 * 而 `--surface-muted` 自己就已经是 0.045，`hover` 0.085 与 `selected` 0.12 都在上限之外。
 * 两个上限都取 16 组里最紧的那一套（浅底 binding 全是「汐 · 昼阁」）。
 * ⇒ **浅色不可能同时拥有五档阶梯与「灰字压在最深两档上达标」**，这不是系数能调出来的。
 *
 * 所以修的是用法而不是数字：状态档（`hover` / `selected`）一出现，那一块子树里的灰字
 * 升到 `--text-on-state`（浅 0.78 / 深 0.80）。这正是上面那句「或让 hover 换字色」里
 * 的第二条路，也是 `theme-runtime.css:118-135` 早就在给几族做的事（`background: 深档 +
 * color: 正文`），只是那里只管元素自己、管不到 `small` / `kbd` / `.xxx-hint` 这些后代。
 * 后代管得到的原因是**自定义属性会连子树一起继承**：在状态那条规则里 shadow 一次
 * `--text-secondary`，子树里所有 `var(--text-secondary)` 当场改口（实现见样式表，
 * 判据在 `appearance-surface-ladder.test.ts`）。
 */
/**
 * 表面阶梯五档的深度（纸色往墨色走多少）。这五行原先是 `setProperty` 调用行里的裸字面量，
 * 拎出来做成常量的理由与 `SECONDARY_TEXT_MIX` 同一条：守卫要按**应用自己这一份**算，
 * 系数留在调用行里，守卫就只能重抄数字（铁律 6）。
 *
 * 拎出来还多出一样东西：**这一张表现在是「谁能把谁当底」的判据本体**。
 * 16 组（八套皮肤 × 明暗）逐档量完的结论写在下面 `ON_STATE_TEXT_MIX` 那段，
 * 一句话版：浅 0.045 与深 0.09 这两档以下，灰字（0.71 / 0.72 / 深 0.62）处处 ≥ 4.5；
 * `hover` 与 `selected` 这两档是**状态档**，灰字压上去必掉线。
 * 所以这两档在样式表里的角色被钉成一条律——**画了状态档底，就得同时把那族灰字升档**，
 * 由 `appearance-surface-ladder.test.ts` 逐条普查（清单第 4 项）。
 */
export const SURFACE_LADDER_MIX = {
  raised: { light: 0.018, dark: 0.055 },
  card: { light: 0.028, dark: 0.075 },
  muted: { light: 0.045, dark: 0.09 },
  hover: { light: 0.085, dark: 0.14 },
  selected: { light: 0.12, dark: 0.2 }
} as const;
/** 状态档底上唯一安全的那一档灰。名字与 `--text-*` 同族，消费形状是「深档那条规则里 shadow 掉本族的 `--text-secondary`」。 */
export const ON_STATE_TEXT_MIX = { light: 0.78, dark: 0.8 } as const;

export const SURFACE_CARD_MIX = SURFACE_LADDER_MIX.card;
export const SECONDARY_TEXT_MIX = { light: 0.71, dark: 0.72 } as const;
/**
 * 第三级文字（`--text-tertiary`）的混合系数。先做成常量、由守卫按**应用自己这一份**算，
 * 理由与 `SECONDARY_TEXT_MIX` 一模一样：系数留在 `setProperty` 那行里，守卫就只能重抄数字。
 *
 * ## 2026-10-08：浅 0.50 → 0.71、深 0.52 → 0.62
 *
 * 起点还是那条红：新守卫第一次跑就报「汐 · 昼阁 · light：第三级文字 #7d949f / 页底 #E8F6FA
 * 只有 2.87:1」——与上一轮真机量到并写在注释里的那个数**逐位对上**，说明这次不再是"知道但没拦"。
 *
 * ## 为什么浅色干脆提到与次要同级（0.71），而不是折中一个 0.66
 *
 * 把 0.48–0.72 逐档在八套皮肤上算过页底与卡面两个面（完整阶梯在 `appearance-skins.test.ts`
 * 那条守卫的注释里）。浅色四套里最紧的是「汐·昼阁」：
 *
 * | 系数 | 对页底 | 对卡面 |
 * | --- | --- | --- |
 * | 0.66 | 4.41 | 4.21 |
 * | 0.69 | 4.82 | 4.60 |
 * | 0.71 | 5.11 | 4.88 |
 *
 * 过 4.5 至少要 0.69，而真机采样比静态还要低 0.15~0.37（画层 + 那层纱把垫底压暗，上一轮实测），
 * 0.69 那一档上了真机就回到 4.2~4.4 一线——**仍然是不到线**。于是只剩两条路：
 * 要么接受浅色第三级仍然不达标，要么把它钉到 0.71。
 *
 * 选后者，并且**明说这不是"折中成功"**：浅底上"比次要更浅的灰"这个机制本身有上限——
 * 再浅一点就直接贴回底色。硬留一个 0.69 vs 0.71 的差，屏幕上是 4 个亮度点，
 * 读的人看不出来，代码里却要多维护一档假层级。所以浅色这一档**不靠色，靠字号与位置**；
 * 深色八套在 0.62 就能全员 ≥ 页 5.97 / 卡 4.94，而次要是 0.72，层级留得住，就留着。
 *
 * ## 影响面（别把它当"只改了广场"）
 *
 * `var(--text-tertiary)` 87 处 + 走别名 `var(--text-dim)` 43 处 = 130 处消费点，
 * 分布在 14 个样式/组件文件（卡脚元信息、时间戳、字数统计、面板副标题那一类小字）。
 * 浅色皮肤下这 130 处会一起变深一档——这是有意的：它们本来就虚到读不清。
 *
 * ## 想给浅色把层级买回来，正确的入口不在这儿
 *
 * 那是**每套皮肤自带一个第三级色值**的事：契约加字段、皮肤表八套各补一个值、守卫改判那个值。
 * 别回来动这个混色系数——它已经处在"再动就重新掉线"的位置上了。
 */
export const TERTIARY_TEXT_MIX = { light: 0.71, dark: 0.62 } as const;

export function applyAppearanceThemeToDocument(input: {
  scheme: AppearanceColorScheme;
  theme: AppearanceThemeConfig;
  uiFontFamily: AppearanceUiFontSelection;
  editorFontFamily: AppearanceEditorFontSelection;
  density: AppearanceDensity;
  liquidGlass: AppearanceLiquidGlass;
}): void {
  const { scheme, theme } = input;
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.style.colorScheme = scheme;
  /* 界面密度（2026-10-15 Wave 3）：这一行写的就是 `styles/density.css` 那条总闸读的
     属性（`html[data-density="compact"]`）。标准档也照样写、不摘属性：
     属性值恒等于设置值，切回来靠值变回 `standard`，而不是靠「if 才写、else 才删」那半边分支。 */
  root.dataset.density = input.density;

  /* 视觉四层。先于颜色写：卡面与边框的观感由它们决定，
     而它们的浓度又依赖 accent/foreground——那两组在下面立刻就写。
     图案底色取主题前景色：图案要长在自己的色系上，
     暖纸那套的图案就该是暖的，青金那套就该偏青。

     **这一族是循环 setProperty 的，名字在 `skinStyleVariables()` 那个对象里**——
     于是 `theme-token-guard.test.ts` 的两条正则（`setProperty("--x"` 与
     顶格 `"--x":`）都扫不到它们，会把这一族整族报成「消费了却从没定义」。
     那张表在 `appearanceSkinVisual.ts`，而守卫只读本文件。

     ⇒ 这里把这一族的**名字**在本文件列一遍：既让守卫扫得到，
       也让「本文件到底往 <html> 上写了哪些 token」在一处可读。
     只列名字不参与运行时——真正写进去的还是上面那个循环（**值的真身只有一处**）。 */
  const skinTokenNames = [
    "--skin-backdrop",
    "--skin-art-image",
    "--skin-art-veil",
    "--skin-ornament-image",
    "--skin-ornament-size",
    "--skin-glass-blur",
    "--skin-glass-alpha",
    "--skin-glass-saturate",
    "--skin-glass-sidebar-blur",
    "--skin-glass-sidebar-alpha",
    "--skin-glass-sidebar-content-alpha",
    "--skin-glass-floater-blur",
    "--skin-glass-floater-alpha",
    "--skin-glass-capsule-blur",
    "--skin-glass-sheen",
    "--skin-glass-sidebar-fill",
    "--skin-glass-card-fill",
    "--skin-radius-sm",
    "--skin-radius-md",
    "--skin-radius-lg",
    "--skin-surface",
    "--skin-grid-image",
    "--skin-grid-blend",
    "--skin-dialogue-gradient",
    "--skin-dialogue-underline"
  ] as const;
  const skinTokens = skinStyleVariables({
    backdrop: theme.backdrop,
    glass: theme.glass,
    surface: theme.surface,
    grid: theme.grid,
    art: theme.art,
    ornament: theme.ornament,
    accent: theme.accent,
    ink: theme.foreground,
    paper: theme.background,
    scheme,
    // 「半透明侧栏」折进 token，而不是留给 CSS 用 data 属性判 ——
    // CSS 那边那条规则与皮肤那条同特异性且写在后面，永远赢（见 theme-runtime.css 那段注释）。
    translucentSidebar: theme.translucentSidebar
  });
  for (const name of skinTokenNames) {
    root.style.setProperty(name, skinTokens[name] ?? "none");
  }
  root.dataset.skinSurface = theme.surface;
  root.dataset.skinArt = theme.art;

  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-contrast", readableAccentText(theme.accent));
  root.style.setProperty("--accent-soft", rgba(theme.accent, scheme === "dark" ? 0.18 : 0.12));
  root.style.setProperty("--theme-background", theme.background);
  root.style.setProperty("--theme-foreground", theme.foreground);
  root.style.setProperty("--surface-main", theme.background);
  root.style.setProperty(
    "--surface-raised",
    mix(theme.background, theme.foreground, SURFACE_LADDER_MIX.raised[scheme])
  );
  root.style.setProperty(
    "--surface-muted",
    mix(theme.background, theme.foreground, SURFACE_LADDER_MIX.muted[scheme])
  );
  root.style.setProperty(
    "--surface-hover",
    mix(theme.background, theme.foreground, SURFACE_LADDER_MIX.hover[scheme])
  );
  root.style.setProperty(
    "--surface-selected",
    mix(theme.background, theme.foreground, SURFACE_LADDER_MIX.selected[scheme])
  );
  /* 表面阶梯的第四级：卡片比 --surface-raised 再高半级。此前卡片与编辑区同用 raised，
     又只靠 1px 描边区分，整屏所有东西挤在同一高度上（"干净但没感觉"的来源）。 */
  root.style.setProperty(
    "--surface-card",
    mix(theme.background, theme.foreground, SURFACE_CARD_MIX[scheme])
  );
  /* 阴影色按明暗分家：暗色下 foreground 接近白（#F3F4F6 之类），拿它混出来的"阴影"
     是一圈发光而不是纵深。深色用纯黑压，浅色才用前景色压。 */
  const shadow = scheme === "dark" ? "rgb(0 0 0 / 0.55)" : rgba(theme.foreground, 0.16);
  root.style.setProperty("--shadow-color", shadow);
  root.style.setProperty("--shadow-sm", `0 1px 2px ${shadow}`);
  root.style.setProperty("--shadow-md", `0 3px 12px -2px ${shadow}, 0 1px 2px ${shadow}`);
  root.style.setProperty("--shadow-lg", `0 16px 40px -10px ${shadow}, 0 3px 10px ${shadow}`);
  root.style.setProperty(
    "--theme-line",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.2 : 0.14)
  );
  root.style.setProperty(
    "--theme-line-soft",
    mix(theme.background, theme.foreground, scheme === "dark" ? 0.13 : 0.075)
  );
  root.style.setProperty("--text-primary", theme.foreground);
  root.style.setProperty(
    "--text-secondary",
    mix(theme.background, theme.foreground, SECONDARY_TEXT_MIX[scheme])
  );
  root.style.setProperty(
    "--text-tertiary",
    mix(theme.background, theme.foreground, TERTIARY_TEXT_MIX[scheme])
  );
  /* 状态档底（`--surface-hover` / `--surface-selected`）上唯一达标的那一档灰。
     它**不是**第四个文字层级：0.78 / 0.80 比次要还深，浅底上几乎没有「层级」可读，
     它只干一件事——让「深档底 + 灰字」这一族组合在按下/hover/选中时回到 AA。
     消费它的写法是在状态那条规则里 shadow 本族的 `--text-secondary`（见样式表普查守卫），
     所以这一枚必须跟着主题重算，不能写成样式表里的常量。 */
  root.style.setProperty(
    "--text-on-state",
    mix(theme.background, theme.foreground, ON_STATE_TEXT_MIX[scheme])
  );

  /**
   * 【2026-11-09 液态玻璃材质】
   *
   * 参数全部由 `appearanceLiquidGlass.ts` 现算（按这套皮肤的背景/前景/强调色与玻璃档），
   * 本文件只负责把 `--lg-*` 这一族写到 `<html>` 上，并落一个 `data-liquid-glass` 总闸。
   *
   * **为什么写属性、不只是写 token**：样式表里那一族规则挂在
   * `html[data-liquid-glass="on"]` 下面，关掉时**连选择器都不命中**——
   * 比逐条 `backdrop-filter: none` 干净，也不会因为某条规则漏写而半开半关。
   *
   * 这里刻意逐条 `setProperty("--lg-…"`，而不是循环写对象：
   * `theme-token-guard.test.ts` 静态扫的就是这个形状，名字写在明面上才扫得到。
   */
  const glass = liquidGlassMaterial({
    setting: input.liquidGlass,
    glass: theme.glass,
    accent: theme.accent,
    background: theme.background,
    foreground: theme.foreground
  });
  root.dataset.liquidGlass = glass.enabled ? "on" : "off";
  root.style.setProperty("--lg-fill", glass.fill);
  root.style.setProperty("--lg-sheen", glass.sheen);
  root.style.setProperty("--lg-ring", glass.ring);
  root.style.setProperty("--lg-specular", glass.specular);
  root.style.setProperty("--lg-blur", glass.blur);
  root.style.setProperty("--lg-saturate", glass.saturate);
  root.style.setProperty("--lg-shadow", glass.shadow);
  root.style.setProperty("--lg-shadow-hover", glass.shadowHover);
  root.style.setProperty("--lg-sheen-rest", glass.sheenRest);
  root.style.setProperty("--lg-sheen-hover", glass.sheenHover);

  /**
   * 旧别名层（2026-10-06 真机撞出来的）。
   *
   * **问题**：约 250 处样式消费的这批名字（`--surface` / `--surface-dim` / `--dropdown-bg` /
   * `--border` / `--border-light` / `--text-muted` / `--text-dim` …）**全仓从未被定义过**。
   * 它们全都带着硬编码兜底值，于是主题换了、这些值不换：
   * ① `--dropdown-bg: #1e1e2a` 是**深色**，而面板的文字走 `--text-primary`（跟主题走）——
   *    浅色主题下就是**深字压深底**：字数、导出、搜索、笔记、版本历史、模板、新手引导、
   *    切书、写作目标、toast 十一处一起中招（真机截图里标题几乎看不见）。
   * ② `--surface: #fff` / `--surface-dim: #f0f1f4` 是**浅色**，暗色主题下六个浮层会反过来
   *    变成浅底浅字。
   * ③ `--border*` 的兜底是半透明白，浅色主题下描边直接隐形。
   *
   * ⇒ 这一段把它们**统一指向**上面那批真身。
   *
   * **两条形状上的硬要求**（5-㊵ 改写这段时踩过，`theme-token-guard.test.ts` 立刻红）：
   * ① **必须是这张 `const legacyAliases` 表**，不能摊成一串 `setProperty(...)` 调用——
   *    守卫要静态读它的字面量，好验「每条别名指向的 token 自己有没有定义」。
   * ② **值必须整体写成 CSS 的别名函数形式**（形如「引用某个已有 token 的那个写法」），
   *    不能只存裸 token 名再由循环拼前缀。
   *    守卫的正则量的是「键后面紧跟一个值字面量」——值里自己带那层包装才量得到；
   *    存裸名的话那条正则数出 0 条，断言报「expected 0 to be greater than 0」，
   *    而红的原因离病因隔了三层。
   * ③ **每条指向的 token 必须真的存在**。`--warn` / `--ok` 这两个旧名对应的是
   *    `styles.css` 里已经定过的 `--warning` / `--success`——
   *    我第一版图省事指向了两个自己编的名字，守卫立刻报
   *    「它自己也没有定义」。守卫在这里是对的：**指向一个没人定义的 token
   *    比不指向更糟**，它会让整条声明在计算值阶段作废，而那正是这条守卫存在的理由。
   *
   *    （注：这一段注释里刻意不写出那几个「假 token 名」的完整写法——
   *      `theme-token-guard.test.ts` 扫的是**原文**，
   *      注释里出现的消费形状照样会被算成「消费了却从没定义」。
   *      同一个坑在 `legacyAliases` 那张表的注释里已经踩过一次。）
   */
  const legacyAliases: Record<string, string> = {
    "--surface": "var(--surface-main)",
    "--surface-dim": "var(--surface-muted)",
    "--dropdown-bg": "var(--surface-raised)",
    "--bg-secondary": "var(--surface-muted)",
    "--border": "var(--theme-line)",
    "--border-light": "var(--theme-line-soft)",
    "--border-hover": "var(--theme-line)",
    "--line-strong": "var(--theme-line)",
    "--hover-bg": "var(--surface-hover)",
    "--text-muted": "var(--text-secondary)",
    "--text-dim": "var(--text-tertiary)",
    "--warn": "var(--warning)",
    "--ok": "var(--success)"
  };
  for (const [alias, value] of Object.entries(legacyAliases)) {
    root.style.setProperty(alias, value);
  }

  /* 侧栏底色。**半透还是实心由用户那个「半透明侧栏」开关决定**，不是皮肤的一部分。
     5-㊵ 重写这个文件时把这一段连同下面两行一起漏掉了，守卫立刻报
     `--sidebar-surface 裸用 2 / 带兜底 1` —— styles.css 里
     `--sidebar: var(--sidebar-surface, #f5f5f3)` 退回兜底，而深色主题下
     那个 `#f5f5f3` 是浅色 ⇒ 侧栏整条变成浅底浅字（与 2026-10-06 那次同一族）。 */
  root.style.setProperty(
    "--sidebar-surface",
    theme.translucentSidebar
      ? mixRgba(theme.background, theme.foreground, scheme === "dark" ? 0.08 : 0.035, 0.84)
      : mix(theme.background, theme.foreground, scheme === "dark" ? 0.08 : 0.035)
  );
  /* 这枚 data 属性是 theme-runtime.css 里 `[data-translucent-sidebar="true"]` 的开关。
     漏了它 ⇒ 侧栏的 `backdrop-filter: blur(22px)` 那一档再也不生效。 */
  root.dataset.translucentSidebar = String(theme.translucentSidebar);
  /* 窗口标题栏/任务栏颜色（Windows 上跟着主题色变）。 */
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme.background);

  /* 字体四件的**名字不能改**：`--ui-font` / `--editor-font` / `--ui-font-size` /
     `--code-font-size` 是约 40 处样式消费的名字。
     5-㊵ 重写这个文件时我按「先主题后字体」的语序把它们改成了
     `--font-ui` / `--font-editor` / `--font-size-ui` / `--font-size-code` ——
     改名的当天就被 `theme-token-guard.test.ts` 报成孤儿：
     「消费了却从没定义」。
     **改一个 token 的名字等于改全仓所有消费它的地方**，而这份文件是它的真身，
     真身换了名字、其余没换 ⇒ 那批样式当场退回各自的兜底值，
     而且**界面只是「字号不太对」，不会报错**（与 5-㊴ 那个 rgb(#hex) 同一族）。 */
  const uiStack = resolveAppearanceUiFontStack(input.uiFontFamily);
  const editorStack = resolveAppearanceEditorFontStack(input.editorFontFamily);
  root.style.setProperty("--ui-font", uiStack);
  root.style.setProperty("--editor-font", editorStack);
  root.style.setProperty("--ui-font-size", `${theme.uiFontSize}px`);
  root.style.setProperty("--code-font-size", `${theme.codeFontSize}px`);
}

export function applyAppearanceSettingsToDocument(settings: {
  scheme: AppearanceColorScheme;
  light: AppearanceThemeConfig;
  dark: AppearanceThemeConfig;
  uiFontFamily: AppearanceUiFontSelection;
  editorFontFamily: AppearanceEditorFontSelection;
  density: AppearanceDensity;
  liquidGlass: AppearanceLiquidGlass;
}): void {
  const theme = settings.scheme === "dark" ? settings.dark : settings.light;
  applyAppearanceThemeToDocument({
    scheme: settings.scheme,
    theme,
    uiFontFamily: settings.uiFontFamily,
    editorFontFamily: settings.editorFontFamily,
    density: settings.density,
    liquidGlass: settings.liquidGlass
  });
}

export function __testingMixRgba(
  background: string,
  foreground: string,
  foregroundRatio: number,
  alpha: number
): string {
  return mixRgba(background, foreground, foregroundRatio, alpha);
}

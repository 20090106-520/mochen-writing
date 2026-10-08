// 结构出处见 docs/ATTRIBUTION.md。
// 仅裁去其 Envelope 命令段与其 ./envelope 依赖（本项目无该传输层），其余未改。
import { z } from "zod";

export const AppearanceModeSchema = z.enum(["system", "light", "dark"]);
export type AppearanceMode = z.infer<typeof AppearanceModeSchema>;

export const AppearanceColorSchemeSchema = z.enum(["light", "dark"]);
export type AppearanceColorScheme = z.infer<typeof AppearanceColorSchemeSchema>;

export const APPEARANCE_FONT_SIZE_LIMITS = {
  uiFontSize: { min: 10, max: 24 },
  codeFontSize: { min: 10, max: 24 }
} as const;

export const DEFAULT_APPEARANCE_UI_FONT_SIZE = 14;
export const DEFAULT_APPEARANCE_CODE_FONT_SIZE = 13;

export const APPEARANCE_CUSTOM_FONT_MAX_FILES_PER_INSTALL = 20;
export const APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const APPEARANCE_CUSTOM_FONT_MAX_COUNT = 100;
export const APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH = 100;

export const AppearanceCustomFontIdSchema = z.string().regex(/^font_[\da-f]{64}$/u);
export type AppearanceCustomFontId = z.infer<typeof AppearanceCustomFontIdSchema>;

export const AppearanceCustomFontFormatSchema = z.enum(["ttf", "otf"]);
export type AppearanceCustomFontFormat = z.infer<typeof AppearanceCustomFontFormatSchema>;

export const AppearanceCustomFontSchema = z.object({
  id: AppearanceCustomFontIdSchema,
  displayName: z.string().trim().min(1).max(APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH),
  format: AppearanceCustomFontFormatSchema,
  byteSize: z.number().int().positive().max(APPEARANCE_CUSTOM_FONT_MAX_FILE_BYTES),
  installedAt: z.string().datetime()
});
export type AppearanceCustomFont = z.infer<typeof AppearanceCustomFontSchema>;

export const AppearanceFontCatalogSnapshotSchema = z.object({
  fonts: z.array(AppearanceCustomFontSchema).max(APPEARANCE_CUSTOM_FONT_MAX_COUNT)
});
export type AppearanceFontCatalogSnapshot = z.infer<typeof AppearanceFontCatalogSnapshotSchema>;

export const AppearanceFontInstallFailureCodeSchema = z.enum([
  "not_regular_file",
  "unsupported_format",
  "invalid_font",
  "file_too_large",
  "catalog_limit",
  "read_failed"
]);
export type AppearanceFontInstallFailureCode = z.infer<
  typeof AppearanceFontInstallFailureCodeSchema
>;

export const AppearanceFontInstallFailureSchema = z.object({
  displayName: z.string().trim().min(1).max(APPEARANCE_CUSTOM_FONT_DISPLAY_NAME_MAX_LENGTH),
  code: AppearanceFontInstallFailureCodeSchema
});
export type AppearanceFontInstallFailure = z.infer<typeof AppearanceFontInstallFailureSchema>;

export const AppearanceFontInstallResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("canceled") }),
  z.object({
    status: z.literal("completed"),
    catalog: AppearanceFontCatalogSnapshotSchema,
    installedIds: z.array(AppearanceCustomFontIdSchema),
    duplicateIds: z.array(AppearanceCustomFontIdSchema),
    rejected: z.array(AppearanceFontInstallFailureSchema)
  })
]);
export type AppearanceFontInstallResult = z.infer<typeof AppearanceFontInstallResultSchema>;

export const APPEARANCE_UI_FONT_FAMILIES = [
  "system",
  "sans",
  "yuan",
  "serif",
  "mono",
  "hei"
] as const;
export const AppearanceUiFontFamilySchema = z.enum(APPEARANCE_UI_FONT_FAMILIES);
export type AppearanceUiFontFamily = z.infer<typeof AppearanceUiFontFamilySchema>;
export const AppearanceUiFontSelectionSchema = z.union([
  AppearanceUiFontFamilySchema,
  AppearanceCustomFontIdSchema
]);
export type AppearanceUiFontSelection = z.infer<typeof AppearanceUiFontSelectionSchema>;

export const APPEARANCE_EDITOR_FONT_FAMILIES = [
  "song",
  "kai",
  "fangsong",
  "sans",
  "yuan",
  "hei",
  "li",
  "seal",
  "youyuan",
  "mono"
] as const;
export const AppearanceEditorFontFamilySchema = z.enum(APPEARANCE_EDITOR_FONT_FAMILIES);
export type AppearanceEditorFontFamily = z.infer<typeof AppearanceEditorFontFamilySchema>;
export const AppearanceEditorFontSelectionSchema = z.union([
  AppearanceEditorFontFamilySchema,
  AppearanceCustomFontIdSchema
]);
export type AppearanceEditorFontSelection = z.infer<typeof AppearanceEditorFontSelectionSchema>;

export const DEFAULT_APPEARANCE_UI_FONT_FAMILY: AppearanceUiFontFamily = "system";
export const DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY: AppearanceEditorFontFamily = "song";

export const APPEARANCE_FONT_FAMILY_LABELS = {
  system: "系统默认",
  sans: "黑体",
  song: "宋体",
  kai: "楷体",
  fangsong: "仿宋",
  yuan: "圆体",
  serif: "衬线（书卷气）",
  mono: "等宽",
  hei: "雅黑（现代）",
  li: "隶书",
  seal: "篆体",
  youyuan: "幼圆"
} as const;

/* 栈序就是优先级，`Songti SC` / `PingFang SC` 都是 macOS 族名，Windows 上不存在——
   原栈把 SimSun 排在 Noto Serif SC 前面，于是 Windows 一路掉到宋体，正文发虚发毛；
   界面同理落到雅黑，偏宽偏重。跨平台族名一律排到本平台族名之前：
   macOS 上 Noto 缺失，仍落回 Songti/PingFang，行为不变；Windows 上直接吃到 Noto。

   **2026-10-06 补全了每个族的 macOS 与 Windows 两条路**（批次 5-⑧）。
   原先 `kai` 只写了 `"Kaiti SC", "STKaiti", "KaiTi"`——macOS 有前两个、Windows 只有楷体，
   而 `KaiTi` 在 Windows 上是**楷体的旧名**（新名 `KaiTi` 同体，另有 `STKaiti` 不存在），
   缺族名会一路掉到 `serif` 兜底，于是「选楷体」在某些机器上其实显示的是宋体。
   每条栈都补上「通用中文名 + 常见同义名 + 英文回退」，让认不出族名的那一档也有个像样的落点。 */
export const APPEARANCE_UI_FONT_STACKS = {
  system:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  sans: '"Noto Sans SC", "Source Han Sans SC", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif',
  yuan: '"Yuanti SC", "YouYuan", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  // 界面里的衬线：给长文工具、批注类页面用；中文回退到宋体族，英文回退到 Georgia。
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, "SimSun", "宋体", serif',
  // 等宽界面：写作用得不多，但看时间线/JSON/日志时数字不跳。
  mono: '"JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", "Sarasa Mono SC", "Microsoft YaHei Mono", monospace',
  // 雅黑：比黑体更紧、字面更小，正文栏窄时用着更省地方。
  hei: '"Microsoft YaHei", "微软雅黑", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif'
} as const satisfies Record<AppearanceUiFontFamily, string>;

export const APPEARANCE_EDITOR_FONT_STACKS = {
  song: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", Georgia, serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", "TW-Kai", "Noto Serif SC", serif',
  fangsong: '"STFangsong", "FangSong", "仿宋", "FangSong_GB2312", "KaiTi", serif',
  sans: APPEARANCE_UI_FONT_STACKS.sans,
  yuan: APPEARANCE_UI_FONT_STACKS.yuan,
  hei: APPEARANCE_UI_FONT_STACKS.hei,
  // 隶书：横画蚕头燕尾，古文、碑帖一类。Windows 有 `LiSu`/`STLiti`，macOS 没有，
  // 所以 macOS 上会掉到楷体——比掉到宋体像得多。
  li: '"LiSu", "STLiti", "隶书", "华文隶书", "Kaiti SC", "KaiTi", "Noto Serif SC", serif',
  // 篆体：几乎只作装饰（扉页、标题）。两平台都极少预装，掉到楷体是合理落点。
  seal: '"STZhongsong", "华文中宋", "方正小篆体", "Kaiti SC", "Noto Serif SC", serif',
  // 幼圆：圆润、字面大，适合儿童读物或轻松向的稿子。`YouYuan` 是 Windows 的族名。
  youyuan:
    '"YouYuan", "幼圆", "Yuanti SC", "Yuanti TC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  // 等宽正文：写代码或刻意要「一格一字」时用；中文回退到等宽 CJK，缺了会掉到黑体。
  mono: APPEARANCE_UI_FONT_STACKS.mono
} as const satisfies Record<AppearanceEditorFontFamily, string>;

export interface AppearanceFontFamilyOption<T extends string> {
  value: T;
  label: string;
  stack: string;
}

export function isAppearanceCustomFontId(value: unknown): value is AppearanceCustomFontId {
  return AppearanceCustomFontIdSchema.safeParse(value).success;
}

export function appearanceCustomFontCssFamily(rawId: AppearanceCustomFontId): string {
  const id = AppearanceCustomFontIdSchema.parse(rawId);
  return `DeepWriteCustom_${id.slice("font_".length)}`;
}

export function appearanceCustomFontSourceUrl(rawId: AppearanceCustomFontId): string {
  const id = AppearanceCustomFontIdSchema.parse(rawId);
  return `deepwrite-font://asset/${id}`;
}

export function resolveAppearanceUiFontStack(family: string | undefined): string {
  if (isAppearanceCustomFontId(family)) {
    return `"${appearanceCustomFontCssFamily(family)}", ${APPEARANCE_UI_FONT_STACKS[DEFAULT_APPEARANCE_UI_FONT_FAMILY]}`;
  }
  if (family && family in APPEARANCE_UI_FONT_STACKS) {
    return APPEARANCE_UI_FONT_STACKS[family as AppearanceUiFontFamily];
  }
  return APPEARANCE_UI_FONT_STACKS[DEFAULT_APPEARANCE_UI_FONT_FAMILY];
}

export function resolveAppearanceEditorFontStack(family: string | undefined): string {
  if (isAppearanceCustomFontId(family)) {
    return `"${appearanceCustomFontCssFamily(family)}", ${APPEARANCE_EDITOR_FONT_STACKS[DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY]}`;
  }
  if (family && family in APPEARANCE_EDITOR_FONT_STACKS) {
    return APPEARANCE_EDITOR_FONT_STACKS[family as AppearanceEditorFontFamily];
  }
  return APPEARANCE_EDITOR_FONT_STACKS[DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY];
}

export function listAppearanceUiFontFamilyOptions(): Array<
  AppearanceFontFamilyOption<AppearanceUiFontFamily>
> {
  return APPEARANCE_UI_FONT_FAMILIES.map((value) => ({
    value,
    label: APPEARANCE_FONT_FAMILY_LABELS[value],
    stack: APPEARANCE_UI_FONT_STACKS[value]
  }));
}

export function listAppearanceEditorFontFamilyOptions(): Array<
  AppearanceFontFamilyOption<AppearanceEditorFontFamily>
> {
  return APPEARANCE_EDITOR_FONT_FAMILIES.map((value) => ({
    value,
    label: APPEARANCE_FONT_FAMILY_LABELS[value],
    stack: APPEARANCE_EDITOR_FONT_STACKS[value]
  }));
}

const HexColorSchema = z
  .string()
  .regex(/^#[\da-f]{6}$/iu, "颜色必须是 6 位十六进制值")
  .transform((value) => value.toUpperCase());

function fontSizeSchema(limits: { min: number; max: number }) {
  return z
    .number()
    .finite()
    .min(limits.min)
    .max(limits.max)
    .transform((value) => Math.round(value * 2) / 2);
}

/* ─────────────────────────────────────────────────────────────────────────
   皮肤的「视觉层」（2026-10-07 批次 5-㊴ 建，5-㊵ 按上游真身重做）。

   【5-㊴ 的做法错在哪，用户一句话点破了】
   那一批把上游的视觉语言**概括成四个离散档**（texture/radius/outline/glow 各三四档），
   等于自己发明了一套目录；而上游真正在做的事是**连续参数 + 具体手法**：
   端场的玻璃是 `blur 8 / 14 / 22px` 三档配 alpha 与 sheen 渐变，
   壁纸引擎的玻璃是**分区域**给参数（侧栏 / 设置窗 / 浮层 各有自己的 alpha 与 blur），
   梦境的背景是四层 `radial-gradient` 逐条叠出来的弥散光。
   「四档离散值」丢掉的正是这些——所以换出来的皮肤「跟他的那些不一样」。

   【这一批改成什么】
   不再自造档位，改成**从上游源码里搬真实数值**：
   ① `backdrop` 背景层：梦境那 8 套 `radial-gradient` 弥散光整条搬过来（逐字节），落 `--skin-backdrop`。
   ② `glass`    玻璃层：端场 8/14/22px 三档 + 壁纸引擎分区域参数（侧栏/正文/浮层），落 `--skin-glass-*`。
   ③ `surface`  表面处理：端场全直角 `[class]{border-radius:0}` / 常规 / galgame 对话框渐变，落 `--skin-surface-*`。
   ④ `grid`     图案层：端场工业网格（1px 横线@4px 间距 + 1px 竖线@120px）与 galgame 网格，落 `--skin-grid-*`。

   【仍然用 z.enum 的理由不变】
   枚举让「非法值」在**落盘那一刻**就被 zod 拒掉，而不是让它流进 CSS。
   而每一档**背后的具体数值**在渲染层从上游真身取（appearanceThemeRuntime 里的
   UPSTREAM_* 常量，逐条注明出处文件与原值），加一档只改 contracts 一处。
   ⇒ 档位是墨宸的**接口**，数值是上游的**真身**，两者分开记，注释里写清哪一条来自哪个文件。
   */
export const APPEARANCE_BACKDROPS = [
  "plain",
  "abyss",
  "aurora",
  "nebula",
  "ember",
  "midnight"
] as const;
export const AppearanceBackdropSchema = z.enum(APPEARANCE_BACKDROPS);
export type AppearanceBackdrop = z.infer<typeof AppearanceBackdropSchema>;

/**
 * 玻璃档。
 * `subtle / standard / strong` 与上游 `docs/glass.md` 的三档**同名**，数值（blur 8/14/22px、
 * alpha .68/.8/.9）也逐条来自那里；`regions` 是壁纸引擎那种**分区域**给参数的做法。
 */
export const APPEARANCE_GLASSES = ["none", "subtle", "standard", "strong", "regions"] as const;
export const AppearanceGlassSchema = z.enum(APPEARANCE_GLASSES);
export type AppearanceGlass = z.infer<typeof AppearanceGlassSchema>;

/**
 * 表面处理。
 * `square` 用的是端场 theme.css:423-438 的真实手法（`[class]{border-radius:0!important}` 再恢复圆形元素），
 * `round-none` 是公海皮 26px/20px 的胶囊面板，`dialogue` 是 gal-view 对话框的
 * `linear-gradient(180deg, …)` 底 + 底部 4px 实心压边。
 */
export const APPEARANCE_SURFACES = ["plain", "square", "round-none", "dialogue"] as const;
export const AppearanceSurfaceSchema = z.enum(APPEARANCE_SURFACES);
export type AppearanceSurface = z.infer<typeof AppearanceSurfaceSchema>;

/** 图案层：`none` 平涂；`industrial` 端场网格；`stage` galgame 舞台网格。 */
export const APPEARANCE_GRIDS = ["none", "industrial", "stage"] as const;
export const AppearanceGridSchema = z.enum(APPEARANCE_GRIDS);
export type AppearanceGrid = z.infer<typeof AppearanceGridSchema>;

/**
 * 画面层（2026-10-08 新增）：皮肤可以带一张**整窗插画**。
 *
 * 【为什么必须单开一层，而不是并进 backdrop】
 * 前面四层全是 **CSS 质地**——渐变、模糊、圆角、网格。换完了读起来仍然是
 * 「换了个色调」：这就是用户看着皮肤广场说「只改颜色和字体」的那一句。
 * DSH 那些「趣味换装」真正被认出来的东西恰恰不在四层里——满屏手绘场景与两侧立绘。
 * ⇒ 这一层放的是**一张整窗画面**，与 backdrop 不是一回事，也不互相替代：
 *   `backdrop` 仍是那层 CSS 弥散光（没有画时它单独成立），`art` 在它**下面**。
 *
 * 【位图还是矢量？枚举不关心】（2026-10-08 波2a）
 * 首批两张是位图 JPG；波2a 这六张是**仓内自绘的矢量场景画**（SVG），
 * 因为 ImageGen 配额返回 403、外部位图通路当时阻塞。
 * 这一层只管「有没有一张铺满整窗的画」，不管它是哪种编码——
 * 具体对哪个文件由渲染层 `appearanceSkinVisual.ts` 的 `ART_FILES` 决定，
 * 而「枚举里的每一档都有文件躺在盘上」由 `appearance-skin-assets.test.ts` 读盘钉住。
 *
 * 【为什么是枚举而不是任意路径】
 * 路径要是任意的，等于把「渲染层允许加载什么」的决定权交给数据表——
 * 一条 `file://` 或远程 URL 就能从数据里长进 CSS。
 * 枚举让「这个 id 对应哪张图」只有 appearanceSkinVisual 一处真身。
 */
export const APPEARANCE_ARTS = [
  "none",
  "abyss-hall-night",
  "shallow-hall-day",
  "book-boat-night",
  "book-boat-day",
  "lamp-tower-night",
  "lamp-tower-day",
  "ink-pool-night",
  "ink-pool-day"
] as const;
export const AppearanceArtSchema = z.enum(APPEARANCE_ARTS);
export type AppearanceArt = z.infer<typeof AppearanceArtSchema>;

/**
 * 出厂取「有画」。
 *
 * 【2026-10-08 这一条被用户改写过，改写的就是这一行】
 * 原先这里写的是 `"none"`，理由写着「老用户的 appearance.json 没有这个字段，
 * 补成一上来就带画的，等于应用一次升级就把人家的界面换了」。
 * 用户看完 5-㊷ 那一版（当时的处理是「素面那十套下架但不销毁，继续当出厂默认」）说：
 * **「我没说明白吗，把没有皮肤没有图片的全删了，只保留有图片有皮肤的。」**
 * ⇒ 素面那一族整族退役，出厂默认只剩「广场第一套带画皮肤」这一个去处。
 *   老 JSON 缺这个字段时补出来的也是带画的那一档，
 *   与 `DEFAULT_APPEARANCE_BACKDROP` 等四条同源（都取 `appearanceSkins[0]` 的五个值，
 *   对照由 `appearance-skins.test.ts` 的「出厂默认」那一组钉——**值在两处写，守卫做逐字段对照**）。
 */
export const DEFAULT_APPEARANCE_ART: AppearanceArt = "shallow-hall-day";

/**
 * 视觉四层的出厂取值。
 *
 * **这四条与上面那条 `DEFAULT_APPEARANCE_ART` 是同一套**：都取广场第一套皮肤的那五层
 * （浅海昼阁：弥散光底 + 分区域玻璃 + 胶囊圆角 + 无网格）。
 * 原先这四条全是「素」（plain / none / plain / none），配的理由同上——「别把老用户的界面换了」。
 * 2026-10-08 用户裁定「没有图片的不保留」之后，素面组合不再是一个可交付状态，
 * 所以四条跟着第一套皮肤走，而不是各自留一个「最保守」的字面量。
 */
export const DEFAULT_APPEARANCE_BACKDROP: AppearanceBackdrop = "aurora";
export const DEFAULT_APPEARANCE_GLASS: AppearanceGlass = "regions";
export const DEFAULT_APPEARANCE_SURFACE: AppearanceSurface = "round-none";
export const DEFAULT_APPEARANCE_GRID: AppearanceGrid = "none";

/**
 * 出厂那套皮肤的 id。**与渲染层 `appearanceSkins[0].id` 必须一字不差**。
 *
 * 【为什么允许两处各写一遍】
 * 依赖方向是 `contracts ← renderer`：皮肤表在渲染层，contracts 不能反过来 import 它，
 * 否则包边界检查（`tools/check-package-boundary.mjs`）当场红。
 * ⇒ 值只能是两份，而那两份的对照交给守卫：
 *   `appearance-skins.test.ts` 逐字段比 `createDefaultAppearanceTheme()` 与 `appearanceSkins[0]`，
 *   改了皮肤表第一套而忘了改这里（或反过来）会红，且报出是哪个字段。
 */
export const DEFAULT_APPEARANCE_SKIN_ID = "xi-day";

/** 出厂三色的两版取值，同样必须与 `appearanceSkins[0]` 的 light / dark 逐字相同。 */
export const DEFAULT_APPEARANCE_TONES = {
  light: { accent: "#2A7699", background: "#E8F6FA", foreground: "#123243" },
  dark: { accent: "#57B7D6", background: "#0E2430", foreground: "#DCF1F8" }
} as const;

export const AppearanceThemeConfigSchema = z.object({
  preset: z.string().trim().min(1),
  accent: HexColorSchema,
  background: HexColorSchema,
  foreground: HexColorSchema,
  uiFontSize: fontSizeSchema(APPEARANCE_FONT_SIZE_LIMITS.uiFontSize),
  codeFontSize: fontSizeSchema(APPEARANCE_FONT_SIZE_LIMITS.codeFontSize),
  translucentSidebar: z.boolean(),
  /* 视觉四层。全部带 default：老 JSON 缺它们时补出厂值，见上面那条注释。
     `skin` 是皮肤 id，与渲染层皮肤表 `appearanceSkins[].id` **同一个 id 空间**；
     2026-10-08 之后广场里只有带整窗画面的皮肤，所以出厂值就是第一套（`xi-day`），
     不再是那个「不在任何表里的占位符 `plain`」。 */
  skin: z.string().trim().min(1).default(DEFAULT_APPEARANCE_SKIN_ID),
  backdrop: AppearanceBackdropSchema.default(DEFAULT_APPEARANCE_BACKDROP),
  glass: AppearanceGlassSchema.default(DEFAULT_APPEARANCE_GLASS),
  surface: AppearanceSurfaceSchema.default(DEFAULT_APPEARANCE_SURFACE),
  grid: AppearanceGridSchema.default(DEFAULT_APPEARANCE_GRID),
  art: AppearanceArtSchema.default(DEFAULT_APPEARANCE_ART)
});
export type AppearanceThemeConfig = z.infer<typeof AppearanceThemeConfigSchema>;

export const AppearanceSettingsSchema = z.object({
  mode: AppearanceModeSchema,
  light: AppearanceThemeConfigSchema,
  dark: AppearanceThemeConfigSchema,
  uiFontFamily: AppearanceUiFontSelectionSchema.default(DEFAULT_APPEARANCE_UI_FONT_FAMILY),
  editorFontFamily: AppearanceEditorFontSelectionSchema.default(
    DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY
  )
});
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>;

export const AppearanceSettingsSnapshotSchema = z.object({
  persisted: z.boolean(),
  settings: AppearanceSettingsSchema
});
export type AppearanceSettingsSnapshot = z.infer<typeof AppearanceSettingsSnapshotSchema>;

/**
 * 出厂主题 = **广场第一套带画皮肤**（2026-10-08 用户裁定，见 `DEFAULT_APPEARANCE_ART` 那段）。
 *
 * 【`preset` 与 `skin` 为什么填同一个值】
 * `preset` 是「主题配色预设」那一族的遗留字段，而那一族（十套素面底版 + `themePresets` 投影）
 * 已经随这次裁定整族删掉了。字段本身**留着**：契约形状一变（少一个必填键），
 * 老 JSON 与所有 IPC 夹具都要跟着改，而那属于「删一条通道」级别的动作，本批没做。
 * ⇒ 现在它只是 `skin` 的镜像：换上皮肤时两处写同一个 id
 *   （`appearanceSkinPreview.patchSettingsWithSkin`），出厂也同一套。
 *   渲染层读的是 `skin`，不再读 `preset`——`appearance-panel-wiring.test.ts` 钉着这条。
 */
export function createDefaultAppearanceTheme(scheme: AppearanceColorScheme): AppearanceThemeConfig {
  const tones = scheme === "dark" ? DEFAULT_APPEARANCE_TONES.dark : DEFAULT_APPEARANCE_TONES.light;
  return {
    preset: DEFAULT_APPEARANCE_SKIN_ID,
    accent: tones.accent,
    background: tones.background,
    foreground: tones.foreground,
    uiFontSize: DEFAULT_APPEARANCE_UI_FONT_SIZE,
    codeFontSize: DEFAULT_APPEARANCE_CODE_FONT_SIZE,
    translucentSidebar: true,
    skin: DEFAULT_APPEARANCE_SKIN_ID,
    backdrop: DEFAULT_APPEARANCE_BACKDROP,
    glass: DEFAULT_APPEARANCE_GLASS,
    surface: DEFAULT_APPEARANCE_SURFACE,
    grid: DEFAULT_APPEARANCE_GRID,
    art: DEFAULT_APPEARANCE_ART
  };
}

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return {
    mode: "system",
    light: createDefaultAppearanceTheme("light"),
    dark: createDefaultAppearanceTheme("dark"),
    uiFontFamily: DEFAULT_APPEARANCE_UI_FONT_FAMILY,
    editorFontFamily: DEFAULT_APPEARANCE_EDITOR_FONT_FAMILY
  };
}

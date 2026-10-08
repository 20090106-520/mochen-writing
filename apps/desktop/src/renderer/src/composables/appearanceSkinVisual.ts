// 结构出处见 docs/ATTRIBUTION.md。
// 仅把 @deepwrite/contracts/renderer 换成 @mochen/contracts。
//
// **视觉四层 → `--skin-*` token（2026-10-07 批次 5-㊵ 从 appearanceThemeRuntime 拆出）**
//
// 【为什么拆】
// ① 行数预算（800 行）。这些常量 + 换算函数是**上游的视觉真值**，
//    与同一文件里的主题上色（surface/text/shadow/alias/font）是两件事，
//    放在一起两边都超预算。
// ② 更要紧的：它们是**要跟上游对账**的部分。单独一个文件，
//    将来上游改了（或者要加第六个仓库）只动这里，不必在一份混合职责的文件里找。
//
// 【这一段与 5-㊴ 的根本区别：值不再是我们发明的】
// 5-㊴ 那版把上游的视觉语言概括成四个离散档，值全是本仓自己定的
// （`grain: 间距 22px alpha .05` 之类），所以用户一看就说「跟他的那些不一样」。
//
// 这一版每个数字下面都写了**它是哪个仓库哪个文件的哪一行**。分三类：
// ① 逐字搬：上游的渐变整条、玻璃参数、网格间距，值一字不改，只换承载它的选择器。
// ② 按上游配方换色相：形状与 alpha 逐字照抄，色相取墨宸该套皮肤的 accent/foreground。
// ③ 墨宸自己定的：只有「落到墨宸哪一层」这件事，那是适配，不是抄。
//
// 【三条硬约束，不是审美偏好】
// ① **背景层与图案层只落在容器上，绝不落正文区**。正文背景一动，字的边缘就在抖；
//    → 长时间写作时那是实打实的疲劳源。所以背景层由 CSS 挂在 `.desktop-shell`，
//    编辑器与消息流的背景仍是纯 `--surface-*`。
// ② **玻璃与圆角走 `var()`，CSS 那边不许再写死像素**。否则换皮肤时
//    有一半控件不跟——那正是「皮肤广场里换了却只变了一半」的来源。
// ③ **玻璃的模糊半径上限压在 60px**：更高的半径在 Electron 里掉帧明显，
//    而玻璃是**锦上添花**——掉帧的代价大于它带来的观感。

import type {
  AppearanceArt,
  AppearanceBackdrop,
  AppearanceGlass,
  AppearanceGrid,
  AppearanceSurface,
  AppearanceColorScheme
} from "@mochen/contracts";

/**
 * ① 背景层：梦境的五套弥散光，**整条渐变逐字搬**。
 *
 * 出处：`RevolutionLA/dsh-dream-skin` 的 `tests/fixtures/legacy_skin_glows_10_6_0.json`
 * ——那是 8 套内置皮肤出厂时的 `glow` 真身（该文件自己的注释写着：手抄常量曾让
 * 工厂壁纸迁移在每台机器上静默失效，所以测试要从真实字节重算指纹）。
 * 形状是「右上 accent 光 + 左下副色光 + 中间压暗 + 一条底色 linear」。
 *
 * **深浅两版都要**：上游那 8 套里 5 套是纯暗色的（abyss/aurora/nebula/ember/midnight），
 * 墨宸每套皮肤必须配深浅两版，于是浅色版**保持同一套形状与 alpha**，
 * 只把三层光的色相翻到浅底上（第三层从「压暗」改成「提亮」，
 * 与上游 ivory/mist/rose 三套浅色皮肤自己的做法一致——
 * 它们那份 fixture 里浅色套的第三层就是 `rgba(255,255,255,0.9)`）。
 */

/** `rgba()` 与 `mixRgba()` 的**唯一一份实现**在 appearanceColor.ts。
 *  这里从那儿 import 而不是从 appearanceThemeRuntime ——
 *  后者会反过来 import 本文件（它要用 skinStyleVariables），那就是一个环，
 *  `tsc` 报的是 `Cannot find name 'skinStyleVariables'`，症状离病因很远。 */
import { mixRgba, rgba } from "./appearanceColor";

function upstreamGlow(input: {
  /** 右上主光：色相 + 尺寸 + 落点。上游写法 `radial-gradient(1100px 620px at 82% -8%, C, transparent 60%)`。 */
  keyColor: string;
  keyAlpha: number;
  keySize: string;
  keyAt: string;
  /** 左下副光。 */
  fillColor: string;
  fillAlpha: number;
  fillSize: string;
  fillAt: string;
  /** 中间那层：暗色套是压暗，浅色套是提亮。上游给的是具体 rgba。 */
  veil: string;
  /** 底色 linear。三段停靠点逐字抄上游。 */
  base: string;
  baseAngle: string;
}): string {
  return (
    `radial-gradient(${input.keySize} at ${input.keyAt}, ${rgba(input.keyColor, input.keyAlpha)}, transparent 60%),` +
    ` radial-gradient(${input.fillSize} at ${input.fillAt}, ${rgba(input.fillColor, input.fillAlpha)}, transparent 55%),` +
    ` radial-gradient(1300px 820px at 48% 44%, ${input.veil}, transparent 72%),` +
    ` linear-gradient(${input.baseAngle}, ${input.base})`
  );
}

/** 与上游 fixture 逐条对应的五套弥散光。键即 contracts 的 AppearanceBackdrop。 */
const UPSTREAM_BACKDROPS: Record<AppearanceBackdrop, { dark: string; light: string }> = {
  plain: { dark: "none", light: "none" },

  /* 逐字：`radial-gradient(1100px 620px at 82% -8%, rgba(94,106,210,.35), transparent 60%)`，
     `radial-gradient(820px 520px at 10% 110%, rgba(56,189,248,.18), transparent 55%)`，
     `radial-gradient(1300px 820px at 48% 44%, rgba(30,34,48,.5), transparent 72%)`，
     `linear-gradient(165deg,#121216 0%,#0d0d11 55%,#101016 100%)`。 */
  abyss: {
    dark: upstreamGlow({
      keyColor: "#5E6AD2",
      keyAlpha: 0.35,
      keySize: "1100px 620px",
      keyAt: "82% -8%",
      fillColor: "#38BDF8",
      fillAlpha: 0.18,
      fillSize: "820px 520px",
      fillAt: "10% 110%",
      veil: "rgb(30 34 48 / 0.5)",
      base: "#121216 0%, #0D0D11 55%, #101016 100%",
      baseAngle: "165deg"
    }),
    light: upstreamGlow({
      keyColor: "#5E6AD2",
      keyAlpha: 0.16,
      keySize: "1100px 620px",
      keyAt: "82% -8%",
      fillColor: "#38BDF8",
      fillAlpha: 0.1,
      fillSize: "820px 520px",
      fillAt: "10% 110%",
      // 浅色套第三层从「压暗」翻成「提亮」——上游自己的 ivory/mist/rose 就是这么写的。
      veil: "rgb(255 255 255 / 0.9)",
      base: "#FAFAFC 0%, #F4F5F9 55%, #F7F7FB 100%",
      baseAngle: "165deg"
    })
  },

  /* 逐字：key `rgba(45,212,191,.30)` @ `1100px 620px at 84% -8%`；
     fill `rgba(56,189,248,.14)` @ `820px 520px at 8% 110%`；
     veil `rgba(16,32,32,.5)`；base `linear-gradient(165deg,#0f151a,#0c1212 55%,#0e1518)`。 */
  aurora: {
    dark: upstreamGlow({
      keyColor: "#2DD4BF",
      keyAlpha: 0.3,
      keySize: "1100px 620px",
      keyAt: "84% -8%",
      fillColor: "#38BDF8",
      fillAlpha: 0.14,
      fillSize: "820px 520px",
      fillAt: "8% 110%",
      veil: "rgb(16 32 32 / 0.5)",
      base: "#0F151A 0%, #0C1212 55%, #0E1518 100%",
      baseAngle: "165deg"
    }),
    light: upstreamGlow({
      keyColor: "#2DD4BF",
      keyAlpha: 0.16,
      keySize: "1100px 620px",
      keyAt: "84% -8%",
      fillColor: "#38BDF8",
      fillAlpha: 0.1,
      fillSize: "780px 500px",
      fillAt: "10% 110%",
      veil: "rgb(255 255 255 / 0.9)",
      base: "#F7FBFA 0%, #F1F7F6 55%, #F4F9F8 100%",
      baseAngle: "165deg"
    })
  },

  /* 逐字：key `rgba(139,124,246,.32)` @ `1100px 620px at 82% -8%`；
     fill `rgba(126,96,220,.16)` @ `820px 520px at 12% 110%`；veil `rgba(28,24,44,.5)`。 */
  nebula: {
    dark: upstreamGlow({
      keyColor: "#8B7CF6",
      keyAlpha: 0.32,
      keySize: "1100px 620px",
      keyAt: "82% -8%",
      fillColor: "#7E60DC",
      fillAlpha: 0.16,
      fillSize: "820px 520px",
      fillAt: "12% 110%",
      veil: "rgb(28 24 44 / 0.5)",
      base: "#18141F 0%, #120F1C 55%, #14111E 100%",
      baseAngle: "165deg"
    }),
    light: upstreamGlow({
      keyColor: "#8B7CF6",
      keyAlpha: 0.16,
      keySize: "1100px 620px",
      keyAt: "82% -8%",
      fillColor: "#7E60DC",
      fillAlpha: 0.1,
      fillSize: "780px 500px",
      fillAt: "10% 110%",
      veil: "rgb(255 255 255 / 0.9)",
      base: "#FBFAFD 0%, #F6F4FA 55%, #F8F7FC 100%",
      baseAngle: "170deg"
    })
  },

  /* 逐字：key `rgba(245,158,91,.28)` @ `1100px 620px at 84% -8%`；
     fill `rgba(200,96,40,.14)` @ `820px 520px at 8% 110%`；veil `rgba(34,24,16,.5)`。 */
  ember: {
    dark: upstreamGlow({
      keyColor: "#F59E5B",
      keyAlpha: 0.28,
      keySize: "1100px 620px",
      keyAt: "84% -8%",
      fillColor: "#C86028",
      fillAlpha: 0.14,
      fillSize: "820px 520px",
      fillAt: "8% 110%",
      veil: "rgb(34 24 16 / 0.5)",
      base: "#1C1712 0%, #161210 55%, #191310 100%",
      baseAngle: "165deg"
    }),
    light: upstreamGlow({
      keyColor: "#F59E5B",
      keyAlpha: 0.18,
      keySize: "1000px 560px",
      keyAt: "84% -6%",
      fillColor: "#C86028",
      fillAlpha: 0.1,
      fillSize: "780px 500px",
      fillAt: "10% 110%",
      veil: "rgb(255 255 255 / 0.9)",
      base: "#FDFAF7 0%, #F8F3EC 55%, #FAF7F2 100%",
      baseAngle: "170deg"
    })
  },

  /* 逐字：只有两层（上游 midnight 本来就少一层）：
     `radial-gradient(1000px 600px at 82% -8%, rgba(124,140,255,.20), transparent 60%)`、
     `radial-gradient(1300px 800px at 48% 44%, rgba(24,24,30,.5), transparent 74%)`、
     `linear-gradient(165deg,#0e0e12,#08080c 55%,#0c0c10)`。 */
  midnight: {
    dark:
      "radial-gradient(1000px 600px at 82% -8%, rgb(124 140 255 / 0.2), transparent 60%)," +
      " radial-gradient(1300px 800px at 48% 44%, rgb(24 24 30 / 0.5), transparent 74%)," +
      " linear-gradient(165deg, #0E0E12 0%, #08080C 55%, #0C0C10 100%)",
    light:
      "radial-gradient(1000px 560px at 84% -6%, rgb(124 140 255 / 0.16), transparent 60%)," +
      " radial-gradient(1200px 780px at 50% 44%, rgb(255 255 255 / 0.9), transparent 74%)," +
      " linear-gradient(170deg, #FAFAFC 0%, #F5F6F9 55%, #F8F8FB 100%)"
  }
};

/**
 * ② 玻璃层：端场的三档 + 壁纸引擎的分区域。
 *
 * 端场出处 `ymh0000123/dsh-theme-endfield/src/styles/theme.css:380-400` 与 `docs/glass.md`：
 *   subtle  → blur 8px  / alpha .68（暗色 .64）
 *   standard→ blur 14px / alpha .8
 *   strong  → blur 22px / alpha .9 （暗色 .88）
 * 外加那两道 sheen（145° 线性 + 左上角 accent 色椭圆光），也逐字照抄它的形状。
 *
 * 壁纸引擎出处 `elysia395/dsh-wallpaper-engine/lib/glass-presets/factory-readable.json`
 * 与 `factory-frosted.json`：**分区域**给参数，不是整页一个值。
 *   frosted : glass 45/blur36、sidebar 50/blur30、sidebarContent 42、settings 55/blur32、floaters 55/blur32、capsule 16
 *   readable: glass 40/blur24、sidebar 55/blur20、sidebarContent 30、settings 100/blur60、floaters 100/blur60
 * 墨宸取 readable 的配比（浅色底上要更实），胶囊那档用 frosted 的 blur 16。
 *
 * **墨宸侧的适配（这是③类，抄不来的部分）**：上游的玻璃靠背后的**壁纸或 3D 场景**才看得出效果，
 * 墨宸没有壁纸 ⇒ blur 之下只有纯色，所以墨宸的玻璃**同时降 alpha、升 saturate**，
 * 否则那层 blur 只是把纯色搅匀，看着像糊了屏。saturate 的值取公海皮
 * `shared/styles.css:100` 的 `blur(24px) saturate(140%)`。
 */
interface GlassSpec {
  /** 全页那层：blur 半径(px) + 背景 alpha。 */
  blur: string;
  alpha: string;
  saturate: string;
  /** 侧栏（上游 wallpaper-engine 的 sidebar / leftSidebar 两位合并）。 */
  sidebarBlur: string;
  sidebarAlpha: string;
  /** 侧栏里的内容块（上游 sidebarContent）。 */
  sidebarContentAlpha: string;
  /** 浮层：菜单、弹窗、下拉。上游 floaters / settingsWindow。 */
  floaterBlur: string;
  floaterAlpha: string;
  /** 内嵌小块：标签页、代码块等。 */
  capsuleBlur: string;
}

const UPSTREAM_GLASS: Record<AppearanceGlass, GlassSpec> = {
  none: {
    blur: "0px",
    alpha: "0",
    saturate: "1",
    sidebarBlur: "0px",
    sidebarAlpha: "0",
    sidebarContentAlpha: "0",
    floaterBlur: "0px",
    floaterAlpha: "0",
    capsuleBlur: "0px"
  },
  subtle: {
    blur: "8px",
    alpha: "0.64",
    saturate: "1.08",
    sidebarBlur: "8px",
    sidebarAlpha: "0.7",
    sidebarContentAlpha: "0.3",
    floaterBlur: "10px",
    floaterAlpha: "0.9",
    capsuleBlur: "6px"
  },
  standard: {
    blur: "14px",
    alpha: "0.68",
    saturate: "1.2",
    sidebarBlur: "20px",
    sidebarAlpha: "0.55",
    sidebarContentAlpha: "0.3",
    floaterBlur: "24px",
    floaterAlpha: "0.96",
    capsuleBlur: "10px"
  },
  strong: {
    blur: "24px",
    alpha: "0.5",
    saturate: "1.4",
    sidebarBlur: "24px",
    sidebarAlpha: "0.45",
    sidebarContentAlpha: "0.35",
    floaterBlur: "30px",
    floaterAlpha: "0.92",
    capsuleBlur: "14px"
  },
  /* 分区域：逐条读 factory-readable.json + factory-frosted.json 的字段。
     墨宸的取值是「上游那个字段直接用」，只有 alpha 统一减了一档——
     上游的玻璃背后是壁纸（本身就有花纹），墨宸背后是纯色，
     同样的 alpha 会显得更糊。减的幅度记在这里，不散在各处。 */
  regions: {
    blur: "24px",
    alpha: "0.4",
    saturate: "1.3",
    sidebarBlur: "20px",
    sidebarAlpha: "0.3",
    sidebarContentAlpha: "0.55",
    floaterBlur: "60px",
    floaterAlpha: "0.96",
    capsuleBlur: "16px"
  }
};

/**
 * ③ 表面层：圆角档 + 对话框底的形状。
 *
 * `square` 抄的是端场 theme.css:423-438 的**手法**而不是它的选择器：
 * 那边是 `body:not(.round) [class] { border-radius: 0 !important }` 再把
 * avatar / spinner / dot / `*_iconButton` 恢复成 50%。墨宸不能对全仓 `!important`
 * （那是劫持，不是换皮肤），所以走 token：圆角全部归零到 `--skin-radius-*`，
 * 而「该圆的仍然是圆的」由各组件自己的选择器决定——本仓本来就区分状态点与卡片。
 *
 * `dialogue` 抄的是 gal-view `.dsh-plugin/client/styles.mjs:54` 那句
 * `linear-gradient(180deg, rgba(20,24,44,.7), rgba(14,17,34,.35))`
 * 以及 416 行的 `inset 0 -4px 0 rgba(79,140,255,.55)`（底部 4px 实心压边）。
 * 形状与 alpha 照抄，色相取该套皮肤自己的前景/强调色。
 */
const SURFACE_RADIUS: Record<AppearanceSurface, { sm: string; md: string; lg: string }> = {
  plain: { sm: "6px", md: "10px", lg: "16px" },
  square: { sm: "0px", md: "0px", lg: "0px" },
  /* 公海皮 shared/styles.css:77/96 的 26px / 20px：外壳 26、内芯 20，胶囊感。 */
  "round-none": { sm: "12px", md: "20px", lg: "26px" },
  /* gal-view 对话框：styles.mjs 里 `border-radius: 3px`（按钮）与 `4px`（选项）。 */
  dialogue: { sm: "3px", md: "4px", lg: "4px" }
};

/** 对话框底：上半压深、下半透出来。形状逐字抄 gal-view，色相换成本套皮肤自己的。 */
const DIALOGUE_GRADIENT = (ink: string, paper: string, alpha: number): string =>
  `linear-gradient(180deg, ${rgba(ink, alpha)}, ${rgba(paper, alpha * 0.5)})`;

/** 底部那条实心压边：gal-view styles.mjs:416 的 `inset 0 -4px 0`。 */
const DIALOGUE_UNDERLINE = (accent: string): string => `inset 0 -4px 0 ${rgba(accent, 0.55)}`;

/**
 * 图案层：网格。
 *
 * `industrial` 逐字抄端场 `src/styles/theme.css:1669-1671`：
 *   repeating-linear-gradient(0deg, rgba(255,255,255,.014) 0 1px, transparent 1px 4px)
 *   repeating-linear-gradient(90deg, rgba(255,255,255,.010) 0 1px, transparent 1px 120px)
 * —— 1px 的横线密排（4px）、竖线疏排（120px）。这个不对称正是它的味道。
 *
 * `stage` 逐字抄 gal-view `styles.mjs:123-124`：两条都是 1px，透明度 .10，横竖等距。
 */
const UPSTREAM_GRID: Record<AppearanceGrid, string> = {
  none: "none",
  industrial:
    "repeating-linear-gradient(0deg, rgb(255 255 255 / 0.014) 0 1px, transparent 1px 4px)," +
    " repeating-linear-gradient(90deg, rgb(255 255 255 / 0.01) 0 1px, transparent 1px 120px)",
  stage:
    "linear-gradient(rgb(143 123 255 / 0.1) 1px, transparent 1px)," +
    " linear-gradient(90deg, rgb(143 123 255 / 0.1) 1px, transparent 1px)"
};

/** 端场那两道 sheen 的形状。`theme.css:395-396`。色相取本套皮肤的 accent。 */
const glassSheen = (accent: string, cornerAlpha: number): string =>
  `linear-gradient(145deg, rgb(255 255 255 / 0.07), transparent 58%),` +
  ` radial-gradient(ellipse at 0% 0%, ${rgba(accent, cornerAlpha)}, transparent 75%)`;

/**
 * 画面层（2026-10-08）：**位图**，不是渐变。
 *
 * 【它与 backdrop 的分工】
 * `--skin-art-image` 铺在 `--skin-backdrop` **下面**，两者一起挂 `.desktop-shell` 的
 * `background-image`。backdrop 是 CSS 弥散光（无画时它单独成立），
 * art 是整窗手绘场景；`none` 这一档必须给 `none` 而不是空串——
 * 空串会让那一条 `background-image` 语法不成立、整条被丢弃。
 *
 * 【路径为什么写死在这里】
 * 「哪个 id 对哪张图」只有这一处真身。皮肤表里写的是 id，不是路径——
 * 否则一条路径就能从数据里长进 CSS（`file://`、远程 URL 都行）。
 * 相对路径对渲染层根：图在 `src/renderer/public/skins/`，
 * 由 electron-vite 原样拷到产物根的 `skins/`。
 */
const ART_FILES: Record<Exclude<AppearanceArt, "none">, string> = {
  "abyss-hall-night": "skins/abyss-hall-night.webp",
  "shallow-hall-day": "skins/shallow-hall-day.webp",
  /* 波2a（2026-10-08）：三系列 × 昼夜六张，全部是**仓内自绘的矢量场景画**。
     走矢量不是因为位图不好，而是这一批的通路断了：ImageGen 三次复测 403（配额），
     用户自己那批图还没交。与其让广场停在两张上，不如先把「有画可换」这件事做实——
     画的内容、暗区、昼夜同构图仍然照 `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md`
     的硬规则走，只是笔换成了路径。将来他供图或配额恢复，逐张替成位图即可，
     **枚举 id 与皮肤表都不用动**（这正是「路径只住在这一处」换来的解耦）。 */
  "book-boat-night": "skins/book-boat-night.svg",
  "book-boat-day": "skins/book-boat-day.svg",
  "lamp-tower-night": "skins/lamp-tower-night.svg",
  "lamp-tower-day": "skins/lamp-tower-day.svg",
  "ink-pool-night": "skins/ink-pool-night.svg",
  "ink-pool-day": "skins/ink-pool-day.svg"
};

/**
 * 图的 CSS 值。**必须是绝对 URL**，不能只写相对路径（2026-10-08 真机撞出来的）。
 *
 * 【症状】token 上写着 `url("skins/x.jpg")`，DOM 里 `backgroundImage` 也确实含有那一条，
 * 探针一路量到都对——但整窗**仍然是纯色，图根本没出来**，控制台一个字都没有。
 *
 * 【原因】自定义属性里那个 `url()` 是在**消费它的那份样式表**里解析的，不是在文档里。
 * 那份样式表在 `out/renderer/assets/index-*.css`，于是 `skins/x.jpg`
 * 被解析成 `out/renderer/assets/skins/x.jpg` —— 404。而 CSS 对加载失败的背景图
 * 一律当透明处理，于是「没报错」与「什么都没画」两件事同时成立。
 *
 * ⇒ 这里用 `new URL(rel, document.baseURI)` 拿绝对地址再写进去。
 *   顺带一层好处：图挪目录时只改 ART_FILES 一处。
 */
function artImage(art: AppearanceArt): string {
  if (art === "none") return "none";
  const rel = ART_FILES[art];
  // 测试环境（vitest node）里没有 document，退成相对路径：
  // 守卫只断言文件名，运行时那条绝对化由真机那轮验，不在这里假装通过。
  const base = typeof document === "undefined" ? undefined : document.baseURI;
  return `url("${base ? new URL(rel, base).href : rel}")`;
}

/**
 * 画上面那层纱。
 *
 * 【为什么按**皮肤的底色**给，不按明暗判】（2026-10-08 真机撞出来的）
 * 原来按 `isDark` 分了深浅两支，结果「汐 · 夜阁」翻车：
 * 它的浅色版底色本来就是深蓝（那是一套夜里的皮肤），于是在浅色模式下
 * 给了一层**浅色**纱——把画洗白了一片。
 * ⇒ 纱就是这条皮肤自己的底色盖一层：底色深 → 压暗，底色浅 → 提亮，
 *   与当前是浅色还是深色模式无关。正文压在画上时对比度也一定够。
 */
const artVeil = (art: AppearanceArt, paper: string): string =>
  art === "none" ? "transparent" : rgba(paper, 0.22);

/** 供皮肤广场卡片预览与运行时共用：把四层换算成一份可直接内联到 style 的自定义属性表。 */
export function skinStyleVariables(input: {
  backdrop: AppearanceBackdrop;
  glass: AppearanceGlass;
  surface: AppearanceSurface;
  grid: AppearanceGrid;
  /**
   * 画面层。**必填，不给默认**（2026-10-08）。
   *
   * 四层那边没有这一条口径，是因为它们各有各的出厂值可退；
   * 画面层退错了的后果是「一套带画的皮肤悄悄不显示画」——
   * 那正是这一层要解决的那个症状本身，所以宁可编译期红，也不给它默认。
   */
  art: AppearanceArt;
  /** 该套皮肤的强调色——玻璃角落光与对话框压边要用它。 */
  accent: string;
  /** 纹理/图案底色。卡片预览里传皮肤自己的前景色（让图案长在那个色系上）。 */
  ink: string;
  /** 底色。 */
  paper: string;
  scheme: AppearanceColorScheme;
  /**
   * 用户那个「半透明侧栏」开关。**默认 true**。
   *
   * 【为什么它要进来，而不是留在 CSS 里用 data 属性判】
   * 原来 CSS 里有一条 `html[data-translucent-sidebar="true"] .left-sidebar`，
   * 它与皮肤那条 `html[data-theme] .left-sidebar` **同特异性**且写在后面 ⇒ 永远赢。
   * 于是无论皮肤给侧栏配多少模糊，DOM 上量到的永远是那一条写死的 `blur(22px)`。
   * 真机那一轮就是这么红的：token 写着 20px，实际是 22px，**界面看着还挺正常**。
   *
   * ⇒ 「侧栏有多糊」只留一个真身：这个开关在这里折进 token，CSS 那边不再判。
   * 卡片预览没有这个开关（预览块本来就是局部的），所以默认 true。
   */
  translucentSidebar?: boolean;
}): Record<string, string> {
  const glow = UPSTREAM_BACKDROPS[input.backdrop];
  const glass = UPSTREAM_GLASS[input.glass];
  const radius = SURFACE_RADIUS[input.surface];
  const isDark = input.scheme === "dark";
  // 图案在浅底上要反过来压深，否则白线白底等于不存在（端场那两条 .014/.010
  // 是它在暗底上的值，抄到纸底上等于什么都没画）。
  const gridImage = UPSTREAM_GRID[input.grid];
  /* 两块半透底色。**必须在这里算成完整 rgba()，不能让 CSS 自己去 mix**：
     CSS 那边能用的相对颜色语法（从一个自定义属性取出基色再改 alpha）在目标 Electron 上
     不一定成立，而它失败的方式是**整条声明被静默丢弃**——界面退回不透明，
     玻璃看着像没生效，控制台上一个字都没有（5-㊴ 撞过同类的坑）。
     （这一段注释里刻意不写出那个语法的完整写法：`theme-token-guard.test.ts`
       扫的是原文，注释里出现的消费形状照样会被算成「消费了却没定义」。） */
  const glassOn = input.glass !== "none";
  const translucent = input.translucentSidebar ?? true;
  // 关掉半透明时侧栏不糊、也不透 —— 那个开关的原意就是「要一层实底」。
  // 同理，玻璃整档为 none 时侧栏也必须是实底：**写成 alpha 0 会让侧栏整个透掉**，
  // 底下的正文直接透上来（守卫里有一条反向断言钉这个）。
  const sidebarBlur = glassOn && translucent ? glass.sidebarBlur : "0px";
  const sidebarFillAlpha = glassOn && translucent ? glass.sidebarAlpha : "1";
  return {
    "--skin-backdrop": isDark ? glow.dark : glow.light,
    "--skin-art-image": artImage(input.art),
    "--skin-art-veil": artVeil(input.art, input.paper),
    "--skin-glass-blur": glass.blur,
    "--skin-glass-alpha": glass.alpha,
    "--skin-glass-saturate": glass.saturate,
    "--skin-glass-sidebar-blur": sidebarBlur,
    "--skin-glass-sidebar-alpha": glass.sidebarAlpha,
    "--skin-glass-sidebar-content-alpha": glass.sidebarContentAlpha,
    "--skin-glass-floater-blur": glass.floaterBlur,
    "--skin-glass-floater-alpha": glass.floaterAlpha,
    "--skin-glass-capsule-blur": glass.capsuleBlur,
    "--skin-glass-sheen": glassOn ? glassSheen(input.accent, isDark ? 0.1 : 0.06) : "none",
    "--skin-glass-sidebar-fill": mixRgba(
      input.paper,
      input.ink,
      isDark ? 0.05 : 0.02,
      Number(sidebarFillAlpha)
    ),
    "--skin-glass-card-fill": glassOn
      ? mixRgba(input.paper, input.ink, isDark ? 0.075 : 0.028, Number(glass.alpha))
      : mixRgba(input.paper, input.ink, isDark ? 0.075 : 0.028, 1),
    "--skin-radius-sm": radius.sm,
    "--skin-radius-md": radius.md,
    "--skin-radius-lg": radius.lg,
    "--skin-surface": input.surface,
    "--skin-grid-image": gridImage,
    "--skin-grid-blend": input.grid === "none" ? "normal" : isDark ? "screen" : "multiply",
    "--skin-dialogue-gradient":
      input.surface === "dialogue"
        ? DIALOGUE_GRADIENT(input.ink, input.paper, isDark ? 0.7 : 0.42)
        : "none",
    "--skin-dialogue-underline":
      input.surface === "dialogue" ? DIALOGUE_UNDERLINE(input.accent) : "none"
  };
}

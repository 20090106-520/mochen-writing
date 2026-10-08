/**
 * 皮肤广场的**皮肤表**（2026-10-07 批次 5-㊴ 建，5-㊵ 按上游源码重做，5-㊷ 改成只收带画的）。
 *
 * 【批次号为什么是 ㊷ 而不是 ㊶】
 * 本批落笔时工作区里已有一条**未提交**的 5-㊶（中文输入法组合态，另一条线上正在做的活），
 * 台账里也写了它。同号会让两批人在同一份账上撞车，所以本批顺延为 5-㊷，
 * 并在 `docs/superpowers/plans/README.md` 里按 ㊷ 记账。
 *
 * 【5-㊷ 这一刀切掉了什么，以及为什么】
 * 用户看完 5-㊵ 那一版说：「那 15 套没有画的，给去除。加入能有画的和挂件。」
 * 这一句判的正是 5-㊵ 自己已经承认过的东西——四层全是 **CSS 质地**，
 * 换完了读起来仍然是「换了个色调」；真正被一眼认出来的是 `art` 那一层（整窗插画）。
 * ⇒ 广场上现在只有 `art !== "none"` 的皮肤。被下架的十五条分两处安置：
 *   · 十套出厂配色 → `appearanceTones.ts`（**一条数据都没少**，理由与后果写在那份文件头）。
 *   · 五套改编皮 → 条目下架，但它们从上游搬来的**数值与出处全留着**
 *     （`appearanceSkinVisual.ts` 的 `UPSTREAM_*` 常量，每条都注着原文件与行号，
 *     对账守卫是 `appearance-skin-visual.test.ts`）。
 *     为什么不一起删：老用户盘上存着 `glass: "standard"`、`grid: "industrial"` 的，
 *     运行时照样要按上游那一条值渲染；枚举与数值一删，那些人什么也没点，界面却自己变了。
 *
 * 【5-㊴ 那一版为什么被用户否掉】
 * 那一版把上游的视觉语言**概括成四个离散档**（texture/radius/outline/glow 各三四档），
 * 等于自己发明了一套目录。用户看完说「跟他的那些不一样」——
 * 对的，因为丢的正是上游真正在做的事：
 *   · 端场的玻璃是 `blur 8 / 14 / 22px` **三档连续值**，还配 sheen 渐变与 accent 色的角落光
 *     （src/styles/theme.css:380-400）
 *   · 壁纸引擎的玻璃**分区域给参数**：侧栏 / 内容 / 设置窗 / 浮层 各有自己的 alpha 与 blur
 *     （lib/glass-presets/factory-*.json）
 *   · 梦境的背景是**四层 radial-gradient 逐条叠出来的弥散光**，每套都有各自的半径与落点
 *     （tests/fixtures/legacy_skin_glows_10_6_0.json）
 *   · 端场的图案是 `repeating-linear-gradient(0deg, rgba(255,255,255,.014) 0 1px, transparent 1px 4px)`
 *     叠一条 120px 间距的竖线（src/styles/theme.css:1669-1671）
 * 「四档离散值」表达不了上面任何一条。
 *
 * 【做法：数值从上游源码搬，不自己发明】
 * 每条皮肤上标注了**搬的是哪个文件的哪一段**，值本身逐字来自上游源码，
 * 只有「怎么落到墨宸 token 上」是墨宸自己的适配。取值由
 * `appearanceSkinVisual.ts` 里的 `UPSTREAM_*` 常量读出，那儿每条都有出处注释。
 *
 * 【改编自哪些上游，以及为什么是「改编」而不是「搬」】
 * 上游都是 DeepSeek Harness 的插件（`client.js` + Cordis），
 * 依赖 DSH 自己的 `--dsw-*` 令牌与 DOM 结构，在墨宸里**根本跑不起来**。
 * 所以搬的是它们的**视觉算法与参数**，重新实现成墨宸的 token：
 *   d-dev0101/open-sea-skin          公海皮    MIT
 *   RevolutionLA/dsh-dream-skin      梦境皮肤  MIT
 *   ymh0000123/dsh-theme-endfield    终末地    MIT（仅代码；视觉语言版权归鹰角）
 *   Ayase34/gal-view                 galgame   MIT
 *   elysia395/dsh-wallpaper-engine   壁纸引擎  MIT
 *
 * 【两条上游美术的许可结论，以及 5-㊷ 收到的裁定】
 * ① Small-tailqwq/dsh-deep-whale（鲸鱼娘，★2436）：仓库根 LICENSE 写明
 *    「Artwork … excluded from MIT」，美术按 CC BY-NC-SA 4.0、**禁止商业性使用**。
 * ② GGBond2424648901/deep-whale-day-night-theme：整仓 **CC BY-NC-SA 4.0**（不是 MIT），
 *    连代码都不在 MIT 范围内。
 * 这两条不是「没找到」，是核实过许可才暂缓的。
 * 原先这里写过一句「墨宸是能卖钱的写作软件，所以它的插画与壁纸一律不进来」——
 * 那句「要卖」是上一批**我编的**前提，用户 2026-10-08 明确否认过，已删。
 * ⇒ **5-㊷ 裁定到了**：同日问用户「新皮肤的插画素材从哪来」，他选的是
 *   「全部自绘 + 我自己提供图」，**没有选**「把那两套上游美术搬进来」。
 *   所以这两条继续不进表，理由从「等裁定」换成「裁定是走自绘与用户自有图」。
 *   `appearance-skins.test.ts` 里那条「被排除的两个非商用仓库不许出现」因此继续成立，不删。
 */
import {
  APPEARANCE_ARTS,
  APPEARANCE_BACKDROPS,
  APPEARANCE_GLASSES,
  APPEARANCE_GRIDS,
  APPEARANCE_SURFACES,
  type AppearanceArt,
  type AppearanceBackdrop,
  type AppearanceGlass,
  type AppearanceGrid,
  type AppearanceSurface
} from "@mochen/contracts";
/* 三色底版的真身在 `appearanceTones.ts`，这里 re-export 那两个出处常量与 `SkinTone`。
   **同一个概念不开第二个名字**，而既有 import 路径（`appearanceThemeRuntime` 的投影、
   两份守卫）一行都不用改——与 runtime 那边 re-export `skinStyleVariables` 同一套路。 */
import type { SkinTone } from "./appearanceTones";
export { OWN_SKIN_ORIGIN, OWN_SKIN_LICENSE } from "./appearanceTones";
export type { SkinTone };

/**
 * 一条皮肤。`backdrop / glass / surface / grid` 四层质感 + `art` 一层画面，
 * 与 `AppearanceThemeConfig` 上同名的五个字段一一对应（铁律 6：名字不许分家）。
 *
 * **四层与一层不是一回事**（2026-10-08 记）：四层全是 CSS 质地，
 * 换完读起来仍然只是「换了个色调」——用户看皮肤广场时说的就是这一句。
 * `art` 才是被一眼认出来的那层：整窗插画。
 */
export interface AppearanceSkin {
  id: string;
  label: string;
  /** 一句话说清这套皮肤的气质——皮肤广场卡片上那一行。 */
  tagline: string;
  /** 灵感出处。写法与技能市场的 `UPSTREAM` 同一口径：`改编自 <owner>/<repo> 的 <那一套>`。 */
  origin: string;
  /** 许可。代码类上游一律 MIT；被排除的那两条在文件头说明，不在这里出现。 */
  license: string;
  light: SkinTone;
  dark: SkinTone;
  backdrop: AppearanceBackdrop;
  glass: AppearanceGlass;
  surface: AppearanceSurface;
  grid: AppearanceGrid;
  /**
   * 整窗画面。**广场的入场条件就是它不为 `"none"`**（5-㊷）。
   *
   * 这条判据由守卫直接钉在表上（逐条 `art !== "none"`）——因为它一旦松动，
   * 广场就悄悄退回「一堆只改颜色的卡片」，而那正是用户连着两次否掉的东西，
   * 第二次还专门说了「给去除」。
   */
  art: AppearanceArt;
}

/* ── 五层的取值表 ────────────────────────────────────────────────────────
   全部取自 contracts 的枚举，不在这里另写一份字面量——
   加一档时这张表会自己跟着长（铁律 6）。 */

/**
 * 墨宸**原创画面**的出处标记。
 *
 * 【为什么不能复用 OWN_SKIN_ORIGIN】
 * `themePresets` 是「只有三色的出厂配色」那一族。给了「汐」系列同一句出处，
 * 两条带画的皮就被投影进那张表里——而它的消费者只要三色，
 * 多出来的质感四层与画面层各自 ignore，
 * 于是那页里混进了两套含义不同的东西（真机上就是这里红的：10 条变 12 条）。
 *
 * 5-㊷ 之后出厂那十套整个住进 `appearanceTones.ts`，投影也不再从皮肤表里筛，
 * 但**这两句仍然必须分开**：广场里「墨宸原创画面」与「改编自某上游」是两种归属，
 * 许可义务不同（前者本仓自有，后者要注明出处）。
 * 加第三种归属时同样要新开一句，不要往这句话里塞。
 */
export const OWN_ART_ORIGIN = "墨宸原创画面";
export const OWN_ART_LICENSE = "本仓自有";

/**
 * 皮肤广场的全表：**只有带整窗画面的皮肤才进这里**。
 *
 * **顺序就是页面上的顺序**，同系列昼夜成对排（浅色版在前、深色版在后）——
 * 广场卡片按当前明暗渲染预览，同系列挨着才比得出「同一间阁子的白天与夜里」。
 */
export const appearanceSkins: AppearanceSkin[] = [
  /* ── 墨宸自有的「汐」系列（2026-10-08，批次 5-㊵） ──────────────────────
     【这一批为什么存在】
     用户看皮肤广场后说：「我想要的是 DSH 那个趣味换装一样的皮肤，
     而不是只改颜色和字体。」前五条改编皮搬的全是**参数**——玻璃 blur、网格间距、
     弥散光的 alpha。搬得再准，它仍然是 CSS 质地，读起来就是「换了个色调」。
     DSH 那边真正被一眼认出来的是**画**：整窗手绘场景 + 两侧立绘
     （原版 `Small-tailqwq/dsh-deep-whale` 的 `maid-atelier` 一套就带二十多个素材件）。
     ⇒ 这一批给皮肤表加了 `art`（位图），并且**画是墨宸自己设计的**。

     【概念：深渊 × 鲸鱼 × 深海写作阁】
     沉在海底的一间藏书室，两位蓝发鲸耳的姑娘——
     左侧那位站着递卷轴，右侧那位伏在书案前用羽毛笔写稿。
     道具全是**稿子**（卷轴、稿纸、羽毛笔、墨水瓶），不是代码：
     这一条就是「按我的软件设计」与「按那套工具软件设计」的分界。
     中间整片留空，是墨宸三栏（导航 / 对话 / 右栏）要落的位置——
     生图时就把这条写进了 prompt，否则立绘会被面板压掉。

     【为什么两张而不是一张】
     DSH 那套是 `day-night` 主题。昼与夜本来就是这套皮肤的一半，
     顺带把「同一套皮肤要配深浅两版」的老规矩也一并解决了：
     浅色版 = 浅海透光，深色版 = 深蓝压暗，同一套构图。

     【许可：本仓自有】
     画是原创设计，不搬任何上游的美术，
     所以 `origin` 走自家那一句、`license` 写「本仓自有」。 */

  {
    id: "xi-day",
    label: "汐 · 昼阁",
    tagline: "浅海透光的同一间阁子。与夜阁同一套构图，白天看着像晒着太阳的书房。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    /* 浅色版 accent 取 #2A7699 而不是画里那块亮蓝（#2E7FA8）：
       它与白字只有 4.45:1，压在按钮上差一口气不到 4.5:1，
       而按钮上那行字的可读性是由计算说了算的（appearance-theme-readability.test.ts）。 */
    light: { accent: "#2A7699", background: "#E8F6FA", foreground: "#123243" },
    dark: { accent: "#57B7D6", background: "#0E2430", foreground: "#DCF1F8" },
    backdrop: "aurora",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "shallow-hall-day"
  },

  {
    id: "xi-night",
    label: "汐 · 夜阁",
    tagline: "深蓝压暗的海底藏书阁。两位鲸耳姑娘守着稿子，中间整片留给正文。",
    origin: OWN_ART_ORIGIN,
    license: OWN_ART_LICENSE,
    /* 「夜阁」的**浅色版底色本来就是深蓝**（那是一套画在夜里的皮肤）。
       所以画上面那层纱不能按当前是浅色还是深色模式给，要按这条皮肤自己的底色给——
       判据写在 `appearanceSkinVisual.ts` 的 `artVeil` 上，别再改回按 scheme 分支。 */
    light: { accent: "#4FA8C4", background: "#0B1A26", foreground: "#DCEEF5" },
    dark: { accent: "#5FD3EE", background: "#060F18", foreground: "#D6ECF5" },
    backdrop: "abyss",
    glass: "regions",
    surface: "round-none",
    grid: "none",
    art: "abyss-hall-night"
  }
];

/**
 * 按 id 取一套皮肤。取不到返回 undefined（调用方自己决定退路，不在这里兜底成某一套）。
 *
 * 5-㊷ 之后「取不到」多了一种**正常**情形：用户存的是已下架的出厂配色。
 * 那一份要到 `appearanceTones.findAppearanceTone` 去查——
 * AppearancePanel 两处都查，才分得清「这套还在，只是广场不卖了」与「这套我们不认识」。
 */
export function findAppearanceSkin(id: string): AppearanceSkin | undefined {
  return appearanceSkins.find((skin) => skin.id === id);
}

/* ── 筛选档：从**表里真实存在的值**派生 ─────────────────────────────────
   2026-10-08 批次 5-㊷ 改的这条，起因是一个真缺陷。

   【原来错在哪】
   这里原先写的是 `= APPEARANCE_BACKDROPS`（contracts 的全量枚举），
   而 `nebula / ember / midnight` 三档**没有任何皮肤在用**——
   点它必然得到空列表，页面老老实实显示「没有匹配的皮肤」。
   那句话是假象：真相是那枚按钮从一开始就不该在那里。

   ⇒ 判据换成「这一档至少有一条皮肤在用，才摆出来」；
     顺序仍按 contracts 枚举的键序（加一档时 contracts 与中文名表都要改，
     而按钮顺序跟着枚举走，不多一处要人记的地方）。
   ⇒ 守卫钉两件事：每个筛选档都能筛出**非空**结果；这五张表**必须是派生的**，
     不许写死成 contracts 的全量（appearance-skins.test.ts）。
   ⇒ contracts 的枚举与下面的中文名表**仍然是全量**：老 JSON 里存着未入档的合法值时，
     zod 要认、档名要查得到，只是广场不提供它。 */

/** 表里出现过哪些值就只留哪些档；顺序取 `all`（= contracts 枚举）的键序。 */
function usedValues<T extends string>(
  all: readonly T[],
  pick: (skin: AppearanceSkin) => T
): readonly T[] {
  const present = new Set<string>(appearanceSkins.map(pick));
  return all.filter((value) => present.has(value));
}

export const SKIN_BACKDROP_FILTERS: readonly AppearanceBackdrop[] = usedValues(
  APPEARANCE_BACKDROPS,
  (skin) => skin.backdrop
);
export const SKIN_GLASS_FILTERS: readonly AppearanceGlass[] = usedValues(
  APPEARANCE_GLASSES,
  (skin) => skin.glass
);
export const SKIN_SURFACE_FILTERS: readonly AppearanceSurface[] = usedValues(
  APPEARANCE_SURFACES,
  (skin) => skin.surface
);
export const SKIN_GRID_FILTERS: readonly AppearanceGrid[] = usedValues(
  APPEARANCE_GRIDS,
  (skin) => skin.grid
);
/** 画面层这一维在 5-㊷ 之后只剩「有画」那几档：表里不许出现 `art: "none"` 的条目，
 *  所以这张表里要冒出 `none`，就等于上面的表写错了（守卫逐条钉 `art !== "none"`）。 */
export const SKIN_ART_FILTERS: readonly AppearanceArt[] = usedValues(
  APPEARANCE_ARTS,
  (skin) => skin.art
);

/* ── 中文档名 ────────────────────────────────────────────────────────────
   筛选按钮上摆的是这几个词。**真身在这一份**，皮肤广场的模板只 v-for 引用，
   不在模板里写第二遍（写了就会有一处改了另一处没改）。
   键集必须与 contracts 的枚举**一一对应**（守卫钉着）：这里给的是「这一档叫什么」，
   不是「广场上有哪几档」——后者是上面那五张派生表的事。 */

export const APPEARANCE_BACKDROP_LABELS: Record<AppearanceBackdrop, string> = {
  plain: "平涂",
  abyss: "深渊光",
  aurora: "弥散光",
  nebula: "星云光",
  ember: "余烬光",
  midnight: "午夜光"
};

export const APPEARANCE_GLASS_LABELS: Record<AppearanceGlass, string> = {
  none: "无玻璃",
  subtle: "轻磨砂",
  standard: "磨砂",
  strong: "厚玻璃",
  regions: "分区域"
};

export const APPEARANCE_SURFACE_LABELS: Record<AppearanceSurface, string> = {
  plain: "常规",
  square: "全直角",
  "round-none": "胶囊圆角",
  dialogue: "对话框"
};

export const APPEARANCE_GRID_LABELS: Record<AppearanceGrid, string> = {
  none: "无网格",
  industrial: "工业网格",
  stage: "舞台网格"
};

/** 画面层的中文档名。`none` 这一档写「无画面」而不是「无插画」——
 *  它挡掉的是**整窗背景位图**，而 backdrop 那层 CSS 弥散光不受它影响。 */
export const APPEARANCE_ART_LABELS: Record<AppearanceArt, string> = {
  none: "无画面",
  "abyss-hall-night": "深海夜阁",
  "shallow-hall-day": "浅海昼阁"
};

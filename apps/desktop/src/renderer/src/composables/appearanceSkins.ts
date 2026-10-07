/**
 * 皮肤广场的**皮肤表**（2026-10-07 批次 5-㊴ 建，5-㊵ 按上游源码重做）。
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
 * 【这一版的做法：数值从上游源码搬，不自己发明】
 * 每条皮肤上标注了**搬的是哪个文件的哪一段**，值本身逐字来自上游源码，
 * 只有「怎么落到墨宸 token 上」是墨宸自己的适配。取值由
 * `appearanceThemeRuntime` 里的 `UPSTREAM_*` 常量读出，那儿每条都有出处注释。
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
 * 【两条收录前的许可结论，写在这里是因为它们决定了「谁没进来」】
 * ① Small-tailqwq/dsh-deep-whale（鲸鱼娘，★2436）：仓库根 LICENSE 写明
 *    「Artwork … excluded from MIT」，美术按 CC BY-NC-SA 4.0、**禁止商业性使用**。
 *    墨宸是能卖钱的写作软件，所以它的插画与壁纸一律不进来。
 * ② GGBond2424648901/deep-whale-day-night-theme：整仓 **CC BY-NC-SA 4.0**（不是 MIT），
 *    连代码都不在 MIT 范围内 ⇒ 整个不收。
 * 这两条不是「没找到」，是核实过许可后主动排除的。
 */
import {
  APPEARANCE_BACKDROPS,
  APPEARANCE_GLASSES,
  APPEARANCE_GRIDS,
  APPEARANCE_SURFACES,
  type AppearanceBackdrop,
  type AppearanceGlass,
  type AppearanceGrid,
  type AppearanceSurface
} from "@mochen/contracts";

export interface SkinTone {
  accent: string;
  background: string;
  foreground: string;
}

/**
 * 一条皮肤。`backdrop / glass / surface / grid` 四层视觉，
 * 与 `AppearanceThemeConfig` 上同名的四个字段一一对应（铁律 6：名字不许分家）。
 */
export interface AppearanceSkin {
  id: string;
  label: string;
  /** 一句话说清这套皮肤的气质——皮肤广场卡片上那一行。 */
  tagline: string;
  /** 灵感出处。写法与技能市场的 `UPSTREAM` 同一口径：`改编自 <owner>/<repo> 的 <那一套>`。 */
  origin: string;
  /** 许可。代码类上游一律 MIT；被排除的那两个在文件头注释里说明，不在这里出现。 */
  license: string;
  /** 这是墨宸自有的出厂配色（十套原有预设），不是改编来的。 */
  light: SkinTone;
  dark: SkinTone;
  backdrop: AppearanceBackdrop;
  glass: AppearanceGlass;
  surface: AppearanceSurface;
  grid: AppearanceGrid;
}

/* ── 四层的取值表 ────────────────────────────────────────────────────────
   全部取自 contracts 的四个枚举，不在这里另写一份字面量——
   加一档时这张表会自己跟着长（铁律 6）。 */

/* 「墨宸出厂配色」与它的许可——**真身，且必须在 appearanceSkins 之前声明**。

   它不只是给用户看的：`themePresets` 靠 origin === OWN_SKIN_ORIGIN 做投影。
   在下面 plainSkin 里手写一遍字面量就是把那一条判据复制成两份（铁律 6），
   而漂移的后果是「主题配色」里混进改编皮肤，或者投影出零条。

   **为什么必须放在表前面**：下面那个 appearanceSkins 数组是**模块求值期**就跑的，
   它直接调用 plainSkin。声明在数组之后的话，plainSkin 执行时 const 还在 TDZ 里，
   抛的是「before initialization」——语法与类型检查全绿，
   只有真的 import 这个模块才会炸（本批真机前就被它挡下来了）。 */
export const OWN_SKIN_ORIGIN = "墨宸出厂配色";
export const OWN_SKIN_LICENSE = "本仓自有";

function plainSkin(input: {
  id: string;
  label: string;
  tagline: string;
  light: SkinTone;
  dark: SkinTone;
}): AppearanceSkin {
  return {
    ...input,
    // 这两个字面量必须取常量：`themePresets` 靠 origin === OWN_SKIN_ORIGIN 做投影，
    // 在这里手写一遍就等于把那条判据复制成两份（铁律 6）。
    origin: OWN_SKIN_ORIGIN,
    license: OWN_SKIN_LICENSE,
    backdrop: "plain",
    glass: "none",
    surface: "plain",
    grid: "none"
  };
}

/**
 * 皮肤广场的全表。
 *
 * **顺序就是页面上的顺序**，前十条是原有十套配色一字未改（守卫钉着），
 * 后面是从 DSH 换装插件搬来的五套。
 */
export const appearanceSkins: AppearanceSkin[] = [
  /* ── 一、原有的十套配色（批次 5-⑧ 的成果，id 与色值一字不改） ── */
  plainSkin({
    id: "codex",
    label: "Codex",
    tagline: "出厂默认。素面、轻圆角、实线描边，不加任何装饰。",
    light: { accent: "#339CFF", background: "#FFFFFF", foreground: "#1A1C1F" },
    dark: { accent: "#5EACFF", background: "#17191C", foreground: "#F3F4F6" }
  }),
  plainSkin({
    id: "paper",
    label: "暖纸",
    tagline: "纸白底、暖褐强调。写长文时最不刺眼的一套。",
    light: { accent: "#A25D35", background: "#FBF7EF", foreground: "#2E2823" },
    dark: { accent: "#E49B66", background: "#201C19", foreground: "#F7EFE5" }
  }),
  plainSkin({
    id: "ocean",
    label: "海雾",
    tagline: "青灰蓝调，像隔着雾看海。近单色，长时间写不累。",
    light: { accent: "#257F8B", background: "#F4FAFA", foreground: "#193135" },
    dark: { accent: "#5CC3CF", background: "#102124", foreground: "#E5F3F4" }
  }),
  plainSkin({
    id: "mochen-qingjin",
    label: "墨宸 · 青金",
    tagline: "本仓的招牌：浅色纸白配深墨青，深色墨青近黑配金。",
    light: { accent: "#1F5C55", background: "#F7F4EC", foreground: "#242E2B" },
    dark: { accent: "#D4B45A", background: "#101B18", foreground: "#EAE5D6" }
  }),
  plainSkin({
    id: "bamboo",
    label: "竹青",
    tagline: "偏绿的冷调，安静但不压抑。",
    light: { accent: "#357A5C", background: "#F2F7F3", foreground: "#1D2A23" },
    dark: { accent: "#6FC79A", background: "#0E1A14", foreground: "#E0EEE5" }
  }),
  plainSkin({
    id: "dusk",
    label: "暮山紫",
    tagline: "低饱和的紫，像黄昏时山背后的那层光。",
    light: { accent: "#66568F", background: "#F6F4FA", foreground: "#251F33" },
    dark: { accent: "#B3A3E8", background: "#15111E", foreground: "#E7E2F2" }
  }),
  plainSkin({
    id: "ink",
    label: "墨黑",
    tagline: "唯一一套近单色：想让屏幕整个退到后面去时用它。",
    light: { accent: "#2A2E33", background: "#FAFAFA", foreground: "#14171A" },
    dark: { accent: "#DCDCDC", background: "#0A0A0A", foreground: "#F2F2F2" }
  }),
  plainSkin({
    id: "silk",
    label: "绢素",
    tagline: "几乎无色相，最中性。代价是层次感弱。",
    light: { accent: "#7D7263", background: "#FAF9F7", foreground: "#2A2724" },
    dark: { accent: "#C0B39D", background: "#191714", foreground: "#EEE9E0" }
  }),
  plainSkin({
    id: "dai",
    label: "黛蓝",
    tagline: "带点灰的蓝，像染缸里的那层靛。",
    light: { accent: "#2D5A88", background: "#F1F5F9", foreground: "#192532" },
    dark: { accent: "#7FAED9", background: "#0F1720", foreground: "#E0EBF3" }
  }),
  plainSkin({
    id: "crimson",
    label: "绛红",
    tagline: "暗红底、暗红字。只在深色下才压得住。",
    light: { accent: "#9E3838", background: "#FBF4F3", foreground: "#2D1C1C" },
    dark: { accent: "#D67B7B", background: "#1B1212", foreground: "#F1E3E3" }
  }),

  /* ── 二、从 DSH 换装插件搬来的五套 ──
     每条下面都注明「搬的是哪个文件的哪一段」。 */

  /* ① 终末地：搬 src/styles/theme.css 的四样东西，逐样注明。
     - 纸墨三色：`docs/design-language.md` 第一节的表格，#E8E8E2 / #101110 / #F5F5F0 逐字。
       亮色不用纯白、暗色不用纯黑是上游自己写的理由：「带一点暖灰，是纸而不是屏幕」。
     - accent：暗色用上游原值 #FFF500（对纸底 16.50:1）；亮色**不能用**原值——上游文档自己写着
       「在奶油纸底上 #fff500 不是一种配色选择，而是一次抹除」（1.07:1），
       它给的达标值是 #6B5D00，这里直接用上游那个数（5.35:1），不再自己压。
     - 玻璃：`src/styles/theme.css:382-383` 的 `blur 8 / 22px` 与 alpha .68 / .9，
       外加 395-396 行那两道 sheen（145° 线性 + 左上角 accent 色的椭圆光）。
     - 图案：`src/styles/theme.css:1669-1671` 的工业网格（1px 横线 @4px + 1px 竖线 @120px）。
     - 表面：theme.css:423-438 的全直角手法（先清零再恢复圆形元素）。 */
  {
    id: "endfield",
    label: "终末地",
    tagline: "纸墨双色的工业编辑风：全直角、磨砂玻璃、极淡的工程网格。",
    origin: "改编自 ymh0000123/dsh-theme-endfield 的 纸墨色板与玻璃网格",
    license: "MIT",
    light: { accent: "#6B5D00", background: "#E8E8E2", foreground: "#101110" },
    dark: { accent: "#FFF500", background: "#101110", foreground: "#F5F5F0" },
    backdrop: "plain",
    glass: "standard",
    surface: "square",
    grid: "industrial"
  },

  /* ② 梦境皮肤：搬 tests/fixtures/legacy_skin_glows_10_6_0.json 里的弥散光整条。
     上游那 8 套皮肤各自有一句完整的 CSS 背景：两层 accent 色 radial 落在
     右上（1100×620 @82% -8%）与左下（820×520 @10% 110%），
     叠一层压暗的 radial（1300×820 @48% 44%），最后压一条 linear-gradient 底色。
     这里的 `backdrop: "aurora"` 就是这个形状——**整条渐变的参数在 appearanceThemeRuntime
     的 `UPSTREAM_BACKDROPS` 里，值逐条抄自那份 fixture**，不是「紫蓝渐变」四个字。

     色值：accent 取那条 radial 里的 #2DD4BF 一族（上游 sample-theme-pack.json 的
     `accent: #34d399` 同色系），底色取那条 linear-gradient 的 #0F151A 端。
     上游皮肤是纯暗色的，墨宸每套必须配深浅两版 ⇒ 浅色版是墨宸自己配的（同色相提亮）。 */
  {
    id: "mirage",
    label: "幻境",
    tagline: "四层弥散光铺在背后，玻璃浮在上面。右上青、左下蓝的一组对撞。",
    origin: "改编自 RevolutionLA/dsh-dream-skin 的 弥散光背景与玻璃",
    license: "MIT",
    light: { accent: "#1C7D71", background: "#F2FAF8", foreground: "#122E2A" },
    dark: { accent: "#2DD4BF", background: "#0F151A", foreground: "#E8F4F2" },
    backdrop: "aurora",
    glass: "subtle",
    surface: "plain",
    grid: "none"
  },

  /* ③ 公海皮：搬 shared/styles.css 的玻璃芯与暗角，逐行注明。
     - 玻璃芯：styles.css:99-103 那四行——底 `rgba(8,11,16,.55)`、
       `blur(24px) saturate(140%)`、`inset 0 1px 0 rgba(255,255,255,.12)` 高光。
       saturate(140%) 是上游给的值，墨宸按同一比例落在 `--skin-glass-saturate`。
     - 暗角：styles.css:59-61 的双层 radial + linear（边缘压深、底部再压一层）。
     - 色值：#8FE9E4 是上游 :root 里的 accent 原值（styles.css:28），墨宸沿用。
       底色那个 #05070A 太黑，墨宸深色背景最深到 #0A0A0A 这条规矩在上，
       于是取上游 --bg 提亮一档到 #0A1418（仍在规矩内）。 */
  {
    id: "open-sea",
    label: "公海",
    tagline: "高饱和玻璃加一圈暗角。界面像浮在海面上，而不是贴在屏幕上。",
    origin: "改编自 d-dev0101/open-sea-skin 的 玻璃芯与暗角",
    license: "MIT",
    light: { accent: "#1D6FA3", background: "#F2F9FC", foreground: "#12303F" },
    dark: { accent: "#8FE9E4", background: "#0A1418", foreground: "#DEF0F8" },
    backdrop: "plain",
    glass: "strong",
    surface: "round-none",
    grid: "none"
  },

  /* ④ galgame：搬 .dsh-plugin/client/styles.mjs 的对话框底与舞台网格，逐行注明。
     - 对话框底：styles.mjs:54 的 `linear-gradient(180deg, rgba(20,24,44,.7), rgba(14,17,34,.35))`
       —— 上半段压深、下半段透出来，这是它对话框的招牌。
     - 舞台网格：styles.mjs:123-124 两条 1px 线（横竖各一），透明度 .10。
     - 对话框内衬：styles.mjs:416 的 `inset 0 -4px 0 rgba(79,140,255,.55)`，
       即底部一条 4px 的实心压边——`surface: "dialogue"` 就是它。
     - 上游明确写了它**不启用 backdrop-filter**（styles.mjs:200 的注释：毛玻璃会把背后
       立绘的透明区复合成实心块），所以这套的 glass 给 `none`，照上游的判断走。 */
  {
    id: "galgame",
    label: "视窗",
    tagline: "对话框质感：上下分层的底、底部一条实心压边、舞台网格打底。",
    origin: "改编自 Ayase34/gal-view 的 对话框底与舞台网格",
    license: "MIT",
    light: { accent: "#8A7BD8", background: "#FAF8F4", foreground: "#22283A" },
    dark: { accent: "#F0A0BC", background: "#1F1219", foreground: "#F3E2E9" },
    backdrop: "plain",
    glass: "none",
    surface: "dialogue",
    grid: "stage"
  },

  /* ⑤ 壁纸引擎：搬 lib/glass-presets/factory-*.json 的**分区域**参数，逐字段注明。
     上游那份预设不是「一个透明度 + 一个模糊」，而是每个区域各一套：
       glass 45 / blur 36、sidebar 50 / blur 30、sidebarContent 42、
       settings 55 / blur 32、floaters 55 / blur 32、capsule blur 16、fidelity 100
     这就是 `glass: "regions"` 这一档的来历——墨宸的侧栏、内容区、浮层各读各的值，
     而不是整页一个 blur。`factory-night.json` 的侧栏 55/24、内容 38 与
     `factory-readable.json` 的 55/20、内容 30 是两个可直接用的真实档，这里取后者的配比。
     色值取 vivid 那套的 #67DCE7 提亮到可读域（上游那个值在白底上过不了 2.5:1）。 */
  {
    id: "liquid-glass",
    label: "流玻璃",
    tagline: "每个区域各有一档玻璃：侧栏透、正文实、浮层最实。层次是分区域给的。",
    origin: "改编自 elysia395/dsh-wallpaper-engine 的 分区域玻璃参数",
    license: "MIT",
    light: { accent: "#1F6E7A", background: "#F1F7F8", foreground: "#10262C" },
    dark: { accent: "#67C7D6", background: "#0A1C21", foreground: "#DCF2F6" },
    backdrop: "plain",
    glass: "regions",
    surface: "plain",
    grid: "none"
  }
];

/** 按 id 取一套皮肤。取不到返回 undefined（调用方自己决定退路，不在这里兜底成某一套）。 */
export function findAppearanceSkin(id: string): AppearanceSkin | undefined {
  return appearanceSkins.find((skin) => skin.id === id);
}

/**
 * 四层的**全部取值**（皮肤广场的筛选档）。
 *
 * **从 contracts 的枚举派生，不在这里另写一份清单**（铁律 6）：
 * 加一档时这张表会自己变长，而守卫也正是拿它与 contracts 对齐。
 */
export const SKIN_BACKDROP_FILTERS: readonly AppearanceBackdrop[] = APPEARANCE_BACKDROPS;
export const SKIN_GLASS_FILTERS: readonly AppearanceGlass[] = APPEARANCE_GLASSES;
export const SKIN_SURFACE_FILTERS: readonly AppearanceSurface[] = APPEARANCE_SURFACES;
export const SKIN_GRID_FILTERS: readonly AppearanceGrid[] = APPEARANCE_GRIDS;

/* ── 中文档名 ────────────────────────────────────────────────────────────
   筛选按钮上摆的是这几个词。**真身在这一份**，皮肤广场的模板只 v-for 引用，
   不在模板里写第二遍（写了就会有一处改了另一处没改）。 */

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

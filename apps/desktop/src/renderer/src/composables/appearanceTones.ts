/**
 * 墨宸的**出厂配色底版**（2026-10-08 批次 5-㊷ 从皮肤表里拆出来）。
 *
 * 【这一份为什么存在，而不是直接删掉那十套】
 * 5-㊷ 把皮肤广场改成「只收带画的皮肤」，那十套素面配色与五套改编皮一起从广场下架。
 * 但「下架」不等于「销毁数据」，这三件事都还指着这一份文件：
 *
 * ① **用户盘上存的就是它们。** 十套 id 与三色从批次 5-⑧ 起就一字未改地写进了
 *    各人的 `appearance.json`。`AppearanceThemeConfig` 里的 accent/background/foreground
 *    是真身，皮肤表只是「怎么挑」的目录——所以就算目录里没有这一条，
 *    人家的界面也照样按存的那套走。这里把十套留着，是为了让界面**还能认出那一套叫什么**
 *    （AppearancePanel 要说「出厂配色 · 暖纸（已从广场下架）」，
 *    而不是「未知的一套」——后者会把「我们主动下架」说成「我不认识你存的东西」。
 *
 * ② **`themePresets` 的唯一真身在这里。** 它是「主题配色」那一族的投影源。
 *    投影原先长在 `appearanceSkins.filter(origin === OWN_SKIN_ORIGIN)` 上，
 *    而表里一旦不剩素面皮，那条投影就变成**零条**——
 *    于是 `appearance-theme-readability.test.ts` 里那句 `for (const preset of themePresets)`
 *    退化成**空遍历**：它照样全绿，却一条也没测。那正是本仓反复钉的「假绿」。
 *    ⇒ 数字必须有一份不依赖皮肤表的存在，守卫才有的可遍历。
 *
 * ③ **加回一套素面皮时只改这一处。** 与皮肤表的关系是「底版 ⊂ 可选配色」，
 *    不是两份配色（铁律 6：一份真相不许有两个名字）。
 *
 * 【这一份里为什么没有视觉四层】
 * 底版只有三色：四层（背景/玻璃/表面/图案）与画面层是**皮肤**才有的东西。
 * 老 JSON 里没有那五个字段时由 contracts 补素面默认值，
 * 所以一份只有三色的底版恰好就是「升级前的观感」，不需要在这里重复写五层。
 */

/** 一套配色底的三色：强调色、底色、前景色。名字与 `AppearanceSkin` 上那一对齐。 */
export interface SkinTone {
  accent: string;
  background: string;
  foreground: string;
}

export interface AppearanceTone {
  id: string;
  label: string;
  /** 一句话说清这套配色的气质。 */
  tagline: string;
  light: SkinTone;
  dark: SkinTone;
}

/**
 * 出厂配色的出处与许可。
 *
 * **名字沿用 `OWN_SKIN_ORIGIN` / `OWN_SKIN_LICENSE`**（不另起一个新名字）：
 * `themePresets` 的投影判据、外观页那句「墨宸出厂配色」都已经在用这两个词，
 * 换名等于给同一个概念开第二个名字。下面 appearanceSkins 里还 re-export 一次，
 * 既有 import 路径一行都不用改——与 `skinStyleVariables` 那处 re-export 同一套路。
 */
export const OWN_SKIN_ORIGIN = "墨宸出厂配色";
export const OWN_SKIN_LICENSE = "本仓自有";

/**
 * 十套出厂配色。**id、顺序与色值自批次 5-⑧ 起一字未改**——
 * 它们已经存进用户盘上的 appearance.json，改任何一个都是把别人的主题改掉。
 */
export const appearanceTones: AppearanceTone[] = [
  {
    id: "codex",
    label: "Codex",
    tagline: "出厂默认。素面、轻圆角、实线描边，不加任何装饰。",
    light: { accent: "#339CFF", background: "#FFFFFF", foreground: "#1A1C1F" },
    dark: { accent: "#5EACFF", background: "#17191C", foreground: "#F3F4F6" }
  },
  {
    id: "paper",
    label: "暖纸",
    tagline: "纸白底、暖褐强调。写长文时最不刺眼的一套。",
    light: { accent: "#A25D35", background: "#FBF7EF", foreground: "#2E2823" },
    dark: { accent: "#E49B66", background: "#201C19", foreground: "#F7EFE5" }
  },
  {
    id: "ocean",
    label: "海雾",
    tagline: "青灰蓝调，像隔着雾看海。近单色，长时间写不累。",
    light: { accent: "#257F8B", background: "#F4FAFA", foreground: "#193135" },
    dark: { accent: "#5CC3CF", background: "#102124", foreground: "#E5F3F4" }
  },
  {
    id: "mochen-qingjin",
    label: "墨宸 · 青金",
    tagline: "本仓的招牌：浅色纸白配深墨青，深色墨青近黑配金。",
    light: { accent: "#1F5C55", background: "#F7F4EC", foreground: "#242E2B" },
    dark: { accent: "#D4B45A", background: "#101B18", foreground: "#EAE5D6" }
  },
  {
    id: "bamboo",
    label: "竹青",
    tagline: "偏绿的冷调，安静但不压抑。",
    light: { accent: "#357A5C", background: "#F2F7F3", foreground: "#1D2A23" },
    dark: { accent: "#6FC79A", background: "#0E1A14", foreground: "#E0EEE5" }
  },
  {
    id: "dusk",
    label: "暮山紫",
    tagline: "低饱和的紫，像黄昏时山背后的那层光。",
    light: { accent: "#66568F", background: "#F6F4FA", foreground: "#251F33" },
    dark: { accent: "#B3A3E8", background: "#15111E", foreground: "#E7E2F2" }
  },
  {
    id: "ink",
    label: "墨黑",
    tagline: "唯一一套近单色：想让屏幕整个退到后面去时用它。",
    light: { accent: "#2A2E33", background: "#FAFAFA", foreground: "#14171A" },
    dark: { accent: "#DCDCDC", background: "#0A0A0A", foreground: "#F2F2F2" }
  },
  {
    id: "silk",
    label: "绢素",
    tagline: "几乎无色相，最中性。代价是层次感弱。",
    light: { accent: "#7D7263", background: "#FAF9F7", foreground: "#2A2724" },
    dark: { accent: "#C0B39D", background: "#191714", foreground: "#EEE9E0" }
  },
  {
    id: "dai",
    label: "黛蓝",
    tagline: "带点灰的蓝，像染缸里的那层靛。",
    light: { accent: "#2D5A88", background: "#F1F5F9", foreground: "#192532" },
    dark: { accent: "#7FAED9", background: "#0F1720", foreground: "#E0EBF3" }
  },
  {
    id: "crimson",
    label: "绛红",
    tagline: "暗红底、暗红字。只在深色下才压得住。",
    light: { accent: "#9E3838", background: "#FBF4F3", foreground: "#2D1C1C" },
    dark: { accent: "#D67B7B", background: "#1B1212", foreground: "#F1E3E3" }
  }
];

/** 按 id 取一套出厂配色。取不到返回 undefined，调用方自己决定退路。 */
export function findAppearanceTone(id: string): AppearanceTone | undefined {
  return appearanceTones.find((tone) => tone.id === id);
}

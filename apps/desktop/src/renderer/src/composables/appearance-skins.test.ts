/**
 * 皮肤广场的守卫（2026-10-07 批次 5-㊴ 建，5-㊵ 换了四层并改钉）。
 *
 * 5-㊵ 为什么要改钉：用户看完 5-㊴ 的成果说「跟他的那些不一样」——
 * 那一版把上游的视觉语言概括成四个自造的离散档，丢掉的正是上游真正在做的事
 * （弥散光的四层渐变、玻璃的连续 blur 值、分区域参数）。
 * 所以四层换了名字与内容，下面凡钉着旧四层的守卫都改成钉新决定。
 *
 * 这一批真正的风险不在「颜色好不好看」，而在五处：
 * ① **两份真相**：配色一旦在皮肤表与 themePresets 各写一份，迟早漂移；
 * ② **许可**：改编来的皮肤必须能说清抄自哪个仓库、按什么许可，
 *    而 CC BY-NC-SA / 禁商用那类在**用户裁定前**不进来（原注释的理由「墨宸是能卖钱的软件」
 *    是我编的前提，用户 2026-10-08 明确否认过，见本文件下面那条守卫的更正）；
 * ③ **可读性**：新增五套配色必须由可读性守卫算过，不是「看着挺舒服」；
 * ④ **接线**：`.vue` 零类型检查（verify 用裸 tsc，vue-shim 把 *.vue 当 any），
 *    于是「这一页到底接没接上」只能钉成读源码断言；
 * ⑤ **静默失效**：CSS 非法值不报错只是被丢掉（5-㊴ 真机撞过 `rgb(#hex / a)`），
 *    所以凡是「搬上游的渐变」都要钉颜色段的形状，不能只钉「有没有渐变」。
 *
 * 5-㊷ 又加了两个属于「改了写法才会暴露」的风险：
 * ⑥ **空遍历假绿**：出厂那十套从皮肤表搬进底版表之后，
 *    任何一句 `for (const x of themePresets)` 之类的遍历，一旦投影源筛空就全绿而一条不测。
 *    ⇒ 下面凡遍历处都先钉「这一族非空」，并另有一条变异验证过它真会红。
 * ⑦ **死档**：筛选按钮原先铺 contracts 的全量枚举，而 `nebula / ember / midnight`
 *    没有任何皮肤在用——点它得空列表，页面显示「没有匹配的皮肤」，
 *    看着像用户筛错了，其实是那枚按钮不该存在。
 *    ⇒ 档改成从皮肤表派生，下面逐档钉「筛得出东西」。
 */
import { describe, expect, it } from "vitest";
import {
  APPEARANCE_ARTS,
  APPEARANCE_BACKDROPS,
  APPEARANCE_GLASSES,
  APPEARANCE_GRIDS,
  APPEARANCE_SURFACES,
  AppearanceSettingsSchema,
  createDefaultAppearanceTheme
} from "@mochen/contracts";
import {
  APPEARANCE_ART_LABELS,
  APPEARANCE_BACKDROP_LABELS,
  APPEARANCE_GLASS_LABELS,
  APPEARANCE_GRID_LABELS,
  APPEARANCE_SURFACE_LABELS,
  OWN_ART_ORIGIN,
  SKIN_ART_FILTERS,
  SKIN_BACKDROP_FILTERS,
  SKIN_GLASS_FILTERS,
  SKIN_GRID_FILTERS,
  SKIN_SURFACE_FILTERS,
  appearanceSkins,
  defaultAppearanceSkin,
  findAppearanceSkin,
  type AppearanceSkin
} from "./appearanceSkins";
// 5-㊷ 之后四层的**数值**守卫搬到 appearance-skin-visual.test.ts（它们是「要跟上游对账」的部分）；
// 「读 .vue 与 .css 源码」那一半在 appearance-skin-plaza-wiring.test.ts。
// 2026-10-08 第二刀：`appearanceTones.ts`（十套素面底版）与 `themePresets`（它的投影）**整族删除**，
// 所以这里既不再 import 那两份，也没有「投影 vs 底版」那一组对账可钉了——
// 取而代之的是下面「素面那一族不许复活」那条反向守卫。
import { typeScriptSource, scriptSource } from "../utils/vue-source-reader";

const HEX = /^#[\da-f]{6}$/i;

/* 守卫里另写一份这两个字面量，**不从被测代码 import**。
   从 appearanceSkins import 的话，它哪天把判定改成第三个值，守卫会跟着改然后继续全绿——
   那不是守卫，是一个会跟着被测对象一起改的摆设（批次 5-㊱ 记过这一族）。 */
const OWN_LICENSE_LITERAL = "本仓自有";
/** 改编皮出处的固定前缀。**声明在这里，不从 appearanceSkins import**——
 *  出处那句将来可能再拆（2026-10-08 已经从一种自有皮拆到两种），
 *  而守卫要的判据是**形状**（带不带这个前缀），不是某一句具体的话。
 *  刻意不写「必须等于某一句」：那会把「多加一种自有皮」变成一次红。 */
const ADAPTED_PREFIX = "改编自 ";

/* 上游仓库的许可结论（批次 5-㊴ 逐个用 GitHub API 查过 LICENSE 原文）：
     d-dev0101/open-sea-skin          MIT
     RevolutionLA/dsh-dream-skin      MIT
     ymh0000123/dsh-theme-endfield    MIT（仅代码；视觉语言版权归鹰角）
     Ayase34/gal-view                 MIT
     elysia395/dsh-wallpaper-engine   MIT */
const ALLOWED_UPSTREAM_REPOS = [
  "d-dev0101/open-sea-skin",
  "RevolutionLA/dsh-dream-skin",
  "ymh0000123/dsh-theme-endfield",
  "Ayase34/gal-view",
  "elysia395/dsh-wallpaper-engine"
];

describe("皮肤表 · 形状", () => {
  /* 5-㊷：广场只收带画的皮肤，条数从 17 降到 2（汐·昼阁 / 汐·夜阁）。
     波2a（2026-10-08）按用户那句「然后再继续增加」加到 8：三系列 × 昼夜。
     数字继续钉死——加一套就红一次，逼人回来看下面那条入场判据还成不成立，
     并且**顺手把素材守卫那份也认一遍**：新加的每一档都得有真文件在盘上
     （appearance-skin-assets.test.ts），不是把名字加进枚举就算有了画。 */
  it("八条皮肤，id 与名字都不重", () => {
    expect(appearanceSkins).toHaveLength(8);
    const ids = appearanceSkins.map((one) => one.id);
    const labels = appearanceSkins.map((one) => one.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  /**
   * **这一条是 5-㊷ 那一刀的全部含义**，所以它必须直接钉在表上。
   *
   * 【它防的是什么】
   * 用户两次否掉同一件事：「我想要的是 DSH 那个趣味换装一样的皮肤，
   * 而不是只改颜色和字体」，第二次说得更狠——「那 15 套没有画的，给去除」。
   * 四层（背景/玻璃/表面/图案）全是 CSS 质地，往表里再塞一条 `art: "none"` 的皮，
   * 页面上就又出现一张「只换了个色调」的卡片，而这**不会有任何一处报错**：
   * id 不重、色值合法、四层都在枚举里，上面每条守卫照样全绿。
   *
   * ⇒ 判据单独钉一遍。它一红，就是在往广场里放没画的东西。
   */
  it("每一条都必须带整窗画面（art 不许为 none —— 这是广场的入场条件）", () => {
    for (const skin of appearanceSkins) {
      expect(skin.art, `${skin.id} 没有画面，不该进皮肤广场`).not.toBe("none");
      expect(APPEARANCE_ART_LABELS[skin.art], `${skin.id} 的画面档没有中文名`).toBeTruthy();
    }
    // 反向：**画面层的筛选档里也不许出现 none**——它一出现就说明表里混进了没画的皮。
    expect(SKIN_ART_FILTERS, "筛选档里出现了「无画面」").not.toContain("none");
  });

  it("表里的每条都是本仓自有素材（上游美术按裁定不进表）", () => {
    /* 5-㊷ 用户裁定的素材来源是「全部自绘 + 我自己提供图」，**没有选**「把鲸鱼娘那两套
       上游美术搬进来」。所以带画的皮全部是自有素材，出处只有 `OWN_ART_ORIGIN` 一句。
       这条与下面那条「被排除的非商用仓库不许出现」是一对：
       一句钉「只能是谁」，一句钉「绝对不能是谁」。
       若将来裁定改了、允许搬某一上游，这两条要**一起**改，不许只改短下面那条名单。 */
    for (const skin of appearanceSkins) {
      expect(skin.origin, `${skin.id} 的出处不是自有素材`).toBe(OWN_ART_ORIGIN);
    }
  });

  it("每条都带合法的浅/深两套三色，以及非空的说明与出处", () => {
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        expect(skin[scheme].accent, `${skin.id} ${scheme} accent`).toMatch(HEX);
        expect(skin[scheme].background, `${skin.id} ${scheme} background`).toMatch(HEX);
        expect(skin[scheme].foreground, `${skin.id} ${scheme} foreground`).toMatch(HEX);
      }
      expect(skin.tagline.length, `${skin.id} 的说明是空的`).toBeGreaterThan(4);
      expect(skin.origin.length, `${skin.id} 的出处是空的`).toBeGreaterThan(4);
    }
  });

  it("视觉四层的取值必须落在 contracts 的枚举里（不许自己造值）", () => {
    for (const skin of appearanceSkins) {
      expect(APPEARANCE_BACKDROPS, `${skin.id} 的背景`).toContain(skin.backdrop);
      expect(APPEARANCE_GLASSES, `${skin.id} 的玻璃`).toContain(skin.glass);
      expect(APPEARANCE_SURFACES, `${skin.id} 的表面`).toContain(skin.surface);
      expect(APPEARANCE_GRIDS, `${skin.id} 的图案`).toContain(skin.grid);
    }
  });

  it("中文名表与 contracts 的枚举一一对应（加一档时两处都要改，少一处就红）", () => {
    expect(Object.keys(APPEARANCE_BACKDROP_LABELS).sort()).toEqual(
      [...APPEARANCE_BACKDROPS].sort()
    );
    expect(Object.keys(APPEARANCE_GLASS_LABELS).sort()).toEqual([...APPEARANCE_GLASSES].sort());
    expect(Object.keys(APPEARANCE_SURFACE_LABELS).sort()).toEqual([...APPEARANCE_SURFACES].sort());
    expect(Object.keys(APPEARANCE_GRID_LABELS).sort()).toEqual([...APPEARANCE_GRIDS].sort());
  });
});

/* ── 2026-10-08 第二刀：素面那一族整族删除之后，这里钉的是「不许复活」 ──────
   【为什么这一组从「十套底版一字未改」换成反向守卫】
   5-㊷ 的处置是**下架但不销毁**：十套素面配色搬进 `appearanceTones.ts` 继续当
   「设置 · 外观」的配色底版，出厂默认也留在那一族里（`preset: "codex"`、
   `skin: "plain"`、`art: "none"`），面板还给它们留了一级兜底文案。
   用户看完推翻：「我没说明白吗，把没有皮肤没有图片的全删了，只保留有图片有皮肤的。」
   ⇒ 底版表连同它派生的 `themePresets` 一起删。于是这里要守的不再是**值没变**，
     而是**别把它写回来**——反向钉不存在，比正向钉内容更贴这次的裁定。

   【为什么这些断言不是摆设】
   ① `typeScriptSource` 读不到文件是**抛错**（见 vue-source-reader 的文件头），
      所以 `toThrow()` 就是「文件确实没了」的直接证据；把文件还原它就红。
   ② 只删文件不够。真正会悄悄复活的是**界面上那句解释**——「素面配色，不在广场里卖」
      一留下，就等于对着老 id 说「你存的那套只是下架了」，而它已经被删了。
      ⇒ 逐份源文件反向钉（读的是剥掉注释的 script 段：注释里写「这句话已经没了」
        本身含这句话，正向读原文会被反咬，见 vue-source-reader 的 `strippedStyleSource` 那段教训）。 */
describe("素面那一族 · 已整族删除，不许复活", () => {
  it("appearanceTones.ts 这份文件已经不存在", () => {
    expect(() => typeScriptSource("composables/appearanceTones.ts")).toThrow();
  });

  it("appearanceThemeRuntime.ts 里 themePresets 与 ThemePreset 两个符号都已删除", () => {
    const runtime = typeScriptSource("composables/appearanceThemeRuntime.ts");
    expect(runtime).not.toMatch(/export const themePresets/);
    expect(runtime).not.toMatch(/(?:interface|type) ThemePreset\b/);
  });

  it("广场里没有一条素面皮，也没有一条复用已下架的素面 id", () => {
    expect(appearanceSkins.length, "广场空了 —— 下面这几条会全绿而一条不测").toBeGreaterThan(0);
    /* RETIRED_TONE_IDS 是**守卫里另抄的一份字面量**，不从被测代码 import：
       判据要钉的是「这十个名字属于已删的那一族」这个事实，而那张表已经没有真身可读了。 */
    const retired_tone_ids = [
      "codex",
      "paper",
      "ocean",
      "mochen-qingjin",
      "bamboo",
      "dusk",
      "ink",
      "silk",
      "dai",
      "crimson"
    ];
    for (const skin of appearanceSkins) {
      expect(skin.art, `${skin.id} 没有画面，却又回到了广场`).not.toBe("none");
      expect(
        retired_tone_ids,
        `${skin.id} 复用了已下架的素面 id —— 老 JSON 里存着这个名字，回落通路会被它骗过去`
      ).not.toContain(skin.id);
    }
    // 回落触发的前提：这些 id 在广场表里查不到。哪天有人把它们加回表，这里先红。
    expect(findAppearanceSkin("codex"), "素面 id 又能查到了 —— store 的回落会失效").toBeUndefined();
    expect(
      findAppearanceSkin(defaultAppearanceSkin.id),
      "回落点自己不在广场表里 —— 回落会变成「换一套也查不到」"
    ).toBeDefined();
  });

  it("界面上不许再出现「下架但配色还在」那一句兜底文案", () => {
    for (const file of [
      "components/AppearancePanel.vue",
      "components/SkinGalleryPage.vue",
      "stores/useAppearanceStore.ts",
      "composables/appearanceSkinPreview.ts",
      "composables/appearanceThemeRuntime.ts"
    ]) {
      const source = file.endsWith(".vue") ? scriptSource(file) : typeScriptSource(file);
      expect(source, `${file} 里还留着「配色底版」那一族的说法`).not.toContain(
        "素面配色，不在广场里卖"
      );
      expect(source, `${file} 里还去查已删的底版表`).not.toContain("findAppearanceTone");
    }
  });
});

/* ── 第二刀之后，上游那批层档名**只剩一条留下来的理由** ────────────────────
   5-㊷ 给的理由是「老用户盘上存着 glass: "standard"、grid: "industrial"，运行时照样要按
   那一条值渲染」。第二刀的回落（`reconcileStoredSkin` → `patchSettingsWithSkin`）把
   四层连同三色整份覆写，那条理由已经不成立——成立的是**另一条**：
   这些档名过不了 zod，整份 appearance.json 就会被判非法并退回默认
   （`appearance-store.test.ts` 钉的就是这个退法），那些人什么也没点，
   却连「你原来那套已经删除」这句都听不到。枚举与数值表是为了**解析得动**才留着的。
   【为什么这两条要分开钉】
   只钉「解析得动」的话，哪天有人给界面加了逐层选择器（那时这些档名就真的会上屏了），
   这条守卫不会提醒他改口；所以再钉一条「除了昼阁复用的 aurora，没有一条皮肤在用它们」，
   把它当前真实的消费面钉死。 */
describe("上游层档名 · 现在只为「老 JSON 解析得动」而存在", () => {
  /** 一份「老盘上的 JSON」：存着已删的素面 id，四层全是当年那五套改编皮用的档名。 */
  function legacyStored(): unknown {
    return {
      mode: "light",
      light: {
        ...createDefaultAppearanceTheme("light"),
        preset: "codex",
        skin: "codex",
        backdrop: "nebula",
        glass: "standard",
        surface: "square",
        grid: "industrial",
        art: "none"
      },
      dark: {
        ...createDefaultAppearanceTheme("dark"),
        preset: "codex",
        skin: "codex",
        backdrop: "midnight",
        glass: "strong",
        surface: "dialogue",
        grid: "stage",
        art: "none"
      },
      uiFontFamily: "system",
      editorFontFamily: "song"
    };
  }

  it("那些档名逐条仍在 contracts 的枚举里（少一条，老 JSON 整份解析失败）", () => {
    expect(APPEARANCE_BACKDROPS).toEqual(expect.arrayContaining(["nebula", "ember", "midnight"]));
    expect(APPEARANCE_GLASSES).toEqual(expect.arrayContaining(["subtle", "standard", "strong"]));
    expect(APPEARANCE_SURFACES).toEqual(expect.arrayContaining(["square", "dialogue"]));
    expect(APPEARANCE_GRIDS).toEqual(expect.arrayContaining(["industrial", "stage"]));
    // 画面层也留着 "none"：老 JSON 存的就是它，删了同样过不了 schema。
    expect(APPEARANCE_ARTS).toContain("none");
  });

  it("这份「老盘上的 JSON」现在仍然 safeParse 得过", () => {
    const result = AppearanceSettingsSchema.safeParse(legacyStored());
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true);
  });

  it("消费面只剩一条：除昼阁复用的 aurora，这些档名没有皮肤在用", () => {
    expect(appearanceSkins.length, "广场空了 —— 下面这几条会全绿而一条不测").toBeGreaterThan(0);
    const used = [
      ...new Set(
        appearanceSkins.flatMap((skin) => [skin.backdrop, skin.glass, skin.surface, skin.grid])
      )
    ].sort();
    expect(used, "有皮肤用起了当年那些改编档名 —— 上面「只为解析而留」的说法要跟着改口").toEqual([
      "abyss",
      "aurora",
      "none",
      "regions",
      "round-none"
    ]);
    // aurora 是那五套搬来的档名，却活在昼阁身上：数值表不是纯粹的历史包袱，这条是它唯一的活消费。
    expect(defaultAppearanceSkin.backdrop).toBe("aurora");
  });
});

describe("皮肤表 · 出处与许可", () => {
  it("自有皮许可是「本仓自有」，改编皮是 MIT，且两类互斥且都有归属", () => {
    /* 【为什么判据是「带不带改编前缀」而不是「等于某一句出处」】
       原写法是 `skin.origin === "墨宸出厂配色"`，它把「自有皮」等同于**那一句**。
       加上原创画面皮（出处是另一句）之后，那两条既不等于出厂那一句、
       也不带改编前缀，于是被夹在中间——一条断言要求它们 `license === "MIT"`，
       而它们的许可是「本仓自有」。红的位置离病因很远。

       ⇒ 改成**结构判据**：带「改编自 」前缀的是改编皮，其余都是自有皮。
         这样再加第几种自有皮都不用改守卫，而「两类互斥且都有归属」由下面两条守住。 */
    let ownCount = 0;
    let adaptedCount = 0;
    for (const skin of appearanceSkins) {
      if (skin.origin.startsWith(ADAPTED_PREFIX)) {
        adaptedCount += 1;
        expect(skin.license, `${skin.id} 是改编皮（出处「${skin.origin}」），许可却不是 MIT`).toBe(
          "MIT"
        );
      } else {
        ownCount += 1;
        expect(
          skin.license,
          `${skin.id} 的出处「${skin.origin}」不带改编前缀，所以它是自有皮，许可必须是「${OWN_LICENSE_LITERAL}」`
        ).toBe(OWN_LICENSE_LITERAL);
      }
    }
    // 数字钉死：加皮肤时这里会红一次，逼着人回来看这一条判据还成不成立。
    expect(ownCount, "广场上的自有画面皮应是四系列 × 昼夜共八条").toBe(8);
    /* 5-㊷：五套改编皮从广场下架（它们没有整窗画面）。
       **条目下架，数值与出处留在 `appearanceSkinVisual.ts`**，
       所以下面那个「改编那五条的出处形状」describe 改成钉「形状判据仍然成立」，
       而许可白名单 `ALLOWED_UPSTREAM_REPOS` 一条都不许删短。 */
    expect(adaptedCount, "改编皮在 5-㊷ 已全部从广场下架，表里再出现就要重新核许可").toBe(0);
  });
});

/* 改编皮出处的**形状判据**：`改编自 <owner>/<repo> 的 <那一套>`，三段各自由人核对过许可。
   提成函数是因为 5-㊷ 之后表里一条改编皮都没有——
   原来那个 `for (const skin of adapted)` 会退化成**空遍历**（全绿而一条不测），
   所以下面拿合成用例把这条判据本身验一遍。 */
function checkAdaptedOrigin(id: string, origin: string): void {
  const PREFIX = ADAPTED_PREFIX;
  const SEPARATOR = " 的 ";
  expect(origin.startsWith(PREFIX), `${id} 缺少「${PREFIX}」前缀：${origin}`).toBe(true);
  const rest = origin.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  const owner = slash < 0 ? "" : rest.slice(0, slash);
  const tail = slash < 0 ? "" : rest.slice(slash + 1);
  const sep = tail.indexOf(SEPARATOR);
  const repo = sep < 0 ? "" : tail.slice(0, sep);
  const what = sep < 0 ? "" : tail.slice(sep + SEPARATOR.length);
  expect(owner, `${id} 的 owner 段为空：${origin}`).toMatch(/^[\w-]+$/);
  expect(repo, `${id} 的 repo 段为空：${origin}`).toMatch(/^[\w-]+$/);
  expect(what.length, `${id} 缺少「的 <那一套>」：${origin}`).toBeGreaterThan(0);
  // **仓库名必须在许可清单里**：写对了格式还不够，还要知道抄的是谁。
  expect(
    ALLOWED_UPSTREAM_REPOS,
    `${id} 的出处指向 ${owner}/${repo}，不在核实过许可的上游清单里`
  ).toContain(`${owner}/${repo}`);
}

describe("改编皮出处的形状判据 · 表里没有也要能被验", () => {
  it("表里的改编皮（现在是零条）逐条走一遍判据", () => {
    const adapted = appearanceSkins.filter((one) => one.origin.startsWith(ADAPTED_PREFIX));
    // 条数在这里**不钉死**：上面那条 `adaptedCount === 0` 已经钉过一次，
    // 这里再钉一遍就成了同一条判据的两份真相。
    for (const skin of adapted) checkAdaptedOrigin(skin.id, skin.origin);
  });

  /**
   * **反向用例：证明这条判据真的能红**（2026-10-08 记的口径）。
   *
   * 表里改编皮降到零条之后，`for` 循环不跑，这条守卫就成了摆设。
   * 拿四种写法各喂一次，每种都必须被判红——四种全红才说明判据本身是活的，
   * 而它「今天筛不出东西」只是数据的事实，不是它失效的借口。
   */
  it("四种不合规的出处写法都必须红", () => {
    const bad = [
      ["缺前缀", "ymh0000123/dsh-theme-endfield 的 纸墨色板"],
      ["缺 owner 斜杠", "改编自 dsh-theme-endfield 的 纸墨色板"],
      ["缺「的 <那一套>」", "改编自 ymh0000123/dsh-theme-endfield"],
      ["上游不在许可清单里", "改编自 someOne/unknown-repo 的 某一套"]
    ] as const;
    for (const [why, origin] of bad) {
      expect(() => checkAdaptedOrigin(why, origin), `${why}：这条写法本该被判红`).toThrow();
    }
    // 正向对照：合规的那一条不许被误判。
    expect(() =>
      checkAdaptedOrigin("正例", "改编自 ymh0000123/dsh-theme-endfield 的 纸墨色板与玻璃网格")
    ).not.toThrow();
  });

  it("许可白名单一条都不许因为「改编皮全下架了」而删短", () => {
    /* 这五个上游的**数值**仍然活在 `appearanceSkinVisual.ts` 里（老用户盘上存着
       `glass: "standard"` 的，运行时照样要按上游值渲染），出处对账在
       `appearance-skin-visual.test.ts`。清单一删短，将来重新搬一条就要重新查许可，
       而「重新查」在实际执行里等于「没人查」。 */
    expect(ALLOWED_UPSTREAM_REPOS).toHaveLength(5);
    for (const repo of [
      "d-dev0101/open-sea-skin",
      "RevolutionLA/dsh-dream-skin",
      "ymh0000123/dsh-theme-endfield",
      "Ayase34/gal-view",
      "elysia395/dsh-wallpaper-engine"
    ]) {
      expect(ALLOWED_UPSTREAM_REPOS, `${repo} 被删出了许可清单`).toContain(repo);
    }
  });

  /* 许可这一条是**硬门槛**，但门槛的理由必须是真的。被暂缓的两个（核实过许可，不是没找到）：
       Small-tailqwq/dsh-deep-whale   MIT 代码 + 美术 CC BY-NC-SA 禁商用
       GGBond2424648901/deep-whale-day-night-theme  整仓 CC BY-NC-SA 4.0
     **2026-10-08 更正**：本守卫原先的理由是「墨宸是能卖钱的写作软件」——
     那是一句**我编的**前提，用户从没说过要商用，2026-10-08 明确否认过。
     **同日裁定到了**（批次 5-㊷）：问的是「新皮肤的插画素材从哪来」，
     用户选「全部自绘 + 我自己提供图」，没选「把那两套搬进来」。
     ⇒ 这条守卫继续成立，而它现在的理由是**用户选过的那一条**，不是编出来的商用前提。 */
  it("被排除的两个非商用仓库不许以任何形式出现在表里", () => {
    const banned = ["dsh-deep-whale", "deep-whale-day-night-theme", "maid-atelier", "orca-link"];
    for (const skin of appearanceSkins) {
      for (const needle of banned) {
        expect(
          skin.origin.includes(needle),
          `${skin.id} 的出处里出现了被排除的仓库 ${needle} —— 它的许可不允许进墨宸`
        ).toBe(false);
      }
      expect(skin.license).not.toMatch(/CC BY|NonCommercial|CC0|GPL|AGPL/i);
    }
    // **空表也算验过**：上面那个 for 在 0 条皮肤时不跑，所以这里补一条有鉴别力的断言。
    expect(appearanceSkins.length, "皮肤表空了 —— 上面那条排除判据没跑过任何一条").toBeGreaterThan(
      0
    );
  });
});

describe("皮肤表与配色底版 · 可读性由计算说了算", () => {
  /* 阈值与 appearance-theme-readability.test.ts 同款：正文 ≥ 7:1（AAA 正文级）、
     按钮字 ≥ 4.5:1（AA 正文级）、accent 对底色 ≥ 2.5:1（看得见这个元素）。
     **从应用里 import 对比度算法**，不在守卫里重写 WCAG 公式（那是第二份判定）。 */
  it("广场每一条 × 深浅两版：正文 ≥ 7:1、按钮字 ≥ 4.5:1、accent ≥ 2.5:1", async () => {
    const { contrastRatio, readableAccentTextForTest } = await import("./appearanceThemeRuntime");
    expect(appearanceSkins.length, "皮肤表空了 —— 下面这条会全绿而一条不测").toBeGreaterThan(0);
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const { accent, background, foreground } = skin[scheme];
        const text = contrastRatio(foreground, background);
        expect(
          text,
          `${skin.label} · ${scheme}：正文 ${foreground} / 背景 ${background} 只有 ${text.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(7);

        const onAccent = readableAccentTextForTest(accent);
        const button = contrastRatio(onAccent, accent);
        expect(
          button,
          `${skin.label} · ${scheme}：按钮字 ${onAccent} / accent ${accent} 只有 ${button.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);

        const ui = contrastRatio(accent, background);
        expect(
          ui,
          `${skin.label} · ${scheme}：accent ${accent} / 背景 ${background} 只有 ${ui.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  /**
   * 次要文字（`--text-secondary`）——广场卡说明与页面上那些小字**真正**的字色。
   *
   * 【为什么正文那条盖不到它】正文量的是 `foreground` 对 `background`，那是 12:1 一档的稳过线；
   * 次要文字是**这两色混出来的中间色**，混得越浅就越贴底色，所以它在更窄的余量里过线，
   * 正文绿了不代表它绿。系数写歪一点、或者哪天有人把它调"更柔和"，只有这条看得见。
   *
   * 【2026-10-08：这条是量出来的，不是估的】真机在「汐·昼阁」整窗预览下，
   * 把卡说明（`.skin-card-desc`）那几行字设成 transparent、在字原本所在的方块中心取 6×6 无损 PNG 采样，
   * 得到实际垫底 `rgb(218,238,242)` 配字色 `rgb(89,115,127)` = **4.18:1**；
   * 把广场页底色钉回放行前那档实底再量是 **4.33:1**——两档都不到 AA 的 4.5，
   * 掉幅只有 3.5%，说明病不在「带画才放行」，在系数本身浅。
   * 0.67 → 0.71 的出处与留量理由写在 `SECONDARY_TEXT_MIX` 那段注释，这里负责**拦住它掉回去**。
   *
   * 【为什么量页底 + 卡面两个面】卡面比页底深一档（`SURFACE_CARD_MIX`），次要文字压上去更吃紧；
   * 广场正好一面一个：`.skin-gallery-note` 在页底，`.skin-card-desc` 在卡面。
   *
   * 【这条**没**覆盖的两处，各自要单独定线，别混进来冒充全绿】
   * ① `--text-tertiary`（浅 0.5）对页底最低只有 2.87:1；
   * ② 次要文字压在 `--surface-hover` / `--surface-selected` 上时 0.71 仍只有 4.38 / 4.09:1。
   * 病因一在元信息小字要不要按正文定线，二在表面阶梯一层比一层深——都不是这个数能顺手解决的。
   */
  it("广场每一条 × 深浅两版：次要文字对页底与卡面 ≥ 4.5:1（AA 正文级）", async () => {
    const { contrastRatio, mixHex, SECONDARY_TEXT_MIX, SURFACE_CARD_MIX } =
      await import("./appearanceThemeRuntime");
    expect(appearanceSkins.length, "皮肤表空了 —— 下面这条会全绿而一条不测").toBeGreaterThan(0);
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const { background, foreground } = skin[scheme];
        const muted = mixHex(background, foreground, SECONDARY_TEXT_MIX[scheme]);
        const card = mixHex(background, foreground, SURFACE_CARD_MIX[scheme]);
        const onPage = contrastRatio(muted, background);
        expect(
          onPage,
          `${skin.label} · ${scheme}：次要文字 ${muted} / 页底 ${background} 只有 ${onPage.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
        const onCard = contrastRatio(muted, card);
        expect(
          onCard,
          `${skin.label} · ${scheme}：次要文字 ${muted} / 卡面 ${card} 只有 ${onCard.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("深色版够暗、浅色版够亮（别把两版做成同一套）", async () => {
    const { relativeLuminance } = await import("./appearanceThemeRuntime");
    for (const skin of appearanceSkins) {
      expect(relativeLuminance(skin.dark.background), `${skin.id} 的深色版不够暗`).toBeLessThan(
        relativeLuminance(skin.light.background)
      );
    }
  });
});

/* ── 5-㊷ 新增：筛选档必须是从皮肤表派生的「在用小集合」 ────────────────
   【起因是一条真缺陷】
   原先 `SKIN_BACKDROP_FILTERS = APPEARANCE_BACKDROPS`（contracts 全量枚举），
   而 `nebula / ember / midnight` **没有任何皮肤在用**。
   点那三枚按钮 → 列表空 → 页面显示「没有匹配的皮肤，换个条件」。
   看着像用户筛错了，其实是那枚按钮从一开始就不该存在，而**没有任何一处会报错**。

   ⇒ 下面两条一条钉「每个摆出来的档都筛得出东西」，一条钉「表里有的档都摆出来了」。
     前者防死档，后者防有人手滑把某一档过滤漏掉。 */
/* 一维的通用查法。**写成泛型函数而不是把五维塞进一个对象数组**：
   后者会让 `layer.filters`/`layer.all` 变成五个数组类型的**联合**，
   于是 `layer.all.filter(...)` 在 tsc 里是「签名不一致，不能调用」——
   红在守卫自己身上，而红的原因与要防的缺陷毫无关系（本仓撞过同族三次）。 */
function checkOneLayer<T extends string>(
  key: "backdrop" | "glass" | "surface" | "grid" | "art",
  all: readonly T[],
  filters: readonly T[],
  pick: (skin: AppearanceSkin) => T
): void {
  expect(filters.length, `${key} 一档都不剩了`).toBeGreaterThan(0);
  // ① 摆出来的每一档都得有皮肤在用。
  for (const value of filters) {
    const users = appearanceSkins.filter((skin) => pick(skin) === value);
    expect(
      users.length,
      `${key} 的档「${value}」摆在了筛选条上，却没有任何皮肤在用 —— 点它就是空列表`
    ).toBeGreaterThan(0);
  }
  // ② 表里用过的档一个都不许漏，且顺序跟着 contracts 的键序。
  const expected = all.filter((value) => appearanceSkins.some((skin) => pick(skin) === value));
  expect([...filters], `${key} 的筛选档与表里实际用到的不一致`).toEqual(expected);
  // ③ contracts 仍是全量：未入档的合法值要有名，只是广场不提供它。
  expect(all.length).toBeGreaterThanOrEqual(filters.length);
}

describe("皮肤广场的筛选档 · 只摆真的有皮肤在用的档", () => {
  it("每一维：摆出来的每一个档都至少有一条皮肤在用，且表里用过的一个不漏", () => {
    checkOneLayer("backdrop", APPEARANCE_BACKDROPS, SKIN_BACKDROP_FILTERS, (s) => s.backdrop);
    checkOneLayer("glass", APPEARANCE_GLASSES, SKIN_GLASS_FILTERS, (s) => s.glass);
    checkOneLayer("surface", APPEARANCE_SURFACES, SKIN_SURFACE_FILTERS, (s) => s.surface);
    checkOneLayer("grid", APPEARANCE_GRIDS, SKIN_GRID_FILTERS, (s) => s.grid);
    checkOneLayer("art", APPEARANCE_ARTS, SKIN_ART_FILTERS, (s) => s.art);
  });

  it("筛选档不许写死成 contracts 的全量（那正是死档那一条缺陷）", () => {
    const tableSource = typeScriptSource("composables/appearanceSkins.ts");
    // 反向钉写法：五张表必须是 `usedValues(...)` 的产物。
    for (const name of [
      "SKIN_BACKDROP_FILTERS",
      "SKIN_GLASS_FILTERS",
      "SKIN_SURFACE_FILTERS",
      "SKIN_GRID_FILTERS",
      "SKIN_ART_FILTERS"
    ]) {
      expect(tableSource, `${name} 不再是派生的`).toMatch(
        new RegExp(`${name}[^=]*=\\s*usedValues`)
      );
      expect(
        tableSource,
        `${name} 又写成了 contracts 的全量枚举 —— 未入档的合法值会变成死档`
      ).not.toMatch(
        new RegExp(`${name}:[^=]+=\\s*APPEARANCE_(BACKDROPS|GLASSES|SURFACES|GRIDS|ARTS)`)
      );
    }
    // 而 store 那一侧必须消费这五张派生表，不是自己再取一遍枚举键。
    const browse = typeScriptSource("stores/useSkinBrowse.ts");
    for (const name of [
      "SKIN_BACKDROP_FILTERS",
      "SKIN_GLASS_FILTERS",
      "SKIN_SURFACE_FILTERS",
      "SKIN_GRID_FILTERS",
      "SKIN_ART_FILTERS"
    ]) {
      expect(browse, `筛选行没有用派生表 ${name}`).toContain(`...${name}`);
    }
    expect(browse, "筛选行又去取中文名表的全量键了 —— 那会把没皮肤在用的档也摆出来").not.toMatch(
      /Object\.keys\(APPEARANCE_(BACKDROP|GLASS|SURFACE|GRID|ART)_LABELS\)/
    );
  });

  it("contracts 的枚举与中文名表仍是全量（老 JSON 里存着未入档的合法值要认、要查得到名）", () => {
    for (const value of APPEARANCE_BACKDROPS) {
      expect(APPEARANCE_BACKDROP_LABELS[value], `背景档 ${value} 没有中文名`).toBeTruthy();
    }
    for (const value of APPEARANCE_ARTS) {
      expect(APPEARANCE_ART_LABELS[value], `画面档 ${value} 没有中文名`).toBeTruthy();
    }
  });
});

/* ── 2026-10-08 用户第二刀：「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」 ──
   【为什么这一组从「补齐后观感不变」改成「默认只能是带画的那一套」】
   上一版（5-㊷）的处理是**下架但不销毁**：十套素面配色搬进 `appearanceTones.ts`，
   继续当「设置 · 外观」的配色底版，出厂默认也留在那一族里（`preset: "codex"`、
   `skin: "plain"`、`art: "none"`）。用户看完这句裁定推翻了：
   「我没说明白吗，把没有皮肤没有图片的全删了，只保留有图片有皮肤的。」
   ⇒ 素面那一族整族退役，出厂默认必须指向广场里真实存在的一套带画皮肤。

   【为什么判据写成「逐字段等于 `appearanceSkins[0]`」】
   contracts 拿不到渲染层的皮肤表（依赖方向是 contracts ← renderer），
   所以那六个色值与五个枚举值在两处各写了一遍——**这是本仓最怕的「两份真相」**。
   唯一能把它变成一份的办法是让守卫做对照：这里逐字段比，
   任何人改了皮肤表第一套的色值而忘了改 contracts，当场红。
   （验红方式：把 contracts 的 `accent` 改回 `#339CFF`，本条立刻红且指名道姓。） */
describe("出厂默认 · 只能是广场里那套带画的皮肤", () => {
  it("出厂两套的三色、四层与画面层，逐字段等于广场第一套", () => {
    const first = appearanceSkins[0];
    expect(first, "皮肤广场空了 —— 出厂默认没有可指向的皮肤").toBeDefined();
    if (first === undefined) return;
    for (const scheme of ["light", "dark"] as const) {
      const theme = createDefaultAppearanceTheme(scheme);
      expect(theme.skin, "出厂的 skin 不是广场里那套").toBe(first.id);
      expect(theme.preset, "出厂的 preset 与 skin 分了家").toBe(first.id);
      for (const key of ["accent", "background", "foreground"] as const) {
        expect(theme[key], `${first.id} · ${scheme} 的 ${key} 与皮肤表漂移了`).toBe(
          first[scheme][key]
        );
      }
      for (const key of ["backdrop", "glass", "surface", "grid", "art"] as const) {
        expect(theme[key], `${first.id} 的 ${key} 与皮肤表漂移了`).toBe(first[key]);
      }
      // 出厂默认自己也得带画——它正是「没有图片的不保留」那条裁定的落点。
      expect(theme.art, "出厂默认没有画面，等于又把素面留在了默认位上").not.toBe("none");
    }
  });

  /**
   * 老 JSON（5-㊴ 之前只有三色那版）**仍然要能被解析**——这一条与上一版没变，
   * 变的只有补齐出来的那几个值。
   *
   * 解析成功后那些已下架的 id（这里是 `ocean`）会由 `useAppearanceStore.load()`
   * 回落成广场第一套，落点与理由见 `useAppearanceStore.test.ts`。
   * 这里刻意**不**断言「补齐后观感不变」：那句话的前提就是「素面那一族还留着」，
   * 而它已经被用户裁定删掉了。
   */
  it("老 JSON（只有三色那版）缺这五个字段时能被补齐而不是被整份拒掉", async () => {
    const { AppearanceSettingsSchema } = await import("@mochen/contracts");
    const old = {
      mode: "system",
      light: {
        preset: "ocean",
        accent: "#257F8B",
        background: "#F4FAFA",
        foreground: "#193135",
        uiFontSize: 14,
        codeFontSize: 13,
        translucentSidebar: true
      },
      dark: {
        preset: "ocean",
        accent: "#5CC3CF",
        background: "#102124",
        foreground: "#E5F3F4",
        uiFontSize: 14,
        codeFontSize: 13,
        translucentSidebar: true
      },
      uiFontFamily: "system",
      editorFontFamily: "song"
    };
    const parsed = AppearanceSettingsSchema.safeParse(old);
    // 这一条红的话表现是「老用户的配色整个退回默认」——必须红得有声音。
    expect(parsed.success, "老 appearance.json 解析失败").toBe(true);
    if (!parsed.success) return;
    // 存着的三色原样保住（回落在 store，不在 schema 边界偷偷改值）。
    expect(parsed.data.light.accent).toBe("#257F8B");
    expect(parsed.data.light.preset).toBe("ocean");
    const first = appearanceSkins[0];
    expect(parsed.data.light.backdrop).toBe(first?.backdrop);
    expect(parsed.data.dark.glass).toBe(first?.glass);
    expect(parsed.data.dark.surface).toBe(first?.surface);
    expect(parsed.data.dark.grid).toBe(first?.grid);
    expect(parsed.data.dark.art).toBe(first?.art);
  });
});

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
  createDefaultAppearanceTheme
} from "@mochen/contracts";
import {
  APPEARANCE_ART_LABELS,
  APPEARANCE_BACKDROP_LABELS,
  APPEARANCE_GLASS_LABELS,
  APPEARANCE_GRID_LABELS,
  APPEARANCE_SURFACE_LABELS,
  OWN_ART_ORIGIN,
  OWN_SKIN_ORIGIN,
  SKIN_ART_FILTERS,
  SKIN_BACKDROP_FILTERS,
  SKIN_GLASS_FILTERS,
  SKIN_GRID_FILTERS,
  SKIN_SURFACE_FILTERS,
  appearanceSkins,
  type AppearanceSkin
} from "./appearanceSkins";
import { appearanceTones, findAppearanceTone } from "./appearanceTones";
// 四层的**数值**守卫搬到 appearance-skin-visual.test.ts 了（它们是「要跟上游对账」的部分）；
// 5-㊷ 又把「读 .vue 与 .css 源码」那一半搬到 appearance-skin-plaza-wiring.test.ts
// （两份各 800 行的预算：这一份钉表与投影，那一份钉页面）。
import { themePresets } from "./appearanceThemeRuntime";
import { typeScriptSource } from "../utils/vue-source-reader";

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
     数字继续钉死——加一套就红一次，逼人回来看下面那条入场判据还成不成立。 */
  it("两条皮肤，id 与名字都不重", () => {
    expect(appearanceSkins).toHaveLength(2);
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

describe("出厂配色底版 · 十套一字未改（5-㊷ 从皮肤表拆出来）", () => {
  /* 这一组是**产品决定**，不是实现细节：5-⑧ 定下的十套 id、顺序与色值，
     已经存进用户盘上的 appearance.json。改任何一个都是把别人的主题改掉。
     5-㊷ 把它们从皮肤表搬进 `appearanceTones.ts`，**搬的是住的地方，不是数据**。 */

  /**
   * **这一条是整份文件里最重要的一条**，它挡的是「假绿」而不是「改错值」。
   *
   * 下面（以及 `appearance-theme-readability.test.ts`）有好几处写成
   * `for (const preset of themePresets)` —— 投影源一旦筛空，
   * 那些循环一条也不执行，断言全绿，而**它已经什么都没测了**。
   * 5-㊷ 这一刀恰好就把投影源从皮肤表里搬走，所以这里先钉住「这一族非空」。
   * （验证方式：把 `appearanceTones` 改成空数组，本条与可读性那两条都会红。）
   */
  it("底版表非空（空了则所有遍历式守卫一起退化成假绿）", () => {
    expect(
      appearanceTones.length,
      "出厂配色底版空了 —— 遍历它的守卫全都测不到东西"
    ).toBeGreaterThanOrEqual(10);
  });

  it("出厂那十条的 id 与顺序与 5-⑧ 钉的一样", () => {
    expect(appearanceTones.map((one) => one.id)).toEqual([
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
    ]);
  });

  it("墨宸 · 青金那一套一字不变（已有用户存的就是它）", () => {
    const tone = findAppearanceTone("mochen-qingjin");
    expect(tone?.label).toBe("墨宸 · 青金");
    expect(tone?.light).toEqual({
      accent: "#1F5C55",
      background: "#F7F4EC",
      foreground: "#242E2B"
    });
    expect(tone?.dark).toEqual({
      accent: "#D4B45A",
      background: "#101B18",
      foreground: "#EAE5D6"
    });
  });

  /**
   * 底版的定义就是「只有三色的配色底」，所以这里钉的是**形状**而不是值。
   *
   * 它防的是：将来有人往底版里补 `backdrop / glass / art`，于是「配色预设」与「皮肤」
   * 又变成两份都能写四层的东西——那正是 5-㊴ 想要消灭的漂移源。
   * 顺序用 `sort()` 比，字段一多就会红，红得指名道姓。
   */
  it("底版每条只有 id/label/tagline/light/dark 五个键（不带任何视觉层）", () => {
    const allowed = ["dark", "id", "label", "light", "tagline"].join(",");
    for (const tone of appearanceTones) {
      expect(Object.keys(tone).sort().join(","), `${tone.id} 的底版里混进了别的字段`).toBe(allowed);
    }
  });

  it("皮肤表里不许再混进出厂配色（广场只认带画的，投影只认底版）", () => {
    // OWN_SKIN_ORIGIN 这一句还在，是因为 AppearancePanel 要用它说「出厂配色 · 某某」。
    // 但它**不该再出现在皮肤表里**——出现了就说明有人把素面皮塞回广场。
    for (const skin of appearanceSkins) {
      expect(skin.origin, `${skin.id} 带着出厂配色的出处，却进了皮肤广场`).not.toBe(
        OWN_SKIN_ORIGIN
      );
      expect(findAppearanceTone(skin.id), `${skin.id} 同时是底版和皮肤`).toBeUndefined();
    }
  });

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
    expect(ownCount, "广场上的自有画面皮应是汐 · 昼阁、汐 · 夜阁两条").toBe(2);
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
   * 底版十条走的是**同一套算法**，但必须单列一遍。
   *
   * 【为什么分开写而不是 `for (const one of [...skins, ...tones])`】
   * 合起来写的时候，任何一边塌成零条，另一边照样把遍历撑起来——那条守卫就悄悄少了十分之一的覆盖面。
   * 5-㊷ 干的就是「把十条从一张表搬到另一张表」，正是能让它塌掉的那种改动。
   */
  it("出厂十套 × 深浅两版同样过线（它们仍存着真实用户的界面上）", async () => {
    const { contrastRatio, readableAccentTextForTest } = await import("./appearanceThemeRuntime");
    expect(appearanceTones.length, "底版空了 —— 下面这条会全绿而一条不测").toBeGreaterThanOrEqual(
      10
    );
    for (const tone of appearanceTones) {
      for (const scheme of ["light", "dark"] as const) {
        const { accent, background, foreground } = tone[scheme];
        expect(
          contrastRatio(foreground, background),
          `${tone.label} · ${scheme} 的正文对比度不够`
        ).toBeGreaterThanOrEqual(7);
        expect(
          contrastRatio(readableAccentTextForTest(accent), accent),
          `${tone.label} · ${scheme} 的按钮字对比度不够`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(accent, background),
          `${tone.label} · ${scheme} 的 accent 看不见`
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

  /** 底版十条单列一遍，理由与上面那条出厂十套正文守卫一样：合写会让一边塌成零条照样全绿。 */
  it("出厂十套 × 深浅两版同样（次要文字对页底与卡面 ≥ 4.5:1）", async () => {
    const { contrastRatio, mixHex, SECONDARY_TEXT_MIX, SURFACE_CARD_MIX } =
      await import("./appearanceThemeRuntime");
    expect(appearanceTones.length, "底版空了 —— 下面这条会全绿而一条不测").toBeGreaterThanOrEqual(
      10
    );
    for (const tone of appearanceTones) {
      for (const scheme of ["light", "dark"] as const) {
        const { background, foreground } = tone[scheme];
        const muted = mixHex(background, foreground, SECONDARY_TEXT_MIX[scheme]);
        const card = mixHex(background, foreground, SURFACE_CARD_MIX[scheme]);
        expect(
          contrastRatio(muted, background),
          `${tone.label} · ${scheme} 的次要文字压页底不够`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(muted, card),
          `${tone.label} · ${scheme} 的次要文字压卡面不够`
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
    for (const tone of appearanceTones) {
      expect(relativeLuminance(tone.dark.background), `${tone.id} 的深色版不够暗`).toBeLessThan(
        relativeLuminance(tone.light.background)
      );
    }
  });
});

describe("themePresets · 从出厂底版派生，不再是第二份真相", () => {
  it("投影出来的就是底版那十条，顺序与色值逐条相同", () => {
    expect(themePresets).toHaveLength(appearanceTones.length);
    themePresets.forEach((preset, index) => {
      // 用 `at()` 而不是 `tones[index]`：后者在 noUncheckedIndexedAccess 下是
      // `AppearanceTone | undefined`，而写 `!` 会被 prettier 折掉、tsc 立刻又红回来。
      // `at()` 的存在性断言在这里是真检查——越界会先在这里红，且报得清楚。
      const source = appearanceTones.at(index);
      expect(source, `第 ${index + 1} 条投影没有对应的底版`).toBeDefined();
      expect(preset.id).toBe(source?.id);
      expect(preset.label).toBe(source?.label);
      expect(preset.light).toEqual(source?.light);
      expect(preset.dark).toEqual(source?.dark);
    });
  });

  /**
   * 5-㊷ 换的是**投影源**，而这一条钉的就是那次换法本身。
   *
   * 【为什么还要读源码】
   * 上一版的投影是 `appearanceSkins.filter(origin === OWN_SKIN_ORIGIN)`。
   * 那句写法今天仍然「能跑」——它只会筛出零条，
   * 于是 `toHaveLength(0)` 与上面那条 `toHaveLength(appearanceTones.length)`
   * 里前者是 0、后者也是 0，**两边同时成立，守卫全绿**，
   * 而用户盘上的十套配色已经在「主题配色」那一族里全部消失。
   * ⇒ 唯一有鉴别力的写法是去源码里确认投影读的是 `appearanceTones`。
   *   （验红方式：把 runtime 那行改回 `appearanceSkins.filter(...)`，本条立刻红。）
   */
  it("投影必须读 appearanceTones，不许退回「从皮肤表里筛出处」那一版", () => {
    const runtime = typeScriptSource("composables/appearanceThemeRuntime.ts");
    expect(runtime).toContain('from "./appearanceTones"');
    expect(runtime).toMatch(/themePresets[^;]*appearanceTones/);
    expect(runtime, "又退回从皮肤表筛了 —— 皮肤表里已经没有出厂配色，那会筛出零条").not.toMatch(
      /appearanceSkins\s*\n?\s*\.filter/
    );
  });

  it("带画的皮肤不许混进 themePresets（那是「主题配色」，混进去两页含义就不同了）", () => {
    const ids = themePresets.map((one) => one.id);
    for (const skin of appearanceSkins) {
      expect(ids, `皮肤 ${skin.id} 混进了主题配色`).not.toContain(skin.id);
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

describe("出厂默认 · 老用户盘上的 appearance.json 补齐后观感不变", () => {
  it("出厂两套都补上素面，且默认值与 contracts 的常量一致", () => {
    for (const theme of [
      createDefaultAppearanceTheme("light"),
      createDefaultAppearanceTheme("dark")
    ]) {
      expect(theme.backdrop).toBe("plain");
      expect(theme.glass).toBe("none");
      expect(theme.surface).toBe("plain");
      expect(theme.grid).toBe("none");
      expect(theme.skin).toBe("plain");
    }
  });

  it("老 JSON（5-㊴ 之前，只有三色那版）缺这五个字段时能被补齐而不是被整份拒掉", async () => {
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
    expect(parsed.data.light.accent).toBe("#257F8B");
    expect(parsed.data.light.backdrop).toBe("plain");
    expect(parsed.data.dark.glass).toBe("none");
    expect(parsed.data.dark.surface).toBe("plain");
    expect(parsed.data.dark.grid).toBe("none");
  });
});

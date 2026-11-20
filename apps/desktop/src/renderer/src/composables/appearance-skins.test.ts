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
  ANIME_ART_ORIGIN,
  NATIVE_SKIN_ORIGIN,
  APPEARANCE_ORNAMENT_LABELS,
  SKIN_ART_FILTERS,
  SKIN_BACKDROP_FILTERS,
  SKIN_GLASS_FILTERS,
  SKIN_GRID_FILTERS,
  SKIN_ORNAMENT_FILTERS,
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

/* ⚠️【2026-10-17 第五刀（挂件那批）就地更正】这一行下面原先还站着三样东西：
   `ANIME_LICENSE_LITERAL`（画面皮的许可字面量）、`ADAPTED_PREFIX`（改编出处前缀）、
   `ALLOWED_UPSTREAM_REPOS`（核实过许可的上游白名单）。
   **它们整块搬去了 `appearance-skins-license.test.ts`** —— 这一批往本文件加了
   「八套的质感三层两两不同」与「每一条都必须挂着一枚挂件」两条守卫之后，
   本文件到了 872 行，**越过了 800 行的硬线**。拆的口子按「不共享状态」找：
   那三条字面量在原文件里只被「出处与许可」那两段用到（12 处引用全在里头），
   它们与本文件剩下的「四层取值 / 可读性 / 筛选档」互不相干，所以整块搬走。
   **原文（三条常量与各自的理由）保留在新文件里**，这里不再复述。 */

describe("皮肤表 · 形状", () => {
  /* 5-㊷：广场只收带画的皮肤，条数从 17 降到 2（汐·昼阁 / 汐·夜阁）。
     波2a（2026-10-08）按用户那句「然后再继续增加」加到 8：三系列 × 昼夜。
     ⚠️【2026-10-17 第五刀就地更正】上面那句「加到 8」记的是那一版的射程；当天用户说
     「图片装扮还有挂件其他东西都太少了」，又从网上导入四组插画 × 昼夜 ⇒ **现在是 16**。
     数字继续钉死——加一套就红一次，逼人回来看下面那条入场判据还成不成立，
     并且**顺手把素材守卫那份也认一遍**：新加的每一档都得有真文件在盘上
     （appearance-skin-assets.test.ts），不是把名字加进枚举就算有了画。 */
  it("十六条皮肤，id 与名字都不重", () => {
    expect(appearanceSkins).toHaveLength(16);
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
  it("带画是广场的入场条件；唯一例外是原生「澄光」两套（2026-11-20 用户裁定）", () => {
    /* 【例外的边界由这条钉死】用户裁定「把屎背景去掉、液态玻璃加上去」：
       原生澄光（xi-day / xi-night）走干净纸面 + 液态玻璃，不压整窗插画。
       例外**只有这两套**——第三套无画皮出现时下面这条立刻红，
       「例外」不会悄悄扩张成新的素面族（那正是上面那段历史里用户两次否掉的东西）。 */
    expect(
      appearanceSkins.filter((skin) => skin.origin === NATIVE_SKIN_ORIGIN).map((skin) => skin.id),
      "原生无画皮只能有澄光昼夜两套，多一套就是素面族复活"
    ).toEqual(["xi-day", "xi-night"]);
    for (const skin of appearanceSkins) {
      if (skin.origin === NATIVE_SKIN_ORIGIN) {
        expect(skin.art, `${skin.id} 是原生澄光：干净纸面，不压整窗插画`).toBe("none");
      } else {
        expect(skin.art, `${skin.id} 没有画面，不该进皮肤广场`).not.toBe("none");
      }
      expect(APPEARANCE_ART_LABELS[skin.art], `${skin.id} 的画面档没有中文名`).toBeTruthy();
    }
    /* 筛选档里的「无画面」是**真实在用的一档**（2026-11-20 澄光刀）：
       出厂就是无画的澄光，用户要能按这一档直接筛出干净纸面的两套。
       派生表仍由「每一维：每个档都至少有一条皮肤在用」那条钉着，none 不是死档。 */
    expect(SKIN_ART_FILTERS, "澄光两套就是「无画面」这一档，筛选里必须找得到").toContain("none");
  });

  /* 挂件层（2026-10-17 第六刀）：与画面那一条同形，是同一条入场理由的第二半——
     用户说的两句「挂件太少了」与「全部不一样」，落到表上就是这两条。
     挂件层的素材尺寸/路径真伪由 appearance-skin-assets.test.ts 量，这里只钉表本身。 */
  it("带画皮肤必须挂着一枚挂件；原生澄光两套不挂（与画面同一条例外）", () => {
    for (const skin of appearanceSkins) {
      if (skin.origin === NATIVE_SKIN_ORIGIN) {
        // 澄光的窗角留空：干净纸面 + 液态玻璃是主角，挂件在这种皮上只是噪声。
        expect(skin.ornament, `${skin.id} 是原生澄光：窗角留空`).toBe("none");
      } else {
        expect(skin.ornament, `${skin.id} 没挂挂件，不该进皮肤广场`).not.toBe("none");
      }
      expect(
        APPEARANCE_ORNAMENT_LABELS[skin.ornament],
        `${skin.id} 的挂件档没有中文名`
      ).toBeTruthy();
    }
    // 与画面同理：「无挂件」对应澄光两套，是真实在用的一档，筛选里必须找得到。
    expect(SKIN_ORNAMENT_FILTERS, "澄光两套就是「无挂件」这一档").toContain("none");
  });

  it("表里的每条出处都是同一句（画面来自外站动漫插画；上游美术按裁定不进表）", () => {
    /* 5-㊷ 用户裁定的素材来源是「全部自绘 + 我自己提供图」，**没有选**「把鲸鱼娘那两套
       上游美术搬进来」。所以带画的皮全部是自有素材，出处只有 `OWN_ART_ORIGIN` 一句。
       这条与下面那条「被排除的非商用仓库不许出现」是一对：
       一句钉「只能是谁」，一句钉「绝对不能是谁」。
       若将来裁定改了、允许搬某一上游，这两条要**一起**改，不许只改短下面那条名单。

       ⚠️【2026-10-17 第三刀就地更正】上面那句「全部自绘」**已被用户自己推翻**：
       他当天要求「不要自己创建图片，从网上寻找好看的真人美女图片／动漫图做装扮」，
       ⇒ 八张全部换成 Unsplash 的真人女性人像，那句出处因此从 `墨宸原创画面`
         换成 `Unsplash 人像`（常量同批改名 `PHOTO_ART_ORIGIN`）。
       这条守卫**形状没变**（仍旧钉「表里只有一句出处」），变的只是那一句是什么——
       而「哪四张照片、哪条许可、模特授权怎么算」逐条记在 `docs/ATTRIBUTION.md`，
       不住在这条守卫里（许可义务是文档的事，不是断言的事）。
       ⚠️【2026-10-17 第四刀】那一句出处当天又换了一次（`Unsplash 人像` →
       `ANIME_ART_ORIGIN`＝「动漫插画（Pixiv 原作）」），这条守卫照旧只管「只有一句」。 */
    for (const skin of appearanceSkins) {
      /* 2026-11-20 澄光刀：出处从「只有一句」改成「两族各一句」——
         原生两套（无画、本仓自有）与带画那一族（Pixiv 插画）。
         判据没松：每套仍只能是它那一族的那一句，第三种出处出现照样红。 */
      if (skin.origin === NATIVE_SKIN_ORIGIN) continue;
      expect(skin.origin, `${skin.id} 的出处不是那一句画面出处`).toBe(ANIME_ART_ORIGIN);
    }
    // 原生那两套也必须真的标着原生出处——「continue」不是「这两套没人管」。
    for (const skin of appearanceSkins.filter((one) => one.art === "none")) {
      expect(skin.origin, `${skin.id} 无画却不是原生澄光`).toBe(NATIVE_SKIN_ORIGIN);
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

  /* ── 2026-10-17 第五刀：八套不许「只换画」 ─────────────────────────────
     用户看完第四刀那一版说：「你那个装扮就只换了图片，其他的没有更改。
     我要的是全部不一样的，每一个装扮。」
     取证属实：八套的 `glass` 全是 `regions`、`surface` 全是 `round-none`、
     `grid` 全是 `none` —— 三层一个字没改，卡脚那五行标签里除了画面那一栏全同。

     ⇒ 这一条钉的是最直白的那个判据：八套的（玻璃 × 表面 × 图案）三元组必须两两不同。
       它一红，就是又有人把一套新皮的三层抄了邻居的。
     【为什么只钉这三层，不连 backdrop 一起钉】
     backdrop 压在**不透明整窗画**底下（`.desktop-shell` 的叠放顺序是纱 → 画 → 弥散光，
     八张画都是不透的 JPEG），画正常加载时它一个像素都看不见。那条「上游档名只剩解析用」
     的守卫把这条理由钉在原处。**拿看不见的差别凑「不一样」是假话**，
     所以差异只做在这三层上——它们是换上之后真的会变的那三层。 */
  it("十六套的质感三层（玻璃 × 表面 × 图案）两两不同 —— 不许只换画", () => {
    expect(appearanceSkins.length, "皮肤表空了 —— 下面这条会全绿而一条不测").toBeGreaterThan(0);
    const seen = new Map<string, string>();
    for (const skin of appearanceSkins) {
      const combo = `${skin.glass} / ${skin.surface} / ${skin.grid}`;
      const owner = seen.get(combo);
      expect(
        owner,
        `${skin.id} 的质感三层（${combo}）与 ${owner} 完全相同 —— 这一套只有画不一样`
      ).toBeUndefined();
      seen.set(combo, skin.id);
    }
    /* 三层各自也得铺开：只改一层、另两层抄邻居，等于换了个滤镜——
       那正是用户连着否过两次的东西。三档是下限：枚举里玻璃 5 档、表面 4 档、图案 3 档，
       八套铺到每层都 ≥3 是能做到的，做不到就说明又在抄邻居。 */
    const glassValues = new Set(appearanceSkins.map((skin) => skin.glass));
    const surfaceValues = new Set(appearanceSkins.map((skin) => skin.surface));
    const gridValues = new Set(appearanceSkins.map((skin) => skin.grid));
    expect(glassValues.size, `玻璃这一层只用了 ${glassValues.size} 档`).toBeGreaterThanOrEqual(3);
    expect(surfaceValues.size, `表面这一层只用了 ${surfaceValues.size} 档`).toBeGreaterThanOrEqual(
      3
    );
    expect(gridValues.size, `图案这一层只用了 ${gridValues.size} 档`).toBeGreaterThanOrEqual(3);
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
      /* 2026-11-20 澄光刀：唯一允许的无画皮是原生澄光两套（见「皮肤表 · 形状」那条
         把例外名单钉成 xi-day / xi-night 的断言）。这里钉的是同一件事的另一半：
         无画 ⇒ 必须是原生，别的一律不许回到广场。 */
      expect(
        skin.art !== "none" || skin.origin === NATIVE_SKIN_ORIGIN,
        `${skin.id} 没有画面、又不是原生澄光，却又回到了广场`
      ).toBe(true);
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

  /* ⚠️【2026-10-17 第五刀就地更正】上面那个 it 从「消费面只剩一条……」改成了下面这条。
     原文保留在下面这段里，它记的是第四刀那一版皮肤表的**真实情况**：

       it("消费面只剩一条：除昼阁复用的 aurora，这些档名没有皮肤在用") {
         ...
         expect(used).toEqual(["abyss","aurora","none","regions","round-none"]);
         expect(defaultAppearanceSkin.backdrop).toBe("aurora");
       }

     第五刀之后那五条「没有皮肤在用」的断言**不再成立**：用户要求八套「全部不一样」，
     于是 none / standard / strong / subtle / dialogue / plain / square / industrial / stage
     全部由皮肤表在上屏时直接消费。**上一段「只为让老 JSON 解析得动而存在」的理由前半仍然成立**
     （枚举与数值表不许删：删了老 JSON 整份退默认，那两条守卫在上面、不动），
     只是「没有皮肤在用」这半句被这一刀改掉了 —— 两条守卫各改各的那一半。 */
  it("这些档名现在真的上了屏：十六套的四层铺开在 contracts 的枚举上", () => {
    expect(appearanceSkins.length, "广场空了 —— 下面这几条会全绿而一条不测").toBeGreaterThan(0);
    const used = [
      ...new Set(
        appearanceSkins.flatMap((skin) => [skin.backdrop, skin.glass, skin.surface, skin.grid])
      )
    ].sort();
    /* 逐条列出八套真正用到的层取值。**改动它就是一红**：这张清单与皮肤表是同一件事的两处写法，
       红的位置就在这里，逼人回来看「八套是不是又互相抄了」（上面那条三元组守卫另钉一遍）。
       【backdrop 为什么只有两个值】它压在整窗画底下、上屏时看不见 —— 第三刀那版留下的理由
       仍成立，见上面「第五刀」那段注释。 */
    expect(used, "十六套的层取值变了 —— 上面「上游档名只为解析而留」的口径要跟着改").toEqual([
      "abyss",
      "aurora",
      "dialogue",
      "industrial",
      "none",
      "plain",
      "regions",
      "round-none",
      "square",
      "stage",
      "standard",
      "strong",
      "subtle"
    ]);
    // 三个「曾经没有皮肤在用」的档（none/regions/round-none）现在各有归宿；
    // aurora 仍是出厂那套的背景层 —— 回落点不许换套（换套会让盘上老用户看到的与这里不符）。
    expect(defaultAppearanceSkin.backdrop).toBe("aurora");
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
   * 【这条覆盖不到的那处，2026-10-12 已由另一份守卫接管】次要文字压在 `--surface-hover` /
   * `--surface-selected` 上时 0.71 只有 4.38 / 4.09:1。当时写的「病因在表面阶梯」后来量过站不住
   * （正文档对五档最低 7.60，那一格是深底的 `selected`，阶梯没病）；改的是**用法**：
   * 状态档一出现，那一块子树的灰字升档。
   * 判据与普查表在 `appearance-surface-ladder.test.ts`，推导在 `ON_STATE_TEXT_MIX` 上面那节注释。
   * （原先这里还挂着「第三级文字 2.87:1 未定线」，现由下面那条守卫接管。）
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

  /**
   * 第三级文字（`--text-tertiary`）——卡脚那几个元信息小字、时间戳、字数统计的字色。
   *
   * 【为什么上面那条盖不到它】次要文字是 0.71，第三级是**更浅的一档混色**，
   * 系数每降 0.01 都在往下掉对比度；次要那条绿着，不代表这一档也绿。
   *
   * 【2026-10-08 这条为什么现在才有】上一轮把系数写在调用行里（浅 0.5 / 深 0.52），
   * 守卫拿不到同一个数，只能在注释里记一句「2.87:1，未定线」——那就是"知道但没拦"。
   * 这一轮先把两份原值搬成 `TERTIARY_TEXT_MIX` 常量，**所以这条一开始是红的**，
   * 红在真实缺陷上（昼阁浅版对页底 2.87、对卡面 2.74），而不是红在 import 不到东西。
   *
   * 【扫出来的结论：浅色这一档买不到"既 AA 又有层级"】把 0.48–0.72 逐档在八套皮肤上算过
   * （系数→页底/卡面的完整阶梯都在提交说明里）：
   * - 浅色四套里最紧的是「汐·昼阁」：0.66 → 页 4.41 / 卡 4.21，0.69 → 4.82 / 4.60，
   *   0.71 → 5.11 / 4.88。要过 4.5 至少得 0.69，而次要文字就是 0.71 ——
   *   **层级当场没了**。这不是数值巧合，是「拿底色混前景色当第三级」这个机制的上限：
   *   浅底上任何"浅一点的灰"都贴回底色。
   * - 深色八套在 0.62 就全员 ≥ 页 5.97 / 卡 4.94，而次要是 0.72 —— **层级留得住**。
   *
   * ⇒ 处置：**浅色不假造第三级色，把它钉到与次要同级**（第三级在浅色靠字号与位置区分），
   *   深色提到 0.62 保住那一档可见的浅。这两件事都由下面这条断言钉住，
   *   谁哪天把浅色再调"更柔和"回去，这里先红。
   *
   * 【阈值与留量同次要那条】静态 4.5 是真机下限的**下界**：真机采样比静态低 0.15~0.37
   * （画层 + 那层纱会把垫底压暗），所以浅色取的是 0.71 那一档而不是刚好跨线的 0.67。
   */
  it("广场每一条 × 深浅两版：第三级文字对页底与卡面 ≥ 4.5:1（AA 正文级）", async () => {
    const { contrastRatio, mixHex, TERTIARY_TEXT_MIX, SURFACE_CARD_MIX } =
      await import("./appearanceThemeRuntime");
    expect(appearanceSkins.length, "皮肤表空了 —— 下面这条会全绿而一条不测").toBeGreaterThan(0);
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const { background, foreground } = skin[scheme];
        const dim = mixHex(background, foreground, TERTIARY_TEXT_MIX[scheme]);
        const card = mixHex(background, foreground, SURFACE_CARD_MIX[scheme]);
        const onPage = contrastRatio(dim, background);
        expect(
          onPage,
          `${skin.label} · ${scheme}：第三级文字 ${dim} / 页底 ${background} 只有 ${onPage.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
        const onCard = contrastRatio(dim, card);
        expect(
          onCard,
          `${skin.label} · ${scheme}：第三级文字 ${dim} / 卡面 ${card} 只有 ${onCard.toFixed(2)}:1`
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
describe("出厂默认 · 澄光（干净纸面 + 液态玻璃，2026-11-20 裁定）", () => {
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
      /* 挂件层（2026-10-17 第六刀）：`ornament` 并进这份字段表。
         不并进来的话，contracts 那份默认掉了、或皮肤表第一套换了挂件，这条守卫**照样全绿**
         —— 那它就从「逐字段对照」退化成了「只对照我记得的那几个字段」。 */
      for (const key of ["backdrop", "glass", "surface", "grid", "art", "ornament"] as const) {
        expect(theme[key], `${first.id} 的 ${key} 与皮肤表漂移了`).toBe(first[key]);
      }
      /* 2026-11-20 澄光刀：出厂就是**无画的澄光**——用户裁定「把屎背景去掉、
         液态玻璃加上去」，干净纸面 + 液态玻璃是主角，整窗插画与窗角挂件都不在默认位上。
         这两条从「不许是 none」翻成「必须是 none」：钉的方向反了，钉的力道没松——
         谁把出厂改回带画/带挂件，这里照样当场红。 */
      expect(theme.art, "出厂默认是澄光：干净纸面，不压整窗插画").toBe("none");
      expect(theme.ornament, "出厂默认是澄光：窗角留空，液态玻璃是主角").toBe("none");
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

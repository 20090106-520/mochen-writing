/**
 * 皮肤的**亮度形状**守卫（2026-10-06 批次 5-⑧ 建，2026-10-08 第二刀改钉）。
 *
 * 【2026-10-08 为什么整份改了一遍】
 * 这一份原本遍历的是 `themePresets`（十套素面「主题配色」投影）。用户那句裁定
 * ——「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」——把那一族整族删了，
 * 投影也就没有了，于是这里改成遍历皮肤广场。**文件名保留**：`appearanceSkins.ts`
 * 的注释与 README 台账都指着这个名字，改名字会把归属关系弄断，而内容换没换是另一回事。
 *
 * 【与 appearance-skins.test.ts 的分工（同一判定不留两份）】
 * 对比度三条线（正文 ≥ 7:1、按钮字 ≥ 4.5:1、accent ≥ 2.5:1）与次要文字的 AA 线
 * **住在那一份**里，本份不再重写一遍遍历；这里只管**亮度形状**——
 * 纯黑底、深浅两版的相对亮度差、以及「浅色版到底该不该亮」这条被真机推翻过一次的规则。
 *
 * 【为什么"看着挺舒服"不算判据】
 * 写长文时眼睛要在正文色 / 背景色上待几小时，所以阈值一律用 WCAG 相对亮度**算**出来。
 * 对比度与亮度函数都从应用里 import，不在守卫里重写公式——那是第二份判定（铁律 6）：
 * 主实现改了公式或阈值，守卫还按旧的算，结论全错而两边都绿。
 */
import { describe, expect, it } from "vitest";
import { appearanceSkins } from "./appearanceSkins";

const MAX_DARK_BG_LUMINANCE = 0.05; // 深色版底色的上限：再亮就不是深色了
const MIN_LIGHT_BG_LUMINANCE = 0.7; // 浅色版底色的下限——但只对「画在白天」的那几套成立
/**
 * 浅色版**必须真亮**的那几套（按 id 点名）。
 *
 * 与下面那张夜景名单是一对：每条皮肤必须落在其中一张表里，
 * 落在两张表外就是**新增皮肤没被分类**——本条会红，逼着加皮肤的人回来看
 * 「这套画的是白天还是夜里」，而不是顺手把阈值放宽成谁都不卡。
 */
const DAY_SCENE_IDS = ["xi-day"];
/**
 * 刻意例外：浅色版本来就该是深底的那几套。
 *
 * 【为什么允许例外存在】
 * 「浅色版亮度 > 0.7」这条老规则在「汐 · 夜阁」上是**必然红**的：那是一套画在夜里的皮肤，
 * 它的浅色版底色 `#0B1A26` 就是深海的夜。把整条规则删掉是把手里的真知识丢了；
 * 把它改成「例外名单」才既留住规则、又承认这套皮肤是故意的。
 *
 * 【为什么名单里的也要卡一条下限之上的上限】
 * 例外不能是「想不亮就不亮」的 loophole，所以下面单独给夜景套钉一条
 * `light` 亮度 < 0.2：它必须**确实是夜里**，而不是"随手调暗了一点"。
 * 至于夜景套的浅深两版到底可不可读，由 `appearance-skins.test.ts` 那三条线负责。
 */
const NIGHT_SCENE_IDS = ["xi-night"];

describe("广场每一条的底色亮度（不是靠眼睛估）", () => {
  it("表非空（空了则下面每条遍历全绿而一条不测）", () => {
    expect(appearanceSkins.length, "皮肤广场空了 —— 遍历它的守卫全都测不到东西").toBeGreaterThan(0);
  });

  it("每一条都必须被归进「白天」或「夜里」其中一张名单，且只能进一张", () => {
    for (const skin of appearanceSkins) {
      const inDay = DAY_SCENE_IDS.includes(skin.id);
      const inNight = NIGHT_SCENE_IDS.includes(skin.id);
      expect(
        inDay || inNight,
        `${skin.id}（${skin.label}）没被归进任何一张名单：它画的是白天还是夜里？`
      ).toBe(true);
      expect(inDay && inNight, `${skin.id} 同时被写进白天与夜里两张名单——两条规则会互相抵消`).toBe(
        false
      );
    }
  });

  it("深色版不用纯黑底（纯黑配纯白是 21:1，但刺眼与 OLED 拖影都在）", () => {
    for (const skin of appearanceSkins) {
      expect(skin.dark.background.toLowerCase(), `${skin.id} 的深色版用了纯黑`).not.toBe("#000000");
    }
  });

  it("深色版底色确实够暗（相对亮度 < 0.05）", async () => {
    const { relativeLuminance } = await import("./appearanceThemeRuntime");
    for (const skin of appearanceSkins) {
      expect(relativeLuminance(skin.dark.background), `${skin.id} 的深色版底色不够暗`).toBeLessThan(
        MAX_DARK_BG_LUMINANCE
      );
    }
  });

  it("白天那几套：浅色版底色确实够亮（> 0.7）", async () => {
    const { relativeLuminance } = await import("./appearanceThemeRuntime");
    for (const skin of appearanceSkins.filter((one) => DAY_SCENE_IDS.includes(one.id))) {
      expect(
        relativeLuminance(skin.light.background),
        `${skin.id} 归在白天名单里，浅色版底色却不够亮`
      ).toBeGreaterThan(MIN_LIGHT_BG_LUMINANCE);
    }
  });

  it("夜里那几套：浅色版确实是夜里（亮度 < 0.2），不是随手调暗", async () => {
    const { relativeLuminance } = await import("./appearanceThemeRuntime");
    for (const skin of appearanceSkins.filter((one) => NIGHT_SCENE_IDS.includes(one.id))) {
      expect(
        relativeLuminance(skin.light.background),
        `${skin.id} 挂在夜景例外名单上，浅色版却一点都不暗——例外不成立`
      ).toBeLessThan(0.2);
    }
  });

  // 曾经在这里写过一条「浅色版不许用纯白底」，被自己的守卫卡红了（原 Codex 用 #FFFFFF）。
  // 复核结论是**那条规则是我编的**，不是可读性要求：浅色底用纯白是绝大多数人的选择，
  // 正文色对上它是 16:1，毫无问题。硬禁只会逼着所有浅色主题染一层灰。
  // 纯黑底那条不一样——深色下纯黑配纯白是刺眼与 OLED 拖影都在的，所以留着。
  /**
   * 这里**刻意没有**「浅色版不许用纯白底」那一条。
   *
   * 2026-10-06 曾经写过一条，被自己的守卫卡红了（出厂那套 Codex 用的就是 `#FFFFFF`）。
   * 复核结论是**那条规则是我编的**，不是可读性要求：浅色底用纯白是绝大多数人的选择，
   * 正文色对上它是 16:1，毫无问题——硬禁只会逼着所有浅色主题染一层灰。
   * 纯黑底那条不一样，深色下纯黑配纯白是刺眼与 OLED 拖影都在的，所以留着。
   * 不复述成断言的理由：「没有这条规则」测不出来，写一条只为钉它的用例就是摆设。
   */
  it("深浅两版不许做成同一套（深色版的亮度必须更低）", async () => {
    const { relativeLuminance } = await import("./appearanceThemeRuntime");
    for (const skin of appearanceSkins) {
      expect(
        relativeLuminance(skin.dark.background),
        `${skin.id} 的深色版比浅色版还亮`
      ).toBeLessThan(relativeLuminance(skin.light.background));
    }
  });
});

describe("广场的 id 是用户盘上的真身，不许改名", () => {
  /**
   * 【这一条为什么在第二刀之后更重要而不是更轻】
   * `preset` / `skin` 在 contracts 里是**非枚举**字符串，所以改名不会解析失败——
   * 老 JSON 会安静地存着一个查不到的 id，然后被 store 的回落通路换成第一套。
   * 用户看到的不是「报错」，而是「我选的皮肤自己变了」，而界面上没有任何一处说真话。
   * ⇒ 加皮肤要红一次（这里认的是清单），改名也要红一次。
   */
  it("表里的 id 逐条等于清单（顺序即广场顺序，同系列昼夜成对、浅色在前）", () => {
    expect(appearanceSkins.map((skin) => skin.id)).toEqual(["xi-day", "xi-night"]);
  });
});

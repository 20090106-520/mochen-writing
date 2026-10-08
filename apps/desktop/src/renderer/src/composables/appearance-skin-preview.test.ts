/**
 * 预览 / 换上的**共用拼法**（2026-10-08 批次 5-㊷）。
 *
 * 这一份是纯 TS，能被类型检查，所以钉的是数据本身；
 * 「页面有没有真的调它」在 appearance-skin-plaza-wiring.test.ts（读源码那一半）。
 */
import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "@mochen/contracts";
import { appearanceSkins, findAppearanceSkin } from "./appearanceSkins";
import { effectiveSettings, patchSettingsWithSkin } from "./appearanceSkinPreview";

/** 取表里那一套**锚点**皮肤；取不到立刻抛错，不许兜底成表里第一套。
 *
 * 【为什么不是 `?? appearanceSkins[0]`】那是我最初写的形状，它同时坏在两处：
 * ① 类型上多背一个 `| undefined`（本仓 `noUncheckedIndexedAccess`），下面每条断言都得再窄化一次；
 * ② 更要紧的是它把「这一套被从表里删了」伪装成「测的是另一套」——锚点皮肤改名之后
 * 这一族用例会安静地绿着，而它钉的那件事已经没人管了。抛错是如实的红。 */
function anchorSkin(id: string) {
  const one = findAppearanceSkin(id);
  if (one === undefined) throw new Error(`皮肤表里没有 ${id}：锚点皮肤被改名或下架了`);
  return one;
}
const day = anchorSkin("xi-day");
const night = anchorSkin("xi-night");

/** 一份「用户已经调过偏好」的设置：mode、字号、字体、半透明侧栏**全都不是默认值**。
 *  【为什么必须非默认】默认值上测「保住现值」是假绿——
 *  把 `uiFontSize` 重写回 14、把 `translucentSidebar` 写回 true，这条断言照样绿，
 *  而用户那一份 17px 与非半透明已经没了。（默认值：mode system / 14 / 13 / true / system+song） */
function tunedSettings() {
  const base = createDefaultAppearanceSettings();
  return {
    ...base,
    mode: "dark" as const,
    uiFontFamily: "hei" as const,
    editorFontFamily: "kai" as const,
    light: {
      ...base.light,
      uiFontSize: 17,
      codeFontSize: 15,
      translucentSidebar: false
    },
    dark: {
      ...base.dark,
      uiFontSize: 17,
      codeFontSize: 15,
      translucentSidebar: false
    }
  };
}

describe("patchSettingsWithSkin · 一套皮肤落到浅深两套", () => {
  it("浅深两套的 preset 与 skin 都换成这一套的 id", () => {
    const next = patchSettingsWithSkin(tunedSettings(), day);
    // 两个字段都要写：`preset` 是老 JSON 里那份历史记录，`skin` 是广场这一批的当前判定，
    // 只写一个就会出现「外观页读 skin、别处读 preset」两套答案。
    for (const one of [next.light, next.dark]) {
      expect(one.preset).toBe(day.id);
      expect(one.skin).toBe(day.id);
    }
  });

  it("三色各取各自那一版：深色版不许被浅色版覆盖（浅深两套一起写 ≠ 写同一个值）", () => {
    for (const one of [day, night]) {
      const next = patchSettingsWithSkin(tunedSettings(), one);
      for (const key of ["accent", "background", "foreground"] as const) {
        expect(next.light[key], `${one.id} 的浅色 ${key}`).toBe(one.light[key]);
        expect(next.dark[key], `${one.id} 的深色 ${key}`).toBe(one.dark[key]);
      }
    }
    // 反向：表里任何一套的浅深两版都**不许完全相同**。
    // 这条不钉在拼法上而是钉在表上，因为「两处抄同一个值」这个缺陷只在两版不同时才看得见——
    // 先把「看得见」钉成数据约束，上面那两条才有鉴别力。
    for (const one of appearanceSkins) {
      expect(
        [one.light.accent, one.light.background, one.light.foreground],
        `${one.id} 的浅色与深色完全同值：那两套就没有分开存在的意义`
      ).not.toEqual([one.dark.accent, one.dark.background, one.dark.foreground]);
    }
  });

  it("五层（四层质感 + 画面层）在浅深两套上是同一份值", () => {
    const next = patchSettingsWithSkin(tunedSettings(), day);
    for (const layer of ["backdrop", "glass", "surface", "grid", "art"] as const) {
      expect(next.light[layer]).toBe(day[layer]);
      expect(next.dark[layer]).toBe(day[layer]);
    }
  });

  it("字号 / 字体 / 半透明侧栏 / mode 保持现值——那四项是用户偏好，不是皮肤的一部分", () => {
    const settings = tunedSettings();
    const next = patchSettingsWithSkin(settings, night);
    // mode 与两枚字体在**顶层**（contracts 里 AppearanceSettings 的那四条），
    // 字号与侧栏在浅深两份配置里。写错位置会断言到 `undefined`，
    // 而 `expect(undefined).toBe(undefined)` 是这条守卫最可能的假绿形状——所以值也钉死。
    expect(next.mode).toBe("dark");
    expect(next.uiFontFamily).toBe("hei");
    expect(next.editorFontFamily).toBe("kai");
    for (const one of [next.light, next.dark]) {
      expect(one.uiFontSize).toBe(17);
      expect(one.codeFontSize).toBe(15);
      expect(one.translucentSidebar).toBe(false);
    }
  });

  it("不改入参：返回新对象，原设置一个字段都没动（预览要能原样退回去）", () => {
    const settings = tunedSettings();
    const before = structuredClone(settings);
    const next = patchSettingsWithSkin(settings, day);
    expect(settings).toEqual(before);
    expect(next).not.toBe(settings);
    expect(next.light).not.toBe(settings.light);
  });
});

describe("effectiveSettings · 屏幕上该刷哪一份", () => {
  it("没有预览皮肤时**原样返回同一个对象**（不复制、不重排）", () => {
    const settings = tunedSettings();
    // `toBe` 而不是 `toEqual`：等于复制一份的话，App.vue 那条深比较会以为设置变了，
    // 于是每次 applyTheme 都重写 24 枚 token——不报错，只是白刷。
    expect(effectiveSettings(settings, null)).toBe(settings);
  });

  it("预览中时与 patchSettingsWithSkin 逐字段同值（预览看到的 == 换上得到的，只有一份拼法）", () => {
    const settings = tunedSettings();
    expect(effectiveSettings(settings, day)).toEqual(patchSettingsWithSkin(settings, day));
  });
});

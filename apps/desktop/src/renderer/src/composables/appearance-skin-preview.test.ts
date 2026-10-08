/**
 * 预览 / 换上的**共用拼法**（2026-10-08 批次 5-㊷）。
 *
 * 这一份是纯 TS，能被类型检查，所以钉的是数据本身；
 * 「页面有没有真的调它」在 appearance-skin-plaza-wiring.test.ts（读源码那一半）。
 */
import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "@mochen/contracts";
import { appearanceSkins, defaultAppearanceSkin, findAppearanceSkin } from "./appearanceSkins";
import {
  effectiveSettings,
  patchSettingsWithSkin,
  reconcileStoredSkin
} from "./appearanceSkinPreview";

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

/**
 * 读盘时的**回落**（2026-10-08 第二刀）。
 *
 * 【这一族为什么必须存在】
 * 用户裁定「把没有皮肤没有图片的全删了」之后，盘上存着 `skin: "paper"` 这类已删 id 的
 * appearance.json **依然合法**——`preset` / `skin` 在 contracts 里是非枚举的
 * `z.string().trim().min(1)`，safeParse 照样成功。
 * 于是那一份会带着一个表里不存在的 id 一路走到界面上：
 * 外观页说「未知的一套」，皮肤广场那边却没有一张卡是选中的，两处互相矛盾。
 * ⇒ 回落只有 `reconcileStoredSkin` 这一份实现，读盘时过一次。
 *
 * 【为什么不直接改盘上的文件】
 * 静默重写别人的 appearance.json 是比「界面退回默认」更重的一件事：
 * 那十套配色里存着的 accent/background/foreground 会永久消失，不可回退。
 * 所以只改内存里那一份，`replacedSkinId` 交给界面说实话，
 * 用户真去点一次「换上」或改任何设置，才由那条通路正常落盘。
 */
describe("reconcileStoredSkin · 存着已下架的 id 时回落成广场第一套", () => {
  /** 一份「盘上存着已删 id」的设置：浅深两套都写 `paper`（十套素面里的那一套）。 */
  function retiredSkinSettings() {
    const base = createDefaultAppearanceSettings();
    return {
      ...base,
      light: { ...base.light, preset: "paper", skin: "paper", accent: "#A25D35" },
      dark: { ...base.dark, preset: "paper", skin: "paper", accent: "#E49B66" }
    };
  }

  it("盘上那套已不存在 → 回落成 defaultAppearanceSkin，且回报被换掉的原 id", () => {
    const { settings, replacedSkinId } = reconcileStoredSkin(retiredSkinSettings());
    expect(replacedSkinId).toBe("paper");
    for (const scheme of ["light", "dark"] as const) {
      const one = settings[scheme];
      expect(one.skin).toBe(defaultAppearanceSkin.id);
      expect(one.preset).toBe(defaultAppearanceSkin.id);
      // 三色与五层一起换：只换 id 不换值，外观页就会说「汐 · 昼阁」而屏幕上还是暖纸。
      for (const key of ["accent", "background", "foreground"] as const) {
        expect(one[key], `${scheme} 的 ${key} 没跟着回落`).toBe(defaultAppearanceSkin[scheme][key]);
      }
      for (const key of ["backdrop", "glass", "surface", "grid", "art"] as const) {
        expect(one[key], `${scheme} 的 ${key} 没跟着回落`).toBe(defaultAppearanceSkin[key]);
      }
    }
    // 浅色取浅色版、深色取深色版，两套不许串。
    expect(settings.dark.accent).toBe(defaultAppearanceSkin.dark.accent);
    expect(settings.light.accent).toBe(defaultAppearanceSkin.light.accent);
    expect(settings.light.art, "回落完还是没有画面，等于换了个名字继续摆素面").not.toBe("none");
  });

  it("用户调过的偏好一项都不丢：mode、字体、字号、半透明侧栏原样保住", () => {
    const { settings } = reconcileStoredSkin({
      ...tunedSettings(),
      light: { ...tunedSettings().light, skin: "ocean" }
    });
    expect(settings.mode).toBe("dark");
    expect(settings.uiFontFamily).toBe("hei");
    expect(settings.editorFontFamily).toBe("kai");
    for (const one of [settings.light, settings.dark]) {
      expect(one.uiFontSize).toBe(17);
      expect(one.codeFontSize).toBe(15);
      expect(one.translucentSidebar).toBe(false);
    }
  });

  it("盘上那套还在表里（xi-night）→ **同一个对象原样返回**，replacedSkinId 为 null", () => {
    const stored = patchSettingsWithSkin(tunedSettings(), night);
    // `toBe` 而不是 `toEqual`：回落点若写成「无论如何都 patch 一遍」，
    // 深比较看不出来，而 App.vue 那条深比较会以为设置变了、每次开窗都白刷一遍 token。
    expect(reconcileStoredSkin(stored).settings).toBe(stored);
    expect(reconcileStoredSkin(stored).replacedSkinId).toBeNull();
  });

  it("只有一套认不出也算认不出（浅色在表里、深色存着已删 id）", () => {
    const stored = {
      ...tunedSettings(),
      light: { ...tunedSettings().light, skin: night.id },
      dark: { ...tunedSettings().dark, skin: "dusk" }
    };
    const { settings, replacedSkinId } = reconcileStoredSkin(stored);
    expect(replacedSkinId).toBe("dusk");
    expect(settings.light.skin).toBe(defaultAppearanceSkin.id);
    expect(settings.dark.skin).toBe(defaultAppearanceSkin.id);
  });

  it("回落不改入参（与 patchSettingsWithSkin 同一条口径）", () => {
    const stored = retiredSkinSettings();
    const before = structuredClone(stored);
    const { settings } = reconcileStoredSkin(stored);
    expect(stored).toEqual(before);
    expect(settings).not.toBe(stored);
  });

  it("出厂默认自己就过得去（回落不该在第一次 load 时就触发）", () => {
    const fresh = createDefaultAppearanceSettings();
    expect(reconcileStoredSkin(fresh).settings).toBe(fresh);
    expect(reconcileStoredSkin(fresh).replacedSkinId).toBeNull();
  });

  it("回落点自己必须带画、且在表里（表空了这里先红，而不是把 undefined 带进界面）", () => {
    expect(defaultAppearanceSkin.art).not.toBe("none");
    expect(findAppearanceSkin(defaultAppearanceSkin.id)).toBe(defaultAppearanceSkin);
    expect(appearanceSkins[0]).toBe(defaultAppearanceSkin);
  });
});

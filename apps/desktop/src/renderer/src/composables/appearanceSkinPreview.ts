/**
 * 皮肤的**预览 / 换上**共用换算（2026-10-08 批次 5-㊷）。
 *
 * 【为什么单开一份，而不是让页面自己拼那个对象】
 * 「把一套皮肤落到设置上」这件事有两个调用方：
 *   · 换上（要落盘：`appearance.update` → 主进程 → appearance.json）
 *   · 整窗预览（**不许落盘**：只把结果刷到 `<html>` 上，退出预览就得原样回来）
 * 两处各拼一遍就是两份真相——而这两份漂移的后果不是「显示不一致」，
 * 是**预览看到的和换上得到的不是同一套**：用户在预览里觉得好，点下「就用它」，
 * 界面换成了另一个样子。本仓那条铁律（名字不许分家、一份真相）钉的就是这一族。
 * ⇒ 拼法只有下面这一个函数，三处都调它：换上、整窗预览、
 *   以及 2026-10-08 第二刀加的**读盘回落**（`reconcileStoredSkin`，见文件末尾）。
 *
 * 【为什么纯、且不碰 DOM】
 * 纯函数能被类型检查，也能被真用例断言（浅深两套是否同时改、字号与侧栏是否保住）。
 * 「刷到 DOM 上」是 App.vue 那一条通路的事，它已经存在，这里不另开第二条。
 */
import type { AppearanceSettings } from "@mochen/contracts";
import { defaultAppearanceSkin, findAppearanceSkin, type AppearanceSkin } from "./appearanceSkins";

/**
 * 一套皮肤落到浅深两套上：skin id、三色、视觉五层（四层质感 + 画面层）一并写。
 *
 * **浅深两套必须一起写**（与 5-㊴ 那条老理由同一条）：只改一边就会得到
 * 「浅色新皮肤、深色旧皮肤」的精神分裂，而 `mode` 可以是 system——
 * 那就是有一半时间在看不相配的那一版。
 *
 * **字号、字体与半透明侧栏保持现值**：那三项是用户自己调过的偏好，不是皮肤的一部分。
 */
export function patchSettingsWithSkin(
  settings: AppearanceSettings,
  skin: AppearanceSkin
): AppearanceSettings {
  const visual = {
    backdrop: skin.backdrop,
    glass: skin.glass,
    surface: skin.surface,
    grid: skin.grid,
    art: skin.art,
    /* 挂件层（2026-10-17 第六刀）。**必须并进这一份 `visual`**：
       预览是「把整套皮肤刷到 <html> 上」，漏了这一层就会出现
       「预览里窗角什么都没有、换上之后才冒出来」——正是这份函数要消灭的那种漂移。 */
    ornament: skin.ornament
  };
  return {
    ...settings,
    light: { ...settings.light, preset: skin.id, skin: skin.id, ...skin.light, ...visual },
    dark: { ...settings.dark, preset: skin.id, skin: skin.id, ...skin.dark, ...visual }
  };
}

/**
 * 现在**该刷到屏幕上**的那份设置：预览中就返回预览那套的结果，否则原样返回。
 *
 * 【为什么写成这样一个岔口，而不是「预览时另调一次 applyTheme」】
 * 预览是**文档级**的效果（整窗换背景、换玻璃），而文档级的唯一刷写点在 App.vue 的
 * `applyTheme()`。如果预览自己再刷一次 DOM，就会出现两个作者写同一批 `--skin-*`：
 * 设置一变（改字号、切换深浅）App.vue 立刻把预览刷掉，用户在预览里看到的会自己变回去。
 * ⇒ 让 App.vue 只有这一个作者，把「预览中了哪套」当成它读的一份输入。
 */
export function effectiveSettings(
  settings: AppearanceSettings,
  previewSkin: AppearanceSkin | null
): AppearanceSettings {
  return previewSkin ? patchSettingsWithSkin(settings, previewSkin) : settings;
}

/**
 * 读盘回落：盘上存着**已经不在广场表里**的皮肤时，换成 `defaultAppearanceSkin`。
 *
 * 【2026-10-08 第二刀带来的新通路】
 * 用户裁定「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」，
 * 于是十套素面配色（`appearanceTones.ts`）连同 `themePresets` 投影一起删了。
 * 但 contracts 里 `preset` / `skin` 是非枚举的 `z.string().trim().min(1)`，
 * 老 JSON 存着 `"paper"`、`"codex"` 这类已经没了的 id 时 **safeParse 仍然成功**，
 * 主进程那边也照样回 `persisted: true`。
 * 不在这里收口的话，界面会分成两半说话：外观页念一句「未知的一套」，
 * 皮肤广场那边一张卡都不选中，而屏幕上还渲染着那套已经下架的三色。
 *
 * 【三条边界】
 * ① **只改内存，不写盘。** 盘上那一份是三色 + 字号 + 侧栏偏好混在一起的用户数据，
 *    静默重写等于把人家存着的配色销毁；用户点一次「换上」才由 `patchSettingsWithSkin`
 *    那条正常通路落盘。
 * ② **回落值来自 `patchSettingsWithSkin`，不在这里再拼一遍**（铁律 6）：
 *    它已经在 5-㊷ 因为「预览与换上各拼一份」而单独成函数，这里是第三个调用方。
 * ③ **认不认只看 `skin` 这一个字段**，不去猜 `preset`。第二档「查 preset」是上一版
 *    「素面配色还留着」那条安排的遗留，那张表已经删了，别再把它加回来
 *    （`appearance-panel-wiring.test.ts` 反向钉着这一点）。
 *
 * @returns `replacedSkinId` 是被换掉的那个原 id（界面拿它说实话）；没换过时为 `null`。
 */
export function reconcileStoredSkin(settings: AppearanceSettings): {
  settings: AppearanceSettings;
  replacedSkinId: string | null;
} {
  const unknown = [settings.light.skin, settings.dark.skin].find(
    (id) => findAppearanceSkin(id) === undefined
  );
  if (unknown === undefined) return { settings, replacedSkinId: null };
  return {
    settings: patchSettingsWithSkin(settings, defaultAppearanceSkin),
    replacedSkinId: unknown
  };
}

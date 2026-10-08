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
 * ⇒ 拼法只有下面这一个函数，两处都调它。
 *
 * 【为什么纯、且不碰 DOM】
 * 纯函数能被类型检查，也能被真用例断言（浅深两套是否同时改、字号与侧栏是否保住）。
 * 「刷到 DOM 上」是 App.vue 那一条通路的事，它已经存在，这里不另开第二条。
 */
import type { AppearanceSettings } from "@mochen/contracts";
import type { AppearanceSkin } from "./appearanceSkins";

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
    art: skin.art
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

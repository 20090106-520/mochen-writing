/**
 * 「记住思考档」的持久化（2026-10-05 设置页新增，用户裁定「设置功能太少」的补课之一）。
 *
 * 现状：思考档位（off/low/…）是每轮的运行态，切完重启就回「关」；这一档偏好让
 * 「下次启动照上一次那一档」变成**可选项**而不是强加的行为——默认关，保持现状。
 * 与 web-search-preference 同一类本机偏好：走 localStorage，零新 IPC；
 * 真正出站的键值对仍由每轮的 thinkingLevel 决定，偏好只管「启动时从哪一档开始」。
 *
 * 读写都收成纯函数：坏值/不可用存储一律退回默认（不记），不让设置页开不了。
 */
import { THINKING_LEVELS, type ThinkingLevel } from "@mochen/contracts";

export const THINKING_PREFERENCE_KEY = "mochen.thinkingRemember";

/** 思考档位本身的记忆键：存的是「上一次切到的那一档」，档位合法性由调用方对照 contracts 校验。 */
export const THINKING_LEVEL_STORAGE_KEY = "mochen.thinkingLevel";

export interface ThinkingPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 默认不记：每次启动从「关」开始是现状，开关只是把记忆权交给用户。 */
export const THINKING_REMEMBER_DEFAULT = false;

/** 读开关；storage 不可用（测试/隐私模式）退回默认（不记）。 */
export function loadThinkingRemember(storage: ThinkingPreferenceStorage | null): boolean {
  if (storage === null) return THINKING_REMEMBER_DEFAULT;
  const raw = storage.getItem(THINKING_PREFERENCE_KEY);
  if (raw === null) return THINKING_REMEMBER_DEFAULT;
  return raw === "on";
}

export function saveThinkingRemember(storage: ThinkingPreferenceStorage, enabled: boolean): void {
  if (enabled) storage.setItem(THINKING_PREFERENCE_KEY, "on");
  else storage.removeItem(THINKING_PREFERENCE_KEY);
}

/** 档位记忆：开着「记住」时每次切档都写；关掉开关时连同档位一起清（不留半份记忆）。 */
export function saveThinkingLevel(storage: ThinkingPreferenceStorage, level: string): void {
  storage.setItem(THINKING_LEVEL_STORAGE_KEY, level);
}

export function loadThinkingLevel(storage: ThinkingPreferenceStorage): string | null {
  return storage.getItem(THINKING_LEVEL_STORAGE_KEY);
}

export function clearThinkingLevel(storage: ThinkingPreferenceStorage): void {
  storage.removeItem(THINKING_LEVEL_STORAGE_KEY);
}

/**
 * 启动档位：记住开着才读档位记忆，关着（默认）恒回「关」——原行为一字不变。
 * 档位合法性在这里对照 contracts 的 THINKING_LEVELS 校验（偏好只管存取，枚举关卡在这里）。
 */
export function initialThinkingLevel(storage: ThinkingPreferenceStorage | null): ThinkingLevel {
  if (storage === null || !loadThinkingRemember(storage)) return "off";
  const raw = loadThinkingLevel(storage);
  return (THINKING_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as ThinkingLevel)
    : "off";
}

/** 开关切换的落库真身：关掉连档位记忆一起清——半份记忆会让下次启动落到说不清的那一档。 */
export function persistThinkingRemember(
  storage: ThinkingPreferenceStorage,
  enabled: boolean,
  currentLevel: string
): void {
  saveThinkingRemember(storage, enabled);
  if (!enabled) clearThinkingLevel(storage);
  else saveThinkingLevel(storage, currentLevel);
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认值，不抛错）。 */
export function thinkingPreferenceStorage(): ThinkingPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

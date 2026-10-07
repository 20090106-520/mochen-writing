/**
 * 「联网搜索」默认档的持久化（2026-10-05 设置页新增）。
 *
 * 为什么住在这里而不是新开一条 IPC：它只是本机的一个默认开关（下一次启动还记不记得），
 * 与右栏宽度（`utils/rightPanePreferences.ts`）同一类偏好，走 localStorage 就够了；
 * 每轮真正出网与否仍由 agent store 的运行时状态决定，两者不互相冒充。
 *
 * 读写都收成纯函数：坏值/不可用存储一律退回默认（关），不让设置页开不了。
 */
export const WEB_SEARCH_PREFERENCE_KEY = "mochen.webSearchDefault";

export interface WebSearchPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 默认不联网：出网是显式的动作，不该由「上次忘了关」替用户决定。 */
export const WEB_SEARCH_DEFAULT = false;

/** 读默认档；storage 不可用（测试/隐私模式）退回默认（关）。 */
export function loadWebSearchDefault(storage: WebSearchPreferenceStorage | null): boolean {
  if (storage === null) return WEB_SEARCH_DEFAULT;
  const raw = storage.getItem(WEB_SEARCH_PREFERENCE_KEY);
  if (raw === null) return WEB_SEARCH_DEFAULT;
  return raw === "on";
}

export function saveWebSearchDefault(storage: WebSearchPreferenceStorage, enabled: boolean): void {
  storage.setItem(WEB_SEARCH_PREFERENCE_KEY, enabled ? "on" : "off");
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认值，不抛错）。 */
export function webSearchPreferenceStorage(): WebSearchPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // 注意：window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，
    // 直接返回会让调用方的 `=== null` 判空漏掉它 ⇒ 必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * HotkeyConfigStore —— 可自定义快捷键配置
 *
 * 管理用户自定义的快捷键绑定：
 * - 内置默认键位（与 hotkey-guide.ts 保持一致）
 - 用户覆盖键位（存 localStorage）
 * - 冲突检测（同一动作不许两个键位，同一键位不许两个动作）
 * - 重置为默认
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** 动作 ID —— 与现有 hotkeys.ts 的 resolveEscape / useGlobalHotkeys 对齐 */
export type HotkeyAction =
  | "send"
  | "newline"
  | "stop"
  | "accept-proposal"
  | "deny-proposal"
  | "open-settings"
  | "new-conversation"
  | "open-search"
  | "toggle-left-pane"
  | "toggle-right-pane"
  | "cycle-thinking"
  | "toggle-web-search";

export interface HotkeyBinding {
  action: HotkeyAction;
  keys: string; // 显示用：如 "Ctrl+Enter"
  code: string; // 内部用：如 "ctrl_enter"
  /** true = 用户改过的 */
  customized: boolean;
  enabled: boolean;
}

const STORAGE_KEY = "mochen.hotkey-config.v1";

const DEFAULT_BINDINGS: HotkeyBinding[] = [
  { action: "send", keys: "Enter", code: "enter", customized: false, enabled: true },
  {
    action: "newline",
    keys: "Shift+Enter",
    code: "shift_enter",
    customized: false,
    enabled: true
  },
  { action: "stop", keys: "Escape", code: "escape", customized: false, enabled: true },
  {
    action: "accept-proposal",
    keys: "Ctrl+Shift+A",
    code: "ctrl_shift_a",
    customized: false,
    enabled: true
  },
  {
    action: "deny-proposal",
    keys: "Ctrl+Shift+D",
    code: "ctrl_shift_d",
    customized: false,
    enabled: true
  },
  {
    action: "open-settings",
    keys: "Ctrl+,",
    code: "ctrl_comma",
    customized: false,
    enabled: true
  },
  {
    action: "new-conversation",
    keys: "Ctrl+Shift+N",
    code: "ctrl_shift_n",
    customized: false,
    enabled: true
  },
  {
    action: "open-search",
    keys: "Ctrl+Shift+F",
    code: "ctrl_shift_f",
    customized: false,
    enabled: true
  },
  {
    action: "toggle-left-pane",
    keys: "Ctrl+B",
    code: "ctrl_b",
    customized: false,
    enabled: true
  },
  {
    action: "toggle-right-pane",
    keys: "Ctrl+Shift+B",
    code: "ctrl_shift_b",
    customized: false,
    enabled: true
  },
  {
    action: "cycle-thinking",
    keys: "Ctrl+T",
    code: "ctrl_t",
    customized: false,
    enabled: true
  },
  {
    action: "toggle-web-search",
    keys: "Ctrl+Shift+W",
    code: "ctrl_shift_w",
    customized: false,
    enabled: true
  }
];

function loadBindings(): HotkeyBinding[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_BINDINGS];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_BINDINGS];
    const userBindings = JSON.parse(raw) as HotkeyBinding[];
    // 合并：用户覆盖 code 不同的，其余保默认
    const merged = [...DEFAULT_BINDINGS];
    for (const ub of userBindings) {
      const idx = merged.findIndex((b) => b.action === ub.action);
      if (idx !== -1 && ub.code) {
        const current = merged[idx]!;
        merged[idx] = {
          action: current.action,
          keys: ub.keys,
          code: ub.code,
          customized: true,
          enabled: ub.enabled ?? current.enabled
        };
      }
    }
    return merged;
  } catch {
    return [...DEFAULT_BINDINGS];
  }
}

function saveBindings(bindings: HotkeyBinding[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings.filter((b) => b.customized)));
  } catch {
    // 静默
  }
}

export const useHotkeyConfigStore = defineStore("hotkeyConfig", () => {
  const bindings = ref<HotkeyBinding[]>(loadBindings());

  watch(bindings, (val) => saveBindings(val), { deep: true });

  const customizedBindings = computed(() => bindings.value.filter((b) => b.customized));
  const enabledBindings = computed(() => bindings.value.filter((b) => b.enabled));

  /** 通过 action 查 code */
  function codeForAction(action: HotkeyAction): string | null {
    const b = bindings.value.find((x) => x.action === action);
    return b && b.enabled ? b.code : null;
  }

  /** 通过 code 反查 action */
  function actionForCode(code: string): HotkeyAction | null {
    const b = bindings.value.find((x) => x.code === code);
    return b && b.enabled ? b.action : null;
  }

  /** 检查 code 是否与现有已启用的绑定冲突（排除自己） */
  function findConflict(code: string, excludeAction?: HotkeyAction): HotkeyBinding | null {
    return (
      bindings.value.find((b) => b.code === code && b.enabled && b.action !== excludeAction) ?? null
    );
  }

  /** 修改某动作的键位 */
  function rebind(
    action: HotkeyAction,
    keys: string,
    code: string
  ): { success: boolean; conflictWith?: string } {
    const conflict = findConflict(code, action);
    if (conflict) {
      return { success: false, conflictWith: conflict.action };
    }

    const b = bindings.value.find((x) => x.action === action);
    if (!b) return { success: false };

    b.keys = keys;
    b.code = code;
    b.customized = true;
    return { success: true };
  }

  /** 切换启用 */
  function toggleEnabled(action: HotkeyAction): void {
    const b = bindings.value.find((x) => x.action === action);
    if (b) b.enabled = !b.enabled;
  }

  /** 重置单个为默认 */
  function resetToDefault(action: HotkeyAction): void {
    const def = DEFAULT_BINDINGS.find((b) => b.action === action);
    const cur = bindings.value.find((b) => b.action === action);
    if (def && cur) {
      cur.keys = def.keys;
      cur.code = def.code;
      cur.customized = false;
      cur.enabled = def.enabled;
    }
  }

  /** 全部重置 */
  function resetAll(): void {
    bindings.value = [...DEFAULT_BINDINGS];
  }

  return {
    bindings,
    customizedBindings,
    enabledBindings,
    codeForAction,
    actionForCode,
    findConflict,
    rebind,
    toggleEnabled,
    resetToDefault,
    resetAll
  };
});

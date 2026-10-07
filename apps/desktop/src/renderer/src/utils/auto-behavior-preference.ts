/**
 * 「自动行为」一组开关的持久化（2026-10-06 设置页「写作」新增）。
 *
 * 一个模块管一组，不是一个开关一个文件：这三件事问的都是同一个问题——**哪些步骤不等我点**，
 * 面板也是同一节里并排摆着。真身仍然是各自既有的那一步（发消息乐观清空草稿 / 批准提案后
 * 主进程写盘并回读），这里只管「开还是关」，不重写任何一步的行为。
 * 与 autosave-preference / editor-leading-preference 同一类本机偏好：走 localStorage，零新 IPC。
 *
 * 坏值一律退回默认档（不抛）：默认值就是改动前的行为，所以存坏值只等于「没设置过」，
 * 不会把用户带到一个他没选过的状态上去。
 *
 * 自动保存那一项**不另存一份档位**：它就是 `AUTOSAVE_DELAY_OPTIONS`（0/1/2/5 秒，0 = 关），
 * 控件摆在面板里上面那节「自动保存」；本模块的 `loadAutoSave` / `saveAutoSave` 是它的转发，
 * 同一个 storage key、同一张档位表（见 auto-behavior-preference.test.ts 的同键断言）。
 */
import {
  AUTOSAVE_DEFAULT_DELAY_MS,
  autosaveOptions,
  loadAutosaveDelay,
  saveAutosaveDelay,
  type AutosaveDelay,
  type AutosaveOption,
  type AutosavePreferenceStorage
} from "./autosave-preference";

/** 送出后清空输入框：原本无条件清空（发出去即清），默认开 = 原行为。 */
export const AUTO_CLEAR_COMPOSER_KEY = "mochen.auto.clearComposerAfterSend";

/** 批准后自动同步正文：默认开 = 原行为（改动前批准即写盘、随即回读右栏）。 */
export const AUTO_COMMIT_APPROVED_KEY = "mochen.auto.autoCommitApproved";

export interface AutoBehaviorPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 开关只有这两枚（自动保存那一项是档位，不是开关，见 autoSaveBehaviorOptions）。 */
export const AUTO_SWITCH_IDS = ["clearComposerAfterSend", "autoCommitApproved"] as const;

export type AutoSwitchId = (typeof AUTO_SWITCH_IDS)[number];

/** 默认值必须等于改动前的行为：清空与自动落盘改动前都是「一直开着」。 */
export const AUTO_SWITCH_DEFAULTS: Record<AutoSwitchId, boolean> = {
  clearComposerAfterSend: true,
  autoCommitApproved: true
};

const AUTO_SWITCH_KEYS: Record<AutoSwitchId, string> = {
  clearComposerAfterSend: AUTO_CLEAR_COMPOSER_KEY,
  autoCommitApproved: AUTO_COMMIT_APPROVED_KEY
};

export interface AutoBehaviorOption {
  id: AutoSwitchId;
  label: string;
  /** 它管的是哪一步：面板不另抄，label/note 一起从这张表出。 */
  note: string;
  /** 关掉之后会发生什么。必须说清后果——只说「自动」两个字等于没说。 */
  offEffect: string;
}

const AUTO_BEHAVIOR_OPTIONS: Record<AutoSwitchId, AutoBehaviorOption> = {
  clearComposerAfterSend: {
    id: "clearComposerAfterSend",
    label: "送出后清空输入框",
    note: "消息一送出去就把输入框清空；这一轮没能启动时，那段字会自动还回这一格。",
    offEffect: "关掉之后输入框留住原文，消息照发；同一个输入框里会堆着上一段，要自己删。"
  },
  autoCommitApproved: {
    id: "autoCommitApproved",
    // **名字与说明在 5-⑧ 改过**。原文写「批准一条改稿提案就立刻写进作品目录」——
    // 那是**主进程**做的事（批准即执行写入），渲染层这一枚开关管不到，也不该假装管得了。
    // 渲染层真正能控的是：主进程写完之后，右栏要不要自动换成盘上的新内容。
    // 说法与真身对齐之后，这一节才不是「一排看着像开关的装饰」。
    label: "批准改稿后自动同步正文",
    note: "智能体写进作品目录之后，右栏正文立刻换成盘上的新内容。",
    offEffect:
      "关掉之后批准照旧写盘，但右栏停在旧正文上并标出冲突，要你自己确认重载；" +
      "（盘上的改动不会丢，只是不替你换到屏幕上）"
  }
};

export function autoBehaviorOptions(): AutoBehaviorOption[] {
  return AUTO_SWITCH_IDS.map((id) => AUTO_BEHAVIOR_OPTIONS[id]);
}

/**
 * 读一枚开关。坏值（null / undefined / 空串 / "1" / "TRUE" / 手改出来的别的串）退回默认档：
 * 布尔只有 "true" / "false" 两个合法写法，其余一律当没设置过。
 */
export function loadAutoSwitch(
  storage: AutoBehaviorPreferenceStorage | null,
  id: AutoSwitchId
): boolean {
  const fallback = AUTO_SWITCH_DEFAULTS[id];
  if (storage === null) return fallback;
  const raw = storage.getItem(AUTO_SWITCH_KEYS[id]);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function saveAutoSwitch(
  storage: AutoBehaviorPreferenceStorage,
  id: AutoSwitchId,
  value: boolean
): void {
  storage.setItem(AUTO_SWITCH_KEYS[id], value ? "true" : "false");
}

export interface AutoSaveBehaviorEntry {
  id: "autoSave";
  label: string;
  note: string;
  /** 它的控件是档位表（关 / 1 / 2 / 5 秒），不是开关：面板里就是上面那节「自动保存」。 */
  control: "autosave-delay";
  /** 档位与文案直接取自 autosave-preference 的那一份，**这里一个字都不另抄**。 */
  options: AutosaveOption[];
  defaultDelay: AutosaveDelay;
}

/**
 * 自动保存这一项的说明与档位。`options` 是 `autosaveOptions()` 的返回值本身——
 * 「自动行为」这一节要是自己抄一遍 0/1/2/5 秒，就是同一档位的第二份实现（铁律 6）。
 */
export function autoSaveBehavior(): AutoSaveBehaviorEntry {
  return {
    id: "autoSave",
    label: "自动保存",
    note: "停手满一档时间就自动存一次；关这一档只剩手动保存（保存按钮 / Ctrl S）。",
    control: "autosave-delay",
    options: autosaveOptions(),
    defaultDelay: AUTOSAVE_DEFAULT_DELAY_MS
  };
}

/** 转发（不是副本）：读的就是 autosave-preference 那个 key 的那一档。 */
export function loadAutoSave(storage: AutosavePreferenceStorage | null): AutosaveDelay {
  return loadAutosaveDelay(storage);
}

/** 转发（不是副本）：写回同一个 key，档位集也只有那一份。 */
export function saveAutoSave(storage: AutosavePreferenceStorage, delay: AutosaveDelay): void {
  saveAutosaveDelay(storage, delay);
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function autoBehaviorPreferenceStorage(): AutoBehaviorPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 读「批准改稿后自动同步正文」这一枚（2026-10-06 批次 5-⑧）。
 *
 * 单独给 store 一个入口而不是让它自己去拼 storage + id：设置页与 `absorbAgentWrite`
 * 问的是同一枚开关，两处各写一遍 `loadAutoSwitch(autoBehaviorPreferenceStorage(), …)`
 * 就等于「哪一枚开关」这件事有了第二处定义——将来改 key 只会改到其中一处。
 */
export function autoAdoptApproved(): boolean {
  return loadAutoSwitch(autoBehaviorPreferenceStorage(), "autoCommitApproved");
}

/** 读「送出后清空输入框」那一枚（同上理由：两个发送出口 + 还字账三处读的是同一个值）。 */
export function clearComposerAfterSend(): boolean {
  return loadAutoSwitch(autoBehaviorPreferenceStorage(), "clearComposerAfterSend");
}

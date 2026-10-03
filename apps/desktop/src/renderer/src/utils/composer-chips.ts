import {
  THINKING_LEVEL_LABELS,
  THINKING_WIRE_FIELD,
  USER_TEXT_MAX_LEN,
  WEB_SEARCH_WIRE_TYPE,
  codePointLength,
  type PermissionMode,
  type ThinkingLevel
} from "@mochen/contracts";
import { permissionChipView } from "./permission-chip";
import { toolRoster } from "./tool-roster";

export type ComposerChipId =
  "permission" | "thinking" | "web-search" | "tools" | "model" | "palette";

/**
 * chip 住在卡内 toolbar 的哪一端（#105 照搬 deepwrite 的左右分栏）。
 * 分栏是决策不是样式：它是这张决策表的字段，模板只按它过滤（铁律 6，模板里不许出现第二份顺序表）。
 * 左端=运行配置入口（模型合并口径 / 工具清单 / 命令面板），右端=权限与两枚真开关 + 发送键。
 */
export type ComposerChipSlot = "left" | "right";

/** 地球角标的唯一取值来源：本仓图标名表里就有 globe，模板按这个字段渲染，不自行判定联网状态。 */
export type ComposerChipBadge = "globe";

export interface ComposerChipView {
  id: ComposerChipId;
  text: string;
  disabled: boolean;
  title: string;
  /** 按下态：驱动 `aria-pressed` 与高亮。只有真开关能为真，工具清单与面板是入口，永远假。 */
  active: boolean;
  /** toolbar 分栏（#105）。 */
  slot: ComposerChipSlot;
  /** 角标（#105 合并口径）：目前只有模型 chip 在联网开启时挂 globe，其余一律 null。 */
  badge: ComposerChipBadge | null;
}

export type ComposerChipEvent =
  | "open-permission-menu"
  | "cycle-thinking"
  | "toggle-web-search"
  | "open-tool-roster"
  | "open-model-select"
  | "open-palette";

// CHIP_EMIT 住在这一 `.ts` 文件而不是 ComposerBox.vue：本仓 verify 链用裸 tsc，
// tsconfig.web.json 的 include 只收 `.ts`/`.d.ts`，`.vue` 的 `<script setup>` 永远不进类型程序——
// `Record<ComposerChipId, …>` 的穷尽性关卡只有放在 `.ts` 才咬得住：将来给 ComposerChipId 扩一枚
// 新 id 而漏了这里的键，tsc 当场报 TS2741；同一份代码写在 `.vue` 里则静默通过，
// 后果是 emit(CHIP_EMIT[id]) 发出 undefined 事件、长出一枚「按了没反应的 chip」（实测变异证实）。
export const CHIP_EMIT: Record<ComposerChipId, ComposerChipEvent> = {
  permission: "open-permission-menu",
  thinking: "cycle-thinking",
  "web-search": "toggle-web-search",
  tools: "open-tool-roster",
  model: "open-model-select",
  palette: "open-palette"
};

/**
 * 深度思考那一格的文案与提示。
 *
 * title 必须报出**这一档实际发出去的那对键值**（本仓铁律：报不出出站字段名的控件不进 UI）：
 * 关档说的是「不发字段」而不是「发 off」——这两件事在服务端行为上并不等价，
 * 而差别正是 `per-run-fields.ts` 里那个 `if (level === "off") return {}`。
 */
function thinkingChip(level: ThinkingLevel): ComposerChipView {
  const on = level !== "off";
  return {
    id: "thinking",
    text: on ? `深度思考 · ${THINKING_LEVEL_LABELS[level]}` : "深度思考",
    disabled: false,
    title: on
      ? `本轮出站请求带 ${THINKING_WIRE_FIELD}=${level}（${THINKING_LEVEL_LABELS[level]}）。点击按 关 → 低 → 中 → 高 循环。`
      : `当前关闭：本轮出站请求不发 ${THINKING_WIRE_FIELD} 字段——是真的不发，不是发 "off"。点击按 关 → 低 → 中 → 高 循环。`,
    active: on,
    slot: "right",
    badge: null
  };
}

function webSearchChip(enabled: boolean): ComposerChipView {
  return {
    id: "web-search",
    text: "联网搜索",
    disabled: false,
    title: enabled
      ? `本轮已带 ${WEB_SEARCH_WIRE_TYPE} 工具（追加在 tools 里，与五个书稿工具并存）。点击关闭。`
      : `本轮不带 ${WEB_SEARCH_WIRE_TYPE} 工具，模型只能读你书稿里的字。点击开启。`,
    active: enabled,
    slot: "right",
    badge: null
  };
}

/**
 * 模型 chip 是一枚**入口**，不是开关：点开走 `provider:list-models` 拉 `{baseURL}/models` 的候选名单。
 * 恒 `disabled:false`——能不能拉名单只取决于地址，与有没有开书无关，禁用只会造出一枚摆设；
 * 恒 `active:false`——弹层是瞬态而非按下态，`aria-pressed` 用它只会撒谎。
 * title 必须报出真实通道名与被访问的地址（铁律：报不出通道名的控件不进 UI），
 * 同时把「改地址/密钥」这条它自己办不到的事指回模型设置，不让 chip 冒充设置面板。
 *
 * #105 照搬 deepwrite 的**合并口径**：文案是 `模型名 · 思考等级`（关档不缀档名），
 * 联网开着时挂地球角标（badge 字段驱动模板渲染，判定不搬进模板）。
 * title 仍以裸模型名为真身——合并的是显示，不是数据：`当前模型 ${modelLabel}` 不掺思考等级。
 */
function modelChip(input: {
  modelLabel: string;
  baseURL: string;
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
}): ComposerChipView {
  const { modelLabel, baseURL, thinkingLevel, webSearchEnabled } = input;
  const endpoint = `${baseURL}/models`;
  let title: string;
  if (baseURL === "") {
    title =
      "配置里还没有 API 地址，provider:list-models 此刻拉不到名单。先在模型设置里填好 baseURL（或手填模型名）。";
  } else if (modelLabel === "") {
    title = `还没读出当前模型名。点开试拉 ${endpoint}（走 provider:list-models 通道，密钥只在主进程发出）；也可在模型设置里手填。`;
  } else {
    title = `当前模型 ${modelLabel}。点开试拉 ${endpoint}（走 provider:list-models 通道，密钥只在主进程发出）；改地址或密钥请到模型设置。`;
  }
  const base = modelLabel === "" ? "未配置模型" : modelLabel;
  const levelPart = thinkingLevel === "off" ? "" : ` · ${THINKING_LEVEL_LABELS[thinkingLevel]}`;
  return {
    id: "model",
    text: `${base}${levelPart}`,
    disabled: false,
    title,
    active: false,
    slot: "left",
    badge: webSearchEnabled ? "globe" : null
  };
}

export function composerChips(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  saving: boolean;
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
  modelLabel: string;
  baseURL: string;
}): ComposerChipView[] {
  // 权限 chip 只调 permissionChipView 一次，不重算（设计决定 4）。
  const permission = permissionChipView(input);
  const roster = toolRoster();
  return [
    {
      id: "permission",
      text: permission.text,
      disabled: permission.disabled,
      title: permission.title,
      // 档位没有「按下/未按下」两态，只有三档；aria-pressed 用它只会撒谎，故恒假。
      active: false,
      // #105：照 deepwrite，权限档是卡内右端「更多」那一摞的事；PermissionMenu 弹层真身跟着挂右端（见 ComposerBox）。
      slot: "right",
      badge: null
    },
    thinkingChip(input.thinkingLevel),
    webSearchChip(input.webSearchEnabled),
    {
      id: "tools",
      text: "工具 ▾",
      disabled: false,
      // 枚数从清单本身数出来，不手抄「5」：contracts 加工具时这条提示跟着变，不会指着一份不存在的名单。
      title: `看它带哪 ${roster.length} 枚工具（只读清单，工具由模型自己挑，这里不能单独禁用）`,
      active: false,
      slot: "left",
      badge: null
    },
    modelChip({
      modelLabel: input.modelLabel,
      baseURL: input.baseURL,
      thinkingLevel: input.thinkingLevel,
      webSearchEnabled: input.webSearchEnabled
    }),
    {
      id: "palette",
      text: "/ 命令",
      disabled: false,
      // T9-1：实测 hotkeys.ts 的全局 Ctrl 族没有 k，键位真身是裸 / 键；
      // 旧文案宣传的「Ctrl+K 同一个入口」是不存在的键位，反向钉见 composer-chips.test.ts 第二条。
      title: "打开 / 命令面板（与直接按 / 键同一个入口）",
      active: false,
      slot: "left",
      badge: null
    }
  ];
  // 裁定 C：这里**不返回**队列数字。排队列数唯一的可见真身是 useAgentStore 的 composeStatusLine
  // （「排队 N 条」，波 1 已有单测与真机观察）；chip 行再显示一次就是同一个数两份文案。
}

/**
 * 输入区字数计数。
 *
 * 上限读 `USER_TEXT_MAX_LEN`——与主进程 `startTurnInputSchema` 里那条边界是同一个常量，
 * 所以「计数条说没超、发出去却被拒」这种分裂不会出现。
 * 计数按**码点**：`text.length` 会把一个 emoji 数成 2，用户看到的是一格，报出来是两格。
 * 口径用 `codePointLength`（含空白的裸码点数）而不是 `proseCharCount`：这里量的是「你敲进去多少」，
 * 与主进程那条边界同一个口径；页脚「正文 N 字」量的是「稿子有多少字」，两者本就不同，不许互相冒充。
 *
 * #105 裁定 A：deepwrite 的卡没有计数条，但我们不能照删——超限拒发是真边界，理由必须可见。
 * 折法是常态不占位：`near`（到上限的 USER_TEXT_NEAR_RATIO 起）或 `over` 才把那一行显出来。
 */
export const USER_TEXT_NEAR_RATIO = 0.9;

export function composerCounter(text: string): { text: string; over: boolean; near: boolean } {
  const count = codePointLength(text);
  const over = count > USER_TEXT_MAX_LEN;
  return {
    text: `${count}/${USER_TEXT_MAX_LEN}`,
    over,
    near: !over && count >= USER_TEXT_MAX_LEN * USER_TEXT_NEAR_RATIO
  };
}

import {
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  THINKING_WIRE_FIELD,
  USER_TEXT_MAX_LEN,
  WEB_SEARCH_TOOL_NAME,
  WORK_MODE_LABELS,
  codePointLength,
  thinkingWireValueOf,
  type PermissionMode,
  type ThinkingLevel,
  type ThinkingWire,
  type WorkMode
} from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { NO_BOOK_CHIP_LABEL, permissionChipView } from "./permission-chip";
import { toolRoster } from "./tool-roster";

export type ComposerChipId =
  "permission" | "work-mode" | "thinking" | "web-search" | "tools" | "model" | "palette";

/**
 * chip 住在卡内 toolbar 的哪一端（#105 对齐 deepwrite 的左右分栏）。
 * 分栏是决策不是样式：它是这张决策表的字段，模板只按它过滤（铁律 6，模板里不许出现第二份顺序表）。
 * #112 照参考图定栏：左端=这一轮怎么跑（模型 / 思考等级 / 联网 / 工具清单 / 命令），
 * 右端=权限档（它挨着发送键，与 deepwrite 的 composer-actions 同一位置）。
 */
export type ComposerChipSlot = "left" | "right";

export interface ComposerChipView {
  id: ComposerChipId;
  text: string;
  disabled: boolean;
  title: string;
  /** 按下态：驱动 `aria-pressed` 与高亮。只有真开关能为真，工具清单与面板是入口，永远假。 */
  active: boolean;
  /** toolbar 分栏（#105）。 */
  slot: ComposerChipSlot;
  /**
   * 文字前那枚图形（#112 照参考图）。类型就是 `IconName`：写错一个图标名，裸 tsc 当场拒绝编译，
   * 比在模板里拼字符串可靠（`.vue` 的 `<script setup>` 根本不进类型程序）。
   */
  icon: IconName;
  /** 带不带下拉三角：只有「点开一层弹层」的入口为真；两枚真开关（循环 / 开关）没有「更多」可展开。 */
  caret: boolean;
}

export type ComposerChipEvent =
  | "open-permission-menu"
  | "toggle-work-mode"
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
  "work-mode": "toggle-work-mode",
  thinking: "cycle-thinking",
  "web-search": "toggle-web-search",
  tools: "open-tool-roster",
  model: "open-model-select",
  palette: "open-palette"
};

/**
 * 工作模式 chip 的图标（2026-10-05 批次 4）。
 * 两枚不撞：计划=账本式的清单，动手=笔。工具那枚占的是 `list`，所以这里刻意避开它——
 * 两枚并排长成一个样，用户分不出自己按的是哪颗（composer-chips.test.ts 有反向钉）。
 */
export const WORK_MODE_CHIP_ICON: Record<WorkMode, IconName> = {
  plan: "ledger",
  act: "pen"
};

function workModeChip(input: { hasBook: boolean; workMode: WorkMode }): ComposerChipView {
  if (!input.hasBook) {
    return {
      id: "work-mode",
      text: NO_BOOK_CHIP_LABEL,
      disabled: true,
      title: "还没打开作品目录，工作模式改不了（它是这本书的设置）。",
      active: false,
      slot: "right",
      icon: "folder",
      caret: false
    };
  }
  const label = WORK_MODE_LABELS[input.workMode];
  return {
    id: "work-mode",
    text: label,
    disabled: false,
    title:
      input.workMode === "plan"
        ? `工作模式：${label}。这一轮它只讲打算、不动稿，提案批了也不落盘。点击切到「${WORK_MODE_LABELS.act}」。`
        : `工作模式：${label}。提案经你批准就会写入磁盘。点击切到「${WORK_MODE_LABELS.plan}」先看计划。`,
    // 真开关：计划档是「按下去生效」的两态，aria-pressed 用它才不撒谎。
    active: input.workMode === "plan",
    // 与权限档同属右端「能碰多大」那一摞（分栏是决策表的字段，铁律 6）。
    slot: "right",
    icon: WORK_MODE_CHIP_ICON[input.workMode],
    // 点一下就切换，没有第二层弹层可展开。
    caret: false
  };
}

/**
 * 深度思考那一格的文案与提示。
 *
 * #112 照参考图：这一枚只剩档位名（较低 / 标准 / 深度…），脑形图标负责说明它是什么——
 * 上一版把「深度思考 · 低」写成一整串，是在一张已经有图标的卡里重复说同一件事。
 *
 * title 必须报出**这一档实际发出去的那对键值**（本仓铁律：报不出出站字段名的控件不进 UI）：
 * 关档说的是「不发字段」而不是「发 off」——这两件事在服务端行为上并不等价，
 * 而差别正是 `per-run-fields.ts` 里那个 `if (level === "off") return {}`。
 * 循环次序从 `THINKING_LEVELS` 现拼，不手抄第二份档位名（改了标签不会留下一句说谎的提示）。
 */
const THINKING_CYCLE = THINKING_LEVELS.map((level) => THINKING_LEVEL_LABELS[level]).join(" → ");

function thinkingChip(level: ThinkingLevel, wire: ThinkingWire): ComposerChipView {
  const on = level !== "off";
  // 报的是**实际发出去的那个字**，不是档位名：`high` 档在 xhigh 那类端点上真的发 xhigh。
  // 判据与 `per-run-fields` 共用 contracts 的 thinkingWireValueOf，两边不许各写一遍。
  const wireValue = thinkingWireValueOf(level, wire);
  return {
    id: "thinking",
    text: THINKING_LEVEL_LABELS[level],
    disabled: false,
    title: on
      ? `深度思考 ${THINKING_LEVEL_LABELS[level]}：本轮出站请求带 ${THINKING_WIRE_FIELD}=${wireValue}。点击按 ${THINKING_CYCLE} 循环。`
      : `深度思考已关闭：本轮出站请求不发 ${THINKING_WIRE_FIELD} 字段——是真的不发，不是发 "off"。点击按 ${THINKING_CYCLE} 循环。`,
    active: on,
    slot: "left",
    icon: "brain",
    // 点一下走一格，不展开任何弹层 ⇒ 没有「更多」可下拉。
    caret: false
  };
}

function webSearchChip(enabled: boolean): ComposerChipView {
  return {
    id: "web-search",
    text: "联网搜索",
    disabled: false,
    title: enabled
      ? `本轮已带 ${WEB_SEARCH_TOOL_NAME} 工具（与五枚书稿工具一起出站：本地免费源，不额外要 key）。点击关闭。`
      : `本轮不带 ${WEB_SEARCH_TOOL_NAME} 工具——它真的从出站 tools 里摘掉了（工具清单也跟着少这一行），模型只能读你书稿里的字。点击开启。`,
    active: enabled,
    slot: "left",
    icon: "globe",
    caret: false
  };
}

/**
 * 模型 chip 是一枚**入口**，不是开关：点开走 `provider:list-models` 拉 `{baseURL}/models` 的候选名单。
 * 恒 `disabled:false`——能不能拉名单只取决于地址，与有没有开书无关，禁用只会造出一枚摆设；
 * 恒 `active:false`——弹层是瞬态而非按下态，`aria-pressed` 用它只会撒谎。
 * title 必须报出真实通道名与被访问的地址（铁律：报不出通道名的控件不进 UI），
 * 同时把「改地址/密钥」这条它自己办不到的事指回模型设置，不让 chip 冒充设置面板。
 *
 * #112 裁定 I（撤销 #105 的合并口径）：参考图左端是 `模型 ▾` 与 `思考等级 ▾` **两枚独立控件**，
 * 合并成一枚「模型 · 等级」是我自创的，同一件事不该在一张卡上说两遍 ⇒ 文案回到裸模型名。
 */
function modelChip(input: { modelLabel: string; baseURL: string }): ComposerChipView {
  const { modelLabel, baseURL } = input;
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
  return {
    id: "model",
    text: modelLabel === "" ? "未配置模型" : modelLabel,
    disabled: false,
    title,
    active: false,
    slot: "left",
    icon: "model",
    caret: true
  };
}

export function composerChips(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  workMode: WorkMode;
  saving: boolean;
  thinkingLevel: ThinkingLevel;
  /** 启用中那条连接把「深度」在线上叫什么；chip 的提示要报真实出站值（2026-10-09 批次 5-㊻）。 */
  thinkingWire: ThinkingWire;
  webSearchEnabled: boolean;
  modelLabel: string;
  baseURL: string;
}): ComposerChipView[] {
  // 权限 chip 只调 permissionChipView 一次，不重算（设计决定 4）。
  const permission = permissionChipView(input);
  // 清单跟着联网开关走：关掉那一轮 `web_search` 不出站，枚数也就从 6 变 5（不是手抄的两份数）。
  const roster = toolRoster(input.webSearchEnabled);
  // 数组序 = 左端从左到右的渲染序（#112 照参考图）：模型 → 思考等级 → 联网 → 工具清单 → / 命令，
  // 权限档单独落在右端（它挨着发送键，与 deepwrite 的 composer-actions 同一位置）。
  return [
    modelChip({ modelLabel: input.modelLabel, baseURL: input.baseURL }),
    thinkingChip(input.thinkingLevel, input.thinkingWire),
    webSearchChip(input.webSearchEnabled),
    {
      id: "tools",
      text: "工具",
      disabled: false,
      // 枚数从清单本身数出来，不手抄「5」：contracts 加工具时这条提示跟着变，不会指着一份不存在的名单。
      title: `看它带哪 ${roster.length} 枚工具（只读清单，工具由模型自己挑，这里不能单独禁用）`,
      active: false,
      slot: "left",
      icon: "list",
      caret: true
    },
    {
      id: "palette",
      text: "/ 命令",
      disabled: false,
      // T9-1：实测 hotkeys.ts 的全局 Ctrl 族没有 k，键位真身是裸 / 键；
      // 旧文案宣传的「Ctrl+K 同一个入口」是不存在的键位，反向钉见 composer-chips.test.ts 第二条。
      title: "打开 / 命令菜单（与直接按 / 键同一个入口）",
      active: false,
      slot: "left",
      icon: "sparkles",
      caret: true
    },
    workModeChip({ hasBook: input.hasBook, workMode: input.workMode }),
    {
      id: "permission",
      text: permission.text,
      disabled: permission.disabled,
      title: permission.title,
      // 档位没有「按下/未按下」两态，只有三档；aria-pressed 用它只会撒谎，故恒假。
      active: false,
      // #105：照 deepwrite，权限档是卡内右端「更多」那一摞的事；PermissionMenu 弹层真身跟着挂右端（见 ComposerBox）。
      slot: "right",
      icon: permission.icon,
      caret: true
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

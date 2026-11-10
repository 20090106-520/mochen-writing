import {
  DRAFT_SAMPLE_COUNTS,
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  THINKING_WIRE_FIELD,
  USER_TEXT_MAX_LEN,
  WEB_SEARCH_TOOL_NAME,
  WEB_READ_TOOL_NAME,
  WORK_MODE_LABELS,
  codePointLength,
  thinkingWireValueOf,
  type DraftSampleCount,
  type PermissionMode,
  type ThinkingLevel,
  type ThinkingWire,
  type WorkMode
} from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { permissionChipView } from "./permission-chip";
import { toolRoster } from "./tool-roster";

export type ComposerChipId =
  | "permission"
  | "work-mode"
  | "thinking"
  | "web-search"
  | "draft"
  | "tools"
  | "model"
  | "palette"
  | "auto-skills";

/**
 * chip 住在输入卡工具行的哪一区。
 * 分区是决策不是样式：它是这张决策表的字段，模板只按它过滤（铁律 6，模板里不许出现第二份顺序表）。
 *
 * 2026-11-08 用户裁定（参照 MiniMax Code 输入卡的分区逻辑）：
 * - `left`  = 首行左端常驻（思考等级 / 联网），这一轮怎么跑的两枚真开关；
 * - `right` = 首行右端常驻（模型 / 权限档），紧挨麦克风与发送键（2026-11-09 参考图②：
 *           模型名在发送键左侧，权限档是「能碰多大」的那道闸）；
 * - `more`  = 收进「更多」弹层（多稿 / 工具清单 / 命令面板 / 工作模式），低频但功能一个不丢。
 * 判据不是「谁短谁留在首行」，而是「这一轮最常改的留在卡面、其余进一层弹层」。
 * 折行（2026-10-22 的旧裁定）成本是右组整组掉到第二行、卡片高出一截；收进弹层后
 * 664（1440 窗口右栏展开）与 840（1600 三栏全开）都一行放得下。
 */
export type ComposerChipSlot = "left" | "right" | "more";

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
  /**
   * 带不带下拉三角。
   * 2026-11-09 用户裁定：「更多」弹层里四项一律是「展开下一层」的入口，全部为真；
   * 首行常驻的真开关（思考 / 联网）才没有第二层可展开。
   */
  caret: boolean;
}

export type ComposerChipEvent =
  | "open-permission-menu"
  | "toggle-work-mode"
  | "cycle-thinking"
  | "toggle-web-search"
  | "cycle-draft-sample"
  | "open-tool-roster"
  | "open-model-select"
  | "open-palette"
  | "open-auto-skills";

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
  draft: "cycle-draft-sample",
  tools: "open-tool-roster",
  model: "open-model-select",
  palette: "open-palette",
  // 这一枚常驻首行，ComposerBox 的 onChipClick 就地展开自己的卡片，不会真的 emit 这个事件；
  // 键留着只为 Record<ComposerChipId, …> 穷尽表不漏。入口本身有真身，不是死键。
  "auto-skills": "open-auto-skills"
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

/**
 * 无书时工作模式那一格的诚实文案（书级设置，没书就没有档）。
 * 刻意不借用 permission-chip 的 NO_BOOK_CHIP_LABEL：两枚 chip 同排右端，
 * 同一串文字并排出现像渲染事故（2026-10-14 真机截图实锤）。
 * 「未定」不是第三档——WORK_MODE_LABELS 只有两档，这里报的是控制名 + 状态，不是档位名。
 */
export const WORK_MODE_NO_BOOK_LABEL = "工作模式：未定";

function workModeChip(input: { hasBook: boolean; workMode: WorkMode }): ComposerChipView {
  if (!input.hasBook) {
    return {
      id: "work-mode",
      // 刻意**不**借用 permission-chip 的 NO_BOOK_CHIP_LABEL（2026-10-14 真机截图）：
      // 两枚 chip 同在卡上，同一串「未打开作品目录」并排出现，读起来像渲染事故。
      // 各自报各自的控制名，谁也不开口冒充档位名（与 permission-chip 同一口径）。
      text: WORK_MODE_NO_BOOK_LABEL,
      disabled: true,
      title: "还没打开作品目录，工作模式改不了（它是这本书的设置）。",
      active: false,
      // 低频开关：收进「更多」弹层（2026-11-08 首行常驻 + 更多弹层的分区裁定）。
      // 2026-11-09：禁用态也带三角——四项形态一致，点开后能看见「为什么改不了」。
      slot: "more",
      icon: "folder",
      caret: true
    };
  }
  const label = WORK_MODE_LABELS[input.workMode];
  return {
    id: "work-mode",
    text: label,
    disabled: false,
    title:
      input.workMode === "plan"
        ? `工作模式：${label}。这一轮它只讲打算、不动稿，提案批了也不落盘。点击展开两档选一（另一档「${WORK_MODE_LABELS.act}」）。`
        : `工作模式：${label}。提案经你批准就会写入磁盘。点击展开两档选一（另一档「${WORK_MODE_LABELS.plan}」）。`,
    // 真开关：计划档是「按下去生效」的两态，aria-pressed 用它才不撒谎。
    active: input.workMode === "plan",
    // 与权限档同属「能碰多大」那一摞；但它不是每轮都改 ⇒ 收进「更多」弹层。
    slot: "more",
    icon: WORK_MODE_CHIP_ICON[input.workMode],
    // 2026-11-09：点开同款二级列表再选，不再一下就切档。
    caret: true
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
  // 出站工具数与 NETWORK_TOOL_NAMES 同源：出网的两枚（web_search + web_read）一起进出。
  return {
    id: "web-search",
    text: "联网搜索",
    disabled: false,
    title: enabled
      ? `本轮已带联网工具（${WEB_SEARCH_TOOL_NAME} 与 ${WEB_READ_TOOL_NAME}，与五枚书稿工具一起出站：本地免费源，不额外要 key）。点击关闭。`
      : `本轮不带联网工具——${WEB_SEARCH_TOOL_NAME} 与 ${WEB_READ_TOOL_NAME} 真的从出站 tools 里摘掉了（工具清单也跟着少这两行），模型只能读你书稿里的字。点击开启。`,
    active: enabled,
    slot: "left",
    icon: "globe",
    caret: false
  };
}

/**
 * 多稿 chip（P0-②，2026-10-19）。
 *
 * 三档（关 / ×2 / ×3）的文案与 title 只在这一处判定，模板与 store 都只读结果（铁律 6）。
 * title 必须报出**真的发出去的那个字段名与值**：出站请求带的是 `sampleCount`，
 * 且档数与循环次序都从 contracts 的 `DRAFT_SAMPLE_COUNTS` 现拼——手抄一份「关 → ×2 → ×3」，
 * 将来契约加一档就会留下一句说谎的提示。
 * doc 还欠着一句实话：开着的时候 token 成本是单稿的 N 倍，这是用户按下去之前就该知道的代价。
 * `active` 取「> 1」：关是常态，按下态只在真的要多跑生成时亮。
 */
function draftChip(sampleCount: DraftSampleCount): ComposerChipView {
  const label = (count: DraftSampleCount): string => (count === 1 ? "多稿关" : `多稿 ×${count}`);
  const cycle = `${DRAFT_SAMPLE_COUNTS.map((count) => (count === 1 ? "关" : `×${count}`)).join(" → ")} → 关`;
  return {
    id: "draft",
    text: label(sampleCount),
    disabled: false,
    title:
      sampleCount === 1
        ? `本轮出站请求带 sampleCount=1：一轮只跑一次生成，与不开这枚开关时一字不差。点击展开档位列表（${cycle}）。`
        : `本轮出站请求带 sampleCount=${sampleCount}：一轮里静默跑 ${sampleCount} 次生成，再把这几稿一起摆给你挑一稿落盘，token 成本是单稿的 ${sampleCount} 倍。点击展开档位列表（${cycle}）。`,
    active: sampleCount > 1,
    slot: "more",
    icon: "copy",
    // 2026-11-09：不再按一下就切档，先展开同款二级列表再选。
    caret: true
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
      "还没有 API 地址，provider:list-models 此刻拉不到名单。先在模型设置里填好地址（或手填模型名）。";
  } else if (modelLabel === "") {
    title = `还没读出当前模型名。点开可切换模型；名单从 ${endpoint} 拉（走 provider:list-models 通道）。也可在模型设置里手填。`;
  } else {
    title = `当前模型 ${modelLabel}。点开可切换；名单从 ${endpoint} 拉（走 provider:list-models 通道）。改地址或密钥请到模型设置。`;
  }
  return {
    id: "model",
    text: modelLabel === "" ? "未配置模型" : modelLabel,
    disabled: false,
    title,
    active: false,
    // 2026-11-09 参考图②：模型名落在发送键左侧（右端），不再占左端首格。
    slot: "right",
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
  /** 多稿档（P0-②）：1 = 关；chip 的文案与 title 由它驱动（三档文案的判定只在本文件那一处）。 */
  sampleCount: DraftSampleCount;
  modelLabel: string;
  baseURL: string;
}): ComposerChipView[] {
  // 权限 chip 只调 permissionChipView 一次，不重算（设计决定 4）。
  const permission = permissionChipView(input);
  // 清单跟着联网开关走：关掉那一轮 `web_search` 不出站，枚数也就从 6 变 5（不是手抄的两份数）。
  const roster = toolRoster(input.webSearchEnabled);
  // 数组序 = 渲染序（#112 / 2026-11-09 参考图②）：首行左端思考等级 → 联网；
  // 首行右端模型 → 权限档（模型贴麦克风与发送键，权限档是它们前面那道闸）；
  // 「更多」弹层里多稿 → 工具清单 → / 命令 → 工作模式。
  // 2026-11-08：后四枚不再平铺，收进「更多」弹层——分区判据见 ComposerChipSlot 的注释。
  return [
    modelChip({ modelLabel: input.modelLabel, baseURL: input.baseURL }),
    thinkingChip(input.thinkingLevel, input.thinkingWire),
    webSearchChip(input.webSearchEnabled),
    draftChip(input.sampleCount),
    {
      id: "tools",
      text: "工具",
      disabled: false,
      // 枚数从清单本身数出来，不手抄「5」：contracts 加工具时这条提示跟着变，不会指着一份不存在的名单。
      title: `展开这一轮带的 ${roster.length} 枚工具：点一行即可摘下或带回（工具仍由模型自己挑）`,
      active: false,
      slot: "more",
      icon: "list",
      caret: true
    },
    {
      id: "palette",
      text: "/ 命令",
      disabled: false,
      // T9-1：实测 hotkeys.ts 的全局 Ctrl 族没有 k，键位真身是裸 / 键；
      // 旧文案宣传的「Ctrl+K 同一个入口」是不存在的键位，反向钉见 composer-chips.test.ts 第二条。
      title: "展开命令列表：选中即执行，与直接按 / 键是同一批命令",
      active: false,
      slot: "more",
      icon: "sparkles",
      caret: true
    },
    {
      id: "auto-skills",
      text: "技能",
      disabled: false,
      // 2026-11-10 用户裁定后这张卡是**整库**：不只能看自动挑的，也能自己挂/取。
      // 文案从「自动技能」改成「技能」——挂着名字写「自动」，用户会以为只能看不能选。
      title: "这一轮用哪几枚技能：整库可选，自动挑的会标出来；点开就能挂上或取下",
      // 按下态不摆在这里：开关与这一轮挂了什么都在二级卡片里，卡面这行只是个入口。
      active: false,
      // 2026-11-10 用户裁定「不要在里面」：这一枚不进「更多」弹层，常驻输入卡首行左端。
      // 点它直接展开自己的那张卡片，不先经过「更多」的四行首层。
      slot: "left",
      icon: "wand",
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
      // #105：照 deepwrite，权限档是卡内右端「更多 + 发送」那一摞的事；PermissionMenu 弹层真身跟着挂右端（见 ComposerBox）。
      // 2026-11-08：它不进「更多」弹层——这是「模型能动你的稿子到什么程度」的安全阀，必须常驻可见。
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

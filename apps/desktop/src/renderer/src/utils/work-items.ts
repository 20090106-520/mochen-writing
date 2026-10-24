import { UNBOUND, type SessionListItem } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import type { ProposalView } from "./agent-thread";
import type { ForeshadowRow } from "./foreshadow";
import { formatHistoryTime } from "./history-time";
import { plantToneLabel } from "./foreshadow";
import type { SessionRowAction } from "./session-row-action";

/**
 * 作品工作项面板（2026-10-25 · §174）：**左栏常驻**的那一列。
 *
 * ## 为什么要做这个
 *
 * 用户原话：「可以做一个跟你这一样的工作面板，只不过上面显示的是小说的。」
 *
 * 「跟你一样」指的是 MiniMax Code 左栏那一列——**工作区下面那份常驻的会话列表**：
 * 每行一件东西、标题 + 副行 + 右格、点一行直达、当前项亮着。
 * 「上面显示的是小说的」是把那一条轴换成小说的东西。
 *
 * ## 为什么落在左栏（不是中栏、不是右栏）
 *
 * 三条都是这仓自己已经定过的：
 * ① **左栏是恒定的导航轴**（2026-10-07 用户裁定：「不是重新创建侧边栏还是有的」）——
 *    任何时候都不该消失，而 MiniMax Code 的会话列表也正在左栏。形态照它，内容换掉。
 * ② §168 用户评「小说大脑 / 故事规划都是空壳，没啥用」⇒ 这一族**不许再摆空壳**：
 *    面板上每一行都必须有**真数据**、点了**真有反应**。空组不出现。
 * ③ 左栏已经有「历史对话」浮层（中栏头部那枚），但它是**浮层**，而且只列对话。
 *    这一族补的是「常驻 + 小说的那一类」。
 *
 * ## 判据只有这一份（铁律 6）
 *
 * 分组表、行怎么组装、每行点什么，全住这里。组件只读它、只接线。
 * 会话行的标题与副行判据也收在这里——**中栏那个「历史对话」浮层也引同一份**，
 * 两处各写一遍文案，改一边忘了另一边，两块面板就会对不上。
 */

/** 工作项的三个分组。每一组内行与行**同类**，所以放在一起能横向比较（会话列表的精神）。 */
export type WorkItemGroupId = "sessions" | "pending" | "foreshadows";

/** 一行工作项点开之后要去哪。 */
export type WorkItemTarget =
  /** 打开一条会话（回放它）。 */
  | { kind: "session"; item: SessionListItem }
  /** 打开一篇文稿（跳到那一章）。 */
  | { kind: "doc"; relPath: string }
  /** 打开一条伏笔：有埋设章就跳到埋设章，没有就打开伏笔文稿本身。 */
  | { kind: "foreshadow"; relPath: string; plantedIn: string };

/** 一行工作项。 */
export interface WorkItemRow {
  /** 组内唯一（组件的 :key）。 */
  id: string;
  group: WorkItemGroupId;
  icon: IconName;
  /** 主行：一句话说清这是哪一件。 */
  title: string;
  /** 副行：它属于哪儿。 */
  detail: string;
  /** 右格：时间 / 状态。一行只给一种。 */
  meta: string;
  /** 悬停说明（`title` 属性）。禁用的行在这里说清为什么点不了。 */
  hint: string;
  /** 点不了就别点（禁用理由已写进 hint）。 */
  disabled: boolean;
  /** **正在看的那一条**：亮着，像参照面板里「当前项亮着」那样。 */
  current: boolean;
  target: WorkItemTarget;
}

/** 一个分组。 */
export interface WorkItemGroup {
  id: WorkItemGroupId;
  label: string;
  icon: IconName;
  rows: WorkItemRow[];
}

/** 分组表：叫什么、什么图标、什么顺序。 */
export const WORK_ITEM_GROUP_TABLE: {
  id: WorkItemGroupId;
  label: string;
  icon: IconName;
}[] = [
  { id: "sessions", label: "对话", icon: "history" },
  { id: "pending", label: "待审", icon: "edit" },
  { id: "foreshadows", label: "伏笔", icon: "pin" }
];

/** 面板自己的标题。 */
export const WORK_ITEMS_TITLE = "工作项";

/** 一条会话一句用户输入都没有时，主行摆什么。 */
export const SESSION_EMPTY_TITLE = "（这一条还没有用户输入）";

/** 会话没绑文稿时，副行摆什么（`unbound` 是跨进程契约里的哨兵值，不是给人看的字）。 */
export const SESSION_UNBOUND_LABEL = "未绑定文稿";

/** 伏笔没写埋设章时，副行摆什么（不拿别的字段顶替）。 */
export const FORESHADOW_NO_PLANT_LABEL = "没写埋设章";

/**
 * 会话行的副行：这条会话属于哪一篇文稿。
 *
 * @param docTitleOf 相对路径 → 文稿标题；查不到就回落到路径本身
 *   （**名字可以土，不能假**——编一个标题比显示路径更坏）。
 */
export function sessionDocLabel(
  item: SessionListItem,
  docTitleOf: (relPath: string) => string
): string {
  if (item.docRelPath === UNBOUND) return SESSION_UNBOUND_LABEL;
  return docTitleOf(item.docRelPath);
}

/** 会话行的主行。 */
export function sessionTitle(item: SessionListItem): string {
  return item.title === "" ? SESSION_EMPTY_TITLE : item.title;
}

/**
 * 会话行的悬停说明：这一条是**哪个模型**聊的。
 *
 * 右格那格已经给了时间，副行给了它属于哪一章——剩下还没说出口的就是模型。
 * 点不了的那几行不用这句（它们的理由是「为什么点不了」，更该先看见）。
 */
export function sessionHint(item: SessionListItem): string {
  return `模型：${item.model}`;
}

/** 主行最多几个字（超出截断并加省略号）。 */
const TITLE_MAX = 24;

/** 截一段话当主行：按**码点**截（中文一个字一个码点，按 UTF-16 截会切出半个字）。 */
function shorten(text: string, max: number): string {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max).join("")}…`;
}

/** 面板的输入：三类真数据 + 两个查表回调（判据不依赖 store，便于单测）。 */
export interface WorkItemInput {
  sessions: SessionListItem[];
  /** 会话行的可点性判定——**现成那一份**（utils/session-row-action.ts），面板不自己判。 */
  sessionActionOf: (item: SessionListItem) => SessionRowAction;
  proposals: ProposalView[];
  foreshadows: ForeshadowRow[];
  /** 相对路径 → 文稿标题；查不到就回落到路径本身。 */
  docTitleOf: (relPath: string) => string;
}

/** 对话组。 */
function sessionRows(input: WorkItemInput): WorkItemRow[] {
  return input.sessions.map((item) => {
    const action = input.sessionActionOf(item);
    // 三档分开：open = 能点；current = 正在看的那一条（亮着，不算「点不了」）；
    // disabled = 真点不了（没绑文稿 / 文稿没了 / 正在回复），理由现成那一份里有。
    const current = action.kind === "current";
    const disabled = action.kind === "disabled";
    return {
      id: `session:${item.sessionId}`,
      group: "sessions",
      icon: "history",
      title: sessionTitle(item),
      detail: sessionDocLabel(item, input.docTitleOf),
      meta: formatHistoryTime(item.startedAt),
      hint: action.kind === "open" ? sessionHint(item) : action.reason,
      disabled,
      current,
      target: { kind: "session", item }
    };
  });
}

/** 待审组：只列**还等着人点头**的改稿提案。 */
function pendingRows(input: WorkItemInput): WorkItemRow[] {
  return input.proposals
    .filter((view) => view.status === "pending")
    .map((view) => {
      const why = view.proposal.why.trim();
      return {
        id: `pending:${view.proposal.id}`,
        group: "pending",
        icon: "edit",
        title: why === "" ? "改稿提案" : shorten(why, TITLE_MAX),
        detail: input.docTitleOf(view.proposal.docRelPath),
        meta: formatHistoryTime(view.proposal.createdAt),
        hint: why === "" ? "这一条改稿提案还没有写理由。" : why,
        disabled: false,
        current: false,
        target: { kind: "doc", relPath: view.proposal.docRelPath }
      };
    });
}

/** 伏笔组：只列**还欠着**的，以及**要人看一眼**的（状态坏了 / 读不到原文）。 */
function foreshadowRows(input: WorkItemInput): WorkItemRow[] {
  return input.foreshadows
    .filter((row) => row.tone === "pending" || row.tone === "broken" || row.tone === "unknown")
    .map((row) => ({
      id: `foreshadow:${row.relPath}`,
      group: "foreshadows",
      icon: "pin",
      title: row.title,
      detail: row.plantedIn === "" ? FORESHADOW_NO_PLANT_LABEL : input.docTitleOf(row.plantedIn),
      meta: row.statusLabel,
      hint: plantToneLabel(row.tone),
      disabled: false,
      current: false,
      target: { kind: "foreshadow", relPath: row.relPath, plantedIn: row.plantedIn }
    }));
}

/**
 * 组装整个面板。
 *
 * **空组不出现**（§168 用户评「空壳没啥用」）：没有待审就不摆「待审」这一组，
 * 而不是摆一个写着「暂无」的组头。
 */
export function workItemGroups(input: WorkItemInput): WorkItemGroup[] {
  const rowsByGroup: Record<WorkItemGroupId, WorkItemRow[]> = {
    sessions: sessionRows(input),
    pending: pendingRows(input),
    foreshadows: foreshadowRows(input)
  };
  const out: WorkItemGroup[] = [];
  for (const spec of WORK_ITEM_GROUP_TABLE) {
    const rows = rowsByGroup[spec.id];
    if (rows.length === 0) continue;
    out.push({ id: spec.id, label: spec.label, icon: spec.icon, rows });
  }
  return out;
}

/** 面板上一共几件东西（组头那个数字）。 */
export function workItemCount(groups: WorkItemGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

/**
 * P1-3 占用条上的「会话历史」这一格：判据与文案的**唯一**落点（铁律 6）。
 *
 * 为什么单独成文而不并进 context-meter.ts：那份的契约是「只翻译主进程装配好的
 * 上下文包」，而历史这一路的数字来自 preview.history（agent-service 里
 * fitHistoryToWindow 的产物）。两边共用的是同一份事实，不是同一段代码——
 * 判据（何时出行、话怎么说）只许这里一处，ContextMeter 与 ContextMeterPanel 只挂线。
 *
 * 这里**不重算**任何阈值：预算、丢弃数都只有主进程那一份（UPSTREAM_WINDOW_TOKENS /
 * HISTORY_TOKEN_BUDGET 住在 packages/agent-runtime），渲染层只是把它显示出来。
 */
import type { ContextHistoryStat, ContextPreview } from "@mochen/contracts";
import { formatApproxTokens, type ContextMeterRow } from "./context-meter";

/** 行键固定为 history：同一时刻只会有一格历史，v-for 的键不会撞。 */
const HISTORY_ROW_KEY = "history";

/**
 * 把 preview.history 翻成展开面板的一行；不该出行时返回 null（判据全在这里，模板不判）。
 *
 * 为什么「entries 0 且没丢」不出行：真没历史还摆一行「会话历史 0 条」是噪音；
 * 但 **entries 0 而 dropped>0 必须出行**——「一条都没发出去」比截断一半更要让用户看见。
 * 为什么旧预览（无 history 字段）出行 null 而不是零行：字段是后加的可选件，
 * 旧历史回放路径拿不到它，宁可缺一格也不许编一份假的占用（零 jsdom 下 null 即「未知」）。
 */
export function historyMeterRow(preview: ContextPreview | null): ContextMeterRow | null {
  const h = preview?.history;
  if (h === undefined) return null;
  if (h.entries === 0 && (h.droppedCount ?? 0) === 0) return null;
  return {
    key: HISTORY_ROW_KEY,
    label: "会话历史",
    title: historyRowTitle(h),
    chars: h.chars,
    // 字数栏同时给条数：用户扫一眼知道「这一格是打包的历史」，不是单篇文档。
    charsLabel: `${h.entries} 条 · ${h.chars} 字`,
    active: false
  };
}

/** 行内悬浮说明：kept 的占用 + （若有）被切掉的条数与字数。 */
function historyRowTitle(h: ContextHistoryStat): string {
  const kept =
    `这一轮实际发送 ${h.entries} 条历史、${h.chars} 字` +
    `（约 ${formatApproxTokens(h.approxTokens)} tokens）`;
  const dropped = historyNoticeTextOfStat(h);
  return dropped === "" ? `${kept}；更早的全部带上` : `${kept}；${dropped}`;
}

/** 那句人话本体：只有主进程报了丢弃数才开口，缺省视作 0（旧回包兼容）。 */
function historyNoticeTextOfStat(h: ContextHistoryStat): string {
  const dropped = h.droppedCount ?? 0;
  if (dropped <= 0) return "";
  return `更早的 ${dropped} 条没有发给模型（约 ${h.droppedChars ?? 0} 字）。`;
}

/**
 * 面板底部的截断提示；空串＝不显形。
 * 与 startTurn 走 emitOnly 的那条 error 事件同一口径、同一句话——
 * 两处说的是同一件事（本轮丢了什么），数字却各自来自同一次 fitHistoryToWindow。
 */
export function historyNoticeText(preview: ContextPreview | null): string {
  if (preview?.history === undefined) return "";
  return historyNoticeTextOfStat(preview.history);
}

/**
 * 把历史行拼到装配条目之后：**历史垫底**，因为占用条的阅读顺序是
 * 「这轮装了什么 → 顺带带了多久的历史」；无历史行时原样返回。
 * 返回新数组，不原地变异传入的 rows（调用方可能把它当 computed 缓存）。
 */
export function appendHistoryRow(
  rows: readonly ContextMeterRow[],
  preview: ContextPreview | null
): ContextMeterRow[] {
  const row = historyMeterRow(preview);
  if (row === null) return [...rows];
  return [...rows, row];
}

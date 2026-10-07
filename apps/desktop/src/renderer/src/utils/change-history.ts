import type { ChangeEntry } from "@mochen/contracts";

/**
 * 改稿历史的文案层（2026-10-05）。
 *
 * 住 `.ts` 的理由与 `right-pane-labels.ts` 同款：本仓 verify 跑裸 `tsc`，`.vue` 的 `<script setup>`
 * 整体不进类型程序也没有运行时覆盖 ⇒ 文案写在 `.vue` 里改名能全绿通过。这里被 vitest 钉死。
 *
 * 时间戳目录名是 `writeDocFile` 用 ISO 串把 `:` 与 `.` 换成 `-` 得到的，
 * 形如 `2026-10-05T12-34-31-168Z`：**定长且字典序即时序**（年份到毫秒逐位可比），
 * 所以排序不需要真去 `Date.parse`，也别在这里造第二份解析。
 */

/** `2026-10-05T12-34-31-168Z` → `10-05 12:34:31`；形状不对就原样还回去，不替它编一个时间。 */
export function changeTimeLabel(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-\d{3}Z$/.exec(stamp);
  if (m === null) return stamp;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

/** 列表行/详情头那句话：谁的哪一次、留了多大一份。 */
export function changeHeadline(entry: ChangeEntry): string {
  return `${entry.docRelPath} · ${changeTimeLabel(entry.stamp)} 的改前版本（${formatBytes(entry.bytes)}）`;
}

/** 体积给人一个「整章重写 / 只改一句」的直觉；不足 1 KB 就不写单位。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "空文件";
  if (bytes < 1024) return `${bytes} 字节`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * 头部那个计数：列表是滚动区，滚出视野的那几条全靠它交代。
 * 条数是非负整数才说得清，所以先夹住再数——负数与小数不许摆到界面上。
 */
export function changeCountLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "还没有记录";
  return `${Math.floor(count)} 次改动`;
}

/**
 * 浮层一次最多列这么多条（2026-10-05 批次 3）。
 *
 * **这是显示上限，不是保留策略。** `.mochen/changes` 下的备份是回滚的最后一道保险，
 * 删它不可逆——用户没点头之前谁也不许替他删（那属于"要不要丢数据"的产品决定，不是界面问题）。
 * 真正要解决的是另一件事：几百条全列出来，浮层会变成一堵墙，翻不到底也找不着人。
 * 所以只截**列**，不截**存**，并且把折叠掉多少、东西还在哪儿，明明白白写在浮层里。
 */
export const CHANGE_HISTORY_VISIBLE = 60;

export interface ChangeListView {
  /** 这次真要摆到浮层里的行：最新在前（主进程排好的序，这里不重排）。 */
  rows: ChangeEntry[];
  /** 总条数——头部计数报它，不是 rows.length，否则计数在数字上是在说谎。 */
  total: number;
  /** 折叠掉多少条。全在范围内时是 0。 */
  hidden: number;
  /** 折叠说明；没折叠时是 null，浮层不渲染。 */
  notice: string | null;
}

export function changeListView(list: readonly ChangeEntry[]): ChangeListView {
  // 主进程给的是数组，但 IPC 边界上的东西一律按「可能不是」处理：这里炸了，
  // 整个浮层连带应用就白屏，而代价只是少列几行。
  const all: readonly ChangeEntry[] = Array.isArray(list) ? list : [];
  const total = all.length;
  if (total <= CHANGE_HISTORY_VISIBLE) {
    return { rows: all.slice(), total, hidden: 0, notice: null };
  }
  const hidden = total - CHANGE_HISTORY_VISIBLE;
  return {
    rows: all.slice(0, CHANGE_HISTORY_VISIBLE),
    total,
    hidden,
    notice: `更早的 ${hidden} 条没删，还躺在 .mochen/changes 里；这里只列最近 ${CHANGE_HISTORY_VISIBLE} 条。`
  };
}

/**
 * 保留上限的告知文案**已经不在这里**（2026-10-06 批次 5-⑧ 撤掉）。
 *
 * 它原来是一句写死「50 份 / 32 MB」的死文案，靠一条接线守卫逼着人改两处数字。
 * 批次 5-⑧ 把上限做成了设置页可调之后，这个办法就**不能用了**：用户把上限调成 10 份，
 * 面板仍然会说「只留最近 50 份」——一句会自己变假的告知，比没有更坏。
 *
 * 现在这句话由 `contracts/change-retention.ts` 的 `changeRetentionNote(retention)` 生成，
 * 传进去的是**当前真实生效的那份上限**（面板从 `useChangeRetentionStore` 取，
 * 走 `changes:retention-get` 从主进程读，与写盘那侧读的是同一份）。
 * 文案只有这一处生成，「面板说的」与「主进程做的」不再靠人记得同步。
 */

import type { ChangeDiffResult, ChangeEntry, DocWriteResult } from "@mochen/contracts";
import { countDiffMarks } from "./diff-lines";
import { failureReasonOf } from "./draft-flush";

/**
 * 改稿历史的判定、文案与「读一条备份」的编排（2026-10-05，逐行对比一档 2026-10-13 加进来）。
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

/**
 * 逐行对比（2026-10-13）。
 *
 * 面板原先只把「改前的整篇」甩出来：几千行的章节改一句，用户也得从头看到尾，
 * 而「这一次到底动了哪几行」正是决定要不要回滚的那个问题。
 * diff 文本由主进程算（`changes:diff` → agent-runtime 的 `unifiedDiff`，与提案卡同一份真身），
 * 渲染层这边只管把三种情况说清楚、以及把两扇 IO 缝编排好。
 */

/** peek 一条件用到的两扇 IPC：读改前那份、让主进程算它与盘上此刻的逐行差别。 */
export interface ChangePeekIo {
  readChange(backupRelPath: string): Promise<{ content: string; fingerprint: string }>;
  diffChange(backupRelPath: string, docRelPath: string): Promise<ChangeDiffResult>;
}

export interface ChangePeekPreview {
  /** 改前的整篇正文（展开看全文时才摆）。 */
  content: string;
  /**
   * 逐行对比文本。三档不能压成一档：
   * `null` = 没算出来（界面上得有那句话点名为什么），`""` = 算出来了且逐行相同，非空 = 有差别。
   */
  diff: string | null;
}

export interface ChangePeekResult {
  /** 备份正文没读回来时是 null，浮层继续说「点上面那一条看改前的内容」。 */
  preview: ChangePeekPreview | null;
  /** 要上屏的一句话；一切正常时 null（null ≠ 「没有失败」，而是「不需要额外说一句」）。 */
  notice: string | null;
}

/**
 * 读一条备份 + 算它与盘上此刻的对比，编排成一条链。
 *
 * 两条规矩都是为了让失败可见而又不牵连成功的那半：
 * ① 备份读不出来就**不再发第二扇**——正文都没有，拿什么去比，多发一次 IPC 只是多一次抖动；
 * ② 对比那一侧无论回 `ok:false` 还是直接抛，都只当「没算出来」：正文照样交回去，
 *    异常不许冒出去（冒出去调用方的在途标记就卡住了，面板从此点点不动）。
 */
export async function readChangePeek(
  io: ChangePeekIo,
  entry: ChangeEntry
): Promise<ChangePeekResult> {
  let content: string;
  try {
    content = (await io.readChange(entry.backupRelPath)).content;
  } catch (err) {
    return { preview: null, notice: `这条备份读不出来：${failureReasonOf(err)}` };
  }
  try {
    const result = await io.diffChange(entry.backupRelPath, entry.docRelPath);
    if (!result.ok) {
      return {
        preview: { content, diff: null },
        notice: `逐行对比没算出来：${result.message}`
      };
    }
    return { preview: { content, diff: result.diff }, notice: null };
  } catch (err) {
    return {
      preview: { content, diff: null },
      notice: `逐行对比没算出来：${failureReasonOf(err)}`
    };
  }
}

/**
 * diff 上方那句话：把「比的是哪两份」与「± 各是什么意思」说死，再报数出来的行数。
 *
 * 方向固定 `改前 → 盘上此刻`，与提案卡那套（`原文 → 新稿`）同一读法，颜色只有一套含义。
 * 这句话不许写成「本次改动」：中间如果又保存过几次，盘上这份是这几次**攒起来**的差别，
 * 说「本次」就是在骗人（面板顶部那句保留说明讲的也是同一件事）。
 */
export function changeDiffCaption(diff: string | null): string | null {
  if (diff === null) return null;
  if (diff === "") return "逐行对比：这一份与盘上此刻的正文一个字都没差——回滚它不会有任何变化。";
  const { added, removed } = countDiffMarks(diff);
  return `逐行对比（改前 → 盘上此刻）：新增 ${added} 行、删除 ${removed} 行。＋ 是现在才有的行，－ 是现在已经没有的行。`;
}

/**
 * 回滚一条件用到的两扇 IPC：先现读盘上此刻的那一篇（拿它的指纹），再把备份落回去。
 * 只许现读现传——指纹传旧了，主进程那道「这之后还有人改过没有」的闸就白设了。
 */
export interface ChangeRestoreIo {
  readDoc(relPath: string): Promise<{ fingerprint: string }>;
  restoreChange(backupRelPath: string, expectedFingerprint: string): Promise<DocWriteResult>;
}

export interface ChangeRestoreResult {
  /** 盘上真变了才重拉列表。守卫挡下、被闸拒绝、抛错三种都没变，不该多拉一次。 */
  refresh: boolean;
  /** 上屏的那句话，三档全在这儿，调用方只管摆。 */
  notice: string;
}

/**
 * 回滚的编排（2026-10-13 从 store 搬进来：store 只摆状态，判定与 IO 编排住 utils，
 * 与 `readChangePeek`、`doc-read`、`draft-flush` 同一套路；这一搬也让那句「已回滚」的
 * 顺序规矩有了一份能被 vitest 钉死的落点）。
 *
 * 守卫在前：**没打开那一篇就一个字都不动**——回滚的是正文，右栏还摆着别的内容时
 * 把它换掉，用户看不见自己刚刚失去了什么。这里连一次 IPC 都不发。
 */
export async function restoreBackupToDoc(
  io: ChangeRestoreIo,
  entry: ChangeEntry,
  activeDocTab: string | null
): Promise<ChangeRestoreResult> {
  const untouched = (notice: string): ChangeRestoreResult => ({ refresh: false, notice });
  if (activeDocTab === null) {
    return untouched("先打开那一篇正文，才能把它回滚回去。");
  }
  try {
    const current = await io.readDoc(entry.docRelPath);
    const result = await io.restoreChange(entry.backupRelPath, current.fingerprint);
    if (!result.ok) {
      return untouched(
        result.reason === "stale"
          ? "这一篇在这之后又被改过了，已经不是当时那份了——先看看现在的内容再决定。"
          : (result.message ?? "没能回滚。")
      );
    }
    return { refresh: true, notice: `已回滚 ${entry.docRelPath} 到改前的样子。` };
  } catch (err) {
    return untouched(`没能回滚：${failureReasonOf(err)}`);
  }
}

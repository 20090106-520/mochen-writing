/**
 * 改稿历史那五条动作（2026-10-21 从 useBookStore 拆出：那份文件贴到 800 行预算）。
 *
 * 为什么这条边界成立：它们是同一个功能面（列 / 开面板 / 收面板 / 看改前 / 回滚），
 * 全部只读写 store 上那五格 `change*` 字段与 `notice`，彼此在文件里是连续一段；
 * 与书稿树、草稿、标签那些状态没有交集。这里不留状态——宿主以第一参递进来，
 * 拿到的就是 store 那份响应式真身（写法同 `utils/change-history` 的编排型函数）。
 */
import type { ChangeEntry } from "@mochen/contracts";
import {
  readChangePeek,
  restoreBackupToDoc,
  type ChangePeekIo,
  type ChangeRestoreIo
} from "../utils/change-history";
import { failureReasonOf } from "../utils/draft-flush";

/** 面板上预览的那一条：改前整篇 + 与盘上此刻的逐行差别（差不出来说明原因，diff 为 null）。 */
export type ChangePreview = { backupRelPath: string; content: string; diff: string | null };

/** 宿主（useBookStore）里被这五条动作读写的那几格：结构对得上就行，不另造第二份视图。 */
export interface ChangeHistoryHost {
  changesBusy: boolean;
  changeList: ChangeEntry[];
  changeHistoryOpen: boolean;
  changeHistory: ChangeEntry | null;
  changePreview: ChangePreview | null;
  notice: string;
  activeDocTab: string | null;
  reloadActive(): Promise<void>;
  loadChanges(): Promise<void>;
}

/** peek 一条改稿历史要用的两扇 IPC，模块级、不捕 `this`（编排的规矩全在 utils/change-history）。 */
const changePeekIpc: ChangePeekIo = {
  readChange: (backupRelPath) => window.mochen.readChange(backupRelPath),
  diffChange: (backupRelPath, docRelPath) => window.mochen.diffChange(backupRelPath, docRelPath)
};

/** 回滚一条件要用的两扇 IPC，同样模块级、不捕 `this`（编排规矩在 `restoreBackupToDoc`）。 */
const changeRestoreIpc: ChangeRestoreIo = {
  readDoc: (relPath) => window.mochen.readDoc(relPath),
  restoreChange: (backupRelPath, expectedFingerprint) =>
    window.mochen.restoreChange(backupRelPath, expectedFingerprint)
};

/**
 * 改稿历史（2026-10-05）：`docWrite` 每次覆盖前都存了改前备份并把句柄传回来，此前全仓没有一处读得回它——
 * 这里补上这条回程，即「AI 改坏了怎么办」的答案。三条动作都走 store 而不让组件直接摸 `window.mochen`：
 * 面板要同时管列表、预览与在途标记，散在组件里就散成三份状态。
 */
export async function loadChanges(host: ChangeHistoryHost): Promise<void> {
  host.changesBusy = true;
  try {
    host.changeList = await window.mochen.listChanges();
  } catch (err) {
    host.notice = `改稿历史没读回来：${failureReasonOf(err)}`;
    host.changeList = [];
  } finally {
    host.changesBusy = false;
  }
}

/** 打开面板并拉一次列表。没开书时列表是空表（主进程那边给的就是空表，不是错）。 */
export async function openChangeHistory(host: ChangeHistoryHost): Promise<void> {
  host.changeHistoryOpen = true;
  await host.loadChanges();
}

export function closeChangeHistory(host: ChangeHistoryHost): void {
  host.changeHistoryOpen = false;
  host.changeHistory = null;
  host.changePreview = null;
}

/** 点开一条：改前那份正文读回来，同时让主进程算出它与盘上此刻的逐行差别；回滚与否由人定。 */
export async function peekChange(host: ChangeHistoryHost, entry: ChangeEntry): Promise<void> {
  host.changesBusy = true;
  host.changeHistory = entry;
  host.changePreview = null;
  const peek = await readChangePeek(changePeekIpc, entry);
  // 在途标记先落地再挑结果：中途换了选中那条时下面直接 return，标记留在 true 面板就点点不动了。
  host.changesBusy = false;
  // 失败那句**先**落地：备份整个读不到时 preview 是 null，靠下面那行 return 拦不住话——
  // 那时 notice 是用户唯一看得见的东西（2026-10-13 就把这一句写在 return 之后，红灯当场逮到）。
  if (peek.notice) host.notice = peek.notice;
  // 读到的是别的一条（面板期间盘上变了）就丢掉，别把错的内容摆给人看。
  if (!peek.preview || host.changeHistory?.backupRelPath !== entry.backupRelPath) return;
  host.changePreview = { backupRelPath: entry.backupRelPath, ...peek.preview };
}

/** 回滚一条备份：守卫、现读现传的指纹、三档文案全在 `restoreBackupToDoc`，这里只摆状态。 */
export async function restoreChange(host: ChangeHistoryHost, entry: ChangeEntry): Promise<void> {
  host.changesBusy = true;
  const outcome = await restoreBackupToDoc(changeRestoreIpc, entry, host.activeDocTab);
  // 在途标记先落地再刷列表：refresh 那两步各自还会写 notice，标记挂着不许拦用户点第二下。
  host.changesBusy = false;
  if (outcome.refresh) {
    // 当前正文可能正是被回滚的那一篇：现读回来刷新右栏，别让屏幕停在旧内容上。
    // 比的是**此刻**的标签（进来以后用户可能已经切走了），不是编排里那份快照。
    if (host.activeDocTab === entry.docRelPath) await host.reloadActive();
    await host.loadChanges();
  }
  // 提示写在最后——reloadActive 自己也会写 notice（「已重载盘上内容」），
  // 顺序颠倒的话用户从头到尾看不见「已回滚」这三个字（2026-10-05 真机逮到）。
  host.notice = outcome.notice;
}

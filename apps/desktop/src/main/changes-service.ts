import {
  IPC_CHANNELS,
  type ChangeDiffResult,
  type ChangeEntry,
  type ChangePruneReport,
  type ChangeRetention,
  type ChangeRetentionSnapshot,
  type DocWriteResult
} from "@mochen/contracts";
import {
  listChanges,
  pruneAllChanges,
  readChange,
  readDocFile,
  restoreChange
} from "@mochen/fs-store";
// 逐行 diff 的真身只有这一份（它住在只在主进程跑的 agent-runtime 里，见文件头那段）。
import { unifiedDiff } from "@mochen/agent-runtime";
import type { ChangeRetentionStore } from "./change-retention-store.js";
// 来源闸 + 参数形状闸的唯一出处（P1-7）：注册通道只许走 handleTrusted。
import { handleTrusted } from "./ipc-guard.js";

/** electron 的 ipcMain.handle 的窄形状（与 skill-service 同款）：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 改稿历史的主进程真身（2026-10-05）：列、读一条、把一条与现在逐行比一比、把一篇文稿回滚到某条备份。
 *
 * 存在的理由很直白——`docWrite` 每次覆盖正文前都把改前内容存成 `.mochen/changes/…bak`，
 * 并把句柄挂上 `DocWriteResult.backupRelPath` 一路传回渲染层，**但从头到尾没有任何一处读得回它**。
 * 于是「AI 动手改了稿，改坏了怎么办」在产品里没有答案，备份只是一堆躺在盘上的死文件。
 *
 * 路径安全全部下沉在 `fs-store/changes.ts`：形状、备份 realpath、目标文稿 realpath 三道守卫
 * 都在那边，这里不重复判断（铁律 6）。这一层只做两件事：补上「没开书」的语义、把错误收成中文。
 *
 * 保留上限三枚（2026-10-06 批次 5-⑧）也归这里，因为「立即清理」要盘上的当前书——
 * 与它同一片领域的一条通道散在两个注册函数里，下次加通道的人很容易只看见一个。
 */
export interface ChangesService {
  list(): Promise<ChangeEntry[]>;
  read(backupRelPath: string): Promise<{ content: string; fingerprint: string }>;
  /**
   * 一条备份与**盘上此刻**那一篇的逐行对比（unified diff 文本）。
   * `ok:true` 且 `diff === ""` 是「逐行相同」这种成功；算不出来才回 `ok:false` 并带上点名的一句话。
   */
  diff(backupRelPath: string, docRelPath: string): Promise<ChangeDiffResult>;
  restore(
    backupRelPath: string,
    expectedFingerprint: string
  ): Promise<DocWriteResult & { restoredFrom: string }>;
  retentionGet(): Promise<ChangeRetentionSnapshot>;
  /** 回真正落盘的那一份（夹过的就是夹过的），界面显示的就是盘上的。 */
  retentionSave(retention: ChangeRetention): Promise<ChangeRetention>;
  /** 按**当前上限**清理这一本；上限从 store 现取，不吃调用方递来的值。 */
  pruneNow(): Promise<ChangePruneReport>;
}

export function createChangesService(deps: {
  bookRoot(): string | null;
  retention: ChangeRetentionStore;
}): ChangesService {
  /** 没打开作品目录时的统一说法：三枚动作都在这里收口，不各写一遍。 */
  function rootOrThrow(): string {
    const root = deps.bookRoot();
    if (root === null) throw new Error("还没打开作品目录，读不到这本书的改稿历史。");
    return root;
  }

  return {
    // 没开书给空表而不是抛：这一条是给「历史面板刚打开、书还没选」那一阵用的，
    // 抛出去会让面板变成一个红色错误条，而那一刻本来就没有任何历史可说。
    list: () => {
      const root = deps.bookRoot();
      return root === null ? Promise.resolve([]) : listChanges(root);
    },
    read: async (backupRelPath) => readChange(rootOrThrow(), backupRelPath),
    /**
     * 逐行对比。两扇读的失败**分两档**处理，不是随手一抄：
     * ① 备份读不到 ⇒ 让它抛。备份是面板刚刚列出来、用户刚刚点下去的那一条，它不在说明盘上出事了，
     *    这一档与 `read` 同一口径（渲染层那条链本来就按抛错收口）。
     * ② 文稿读不到 ⇒ 回 `ok:false` 并点名是哪一篇。**这是预期内的情形**：章节会被删、会被改名，
     *    而「改稿历史里躺着一条已经没有正文的记录」是完全正常的状态，不该炸成红色错误条。
     *
     * diff 算法只有 `packages/agent-runtime/src/diff.ts` 那一份：渲染层禁 import 它
     * （判据见 `contracts/ipc.ts` 的 `proposalDiff`），所以算在这里、渲染层只染颜色。
     */
    diff: async (backupRelPath, docRelPath) => {
      const root = rootOrThrow();
      const before = await readChange(root, backupRelPath);
      let after: { content: string };
      try {
        after = await readDocFile(root, docRelPath);
      } catch (err) {
        return {
          ok: false,
          message:
            (err as NodeJS.ErrnoException).code === "ENOENT"
              ? `盘上已经没有这一篇：${docRelPath}`
              : `读不到这一篇（${docRelPath}）：${(err as Error).message}`
        };
      }
      // 方向固定「改前 → 现在」，与提案卡那套同一读法：+ 是现在才有的行，- 是现在已经没有的行。
      return { ok: true, diff: unifiedDiff(before.content, after.content, docRelPath) };
    },
    // 回滚也会先给当前内容再存一份，所以回滚这条路**也要**按同一上限收口，
    // 否则「回滚攒出一堆回滚」能从上限外侧绕过去（5-⑦ 真机量出来的空壳就是这么来的）。
    restore: async (backupRelPath, expectedFingerprint) =>
      restoreChange(
        rootOrThrow(),
        backupRelPath,
        expectedFingerprint,
        (await deps.retention.read()).retention
      ),
    retentionGet: () => deps.retention.read(),
    retentionSave: (retention) => deps.retention.save(retention),
    // 这里给的是「当前这一本」的改稿历史，所以没开书时必须说清而不是回一个空报告：
    // 回 `{removed:0}` 会被界面显示成「已清理，删掉 0 条」，用户以为刚才是白按了一次。
    pruneNow: async () => {
      const root = deps.bookRoot();
      if (root === null) {
        throw new Error("还没打开作品目录，没有可清理的改稿历史。");
      }
      return pruneAllChanges(root, (await deps.retention.read()).retention);
    }
  };
}

/**
 * 只注册白名单里的七条通道：列、读、比、回滚，以及保留上限的读 / 写 / 立即清理。
 * 回滚那条带指纹闸，闸在 fs-store 那边；立即清理走的是与自动淘汰**同一份** `pruneChanges`，
 * 另开一条清理逻辑就等于有两份「该删哪些」的判定。
 */
export function registerChangesIpc(handle: Handler, changes: ChangesService): void {
  handleTrusted(handle, IPC_CHANNELS.changesList, () => changes.list());
  handleTrusted(handle, IPC_CHANNELS.changesRead, (_event, backupRelPath) =>
    changes.read(backupRelPath as string)
  );
  handleTrusted(handle, IPC_CHANNELS.changesDiff, (_event, backupRelPath, docRelPath) =>
    changes.diff(backupRelPath as string, docRelPath as string)
  );
  handleTrusted(handle, IPC_CHANNELS.changesRestore, (_event, backupRelPath, expectedFingerprint) =>
    changes.restore(backupRelPath as string, expectedFingerprint as string)
  );
  handleTrusted(handle, IPC_CHANNELS.changesRetentionGet, () => changes.retentionGet());
  handleTrusted(handle, IPC_CHANNELS.changesRetentionSave, (_event, retention) =>
    changes.retentionSave(retention as ChangeRetention)
  );
  handleTrusted(handle, IPC_CHANNELS.changesPruneNow, () => changes.pruneNow());
}

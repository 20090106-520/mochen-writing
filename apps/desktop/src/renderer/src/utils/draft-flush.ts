import type { DocWriteResult } from "@mochen/contracts";

/**
 * 「这一篇还有没落盘的字吗」——丢弃一份稿子之前必须先问的**那一句**
 * （2026-10-09 全仓扫描 P0-3 关标签 / P0-2 保存失败 / P0-6 退出兜底）。
 *
 * **为什么单独一处**：丢字的三条路（关标签、切到浏览/资料格、退出应用）以前各走各的，
 * 结果是「丢弃之前先落盘」这条判定被写了**零遍**——`closeTab` 直接 `delete draftsByPath[relPath]`，
 * 全程不看 `dirty`。三条路共用下面这一个函数，将来第四路（比如「全部关闭」）也只能走它。
 *
 * **为什么写成注入 fs 的纯函数**：本体要防的失败是「某一次写盘被拦下 / 抛错」，
 * 这在真文件系统上复现不了；而 store 那一层要钉的是另一件事（判定结果有没有真的变成
 * saving / notice / 标签的落点）。判定与接线分开，两边都能各测各的。
 */
/** 一篇稿子在渲染层的样子（与 store 里的 `draftsByPath` 值同构，那份就住在这里）。 */
export interface DocState {
  draft: string;
  savedFingerprint: string;
  dirty: boolean;
  conflict: { currentFingerprint: string } | null;
}

/** 没有打开任何文稿时的那一格。 */
export const EMPTY_DOC: DocState = {
  draft: "",
  savedFingerprint: "",
  dirty: false,
  conflict: null
};

export interface FlushIO {
  /** 这一篇当前在渲染层的那份稿子：活动标签给 live 状态，其它给存档；没待过给 null。 */
  stateOf(relPath: string): DocState | null;
  /** 落盘：真身就是 `window.mochen.writeDoc`，用例里换成可编程的假身。 */
  write(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  /** 只有**确实写成了**才被调用：把这一篇标干净并推进指纹。 */
  markClean(relPath: string, fingerprint: string): void;
}

export type FlushOutcome =
  | { ok: true; flushed: boolean }
  | { ok: false; reason: "conflict" | "write-failed"; message: string };

/** 抛出来的东西不一定是 Error（字符串、undefined 都会遇到），理由必须还是人话。 */
export function failureReasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text === "" ? "未知错误" : text;
}

/** 这一篇有没有要落盘的字、有没有没处理完的冲突。 */
export function hasPendingDraft(state: DocState | null | undefined): boolean {
  // 冲突也算「未了结」：这时内存与盘上不是一回事，静默丢弃等于把别人的改动读没了。
  return state !== null && state !== undefined && (state.dirty || state.conflict !== null);
}

/**
 * 丢弃这一格之前把它的字落盘。返回 `ok: true` 才允许真的丢掉。
 *
 * `flushed` 只用于「有没有多发一次写盘」这一类记账；判定只看 `ok`。
 */
export async function flushDocBeforeDrop(io: FlushIO, relPath: string): Promise<FlushOutcome> {
  const state = io.stateOf(relPath);
  if (!hasPendingDraft(state)) return { ok: true, flushed: false };
  const pending = state as DocState;
  if (pending.conflict !== null) return conflictOutcome(relPath);
  let result: DocWriteResult;
  try {
    result = await io.write(relPath, pending.draft, pending.savedFingerprint);
  } catch (error) {
    // IPC 抛错（主进程那侧 IO 一路上抛）以前会一路撞到调用方：这里收住，理由照原样递到屏上。
    return {
      ok: false,
      reason: "write-failed",
      message: `「${relPath}」没能落盘：${failureReasonOf(error)}。这一格给你留着，一个字都没丢。`
    };
  }
  if (!result.ok) {
    // stale 这一支的返回里**没有** `message` 字段：照下面的拼法会得到「没能落盘：undefined」，
    // 而且它根本不是「写失败」——是盘上已经换了内容，这时要说的和预检冲突那一句是同一件事。
    if (result.reason === "stale") return conflictOutcome(relPath);
    return {
      ok: false,
      reason: "write-failed",
      message: `「${relPath}」没能落盘：${result.message}。这一格给你留着，一个字都没丢。`
    };
  }
  io.markClean(relPath, result.fingerprint);
  return { ok: true, flushed: true };
}

/** 「和盘上不是一回事」那一句：预检拿到的冲突与写盘被拒（stale）共用同一份说法（铁律 6）。 */
function conflictOutcome(relPath: string): FlushOutcome {
  return {
    ok: false,
    reason: "conflict",
    message: `「${relPath}」和盘上不一致（外部刚改过）。先处理冲突再关这一格——我不会替你覆盖别人的改动。`
  };
}

export type FlushAllResult =
  { ok: true } | { ok: false; blocked: { relPath: string; message: string }[] };

/**
 * 退出前的兜底：把列出来的每一篇都问一遍、脏的先落盘。
 *
 * **一篇失败绝不中断其余**：这正是「退出丢字」最坏的那一档——为了 A 写不下去就把 B 也丢了，
 * 等于把兜底做成了二次事故。失败的那些如实点名回报，由调用方（主进程对话框）说给人听。
 */
export async function flushAllBeforeQuit(io: FlushIO, relPaths: string[]): Promise<FlushAllResult> {
  const blocked: { relPath: string; message: string }[] = [];
  for (const relPath of relPaths) {
    const outcome = await flushDocBeforeDrop(io, relPath);
    if (!outcome.ok) blocked.push({ relPath, message: outcome.message });
  }
  return blocked.length === 0 ? { ok: true } : { ok: false, blocked };
}

/**
 * store 里判定要读的那六格（`useBookStore` 的状态形状与此结构相容，直接把它传进来）。
 * 只列这三条路真需要的字段——多一个都不列，省得这条判定跟着 store 一起长大。
 */
export interface FlushSubject {
  activeDocTab: string | null;
  draft: string;
  savedFingerprint: string;
  dirty: boolean;
  conflict: { currentFingerprint: string } | null;
  draftsByPath: Record<string, DocState>;
}

/** 只取 live 那四格所需的最小形状：`useBookStore` 的本体与之相容，直接传进来。 */
export type LiveDocFields = Pick<FlushSubject, "draft" | "savedFingerprint" | "dirty" | "conflict">;

/**
 * live 那四格 → 一份 `DocState`（2026-10-10 行数预算尾巴）。
 *
 * 为什么只留一份：这份「四格照抄 + `conflict` 另造对象」的写法原先在 store 的 `snapshot()`
 * 与下面的 `flushIOFor.stateOf` 各写了一遍，而两者必须永远一致——暂存那份漏掉另造，
 * 切回来时两处就共享同一个冲突对象，外部再改一次会把两处判定一起带跑。
 */
export function docStateOf(subject: LiveDocFields): DocState {
  return {
    draft: subject.draft,
    savedFingerprint: subject.savedFingerprint,
    dirty: subject.dirty,
    conflict: subject.conflict ? { ...subject.conflict } : null
  };
}

/**
 * store → `FlushIO` 的转换：把「活动那一格的 live 状态 vs 存档，谁说了算」钉在这一处。
 *
 * 之所以不写成 store 的 action：`useBookStore.ts` 已经顶在 800 行的行数预算上，
 * 每往它身上加一格就得同时往外搬一格；而这条判定本来就该只有一份实现（铁律 6）。
 */
export function flushIOFor(
  subject: FlushSubject,
  write: (relPath: string, content: string, expectedFingerprint: string) => Promise<DocWriteResult>
): FlushIO {
  return {
    stateOf: (relPath) =>
      relPath === subject.activeDocTab
        ? docStateOf(subject)
        : (subject.draftsByPath[relPath] ?? null),
    write: (relPath, content, expectedFingerprint) => write(relPath, content, expectedFingerprint),
    markClean: (relPath, fingerprint) => {
      if (relPath === subject.activeDocTab) {
        subject.savedFingerprint = fingerprint;
        subject.dirty = false;
      }
      // 存档那份一起跟上：只改 live 会让下次切回来拿旧存档覆盖刚写下去的稿子。
      const stashed = subject.draftsByPath[relPath];
      if (stashed !== undefined)
        subject.draftsByPath[relPath] = {
          ...stashed,
          savedFingerprint: fingerprint,
          dirty: false
        };
    }
  };
}

/** 退出兜底没全成时那一句屏上理由（点名是哪几篇、为什么）。 */
export function quitBlockedNotice(blocked: { relPath: string; message: string }[]): string {
  const titles = blocked.map((one) => one.relPath).join("、");
  return `有 ${blocked.length} 篇没落盘：${titles}。${blocked[0]?.message ?? ""}`;
}

/**
 * 一次保存**拿到结果之后**该怎么摆这一格的状态（2026-10-09 全仓扫描 P0-2 的后半段）。
 *
 * 为什么单独抽出来：这段判定要钉的是三条容易写错的规矩——
 * ① `dirty` 只有在「内存与刚写出去那份一字不差」时才能清（保存期间用户又打了字，
 *   清成 false 就让那几个字活在「已保存」的假象里）；
 * ② 失败与陈旧时 `savedFingerprint` 一步都不许推进（推进＝承认盘上是这份）；
 * ③ 只有自动语境才允许它自己重新排程（手动通路不替用户开关排程）。
 * 这三条以前和 pinia 的赋值缠在一起，得起了 store 才验得动；抽成纯函数后逐条钉在用例里。
 *
 * `patch` 只列**要改的那几格**：没列出来的字段（比如失败时的 `dirty`）由调用方保持原样。
 */
export interface SaveOutcomeInput {
  /** 主进程写盘的返回。 */
  result: DocWriteResult;
  /** 这次请求**发出去那一刻**的稿子。 */
  submitted: string;
  /** 此刻内存里的稿子：与 `submitted` 不一致就说明 await 期间用户又打了字。 */
  liveDraft: string;
  /** 这次是自动保存还是手动按钮。 */
  auto: boolean;
}

export interface SaveOutcome {
  patch: Partial<DocState>;
  notice: string;
  /** 要不要按自动语境再排一次静默窗。 */
  reschedule: boolean;
}

export function saveOutcomeOf({
  result,
  submitted,
  liveDraft,
  auto
}: SaveOutcomeInput): SaveOutcome {
  if (result.ok) {
    const editedWhileSaving = liveDraft !== submitted;
    return {
      patch: { savedFingerprint: result.fingerprint, dirty: editedWhileSaving, conflict: null },
      notice: auto ? "已自动保存" : result.backupRelPath ? "已保存，原稿已备份" : "已保存",
      reschedule: auto && editedWhileSaving
    };
  }
  if (result.reason === "stale") {
    return {
      patch: { conflict: { currentFingerprint: result.currentFingerprint } },
      notice: "文件在外部被改过，已拒绝覆盖",
      reschedule: false
    };
  }
  return { patch: {}, notice: `保存失败：${result.message}`, reschedule: false };
}

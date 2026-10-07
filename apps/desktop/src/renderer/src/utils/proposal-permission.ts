/**
 * 「切档后再批准」的入口判定（Plan 2 冒烟 P3 · spec §7 波 1 第 9 条的尾巴）。
 *
 * 缺口长什么样：档位收紧时批准被主进程拒掉，卡上只留下一句理由，用户不知道
 * 「换一档再按一次就行」——于是他要么去猜左栏那个切换器，要么就放弃这条提案。
 *
 * 判定全部下沉在这里，`.vue` 只渲染。**判定本身不在本文件重写**：
 * 用的是 contracts 的 `writeVerdict` / `minimumModeFor`，与主进程批准时走的那一份
 * 同一个函数（铁律 6）。所以卡上那颗按钮指向的档，主进程一定认——不会出现
 * 「按了按钮还是被拒」这种两套规则漂出来的错。
 */
import {
  PERMISSION_LABELS,
  WORK_MODE_LABELS,
  writeVerdict,
  type PermissionMode,
  type WorkMode,
  type WriteVerdict
} from "@mochen/contracts";

export interface PermissionHintInput {
  /** 卡是否还等着裁决。只有 pending 才给入口——已裁决/已过期的卡不该再劝人切档。 */
  status: string;
  /** 这条提案要改的文件。 */
  docRelPath: string;
  /** 提案所绑线程的文稿；null = 独立线程。 */
  currentChapter: string | null;
  mode: PermissionMode;
  /** 工作模式（2026-10-05 批次 4）：`plan` 时给的是「切到直接动手」，不是切档。 */
  workMode: WorkMode;
}

export type PermissionHint =
  /** 现在就能批（或卡已经不是 pending）：不给入口。 */
  | { kind: "none" }
  /**
   * 切到 `mode` 之后这条就能批。`detail` 是给用户看的一句话。
   */
  | { kind: "switch"; mode: PermissionMode; label: string; detail: string }
  /**
   * 先计划后动手挡着：切任何**档位**都没用，要动的是工作模式。
   * 单独一格而不是复用 `switch`——那颗按钮点的不是同一个开关，
   * 复用会让装配处把它接到权限档菜单上去，用户点了毫无反应。
   */
  | { kind: "switch-work-mode"; label: string; detail: string }
  /**
   * 切档解决不了：目标不在作品文稿目录内，或 chapter-write 档根本没选定当前章。
   * 这两种给不出按钮——给一颗按了也没用的按钮，比不给更坏（spec §2.7）。
   */
  | { kind: "blocked"; detail: string };

export function permissionHint(input: PermissionHintInput): PermissionHint {
  if (input.status !== "pending") return { kind: "none" };
  const verdict: WriteVerdict = writeVerdict({
    mode: input.mode,
    docRelPath: input.docRelPath,
    currentChapter: input.currentChapter,
    workMode: input.workMode
  });
  if (verdict.kind === "allowed") return { kind: "none" };
  if (verdict.kind === "plan-mode") {
    return {
      kind: "switch-work-mode",
      label: `切到「${WORK_MODE_LABELS.act}」`,
      detail:
        `工作模式是「${WORK_MODE_LABELS.plan}」，这一轮不落盘。` +
        `切到「${WORK_MODE_LABELS.act}」后，这张卡还能直接批准——` +
        "先看计划再动手，批准前一个字都不会动。"
    };
  }
  if (verdict.kind === "outside-writable") {
    return { kind: "blocked", detail: "这个文件不在作品文稿目录内，换权限档也没有用。" };
  }
  if (verdict.kind === "no-current-chapter") {
    return { kind: "blocked", detail: "还没有选定当前章，先打开一章再改档。" };
  }
  // mode-too-tight 与 not-current-chapter 都归到「切到 X 就能批」：
  // 后者要的也是全开（minimumModeFor 判出来一样），所以两格合流是判据一致的结果。
  const needed = verdict.kind === "mode-too-tight" ? verdict.needed : "full-access";
  return {
    kind: "switch",
    mode: needed,
    label: `切到「${PERMISSION_LABELS[needed]}」`,
    detail: `现在这档不写入磁盘。切到「${PERMISSION_LABELS[needed]}」后，这张卡还能直接批准。`
  };
}

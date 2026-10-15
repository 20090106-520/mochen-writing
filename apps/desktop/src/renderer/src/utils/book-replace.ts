/**
 * 全书替换的渲染层那一层（2026-10-15）。
 *
 * 【这一层为什么要存在】替换本身在主进程（逐篇读 → 换 → 写），渲染层这边只做两件事：
 *   ① 把「找什么 / 换成什么」递过去（`runBookReplace`）；
 *   ② 把主进程那句真回执**翻成人话**（`bookReplaceNotice`）。
 * 第 ② 件必须是纯函数：文案是这一刀里唯一会骗人的地方——
 * 「已替换 0 处」与「改了 3 篇」在屏上长得像，用户的判断就全错了，所以它得有用例钉着。
 *
 * 【口径】一律照主进程回执说，不在这里二次推断：
 * 主进程说 ok 只说「这一趟跑完了」，没换成的那几篇在 `skipped` 里——
 * 只要 skipped 非空就绝不报成一次干净的「已替换」，那正是「不做假控件」。
 */
import type { BookReplaceInput, BookReplaceResult } from "@mochen/contracts";
import type { NotificationLevel } from "../stores/useNotificationStore";

/**
 * 递到主进程去换。IPC 本身抛错（主进程没起、通道没注册）也要回一个真结果：
 * 那颗按钮是 await 之后按 `result.ok` 分支的，让异常穿出去等于把它悬在 await 上。
 */
export async function runBookReplace(input: BookReplaceInput): Promise<BookReplaceResult> {
  try {
    return await window.mochen.replaceAllInBook(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "io-error",
      message: `全书替换没能跑到主进程（${message}），一个字都没动。`
    };
  }
}

export interface BookReplaceNotice {
  level: NotificationLevel;
  message: string;
}

/** 把人递进来的那段文本原样放进引号里：空串有专门的读法，不写成「」这种空对空。 */
function describe(text: string): string {
  return text === "" ? "（空）" : `「${text}」`;
}

/** 只报前几篇没换成的篇名：真出事时书名号里塞 300 个标题反而没人看得下去，完整清单在改稿历史那边。 */
const SKIPPED_SUMMARY_LIMIT = 3;

/**
 * 把回执翻成一条通知。四档如实分报：失败 / 一处没命中 / 干净地改完 / 改完了但有篇没动。
 */
export function bookReplaceNotice(
  result: BookReplaceResult,
  query: string,
  replacement: string
): BookReplaceNotice {
  if (!result.ok) return { level: "error", message: result.message };

  const { scannedDocs, changedDocs, replacedCount, skipped } = result;

  if (replacedCount === 0) {
    const note =
      skipped.length === 0
        ? ""
        : `另有 ${skipped.length} 篇读不下去（${skipped
            .slice(0, SKIPPED_SUMMARY_LIMIT)
            .map((s) => s.title || s.relPath)
            .join("、")}…），它们没法确认有没有这一处。`;
    return {
      level: skipped.length === 0 ? "info" : "warning",
      message: `全书 ${scannedDocs} 篇里没有${describe(query)}，一个字都没动。${note}`
    };
  }

  const head =
    replacement === ""
      ? `已从全书 ${scannedDocs} 篇里删掉${describe(query)}：改了 ${changedDocs} 篇、共 ${replacedCount} 处。`
      : `已把全书 ${scannedDocs} 篇里的${describe(query)}换成${describe(replacement)}：改了 ${changedDocs} 篇、共 ${replacedCount} 处。`;

  const tail = "每篇改前的样子都留在改稿历史里，随时能看 diff、能回滚。";
  const editorNote =
    "正开在编辑器里的篇不会自己变，需要重新打开才能看到新正文（免得盖掉你没保存的字）。";
  const skipNote =
    skipped.length === 0
      ? ""
      : `有 ${skipped.length} 篇没动：${skipped
          .slice(0, SKIPPED_SUMMARY_LIMIT)
          .map((s) => `${s.title || s.relPath}（${s.message}）`)
          .join("；")}${skipped.length > SKIPPED_SUMMARY_LIMIT ? " 等" : ""}。`;

  return {
    level: skipped.length === 0 ? "success" : "warning",
    message: `${head}${tail}${editorNote}${skipNote}`
  };
}

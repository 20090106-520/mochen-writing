/**
 * 写剪贴板（2026-10-25 · §173）。
 *
 * **为什么单独一份**：导出对话框（复制整书）与对话链的消息操作条（复制一段话）
 * 都要往剪贴板写字。各自写一遍 `navigator.clipboard.writeText`，就会有两个失败处理——
 * 一个报「无法访问剪贴板」、一个什么都不说。而**失败必须看得见**是仓库纪律。
 * ⇒ 写入与「成没成」的判定都只在这里；调用方只问一句「成了没有」。
 *
 * **平台 API 就是那份真身**：渲染层拿不到系统剪贴板，除它以外没有第二条路。
 * 写剪贴板不需要 IPC、不需要主进程——主进程那条路只会多一次跨进程往返。
 */
import { hasMessageText } from "./message-text";

/** 写盘动作（注入是为了能单测；生产用默认那份）。 */
export type ClipboardWriter = (text: string) => Promise<void>;

/** 默认那一份：渲染层的异步剪贴板。 */
const browserClipboard: ClipboardWriter = (text) => navigator.clipboard.writeText(text);

/**
 * 把一段文字写进剪贴板。
 *
 * @returns 写成了就 `true`；**空文本**与**被系统拒绝**都返回 `false`
 * （调用方据此给一句人话，不许当成「已复制」）。
 */
export async function copyText(
  text: string,
  writer: ClipboardWriter = browserClipboard
): Promise<boolean> {
  // 空文本不进剪贴板：写进去等于把上一条内容留在那儿，用户粘出来会拿到不相干的东西。
  // 「空」的判据只有一份（utils/message-text.ts），与消息动作条那道闸同口径。
  if (!hasMessageText(text)) return false;
  try {
    await writer(text);
    return true;
  } catch {
    // 被系统拒绝（权限、焦点、平台限制）——如实说失败，不假装成功。
    return false;
  }
}

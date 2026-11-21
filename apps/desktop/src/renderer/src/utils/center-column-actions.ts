import { BOOK_DATA_LABELS, type BookDataKey } from "@mochen/contracts";

/**
 * 中栏装配层的自有小判定（CenterColumn.vue 拆出的没有既有 utils 可归并的零碎）。
 *
 * 为什么拆：`.vue` 不进类型程序（裸 tsc + vue-shim），文案拼装写进 `<script setup>`
 * 等于一段永远测不到、也过不了类型关的逻辑；而这几句既不属于提案时间线
 * （utils/timeline），也不属于消息动作条（utils/message-actions），就归到这里。
 */

/** 「本轮全部接受」跑完后的那句回执：全成说全成，有败说几条没写成（原因在对应卡片上）。 */
export function acceptAllReceipt(ok: number, failed: number): string {
  return failed === 0
    ? `本轮 ${ok} 条提案已全部接受。`
    : `已接受 ${ok} 条，${failed} 条没写成（原因见对应卡片）。`;
}

/** 落盘失败的那几个设定名（2026-11-15）：清单本身只由 bookDataRegistry 写，这里只管拼人话。 */
export function flushFailedNamesOf(keys: BookDataKey[]): string {
  return keys.map((key) => BOOK_DATA_LABELS[key]).join("、");
}

/** 状态栏那条「设定未存好」的完整句子：查看与重试两个出口都摆在同一条上。 */
export function flushFailureNotice(failedNames: string): string {
  return `没存进目录的设定：${failedNames}。可点「重试保存」，或到对应面板重新保存一次。`;
}

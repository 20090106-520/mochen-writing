/**
 * 右栏「保存态」那句话的唯一拼身处。
 *
 * 为什么不在 `.vue` 里：`<script setup>` 既不进类型程序也没有运行时覆盖（本仓零 jsdom），
 * 句子和判定顺序住在那儿就等于没人看着——改乱它全仓不红（同 `utils/reading-time.ts` 的来历）。
 * 消费方是右栏头部与页脚两处，两处必须出自同一个判定，否则同一屏会说两句相反的话。
 */
export interface SaveStateInput {
  /** 盘上的文件被外部改过且本次写入已被拒（冲突守卫拦下的那一次）。 */
  conflict: boolean;
  saving: boolean;
  dirty: boolean;
  hasOpenDoc: boolean;
}

export const SAVE_STATE_LABELS = {
  conflict: "外部已改动，已拒绝覆盖",
  saving: "正在保存到本机",
  dirty: "有未保存修改",
  saved: "已保存到本机",
  noDoc: "未打开文稿"
} as const;

export type SaveStateLabel = (typeof SAVE_STATE_LABELS)[keyof typeof SAVE_STATE_LABELS];

/**
 * 顺序即优先级：冲突 > 正在保存 > 未保存 > 已保存 > 没稿子。
 * 「已保存到本机」只在真的干净且确实开着一篇时才说出口——没开稿子时说「已保存」是替用户编结论。
 */
export function saveStateLabel(input: SaveStateInput): SaveStateLabel {
  if (input.conflict) return SAVE_STATE_LABELS.conflict;
  if (input.saving) return SAVE_STATE_LABELS.saving;
  if (input.dirty) return SAVE_STATE_LABELS.dirty;
  return input.hasOpenDoc ? SAVE_STATE_LABELS.saved : SAVE_STATE_LABELS.noDoc;
}

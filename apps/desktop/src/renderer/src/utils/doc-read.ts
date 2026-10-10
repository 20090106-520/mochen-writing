import type { DocContent } from "@mochen/contracts";
import { failureReasonOf, type DocState } from "./draft-flush";

/**
 * 中栏读稿的通路（2026-10-05 批次 3 尾巴；判定抽出处与 `browse-read` 同构）。
 *
 * **为什么单独一处**：这条路上只有「令牌」这一件事最容易写错，而它错了不是闪一下，
 * 是**永久停在错的那一篇上**——快速连点两个标签时，先发的那次读回来是废弃答案，
 * 既不许摆正文，也不许顺手把后一次的在途标志撤掉（骨架提前消失就等于把「新标题配旧正文」放出去）。
 * 原先这套判定和 pinia 的七八个赋值缠在一起，验它得起整个 store；抽成注入 IO 的通路后，
 * `doc-read.test.ts` 逐条钉判定，`useBookStore.doc-loading.test.ts` 钉接线，各管各的。
 */

/**
 * 读稿的世代号：每发起一次读盘 +1，换书时也 +1（`bumpDocLoadToken`）。
 * 放模块级同 `autoSaveTimer`：它是记账用的，不是视图状态。
 */
let docLoadToken = 0;

/**
 * 换书时把在途读稿整体作废：不作废的话，上一本书那次慢回包会在换书之后
 * 把**上一本书的正文**摆进这一本的中栏。
 */
export function bumpDocLoadToken(): void {
  docLoadToken += 1;
}

/** 本通路对渲染层状态的要求：摆态的一律由调用方（`useBookStore`）做，这里只决定「摆不摆」。 */
export interface DocReadIO {
  /** 这一篇在渲染层有没有暂存副本（有就零延迟换过去，不发 IPC）。 */
  stashed(relPath: string): DocState | null;
  /** 读盘真身：`window.mochen.readDoc`。 */
  read(relPath: string): Promise<DocContent>;
  /** 用暂存副本摆态：不发 IPC 就不该进在途态。 */
  applyStashed(relPath: string, state: DocState): void;
  /** 盘上内容到手：正文、指纹、脏标记、暂存副本一起摆好（只在这一次仍持有令牌时被调用）。 */
  applyLoaded(relPath: string, loaded: DocContent): void;
  /** 读不动：清空正文 + 说清哪一篇没打开（只在这一次仍持有令牌时被调用）。 */
  applyFailure(relPath: string, reason: string): void;
  /** 在途标志：中栏据此摆骨架，而不是摆上一篇的正文。 */
  setLoading(value: boolean): void;
}

/**
 * 打开一篇文稿并把它的正文读回来。
 *
 * 令牌的取号与比对都发生在**这次调用自己的闭包**里：连点两篇时后一次取到更大的号，
 * 前一次回来就对不上，于是整条落地路径（摆正文、递理由、撤标志）一并作废。
 */
export async function readDocIntoTab(io: DocReadIO, relPath: string): Promise<void> {
  const stashed = io.stashed(relPath);
  if (stashed !== null) {
    io.applyStashed(relPath, stashed);
    return;
  }
  const token = (docLoadToken += 1);
  io.setLoading(true);
  try {
    const loaded = await io.read(relPath);
    if (token !== docLoadToken) return;
    io.applyLoaded(relPath, loaded);
  } catch (err) {
    if (token !== docLoadToken) return;
    io.applyFailure(relPath, failureReasonOf(err));
  } finally {
    // 只有还持有令牌的这次才收标志：废弃的那次落地会把在读的那次的骨架提前撤掉。
    if (token === docLoadToken) io.setLoading(false);
  }
}

/**
 * 对白段落形态那一句（2026-11-16，从 prompt-assembly.ts 拆出：那边贴着 800 行预算）。
 *
 * 【为什么值得一段】`dialogueBalanceSentence` 只在整章过密／全叙述时出声，`styleProfileSentence`
 * 报的是对白**字数**占比；两者都看不见「台词和动作怎么摆在一段里」。AI 连写对白最容易写成剧本——
 * 每段只有台词、一来一回几十行，读者听到的是声音、看不见人；反过来每句台词后面硬贴一条动作，
 * 也像流水线。这本书自己怎么排，量出来照它写，新章才不会忽然换一副骨架。
 *
 * 【口径】数字住 contracts 的 `dialogueParagraphShapeOf`（纯对白段＝引号外只有标点）；
 * 这里只把比例说成人话。样本不足或没有对白段返回空串（不注入空段）。
 */

import { dialogueParagraphShapeOf } from "@mochen/contracts";

export function dialogueParagraphSentence(text: string): string {
  const shape = dialogueParagraphShapeOf([text]);
  if (shape === null) return "";
  const percent = Math.round((shape.pure / shape.withDialogue) * 100);
  const head =
    "本书对白段落形态（扫描自这本书已完稿的正文）：" +
    `含对白的段落 ${shape.withDialogue} 段，其中纯对白段（引号外只有标点）${shape.pure} 段（约 ${percent}%），` +
    `台词与动作／神态同段 ${shape.mixed} 段。`;
  if (shape.pure === 0)
    return (
      head +
      "这本书没有一段只有台词——台词总和身体、器物或环境长在同一段里。" +
      "新写的对白也这样收：一句话说完，让动作或环境接一下，别把整场戏写成一行一句的剧本。"
    );
  if (shape.mixed === 0)
    return (
      head +
      "这本书的台词基本单独成段。" +
      "新写的照此分行：台词归台词，动作与神态另起一段，别把节拍硬塞进每一句台词里。"
    );
  return (
    head +
    "新写的对白照这个比例分行——既不要句句贴动作，也不要整场只有一来一回的台词；" +
    "该单独成段的台词单独成段，需要落地的节拍才和台词同段。"
  );
}

/**
 * 对话占比（2026-10-11）：引号内字数占正文字数的比例——「这一章是不是在开会」的量。
 *
 * 两端同吃这一份（单一真身）：
 * - 生成端：prompt-assembly 的 dialogueBalanceSentence——对话过密/过闷给模型一句找补提醒；
 * - 检测端：书稿体检第六类「对话占比」——逐章报数，作者一眼看出哪章话太密、哪章没戏。
 *
 * 口径（从 prompt-assembly 内联抽出来，语义一字不动）：
 * - 「」『』里的字算对话字（配对深度计数，防嵌套串味）；
 * - 空白字符不计入总量（缩进与换行不稀释占比）；
 * - 总字数 < 500 不判定（样本太少）；
 * - 占比 > 0.65 话太密（一章全是你一句我一句，动作与环境全缺席）；
 * - 占比 < 0.03 全叙述（没有戏，人物不开口）。
 *
 * 2026-10-19 配对补齐（P0-③ 作者风格档案下沉的前置）：出厂主笔的实际产出用**半角直引号 `"`**
 * （§一百三十一 真机复验查明：某章 66 个 `"`、`「」『』` 0 个），而原名目只认全角——
 * 一本对白充裕的书会被读成「对白占比约 0%」，那比不报更坏。故配对准入加**弯引号 `“”`** 与
 * **半角 `"`（行内奇偶）**。配对规则只有一处实现（scanQuotes）：
 * 占比（dialogueBalance）与段末收法（endsInsideQuote）同吃它，不许各写一套。
 */

export const DIALOGUE_BALANCE = {
  /** 低于这个总字数不判定：三五句话的段落算不出可信的占比。 */
  minChars: 500,
  /** 超过这个占比算「话太密」。 */
  denseRatio: 0.65,
  /** 低于这个占比算「全叙述」。 */
  silentRatio: 0.03
} as const;

export interface DialogueBalance {
  /** 引号内的字数（不含引号本身）。 */
  quoted: number;
  /** 非空白总字数（含对话字）。 */
  total: number;
  /** 占比 = quoted / total（total 为 0 时是 0）。 */
  ratio: number;
}

/**
 * 引号配对的**唯一实现**：逐字符回调 `(char, inside)`，引号字符本身不进回调
 * （与旧实现「引号不计入 total」等效）。四种引号：
 * - 全角 `「『` 开、`」』` 闭，带深度（防嵌套串味——旧口径一字不动）；
 * - 弯引号 `“` 开、`”` 闭；
 * - 半角 `"` **开闭同形** ⇒ 按**行内奇偶**判（奇数个为开）；**行末回落**——一行里落单的那个
 *   不污染后文（`"他没说话` 后面的叙述不该被吞成对白）。
 *   与 ai-flavor.ts 的 normalizeDialogueQuotes() 同一路数，但两处各司其职：
 *   那里为**句式匹配**把半角归一成弯引号，这里为**字数配对**维持深度。
 */
function scanQuotes(text: string, visit: (char: string, inside: boolean) => void): void {
  let depth = 0;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    let straightOpen = false;
    for (const char of line) {
      if (char === "「" || char === "『") {
        depth += 1;
      } else if (char === "」" || char === "』") {
        if (depth > 0) depth -= 1;
      } else if (char === "“") {
        depth += 1;
      } else if (char === "”") {
        if (depth > 0) depth -= 1;
      } else if (char === '"') {
        if (straightOpen) {
          straightOpen = false;
          if (depth > 0) depth -= 1;
        } else {
          straightOpen = true;
          depth += 1;
        }
      } else {
        visit(char, depth > 0);
      }
    }
    // 行末回落：半角引号开闭同形，一行里不成对的那个当行内孤立，不带进下一行。
    if (straightOpen) depth -= 1;
    // 行界本身也交给回调（2026-11-15）：`narrationOf` 要保住段落边界，而引号内外只有这里知道。
    // 对既有两个消费者中性：dialogueBalance 遇到 `\s` 直接 return；endsInsideQuote 收的是单行，
    // 根本不产生行间回调。最后一行之后不补，避免正文末尾多出一个换行。
    if (index < lines.length - 1) visit("\n", false);
  }
}

/** 一次扫描的两份产物（2026-11-16 合并全书扫描）：对白占比 ＋ 引号外叙述原文。 */
export interface QuotedScan {
  balance: DialogueBalance;
  /** 引号外的叙述原文，行界保留（供人称统计）。 */
  narration: string;
  /** 引号内的台词原文（不含引号，2026-11-16）：供对白复读读数用。 */
  quotedText: string;
}

/**
 * 一次 `scanQuotes` 同时算出占比、叙述与台词原文：生成端每轮要对同一份正文量对白、量人称，
 * 分成两趟就是把同一段字逐字符扫两遍。口径与 `dialogueBalance` / `narrationOf` / `quotedOf`
 * 逐字一致——这三个函数现在只是本函数的薄包装，引号配对仍只有 `scanQuotes` 一处实现。
 */
export function scanQuoted(text: string): QuotedScan {
  let quoted = 0;
  let total = 0;
  let narration = "";
  let quotedText = "";
  scanQuotes(text, (char, inside) => {
    if (inside) quotedText += char;
    else narration += char;
    if (/\s/.test(char)) return;
    total += 1;
    if (inside) quoted += 1;
  });
  return {
    balance: { quoted, total, ratio: total === 0 ? 0 : quoted / total },
    narration,
    quotedText
  };
}

/** 引号内计数：走 scanQuotes 的同一份配对；空白不进分母，引号字符本身也不进。 */
export function dialogueBalance(text: string): DialogueBalance {
  return scanQuoted(text).balance;
}

/**
 * 只留**引号外**的叙述（2026-11-15）：逐段剔除对话，行界保留。
 *
 * 用途只有一个：叙述人称统计（`narration-person.ts`）。人物说的话里「我」「他」满篇都是，
 * 混进来会把「这一章叙述用什么人称」读成噪音。引号配对仍只走 `scanQuotes` 一处，
 * 不另立一套规则——半角 `"` 的行内奇偶、行末回落也照旧生效。
 */
export function narrationOf(text: string): string {
  return scanQuoted(text).narration;
}

/**
 * 只留**引号内**的台词原文（2026-11-16）：对白复读读数用——量的是人物说过的话，
 * 不能被叙述里的相同短句（「他走了。」）混进来。引号配对同样只走 `scanQuotes` 一处。
 */
export function quotedOf(text: string): string {
  return scanQuoted(text).quotedText;
}

export type DialogueVerdict = "thin-sample" | "dense" | "silent" | "normal";

/** 占比 → 判读。thin-sample（样本不足）不算病，体检里单独一个说法，不混进「正常」。 */
export function dialogueVerdict(balance: DialogueBalance): DialogueVerdict {
  if (balance.total < DIALOGUE_BALANCE.minChars) return "thin-sample";
  if (balance.ratio > DIALOGUE_BALANCE.denseRatio) return "dense";
  if (balance.ratio < DIALOGUE_BALANCE.silentRatio) return "silent";
  return "normal";
}

/** 判读的中文展示名（真身住 contracts，界面不另抄一份）。 */
export const DIALOGUE_VERDICT_LABELS: Record<DialogueVerdict, string> = {
  dense: "话太密",
  silent: "全叙述",
  normal: "常态",
  "thin-sample": "篇幅太短"
};

/**
 * 一段文字读完是否仍停在引号内（2026-10-19）。
 *
 * 技能库《给这本书立一本文风手册》第 5 维「每段的收法」的机器判据：段末落在台词上，
 * 还是落在叙述／动作上。与占比同吃一份配对（scanQuotes），不另立一套引号规则；
 * 段按**非空行**切（本仓产出的章节正文即行式段落）。
 */
export function endsInsideQuote(paragraph: string): boolean {
  let inside = false;
  scanQuotes(paragraph, (_char, insideAtChar) => {
    inside = insideAtChar;
  });
  return inside;
}

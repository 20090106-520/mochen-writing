/**
 * 把「明明是中文段落、却被包进代码围栏」的那种块拆出来（2026-11-10）。
 *
 * 【为什么要有这一层】用户报「输出的东西不要代码」。源头在提示词（已加
 * `DIALOGUE_REPLY_INSTRUCTION`），但**历史消息改不回来**——模型以前把整段正文
 * 包进 ``` 里，`markdownToSimpleHtml` 照规矩渲染成 `<pre><code>`，屏上就是一片
 * 等宽小字的灰块，用户还得自己从里面往外抠字。
 *
 * 【为什么只剥散文、不剥真代码】判断依据是内容形状而不是用途：真代码块（有语言标记、
 * 或者符号密度高）原样留着——那是用户自己要看的。中文占非空白字符三分之一以上、
 * 且代码符号不超过百分之二的块，不可能是代码，只能是正文或说明。
 *
 * 【未闭合的围栏一律不动】流式输出时开围栏会先到、闭合行隔几百毫秒才到。这时候剥了，
 * 下一帧闭合又到，屏上的段落会来回跳一次。
 */

/** 一行围栏：至多三个空格缩进，三个以上反引号或波浪号，后跟可选语言标记。 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;

/**
 * 允许「剥」的语言标记。空标记最常见（模型直接开围栏不写语言）；
 * `text` / `txt` / `plain` 是明确说自己不是代码的那几种写法。
 * 其余一律当代码——`md` 虽然也不是代码，但那是用户想看的排版样本，不替他改。
 */
const PROSE_LANGS = new Set(["", "text", "txt", "plain", "plaintext"]);

const CJK = /[\u3400-\u9fff]/gu;
/** 代码符号表：括号、分号、等号、尖括号、位运算与常见标记符号。不含引号（正文里也有）。 */
const CODE_SIGN = /[{}[\]();=<>|\\&$#@^*~`]/gu;

/**
 * 这段内容像不像中文段落。
 *
 * 两个比值都按**非空白字符**算：空白在代码里既是缩进也是排版，算进去会让长缩进的
 * 短代码看起来「符号很少」。
 */
function looksLikeProse(lines: string[]): boolean {
  const joined = lines.join("\n");
  const compact = joined.replace(/\s/g, "");
  // 空块：里面什么都没有，围栏本身就是多余的。
  if (compact.length === 0) return true;
  const cjk = (joined.match(CJK) ?? []).length;
  const signs = (joined.match(CODE_SIGN) ?? []).length;
  return cjk / compact.length >= 0.35 && signs / compact.length <= 0.02;
}

export interface UnfenceResult {
  text: string;
  /** 剥掉了几块。测试与排查用——界面上不显示这个数。 */
  removed: number;
}

/**
 * 逐行扫，找到成对的围栏再判内容。不闭合的围栏原样抄回去（含它后面的那些行）。
 */
export function unfenceProseBlocks(source: string): UnfenceResult {
  if (!source.includes("```") && !source.includes("~~~")) return { text: source, removed: 0 };
  const lines = source.split("\n");
  const out: string[] = [];
  let removed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const open = FENCE.exec(line);
    if (open === null) {
      out.push(line);
      continue;
    }
    // 标记符与语言都在正则的捕获组里，组号对得上；`?? ""` 只为让索引类型不必再 narrow。
    const marker = (open[1] ?? "`").charAt(0);
    const lang = (open[2] ?? "").toLowerCase();

    // 闭合行：同一种标记、且后面不跟语言（跟了就是另一块的开头）。
    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = FENCE.exec(lines[j] ?? "");
      if (
        candidate !== null &&
        (candidate[1] ?? "`").charAt(0) === marker &&
        (candidate[2] ?? "") === ""
      ) {
        close = j;
        break;
      }
    }
    if (close < 0) {
      // 还在流：开围栏先到了，闭合行还没来。原样放过。
      out.push(line);
      continue;
    }

    const body = lines.slice(i + 1, close);
    if (!PROSE_LANGS.has(lang) || !looksLikeProse(body)) {
      out.push(...lines.slice(i, close + 1));
      i = close;
      continue;
    }

    /*
     * 块内一行一段：正文本来就是一段一行，剥掉围栏后必须补空行，
     * 否则 Markdown 会把相邻两行并成同一段。缩进一并去掉——围栏里的首行缩进
     * 通常是编辑器给代码加的，不是作者写的。
     */
    const paragraphs = body.map((line) => line.trim()).filter((line) => line !== "");
    if (paragraphs.length > 0) out.push(paragraphs.join("\n\n"));
    removed += 1;
    i = close;
  }

  return { text: out.join("\n"), removed };
}

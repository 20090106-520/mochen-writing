import type { PatchMode } from "@mochen/contracts";

/**
 * 锚点应用的三态结论（spec §6.1）：
 * - `unique`：锚点逐字唯一命中（或 doc-overwrite 整篇替换），`content` 是新全文；
 * - `ambiguous`：锚点出现多处，**必须判歧义且不产出新文本**，由上层把 `message` 回喂模型；
 * - `missing`：锚点为空或文中找不到，同样不产出新文本。
 * status/hits/message 三个字面值与文案是 Task 7/10/11 逐字消费的门面，改动需同步。
 * 锚点按盘上字节逐字匹配（仓库约定 UTF-8+LF，不做任何换行归一化）：diff 侧才把 \r\n 归一，
 * 这里 anchor 必须与文件里的字节一致才能命中。
 */
export interface ApplyResult {
  status: "unique" | "ambiguous" | "missing";
  content: string;
  hits: number;
  message: string;
}

/** 不重叠计数：needle 为空串时返回 0（空锚点不合法，交由调用方判 missing）。 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

export function applyPatch(
  doc: string,
  mode: PatchMode,
  anchor: string,
  replace: string
): ApplyResult {
  if (mode === "doc-overwrite") {
    if (replace.trim() === "")
      return { status: "missing", content: "", hits: 0, message: "不能把文稿清空：新内容为空" };
    return { status: "unique", content: replace, hits: 1, message: "整篇替换" };
  }
  if (anchor === "")
    return {
      status: "missing",
      content: "",
      hits: 0,
      message: "锚点为空：anchor 必须是文中真实存在的原文片段"
    };
  const hits = countOccurrences(doc, anchor);
  if (hits === 0)
    return {
      status: "missing",
      content: "",
      hits: 0,
      message: `文中找不到锚点「${anchor.slice(0, 40)}」。请用 read_doc 读全文后，取一段逐字存在的原文重试。`
    };
  // 命门：锚点不唯一时绝不猜位置——判歧义、content 留空，由上层回喂模型带上下文重试。
  if (hits > 1)
    return {
      status: "ambiguous",
      content: "",
      hits,
      message: `锚点在文中出现 ${hits} 次，无法唯一定位。请带上更多上下文（整句或前后句）重试。`
    };
  // 唯一命中：用切片拼接而不是 doc.replace(anchor, replace)——后者会把 replace 里的
  // `$&`／`$1` 之类序列当成替换模式解释，模型写的正文里出现 `$` 就会静默改错文本。
  const at = doc.indexOf(anchor);
  return {
    status: "unique",
    content: `${doc.slice(0, at)}${replace}${doc.slice(at + anchor.length)}`,
    hits: 1,
    message: "锚点唯一命中"
  };
}

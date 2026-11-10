/**
 * 工具调用参数的人话版（2026-10-07 用户裁定）。
 *
 * 【为什么要这一份】工具卡原来把 `event.args` 原样摆出来，于是作者看到的是
 * `{"doc":"chapters/01-开局.md","anchor":"雾从海面涌上来。 ","replace":"海雾涌上来，铁锈味很冲。 ","why":"补一层可感的细节"}`
 * ——模型和机器之间的话，摆在一张要人读的卡上。用户裁定：**只显示文字，不用显示代码**。
 *
 * 【只动显示，不动数据】原始 args 仍然原样留在工具事件里，也仍然随会话 JSONL 落盘：
 * 它是给模型读、也是回放与排查用的。这里换掉的只有卡片上那一行人的读法
 * （与批次 5-⑪「折叠只影响显示」同一条纪律）。
 *
 * 【兜底不许悄悄吞】解析不了就原样返回。参数写坏时那张卡正是排查的入口，
 * 把坏 JSON 换成一句「已执行」才是把线索毁了。
 */
export interface ToolArgsText {
  /** 摆上卡的那一句话。 */
  text: string;
  /** 只显示文字（不画等宽字体）——目前恒为 true，留在类型里是为了模板不必自己判。 */
  plain: boolean;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parse(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 只保留首尾各一段，中间收成省略号——参数里的正文可能很长，卡上不该摊开整段稿子。 */
function clip(text: string, head = 28, tail = 28): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= head + tail + 1) return one;
  return `${one.slice(0, head)}…${one.slice(-tail)}`;
}

/** 文件名去掉目录与 .md 后缀：卡上写《01-开局》比写 chapters/01-开局.md 好读。 */
function docTitle(doc: string): string {
  const name = doc.split(/[\\/]/).pop() ?? doc;
  return name.replace(/\.md$/i, "");
}

const PHRASE: Record<string, (a: Record<string, unknown>) => string | null> = {
  propose_patch: (a) => {
    const title = docTitle(str(a["doc"]));
    const anchor = str(a["anchor"]);
    const replace = str(a["replace"]);
    if (title === "" && anchor === "" && replace === "") return null;
    const why = str(a["why"]);
    const head = `把《${title}》里的「${clip(anchor)}」改成「${clip(replace)}」`;
    return why === "" ? `${head}。` : `${head}——${why}。`;
  },
  write_doc: (a) => {
    const title = docTitle(str(a["doc"]));
    const why = str(a["why"]);
    const head = `写入《${title}》`;
    return why === "" ? `${head}。` : `${head}——${why}。`;
  },
  read_doc: (a) => {
    const title = docTitle(str(a["doc"]));
    return title === "" ? null : `读《${title}》全文。`;
  },
  web_search: (a) => {
    const query = str(a["query"]);
    return query === "" ? null : `搜「${clip(query, 40, 20)}」。`;
  },
  web_read: (a) => {
    const url = str(a["url"]);
    // URL 太长（360 的跳转链能到 450 字符），卡上只留主机名+一段路径——够人认出是哪一页。
    if (url === "") return null;
    const short = url.replace(/^https?:\/\//, "");
    return `读网页「${clip(short, 40, 16)}」。`;
  }
};

export function toolArgsText(tool: string, raw: string): ToolArgsText {
  const args = parse(raw);
  // 空参数（`{}`）：真机截图上那是「列出文档 {}」——一对花括号是机器话，不是人话。
  // 这类工具本来就不需要参数，直说一句更诚实；它也没有排查价值，兜底那条不适用。
  if (args !== null && Object.keys(args).length === 0) return { text: "不带参数", plain: true };
  const phrase = args === null ? null : (PHRASE[tool]?.(args) ?? null);
  // 解析不了、或这个工具还没有人话版：原样摆。那是排查入口，不是要藏起来的东西。
  if (phrase === null) return { text: raw, plain: false };
  return { text: phrase, plain: true };
}

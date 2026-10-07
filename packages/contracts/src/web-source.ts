/**
 * 来源键：一个链接的固定身份（2026-10-06 批次 5-⑩）。
 *
 * **为什么要有它**：批次 5-⑨ 的回执用「[1][2][3]」当编号，那是**位置**不是**身份**。
 * 一轮里模型换几个词重搜是很正常的事（第一轮搜不准就换词），可两张回执各自从 1 开始数，
 * 于是模型上下文里并排躺着两个「[1]」、两个「[2]」，它照着回执里「引用时请带编号」的指示
 * 写出「据来源[2]」，用户在中栏两张工具卡上根本分不清说的是哪一条——**指代失败，而且不报错**。
 * 第一次搜索时编号是对的，所以只搜一次永远照不出这个问题。
 *
 * 改成「身份」之后三件事同时成立：同一个链接两次搜索必得同一个键（不撞车）、
 * 不同链接必得不同的键（不混淆）、键与顺序无关（回执怎么排都不影响）。
 *
 * 放在 contracts 而不是主进程或渲染层任意一侧：回执（主进程排版）与工具卡（渲染层显示）
 * 必须给出**同一个**键，两边各算一份就是两份实现，迟早会漂。
 *
 * 形态：`域名/路径末段-四位指纹`，例如 `baike.baidu.com/darkforest-2c1`。
 *  - 域名去 `www.`：360 自己就用 www.so.com 递跳转链。
 *  - 只留路径末段：中间目录对用户辨认来源没有帮助，还把键撑长。
 *  - 末尾恒带指纹：唯一性不靠「猜路径像不像内容页」。360 递的绝大多数是
 *    `www.so.com/link?m=…`，光看路径全都长一个样，只有指纹能把它们分开。
 * 指纹取 FNV-1a 的四位十六进制：判重用的，不是安全哈希。
 *
 * **已知边界**：360 的 `so.com/link?m=…` 参数是不透明串（不猜它的编码，见 web-search.ts），
 * 所以同一条内容页两次被 360 递来时参数可能不同 → 两个不同的键 → 判不出重复。
 * 这是刻意接受的：宁可漏判重复，也不猜一个解不开的参数。
 */

const KEY_MAX = 48;

/** FNV-1a 32 位的前四位十六进制。取四位够判重，不承担安全职责。 */
function fingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // 乘 16777619 会超出 32 位，Math.imul 保留低 32 位（位运算在 JS 里是有符号 32 位）。
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 4);
}

/**
 * 由 URL 算出来源键。**解不开的 URL 也给键**（退化成 `链接-xxxx`）而不是抛错或空串：
 * 键是给人和模型看的标签，标签难看不该让一条真结果从清单里消失。
 */
export function sourceKey(url: string): string {
  let stem: string;
  // 指纹算在**归一之后**的串上：`www.` 前缀与末尾斜杠是同一个页面的两种写法，
  // 算在原始地址上会让 360 递的 `www.so.com/link?…` 与我们自己记的 `so.com/link?…`
  // 对不上号——那正是判重要抓的东西，键自己却认不出是同一个页面。
  let canonical: string;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter((part) => part !== "");
    const tail = segments.at(-1) ?? "";
    // 路径末段常常是百分号编码的中文（/文章 → /%E6%96%87%E7%AB%A0），原样进键不好认。
    // decodeURIComponent 对畸形编码会抛，抛了就用原串，不为一个标签丢掉整条结果。
    let readable = tail;
    if (tail !== "") {
      try {
        readable = decodeURIComponent(tail);
      } catch {
        readable = tail;
      }
    }
    stem = readable === "" ? host : `${host}/${readable}`;
    // query 留着：`/list?page=2` 与 `/list?page=3` 确实是两页。跟踪参数（?form= 之类）
    // 仍会让键不同——剥它们是搜索源那边的知识（见 web-search.ts 的 normalizeResults），
    // 不在这里猜：猜错一条键就是一次误判重。
    canonical = `${host}${path}${parsed.search}`;
  } catch {
    stem = "链接";
    canonical = url;
  }
  const mark = `-${fingerprint(canonical)}`;
  // 截断时补的那个「…」也占一格，算进上限里，否则截出来的键正好比上限多一个字符。
  const room = KEY_MAX - mark.length - 1;
  return stem.length > room ? `${stem.slice(0, room)}…${mark}` : `${stem}${mark}`;
}

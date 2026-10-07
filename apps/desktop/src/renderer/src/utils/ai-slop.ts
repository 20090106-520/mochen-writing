/**
 * 去 AI 味检查器（2026-10-05）的纯判定层。
 *
 * **为什么它不许调模型**：左栏「一致性 / 剧情 / 逻辑」三项都要发一次请求——烧 token、要等、
 * 还得联网。而「这句像不像 AI 写的」是查表就能答的，查表就是零成本、零延迟、离线可用。
 * 这条边界是本功能存在的理由；哪天有人把它改成"让 AI 自己判断"，那是功能倒退。
 *
 * 词表是自己整理的**通行 AI 腔清单**（`STRONG_TERMS` / `SUSPECT_TERMS`），
 * 没有从任何第三方仓库抄文件。分两档是刻意的：
 * - `strong`：几乎不可能是作者主动写的（成语堆砌、总结句、套路环境描写）；
 * - `suspect`：常见句式，**作者完全可能是故意的**（网文里「缓缓地」并不罕见）。
 *   报出来是提醒不是判决——UI 与交给 AI 的指令里都不许说成"错误"。
 */

/** 命中强度：strong = 几乎必是 AI 腔；suspect = 提醒作者自己判断。 */
export type SlopStrength = "strong" | "suspect";

export interface SlopHit {
  /** 1 起的行号——跟编辑器里的行号对得上，作者点了就能跳过去。 */
  line: number;
  /** 命中的字面量（词或短语），原样回显，不做归一化。 */
  matched: string;
  strength: SlopStrength;
  /** 一句话说清为什么可疑。 */
  why: string;
  /** 所在那一行的片段（截断过），让作者看见上下文而不必回编辑器。 */
  excerpt: string;
}

interface SlopTerm {
  term: string;
  why: string;
}

/** 强信号：套话、总结句、成语堆砌、套路化环境与情绪描写。 */
export const STRONG_TERMS: readonly SlopTerm[] = [
  { term: "值得注意的是", why: "总结式开场，AI 最爱的起手式" },
  { term: "值得一提的是", why: "同上的另一说法" },
  { term: "不难看出", why: "替读者下结论，作者很少这么写" },
  { term: "不难发现", why: "同上的另一说法" },
  { term: "毫无疑问", why: "AI 常用的绝对化副词" },
  { term: "显而易见", why: "同上的另一说法" },
  { term: "总而言之", why: "公文腔，出现在小说里几乎都是 AI 味" },
  { term: "综上所述", why: "公文腔" },
  { term: "简而言之", why: "公文腔" },
  { term: "可以说", why: "AI 用来软化判断的高频填充词" },
  { term: "不得不说", why: "同上的另一说法" },
  { term: "令人深思", why: "空泛评价，没有具体指向" },
  { term: "发人深省", why: "同上的另一说法" },
  { term: "留下了深刻的印象", why: "典型的空洞总结句" },
  { term: "空气仿佛凝固", why: "被用滥的环境描写模板" },
  { term: "时间仿佛静止", why: "同上的另一说法" },
  { term: "仿佛一切都", why: "万能模糊开场" },
  { term: "一切似乎都", why: "同上的另一说法" },
  { term: "五味杂陈", why: "成语堆砌的固定情绪表达" },
  { term: "百感交集", why: "同上的另一说法" },
  { term: "涌上心头", why: "被用滥的情绪套路" },
  { term: "嘴角勾起", why: "人物反应的固定句式" },
  { term: "眼中闪过", why: "同上的另一说法" },
  { term: "心中一凛", why: "网文里已被写死的反应描写" },
  { term: "心头一震", why: "同上的另一说法" },
  { term: "若有所思", why: "万能反应，缺具体动作" },
  { term: "意味深长", why: "用来说不出所以然的评价" },
  { term: "不由自主地", why: "AI 偏爱的副词" },
  { term: "而就在这时", why: "转折连接词的高频组合" },
  { term: "画面一转", why: "分场提示的固定说法" },
  { term: "命运的齿轮", why: "被用滥的宏大意象" },
  { term: "历史的长河", why: "同上的另一说法" },
  { term: "时代的洪流", why: "同上的另一说法" },
  { term: "从此以后", why: "AI 常用的段末收束" }
];

/** 弱信号：常见句式，作者可能有意为之，只提醒不判决。 */
export const SUSPECT_TERMS: readonly SlopTerm[] = [
  { term: "缓缓地", why: "副词密度高时整段会发飘" },
  { term: "静静地", why: "同上" },
  { term: "深深地", why: "同上" },
  { term: "似乎", why: "一处正常，一篇里反复出现就是犹疑腔" },
  { term: "仿佛", why: "同上" },
  { term: "一丝", why: "「一丝……」是情绪套话的固定量词" },
  { term: "那一刻", why: "AI 常用的时间定格" },
  { term: "这一刻", why: "同上" },
  { term: "某种", why: "含糊指代，作者通常会指名" },
  { term: "内心深处", why: "心理描写的空泛定位" },
  { term: "与此同时", why: "连接词；一段里出现多次就是流水账" }
];

/** excerpt 最多留这么长，再长作者也读不出新东西。 */
const EXCERPT_MAX = 48;

function excerptOf(line: string, index: number): string {
  const half = Math.floor(EXCERPT_MAX / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(line.length, start + EXCERPT_MAX);
  const head = start > 0 ? "…" : "";
  const tail = end < line.length ? "…" : "";
  return head + line.slice(start, end) + tail;
}

/**
 * 扫一遍正文，返回全部命中。
 * 纯函数：同样的输入永远给同样的输出（不掺随机、不掺时间、不读全局）。
 * 行内多处命中逐条报出，不合并——作者要按条改。
 */
export function findAiSlop(content: string): SlopHit[] {
  if (content.trim() === "") return [];
  const hits: SlopHit[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    for (const { term, why } of STRONG_TERMS) {
      let at = line.indexOf(term);
      while (at !== -1) {
        hits.push({
          line: i + 1,
          matched: term,
          strength: "strong",
          why,
          excerpt: excerptOf(line, at)
        });
        at = line.indexOf(term, at + term.length);
      }
    }
    for (const { term, why } of SUSPECT_TERMS) {
      let at = line.indexOf(term);
      while (at !== -1) {
        hits.push({
          line: i + 1,
          matched: term,
          strength: "suspect",
          why,
          excerpt: excerptOf(line, at)
        });
        at = line.indexOf(term, at + term.length);
      }
    }
  }
  return hits;
}

export interface SlopVerdict {
  level: "clean" | "mild" | "heavy";
  /** 给用户看的一句话。 */
  label: string;
  /** 全部命中条数。 */
  hits: number;
  /** 强信号条数——这才是真要改的。 */
  strong: number;
  /** 每千字命中密度（弱信号也计入），短文里一处也是实打实的一处。 */
  perThousand: number;
}

/**
 * 总体评价。
 * 判定只看**强信号条数**，不看密度：一篇三千字里有一处「值得注意的是」很正常，
 * 有一屏「值得注意的是 / 总而言之 / 令人深思」才是 AI 味重。
 * 密度另算一个读数给人看，不参与定性。
 */
export function slopVerdict(hits: SlopHit[], content: string): SlopVerdict {
  const strong = hits.filter((h) => h.strength === "strong").length;
  const chars = content.replace(/\s/g, "").length;
  const perThousand = chars === 0 ? 0 : Math.round((hits.length / chars) * 1000 * 10) / 10;
  if (strong === 0) {
    return {
      level: "clean",
      label: hits.length === 0 ? "这一篇没扫出 AI 腔" : "只有几处常见句式，自己读一遍就行",
      hits: hits.length,
      strong,
      perThousand
    };
  }
  const level = strong >= 4 ? "heavy" : "mild";
  return {
    level,
    label: strong >= 4 ? `扫出 ${strong} 处套话，AI 味偏重` : `扫出 ${strong} 处套话，值得改一改`,
    hits: hits.length,
    strong,
    perThousand
  };
}

/**
 * 把本地结果翻成一句**可执行**的改写指令，预填给 AI（用户保留最后一道发送权）。
 * 零命中也给得出一句可用的话：那时可以让 AI 通读润色，而不是返回空串让面板哑掉。
 */
export function slopChecklistPrompt(hits: SlopHit[], docTitle: string): string {
  const head = `请改「${docTitle}」这一篇里扫出的 AI 腔。逐条处理下面清单，只改这些地方，别的句子原样保留。`;
  if (hits.length === 0) {
    return `${head}\n本地没有扫出明确的套话，请你通读一遍：把翻译腔、空泛的情绪词和万能句式换成具体的动作与细节，没有要改的就说没有。`;
  }
  const strong = hits.filter((h) => h.strength === "strong");
  const suspect = hits.filter((h) => h.strength === "suspect");
  const tail =
    suspect.length > 0
      ? `\n\n上面标为「疑似 AI 腔」的是常见句式，作者可能是有意这么写的，**先保留**，只有确实读着别扭才改。`
      : "";
  return `${head}\n\n疑似 AI 腔（优先改）：\n${strong.map((h) => `- 第 ${h.line} 行：「${h.matched}」——${h.why}`).join("\n") || "（无）"}\n\n只提醒不判决（先看再说）：\n${suspect.map((h) => `- 第 ${h.line} 行：「${h.matched}」`).join("\n") || "（无）"}${tail}\n\n改完逐条告诉我你把哪一句换成了什么。`;
}

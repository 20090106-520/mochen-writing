/**
 * 技能市场清单的**出处写法**（2026-10-07 批次 5-㊱）。
 *
 * 【为什么出处要有一份「写法」，而不只是每个作者自己写一句】
 * `skill-catalog.test.ts` 有一条守卫要判「这一条是抄来的，还是本仓自己写的」，
 * 判据是 `origin` 开头是不是「本仓原创」。**那意味着出处的前缀是一个判定，不只是一段说明**：
 * 换个词写，守卫就会把抄来的当原创放过，而用户读到的是一份冒了名的技能。
 * 所以前缀收在这里，清单里不许另写字面量。
 *
 * 【抄来的必须照抄上游许可，而「许可不明」等于没法照抄】
 * `UPSTREAM` 这张表只收**许可已经核实**的仓库（都是 MIT）。
 * 网上能搜到的中文写作 skill 包不少，其中相当一部分没写许可或没写清——
 * 那种不在这张表里，于是它们的方法一条也收不进来。
 * 这不是漏收，是「照抄上游许可」这条要求在它们身上无法满足。
 * 将来要收新的上游，先把它的 LICENSE 核实了，再往这张表里加一行。
 */

/** 本仓原创的出处前缀。守卫靠它区分「抄来的」与「自己写的」，别改。
 *  **不导出**：写 `origin` 的唯一入口是 `own()`，而守卫那一份要另写（见 skill-catalog.test.ts 文件头）——
 *  导出它就会有人开始从生产代码 import 那个前缀去写判定，于是守卫跟着被测对象一起改。 */
const OWN = "本仓原创";

/** 本仓原创那几条的许可。 */
export const OWN_LICENSE = "本仓自有";

/**
 * 抄来的那几条统一照抄上游的许可。`UPSTREAM` 里五个仓库都是 MIT，所以这个值只有一个；
 * 哪天真收进一个 Apache-2.0 的，要连这里与守卫一起改，不能只改某一条的 `license` 字段——
 * 那会出现「有的抄来的写 MIT、有的写 Apache」，而用户没有任何办法从卡片上看出来它们不是一回事。
 */
export const UPSTREAM_LICENSE = "MIT";

/** 已核实许可的上游仓库。键名短一点，写在每条技能的 origin 里不啰嗦。 */
export const UPSTREAM = {
  /** 网文全流程 skill 包：扫榜 / 拆文 / 写作 / 去 AI 味，13 个 skill，MIT。 */
  ohStory: "zenstory-ai/oh-story-claudecode",
  /** 中文小说创作 skill：章节结构、悬念钩子、人物塑造、情节模板，MIT。 */
  novelist: "PenglongHuang/chinese-novelist-skill",
  /** 中文网文创作工作站：风格拆书、去 AI 痕迹、叙事分析，MIT。 */
  novelistStation: "YuppyChen/novelist-test",
  /** 证据优先的深度检索 skill：先定需要什么证据，再去读正文，MIT。 */
  deepResearch: "LikC1606/deep-research-skill",
  /** DeepSeek Harness 公开的技能集，方法源自 obra/superpowers，MIT。 */
  dsh: "linhut/dsh-skills"
} as const;

/**
 * 抄一条技能时的出处写法。**只有这一种句式**：
 * 「改编自 <仓库> 的 <上游那一条>（<说明>）」。
 *
 * 守卫从 `origin` 里取仓库名（第一个 `/` 后面那一段），再去正文里找同一段——
 * 两处对不上，说明出处只写了一半，而用户读到的恰恰是正文那一句。
 *
 * **许可不写在这里。** 卡片那一行是 `origin · license` 两段拼出来的
 * （见 useExtensionBrowse 的 `sourceLabel`），所以许可一旦再写进 origin 的括号里，
 * 用户看到的就是「…（MIT，钩子技法）· MIT」——同一个词在同一行出现两次。
 * 那是把两个字段各写一遍换来的重复，而用户只会当成排版没排好。
 * 许可的真身是 `MarketSkill.license` 那个字段，它有守卫钉着。
 */
export function fromUpstream(repo: string, item: string, note?: string): string {
  return `改编自 ${repo} 的 ${item}${note === undefined ? "" : `（${note}）`}`;
}

/**
 * 本仓原创的出处。`note` 写清「没抄什么」或「借了本仓的哪条通路」，
 * 让「本仓自有」这句话有可查的内容，而不是一句推不掉也验不了的声明。
 */
export function own(note?: string): string {
  return note === undefined ? OWN : `${OWN}（${note}）`;
}

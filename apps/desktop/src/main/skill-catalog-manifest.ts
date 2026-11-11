import type { MarketSkill } from "@mochen/contracts";
import {
  UPSTREAM,
  UPSTREAM_LICENSE,
  OWN_LICENSE,
  fromUpstream,
  own
} from "./skill-catalog-origins.js";

/**
 * 技能市场内置清单的**元数据**（2026-11-11 数据化：正文搬出代码，这一份只留卡片要用的字段）。
 *
 * 【正文去哪儿了】
 * 二十四条技能的 `skillMd` 原先是 TS 模板字符串，写在本目录的代码里——
 * 模板串里的反引号要转义、prettier 管不到内容、编辑器里没有 markdown 的高亮与预览，
 * 而且每条几十行说明书写在代码常量里，阅读时一半的行是转义符。
 * 现在正文是真数据文件：`skill-catalog-data/bodies/<分类>/<dirName>.md`，
 * 由 `skill-catalog.ts` 经 `import.meta.glob` 在构建期原样读进来拼回 `MarketSkill`。
 * **目录名按分类建**（与 `MARKET_CATEGORIES` 一致）：加一条新技能时落哪个目录没有得选，
 * 与原「按分类拆五份文件」是同一条规矩，只是切分的单位从代码文件变成了数据目录。
 *
 * 【这份清单为什么还是 TS】
 * `origin` 必须经 `skill-catalog-origins.ts` 的 `fromUpstream` / `own` 写出（唯一句式出处），
 * `category` 要吃 `MARKET_CATEGORIES` 的字面量类型——这两样都是**编译期**的约束，
 * JSON 给不了。正文是内容（数据），元数据是结构（代码），各归各位。
 *
 * 【字段与卡片】
 * 卡片显示 `displayName` / `summary` / `category` / `origin · license`，
 * 安装时把 `body` 指向的那份 md 原样写进技能目录。字段由
 * `skill-catalog.test.ts` 的守卫逐条钉着（形状、重名、frontmatter 一致、出处句式、许可）。
 */

/** 清单里的一条。`body` 是正文数据文件在 `bodies/` 下的相对路径，其余字段与 `MarketSkill` 同名。 */
export interface CatalogEntry {
  dirName: string;
  displayName: string;
  summary: string;
  category: MarketSkill["category"];
  origin: string;
  license: string;
  /** 正文数据路径：`<分类>/<dirName>.md`。分类目录与 dirName 文件名的对应由守卫钉死。 */
  body: string;
}

/**
 * 全部内置技能的元数据。**顺序无所谓**（`catalogView` 会按分类序重排），
 * 但条目的排列按分类序走，方便读代码的人对上号。
 */
export const CATALOG_ENTRIES: CatalogEntry[] = [
  // ── 构思 ──
  {
    dirName: "chapter-intent",
    displayName: "落笔前先问清楚",
    summary:
      "动笔之前，用几个问题把这一章「要发生什么、谁想要什么、哪里会失败」问清楚，避免写着写着跑偏。",
    category: "构思",
    origin: fromUpstream(UPSTREAM.dsh, "brainstorming", "源自 obra/superpowers"),
    license: UPSTREAM_LICENSE,
    body: "构思/chapter-intent.md"
  },
  {
    dirName: "open-book-brief",
    displayName: "开书前先把方向钉死",
    summary:
      "开一本书之前先把「写给谁、这本书要解决什么、写到哪儿算完、明确不写什么」四条钉死，后面每一章都拿这四条当尺子量。",
    category: "构思",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "开书的一次性问答"),
    license: UPSTREAM_LICENSE,
    body: "构思/open-book-brief.md"
  },
  {
    dirName: "hook-and-promise",
    displayName: "章首章尾各留一个钩子",
    summary:
      "章尾留一个让读者非看下一章不可的钩子，章首把它兑现掉；两头都写不出来的章节，多半是平的。",
    category: "构思",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "钩子技法"),
    license: UPSTREAM_LICENSE,
    body: "构思/hook-and-promise.md"
  },
  {
    dirName: "character-arc",
    displayName: "给每个人物钉一条动机链",
    summary:
      "给每个主要人物钉一条「他想要什么 → 他愿意付什么代价 → 他不肯跨过哪条线」，每一场戏写之前先对一遍这条链。",
    category: "构思",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "人物设计"),
    license: UPSTREAM_LICENSE,
    body: "构思/character-arc.md"
  },
  // ── 结构 ──
  {
    dirName: "world-rulebook",
    displayName: "把设定写成能照做的规则",
    summary:
      "给这本书的世界写一份「能照着做的规则」——什么能做、什么不能做、越界了会怎样——让作者与模型在同一套约束里写。",
    category: "结构",
    origin: fromUpstream(UPSTREAM.dsh, "writing-skills", "源自 obra/superpowers"),
    license: UPSTREAM_LICENSE,
    body: "结构/world-rulebook.md"
  },
  {
    dirName: "five-step-outline",
    displayName: "五步把大纲搭出来",
    summary:
      "从一句话主线走到一份能开写的卷纲，五步依次定：这段要变什么、谁顶着、阻力在哪、中间过哪几个节点、在哪儿收。",
    category: "结构",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "大纲排布"),
    license: UPSTREAM_LICENSE,
    body: "结构/five-step-outline.md"
  },
  {
    dirName: "chapter-blueprint",
    displayName: "一章的细纲只写一件事：变了什么",
    summary:
      "给每一章写一份四行的细纲：谁在本章推什么、被什么挡、哪几个情节点、停在哪儿。细纲缺了这一章就不要动笔。",
    category: "结构",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "章纲"),
    license: UPSTREAM_LICENSE,
    body: "结构/chapter-blueprint.md"
  },
  {
    dirName: "truth-vs-reader",
    displayName: "作者真相与读者已知，分开记",
    summary:
      "把「故事里真的发生了什么」和「读者到这一章为止看到了什么」分成两份记，角色就不会提前知道答案，伏笔也不会自己掉出来。",
    category: "结构",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "作者真相与读者已知双轨"),
    license: UPSTREAM_LICENSE,
    body: "结构/truth-vs-reader.md"
  },
  {
    dirName: "structure-atlas",
    displayName: "先认结构，再填内容",
    summary:
      "动笔前先把这一段套进一个说得清的结构（三幕、黄金三章、起承转合），并标出每个结构件在本书里对应哪一段。",
    category: "结构",
    origin: fromUpstream(UPSTREAM.novelist, "plot-structures.md 与大纲模板"),
    license: UPSTREAM_LICENSE,
    body: "结构/structure-atlas.md"
  },
  {
    dirName: "short-emotion-engine",
    displayName: "短篇先定读完那一口情绪",
    summary:
      "短篇与长篇的写法不同：先定「读者读完最后一行是什么感觉」，再用一句话的故事核去够它——所有内容为情绪服务，不服务的场景再好看也删。",
    category: "结构",
    origin: fromUpstream(UPSTREAM.ohStory, "story-short-write", "短篇以情绪为目标的写法"),
    license: UPSTREAM_LICENSE,
    body: "结构/short-emotion-engine.md"
  },
  // ── 文风 ──
  {
    dirName: "dialogue-voice",
    displayName: "让人物说话不像一个人",
    summary:
      "给每个主要人物定一句「他绝不会这样说」的忌讳，写对白时先对一遍——人物塌房多半是因为所有人在用同一个腔调说话。",
    category: "文风",
    origin: own("方法参照各小说写作常识，未抄具体文本"),
    license: OWN_LICENSE,
    body: "文风/dialogue-voice.md"
  },
  {
    dirName: "deslop",
    displayName: "把 AI 腔一条条挑掉",
    summary:
      "拿一张已知的 AI 句式清单逐条扫正文——破折号、否定排比、「声音不大，却」、密度过高的「仿佛·一丝·微微」——命中哪条改哪条。",
    category: "文风",
    origin: fromUpstream(UPSTREAM.ohStory, "story-deslop", "本地检查的命中项"),
    license: UPSTREAM_LICENSE,
    body: "文风/deslop.md"
  },
  {
    dirName: "show-not-label",
    displayName: "别替读者下结论",
    summary:
      "把「他很生气」「气氛紧张」这类替读者下结论的句子，换成一件看得见的事——写动作、写物件、写没说出口的那半句。",
    category: "文风",
    origin: fromUpstream(UPSTREAM.novelist, "核心法则「展示而非讲述」"),
    license: UPSTREAM_LICENSE,
    body: "文风/show-not-label.md"
  },
  {
    dirName: "style-handbook",
    displayName: "给这本书立一本文风手册",
    summary:
      "从这本书已经写出来的几段里，拆出你自己的表达习惯——句子长短、标点脾气、叙述距离——写成一本能照着对的手册。",
    category: "文风",
    origin: fromUpstream(UPSTREAM.novelistStation, "风格拆书流程"),
    license: UPSTREAM_LICENSE,
    body: "文风/style-handbook.md"
  },
  {
    dirName: "deslop-structure",
    displayName: "改 AI 味先判删，别把一种腔换成另一种腔",
    summary:
      "标出来的机器味句子先问能不能整句删——多半是解释和注水，删掉不丢东西；删不掉的才润色。再治章末总结体与引号加戏这两种结构级机器味。",
    category: "文风",
    origin: fromUpstream(UPSTREAM.ohStory, "story-deslop", "删除优先与章末收束"),
    license: UPSTREAM_LICENSE,
    body: "文风/deslop-structure.md"
  },
  // ── 校对 ──
  {
    dirName: "continuity-check",
    displayName: "回头核一遍前后",
    summary:
      "写完一卷回头核对时间线、人物状态与未兑现的伏笔，把对不上的地方列成一张待办，而不是自我安慰地说「我记着」。",
    category: "校对",
    origin: own(),
    license: OWN_LICENSE,
    body: "校对/continuity-check.md"
  },
  {
    dirName: "promise-ledger",
    displayName: "伏笔台账：埋了哪些、该在哪一章收",
    summary:
      "给每一笔承诺给读者的东西编一个号，记下埋在哪一章、打算在哪一章回收、还差几章；每次动笔前先看这张表。",
    category: "校对",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "伏笔台账"),
    license: UPSTREAM_LICENSE,
    body: "校对/promise-ledger.md"
  },
  {
    dirName: "read-as-first-reader",
    displayName: "第一次读的人会卡在哪",
    summary:
      "换成第一次读这本书、什么都不知道的人，从第一章读一遍，记下他在哪一段问「等等」——那一段就是要改的地方。",
    category: "校对",
    origin: fromUpstream(UPSTREAM.ohStory, "story-review"),
    license: UPSTREAM_LICENSE,
    body: "校对/read-as-first-reader.md"
  },
  {
    dirName: "pov-audit",
    displayName: "视角守得住吗",
    summary:
      "核一遍这一章：有没有作者知道、角色不知道的事被写进人物心里，有没有该瞒着读者的信息提前漏给读者。",
    category: "校对",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-write", "对话技法与反转工具箱"),
    license: UPSTREAM_LICENSE,
    body: "校对/pov-audit.md"
  },
  {
    dirName: "takeover-audit",
    displayName: "接手一本写到一半的书",
    summary:
      "续写别人的稿子（或自己搁了半年的）之前，先通读做三张盘点表——人物此刻的现状、已经埋下的伏笔、故事停在哪——盘点落进素材再动笔。",
    category: "校对",
    origin: fromUpstream(UPSTREAM.ohStory, "story-import", "先盘点再续写"),
    license: UPSTREAM_LICENSE,
    body: "校对/takeover-audit.md"
  },
  // ── 资料 ──
  {
    dirName: "fact-check",
    displayName: "查清楚再写",
    summary:
      "涉及真实历史、职业细节、地理与技术的段落，先查清楚再下笔，并给出来源——虚构故事里写错一件真事，读者会记住。",
    category: "资料",
    origin: own("工具通道复用本仓已有的联网搜索"),
    license: OWN_LICENSE,
    body: "资料/fact-check.md"
  },
  {
    dirName: "research-crosscheck",
    displayName: "同一件事要两个来源",
    summary:
      "查之前先想清楚「哪些证据会改变这一段的写法」，只查那些；一件事至少两个独立来源，事实、推断、还不知道的三样分开记。",
    category: "资料",
    origin: fromUpstream(UPSTREAM.deepResearch, "deep-research"),
    license: UPSTREAM_LICENSE,
    body: "资料/research-crosscheck.md"
  },
  {
    dirName: "deconstruct-best",
    displayName: "从对标作品里抽技法，不抄句子",
    summary:
      "挑一本你想学的小说，锚着原文把它的情节节点、情绪起伏和写作手法一条条抽出来，攒成自己的模块库——取手法，不取句子。",
    category: "资料",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-analyze", "拆文方法"),
    license: UPSTREAM_LICENSE,
    body: "资料/deconstruct-best.md"
  },
  {
    dirName: "rank-scan-topic",
    displayName: "扫榜看模式，别只看排名",
    summary:
      "动笔前扫市场：用联网搜索看各平台榜单与新书，单本排名只是线索，反复出现的题材组合才是信号——再过一遍「你写得了写不了」的可行性。",
    category: "资料",
    origin: fromUpstream(UPSTREAM.ohStory, "story-long-scan", "扫榜方法"),
    license: UPSTREAM_LICENSE,
    body: "资料/rank-scan-topic.md"
  }
];

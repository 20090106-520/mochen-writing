import { SKILL_PATHS_MAX, type SkillRef } from "@mochen/contracts";

/**
 * 自动选技的**得分逻辑**（2026-10-17，命中的是「一条纯函数、无状态、可单测」这条硬约束）。
 *
 * 【它在系统里的位置——先把边界说清】
 * spec §11 的原文铁律是：技能进上下文的**唯一**通路是「用户显式挂入」。
 * 这一段不碰它：`rankSkills` 只**排序**、只**建议**，产出的是一张「这一轮也许用得上」的清单，
 * 谁也没有被自动挂进上下文。挂入仍然只有那颗「加入当前上下文」钮（`toggleSkillForThread`），
 * 也就是本仓那条「不越过用户批准」——推荐越权挂入就等于替用户改了发给模型的东西。
 *
 * 【为什么判定必须住在可 node 单测的纯函数里】
 * 本仓不引 `@vue/test-utils`、`.vue` 模板零自动化覆盖（spec §15）。打分要是写进模板的
 * `v-if` / `computed`，这套判据就一条用例都咬不住。所以「什么算命中、命中得几分、怎么排」
 * 全在这一个文件里，UI 只 v-for 结果，不许自己再 sort / 再算一遍（铁律 6）。
 *
 * 【三路信号，为什么是这三路】
 * 技能的两枚前置元数据（`SkillRef.stages` / `appliesTo`）是**声明式**的：作者亲手写在
 * frontmatter 里，比任何启发式都可信，所以它们权重最高、且字面精确比对（不做子串）。
 * 关键词是**启发式**：中文没有空格，整句跟说明做子串比对基本落空，所以对指令切**二元字**
 * （两字滑窗），拿它去撞技能的标题与说明——两字恰好是中文内容词的自然长度（「伏笔」
 * 「大纲」「对话」），既能命中又不至于把「这段」「帮我」也当信号。启发式分低、且封顶，
 * 免得一个常见词把一堆技能顶上来。
 *
 * 【它们是正信号，不是闸门】
 * contracts 在 `skillRefSchema` 上已写明 `stages` / `appliesTo`「只作提示，不作闸门」。
 * 所以这里**不给没命中的轴扣分**：一枚没填元数据的技能，照样能靠关键词上榜。
 */

/** 三路信号的分值。抽成一个常量表：界面要说「为什么推荐它」，就得和这里的分值对得上。 */
export const SKILL_PICK_WEIGHTS = {
  /** 技能的 `stage` 命中当前创作阶段名（如「正文」）。最强信号：阶段是作者自己钉的。 */
  stage: 40,
  /** 技能的 `appliesTo` 命中当前文稿类别（如 chapter / material / outline）。 */
  appliesTo: 30,
  /** 指令里每命中一个关键词（二元字）的加分。 */
  keyword: 8
} as const;

/** 关键词一路的封顶：一条常见词只该是「添头」，不该顶掉阶段 / 文稿这两路硬信号。 */
export const KEYWORD_SCORE_CAP = 24;

/** 理由里最多列几个命中关键词——列全了就成了一段词表倾倒，用户要的是「为什么」。 */
export const KEYWORD_REASON_LIMIT = 3;

/** 打一枚技能只看这几个字段。比 `SkillRef` 窄：relPath / source 这些与「该不该推荐」无关。 */
export interface SkillCandidate {
  id: string;
  displayName: string;
  description: string;
  stages: readonly string[];
  appliesTo: readonly string[];
}

/** 从 `SkillRef` 取候选切面——唯一的一处「字段名对齐」，避免调用方手抄一份映射。 */
export function candidateOf(skill: SkillRef): SkillCandidate {
  return {
    id: skill.id,
    displayName: skill.displayName,
    description: skill.description,
    stages: skill.stages,
    appliesTo: skill.appliesTo
  };
}

/**
 * 这一轮的现场。三项全部来自渲染层已经握在手里的数据，**不为此再打一次 IPC**：
 * 阶段名来自 `book.json` 的 activeStage（`activeStageOf`），
 * 文稿类别来自当前活动文稿的 kind，指令就是输入框里正敲的那串字。
 */
export interface SkillPickScene {
  /** 当前创作阶段名（`BookStage.name`，如「正文」）。空串 = 没打开作品 / 没阶段。 */
  stageName: string;
  /** 当前文稿 kind（chapter / outline / character / material / …）。null = 没打开文稿。 */
  docKind: string | null;
  /** 本轮用户指令原文（尚未提交也照样算——推荐要跟着输入框走）。 */
  instruction: string;
  /** 本线程已挂入的技能 id：已在这一轮上下文里的不再重复推荐。 */
  pinned?: readonly string[];
}

/** 一枚技能的推荐读数。 */
export interface SkillPick {
  id: string;
  displayName: string;
  /** 得分越高越该推荐；0 = 一个信号都没命中。 */
  score: number;
  /** 中文理由，逐条说清是哪一路命中（摆给用户看，不是给开发看的）。 */
  reasons: string[];
}

/** CJK 字面（与 `estimateTokens` 同口径）：中日韩表意文字、假名、韩文音节。 */
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g;
/** 拉丁 / 数字词：两字符起（`id`、`web` 这类才够当关键词，单字母不足以成词）。 */
const LATIN_WORD = /[A-Za-z0-9]{2,}/g;

/**
 * 从一段文字里切出「关键词」候选：CJK 二元字 + 拉丁词。
 *
 * **为什么是二元字而不是分词**：中文分词要么引一个词典（本仓不引这种依赖），
 * 要么按标点粗切——而用户敲进输入框的是一整句没标点的口语（「帮我看看伏笔收得怎么样」），
 * 粗切只会切出一个整句，跟技能说明做子串比对必然全落空。两字滑窗是这里唯一不靠词典、
 * 又能命中「伏笔 / 大纲 / 对话」这类内容词的做法；去重后逐条去撞，噪声交给封顶兜住。
 */
export function keywordTokens(text: string): string[] {
  const out = new Set<string>();
  for (const run of text.match(CJK_RUN) ?? []) {
    const chars = [...run];
    for (let i = 0; i + 1 < chars.length; i += 1) out.add(`${chars[i]}${chars[i + 1]}`);
  }
  for (const word of text.match(LATIN_WORD) ?? []) out.add(word.toLowerCase());
  return [...out];
}

/** 关键词撞的靶子：技能的**显示名 + 说明**（不撞正文——正文太大，会把噪音也放大）。 */
function haystackOf(candidate: SkillCandidate): string {
  return `${candidate.displayName}\n${candidate.description}`.toLowerCase();
}

/**
 * 一枚技能的推荐读数（含 0 分）。纯函数：同输入永远同输出，不改动任何入参。
 */
export function skillPickOf(candidate: SkillCandidate, scene: SkillPickScene): SkillPick {
  const reasons: string[] = [];
  let score = 0;

  // ① 阶段：字面精确比对。技能声明了「正文」而当前正是「正文」才算命中——
  //    不做子串（「正文改写」不该被当前「正文」算中，那是两码事）。
  if (scene.stageName !== "" && candidate.stages.includes(scene.stageName)) {
    score += SKILL_PICK_WEIGHTS.stage;
    reasons.push(`阶段「${scene.stageName}」匹配`);
  }

  // ② 适用文稿：同上，精确比对。没打开文稿这一路静默（不是「不匹配」的扣分）。
  if (scene.docKind !== null && candidate.appliesTo.includes(scene.docKind)) {
    score += SKILL_PICK_WEIGHTS.appliesTo;
    reasons.push(`适用文稿 ${scene.docKind} 匹配`);
  }

  // ③ 关键词：命中条数 × 单价，封顶。命中 0 条则不产生理由（不摆一句空的）。
  const haystack = haystackOf(candidate);
  const hits = keywordTokens(scene.instruction).filter((token) => haystack.includes(token));
  if (hits.length > 0) {
    score += Math.min(KEYWORD_SCORE_CAP, hits.length * SKILL_PICK_WEIGHTS.keyword);
    const shown = hits
      .slice(0, KEYWORD_REASON_LIMIT)
      .map((one) => `「${one}」`)
      .join("");
    reasons.push(`命中关键词${shown}`);
  }

  return { id: candidate.id, displayName: candidate.displayName, score, reasons };
}

/**
 * 排序 + 取前 N。**这是本模块唯一的分派入口**：界面拿到的就是排好序、去好重、截好数的清单，
 * 不许自己再 filter / sort 一次（重算就是第二份判据）。
 *
 * 四条判定：
 * 1. **排除已挂入**：已经在这一轮上下文里的技能不再推荐——推荐一枚用户刚挂上的技能是废话。
 * 2. **只留正分**：0 分一个都不给。空场上榜等于把整个技能库倒给用户，那不是「推荐」。
 * 3. **同分按 id 升序**：同输入必须同输出（可测），也不能让列表顺序随对象身份抖。
 * 4. **同分不切档**（`keepTies`，2026-11-12，只给自动挂入用）：截到第 limit 条时，
 *    如果下一条与它**得分相同**，一并收下，直到遇到底一档的分数为止；硬上限是
 *    `SKILL_PATHS_MAX`。
 *
 * 【第 4 条为什么存在、又为什么要开关】原先一律 `slice(0, limit)`，而自动挂入的 limit 是 3、
 * 出厂四条审校技能（一致性 / 剧情 / 逻辑 / 文风）在同一本新书里得分完全相同——于是
 * 「取前 3」实际是按**id 字典序**淘汰第四条：`check-style` 排第四，去 AI 味那条技能
 * **从来没被自动挂上过**，而且没有任何征兆。同分时谁该出局，这个问题没有答案；
 * 没有答案就不该假装有答案去砍一条。
 *
 * 但这条规则不能无条件生效：`skillRecommendations({ limit: 3 })` 是**调用方显式**要三条，
 * 把它撑成十二条就是不听人话。所以做成开关——自动挂入打开（那里 limit 是产品默认值，
 * 不是谁的明确要求），其余场景关着，`slice` 的老语义一字不改。
 *
 * N 默认取技能挂入上限（`SKILL_PATHS_MAX` = 12）：推荐再多也超不过一轮能挂的数。
 * N ≤ 0 时返回空表——**不是**「给全部」（`Array.slice` 的负数语义是「从末尾切」，不能照抄）。
 *
 * 【hardCap 是给自动挂入的预算闸（2026-11-24）】keepTies 的扩容上限原来写死
 * `SKILL_PATHS_MAX`——它只数**自己榜上的**条数，不知道调用方手上已经挂了多少。
 * 自动挂入的 `desired` = 手动已挂 ∪ 榜单，于是「手动挂了 10 条 + 四条同分扩到 12」
 * 会把清单撑到 22 条：这一轮 startTurn 在边界上被 `skillPathsSchema.max(12)`
 * 整轮拒收——表现正是「消息发不出去，AI 完全不动」。所以自动挂入把
 * `SKILL_PATHS_MAX − 手动已占` 的预算递进来，同分扩到预算为止；其余调用方
 * 不传、拿老语义。
 */
export function rankSkills(
  candidates: readonly SkillCandidate[],
  scene: SkillPickScene,
  limit: number = SKILL_PATHS_MAX,
  pinned: readonly string[] = scene.pinned ?? [],
  keepTies = false,
  hardCap: number = SKILL_PATHS_MAX
): SkillPick[] {
  if (limit <= 0) return [];
  const pinnedSet = new Set(pinned);
  const ranked = candidates
    .filter((candidate) => !pinnedSet.has(candidate.id))
    .map((candidate) => skillPickOf(candidate, scene))
    .filter((pick) => pick.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"));
  if (!keepTies) return ranked.slice(0, limit);

  const cap = Math.min(hardCap, SKILL_PATHS_MAX);
  const out: SkillPick[] = [];
  for (const pick of ranked) {
    if (out.length >= cap) break;
    // 已经够 N 条，而这一条分数更低 ⇒ 换档了，到此为止。
    // 同分则继续收：同分档里没有「谁更该进」的依据，砍掉哪一条都是随机淘汰。
    const last = out[out.length - 1];
    if (out.length >= limit && last !== undefined && pick.score < last.score) break;
    out.push(pick);
  }
  return out;
}

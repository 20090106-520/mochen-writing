import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_FLAVOR_ANTITHESIS_LABEL,
  AI_FLAVOR_DIALOGUE_TAG_LABEL,
  AI_FLAVOR_GATE,
  AI_FLAVOR_SIMILE_LABEL,
  AI_FLAVOR_STRUCTURE_MIN_COUNT,
  DEFAULT_STAGE_NAME,
  SENTENCE_START_REPEAT,
  SKILL_FILE_NAME
} from "@mochen/contracts";

/**
 * 内置技能（2026-10-23，用户裁定）：首次启动把这一批写成**全局技能**落盘到
 * `<appData>/…/skills/<dirName>/SKILL.md`，之后它们与用户自己放的技能、技能市场装的技能
 * 走完全同一套（技能库可浏览/挂入、`use_skill` 工具可自选、用户可删可改）。
 *
 * 【为什么不走内存内置】内存内置要给 `skillService.list/read` 加一条「不在盘上也读得到」的
 * 特例分支，等于在「技能都在盘上」这条既有契约上凿一个洞；落盘之后零特例。
 *
 * 【为什么是这四条】原来左栏「审核检查」组那四项（一致性/剧情/逻辑/文风）只是把一句话预填进
 * 对话框——用户裁定它应该归到「对话框的技能里面」。做成技能之后，模型可以在需要审校时
 * 经 `use_skill` 自己把对应那份载进来照着做，用户也可以在技能库手选挂入。
 *
 * 【与技能市场的关系】它们**不进** `SKILL_CATALOG`（那是「可安装」的目录）：这一批是
 * 「已经装好的」，落盘即出现在技能库里；摆进市场只会多一排「已装」的噪声。
 *
 * 【升级（2026-11-12）】原先只写「文件不存在」的那一份——于是**出厂技能一旦落盘就永久冻结**：
 * 改正文等于只对全新安装生效，老用户手上永远是第一版。现在每个技能带一个版本号，
 * 同目录写一枚 `.mochen-builtin.json` 记「这一份是谁写的、写完时正文的 sha」：
 * - 盘上正文 === 当前出厂正文 ⇒ 不动（已经是最新，不必重写）；
 * - 盘上正文 === 元数据里的 sha（说明是某次出厂写的、用户没动过）⇒ 覆盖成最新；
 * - 盘上正文与元数据里的 sha **不一样** ⇒ 用户改过 ⇒ 一律不动（这是他的技能，不是我们的）；
 * - 没有元数据 ⇒ 只认 v0 出厂正文的 sha（见 `LEGACY_SKILL_SHA`），认不出就当用户自己写的。
 * 版本号**不参与判定**——它原先参与过，等于把「改正文记得 bump version」变成人肉约定，
 * 忘一次就静默冻结（与旧实现同一类病，只换了触点）。
 * 用户在技能库里改过、删过的那几份都不会被「好心」改回去。
 */

export interface BuiltinSkill {
  /** 目录名，与用户技能同形（单层目录 + SKILL.md）。 */
  dirName: string;
  /**
   * 出厂版本号。**不参与升级判定**（判据是正文 sha，见 `builtinActionOf`），
   * 只在元数据里留一个人看得懂的「这是第几版」，并挡住「回退安装时把盘上更新的正文盖掉」。
   */
  version: number;
  /** SKILL.md 全文（frontmatter + 正文）。 */
  skillMd: string;
}

/** 出厂元数据（`.mochen-builtin.json`）。正文 sha 只取前 12 位——够认人，不必扛完整摘要。 */
export interface BuiltinMeta {
  dirName: string;
  version: number;
  sha: string;
}

const META_FILE_NAME = ".mochen-builtin.json";

/** 正文指纹：读写两头都走这一处，算法不许各写一份。 */
export function bodyShaOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

/**
 * frontmatter 只用 skill.ts 认得的四个键：name / description / stage / appliesTo。
 * `stage` 填的是**阶段名**（与 `DEFAULT_STAGE_NAME`、市场技能、技能工坊的 placeholder 同口径），
 * 不是阶段 id——`skillPickOf` 拿 `scene.stageName` 做精确比对，填 id 一律不命中。
 */
function skillDoc(input: {
  name: string;
  description: string;
  stage: string;
  body: string;
}): string {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
    `stage: ${input.stage}`,
    "appliesTo: chapter",
    "---",
    "",
    `# ${input.name}`,
    "",
    input.body.trim(),
    ""
  ].join("\n");
}

/**
 * 四条审校技能的公共前言（2026-11-12 压缩，161 字 → 96 字）。
 *
 * 【为什么砍】原版三句话里有两句半是系统提示的复制品：「先 read_doc 读当前章」对应
 * `prompt-assembly` 的「anchor 不确定就先 read_doc」、「真要改就用 propose_patch 提交
 * 替换提案（我批准后才落盘）」对应同处的「改动已有文稿用 propose_patch（给 doc/anchor/
 * replace/why）」——同一份提示词里各说两遍，而四条技能每条都带一份前言，于是这段话
 * 在一次会话里能出现八遍。模型刚读过八遍的句式，就是它写正文时最容易复现的句式。
 *
 * 【「对当前打开的章节」为什么要删】技能可以被挂到人物卡、大纲、世界观上：那时这句
 * 话是错的，模型照它办就会去审一个不存在的「章节」。改成「当前这份」——身份由
 * read_doc 自己给（它读的就是活动文稿），前言不必替它假定。
 *
 * 【「一条都没有就直说」为什么提到前言里】原先一致性检查和逻辑检查各自以
 * 「……的地方。没有发现就明确说「没有发现不一致」」收尾，两句只差中间那个词——
 * 17 个字原样重合。同一条兜底规则说了两遍，正是这一族技能的模板味所在。收上来一次，
 * 各技能只留「这一项到底查什么」。
 *
 * 【剩下三句为什么留】都是技能独有的：**先读原文再评**（系统提示只说了「不确定」才读，
 * 审校是「必须先读」）、**对照设定**（一致性 / 逻辑检查的专属动作）、**输出形状**
 * （逐条：位置 + 为什么 + 怎么改——不写死这个，模型会交一篇读后感）。写入约束不在
 * 这里说：系统提示已有 propose_patch 的口径，而各技能正文里该说的地方自己说。
 */
const PREAMBLE =
  "先 read_doc 读当前这份的原文再评，别凭印象。" +
  "对照设定用 list_docs / search_docs。" +
  "逐条给：原文位置 + 为什么是问题 + 怎么改；一条都没有就直说，别凑数。";

/* ────────────────────────── 文风检查的判据（与系统提示、退稿闸同源） ────────────────────────── */

/**
 * 结构上限 = 起报线 − 1（起报线就是「上限＋1」，见 contracts `AI_FLAVOR_STRUCTURE_MIN_COUNT`）。
 * 技能正文里的数字全部从这里取：手抄一遍的话，哪天闸的阈值改了，技能还在教模型旧的数。
 */
function capOf(label: string): number {
  return (AI_FLAVOR_STRUCTURE_MIN_COUNT[label] ?? 1) - 1;
}

/**
 * 文风检查的正文（2026-11-12 重写）。
 *
 * 【为什么从一句话变成三层】旧版把「去 AI 味」写成六个例子（嘴角勾起、眼底闪过……），
 * 而系统提示里的禁用词表有近百条、退稿闸还会看节奏与句式——技能只教了六分之一，
 * 模型照着技能审完，稿子照样被闸退。现在三层分工写清：用词（词表）/ 句式（有上限的那几条）/
 * 节奏（句首、句长、复读），每层给可执行的判据与改法，数字从 contracts 现取。
 *
 * 【为什么不贴整份词表】词表已经在系统提示里常驻（`AI_FLAVOR_INSTRUCTION` 由
 * `aiFlavorPromptList()` 拼出）。技能再抄一份，改词表时就有两处要改，早晚走岔。
 * 所以这里说「按系统提示里那份禁用词表对」，只把**技能要说的方法**留下来。
 */
function styleBody(): string {
  const antithesis = capOf(AI_FLAVOR_ANTITHESIS_LABEL);
  const dialogueTag = capOf(AI_FLAVOR_DIALOGUE_TAG_LABEL);
  const simile = capOf(AI_FLAVOR_SIMILE_LABEL);
  return [
    PREAMBLE,
    "",
    "本次只看**文风（去 AI 味）**。分三层查，一层一段，别混在一起说：",
    "",
    "一、用词层：拿系统提示里那份禁用词表逐条对（描写套话、议论腔）。" +
      "「缓缓 / 轻轻 / 微微 / 不禁」这类副词不是禁词，是**堆多了才露馅**——同一章里数一遍，说清几处。",
    `二、句式层：这几条有明写的上限——「不是A，是B」式升华对偶一章最多 ${antithesis} 处、` +
      `贴着引号的「××说／说道」最多 ${dialogueTag} 处、明喻（像／仿佛／好像／宛如）最多 ${simile} 处。` +
      "另三类不设数字但要点名：认知转述（「他知道，这不是……」）、情绪直陈（「感到一阵愤怒」）、" +
      "反差模板（「声音不大，却……」）、章末总结体（「他终于明白了」「这一夜，注定无人入眠」）。" +
      `超了就说清第几处、超了几处，并给替换写法。`,
    `三、节奏层（整篇的毛病，不是某一行）：句首复读——同一字开头的句子占到 ${SENTENCE_START_REPEAT.minRatio} 以上就是流水线；` +
      `句长过匀——句长波动低于 ${AI_FLAVOR_GATE.maxSpread}，读起来句句等长；` +
      "整句复读——十二字以上的句子原样出现三次以上。" +
      "这三样的改法是**换起手、拆句并句、换个角度重说**，不是删字凑数——删成电报体是另一台机器写的。",
    "",
    "每处按这个格式给，一处一行：",
    "- 第 N 行：「原文片段」→ 改成「……」",
    "  （为什么：一句话说清。作者可能是有意这么写的，就写「可保留」并说明理由）",
    "",
    "两条不许：不许整章重写（我只要改动清单）；不许只换同义词——" +
      "「嘴角勾起」改成「嘴角上扬」等于没改，要换的是这一处的写法：换动作、换视线的落点、换成具体的物。"
  ].join("\n");
}

/* ────────────────────────── 章尾钩子检查的正文（2026-11-24） ────────────────────────── */

/**
 * 【为什么第五条审校技能是它】对标竞品（马良写作把「章尾检查」列为核心卖点：对照热门
 * 网文的章尾套路）后确认的差距：日更连载的作者最怕的不是写得慢，是章末没钩、读者不点
 * 下一章——而前四条审校技能没有一条看「结尾」。它天然属于这一族：先读原文再评、逐条给
 * 结果，PREAMBLE 一个字不用改。
 *
 * 【与文风检查的边界要亲手写清】「章末总结体」两个技能都会碰：文风查的是它**像 AI**
 * （句式问题），钩子查的是它**没抛问题**（功能问题）。同一个现象两个视角不冲突，
 * 但开头第一句就把这条线画出来，不然模型会报成两条。
 *
 * 【为什么允许弱钩】网文的钩子讲节奏，强弱交替；逼每一章都天崩地裂，读者反而疲劳。
 * 技能只报告事实与建议——这正是这一族「不催不逼、作者拿主意」的口径。
 */
function hookBody(): string {
  return [
    PREAMBLE,
    "",
    "本次只看**章尾的钩子**：读完最后一段，读者想不想点开下一章。句子像不像人写的那归文风检查，这里只看钩子本身。",
    "",
    "一、先判型。读最后两段，说出章尾挂的是哪一类钩，引一句原文作证据：",
    "- 悬念钩：抛出一个没解释的新信息或反常（桌上多了一封信）；",
    "- 危机钩：险境或期限压到头顶（脚步声停在门外）；",
    "- 反转钩：刚确认的事被推翻（她笑着，刀却反握了）；",
    "- 决断钩：角色拍板做一件代价大的事（这一次他不退了）；",
    "- 期待钩：正面冲突被明确预告（明天擂台上见）。",
    "五类都不是，就直说「无钩」，别硬安一个名目。",
    "",
    "二、再判强度。判据只有一条：读者合上时心里有没有一个**必须翻下一章才解得开的问题**。",
    "有 ⇒ 强钩；只有情绪没有新信息 ⇒ 弱钩（疲惫、释然、感慨收尾都是这种）；",
    "总结收尾（把本章内容复述一遍）与日常收尾（吃完饭、睡一觉、道个别）⇒ 无钩。",
    "过渡章允许弱钩与中钩——节奏是作者定的，报告事实与建议，不逼每一章都天崩地裂。",
    "",
    "三、弱钩与无钩才给改法：按前文情节给一到两个候选结尾，一句话、只动最后一段。",
    "候选必须挂在前文已经埋下的东西上（一个没接的电话、一句没说完的话、一个没解释的反常），",
    "不许空降新事件，也不许对读者说话——「欲知后事」「更精彩的在后面」是预告腔，出戏。",
    "",
    "每条按这个格式给：",
    "- 钩型：哪一类（引最后一句原文）｜强度：强 / 中 / 弱 / 无",
    "- 病在哪：一句话",
    "- 候选结尾：「……」（这个钩挂在第几段的哪一处伏笔上）"
  ].join("\n");
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    dirName: "check-consistency",
    version: 2,
    skillMd: skillDoc({
      name: "一致性检查",
      description: "对照人物、设定与剧情，指出当前章前后矛盾或与设定不符之处；没有就明说没有。",
      stage: DEFAULT_STAGE_NAME,
      body:
        PREAMBLE +
        "\n\n本次只看**一致性**：找出与已有的人物卡、世界观、时间线、伏笔相矛盾或前后不一致的地方。"
    })
  },
  {
    dirName: "check-plot",
    version: 2,
    skillMd: skillDoc({
      name: "剧情审核",
      description: "评估当前章情节推进是否合理、节奏与冲突是否成立、伏笔与回收是否妥当。",
      stage: DEFAULT_STAGE_NAME,
      body:
        PREAMBLE +
        "\n\n本次只看**剧情**：评估情节推进是否合理、节奏与冲突是否成立、伏笔埋设与回收是否妥帖，" +
        "并给出具体的修改建议（哪一段、改成什么方向）。"
    })
  },
  {
    dirName: "check-logic",
    version: 2,
    skillMd: skillDoc({
      name: "逻辑检查",
      description: "找出当前章因果链断裂、动机不足、时间线对不上的地方；没有就明说没有。",
      stage: DEFAULT_STAGE_NAME,
      body: PREAMBLE + "\n\n本次只看**逻辑**：找出因果链断裂、人物动机不足、时间线对不上的地方。"
    })
  },
  {
    dirName: "check-style",
    version: 3,
    skillMd: skillDoc({
      name: "文风检查",
      description: "按用词、句式、节奏三层找当前章的 AI 腔与套话句式，逐处给出更像人写的改法。",
      stage: DEFAULT_STAGE_NAME,
      body: styleBody()
    })
  },
  {
    dirName: "check-hook",
    version: 1,
    skillMd: skillDoc({
      name: "章尾钩子检查",
      description: "评估当前份的结尾钩子：属于哪类钩、强度如何，弱了就按前文伏笔给候选结尾。",
      stage: DEFAULT_STAGE_NAME,
      body: hookBody()
    })
  }
];

/**
 * v0 出厂正文的指纹（那时还不写元数据）。
 *
 * 【为什么留着这几枚数】v1 之前的四个技能早就落进了用户盘上，正文里没有版本信息可读。
 * 没有这张表，升级逻辑只能二选一：要么把老文件当「用户自己写的」永不升级（那这次改进
 * 对老用户等于没做），要么无差别覆盖（把用户改过的那份也冲掉）。有了它就能只认
 * 「逐字等于当年出厂原文」的那一份——多一个字、少一个字都不动。
 *
 * 【以后还要不要加】不用。v1 起每个技能都带 `.mochen-builtin.json`，升级靠元数据里的 sha；
 * 这张表是**一次性**的迁移依据，不再增长。
 */
export const LEGACY_SKILL_SHA: Readonly<Record<string, readonly string[]>> = {
  "check-consistency": ["cb86c96361f6"],
  "check-plot": ["f4b5a627b3f6"],
  "check-logic": ["4fa69e807497"],
  "check-style": ["d17c4af9066b"]
};

export type BuiltinAction = "write" | "upgrade" | "keep";

export interface BuiltinState {
  /** 盘上 SKILL.md 的全文。 */
  content: string;
  /** 同目录的出厂元数据；null = 没有（v0 出厂的那批，或用户自己写的同名技能）。 */
  meta: BuiltinMeta | null;
}

/**
 * 这一次该对这个技能做什么（纯判定，IO 在 `seedBuiltinSkills` 里）。
 *
 * 判定顺序就是头注释里那几条，一条不多：写得越聪明，越容易把用户的手改冲掉。
 *
 * 【为什么升级不再看版本号（2026-11-12）】原先是「meta.version < skill.version 才升级」——
 * 那就把「改正文时记得把 version 加一」变成一条**人肉约定**：忘一次，老用户手上的技能就
 * 永远停在旧版，而且没有任何征兆（作者改的是对的，用户看到的是旧的）。这跟上一版
 * 「只在文件不存在时写一次」是同一类病，只是把触点从「文件在不在」换成「数字加没加」。
 * 现在判据回到正文本身：盘上那份**是不是出厂的原文**（与当前出厂正文比 sha），
 * 是且不是最新 ⇒ 用户没动过、直接覆盖成最新；不是 ⇒ 用户改过、一个字不动。
 * version 只留在元数据里做人看，不参与判定。
 *
 * 唯一保留版本号的地方是「盘上比当前还新」这一格：装了新版又回退到旧版安装包时，
 * 不该把用户的技能倒退回旧正文。
 */
export function builtinActionOf(
  skill: BuiltinSkill,
  state: BuiltinState | null,
  legacy: Readonly<Record<string, readonly string[]>> = LEGACY_SKILL_SHA
): BuiltinAction {
  if (state === null) return "write";
  const sha = bodyShaOf(state.content);
  if (state.meta !== null) {
    // 已经是这一版出厂的正文：没有要做的。
    if (sha === bodyShaOf(skill.skillMd)) return "keep";
    // 盘上与「出厂写它时的指纹」不同 ⇒ 用户改过 ⇒ 一个字不动。
    if (sha !== state.meta.sha) return "keep";
    // 盘上是更晚的一版（装了新版又回退旧安装包）：不倒退。
    if (state.meta.version > skill.version) return "keep";
    return "upgrade";
  }
  // 没有元数据：只可能是 v0 出厂（当年没写元数据）或用户自己写的同名技能。
  const known = legacy[skill.dirName] ?? [];
  return known.includes(sha) ? "upgrade" : "keep";
}

/** 读同目录的元数据。坏文件/缺字段一律当没有——一份读不回的元数据不该让技能整条消失。 */
function parseMeta(raw: string, dirName: string): BuiltinMeta | null {
  try {
    const data = JSON.parse(raw) as Partial<BuiltinMeta>;
    if (typeof data.version !== "number" || typeof data.sha !== "string") return null;
    if (data.dirName !== dirName) return null; // 目录被改过名：不认，当用户自己的技能。
    return { dirName, version: data.version, sha: data.sha };
  } catch {
    return null;
  }
}

/** 读元数据：读不到/坏文件都当没有（返回 null），不抛——一份坏元数据不该让技能整条消失。 */
async function readMeta(dir: string, dirName: string): Promise<BuiltinMeta | null> {
  try {
    return parseMeta(await readFile(path.join(dir, META_FILE_NAME), "utf8"), dirName);
  } catch {
    return null;
  }
}

/** 读一遍现状：SKILL.md 读不到就是 null（含目录不存在）。 */
async function readState(dir: string, dirName: string): Promise<BuiltinState | null> {
  let content: string;
  try {
    content = await readFile(path.join(dir, SKILL_FILE_NAME), "utf8");
  } catch {
    return null;
  }
  return { content, meta: await readMeta(dir, dirName) };
}

async function writeOne(dir: string, skill: BuiltinSkill): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, SKILL_FILE_NAME), skill.skillMd, "utf8");
  const meta: BuiltinMeta = {
    dirName: skill.dirName,
    version: skill.version,
    sha: bodyShaOf(skill.skillMd)
  };
  await writeFile(path.join(dir, META_FILE_NAME), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

/**
 * 把内置技能落到全局 skills 目录：缺的写、旧版出厂升级、用户改过的只读不动。
 * 返回本次真正动过手的 dirName（`written` 全新写入，`upgraded` 出厂升级），供测试与日志。
 */
export async function seedBuiltinSkills(
  skillsDir: string
): Promise<{ written: string[]; upgraded: string[] }> {
  const written: string[] = [];
  const upgraded: string[] = [];
  for (const skill of BUILTIN_SKILLS) {
    const dir = path.join(skillsDir, skill.dirName);
    const action = builtinActionOf(skill, await readState(dir, skill.dirName));
    if (action === "keep") continue;
    await writeOne(dir, skill);
    (action === "write" ? written : upgraded).push(skill.dirName);
  }
  return { written, upgraded };
}

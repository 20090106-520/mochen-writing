import {
  DIALOGUE_BALANCE,
  WEB_SEARCH_TOOL_NAME,
  WEB_READ_TOOL_NAME,
  WORK_MODE_LABELS,
  analyzeAiFlavor,
  dialogueBalance,
  dialogueVerdict,
  sentencesOf,
  styleProfileOf,
  type AgentProfile,
  type DocRef
} from "@mochen/contracts";
import type { AssembledContext } from "@mochen/agent-runtime";
// 对话回复口径（2026-11-10 拆到 prompt-dialogue.ts，理由见那边的文件头——
// 这一段连注释三十来行，留在本文件里当场 814 行，破了 800 行预算）。
// 从这里转出去，原来从 prompt-assembly 引它的地方不必改。
import { DIALOGUE_REPLY_INSTRUCTION } from "./prompt-dialogue.js";
// 写正文那七段（2026-11-12 拆到 prompt-craft.ts，理由见那边的文件头）：
// 补上公共前言与去重之后本文件当场 819 行，破了 800 行预算。从这里转出去，
// 原来从 prompt-assembly 引它们的地方不必改。
import {
  AI_FLAVOR_INSTRUCTION,
  DE_AI_FLAVOR_STRUCTURE_INSTRUCTION,
  DETAIL_AND_BEAT_INSTRUCTION,
  HUMAN_CRAFT_INSTRUCTION,
  HUMAN_DIALOGUE_INSTRUCTION,
  NARRATIVE_CRAFT_INSTRUCTION,
  QUALITY_INSTRUCTION,
  WRITING_CRAFT_LEAD
} from "./prompt-craft.js";

export {
  AI_FLAVOR_INSTRUCTION,
  DE_AI_FLAVOR_STRUCTURE_INSTRUCTION,
  DETAIL_AND_BEAT_INSTRUCTION,
  DIALOGUE_REPLY_INSTRUCTION,
  HUMAN_CRAFT_INSTRUCTION,
  HUMAN_DIALOGUE_INSTRUCTION,
  NARRATIVE_CRAFT_INSTRUCTION,
  QUALITY_INSTRUCTION,
  WRITING_CRAFT_LEAD
};

/**
 * 提示词装配（2026-10-08 从 agent-service.ts 拆出）。
 *
 * 拆的理由只有一个、而且是硬的那种：agent-service.ts 贴着 800 行的行数预算
 * （tools/check-source-line-budget.mjs，超限门禁直接红）。这里放的是「把一轮的现场
 * 排成一段人读的话」那半件事，跟服务编排（跑 turn、管会话、裁决提案）没有共享状态，
 * 分开后两边都能各自长大。approval-read.ts、plugin-host.ts 是为同一道预算拆出去的。
 */

/** 这本书现在的规模：文稿总篇数、其中正文的章数、正文合计字数。 */
export interface BookCounts {
  docs: number;
  chapters: number;
  /** 剥掉 frontmatter 后的非空白码点合计（与 DocRef.chars 同源）。 */
  proseChars: number;
}

/** 装配一段系统提示词需要的全部现场——少任何一项都会拼出一段说错话的提示词。 */
export interface PromptContext {
  title: string;
  stageName: string;
  chapter: DocRef | null;
  permissionLabel: string;
  /** 工作模式（2026-10-05 批次 4）：`plan` 时追加「先讲打算，别动稿」那一段。 */
  workModeLabel: string;
  /** 解析出来的智能体档案（spec §5.1）。它的 prompt 决定这一轮的人设与写入范围上限。 */
  profile: AgentProfile;
  /** 装配好的上下文包（正文已切片）。渲染成提示词块的那一份。 */
  context: AssembledContext;
  /**
   * 这一轮联网搜索开关（2026-10-08）。
   *
   * 提示词必须跟着它走：关掉时出站 tools 里根本没有 `web_search`（映射在 wireToolsFor），
   * 再教模型「联网搜索用 web_search」就是让它去调一枚不存在的工具，换来一句「没有这个工具」。
   */
  webSearchEnabled: boolean;
  /**
   * 这本书现在的规模（2026-11-12）：文稿总篇数与其中正文的章数。
   *
   * 【为什么要进提示词】真机会话里翻到的：一本完全空的书上，模型连着调了
   * `book_outline` / `book_cast` / `list_docs` 三枚工具，三个都回「这本书还没有文稿」，
   * 它才开口——回复的第一段是「这本书目前是空的。没有大纲、没有人物、没有世界观」。
   * 那一段本质是**在向用户汇报自己刚做了什么检查**，而那正是对话里最重的那层 AI 腔；
   * 三枚工具的往返也是白烧的：这件事系统提示一句话就能说清。
   *
   * 可选：老夹具不给我这一格，就当「不知道规模」——宁可少一句，也不要凭空报一个 0。
   */
  bookCounts?: BookCounts;
}

/**
 * 从 scanBook 的完整 DocRef 上数书稿规模（2026-11-12）。
 *
 * 【为什么不放在装配层】`assembleContext` 收的 docs 是精简形状（relPath/kind/title/opening），
 * 压根没有 `chars`；而「空不空」要按正文字数判，只有 `DocRef.chars`（剥 frontmatter 后的
 * 非空白码点）是准的。装配结果描述的是「这一轮装进上下文的东西」，也不该夹带整本书的元信息。
 * 放在这儿，agent-service 只多一行调用，不必为 800 行预算把同一段 reduce 抄两份。
 */
export function bookCountsOf(docs: readonly Pick<DocRef, "kind" | "chars">[]): BookCounts {
  return {
    docs: docs.length,
    chapters: docs.filter((doc) => doc.kind === "chapter").length,
    // chars 缺省一律当 0：老书 / scan 读不到的文稿，宁可判「没内容」，不可凭空报一个字数。
    proseChars: docs.reduce((sum, doc) => sum + (doc.chars ?? 0), 0)
  };
}

/**
 * 书稿规模那一句（2026-11-12）。
 *
 * 空书刻意写成一句**指令**而不是一句陈述：只说「这本书现在是空的」，模型照样会去确认一遍
 * （它不信任提示词里的现状描述）；点明「别再调工具确认」并给出下一步该问什么，它才会直接开口。
 * 有文稿时只报数——那时 `list_docs` 是它真要看清单，不该拦。
 *
 * 【「空」按字数判，不按篇数】用户点两下「新建章节」文件夹里就有文件了，内容仍是零字——
 * 按篇数判会说「有 3 篇文稿」，模型于是 read_doc 一篇篇读回来，读到的全是空白。
 */
export function bookScaleSentence(counts: BookCounts | undefined): string {
  if (counts === undefined) return "";
  if (counts.proseChars === 0) {
    return counts.docs === 0
      ? "这本书现在一篇文稿都没有（空书）。别再调工具去确认有没有文稿——" +
          "直接问用户想从哪儿开始：先定方向、先搭卷纲与人物，还是直接写第一章。"
      : `这本书现在有 ${counts.docs} 篇文稿，但都还没有内容（合计 0 字）。` +
          "别再挨篇读一遍确认——直接问用户想从哪儿开始。";
  }
  return `这本书现在有 ${counts.docs} 篇文稿，其中正文 ${counts.chapters} 章。`;
}

/**
 * 计划模式那一段的措辞（2026-10-05 批次 4）。
 *
 * 为什么要单独一段而不是只靠 writeVerdict 拦：闸只在**模型已经想动手**的时候才拦得住，
 * 而模型是看不到闸的。不先告诉它「这一轮别动稿」，它会照常起草再吃一个拒，
 * 然后换个写法重试几轮——白白烧 token，还把对话搅浑。
 *
 * 这段话的落点必须是**可批准的东西**：改哪几篇、每篇改什么、为什么。
 * 只说「别写」模型会转而输出一段散文式的建议，用户批不了。
 */
export const PLAN_MODE_INSTRUCTION =
  "这一轮是「先计划」：不要写入、不要提改动方案，只把打算讲清楚——" +
  "要改哪几篇文稿、每一篇具体改什么、为什么这么改，以及有没有你不确定的地方。" +
  "用编号列出，等用户批准后才会真正落盘。";

/**
 * 联网那段措辞（只在开关打开时进提示词）。
 *
 * 工具名从 contracts 拼，不手抄字符串：提示词里教的名字和出站 tools 里那枚 function
 * 的名字必须是同一个真身，否则模型照着提示词调一枚不存在的工具。
 * 2026-10-11 起 出网两枚：web_search 拿清单，web_read 读其中一条的正文——
 * 两枚一起教，教清分工（先搜后读），模型才不会拿搜索摘要冒充全文。
 */
export const WEB_SEARCH_INSTRUCTION =
  `联网搜索用 ${WEB_SEARCH_TOOL_NAME}（免费源）：query 用 2–4 个关键词（例：「漕运制度」「科幻 黑暗森林 设定」），` +
  "别把整句问题原样塞进去——源只认开头的词，整句会被拆成词义查询，回来的资料跟问题对不上。" +
  `需要某一条来源的正文时用 ${WEB_READ_TOOL_NAME} 读它（url 传搜索结果里的链接，只收 http/https；` +
  "同一页读完不必重复读）。搜到的资料要保存时，整理成文稿写进 materials/ 或 skills/。";

/**
 * 角色约束（2026-10-22）：把人物卡上写明的两格念给这一轮——专属说法与退场章。
 *
 * 为什么值得一段：`QUALITY_INSTRUCTION` 第 4 条只说「对话要贴人物卡」，可人物卡上的
 * `voice` / `exit` 是**frontmatter**，装配时已被剥掉，模型根本看不见——写出来的对话
 * 于是只照本书语感样本，不照这个人。这里把作者声明过的东西原样念出来，不新增任何推断。
 *
 * 两条纪律写进段里：专属说法**只在他说的话里用**（别人说不算），退场之后要写他
 * **得交代清楚是谁在回忆/转述**（那是作者的合法选择，不是禁止）。没有声明就不注入空段。
 */
export function castConstraintSentence(assembled: AssembledContext): string {
  const notes = (assembled.characterNotes ?? []).filter(
    (note) => note.voice.length > 0 || note.exit !== ""
  );
  if (notes.length === 0) return "";
  const lines = notes.map((note) => {
    const parts: string[] = [];
    if (note.voice.length > 0) {
      parts.push(
        `专属说法：${note.voice.map((one) => `「${one}」`).join("、")}` +
          "——只在他自己说的话里用，别让别的角色也这么说"
      );
    }
    if (note.exit !== "") {
      parts.push(
        `已在「${note.exit}」退场——之后不要再让他当场出场；` +
          "回忆、转述、别人提起都可以，但要在文中写清是谁在提"
      );
    }
    return `- ${note.title}：${parts.join("；")}。`;
  });
  return (
    "角色约束（这一轮上下文里的人物卡上作者写明的，写对话与安排出场时照这个来）：\n" +
    lines.join("\n") +
    "\n这些是作者自己定的，不是建议：和你的临场想法冲突时按它写。"
  );
}

/**
 * 本书套话回流（2026-10-10 三段）：把体检真身跑在**已装配的上下文**上，
 * 拿这本书自己的高频命中点名叮嘱——词库管的是「天下通病」，这段管的是「这本书的病」。
 *
 * 为什么跑在 assembled.items 上：上下文包里装的就是当前章正文、前情尾部、人物卡等
 * 也就是这一轮模型真正看得见的文字——它刚看过的写法就是它最容易模仿的写法，
 * 点名避开这些，比抽象说「别重复」有用得多。没有命中就返回空串（不注入空段）。
 */
export function bookFlavorSentence(assembled: AssembledContext): string {
  const report = analyzeAiFlavor(assembled.items.map((item) => item.text));
  const top = report.entries.slice(0, 5);
  if (top.length === 0) return "";
  return (
    "本书写法提醒（扫描自上下文，括号内是出现次数）：下面这些写法在书里已经用多了——" +
    top.map((entry) => `${entry.term}（${entry.count} 次）`).join("、") +
    "；你写新内容时避开它们，或换成别的写法。复读用滥的词句是最显眼的机器味。"
  );
}

/**
 * 各章开头防套路回流（2026-10-10 四段）：把已写各章的开头句点名摆出来，
 * 叮嘱新内容换进法。AI 连写多章最显眼的流水线味就是「每章都从同一种起手式进入」
 * （夜色深沉/雨下个不停/××睁开眼），不点名它自己意识不到。少于 2 章不注入——
 * 一章谈不上「套路」，两章起步才叫模式。
 */
export function openingsSentence(openings: readonly string[]): string {
  if (openings.length < 2) return "";
  const shown = openings
    .slice(-5)
    .map((line) => `「${line}」`)
    .join("、");
  return (
    `前面各章的开头分别是：${shown}。写新内容时开头**换一种进法**` +
    "（从对话进入、从动作进入、从声音进入、从一个具体物件进入），" +
    "别每一章都用同一套起手式——连续几章一个套路开头，读者一眼就看穿是流水线。"
  );
}

/**
 * 对话占比反馈（2026-10-10 五段）：正文过话痨或过闷都给一句提醒。
 *
 * 为什么值得喂给模型：全是对话的章没有呼吸（动作、环境、内心全缺席），
 * 全是叙述的章没有戏——这是编辑看稿的第一指标，但模型自己没有「本章说了多少话」
 * 的感觉，量出来了它才知道要往哪边找补。只统计 chapter 类条目（人物卡里的对话不算）；
 * 上下文不足 500 字不判定（样本太少）；占比在 0.03~0.65 之间是常态，不吭声。
 *
 * 2026-10-11 起：占比的量与判线真身下沉 contracts/dialogue（dialogueBalance + dialogueVerdict），
 * 与体检第六类「对话占比」同一份口径——这里只负责把判读说成人话。
 */
export function dialogueBalanceSentence(assembled: AssembledContext): string {
  const text = assembled.items
    .filter((item) => item.kind === "chapter")
    .map((item) => item.text)
    .join("\n");
  const balance = dialogueBalance(text);
  if (dialogueVerdict(balance) !== "dense" && dialogueVerdict(balance) !== "silent") return "";
  const percent = Math.round(balance.ratio * 100);
  if (balance.ratio > DIALOGUE_BALANCE.denseRatio)
    return (
      `对话占比提醒：当前上下文里对话占了约 ${percent}%——话太密了。` +
      "往对话之间垫进动作、环境与内心节拍（谁在做什么、屋子什么样、空气什么味道），" +
      "别让一整章只剩你一句我一句。"
    );
  return (
    `对话占比提醒：当前上下文里几乎没有对话（约 ${percent}%）——全是叙述，戏出不来。` +
    "想想这一场有没有能让人物开口的交锋，用对话推进关系与冲突。"
  );
}

/**
 * 本书腔调摘要（2026-10-19 六段 · P0-③）：把技能库《给这本书立一本文风手册》
 * （`skill-catalog-data/bodies/文风/style-handbook.md`）的六维拆法里**量得出来的四维**
 * ——句子长度、标点脾气、对白与叙述比例、每段的收法——从已完稿正文现量出来喂给这一轮。
 *
 * 为什么值得下沉：技能原文治的是长篇最常见的退化——「每一章都在写好，于是每一章都不像前面那些章」。
 * 但那份手册此前只是「用户手动挂进技能栏才生效」的技能，默认那一轮模型根本看不见它。
 * 与另三段动态段的分工：`bookFlavorSentence` 管「避开书里用滥的写法」（向下拉）、
 * `openingsSentence` 管「开头换进法」（防流水线）、`dialogueBalanceSentence` 只在这章过密／全叙述时出声；
 * 这一段报的是**这本书自己的常态**，叮嘱保持（防漂移）——常态不吭声的三段管不着「这一章和前二十章不像」。
 *
 * 两条纪律必须写进段里，缺哪条都会反噬：
 * ① 手册只描述这本书自己的句子，**不许变成「优秀小说的写法」**（技能原文的纪律）；
 * ② 与上面那六段文风硬约束冲突时**硬约束优先**——否则模型会拿「本书习惯」当免死金牌去写禁句式。
 * 量不出来的两维（叙述距离、冲突戏写情绪还是动作）如实说「本段不报」，不硬凑一个数（§一百零五 取舍）。
 * 样本不足（非空白不足 500 字）返回空串：开书之前没有样本可拆，不注入空段。
 */
export function styleProfileSentence(assembled: AssembledContext): string {
  const profile = styleProfileOf(
    assembled.items.filter((item) => item.kind === "chapter").map((item) => item.text)
  );
  if (profile === null) return "";
  const parts: string[] = [];
  if (profile.rhythm !== null)
    parts.push(
      `句子平均 ${profile.rhythm.mean} 字、句长波动 ${profile.rhythm.spread}` +
        "（0.9 上下算有起伏，0.3 以下偏匀）"
    );
  parts.push(
    `标点脾气：每千字约 ${profile.punctuation.dash} 处破折号、` +
      `${profile.punctuation.semicolon} 处分号、${profile.punctuation.ellipsis} 处省略号`
  );
  parts.push(`对白约占 ${Math.round(profile.dialogueRatio * 100)}%（引号内字数占正文）`);
  if (profile.endsOnQuote.total > 0) {
    const { count, total } = profile.endsOnQuote;
    parts.push(`收在台词上的段落 ${count}/${total} 段（约 ${Math.round((count / total) * 100)}%）`);
  }
  return (
    "本书腔调摘要（从已完稿正文实测；这是这本书自己的习惯，不是「优秀小说该有的样子」）：" +
    parts.join("；") +
    "。写新内容时保持同一腔调——句长别忽然整齐、标点别忽然换一套、对白比例别大幅偏离；" +
    "写完拿这几条对一遍，对不上的先分清是「这一章不适合这条（那就算一次例外）」还是「跑偏了」。" +
    "交稿时系统还会拿这一稿跟这份读数再比一次：偏得厉害会把偏离项写进回执（不拦稿，只报数）。" +
    "与上面的文风硬约束冲突时硬约束优先：那是下限，这条只是这本书自己的习惯。" +
    "叙述距离、冲突戏写情绪还是写动作，这两样读不出来，本段不报——按前文自己的写法来。"
  );
}

/* ────────────────── 本书原句样本（2026-10-20 七段／八段 · 把通用范例句换成本书自己的句子） ────────────────── */

/**
 * 每枚样本的**展示额度**：截断只为「别把整章倒进提示词」。
 * 这是展示额度（与 `CHAPTER_OPENING_CHARS = 24`、`PRIOR_CHAPTER_TAIL_CHARS = 400` 同类），**不是判据**——
 * 换个额度读数就变，所以额度写死在这里、不许下游各抄一份。
 */
export const BOOK_SAMPLE_CHARS = 40;

/** 摆得出「首／中／尾」三枚位置的**结构性下限**：不足三句就是没有样本可摆，不硬凑（不是质量线）。 */
export const BOOK_SAMPLE_MIN_SENTENCES = 3;

/**
 * 「句首」的**定义**：剥掉前置标点／引号后的前 2 个实字（2026-10-21 句首趋同自查）。
 * 2 字是因为中文句首两字已能看出主语／副词起头（「他没」「她站」「忽然」）；换刻度读数会变，
 * 所以刻度写死在这里、不许下游各抄一份——它不是判据。
 */
export const SENTENCE_OPENING_CHARS = 2;

/** 「用滥」的**结构性定义**：出现 ≥2 次才叫重复（同 `openingsSentence`「两章起」、体检术语「≥2 次才报」）。 */
export const SENTENCE_OPENING_MIN_COUNT = 2;

/** 展示额度（与 `bookFlavorSentence` 的 top 5 同数，只为不刷屏；不是判据）。 */
export const SENTENCE_OPENING_TOP = 5;

/**
 * 感官五通道的单字清单（2026-10-21 感官通道读数）。
 *
 * 【为什么是单字、为什么五通道互不重叠】单字计数是**代理读数**（同 text-vitality 的代理口径）：
 * 不切词、不引依赖；一旦两条通道共用同一个字（如「颤」「抖」），同一处细节会被各算一次，读数就偏了。
 * 清单写死在这里是**定义**，不是判据——换一批字读数就变，不许下游各抄一份。
 *
 * 【已知偏差，不掩盖】「色」也会命中「脸色」「神色」（其实仍偏视觉）、「干」会命中「干活」；
 * 这是代理指标的固有粗糙，不为此加词性判断（那要分词，本仓零依赖）。
 */
export const SENSE_CHANNEL_TERMS: readonly { channel: string; chars: readonly string[] }[] = [
  { channel: "视觉", chars: [..."看望见盯瞥瞧亮暗光影色"] },
  { channel: "听觉", chars: [..."听响声静喊叫吼嗓嚷嗡"] },
  { channel: "触觉", chars: [..."冷热烫凉湿干硬软滑痛疼痒麻"] },
  { channel: "嗅觉", chars: [..."香臭腥霉馊烟"] },
  { channel: "体内感", chars: [..."喘汗抖晕饿渴累乏颤"] }
];

/**
 * 本书原句样本（七段／八段，2026-10-20）。
 *
 * 【病因是用户的原话】「主要的就是更像人类文比更好更细腻更流畅，**不要用通用的模板，也不要用模板**」。
 * 把生成端常驻段逐个摊开数过之后确认：那七段里给的**例子全是本仓自造的通用句**——
 * 「她把茶杯推过去。『喝吧。』」「他把碗放下。手在桌沿停了停。」「他进屋，先去关窗」「搪瓷缸」。
 * 模型手上能照的正面样例只有这些，写出来自然是**本仓的示范腔**，不是这本书的腔。
 * 四个动态段里，三个是「避开／别写重」（向下拉）、一个是「保持读数」（防漂移）——
 * **没有一处把这本书自己写得好的句子摆给模型看**。这一刀补的就是这一格。
 *
 * 【本刀只做一件事】从**本书已完稿正文**里**原样摘出**这本书自己的句子摆给这一轮：
 * `voiceSampleSentence` 报叙述句的下沿／中沿／上沿，`dialogueSampleSentence` 报对白句的同样三枚。
 * 两段里都明说「前面各段里给的例子只是示意，真要照的是这几条本书原句」——把范例句降级为示意。
 *
 * 【为什么不改那七段】它们是**方法与纪律**（禁什么、用什么替代），且几处数值上限与扫描端
 * `AI_FLAVOR_STRUCTURE_MIN_COUNT`、退稿闸同吃一枚数字。动它们就是动判据口径，要重跑阈值校准。
 *
 * 【抽取口径（两个段共用一份实现）】
 * - 只取**已完稿**的正文：`kind === "chapter" && active === false`。当前章是**半截草稿**，
 *   拿它当范本只会把上一轮的毛病抄进这一轮（那是放大，不是校准）。
 * - 切句走 `sentencesOf`（与句长节奏、复读、退稿闸同一条 lookbehind 口径，铁律 6，不另切一遍）。
 * - 三枚是**数据算出来的位置**：按句长排序取首／中／尾——**没有一个自定阈值**（§一百三十四：不编数）。
 * - 单一消费者是提示词装配，所以两段产出的都是**给人读的一段话**，不做判定、不进任何闸。
 */

/**
 * 「一条可展示的样本句」的定义：**至少含一个非标点非符号的字符**。
 * 「」式对白在 `sentencesOf` 的口径里（句末标点留在句尾）会把收尾的 `」` 甩成后一句——
 * 竖着写的书里于是会切出只由一个 `」` 组成的碎片（长度 1）。拿它当「最短的一句」摆给模型，
 * 摆出来的是一条没有字的引号，不是语感样本。这里是**定义**（什么算一句话），不是阈值。
 */
const SAMPLE_ONLY_MARKS = /^[\p{P}\p{S}]+$/u;

function isSampleSentence(sentence: string): boolean {
  return !SAMPLE_ONLY_MARKS.test(sentence);
}

/** 已完稿正文：这次上下文里装着的章节条目，**不算当前正在写的那一章**（半截草稿不入样本）。 */
function finishedChaptersText(assembled: AssembledContext): string {
  return assembled.items
    .filter((item) => item.kind === "chapter" && !item.active)
    .map((item) => item.text)
    .join("\n");
}

/** 按句长取**首／中／尾**三枚（数据算出来的位置，不自定阈值）；不足 `BOOK_SAMPLE_MIN_SENTENCES` 句返回 null。 */
function pickByLength(sentences: readonly string[]): [string, string, string] | null {
  const samples = sentences.filter(isSampleSentence);
  if (samples.length < BOOK_SAMPLE_MIN_SENTENCES) return null;
  const byLength = [...samples].sort((a, b) => a.length - b.length);
  return [byLength[0]!, byLength[Math.floor(byLength.length / 2)]!, byLength[byLength.length - 1]!];
}

/** 一枚样本写成一行：`最短的一句（7 字）：「…」`——超 `BOOK_SAMPLE_CHARS` 截断并留一个省略号。 */
function sampleLine(rank: string, sentence: string): string {
  const shown =
    sentence.length <= BOOK_SAMPLE_CHARS ? sentence : `${sentence.slice(0, BOOK_SAMPLE_CHARS)}…`;
  return `${rank}（${sentence.length} 字）：「${shown}」`;
}

/**
 * 语感样本：本书**叙述句**的**实际下沿／中沿／上沿**三枚原句。
 * 只取 `dialogueBalance(sentence).quoted === 0` 的句子——引号里的话由 `dialogueSampleSentence` 单独给，
 * 两段的正面样本不该重叠（拿一句对白当「叙述语感」摆出来，指挥棒就指错了方向）。
 * 不足三句（含开书第一轮：还没有已完稿正文）返回空串——没样本不注入空段。
 */
export function voiceSampleSentence(assembled: AssembledContext): string {
  const sentences = sentencesOf(finishedChaptersText(assembled)).filter(
    (sentence) => dialogueBalance(sentence).quoted === 0
  );
  const picked = pickByLength(sentences);
  if (picked === null) return "";
  return (
    "本书语感样本（原样摘抄自这本书已完稿的正文，不是范例句）：" +
    [
      sampleLine("最短的一句", picked[0]),
      sampleLine("中位的一句", picked[1]),
      sampleLine("最长的一句", picked[2])
    ].join("；") +
    "。写新内容时照这本书自己的语感写：用词、句长、断句都往这三条的路子上靠，长短仍要跟着情绪走" +
    "（该快的地方可以比最短那条还短），但别换一套腔调。前面各段里给的例子只是示意，" +
    "真要照的是这几条本书原句。与上面的文风硬约束冲突时硬约束优先：那是下限，样本只是这本书自己的习惯。"
  );
}

/**
 * 对白样本：本书**引号里的话**的同样三枚（下沿／中沿／上沿）。
 * 「是不是对白句」走 `dialogueBalance(sentence).quoted > 0`——引号配对只住 `dialogue.ts` 的 scanQuotes 一处，
 * 这里不另写一套引号规则；没有对白句（或不足三句）返回空串。
 */
export function dialogueSampleSentence(assembled: AssembledContext): string {
  const sentences = sentencesOf(finishedChaptersText(assembled)).filter(
    (sentence) => dialogueBalance(sentence).quoted > 0
  );
  const picked = pickByLength(sentences);
  if (picked === null) return "";
  return (
    "本书对白样本（原样摘抄自这本书已完稿的正文，引号里的字算对白）：" +
    [
      sampleLine("最短的一句", picked[0]),
      sampleLine("中位的一句", picked[1]),
      sampleLine("最长的一句", picked[2])
    ].join("；") +
    "。写对话时照这本书自己的路子——人物一句话的长短、口气、断句往这三条上靠：可以比最短那条还短" +
    "（一个字的回答也是回答），也可以比最长那条更长，但要真需要。别让新写的人物说起来像另一个人写的。" +
    "前面各段里给的例子只是示意，真要照的是这几条本书原句。"
  );
}

/**
 * 句首趋同自查（2026-10-21）：把这本书**句子的开头**数一遍，点名用滥的那几个。
 *
 * 【为什么单开一段】`openingsSentence` 只数**章**的开头（每章第一句），`bookFlavorSentence` 数的是
 * **词**（词库命中）；「每句都从同一个主语或同一个副词起头」这两种都管不到——它不靠词表，靠节律，
 * 却是中文 AI 文最显眼、读者最先感觉到的机器味（连着三句「他没…」「她站…」，读到第三句就出戏）。
 *
 * 【口径】只取**已完稿**正文（`finishedChaptersText`，当前章半截草稿不算——同 §一百四十一）；
 * 切句走 `sentencesOf`（不另切一遍）；句首＝**剥掉前置标点／引号后的前 `SENTENCE_OPENING_CHARS` 个实字**
 * （`sentencesOf` 把「」留在句子里，不剥就会数出「「你」这类带引号的串）；≥`SENTENCE_OPENING_MIN_COUNT`
 * 次才算「用滥」（结构性定义，不是质量阈值），按次数降序、同数按字符序，最多 `SENTENCE_OPENING_TOP` 条。
 *
 * 【只摆不判】不进任何闸、不进体检、不新增扫描判据——没有「重复率多少算病」的判据（那要语料分位）。
 */
function openingOf(sentence: string): string {
  const content = sentence.replace(/^[\p{P}\p{S}\s]+/u, "");
  return [...content].slice(0, SENTENCE_OPENING_CHARS).join("");
}

export function sentenceOpeningSentence(assembled: AssembledContext): string {
  const counts = new Map<string, number>();
  for (const sentence of sentencesOf(finishedChaptersText(assembled))) {
    const opening = openingOf(sentence);
    if (opening === "") continue;
    counts.set(opening, (counts.get(opening) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .filter(([, count]) => count >= SENTENCE_OPENING_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .slice(0, SENTENCE_OPENING_TOP);
  if (top.length === 0) return "";
  return (
    "本书句首提醒（扫描自这本书已完稿的正文，括号内是出现次数）：下面这几个句子开头在书里已经用多了——" +
    top.map(([opening, count]) => `「${opening}」（${count} 次）`).join("、") +
    "。新写的句子换个起法：从动作起、从一件具体物件起、从声音起、从别人的话起，" +
    "别总拿同一个主语或同一个副词开路；连着几句同一个起头，读者读到第三句就出戏了。"
  );
}

/**
 * 感官通道读数（2026-10-21）：这本书的五种感觉各写了多少——「细腻」最具体的一层。
 *
 * 【为什么值得报】AI 写场景几乎只有画面（看见／光亮／脸色），人写场景会闻到、摸到、疼到。
 * 既有动态段没有一处管感官（词表、章首、对白比、腔调四维、原句、句首都不是这一层）。
 *
 * 【口径】只取**已完稿**正文（同 §一百四十一／一百四十二）；分母是同一份正文的字数（含标点），
 * 逐通道用 `SENSE_CHANNEL_TERMS` 数单字命中，÷字数×1000（1 位小数）——密度是尺度无关量，
 * 章有长短也能横着读。**五枚恒定全列**（零命中也写 0.0），不排序、不捏总分（那要先编权重）。
 *
 * 【只摆不判】没有「嗅觉密度低于多少算病」的判据（要真人语料分位），所以不进体检、不进闸。
 * 叮嘱也刻意留分寸：「一处就够」——本仓要的是该闻到的那一拍闻到，不是每段都撒调料。
 */
function channelPerThousand(text: string, chars: readonly string[]): number {
  let hits = 0;
  for (const char of chars) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(char, from);
      if (at === -1) break;
      hits += 1;
      from = at + char.length;
    }
  }
  return Math.round((hits / text.length) * 1000 * 10) / 10;
}

export function senseChannelSentence(assembled: AssembledContext): string {
  const text = finishedChaptersText(assembled);
  if (text.length === 0) return "";
  const readings = SENSE_CHANNEL_TERMS.map(
    ({ channel, chars }) => `${channel} ${channelPerThousand(text, chars).toFixed(1)}`
  );
  return (
    "本书感官通道读数（扫描自这本书已完稿的正文，每千字命中次数）：" +
    readings.join("、") +
    "。这本书平时偏哪一路，就在哪一路保持它自己的密度（别忽然大段铺感觉）；" +
    "「感官落点」那条照旧执行（每场戏至少两种非视觉感官），" +
    "但也别为了凑数把每段都撒上调料——只在真正该让读者闻到、摸到、疼到的那一拍写。"
  );
}

/**
 * 档案的写入范围说成一句人话（spec §5.1 约束 3：写入范围是**上限**，不是授权）。
 *
 * 为什么这句必须在这里而不是 agent-service：它和上面两段一样，是「排成一段人读的话」，
 * 不参与裁决与落盘；而闸（`checkWritePermission`）在 service 那边照旧独立生效——
 * 模型听没听懂都拦得住它，这句只是让它少撞几次墙、也少给用户解释一遍为什么。
 */
export function writeScopeSentence(profile: AgentProfile): string {
  const scope = profile.writeScope;
  if (scope.kind === "none") return `本轮你是「${profile.name}」，只出批注式提案，不直接改文稿。`;
  if (scope.kind === "current-chapter") {
    return scope.appendOnly === true
      ? `本轮你是「${profile.name}」，改动只限当前章，且默认只在文末追加；改前文要单独提案。`
      : `本轮你是「${profile.name}」，改动只限当前章。`;
  }
  return `本轮你是「${profile.name}」，改动只限：${scope.kinds.join(" / ")}。`;
}

/**
 * Plan 2 的临时装配：只带作品名、阶段名、当前文稿与权限档。
 * Plan 3 起在末尾接上「档案提示词 + 上下文包」——spec §5 的上下文包（#6 档案线）由
 * agent-runtime 的 assembleContext 装，本函数只负责把它排成一段人读的话。
 */
export function defaultPromptFor(context: PromptContext): string {
  // 本书套话回流与开头防套路先各算一次（判定与取值同源，不跑两遍）。
  const bookFlavor = bookFlavorSentence(context.context);
  const openingHint = openingsSentence(context.context.openings ?? []);
  const dialogueHint = dialogueBalanceSentence(context.context);
  // 本书腔调摘要（六段 · P0-③）：把《文风手册》六维里量得出来的四维报给模型，防「写着写着不像自己」。
  const styleProfile = styleProfileSentence(context.context);
  // 本书原句样本（七段／八段，2026-10-20）：把「通用范例句」换成本书自己的句子——语感（句长三枚）与
  // 对白（三枚）各一段，取自已完稿正文（不含当前章）。没样本（不足三句 / 开书第一轮）不加。
  const voiceSample = voiceSampleSentence(context.context);
  const dialogueSample = dialogueSampleSentence(context.context);
  // 句首趋同自查（九段，2026-10-21）：这本书句子开头用滥了哪几个——补 openingsSentence 只数章首、
  // bookFlavorSentence 只数词的那一层（节律层）。没有重复项就不加。
  const openingRepeat = sentenceOpeningSentence(context.context);
  // 感官通道读数（十段，2026-10-21）：这本书偏「看」还是也写闻到／摸到／疼到——细腻层的读数。
  const senseChannels = senseChannelSentence(context.context);
  // 角色约束（2026-10-22）：人物卡 frontmatter 里的专属说法与退场章，剥围栏后模型看不见，这里原样念。
  const castHint = castConstraintSentence(context.context);
  // 书稿规模（2026-11-12）：空书时说清「别再调工具确认」。没有这一格（老夹具）就整句不加。
  const bookScale = bookScaleSentence(context.bookCounts);
  return [
    "你是墨宸 AI 的写作智能体，在用户本地的一本书上工作，能直接操控这本书的资料库。",
    // 档案先说：人设与写入范围上限都出自它（spec §5.1）。
    context.profile.prompt,
    `当前作品：《${context.title}》；创作阶段：${context.stageName}；` +
      `当前文稿：${context.chapter?.relPath ?? "（用户还没打开文稿）"}。`,
    // 规模紧跟在「当前作品」之后：模型的第一个疑问往往是「这本书写到哪了」。
    ...(bookScale === "" ? [] : [bookScale]),
    `权限档：${context.permissionLabel}。提案只有在用户批准后才写入磁盘。`,
    // 工作模式：只在「先计划」时多这一段。动手模式不摆它——摆一句「你可以直接写」
    // 反而像在鼓励它动手，而那本来就是默认行为，不需要叮嘱。
    ...(context.workModeLabel === WORK_MODE_LABELS.plan ? [PLAN_MODE_INSTRUCTION] : []),
    "书稿共 12 类，目录即类型：chapters/章节、volumes/分卷、outline/大纲、worldview/世界观、" +
      "characters/人物、factions/势力组织、locations/地图、timeline/时间线、plot/剧情、" +
      "materials/素材库、glossary/专有名词、skills/技能库。",
    "用户让你生成或补全世界观、人物、设定等内容时，直接用 write_doc 写进对应目录" +
      "（如 worldview/北境.md），文件名用简短中文标题；用户批准后左侧文稿树会自动出现。",
    // 对话回复口径（2026-11-10）：排在这里而不是文风那几段中间——先定「怎么跟人说话」，
    // 再定「怎么写小说」。放后面会被七八段写作约束淹没，模型照着写正文的架势回话。
    DIALOGUE_REPLY_INSTRUCTION,
    // 写正文那几段的公共前言（2026-11-12）：一句说清「下面这些只管写进 chapters/ 的稿子」。
    // 原先这句话在五个段头各写一遍（「（写小说正文时遵守）」），仍没说清「那聊天时呢」。
    WRITING_CRAFT_LEAD,
    // 文风硬约束（2026-10-10）：去 AI 味，词表与体检同源。
    AI_FLAVOR_INSTRUCTION,
    // 结构级去味（2026-10-16）：词库管词与句，这一段管结构——融合技能库三条去味技能，常驻。
    DE_AI_FLAVOR_STRUCTURE_INSTRUCTION,
    // 细腻度段（三段）：去味之外教它怎么写好——五感、具体名词、对话节拍、续写衔接。
    QUALITY_INSTRUCTION,
    // 叙事手法（2026-10-18）：补心理/动作/环境/换场/节奏五样展开方式——治「潦草、跳、没描写」。
    NARRATIVE_CRAFT_INSTRUCTION,
    // 人性化创作（2026-10-18 二段）：补片段内容/逻辑思维/细节把控/语言表达四个**正向**维度——
    // 前四段九成是禁止清单（管下限），这一段给方法（提上限）。
    HUMAN_CRAFT_INSTRUCTION,
    // 对话写法（2026-10-19 三段）：四稿实测拉满人工创作特征的那三条（标签上限／闲话跑题／
    // 说错改口）＋段落打散。排在人性和创作那段之后，不抢已有五段的次序。
    HUMAN_DIALOGUE_INSTRUCTION,
    // 用笔处置（2026-10-20 五段）：补“用笔层”的两条处置动作——详略三测（删／压／展，折进技能库
    // `deslop-structure` 的删除优先＋电报体自检）与章末最后一拍（正向，与同段的“章末四禁”互补）。
    DETAIL_AND_BEAT_INSTRUCTION,
    // 本书套话回流（三段）：这一轮上下文里已用滥的写法点名避开。没命中就不加这段。
    ...(bookFlavor === "" ? [] : [bookFlavor]),
    // 各章开头防套路（四段）：已有起手式点名摆出，新内容换进法。少于两章不加。
    ...(openingHint === "" ? [] : [openingHint]),
    // 对话占比反馈（五段）：过话痨或过闷都点一句，让模型自己找补节拍。常态不加。
    ...(dialogueHint === "" ? [] : [dialogueHint]),
    // 本书腔调摘要（六段 · P0-③）：这本书自己的常态读数（句长/标点/对白/段末收法），
    // 叮嘱保持同一腔调。样本不足不加——与三段「本书现场」动态段并列。
    ...(styleProfile === "" ? [] : [styleProfile]),
    // 本书原句样本（七段／八段，2026-10-20）：原样摘抄本书已完稿正文里的句子（句长三枚 / 对白三枚），
    // 让「正面样本」出自这本书自己，而不是本仓自造的通用例句。没样本就不加这段。
    ...(voiceSample === "" ? [] : [voiceSample]),
    ...(dialogueSample === "" ? [] : [dialogueSample]),
    // 句首趋同自查（九段，2026-10-21）：点这本书用滥的句子开头，叮嘱换起法。没有重复项不加。
    ...(openingRepeat === "" ? [] : [openingRepeat]),
    // 感官通道读数（十段，2026-10-21）：五枚密度全列，叮嘱「别只给画面、一处就够」。空正文不加。
    ...(senseChannels === "" ? [] : [senseChannels]),
    // 角色约束（2026-10-22）：人物卡上写明的专属说法与退场章。没写就不加这段。
    ...(castHint === "" ? [] : [castHint]),
    // 联网段跟着开关走：关掉时这枚工具根本不出站，留着这段就是教模型调一枚不存在的工具。
    ...(context.webSearchEnabled ? [WEB_SEARCH_INSTRUCTION] : []),
    "改动已有文稿用 propose_patch（给 doc/anchor/replace/why），整篇新建或重写用 write_doc。",
    "anchor 必须是文中逐字存在且唯一出现的片段；不确定就先 read_doc。",
    "只读档下不要承诺写入。"
  ].join("\n");
}

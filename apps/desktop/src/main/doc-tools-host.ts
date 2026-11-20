import { assertSafeRelPath, kindOfRelPath, makeFingerprint, readDocFile } from "@mochen/fs-store";
import type {
  AgentProfile,
  AgentToolName,
  BibleEntry,
  BookKind,
  DocRef,
  EditProposal,
  PatchMode,
  ProposalSource,
  SkillRef,
  WriteScope
} from "@mochen/contracts";
import {
  defaultProfile,
  writeScopeAllows,
  aiFlavorGate,
  AI_FLAVOR_STRUCTURE_MIN_COUNT,
  skillBriefLine,
  matchSkillRef,
  styleProfileOf,
  styleDriftOf,
  textSimilarity,
  type StyleProfile
} from "@mochen/contracts";
import { disabledSkillText, skillReadMissText } from "./skill-receipt.js";
// 检索真身迁到独立模块（2026-11-20）：宿主贴着 800 行预算，补设定库 / 前情来源必须外移。
import { runSearchDocs } from "./doc-tools-search.js";
import {
  applyPatch,
  checkWritePermission,
  WRITABLE_TOP_DIRS,
  type ToolContext,
  type ToolHost,
  type ToolOutcome
} from "@mochen/agent-runtime";
import { WebSearchError, webSearchReceipt, type WebSearchOutcome } from "./web-search.js";
import { WebReadError, webReadReceipt, type WebReadOutcome } from "./web-read.js";

/** read_doc 的回执上限：超过就截断，防整本长文灌进模型上下文。边界是 >，恰好 6000 不截。 */
export const READ_TRUNCATE_AT = 6000;

/**
 * 结构上限那枚「一章最多 N 处」的数字：起报线 −1（起报线 = 生成端写明的上限＋1，见
 * `AI_FLAVOR_STRUCTURE_MIN_COUNT`）。退稿信要跟生成端说**同一枚数**，不在这里另抄一个数字——
 * 往后名单里再加句式，这封信自动跟着走。
 */
function capOf(label: string): number {
  return (AI_FLAVOR_STRUCTURE_MIN_COUNT[label] ?? 0) - 1;
}

/** 这一轮档案：生产装配必传；缺省只为兼容既有测试宿主（P0-1）。 */
function profileOf(context: ToolContext): AgentProfile {
  return context.profile ?? defaultProfile();
}

function scopeText(scope: WriteScope): string {
  if (scope.kind === "none") return "只出提案、不直接写正文";
  if (scope.kind === "current-chapter")
    return scope.appendOnly ? "仅当前章、且只能文末追加" : "仅当前章";
  return `仅 ${scope.kinds.join("、")} 类文稿`;
}

/**
 * 写入范围闸（P0-1）：落在 `profile.writeScope` 上，不再只靠提示词自觉。
 *
 * - 审稿档案（`none`）：`write_doc` 一律拒；`propose_patch` 是它唯一的出口，放行。
 * - 当前章档案：只有「目标 = 当前文稿且确实是章」才算 `current-chapter`；别章一律拒。
 *   没选定当前文稿（unbound）时 `propose_patch` 放行、由批准那一步判，`write_doc` 仍拒（见下）。
 * - 分类档案：目标类别必须在 `kinds` 里。
 *
 * 新稿不在 `docs()` 里，按路径推断类别（`kindOfRelPath`，与 scanBook 同一份目录判据）。
 */
function scopeDenial(
  name: "propose_patch" | "write_doc",
  doc: string,
  context: ToolContext,
  docs: readonly DocRef[]
): string | null {
  const profile = profileOf(context);
  const scope = profile.writeScope;
  if (scope.kind === "none")
    return name === "write_doc"
      ? `「${profile.name}」只出批注式提案，不直接改写文稿。这次 write_doc 已被拒，文件未改动；要落盘请换成主笔/续写档案，或由用户在提案卡上批准。`
      : null;

  const kind: BookKind | null =
    docs.find((item) => item.relPath === doc)?.kind ?? kindOfRelPath(doc);
  if (kind === null)
    return `无法判断 ${doc} 属于哪一类文稿（目录不在书稿结构里），这次${
      name === "write_doc" ? "写入" : "提案"
    }没有生成，文件未改动。`;

  const target =
    scope.kind === "current-chapter" && kind === "chapter" && doc === context.docRelPath
      ? ("current-chapter" as const)
      : kind;
  if (writeScopeAllows(scope, target)) return null;
  // 没选定当前章（unbound 线程）时不拦提案：这时候「当前章」根本不存在，写盘能不能成由批准那一步
  // 判定（checkWritePermission 会说「尚未选定当前章」，全开档则按提案点名的篇落盘）。
  // 拦在这里会把既有流程锁死——提案都出不来，用户连拒绝的机会都没有。
  // write_doc 不走这条：它是直接写盘，没有批准那一步可兜。
  if (name === "propose_patch" && scope.kind === "current-chapter" && context.docRelPath === null)
    return null;
  return `「${profile.name}」的写入范围是${scopeText(scope)}，${doc} 不在范围内；这次${
    name === "write_doc" ? "写入" : "提案"
  }没有生成，文件未改动。`;
}

function isAppendOnly(context: ToolContext): boolean {
  const scope = profileOf(context).writeScope;
  return scope.kind === "current-chapter" && scope.appendOnly === true;
}

/**
 * 文末追加闸（P0-1）：续写档案只能把新文字接在已有正文后面。
 *
 * `write_doc` 判「新全文是否以旧全文开头」；`propose_patch` 判「anchor 是否落在文末最后一段，
 * 且 replace 以 anchor 开头」——两条都等价于净追加，改前文/整篇重写一律拒。
 * 空文稿（新章）不设限。
 */
function appendOnlyDenialForWrite(content: string, body: string | null): string | null {
  if (body === null || body === "") return null;
  if (content.startsWith(body)) return null;
  return "续写档案只能把新文字接在文末：整篇替换会抹掉已有正文，这次 write_doc 已被拒，文件未改动。要重写请切到「墨宸 · 主笔」档案。";
}

function appendOnlyDenialForPatch(
  mode: PatchMode,
  anchor: string,
  replace: string,
  body: string | null
): string | null {
  if (body === null || body === "") return null;
  if (mode === "doc-overwrite") {
    if (replace.startsWith(body)) return null;
    return "续写档案只能把新文字接在文末：整篇替换会抹掉已有正文，这次提案没有生成，文件未改动。要重写请切到「墨宸 · 主笔」档案。";
  }
  if (anchor === "")
    return "续写档案要在文末追加，必须在 anchor 里给出文末最后一段原文，并把新内容接在它后面；这次提案没有生成，文件未改动。";
  if (!body.trimEnd().endsWith(anchor.trimEnd()))
    return "续写档案只允许改文末：anchor 必须落在当前文稿的最后一段，这次提案没有生成，文件未改动。要改前文请切到「墨宸 · 主笔」档案。";
  if (!replace.startsWith(anchor))
    return "续写档案只能追加：replace 必须以 anchor 开头（保留原文，只在后面接新内容）；这次提案没有生成，文件未改动。";
  return null;
}

export interface DocToolHostDeps {
  root(): string | null;
  docs(): DocRef[];
  context(): ToolContext;
  onProposal(proposal: EditProposal, baseline: string): void;
  newId(): string;
  now(): string;
  /**
   * 免费联网搜索（主进程出网；测试注入假实现）。回的是**整轮**而不是光一个数组：
   * 回执里要写清「这一条是谁答的、前面几个源为什么没用上」，光有结果拼不出来这两句。
   */
  webSearch(query: string): Promise<WebSearchOutcome>;
  /** 网页正文抓取（2026-10-11，web_read 的真身）：主进程出网；测试注入假实现。 */
  webRead(url: string): Promise<WebReadOutcome>;
  /**
   * 技能库（use_skill 的真身，2026-10-23）。listSkills 列全部可用技能；readSkill 按 id 载入正文。
   * 两者都只读——与 skill-service 的只读面同一条边界。缺省 ⇒ use_skill 回「技能库不可用」。
   */
  listSkills?: (() => Promise<SkillRef[]>) | undefined;
  readSkill?: ((id: string) => Promise<{ title: string; text: string }>) | undefined;
  /**
   * 本书是否已停用这条技能（P0-4）。**显式读取也要过这道闸**：
   * 技能 id 会留在会话历史里，模型照着旧 id 调 use_skill 是常态；
   * 只挡清单不挡正文，停用开关就等于没关。缺省 ⇒ 不停用任何技能。
   */
  skillDisabled?: ((id: string) => boolean) | undefined;
  /**
   * 检索要用的另外两份事实（2026-11-20）：故事圣经条目与章末摘要。
   * 都是只读；缺省 ⇒ 该来源当空表（老测试不必重搭夹具）。
   */
  bible?: (() => Promise<readonly BibleEntry[]>) | undefined;
  recaps?: (() => Readonly<Record<string, string>>) | undefined;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

/**
 * 模型可能吐出 Windows 反斜杠路径（`chapters\01.md`）：在 host 边界统一归一成 posix，
 * 顺手用 fs-store 的门禁拒绝绝对路径 / `..` 越界 / 空路径——权限检查与目录天花板都按 `/` 切，
 * 不归一就会给模型一条莫名其妙的「不在可写目录」拒绝。
 */
function normalizeDoc(rawDoc: string): string | null {
  try {
    return assertSafeRelPath(rawDoc);
  } catch {
    return null;
  }
}

function inWritableDir(relPath: string): boolean {
  return (WRITABLE_TOP_DIRS as readonly string[]).includes(relPath.split("/")[0] ?? "");
}

/**
 * 收尾只补一个句号，已经有的不再补。
 *
 * 这不是洁癖：源链自己抛的每条消息都以「。」结尾，而 host 这一层过去无脑再补一个，
 * 真机截出来的是「……先基于已有文稿继续工作**。。**」。一句话里两个句号读着像出了什么岔子，
 * 而这种错**不抛不报**，纯靠拼字符串，谁都看不出来。
 */
function sentence(text: string): string {
  return /[。．.!?！？…]$/.test(text.trimEnd()) ? text.trimEnd() : `${text}。`;
}

/* ── AI 味自动退稿闸（2026-10-10 二段）──
 * 「底层自动运行」的那套：模型交稿的瞬间，执行层自动扫新增正文，AI 味超标就自动
 * 退稿——模型拿着退稿信自己重写，用户全程无感，不需要点任何检查。
 * 词表与体检/提示词同源（contracts/ai-flavor 的 aiFlavorGate），不抄第二份。
 * 闸只管正文（chapters/ volumes/）：设定资料文档是给人查的资料，AI 腔无所谓。
 * 防死循环：同一稿原样重交放行（附提醒拼进成功回执，用户在审批卡上仍看得到原稿）。 */

/** 正文类目录前缀——只有写进这两类目录的新文本才过闸。
 *  （volumes/ 眼下还不在 WRITABLE_TOP_DIRS 里，先写上是给将来扩目录时留的闸位，
 *  到时候目录放开、闸不会漏。） */
const FLAVOR_GATE_PREFIXES = ["chapters/", "volumes/"];

function gatedDoc(relPath: string): boolean {
  return FLAVOR_GATE_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

type GateResult = { action: "pass"; note: string } | { action: "block"; outcome: ToolOutcome };

export function createDocToolHost(deps: DocToolHostDeps): ToolHost {
  let lastBlockedFingerprint: string | null = null;
  let lastBlockedContent: string | null = null;
  /** 连续退稿计数（五段）：同一条闸通道连着被拦的次数——过闸/放行即清零。 */
  let blockedStreak = 0;

  /** 「换汤不换药」判线：与上一版被拦稿相似度超过它，就在退稿信里点破。实测换两词 ≈ 0.80。 */
  const COSMETIC_REWRITE_RATIO = 0.75;

  /**
   * 这本书自己的腔调常态（2026-11-10）。`undefined` = 还没量过；`null` = 量过但没有可比样本。
   * 每轮 host 只量一次：完稿字数没变的话，量第二遍得到的还是同一份读数，白读一遍全书。
   */
  let bookProfile: StyleProfile | null | undefined;

  /** 把已完稿正文读出来量一份腔调档案。读不到任何一章就当「没有常态」。 */
  async function bookProfileOf(): Promise<StyleProfile | null> {
    if (bookProfile !== undefined) return bookProfile;
    const root = deps.root();
    if (root === null) {
      bookProfile = null;
      return null;
    }
    const contents: string[] = [];
    for (const doc of deps.docs()) {
      if (doc.kind !== "chapter") continue;
      const file = await readDocFile(root, doc.relPath).catch(() => null);
      if (file !== null && file.content !== "") contents.push(file.content);
    }
    bookProfile = styleProfileOf(contents);
    return bookProfile;
  }

  /**
   * 腔调偏离的措辞。**过闸时只报「off」档**（warn 档每稿都有几处，写进回执只会变噪音）；
   * 已经退稿时全报——那时候需要的是「往哪儿改」，不是省字。
   */
  async function driftNote(nextText: string, mode: "pass" | "block"): Promise<string> {
    const profile = await bookProfileOf();
    if (profile === null) return "";
    const drift = styleDriftOf(profile, nextText);
    if (!drift.checked || drift.worst === null) return "";
    if (mode === "pass" && drift.worst.severity !== "off") return "";
    const rows = mode === "pass" ? drift.items.slice(0, 1) : drift.items.slice(0, 2);
    const body = rows
      .map((item) => `${item.label} ${item.draft}（本书 ${item.base}）——${item.advice}`)
      .join(" ");
    if (mode === "pass") return ` 腔调提示：${body}`;
    const rest = drift.items.length - rows.length;
    return ` 不像你自己写的：${body}${rest > 0 ? `（另有 ${rest} 处小偏）` : ""}`;
  }

  /**
   * 对新增正文做退稿判定。返回 pass（note 非空 = 二次重交的附加提醒）或 block。
   * 判定、退稿信措辞的单一真身都在这里；write_doc 与 propose_patch 共吃。
   */
  async function flavorGate(text: string, driftText: string = text): Promise<GateResult> {
    if (text === "") return { action: "pass", note: "" };
    const verdict = aiFlavorGate(text);
    if (verdict.pass) {
      // 过闸就清掉上一版被拦稿的记忆：下次超标是新的病，退稿信不再提旧账。
      lastBlockedFingerprint = null;
      lastBlockedContent = null;
      blockedStreak = 0;
      // 词干净但腔调跑了：不拦（打斗章本来就短），但把读数交给模型，下一稿自己校回来。
      return { action: "pass", note: await driftNote(driftText, "pass") };
    }
    const fingerprint = makeFingerprint(text);
    if (fingerprint === lastBlockedFingerprint) {
      lastBlockedFingerprint = null;
      lastBlockedContent = null;
      blockedStreak = 0;
      return {
        action: "pass",
        note:
          "（同一稿第二次提交，系统放行交用户审批——AI 味仍超标，用户可能整段退回。）" +
          (await driftNote(driftText, "pass"))
      };
    }
    // 「换汤不换药」点破：这版跟上一版被拦的稿几乎一样（只换了几个词），退稿信直说——
    // 不点破的话模型会接着交「第三版换汤」，连吃同款退稿还不知道病根是没真改写法。
    const cosmetic =
      lastBlockedContent !== null &&
      textSimilarity(text, lastBlockedContent) > COSMETIC_REWRITE_RATIO;
    lastBlockedFingerprint = fingerprint;
    lastBlockedContent = text;
    blockedStreak += 1;
    const top = verdict.topTerms.length > 0 ? `重灾区：${verdict.topTerms.join("、")}。` : "";
    // 结构上限条（2026-10-18／10-19）：撞了生成端写明的上限就直说到底——只写「AI 味超标」
    // 模型会当成熟度问题去稀释，改不到点子上（真机那轮它自以为只用了一处）。
    // 上限按 label 现取（= 起报线 −1，数字仍只住 AI_FLAVOR_STRUCTURE_MIN_COUNT 那一张表）：
    // 原句写死「一章最多一处」只对偶成立，名单里从此有两条、上限各不相同，措辞必须跟着 label 走。
    const overCaps = verdict.structureOver.map(
      (label) => `${label}（一章最多 ${capOf(label)} 处）`
    );
    const overCap =
      verdict.structureOver.length === 0
        ? ""
        : ` 句式超限：${overCaps.join("、")}——这类写法这一章用超了生成端写明的上限，多出来的删掉，或换个写法把同一个意思说清楚。`;
    // 复读条（2026-10-18）：同一句原样写三遍以上是机器在原地打转（真机取证里那份 3201 行、
    // 3199 行同句的产物就是这病）。只列前 2 处，多的用「等 N 处」带过——信是给模型看的改法，不是数据倾倒。
    const repeat =
      verdict.repeatOver.length === 0
        ? ""
        : ` 复读：${verdict.repeatOver
            .slice(0, 2)
            .map((row) => `「${row.sentence}」×${row.count}`)
            .join("、")}${
            verdict.repeatOver.length > 2 ? ` 等 ${verdict.repeatOver.length} 处` : ""
          }——同一句话原样重复是机器打转，改成别的写法，或把重复的那几段合成一处。`;
    // 句式节奏条（五段）：词干净但「十句九句他开头」同样要拦，退稿信把节奏病灶点名。
    const rhythm =
      verdict.startRepeat === null
        ? ""
        : ` 句式节奏：有 ${verdict.startRepeat.count}/${verdict.startRepeat.total} 句都用「${verdict.startRepeat.char}」开头——开头的主语和句式轮换着来，别每句一个模子。`;
    // 句长条（六段）：起手轮换了但句句等长是另一种机器节奏——开头复读管「起手」，
    // 这条管「长短」，两条理由各拦各的病。退稿信给模型一句可执行的改法。
    const flatLine =
      verdict.flatRhythm === null
        ? ""
        : ` 句长节奏：平均句长 ${verdict.flatRhythm.mean} 字，几乎句句一样长——长短句要错开：该停顿的地方用短句，该铺开的地方用长句，让长短替你打节拍。`;
    const again = cosmetic ? " 注意：这一版和上一版几乎一样——要**换写法**，不是换几个词。" : "";
    // 腔调条（2026-11-10）：词干净也可能「写得挺好，但不是这本书」。已经在退稿了，
    // 就把这本书自己的常态一并摆出来——这时候模型要的是往哪儿改，不是省字。
    const drift = await driftNote(driftText, "block");
    // 连续退稿升级（五段）：连吃两轮退稿说明「照着改」的路子没走通，第三封信说重话——
    // 要求回到场景本身重构，而不是继续在原稿上修修补补。
    const escalation =
      blockedStreak >= 3
        ? ` 这已经是连续第 ${blockedStreak} 次退稿。别再在原稿上小修小改——回到这一章的场景和人物本身，想清楚「这一段到底要发生什么」，然后从头重写。`
        : blockedStreak === 2
          ? " 提醒：这是连续第二次退稿——上一版的改法没有触到病根，这次要整段换写法。"
          : "";
    return {
      action: "block",
      outcome: {
        ok: false,
        text: sentence(
          `这份稿子被自动退稿：AI 味超标（每千字 ${verdict.perThousand} 处，共 ${verdict.hits} 处）。` +
            top +
            overCap +
            repeat +
            rhythm +
            flatLine +
            drift +
            again +
            escalation +
            " 重写要求：套话换成具体的动作、对话和细节；心理活动别用「他知道，……」汇报，" +
            "要演出来；句长错开，别连续几句一样长。改完重新提交——同一稿再交一次，系统会放行给用户审"
        ),
        proposals: []
      }
    };
  }

  async function text(relPath: string): Promise<string | null> {
    const root = deps.root();
    if (root === null) return null;
    // 注意：readDocFile 的这层 catch 把**所有**读取失败（ENOENT/EBUSY/EACCES…）都吞成 null，
    // 所以 null 只表示「这次没读到」，不表示「文件一定不存在」——Task 11 做指纹比对时要记住这点。
    return (await readDocFile(root, relPath).catch(() => null))?.content ?? null;
  }

  function proposal(input: {
    doc: string;
    mode: PatchMode;
    anchor: string;
    replace: string;
    why: string;
    tool: AgentToolName;
    fingerprint: string;
    source: ProposalSource;
  }): EditProposal {
    return {
      id: deps.newId(),
      threadKey: deps.context().docRelPath ?? "unbound",
      // turnId 是占位：host 不知道轮次号，Task 11 登记/转发前必须用真实 turnId 覆写（{ ...proposal, turnId }）。
      turnId: "",
      docRelPath: input.doc,
      mode: input.mode,
      anchor: input.anchor,
      replace: input.replace,
      why: input.why,
      tool: input.tool,
      source: input.source,
      expectedFingerprint: input.fingerprint,
      createdAt: deps.now()
    };
  }

  return {
    context: deps.context,

    async call(name: AgentToolName, args: Record<string, unknown>): Promise<ToolOutcome> {
      const deny = (text: string): ToolOutcome => ({ ok: false, text, proposals: [] });

      if (name === "read_doc") {
        const doc = str(args, "doc");
        const body = await text(doc);
        if (body === null) return deny(`读不到 ${doc || "（空路径）"}。书名稿见 list_docs。`);
        const clipped = body.length > READ_TRUNCATE_AT;
        return {
          ok: true,
          text: `${clipped ? `${body.slice(0, READ_TRUNCATE_AT)}\n（已截断，全文 ${body.length} 字）` : body}`,
          proposals: []
        };
      }

      if (name === "list_docs") {
        const kind = str(args, "kind");
        const refs = deps.docs().filter((ref) => kind === "" || ref.kind === kind);
        if (refs.length === 0) return { ok: true, text: "（没有符合条件的文稿）", proposals: [] };
        return {
          ok: true,
          text: refs.map((ref) => `- ${ref.relPath} · ${ref.title}`).join("\n"),
          proposals: []
        };
      }

      // use_skill（2026-10-23，spec §11 放宽）：无参列技能库，带 skill（id）载入那一份正文。
      // 只读——不写盘、不进文稿树；载入的正文当一条工具回执给模型，模型据此照做。
      if (name === "use_skill") {
        const wanted = str(args, "skill").trim();
        if (wanted === "") {
          if (deps.listSkills === undefined) return deny("技能库这一轮没接上，列不出来。");
          // 停用的连清单都不出现（P0-4）：模型看不见它，就不会去挂/去读。
          const refs = (await deps.listSkills()).filter(
            (ref) => deps.skillDisabled?.(ref.id) !== true
          );
          if (refs.length === 0) return { ok: true, text: "（技能库里还没有技能）", proposals: [] };
          // 行形与系统提示里的清单同源（`skillBriefLine`）：模型在两条通路上看到的是同一种格式，
          // 不必为「索引里长这样、工具回执里长那样」再学一遍；description 也过同一把 48 字的尺，
          // 一份写了几千字说明的技能不会把整条回执撑满。
          return {
            ok: true,
            text: refs.map((ref) => `- ${skillBriefLine(ref)}`).join("\n"),
            proposals: []
          };
        }
        if (deps.readSkill === undefined) return deny("技能库这一轮没接上，读不到技能正文。");
        if (deps.skillDisabled?.(wanted) === true) return deny(disabledSkillText(wanted));
        const one = await deps.readSkill(wanted).catch(() => null);
        if (one === null) {
          // 读不到时先认一认「它写的是哪一份」（2026-11-12）：模型常只给目录名或显示名，
          // 认得出就点名要它，省一轮「列出全部技能」。口径与措辞在 skill-receipt.ts。
          const hit =
            deps.listSkills === undefined
              ? null
              : matchSkillRef(wanted, await deps.listSkills().catch(() => []));
          return deny(
            skillReadMissText(wanted, hit, hit !== null && deps.skillDisabled?.(hit.id) === true)
          );
        }
        // 回执里点明「正文已载入」：模型读到一份方法后，下一轮常会忘了它已经在手上又去读一遍
        // （历史被切片后尤其如此），白烧一整轮工具往返。这句把它按在「已经读到了」。
        return {
          ok: true,
          text: `【技能：${one.title}（正文已载入，这一轮不必再读）】\n${one.text}`,
          proposals: []
        };
      }

      if (name === "search_docs") {
        // 检索真身迁到 doc-tools-search.ts（2026-11-20）：这里只转交来源与参数，
        // 不重算任何一路判据（kind / group / limit / 容错都住在那边）。
        return await runSearchDocs(
          {
            docs: deps.docs,
            root: deps.root,
            bible: deps.bible ?? (async () => []),
            recaps: deps.recaps ?? (() => ({}))
          },
          args
        );
      }

      if (name === "web_search") {
        const query = str(args, "query");
        if (query === "") return deny("web_search 需要非空的 query。");
        let outcome: WebSearchOutcome;
        try {
          outcome = await deps.webSearch(query);
        } catch (error) {
          // 「源都能用，只是没搜着」不是失败：它是 ok 的一条正常回执，模型据此去换关键词。
          // 但界面要能分出「搜到了」和「跑通了却空手」——否则工具卡一律写「完成」，
          // 一次没搜着的搜索看上去像是搜到了（5-⑮ 记的实测）。
          if (error instanceof WebSearchError && error.kind === "empty")
            return { ok: true, text: error.message, proposals: [], empty: true };
          // WebSearchError 之外的任何错误都不许把 message 透给用户：源链里可能哪天有人
          // new Error("fetch failed")，那种英文技术串一个字都不该出现在界面上。
          const reason =
            error instanceof WebSearchError ? error.message : "搜索源那边出了点问题，稍后再试";
          return deny(sentence(`联网搜索失败：${reason}`));
        }
        // 兜底：注入的自定义 webSearch 万一真递了空数组。与上面 empty 那条同一口径，
        // 同一个处境不许有两种说法（模型要的是「换词」，不是「搜不到」）。
        if (outcome.results.length === 0)
          return {
            ok: true,
            text: `搜索源都能用，但没搜到「${query}」的相关结果——换几个关键词再搜一次。`,
            proposals: [],
            empty: true
          };
        return {
          ok: true,
          text: webSearchReceipt(outcome),
          proposals: [],
          sources: outcome.results
        };
      }

      if (name === "web_read") {
        const rawUrl = str(args, "url");
        if (rawUrl === "") return deny("web_read 需要非空的 url。");
        let outcome: WebReadOutcome;
        try {
          outcome = await deps.webRead(rawUrl);
        } catch (error) {
          // WebReadError 之外的任何错误都不许把 message 透给用户（与 web_search 同一条纪律）：
          // 源链里可能哪天有人 new Error("fetch failed")，那种英文技术串一个字都不该出现在界面上。
          if (!(error instanceof WebReadError))
            return deny(sentence("网页读取失败：读这一页的那边出了点问题，稍后再试。"));
          // bad-url 是「这条链接本身不对」：重试无意义，换链接才有意义——不是空手，是拒绝。
          if (error.kind === "bad-url") return deny(sentence(error.message));
          // 剥不出正文与搜不到同理：跑通了但没东西可给，模型据此换一条来源（画「完成」不是「失败」）。
          if (error.kind === "empty")
            return { ok: true, text: error.message, proposals: [], empty: true };
          return deny(sentence(error.message));
        }
        return {
          ok: true,
          text: webReadReceipt(outcome),
          proposals: [],
          // 这一页本身就是来源：工具卡上按来源键可点开核对（与 web_search 同一条通路）。
          // WebSource 的 snippet 字段对这一枚没有意义（正文已在 text 里），留空串——
          // 形状必须齐全（schema 钉着），语义上不塞假摘要。
          sources: [{ title: outcome.title, url: outcome.url, snippet: "" }]
        };
      }

      if (name === "propose_patch" || name === "write_doc") {
        const rawDoc = str(args, "doc");
        const why = str(args, "why");
        if (why === "") return deny("必须给出中文理由 why，用户要在审批卡片上看这条。");
        const doc = normalizeDoc(rawDoc);
        if (doc === null)
          return deny(
            `非法路径：${rawDoc || "（空路径）"}。必须用书内相对路径（如 chapters/01.md），` +
              "且不得越过书目录边界。"
          );
        if (!inWritableDir(doc))
          return deny(
            `${doc} 不在作品文稿目录内。只允许写入 ${WRITABLE_TOP_DIRS.join("/")} 下的文件。`
          );

        // 裁定（spec 权限表的只读行 = 读一切、可提案、永不落地）：权限档闸的是**写盘意图**，
        // checkWritePermission 只作用于 write_doc；propose_patch 一个字都不落盘，绝不被档位拦截。
        if (name === "write_doc") {
          const permission = checkWritePermission({
            mode: deps.context().permissionMode,
            docRelPath: doc,
            currentChapter: deps.context().docRelPath,
            workMode: deps.context().workMode
          });
          if (!permission.allowed) return deny(permission.reason);
        }

        if (deps.root() === null) return deny("尚未打开作品目录。");

        const body = await text(doc);
        // P0-1：档案写入范围。权限档管「能不能写盘」，这里管「这一轮能写哪些文稿」。
        const scopeBlock = scopeDenial(name, doc, deps.context(), deps.docs());
        if (scopeBlock !== null) return deny(scopeBlock);
        const fingerprint = makeFingerprint(body ?? "");
        const source: ProposalSource =
          str(args, "source") === "text-block" ? "text-block" : "tool-call";

        if (name === "write_doc") {
          const content = str(args, "content");
          // P0-1：续写档案只允许净追加（新全文必须以旧全文开头）。
          if (isAppendOnly(deps.context())) {
            const appendBlock = appendOnlyDenialForWrite(content, body);
            if (appendBlock !== null) return deny(appendBlock);
          }
          const applied = applyPatch(body ?? "", "doc-overwrite", "", content);
          if (applied.status !== "unique") return deny(applied.message);
          if (body !== null && applied.content === body)
            return deny("提案没有生成：新内容与盘上文字未发生变化，这一改等于没改；文件未改动。");
          // 自动退稿闸：正文超标先退给模型重写，不生成提案——用户批不到一稿重度 AI 味。
          const gate = gatedDoc(doc)
            ? await flavorGate(content)
            : ({ action: "pass", note: "" } as const);
          if (gate.action === "block") return gate.outcome;
          const item = proposal({
            doc,
            mode: "doc-overwrite",
            anchor: "",
            replace: content,
            why,
            tool: "write_doc",
            fingerprint,
            source
          });
          deps.onProposal(item, body ?? "");
          return {
            ok: true,
            text: `提案 ${item.id}（整篇写入 ${doc}）已生成，等待用户逐条审批；未批准前文件未改动。${gate.note}`,
            proposals: [item]
          };
        }

        const mode: PatchMode =
          str(args, "mode") === "doc-overwrite" ? "doc-overwrite" : "anchor-replace";
        const anchor = str(args, "anchor");
        const replace = str(args, "replace");
        // P0-1：续写档案只允许在文末最后一段之后接新内容。
        if (isAppendOnly(deps.context())) {
          const appendBlock = appendOnlyDenialForPatch(mode, anchor, replace, body);
          if (appendBlock !== null) return deny(appendBlock);
        }
        const applied = applyPatch(body ?? "", mode, anchor, replace);
        if (applied.status !== "unique")
          return deny(`${applied.message}（提案没有生成，文件未改动。）`);
        // 空 diff 提案（anchor === replace 之类）没有审批价值，Task 5 交接 §3.3 点名由本层拒收。
        if (body !== null && applied.content === body)
          return deny("提案没有生成：替换后文字未发生变化，这一改等于没改；文件未改动。");
        // 自动退稿闸：与 write_doc 同一口径——正文替换片段超标先退给模型重写。
        const gate = gatedDoc(doc)
          ? await flavorGate(replace, applied.content)
          : ({ action: "pass", note: "" } as const);
        if (gate.action === "block") return gate.outcome;
        const item = proposal({
          doc,
          mode,
          anchor,
          replace,
          why,
          tool: "propose_patch",
          fingerprint,
          source
        });
        deps.onProposal(item, body ?? "");
        return {
          ok: true,
          text: `提案 ${item.id} 已生成，等待用户审批；未批准前文件未改动。${gate.note}`,
          proposals: [item]
        };
      }

      return deny(`没有这个工具：${name}。`);
    }
  };
}

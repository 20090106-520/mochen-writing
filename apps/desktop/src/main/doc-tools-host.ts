import path from "node:path";
import { readFile } from "node:fs/promises";
import { assertSafeRelPath, makeFingerprint, readDocFile } from "@mochen/fs-store";
import type {
  AgentToolName,
  DocRef,
  EditProposal,
  PatchMode,
  ProposalSource
} from "@mochen/contracts";
import {
  fuzzyEligible,
  fuzzyFindInLine,
  aiFlavorGate,
  AI_FLAVOR_STRUCTURE_MIN_COUNT,
  textSimilarity
} from "@mochen/contracts";
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
   * 对新增正文做退稿判定。返回 pass（note 非空 = 二次重交的附加提醒）或 block。
   * 判定、退稿信措辞的单一真身都在这里；write_doc 与 propose_patch 共吃。
   */
  function flavorGate(text: string): GateResult {
    if (text === "") return { action: "pass", note: "" };
    const verdict = aiFlavorGate(text);
    if (verdict.pass) {
      // 过闸就清掉上一版被拦稿的记忆：下次超标是新的病，退稿信不再提旧账。
      lastBlockedFingerprint = null;
      lastBlockedContent = null;
      blockedStreak = 0;
      return { action: "pass", note: "" };
    }
    const fingerprint = makeFingerprint(text);
    if (fingerprint === lastBlockedFingerprint) {
      lastBlockedFingerprint = null;
      lastBlockedContent = null;
      blockedStreak = 0;
      return {
        action: "pass",
        note: "（同一稿第二次提交，系统放行交用户审批——AI 味仍超标，用户可能整段退回。）"
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

      if (name === "search_docs") {
        const query = str(args, "query");
        if (query === "") return deny("search_docs 需要非空的 query。");
        const root = deps.root();
        if (root === null) return deny("尚未打开作品目录。");
        const hits: string[] = [];
        let total = 0;
        for (const ref of deps.docs()) {
          const body = await readFile(path.join(root, ...ref.relPath.split("/")), "utf8").catch(
            () => null
          );
          if (body === null) continue;
          const lines = body.split("\n");
          for (const [index, line] of lines.entries()) {
            if (!line.includes(query)) continue;
            total += 1;
            if (hits.length < 20) hits.push(`${ref.relPath}:${index + 1}: ${line.trim()}`);
          }
        }
        // 一字之差兜底（2026-10-10）：与渲染层全文搜索同一份真身（contracts/search-match），
        // 精确零命中才跑第二轮，并在回执里如实写明这是容错命中——模型据此知道窗口里
        // 的字与 query 并不相同（比如「林潮生」命中了「林潮升」），不能照抄。
        if (total === 0 && fuzzyEligible(query)) {
          for (const ref of deps.docs()) {
            const body = await readFile(path.join(root, ...ref.relPath.split("/")), "utf8").catch(
              () => null
            );
            if (body === null) continue;
            const lines = body.split("\n");
            for (const [index, line] of lines.entries()) {
              const found = fuzzyFindInLine(line, query);
              if (found === null) continue;
              total += 1;
              if (hits.length < 20) hits.push(`${ref.relPath}:${index + 1}: ${line.trim()}`);
            }
          }
          if (total === 0) return { ok: true, text: `没有命中「${query}」。`, proposals: [] };
          return {
            ok: true,
            text: `精确搜索没有命中「${query}」，按一字之差容错命中 ${total} 处${
              hits.length < total ? `，只列前 ${hits.length} 条` : ""
            }（命中的字可能与查询不完全相同，引用前先核对）：\n${hits.join("\n")}`,
            proposals: []
          };
        }
        if (total === 0) return { ok: true, text: `没有命中「${query}」。`, proposals: [] };
        return {
          ok: true,
          text: `命中 ${total} 处${hits.length < total ? `，只列前 ${hits.length} 条` : ""}：\n${hits.join("\n")}`,
          proposals: []
        };
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
        const fingerprint = makeFingerprint(body ?? "");
        const source: ProposalSource =
          str(args, "source") === "text-block" ? "text-block" : "tool-call";

        if (name === "write_doc") {
          const content = str(args, "content");
          const applied = applyPatch(body ?? "", "doc-overwrite", "", content);
          if (applied.status !== "unique") return deny(applied.message);
          if (body !== null && applied.content === body)
            return deny("提案没有生成：新内容与盘上文字未发生变化，这一改等于没改；文件未改动。");
          // 自动退稿闸：正文超标先退给模型重写，不生成提案——用户批不到一稿重度 AI 味。
          const gate = gatedDoc(doc)
            ? flavorGate(content)
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
        const applied = applyPatch(body ?? "", mode, anchor, replace);
        if (applied.status !== "unique")
          return deny(`${applied.message}（提案没有生成，文件未改动。）`);
        // 空 diff 提案（anchor === replace 之类）没有审批价值，Task 5 交接 §3.3 点名由本层拒收。
        if (body !== null && applied.content === body)
          return deny("提案没有生成：替换后文字未发生变化，这一改等于没改；文件未改动。");
        // 自动退稿闸：与 write_doc 同一口径——正文替换片段超标先退给模型重写。
        const gate = gatedDoc(doc) ? flavorGate(replace) : ({ action: "pass", note: "" } as const);
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

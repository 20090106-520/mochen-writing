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
  applyPatch,
  checkWritePermission,
  WRITABLE_TOP_DIRS,
  type ToolContext,
  type ToolHost,
  type ToolOutcome
} from "@mochen/agent-runtime";
import { WebSearchError, webSearchReceipt, type WebSearchOutcome } from "./web-search.js";

/** read_doc 的回执上限：超过就截断，防整本长文灌进模型上下文。边界是 >，恰好 6000 不截。 */
export const READ_TRUNCATE_AT = 6000;

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

export function createDocToolHost(deps: DocToolHostDeps): ToolHost {
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
            text: `提案 ${item.id}（整篇写入 ${doc}）已生成，等待用户逐条审批；未批准前文件未改动。`,
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
          text: `提案 ${item.id} 已生成，等待用户审批；未批准前文件未改动。`,
          proposals: [item]
        };
      }

      return deny(`没有这个工具：${name}。`);
    }
  };
}

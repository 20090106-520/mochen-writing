/**
 * 章末前情摘要（2026-11-17 spec 阶段 C.2）。
 *
 * 【为什么要它】前情提要怎么长期都靠「截上一章最后 400 字」：一章越写越长时，那 400 字往往只是
 * 一个场景的末梢，模型看不到这一章到底发生了什么，于是重复交代、忘掉钩子。摘要是一次短调用，
 * 把「谁做了什么、结果如何、留了什么钩子」压成事实句，随书写进 book.json。
 *
 * 【为什么失败回 null 不抛】摘要是锦上添花，不是主线：没有配置、超时、上游报错都只该让这一章
 * 继续走「截尾部原文」的老路，绝不能反过来挡住作者写作。
 */
import type { BookDigest, ProviderConfig } from "@mochen/contracts";
import { parseBookDigest, RECAP_MAX_CHARS } from "@mochen/contracts";
import { chatMessage, estimateTokens, streamChat, type ProviderFetch } from "@mochen/agent-runtime";
import type { ProviderSettings } from "./provider-settings.js";

/** 摘要调用最多等多久：它是后台旁路，不许吊着一整轮不放。 */
const RECAP_TIMEOUT_MS = 60_000;

/** 留给模型输出摘要的 token（300 字摘要 + 一点余量）。 */
const RECAP_RESERVED_TOKENS = 2048;

/** 系统指令固定：只写事实，不评价、不修饰。句子住这一处，测试也读它。 */
export const RECAP_SYSTEM_PROMPT =
  "你是长篇小说的资料助手。读一章正文，写一段不超过 300 字的事实摘要：" +
  "谁做了什么、结果如何、留下了什么钩子。只写事实，不评价、不修饰、不猜后续。" +
  "直接输出摘要正文，不要标题，不要客套。";

/**
 * 全书状态卡的系统指令（2026-11-20）。与摘要分开一次调用：
 * 摘要回答「这一章发生了什么」，状态卡回答「故事到哪儿了、谁现在什么处境」。
 * 输入只有上一份状态 + 本章摘要，不重读正文——这一步是压缩，不是再读一遍。
 */
export const DIGEST_SYSTEM_PROMPT =
  "你是长篇小说的资料助手。根据「上一份全书状态」和「刚写完这一章的摘要」，更新全书状态。" +
  "严格按下面两段输出，不要别的内容：\n" +
  "【全书摘要】一句话说清故事推进到哪里（不超过 120 字）。\n" +
  "【人物状态】一行一人，格式「- 人名：身份/处境/目标/关系变化」；" +
  "只写主要人物，每人不超过 40 字，没有就留空。";

export interface ChapterRecapDeps {
  /** 与 agent-service 同一个实例：取启用中那条连接的地址、模型与密钥。 */
  settings: ProviderSettings;
  /** 同一个出网实现（生产里就是主进程那只 fetch）。 */
  fetchImpl: ProviderFetch;
}

export interface ChapterRecap {
  /** 一次短调用：给一章正文，回 ≤300 字的事实摘要；失败回 null（不抛）。 */
  summarize(input: { title: string; content: string }): Promise<string | null>;
  /**
   * 把「上一份全书状态 + 本章摘要」压成新状态卡（2026-11-20）。
   * 与摘要同一条后台通路：失败 / 无配置 / 解析不出都回 null，绝不抛。
   */
  digestize(input: {
    title: string;
    recap: string;
    previous: BookDigest | null;
  }): Promise<BookDigest | null>;
}

/**
 * 摘要队列要用的书操作（`BookService` 结构上天然满足，这里不反向依赖它的实现）。
 * 只声明用到的那三件：读当前书、读正文、只并回这一章的摘要。
 */
export interface RecapBook {
  current(): {
    docs: readonly { relPath: string; title: string }[];
    meta: { digest?: BookDigest | undefined };
  } | null;
  readDoc(relPath: string): Promise<{ content: string }>;
  /**
   * 只把这一章并进 `book.json`（2026-11-20 审计 R-4）。
   * 摘要生成要几十秒，期间用户可能改了书名/阶段：整份回写会把那次改动回滚。
   * 现取最新 meta 再补一格这件事住在 `BookService` 那一处（与用户保存共用写队列）。
   */
  mergeRecaps(relPath: string, text: string): Promise<void>;
  /** 只并回全书状态这一格（同一套「现取最新 meta 再补一格」的写队列）。 */
  mergeDigest(digest: BookDigest): Promise<void>;
}

export interface RecapQueue {
  /** 给刚写成的篇排队；同一篇在跑就跳过。永不抛、永不阻塞调用方。 */
  queue(relPaths: readonly string[]): void;
}

/**
 * 摘要的后台队列（agent-service 只调 `queue([relPath])`）：
 * 生成期间作者可能换书——只写回**此刻**那本书，且只并这一章，绝不覆盖别人刚改的摘要。
 */
export function createRecapQueue(deps: { book: RecapBook; recap: ChapterRecap }): RecapQueue {
  const running = new Set<string>();
  /**
   * 状态卡必须串行：两章几乎同时写完时，各自都拿「此刻」的 digest 当上一份，
   * 后写回的那份会把先写回的那份覆盖掉。串起来之后，第二次一定读到第一次的结果。
   */
  let digestChain: Promise<void> = Promise.resolve();

  function enqueueDigest(title: string, recap: string): void {
    digestChain = digestChain.then(async () => {
      try {
        const previous = deps.book.current()?.meta.digest ?? null;
        const next = await deps.recap.digestize({ title, recap, previous });
        if (next !== null) await deps.book.mergeDigest(next);
      } catch (error) {
        // 状态卡同样是锦上添花：失败只留日志，不阻断下一章。
        console.warn(
          `[全书状态] ${title} 这次没做成：${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  return {
    queue(relPaths: readonly string[]): void {
      for (const relPath of new Set(relPaths)) {
        if (running.has(relPath)) continue;
        running.add(relPath);
        void (async () => {
          try {
            const before = deps.book.current();
            if (before === null) return;
            const doc = before.docs.find((one) => one.relPath === relPath);
            const title = doc?.title ?? relPath;
            const read = await deps.book.readDoc(relPath);
            const text = await deps.recap.summarize({ title, content: read.content });
            if (text === null) return;
            // 只并这一格（审计 R-4）：此前是「取快照 → 整份回写」，摘要生成的那几十秒里
            // 用户改的书名/阶段/技能开关会被静默回滚。跨书判定也在 BookService 那一处。
            await deps.book.mergeRecaps(relPath, text);
            // 摘要落盘之后才更新状态卡：摘要失败时状态卡没有可信输入。
            enqueueDigest(title, text);
          } catch (error) {
            // 锦上添花：这一次没做成只留一行日志，下一章写盘时会再试。
            console.warn(
              `[章末摘要] ${relPath} 这次没做成：${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            running.delete(relPath);
          }
        })();
      }
    }
  };
}

/**
 * 正文超过窗口预算时先截尾部：留最近的进展，比留开头更接近「这一章结束时局面是什么样」。
 *
 * 口径与历史切片同源（token 估算都走 `estimateTokens`）：中文一字约一 token，其余四字符约一 token，
 * 所以「保留可用 token 数那么多个字符」是保守上限，不会算多。
 */
function fitChapterContent(content: string, config: ProviderConfig): string {
  const windowTokens = config.contextWindow ?? 64_000;
  const available = Math.max(
    0,
    windowTokens - estimateTokens(RECAP_SYSTEM_PROMPT) - RECAP_RESERVED_TOKENS
  );
  return available > 0 ? content.slice(-available) : "";
}

export function createChapterRecap(deps: ChapterRecapDeps): ChapterRecap {
  type Resolved = { config: ProviderConfig; apiKey: string };

  /**
   * 取一次配置：摘要与状态卡共用「后台杂活」这条通路（2026-11-20）。
   * 用户没指定杂活模型、或指定的那条坏了，`configFor` 自己会回退到主档案；
   * 这里只处理「真的全都没有」。
   */
  async function resolve(): Promise<Resolved | null> {
    return await deps.settings.configFor("utility");
  }

  /** 一次不带工具、不联网、不思考的短调用；上游失败回 null（不抛）。 */
  async function run(resolved: Resolved, system: string, user: string): Promise<string | null> {
    const signal = AbortSignal.timeout(RECAP_TIMEOUT_MS);
    let text = "";
    try {
      for await (const event of streamChat({
        fetchImpl: deps.fetchImpl,
        baseURL: resolved.config.baseURL,
        apiKey: resolved.apiKey,
        authHeader: resolved.config.authHeader,
        thinkingWire: resolved.config.thinkingWire,
        model: resolved.config.model,
        messages: [chatMessage("system", system), chatMessage("user", user)],
        tools: [],
        signal,
        // 摘要/状态卡是事实压缩，不要思考档，也不要联网——多一样都只是多一次不确定。
        thinkingLevel: "off",
        webSearchEnabled: false
      })) {
        if (event.kind === "text-delta") text += event.text;
        if (event.kind === "finish") break;
      }
    } catch {
      return null;
    }
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed;
  }

  return {
    async summarize({ title, content }): Promise<string | null> {
      if (content.trim() === "") return null;
      const resolved = await resolve();
      if (resolved === null) return null;
      const body = fitChapterContent(content, resolved.config);
      if (body.trim() === "") return null;
      const text = await run(
        resolved,
        RECAP_SYSTEM_PROMPT,
        `章节标题：${title}\n\n正文：\n${body}`
      );
      return text === null ? null : text.slice(0, RECAP_MAX_CHARS);
    },

    async digestize({ title, recap, previous }): Promise<BookDigest | null> {
      if (recap.trim() === "") return null;
      const resolved = await resolve();
      if (resolved === null) return null;
      const previousText =
        previous === null
          ? "（还没有上一份，这是第一次生成。）"
          : `摘要：${previous.summary}\n人物：\n${previous.cast === "" ? "（空）" : previous.cast}`;
      const text = await run(
        resolved,
        DIGEST_SYSTEM_PROMPT,
        `上一份全书状态：\n${previousText}\n\n本章标题：${title}\n本章摘要：\n${recap}`
      );
      if (text === null) return null;
      // 解析判据只住 contracts 的 parseBookDigest：截断也在那边，这里不另写一份。
      return parseBookDigest(text);
    }
  };
}

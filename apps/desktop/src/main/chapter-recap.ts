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
import type { BookMeta, ProviderConfig } from "@mochen/contracts";
import { RECAP_MAX_CHARS } from "@mochen/contracts";
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

export interface ChapterRecapDeps {
  /** 与 agent-service 同一个实例：取启用中那条连接的地址、模型与密钥。 */
  settings: ProviderSettings;
  /** 同一个出网实现（生产里就是主进程那只 fetch）。 */
  fetchImpl: ProviderFetch;
}

export interface ChapterRecap {
  /** 一次短调用：给一章正文，回 ≤300 字的事实摘要；失败回 null（不抛）。 */
  summarize(input: { title: string; content: string }): Promise<string | null>;
}

/**
 * 摘要队列要用的三件书操作（`BookService` 结构上天然满足，这里不反向依赖它的实现）。
 * 只声明用到的那三件：读当前书、读正文、写回 meta。
 */
export interface RecapBook {
  current(): { docs: readonly { relPath: string; title: string }[]; meta: BookMeta } | null;
  readDoc(relPath: string): Promise<{ content: string }>;
  saveMeta(meta: BookMeta): Promise<unknown>;
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
            const read = await deps.book.readDoc(relPath);
            const text = await deps.recap.summarize({
              title: doc?.title ?? relPath,
              content: read.content
            });
            if (text === null) return;
            const after = deps.book.current();
            if (after === null) return;
            await deps.book.saveMeta({
              ...after.meta,
              recaps: { ...(after.meta.recaps ?? {}), [relPath]: text }
            });
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
  return {
    async summarize({ title, content }): Promise<string | null> {
      if (content.trim() === "") return null;
      const config = await deps.settings.config();
      const apiKey = await deps.settings.apiKey();
      if (config === null || apiKey === null) return null;
      const body = fitChapterContent(content, config);
      if (body.trim() === "") return null;
      const signal = AbortSignal.timeout(RECAP_TIMEOUT_MS);
      let text = "";
      try {
        for await (const event of streamChat({
          fetchImpl: deps.fetchImpl,
          baseURL: config.baseURL,
          apiKey,
          authHeader: config.authHeader,
          thinkingWire: config.thinkingWire,
          model: config.model,
          messages: [
            chatMessage("system", RECAP_SYSTEM_PROMPT),
            chatMessage("user", `章节标题：${title}\n\n正文：\n${body}`)
          ],
          tools: [],
          signal,
          // 摘要是事实压缩，不要思考档，也不要联网——多一样都只是多一次不确定。
          thinkingLevel: "off",
          webSearchEnabled: false
        })) {
          if (event.kind === "text-delta") text += event.text;
          if (event.kind === "finish") break;
        }
      } catch {
        return null;
      }
      const trimmed = text.trim().slice(0, RECAP_MAX_CHARS);
      return trimmed === "" ? null : trimmed;
    }
  };
}

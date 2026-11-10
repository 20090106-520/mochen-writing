/**
 * 上下文占用条（spec §5）的装配与历史统计——从 agent-service.ts 为 800 行预算拆出来（P0-3）。
 *
 * 拆法与 agent-session-read.ts / multi-sample.ts 同款：只依赖「书 / 装配三件套 / 线程表 / 窗口数值」四项，
 * 不跑 turn、不碰提案、不共享可变状态。`assembleFor` 与 startTurn 走**同一条**装配路径，所以占用条上
 * 显示的条目数与字数就是这一轮真会发出去的那些——两处各装一遍的话，它就是骗人的装饰。
 */
import { UNBOUND, type ContextPreview, type ContextPreviewQuery } from "@mochen/contracts";
import {
  estimateTokens,
  eventsToMessages,
  findLatestSession,
  historyStatFor,
  readSession
} from "@mochen/agent-runtime";
import type { BookService } from "./book-service.js";
import type { TurnContext } from "./turn-context.js";

export interface ContextPreviewDeps {
  book: BookService;
  turnContext: TurnContext;
  /** 这条线程上一轮落盘的 jsonl（与 startTurn 共用同一张表，否则下一轮会拉回最近那条）。 */
  threadOf(threadKey: string): string | undefined;
  /**
   * 分母：模型配置里的上下文窗口（P0-3）。没填 / 读不出 ⇒ 回退到默认值。
   * 读盘与回退都归调用方，这里只管用——占用条不因配置读不出来整块报错。
   */
  windowTokens(): Promise<number>;
}

export function createContextPreview(
  deps: ContextPreviewDeps
): (query: ContextPreviewQuery) => Promise<ContextPreview> {
  return async function contextPreview(query: ContextPreviewQuery): Promise<ContextPreview> {
    const current = deps.book.current();
    if (current === null)
      return {
        profileId: "",
        profileName: "",
        items: [],
        chars: 0,
        approxTokens: 0,
        empty: true,
        // 没开书＝没历史：给全零而不是省略，面板不必再猜 undefined 的含义。
        history: historyStatFor(null)
      };
    const profile = deps.turnContext.profileOf(
      current,
      query.profileId ?? current.meta.activeStage
    );
    const { skills } = await deps.turnContext.readPinnedSkills(query.pinned ?? []);
    // 技能库索引也占系统提示的字数（2026-11-10）：不算进来的话占用条就少报一截，
    // 而「少报」和「多报」一样是骗人。它不进 items（没有正文，只有名字与一句说明）。
    const indexText = await deps.turnContext.readSkillIndex(query.pinned ?? []);
    const assembled = await deps.turnContext.assembleFor(
      current,
      query.docRelPath,
      profile,
      [],
      skills
    );
    // P1-3：占用条必须把历史这一格算进去——不报历史，剩余预算就是假的（面板上的「还能塞」骗人）。
    // 数字只有 `historyStatFor` 那一份判据：这里再手搓一遍字段映射，就是第二套口径（铁律 6）。
    // P0-3：分母取自模型配置的上下文窗口；读不出配置时回退到默认值，占用条不因此整块报错。
    const windowTokens = await deps.windowTokens();
    let historyStat = historyStatFor(null, windowTokens);
    try {
      const key = query.docRelPath ?? UNBOUND;
      const rel = deps.threadOf(key) ?? (await findLatestSession(current.root, key));
      if (rel !== null) {
        const stored = await readSession(current.root, rel);
        // 预览按「预留为零」的上界算（historyStatFor 里钉着）：真实 startTurn 只会切得更狠、
        // 不会更松，占用条宁可略保守也不骗人说还有余量。
        historyStat = historyStatFor(eventsToMessages(stored.events), windowTokens);
      }
    } catch {
      // 坏线程/坏 JSONL：历史这一格归零，占用条其余部分照常。
    }
    return {
      profileId: profile.id,
      profileName: profile.name,
      // 只回标签与字数：渲染层不需要正文，也不该拿到正文
      items: assembled.items.map((item) => ({
        kind: item.kind,
        relPath: item.relPath,
        title: item.title,
        chars: item.chars,
        active: item.active
      })),
      chars: assembled.chars + [...indexText.text].length,
      approxTokens: assembled.approxTokens + estimateTokens(indexText.text),
      empty: assembled.items.length === 0 && indexText.text === "",
      skillIndex: {
        chars: [...indexText.text].length,
        shown: indexText.shown,
        total: indexText.total
      },
      history: historyStat,
      // 分母递引用：窗口真身取自模型配置；没填过就是 agent-runtime 回退的那枚默认值
      // （DEFAULT_CONTEXT_WINDOW_TOKENS 住在 contracts，渲染层同源读它）。
      windowApproxTokens: windowTokens
    };
  };
}

/**
 * 一轮对话要装配进上下文的那些正文——从 agent-service.ts 为 800 行预算拆出来（P0-② 收口）。
 *
 * 【拆法与理由】同 agent-session-read.ts / prompt-assembly.ts：这三件事（按档案算「会被装的篇」、
 * 读挂入技能正文、解析这一轮用哪枚档案）只依赖 `book` 与 `readSkill` 两项，不跑 turn、不碰提案、
 * 不共享状态，所以能整体搬走而**不新增第二份判据**（铁律 6）。`assembleFor` 同时供 `startTurn`
 * 与 `agent:context-preview` 的占用条使用——两处必须走同一条装配路径，否则占用条就是骗人的装饰。
 */
import {
  assembleContext,
  selectBudgetDocPaths,
  type AssembledContext
} from "@mochen/agent-runtime";
import { resolveProfile, type AgentProfile } from "@mochen/contracts";
import { readDocFile } from "@mochen/fs-store";
import type { BookService, BookSnapshot } from "./book-service.js";

/** 挂入的技能在装配层的形状：正文已经读好，relPath 是 `${source}:${dirName}`（与 SkillRef.id 同形）。 */
export interface PinnedSkill {
  relPath: string;
  title: string;
  text: string;
}

export interface TurnContextDeps {
  book: BookService;
  /**
   * 读一份挂入的技能（spec §11）。读不到就抛中文——这里**不吞**：调用方要把
   * 「有 N 个挂入技能读不到」如实说给用户（总 spec §9：失败可见，不只进日志）。
   * 不给这一项时挂入技能一律读不到，也就是「没挂技能」与「挂了但没接上」在链路上分得出来。
   */
  readSkill?: ((relPath: string) => Promise<{ title: string; text: string }>) | undefined;
}

export interface TurnContext {
  assembleFor(
    book: BookSnapshot,
    docRelPath: string | null,
    profile: AgentProfile,
    pinned: readonly string[],
    skills?: readonly PinnedSkill[]
  ): Promise<AssembledContext>;
  readPinnedSkills(
    skillPaths: readonly string[]
  ): Promise<{ skills: PinnedSkill[]; missing: number }>;
  profileOf(book: BookSnapshot, stageId: string): AgentProfile;
}

export function createTurnContext(deps: TurnContextDeps): TurnContext {
  /**
   * 读出这一轮要装配进上下文的那些正文（spec §5）。读盘在这里（不在 agent-runtime：
   * 那份是纯函数），读不到的文档静默跳过。2026-10-15 按预算读：`selectBudgetDocPaths` 按
   * `profile.context` 算「会被装的篇」清单，只读这些——1000 章主笔档案从 1004 次
   * readDocFile 降到个位数。openings 不再读全文（scan 顺路带 `DocRef.opening`）。预算判据
   * 与 assembleContext 同源、住 agent-runtime 一份；不变量「预算 ⊇ 实装」钉在 context.test.ts。
   */
  async function assembleFor(
    book: BookSnapshot,
    docRelPath: string | null,
    profile: AgentProfile,
    pinned: readonly string[],
    skills: readonly PinnedSkill[] = []
  ): Promise<AssembledContext> {
    const budget = selectBudgetDocPaths({
      scope: profile.context,
      docs: book.docs,
      activeDocRelPath: docRelPath,
      pinned,
      chapterOrder: book.meta.chapterOrder
    });
    const contents: Record<string, string> = {};
    await Promise.all(
      budget.map(async (relPath) => {
        try {
          contents[relPath] = (await readDocFile(book.root, relPath)).content;
        } catch {
          // 读不到就当这条不存在：宁可少装一条，也不让整轮对话起不来
        }
      })
    );
    return assembleContext({
      profile,
      activeDocRelPath: docRelPath,
      docs: book.docs,
      contents,
      pinned: [...pinned, ...skills.map((skill) => skill.relPath)],
      pinnedExtra: skills.map((skill) => ({
        relPath: skill.relPath,
        title: skill.title,
        text: skill.text
      })),
      chapterOrder: book.meta.chapterOrder
    });
  }

  /**
   * 把渲染层传来的 `skillPaths` 读成正文（spec §11）。
   * 读不到的**不静默**：回一句「有 N 个挂入技能读不到，已跳过」，调用方把它发成 error 事件。
   * 一条都读不到时返回空数组，让调用方发那句中文而不是一条空数组。
   */
  async function readPinnedSkills(
    skillPaths: readonly string[]
  ): Promise<{ skills: PinnedSkill[]; missing: number }> {
    if (skillPaths.length === 0) return { skills: [], missing: 0 };
    // 读取通路没接上 ⇒ 全部算读不到。**不**当成「没挂技能」悄悄放过：
    // 那会让装配处漏接 readSkill 变成一条「用户挂了技能但模型没看见」的死链路。
    if (deps.readSkill === undefined) return { skills: [], missing: skillPaths.length };
    const readSkill = deps.readSkill;
    const settled = await Promise.all(
      skillPaths.map(async (relPath) => {
        try {
          const got = await readSkill(relPath);
          return { ok: true as const, relPath, title: got.title, text: got.text };
        } catch {
          return { ok: false as const, relPath };
        }
      })
    );
    const skills: PinnedSkill[] = [];
    let missing = 0;
    for (const one of settled) {
      if (one.ok) skills.push({ relPath: one.relPath, title: one.title, text: one.text });
      else missing += 1;
    }
    return { skills, missing };
  }

  /** 这一轮用哪枚档案：书级 activeProfile 优先，其余由 contracts 的四级解析兜。 */
  function profileOf(book: BookSnapshot, stageId: string): AgentProfile {
    return resolveProfile({
      activeProfile: book.meta.activeProfile ?? null,
      stages: book.meta.stages,
      activeStage: stageId
    });
  }

  return { assembleFor, readPinnedSkills, profileOf };
}

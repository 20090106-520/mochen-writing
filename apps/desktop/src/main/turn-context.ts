/**
 * 一轮对话要装配进上下文的那些正文——从 agent-service.ts 为 800 行预算拆出来（P0-② 收口）。
 *
 * 【拆法与理由】同 agent-session-read.ts / prompt-assembly.ts：这三件事（按档案算「会被装的篇」、
 * 解析挂入技能清单、解析这一轮用哪枚档案）只依赖 `book` 与 `listSkills` 两项，不跑 turn、不碰提案、
 * 不共享状态，所以能整体搬走而**不新增第二份判据**（铁律 6）。`assembleFor` 同时供 `startTurn`
 * 与 `agent:context-preview` 的占用条使用——两处必须走同一条装配路径，否则占用条就是骗人的装饰。
 *
 * P0-2 起，挂入技能只在这里取**清单行**（名称 / 用途 / 何时用），技能正文由 `use_skill` 按需读，
 * 装配层不读全文。
 */
import {
  assembleContext,
  selectBudgetDocPaths,
  type AssembledContext
} from "@mochen/agent-runtime";
import {
  resolveProfile,
  skillBriefLine,
  skillIndexBlock,
  type AgentProfile,
  type SkillIndexResult,
  type SkillRef
} from "@mochen/contracts";
import { readDocFile } from "@mochen/fs-store";
import type { BookService, BookSnapshot } from "./book-service.js";
import { readStoryBibleEntries } from "./story-bible-read.js";

/**
 * 挂入的技能在装配层的形状。`relPath` 是 `${source}:${dirName}`（与 SkillRef.id 同形），
 * `text` 是**清单行**（名称（id）+ 一句话用途 + 阶段/文稿，见 `skillBriefLine`），不是技能正文。
 * 正文由 `use_skill` 按 id 按需读取（P0-2）：挂多少技能都不占系统提示的正文额度。
 * 行内**不再**缀「需要时用 use_skill 读取」——那句话由上下文包末尾的 `SKILL_HINT` 说一次。
 */
export interface PinnedSkill {
  relPath: string;
  title: string;
  text: string;
}

export interface TurnContextDeps {
  book: BookService;
  /**
   * 技能清单（P0-2）：系统提示只放名称 / 用途 / 何时用，正文留给 `use_skill` 按需读。
   * 不给 ⇒ 挂入的技能一律算读不到，不悄悄当成「没挂技能」。
   *
   * 装配层**不读技能正文**，所以这里没有 `readSkill`：正文那一路由工具宿主按 id 现读，
   * 读到的仍是原来那份全文（`readSkill` 一字未改，见 doc-tools-host / index.ts）。
   */
  listSkills?: (() => Promise<readonly SkillRef[]> | readonly SkillRef[]) | undefined;
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
  /** 「库里还有哪些技能没挂入」那一段（2026-11-10）。读不到清单时回空结果—— */
  readSkillIndex(skillPaths: readonly string[]): Promise<SkillIndexResult>;
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
    const bibleEntriesPromise = readStoryBibleEntries(book.root);
    await Promise.all(
      budget.map(async (relPath) => {
        try {
          contents[relPath] = (await readDocFile(book.root, relPath)).content;
        } catch {
          // 读不到就当这条不存在：宁可少装一条，也不让整轮对话起不来
        }
      })
    );
    // W-01：设定面板的内容过去从不进上下文（作者写了「林夜」，模型仍当新角色）。
    // 读文件与上面那批正文读取并行；读不到/坏文件时 readStoryBibleEntries 回空表，
    // 装配层就当这本书没有设定库，这一轮照常生成。
    const bible = await bibleEntriesPromise;
    let bibleCorpus = "";
    if (bible.length > 0) {
      // 「与本章相关」的判定语料 = 当前章正文 + 章纲/大纲。正文通常在预算里已经读过，
      // 没读到的（例如世界设定档案 currentChapter="none"）只为匹配名字补读一次，不装进上下文。
      bibleCorpus = await collectBibleCorpus(book, docRelPath, contents);
    }
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
      chapterOrder: book.meta.chapterOrder,
      bible,
      bibleCorpus
    });
  }

  /**
   * 收集用来判断「这条设定和本章有没有关系」的语料：当前章正文 + 所有章纲/大纲。
   *
   * 已经读过正文的篇直接从 `contents` 拿；不在预算里的只为匹配名字补读——只用于
   * `includes` 判名，不会成为上下文条目，所以不吃上下文额度。读不到就跳过，
   * 退化成「没有语料」，此时装配层按 importance 降级选取，而不是整轮失败。
   */
  async function collectBibleCorpus(
    book: BookSnapshot,
    docRelPath: string | null,
    contents: Readonly<Record<string, string>>
  ): Promise<string> {
    const targets = new Set<string>();
    if (docRelPath !== null) targets.add(docRelPath);
    for (const doc of book.docs) if (doc.kind === "outline") targets.add(doc.relPath);
    const parts: string[] = [];
    await Promise.all(
      [...targets].map(async (relPath) => {
        const known = contents[relPath];
        if (known !== undefined) {
          if (known !== "") parts.push(known);
          return;
        }
        try {
          parts.push((await readDocFile(book.root, relPath)).content);
        } catch {
          // 同一套"读不到就当没有"的口径
        }
      })
    );
    return parts.join("\n");
  }

  /**
   * 取一次技能库清单。**通路没接上**与**读失败**都回 null，但两者在下游的处置不同：
   * 挂入技能那边要把「读不到」如实数出来（用户挂了却没生效，必须可见）；
   * 索引那边只回空段（少一段索引不影响这一轮能不能写）。
   */
  async function listAll(): Promise<readonly SkillRef[] | null> {
    if (deps.listSkills === undefined) return null;
    try {
      return await deps.listSkills();
    } catch {
      return null;
    }
  }

  /**
   * 「库里还有哪些技能没挂入」那一段（2026-11-10）。只列名称 / id / 一句说明，正文不读。
   *
   * 挂入机制只能摆出被挑中的那几枚；库里的其余技能模型无从知道存在，
   * 「按需自己调用」就退化成了「只能用手挑」。这一段把整库摊开，读正文仍要 `use_skill`。
   * 额度由 `skillIndexBlock` 一处管（条数 + 字数双闸），这里不加第二份判据。
   */
  async function readSkillIndex(skillPaths: readonly string[]): Promise<SkillIndexResult> {
    const refs = await listAll();
    if (refs === null) return { text: "", total: 0, shown: 0 };
    return skillIndexBlock(refs, skillPaths);
  }

  /**
   * 把渲染层传来的 `skillPaths` 解析成**清单行**（P0-2）。
   *
   * 只列清单、不读正文：技能正文由 `use_skill` 按 id 按需读取，系统提示里只留
   * 名称（id）/ 一句话用途 / 阶段与文稿。这样「挂 12 条技能」也不再把整份 SKILL.md 塞进提示词；
   * 而 `use_skill` 读到的仍是原来那份全文（读取通路 `readSkill` 一字未改）。
   * 清单行不写读法（同一句挂几条就复读几遍）：读法由 `SKILL_HINT` 在上下文包末尾说一次。
   *
   * 读不到的**不静默**：回一句「有 N 个挂入技能读不到，已跳过」，调用方把它发成 error 事件。
   * 一条都读不到时返回空数组，让调用方发那句中文而不是一条空数组。
   */
  async function readPinnedSkills(
    skillPaths: readonly string[]
  ): Promise<{ skills: PinnedSkill[]; missing: number }> {
    if (skillPaths.length === 0) return { skills: [], missing: 0 };
    // 清单通路没接上 ⇒ 全部算读不到。**不**当成「没挂技能」悄悄放过：
    // 那会让装配处漏接 listSkills 变成一条「用户挂了技能但模型没看见」的死链路。
    const refs = await listAll();
    if (refs === null) return { skills: [], missing: skillPaths.length };
    const byId = new Map(refs.map((ref) => [ref.id, ref]));
    const skills: PinnedSkill[] = [];
    let missing = 0;
    for (const id of skillPaths) {
      const ref = byId.get(id);
      if (ref === undefined) {
        missing += 1;
        continue;
      }
      // 标题与技能库列表同源（frontmatter name，没写才退回目录名），
      // 与 readSkillForTurn 取 title 的那条规则一致，避免「同一份技能两个名」。
      skills.push({
        relPath: id,
        title: ref.displayName || ref.dirName,
        text: skillBriefLine(ref)
      });
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

  return { assembleFor, readPinnedSkills, readSkillIndex, profileOf };
}

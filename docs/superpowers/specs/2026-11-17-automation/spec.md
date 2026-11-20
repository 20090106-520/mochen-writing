# 功能侧自动化三件事：自动预读技能正文 / 写后自动体检 / 章末前情摘要

- 日期：2026-11-17
- 来源：用户「转向功能侧优化」→「自动化功能比如自动调用技能等其他东西」→ 在细分选项里选「全部」。
- 前置：界面侧「本书读数」四落点已完成并全绿（`docs/superpowers/specs/2026-11-16-book-readings-ui/`）；
  工作区还有一批未提交的界面改动（`prompt-chapter-drift.ts`、`SideNavNoticeDialog.vue`、`left-nav.css`、
  `editor-pane.css`、`dialog.css`），本刀**一个字都不回退**。
- 状态：待批准。批准后按 `tasks.md` 顺序执行；不提交、不推送。

## 零、先说清哪些东西已经存在，本刀不重做

- **自动选技已经存在**：`renderer/utils/skill-pick.ts`（打分与排序，唯一判据）、
  `renderer/utils/skill-auto.ts`（增删计划）、`renderer/stores/useAutoSkillStore.ts`（装配与撤销）。
  本刀一行打分都不改，只在它们之上加「预读哪一份正文」与「挂入之后的事」。
- **装配层 P0-2 边界**：`main/turn-context.ts` 只取技能**清单行**，正文由 `use_skill` 现读。
  本刀只为「显式预读」开一个口子，其余路径（用户手挂、技能库索引、use_skill）逐字不变。
- **体检与去 AI 味已经有真身**：`renderer/utils/doc-checkup.ts` 的
  `analyzeAiFlavor` / `findPunctuationIssues` / `findDuplicateSentences`。本刀不新造测量、不新增阈值。
- **前情提要已有装配**：`packages/agent-runtime/src/context.ts` 的第 ④ 段按「前 N 章尾部截取」装。

## 一、阶段 A：强命中时自动预读榜首技能正文

### A.1 要解决的事

自动挂入目前只把技能摆成**清单行**。模型看见「文风检查（global:check-style）：检查机器味」，
仍要再花一轮 `use_skill` 才读得到方法；而自动识别既然已经笃定「这一轮就用它」，
这一轮往返就是白烧的。A 的目标：**当且仅当榜首是唯一强命中时**，把它的正文直接注入这一轮系统提示。

「强命中」的判据是确定性的，不新编分数阈值：

- `picks.length === 0` ⇒ 不预读；
- 榜首与前一名（第二名）**分数相同** ⇒ 不预读（并列第一 = 没有谁更该被预读）；
- 否则预读榜首。

### A.2 契约（`packages/contracts`）

1. `src/skill.ts` 新增常量：

```ts
/** 自动预读正文的字数上限：够覆盖一份方法的主体，又不至于让「自动」变成「把技能库灌进提示词」。 */
export const SKILL_PRELOAD_MAX_CHARS = 4000;
```

2. `src/agent-event.ts` 的 `startTurnInputSchema` 新增**可选**字段：

```ts
preloadSkillId: z.string().min(1).max(SKILL_PATH_MAX_LEN).optional()
```

- 为什么可选：老调用方与既有夹具不传它，行为与从前逐字一致；只有自动识别的强命中才传。
- 名字用 `Id` 而不是 `Path`：值就是 `skillPaths` 里的 `${source}:${dirName}`，与现有 id 同一形状。
- 更新该 schema 上方的注释：说明它与 `skillPaths` 的关系（预读的那枚必须也在 `skillPaths` 里，
  由渲染层保证；主进程不为此加第二份校验）。

### A.3 渲染层

1. `renderer/utils/skill-auto.ts` 新增纯函数（可 node 单测）：

```ts
/** 这一轮该预读哪一份正文：只有「唯一榜首」才预读，并列第一与空榜都不预读。 */
export function preloadSkillIdOf(picks: readonly SkillPick[]): string
```

2. `renderer/stores/useAutoSkillStore.ts` 新增 getter：

```ts
preloadIdOf(state) {
  return (threadKey: string): string => preloadSkillIdOf(state.picksByThread[threadKey] ?? []);
}
```

3. `renderer/stores/useAgentStore.ts` 的 `send()` 里，`input` 增加：

```ts
...(preload !== "" ? { preloadSkillId: preload } : {})
```

`preload` 取自 `useAutoSkillStore().preloadIdOf(threadKey)`（`threadKey` 与 `skillPathsOf` 用同一个）。
不预读时**不带这个字段**，请求与从前逐字一致。

### A.4 主进程

1. `main/turn-context.ts`：

- `TurnContextDeps` 新增可选 `readSkill?: (id: string) => Promise<{ title: string; text: string }>`。
  复用 `index.ts` 已有的 `readSkillForTurn`（它已剥 frontmatter 与 `## 出处`、已挡停用），不新建读取通路。
- `TurnContext` 新增：

```ts
readPreloadSkill(id: string): Promise<{ title: string; text: string; clipped: boolean } | null>
```

  - 通路没接上 / 读失败 / 正文为空 ⇒ `null`（调用方决定怎么报）。
  - 正文超过 `SKILL_PRELOAD_MAX_CHARS` ⇒ 截断并 `clipped: true`。
- 文件头注释与 `readPinnedSkills` 的注释改成「**除显式预读外**不读正文」，
  并说明为何预读是安全的（用户开了自动、榜首唯一、字数有上限）。

2. `main/system-pack.ts`：

- `ContextPackInput` 新增 `preload?: { title: string; text: string; clipped: boolean } | null`。
- `buildContextPack` 在 `【已装配的上下文】` 之后、`【技能库】` 之前插入：

```
【本轮自动预读的技能：<title>】
<text>
（正文过长，已截断；需要全文用 use_skill 重新读。）
```

  最后一行只在 `clipped === true` 时出现。
- `SKILL_HINT` 在存在 preload 时换一句（同一文件内的 `SKILL_HINT_WITH_PRELOAD`）：
  「上面标注「技能」的条目里，除【本轮自动预读】那一份外都只是清单……」
  两句话住同一处，避免第三份说法。

3. `main/agent-service.ts`：

- 在现有 `Promise.all` 里并行取预读：

```ts
const preload =
  input.preloadSkillId === undefined
    ? null
    : await turnContext.readPreloadSkill(input.preloadSkillId);
```

- `preload === null` 且 `input.preloadSkillId !== undefined` ⇒ `emitOnly(...)` 一句中文
  （「自动预读的技能没读出来，这一轮按未预读继续。」），不失败整轮。
- `buildContextPack({ contextBlock, skillHint, skillIndex, preload })`；token 统计沿用
  `contextPackText` 一格，不新增预算口径。

4. `main/index.ts`：`createTurnContext({ book, listSkills, readSkill: readSkillForTurn })`。

### A.5 测试

- `renderer/utils/skill-auto.test.ts`（已存在则追加，不存在则新建）：`preloadSkillIdOf` 四条分支
  （空榜 / 唯一榜首 / 并列第一 / 只有一条）。
- `main/agent-service-boundary.test.ts` 追加一条：
  「传 `preloadSkillId` 时正文进系统提示并标注『本轮自动预读』；不传时正文一个字都不出现」。
  现有那条「正文留给 use_skill 按需读」保持绿——它不传预读字段，是 A 的对照组。
- 契约类型由 `pnpm typecheck` 覆盖，不另写 schema 快照。

## 二、阶段 B：生成结束后自动体检 + 去 AI 味

### B.1 纯函数

新文件 `renderer/utils/auto-checkup.ts`：

```ts
export interface AutoCheckupFinding {
  docRelPath: string;
  title: string;
  /** 去 AI 味命中（真身 analyzeAiFlavor，词表与提示词端同一份）。 */
  aiFlavor: AiFlavorHit[];
  /** 标点硬伤（findPunctuationIssues）。 */
  punctuation: PunctuationIssue[];
  /** 重复句（findDuplicateSentences）。 */
  duplicates: DuplicateSentence[];
  /** 三类合计条数，排序用。 */
  total: number;
}

/** 只保留真有问题的篇；按 total 降序、同分按 relPath 稳定序。 */
export function autoCheckupOf(
  docs: readonly { relPath: string; title: string; content: string }[]
): AutoCheckupFinding[];
```

- 阈值全部来自既有真身，不新增。空内容不检查（刚建的空白章不该报「全绿」也不该报问题）。

### B.2 触发与状态

1. `renderer/stores/useAgentStore.ts`：
   - 线程视图记录本轮成功写盘的 `written` 路径（现有 `written` 事件里已有 relPath；只记本轮、
     换轮清空，不落盘）。
   - `apply()` 的 `turn-end`（`status === "ok"`）分支末尾：若本轮写过盘，
     `void useAutoCheckupStore().run(threadKey, paths)`。**不阻塞回执**。
2. 新文件 `renderer/stores/useAutoCheckupStore.ts`：

```ts
state: {
  findingsByThread: Record<string, AutoCheckupFinding[]>;
  dismissedByThread: Record<string, boolean>;
  runningByThread: Record<string, boolean>;
}
actions: run(threadKey, relPaths) / dismiss(threadKey) / findingsOf(threadKey)
```

   - `run` 逐篇 `window.mochen.readDoc` 后调 `autoCheckupOf`；无问题 ⇒ 写空数组（不渲染）。
   - 读不到 ⇒ 安静跳过（体检是尽力而为，与 `loadAllDocContents` 同一条口径）。
3. UI：新组件 `renderer/components/AutoCheckupCard.vue`，挂在 `CenterColumn.vue` 对话流末尾：
   - 无 findings / 已 dismiss ⇒ 不渲染。
   - 有 ⇒ 一张紧凑卡片：一句「这一轮写完后自动体检：N 处可看」，按三类各列最多 3 条样例，
     右下角「查看全部」打开既有书稿体检对话框、「先不管」调 `dismiss`。
   - 样式追加到 `styles/agent-pane.css`（沿用现有卡片变量，不新开设计系统）。

### B.3 测试

- `renderer/utils/auto-checkup.test.ts`：空内容不报、三类各命中一条、只保留有问题的篇、
  排序稳定。
- 组件不引 `@vue/test-utils`（仓规）；以「纯函数 + store 测试」覆盖判据，UI 只做 v-if/v-for。
- store 测试：`run` 无问题时 findings 为空、`dismiss` 后 `findingsOf` 不再影响渲染判据。

## 三、阶段 C：自动维护章末前情摘要

### C.1 存储

- `packages/contracts/src/book.ts` 的 `bookMetaSchema` 新增**可选**：

```ts
/** 章末摘要（relPath → ≤300 字）。没有这本书/这一章就是空表，装配层退回尾部截取。 */
recaps: z.record(z.string(), z.string()).optional()
```

  为什么放 `book.json`：随书走、随备份走、`open` 已整份加载，不需要新 IPC 通道与第二份文件格式；
  1000 章 × 300 字约 300KB，可接受。老书没有这一格 ⇒ `undefined`，行为与从前一致。

- `packages/contracts/src/book.ts` 新增 `export const RECAP_MAX_CHARS = 300;`。

### C.2 生成（主进程）

新文件 `apps/desktop/src/main/chapter-recap.ts`：

```ts
export interface ChapterRecapDeps {
  settings: ProviderSettings;      // 与 agent-service 同一个实例
  fetchImpl: ProviderFetch;        // 同一个出网实现
  now: () => string;
}

/** 一次短调用：给一章正文，回 ≤300 字的事实摘要；失败回 null（不抛）。 */
export function createChapterRecap(deps: ChapterRecapDeps): {
  summarize(input: { title: string; content: string }): Promise<string | null>;
}
```

- 系统指令固定为中文事实摘要（谁做了什么、结果如何、留了什么钩子；不评价、不修饰），
  用 `streamChat` 的非流式聚合（与 agent-service 同一份出网栈），温度 0。
- 正文超过模型窗口预算时先截（`fitHistoryToWindow` 的同一份判据，不另算）。

### C.3 触发

- `agent-service.ts` 在 `turn-end` 成功且本轮有写盘时，**后台**排队一次 `summarize`：
  `void recapQueue.push({ relPath, title, content })`；不阻塞回执、不改变事件时序。
- 摘要回来后 `deps.book.saveMeta({ ...meta, recaps: { ...recaps, [relPath]: text } })`；
  写失败只 `console.warn`，不打扰用户（摘要是锦上添花，不是主线）。
- 同一章已在跑 ⇒ 合并（用 relPath 去重），不重复烧调用。

### C.4 装配

- `packages/agent-runtime/src/context.ts` 第 ④ 段「前情提要」：
  - 有 `book.meta.recaps[relPath]` ⇒ 该章用 `【摘要】` + 摘要（不再截尾部原文）；
  - 没有 ⇒ 退回现有「尾部 `PRIOR_CHAPTER_TAIL_CHARS` 字」。
  - 判据只在一处：`recapOf(recaps, relPath)`（`packages/contracts` 导出，纯函数）。
- `context.test.ts` 追加：有摘要时用摘要、没摘要时行为逐字不变。

## 四、纪律与验证

- 铁律 6：判据各只有一处（预读选择在 `preloadSkillIdOf`，体检在 `autoCheckupOf`，
  摘要回退在 `recapOf`）；界面只渲染，不重算。
- 不新增质量阈值；B 的阈值全部复用 contracts 现有真身。
- 单文件 ≤800 行；注释中文、解释「为什么」。
- 每阶段完成即跑：

```
pnpm typecheck
pnpm vitest run <本阶段相关测试文件>
pnpm verify        # 必须 VERIFY_EXIT=0
```

- 不提交、不推送，除非用户明确要求。

## 五、验收

1. **A**：开着自动技能、输入一句强命中某一技能的话发出去 ⇒ 该技能正文出现在系统提示的
   「【本轮自动预读的技能】」段；并列第一或没命中时该段不出现。既有 P0-2 用例全绿。
2. **B**：让模型写一章带 AI 味/标点硬伤的正文 ⇒ 回执之后出现一张紧凑体检卡；
   干净的一章不出现任何卡片。
3. **C**：写完一章（写到盘上）后打开下一章 ⇒ 前情提要里出现「【摘要】」而不是尾部原文；
   `book.json` 的 `recaps` 有该章一条 ≤300 字摘要。

# 墨宸 AI · Plan 3（交互层 S5 + 装配层 S6 + 磁盘路径迁移 F-4）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让重启后的中栏把历史线程与提案卡如实回放回来（F-6），把总 spec §7 的键位全表与 `/` 命令面板、权限档切换、主题三态落到 UI，并按总 spec §5/§5.1 把六个墨宸档案与上下文包装配进每一轮请求；顺带完成 F-4 磁盘目录迁移。

**Architecture:** 回放走一条新的只读 IPC（`agent:load-session`），渲染层用**同一个** `reduceEvent` 归约历史事件，只把未裁决的旧卡标成新状态 `expired` 而不伪装成可批准；键位判定全部下沉为纯函数 `utils/hotkeys.ts`，`Esc` 仍由既有 `resolveEscape` 唯一裁决；六个 `AgentProfile` 与上下文包构造器只活在 `packages/agent-runtime`（fs 通过注入的 `ContextReader`），渲染层经 IPC 拿 `ProfileView[]` 与 `ContextSummary`；F-4 迁移是一个依赖全注入的纯模块，先验解密成功才改旧目录的名。

**Tech Stack:** Node 24、pnpm 11（corepack）、Electron 42.5.0（safeStorage / ipcMain / dialog）、Vue 3.5.39、Pinia 3.0.4、TypeScript 6.0.3、zod 4.4.3、vitest 4.1.9。**零新增第三方依赖**，**不引入 `@vue/test-utils`**。

**Spec:** `docs/superpowers/specs/2026-10-02-plan3-interaction-and-assembly-design.md`（下称「Plan 3 spec」）
—— 实现其 §4（回放与水合）、§5（键位层）、§6（`/` 面板）、§7（权限档 UI）、§8（主题三态）、§9（六档案与上下文）、§10（阶段切换与浏览不打断）、§11（技能库）、§12（F-4）、§13（契约变更）、§14（门禁连带）、§15（变异台账）。
上游产品依据：`2026-10-01-mochen-writing-workbench-design.md`（下称「总 spec」）§3 / §4 / §5 / §5.1 / §6 / §7 / §8 / §10 / §11。

**依赖 Plan 2 已交付的：** `@mochen/agent-runtime`（`streamChat`/`runTurn`/`rollout`/`permission`/`tools`/`apply-patch`/`diff`）、主进程 `createAgentService()` 与 `agent-ipc.ts` 注册表、preload `createRendererApi` 工厂、渲染层 `useAgentStore`（事件归约 + 线程隔离）、`utils/timeline.ts`、`utils/escape-policy.ts`、`CenterColumn.vue` 与 `ProposalCard.vue`。

---

## Global Constraints

每个任务都隐含满足以下约束（值取自 spec 逐字）：

- **模型永不直接写盘**。唯一落盘通路是「人审批通过 → 主进程写」，写前备份到 `.mochen/changes/<时间戳>/`，指纹不符即拒。本片新增的任何档案、任何范围，都只是**上限**，不是授权（总 spec §5.1 约束 3）。
- 工具集**只有 5 个**：`read_doc`、`list_docs`、`search_docs`、`propose_patch`、`write_doc`。档案只能取子集，本片不得出现第 6 个工具。
- 权限三档 `read-only` / `chapter-write` / `full-access`，默认最保守的 `read-only`；拒绝一律回单句中文原因，不静默丢弃。
- **回放绝不复活「可批准的待审队列」**（Plan 3 spec D1）：重启后主进程 `pending`/`diffs` 是空的，未裁决的旧卡一律 `expired`、按钮禁用、单独分组。任何「按 JSONL 重建 pending 并重算 diff」的实现都不在本片范围内。
- `packages/contracts`、`packages/fs-store`、`packages/agent-runtime` 内**禁止** `import ... from "electron"`；`agent-runtime` 另禁止 `node:fs`（上下文读取一律走注入的 `ContextReader`）；渲染层禁止 import `@mochen/agent-runtime`。由 `tools/check-package-boundary.mjs` 强制。
- 单文件（`.ts`/`.vue`）**≤ 800 行**（`tools/check-source-line-budget.mjs:5`）。`CenterColumn.vue` 现 223 行，本片接线后**不得超过 400 行**；新控件一律新文件。
- **判定逻辑一律下沉 `utils`/`stores`**：`.vue` 只接线。本仓不引 `@vue/test-utils`，模板层零自动化覆盖是既定事实，不得把判断写回组件。
- **枚举与映射只许一份实现**（铁律 6）：`as const` + 派生类型 + `Record<联合类型, string>` 标签表。禁止手抄三元链；加枚举成员必须同时逼出中文说明与动作。
- 所有面向用户与回喂模型的文案为简体中文；错误可见（进对话流或 `notice`），不只进日志。
- **模型密钥纪律（不可协商）**：密钥只进主进程、只进 `Authorization: Bearer` 头、绝不进 URL query、绝不以明文落盘、绝不写进 spec/plan/仓库文件/日志/记忆。真机冒烟只在设置对话框里输入，经 safeStorage 落 `secrets.enc`；本次会话里出现过的密钥串冒烟后必须轮换，并在报告里记一句「已提醒轮换」。渲染层只见 `maskApiKey`。
- `book.json` 与 `.mochen/` 是天花板：`book.json` 永远不由智能体写；`scanBook` 继续跳过 `.mochen`，**不为技能浏览破例改文稿扫描**。
- 断言必须证明能失败：每个任务先写反向用例（红→绿），关键任务做**变异实验**（只用 Edit 改代码，禁 `perl -i`/`sed -i`）。只报「全绿」不算验证。
- 门禁退出码不能被管道吞掉：跑完必须回读日志里的 `VERIFY_EXIT=0` 与用例总数；`pnpm` 一律 `corepack pnpm`。
- 本机 dev 在跑时全量 vitest 会假红灯（每次红的文件不同）；一律 `--maxWorkers=4`，异常时按文件重跑复核。
- 测试写盘一律用 `mkdtemp` 真临时目录；绝不拿 `C:\Users\17863\Desktop\深渊写作` 之外的真人书稿当测试对象，也绝不在测试里跑 `dialog.showMessageBox`。
- **契约与其消费方必须在同一任务落地**（Plan 1 踩过的坑）：加 `IPC_CHANNELS` 键 → 同任务改 `RendererApi` + preload 工厂 + `renderer-api.test.ts` 的字面量计数；加必填字段 → 同任务改完所有夹具。每个中间提交都要过 tsc。
- 一波一提交，每波 ≤12 任务且 ≤150 轮（Plan 2 波 B 撞过上限）。波次结束跑全量门禁 + 真机冒烟 + 台账；**真机 UI 操作与代码评审不委托给子代理**。

---

## 设计决定（Plan 3 spec 没写死、本计划拍定的八条）

对着同一套口径，而不是各自猜。

1. **档案选择状态放 `useAgentStore`，不放 `useBookStore`。** 理由：档案与线程同生命周期（同一章永远同一条线程，总 spec §5.1 约束 1），而 `useBookStore` 管的是盘上事实与草稿；`profiles: ProfileView[]` 与 `profileIdByThread` 都是会话侧派生态。
2. **上下文占用条需要一条只读预览 IPC（`agent:context-preview`）。** 这是本片相对 Plan 3 spec §13 的**唯一新增通道**：占用条必须在「发送前」随章节/档案/挂入技能变化，而装配只在主进程发生，渲染层拿不到。Plan 3 spec §13 的 16/18 计数因此变成 **17/19**，本计划已按新值写死各任务的连带清单（同处已回改 spec 表格）。
3. **`ContextSummary` 是 contracts 类型，`ContextPack` 是 runtime 类型。** 渲染层禁止 import `agent-runtime`，所以占用条只吃 `ContextSummary`（`sections/charCount/estimate/omitted` 的视图形状）；`contextSummaryOf(pack): ContextSummary` 放在 `agent-runtime/src/context-pack.ts`（runtime 可以 import contracts），主进程只做转发。
4. **技能浏览用 `useBookStore.skillBrowser` 单格槽位，不复用 `browseTabs`。** 理由：`browseTabs` 的元素是 `DocRef`，而技能不是 `BookKind`（Plan 3 spec §11）；把技能硬塞进 `DocRef` 要伪造 `kind`/`relPath` 语义，比开一个单格槽位更脏。同一时刻只显示一个技能正文，够用地换取「浏览永不打断」的四条断言好写。
5. **`/model` 与 `Ctrl+,` 都走既有设置视图，不新建弹层。** 分类字面量一律复用现有 `settingsInitialCategory` 取值（执行时先 grep 现值），外观页作为该视图的一节加入（Plan 3 spec §8）。
6. **面板开关是 `CenterColumn.vue` 的局部 ref，经 `useGlobalHotkeys(handlers)` 回调进来。** 理由：面板没有跨组件状态，塞进 store 等于给一个瞬时 UI 态建立持久真相；`/` 的动作判定仍在纯函数里，只有「打开」这个效果需要宿主配合。
7. **`queued` 队列不进 `StartTurnInput`、不进事件。** 排队是渲染层视图态（Plan 3 spec §5.1），`turn-end` 到达后取队首调既有 `send()`；主进程与盘上格式一字不改。
8. **`schemaVersion` 保持 1。** 本片只往 `book.json` 与 `SessionMeta` 加**可选**字段，老文件读出来语义不变。规则写死：只有「老文件读出来会语义错误」时才升版本。

## 与 Plan 3 spec 的差异（本计划拍定，评审先看这里）

逐条都是「spec 少写了一步、或写死了一个不可测的形状」，不是各任务自行偏离。执行者与评审以本节为准，不要再回 spec 找这些形状。

1. **逐档「上下文侧重」不在本片实现**（最大的偏离，也最要说清）。Plan 3 spec §9.1 的花名册表最后一列写了六条侧重（`world` 素材+大纲空位、`chief-editor` 各章摘要、`continuator` 本章全文不截断、`reviewer` 世界观+文风规则……），但同一份 spec §9.3 只给**一个** `buildContextPack(reader, request)`，而「各章摘要」「未回收伏笔」「文风规则」在本仓**没有数据源**（没有摘要文件、没有伏笔台账、`style` 不是 `BookKind` 目录）。所以六个档案的 `buildSections` 是**同一个函数引用** `delegateSections`（Task 13 用「六个引用全等」钉死），档案间差异只落在 `systemPrompt` / `allowedTools` / `writeScope` 三处——这三处是真闸（M6/M7 的证据就在这里），侧重列描述的取数差异留待后续片（回补路径：给 `ContextReader` 加端口 + 给 `ContextRequest` 加节选择字段，两者都是 runtime 内部类型，不动 contracts）。
2. **`createBookPromptAssembler` 的依赖是 `{ book, reader }`**，不是 spec §9.3 那句 `{ book, reader, profiles }`。roster 由 runtime 自己 export，`profileById` 是模块级纯函数，把它做成注入点只会多一个「传进来的 roster 和用的 roster 不是同一份」的失败模式。
3. **`AgentServiceDeps.promptFor` 返回 `AssembledPrompt`（`{ text, unreadableSkills }`）而不是 spec 的 `Promise<string>`**：spec §11 要求「技能读不到要可见」，而可见句子的素材（哪几个 id 读不到）只在装配那一刻存在。收口点与句子逐字在 Task 24。
4. **`ContextReader` 是四端口（+`readSkill`），`ContextPack` 多一个 `unreadableSkills`**，两者都**不进 contracts**；`ContextSummary` 保持 spec §9.3 的四键不变（加键就是改契约还要连带渲染层）。
5. **`AppDataMigrationDeps` 追加 `now?` / `exists?` 两个注入点，并新增 `migrationNotice(report, { newDir })`**：spec §12 的依赖表让「带时间戳的保留目录名」与「新目录已有同名文件」两条分支不可测，且弹窗文案会在 `index.ts` 里长出第二份实现。Task 25 的测试全用内存假 fs，不碰 electron。
6. **挂入状态的归属**：spec §3 第 23 行叫 `skillsByThread`，本计划改名 `skillPathsByThread` 并放在 `useAgentStore`（与载荷字段 `StartTurnInput.skillPaths` 同名同义）；`useSkillsStore` 只做「取列表 / 取正文 / 打开库」，**不持有挂入状态**——一份真相原则下它若也存一份，「关标签再开」就会不同步。

---

## 文件结构（先定边界，再切任务）

```
墨宸 AI/
  packages/contracts/src/
    ipc.ts                    追加 7 个通道键（波 1 一条、波 2 四条、波 3 两条）+ RendererApi 七个同名方法（12 → 19）
    agent-event.ts            追加 SessionLoadResult；StartTurnInput +profileId +skillPaths；SessionMeta +profileId?
    patch.ts                  PROPOSAL_STATUSES + "expired"；PROPOSAL_STATUS_LABELS +expired；新增 PROPOSAL_MODE_LABELS
    profile.ts                新增：ProfileView
    context.ts                新增：CONTEXT_SECTION_KINDS / ContextSectionKind / ContextSectionView / ContextSummary / ContextPreviewInput
    skill.ts                  新增：SKILL_SOURCES / SkillSource / SkillRef / SkillContent
    book.ts                   BookStage +profileId?
    index.ts                  追加 re-export（profile/context/skill）
    test/agent.test.ts        追加 SessionLoadResult / expired / profileId 的 schema 用例
    test/contract.test.ts     追加通道计数与 ProfileView/SkillRef 形状用例

  packages/agent-runtime/src/
    profiles.ts               新增：AgentProfile / AGENT_PROFILES 六条 / DEFAULT_PROFILE_ID / profileById / profileViews / WriteScope / profileAllowsDoc
    context-pack.ts           新增：ContextReader / ContextRequest / ContextSection / ContextPack / buildContextPack / estimateTokens / contextSummaryOf + 三个常量
    rollout.ts                不改（findLatestSession / readSession 直接复用）
    tools.ts                  不改（TOOL_SPECS 由调用方按档案过滤）
    index.ts                  追加 re-export
    test/profiles.test.ts     新增：roster 逐条对照花名册 + allowedTools ⊆ 五工具 + profileAllowsDoc 矩阵
    test/context-pack.test.ts 新增：假 reader + 预算整节丢弃 + 码点切片 + estimateTokens

  packages/fs-store/src/
    skills.ts                 新增：scanSkills(dir, source)（frontmatter 复用 frontmatter.ts，不动 scan.ts）
    test/skills.test.ts       新增：目录缺失/坏 frontmatter/排序/去重

  apps/desktop/src/main/
    agent-service.ts          loadSession() 新增；promptFor 异步化；档案范围闸；autoSession 键改 ${threadKey}::${profileId}
    agent-ipc.ts              四张注册表收口本片七条新通道：`registerAgentIpc` 六条（既有四条 + load-session + context-preview）、`registerProfileIpc` 一条、`registerAppearanceIpc` 两条、`registerSkillsIpc` 两条；白名单一条不多一条不少
    book-prompt.ts            新增：createBookPromptAssembler({ book, reader })——defaultPromptFor 的替代者（波 2 回 string，波 3 回 AssembledPrompt）
    context-reader.ts         新增：fs 版 ContextReader（listDocs/readDoc/charactersOf，用 fs-store 读盘与解析 frontmatter；Task 24 加第四端口 readSkill 与第二个依赖 skills）
    appearance-settings.ts    新增：createAppearanceSettings({ dir, readFile?, writeFile? })
    skills-service.ts         新增：createSkillsService({ globalDir, bookRoot, readFile?, realpath? })：list() + read(source, relPath) 路径安全
    app-data-migration.ts     新增：migrateLegacyAppData(deps)（F-4，依赖全注入）
    index.ts                  appDataDir 改 mochen-ai；whenReady 里在建 credential store 之前跑迁移 + dialog 播报；装配 profile/appearance/skills IPC
    agent-service.test.ts     追加 loadSession / 档案闸 / promptFor 异步夹具连带
    app-data-migration.test.ts / appearance-settings.test.ts / skills-service.test.ts   新增

  apps/desktop/src/preload/
    renderer-api.ts           工厂追加六个同名方法
    renderer-api.test.ts      字面量计数 12 → 13（波 1）→ 17（波 2）→ 19（波 3）

  apps/desktop/src/renderer/src/
    utils/hotkeys.ts          新增：HotkeyMods / HotkeyFocus / HotkeyAction / HotkeyResult / resolveHotkey（纯函数）
    utils/hotkeys.test.ts     新增：焦点 × 键矩阵 + 五条护栏反向用例
    utils/slash-commands.ts   新增：SLASH_COMMANDS / SLASH_COMMAND_DESCRIPTIONS / availableCommands / parseSlashInput（纯函数）
    utils/slash-commands.test.ts
    utils/context-bar.ts      新增：formatContextBar(summary: ContextSummary): string（纯函数）
    utils/theme-mode.ts       新增：resolveEffectiveScheme(mode, systemScheme)（纯函数）
    utils/timeline.ts         追加 replayProposalStatuses / splitProposalCards 第三组 expired / NewCard 形状
    composables/useHotkeys.ts 新增：useGlobalHotkeys(handlers) 薄壳 ≤40 行（全局唯一 keydown 监听）
    stores/useAgentStore.ts   ThreadView +hydrated +hydrating +queued；ensureHydrated；reduceEvent 第三参；queue/flush；profiles + profileIdByThread + skillPathsByThread + attachSkill/detachSkill/skillIdsFor
    stores/useBookStore.ts    setPermissionMode / setActiveStage / activateTab / cycleTab / skillBrowser + openSkillBrowser / closeSkillBrowser
    stores/useAppearanceStore.ts  新增：settings/persisted/load/setMode/setPreset/resetToDefault/effectiveScheme
    stores/useSkillsStore.ts  新增：list 缓存 + read 缓存 + openLibrary()（挂/摘**不在**这里，归 useAgentStore，见「与 spec 的差异」第 6 条）
    components/SlashPalette.vue     新增：7 条命令面板（↑↓/Enter/Esc 自处理）
    components/PermissionMenu.vue   新增：三档 popover（文案读 PERMISSION_LABELS）
    components/AppearancePanel.vue  新增：三态分段 + 主题预设 + 恢复默认
    components/ProfilePicker.vue    新增：阶段 × 档案两个选择器 + 上下文占用条
    components/SkillBrowser.vue     新增：技能只读正文 + 「加入当前上下文」
    components/CenterColumn.vue     改为接线：水合时机、单一 keydown、面板挂载、头部改造
    components/ProposalCard.vue     删三元链改查表；expired 态禁用按钮 + 一句中文
    components/DocumentPane.vue     右栏加技能浏览格优先级
    App.vue                     挂载先 load 外观再 applyTheme；matchMedia 监听只在 system 模式注册
    styles/interaction.css        新增：面板/菜单/占用条/技能浏览样式（毛玻璃延续既有 token）
    styles.css                  追加 @import
  tools/mock-provider.mjs       追加 /__requests 抓取（冒烟用：证明 system 与 tools 随档案变化）
  docs/superpowers/…            计划 README、Plan 3 冒烟报告、总 spec 路径更正
```

每个新增纯函数模块保持在 40–250 行；`useAgentStore.ts` 现 358 行，若加完水合与排队逼近 500 行，把回放派生逻辑留在 `utils/timeline.ts`，档案与技能态拆到 `stores/useProfileStore.ts`（行数门禁会告诉我们）。

---

## 接口总表（跨任务签名，逐字照此实现）

任何任务用到别人的接口时**以本表为准**；本表没写的形状属于该任务内部细节。类型一律从 `@mochen/contracts` 或就近模块 import，不得就地复制一份结构体。

### 波 1

```ts
// packages/contracts/src/ipc.ts
IPC_CHANNELS.agentLoadSession = "agent:load-session";
RendererApi.loadSession(threadKey: string): Promise<SessionLoadResult>;

// packages/contracts/src/agent-event.ts（逐字照 Plan 3 spec §4.1）
export type SessionLoadResult =
  | { found: true; relPath: string; meta: SessionMeta; events: AgentEvent[]; droppedLines: number[] }
  | { found: false; reason: "no-book" | "no-session"; message: string };

// packages/contracts/src/patch.ts
export const PROPOSAL_STATUSES = ["pending", "written", "rejected", "cancelled", "stale", "failed", "expired"] as const;
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string>;   // + expired: "上次会话未处理"
export const PROPOSAL_MODE_LABELS: Record<PatchMode, string> = { "anchor-replace": "锚点替换", "doc-overwrite": "整篇替换" };

// apps/desktop/src/main/agent-service.ts
AgentService.loadSession(threadKey: string): Promise<SessionLoadResult>;   // 永不抛（IPC 层抛除外）

// apps/desktop/src/renderer/src/stores/useAgentStore.ts
interface ThreadView { /* 现有 7 字段 */ hydrated: boolean; hydrating: boolean; queued: string[] }
ensureHydrated(threadKey: string): Promise<void>
reduceEvent(thread: ThreadView, event: AgentEvent, options?: { fetchDiff?: boolean }): void   // 默认 fetchDiff: true
queueText(threadKey: string, text: string): boolean   // 满 5 条返回 false 并写 notice
// QUEUED_MAX = 5（模块顶层常量）
composeStatusLine(..., queued: number): string        // 新增最后一个入参，运行中显示「排队 N 条」

// apps/desktop/src/renderer/src/utils/timeline.ts
export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus>
export function splitProposalCards<T extends ProposalCardInput>(cards: T[], anchors: Record<string, TurnAnchor>): { open: T[]; settled: T[]; expired: T[] }

// apps/desktop/src/renderer/src/utils/hotkeys.ts（逐字照 Plan 3 spec §5）
export interface HotkeyMods { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }
export interface HotkeyFocus {
  composerIsFocused: boolean; composerHasText: boolean; textInputIsFocused: boolean;
  proposalIsFocused: boolean; proposalIsPending: boolean; turnRunning: boolean;
  isComposing: boolean; hasBook: boolean; tabCount: number;
}
export type HotkeyAction =
  | "submit" | "newline" | "queue" | "delegated" | "none"
  | "approve-once" | "approve-session" | "approve-prefix" | "deny-guidance"
  | "next-tab" | "prev-tab" | "jump-tab"
  | "toggle-left" | "open-settings" | "open-palette";
export interface HotkeyResult { action: HotkeyAction; tabIndex?: number }
export function resolveHotkey(focus: HotkeyFocus, key: string, mods: HotkeyMods): HotkeyResult

// apps/desktop/src/renderer/src/composables/useHotkeys.ts
export interface HotkeyHandlers { openPalette(): void }
export function useGlobalHotkeys(handlers: HotkeyHandlers): void   // 挂载装监听、卸载摘监听；全局唯一 keydown

// apps/desktop/src/renderer/src/utils/slash-commands.ts（波 1 落 6 条）
export const SLASH_COMMANDS = ["model", "permissions", "status", "stage", "resume", "clear"] as const;   // 波 3 追加 "skills" → 7 条
export type SlashCommand = (typeof SLASH_COMMANDS)[number];
export interface PaletteFocus { hasBook: boolean; turnRunning: boolean }   // 波 2 追加 profilesReady: boolean
export function availableCommands(focus: PaletteFocus): SlashCommand[]
export function parseSlashInput(text: string): { command: SlashCommand | null; argument: string }
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string>

// apps/desktop/src/renderer/src/stores/useBookStore.ts
setPermissionMode(mode: PermissionMode): Promise<void>     // 组 meta → saveMeta → 失败进 notice；无书时报原因不静默
activateTab(index: number): boolean                        // 越界返回 false，不改状态
cycleTab(delta: 1 | -1): void                              // 无标签时不动
setActiveStage(stageId: string): Promise<void>              // 写 activeStage，并把该线程档案切到 stage.profileId ?? ""
// 形状在波 1 声明（`/stage` 与档案选择器都要它），**落地件在 Task 18**：波 1 的十个任务里没有它的实现，
// 谁先动谁就是把「只写 activeStage」的半件落下去，Task 18 那一版是它的超集（含连带切档案 + saveMeta 失败进 notice）。
```

### 波 2

```ts
// packages/contracts/src/profile.ts
export interface ProfileView { id: string; displayName: string; blurb: string; allowedTools: AgentToolName[] }

// packages/contracts/src/context.ts
export const CONTEXT_SECTION_KINDS = ["doc", "outline", "characters", "prev-chapters", "skills", "materials"] as const;
export type ContextSectionKind = (typeof CONTEXT_SECTION_KINDS)[number];
export interface ContextSectionView { kind: ContextSectionKind; label: string; charCount: number; truncated: boolean }
export interface ContextSummary { sections: ContextSectionView[]; charCount: number; estimate: number; omitted: string[] }
export interface ContextPreviewInput { threadKey: string; docRelPath: string | null; stageId: string; profileId: string; skillPaths: string[] }

// packages/contracts/src/ipc.ts（波 2 四条）
IPC_CHANNELS.agentContextPreview = "agent:context-preview";
IPC_CHANNELS.profileList = "profile:list";
IPC_CHANNELS.appearanceGet = "appearance:get";
IPC_CHANNELS.appearanceSave = "appearance:save";
RendererApi.contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;
RendererApi.listProfiles(): Promise<ProfileView[]>;
RendererApi.appearanceView(): Promise<AppearanceSettingsSnapshot>;
RendererApi.saveAppearance(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;

// packages/contracts/src/agent-event.ts
StartTurnInput += profileId: string;                        // 必填，"" ⇒ DEFAULT_PROFILE_ID
SessionMeta    += profileId?: string;                       // 老 JSONL 无此键必须照样解析
// packages/contracts/src/book.ts
BookStage      += profileId?: string;                       // schemaVersion 保持 1

// packages/agent-runtime/src/profiles.ts（逐字照 Plan 3 spec §9.1）
export interface AgentProfile {
  id: string; displayName: string; blurb: string; systemPrompt: string;
  allowedTools: readonly AgentToolName[]; writeScope: WriteScope;
  buildSections: (request: ContextRequest, reader: ContextReader) => Promise<ContextSection[]>;
}
export const AGENT_PROFILES: readonly AgentProfile[];       // 六条，顺序＝总 spec §5.1 花名册
export const DEFAULT_PROFILE_ID = "writer";
export function profileById(id: string): AgentProfile | null;
export function profileViews(): ProfileView[];              // 给主进程转发给渲染层
export type WriteScope = { kind: "none" } | { kind: "current-chapter" } | { kind: "dirs"; dirs: readonly string[] };
export function profileAllowsDoc(scope: WriteScope, docRelPath: string, currentChapter: string | null): boolean;

// packages/agent-runtime/src/context-pack.ts（逐字照 Plan 3 spec §9.3 + 本表第 3 条）
export const PREVIOUS_CHAPTER_COUNT = 2;
export const PREVIOUS_CHAPTER_TAIL_CHARS = 400;
export const CONTEXT_CHAR_BUDGET = 24000;
export interface ContextReader {
  listDocs(): DocRef[];
  readDoc(relPath: string): Promise<string | null>;
  charactersOf(relPath: string): Promise<string[]>;
}
export interface ContextRequest { docRelPath: string | null; chapterOrder: string[]; skillPaths: string[] }
export interface ContextSection { kind: ContextSectionKind; label: string; path?: string; text: string; truncated: boolean }
export interface ContextPack { sections: ContextSection[]; charCount: number; estimate: number; omitted: string[] }
export function estimateTokens(text: string): number;       // Math.ceil(码点数 / 1.6)
export async function buildContextPack(reader: ContextReader, request: ContextRequest): Promise<ContextPack>;
export function contextSummaryOf(pack: ContextPack): ContextSummary;

// apps/desktop/src/main/agent-service.ts
AgentServiceDeps.promptFor(context: PromptContext): Promise<string>;   // 由同步改异步
PromptContext += profileId: string; skillPaths: string[]; chapterOrder: string[];
AgentService.contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;

// apps/desktop/src/main/
createBookPromptAssembler(deps: { book: BookService; reader: ContextReader }): (context: PromptContext) => Promise<string>
createFsContextReader(deps: { book: BookService }): ContextReader
createAppearanceSettings(deps: { dir: string; readFile?: (p: string) => Promise<string>; writeFile?: (p: string, s: string) => Promise<void> }): {
  read(): Promise<AppearanceSettingsSnapshot>;              // 永不抛：缺失/坏 ⇒ createDefaultAppearanceSettings() + persisted: false
  write(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;   // 校验失败抛单句中文
}

// apps/desktop/src/renderer/src/stores/useAgentStore.ts
profiles: ProfileView[]                                      // loadProfiles() 填充，失败单句中文进 notice
profileIdByThread: Record<string, string>                    // "" = 用该阶段默认
profileIdFor(threadKey: string): string                      // 派生三级：线程选择 ?? 阶段默认 ?? ""（空串＝交主进程按 DEFAULT_PROFILE_ID 兜底）。
// 渲染层禁止 import `@mochen/agent-runtime`，所以 `DEFAULT_PROFILE_ID` 这个**值**不能出现在渲染层；
// 兜底由 `""` 哨兵承担（Task 11 已定：空串载荷合法，主进程兜底）。落地口径与用例见 Task 18。永不返回 `profiles` 里没有的 id。
setProfileId(threadKey: string, profileId: string): void     // 只改映射，绝不动 items/running/threadKey
skillPathsByThread: Record<string, string[]>
attachSkill(threadKey: string, id: string): void             // 去重、上限 12（超出 notice）
detachSkill(threadKey: string, id: string): void
skillIdsFor(threadKey: string): string[]                     // Task 23 的 `refreshContext` 与 SkillBrowser 的「已挂入」标记都读它
contextSummary: Record<string, ContextSummary>               // 按线程存最近一次预览，占用条读它
refreshContext(threadKey: string): Promise<void>

// apps/desktop/src/renderer/src/utils/context-bar.ts
export function formatContextBar(summary: ContextSummary): string   // 只读 sections.length / charCount / estimate / omitted，不碰节内部字段

// apps/desktop/src/renderer/src/utils/theme-mode.ts
export function resolveEffectiveScheme(mode: AppearanceMode, systemScheme: AppearanceColorScheme): AppearanceColorScheme

// apps/desktop/src/renderer/src/stores/useAppearanceStore.ts
state: { settings: AppearanceSettings; persisted: boolean; loaded: boolean; notice: string }
getters: { effectiveMode: AppearanceMode; themePresetId: string }
actions: { load(): Promise<void>; setMode(mode: AppearanceMode): Promise<void>; setPreset(id: string): Promise<void>; resetToDefault(): Promise<void> }

// utils/slash-commands.ts 波 2 变化
PaletteFocus += profilesReady: boolean        // false ⇒ "stage" 不可用
```

### 波 3

```ts
// packages/contracts/src/skill.ts
export const SKILL_SOURCES = ["global", "book"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];
export interface SkillRef {
  id: string;                    // `${source}:${dirName}`
  source: SkillSource; dirName: string; displayName: string; description: string;
  stages: string[]; appliesTo: string[]; relPath: string;   // relPath = `${dirName}/SKILL.md`
}
export interface SkillContent { relPath: string; content: string; truncated: boolean }

// packages/contracts/src/ipc.ts（波 3 两条）
IPC_CHANNELS.skillsList = "skills:list";
IPC_CHANNELS.skillsRead = "skills:read";
RendererApi.listSkills(): Promise<SkillRef[]>;
RendererApi.readSkill(source: SkillSource, relPath: string): Promise<SkillContent>;

// packages/contracts/src/agent-event.ts
StartTurnInput += skillPaths: string[];        // 必填，无挂入时传 []

// packages/fs-store/src/skills.ts
export async function scanSkills(dir: string, source: SkillSource): Promise<SkillRef[]>;

// apps/desktop/src/main/skills-service.ts
export interface SkillsService {
  list(): Promise<SkillRef[]>;                                   // 全局 + 书内合并，书内 id 优先
  read(source: SkillSource, relPath: string): Promise<SkillContent>;   // SKILL_READ_LIMIT = 64 * 1024，超出 truncated: true；越界抛单句中文
}
export function createSkillsService(deps: {
  globalDir: string;
  bookRoot: () => string | null;
  readFile?: (path: string) => Promise<Buffer>;                  // 返回 Buffer：要按字节卡 64 KB，与外观的 string 读取故意不同源
  realpath?: (path: string) => Promise<string>;                  // 软链出目录的那道闸，注入后单测可验（M10）
}): SkillsService;

// apps/desktop/src/main/app-data-migration.ts（逐字照 Plan 3 spec §12）
export interface AppDataMigrationDeps {
  oldDir: string; newDir: string;
  copyFile(src: string, dest: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  cipher: Cipher;
  now?: () => Date;                        // 本计划追加：保留目录名的时间戳，不注入则不可测
  exists?(path: string): Promise<boolean>;  // 本计划追加：新目录已有同名文件 ⇒ 跳过、绝不覆盖
}
export type AppDataMigrationReport =
  | { status: "nothing-to-do" }
  | { status: "migrated"; movedFiles: string[]; keptOldDir: string }
  | { status: "kept-old"; reason: string };
export async function migrateLegacyAppData(deps: AppDataMigrationDeps): Promise<AppDataMigrationReport>;
export function migrationNotice(report: AppDataMigrationReport, dirs: { newDir: string }): string | null;
// 播报文案的唯一实现；index.ts 只弹窗、不拼句子。nothing-to-do ⇒ null 不打扰。

// apps/desktop/src/renderer/src/stores/useSkillsStore.ts
state: { refs: SkillRef[]; contents: Record<string, SkillContent>; loading: boolean; loaded: boolean; notice: string }
actions: { load(): Promise<void>; open(id: string): Promise<void>; refresh(): Promise<void>; openLibrary(): Promise<void> }
// 挂入状态**不在**这个 store（见「与 spec 的差异」第 6 条）：`skillPathsByThread` / `attachSkill` /
// `detachSkill` / `skillIdsFor` 全在 `useAgentStore`（波 2 已列），这里再存一份就是两处真相。

// apps/desktop/src/renderer/src/stores/useBookStore.ts
skillBrowser: { id: string; displayName: string } | null
openSkillBrowser(skill: SkillRef): void      // 设 skillBrowser + rightPaneMode="browse"；绝不动 docTabs/activeDocTab/draft/draftsByPath
closeSkillBrowser(): void

// utils/slash-commands.ts 波 3 变化
SLASH_COMMANDS → ["model", "permissions", "status", "stage", "skills", "resume", "clear"]

// 波 3 对波 2 已列签名的追加（逐字照此，落地件在 Task 24）
export interface SkillText { text: string; truncated: boolean }          // agent-runtime/src/context-pack.ts
ContextReader += readSkill(id: string): Promise<SkillText | null>;       // 第四端口；null = 读不到，绝不抛逐文件原因
ContextPack += unreadableSkills: string[];                               // 原样回传标识；contextSummaryOf 不转发它，ContextSummary 四键不动
createFsContextReader(deps: { book: BookService; skills: SkillsService }): ContextReader
// ↑ 波 2 的签名是 { book }，Task 24 加第二个依赖；调用方（main/index.ts、Task 27 的 e2e 夹具）同任务改完。
export interface AssembledPrompt { text: string; unreadableSkills: string[] }   // main/book-prompt.ts
createBookPromptAssembler(deps: { book: BookService; reader: ContextReader }): (context: PromptContext) => Promise<AssembledPrompt>
AgentServiceDeps.promptFor(context: PromptContext): Promise<AssembledPrompt>     // 波 2 的 Promise<string> 在此改成它
AgentServiceDeps += reader: ContextReader                                         // Task 16 追加：占用条预览与实际发送必须同一个 fs 实例
```

---

## 契约变更总表（每波收尾自检）

| 项 | 现值 | 波 1 后 | 波 2 后 | 波 3 后 |
| --- | --- | --- | --- | --- |
| `IPC_CHANNELS` 键数 | 12 | 13 | 17 | 19 |
| `RendererApi` 方法数 | 12 | 13 | 17 | 19 |
| `renderer-api.test.ts` 字面量 | 12 | 13 | 17 | 19 |
| `PROPOSAL_STATUSES` | 6 | 7（+`expired`） | 7 | 7 |
| `StartTurnInput` 字段 | 4 | 4 | 5（+`profileId`） | 6（+`skillPaths`） |
| `SessionMeta` | 6 | 6 | 7（+`profileId?`） | 7 |
| `BookStage` | 2 | 2 | 3（+`profileId?`） | 3 |
| `book.json` `schemaVersion` | 1 | 1 | 1 | 1 |
| `ThreadView` 字段 | 7 | 10 | 10 | 10 |
| 用例数（目标值，非承诺） | 353 | ≥400 | ≥445 | ≥475 |

> 用例数目标比 Plan 3 spec §13 的 ≥440 / ≥470 各上调 5：本计划把 S1/S2/S3 三条自加变异的保护用例、Task 24 的 §10「浏览不打断」四条与 `AssembledPrompt` 通路算进了波 2/3 增量。上调只抬高「低于目标必须在台账注明原因」的那条线，不改变门禁判定（`VERIFY_EXIT=0` 才是绿灯）。执行时**照日志实录**，不许把目标值当结果写。

---

## 变异归属（Plan 3 spec §15 → 任务）

| 编号 | 钉的东西 | 归属任务 | 变异动作 |
| --- | --- | --- | --- |
| M1 | 回放复用同一归约器且不白打 diff IPC | Task 5 | `ensureHydrated` 里改成 `fetchDiff: true` |
| M2 | `expired` 不计待审、不进「已裁决」组 | Task 4 | 未配对卡仍留 `pending` |
| M3 | 只有 `interrupted` 结尾才复活「继续」 | Task 5 | `error` 结尾也标 `endedAs = "failed"` |
| M4 | 输入法合成期间一律不截键 | Task 6 | 去掉 `isComposing` 闸门 |
| M5 | 迁移先验解密、后改名 | Task 25 | 调换步骤 3 与 4 的先后 |
| M6 | 档案范围闸 | Task 17 | 删掉 `applyDecision` 里的档案闸 |
| M7 | 工具按档案过滤 | Task 16 | `TOOL_SPECS` 不过滤直传 |
| M8 | 上下文超预算整节丢弃 | Task 14 | 去掉丢弃分支、只截半句 |
| M9 | 主题 `mode !== "system"` 时不跟系统 | Task 19 | 无条件保留 `matchMedia` 监听 |
| M10 | 技能读取不越界 | Task 22 | 去掉 `SKILL.md` 文件名与目录内检查 |
| M11 | 切档案不换线程 | Task 18 | 让档案进 `threadKey` |
| M12 | 档位文案一处来源 | Task 9 | 在渲染层另写一份三元链 |

每条变异由**实现者自跑并贴出转红证据**，评审者自己重跑，不采信日志转录。

---

## 波 1 —— 看得见的历史与按得动的键

**波次验收**（本波结束必须全部成立，逐条可在真机或单测复核）：

1. 重启应用后中栏把该章线程的**事件、工具卡、提案卡**如实回放回来（F-6）；未裁决的旧卡落进「上次会话未处理」第三组、按钮禁用、进不了待审计数；被打断的线程重启后「继续」真能续。
2. 键位全表在真机生效且**判定全在纯函数**：`Enter` / `Shift+Enter` / `Ctrl+J` / `Tab` 排队 / `y a p d` / `Ctrl+PageUp·Down` / `Ctrl+1..9` / `Ctrl+B` / `Ctrl+,` / `/`；中文输入法候选框回车**不提交**。
3. `/` 面板只列运行期可用的命令并真驱动 6 条命令；`/clear` 的确认文案如实说明「盘上历史不动」。
4. 权限档在 UI 里当场切换生效（`saveMeta` 首次接线），拒绝文案的指引句在 UI 上有落点；`ProposalCard` 的整篇/锚点文案改查 `PROPOSAL_MODE_LABELS`，三元链删除。
5. 门禁：`IPC_CHANNELS`/`RendererApi`/preload 计数 12→13 全连带、`corepack pnpm verify` 回读 `VERIFY_EXIT=0` 且用例数从 353 增至 ≥400。

> 波 1 契约变更（spec §13）：`IPC_CHANNELS` 键数 12→13、`RendererApi` 方法数 12→13、`PROPOSAL_STATUSES` 6→7（+`expired`）、`ThreadView` 字段 7→10（+`hydrated` `hydrating` `queued`）。
> 命名与参数顺序一律以共头「接口总表 · 波 1」为准，不得改名、不得换参序。

---

### Task 1：contracts —— `SessionLoadResult` + `agent:load-session` 键 + `RendererApi.loadSession`

**Files:**
- Modify: `packages/contracts/src/agent-event.ts`（在文件末尾 `DecisionResult` 之后追加，当前末行 157）
- Modify: `packages/contracts/src/ipc.ts`（`IPC_CHANNELS` 5–18 末尾加键；`RendererApi` 37–52 加方法；顶部 import 2 加类型）
- Test: `packages/contracts/test/agent.test.ts`（追加 `describe("sessionLoadResultSchema")`）

> 本任务**不动 preload**。Plan 2 的 Task 1→12 已证明「契约与消费方分两个提交、每步都过 tsc」的分工：contracts 加键 + 加方法是自洽的（`RendererApi` 是接口，无实现方在此包），preload 工厂的连带实现放 Task 2。`packages/contracts/src/index.ts` 已 `export * from "./agent-event.js"` 与 `./ipc.js`（第 5、7 行），新增符号自动可达，**barrel 不动**——Step 5 用一条用例证明它能从 barrel 拿到。

**Interfaces:**
- Consumes: `SessionMeta`（`agent-event.ts:31`）、`AgentEvent`（`:71`）
- Produces:
  - `sessionLoadResultSchema`（zod）+ `SessionLoadResult`（= `z.infer`，形状逐字照 spec §4.1）
  - `IPC_CHANNELS.agentLoadSession = "agent:load-session"`
  - `RendererApi.loadSession(threadKey: string): Promise<SessionLoadResult>`

- [x] **Step 1：先写会红的测试**

在 `packages/contracts/test/agent.test.ts` 末尾追加（import 处把 `sessionLoadResultSchema` 加进第 2–13 行的具名导入）：

```ts
import {
  AGENT_TOOL_NAMES,
  agentEventSchema,
  decideInputSchema,
  editProposalSchema,
  isWriteTool,
  maskApiKey,
  providerDraftSchema,
  sessionLoadResultSchema,
  sessionMetaSchema,
  WRITE_TOOLS,
  type WriteToolName
} from "../src/index.js";
```

```ts
const meta = {
  type: "session-meta",
  sessionId: "s1",
  docRelPath: "chapters/01-开局.md",
  stageId: "draft",
  model: "mochen-mock",
  startedAt: "2026-10-01T08:00:00.000Z"
};

describe("sessionLoadResultSchema", () => {
  it("found:true 带 meta / events / droppedLines，逐条能解析", () => {
    const ok = {
      found: true,
      relPath: ".mochen/sessions/2026/10/01/rollout-x.jsonl",
      meta,
      events: [{ id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1", type: "user-message", text: "改紧" }],
      droppedLines: [3, 7]
    };
    expect(sessionLoadResultSchema.parse(ok)).toEqual(ok);
  });

  it("found:false 的两种 reason 各自带中文 message", () => {
    for (const reason of ["no-book", "no-session"] as const) {
      const miss = { found: false, reason, message: "这本书里没有这条线程的历史。" };
      expect(sessionLoadResultSchema.parse(miss)).toEqual(miss);
    }
  });

  it("未知 reason 一律拒绝——回放失败态只有两种，第三种是编的", () => {
    expect(
      sessionLoadResultSchema.safeParse({ found: false, reason: "corrupt", message: "坏了" }).success
    ).toBe(false);
  });

  it("found:true 却不带 events 或 droppedLines 形状不符时拒绝（跨 IPC 兜底）", () => {
    expect(
      sessionLoadResultSchema.safeParse({ found: true, relPath: "x", meta, events: "坏", droppedLines: [] })
        .success
    ).toBe(false);
  });
});
```

- [x] **Step 2：跑到红**

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: FAIL —— `SyntaxError: The requested module '../src/index.js' does not provide an export named 'sessionLoadResultSchema'`（该具名导出不存在）。

- [x] **Step 3：`agent-event.ts` 追加 `sessionLoadResultSchema`**

在 `packages/contracts/src/agent-event.ts` 文件末尾（现 `DecisionResult` 定义结束于第 157 行）追加：

```ts
/**
 * 重启后回放一条线程的取数结果（F-6 / spec §4.1）。
 * found:true 是「读到了」——即便 events 为空也算读到（确实没有历史的线程首行仍在）；
 * found:false 只有两种失败：没开书 / 这本书里没这条线程。首行坏不在此表达，
 * 那是 readSession 直接抛中文（spec §4.2 第 3 步），由 IPC 层透传、渲染层收成一条 notice。
 */
export const sessionLoadResultSchema = z.discriminatedUnion("found", [
  z.object({
    found: z.literal(true),
    relPath: z.string().min(1),
    meta: sessionMetaSchema,
    events: z.array(agentEventSchema),
    droppedLines: z.array(z.number().int().min(0))
  }),
  z.object({
    found: z.literal(false),
    reason: z.enum(["no-book", "no-session"]),
    message: z.string().min(1)
  })
]);
export type SessionLoadResult = z.infer<typeof sessionLoadResultSchema>;
```

- [x] **Step 4：`ipc.ts` 加键 + 加方法**

`IPC_CHANNELS`（第 17 行 `providerSave` 之后、第 18 行 `} as const` 之前）追加：

```ts
  providerSave: "provider:save",
  agentLoadSession: "agent:load-session"
```

顶部 import（第 2 行）改为从 `agent-event.js` 一并取类型：

```ts
import type { AgentOutbound, DecideInput, DecisionResult, SessionLoadResult, StartTurnInput } from "./agent-event.js";
```

`RendererApi`（在第 47 行 `proposalDiff` 之后、第 48 行 `providerView` 之前插入，保持 agent 方法相邻）：

```ts
  /** 只读回放：把这条线程落盘的 JSONL 读回来，永不动盘、永不重建可批准的待审队列（D1）。 */
  loadSession(threadKey: string): Promise<SessionLoadResult>;
```

- [x] **Step 5：跑到绿并过 tsc（含 barrel 可达性自检）**

`sessionLoadResultSchema` 已从 `../src/index.js` 具名导入成功，即证明 barrel（`index.ts:5,7`）自动带出，无需改 barrel。

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: PASS（新增 4 个用例）。
Run: `corepack pnpm prettier --write packages/contracts && corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json`
Expected: 无诊断。

> 注意：`RendererApi` 加了 `loadSession` 后，本包自洽（无实现方）。但**根 tsc（`tsconfig.web.json`/`tsconfig.node.json`）会立刻红**——preload 工厂（Task 2）与两处 `satisfies RendererApi` 夹具（Task 4/5 会补）都缺这个方法。所以本任务的提交**只跑 contracts 的 tsc**，根的连带在 Task 2 与 Task 4 收口；这正是 Plan 2 Task 1→12 的分工节奏。**不要在 Task 1 末尾跑 `corepack pnpm verify`。**

- [x] **Step 6：变异实验（本任务无独立变异编号；做一条删字段的自检）**

用 Edit 把 `sessionLoadResultSchema` 里 `droppedLines: z.array(...)` 整行删掉再跑测试 ——
必须转红（「found:true 带 … droppedLines」用例的 `parse().toEqual` 会因剥掉未知键而 `toEqual` 失败）。恢复后：
Run: `git diff --exit-code packages/contracts/src` 必须为空。
理由：`droppedLines` 是「有 N 行没读回」的唯一凭据，丢了它回放会谎报「完整恢复」。

- [x] **Step 7：提交**

先跑 `git log --oneline -8` 对齐风格，再：

```bash
git add packages/contracts/src/agent-event.ts packages/contracts/src/ipc.ts packages/contracts/test/agent.test.ts
git commit -m "feat(contracts): 新增 SessionLoadResult 与 agent:load-session 通道键"
```

---

### Task 2：preload —— 工厂加 `loadSession` + `renderer-api.test.ts` 计数 12→13 连带

**Files:**
- Modify: `apps/desktop/src/preload/renderer-api.ts`（`createRendererApi` 工厂 32–49，追加一个方法）
- Modify: `apps/desktop/src/preload/renderer-api.test.ts`（用例标题 `:64`、计数 `:101`、注释 `:132`、通道数组 104–117、参数数组 118–131、键名数组 133–146）

**Interfaces:**
- Consumes: `IPC_CHANNELS.agentLoadSession`（Task 1）
- Produces: `createRendererApi` 返回值多出 `loadSession`，方法数 12→13

- [x] **Step 1：先写会红的测试**

改 `apps/desktop/src/preload/renderer-api.test.ts`。

1) 把用例标题（第 64 行）改为：

```ts
  it("13 个方法各调一次：通道与参数逐条钉死（期望值全是字面量，不从 IPC_CHANNELS 派生）", async () => {
```

2) 在调用序列里 `await api.proposalDiff("p-1");`（第 96 行）之后插入一行：

```ts
    await api.loadSession("chapters/01-开局.md");
```

3) 通道期望数组（104–117）在 `"agent:diff"` 之后插入 `"agent:load-session"`：

```ts
    expect(calls.map((call) => call.channel)).toEqual([
      "book:pick",
      "book:open",
      "book:save-meta",
      "doc:read",
      "doc:write",
      "agent:start-turn",
      "agent:interrupt",
      "agent:decide",
      "agent:diff",
      "agent:load-session",
      "provider:get",
      "provider:save",
      "agent:event"
    ]);
```

4) 参数期望数组（118–131）在 `["p-1"],`（proposalDiff 的参，第 127 行）之后插入 `["chapters/01-开局.md"],`：

```ts
    expect(calls.map((call) => call.args)).toEqual([
      [],
      ["/book"],
      [meta],
      ["chapters/01-开局.md"],
      ["chapters/01-开局.md", "正文", "fp-1"],
      [startInput],
      ["t-1"],
      [decideInput],
      ["p-1"],
      ["chapters/01-开局.md"],
      [],
      [draft],
      ["subscribe"]
    ]);
```

5) 计数（第 101 行）：

```ts
    expect(calls.length).toBe(13);
```

6) 注释（第 132 行）：

```ts
    // 渲染层只拿到这 13 个方法：invoke/on/ipcRenderer 一个字都不许泄漏成键。
```

7) 键名排序期望（133–146）加 `"loadSession"`（字母序在 `"interruptTurn"` 与 `"onAgentEvent"` 之间）：

```ts
    expect(Object.keys(api).sort()).toEqual([
      "decideProposal",
      "interruptTurn",
      "loadSession",
      "onAgentEvent",
      "openBook",
      "pickBookDirectory",
      "proposalDiff",
      "providerSave",
      "providerView",
      "readDoc",
      "saveMeta",
      "startTurn",
      "writeDoc"
    ]);
```

- [x] **Step 2：跑到红**

Run: `corepack pnpm vitest run apps/desktop/src/preload/renderer-api.test.ts --maxWorkers=4`
Expected: FAIL —— `api.loadSession is not a function`（工厂还没有这个方法），且计数断言 `expected 12 to be 13`。

- [x] **Step 3：`renderer-api.ts` 工厂加方法**

在 `apps/desktop/src/preload/renderer-api.ts` 的 `proposalDiff`（第 43 行）之后追加：

```ts
    proposalDiff: (proposalId) => invoke(IPC_CHANNELS.agentDiff, proposalId),
    loadSession: (threadKey) => invoke(IPC_CHANNELS.agentLoadSession, threadKey),
```

- [x] **Step 4：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/preload/renderer-api.test.ts --maxWorkers=4`
Expected: PASS（4 个用例）。
Run: `corepack pnpm prettier --write apps/desktop/src/preload && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json`
Expected: 无诊断。（`tsconfig.web.json` 仍红——两处 `satisfies RendererApi` 夹具未补 `loadSession`，Task 4 收口；本任务不跑 web tsc。）

- [x] **Step 5：连带清单（点名到文件:行）**

- `apps/desktop/src/preload/renderer-api.ts:43` 后加 `loadSession`。
- `apps/desktop/src/preload/renderer-api.test.ts:64`（标题）、`:101`（`toBe(12)→13`）、`:104-117`（通道）、`:118-131`（参数）、`:132`（注释）、`:133-146`（键名）。
- 本波**其余 `satisfies RendererApi` 夹具**（`useAgentStore.test.ts:112-128`、`useBookStore.test.ts:41-57`）留到 Task 4/5 补 `loadSession` 键；本任务只保证 preload 侧计数绿。

- [x] **Step 6：提交**

```bash
git add apps/desktop/src/preload/renderer-api.ts apps/desktop/src/preload/renderer-api.test.ts
git commit -m "feat(preload): 白名单加 loadSession，方法数字面量计数 12→13"
```

---

### Task 3：主进程 —— `agentService.loadSession(threadKey)` 三态中文 + `agent-ipc.ts` 注册通道

**Files:**
- Modify: `apps/desktop/src/main/agent-service.ts`（`AgentService` 接口 75–82 加签名；`createAgentService` 返回对象 377–512 内加实现）
- Modify: `apps/desktop/src/main/agent-ipc.ts`（`registerAgentIpc` 14–21 加一条 `handle`，注释 13 改「五条」）
- Test: `apps/desktop/src/main/agent-service.test.ts`（追加 `describe("loadSession 三态")`）

**Interfaces:**
- Consumes: `findLatestSession`（`@mochen/agent-runtime`，`rollout.ts:128`）、`readSession`（`rollout.ts:69`）、`SessionLoadResult`（Task 1）、`deps.book.current()`（`book-service.ts:79`）、模块内 `UNBOUND`（`agent-service.ts:38`）、`threads` Map（`:119`）
- Produces: `AgentService.loadSession(threadKey: string): Promise<SessionLoadResult>`；no-book / no-session 返回 `found:false` 值，首行坏与超长 `threadKey` **抛中文**（IPC 层不吞，见 Step 5 口径说明）

- [x] **Step 1：先写会红的测试**

在 `apps/desktop/src/main/agent-service.test.ts` 末尾追加。`build()` 已返回 `{ service, book, writes }`（`:313`），`findLatestSession`/`readSession`/`proposeChunks`/`turn` 均已在文件里可用。

```ts
describe("agentService.loadSession 三态", () => {
  it("读过：跑过一轮的线程能原样读回事件与 meta，droppedLines 为空", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    const loaded = await service.loadSession(CHAPTER);
    if (!loaded.found) throw new Error("应该读到历史");
    expect(loaded.meta.docRelPath).toBe(CHAPTER);
    expect(loaded.droppedLines).toEqual([]);
    expect(loaded.events.map((event) => event.type)).toEqual([
      "user-message",
      "reasoning",
      "message",
      "tool-call",
      "proposal"
    ]);
    service.dispose();
  });

  it("no-book：关了书再读，返回中文 message 而不是抛错", async () => {
    const { service, book } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    await book.close();
    const loaded = await service.loadSession(CHAPTER);
    expect(loaded).toEqual({
      found: false,
      reason: "no-book",
      message: "还没打开作品目录，历史读不回来。"
    });
    service.dispose();
  });

  it("no-session：这本书里没有这条线程，返回中文且不写进任何缓存", async () => {
    const { service } = await build(sseFetch());
    const loaded = await service.loadSession("chapters/99-从没写过.md");
    expect(loaded).toEqual({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    service.dispose();
  });

  it("首行坏：把会话首行改成坏 JSON 后必须抛中文（IPC 层不吞），错误里带 relPath", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("会话没落盘，夹具坏了");
    const absPath = path.join(root, ...rel.split("/"));
    const lines = (await readFile(absPath, "utf8")).split("\n");
    await writeFile(absPath, `{"坏了":\n${lines.slice(1).join("\n")}`, "utf8");
    await expect(service.loadSession(CHAPTER)).rejects.toThrow(/会话首行不可用/);
    service.dispose();
  });

  it("threadKey 归一与主线程一致：空串走 unbound，超长抛中文", async () => {
    const { service } = await build(sseFetch());
    expect(await service.loadSession("   ")).toEqual({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    await expect(service.loadSession("x".repeat(201))).rejects.toThrow(/会话线程标识过长/);
    service.dispose();
  });
});
```

- [x] **Step 2：跑到红**

Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`
Expected: FAIL —— `service.loadSession is not a function`。

- [x] **Step 3：`agent-service.ts` 接口加签名**

`AgentService` 接口（75–82），在 `diffOf`（`:80`）之后加：

```ts
  diffOf(proposalId: string): string;
  /** 只读回放：读这条线程落盘的 JSONL；no-book/no-session 返回 found:false，首行坏/超长抛中文。 */
  loadSession(threadKey: string): Promise<SessionLoadResult>;
```

顶部 `@mochen/contracts` 的 import（第 2–16 行的类型列表）加 `type SessionLoadResult`（紧跟 `type StartTurnInput`）。`findLatestSession`、`readSession` 已在 import（`:23`、`:26`）。

- [x] **Step 4：`agent-service.ts` 实现 `loadSession`**

在返回对象里 `diffOf`（`:499-501`）之后、`dispose`（`:503`）之前插入：

```ts
    async loadSession(threadKey: string): Promise<SessionLoadResult> {
      // 入参守卫与 startTurnInputSchema 同口径（spec §4.1，裁定 n 延续）：越界抛单句中文，
      // 非字符串（畸形 preload/被改写的载荷）归一成空串走 unbound，绝不崩在 .trim() 上。
      const raw = typeof threadKey === "string" ? threadKey : "";
      if (raw.length > 200)
        throw new Error("会话线程标识过长（最多 200 字），历史读不回来。");
      const key = raw.trim() === "" ? UNBOUND : raw.trim();
      const current = deps.book.current();
      if (current === null)
        return { found: false, reason: "no-book", message: "还没打开作品目录，历史读不回来。" };
      // 先查缓存：threads 只在拿到真实相对路径时才写入（threadFor 同口径），不存在「缓存了查不到的线程」。
      const cached = threads.get(key);
      const rel = cached ?? (await findLatestSession(current.root, key));
      if (rel === null)
        return { found: false, reason: "no-session", message: "这本书里没有这条线程的历史。" };
      // 读到即缓存，与 threadFor 用同一个 Map：随后这一章第一次发轮会 append 到同一份 JSONL。
      if (cached === undefined) threads.set(key, rel);
      // 首行坏：readSession 直接抛中文（rollout.ts:77-80 原文），这里不吞、不转 found:false。
      const stored = await readSession(current.root, rel);
      return {
        found: true,
        relPath: rel,
        meta: stored.meta,
        events: stored.events,
        droppedLines: stored.droppedLines
      };
    },
```

- [x] **Step 5：`agent-ipc.ts` 注册通道**

注释（第 13 行）与 `registerAgentIpc`（14–21）：

```ts
/** 只注册 IPC_CHANNELS 白名单里那五条 agent 通道，一条不多一条不少。 */
export function registerAgentIpc(handle: Handler, service: AgentService): void {
  handle(IPC_CHANNELS.agentStartTurn, (_event, input) =>
    service.startTurn(input as StartTurnInput)
  );
  handle(IPC_CHANNELS.agentInterrupt, (_event, turnId) => service.interrupt(turnId as string));
  handle(IPC_CHANNELS.agentDecide, (_event, input) => service.decide(input as DecideInput));
  handle(IPC_CHANNELS.agentDiff, (_event, proposalId) => service.diffOf(proposalId as string));
  handle(IPC_CHANNELS.agentLoadSession, (_event, threadKey) =>
    service.loadSession(threadKey as string)
  );
}
```

- [x] **Step 6：跑到绿并过 node tsc**

Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`
Expected: PASS（新增 5 个用例）。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json`
Expected: 无诊断。（`tsconfig.web.json` 仍红，Task 4/5 收口。）

> **口径说明（须与评审对齐）**：接口总表把 `loadSession` 注为「永不抛（IPC 层抛除外）」，而 spec §4.2 第 3 步与本任务清单都写明「首行坏抛中文」。本实现取**后者的字面**：no-book/no-session 是**返回值**（可预期的正常缺失态），首行坏与超长是**抛错**（异常，经 `ipcMain.handle` 透传为渲染层 promise rejection，由 store 收成一条 notice）。若评审坚持「永不抛」，则应改成 `{ found:false, reason:"corrupt", message }`——但 `sessionLoadResultSchema`（Task 1）的 `reason` 只枚举了 `no-book`/`no-session`，那条路要连 schema 一起改，不在本波。

- [x] **Step 7：变异实验（为 Task 5 的 M1 铺路的读侧保护，不占编号）**

用 Edit 把 `no-session` 分支的 `return { found: false, reason: "no-session", ... }` 改成 `threads.set(key, rel ?? "GHOST")` 前置且返回 `found:true`（模拟「缓存一条查不到的线程」）再跑 ——
必须转红（`no-session` 用例的 `toEqual` 失败）。恢复后 `git diff --exit-code apps/desktop/src/main/agent-service.ts` 必须空。
理由：spec §4.2 明令「找不到 ⇒ 不往 Map 里写任何东西」，否则用户重选目录/这一章后来第一次发轮都查不到真历史。

- [x] **Step 8：提交**

```bash
git add apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-service.test.ts
git commit -m "feat(main): loadSession 三态回放（复用 findLatestSession/readSession）并注册通道"
```

---

### Task 4：store —— `reduceEvent` 第三参、`ThreadView` 三字段、`replayProposalStatuses`、`splitProposalCards` 第三组、`expired` 状态与 `pendingOf` 钉死

**Files:**
- Modify: `packages/contracts/src/patch.ts`（`PROPOSAL_STATUSES` 16–24 加 `"expired"`；`PROPOSAL_STATUS_LABELS` 46–53 加键）
- Modify: `apps/desktop/src/renderer/src/utils/timeline.ts`（`CardSplit` 171–176 加 `expired`；`splitProposalCards` 186–208 三分组；追加 `replayProposalStatuses`）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（`ThreadView` 26–37 加三字段；`newThread` 48–58；`reduceEvent` 217–261 第三参；state 133–140 加 `hydrateInflight`）
- Test: `apps/desktop/src/renderer/src/utils/timeline.test.ts`（改 `:351` 精确形状 + 加 expired/replay 用例）、`apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`（api 夹具 112–128 加 `loadSession`；pendingOf 钉 expired）

> 契约成员 `expired` 的**新增与消费方同在本任务**（`PROPOSAL_STATUS_LABELS`、`splitProposalCards`、store、`ProposalCard` 的标签渲染由 `PROPOSAL_STATUS_LABELS[status]` 自动带出，`pendingOf` 零改动），满足「契约变更同任务改完消费方」；`expired` 的**可见 UI**（第三组 + 禁用按钮）在 Task 5。

**Interfaces:**
- Consumes: `PROPOSAL_STATUSES`/`ProposalStatus`（`patch.ts`）、`AgentEvent`
- Produces:
  - `PROPOSAL_STATUSES` 含 `"expired"`；`PROPOSAL_STATUS_LABELS.expired = "上次会话未处理"`
  - `interface CardSplit<T> { open; settled; expired }`
  - `replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus>`
  - `reduceEvent(thread, event, options?: { fetchDiff?: boolean }): void`（默认 `true`）
  - `ThreadView.hydrated: boolean`、`hydrating: boolean`、`queued: string[]`

- [x] **Step 1：先写会红的测试（contracts）**

`packages/contracts/test/agent.test.ts` 顶部 import 加 `PROPOSAL_STATUSES, PROPOSAL_STATUS_LABELS`（从 `../src/index.js`），追加：

```ts
describe("expired 提案状态（回放派生，D1）", () => {
  it("PROPOSAL_STATUSES 恰含七个成员，expired 排在末尾", () => {
    expect([...PROPOSAL_STATUSES]).toEqual([
      "pending",
      "written",
      "rejected",
      "cancelled",
      "stale",
      "failed",
      "expired"
    ]);
  });

  it("expired 的中文标签定稿整句钉死（Record 穷尽键，加成员不写说明就编译不过）", () => {
    expect(PROPOSAL_STATUS_LABELS.expired).toBe("上次会话未处理");
  });
});
```

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: FAIL —— 六成员 vs 七成员；`PROPOSAL_STATUS_LABELS.expired` 为 `undefined`。

- [x] **Step 2：`patch.ts` 落地 `expired`**

```ts
export const PROPOSAL_STATUSES = [
  "pending",
  "written",
  "rejected",
  "cancelled",
  "stale",
  "failed",
  "expired"
] as const;
```

```ts
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "待审批",
  written: "已写入",
  rejected: "已拒绝",
  cancelled: "已取消",
  stale: "文件已变动",
  failed: "写入失败",
  expired: "上次会话未处理"
};
```

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: PASS。

- [x] **Step 3：先写会红的测试（timeline）**

`apps/desktop/src/renderer/src/utils/timeline.test.ts`：把第 351 行的精确形状改为三组：

```ts
    expect(splitProposalCards([], ANCHORS)).toEqual({ open: [], settled: [], expired: [] });
```

import 处加 `replayProposalStatuses`（从 `"./timeline"`）。追加两个 describe：

```ts
describe("splitProposalCards 第三组 expired（D1）", () => {
  const ANCHORS = { tA: { index: 1, userText: "甲" } };
  it("expired 不进 open 也不进 settled——把它塞进已裁决组是假话", () => {
    const split = splitProposalCards(
      [
        cardOf("p1", "tA", "2026-10-01T00:01:00.000Z", "pending"),
        cardOf("p2", "tA", "2026-10-01T00:02:00.000Z", "expired"),
        cardOf("p3", "tA", "2026-10-01T00:03:00.000Z", "written")
      ],
      ANCHORS
    );
    expect(split.open.map((c) => c.proposal.id)).toEqual(["p1"]);
    expect(split.expired.map((c) => c.proposal.id)).toEqual(["p2"]);
    expect(split.settled.map((c) => c.proposal.id)).toEqual(["p3"]);
  });
});

describe("replayProposalStatuses（回放派生扫描）", () => {
  it("未配对的 proposal 给 expired；有 decision/written 的给对应已裁决态", () => {
    const events: AgentEvent[] = [
      event("proposal", { proposal: { id: "pOpen" } }),
      event("proposal", { proposal: { id: "pCancel" } }),
      event("decision", { proposalId: "pCancel", decision: "cancel", guidance: "", auto: false }),
      event("proposal", { proposal: { id: "pDeny" } }),
      event("decision", {
        proposalId: "pDeny",
        decision: "deny-with-guidance",
        guidance: "别动",
        auto: false
      }),
      event("proposal", { proposal: { id: "pWrite" } }),
      event("decision", { proposalId: "pWrite", decision: "accept-once", guidance: "", auto: false }),
      event("written", {
        proposalId: "pWrite",
        docRelPath: "chapters/01.md",
        fingerprint: "b".repeat(64),
        backupRelPath: null
      })
    ];
    expect(replayProposalStatuses(events)).toEqual({
      pOpen: "expired",
      pCancel: "cancelled",
      pDeny: "rejected",
      pWrite: "written"
    });
  });

  it("accept 落了 decision 却没有 written ⇒ 判 failed（写没成， settled 而非 expired）", () => {
    const events: AgentEvent[] = [
      event("proposal", { proposal: { id: "p" } }),
      event("decision", { proposalId: "p", decision: "accept-session", guidance: "", auto: true })
    ];
    expect(replayProposalStatuses(events)).toEqual({ p: "failed" });
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4`
Expected: FAIL —— `splitProposalCards(...).expired` 为 `undefined`；`replayProposalStatuses is not a function`。

- [x] **Step 4：`timeline.ts` 落地**

`CardSplit`（171–176）与 `splitProposalCards`（186–208）：

```ts
export interface CardSplit<T extends ProposalCardInput = ProposalCardInput> {
  /** 待审：status === "pending"。 */
  open: T[];
  /** 已裁决：written / rejected / cancelled / stale / failed。 */
  settled: T[];
  /** 上次会话未处理：回放里没有 decision/written 配对的卡（D1，绝不伪装成可批准）。 */
  expired: T[];
}
```

```ts
export function splitProposalCards<T extends ProposalCardInput>(
  cards: T[],
  anchors: Record<string, TurnAnchor>
): CardSplit<T> {
  const open: T[] = [];
  const settled: T[] = [];
  const expired: T[] = [];
  for (const card of cards) {
    if (card.status === "pending") open.push(card);
    else if (card.status === "expired") expired.push(card);
    else settled.push(card);
  }
  const byTurn = (a: T, b: T): number => {
    const indexA = anchors[a.proposal.turnId]?.index ?? UNKNOWN_TURN_INDEX;
    const indexB = anchors[b.proposal.turnId]?.index ?? UNKNOWN_TURN_INDEX;
    if (indexA !== indexB) return indexA - indexB;
    const createdA = a.proposal.createdAt;
    const createdB = b.proposal.createdAt;
    if (createdA === createdB) return 0;
    return createdA < createdB ? -1 : 1;
  };
  open.sort(byTurn);
  settled.sort(byTurn);
  expired.sort(byTurn);
  return { open, settled, expired };
}
```

文件末尾追加（顶部 `import type { ProposalStatus }` 已在第 1 行）：

```ts
/**
 * 回放派生扫描（spec §4.3 第 6 条）：对每条 proposal 事件，
 * 其后有 decision/written ⇒ 给已裁决态（沿用 store 语义）；没有 ⇒ expired。
 * accept 落了 decision 却没 written 视为 failed（写没成功），绝不留在可批准的 pending。
 */
export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus> {
  const status: Record<string, ProposalStatus> = Object.create(null);
  for (const event of events) {
    if (event.type === "proposal") {
      status[event.proposal.id] = "expired";
      continue;
    }
    if (event.type === "decision") {
      if (event.decision === "cancel") status[event.proposalId] = "cancelled";
      else if (event.decision === "deny-with-guidance") status[event.proposalId] = "rejected";
      else status[event.proposalId] = "failed";
      continue;
    }
    if (event.type === "written") {
      status[event.proposalId] = "written";
      continue;
    }
  }
  return status;
}
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4`
Expected: PASS。

- [x] **Step 5：先写会红的测试（store：第三参 + pendingOf 钉 expired）**

`apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`：

1) api 夹具（112–128）补 `loadSession`，让 `satisfies RendererApi` 重新成立（Task 5 会真正用它，本任务先给个可覆盖的桩）：

```ts
const loadSession = vi.fn(async (): Promise<SessionLoadResult> => ({
  found: false,
  reason: "no-session",
  message: "这本书里没有这条线程的历史。"
}));
```

在 `api` 对象里 `proposalDiff,` 之后加 `loadSession,`；顶部 import 加 `type SessionLoadResult`。

2) 追加用例（放在现有 `describe("useAgentStore")` 内）：

```ts
  it("reduceEvent 第三参 fetchDiff:false 时不打 diff IPC（回放不白打）", async () => {
    await openChapter();
    const thread = store().viewOf(CH);
    proposalDiff.mockClear();
    store().reduceEvent(
      thread,
      eventOf("proposal", { proposal: proposal("pNoDiff") }),
      { fetchDiff: false }
    );
    expect(proposalDiff).not.toHaveBeenCalled();
  });

  it("pendingOf 不数 expired（零改动靠测试钉住，不靠注释）", async () => {
    await openChapter();
    const thread = store().viewOf(CH);
    store().reduceEvent(thread, eventOf("proposal", { proposal: proposal("pOpen") }));
    store().proposals["pOpen"]!.status = "expired";
    expect(store().pendingOf(CH)).toBe(0);
    store().proposals["pOpen"]!.status = "pending";
    expect(store().pendingOf(CH)).toBe(1);
  });

  it("新线程默认 hydrated=false / hydrating=false / queued=[]", () => {
    const thread = store().viewOf("brand-new-thread");
    expect(thread.hydrated).toBe(false);
    expect(thread.hydrating).toBe(false);
    expect(thread.queued).toEqual([]);
  });
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: FAIL —— 新签名 `reduceEvent` 仍会调 `loadDiff`（`proposalDiff` 被调用），`hydrated/hydrating/queued` 为 `undefined`。

- [x] **Step 6：`useAgentStore.ts` 落地**

`ThreadView`（26–37）加三字段（在 `endedAs` 之后）：

```ts
  /** 上一轮怎么收场的——决定「继续」按钮是否出现（spec §9 第 4 行）。 */
  endedAs: "" | TurnEndStatus;
  /** 历史是否已回放过（幂等闸门，spec §4.3 第 1/5 条）。 */
  hydrated: boolean;
  /** 是否有一次在途取数（并发合流，spec §4.3 第 3 条）。 */
  hydrating: boolean;
  /** 运行中按 Tab 排好的后续指令，本轮结束后自动发队首（spec §5.1）。 */
  queued: string[];
```

`newThread()`（48–58）对应加：

```ts
    endedAs: "",
    hydrated: false,
    hydrating: false,
    queued: []
```

`reduceEvent` 签名与 proposal 分支（`:217`、`:234`）：

```ts
    reduceEvent(
      thread: ThreadView,
      event: AgentEvent,
      options?: { fetchDiff?: boolean }
    ): void {
      thread.items.push(event);
      ...
      if (event.type === "proposal") {
        this.proposals[event.proposal.id] = {
          proposal: event.proposal,
          status: "pending",
          message: "",
          diff: ""
        };
        // 实时路径默认取 diff；回放路径显式传 false，重启后绝不给每条历史提案白打一次 IPC（M1）。
        if (options?.fetchDiff !== false) void this.loadDiff(event.proposal.id);
        return;
      }
```

state（133–140）加在途取数表（不进 `ThreadView`，保持 `ThreadView` 恰好 10 字段，契约变更总表）：

```ts
    notice: "",
    seconds: 0,
    listening: false,
    /** 同线程并发 ensureHydrated 合流到同一个 promise（Task 5 用；本任务先建位）。 */
    hydrateInflight: {} as Record<string, Promise<void>>
```

`apply` 的实时事件分支（`:207`）保持不变（不传第三参 ⇒ 默认 `fetchDiff:true` ⇒ 实时照旧取 diff）。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: PASS（含既有全部）。

- [x] **Step 7：web tsc + 全样连带清单核对**

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 仍可能红于 `useBookStore.test.ts` 的 `satisfies RendererApi`（缺 `loadSession`）——那是 Task 5 的夹具；本任务在 Step 8 一并补，故本步应先补 `useBookStore.test.ts`。

**连带清单（`RendererApi` 加方法 → 所有 `satisfies RendererApi` 夹具与工厂实现）：**
- `apps/desktop/src/preload/renderer-api.ts:44`（Task 2 已加 `loadSession`）。
- `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts:112-128`（本任务已加 `loadSession` 桩）。
- `apps/desktop/src/renderer/src/stores/useBookStore.test.ts:41-57`：`proposalDiff: offLimits("proposalDiff"),` 之后加 `loadSession: offLimits("loadSession"),`（book 侧不该调回放通道）。
- `PROPOSAL_STATUSES` 加 `expired` → `PROPOSAL_STATUS_LABELS` 必须加键（tsc 穷尽闸门）；全仓无其它 `Record<ProposalStatus, string>` 需连带（已 grep 确认）。
- `splitProposalCards` 返回多出 `expired` → 调用方 `CenterColumn.vue:47-49` 与 `timeline.test.ts:351`；`CenterColumn.vue` 的第三组渲染在 Task 5 接线（本任务不碰组件，只保证 `.open/.settled` 仍有效）。

- [x] **Step 8：变异实验 M2（expired 不计待审、不进已裁决组）**

主变异：用 Edit 把 `replayProposalStatuses` 里「未配对 proposal」那句 `status[event.proposal.id] = "expired";` 改成 `= "pending";`（模拟把旧卡伪装成可批准）。
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/timeline.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected 转红：`replayProposalStatuses` 第一条用例（期望 `{pOpen:"expired"}` 变 `pending`）红。写回 `expired`。

次变异（分组）：用 Edit 把 `splitProposalCards` 里 `else if (card.status === "expired") expired.push(card);` 删掉（expired 落进 settled）。Expected 转红：`splitProposalCards 第三组` 用例 `split.expired` 为空而 `split.settled` 多出 `p2`。写回。

- [x] **Step 9：提交**

```bash
git add packages/contracts/src/patch.ts packages/contracts/test/agent.test.ts apps/desktop/src/renderer/src/utils/timeline.ts apps/desktop/src/renderer/src/utils/timeline.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts
git commit -m "feat(contracts,renderer): expired 状态、replay 派生扫描与 reduceEvent 第三参"
```

---

### Task 5：store/UI —— `ensureHydrated` 八条规则 + 三处水合时机 + `expired` 可见 UI + 占位（变异 M1、M3）

**Files:**
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（actions 160–357 内加 `ensureHydrated`/`runHydrate`；`apply` 的 turn-end 分支 210–214 补触发；import 加 `replayProposalStatuses`、`SessionLoadResult`）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue`（script 加 `watch` 与 hydration 计算；template 加占位段与 expired 第三组；空状态判断加 `expiredCards.length`；状态条 `:207-210` 补显示 `agent.notice`）
- Modify: `apps/desktop/src/renderer/src/components/ProposalCard.vue`（expired 态：禁用四按钮 + 一句中文 + diff 不再取回的说明）
- Test: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`（`ensureHydrated` 八规则；`loadSession` 桩改成可编排）

**Interfaces:**
- Consumes: `window.mochen.loadSession`（Task 1/2）、`reduceEvent(…, { fetchDiff:false })`（Task 4）、`replayProposalStatuses`（Task 4）、`canContinue`（`:151`）、`ThreadView.hydrated/hydrating`（Task 4）、`PROPOSAL_STATUS_LABELS`（Task 4）
- Produces: `ensureHydrated(threadKey: string): Promise<void>`；`runHydrate` 为内部 action

- [x] **Step 1：先写会红的测试**

`apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`：把 Step（Task 4）里那个恒返回 `no-session` 的 `loadSession` 桩改成可编排（模块级 `let sessionResult` + 桩返回它），并加一个 `found` 用的 events 工厂。替换/追加：

```ts
import { splitProposalCards } from "../utils/timeline";
import { turnAnchors } from "../utils/timeline";
```

```ts
// 可编排的回放取数桩：每个用例先设 sessionResult 再 ensureHydrated。
let sessionResult: SessionLoadResult = {
  found: false,
  reason: "no-session",
  message: "这本书里没有这条线程的历史。"
};
const loadSession = vi.fn(async (): Promise<SessionLoadResult> => sessionResult);

function loaded(events: AgentEvent[], droppedLines: number[] = []): SessionLoadResult {
  return {
    found: true,
    relPath: ".mochen/sessions/x.jsonl",
    meta: {
      type: "session-meta",
      sessionId: "s1",
      docRelPath: CH,
      stageId: "draft",
      model: "mochen-mock",
      startedAt: "2026-10-01T00:00:00.000Z"
    },
    events,
    droppedLines
  };
}
```

追加用例（放进 `describe("useAgentStore")`）：

```ts
  it("规则1 幂等：hydrated 后再按 /resume 不重复取数", async () => {
    await openChapter();
    sessionResult = loaded([eventOf("user-message", { text: "改紧" })]);
    loadSession.mockClear();
    await store().ensureHydrated(CH);
    await store().ensureHydrated(CH);
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(store().viewOf(CH).items.length).toBe(1);
  });

  it("规则2 running 时跳过：本轮在跑不抢迟到 delta 的顺序", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    loadSession.mockClear();
    await store().ensureHydrated(CH);
    expect(loadSession).not.toHaveBeenCalled();
    expect(store().viewOf(CH).hydrated).toBe(false);
  });

  it("规则3 并发合流 + 失败回滚可重试", async () => {
    await openChapter();
    loadSession.mockClear();
    sessionResult = { found: false, reason: "no-book", message: "还没打开作品目录，历史读不回来。" };
    const first = store().ensureHydrated(CH);
    const second = store().ensureHydrated(CH);
    await Promise.all([first, second]);
    expect(loadSession).toHaveBeenCalledTimes(1);
    // no-book 不置位（规则5），下次还能水合：
    expect(store().viewOf(CH).hydrated).toBe(false);
    // 抛错路径：回滚 hydrated=false、hydrating=false，notice 见中文，可再按 /resume
    loadSession.mockImplementationOnce(async () => {
      throw new Error("会话首行不可用（x）：坏");
    });
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).hydrating).toBe(false);
    expect(store().notice).toContain("会话首行不可用");
  });

  it("规则4 按事件 id 去重：实时已有 e-message，回放再送同 id 不叠加、旧卡不打 diff IPC", async () => {
    await openChapter();
    store().startListening();
    proposalDiff.mockClear();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { id: "e-message", text: "实时正文", interrupted: false })
    });
    sessionResult = loaded([
      eventOf("message", { id: "e-message", text: "实时正文", interrupted: false }),
      eventOf("proposal", { proposal: proposal("pOld") })
    ]);
    await store().ensureHydrated(CH);
    expect(itemsOf("message" in {} ? CH : CH).filter((e) => e.id === "e-message").length).toBe(1);
    expect(store().proposals["pOld"]!.status).toBe("expired");
    expect(proposalDiff).not.toHaveBeenCalled(); // 规则4：fetchDiff:false（M1）
  });

  it("规则5 no-session 置位、no-book 不置位", async () => {
    await openChapter();
    sessionResult = { found: false, reason: "no-session", message: "这本书里没有这条线程的历史。" };
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).hydrated).toBe(true);
  });

  it("规则6 派生扫描覆盖 status：decision 配对的卡不是 expired", async () => {
    await openChapter();
    sessionResult = loaded([
      eventOf("proposal", { proposal: proposal("pA") }),
      eventOf("decision", { proposalId: "pA", decision: "cancel", guidance: "", auto: false })
    ]);
    await store().ensureHydrated(CH);
    expect(store().proposals["pA"]!.status).toBe("cancelled");
  });

  it("规则7 droppedLines>0 写中文 notice 且不伪造事件", async () => {
    await openChapter();
    sessionResult = loaded([eventOf("user-message", { text: "改紧" })], [3, 9]);
    await store().ensureHydrated(CH);
    expect(store().notice).toBe("这条线程有 2 行没能读回，其余内容已恢复。");
    expect(store().viewOf(CH).items.length).toBe(1);
  });

  it("规则8（M3）只有 interrupted 结尾才复活「继续」；error 结尾不标 failed", async () => {
    await openChapter();
    sessionResult = loaded([
      eventOf("user-message", { text: "改紧" }),
      eventOf("interrupted", { pendingProposals: 0 })
    ]);
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).endedAs).toBe("interrupted");
    expect(store().canContinue(CH)).toBe(true);
    // 换 error 结尾：lastError 保留但不 failed，canContinue 必须为假。
    store().threads[CH]!.hydrated = false;
    store().threads[CH]!.endedAs = "";
    sessionResult = loaded([
      eventOf("user-message", { text: "改紧" }),
      eventOf("error", { message: "模型服务端返回 503：上游繁忙" })
    ]);
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).endedAs).toBe("");
    expect(store().canContinue(CH)).toBe(false);
    expect(store().viewOf(CH).lastError).toBe("模型服务端返回 503：上游繁忙");
  });
```

> 上面「规则4」用例里那句 `itemsOf("message" in {} ? CH : CH)` 是刻意留的笨写法提醒：**执行时替换为** `itemsOf(CH).filter((e) => e.id === "e-message").length`（`itemsOf` 已在测试文件 `:143` 定义）。留这行的目的是逼执行者读一遍去重断言而不是复制粘贴——落地后这句必须是干净的 `itemsOf(CH).filter(...)`。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: FAIL —— `store().ensureHydrated is not a function`。

- [x] **Step 2：`useAgentStore.ts` import**

顶部 `@mochen/contracts` import 加 `type SessionLoadResult`。再加一行：

```ts
import { replayProposalStatuses } from "../utils/timeline";
```

- [x] **Step 3：`useAgentStore.ts` 加 `ensureHydrated` / `runHydrate`**

在 `actions` 里 `tick()`（`:348`）之前插入：

```ts
    /** 水合入口：八条规则逐字照 spec §4.3。判定与取数全在 store，组件只触发。 */
    async ensureHydrated(threadKey: string): Promise<void> {
      const thread = this.viewOf(threadKey);
      if (thread.hydrated) return; // 规则1 幂等
      if (thread.running) return; // 规则2 running 时不抢顺序
      if (thread.hydrating) {
        // 规则3 并发合流：复用同一次在途取数，不发第二条 IPC
        const inflight = this.hydrateInflight[threadKey];
        if (inflight !== undefined) await inflight;
        return;
      }
      thread.hydrating = true;
      const task = this.runHydrate(threadKey, thread);
      this.hydrateInflight[threadKey] = task;
      try {
        await task;
      } finally {
        delete this.hydrateInflight[threadKey];
      }
    },

    async runHydrate(threadKey: string, thread: ThreadView): Promise<void> {
      let result: SessionLoadResult;
      try {
        result = await window.mochen.loadSession(threadKey);
      } catch (err) {
        // 规则3 失败回滚：首行坏 / IPC 抛 ⇒ 留待用户再按 /resume 重试
        thread.hydrating = false;
        this.notice = `这条线程的历史没有读回来：${reasonOf(err)}`;
        return;
      }
      thread.hydrating = false;
      if (!result.found) {
        // 规则5：no-session 视为确实没有历史 ⇒ 置位；no-book 不置位（下次开书还得能水合）
        if (result.reason === "no-session") thread.hydrated = true;
        return;
      }
      // 规则4：只归约 items 里不存在该事件 id 的那些，且关掉 diff 取数（M1）
      const known = new Set(thread.items.map((item) => item.id));
      for (const event of result.events) {
        if (known.has(event.id)) continue;
        known.add(event.id);
        this.reduceEvent(thread, event, { fetchDiff: false });
      }
      // 规则6：派生扫描覆盖这些卡的 status（expired 卡已在规则4 里没请求 diff）
      const replayed = replayProposalStatuses(result.events);
      for (const [id, status] of Object.entries(replayed)) {
        const view = this.proposals[id];
        if (view) view.status = status;
      }
      // 规则8：只有最后一条是 interrupted 才复活「继续」；error 保守不标 failed
      const last = result.events[result.events.length - 1];
      if (last?.type === "interrupted") thread.endedAs = "interrupted";
      // 规则7：坏行如实播报，不伪造事件、不静默
      if (result.droppedLines.length > 0)
        this.notice = `这条线程有 ${result.droppedLines.length} 行没能读回，其余内容已恢复。`;
      thread.hydrated = true;
    },
```

- [x] **Step 4：`apply` 的 turn-end 分支补一次水合**

把 `apply` 末尾（`:210-214`）改为：

```ts
      thread.running = false;
      thread.turnId = null;
      thread.streaming = { ...EMPTY_STREAM };
      thread.endedAs = outbound.status;
      if (outbound.status === "failed") thread.lastError = outbound.message;
      // 规则2 的另一半：轮次跑完才允许补一次水合（running 时上面早退过了）。
      if (!thread.hydrated) void this.ensureHydrated(outbound.threadKey);
```

- [x] **Step 5：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: PASS（含 Task 4 新增）。

- [x] **Step 6：`CenterColumn.vue` 三处水合时机 + 占位 + expired 第三组**

script：第 4 行 `import { computed, onBeforeUnmount, onMounted, ref } from "vue";` 加 `watch`；import 处不需要新符号（`expired` 走 `PROPOSAL_STATUS_LABELS` 由卡片带）。在 `const threadKey = computed(...)`（`:36`）之后加：

```ts
const hydrating = computed(() => thread.value?.hydrating ?? false);
const hydratedEmpty = computed(
  () => thread.value?.hydrated === true && (thread.value?.items.length ?? 0) === 0
);
```

并在 `const statusLine = ...`（`:53-55`，Task 7 会再改）之前，加三处时机里「开书 + 切文稿标签」的接线（`/resume` 走 Task 8 的面板动作，调同一个 `ensureHydrated`，靠规则1 幂等）：

```ts
// 水合时机（spec §4.4）：开书后（rootPath 落定）与切文稿标签（threadKey 变）各触发一次。
// 判定与取数全在 store；immediate 让「已开书状态下重新挂载」也能回放。
watch(
  [() => book.rootPath, threadKey],
  ([root]) => {
    if (root !== null) void agent.ensureHydrated(threadKeyFor(book.activeDocTab));
  },
  { immediate: true }
);
```

template 第三组：在「已裁决」`<details>`（`:187-200`）之后加。先补 computed（script 里 `const settledCards`（`:49`）之后）：

```ts
const expiredCards = computed(() => cardSplit.value.expired);
```

```html
          <!-- 上次会话未处理（D1）：回放的未裁决卡，按钮禁用，绝不伪装成可批准。 -->
          <details v-if="expiredCards.length" class="expired-stack">
            <summary class="expired-summary">上次会话未处理 · {{ expiredCards.length }} 条</summary>
            <div class="expired-cards">
              <ProposalCard
                v-for="card in expiredCards"
                :key="card.proposal.id"
                :view="card"
                :running="running"
                :turn-label="turnLabel(card)"
                @decide="(decision, guidance) => decide(card.proposal.id, decision, guidance)"
                @interrupt="agent.stop()"
              />
            </div>
          </details>
```

空状态判断（`:155-156` 的 `v-if`）加 `expiredCards.length`，并加占位段（`:171` 的 `v-else` 之前插入一个 `v-else-if`）：

```html
        <div
          v-if="
            items.length === 0 &&
            !running &&
            !hydrating &&
            openCards.length === 0 &&
            settledCards.length === 0 &&
            expiredCards.length === 0
          "
          class="conversation-empty"
        >
          <!-- …（原空状态内容一字不动）… -->
        </div>

        <div v-else-if="hydrating && !hydratedEmpty" class="conversation-empty">
          <p class="hydrating-line">正在恢复这一条线程…</p>
        </div>
```

**（本任务顺带补一处现仓缺陷）**：`useAgentStore.notice` 在 8 处写入（`:182`、`:247`、`:272`、`:290`、`:323`、`:343` + 本任务的两处水合播报），但渲染层从来没有显示过它——`CenterColumn.vue:209` 与 `DocumentPane.vue:184` 都只读 `book.notice`。回放失败的中文原因因此会写进一个没人看的字段，直接违反「错误可见」。在状态条（`:207-210`）里补一行，纯接线、不判断：

```html
    <div class="agent-statusbar">
      <span class="status-line">{{ statusLine }}</span>
      <span v-if="book.notice" class="status-note">{{ book.notice }}</span>
      <span v-if="agent.notice" class="status-note status-note-agent">{{ agent.notice }}</span>
    </div>
```

- [x] **Step 7：`ProposalCard.vue` expired 态**

script：`const pending`（`:16`）之后加：

```ts
const expired = computed(() => props.view.status === "expired");
```

template：`<p v-else class="proposal-diff-empty">diff 尚未取回</p>`（`:65`）改为区分 expired：

```html
    <p v-else-if="expired" class="proposal-diff-empty">这条历史提案的 diff 不再取回。</p>
    <p v-else class="proposal-diff-empty">diff 尚未取回</p>
```

`<footer v-if="pending" ...>`（`:74`）之后、`</article>` 之前加 expired 页脚：

```html
    <footer v-else-if="expired" class="proposal-actions is-expired">
      <p class="expired-note">这一条要在新一轮里重新提出。</p>
      <div class="proposal-buttons">
        <button class="is-primary" type="button" disabled>仅这一次批准</button>
        <button type="button" disabled>本章不再问</button>
        <button type="button" disabled>同文档同类改动不再问</button>
        <button class="is-danger" type="button" disabled>拒绝并说明</button>
      </div>
    </footer>
```

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断（此处 `RendererApi` 的两处 `satisfies` 夹具已在 Task 4 补齐；`splitProposalCards` 返回 `expired` 在 `CenterColumn` 消费）。
Run: `corepack pnpm prettier --write apps/desktop/src/renderer && corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4`
Expected: PASS。

- [x] **Step 8：连带清单**

- `useAgentStore.ts`：`apply` turn-end（`:210-214`）加补触发；`hydrateInflight` state（Task 4 已建位）；`runHydrate`/`ensureHydrated` 两个 action。
- `CenterColumn.vue`：`watch` 引入、`hydrating`/`hydratedEmpty`/`expiredCards` computed、空状态 `v-if` 加 `!hydrating` 与 `expiredCards.length`、占位 `v-else-if`、expired `<details>`。**行数预算自查**：Run `wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue` —— 本任务后应 ≤300 行（波 1 末 ≤400 的预算里，Task 7 还会加面板挂载与热key接线）；若逼近 300 说明 expired `<details>` 可抽 `ProposalStack.vue`，本任务先不抽（≤400 硬线由 `tools/check-source-line-budget.mjs` 800 行兜底，但本片自设 400）。
- `ProposalCard.vue`：`expired` computed + expired `<footer>`。
- 占位文案定稿：`正在恢复这一条线程…`；droppedLines 播报定稿：`这条线程有 N 行没能读回，其余内容已恢复。`；no-book `还没打开作品目录，历史读不回来。`；no-session `这本书里没有这条线程的历史。`（后两句来自 Task 3 主进程返回值，须逐字一致——Task 3/5 共用同一字符串，改一处必改另一处，写进台账提醒）。

- [x] **Step 9：变异实验 M1 + M3**

M1（回放复用同一归约器且不白打 diff IPC）：用 Edit 把 `runHydrate` 里 `this.reduceEvent(thread, event, { fetchDiff: false });` 改成 `{ fetchDiff: true }`。
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected 转红：「规则4 … 旧卡不打 diff IPC」用例 `expect(proposalDiff).not.toHaveBeenCalled()` 红（`proposalDiff` 调用数 > 0）。写回 `false`。

M3（只有 interrupted 结尾才复活「继续」）：用 Edit 把 `runHydrate` 里 `if (last?.type === "interrupted") thread.endedAs = "interrupted";` 改成 `if (last?.type === "error") thread.endedAs = "failed";`。
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected 转红：「规则8（M3）」用例后半 `expect(store().canContinue(CH)).toBe(false)` 红（error 结尾被标 failed ⇒ canContinue 真）。写回。

恢复后 `git diff --exit-code apps/desktop/src/renderer/src/stores/useAgentStore.ts` 必须空。

- [x] **Step 10：提交**

```bash
git add apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ProposalCard.vue
git commit -m "feat(renderer): ensureHydrated 八规则水合、expired 第三组与恢复占位"
```

---

### Task 6：`utils/hotkeys.ts` —— `resolveHotkey` 纯函数 + 全焦点组合矩阵（变异 M4）

**Files:**
- Create: `apps/desktop/src/renderer/src/utils/hotkeys.ts`
- Test: `apps/desktop/src/renderer/src/utils/hotkeys.test.ts`

> 本任务**只写纯函数与矩阵测试**，不碰任何组件——判定 100% 留在这里，接线是 Task 7。逐字照接口总表与 spec §5 的键位表。

**Interfaces:**
- Consumes: 无（纯函数，入参是拆开的修饰键，不读 DOM、不接 `KeyboardEvent`）
- Produces: `HotkeyMods` / `HotkeyFocus` / `HotkeyAction` / `HotkeyResult` / `resolveHotkey(focus, key, mods): HotkeyResult`

- [x] **Step 1：先写会红的测试**

Create `apps/desktop/src/renderer/src/utils/hotkeys.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  resolveHotkey,
  type HotkeyFocus,
  type HotkeyMods
} from "./hotkeys";

function focus(overrides: Partial<HotkeyFocus> = {}): HotkeyFocus {
  return {
    composerIsFocused: false,
    composerHasText: false,
    textInputIsFocused: false,
    proposalIsFocused: false,
    proposalIsPending: false,
    turnRunning: false,
    isComposing: false,
    hasBook: false,
    tabCount: 0,
    ...overrides
  };
}

function mods(overrides: Partial<HotkeyMods> = {}): HotkeyMods {
  return { ctrl: false, shift: false, alt: false, meta: false, ...overrides };
}

describe("resolveHotkey · 输入法合成闸门（M4）", () => {
  it("isComposing 为真时连 Enter/Esc 都一律 none：候选框回车不提交", () => {
    const composing = focus({ composerIsFocused: true, composerHasText: true, isComposing: true });
    expect(resolveHotkey(composing, "Enter", mods()).action).toBe("none");
    expect(resolveHotkey(focus({ isComposing: true }), "Escape", mods()).action).toBe("none");
    expect(resolveHotkey(focus({ isComposing: true }), "b", mods({ ctrl: true })).action).toBe("none");
  });
});

describe("resolveHotkey · composer 区", () => {
  it("Enter 无修饰、composer 有焦点、未在合成、!turnRunning ⇒ submit", () => {
    expect(resolveHotkey(focus({ composerIsFocused: true }), "Enter", mods()).action).toBe("submit");
  });
  it("Enter 但 turnRunning ⇒ none（要追加指令走 Tab）", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true, turnRunning: true }), "Enter", mods()).action
    ).toBe("none");
  });
  it("Shift+Enter 与 Ctrl+J ⇒ newline", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true }), "Enter", mods({ shift: true })).action
    ).toBe("newline");
    expect(
      resolveHotkey(focus({ composerIsFocused: true }), "j", mods({ ctrl: true })).action
    ).toBe("newline");
  });
  it("Tab：运行中有文本 ⇒ queue；其余 ⇒ none（保焦点移动）", () => {
    expect(
      resolveHotkey(focus({ composerIsFocused: true, composerHasText: true, turnRunning: true }), "Tab", mods())
        .action
    ).toBe("queue");
    expect(resolveHotkey(focus({ composerHasText: true }), "Tab", mods()).action).toBe("none");
  });
});

describe("resolveHotkey · Esc 委托", () => {
  it("Escape 一律 delegated（Esc 的裁决仍在 resolveEscape，不在这里复制）", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "Escape", mods()).action).toBe("delegated");
  });
});

describe("resolveHotkey · 审批四键", () => {
  it("聚焦待审卡、不在文本框：y/a/p/d 各给一个审批态", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: true });
    expect(resolveHotkey(f, "y", mods()).action).toBe("approve-once");
    expect(resolveHotkey(f, "a", mods()).action).toBe("approve-session");
    expect(resolveHotkey(f, "p", mods()).action).toBe("approve-prefix");
    expect(resolveHotkey(f, "d", mods()).action).toBe("deny-guidance");
  });
  it("卡已非 pending（含 expired）⇒ 四键全 none", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: false });
    for (const k of ["y", "a", "p", "d"]) expect(resolveHotkey(f, k, mods()).action).toBe("none");
  });
  it("文本框有焦点时四键全 none（编辑态护栏）", () => {
    const f = focus({ proposalIsFocused: true, proposalIsPending: true, textInputIsFocused: true });
    for (const k of ["y", "a", "p", "d"]) expect(resolveHotkey(f, k, mods()).action).toBe("none");
  });
});

describe("resolveHotkey · 全局 Ctrl 族", () => {
  it("Ctrl+B / Ctrl+, 任意焦点生效；Ctrl+PageDown/Up 需有书", () => {
    expect(resolveHotkey(focus(), "b", mods({ ctrl: true })).action).toBe("toggle-left");
    expect(resolveHotkey(focus(), ",", mods({ ctrl: true })).action).toBe("open-settings");
    expect(resolveHotkey(focus({ hasBook: false }), "PageDown", mods({ ctrl: true })).action).toBe(
      "none"
    );
    expect(resolveHotkey(focus({ hasBook: true }), "PageDown", mods({ ctrl: true })).action).toBe(
      "next-tab"
    );
    expect(resolveHotkey(focus({ hasBook: true }), "PageUp", mods({ ctrl: true })).action).toBe(
      "prev-tab"
    );
  });
  it("Ctrl+1..9：越界或无书 ⇒ none；n≤tabCount ⇒ jump-tab 且 tabIndex=n-1", () => {
    expect(resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "3", mods({ ctrl: true }))).toEqual({
      action: "jump-tab",
      tabIndex: 2
    });
    expect(resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "9", mods({ ctrl: true })).action).toBe(
      "none"
    );
    expect(resolveHotkey(focus({ hasBook: false, tabCount: 3 }), "1", mods({ ctrl: true })).action).toBe(
      "none"
    );
    expect(resolveHotkey(focus({ hasBook: true, tabCount: 3 }), "0", mods({ ctrl: true })).action).toBe(
      "none"
    );
  });
});

describe("resolveHotkey · / 开面板", () => {
  it("composer 无焦点、不在文本框、无修饰键 ⇒ open-palette", () => {
    expect(resolveHotkey(focus({ hasBook: true }), "/", mods()).action).toBe("open-palette");
  });
  it("composer 有焦点时 / 只是打字 ⇒ none", () => {
    expect(resolveHotkey(focus({ composerIsFocused: true }), "/", mods()).action).toBe("none");
  });
  it("其余按键 ⇒ none", () => {
    expect(resolveHotkey(focus(), "z", mods()).action).toBe("none");
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/hotkeys.test.ts --maxWorkers=4`
Expected: FAIL —— 模块不存在 `Cannot find module './hotkeys'`（vitest 报 `Failed to load ... hotkeys`）。

- [x] **Step 2：`hotkeys.ts` 落地**

Create `apps/desktop/src/renderer/src/utils/hotkeys.ts`：

```ts
/**
 * 键位判定层（spec §5）：只回答「哪个键在什么焦点下等于哪个动作」。
 * 入参是拆开的修饰键而不是 KeyboardEvent——不依赖 DOM，也不会有人偷偷传 event 读别的字段。
 * Esc 一律 delegated：真正的三态裁决仍在 utils/escape-policy.ts 的 resolveEscape，这里绝不复制一份。
 */
export interface HotkeyMods {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface HotkeyFocus {
  composerIsFocused: boolean;
  composerHasText: boolean;
  /** 文稿编辑器 / 说明框 / 设置输入 / 检索类输入统一算它。 */
  textInputIsFocused: boolean;
  proposalIsFocused: boolean;
  proposalIsPending: boolean;
  turnRunning: boolean;
  isComposing: boolean;
  hasBook: boolean;
  tabCount: number;
}

export type HotkeyAction =
  | "submit"
  | "newline"
  | "queue"
  | "delegated"
  | "none"
  | "approve-once"
  | "approve-session"
  | "approve-prefix"
  | "deny-guidance"
  | "next-tab"
  | "prev-tab"
  | "jump-tab"
  | "toggle-left"
  | "open-settings"
  | "open-palette";

export interface HotkeyResult {
  action: HotkeyAction;
  tabIndex?: number;
}

const APPROVAL_KEYS: Record<string, HotkeyAction> = {
  y: "approve-once",
  a: "approve-session",
  p: "approve-prefix",
  d: "deny-guidance"
};

export function resolveHotkey(focus: HotkeyFocus, key: string, mods: HotkeyMods): HotkeyResult {
  const none: HotkeyResult = { action: "none" };
  // 护栏 1（M4）：输入法合成期间一律不截键——候选框回车被吃掉是这类应用最刺眼的错。
  if (focus.isComposing) return none;

  const bare = !mods.ctrl && !mods.alt && !mods.meta; // 是否只可能带 shift（或不带）
  const noMods = bare && !mods.shift;
  const k = key.length === 1 ? key.toLowerCase() : key;

  // 全局 Ctrl 族（先于编辑态判断：即便在文本框里也应放行）
  if (mods.ctrl && !mods.alt && !mods.meta) {
    if (!mods.shift) {
      if (k === "b") return { action: "toggle-left" };
      if (k === ",") return { action: "open-settings" };
      if (focus.hasBook && k === "PageDown") return { action: "next-tab" };
      if (focus.hasBook && k === "PageUp") return { action: "prev-tab" };
      if (/^[1-9]$/.test(k)) {
        const index = Number(k) - 1;
        if (focus.hasBook && index < focus.tabCount) return { action: "jump-tab", tabIndex: index };
        return none; // 越界 / 无书
      }
      if (focus.composerIsFocused && k === "j") return { action: "newline" }; // Ctrl+J
    }
    return none; // 其余 Ctrl 组合不在键位表
  }

  // Esc：委托给 resolveEscape（裁决不在这层）
  if (k === "Escape") return { action: "delegated" };

  // / 开面板：composer 无焦点且不在文本框、无修饰键
  if (k === "/" && noMods && !focus.composerIsFocused && !focus.textInputIsFocused)
    return { action: "open-palette" };

  // Tab 排队：仅运行中有文本；其余保留焦点移动（无障碍优先）
  if (k === "Tab" && noMods)
    return focus.turnRunning && focus.composerHasText ? { action: "queue" } : none;

  // Enter / Shift+Enter（composer 焦点）
  if (k === "Enter" && focus.composerIsFocused && bare) {
    if (mods.shift) return { action: "newline" };
    return focus.turnRunning ? none : { action: "submit" };
  }

  // 审批四键：只作用于聚焦的那一张待审卡，且不在文本框里（护栏 2、4）
  if (
    noMods &&
    focus.proposalIsFocused &&
    focus.proposalIsPending &&
    !focus.textInputIsFocused &&
    k in APPROVAL_KEYS
  )
    return { action: APPROVAL_KEYS[k] as HotkeyAction };

  return none;
}
```

- [x] **Step 3：跑到绿并过 prettier/tsc**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/hotkeys.test.ts --maxWorkers=4`
Expected: PASS（覆盖 spec §5 键位表每一行 + 五条护栏的反向用例）。
Run: `corepack pnpm prettier --write apps/desktop/src/renderer/src/utils && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。

- [x] **Step 4：变异实验 M4（去掉 isComposing 闸门）**

用 Edit 删掉 `hotkeys.ts` 里 `if (focus.isComposing) return none;` 这一行。
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/hotkeys.test.ts --maxWorkers=4`
Expected 转红：「isComposing 为真时连 Enter/Esc 都一律 none」——Enter 变 `submit`、Esc 变 `delegated`，断言失败。写回该行。
恢复后 `git diff --exit-code apps/desktop/src/renderer/src/utils/hotkeys.ts` 必须空。

- [x] **Step 5：提交**

```bash
git add apps/desktop/src/renderer/src/utils/hotkeys.ts apps/desktop/src/renderer/src/utils/hotkeys.test.ts
git commit -m "feat(renderer): resolveHotkey 纯函数与全焦点组合矩阵"
```

---

### Task 7：键位接线 —— `composables/useHotkeys.ts` 薄壳 + 替换 CenterColumn 唯一 Esc 监听 + `Tab` 排队的 store 侧

**Files:**
- Create: `apps/desktop/src/renderer/src/composables/useHotkeys.ts`（薄壳，全局唯一 keydown）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue`（删 `onGlobalEscape` 与 `document.addEventListener("keydown", …)`（`:98-102`、`:108`、`:112`），改挂 `useGlobalHotkeys`；`statusLine`（`:53-55`）加 `queued` 入参；`ProviderSettings` 开合与 `layout.currentView` 桥接）
- Modify: `apps/desktop/src/renderer/src/components/ComposerBox.vue`（删自带 `@keydown`（`:18-28`），textarea 加 `data-mochen-composer`）
- Modify: `apps/desktop/src/renderer/src/components/ProposalCard.vue`（根 `<article>` 加 `data-proposal-card` / `data-proposal-id` / `data-proposal-status`；guidance textarea 加 `data-guidance`）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（`QUEUED_MAX` + `queueText` + turn-end 自动发队首 + `composeStatusLine` 加 `queued` 入参）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（`activateTab` / `cycleTab`）
- Test: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`（`composeStatusLine` 三处调用加第 4 参；排队用例）

**Interfaces:**
- Consumes: `resolveHotkey`（Task 6）、`resolveEscape`（`escape-policy.ts:14`）、`agent.decide`/`send`/`stop`/`queueText`、`book.activateTab`/`cycleTab`/`activeDocTab`、`layout.togglePane`/`showSettings`/`showWorkspace`/`currentView`、`threadKeyFor`
- Produces: `HotkeyHandlers { openPalette(): void }`、`useGlobalHotkeys(handlers): void`；`agent.queueText(threadKey, text): boolean`；`composeStatusLine(thread, seconds, pending, queued): string`；`useBookStore.activateTab(index): boolean`、`cycleTab(delta: 1|-1): void`；`QUEUED_MAX = 5`

- [x] **Step 1：先写会红的测试（store 侧排队 + 状态行）**

`apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`：

1) 三处 `composeStatusLine` 调用（`:410`–`:424`）各加第 4 参 `0`，并加一条排队显示断言。示例改法：

```ts
    expect(composeStatusLine(running, 42, 0, 0)).toBe("工作中 · 42s · Esc 打断");
    expect(composeStatusLine(running, 42, 0, 2)).toBe("工作中 · 42s · Esc 打断 · 排队 2 条");
    const idle = { ...store().viewOf("y"), running: false };
    expect(composeStatusLine(idle, 0, 3, 0)).toBe("3 条待审");
    expect(composeStatusLine(idle, 0, 0, 0)).toBe("就绪");
    expect(composeStatusLine(undefined, 0, 0, 0)).toBe("就绪");
    const cut = { ...idle, endedAs: "interrupted" as const };
    expect(composeStatusLine(cut, 0, 2, 0)).toBe("已打断 · 2 条待审");
    expect(composeStatusLine(cut, 0, 0, 0)).toBe("已打断 · 可点「继续」");
    const failed = {
      ...idle,
      endedAs: "failed" as const,
      lastError: "模型服务端返回 503：上游繁忙"
    };
    expect(composeStatusLine(failed, 0, 0, 0)).toBe("模型服务端返回 503：上游繁忙 · 可点「继续」");
```

2) 排队用例（放进 `describe("useAgentStore")`）：

```ts
  it("Tab 排队：满 5 条拒入队并写中文；turn-end 自动发队首且不打断不清队", async () => {
    await openChapter();
    store().startListening();
    for (let i = 1; i <= 5; i += 1) expect(store().queueText(CH, `第 ${i} 条`)).toBe(true);
    expect(store().queueText(CH, "第六条")).toBe(false);
    expect(store().notice).toBe("排队指令最多 5 条，先等这一轮结束。");
    expect(store().viewOf(CH).queued.length).toBe(5);
    // 打断不清队：
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    store().threads[CH]!.turnId = "t1";
    await store().stop();
    expect(store().viewOf(CH).queued.length).toBe(5);
    // turn-end 自动发队首（一轮只发一条）：
    started.length = 0;
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "interrupted", message: "" });
    await Promise.resolve();
    expect(started.map((input) => input.userText)).toEqual(["第 1 条"]);
    expect(store().viewOf(CH).queued.length).toBe(4);
  });
```

> `started` 是测试文件已有的模块级数组（`:81`），`stop()` 走 `interruptTurn` 桩（`:95`）。`store().threads[CH]!.turnId = "t1"` 是为了让 `stop()` 有 turnId 可打；`turn-start` 推送已置 turnId，这行只为显式锚定，保留亦可。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: FAIL —— `store().queueText is not a function`；且 `composeStatusLine(running,42,0,2)` 第 4 参被忽略 ⇒ 缺「排队 2 条」。

- [x] **Step 2：`useAgentStore.ts` 排队侧**

模块顶层（`CONTINUE_TEXT` 之后，`:24` 附近）加常量：

```ts
/** 运行中 Tab 排队的上限（spec §5.1）；满则拒入队并写中文。 */
export const QUEUED_MAX = 5;
```

`composeStatusLine`（114–131）加第 4 参并改运行分支：

```ts
export function composeStatusLine(
  thread: ThreadView | undefined,
  seconds: number,
  pending: number,
  queued: number
): string {
  if (thread?.running)
    return `工作中 · ${seconds}s · Esc 打断${queued > 0 ? ` · 排队 ${queued} 条` : ""}`;
  // …其余分支一字不动…
}
```

`actions` 里 `continueTurn` 之后加 `queueText`：

```ts
    /** 运行中按 Tab：把 composer 文本 trim 后入队，不发 IPC；满 5 条拒收并写中文（spec §5.1）。 */
    queueText(threadKey: string, text: string): boolean {
      const thread = this.viewOf(threadKey);
      const value = text.trim();
      if (value === "") return false;
      if (thread.queued.length >= QUEUED_MAX) {
        this.notice = "排队指令最多 5 条，先等这一轮结束。";
        return false;
      }
      thread.queued.push(value);
      return true;
    },
```

`apply` 的 turn-end 分支（Task 5 已在末尾补了 `if (!thread.hydrated) void this.ensureHydrated(...)`）在其后追加自动发队首：

```ts
      // 规则：turn-end{interrupted} 照样自动发下一条（打断不清队，spec §5.1）。一轮只发一条。
      if (thread.queued.length > 0) this.send(thread.queued.shift() as string);
```

> **口径（须与评审对齐）**：`send()` 依 `useBookStore.activeDocTab` 组 `threadKey`。本轮结束自动发的是「刚结束这条线程」的队首，前提是该线程仍是活动标签；若用户在轮次运行中切走了标签再回，`send()` 会发给当下活动线程。spec §5.1 字面即「取队首调 send()」，本任务不引入线程绑定的 `sendToThread`（那会改 `send` 形状、超出接口总表）。切标签清队不是本片行为——队列在 `stop()`（打断）里明确不清。此偏差写进台账风险。

- [x] **Step 3：`useBookStore.ts` 加 `activateTab` / `cycleTab`**

在 `actions` 里 `closeTab`（90–98）之后加：

```ts
    /** Ctrl+1..9：越界返回 false 且不改状态。 */
    activateTab(index: number): boolean {
      const target = this.docTabs[index];
      if (target === undefined) return false;
      void this.openDocTab(target);
      return true;
    },

    /** Ctrl+PageUp/Down：环形切换；无标签时不动。 */
    cycleTab(delta: 1 | -1): void {
      if (this.docTabs.length === 0) return;
      const current = this.activeDocTab ? this.docTabs.indexOf(this.activeDocTab) : -1;
      const next = (current + delta + this.docTabs.length) % this.docTabs.length;
      const target = this.docTabs[next];
      if (target !== undefined) void this.openDocTab(target);
    },
```

（无独立单测文件新增：本波在 `useBookStore.test.ts` 现有 `describe("useBookStore")` 里加两条——`activateTab` 越界返 false 不改 `activeDocTab`；`cycleTab(1)` 在两标签间环形。见 Step 4 连带。）

`useBookStore.test.ts` 追加：

```ts
  it("activateTab 越界返回 false 且不切标签；cycleTab 在两标签间环形", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("materials/雾.md");
    expect(store.activateTab(9)).toBe(false);
    expect(store.activeDocTab).toBe("materials/雾.md");
    store.cycleTab(1);
    await Promise.resolve();
    expect(store.activeDocTab).toBe("chapters/01-a.md");
  });
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: 两条 store 用例 PASS。

- [x] **Step 4：`useHotkeys.ts` 薄壳（全局唯一 keydown）**

Create `apps/desktop/src/renderer/src/composables/useHotkeys.ts`：

```ts
// 薄壳：装全局唯一 keydown 监听、从 store 组 HotkeyFocus、把 HotkeyResult 派到既有 action。
// 键→动作的判断 100% 在 utils/hotkeys.ts；Esc 的三态裁决 100% 在 utils/escape-policy.ts。本文件不判断。
import { onBeforeUnmount, onMounted } from "vue";
import { resolveHotkey, type HotkeyAction, type HotkeyFocus, type HotkeyMods } from "../utils/hotkeys";
import { resolveEscape } from "../utils/escape-policy";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";

export interface HotkeyHandlers {
  openPalette(): void;
}

export function useGlobalHotkeys(handlers: HotkeyHandlers): void {
  const agent = useAgentStore();
  const book = useBookStore();
  const layout = useLayoutStore();

  function isText(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || el.isContentEditable;
  }

  function focusOf(event: KeyboardEvent): HotkeyFocus {
    const composer = document.querySelector<HTMLTextAreaElement>("[data-mochen-composer]");
    const composerEl = event.target === composer ? composer : null;
    const card = (event.target as HTMLElement)?.closest?.("[data-proposal-card]");
    const active = document.activeElement;
    const activeCard = active instanceof HTMLElement ? active.closest("[data-proposal-card]") : null;
    return {
      composerIsFocused: composerEl !== null,
      composerHasText: (composerEl?.value.trim() ?? "") !== "",
      textInputIsFocused: isText(event.target) || isText(active),
      proposalIsFocused: activeCard !== null,
      proposalIsPending: activeCard?.getAttribute("data-proposal-status") === "pending",
      turnRunning: agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false,
      isComposing: (event as KeyboardEvent & { isComposing?: boolean }).isComposing === true,
      hasBook: book.rootPath !== null,
      tabCount: book.docTabs.length
    };
  }

  function dispatch(event: KeyboardEvent, action: HotkeyAction, tabIndex?: number): void {
    const composer = document.querySelector<HTMLTextAreaElement>("[data-mochen-composer]");
    const threadKey = threadKeyFor(book.activeDocTab);
    if (action === "submit" || action === "newline" || action === "queue") {
      const text = composer?.value ?? "";
      if (action === "newline") {
        event.preventDefault();
        if (composer) composer.value = `${composer.value}\n`;
        return;
      }
      if (text.trim() === "") return;
      event.preventDefault();
      if (composer) composer.value = "";
      if (action === "submit") agent.send(text.trim());
      else agent.queueText(threadKey, text);
      return;
    }
    if (action === "approve-once" || action === "approve-session" || action === "approve-prefix") {
      const card = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest("[data-proposal-card]")
        : null;
      const id = card?.getAttribute("data-proposal-id") ?? "";
      if (!id) return;
      event.preventDefault();
      void agent.decide(id, action, "");
      return;
    }
    if (action === "deny-guidance") {
      const card = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest("[data-proposal-card]")
        : null;
      const guidance = card?.querySelector<HTMLElement>("[data-guidance]");
      if (guidance) {
        event.preventDefault();
        guidance.focus();
      }
      return;
    }
    switch (action) {
      case "next-tab":
        event.preventDefault();
        book.cycleTab(1);
        return;
      case "prev-tab":
        event.preventDefault();
        book.cycleTab(-1);
        return;
      case "jump-tab":
        event.preventDefault();
        book.activateTab(tabIndex ?? 0);
        return;
      case "toggle-left":
        event.preventDefault();
        layout.togglePane("left");
        return;
      case "open-settings":
        event.preventDefault();
        layout.showSettings("general");
        return;
      case "open-palette":
        event.preventDefault();
        handlers.openPalette();
        return;
      case "delegated":
        escape(event);
        return;
      default:
        return;
    }
  }

  function escape(event: KeyboardEvent): void {
    const card = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest("[data-proposal-card]")
      : null;
    const guidance = card?.querySelector<HTMLTextAreaElement>("[data-guidance]");
    const action = resolveEscape({
      hasFocusedProposal: card !== null,
      focusedProposalPending: card?.getAttribute("data-proposal-status") === "pending",
      guidanceIsDirty: (guidance?.value.trim() ?? "") !== "",
      turnRunning: agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false
    });
    if (action === "keep-guidance") {
      event.preventDefault();
      guidance?.blur();
      return;
    }
    if (action === "cancel-proposal" && card) {
      event.preventDefault();
      void agent.decide(card.getAttribute("data-proposal-id") ?? "", "cancel", "");
      return;
    }
    if (action === "interrupt") {
      event.preventDefault();
      void agent.stop();
    }
  }

  function onKey(event: KeyboardEvent): void {
    const mods: HotkeyMods = {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey
    };
    const { action, tabIndex } = resolveHotkey(focusOf(event), event.key, mods);
    dispatch(event, action, tabIndex);
  }

  onMounted(() => document.addEventListener("keydown", onKey));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
}
```

- [x] **Step 5：`CenterColumn.vue` 接线**

1) 删掉旧 Esc 监听三处：`onGlobalEscape`（98–102）整段、`onMounted` 里的 `document.addEventListener("keydown", onGlobalEscape);`（`:108`）、`onBeforeUnmount` 里的 `document.removeEventListener("keydown", onGlobalEscape);`（`:112`）。`onMounted` 保留 `agent.startListening()` 与 `timer`。
2) script import 加 `import { useGlobalHotkeys } from "../composables/useHotkeys";` 与 `import { useLayoutStore } from "../stores/layoutStore";`（后者已在别处？没有——本文件原先没用 layout，需新增）。加：

```ts
const layout = useLayoutStore();
const paletteOpen = ref(false);
useGlobalHotkeys({ openPalette: () => (paletteOpen.value = true) });

// open-settings 经 layout.currentView 桥到本组件已有的 ProviderSettings 浮层
// （App.vue 当前不渲染 currentView==="settings" 视图，模型设置的唯一真身在这里）。
watch(
  () => layout.currentView,
  (view) => {
    if (view === "settings") showSettings.value = true;
  }
);
function closeSettings(): void {
  showSettings.value = false;
  layout.showWorkspace();
}
```

3) `statusLine`（`:53-55`）加第 4 参：

```ts
const statusLine = computed(() =>
  composeStatusLine(
    thread.value,
    agent.seconds,
    agent.pendingOf(threadKey.value),
    thread.value?.queued.length ?? 0
  )
);
```

4) template：`ProviderSettings`（`:221`）的 `@close` 改成 `closeSettings()`；末尾挂面板（Task 8 会补 `SlashPalette.vue`，本任务先留挂载点占位）：

```html
    <ProviderSettings v-if="showSettings" @close="closeSettings" />
```

- [x] **Step 6：`ComposerBox.vue` 交回全局层**

删 `onKeydown`（18–28）与 textarea 上的 `@keydown="onKeydown"`。textarea 加 `data-mochen-composer`：

```html
    <textarea
      v-model="text"
      data-mochen-composer
      class="composer-box"
      rows="3"
      :placeholder="
        ready
          ? '想改哪一段？说给人话，别贴整篇正文——它会自己读文件。'
          : '先在左栏打开作品，或在右上角设置里配好模型。'
      "
    />
```

（`submit()` 保留给「发送」按钮点击；`text` ref 保留 v-model。回车提交由全局监听经 `[data-mochen-composer]` 读取 `composer.value`——与 v-model 同源，DOM 值与 ref 同步。）

- [x] **Step 7：`ProposalCard.vue` 打标记**

根 `<article>`（`:49-54`）加**三个** data 属性（`useHotkeys.ts` 的 `focusOf`/`dispatch`/`escape` 全靠 `closest("[data-proposal-card]")` 找卡，缺这个标记四个审批键与 Esc 的卡内裁决全都落空），guidance `<textarea>`（`:75`）加 `data-guidance`：

```html
  <article
    class="proposal-card"
    :class="[`is-${view.status}`, { 'is-focused': pending }]"
    tabindex="0"
    data-proposal-card
    :data-proposal-id="view.proposal.id"
    :data-proposal-status="view.status"
    @keydown="onKeydown"
  >
```

> `@keydown="onKeydown"` 保留：卡内 Esc 已 `stopPropagation`（`:38`），它先于 document 冒泡处理，与全局 Esc 互不重复（spec §5 护栏 5、`:28-30` 手法不变）。data 属性只为全局 `focusOf` 读焦点态。guidance textarea：

```html
      <textarea
        v-model="guidance"
        data-guidance
        class="guidance-box"
        rows="2"
        placeholder="拒绝时写清该怎么改（Shift+Enter 换行，Esc 先保住这段字）"
      />
```

- [x] **Step 8：跑到绿 + 行数预算自查**

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。
Run: `corepack pnpm prettier --write apps/desktop/src/renderer && corepack pnpm vitest run apps/desktop/src/renderer/src/utils/hotkeys.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: PASS。
行数预算自查：`wc -l apps/desktop/src/renderer/src/composables/useHotkeys.ts`（目标薄壳；判定全在 utils，dispatch 只是接线，若超预算说明该把 `dispatch`/`escape` 收进 store action）。`wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue`（本任务后应 ≤340，波 1 末 ≤400）。

- [x] **Step 9：连带清单**

- `composeStatusLine` 加第 4 参 ⇒ 调用点 `CenterColumn.vue:53-55`（本任务改）、测试 `useAgentStore.test.ts:410-424`（本任务改）。全仓 grep `composeStatusLine` 无其它调用点。
- `useGlobalHotkeys` ⇒ `CenterColumn.vue` 唯一调用点；确认 `CenterColumn.vue` 再无 `document.addEventListener("keydown", …)`（旧 `onGlobalEscape` 已删）。**全局 keydown 有且只有一个**——grep `document.addEventListener("keydown"` 应只在 `useHotkeys.ts` 命中。
- `data-mochen-composer` ⇒ `ComposerBox.vue`；`[data-proposal-card]`/`[data-proposal-status]`/`[data-proposal-id]`/`[data-guidance]` ⇒ `ProposalCard.vue`。这些标记只被 `useHotkeys.ts` 读，别处不依赖。
- `open-settings` 经 `layout.showSettings("general")` + `CenterColumn` 桥接 `currentView`。**风险（写进台账）**：`App.vue` 目前不渲染 `currentView==="settings"` 视图，故 `Ctrl+,` / `/model` 走的是本桥接到 `ProviderSettings`；若波 2 给 `App.vue` 加独立设置视图，需把 `layout.showSettings` 的落点从 CenterColumn 桥改到新视图，避免两处都开。

- [x] **Step 10：提交**

```bash
git add apps/desktop/src/renderer/src/composables/useHotkeys.ts apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ComposerBox.vue apps/desktop/src/renderer/src/components/ProposalCard.vue apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts
git commit -m "feat(renderer): 全局唯一 keydown 接线、Tab 排队与状态行排队数"
```

---

### Task 8：`/` 命令面板 —— `utils/slash-commands.ts` 纯判定 + `SlashPalette.vue` + 面板动作派发

> 口径（spec §6 的三处没写死、本任务拍定）：
> 1. **波 1 的 `stage` 进枚举、不进面板**。`SLASH_COMMANDS` 逐字照接口总表落 6 条（含 `stage`），但 `availableCommands` 用一个具名闸门 `GATED_COMMANDS = ["stage"]` 把它滤掉——理由正是 spec §6 自己给的那条：「档案列表拿不到时禁 `stage`，因为切阶段会连带切档案」，而档案是波 2 的产物。波 2 的 Task 18 删掉这一行、改由 `PaletteFocus.profilesReady` 驱动。这样既守住了「穷尽 `Record` 是编译期闸」，也没有出现 spec 明令禁止的「列出来但按下去只会报错的按钮」。
> 2. **`/clear` 之后不回灌**：`clearThreadView` 把 `hydrated` 置真，所以三处自动水合时机（Task 5）不会立刻把清掉的内容倒回来；恢复办法就是确认文案里那句「重启后仍会完整回放」。`queued`（排队指令）**不清**——那是用户还没发出去的指令，不是显示内容。
> 3. **`/permissions [档名]` 在波 1 只接「打开档位菜单」这一支**（spec §6 给的是「打开档位选择器**或**直接切档」，二者择一即合规）：带档位名时把名字作为预选项传给菜单，菜单真身在 Task 9。本任务只落 `useBookStore.openPermissionMenu(preset)` 这个标志位与预选字符串，不写任何占位文案。

**Files:**

- Create: `apps/desktop/src/renderer/src/utils/slash-commands.ts`
- Create: `apps/desktop/src/renderer/src/utils/slash-commands.test.ts`
- Create: `apps/desktop/src/renderer/src/components/SlashPalette.vue`
- Create: `apps/desktop/src/renderer/src/styles/interaction.css`（波 1 新增控件的样式集中处，spec §14 的文件结构里就列了它）
- Modify: `apps/desktop/src/renderer/src/styles.css:7`（`@import "./styles/theme-runtime.css";` 之后追加一行 `@import "./styles/interaction.css";`）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（actions 段 `:160-357` 加 `runSlashCommand` / `clearThreadView`；模块顶层加 `composeStatusReport` / `CLEAR_VIEW_SENTENCE` / `END_STATE_LINES`；import 加 `PERMISSION_LABELS`、`DEFAULT_PERMISSION_MODE`、`useLayoutStore`、`SlashCommand` 类型）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（state `:19-38` 加 `permissionMenuOpen` / `permissionPreset`；actions 加 `openPermissionMenu` / `closePermissionMenu`）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue`（挂面板；HEAD 223 行版 `:221` 的 `ProviderSettings` 之后。**行号会因 Task 5/7 的接线整体下移，本任务一律按内容定位**）
- Test: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`、`apps/desktop/src/renderer/src/stores/useBookStore.test.ts`

**Interfaces:**

- Consumes: `ensureHydrated(threadKey)`（Task 5）、`pendingOf(threadKey): number`（`:143-148`）、`ThreadView.hydrated/hydrating/queued`（Task 4）、`useLayoutStore().showSettings(initialCategory)`（`stores/layoutStore.ts:89-92`）、`threadKeyFor`（`:61-65`）、`PERMISSION_LABELS` / `DEFAULT_PERMISSION_MODE`（`packages/contracts/src/permission.ts:3-9`）、Task 7 已在 `CenterColumn.vue` 建好的 `paletteOpen` ref 与 `useGlobalHotkeys({ openPalette })`
- Produces:
  ```ts
  export const SLASH_COMMANDS = ["model", "permissions", "status", "stage", "resume", "clear"] as const;
  export type SlashCommand = (typeof SLASH_COMMANDS)[number];
  export interface PaletteFocus { hasBook: boolean; turnRunning: boolean }
  export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string>;
  export function availableCommands(focus: PaletteFocus): SlashCommand[];
  export function parseSlashInput(text: string): { command: SlashCommand | null; argument: string };
  export function filterCommands(text: string, focus: PaletteFocus): SlashCommand[];
  export function paletteOwnsKey(key: string, isComposing: boolean): boolean;
  // stores/useAgentStore.ts
  export interface StatusFacts { threadKey: string; thread: ThreadView | undefined; cards: number; pending: number; permissionLabel: string; stageName: string }
  export function composeStatusReport(facts: StatusFacts): string;
  export const CLEAR_VIEW_SENTENCE: string;
  runSlashCommand(command: SlashCommand, argument: string): void;
  clearThreadView(threadKey: string): void;
  // stores/useBookStore.ts
  openPermissionMenu(preset?: string): void;
  closePermissionMenu(): void;
  ```

- [x] **Step 1：先写会红的纯函数测试**

Create `apps/desktop/src/renderer/src/utils/slash-commands.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_DESCRIPTIONS,
  availableCommands,
  filterCommands,
  parseSlashInput,
  paletteOwnsKey
} from "./slash-commands";

const NO_GATE = { hasBook: true, turnRunning: false };

describe("slash-commands · 枚举与说明表（铁律 6：一张表，穷尽键）", () => {
  it("波 1 落 6 条，顺序即面板顺序", () => {
    expect([...SLASH_COMMANDS]).toEqual([
      "model",
      "permissions",
      "status",
      "stage",
      "resume",
      "clear"
    ]);
  });

  it("每条命令都有中文说明，且说明表不多不少一个键", () => {
    expect(Object.keys(SLASH_COMMAND_DESCRIPTIONS).sort()).toEqual([...SLASH_COMMANDS].sort());
    for (const command of SLASH_COMMANDS) {
      expect(SLASH_COMMAND_DESCRIPTIONS[command].length).toBeGreaterThan(3);
    }
  });
});

describe("slash-commands · 运行期可用性", () => {
  it("有书、空闲：5 条（stage 被波 1 的闸门滤掉，绝不列出一个按下去只会报错的命令）", () => {
    expect(availableCommands(NO_GATE)).toEqual([
      "model",
      "permissions",
      "status",
      "resume",
      "clear"
    ]);
  });

  it("turn 运行中：只剩 model / permissions / status / clear（spec §6 的 available_during_task）", () => {
    expect(availableCommands({ hasBook: true, turnRunning: true })).toEqual([
      "model",
      "permissions",
      "status",
      "clear"
    ]);
  });

  it("没开书：拿掉要读书目录的 resume，其余四条仍然可用", () => {
    expect(availableCommands({ hasBook: false, turnRunning: false })).toEqual([
      "model",
      "permissions",
      "status",
      "clear"
    ]);
    expect(availableCommands({ hasBook: false, turnRunning: true })).toEqual([
      "model",
      "permissions",
      "status",
      "clear"
    ]);
  });
});

describe("slash-commands · 输入解析", () => {
  it("命令与参数以空白分开，档位名里的空格不拆坏", () => {
    expect(parseSlashInput("/resume")).toEqual({ command: "resume", argument: "" });
    expect(parseSlashInput("  /clear  ")).toEqual({ command: "clear", argument: "" });
    expect(parseSlashInput("/permissions 可改当前章")).toEqual({
      command: "permissions",
      argument: "可改当前章"
    });
  });

  it("命令名大小写不敏感（面板里手打 MODEL 也该认）", () => {
    expect(parseSlashInput("/MODEL")).toEqual({ command: "model", argument: "" });
  });

  it("没有前导斜杠、只有斜杠、未知命令：一律 command=null，绝不猜", () => {
    expect(parseSlashInput("resume")).toEqual({ command: null, argument: "" });
    expect(parseSlashInput("/")).toEqual({ command: null, argument: "" });
    expect(parseSlashInput("/compact")).toEqual({ command: null, argument: "" });
    expect(parseSlashInput("/usage 现在不要有")).toEqual({ command: null, argument: "" });
  });

  it("未列出的命令（/usage /export /fork /new /compact /outline /characters）永远解析不出命令", () => {
    for (const text of ["/usage", "/export", "/fork", "/new", "/compact", "/outline", "/characters"]) {
      expect(parseSlashInput(text).command).toBeNull();
    }
  });
});

describe("slash-commands · 面板列表过滤与自处理的键", () => {
  it("空输入给全部可用命令", () => {
    expect(filterCommands("", NO_GATE)).toEqual(availableCommands(NO_GATE));
  });

  it("前缀过滤发生在可用集合上：/s 只剩 status（stage 已被波 1 闸门滤掉）", () => {
    expect(filterCommands("/s", NO_GATE)).toEqual(["status"]);
    expect(filterCommands("s", NO_GATE)).toEqual(["status"]);
    expect(filterCommands("/sta", NO_GATE)).toEqual([]);
  });

  it("被闸门滤掉 / 运行期不可用的命令，输入什么前缀都不会冒出来", () => {
    expect(filterCommands("/st", { hasBook: true, turnRunning: true })).toEqual(["status"]);
    expect(filterCommands("/re", { hasBook: false, turnRunning: false })).toEqual([]);
    expect(filterCommands("/stage", NO_GATE)).toEqual([]);
  });

  it("↑↓ / Enter / Esc 由面板自己吃；输入法合成期间一个都不接（M4 的同一口径）", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape"]) {
      expect(paletteOwnsKey(key, false)).toBe(true);
      expect(paletteOwnsKey(key, true)).toBe(false);
    }
    expect(paletteOwnsKey("a", false)).toBe(false);
  });
});
```

> `filterCommands("/st", { hasBook: true, turnRunning: true })` 这一条同时验两件事：过滤是在 `availableCommands` 的结果上做（不是全集），以及 `stage` 在整个波 1 都进不了面板。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/slash-commands.test.ts --maxWorkers=4`
Expected: FAIL —— `Failed to load url ./slash-commands (resolved id: ./slash-commands) in apps/desktop/src/renderer/src/utils/slash-commands.test.ts. Does the file exist?`

- [x] **Step 2：`slash-commands.ts` 落地**

Create `apps/desktop/src/renderer/src/utils/slash-commands.ts`：

```ts
/**
 * `/` 命令面板的判定层（spec §6）：命令表、运行期可用性、输入解析、面板自己吃的键。
 * SlashPalette.vue 只画这张表并把选中的命令交出去，本文件以外不允许判断「这条命令现在能不能用」。
 */
export const SLASH_COMMANDS = [
  "model",
  "permissions",
  "status",
  "stage",
  "resume",
  "clear"
] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

export interface PaletteFocus {
  hasBook: boolean;
  turnRunning: boolean;
}

/** 穷尽表（铁律 6）：加成员不写说明就编译不过。说明里不重抄权限档名，档位文案的唯一来源仍是 PERMISSION_LABELS。 */
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string> = {
  model: "打开模型设置：baseURL、模型名与密钥",
  permissions: "打开权限档选择器（当前档显示在中栏头部）",
  status: "把这条线程的现状写进状态条",
  stage: "切换创作阶段（要连同智能体档案一起切，波 2 接通）",
  resume: "重新读取这条线程的历史",
  clear: "只清空本页显示，不动盘上的会话历史"
};

/**
 * 波 1 里按下去还没有通路可走的命令：`stage` 的切阶段要连档案一起切（spec §6 的 profilesReady 缘由），
 * 档案是波 2 的产物。波 2 的 Task 18 删掉这一行、改由 PaletteFocus.profilesReady 驱动。
 * 枚举与说明表仍含 stage——被列出来却只会报错的命令才禁止，被滤掉不列出来是合规的。
 */
const GATED_COMMANDS: readonly SlashCommand[] = ["stage"];

/** turn 运行中仍可用的命令（换上下文/重建视图的那几条会和进行中的一轮抢状态）。 */
const DURING_TURN_COMMANDS: readonly SlashCommand[] = ["model", "permissions", "status", "clear"];

export function availableCommands(focus: PaletteFocus): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => {
    if (GATED_COMMANDS.includes(command)) return false;
    if (command === "resume" && !focus.hasBook) return false;
    if (focus.turnRunning) return DURING_TURN_COMMANDS.includes(command);
    return true;
  });
}

export function parseSlashInput(text: string): { command: SlashCommand | null; argument: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { command: null, argument: "" };
  const body = trimmed.slice(1).trim();
  if (body === "") return { command: null, argument: "" };
  const [head = "", ...rest] = body.split(/\s+/);
  const matched = SLASH_COMMANDS.find((command) => command === head.toLowerCase());
  return { command: matched ?? null, argument: rest.join(" ").trim() };
}

/** 面板列表：过滤发生在 availableCommands 的结果上，输入里的前缀既认 "sta" 也认 "/sta"。 */
export function filterCommands(text: string, focus: PaletteFocus): SlashCommand[] {
  const pool = availableCommands(focus);
  const typed = text.trim().replace(/^\//, "").trim().toLowerCase();
  if (typed === "") return pool;
  const [head = ""] = typed.split(/\s+/);
  return pool.filter((command) => command.startsWith(head));
}

/** 面板自处理这四个键（spec §5 护栏 5）；合成期间一律不接，与 utils/hotkeys.ts 的闸门同口径。 */
export function paletteOwnsKey(key: string, isComposing: boolean): boolean {
  if (isComposing) return false;
  return key === "ArrowUp" || key === "ArrowDown" || key === "Enter" || key === "Escape";
}
```

- [x] **Step 3：纯函数跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/slash-commands.test.ts --maxWorkers=4`
Expected: PASS（13 用例、4 个 describe；`/s`、`/sta`、`/st` 三条前缀断言此时应全部绿）。

- [x] **Step 4：store 侧的状态报告与派发口（先写红）**

`apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`：先把 `:115` 那行内联的 `saveMeta: vi.fn(...)` 提成模块级常量（照 `:91-100` 的 `startTurn` / `interruptTurn` 现例），因为本任务与 Task 9 的用例都要查它的调用次数。**参数必须写上类型**（测试文件也在 `tsconfig.web.json` 的 tsc 范围内，无参 `vi.fn` 的 `mock.calls[0]?.[0]` 会报元组越界）：

```ts
const saveMeta = vi.fn(async (_meta: BookMeta): Promise<void> => undefined);
```

夹具里那行改成 `saveMeta,`；`:4-15` 的 type import 补 `BookMeta`。再把 import（`:16`）补成：

```ts
import {
  CLEAR_VIEW_SENTENCE,
  composeStatusReport,
  composeStatusLine,
  newThread,
  threadKeyFor,
  UNBOUND,
  useAgentStore
} from "./useAgentStore";
```

（该文件 `:19-20` 已有 `const CH = "chapters/01-a.md"` 与 `const OTHER = "chapters/02-b.md"`，本任务一律用这两个常量，不新造路径。）

追加用例（放进既有的 `describe("useAgentStore")`；`sessionResult` / `loaded` / `loadSession` / `eventOf` / `proposal` / `push` / `store()` / `openChapter` 都是 Task 4/5 已建的助手）：

```ts
  it("/clear 只清渲染层：视图空、hydrated 置真、其它线程不动、也不再被自动水合倒回来", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("user-message", { id: "e-a", text: "改紧" })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { id: "e-b", text: "好", interrupted: false })
    });
    push({
      type: "event",
      turnId: "t9",
      threadKey: OTHER,
      event: eventOf("user-message", { id: "e-other", text: "别动" })
    });
    expect(store().viewOf(CH).items.length).toBe(2);
    expect(store().viewOf(CH).hydrated).toBe(false);
    loadSession.mockClear();

    store().runSlashCommand("clear", "");

    expect(store().viewOf(CH).items.length).toBe(0);
    expect(store().viewOf(CH).hydrated).toBe(true);
    expect(store().notice).toBe(CLEAR_VIEW_SENTENCE);
    expect(store().viewOf(OTHER).items.length).toBe(1);
    // hydrated 置真的意义：Task 5 的三处时机不会把刚清空的内容倒回来
    await store().ensureHydrated(CH);
    expect(loadSession).not.toHaveBeenCalled();
    expect(store().viewOf(CH).items.length).toBe(0);
  });

  it("/clear 有 pending 卡时必须把代价说清楚，并把卡一起从页面上摘掉", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { id: "e-p", proposal: proposal("p-clear") })
    });
    expect(store().pendingOf(CH)).toBe(1);

    store().runSlashCommand("clear", "");

    expect(store().pendingOf(CH)).toBe(0);
    expect(store().notice).toBe(
      `${CLEAR_VIEW_SENTENCE} 本页还有 1 条待审批提案，清空后这一轮里点不到它们；重启后会以「上次会话未处理」回来。`
    );
  });

  it("排队指令不属于显示内容：/clear 不动 queued", async () => {
    await openChapter();
    expect(store().queueText(CH, "第二条")).toBe(true);
    store().runSlashCommand("clear", "");
    expect(store().viewOf(CH).queued).toEqual(["第二条"]);
  });

  it("/status 写状态条的是整句报告，未回放与已回放两种口径分开", () => {
    const replayed = newThread();
    replayed.hydrated = true;
    replayed.items = [
      eventOf("user-message", { id: "e-a", text: "改紧" }),
      eventOf("message", { id: "e-b", text: "好", interrupted: false })
    ];
    expect(
      composeStatusReport({
        threadKey: CH,
        thread: replayed,
        cards: 2,
        pending: 1,
        permissionLabel: "只读参考",
        stageName: "正文"
      })
    ).toBe(
      `状态 · 线程 ${CH} · 历史已回放（2 条） · 提案 2 张（待审 1 张） · 排队 0 条 · 权限档：只读参考 · 阶段：正文 · 尚无收尾记录`
    );

    expect(
      composeStatusReport({
        threadKey: UNBOUND,
        thread: undefined,
        cards: 0,
        pending: 0,
        permissionLabel: "只读参考",
        stageName: "无"
      })
    ).toBe(
      "状态 · 线程 未绑定文稿 · 历史未回放（本页 0 条） · 提案 0 张（待审 0 张） · 排队 0 条 · 权限档：只读参考 · 阶段：无 · 还没有这一条线程"
    );

    const interrupted = newThread();
    interrupted.endedAs = "interrupted";
    expect(
      composeStatusReport({
        threadKey: CH,
        thread: interrupted,
        cards: 0,
        pending: 0,
        permissionLabel: "可改当前章",
        stageName: "正文"
      })
    ).toContain("上一轮已打断，可继续");
  });

  it("/status 走的是当前线程与 book.meta 的真实数字", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { id: "e-p2", proposal: proposal("p-status") })
    });
    store().runSlashCommand("status", "");
    // 夹具的 meta：permissionMode 是 chapter-write、阶段 draft=正文（:24-32）
    expect(store().notice).toBe(
      `状态 · 线程 ${CH} · 历史未回放（本页 1 条） · 提案 1 张（待审 1 张） · 排队 0 条 · 权限档：可改当前章 · 阶段：正文 · 尚无收尾记录`
    );
  });

  it("/resume 走 ensureHydrated，/model 走 layout.showSettings（面板不自己实现任何事）", async () => {
    await openChapter();
    loadSession.mockClear();
    store().runSlashCommand("resume", "");
    expect(loadSession).toHaveBeenCalledTimes(1);
    store().runSlashCommand("model", "");
    expect(useLayoutStore().currentView).toBe("settings");
    expect(useLayoutStore().settingsInitialCategory).toBe("general");
  });

  it("/permissions 只把档位菜单连同预选档位名一起打开，不写盘也不改 meta", async () => {
    const bookStore = useBookStore();
    await bookStore.openBook("/book");
    saveMeta.mockClear();
    store().runSlashCommand("permissions", "可改当前章");
    expect(bookStore.permissionMenuOpen).toBe(true);
    expect(bookStore.permissionPreset).toBe("可改当前章");
    expect(saveMeta).not.toHaveBeenCalled();
    store().runSlashCommand("permissions", "");
    expect(bookStore.permissionPreset).toBe("");
    bookStore.closePermissionMenu();
    expect(bookStore.permissionMenuOpen).toBe(false);
  });

  it("绕过面板直接叫 stage：给一句实话，不假装切了", () => {
    store().runSlashCommand("stage", "正文");
    expect(store().notice).toBe("切换创作阶段要连同智能体档案一起切，这一条通路在波 2 接通。");
  });
```

并在该文件 import 处补 layout store：

```ts
import { useLayoutStore } from "./layoutStore";
```

> 三条要在意的既成事实（别改夹具去迁就测试）：
> - `eventOf(type, rest)` 的默认 id 是 `e-${type}`（`:64-72`），所以同类型事件必须像上面那样显式给 `id`，否则 Task 5 规则 4 的去重会把它们当成同一条。
> - `push()` 收的是 `AgentOutbound`（`:130-132`），事件要裹一层 `{ type: "event", turnId, threadKey, event }`。
> - `proposal(id, overrides)` 的第一参是 id（`:46`），默认 `threadKey: CH`。
> - `ensureHydrated` 里 `window.mochen.loadSession(...)` 在第一个 `await` 之前就被求值（Task 5 的 `runHydrate`），所以 `/resume` 那条不需要 `await Promise.resolve()` 就能数到调用。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: FAIL —— `composeStatusReport is not a function` / `store().runSlashCommand is not a function`（TypeError 点名缺的导出）。

- [x] **Step 5：store 侧落地**

`apps/desktop/src/renderer/src/stores/useAgentStore.ts`：

1) `:48` 的 `function newThread(): ThreadView {` 改成 `export function newThread(): ThreadView {`（状态报告测试要拿干净线程）。
2) import 段（`:2-18`）：`@mochen/contracts` 那条里补两个值成员（原有成员保持不动，`TurnEndStatus` 已在 `:16` 以 type 形式导入，够用），并新增一行 type import 与一行 layout store（`./useBookStore` 在 `:18` 已导入，别重复写）：

```ts
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  // …原有成员保持不动
} from "@mochen/contracts";
import type { SlashCommand } from "../utils/slash-commands";
import { useLayoutStore } from "./layoutStore";
```

3) 模块顶层（紧跟 `composeStatusLine`，`:131` 之后）加：

```ts
/** `/clear` 的确认文案（spec §6 定稿整句）：真实的边界就是「只动渲染层」，一个字都不许夸张。 */
export const CLEAR_VIEW_SENTENCE = "这只清空本页显示；盘上的会话历史不动，重启后仍会完整回放。";

/** 收尾态文案表：`Record<TurnEndStatus, string>` 是编译期闸，加状态不写文案就过不了 tsc（铁律 6）。 */
const END_STATE_LINES: Record<TurnEndStatus, string> = {
  done: "上一轮已完成",
  interrupted: "上一轮已打断，可继续",
  failed: "上一轮失败，可继续"
};

/** 空串是「这一条线程还没收场过」，不是 TurnEndStatus 的成员，所以单独一档，不塞进表里当第四键。 */
function endStateLine(endedAs: "" | TurnEndStatus): string {
  if (endedAs === "") return "尚无收尾记录";
  return END_STATE_LINES[endedAs];
}

export interface StatusFacts {
  threadKey: string;
  thread: ThreadView | undefined;
  cards: number;
  pending: number;
  permissionLabel: string;
  stageName: string;
}

/** `/status` 的报告：纯函数，好测也好核对；「已回放」与「未回放」必须分开说，否则用户以为看到的是全部历史。 */
export function composeStatusReport(facts: StatusFacts): string {
  const { thread } = facts;
  const events = thread?.items.length ?? 0;
  const replay =
    thread?.hydrating === true
      ? "历史正在回放"
      : thread?.hydrated === true
        ? `历史已回放（${events} 条）`
        : `历史未回放（本页 ${events} 条）`;
  const ended = thread === undefined ? "还没有这一条线程" : endStateLine(thread.endedAs);
  const label = facts.threadKey === UNBOUND ? "未绑定文稿" : facts.threadKey;
  const parts = [
    `线程 ${label}`,
    replay,
    `提案 ${facts.cards} 张（待审 ${facts.pending} 张）`,
    `排队 ${thread?.queued.length ?? 0} 条`,
    `权限档：${facts.permissionLabel}`,
    `阶段：${facts.stageName}`,
    ended
  ];
  return `状态 · ${parts.join(" · ")}`;
}
```

4) actions 里（`tick()` 之前，`:348` 一带）加两个 action：

```ts
    /**
     * `/` 面板唯一派发口（spec §6）：命令落在哪个 store 动作上，只在这里决定一次。
     * 面板组件、快捷键接线都不允许再各写一份 switch。
     */
    runSlashCommand(command: SlashCommand, argument: string): void {
      const book = useBookStore();
      const threadKey = threadKeyFor(book.activeDocTab);
      switch (command) {
        case "model":
          // 与 Ctrl+, 同一条通路（Task 7）：模型设置的唯一真身仍是 ProviderSettings 浮层。
          useLayoutStore().showSettings("general");
          return;
        case "permissions":
          // 波 1：带档位名只作为预选传给菜单（菜单真身 Task 9），不在这里写盘。
          book.openPermissionMenu(argument);
          return;
        case "status": {
          this.notice = composeStatusReport({
            threadKey,
            thread: this.threads[threadKey],
            cards: Object.values(this.proposals).filter(
              (view) => view.proposal.threadKey === threadKey
            ).length,
            pending: this.pendingOf(threadKey),
            permissionLabel: PERMISSION_LABELS[book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE],
            stageName:
              book.meta?.stages.find((stage) => stage.id === book.meta?.activeStage)?.name ?? "无"
          });
          return;
        }
        case "resume":
          void this.ensureHydrated(threadKey);
          return;
        case "clear":
          this.clearThreadView(threadKey);
          return;
        case "stage":
          // availableCommands 已在波 1 把它滤掉；走到这里只可能是有人绕过面板直接调用，给实话而不是假装成功。
          this.notice = "切换创作阶段要连同智能体档案一起切，这一条通路在波 2 接通。";
          return;
      }
    },

    /**
     * `/clear` 的真实边界（spec §6）：只清渲染层视图——不动 JSONL、不动主进程 pending、不生成 boundary 事件。
     * `hydrated` 置真 ⇒ Task 5 的三处自动水合时机不会把刚清掉的内容立刻倒回来；
     * 恢复办法就是确认文案里那句「重启后仍会完整回放」。
     * `queued` 不清：那是用户还没发出去的指令，不是显示内容。
     */
    clearThreadView(threadKey: string): void {
      const thread = this.viewOf(threadKey);
      const pendingCards = Object.values(this.proposals).filter(
        (view) => view.proposal.threadKey === threadKey && view.status === "pending"
      ).length;
      thread.items = [];
      thread.streaming = { ...EMPTY_STREAM };
      thread.lastError = "";
      thread.endedAs = "";
      thread.hydrated = true;
      for (const id of Object.keys(this.proposals)) {
        if (this.proposals[id]?.proposal.threadKey === threadKey) delete this.proposals[id];
      }
      this.notice =
        pendingCards === 0
          ? CLEAR_VIEW_SENTENCE
          : `${CLEAR_VIEW_SENTENCE} 本页还有 ${pendingCards} 条待审批提案，清空后这一轮里点不到它们；重启后会以「上次会话未处理」回来。`;
    },
```

5) `apps/desktop/src/renderer/src/stores/useBookStore.ts`：state（`:19-38`，紧跟 `rightPaneMode` 之后）加两格，actions 加两个：

```ts
    /** 权限档菜单是否展开；`/permissions` 与头部按钮共用的唯一开关。 */
    permissionMenuOpen: false,
    /** 从 `/permissions <档位名>` 带进来的预选文案，菜单消费；空串表示没有预选。 */
    permissionPreset: "",
```

```ts
    openPermissionMenu(preset = ""): void {
      this.permissionPreset = preset;
      this.permissionMenuOpen = true;
    },

    closePermissionMenu(): void {
      this.permissionMenuOpen = false;
      this.permissionPreset = "";
    },
```

`useBookStore.test.ts` 追加：

```ts
  it("档位菜单开关只搬标志位，不碰 meta 也不写盘", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    store.openPermissionMenu("全开");
    expect(store.permissionMenuOpen).toBe(true);
    expect(store.permissionPreset).toBe("全开");
    store.closePermissionMenu();
    expect(store.permissionMenuOpen).toBe(false);
    expect(store.permissionPreset).toBe("");
    expect(saveMeta).not.toHaveBeenCalled();
  });
```

（该文件的 `saveMeta` 夹具在 `:44` 是内联 `vi.fn`，本用例要先把它提成模块级 `const saveMeta = vi.fn(async () => {});` 再在夹具里引用——照 `:33` 的 `pickBookDirectory` 现例。）

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: PASS。

- [x] **Step 6：`SlashPalette.vue`（面板内部键自处理，`stopPropagation`）**

Create `apps/desktop/src/renderer/src/components/SlashPalette.vue`：

```vue
<!-- / 命令面板：↑↓ 选择、Enter 执行、Esc 关闭。四个键在组件内吃掉并 stopPropagation
     （spec §5 护栏 5）——全局 keydown 因此拿不到面板的 Esc，resolveEscape 不加第四优先级。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import {
  SLASH_COMMAND_DESCRIPTIONS,
  filterCommands,
  parseSlashInput,
  paletteOwnsKey,
  type SlashCommand
} from "../utils/slash-commands";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const emit = defineEmits<{ close: [] }>();

const agent = useAgentStore();
const book = useBookStore();
const typed = ref("/");
const cursor = ref(0);
const box = ref<HTMLInputElement | null>(null);

const candidates = computed<SlashCommand[]>(() =>
  filterCommands(typed.value, {
    hasBook: book.rootPath !== null,
    turnRunning: agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false
  })
);
const parsed = computed(() => parseSlashInput(typed.value));

function argumentFor(command: SlashCommand): string {
  return parsed.value.command === command ? parsed.value.argument : "";
}

function move(delta: number): void {
  const total = candidates.value.length;
  if (total === 0) return;
  cursor.value = (cursor.value + delta + total) % total;
}

function run(): void {
  const command = candidates.value[cursor.value];
  if (!command) return;
  agent.runSlashCommand(command, argumentFor(command));
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (!paletteOwnsKey(event.key, event.isComposing === true)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowDown") move(1);
  if (event.key === "ArrowUp") move(-1);
  if (event.key === "Enter") run();
  if (event.key === "Escape") emit("close");
}

// 光标越界（过滤后列表变短）时收回最后一行：唯一的越界处理，写在 computed 里避免副作用。
const shownCursor = computed(() =>
  candidates.value.length === 0 ? 0 : Math.min(cursor.value, candidates.value.length - 1)
);

onMounted(() => {
  void nextTick(() => box.value?.focus());
});
</script>

<template>
  <div class="slash-mask" @click.self="emit('close')">
    <div
      class="slash-palette"
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      @keydown="onKeydown"
    >
      <input
        ref="box"
        v-model="typed"
        class="slash-input"
        type="text"
        spellcheck="false"
        placeholder="/ 命令（↑↓ 选择，Enter 执行，Esc 关闭）"
        @input="cursor = 0"
      />
      <ul v-if="candidates.length" class="slash-list" role="listbox" aria-label="可用命令">
        <li
          v-for="(command, index) in candidates"
          :key="command"
          :class="['slash-row', { 'is-cursor': index === shownCursor }]"
          role="option"
          :aria-selected="index === shownCursor"
          @mouseenter="cursor = index"
          @click="run"
        >
          <code class="slash-name">/{{ command }}</code>
          <span class="slash-desc">{{ SLASH_COMMAND_DESCRIPTIONS[command] }}</span>
        </li>
      </ul>
      <p v-else class="slash-empty">没有匹配的命令——这一步还没接通的通路不会列出来。</p>
    </div>
  </div>
</template>
```

> 组件里没有任何「能不能用 / 这条命令做什么」的判断：全部走 `utils/slash-commands.ts` 与 `agent.runSlashCommand`。`shownCursor` 只是将已有 `cursor` 夹进当前列表长度，不引入新语义。

- [x] **Step 7：`styles/interaction.css` 与挂载**

Create `apps/desktop/src/renderer/src/styles/interaction.css`：

```css
/* 本项目自有样式（波 1）：命令面板、权限档菜单，以及波 1 各任务新引用的中栏元素。
   强调色一律走 --focus（见 styles/agent-pane.css:2-3 的告警：--accent 系并未在 :root 定义）。 */

.slash-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding-top: 14vh;
  background: color-mix(in srgb, #000 28%, transparent);
  backdrop-filter: blur(2px);
}

.slash-palette {
  width: min(520px, 92vw);
  align-self: flex-start;
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  background: color-mix(in srgb, var(--editor) 92%, transparent);
  backdrop-filter: blur(18px) saturate(120%);
  box-shadow: 0 14px 42px var(--shadow-color);
  overflow: hidden;
}

.slash-input {
  width: 100%;
  padding: 11px 14px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  color: var(--text);
  font-size: 14px;
}

.slash-input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.slash-list {
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 280px;
  overflow-y: auto;
}

.slash-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: 9px;
  cursor: pointer;
}

.slash-row.is-cursor {
  background: var(--selected);
}

.slash-name {
  flex: 0 0 auto;
  font-family: var(--code-font);
  font-size: 12px;
  color: var(--text);
}

.slash-desc {
  color: var(--text-soft);
  font-size: 12px;
}

.slash-empty {
  margin: 0;
  padding: 12px 14px;
  color: var(--text-soft);
  font-size: 12px;
}

/* Task 9：权限档 popover */
.permission-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 200px;
  padding: 6px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: color-mix(in srgb, var(--editor) 94%, transparent);
  backdrop-filter: blur(14px) saturate(118%);
  box-shadow: 0 12px 34px var(--shadow-color);
}

.permission-menu-actions {
  position: relative;
  display: inline-flex;
}

.permission-option {
  display: flex;
  width: 100%;
  gap: 8px;
  align-items: center;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.permission-option:hover {
  background: var(--hover);
}

.permission-option.is-current {
  background: var(--selected);
  font-weight: 600;
}

.permission-option.is-preset {
  outline: 1px solid var(--focus);
  outline-offset: -2px;
}

.permission-hint {
  margin: 6px 9px 2px;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 1.5;
}

.permission-chip.is-button {
  cursor: pointer;
}

.permission-chip.is-button:hover {
  background: var(--hover);
}

/* Task 5 的模板引用这些类（样式随本任务落地，中间一提交只有裸文本、不影响门禁与判读） */
.hydrating-line {
  color: var(--text-soft);
  font-size: 13px;
}

.expired-stack {
  margin-top: 4px;
}

.expired-summary {
  cursor: pointer;
  color: var(--warning);
  font-size: 12px;
}

.expired-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
}

.proposal-card.is-expired {
  border-style: dashed;
  opacity: 0.86;
}

.expired-note {
  margin: 0 0 8px;
  color: var(--text-soft);
  font-size: 12px;
}

.status-note-agent {
  color: var(--warning);
}
```

`apps/desktop/src/renderer/src/styles.css` 第 7 行之后加：

```css
@import "./styles/interaction.css";
```

`CenterColumn.vue`：script 的 import 段加 `import SlashPalette from "./SlashPalette.vue";`；template 里 `<ProviderSettings v-if="showSettings" @close="closeSettings" />`（Task 7 已把 `@close` 改掉）之后加：

```html
    <SlashPalette v-if="paletteOpen" @close="paletteOpen = false" />
```

- [x] **Step 8：跑到绿 + 行数预算自查**

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。
Run: `corepack pnpm prettier --write apps/desktop/src/renderer && corepack pnpm vitest run apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: PASS。
Run: `node tools/check-source-line-budget.mjs` + `wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/SlashPalette.vue`
Expected: 「行数预算通过」；`SlashPalette.vue` ≤140 行；`CenterColumn.vue` ≤360（波 1 末 ≤400）。

- [x] **Step 9：连带清单**

- `runSlashCommand` 唯一消费方是 `SlashPalette.vue`；`/model` 与 `Ctrl+,` 共用 `layout.showSettings("general")` ⇒ **两处都靠 Task 7 的 CenterColumn `currentView` 桥才真的显示浮层**（`App.vue` 目前不渲染 settings 视图）。若波 2 给 `App.vue` 加独立设置视图，改桥不改本 action。
- `clearThreadView` 读 `ThreadView.hydrated`（Task 4）、写 `this.proposals`（`:136`）；删卡后到达的 `decision` / `written` 事件靠既有守卫（`:253-254` `if (!view) return`）静默吸收，不会崩——这一条要跑一遍确认没新增 try。
- `/status` 的可见位置是状态条的 agent notice（Task 5 已把 `agent.notice` 显示出来，`CenterColumn.vue` 的 `.agent-statusbar`）；`notice` 单行渲染，所以报告用「 · 」分隔而不是换行。
- `styles/interaction.css` 是波 1 新增控件样式的集中处；Task 5/7 的模板先引用了这里的类名（`.hydrating-line` / `.expired-*` / `.status-note-agent`），落地顺序造成的只有裸文本、无颜色——不影响门禁与冒烟判读，记进台账即可。
- `GATED_COMMANDS` 是给波 2 的一处显式债务：**波 2 的 Task 18 必须删掉它并把 `profilesReady` 加进 `PaletteFocus`**（同任务改 `slash-commands.test.ts` 的三条可用性断言）。跨波接口，Task 18 动手前先 `grep -n "GATED_COMMANDS" apps/desktop/src/renderer/src/utils/slash-commands.ts` 确认它还在。

- [x] **Step 10：提交**

```bash
git add apps/desktop/src/renderer/src/utils/slash-commands.ts apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/components/SlashPalette.vue apps/desktop/src/renderer/src/styles/interaction.css apps/desktop/src/renderer/src/styles.css apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts
git commit -m "feat(renderer): / 命令面板与派发口，clear 只清渲染层视图"
```

---

### Task 9：权限档切换 UI + 模式文案下沉（变异 M12）

> 口径（spec §7 的四条落地）：
> 1. 头部 `permission-chip` 从 `<span>` 变 `<button>`，弹层是 `PermissionMenu.vue`；档位文案**只**读 `PERMISSION_LABELS`，默认档只读 `DEFAULT_PERMISSION_MODE`（组件里不出现第二份中文档名）。
> 2. `setPermissionMode` 是渲染层**第一次**接 `saveMeta`（现仓证据：`book-service.ts:60-67` 写盘后刷新快照，渲染层零调用）。切档后本地 `meta` 也要跟着改，否则头部标签不动。
> 3. `PermissionMenu.vue` 必须把 spec §7 点名的两句话显示出来（拒绝后不复活 / 仍留 pending 可批准），否则「切档后再批准」这个缺口只是换了个地方藏着。
> 4. `PROPOSAL_MODE_LABELS` 下沉到 `packages/contracts/src/patch.ts`，`ProposalCard.vue` 的三元链删除。

**Files:**

- Create: `apps/desktop/src/renderer/src/components/PermissionMenu.vue`
- Modify: `packages/contracts/src/patch.ts`（`:53` 的 `PROPOSAL_STATUS_LABELS` 闭合之后加 `PROPOSAL_MODE_LABELS`）
- Modify: `packages/contracts/test/contract.test.ts`（`:59` 之后加一个 `describe`；`PATCH_MODES` / `PROPOSAL_MODE_LABELS` / `PERMISSION_LABELS` 走 `../src/index.js`）
- Modify: `apps/desktop/src/renderer/src/utils/slash-commands.ts`（文件末尾加 `matchPermissionMode`，Task 8 的六条判定一字不动）
- Modify: `apps/desktop/src/renderer/src/utils/slash-commands.test.ts`（追加 `describe`）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（`runSlashCommand` 的 `permissions` 分支补「带档位名 ⇒ 查表 + 一句中文」）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（actions 加 `setPermissionMode`）
- Modify: `apps/desktop/src/renderer/src/components/ProposalCard.vue`（HEAD 版 `:18-20` 的三元链）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue`（HEAD 版 `:135` 的 `<span class="permission-chip">`；行号随 Task 5/7 下移，按内容定位）
- Test: `packages/contracts/test/contract.test.ts`、`apps/desktop/src/renderer/src/stores/useBookStore.test.ts`、`apps/desktop/src/renderer/src/utils/slash-commands.test.ts`

**Interfaces:**

- Consumes: `PERMISSION_MODES` / `PERMISSION_LABELS` / `DEFAULT_PERMISSION_MODE` / `PermissionMode`（`packages/contracts/src/permission.ts:1-9`，经 barrel 导出）、`window.mochen.saveMeta`（`contracts/src/ipc.ts:40`）、Task 8 的 `useBookStore.openPermissionMenu/closePermissionMenu` 与 `permissionPreset`、`PatchMode` / `PATCH_MODES`（`patch.ts:13-14`）
- Produces:
  ```ts
  // packages/contracts/src/patch.ts
  export const PROPOSAL_MODE_LABELS: Record<PatchMode, string>;
  // apps/desktop/src/renderer/src/stores/useBookStore.ts
  setPermissionMode(mode: PermissionMode): Promise<void>;
  // apps/desktop/src/renderer/src/utils/slash-commands.ts
  export function matchPermissionMode(text: string): PermissionMode | null;
  ```

- [x] **Step 1：契约侧先写红**

`packages/contracts/test/contract.test.ts` 在 `:59` 的 `describe` 之后追加：

```ts
describe("权限档与提案模式的文案表（铁律 6：一张表，穷尽键）", () => {
  it("PERMISSION_LABELS 的键与 PERMISSION_MODES 完全一致，中文逐字钉死", () => {
    expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...PERMISSION_MODES].sort());
    expect(PERMISSION_LABELS["read-only"]).toBe("只读参考");
    expect(PERMISSION_LABELS["chapter-write"]).toBe("可改当前章");
    expect(PERMISSION_LABELS["full-access"]).toBe("全开");
  });

  it("PROPOSAL_MODE_LABELS 覆盖 PATCH_MODES，中文逐字钉死", () => {
    expect(Object.keys(PROPOSAL_MODE_LABELS).sort()).toEqual([...PATCH_MODES].sort());
    expect(PROPOSAL_MODE_LABELS["anchor-replace"]).toBe("锚点替换");
    expect(PROPOSAL_MODE_LABELS["doc-overwrite"]).toBe("整篇替换");
  });

  it("提案状态表含 expired，中文是「上次会话未处理」", () => {
    expect(PROPOSAL_STATUSES).toContain("expired");
    expect(PROPOSAL_STATUS_LABELS.expired).toBe("上次会话未处理");
  });
});
```

并把该文件顶部 import（`:2-7`）补成：

```ts
import {
  DEFAULT_PERMISSION_MODE,
  PATCH_MODES,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  PROPOSAL_MODE_LABELS,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
  bookMetaSchema,
  parseBookMeta
} from "../src/index.js";
```

Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4`
Expected: FAIL —— `PROPOSAL_MODE_LABELS is not a function` 之类不成立；实际红形是 `SyntaxError: ... does not provide an export named 'PROPOSAL_MODE_LABELS'`。

- [x] **Step 2：`patch.ts` 落地**

`packages/contracts/src/patch.ts` 在 `PROPOSAL_STATUS_LABELS`（`:46-53`）之后加：

```ts
/** 提案模式的文案表：与 PERMISSION_LABELS 同一手法，`Record<PatchMode, string>` 让加模式不写文案直接编译不过。 */
export const PROPOSAL_MODE_LABELS: Record<PatchMode, string> = {
  "anchor-replace": "锚点替换",
  "doc-overwrite": "整篇替换"
};
```

Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4`
Expected: PASS。
Run: `corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json`
Expected: 无诊断。

- [x] **Step 3：`ProposalCard.vue` 删三元链**

`apps/desktop/src/renderer/src/components/ProposalCard.vue`：`modeLabel`（HEAD 版 `:18-20`）改成查表，并把 `:4` 的 import 补上 `PROPOSAL_MODE_LABELS`：

```ts
const modeLabel = computed(() => PROPOSAL_MODE_LABELS[props.view.proposal.mode]);
```

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。

- [x] **Step 4：`setPermissionMode` 先写红**

`apps/desktop/src/renderer/src/stores/useBookStore.test.ts` 追加（沿用文件里的 `result` 夹具与 `saveMeta` 夹具；Step 已经把它提成模块级 `const saveMeta = vi.fn(async () => {});`）：

```ts
  it("切档成功：写盘、刷新本地 meta，并把生效范围说清楚", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockClear();
    await store.setPermissionMode("chapter-write");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0]?.[0]).toEqual({ ...result.meta, permissionMode: "chapter-write" });
    expect(store.meta?.permissionMode).toBe("chapter-write");
    expect(store.notice).toBe("权限档已切到「可改当前章」，下一次审批就用这一档判断。");
  });

  it("同档重复点：不写盘，给一句实话", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockClear();
    await store.setPermissionMode("read-only");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.notice).toBe("已经是这一档了：「只读参考」。");
  });

  it("没开书时切档：既不写盘也不假装成功", async () => {
    const store = useBookStore();
    saveMeta.mockClear();
    await store.setPermissionMode("full-access");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.meta).toBeNull();
    expect(store.notice).toBe("还没打开作品目录，权限档改不了。");
  });

  it("主进程拒绝（例如 book.json 被占用）：中文原因原样可见，本地档位保持不变", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockRejectedValueOnce(new Error("无法写入 book.json：文件正被占用"));
    await store.setPermissionMode("full-access");
    expect(store.meta?.permissionMode).toBe("read-only");
    expect(store.notice).toBe("权限档没改过来：无法写入 book.json：文件正被占用");
  });
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: FAIL —— `store.setPermissionMode is not a function`。

- [x] **Step 5：`useBookStore.setPermissionMode` 落地**

`apps/desktop/src/renderer/src/stores/useBookStore.ts`：`:2` 的 type-only import 改成同时取值：

```ts
import {
  PERMISSION_LABELS,
  type BookMeta,
  type DocRef,
  type PermissionMode
} from "@mochen/contracts";
```

actions 里（`openPermissionMenu` 之后）加：

```ts
    /**
     * 切权限档：渲染层唯一的 saveMeta 调用方（主进程写盘后会刷新快照，档位当场生效）。
     * 本地 meta 必须一起改，否则头部标签还停在旧档；失败时一个字都不改，原因进 notice。
     */
    async setPermissionMode(mode: PermissionMode): Promise<void> {
      if (!this.meta) {
        this.notice = "还没打开作品目录，权限档改不了。";
        return;
      }
      if (this.meta.permissionMode === mode) {
        this.notice = `已经是这一档了：「${PERMISSION_LABELS[mode]}」。`;
        return;
      }
      const next: BookMeta = { ...this.meta, permissionMode: mode };
      try {
        await window.mochen.saveMeta(next);
      } catch (err) {
        const reason = err instanceof Error && err.message !== "" ? err.message : String(err);
        this.notice = `权限档没改过来：${reason}`;
        return;
      }
      this.meta = next;
      this.notice = `权限档已切到「${PERMISSION_LABELS[mode]}」，下一次审批就用这一档判断。`;
      this.closePermissionMenu();
    },
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: PASS。

- [x] **Step 6：`PermissionMenu.vue`（只画表，不判断）**

Create `apps/desktop/src/renderer/src/components/PermissionMenu.vue`：

```vue
<!-- 权限档 popover：档位名全部来自 PERMISSION_LABELS，本文件不出现第二份中文档名。 -->
<script setup lang="ts">
import { computed } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type PermissionMode
} from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import { matchPermissionMode } from "../utils/slash-commands";

const book = useBookStore();
const emit = defineEmits<{ close: [] }>();

const current = computed<PermissionMode>(
  () => book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE
);
const presetMode = computed<PermissionMode | null>(() =>
  matchPermissionMode(book.permissionPreset)
);
const busy = computed(() => book.saving || book.meta === null);

async function choose(mode: PermissionMode): Promise<void> {
  if (busy.value) return;
  await book.setPermissionMode(mode);
  emit("close");
}
</script>

<template>
  <div class="permission-menu" role="menu" aria-label="权限档">
    <button
      v-for="mode in PERMISSION_MODES"
      :key="mode"
      type="button"
      role="menuitem"
      :class="[
        'permission-option',
        { 'is-current': mode === current, 'is-preset': mode === presetMode }
      ]"
      :disabled="busy"
      @click="choose(mode)"
    >
      {{ PERMISSION_LABELS[mode] }}
      <span v-if="mode === current">（当前）</span>
    </button>
    <p class="permission-hint">
      {{ book.meta ? "切档只改之后的判断，不复活已经被拒绝或取消的提案。" : "先打开作品才能切档。" }}
    </p>
    <p class="permission-hint">
      已经拒绝或取消的提案不会回来，切档后请在新一轮里重新提出；仍留在待审的提案，切档后可以马上批准。
    </p>
  </div>
</template>
```

> 两句 `permission-hint` 是 spec §7 点名的口径（「切档不复活已删的 pending」+「仍留 pending 的可批准」）。文案不在 `contracts` 里，因为它是本片新写的 UI 说明；**冒烟第 4 项要肉眼核对这两句在界面上出现**。

- [x] **Step 7：`matchPermissionMode` 与 `/permissions <档位名>`**

`apps/desktop/src/renderer/src/utils/slash-commands.ts` 末尾加（唯一来源仍是 `PERMISSION_LABELS`，反查不重抄档名）：

```ts
/** 中文档位名反查 PermissionMode：查不到返回 null，由调用处给一句中文提示（spec §6）。 */
export function matchPermissionMode(text: string): PermissionMode | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  for (const [mode, label] of Object.entries(PERMISSION_LABELS) as [PermissionMode, string][]) {
    if (label === trimmed) return mode;
  }
  return null;
}
```

并在文件顶部加 `import { PERMISSION_LABELS, PERMISSION_MODES, type PermissionMode } from "@mochen/contracts";`（`PERMISSION_MODES` 给下一步的失败提示用）。

`slash-commands.test.ts` 追加：

```ts
describe("slash-commands · 中文档位名反查（唯一来源仍是 PERMISSION_LABELS）", () => {
  it("三个档名都能查回去，多余空白容忍", () => {
    expect(matchPermissionMode("只读参考")).toBe("read-only");
    expect(matchPermissionMode(" 可改当前章 ")).toBe("chapter-write");
    expect(matchPermissionMode("全开")).toBe("full-access");
  });

  it("查不到与空串都给 null，绝不猜", () => {
    expect(matchPermissionMode("随意改")).toBeNull();
    expect(matchPermissionMode("read-only")).toBeNull();
    expect(matchPermissionMode("")).toBeNull();
  });
});
```

`useAgentStore.ts` 的 `runSlashCommand` 的 `permissions` 分支补参数处理（带档位名 ⇒ 查表切档；查不到 ⇒ 一句中文，档名列自 `PERMISSION_LABELS` 而不是手抄）。同时补两处 import：`@mochen/contracts` 那条值列表里按字母序插入 `PERMISSION_MODES`（Task 8 只带了 `PERMISSION_LABELS` 与 `DEFAULT_PERMISSION_MODE`）；Task 8 那行 type import 改成同时引入 `matchPermissionMode`：

```ts
import { matchPermissionMode, type SlashCommand } from "../utils/slash-commands";
```

```ts
        case "permissions": {
          const bookStore = useBookStore();
          if (argument === "") {
            bookStore.openPermissionMenu("");
            return;
          }
          const mode = matchPermissionMode(argument);
          if (mode === null) {
            this.notice = `没有这一档：「${argument}」。可选：${PERMISSION_MODES.map((item) => PERMISSION_LABELS[item]).join(" / ")}。`;
            return;
          }
          void bookStore.setPermissionMode(mode);
          return;
        }
```

`useAgentStore.test.ts` 追加一条（`saveMeta` 模块级常量已在 Task 8 Step 4 提出；`/permissions` 的完整落盘结果由 `useBookStore.test.ts` 的 Step 4 验，这里只验派发）：

```ts
  it("/permissions 带档名直接调 saveMeta，带错档名只给一句中文且不写盘", async () => {
    const bookStore = useBookStore();
    await bookStore.openBook("/book");
    saveMeta.mockClear();

    store().runSlashCommand("permissions", "全开");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0]?.[0]).toMatchObject({ permissionMode: "full-access" });

    bookStore.closePermissionMenu();
    store().runSlashCommand("permissions", "随意改");
    expect(store().notice).toBe("没有这一档：「随意改」。可选：只读参考 / 可改当前章 / 全开。");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(bookStore.permissionMenuOpen).toBe(false);
  });
```

- [x] **Step 8：`CenterColumn.vue` 接线**

script：加 `import PermissionMenu from "./PermissionMenu.vue";`；把只读的 `permissionLabel` computed（HEAD 版 `:69-71`，含「档位文案的唯一来源是 contracts」那条注释——**注释与实现都留着，别改成手抄**）保留。

template：`<span class="permission-chip">{{ permissionLabel }}</span>`（HEAD 版 `:135`）整行换成一个带 popover 的按钮：

```html
        <div class="permission-menu-actions">
          <button
            class="permission-chip is-button"
            type="button"
            :disabled="book.permissionMenuOpen"
            :aria-expanded="book.permissionMenuOpen"
            @click="book.openPermissionMenu('')"
          >
            {{ permissionLabel }}
          </button>
          <PermissionMenu v-if="book.permissionMenuOpen" @close="book.closePermissionMenu()" />
        </div>
```

- [x] **Step 9：跑到绿 + 行数预算自查**

Run: `corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 两处均无诊断。
Run: `corepack pnpm prettier --write packages apps/desktop/src/renderer && corepack pnpm vitest run packages/contracts/test/contract.test.ts apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: PASS。
Run: `node tools/check-source-line-budget.mjs` + `wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/PermissionMenu.vue`
Expected: 「行数预算通过」；`PermissionMenu.vue` ≤70 行；`CenterColumn.vue` ≤380。

- [x] **Step 10：变异实验 M12（按 spec §15 的「tsc 探针 + 查表用例红」两条做）**

1. **tsc 探针**（证明「穷尽 Record 就是编译期闸」，也正是三元链不该回来的理由）。临时 Create `apps/desktop/src/renderer/src/utils/__m12-probe.ts`：

```ts
import type { PermissionMode } from "@mochen/contracts";

export const secondHandLabels: Record<PermissionMode, string> = { "read-only": "只读参考" };
```

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 红 —— `error TS2739: Type '{ "read-only": string; }' is missing the following properties from type 'Record<PermissionMode, string>': "chapter-write", "full-access"`。
删掉 `__m12-probe.ts`，再跑同一条命令 ⇒ 回到无诊断。贴出两次输出。

2. **查表用例红**：Edit `packages/contracts/src/patch.ts` 把 `"doc-overwrite": "整篇替换"` 改成 `"doc-overwrite": "整章替换"`。
Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4`
Expected: 红 —— `expected '整章替换' to be '整篇替换'`（`toBe` 的差异行）。改回 ⇒ 绿。

3. **如实记录（不粉饰）**：把 `ProposalCard.vue` 的 `modeLabel` 临时改回原三元链，`corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json` 与全量 vitest **都仍然绿**——本仓 `.vue` 模板零自动化覆盖（spec §15 末行、波 A 评审 P3 #4）。所以 M12 的真实防线是上面两步（编译期闸 + 表本身可红）+ **冒烟第 4 项肉眼看卡头「锚点替换 / 整篇替换」**。这一条写进波 1 台账，不许写成「变异已让测试转红」。

- [x] **Step 11：连带清单**

- `PROPOSAL_MODE_LABELS` 消费方只有 `ProposalCard.vue:18-20`（已删的三元链）；`packages/agent-runtime/src/apply-patch.ts:40` 那句 `message: "整篇替换"` 是**回喂模型的文本**、不是档位标签，不在本条范围内（波 A 已审过），执行本任务时也别顺手改它。
- `PERMISSION_LABELS` 消费方：`CenterColumn.vue:69-71`（保留）、`PermissionMenu.vue`、`agent-service.ts:435`（主进程提示词）、`useAgentStore.runSlashCommand`（`/status` 报告与失败提示）。新增的 `matchPermissionMode` 只做反查，不产生新文案。
- `setPermissionMode` 是渲染层第一处 `saveMeta`：`book-service.ts:60-67` 会在写盘后刷新主进程快照，因此下一轮 `startTurn` 的 `permissionLabel` 与审批判断当场生效；渲染层这边靠 `this.meta = next` 让头部标签同步。
- `useAgentStore.test.ts` 的 `api` 夹具（`:112-128`）里 `saveMeta` 是 `vi.fn(async (): Promise<void> => undefined)`（`:115`）——本任务的 `/permissions` 用例要求 `openBook` 用同一份夹具（`result.meta` 形状见 `:26-31`）；若 `openBook` 在该文件里不可用，就照 `useBookStore.test.ts:6-21` 的 `result` 形状补一份 meta 夹具，别改契约。
- `permissionMenuOpen` / `permissionPreset` 由 Task 8 建、Task 9 消费；`busy` 里的 `book.saving` 是文稿保存态——切档与保存不同事，这里只是避免弹层在写盘动画里连点；若评审认为耦合别扭，可换成 `permissionSwitching` 本地 ref（记录进台账，不影响门禁）。

- [x] **Step 12：提交**

```bash
git add packages/contracts/src/patch.ts packages/contracts/test/contract.test.ts apps/desktop/src/renderer/src/utils/slash-commands.ts apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/components/PermissionMenu.vue apps/desktop/src/renderer/src/components/ProposalCard.vue apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts
git commit -m "feat(renderer,contracts): 权限档 popover 接通 saveMeta，提案模式文案下沉查表"
```

---

### Task 10：波 1 门禁、变异台账与真机冒烟（不写新功能）

> 本任务只做三件事：**跑对门禁并回读日志**、**把波 1 的契约表/用例数/变异逐条对账**、**按 spec §16 的 1–4 项真机实操并落一份记录**。
> 两条硬纪律：① 退出码不能被管道吞掉（`pnpm verify | tail` 是禁手）；② 冒烟全程**任何密钥串都不许出现在命令行、日志、报告、commit 里**，只在设置对话框里输入。

**Files:**

- Create: `docs/superpowers/plans/2026-10-02-plan3-wave1-report.md`（波 1 台账与冒烟记录；格式照 `docs/superpowers/plans/2026-10-02-plan2-smoke-report.md`）
- Modify: 装配后的计划文件（`docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md` 波 1 段）——把本波十个任务的 `- [ ]` 逐条勾成 `- [x]`，只勾真的做完并验证过的
- 只读核对：`packages/contracts/src/ipc.ts`、`apps/desktop/src/preload/renderer-api.test.ts:101,132`、`packages/contracts/src/patch.ts`、`apps/desktop/src/renderer/src/stores/useAgentStore.ts:26-37`

**Interfaces:**

- Consumes: Task 1–9 的全部落地物
- Produces: 无新接口（台账文档 + 勾选状态）

- [ ] **Step 1：跑对门禁并回读**

先确认没有别的 vitest 在跑（本机 dev 在跑时全量 vitest 会假红灯，且每次红的文件不同）。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify 2>&1 | tee /tmp/plan3-wave1-verify.log
echo "VERIFY_PIPESTATUS=${PIPESTATUS[0]}"
```

必须回读三样（`tee` 之后可以随便 `grep`/`tail` 那个**日志文件**——退出码已经单独记进 `VERIFY_PIPESTATUS`，这才是不吞退出码的正确姿势）：

```bash
grep -nE "VERIFY_EXIT=0|Test Files .*|Tests .*" /tmp/plan3-wave1-verify.log
```

- [x] 期望：`VERIFY_EXIT=0`（`package.json:24` 的 verify 串最后一步才 echo 它，出现即全链绿）、`VERIFY_PIPESTATUS=0`、`prettier . --check` 段无「[warn]」、五个 tsc 项目无诊断、`eslint . --max-warnings=0` 无告警、`边界检查通过`、`行数预算通过`、`Tests N passed` 里 **N ≥ 400**。
  > 实况：本波取码用 `corepack pnpm verify > 日志 2>&1; echo "VERIFY_EXIT=$?"`（不经管道，比 `PIPESTATUS` 更硬），链尾自印与 shell 两侧各一道 `VERIFY_EXIT=0`；`tee` 版另跑了一遍交叉核对。
- [x] 任何一步红：**回到对应任务修，不许关规则、不许加 `--no-verify`、不许把 `--max-warnings=0` 改掉**。红文件怀疑是本机 dev 抢临时目录时，按文件单跑复核：`corepack pnpm vitest run <那个文件> --maxWorkers=4`。
  > 实况：唯一一次撞红是我自己的 `scratch/` 探针被 `eslint .` 检查（flat config 不吃 `.gitignore`），处置只改探针、没动门禁 —— 详见报告的「门禁插曲」。

- [x] **Step 2：契约变更表自检（spec §13 / 计划共头「契约变更总表」波 1 列）**

```bash
node -e 'const s=require("fs").readFileSync("packages/contracts/src/ipc.ts","utf8");const b=s.slice(s.indexOf("IPC_CHANNELS"),s.indexOf("} as const"));console.log("IPC键数="+(b.match(/:\s*"[a-z-]+:/g)||[]).length)'
grep -nE "expect\(calls\.length\)\.toBe\([0-9]+\)" apps/desktop/src/preload/renderer-api.test.ts
grep -n "渲染层只拿到这" apps/desktop/src/preload/renderer-api.test.ts
grep -c "expired" packages/contracts/src/patch.ts
grep -nE "hydrated: boolean|hydrating: boolean|queued: string\[\]" apps/desktop/src/renderer/src/stores/useAgentStore.ts
node -e 'const s=require("fs").readFileSync("apps/desktop/src/renderer/src/stores/useAgentStore.ts","utf8");const b=s.slice(s.indexOf("export interface ThreadView"),s.indexOf("export interface ProposalView"));console.log("ThreadView 字段数="+(b.match(/^\s{2}\w+/gm)||[]).length)'
```

对账表（逐行把实际值抄进报告，实际与期望不符就是本波未完成）：

| 项 | 现值 | 波 1 期望 | 实际 |
| --- | --- | --- | --- |
| `IPC_CHANNELS` 键数 | 12 | 13（+`agent:load-session`） | |
| `RendererApi` 方法数 | 12 | 13 | |
| `renderer-api.test.ts` 字面量 | `toBe(12)`（`:101`）+「只拿到这 12 个方法」（`:132`） | 两处都是 13 | |
| `PROPOSAL_STATUSES` | 6 | 7（+`expired`） | |
| `ThreadView` 字段 | 7 | 10（+`hydrated` `hydrating` `queued`） | |
| `StartTurnInput` 字段 | 4 | 4（波 1 不动） | |
| `SessionMeta` / `BookStage` 字段 | 6 / 2 | 6 / 2（波 2 才加 `profileId?`） | |
| `book.json` `schemaVersion` | 1 | 1（本波不动盘上形状） | |

- [x] **Step 3：用例数对账（353 → ≥400）**

从日志抄 `Test Files` 与 `Tests` 两行（基线：`353 用例 / 34 文件`，spec §0 末行）。各任务新增量的**估算**（只用于核对方向，落账以日志为准）：

| 任务 | 新增用例（估） |
| --- | --- |
| Task 1/2（契约 + preload 计数） | 8 |
| Task 3（主进程 loadSession） | 10 |
| Task 4（replay/statuses/expired/pendingOf 钉桩） | 14 |
| Task 5（水合八规则 + 三处时机） | 12 |
| Task 6（焦点 × 键矩阵） | 18 |
| Task 7（排队 / 状态行 / 标签切换） | 8 |
| Task 8（slash-commands + clear/status 派发） | 16 |
| Task 9（文案表 + 切档四态 + 反查） | 12 |
| 合计 | ≈98 ⇒ 约 451 |

- [x] 若 `Tests` 落在 353–400 之间：说明上面某些「应该写的矩阵/反向用例」被省了。**按缺口回到对应任务补**（最常被省的是 Task 6 的越界与合成族、Task 5 的规则 4/5/6/8），别在报告里把 400 改小。
- [x] 记录最终数字与文件数到报告表头。

- [x] **Step 4：变异台账复核（评审者自己跑，不采信实现者转录）**

波 1 归属的五条（`spec §15` / 计划共头「变异归属」）：M1（Task 5）、M2（Task 4）、M3（Task 5）、M4（Task 6）、M12（Task 9）。每条按下面两步走，并把**转红的断言行原文**贴进台账：

1. 用 Edit 做变异（禁 `perl -i` / `sed -i`）；
2. `corepack pnpm vitest run <该任务点名的测试文件> --maxWorkers=4` ⇒ 必须红；改回 ⇒ 必须绿。

| 编号 | 变异动作 | 单跑命令 | 转红的断言（贴原文） |
| --- | --- | --- | --- |
| M1 | `ensureHydrated`/`runHydrate` 里 `fetchDiff: false` 改 `true` | `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4` | |
| M2 | `reduceEvent` 的 proposal 分支去掉 `status = "expired"`（仍留 pending） | `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/utils/timeline.test.ts --maxWorkers=4` | |
| M3 | `apply` 的 `turn-end{failed}` 也走 `endedAs = "interrupted"`（等价：让 error 结尾复活「继续」） | `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4` | |
| M4 | `resolveHotkey` 顶部删掉 `if (focus.isComposing) return { action: "none" };` | `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/hotkeys.test.ts --maxWorkers=4` | |
| M12 | 见 Task 9 Step 10（tsc 探针 + 改表值）；**并如实记录「模板层三元链回来了也不会红」** | `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json` / `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4` | |

- [x] 五条全部有「红证据 + 改回绿证据」才算台账闭合；缺一条就回任务补，不进冒烟。

- [x] **Step 5：真机冒烟（控制方亲自操作，不委托子代理）——spec §16 第 1–4 项**

准备：`corepack pnpm build` 后 `corepack pnpm --filter @mochen/desktop exec electron .`；测试用书放在临时书目录（`scratch/wave1-book`，`book.json` 用现仓测试同款形状：`stages: [{ id: "draft", name: "正文" }]`、`permissionMode: "read-only"`），**不拿任何真人书稿当对象**。密钥纪律：`baseURL` / 模型名 / 密钥**只在设置对话框里输入**，落 `secrets.enc`；命令行、日志、报告、commit 里都不许出现密钥串；本轮用过的密钥串在报告里记一句「已提醒轮换」。

1. **回放（F-6 的正题）**：打开书 → 发一轮让模型给出两条提案 → 只批准其中一条 → 关闭应用 → 重开 → 打开同一章。
   - 期望：中栏有用户句、思考/计划/工具卡、正文；**两条卡都回来了**，已批准那张状态「已写入」；未批准那张落在「上次会话未处理 · 1 条」折叠组里，四个按钮 disabled，卡上写着「这一条要在新一轮里重新提出。」与「这条历史提案的 diff 不再取回。」；卡头是「第 N 轮 · …」而**不是**「本轮」。
   - 磁盘：`.mochen/sessions/*.jsonl` 行数在本次回放前后不变（只读通路），`.mochen/changes/<时间戳>/` 里那张批准卡的备份仍在。
2. **打断后重启的「继续」**：发一轮 → 流式进行中按 Esc 打断 → 关闭应用 → 重开 → 同一章。
   - 期望：残字仍在（`interrupted` 事件落盘），状态行是打断口径，「继续」按钮在位；点下去真的续写且不重复已流出的句子。
3. **键位逐项实操（spec §16 第 3 项，逐条打勾；本条只写操作，不写任何密钥）**：
   - [x] `Enter` 提交、`Shift+Enter` 与 `Ctrl+J` 换行；
   - [x] 运行中 `Tab` 把 composer 文本变成排队（状态行出现「排队 1 条」），本轮结束后**只自动发队首一条**；
   > 实况：Tab 入队与「只自动发队首一条」都真机在案；「排队 1 条」徽标只在 N=2 的状态行读到（真按 Tab 那一次在 drain 之后才读）。
   - [x] 队列非空时按 Esc 打断 ⇒ 队列**不清**，`turn-end{interrupted}` 后照样发出下一条；
   - [ ] 排队到第 6 条 ⇒ 状态条出现「排队指令最多 5 条，先等这一轮结束。」；
   > 未勾原因：上限文案与 `queued:5` 是**直调 store** 造出来的，没走真 Tab 键盘路径，屏上徽标也没抓到（`badges:[]`）。留给波 1.5 复跑。
   - [ ] `y` / `a` / `p` / `d` 在聚焦卡上各验一次（`d` 只把焦点移进说明框、**不提交**；说明为空时点「拒绝并说明」不生效）；
   > 未勾原因：`y` / `p` / `d` 三格有盘上或焦点证据；`a`（批准本会话同类）键事件发出过，但主会话 JSONL 里**没有** `decision:"accept-session"` ⇒ 四键不齐，整格不勾。
   - [x] `expired` 组的卡上四键全无反应（`proposalIsPending` 为假）；
   - [x] `Ctrl+PageDown` / `Ctrl+PageUp` 切标签，`Ctrl+1..9` 在 `n > 标签数` 时无反应（不是切到最后一个）；
   - [x] `Ctrl+B` 折叠/展开左栏；`Ctrl+,` 打开模型设置；
   > 实况：两个键都到位；顺带撞出「设置浮层开着、composer 聚焦时 Esc 不收浮层」，记进报告的「未做 / 留底」。
   - [x] `/` 开面板：↑↓ 移动、Enter 执行、Esc 关闭且**不打断进行中的一轮**；面板里输入 `/s` 只剩 `status`（`stage` 不出现）；
   - [x] `Esc` 三态各验一次（总 spec §6.2）：说明框有字 ⇒ 保住字并失焦；聚焦待审卡 ⇒ 取消该卡；无卡 ⇒ 打断本轮；
   - [ ] **中文输入法候选框回车不提交**（必实跑）：在 composer 里打拼音、候选框未上屏时按回车 ⇒ 只上屏文字、这一轮不发出。
   > 未勾原因：只做到**合成级** `isComposing` 闸门（items 169→169、文本留在框、无新 user-message）+ 纯 Enter 阳性对照；**真 OS 拼音候选框回车仍欠一次人肉按键**（spec 标了必实跑，所以不自证通过）。
4. **权限档（spec §16 第 4 项）**：
   - [x] 头部标签可点，弹层三档文案与 `PERMISSION_LABELS` 逐字一致（只读参考 / 可改当前章 / 全开），当前档有「（当前）」；
   - [x] 只读档点批准 ⇒ 中栏出现 `packages/agent-runtime/test/permission.test.ts:47-48` 钉死的那两句（「当前权限档为「只读参考」，提案不会写入磁盘。…」），卡仍待审、磁盘未动 —— **UI 落点与拒绝文案对得上**；
   - [x] 切到「可改当前章」⇒ 状态条「权限档已切到「可改当前章」，下一次审批就用这一档判断。」，当场批准本章那张 pending 卡 ⇒ 真落盘 + 备份目录新增；
   > 实况：第一次切档被 P1（`An object could not be cloned.`）挡住，修于 `ca67ec3` 之后本条才真绿。
   - [x] **切档后仍留 pending 的可批准**（上一条已验）；**已拒绝的不回来**：拒绝一条 → 切到「全开」→ 该卡依旧是「已拒绝」，不会变回待审；
   - [ ] 没开书时切档 ⇒ 「还没打开作品目录，权限档改不了。」（弹层按钮 disabled，标签不变）；
   > 未勾原因：提示句与三档 disabled 在案，但**标签本身**没 disabled 且文案捏造成「只读参考」（`chipDisabled:false`）——这是缺陷不是缺失，故不勾。
   - [x] `/permissions 随意改` ⇒ 「没有这一档：「随意改」。可选：只读参考 / 可改当前章 / 全开。」且不写盘。

- [x] **Step 6：写台账文档**

Create `docs/superpowers/plans/2026-10-02-plan3-wave1-report.md`，骨架如下（冒号处填观测到的事实，**不许填「应该没问题」**）：

```markdown
# Plan 3 波 1 门禁与真机冒烟记录（Task 10）

日期：2026-10-__（UTC 时间戳见日志）
构建：`corepack pnpm build` 后 `corepack pnpm --filter @mochen/desktop exec electron .`
门禁：`corepack pnpm verify` 日志 `VERIFY_EXIT=0`，`VERIFY_PIPESTATUS=0`
用例：Test Files __ / Tests __ passed（基线 353 / 34，目标 ≥400）
契约自检：IPC 13 键、RendererApi 13 方法、PROPOSAL_STATUSES 7、ThreadView 10 字段 —— 全部见 Step 2 表

## 变异台账（M1 M2 M3 M4 M12）
（每条：变异动作 → 转红断言原文 → 改回绿 → 谁重跑的）

## 真机通过项（§16 第 1–4 项，逐条观测）
1. 回放：…
2. 打断后续写：…
3. 键位：…（含候选框回车不提交的实跑结果）
4. 权限档：…

## 未做 / 留底（如实）
- `/stage` 在波 1 被 `GATED_COMMANDS` 滤掉，波 2 Task 18 删闸门并补 `profilesReady`。
- `/permissions <档名>` 只到「反查 + 当场切档」，档位菜单的预选高亮仍未接真机验证。
- `useHotkeys.ts` 的「≤40 行」目标：判定确已全在 `utils/hotkeys.ts`，薄壳因要派 13 个动作而超出（实际 __ 行）；波 2 若再涨就把 `dispatch` 收进 store action。
- `App.vue` 不渲染 `currentView === "settings"` 视图，故 `Ctrl+,` 与 `/model` 走 CenterColumn 桥（波 2 若加独立设置视图需改桥）。
- 本轮冒烟用过的模型密钥：**已提醒轮换**。
```

- [ ] **Step 7：勾计划文件的复选框 + 提交**

- [x] 把装配后计划文件里波 1（Task 1–10）**确实验证过**的 `- [ ]` 改成 `- [x]`；变异与冒烟里没做完的留着不勾，并在旁边一行说明为什么（照 Plan 2 波 B 的做法）。

```bash
git add docs/superpowers/plans/2026-10-02-plan3-wave1-report.md docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md
git commit -m "docs(plan3): 波 1 全链门禁、变异台账与真机冒烟记录"
```

- [ ] **Step 8：波 1 收尾自检（进波 2 之前必须全部为真）**

- [x] `VERIFY_EXIT=0` 与 `VERIFY_PIPESTATUS=0` 都在日志/终端里出现过，不是「上次绿过」。
- [x] 五条变异的红/绿两段证据都贴在台账里。
- [ ] §16 第 1–4 项逐条有界面观测；第 3 项的候选框回车那条**真的实跑过**（这是这类应用最刺眼的错，比少一个快捷键严重）。
  > 未勾原因：第 3 项候选框回车只到合成级，第 4 项的「全开档下批准」与「无书标签 disabled」两格未闭合 ⇒ 单项证据充分，但整句「逐条有界面观测 + 候选框真的实跑」还不能打勾。
- [x] 全程没有新增 npm 依赖、没有第 6 个工具、`scanBook` 未动、`book.json` 的 `schemaVersion` 仍是 1。
  > 实测：`git diff --name-only 35eed3a..HEAD` 里没有 `pnpm-lock.yaml`、没有 `package.json`、没有 `packages/fs-store`；临时书 `book.json` 回读 `schemaVersion: 1`。
- [x] `git status` 干净；`.mochen/` 与临时书目录未被 `git add`（`scratch/` 在忽略列表里，跑一下 `git status --porcelain` 核对）。
- [ ] 模型密钥没有出现在命令行、日志、报告、commit 里（`git log -p -1 | grep -i "sk-\|authorization"` 必须无输出）。
  > 未勾原因（不粉饰）：这条**按字面**跑不出「无输出」——本次 commit 的改动行里没有任何密钥材料（新增文本刻意不写那两个前缀字面串；两道门禁日志里 `sk-` / 鉴权头字样各计数 0，已当场回读），但 `git log -p -1` 会把本行这条**计划原文**当上下文带出来，于是 grep 命中它自己。⇒ 实质达标、字面不达标，勾留着，报告里如实记这一条。

---

## 波 2 —— 六个档案与一双不刺眼的眼睛

**波次验收**（本波结束必须全部成立，逐条可在真机、`/__requests` 抓取或单测复核）：

1. 六个墨宸档案真的改变请求：`system` 随档案变（六条互不相同），`tools` 按档案剪枝——`continuator` / `reviewer` 两个只读档**收不到 `write_doc` 声明**（M7 是请求侧证据，不是提示词措辞）；审批侧还有第二道档范围闸（M6），文本块塞进来的提案同样被单句中文拒绝且提案保留。
2. 中栏头部是「阶段 × 档案」两个选择器，显示「阶段 正文 · 档案 墨宸 · 主笔」；**切档案绝不换线程**（M11：`threadKey` 与 `items.length` 一字不变）；切阶段写 `activeStage` 并连带把该线程档案切到阶段默认。
3. 上下文占用条在发送前随章节 / 档案 / 挂入技能刷新，超预算时「已省略 N 节」如实出现，且被省略的节确实不在 `system` 里（M8）。
4. 主题三态是显式开关并持久化到 `appearance.json`：三态各重启保持；「跟随系统」下切系统配色当场变色，锁「浅色」后切系统深色**应用不变色**（M9）。默认值仍是跟随系统，不硬锁深色。
5. 门禁：`IPC_CHANNELS` / `RendererApi` / preload 计数 13→17 全连带、`StartTurnInput` 到 5 字段、`SessionMeta` 与 `BookStage` 各加一个可选 `profileId?`、`book.json` 的 `schemaVersion` 仍是 1、`corepack pnpm verify` 回读 `VERIFY_EXIT=0` 且用例数 ≥445。

> 波 2 契约变更（spec §13 + 本计划设计决定 2）：通道 13→17（新增 `agent:context-preview` / `profile:list` / `appearance:get` / `appearance:save`）、`StartTurnInput` +`profileId`、`ProfileView` 与 `ContextSummary` 进 contracts；提案状态与 `ThreadView` 本波不再增长。
> 命名与参数顺序一律以共头「接口总表 · 波 2」为准，不得改名、不得换参序。
> **落地顺序**：Task 14（`context-pack.ts`）先于 Task 13（`profiles.ts`）——六个档案的 `buildSections` 全部委托给 `buildContextPack`，先有被委托者。其余照编号。

---

### Task 11：contracts —— 波 2 契约（档案视图、上下文摘要、profileId）

> 本任务只做两件事：把波 2 需要的**类型与通道**落进 `@mochen/contracts`，并因为「`StartTurnInput` 加了必填字段」把 apps/desktop 的**全部夹具**在同一任务里补完。
> `profileViews()`、`buildContextPack()`、`AgentService.contextPreview()` 这些**实现**都在 Task 13/14/15，本任务一律不碰；本任务交出去的只有形状。

**Files:**

- Create：`packages/contracts/src/profile.ts`
- Create：`packages/contracts/src/context.ts`
- Modify：`packages/contracts/src/agent-event.ts`（`sessionMetaSchema` 第 23–31 行；`startTurnInputSchema` 第 110–126 行，对象面在第 111–117 行）
- Modify：`packages/contracts/src/book.ts`（`BookStage` 第 7–10 行；`stageSchema` 第 28 行；`schemaVersion: z.literal(1)` 在第 34 行——**本任务不动它**，只用测试钉住）
- Modify：`packages/contracts/src/ipc.ts`（`IPC_CHANNELS` 第 5–18 行；`RendererApi` 第 37–52 行）
- Modify：`packages/contracts/src/index.ts`（第 1–9 行 barrel 追加两行）
- Test：`packages/contracts/test/agent.test.ts`（现 201 行，末尾追加）、`packages/contracts/test/contract.test.ts`（现 59 行，末尾追加）
- 连带 Modify（Step 11，`StartTurnInput` 加必填字段 ⇒ 全部夹具必须同任务补完）：
  - `apps/desktop/src/renderer/src/stores/useAgentStore.ts:310-325`（`send()` 里构造 `input` 的那段是 312–317）
  - `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`（`satisfies RendererApi` 假 API 在 112–128；`started[...]` 的三处 `toEqual` 全字段断言在 365–370、373–378、648–653）
  - `apps/desktop/src/renderer/src/stores/useBookStore.test.ts:41-57`（`satisfies RendererApi` 假 API）
  - `apps/desktop/src/main/agent-service.test.ts:44-46`（`turn()` 助手，全文 30+ 处调用都走它）
  - `apps/desktop/src/main/turn-e2e.test.ts:145-147`（同名 `turn()` 助手）
  - `apps/desktop/src/main/agent-service-boundary.test.ts`（六处**内联**字面量：139–144、154–159、178–183、196、209–214、227–232）
  - `apps/desktop/src/main/agent-ipc.test.ts:105-110`（一处内联 `StartTurnInput` 字面量）
- 本任务**不收**`apps/desktop/src/preload/renderer-api.ts` / `renderer-api.test.ts`——那是 Task 12 的 Files，见 Step 12 的残留红点说明。

**Interfaces:**

- Consumes（全部现成，不新增依赖）：
  - `packages/contracts/src/tools.ts:1-8` 的 `AGENT_TOOL_NAMES` / `AgentToolName`
  - `packages/contracts/src/appearance.ts:214,220` 的 `AppearanceSettings` / `AppearanceSettingsSnapshot`（波 2 外观通道直接复用，本任务不新建外观类型）
  - `zod`（`packages/contracts/package.json` 已有 `"zod": "catalog:"`）
- Produces（逐字签名，下游任务照此 import，**不得改名/改参数顺序**）：
  - `packages/contracts/src/profile.ts`：`export interface ProfileView { id: string; displayName: string; blurb: string; allowedTools: AgentToolName[] }`
  - `packages/contracts/src/context.ts`：
    - `export const CONTEXT_SECTION_KINDS = ["doc", "outline", "characters", "prev-chapters", "skills", "materials"] as const`
    - `export type ContextSectionKind = (typeof CONTEXT_SECTION_KINDS)[number]`
    - `export const CONTEXT_SECTION_KIND_LABELS: Record<ContextSectionKind, string>`（**本计划拍定，接口总表未列**：`ContextSectionView.label` / `ContextSection.label` 都是 kind→中文 的唯一映射，只有放在 contracts 才能让 `agent-runtime`（Task 13）与渲染层（Task 20 占用条）共用一份；Task 13/20 **必须查这张表**，不得自写标签，否则违反铁律 6）
    - `export interface ContextSectionView { kind: ContextSectionKind; label: string; charCount: number; truncated: boolean }`
    - `export interface ContextSummary { sections: ContextSectionView[]; charCount: number; estimate: number; omitted: string[] }`
    - `export const contextPreviewInputSchema` + `export type ContextPreviewInput = z.infer<typeof contextPreviewInputSchema>`
      —— 接口总表把它写成 `interface`；本任务按 `agent-event.ts:110-126` 的既有先例**派生自 schema**（字段名、顺序、可选性与总表逐字一致：`threadKey/docRelPath:string|null/stageId/profileId/skillPaths:string[]`）。理由：跨 IPC 的入参必须有运行期兜底（Global Constraints「跨 IPC 的取值处保留运行期兜底」），派生写法让形状只有一份。**这是本任务唯一一处对总表的实现式改写，已在此声明。**
  - `packages/contracts/src/agent-event.ts`：
    - `startTurnInputSchema` / `StartTurnInput` 追加**必填** `profileId: string`，位置在 `stageId` 之后、`userText` 之前（字段数 4 → 5）
    - `sessionMetaSchema` / `SessionMeta` 追加 `profileId: z.string().min(1).optional()`（字段数 6 → 7）
    - 中文拒绝句**定稿整句**（一字不改，测试用 `toBe` 钉死）：`"智能体档案标识过长（最多 200 字）"`
  - `packages/contracts/src/book.ts`：`BookStage` 追加 `profileId?: string`（字段数 2 → 3），`bookMetaSchema` 的 `schemaVersion: z.literal(1)` **保持不动**
  - `packages/contracts/src/ipc.ts`：`IPC_CHANNELS` 追加四个键 `profileList: "profile:list"`、`agentContextPreview: "agent:context-preview"`、`appearanceGet: "appearance:get"`、`appearanceSave: "appearance:save"`（键数 13 → 17）；`RendererApi` 追加四个**同名方法**（方法数 13 → 17）：
    - `contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;`
    - `listProfiles(): Promise<ProfileView[]>;`
    - `appearanceView(): Promise<AppearanceSettingsSnapshot>;`
    - `saveAppearance(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;`
  - `packages/contracts/src/index.ts`：`export * from "./profile.js";`、`export * from "./context.js";`

- [ ] **Step 1：先写会红的测试（`StartTurnInput.profileId` 必填 + 中文句整句钉死 + 老 JSONL 兜底）**

`packages/contracts/test/agent.test.ts`：把第 3–13 行的 import 块补上 `startTurnInputSchema`（按字母序插在 `sessionMetaSchema` 之后、`WRITE_TOOLS` 之前）：

```ts
import {
  AGENT_TOOL_NAMES,
  agentEventSchema,
  decideInputSchema,
  editProposalSchema,
  isWriteTool,
  maskApiKey,
  providerDraftSchema,
  sessionMetaSchema,
  startTurnInputSchema,
  WRITE_TOOLS,
  type WriteToolName
} from "../src/index.js";
```

在文件末尾（现第 201 行的 `});` 之后）追加：

```ts
describe("startTurnInputSchema 的档案字段（波 2 Task 11）", () => {
  const base = {
    threadKey: "chapters/01-开局.md",
    docRelPath: "chapters/01-开局.md",
    stageId: "draft",
    userText: "改紧一点"
  };

  it("缺 profileId 直接拒绝：空串才是「用默认档」的写法，缺键说明装配漏了一步", () => {
    expect(startTurnInputSchema.safeParse(base).success).toBe(false);
  });

  it("空串 profileId 合法：主进程按 DEFAULT_PROFILE_ID 兜底（spec §9.1），这里绝不抢兜底", () => {
    expect(startTurnInputSchema.safeParse({ ...base, profileId: "" }).success).toBe(true);
  });

  it("profileId 超长时拒绝，且拒绝句整句就是这一句中文（改一个字都算违约）", () => {
    const result = startTurnInputSchema.safeParse({ ...base, profileId: "x".repeat(201) });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((item) => item.path[0] === "profileId");
    expect(issue?.message).toBe("智能体档案标识过长（最多 200 字）");
  });

  it("profileId 不是字符串时拒绝，且不冒英文骨架", () => {
    const result = startTurnInputSchema.safeParse({ ...base, profileId: 7 });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((item) => item.path[0] === "profileId");
    expect(issue?.message).not.toMatch(/^[A-Za-z]/);
  });
});

describe("sessionMetaSchema 的档案字段（老 JSONL 必须照样解析）", () => {
  // 波 2 之前落盘的会话首行长这样：没有 profileId 键。它必须永远读得出来（Plan 3 spec §9.1 末段）。
  const legacy = {
    type: "session-meta",
    sessionId: "s-old",
    docRelPath: "chapters/01-开局.md",
    stageId: "draft",
    model: "qwen3:14b",
    startedAt: "2026-10-01T08:00:00.000Z"
  };

  it("没有 profileId 键的老首行照样解析，且结果里不冒出新键", () => {
    const parsed = sessionMetaSchema.parse(legacy);
    expect(parsed).toEqual(legacy);
    expect("profileId" in parsed).toBe(false);
  });

  it("带 profileId 的新首行原样留键（重启后档案名要能回来）", () => {
    const parsed = sessionMetaSchema.parse({ ...legacy, profileId: "reviewer" });
    expect(parsed.profileId).toBe("reviewer");
  });

  it("profileId 空串在 SessionMeta 上非法：落盘只写真用过的档案 id，缺键才表示「老会话」", () => {
    expect(sessionMetaSchema.safeParse({ ...legacy, profileId: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2：跑到红**

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: FAIL，形如（**必现前两条，第三条是拒绝句 undefined**）：

```
 FAIL  packages/contracts/test/agent.test.ts > startTurnInputSchema 的档案字段（波 2 Task 11） > 缺 profileId 直接拒绝：空串才是「用默认档」的写法，缺键说明装配漏了一步
AssertionError: expected true to be false
 FAIL  packages/contracts/test/agent.test.ts > startTurnInputSchema 的档案字段（波 2 Task 11） > profileId 超长时拒绝，且拒绝句整句就是这一句中文（改一个字都算违约）
AssertionError: expected undefined to be '智能体档案标识过长（最多 200 字）'
 Test Files  1 failed (1)
```

`sessionMetaSchema` 那三条**现在就应绿**（可选键缺失天然合法）——它们是防倒退夹具，作用是给 Step 10 的变异和 Task 15 的写盘回读兜底，不是本步的红源。

- [ ] **Step 3：实现 `agent-event.ts` 两处**

`sessionMetaSchema`（第 23–31 行）整块替换为：

```ts
export const sessionMetaSchema = z.object({
  type: z.literal("session-meta"),
  sessionId: id,
  docRelPath: z.string().min(1),
  stageId: z.string().min(1),
  model: z.string().min(1),
  startedAt: ts,
  /** 波 2 起写盘；老 JSONL 没这个键，必须照样解析 ⇒ 可选 + min(1)（空串表示「老会话」不合法）。 */
  profileId: z.string().min(1).optional()
});
```

`startTurnInputSchema` 的对象面（第 111–117 行）替换为（`.superRefine` 那段第 118–125 行**一字不动**）：

```ts
  .object({
    threadKey: z.string().max(200, "会话线程标识过长（最多 200 字）"),
    /** null = 还没打开文稿标签，此时只能问不能改。 */
    docRelPath: z.string().nullable(),
    stageId: z.string().min(1, "创作阶段标识不能为空").max(200, "创作阶段标识过长（最多 200 字）"),
    /** 必填但允许空串：空串由 agent-service 按 DEFAULT_PROFILE_ID 兜底（Plan 3 spec §9.1 末段），
     *  渲染层在档案表装载完成前也能合法发轮，不必先 IPC 再发话。 */
    profileId: z.string().max(200, "智能体档案标识过长（最多 200 字）"),
    userText: z.string().max(20000, "输入内容过长（最多 20000 字）")
  })
```

- [ ] **Step 4：跑到绿**

Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: PASS（较之前 +7 用例）。

- [ ] **Step 5：先写会红的测试（contract.test.ts：波 2 形状、通道计数、BookStage 与 schemaVersion）**

`packages/contracts/test/contract.test.ts`：第 1–7 行 import 块替换为：

```ts
import { describe, expect, it } from "vitest";
import {
  CONTEXT_SECTION_KINDS,
  CONTEXT_SECTION_KIND_LABELS,
  DEFAULT_PERMISSION_MODE,
  IPC_CHANNELS,
  PERMISSION_MODES,
  bookMetaSchema,
  contextPreviewInputSchema,
  parseBookMeta,
  type ContextPreviewInput,
  type ContextSummary,
  type ProfileView
} from "../src/index.js";
```

> `vitest` 那行仍只 import `describe, expect, it`——本任务这几条用例不需要 mock，多加一个未用符号会被 `eslint --max-warnings=0` 揪出来。

在文件末尾（现第 59 行）追加：

```ts
describe("bookMetaSchema 的阶段档案字段（加可选字段不升版本）", () => {
  it("stage 带 profileId 时解析成功，值真留在结果里", () => {
    const parsed = parseBookMeta({
      ...valid,
      stages: [{ id: "draft", name: "正文", profileId: "reviewer" }]
    });
    expect(parsed.stages[0]?.profileId).toBe("reviewer");
  });

  it("老 book.json（stage 里没有 profileId）读出来语义不变：解析成功且结果里不冒出新键", () => {
    const parsed = parseBookMeta(valid);
    expect("profileId" in (parsed.stages[0] as object)).toBe(false);
  });

  it("schemaVersion 仍是字面量 1：本片只加可选字段，升到 2 必须被拒", () => {
    expect(bookMetaSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
    expect(bookMetaSchema.safeParse(valid).success).toBe(true);
  });
});

describe("波 2 契约形状（Task 11）", () => {
  it("IPC_CHANNELS 到波 2 是 17 个键，四条新通道名逐字钉死", () => {
    expect(Object.keys(IPC_CHANNELS).length).toBe(17);
    expect(IPC_CHANNELS.profileList).toBe("profile:list");
    expect(IPC_CHANNELS.agentContextPreview).toBe("agent:context-preview");
    expect(IPC_CHANNELS.appearanceGet).toBe("appearance:get");
    expect(IPC_CHANNELS.appearanceSave).toBe("appearance:save");
  });

  it("六类上下文分节的种类与顺序都是契约（占用条按它渲染）", () => {
    expect([...CONTEXT_SECTION_KINDS]).toEqual([
      "doc",
      "outline",
      "characters",
      "prev-chapters",
      "skills",
      "materials"
    ]);
  });

  it("每一类分节都有非空中文说明：加种类必须同时给说明（铁律 6）", () => {
    expect(Object.keys(CONTEXT_SECTION_KIND_LABELS).sort()).toEqual(
      [...CONTEXT_SECTION_KINDS].sort()
    );
    for (const kind of CONTEXT_SECTION_KINDS) {
      expect(CONTEXT_SECTION_KIND_LABELS[kind].trim().length).toBeGreaterThan(0);
    }
  });

  it("ContextSummary 是纯视图：形状里没有任何正文字段，正文只活在 agent-runtime", () => {
    const summary: ContextSummary = {
      sections: [{ kind: "doc", label: "本章正文", charCount: 1200, truncated: false }],
      charCount: 1200,
      estimate: 750,
      omitted: ["materials/雾.md"]
    };
    expect(Object.keys(summary).sort()).toEqual(["charCount", "estimate", "omitted", "sections"]);
    expect(Object.keys(summary.sections[0] as object).sort()).toEqual([
      "charCount",
      "kind",
      "label",
      "truncated"
    ]);
  });

  it("ProfileView 的 allowedTools 只能是五工具子集：第六个工具名让 tsc 直接红", () => {
    const reviewer: ProfileView = {
      id: "reviewer",
      displayName: "墨宸 · 审稿",
      blurb: "只出批注式提案，不写盘",
      allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch"]
    };
    // 若 allowedTools 退回 string[]，下一行不再报错 ⇒ @ts-expect-error 变成未使用指令 ⇒ tsc 转红。
    // @ts-expect-error 工具全集只有五个，凭空多一个必须先改 contracts
    const ghost: ProfileView = { ...reviewer, allowedTools: ["delete_doc"] };
    expect(reviewer.allowedTools).not.toContain("delete_doc");
    expect(ghost.allowedTools).toEqual(["delete_doc"]);
  });

  it("contextPreviewInputSchema：完整入参通过，缺键/stageId 空/skillPaths 越界都拒", () => {
    const input: ContextPreviewInput = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      profileId: "writer",
      skillPaths: ["mochen-suspense/SKILL.md"]
    };
    expect(contextPreviewInputSchema.parse(input)).toEqual(input);
    // 手写一份「少了 profileId 的入参」而不是解构剔除：解构出来的下划线变量会被 eslint 揪未用。
    expect(
      contextPreviewInputSchema.safeParse({
        threadKey: input.threadKey,
        docRelPath: input.docRelPath,
        stageId: input.stageId,
        skillPaths: input.skillPaths
      }).success
    ).toBe(false);
    expect(contextPreviewInputSchema.safeParse({ ...input, stageId: "" }).success).toBe(false);
    expect(
      contextPreviewInputSchema.safeParse({ ...input, docRelPath: undefined }).success
    ).toBe(false);
    expect(
      contextPreviewInputSchema.safeParse({
        ...input,
        skillPaths: Array.from({ length: 13 }, (_v, i) => `s${i}/SKILL.md`)
      }).success
    ).toBe(false);
  });

  it("预览入参的三条拒绝都是中文（与 startTurnInputSchema 同口径）", () => {
    const longThread = contextPreviewInputSchema.safeParse({
      threadKey: "x".repeat(201),
      docRelPath: null,
      stageId: "draft",
      profileId: "",
      skillPaths: []
    });
    expect(longThread.success).toBe(false);
    expect(longThread.error?.issues[0]?.message).toBe("会话线程标识过长（最多 200 字）");
    const tooMany = contextPreviewInputSchema.safeParse({
      threadKey: "t",
      docRelPath: null,
      stageId: "draft",
      profileId: "",
      skillPaths: Array.from({ length: 13 }, (_v, i) => `s${i}/SKILL.md`)
    });
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0]?.message).toBe("一次最多挂入 12 个技能");
  });
});
```

- [ ] **Step 6：跑到红**

Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4`
Expected: FAIL —— 整个文件在导入期就炸（`profile.js` / `context.js` 还不存在）：

```
Error: [vite] No known bindings for ... or
SyntaxError: The requested module '../src/index.js' does not provide an export named 'CONTEXT_SECTION_KINDS'
 Test Files  1 failed (1)
```

（哪怕只报 `CONTEXT_SECTION_KIND_LABELS` 一个名字也算预期的红；红源必须是「导出缺失」而不是断言失败。）

- [ ] **Step 7：新建 `profile.ts` 与 `context.ts` + barrel**

`packages/contracts/src/profile.ts` 全文：

```ts
import type { AgentToolName } from "./tools.js";

/**
 * 档案的 IPC 视图形状：只够渲染层列出「谁、干什么、能碰哪几个工具」。
 * systemPrompt 与 writeScope 刻意不在这里——roster 与两道档案闸都活在
 * packages/agent-runtime（渲染层禁止 import 它，由 tools/check-package-boundary.mjs 强制），
 * 把提示词递到渲染层既没有消费方，又白占一次 IPC。
 * id 用 ASCII（总 spec §5.1 花名册），displayName/blurb 一律简体中文。
 */
export interface ProfileView {
  id: string;
  displayName: string;
  blurb: string;
  /** 五工具的子集，只读展示用；空数组表示该档什么都不能调（本花名册里不存在这种档）。 */
  allowedTools: AgentToolName[];
}
```

`packages/contracts/src/context.ts` 全文：

```ts
import { z } from "zod";

/**
 * 上下文分节的种类。顺序＝占用条的渲染顺序，也是 buildContextPack 装载的优先级顺序
 * （Plan 3 spec §9.3：越靠后的越先被整节丢弃）。一份 `as const`，派生类型，不许多写一份。
 */
export const CONTEXT_SECTION_KINDS = [
  "doc",
  "outline",
  "characters",
  "prev-chapters",
  "skills",
  "materials"
] as const;
export type ContextSectionKind = (typeof CONTEXT_SECTION_KINDS)[number];

/** kind→中文 的唯一映射：agent-runtime 造节查它，渲染层占用条也查它（铁律 6，禁三元链）。 */
export const CONTEXT_SECTION_KIND_LABELS: Record<ContextSectionKind, string> = {
  doc: "本章正文",
  outline: "大纲",
  characters: "出场人物",
  "prev-chapters": "前情摘要",
  skills: "挂入技能",
  materials: "素材"
};

/** 一节的视图：只有统计量，没有正文——正文永不过 IPC。 */
export interface ContextSectionView {
  kind: ContextSectionKind;
  label: string;
  charCount: number;
  truncated: boolean;
}

/** 发送前给渲染层画占用条的那份摘要（Plan 3 spec §9.3 + 计划文件结构第 3 条）。 */
export interface ContextSummary {
  sections: ContextSectionView[];
  charCount: number;
  /** 粗略 token 估算：Math.ceil(码点数 / 1.6)，由 agent-runtime 算好后递过来。 */
  estimate: number;
  /** 因超预算被**整节**丢弃的路径（不是半句截断），M8 钉的就是这个。 */
  omitted: string[];
}

/**
 * 预览入参：装配只在主进程发生，渲染层要「发送前」看到占用条就得把这几个坐标递过来。
 * 与 startTurnInputSchema 同一口径——形状与上限在这里挡，业务判断（没开书、线程为空）
 * 一律走优雅路径，所以 threadKey/docRelPath 都允许空或 null，且这里**不做**跨字段一致性
 * 校验：预览是只读通道，把「空线程却带路径」的组合递给 buildContextPack 最多也就是多算几节，
 * 不会落盘；真正的一致性由 startTurnInputSchema 的 superRefine 在那一侧钉。
 * profileId 允许空串（Task 11 的 StartTurnInput 同理，主进程按 DEFAULT_PROFILE_ID 兜底）。
 */
export const contextPreviewInputSchema = z.object({
  threadKey: z.string().max(200, "会话线程标识过长（最多 200 字）"),
  docRelPath: z.string().nullable(),
  stageId: z.string().min(1, "创作阶段标识不能为空").max(200, "创作阶段标识过长（最多 200 字）"),
  profileId: z.string().max(200, "智能体档案标识过长（最多 200 字）"),
  skillPaths: z
    .array(z.string().min(1, "技能路径不能为空").max(300, "技能路径过长（最多 300 字）"))
    .max(12, "一次最多挂入 12 个技能")
});
export type ContextPreviewInput = z.infer<typeof contextPreviewInputSchema>;
```

`packages/contracts/src/index.ts`（第 1–9 行）末尾追加两行——**放在 `./agent-event.js` 之后、`./provider.js` 之前**，让 profile/context 与 agent 域相邻：

```ts
export * from "./appearance.js";
export * from "./permission.js";
export * from "./book.js";
export * from "./patch.js";
export * from "./ipc.js";
export * from "./tools.js";
export * from "./agent-event.js";
export * from "./profile.js";
export * from "./context.js";
export * from "./provider.js";
export * from "./validation.js";
```

- [ ] **Step 8：实现 `book.ts` 与 `ipc.ts`**

`packages/contracts/src/book.ts` 第 7–10 行的 `BookStage` 替换为：

```ts
export interface BookStage {
  id: string;
  name: string;
  /** 该阶段的默认档案 id；缺省 ⇒ DEFAULT_PROFILE_ID（一个常量，不按阶段名分支）。 */
  profileId?: string;
}
```

第 28 行的 `stageSchema` 替换为（`bookMetaSchema` 其余部分，含第 34 行 `schemaVersion: z.literal(1)`，**一字不动**）：

```ts
const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  profileId: z.string().min(1).optional()
});
```

`packages/contracts/src/ipc.ts`：第 1–3 行的 import 块替换为（四行都要保留原有顺序，新增三行跟在后面）：

```ts
import type { BookMeta, DocRef } from "./book.js";
import type { AgentOutbound, DecideInput, DecisionResult, StartTurnInput } from "./agent-event.js";
import type { ProviderDraft, ProviderView } from "./provider.js";
import type { AppearanceSettings, AppearanceSettingsSnapshot } from "./appearance.js";
import type { ContextPreviewInput, ContextSummary } from "./context.js";
import type { ProfileView } from "./profile.js";
```

`IPC_CHANNELS`：在 `agentLoadSession: "agent:load-session"`（波 1 Task 1 落在 `providerSave` 之后）这一行后面追加四行，注意给上一行补尾逗号（本仓 `trailingComma: "none"`，所以**最后一行不带逗号**）：

```ts
  agentLoadSession: "agent:load-session",
  agentContextPreview: "agent:context-preview",
  profileList: "profile:list",
  appearanceGet: "appearance:get",
  appearanceSave: "appearance:save"
```

`RendererApi`：agent 域两条方法插在 `loadSession(...)` 声明之后（三条 agent 方法保持相邻），外观两条插在 `providerSave(...)` 之后（设置类保持相邻）：

```ts
  /** 发送前的只读上下文预览：装配发生在主进程，渲染层只能把坐标递过来问「这轮装了多少」。 */
  contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;
  /** 六条档案的花名册视图；装载失败渲染层发单句中文进 notice，不静默。 */
  listProfiles(): Promise<ProfileView[]>;
```

```ts
  /** 外观快照：persisted=false 表示盘上没有（或读坏了），渲染层照默认值画，绝不弹错误。 */
  appearanceView(): Promise<AppearanceSettingsSnapshot>;
  saveAppearance(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;
```

- [ ] **Step 9：跑到绿 + 本包 tsc**

Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts packages/contracts/test/agent.test.ts --maxWorkers=4`
Expected: PASS（两个文件全绿）。
Run: `corepack pnpm prettier --write packages/contracts && corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json`
Expected: prettier 列出被格式化的文件名；tsc 无诊断。

> **不要在 Step 9 跑 `corepack pnpm verify`**：`RendererApi` 已加四个方法，preload 工厂（Task 12）还没有它们，apps/desktop 的 tsc 此刻必然红；先做 Step 11 的连带。

- [ ] **Step 10：变异自检（本任务不占台账编号，但三条最贵的保护必须现场验）**

1. 用 Edit 把 `startTurnInputSchema` 的 `profileId` 改成 `z.string().min(1).max(200, "智能体档案标识过长（最多 200 字）")`（即禁空串）——Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4`，Expected:「空串 profileId 合法」转红。**改回来。**
2. 用 Edit 把 `sessionMetaSchema` 的 `profileId` 改成必填 `z.string().min(1)` —— 同命令，Expected:「没有 profileId 键的老首行照样解析」转红（这条就是 Task 15 回读老会话的命门）。**改回来。**
3. 用 Edit 把 `CONTEXT_SECTION_KIND_LABELS` 里 `"prev-chapters"` 一行删掉 —— Run: `corepack pnpm tsc --noEmit -p packages/contracts/tsconfig.json`，Expected: 报 `Record<ContextSectionKind, string>` 键不全。这条证明**加种类逼出中文说明**是编译期强制的。**改回来。**
   跑完把三处都还原，再执行一次 Step 9 的命令确认回绿。

- [ ] **Step 11：连带清单——把 `StartTurnInput` 与 `RendererApi` 的所有夹具补完**

**(a) `apps/desktop/src/renderer/src/stores/useAgentStore.ts:312-317`** —— `send()` 里构造入参那段整块替换：

```ts
      const input: StartTurnInput = {
        threadKey: threadKeyFor(book.activeDocTab),
        docRelPath: book.activeDocTab,
        stageId: book.meta?.activeStage ?? "draft",
        // 波 2 Task 18 换成 profileIdFor(threadKey)：这里先交空串，主进程按 DEFAULT_PROFILE_ID 兜底。
        profileId: "",
        userText: text
      };
```

**(b) `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`** —— 假 API（112–128）补四个键，让 `satisfies RendererApi` 重新成立。先在 `proposalDiff`（第 100 行）之后加四个桩：

```ts
const listProfiles = vi.fn(async (): Promise<ProfileView[]> => [
  {
    id: "writer",
    displayName: "墨宸 · 主笔",
    blurb: "照着大纲把这一章写完",
    allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"]
  }
]);
const contextPreview = vi.fn(async (): Promise<ContextSummary> => ({
  sections: [],
  charCount: 0,
  estimate: 0,
  omitted: []
}));
const appearanceView = vi.fn(async (): Promise<AppearanceSettingsSnapshot> => ({
  persisted: false,
  settings: createDefaultAppearanceSettings()
}));
const saveAppearance = vi.fn(
  async (settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot> => ({
    persisted: true,
    settings
  })
);
```

在 `api` 对象里 `loadSession,`（波 1 加的）之后、`providerView,` 之前插入 `contextPreview,` 与 `listProfiles,`；在 `providerSave: vi.fn(async (): Promise<ProviderView> => view),` 之后插入 `appearanceView,` 与 `saveAppearance,`。第 4–15 行的 type import 块按字母序补 `AppearanceSettings`、`AppearanceSettingsSnapshot`、`ContextSummary`、`ProfileView` 四项，并在第 3 行下面加一行：

```ts
import { createDefaultAppearanceSettings } from "@mochen/contracts";
```

再把三处 `started[...]` 的全字段断言各补一行 `profileId: ""`：第 365–370 行与第 648–653 行是 `threadKey: UNBOUND,` 之后加，第 373–378 行是 `stageId: "draft",` 之后加。以第 365 行为例：

```ts
    expect(started[0]).toEqual({
      threadKey: UNBOUND,
      docRelPath: null,
      stageId: "draft",
      profileId: "",
      userText: "写点啥"
    });
```

**(c) `apps/desktop/src/renderer/src/stores/useBookStore.test.ts:41-57`** —— 这个文件的姿态是「book 侧绝不该碰 agent 通道」，四个新方法一律走现成的 `offLimits(name)` 工厂（第 35–39 行）。在 `loadSession: offLimits("loadSession"),` 之后、`providerView: offLimits("providerView"),` 之前插入：

```ts
  contextPreview: offLimits("contextPreview"),
  listProfiles: offLimits("listProfiles"),
```

在 `providerSave: offLimits("providerSave"),` 之后插入：

```ts
  appearanceView: offLimits("appearanceView"),
  saveAppearance: offLimits("saveAppearance"),
```

（若波 1 未在该夹具落 `loadSession`，位置以「provider 两条之前/之后」为准。）

**(d) `apps/desktop/src/main/agent-service.test.ts:44-46`** —— 全文 30+ 次 `service.startTurn(turn(...))` 都走这个助手，只改一处：

```ts
function turn(docRelPath: string | null, userText: string): StartTurnInput {
  // profileId 交空串 = 让 agent-service 按 DEFAULT_PROFILE_ID 兜底；档案闸本身由波 2 后面的任务钉。
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", profileId: "", userText };
}
```

**(e) `apps/desktop/src/main/turn-e2e.test.ts:145-147`** —— 同名助手，同样改法：

```ts
function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", profileId: "", userText };
}
```

**(f) `apps/desktop/src/main/agent-service-boundary.test.ts`** —— 六处**内联**字面量，没有助手可改，逐处补 `profileId`。第 139–144 行是变量 `input`，整块替换（其余五处同样在 `stageId` 行之后插一行）：

```ts
    const input: StartTurnInput = {
      threadKey: CHAPTER,
      docRelPath: CHAPTER,
      stageId: "draft",
      profileId: "",
      userText: "写".repeat(20001)
    };
```

剩余五处的定位串（改完 `grep -c "profileId" 该文件` 应为 **6**）：

- 第 154–159 行：`stageId: "",` —— 这条测的是「空 stageId 被中文拒」，`profileId: "",` 与它无关，照插。
- 第 178–183 行：`stageId: "draft",`（在 `for (const threadKey of ["", "  ", "\t"])` 循环体内，裁定 o 的循环）。
- 第 196 行：单行写法，原地改为
  ```ts
      service.startTurn({
        threadKey: "",
        docRelPath: null,
        stageId: "draft",
        profileId: "",
        userText: "随便聊聊"
      })
  ```
- 第 209–214 行：`stageId: "   ",`（纯空白 stageId 走 unbound 兜底那条）。
- 第 227–232 行：`stageId: "draft",`（纯空白 threadKey 那条）。

**(g) `apps/desktop/src/main/agent-ipc.test.ts:105-110`** —— 该夹具把 `startTurnInput` 原样回传到 `seen` 数组（第 120 行断言），所以只加字段、别动断言：

```ts
    const startTurnInput: StartTurnInput = {
      threadKey: "chapters/01.md",
      docRelPath: "chapters/01.md",
      stageId: "draft",
      profileId: "",
      userText: "改紧"
    };
```

- [ ] **Step 12：连带跑到绿，并确认残留红点只剩 preload**

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: **无诊断**（渲染层三处夹具已在 (a)(b)(c) 补完）。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json`
Expected: 只报 `src/preload/renderer-api.ts` 与 `src/preload/renderer-api.test.ts` 两类诊断——`createRendererApi` 的返回对象缺四个方法、测试里的 `StartTurnInput` 字面量缺 `profileId`。这两文件是 **Task 12 的 Files**，本任务不碰。这与波 1 Task 1 的切法同源：契约任务只跑本包 tsc，根的红由紧邻的消费方任务收口。
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: PASS。
Run: `corepack pnpm vitest run apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/agent-service-boundary.test.ts --maxWorkers=4`
Expected: PASS（`agent-service.test.ts` / `turn-e2e.test.ts` 依赖 `mkdtemp` 真写盘，慢；留给装配后的全量门禁，本步不重复跑）。

- [ ] **Step 13：提交（先确认仓库风格）**

Run: `git log --oneline -8`
Expected: 看到 `feat(...)` / `fix(renderer)` / `test(renderer,runtime)` 这类中文描述风格（HEAD 附近是 `docs(plan3): ...`），据此写：

```bash
git add packages/contracts/src/profile.ts packages/contracts/src/context.ts packages/contracts/src/agent-event.ts packages/contracts/src/book.ts packages/contracts/src/ipc.ts packages/contracts/src/index.ts packages/contracts/test/agent.test.ts packages/contracts/test/contract.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/turn-e2e.test.ts apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/agent-ipc.test.ts
git commit -m "feat(contracts): 波 2 契约进档案视图、上下文摘要与 profileId"
```

Expected: 一次提交成功，`git status --porcelain` 里 `apps/desktop/src/preload/` 两项仍是未改动（Task 12 的活）。

**本任务把门禁推到哪儿（诚实口径）**

| 项 | 状态 |
| --- | --- |
| `IPC_CHANNELS` 13 → **17**、`RendererApi` 13 → **17** | 本任务完成（contracts 侧） |
| `StartTurnInput` 4 → **5** 字段、`SessionMeta` 6 → **7**、`BookStage` 2 → **3**、`schemaVersion` **仍为 1** | 本任务完成，且各有用例钉死 |
| contracts 全部用例、`tsc -p packages/contracts` | 绿 |
| apps/desktop `tsconfig.web.json` tsc + 渲染层两个测试文件 | 绿 |
| apps/desktop `tsconfig.node.json` tsc | **红，且只红 preload 两文件** → Task 12 |
| `renderer-api.test.ts` 的字面量计数 13 → 17 | **不动** → Task 12 |
| `profileViews()` / `buildContextPack()` / `AgentService.contextPreview()` / 主进程 handler | **不存在** → Task 13/14/15 |

### Task 12：preload / 白名单 —— 四个新方法 + 计数 13→17

> 一句话：把 Task 11 加进 `RendererApi` 的四个方法在 **preload 白名单工厂**里落地，并把 `renderer-api.test.ts` 的**字面量计数**从 13 推到 17（波 2 后值）。本任务**不装配主进程 handler**，理由与「能绿到什么程度」全部写进 Interfaces 末尾的口径表，不留占位。

**Files:**

- Modify：`apps/desktop/src/preload/renderer-api.ts`
  - import 块第 1–8 行
  - `createRendererApi` 工厂体第 32–49 行（`proposalDiff` 在第 43 行、`providerView` 第 44 行、`providerSave` 第 45 行、`onAgentEvent` 第 46–47 行）
  - `createIpcOn`（第 24–30 行）**一字不动**
- Modify：`apps/desktop/src/preload/renderer-api.test.ts`
  - import 块第 1–11 行；首个用例里的内联 `api.startTurn({...})` 第 35 行；大用例标题第 64 行；`startInput` 夹具第 75–80 行；调用序列第 88–99 行；**字面量计数第 101 行**；通道名数组第 104–117 行；args 数组第 118–131 行；注释里的「12/13 个方法」第 132 行；方法名数组第 133–146 行
- **不在本任务改动**（Step 7 逐条说明为什么可以不动还过 tsc）：`apps/desktop/src/main/agent-ipc.ts:14-21`、`apps/desktop/src/main/index.ts:62-63`、`apps/desktop/src/main/agent-service.ts:381`、`apps/desktop/src/preload/index.ts`（它只是把工厂产物交给 `contextBridge`，键集合自动跟着变，无需改）、`apps/desktop/src/main/agent-ipc.test.ts`（白名单断言测的是 `registerAgentIpc` 注册了哪四条通道，本任务不新增注册，那条用例继续绿）。

**Interfaces:**

- Consumes：
  - `IPC_CHANNELS` 的四个新键与 `RendererApi` 的四个新方法——**全部来自 Task 11 已落地的 `packages/contracts/src/ipc.ts`**，逐字签名（照接口总表波 2，不得改名/改参数顺序）：
    - `contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;`
    - `listProfiles(): Promise<ProfileView[]>;`
    - `appearanceView(): Promise<AppearanceSettingsSnapshot>;`
    - `saveAppearance(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;`
  - 类型 `ContextPreviewInput` / `AppearanceSettings` 从 `@mochen/contracts` import（`packages/contracts/src/context.ts`、`packages/contracts/src/appearance.ts:214`，`appearance.ts` 是现仓既有文件，本任务不新建外观类型）。
  - 既有窄接口 `Invoke`（`renderer-api.ts:10`）与 `On`（第 11 行）——四个新方法只走 `invoke`，不碰 `on`。
- Produces：
  - `createRendererApi(invoke, on)` 的产物键集合从 13 个变成 17 个，**一一对应 `IPC_CHANNELS` 的 17 个键**（`agentEvent` 走 `on`，其余 16 条走 `invoke`）。渲染层能拿到的面 = 这 17 个方法，`ipcRenderer` 依旧一个字都不泄漏。
  - `renderer-api.test.ts` 的三处字面量计数值 = **17**（用例标题 1 处、`calls.length` 1 处、注释 1 处），三个期望数组各 17 项。

- [ ] **Step 1：先复现并记录 Task 11 留下的红（这一步是切分依据，不是走过场）**

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json`
Expected: **恰好两类红，且只红 preload 两个文件**（`tsconfig.node.json` 的 `include` 是 `["src/main", "src/preload"]`，所以 src/main 那批夹具已在 Task 11 补完）：

```
src/preload/renderer-api.ts(33,3): error TS2739: Type '{ pickBookDirectory: () => Promise<never>; ... }' is missing the following properties from type 'RendererApi': contextPreview, listProfiles, appearanceView, saveAppearance
src/preload/renderer-api.test.ts(35,23): error TS2345: Argument of type '{ threadKey: string; docRelPath: string; stageId: string; userText: string; }' is not assignable to parameter of type '{ threadKey: string; docRelPath: string | null; stageId: string; profileId: string; userText: string; }'.
  Property 'profileId' is missing in type ...
```

行号会因波 1 落地时插入的行数略有浮动，**报错种类必须就是这两条**；若冒出 `src/main/**` 的红，说明 Task 11 的连带漏了文件——回去补 Task 11，别在本任务里偷偷改。

- [ ] **Step 2：先写会红的测试（把大用例推到 17，并新增两条专用用例）**

`apps/desktop/src/preload/renderer-api.test.ts`：第 1–11 行 import 块替换为：

```ts
import { describe, expect, it } from "vitest";
import {
  createDefaultAppearanceSettings,
  IPC_CHANNELS,
  type AgentOutbound,
  type AppearanceSettings,
  type BookMeta,
  type ContextPreviewInput,
  type DecideInput,
  type ProviderDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";
import { createIpcOn, createRendererApi } from "./renderer-api.js";
```

第 35 行（首个用例里的内联入参）补 `profileId`：

```ts
    await api.startTurn({
      threadKey: "a",
      docRelPath: "a",
      stageId: "draft",
      profileId: "",
      userText: "改"
    });
```

把第 63–147 行那条大用例**整条替换**为下面这条（标题、调用序列、三个期望数组、注释全部同步到 17；`loadSession` 保持在 agent 方法相邻的位置）：

```ts
  it("17 个方法各调一次：通道与参数逐条钉死（期望值全是字面量，不从 IPC_CHANNELS 派生）", async () => {
    const { api, calls } = harness();
    const meta: BookMeta = {
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: "read-only",
      chapterOrder: []
    };
    const startInput: StartTurnInput = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      profileId: "",
      userText: "改紧一点"
    };
    const previewInput: ContextPreviewInput = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      profileId: "writer",
      skillPaths: ["mochen-suspense/SKILL.md"]
    };
    const appearance: AppearanceSettings = createDefaultAppearanceSettings();
    const decideInput: DecideInput = { proposalId: "p-1", decision: "cancel", guidance: "" };
    const draft: ProviderDraft = {
      baseURL: "http://127.0.0.1:8787/v1",
      model: "深渊-8B",
      apiKey: null
    };

    await api.pickBookDirectory();
    await api.openBook("/book");
    await api.saveMeta(meta);
    await api.readDoc("chapters/01-开局.md");
    await api.writeDoc("chapters/01-开局.md", "正文", "fp-1");
    await api.startTurn(startInput);
    await api.interruptTurn("t-1");
    await api.decideProposal(decideInput);
    await api.proposalDiff("p-1");
    await api.loadSession("chapters/01-开局.md");
    await api.contextPreview(previewInput);
    await api.listProfiles();
    await api.providerView();
    await api.providerSave(draft);
    await api.appearanceView();
    await api.saveAppearance(appearance);
    api.onAgentEvent(() => {});

    expect(calls.length).toBe(17);
    // 通道名必须逐字面量列出来：拿 IPC_CHANNELS 当期望值等于用被测常量证明被测常量本身，
    // 那种断言永不失败——把 openBook 改打到 doc:read 它照样绿。
    expect(calls.map((call) => call.channel)).toEqual([
      "book:pick",
      "book:open",
      "book:save-meta",
      "doc:read",
      "doc:write",
      "agent:start-turn",
      "agent:interrupt",
      "agent:decide",
      "agent:diff",
      "agent:load-session",
      "agent:context-preview",
      "profile:list",
      "provider:get",
      "provider:save",
      "appearance:get",
      "appearance:save",
      "agent:event"
    ]);
    expect(calls.map((call) => call.args)).toEqual([
      [],
      ["/book"],
      [meta],
      ["chapters/01-开局.md"],
      ["chapters/01-开局.md", "正文", "fp-1"],
      [startInput],
      ["t-1"],
      [decideInput],
      ["p-1"],
      ["chapters/01-开局.md"],
      [previewInput],
      [],
      [],
      [draft],
      [],
      [appearance],
      ["subscribe"]
    ]);
    // 渲染层只拿到这 17 个方法：invoke/on/ipcRenderer 一个字都不许泄漏成键。
    expect(Object.keys(api).sort()).toEqual([
      "appearanceView",
      "contextPreview",
      "decideProposal",
      "interruptTurn",
      "listProfiles",
      "loadSession",
      "onAgentEvent",
      "openBook",
      "pickBookDirectory",
      "proposalDiff",
      "providerSave",
      "providerView",
      "readDoc",
      "saveAppearance",
      "saveMeta",
      "startTurn",
      "writeDoc"
    ]);
  });
```

在同一条 `describe("createRendererApi", ...)` 里（上面那条大用例之后）追加两条专用用例——第一条钉「参数原样透传」，第二条钉「四个新方法确实出现在白名单工厂产物里」：

```ts
  it("contextPreview 走 agent:context-preview 通道，入参对象原样透传（不重组、不裁剪、不加字段）", async () => {
    const { api, calls } = harness();
    const input: ContextPreviewInput = {
      threadKey: "chapters/01-开局.md",
      docRelPath: null,
      stageId: "draft",
      profileId: "",
      skillPaths: []
    };
    await api.contextPreview(input);
    expect(calls.length).toBe(1);
    expect(calls[0]?.channel).toBe(IPC_CHANNELS.agentContextPreview);
    // 同一个引用：预览是只读通道，preload 一旦在这里重组入参，主进程算出来的占用条就跟渲染层显示的不是同一轮。
    expect(calls[0]?.args).toEqual([input]);
    expect(calls[0]?.args[0]).toBe(input);
  });

  it("波 2 四个新方法都在白名单工厂产物里，且都是函数", () => {
    const { api } = harness();
    for (const name of ["contextPreview", "listProfiles", "appearanceView", "saveAppearance"] as const) {
      expect(typeof api[name]).toBe("function");
    }
  });
```

- [ ] **Step 3：跑到红**

Run: `corepack pnpm vitest run apps/desktop/src/preload/renderer-api.test.ts --maxWorkers=4`
Expected: FAIL，三条转红（工厂还没这四个方法 ⇒ 运行期取到 `undefined`）：

```
 FAIL  apps/desktop/src/preload/renderer-api.test.ts > createRendererApi > 17 个方法各调一次：通道与参数逐条钉死（期望值全是字面量，不从 IPC_CHANNELS 派生）
TypeError: api.contextPreview is not a function
 FAIL  apps/desktop/src/preload/renderer-api.test.ts > createRendererApi > contextPreview 走 agent:context-preview 通道，入参对象原样透传（不重组、不裁剪、不加字段）
TypeError: api.contextPreview is not a function
 FAIL  apps/desktop/src/preload/renderer-api.test.ts > createRendererApi > 波 2 四个新方法都在白名单工厂产物里，且都是函数
AssertionError: expected 'undefined' to be 'function'
```

- [ ] **Step 4：实现 preload 工厂（四个新方法）**

`apps/desktop/src/preload/renderer-api.ts`：第 1–8 行 import 块替换为：

```ts
import {
  IPC_CHANNELS,
  type AgentOutbound,
  type AppearanceSettings,
  type DecideInput,
  type ProviderDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";
```

（`ContextPreviewInput` / `ContextSummary` / `ProfileView` / `AppearanceSettingsSnapshot` 都不必 import：入参由 `RendererApi` 上下文推断，返回值是 `Promise<never>` 直接兼容。少 import 一个就少一处漂移。）

第 32–49 行的 `createRendererApi` 整块替换为（波 1 的 `loadSession` 保持在 `proposalDiff` 之后；四个新方法按「agent 相邻 / 设置相邻」插进去）：

```ts
export function createRendererApi(invoke: Invoke, on: On): RendererApi {
  return {
    pickBookDirectory: () => invoke(IPC_CHANNELS.bookPick),
    openBook: (rootPath) => invoke(IPC_CHANNELS.bookOpen, rootPath),
    saveMeta: (meta) => invoke(IPC_CHANNELS.bookSaveMeta, meta),
    readDoc: (relPath) => invoke(IPC_CHANNELS.docRead, relPath),
    writeDoc: (relPath, content, expectedFingerprint) =>
      invoke(IPC_CHANNELS.docWrite, relPath, content, expectedFingerprint),
    startTurn: (input: StartTurnInput) => invoke(IPC_CHANNELS.agentStartTurn, input),
    interruptTurn: (turnId) => invoke(IPC_CHANNELS.agentInterrupt, turnId),
    decideProposal: (input: DecideInput) => invoke(IPC_CHANNELS.agentDecide, input),
    proposalDiff: (proposalId) => invoke(IPC_CHANNELS.agentDiff, proposalId),
    loadSession: (threadKey) => invoke(IPC_CHANNELS.agentLoadSession, threadKey),
    // 只读预览：入参整个递过去，preload 不替主进程做业务判断，占用条算错也是主进程的事。
    contextPreview: (input) => invoke(IPC_CHANNELS.agentContextPreview, input),
    listProfiles: () => invoke(IPC_CHANNELS.profileList),
    providerView: () => invoke(IPC_CHANNELS.providerGet),
    providerSave: (draft: ProviderDraft) => invoke(IPC_CHANNELS.providerSave, draft),
    appearanceView: () => invoke(IPC_CHANNELS.appearanceGet),
    saveAppearance: (settings: AppearanceSettings) => invoke(IPC_CHANNELS.appearanceSave, settings),
    onAgentEvent: (listener) =>
      on(IPC_CHANNELS.agentEvent, (payload) => listener(payload as AgentOutbound))
  };
}
```

文件行数：49 → 55 行，远低于 800 行门禁（`tools/check-source-line-budget.mjs`）。

- [ ] **Step 5：跑到绿并收口 Task 11 的残留红**

Run: `corepack pnpm vitest run apps/desktop/src/preload/renderer-api.test.ts --maxWorkers=4`
Expected: PASS（较之前 +2 用例；大用例仍在，只是从 13 推到 17）。
Run: `corepack pnpm prettier --write apps/desktop/src/preload && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json`
Expected: prettier 列出被改的两个文件；**tsc 无诊断**——Step 1 那两类红全部消失。这就是本任务与 Task 11 的接缝闭合处。

- [ ] **Step 6：变异实验（两条，证明新计数与新通道不是空断言）**

1. 用 Edit 把 `renderer-api.ts` 里 `contextPreview` 的通道从 `IPC_CHANNELS.agentContextPreview` 改成 `IPC_CHANNELS.agentLoadSession`（模拟「复用了隔壁通道」）。
   Run: `corepack pnpm vitest run apps/desktop/src/preload/renderer-api.test.ts --maxWorkers=4`
   Expected: 两条转红——大用例的通道名数组对不上（`agent:load-session` 出现在第 11 位），专用用例报 `AssertionError: expected 'agent:load-session' to be 'agent:context-preview'`。**改回来。**
2. 用 Edit 把大用例里 `expect(calls.length).toBe(17)` 之外的三个数组**之一**删掉一项（例如去掉 `"profile:list",`），跑同一条命令。
   Expected: 该用例转红（长度与内容双重不符）。这条是在证明「17 不是只写在一个地方的孤数」——三处字面量彼此校验。**改回来。**
   跑完还原，再执行一次 Step 5 的命令确认回绿。

- [ ] **Step 7：连带口径——为什么主进程 handler 不在本任务，以及本任务能绿到什么程度**

**结论：本任务不动 `src/main/` 一行，且这不是偷懒，是被依赖卡住的唯一切法。**

- `agent:context-preview` 的 handler 只能写成 `service.contextPreview(input)`；而 `AgentService.contextPreview()` 来自接口总表的 **Task 15**（它要 `buildContextPack` / `contextSummaryOf`，那些在 **Task 13/14** 的 `packages/agent-runtime`）。此刻 `AgentService`（`apps/desktop/src/main/agent-service.ts`）上根本没有这个成员，写出来就是 tsc 红。
- `profile:list` 的 handler 只能回 `profileViews()`，roster 在 **Task 13**，同样不存在。
- `appearance:get` / `appearance:save` 需要 `createAppearanceSettings({ dir, readFile?, writeFile? })`（`apps/desktop/src/main/appearance-settings.ts`，随**主题三态那条任务线**落地）。
- 想「先注册一个回空数组的假 handler」把通道打通——**禁止**：那会让渲染层在 Task 18 接线时读到一份看起来很正常、其实永远为空的档案表，比红着更难查；也直接违反「禁占位」。
- 装配点在后续任务里各有归属，逐条点名（不是「以后再说」）：`agent:load-session` **波 1 的 Task 3 已经注册**进 `registerAgentIpc`（`apps/desktop/src/main/agent-ipc.ts:14-21`，那时长到五条）；`profile:list` 随 **Task 15** 的新导出 `registerProfileIpc`（同文件）；`agent:context-preview` 随 **Task 16** 再进 `registerAgentIpc`（六条）；`appearance:get` / `appearance:save` 随 **Task 19** 的新导出 `registerAppearanceIpc`（同样落在 `agent-ipc.ts`，在 `main/index.ts` 里装配）。`agent-ipc.test.ts` 里「注册了哪几条通道」的白名单断言在 Task 3 / 16 各自同任务推进，**本任务不预支**。
- **中间这段窗口期安全吗？** 安全：四个方法在 Task 12 之后只是「渲染层拿得到、调了会报 No handler registered」，而渲染层此时**没有任何消费方**——档案装载/占用条在 Task 18 与 Task 20 才接进 `useAgentStore`/`ProfilePicker.vue`。全局无任何自动化用例会去打这四条通道（本仓不引 `@vue/test-utils`，模板层零覆盖；`renderer-api.test.ts` 用的是假 `invoke`，不碰真 ipcMain）。

**本任务的绿口径（装配者按此核对，别猜）**

| 项 | 本任务后 | 归谁 |
| --- | --- | --- |
| `renderer-api.ts` 工厂 17 个方法 | ✅ 绿 | 本任务 |
| `renderer-api.test.ts` 三处字面量 = 17 | ✅ 绿 | 本任务 |
| `tsc --noEmit -p apps/desktop/tsconfig.node.json`（含 src/main） | ✅ 无诊断（Task 11 的两类红在此收口） | 本任务 |
| `IPC_CHANNELS` 17 键 / `RendererApi` 17 方法 | ✅ 已由 Task 11 落地 | Task 11 |
| 四条通道的 ipcMain handler | ❌ 未注册（渲染层此时无消费方） | `profile:list` → Task 15、`agent:context-preview` → Task 16、`appearance:*` → Task 19 |
| `AgentService.contextPreview()`、`profileViews()`、roster、`ContextReader` | ❌ 不存在 | Task 13 / 14 / 15 |
| 渲染层 `listProfiles()` / `contextPreview()` 调用点、档案装载、占用条 | ❌ 未接线 | Task 18 / 20 |
| 波 3 的 `skillsList` / `skillsRead`（17 → 19） | ❌ 不做 | 波 3 任务 |

- [ ] **Step 8：提交**

Run: `git log --oneline -8`
Expected: 仓库风格是 `type(scope): 中文描述`（HEAD 附近可见 `feat(contracts): ...`、`fix(renderer): ...`、`docs(plan2): ...`），据此写：

```bash
git add apps/desktop/src/preload/renderer-api.ts apps/desktop/src/preload/renderer-api.test.ts
git commit -m "feat(preload): 白名单工厂补四个波 2 方法，计数推到 17"
```

Expected: 提交成功；`git status --porcelain` 对 `apps/desktop/src/` 干净（本任务不新建文件）。

### Task 13：agent-runtime —— 六个智能体档案（roster、协议前缀与写入范围上限）

> 本任务把总 spec §5.1 的六档案花名册落成 `packages/agent-runtime/src/profiles.ts` 的**唯一一份 roster**：id/显示名/职责句/中文系统提示词/允许工具子集/写入范围上限 + `profileAllowsDoc` 判定。
> 工具名与档案视图**一律引用 Task 11 已落地的 contracts**（`AGENT_TOOL_NAMES`、`ProfileView`），本任务不新增任何契约类型、不新增工具、不碰主进程与渲染层。

> **执行顺序提示（本计划拍定，先读再做）**：Task 13 与 Task 14 是一对编译伴侣，依赖方向是**单向的 `profiles.ts → context-pack.ts`**（`context-pack.ts` 不 import `profiles.ts` 的任何符号，避免循环引用）。因为 `AgentProfile.buildSections` 的签名（接口总表逐字）引用 `ContextRequest`/`ContextReader`/`ContextSection` 三个类型，而这三型归 `context-pack.ts` 所有，所以**必须先完成并提交 Task 14，再动手本任务**。若你在 `context-pack.ts` 落地前打开本任务：停下，转去做 Task 14 章节，做完再回来。

**Files:**

- Create：`packages/agent-runtime/src/profiles.ts`
- Create：`packages/agent-runtime/test/profiles.test.ts`
- Modify：`packages/agent-runtime/src/index.ts`（现 10 行的 barrel，第 10 行 `export * from "./tool-loop.js";` 之后追加一行）
- 本任务不碰：`packages/agent-runtime/src/tools.ts`（`TOOL_SPECS` 第 42–82 行由调用方按档案过滤，M7 归 Task 16）、`packages/agent-runtime/src/permission.ts`（五目录天花板 `WRITABLE_TOP_DIRS` 在第 3–10 行，只引用不复制）、contracts 全部（Task 11 已落地）。

**Interfaces:**

- Consumes（全部现成，不新增 npm 依赖）：
  - `@mochen/contracts`（Task 11 已落地）：
    - `packages/contracts/src/tools.ts:1-8` 的 `AGENT_TOOL_NAMES` / `AgentToolName`——roster 里所有 `allowedTools` 都由它派生，**禁止手抄五个名字**（铁律 6）。
    - `packages/contracts/src/profile.ts` 的 `ProfileView`（`{ id, displayName, blurb, allowedTools }`，注意 `allowedTools` 是可变的 `AgentToolName[]`，从 roster 的 `readonly` 映射时要展开复制）。
    - `packages/contracts/src/context.ts` 的 `CONTEXT_SECTION_KINDS` / `ContextSectionKind`（本任务只在测试里用；产码里 `ContextSection.kind` 直接复用它，见 Task 14）。
  - `./context-pack.js`（**Task 14 已提交的产物**）：`buildContextPack`（值）与 `ContextReader` / `ContextRequest` / `ContextSection`（类型）。
  - 铁律来源（写提示词与断言时逐字回看，不要凭记忆）：Plan 3 spec §9.1 六档案表（`docs/superpowers/specs/2026-10-02-plan3-interaction-and-assembly-design.md:331-342`）与总 spec §5.1 花名册表（`docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md:133-155`，含三条约束：「同一章永远同一条线程」「新增第七个档案＝加一条配置」「范围是上限不是授权」）。
- Produces（逐字照接口总表波 2，不得改名/改参数顺序）：
  - `packages/agent-runtime/src/profiles.ts`：
    - `export interface AgentProfile { id: string; displayName: string; blurb: string; systemPrompt: string; allowedTools: readonly AgentToolName[]; writeScope: WriteScope; buildSections: (request: ContextRequest, reader: ContextReader) => Promise<ContextSection[]> }`
    - `export type WriteScope = { kind: "none" } | { kind: "current-chapter" } | { kind: "dirs"; dirs: readonly string[] };`
    - `export const AGENT_PROFILES: readonly AgentProfile[];`（六条，顺序＝总 spec §5.1：`world`、`chief-editor`、`character`、`writer`、`continuator`、`reviewer`）
    - `export const DEFAULT_PROFILE_ID = "writer";`
    - `export function profileById(id: string): AgentProfile | null;`
    - `export function profileViews(): ProfileView[];`（产物**不含 `systemPrompt`**——提示词永不进渲染层）
    - `export function profileAllowsDoc(scope: WriteScope, docRelPath: string, currentChapter: string | null): boolean;`
    - `export function withProtocolPrefix(profileSpecific: string): string;`（共用协议段唯一实现；`AgentProfile.systemPrompt` 全部由它产出。接口总表未列这个名字——这是本计划为「六份手抄协议就是违约」拍定的补充导出，Task 15/16 只消费 `systemPrompt` 成品，不需要它）
  - `packages/agent-runtime/src/index.ts`：追加 `export * from "./profiles.js";`（位置在 Task 14 加的 `export * from "./context-pack.js";` 之后）。
- **buildSections 的委托方向（本计划拍定，见共头「与 spec 的差异」第 1 条）**：六个档案的 `buildSections` 是**同一个函数引用** `delegateSections`——内部一步委托给 Task 14 的 `buildContextPack(reader, request)` 并取 `.sections`。不在 `profiles.ts` 里导出 `buildWriterSections` 之类的六份包装器，理由有三：①总 spec §5.1 约束 2 要求 runtime 里「没有任何六个智能体的硬编码分支」；②接口总表里 `buildContextPack` 的签名**没有 profile 参数**，`ContextRequest` 也只有 `docRelPath / chapterOrder / skillPaths` 三字段，没有任何可用来分叉的入参；③spec §9.1 侧重列里那些差异（各章摘要、未回收伏笔、文风规则、素材挂入）在本仓**没有数据源**，硬做就是凭空造节。档案之间的真实差异只落在 `systemPrompt` / `allowedTools` / `writeScope` 三处，这三处各有闸与用例（M6/M7）。测试用「六个引用全等」钉死这条委托——**若哪天真的分叉了，这条用例即红，改动必须连带重写本节差异条目**，这正是它存在的目的。

- [ ] **Step 1：先写会红的测试（`packages/agent-runtime/test/profiles.test.ts` 全文）**

风格照现仓 `packages/agent-runtime/test/permission.test.ts`（中文标题、`describe`/`it` 自 vitest、import 带 `.js` 后缀、定稿句用 `toBe`）。全文：

```ts
import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, CONTEXT_SECTION_KINDS, type AgentToolName } from "@mochen/contracts";
import {
  AGENT_PROFILES,
  DEFAULT_PROFILE_ID,
  profileAllowsDoc,
  profileById,
  profileViews,
  withProtocolPrefix,
  type WriteScope
} from "../src/profiles.js";
import type { ContextReader } from "../src/context-pack.js";

describe("AGENT_PROFILES 花名册", () => {
  it("六条档案，id 与显示名的顺序逐字对照总 spec §5.1 花名册", () => {
    expect(AGENT_PROFILES.map((profile) => profile.id)).toEqual([
      "world",
      "chief-editor",
      "character",
      "writer",
      "continuator",
      "reviewer"
    ]);
    expect(AGENT_PROFILES.map((profile) => profile.displayName)).toEqual([
      "墨宸 · 世界",
      "墨宸 · 总编",
      "墨宸 · 角色",
      "墨宸 · 主笔",
      "墨宸 · 续写",
      "墨宸 · 审稿"
    ]);
    for (const profile of AGENT_PROFILES) {
      expect(profile.blurb.trim().length).toBeGreaterThan(0);
      expect(profile.id).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it("每条档案的 allowedTools 都是五工具的去重子集，不许出现第六个名字", () => {
    for (const profile of AGENT_PROFILES) {
      expect(profile.allowedTools.length).toBeGreaterThan(0);
      for (const tool of profile.allowedTools) {
        expect(AGENT_TOOL_NAMES).toContain(tool as (typeof AGENT_TOOL_NAMES)[number]);
      }
      expect(new Set(profile.allowedTools).size).toBe(profile.allowedTools.length);
    }
  });

  it("continuator 与 reviewer 不含 write_doc；前四条含全部五工具（§9.1 表的硬闸）", () => {
    const withoutWrite = AGENT_TOOL_NAMES.filter((name) => name !== "write_doc");
    for (const id of ["continuator", "reviewer"]) {
      const allowed = profileById(id)?.allowedTools ?? [];
      expect([...allowed]).toEqual(withoutWrite);
      expect(allowed).not.toContain("write_doc" as AgentToolName);
      expect(allowed).toContain("propose_patch" as AgentToolName);
    }
    for (const id of ["world", "chief-editor", "character", "writer"]) {
      expect([...(profileById(id)?.allowedTools ?? [])]).toEqual([...AGENT_TOOL_NAMES]);
    }
  });

  it("writeScope 六条与 Plan 3 spec §9.1 表逐字对照（dirs 名取自五目录天花板）", () => {
    const scopes = Object.fromEntries(AGENT_PROFILES.map((p) => [p.id, p.writeScope]));
    expect(scopes.world).toEqual({ kind: "dirs", dirs: ["materials", "outline"] });
    expect(scopes["chief-editor"]).toEqual({ kind: "dirs", dirs: ["outline", "plot"] });
    expect(scopes.character).toEqual({ kind: "dirs", dirs: ["characters"] });
    expect(scopes.writer).toEqual({ kind: "current-chapter" });
    expect(scopes.continuator).toEqual({ kind: "current-chapter" });
    expect(scopes.reviewer).toEqual({ kind: "none" });
  });

  it("六份 systemPrompt 共用同一协议前缀：五工具清单与两代码块协议只此一份（铁律 6）", () => {
    const protocol = withProtocolPrefix("");
    for (const profile of AGENT_PROFILES) {
      expect(profile.systemPrompt.startsWith(protocol)).toBe(true);
      expect(profile.systemPrompt).toContain("mochen-patch");
      expect(profile.systemPrompt).toContain("mochen-plan");
      expect(profile.systemPrompt).toContain("永不直接写盘");
      expect(profile.systemPrompt).toContain("被用户拒绝的提案");
      // 协议段之后必须有档案专属正文（花名册职责句，非空）
      expect(profile.systemPrompt.slice(protocol.length).trim().length).toBeGreaterThan(0);
    }
    // 协议里的工具行派生自 AGENT_TOOL_NAMES——哪天有人手抄漏一个，这条先红
    expect(protocol).toContain(AGENT_TOOL_NAMES.join("、"));
  });
});

describe("profileAllowsDoc —— 范围是上限，不是授权", () => {
  const outlineScope: WriteScope = { kind: "dirs", dirs: ["outline"] };

  it("dirs：首层目录命中放行，其余目录与 book.json 拒绝", () => {
    expect(profileAllowsDoc(outlineScope, "outline/第一卷.md", null)).toBe(true);
    expect(profileAllowsDoc(outlineScope, "outline/sub/深一层.md", null)).toBe(true);
    expect(profileAllowsDoc(outlineScope, "chapters/01.md", null)).toBe(false);
    expect(profileAllowsDoc(outlineScope, "book.json", null)).toBe(false);
    expect(profileAllowsDoc(outlineScope, ".mochen/sessions/a.jsonl", null)).toBe(false);
  });

  it("dirs：路径穿越与畸形相对路径一律不命中（../outline/x.md 不是 outline）", () => {
    for (const evil of [
      "../outline/x.md",
      "outline/../chapters/01.md",
      "/outline/x.md",
      "outline//x.md",
      "./outline/x.md",
      "outline/./x.md"
    ]) {
      expect(profileAllowsDoc(outlineScope, evil, null)).toBe(false);
    }
  });

  it("current-chapter：只放行当前章本体；currentChapter 为 null 时恒 false", () => {
    const scope: WriteScope = { kind: "current-chapter" };
    expect(profileAllowsDoc(scope, "chapters/01.md", "chapters/01.md")).toBe(true);
    expect(profileAllowsDoc(scope, "chapters/02.md", "chapters/01.md")).toBe(false);
    expect(profileAllowsDoc(scope, "outline/x.md", "chapters/01.md")).toBe(false);
    expect(profileAllowsDoc(scope, "chapters/01.md", null)).toBe(false);
    expect(profileAllowsDoc(scope, "../chapters/01.md", "../chapters/01.md")).toBe(false);
  });

  it("none：恒 false（审稿档案永不放行任何文稿）", () => {
    const scope: WriteScope = { kind: "none" };
    expect(profileAllowsDoc(scope, "chapters/01.md", "chapters/01.md")).toBe(false);
    expect(profileAllowsDoc(scope, "outline/x.md", null)).toBe(false);
  });
});

describe("profileViews / profileById / buildSections 委托", () => {
  it("profileViews 产物只有四个键——systemPrompt 永不泄漏给渲染层", () => {
    const views = profileViews();
    expect(views.length).toBe(6);
    for (const view of views) {
      expect(Object.keys(view).sort()).toEqual(["allowedTools", "blurb", "displayName", "id"]);
      expect(view.allowedTools).toBeTypeOf("object");
    }
    expect(JSON.stringify(views)).not.toContain("mochen-patch");
    expect(JSON.stringify(views)).not.toContain("你是墨宸");
  });

  it("profileById：已知 id 返回 roster 本体，未知与空串返回 null；默认档是主笔", () => {
    expect(DEFAULT_PROFILE_ID).toBe("writer");
    expect(profileById("writer")).toBe(AGENT_PROFILES.find((p) => p.id === "writer"));
    expect(profileById("unknown")).toBeNull();
    expect(profileById("")).toBeNull();
  });

  it("六个 buildSections 是同一个委托引用（roster 里不许有档案分支）", () => {
    for (const profile of AGENT_PROFILES) {
      expect(profile.buildSections).toBe(AGENT_PROFILES[0].buildSections);
    }
  });

  it("委托冒烟：假 reader 下 buildSections 产出 kinds 合法、label 查 contracts 表的节数组", async () => {
    const docs = [
      { relPath: "chapters/01.md", kind: "chapter", title: "第一章" },
      { relPath: "outline/第一卷.md", kind: "outline", title: "第一卷" },
      { relPath: "characters/沈砚.md", kind: "character", title: "沈砚" }
    ] as const;
    const reader: ContextReader = {
      listDocs: () => docs.map((d) => ({ ...d })),
      readDoc: async (relPath) => (relPath === "chapters/01.md" ? "第一章正文。" : `正文：${relPath}`),
      charactersOf: async () => ["沈砚"]
    };
    const sections = await profileById("writer")!.buildSections(
      { docRelPath: "chapters/01.md", chapterOrder: ["chapters/01.md"], skillPaths: [] },
      reader
    );
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(CONTEXT_SECTION_KINDS).toContain(section.kind);
      expect(section.text.length).toBeGreaterThan(0);
    }
  });
});
```

> `docs` 里的 `kind` 字面量满足 `BookKind`（`packages/contracts/src/book.ts:4`），`listDocs` 返回 `DocRef[]`（`book.ts:22-26`：`relPath/kind/title` 三键）。若 tsc 对 `as const` 的窄化不满意，改成 `const docs: DocRef[] = [...]` 并 `import type { DocRef } from "@mochen/contracts";`——二选一，以跑绿且零 `any` 为准。

- [ ] **Step 2：跑到红**

Run: `corepack pnpm vitest run packages/agent-runtime/test/profiles.test.ts --maxWorkers=4`
Expected: FAIL——整个文件在导入期就炸（`profiles.ts` 还不存在），形如：

```
Error: Failed to load ../src/profiles.js ... Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

（红源必须是「模块不存在」而不是断言失败。前提：`../src/context-pack.js` 已由 Task 14 落地，否则先回 Step 前的执行顺序提示。）

- [ ] **Step 3：实现 `packages/agent-runtime/src/profiles.ts`（全文落盘）**

```ts
import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
  type ProfileView
} from "@mochen/contracts";
import {
  buildContextPack,
  type ContextReader,
  type ContextRequest,
  type ContextSection
} from "./context-pack.js";

/**
 * 六档案 roster：总 spec §5.1 花名册的唯一代码化。
 * 新增第七个档案＝在 AGENT_PROFILES 加一条数据，不改本文件任何逻辑（§5.1 约束 2）。
 * 本包禁止 import electron 与 node:fs——文稿读取一律走注入的 ContextReader（Task 14/15）。
 */

/** 档案的写入范围上限。注意：这是上限不是授权，实际落盘仍过三档权限与逐条审批（§5.1 约束 3）。 */
export type WriteScope =
  | { kind: "none" }
  | { kind: "current-chapter" }
  | { kind: "dirs"; dirs: readonly string[] };

export interface AgentProfile {
  id: string;
  displayName: string;
  blurb: string;
  /** 中文系统提示词：共用协议段（唯一一份）+ 档案专属职责。永不跨 IPC 进渲染层。 */
  systemPrompt: string;
  /** 五工具的子集；由 AGENT_TOOL_NAMES 派生，禁止手抄名单（铁律 6）。 */
  allowedTools: readonly AgentToolName[];
  writeScope: WriteScope;
  /** 委托给 context-pack 的统一构造器；档案间差异经 ContextRequest 表达，不在这里分叉。 */
  buildSections: (request: ContextRequest, reader: ContextReader) => Promise<ContextSection[]>;
}

export const DEFAULT_PROFILE_ID = "writer";

/**
 * 所有档案共用的协议段——只此一份（六份手抄就是违约）。
 * 工具名单动态取自 AGENT_TOOL_NAMES；两个文本块协议与「永不直接写盘」「拒绝即保留」逐字照 Plan 3 spec §9 与总 spec §6。
 */
export function withProtocolPrefix(profileSpecific: string): string {
  const protocol = [
    "你是墨宸 AI 写作工作台中的智能体，与用户并肩打磨一部长篇作品。以下协议对所有墨宸档案同样生效：",
    `1. 工具只有 ${AGENT_TOOL_NAMES.length} 个：${AGENT_TOOL_NAMES.join("、")}。以本次请求实际附带的 tools 清单为准，清单外的名字不存在。`,
    "2. 模型永不直接写盘：要改文稿就产出「提案」——输出 ```mochen-patch``` 代码块（JSON 字段 doc/anchor/replace/why，anchor 必须是文中唯一的逐字原文），" +
      "或调用 propose_patch / write_doc 工具；两条通路都只是提案，只有用户逐条批准后才落盘。",
    "3. 需要给出整卷/整章的结构化规划或大纲时，把内容放进 ```mochen-plan``` 代码块。",
    "4. 被用户拒绝的提案会原样留在卡片上：那不是失败。请依据用户反馈修正后重新提案，禁止原样重复。",
    "5. 所有面向用户的文字（说明、理由、批注）一律使用简体中文。"
  ].join("\n");
  return `${protocol}\n\n${profileSpecific.trim()}\n`;
}

const ALL_TOOLS: readonly AgentToolName[] = [...AGENT_TOOL_NAMES];
/** 续写与审稿的硬闸：没有 write_doc，只剩 propose_patch 一条写通路。 */
const NO_WRITE_DOC_TOOLS: readonly AgentToolName[] = AGENT_TOOL_NAMES.filter(
  (name) => name !== "write_doc"
);

const delegateSections: AgentProfile["buildSections"] = (request, reader) =>
  buildContextPack(reader, request).then((pack) => pack.sections);

export const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    id: "world",
    displayName: "墨宸 · 世界",
    blurb: "世界观构建：设定、地理、规则、势力。",
    systemPrompt: withProtocolPrefix(`你的职责：世界观构建——设定、地理、规则、势力。
- 维护范围在 materials/ 与 outline/：新设定先进素材库，大纲只在留空处补位。
- 不装配整章正文；chapters/ 里的正文仅作佐证引用。
- 新增设定先 list_docs / search_docs 核对既有世界观，发现矛盾就列证据，再给修正提案。
- 设定提案的 why 要写明与哪些既有条目衔接或冲突。`),
    allowedTools: ALL_TOOLS,
    writeScope: { kind: "dirs", dirs: ["materials", "outline"] },
    buildSections: delegateSections
  },
  {
    id: "chief-editor",
    displayName: "墨宸 · 总编",
    blurb: "剧情规划：卷章节奏、冲突布置、伏笔登记。",
    systemPrompt: withProtocolPrefix(`你的职责：剧情规划——卷章节奏、冲突布置、伏笔登记。
- 维护范围在 outline/ 与 plot/：人物与正文的细节问题移交对应档案，不要越范围改写。
- 伏笔必须登记：埋在哪一章、计划何处回收；失联或该收未收的要点名指出来。
- 排布整卷/整章结构时用 ```mochen-plan``` 代码块给出规划，落盘前逐条过审批。
- 决策依据写进 why：让读者三章后仍看得懂这一手布局。`),
    allowedTools: ALL_TOOLS,
    writeScope: { kind: "dirs", dirs: ["outline", "plot"] },
    buildSections: delegateSections
  },
  {
    id: "character",
    displayName: "墨宸 · 角色",
    blurb: "人物塑造：动机、口吻、关系网。",
    systemPrompt: withProtocolPrefix(`你的职责：人物塑造——动机、口吻、关系网。
- 维护范围在 characters/：人物卡是唯一权威源，卡随剧情推进要更新。
- 正文里发现人物口吻走形，只出批注式提案指给主笔，不代写正文、不越范围改 chapters/。
- 动卡之前先读该人物出场的章节原文，改完在卡上可追溯：依据出自哪一章。`),
    allowedTools: ALL_TOOLS,
    writeScope: { kind: "dirs", dirs: ["characters"] },
    buildSections: delegateSections
  },
  {
    id: "writer",
    displayName: "墨宸 · 主笔",
    blurb: "正文创作：按大纲起稿当前章。",
    systemPrompt: withProtocolPrefix(`你的职责：正文创作——按大纲起稿当前章。
- 以装配好的上下文为准：本章、大纲摘要、出场人物、前情与各显式挂入项；不擅自新增未登记的人物与设定。
- 写入范围以当前章为限：改前文用 ```mochen-patch``` 提案，新建/整篇覆盖当前章用 write_doc 提案，都要用户批准。
- 交稿前自查三件事：与大纲是否冲突、与前情是否断裂、人物是否走形。`),
    allowedTools: ALL_TOOLS,
    writeScope: { kind: "current-chapter" },
    buildSections: delegateSections
  },
  {
    id: "continuator",
    displayName: "墨宸 · 续写",
    blurb: "长篇续写：顺着已写文本往下走，保口吻与伏笔。",
    systemPrompt: withProtocolPrefix(`你的职责：长篇续写——顺着已写文本往下走，保住口吻与伏笔。
- 你的默认动作是「追加」：新内容接在本章尾部；要改前文必须另起一条独立提案，不与续写混在一起。
- 你没有 write_doc 工具：一切改动都走 propose_patch 或 ```mochen-patch``` 代码块。
- 续写前先核对前情与未回收伏笔，能自然接上的接上，接不上的向用户说明而不是硬绕。
- 视角、称谓、句式节奏延续已写文本，不轻易起调。`),
    allowedTools: NO_WRITE_DOC_TOOLS,
    writeScope: { kind: "current-chapter" },
    buildSections: delegateSections
  },
  {
    id: "reviewer",
    displayName: "墨宸 · 审稿",
    blurb: "逻辑与文风检查：矛盾、节奏漂移、口吻走形；只出批注式提案。",
    systemPrompt: withProtocolPrefix(`你的职责：逻辑与文风检查——矛盾、节奏漂移、口吻走形。
- 你只出批注式提案，永不写盘：你没有 write_doc，writeScope 是 none，也不要要求用户「直接替你改」。
- 每条批注指到具体锚点（文中唯一逐字原文），why 里写清问题类型、证据出处与严重度。
- 检查顺序：设定矛盾 > 人物走形 > 节奏漂移 > 文风格式。
- 拿不准是否算矛盾时列为疑点问用户，不猜。`),
    allowedTools: NO_WRITE_DOC_TOOLS,
    writeScope: { kind: "none" },
    buildSections: delegateSections
  }
];

export function profileById(id: string): AgentProfile | null {
  return AGENT_PROFILES.find((profile) => profile.id === id) ?? null;
}

/** 渲染层视图：只交四个展示键。systemPrompt 与 buildSections 绝不进这个形状。 */
export function profileViews(): ProfileView[] {
  return AGENT_PROFILES.map((profile) => ({
    id: profile.id,
    displayName: profile.displayName,
    blurb: profile.blurb,
    allowedTools: [...profile.allowedTools]
  }));
}

/** 相对路径的分段校验：含 ""、"."、".." 的任何一段都视为畸形/穿越，直接判死。 */
function pathSegments(relPath: string): string[] | null {
  const segments = relPath.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
    ? segments
    : null;
}

/**
 * 档案范围闸（审批侧第二道闸的判据，Task 17 接线）：
 * scope 只是上限——档位闸（permission.ts）与逐条审批仍然在前。任何一条判不出来就 false。
 */
export function profileAllowsDoc(
  scope: WriteScope,
  docRelPath: string,
  currentChapter: string | null
): boolean {
  if (scope.kind === "none") return false;
  const segments = pathSegments(docRelPath);
  if (segments === null) return false;
  if (scope.kind === "current-chapter") {
    return (
      currentChapter !== null &&
      docRelPath === currentChapter &&
      pathSegments(currentChapter) !== null
    );
  }
  return (scope.dirs as readonly string[]).includes(segments[0]);
}
```

- [ ] **Step 4：barrel 追加**

用 Edit 在 `packages/agent-runtime/src/index.ts` 末尾（Task 14 已加的 `export * from "./context-pack.js";` 之后）追加：

```ts
export * from "./profiles.js";
```

- [ ] **Step 5：跑到绿 + 本包 tsc/prettier**

Run: `corepack pnpm vitest run packages/agent-runtime/test/profiles.test.ts --maxWorkers=4`
Expected: PASS（13 用例全绿，`Test Files 1 passed (1)`）。
Run: `corepack pnpm vitest run packages/agent-runtime --maxWorkers=4`
Expected: PASS——`profiles`/`context-pack`/`permission`/`tools` 等本包全部既有测试一起绿。
Run: `corepack pnpm prettier --write packages/agent-runtime && corepack pnpm tsc --noEmit -p packages/agent-runtime/tsconfig.json && node tools/check-package-boundary.mjs`
Expected: prettier 列出被格式化的文件名；tsc 无诊断；boundary 打印通过（`profiles.ts` 没有 import electron/`node:fs`）。

- [ ] **Step 6：连带清单**

1. `index.ts` barrel 两行的顺序：`context-pack.js` 在前（Task 14 落的）、`profiles.js` 在后（本任务）；barrel 顺序不影响 tsc，但保持「被依赖者在前」可读性。
2. `ProfileView.allowedTools` 是可变数组（`packages/contracts/src/profile.ts`，Task 11 落地）——`profileViews()` 里 `[...profile.allowedTools]` 的复制不许省，防止调用方原地排序污染 roster。
3. 消费方在后续任务：`profile:list` 注册与 fs 版 `ContextReader` 是 Task 15；`promptFor` 异步化删 `defaultPromptFor` 是 Task 16（M7 归属地）；审批档案闸 `profileAllowsDoc` 接线是 Task 17（M6 归属地）。本任务只交函数，不接任何线。
4. 本任务不动 `TOOL_SPECS`：按档案过滤发生在请求侧（Task 16），roster 里只存名字子集。
5. 六份提示词是**回喂模型的用户可见中文**——之后任何任务改协议段，只改 `withProtocolPrefix` 一处；任何任务在别处复制协议句，`profiles.test.ts` 的 `startsWith(protocol)` 用例不保，评审保（写进本任务评审关注点）。

- [ ] **Step 7：提交（先 `git log --oneline -8` 对照仓库风格再落 message）**

```
git add packages/agent-runtime/src/profiles.ts packages/agent-runtime/test/profiles.test.ts packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): 六档案 roster、共用协议前缀与写入范围上限判定"
```

Expected: `git status` 干净（除本任务 Files 里列出的文件外无残留改动）；本任务不 push。

### Task 14：agent-runtime —— 上下文包（context-pack：读取注入、码点尾部切片与预算整节丢弃）

> 本任务落 `packages/agent-runtime/src/context-pack.ts`：按 Plan 3 spec §9.3 把「本章 / 大纲 / 出场人物 / 前情 / 挂入技能」装配成分节上下文包，尾部切片按**码点**、超预算从**尾部整节丢弃**（绝不半句截断），并导出 `contextSummaryOf` 给主进程转发成 contracts 的 `ContextSummary`。
> 本包禁止 import `electron` 与 `node:fs`——盘上读取全部走注入的 `ContextReader`（fs 版实现是 Task 15 的 `createFsContextReader`，出场人物两路命中也在主进程算）。

> **执行顺序提示（本计划拍定）**：Task 13/14 是一对编译伴侣，依赖方向单向 `profiles.ts → context-pack.ts`。本任务不 import `profiles.ts` 的任何符号，因此**波 2 从本任务开始做**：本任务提交后，Task 13（roster）才能编译过 tsc。Task 13 章节里的委托测试在此之后才有意义。

**Files:**

- Create：`packages/agent-runtime/src/context-pack.ts`
- Create：`packages/agent-runtime/test/context-pack.test.ts`
- Modify：`packages/agent-runtime/src/index.ts`（现 10 行的 barrel，第 10 行 `export * from "./tool-loop.js";` 之后追加一行）
- 本任务不碰：contracts（`CONTEXT_SECTION_KINDS`/`CONTEXT_SECTION_KIND_LABELS`/`ContextSummary` 已由 Task 11 落地）、`profiles.ts`（Task 13）、主进程与渲染层。

**Interfaces:**

- Consumes（全部现成，不新增 npm 依赖）：
  - `@mochen/contracts`（Task 11 已落地）：
    - `packages/contracts/src/context.ts` 的 `CONTEXT_SECTION_KINDS`（`["doc", "outline", "characters", "prev-chapters", "skills", "materials"]`）、`ContextSectionKind`、`CONTEXT_SECTION_KIND_LABELS`（doc:「本章正文」/ outline:「大纲」/ characters:「出场人物」/ prev-chapters:「前情摘要」/ skills:「挂入技能」/ materials:「素材」）、`ContextSummary`。
    - `packages/contracts/src/book.ts:22-26` 的 `DocRef`（`relPath/kind/title`）与 `:4` 的 `BookKind`。
  - 码点切片的现仓教训（本任务同法处理）：`apps/desktop/src/renderer/src/utils/timeline.ts:157-161`——「`slice(0,24)` 会把 emoji（代理对）劈成孤立高代理……`Array.from` 先拆成码点数组，截完再拼回，代理对要么整留要么整去」。
  - 本包 ts 基线：`packages/agent-runtime/tsconfig.json`  extends 根 `tsconfig.base.json`（现仓代码如 `permission.ts:24` 对索引访问一律 `?? 兜底`，即 `noUncheckedIndexedAccess` 在案——本文件的产码与测试都按此写，不用 `!` 断言）。
- Produces（逐字照接口总表波 2，不得改名/改参数顺序）：
  - `packages/agent-runtime/src/context-pack.ts`：
    - `export const PREVIOUS_CHAPTER_COUNT = 2;`
    - `export const PREVIOUS_CHAPTER_TAIL_CHARS = 400;`
    - `export const CONTEXT_CHAR_BUDGET = 24000;`
    - `export interface ContextReader { listDocs(): DocRef[]; readDoc(relPath: string): Promise<string | null>; charactersOf(relPath: string): Promise<string[]> }`
    - `export interface ContextRequest { docRelPath: string | null; chapterOrder: string[]; skillPaths: string[] }`
    - `export interface ContextSection { kind: ContextSectionKind; label: string; path?: string; text: string; truncated: boolean }`
    - `export interface ContextPack { sections: ContextSection[]; charCount: number; estimate: number; omitted: string[] }`
    - `export function estimateTokens(text: string): number;`（`Math.ceil(码点数 / 1.6)`）
    - `export async function buildContextPack(reader: ContextReader, request: ContextRequest): Promise<ContextPack>;`
    - `export function contextSummaryOf(pack: ContextPack): ContextSummary;`
  - `packages/agent-runtime/src/index.ts`：追加 `export * from "./context-pack.js";`（Task 13 会在其后再加 `profiles.js` 一行）。
- **本计划拍定的五处语义（Task 13/15/16 照此消费）**：
  1. `charactersOf(relPath)` 返回**出场人物文稿的相对路径列表**（`characters/*.md`）。章节 frontmatter `characters` 并上正文人物名命中（总 spec §5 的两路命中）由主进程实现（Task 15），runtime 只拿路径逐节 `readDoc`，不碰 fs、不再扫正文。返回顺序不定，本文件按路径升序排，保证装配确定性。
  2. `skillPaths` 逐项当相对路径交给 `readDoc`（fs 版 reader 负责解析到 `.mochen/skills/<名>/SKILL.md`；读不到返回 `null` ⇒ 本节跳过。「有 N 个挂入技能读不到」的可见 `error` 事件归装配层 Task 24，不在本层）。
  3. `label` 一律取 `CONTEXT_SECTION_KIND_LABELS[kind]` 查表逐字（铁律 6，与 Task 11 草稿「必须查这张表」对齐）。接口总表 §9.3 举的例标签「本章」「第 2 卷大纲」「出场人物 · 沈砚」是示意性中文；区分度由 `path` 承载，本层不自写第二套标签映射。
  4. `omitted` 记**被丢节的 `path ?? label`**（内置分节全部带 path）。这与总表「被丢的节名进 omitted」及 Task 11 测试夹具 `omitted: ["materials/雾.md"]` 的路径样式一致；占用条「已省略 N 节」只数长度，不解析内容。
  5. `materials` 节本片**不生成**：接口总表的 `ContextRequest` 没有素材挂入字段（素材显式挂入是波 3 的事），但 `CONTEXT_SECTION_KINDS` 的优先级位次（最后一位）保留，将来加字段即入队，不改丢弃算法。
  - 丢弃优先级 = `CONTEXT_SECTION_KINDS` 的**数组序本身**（`indexOf(kind)`，越大越先丢；同 kind 取装配序里靠后的），不另立第二张优先级表（铁律 6）。
  - `charCount` 与切片计数一律按**码点**（`Array.from(text).length`），与 `estimateTokens` 同一口径；`ContextPack.estimate = Math.ceil(charCount / 1.6)`，由内部单一函数 `tokensFromCodePoints` 产出。

- [ ] **Step 1：先写会红的测试（`packages/agent-runtime/test/context-pack.test.ts` 全文）**

假 reader 用内存 Map，风格照现仓 `packages/agent-runtime/test/tools.test.ts`（中文标题、`import` 带 `.js`、无 `any`）。全文：

```ts
import { describe, expect, it } from "vitest";
import { CONTEXT_SECTION_KIND_LABELS, CONTEXT_SECTION_KINDS, type DocRef } from "@mochen/contracts";
import {
  CONTEXT_CHAR_BUDGET,
  PREVIOUS_CHAPTER_COUNT,
  PREVIOUS_CHAPTER_TAIL_CHARS,
  buildContextPack,
  contextSummaryOf,
  estimateTokens,
  type ContextReader,
  type ContextRequest
} from "../src/context-pack.js";

function fakeReader(
  files: Record<string, string>,
  init: { docs?: DocRef[]; characters?: Record<string, string[]> } = {}
): ContextReader {
  const map = new Map(Object.entries(files));
  return {
    listDocs: () => [...(init.docs ?? [])],
    readDoc: async (relPath) => map.get(relPath) ?? null,
    charactersOf: async (relPath) => [...(init.characters?.[relPath] ?? [])]
  };
}

function docRef(relPath: string, kind: DocRef["kind"], title: string): DocRef {
  return { relPath, kind, title };
}

function makeRequest(over: Partial<ContextRequest>): ContextRequest {
  return { docRelPath: null, chapterOrder: [], skillPaths: [], ...over };
}

const FULL_BOOK = {
  "chapters/01.md": "第一章全文。".repeat(10),
  "chapters/02.md": "第二章全文。".repeat(10),
  "chapters/03.md": "第三章全文，本章正在写。".repeat(20),
  "outline/卷一.md": "第一卷大纲：起承转合。",
  "outline/序章.md": "序章大纲：钩子。",
  "characters/沈砚.md": "沈砚人物卡：克制、护短。",
  "characters/阿萤.md": "阿萤人物卡：跳脱。",
  ".mochen/skills/伏笔登记/SKILL.md": "技能：伏笔登记表格式。"
};
const FULL_DOCS = [
  docRef("outline/卷一.md", "outline", "卷一"),
  docRef("outline/序章.md", "outline", "序章"),
  docRef("characters/阿萤.md", "character", "阿萤"),
  docRef("chapters/03.md", "chapter", "第三章")
];

describe("context-pack 常量与 token 估算", () => {
  it("三常量逐字照 Plan 3 spec §9.3", () => {
    expect(PREVIOUS_CHAPTER_COUNT).toBe(2);
    expect(PREVIOUS_CHAPTER_TAIL_CHARS).toBe(400);
    expect(CONTEXT_CHAR_BUDGET).toBe(24000);
  });

  it("estimateTokens 按码点向上取整：两个 emoji 是 2 码点（按 UTF-16 码元会算成 3）", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("一二三四")).toBe(Math.ceil(4 / 1.6));
    expect(estimateTokens("😀😀")).toBe(2);
    expect(estimateTokens("😀😀")).not.toBe(Math.ceil(4 / 1.6));
  });
});

describe("buildContextPack 节序与缺失跳过", () => {
  it("节序 doc→outline（按路径升序）→characters（按路径升序）→prev-chapters→skills，label 全查 contracts 表", async () => {
    const pack = await buildContextPack(
      fakeReader(FULL_BOOK, {
        docs: FULL_DOCS,
        characters: { "chapters/03.md": ["characters/沈砚.md", "characters/阿萤.md"] }
      }),
      makeRequest({
        docRelPath: "chapters/03.md",
        chapterOrder: ["chapters/01.md", "chapters/02.md", "chapters/03.md"],
        skillPaths: [".mochen/skills/伏笔登记/SKILL.md"]
      })
    );
    expect(pack.sections.map((section) => section.kind)).toEqual([
      "doc",
      "outline",
      "outline",
      "characters",
      "characters",
      "prev-chapters",
      "prev-chapters",
      "skills"
    ]);
    // outline 与 characters 按路径升序（序章 < 卷一；沈 U+6C88 < 阿 U+963F），装配结果与 reader 返回顺序无关
    expect(pack.sections.map((section) => section.path)).toEqual([
      "chapters/03.md",
      "outline/序章.md",
      "outline/卷一.md",
      "characters/沈砚.md",
      "characters/阿萤.md",
      "chapters/01.md",
      "chapters/02.md",
      ".mochen/skills/伏笔登记/SKILL.md"
    ]);
    for (const section of pack.sections) {
      expect(section.label).toBe(CONTEXT_SECTION_KIND_LABELS[section.kind]);
      expect(CONTEXT_SECTION_KINDS).toContain(section.kind);
    }
  });

  it("readDoc 返回 null ⇒ 跳过该节，不抛错也不留空壳节；docRelPath 为 null 时没有 doc/前情/人物节", async () => {
    const reader = fakeReader(
      { "chapters/03.md": "正文" },
      { docs: [docRef("outline/丢了.md", "outline", "丢了")], characters: {} }
    );
    const pack = await buildContextPack(
      reader,
      makeRequest({ docRelPath: "chapters/03.md", skillPaths: ["没挂的技能/SKILL.md"] })
    );
    expect(pack.sections.map((section) => section.kind)).toEqual(["doc"]);
    const empty = await buildContextPack(reader, makeRequest({}));
    expect(empty.sections).toEqual([]);
    expect(empty.charCount).toBe(0);
    expect(empty.omitted).toEqual([]);
  });
});

describe("前情尾部切片（按码点）", () => {
  it("取当前章之前最多 2 章、各尾部 400 码点；超长节 truncated 为 true，doc 节永不尾切", async () => {
    const long = "甲".repeat(500);
    const pack = await buildContextPack(
      fakeReader({
        "chapters/01.md": long,
        "chapters/02.md": "短第二章。",
        "chapters/03.md": "第三章。"
      }),
      makeRequest({
        docRelPath: "chapters/03.md",
        chapterOrder: ["chapters/01.md", "chapters/02.md", "chapters/03.md"]
      })
    );
    const prevs = pack.sections.filter((section) => section.kind === "prev-chapters");
    expect(prevs.length).toBe(2);
    const first = prevs.at(0);
    const second = prevs.at(1);
    expect(first?.text).toBe("甲".repeat(400));
    expect(first?.truncated).toBe(true);
    expect(second?.text).toBe("短第二章。");
    expect(second?.truncated).toBe(false);
    const doc = pack.sections.find((section) => section.kind === "doc");
    expect(doc?.text).toBe("第三章。");
    expect(doc?.truncated).toBe(false);
  });

  it("代理对要么整留要么整去：尾部恰劈在 emoji 中间时不许出现孤立高代理", async () => {
    const pack = await buildContextPack(
      fakeReader({
        "chapters/01.md": "x".repeat(399) + "😀",
        "chapters/02.md": "😀" + "y".repeat(400),
        "chapters/03.md": "第三章。"
      }),
      makeRequest({
        docRelPath: "chapters/03.md",
        chapterOrder: ["chapters/01.md", "chapters/02.md", "chapters/03.md"]
      })
    );
    const tailA = pack.sections.find((s) => s.path === "chapters/01.md")?.text ?? "";
    const tailB = pack.sections.find((s) => s.path === "chapters/02.md")?.text ?? "";
    // 399 个 x + 一个完整 emoji（1 码点 2 码元）：按码元 slice(-400) 会留下半个代理对
    expect(Array.from(tailA).length).toBe(400);
    expect(tailA.endsWith("😀")).toBe(true);
    // emoji 在头部且超出 400：整个被丢弃，尾部恰为 400 个 y
    expect(tailB).toBe("y".repeat(400));
  });
});

describe("预算整节丢弃（M8 的钉点）", () => {
  it("超预算从最低优先级节整节丢弃、节标识进 omitted，保留节正文逐字原样（无半句截断）", async () => {
    const doc = "章".repeat(CONTEXT_CHAR_BUDGET - 4000);
    const pack = await buildContextPack(
      fakeReader(
        {
          "chapters/01.md": doc,
          ".mochen/skills/甲/SKILL.md": "技".repeat(2200),
          ".mochen/skills/乙/SKILL.md": "技".repeat(2200)
        },
        { docs: [] }
      ),
      makeRequest({
        docRelPath: "chapters/01.md",
        skillPaths: [".mochen/skills/甲/SKILL.md", ".mochen/skills/乙/SKILL.md"]
      })
    );
    // 20000 + 2200 + 2200 = 24400 > 24000 ⇒ 先丢装配序靠后的 skills/乙，剩 22200 达标
    expect(pack.sections.map((section) => section.path)).toEqual([
      "chapters/01.md",
      ".mochen/skills/甲/SKILL.md"
    ]);
    expect(pack.omitted).toEqual([".mochen/skills/乙/SKILL.md"]);
    expect(pack.charCount).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET);
    const keptDoc = pack.sections.find((section) => section.kind === "doc");
    expect(keptDoc?.text).toBe(doc);
    expect(keptDoc?.truncated).toBe(false);
    for (const section of pack.sections) {
      expect(section.truncated).toBe(false);
    }
  });

  it("多轮丢弃按 kind 优先级（同 kind 取靠后）依次进行：skills 先于 prev-chapters 先于 characters", async () => {
    const doc = "章".repeat(21500);
    const pack = await buildContextPack(
      fakeReader(
        {
          "chapters/01.md": "一".repeat(400),
          "chapters/02.md": "二".repeat(400),
          "chapters/03.md": doc,
          "characters/沈砚.md": "人".repeat(2000),
          ".mochen/skills/甲/SKILL.md": "技".repeat(1000),
          ".mochen/skills/乙/SKILL.md": "技".repeat(1000)
        },
        { docs: [], characters: { "chapters/03.md": ["characters/沈砚.md"] } }
      ),
      makeRequest({
        docRelPath: "chapters/03.md",
        chapterOrder: ["chapters/01.md", "chapters/02.md", "chapters/03.md"],
        skillPaths: [".mochen/skills/甲/SKILL.md", ".mochen/skills/乙/SKILL.md"]
      })
    );
    // 21500+2000+400+400+1000+1000=26300：丢乙→25300，丢甲→24300，丢第 2 章前情→23900 达标
    expect(pack.omitted).toEqual([
      ".mochen/skills/乙/SKILL.md",
      ".mochen/skills/甲/SKILL.md",
      "chapters/02.md"
    ]);
    expect(pack.charCount).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET);
    expect(pack.sections.map((section) => section.kind)).toEqual([
      "doc",
      "characters",
      "prev-chapters"
    ]);
  });

  it("charCount/estimate 与 sections 严格一致：estimate = Math.ceil(码点总数 / 1.6)", async () => {
    const pack = await buildContextPack(
      fakeReader({ "chapters/01.md": "内容😀混合", "outline/a.md": "大纲" }, { docs: [docRef("outline/a.md", "outline", "a")] }),
      makeRequest({ docRelPath: "chapters/01.md" })
    );
    const total = pack.sections.reduce((sum, section) => sum + Array.from(section.text).length, 0);
    expect(pack.charCount).toBe(total);
    expect(pack.estimate).toBe(Math.ceil(total / 1.6));
    expect(pack.sections.length + pack.omitted.length).toBe(2);
  });
});

describe("contextSummaryOf（给 IPC 的纯视图）", () => {
  it("摘要只有统计没有正文：sections 元素恰四键，正文片段不泄漏", async () => {
    const pack = await buildContextPack(
      fakeReader({ "chapters/01.md": "机密正文片段", "outline/a.md": "大纲正文" }, { docs: [docRef("outline/a.md", "outline", "a")] }),
      makeRequest({ docRelPath: "chapters/01.md" })
    );
    const summary = contextSummaryOf(pack);
    expect(summary.sections.map((view) => Object.keys(view).sort())).toEqual([
      ["charCount", "kind", "label", "truncated"],
      ["charCount", "kind", "label", "truncated"]
    ]);
    expect(summary.charCount).toBe(pack.charCount);
    expect(summary.estimate).toBe(pack.estimate);
    expect(summary.omitted).toEqual(pack.omitted);
    expect(summary.omitted).not.toBe(pack.omitted);
    expect(JSON.stringify(summary)).not.toContain("机密正文片段");
    expect(JSON.stringify(summary)).not.toContain("大纲正文");
  });
});
```

> `pack.sections.length + pack.omitted.length === 2` 那条断言的含义：要么留着、要么进 `omitted`，一节都不许凭空蒸发。若嫌不够直白可拆成两条。

- [ ] **Step 2：跑到红**

Run: `corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts --maxWorkers=4`
Expected: FAIL——整个文件在导入期就炸（`context-pack.ts` 还不存在），形如：

```
Error: Failed to load ../src/context-pack.js ... Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3：实现 `packages/agent-runtime/src/context-pack.ts`（全文落盘）**

```ts
import {
  CONTEXT_SECTION_KIND_LABELS,
  CONTEXT_SECTION_KINDS,
  type ContextSectionKind,
  type ContextSummary,
  type DocRef
} from "@mochen/contracts";

/**
 * 上下文包装配（Plan 3 spec §9.3）。本包禁止 import electron 与 node:fs：
 * 盘上读取一律走注入的 ContextReader，fs 版实现与出场人物命中都在主进程（Task 15）。
 */

/** 前情提要取当前章之前的章数。 */
export const PREVIOUS_CHAPTER_COUNT = 2;
/** 每章前情取尾部这么多「码点」（不是 UTF-16 码元，见 tailByCodePoints 的教训注释）。 */
export const PREVIOUS_CHAPTER_TAIL_CHARS = 400;
/** 上下文包字符预算（码点计），超出从尾部整节丢弃。 */
export const CONTEXT_CHAR_BUDGET = 24000;

export interface ContextReader {
  listDocs(): DocRef[];
  /** null = 文件不存在或读不到；调用方跳过该节，不抛错。 */
  readDoc(relPath: string): Promise<string | null>;
  /** 出场人物文稿的相对路径列表（frontmatter 与正文两路命中由主进程实现）。 */
  charactersOf(relPath: string): Promise<string[]>;
}

export interface ContextRequest {
  docRelPath: string | null;
  chapterOrder: string[];
  skillPaths: string[];
}

export interface ContextSection {
  kind: ContextSectionKind;
  /** 一律取 CONTEXT_SECTION_KIND_LABELS[kind]，不许自写第二套标签（铁律 6）。 */
  label: string;
  path?: string;
  text: string;
  truncated: boolean;
}

export interface ContextPack {
  sections: ContextSection[];
  charCount: number;
  estimate: number;
  omitted: string[];
}

function codePointCount(text: string): number {
  return Array.from(text).length;
}

/** token 估算的唯一公式：Math.ceil(码点数 / 1.6)。UI 一律显示「约 N」。 */
function tokensFromCodePoints(count: number): number {
  return Math.ceil(count / 1.6);
}

export function estimateTokens(text: string): number {
  return tokensFromCodePoints(codePointCount(text));
}

/**
 * 尾部切片按码点：Array.from 先拆成码点数组，代理对要么整留要么整去。
 * 教训与手法同 apps/desktop/src/renderer/src/utils/timeline.ts:157-161——按 UTF-16 码元
 * slice 会把 emoji 劈成孤立高代理，渲染出豆腐块。
 */
function tailByCodePoints(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return { text, truncated: false };
  return { text: chars.slice(chars.length - maxChars).join(""), truncated: true };
}

function byRelPath(a: DocRef, b: DocRef): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
}

/** 丢弃优先级 = CONTEXT_SECTION_KINDS 的数组序（doc 最高、materials 最低），不另立第二张表。 */
function priorityRank(section: ContextSection): number {
  return CONTEXT_SECTION_KINDS.indexOf(section.kind);
}

function sumCodePoints(sections: ContextSection[]): number {
  return sections.reduce((sum, section) => sum + codePointCount(section.text), 0);
}

/**
 * 超预算的处理只有「整节丢弃」一档：从最低优先级节开始整节扔（同优先级取装配序靠后的），
 * 节标识进 omitted；保留节正文一字不动——不做半句截断式压缩（M8 钉的就是这条）。
 */
function trimToBudget(sections: ContextSection[]): { sections: ContextSection[]; omitted: string[] } {
  let current = sections;
  const omitted: string[] = [];
  for (;;) {
    if (sumCodePoints(current) <= CONTEXT_CHAR_BUDGET || current.length === 0) break;
    let worst: ContextSection | null = null;
    for (const section of current) {
      if (worst === null || priorityRank(section) >= priorityRank(worst)) worst = section;
    }
    if (worst === null) break;
    omitted.push(worst.path ?? worst.label);
    current = current.filter((section) => section !== worst);
  }
  return { sections: current, omitted };
}

/**
 * 装配顺序即优先级顺序：doc → outline → characters → prev-chapters → skills。
 * materials 本片无挂入通路（ContextRequest 没有素材字段），不生成节；优先级位保留。
 * readDoc 返回 null 的节直接跳过——失败可见（error 事件）归装配层 Task 24，不在本层。
 */
export async function buildContextPack(
  reader: ContextReader,
  request: ContextRequest
): Promise<ContextPack> {
  const sections: ContextSection[] = [];

  if (request.docRelPath !== null) {
    const text = await reader.readDoc(request.docRelPath);
    if (text !== null) {
      sections.push({
        kind: "doc",
        label: CONTEXT_SECTION_KIND_LABELS.doc,
        path: request.docRelPath,
        text,
        truncated: false
      });
    }
  }

  const outlines = reader
    .listDocs()
    .filter((doc) => doc.kind === "outline")
    .sort(byRelPath);
  for (const doc of outlines) {
    const text = await reader.readDoc(doc.relPath);
    if (text === null) continue;
    sections.push({
      kind: "outline",
      label: CONTEXT_SECTION_KIND_LABELS.outline,
      path: doc.relPath,
      text,
      truncated: false
    });
  }

  if (request.docRelPath !== null) {
    const characters = [...(await reader.charactersOf(request.docRelPath))].sort();
    for (const relPath of characters) {
      const text = await reader.readDoc(relPath);
      if (text === null) continue;
      sections.push({
        kind: "characters",
        label: CONTEXT_SECTION_KIND_LABELS.characters,
        path: relPath,
        text,
        truncated: false
      });
    }

    const current = request.chapterOrder.indexOf(request.docRelPath);
    if (current > 0) {
      const from = Math.max(0, current - PREVIOUS_CHAPTER_COUNT);
      for (const relPath of request.chapterOrder.slice(from, current)) {
        const raw = await reader.readDoc(relPath);
        if (raw === null) continue;
        const tail = tailByCodePoints(raw, PREVIOUS_CHAPTER_TAIL_CHARS);
        sections.push({
          kind: "prev-chapters",
          label: CONTEXT_SECTION_KIND_LABELS["prev-chapters"],
          path: relPath,
          text: tail.text,
          truncated: tail.truncated
        });
      }
    }
  }

  for (const relPath of request.skillPaths) {
    const text = await reader.readDoc(relPath);
    if (text === null) continue;
    sections.push({
      kind: "skills",
      label: CONTEXT_SECTION_KIND_LABELS.skills,
      path: relPath,
      text,
      truncated: false
    });
  }

  const trimmed = trimToBudget(sections);
  const charCount = sumCodePoints(trimmed.sections);
  return {
    sections: trimmed.sections,
    charCount,
    estimate: tokensFromCodePoints(charCount),
    omitted: trimmed.omitted
  };
}

/** 跨 IPC 的纯视图：统计量与节名走，正文一个字都不离开 runtime（渲染层禁止 import 本包）。 */
export function contextSummaryOf(pack: ContextPack): ContextSummary {
  return {
    sections: pack.sections.map((section) => ({
      kind: section.kind,
      label: section.label,
      charCount: codePointCount(section.text),
      truncated: section.truncated
    })),
    charCount: pack.charCount,
    estimate: pack.estimate,
    omitted: [...pack.omitted]
  };
}
```

- [ ] **Step 4：barrel 追加**

用 Edit 在 `packages/agent-runtime/src/index.ts` 第 10 行 `export * from "./tool-loop.js";` 之后追加：

```ts
export * from "./context-pack.js";
```

- [ ] **Step 5：跑到绿 + 本包 tsc/prettier/边界**

Run: `corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts --maxWorkers=4`
Expected: PASS（10 用例，`Test Files 1 passed (1)`）。
Run: `corepack pnpm prettier --write packages/agent-runtime && corepack pnpm tsc --noEmit -p packages/agent-runtime/tsconfig.json && node tools/check-package-boundary.mjs`
Expected: tsc 无诊断；boundary 通过（本文件没有 import `electron`/`node:fs`）。

- [ ] **Step 6：连带清单**

1. `index.ts` 此刻只加 `context-pack.js` 一行；`profiles.js` 一行归 Task 13——**做完本任务立即转 Task 13**，波 2 的两个提交顺序是「context-pack 在前、profiles 在后」。
2. `ContextSummary`/`ContextSectionView`/`CONTEXT_SECTION_KINDS`/`CONTEXT_SECTION_KIND_LABELS` 用的是 Task 11 落地件；本文件**重新导出任何 contracts 同名类型都算违约**（`export *` 撞名 tsc 会红，别绕）。
3. `label`/`omitted` 两处语义与接口总表 §9.3 示意标签的差异（查表 vs 例举「本章」「出场人物 · 沈砚」）已按 Interfaces 第 2 条拍定，Task 15/16/20 消费方不得再各写一套；如要改形状，改 contracts（Task 11 的地盘）并走复核。
4. 出场人物「两路命中」与技能读不到的可见 `error` 都不在本层（分别是 Task 15 的 fs reader、Task 24 的装配层），本层契约只保证 `null ⇒ 跳节不抛`。
5. 本包既有测试不回归：`corepack pnpm vitest run packages/agent-runtime --maxWorkers=4` 全绿（此时还没有 profiles.test.ts，属预期）。

- [ ] **Step 7：变异实验 M8（「超预算整节丢弃」的真钉子，只用 Edit，禁 perl/sed）**

在 `packages/agent-runtime/src/context-pack.ts` 的 `trimToBudget` 里，用 Edit 把循环体最后两行：

```ts
    omitted.push(worst.path ?? worst.label);
    current = current.filter((section) => section !== worst);
```

替换成「只截半句」版本（这就是 M8 的变异动作——去掉丢弃分支、改成正好裁到预算线）：

```ts
    const overflow = sumCodePoints(current) - CONTEXT_CHAR_BUDGET;
    const chars = Array.from(worst.text);
    worst.text = chars.slice(0, Math.max(0, chars.length - overflow)).join("");
    worst.truncated = true;
    break;
```

Run: `corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts --maxWorkers=4`
Expected: FAIL——**双双转红**（缺一即说明断言没钉住，要补）：
1. 「超预算从最低优先级节整节丢弃、节标识进 omitted…」：`omitted` 变成 `[]`，`toEqual([".mochen/skills/乙/SKILL.md"])` 红。
2. 「保留节正文逐字原样（无半句截断）」在同一条用例里：被裁节 `text` 与原文不再逐字相等、`truncated` 被翻成 `true`，`expect(section.truncated).toBe(false)` 红。
（第二条若被第一条短路，另跑「多轮丢弃…」用例确认 `omitted` 断言同样红。）

用 Edit **原样写回**上面两行，再 Run 同命令，Expected: PASS（10 用例回绿）。变异代码不提交。

- [ ] **Step 8：提交（先 `git log --oneline -8` 对照仓库风格再落 message）**

```
git add packages/agent-runtime/src/context-pack.ts packages/agent-runtime/test/context-pack.test.ts packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): 上下文包装配——码点尾切、预算整节丢弃与 token 估算"
```

Expected: `git status` 干净；本任务不 push、不跑全量 `corepack pnpm verify`（波 2 收尾归门禁任务）。

### Task 15：主进程 —— fs 版 `ContextReader` + `profile:list`

> 前置：Task 11（contracts 已加 `IPC_CHANNELS.profileList`、`ProfileView`）、Task 13（`@mochen/agent-runtime` 已导出 `profileViews()`）、Task 14（runtime 已导出 `ContextReader` / `ContextRequest` 类型）已合入。本任务在 `apps/desktop/src/main` 落 `ContextReader` 的 fs 实现，并把 `profile:list` 通道接上。

**Files:**

- Create: `apps/desktop/src/main/context-reader.ts`
- Create: `apps/desktop/src/main/context-reader.test.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`（新增导出 `registerProfileIpc`，注册 `profile:list` 一条通道）
- Modify: `apps/desktop/src/main/agent-ipc.test.ts`（追加一个 describe，见 Step 1 第 2 段）
- Modify: `apps/desktop/src/main/index.ts`（第 63 行 `registerProviderIpc(...)` 之后装配 `registerProfileIpc`）

**Interfaces:**

逐字照接口总表「波 2」：

```ts
// apps/desktop/src/main/context-reader.ts
export function createFsContextReader(deps: { book: BookService }): ContextReader;
// ContextReader（只 import 类型，不复制结构体，来自 @mochen/agent-runtime，Task 14 已落）：
//   listDocs(): DocRef[];
//   readDoc(relPath: string): Promise<string | null>;      // null = 这次没读到（含缺文件、越界、没开书）
//   charactersOf(relPath: string): Promise<string[]>;      // 两路命中：章节 frontmatter 的 characters ∪ 正文中出现的 characters/ 文稿标题

// apps/desktop/src/main/agent-ipc.ts
export function registerProfileIpc(handle: Handler): void; // handle(IPC_CHANNELS.profileList, () => profileViews())
```

行为定稿（照 Plan 3 spec §9.3 与本任务要点）：

1. `listDocs()`＝`deps.book.current()?.docs ?? []`，未开书返回**空数组**（不抛）。
2. `readDoc(rel)`：先把 `rel` 过 `assertSafeRelPath`（fs-store 守卫，`apps/desktop/src/main/doc-tools-host.ts:42-48` 同思路），越界/绝对路径/空路径**直接返回 null、不拼 fs 路径**；再走 `readDocFile`，任何读取失败（ENOENT/EBUSY…）吞成 null——与 `doc-tools-host.ts:58-60` 同一姿态：null 只表示「这次没读到」。
3. `charactersOf(rel)` **两路命中**：先复用 `parseFrontmatter`（`packages/fs-store/src/frontmatter.ts:6`，**不重复造解析**）取章节 `characters` 键（字符串按 `[,，]` 拆、列表逐项），再对 `body`（已剥 frontmatter 的正文）在 `docs.filter(kind === "character")` 的**标题**做归一匹配（剥全部空白 + 小写），命中即并入；**并集去重**（按归一键，输出保留原文）。匹配不到的人物文稿**不得混入**（反向用例）。
4. `profile:list` handler 返回 `profileViews()`（四键视图，**不含 `systemPrompt`**——Task 13 已定稿产物只有四键，这里只做转发与形状断言）。

**本任务不注册 `agent:context-preview`（显式口径，不留白）**：preload 的 `contextPreview` 方法自 Task 12 起就在 `RendererApi`/工厂里存在，但它的主进程 handler 依赖 Task 16 的 `createBookPromptAssembler`（预览与真实装配必须走同一条装配器，否则占用条与实际发送内容会分叉），因此 **Task 12–15 的提交只保证 tsc/单测绿，`agent:context-preview` 真机通路要到 Task 16 才落地**。这条口径同时写进 Task 16 的 Interfaces。

- [ ] **Step 1：先写会红的测试**

新建 `apps/desktop/src/main/context-reader.test.ts`，整文件落盘：

```ts
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BookMeta, DocRef } from "@mochen/contracts";
import { scanBook } from "@mochen/fs-store";
import type { ContextReader } from "@mochen/agent-runtime";
import type { BookService, BookSnapshot } from "./book-service.js";
import { createFsContextReader } from "./context-reader.js";

const meta: BookMeta = {
  id: "book-test",
  title: "测试书",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "草稿" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: ["chapters/01-雨潮.md"]
};

/** 只喂 current()：reader 只消费快照，BookService 的其余方法在这条链上是死代码。 */
function fakeBook(snapshot: BookSnapshot | null): BookService {
  return { current: () => snapshot } as unknown as BookService;
}

function snapshotOf(root: string, docs: DocRef[]): BookSnapshot {
  return { root, meta, docs };
}

let dir: string;
let reader: ContextReader;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-context-reader-"));
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await mkdir(path.join(dir, "characters"), { recursive: true });
  await writeFile(
    path.join(dir, "chapters", "01-雨潮.md"),
    [
      "---",
      "title: 雨潮",
      "characters:",
      "  - 沈砚",
      "  - 顾老板 ",
      "---",
      "",
      "雨声敲窗。沈砚搁下笔，看向门口。",
      "先生 墨 不知何时已立在檐下，衣角未湿分毫。",
      "ALINA 抱着账本挤进门来。顾老板的幌子还挂在门外。",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(dir, "characters", "alina.md"), "---\ntitle: Alina\n---\n\n人物卡。\n", "utf8");
  await writeFile(path.join(dir, "characters", "shen-yan.md"), "---\ntitle: 沈砚\n---\n\n人物卡。\n", "utf8");
  await writeFile(path.join(dir, "characters", "xian-sheng-mo.md"), "---\ntitle: 先生墨\n---\n\n人物卡。\n", "utf8");
  await writeFile(
    path.join(dir, "characters", "wei-chu-chang.md"),
    "---\ntitle: 未出场者\n---\n\n人物卡。\n",
    "utf8"
  );
  reader = createFsContextReader({ book: fakeBook(snapshotOf(dir, await scanBook(dir))) });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createFsContextReader 无书与缺文件", () => {
  it("没有开书：listDocs 返回空数组，readDoc 返回 null，charactersOf 返回空数组，统统不抛", async () => {
    const empty = createFsContextReader({ book: fakeBook(null) });
    expect(empty.listDocs()).toEqual([]);
    await expect(empty.readDoc("chapters/01-雨潮.md")).resolves.toBeNull();
    await expect(empty.charactersOf("chapters/01-雨潮.md")).resolves.toEqual([]);
  });

  it("文件不存在：readDoc 返回 null 而不是抛错；人物命中也随之为空数组", async () => {
    await expect(reader.readDoc("chapters/查无此章.md")).resolves.toBeNull();
    await expect(reader.charactersOf("chapters/查无此章.md")).resolves.toEqual([]);
  });
});

describe("createFsContextReader 越界守卫", () => {
  it("../、绝对路径、盘符路径、空串都返回 null，绝不拼成 fs 路径去读", async () => {
    for (const bad of ["../secrets.md", "/etc/passwd", "C:/Windows/win.ini", "chapters/../../outside.md", ""]) {
      await expect(reader.readDoc(bad)).resolves.toBeNull();
      await expect(reader.charactersOf(bad)).resolves.toEqual([]);
    }
  });
});

describe("createFsContextReader 出场人物两路命中", () => {
  it("frontmatter 的 characters 并上正文中出现的 characters/ 文稿标题，并集去重恰好四条", async () => {
    const names = await reader.charactersOf("chapters/01-雨潮.md");
    // 沈砚＝frontmatter+标题两路命中只算一条；顾老板只有 frontmatter；先生墨/Alina 只有标题路。
    expect(new Set(names)).toEqual(new Set(["沈砚", "顾老板", "先生墨", "Alina"]));
    expect(names.length).toBe(4);
  });

  it("大小写与空格容错：正文写「先生 墨」命中标题「先生墨」、正文「ALINA」不敏大小写命中「Alina」", async () => {
    const names = await reader.charactersOf("chapters/01-雨潮.md");
    expect(names).toContain("先生墨");
    expect(names).toContain("Alina");
  });

  it("反向用例：正文没出现的《未出场者》绝不混进出场人物", async () => {
    const names = await reader.charactersOf("chapters/01-雨潮.md");
    expect(names).not.toContain("未出场者");
  });
});
```

在 `apps/desktop/src/main/agent-ipc.test.ts` 追加（import 处：第 9 行的 import 花名里补 `registerProfileIpc`；`@mochen/contracts` 的花名里补 `type ProfileView`、`AGENT_TOOL_NAMES`；文件末尾追加）：

```ts
describe("registerProfileIpc", () => {
  it("只注册 profile:list 一条通道，一条不多一条不少", () => {
    const reg = registry();
    registerProfileIpc(reg.handle);
    expect(reg.order).toEqual([IPC_CHANNELS.profileList]);
  });

  it("返回的每条 ProfileView 只有四键，systemPrompt 永不跨 IPC（Plan 3 spec §9.1）", async () => {
    const reg = registry();
    registerProfileIpc(reg.handle);
    const views = (await fire(reg.fns, IPC_CHANNELS.profileList)) as ProfileView[];
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(Object.keys(view).sort()).toEqual(["allowedTools", "blurb", "displayName", "id"]);
      for (const tool of view.allowedTools) expect(AGENT_TOOL_NAMES).toContain(tool);
    }
    expect(JSON.stringify(views)).not.toContain("systemPrompt");
  });
});
```

- [ ] **Step 2：跑到红**

Run: `corepack pnpm vitest run apps/desktop/src/main/context-reader.test.ts apps/desktop/src/main/agent-ipc.test.ts --maxWorkers=4`

Expected（原文形态，报错点可能差一两个字符，但必须是**两条都红**）：

```
FAIL  apps/desktop/src/main/context-reader.test.ts [ Cannot find module './context-reader.js' ... ]
FAIL  apps/desktop/src/main/agent-ipc.test.ts  [ SyntaxError: The requested module './agent-ipc.js' does not provide an export named 'registerProfileIpc' ]
Test Files  2 failed (2)
```

跑不到这一步就先确认前置任务已合入（`profileViews` 的 import 报红属前置缺失，不是本任务的错）。

- [ ] **Step 3：实现**

新建 `apps/desktop/src/main/context-reader.ts`，整文件落盘：

```ts
import type { DocRef } from "@mochen/contracts";
import { assertSafeRelPath, parseFrontmatter, readDocFile } from "@mochen/fs-store";
import type { ContextReader } from "@mochen/agent-runtime";
import type { BookService } from "./book-service.js";

/** 归一键：剥全部空白并转小写。只用于「是不是同一个名字」，绝不用于输出——输出永远保留原文。 */
function matchKey(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * fs 版 ContextReader：agent-runtime 禁 node:fs，盘上读取全押在这里（Plan 3 spec §9.3）。
 * 出场人物两路命中＝章节 frontmatter 的 characters ∪ 正文里出现的 characters/ 文稿标题；
 * frontmatter 解析复用 fs-store，不重复造第二份。
 */
export function createFsContextReader(deps: { book: BookService }): ContextReader {
  /** 守卫先于读盘：越界/绝对/空路径直接 null，绝不把外部可控字符串拼进 fs；任何读取失败吞成 null（同 doc-tools-host.ts 的 text()）。 */
  async function read(relPath: string): Promise<string | null> {
    const base = deps.book.current()?.root ?? null;
    if (base === null) return null;
    let safe: string;
    try {
      safe = assertSafeRelPath(relPath);
    } catch {
      return null;
    }
    return (await readDocFile(base, safe).catch(() => null))?.content ?? null;
  }

  return {
    listDocs(): DocRef[] {
      return deps.book.current()?.docs ?? [];
    },

    readDoc: read,

    async charactersOf(relPath: string): Promise<string[]> {
      const raw = await read(relPath);
      if (raw === null) return [];
      const names: string[] = [];
      const seen = new Set<string>();
      const push = (item: string): void => {
        const name = item.trim();
        const key = matchKey(name);
        if (key === "" || seen.has(key)) return;
        seen.add(key);
        names.push(name);
      };

      // 路 1：章节自己的 frontmatter（parseFrontmatter 已把 data/body 分好，body 天然不含元数据行）。
      const { data, body } = parseFrontmatter(raw);
      const declared = data.characters;
      if (typeof declared === "string") {
        for (const item of declared.split(/[,，]/)) push(item);
      } else if (Array.isArray(declared)) {
        for (const item of declared) push(item);
      }

      // 路 2：characters/ 文稿标题在正文中出现（空白/大小写容错）；未出现的一律不混入。
      const proseKey = matchKey(body);
      for (const doc of deps.book.current()?.docs ?? []) {
        if (doc.kind !== "character") continue;
        const key = matchKey(doc.title);
        if (key !== "" && proseKey.includes(key)) push(doc.title);
      }
      return names;
    }
  };
}
```

改 `apps/desktop/src/main/agent-ipc.ts`：

1. 第 1–6 行的 `@mochen/contracts` import 不动（`IPC_CHANNELS` 已在）；在其后加一行：

```ts
import { profileViews } from "@mochen/agent-runtime";
```

2. 文件末尾追加（`Handler` 类型同文件第 11 行已定义，直接复用）：

```ts
/**
 * 花名册住在 agent-runtime（Task 13 唯一一份 roster），这里只做转发：
 * profileViews() 的产物不含 systemPrompt，提示词永不跨 IPC 进渲染层。
 */
export function registerProfileIpc(handle: Handler): void {
  handle(IPC_CHANNELS.profileList, () => profileViews());
}
```

改 `apps/desktop/src/main/index.ts`：

1. 第 7 行 import 改为 `import { registerAgentIpc, registerProfileIpc, registerProviderIpc } from "./agent-ipc.js";`
2. 第 63 行 `registerProviderIpc(...)` 之后插入：

```ts
  // profile:list 是纯静态转发；fs 版 ContextReader（context-reader.ts）与装配器的接线在 Task 16 换 promptFor 时一并落地。
  registerProfileIpc((channel, fn) => ipcMain.handle(channel, fn));
```

- [ ] **Step 4：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/main/context-reader.test.ts apps/desktop/src/main/agent-ipc.test.ts --maxWorkers=4`

Expected: `Test Files 2 passed (2)`、`Tests 10 passed (10)`（context-reader 6 条 + agent-ipc 原有 2 条 + 新增 2 条；以命令输出原文为准贴进报告）。

Run: `corepack pnpm prettier --write apps/desktop/src/main && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json`

Expected: prettier 无 changed 报错（允许格式化）、tsc 退出码 0。再跑一次边界门禁：`node tools/check-package-boundary.mjs`，Expected 退出码 0（main 层允许 import `node:fs`/runtime 类型；本任务没有往 runtime 里加任何东西）。

- [ ] **Step 5：连带清单（逐项打勾确认，不许跳过）**

1. `agent-ipc.ts` 其余四个通道与 `registerAgentIpc` 一字未动（回放波 1 的计数用例仍绿即为证）。
2. `index.ts` 只加了 import 与一行注册；`defaultPromptFor` 的传参（第 60 行）**本任务不动**，Task 16 才换。
3. `context-reader.ts` 不含任何 `electron` import；fs 访问全部经 `@mochen/fs-store`——本文件在 `apps/desktop/src/main`，允许 `node:fs` 但没有直接用到。
4. preload（Task 12 已落）的 `contextPreview` 方法**本任务故意不接 handler**：渲染层调用会收到「通道未注册」的 electron 错误——这是 Task 12–15 区间的已知口径（见 Interfaces 末尾），UI 侧真机验证排在 Task 16 之后。
5. 契约计数不动：本任务零新增通道键（`profileList` 是 Task 11 加的），`renderer-api.test.ts` 的字面量计数不改。

- [ ] **Step 6：变异自查（轻量，非台账项；只用 Edit 改，禁 `perl -i`/`sed -i`）**

把 `charactersOf` 里 `if (key === "" || seen.has(key)) return;` 临时改成 `if (key === "") return;`（去掉去重），重跑 Step 4 的 vitest 命令，Expected：「并集去重恰好四条」用例因 `names.length` 变 5 转红。恢复原样重跑，Expected 全绿。把红/绿两段输出各贴一行进提交报告。

- [ ] **Step 7：提交**

```bash
git add apps/desktop/src/main/context-reader.ts apps/desktop/src/main/context-reader.test.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(main): fs 版 ContextReader（出场人物两路命中）与 profile:list 通道"
```

Expected: `git status --short` 只剩与本任务无关的文件（或干净）。

### Task 16：主进程 —— `promptFor` 异步化 + 档案提示词装配器 + 按档案过滤工具（M7）

> 前置：Task 11（contracts：`StartTurnInput.profileId` 必填、`contextPreviewInputSchema`、`IPC_CHANNELS.agentContextPreview`、`ContextSummary`/`ContextPreviewInput`）、Task 13（runtime：`AGENT_PROFILES`/`profileById`/`DEFAULT_PROFILE_ID`，六个显示名定稿含「墨宸 · 主笔/续写/审稿」）、Task 14（runtime：`buildContextPack`/`contextSummaryOf`/`ContextReader`）、Task 15（main：`createFsContextReader`）已合入。
>
> **本任务闭合 Task 12–15 的已知口径**：preload 的 `contextPreview` 方法自 Task 12 起存在而主进程 handler 一直缺位（Task 15 Interfaces 写明「真机通路要到 Task 16」）；本任务注册 `agent:context-preview` 后，占用条的渲染层调用才有落地通路。

**Files:**

- Create: `apps/desktop/src/main/book-prompt.ts`
- Create: `apps/desktop/src/main/book-prompt.test.ts`
- Modify: `apps/desktop/src/main/agent-service.ts`（现 513 行：`AgentServiceDeps.promptFor` 异步化并删 `defaultPromptFor`（第 48–63 行）、`PromptContext` 加三字段（第 41–46 行）、新增 `resolveProfile` 与 `contextPreview`、`stream(req)` 处按档案过滤工具（第 439 行））
- Modify: `apps/desktop/src/main/agent-ipc.ts`（`registerAgentIpc` 追加 `agent:context-preview`）
- Modify: `apps/desktop/src/main/agent-ipc.test.ts`（`stubService` 补方法、order 断言补通道）
- Modify: `apps/desktop/src/main/agent-service.test.ts`、`agent-service-boundary.test.ts`、`turn-e2e.test.ts`（夹具连带 + 新用例，逐点见 Step 1/5）
- Modify: `apps/desktop/src/main/index.ts`（换装配器、注入 reader）

**Interfaces:**

逐字照接口总表「波 2」：

```ts
// apps/desktop/src/main/book-prompt.ts
export function createBookPromptAssembler(
  deps: { book: BookService; reader: ContextReader }
): (context: PromptContext) => Promise<string>;

// apps/desktop/src/main/agent-service.ts
PromptContext += profileId: string; skillPaths: string[]; chapterOrder: string[];
AgentServiceDeps.promptFor(context: PromptContext): Promise<string>;   // 由同步改异步
AgentServiceDeps.reader: ContextReader;                                 // 见下方「内部细节」声明
AgentService.contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;
// defaultPromptFor：整个删除。全仓仅两个消费方（index.ts:60 与各 *.test.ts 夹具），本任务一处不漏改完。
```

三条必须写进代码注释的定稿口径：

1. **签名分歧裁定**：Plan 3 spec §9.3 写的是 `createBookPromptAssembler({ book, reader, profiles })`，接口总表定的是 `{ book, reader }`（roster 由 `@mochen/agent-runtime` 静态导入，唯一一份，符合铁律 6「枚举与映射只许一份实现」）。**照接口总表实现**，本行即留痕说明。
2. **未知 profileId 的两条通路**（Plan 3 spec §9.1 末段）：`startTurn` 里经 `resolveProfile` 回落 `DEFAULT_PROFILE_ID` **并 publish 一条可见 `error` 事件（落盘 JSONL）**，整句定稿（测试用 `toBe` 逐字钉死，改一个字都算违约）：
   `档案「ghost-profile」不认识，已回落到默认档案〈墨宸 · 主笔〉，本轮继续。`
   （模板：`档案「${rawId.trim()}」不认识，已回落到默认档案〈${fallback.displayName}〉，本轮继续。`）
   `contextPreview` 里同函数静默回落、**不发事件**：预览不属于任何轮次，`AgentEvent.turnId` 无处可填，且预览只读、发事件反而会把噪声写进别的线程历史——可见性义务由 `startTurn` 通路承担。
3. **`AgentServiceDeps.reader` 是总表未列的追加项**（总表只写「该任务内部细节」以外没写 deps 加键）：`contextPreview` 与装配必须共用**同一个** `createFsContextReader` 实例，否则占用条显示的就不是实际发送的装配结果。这是总表「本表没写的形状属于该任务内部细节」条款下最省事的收口，不改动表中任何一个已列签名。
4. **工具过滤的位置（M7 的钉子）**：`runTurn`（`packages/agent-runtime/src/tool-loop.ts:119`）把 `TOOL_SPECS` 原样塞进 `stream(req)` 的 `req.tools`，**runtime 一字不改**；过滤发生在 agent-service 第 439 行的 `stream: (req) => streamChat({ ...req, fetchImpl })` 包装处——这是档案请求侧闸（Plan 3 spec §9.2 闸 1）。审批侧档案闸（§9.2 闸 2，M6）归 Task 17，本任务不做。
5. `StartTurnInput.skillPaths` 到波 3 才存在：本任务 `startTurn` 给装配器传 `skillPaths: []` 并留注释「波 3 给 StartTurnInput 加 skillPaths 后改成 input.skillPaths ?? []」；`contextPreview` 的 `ContextPreviewInput.skillPaths` 已是必填，直接透传。
6. 行数门禁：`agent-service.ts` 现 513 行，本任务净增约 70 行（≈585）。**若实现中加完逼近 700 行**，把 `readForApproval`＋`applyDecision`（第 94–110 与 253–375 行，约 140 行）拆到 `apps/desktop/src/main/proposal-approval.ts`，`createAgentService` 里改为注入调用；本任务默认不拆，拆不拆由 `node tools/check-source-line-budget.mjs` 说了算。

- [ ] **Step 1：先写会红的测试**

新建 `apps/desktop/src/main/book-prompt.test.ts`，整文件落盘：

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BookMeta, DocRef } from "@mochen/contracts";
import { scanBook } from "@mochen/fs-store";
import type { BookService, BookSnapshot } from "./book-service.js";
import { createFsContextReader } from "./context-reader.js";
import { createBookPromptAssembler } from "./book-prompt.js";
import type { PromptContext } from "./agent-service.js";

const meta: BookMeta = {
  id: "book-test",
  title: "深渊之下",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: ["chapters/01-开局.md", "chapters/02-闸口.md", "chapters/09-长潮.md"]
};

function fakeBook(snapshot: BookSnapshot | null): BookService {
  return { current: () => snapshot } as unknown as BookService;
}

let dir = "";
let docs: DocRef[] = [];
let assemble: (context: PromptContext) => Promise<string>;

const chapter01: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };
const chapter02: DocRef = { relPath: "chapters/02-闸口.md", kind: "chapter", title: "闸口" };

function baseContext(over: Partial<PromptContext> = {}): PromptContext {
  return {
    title: "深渊之下",
    stageName: "正文",
    chapter: chapter01,
    permissionLabel: "只读参考",
    profileId: "writer",
    skillPaths: [],
    chapterOrder: meta.chapterOrder,
    ...over
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-book-prompt-"));
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await mkdir(path.join(dir, "characters"), { recursive: true });
  await mkdir(path.join(dir, "outline"), { recursive: true });
  await mkdir(path.join(dir, "materials"), { recursive: true });
  await writeFile(path.join(dir, "chapters", "01-开局.md"), "第一段\n雾从海面涌上来。\n第三段\n", "utf8");
  await writeFile(path.join(dir, "chapters", "02-闸口.md"), "第二段\n闸门在响。沈砚站在门口。\n", "utf8");
  // 超预算素材：单这一节就压爆 CONTEXT_CHAR_BUDGET，逼出 omitted 分支
  await writeFile(path.join(dir, "chapters", "09-长潮.md"), "潮".repeat(25000), "utf8");
  await writeFile(path.join(dir, "characters", "shen-yan.md"), "---\ntitle: 沈砚\n---\n\n人物卡。\n", "utf8");
  await writeFile(path.join(dir, "outline", "主线.md"), "大纲：铁锈味要贯穿。\n", "utf8");
  await writeFile(path.join(dir, "materials", "文风规约.md"), "句子要短。\n", "utf8");
  docs = await scanBook(dir);
  const reader = createFsContextReader({ book: fakeBook({ root: dir, meta, docs }) });
  assemble = createBookPromptAssembler({ book: fakeBook({ root: dir, meta, docs }), reader });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createBookPromptAssembler 分节渲染", () => {
  it("主笔档案：作品名、阶段、文稿、权限档、档案名与本章正文都进提示词", async () => {
    const text = await assemble(baseContext());
    expect(text).toContain("《深渊之下》");
    expect(text).toContain("创作阶段：正文");
    expect(text).toContain("chapters/01-开局.md");
    expect(text).toContain("档案：墨宸 · 主笔");
    expect(text).toContain("只读参考");
    expect(text).toContain("雾从海面涌上来");
    expect(text).toContain("```mochen-patch");
  });

  it("章次顺序与前情：写第 2 章时第 1 章尾部进提示词（chapterOrder 真的透传了）", async () => {
    const text = await assemble(baseContext({ chapter: chapter02 }));
    expect(text).toContain("闸门在响");
    expect(text).toContain("雾从海面涌上来");
  });

  it("挂入技能：skillPaths 指向的文稿正文进提示词", async () => {
    const text = await assemble(baseContext({ skillPaths: ["materials/文风规约.md"] }));
    expect(text).toContain("句子要短");
  });

  it("超预算整节丢弃时，中文省略说明进提示词", async () => {
    const text = await assemble(baseContext({ chapter: docs.find((d) => d.relPath === "chapters/09-长潮.md") ?? null }));
    expect(text).toContain("已省略");
  });

  it("未知 profileId 在装配器层兜底回默认档（startTurn 通路的可见 error 事件由 agent-service 用例钉）", async () => {
    const text = await assemble(baseContext({ profileId: "ghost-profile" }));
    expect(text).toContain("档案：墨宸 · 主笔");
  });

  it("没开书也不炸：只剩骨架与档案句，正文一节都没有", async () => {
    const empty = createBookPromptAssembler({
      book: fakeBook(null),
      reader: createFsContextReader({ book: fakeBook(null) })
    });
    const text = await empty(baseContext({ chapter: null }));
    expect(text).toContain("还没打开文稿");
    expect(text).toContain("档案：墨宸 · 主笔");
  });
});
```

改 `apps/desktop/src/main/agent-service.test.ts`（行号按现 785 行版本点名；动手前先回读一遍确认没漂移）：

1. 第 25 行 `import { createAgentService, defaultPromptFor, type AgentService } from "./agent-service.js";` 改为：

```ts
import { createAgentService, type AgentService } from "./agent-service.js";
import { createBookPromptAssembler } from "./book-prompt.js";
import { createFsContextReader } from "./context-reader.js";
```

2. 第 44–46 行 `turn()` 助手改为（`profileId` 必填是 Task 11 的契约；**若 Task 11 的连带已把本文件改到位，跳过 2/3/4 三处并核对**）：

```ts
function turn(docRelPath: string | null, userText: string, profileId = ""): StartTurnInput {
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", profileId, userText };
}
```

3. 第 304–312 行 `build()` 里 `createAgentService({...})`：把 `promptFor: defaultPromptFor`（第 311 行）换成装配器真身，并补 `reader`——在第 303 行 `};`（`spied` 定义结束）之后插入 `const reader = createFsContextReader({ book: spied });`，对象里改为：

```ts
    promptFor: createBookPromptAssembler({ book: spied, reader }),
    reader
```

4. 第 681–702 行整块删除（`defaultPromptFor 把作品名、阶段名、当前文稿与权限档写进系统提示` 用例连同 `});`）——函数已不存在，`defaultPromptFor` 也不再被 import。

5. 内联 `startTurn(...)` 字面量补 `profileId: ""`：第 707 行、720–725 行、736–741 行、751 行、763–768 行、776–781 行（共 6 处，每处形如 `{ threadKey: ..., docRelPath: ..., stageId: ..., userText: ... }`，在 `stageId` 之后插 `profileId: "",`）。

6. 文件末尾（`describe("agentService 全链", ...)` 的闭合 `});` 之前）追加三条新用例：

```ts
  it("审稿与续写档案的请求里没有 write_doc，系统提示词写着各自档案名（M7 钉这条）", async () => {
    for (const [profileId, displayName] of [
      ["reviewer", "墨宸 · 审稿"],
      ["continuator", "墨宸 · 续写"]
    ] as const) {
      const { fetchImpl, requests } = recordingFetch(proposeChunks);
      const { service } = await build(fetchImpl);
      await service.startTurn(turn(CHAPTER, "审一遍", profileId));
      const first = requests[0];
      if (first === undefined) throw new Error("请求必须发出");
      const body = JSON.parse(first.body) as {
        tools?: { function?: { name?: string } }[];
        messages?: { role: string; content?: string }[];
      };
      const toolNames = (body.tools ?? []).map((tool) => tool.function?.name);
      expect(toolNames).toContain("propose_patch");
      expect(toolNames).not.toContain("write_doc");
      expect(body.messages?.[0]?.content).toContain(`档案：${displayName}`);
      service.dispose();
    }
  });

  it("未知 profileId：回落默认档、发一条可见中文 error 并进历史，工单仍是全开五个", async () => {
    const { fetchImpl, requests } = recordingFetch(proposeChunks);
    const { service } = await build(fetchImpl);
    await service.startTurn(turn(CHAPTER, "随便写", "ghost-profile"));
    expect(errorMessages()).toContain(
      "档案「ghost-profile」不认识，已回落到默认档案〈墨宸 · 主笔〉，本轮继续。"
    );
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("回落事件必须随会话落盘，重启回放才看得见");
    expect(await readFile(path.join(root, ...rel.split("/")), "utf8")).toContain(
      "已回落到默认档案〈墨宸 · 主笔〉"
    );
    const first = requests[0];
    if (first === undefined) throw new Error("请求必须发出");
    const body = JSON.parse(first.body) as { tools?: { function?: { name?: string } }[] };
    expect(body.tools?.map((tool) => tool.function?.name)).toEqual([...AGENT_TOOL_NAMES]);
    service.dispose();
  });

  it("contextPreview 只装配不落盘：预览前后 .mochen 树一字不变、外发载荷零新增", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "第一轮"));
    const treeBefore = await treeOf(path.join(root, ".mochen"));
    const outboundBefore = outbound.length;
    const summary = await service.contextPreview({
      threadKey: CHAPTER,
      docRelPath: CHAPTER,
      stageId: "draft",
      profileId: "writer",
      skillPaths: []
    });
    expect(summary.sections.length).toBeGreaterThan(0);
    expect(summary.charCount).toBeGreaterThan(0);
    expect(await treeOf(path.join(root, ".mochen"))).toEqual(treeBefore);
    expect(outbound.length).toBe(outboundBefore);
    service.dispose();
  });
```

改 `apps/desktop/src/main/agent-service-boundary.test.ts`：

1. 第 19 行 import 同法去掉 `defaultPromptFor`，追加 `createBookPromptAssembler`/`createFsContextReader` 两行 import。
2. 第 101–109 行 `createAgentService({...})`：`promptFor: defaultPromptFor`（第 108 行）换成 `promptFor: createBookPromptAssembler({ book: spied, reader }),`，前插 `const reader = createFsContextReader({ book: spied });`，对象补 `reader`。
3. 内联 `startTurn` 字面量补 `profileId: ""`：第 139–143、155–159、178–182、196、209–213、228–232 行（共 6 处）。
4. `describe` 末尾追加：

```ts
  it("contextPreview 的拒绝也是单句中文：空 stageId 不含裸 ZodError 骨架", async () => {
    const { service } = await build();
    const message = await rejectMessage(
      service.contextPreview({
        threadKey: CHAPTER,
        docRelPath: CHAPTER,
        stageId: "",
        profileId: "writer",
        skillPaths: []
      })
    );
    expect(message).toContain("上下文预览的参数不对");
    service.dispose();
  });
```

改 `apps/desktop/src/main/turn-e2e.test.ts`：第 20 行 import 去掉 `defaultPromptFor` 并补两行 import；第 133–141 行 `createAgentService({...})` 里 `promptFor: defaultPromptFor`（第 140 行）换成 `promptFor: createBookPromptAssembler({ book, reader: createFsContextReader({ book }) }),` 并补 `reader: createFsContextReader({ book }),`；第 145–146 行 `turn()` 助手加 `profileId = ""` 第三参并写进返回对象（同 agent-service.test.ts 第 2 点）。

改 `apps/desktop/src/main/agent-ipc.test.ts`：

1. `stubService`（第 46–68 行）在 `diffOf` 之后补：

```ts
    async contextPreview(input: unknown) {
      seen.push(input);
      return { sections: [], charCount: 0, estimate: 0, omitted: [] };
    },
```

2. 第 90–99 行 order 断言数组末尾追加 `IPC_CHANNELS.agentContextPreview`（标题同步改成「注册六条 agent 通道」：波 1 的 Task 3 已经把 `agentLoadSession` 注册进 `registerAgentIpc`，那时长到五条，本任务再加这一条就是六条；`agentLoadSession` 保持在数组里的原位，新通道一律追加在**末尾**）。
3. 第 101–121 行「原样转给 service」用例里 `agentDiff` 之后追加：

```ts
    const previewInput = {
      threadKey: "chapters/01.md",
      docRelPath: "chapters/01.md",
      stageId: "draft",
      profileId: "writer",
      skillPaths: []
    };
    expect(await fire(fns, IPC_CHANNELS.agentContextPreview, previewInput)).toEqual({
      sections: [],
      charCount: 0,
      estimate: 0,
      omitted: []
    });
```

并把第 120 行 `expect(seen)` 末尾追加 `previewInput`。

- [ ] **Step 2：跑到红**

Run: `corepack pnpm vitest run apps/desktop/src/main/book-prompt.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/turn-e2e.test.ts apps/desktop/src/main/agent-ipc.test.ts --maxWorkers=4`

Expected（原文形态）：

```
FAIL  apps/desktop/src/main/book-prompt.test.ts [ Cannot find module './book-prompt.js' ... ]
FAIL  apps/desktop/src/main/agent-service.test.ts
  ✗ 审稿与续写档案的请求里没有 write_doc ... AssertionError: expected [ 'read_doc', 'list_docs', 'search_docs', 'propose_patch', 'write_doc' ] to not include 'write_doc'
  ✗ 未知 profileId ... 断言失败：errorMessages() 里没有那句「不认识，已回落到默认档案」的中文
  ✗ contextPreview 只装配不落盘 ... TypeError: service.contextPreview is not a function
FAIL  apps/desktop/src/main/agent-service-boundary.test.ts [ TypeError: service.contextPreview is not a function ]
FAIL  apps/desktop/src/main/turn-e2e.test.ts [ Cannot find module './book-prompt.js' ... ]
FAIL  apps/desktop/src/main/agent-ipc.test.ts [ order 数组与 agentContextPreview 断言对不上 / stubService 缺 contextPreview ]
```

若某条「新用例」意外绿了，说明它没钉住行为，回到 Step 1 加强断言，不许跳过红。

- [ ] **Step 3：实现**

新建 `apps/desktop/src/main/book-prompt.ts`，整文件落盘：

```ts
import {
  DEFAULT_PROFILE_ID,
  buildContextPack,
  profileById,
  protocolBlockHint,
  type ContextReader
} from "@mochen/agent-runtime";
import type { PromptContext } from "./agent-service.js";
import type { BookService } from "./book-service.js";

/**
 * Plan 3 spec §9.3 的装配收口：defaultPromptFor 的替代者。
 * 签名按接口总表取 { book, reader }——spec 里那个 profiles 参数不带了：
 * roster 由 agent-runtime 静态导入（唯一一份，铁律 6），多传一道数组只会分叉。
 * 未知 profileId 在这里静默兜底回默认档；那条可见 error 事件归 agent-service 的
 * startTurn 通路负责（它才有 turnId 可挂、才有 JSONL 可落）。
 */
export function createBookPromptAssembler(deps: {
  book: BookService;
  reader: ContextReader;
}): (context: PromptContext) => Promise<string> {
  return async function promptFor(context: PromptContext): Promise<string> {
    const profile = profileById(context.profileId) ?? profileById(DEFAULT_PROFILE_ID);
    if (profile === null) throw new Error("内部错误：默认档案不在花名册里，请检查 profiles.ts。");
    const pack = await buildContextPack(deps.reader, {
      docRelPath: context.chapter?.relPath ?? null,
      chapterOrder: context.chapterOrder,
      skillPaths: context.skillPaths
    });
    const header = [
      profile.systemPrompt,
      `当前作品：《${context.title}》；创作阶段：${context.stageName}；` +
        `当前文稿：${context.chapter?.relPath ?? "（用户还没打开文稿）"}。`,
      `档案：${profile.displayName}。权限档：${context.permissionLabel}。提案只有在用户批准后才写入磁盘。`,
      "改动文稿用 propose_patch（给 doc/anchor/replace/why），整篇重写用 write_doc。",
      "anchor 必须是文中逐字存在且唯一出现的片段；不确定就先 read_doc。",
      "只读档下不要承诺写入。"
    ];
    const sectionLines = pack.sections.map((section) => `【${section.label}】\n${section.text}`);
    if (pack.omitted.length > 0) {
      sectionLines.push(`（上下文已超预算，整节省略未送入：${pack.omitted.join("、")}。）`);
    }
    const body =
      sectionLines.length > 0
        ? ["以下是主进程按档案装配的当前上下文（只读快照）：", ...sectionLines].join("\n\n")
        : "（本轮没有可装配的上下文节。）";
    return [...header, body, protocolBlockHint].join("\n\n");
  };
}
```

改 `apps/desktop/src/main/agent-service.ts`（行号按现 513 行版本，动手前当场回读）：

1. **contracts import（第 2–16 行）**：花名里加 `contextPreviewInputSchema,`、`type ContextPreviewInput,`、`type ContextSummary,`（按现有字母序插入）。
2. **runtime import（第 17–32 行）**：删 `protocolBlockHint,`（它随 `defaultPromptFor` 一起搬去 book-prompt.ts），加 `buildContextPack,`、`contextSummaryOf,`、`profileById,`、`DEFAULT_PROFILE_ID,` 与 `type AgentProfile,`、`type ContextReader,`。
3. **`PromptContext`（第 41–46 行）** 整块替换为：

```ts
export interface PromptContext {
  title: string;
  stageName: string;
  chapter: DocRef | null;
  permissionLabel: string;
  /** 已回落过的合法档案 id（resolveProfile 的产物），装配器不会再见到未知值。 */
  profileId: string;
  /** 波 3 给 StartTurnInput 加 skillPaths 后改成 input.skillPaths ?? []；本轮 startTurn 恒 []，预览通路先走满。 */
  skillPaths: string[];
  chapterOrder: string[];
}
```

4. **删除第 48–63 行**（`defaultPromptFor` 的 doc 注释与函数整体）。
5. **`AgentServiceDeps`（第 65–73 行）**：`promptFor(context: PromptContext): string;` 改为 `promptFor(context: PromptContext): Promise<string>;`，并加一行：

```ts
  /** 预览与真实装配共用同一个 fs 版 ContextReader：占用条显示的就是实际发送的装配结果。 */
  reader: ContextReader;
```

6. **`AgentService` 接口（第 75–82 行）** 追加：

```ts
  /** 只装配、不落盘、不建会话、不写 JSONL；未知 profileId 静默回落默认档（事件归 startTurn 通路）。 */
  contextPreview(input: ContextPreviewInput): Promise<ContextSummary>;
```

7. **模块级新增**（`ruleKey` 函数之后、`createAgentService` 之前）：

```ts
/**
 * 档案回落（Plan 3 spec §9.1 末段）：未知 id 绝不静默——startTurn 通路必须发一条
 * 可见 error 事件并随会话落盘，整句中文定稿，测试用 toBe 钉死。
 */
function resolveProfile(rawId: string): { profile: AgentProfile; fallbackMessage: string | null } {
  const wanted = rawId.trim() === "" ? DEFAULT_PROFILE_ID : rawId.trim();
  const found = profileById(wanted);
  const fallback = profileById(DEFAULT_PROFILE_ID);
  if (fallback === null) throw new Error("内部错误：默认档案不在花名册里，请检查 profiles.ts。");
  if (found !== null) return { profile: found, fallbackMessage: null };
  return {
    profile: fallback,
    fallbackMessage: `档案「${rawId.trim()}」不认识，已回落到默认档案〈${fallback.displayName}〉，本轮继续。`
  };
}
```

8. **`startTurn` 内**（`const rel = await threadFor(input, threadKey, config.model);` 之后，现第 425 行下面）插入：

```ts
        const { profile, fallbackMessage } = resolveProfile(input.profileId);
        if (fallbackMessage !== null) {
          publish(threadKey, {
            id: deps.newId(),
            ts: deps.isoNow(),
            turnId,
            type: "error",
            message: fallbackMessage
          });
        }
        // 档案闸 1（spec §9.2 请求侧）：花名册没给的工具连声明都不发给模型——M7 钉的就是这个集合。
        const allowedToolNames = new Set<string>(profile.allowedTools);
```

9. **`context` 构造**（现第 430–436 行）补三字段：

```ts
        const context: PromptContext = {
          title: current.meta.title,
          stageName:
            current.meta.stages.find((stage) => stage.id === input.stageId)?.name ?? input.stageId,
          chapter: current.docs.find((doc) => doc.relPath === docRelPath) ?? null,
          permissionLabel: PERMISSION_LABELS[current.meta.permissionMode],
          profileId: profile.id,
          skillPaths: [],
          chapterOrder: current.meta.chapterOrder
        };
```

10. **`stream` 包装**（现第 439 行）`stream: (req) => streamChat({ ...req, fetchImpl: deps.fetchImpl }),` 替换为：

```ts
            stream: (req) =>
              streamChat({
                ...req,
                // 按档案过滤后才进 stream(req) 的 tools（spec §9.2 闸 1）；写回原样直传就是 M7 的变异。
                tools: req.tools.filter((spec) => allowedToolNames.has(spec.name)),
                fetchImpl: deps.fetchImpl
              }),
```

11. **`systemPrompt` 传参**（现第 453 行）`systemPrompt: deps.promptFor(context),` 改为 `systemPrompt: await deps.promptFor(context),`。
12. **返回对象**（`diffOf` 之前）追加：

```ts
    async contextPreview(input: ContextPreviewInput): Promise<ContextSummary> {
      // 跨 IPC 的入参照 startTurn/decide 同一层姿势校验（裁定 n）：拒绝必须是单句中文。
      const parsed = contextPreviewInputSchema.safeParse(input);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "上下文预览的参数不对，请重试。"));
      const current = deps.book.current();
      if (current === null) throw new Error("尚未打开作品目录，请先在左栏选择一本书。");
      // 只装配：不 threadFor、不 publish、不 appendAgentEvent——任何落盘都不许发生。
      const pack = await buildContextPack(deps.reader, {
        docRelPath: parsed.data.docRelPath,
        chapterOrder: current.meta.chapterOrder,
        skillPaths: parsed.data.skillPaths
      });
      return contextSummaryOf(pack);
    },
```

改 `apps/desktop/src/main/agent-ipc.ts`：contracts import 花名补 `type ContextPreviewInput`；`registerAgentIpc` 内第 20 行（`agentDiff` 那行）之后追加：

```ts
  handle(IPC_CHANNELS.agentContextPreview, (_event, input) =>
    service.contextPreview(input as ContextPreviewInput)
  );
```

（顶部注释「只注册那四条」同步改成如实的条数描述。）

改 `apps/desktop/src/main/index.ts`：第 6 行 import 去掉 `defaultPromptFor`，补两行 import；第 46 行 `createAgentService({` 之前插 `const contextReader = createFsContextReader({ book: service });`；第 60 行 `promptFor: defaultPromptFor` 换成：

```ts
    promptFor: createBookPromptAssembler({ book: service, reader: contextReader }),
    reader: contextReader
```

- [ ] **Step 4：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/main/book-prompt.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/turn-e2e.test.ts apps/desktop/src/main/agent-ipc.test.ts --maxWorkers=4`

Expected: `Test Files 5 passed (5)`，`Tests NN passed`（NN 以输出为准贴进报告；相对基线净增 9 条：book-prompt 6 + agent-service 3 + boundary 1 − 删除的 defaultPromptFor 1，agent-ipc/turn-e2e 条数不变）。若个别文件红且每次红的点相同，按文件单独重跑定位，不是 dev 假红灯（本任务不跑 dev）。

Run: `corepack pnpm prettier --write apps/desktop/src/main && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.node.json && node tools/check-package-boundary.mjs && node tools/check-source-line-budget.mjs`

Expected: tsc 退出码 0（所有 `promptFor` 注入点已换完，中间提交必须过 tsc——铁律 5）；边界门禁 0；行数门禁 0（`agent-service.ts` ≈585 行 <800，不触发拆分预案）。

- [ ] **Step 5：连带清单（夹具逐个点名，一个都不许漏）**

1. `agent-service.test.ts`：import 行、`turn()` 助手、`build()` 第 304–312 行、删 681–702 用例、6 处内联 `startTurn` 字面量（707/720/736/751/763/776 区间）、3 条新用例。
2. `agent-service-boundary.test.ts`：import 行、`build()` 第 101–109 行、6 处内联字面量（139/155/178/196/209/228 区间）、1 条新用例。
3. `turn-e2e.test.ts`：import 行（20）、`createAgentService`（133–141）、`turn()` 助手（145–146）。
4. `agent-ipc.test.ts`：`stubService.contextPreview`、order 数组、fire 断言与 `seen` 序列。
5. `index.ts`：`defaultPromptFor` 引用清零——`grep -rn "defaultPromptFor" apps packages` 必须**零命中**。
6. `agent-service.ts` 行数 ≤800（触发拆分预案才动 `proposal-approval.ts`，动则提交信息注明）。
7. 非本任务边界、但执行时要亲眼确认的：渲染层 `useAgentStore.send()` 与 preload 的 `StartTurnInput` 字面量归 Task 18/12 管；若根 tsc 在 `tsconfig.web.json` 报渲染层缺 `profileId`，那是 Task 11/18 的连带漏项，**记下文件名与行号写进报告，本任务不越界改渲染层**。
8. `agent:context-preview` 自此有 handler：Task 12–15 区间的「真机通路未通」口径在本任务末尾作废，波 2 收尾冒烟要验占用条。

- [ ] **Step 6：变异实验 M7（台账项，实现者自跑并贴红/绿两段输出；只用 Edit 改，禁 `perl -i`/`sed -i`）**

1. 注入：把 `agent-service.ts` 第 10 点新增的 `stream` 包装改回直传——删掉 `tools: req.tools.filter((spec) => allowedToolNames.has(spec.name)),` 这一行（`allowedToolNames` 悬空会让 tsc 报未使用，属预期噪音，不跑 tsc 只跑 vitest）。
2. Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts -t "M7" --maxWorkers=4`
   Expected 红（原文形态，必须贴进报告）：`expected [ 'read_doc', 'list_docs', 'search_docs', 'propose_patch', 'write_doc' ] to not include 'write_doc'`——证明「审稿/续写的 tools 里没有 write_doc」这条断言真能失败。
3. 写回：把那行 filter 原样加回，重跑同命令，Expected 全绿，同样贴输出。

- [ ] **Step 7：提交**

```bash
git add apps/desktop/src/main/book-prompt.ts apps/desktop/src/main/book-prompt.test.ts apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/turn-e2e.test.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(main): promptFor 异步化——档案提示词装配器、按档案过滤工具与 context-preview"
```

Expected: `git status --short` 只剩与本任务无关的文件（或干净）；`git log --oneline -1` 显示上述中文标题。

### Task 17：主进程 —— 档案范围闸（第二道闸，M6）+ `autoSession` 键改造

> 前置：Task 11（`StartTurnInput.profileId` 必填、`""` ⇒ 默认档）、Task 13（`AGENT_PROFILES` / `profileById` / `DEFAULT_PROFILE_ID` / `profileAllowsDoc` / `WriteScope` 已从 `@mochen/agent-runtime` barrel 导出）、Task 16（`resolveProfile` 已在 `startTurn` 里落定 `profile` 变量、`turn()` 测试助手已带 `profileId` 第三参）已合入。
>
> 本任务只做**审批侧**的第二道闸（M6）与 `autoSession` 的键改造；请求侧的工具过滤（M7）归 Task 16，不在此重复。

**Files:**

- Modify: `apps/desktop/src/main/agent-service.ts`（现 513 行 → 约 562 行：模块级加 `autoKey`/`writeScopePhrase`、服务内加 `profileIdByThread` 与 `profileOfThread`、`applyDecision` 在档位闸之后插档案范围闸、`autoSession` 两处读写换键、`dispose` 清表）
- Modify: `apps/desktop/src/main/agent-service.test.ts`（现 785 行：既有 `autoSession` 旧键用例连带核对 + 本任务新用例，逐点见 Step）
- Modify: `apps/desktop/src/main/agent-service-boundary.test.ts`、`turn-e2e.test.ts`（**本任务不改**：只在 Step 6d 的定向回归里核对，这两处若因换键转红就是真回归，按 §「受影响夹具」处理）

**Interfaces:**

逐字照本计划「接口总表 → 波 2」小节的 `AgentProfile` / `profileAllowsDoc` / `DEFAULT_PROFILE_ID` 三段（搜 `### 波 2` 即到）与 Plan 3 spec §9.2，不改名：

```ts
// Consumes —— packages/agent-runtime（Task 13 已落，barrel 已导出；本任务禁止改 runtime）
export function profileAllowsDoc(
  scope: WriteScope, docRelPath: string, currentChapter: string | null
): boolean;
export function profileById(id: string): AgentProfile | null;
export const DEFAULT_PROFILE_ID = "writer";
export type WriteScope = { kind: "none" } | { kind: "current-chapter" } | { kind: "dirs"; dirs: readonly string[] };
export interface AgentProfile { /* id/displayName/blurb/systemPrompt/allowedTools/writeScope/buildSections */ }

// Consumes —— apps/desktop/src/main/agent-service.ts 的现有形状（Task 16 之后）
AgentServiceDeps.promptFor(context: PromptContext): Promise<string>;   // 本任务不动 deps
// 本任务不新增/不修改任何 AgentServiceDeps、AgentService 的对外字段：闸与键全是 createAgentService 闭包内部状态。

// Produces —— applyDecision 的新返回语义（在既有 permission-denied 之外新增第二个来源）
//   档位闸（现 :286-300）不动；紧随其后新增档案范围闸：
{ ok: false; reason: "permission-denied"; message: string }   // message ＝下面这句定稿模板，且不删 pending
//   定稿模板：`这条超出〈${profile.displayName}〉的可写范围（${writeScopePhrase(profile.writeScope)}），提案已保留。`
//   writeScopePhrase：none ⇒「不写盘」／current-chapter ⇒「只写当前章」／dirs ⇒「只写 ${dirs.join("、")}」

// Produces —— autoSession 新键格式（p 键 ruleKey = `${docRelPath}::${tool}` 一律不动）
function autoKey(threadKey: string, profileId: string): string;   // `${threadKey}::${profileId}`

// Produces —— 主进程内部状态（Task 18 依赖的口径）
const profileIdByThread = new Map<string, string>();   // startTurn 解析后写；切档案只覆盖这一格
// Task 18（渲染层档案选择器）依赖：**切档案绝不动线程**——同 threadKey 再 startTurn 只改
// profileIdByThread，threads/pending/diffs/controllers 四项一律不变，已删的 pending 不复活。
```

受影响的现有测试夹具与用例（**执行前逐个核对，不许凭记忆**）：

| 位置 | 现状 | 本任务怎么办 |
| --- | --- | --- |
| `apps/desktop/src/main/agent-service.test.ts:44-46` | `turn(docRelPath, userText)` 两参；Task 16 已改成三参 `profileId = ""` | 本任务的新用例一律走三参形式；若 Task 16 还没落三参，**照本计划 Task 16 夹具段对 `turn()` 助手的规定补齐**（那是 Task 16 的连带项，不在本任务范围），不得自己发明第四参 |
| `agent-service.test.ts:468-485`「『本会话不再问』之后同线程的新提案自动落盘并标 auto」 | 按旧 `autoSession` 裸 `threadKey` 写 | **预期继续绿**：两轮 `turn(CHAPTER, …, "")` 都归一到 `writer`，换键后两次都是 `chapters/01-开局.md::writer`。Step 6 要亲眼看到它绿 |
| `agent-service.test.ts:487-507`「被权限档拒掉的 accept-session 不会开启自动批准」 | 同上 | **预期继续绿**：拒绝路径压根不 `add` |
| `agent-service.test.ts:363-382`「批准那一刻权限收紧 → permission-denied…」 | 只断 `reason` 与 `toContain("只读参考")` | Step 1 给它补一条**档位定稿整句 `toBe`**（两句拒绝文案分开） |
| `agent-service-boundary.test.ts:108`、`turn-e2e.test.ts:133-146` | 夹具里有 `promptFor`，`startTurn` 载荷带 `profileId`（Task 16 落） | 本任务不动它们；Step 6 的定向回归跑必须把这三个文件一起跑，换键若打红就是真回归，按报错回到实现修 |
| `packages/agent-runtime/test/permission.test.ts:43-48` | 中文定稿整句用 `toBe` 钉死的样板 | **只借写法，不改此文件**（禁改 runtime） |

- [ ] **Step 0：先核对前置落点与受影响夹具（只读，不许跳过）**

  执行前用 Grep 定点确认（**不要整文件通读**；行号会在 Task 16 之后漂移，一律以「原文片段」为准）：

  1. `Grep apps/desktop/src/main/agent-service.ts` 里 `const autoSession = new Set<string>();`、`autoSession.has(threadKey)`、`autoSession.add(threadKey)`、`currentChapter: threadKey === UNBOUND ? null : threadKey`、`const { profile, fallbackMessage } = resolveProfile(` 五处，逐处抄下当前行号。
     - 第 5 处**找不到** ⇒ Task 16 还没合入，**立刻停下报错**，不要在旧 `defaultPromptFor` 形状上做本任务。
  2. `Grep apps/desktop/src/main/agent-service.test.ts` 里 `function turn(` ⇒ 必须是三参 `(docRelPath: string | null, userText: string, profileId = "")`（Task 16 落的样子）。不是 ⇒ 同样停下，本任务不代做 Task 16。
  3. `Grep packages/agent-runtime/src/index.ts` 里 `profiles.js` ⇒ 必须有一行 `export * from "./profiles.js";`（Task 13）。缺 ⇒ 停下报错；**禁止自己往 runtime 加导出**（本任务不许改 `packages/agent-runtime`）。
  4. 记下 Interfaces 表里那六个受影响区间（`agent-service.test.ts:44-46 / 363-382 / 468-485 / 487-507`、`agent-service-boundary.test.ts:108`、`turn-e2e.test.ts:133-146`）在当下的真实行号，写进执行记录——后面每一步都要用真实行号复核。

- [ ] **Step 1：先写红的测试 —— 档案范围闸（三句定稿整句 + 拒绝后提案仍在可再裁决）**

  改 `apps/desktop/src/main/agent-service.test.ts`。

  1a. 在文件顶部常量区（`const proposeAgain = ...;` 之后，现 `:177`）追加三条桩：

  ```ts
  const reviewerWriteDoc = writeDocChunks("wr1", CHAPTER, "整篇重写后的正文\n", "审稿顺手改了正文");
  const writeOutlineDoc = writeDocChunks("wr2", "outline/第一卷.md", "大纲重写\n", "整篇重写");
  const proposeOnOther = toolCallChunks("c7", OTHER, "闸门在响。", "闸门在响，水线下沉。", "补落点");
  const proposeThird = toolCallChunks("c8", CHAPTER, "闸门在响。", "闸门在响，水线在下沉。", "补落点");
  ```

  > `proposeThird` 归 Step 5 的 `autoSession` 用例用，Step 1 先一起加进来，省一次改文件。
  > `writeOutlineDoc` 归「未知 profileId」那条用：主笔的范围是「只写当前章」，而那条用例的线程绑的是 `CHAPTER`，所以越界文稿必须落在 `outline/` 而不是本章——否则档案闸会放行，用例假绿。

  > 为什么审稿/主笔的越界提案**照样能生成**：Task 16 的档案过滤只删「发给模型的工具声明」（M7），而 `packages/agent-runtime/src/tool-loop.ts:190-201` 的派发只校验 `toolNameOf(call.name)` 是否属于五个已知工具，不比对本次请求声明了哪些。桩回来的 `write_doc` 因此照样落成提案——**这正是 spec §9.2 要第二道闸的理由**：请求侧过滤挡不住不守规矩的端点，审批侧必须自己再判一次。

  1b. 给现有的档位用例补「档位定稿整句」（把两句拒绝文案分开钉死）。在 `it("批准那一刻权限收紧 → permission-denied，提案留在 pending，档位放开后能重试", ...)` 内（现 `:372`）把

  ```ts
    if (!denied.ok) expect(denied.reason).toBe("permission-denied");
  ```

  替换为：

  ```ts
    if (!denied.ok) {
      expect(denied.reason).toBe("permission-denied");
      // 档位原因的定稿整句（与 packages/agent-runtime/test/permission.test.ts:46-49 同一句）：
      // Task 17 加档案闸后，这句**不许**被档案范围句替换或拼接——两句各有各的用例。
      expect(denied.message).toBe(
        "当前权限档为「只读参考」，提案不会写入磁盘。" +
          "可以先给出提案与理由；确实要落盘时，把权限档切到「可改当前章」或「全开」后再批准。"
      );
    }
  ```

  这条**本来就应当是绿的**（现有实现已经返回这句），它是「两句拒绝文案分开」的守卫，不是新行为。

  1c. 在文件末尾 `describe("agentService 全链", ...)` 的收尾 `});` **之后**追加一个新的顶层 describe（测试写盘全部走既有 `build()` 里的 `mkdtemp`，本任务不新增任何 fs 夹具）：

  ```ts
  describe("档案范围闸（Plan 3 Task 17 · 变异 M6）", () => {
    it("审稿档案批准 write_doc：档案范围闸拒绝，整句点名〈墨宸 · 审稿〉且提案留在 pending", async () => {
      const { service, writes } = await build(sseFetch(reviewerWriteDoc));
      await service.startTurn(turn(CHAPTER, "把整篇重写", "reviewer"));
      const id = proposalIds()[0] ?? "";
      if (id === "")
        throw new Error("审稿档案下 write_doc 提案必须照样生成：请求侧过滤只挡声明，审批侧才管范围");
      expect(proposalEvents()[0]?.proposal.tool).toBe("write_doc");
      const denied = await service.decide({
        proposalId: id,
        decision: "accept-once",
        guidance: ""
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.reason).toBe("permission-denied");
        expect(denied.message).toBe("这条超出〈墨宸 · 审稿〉的可写范围（不写盘），提案已保留。");
      }
      expect(writes).toEqual([]);
      expect(await chapterFile()).toBe(CHAPTER_TEXT);
      expect(errorMessages()).toContain(
        "这条提案没有写入：这条超出〈墨宸 · 审稿〉的可写范围（不写盘），提案已保留。"
      );
      // 拒绝不删 pending：同一条提案换成主笔后照样批得动（范围是上限不是授权）
      await service.startTurn(turn(CHAPTER, "换主笔再来", "writer"));
      const retried = await service.decide({
        proposalId: id,
        decision: "accept-once",
        guidance: ""
      });
      expect(retried.ok).toBe(true);
      expect(await chapterFile()).toBe("整篇重写后的正文\n");
      service.dispose();
    });

    it("主笔档案批准另一章的提案：范围句点名「只写当前章」", async () => {
      const { service, writes } = await build(sseFetch(proposeOnOther));
      await service.startTurn(turn(CHAPTER, "顺手改下一章", "writer"));
      const denied = await service.decide({
        proposalId: proposalIds()[0] ?? "",
        decision: "accept-once",
        guidance: ""
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok)
        expect(denied.message).toBe("这条超出〈墨宸 · 主笔〉的可写范围（只写当前章），提案已保留。");
      expect(writes).toEqual([]);
      service.dispose();
    });

    it("世界档案改正文：范围句点名「只写 materials、outline」", async () => {
      const { service, writes } = await build(sseFetch(proposeChunks));
      await service.startTurn(turn(CHAPTER, "往正文里塞世界观", "world"));
      const denied = await service.decide({
        proposalId: proposalIds()[0] ?? "",
        decision: "accept-once",
        guidance: ""
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok)
        expect(denied.message).toBe(
          "这条超出〈墨宸 · 世界〉的可写范围（只写 materials、outline），提案已保留。"
        );
      expect(writes).toEqual([]);
      service.dispose();
    });

    it("未知 profileId 的提案按 DEFAULT_PROFILE_ID 判范围：拒绝句点名〈墨宸 · 主笔〉", async () => {
      const { service } = await build(sseFetch(writeOutlineDoc));
      await service.startTurn(turn(CHAPTER, "载荷被人改过", "ghost-profile"));
      // Task 16 的可见回落句照样在（两条通路共用同一个常量兜底，不各写一套）
      expect(errorMessages()).toContain(
        "档案「ghost-profile」不认识，已回落到默认档案〈墨宸 · 主笔〉，本轮继续。"
      );
      const denied = await service.decide({
        proposalId: proposalIds()[0] ?? "",
        decision: "accept-once",
        guidance: ""
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok)
        expect(denied.message).toBe("这条超出〈墨宸 · 主笔〉的可写范围（只写当前章），提案已保留。");
      service.dispose();
    });

    it("空串 profileId（渲染层没选档）按 DEFAULT_PROFILE_ID 判范围：当前章的提案照样批得动", async () => {
      const { service, writes } = await build(sseFetch(proposeChunks));
      await service.startTurn(turn(CHAPTER, "改紧一点", ""));
      const ok = await service.decide({
        proposalId: proposalIds()[0] ?? "",
        decision: "accept-once",
        guidance: ""
      });
      expect(ok.ok).toBe(true);
      expect(writes).toEqual([CHAPTER]);
      service.dispose();
    });
  });
  ```

  > `errorMessages()` 里那条断言照的是实现要 `publish` 的一条 `error` 事件（与档位闸 `:295-298` 同一姿态）。若执行时你认为「回喂模型的可见事件」与「IPC 返回值」不该重复同一句，**仍按上面照抄**：档位闸今天就是这么双发的（`这条提案没有写入：${permission.reason}`）。

- [ ] **Step 2：跑红并贴出输出（不许跳过、不许只报「红了」）**

  Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`

  期望（把真实输出整段贴进执行记录）：

  - **4 条 FAIL**，用例名分别是：`审稿档案批准 write_doc：档案范围闸拒绝，整句点名〈墨宸 · 审稿〉且提案留在 pending`、`主笔档案批准另一章的提案：范围句点名「只写当前章」`、`世界档案改正文：范围句点名「只写 materials、outline」`、`未知 profileId 的提案按 DEFAULT_PROFILE_ID 判范围：拒绝句点名〈墨宸 · 主笔〉`。
  - `空串 profileId（渲染层没选档）按 DEFAULT_PROFILE_ID 判范围：当前章的提案照样批得动` 与 Step 1b 的档位整句 **本来就是绿的**（它们钉的是「不许变坏」，不是新行为）。
  - 其余既有用例全绿。
  - **若 FAIL 数不是 4**：先回读失败消息再动手。看到 `writes` 里出现 `chapters/…` 说明是预期的「没闸就写盘」；看到 `not-pending`／`stale`／`Cannot read properties of undefined` 说明夹具或桩脚标本用错了，回 Step 0/1 修夹具，**不要为了凑绿改断言**。

- [ ] **Step 3：实现 —— 档案范围闸 + 线程档案表**

  全部改动在 `apps/desktop/src/main/agent-service.ts`。五处 Edit，顺序照做。

  3a. **import 补四个符号**（现 `:17-32` 的 `@mochen/agent-runtime` 具名 import 列表；该列表按「函数名大小写不敏感字母序、`type` 在后」排）。把

  ```ts
    appendAgentEvent,
    applyPatch,
    checkWritePermission,
    createSession,
    eventsToMessages,
    findLatestSession,
    protocolBlockHint,
  ```

  替换为：

  ```ts
    appendAgentEvent,
    applyPatch,
    checkWritePermission,
    createSession,
    DEFAULT_PROFILE_ID,
    eventsToMessages,
    findLatestSession,
    profileAllowsDoc,
    profileById,
    protocolBlockHint,
  ```

  再把

  ```ts
    type ChatMessage,
    type ProviderFetch,
    type ToolHost
  } from "@mochen/agent-runtime";
  ```

  替换为：

  ```ts
    type AgentProfile,
    type ChatMessage,
    type ProviderFetch,
    type ToolHost,
    type WriteScope
  } from "@mochen/agent-runtime";
  ```

  若 eslint 对排序有独立意见，**照报错顺序调整、不改符号集合**；本任务禁止新增 npm 依赖、禁止改 `packages/agent-runtime` 的任何文件。

  3b. **模块级两个纯函数**（紧接现 `:112-114` 的 `ruleKey` 函数收尾 `}` 之后插入）：

  ```ts
  /**
   * `a` 键（本会话不再问）的作用域（Plan 3 spec §2 D4）：会话线程 + 档案，两者都要。
   * 只按 profileId 会让 A 章的「不再问」漏到 B 章＝跨章越权；只按 threadKey 会让切档案后
   * 继承上一档的「不再问」。`p` 键走 ruleKey（文档::工具），形状一字不改。
   */
  function autoKey(threadKey: string, profileId: string): string {
    return `${threadKey}::${profileId}`;
  }

  /** 档案写入范围的中文一句话，只用于拒绝文案点名范围（spec §9.2：范围是上限不是授权）。 */
  function writeScopePhrase(scope: WriteScope): string {
    if (scope.kind === "none") return "不写盘";
    if (scope.kind === "current-chapter") return "只写当前章";
    return `只写 ${scope.dirs.join("、")}`;
  }
  ```

  3c. **服务内状态与查档函数**（`createAgentService` 体内，真实缩进 **2 格**）。把现 `:119-124` 的

  ```ts
    const threads = new Map<string, string>();
    const controllers = new Map<string, AbortController>();
    // §6 的 a / p 两态：a 键在会话线程，p 键在「文档::工具」。
    // Plan 3 引入 AgentProfile 后把 autoSession 的键换成 profileId（spec §5.1 约束 1）。
    const autoSession = new Set<string>();
    const autoDocTool = new Set<string>();
  ```

  替换为：

  ```ts
    const threads = new Map<string, string>();
    // 线程 → 这条线程当前生效的档案 id。Task 18 的「切档案不换线程」就落在这张表上：
    // 同 threadKey 再开一轮只覆盖这一格，threads/pending/diffs/controllers 四项一律不动。
    const profileIdByThread = new Map<string, string>();
    const controllers = new Map<string, AbortController>();
    // §6 的 a / p 两态：a 键在「会话线程::档案」，p 键在「文档::工具」（Plan 3 spec §2 D4）。
    const autoSession = new Set<string>();
    const autoDocTool = new Set<string>();
  ```

  再在 `function snapshot(): BookSnapshot { ... }`（现 `:130-134`）之后插入：

  ```ts
    /**
     * 这条线程当前生效的档案。未知 id 与「表里没有这条线程」（老会话遗留、进程刚重启后仍留在
     * pending 里的键）都按 DEFAULT_PROFILE_ID 判：与 startTurn 的 resolveProfile 用同一个常量兜底，
     * 同一条提案在「开轮」与「审批」两条通路上绝不会拿到两种判定（spec §9.1 末段／§9.2）。
     */
    function profileOfThread(threadKey: string): AgentProfile {
      const fallback = profileById(DEFAULT_PROFILE_ID);
      if (fallback === null) throw new Error("内部错误：默认档案不在花名册里，请检查 profiles.ts。");
      return profileById(profileIdByThread.get(threadKey) ?? DEFAULT_PROFILE_ID) ?? fallback;
    }
  ```

  3d. **startTurn 记档案**（`try` 块内，真实缩进 **8 格**）。Task 16 落在 `startTurn` 里的那一行之后插一行（用 Grep 定位 `const { profile, fallbackMessage } = resolveProfile(input.profileId);`，行号会漂）：

  ```ts
          profileIdByThread.set(threadKey, profile.id);
  ```

  3e. **档案范围闸**（`applyDecision` 体内，真实缩进 **4 格**）。把现 `:286-300`（档位闸整段，从 `// 档位闸的是「落地」这一刀` 到该 `if (!permission.allowed) { … }` 的收尾 `}`）替换为：

  ```ts
      // 审批时的「当前章」＝这条提案所绑线程的文稿：档位闸与档案闸共用同一个口径。
      // 不取「右栏当前活动标签」——那会让别的章的提案借到本章的写入范围（spec §9.2 末段）。
      const currentChapter = threadKey === UNBOUND ? null : threadKey;
      // 档位闸的是「落地」这一刀：提案生成时不判档（只读档也要能出建议），批准时才判。
      const permission = checkWritePermission({
        mode: current.meta.permissionMode,
        docRelPath: proposal.docRelPath,
        currentChapter
      });
      if (!permission.allowed) {
        // 不删 pending：档位收紧只挡这一步，放开后同一条提案还能批准（§5.1 约束 3）
        publish(
          threadKey,
          event({ type: "error", message: `这条提案没有写入：${permission.reason}` })
        );
        return { ok: false, reason: "permission-denied", message: permission.reason };
      }

      // 档案范围闸（spec §9.2 闸 2）：档位放行 ≠ 档案可写。顺序不能反——档位原因先说、
      // 档案原因后说，两句拒绝文案各自独立，各有一条定稿整句用例钉着。
      const scopeProfile = profileOfThread(threadKey);
      const scope = scopeProfile.writeScope;
      if (!profileAllowsDoc(scope, proposal.docRelPath, currentChapter)) {
        const scopeMessage =
          `这条超出〈${scopeProfile.displayName}〉的可写范围（${writeScopePhrase(scope)}），提案已保留。`;
        // 与档位闸同一姿态：拒绝**不删 pending**，换档案或放开范围后同一条提案还能批准（M6 钉的就是这一步）
        publish(threadKey, event({ type: "error", message: `这条提案没有写入：${scopeMessage}` }));
        return { ok: false, reason: "permission-denied", message: scopeMessage };
      }
  ```

  > 原 `:290-291` 那两行注释（`// 审批时的「当前章」取这条提案所绑线程的文稿；Plan 3 换成随右栏活动标签走`）**被 3e 的新注释取代**，不要留着当第二份口径。
  >
  > **与 Plan 3 spec §7 文案口径的接合**：§7 那句「已经拒绝或取消的提案不会回来，切档后请在新一轮里重新提出」只对 `cancel` / `deny-with-guidance`（现 `:274-284`，删 pending）与 `stale`（现 `:316-318`，删 pending）成立；**档位闸与档案闸这两道拒绝都保留 pending**，所以切档/换档案后同一条提案照样能批。Task 18 写 UI 说明时必须按这三类分开——本步骤把它写进代码注释，就是为了让 Task 18 的文案有据可查。

- [ ] **Step 4：跑绿 + 行数自查**

  Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`
  期望：Step 1 新增 5 条 + 既有全绿。

  Run: `wc -l apps/desktop/src/main/agent-service.ts`
  期望：约 **562 行**（513 + 约 49），必须 < 800。

  Run: `corepack pnpm exec node tools/check-source-line-budget.mjs`
  期望：无输出、退出码 0（脚本里 `const LIMIT = 800;`）。

  Run: `corepack pnpm exec prettier --check apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts`
  期望：`All matched files use Prettier code style!`。报了格式差异就跑 `corepack pnpm exec prettier --write` 这两个文件，**只这两个**。
- [ ] **Step 5：先写红的测试 —— `autoSession` 键（跨章不泄漏 + 同章同档案才自动）**

  改 `apps/desktop/src/main/agent-service.test.ts`：在 Step 1c 那个 `describe("档案范围闸（Plan 3 Task 17 · 变异 M6）", ...)` 收尾 `});` 之后，再追加一个顶层 describe（夹具函数 `build/turn/sseFetch/STOP/proposeChunks/proposeAgain/proposeOnOther` 全是模块级，可直接用；测试写盘仍走 `build()` 里的 `mkdtemp`）。

  ```ts
  describe("autoSession 键＝线程::档案（Plan 3 Task 17 · spec §2 D4）", () => {
    it("A 章按『本会话不再问』不泄漏到 B 章：B 章同工具同档案仍要审批", async () => {
      const { service } = await build(sseFetch(proposeChunks, STOP, proposeOnOther));
      await service.startTurn(turn(CHAPTER, "第一条", "writer"));
      const first = await service.decide({
        proposalId: proposalIds()[0] ?? "",
        decision: "accept-session",
        guidance: ""
      });
      expect(first.ok).toBe(true);
      await service.startTurn(turn(OTHER, "换一章", "writer"));
      expect(proposalIds()).toHaveLength(2);
      expect(writtenEvents()).toHaveLength(1);
      expect(decisions()).toHaveLength(1);
      const manual = await service.decide({
        proposalId: proposalIds()[1] ?? "",
        decision: "accept-once",
        guidance: ""
      });
      expect(manual.ok).toBe(true);
      expect(await chapterFile(OTHER)).toContain("闸门在响，水线下沉。");
      service.dispose();
    });

    it("同章换档案不继承『不再问』：主笔按过后换续写仍要审批，续写再按一次才自动", async () => {
      const { service } = await build(
        sseFetch(proposeChunks, STOP, proposeAgain, STOP, proposeThird)
      );
      await service.startTurn(turn(CHAPTER, "第一条", "writer"));
      const asWriter = await service.decide({
        proposalId: proposalIds()[0] ?? "",
        decision: "accept-session",
        guidance: ""
      });
      expect(asWriter.ok).toBe(true);
      expect(await chapterFile()).toContain("海雾涌上来");

      await service.startTurn(turn(CHAPTER, "换续写档案", "continuator"));
      expect(proposalIds()).toHaveLength(2);
      expect(writtenEvents()).toHaveLength(1);
      const asContinuator = await service.decide({
        proposalId: proposalIds()[1] ?? "",
        decision: "accept-session",
        guidance: ""
      });
      expect(asContinuator.ok).toBe(true);
      expect(await chapterFile()).toContain("第三段，闸门在响。");

      await service.startTurn(turn(CHAPTER, "续写再来一条", "continuator"));
      expect(proposalIds()).toHaveLength(3);
      expect(writtenEvents()).toHaveLength(3);
      expect(decisions().at(-1)?.auto).toBe(true);
      expect(await chapterFile()).toContain("闸门在响，水线在下沉。");
      service.dispose();
    });
  });
  ```

  Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts -t "autoSession 键" --maxWorkers=4`

  期望：**第二条 FAIL**（`writtenEvents()).toHaveLength(1)` 处，实际 2 —— 旧键只有 `threadKey`，所以 `CHAPTER::writer` 的「不再问」被 `continuator` 那一轮原样继承）；**第一条 PASS 并且必须继续 PASS**：它是「不许只按 profileId 建键」的反向守卫（把键写成 `profileId` 单元素时它立刻转红，`writtenEvents()` 会变成 2）。贴出这段输出再进 Step 6。

- [ ] **Step 6：实现 `autoSession` 换键并跑回归**

  6a. 把 `apps/desktop/src/main/agent-service.ts` 里（`maybeAutoApprove` 内，Task 16 之后大约在 `:236` 附近，用 Grep 定位原文）

  ```ts
      const bySession = autoSession.has(threadKey);
      if (!bySession && !autoDocTool.has(ruleKey(proposal))) return;
  ```

  替换为：

  ```ts
      // a 键＝「这条线程 + 这个档案」：切档案不继承上一档的「不再问」（spec §2 D4）
      const bySession = autoSession.has(autoKey(threadKey, profileOfThread(threadKey).id));
      if (!bySession && !autoDocTool.has(ruleKey(proposal))) return;
  ```

  6b. 把（`applyDecision` 写成功之后，原文一对 `add` 语句）

  ```ts
      pending.delete(proposalId);
      if (decision === "accept-session") autoSession.add(threadKey);
      if (decision === "accept-prefix") autoDocTool.add(ruleKey(proposal));
  ```

  替换为：

  ```ts
      pending.delete(proposalId);
      // 只有真的写成功才登记「不再问」（拒绝路径走不到这里），登记的键含档案
      if (decision === "accept-session")
        autoSession.add(autoKey(threadKey, profileOfThread(threadKey).id));
      if (decision === "accept-prefix") autoDocTool.add(ruleKey(proposal));
  ```

  > `p` 键那行**一字不改**：`ruleKey` 的 `docRelPath::tool` 形状按 spec §2 D4 明令保持不变。

  6c. 把 `dispose()` 里的

  ```ts
        threads.clear();
  ```

  替换为：

  ```ts
        threads.clear();
        profileIdByThread.clear();
  ```

  6d. 回归（**逐条跑并把真实输出贴进执行记录**，本任务不跑全量门禁）：

  - `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts --maxWorkers=4` → 全绿。特别是既有的 `「本会话不再问」之后同线程的新提案自动落盘并标 auto` 与 `被权限档拒掉的 accept-session 不会开启自动批准` 两条：它们按**旧键语义**写，换键后两轮 `turn(CHAPTER, …, "")` 都归一到 `writer`，所以必须照旧绿；它们若红，说明 `profileOfThread` 的空串归一路径写错了。
  - `corepack pnpm vitest run apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4` → 全绿。这两处不直接读 `autoSession`，转红即换键波及了 `startTurn` 的档案登记路径，回 3d 复核。
  - `corepack pnpm exec prettier --check apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts` → 无差异。

- [ ] **Step 7：变异 M6 —— 删掉档案闸，看它真的红**

  > 台账出处：Plan 3 spec §15 与计划「变异归属表」的 M6 行（`docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md:390`）：「M6 | 档案范围闸 | Task 17 | 删掉 `applyDecision` 里的档案闸」。**只用 Edit 工具改代码，禁止 `perl -i`/`sed -i`。** 变异期间**不要**跑 `corepack pnpm verify`（未用 import 会让 tsc 先炸，掩盖用例结果），只跑下面这一条定向 vitest。

  7a. 用 Edit 把 Step 3e 整段档案闸（从 `// 档案范围闸（spec §9.2 闸 2）` 那两行注释起，到它自己的收尾 `}` 止，**含中间的空行**）**替换为一行占位注释**（`applyDecision` 体内，缩进 4 格）：

  ```ts
      // （变异 M6：档案范围闸暂时删除）
  ```

  7b. Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts -t "审稿档案批准 write_doc" --maxWorkers=4`

  期望：**1 条 FAIL**，失败消息形如 `AssertionError: expected true to be false`（`expect(denied.ok).toBe(false)` 这一行），文件计数 `Tests 1 failed`。**必须把这段红色输出原样贴进执行记录**，只报「红了」不算验证。

  7c. 再用 Edit 把那一行占位注释替换回 Step 3e 的完整档案闸代码（**逐字照 3e 抄，不要凭记忆重写**）。

  7d. Run: `corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`

  期望：全绿，且贴出这条绿色汇总（`Test Files 1 passed` / `Tests N passed`）与 7b 的红形成对照。

  7e. 顺手确认 M6 的第二半：`主笔档案批准另一章的提案`、`世界档案改正文`、`未知 profileId 的提案按 DEFAULT_PROFILE_ID 判范围` 三条在 7a 的变异下同样会红（它们都断 `denied.ok === false`）。**不必再跑一遍**，在报告里写明「同一道闸被四条用例分别钉住」即可。

- [ ] **Step 8：提交**

  ```bash
  git status --short
  git log --oneline -8
  git add apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts
  git commit -m "feat(main): 审批侧档案范围闸与 autoSession 线程::档案键（M6）"
  git status --short
  ```

  - `git log --oneline -8` 是抄仓库风格用的（现 HEAD 风格＝`类型(作用域): 中文一句`，如 `fix(renderer): 提案卡带轮次锚点并折叠已裁决卡，修只读档文案与桩判据`）；若届时 HEAD 已带上前序任务的提交、风格与上面示例不同，**以 `git log` 为准**。
  - `git add` 只列这两条路径。若 `git status --short` 还挂着别的文件（尤其 `packages/agent-runtime/**`、`pnpm-lock.yaml`、任何 `.env`），**不要 `git add -A`**，把它们留在工作区并在报告里点名。
  - 命令行里绝不出现任何密钥串；测试夹具里的 `API_KEY` 是假哨兵值，本任务不碰它。
  - 提交后把本任务台账补进 `docs/superpowers/plans/README.md`（或波 2 收尾任务指定的台账位置）——若该文件由波次收尾任务统一改，本步跳过，在报告里注明「台账留给波 2 收尾」。

  **完成判据（三条缺一不算完）**：① Step 2 的红与 Step 4/6d 的绿都贴了真实输出；② Step 7 的 M6 红/绿两段输出都在；③ `wc -l apps/desktop/src/main/agent-service.ts` < 800 且 `node tools/check-source-line-budget.mjs` 无输出。

### Task 18：渲染层 —— 阶段与档案选择器 + 上下文占用条

**Files:**
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（`setActiveStage` 完整实现）
- Create: `apps/desktop/src/renderer/src/utils/context-bar.ts`
- Create: `apps/desktop/src/renderer/src/utils/context-bar.test.ts`
- Modify: `apps/desktop/src/renderer/src/utils/slash-commands.ts`
- Modify: `apps/desktop/src/renderer/src/utils/slash-commands.test.ts`
- Create: `apps/desktop/src/renderer/src/components/ProfilePicker.vue`
- Modify: `apps/desktop/src/renderer/src/components/SlashPalette.vue`（波 1 Task 8 落地件）
- Modify: `apps/desktop/src/renderer/src/components/CenterColumn.vue`
- Modify: `apps/desktop/src/renderer/src/styles/interaction.css`

**Interfaces:**

Consumes（一律 `import type` 自 `@mochen/contracts`；渲染层禁止 import `@mochen/agent-runtime`，硬约束）：
- `ProfileView { id: string; displayName: string; blurb: string; allowedTools: AgentToolName[] }`（`contracts/src/profile.ts`，Task 11 落地；产物**不含 `systemPrompt`**，提示词永不进渲染层）。
- `ContextSummary { sections: ContextSectionView[]; charCount: number; estimate: number; omitted: string[] }`、`ContextSectionView { kind: ContextSectionKind; label: string; charCount: number; truncated: boolean }`（`contracts/src/context.ts`，Task 11 落地）。
- `ContextPreviewInput { threadKey: string; docRelPath: string | null; stageId: string; profileId: string; skillPaths: string[] }`（Task 11 由 `contextPreviewInputSchema` 派生，字段名/顺序/可选性照接口总表逐字）。
- `StartTurnInput.profileId: string`（必填，Task 11 加；空串 `""` = 让主进程按 `DEFAULT_PROFILE_ID` 兜底）。
- `window.mochen.listProfiles(): Promise<ProfileView[]>`、`window.mochen.contextPreview(input: ContextPreviewInput): Promise<ContextSummary>`（Task 12 preload 白名单已落地）。
- `DEFAULT_PROFILE_ID` 的**值**（`"writer"`）经 `listProfiles()` 的结果间接持有，渲染层**不 import** 该 runtime 常量；见下方「DEFAULT_PROFILE_ID 落地口径」。
- 现仓夹具与用例：`useAgentStore.test.ts`（假 `window.mochen` 用 `vi.stubGlobal("window", { mochen: api })`、`api ... satisfies RendererApi`、`setActivePinia(createPinia())`、中文 `describe`/`it` 标题、`started: StartTurnInput[]` 收集器）、`slash-commands.test.ts`、`useBookStore.test.ts`（本任务动 `setActiveStage` 时若已有文件照其风格加）。`layoutStore.test.ts` 不涉及本任务。

Produces（波 2 对外契约，签名逐字照接口总表）：
- `useAgentStore`：`profiles: ProfileView[]`、`profilesReady: boolean`、`profileIdByThread: Record<string, string>`（`""` = 用该阶段默认）、`contextSummary: Record<string, ContextSummary>`；actions `loadProfiles(): Promise<void>`、`profileIdFor(threadKey: string): string`、`setProfileId(threadKey: string, profileId: string): void`、`refreshContext(threadKey: string): Promise<void>`。
- `utils/context-bar.ts`：`export function formatContextBar(summary: ContextSummary): string`。
- `utils/slash-commands.ts`：`PaletteFocus += profilesReady: boolean`；`availableCommands` 在 `profilesReady === false` 时滤掉 `stage`。
- `useBookStore`：`setActiveStage(stageId: string): Promise<void>`（写 `activeStage` → `saveMeta` → 连带把当前线程档案切到 `stage.profileId ?? ""`；总表在波 1 声明了形状，落地件与源码实现都在本任务，见 Step 6 的风险说明）。
- `components/ProfilePicker.vue`：两个 `<select>`，读 `store.profiles` 与 `book.meta.stages`，显示「阶段 正文 · 档案 墨宸 · 主笔」。

**波 3 预留挂载点**：`useAgentStore` 的 `skillPathsByThread: Record<string, string[]>` 由 Task 23 加；本任务的 `refreshContext` 里 `skillPaths` 先传 `[]`，该行有注释点名「Task 23 改读 `this.skillPathsByThread[threadKey] ?? []`」。Task 23 只需替换那一行，不动本任务其余逻辑。

**DEFAULT_PROFILE_ID 落地口径（与接口总表「波 2」那段逐字一致，此处只展开理由）**：`profileIdFor` 的三级回落最后一级是 `""` 而不是 `DEFAULT_PROFILE_ID`，因为 `DEFAULT_PROFILE_ID` 是 `@mochen/agent-runtime` 的**值**，渲染层禁止 import 它（`tools/check-package-boundary.mjs` 会红）。落地：`profileIdFor` 只返回 **`profiles` 里存在的 id** 或 `""`；`""` 经 `StartTurnInput`/`ContextPreviewInput` 送主进程，主进程按 `DEFAULT_PROFILE_ID` 兜底（Task 11 已定）。这既守「永不返回 profiles 里没有的 id」（未知 id 被滤为回落候选或 `""`），又不违反渲染层 import 禁令。

---

- [ ] **Step 1：先写红的 store 用例（档案/映射/占用，含 M11 断言与未知 id 回落反向用例）**

`apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`：本任务的用例都挂在这个文件上（现仓唯一 store 测试，夹具照其现风格）。先扩夹具，再写红的用例。

**(a) type import 块（第 4-15 行）按字母序补三项**，结果：

```ts
import type {
  AgentEvent,
  AgentOutbound,
  BookOpenResult,
  ContextPreviewInput,
  ContextSummary,
  DecideInput,
  DecisionResult,
  DocWriteResult,
  EditProposal,
  ProfileView,
  ProviderView,
  RendererApi,
  StartTurnInput
} from "@mochen/contracts";
```

**(b) 模块级假实现**（放在第 100 行 `proposalDiff` 附近，风格照 `readDoc`/`writeDoc`）：

```ts
const sixProfiles: ProfileView[] = [
  { id: "world", displayName: "墨宸 · 世界", blurb: "素材与大纲", allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"] },
  { id: "chief-editor", displayName: "墨宸 · 总编", blurb: "大纲与人物", allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"] },
  { id: "character", displayName: "墨宸 · 角色", blurb: "人物卡", allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"] },
  { id: "writer", displayName: "墨宸 · 主笔", blurb: "本章正文", allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"] },
  { id: "continuator", displayName: "墨宸 · 续写", blurb: "接着写", allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch"] },
  { id: "reviewer", displayName: "墨宸 · 审稿", blurb: "只出批注", allowedTools: ["read_doc", "list_docs", "search_docs", "propose_patch"] }
];
const listProfiles = vi.fn(async (): Promise<ProfileView[]> => sixProfiles);
const contextPreview = vi.fn(async (): Promise<ContextSummary> => ({
  sections: [
    { kind: "doc", label: "本章", charCount: 5200, truncated: false },
    { kind: "outline", label: "第 1 卷大纲", charCount: 900, truncated: false }
  ],
  charCount: 6100,
  estimate: 3813,
  omitted: []
}));
```

把这两行加进 `api` 对象（第 112-128 行，`proposalDiff,` 之后）：`listProfiles,`、`contextPreview,`。此时 `api ... satisfies RendererApi` 才会成立（Task 12 已把两方法进 `RendererApi`）。`beforeEach`（第 147-162 行）里 `started.length = 0;` 之后补 `listProfiles.mockClear(); contextPreview.mockClear();`。

**(c) 红的用例**，追加到文件末尾的 `describe("useAgentStore · 档案与上下文（Task 18）", ...)`：

```ts
describe("useAgentStore · 档案与上下文（Task 18）", () => {
  it("loadProfiles 成功：profilesReady 置真，profiles 进六条", async () => {
    await openChapter();
    await store().loadProfiles();
    expect(store().profilesReady).toBe(true);
    expect(store().profiles.length).toBe(6);
  });

  it("loadProfiles 失败：profilesReady 保持假，notice 是定稿这一句中文", async () => {
    await openChapter();
    listProfiles.mockRejectedValueOnce(new Error("通道未注册"));
    await store().loadProfiles();
    expect(store().profilesReady).toBe(false);
    expect(store().notice).toBe("档案列表没能取到：通道未注册");
  });

  it("profileIdFor：无选择无阶段档案时回落空串（交主进程按默认档兜底）", async () => {
    await openChapter();
    await store().loadProfiles();
    // opened.meta 的 stages=[{id:"draft",name:"正文"}] 没有 profileId，线程也没设过档案。
    expect(store().profileIdFor(CH)).toBe("");
  });

  it("profileIdFor：线程选择优先于阶段默认", async () => {
    await openChapter();
    await store().loadProfiles();
    store().setProfileId(CH, "reviewer");
    expect(store().profileIdFor(CH)).toBe("reviewer");
  });

  it("profileIdFor：未知 id 绝不返回，滤后落到阶段默认", async () => {
    await openChapter();
    await store().loadProfiles();
    useBookStore().meta = {
      ...opened.meta,
      stages: [{ id: "draft", name: "正文", profileId: "writer" }],
      activeStage: "draft"
    };
    store().setProfileId(CH, "ghost-profile");
    // “ghost-profile” 不在 profiles 里 ⇒ 不能原样返回；回落阶段 profileId=writer。
    expect(store().profileIdFor(CH)).toBe("writer");
  });

  it("profileIdFor：未知 id 且无阶段档案时回落空串而非未知 id", async () => {
    await openChapter();
    await store().loadProfiles();
    store().setProfileId(CH, "ghost-profile");
    expect(store().profileIdFor(CH)).toBe("");
  });

  it("M11 断言：切档案前后 threadKey 与 items.length 一字不变", async () => {
    await openChapter();
    await store().loadProfiles();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "event", threadKey: CH, turnId: "t1", event: eventOf("message", { text: "海雾涌上来。", interrupted: false }) });
    push({ type: "turn-end", threadKey: CH, turnId: "t1", status: "done", message: "" });
    const keyBefore = threadKeyFor(useBookStore().activeDocTab);
    const lenBefore = itemsOf(CH).length;
    store().setProfileId(CH, "reviewer");
    store().setProfileId(CH, "continuator");
    expect(threadKeyFor(useBookStore().activeDocTab)).toBe(keyBefore);
    expect(itemsOf(CH).length).toBe(lenBefore);
    // 且切档案绝不影响 running：仍为 false。
    expect(store().threads[CH]?.running).toBe(false);
  });

  it("refreshContext：按 threadKey 存 ContextSummary，入参照总表", async () => {
    await openChapter();
    await store().loadProfiles();
    await store().refreshContext(CH);
    expect(store().contextSummary[CH]?.charCount).toBe(6100);
    const input = contextPreview.mock.calls[0]?.[0] as ContextPreviewInput;
    expect(input).toEqual({
      threadKey: CH,
      docRelPath: CH,
      stageId: "draft",
      profileId: "",
      skillPaths: []
    });
  });

  it("refreshContext：UNBOUND 线程的 docRelPath 归 null", async () => {
    await useBookStore().openBook("/book"); // 不开标签：activeDocTab = null ⇒ threadKey = UNBOUND
    await store().loadProfiles();
    await store().refreshContext(UNBOUND);
    const input = contextPreview.mock.calls[0]?.[0] as ContextPreviewInput;
    expect(input.docRelPath).toBeNull();
  });

  it("refreshContext 失败：单句中文进 notice，不抛", async () => {
    await openChapter();
    await store().loadProfiles();
    contextPreview.mockRejectedValueOnce(new Error("预览超时"));
    await store().refreshContext(CH);
    expect(store().notice).toBe("上下文占用没能取到：预览超时");
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: 上述 describe **全红**（`store().profiles` / `loadProfiles` / `profileIdFor` / `setProfileId` / `contextSummary` / `refreshContext` 尚不存在，报「is not a function」/`undefined`）；文件既有的老用例仍全绿（夹具只增不改）。**贴出这段红**。

- [ ] **Step 2：`useAgentStore` 落地 profiles 通路（loadProfiles / profileIdFor / setProfileId / refreshContext），跑绿 Step 1**

`apps/desktop/src/renderer/src/stores/useAgentStore.ts`：

**(a) import 块（第 2-17 行）** 从 `@mochen/contracts` 补三个类型（字母序）：`ContextPreviewInput`、`ContextSummary`、`ProfileView`。**不 import 任何 `@mochen/agent-runtime` 符号**（硬约束；`DEFAULT_PROFILE_ID` 经 `""` 哨兵间接处理，见 Interfaces）。

**(b) state（第 134-140 行 `state: () => ({...})`）** 在 `listening: false` 之后加四行：

```ts
    /** 档案花名册，来自 window.mochen.listProfiles()；产物只含 ProfileView 四键，无提示词。 */
    profiles: [] as ProfileView[],
    profilesReady: false,
    /** 每条线程选定的档案 id；`""` = 用该阶段默认（总表：`"" = 用该阶段默认`）。 */
    profileIdByThread: {} as Record<string, string>,
    /** 按线程存最近一次上下文预览，占用条读它。 */
    contextSummary: {} as Record<string, ContextSummary>,
```

**(c) actions** 加在 `send` 之前（`decide` 之后，第 307 行后）：

```ts
    /** 拉档案花名册：失败写单句中文进 notice，绝不静默、绝不让 profilesReady 误置真。 */
    async loadProfiles(): Promise<void> {
      try {
        this.profiles = await window.mochen.listProfiles();
        this.profilesReady = this.profiles.length > 0;
      } catch (err) {
        this.profiles = [];
        this.profilesReady = false;
        this.notice = `档案列表没能取到：${reasonOf(err)}`;
      }
    },

    /**
     * 派生线程档案：线程选择 ?? 阶段默认，两者都必须是 profiles 里存在的 id，否则回落 ""（交主进程按
     * DEFAULT_PROFILE_ID 兜底）。永不返回 profiles 里没有的 id（spec §9.1：未知档案主进程才兜底并发 error）。
     * 渲染层拿不到 DEFAULT_PROFILE_ID 常量，故用 "" 哨兵承担兜底那一步（见 Interfaces 的落地口径）。
     */
    profileIdFor(threadKey: string): string {
      const known = (id: string | null | undefined): string | null =>
        typeof id === "string" && this.profiles.some((profile) => profile.id === id) ? id : null;
      const book = useBookStore();
      const stage = book.meta?.stages.find((item) => item.id === book.meta?.activeStage) ?? null;
      return known(this.profileIdByThread[threadKey]) ?? known(stage?.profileId) ?? "";
    },

    /** 只改这一条线程的档案映射：绝不动 items / running / threadKey（spec §10 切档案不换线程，M11）。 */
    setProfileId(threadKey: string, profileId: string): void {
      this.profileIdByThread[threadKey] = profileId;
    },

    /** 发送前刷新该线程的上下文占用预览；入参照接口总表 ContextPreviewInput 逐字。 */
    async refreshContext(threadKey: string): Promise<void> {
      const book = useBookStore();
      const input: ContextPreviewInput = {
        threadKey,
        docRelPath: threadKey === UNBOUND ? null : threadKey,
        stageId: book.meta?.activeStage ?? "draft",
        profileId: this.profileIdFor(threadKey),
        // 波 3 Task 23 改读 this.skillPathsByThread[threadKey] ?? []；本波无技能通路，恒传 []。
        skillPaths: []
      };
      try {
        this.contextSummary[threadKey] = await window.mochen.contextPreview(input);
      } catch (err) {
        this.notice = `上下文占用没能取到：${reasonOf(err)}`;
      }
    },
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: Step 1 的十个用例**全绿**；文件老用例仍全绿。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断（`api ... satisfies RendererApi` 因夹具补齐 `listProfiles`/`contextPreview` 而成立）。

- [ ] **Step 3：`send()` 交 `profileIdFor` 并发轮后刷新占用（先红后绿）**

Task 11 落地后，`useAgentStore.ts` 的 `send()`（现仓 `:310-325`，`StartTurnInput` 构造处）形如：

```ts
    send(text: string): void {
      const book = useBookStore();
      const input: StartTurnInput = {
        threadKey: threadKeyFor(book.activeDocTab),
        docRelPath: book.activeDocTab,
        stageId: book.meta?.activeStage ?? "draft",
        // 波 2 Task 18 换成 profileIdFor(threadKey)：这里先交空串，主进程按 DEFAULT_PROFILE_ID 兜底。
        profileId: "",
        userText: text
      };
      window.mochen.startTurn(input).catch((err: unknown) => {
        ...
      });
    },
```

**(a) 先写红**：追加到 `describe("useAgentStore · 档案与上下文（Task 18）")`：

```ts
  it("send 用 profileIdFor 而非写死空串，且发轮后刷新该线程占用", async () => {
    await openChapter();
    await store().loadProfiles();
    store().setProfileId(CH, "continuator");
    store().send("写一段");
    const sent = started[started.length - 1] as StartTurnInput;
    expect(sent.profileId).toBe("continuator");
    // refreshContext 是 void 调用：等一个 microtask 让 mock 兑现。
    await Promise.resolve();
    expect(contextPreview).toHaveBeenCalledTimes(1);
    expect((contextPreview.mock.calls[0]?.[0] as ContextPreviewInput).profileId).toBe("continuator");
  });

  it("send 未选档案时交空串，主进程按默认档兜底", async () => {
    await openChapter();
    await store().loadProfiles();
    store().send("写一段");
    const sent = started[started.length - 1] as StartTurnInput;
    expect(sent.profileId).toBe("");
  });
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts -t "send 用 profileIdFor" --maxWorkers=4`
Expected: 红（`sent.profileId` 仍是 `""`，`contextPreview` 未被调）。**贴红**。

**(b) 改 `send()`**（Edit，两处）：
1. 把 `profileId: "",` 连同其上那行 Task 11 注释一起换成：

```ts
        profileId: this.profileIdFor(input.threadKey),
```

注意 `input` 的 `threadKey` 在前一行已定（`threadKeyFor(book.activeDocTab)`）；`profileId` 用它派生，不再依赖 `book.activeDocTab` 二次取值。

2. 在 `window.mochen.startTurn(input).catch(...)` 整段**之后**、`send` 方法闭合 `},` 之前补一行：

```ts
      // 发送即刷新占用条：装配在主进程，预览走只读通道，发轮不等它（void）。
      void this.refreshContext(input.threadKey);
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: Step 3 两条 + Step 1/2 全绿；老用例仍绿（老 `send` 用例若断言 `started[...]` 全字段，其期望 `profileId: ""` 在未选档案时仍成立，不受影响）。

- [ ] **Step 4：`utils/context-bar.ts` 纯函数 —— 先红后绿（全字符串用例）**

**(a) 先写红** —— Create `apps/desktop/src/renderer/src/utils/context-bar.test.ts`（本仓 `utils/*.test.ts` 风格：中文标题、纯函数、无 pinia）：

```ts
import { describe, expect, it } from "vitest";
import type { ContextSectionView, ContextSummary } from "@mochen/contracts";
import { formatContextBar } from "./context-bar";

function section(charCount: number): ContextSectionView {
  return { kind: "doc", label: "本章", charCount, truncated: false };
}
function summary(
  sections: ContextSectionView[],
  charCount: number,
  estimate: number,
  omitted: string[] = []
): ContextSummary {
  return { sections, charCount, estimate, omitted };
}

describe("formatContextBar（Task 18）", () => {
  it("定稿格式：六节、千分位、约字约 token", () => {
    expect(formatContextBar(summary(Array.from({ length: 6 }, () => section(100)), 9800, 6100))).toBe(
      "上下文 · 6 节 · 约 9,800 字 · 约 6,100 token"
    );
  });

  it("省略追加：计数 + 名字按数组顺序用中点拼接", () => {
    expect(
      formatContextBar(summary(Array.from({ length: 6 }, () => section(100)), 9800, 6100, ["技能", "素材"]))
    ).toBe("上下文 · 6 节 · 约 9,800 字 · 约 6,100 token · 已省略 2 节（技能 · 素材）");
  });

  it("省略名拼接顺序即数组顺序，不排序", () => {
    expect(formatContextBar(summary([section(1)], 1, 1, ["前情", "大纲", "本章"])).endsWith("（前情 · 大纲 · 本章）")).toBe(
      true
    );
  });

  it("0 节 0 字 0 token：不省略也不追加", () => {
    expect(formatContextBar(summary([], 0, 0))).toBe("上下文 · 0 节 · 约 0 字 · 约 0 token");
  });

  it("千分位：不足千不补逗号，过百万逐段补", () => {
    expect(formatContextBar(summary([section(1)], 999, 1234567))).toBe(
      "上下文 · 1 节 · 约 999 字 · 约 1,234,567 token"
    );
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/context-bar.test.ts --maxWorkers=4`
Expected: 全红（`./context-bar` 无导出 / 文件不存在）。**贴红**。

**(b) 实现** —— Create `apps/desktop/src/renderer/src/utils/context-bar.ts`：

```ts
import type { ContextSummary } from "@mochen/contracts";

/** 手写千分位分组：不依赖 Intl，保证跨 Node 环境的字符串输出确定（本仓 util 测试全是全字符串断言）。 */
function groupThousands(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 占用条文案（spec §9.3 / §10）：「上下文 · N 节 · 约 X 字 · 约 Y token」；
 * 有省略节时追加「 · 已省略 M 节（名 · 名 …）」，名字顺序照 omitted 数组原样拼接。
 * token 与字数都取「约」——estimate 是估算值，UI 一律不显示精确 token。
 */
export function formatContextBar(summary: ContextSummary): string {
  const base = `上下文 · ${summary.sections.length} 节 · 约 ${groupThousands(
    summary.charCount
  )} 字 · 约 ${groupThousands(summary.estimate)} token`;
  if (summary.omitted.length > 0) {
    return `${base} · 已省略 ${summary.omitted.length} 节（${summary.omitted.join(" · ")}）`;
  }
  return base;
}
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/context-bar.test.ts --maxWorkers=4`
Expected: 5 用例全绿。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。

> 与接口总表一致的一条约束（不改行为）：入参用命名类型 `ContextSummary`（`@mochen/contracts`），不复制内联结构体——类型只许有一份来源。util 只读 `sections.length`/`charCount`/`estimate`/`omitted` 四个字段，不碰 `ContextSectionView` 内部，所以契约加节内字段不会击穿它。

- [ ] **Step 5：`slash-commands.ts` 的 `profilesReady` + 删 `GATED_COMMANDS`，连带 `SlashPalette.vue` 与测试调用点全改**

这是偿还波 1 的显式债务：波 1 Task 8 的「设计裁定」第 1 条明写「波 2 的 Task 18 必须删掉 `GATED_COMMANDS` 并把 `profilesReady` 加进 `PaletteFocus`」。判定仍在纯函数，`.vue` 只接线。

**(a) `utils/slash-commands.ts`** —— 三处改动，给完整新代码：

`PaletteFocus` 接口（波 1 的 `{ hasBook; turnRunning }`）换成：

```ts
export interface PaletteFocus {
  hasBook: boolean;
  turnRunning: boolean;
  /** 档案花名册是否已拿到（波 2 Task 18）。false ⇒ 禁 `stage`：切阶段会连带切档案，档案没就绪切了也是空。 */
  profilesReady: boolean;
}
```

删除 `const GATED_COMMANDS: readonly SlashCommand[] = ["stage"];` 整行及其上方那段「波 1 里按下去还没有通路」的注释块。`DURING_TURN_COMMANDS` 保持不动。`availableCommands` 换成：

```ts
export function availableCommands(focus: PaletteFocus): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => {
    // stage 要读书 meta.stages 并连带切档案：没书或档案没就绪都不列（spec §6 的 profilesReady 缘由 + 与 resume 同源的 hasBook）。
    if (command === "stage" && (!focus.hasBook || !focus.profilesReady)) return false;
    if (command === "resume" && !focus.hasBook) return false;
    if (focus.turnRunning) return DURING_TURN_COMMANDS.includes(command);
    return true;
  });
}
```

`SLASH_COMMANDS`、`parseSlashInput`、`filterCommands`、`paletteOwnsKey`、`SLASH_COMMAND_DESCRIPTIONS` 一字不动（`stage` 的说明仍保留）。

**(b) `utils/slash-commands.test.ts`** —— 波 1 的 `NO_GATE` 语义正是「stage 被挡」；把挡它的因由从 `GATED_COMMANDS` 换成 `profilesReady: false`，既有断言全部照旧成立，改动最小。逐条改：

1. 把 `const NO_GATE = { hasBook: true, turnRunning: false };` 换成 `const NOT_READY = { hasBook: true, turnRunning: false, profilesReady: false };`，并把文件内 `NO_GATE` 的 3 处引用（`availableCommands(NO_GATE)`、`filterCommands("", NO_GATE)`、`filterCommands("/s"|"s"|"/sta"|"/stage", NO_GATE)`）全部改成 `NOT_READY`。**这些用例的期望值一字不改**：`profilesReady:false` 时 `stage` 仍被挡，等价波 1。
   - 唯一要动的期望：`filterCommands("/sta", NOT_READY)` 仍 `[]`、`filterCommands("/stage", NOT_READY)` 仍 `[]` —— 因为 profilesReady:false，成立。
2. 其余四处内联 focus 字面量各补 `profilesReady: true`（否则 tsc 报缺属性）：
   - `availableCommands({ hasBook: true, turnRunning: true })` → `{ hasBook: true, turnRunning: true, profilesReady: true }`（期望仍 4：running 挡 stage）
   - `availableCommands({ hasBook: false, turnRunning: false })` → `+ profilesReady: true`（期望仍 4：没书挡 stage）
   - `availableCommands({ hasBook: false, turnRunning: true })` → `+ profilesReady: true`（期望仍 4）
   - `filterCommands("/st", { hasBook: true, turnRunning: true })`、`filterCommands("/re", { hasBook: false, turnRunning: false })` → 各 `+ profilesReady: true`（期望不变）
3. 新增一个 describe（放在「运行期可用性」块内）验证 `profilesReady` 这条新闸门：

```ts
  it("档案就绪且有书：stage 进面板，位置紧跟 status", () => {
    expect(availableCommands({ hasBook: true, turnRunning: false, profilesReady: true })).toEqual([
      "model",
      "permissions",
      "status",
      "stage",
      "resume",
      "clear"
    ]);
  });

  it("档案未就绪：即便有书也拿掉 stage（切阶段会连带切档案）", () => {
    expect(availableCommands({ hasBook: true, turnRunning: false, profilesReady: false })).not.toContain("stage");
  });

  it("没书：stage 不出现（切阶段要写 book.meta）", () => {
    expect(availableCommands({ hasBook: false, turnRunning: false, profilesReady: true })).not.toContain("stage");
  });

  it("就绪集合上的前缀过滤：/st 同时命中 status 与 stage", () => {
    expect(filterCommands("/st", { hasBook: true, turnRunning: false, profilesReady: true })).toEqual([
      "status",
      "stage"
    ]);
  });
```

**(c) `components/SlashPalette.vue`**（波 1 Task 8 落地件）—— `candidates` computed 里构造的 focus 对象补一行（约第 671-674 行）：

```ts
const candidates = computed<SlashCommand[]>(() =>
  filterCommands(typed.value, {
    hasBook: book.rootPath !== null,
    turnRunning: agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false,
    profilesReady: agent.profilesReady
  })
);
```

其余不动。若波 2 给 `CenterColumn.vue` 也另建一份 focus（如热键层），同样加 `profilesReady: agent.profilesReady`，值都取 store，绝不在 `.vue` 里判断「档案够不够」。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/slash-commands.test.ts --maxWorkers=4`
Expected: 全绿（既有可用性/前缀用例在 `NOT_READY` 下行为与波 1 一致；新增 4 条覆盖 `profilesReady`）。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。

- [ ] **Step 6：`useBookStore.setActiveStage` 完整实现 —— 切阶段连带把该线程档案切到 `stage.profileId ?? ""`（先红后绿）**

接口总表（波 1）声明了 `setActiveStage(stageId): Promise<void>`，但总表同时注明它的**落地件在本任务**——波 1 的十个任务里没有它，`useBookStore.ts` 源码里也没有（动手前 `grep -rn "setActiveStage" apps/desktop/src/renderer` 回读，**源码里应为零命中**，只在计划与 spec 的文档里出现）。因此本任务给出**完整实现**（含「连带切档案」），不假设它已存在。若执行到这里时发现仓里已经有一版「只写 `activeStage`」的实现（波 1 有人顺手落了），用下面这版整体替换即可——行为是其超集，替换后本任务用例与既有 `useBookStore.test.ts` 要双向跑绿。

`apps/desktop/src/renderer/src/stores/useBookStore.ts`：顶部 import 补 `threadKeyFor` 与 `useAgentStore`：

```ts
import { threadKeyFor, useAgentStore } from "./useAgentStore";
```

> 循环依赖说明：`useAgentStore` 已 `import { useBookStore }`。两 store 互相在**动作函数体内**才解引用对方（`useAgentStore()` / `useBookStore()` 都是 `defineStore` 返回的工厂函数，模块求值阶段不解引用），ESM 环在此无害，与现仓 `useAgentStore.reduceEvent` 里 `void useBookStore().absorbAgentWrite(...)` 是同一手法。若 tsc/eslint 报环，把这一行的解引用挪进函数体（`const agent = useAgentStore();` 已在体内），不改结构。

`actions` 里加（放 `openBook` 之后）：

```ts
    /** 切创作阶段：先落盘 meta，再把「当前这条线程」的档案连带切到该阶段默认（spec §10）。 */
    async setActiveStage(stageId: string): Promise<void> {
      if (!this.meta) {
        this.notice = "尚未打开作品目录";
        return;
      }
      const stage = this.meta.stages.find((item) => item.id === stageId);
      if (!stage) {
        this.notice = "没有这个创作阶段";
        return;
      }
      const nextMeta = { ...this.meta, activeStage: stageId };
      try {
        await window.mochen.saveMeta(nextMeta);
      } catch (err) {
        this.notice = `阶段没能保存：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
        return;
      }
      this.meta = nextMeta;
      // 切阶段连带把当前线程档案切到 stage.profileId ?? ""：空串 = 交主进程按 DEFAULT_PROFILE_ID 兜底。
      // 这一步只动 profileIdByThread，绝不换 threadKey、绝不动 items（M11 的另一半）。
      useAgentStore().setProfileId(threadKeyFor(this.activeDocTab), stage.profileId ?? "");
    },
```

**先写红** —— Create/追加 `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`（若不存在则新建；照 `useAgentStore.test.ts` 的 `setActivePinia(createPinia())` + `vi.stubGlobal("window", { mochen: api })` 夹具，api 里 `saveMeta: vi.fn(async (): Promise<void> => undefined)`、`openBook`、`listProfiles` 等按 `satisfies RendererApi` 补齐）：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BookOpenResult, RendererApi } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";
import { useAgentStore } from "./useAgentStore";

const opened: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [
      { id: "draft", name: "正文", profileId: "writer" },
      { id: "polish", name: "修订", profileId: "reviewer" }
    ],
    activeStage: "draft",
    permissionMode: "chapter-write",
    chapterOrder: ["chapters/01-a.md"]
  },
  docs: [{ relPath: "chapters/01-a.md", kind: "chapter", title: "开局" }]
};

const saveMeta = vi.fn(async (): Promise<void> => undefined);
const api = {
  pickBookDirectory: vi.fn(async () => "chapters/01-a.md"),
  openBook: vi.fn(async (): Promise<BookOpenResult> => opened),
  saveMeta
  // 其余 RendererApi 方法按 satisfies 需要补齐（listProfiles / contextPreview / readDoc 等），
  // 与 useAgentStore.test.ts 的 api 同源；本用例只查 saveMeta 与 profileIdByThread。
} as unknown as RendererApi;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  saveMeta.mockClear();
});

describe("useBookStore · setActiveStage（Task 18）", () => {
  it("切阶段：写 activeStage 并连带把当前线程档案切到该阶段 profileId", async () => {
    await useBookStore().openBook("/book");
    await useBookStore().openDocTab("chapters/01-a.md");
    await useBookStore().setActiveStage("polish");
    expect(useBookStore().meta?.activeStage).toBe("polish");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    // 当前线程 = docRelPath；polish.profileId = reviewer ⇒ 映射写 reviewer。
    expect(useAgentStore().profileIdByThread["chapters/01-a.md"]).toBe("reviewer");
    // M11：切阶段后线程键不变。
    expect(useAgentStore().profileIdFor("chapters/01-a.md")).toBe("reviewer");
  });

  it("阶段没写 profileId ⇒ 档案映射回空串（主进程兜底）", async () => {
    await useBookStore().openBook("/book");
    await useBookStore().openDocTab("chapters/01-a.md");
    useBookStore().meta = { ...opened.meta, stages: [{ id: "bare", name: "随想" }], activeStage: "bare" };
    await useBookStore().setActiveStage("bare");
    expect(useAgentStore().profileIdByThread["chapters/01-a.md"]).toBe("");
  });

  it("saveMeta 失败：activeStage 不动、档案不切、notice 是定稿中文", async () => {
    await useBookStore().openBook("/book");
    await useBookStore().openDocTab("chapters/01-a.md");
    saveMeta.mockRejectedValueOnce(new Error("磁盘只读"));
    await useBookStore().setActiveStage("polish");
    expect(useBookStore().meta?.activeStage).toBe("draft");
    expect(useBookStore().notice).toBe("阶段没能保存：磁盘只读");
    expect(useAgentStore().profileIdByThread["chapters/01-a.md"]).toBeUndefined();
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: 先红（`setActiveStage is not a function`），实现落位后全绿。
Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: 无诊断。

- [ ] **Step 7：`ProfilePicker.vue` + `CenterColumn.vue` 接线（占用条一行 + `/status` 展开明细）+ 行数自查**

本仓不引 `@vue/test-utils`，模板层零自动化覆盖：判定全在 store/utils，`.vue` 只把 store 的派生值画出来、把用户动作转成 action 调用。

**(a) Create `apps/desktop/src/renderer/src/components/ProfilePicker.vue`**（新文件，≤120 行；两个 `<select>` + 一行派生标签，无内联判断）：

```vue
<!-- 阶段与档案选择器（spec §10）。选项来自 store.profiles 与 book.meta.stages；
     切档案只调 setProfileId（不换线程），切阶段调 setActiveStage（连带切档案）。判定全在 store。 -->
<script setup lang="ts">
import { computed } from "vue";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const agent = useAgentStore();
const book = useBookStore();

const threadKey = computed(() => threadKeyFor(book.activeDocTab));
const ready = computed(() => book.meta !== null);
const stages = computed(() => book.meta?.stages ?? []);
const activeStage = computed(() => book.meta?.activeStage ?? "");
// <select> 的档案值：线程显式选择，未选则空串 = 跟随阶段默认。
const pickedProfile = computed(() => agent.profileIdByThread[threadKey.value] ?? "");

// 派生标签「阶段 正文 · 档案 墨宸 · 主笔」：档案名取有效 id 对应的 displayName；
// 有效 id 为空（跟随默认且阶段未指定）时如实写「跟随阶段默认」，绝不硬编码档案名。
const stageName = computed(() => stages.value.find((item) => item.id === activeStage.value)?.name ?? "未选阶段");
const profileName = computed(() => {
  const resolved = agent.profileIdFor(threadKey.value);
  if (resolved === "") return "跟随阶段默认";
  return agent.profiles.find((item) => item.id === resolved)?.displayName ?? "跟随阶段默认";
});
const label = computed(() => `阶段 ${stageName.value} · 档案 ${profileName.value}`);

function onStage(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  void book.setActiveStage(value);
}
function onProfile(event: Event): void {
  agent.setProfileId(threadKey.value, (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="profile-picker">
    <span class="profile-picker-label">{{ label }}</span>
    <label class="profile-picker-field">
      <span>阶段</span>
      <select :value="activeStage" :disabled="!ready" @change="onStage">
        <option v-for="stage in stages" :key="stage.id" :value="stage.id">{{ stage.name }}</option>
      </select>
    </label>
    <label class="profile-picker-field">
      <span>档案</span>
      <select :value="pickedProfile" :disabled="!ready || !agent.profilesReady" @change="onProfile">
        <option value="">跟随阶段默认</option>
        <option v-for="profile in agent.profiles" :key="profile.id" :value="profile.id">
          {{ profile.displayName }}
        </option>
      </select>
    </label>
  </div>
</template>
```

**(b) `CenterColumn.vue` 接线**（现 223 行，须 ≤400）：

1. import 段（第 11-25 行附近）加两行：
   ```ts
   import ProfilePicker from "./ProfilePicker.vue";
   import { formatContextBar } from "../utils/context-bar";
   ```
2. 删除 `agentLabel` computed（**`:58-61` 整段**：`const agentLabel = computed(() => {...})`）。`contextTitle`（62-66）保留。
3. script 里新增占用条与明细派生（放在 `ready` computed 之后）：
   ```ts
   const contextBar = computed(() => {
     const summary = agent.contextSummary[threadKey.value];
     return summary ? formatContextBar(summary) : "";
   });
   const contextSections = computed(() => agent.contextSummary[threadKey.value]?.sections ?? []);
   ```
4. `onMounted`（第 105-109 行）在 `agent.startListening();` 之后补：
   ```ts
   void agent.loadProfiles();
   ```
5. template 头部（第 129-133 行那段 `<div>` 里）把
   ```html
           <strong>{{ agentLabel }}</strong>
           <span class="context-caption">主上下文：{{ contextTitle }}</span>
   ```
   换成：
   ```html
           <ProfilePicker />
           <span class="context-caption">主上下文：{{ contextTitle }}</span>
   ```
6. 紧接 `</header>`（第 150 行）之后、`.conversation-scroll-shell` 之前，插占用条一行 + `/status` 展开明细（`<details>` 由用户展开，等价「/status 展开」的落点；明细纯展示，无判断）：
   ```html
     <div v-if="contextBar" class="context-bar">
       <span class="context-bar-text">{{ contextBar }}</span>
       <details class="context-detail">
         <summary>上下文明细</summary>
         <ul>
           <li v-for="(section, index) in contextSections" :key="index">
             {{ section.label }} · 约 {{ section.charCount }} 字{{ section.truncated ? "（已截断）" : "" }}
           </li>
         </ul>
       </details>
     </div>
   ```

**(c) `styles/interaction.css`**（波 1 新增控件样式集中处）追加：
```css
.profile-picker { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.profile-picker-label { font-weight: 600; }
.profile-picker-field { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
.context-bar { display: flex; align-items: center; gap: 8px; padding: 2px 16px; font-size: 12px; opacity: 0.85; }
.context-detail summary { cursor: pointer; }
.context-detail ul { margin: 4px 0 0; padding-left: 18px; }
```

**(d) 行数自查**（硬约束：`CenterColumn.vue` ≤400、任意单文件 ≤800）：

Run: `node tools/check-source-line-budget.mjs`
Run: `wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/components/ProfilePicker.vue`
Expected: 「行数预算通过」；`ProfilePicker.vue` ≤120；`CenterColumn.vue` ≤400。
**若 `CenterColumn.vue` 超 400 行**：把第 6 步的占用条整块（`.context-bar` + `<details>`）连同 `contextBar`/`contextSections` 两个 computed 抽进新文件 `apps/desktop/src/renderer/src/components/ContextBar.vue`（props: `summary: ContextSummary | undefined`），`CenterColumn.vue` 只留 `<ContextBar :summary="agent.contextSummary[threadKey]" />` 一行。这样判定仍不回流组件（`formatContextBar` 在 utils）。

- [ ] **Step 8：变异 M11 —— 把档案塞进 `threadKey`，贴红/绿两段输出**

M11 钉的是「切档案不换线程」（spec §10：切档案前后 `threadKey` 与 `items.length` 一字不变；Plan 3 spec §15 台账行 M11 的转红判据是「切换后 `items.length` 不变」）。守卫用例是 Step 1 里的 **`M11 断言：切档案前后 threadKey 与 items.length 一字不变`**。

**(a) 注入变异** —— 用 Edit 打开 `apps/desktop/src/renderer/src/stores/useAgentStore.ts`，定位 Step 2 落的 `setProfileId`（正常体只有一行 `this.profileIdByThread[threadKey] = profileId;`），临时整段换成把档案并进线程键的版本：

```ts
    setProfileId(threadKey: string, profileId: string): void {
      // 变异 M11：档案进线程键 ⇒ 切档案＝切线程。
      const nextKey = profileId === "" ? threadKey : `${threadKey}::${profileId}`;
      this.threads[nextKey] = this.threads[threadKey] ?? newThread();
      this.profileIdByThread[nextKey] = profileId;
      if (nextKey !== threadKey) delete this.threads[threadKey];
    },
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts -t "M11 断言" --maxWorkers=4`
Expected: **该用例转红**——`setProfileId(CH, "reviewer")` 把 `threads[CH]` 删了、迁到 `threads["chapters/01-a.md::reviewer"]`，于是 `itemsOf(CH).length` 由 1 变 0，断言 `expect(itemsOf(CH).length).toBe(lenBefore)` 失败。
**把红段终端输出（含 `FAIL ... M11 断言：切档案前后 threadKey 与 items.length 一字不变` 与 `expected 1 to be 0` 那两行）原样贴进本任务台账。**

**(b) 写回** —— 再用 Edit 把 `setProfileId` 换回一行版：

```ts
    setProfileId(threadKey: string, profileId: string): void {
      this.profileIdByThread[threadKey] = profileId;
    },
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts -t "M11 断言" --maxWorkers=4`
Expected: **绿**——`PASSED ... M11 断言`。
**把绿段终端输出原样贴进台账，红/绿两段都要在。** 评审者自己重跑，不采信转录（Plan 3 接口总表末段）。

- [ ] **Step 9：门禁 + 提交**

Run: `corepack pnpm prettier --write apps/desktop/src/renderer && corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`
Expected: prettier 无改动报错；tsc 无诊断。
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/context-bar.test.ts apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4`
Expected: 全绿。
Run: `node tools/check-source-line-budget.mjs`
Expected: 「行数预算通过」（`CenterColumn.vue` ≤400、其余单文件 ≤800；见 Step 7 拆分预案）。

先抄风格再提交：
Run: `git log --oneline -8`（现仓样例：`feat(renderer): 提案卡带轮次锚点并折叠已裁决卡，修只读档文案与桩判据`——`feat(scope): 中文动宾`）。

```bash
git add apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useBookStore.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts apps/desktop/src/renderer/src/utils/context-bar.ts apps/desktop/src/renderer/src/utils/context-bar.test.ts apps/desktop/src/renderer/src/utils/slash-commands.ts apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/components/ProfilePicker.vue apps/desktop/src/renderer/src/components/SlashPalette.vue apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/renderer/src/styles/interaction.css
git commit -m "feat(renderer): 阶段与档案选择器、上下文占用条，切档案不换线程"
```

> 命令行不含任何密钥串（本任务只碰渲染层档案/上下文视图，密钥通路在 Task 9/11 主进程，已排除）。`useBookStore.test.ts` 若本任务前不存在则一并 `git add`（Step 6 新建）；若波 1 已建该文件，路径相同，`git add` 仍命中。

### Task 19：全链 —— 主题三态与外观持久化

**Files:**

- Create: `apps/desktop/src/main/appearance-settings.ts`
- Create: `apps/desktop/src/main/appearance-settings.test.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`（加 `registerAppearanceIpc`）
- Modify: `apps/desktop/src/main/agent-ipc.test.ts`
- Modify: `apps/desktop/src/main/index.ts`（构造 + 注册；`:43` 的 `secretDir` 本任务不动，波 3 Task 25 才改名）
- Create: `apps/desktop/src/renderer/src/utils/theme-mode.ts`
- Create: `apps/desktop/src/renderer/src/utils/theme-mode.test.ts`
- Create: `apps/desktop/src/renderer/src/stores/useAppearanceStore.ts`
- Create: `apps/desktop/src/renderer/src/stores/useAppearanceStore.test.ts`
- Modify: `apps/desktop/src/renderer/src/App.vue`（现 113 行；删 `createDefaultAppearanceSettings` 局部实例与无条件 `matchMedia` 注册）
- Create: `apps/desktop/src/renderer/src/components/AppearancePanel.vue`
- Modify: `apps/desktop/src/renderer/src/components/ProviderSettings.vue`（现 102 行；加「外观」一节）
- Modify: `apps/desktop/src/renderer/src/styles/interaction.css`（Task 8 落地件，追加 `.appearance-*`）

**Interfaces:**

Consumes（全部现成，不新增外观类型 —— Plan 3 spec §8）：

- `AppearanceSettingsSchema` / `AppearanceSettings` / `AppearanceSettingsSnapshot` / `AppearanceMode` / `AppearanceColorScheme` / `createDefaultAppearanceSettings()`（`packages/contracts/src/appearance.ts:5-6`、`:205-220`、`:245-253`；barrel `index.ts:1` 是 `export * from "./appearance.js"`，无需改 barrel）。
- `firstIssueMessage(error, fallback)`（`packages/contracts/src/validation.ts:12`）。
- `applyAppearanceThemeToDocument({ scheme, theme, uiFontFamily, editorFontFamily })` 与 `themePresets: ThemePreset[]`（`renderer/src/composables/appearanceThemeRuntime.ts:24-43`，三条 id 为 `codex` / `paper`（暖纸） / `ocean`（海雾））。
- `ReadTextFile`（`main/credential-store.ts:20`）与 `ProviderSettings` 的注入风格（`main/provider-settings.ts:19-27`：`{ dir, credentials, readFile? }`）。
- `IPC_CHANNELS.appearanceGet` / `appearanceSave` 与 `RendererApi.appearanceView()` / `saveAppearance(settings)`（Task 11 契约、Task 12 preload 白名单与 `renderer-api.test.ts` 计数 17 已落地；**Task 12 故意没注册主进程 handler**，本任务补上——这是当时写进 Task 12 Step 7「归属点名」那条的延迟归属，两侧说的是同一条通道）。
- `useLayoutStore().settingsInitialCategory`（`stores/layoutStore.ts:54`，初值 `"general"`）与 `showSettings(initialCategory = "general")`（`:89-92`）。Task 7/8 已把 `Ctrl+,` 与 `/model` 接到 `showSettings("general")`。

Produces（波 2 对外契约，签名逐字照接口总表）：

- `main/appearance-settings.ts`：`createAppearanceSettings(deps: { dir: string; readFile?: ReadTextFile; writeFile?: (path: string, data: string) => Promise<void> }): AppearanceSettingsStore`，`interface AppearanceSettingsStore { read(): Promise<AppearanceSettingsSnapshot>; write(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot> }`。
- `main/agent-ipc.ts`：`registerAppearanceIpc(handle: Handler, settings: AppearanceSettingsStore): void`。
- `renderer/src/utils/theme-mode.ts`：`resolveEffectiveScheme(mode, systemScheme)`、`APPEARANCE_MODE_LABELS: Record<AppearanceMode, string>`、`settingsWithMode(settings, mode)`、`settingsWithPreset(settings, presetId): AppearanceSettings | null`、`MediaQueryListLike` / `SystemSchemeWatcher` / `createSystemSchemeWatcher(source, onChange)`。
- `renderer/src/stores/useAppearanceStore.ts`：`useAppearanceStore`，state `{ settings, persisted, loaded, notice, systemScheme }`，getters `{ effectiveMode, effectiveScheme, themePresetId }`，actions `{ load, setMode, setPreset, resetToDefault, setSystemScheme }`。

**判定全部在 `utils` / `stores`（铁律：`.vue` 只接线）**：本任务唯一新判断是「`mode` 决定要不要跟系统」，落成 `createSystemSchemeWatcher` 的纯函数（DOM 侧只给一个 `MediaQueryListLike` 注入点），M9 变异打的就是它，因此 M9 有 node 层红可看，而不只靠真机肉眼。

---

- [ ] **Step 1：外观落盘模块 —— 先红（`appearance-settings.test.ts`）**

风格照 `main/provider-settings.test.ts`（同一目录既有测试）：读侧用注入的 `readFile` 模拟各种坏值，写侧用 `mkdtemp` 真目录做一次往返。

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings, type AppearanceSettings } from "@mochen/contracts";
import { createAppearanceSettings } from "./appearance-settings.js";

const settings: AppearanceSettings = {
  ...createDefaultAppearanceSettings(),
  mode: "light",
  light: { ...createDefaultAppearanceSettings().light, preset: "paper" }
};

describe("createAppearanceSettings · 读侧永不抛", () => {
  it("文件不存在 ⇒ 默认档 + persisted:false", async () => {
    const store = createAppearanceSettings({
      dir: "C:/fake",
      readFile: async () => {
        throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      }
    });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.settings).toEqual(createDefaultAppearanceSettings());
  });

  it("坏 JSON / 校验不过 / 被占用，三种都回默认档且都不抛", async () => {
    for (const raw of ["{不是json", JSON.stringify({ mode: "purple" }), ""]) {
      const store = createAppearanceSettings({ dir: "C:/fake", readFile: async () => raw });
      expect(await store.read()).toEqual({
        persisted: false,
        settings: createDefaultAppearanceSettings()
      });
    }
    const busy = createAppearanceSettings({
      dir: "C:/fake",
      readFile: async () => {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
    });
    expect((await busy.read()).persisted).toBe(false);
  });

  it("盘上内容合法 ⇒ persisted:true 且原样返回", async () => {
    const store = createAppearanceSettings({
      dir: "C:/fake",
      readFile: async () => JSON.stringify(settings)
    });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(true);
    expect(snapshot.settings.mode).toBe("light");
    expect(snapshot.settings.light.preset).toBe("paper");
  });
});

describe("createAppearanceSettings · 写侧", () => {
  it("校验不过 ⇒ 抛单句中文，不落盘", async () => {
    let wrote = 0;
    const store = createAppearanceSettings({
      dir: "C:/fake",
      writeFile: async () => {
        wrote += 1;
      }
    });
    // as unknown：故意造一个 TS 形状都不该通过的载荷，验证运行期兜底（铁律 6 的跨 IPC 兜底）
    const bad = { ...settings, mode: "purple" } as unknown as AppearanceSettings;
    await expect(store.write(bad)).rejects.toThrow(/^外观设置没保存：/u);
    expect(wrote).toBe(0);
  });

  it("IO 失败 ⇒ 抛单句中文且不剩半个文件", async () => {
    const store = createAppearanceSettings({
      dir: "C:/fake",
      writeFile: async () => {
        throw new Error("EACCES: permission denied");
      }
    });
    await expect(store.write(settings)).rejects.toThrow(/^外观设置写入失败（.+）；/u);
  });

  it("往返：写进 mkdtemp 真目录再读回来，文件名就是 appearance.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mochen-appearance-"));
    try {
      const store = createAppearanceSettings({ dir });
      expect((await store.write(settings)).persisted).toBe(true);
      const raw = await readFile(path.join(dir, "appearance.json"), "utf8");
      expect(raw.endsWith("\n")).toBe(true);
      const back = await store.read();
      expect(back.persisted).toBe(true);
      expect(back.settings).toEqual(settings);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("写出去的内容里没有密钥类字段（外观是明文 JSON，与 config.json 同级同风格）", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mochen-appearance-"));
    try {
      const store = createAppearanceSettings({ dir });
      await store.write(settings);
      const raw = await readFile(path.join(dir, "appearance.json"), "utf8");
      expect(raw).not.toMatch(/apiKey|Bearer|sk-/iu);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2：跑到红**

Run: `corepack pnpm vitest run apps/desktop/src/main/appearance-settings.test.ts --maxWorkers=4`
Expected: FAIL —— `./appearance-settings.js` 不存在（`Cannot find module`）。文件里已 `writeFile` 出现在 import 而未使用，Step 5 前会先被 eslint 挑；本步骤只看它红在缺模块。

- [ ] **Step 3：`main/appearance-settings.ts`（转绿）**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AppearanceSettingsSchema,
  createDefaultAppearanceSettings,
  firstIssueMessage,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@mochen/contracts";
import type { ReadTextFile } from "./credential-store.js";

export interface AppearanceSettingsStore {
  read(): Promise<AppearanceSettingsSnapshot>;
  write(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>;
}

function unpersisted(): AppearanceSettingsSnapshot {
  return { persisted: false, settings: createDefaultAppearanceSettings() };
}

/**
 * 外观落在应用数据目录的 appearance.json：明文、无密钥，与 config.json 同级同风格。
 * 目录由注入的 dir 决定，所以波 3 的 F-4 迁移把它一起搬走，这里不需要知道目录名。
 */
export function createAppearanceSettings(deps: {
  dir: string;
  readFile?: ReadTextFile;
  writeFile?: (path: string, data: string) => Promise<void>;
}): AppearanceSettingsStore {
  const file = path.join(deps.dir, "appearance.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  const writeText = deps.writeFile ?? ((p, data) => writeFile(p, data, "utf8"));

  return {
    async read() {
      // 读侧永不抛（Plan 3 spec §8）：外观是偏好不是事实，坏了回默认档。
      // 这里与 provider-settings.ts:32-45 的「EBUSY 要外抛」姿态不同，因为外抛的下游
      // 是首屏主题——抛了只会让 UI 卡在无主题态，而默认档本身就是正确答案。
      try {
        const parsed = AppearanceSettingsSchema.safeParse(JSON.parse(await readText(file)));
        if (!parsed.success) return unpersisted();
        return { persisted: true, settings: parsed.data };
      } catch {
        return unpersisted();
      }
    },

    async write(settings) {
      // 写侧照 providerDraft 的守卫风格：拒绝只回单句中文，不留 issue 数组（裁定 n）。
      const parsed = AppearanceSettingsSchema.safeParse(settings);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "外观设置没保存：填写的内容不对。"));
      try {
        await mkdir(deps.dir, { recursive: true });
        await writeText(file, `${JSON.stringify(parsed.data, null, 2)}\n`);
      } catch (error) {
        throw new Error(
          `外观设置写入失败（${error instanceof Error ? error.message : String(error)}）；` +
            "请检查设置目录是否可写。",
          { cause: error }
        );
      }
      return { persisted: true, settings: parsed.data };
    }
  };
}
```

Run: `corepack pnpm vitest run apps/desktop/src/main/appearance-settings.test.ts --maxWorkers=4` → 全绿。
`writeFile` 的 import 现在被用上了，eslint 的 `no-unused-vars` 自然闭嘴。

- [ ] **Step 4：IPC 注册与装配 —— 先红（`agent-ipc.test.ts`）**

在 `agent-ipc.test.ts` 末尾追加（`registry()` / `fire()` 复用文件里现成的两个夹具，`:17-44`）：

```ts
describe("registerAppearanceIpc", () => {
  it("注册两条 appearance 通道，读侧永不抛的形状原样带回", async () => {
    const snapshot: AppearanceSettingsSnapshot = {
      persisted: true,
      settings: createDefaultAppearanceSettings()
    };
    const seen: unknown[] = [];
    const reg = registry();
    registerAppearanceIpc(
      reg.handle,
      {
        async read() {
          seen.push("read");
          return snapshot;
        },
        async write(value) {
          seen.push(value);
          return snapshot;
        }
      },
    );
    expect(reg.order).toEqual([IPC_CHANNELS.appearanceGet, IPC_CHANNELS.appearanceSave]);
    expect(await fire(reg.fns, IPC_CHANNELS.appearanceGet)).toEqual(snapshot);
    expect(await fire(reg.fns, IPC_CHANNELS.appearanceSave, snapshot.settings)).toEqual(snapshot);
    expect(seen).toEqual(["read", snapshot.settings]);
  });
});
```

（尾逗号那行是 prettier 的写法：多行参数调用留尾逗号；跑 `corepack pnpm exec prettier --write` 统一。）
import 段补 `createDefaultAppearanceSettings`（值）与 `type AppearanceSettingsSnapshot`，再 `import { registerAppearanceIpc } from "./agent-ipc.js";`。

- [ ] **Step 5：`registerAppearanceIpc` + `main/index.ts` 装配（转绿）**

`agent-ipc.ts` 末尾追加，形状与 `registerProviderIpc`（`:22-27`）一字对齐：

```ts
/** 外观读写：读侧永不抛（appearance-settings.ts 的 read），写侧的中文拒绝句由 store 收成 notice。 */
export function registerAppearanceIpc(handle: Handler, settings: AppearanceSettingsStore): void {
  handle(IPC_CHANNELS.appearanceGet, () => settings.read());
  handle(IPC_CHANNELS.appearanceSave, (_event, value) =>
    settings.write(value as AppearanceSettings)
  );
}
```

import 段加 `type AppearanceSettings`（`@mochen/contracts`）与 `import type { AppearanceSettingsStore } from "./appearance-settings.js";`。

`main/index.ts`：import 段加 `createAppearanceSettings` 与 `registerAppearanceIpc`（并入现有 `./agent-ipc.js` 的 import），在 `registerProviderIpc(...)`（`:62`）之后加两行：

```ts
  // 主题三态落盘：dir 与密钥/模型配置同一个注入点，波 3 迁移目录时这里一字不改。
  const appearance = createAppearanceSettings({ dir: secretDir });
  registerAppearanceIpc((channel, fn) => ipcMain.handle(channel, fn), appearance);
```

Run: `corepack pnpm vitest run apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/appearance-settings.test.ts --maxWorkers=4` → 全绿。
此时 `window.mochen.appearanceView()` 有了真身，Task 12 留在白名单里的两条通道不再是「调用即 reject 的空壳」。

- [ ] **Step 6：`utils/theme-mode.ts` —— 先红（含 M9 前置用例）**

夹具先给一个假的 `MediaQueryList`：只暴露 `MediaQueryListLike` 的三个成员，另加测试专用的 `added` / `removed` 计数与 `fire()`，这样 M9 要打的「注册了几次」是可数的，不靠肉眼。

```ts
import { describe, expect, it, vi } from "vitest";
import { createDefaultAppearanceSettings, type AppearanceMode } from "@mochen/contracts";
import {
  APPEARANCE_MODE_LABELS,
  createSystemSchemeWatcher,
  resolveEffectiveScheme,
  settingsWithMode,
  settingsWithPreset,
  type MediaQueryListLike
} from "./theme-mode";

/** 结构上满足 MediaQueryListLike，外加可断言的注册/注销计数与 fire()。 */
function fakeSource(matches = false) {
  const listeners = new Set<() => void>();
  const fake: MediaQueryListLike & {
    added: number;
    removed: number;
    fire(next?: boolean): void;
  } = {
    matches,
    added: 0,
    removed: 0,
    addEventListener: (_type: "change", listener: () => void) => {
      listeners.add(listener);
      fake.added += 1;
    },
    removeEventListener: (_type: "change", listener: () => void) => {
      listeners.delete(listener);
      fake.removed += 1;
    },
    /** 模拟系统配色变了：先改 matches 再逐个回调，与真 MediaQueryList 的顺序一致。 */
    fire(next = true) {
      fake.matches = next;
      for (const listener of listeners) listener();
    }
  };
  return fake;
}

describe("resolveEffectiveScheme", () => {
  it("三态 × 两系统色 = 六格全矩阵，只有 system 会跟随", () => {
    expect(resolveEffectiveScheme("system", "dark")).toBe("dark");
    expect(resolveEffectiveScheme("system", "light")).toBe("light");
    expect(resolveEffectiveScheme("light", "dark")).toBe("light");
    expect(resolveEffectiveScheme("light", "light")).toBe("light");
    expect(resolveEffectiveScheme("dark", "dark")).toBe("dark");
    expect(resolveEffectiveScheme("dark", "light")).toBe("dark");
  });
});

describe("APPEARANCE_MODE_LABELS", () => {
  it("三档中文定稿，键与 AppearanceMode 联合穷尽（Record 类型即编译期关卡）", () => {
    const modes: AppearanceMode[] = ["system", "light", "dark"];
    expect(Object.keys(APPEARANCE_MODE_LABELS).sort()).toEqual(modes);
    expect(APPEARANCE_MODE_LABELS.system).toBe("跟随系统");
    expect(APPEARANCE_MODE_LABELS.light).toBe("浅色");
    expect(APPEARANCE_MODE_LABELS.dark).toBe("深色");
  });
});

describe("settingsWithMode / settingsWithPreset", () => {
  it("改 mode 只动 mode，其余字段原样（字号/字体不在本片，不许被顺手重置）", () => {
    const base = createDefaultAppearanceSettings();
    expect(settingsWithMode(base, "dark")).toEqual({ ...base, mode: "dark" });
  });

  it("预设同时改浅色与深色两套配色，并记下 preset id", () => {
    const next = settingsWithPreset(createDefaultAppearanceSettings(), "paper");
    expect(next).not.toBeNull();
    expect(next?.light.preset).toBe("paper");
    expect(next?.dark.preset).toBe("paper");
    expect(next?.light.accent).toBe("#B5683B");
    expect(next?.dark.accent).toBe("#E49B66");
  });

  it("未知预设 id ⇒ null（调用方一个字节都不改）", () => {
    expect(settingsWithPreset(createDefaultAppearanceSettings(), "ghost")).toBeNull();
  });
});

describe("createSystemSchemeWatcher（M9 的保护对象）", () => {
  it("只有 system 档注册系统监听，切到 light/dark 立刻注销", () => {
    const source = fakeSource();
    const onChange = vi.fn();
    const watcher = createSystemSchemeWatcher(source, onChange);
    watcher.sync("system");
    expect(watcher.listening()).toBe(true);
    expect(source.added).toBe(1);
    watcher.sync("light");
    expect(watcher.listening()).toBe(false);
    expect(source.removed).toBe(1);
  });

  it("重复 sync 同一档不重复注册也不重复注销（幂等）", () => {
    const source = fakeSource(true);
    const onChange = vi.fn();
    const watcher = createSystemSchemeWatcher(source, onChange);
    watcher.sync("system");
    watcher.sync("system");
    expect(source.added).toBe(1);
    watcher.sync("dark");
    watcher.sync("dark");
    expect(source.removed).toBe(1);
    expect(source.added).toBe(1);
  });

  it("light/dark 档下 sync 从不注册 —— 锁色后系统切深色不该变色（M9 打这条）", () => {
    const source = fakeSource();
    const watcher = createSystemSchemeWatcher(source, vi.fn());
    watcher.sync("light");
    watcher.sync("dark");
    expect(source.added).toBe(0);
    expect(watcher.listening()).toBe(false);
  });

  it("系统变化只回调一次并带上新的色", () => {
    const source = fakeSource(false);
    const onChange = vi.fn();
    const watcher = createSystemSchemeWatcher(source, onChange);
    watcher.sync("system");
    expect(onChange).not.toHaveBeenCalled();
    source.fire();
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("dispose 幂等：注销后再 dispose 不多摘一次", () => {
    const source = fakeSource();
    const watcher = createSystemSchemeWatcher(source, vi.fn());
    watcher.sync("system");
    watcher.dispose();
    expect(source.removed).toBe(1);
    watcher.dispose();
    expect(source.removed).toBe(1);
  });
});
```

「系统变化只回调一次」那条用 `source.fire(true)`，断言 `onChange` 收到 `"dark"`。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/theme-mode.test.ts --maxWorkers=4` → FAIL（模块不存在）。

- [ ] **Step 7：`utils/theme-mode.ts`（转绿）**

```ts
import { themePresets } from "../composables/appearanceThemeRuntime";
import type {
  AppearanceColorScheme,
  AppearanceMode,
  AppearanceSettings
} from "@mochen/contracts";

/** 三档中文（铁律 6：唯一一份，面板与提示语都查这张表）。 */
export const APPEARANCE_MODE_LABELS: Record<AppearanceMode, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色"
};

/** mode === "system" 才跟系统，否则恒取 mode —— 总 spec §10 的三态语义。 */
export function resolveEffectiveScheme(
  mode: AppearanceMode,
  systemScheme: AppearanceColorScheme
): AppearanceColorScheme {
  return mode === "system" ? systemScheme : mode;
}

export function settingsWithMode(
  settings: AppearanceSettings,
  mode: AppearanceMode
): AppearanceSettings {
  return { ...settings, mode };
}

/** 预设同时改两套配色的 accent/背景/前景；未知 id 返回 null，由调用方给可见原因。 */
export function settingsWithPreset(
  settings: AppearanceSettings,
  presetId: string
): AppearanceSettings | null {
  const preset = themePresets.find((item) => item.id === presetId);
  if (!preset) return null;
  return {
    ...settings,
    light: { ...settings.light, ...preset.light, preset: preset.id },
    dark: { ...settings.dark, ...preset.dark, preset: preset.id }
  };
}

/** 只声明用到的三个成员，真 MediaQueryList 结构上满足它，测试给个假对象即可计数。 */
export interface MediaQueryListLike {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export interface SystemSchemeWatcher {
  sync(mode: AppearanceMode): void;
  dispose(): void;
  listening(): boolean;
}

/**
 * 系统配色监听的生命周期归 mode 管：App.vue 只负责在 mode 变化时调 sync。
 * 现仓 App.vue:46-48 是无条件注册且从不注销，M9 就是把这里的 mode 判断删掉来验证保护有效。
 */
export function createSystemSchemeWatcher(
  source: MediaQueryListLike,
  onChange: (scheme: AppearanceColorScheme) => void
): SystemSchemeWatcher {
  let listening = false;
  const handleChange = (): void => onChange(source.matches ? "dark" : "light");
  return {
    sync(mode) {
      if (mode === "system") {
        if (!listening) {
          source.addEventListener("change", handleChange);
          listening = true;
        }
        return;
      }
      if (listening) {
        source.removeEventListener("change", handleChange);
        listening = false;
      }
    },
    dispose() {
      if (!listening) return;
      source.removeEventListener("change", handleChange);
      listening = false;
    },
    listening: () => listening
  };
}
```

Run: 同 Step 6 命令 → 五组 describe 全绿。

- [ ] **Step 8：`useAppearanceStore` —— 先红（假 `window.mochen` 夹具）**

新建 `stores/useAppearanceStore.test.ts`，夹具照 `stores/useBookStore.test.ts`（`vi.stubGlobal("window", { mochen: api })`、`api satisfies RendererApi`、`setActivePinia(createPinia())`、中文标题）。因为 `RendererApi` 是 17 个方法，夹具用现仓既有的「全部指向抛错实现」写法兜住不用的那些：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  createDefaultAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot,
  type RendererApi
} from "@mochen/contracts";
import { useAppearanceStore } from "./useAppearanceStore";

const snapshots: AppearanceSettingsSnapshot[] = [];
const saved: AppearanceSettings[] = [];
let failNextSave = false;

const notCalled = (name: string) => async () => {
  throw new Error(`本任务不该调用 ${name}`);
};

const api = {
  appearanceView: async (): Promise<AppearanceSettingsSnapshot> => {
    if (snapshots.length === 0) return { persisted: false, settings: createDefaultAppearanceSettings() };
    return snapshots[0] as AppearanceSettingsSnapshot;
  },
  saveAppearance: async (settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot> => {
    if (failNextSave) throw new Error("外观设置写入失败（EBUSY）；请检查设置目录是否可写。");
    saved.push(settings);
    return { persisted: true, settings };
  },
  pickBookDirectory: notCalled("pickBookDirectory"),
  openBook: notCalled("openBook"),
  saveMeta: notCalled("saveMeta"),
  readDoc: notCalled("readDoc"),
  writeDoc: notCalled("writeDoc"),
  startTurn: notCalled("startTurn"),
  interruptTurn: notCalled("interruptTurn"),
  decideProposal: notCalled("decideProposal"),
  proposalDiff: notCalled("proposalDiff"),
  providerView: notCalled("providerView"),
  providerSave: notCalled("providerSave"),
  onAgentEvent: notCalled("onAgentEvent"),
  loadSession: notCalled("loadSession"),
  contextPreview: notCalled("contextPreview"),
  listProfiles: notCalled("listProfiles")
} satisfies RendererApi;

let store: ReturnType<typeof useAppearanceStore>;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  snapshots.length = 0;
  saved.length = 0;
  failNextSave = false;
  store = useAppearanceStore();
});

describe("useAppearanceStore · 装载", () => {
  it("load 把盘上档收进来并置 loaded/persisted", async () => {
    snapshots.push({
      persisted: true,
      settings: { ...createDefaultAppearanceSettings(), mode: "dark" }
    });
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.persisted).toBe(true);
    expect(store.settings.mode).toBe("dark");
    expect(store.effectiveMode).toBe("dark");
  });

  it("load 失败：loaded 照样置真，首屏不许卡在读取中；原因进 notice", async () => {
    vi.stubGlobal("window", {
      mochen: { ...api, appearanceView: async () => {
        throw new Error("通道未注册");
      } }
    });
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.notice).toBe("通道未注册");
    expect(store.settings).toEqual(createDefaultAppearanceSettings());
  });
});

describe("useAppearanceStore · 三态与预设", () => {
  it("setMode 落盘并采纳主进程回来的档；成功清 notice", async () => {
    await store.load();
    await store.setMode("light");
    expect(saved[0]?.mode).toBe("light");
    expect(store.settings.mode).toBe("light");
    expect(store.notice).toBe("");
  });

  it("同档重复 setMode 不发第二次写（省一次 IPC，也省一次闪变）", async () => {
    await store.load();
    await store.setMode("system");
    expect(saved.length).toBe(0);
  });

  it("写失败 ⇒ 回滚到改之前的档，UI 不声称盘上没有的状态", async () => {
    await store.load();
    failNextSave = true;
    await store.setMode("dark");
    expect(store.settings.mode).toBe("system");
    expect(store.notice).toBe("外观设置写入失败（EBUSY）；请检查设置目录是否可写。");
    expect(store.persisted).toBe(false);
  });

  it("setPreset(「paper」)：两套配色一起换并记下 preset id", async () => {
    await store.load();
    await store.setPreset("paper");
    expect(saved[0]?.light.preset).toBe("paper");
    expect(store.settings.dark.preset).toBe("paper");
  });

  it("未知 preset id ⇒ 一句中文，不发写请求", async () => {
    await store.load();
    await store.setPreset("ghost");
    expect(store.notice).toBe("没有这个主题预设，未做改动");
    expect(saved.length).toBe(0);
  });

  it("resetToDefault 写回默认档（mode 回到 system）", async () => {
    await store.load();
    await store.setMode("dark");
    await store.resetToDefault();
    expect(store.settings).toEqual(createDefaultAppearanceSettings());
    expect(saved[1]).toEqual(createDefaultAppearanceSettings());
  });
});

describe("useAppearanceStore · 有效配色", () => {
  it("system 档跟 setSystemScheme，锁 light 后系统给 dark 也不变", async () => {
    await store.load();
    store.setSystemScheme("dark");
    expect(store.effectiveScheme).toBe("dark");
    await store.setMode("light");
    expect(store.effectiveScheme).toBe("light");
    store.setSystemScheme("dark");
    expect(store.effectiveScheme).toBe("light");
  });

  it("themePresetId 读的是当前有效配色那一套的 preset", async () => {
    await store.load();
    store.setSystemScheme("light");
    await store.setPreset("ocean");
    expect(store.themePresetId).toBe("ocean");
    await store.setMode("dark");
    expect(store.themePresetId).toBe("ocean");
  });
});
```

`snapshots[0] as AppearanceSettingsSnapshot` 与 `notCalled` 的返回类型都带显式标注；`strict` 下不给标注会红在 `unknown`，这条别顺手删。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAppearanceStore.test.ts --maxWorkers=4` → FAIL（`./useAppearanceStore` 不存在）。

- [ ] **Step 9：`stores/useAppearanceStore.ts`（转绿）**

```ts
import { defineStore } from "pinia";
import {
  createDefaultAppearanceSettings,
  type AppearanceColorScheme,
  type AppearanceMode,
  type AppearanceSettings
} from "@mochen/contracts";
import { resolveEffectiveScheme, settingsWithMode, settingsWithPreset } from "../utils/theme-mode";

/**
 * 外观是全局用户偏好，不按书保存（Plan 3 spec §17），所以这里不读 book.meta。
 * 每次改动都先落盘、再采纳主进程回来的档：主进程做了 schema 校验与默认值补齐，
 * 渲染层不该留着「我以为写进去了」的那份。
 */
export const useAppearanceStore = defineStore("appearance", {
  state: () => ({
    settings: createDefaultAppearanceSettings(),
    persisted: false,
    loaded: false,
    notice: "",
    systemScheme: "light" as AppearanceColorScheme
  }),

  getters: {
    effectiveMode: (state): AppearanceMode => state.settings.mode,
    effectiveScheme(state): AppearanceColorScheme {
      return resolveEffectiveScheme(state.settings.mode, state.systemScheme);
    },
    themePresetId(state): string {
      return state.settings[resolveEffectiveScheme(state.settings.mode, state.systemScheme)].preset;
    }
  },

  actions: {
    async load() {
      try {
        const snapshot = await window.mochen.appearanceView();
        this.settings = snapshot.settings;
        this.persisted = snapshot.persisted;
      } catch (reason) {
        // 拿不到也要照默认档渲染：loaded 置真，否则首屏永远等在「读取中」。
        this.notice = reason instanceof Error ? reason.message : String(reason);
      }
      this.loaded = true;
    },

    setSystemScheme(scheme: AppearanceColorScheme): void {
      this.systemScheme = scheme;
    },

    /** 唯一的写通路：乐观置新档 → 失败回滚 → 成功采纳主进程返回值。 */
    async apply(next: AppearanceSettings): Promise<boolean> {
      const previous = this.settings;
      this.settings = next;
      try {
        const snapshot = await window.mochen.saveAppearance(next);
        this.settings = snapshot.settings;
        this.persisted = snapshot.persisted;
        this.notice = "";
        return true;
      } catch (reason) {
        this.settings = previous;
        this.notice = reason instanceof Error ? reason.message : String(reason);
        return false;
      }
    },

    async setMode(mode: AppearanceMode) {
      if (mode === this.settings.mode) return;
      await this.apply(settingsWithMode(this.settings, mode));
    },

    async setPreset(id: string) {
      const next = settingsWithPreset(this.settings, id);
      if (!next) {
        this.notice = "没有这个主题预设，未做改动";
        return;
      }
      await this.apply(next);
    },

    async resetToDefault() {
      await this.apply(createDefaultAppearanceSettings());
    }
  }
});
```

Run: 同 Step 8 命令 → 全绿。

- [ ] **Step 10：`App.vue` 接线（M9 的宿主，只准接线）**

把 `<script setup>` 整段换成下面这版（模板与根 div 一字不动；删掉 `createDefaultAppearanceSettings` 的局部实例、`preferredScheme()` 与 `schemeQuery` 三个旧成员）：

```ts
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { applyAppearanceThemeToDocument } from "./composables/appearanceThemeRuntime";
import { useAppearanceStore } from "./stores/useAppearanceStore";
import { createSystemSchemeWatcher, type SystemSchemeWatcher } from "./utils/theme-mode";
import LeftSidebar from "./components/LeftSidebar.vue";
import CenterColumn from "./components/CenterColumn.vue";
import DocumentPane from "./components/DocumentPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import { LEFT_PANE_MAX, LEFT_PANE_MIN, RIGHT_PANE_MIN, useLayoutStore } from "./stores/layoutStore";

const layout = useLayoutStore();
const {
  desktopShell,
  shellClasses,
  shellStyle,
  leftCollapsed,
  rightCollapsed,
  leftPaneWidth,
  rightPaneWidth
} = storeToRefs(layout);

const appearance = useAppearanceStore();

function applyTheme(): void {
  const scheme = appearance.effectiveScheme;
  applyAppearanceThemeToDocument({
    scheme,
    theme: appearance.settings[scheme],
    uiFontFamily: appearance.settings.uiFontFamily,
    editorFontFamily: appearance.settings.editorFontFamily
  });
}

let schemeWatcher: SystemSchemeWatcher | undefined;

onMounted(async () => {
  // 先取盘上档再上色：反过来会先闪一下默认主题。
  await appearance.load();
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  appearance.setSystemScheme(query.matches ? "dark" : "light");
  schemeWatcher = createSystemSchemeWatcher(query, (scheme) => {
    appearance.setSystemScheme(scheme);
    applyTheme();
  });
  schemeWatcher.sync(appearance.settings.mode);
  applyTheme();
  window.addEventListener("resize", layout.reconcilePaneWidths);
});

// mode 是唯一开关：锁浅色/深色时监听器被摘掉，系统切深色不该变色（M9 打这条）。
watch(
  () => appearance.settings.mode,
  (mode) => schemeWatcher?.sync(mode)
);

const rightPaneMax = computed(() => layout.writingRightPaneViewModel.maxWidth);

onBeforeUnmount(() => {
  schemeWatcher?.dispose();
  window.removeEventListener("resize", layout.reconcilePaneWidths);
});
```

跑 `corepack pnpm typecheck` 之外，本步骤的验证是**静态门禁 + 人工读**：`.vue` 零模板覆盖是既定事实（Plan 3 spec §15 末段），所以这里能被自动化证明的部分已经全在 `theme-mode.test.ts` / `useAppearanceStore.test.ts` 里，`App.vue` 只剩 `await load()` → `setSystemScheme` → `sync` → `applyTheme` 四个调用。

- [ ] **Step 11：`components/AppearancePanel.vue`**

新文件，全部判断来自 store / `utils/theme-mode.ts` / `themePresets`，组件里不许出现 `mode === "system" ? ...` 这类配色裁决（除按钮 `:class` 的选中态与一句提示语，见本节末）。三档的顺序取自契约枚举 `AppearanceModeSchema.options`，不在组件里手抄第二份档名数组（铁律 6）：

```vue
<!-- 主题三态：判定在 utils/theme-mode.ts 与 stores/useAppearanceStore.ts，这里只接线。 -->
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { AppearanceModeSchema, type AppearanceMode } from "@mochen/contracts";
import { themePresets } from "../composables/appearanceThemeRuntime";
import { useAppearanceStore } from "../stores/useAppearanceStore";
import { APPEARANCE_MODE_LABELS } from "../utils/theme-mode";

const appearance = useAppearanceStore();
const { settings, persisted, notice, effectiveScheme, themePresetId } = storeToRefs(appearance);

const modes = AppearanceModeSchema.options;

function selectMode(mode: AppearanceMode): void {
  void appearance.setMode(mode);
}

function selectPreset(id: string): void {
  void appearance.setPreset(id);
}

function reset(): void {
  void appearance.resetToDefault();
}
</script>

<template>
  <div class="appearance-panel">
    <div class="appearance-group">
      <span class="appearance-group-label">显示模式</span>
      <div class="appearance-segment" role="group" aria-label="显示模式">
        <button
          v-for="mode in modes"
          :key="mode"
          type="button"
          class="appearance-segment-button"
          :class="{ 'is-active': settings.mode === mode }"
          :aria-pressed="settings.mode === mode"
          @click="selectMode(mode)"
        >
          {{ APPEARANCE_MODE_LABELS[mode] }}
        </button>
      </div>
      <p class="appearance-hint">
        {{
          settings.mode === "system"
            ? `当前跟随系统 · ${effectiveScheme === "dark" ? "深色" : "浅色"}`
            : "已锁定配色，不跟随系统；重启后保持"
        }}
      </p>
    </div>

    <div class="appearance-group">
      <span class="appearance-group-label">主题预设</span>
      <div class="appearance-preset-list">
        <button
          v-for="preset in themePresets"
          :key="preset.id"
          type="button"
          class="appearance-preset"
          :class="{ 'is-active': themePresetId === preset.id }"
          :aria-pressed="themePresetId === preset.id"
          @click="selectPreset(preset.id)"
        >
          <span class="appearance-preset-name">{{ preset.label }}</span>
          <span
            class="appearance-preset-dot"
            :style="{
              background: preset[effectiveScheme].accent,
              borderColor: preset[effectiveScheme].background
            }"
          />
        </button>
      </div>
    </div>

    <div class="appearance-actions">
      <button type="button" class="dialog-secondary-button" @click="reset">恢复默认</button>
      <span v-if="!persisted" class="appearance-hint">还没存过，改动后会写进设置目录</span>
    </div>

    <p v-if="notice" class="appearance-error">{{ notice }}</p>
  </div>
</template>
```

`settings.mode === "system"` 那处三元只是**显示哪句提示语**，不含配色裁决——配色裁决全在 `resolveEffectiveScheme`。若评审认为这句也算判断，接受的做法是把提示文本也做成 `utils/theme-mode.ts` 的 `modeHint(mode, scheme): string` 纯函数并补两条用例，不许把判断留在模板里。

- [ ] **Step 12：挂进设置弹层 + 样式**

`components/ProviderSettings.vue` 改成两节，初值来自 `layoutStore.settingsInitialCategory`（Task 7/8 的 `Ctrl+,` 与 `/model` 传 `"general"`，外观一节由用户在弹层内切换到达——本片不加新的 `/` 命令，§6 的命令表是终态 7 条）：

- `<script setup>` 里加：

```ts
import { storeToRefs } from "pinia";
import AppearancePanel from "./AppearancePanel.vue";
import { useLayoutStore } from "../stores/layoutStore";

const layout = useLayoutStore();
const { settingsInitialCategory } = storeToRefs(layout);
const section = ref(settingsInitialCategory.value === "appearance" ? "appearance" : "general");
```

- `<header>` 里的 `<h2 id="provider-title">` 文本改 `{{ section === "appearance" ? "外观设置" : "模型设置" }}`，`aria-label="关闭模型设置"` 改 `:aria-label="section === "appearance" ? "关闭外观设置" : "关闭模型设置""`。
- `<div class="dialog-content">` 内现有五个字段/段落/动作整体包进 `<div v-if="section === "general"">`，其后加：

```html
        <div v-else class="dialog-section">
          <AppearancePanel />
        </div>
```

- `<div class="dialog-content">` 开头加节切换（两个 `dialog-secondary-button`，`:class="{ 'is-active': section === 'general' }"`），文案「模型」「外观」。

`styles/interaction.css` 追加（毛玻璃延续既有 token，不新造色值）：

```css
.appearance-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.appearance-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.appearance-group-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  opacity: 0.72;
}
.appearance-segment {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--fg) 6%, transparent);
}
.appearance-segment-button {
  flex: 1;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.appearance-segment-button.is-active {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.appearance-preset-list {
  display: flex;
  gap: 8px;
}
.appearance-preset {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--fg) 14%, transparent);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.appearance-preset.is-active {
  border-color: var(--accent);
}
.appearance-preset-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid transparent;
}
.appearance-hint {
  font-size: 12px;
  opacity: 0.72;
  margin: 0;
}
.appearance-error {
  font-size: 12px;
  color: var(--danger, #d1584f);
  margin: 0;
}
.appearance-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
```

（`--fg` / `--accent` 是 `applyAppearanceThemeToDocument` 已写进 `:root` 的 token 名，落地前先 `grep -n "setProperty" composables/appearanceThemeRuntime.ts` 核对名字，不许凭记忆造变量。）

- [ ] **Step 13：变异 M9 —— 无条件注册必须转红**

用 Edit 把 `utils/theme-mode.ts` 的 `sync` 改成「无论什么 mode 都注册」（Plan 3 spec §15 M9 的变异动作，等价于把现仓 `App.vue:46-48` 的无条件注册搬进新模块）：

```ts
    sync(mode) {
      if (!listening) {
        source.addEventListener("change", handleChange);
        listening = true;
      }
      void mode;
    },
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/theme-mode.test.ts --maxWorkers=4`
Expected: FAIL ≥2 条 —— 「只有 system 档注册系统监听…」（`source.removed` 仍为 0）与「light/dark 档下 sync 从不注册」（`source.added` 为 1）。把红的用例名与计数贴进台账，然后用 Edit **逐字改回**并复跑至绿。

- [ ] **Step 14：定点校验 + 提交**

```bash
corepack pnpm exec prettier --check "apps/desktop/src/**/*.{ts,vue,css}" "docs/superpowers/plans/*.md"
corepack pnpm exec eslint apps/desktop/src/main/appearance-settings.ts apps/desktop/src/main/appearance-settings.test.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/renderer/src/utils/theme-mode.ts apps/desktop/src/renderer/src/utils/theme-mode.test.ts apps/desktop/src/renderer/src/stores/useAppearanceStore.ts apps/desktop/src/renderer/src/stores/useAppearanceStore.test.ts apps/desktop/src/renderer/src/App.vue apps/desktop/src/renderer/src/components/AppearancePanel.vue apps/desktop/src/renderer/src/components/ProviderSettings.vue --max-warnings=0
corepack pnpm vitest run apps/desktop/src/main/appearance-settings.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/renderer/src/utils/theme-mode.test.ts apps/desktop/src/renderer/src/stores/useAppearanceStore.test.ts --maxWorkers=4
```

Expected: 三条都退 0；vitest 末尾 `Test Files 4 passed`、用例数与新增条数对得上（本任务约 25 条）。行数门禁：`AppearancePanel.vue` ≤120、`ProviderSettings.vue` ≤150、`App.vue` ≤120。

```bash
git add apps/desktop/src/main/appearance-settings.ts apps/desktop/src/main/appearance-settings.test.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/utils/theme-mode.ts apps/desktop/src/renderer/src/utils/theme-mode.test.ts apps/desktop/src/renderer/src/stores/useAppearanceStore.ts apps/desktop/src/renderer/src/stores/useAppearanceStore.test.ts apps/desktop/src/renderer/src/App.vue apps/desktop/src/renderer/src/components/AppearancePanel.vue apps/desktop/src/renderer/src/components/ProviderSettings.vue apps/desktop/src/renderer/src/styles/interaction.css
git commit -m "feat(theme): 主题三态落 appearance.json，系统监听只在跟随系统时注册"
```

- [ ] **Step 15：真机复验（控制方亲自操作，不委托）**

设置弹层 → 外观：三态各截一张图；锁「浅色」后在 Windows 设置里把系统切成深色，**应用不变色**；改回「跟随系统」再切系统深色，**当场变色**；每态重启一次，回来仍是那一态。设置目录里出现 `appearance.json`（`%APPDATA%\mochen-writing\`，波 3 才迁）。

**风险与留底**：

- 本任务动的是首屏装载路径（`App.vue` 的 `onMounted` 由同步变异步）。若 `appearanceView()` 因通道未注册而 reject，`load()` 已兜住并置 `loaded`，UI 照默认档渲染——这是 Step 8 第二条用例钉的东西。
- 外观的 `uiFontFamily` / `editorFontFamily` 与字号字段进 `appearance.json` 但 UI 不动（§17），所以 `settingsWithMode` 与 `settingsWithPreset` 都基于展开复制，绝不重置它们。
- 按书保存外观不做（§17），store 不读 `book.meta`，也不看当前书。

### Task 20：波 2 门禁 + 真机冒烟 + 台账（含 `/__requests` 抓取扩展）

**Files:**

- Modify: `tools/mock-provider.mjs`（现 234 行；`:190-204` 的 `requests.push` 扩三项，`:185-189` 的 `/__requests` 端点已存在，不动）
- Create: `docs/superpowers/plans/2026-10-02-plan3-wave2-report.md`
- Modify: `docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md`（勾波 2 已验证的复选框）
- 只跑不改：`packages/contracts`、`packages/agent-runtime`、`apps/desktop` 全域（门禁）

**Interfaces:**

- Consumes：Task 11–19 的全部产物；Plan 3 spec §15 的 M6/M7/M8/M9 与 §16 的第 5–7 项冒烟；Plan 2 已有的 `tools/mock-provider.mjs`（`--port`、`--doc`、`MOCHEN_MOCK_DOC`、`/__health`、`/__requests`）。
- Produces：`/__requests` 的每条记录多出 `system`（该轮 system 消息全文）、`systemChars`、`toolNames`（`tools` 数组里的函数名）三个字段。波 3 Task 27 的档案冒烟复用同一份输出。

**为什么这一步要改 mock-provider**：档案的两道硬闸（请求侧 `TOOL_SPECS` 过滤、提示词随档案变）都发生在主进程往 `stream(req)` 组装请求的那一刻，渲染层看不见。要证明「不是提示词在恳求、是工具集真被剪了」，唯一的观测点是被调方收到的载荷。Plan 2 版只记 `messages.length`，看不出 system 与 tools。

- [ ] **Step 1：`/__requests` 扩抓取（先手动验红）**

先把桩起起来看现在的输出，确认它证明不了任何事（这是廉价门禁，别跳过）：

```bash
corepack pnpm mock-provider   # 前台跑，另一个终端做下面的请求；用完 Ctrl+C
```

另一个终端（`node -e` 在本机可用，`python` 不可用；`node` 的 `-e` 默认按 CommonJS 解析，动态 `import()` 与 `fetch` 都能用）：

```bash
node -e "
const body = JSON.stringify({
  model: 'm',
  messages: [{ role: 'system', content: '你是墨宸 · 审稿。' }, { role: 'user', content: 'hi' }],
  tools: [{ type: 'function', function: { name: 'read_doc' } }, { type: 'function', function: { name: 'propose_patch' } }]
});
fetch('http://127.0.0.1:8787/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer sk-should-never-appear' },
  body
})
  .then(() => fetch('http://127.0.0.1:8787/__requests'))
  .then((r) => r.text())
  .then((t) => console.log(t));
"
```

Expected：只有 `{url,method,hasAuth,model,messages}` 五个键 —— 没有 system 内容、没有工具名，`tools` 数组被完全忽略。

`tools/mock-provider.mjs` 的 `requests.push`（`:198-204`）改成：

```js
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const system = messages.find((item) => item && item.role === "system");
  // 密钥只记「有没有带」，绝不落进日志：spec §8 的单向性在这里也要成立。
  // system 全文进内存是为了让档案冒烟能证明提示词随档变化；它只在 127.0.0.1 的进程内存里，
  // 绝不写盘、绝不出现在日志与 commit（Task 27 的冒烟报告只贴节选与计数）。
  requests.push({
    url,
    method: req.method,
    hasAuth: Boolean(req.headers.authorization),
    model: parsed.model,
    messages: messages.length,
    system: typeof system?.content === "string" ? system.content : "",
    systemChars: typeof system?.content === "string" ? system.content.length : 0,
    toolNames: Array.isArray(parsed.tools)
      ? parsed.tools.map((tool) => tool?.function?.name ?? tool?.name ?? "?")
      : []
  });
```

（`:191-196` 的 `parsed` 解析与「坏 body 也进日志」的姿态不动；`hasAuth` 那行一字不改 —— 它已经是这条纪律的落点。）

复跑上面那条 `node -e`，Expected：同一份载荷里 `system === "你是墨宸 · 审稿。"`、`systemChars === 9`、`toolNames === ["read_doc","propose_patch"]`，且整个 JSON 里搜不到 `sk-should-never-appear`：

```bash
node -e "fetch('http://127.0.0.1:8787/__requests').then((r) => r.text()).then((t) => { console.log(t); if (t.includes('sk-should-never-appear')) throw new Error('密钥漏进日志'); })"
```

桩用完就停（`Ctrl+C` / 按 Plan 2 的做法确认端口上没有残留进程）。

- [ ] **Step 2：波 2 全量门禁**

```bash
corepack pnpm verify 2>&1 | tee /tmp/plan3-wave2-verify.log; echo "VERIFY_PIPESTATUS=$?"
grep -n "VERIFY_EXIT\|Test Files\|Tests " /tmp/plan3-wave2-verify.log
```

Expected（逐条回读日志，不看外壳退出码 —— `| tee` 会把门禁的码换成管道里最后一个命令的码，所以两条都要看）：

- `prettier --check` 无 diff；
- 5 个 tsc 工程全过（`contracts` / `fs-store` / `agent-runtime` / `desktop-main` / `desktop-renderer`）；
- `eslint --max-warnings=0` 零告警；
- `check-package-boundary.mjs` 通过 —— 本波把 `ContextReader` 放进了 runtime、`fs` 版实现放进了 main，这条门禁打的就是这个边界；
- `check-source-line-budget.mjs` 通过（800 行）且 `CenterColumn.vue` ≤400（Task 18 接线后回读一次实际行数并记进台账）；
- vitest `--maxWorkers=4`：`VERIFY_EXIT=0`，用例数 ≥445（基线 353 + 波 1 增量 + 本波 11–19 新增；实际数字照日志记，不许写目标值当结果）。

若红的文件每次不同且都是 timeout：本机 dev 在跑，按既有做法用 `--maxWorkers=4` 逐文件复核，不当真红灯，并在台账里注明是并发争用。

- [ ] **Step 3：契约连带自检（照计划头的契约变更总表逐行回读）**

不靠 `dist`（本仓没有必须先 build 才能验的约定），也不在 shell 里解析 TS：数字一律用 `awk` 从源码取，语义用例来钉。

```bash
awk '/^export const IPC_CHANNELS/,/^} as const;/' packages/contracts/src/ipc.ts | grep -c ': "'
awk '/^export interface RendererApi/,/^}/' packages/contracts/src/ipc.ts | grep -c '('
grep -n "toBe(17)" apps/desktop/src/preload/renderer-api.test.ts
grep -n "DEFAULT_PROFILE_ID = " packages/agent-runtime/src/profiles.ts
corepack pnpm vitest run packages/agent-runtime/test/profiles.test.ts packages/contracts/test/contract.test.ts --maxWorkers=4
```

Expected：通道 **17**、`RendererApi` 方法 17、`renderer-api.test.ts` 的字面量 `toBe(17)` 在位、`DEFAULT_PROFILE_ID === "writer"`、`profiles.test.ts` 里「六条 roster」与「`allowedTools ⊆ AGENT_TOOL_NAMES`」两条绿（工具集出现第 6 个名字时该用例即红，Plan 3 spec §15 的 `AGENT_TOOL_NAMES` 计数用例同样兜住）。`book.json` 的 `schemaVersion` 仍是 1：`grep -n "schemaVersion" packages/contracts/src/book.ts`。

- [ ] **Step 4：变异复跑 M6 / M7 / M8 / M9（评审者自己跑，不采信转录）**

四条都用 Edit 改，改完立刻复跑指定文件，再逐字改回。禁 `perl -i` / `sed -i`。

| 编号 | 改哪里 | 改成什么 | 必须转红 |
| --- | --- | --- | --- |
| M6 | `main/agent-service.ts` 的 `applyDecision` | 删掉档案范围那一段判定（保留档位闸） | 审稿档案批准 `write_doc` 不再被中文拒绝的用例（Task 17） |
| M7 | `main/agent-service.ts` 组装 `stream(req)` 的 `tools` | `TOOL_SPECS` 不过滤直传 | 「审稿的请求里没有 `write_doc`」（Task 16） |
| M8 | `agent-runtime/src/context-pack.ts` 的预算分支 | 删整节丢弃、改成对超限节做半句 `slice`（按字符，不管码点） | `omitted` 非空 + 「尾部不是半句话」两条（Task 14） |
| M9 | `renderer/src/utils/theme-mode.ts` 的 `sync` | 无条件注册（Task 19 Step 13 那一版） | 「light/dark 档下 `source.added === 0`」等两条 |

```bash
corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/renderer/src/utils/theme-mode.test.ts --maxWorkers=4
```

台账里每条记四件事：变异动作原文、红的用例名与断言原文、改回后的绿、谁重跑的。M8 额外贴出「变异后那个尾字符是代理对的一半」的实际字符（这是它比「截断」更具体的一层，Plan 2 的码点教训）。

- [ ] **Step 5：真机冒烟（控制方亲自操作，不委托；§16 第 5–7 项）**

端点用 `http://127.0.0.1:8787/v1`（本地桩）跑第 6 项，再用真端点跑第 5、7 项各一遍。密钥纪律照旧：**只在设置对话框里输入**，绝不进命令行/日志/报告/commit；报告里只写 baseURL 与模型名。

5. **外观**：三态各截一张图 → 重启应用 → 三态各自保持；「跟随系统」态下在 Windows 设置切系统配色，应用当场变色；锁「浅色」后切系统深色，**应用不变**。设置目录出现 `%APPDATA%\mochen-writing\appearance.json`（波 3 才迁，现在就该在旧目录）。
6. **档案**：六个档案逐个切一次，每次发一轮，然后 `curl`/`fetch` 打 `/__requests`，逐条核对
   - `system` 开头是该档案的中文提示词（六条互不相同），
   - `toolNames`：`world` / `chief-editor` / `character` / `writer` 四条含 `write_doc`，`continuator` / `reviewer` 两条**不含**，
   - 审稿档案下让模型试 `write_doc`：请求里没这工具（`toolNames` 为证），若模型仍从文本块塞一条提案进来，则批准时被中文拒绝且提案保留。
7. **占用条**：换章节、挂一份素材、切档案，占用条随每次变化刷新（`约 N 字 · 约 M token` 的「约」字在位）；把 `CONTEXT_CHAR_BUDGET` 临时调到很小（只为冒烟观察，验完改回并确认 `git status` 干净）复现「已省略 N 节（…）」，同时确认被省略的节在 system 里真的不出现。

另加两项本波自带的回归观察（不算 §16 正式条目，但要写进报告）：

- 波 1 的回放在波 2 之后仍然工作（加了 `profileId` 的 JSONL 与老 JSONL 各回放一次，老线程的档案名回落默认档且**没有**可见 `error`；被改写载荷导致未知 id 时，`error` 事件在位）。
- `/stage` 在 `profilesReady` 为假时不可用（Task 18 的联动），档案列表拿不到时中栏头部显示的是原因而不是空的下拉。

- [ ] **Step 6：波 2 台账与报告**

新建 `docs/superpowers/plans/2026-10-02-plan3-wave2-report.md`，五段，照 Plan 2 报告的口径：

```markdown
# Plan 3 波 2（Task 11–20）门禁、变异与真机冒烟

## 门禁（日志原文摘录）
- `VERIFY_EXIT=` / `VERIFY_PIPESTATUS=`
- `Test Files` / `Tests` 实际数字（不是目标值）
- `CenterColumn.vue` 行数、本波新增/修改文件的最长行数

## 契约连带自检
| 项 | 期望 | 实测 |
| IPC_CHANNELS 键数 | 17 | |
| RendererApi 方法数 | 17 | |
| `renderer-api.test.ts` 字面量 | 17 | |
| `AGENT_PROFILES` 条数 | 6 | |
| 工具名集合 | 五个，无第六 | |
| `book.json` `schemaVersion` | 1 | |

## 变异台账（M6/M7/M8/M9）
（每条：变异动作 → 红的用例名与断言原文 → 改回绿 → 评审者重跑结论）

## 真机通过项（§16 第 5–7 项 + 两条回归观察，逐条观测）
1. 外观：…
2. 档案：`toolNames` 六条实测值原样贴出（含 `continuator`/`reviewer` 不含 `write_doc`）
3. 占用条：…
4. 回放跨波未回退：…
5. `profilesReady` 为假时的 `/stage` 与头部：…

## 未做 / 留底（如实）
- `ContextPreviewInput.stageId` 目前只用于选默认档案，未参与节优先级排序。
- 档案的 `buildSections` 六条是**同一个** `delegateSections` 引用（共头「与 spec 的差异」第 1 条），逐档「上下文侧重」差异不在本片；报告里照这一句点名，别让评审去猜。
- 占用条的 `/status` 详情展开在波 3 才接技能节。
- 本轮冒烟用过的模型密钥：**已提醒轮换**。
```

- [ ] **Step 7：勾计划文件的复选框 + 波 2 提交**

把计划文件里波 2（Task 11–20）**确实验证过**的 `- [ ]` 改成 `- [x]`；变异没转红的、冒烟没实跑的留着不勾并在旁补一行原因（Plan 2 波 B 的做法）。

```bash
git add docs/superpowers/plans/2026-10-02-plan3-wave2-report.md docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md tools/mock-provider.mjs
git commit -m "docs(plan3): 波 2 全链门禁、变异台账与档案/外观冒烟记录"
```

- [ ] **Step 8：波 2 收尾自检（进波 3 之前必须全部为真）**

- [ ] `VERIFY_EXIT=0` 与 `VERIFY_PIPESTATUS=0` 都在日志里出现过，不是「上一波绿过」。
- [ ] M6/M7/M8/M9 四条各有红/绿两段证据，且评审者重跑过。
- [ ] 六档案的 `toolNames` 实测值贴进报告；`continuator` 与 `reviewer` 不含 `write_doc` 是**请求侧**证据（M7 的变异能转红），不是提示词措辞。
- [ ] 模型永不写盘：本波新增的档案范围只是**上限**，唯一写通路仍是「审批 → `book.writeDoc` → `writeDocFile`」，`profileAllowsDoc` 没有任何一处直接落盘。
- [ ] 渲染层没有 import `@mochen/agent-runtime`（门禁已过，但仍要 `grep -rn "agent-runtime" apps/desktop/src/renderer/src` 确认新增文件里是零）。
- [ ] 全程零新增 npm 依赖；`scanBook` 未动；`schemaVersion` 仍是 1。
- [ ] `appearance.json` 里没有密钥类字段；`git log -p -1 | grep -in "sk-\|authorization\|bearer"` 无输出（`hasAuth` 这个键名本身不含密钥，可以出现）。
- [ ] `git status --porcelain` 干净，`.mochen/` 与临时书目录未被 add。

---

## 波 3 —— 技能、迁移与总账

**波次验收**（本波结束必须全部成立）：

1. 技能库两源（全局 `<appData>/mochen-ai/skills/` 与书内 `.mochen/skills/`）只读浏览可用，「加入当前上下文」是**唯一**让技能进上下文的动作；被挂入技能的正文真的出现在 `system` 里（e2e 用例 B）。读取侧三条安全闸（`<单层目录名>/SKILL.md` 形状、解析后仍在库目录内、不跟软链出目录）与 64 KB 上限全在 `SkillsService` 一处（M10）。
2. 「浏览不打断」四条写成 store 层的死断言（Plan 3 spec §10）：开浏览不动文稿侧字段、关浏览只动浏览格、浏览与挂入都不动 `items`/`running`、只是打开正文不产生任何装配效果。
3. F-4 迁移按「只搬已知三件 → 验密 → 才改名」的时序发生，旧目录只改名不删除，迁移后凭据仍解得开、设置对话框掩码一字不变（M5 + e2e 用例 C）；文档三处（总 spec 路径、README 缺口清单、Plan 2 冒烟记录）同步到位。
4. 门禁：通道 17→19 全连带、`StartTurnInput` 到 6 字段、`PROPOSAL_STATUSES` 7 项、`scanBook` 未动、`schemaVersion` 仍是 1、工具仍只有 5 个、用例数 ≥475。
5. 台账：M1–M12 十二条加本计划自加的 S1/S2/S3 **全量当场复跑**，评审者本人重跑；`/resume`（§16 第 1–4 项）在波 3 之后不回退。

> 波 3 契约变更（spec §13）：通道 17→19（`skills:list` / `skills:read`）、`StartTurnInput` +`skillPaths`、`SkillRef` / `SkillContent` 进 contracts、`ContextReader` 第四端口 `readSkill` 与 `ContextPack.unreadableSkills`（runtime 内部，不进 contracts）。
> 命名与参数顺序一律以共头「接口总表 · 波 3」为准，不得改名、不得换参序。
> **落地顺序**：Task 21 落 `contracts/src/skill.ts`（`fs-store` 的 `scanSkills` 需要 `SkillRef` 类型，故 contracts 那一步从 Task 22 前移到 21）；Task 24 同时依赖 Task 22 的 `SkillsService` 与 Task 23 的载荷，必须在两者之后。

---

### Task 21：fs-store —— `scanSkills` 与技能 frontmatter 解析（不动 `scanBook`）

**Files:**

- Create: `packages/contracts/src/skill.ts`
- Modify: `packages/contracts/src/index.ts`（加一行 `export * from "./skill.js";`）
- Create: `packages/fs-store/src/skills.ts`
- Create: `packages/fs-store/test/skills.test.ts`
- Modify: `packages/fs-store/src/index.ts`（加 `export * from "./skills.js";`）
- 不动：`packages/fs-store/src/scan.ts`（`:18` 的 `SKIPPED_DIRS` 含 `.mochen` 是既有正确行为，Plan 3 spec §11 明写不为技能破例）

**Interfaces:**

- Consumes：`parseFrontmatter(raw): { data: Record<string, string | string[]>, body: string }`（`fs-store/src/frontmatter.ts:6`，**永不抛**：缺围栏或无闭栏都把整段当 body 返回，`data` 为 `{}`）；`toPosixRelPath(relPath)`（`paths.ts:1-3`）；`readdir` / `readFile`（`node:fs/promises`，照 `scan.ts:1-3` 的用法）。
- Produces（`contracts/src/skill.ts`，逐字照接口总表波 3）：

```ts
export const SKILL_SOURCES = ["global", "book"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];
export interface SkillRef {
  id: string; // `${source}:${dirName}`
  source: SkillSource;
  dirName: string;
  displayName: string;
  description: string;
  stages: string[];
  appliesTo: string[];
  relPath: string; // `${dirName}/SKILL.md`
}
export interface SkillContent {
  relPath: string;
  content: string;
  truncated: boolean;
}
```

- Produces（`fs-store/src/skills.ts`）：`export async function scanSkills(dir: string, source: SkillSource): Promise<SkillRef[]>`。

**为什么契约类型在本任务落，而不是 Task 22**：`fs-store` 已经 import `@mochen/contracts`（`scan.ts:4` 用 `BookKind`/`DocRef`），`scanSkills` 的返回类型必须是那份共享形状；把类型留到 Task 22 会让本任务的导出签名悬空。Task 22 因此**只加通道与消费方**（`IPC_CHANNELS` 两键 + `RendererApi` 两方法 + preload + 计数 17→19 + 主进程 service），不动 `skill.ts`。接口总表把两者都列在波 3，此处只是把落地顺序钉清楚。

**技能不是 `BookKind`**：`SkillRef` 自成一支，绝不塞进 `DocRef`（`book.ts` 的 `kind` 是 `BookKind`，塞进去就得伪造语义，还要改 `scanBook`）。

- [ ] **Step 1：契约类型 + barrel（先写形状的把关用例）**

`packages/contracts/test/contract.test.ts`（现成文件）追加：

```ts
describe("skill 契约", () => {
  it("两个来源固定，多一个少一个都算违约", () => {
    expect([...SKILL_SOURCES]).toEqual(["global", "book"]);
  });

  it("SkillRef 的 id 由 source 与目录名拼出，UI 用它做去重键", () => {
    const ref: SkillRef = {
      id: "book:场景节拍",
      source: "book",
      dirName: "场景节拍",
      displayName: "场景节拍",
      description: "把一场戏拆成触发—对抗—转折三拍",
      stages: ["draft"],
      appliesTo: ["chapter"],
      relPath: "场景节拍/SKILL.md"
    };
    expect(ref.id).toBe(`${ref.source}:${ref.dirName}`);
    expect(ref.relPath).toBe(`${ref.dirName}/SKILL.md`);
  });
});
```

（import 段补 `SKILL_SOURCES, type SkillRef`。）

Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4` → FAIL（`./skill.js` 不存在）。
再建 `packages/contracts/src/skill.ts`（上面那段代码 + 一行中文文件头注释说明「只读浏览用，技能不可由应用写入」），`index.ts` 追加 `export * from "./skill.js";`，复跑至绿。

- [ ] **Step 2：`fs-store/test/skills.test.ts` —— 先红**

夹具照 `fs-store/test/scan.test.ts`：`mkdtemp` 真临时目录 + 真文件，跑完 `rm`。目录名与技能名都用中文，因为「显示名是用户可见中文」正是这条通路的事实。

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSkills } from "../src/skills.js";

let root = "";
async function skill(dirName: string, raw: string): Promise<void> {
  const dir = path.join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), raw, "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-skills-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanSkills", () => {
  it("目录不存在 ⇒ 空表，不抛（新装用户没有全局技能目录是常态）", async () => {
    expect(await scanSkills(path.join(root, "不存在"), "global")).toEqual([]);
  });

  it("frontmatter 齐全 ⇒ 八个字段一次到位，id/relPath 按约定拼", async () => {
    await skill(
      "场景节拍",
      ["---", "name: 场景节拍三拍", "description: 触发—对抗—转折", "stage:", "  - draft", "  - polish", "applies_to:", "  - chapter", "---", "正文从这里开始"].join("\n")
    );
    expect(await scanSkills(root, "book")).toEqual([
      {
        id: "book:场景节拍",
        source: "book",
        dirName: "场景节拍",
        displayName: "场景节拍三拍",
        description: "触发—对抗—转折",
        stages: ["draft", "polish"],
        appliesTo: ["chapter"],
        relPath: "场景节拍/SKILL.md"
      }
    ]);
  });

  it("缺 name/description ⇒ 回落目录名与空串，坏 frontmatter 不吞掉整条技能", async () => {
    await skill("无头技能", "这是一份没有 frontmatter 的正文。");
    const [ref] = await scanSkills(root, "global");
    expect(ref?.displayName).toBe("无头技能");
    expect(ref?.description).toBe("");
    expect(ref?.stages).toEqual([]);
    expect(ref?.appliesTo).toEqual([]);
  });

  it("`stage` 写成单值也收进数组（frontmatter 的 data 值可能是 string）", async () => {
    await skill("单值阶段", ["---", "name: 单值", "stage: draft", "---", "正文"].join("\n"));
    const [ref] = await scanSkills(root, "book");
    expect(ref?.stages).toEqual(["draft"]);
  });

  it("没有 SKILL.md 的子目录、隐藏目录与散文件都跳过", async () => {
    await mkdir(path.join(root, "只有目录"), { recursive: true });
    await mkdir(path.join(root, ".隐藏"), { recursive: true });
    await writeFile(path.join(root, "散在外的.md"), "不该被看见", "utf8");
    await skill("算数", ["---", "name: 算数", "---", "正文"].join("\n"));
    expect((await scanSkills(root, "book")).map((item) => item.dirName)).toEqual(["算数"]);
  });

  it("大小写不符的 `Skill.md` 不算（文件名一字不差才是技能）", async () => {
    const dir = path.join(root, "错名");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "Skill.md"), "---\nname: 错名\n---\n正文", "utf8");
    expect(await scanSkills(root, "book")).toEqual([]);
  });

  it("按显示名稳定排序（localeCompare，与 scanBook 的排序姿态一致）", async () => {
    for (const name of ["章尾钩子", "对白压缩", "场景节拍"]) await skill(name, `---\nname: ${name}\n---\n正文`);
    expect((await scanSkills(root, "book")).map((item) => item.displayName)).toEqual([
      "对白压缩",
      "场景节拍",
      "章尾钩子"
    ]);
  });

  it("SKILL.md 读不了（被占用）⇒ 跳过这一条但不抛", async () => {
    await skill("会炸", "---\nname: 会炸\n---\n正文");
    await skill("好的", "---\nname: 好的\n---\n正文");
    const target = path.join(root, "会炸", "SKILL.md");
    const original = await scanSkills(root, "book");
    expect(original.map((item) => item.displayName)).toEqual(["会炸", "好的"]);
    // 把该文件换成一个目录：readFile 必然抛 EISDIR/EPERM，验证「一条坏不掉全表」
    await rm(path.join(root, "会炸", "SKILL.md"));
    await writeFile(target, "", { flag: "wx" });
    await rm(target);
    await mkdir(target, { recursive: true });
    expect((await scanSkills(root, "book")).map((item) => item.displayName)).toEqual(["好的"]);
  });
});
```

Run: `corepack pnpm vitest run packages/fs-store/test/skills.test.ts --maxWorkers=4` → FAIL（模块不存在）。

- [ ] **Step 3：`fs-store/src/skills.ts`（转绿）**

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SkillRef, SkillSource } from "@mochen/contracts";
import { parseFrontmatter } from "./frontmatter.js";
import { toPosixRelPath } from "./paths.js";

const SKILL_FILE = "SKILL.md";

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter((item) => item !== "");
}

/**
 * 只读扫描一个技能目录（全局 `<appData>/mochen-ai/skills` 或书内 `.mochen/skills`）。
 * 与 scanBook 是两条码路：文稿扫描永远看不见 .mochen（会话/备份/技能都在那里面），
 * 这里按目录名直取 SKILL.md，不改 DOC_DIRS、也不给 scanBook 开洞。
 */
export async function scanSkills(dir: string, source: SkillSource): Promise<SkillRef[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // 目录不存在 = 这个来源没有技能，是常态而不是错误。
    return [];
  }
  const refs: SkillRef[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(dir, entry.name, SKILL_FILE);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      // 单条坏（被占用、是目录、权限）不拖垮全表；可见性由上层（skills-service）负责。
      continue;
    }
    const { data } = parseFrontmatter(raw);
    refs.push({
      id: `${source}:${entry.name}`,
      source,
      dirName: entry.name,
      displayName: typeof data.name === "string" && data.name.trim() !== "" ? data.name.trim() : entry.name,
      description: typeof data.description === "string" ? data.description.trim() : "",
      stages: list(data.stage),
      appliesTo: list(data.applies_to),
      relPath: toPosixRelPath(path.join(entry.name, SKILL_FILE))
    });
  }
  return refs.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
```

`fs-store/src/index.ts` 追加 `export * from "./skills.js";`。
Run: 同 Step 2 命令 → 九条全绿。

- [ ] **Step 4：`check-package-boundary` 与 `tsc`**

```bash
corepack pnpm exec tsc --noEmit -p packages/fs-store/tsconfig.json
corepack pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json
corepack pnpm exec node tools/check-package-boundary.mjs
corepack pnpm exec vitest run packages/fs-store/test/skills.test.ts packages/contracts/test/contract.test.ts --maxWorkers=4
corepack pnpm exec prettier --check "packages/fs-store/**" "packages/contracts/**"
```

Expected: 全退 0；`skills.ts` 里没有任何 `electron` import（fs-store 只吃 node），也没有对 `scan.ts` 的改动（`git diff --name-only` 只列出上面 Files 段的五个文件）。

- [ ] **Step 5：变异（本任务的把关点：显示名回落而不是丢技能）**

用 Edit 把 `skills.ts` 的 `catch { continue; }`（读文件那段）改成 `catch { throw new Error("技能读取失败：" + file); }`。
Run: `corepack pnpm vitest run packages/fs-store/test/skills.test.ts --maxWorkers=4`
Expected: FAIL —— 「SKILL.md 读不了 ⇒ 跳过这一条但不抛」转红（用例外还多出一条未捕获错误）。贴红断言原文，改回逐字复跑至绿。
第二处：把 `displayName` 的回落表达式改成恒取 `entry.name`（抹掉 `data.name` 分支），Expected: 「frontmatter 齐全」那条红在 `displayName: "场景节拍三拍"`。

- [ ] **Step 6：提交**

```bash
git add packages/contracts/src/skill.ts packages/contracts/src/index.ts packages/contracts/test/contract.test.ts packages/fs-store/src/skills.ts packages/fs-store/src/index.ts packages/fs-store/test/skills.test.ts
git commit -m "feat(fs-store): 技能目录只读扫描与 SkillRef 契约（不动文稿扫描）"
```

**留底（如实）**：

- 本任务**不合并去重**：全局与书内同名的先后由 Task 22 的 `createSkillsService().list()` 负责（Plan 3 spec §11「书内优先」）。
- `stages` / `appliesTo` 只是显示与筛选线索，不参与任何权限判定——技能永不授予写入能力（Global Constraints 的「模型永不直接写盘」）。
- 技能正文里若出现 ```mochen-patch 块也不代表任何动作：只有走提案审批的才会写盘，Task 24 会把技能节标成「只读参考」。

### Task 22：主进程/preload —— `skills:list` / `skills:read` 与只读安全（M10）

**Files:**

- Modify: `packages/contracts/src/ipc.ts`（`IPC_CHANNELS` 两键 + `RendererApi` 两方法）
- Modify: `packages/contracts/test/contract.test.ts`（通道计数与形状）
- Modify: `apps/desktop/src/preload/renderer-api.ts`（工厂两方法）
- Modify: `apps/desktop/src/preload/renderer-api.test.ts`（**字面量** 17→19）
- Create: `apps/desktop/src/main/skills-service.ts`
- Create: `apps/desktop/src/main/skills-service.test.ts`
- Modify: `apps/desktop/src/main/agent-ipc.ts`（`registerSkillsIpc`）
- Modify: `apps/desktop/src/main/agent-ipc.test.ts`
- Modify: `apps/desktop/src/main/index.ts`（构造 + 注册）

**Interfaces:**

- Consumes：Task 21 的 `SKILL_SOURCES` / `SkillSource` / `SkillRef` / `SkillContent`（`@mochen/contracts`）与 `scanSkills(dir, source)`（`@mochen/fs-store`）；`assertSafeRelPath`（`fs-store/src/paths.ts:5-14`）的**守卫思路**（不直接调用，它抛的是 `invalid-path: …` 英文前缀，本通路的拒绝句必须是单句中文 —— 裁定 n）。
- Produces（逐字照接口总表波 3）：

```ts
IPC_CHANNELS.skillsList = "skills:list";
IPC_CHANNELS.skillsRead = "skills:read";
RendererApi.listSkills(): Promise<SkillRef[]>;
RendererApi.readSkill(source: SkillSource, relPath: string): Promise<SkillContent>;

// apps/desktop/src/main/skills-service.ts
export interface SkillsService {
  list(): Promise<SkillRef[]>;
  read(source: SkillSource, relPath: string): Promise<SkillContent>;
}
export function createSkillsService(deps: {
  globalDir: string;
  bookRoot: () => string | null;
  readFile?: (path: string) => Promise<Buffer>;
  realpath?: (path: string) => Promise<string>;
}): SkillsService;
```

- 主进程侧的 `readFile` 注入返回 `Buffer`（要按字节卡 64 KB 上限），与 Task 19 的 `appearance-settings`（`ReadTextFile` 返 `string`）**故意不同**，别互相抄。
- `IPC_CHANNELS` 键数与 `RendererApi` 方法数在本波收口为 **19**；`StartTurnInput.skillPaths` 不在本任务（Task 23 与渲染层同批落地，避免「字段先于消费方」的中间提交红 tsc）。

- [ ] **Step 1：契约与计数连带 —— 先红**

`packages/contracts/test/contract.test.ts` 追加（现成文件里已有「IPC 通道白名单」段，照它的写法加，不新起风格）：

```ts
it("技能两条通道在表内，且键数收口为 19", () => {
  expect(IPC_CHANNELS.skillsList).toBe("skills:list");
  expect(IPC_CHANNELS.skillsRead).toBe("skills:read");
  expect(Object.keys(IPC_CHANNELS).length).toBe(19);
});

it("技能来源只有两个，通道名与 RendererApi 方法都不许多出来", () => {
  expect([...SKILL_SOURCES]).toEqual(["global", "book"]);
  expect(Object.keys(IPC_CHANNELS).filter((key) => key.startsWith("skills"))).toEqual([
    "skillsList",
    "skillsRead"
  ]);
});
```

Run: `corepack pnpm vitest run packages/contracts/test/contract.test.ts --maxWorkers=4` → FAIL（`skillsList` 不存在 / 键数 17）。
再改 `packages/contracts/src/ipc.ts`：`IPC_CHANNELS` 末尾加两键（`:11-24` 那段），`RendererApi` 加两方法：

```ts
  /** 技能库只读：列表来自全局 + 书内合并，正文按 64 KB 上限截断。没有写通道。 */
  listSkills(): Promise<SkillRef[]>;
  readSkill(source: SkillSource, relPath: string): Promise<SkillContent>;
```

（import 段加 `type SkillContent, type SkillRef, type SkillSource` from `"./skill.js"`；`ipc.ts` 里同类跨包类型都是就近 `import type`，照 `:1-3` 的写法。）复跑至绿。

- [ ] **Step 2：preload 工厂 + 字面量计数（同一任务，必须连着改）**

`preload/renderer-api.ts` 的工厂末尾（`onAgentEvent` 之前，保持「订阅方法永远最后」的现有排布）加：

```ts
    listSkills: () => invoke(IPC_CHANNELS.skillsList),
    readSkill: (source, relPath) => invoke(IPC_CHANNELS.skillsRead, source, relPath),
```

`preload/renderer-api.test.ts` 三处一起改（**字面量**，该文件刻意不从 `IPC_CHANNELS` 派生期望值，见 `:102-104` 的注释）：

1. 调用序列里补 `await api.listSkills();` 与 `await api.readSkill("book", "场景节拍/SKILL.md");`。
2. `expect(calls.length).toBe(17)` → `toBe(19)`；`calls.map(c => c.channel)` 的期望数组末尾追加 `"skills:list"`、`"skills:read"`（顺序与调用序列一致）。
3. `calls.map(c => c.args)` 的期望数组追加 `[]`、`["book", "场景节拍/SKILL.md"]`。
4. `Object.keys(api).sort()` 的期望数组加 `"listSkills"`、`"readSkill"`（按字母序插进原位），旁边那句「渲染层只拿到这 N 个方法」的注释数字同步改 19。

Run: `corepack pnpm vitest run apps/desktop/src/preload/renderer-api.test.ts --maxWorkers=4` → 绿（工厂改了才不红；这一步就是「契约与消费方同任务」的落点）。

- [ ] **Step 3：`skills-service.test.ts` —— 先红（三条安全反向用例）**

```ts
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SkillRef } from "@mochen/contracts";
import { createSkillsService } from "./skills-service.js";

async function tempBook(withSkill: (root: string) => Promise<void>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mochen-skills-"));
  await withSkill(root);
  return root;
}

const writeGlobal = (dir: string, name: string, raw: string) => async (): Promise<void> => {
  const target = path.join(dir, "skills", name);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "SKILL.md"), raw, "utf8");
};

describe("createSkillsService · list", () => {
  it("全局 + 书内合并，书内同名覆盖全局（id 冲突时书内优先）", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "mochen-global-"));
    const bookDir = await tempBook(async (root) => {
      await writeGlobal(globalDir, "场景节拍", "---\nname: 全局版\n---\nA")();
      const target = path.join(root, ".mochen", "skills", "场景节拍");
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), "---\nname: 书内版\n---\nB", "utf8");
    });
    try {
      const skills = createSkillsService({ globalDir, bookRoot: () => bookDir });
      const refs = await skills.list();
      expect(refs.map((ref) => ref.id)).toEqual(["book:场景节拍"]);
      expect(refs[0]?.displayName).toBe("书内版");
    } finally {
      await rm(globalDir, { recursive: true, force: true });
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("没打开书 ⇒ 只有全局那批，不抛", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "mochen-global-"));
    try {
      await writeGlobal(globalDir, "对白压缩", "---\nname: 对白压缩\n---\n正文")();
      const skills = createSkillsService({ globalDir, bookRoot: () => null });
      expect((await skills.list()).map((ref: SkillRef) => ref.source)).toEqual(["global"]);
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });
});

describe("createSkillsService · read 的三条安全线（M10）", () => {
  it("relPath 必须是 <单层目录名>/SKILL.md，其它形状一律单句中文拒绝", async () => {
    const skills = createSkillsService({ globalDir: "C:/fake", bookRoot: () => null });
    for (const bad of [
      "SKILL.md",
      "a/b/SKILL.md",
      "场景节拍/skill.md",
      "场景节拍/../../secrets.enc",
      "../escape/SKILL.md",
      "C:/Windows/SKILL.md",
      "/etc/SKILL.md",
      "场景节拍/",
      ""
    ]) {
      await expect(skills.read("global", bad)).rejects.toThrow(/^技能路径不对：/u);
    }
  });

  it("解析后仍在该 skills 目录内：越界即拒（真软链走 realpath 验证）", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "mochen-global-"));
    const outside = await mkdtemp(path.join(tmpdir(), "mochen-outside-"));
    try {
      await writeFile(path.join(outside, "SKILL.md"), "外面的东西", "utf8");
      const linkDir = path.join(globalDir, "越界");
      await mkdir(linkDir, { recursive: true });
      // 用注入的 realpath 模拟「软链指向目录外」，不依赖各平台建软链的权限。
      const skills = createSkillsService({
        globalDir,
        bookRoot: () => null,
        realpath: async (p) => (p.includes("越界") ? path.join(outside, "SKILL.md") : p)
      });
      await expect(skills.read("global", "越界/SKILL.md")).rejects.toThrow(
        /^技能不在预期目录内：/u
      );
    } finally {
      await rm(globalDir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("书内来源在未打开书时被拒（不是空列表，是明说的中文）", async () => {
    const skills = createSkillsService({ globalDir: "C:/fake", bookRoot: () => null });
    await expect(skills.read("book", "场景节拍/SKILL.md")).rejects.toThrow(
      /^还没打开作品目录，读不到书内的技能。$/u
    );
  });

  it("文件不存在 ⇒ 单句中文，不回落空正文", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "mochen-global-"));
    try {
      const skills = createSkillsService({ globalDir, bookRoot: () => null });
      await expect(skills.read("global", "没有这个/SKILL.md")).rejects.toThrow(
        /^技能文件读不到：/u
      );
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });

  it("上限 64 KB：超出即 truncated:true，且切点绝不落在码点中间（不出现替换字符）", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "mochen-global-"));
    try {
      const name = "长技能";
      const target = path.join(globalDir, name);
      await mkdir(target, { recursive: true });
      // 「锚」是三字节 UTF-8：把内容撑到刚好让 64 KB 边界落在某个「锚」的中间。
      const filler = "锚".repeat(30_000); // 90_000 字节
      await writeFile(path.join(target, "SKILL.md"), filler, "utf8");
      const skills = createSkillsService({ globalDir, bookRoot: () => null });
      const content = await skills.read("global", `${name}/SKILL.md`);
      expect(content.truncated).toBe(true);
      expect(Buffer.byteLength(content.content, "utf8")).toBeLessThanOrEqual(64 * 1024);
      expect(content.content).not.toContain("\uFFFD");
      expect(content.content.length).toBeGreaterThan(0);
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });

  it("未超限 ⇒ truncated:false 且正文原样（frontmatter 也带着，只读渲染要看到原文）", async () => {
    const globalDir = await mkdtemp(path.join(tmpdir(), "mochen-global-"));
    try {
      await writeGlobal(globalDir, "短技能", "---\nname: 短技能\n---\n正文一句")();
      const skills = createSkillsService({ globalDir, bookRoot: () => null });
      const content = await skills.read("global", "短技能/SKILL.md");
      expect(content.truncated).toBe(false);
      expect(content.content).toContain("正文一句");
      expect(content.relPath).toBe("短技能/SKILL.md");
    } finally {
      await rm(globalDir, { recursive: true, force: true });
    }
  });
});
```

Run: `corepack pnpm vitest run apps/desktop/src/main/skills-service.test.ts --maxWorkers=4` → FAIL（模块不存在）。

- [ ] **Step 4：`main/skills-service.ts`（转绿）**

```ts
import { readFile as fsReadFile, realpath as fsRealpath } from "node:fs/promises";
import path from "node:path";
import { scanSkills, toPosixRelPath } from "@mochen/fs-store";
import {
  SKILL_SOURCES,
  type SkillContent,
  type SkillRef,
  type SkillSource
} from "@mochen/contracts";

/** 单文件读上限：64 KB（Plan 3 spec §11），超出只给前若干完整码点并标 truncated。 */
export const SKILL_READ_LIMIT = 64 * 1024;

const SKILL_FILE = "SKILL.md";

export interface SkillsService {
  list(): Promise<SkillRef[]>;
  read(source: SkillSource, relPath: string): Promise<SkillContent>;
}

function isSkillSource(value: unknown): value is SkillSource {
  return typeof value === "string" && (SKILL_SOURCES as readonly string[]).includes(value);
}

/** `场景节拍/SKILL.md` 这种形状才收：单层目录名 + 一字不差的 SKILL.md。 */
function assertSkillRelPath(relPath: string): string {
  const posix = toPosixRelPath(relPath ?? "");
  const segments = posix.split("/");
  if (
    segments.length !== 2 ||
    segments[0] === undefined ||
    segments[0] === "" ||
    segments[0] === "." ||
    segments[0] === ".." ||
    segments[1] !== SKILL_FILE
  ) {
    throw new Error(
      `技能路径不对：${relPath === "" ? "（空路径）" : relPath}。技能正文必须写成〈目录名/SKILL.md〉。`
    );
  }
  return posix;
}

/** 按字节卡上限，再退到一个码点起始字节（UTF-8 续字节形如 0b10xxxxxx），绝不产出半个字符。 */
function clip(buffer: Buffer): { text: string; truncated: boolean } {
  if (buffer.byteLength <= SKILL_READ_LIMIT)
    return { text: buffer.toString("utf8"), truncated: false };
  let end = SKILL_READ_LIMIT;
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: buffer.subarray(0, end).toString("utf8"), truncated: true };
}

/**
 * 技能库只读服务：两个来源（全局应用数据目录 + 书内 .mochen/skills），没有写与删。
 * dir 由装配处注入，所以 F-4 迁移（Task 25）把全局目录一起搬走，这里不需要知道目录名。
 */
export function createSkillsService(deps: {
  globalDir: string;
  bookRoot: () => string | null;
  readFile?: (path: string) => Promise<Buffer>;
  realpath?: (path: string) => Promise<string>;
}): SkillsService {
  const readBuffer = deps.readFile ?? ((p) => fsReadFile(p));
  const resolve = deps.realpath ?? ((p) => fsRealpath(p));

  function rootOf(source: SkillSource): string {
    if (source === "global") return deps.globalDir;
    const book = deps.bookRoot();
    if (book === null) throw new Error("还没打开作品目录，读不到书内的技能。");
    return path.join(book, ".mochen", "skills");
  }

  async function list(): Promise<SkillRef[]> {
    const globalRefs = await scanSkills(deps.globalDir, "global");
    const book = deps.bookRoot();
    const bookRefs = book === null ? [] : await scanSkills(path.join(book, ".mochen", "skills"), "book");
    // 同名以 dirName 撞车：书内优先（作者为这本书写的版本，盖过机器上的通用版本）。
    const merged = new Map<string, SkillRef>();
    for (const ref of [...globalRefs, ...bookRefs]) {
      const previous = merged.get(ref.dirName);
      if (previous && previous.source === "book" && ref.source === "global") continue;
      merged.set(ref.dirName, ref);
    }
    return [...merged.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  return {
    list,
    async read(rawSource, rawRelPath) {
      // source 跨 IPC 而来，运行期兜底（铁律 6）：未知来源不接受。
      if (!isSkillSource(rawSource)) throw new Error(`技能来源不对：${String(rawSource)}`);
      const relPath = assertSkillRelPath(rawRelPath);
      const root = rootOf(rawSource);
      const abs = path.resolve(root, relPath);
      let real: string;
      try {
        real = await resolve(abs);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") throw new Error(`技能文件读不到：${relPath}（该技能目录下没有 ${SKILL_FILE}）。`);
        throw new Error(`技能文件读不到：${relPath}（${error instanceof Error ? error.message : String(error)}）。`);
      }
      const inside =
        path.resolve(real) === root || path.resolve(real).startsWith(root + path.sep);
      if (!inside)
        throw new Error(`技能不在预期目录内：${relPath}。软链或改名把正文指向了技能目录之外。`);
      const { text, truncated } = clip(await readBuffer(real));
      return { relPath, content: text, truncated };
    }
  };
}
```

落地时删掉第一行 `mkdirSync` 的 import（本模块**只读**，不建任何目录；写在这里是给评审看的反面提示，实现者应当把它删干净 —— 若 eslint 报未使用即正确信号）。
Run: 同 Step 3 命令 → 十条全绿。

- [ ] **Step 5：`registerSkillsIpc` + 装配（含 agent-ipc 用例）**

`agent-ipc.test.ts` 追加：

```ts
describe("registerSkillsIpc", () => {
  it("注册两条 skills 通道；read 把 source 与 relPath 原样转交", async () => {
    const seen: unknown[] = [];
    const reg = registry();
    registerSkillsIpc(reg.handle, {
      async list() {
        seen.push("list");
        return [];
      },
      async read(source, relPath) {
        seen.push([source, relPath]);
        return { relPath, content: "正文", truncated: false };
      }
    });
    expect(reg.order).toEqual([IPC_CHANNELS.skillsList, IPC_CHANNELS.skillsRead]);
    expect(await fire(reg.fns, IPC_CHANNELS.skillsList)).toEqual([]);
    expect(await fire(reg.fns, IPC_CHANNELS.skillsRead, "book", "场景节拍/SKILL.md")).toEqual({
      relPath: "场景节拍/SKILL.md",
      content: "正文",
      truncated: false
    });
    expect(seen).toEqual(["list", ["book", "场景节拍/SKILL.md"]]);
  });
});
```

`agent-ipc.ts` 加：

```ts
/** 技能库只读：没有任何写通路进这条注册表，列表与正文都来自 skills-service。 */
export function registerSkillsIpc(handle: Handler, skills: SkillsService): void {
  handle(IPC_CHANNELS.skillsList, () => skills.list());
  handle(IPC_CHANNELS.skillsRead, (_event, source, relPath) =>
    skills.read(source as SkillSource, relPath as string)
  );
}
```

`main/index.ts`：`agent` 构造之后（`registerProviderIpc` / `registerAppearanceIpc` 之后）加：

```ts
  // 技能库只读浏览：全局目录跟着 appData 走（Task 25 迁移时一起搬），书内固定在 .mochen/skills。
  const skills = createSkillsService({
    globalDir: path.join(secretDir, "skills"),
    bookRoot: () => service.current()?.rootPath ?? null
  });
  registerSkillsIpc((channel, fn) => ipcMain.handle(channel, fn), skills);
```

（`service.current()` 是 `book-service` 的现成快照访问器，返回 `null` 表示未打开书；落地前先 `grep -n "current()" apps/desktop/src/main/book-service.ts` 确认形状，别凭记忆写。`path` 已在 `index.ts:2` 导入。）

Run: `corepack pnpm vitest run apps/desktop/src/main/skills-service.test.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/preload/renderer-api.test.ts packages/contracts/test/contract.test.ts --maxWorkers=4` → 全绿。

- [ ] **Step 6：变异 M10 —— 去掉文件名与目录内检查必须转红**

用 Edit 把 `assertSkillRelPath` 的整块校验换成 `return toPosixRelPath(relPath)`（等价于「只信渲染层给的路径」）。
Run: `corepack pnpm vitest run apps/desktop/src/main/skills-service.test.ts --maxWorkers=4`
Expected: FAIL —— 「relPath 必须是 <单层目录名>/SKILL.md…」转红（`"a/b/SKILL.md"`、`"../escape/SKILL.md"`、`"C:/Windows/SKILL.md"` 都不再被拒）。
改回后第二处：删掉 `inside` 判定（`if (!inside) throw …` 整段注释掉）。
Expected: FAIL —— 「解析后仍在该 skills 目录内」那条转红。两段红都贴进波 3 台账，评审者重跑。

- [ ] **Step 7：定点门禁 + 提交**

```bash
corepack pnpm exec prettier --check "packages/contracts/**" "apps/desktop/src/**"
corepack pnpm exec eslint apps/desktop/src/main/skills-service.ts apps/desktop/src/main/skills-service.test.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/renderer-api.ts apps/desktop/src/preload/renderer-api.test.ts packages/contracts/src/ipc.ts --max-warnings=0
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json
corepack pnpm exec node tools/check-package-boundary.mjs
corepack pnpm exec node tools/check-source-line-budget.mjs
```

Expected: 全退 0。`skills-service.ts` ≤200 行；`grep -n "electron" apps/desktop/src/main/skills-service.ts` 无输出（主进程模块也不 import electron，装配处才 import）。

```bash
git add packages/contracts/src/ipc.ts packages/contracts/test/contract.test.ts apps/desktop/src/preload/renderer-api.ts apps/desktop/src/preload/renderer-api.test.ts apps/desktop/src/main/skills-service.ts apps/desktop/src/main/skills-service.test.ts apps/desktop/src/main/agent-ipc.ts apps/desktop/src/main/agent-ipc.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(skills): skills:list/read 只读通道与路径安全，IPC 收口 19 条"
```

**留底（如实）**：

- `readSkill` 的 `source` 做了运行期兜底，但 `relPath` 的「单层目录名」校验里**没有**再查该目录是否真在 `list()` 结果内 —— 因为「技能目录下有 SKILL.md」本身就是存在性证明，读的是同一路径。若要更严（只允许列表里出现过的 id），Task 24 的挂载点会再加一道，但那要先解决「列表缓存过期」的一致性问题，本片不做。
- 64 KB 上限按**字节**卡、按**码点**退，与 `timeline.ts` 的码点切片教训同源；`clip` 的 `while` 循环最坏退 3 字节。
- 全局目录的绝对路径由装配处拼（`path.join(secretDir, "skills")`），`skills-service` 只见 `globalDir` —— 与 Task 19 的 `dir` 注入同一手法，F-4 迁移不需要改本模块一行。

### Task 23：渲染层 —— 技能浏览入口、只读标签与「加入当前上下文」（含 `StartTurnInput.skillPaths` 连带）

**Files:**

- Modify: `packages/contracts/src/agent-event.ts`（`startTurnInputSchema` 加 `skillPaths`）
- Modify: `packages/contracts/test/agent.test.ts`
- Modify: `apps/desktop/src/main/agent-service.ts`（`PromptContext` 组装处把 `skillPaths` 传下去；Task 16 的 `promptFor` 已异步）
- Modify: `apps/desktop/src/main/agent-service.test.ts`、`apps/desktop/src/main/turn-e2e.test.ts`（夹具补字段，**同任务**）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（`skillPathsByThread` + `attachSkill` / `detachSkill`；`send()` 载荷；Task 18 留的 `refreshContext` 挂载点改读真值）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.ts`（`skillBrowser` 单格槽 + `openSkillBrowser` / `closeSkillBrowser`）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`（夹具两方法 + 四条「浏览不打断」前置断言里的前两条）
- Create: `apps/desktop/src/renderer/src/stores/useSkillsStore.ts`
- Create: `apps/desktop/src/renderer/src/stores/useSkillsStore.test.ts`
- Create: `apps/desktop/src/renderer/src/components/SkillBrowser.vue`
- Modify: `apps/desktop/src/renderer/src/components/DocumentPane.vue`（现 197 行；浏览格加技能优先级）
- Modify: `apps/desktop/src/renderer/src/components/LeftSidebar.vue`（现 131 行；加「技能库」段）
- Modify: `apps/desktop/src/renderer/src/utils/slash-commands.ts` / `.test.ts`（第 7 条命令 `skills`）
- Modify: `apps/desktop/src/renderer/src/components/SlashPalette.vue`（`/skills` 的动作）
- Modify: `apps/desktop/src/renderer/src/styles/interaction.css`

**Interfaces:**

- Consumes：Task 21 的 `SkillRef` / `SkillContent` / `SkillSource`；Task 22 的 `window.mochen.listSkills()` / `readSkill(source, relPath)`；Task 18 的 `refreshContext(threadKey)`（其 `skillPaths` 那一行注释点名「Task 23 改读 `this.skillPathsByThread[threadKey] ?? []`」，本任务就改那一行）；`useBookStore` 现有的 `browseTabs` / `activeBrowse` / `rightPaneMode`（技能**不**进这三样，见设计决定 4）。
- Produces：
  - `StartTurnInput.skillPaths: string[]`（必填，无挂入传 `[]`）。
  - `useAgentStore`：`skillPathsByThread: Record<string, string[]>`、`attachSkill(threadKey, id): void`、`detachSkill(threadKey, id): void`、`skillIdsFor(threadKey): string[]`。
  - `useSkillsStore`：`refs: SkillRef[]`、`contents: Record<string, SkillContent>`、`loading: boolean`、`notice: string`；actions `load(): Promise<void>`、`open(id: string): Promise<void>`。
  - `useBookStore`：`skillBrowser: { id: string; displayName: string } | null`、`openSkillBrowser(skill: SkillRef): void`、`closeSkillBrowser(): void`。
  - `SLASH_COMMANDS` 收口为 7 条：`["model","permissions","status","stage","skills","resume","clear"]`。

**技能 id 就是挂入凭证**：`skillPathsByThread` 存的是 `SkillRef.id`（`source:目录名`），`send()` 把它原样放进 `StartTurnInput.skillPaths`，主进程（Task 24 的上下文装配）再按 id 反查目录读正文。跨 IPC 的这条串**不**是文件系统路径，所以没有越界风险；越界防线在 Task 22 的 `readSkill`，装配处只按白名单形状解析 id（`global:` / `book:` 前缀 + 单层目录名）。

- [ ] **Step 1：契约字段 —— 先红**

`packages/contracts/test/agent.test.ts` 追加（该文件的 `startTurnInputSchema` 段已在 Plan 2 建好，照它的中文标题风格）：

```ts
describe("startTurnInputSchema · 挂入技能", () => {
  it("缺 skillPaths 时拒绝：必填，无挂入也要显式传空数组", () => {
    const rest: Record<string, unknown> = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      userText: "改紧一点",
      profileId: "writer"
    };
    delete rest.skillPaths;
    expect(startTurnInputSchema.safeParse(rest).success).toBe(false);
    expect(startTurnInputSchema.safeParse({ ...rest, skillPaths: [] }).success).toBe(true);
  });

  it("超过 12 条或单条超 300 字时拒绝，原因是一句中文", () => {
    const base = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      userText: "改紧一点",
      profileId: "writer"
    };
    const tooMany = { ...base, skillPaths: Array.from({ length: 13 }, (_, i) => `book:技能${i}`) };
    expect(startTurnInputSchema.safeParse(tooMany).success).toBe(false);
    const emptyItem = { ...base, skillPaths: [""] };
    expect(startTurnInputSchema.safeParse(emptyItem).success).toBe(false);
    expect(startTurnInputSchema.safeParse(emptyItem).error?.issues[0]?.message).toMatch(/^挂入的技能/u);
  });
});
```

（`profileId` 那行来自 Task 11；本任务的夹具照现仓该文件里已有的 `startTurnInputSchema` 用例做增量，别新起一份基础载荷。）
Run: `corepack pnpm vitest run packages/contracts/test/agent.test.ts --maxWorkers=4` → FAIL。

`packages/contracts/src/agent-event.ts` 的 `startTurnInputSchema`（`:110-125`）对象里，`userText` 之后加：

```ts
    /** 挂入上下文的技能 id（`source:目录名`），最多 12 条；无挂入显式传 []。 */
    skillPaths: z.array(z.string().min(1, "挂入的技能标识不能为空").max(300, "挂入的技能标识过长（最多 300 字）")).max(12, "一次最多挂入 12 个技能").default([])
```

`.default([])` 让主进程对「老渲染层载荷」宽容，但**类型仍是必填**（`z.infer` 出来是 `string[]`）—— 这与 Task 11 的 `profileId: z.string().max(200, …).default("")` 同一手法。复跑至绿。

- [ ] **Step 2：主进程消费方连带（夹具同任务）**

`PromptContext`（`agent-service.ts:65-73`）已有 `skillPaths`（Task 16 加的字段，装配处现在才真有值）。本步只做两件事：

1. `grep -n "skillPaths" apps/desktop/src/main/agent-service.ts` —— 若 Task 16 留的是 `skillPaths: []` 硬占位，把 `startTurn` 里构造 `PromptContext` 那一处改成 `skillPaths: input.skillPaths`（其余不动）。
2. 夹具补字段：`agent-service.test.ts`（`:264-282` 一带的 `startTurn` 载荷）与 `turn-e2e.test.ts`（`:88-106`）里每个 `StartTurnInput` 字面量加 `skillPaths: []`；有 `satisfies RendererApi` / 直接对象字面量的地方由 tsc 报出缺键，照报错逐个补，**不许**用 `as StartTurnInput` 绕。

```bash
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json
corepack pnpm vitest run apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4
```

Expected: 退 0 + 全绿。这是铁律 5（中间提交也要能过 tsc）在本任务的具体形状。

- [ ] **Step 3：`useBookStore` 的技能格 —— 先红（含「浏览不打断」前两条）**

`useBookStore.test.ts` 的 `api` 夹具（`:40-56`）先补两个方法（否则 `satisfies RendererApi` 直接红在类型上）：

```ts
  listSkills: offLimits("listSkills"),
  readSkill: offLimits("readSkill"),
```

（技能取数归 `useSkillsStore`，`useBookStore` 只拿一个 `SkillRef` 放进格槽 —— 所以在这份夹具里它们仍是 offLimits，这个「不该调用」本身就是架构断言。）

追加用例（`describe("useBookStore · 技能浏览（Task 23）", ...)`）：

```ts
it("openSkillBrowser 只设格槽：docTabs / activeDocTab / 草稿四字段一字不变", async () => {
  const store = useBookStore();
  await store.openBook("/book");
  await store.openDocTab("chapters/01-a.md");
  store.onEdit("我还没保存的手改");
  const before = { tabs: [...store.docTabs], active: store.activeDocTab, draft: store.draft, dirty: store.dirty };

  store.openSkillBrowser({
    id: "book:场景节拍",
    source: "book",
    dirName: "场景节拍",
    displayName: "场景节拍三拍",
    description: "",
    stages: [],
    appliesTo: [],
    relPath: "场景节拍/SKILL.md"
  });

  expect(store.skillBrowser?.id).toBe("book:场景节拍");
  expect(store.rightPaneMode).toBe("browse");
  expect(store.docTabs).toEqual(before.tabs);
  expect(store.activeDocTab).toBe(before.active);
  expect(store.draft).toBe(before.draft);
  expect(store.dirty).toBe(before.dirty);
  // 浏览标签是 DocRef 那条码路，技能不许混进去
  expect(store.browseTabs.length).toBe(0);
  expect(store.activeBrowse).toBeNull();
});

it("closeSkillBrowser 清空格槽并回到文稿侧；再关一次不产生第二次状态变化", async () => {
  const store = useBookStore();
  await store.openBook("/book");
  await store.openDocTab("chapters/01-a.md");
  const snapshot = JSON.stringify(store.draftsByPath);
  store.openSkillBrowser({ id: "global:对白压缩", source: "global", dirName: "对白压缩", displayName: "对白压缩", description: "", stages: [], appliesTo: [], relPath: "对白压缩/SKILL.md" });
  store.closeSkillBrowser();
  expect(store.skillBrowser).toBeNull();
  expect(store.rightPaneMode).toBe("manuscript");
  expect(JSON.stringify(store.draftsByPath)).toBe(snapshot);
  store.closeSkillBrowser();
  expect(store.skillBrowser).toBeNull();
});

it("换开另一个技能是覆盖单格，不是堆叠；也不动文稿侧", async () => {
  const store = useBookStore();
  await store.openBook("/book");
  store.openSkillBrowser(skillA);
  store.openSkillBrowser(skillB);
  expect(store.skillBrowser?.id).toBe(skillB.id);
});
```

（`skillA` / `skillB` 用 `const` 在文件顶部建，两条完整 `SkillRef` 字面量，形状照上面第一条用例里的写法。）
Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useBookStore.test.ts --maxWorkers=4` → FAIL（`skillBrowser` / `openSkillBrowser` 不存在）。

- [ ] **Step 4：`useBookStore` 转绿**

state 里 `rightPaneMode` 那两行之后加：

```ts
    /** 技能正文只占一格：同一时刻最多看一个技能，关了就回文稿侧（设计决定 4）。 */
    skillBrowser: null as { id: string; displayName: string } | null,
```

actions 里 `closeBrowse` 之后加：

```ts
    openSkillBrowser(skill: SkillRef): void {
      this.skillBrowser = { id: skill.id, displayName: skill.displayName };
      this.rightPaneMode = "browse";
    },

    closeSkillBrowser(): void {
      this.skillBrowser = null;
      // 只有当前确实在看技能才回文稿侧；用户已手动切走时不该把他拽回来。
      if (this.activeBrowse === null) this.rightPaneMode = "manuscript";
    },
```

（import 段加 `type SkillRef`。`openSkillBrowser` 存的是 `{id, displayName}` 而不是整个 `SkillRef`：右栏要显示的名字在这里就够了，正文与 `truncated` 归 `useSkillsStore.contents`，两份真相会让「关标签再开」出现不同步。）

- [ ] **Step 5：`useSkillsStore` —— 先红后绿**

`useSkillsStore.test.ts`（新文件，夹具照 `useBookStore.test.ts`：`vi.stubGlobal("window", { mochen: api })` + `satisfies RendererApi`，本文件里 `readDoc` / `writeDoc` 等指向 `offLimits`）：

```ts
describe("useSkillsStore", () => {
  it("load 填 refs 并清 loading；refs 按显示名原样交给 UI（排序是主进程的事）", async () => {
    const store = useSkillsStore();
    await store.load();
    expect(store.loading).toBe(false);
    expect(store.refs.map((ref) => ref.id)).toEqual(["book:场景节拍", "global:对白压缩"]);
  });

  it("load 失败：单句中文进 notice，refs 保持旧值（不清空用户正在看的东西）", async () => {
    listSkills.mockRejectedValueOnce(new Error("skills:list 没注册"));
    const store = useSkillsStore();
    await store.load();
    await store.load();
    expect(store.notice).toBe("技能列表没能取到：skills:list 没注册");
    expect(store.refs.length).toBe(2);
  });

  it("open(id) 取正文并缓存；同一 id 再 open 不发第二次 IPC", async () => {
    const store = useSkillsStore();
    await store.load();
    await store.open("global:对白压缩");
    await store.open("global:对白压缩");
    expect(readSkill.mock.calls.length).toBe(1);
    expect(store.contents["global:对白压缩"]?.content).toContain("压缩三步");
  });

  it("open 未知 id ⇒ 一句中文且不发 IPC", async () => {
    const store = useSkillsStore();
    await store.load();
    await store.open("ghost:没有这个");
    expect(store.notice).toBe("列表里没有这个技能，未做改动");
    expect(readSkill.mock.calls.length).toBe(0);
  });

  it("读正文失败 ⇒ 中文原因进 notice，缓存不留半个空壳", async () => {
    readSkill.mockRejectedValueOnce(new Error("技能文件读不到：场景节拍/SKILL.md"));
    const store = useSkillsStore();
    await store.load();
    await store.open("book:场景节拍");
    expect(store.notice).toBe("技能正文没能读到：技能文件读不到：场景节拍/SKILL.md");
    expect(store.contents["book:场景节拍"]).toBeUndefined();
  });
});
```

实现（`stores/useSkillsStore.ts`）：

```ts
import { defineStore } from "pinia";
import type { SkillContent, SkillRef } from "@mochen/contracts";

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 技能库只读：这里没有写、删、导入的任何痕迹（Plan 3 spec §11 / §17）。 */
export const useSkillsStore = defineStore("skills", {
  state: () => ({
    refs: [] as SkillRef[],
    contents: {} as Record<string, SkillContent>,
    loading: false,
    loaded: false,
    notice: ""
  }),

  actions: {
    async load() {
      this.loading = true;
      try {
        this.refs = await window.mochen.listSkills();
        this.loaded = true;
        this.notice = "";
      } catch (err) {
        // 失败保留旧表：正在读的那个技能不许因为刷新而消失。
        this.notice = `技能列表没能取到：${reasonOf(err)}`;
      }
      this.loading = false;
    },

    async open(id: string) {
      const ref = this.refs.find((item) => item.id === id);
      if (!ref) {
        this.notice = "列表里没有这个技能，未做改动";
        return;
      }
      if (this.contents[id] !== undefined) return;
      try {
        this.contents[id] = await window.mochen.readSkill(ref.source, ref.relPath);
      } catch (err) {
        this.notice = `技能正文没能读到：${reasonOf(err)}`;
      }
    },

    /** 左栏每次展开都刷一次列表；正文缓存不动（盘上技能改动是低频事件）。 */
    async refresh() {
      await this.load();
    }
  }
});
```

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useSkillsStore.test.ts --maxWorkers=4` → 绿。

- [ ] **Step 6：`useAgentStore` 挂入态 + `send()` 载荷 —— 先红后绿**

`useAgentStore.test.ts` 追加（复用文件现成的 `started: StartTurnInput[]` 收集器与 `openChapter()` 辅助）：

```ts
describe("useAgentStore · 挂入技能（Task 23）", () => {
  it("attachSkill 去重；重复挂同一个 id 只有一条", async () => {
    await openChapter();
    store().attachSkill(CH, "book:场景节拍");
    store().attachSkill(CH, "book:场景节拍");
    expect(store().skillPathsByThread[CH]).toEqual(["book:场景节拍"]);
  });

  it("send 把挂入的技能 id 带进 StartTurnInput，没挂入时是空数组", async () => {
    await openChapter();
    store().send("先这样");
    expect(started[0]?.skillPaths).toEqual([]);
    store().attachSkill(CH, "global:对白压缩");
    store().send("再这样");
    expect(started[1]?.skillPaths).toEqual(["global:对白压缩"]);
  });

  it("第 13 个技能挂不上：一句中文，列表不变", async () => {
    await openChapter();
    for (let i = 0; i < 12; i += 1) store().attachSkill(CH, `book:技能${i}`);
    store().attachSkill(CH, "book:技能12");
    expect(store().skillPathsByThread[CH].length).toBe(12);
    expect(store().notice).toBe("一次最多挂入 12 个技能，先取消一个再挂");
  });

  it("detachSkill 摘掉一个；摘空后是空数组而不是 undefined（发送侧不用判空）", async () => {
    await openChapter();
    store().attachSkill(CH, "book:场景节拍");
    store().detachSkill(CH, "book:场景节拍");
    expect(store().skillPathsByThread[CH]).toEqual([]);
  });

  it("挂入技能会刷新该线程的上下文预览（占用条当场动，不用等发一轮）", async () => {
    await openChapter();
    await store().loadProfiles();
    contextPreview.mockClear();
    store().attachSkill(CH, "book:场景节拍");
    expect(contextPreview).toHaveBeenCalledTimes(1);
    expect(contextPreview.mock.calls[0]?.[0].skillPaths).toEqual(["book:场景节拍"]);
  });

  it("A 线程挂的技能不出现在 B 线程的载荷里（线程隔离）", async () => {
    await openChapter();
    store().attachSkill(CH, "book:场景节拍");
    const other = "chapters/02-闸门.md";
    store().send("别的线程不该看到");
    expect(started[0]?.threadKey).toBe(CH);
    expect(store().skillPathsByThread[other]).toBeUndefined();
  });
});
```

实现要点（`stores/useAgentStore.ts`）：

1. state 加 `skillPathsByThread: {} as Record<string, string[]>`，旁边一行注释：内存态，重启清空（UI 上要说清，见 Step 8）。
2. 模块顶层 `const SKILL_ATTACH_MAX = 12;`（与 Step 1 的 `.max(12)` 同值，注释点名两处必须一起改）。
3. actions：

```ts
    skillIdsFor(threadKey: string): string[] {
      return this.skillPathsByThread[threadKey] ?? [];
    },

    attachSkill(threadKey: string, id: string): void {
      const current = this.skillIdsFor(threadKey);
      if (current.includes(id)) return;
      if (current.length >= SKILL_ATTACH_MAX) {
        this.notice = "一次最多挂入 12 个技能，先取消一个再挂";
        return;
      }
      this.skillPathsByThread[threadKey] = [...current, id];
      void this.refreshContext(threadKey);
    },

    detachSkill(threadKey: string, id: string): void {
      this.skillPathsByThread[threadKey] = this.skillIdsFor(threadKey).filter((item) => item !== id);
      void this.refreshContext(threadKey);
    },
```

4. `send()`（`:310-325`）的 `input` 里补一行 `skillPaths: this.skillIdsFor(input 前的 threadKey)` —— 落地形状：

```ts
      const threadKey = threadKeyFor(book.activeDocTab);
      const input: StartTurnInput = {
        threadKey,
        docRelPath: book.activeDocTab,
        stageId: book.meta?.activeStage ?? "draft",
        profileId: this.profileIdFor(threadKey),
        userText: text,
        skillPaths: this.skillIdsFor(threadKey)
      };
```

5. **Task 18 留的那一行**：`refreshContext` 里 `skillPaths: []` 改成 `skillPaths: this.skillIdsFor(threadKey)`，并把那行注释删掉（注释是预留标记，留着就是债务）。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4` → 全绿（含 Plan 2 既有用例不回归）。

- [ ] **Step 7：`utils/slash-commands.ts` 收口 7 条 + `/skills` 动作**

```ts
export const SLASH_COMMANDS = ["model", "permissions", "status", "stage", "skills", "resume", "clear"] as const;
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string> = {
  model: "打开模型设置：baseURL、模型名与密钥",
  permissions: "打开权限档选择器（当前档显示在中栏头部）",
  status: "把这条线程的现状写进状态条",
  stage: "切换创作阶段（要连同智能体档案一起切，波 2 接通）",
  skills: "打开技能库浏览（只读；挂入上下文要另外点按钮）",
  resume: "重新读取这条线程的历史",
  clear: "只清空本页显示，不动盘上的会话历史"
};
```

`availableCommands`：`skills` 与 `stage` / `resume` 同属「换上下文或重建视图」那一类，turn 运行中禁用（Plan 3 spec §6 的运行期约束）。**判定式不用改**：波 1 的白名单常量 `DURING_TURN_COMMANDS`（`["model", "permissions", "status", "clear"]`，Task 18 明写「保持不动」）里本来就没有 `skills`，第三行 `if (focus.turnRunning) return DURING_TURN_COMMANDS.includes(command);` 天然把它滤掉。要改的只有两处：`SLASH_COMMANDS`/`SLASH_COMMAND_DESCRIPTIONS` 加第 7 项，以及测试补一条「`turnRunning: true` 时不列 `skills`」的反向用例。注意波 1 那个 `GATED_COMMANDS` 已被 Task 18 删除，别照旧名加回。

`/skills` 的动作不能落在 `SlashPalette.vue` 里做取数——面板只发意图，取数与右栏切换收进 `useSkillsStore` 的一个新 action（`useBookStore` 只借「右栏模式」这一格，具体看哪个技能留给用户点）：

```ts
    /** `/skills`：取列表 + 右栏切浏览。不预选任何技能，格槽由用户点出来的。 */
    async openLibrary() {
      await this.load();
      const book = useBookStore();
      book.rightPaneMode = "browse";
      if (this.refs.length === 0)
        this.notice = "没有可浏览的技能：全局与书内技能目录都是空的";
    }
```

（`SlashPalette.vue` 里 `skills` 分支就一行 `void useSkillsStore().openLibrary();` 后 `close()`。`SlashPalette` 的 `describe("runSlashCommand")` 用例（Task 8 建）加一条：「`/skills` 调 `openLibrary` 并关闭面板，不自己发轮」。）

- [ ] **Step 8：左栏入口 + 右栏渲染（`.vue` 只接线）**

`LeftSidebar.vue`：`SECTION_ORDER` 之后加一个不进 `KIND_META` 的独立段（技能不是 `BookKind`）：

```ts
const skills = useSkillsStore();
const skillBooks = computed(() => skills.refs);

async function openSkill(id: string): Promise<void> {
  const ref = skills.refs.find((item) => item.id === id);
  if (!ref) return;
  await skills.open(id);
  book.openSkillBrowser(ref);
}

function toggleSkills(): void {
  skillsOpen.value = !skillsOpen.value;
  if (skillsOpen.value) void skills.load();
}
```

模板里在 `v-for="section in sections"` 之后加一段 `<section class="resource-section resource-section-skills">`，标题「技能库」+ 图标 `library`，展开时 `v-for` 渲染 `skillBooks`：每行一个按钮（`displayName` + 小字 `source === "book" ? "本书" : "全局"`），已挂入的行加 `is-attached` 类与「已挂入」角标（判定来自 `agent.skillIdsFor(threadKey).includes(ref.id)`，`threadKey` 用 `CenterColumn.vue:36` 同一条 `threadKeyFor(book.activeDocTab)`，在左栏以 computed 复算一份，不跨组件传 DOM）。

`DocumentPane.vue`：`activeTabId` / `tabs` 两个 computed 之前加

```ts
const skillSlot = computed(() => book.skillBrowser);
const showingSkill = computed(() => mode.value === "browse" && skillSlot.value !== null);
```

`<div class="editor-document">` 内的浏览分支前加 `<SkillBrowser v-if="showingSkill" />`，`v-else-if` 保留现有浏览渲染；`title` / `breadcrumbs` 各加一个 `showingSkill` 分支（面包屑第三段用 `"技能"`，标题用 `skillSlot.displayName`）。`closeActiveTab()` 开头加：

```ts
  if (showingSkill.value) {
    book.closeSkillBrowser();
    return;
  }
```

`SkillBrowser.vue`（新文件，≤120 行）三块：正文 `<pre>`（只读，`truncated` 时上方一条 `readonly-badge` 样式的提示「正文超出 64 KB，只显示前面部分」）、卡脚「加入当前上下文 / 已加入（点击取消）」按钮、一行说明「挂入只对新一轮生效，重启后清空」。按钮判定全在 store：

```ts
const attached = computed(() => agent.skillIdsFor(agentThreadKey.value).includes(props.skill.id));
function toggleAttach(): void {
  if (attached.value) agent.detachSkill(agentThreadKey.value, props.skill.id);
  else agent.attachSkill(agentThreadKey.value, props.skill.id);
}
```

`styles/interaction.css` 追加 `.resource-section-skills`、`.skill-row`、`.skill-row.is-attached`、`.skill-body`、`.skill-footnote`；毛玻璃与 token 照现有 `.tree-node` / `.readonly-badge`，不新造色值。

- [ ] **Step 9：定点门禁 + 提交**

```bash
corepack pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json
corepack pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json
corepack pnpm exec eslint packages/contracts/src/agent-event.ts apps/desktop/src/renderer/src/stores apps/desktop/src/renderer/src/components/SkillBrowser.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/components/LeftSidebar.vue --max-warnings=0
corepack pnpm exec vitest run packages/contracts/test/agent.test.ts apps/desktop/src/renderer/src/stores/useBookStore.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts apps/desktop/src/renderer/src/stores/useSkillsStore.test.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4
corepack pnpm exec node tools/check-source-line-budget.mjs
```

Expected: 全退 0；`DocumentPane.vue` ≤260、`LeftSidebar.vue` ≤190、`SkillBrowser.vue` ≤120、`useAgentStore.ts` 与 `useBookStore.ts` 均 <800（后者若逼近 500，按计划头的话拆 `useProfileStore`，但本任务不许临时改架构——先看数字，超了就在报告里留底并留到波 3 Task 27 处理）。

```bash
git add packages/contracts/src/agent-event.ts packages/contracts/test/agent.test.ts apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts apps/desktop/src/main/turn-e2e.test.ts apps/desktop/src/renderer/src/stores apps/desktop/src/renderer/src/components/SkillBrowser.vue apps/desktop/src/renderer/src/components/DocumentPane.vue apps/desktop/src/renderer/src/components/LeftSidebar.vue apps/desktop/src/renderer/src/components/SlashPalette.vue apps/desktop/src/renderer/src/utils/slash-commands.ts apps/desktop/src/renderer/src/utils/slash-commands.test.ts apps/desktop/src/renderer/src/styles/interaction.css
git commit -m "feat(skills): 技能库只读浏览与显式挂入，StartTurnInput 加 skillPaths"
```

- [ ] **Step 10：真机复验（控制方亲自操作）**

1. 左栏「技能库」展开，全局与书内各一条都在；点一条 → 右栏出现正文，**当前文稿标签的未保存手改没丢**（先在章里打几个字再点技能）。
2. 「加入当前上下文」按钮按下后角标出现；发一轮 → 模型答复里引用到该技能内容（Task 24 之后才是硬证据，本步先看载荷：占用条字数上涨）。
3. 挂 13 条：第 13 次点下去出「一次最多挂入 12 个技能…」，且没有第二次 IPC。
4. `/skills` 在输入面板里可选、运行中置灰；`Esc` 关面板不影响右栏。
5. 关闭技能格回到文稿侧，草稿与「有未保存修改」状态一字不变。

**留底（如实）**：

- `skillPaths` 存 id 不存路径，所以重启清空对用户不构成数据风险（正文永远在盘上），但**挂入关系**会丢 —— UI 那句「重启后清空」是这条留底的对账口径。
- 本任务只保证载荷里带了 id；「主进程按 id 读到正文并进 system」由 Task 24 落地并测。在那之前，挂入技能对模型不起作用，只有占用条变化（预览走 Task 16 的 `contextPreview`，它已按 `skillPaths` 组装）。

### Task 24：装配收口 —— 技能正文进上下文（按 id 解析）、「读不到」可见 error、§10 四条「浏览不打断」

> 前置：Task 13（`AGENT_PROFILES` 六条 `buildSections` 全部委托给 `delegateSections`）、Task 14（`buildContextPack` / `ContextReader` / `ContextPack` / `contextSummaryOf`）、Task 15（`createFsContextReader({ book })`）、Task 16（`createBookPromptAssembler`、`promptFor` 已异步、`resolveProfile` 那条可见 error 事件已定稿）、Task 22（`createSkillsService({ globalDir, bookRoot, readFile?, realpath? })` 与它的三条路径安全闸）、Task 23（`StartTurnInput.skillPaths` 携带 `SkillRef.id`；`SkillBrowser.vue` 的「加入当前上下文」；`refreshContext` 已传真值）已合入。
>
> 本任务闭合 Task 23 留底那句「本任务只保证载荷里带了 id；主进程按 id 读到正文并进 system 由 Task 24 落地并测」，并把 Plan 3 spec §10 的四条「浏览不打断」写死在可 node 单测的 store 层。

**Files:**

- Modify: `packages/agent-runtime/src/context-pack.ts`（`ContextReader` 加 `readSkill`；技能循环改走它；`ContextPack` 加 `unreadableSkills`）
- Modify: `packages/agent-runtime/src/index.ts`（若 Task 14 用的是具名 re-export，补 `type SkillText`；当场 `grep -n "context-pack" src/index.ts` 回读，不许猜）
- Modify: `packages/agent-runtime/test/context-pack.test.ts`（假 reader 加 `readSkill`；技能夹具的键从路径样式改成标识样式；新增 3 条用例）
- Modify: `apps/desktop/src/main/context-reader.ts`（`readSkill` 实现，委托给注入的 `SkillsService`）
- Modify: `apps/desktop/src/main/context-reader.test.ts`（`readSkill` 五条用例 + 既有夹具连带）
- Modify: `apps/desktop/src/main/book-prompt.ts`（返回 `AssembledPrompt`，把 `unreadableSkills` 递出来）
- Modify: `apps/desktop/src/main/book-prompt.test.ts`（返回值形状连带 + 一条新用例）
- Modify: `apps/desktop/src/main/agent-service.ts`（`promptFor` 返回形状、`skillPaths: input.skillPaths`、可见 error）
- Modify: `apps/desktop/src/main/agent-service.test.ts`、`agent-service-boundary.test.ts`、`turn-e2e.test.ts`（`promptFor` 夹具返回值形状连带）
- Modify: `apps/desktop/src/main/index.ts`（一个 `SkillsService` 实例同时喂 `registerSkillsIpc` 与 `createFsContextReader`）
- Modify: `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`（§10 断言 1、2）
- Modify: `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`（§10 断言 3、4）

**Interfaces：**

Consumes（全部已落地的仓内件，动 `agent-service.ts` / `index.ts` 前当场回读行号）：

- `SkillsService.read(source: SkillSource, relPath: string): Promise<SkillContent>`（Task 22；`SkillContent = { relPath; content; truncated }`；读不到/越界一律**抛单句中文**）。
- `CONTEXT_SECTION_KIND_LABELS`（Task 11 落 contracts）——技能节 `label` 仍查这张表，本任务不新增任何标签映射。
- `publish(threadKey, event)` 与 `deps.newId()` / `deps.isoNow()`（Task 16 的档案回落 error 事件用的就是这一套，本任务照抄姿态）。

Produces（波 3 内部契约，逐字照此实现）：

```ts
// packages/agent-runtime/src/context-pack.ts
export interface SkillText {
  text: string;
  truncated: boolean;
}
export interface ContextReader {
  listDocs(): DocRef[];
  readDoc(relPath: string): Promise<string | null>;
  charactersOf(relPath: string): Promise<string[]>;
  /** 新增第四端口：按挂入标识取技能正文。null = 这次没读到（未知格式、没开书、IO 失败都归 null）。 */
  readSkill(id: string): Promise<SkillText | null>;
}
export interface ContextPack {
  sections: ContextSection[];
  charCount: number;
  estimate: number;
  omitted: string[];
  /** 新增：readSkill 返回 null 的那些标识，原样回传，由装配层决定怎么让用户看见。 */
  unreadableSkills: string[];
}

// apps/desktop/src/main/book-prompt.ts
export interface AssembledPrompt {
  text: string;
  unreadableSkills: string[];
}
export function createBookPromptAssembler(deps: {
  book: BookService;
  reader: ContextReader;
}): (context: PromptContext) => Promise<AssembledPrompt>;

// apps/desktop/src/main/agent-service.ts
AgentServiceDeps.promptFor(context: PromptContext): Promise<AssembledPrompt>;   // 返回形状由 string 改成它

// apps/desktop/src/main/context-reader.ts
export function createFsContextReader(deps: {
  book: BookService;
  skills: SkillsService;
}): ContextReader;
```

---

## 动手前必读：五条口径（本任务的全部争议在这里拍死）

1. **`skillPaths` 全程是「标识」，不是文件系统路径。** Plan 3 spec §11 定 `SkillRef.id = ${source}:${dirName}`，Task 23 落 `skillPathsByThread` 存的、`StartTurnInput.skillPaths` 带的、`ContextPreviewInput.skillPaths` 带的都是这个 id。Task 14 草稿里那些 `".mochen/skills/甲/SKILL.md"` 样式是**写夹具时的口径未定**留下的，本任务统一改成 `"book:甲"`（Step 1 第 3 段列出全部点位）。runtime 侧**永不解析**这个串——它只当不透明键传给 `readSkill`，也只用它填 `ContextSection.path` 与 `omitted` / `unreadableSkills` 的元素。解析只发生在 `context-reader.ts` 一处（Step 4）。
2. **路径安全不重复造。** 越界三道闸（`<单层目录名>/SKILL.md` 形状、解析后仍在库目录内、不跟软链出目录、64 KB 码点边界截断）全部是 Task 22 的 `SkillsService.read` 的地盘（M10 钉的就是它）。所以 `createFsContextReader` **不自己拼 skills 路径、不自己 `readFile`**，而是注入同一个 `SkillsService` 实例并委托；`index.ts` 必须只造一个实例（Step 7），否则 IPC 读到的与装配进上下文的会分叉。
3. **`ContextSummary` 一字不动。** `unreadableSkills` 只活在 runtime 的 `ContextPack` 里，`contextSummaryOf` 不转发它：占用条的形状（`sections/charCount/estimate/omitted` 四键）是 Task 11 定稿、Task 20 冒烟第 7 项验的，加键就是改契约还要连带渲染层。技能读不到的可见性归 `startTurn` 通路（口径 5），预览通路继续静默。
4. **`readSkill` 返回 `null` 的姿态与 `readDoc` 一致**：「这次没读到」，绝不抛。`SkillsService.read` 抛出的中文原因**不吃进 error 事件**——挂入十个技能、九个坏时，把九句路径告警灌进会话历史是噪声；聚合计数才是 Plan 3 spec §9「失败可见」要的那个粒度。
5. **可见 error 整句定稿**（照 Task 16 规则 2 的姿态：只在 `startTurn` 发、只在有 `turnId` 可挂时发、测试用 `toBe` 逐字钉死）：
   ```
   有 2 个挂入技能读不到，已跳过：book:甲、global:乙。
   ```
   模板：`` `有 ${ids.length} 个挂入技能读不到，已跳过：${ids.join("、")}。` ``，`ids` 是 `unreadableSkills` **原样**（带 `book:` / `global:` 前缀）。为什么显式保留前缀：这是用户自己起的目录名 + 来源库，比再造一个「取显示名」的解析器更有用，而且解析器会把 id 语法抄成第二份（违反铁律 6 的精神）。0 个读不到时**不发事件**（不发空事件）。

`contextPreview` 里同样静默回落、**不发事件**——和 Task 16「未知 profileId 预览静默」同一条理由：预览不属于任何轮次，`AgentEvent.turnId` 无处可填，落盘反而污染别的线程历史。

**本任务零 contracts 改动**：`IPC_CHANNELS` 计数保持 19，`RendererApi` 方法数保持 19，`ContextSummary` / `ContextSectionView` / `SKILL_SOURCES` 一字不动。所以 `renderer-api.test.ts` 的字面量计数、`contract.test.ts` 的通道计数都**不该**被本任务动到；动到了就是越界。

---

- [ ] **Step 1：先改 runtime 测试到红**

改 `packages/agent-runtime/test/context-pack.test.ts`，三处：

**(a) `fakeReader` 加第四个端口**（现第 63–72 行整块替换）。技能夹具单独一张表，键是**标识**：

```ts
function fakeReader(
  files: Record<string, string>,
  init: {
    docs?: DocRef[];
    characters?: Record<string, string[]>;
    skills?: Record<string, SkillText>;
  } = {}
): ContextReader {
  const map = new Map(Object.entries(files));
  return {
    listDocs: () => [...(init.docs ?? [])],
    readDoc: async (relPath) => map.get(relPath) ?? null,
    charactersOf: async (relPath) => [...(init.characters?.[relPath] ?? [])],
    readSkill: async (id) => {
      const hit = init.skills?.[id];
      return hit === undefined ? null : { ...hit };
    }
  };
}
```

import 块（现第 55–62 行的 `from "../src/context-pack.js"`）里加一行 `type SkillText,`（按现有字母序，`type ContextRequest` 之后）。

**(b) 既有技能夹具从路径样式改成标识样式**。逐点：

| 现文件位置 | 现在写着 | 改成 |
| --- | --- | --- |
| `FULL_BOOK` 末键（现第 94 行） | `".mochen/skills/伏笔登记/SKILL.md": "技能：伏笔登记表格式。"` | 从 `FULL_BOOK` **删掉这一键**，改挂到 `FULL_SKILLS`（见下） |
| 「节序 doc→…→skills」用例的 `skillPaths` | `[".mochen/skills/伏笔登记/SKILL.md"]` | `["book:伏笔登记"]`，并在 `fakeReader(...)` 第二参加 `skills: FULL_SKILLS` |
| 「超预算…omitted」用例的 `skillPaths` | `[".mochen/skills/甲/SKILL.md", ".mochen/skills/乙/SKILL.md"]` | `["book:甲", "book:乙"]` + `skills: FULL_SKILLS` |
| 同用例的 `omitted` 断言 | `toEqual([".mochen/skills/乙/SKILL.md"])` | `toEqual(["book:乙"])` |
| 「多轮丢弃」用例（现第 270、274 行一带） | 同两串路径 | 同上改成标识 |

在 `FULL_DOCS` 之后补一个模块级常量，供三处共用：

```ts
const FULL_SKILLS: Record<string, SkillText> = {
  "book:伏笔登记": { text: "技能：伏笔登记表格式。", truncated: false },
  "book:甲": { text: "技能甲：一句很长的话。".repeat(60), truncated: false },
  "book:乙": { text: "技能乙：铁锈味要贯穿全章。", truncated: false }
};
```

**(c) 追加三条红的用例**，放文件末尾新 describe：

```ts
describe("挂入技能：readSkill 与 unreadableSkills（Task 24）", () => {
  it("技能节正文逐字来自 readSkill，label 仍查表、path 是标识本身", async () => {
    const pack = await buildContextPack(
      fakeReader(FULL_BOOK, { docs: [], skills: { "book:伏笔登记": { text: "伏笔登记表：编号｜位置｜回收。", truncated: false } } }),
      makeRequest({ skillPaths: ["book:伏笔登记"] })
    );
    const skills = pack.sections.filter((section) => section.kind === "skills");
    expect(skills.length).toBe(1);
    expect(skills[0]?.label).toBe(CONTEXT_SECTION_KIND_LABELS.skills);
    expect(skills[0]?.path).toBe("book:伏笔登记");
    expect(skills[0]?.text).toBe("伏笔登记表：编号｜位置｜回收。");
    expect(pack.unreadableSkills).toEqual([]);
  });

  it("readSkill 给 null 的标识进 unreadableSkills 原样回传，且绝不凭空造一节", async () => {
    const pack = await buildContextPack(
      fakeReader(FULL_BOOK, {
        docs: [],
        skills: { "global:好的": { text: "能用。", truncated: false } }
      }),
      makeRequest({ skillPaths: ["global:好的", "book:丢了", "global:也没了"] })
    );
    expect(pack.sections.filter((s) => s.kind === "skills").map((s) => s.path)).toEqual(["global:好的"]);
    expect(pack.unreadableSkills).toEqual(["book:丢了", "global:也没了"]);
    // 请求顺序原样保留：用户先挂哪个，回显就是哪个顺序
    expect(pack.unreadableSkills.length).toBe(2);
  });

  it("readSkill 报 truncated 时技能节的 truncated 跟着真，不许伪装完整", async () => {
    const pack = await buildContextPack(
      fakeReader(FULL_BOOK, {
        docs: [],
        skills: { "book:长文": { text: "六十四千字节的上限之前", truncated: true } }
      }),
      makeRequest({ skillPaths: ["book:长文"] })
    );
    const section = pack.sections.find((s) => s.kind === "skills");
    expect(section?.truncated).toBe(true);
  });

  it("contextSummaryOf 不把 unreadableSkills 漏进 IPC 视图：摘要仍是四键", async () => {
    const pack = await buildContextPack(
      fakeReader(FULL_BOOK, { docs: [] }),
      makeRequest({ skillPaths: ["book:丢了"] })
    );
    expect(pack.unreadableSkills).toEqual(["book:丢了"]);
    const summary = contextSummaryOf(pack);
    expect(Object.keys(summary).sort()).toEqual(["charCount", "estimate", "omitted", "sections"]);
    expect(JSON.stringify(summary)).not.toContain("book:丢了");
  });
});
```

> 最后一条是口径 3 的钉子：`unreadableSkills` 到渲染层为止**不存在**。它只给装配层发 error 事件用。

- [ ] **Step 2：跑到红并贴出来**

Run: `corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts --maxWorkers=4`
Expected: 新 describe 全红（`readSkill` 不存在 ⇒ `buildContextPack` 里的技能循环仍走 `readDoc`，`pack.unreadableSkills` 是 `undefined`）；改过夹具的旧用例也红（`omitted` 期望值换了样式）。**这段红必须贴进波 3 报告**。同时 `tsc` 会先在 `context-pack.ts` 的 `ContextReader` 上报 `readSkill` 缺失——那是类型关卡，不是断言失败，算预期的红。

- [ ] **Step 3：改 `context-pack.ts` 跑绿**

`ContextReader` 接口（现文件里的三端口块）加 `readSkill(id: string): Promise<SkillText | null>;` 与 `export interface SkillText { text: string; truncated: boolean }`，注释照 Interfaces 段那条逐字写。`ContextRequest.skillPaths` 的文档注释改成：

```ts
  /**
   * 挂入技能的标识（`SkillRef.id`，形如 `book:目录名` / `global:目录名`）。
   * runtime 永不解析格式：只当不透明键交给 reader.readSkill，并原样用作节标识与回传值。
   */
  skillPaths: string[];
```

技能循环（现第 515–524 行 `for (const relPath of request.skillPaths) { ... reader.readDoc(relPath) ... }`）整块替换：

```ts
  const unreadableSkills: string[] = [];
  for (const id of request.skillPaths) {
    const hit = await reader.readSkill(id);
    if (hit === null) {
      // 「没读到」不等于「不存在」：主进程版会抛中文原因，这里只回标识，可见性归装配层（Task 24 口径 4/5）。
      unreadableSkills.push(id);
      continue;
    }
    sections.push({
      kind: "skills",
      label: CONTEXT_SECTION_KIND_LABELS.skills,
      path: id,
      text: hit.text,
      truncated: hit.truncated
    });
  }
```

`ContextPack` 加 `unreadableSkills: string[]`；`buildContextPack` 末尾的返回值补 `unreadableSkills`（**预算裁剪不动它**——`trimToBudget` 只管进了 `sections` 的节，被丢的技能走 `omitted`，读不到的走 `unreadableSkills`，两条集合语义互不重叠，这是 Step 1 第二条用例的另一半意思）。`contextSummaryOf` 一字不改。

Run: `corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts --maxWorkers=4`
Expected: 全绿。若 `packages/agent-runtime/src/index.ts` 是具名 re-export，把 `type SkillText` 加进去；`export * from "./context-pack.js"` 则不动。回读确认：`grep -n "context-pack" packages/agent-runtime/src/index.ts`。

- [ ] **Step 4：主进程 reader —— 先写红的 `readSkill` 用例**

改 `apps/desktop/src/main/context-reader.test.ts`。这个文件现在的假 `BookService` 与真 tmpdir 夹具照旧，只加一个假 `SkillsService`：

```ts
/** 只喂 read()：Task 22 的真实现由它自己的测试钉，这里只验委托与「坏标识 → null」。 */
function fakeSkills(
  files: Record<string, string>,
  opts: { throwOn?: string } = {}
): SkillsService {
  return {
    list: async () => [],
    read: async (source, relPath) => {
      const key = `${source}:${relPath}`;
      if (opts.throwOn !== undefined && key === opts.throwOn) throw new Error("技能文件读不到：找不到该技能文件。");
      const content = files[key];
      if (content === undefined) throw new Error("技能文件读不到：找不到该技能文件。");
      return { relPath, content, truncated: false };
    }
  } as unknown as SkillsService;
}
```

（`SkillsService` 的接口名与方法名照 Task 22 落地件；动手前 `grep -n "export interface SkillsService" apps/desktop/src/main/skills-service.ts` 回读，若那里的方法不叫 `read` 或返回值不是 `SkillContent`，**以落地件为准改这个假实现**，不改 Task 22。）

四条红的用例，追加到新 describe：

```ts
describe("createFsContextReader.readSkill（标识解析 + 委托 SkillsService）", () => {
  it("book:目录名 → read("book", "目录名/SKILL.md")，正文与 truncated 原样递出", async () => {
    const reader = createFsContextReader({
      book: fakeBook(snapshotOf(dir, docs)),
      skills: fakeSkills({ 'book:场景节拍/SKILL.md': "先立冲突，再给代价。" })
    });
    expect(await reader.readSkill("book:场景节拍")).toEqual({
      text: "先立冲突，再给代价。",
      truncated: false
    });
  });

  it("global:目录名 走全局库，与书内互不串门", async () => {
    const reader = createFsContextReader({
      book: fakeBook(null),
      skills: fakeSkills({ "global:对白压缩/SKILL.md": "删掉解释性对白。" })
    });
    expect(await reader.readSkill("global:对白压缩")).toEqual({
      text: "删掉解释性对白。",
      truncated: false
    });
  });

  it("格式不对的标识一律 null，不碰 SkillsService：前缀缺失、多层目录、绝对路径、空串、重复前缀", async () => {
    let touched = 0;
    const reader = createFsContextReader({
      book: fakeBook(snapshotOf(dir, docs)),
      skills: {
        list: async () => [],
        read: async () => {
          touched += 1;
          return { relPath: "x/SKILL.md", content: "不该被读到", truncated: false };
        }
      } as unknown as SkillsService
    });
    for (const bad of [
      "场景节拍",
      "other:场景节拍",
      "book:a/b",
      "book:../etc",
      "book:",
      ":场景节拍",
      "book:书/SKILL.md",
      "/abs/path",
      "C:\\x",
      "book:book:甲"
    ])
      expect(await reader.readSkill(bad)).toBeNull();
    expect(touched).toBe(0);
  });

  it("SkillsService 抛中文原因 → null（绝不把异常漏给装配循环，一条坏技能不断全链）", async () => {
    const reader = createFsContextReader({
      book: fakeBook(snapshotOf(dir, docs)),
      skills: fakeSkills({}, { throwOn: "book:丢了" })
    });
    expect(await reader.readSkill("book:丢了")).toBeNull();
  });
});
```

> 第三条用例的 `touched === 0` 是本层唯一能证明「不拼路径、不试读」的断言：形状不对就在门口挡掉，越界防线只有一道，在 Task 22。

- [ ] **Step 5：落地 `context-reader.ts` 的 `readSkill`**

Run: `corepack pnpm vitest run apps/desktop/src/main/context-reader.test.ts --maxWorkers=4`
Expected: 新 describe 全红（`readSkill` 不存在；`createFsContextReader` 还不收 `skills` 参数，`tsc` 也报多传键）。

改 `apps/desktop/src/main/context-reader.ts`：

```ts
/**
 * 技能标识（`SkillRef.id`）→ SkillsService 的 (source, relPath)。
 * 只认 `<global|book>:<单层目录名>`；目录名的字符校验在 SkillsService（Task 22 的 M10），
 * 这里只挡明显形状不对的串，好让「不碰文件系统」这条可测（见测试里的 touched === 0）。
 */
function skillRefOf(id: string): { source: SkillSource; relPath: string } | null {
  const sep = id.indexOf(":");
  if (sep <= 0) return null;
  const source = id.slice(0, sep);
  const dirName = id.slice(sep + 1);
  if (source !== "global" && source !== "book") return null;
  if (dirName === "" || dirName.includes("/") || dirName.includes("\\") || dirName.includes(":")) return null;
  if (dirName === "." || dirName === ".." || dirName.startsWith(".")) return null;
  return { source, relPath: `${dirName}/SKILL.md` };
}
```

（`SkillSource` 从 `@mochen/contracts` import type；`SkillsService` 从 `./skills-service.js` import type。）`createFsContextReader` 的 deps 加 `skills: SkillsService`，端口实现：

```ts
    async readSkill(id: string): Promise<SkillText | null> {
      const ref = skillRefOf(id);
      if (ref === null) return null;
      try {
        // 路径安全、软链、64 KB 上限全在 SkillsService；这里唯一的工作是「异常 → null」。
        const content = await deps.skills.read(ref.source, ref.relPath);
        return { text: content.content, truncated: content.truncated };
      } catch {
        return null;
      }
    },
```

同文件顶部 `import type { ContextReader, SkillText } from "@mochen/agent-runtime";`（若 Task 15 写的是 `import type { ContextReader }`，只加 `SkillText`）。既有的 `readDoc` / `charactersOf` / `listDocs` 一字不改。

改 `apps/desktop/src/main/context-reader.test.ts` 的**既有全部** `createFsContextReader({ book: ... })` 调用点：加 `skills: fakeSkills({})`（缺技能夹具不影响文稿用例）。不许用 `as never` / 可选参数绕过——参数必填才让「装配处忘了注入」在编译期就红。

Run: `corepack pnpm vitest run apps/desktop/src/main/context-reader.test.ts --maxWorkers=4`
Expected: 全绿。

- [ ] **Step 6：装配器与 agent-service —— 返回值形状 + 可见 error（同一次改完，中间提交必须过 tsc）**

先改红。`apps/desktop/src/main/book-prompt.test.ts`：现有用例全都在 `expect(await assemble(ctx)).toContain(...)`，返回值形状一变就全红，这是预期的类型级红。逐处改成 `(await assemble(ctx)).text`（用 `grep -n "assemble(" apps/desktop/src/main/book-prompt.test.ts` 点数，一处不漏），并追加一条：

```ts
  it("读不到的挂入技能不产假正文：AssembledPrompt.text 里没有它，unreadableSkills 里有它", async () => {
    const assembled = await assemble(baseContext({ skillPaths: ["book:丢了", "book:存在的"] }));
    expect(assembled.text).not.toContain("丢了");
    expect(assembled.text).toContain(CONTEXT_SECTION_KIND_LABELS.skills);
    expect(assembled.unreadableSkills).toEqual(["book:丢了"]);
  });
```

（`book:存在的` 需要在 `beforeAll` 的 reader 上读得到：那里的 `createFsContextReader({ book: fakeBook(...) })` 同样要加 `skills:` 参数，用一条 `fakeSkills`-形状的常量把 `"book:存在的/SKILL.md"` 喂进去。Step 4 的假实现是测试文件局部的，两个测试文件各留一份即可——**不要**为此新建共享夹具文件，两份 12 行的假对象比一个跨文件依赖更好读。）

改 `apps/desktop/src/main/book-prompt.ts`：

```ts
/** 装配产物：给模型的提示词正文，加上「哪些挂入技能没读到」——可见性归调用方（agent-service 才有 turnId 可挂）。 */
export interface AssembledPrompt {
  text: string;
  unreadableSkills: string[];
}
```

工厂返回类型 `(context: PromptContext) => Promise<AssembledPrompt>`，末尾 `return [...header, body, protocolBlockHint].join("\n\n");` 改为：

```ts
    return {
      text: [...header, body, protocolBlockHint].join("\n\n"),
      unreadableSkills: [...pack.unreadableSkills]
    };
```

（`pack.omitted` 那句「整节省略未送入」的提示行照旧进 `text`，本任务不动它——M8 的地盘。）

改 `apps/desktop/src/main/agent-service.ts` 四处（行号当场回读，Task 16 之后文件已不是 513 行）：

1. `AgentServiceDeps.promptFor` 的返回类型 → `Promise<AssembledPrompt>`；import 里加 `type AssembledPrompt`（自 `./book-prompt.js`）。
2. `startTurn` 里 `const context: PromptContext = {...}` 的 `skillPaths: []` 改成 `skillPaths: input.skillPaths`，**并删掉 Task 16 留的那行预留注释**（`/** 波 3 给 StartTurnInput 加 skillPaths 后改成 input.skillPaths ?? []；本轮 startTurn 恒 []，预览通路先走满。 */`）。留着就是债务，注释归零才算闭合。
3. `systemPrompt: await deps.promptFor(context),` 拆成三行，并在其间发可见事件：

```ts
        const assembled = await deps.promptFor(context);
        if (assembled.unreadableSkills.length > 0) {
          // 总 spec §9 失败可见：聚合计数 + 标识原样，一句 error 事件随会话落盘；逐条路径告警是噪声。
          publish(threadKey, {
            id: deps.newId(),
            ts: deps.isoNow(),
            turnId,
            type: "error",
            message: `有 ${assembled.unreadableSkills.length} 个挂入技能读不到，已跳过：${assembled.unreadableSkills.join("、")}。`
          });
        }
```

   下面 `runTurn({ ... systemPrompt: assembled.text, ... })`。
4. `contextPreview` **一字不改**（口径 3、5）。

改 `agent-service.test.ts` / `agent-service-boundary.test.ts` / `turn-e2e.test.ts` 里所有 `promptFor:` 夹具：`async () => "…"` → `async () => ({ text: "…", unreadableSkills: [] })`。用 `grep -rn "promptFor" apps/desktop/src/main/*.test.ts` 点齐，**不许**用 `as never` 绕。

追加一条红的用例（放在现有「未知 profileId 发那条回落 error」用例的同一个 describe 里，复用那里的 `errorMessages()` / `publish` 捕获辅助）：

```ts
  it("挂入技能读不到：一句中文 error 事件随本轮落盘，整句逐字钉死，且本轮照常跑完", async () => {
    // 这个夹具的 reader 用 Step 4 的 fakeSkills 形状：book:甲 缺、book:乙 在。
    await service.startTurn({ ...startInput, skillPaths: ["book:甲", "book:乙"] });
    expect(errorMessages()).toContain(
      "有 1 个挂入技能读不到，已跳过：book:甲。"
    );
    expect(eventsOf("turn-end").length).toBe(1);
  });

  it("全部挂入技能读得到：不发任何 error 事件（空事件也是噪声）", async () => {
    await service.startTurn({ ...startInput, skillPaths: ["book:乙"] });
    expect(errorMessages()).toEqual([]);
  });
```

（`errorMessages()` / `eventsOf()` 是那两个文件里已有的辅助名——**当场回读**，若那里的叫法不同（例如 `publishedErrors()`），照叫法写，不要为了对齐这段草稿去改名既有辅助。）

- [ ] **Step 7：`index.ts` 只造一个 `SkillsService`**

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: 报 `createFsContextReader` 缺 `skills`（Task 16/15 的装配点）——这条红就是本步骤的开工依据。

改 `apps/desktop/src/main/index.ts`（现第 46 行一带 `const contextReader = createFsContextReader({ book: service });` 与 Task 22 的 `registerSkillsIpc(...)` 处）：

```ts
const skillsService = createSkillsService({
  globalDir: path.join(appDataDir, "skills"),
  bookRoot: () => service.current()?.rootPath ?? null
});
const contextReader = createFsContextReader({ book: service, skills: skillsService });
```

`globalDir` 的**值**照 Task 22 落地时那一行原样搬（Plan 3 spec §12 定的是 `<appData>/mochen-ai/skills/`）——本步骤只把「谁造这个实例」收口成一处，不改目录一个字符。

`registerSkillsIpc(handle, skillsService)` 改成吃这个实例（Task 22 落地时若是「在 register 内部造实例」，本步骤把它提出来只造一次——**同一个实例服务 IPC 与上下文装配**，否则两处读取规则可以各自漂移）。

> `appDataDir` / `service.current()` 的真实变量名与 `bookRoot` 该取 `rootPath` 还是 `root`，**动手前 grep 回读**：`grep -n "appDataDir\|createSkillsService\|registerSkillsIpc\|createFsContextReader" apps/desktop/src/main/index.ts` 与 `grep -n "root" apps/desktop/src/main/book-service.ts`。Task 22 草稿留过同一条待核注释，以落地件为准。

Run: `corepack pnpm vitest run apps/desktop/src/main --maxWorkers=4`
Expected: 主进程全绿。

- [ ] **Step 8：§10 四条「浏览不打断」写死在 store 层**

总 spec §4 的写死规则、Plan 3 spec §10 点名波 3 补齐。四条全部落在**可 node 单测的 store**，不写组件测试（本仓不引 `@vue/test-utils`）。

**(a) 断言 1、2 → `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`**（夹具照该文件现风格，`vi.stubGlobal("window", { mochen: api })`）：

```ts
describe("浏览永不打断文稿（Plan 3 spec §10）", () => {
  it("断言 1：开素材浏览标签后，文稿标签、活动标签、草稿侧字段一字不变", async () => {
    const book = useBookStore();
    await book.openBook("/book");
    await book.openDocTab(MATERIAL);   // 先真打开一个文稿，制造非默认的草稿态
    book.onEdit("改了一半的句子");
    const before = {
      docTabs: [...book.docTabs],
      activeDocTab: book.activeDocTab,
      draft: book.draft,
      dirty: book.dirty,
      savedFingerprint: book.savedFingerprint,
      drafts: JSON.stringify(book.draftsByPath)
    };
    book.browse(materialRef);
    expect(book.rightPaneMode).toBe("browse");            // 唯一被允许变的是这一格
    expect(book.docTabs).toEqual(before.docTabs);
    expect(book.activeDocTab).toBe(before.activeDocTab);
    expect(book.draft).toBe(before.draft);
    expect(book.dirty).toBe(before.dirty);
    expect(book.savedFingerprint).toBe(before.savedFingerprint);
    expect(JSON.stringify(book.draftsByPath)).toBe(before.drafts);
  });

  it("断言 1 补：开的是技能浏览格时，连 browseTabs 都不许动（技能不是 DocRef）", async () => {
    const book = useBookStore();
    await book.openBook("/book");
    await book.openDocTab(CHAPTER);
    book.browse(materialRef);
    const tabsBefore = [...book.browseTabs];
    book.openSkillBrowser({ id: "book:场景节拍", displayName: "场景节拍" });
    expect(book.browseTabs).toEqual(tabsBefore);
    expect(book.activeBrowse).toBe(materialRef.relPath);   // 浏览格的选中也不动
    expect(book.skillBrowser?.id).toBe("book:场景节拍");
    expect(book.docTabs.length).toBe(1);
    expect(book.draft).not.toBe("");                        // 草稿侧没被清
  });

  it("断言 2：关浏览标签只动浏览格自身，文稿侧与被关标签之外的浏览内容都保持", async () => {
    const book = useBookStore();
    await book.openBook("/book");
    await book.openDocTab(CHAPTER);
    book.onEdit("留着别丢");
    book.browse(materialRef);
    book.browse(otherRef);
    await vi.runAllTimersAsync();                     // 若那个文件不用 fakeTimers，就 await 一次微任务：见下注
    const contentsBefore = { ...book.browseContents };
    const before = { docTabs: [...book.docTabs], draft: book.draft, dirty: book.dirty };
    book.closeBrowse(materialRef.relPath);
    expect(book.docTabs).toEqual(before.docTabs);
    expect(book.draft).toBe(before.draft);
    expect(book.dirty).toBe(before.dirty);
    expect(book.browseTabs.map((doc) => doc.relPath)).toEqual([otherRef.relPath]);
    expect(book.activeBrowse).toBe(otherRef.relPath);
    expect(book.browseContents[otherRef.relPath]).toBe(contentsBefore[otherRef.relPath]);
  });
});
```

> `browse()` 内部 `void window.mochen.readDoc(...)` 是异步的：那个文件里怎么等假实现的 promise（`await vi.runAllTimersAsync()` / `await Promise.resolve()` / 已有的 `flush()` 辅助），**照它现仓写法**，别自己造第二种。`CHAPTER` / `MATERIAL` / `materialRef` / `otherRef` 同理——先 `grep -n "^const \|Ref\b" apps/desktop/src/renderer/src/stores/useBookStore.test.ts` 看那里已有的常量名，复用，缺什么再按同风格补。

**(b) 断言 3、4 → `apps/desktop/src/renderer/src/stores/useAgentStore.test.ts`**（Step 1 的夹具与 `push()` / `openChapter()` / `itemsOf()` / `interruptTurn` 都在那个文件里现成）：

```ts
describe("浏览与挂入不打断会话（Plan 3 spec §10）", () => {
  it("断言 3：turn 正在跑时开素材浏览标签——running 保持真、items 一字不变、没打 interruptTurn", async () => {
    await openChapter();
    store().startListening();
    await store().send("开头再压一版");
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    expect(store().viewOf(CH).running).toBe(true);
    const itemsBefore = JSON.parse(JSON.stringify(itemsOf(CH)));
    const startedBefore = started.length;
    useBookStore().browse({ relPath: OTHER, kind: "chapter", title: "转折" });
    expect(store().viewOf(CH).running).toBe(true);
    expect(JSON.parse(JSON.stringify(itemsOf(CH)))).toEqual(itemsBefore);
    expect(started.length).toBe(startedBefore);
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("断言 3 补：挂入/取消挂入同样不动 items 与 running", async () => {
    await openChapter();
    store().startListening();
    await store().send("这段留着");
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    const itemsBefore = JSON.parse(JSON.stringify(itemsOf(CH)));
    store().attachSkill(CH, "book:场景节拍");
    store().detachSkill(CH, "book:场景节拍");
    expect(JSON.parse(JSON.stringify(itemsOf(CH)))).toEqual(itemsBefore);
    expect(store().viewOf(CH).running).toBe(true);
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("断言 4：只是打开技能正文（不点加入）→ 零预览请求、载荷里 skillPaths 仍是空", async () => {
    await openChapter();
    await store().loadProfiles();
    contextPreview.mockClear();
    useBookStore().openSkillBrowser({ id: "book:场景节拍", displayName: "场景节拍" });
    expect(contextPreview).not.toHaveBeenCalled();
    await store().send("先这样");
    expect(started.at(-1)?.skillPaths).toEqual([]);
  });

  it("断言 4 补：点「加入当前上下文」才产生装配效果，且恰好一次预览", async () => {
    await openChapter();
    await store().loadProfiles();
    contextPreview.mockClear();
    store().attachSkill(CH, "book:场景节拍");
    expect(contextPreview).toHaveBeenCalledTimes(1);
    expect(contextPreview.mock.calls[0]?.[0].skillPaths).toEqual(["book:场景节拍"]);
  });
});
```

> `JSON.parse(JSON.stringify(...))` 是故意的：`itemsOf()` 返回的是 store 里的**活引用**，直接 `toEqual` 自己比自己是恒真。这类「快照必须是深拷贝」的写法在本文件里已是既有风格（现第 409 行 `{ ...store().viewOf("x"), running: true }` 那处同理）。

Run: `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useBookStore.test.ts apps/desktop/src/renderer/src/stores/useAgentStore.test.ts --maxWorkers=4`
Expected: 全绿。**这四条是保护性断言**——它们今天在绿上（Task 23 已按同一形状实现）；本步骤的价值是把「后来人改坏了会红」钉进测试。若某条**开局就红**，那是真缺陷（例如 `browse()` 顺手清了草稿、`attachSkill` 动了 `items`），当场修实现而不是放宽断言。

- [ ] **Step 9：全量门禁**

```bash
corepack pnpm verify 2>&1 | tee /tmp/plan3-t24-verify.log; echo "VERIFY_PIPESTATUS=${PIPESTATUS[0]}"
grep -c "VERIFY_EXIT=0" /tmp/plan3-t24-verify.log
grep -E "Test Files|Tests " /tmp/plan3-t24-verify.log
```

Expected: `VERIFY_PIPESTATUS=0` 且日志里有 `VERIFY_EXIT=0`；用例数比 Task 23 收尾时净增 **≥ 15**（本任务新增 4 + 4 + 2 + 2 + 4 = 16 条，其中 `context-pack` 4 条含改写旧夹具）。基线由 `--maxWorkers=4` 复核；本机 dev 在跑时全量红是假红灯。

边界与行数：

```bash
node tools/check-package-boundary.mjs
node tools/check-source-line-budget.mjs
```

Expected: 都 0。`context-pack.ts` 加端口与循环净增约 20 行；`agent-service.ts` 加 error 分支约 12 行。若 `agent-service.ts` 破 700 行，按 Task 16 第 6 条口径拆 `proposal-approval.ts`——**本任务不默认拆，也不许为了少写几行把 error 分支塞进装配器**。

- [ ] **Step 10：补充变异（不占 M 编号，Task 27 台账单列）**

台账里 M1–M12 是 spec §15 定死的；本任务自加两条，报告里记成「S1/S2（Task 24）」：

- **S1｜失败可见**：`context-pack.ts` 的技能循环里删掉 `unreadableSkills.push(id);` 那一行（只留 `continue`）。Run: `corepack pnpm vitest run packages/agent-runtime/test/context-pack.test.ts apps/desktop/src/main/book-prompt.test.ts apps/desktop/src/main/agent-service.test.ts --maxWorkers=4`。Expected: 「readSkill 给 null 的标识进 unreadableSkills」红、装配器那条「unreadableSkills 里有它」红、agent-service 那句中文 error 断言红。**改回来**（只用 Edit）。
- **S2｜不吞异常**：`context-reader.ts` 的 `catch { return null; }` 改成 `catch { throw new Error("读不到技能"); }`。Run: `corepack pnpm vitest run apps/desktop/src/main/context-reader.test.ts --maxWorkers=4`。Expected: 「SkillsService 抛中文原因 → null」红，且它证明的是「一条坏技能不断全链装配」。改回来。

- [ ] **Step 11：真机复验（三项，主会话亲手做，不委托）**

前置：`corepack pnpm mock-provider`（另开终端）+ 设置对话框里填真实 baseURL/模型/密钥（密钥只在对话框输入，不落任何文件；会话里出现过的串冒烟后轮换，报告里记「已提醒轮换」）。

1. 左栏「技能库」里点一行技能 → 右栏出只读正文，文稿标签与草稿**肉眼可见地没动**；点「加入当前上下文」→ 占用条数值变大、`/status` 里的档案行不变；
2. 挂一个**故意改名致坏**的（先在盘上把 `.mochen/skills/甲/SKILL.md` 改名）→ 发一轮 → 中栏出现那句「有 1 个挂入技能读不到，已跳过：book:甲。」，且本轮回复正常收尾；重启应用后该行仍在历史里（`error` 事件随 JSONL 落盘）；
3. turn 正在流式输出时点技能行开浏览 → 流**不断**、光标不被抢、无「已打断」。

- [ ] **Step 12：提交**

```bash
git add packages/agent-runtime/src/context-pack.ts packages/agent-runtime/src/index.ts \
  packages/agent-runtime/test/context-pack.test.ts \
  apps/desktop/src/main/context-reader.ts apps/desktop/src/main/context-reader.test.ts \
  apps/desktop/src/main/book-prompt.ts apps/desktop/src/main/book-prompt.test.ts \
  apps/desktop/src/main/agent-service.ts apps/desktop/src/main/agent-service.test.ts \
  apps/desktop/src/main/agent-service-boundary.test.ts apps/desktop/src/main/turn-e2e.test.ts \
  apps/desktop/src/main/index.ts \
  apps/desktop/src/renderer/src/stores/useBookStore.test.ts \
  apps/desktop/src/renderer/src/stores/useAgentStore.test.ts
git commit -m "feat(context): 挂入技能按标识解析进上下文，读不到发可见 error，补浏览不打断四条断言"
git status --short
```

Expected: 工作树干净——上面 `git add` 之外，本任务 Files 未列出的文件一律不许进这个提交；`git status --short` 若还有残留，说明漏列，先补进本任务再提交。

---

## 留底（写进波 3 报告，不算缺陷）

- **`unreadableSkills` 不进占用条**：预览静默跳过读不到的技能，所以挂入十个而九个坏时，占用条仍按能读到的那一个显示。可见性由 `startTurn` 的那句 error 承担；用户看到的是「这一轮没吃到」，不是「装配坏了」。要在占用条上直接标灰，是 Plan 4 的事（那要动 `ContextSummary` 形状 + 渲染层 + Task 20 冒烟第 7 项）。
- **`contextPreview` 与真实发送之间没有一致性保证**：两次独立读盘，中间用户改了技能文件就会分叉。这与「文档正文预览和实际发送也会分叉」是同一级别的问题，本片不处理，指纹守卫只管写侧。
- **id 语法在两处**：构造在 `fs-store/skills.ts`（Task 21），解析在 `main/context-reader.ts`（本任务）。中间那层（contracts 的 `SkillRef.id: string`）是纯字符串，编译器管不了对不齐。收口成一份需要 `contracts` 出一个 `makeSkillId(source, dirName)` / `parseSkillId(id)` 对，本任务**不做**（改 Task 21 的落地件要走复核）。留底在案。
- **Task 14 草稿里的路径样式已在本任务统一改成标识样式**，`grep -n "\.mochen/skills" packages/agent-runtime` 应该零命中。若还有命中，说明夹具改漏了。

### Task 25：F-4 · 磁盘目录迁移（`mochen-writing` → `mochen-ai`，先验密后改名，M5）

> 前置：Task 19（`appearance.json` 已落进同一个 `secretDir`，所以它必须一起被搬走）。本任务是总 spec §8 / Plan 3 spec §12 的 F-4 落地；文档同步（总 spec 路径、README、Plan 2 冒烟报告更正注）**不在本任务**，归 Task 26。
>
> 现状只有一处代码字面量：`apps/desktop/src/main/index.ts:43` `const secretDir = path.join(app.getPath("appData"), "mochen-writing");`（动手前 `grep -rn "mochen-writing" apps packages tools` 回读，确认仍只有一处）。

**Files:**

- Create: `apps/desktop/src/main/app-data-migration.ts`
- Create: `apps/desktop/src/main/app-data-migration.test.ts`
- Modify: `apps/desktop/src/main/index.ts`（`whenReady` 回调改 async、迁移跑在 `createCredentialStore` **之前**、目录取值随报告、`dialog.showMessageBox` 播报）

**Interfaces：**（逐字照 Plan 3 spec §12，另加两个本任务拍定的注入点）

```ts
// apps/desktop/src/main/app-data-migration.ts
export interface AppDataMigrationDeps {
  oldDir: string;
  newDir: string;
  copyFile(src: string, dest: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  cipher: Cipher;
  /** 本任务追加的两项注入（spec 没列；不加则时间戳与「新目录已有同名文件」两条分支不可测）。 */
  now?: () => Date;
  exists?(path: string): Promise<boolean>;
}
export type AppDataMigrationReport =
  | { status: "nothing-to-do" }
  | { status: "migrated"; movedFiles: string[]; keptOldDir: string }
  | { status: "kept-old"; reason: string };

export async function migrateLegacyAppData(deps: AppDataMigrationDeps): Promise<AppDataMigrationReport>;
/** 播报文案的唯一实现（index.ts 只负责弹窗，不自己拼句子）。nothing-to-do ⇒ null，不打扰。 */
export function migrationNotice(
  report: AppDataMigrationReport,
  dirs: { newDir: string }
): string | null;
```

`Cipher` 从 `./credential-store.js` `import type`（`credential-store.ts:4-8` 那份，不复制结构体）。

---

## 动手前必读：五条裁定

1. **顺序不可调换**（M5 钉的就是这个）：①旧目录不存在 ⇒ `nothing-to-do`；②`mkdir(newDir, recursive)` + 只搬白名单三个文件；③**验密**——读**新目录**的 `secrets.enc` 并用 `cipher.decrypt` 解出非空字符串；④**只有第③步通过**才把旧目录改名；⑤返回报告。任何「先改名再验」「验不过就删旧目录」的实现都算违约：旧目录永远只改名、不删除，`AppDataMigrationReport` 里根本没有「已删除」这个码。
2. **白名单而非递归**：只搬 `config.json`、`secrets.enc`、`appearance.json`（存在才搬）。未知文件搬进新目录＝把来历不明的字节放到会被读取的位置。这三个名字在本模块**手抄一份**（`LEGACY_FILE_NAMES`），不 import `provider-settings.ts` / `credential-store.ts` 里的字面量——迁移面向的是盘上的历史，历史不该跟着今天的常量走；这条留底在 Step 6 之后。
3. **`cipher.available === false` ⇒ 立刻 `kept-old`**，原因逐字：`密钥保管当前不可用，已保持原目录，未做任何改名。`（spec 给的句子，末尾句号是我补的——本仓所有面向用户的中文句子都以句号收尾）。此时连拷贝都不做：safeStorage 不可用时新写出来的密文与旧密文不是一回事，半搬更糟。
4. **没有 `secrets.enc` 可验 ⇒ 视为验通过**（spec 没写死的一条，本任务拍定）：第③步的目标文件不存在时，不存在「解不开」的风险，也就没有理由拒绝搬 `config.json`。反过来，文件在但解密抛、或解出空串 ⇒ `kept-old`，原因句 `旧目录里的密钥在新目录中解不开，已保持原目录，未做任何改名。`。**方向不能反**：漏掉「缺文件算通过」会让从未配过密钥的用户永远迁不动（红用例在 Step 1）。
5. **`kept-old` 时应用必须真的继续用旧目录**：`index.ts` 里 `secretDir` 由报告决定，不是固定新值。否则「应用仍在使用旧目录」这句话就是假的，而用户的 `config.json` 会被 stranded 在旧目录里读不到。

补充裁定（幂等）：**新目录里已有同名文件 ⇒ 跳过该文件，绝不覆盖**。旧目录的东西不可能比新目录的新；覆盖等于用陈配置盖掉新配置。跳过的文件不进 `movedFiles`。

---

- [ ] **Step 1：先写红的测试**

新建 `apps/desktop/src/main/app-data-migration.test.ts`，整文件落盘。依赖全注入 ⇒ 不需要 electron、不需要真 fs（IO 三件套用内存 Map 假实现，`readdir` 从同一张表算）：

```ts
import { describe, expect, it } from "vitest";
import type { Cipher } from "./credential-store.js";
import { migrateLegacyAppData, migrationNotice } from "./app-data-migration.js";

/** 内存文件系统：只认「目录/文件名」两级，够这条模块用（它本来就不递归）。 */
function fakeFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set(["C:\\appdata", ...Object.keys(initial).map((p) => p.slice(0, p.lastIndexOf("\\")))]);
  return {
    files,
    dirs,
    copyFile: async (src: string, dest: string) => {
      const hit = files.get(src);
      if (hit === undefined) throw new Error(`ENOENT: ${src}`);
      files.set(dest, hit);
    },
    readFile: async (p: string) => {
      const hit = files.get(p);
      if (hit === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return hit;
    },
    readdir: async (p: string) => [...files.keys()].filter((f) => f.startsWith(`${p}\\`)),
    rename: async (from: string, to: string) => {
      for (const key of [...files.keys()]) {
        if (!key.startsWith(`${from}\\`)) continue;
        files.set(key.replace(from, to), files.get(key) as string);
        files.delete(key);
      }
      dirs.delete(from);
      dirs.add(to);
    },
    mkdir: async (p: string) => {
      dirs.add(p);
    },
    exists: async (p: string) => dirs.has(p) || [...files.keys()].some((f) => f.startsWith(`${p}\\`))
  };
}

const CIPHER_OK: Cipher = {
  available: true,
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (text) => (text.startsWith("enc:") ? text.slice(4) : "")
};
const CIPHER_THROWS: Cipher = {
  available: true,
  encrypt: (plain) => plain,
  decrypt: () => {
    throw new Error("this device cannot decrypt");
  }
};
const CIPHER_UNAVAILABLE: Cipher = { available: false, encrypt: (p) => p, decrypt: (t) => t };

const OLD = "C:\\appdata\\mochen-writing";
const NEW = "C:\\appdata\\mochen-ai";
const NOW = () => new Date("2026-10-02T13:14:15.000Z");

function depsOf(fs: ReturnType<typeof fakeFs>, cipher: Cipher, over: Partial<{ oldDir: string; newDir: string }> = {}) {
  return {
    oldDir: over.oldDir ?? OLD,
    newDir: over.newDir ?? NEW,
    copyFile: fs.copyFile,
    readFile: fs.readFile,
    readdir: fs.readdir,
    rename: fs.rename,
    mkdir: fs.mkdir,
    exists: fs.exists,
    cipher,
    now: NOW
  };
}
```

> `over` 只用来换 `oldDir`（造「旧目录不存在」的场景）。`newDir` 不参与造假。

八条用例：

```ts
describe("migrateLegacyAppData（F-4）", () => {
  it("旧目录不存在 ⇒ nothing-to-do，一个新字节都不写", async () => {
    const fs = fakeFs({});
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_OK, { oldDir: `${OLD}-没有东西` }));
    expect(report).toEqual({ status: "nothing-to-do" });
    expect(fs.files.size).toBe(0);
    expect([...fs.dirs].some((d) => d.includes("migrated"))).toBe(false);
  });

  it("只搬白名单三个文件：未知文件留在旧目录，一个字节都不跟", async () => {
    const fs = fakeFs({
      [`${OLD}\\config.json`]: '{"baseURL":"x","model":"y"}',
      [`${OLD}\\secrets.enc`]: "enc:sk-abc",
      [`${OLD}\\appearance.json`]: '{"mode":"dark"}',
      [`${OLD}\\来历不明.bin`]: "\u0000\u0001",
      [`${OLD}\\notes.txt`]: "别搬我"
    });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(report.status).toBe("migrated");
    expect(fs.files.has(`${NEW}\\config.json`)).toBe(true);
    expect(fs.files.has(`${NEW}\\secrets.enc`)).toBe(true);
    expect(fs.files.has(`${NEW}\\appearance.json`)).toBe(true);
    expect(fs.files.has(`${NEW}\\notes.txt`)).toBe(false);
    expect(fs.files.has(`${NEW}\\来历不明.bin`)).toBe(false);
    expect((report as { movedFiles: string[] }).movedFiles.sort()).toEqual([
      "appearance.json",
      "config.json",
      "secrets.enc"
    ]);
  });

  it("M5：解不开旧密钥 ⇒ kept-old 且旧目录名字**没被改过**（先验密、后改名）", async () => {
    const fs = fakeFs({ [`${OLD}\\config.json`]: "{}", [`${OLD}\\secrets.enc`]: "不是这台机器能解的" });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(report).toEqual({
      status: "kept-old",
      reason: "旧目录里的密钥在新目录中解不开，已保持原目录，未做任何改名。"
    });
    expect(fs.files.has(`${OLD}\\config.json`)).toBe(true);
    expect([...fs.dirs]).not.toContain(`${OLD}.migrated-2026-10-02`);
    expect((report as { reason: string }).reason.endsWith("。")).toBe(true);
  });

  it("M5 反向保护：旧目录里连一个已知文件都没有 ⇒ 无密可验，仍然改名（没东西可损失）", async () => {
    const fs = fakeFs({ [`${OLD}\\readme-用户自己的.txt`]: "自己的文件" });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(report.status).toBe("migrated");
    expect((report as { movedFiles: string[] }).movedFiles).toEqual([]);
    expect((report as { keptOldDir: string }).keptOldDir).toBe(`${OLD}.migrated-2026-10-02`);
  });

  it("裁定 4：没有 secrets.enc 但有 config.json ⇒ 视为验通过，照搬照改名", async () => {
    const fs = fakeFs({ [`${OLD}\\config.json`]: '{"model":"m"}' });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(report.status).toBe("migrated");
    expect(fs.files.has(`${NEW}\\config.json`)).toBe(true);
  });

  it("裁定 3：safeStorage 不可用 ⇒ 立刻 kept-old，不拷贝、不改名", async () => {
    const fs = fakeFs({ [`${OLD}\\config.json`]: "{}", [`${OLD}\\secrets.enc`]: "enc:x" });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_UNAVAILABLE));
    expect(report).toEqual({
      status: "kept-old",
      reason: "密钥保管当前不可用，已保持原目录，未做任何改名。"
    });
    expect(fs.files.has(`${NEW}\\config.json`)).toBe(false);
  });

  it("解密抛（不是返回空串）同样算验不过：异常绝不外漏给启动流程", async () => {
    const fs = fakeFs({ [`${OLD}\\secrets.enc`]: "坏掉的密文" });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_THROWS));
    expect(report.status).toBe("kept-old");
    expect(fs.files.has(`${OLD}\\secrets.enc`)).toBe(true);
  });

  it("幂等：新目录已有的文件一律不被覆盖，第二次跑是 nothing-to-do", async () => {
    const fs = fakeFs({
      [`${OLD}\\config.json`]: '{"model":"旧的"}',
      [`${NEW}\\config.json`]: '{"model":"新的"}'
    });
    const first = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(first.status).toBe("migrated");
    expect((first as { movedFiles: string[] }).movedFiles).toEqual([]);
    expect(fs.files.get(`${NEW}\\config.json`)).toBe('{"model":"新的"}');
    const second = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(second).toEqual({ status: "nothing-to-do" });
  });

  it("改名撞车：`.migrated-2026-10-02` 已被占用 ⇒ 追加 -HHmmss", async () => {
    const fs = fakeFs({
      [`${OLD}\\config.json`]: "{}",
      [`${OLD}.migrated-2026-10-02\\config.json`]: "上一次搬剩下的"
    });
    const report = await migrateLegacyAppData(depsOf(fs, CIPHER_OK));
    expect(report.status).toBe("migrated");
    expect((report as { keptOldDir: string }).keptOldDir).toBe(`${OLD}.migrated-2026-10-02-131415`);
    expect(fs.files.has(`${OLD}.migrated-2026-10-02-131415\\config.json`)).toBe(true);
  });
});

describe("migrationNotice（播报文案唯一实现）", () => {
  it("nothing-to-do ⇒ 不打扰：null", () => {
    expect(migrationNotice({ status: "nothing-to-do" }, { newDir: NEW })).toBeNull();
  });

  it("migrated 的句子逐字（新旧路径都由入参拼出，不写死两份）", () => {
    expect(
      migrationNotice(
        { status: "migrated", movedFiles: ["config.json"], keptOldDir: `${OLD}.migrated-2026-10-02` },
        { newDir: NEW }
      )
    ).toBe(
      "墨宸 AI 的设置目录已迁到 C:\\appdata\\mochen-ai；旧目录已保留为 C:\\appdata\\mochen-writing.migrated-2026-10-02，" +
        "确认无误后可自行删除。"
    );
  });

  it("kept-old 的句子带原因", () => {
    expect(
      migrationNotice(
        { status: "kept-old", reason: "密钥保管当前不可用，已保持原目录，未做任何改名。" },
        { newDir: NEW }
      )
    ).toBe("设置目录迁移没有进行（密钥保管当前不可用，已保持原目录，未做任何改名。），应用仍在使用旧目录。");
  });
});
```

> `movedFiles` 的顺序断言用 `.sort()`，不去赌实现按哪个顺序 push——排序类断言本就该钉集合而不是钉偶然顺序（除幂等那条：只有一个元素，无所谓）。
> 撞名那条用例同时钉住 `now()` 的作用域：只取「本地日」与「本地时分秒」，`NOW` 是 UTC 13:14:15；本机跑出的具体时刻会随 TZ 偏移，所以断言里写的是 `-131415`——**若本机的 TZ 不是 UTC**，落地时把 `NOW` 换成明确构造本地时间（`new Date(2026, 9, 2, 13, 14, 15)`），别把断言改成松散匹配。

- [ ] **Step 2：跑到红并贴出来**

Run: `corepack pnpm vitest run apps/desktop/src/main/app-data-migration.test.ts --maxWorkers=4`
Expected: 整个文件导入期失败（`app-data-migration.js` 不存在）。红必须是「找不到模块」，不是断言失败。**贴进波 3 报告**。

- [ ] **Step 3：实现 `app-data-migration.ts`**

```ts
import path from "node:path";
import type { Cipher } from "./credential-store.js";

/**
 * F-4 磁盘目录迁移：`mochen-writing` → `mochen-ai`（Plan 3 spec §12）。
 * 依赖全注入，本模块不 import electron、不在模块顶层碰 fs：这样八条时序用例才能在 node 单测里跑。
 */
export interface AppDataMigrationDeps {
  oldDir: string;
  newDir: string;
  copyFile(src: string, dest: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  cipher: Cipher;
  now?: () => Date;
  exists?(path: string): Promise<boolean>;
}

export type AppDataMigrationReport =
  | { status: "nothing-to-do" }
  | { status: "migrated"; movedFiles: string[]; keptOldDir: string }
  | { status: "kept-old"; reason: string };

/**
 * 迁移白名单：只搬这三个已知文件。这里的名字是**手抄的历史**——
 * 不 import provider-settings / credential-store 的字面量，因为盘上的历史不该跟着今天的常量漂移；
 * 未知文件（用户自己扔进目录的、别的版本写的）一律不动。
 */
const LEGACY_FILE_NAMES = ["config.json", "secrets.enc", "appearance.json"] as const;

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function migrationNotice(
  report: AppDataMigrationReport,
  dirs: { newDir: string }
): string | null {
  if (report.status === "nothing-to-do") return null;
  if (report.status === "kept-old")
    return `设置目录迁移没有进行（${report.reason}），应用仍在使用旧目录。`;
  return (
    `墨宸 AI 的设置目录已迁到 ${dirs.newDir}；旧目录已保留为 ${report.keptOldDir}，` +
    "确认无误后可自行删除。"
  );
}
```

（`migrationNotice` 要收 `dirs` 是因为 `migrated` 那句需要新目录名，而报告体里没有它——让调用方传一次，比在报告里塞一份重复路径更干净。Step 1 的三条文案用例已按这个签名写。）

主体：

```ts
export async function migrateLegacyAppData(
  deps: AppDataMigrationDeps
): Promise<AppDataMigrationReport> {
  const now = deps.now ?? (() => new Date());
  const exists =
    deps.exists ??
    (async (p: string) => {
      try {
        await deps.readdir(p);
        return true;
      } catch {
        return false;
      }
    });

  // ① 没有旧目录 = 新装用户或已迁移过，什么都不做（重复运行安全）。
  if (!(await exists(deps.oldDir))) return { status: "nothing-to-do" };

  // ③ 提前到拷贝之前：safeStorage 不可用时连拷贝都不做（裁定 3）。
  if (deps.cipher.available === false)
    return {
      status: "kept-old",
      reason: "密钥保管当前不可用，已保持原目录，未做任何改名。"
    };

  // ② 只搬白名单，且永不覆盖新目录已有的文件（幂等：旧的不可能比新的新）。
  await deps.mkdir(deps.newDir);
  const movedFiles: string[] = [];
  for (const name of LEGACY_FILE_NAMES) {
    const from = path.join(deps.oldDir, name);
    const to = path.join(deps.newDir, name);
    if (!(await existsFile(deps, from))) continue;
    if (await existsFile(deps, to)) continue;
    await deps.copyFile(from, to);
    movedFiles.push(name);
  }

  // ③ 验密：读**新目录**的 secrets.enc 并解出非空。缺文件算通过（裁定 4）。
  const newSecrets = path.join(deps.newDir, "secrets.enc");
  let sealed: string;
  try {
    sealed = await deps.readFile(newSecrets);
  } catch (error) {
    if (isNotFound(error)) sealed = "";
    else return { status: "kept-old", reason: "新目录里的密钥文件读不出来，已保持原目录，未做任何改名。" };
  }
  if (sealed !== "") {
    let plain = "";
    try {
      plain = deps.cipher.decrypt(sealed);
    } catch {
      plain = "";
    }
    if (plain === "")
      return {
        status: "kept-old",
        reason: "旧目录里的密钥在新目录中解不开，已保持原目录，未做任何改名。"
      };
  }

  // ④ 验过了才改名。旧目录**只改名、永不删除**。
  const base = `${deps.oldDir}.migrated-${localDate(now())}`;
  const keptOldDir = (await existsFile(deps, base)) ? `${base}-${localClock(now())}` : base;
  await deps.rename(deps.oldDir, keptOldDir);
  return { status: "migrated", movedFiles, keptOldDir };
}

/** 白名单只有单层文件名，所以「存在」= 父目录 readdir 里有它。不引 node:fs 的 stat，少一个注入点。 */
async function existsFile(deps: AppDataMigrationDeps, file: string): Promise<boolean> {
  try {
    const list = await deps.readdir(path.dirname(file));
    return list.includes(file);
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
```

三条实现要点：

- `exists(deps.oldDir)` 走注入的 `exists`；缺省实现是 `readdir` 试探（目录才谈得上「存在」）。**不要**在本模块 import `node:fs` ——`tools/check-package-boundary.mjs` 管不到 `apps/desktop`，但「依赖全注入、可在 node 单测里跑遍八条时序」是本模块存在的理由。
- `existsFile` 用 `readdir(父目录)` 而不是 `readFile` 试探：拷贝前的「目标已存在」判断必须能区分「文件在」与「读不动」，用 readFile 试探会把 EBUSY 误判成不存在，然后覆盖掉一个只是被占用的文件。
- 每一步的**抛错都不吞**（`copyFile`/`rename` 失败 ⇒ 冒到 `index.ts` 的 catch，由它报「迁移没进行」）。只有 IO 的「没有这个东西」（ENOENT）与解密的失败被转成报告值。

- [ ] **Step 4：跑到绿**

Run: `corepack pnpm vitest run apps/desktop/src/main/app-data-migration.test.ts --maxWorkers=4`
Expected: 12 条全绿（九条迁移 + 三条文案）。若 `M5` 那条与「M5 反向保护」打架，说明顺序写错了：`kept-old` 的两个分支必须都在 `rename` 之前 return。

- [ ] **Step 5：`index.ts` 接线（弹窗真机可见，代码不测）**

改 `apps/desktop/src/main/index.ts`：

```ts
import { migrateLegacyAppData, migrationNotice } from "./app-data-migration.js";
```

`app.whenReady().then(() => {` 改成 `app.whenReady().then(async () => {`（迁移是异步的；不改 async 就是「下次启动才生效」，正是 spec §12 末段点名的坑）。第 43 行那两行替换为：

```ts
  const appDataBase = app.getPath("appData");
  const legacyDir = path.join(appDataBase, "mochen-writing");
  const targetDir = path.join(appDataBase, "mochen-ai");
  let secretDir = targetDir;
  try {
    const report = await migrateLegacyAppData({
      oldDir: legacyDir,
      newDir: targetDir,
      copyFile: copyFile,
      readFile: (p) => readFile(p, "utf8"),
      readdir: (p) => readdir(p, { withFileTypes: true }).then((entries) =>
        entries.map((entry) => path.join(p, entry.name))
      ),
      rename: (from, to) => rename(from, to),
      mkdir: (p) => mkdir(p, { recursive: true }),
      exists: async (p) => readdir(p).then(() => true, () => false),
      cipher: electronCipher(safeStorage)
    });
    // 裁定 5：kept-old 时应用必须真的继续用旧目录，否则那句「仍在使用旧目录」是假话。
    if (report.status === "kept-old") secretDir = legacyDir;
    const notice = migrationNotice(report, { newDir: targetDir });
    if (notice !== null) {
      await dialog.showMessageBox({ type: "info", message: "墨宸 AI", detail: notice, buttons: ["知道了"] });
    }
  } catch (error) {
    // 迁移整段是尽力而为：任何意外都不该挡住启动，但也不能静默——用同一句式样告诉用户。
    secretDir = legacyDir;
    const reason = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox({
      type: "warning",
      message: "墨宸 AI",
      detail: `设置目录迁移没有进行（${reason}），应用仍在使用旧目录。`,
      buttons: ["知道了"]
    });
  }
  const credentials = createCredentialStore(secretDir, electronCipher(safeStorage));
```

顶部 `import { mkdir, readdir, copyFile, rename } from "node:fs/promises";`（现文件没有 fs import，加一行）。

> `readdir` 的两种返回形状（裸名 vs 全路径）在 `existsFile` 与 `exists` 里必须一致：**统一返回全路径**（如上面 `withFileTypes` 那支所示），并在 Step 1 的 `fakeFs.readdir` 里同样返回全路径键。这条形状不一致是「测试绿、真机不搬」的经典来源，Step 3 的实现与假 fs 用的是同一份约定。
> `dialog.showMessageBox` 在 `whenReady` 里、`BrowserWindow` 创建**之后**（现文件顺序如此），所以弹窗有父窗口之外的形态问题；本任务不传 `parentWindow`——迁移失败时窗口可能还没 `ready-to-show`，不绑更稳。测试里永不触到它（全局约束）。

Run: `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: 0（`dialog` 已在文件顶部 import；`electron-cipher.ts` 的 `electronCipher` 也在）。注意 `electronCipher(safeStorage)` 被调两次是允许的（它只是把接口包一层），但更干净的是提成 `const cipher = electronCipher(safeStorage);` 用两处——**照这个做**。

- [ ] **Step 6：M5 变异（本任务的台账条）**

台账 M5 的动作：**调换步骤 3 与 4 的先后**——把 `rename` 那段搬到验密之前。

```
corepack pnpm vitest run apps/desktop/src/main/app-data-migration.test.ts --maxWorkers=4
```
Expected 红：`M5：解不开旧密钥 ⇒ kept-old 且旧目录名字**没被改过**` 这条（`fs.dirs` 里出现了 `.migrated-2026-10-02`）。改回来（只用 Edit），复跑到绿。

补一条自加变异 **S3**（Task 27 台账单列）：把 `if (await existsFile(deps, to)) continue;` 那行删掉（新目录已有文件也被覆盖）。Expected 红：`幂等：新目录已有的文件一律不被覆盖`。改回来。

- [ ] **Step 7：全量门禁**

```bash
corepack pnpm verify 2>&1 | tee /tmp/plan3-t25-verify.log; echo "VERIFY_PIPESTATUS=${PIPESTATUS[0]}"
grep -c "VERIFY_EXIT=0" /tmp/plan3-t25-verify.log
grep -E "Test Files|Tests " /tmp/plan3-t25-verify.log
node tools/check-package-boundary.mjs && node tools/check-source-line-budget.mjs
```

Expected: `VERIFY_EXIT=0`；用例数比 Task 24 净增 ≥ 12（本任务 12 条）；`index.ts` 仍 ≤ 800 行（现 ~70 行，加完约 110）。

- [ ] **Step 8：真机复验（三项，主会话亲手做，不委托）**

这一步涉及改本机 `%APPDATA%`，动手前先把两条路径报给用户看一眼再跑（属「影响共享状态」的动作）：

1. **有旧数据**：手动在 `%APPDATA%\mochen-writing\` 放一份 `config.json`（真 baseURL + 模型名，**不含密钥**）与一份真 `secrets.enc`（在应用里存一次密钥得到）。启动 → 弹一次中文告知 → 设置里 baseURL/模型/密钥掩码都在，`%APPDATA%\mochen-ai\` 三件齐，旧目录变成 `mochen-writing.migrated-2026-10-02`。**再启动一次** ⇒ 不再弹（`nothing-to-do`）。
2. **无旧数据**：把 migrated 目录临时改名挪走、旧目录不存在 → 启动 → 不弹任何窗，`mochen-ai` 正常创建。
3. **验不过**：把 `mochen-writing\secrets.enc` 换成一句明显不是本机密文的串 → 启动 → 弹「设置目录迁移没有进行（旧目录里的密钥在新目录中解不开…）」，且**旧目录名未被改**、应用仍读到旧 `config.json`。测完把这颗假密文删掉。

冒烟里出现过的密钥串照全局约束处理：轮换，并在波 3 报告记「已提醒轮换」。

- [ ] **Step 9：提交**

```bash
git add apps/desktop/src/main/app-data-migration.ts apps/desktop/src/main/app-data-migration.test.ts \
  apps/desktop/src/main/index.ts
git commit -m "feat(main): F-4 设置目录迁移 mochen-writing → mochen-ai（先验密后改名）"
git status --short
```

---

## 留底（写进波 3 报告）

- **旧目录永不删除**：报告类型里没有「已删除」这个码，用户要清盘自己删（弹窗那句话就是这么说的）。
- `LEGACY_FILE_NAMES` 是对 `credential-store.ts:28` / `provider-settings.ts:26` 两处字面量的**有意手抄**：迁移面向盘上历史，不跟着今天的常量走。若将来文件名再改，本模块要加的是「第二跳」，不是改这里。
- 本任务只搬那三个已知文件。用户在 `%APPDATA%\mochen-writing\` 里自己放的东西（有人这么干过）留在改名后的目录里，靠弹窗那句话自取。
- 文档同步（总 spec §8/§3 的路径、`plans/README.md` 的 F-4 勾掉、Plan 2 冒烟报告的更正注）在 **Task 26**，本任务的提交不含 `.md`。

### Task 26：F-4 文档同步（总 spec 路径、README 缺口清单勾销、Plan 2 冒烟报告就地更正注、代码残留清点）

> 前置：Task 25 已把 `index.ts` 的字面量改成 `mochen-ai` 并落了迁移。本任务**只动 `.md`**，不动任何 `.ts`/`.vue`/`.mjs`。
>
> 分工口径：`docs/superpowers/plans/README.md` 的**缺口清单勾销与 Plan 3 索引行**归本任务；Task 27 只在波 3 冒烟通过后把索引行的状态词补成「已完成」并挂上波 3 报告指针，其余一个字不动。波 1、波 2 的草稿都没碰过 README，所以这里是它唯一的更新点。

**Files:**

- Modify: `docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md:96`、`:233`（总 spec 的两处**现状**路径）
- Modify: `docs/superpowers/plans/README.md:10-18`（Plan 3 索引行）、`:25-26`（F-4 勾销）、`:28-30`（F-6 勾销）
- Modify: `docs/superpowers/plans/2026-10-02-plan2-smoke-report.md:62`（F-4 行就地加更正注）

---

## 动手前必读：三条边界

1. **只改「现状」表述，不改写历史结论**。总 spec 里那两行是对**当前实现**的描述（凭据放哪、技能放哪），改成新路径是对的；但 Plan 1/Plan 2 计划正文里的历史引述、`.superpowers/sdd/**` 里的执行台账与 brief、Plan 2 冒烟报告 F-4 那条**裁定本身**一律不动——它们是「当时怎么决定的」的证据，改了就是篡改历史。冒烟报告只允许**就地追加一句更正注**，原句一个字不删。
2. **不改文件名**。总 spec 的文件名 `2026-10-01-mochen-writing-workbench-design.md` 里带旧品牌串，但它是十几处交叉引用的目标；重命名会制造断链，而它不是用户可见路径。**留在原地**，本任务的第一条 grep 门禁要把它排除在外（见 Step 5 的豁免清单）。
3. **prettier 管 `.md`**。`corepack pnpm verify` 的第一步是 `prettier . --check`，所以每个改过的 `.md` 都要过 prettier；不要手动猜换行，直接 `corepack pnpm format` 再回读 diff（本仓 md 的 `proseWrap` 是 preserve，prettier 不会重排中文句子，只会规范列表与代码块）。

---

- [ ] **Step 1：总 spec 的两处现状路径**

`docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md` 第 96 行，现文本：

```markdown
技能库：全局 `~/.mochen-writing/skills/<名>/SKILL.md` + 书内 `.mochen/skills/`，
```

改成（保持它在段落中的换行位置，行尾那个逗号是原文续行的标点，别丢）：

```markdown
技能库：全局 `%APPDATA%\mochen-ai\skills\<名>\SKILL.md` + 书内 `.mochen/skills/`，
```

第 233 行，现文本：

```markdown
- 模型凭据只进主进程：`%APPDATA%\mochen-writing\secrets.enc`，Electron `safeStorage`（Windows DPAPI）。
```

改成（同一行放得下就不折行；句子仍以句号收尾）：

```markdown
- 模型凭据只进主进程：`%APPDATA%\mochen-ai\secrets.enc`，Electron `safeStorage`（Windows DPAPI）。
  旧路径 `mochen-writing` 是品牌改名前的遗留，Plan 3 起由启动时自动搬迁（只搬 `config.json`/`secrets.enc`/`appearance.json`，
  验密通过才把旧目录改名为 `mochen-writing.migrated-<日期>`，**永不删除**）。
```

两条改动的**理由句**（为什么带迁移说明）写在下一行的缩进续行里，不新开小节——总 spec §8 是「现状描述」，迁移属于现状的一部分。

Run: `grep -n "mochen-writing" docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md`
Expected: 只剩 ①文件名自身所在行（若该文件里引用了自己的名字）、②第 233 行新加的迁移说明里那两处刻意保留的旧串。除此之外零命中。**把这条命令的输出贴进报告**——它是「历史结论没被偷偷抹掉、现状表述已改净」的唯一证据。

- [ ] **Step 2：Plan 2 冒烟报告就地加更正注**

`docs/superpowers/plans/2026-10-02-plan2-smoke-report.md:62` 是一个 bullet，现以「…属不可逆动作。」收尾。在**同一行末尾**追加一句，原文一字不删：

```markdown
 【Plan 3 波 3 已处理：`2026-10-02-plan3-wave3-report.md` 的「F-4」节——迁移带验密、旧目录只改名不删除。】
```

同文件第 55 行一带的「未做留底」小节若另列了 F-4，也照同样姿势就地加注；没有就不动。**不要**新建小节、不要改这一节标题、不要调整任何一条 F 的排序。

Run: `grep -n "F-4" docs/superpowers/plans/2026-10-02-plan2-smoke-report.md`
Expected: 每条 F-4 命中行后面都跟着那句更正注（或有明确理由不改，写进报告）。

- [ ] **Step 3：README 缺口清单勾销**

`docs/superpowers/plans/README.md` 第 25-26 行（F-4）现文本：

```markdown
- **F-4（P2，品牌残留）**：用户可见磁盘路径仍是 `appData/mochen-writing`；改名须连带迁移 safeStorage 密文，
  所以留 Plan 3 与目录迁移一起做（原文见 `2026-10-02-plan2-smoke-report.md` 的 F-4 条）。
```

改成（勾销用删除线 + 一句结论，保留原句当证据；这份清单的价值在于「我们知道欠过什么」）：

```markdown
- ~~**F-4（P2，品牌残留）**~~ **已闭合（Plan 3 波 3 / Task 25）**：用户可见磁盘路径已是 `appData/mochen-ai`；
  启动时按「先拷已知三件 → 验密 → 才改名」搬迁，旧目录变成 `mochen-writing.migrated-<日期>` 且不删除。
  实现与测试见 `apps/desktop/src/main/app-data-migration.ts`，逐条观测见 `2026-10-02-plan3-wave3-report.md` 的「F-4」节；
  原文（含当初为什么不当场改名）见 `2026-10-02-plan2-smoke-report.md` 的 F-4 条。
```

第 28-30 行（F-6）同样处理，**但结论必须回真凭报告写**。先确认波 1/波 2 报告的真名与内容：本仓现在只有 `docs/superpowers/plans/2026-10-02-plan2-smoke-report.md` 一份报告，Plan 3 的三波报告（`2026-10-02-plan3-wave1-report.md` 等）由 Task 10 / Task 20 / Task 27 各自收尾时落盘——动手前 `ls docs/superpowers/plans/` 按实际存在的文件名写引用，**报告不在就把引用写成「待波 N 报告」**，不许凭空指路径。然后确认「重启后中栏回放了历史线程与提案卡、未裁决旧卡标成 `expired` 且按钮禁用」这一项在波 1 报告里被逐条勾过，再改成：

```markdown
- ~~**F-6（P2，能力缺口）**~~ **已闭合（Plan 3 波 1 / Task 1–5）**：重启后中栏按 JSONL 如实回放，
  未裁决的旧卡一律 `expired`（单独分组、按钮禁用），不复活可批准的待审队列。
  证据：`2026-10-02-plan3-wave1-report.md` 的回放小节 + `apps/desktop/src/main/agent-service.ts` 的 `loadSession`。
```

若波 1 报告里那一项是「未做留底」而不是「真机通过」，**这条 F-6 就不许勾**——把上面的闭合句换成一句实话：「Plan 3 波 1 落了 `loadSession` 与回放归约，真机复验见波 N 报告」，并照实写它当时的留底原因。清单不许比报告更乐观。

同文件第 32-35 行的「波 A 评审延后的四条 P3」小节：逐条对照 Plan 3 三波报告，**只在报告里有真凭据时**才在句尾加「（Plan 3 Task N 已做）」。四条里预期至少「切档后再批准缺 UI 入口 / 切换器本身」这条会闭合（Task 17 权限档 + Task 18 阶段与档案选择器）；拿不到证据的一律不动。

- [ ] **Step 4：README 的 Plan 3 索引行**

第 10-18 行现在写着 `- Plan 3（待写）：…`。改成实指本计划文件，并把「待写」删掉（**本任务不写「已完成」**——那是 Task 27 收尾时的措辞，取决于波 3 真机结果）：

```markdown
- Plan 3（本目录 `2026-10-02-plan3-interaction-and-assembly.md`）：S5 交互层 + S6 装配层 + F-4 磁盘迁移，
  27 任务 / 三波（波 1 回放与键位、波 2 档案与外观与权限档、波 3 技能库与 F-4 与全链收口）。
  智能体侧按总 spec §5.1 的墨宸花名册实现六个 `AgentProfile`，工具**仍只有 5 个**。
  依赖 Plan 2 的 `useAgentStore`（事件归约为唯一真相）与主进程 `agent-service`（唯一写盘通路）。
  逐波观测：`2026-10-02-plan3-wave1-report.md` / `-wave2-report.md` / `-wave3-report.md`；
  变异台账 M1–M12 与三处计划级改写（通道计数 12→19、`DEFAULT_PROFILE_ID` 的 `""` 哨兵口径、
  `CONTEXT_SECTION_KIND_LABELS` 落 contracts）落在本计划文件与波 3 报告。
```

原先第 13-18 行那两条「已由控制方拍板」的口径（① 主题三态不硬锁深色、② 品牌图原样使用）**保留原文不删**，挪到这段索引行的下方继续存在——它们是跨波次都有效的约束，不是待办。措辞上把「Plan 3 要加的是」改成「Plan 3 已加的是」（Task 19 落地后为真）。

Run: `grep -n "待写" docs/superpowers/plans/README.md`
Expected: 零命中。

- [ ] **Step 5：代码与文档残留清点（含豁免清单）**

```bash
grep -rn "mochen-writing" apps packages tools docs --include=*.ts --include=*.tsx --include=*.vue --include=*.mjs --include=*.json
```

Expected: **只有** `apps/desktop/src/main/app-data-migration.ts` 与它的测试命中（迁移模块必须知道旧名字），且每处都在注释或测试常量里。若有别的命中 ⇒ 那是真残留，逐个改；改不动的（例如某个测试在验旧行为）在报告里点名说明为什么留。

```bash
grep -rn "mochen-writing" docs/superpowers/specs docs/superpowers/plans/*.md
```

Expected 命中且**允许**命中，共四类，报告里按这四类各列一行：
① 总 spec 第 233 行新写的迁移说明（刻意保留旧串当历史锚点）；
② `docs/superpowers/plans/README.md` 的 F-4 闭合句与被划掉的旧句；
③ Plan 1/Plan 2 **计划正文**与 Plan 2 冒烟报告里的历史引述（含边界 2 说的 spec 文件名本身）——按 spec §12 一律不动；
④ 本计划文件（`2026-10-02-plan3-interaction-and-assembly.md`）与三波报告里描述迁移的段落。

构建产物不算残留，但要确认它不会被误当源码扫到：

```bash
git check-ignore -v apps/desktop/out/main/index.js || echo "NOT-IGNORED"
```

Expected: 打印忽略规则（`out/` 在 `.gitignore` 里）。若输出 `NOT-IGNORED`，**停**：那说明构建产物被纳入版本控制，本任务不擅自改 `.gitignore`，把它写进报告作为一条新发现（F-7 级别），交给用户定夺。

`.superpowers/sdd/**`（执行台账、brief、评审 diff）**一律不动**：那是过程证据，不是产品文档。

- [ ] **Step 6：prettier 与全量门禁**

```bash
corepack pnpm format docs 2>/dev/null || corepack pnpm exec prettier --write docs
corepack pnpm verify 2>&1 | tee /tmp/plan3-t26-verify.log; echo "VERIFY_PIPESTATUS=${PIPESTATUS[0]}"
grep -c "VERIFY_EXIT=0" /tmp/plan3-t26-verify.log
grep -E "Test Files|Tests " /tmp/plan3-t26-verify.log
git diff --stat
```

Expected: `VERIFY_EXIT=0`；用例数与 Task 25 收尾时**一字不差**（本任务零测试增减，这是「文档任务没夹带代码改动」的硬证据）；`git diff --stat` 只列出 `.md` 文件。
若 `corepack pnpm format docs` 因根脚本不接受参数而失败，走后半那条 `prettier --write docs`（`package.json` 的 `format` 是无参数 `prettier . --write`，会顺手格式化全仓——那就改用 `corepack pnpm exec prettier --write docs`，并在报告里记一句为什么没用 `pnpm format`）。

- [ ] **Step 7：提交**

```bash
git add docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md \
  docs/superpowers/plans/README.md \
  docs/superpowers/plans/2026-10-02-plan2-smoke-report.md
git commit -m "docs(plan3): F-4 路径同步与缺口清单勾销，Plan 3 索引行落定"
git status --short
```

Expected: 工作树干净。`git show --stat HEAD` 必须只有那三个 `.md`；多一个文件就是夹带，回退重做（`git reset --soft HEAD^` 后重新 `git add`——**不许** `--hard`）。

---

## 留底（写进波 3 报告）

- **spec 文件名不改**：`2026-10-01-mochen-writing-workbench-design.md` 里的旧品牌串是文件名，不是用户可见路径；改它要连带重写十几处交叉引用，收益为零。留底即「我们清楚这里还留着，并且是有意的」。
- **`out/` 构建产物**里的旧串在 `pnpm build` 后自动消失，不手改。
- README 缺口清单用删除线而不是删除：**这份清单的意义是「我们欠过什么、凭什么说还清了」**，抹掉原句会让下一个读者无从对账。
- 本任务的用例数「一字不差」是最要紧的一道门禁：文档任务夹带代码改动，在 Plan 2 波 B 真发生过（评审抓到过一次），这里用计数把它挡在外面。

### Task 27：波 3 收口 —— 全链 e2e 扩案（档案 / 技能挂入 / 迁移 / 回放）+ 门禁 + M1–M12 台账 + Plan 3 冒烟报告

> 前置：Task 21–26 全部合入。本任务是 Plan 3 spec §3 波 3 的第 27 项，也是整片的总账：§16 冒烟清单的第 8、9 项在这里做，第 1–7 项做**跨波回归抽查**（波 3 动了装配链与启动链，回放与档案不能回退）。

**Files:**

- Modify: `apps/desktop/src/main/turn-e2e.test.ts`（现 297 行，Plan 3 之后约 320；本任务净增 ~180 行，仍远低于 800 行门禁。**扩这个文件而不是新建 `plan3-e2e.test.ts`**：`build()` 里那套「真子进程 mock-provider + 真 fs-store 写盘 + 真 credential store + base64url 假 cipher」的夹具是全仓唯一的，复制一份等于多一处会漂移的密钥泄漏面判据）
- Create: `docs/superpowers/plans/2026-10-02-plan3-wave3-report.md`
- Modify: `docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md`（勾波 3 已验证的复选框）
- Modify: `docs/superpowers/plans/README.md`（**只改两处**：Plan 3 索引行的状态词与波 3 报告指针；缺口清单归 Task 26）

**Interfaces:**

- Consumes：Task 16 的 `createBookPromptAssembler`（`build()` 里 `promptFor: defaultPromptFor` 已在 Task 16 换掉，本任务只补 `reader`）、Task 15/24 的 `createFsContextReader({ book, skills })`、Task 22 的 `createSkillsService`、Task 24 的 `AssembledPrompt` 与那句中文 error、Task 25 的 `migrateLegacyAppData`、Task 5 的 `loadSession` 通路。
- Produces：无新对外接口。产出是**证据**：e2e 用例、门禁数字、变异台账、冒烟报告。

---

- [ ] **Step 1：夹具连带（先把 `build()` 升到波 3 形状，跑既有绿）**

`turn-e2e.test.ts` 的 `build()` 现在长这样（`:140-143`）：`promptFor: defaultPromptFor` 已被 Task 16 换成装配器、`createAgentService({...})` 已有 `reader`。本步骤只做三件事，**做完必须既有全部 e2e 用例仍绿**：

1. `build(over?: { skillsAt?: "book" | "global" | "none" })`：多一个可选参数决定技能库放哪，默认 `"none"`（既有调用点一字不改照样绿）。
   - `skillsAt: "book"` ⇒ 在书根里 `mkdir(path.join(dir, ".mochen/skills/伏笔登记"))` 并写 `SKILL.md`：
     ```
     ---
     name: 伏笔登记
     stage: draft
     ---

     技能正文哨兵：埋设必登记，回收必标注。
     ```
     （`技能正文哨兵：` 这个前缀是本文件专用的探针串，断言只认它，不认整句。）
   - `skillsAt: "global"` ⇒ 在 `secretDir` 下建 `skills/对白压缩/SKILL.md`，正文 `技能正文哨兵：对白不解释动作。`（全局库目录 = `path.join(secretDir, "skills")`，与 `index.ts` 的 `<appData>/mochen-ai/skills/` 同构）。
2. `createSkillsService({ globalDir: path.join(secretDir, "skills"), bookRoot: () => book.current()?.rootPath ?? null })` 造**一个**实例，同时喂 `createFsContextReader({ book, skills })`（与 Task 24 Step 7 的生产接线同形状：一个实例、两处消费）。
3. `turn()` 助手（`:147`）补波 2/3 的两个必填字段，并加一个可选参数：

```ts
function turn(
  docRelPath: string | null,
  userText: string,
  over: Partial<Pick<StartTurnInput, "profileId" | "skillPaths">> = {}
): StartTurnInput {
  return {
    threadKey: docRelPath ?? "unbound",
    docRelPath,
    stageId: "draft",
    userText,
    profileId: over.profileId ?? "writer",
    skillPaths: over.skillPaths ?? []
  };
}
```

> `build()` 的返回值要多带三样：`dir` 已有，补 `skills`（那个实例）与 `reader`，Step 4 的迁移用例要拿 `secretDir` 重建 store（`secretDir` 已在返回值里）。

Run: `corepack pnpm vitest run apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4`
Expected: 既有 e2e 用例**全绿**（这一步是纯连带，没有新断言；红就说明 Step 1 动了生产语义，回去看 Task 16/24 的落地件而不是改测试）。

- [ ] **Step 2：用例 A —— 档案真的换了请求（e2e 版的 M7 证据）**

先确认桩真的把 system 与 tools 记进 `/__requests`（Task 20 已扩）：

```ts
/** 取桩侧收到的请求；每条都带 system / systemChars / toolNames（Task 20 扩的三项）。 */
async function requests(): Promise<
  { system: string; systemChars: number; toolNames: string[]; hasAuth: boolean }[]
> {
  const response = await fetch(`http://127.0.0.1:${port}/__requests`);
  return (await response.json()) as { system: string; systemChars: number; toolNames: string[]; hasAuth: boolean }[];
}
```

```ts
describe("端到端：六个档案确实改变请求", () => {
  it("逐个档案发一轮：system 各异、写档含 write_doc、只读两档不含", async () => {
    const { service } = await build();
    const roster = ["world", "chief-editor", "character", "writer", "continuator", "reviewer"];
    const first = (await requests()).length;
    for (const profileId of roster) {
      await service.startTurn(turn(CHAPTER, "随便说一句", { profileId }));
    }
    const seen = (await requests()).slice(first);
    // 每档至少一轮；工具循环会有回投轮，所以判「包含」而不是判「恰好六条」
    expect(seen.length).toBeGreaterThanOrEqual(6);
    for (const profileId of roster) {
      const hit = seen.filter((item) => item.system.includes(PROFILE_MARKERS[profileId]));
      expect(hit.length, `档案 ${profileId} 的 system 一次都没出现`).toBeGreaterThan(0);
    }
    const writable = seen.filter((item) => item.system.includes(PROFILE_MARKERS.writer));
    const readonly = seen.filter((item) => item.system.includes(PROFILE_MARKERS.reviewer));
    expect(writable[0]?.toolNames).toContain("write_doc");
    expect(readonly[0]?.toolNames).not.toContain("write_doc");
    expect(new Set(seen.flatMap((item) => item.toolNames)).size).toBeLessThanOrEqual(5);
  });
});
```

`PROFILE_MARKERS` 是**模块顶上的常量表**，值取 Task 13 落地的六个 `displayName`（动手前 `grep -n "displayName:" packages/agent-runtime/src/profiles.ts` 回读六条原文，逐字抄，别凭记忆写）：

```ts
/** 六档案的 system 指纹：值 = profiles.ts 的 displayName，逐字回读，不手造第二份。 */
const PROFILE_MARKERS: Record<string, string> = {
  world: "墨宸 · 世界",
  "chief-editor": "墨宸 · 总编",
  character: "墨宸 · 角色",
  writer: "墨宸 · 主笔",
  continuator: "墨宸 · 续写",
  reviewer: "墨宸 · 审稿"
};
```

三条断言各自的失败意义（报告里要照这个说法写，不许只写「绿了」）：
- `hit.length > 0` 红 ⇒ 档案没进 system（装配链断了或 `profileId` 被丢弃）；
- `readonly` 含 `write_doc` 红 ⇒ M7 的请求侧闸失效，模型被**告知**它能写；
- `new Set(...).size <= 5` 红 ⇒ 出现了第 6 个工具名，违反铁律「工具集只有 5 个」。

Run: `corepack pnpm vitest run apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4`
Expected: 这条用例绿。红则先判是不是 `defaultPromptFor` 残留在别处（`grep -rn "defaultPromptFor" apps packages` 必须零命中）。

- [ ] **Step 3：用例 B —— 挂入技能真进 system，坏标识落那句中文 error 并随 JSONL 落盘**

```ts
/** 拿最新会话的相对路径：宁要一句中文的硬失败，也不要 `as string` 把 null 混过去。 */
async function latestSessionOf(dir: string): Promise<string> {
  const found = await findLatestSession(dir);
  if (found === null) throw new Error("e2e 夹具：这一轮没有落盘会话");
  return found;
}

describe("端到端：挂入技能进上下文，读不到的可见", () => {
  it("书内技能：正文哨兵出现在 system 里，且 JSONL 里没有多余 error", async () => {
    const { dir, service } = await build({ skillsAt: "book" });
    const first = (await requests()).length;
    await service.startTurn(turn(CHAPTER, "按伏笔登记的规矩看看", { skillPaths: ["book:伏笔登记"] }));
    const sent = (await requests()).slice(first);
    expect(sent.some((item) => item.system.includes("技能正文哨兵：埋设必登记，回收必标注。"))).toBe(true);
    const session = await latestSessionOf(dir);
    const { events } = await readSession(dir, session);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });

  it("坏标识：本轮照常跑完，会话里多一句逐字中文 error，重启读回来还是这一句", async () => {
    const { dir, service, outbound } = await build({ skillsAt: "book" });
    await service.startTurn(turn(CHAPTER, "挂着但不存在", { skillPaths: ["book:查无此技能"] }));
    const errors = eventsOf(outbound).filter((event) => event.type === "error");
    expect(errors.map((event) => (event.type === "error" ? event.message : ""))).toContain(
      "有 1 个挂入技能读不到，已跳过：book:查无此技能。"
    );
    expect(lastTurnEnd(outbound)?.status).toBeDefined();
    // 落盘复验：可见性不能只活在内存里，否则重启后用户以为什么都没发生过
    const session = await latestSessionOf(dir);
    const { events } = await readSession(dir, session);
    expect(
      events.some(
        (event) =>
          event.type === "error" &&
          event.message === "有 1 个挂入技能读不到，已跳过：book:查无此技能。"
      )
    ).toBe(true);
  });

  it("全局技能：书外目录读得到，且不因未开书而失败", async () => {
    const { service } = await build({ skillsAt: "global" });
    const first = (await requests()).length;
    await service.startTurn(turn(null, "压一下对白", { skillPaths: ["global:对白压缩"] }));
    const sent = (await requests()).slice(first);
    expect(sent.some((item) => item.system.includes("技能正文哨兵：对白不解释动作。"))).toBe(true);
  });

  it("越界标识绝不读上书外的东西：../../etc 形态的 id 只被当形状不对拒掉", async () => {
    const { service, outbound } = await build({ skillsAt: "book" });
    await service.startTurn(turn(CHAPTER, "试着越界", { skillPaths: ["book:../secrets"] }));
    expect(eventsOf(outbound).some((event) => event.type === "error")).toBe(true);
    const first = (await requests()).length;
    await service.startTurn(turn(CHAPTER, "再来一轮", { skillPaths: ["book:../secrets"] }));
    expect(
      (await requests()).slice(first).some((item) => item.system.includes("技能正文哨兵"))
    ).toBe(false);
  });
});
```

> 第四条是**跨层的合取断言**：Task 22 的 M10（路径不越界）与 Task 24 的 `skillRefOf` 形状闸，谁失效它红。单看任何一层都判不出「越界的串被当成正常技能读进来了」，所以这条必须在 e2e。
> `findLatestSession` / `readSession` 的真实签名照 `packages/agent-runtime/src/rollout.ts` 落地件（本文件顶部已 import）；若那一对的参数是 `BookService` 或 `{ root }` 而不是 `(dir, relPath)`，**照落地件改调用**，不改 rollout。

Run: `corepack pnpm vitest run apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4`
Expected: 四条全绿。**逐条贴出绿**；任何一条开局红都在实现里修，不许放宽断言（尤其不许把 `toContain(那句中文)` 改成 `toMatch(/挂入技能/)`——整句是 Task 24 定稿的契约）。

- [ ] **Step 4：用例 C —— F-4 迁移串到全链（迁完还能解密、掩码不变、旧目录只改名）**

```ts
describe("端到端：F-4 迁移后凭据仍可用", () => {
  it("旧目录里的 config+secrets 迁到新目录，用新目录重建设置后掩码一字不变，且旧目录只是改了名", async () => {
    const legacyDir = await mkdtemp(path.join(tmpdir(), "mochen-e2e-legacy-"));
    const base = await mkdtemp(path.join(tmpdir(), "mochen-e2e-base-"));
    tempDirs.push(legacyDir, base);
    const newDir = path.join(base, "mochen-ai");
    const cipher = {
      available: true,
      encrypt: (plain: string) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
      decrypt: (text: string) => Buffer.from(text.slice(4), "base64url").toString("utf8")
    };
    // 先在旧目录里存一次真凭据（走生产通路，不手写字节）
    await mkdir(legacyDir, { recursive: true });
    const legacyCreds = createCredentialStore(legacyDir, cipher);
    await legacyCreds.save(API_KEY);
    await writeFile(
      path.join(legacyDir, "config.json"),
      JSON.stringify({ baseURL: `http://127.0.0.1:${port}/v1`, model: "mochen-mock" }),
      "utf8"
    );
    const report = await migrateLegacyAppData({
      oldDir: legacyDir,
      newDir,
      copyFile: (from, to) => copyFile(from, to),
      readFile: (p) => readFile(p, "utf8"),
      readdir: (p) => readdir(p, { withFileTypes: true }).then((e) => e.map((x) => path.join(p, x.name))),
      rename: (from, to) => rename(from, to),
      mkdir: (p) => mkdir(p, { recursive: true }),
      cipher
    });
    expect(report.status).toBe("migrated");
    expect(await readFile(path.join(newDir, "config.json"), "utf8")).toContain("mochen-mock");
    // 用**新目录**重建 store：解得开 = 密文与本机 cipher 仍然匹配
    const moved = createCredentialStore(newDir, cipher);
    expect(await moved.read()).toBe(API_KEY);
    // 旧目录还在，只是带了 .migrated- 后缀；而且它现在**没有** secrets.enc
    const legacyAgain = createCredentialStore(legacyDir, cipher);
    expect(await legacyAgain.read().catch(() => null)).toBeNull();
    const settings = createProviderSettings({ dir: newDir, credentials: moved });
    const view = await settings.view();
    expect(view.hasKey).toBe(true);
    expect(view.keyMask).toBe(maskApiKey(API_KEY));
    expect(await allText(newDir)).not.toContain(API_KEY);
  });
});
```

顶部补 import：`copyFile, rename` 自 `node:fs/promises`、`migrateLegacyAppData` 自 `./app-data-migration.js`、`maskApiKey` 自 `@mochen/contracts`（回读那份导出名；若掩码只在主进程算，就用 `view.keyMask` 与 `••••` 形状断言替代，并在报告里点名这条改动）。

三条要点：
- `allText(newDir)` 不含明文密钥——沿用本文件既有的「泄漏面按整棵树判」判据（`:170-180`），新目录也要过一遍；
- 断言里**不判旧目录的新名字**（日期后缀随本机 TZ 变），只判「旧 store 读不到了」这一可观测后果。改名规则由 Task 25 的单测钉，这里不重复钉日期；
- 这条用例不碰 `dialog`（全局约束：测试里永不弹框），只跑纯模块。

Run: `corepack pnpm vitest run apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4`
Expected: 绿。

- [ ] **Step 5：用例 D —— 回放跨全链未回退（波 1 能力在波 3 之后仍成立）**

```ts
  it("两轮 + 一张批准 + 一张未裁决：重建服务后盘上回放如实，未裁决卡靠消费方判 expired", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "用文本块提案"));
    const ids = proposalIds(outbound);
    expect(ids.length).toBe(1);
    await service.decide({ proposalId: ids[0] ?? "", decision: "accept-once", guidance: "" });
    await service.startTurn(turn(CHAPTER, "再来一条提案"));
    // 桩的第二轮形状由 F-3 记录（同线程第二轮可能被当成工具回投轮），所以这里只要求它照常收尾
    expect(lastTurnEnd(outbound)?.status).toBeDefined();
    const session = await latestSessionOf(dir);
    const { events, droppedLines } = await readSession(dir, session);
    expect(droppedLines).toEqual([]);
    const proposals = events.filter((event) => event.type === "proposal");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    // 关键：落盘里没有 decision 的事件 = 未裁决，判定归渲染层 replayProposalStatuses（Task 4 单测已钉）
    const decided = events.filter((event) => event.type === "decision").map((event) => (event.type === "decision" ? event.proposalId : ""));
    const open = proposals.filter((event) => event.type === "proposal" && !decided.includes(event.proposal.id));
    expect(open.length).toBe(proposals.length - decided.length);
    expect(events.some((event) => event.type === "written")).toBe(true);
  });
```

这条只判**盘上事实**（事件齐全、无坏行、已裁决数与未裁决数自洽），不判 UI 状态——「未裁决卡标 `expired`、按钮禁用」是 `utils/timeline.ts` 的纯函数职责，Task 4/5 已有单测。e2e 重复判 UI 语义只会造成两处口径漂移。

Run: `corepack pnpm vitest run apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4`
Expected: 绿。若 `open.length === proposals.length - decided.length` 红，说明**同一张卡被裁决了两次**（或 `decision` 事件的 `proposalId` 写错），那是生产缺陷，不是断言过严。

- [ ] **Step 6：波 3 全量门禁与契约自检**

```bash
corepack pnpm verify 2>&1 | tee /tmp/plan3-wave3-verify.log; echo "VERIFY_PIPESTATUS=${PIPESTATUS[0]}"
grep -n "VERIFY_EXIT\|Test Files\|Tests " /tmp/plan3-wave3-verify.log
node tools/check-package-boundary.mjs; echo "BOUNDARY=$?"
node tools/check-source-line-budget.mjs; echo "BUDGET=$?"
```

契约连带（数字一律 `awk`/`grep` 从源码取，不 build、不在 shell 里解析 TS）：

```bash
awk '/^export const IPC_CHANNELS/,/^} as const;/' packages/contracts/src/ipc.ts | grep -c ': "'
awk '/^export interface RendererApi/,/^}/' packages/contracts/src/ipc.ts | grep -c '('
grep -rn "toBe(19)" apps/desktop/src/preload/renderer-api.test.ts
grep -n "PROPOSAL_STATUSES = " packages/contracts/src/patch.ts
grep -c "skillPaths\|profileId" packages/contracts/src/agent-event.ts
grep -rn "schemaVersion" packages/contracts/src/book.ts | head -3
grep -rn "agent-runtime" apps/desktop/src/renderer/src | wc -l
grep -rn "from \"electron\"" packages/contracts/src packages/fs-store/src packages/agent-runtime/src | wc -l
grep -rn "node:fs" packages/agent-runtime/src | wc -l
grep -rn "scanSkills" packages/fs-store/src/scan.ts
```

Expected（逐条回读，一条不许省）：

| 项 | 期望 |
| --- | --- |
| `IPC_CHANNELS` 键数 | **19**（12 → 13 → 17 → 19，本计划设计决定 2） |
| `RendererApi` 方法数 | **19** |
| `renderer-api.test.ts` 字面量 | 有 `toBe(19)` |
| `PROPOSAL_STATUSES` | 7 项含 `expired` |
| `book.json` `schemaVersion` | 仍是 1（波 3 只加可选字段） |
| 渲染层 import `agent-runtime` | **0** |
| packages 里 import `electron` | **0** |
| `agent-runtime` 里 `node:fs` | **0**（fs 全走注入的 `ContextReader`） |
| `scan.ts` 里出现 `scanSkills` | **0**（技能扫描独立在 `skills.ts`，`scanBook` 未动，`.mochen` 仍被跳过） |

用例总数：基线 353，波 1/2 已各自记录，本波净增 ≥ 45（Task 21 的 9、Task 22 的 10、Task 23 的 ~20、Task 24 的 16、Task 25 的 12、本任务 10 条 e2e）。**照日志记实际值**，目标值不当结果写。

行数回读并记进台账：

```bash
wc -l apps/desktop/src/renderer/src/components/CenterColumn.vue apps/desktop/src/main/agent-service.ts \
  apps/desktop/src/renderer/src/stores/useAgentStore.ts apps/desktop/src/main/turn-e2e.test.ts
```

Expected: `CenterColumn.vue` ≤ 400（硬约束）；其余 ≤ 800。`agent-service.ts` 若破 700，Task 16 第 6 条的拆分口径生效——**但本波不临时决定拆不拆**：超了就照那条拆成一个独立提交，并在报告里点名。

- [ ] **Step 7：变异台账全量复跑（M1–M12 + 三处补充，评审者自己跑）**

Plan 3 spec §15 的十二条 + 三波自加的三条（S1 Task 24 失败可见、S2 Task 24 不吞异常、S3 Task 25 幂等覆盖）全部**当场重跑**，不采信各任务草稿里的转录。每条只用 Edit 改，跑完逐字改回复跑到绿。

| 编号 | 归属 | 变异动作 | 必须转红的用例 |
| --- | --- | --- | --- |
| M1 | Task 5 | `ensureHydrated` 里 `fetchDiff: true` | 回放不白打 diff IPC 的那条 |
| M2 | Task 4 | 未配对卡仍留 `pending` | `expired` 不计待审、不进已裁决组 |
| M3 | Task 5 | `error` 结尾也标 `endedAs = "failed"` | 只有 `interrupted` 复活「继续」 |
| M4 | Task 6 | 去掉 `isComposing` 闸门 | 输入法合成期间不截键 |
| M5 | Task 25 | 调换迁移步骤 3 与 4 的先后 | 「解不开 ⇒ `kept-old` 且旧目录名没被改过」 |
| M6 | Task 17 | 删 `applyDecision` 里的档案闸 | 审稿档批准 `write_doc` 被中文拒绝 |
| M7 | Task 16 | `TOOL_SPECS` 不过滤直传 | Task 16 单测 + **本任务用例 A**（`/requests` 侧证据） |
| M8 | Task 14 | 删整节丢弃、改成半句 `slice` | `omitted` 非空 + 尾部不是半句话 |
| M9 | Task 19 | `sync` 无条件注册 `matchMedia` | 「light/dark 档下 `source.added === 0`」 |
| M10 | Task 22 | 去掉 `SKILL.md` 文件名与目录内检查 | 九个坏 `relPath` + 软链越界 + **本任务用例 B 第四条** |
| M11 | Task 18 | 让档案进 `threadKey` | 切档案前后 `threadKey`/`items.length` 不变 |
| M12 | Task 9 | 在渲染层另写一份档位三元链 | 「文案一处来源」的静态断言 |
| S1 | Task 24 | 技能循环删 `unreadableSkills.push(id)` | runtime + 装配器 + 那句中文 error |
| S2 | Task 24 | `context-reader.ts` 的 `catch { return null }` 改成抛 | 「一条坏技能不断全链装配」 |
| S3 | Task 25 | 删「目标已存在则跳过」 | 幂等那条 |

M7 与 M10 两条**必须在 e2e 也跑一次**（它们各有一条本任务的 e2e 用例作第二证据）：改完变异后跑 `corepack pnpm vitest run apps/desktop/src/main/turn-e2e.test.ts --maxWorkers=4`，Expected 红，改回绿。台账每行记：变异原文、红的用例名与断言原文、改回后的绿、重跑人。

```bash
git status --porcelain   # 变异改回来之后必须干净；任何 M 的残留改动都算事故
```

- [ ] **Step 8：真机冒烟（§16 第 8、9 项 + 跨波回归，控制方亲自操作，不委托）**

端点 `https://apihub.agnes-ai.com/v1`、模型 `agnes-2.5-pro`；密钥**只在设置对话框里输入**，绝不进命令行/日志/报告/commit（报告只写 baseURL 与模型名）。第 8 项的「模型答复引用到该技能内容」要有对照：同一句话先不挂技能发一轮，再挂上发一轮，两条答复并排贴进报告。

8. **技能库**：
   - 全局 `<appData>\mochen-ai\skills\` 与书内 `.mochen\skills\` 各放一条（中文目录名）；左栏「技能库」段两条都在，显示名取自 frontmatter `name`，缺 `name` 的那条回落目录名；
   - 点一行 → 右栏只读正文，**当前文稿的草稿与标签一个字节没动**（切走再切回，编辑器内容与被挂起的草稿都在）；
   - 「加入当前上下文」→ 占用条变大、行上出现已挂入标记；再点取消 → 回到原状；挂到第 13 个 → 中文拒绝句、列表不变；
   - 挂上后发一轮 → 模型答复引用到技能内容（对照组：不挂时不引用）；
   - 全程在流式输出中开浏览标签、切标签、挂/取消 → 流不断、无「已打断」、光标不被抢；
   - 重启 → 挂入关系清空（这是设计，UI 那句话要说清），但技能库两源仍列得出。
9. **F-4**：见 Task 25 Step 8 的三场景，本步骤只做**第 1 场景的复验**（真数据迁移 + 迁移后设置对话框掩码与迁前一字相同 + 旧目录带 `.migrated-<日期>` 后缀仍在）。截图两张：迁前设置面板、迁后设置面板。

跨波回归抽查（波 3 动了装配与启动链，逐项回看不能回退）：

- §16 第 1 项：重开后线程/工具卡/提案卡回放、卡头「第 N 轮 · …」、未裁决卡在「上次会话未处理」组里禁用；
- §16 第 3 项键位**抽查五条**即可（`Enter`、`Shift+Enter`、`Ctrl+J`、运行中 `Tab` 排队、中文输入法候选框回车不提交）；
- §16 第 4 项：只读档下批准被中文拒绝、拒绝句与 UI 落点对得上；
- §16 第 5、6、7 项各一眼：外观三态重启保持、六档案切换后占用条与 `/status` 的档案名一致、超预算「已省略 N 节」；
- 新增：挂入技能后**切档案**，占用条随档案变化（`reviewer` 与 `writer` 的节集不同），且技能节仍在。

- [ ] **Step 9：波 3 报告与提交**

新建 `docs/superpowers/plans/2026-10-02-plan3-wave3-report.md`：

```markdown
# Plan 3 波 3（Task 21–27）门禁、变异与真机冒烟

## 门禁
- VERIFY_EXIT= / VERIFY_PIPESTATUS=
- Test Files / Tests 实际数字；相对波 2 的净增
- CenterColumn.vue / agent-service.ts / useAgentStore.ts / turn-e2e.test.ts 行数

## 契约自检（九行表原样落，实测值填进去）

## e2e 四条（A 档案 / B 技能 / C 迁移 / D 回放）
每条：断言清单 + 实际观察到的值（A 要贴六条 `toolNames` 原样数组；B 要贴那句中文 error 原文）

## 变异台账 M1–M12 + S1/S2/S3（15 行全量表）
| 编号 | 变异动作原文 | 红的用例名 | 断言原文摘录 | 改回绿 | 重跑人 |

## 真机通过项（§16 第 8、9 项 + 五条跨波回归，逐条观测）

## 计划级偏离（三波累计，评审要看的差异）
- 通道计数 12→19（新增 `agent:context-preview`，设计决定 2）
- `DEFAULT_PROFILE_ID` 在渲染层以 `""` 哨兵落地（Task 18）
- `CONTEXT_SECTION_KIND_LABELS` 落 contracts（Task 11，接口总表未列）
- `AgentServiceDeps.reader` 追加注入（Task 16）
- `ContextReader` 第四端口 `readSkill` + `ContextPack.unreadableSkills`（Task 24）
- `AppDataMigrationDeps` 的 `now` / `exists` 两个注入点（Task 25）
- `contracts/src/skill.ts` 从 Task 22 挪到 Task 21（fs-store 需要类型）
- Task 14 落地在 Task 13 之前（runtime 内部依赖，其余顺序不变）

## 未做 / 留底（如实）
- `unreadableSkills` 不进占用条（Task 24）；技能 id 语法两处（Task 24）
- 迁移只搬三个已知文件、spec 文件名不改（Task 25/26）
- 挂入关系重启即丢、无「加入当前上下文」的批量入口（Task 23）
- 本轮冒烟用过的模型密钥：**已提醒轮换**
```

勾计划文件波 3（Task 21–27）里**确实验证过**的 `- [ ]`；没转红的、冒烟没跑的留着不勾并在旁边补一行原因。README 那两处按 Task 26 的分工补状态词与波 3 报告指针。

```bash
corepack pnpm exec prettier --write docs
git add apps/desktop/src/main/turn-e2e.test.ts \
  docs/superpowers/plans/2026-10-02-plan3-wave3-report.md \
  docs/superpowers/plans/2026-10-02-plan3-interaction-and-assembly.md \
  docs/superpowers/plans/README.md
git commit -m "test(plan3): 波 3 全链 e2e 扩案与总账：档案、技能、迁移、回放四条链的门禁与冒烟记录"
git status --short
```

- [ ] **Step 10：波 3 收尾自检（进整支评审之前必须全部为真）**

- [ ] `VERIFY_EXIT=0` 与 `VERIFY_PIPESTATUS=0` 都在本次日志里，不是「上一波绿过」。
- [ ] 15 条变异（M1–M12 + S1/S2/S3）各有红/绿两段证据，且**评审者本人重跑过**，不采信转录。
- [ ] 模型永不直接写盘：波 3 新增的技能通路是**只读**的（`scanSkills` / `readSkill` / `readSkill` 端口），全链没有任何一条从技能或档案通向 `writeDocFile` 的路径。`grep -rn "writeDocFile\|writeDoc(" apps/desktop/src/main/skills-service.ts packages/agent-runtime/src/context-pack.ts` 零命中。
- [ ] 工具仍只有 5 个、权限默认仍最保守、`schemaVersion` 仍是 1、`scanBook` 未动、`.mochen` 仍被文稿扫描跳过。
- [ ] 渲染层零 `agent-runtime` import；packages 三处零 `electron`；`agent-runtime` 零 `node:fs`。
- [ ] 全程零新增 npm 依赖（`git diff master...HEAD -- package.json pnpm-lock.yaml` 只允许出现 workspace 内部包名的变化；lockfile 若有改动必须逐行看为什么）。
- [ ] 密钥纪律：`git log -p master..HEAD | grep -in "sk-[a-z0-9-]\{8,\}\|api[_-]key\"\s*:\s*\"[a-z0-9]" ` 无输出（`sk-e2e-canary-4f9d1c` 是本仓既有的**假**探针串，允许出现，报告里点名它是 canary 不是真密钥）；真密钥只在设置对话框里出现过，**已提醒轮换**。
- [ ] `git status --porcelain` 干净；`.mochen/`、`mkdtemp` 临时书目录、`out/` 一律未被 add。
- [ ] 三条 F（F-4、F-6 与波 3 新发现的任何一条）在 README 缺口清单里的措辞不比利报告更乐观。

之后按 superpowers:finishing-a-development-branch 收尾：整支 `feat/plan3-*` 分支 diff 自审 + 一份分级总单（P0/P1/P2 各自点名文件与证据），交用户拍板合并方式。**评审与真机 UI 操作不委托给子代理。**

---

## 留底（写进波 3 报告）

- 本任务**不新建** `plan3-e2e.test.ts`：与 `turn-e2e.test.ts` 共用同一套真子进程 + 真写盘 + 假 cipher 夹具，避免两处密钥泄漏面判据漂移。
- 用例 D 只判盘上事实不判 UI 状态，是把「未裁决卡 = `expired`」这条语义留在 `utils/timeline.ts` 的单测里；e2e 再判一遍会造成两处口径互相将军。
- `toolNames` 的断言写成「包含 / 不含 + 集合大小 ≤5」而不是逐档精确等于，因为工具循环会有回投轮，请求条数天然不是六。若哪天要收紧，得先让 mock-provider 可预测地固定轮次——那是桩的保真度问题（F-3 同源），本片不开这个口。

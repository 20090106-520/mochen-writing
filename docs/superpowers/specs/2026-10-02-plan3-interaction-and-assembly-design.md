# 墨宸 AI · Plan 3 设计：交互层（S5）+ 装配层（S6）+ 磁盘路径迁移（F-4）

> 品牌：产品名 **墨宸 AI / MOCHEN AI**；仓库目录仍叫「深渊写作」，代码内 `@mochen/*`、`.mochen/`、`window.mochen` 均为该品牌。

日期：2026-10-02
状态：待用户复核
上游设计依据：`2026-10-01-mochen-writing-workbench-design.md`（下称「总 spec」）的 §3 / §5 / §5.1 / §6 / §7 / §10 / §11
承接：Plan 2 收尾留下的 F-6（重启后中栏全空）、F-4（磁盘品牌残留）、权限档 UI、波 A 评审延后的四条 P3
执行切片：本设计对应 Plan 3，一片装下 S5 + S6 + F-4，共 27 个任务、3 个波次

## 0. 取证（逐条可在现仓 HEAD 核对，不是假设）

| 事实 | 位置 | 对本片的作用 |
| --- | --- | --- |
| `IPC_CHANNELS` 现 12 键，`RendererApi` 现 12 方法 | `packages/contracts/src/ipc.ts:5-18`、`:37-52` | 新增通道只能加键、加方法，两处必须同步 |
| preload 白名单是工厂函数，且测试用**字面量**钉死方法数 | `apps/desktop/src/preload/renderer-api.ts:32-49`、`renderer-api.test.ts:101`（`calls.length === 12`）、`:132` | 每加一条通道都要同任务改这个计数，否则门禁红 |
| 渲染层拿不到任何会话读取通路：`readSession` 只在主进程与测试里被引用 | `packages/agent-runtime/src/rollout.ts:69`、`apps/desktop/src/main/agent-service.ts:427` | F-6 的正解是**新开通道**，不是复用现有 12 条 |
| 「该章最近一条线程」已现成 | `rollout.ts:128` `findLatestSession(root, docRelPath)` | 水合直接用它，不新写定位逻辑 |
| 坏行不抛错、只报行号 | `rollout.ts:61-66` `ReadSessionResult.droppedLines` | 回放必须如实显示「有 N 行没读回」 |
| `turn-end` 是外发载荷，**不落盘**；`interrupted` 落盘 | `contracts/src/agent-event.ts:79-95`、`:68` | 回放的线程拿不到 turn-end，但能从 `interrupted` 判出「可继续」 |
| 渲染层唯一归约入口 | `useAgentStore.ts:178` `apply` → `:217` `reduceEvent`（`:234` 内联 `void this.loadDiff(id)`） | 回放复用同一归约器；`loadDiff` 必须可关，否则重启后对每条历史提案白打一次 IPC |
| `pendingOf` 按 `status === "pending"` 过滤 | `useAgentStore.ts:143-148` | 新状态 `expired` 天然不计入待审数，零改动 + 一条钉死测试 |
| `canContinue` 只认 `endedAs === "interrupted" \| "failed"` | `useAgentStore.ts:151-157`、`:328` `continueTurn` | 回放后把 `endedAs` 补成 `interrupted`，「继续」在重启后真能续 |
| 提案 diff 走 IPC，主进程查不到 id 返回空串 | `agent-service.ts:499-501` | 重启后的旧卡拿不到 diff，UI 必须显式说明而不是显示空块 |
| 卡头轮次标签查不到锚点时退回「本轮」，且无 user-message 的轮次照样占号 | `utils/timeline.ts:130-163` | 回放让锚点表第一次拥有多轮真实数据，「本轮」分支与跳号要一并验 |
| `splitProposalCards` 只有 open/settled 两组 | `utils/timeline.ts:171-196` | 「上次会话未处理」的卡不能被塞进「已裁决」，那是假话 |
| Esc 唯一裁决入口 | `utils/escape-policy.ts:14` `resolveEscape` | 键位层不得复制一份 Esc 判定 |
| 中栏唯一全局监听器 | `CenterColumn.vue:98-109`（只做 Esc） | 键位接线只替换这一处，不新增第二个监听器 |
| 档位文案唯一来源是 contracts | `contracts/src/permission.ts:6-8`、`CenterColumn.vue:69-71`（注释已声明不许手抄） | 权限档 UI 直接查 `PERMISSION_LABELS` |
| 提案模式的文案还是三元链 | `ProposalCard.vue:18-20` | 波 A 评审 P3 之一，本片下沉成 `PROPOSAL_MODE_LABELS` |
| `saveMeta` 在渲染层零调用；主进程写 book.json 后刷新快照 | `contracts/src/ipc.ts:40`、`book-service.ts:60-67` | 切档 UI 接上即生效，无需新通道 |
| `AppearanceMode = "system" \| "light" \| "dark"` 与 `AppearanceSettingsSnapshot` 已在契约里 | `contracts/src/appearance.ts:5-6`、`:205-214`、`:216-220`、`:245-253` | 主题三态是「补 UI + 补持久化」，不是新增类型 |
| 现在完全没持久化：每次挂载按系统偏好取色 | `App.vue:25`（`createDefaultAppearanceSettings()`）、`:27-29`、`:31-39`、`:46-48` | 计划 2 README 的裁定：不硬锁深色，本片补三态与落盘 |
| 主题预设已有三条 | `composables/appearanceThemeRuntime.ts:24-43` | 外观页直接复用 `themePresets` |
| `BookStage` 只有 `{id, name}`，`schemaVersion` 是 `z.literal(1)` | `contracts/src/book.ts:7-10`、`:28`、`:34` | 阶段加档案 = 加**可选**字段；只加可选字段不升 schemaVersion |
| 书目录是用户自己写的，阶段 id 任意（测试用 `draft`） | `book-service.ts:47-57`，全仓 `stages: [{ id: "draft", name: "正文" }]` | 「正文阶段默认主笔」不能按阶段 id 硬映射，只能走 `stages[].profileId` + 一个内置默认常量 |
| `scanBook` 跳过 `.mochen` | `packages/fs-store/src/scan.ts:18` | 书内技能库拿不到 ⇒ 技能浏览必须走自己的通道，**不为技能破例改扫描** |
| `search_docs` 的实现长在 host 里，不是可复用的纯函数 | `apps/desktop/src/main/doc-tools-host.ts:119-121` | 全书检索面板要新写 fs-store 纯函数，与本片主线正交 ⇒ 明确不做 |
| 磁盘品牌残留只有一处代码 | `apps/desktop/src/main/index.ts:43` `path.join(app.getPath("appData"), "mochen-writing")` | F-4 是单点改动 + 迁移，不是全局改名 |
| 密钥/配置的落盘形状由注入的 dir 决定 | `provider-settings.ts:21-26`（`config.json`）、`credential-store.ts`（`secrets.enc`）、`electron-cipher.ts:14` | 迁移只需搬两个文件 + 验证解密，dir 已是可注入参数 |
| `defaultPromptFor` 是唯一替换点，注释已预告 | `agent-service.ts:48-63`、`:430-436`、`:453`；`:122` 预告 `autoSession` 键换 profileId；`:290-291` 预告「当前章随右栏活动标签走」 | 装配改造收在这一个函数与两个 Map |
| 五工具/三档/中文文案是铁律；`book.json` 与 `.mochen/` 是天花板 | `contracts/src/tools.ts:1-8`、`agent-runtime/src/permission.ts:3,34` | 档案只能取五工具的子集，不得新增工具 |
| 门禁链与预算 | `package.json` 的 `verify`、`tools/check-source-line-budget.mjs:5`（800 行，含 `.vue`）、`tools/check-package-boundary.mjs:6` | `CenterColumn.vue` 现 223 行；新组件必须分文件，判定逻辑必须留在可 node 单测处 |

> **波 1 落地后的快照更正（2026-10-02，Task 10 当场回读）**：上表第 15/16/17 行写的「12 键 / 12 方法 / `calls.length === 12`」
> 是本 spec 写作时的现仓值，不是现值。现值三处一起到 13：`packages/contracts/src/ipc.ts` 的 `IPC_CHANNELS` 13 键、
> 同文件 `RendererApi` 13 方法、`apps/desktop/src/preload/renderer-api.test.ts:102` 的 `toBe(13)` 与 `:135` 的
> 「渲染层只拿到这 13 个方法」。§13 契约总表「现值」列同属写作时快照，往后的波次照此逐波更正，不拿它当现状读。

现况基线：`master` = `58cbf1d`，`corepack pnpm verify` 绿，**353 用例 / 34 文件**。

## 1. 目标与非目标

目标（本片全部要成立，且可验）：

1. 重启应用后，中栏线程与提案卡**回来了**（F-6）；被打断的线程重启后仍能「继续」。
2. 键位全表在真机生效：`Enter` / `Shift+Enter` / `Ctrl+J` / `Tab` 排队 / `y` `a` `p` `d` / `Ctrl+PageUp/Down` / `Ctrl+1..9` / `Ctrl+B` / `Ctrl+,` / `/`。
3. `/` 命令面板能真正驱动 7 条命令，运行期不可用的命令不出现。
4. 权限档在 UI 里能切（`read-only` / `chapter-write` / `full-access`），切完**当场生效**，且「切档后再批准」有入口。
5. 外观三态（跟随系统 / 浅色 / 深色）+ 主题预设可选，重启保持。
6. 六个墨宸档案按总 spec §5.1 落地：档案选择器 + 阶段默认档案 + 按档案过滤工具 + 审批时的档案范围闸。
7. 上下文包按档案装配（当前章 / 大纲 / 出场人物 / 前情 / 挂入技能），中栏顶部显示占用条与估算。
8. 技能库只读浏览（全局 + 书内）+ 显式「加入当前上下文」，浏览永不打断文稿与对话。
9. 磁盘目录从 `%APPDATA%\mochen-writing` 迁到 `%APPDATA%\mochen-ai`，且**密钥迁移前被验证可解密、旧目录只改名不删除**。

非目标（见 §17 的理由清单）：`/compact` `/fork` `/usage` `/export` `/new`、上下文边界（boundary）机制、跨重启复活「可批准的待审队列」、全书检索面板、技能编写 UI、字号/字体自定义 UI、按书保存外观。

## 2. 五条贯穿性决定

**D1 · 回放复用归约器，但不复用「可批准的待审队列」。**
重启后主进程的 `pending`/`diffs` Map 是空的（`agent-service.ts:117-118`、`:506-508`）。若把回放的旧提案渲染成可批准的样子，用户点批准只会拿到 `not-pending`——那是骗人。所以：回放的未裁决卡一律标新状态 `expired`（中文「上次会话未处理」），按钮禁用，进第三组折叠区，卡上给一句「要让它在新一轮重新提案，直接把要求再说一遍」。
被否方案：主进程启动时按 JSONL 重建 `pending` + 重算 diff。**否掉的理由**：重建 baseline 要读盘，而盘在重启期间可能已被外部改动，届时「批准」等于覆盖一次没人看过的改动——与总 spec §6 的铁律冲突，风险不对等。

**D2 · 键位判定全进纯函数，Esc 仍由 `resolveEscape` 唯一裁决。**
`utils/hotkeys.ts` 只做「哪个键在什么焦点下等于哪个动作」；`Escape` 一律返回 `delegated`，派发处再调 `resolveEscape`（`escape-policy.ts:14`）。两套裁决必然漂，所以不留第二套。

**D3 · 档案只在 `agent-runtime` 一处，渲染层走 `profile:list`。**
渲染层禁止 import `@mochen/agent-runtime`（barrel 内含 `node:fs`）。若把 id/显示名抄进 contracts 让渲染层直读，就出现两份枚举（铁律 6）；提示词与上下文构造器又必须在 runtime。裁定：roster 只在 `agent-runtime/src/profiles.ts`，渲染层经 IPC 拿 `ProfileView[]`。新增第七个档案 = 在 roster 加一条，不改任何分支代码（总 spec §5.1 约束 2）。

**D4 · 切档案不换会话线程；自动批准作用域改 `${threadKey}::${profileId}`。**
总 spec §5.1 约束 1：同一章永远同一条线程，切档案只换提示词与上下文构造器。而 `a` 键（本会话不再问）按总 spec §6 是「同一档案内」，所以 `autoSession`（`agent-service.ts:123`，注释 `:122` 已预告）的键从 `threadKey` 改为 `` `${threadKey}::${profileId}` ``——**不是只换成 profileId**：只按 profileId 会让 A 章的「不再问」漏到 B 章，那是跨章越权。`p` 键的 `ruleKey = ${docRelPath}::${tool}`（`:112-114`）不变。

**D5 · 对上游 spec 的两处命名/范围收窄。**
① 总 spec §5.1 写的字段名是 `stages[].profile`，本片定名 `stages[].profileId`（与 `stageId`/`docRelPath` 同风格，且 `profileId` 与 `ProfileView.id` 同名可对照）。这是唯一的命名偏离。
② 总 spec §7 的斜杠命令全表与 §5 的 `/compact` 边界机制，本片按 §17 的理由推迟；面板只显示已实现的命令，不留占位。

## 3. 波次与任务边界

一波一提交，每波 ≤12 任务且 ≤150 轮（Plan 2 波 B 撞过 150 轮上限，这条是硬约束）；每波结束跑 `corepack pnpm verify` 并回读日志里的 `VERIFY_EXIT=0` 与用例总数，不看外壳退出码。

**波 1「看得见的历史与按得动的键」（10 任务，S5 主体 + F-6）**

1. contracts：`SessionLoadResult` + `agent:load-session` 键 + `RendererApi.loadSession`
2. preload：工厂加方法 + `renderer-api.test.ts` 计数 12→13 连带
3. 主进程：`agentService.loadSession(threadKey)`（复用 `findLatestSession` + `readSession`，三态中文失败）
4. store：`reduceEvent(thread, event, { fetchDiff })` + `ensureHydrated` + `expired` 状态与回放派生扫描
5. store/UI：水合时机（开书、切文稿标签、`/resume`）与幂等；`endedAs` 推断复活「继续」
6. `utils/hotkeys.ts resolveHotkey` + 全焦点组合测试
7. 键位接线：替换 `CenterColumn.vue:98-109` 单一监听器 + `y/a/p/d` 接 `agent.decide`
8. `utils/slash-commands.ts` + `SlashPalette.vue`（7 条命令 + 可用性矩阵）
9. 权限档切换 UI + `PROPOSAL_MODE_LABELS` 下沉（删 `ProposalCard.vue:18-20` 三元链）+ `saveMeta` 首次接线
10. 波 1 门禁 + 真机冒烟（重启回放、键位、切档后批准）+ 台账

**波 2「六个档案与一双不刺眼的眼睛」（10 任务，S6 主体 + 外观）**

11. contracts：`ProfileView`、`ContextSummary`/`ContextPreviewInput`、`StartTurnInput.profileId`、`SessionMeta.profileId?`、`BookStage.profileId?`、`profile:list`/`agent:context-preview`/`appearance:get/save`
12. preload/白名单：`listProfiles` / `contextPreview` / `appearanceView` / `saveAppearance` + 计数 13→17 连带
13. agent-runtime：`AgentProfile` 类型 + `AGENT_PROFILES` 六条 + `profileAllowsDoc` + 按档案取 `TOOL_SPECS` 子集
14. agent-runtime：`context-pack.ts`（`ContextReader` / `buildContextPack` / `estimateTokens` / 预算与整节丢弃）+ 纯函数单测
15. 主进程：`profile:list` 注册 + `ContextReader` 装配（fs 与 frontmatter 由 main 实现，runtime 不碰 fs）
16. 主进程：`promptFor` 异步化、删 `defaultPromptFor`、档案提示词 + 上下文节渲染 + 全部测试夹具连带
17. 主进程：审批第二道闸（档案范围）+ `autoSession` 键改造 + 审稿档案拒 `write_doc`
18. 渲染层：档案/阶段选择器 + 中栏头部改造 + 上下文占用条（`formatContextBar` 纯函数）
19. 全链：主题三态（主进程 `appearance.json` + `useAppearanceStore` + `resolveEffectiveScheme` + `App.vue` 接线 + 设置面板外观页）
20. 波 2 门禁 + 真机冒烟（档案切换后的 system 内容、占用条、主题重启保持）+ 台账

**波 3「技能、迁移与总账」（7 任务，S6 技能库 + F-4 + 收尾）**

21. fs-store：`scanSkills` + 技能 frontmatter 解析（复用 `frontmatter.ts`）+ 单测
22. 主进程/preload：`skills:list` / `skills:read`（只读、路径安全、大小上限）+ 计数 17→19 连带
23. 渲染层：左栏技能入口 + 技能浏览标签 + 「加入当前上下文」 + `skillsByThread` + `StartTurnInput.skillPaths`
24. 装配 + 保护：上下文包的「已挂入技能」节 + 「浏览不打断」四条写死测试（含运行中开浏览不打断）
25. F-4：`app-data-migration.ts` 纯模块 + 单测（三态 + 变异）+ `index.ts:43` 接线 + 中文播报
26. F-4 文档同步：总 spec §8 路径、`plans/README.md`、冒烟记录就地加更正注；扫干净代码里的残留字面量
27. 全链 e2e 扩案（回放 + 档案 + 技能挂入 + 迁移）+ Plan 3 冒烟报告 + 变异台账 + README 索引收尾

## 4. `/resume` 与线程水合（波 1 · F-6）

### 4.1 契约

```ts
// packages/contracts/src/ipc.ts 增键
agentLoadSession: "agent:load-session"

// packages/contracts/src/agent-event.ts 增类型
export type SessionLoadResult =
  | {
      found: true;
      relPath: string;
      meta: SessionMeta;
      events: AgentEvent[];
      droppedLines: number[];
    }
  | { found: false; reason: "no-book" | "no-session"; message: string };
```

`RendererApi.loadSession(threadKey: string): Promise<SessionLoadResult>`。入参守卫与 `startTurnInputSchema` 同口径：`threadKey` 长度 ≤200，越界抛单句中文（裁定 n 延续）；主进程内 `threadKey.trim() === ""` 归一为 `UNBOUND`（`agent-service.ts:385` 同口径），保证渲染层与主进程的键永远一致。

### 4.2 主进程

`loadSession(threadKey)` 三步，全部复用现成函数：

1. `book.current()` 为 null ⇒ `{found:false, reason:"no-book", message:"还没打开作品目录，历史读不回来。"}`。
2. 先查 `threads` Map（`:119`；它只在拿到真实相对路径时才写入，所以不存在「缓存了一条查不到的线程」这种状态）。没有则 `findLatestSession(root, threadKey)`（`rollout.ts:128`）。找不到 ⇒ `{found:false, reason:"no-session", message:"这本书里没有这条线程的历史。"}`，且不往 Map 里写任何东西——用户重新选择目录、或这一章后来第一次发了轮，都必须还能查到。
3. `readSession(root, rel)`（`rollout.ts:69`）；首行坏 ⇒ 抛中文（沿用 `rollout.ts:77-80` 的原文），IPC 层不吞，渲染层收成一条 notice（§4.3 规则 3）。

### 4.3 渲染层：复用同一条归约路径

`ThreadView`（`useAgentStore.ts:26-37`）加两个字段：`hydrated: boolean`（`newThread()` 默认 false）与 `hydrating: boolean`（同一线程的并发水合请求合并成一次，避免 `openBook` 与切标签同时发两条 IPC）。第三个新字段 `queued: string[]` 属键位层，见 §5.1。

```ts
// useAgentStore 增 action
ensureHydrated(threadKey: string): Promise<void>
```

规则（写死并逐条测）：

1. 该线程 `hydrated === true` ⇒ 直接返回（幂等；`/resume` 重复按不叠加）。
2. 该线程 `running === true` ⇒ 本次不水合（避免与迟到 delta 抢顺序）；`apply` 的 `turn-end` 分支里若发现该线程 `hydrated === false`，补一次 `void this.ensureHydrated(threadKey)`。
3. `hydrating === true` ⇒ 复用同一次在途取数，不发第二条 IPC。取数失败（IPC 抛错，含 §4.2 首行坏的情况）⇒ 回退 `hydrated = false`、`hydrating = false`，并把中文原因写进 `notice`；这样用户可以再按一次 `/resume` 重试。
4. 取数成功 ⇒ 逐条 `this.reduceEvent(thread, event, { fetchDiff: false })`，**只归约 `thread.items` 里不存在该事件 `id` 的那些**，再置 `hydrated = true`。这条按 id 去重是硬要求：先水合、后发消息、再补水量合，或用户在没历史时先跑了轮，三种交错都会让同一事件同时来自实时推送与 JSONL；事件 `id` 由 `newId()` 生成且落盘前后一字不改（`agent-service.ts:147-153`），足够当唯一键。`reduceEvent` 的第三参是把 `:234` 的 `void this.loadDiff(id)` 关掉，实时路径（`apply` 里 `:207`）仍传 `true`。**只此一处归约实现，两个调用点**——不允许复制一份回放版归约器。
5. `found: false`：`reason === "no-session"` 视为「确实没有历史」，置 `hydrated = true`；`reason === "no-book"` **不置位**，下次开书还得能水合。
6. 归约完做一次派生扫描（纯函数放 `utils/timeline.ts`）：

```ts
export function replayProposalStatuses(events: AgentEvent[]): Record<string, ProposalStatus>
```

对每条 `proposal` 事件：其后有 `decision`/`written` ⇒ 按现有语义给已裁决态；没有 ⇒ `expired`。扫描结果覆盖 store 里这些卡的 `status`，且 `expired` 的卡不请求 diff。

7. `droppedLines.length > 0` ⇒ 写 `notice`：`"这条线程有 N 行没能读回，其余内容已恢复。"` 不伪造事件、不静默。
8. `endedAs` 推断：事件里最后一条是 `interrupted` ⇒ `endedAs = "interrupted"`（`:151-157` 的 `canContinue` 立刻为真，「继续」按钮在重启后能用，`continueTurn` 用现成的 `CONTINUE_TEXT` 发新一轮）；只看到 `error` ⇒ `lastError` 保留但不标 `failed`（错误之后可能已重试过，保守处理）。`turnId` 与 `startedAt` 保持空/0——回放线程没有活着的轮次。
9. 占位只在 `hydrating === true` 且 `hydrated === false` 时出现（「正在恢复这一条线程…」）；`hydrated === true` 且 `items.length === 0` 是「确实没有历史」，走现有空状态（`CenterColumn.vue:155-169`），不显示占位。

### 4.4 三处水合时机

`CenterColumn.vue` 的 `threadKey` computed（`:36`）变化时 `void agent.ensureHydrated(threadKey)`；`openBook` 成功后对首个线程同样调用；`/resume` 命令同义。判定与取数全在 store，组件只触发。

### 4.5 `expired` 的 UI 口径

`PROPOSAL_STATUSES`（`contracts/src/patch.ts:16-24`）加 `"expired"`，`PROPOSAL_STATUS_LABELS` 加 `expired: "上次会话未处理"`。类型是 `Record<ProposalStatus, string>`（铁律 6），加成员会让 tsc 报缺键——这就是编译期关卡。
`splitProposalCards`（`utils/timeline.ts:171-196`）返回 `{ open, settled, expired }` 三组；中栏第三组标题「上次会话未处理 · N 条」，默认折叠，卡上四个审批按钮禁用并显示「这一条要在新一轮里重新提出」。
`pendingOf` 不改一行：它按 `status === "pending"` 过滤（`:143-148`），`expired` 天然不计数——用测试钉住，而不是用注释声明。
`cardTurnLabel`（`timeline.ts:152-163`）在回放后必须显示「第 N 轮 · …」而不是兜底的「本轮」；这条也是波 A 评审 P3「死分支」的真机复活验证。

## 5. 键位层（波 1）

```ts
// apps/desktop/src/renderer/src/utils/hotkeys.ts（新增，纯函数）
export interface HotkeyFocus {
  composerIsFocused: boolean;
  composerHasText: boolean;
  textInputIsFocused: boolean; // 文稿编辑器 / 说明框 / 设置输入 / 检索类输入统一算它
  proposalIsFocused: boolean;
  proposalIsPending: boolean;
  turnRunning: boolean;
  isComposing: boolean;
  hasBook: boolean;
  tabCount: number;
}

export type HotkeyAction =
  | "submit" | "newline" | "queue" | "delegated" | "none"
  | "approve-once" | "approve-session" | "approve-prefix" | "deny-guidance"
  | "next-tab" | "prev-tab" | "jump-tab"
  | "toggle-left" | "open-settings" | "open-palette";

export interface HotkeyResult { action: HotkeyAction; tabIndex?: number }
export function resolveHotkey(focus: HotkeyFocus, key: string, mods: HotkeyMods): HotkeyResult
```

`HotkeyMods = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }`——入参是拆开的修饰键而不是 `KeyboardEvent`，这样纯函数不依赖 DOM，也不会有人把 `event` 传进来偷偷读别的字段。

键位表（本片实现的全部行，逐条有测试）：

| 键 | 焦点条件 | 动作 | 出处 |
| --- | --- | --- | --- |
| `Enter` | composer 有焦点、无修饰键、未在合成、`!turnRunning` | `submit` | 总 spec §7 |
| `Enter` | composer 有焦点但 `turnRunning` | `none`（运行中要追加指令走 `Tab`） | 本片裁定 |
| `Shift+Enter` / `Ctrl+J` | 除首行外焦点同上 | `newline` | 同上 |
| `Tab` | `turnRunning && composerHasText && !textInputIsFocused` | `queue`（见 §5.1） | `keymap.rs:1679` |
| `Tab` | 其余 | `none`（保留焦点移动，无障碍优先） | 本片裁定 |
| `Esc` | 裸键（`ctrl`/`shift`/`alt`/`meta` 任一为真则不归此表） | `delegated` → 派发处调 `resolveEscape`；带任何修饰 ⇒ `none` | 总 spec §6.2 |
| `y` / `a` / `p` / `d` | `proposalIsFocused && proposalIsPending && !textInputIsFocused` | 四个审批态 | `keymap.rs:1933-1938` |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 有书 | `next-tab` / `prev-tab` | 总 spec §7 |
| `Ctrl+1..9` | 有书且 `n ≤ tabCount` | `jump-tab`（`tabIndex = n-1`）；越界 `none` | 总 spec §7 |
| `Ctrl+B` | 任意 | `toggle-left`（接 `layoutStore.togglePane("left")`） | 总 spec §7 |
| `Ctrl+,` | 任意 | `open-settings` | 总 spec §7 |
| `Ctrl+O` | 任意（含文本框里，走全局 Ctrl 族） | `open-book` → `book.pickAndOpen()`；`Ctrl+Shift+O` 与合成期间 `none` | 本批补：`LeftSidebar.vue:79` 的 `<kbd>Ctrl O</kbd>` 一直是空标 |
| `/` | composer **无**焦点且不在文本框里、无修饰键 | `open-palette` | `slash_command.rs:13` |

> 这张表是摘要，下面五条护栏的白名单才是裁决边界：两者冲突时以护栏为准。已按此改写两行——
> `Tab` 补 `!textInputIsFocused`（护栏 2，防在文稿编辑器里把缩进键抢成排队），`Esc` 收窄到裸键
> （`Alt+Esc` 是系统窗口快捷键，`Ctrl+Esc` 一类也不归本表，一律 `none` 放行）。

五条护栏（每条都要一条反向用例）：

1. **输入法合成**：`isComposing` 为真一律 `none`。中文打字的候选框回车被吃掉是这类应用最刺眼的错，比少一个快捷键严重得多。
2. **编辑态**：`textInputIsFocused` 为真时，只放行 `newline` / `submit`（限 composer）/ 全局 `Ctrl+*`；`y/a/p/d` 与 `/` 全部 `none`。
3. **`d` 的后续**：`deny-guidance` 的派发把焦点移到该卡的说明框且不提交；说明为空时点提交不生效（沿用 `ProposalCard.vue:22-25` 的守卫，不另写一套）。
4. **审批四键只作用于「聚焦的那一张卡」**：与鼠标按钮调同一个 `agent.decide(proposalId, …)`（`useAgentStore.ts:281`），键不引入新语义。`expired` 组的卡 `proposalIsPending` 为假，按不出任何审批动作。
5. **面板内部的键不进全局判定**：`/` 打开的面板自己处理 ↑ ↓ / `Enter` / `Esc`，`Esc` 处理完 `stopPropagation`——与 `ProposalCard.vue:28-30` 卡内 Esc 的手法一模一样。因此 `resolveEscape` 不加第四优先级（总 spec §6.2 的三优先级一字不动），全局派发也拿不到面板的 `Esc`。

接线：新增 `composables/useHotkeys.ts`（薄壳 ≤40 行：装 listener、从 store 组 `HotkeyFocus`、把 `HotkeyResult` 派到既有 action），在 `CenterColumn.vue` 里替换 `:98-109` 现有 `onGlobalEscape`。**全局有且只有一个 keydown 监听器**——这条要在实现简报里写死，防止两处裁决。

### 5.1 `Tab` 排队是本轮唯一的新状态

现有 `send`（`useAgentStore.ts:310-325`）没有 running 守卫，所以排队不能靠「再调一次 send」。定义如下，全部在渲染层，**不加 IPC 通道、不加事件类型**：

- `ThreadView` 加 `queued: string[]`（`newThread()` 给空数组）。
- `queue` 派发：把 composer 文本 `trim` 后 push 进当前线程的 `queued`，清空 composer，不发 IPC；`queued.length` 已达 5 时不再入队，写 `notice`「排队指令最多 5 条，先等这一轮结束」。
- `apply` 的 `turn-end` 分支（`:102-107` 一带）：该线程 `queued` 非空 ⇒ 取队首调 `send()`。一轮结束只自动发一条，其余继续排。
- `interrupt`（`stop()`，`:334-346`）**不清队列**：用户按 Esc 停的是当前这一轮，排队指令仍然有效，`turn-end{interrupted}` 到达后照样自动发下一条。这与总 spec §6.3「打断保留已流出内容与 pending 提案」的姿态一致。
- `composeStatusLine`（`:114-131`）多一个入参 `queued: number`，运行中显示「工作中 · 42s · Esc 打断 · 排队 2 条」。它是纯函数，签名改动必须同任务把 `useAgentStore.test.ts` 与 `CenterColumn.vue:53-55` 一起改完。
- 对 Codex 的偏离写清楚：Codex 的 `queue` 是对**进行中的一轮**做中途引导（steering），那需要新的 IPC 与新事件类型；本片做的是「本轮结束后自动发下一条」，用户可见的差异是排队指令在下一条开始时才生效，状态行用「排队 N 条」如实说明。

## 6. `/` 命令面板（波 1）

```ts
// utils/slash-commands.ts（纯函数 + 唯一枚举）
export const SLASH_COMMANDS = ["model", "permissions", "status", "stage", "skills", "resume", "clear"] as const; // 终态 7 条；波 1 先落 6 条，skills 随波 3 进表
export type SlashCommand = (typeof SLASH_COMMANDS)[number];
export interface PaletteFocus { hasBook: boolean; turnRunning: boolean; profilesReady: boolean } // profilesReady 随波 2 的档案通路一起加
export function availableCommands(focus: PaletteFocus): SlashCommand[]
export function parseSlashInput(text: string): { command: SlashCommand | null; argument: string }
export const SLASH_COMMAND_DESCRIPTIONS: Record<SlashCommand, string>; // 穷尽表：加成员不写说明就编译不过
```

- `availableCommands` 的运行期约束（照 Codex `available_during_task()` 的思路）：turn 运行中只留 `model / permissions / status / clear`；`stage / skills / resume` 会被禁（它们要换上下文或重建视图，与进行中的一轮抢状态）。`PaletteFocus.profilesReady` 是波 2 才加的字段（档案列表拿不到时禁 `stage`，因为切阶段会连带切档案）；波 1 的 `PaletteFocus` 只有 `{ hasBook, turnRunning }`。同理 `SLASH_COMMANDS` 按波次增量：**波 1 落 6 条**（`model / permissions / status / stage / resume / clear`），`skills` 随波 3 的技能通道一起进枚举——`descriptions: Record<SlashCommand, string>` 是穷尽表，加成员必然同时逼出说明与动作，不会出现「列出来但按下去报错」的占位命令。
- 语义：`/model` 打开设置面板；`/permissions [档名]` 打开档位选择器或直接切档（中文档名按 `PERMISSION_LABELS` 反查，查不到给一句中文提示）；`/status` 展开状态条与上下文占用详情；`/stage [阶段名]` 切阶段；`/skills` 打开技能浏览（波 3）；`/resume` 触发 `ensureHydrated`；`/clear` **只清当前线程的渲染层视图**。
- `/clear` 的真实边界必须写在确认文案里：「这只清空本页显示；盘上的会话历史不动，重启后仍会完整回放。」不做 boundary 事件、不改 JSONL、不动模型历史——那是 `/compact` 的机制，本片不做（§17）。
- 未实现的命令（`/usage` `/export` `/fork` `/new` `/compact` `/outline` `/characters`）**不在面板里出现**。留占位等于给用户一个按下去只会报错的按钮。
- 面板组件 `SlashPalette.vue`（新文件，不塞进 `CenterColumn.vue`）：列表 + ↑↓ 选择 + `Enter` 执行 + `Esc` 关闭；命令的中文说明一句一条，来自 `SLASH_COMMANDS` 同表的 `descriptions: Record<SlashCommand, string>`（铁律 6：一张表，穷尽键）。

## 7. 权限档切换与文案查表（波 1）

- 入口：`CenterColumn.vue:135` 的 `permission-chip` 变成可点按钮，弹三档 popover；文案一律读 `PERMISSION_LABELS`（`contracts/src/permission.ts:6-8`），默认档 `DEFAULT_PERMISSION_MODE`。
- 写通路：`useBookStore` 增 `setPermissionMode(mode)` ⇒ 组 `meta` ⇒ `window.mochen.saveMeta` ⇒ `book-service.saveMeta`（`:60-67`，已保证写盘后刷新快照，档位当场生效）。失败收成中文一句进 `book.notice`。
- 未打开书时按钮禁用并显示原因（`saveMeta` 在无快照时抛「尚未打开作品目录」，`book-service.ts:61`）。
- 波 A 评审延后的「切档后再批准」缺口由此闭合：拒绝文案里那句「把权限档切到『可改当前章』或『全开』后再批准」（`agent-runtime/test/permission.test.ts:47-48` 钉死的定稿指引句）现在有了 UI 落点。切档**不复活**主进程已删的 pending 卡（拒绝即已删；`:274-283`），这一点在 UI 说明里写清：「已经拒绝或取消的提案不会回来，切档后请在新一轮里重新提出」——只有仍留在 `pending` 里的（档位收紧时 `:293` 之后不删）才能切档后再批准。
- 顺手下沉 `PROPOSAL_MODE_LABELS`：`contracts/src/patch.ts` 加 `export const PROPOSAL_MODE_LABELS: Record<PatchMode, string> = { "anchor-replace": "锚点替换", "doc-overwrite": "整篇替换" }`，`ProposalCard.vue:18-20` 的三元链删除，改查表。

## 8. 主题三态与持久化（波 2）

- 契约：`IPC_CHANNELS` 加 `appearanceGet: "appearance:get"` / `appearanceSave: "appearance:save"`；`RendererApi` 加
  `appearanceView(): Promise<AppearanceSettingsSnapshot>` 与 `saveAppearance(settings: AppearanceSettings): Promise<AppearanceSettingsSnapshot>`。类型全部复用 `contracts/src/appearance.ts`（`:205-214`、`:216-220`），不新增外观类型。
- 落盘：应用数据目录下的 `appearance.json`。波 2 时这个目录还是 `mochen-writing`（`main/index.ts:43` 要到波 3 才动），波 3 迁移后自动变成 `mochen-ai`——因为两者都从同一个注入的 `dir` 参数拼路径，外观模块不需要知道这件事（§12 的第 2 步会把它一起搬走）。明文 JSON、不含任何密钥，与 `config.json` 同级同风格；新增 `apps/desktop/src/main/appearance-settings.ts`，`createAppearanceSettings({ dir, readFile?, writeFile? })`，形状照 `provider-settings.ts:21-26`。
- 读侧永不抛：文件缺失或解析/校验失败 ⇒ 返回 `createDefaultAppearanceSettings()` + `persisted: false`（`AppearanceSettingsSnapshot` 正是为这个语义准备的，`:216-220`）。写侧校验失败 ⇒ 抛单句中文（与 `providerDraft` 的守卫同风格）。
- 渲染层：新增 `stores/useAppearanceStore.ts` + `utils/theme-mode.ts`：

```ts
export function resolveEffectiveScheme(mode: AppearanceMode, systemScheme: AppearanceColorScheme): AppearanceColorScheme
```

`mode === "system"` 时取 `matchMedia`，否则恒取 `mode`。`App.vue` 改成：挂载先 `await appearance.load()` 再 `applyTheme()`；`matchMedia` 监听器**只在 `mode === "system"` 时注册**，切到 light/dark 时注销（现 `App.vue:46-48` 无条件注册且无持久化）。计划 2 README 的裁定保持：不硬锁深色。
- 外观页：设置弹层加「外观」一节（`AppearancePanel.vue`）：三态分段控件 + `themePresets`（`appearanceThemeRuntime.ts:24-43`，Codex/暖纸/海雾）三条预设 + 「恢复默认」。字号/字体自定义不在本片（§17）。

## 9. 六档案与上下文装配（波 2）

### 9.1 契约与 runtime

```ts
// packages/contracts/src/profile.ts（新）
export interface ProfileView {
  id: string;
  displayName: string;
  blurb: string;                       // 花名册里那句中文职责
  allowedTools: AgentToolName[];       // 五工具的子集，只读展示用
}

// packages/agent-runtime/src/profiles.ts（新，唯一 roster）
export interface AgentProfile {
  id: string;
  displayName: string;
  blurb: string;
  systemPrompt: string;                       // 中文
  allowedTools: readonly AgentToolName[];
  writeScope: WriteScope;                     // 上限，不是授权
  buildSections: (request: ContextRequest, reader: ContextReader) => Promise<ContextSection[]>;
}
export const AGENT_PROFILES: readonly AgentProfile[];
export const DEFAULT_PROFILE_ID = "writer";
export function profileById(id: string): AgentProfile | null;
export type WriteScope =
  | { kind: "none" }
  | { kind: "current-chapter" }
  | { kind: "dirs"; dirs: readonly string[] };   // 目录名取自 agent-runtime/src/permission.ts:3 的五目录
export function profileAllowsDoc(scope: WriteScope, docRelPath: string, currentChapter: string | null): boolean;
```

六条实例（严格按总 spec §5.1 表；id 用 ASCII，显示名中文）：

| id | 显示名 | allowedTools | writeScope | 上下文侧重 |
| --- | --- | --- | --- | --- |
| `world` | 墨宸 · 世界 | 五工具（含 `write_doc`） | `dirs: ["materials", "outline"]` | 素材 + 大纲空位，不装整章正文 |
| `chief-editor` | 墨宸 · 总编 | 五工具（含 `write_doc`） | `dirs: ["outline", "plot"]` | 各章摘要 + 现大纲 + 人物卡 |
| `character` | 墨宸 · 角色 | 五工具（含 `write_doc`） | `dirs: ["characters"]` | 该人物出场的章节 + 人物卡 |
| `writer` | 墨宸 · 主笔 | 五工具（含 `write_doc`） | `current-chapter` | 本章 + 大纲摘要 + 出场人物 + 前情 + 挂入素材/技能 |
| `continuator` | 墨宸 · 续写 | 不含 `write_doc` | `current-chapter` | 本章全文（尾部不截断）+ 前情 + 未回收伏笔 |
| `reviewer` | 墨宸 · 审稿 | 不含 `write_doc` | `none` | 全章 + 人物卡 + 世界观 + 文风规则，只出批注式提案 |

`continuator` 与 `reviewer` 去掉 `write_doc` 是把「默认只追加」与「只出批注」落到**工具集**上，而不是靠提示词恳求——提示词仍会写，但删掉工具是硬闸。

`StartTurnInput` 加 `profileId: string`（`z.string().max(200)`，中文拒绝句），空串按 `DEFAULT_PROFILE_ID` 处理（`agent-service.ts:201` 同风格）。`SessionMeta`（`agent-event.ts:23-31`）加 `profileId: z.string().min(1).optional()`：老 JSONL 没有这个键照样解析（zod 对象默认剥离未知键，缺可选键不报错），新线程写进去，`loadSession` 回给渲染层，重启后档案名能回来；拿不到就用该阶段的默认档案。
`BookStage` 加 `profileId: z.string().min(1).optional()`（`contracts/src/book.ts:7-10`、`:28`）。因为新增的全是**可选**字段、老文件读出来语义不变，`schemaVersion` 保持 `1`（`:34`）。规则写死：只有「老文件读出来会语义错误」时才升版本，加可选字段不升。

阶段没写 `profileId` ⇒ 用 `DEFAULT_PROFILE_ID`（一个常量，不是按阶段名分支）；渲染层从 `profile:list` 取 id，所以 IPC 上不可能出现未知档案。真出现了（被改写的载荷），主进程回落 `DEFAULT_PROFILE_ID` **并发一条 `error` 事件**（`agent-event.ts:69`，落盘、可见），绝不静默。

### 9.2 两道档案闸

1. **请求侧**：`TOOL_SPECS`（`agent-runtime/src/tools.ts:42-82`）按 `profile.allowedTools` 过滤后才进 `stream(req)` 的 `tools`。审稿/续写的请求里根本没有 `write_doc`，模型看不见它。探测已证明 `tool_calls` 在这个端点是真生效的（参数增量流式），所以这条过滤是真约束。
2. **审批侧**：`applyDecision` 在档位闸（`agent-service.ts:286-292`）之后加档案范围闸，`profileAllowsDoc(profile.writeScope, proposal.docRelPath, currentChapter)` 不过 ⇒ 返回 `{ok:false, reason:"permission-denied", message:"这条超出〈墨宸 · 审稿〉的可写范围（不写盘），提案已保留。"}`，且**不删 `pending`**（与档位闸同一姿态，总 spec §5.1 约束 3「范围是上限不是授权」）。

`currentChapter` 的取值随本片改成「这条提案所绑线程的文稿」（`agent-service.ts:290-291` 的注释预告就是这件事）。

### 9.3 上下文包

```ts
// packages/agent-runtime/src/context-pack.ts（新，无 fs、无 electron）
export interface ContextReader {
  listDocs(): DocRef[];
  readDoc(relPath: string): Promise<string | null>;      // null = 文件不存在
  charactersOf(relPath: string): Promise<string[]>;      // frontmatter 解析由主进程用 fs-store 实现
}
export interface ContextRequest {
  docRelPath: string | null;
  chapterOrder: string[];
  skillPaths: string[];
}
export interface ContextSection {
  kind: "doc" | "outline" | "characters" | "prev-chapters" | "skills" | "materials";
  label: string;                 // 中文：「本章」「第 2 卷大纲」「出场人物 · 沈砚」…
  path?: string;
  text: string;
  truncated: boolean;
}
export interface ContextPack { sections: ContextSection[]; charCount: number; estimate: number; omitted: string[] }
export async function buildContextPack(reader: ContextReader, request: ContextRequest): Promise<ContextPack>
export function estimateTokens(text: string): number   // Math.ceil(码点数 / 1.6)，UI 一律显示「约 N」
```

- **不重复造 frontmatter 解析**：`charactersOf` 由主进程实现（复用 `fs-store/frontmatter.ts`），runtime 只调接口。
- 出场人物命中 = 章节 frontmatter 的 `characters` **并上** 正文里出现的 `characters/` 文稿标题（总 spec §5 的两路命中）。
- 前情提要：常量 `PREVIOUS_CHAPTER_COUNT = 2`、`PREVIOUS_CHAPTER_TAIL_CHARS = 400`（集中在 `context-pack.ts` 顶部）；尾部切片按**码点**切，不许 `slice` 劈代理对（现仓已有这条教训，`timeline.ts:157-161`）。
- 预算与丢弃：`CONTEXT_CHAR_BUDGET = 24000` 字符。超预算按优先级从**尾部整节**丢弃：`doc > outline > characters > prev-chapters > skills > materials`，被丢的节名进 `omitted`，占用条显示「已省略 3 节（技能 · 素材）」。不做半句截断式压缩。
- 装配收口：`AgentServiceDeps.promptFor` 改成 `promptFor(context: PromptContext): Promise<string>`（`agent-service.ts:65-73`、`:453`），`PromptContext` 加 `profileId`、`skillPaths`、`chapterOrder`；`defaultPromptFor`（`:48-63`）**删除**，由 `apps/desktop/src/main/book-prompt.ts` 提供 `createBookPromptAssembler({ book, reader, profiles })`。连带必须同任务改完的调用方：`main/index.ts:60`、`agent-service.test.ts:687,699` 等所有夹具（铁律 5：中间提交也要能过 tsc）。
- 占用条：装配只在主进程发生，而占用条要在**发送前**随章节/档案/挂入技能变化，所以开一条只读预览通道：`IPC_CHANNELS.agentContextPreview = "agent:context-preview"`，`RendererApi.contextPreview(input: ContextPreviewInput): Promise<ContextSummary>`。`ContextSummary`/`ContextSectionView`/`CONTEXT_SECTION_KINDS` 放 `packages/contracts/src/context.ts`（渲染层禁止 import runtime，只吃视图形状）；`contextSummaryOf(pack): ContextSummary` 放 `context-pack.ts`，主进程只转发。因此本片 IPC 数是 **13 → 17 → 19**（§13 已按此计）。渲染层纯函数 `utils/context-bar.ts`：`formatContextBar(summary: ContextSummary): string` → 「上下文 · 6 节 · 约 9,800 字 · 约 6,100 token」；渲染在 `CenterColumn.vue` 头部下方一行，详情随 `/status` 展开。档案/上下文数据由 store 持有，`CenterColumn.vue` 现 223 行，接线仍不到 800 行预算的一半，但新控件一律分文件。

## 10. 阶段切换、档案选择器与「浏览不打断」（波 2/3）

- 中栏头部（替换 `CenterColumn.vue:58-61` 的 `agentLabel`）：两个选择器「阶段」与「档案」，都读 `profile:list` / `book.meta.stages`；显示「阶段 正文 · 档案 墨宸 · 主笔」。
- 切阶段 ⇒ `saveMeta({ ...meta, activeStage })`，并把档案切到该阶段的 `profileId ?? DEFAULT_PROFILE_ID`。切档案 ⇒ **不换线程**（`threadKeyFor(activeDocTab)`，`useAgentStore.ts:61`）：这是总 spec §5.1 约束 1，必须有断言：切档案前后 `threadKey` 与 `items.length` 一字不变。
- 浏览不打断（总 spec §4 的写死规则，波 3 补齐四条断言，全部落在可 node 单测的 store 层）：
  1. 打开素材/技能浏览标签不改 `docTabs`、`activeDocTab`、`rightPaneMode === "manuscript"` 侧的任何草稿字段；
  2. 关闭浏览标签不产生状态变化（除 `browseTabs`/`activeBrowse` 自身）；
  3. 浏览与挂入都不动当前线程的 `items`/`running`；turn 正在跑时开浏览标签**不触发打断**（Plan 2 波 A 修过的 F-2 行为，此处补保护性断言）；
  4. 「加入当前上下文」是唯一让技能进入上下文的动作，选中技能行不产生任何装配效果。

## 11. 技能库只读浏览、显式挂入与自动推荐（波 3；自动推荐为 2026-10-17 追加）

- 两个来源：全局 `<appData>/mochen-ai/skills/<名>/SKILL.md` + 书内 `.mochen/skills/<名>/SKILL.md`。
- `fs-store` 新增纯函数（**不动 `scanBook`**——`.mochen` 被 `scan.ts:18` 跳过是既有正确行为，文稿扫描不该看见会话/备份/技能）：

```ts
export interface SkillRef {
  id: string;                 // `${source}:${dirName}`
  source: "global" | "book";
  dirName: string;
  displayName: string;
  description: string;
  stages: string[];           // frontmatter `stage`
  appliesTo: string[];
  relPath: string;            // `<dirName>/SKILL.md`
}
export async function scanSkills(dir: string, source: "global" | "book"): Promise<SkillRef[]>;
```

frontmatter 解析复用 `fs-store/frontmatter.ts`。id 冲突时书内优先，`listSkills` 返回合并去重表（技能名与显示名都是用户可见中文，直接进 UI）。
- 契约：`IPC_CHANNELS` 加 `skillsList: "skills:list"` / `skillsRead: "skills:read"`；
  `listSkills(): Promise<SkillRef[]>`、`readSkill(source: "global" | "book", relPath: string): Promise<{ relPath: string; content: string; truncated: boolean }>`。
- 读取安全（三条都要反向用例）：`relPath` 必须是 `<单层目录名>/SKILL.md`，文件名一字不差；解析后必须仍在该 skills 目录内（越界中文拒绝，复用 `fs-store/paths.ts` 的守卫思路）；不跟随符号链接出目录。单文件读上限 64 KB，超出 `truncated: true`。
- 挂入：`useAgentStore` 存 `skillPathsByThread: Record<threadKey, string[]>`（内存态，重启清空并在 UI 说明）；`StartTurnInput` 加 `skillPaths: string[]`（`z.array(z.string().min(1).max(300)).max(12)`，中文拒绝句）；`buildContextPack` 把它们渲染成 `kind: "skills"` 节，技能正文读不到 ⇒ 跳过并 emit 一条 `error`「有 N 个挂入技能读不到，已跳过」（总 spec §9：失败可见，不只进日志）。
- UI：左栏加「技能库」入口（第五类文稿 `material` 的树不动，技能不是 `BookKind`）；技能行走浏览标签只读渲染，卡脚一个「加入当前上下文」按钮 + 已挂入标记。没有编写、删除、导入按钮。
- 自动推荐得分（2026-10-17 追加，`apps/desktop/src/renderer/src/utils/skill-pick.ts`）：上面那条「挂入是**唯一**让技能进入上下文的动作」的口径**不因此改动一个字**——本节新增的是**推荐**，不是**挂入**。`rankSkills(candidates, scene, limit, pinned)` 是纯函数、无状态、零 IPC：拿三路正信号（技能 `stage` 命中当前阶段名 +40、`appliesTo` 命中当前文稿 kind +30、指令二元字命中技能标题/说明每词 +8 且封顶 24）打分，排除已挂入的、去掉 0 分、同分按 id 升序、按 `SKILL_PATHS_MAX`（12）取前 N。**推荐不越过用户批准**：它只产出一张排序清单，真正进上下文仍只有「加入当前上下文」钮这一条路（spec §10 第 4 条）。`stage`/`appliesTo` 按 contracts 的既有声明「只作提示、不作闸门」——只当正信号，不给未命中的轴扣分。
- 自动推荐落点（2026-10-17 追加）：技能页顶上一条「推荐」条（`ExtensionsPage.vue`，`v-if` 有推荐才显形）。现场三项现取——阶段名 `activeStageOf(book.meta)?.name`、文稿类 `book.docs` 里当前活动文稿的 `kind`、指令 `agent.draftOf(threadKey)`——装配走 `useExtensionBrowseStore.skillRecommendations`（模板只 v-for）。每枚推荐摆出 `displayName` + 中文理由 + 一颗「挂入」；挂入仍只走 `toggleSkillForThread`，且**只在点击时**发生（无 watcher、无自动挂入）。
- **模型自选载入（2026-10-23，用户裁定放宽本节开头那条底线）**：上面「挂入是唯一让技能进入上下文的动作」在此**扩成两条路**——① 用户显式挂入（原路，未改）；② 模型经 **`use_skill` 工具**自选载入（新路）。工具名在 `packages/contracts/src/tools.ts` 的 `AGENT_TOOL_NAMES`（第 8 枚）、规格在 `packages/agent-runtime/src/tools.ts` 的 `TOOL_SPECS`、执行在 `apps/desktop/src/main/doc-tools-host.ts` 的 `call`：不带参数 ⇒ 列技能库（id + 名称 + 说明），带 `skill`（id）⇒ 用 `skillService.read` 载入正文，当一条工具回执给模型。**只读**：不写盘、不进文稿树。
  【为什么放宽】用户要的是「开启自动，让它自动调用合适的技能写作」——原来的「只能手选挂入」把这条挡住了。放宽范围**仅限只读载入**：技能只影响模型这一轮怎么写，不改用户作品；写盘仍受 `propose_patch` / `write_doc` 的逐条批准与权限档约束（§10 第 4 条的底线没动）。上一条「自动推荐」仍只排序、不自动挂入——本刀加的是**工具**，不是自动挂入。

## 12. F-4 · 磁盘路径迁移（波 3）

现状只有一处代码字面量：`apps/desktop/src/main/index.ts:43` `path.join(app.getPath("appData"), "mochen-writing")`。目标目录名 `mochen-ai`（与 `package.json` 的 `mochen-ai` 一致）。

新增 `apps/desktop/src/main/app-data-migration.ts`，依赖全注入（fs 用 `node:fs/promises`，cipher 用现有 `Cipher` 接口，`credential-store.ts:4-8`）：

```ts
export interface AppDataMigrationDeps {
  oldDir: string;
  newDir: string;
  copyFile(src: string, dest: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  cipher: Cipher;
}
export type AppDataMigrationReport =
  | { status: "nothing-to-do" }
  | { status: "migrated"; movedFiles: string[]; keptOldDir: string }
  | { status: "kept-old"; reason: string };   // 永不返回「已删除」，因为没有删除这条码路
export async function migrateLegacyAppData(deps: AppDataMigrationDeps): Promise<AppDataMigrationReport>;
```

流程（顺序不可调换，§15 变异 M5 就是钉这个）：

1. 旧目录不存在 ⇒ `nothing-to-do`（新装用户与已迁移用户都走这条）。
2. 只搬已知的三个文件名：`config.json`、`secrets.enc`、`appearance.json`（存在才搬）。**不做递归整目录拷贝**——未知文件搬进新目录等于把来历不明的字节放到会被读取的位置。搬前先 `mkdir(newDir, {recursive:true})`。
3. 验证：读新目录的 `secrets.enc`，用 `cipher.decrypt` 解出非空字符串。`cipher.available === false`（safeStorage 不可用）⇒ 直接 `kept-old`，原因「密钥保管当前不可用，已保持原目录，未做任何改名」。解密失败 ⇒ 同样 `kept-old`。
4. **只有第 3 步成功**才把旧目录改名为 `mochen-writing.migrated-<YYYY-MM-DD>`；若该名已占用，追加 `-HHmmss`。旧目录永远只改名、不删除。
5. 返回报告；已迁移过一次（旧目录不存在）⇒ `nothing-to-do`，重复运行安全。新目录里可能留下第 2 步的副本，那是幂等重跑的无害结果，写进注释。

播报（不加 IPC 通道）：`main/index.ts` 在 `app.whenReady()` 里、构造 credential store **之前**跑迁移，然后用 `dialog.showMessageBox` 报一句中文——`migrated`：「墨宸 AI 的设置目录已迁到 …\\mochen-ai；旧目录已保留为 …\\mochen-writing.migrated-2026-10-02，确认无误后可自行删除。」；`kept-old`：「设置目录迁移没有进行（原因…），应用仍在使用旧目录。」。这一步必须在建 store 之前，否则同一次启动会先读旧目录、迁移就变成「下次才生效」，而用户会以为已经搬完。

文档同步范围（只改「现状」表述，不改写历史结论）：总 spec §8 的 `%APPDATA%\mochen-writing\secrets.enc` 与 §3 的 `~/.mochen-writing/skills/` 改成新路径并加一句迁移说明；`docs/superpowers/plans/README.md:25` 的 F-4 条勾掉；`2026-10-02-plan2-smoke-report.md` 的 F-4 行就地加「已在 Plan 3 处理」更正注。Plan 1/Plan 2 计划正文里的历史引述不动。

## 13. 契约变更总表

| 项 | 现值 | 波 1 后 | 波 2 后 | 波 3 后 |
| --- | --- | --- | --- | --- |
| `IPC_CHANNELS` 键数 | 12 | 13（+`agent:load-session`） | 17（+`profile:list` `agent:context-preview` `appearance:get` `appearance:save`） | 19（+`skills:list` `skills:read`） |
| `RendererApi` 方法数 | 12 | 13 | 17 | 19 |
| `PROPOSAL_STATUSES` | 6 | 7（+`expired`） | 7 | 7 |
| `StartTurnInput` 字段 | 4 | 4 | 5（+`profileId`） | 6（+`skillPaths`） |
| `SessionMeta` | 6 | 6 | 7（+`profileId?`） | 7 |
| `BookStage` | 2 | 2 | 3（+`profileId?`） | 3 |
| `book.json` `schemaVersion` | 1 | 1 | 1 | 1（可选字段不升版本） |
| `ThreadView` 字段 | 7 | 10（+`hydrated` `hydrating` `queued`） | 10 | 10 |
| 用例数（目标值，非承诺） | 353 | ≥400 | ≥440 | ≥470 |

新增的六个字段/类型一律 `as const` + 派生类型 + `Record<联合类型, string>` 标签表（铁律 6）；跨 IPC 的取值处保留运行期兜底。

## 14. 门禁连带清单

改共享契约必须同任务改完消费方（否则中间提交过不了 tsc）：

- `renderer-api.test.ts:101` 的 `expect(calls.length).toBe(12)` 与 `:132` 的注释 → 13 / 17 / 19，**字面量**（该文件刻意不从 `IPC_CHANNELS` 派生期望值）。
- `useBookStore.test.ts:12` 附近 `satisfies RendererApi` 夹具、`useAgentStore.test.ts:28` 的 meta 夹具、`agent-service.test.ts:264-282,687,699`、`turn-e2e.test.ts:88-106`、`book-service.test.ts:17-23` 的 `book.json` 夹具与 `promptFor` 注入。
- `contracts/src/index.ts` barrel 加导出。
- `tools/check-source-line-budget.mjs`（800 行，含 `.vue`）：新组件一律新文件；`CenterColumn.vue` 223 行起步，接线后不得超过 400 行。
- `tools/check-package-boundary.mjs`：`agent-runtime` 的 `ContextReader` 是注入接口，runtime 不 import `fs`/`electron`。
- 每波收尾：`corepack pnpm verify`（含 `prettier . --check`）→ 回读日志 `VERIFY_EXIT=0` 与 `Tests N passed`，不许用 `| tail` 吞掉退出码。

## 15. 测试与变异（断言必须能失败）

每波一条以上主变异；反向用例先红后绿，评审者自己重跑变异，不采信实现者日志。变异只用 Edit 改代码，禁 `perl -i`/`sed -i`。

| 编号 | 断言点 | 变异动作 | 预期 |
| --- | --- | --- | --- |
| M1 | 回放复用同一归约器且不白打 diff IPC | 把 `ensureHydrated` 里改成 `fetchDiff: true` | 「旧卡不请求 diff」的用例转红（假 API 计数 > 0） |
| M2 | `expired` 不计待审、不进「已裁决」组 | 把未配对卡仍留 `pending` | 待审数与分组的断言双双转红 |
| M3 | 只有 `interrupted` 结尾才复活「继续」 | 让 `error` 结尾也标 `endedAs="failed"` | `canContinue` 组合用例转红 |
| M4 | 输入法合成期间一律不截键 | 去掉 `isComposing` 闸门 | 「候选框回车不该提交」转红 |
| M5 | 迁移先验解密、后改名 | 调换步骤 3 与 4 的先后 | 「解密失败必须保留旧目录原名」转红（这是本片最贵的一条） |
| M6 | 档案范围闸 | 删掉 `applyDecision` 里的档案闸 | 审稿档案批准 `write_doc` 不再被拒，转红 |
| M7 | 工具按档案过滤 | `TOOL_SPECS` 不过滤直传 | 断言「审稿的 `tools` 里没有 `write_doc`」转红 |
| M8 | 上下文超预算整节丢弃 | 去掉丢弃分支、只截半句 | `omitted` 与非半句截断断言转红 |
| M9 | 主题 `mode !== "system"` 时不跟系统 | 无条件保留 `matchMedia` 监听 | 「锁浅色后系统切深色不变色」转红 |
| M10 | 技能读取不越界 | 去掉 `SKILL.md` 文件名与目录内检查 | 越界与坏文件名反向用例转红 |
| M11 | 切档案不换线程 | 让档案进 `threadKey` | 「切换后 `items.length` 不变」转红 |
| M12 | 档位文案一处来源 | 在渲染层另写一份三元链 | tsc 探针（`Record<PermissionMode, string>` 键不全）+ 查表用例红 |

单元层新增覆盖：`hotkeys.test.ts`（焦点 × 键的组合矩阵，含 `Ctrl+1..9` 越界）、`slash-commands.test.ts`、`context-pack.test.ts`（reader 用假 fs）、`profiles.test.ts`（六条 roster 的 `allowedTools ⊆ AGENT_TOOL_NAMES`、`writeScope` 与花名册表逐条对照）、`app-data-migration.test.ts`（三态 + 幂等重跑）、`useAppearanceStore`/`theme-mode.test.ts`。
既成约束照旧：本仓不引 `@vue/test-utils`，`.vue` 模板零自动化覆盖，判定逻辑一律下沉 `utils`/`stores`（波 A 评审 P3 #4 的记录仍然成立）。

## 16. 真机冒烟清单（控制方亲自操作，不委托）

端点：`https://apihub.agnes-ai.com/v1`，模型 `agnes-2.5-pro`（探测已证：SSE 流式、独立 `delta.reasoning_content`、`tool_calls` 可用且参数增量流式）。
密钥纪律照旧且不可协商：**只在设置对话框里输入**，经 safeStorage 落 `secrets.enc`；绝不写进命令行、日志、tmp、spec、plan 或记忆；渲染层只见 `maskApiKey`。本次会话里出现过的密钥串必须在冒烟后轮换，并在冒烟报告里记一句「已提醒轮换」。

1. 打开书 → 发一轮 → 关闭应用 → 重开：**中栏线程、工具卡、提案卡回来了**，卡头是「第 N 轮 · …」而不是「本轮」，旧未裁决卡在「上次会话未处理」折叠组里且按钮禁用。
2. 打断一轮后重启 → 「继续」按钮在位且真能续写。
3. 键位逐项实操：`Enter`/`Shift+Enter`/`Ctrl+J`、运行中 `Tab` 排队、`y`/`a`/`p`/`d`、`Ctrl+PageDown/Up`、`Ctrl+1..9`、`Ctrl+B`、`Ctrl+,`、`/`（`Esc` 按总 spec §6.2 三态各验一次）。中文输入法候选框回车**不提交**，这一条必须实跑。
4. 权限档：只读 → 可改当前章 → 全开，各批准一条提案；只读档下拒绝句与 UI 落点对得上；切档后仍留 `pending` 的提案可批准，已拒绝的不回来。
5. 外观：三态各截一张图，重启保持；跟随系统时切系统主题当场变色。
6. 档案：六个档案逐个切一次，用本地 mock-provider 的 `/__requests` 抓 `system` 内容与 `tools` 数组，证明提示词与工具集随档案变化；审稿档案下让模型试 `write_doc` → 请求里没这工具，且批准时被中文拒绝、提案保留。
7. 上下文占用条随章节/挂入技能变化；超预算时「已省略 N 节」如实出现。
8. 技能库：全局 + 书内各一条，只读预览正常，「加入当前上下文」后模型答复引用到该技能内容；浏览与挂入全程不打断进行中的一轮。
9. F-4：真机跑一次迁移（旧目录只改名不删），核对 `secrets.enc` 迁后仍能解密、设置对话框仍显示同一掩码、旧目录名带日期后缀留在原地。

## 17. 明确不做（含理由）

- `/compact` 与 boundary 边界机制：需要模型调用 + 落盘语义 + 「后续只读边界后」的历史裁剪，是一套独立机制；塞进本片会让回放和压缩互相依赖。随 `/fork` `/usage` `/export` `/new` 一起留给后续切片，面板里不出现。
- 跨重启复活「可批准的待审队列」：见 D1 的风险论证。
- 全书检索面板（`Ctrl+Shift+F`）：`search_docs` 现在长在 host 里（`doc-tools-host.ts:119`），要先把检索做成 fs-store 纯函数 + 结果面板 + 定位高亮，与本片主线正交；本片连键位都不绑，不留占位。
- 前情提要条数/长度的用户可调：先按总 spec §5 的默认值（前 2 章 × 400 字）取常量，集中在 `context-pack.ts` 顶部，等设置面板有统一容器再接。
- 技能编写/导入/删除 UI；技能市场。
- 字号、字体、半透明等自定义外观控件（契约里有，UI 不做）。
- 按书保存外观（`mode` 是全局用户偏好，不进 `book.json`）。
- 多档案并行会话、子代理编排、自动发表（总 spec §1 非目标延续）。

## 18. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 回放与实时事件顺序混排（水合未完用户已发消息） | `ensureHydrated` 在 `running` 时直接返回；水合期间禁 composer 发送（`ready` 计算里加「本线程水合未完成」），失败原因可见 |
| 旧 JSONL 缺 `profileId` 导致档案名回来错乱 | 该字段可选 + 回落阶段默认档案 + 回落时发可见 `error`；测试覆盖老文件（无该键）解析 |
| 档案范围闸与档位闸叠加后拒绝原因难懂 | 两句拒绝文案分开且点名来源（「权限档…」/「档案〈…〉的可写范围…」），各一条定稿整句用例（沿用 `permission.test.ts:43-48` 的 toBe 钉法） |
| 上下文包读文档变多，装配变慢或读到半成品 | `ContextReader.readDoc` 只读、失败返回 null 即跳节；占用条显示省略数；不做缓存（书目录随时被外部改） |
| F-4 改名后用户自己删了旧目录又反悔 | 迁移播报明说「确认无误后可自行删除」，且旧目录留日期后缀；迁移永不删除 |
| 新组件把判定逻辑写回 `.vue`，重蹈零覆盖盲区 | 简报里写死：判定进 `utils`/`stores`，组件只接线；评审检查 `CenterColumn.vue` 行数与新增纯函数测试数量 |
| safeStorage 在某些机器不可用 | 迁移第 3 步直接 `kept-old` 并给出中文原因，应用继续用旧目录（可用优先于改名） |
| 端点密钥在会话里已暴露 | 冒烟后轮换；本次不写进任何仓库文件；报告只记 baseURL 与模型名，不记凭据 |

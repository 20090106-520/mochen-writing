# 2026-11-20 写作智能升级（全书状态卡 / 多模型分工 / 检索增强）

## 1. 背景与现状

用户要求「看看还有什么可以优化或能让它更智能的地方」，并确认先做三件：

1. **全书滚动摘要 + 人物状态卡**：章末摘要写回时顺带产出「全书一句话摘要 + 主要人物当前状态」，每轮固定注入上下文。
2. **多模型分工 + 失败回退**：写作与后台杂活（摘要 / 全书状态）分开用模型，强模型不可用时降级到可用模型。
3. **本地检索增强**：让模型不必整章读盘就能找到全书事实。

现状核查结论（决定本 spec 的形态）：

- 章末摘要已有：`apps/desktop/src/main/chapter-recap.ts` 的 `createChapterRecap` / `createRecapQueue`，写回 `BookMeta.recaps`，装配层经 `recapOf` 注入前情。
- 模型配置只有「一条启用档案」：`ProviderSettings.config()` / `apiKey()`；`ProviderStoreFile` 已有 `connections + profiles`，但每条档案只有启停，没有「按用途选模型」。
- **`search_docs` 已经存在**，能按 `kind` 搜全部文稿（含 `chapters/`、`characters/`、`foreshadow/` 等），并带回逐行 / 按篇两种回执。因此**不再新增 `search_book`**（会形成第二份检索判据，违反铁律 6）；改为补齐它搜不到的两类事实：**故事圣经条目**与**章末摘要**。
- `doc-tools-host.ts` 已 791 行，贴着 800 行预算，检索实现必须外移而不是继续堆。

## 2. 目标

- A. 写完一章后，后台在摘要之外再产出一份**全书摘要 + 人物状态卡**，写入 `book.json`，并每轮进入系统提示（不占「已装配的上下文」条目额度，但如实计入 token 统计）。
- B. 用户可在模型设置里指定「后台杂活模型」；写作轮与摘要 / 状态卡分别取配置；任一侧配置不可用时按固定顺序降级到可用档案。
- C. `search_docs` 同一次调用即可搜到正文、故事圣经、章末摘要，回执标明来源与「不是文件」的说明；不新增工具名。

## 3. 非目标

- 不做「按智能体档案分别指定模型」（档案是人设，不是模型分工；本仓目前只有写作轮与后台杂活两条模型通路）。
- 不做运行中 HTTP 失败的自动重发（会带来半轮重放、重复提案与重复计费）；失败回退发生在**取配置**这一步：角色模型不可用 → 备用档案 → 主档案。
- 不新增 `ContextKind`，不改占用条的分组枚举。
- 不改渲染层正文编辑器 / 体检规则。

## 4. A. 全书摘要 + 人物状态卡

### 4.1 数据形状（contracts）

文件：`packages/contracts/src/book.ts`

```ts
export interface BookDigest {
  /** 全书一句话摘要（≤ BOOK_DIGEST_SUMMARY_MAX_CHARS）。 */
  summary: string;
  /** 主要人物当前状态，一行一人（≤ BOOK_DIGEST_CAST_MAX_CHARS）。 */
  cast: string;
}

export const BOOK_DIGEST_SUMMARY_MAX_CHARS = 120;
export const BOOK_DIGEST_CAST_MAX_CHARS = 600;
```

- `BookMeta` 增加可选字段 `digest?: BookDigest | undefined`。
- `bookMetaSchema` 增加可选 `digest` 对象（两个字符串，各带 `max`），老书缺这一格照常解析。
- 新增纯函数 `parseBookDigest(raw: string): BookDigest | null`：
  - 认两段标题：`【全书摘要】` 与 `【人物状态】`；
  - 摘要取两段标题之间的内容；人物状态取 `【人物状态】` 之后的全部内容；
  - 无摘要标题或摘要为空 ⇒ `null`；
  - 人物段允许为空（第一章还没人物也可接受），结果按上面的上限截断；
  - 该函数是**唯一**的解析判据，主进程不另写正则。

### 4.2 生成（main）

文件：`apps/desktop/src/main/chapter-recap.ts`

- 新增常量 `DIGEST_SYSTEM_PROMPT`：

  ```
  你是长篇小说的资料助手。根据「上一份全书状态」和「刚写完这一章的摘要」，
  更新全书状态。严格按下面两段输出，不要别的内容：
  【全书摘要】一句话说清故事推进到哪里（不超过 120 字）。
  【人物状态】一行一人，格式「- 人名：身份/处境/目标/关系变化」；
  只写主要人物，每人不超过 40 字，没有就留空。
  ```

- `ChapterRecap` 增加方法：

  ```ts
  digestize(input: {
    title: string;
    recap: string;
    previous: BookDigest | null;
  }): Promise<BookDigest | null>;
  ```

  - 用与 `summarize` 相同的 `configFor("utility")`（见 B 节）取地址 / 模型 / 密钥；
  - 60 秒超时、`thinkingLevel: "off"`、无工具、无联网；
  - 输入只含 `previous.summary`、`previous.cast`、章节标题与本章摘要（不重读正文）；
  - 输出交给 `parseBookDigest`；解析失败 / 上游失败 / 无配置一律回 `null`，绝不抛。

- `RecapBook` 改为：

  ```ts
  current(): { docs: readonly { relPath: string; title: string }[]; meta: { digest?: BookDigest } } | null;
  mergeDigest(digest: BookDigest): Promise<void>;
  ```

- `createRecapQueue` 在 `mergeRecaps` 成功之后串行更新状态卡：
  - 模块内维护 `let digestChain: Promise<void> = Promise.resolve()`；
  - 每章排队：`digestChain = digestChain.then(async () => { const previous = deps.book.current()?.meta.digest ?? null; const next = await deps.recap.digestize({title, recap: text, previous}); if (next !== null) await deps.book.mergeDigest(next); })`；
  - 串行保证「两章同时写完」时不会拿同一份 previous 互相覆盖；
  - 任一步失败只 `console.warn`，不影响下一章。

### 4.3 写回（main）

文件：`apps/desktop/src/main/book-service.ts`

- `BookService` 增加 `mergeDigest(digest: BookDigest): Promise<void>`。
- 实现与 `mergeRecaps` 完全同构：在 `enqueueMetaWrite` 里现取最新 `snapshot`，换书 / 关书后安静丢弃；只并 `digest` 一格，绝不整份回写。

### 4.4 注入（main）

文件：`apps/desktop/src/main/system-pack.ts`

- 导出 `bookDigestBlock(digest: BookDigest | null | undefined): string`：
  - `digest` 为空或 `summary` 为空 ⇒ `""`；
  - 否则输出：

    ```
    【全书摘要与人物状态】
    一句话：<summary>
    人物：
    <cast>
    ```

    `cast` 为空时只输出前两行。
- `ContextPackInput` 增加 `digest?: BookDigest | null | undefined`；
- `buildContextPack` 把它放在**最前面**（在「已装配的上下文」之前），保证每轮固定可见。

文件：`apps/desktop/src/main/agent-service.ts`

- 组装上下文包时传入 `digest: current.meta.digest ?? null`。

文件：`apps/desktop/src/main/agent-context-preview.ts`

- 用 `bookDigestBlock(current.meta.digest)` 取同一段文本；
- `chars` / `approxTokens` 加上它的长度与估算；
- `empty` 增加 `&& digestBlock === ""` 的条件（占用条不瞒报）。

### 4.5 测试

- `packages/contracts/test/book-digest.test.ts`：两段解析、缺段回 null、超长截断、`bookMetaSchema` 可解析含 / 不含 `digest` 的 meta。
- `apps/desktop/src/main/chapter-recap.test.ts`：
  - `digestize` 成功回解析后的对象；
  - 解析失败 / 上游失败 / 无配置回 null 且不抛；
  - 队列在摘要成功后调用 `mergeDigest`，且两章并发时第二份拿到第一份写回的 previous（用延迟控制顺序断言）。
- `apps/desktop/src/main/system-pack.test.ts`：有 / 无 digest 两态；digest 段在上下文段之前。
- `apps/desktop/src/main/agent-service-prompt.test.ts`：可选补一条「系统提示含全书摘要」的接线断言（若夹具已传递 meta，则直接加）。

## 5. B. 多模型分工 + 失败回退

### 5.1 契约与存储形状

文件：`packages/contracts/src/provider.ts`

- `providerStoreFileSchema` 增加可选 `utilityProfileId: z.string().min(1).optional()`；
- 在同一条 `superRefine` 里校验：`utilityProfileId` 必须指向 `profiles` 里真实存在的一条；
- `ProviderView` 增加 `utilityProfileId?: string`；
- 新增 `setUtilityProfileInputSchema = z.object({ profileId: z.string().min(1).nullable() })`（`null` = 跟随主模型）；
- v1 / v2 迁移产物不写这一格（老配置行为不变）。

### 5.2 取配置与降级（main）

文件：`apps/desktop/src/main/provider-settings.ts`

- `ProviderSettings` 增加：

  ```ts
  configFor(role: "chat" | "utility"): Promise<{ config: ProviderConfig; apiKey: string } | null>;
  setUtilityProfile(profileId: string | null): Promise<ProviderView>;
  ```

- `configFor` 解析顺序（唯一判据住在这一处）：
  1. `chat` ⇒ 启用中那条档案；`utility` ⇒ `utilityProfileId` 指向的档案；
  2. 目标档案不存在、连接不存在或该连接读不到密钥 ⇒ 退到启用中那条档案；
  3. 启用档案也不可用 ⇒ 按 `profiles` 顺序取第一条「连接存在且能读到密钥」的档案；
  4. 全不可用 ⇒ `null`（调用方回现有中文错误）。
- `config()` / `apiKey()` 保留，内部改为 `configFor("chat")` 的两个投影，避免两套判定。
- `setUtilityProfile`：`null` 删除该键；非 null 必须命中现有档案，否则抛单句中文。
- `removeProfile` / `removeConnection`：被删的档案若正是 `utilityProfileId`，一并清掉该键，避免悬空引用。
- `view()` 只在 `utilityProfileId` 仍有效时回传它。

### 5.3 使用点

- `agent-service.ts`：写作轮改为 `const resolved = await deps.settings.configFor("chat")`，`config` / `apiKey` 都从这一份取；失败文案沿用现有三句。
- `chapter-recap.ts`：摘要与状态卡改取 `configFor("utility")`，取不到时回 null（不回退到写作轮？——取配置本身已经在 `configFor` 里回退过，所以这里只处理「真的全都没有」）。

### 5.4 IPC 与设置面板

- `packages/contracts/src/ipc-channels.ts`：新增 `providerSetUtility`（形如 `"provider:set-utility"`，与现有命名一致）。
- `apps/desktop/src/main/agent-ipc.ts`：在 `registerProviderIpc` 里用既有 `handleTrusted` + `setUtilityProfileInputSchema` 注册，错误走 `firstIssueMessage` 的中文单句。
- `apps/desktop/src/preload/*`：暴露 `provider.setUtility(profileId | null)`。
- `apps/desktop/src/renderer/src/stores/useProviderStore.ts`：增加 `setUtility(profileId)`，成功后刷新 view。
- `apps/desktop/src/renderer/src/components/ProviderSettings.vue`：在模型面板顶部加一行「后台杂活模型」下拉：
  - 选项：`跟随主模型`（空值）+ 全部档案（`连接名 · 模型名`）；
  - 说明文案：用于章末摘要与全书状态卡，省钱 / 提速；写作仍用主模型。
- 现有「启用」开关语义不变。

### 5.5 测试

- `provider-settings.test.ts`：
  - `configFor("utility")` 命中指定档案；
  - utility 档案被删 / 连接坏 / 无密钥时回退到启用档案；
  - 启用档案不可用时回退到第一条可用档案；
  - `setUtilityProfile` 写入与清空；`removeProfile` 清掉悬空引用。
- `ipc-guard-coverage.test.ts`：新通道计入已授权清单。
- `provider-settings-wiring.test.ts` / `useProviderStore.test.ts`：按新方法与新下拉更新夹具。
- `chapter-recap.test.ts`：断言摘要调用取的是 `configFor("utility")`。

## 6. C. 检索增强（不新增工具）

### 6.1 外移检索实现

新文件：`apps/desktop/src/main/doc-tools-search.ts`

- 把 `doc-tools-host.ts` 里 `search_docs` 那一段（`SEARCH_LIMIT_*`、`SearchHit`、`searchLimitOf`、`searchReceipt`、精确 + 容错两轮扫盘）整体搬过来；
- 对外只暴露一个入口：

  ```ts
  export interface SearchSources {
    docs(): readonly DocRef[];
    root(): string | null;
    bible(): readonly BibleEntry[];
    recaps(): Readonly<Record<string, string>>;
  }

  export async function runSearchDocs(
    sources: SearchSources,
    args: Record<string, unknown>
  ): Promise<ToolOutcome>;
  ```

- `doc-tools-host.ts` 只保留一行转发：`if (name === "search_docs") return runSearchDocs(deps, args);`
- `DocToolHostDeps` 增加可选 `bible?: () => readonly BibleEntry[]` 与 `recaps?: () => Readonly<Record<string, string>>`。
- 行数收益：host 从 791 行降到约 690 行，新模块约 190 行，两边都在预算内。

### 6.2 搜索范围与回执

- 新增可选参数 `source`：`"docs" | "bible" | "recaps" | "all"`，缺省 `"all"`。
- `docs`：与现状逐字一致（`kind` 过滤、`group=line|doc`、`limit`、精确后容错）。
- `bible`：在 `deps.bible()` 里按 `title` / `id` / `body` 匹配查询词；命中行形如：

  ```
  - 设定·人物·林夜（bible:character:linye）：身份：…… 
  ```

  回执末尾固定一句：`（设定库条目不是文稿，要修改请到设定面板，不要用 read_doc。）`
- `recaps`：在 `deps.recaps()` 的每个值里按行匹配；命中行形如：

  ```
  - 前情·chapters/03-夜航.md：林夜把船票塞进衣襟……
  ```

- `all`：三类合并，共用同一个 `limit`（默认 20 / 上限 50）；回执按「正文 / 设定库 / 前情摘要」分节，没有命中的节不出现。
- 容错兜底只在 `docs` 精确零命中时跑，且回执如实说明「容错命中」。
- `kind` 仅作用于 `docs`；`source=bible|recaps` 时忽略 `kind` 并在回执里说明。

### 6.3 接线与工具说明

- `agent-service.ts` 构造 `createDocToolHost` 时：
  - `bible: () => { const snap = deps.book.current(); return snap === null ? [] : readStoryBibleEntries(snap.root); }`
  - `recaps: () => deps.book.current()?.meta.recaps ?? {}`
  - 需要时把 `readStoryBibleEntries` 作为可注入依赖传入（默认实现即该函数），便于测试。
- `packages/agent-runtime/src/tool-loop.ts`（`search_docs` 的工具声明处）：更新描述，明确「一次可搜正文 / 设定库 / 前情摘要，找事实优先用它，别整章 read_doc」。只改描述字符串，不改工具名与参数类型。

### 6.4 测试

- `doc-tools-search.test.ts`（改为直接测新模块）：
  - 原有精确 / 容错 / kind / group / limit 用例全部保留；
  - 新增 `source=bible`、`source=recaps`、`source=all` 三类用例与「设定库条目不是文稿」提示；
  - `kind` 对 bible/recaps 被忽略时的回执说明。
- `doc-tools-host.test.ts`：保留一条转发冒烟用例。

## 7. 验证

1. 逐包相关用例：
   - `pnpm vitest run packages/contracts/test/book-digest.test.ts`
   - `pnpm vitest run apps/desktop/src/main/chapter-recap.test.ts apps/desktop/src/main/system-pack.test.ts apps/desktop/src/main/doc-tools-search.test.ts apps/desktop/src/main/provider-settings.test.ts`
   - 渲染层：`useProviderStore` / `provider-settings-wiring` / `ipc-guard-coverage`
2. 门禁：`pnpm verify`（prettier → 6 个 tsc → eslint --max-warnings=0 → 包边界 → 800 行预算 → vitest）。
3. 构建：`pnpm build`。
4. 行数确认：`doc-tools-host.ts` < 800；`doc-tools-search.ts` < 800；`chapter-recap.ts` < 800。

## 8. 风险与取舍

- **摘要成本**：每章多一次小调用（输入只有上一份状态 + 本章摘要），失败即跳过，不阻塞写作。
- **状态卡漂移**：只在章末摘要成功后更新；用户手改正文不会触发，直到下一次写盘——与现有摘要行为一致。
- **多模型只到「配置层降级」**：运行中 HTTP 失败不自动重发，避免重复提案与重复计费；这条在 B 节非目标里写明。
- **检索回执变长**：`all` 共用 20 条上限，且按节省略空节；不会整本倾倒。

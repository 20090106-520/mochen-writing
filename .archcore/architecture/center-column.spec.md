---
title: "Center column: thread wiring, header actions, workbench entry and the mounted subscription"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「中栏这一壳怎么接」有规范力：`apps/desktop/src/renderer/src/components/CenterColumn.vue` 这一份组件——对话头（报当前档案名 + 主上下文）、`conversation-scroll-shell` 骨架（空 / 水合中 / 消息列表三态）、提案卡三分组（待审 / 已裁决折叠 / 过期折叠）、工作台入口（五卡两 pill 的点击协调）、状态栏（状态句 + 两条 notice）、输入卡 `ComposerBox` 的全程接线、工具 ▾ / 模型 ▾ 两枚瞬时浮层与其锚点，以及订阅与心跳的挂与摘，都在这一层。它是渲染层中栏唯一的组件壳：**判定与文案一律不住 `<script setup>`**——轮次锚点 / 卡片分组 / 卡头标签住 `utils/timeline`，工作台表与预填句住 `utils/workbench-state`，状态句住 `useAgentStore.composeStatusLine`，头部标题住 `utils/profile-options`——这里只剩挂线。

Depended on by: `App.vue`（挂中栏、`v-if="centerView === 'chat'"`、喂 `leftCollapsed` / `rightCollapsed`、接 `toggleLeft` / `toggleRight`）、`AgentTimeline` / `ProposalCard` / `ComposerBox` / `BookWorkbench` / `ToolRoster` / `ModelSelect` / `ConversationHistoryMenu`（被它挂载，只渲染父侧喂进去的值）、`stores/useAgentStore` / `useBookStore` / `layoutStore` / `useProviderStore` / `useReferenceMenuStore`、`center-column-listening-wiring.test.ts` / `center-header-actions.test.ts` / `book-workbench-wiring.test.ts` / `composer-card-wiring.test.ts` / `model-select-wiring.test.ts`（按源码字面量钉接线）。

Out of scope:

- 线程取数与推送 —— 住 `stores/useAgentStore`（`threads` / `proposals` / `ensureHydrated` / `send` / `decide` / `tick` / `startListening`），见 `architecture/use-agent-store.spec.md`。
- 轮次锚点 / 卡片三分组 / 卡头标签 —— 住 `utils/timeline`（`turnAnchors` / `splitProposalCards` / `cardTurnLabel`）。
- 五卡两 pill 的表、图标与预填句 —— 住 `utils/workbench-state`。
- 状态句与头部标题 —— 住 `useAgentStore.composeStatusLine` 与 `utils/profile-options.conversationTitleLabel`。
- 输入卡内部（chips、权限档菜单、行内引用菜单）—— 住 `ComposerBox.vue` 与 `stores/useReferenceMenuStore`。
- 全局键位 —— 住 `App.vue` 一处（本组件不留第二份监听）；中栏样式 —— 住 `styles/conversation-pane.css`。

## Surface

- `CenterColumn.vue` — @apps/desktop/src/renderer/src/components/CenterColumn.vue — 中栏唯一壳；props `leftCollapsed` / `rightCollapsed`；emit `toggleLeft` / `toggleRight`。
- `threadKey` / `thread` / `items` / `tail` / `running` / `hydrating` / `hydratedEmpty` — 同文件 — 本线程视图的唯一读口（键住 `threadKeyFor(book.activeDocTab)`）。
- `threadCards` / `anchors` / `cardSplit` / `openCards` / `settledCards` / `expiredCards` / `turnLabel` — 同文件 — 提案卡三分组的接线（判定住 `utils/timeline`）。
- `messagesEmpty` — 同文件 — 「这一格还是空的」的唯一判据（工作台空状态与输入卡上方绑定条两个消费者共用）。
- `contextBarVisible` — 同文件 — 上下文绑定条的判定（住 `utils/composer-context`）。
- `statusLine` / `lastTimelineError` / `orphanError` — 同文件 — 状态栏与去重后的失败句。
- `agentLabel` / `contextTitle` — 同文件 — 头部档案名与主上下文两格。
- `cards` / `suggestions` / `prefillChapterThread` / `onWorkbenchPick` / `onWorkbenchSuggestion` — 同文件 — 工作台的接线（判定住 `utils/workbench-state`）。
- `rosterOpen` / `modelsOpen` / `modelAnchor` / `openModelSelect` / `chooseModel` / `openModelSettings` — 同文件 — 两枚瞬时浮层与其锚点（工具 ▾ / 模型 ▾）。
- `startNewConversation` / `onComposerSend` / `decide` — 同文件 — 头部清空、发送后清格、提案裁决三条动作的接线。
- `ensureHydrated` 的 watch / `startListening` / 1s 心跳 — 同文件 — 水合时机与订阅、心跳的挂与摘。

States: 线程三态（空 / 水合中 / 有消息）→ 消息区再分卡片三组（待审 / 已裁决 / 过期）→ 浮层开合（工具 ▾ / 模型 ▾ 是纯本地的瞬时 ref；权限档菜单与引用菜单住 store）→ 头部两枚开合钮（按 `leftCollapsed` / `rightCollapsed`）。

## Normative Behavior

1. WHEN 取本线程，the 组件 MUST 只用 `threadKeyFor(book.activeDocTab)` 算这一枚 computed，模板 MUST NOT 再调一次 `threadKeyFor(`。
2. WHEN 水合，the 组件 MUST watch `[() => book.rootPath, threadKey]` 且 `immediate: true`、调 `agent.ensureHydrated`；MUST NOT 拿 `book.hasBook` 布尔源代替 `rootPath`——从书 A 直切书 B 时 hasBook 恒真，水合会被静默跳过。
3. WHEN 判「这一格还是空的」，the 组件 MUST 只读 `messagesEmpty`（时间线无事件 + 本轮没在跑 + 没在水合 + 三类卡全空），工作台空状态与绑定条 MUST 共用它，MUST NOT 在模板里各写一遍条件。
4. WHEN 分组提案卡，the 组件 MUST 经 `splitProposalCards(threadCards, anchors)`，MUST NOT 在组件里判 `status` 字面量。
5. WHEN 已裁决 / 过期的卡渲染，the 组件 MUST 默认折叠（`<details>`），且过期那一组的摘要 MUST 用 `PROPOSAL_STATUS_LABELS.expired` 的真身文案。
6. WHEN 判卡头那行标签，the 组件 MUST 调 `cardTurnLabel(anchors, turnId)`。
7. WHEN 显示本线程的失败句，the 组件 MUST 去重：与时间线最后一条 error 文本相同的 `lastError` MUST NOT 再渲染（`orphanError` 为空），其余三类不产生时间线块的来源（send 被边界拒 / stop 被拒 / turn-end{failed}）照旧显示。
8. WHEN 头部标题，the 组件 MUST 读 `conversationTitleLabel(book.meta)`，MUST NOT 拼 `${stage.name}智能体` 一类功能泛称。
9. WHEN 头部与工作台 hero 报档案名，两处 MUST 读同一个 `agentLabel`（同一真身的两个消费者），MUST NOT 各拼一份标题。
10. WHEN 无书，the 头部 MUST NOT 渲染「主上下文：无」那一行（恒真的空信息比没有更误导）。
11. WHEN 点工作台的空卡（`target === null`），the 组件 MUST `layout.requestDocGroup(card.kind)` 请左栏展开该分组并进新建，MUST NOT 自己抄一份开合逻辑。
12. WHEN 点有目标的卡，the 组件 MUST 取卡片自带的 `target`（`workbenchCards` 算好的那一份）、开章 + `agent.prefillComposer(threadKeyFor(target), text)`，MUST NOT 在组件里重算第二遍目标或重抄预填句。
13. WHEN 点 pill，palette 一路 MUST 走 `referenceMenu.summon("/")`（与裸 `/` 键、`/ 命令` chip 同一个入口，不用旧的第二块命令面板），prefill 一路 MUST 走 `prefillChapterThread`。
14. WHEN 点「新建对话」，the 组件 MUST 调与左栏同一个 `agent.clearThreadView(threadKey.value)`，悬停文案 MUST 取 `CLEAR_VIEW_SENTENCE` 常量，且这枚钮 MUST 恒可点（无书时清的正是在看的那一格 unbound），MUST NOT 挂 `disabled`。
15. WHEN 发送，the 组件 MUST `agent.send(text)`，并按 `clearComposerAfterSend()` 决定是否 `agent.clearDraft(threadKey.value)`；这次清空是**乐观**的（那一轮被边界拒绝时由 store 的 catch 把草稿原样还回来）。
16. WHEN 裁决提案卡，the 组件 MUST 只调 `agent.decide(id, decision, guidance)`。
17. WHEN 打开模型 ▾，the 组件 MUST 连同触发它的那枚 chip 元素一起收下（`openModelSelect(anchor)`），并在 `modelsOpen && modelAnchor` 都成立时才渲染浮层。
18. WHEN 选中一个模型，the 组件 MUST 只把**模型名**交给 `provider.switchModel(name)`（连哪条连接由 store 从启用中那条取），写回成功才关浮层。
19. WHEN 模型名单拉不到，the 组件 MUST 给一条「去模型设置」的出口（`layout.showSettings("model")`），MUST NOT 自己另捏一条开设置的路。
20. WHEN 工具 ▾ 打开，`rosterOpen` MUST 是组件本地瞬时 ref（关掉不带走任何状态）；模型名单本身的缓存判定住 `useProviderStore`（关浮层不该重拉）。
21. WHEN 挂载，the 组件 MUST `agent.startListening()` + `provider.warmModelCache()` + 起 1s 心跳；WHEN 卸载，the 组件 MUST 只 `clearInterval`，**MUST NOT** 调 `agent.stopListening()`——设置中心整页化会卸载中栏，而那一轮可能正在收尾。
22. WHEN 收智能体推送，MUST 只经 store 的订阅（`startListening` 全仓只此一处），MUST NOT 在组件里自己接 `onAgentEvent`。
23. WHEN 状态栏渲染，the 组件 MUST 摆 `statusLine` 与两条 notice（`book.notice` / `agent.notice`），MUST NOT 另造第三条提示通道。

## Constraints & Invariants

- Constraint: 本文件是 §候选池里 476 行 / 32 提交那一格（近 90 天提交最密的一格）—— 判定一律往外拆 `utils/timeline` / `utils/workbench-state` 出纯函数用例、接线住 `*-wiring.test.ts` 读源文件，见 `conventions/source-line-budget.rule.md`。
- Constraint: 本组件 MUST NOT 写 `<style>` —— 中栏样式全在 `styles/conversation-pane.css`。
- Constraint: 中栏是**唯一**挂 `agent.startListening()` 的地方 —— 第二处挂载点就是第二条监听（同一份推送被 apply 两遍，每句话出现两次）。
- Invariant: 线程键只有一份判据（`threadKeyFor`）—— 组件里再出现一次 `threadKeyFor(` 就是第二份。
- Invariant: 「空」只有一份判据（`messagesEmpty`）—— 工作台空状态与绑定条共用它（铁律 6）。
- Invariant: 订阅的摘除点不在组件层 —— 全仓 `components/` MUST 零 `stopListening`。
- Invariant: 锁线动作（清空 / 开章 / 预填 / 裁决 / 切模型）MUST 走 store 已有真身，组件 MUST NOT 自持第二份状态或另捏开关（如 `showSettings.value = `、`hydrated = true`、`items = []`）。
- Invariant: 瞬时 UI 态（工具 ▾ / 模型 ▾ 的开合与锚点）住组件本地 ref，跨组件的开合态（权限档菜单 / 引用菜单 / 设置视图）住 store —— 两处 MUST NOT 各持一份。

## Failure Behavior

1. IF 模型浮层的锚点拿不到，THEN the 组件 MUST 不开浮层，MUST NOT 弹一个飞到屏幕角落的黑盒（锚点是点开它的那枚 chip，元素随事件交上来）。
2. IF `provider.switchModel` 失败，THEN 浮层 MUST 留着让 `provider.switchError` 在原地上屏，MUST NOT 悄悄关掉。
3. IF 模型名单拉不到（地址 / 密钥不对，重试治不了），THEN 用户 MUST 能从浮层直达设置中心，MUST NOT 只有「重试」一条出路。
4. IF 这一轮被边界拒绝，THEN 草稿 MUST 由 store 的 catch 还回输入格，MUST NOT 让用户把刚打的字重打一遍。
5. IF 同一句中文既进了时间线又写进 `thread.lastError`，THEN the 组件 MUST 只渲染一处（`orphanError` 去重）。
6. IF 中栏在设置视图被卸载，THEN 订阅 MUST 仍在（MUST NOT 摘），否则那一轮在途对话会永远停在 running。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 用户开着一条有消息的线程，点开「模型 ▾」后切去设置中心
When 那一轮对话正在这两秒里收尾
Then 中栏卸载时订阅未摘（全仓 components 零 stopListening）、心跳已清，回到聊天视图后这一轮的状态仍是 store 里的真相
```

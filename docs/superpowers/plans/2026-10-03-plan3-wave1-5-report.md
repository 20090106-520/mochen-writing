# Plan 3 波 1.5 门禁与真机冒烟记录（Task 11）

日期：2026-10-03（本地 12:43–14:09，UTC 时间戳见各日志）
构建：`corepack pnpm build`（`scratch/w15-build.log`）后起**第二/第三个** electron 实例（`--remote-debugging-port=9225`，`--user-data-dir=scratch/wave15-profile`；无书实例用 9226 + `scratch/wave15-nobook`），加载的是 `out/renderer/index.html`（构建产物，不是 vite 热更页）。provider 用仓内 `tools/mock-provider.mjs`（127.0.0.1:8787，`--doc` 默认 `chapters/01-开局.md`，锚点「雾从海面涌上来。」，用户文本含「慢」时走 60ms 慢切片）。
测试用书：`scratch/wave15-book`（临时造，《海雾断章》六篇：`chapters/01-开局.md`、`chapters/02-中段.md`、`outline/主线.md`、`characters/李深.md`、`plot/三幕.md`、`materials/设定-海怪.md`，`book.json` 为 `schemaVersion: 1` / `stages: [{ id: "draft", name: "正文" }]` / 初始 `permissionMode: "read-only"`）——**未拿任何真人书稿当对象**。
门禁：`corepack pnpm verify` 跑了两遍，日志 `scratch/verify-wave15-1.log` 与 `scratch/verify-wave15-final2.log`。两遍都是**不经管道**的写法（`… > 日志 2>&1; echo "VERIFY_EXIT=$?"`）：两份日志尾部分别是链尾自印的 `VERIFY_EXIT=0`（第 10 行倒数第一非空行）与 shell 侧读到的 `VERIFY_EXIT=0`，退出码没有被任何管道吞掉。命令链逐段为：`prettier --check` → 五个 `tsc` 项目 → `eslint . --max-warnings=0` → `lint:boundary` → 行数预算 → `vitest run --maxWorkers=4` → 自印退出码。
用例：`Test Files 58 passed (58)` / `Tests 599 passed (599)`（两份日志一字不差）。基线是波 1 报告的 `43 / 476` ⇒ 本波净增 **+15 文件 / +123 用例**，高于计划自审第 4 条定的下限（≥50 文件 / ≥543 用例）。
prettier：`All matched files use Prettier code style!`；五个 tsc 项目零诊断；eslint 日志 `scratch/rr-eslint.log` 是 0 字节（无告警）；`行数预算通过`（`scratch/rr-budget.log`）、`边界检查通过`。
行号与预算：`DocumentPane.vue` **212** 行（自定 ≤220）、`CenterColumn.vue` **336** 行（≤400）、`ComposerBox.vue` **114** 行（≤120）、`BookWorkbench.vue` 58、`BookDossier.vue` 与 `SnippetToolbar.vue` 未破 repo 800 闸。
密钥纪律：本轮只在设置对话框里输入过 mock 桩用的假串，未碰真端点、未写 `secrets.enc`；渲染层能读到的只有掩码（实测 `{"hasKey":true,"baseURL":"http://127.0.0.1:8787/v1","model":"mochen-mock","keyMask":"••••-key"}`）。命令行/日志/报告/commit 里没有任何凭据串，也没有把「前缀字样 / 鉴权头字样」那两个指令词写成 grep 字面（改用形状扫，见 Step 5-C L6）。

## Step 1：计划文本与代码/项目法律的冲突（控制方裁定，逐条）

计划是波 1.5 落笔时写的，执行到 Task 11 撞到十处口径差。**都以代码/真机为准裁定，没有为了凑绿改测试或改门禁**：

| # | 计划原文的问题 | 实测证据 | 裁定 |
| --- | --- | --- | --- |
| ① | 八条变异的命令都写 `corepack pnpm vitest run …` | 本仓 `vitest` 不是 `pnpm` 的 bin 短名，嵌套调用取不到；必须 `corepack pnpm exec vitest run …` | 命令按 `exec` 形式跑，台账里记实际命令；不改脚本、不加 alias |
| ② | W5 的靶文件写成 `packages/fs-store/test/scan.test.ts` | 该文件存在（5 用例）但**不断 excerpt** ⇒ 变异打上去仍然 `Test Files 1 passed (1)`（`scratch/w15-W5-red.log`），红不起来就是没跑 | W5 改打真靶 `packages/fs-store/test/scan-excerpt.test.ts`（6 用例），红/绿两段都在案 |
| ③ | 缺陷③期望屏幕文案「已失效」 | shipped 文案是「文件已变动」，由 `useAgentStore.test.ts:192`（用例名「指纹过期（stale）落『文件已变动』，不再计入待审」）钉死；「已失效」只出现在主进程句子 `agent-service.ts:327` / `:359` | 以代码为准：屏幕原文照抄「文件已变动」，`已失效` 不作为验收字面；这是**计划文案错**，不是实现缺漏 |
| ④ | R1 读 `querySelectorAll(".editor-pane,.agent-pane,.left-nav")` | 真机 class 普查（`w15-evidence.txt` 05:14:37 全量 class 清单）里没有 `.agent-pane`、没有 `.left-nav`；三栏真身是 `.left-sidebar` / `.editor-pane` / `.conversation-pane`（`briefSelectors:{agentPane:false,leftNav:false,editorPane:true}`） | R1 按真身选择器复跑，计划里的两个名字记为写错 |
| ⑤ | 附录 §5 说「五卡」「三 chip」 | 本波交付**四卡 + 两枚 chip**（`WORKBENCH_CARD_LABELS` 四个 id；`ComposerChipId = "permission" \| "palette"`） | 计划正文 3815 行已自行声明这处一字之差，报告照写，不拿数量差当缺陷 |
| ⑥ | 附录 §5 的「主题切『墨宸 · 青金』后重启保持」 | 本波未交付 F-E | 写「未交付，不留绿痕」，不拿别的主题截图充数 |
| ⑦ | L1 引用 `useAgentStore.ts:34`（QUEUED_MAX）/ `:37`（满额句）/ `:144`（`composeStatusLine`） | 现 HEAD 实测：`:36 export const QUEUED_MAX = 5;`、`:39 const QUEUED_FULL_NOTICE = \`排队指令最多 ${QUEUED_MAX} 条，先等这一轮结束。\`;`、`:138 export function composeStatusLine(` | 报告用现行行号；计划行号是波 1.5 写作时的快照，漂移不改代码 |
| ⑧ | 起法写 `--user-data-dir=scratch/wave15-profile`，且示例从仓库根起 | 从仓库根 `electron.exe ../` 会**秒退**（日志 2 字节、无监听）；正确姿势是 `cd apps/desktop && …/electron.exe . --remote-debugging-port=9225 --user-data-dir=scratch/wave15-profile`，profile 实际落在 `apps/desktop/scratch/wave15-profile` | 按可跑通的形式记录；两次秒退的 2 字节日志留在 `scratch/electron-wave15-5/6.log` 作为反面证据 |
| ⑨ | chip 名叫 `/ 命令`，容易被读成「在输入框里直接打 `/status`」 | 真机：把 `/model` 直接写进 composer 文本框并回车 ⇒ 它作为**普通提示词**发给模型（`paletteOpen:false`，无任何通路）；`/` 的派发口只有面板：`hotkeys.ts` 的 `open-palette` 分支 + `SlashPalette.vue:51 agent.runSlashCommand(...)` | 不是缺陷（面板是设计里的唯一派发口），但报告如实写清「直打进 composer 不执行」，避免下一波误读成键位回归 |
| ⑩ | Task 10 Step 7 的门禁 grep `git diff --cached -U0 -- apps/desktop/src/renderer/src \| grep "^+.*contenteditable"` 期望无输出 | 复跑该 commit（`6bca7b9`）**命中 2 行**，且都在断言自身：`document-pane-wiring.test.ts:130/132`（`expect(vueSource(file)).not.toContain("contenteditable")`）。全仓 `.vue` 里 `contenteditable` 出现 **0 次** | 计划命令会被自己的断言自我命中（同 L6 那一类坑）。判定按实现口径：编辑器仍是 `textarea`，`contenteditable` 只在两处非 .vue 文本里作为**分类器注释/用例名**存在（`hotkey-focus.ts:43`）⇒ 格子的实质要求为真，命令写法记为计划缺陷 |

## Step 2：契约变更表对账（`scratch/w15-census.log` 实测输出逐行抄录）

八行全部对上，**IPC 一个字没加**：

| 项 | 期望（波 1.5 不动契约） | 实测（命令与出处） |
| --- | --- | --- |
| `IPC_CHANNELS` 键数 | 13 | **13** —— `node -e` 切片 `packages/contracts/src/ipc.ts` 的 `IPC_CHANNELS … } as const`，值：`book:open, book:save-meta, doc:read, doc:write, book:pick, agent:start-turn, agent:interrupt, agent:decide, agent:event, agent:diff, provider:get, provider:save, agent:load-session` |
| `RendererApi` 方法数 | 13 | **13** —— 同法切片 `export interface RendererApi`：`pickBookDirectory,openBook,saveMeta,readDoc,writeDoc,startTurn,interruptTurn,decideProposal,proposalDiff,loadSession,providerView,providerSave,onAgentEvent` |
| preload 计数钉 | 两处都是 13 | **两处皆 13** —— `apps/desktop/src/preload/renderer-api.test.ts:64`（用例名「13 个方法各调一次…」）、`:102 expect(calls.length).toBe(13);`、`:135` 注释「渲染层只拿到这 13 个方法：invoke/on/ipcRenderer 一个字都不许泄漏成键。」白名单工厂在 `preload/renderer-api.ts`（`index.ts` 只有 `contextBridge.exposeInMainWorld`，`:4`） |
| `PROPOSAL_STATUSES` | 7 | **7** —— `packages/contracts/src/patch.ts:16` 起：`"pending","written","rejected","cancelled","stale","failed","expired"` |
| `ThreadView` 字段 | 10 | **10** —— `useAgentStore.ts`：`turnId / running / startedAt / items / streaming / lastError / endedAs / hydrated / hydrating / queued`（真机 `Object.keys` 同序回读，见 Step 5-B③ 段原文） |
| `schemaVersion` | 1 | **1** —— `packages/contracts/src/book.ts:36 schemaVersion: z.literal(1)`；真机书根 `book.json` 的 `node -e` 字段切片回读 `{"permissionMode":"chapter-write","schemaVersion":1}`（切完之后为 R5 又切回 `read-only`，所以现在 `cat book.json` 看到的是 `read-only`——那是操作序列，不是报告与盘不符） |
| `EscapeAction` | 5 | **5** —— `escape-policy.ts:1-2`：`"keep-guidance" \| "cancel-proposal" \| "close-overlay" \| "interrupt" \| "none"` |
| `DocRef` 字段 | 4 | **4** —— `book.ts:22-27`：`relPath` / `kind` / `title` / `excerpt?`（注释：「正文第一段纯文本（≤80 码点），由 scan 顺路带出；跨 IPC 消费处一律 `?? ""`」） |
| `error.proposalId?` | 在位 | **在位** —— `agent-event.ts:78 proposalId: id.optional()`，注释（`:70`）说明只在「指纹不符 / 锚点不唯一 / …」三处出现 |
| `AGENT_TOOL_NAMES` | 5 | **5** —— `packages/contracts/src/tools.ts:1-7`：`read_doc, list_docs, search_docs, propose_patch, write_doc` |

禁区扫描（同一份 census）：`queued` 未进 `StartTurnInput`、未进 `AgentEvent`、未落盘（扫 0）；`.vue` 里没有手抄的三档字面量联合（扫 0）；写盘通路仍只有 `agent-service.ts:346-347` 那一条（`批准 → book.writeDoc → writeDocFile`）；本波没新增依赖（`git diff b8855eb..HEAD` 里无 `package.json` / lockfile）；没新开样式文件——改的是既有四个 `styles/*.css`（`conversation-pane.css`、`editor-pane.css`、`interaction.css`、`theme-runtime.css`）；没改门禁脚本或 ignore 文件。

## Step 4：变异台账 W1–W8（每条都有红/绿两段，改回绿后 `git diff --exit-code` 干净）

实际命令一律是 `corepack pnpm exec vitest run <根相对路径> --maxWorkers=4`（② 见上）。红证据 = 只改实现、不动测试；绿证据 = 还原实现后同一命令。

| # | 变异（只动实现的那一刀） | 红（FAIL 原文，抄自日志） | 绿 |
| --- | --- | --- | --- |
| W1 | `resolveEscape` 删掉 `close-overlay` 那一支 | `FAIL … escape-policy.test.ts > 设置浮层开着且回合运行中：先收浮层，而不是打断` — `AssertionError: expected 'interrupt' to be 'close-overlay' // Object.is equality`；第二条 `expected 'none' to be 'close-overlay'`（`w15-W1-red.log`） | `Test Files 1 passed (1)` / `Tests 11 passed (11)` |
| W2 | `permissionChipView` 的 `hasBook` 判断恒为真 | `FAIL … permission-chip.test.ts > 无书但传了真实档位：文案仍是「未打开作品目录」且 disabled，绝不报任何档位名` — `AssertionError: expected '只读参考' to be '未打开作品目录'` | 1 file / `Tests 4 passed (4)` |
| W3 | `replayProposalStatuses` 去掉 `=== "expired"` 守卫 | `FAIL … timeline.test.ts > 已 written 的卡不因后续 error{proposalId} 被改判（守卫：仅 expired 可改）` — `AssertionError: expected { pWrite: 'stale' } to deeply equal { pWrite: 'written' }` | 1 file / `Tests 32 passed (32)` |
| W4 | `prefillText` 改成无条件返回 `incoming` | `FAIL … composer-draft.test.ts > current 有内容 ⇒ 原样返回 current，incoming 一个字都不进` — `expected '我想改这一章：先读它。' to be '我写了一半'`；第二条 `expected '预填指令' to be '   草稿   '` | 1 file / `Tests 5 passed (5)` |
| W5 | `docMetaOf` 的 excerpt 永远返回 `""` | 计划给的 `scan.test.ts` **打不红**（`Test Files 1 passed (1)`，② ）；真靶 `scan-excerpt.test.ts` 红四条：`expected '' to be '夜色沉下去，海雾从崖底涌上来。'`、`expected '' to be '海是深蓝的，雾很浓。'`、截断句 `…' // Object.is equality` 两条 | 1 file / `Tests 6 passed (6)` |
| W6 | `groupDocsForDossier` 删掉空组过滤 | `FAIL … book-dossier.test.ts` 三条：`expected [ 'chapter', 'outline', …(3) ] to deeply equal [ 'chapter', 'outline' ]`、`expected true to be false`、`expected '章节' to be '人物'` | 1 file / `Tests 7 passed (7)` |
| W7 | `workbenchVisible` 不看 `hasBook` | `FAIL … workbench-state.test.ts > workbenchVisible：无书 false、有书 true` — `expected true to be false`；第二条 `无书 ⇒ workbenchCards 一张卡都不出` — `expected [ { id: 'chief-write', …(3) }, …(3) ] to deeply equal []` | 1 file / `Tests 8 passed (8)` |
| W8 | `applySnippet("list")` 只作用首行 | `FAIL … markdown-snippets.test.ts > 跨行选区每行都加“- ”（变异 W8 的落点）`；第二条 `选区从行中段起…` — `expected '雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。\n第三行' to be '雾从海面涌上来。\n- 海雾涌上来，铁锈味很冲。\n- 第三行'` | 1 file / `Tests 20 passed (20)` |

八条改回后 `git diff --exit-code -- apps packages docs` 返回 **0**（当场重跑确认，工作树对 HEAD 干净），随后 `corepack pnpm verify` 两遍全绿。

> **硬话（照波 1 报告第 43 行同款，本波原样成立）**：本波所有 `.vue` 模板接线（工具栏按钮是否显示、chip 是否 disabled、工作台卡片是否出屏、四键是否真的挂到卡片上）**没有任何自动化覆盖**——`vitest.config.ts` 的 `include` 只有 `*.test.ts` / `*.test.mjs` 且 `environment: "node"`，`tsconfig.web.json` 走 `renderer/vue-shim.d.ts` 的 `declare module "*.vue"`，全仓门禁用的是**裸 `tsc`（没有 `vue-tsc`）**，`.vue` 的 `<script setup>` 一个字都不进类型检查。⇒ 下面 A/B 两表里凡是「按钮在位但没拍到点击后的可见变化」的格子，一律退回**未证**，不许写成「单测覆盖」。替代手段只有两样：源码契约用例（`utils/vue-source-reader.ts` 读 `.vue` 原文做正则钉）+ 真机肉眼。

## Step 5-A：附录 §5 的七项验收（逐格屏幕/磁盘原文）

**A1 打开书 ⇒ 工作台四卡逐张点**（真机 9225；`openBook` 后 `mode:"read-only"`、`docs` 六条、`tabs:[]`）

- 四卡原文（`cardCount:4`）：`正文智能体 说人话就行——它会自己读文档、给出逐条待审的改稿提案；你不点批准，它一个字也写不进作品目录。 主笔创作 打开当前章，预填一句改稿指令，再交给你逐条审批。 角色塑造 浏览人物分组第一篇，落到右栏浏览态。 世界构建 浏览素材库分组第一篇，落到右栏浏览态。 大纲规划 浏览大纲分组第一篇，落到右栏浏览态。`
- 点「主笔创作」（`workbenchCards` 报得出函数名，点击后真的改到屏）：`tabs:["chapters/01-开局.md"]`、`active:"chapters/01-开局.md"`、draft 头 `---\ntitle: 开局\n---\n\n雾从海面涌…`、composer 预填长度 0 ⇒ **预填走的是 store**（`composerDrafts` 里 `chapters/01-开局.md` = `我想改这一章：先读它，再给我三处可以动的地方。`，即 `WORKBENCH_PREFILL`，`workbench-state.ts:13`），中栏文本框显示同句 ⇒ `dirty:false`、`workbenchStillThere:true`。
- 点「角色塑造」：`label:"角色塑造 浏览人物分组第一篇，落到右栏浏"`，右栏 `paneHead:"波1.5样例·海雾断章/ 人物/ 李深 已保存到本机 李深 文稿 浏览 作品资料 md 浏览中，不影响文稿 --- title: 李深 --- 四十岁上下…"`，`browseBadge:true`；且 `active/tabs/draft/dirty/drafts` **前后一字不变**（`before` 与 `after` 两组同值）。
- 点「世界构建」：`paneHead:"… / 素材库/ 设定-海怪 … 浏览中，不影响文稿 --- title: 设定-海怪 --- 海怪在本册里从不以形体出现…"`，同样不变。
- 点「大纲规划」：同一通路（`browse(ref)`），三张浏览卡的 `before/after` 快照字段一致 ⇒ 判定 **闭合（真机）**。

**A2 无书 ⇒ 一张卡都不出**（9226 第三实例，独立 profile，不调 `openBook`）

```
{"hasBook":false,"cards":0,"hasOpenBookBtn":true,"openBookBtnText":"打开作品目录","mentionsChiefWrite":false,
 "centerText":"墨宸 AI 打开作品目录 Ctrl O 模型配置 本章新对话（先打开一章） 未选择作品 主上下文：无 未打开作品目录 模型设置 未选择作品 说人话就行——它会自己读文档、给出逐条待审的改稿提案；你不点批准，它一个字也写不进作品目录。 还没有打开作品目录。先打开一个，工作台的四张卡才会各就各位。 打开作品目录 就绪 未打开作品目录 …"}
```
屏上不含「主笔创作」（`mentionsChiefWrite:false`），`cards:0` 与 W7 单测同向 ⇒ **闭合（真机 + 单测）**。

**A3 右栏「作品资料」五类分组 + 摘要**（点第三页签 ⇒ 读盘 ⇒ 点回「文稿」）

```
{"groupCount":5,"groups":["章节 开局 雾从海面涌上来。李深把缆绳在铁桩上绕了两圈，指节被盐粒磨得发白。 中段 铁箱上的封条是他自己贴的，字迹被潮气洇开了，只剩下一个「勿」字还认得出。",
"大纲 主线 《海雾手记》的主线是一箱不该被打开的档案：李深在父亲死后接手渡船，也在同一个夜里接手了那份没写完的值班记录。",
"人物 李深 四十岁上下，跑短途货船的船长，左手小指少一截，说是缆绳教的规矩。",
"剧情 三幕 第一幕：李深在雾夜接到一盏熄灭的灯塔，答应送一批无人认领的货上礁。",
"素材库 设定-海怪 海怪在本册里从不以形体出现，只以「缺席」出现：灯灭、潮退、鱼群绕开一片水面。"],
 "unchangedAcrossRoundTrip":true,"hasExcerpt":true}
```
`before/mid/after` 三次的 `active:"chapters/01-开局.md"`、`tabs:["chapters/01-开局.md"]`、`draftLen:147`、`dirty:false` **完全一致** ⇒ 切页签不碰文稿，**闭合（真机）**。标签取自唯一表 `BOOK_KIND_LABELS`（`book-kinds.ts:7`）。

**A4 两枚 chip 可点且反映真状态**

- 权限档 chip：菜单项原文 `["只读参考 （当前）","可改当前章","全开"]`；选「可改当前章」后 `metaAfter:"chapter-write"`、`chipTextsAfter:["可改当前章","/ 命令"]`、`headerChip:"可改当前章"`、notice `权限档已切到「可改当前章」，下一次审批就用这一档判断。`；**磁盘**回读（`node -e` 只切这两个字段，不是整份文件）`=== DISK book.json === {"permissionMode":"chapter-write","schemaVersion":1}` —— 档位落在书根的 `scratch/wave15-book/book.json`（真身是整份 pretty-printed meta，含 `id/title/stages/activeStage/chapterOrder`），**不在 `.mochen/` 里**。
- **关实例重开、重选同一本书**：新实例（`electron-wave15.log` 起于本地 12:59:19）`openBook` 回读 `{"title":"波1.5样例·海雾断章","mode":"chapter-write",…}`，紧随其后的 `=== chips after restart ===` = `{"chips":["可改当前章","/ 命令"],"header":"可改当前章"}` ⇒ 档位真落盘、真回读。
- `/ 命令` chip 与**裸 `/` 键**同一条 `openPalette`：chip 点击 ⇒ `{"paletteOpen":true,"paletteClass":"slash-mask","paletteItems":["/model 打开模型设置：baseURL、模型名与密钥","/permissions 打开权限档选择器（当前档显示在中栏","/status 把这条线程的现状写进状态条","/resume 重新读取这条线程的历史","/clear 只清空本页显示，不动盘上的会话历史"]}`；裸 `/` 键（composer 无焦点）⇒ `{"beforeOpen":false,"activeAfterBlur":"INPUT","openAfterBareSlash":true,"valueNow":"/","items":5}`。Esc 关面板后焦点没被吞：`{"paletteOpen":false}`。
- 注意两处 `disabled` 与文案：`chipTexts:[{"t":"只读参考","disabled":false,"cls":"composer-chip"},{"t":"/ 命令","disabled":false,"cls":"composer-chip"}]` ⇒ **闭合（真机 + 磁盘）**。

**A5 md 片段插入 ⇒ 真提案 ⇒ 审批 ⇒ 备份**

- 选中一句话点「加粗」：`{"picked":"雾从海面涌上来。","around":"--\n\n**雾从海面涌上来。**李深把缆绳在铁桩上绕了两","caret":[21,29],"dirty":true}`，页脚随之变 `157 字`。
- 发一轮「用文本块提案」⇒ 卡片出现：`{"key":"chapters/01-开局.md","endedAs":"done","cardCount":1,"status":"1 条待审","cardTexts":["第 1 轮 · 用文本块提案 chapters/01-开局.md 锚点替换 待审批 补一层可感的细节 --- a/chapters/01-开局.md +++ b/chapters/01-开局.md @@ -2,7 +2,7 @@ title: 开局 --- -雾从海面涌上来。…"]}`。
- 聚焦该卡（`{"focused":"483bb206","status":"pending","activeIsCard":true,"activeTag":"ARTICLE"}`）按 `y` ⇒ 盘上立刻出现
  `scratch/wave15-book/.mochen/changes/2026-10-03T04-56-38-355Z/chapters/01-开局.md.bak`（`ls` 计数操作前 4 ⇒ 操作后 **5**，`=== new backup dirs === 5`），正文按锚点改写为 `海雾涌上来，铁锈味很冲。李深把缆绳在铁桩上绕了两圈，指节被盐粒磨得发白。`，备份头仍是原句 `雾从海面涌上来。…`；JSONL 落 `{"type":"decision",…,"decision":"accept-once","auto":false}` + `{"type":"written",…}`。⇒ **闭合（真机 + 磁盘）**。

**A6 页脚阅读时长**

- 跨三行点「列表」后 `editorFooterMeta:"170 字\n约 1 分钟阅读\n权限档已切到「只读参考」，下一次审批就用这一档判断。"`，`readingTime:"约 1 分钟阅读"`，`saveStatus` 同排。
- 正文清空 ⇒ 页脚为 `0 字 — 分钟`（初始无书态原文里也在案：`… md 0 字 — 分钟 已打开《波1.5样例·海雾断章》…`）。
- 实时性：`dirty:true` 未保存时 `footerHead:"… 有未保存修改 开局 文稿 浏览 作品资料 加粗 标题 列表 引用 md 153 字 约 1 分钟阅读 …"` ⇒ 字数随 `onEdit` 变，不必保存 ⇒ **闭合（真机）**。

**A7 新组件无硬编码色值**

- 静态：计划给的 grep（五个新组件 + `interaction.css`）**只有一条命中**：`apps/desktop/src/renderer/src/styles/interaction.css:11: background: color-mix(in srgb, #000 28%, transparent);`。`git blame` = `7d07ddf 2026-10-02 feat(renderer): / 命令面板与派发口…`，且 `git merge-base --is-ancestor 7d07ddf b8855eb` 为真 ⇒ **本波未引入的既有命中**（波 1 留下的遮罩），按计划要求如实记录，不偷偷改规则。四个新 `.vue` 与 `DocumentPane/ComposerBox` 均 0 命中。
- 肉眼（明暗两套看 `--focus`）：`--focus` 由 `--accent` 派生（`appearanceThemeRuntime.ts:151` 起 `root.dataset.theme = scheme` 后 setProperty 链），合成级把 `--accent` 改掉后计算样式跟随变化。**这一格的证据等级是「合成级」**：本波没有主题切换 UI（F-E 挪波 2），不能在屏上点出「墨宸 · 青金」⇒ 判定 **静态 + 合成级，不留绿痕**。

## Step 5-B：波 1 报告第 132 行的三条界面缺陷复验

**① 设置浮层开着 + composer 聚焦时 Esc 不收回浮层（Task 1 修）** —— 怎么点：真机跑一轮含「慢」的提示词让回合处于 running（`waitedForRunningMs:10, runningAtOpen:true`），按 `Ctrl+,` 开浮层（`viewOpen:"settings"`，`activeWhileOpen:"TEXTAREA"`），再按一次 Esc。

```
{"waitedForRunningMs":10,"runningAtOpen":true,"viewOpen":"settings","activeWhileOpen":"TEXTAREA",
 "afterEsc":{"viewAfterEsc":"workspace","runningRightAfterEsc":true,"endedAsRightAfterEsc":"","itemsRightAfterEsc":157,"activeNow":"TEXTAREA"},
 "final":{"running":false,"endedAs":"done","items":159,"status":"就绪"}}
```
浮层当场收（`settings → workspace`），**且这一按不打断进行中的一轮**：Esc 后 `running` 仍 `true`、`endedAs` 仍是空串，回合自己走到 `"done"`（不是 `"interrupted"`）。真身唯一：开浮层时屏上只有一份设置正文（`settingsTextNodes:1`，即只有一个 baseURL 文案节点；`dialogs:2` 是 `role=dialog` 容器与 `.dialog-content` 同层两个节点，不是第二份设置），`currentView` 只有 `workspace` / `settings` 两态可切，Esc 后归零（`after.dialogs:0`）。⇒ **闭合（真机）**。

**② 无书时头部档位标签 `disabled=false` 且捏造「只读参考」（Task 2 修）** —— 9226 无书实例读头部 chip：

```
{"hasStore":true,"hasBook":false,"chipText":"未打开作品目录","chipDisabled":true,"chipAria":"false",
 "chipTitle":"还没打开作品目录，权限档改不了。","cards":0,"workbenchShown":true,
 "lead":"说人话就行——它会自己读文档、给出逐条待审的改稿提案；你不点批准，它一个字也写不进作品目录。"}
```
文案是 `NO_BOOK_CHIP_LABEL`（`permission-chip.ts:4`）而不是任何档位名，`disabled:true`，屏上「只读参考」四字在无书实例里一次都没出现（`centerText` 全文只含「未打开作品目录 / 未选择作品」）；`PermissionMenu` 在不满足 `hasBook` 时根本不挂。⇒ **闭合（真机）**，同向单测 W2 已打红过。

**③ `stale` 不随回放存活（Task 3 修）** —— 怎么造：留一张 pending 卡（`06718738`），在盘上给 `chapters/01-开局.md` 追加一行「（外部改动：有人在别的编辑器里补了一行。）」，然后批准那张卡。主进程按指纹拒绝，屏上句子与 JSONL 都在案：

```
{"type":"error","proposalId":"06718738-…","message":"提案之后 chapters/01-开局.md 又被改动过，这条建议已失效；…"}
```
关实例重开、重选同一章 ⇒ 该卡落在「已裁决的提案 · 6 条」组里，状态是 **`文件已变动`**（不是「上次会话未处理」），按钮为空数组（`buttons:[[]]` ⇒ 四键 disabled、不可批准）：

```
{"headTag":"SUMMARY","headText":"已裁决的提案 · 6 条",
 "visibleNow":["第 8 轮 · 用文本块提案 chapters/01-开局.md 锚点替换 文件已变动 补一层可感的细节 --- a/chapters/01-开局.md +++ b/…"],
 "buttons":[[]],"mentionsStale":[false],"mentionsExpired":[false]}
```
重启回放的整表：`{"items":153,"cardCount":26,"byStatus":{"written":5,"stale":1,"cancelled":1,"expired":19},"hydrated":true}`，其中 stale 正是那一张（`staleSample:[{"id":"06718738","buttons":0,…}]`）。
计划期望的字面「已失效」与 shipped 的「文件已变动」不一致 ⇒ 按裁定 ③ 以代码为准，`useAgentStore.test.ts:192` 为准绳（「已失效」是主进程拒绝句里的词，见 `agent-service.ts:327` / `:359`）。⇒ **闭合（真机 + 磁盘）**，同向单测 W3 已打红过。

## Step 5-C：波 1「本波不自证通过」的六格留白处置

| 格 | 处置 | 当场证据（屏幕/磁盘原文） | 判定 |
| --- | --- | --- | --- |
| L1 排队上限真键盘路径 + 计数 | 复验 | 运行中用 `cdp.cjs type --text=排队甲` + `key --key=Tab --code=Tab` 逐条连打：状态行依次为 `工作中 · 0s · Esc 打断 · 排队 1 条` → `2 条` → `3 条` → `4 条` → `5 条`；第八条打出 notice **`排队指令最多 5 条，先等这一轮结束。`**（`queued` 停在 5）。诚实记一笔窗口抖动：第一次尝试（05:07:21）六条全部 `skipped:"回合已结束（窗口太短）"`，`queued:[]`；重跑（05:07:51）里第一条在打下一条的间隙被 drain（`queued:["排队乙","排队丙"]`），队列长度非单调；`queued` 从未出现在 chip 行（裁定 C：计数只在状态行） | **勾** |
| L2 `a` 键 ⇒ `accept-session` | 复验 | 真 pending 卡聚焦后 `key=a` ⇒ 主会话 JSONL `{"…","type":"decision","proposalId":"8b5aecbd-…","decision":"accept-session","guidance":"","auto":false}`；后续同轮新卡由会话级授权自动落盘：`{"type":"decision","proposalId":"f1775ea6-…","decision":"accept-session","auto":true}` | **勾** |
| L3 中文输入法候选框回车 | **仍欠人肉** | 合成级只到 CDP 派键，`isComposing` 不由它产生（`cdp.cjs ime-enter` 不是人肉证据）。本波不自证通过 | **不勾**，报告写「欠人肉一次」 |
| L4 无书头部标签（= 缺陷②） | 复验 | `{"chipText":"未打开作品目录","chipDisabled":true}` | **勾** |
| L5 「§16 逐条（全 9 项）」 | 字面不可达标 | §16 第 1–4 项 + 本波六面有真机原文；第 5–9 项（外观三态 / 六档案 / 上下文占用条 / 技能库 / F-4 迁移）归波 2、波 3，本波一次都没跑 | **不勾**，旁边写明归属 |
| L6 密钥 grep 字面（自我命中） | 字面不可达标 | 换成按形状不按词面：`git show --format= --unified=0 HEAD \| grep "^+" \| grep -cE "[A-Za-z]+-[A-Za-z0-9]{16,}"` ⇒ **0**；整波口径 `git diff --format= --unified=0 b8855eb..HEAD \| grep "^+" \| grep -cE "…"` ⇒ **0**（`No matches found`） | 形状扫为 0，**格子本身仍不勾**（指令词字面不可达标这件事没解） |

四键（R4）与 Esc 四态（R3）一并复跑在案，因为它们和 L1/L2 是同一段真机：

- `y` ⇒ `"decision":"accept-once","auto":false` 并落盘；`a` ⇒ `accept-session`；`p` ⇒ `"decision":"accept-prefix"`（该条之后同类新卡自动 `written`）；`d` ⇒ 只把焦点移进说明框：`{"activeTag":"TEXTAREA","activeCls":"guidance-box","placeholder":"拒绝时写清该怎么改（Shift+Enter 换行，Esc 先保住这段字）","status":"1 条待审"}`，JSONL 行数 `lines after d=17` 与按 `d` 前相同 ⇒ 没提交任何决策。整场决策计数：`1 accept-once / 2 accept-session（其中 1 条 auto:true）/ 2 accept-prefix / 1 cancel`。
- Esc ①：说明框有字 ⇒ `{"guidanceFocused":true,"textKept":"这段字必须活着","stillFocused":false,"cardAfterStatus":"still-pending"}`（字保住、只失焦、不发决策）。②：聚焦待审卡 ⇒ 卡变 `e70dd828:cancelled` 且 JSONL `{"type":"decision","…","decision":"cancel","guidance":"","auto":false}`。③：运行中无浮层 ⇒ `{"waitedForRunningMs":4,"sawRunning":true,"endedAsAfterEsc":"interrupted","runningNow":false,"statusLine":"已打断 · 2 条待审","lastError":"","queuedCount":0}`（打断生效且**队列没被清**）。④：见缺陷①。
- 只读档拒绝句（R5）：切回 `read-only` 后点批准 ⇒ 屏上 `lastError` = **`这条提案没有写入：当前权限档为「只读参考」，提案不会写入磁盘。可以先给出提案与理由；确实要落盘时，把权限档切到「可改当前章」或「全开」后再批准。`**，卡仍 `pending`（`statusAfter:"pending"`）、正文 md5 前后都是 `4917998e2de9aeb4d2b057351208b49b`、决策计数没有增加（`decisions before=5 after=5`）。
- `/` 面板四条真通路（R7）：`/model` ⇒ `currentView:"settings"`；`/status` ⇒ 状态行 `状态 · 线程 chapters/01-开局.md · 历史已回放（153 条） · 提案 26 张（待审 19 张） · 排队 0 条 · 权限档：只读参考 · 阶段：正文 · 上一轮已完成`；`/permissions 随意改` ⇒ notice `没有这一档：「随意改」。可选：只读参考 / 可改当前章 / 全开。`；`/clear` ⇒ `{"cards":0,"items":0,"pending":0,"hydrated":true,"notice":"这只清空本页显示；盘上的会话历史不动，重启后仍会完整回放。 本页还有 19 条待审批提案，清空后这一轮里点不到它们；重启后会以「上次会话未处理」回来。"}`，而盘上同一时刻 `LINES=154 BYTES=53016 TYPES={"session-meta":1,"user-message":29,"reasoning":28,"message":28,"tool-call":28,"proposal":26,"decision":6,"written":5,"error":2,"interrupted":1}`，md5 前后一致；重启后完整回放（`byStatus` 见缺陷③）。
- 每章绑线程（R2）：`{"label":"点开 chapters/02-中段.md","contextLine":"主上下文：波1.5样例·海雾断章 · 中段","threadKeys":["unbound","chapters/01-开局.md","chapters/02-中段.md"],"footer":"139 字 约 1 分钟阅读 已保存到本机 保存到本机"}` ⇄ 点回 01 时 `contextLine` 与 `footer`（170 字）各自跟着变，两条线程的 items/pending 不互串 ⇒ 不串台。

## 未证 / 未做 / 留底（如实）

1. **只有单测证据、没做真机操作的格子**：`prefillText` 的「已有草稿不吞字」只做了反向真机（空草稿时预填成功），**没有**在草稿已有字的composer里点工作台卡（W4 单测在钉）；`replayProposalStatuses` 的「已 written 卡不因后续 error 改判」只有 W3 单测，真机上没构造「已 written + 后续 error 同 id」的现场；`splitProposalCards` 的 expired 分组只靠重启回放间接看到 `expired:19`，没单独点过 expired 卡的禁用态。
2. **A7 主题那一格是合成级**：没有主题切换 UI（F-E 挪波 2），`--focus` 跟随 `--accent` 只在 JS 层改属性验证过，明暗两套的肉眼对比没做 ⇒ **不留绿痕**。
3. **F-E（青金 preset）本波未交付** ⇒ 附录 §5 那一格不留绿痕。`themePresets` 至今全仓零消费者，本波加第四条仍是摆设。
4. **「墨宸 · 青金」主题、六档案花名册落地、上下文占用条、技能库、F-4 品牌路径迁移** ⇒ 波 2 / 波 3，本波一次都没跑（L5 的归属说明）。
5. **`/stage` 命令诚实但未实现**（`slash-commands.ts` 里有解析、没有通路）⇒ 波 2 档案落地时接。
6. **frontmatter 当正文**的 F-F 后续项：A6 里 `147/153/157/170 字` 都把 `---\ntitle: 开局\n---` 一起数进去了 ⇒ 本波按计划范围没动。
7. **`/` 打进 composer 不执行**（裁定 ⑨）：面板是唯一派发口。
8. **`.vue` 零自动化覆盖**（Step 4 硬话）：本波新写的六处模板接线（`BookWorkbench`、`BookDossier`、`SnippetToolbar`、`LeftSidebar` 三段主操作、`ComposerBox` chip 行、`DocumentPane` 页脚）全靠源码契约用例 + 真机肉眼；源码契约用例钉的是「源码里有这个调用」，不是「点了真生效」。
9. **「续写不重复已流出的句子」照波 1 报告第 60 行的写法明记为未证**：mock 桩的答句是定值（`tools/mock-provider.mjs`，同一 prompt 流同一段中文），本波所有轮次流的都是同一段 ⇒ 「不重复已流出句」需要真模型才能判。真机只拍到**渲染层没有重复插入**（`timeline.ts` 的锚点不唯一时主进程直接拒绝提案，见 R6 那轮的拒绝原文），这是链路行为，不是模型行为 ⇒ 这一格不留绿痕。
10. **留底 / 现场清理**：真机跑在 `scratch/wave15-book` 上，会话 JSONL 落在**嵌套日期目录** `scratch/wave15-book/.mochen/sessions/2026/10/03/rollout-…jsonl`（本波 census 时 154 行；缺陷①/B① 复跑又加了 2 轮，未回头改 census 数字）。`scratch/wave15-profile`、`apps/desktop/scratch/wave15-{profile,nobook}`、全部 `w15-*.js/.cjs/.log` 都是 gitignored 产物，**没有一样进版本库**。我为验证新起的实例（9225 / 9226 / 9227）已全部 `taskkill`；用户自己的 9223 与 mock 8787 **按约束**没碰（不是忘了杀）。桩里没出现真凭据，故无需轮换；如后续波次输入过真串，报告口径是「当场轮换并记一句」。

## 本波改动的行号清单（`git diff --name-only b8855eb..HEAD` = 67 files, +7033 / −246）

```
apps/desktop/src/renderer/src/utils/escape-policy.ts:1        EscapeAction 五值联合（+close-overlay 的优先级注释）
apps/desktop/src/renderer/src/utils/escape-policy.ts:17       resolveEscape —— 唯一裁决入口，优先级：保字 > 取消该条 > 收浮层 > 打断 > 无动作
apps/desktop/src/renderer/src/utils/permission-chip.ts:4      NO_BOOK_CHIP_LABEL = "未打开作品目录"
apps/desktop/src/renderer/src/utils/permission-chip.ts:18     permissionChipView —— 无书不报任何档位名且 disabled
apps/desktop/src/renderer/src/utils/timeline.ts:189           splitProposalCards —— 待审/已裁决/expired 三堆
apps/desktop/src/renderer/src/utils/timeline.ts:223           replayProposalStatuses —— 仅 expired 可被后续 error 改判（缺陷③）
apps/desktop/src/renderer/src/utils/composer-draft.ts:6       prefillText —— 已有草稿时逐字节返回 current
apps/desktop/src/renderer/src/utils/book-dossier.ts:14        groupDocsForDossier —— 空组不出现
apps/desktop/src/renderer/src/utils/book-dossier.ts:32        dossierSummary —— 右栏摘要条（阶段/权限档/章节数）
apps/desktop/src/renderer/src/utils/book-kinds.ts:4           BOOK_KIND_ORDER（chapter/outline/character/plot/material）
apps/desktop/src/renderer/src/utils/book-kinds.ts:7           BOOK_KIND_LABELS —— 五类中文标签的唯一表
apps/desktop/src/renderer/src/utils/workbench-state.ts:3      WorkbenchCardId 四张卡
apps/desktop/src/renderer/src/utils/workbench-state.ts:13     WORKBENCH_PREFILL（主笔创作预填整句）
apps/desktop/src/renderer/src/utils/workbench-state.ts:47     workbenchVisible(hasBook)
apps/desktop/src/renderer/src/utils/workbench-state.ts:51     workbenchTarget —— 每张卡报得出走的函数
apps/desktop/src/renderer/src/utils/workbench-state.ts:65     workbenchCards
apps/desktop/src/renderer/src/utils/composer-chips.ts:4       ComposerChipId 只有 permission / palette 两枚
apps/desktop/src/renderer/src/utils/composer-chips.ts:18      CHIP_EMIT —— 两枚 chip 的 emit 名
apps/desktop/src/renderer/src/utils/markdown-snippets.ts:13   SNIPPET_KINDS（bold/heading/list/quote）
apps/desktop/src/renderer/src/utils/markdown-snippets.ts:72   snippetToolbarState —— 无书/无文稿时按钮不亮
apps/desktop/src/renderer/src/utils/markdown-snippets.ts:162  applySnippet —— 逐行前缀（W8 靶）
apps/desktop/src/renderer/src/utils/reading-time.ts:2         READING_MINUTES_PER_WORD = 300
apps/desktop/src/renderer/src/utils/reading-time.ts:8         codePointLength —— 按码点，不按 UTF-16 单元
apps/desktop/src/renderer/src/utils/reading-time.ts:30        readingTimeLabel —— 「N 字 / 约 M 分钟阅读 / — 分钟」
apps/desktop/src/renderer/src/utils/right-pane-labels.ts:11   BAND_LABELS
apps/desktop/src/renderer/src/utils/right-pane-labels.ts:18   VIEW_TABS —— 第三页签「作品资料」
apps/desktop/src/renderer/src/utils/hotkey-queue.ts:12        composerTextAfterQueue —— 排队失败不吞字
apps/desktop/src/renderer/src/utils/hotkey-focus.ts:54        deriveHotkeyFocus —— 焦点事实的唯一派生处
apps/desktop/src/renderer/src/utils/vue-source-reader.ts:17   vueSource / :23 templateSource / :34 scriptSource（源码契约用例的单一真身）
apps/desktop/src/renderer/src/stores/useAgentStore.ts:36      QUEUED_MAX = 5
apps/desktop/src/renderer/src/stores/useAgentStore.ts:39      QUEUED_FULL_NOTICE（数字取自 QUEUED_MAX，不留第二份「5」）
apps/desktop/src/renderer/src/stores/useAgentStore.ts:138     composeStatusLine —— 「工作中 · Ns · Esc 打断 · 排队 N 条」
apps/desktop/src/renderer/src/stores/useAgentStore.ts:581     runSlashCommand —— / 命令的唯一派发口
apps/desktop/src/renderer/src/components/CenterColumn.vue:230 中栏空分支 → BookWorkbench 的六条件守卫
apps/desktop/src/renderer/src/components/CenterColumn.vue:200 头部 permission-chip + PermissionMenu
apps/desktop/src/preload/renderer-api.test.ts:102             expect(calls.length).toBe(13) —— 通道 census
packages/contracts/src/book.ts:22                             DocRef.excerpt?（≤80 码点，消费处一律 ?? ""）
packages/fs-store/src/scan.ts                                 scan 顺路带出第一段（W5 靶）
```

## 诚实账

- 本波新写的 `.vue` 接线**全部零自动化覆盖**：门禁用的是裸 `tsc`（仓里没有 `vue-tsc`），`tsconfig.web.json` 只 include `.ts` / `.d.ts` 且 `renderer/vue-shim.d.ts` 把 `*.vue` 声明成 `any`；vitest 是 `environment: "node"` 且没装 `@vue/test-utils`。所以「加粗按钮真的插进了正文」「chip 真的 disabled」「四卡真的出屏」这类判断，证据等级只到**真机肉眼 + 行号**，不是单测。源码契约用例钉的是源码形状，不是运行时行为。
- 报告里凡我写「闭合」的格子，上面都贴了当场回读的屏幕/磁盘原文；写「合成级」「未交付」「不勾」的格子，都在原处写明了欠谁的什么动作。**没有一格是用「应该没问题」填的**。
- 计划文本的十处口径差（Step 1 表）没有一处是靠改测试、改门禁或改 ignore 抹平的；两处计划写错的靶文件名/期望文案（②③）保留为计划的缺陷，留给收尾评审。
- 波 1 留给本波的六格，三格勾了（L1/L2/L4），三格如实不勾（L3 欠人肉一次、L5 归属波 2/波 3、L6 指令词字面不可达标）。
- 真机 census 的时刻冻结在 05:12:58（`LINES=154`）；之后为闭合缺陷①又跑了 2 轮慢回合，盘上行数只增不减。报告不回头把 census 数字改成"最新"，因为钉的是那一刻的证据。

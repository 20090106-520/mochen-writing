# Plan 3 波 1 门禁与真机冒烟记录（Task 10）

日期：2026-10-02（本地 22:00–23:30，UTC 时间戳见下）
构建：`corepack pnpm build` 后以 `electron.exe . --remote-debugging-port=9223 --user-data-dir=…` 起**独立实例**（加载 `out/renderer/index.html`，即构建产物，不是 vite 热更页），provider 用仓内 `tools/mock-provider.mjs`（127.0.0.1:8787，`--doc chapters/01-开局.md`）。
测试用书：`scratch/wave1-book`（临时造，锚点「雾从海面涌上来。」唯一；`stages: [{ id: "draft", name: "正文" }]`，初始 `permissionMode: "read-only"`）——**未拿任何真人书稿当对象**。
门禁：`corepack pnpm verify` 跑了两遍，日志 `scratch/verify-wave1-final.log` 与 `scratch/verify-wave1-final2.log`。第二遍**不经管道**：`corepack pnpm verify > 日志 2>&1; echo "VERIFY_EXIT=$?"` ⇒ 日志第 58 行是链尾自印的 `VERIFY_EXIT=0`，第 59 行是 shell 侧真实退出码 `VERIFY_EXIT=0`（两道都在案，退出码没有被任何管道吞掉）。
用例：`Test Files 43 passed (43)` / `Tests 476 passed (476)`（基线 353 用例 / 34 文件 ⇒ 净增 **123 用例 / +9 文件**，目标 ≥400 达成）。
prettier：`All matched files use Prettier code style!`，日志内 `[warn]` 计数 **0**；五个 tsc 项目零诊断；`eslint . --max-warnings=0` 无告警；`边界检查通过`、`行数预算通过`。
密钥纪律：本轮**只用既有 mock 桩的假串**，未输入任何真凭据；命令行/日志/报告/commit 里没有任何密钥串，也没有鉴权头的字面取值（`scratch/verify-wave1-final.log` 里那两类串各计数 0）。

## Step 2：契约变更表对账（实测值逐行抄自 HEAD）

| 项 | 现值 | 波 1 期望 | 实际（命令与出处） |
| --- | --- | --- | --- |
| `IPC_CHANNELS` 键数 | 12 | 13（+`agent:load-session`） | **13** —— `node -e` 切片 `packages/contracts/src/ipc.ts` 的 `IPC_CHANNELS…} as const` 计数 `:\s*"[a-z-]+:` |
| `RendererApi` 方法数 | 12 | 13 | **13** —— 同法切片 `export interface RendererApi` 计两空格字段行 |
| `renderer-api.test.ts` 字面量 | `toBe(12)` + 「只拿到这 12 个方法」 | 两处都是 13 | **两处皆 13** —— `:102 expect(calls.length).toBe(13);`、`:135` 注释「渲染层只拿到这 13 个方法：invoke/on/ipcRenderer 一个字都不许泄漏成键。」 |
| `PROPOSAL_STATUSES` | 6 | 7（+`expired`） | **7** —— `packages/contracts/src/patch.ts:16-24`（`pending/written/rejected/cancelled/stale/failed/expired`，顺序由契约用例整表 `toEqual` 钉死） |
| `ThreadView` 字段 | 7 | 10（+`hydrated` `hydrating` `queued`） | **10** —— `useAgentStore.ts:51,53,55` 三字段在位，切片计数=10 |
| `StartTurnInput` 字段 | 4 | 4（波 1 不动） | **4** —— `agent-event.ts:110-117`（`threadKey/docRelPath/stageId/userText`）；`queued` 未进契约、未进事件、未落盘 |
| `SessionMeta` / `BookStage` 字段 | 6 / 2 | 6 / 2（波 2 才加 `profileId?`） | **6 / 2** —— `agent-event.ts:23-30`（`type/sessionId/docRelPath/stageId/model/startedAt`）、`book.ts:7-10` |
| `book.json` `schemaVersion` | 1 | 1（本波不动盘上形状） | **1** —— `book.ts:15` 与 `:34`（`z.literal(1)`）；临时书盘上实测回读 `schemaVersion=1 permissionMode=chapter-write activeStage=draft` |

## Step 3：用例数对账

计划里的估算是「+98 ⇒ 约 451」，实测 `476`（多出的部分来自各任务评审轮补的反向与越界用例，以及我自己在评审里加的三条：`hasNoMods` 组合、切档成功/失败/同档的弹层收起意图、`closeTab` 数据丢失）。**没有把 400 改小，也没有为凑数删断言。**

## Step 4：变异台账（控制方本人跑，非转录）

统一手法：`Edit` 改变异 → 单跑点名的测试文件（`--maxWorkers=4`，本机 dev 常年在跑，全量 vitest 会假红）→ `Edit` 改回 → 复跑绿 → `git diff --exit-code` 干净。**未用 `perl -i`/`sed -i`。**

> 与计划的一字之差：计划把 M1/M2/M3 的单跑文件写成 `useAgentStore.test.ts`，Task 5 的 D2 裁定（800 行门禁）已把水合用例拆进 `useAgentStore.hydrate.test.ts`，故按 HEAD 的真实落点跑该文件。

| 编号 | 变异动作 | 单跑命令 | 转红的断言（原文） | 改回 |
| --- | --- | --- | --- | --- |
| M1 | `runHydrate` 里 `{ fetchDiff: false, absorbWrites: false }` 的 `fetchDiff` 改 `true`（`useAgentStore.ts:508`） | `corepack pnpm vitest run apps/desktop/src/renderer/src/stores/useAgentStore.hydrate.test.ts --maxWorkers=4` | `FAIL … > 规则4 按事件 id 去重：实时已有 e-message，回放再送同 id 不叠加、旧卡不打 diff IPC`<br>`AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times`<br>`Received: 1st vi.fn() call: Array [ "pOld" ]`<br>`❯ …hydrate.test.ts:87:30 — expect(proposalDiff).not.toHaveBeenCalled();` | 1 failed \| 9 passed → 改回 **10/10 绿** |
| M2 | `replayProposalStatuses` 的 `status[event.proposal.id] = "expired"` 改 `"pending"`（`timeline.ts:225`） | `…vitest run utils/timeline.test.ts stores/useAgentStore.hydrate.test.ts --maxWorkers=4` | ① `FAIL … > 规则4 按事件 id 去重…`：`AssertionError: expected 'pending' to be 'expired'`（`hydrate.test.ts:86`）<br>② `FAIL timeline.test.ts > replayProposalStatuses（回放派生扫描） > 未配对的 proposal 给 expired；有 decision/written 的给对应已裁决态`：`AssertionError: expected { pOpen: 'pending', …(3) } to deeply equal { pOpen: 'expired', …(3) }` | 2 failed \| 70 passed → 改回绿 |
| M3 | 规则 8 让 `error` 结尾也复活「继续」：`if (last?.type === "interrupted")` 改 `=== "interrupted" \|\| last?.type === "error"`（`useAgentStore.ts:518`） | `…vitest run stores/useAgentStore.hydrate.test.ts --maxWorkers=4` | `FAIL … > 规则8（M3）只有 interrupted 结尾才复活「继续」；error 结尾不标 failed`<br>`AssertionError: expected 'interrupted' to be '' // Object.is equality` | 1 failed \| 9 passed → 改回 **10/10 绿** |
| M4 | 删掉 `resolveHotkey` 顶部的合成闸门（`hotkeys.ts:67-68` 两行） | `…vitest run utils/hotkeys.test.ts --maxWorkers=4` | `FAIL … > resolveHotkey · 输入法合成闸门（M4） > isComposing 为真时连 Enter/Esc 都一律 none：候选框回车不提交`<br>`AssertionError: expected 'submit' to be 'none' // Object.is equality`<br>（同轮连带红第二条是 `Ctrl+O ⇒ open-book` 用例，其夹具把 `isComposing` 当真基线 ⇒ 同样证明闸门被别处也依赖） | 2 failed \| 23 passed → 改回 **25/25 绿** |
| M12 | 两条真防线，**都不涉及 `.vue`**：① 临时 `apps/desktop/src/renderer/src/utils/__m12-probe.ts` 写 `Record<PermissionMode, string>` 少两键；② `packages/contracts/src/patch.ts:64` 的 `"doc-overwrite": "整篇替换"` 改「整章替换」 | ① `corepack pnpm tsc --noEmit -p apps/desktop/tsconfig.web.json`（无管道，直接取退出码）<br>② `…vitest run packages/contracts/test/contract.test.ts --maxWorkers=4` | ① `apps/desktop/src/renderer/src/utils/__m12-probe.ts(3,14): error TS2739: Type '{ "read-only": string; }' is missing the following properties from type 'Record<"read-only" \| "chapter-write" \| "full-access", string>': "chapter-write", "full-access"`；删探针后 `TSC_EXIT=0` 且日志 0 行<br>② `FAIL … > 权限档与提案模式的文案表（铁律 6：一张表，穷尽键） > PROPOSAL_MODE_LABELS 覆盖 PATCH_MODES，中文逐字钉死`：`AssertionError: expected '整章替换' to be '整篇替换' // Object.is equality` | ① 删文件即回 0 诊断；② 改回 **9/9 绿**；五条跑完 `git diff --exit-code` 干净、`git status --porcelain` 空 |
| 追加（P1 的变异证明，提交 `ca67ec3` 之后补跑） | `useBookStore.ts:257` 的 `{ …toRaw(this.meta), permissionMode: mode }` 去掉 `toRaw` | `…vitest run stores/useBookStore.test.ts --maxWorkers=4` | `FAIL … > 切档交给主进程的是可结构化克隆的裸对象：响应式代理过不了 IPC`<br>`AssertionError: expected '权限档没改过来：[object Array] could not be c…' to be '权限档已切到「可改当前章」，下一次审批就用这一档判断。'`<br>`❯ useBookStore.test.ts:388:26` | 1 failed \| 30 passed → 改回 **31/31 绿**，`git diff --exit-code` 干净 |

**M12 的硬话（不许粉饰）**：把 `ProposalCard.vue` 的 `modeLabel` 逐字改回 HEAD 的三元链，三道闸**一个字都不红**——根因是 `tsconfig.web.json` 走 `renderer/vue-shim.d.ts` 的 `declare module "*.vue"`，tsc 根本不进 `.vue`；`vitest.config.ts:5` 的 include 只有 `*.test.ts` 且 `environment: "node"`。本轮实测：全仓 `*.test.ts` 里**没有任何一条** import `ProposalCard.vue`（`grep -rln ProposalCard --include=*.test.ts` 的命中只有 `useHotkeys.ts`/`hotkey-markers.test.ts`/`timeline.ts` 的注释与字符串）。⇒ 「渲染层真的在读这张表」只有代码行号 + 冒烟肉眼为证，无断言。

## 门禁插曲：`eslint .` 不吃 `.gitignore`（如实记录）

冒烟脚手架放在 `scratch/`（已被 `4df8ee2` 忽略），但**根 `eslint.config.js` 的 flat config 只忽略 `node_modules/out/dist`**，于是 `eslint .` 照样进去检查，我的 CDP 驱动器把 `VERIFY_EXIT=0` 撞红：4 条（`cdp.cjs` 两处 `@typescript-eslint/no-require-imports` + `no-useless-assignment` 的 `let expr = ""`；`dump-state.js` 未使用的 `b`）。
处置：**只改探针**——加显式 `/* eslint-disable @typescript-eslint/no-require-imports -- 本文件是 .cjs 冒烟小工具，CommonJS 就是它的形态 */`、`let expr;`、把 `b` 用起来（`out.hasBook = …`）。**没有动 `eslint.config.js`、没有新增忽略项、没有把 `--max-warnings=0` 放宽、没有 `--no-verify`。** 复跑：`ESLINT_EXIT=0`、prettier 无 `[warn]`，随后全链 `VERIFY_EXIT=0`。

## P1（冒烟当场撞出的真缺陷，已修已提交）

`PermissionMenu` 里点「可改当前章」⇒ 中栏状态条出现主进程侧的 `An object could not be cloned.`：**切档根本没落盘**。
根因：`useBookStore.setPermissionMode` 把展开自响应式代理的 `meta` 直接交给 `window.mochen.saveMeta`；Electron 在 IPC 的 send 端做结构化克隆，嵌套代理（`stages` / `chapterOrder`）当场抛。
修法一行：`const next: BookMeta = { …toRaw(this.meta), permissionMode: mode };`（`useBookStore.ts:257`）。
先红后绿：新用例把 `saveMeta` 的桩换成 `structuredClone(meta)` ⇒ 变异态红 `expected '权限档没改过来：[object Array] could not be cloned.' to be '权限档已切到…'`（Node 的 `structuredClone` 报「[object Array]」，Electron 报「An object could not be cloned.」——同一件事的两种措辞）；`toRaw` 落地后 31/31 绿。
真机复验：切到「可改当前章」当场成功——`book.json` 回读 `permissionMode=chapter-write`、状态条文案与 §7 口径逐字一致、弹层收起、`metaSaving` 落回 false。提交 `ca67ec3`。

## 真机通过项（§16 第 1–4 项，逐条观测）

> **端点差异（先说清）**：spec §16 表头写的是 agnes 真端点，本波 1–4 项全程用仓内 mock（`tools/mock-provider.mjs`，127.0.0.1:8787）。理由是这四项验的是回放、打断续写、键位与档位闸，四条都不依赖模型回答质量；凡「只有真模型才能判真伪」的那一句（第 2 项的「续写不重复已流出的句子」）在下面如实记为未证，不拿 mock 的绿当真机的绿。

### 1 回放：关应用 → 重开 → 打开同一章

- 重启前该会话 JSONL **45 行**（`wc -l` 当场回读）。关掉实例、重开进程、打开同一章后：线程 `items=45`（1:1，`session-meta` 不落条目）、`hydrated=true`、提案卡 5 张全回来。
- 中栏内容：用户句、思考、工具卡、正文都在；卡头是「第 N 轮 · …」形态（第 1/3/5 轮各带轮次号），**屏幕上没有出现「本轮」**——旧卡没被当成当前轮。
- 分组：两张已批准的在「已裁决的提案 · 2 条」折叠组里、状态「已写入」；未裁决的 3 张落在「上次会话未处理 · 3 条」组里，**四键 enabled 计数 0**，卡上两句提示逐字在位（「这一条要在新一轮里重新提出。」「这条历史提案的 diff 不再取回。」），且 diff 为空（回放不再取 diff）。⇒ 「跨重启绝不复活可批准的待审队列」这条铁律在真机上成立。
- 磁盘：回放后 JSONL 仍是 45 行（只读通路）；`.mochen/changes/` 两个备份目录（`14-33-59-460Z`、`14-38-02-406Z`）仍在；`chapters/01-开局.md` 的 md5 `b820bd342aa5522b0b29505be27b500f` 回放前后未变。
- 与计划的一字之差：计划按「两条卡、1 条未批准」写期望形状，实跑时书里已累积 5 张卡（3 张未裁决）——形状一致，只是数字不同。

### 2 打断后重启的「继续」

- 打断：14:43:09Z 流式进行中按 Esc ⇒ keydown `defaultPrevented=true`、`stopTurn` 返回 true、线程 `endedAs="interrupted"`。
- 磁盘：残字落盘（最后一条 `reasoning` 带 `interrupted:true`，并有 `interrupted` 事件、该轮 `pendingProposals:0`）；**零写盘**（正文 md5 未变、无新备份目录）。
- 「继续」按钮：打断态与重启后都在位且未禁用；点下去真的发出续写轮（mock 返回固定续写文本），线程回到 `done`，未重复挂卡。
- **未证到的两点（如实）**：① 计划要求「续写不重复已流出的句子」——mock 的续写内容是定值，这条判不了真伪，留给接真端点的那轮；② 状态行的打断口径文案只有单测在钉，冒烟当时没肉眼读到那一行。

### 3 键位实操（Step 5 的 11 格，逐格）

| 格子 | 真机结果 | 观测原文 |
| --- | --- | --- |
| `Enter` 提交 | ✓ | 15:32:23Z 我本人的阳性对照：JSONL 新增 `user-message \| 合成期间的候选框回车` |
| `Shift+Enter` / `Ctrl+J` 换行 | ✓ | 两条都只加换行、不发送（`running=false` 下 composer 累积出 `\n\n`） |
| 运行中 `Tab` 排队 + 只自动发队首一条 | ✓（徽标有缺口） | 慢轮进行中打「排队甲」按 Tab ⇒ 该轮结束后**恰好**发出 1 条新轮（用户句「排队甲」），`queued=[]`，无重复发送。**缺口**：真按 Tab 的那一刻没拍到徽标（我在 drain 之后才读）；状态行的「排队 N 条」形态另有实读——`工作中 · 0s · Esc 打断 · 排队 2 条` |
| 队列非空时 Esc 打断 ⇒ 队列不清 | ✓ | 打断后 `items` 只按预期增长，队列一条未丢（`L18459` 那次复核：「no queued message was lost」） |
| 第 6 条被拒 ⇒ 「排队指令最多 5 条，先等这一轮结束。」 | ✓（半） | 实读到 `{"queued":5,"notice":"排队指令最多 5 条，先等这一轮结束。","badges":[]}`。**但**这次是我直调 store 造的 5+1，没走真 Tab 键盘路径；`badges:[]` 说明屏上没抓到这条上限徽标 |
| `y` / `a` / `p` / `d` | y ✓ / p ✓ / d ✓ / a 半 | `y` ⇒ `decision:"accept-once"` + `written`（磁盘 diff 从「雾从海面涌上来。」变「海雾涌上来，铁锈味…」）；`p` ⇒ `accept-prefix`，随后新卡自动变 `written`；`d` ⇒ 只把焦点移进说明框（`{"tag":"TEXTAREA","guidance":true,"cardStatus":"pending"}`），未提交；`a` ⇒ 键事件确实发出（`sent:"a"`）并出现过 `accept-session` 的 canary，但主会话 JSONL 里**没有一条** `decision:"accept-session"` ⇒ 这一格不算闭合 |
| 说明为空时「拒绝并说明」不生效 | ✓ | 说明框空时按钮 `disabled`；打「这句太用力…」后 `{"enabled":true}` |
| `expired` 组四键全无反应 | ✓ | 焦点在 `st:"expired"` 的卡上连打 y/a/p/d 与 Esc ⇒ 决策日志计数不变（12→12），`stops` 也没被顺手加 |
| `Ctrl+PageDown/Up` + `Ctrl+1..9` 越界 | ✓ | PageDown 从 index 1 环形回 0、PageUp 回 1；`Ctrl+1`→01、`Ctrl+2`→02；标签只有 1 个时 `Ctrl+2`：**`defaultPrevented=false` 且活动标签未变**（越界把键交还浏览器，不是切到最后一个） |
| `Ctrl+B` / `Ctrl+,` | ✓（有缺陷） | `Ctrl+B` ⇒ 左栏 `false→true` 折叠；`Ctrl+,` ⇒ `currentView="settings"`，浮层里读到「模型名」「密钥（留空则保留已存的那把）」。**缺陷**：浮层开着、composer 聚焦时按 Esc **没有**收回 `currentView`，之后是靠别的操作关掉的 ⇒ 记进留底 |
| `/` 面板：↑↓ / Enter 执行 / Esc 关闭不打断 / `/s` 过滤 | ✓ | `↑↓` 环形在位；输入 `/s` ⇒ `{"v":"/s","rows":["/status"]}`（`/stage` 被 `GATED_COMMANDS` 滤掉，不出现）；Enter 执行 ⇒ 状态条「状态 · 线程 chapters/02-中段.md · 历史已回放（0 条） · 提案 0 张…」；面板开着时跑一轮慢回复，按 Esc ⇒ `{"p":false,"run":true,"stops":4}`（面板关了、轮还在跑、`stopTurn` 一次没多） |
| `Esc` 三态 | ✓ | ① 说明框有字 ⇒ 焦点移到 `BODY`、文字「这里的情绪再收一点」原样保住、未发决策；② 聚焦待审卡且说明为空 ⇒ 该卡 `decision:"cancel"` 落盘（14:59:36Z）；③ 无卡 ⇒ 打断本轮（即 14:43:09Z 那次） |
| **中文输入法候选框回车不提交**（必实跑） | ✓（合成级） | 向 composer 注入文本（native value setter + `InputEvent("input",{isComposing:true})`），再派发 `new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true})` ⇒ 线程 items **169→169**、文本原样留在输入框、JSONL 无新 `user-message`；同文本改纯 Enter ⇒ 当场成轮（items→173，15:32:23Z 落盘）。**留底**：这是合成的 `isComposing` 事件，不是真 OS 候选框；真键盘拼音上屏回车还欠一次人肉按键 |

### 4 权限档（Step 5 的 6 格）

| 格子 | 真机结果 | 观测原文 |
| --- | --- | --- |
| 头部标签可点，三档文案逐字 + 当前档「（当前）」 | ✓ | 只读档下弹层 `items=["只读参考\n（当前）","可改当前章","全开"]`；切档后再读 `{"chip":"可改当前章","items":[{"t":"只读参考"},{"t":"可改当前章 （当前）"},{"t":"全开"}]}` —— 与 `PERMISSION_LABELS` 逐字一致，「（当前）」跟着当前档走 |
| 只读档点批准 ⇒ `permission.test.ts:47-48` 钉的两句，卡仍待审、磁盘未动 | ✓ | 会话 JSONL 里这句逐字落盘 14 次，最早一条 `2026-10-02T14:17:49.982Z`：`这条提案没有写入：当前权限档为「只读参考」，提案不会写入磁盘。可以先给出提案与理由；确实要落盘时，把权限档切到「可改当前章」或「全开」后再批准。` = `agent-service.ts:300` 的前缀 + `permission.ts:42-43` 的唯一出处（与 `permission.test.ts:47-48` 的 `toBe` 一字不差）。屏上中栏同句，卡状态仍 `pending`，正文首行仍是「雾从海面涌上来。」 |
| 切到「可改当前章」⇒ 状态条文案 + 当场批准真落盘 + 备份新增 | ✓（先撞 P1） | 第一次切档被 P1 挡住（`权限档没改过来：An object could not be cloned.`，`ca67ec3` 修好）；修后实读 `{"modeAfter":"chapter-write","noticeAfter":"权限档已切到「可改当前章」，下一次审批就用这一档判断。"}`，`book.json` 回读 `permissionMode: "chapter-write"`，随后批准落盘并新增 `.mochen/changes/2026-10-02T14-33-59-460Z/chapters/01-开局.md.bak` |
| 切档后仍留 `pending` 的可批准；已拒绝的不回来 | ✓ | 前者：切档后 14:52:22Z / 14:52:43Z 两条 `accept-prefix` ⇒ `written`。后者：`deny-with-guidance`（15:05:20Z）把卡打成「已拒绝」，再把档位切到**全开**（状态条文案与菜单自动收起都对，`metaSaving` 落回 false）⇒ 该卡**仍是「已拒绝」**，没有变回待审；弹层里那句提示也在位（「已经拒绝或取消的提案不会回来，切档后请在新一轮里重新提出；仍留在待审的提案，切档后可以马上批准。」） |
| 没开书时切档 ⇒ 「还没打开作品目录，权限档改不了。」 | ✓（有缺陷） | 为这一格起了**第三个实例**（9224、独立 profile，不碰用户正在用的 9223）：弹层三档 `disabled=true` ×3、提示「还没打开作品目录，权限档改不了。」。源码与用例逐字对应（`PermissionMenu.vue:74`、`useBookStore.ts:248`、`useBookStore.test.ts:407`）。**缺陷**：计划要求「标签也 disabled」，实读 `{"chipText":"只读参考","chipDisabled":false}` ⇒ 无书时头部标签照样可点、还捏造出「只读参考」这个标签 |
| `/permissions 随意改` ⇒ 「没有这一档…」且不写盘 | ✓ | 我本人在面板里输入 `/permissions 随意改` 并回车 ⇒ `{"palette":false,"notice":"没有这一档：「随意改」。可选：只读参考 / 可改当前章 / 全开。","mode":"chapter-write"}`，与 `useAgentStore.ts:546` 逐字一致；档未变、`written` 计数仍 5 |

**一处更正（我的转述不是屏幕原文）**：先前工作笔记里我记过一句「只读参考这一档下我改不了文稿。想让我落这一处…」，本轮三路查证——全仓 grep（含 `apps/desktop/out` 构建产物与 `tools/mock-provider.mjs`）、`git log --all -S"改不了文稿"`、`git log --all -S"这一档下"`——**该串在代码、构建产物与全部历史里都不存在**。它是我脑内的转述，不是 UI 文案；以 JSONL 落盘的那条 `error` 事件为准（就是上表那句）。这条教训写进报告，免得下波有人拿我的转述去对源码。

## 无法归因的输入（如实记账，不甩锅也不背锅）

> **本轮复核后的归因修正**（原先笼统记成"不是我发的"，现按 JSONL 逐条重判）：
>
> - 14:59:36Z `decision:"cancel"`（卡 `7caae807`）**是我发的** ⇒ 它就是 §16-3 的 Esc 三态第二态（L18805 的实录）。
> - 15:05:20Z `decision:"deny-with-guidance"`（卡 `9ee7343b`）**是我发的** ⇒ §16-4 的「已拒绝不回来」那一步。
> - 上面「键位」表里 `a` 那一格要连这条一起读：键事件确实发出（`sent:"a"`，mods=0），但它落到的卡早已不在待审列表 ⇒ 主进程拒绝，盘上没有 `decision:"accept-session"` ⇒ 该格不算闭合。

仍然对不上号的只剩下面这几笔：

- 14:52:47–14:53:00Z **8 次**批准入路（我这边的记录是 7 次 `accept-once` + 1 次 `accept-session`），全部打在早已失效的旧卡上 ⇒ 主进程逐条回 stale 拒绝句（`agent-service.ts:326`：「提案之后 chapters/01-开局.md 又被改动过，这条建议已失效；我没有覆盖你的改动，请让模型基于最新正文重出一条。」），**零写盘**。我的 `store.decide` canary **一条都没记到**——最可疑的解释是当时页面重载把包裹冲掉了，而我自己有一批内联 CDP 循环直调过 decide；不能排除这是我自己发的，但**没有证据**，所以只记成"未收口"。同类 stale 拒绝在 14:34:00Z、14:49:13Z 也各有一条，那两条我能归因：是我为了重放锚点手工把章节从 `.bak` 还原过，指纹自然对不上。
- 15:13:09Z 又一条 `error{stale}`；15:13:16Z **一整轮** `user-message "2"` → `reasoning` → `tool-call` → `message`（新挂一张待审卡，未批）；15:31:26Z 再一轮（模型答句「提案已经挂在下面，等你点批准才落盘。」）。这三笔都不是我的 CDP 调用：键位录制器 `__keys` 只记到我发的 y/a/p 各一，事后装的捕获阶段 click 探针记到 0，我自己的 eval 全是只读。
- 排除项（代码侧）：主进程没有"重启后自动重放待审"的循环——`applyDecision` 只有"登记时命中已有授权自动批准"与"渲染层决定"两条入路，且自动批准那两条（`:236-238`）都要求先存在 grant，而 grant 只在**写盘成功之后**才加入（`:358-359`）；`stale`/指纹分支在任何 grant 落库前就返回。
- **边界（可核）**：`.mochen/changes/` 备份目录自始至终 **5 个**（`14-33-59-460Z`、`14-38-02-406Z`、`14-46-55-571Z`、`14-52-22-124Z`、`14-52-43-164Z`），JSONL 里 `written` 事件恰好 **5 条且全部 ≤14:52:43**、每条都能配到一条更早的同 id `decision`；`chapters/01-开局.md` 正文停在 prefix 授权那一次的「海雾涌上来，铁锈味很冲。」——14:53 之后**磁盘一字未动**，只有会话流水多了几行。
- 最可能的解释：9223 那个窗口在桌面上是可见的，冒烟尾声有人（或残留自动化）用真键盘操作了它。我**没有**把它算作 §16 的证据，只在这里记账；处置是停手不再驱动该实例（该实例与 mock 8787 我都留着没杀）。
- 附带发现（留底，不在本波修）：`stale` 这个已裁决态**不随回放存活**——盘上有 `error{stale}` 但没有对应的 `decision`，回放派生扫描把这类卡归到「未处理」组而不是「已失效」。这是波 1.5 的账。

## 未做 / 留底（如实）

- `/stage` 在波 1 被 `GATED_COMMANDS` 滤掉：真机 `/s` 过滤实测 `rows:["/status"]`（`stage` 不出现），面板与状态条都没这条路；波 2 Task 18 删闸门并补 `profilesReady`。
- `/permissions <档名>` 只到"反查 + 当场切档"，档位菜单的预选高亮仍未接真机验证（`/permissions 随意改` 的反例已验）。
- `/resume`、`/clear` 两条命令**真机一次都没跑**（只有单测）。回放通路是靠"关进程重开"证的，不是靠 `/resume` 证的。
- `useHotkeys.ts` 的「≤40 行」目标：判定确已全在 `utils/hotkeys.ts`（+ `escape-policy` / `hotkey-focus` / `hotkey-decisions` / `hotkey-markers`），但薄壳要派 13 个动作，实际 **199 行**；波 2 若再涨就把 `dispatch` 收进 store action。
- `App.vue` 不渲染 `currentView === "settings"` 视图，故 `Ctrl+,` 与 `/model` 走 CenterColumn 桥（波 2 若加独立设置视图需改桥）。
- 真机撞出、本波**没修**的三条界面缺陷：① 设置浮层开着且 composer 聚焦时，Esc 不收回浮层（要靠别的操作关）；② 无书时头部档位标签仍 `disabled=false` 且文案捏造成「只读参考」（计划要求标签也禁用）；③ `stale` 不随回放存活（见上节）。另有一条已修：弹层 Esc 关闭通路（F-1，已提交）。
- prefix 作用域的授权语义只有真机证据（14:52:22 / 14:52:43 两条 `accept-prefix` ⇒ 新卡自动 `written`），`autoDocTool` 的键构成没有专门的单测；波 2 档案进 `ruleKey` 前需先补。
- 计划里 §16 第 4 项要求"三档各批准一条提案"：只读档（拒绝）与「可改当前章」（落盘 5 次）都跑到了；**「全开」档下只验了切档与"已拒绝不回来"，没有在那一档点过批准**。
- 中文输入法只做到**合成级**证据（`isComposing` 的 KeyboardEvent 闸门 + 纯 Enter 阳性对照）；**真 OS 候选框回车欠一次人肉按键**，这一条 spec 标了"必实跑"，所以本波不给自己打满。
- Step 8 那条「commit 里搜密钥前缀与鉴权头字样必须无输出」**按字面跑不干净**：改动行里没有任何密钥材料（本报告与计划的新增文本刻意不写那两个字面前缀；两份门禁日志里两类字样各计数 0，`grep -c` 当场回读），但那两个词作为**指令本身**写在本波计划里，`git log -p -1` 会把它当上下文带出来 ⇒ 命中它自己。实质达标、字面不达标，这一格留着不勾，不改成「无输出」来凑绿。
- 本轮冒烟**只用既有 mock 桩的假串，未输入任何真凭据**；spec §16 表头那把真端点密钥按纪律仍"**已提醒轮换**"（本轮没有新密钥入盘，`secrets.enc` 未写）。


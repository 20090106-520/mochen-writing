# 全仓扫描总单（2026-10-09，只读，未改任何源码）

扫描方式：六个只读子代理分路（主进程安全/IPC、数据落盘、Agent 运行时、渲染层状态、渲染层 UI、工程基建），
我自己在同一棵树上跑门禁、抽验每一条 P0/P1 的证据行号，并补了几项分工外的实测（书籍规模、依赖、CSP/导航闸）。
工作树里有另一会话 11:05–11:17 的 34 处未提交改动，全程只读未动。

## 一、总体结论

**代码卫生极好，产品有四处要命。** 门禁实测：typecheck / eslint / boundary / 行预算 / 全量 vitest（217 文件 3037 用例）全绿，
`pnpm build` 绿，全仓只有 2 处 `eslint-disable`、1 处 `any`、0 个 TODO；两处 `v-html` 都先整体转义且有回归线（XSS 已修，不是问题）。

真问题集中在四类：

1. **会丢字**——写盘非原子 + 保存失败把自动保存永久打死 + 关标签静默扔草稿 + 退出无落盘兜底 + 设定/笔记只住 localStorage。
   这五条是同一条链，叠起来就是「用户敲的字和攒的设定在四种常见情形下消失且零提示」。对写作产品这是最高优先级的缺陷族。
2. **界面上有控件但没有通路**——归档是单向门（点了取不回来）、目标面板两枚统计恒 0、大纲「按类型」是假档、
   「批注」页签指向一个不存在的入口、字号设置对三个面板无效。见第四节之二那份逐条清单。
3. **开关与授权名不副实**——联网关掉后工具仍可被调用并真出网；「本会话自动批准」不按书隔离，会在另一本书里
   不经确认直接写盘；`provider-settings` 一次 IO 失败会把整份模型配置读成「没配过」并在下次保存时重写丢全部连接。
   这三条与已修的 ef46153 是同一族：**声明的边界不是代码里的边界**。
4. **从没在真实规模上跑过**——验收用的两本书是 5 篇和 2 篇，而目标用户是 1000–3000 章的网文作者：
   开书串行全量读每一篇正文、新建一章再全量重扫一次、每轮开头整本重读所有会话文件、会话历史零截断。
   这些在 5 篇书上全都是绿的。

另外两条**结构性**缺口：**没有 CI、没有打包发布链路**（`out/` + `electron .` 就是终点）。所以「门禁全绿」只在这台
Windows 机器上人工成立过，且产不出任何可安装的交付物。还有一条实打实的门禁漏洞：`plugin-kernel` 四包之一
从未进过 typecheck，我单独跑它当场报 TS2352 + TS7006——带着两个类型错误全绿了不知多少轮。

> 【2026-10-12 现状回读，逐条见第二十三节】上面这三句里**只剩中间那句还成立**：`.github/workflows/verify.yml` 现在在 HEAD 里
> （每次 push 与 pull_request 跑整条 `pnpm verify`，runner 钉 `ubuntu-24.04`），`plugin-kernel` 也进了根 `typecheck` 的六个程序；
> 而「产不出可安装的交付物」照旧——`git ls-files` 里没有任何打包配置。这三句按 2026-10-09 的现场**原样留着不删**，
> 删掉就等于把「当年为什么判它危险」的证据一起抹了。

## 二、门禁实测（退出码逐条回读，未用管道吞码）

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm typecheck`（5 个项目） | 绿，exit 0 | `/tmp/mochen-gate/typecheck.log` |
| `pnpm lint:eslint`（`--max-warnings=0`） | 绿，exit 0 | `eslint.log` |
| `pnpm lint:boundary` | 绿（"边界检查通过"） | `boundary.log` |
| `pnpm lint:budget` | 绿（"行数预算通过"） | `budget.log` |
| `pnpm test`（全量 vitest） | 绿，**217 文件 / 3037 用例** | `vitest.log` 尾部 `Test Files 217 passed` |
| `pnpm format:check` | **红，exit 1** | 3 个文件未过 prettier：`apps/desktop/src/main/agent-ipc.test.ts`、`apps/desktop/src/main/provider-settings.test.ts`、`apps/desktop/src/renderer/src/stores/useProviderStore.test.ts`——全在另一会话的未提交改动里，**当前树提交不了** |
| `pnpm build` | 绿（`✓ built`） | `build.log`；产物 bundle：渲染层单文件 JS 2.90 MB、CSS 325 KB、含 three.js 的 draco wasm ~478 KB |
| `tsc -p packages/plugin-kernel/tsconfig.json` | **红，exit 2** | `test/app.test.ts:209` TS2352、`:213` TS7006。根 `package.json:16/24` 的五个 tsc 项目里没有这一包（`grep -c plugin-kernel package.json` = 0） |

## 三、P0 —— 丢正文 / 丢设定 / 破坏授权，会直接伤到用户作品

「验证」列：**实读**=我逐行读过源码确认；**子报**=子代理给出且证据行号一致但我未逐行复验。

| # | 问题 | 证据 | 用户怎么踩到 | 验证 |
| --- | --- | --- | --- | --- |
| P0-1 | 正文写盘不是原子写：全仓无 temp+rename/fsync，`writeFile(target, content, 'w')` 先截断再写 | `packages/fs-store/src/read-write.ts:93-94`；`book-service.ts:123`（book.json 同样裸写）；`grep rename/fsync` 在 fs-store/src 零命中 | 写到一半断电/强杀/ENOSPC ⇒ 章节文件半截。书目录在 OneDrive/坚果云或杀软扫描时（Windows 常态）概率不低。book.json 半截更狠：`open()` 解析失败即抛，**正文都在盘上但这本书再也打不开** | 实读 |
| P0-2 | 保存失败把自动保存永久打死，且屏上零提示 | `useBookStore.ts:556-564`：`await window.mochen.writeDoc(...)` 外面没有 try/catch，`saving=false` 在 await 之后；一旦 IPC reject（主进程 `read-write.ts:81/93` 的 IO 抛错一路上来，`book-service.ts:143` 也不 catch），`saving` 永远停在 true ⇒ 手动按钮被 `DocumentPane.vue:791` 禁用，自动保存被 `:556` 的 `if (this.saving) return` 永久挡住 | 一次占用/权限错误之后，用户继续打字，界面上还是那个「已自动保存」的样子，**从此再没落过一次盘**，关程序全丢 | 实读 |
| P0-3 | 关标签静默丢弃未保存草稿，无任何确认 | `useBookStore.ts:333-336`：`closeTab` 直接 `delete this.draftsByPath[relPath]`，全程不查 `dirty`；调用方 `DocumentPane.vue:322-324`、`ComposerContextBar.vue:71` 也都没有拦截；全仓 `grep confirm(`/`beforeunload` 只有左Sidebar 搜索框一处无关命中 | 自动保存关掉（设置页 0 = 关这一档真实存在，`autosave-preference.ts:21`）或在 2s 静默窗内点 × ⇒ 刚写的几百字当场蒸发，连一句「未保存」都不问 | 实读 |
| P0-4 | 「本会话自动批准」不按书隔离 ⇒ 跨书不经确认写盘 | 键是 `ruleKey = docRelPath::tool`（`agent-service.ts:118-120`）与 `threadKey`（= 文稿路径，`utils/agent-thread.ts:87-91`），都不含书根；`clearBookScoped()`（`:146-149`）**明确不清**这两张表；命中即在 `registerProposal:339-341` 排进 `applyDecision`，走唯一写盘通路 `:457` | A 书里点过一次「接受并本会话自动批准」，换到 B 书只要章节默认标题撞名（`book-scope.ts` 自己的注释就写着「新建章节的默认标题极易撞」），B 书的提案**直接落盘**，用户没批过 | 实读 |
| P0-5 | 一次读失败把模型配置读成「没配过」，且缓存永久中毒 | `provider-settings.ts:104-106`：`ensure()` 先置 `loaded = true` 再 `await readRawText()`，非 ENOENT 抛错（`:92-98`，EBUSY/EACCES 走这一支）后 `cached` 停在 null 且不再重读 ⇒ `view()/config()`（`:174/178`）此后**静默**返回未配置；下一次任何保存以 `store===null` 走新建分支，`writeStore`（`:101-103`）整份重写 | 用户看到的是一句「还没有配置模型服务」，去设置页填一下 ⇒ **其余连接与全部模型档案被整份覆盖**，密钥文件按新 UUID 改名，旧 `<连接id>.enc` 成孤儿再也清不掉 | 实读 |
| P0-6 | 退出/崩溃无任何落盘兜底，主进程也没有异常钩子 | 全仓 `grep requestSingleInstanceLock / uncaughtException / unhandledRejection / before-quit / window-all-closed` **零命中**（我自己跑的，命令返回 1）；清理只挂在 `index.ts:308` 的 `win.on('closed', agent.dispose)` | 脏稿只在内存里，关窗口/进程异常退出=直接丢；启动装配里任一处抛（目录迁移、credential store）⇒ 窗口永不出现、无提示，用户以为双击没反应 | 实读 |
| P0-7 | **故事圣经 / 笔记 / 写作目标是「全局一份 + 只住 localStorage」**，既不随书隔离也不落作品目录 | `useNotesStore.ts:32`、`useStoryBibleStore.ts:33`、`useWritingGoalStore.ts:56` 三个键 `mochen.notes.v1` / `mochen.story-bible.v1` / `mochen.writing-goals.v1` 都不带书标识；三个文件里 `window.mochen` 出现次数 = **0**（我实测计数）；而 `useNotesStore.ts:8-9` 的注释写着「如果作品有 rootPath，也可同步存到作品目录的 .mochen-notes/」——**这句是假话** | 两本书的人物设定/笔记互相串台（换个项目打开，设定库里还是上一本的人物）；清缓存、换电脑、重装系统 ⇒ 设定与笔记全丢，而正文安全地在盘上，用户会以为「软件把我的心血删了」。这条和 P0-1/2/3 同族，只是丢的是设定 | 实读 |
| P0-8 | **归档是单向门**：点了「归档」之后没有任何取回入口 | `NotesPanel.vue:212`、`StoryBiblePanel.vue:443` 只调 `archiveNote`/`archiveEntry`；`unarchiveNote`（`useNotesStore.ts:144`）与 `restoreEntry`（`useStoryBibleStore.ts:198`）**全仓零调用**（我逐条 grep，只有定义与导出两处命中）；也没有「已归档」视图 | 用户以为笔记/设定只是收起来，实际再也看不见也取不回——在他眼里等同于「软件删了我的东西」，而内容其实还在 localStorage 里 | 实读 |

## 三之二、P0 现状总表（第 1–4 波 + 第 1.5 波之后，逐条对盘回读）

同一棵树上改的，八条 P0 全部收口。证据列的每个文件名都是写这张表时 `ls`/`grep` 回读过的，测试条数取自当场 vitest 日志，不是记忆。

| # | 现状 | 改法与落点 | 盘上证据 |
| --- | --- | --- | --- |
| P0-1 | **已修**（收尾补了一刀） | 新增唯一写盘原语 `writeFileAtomic`（tmp → fsync → rename，失败清 tmp），原先各处裸写——正文、`book.json`、改稿备份、建书、设定 JSON、外观配置、保留策略配置、凭据密文、模型配置——全部改走它。补的那一刀：rename 只对 `EPERM/EACCES/EBUSY` 这一族「此刻正被别人拿着」的码有界重试（默认含首次共 4 次、20/40/80ms 递增退避），其余码一次就抛——理由与实测见 `atomic-write.ts` 里 `TRANSIENT_RENAME_CODES` 上方那段 | `packages/fs-store/src/atomic-write.ts` + `test/atomic-write.test.ts`（10 条，其中改名重试 3 条）；9 个调用文件：`read-write.ts`、`book-meta.ts`、`changes.ts`、`create.ts`、`book-data.ts`、`main/appearance-store.ts`、`main/change-retention-store.ts`、`main/credential-store.ts`、`main/provider-settings.ts` |
| P0-2 | **已修** | `saving` 闸改「进 try、出 finally」，IPC 抛错/被拒一律落成一句人话并由界面说；面板上的「已自动保存」从此跟 `saveError` 联动 | `useBookStore.ts` 的 `saveOutcomeOf`（真身在 `utils/draft-flush.ts`）+ `useBookStore.draft-loss.test.ts`；界面侧 5 块面板见 `book-data-save-error-wiring.test.ts`（20 条） |
| P0-3 | **已修** | `closeTab` 先交回未落盘的草稿再删格（`flushDocBeforeDrop`）：写成功才关，IPC 抛错 / 返回 `stale` / 预检冲突三种情形一律**不关**，并把「这一格给你留着，一个字都没丢」这句理由送到界面上 | `utils/draft-flush.ts` + `useBookStore.ts:341` + `useBookStore.draft-loss.test.ts`（4 条）；退出侧同一批原语由 `quit-flush-wiring.test.ts` 钉 |
| P0-4 | **已修** | `ruleKey`/`threadKey` 之前加书根：自动批准的作用域变成「这本书 + 这一篇 + 这一枚工具」，`clearBookScoped()` 现在真的清 | `main/agent-service.ts` + `agent-service-auto-approve-scope.test.ts`、`agent-service-unbound-approve.test.ts`、`main/book-scope.test.ts` |
| P0-5 | **已修** | `ensure()` 只在读成功（或确认 ENOENT）之后才置 `loaded`；一次 EBUSY/EACCES 之后仍能重读，且缓存未成立时**拒绝**整份重写 | `main/provider-settings.ts` + `provider-settings.test.ts` |
| P0-6 | **已修**（10-09 那版当时是**半真**：模块、10 条用例、渲染层兜底都在，但握手挂的事件不在真实退出路径上，用户点关闭时一步都不跑——10-11 用真机探针量出来并修好，见第十七节） | 两层：主进程 `uncaughtException`/`unhandledRejection` 钩子写 `crash.log` 并提示（带节流与「记不了也别再炸一次」的兜底）；`before-quit` 握手（渲染层兜底 flush 完才放行，带超时与「留下」档，正文与设定一起交回）。**没做** `requestSingleInstanceLock`——双开实例这条仍在 P2 清单里 | `main/crash-guard.ts`（5 条）、`main/quit-flush.ts`（10 条）、`utils/quit-flush-client.ts`（7 条）、`components/quit-flush-wiring.test.ts`（2 条） |
| P0-7 | **已修**（本波） | 设定三本（笔记 / 故事圣经 / 写作目标）改走**主进程文件通路**：渲染层只递白名单键 `notes \| story-bible \| writing-goal`，路径由主进程拼，落在书内 `.mochen/data/*.json`，随书隔离；写盘复用 P0-1 的原子写；旧全局 localStorage 键**只在盘上没有这一类数据时**迁一次，迁成功才清；`no-book`/`invalid-key`/`unreadable`/`write-failed` 分档各有话；形状校验三份独立（认不得判读不懂并**停止写盘**） | 契约 `packages/contracts/src/book-data.ts`；文件层 `packages/fs-store/src/book-data.ts`（11 条）+ `book-data.test.ts`；主进程 `main/book-service.ts` 的 `readData/writeData` + `main/book-data-service.test.ts`（7 条）；preload `readBookData/writeBookData`（`preload/renderer-api.test.ts` 6 条）；渲染层通路 `composables/useBookFileData.ts`（18 条）+ `composables/bookDataRegistry.ts`（7 条）；三本 store 各一份 `*.book-data.test.ts`（9 + 8 + 12 条）；形状 `utils/{note,bible,goal}-shape.ts`（10 + 10 + 19 条） |
| P0-8 | **已修** | 笔记档位表加第四档「已归档」、圣经加第五档，取回钮摆在明面上；`unarchiveNote`/`restoreEntry` 不再是零调用 | `components/NotesPanel.vue` + `notes-panel-wiring.test.ts`；`StoryBiblePanel.vue` + `story-bible-panel-wiring.test.ts`；取回归档视图的另一半由 `useStoryBibleStore.seeds.test.ts`（9 条）与 `utils/{note,bible}-scope` 钉 |

localStorage 那一侧的收尾对账：本波之后剩下的键全部是**应用级 UI 偏好**（`hotkey-config`、`notifications`、`onboarding`、`project-manager`、`prompt-templates`、`version-meta` 与各 `*-preference.ts`），不带作品内容的东西不再住全局键。`.mochen/` 也进了目录扫描的跳过表（`packages/fs-store/src/scan.ts` 的 `SKIPPED_DIRS`），设定文件不会被当成章节数进章数。

> **2026-10-13 就地更正**（见第三十一节）：上面那一串里的 `hotkey-config` 已经不成立了——写它的 `useHotkeyConfigStore.ts` 全仓零引用，那一刀里删掉了，所以这个键不再有写入方。其余五枚当场回读，写入方都还在：`useNotificationStore.ts:25`、`useOnboardingStore.ts:24`、`useProjectManagerStore.ts:36`、`usePromptTemplateStore.ts:35`、`useVersionStore.ts:26`。这一条本身就是本节的收获之一：一份**没有守卫的清单**会这样过期。

**这一波没做的**：真机复验。改动跨主进程 / preload / 渲染层，必须重新构建并重启实例才看得见「换一本书设定跟着换」，而机上那只实例属并行会话现场，我没有动它。所以 P0-7 目前证明到的是**用例与门禁全绿**（264 文件 / 3513 用例），不是屏幕上量到的行为。

## 四、P1 —— 正常使用路径上会真出错（按「用户报过 / 未报但更常见」排）

| # | 问题 | 证据 | 影响 | 验证 |
| --- | --- | --- | --- | --- |
| P1-1 | LLM 请求无连接/空闲超时，工具执行不受打断约束 | `provider-fetch.ts` 全文无 timeout；`tool-loop.ts:162` 只递用户的 `signal`；`:233-263` 工具派发循环内不查 `signal`；`agent-service.ts:358` `webSearch: (query) => webSearch(query, {fetchImpl: fetch})` **没接 signal**（每个源 6s 有界，`web-search.ts:75`，但 3 个源串行 × 最多 4 轮 × 模型可能反复重搜） | 这正是台账 `README.md:6399` 记的「联网开着挂 200 秒零响应零报错」的机制解释：**上游一挂起，这一轮永远显示进行中，而用户点打断也停不下来**（要等下轮流式）。台账里这条还挂着「待查」 | 实读 |
| P1-2 | 联网开关只门控出站清单，不门控执行 | `wireToolsFor` 只过滤发给模型的 tools（`provider-client.ts:166`），但 `isCallableTool`（`tools.ts:82-84`）静态放行花名册全部五个，`doc-tools-host.ts:163` 照执行 | 关掉联网后，模型只要仿历史里那条 `web_search` 调一次，**照样真出网**。与已修的 ef46153 同一族：清单和权限用了两套判据 | 实读 |
| P1-3 | 会话历史零截断，上下文占用条不含历史 | `rollout.ts:213-240` `eventsToMessages` 全量回放；`tool-loop.ts:138` `...input.history` 全量拼进 messages；全仓无历史窗口/摘要截断（`grep slice/truncat` 只命中无关处） | 长会话（一章反复改 30 轮）必然撞上游 400/超长，用户看到的是一句失败且**无法自救**（没有「从这里新开会话」之外的清理入口）。占用条显示还有余量，是假余量 | 实读 |
| P1-4 | 开书/建章的读放大：串行全量读每篇正文 | `scan.ts:35-50` `walk` 里 `await` 在 for 循环内（不并发），`docMetaOf:73` 为取 80 字摘录**读整篇**；`book-service.ts:157` 每次 `createDoc` 后整本重扫 | 1000 章 × 3000 字 ≈ 顺序读 3 MB+ 并逐篇 parse，开书与「新建一章」都成秒级卡顿；真实规模从未量过（验收书 5 篇 / 2 篇） | 实读 |
| P1-5 | 会话读放大，且落在**每轮开头** | `findLatestSession` 为读首行把每个 jsonl **整篇读进内存**（`rollout.ts:133` `readFile(file).split("\n")[0]`），`listSessions` 同样整篇读全部会话只为取标题（`:166-175`）；`threadFor` 在缓存未命中时每次调用它（`agent-service.ts:297`，另 `:672`）。JSONL 侧无轮转（保留策略只管 changes） | 换新章的第一句话、打开历史面板，代价都是「这本书全部会话的字节数」；用得越久越慢，而 5 篇书的冒烟里这条永远是绿的 | 实读 |
| P1-6 | 同一文稿并发写无互斥 | 自动保存（`useBookStore.ts:533`）、手动保存（`:556` 的 `saving` 闸只管 auto 分支）、Agent 批准写盘（`agent-service.ts:457`）三路并发进 `writeDocFile`，读-校验-备份-写之间无队列。同仓 JSONL 侧**已知这个坑并修了**（`agent-service.ts:131` 严格串行），正文侧没做 | 我实读补一句公道话：`read-write.ts:72` 的期望指纹闸能拦住大多数交叉（拦住时界面出「文件在外部被改过，已拒绝覆盖」并停掉自动保存，`:580-582`），所以**不是必丢**；丢的是竞态窗口里那次「读到的 onDisk 恰好等于将要覆写的内容」——连点两次 Ctrl+S 会自撞出一次假冲突，需要用户手动处置 | 实读（并发路径与闸的行为我都核过） |
| P1-7 | 三条 IPC 通道裸信 renderer，且无来源校验 | `book-service.ts:51-57`：`book:open` 把 string 直接当绝对路径读 `book.json`、`book:create` 的 directory 同；`paths.ts:5-13` 只做词法 `..` 检查；`agent-ipc.ts:22-34` 等入口 `_event` 一律丢弃，全仓无 `senderFrame` 校验 | 正常 UI 路径由 `book:pick` 对话框给路径，通道本身不认这个来源。叠加 P1-8（无导航闸）后，一旦渲染层能执行脚本：往 `<appData>/plugins/x/index.js` 写文件（`doc:write` 无目录白名单）再触发 `plugins:list` 的 `import()` ⇒ **主进程任意代码执行** | 子报（`_event` 丢弃与 paths 词法检查我实读确认） |
| P1-8 | 窗口不锁来源：无 `will-navigate`、无 `setWindowOpenHandler`、无 CSP | `grep will-navigate/setWindowOpenHandler/onHeadersContent` 全仓零命中（我实跑）；`renderer/index.html` 无 CSP meta；`main/index.ts:134-139` `sandbox: false`；`process.env.ELECTRON_RENDERER_URL` 无 `app.isPackaged` 门 | 主窗口被导航到外部页面后 preload 仍注入全套 `window.mochen`；打包版在 env 被污染时会加载远程 URL。本地单机 app 里这是加固项，但它和 P1-7 是同一条链的两环 | 实读 |
| P1-9 | 右栏「浏览」读盘无 catch、无世代令牌、键不带书 | `useBookStore.ts:496-505`：`void window.mochen.readDoc(...).then(...)`，失败则该格永久空且无提示；`browseContents` 以 relPath 为键，跨书同名文稿会串 | 打开第二本书时，旧书那次慢回包会按同 relPath 写进新书的缓存。对照已核：`openDocTab` 有 `docLoadToken` 防护（`:307-311`），说明这个模式在仓里已建立，只是 browse 这条路没接 | 实读 |
| P1-10 | **写作目标热力图的星期标签是错的** | 面板写死 `weekdayLabels = ["一"…"日"]`（`WritingGoalPanel.vue:85`）并按数组下标贴（`:178` `weekdayLabels[idx]`），而数据是「最近 7 天滚动窗口」（`useWritingGoalStore.ts:156-163` 从 `now - i*86400000` 倒推）。窗口起点几乎不可能是周一 ⇒ **除今天正好是周日之外，七天里有六天标错** | 用户照标签找「昨天写了没」，读到的是错的那天；这类错日期比缺功能更伤信任 | 实读 |
| P1-11 | 渲染层无行为测试、`.vue` 完全不进类型程序 | `tsc --listFiles` 里 `.vue` 计数 = **0**（我实跑）；`renderer/vue-shim.d.ts` 把所有 .vue 声明为泛型组件，props 全 any；`vitest.config.ts:6` 只有 node 环境，未装 @vue/test-utils/jsdom；142 个渲染层测试里 65 个是对源码**字符串**做正则断言（如 `composer-toolbar-narrow.test.ts:54`） | 台账 `README.md:6272` 已经承认这条（「`.vue` 不进类型程序 ⇒ tsc 全绿」），但它是**系统性**的：165 个渲染层文件的模板/props 零静态检查，靠「读源码正则」的守卫一旦被重构换写法就漏检——5-㊺ 那个「能添加不能切换」的 bug 正是这么躲过三道门的 | 实读 |

## 四之三、P1 现状总表（第 2 波进行中，逐条对盘回读）

同样是「已修 / 未修」两档，证据列的文件名与条数当场 `ls`/`grep`/`git diff HEAD` 回读过。

| # | 现状 | 改法与落点 | 盘上证据 |
| --- | --- | --- | --- |
| P1-1 | **已修** | 三层闸：① 上游首字节 30s、流中空闲 60s 各有一只看门狗，超时抛 `UpstreamHangError extends ProviderError`（带"卡在哪一段、等了多久"的人话），并顺着 `ProviderError` 那条既有通路落到界面；② `webSearch` 接上本轮的 abort signal——用仓里手写的 `mergeAbortSignals`（不用 `AbortSignal.any`，理由在那段注释里）把用户打断与联网自带的 6s 超时并成一只；③ 工具循环每轮开头与每次调用前都查 `signal`，打断时给每条未执行的 tool_call 补上配对回执，界面不会留一条"永远在转"的调用 | `apps/desktop/src/main/provider-fetch.ts`（看门狗 + 合并 signal，`provider-fetch.test.ts` 本波新增 10 条）；`packages/agent-runtime/src/tool-loop.ts` 的 `INTERRUPTED_MESSAGE`/`SKIPPED_BY_INTERRUPT`/`finishInterrupted`（`tool-loop.test.ts` 新增 5 条）；`packages/agent-runtime/src/provider-client.ts` 的 `ProviderError` 直通（`provider-client.test.ts` 新增 2 条）；`apps/desktop/src/main/agent-service.ts` 的 `buildHost(..., signal)` + `abortableFetch`（新文件 `agent-service-web-search-signal.test.ts` 1 条） |
| P1-2 | **已修** | 出站清单与派发判据合并成一份：`toolsFor(host, webSearchEnabled)` 内部只调一次 `wireToolsFor`，`toolGateOf`/`dispatchToolCall` 用同一枚 `ToolGate` 判定；关掉联网后模型真调 `web_search` 会被派发层拒掉，并回一条 `ok:false` 的配对回执（不是静默丢弃）。`isCallableTool` 特意**不给**开关留默认值——漏传就编译不过，而不是默认放行 | `packages/agent-runtime/src/tools.ts` + `tools.test.ts`（新增 6 条，含"两枚判据必须同源"那条） |
| P1-9 | **已修** | 右栏「浏览」那条读盘通路补上三道闸：① 换书世代号 `bookEpoch`（与中栏的 `docLoadToken` 分开——一次开标签不该作废浏览的在途读），旧书那次慢回包在换书后一律丢弃；② 模块级在途集合，连点同一格只为同一篇发一次读盘，且**读到/读坏那一刻就摘**（留到 `.finally` 会晚一个微任务，用户看到失败后立刻再点会被自己上一次失败挡掉）；③ 失败理由上屏走 `failureReasonOf`，并新增每格自己的 `browseErrors`。界面侧原来只有一句 `browseContents[relPath] ?? "正在读取…"`，读失败后那一格**永远停在「正在读取…」**——比空白更糟，它在撒谎；现在三态判据抽成 `utils/browse-body`，面板只挂线，失败那一态另有告警色而不是占位话术那种灰 | `apps/desktop/src/renderer/src/stores/useBookStore.ts`（`bookEpoch`/`browseInFlight`/`browseErrors`）+ `useBookStore.browse.test.ts`（9 条）；`utils/browse-body.ts` + `browse-body.test.ts`（8 条）；`components/DocumentPane.vue` + `document-pane-browse-body.test.ts`（3 条）；样式侧 `styles/editor-pane.css` 的 `.document-preview-empty.is-browse-failed` |
| P1-10 | **已修** | 星期标签与标题号数都改由**那一格自己的日期**算：`utils/goal-heat-labels.ts` 里放一张穷举的 `Record<Weekday,string>` 表 + `parseDateKey`（正则卡 `YYYY-MM-DD`、范围校验、构造后回读验证），面板按 `day.date` 取值，不再按数组下标贴。面板里那张写死的 `weekdayLabels` 与自算的 `formatShortDate` 一并删净。另修一处不诚实的标题：那本是「最近 7 天滚动窗口」，原来写着「本周热力图」——周日一到整片清零的话术不许留着 | `utils/goal-heat-labels.test.ts`（5 条，其中一条**当场把 `process.env.TZ` 切成 `America/New_York`** 才拿到鉴别力：这台机是 UTC+8，不切时区时"UTC 漂移"那条断言根本红不了）+ `components/goal-heat-weekday-wiring.test.ts`（5 条）+ `WritingGoalPanel.vue` |
| P1-3 | **已修**（2026-10-10 收口，逐条读盘核对） | 历史滑动窗口落在**一份真身**上：`packages/agent-runtime/src/history-window.ts` 按 token 预算从最旧一轮起丢，**配对完整性优先**——丢一条 tool_call 必连带丢它的回执，绝不留下半条会让上游 400 的孤儿；被丢的条数与「为什么少了一段」由**主进程 `emitOnly` 落一条 `type:"error"` 事件**上屏（`agent-service.ts:638-646`），界面出显式截断提示而不是假装历史在用；**不是** `tool-loop.ts:164-174` 那枚 `history-truncated` 事件——桌面应用递进 `runTurn` 的已是切好的 `fitted.kept`，那半段在应用里恒不触发，契约枚举（`agent-event.ts:105`）在 `apps/desktop/src` 零消费方，**2026-10-12 第二十五节把那半段死通路与枚举一并收掉**：runtime 兜底改发既有的 `error` 事件，句子仍由 `historyNotice` 一处组；机制与真机双证据见本文第十九节，占用条**面板那一屏**（面板逐条 × store × 盘上模板三源交叉 + 无会话章反向对照）见第二十二节。占用条那一侧改判据：`ContextMeter` 的余量里从此**含历史**，不再是「显示还有余量」的假余量 | `packages/agent-runtime/test/history-window.test.ts`（23 条）+ `tool-loop-history-window.test.ts`（6 条，钉「全量 `...input.history` 那条路已经没了」）；`apps/desktop/src/renderer/src/utils/history-window.test.ts`（11 条）+ `components/history-window-wiring.test.ts`（7 条）+ `agent-service-history-window.test.ts`（3 条，真 service 端到端） |
| P1-5 | **已修**（2026-10-10 收口，实测数字） | 三个定位函数不再整篇读 JSONL：`readRawLines` 用 `open` + 16 KB chunk 流式解码（`TextDecoder(…,{stream:true})` 保证跨块的中文不被劈成乱码），拿到就要的那几行**当场 `break`**，生成器的 `finally` 关句柄，尾部一个字节都不读。判据只有一份——`titleOfLine` 同时服务旧的 `titleFromLines` 与新的 `readSessionHead`，改读头部之后与整篇读**逐字同口径**（含空行过滤、首行坏掉只跳过不整本抛）。夹具：同一本书两份会话，首两行完全一致，只差长度（150 条 / 1500 条事件） | 改前实测放大 **59×–681×**（只为取首行/标题）。改后的闸在 `packages/agent-runtime/test/rollout-head-read.test.ts`（12 条）：三条 IO 形状闸——`readFile` 调用数 = 0、每函数各 `open` 一次、**读过的字节跨度不随会话长度增长**（150 条与 1500 条量到同一个数，且 < 64 KB；反向鉴别：整篇读时长文件要读完 300 KB）；另有八条等价性闸（首条用户输入埋在 120 KB 之后仍取到、单行 48 KB 跨块不破词、首行 200 KB 巨型行、无尾换行、空文件、坏首行，以及**首行是空行、meta 落在第二行**这条——它把两处旧口径的分歧钉死：`findLatestSession` 走 `readFirstLine`，对应旧的 `split("\n")[0]`，**不滤空行**，所以那一格照样判坏、定位不到；`listSessions` 走 `readSessionHead`，对应旧的 `split("\n").filter(非空)`，**滤空行**，所以那条会话照常上面板、标题照拿。历史事实就是这样，两处不许被顺手统一）。变异四只全部死：恢复整篇读 → 字节跨度那条红；去掉 `{stream:true}` → 垫 ASCII 让块边界落进标题第一个字里，量到 `\ufffd\ufffd渊之下`；给 `readFirstLine` 加上空行过滤 → 那条红在 `expected '.mochen/sessions/…jsonl' to be null`；把 `readSessionHead` 的空行过滤去掉 → 同一条红在 `expected [] to deeply equal [ 's-blank' ]`。同一用例被两个相反方向的变异各打红一次，才证明它真的有双向鉴别力 |
| P1-4 | **半收口**（主进程与 fs-store 这半边已修，渲染层那一半没动，写清楚） | 已做的两件事：① `scanBook` 的 `await` 从 for 循环里搬出来——先 `collect` 清单，再一次性并发读正文（2026-10-10 用户裁定：并发度 = 文稿数，不设固定上限），顺序由 `Promise.all` 按输入序落位保证与旧写法逐字一致；② 新建 `docRefFor(root, relPath)`（与 `scanBook` 同一份判据），`createDoc` 建完一章只算新那一篇再拼进树，不再整本重扫。**实测**（夹具 1000 章 × 3000 字 = 盘上 8.66 MB，本机空负载连跑两遍各 3 次）：串行 133–157 ms，限并发 8 为 29–43 ms，并发度=文稿数 **21–31 ms**（比限 8 还快，先前那轮"限 8 更快"是 dev 实例抢 IO 时的读数，复跑不成立）；峰值堆三种读法都在 30–46 MB 一档，不设上限没把峰值抬高一个量级。`createDoc` 那一步：**整本重扫 99–136 ms ⇒ 单点重扫 1 ms**。<br>没做的另一半：渲染层 `useBookStore.refreshDocs()`（`stores/useBookStore.ts:209`）走的是 `window.mochen.openBook(rootPath)`，也就是**又一次整本重扫**——建章/改名/卷次重排四处都调它，所以界面上点「新建一章」仍会把全书读一遍。这一刀没顺手改它的原因是**判据只有一份可拼**：渲染层 `sortDocsByOrder`（`utils/doc-order.ts:30-39`）对「都不在 chapterOrder 里的两篇」返回 0（保持原相对序），而 fs-store `sortChapters`（`scan.ts:171-181`）按名字排它们——本地拼一根进去就和整本重扫不等价，正是用户点名要防的那种不等。下一刀应把两处排序判据合成一份（contracts 出一份 `sortDocs`），再让 `createDoc` 的 IPC 带回新那篇的 `DocRef` 供渲染层拼 | `packages/fs-store/src/scan.ts` + `packages/fs-store/test/scan-concurrency.test.ts`（7 条：在途读 > 1、readFile 次数 = 篇数且顺序逐字、`docRefFor` 与 `scanBook` 同一篇逐字相同、非文稿目录给 null、盘上没有给 null、**问「在不在」只发一次 stat 且 readdir = 0**、传目录进来也给 null）；`apps/desktop/src/main/book-service.ts` + `book-service-create-doc-io.test.ts`（8 条，含三条变异已死：去掉 `sortChapters` → 两篇新章落位那条红；去掉同 relPath 去重 → 外力删后建回那条量到 2 条；把兜底换成文件名倒推的假 DocRef → `stat` 那条红 `expected +0 to be 7`）。测量夹具是一份 `tmp-scale-probe.test.ts`（1000 章生成 + 三种读法 + 两条建章通路），跑完**移出仓库放在本机 scratch 目录**（`~/dw-scratch/2026-10-10/`），没入库也没删除（删除要用户点名）——它是量具不是闸，每次跑都往临时盘写 8.66 MB 的夹具，把一次性物理事实变成每条提交都跑的断言不划算。 |
| P1-6 | **已修** | 同一目标路径的写进互斥队列，不同路径照旧并发（全局串行会把 1000 章批量写拖死）；`release()` 放在 **finally**，前一个任务抛错不许把队列锁死。`writeDocFile` 的读-校验-备份-写整段落在锁里，连点两次 Ctrl+S 不再自撞出一次假冲突 | `packages/fs-store/src/write-queue.ts`（新）+ `packages/fs-store/test/write-queue.test.ts`（10 条）；`read-write.ts:134` 的 `runWriteExclusive` 临界区 |
| P1-7 / P1-8 | **已修** | 一条链两环一起收：① `ipc-guard.ts` 建了全仓唯一的来源判定，每条 IPC 通道都过它——`senderFrame` 为 null（帧已导航走/被销毁）与「形状不认识」两类都按**不可信**处理并给出人话理由，不是静默丢；② 窗口侧 `will-navigate` 只许停在本仓那一份页面（重载/HMR/带 query-hash 都放行），`setWindowOpenHandler` 一律 `deny`；③ CSP 落进产物；④ 打包版**忽略** `ELECTRON_RENDERER_URL`（env 对同用户任何本机进程可读可写），由 `app.isPackaged` 门住 | `apps/desktop/src/main/ipc-guard.ts` + `ipc-guard.test.ts`（44 条）+ `ipc-trust-fixture`；`main/index.ts` 的导航闸与 packaged 门；`renderer-csp.ts` + `renderer-csp.test.ts` |
| P1-11 | **半修**（边界写清楚，不许说成全修） | `.vue` 的**语法与绑定**这一层进了静态关卡：`utils/sfc-compile.ts` 用 Vue 自己的 `vue/compiler-sfc` 真编译每个单文件组件（零新依赖），`sfc-compile-all.test.ts` 全仓扫 165 个文件——判的是「这段模板成不成立」，不是「源码里有没有这串字」，所以重构换写法不会再让守卫静默失效。**仍然没做的是类型检查**：那要 `vue-tsc`，本仓没装、这台离线机装不上，所以 `vue-shim.d.ts` 把 props 全当 any 的那一半问题原样留着 | `apps/desktop/src/renderer/src/utils/sfc-compile.ts` + `sfc-compile.test.ts`（6 条）+ `sfc-compile-all.test.ts`（2 条，含「整仓每个 .vue 都必须编译得过」） |

**这一波到目前为止没做的仍是真机复验**：P1-9 与 P1-10 都改在渲染层，"换书后旧回包不落新书缓存""失败那一格出告警色"这两条要重新构建并起实例才看得见，而机上那只实例属并行会话现场，我没动它。所以上表证明到的是用例与门禁，不是屏幕上量到的行为。P1-3 的截断提示与 P1-6 的互斥同样如此——用例与门禁绿，真机目检未做。

> 【2026-10-13 逐条对回盘面，全文见第三十四节】这四格里 **P1-3 已经量到并上屏**（第十九节，`finish_reason:"length"` 那句逐字读回）；
> **P1-9 / P1-10 这两格不再是「没人验过」**——它们各有三层运行时钉子（util / store / 组件），本轮当场用两次变异证明这些钉子**今天仍然会红**
> （摘掉世代令牌 → 2 条红；把本地解析换成 UTC → 1 条红，正是那条专门防 UTC 的用例）。屏幕上的一次目检仍欠着，如实记着，
> 但这一族的判据形状已经从「只能起实例看」变成「运行时用例钉住 + 接线钉子不许改回下标」。
> **P1-6 并发写互斥照旧只到用例与门禁**，本轮没有为它新增任何证据。

## 四之二、假控件与死路清单（逐条答「真 / 半真 / 不存在」，全部 grep 复验）

这是你最在意的那一类（「只改配色不算干活」「功能要逐条答真/半真/不存在」），所以我单独列一节：

| 界面上的东西 | 判定 | 证据与缺的那一环 |
| --- | --- | --- |
| 「平均速度 __ 字/分钟」「今日 __:__:__」两枚统计 | **不存在（恒 0）** | `WritingGoalPanel.vue:225/229` 读 `averageSpeed`/`todayDurationSeconds`；两者都来自 `durationSeconds`，而唯一写它的 `startSession`/`endSession`（`useWritingGoalStore.ts:239/245`）**全仓零调用**（我 grep 确认）。`recordWriting:229` 建新记录时把 `durationSeconds` 写死 0；`averageSpeed:194` 见 0 分钟就 return 0 ⇒ 永远是「0 字/分钟 / 今日 0 秒」。要么接上计时会话，要么把这两格摘掉 |
| 「每日时长目标（分钟）」输入框 | **半真** | 能存能回显（`WritingGoalPanel.vue:53`、`WritingGoalSettingsPanel.vue:18`），但 `dailyTimeTarget` 在进度计算里**一个字都没用**（`useWritingGoalStore.ts:144-167` 全部只用 `dailyWordTarget`）——设了等于没设 |
| 大纲「按类型」排序钮 | **不存在（假档）** | `OutlinePanel.vue:75-80` 的 `sortDocs` 只处理 `chars` 一种；钮（`:69-73`、`:216-225`）点下去只切高亮，分组本来就已按类型排 |
| 大纲底部「↑↓ 浏览」键提示 | **不存在** | 面板内无任何 keydown 实现；对照真写法见 `SearchPanel.vue:123` |
| 笔记「批注」页签 + 空态文案「或在文档上添加批注」 | **不存在** | `createAnnotation`（`useNotesStore.ts:106`）零调用；`NotesPanel.vue:11` 声明的 `create-annotation` 事件既没 emit，`App.vue` 也没监听——**编辑器里没有产生批注的入口**。这条是「文案指向一个不存在的功能」 |
| 笔记/圣经的「标签」体系 | **半真** | 数据结构与展示都在，但没有录入入口（新建时 `tags: []`，见 `StoryBiblePanel.vue:154`）——只能显示一个永远为空的字段 |
| 圣经「新建条目」表单 | **半真** | 人物别名 / 地点父级 / 时间线日期只在**编辑态**存在（`StoryBiblePanel.vue:122-133`），新建时不采；另外 `:39` 往用户数据里种 3 条「示例人物·林夜」——真书里那是脏数据，该挪进空态提示 |
| 归档（笔记 / 圣经） | **半真 → 已列 P0-8** | 归档动作真的存进 localStorage 了，但没有任何取回入口 |
| 导出对话框 | **半真** | 未勾选章节时按钮 `disabled`（`ExportDialog.vue:380`），而服务层把空选当「全部」（`export-service.ts:80`）——两处口径相反；`assembleError` 之后复制空串仍显示「已复制」（`:261`） |
| 字号设置对三个面板 | **半真（设置不生效）** | root 走 `--ui-font-size`（`styles.css:33`、`appearanceThemeRuntime.ts:460`），px 不随 root 缩放；实测硬编码 `font-size: Npx`：`outline.css` 14 处、`WritingGoalPanel.vue` 15 处、`NotesPanel.vue` 12 处（另有 `story-bible-panel.css` 27 处、`agent-pane.css` 26 处）。用户调字号界面不动，会判定「设置坏了」 |
| 查找/替换的批量替换后 Ctrl+Z | **不存在** | `applyReplace` 整体赋值（`DocumentPane.vue:354-369` → `useBookStore.ts:514`）会清空 textarea 原生撤销栈，且没有自制 undo 快照 ⇒ 一次批量替换救不回来 |
| 字数格式化 | **重复实现且口径不一** | 手抄 5 份：`OutlinePanel.vue:140`（无千分位）、`WordCountPanel.vue:89`（`toFixed(2)`）、`ProjectSwitcher:26`、`ProjectSettingsPanel:18`、`VersionHistoryPanel:65` ⇒ 同一个指标在两处显示成不同数字 |
| `escapeHtml` | **重复实现** | `DocumentPane.vue:247` 与 `export-shared.ts:50` 各一份，而后者注释里明写「铁律 6：不许两份」 |
| 面板内硬编码色 | **绕过 token** | `WritingGoalPanel.vue:71-83` 的 `#40845a/#3a7a50/rgba(108,158,255,…)` 与 `:132` 的 stroke 常量；浅色主题下热力格对比度不由 token 保证——这与 `README.md:6244` 那条「次要文字对比还差 0.1–0.4」是同一个病灶的另一处 |

**已核为真、不必再查的**：XSS 两处 v-html 均先整体转义且有回归线；`useModalFocus` 统一管 Esc/Tab 陷阱/焦点归还（六个面板都接了）；IME 判据单真身（`slash-commands.ts:72`）且编辑器已挡；响应式按实测布局宽度而非 `innerWidth`（`layoutStore.ts:382`，1220 分档 + <1100 自动折叠右栏）；读盘骨架、无书/无 key 出路都有；范围内组件零 TODO、零 console.log、零声明未引用函数。

### 四之二·现状总表 —— 上面那 14 行逐条对盘回读（2026-10-09 第 3、4 波之后）

写这张表时每一条都重新 grep 过现盘代码，落点行号是回读得到的，不是抄上表。

| 行 | 波前判定 | 现状 | 盘上证据（本次回读） |
| --- | --- | --- | --- |
| 1 平均速度 / 今日时长恒 0 | 不存在 | **已接真** | 时长不再由界面上已不存在的按钮推出：`App.vue:304` 由 `book.draft` 变化喂 `goalStore.activity()`，取舍（离席阈值、换稿那一跨不计、亚秒零头攒着）全在 `useWritingGoalStore.ts:292` 那一处 `activity()` 里 |
| 2 每日时长目标设了等于没设 | 半真 | **已接真** | `useWritingGoalStore.ts:188-200`：`targetSeconds` 由 `dailyTimeTarget * 60` 算出，`timePercentage` / `timeReached` 都读它；面板 `WritingGoalPanel.vue:145` 显示 `/ N 分钟` |
| 3 大纲「按类型」排序钮 | 假档 | **已摘掉** | `OutlinePanel.vue:74-79` 的 `SortMode` 只剩 `order \| chars`；`:83` 留下「为什么这一档不该存在」的说明（章节顺序本就按 `chapterOrder` 排过） |
| 4 大纲底部「↑↓ 浏览」 | 不存在 | **已接真** | `OutlinePanel.vue:173-176` `onPanelKeydown` + `:223` 挂到面板根；游标 `cursorPath` 在面板重开时归零 |
| 5 笔记「批注」页签与文案 | 不存在 | **已接真** | `NotesPanel.vue:131` 调 `notes.createAnnotation(...)`；判定口径收在 `utils/note-scope.ts` |
| 6 标签只有展示没有录入 | 半真 | **已接真** | 单真身 `utils/tag-input.ts:12 parseTags()`，笔记新建 `NotesPanel.vue:119`、圣经新建 `StoryBiblePanel.vue:165`、编辑态 `:130/:135` 都读它 |
| 7 圣经新建表单不采类型专属字段 | 半真 | **已处置（非补全表单）** | `StoryBiblePanel.vue:163-175`：新建只收类型/名称/描述/标签，建完**自动进编辑态**，类型专属字段有明确入口；示例条目「林夜」已不再往用户库里种（`useStoryBibleStore.ts:10/:47`） |
| 8 归档是单向门 | 半真 | **已接真** | `NotesPanel.vue:291` `unarchiveNote`，第四档「已归档」把取回摆在明面上（`:187`）；圣经侧档位含第五档「已归档」（`StoryBiblePanel.vue:39/:246`） |
| 9 导出对话框两处口径相反 | 半真 | **已接真** | 打开即默认全选（`ExportDialog.vue:159-164`），复制按钮 `:401` 把 `assembleError` 也并进 `disabled`，导出按钮 `:409` 按选中数判定 |
| 10 字号设置对面板不生效 | 半真 | **已收口** | 硬编码 `font-size: Npx` 计数回读：`styles/outline.css` 0、`WritingGoalPanel.vue` 0、`NotesPanel.vue` 0、`styles/agent-pane.css` 0、`components/story-bible-panel.css` 0（波前 14/15/12/26/27） |
| 11 批量替换后 Ctrl+Z | 不存在 | **已接真** | 见「四之二·补」 |
| 12 片段插入后 Ctrl+Z | 本波新发现 | **已接真** | 见「四之二·补二」 |
| 13 `escapeHtml` 两份 | 重复实现 | **已合一** | 见「四之二·补」 |
| 14 面板内硬编码色 | 绕过 token | **已收口** | 见「四之二·补二」 |

### 四之二·补 —— 本波处置（2026-10-09 第 4 波，逐条写明改了什么、什么没改）

| 条目 | 波前判定 | 本波处置 | 落点 |
| --- | --- | --- | --- |
| 查找/替换批量替换后 Ctrl+Z | 不存在 | **已接真**：三层——判定 `utils/edit-undo.ts`（栈/跨章/键闸门/文案，19 条）、行为 `composables/useEditUndo.ts`（真 store + 替身 textarea，17 条）、接线 `edit-undo-wiring.test.ts`（16 条）。三条红线：跨章不还原、用户一打字整栈作废、组合态与重做不接手。可见通路＝面板「已替换 N 处 + 撤销（Ctrl+Z）」，键盘通路＝栈非空才吞键、栈空交回原生 | 上述四文件 + `DocumentPane.vue` / `FindReplacePanel.vue` |
| `escapeHtml` 重复实现 | 重复实现 | **已合一**：真身只在 `packages/fs-store/src/export-shared.ts`，渲染层改 import；普查守卫防止再长第二份 | `utils/html-escape-single.test.ts`（4 条）+ `packages/fs-store/test/escape-html.test.ts`（5 条） |
| 片段插入同样清空原生撤销栈 | 本波新发现（同类缺口） | **已接真**（见「四之二·补二」） | `composables/useSnippetToolbar.ts:61-64` |
| 面板内硬编码色绕过 token | 绕过 token | **已收口**（见「四之二·补二」） | `utils/writing-goal-heat.ts` + `WritingGoalPanel.vue:6` |

**撤销这一条的变异取证**（每条都先看红、再回滚复跑绿；证据在 `/tmp/dw-gate/mw*.log`）：
MW3 删 `invalidateUndo()` → 恰 1 红（②「先 invalidate 再写草稿」）；
MW4 摘掉正文 `@keydown="onEditorKeydown"` → 恰 1 红（①接线）；
MW5 notice 改硬编码字符串 → 恰 1 红（①接线）；
MW6 面板里把 `{{ undoNotice }}` 写成死文案 → 恰 1 红（④「不自拼第二份文案」）；
MW7 `preventDefault()` 提到栈检查之前 → 2 红跨两层（行为层「栈空一个字都不吞」+ 接线层顺序钉）。

### 四之二·补二 —— 第 4 波收尾两项（2026-10-09，同日续）

**一、片段插入接进同一份撤销栈（同类缺口，之前只修了批量替换那一半）**

病根是同一条 Chromium 事实：对 `<textarea>` 的 `value` 程序赋值会清空原生撤销栈，所以「点一下加粗」和「全部替换」一样，Ctrl+Z 救不回来。处置分三层，复用替换那一条通路而不是另开一份：

- 判定 `utils/edit-undo.ts`：`EditUndoKind` 加 `"snippet"`，`undoNotice()` 对它报「已插入片段」而不是「已替换 1 处」——界面不许把另一件事报成替换（19 条）。
- 行为 `composables/useEditUndo.ts`：`commitWithUndo(nextText, kind, count, caret?)` 收调用方给的光标，`replaceWithUndo` 退化成它的薄壳（17 条）。
- 工具栏 `composables/useSnippetToolbar.ts:61-64`：拿到第二枚实参就把「写草稿 + 回设光标」整个交出去，自己只算新文本与新光标；没接通路时旧行为不断（6 条）。
- 接线 `DocumentPane.vue`：`useEditUndo` 必须先于 `useSnippetToolbar`（反序就是把还没解构出来的成员递进去），由 `edit-undo-wiring.test.ts`（16 条）与 `document-pane-wiring.test.ts` 钉住。

**二、面板抄色收口（WritingGoalPanel 整支绕 token）**

判定搬到新文件 `utils/writing-goal-heat.ts`：`heatFill(pct, reached)` 五档、`heatBorder(pct)`、`ringStroke(reached)`，成品全部是 `var(--success)` / `var(--accent)` / `var(--border)` 或它们的 `color-mix`，**没有一支裸 hex**。面板 `WritingGoalPanel.vue:6` 改成 import 这三个，色值真身只有一处；达成提示、时间条、火焰图标、进度圈描边、主按钮字色（`var(--accent-contrast)`，运行时 `appearanceThemeRuntime.ts:323` 算）一并跟主题。守卫 `components/writing-goal-color-token.test.ts`（12 条）的口径是「剥掉 `var()` 兜底之后整份面板裸 hex 归零」——兜底值仍允许存在，因为它是 JS 起来前那一帧的默认，不是第二真身。

`--accent-contrast` 这一条要如实记一笔：我一度判定「本仓没有这支 token」并为此准备开一张允许抄色的例外表，实测 `appearanceThemeRuntime.ts:323` 里它真身存在，于是改用 token 并**把例外表删了**——不留「允许抄色」的口子。

**变异取证（每条先看红、再回滚复跑绿；`×` 行与 `Test Files` 行从 `/tmp/dw-gate/*.log` 逐条回读，不是记忆）**

| 编号 | 改坏的地方 | 红几条 | 日志 |
| --- | --- | --- | --- |
| MS3 | snippet 的提示改口报成「已替换 1 处」 | 2（判定层 + 行为层各 1） | `ms3.log` |
| MS4 | `commitWithUndo` 忽略调用方给的 caret，仍放回改前那一段 | 1 | `ms4.log` |
| MS5 | 工具栏交出之后仍自己 `onEdit`（同一笔写两次） | 1 | `ms5.log` |
| MS6 | `DocumentPane.vue` 摘掉第二实参并把两个 hook 反序 | 3（接线 needle + 顺序 + `document-pane-wiring`） | `ms6.log` |
| MS8 | 交给撤销栈的 caret 写成 `{start, start}`（本轮为验证断言改成 `.map` 形态后仍有牙） | 1 | `ms8.log` |
| MC1 | `heatFill` / `ringStroke` 的达成档抄回裸 `#40845a` | 3 | `mc1.log` |
| MC2 | 面板里把某支 token 抄回橙色裸值 | 3（六支语义色 + 裸 hex 归零 + 达成提示字色） | `mc2.log` |
| MC3 | 面板自己再定义一份 `heatFill`（长出第二真身） | 3 | `mc3.log` |

**一处如实标注**：撤销这一族（含片段）的**接线层用例是先实现后补的**，不符合「每笔生产代码先有一段红测试」的口径；补偿就是上表 + MW3–MW7 那五条实测变异，每条都证明对应断言能失败。



## 五、P2 —— 加固与债（挑有代表性的，不铺开）

| # | 问题 | 证据 | 验证 |
| --- | --- | --- | --- |
| P2-1 | 备份自身非原子且回滚不校验备份完整性：ENOSPC 留下截断 .bak 仍进历史，点回滚 = 用半截备份覆盖完好正文；另外 `pruneChanges` 的注释写「失败不外抛：正文已经落盘了」，**代码顺序其实是备份→淘汰→才写正文**（`:93-94`），注释与事实相反 | `read-write.ts:81-94`、`changes.ts:342-363` | 实读 |
| P2-2 | 路径边界两份口径：`changes.ts:37-41`、`skills.ts:128-133` 有 realpath 闸，`writeDocFile:53`/`doc:read` 没有 ⇒ 书目录里一个软链就能读写到书外；未挡 Windows 保留名（CON/NUL/COM1） | `contracts/book.ts:113` | 实读（顺序）/子报（保留名） |
| P2-3 | CRLF 静默改写正文：编辑器是 `<textarea :value>`（`DocumentPane.vue:734`），浏览器赋值即把 \r\n 归一成 \n，首次保存整篇行尾变了并让在途提案全部 stale | — | 子报 |
| P2-4 | 拖拽重排章节走 `void window.mochen.saveMeta(next)`，绕过 `persistMeta`（唯一带失败提示的实现，`:670`）⇒ 屏上已重排、盘上未改，并抛未处理拒绝 | `useBookStore.ts:796` | 实读 |
| P2-5 | `finish_reason:"length"` / 断流 `"incomplete"` 与正常 stop 同路，半截 tool_call 参数静默丢 ⇒ 用户以为模型答完了 | `provider-client.ts:235,271`、`tool-loop.ts:182` | 子报 |
| P2-6 | 失败轮留孤儿 user 消息（user-message 在发流之前落盘），重试同句在历史里出现两遍，重复计费 | `tool-loop.ts:134` | 子报 |
| P2-7 | 主进程无同线程并发闸（只靠渲染层 `running` 挡），两轮可交错 append 同一 JSONL；打断不中断本轮工具派发 | `agent-service.ts:131`、`useAgentStore.ts:241,439` | 子报 |
| P2-8 | `proposals` 全局表只增不删（切会话/重置线程才清），长会话内存涨；主进程掉流无看门狗（`turn-end` 永不到则 `running` 卡真） | `useAgentStore.ts:221,267` | 子报 |
| P2-9 | 无 `minWidth`/`minHeight`：窗口可拖到布局地板（1000）以下，地板以下是裁掉而非可滚。台账自己也记着（`README.md:6247`） | `main/index.ts:121-122` | 实读 |
| P2-10 | 门禁盲区三条：边界检查只管 renderer→fs-store/agent-runtime（`check-package-boundary.mjs:106-110`），行预算不覆盖 `tools/` 与 `apps/desktop/scripts/`；`.prettierignore` 整目录排除 `docs/superpowers`（448 KB 台账 + 全部 spec 不参与 format 检查）；`apps/desktop/package.json` 的 `test` 只跑 `src/main` | 各文件 | 子报（目录排除我实读 `.gitignore`/`.prettierignore` 确认） |
| P2-11 | 死依赖与死条目：`pnpm-workspace.yaml` catalog 里的 `naive-ui` 全仓零引用（我 grep 确认），即**整个 UI 是手搓 CSS，没有组件库**——一致性全靠人盯，`grep eslint-disable` 只有 2 处说明盯得还算住 | 根 `pnpm-workspace.yaml` | 实读 |
| P2-12 | 可移植性：跟踪文档里硬编码 `C:\Users\17863\`；`tools/build-brand-icons.ps1` 只在 Windows PowerShell 可用；插件挂载每次 `plugins:list` 都 `mountAll()` + `?v=Date.now()` cache-buster，模块注册表无界增长、插件顶层副作用每次重跑 | `plans/2026-10-01-*.md:42`、`plugin-loader.ts:68-79` | 子报 |
| P2-13 | 每键全篇重渲：查找高亮的 mirror div 常驻挂载（`DocumentPane.vue:724-728`，无 `v-if` 找面板开着才挂），`highlightMirrorHtml` 每次 `draft` 变动都把**整篇**过一遍 `escapeHtml`；分栏预览的 `previewHtml` computed 也是每键跑完整 markdown 管线（`:238`，注释里是刻意选「零延迟」）。单章 3–4k 字无感，但 README 同样承诺「长文写作」——长文档（卷纲/整篇合集 2 万字以上）与低配机器上就是打字延迟 | 实读 | 实读 |
| P2-14 | 切标签的那一瞬有一个「按新路径写旧内容」的窗口：`openDocTab` 先置 `activeDocTab`（`useBookStore.ts:296`）再 `await readDoc`（`:309`），而挂起的自动保存定时器**不在这次切换里取消**（`cancelAutoSave` 全仓只在测试与重载场景用，见 `:540-545` 的注释） | 我实读后**降为 P2**：真发出去的那次 `writeDoc` 带的仍是旧稿的 `savedFingerprint`，会被 `read-write.ts:72` 的期望指纹闸拦下（拦下时界面出冲突提示，不是静默）；只有在「两篇内容恰好相同」时才通得过——而新建章节的默认模板恰恰容易相同。修法仍然简单：切标签先 `cancelAutoSave`，或 `saveActive` 取 path/draft/指纹的世代快照 | 实读 |

## 五之二、P2 现状总表（2026-10-10 逐条读盘回读，不信任何一段记忆）

判据与 P1 表同一套：只有**盘上现在真有的代码 + 真跑得绿的用例**才算「已修」；带不动、没授权、只做了一半的，一律写在名字里而不是抹平。

| # | 现状 | 落点与盘上证据 |
| --- | --- | --- |
| P2-1 | **已修** | 备份与正文**两次写都走原子写**（`read-write.ts:185`/`:200`、`changes.ts` 回滚那两处，注释里点名 P2-1）；回滚前 `readableBackupAbs`（`changes.ts:77-89`）把备份路径过 realpath 闸、并把「文件不在」与「越界」分成两句不同的话（顺序错了就会把「这一篇被删了」误报成越界）；`pruneChanges` 那句与事实相反的注释已改成实话（清理排在正文落盘**之后**，且清理失败不外抛）。`restoreChange` 里 `:418` 的指纹按**备份内容**算 |
| P2-2 | **已修**（且纠了本总单的一处过期判断） | realpath 级边界判定**前几波已落地**（`paths.ts:56` `isPathUnderRoot`），本波实测 `readDocFile`(`read-write.ts:65`) 与 `writeDocFile`(`:134`，锁内) 都已过闸，故**未重复改**；补的是缺的后半——Windows 保留名。实测推翻了「平台自己会报错所以错误自然可见」：本机 win32 + Node 24 写 `CON.txt` **不抛错、静默落盘**，所以只能命名层当场拒、跨平台一律拒。名单与那句唯一文案住 `contracts/src/book.ts`（`WINDOWS_RESERVED_NAMES`/`isWindowsReservedNameSegment`/`windowsReservedNameProblem`），fs 层与主进程 `createDoc` 各引**这一条**再兜一遍；口径照 Win32 名解析——先去结尾空格与圆点、再看首个圆点前那一截，所以 `CON.txt`、`CON.`、`NUL␣␣` 全拒，`CON1`/`COM0`/`LPT10`/`CONFIG.md` 全放行。**选「拒绝」不选「悄悄改名」**（改成 `CON-1` 会让用户找不到自己起的名）。证据：`contracts/test/windows-reserved-name.test.ts`（34 条，名单在测试里硬编码而非从实现导出）、`fs-store/test/path-boundary.test.ts`（21 条，含「fs-store 里不许有第二份保留名函数」的普查） |
| P2-3 | **已修** | 判据选①「行尾跟盘上那一篇走」：`detectLineEnding`（首个结束符定调，混合有确定答案、空/新建→LF、单 `\r` 保住）+ `applyLineEnding`（先归一再换，避免叠成 `\r\r\n`），`read-write.ts:165` 得到 `body` 后**幂等短路、落盘、回报指纹三处一律用 `body`**——指纹若拿调用方的 `content` 算，回报的串与盘上字节不是同一份，下一笔保存立刻自撞成假 stale（变异 M4 实测杀掉）。备份仍存**改前原文逐字**。附带收益：「只打开没编辑就自动保存」那一档现在盘上一字不动、也不留假备份（M6 钉住）。JSON 通路不受影响，各有用例钉住 |
| P2-4 | **已修** | 拖拽重排不再 `void window.mochen.saveMeta(next)`，改走渲染层唯一带失败提示的 `persistMeta` 通路（`useBookStore.ts:786` 的注释把旧写法与为什么不许再用它写在那儿）。**全仓生产代码里 `mochen.saveMeta(` 现在只剩 `:710` 一处**（在 `persistMeta` 内部；其余命中都在测试与注释里，本行写完后当场 `grep` 回读）。证据：`stores/useBookStore.chapter-order.test.ts` 钉住重排走 `persistMeta` 且失败时盘上顺序不改 |
| P2-5 | **已修** | `finish_reason:"length"` / 断流 `"incomplete"` 不再与正常 stop 同路：`provider-client.ts:49`/`:51` 各有一句人话，`:306` 端点没给 finish_reason 就断流时，收全的调用照常交出、没收全的那条**标成截断**而不是静默丢 |
| P2-6 | **已修** | 失败轮留下的孤儿 user（开流前就落盘）在下一轮开头折掉，判据**只住 `history-window.ts:279` `foldOrphanUserMessages` 一处**，`agent-service.ts:602` 只调用（铁律 6：一句话不说两遍） |
| P2-7 | **已修** | 主进程侧建了**按线程键**的轮次闸门，不再只靠渲染层那个 `running`：同一线程第一轮未结束时第二轮当场被拒、一条 `turn-start` 都不发，拒绝那句带出路（等它答完或先打断）；另一条线程不受影响；**打断、失败、空输入、没配模型服务这四条早退路都必须释放槽位**（漏一次这条线程就永久锁死）。`agent-service-turn-gate.test.ts`（9 条）逐条钉住 |
| P2-8 | **已修（两半不同来源，如实分开写）** | ① `proposals` 表只增不删：现在按线程键回收（`useAgentStore.ts:621-622` 那一圈 `delete this.proposals[id]`，只删属于被切走那条线程的卡片；行号按 2026-10-12 的 HEAD 回读，原来这行写的 `:600` 已经漂到别处）。② 「主进程掉流无看门狗」这一半**不是新写一只渲染层定时器**，而是由 P1-1 那两只上游看门狗（首字节 30s / 流中空闲 60s）覆盖——超时抛 `UpstreamHangError`，而渲染层已把所有异常统一转成 `turn-end{failed}`（`useAgentStore.ts:87`/`:227` 的注释就是这条），所以 `turn-end` 永不到、`running` 卡真的那个形状没有了通路。**未量的是长会话真机内存曲线** ⇒ **已量（2026-10-12，见第二十一节）**：26 轮曲线是**线性**的（每轮约 +90KB 堆、+5.4KB 常驻正文），回收那一刀在真机上确实在跑（点两次「新建对话」把 23 枚卡清成 0，DOM 1906→477），并且用摘掉那一圈 `delete` 的变异包做过 A/B（同样两次点击卡数 23→23、清后三轮 26 vs 3）。**但现场数同时把这条的严重度改了口径**：一枚卡连 diff 只 1,165 B，23 枚 26.8KB，而每轮总成本约 90KB —— 长会话那笔钱的大头是**每轮 items 的常驻与它带来的响应式/DOM 开销**，不是这张表；而且回收**只发生在「新建对话 / 覆盖式切换」那一刀**，单纯切标签永远不回收（切回 A 时卡仍 23、堆反而到峰值 10.31MB）。 |
| P2-9 | **已修** | `minWidth: 1000` / `minHeight: 700`（`main/index.ts:177-178`），两个数**不是抄来的**，是现读样式与布局 store 的真身算出来的地板（三栏窄档 262+395+320=977；纵向 `min(360px, …)` 那格要 680），并由 `window-min-size.test.ts`（5 条）钉住：令牌一旦从 CSS 里消失，用例当场抛「判据失效」而不是悄悄放行 |
| P2-10 | **已修**（四条盲区逐条处理） | ① 行预算闸扩到 `.mjs/.cjs` + `tools/` + `apps/desktop/scripts/`（`ROOTS`），扩完当场真爆出一份 851 行的 `gen-scene-svgs.mjs`——**没有为了过闸改窄脚本**，而是把调色板那段（199 行）搬成 `scene-palettes.mjs`，验收口径是**六张 SVG 逐字节复现**（`sha256sum -c` 搬前搬后、prettier 后各核一次）；② 边界闸补上三条此前看不见的路（渲染层→主进程、渲染层→包源码、Node 侧伸进渲染层），默认根改成仓库根、两个根都不在时报「空扫不叫通过」并退 1；③ `.prettierignore` 整目录排除 `docs/superpowers` 这条**没有偷偷留着**，也没有为了好看去重排台账（实测要改 20 个文件、−34575/+38530 行）——改成**挂着牌子的声明式豁免**，由 `tools/prettier-scope.test.mjs`（5 条）钉「只许有这一条豁免、且旁边必须有中文理由注释、且 README 与真源码不许被排除」；④ `apps/desktop` 的 `test` 脚本实测比总单说的更糟：从该目录跑**一条用例都不收集**（"No test files found"，exit 1），修成 `vitest run --root ../.. …src/main …src/renderer`，`tools/ci-gate.test.mjs` 新增一条钉住「跑的是整包不是半套」 |
| P2-11 | **已修**（2026-10-12 用户点头删除，并把这句话立成闸；详见第二十四节） | `pnpm-workspace.yaml` 的 `naive-ui: "2.44.1"` 已删。删除前的复核仍是三条：`pnpm-lock.yaml` 里 `naive` 出现 **0** 次（⇒ 从没人依赖过它，删它不动锁文件，CI 的 `--frozen-lockfile` 不受影响）、各 `package.json` 零命中、`apps/desktop` + `packages` 全部 `.ts/.vue` 零 import。**但只删一行不构成修复**：那一行真正的危险是 catalog 的语义——它是「谁写 `catalog:` 就能拿到这个版本」的一张随时能兑现的入场券，下一个人顺手 `import { NButton } from "naive-ui"` 时门禁全绿，等于在一次普通改动里替用户决定了「引入组件库」。所以补 `tools/no-component-library.test.mjs`（**5 条**）把「UI 没有组件库」钉成三处扫描（catalog 键 / 各 package.json 三种依赖字段 / 源码 import）+ 一条解析口径守卫（catalog 解析不出 `vue/pinia/vitest/typescript/zod` 就**抛错**而不是放行）+ 一条自证（喂一份明知带 `naive-ui` 的假 catalog 必须逮住，同时干净名单不误报）。规格书 `specs/2026-10-01-…design.md:56` 那句「Vue 3.5 + TypeScript + Pinia + naive-ui 2.44」是**从头到尾没成立过的技术栈假话**，已就地加更正段（原文一字未删）：界面是手搓 CSS，`renderer/src/styles/` 现有 **22 份** CSS、其中 7 份用 `backdrop-filter` 做毛玻璃，全仓 `NConfigProvider`/`n-config-provider` 命中 **0** |
| P2-12 | **三子项里两子项已动**（① 与 ② 都动了，③ 仍未做真机重装插件目检） | ① 插件挂载的 cache-buster 从 `?v=${Date.now()}` 改成**改写后内容的 sha256 前缀**，并且只在「本进程还没为同一份内容写过」或盘上文件被删时才重写产物。症状两半都消：内容没变时 URL 一字不变 ⇒ 命中 ESM 注册表同一份模块 ⇒ 插件顶层副作用不再每次 `plugins:list` 重跑、注册表不再每轮多一份永不回收的实例；内容真变了哈希变 ⇒ 改动照样当场看得见。用例按**行为**判（副作用计数器住在夹具插件源码里），三次变异各自杀掉并回读生产形态：cache-buster 换常量 ⇒ `改了插件却拿回旧的那份…: expected 1 to be 2`；重写闸只判存在性不判哈希 ⇒ `expected '甲' to be '乙'`；恢复无条件重写 ⇒ `内容未变仍重写了产物文件…to contain '记号'`。② **已修**（2026-10-12，见第二十六节）：`tools/build-brand-icons.ps1` 已删，出图这台机器拆成两半——容器 `tools/ico-container.mjs`（纯 Node、可单测、任何平台一样跑）+ 驱动 `tools/build-brand-icons.mjs`（重采样交给本仓已经装着的 Electron `nativeImage`，零新依赖）；跟踪文档里那两处 `C:\Users\17863\` 仍是「绝不拿这个目录之外的真人书稿做测试」的**约束原文**而不是配置项，改它属于换皮，留着。③ 未做真机重装插件目检 |
| P2-13 | **已修** | mirror 高亮层加 `v-if="findVisible"`（`DocumentPane.vue:713`），面板关着时那层连 DOM 都不在 ⇒ `highlightMirrorHtml` computed 无人读、彻底不重算；另一半是 `watch(findVisible, …)`（`:284`）在打开那一瞬 `nextTick()` 后补一次 `syncMirrorScroll()`（新挂载的层 scrollTop=0 而 textarea 可能已滚到半篇）。`editor-pane.css` **未改**并说明理由（脱流层不参与 wrap 布局）；分栏 `previewHtml` 刻意不动（注释里写明那是「草稿到预览零延迟」的既有取舍）。证据：`find-mirror-mount-wiring.test.ts`（7 条，含「全模板只此一枚 v-if」「与让位类同判据」「组件里零 `<mark` 拼接」） |
| P2-14 | **已修** | `openDocTab` 开头 `this.cancelAutoSave();`（`useBookStore.ts:319`）——`activateTab`/`cycleTab`/`closeTab`/`createDoc` 全走这一个入口，一处收口。字不丢：A 篇未保存的字由 `onEdit` 既有的 `stashActive()` 留在 `draftsByPath`。两条行为用例把危险窗钉死（用 `mockImplementationOnce` 吊住 B 的读盘，让 2000ms 窗正好落在「指针=B、正文=A」，断言 `writeDoc` 一次没发、再空转 60s 无迟到复活） |

**这一节仍然欠的三件事**（写在这儿而不是抹进表里。2026-10-12 更新：**只剩 ① 还欠一句授权**，② 与 ③ 都已闭合）：① P2-11 等一句删除授权；② ~~P1-4/P1-5 的 1000 章夹具与实测数字~~ **已闭**（2026-10-10：夹具与数字见上表 P1-4/P1-5 两行；剩下的只有 P1-4 的渲染层那一半，判据合并是它的前置）；③ 全表证明到的是**用例与门禁**，不是屏幕上量到的行为——~~P1-3 的截断提示~~ **已真机目检**（2026-10-11，见第十九节：时间线那句逐字上屏 + 线上确实切窗 + 占用条数据面冷热两份；**占用条面板那一行也已目检**（2026-10-12，第二十二节：面板逐条 × store × 盘上那句模板三源交叉，外加一篇无会话章的反向对照；顺带把第十九节那桩「ComposerContextBar 整个不见了」归因清楚——是 `showContextBar = hasBook && threadEmpty` 加会话回放，不是缺陷）；~~P2-13 的打字延迟~~ **已真机量**（2026-10-11，见第二十节：单键主线程成本 挂载 8.8ms vs 未挂载 2.2ms，1.9×～4×，两档都未进 longtask）；~~P2-8 长会话内存曲线~~ **已真机量并做过 A/B**（2026-10-12，见第二十一节：每轮约 +90KB 堆、线性不复合；回收那一刀真实生效，但卡只占 1.2KB/轮，严重度已就地改口径）。**到此 ③ 闭合：这一格不再欠屏幕上的一屏。**但它是**读出一条新账**收的口：折叠态那枚 chip 报「2 条 · ≈29 tokens / 33 字」，而同一轮真会带出去的还有面板里那一行 5,902 字（≈5.6k tokens）的会话历史，chip 与它的 tooltip 都不含这一笔，且 preview 本身是 reserve=0 的上限口径——登记为**待裁定**（三条出路见第二十二节），本格未动代码。

## 六、交付与验收的方法性缺口（我认为比单条 bug 更重要）

1. **没有 CI**：`.github` 目录不存在（我实跑 `ls`）。所有「门禁全绿」只在这台 Windows 机器上人工成立；台账 `README.md:6249` 自己写着「提交树单独是否全绿未证」。当前树又恰好是 prettier 红的（见第二节），正是这种状态无人发现的直接后果。
2. **没有打包/发布链路**：唯一的 build 是 `electron-vite build` 产 `out/`，`smoke` 脚本直接 `electron .`（根 `package.json:13-15`）；无 electron-builder/forge 配置被跟踪（`git ls-files` grep 零命中，只在被忽略的 `scratch/deepwrite-ref/` 里有参考副本）。**这个软件目前发不出去**——不能安装、不能更新、只能在这台机器上跑。这条要请用户拍板：是刻意只做自用工具，还是排期中还没做。
3. **验收样本规模是玩具级**：两本冒烟书分别是 5 篇和 2 篇（我实测 `find -name '*.md' | wc -l`），而产品面向的是 1000–3000 章的作者。P1-4/P1-5/P1-3 这一族全是「在小样本上恒绿」的问题。真机巡检做的都是视觉与控件级验证，从未量过规模。
4. **台账数字口径互异**：`README.md:6317` 写 215 文件/3014 用例，`:6395` 写 217/3037，我实测当前树是 217/3037。测试数没有单一事实源，长期会让「用例数变多」这种话失去意义。

> 【2026-10-12 逐条回读，全文见第二十三节】1 **已闭**（CI 在 HEAD 里，且 `tools/ci-gate.test.mjs` 把「CI 在场、跑整条 verify、不吞码」钉成断言）；
> 2 **照旧成立**（HEAD 无任何打包配置），但并行会话正在做那块（未跟踪的 `apps/desktop/electron-builder.yml`、`auto-update.ts`、`release-e2e/`），我不重复动；
> 3 **已量**（1000 章 × 3000 字夹具，P1-4/P1-5 两行的实测数字），只剩渲染层 `refreshDocs()` 那一半，被他们的未提交改动阻塞；
> 4 当年只闭了一半（冻死数改成了「最近一次实测 + 日期」），**这一格才真闭**：本机那次读到 328/4261 是因为工作区里压着
> 另一条会话未跟踪的 25 个 `*.test.ts`，而 CI 在干净提交树上报的是 304/3965——门面已写明「报数必须连着『哪棵树』一起说」。这一段原话**一字未删**——它是 2026-10-09 那棵树的事实。

## 七、台账里已记、这次仍在的开口（照录并核现状）

| 台账出处 | 事项 | 本次核对的现状 |
| --- | --- | --- |
| `README.md:6399` | 联网开着把整轮挂住 200 秒、零响应零报错，责任锁定「联网检索工具执行」那一路，标「待查」 | **已闭（2026-10-13 就地更正；本节这一行原本还写着「未修」，与第六节 `:105` 那句「已修」自相矛盾——同一份报告里两行打架，照读的人会照着后写的那行重做一遍看门狗）**：三层闸都在盘上——`apps/desktop/src/main/provider-fetch.ts:23-24` 首字节 30s / 流中空闲 60s 两只常量、`:49` `UpstreamHangError extends ProviderError`、`:105` 到点抛错；`agent-service.ts:392` `webSearch(query, {fetchImpl: abortableFetch(fetch, signal)})`（当年那句「没接 signal」已经不成立）；`packages/agent-runtime/src/tool-loop.ts:189`/`:217`/`:240`/`:318` 每轮与每次调用前查 `signal`。详见第三十三节。 |
| `README.md:6401` | 点输入框时整张卡内侧亮一圈青色边框（不是新元素，是 `.composer-input-surface` 聚焦态） | 未修，属样式判定；用户曾报为「弹出正方形」 |
| `README.md:6389` | 5-㊻ 最后一腿「真端点成功回一句」未验完，卡在必须先开一本书 | 未闭合。P1-1/P1-2/P1-3 都需要真开书 + 真端点才能验，建议与下面第八节第 2 波一起做 |
| `README.md:6242` | 皮肤挂件层运行时与新素材进表卡在 ImageGen 403 配额 | **照旧成立**：2026-10-13 当场复探一次最小图，错误原样 `403 {"code":"112",…}`。外部配额，非代码问题。另注：台账那一行的**行号已漂一格**（盘上现在在 `docs/superpowers/plans/README.md:6243`，6242 是空行） |
| `README.md:6244`（行号已失效：README 现在 95 行，照读找不到；留作**出处**不当入口） | 次要文字对比度仍差 0.1–0.4，要动的是表面阶梯 | **已闭，且病因那句作废**：数字（4.38 / 4.09）对，「要动阶梯」错——正文档对五档最低 7.60，阶梯没病；浅底要让灰字达标，深度上限 0.068（留量口径 0.048）挤不进 `hover` 0.085。改的是**用法**：新增 `--text-on-state`，77 处状态档底逐处写明字色或 shadow 本族灰字 token，判据 `appearance-surface-ladder.test.ts`。全文见第二十九节。**同族另登记一处未修**：accent 被当字色（浅底 `selected` 6/8 套 <4.5，最低 3.42），等用户拍板 |
| `README.md:6247` | 窗口无 minWidth | **已闭（2026-10-13 就地更正）**：`apps/desktop/src/main/index.ts:198-199` 现为 `minWidth: 1000` / `minHeight: 700`，判据在 `apps/desktop/src/main/window-min-size.test.ts`（第 62 行那条还钉了「初值不许小于自己的地板」）；入库于 `b1fc79a`。台账 `README.md:6247` 那句「`main/index.ts` 没设 `minWidth`」照读已是假话，更正见第三十三节 |
| `README.md:12` | Plan 2 遗留：`startListening` 丢弃了退订函数（无消费方）、UNBOUND 线程上的批准未做 | **两半都闭（2026-10-13 就地更正）**：① 退订句柄自 `2487695` 起存进 store 并由 `stopListening` 摘（`useAgentStore.ts:85` 字段、`:180` 幂等闸、`:197-199` 摘并置空），判据见本报告第十二/十三节；② 批准键不再是「线程键只修了 threads 表」——`agent-service.ts:120-126` 的 `ruleKey` 明写「这一串只是键的一半」，真正存储/命中一律过 `scopedApprovalKey(书根, …)`（单一真身 `book-scope.ts`），`autoSession` / `autoDocTool` 两张表随换书即清（`:158-161`），入库于 `b91680d`。unbound 线程在这一族里的现状是**禁用并给理由**（`utils/session-row-action.ts:43` + `UNBOUND_ROW_REASON`），不是「点了没反应」。 |
| `README.md:787` | Responses API 未支持 | 未做 |
| `README.md:3689` | 插件目录拉取（远程）未做 | 未做，且我认为**不该做**（P1-7 的远程代码执行面），建议明写在 spec 里当边界 |

> 【2026-10-13 逐条回读盘面，全文见第三十三节】这一张表当年是「照录台账 + 核现状」，九行里有 **4 行的现状已经过期**
> （`:6399` 看门狗、`:6247` 窗口地板、`:12` 两半订阅与批准键），三行照旧（`:6401` 青框未目检、`:6242` 配额复探仍 403、
> `:787`/`:3689` 等他一句话），一行上一轮已改（`:6244`）。过期那三行**当场就地更正**——不是因为写错，
> 而是因为**这张表会被当成待办清单读**：一行「未修」压在一个已经上了盘的 fix 上面，下一个人就会重做一遍看门狗。
> 表头那批 `README.md:NNNN` 是**出处不是入口**（口径来自第二十九节第六目）：真身是 `docs/superpowers/plans/README.md`，
> 门面 README 只有 102 行，照这个行数去翻必然找不到；本表刻意保留原始行号当出处，不逐条改写。

## 八、建议的修法（第 1 波 → 第 1.5 波 → 第 2 波 → 第 3 波，按「先止血再加固」）

**第 1 波 · 不丢字 + 不骗人（同族一次做完）**
P0-1 原子写（tmp→rename，失败保 tmp 不动目标；book.json/config.json 同法 + 保留一份 `.bak`）→ P0-2 `saveActive` 包 try/finally 并把理由写进 notice → P0-3 `closeTab` 查 `dirty`：先落盘或弹确认 → P0-6 `before-quit` 有脏稿时拦一次 + 主进程补 `uncaughtException`/`unhandledRejection` 落 crash 日志。
**同波加两条便宜的「不骗人」**：P0-8 归档补一个「已归档」视图 + 恢复钮（`unarchiveNote`/`restoreEntry` 已经写好了，只差入口，是纯接线）；第四节之二那份清单里**恒 0 / 假档 / 指向不存在入口**的六处，要么接真要么摘掉——按你的口径，留着就是换皮交差。
这四条丢字项做完才能说「正文不会莫名消失」；每条都要配反向用例（先红后绿），尤其 P0-2 要构造「IPC reject」而不是只测 `ok:false`。

**第 1.5 波 · 设定进书目录（P0-7）**
笔记/圣经/目标改走主进程文件通路、落在书内 `.mochen/` 下并随书隔离（`fs-store` 已有目录边界与 realpath 守卫可复用）；localStorage 只留 UI 偏好。这一波必须在加打包发布之前做——否则用户升级/迁移时设定是第一批丢的东西。

**第 2 波 · 把声明的边界变成代码的边界**
P0-4（自动批准的键并入书根，或随 `clearBookScoped` 一起清——顺路把台账 `README.md:12` 的 UNBOUND 批准一起收）→ P0-5（`ensure()` 失败回滚 `loaded=false`，且 `writeStore` 改原子 + 合并而非整份重写）→ P1-2（dispatch 层按 `webSearchEnabled` 拒绝）→ P1-1（`streamChat` 加空闲看门狗 + `webSearch` 接 signal + 工具循环每轮查 abort，顺路结掉台账 `:6399` 那条「待查」）→ P1-3（历史滑动窗口 + 显式截断提示）。

**第 3 波 · 让人下一步就踩不到 + 规模补课**
两条最便宜的其实该排在所有波之前（我把它标成「第 0 步」）：**接 CI**（跑 `pnpm verify`，退出码不吞）与 **把 `plugin-kernel/tsconfig.json` 加进 typecheck**（现在带着 2 个类型错误全绿）。之后：minWidth（P2-9）、realpath 统一边界（P2-2）、并发写按路径串行（P1-6）、`browse()` 补 catch+令牌（P1-9）、重排走 persistMeta（P2-4）、字号换算成 rem（第四节之二清单第 10 条）。
**规模补课**：造一本 1000 章 / 每章 4k 字的书当固定夹具，量开书时间、新建一章时间、发第一轮消息的时间、历史面板打开时间——P1-4/P1-5/P1-3 全是只有量了才会现形的问题。
打包发布（第六节第 2 条）需要用户先拍板要不要——要的话它是一整波独立工作（图标/NSIS/portable/更新策略/签名）。

## 九、门面（README）与现实对不上的三处

用户在 GitHub 网页第一眼看到的是这份 README（commit `5e5de1b` 刚加的中文门面），它整体是诚实的，但三句现在站不住：

1. `README.md:17`「**写盘必经审批**」——P0-4 的跨书自动批准使这句话在「A 书批过、B 书没批」的情形下是假话；
   `README.md:16`「联网开关决定的是这一枚 function 工具有没有出站」这句本身准确，但读者会推成「关掉就不出网」，
   而 P1-2 证明执行侧没闸。两处都该在下句补一行「执行侧同样要判」。
2. `README.md:41`「当前 215 文件 / 3014 用例」——我在同一棵树上实跑是 **217 文件 / 3037 用例**。台账尾部（`:6395`）已经是 217/3037，门面无同步。
3. `README.md:39-40`「一条命令串起五道闸，**任何一道红就不能提交**」——没有任何强制：既无 CI（`.github` 不存在），
   也无 git 钩子（`git config core.hooksPath` 为空、`.git/hooks` 里只有 sample 文件，我实跑确认）。
   再加上 typecheck 少一个包（第二节 P0 那条），实际是「四道半闸，全靠人记得跑」。

## 十、README 承诺的功能逐条对账（真 / 半真 / 不存在）

| 功能 | 判定 | 证据 |
| --- | --- | --- |
| 中栏对话+文档并排、左栏导航、上下文占用/伏笔/水词/审稿/变更历史面板 | **真** | `ContextMeterPanel/ForeshadowPanel/SlopPanel/ReviewScorePanel/ChangeHistoryPanel.vue` 都在；水词那块不是摆设：`SlopPanel.vue:32-34` 直接对 `book.draft` 跑 `findAiSlop` |
| 六个墨宸档案、一档绑一连接一模型、切失败理由上界面 | **真**（且 5-㊺ 刚把「不能切换」修掉） | `contracts/src/agent-profile.ts`、`README.md:6265` 那条链 |
| 一轮六枚工具、只有两枚产生待写入动作 | **真**，但「写盘必经审批」是**半真** | `tools.ts` 花名册五个 + 插件；`web_search` 执行侧无开关闸（P1-2）；跨书自动批准（P0-4） |
| 联网开关 = 控制那枚工具有没有出站 | **真**（字面成立），**半真**（读起来像「关掉就不出网」） | `provider-client.ts:166` vs `tools.ts:82` |
| 皮肤广场 8 套带整窗场景画 + 三道像素闸 | **真** | `appearanceSkins.ts:175` 起表、`apps/desktop/scripts/check-scene-art.mjs`（三道闸 G1/G2/G3 都在这份文件里，`tools/` 里没有皮肤相关的闸——这处假指向在第三十二节纠正） |
| **挂件层**（用户 5-㊵ 明确要求「能有画的和挂件」） | **不存在** | 全仓 `挂件` 只出现在 `appearanceSkins.ts:10` 的一句注释里，无任何 widget/pendant 实现；台账 `README.md:6242` 记的是卡在 ImageGen 403 配额 |
| IME 组合态 / 思考窗 / 视图过渡 | **真**（b0fd99e 刚入库） | 提交记录与 `thinking-*` 测试 |

## 十一、我核过、确认没问题的（省得重复劳动）

凭据面：safeStorage 不可用即拒存、明文不落盘（`credential-store.ts:107-115`）、回渲染层只有 `••••后4位`、Ollama 空密钥连头都不发；XSS：两处 `v-html` 上游整体转义且有回归线（`markdownToSimpleHtml` 的注释就是当年那个洞的记录）；SSE 半包与跨 chunk UTF-8（`sse.ts:23-26` TextDecoder stream:true）；abort 真中止上游 fetch；每条 tool_call 都有配对回执；工具轮次有界（4 轮）无死循环；per-run 字段透传（`...deps.provider` 整铺 + 每轮字段显式覆盖）与 chip 提示同读一份判据；备份先于写盘、失败即中断写；删除类无硬删正文通路；`hydrate` 的「值对视图旧」有 computed 钉缓存回归；layoutStore/popover/voice/canvas 的监听与 rAF 收口到位；生产代码无 `child_process`。

## 十二、2026-10-11 收口一条：中栏订阅的退订函数（台账 `README.md:12` 那半条）

**改了什么**：`useAgentStore` 的 `listening` 布尔换成 preload 交回的那只退订函数本身（`agentEventOff`），
新增 `stopListening()`。原病的形状不是「少写一个函数」而是**判据错位**——布尔只决定「要不要再注册」，
它撤不掉已经注册的那一只；而 `renderer-api.ts:26-33` 的 `createIpcOn` 注释早就写明，包装后的箭头
不是原始 listener，摘的时候**只认这个引用**。换成存句柄之后，「挂没挂」和「怎么摘」共用一份判据。
同仓其实已有正确先例：`quit-flush-client.ts:50` 的 `installQuitFlushListener` 就是「装上监听、返回退订函数」，
中栏这一条是漏网的。

**一条判定被实测推翻了，如实记**：我先把 `agent.stopListening()` 接进了 `CenterColumn` 的 `onBeforeUnmount`，
读回真机形状才发现那是**回归**——设置中心整页化会卸载中栏（判据在 `App.vue:133` 的注释与模板
`v-if="centerView === 'chat'"`），而一轮对话正好可以在用户去看设置的几秒里收尾；`turn-end` 除了收尾那一轮
还负责发队首的下一条（裁定 G3），监听一摘那条推送没人接，界面永远停在「进行中」且排队不再往下走。
于是接线改成反向：**卸载时不许摘**，判据落在两处而不是注释里——`stopListening` 的头注释写明不许在中栏卸载时调，
`center-column-listening-wiring.test.ts` 用「`onBeforeUnmount` 体内不许出现 `stopListening`」把这条钉成红。
后果由用例量出来（摘掉监听 → `running` 停在 true → 重新挂上同一条推送才收得掉）。
所以 `stopListening` 在生产里零调用是**刻意的**，与前几波那些「写好了没人调」的假控件不是一回事：
那几条缺的是通路，这一条缺的是「该摘的时机」，而本应用的订阅是窗口级的。
（曾把这段理由也写进 `CenterColumn.vue:295` 那块旁边，随即撤了：那个文件压着并行会话的未提交改动，
留注释会让这一刀没法单独入库。）

**证据（当场回读，不是记忆）**：新增两文件 13 条用例——`stores/useAgentStore.listening.test.ts`（9 条）、
`components/center-column-listening-wiring.test.ts`（4 条）。变异五只全部死：
M1 `stopListening` 只置 null 不调 disposer → 4 红；M2 装配处把调用改成不存在的方法名 → 2 红（接线）；
M3 `startListening` 去掉幂等闸 → 恰 1 红；M4 摘监听但忘记复位句柄 → 恰 1 红（重挂载那条，
证明「摘了但挂不回来」这形状也有牙）；M5 把我撤掉的错接法原样加回去 → 2 红（反向守卫确实咬得住）。
分段门禁：`tsc -p apps/desktop/tsconfig.web.json` EXIT=0、scoped eslint EXIT=0、scoped prettier EXIT=0、
行数预算 EXIT=0（`useAgentStore.ts` 769/800，**又顶近上限了**）；
全量 `pnpm test` 328 文件 / 4255 用例（4253 通过 + 2 跳过）全绿。
> 【2026-10-12 注】这枚 **328** 是**本机那棵工作树**的读数，不是干净提交树的：同一族提交在 CI 上（run `38157657994`，
> 提交 `e4b52e4`）报的是 **304 文件 / 3965 用例**。差的 24 个文件是并行会话**未跟踪**的 `*.test.ts` 被 vitest 收走了——
> 所以这一行当年报的绿**不假**，只是它证明的是「我这棵树 + 别人没提交的用例」那一整片，而不是提交树单独是绿的。
> 口径已写进门面与第二十三节第 4 条（「报数必须连着『跑在哪棵树上』一起说」）。
**真机复验已就地补上（2026-10-11，见第十八节）**：这一条改的是订阅生命周期，要真起实例走「流式途中进设置页再回来」才量得到——
那一格已经在应用内量过 A/B 两轮（A 绿、B 用刻意加回去的错接法证明它真的会红），当时没量是因为机上那只实例属并行会话现场，我没有动它。

**顺带两处发现**：① `useBookStore.ts:388` 把 `installQuitFlushListener` 的返回句柄同样丢在地上
（`quitFlushListening` 还是那枚布尔）——同一形状的第二处，退出握手是一次性的，暂时不会累积，
但它与这条是同一个病，下一刀顺手就该并过来；② 门面 `README.md:41` 那句「当前 215 文件 / 3014 用例」
与本总单第二节的 217/3037 已经双双过期，已改成「最近一次实测 + 日期」并写明要准数请跑 `pnpm test`
（对应第六节第 4 条「测试数没有单一事实源」）。

## 十三、2026-10-11 收口第二处：退出握手的订阅句柄（上一条的顺带发现①，与十二并成一刀入库）

**改了什么**：`useBookStore` 的 `quitFlushListening` 布尔换成 `quitFlushOff`（preload 交回的那只退订函数），
`listenQuitFlush()` 的形状从「查布尔、布尔为真就直接返回」改成**先摘手里那只、再订新的并把句柄写进同一格**。
`quit-flush-client.ts:47` 那句注释原先指着 `quitFlushListening`，一并改了口径——注释教人去找一枚已经不存在的字段，
是第二份判据的幽灵形状，所以它也被钉成了一条断言（见下）。

**我按十二那个形状写完，被自己的第三条用例当场打红了**：`if (this.quitFlushOff !== null) return;` 只把判据换了个名字，
没换它能不能失效——订阅被摘走之后，句柄不会自己归零，于是那一格还在说「挂着」，重装配照样被静默跳过。
**布尔的「装作还在听」换成了句柄的「装作还挂着」，同一味药没治好。** 退出握手断掉的后果比十二那条更重：
用户点关闭，一个字都不会落盘。红在那条用例上（`摘掉之后重新装配要真的重订`），不是读出来的。
改成「先摘旧再订新」之后判据只剩一句话：**手里这只是什么**——它既是摘法也是记录，不再需要第二格状态。
（另一条路是给句柄套一层「调用即归零」的 wrapper，要多 4 行；这文件 798/800 顶到上限，塞不下，
而且套一层就得再解释「为什么要套」，反而是把判据拆成两处。）

**为什么这里可以让装配重订，而十二那条偏偏不许**：`listenQuitFlush()` 全仓只有一个调用点（`App.vue:262` 根组件
`onMounted`，注释写明不接在中栏的理由是「中栏会随页面卸载，握手却该在应用的整个生命期里都在」），
生产里调一次，摘旧订新是恒等操作；十二那条的隐患来自中栏会随设置页开合反复卸载重挂。

**证据（当场回读，不是记忆）**：改动 4 个文件——`stores/useBookStore.ts`（798/800，行数未涨）、
`utils/quit-flush-client.ts`（注释口径）、`stores/useBookStore.draft-loss.test.ts`（P0-6 接线那一族 +3 条行为用例，
并把「重复装配只订阅一次」从量机制（`onQuitFlushRequest` 调用次数）改成量后果（活监听一只、点火一次只落一遍盘只回一条话）——
句柄版本下调用次数会变成两次，代理指标会把正确实现报成错）、`components/quit-flush-wiring.test.ts`（2 条 → 5 条）。
先红 6 条再实现，红的都是断言原文（`expected 'undefined' to be 'function'`、`expected [ [Function] ] to have a length of +0 but got 1` ×2、
两条 `toMatch` 未命中、client 注释含旧布尔名）。变异四只：
M1 删掉「先摘旧」那行 → 恰 2 红（行为 + 接线）；M2 把存的句柄换成 `() => {}` 假摆设 → 恰 4 红
（`typeof === "function"` 那条**没红**，是两条行为用例咬住的——形状断言不是凭据，退订真的生效才是）；
M3 在任一组件里摸 `quitFlushOff` → 恰 1 红（真身只有一处那条）；M4 把旧布尔名写回 client 注释 → 恰 1 红。
分段门禁：scoped `tsc -p apps/desktop/tsconfig.web.json` EXIT=0（0 个 error TS）、scoped eslint EXIT=0、
scoped prettier EXIT=0、行数预算 EXIT=0；全量 `pnpm test` **328 文件 / 4261 用例**（4259 通过 + 2 跳过）全绿，
（2026-10-12 注：这枚 328 同样是**本机工作树**的数——下面那行 eslint 红已经自己点明了「属并行会话未提交的在制品」；
干净提交树上 CI 报 304 文件 / 3965 用例，口径见第二十三节第 4 条。）
日志 grep 失败痕迹 0 条；全仓 `prettier . --check` EXIT=0；全仓 eslint 仍 1 红 = `SideNavNoticeDialog.vue:27`
未使用的 `useBookStore` import，属并行会话未提交的在制品（`git diff` 里有这一行、`git show HEAD:` 里没有），不归这一刀。
**真机复验已量（2026-10-11，第十七节末的应用内 A/B）**：「关闭前真的落盘」那一条已经在真应用里量到 37ms 落盘、对照轮一个字节不落；
量的过程与那一条欠的理由（机上那只实例属并行会话现场，我起的是自己的）都记在第十七节里。

**顺带一条该登记的**：`useBookStore.ts` 已经 798/800。这一刀靠「删一行加一行」压在上限内，
但它不再有余量放第二只动作（本次就是因此放弃了 wrapper 那条写法）。按门面那条硬规矩，
**贴到 800 行就该拆，拆的依据是「不共享状态」**——建议把这一条单独立成一刀（候选切法：
退出握手与自动保存排程这两族状态本就不共享），而不是等下一个改动撞墙时临时找地方塞。

## 十四、2026-10-11 收口一条：CI 三条红灯 = 用例把 Windows 路径写死（第三方审查那条「CI 最紧急」）

下面的行号按基线 `2487695`（改完会往后挪）。

**先更正我自己的判定**：那条审查把「CI 门禁失败」列为最紧急，我第一遍判成**半真**、还把原因归给
并行会话未提交的那枚 eslint 错。读 GitHub Actions 的记录后确认是**真**：`b1fc79a` 之后每一次 run 全红
（含已提交的代码，不是在制品的锅），三条红用例全在 `apps/desktop/src/main/ipc-guard.test.ts`。

**真因**（产品代码没问题，是用例的平台假设）：
- `samePathText`（`ipc-guard.ts:95-100`）早就按 `process.platform` 分叉了——Windows 不区分大小写、
  POSIX 区分，这是**正确行为**（POSIX 上 `/a/Index.html` 与 `/a/index.html` 是两个文件，认了就是放行别的 html）。
  但 `:155` 那条用例只按 Windows 语义断言「大小写差异认得」，在 ubuntu runner 上必红。
- `resolveRendererLoad`（`ipc-guard.ts:205-218`）返回 `pathToFileURL(packagedIndex).href`，也是对的。
  用例递的是字面量 `"C:/Programs/…"` 并断言结果等于 `"file:///C:/Programs/…"`——`pathToFileURL` 在
  Windows 之外把 `C:/…` 当**相对路径**拼到 cwd 上（实测本机：`file:///C:/Programs/…`；在 Linux 上会得到
  `file:///home/runner/work/…/C:/Programs/…`），于是字面量永远对不上。真实装配递的是 `app.getAppPath()`
  一类的原生绝对路径，本来就不会长成 `C:/…`。

**改了什么**（只动 test 文件，`ipc-guard.ts` 一行没改）：
1. 入口文件fixture 换成 `path.resolve(...)` 派生的**本机原生绝对路径**，断言从「等于某条字面量 URL」
   改成绕回磁盘比：`fileURLToPath(load.trust.allowedUrl) === packagedIndex`。这条不依赖平台写法，
   量的还是真 invariant——「判据指的就是加载的那一份 html」。
2. 大小写那条拆成两条，用 `withPlatform()` 显式桩 `process.platform`（win32 ⇒ 认，linux ⇒ 拒）。
   桩只影响**调用时**读 `process.platform` 的代码，管不到 node:path 模块加载时定好的 win32 绑定，
   所以走桩的用例只喂字面量 URL、不碰 `pathToFileURL`——这点写在 `withPlatform` 的头注释里，免得下次有人拿它去测路径拼接。

**证据（当场回读，不是记忆）**：本机 Windows `vitest run` 该文件 **45 条全绿**（原 44，拆出来 +1）。
变异四只全部死：M1 `samePathText` 永远小写 → 恰 1 红（新加的 linux 那条）；M2 永远区分大小写 → 恰 1 红
（win32 那条）；M3 打包态不再忽略 env（去掉 `!input.isPackaged`）→ 恰 1 红（「被污染也必须忽略」）；
M4 trust 指向 `path.dirname(index)` → 2 红（两条 file 用例，证明那条绕回磁盘的断言**不是**自证式的重复计算，
它抓的正是「加载的是这份、判据认的是别处」）。另加类型探针：`withPlatform("linuxx", …)` 让
`tsc -p apps/desktop/tsconfig.node.json` 报 TS2345（EXIT=2），说明 `NodeJS.Platform` 这枚字面量类型是真关卡——
这条有必要：linux 侧「任何非 win32 值都走精确比较」，拼错平台名不会让用例变红，只能靠编译期拦。
分段门禁：scoped `tsc` EXIT=0、scoped eslint EXIT=0、scoped prettier EXIT=0、行数预算 EXIT=0（本文件 600/800），
`tsc --listFiles` 回读确认这份 test 真在类型项目里（否则 EXIT=0 是假的）。
**Linux 形状本机验不了**（无 WSL、无 docker，`pathToFileURL` 的 win32 绑定改桩也翻不过来），所以这一刀的
Linux 证据就是 CI 本身：分支推上去 `verify.yml` 会在 ubuntu runner 跑全量 `pnpm verify`。
**已回读对上**：run `38123064023`（门禁 pnpm verify #4，commit `00a0984`，push 事件触发）
Status **Success**，job「六路 typecheck + lint + boundary + budget + 全量测试」2m14s——`b1fc79a` 以来第一次绿。
那条 run 只剩一枚与本刀无关的告警：`actions/checkout@v4` 等 action 仍标 Node.js 20（GitHub 侧的弃用告警，
不是我们 `engines` 的问题；对应第三方审查里「Node.js 版本要求」那条——已在第十五节收口）。

**没跟着改的两处，以及为什么不改**：`:43` 的 `PACKAGED` 与 `:550` 那组 `file:///C:/repo/…` 字面量确实是
Windows 形状，但它们在断言两端是**同一串不透明 URL**，`isSameRendererOrigin` 走的是 URL 解析 + 字符串比较，
不碰文件系统也不碰 `process.platform`（除那枚大小写分叉），两条平台都绿；把它们改成派生值只会增加改动面、
不增加鉴别力。**该钉的是「断言里不许出现只有某一个平台才成立的路径语义」，不是「不许出现反斜杠」**。

**登记一条并行现场的撞车风险**：`ipc-guard.ts` 与它的 test 此刻都被并行会话改着（+75/+69，落在
`isUnderReal`、形状表和他们新加的通道上，hunk 起点 224/341/513/558）。我这一刀只碰 155–190 与
515 之后的两段。这句不是推测：把他们那份未提交 diff 导出成 patch，在我这个 commit 之上
`git apply --check`（以及 `--check --3way`）双双 EXIT=0，装得干净；再 grep 他们新增的行，
没有 `C:/`、`file:///`、`pathToFileURL`、`resolveRendererLoad` 或大小写类断言——也就是说他们不会把
这三条红灯以另一种形状带回来。**合完必须重跑这个文件**，因为「patch 装得上」只证明文本不冲突，不证明语义不冲突。

## 十五、2026-10-11 门禁自身升版（第十四节末尾那句「另议」在这里收口）

**那条审查的「Node.js 版本要求」得拆成两件事判**：把 `engines.node` 从 `>=24.0.0` 放宽到 `>=20` 是
**不该做的**——Node 24 在本仓是硬前提（`packageManager` 钉 pnpm 11 系、Electron 42 的 postinstall、
`tsconfig` 的 lib 都按它配），放宽只会把「本机装不动」换成「本机跑得动而 CI 测不出差异」；
但同一枚 run 日志里那条告警是**真的**：`actions/checkout@v4`、`actions/setup-node@v4`、
`pnpm/action-setup@v4` 声明的 runtime 还是 Node.js 20，被 runner 强制跑到 24 上，GitHub 明说这层兼容
不会一直维持。**该修的是这三枚 action，不是 `engines`。**

**升了哪些**（提交 `f94d985`，只动 `.github/workflows/verify.yml`）：`checkout v4→v7`、
`setup-node v4→v7`、`pnpm/action-setup v4→v6`。用户原话是「升 v5」——v5 确实就够消警
（checkout 的 CHANGELOG 里 **v5.0.0 就是 "use node 24"**），但上游当下已是 v7/v7/v6，
所以按最新大版本走，逐条读回依据而不是照 tag 名硬猜：checkout v6.0.0 只改「凭据写进单独的文件」、
v7.0.0 只挡 `pull_request_target` / `workflow_run` 的 fork 检出，本流水线在 `push` / `pull_request`
里检出且从不往回推，两条都碰不到；`setup-node@v7` 与 `pnpm/action-setup@v6` 的 `action.yml` 里
`runs.using` 均为 `node24`，我们用到的输入只有 `node-version` 与 `cache`，且 v7 的 `cache` 描述
仍写着「Supported values: npm, yarn, pnpm」。

**本地为什么没有 YAML 关卡**：仓库里没有 YAML 解析器，也不为此装依赖（铁律：不新增依赖）。
所以本地的证据只有两条——`git diff -U0` 逐行回读（只有三行 `uses:` 变了，外加一段注释）、
scoped `prettier --check` EXIT=0（`format:check` 覆盖 `.yml`）。真正的关卡是 CI：
run `38124223928`（门禁 pnpm verify #6，commit `f94d985`）**Success**、2m27s，
Annotations 从「1 warning and 1 notice」变成「1 notice」，且整页搜 `Node.js 20 is deprecated`
已经**搜不到**。

**顺手登记一条带到期日的外部风险**（不是本仓的债，但它有日子）：Annotations 现在换成了
`ubuntu-latest` 将于 **2026-10-19** 迁到 Ubuntu 26。`verify.yml:28` 钉的是 `ubuntu-latest` 而不是
具体镜像，所以那次迁移会**自动**发生在我们身上——native 依赖的预编译产物、镜像自带的 Node、
apt 包名都可能跟着变。建议到期前另做一刀：把 `runs-on` 钉成 `ubuntu-24.04`，10-19 之后跑一次对照。
这一刀没顺手做，是因为它换的是「runner 版本策略」这条独立决定，与「消掉 runtime 告警」不是同一件事，
混在一起会让 CI 变红时分不清是哪一半引起的。

## 十六、2026-10-11 把第十五节那条到期风险收口：`runs-on` 钉成 `ubuntu-24.04`

**改了什么**（提交 `b137227`，只动 `.github/workflows/verify.yml` 一处）：`runs-on: ubuntu-latest` →
`ubuntu-24.04`，另加四行注释写清「为什么不许用 latest」。理由就是第十五节登记的那句：GitHub 定在
**2026-10-19** 把 `ubuntu-latest` 自动切到 Ubuntu 26，那一天本仓没有任何一行代码变过，门禁却可能凭空变红——
而 CI 的全部价值在于「红」必须能归因到某一次具体提交。以后要换镜像是我们主动的一刀：改这行、跑一次、看日志。

**本地证据**（改的是 YAML，仓库里没有 YAML 解析器，也不为此装依赖——铁律：不新增依赖）：
`git diff -U0` 逐行回读只有这一段（`5 insertions(+), 1 deletion(-)`）；scoped `prettier --check
.github/workflows/verify.yml` **EXIT=0**（`format:check` 覆盖 `.yml`）。

**CI 证据**（这一刀的关卡只可能在 CI，本机没有 Linux runner）：
run `38127538532`（门禁 pnpm verify **#9**，commit `b137227`，push 触发）**Success**，
job `114434920168` succeeded in **2m 17s**（其中 `pnpm verify` 那一步 1m 59s）。
关键是别只读「没变红」就当成生效——`Set up job` 日志里读回来了镜像本身：
`Operating System: Ubuntu 24.04.5 LTS`、`Runner Image: Image: ubuntu-24.04`、
`Version: 20261004.327.1`（同页 `Current runner version: '2.337.0'`）。
Annotations 整页现在是**空的**：第十五节那条「10-19 迁 Ubuntu 26」的 notice 也一并消失，
因为我们不再引用 `latest`，那条提示的触发条件本身没了。

**这一刀买到的是时间窗，不是「Ubuntu 26 也没事」**：我们没有在 26 上跑过一次，所以将来切 26 仍是独立一刀，
判据和这一样——换镜像、跑一次、把 `Set up job` 里的镜像版本读回来。同理 `ubuntu-24.04` 自己也有退役日；
到期时按同一形状主动换，不要改回 `latest`。

**落地方式**：`fix/ci-path-platform-neutrality` 与 `feat/plan3-interaction-and-assembly` 都 fast-forward 到
`b137227`（无强推、可回退），推完用 `git ls-remote --heads origin` 回读远端哈希对上本地 HEAD。
并行会话那边仍欠一步：把他们那批未提交的改动压在 `b137227` 之上后**重跑 `ipc-guard.test.ts`**——
这条与第十四节末尾那句是同一件事，「patch 装得上」只证明文本不冲突，不证明语义不冲突。

## 十七、2026-10-11 真机量出来的一条 P0：点关闭时退出握手一步都没跑

**结论先放前面**：`main/quit-flush.ts` 那套状态机（拦一次、超时放行、放行后不再拦）从头到尾是对的，
红的是**装配那两行**——`installQuitFlush` 只挂在 `app.on("before-quit")` 上，而 Windows 上用户「点关闭」
根本不走 `before-quit`。这一条把第六节 P0-6 那行从「已修」纠正为「当时半真」：握手的零件齐全，
通路却接错在事件上，**用户点关闭时一个字都不会落盘**，稿子跟着窗口一起没。

**怎么量出来的**（不是推理，是跑出来的）：Electron 42.5.0（`pnpm-workspace.yaml:10` 的 catalog 钉版，
本机装的是 `node_modules/.pnpm/electron@42.5.0`），探针在 `scratch/quit-order-probe/`（`scratch/` 被
`.gitignore:11` 忽略，所以六份日志只在本机、仓库里查不到；要复现就照 `probe.js` 的 `MODE` 分支重跑）。
探针的关键一条：**触发钮用主进程的 `win.close()`**——原先按渲染层 `window.close()` 试过一轮，它**绕过 `'close'` 事件**
（这一条现在记在 `probe.js:5` 的注释里；当时那轮的日志被后面几档重跑覆盖了，所以它只有注、没有盘），
那不是「点关闭」的模型。`main/index.ts:169` 建的是 `frame:false` + `titleBarStyle:'hidden'` 的无边框窗，
标题栏按钮本来就走主进程那一条。六份日志读回来的顺序：

| 模式 | 量到什么 |
| --- | --- |
| `plain`（现状接线） | `close` → `closed`（窗口已销毁）→ `window-all-closed`，**没有 before-quit**；探针兜底记的 `STILL ALIVE`（3 秒后进程还在）；补一次 `app.quit()` 才来 `before-quit`，而那一刻 `hasWindow=false` ⇒ `quit-flush.ts:79` 直接 return。**探针现场里同时出现「稿子没落盘」与「进程留在后台」**——
后者到下面 A/B 那一段才被限定：真应用的对照轮里进程是退的，没退的是「落盘」这一半 |
| `intercept`（我第一版想当然的修法） | 在 `'close'` 里 `preventDefault()` 之后**同步** `app.quit()`：`close` 被触发**两次**，然后 `STILL ALIVE`——quit 卡在 close 里，这一形是错的，撤了 |
| `wired` | close 被拦下时 `window alive=true`，request 发得出去；回话后 `destroy()` → `window-all-closed` → `app.quit()` → 干净退出 |
| `quitflush` / `qf-nowc` | 直接 require 本仓**真模块**（`quit-flush.ts` 经 esbuild 去型）。close 被拦 → `sendFlushRequest; window alive=true` → 渲染层回话（模拟一跳 IPC）→ `deps.quit()` → `before-quit fired; hasWindow=true` 时**不再拦**（`released` 生效，规则①在真进程里成立）→ `closed` → `will-quit` → `quit`，800ms 量级退出（`quitflush` 795ms、`qf-nowc` 831ms），**没有 `STILL ALIVE`**。两档差别是有没有 `window-all-closed → app.quit()`：**都干净**，所以那层兜底不该加 |
| `direct` | 不拦 close 直接发 request 的对照：照样走完，说明「窗口活着」才是关键，`preventDefault` 不是 |

**改了什么**（一处代码 + 四行注释，`index.ts` 461 → 466 行）：

```ts
onBeforeQuit: (handler) => {
  win.on("close", handler);
  app.on("before-quit", handler);
},
```

两个事件交**同一个** handler，状态机的真身仍只有一份。留着 `before-quit` 是因为程序主动退出（将来的自动更新重启、
崩溃前的收尾）不经窗口 close。`hasWindow: () => !win.isDestroyed()` **一个字没动**——它正是拦在 close 上的理由：
那一刻窗口还活着，脏稿还在，request 才发得出去。

**为什么不补 `window-all-closed` 兜底**：拦下 close 之后每一次关窗都必经握手，而握手要么放行退出、要么超时放行，
不存在「窗口没了而进程还留着」那条路（`qf-nowc` 档实测就是这条），全仓也查不到绕过 close 的销毁
（`grep -rn --include=*.ts -e "new BrowserWindow" -e "\.destroy()" apps/desktop/src/main` 去掉用例后只剩 `index.ts:169`
一处建窗，主进程代码里零 `.destroy()`——会绕过 close 的那条路根本不存在）。
给不会发生的场景加通路，是本仓反复清理的那类假控件。

**顺带一处口径修正**：`quit-flush.ts:25` 那行字段注释原先写「真身是 `app.on("before-quit", …)`」，
接线改完它就只说对一半——注释教人去找半个现场，和第十三节那条「注释指着已经不存在的字段」是同味药，
所以把它改了并同时钉成断言（第 7 条）。

**证据（当场回读，不是记忆）**：新增 `main/quit-flush-close-arm.test.ts`（**7 条**）。装配文件直接 import electron、
没有运行时单测入口，所以按本仓既有先例（`ipc-guard-coverage.test.ts`、`window-min-size.test.ts`）读源码当契约，
注释一律先剥。先红后绿是**当场量出来的**：把 `index.ts` 与 `quit-flush.ts` 退回 `git show HEAD:` 那两版、只跑这份新用例，
**3 红 4 绿**（红的正是 #1 挂 close、#3 同一个 handler、#7 字段注释；#2/#4/#5/#6 在旧接线上本来就成立——它们防的是往后改动），
装好接线后 7 条全绿；变异逐只跑在**同一份最终状态**上——
M1 删 `win.on("close", …)` → 恰 2 红（#1 + #3）；M2 删 `app.on("before-quit", …)` → 恰 2 红（#2 + #3）；
M3 `hasWindow: () => true` → 恰 1 红（#4）；M4 把 close 的注册包一层 `(event) => handler(event)` → 恰 1 红（#3）；
M5 两个事件交不同 handler → 恰 1 红（#3，`Set` 那条）；M6 多调一次 `installQuitFlush(` → 恰 1 红（#5）；
M7 把 `waiting = false` 抄进装配文件 → 恰 1 红（#6）；M8 把字段注释改回只指 `before-quit` → 恰 1 红（#7）。
**M4 是形状断言的假阳性边界，如实记**：`(event) => handler(event)` 语义等价而用例会红。装配文件没有运行时探针，
这是唯一能拦住「两个 handler 各跑一半」的办法——宁可让一次等价重写红到人来解释，也不要真的分叉静默通过。
（#3 原先写的是 `shared.map((one) => one.split(",").pop().trim()...)`，被 `tsc` 当场判红一条
`quit-flush-close-arm.test.ts(61,40): error TS2532: Object is possibly 'undefined'`——不是环境噪音，是真实类型漏洞；
改成 `matchAll` + `typeof name === "string"` 收窄后 M4/M5 两只变异**重跑过**，才敢写上面的结论。）

**门禁**：五段逐段取码全 `EXIT=0`——`typecheck`（六份 tsconfig）、`test`、`lint:eslint`、`lint:boundary`、`format:check`；
`node tools/check-source-line-budget.mjs` 单独跑也 `EXIT=0`（607 份）。全量测试 **304 文件 / 3966 通过 + 2 跳过**
（这两个数就是当前树的全部，含本刀新增的 1 文件 / 7 条用例；HEAD 的基线数没有单独跑过，所以不写「比基线多几条」这种没法核对的话）。日志二次取证：`grep -nE "error TS|ELIFECYCLE|Command failed|^ FAIL|EPERM|EBUSY"`
五份日志只命中 1 条，且它就是用例自己印的那行环境噪音（`ipc-guard.test.ts:536`：本机非开发者模式建不了符号链接，
软链逃逸那一条没验到），同档 `test_EXIT=0` 且该文件 45 条全过。

**这一刀到探针级为止的部分到此结束，应用内那一格同日补上了**（下面这段是 A/B，不是推理）：
构建产物起自**本机自起的实例**（`--remote-debugging-port=9246/9247` + 独立 `--user-data-dir`，用户的 9222 那台全程没碰），
书用的是《墨宸冒烟书》**复制到 `Temp/mochen-quit-probe/book-a` 的那一份**（不是用户正在用的那本），
起手先把自动保存那档设成 0（`localStorage["mochen.autosaveDelay"]`），否则两秒静默窗会替我们把字写了、测的就不是握手。
驱动走 CDP：`openBook()` → `openDocTab("chapters/01-开局.md")` → `onEdit(draft + "…PROBE-9F3A")`，
然后**用 `taskkill`（不带 `/F`）发 WM_CLOSE**——那就是「点关闭」那一条路，不是 `app.quit()`、也不是渲染层那句会绕过 `'close'` 的 `window.close()`。

| 轮次 | 接线 | 量到什么 |
| --- | --- | --- |
| A | 本刀改后（`out/main/index.js:15848-15850` 里 `win.on("close")` 在） | WM_CLOSE 落在 18:02:47.541，稿文件在 **18:02:47.578** 被写——**37ms 后那句只在内存里的字上了盘**（`grep -c PROBE-9F3A` = 1，7 行变 10 行，SHA256 从 `8a0ffe…` 变 `c77d7e…`），进程自己退干净（收尾 `netstat -ano | grep -cE ":924[67].*LISTENING"` 读到 **0**，两个端口都不再有人听——没拿后台任务那句 exit 0 当证据） |
| B（对照） | `git show 434e408^` 那一版重新构建（包里 `grep -c 'win.on("close"'` = **0**） | 同一个临时书、同一个触发钮：`grep -c` = **0**、文件 mtime 停在覆盖前的 18:03:26 没动过 ⇒ **一个字节都没落盘**，稿子随窗口没了 |

对照轮里还纠正了我自己上一条断言：**「进程留在后台」只在探针那一档成立，真应用里没复现**——B 轮发完 WM_CLOSE 两秒内端口就不 LISTENING、进程自己退了
（大概是默认那条「所有窗口关了就走」在真窗口 + 真 WM_CLOSE 下确实发了 `app.quit()`，而这正是探针 `plain` 档量到的「`before-quit` 来时 `hasWindow` 已 false」那一半）。
所以这一刀真正修掉的是**前半条：落盘**；后半条我不拿探针现场当真应用的结论写，留作未收口的观察（要追就得再开一轮专门量退出路径的探针）。

**CI**：run `38130145421` = 门禁 pnpm verify **#13**（commit `92d004b`，push 触发）**completed successfully**，1m 42s。
这一刀的关卡本来在真机而不在 Linux runner，所以 CI 只承担「全仓没被改红」这一半；
另一半是上面那张 A/B 表。

## 十八、2026-10-11 把第十二节欠的那一格量掉：流式途中进设置页再回来（应用内 A/B）

**量的是哪一格**：十二那一刀（提交 `2487695`）证据全在用例层（9 + 4 条）与五只变异，欠的是屏幕上那一行——
一轮正在流式的时候用户去看设置，中栏被整页化卸载，那条回合的**收尾**与「自动发队首」（裁定 G3）还成不成立。
这一节把那一格补成量出来的数，顺手把「关掉自动保存才能测到握手」之外的一条通用手法也记下来。

**手法（照着能重跑）**：`node tools/mock-provider.mjs --port 8787 --doc chapters/01-开局.md`；
书用《墨宸冒烟书》**复制到 `%TEMP%/mochen-cell-b/book`** 的那一份（`Documents` 里那本没动），
实例是自己起的（`--remote-debugging-port=9341` + 独立 `--user-data-dir=%TEMP%/mochen-cell-b/profile`，
用户的 9222 与并行会话那台全程没碰）；连接与档案由 CDP 直接调 `window.mochen.providerSave` / `profileUpsert`
建（`providerId:"custom"`、`http://127.0.0.1:8787/v1`、模型 `mochen-mock`、假密钥 `sk-e2e`）——仓库与临时档里都没有真凭据。
话术取 `agent.send("慢：…")`：**桩认「慢」这个字走 60ms 慢切片**，一轮约两秒，够把人中途调走。
驱动 `scratch/cell-b/run.mjs`（git 忽略），日志 `scratch/cell-b/round-{A,A2,B}.log`。

**两条现场教训，记下来免得重踩**：
① 第一版把整轮编排写在页内 `setTimeout` 循环里，撞上**渲染层后台节流**——90 次 150ms 轮询实际跑了 65 秒，
   而轮次跑在**主进程**、不受影响，于是读数看着像「慢」其实是「被节流」。节奏改由 Node 一侧驱动，页内只做动作与读数。
② `Object.keys(agent.threads)[0]` 拿到的是 `"unbound"`（启动时中栏先挂过一次，那时还没开书），
   第一版因此读了**另一条线程**、把跑成功的一轮读成「没起来」。键必须由 `book.activeDocTab` 现取现算——
   代理指标不算证据，这条与本仓反复量的是一味药。

**A 轮（`44bc159` 的接线；清掉临时书的 `.mochen/sessions` 后重跑，起点 `itemsBefore=0`）**：

| ms（Node 侧表） | 中栏挂着 | running | items | 尾字长度 | 队里 | 读到的事 |
| --- | --- | --- | --- | --- | --- | --- |
| 573 | **已卸载** | true | 1 | 0 | 1 | 只有 user-message，收尾还没来 |
| 1382 | 已卸载 | true | 1 | 4 | 1 | **人不在中栏，增量照样进 store** |
| 1797 | 已卸载 | true | 1 | 16 | 1 | 同上 |
| 2212 | 已卸载 | true | 4 | 0 | **0** | 第一轮定稿 + **队首在这一行发出去了**（items 里多出第二条 user-message） |
| 3019 / 3426 | 已卸载 | true | 4 | 4 → 16 | 0 | 第二轮在流 |
| 3832 | 已卸载 | **false** | 6 | 0 | 0 | `endedAs="done"`——**收尾也发生在设置页那一段** |
| 回工作区 | 挂着 | false | 6 | — | 0 | DOM 里同时有「我打算把开头那句收紧」与第二轮那句话，`notice` 空 |

关键就是 2212 与 3832 那两行的 `paneMounted:false`：**队列往前走与回合收尾都不是我回来之后才补上的**。

**B 轮（把十二撤掉的那条错接法原样加回去，证明这一格真能量红）**：临时给 `CenterColumn.vue:298` 的
`onBeforeUnmount` 补一句 `agent.stopListening()`，`pnpm --filter @mochen/desktop build` 后同脚本重跑。
60 行读数**从头到尾一模一样**（首行 545ms、末行 24579ms，跨 24.6 秒）：
`items` 恒 10、尾字长度恒 0、`queued` 恒 1、`running` 恒 true、`endedAs` 恒空、`paneMounted` 恒 false；
回工作区仍是 `running:true / queued:1 / endedAs:""`——界面停在「工作中」且排队不再往下走，与第十二节那段推断逐字对得上。

**B 轮里量到一条只看界面看不出的**：临时书盘上 `.mochen/sessions/2026-10-11/rollout-…jsonl` 里，
那一轮的 `reasoning`（30 字）与 `message`（20 字）**早就写好了**——主进程把整轮跑完并落了盘，丢的只是「没人听」。
所以这一刀防住的不是丢字，是**卡死的「进行中」状态与停摆的队列**（重启后回放还能把那轮捡回来，但用户在此期间点什么都没动）。

**同一句错接法在本仓用例层的红（当场跑，不是转述）**：变异态 `center-column-listening-wiring.test.ts`
= **2 failed | 2 passed**，红的正是「卸载时不许出现 `stopListening`」与「组件层没有任何一处调 `stopListening`」两条；
`git restore` 之后 `center-column-listening-wiring` + `useAgentStore.listening` 两份合跑 **13 passed**（`VITEST_EXIT=0`）。
构建产物也回读：变异包 `grep -c stopListening` = **2**，恢复后 = **1**（只剩 store 里那枚定义）——
「改了源码」不等于「跑的是改后的包」，这一格两个方向都验了。

**一处如实的边角**：`showSettings()` 那一次调用返回时 `.conversation-pane` **还在**——Vue 的卸载要到下一个 flush 才落地，
读数要到 ~545/570ms 那一行才变 `false`。不影响结论（判据取的是卸载之后的行），但别把它记成「点一下就立刻卸载」。

**这一节没做的**：没往仓里加常驻用例。这一格的判据已经由 `center-column-listening-wiring.test.ts` 与
`useAgentStore.listening.test.ts` 钉住在代码层（且 B 轮实测它们会红），应用级 A/B 是一次性测量而非可重复门禁——
把「起实例 + 打桩 + 比时间戳」焊进 CI 需要新的通路，按门面那条铁律（不给不会天天发生的场景加通路）先不做，如实记在这儿。

**CI**（编号与时长都从 Actions 列表页的 `svg[aria-label]` 读回来，不是看勾；一次推两个 ref ⇒ 两个 run）：
`8824b6d` = **#16**（run `38132353321`，`fix/ci-path-platform-neutrality`，1m 40s）与
**#17**（run `38132356575`，`feat/plan3-interaction-and-assembly`，1m 50s）；
`503560c` = **#18**（`fix/…`，2m 24s）与 **#19**（run `38132539276`，`feat/…`，2m 21s）。
四枚 `aria-label` 全是 `completed successfully`。
下面那笔「探针污染设置」的补记是 `8f28a52`，对应 **#20**（`fix/…`，1m 56s）与 **#21**（`feat/…`，2m 28s），也全绿。

**再一次编号自纠**：这一段上一版写的是「#16 与 #17 都绿」，把 `8824b6d` 与 `503560c` 两笔提交算成了同一对 run——
页面读回来才知道一次推两个 ref 出两个 run、编号是全局连号，所以 `8824b6d` = #16/#17、`503560c` = #18/#19。
结论仍然成立（四枚全绿），但**编号只认页面读回来的这一版**。

**顺带纠正一处编号口径**（我上一轮口头报的，台账里从来没错过）：`44bc159` 的两轮其实是 **#14 与 #15**
（`38130752915` = fix 分支 2m 22s、`38130755682` = feat 分支 2m 17s，两枚 `aria-label` 都是 completed successfully），
而 **#13 属 `92d004b`**（第十七节那条，1m 42s）。我说的「#13/#14 双绿」把两轮的归属错开了一格——
**结论不变（两次都绿），但编号只认从页面读回来的这一版。**

### 这一节自己捅的娄子：探针把假配置写进了用户的真身设置（当场还原）

**事实**：上面「手法」里那两次 CDP 调用（`providerSave` / `profileUpsert`）**落到了 `%APPDATA%/mochen-ai`**，
不是我指定的临时 profile。原因是 `--user-data-dir` 只搬 Chromium 那一半，主进程的配置根目录另有真身——
`apps/desktop/src/main/index.ts:65` 的 `APP_DIR_NAME = "mochen-ai"` 与 `:241` 的
`createProviderSettings({ dir: activeDir, credentials })`。第十七节记的是 `appearance.json` 住在这里，
**provider 配置与 `secrets/` 同样住在这里**，我这一轮把它当成只影响外观的老账翻了一遍，没料到会污染连接与模型。

**后果**（18:28 读盘看到的形状）：`config.json` 从 1 条连接 / 3 枚档案变成 **5 条 / 7 枚**，
而且 `enabled:true` 被我最后建的那枚 mock 档案（`2e837081-0467-43cb-a527-e5068582cc08`）抢走，
他真实的三枚 agnes 档案全被挤成 `enabled:false`——下一次开应用会往 `127.0.0.1:8787` 发请求，
而桩进程早停了，症状是「模型没响应」，屏幕上不会有任何一句指向「配置被探针改过」。
`secrets/` 也多了 4 枚 52 字节的假密钥（`1ca84f7d…` / `b0d5e588…` / `41e7c2f0…` / `f3d7354c…`，18:19–18:28）。

**还原目标不靠猜**：`Documents/墨宸示例书/.mochen/sessions/2026/10/08/` 那份 rollout 的**首行 `session-meta`
记着 `"model":"agnes-3.0-flash"`**（文件最后写入 2026-10-10 12:59，是他最近一次真用过的一轮；
更早那份 10/02 记的是 `mochen-mock`）。所以 `enabled` 该给回 `5e66558e-52e9-49f4-8d1c-ef1f66e90467`。

**动作与回读**：动手前先确认没有实例会把内存里的旧值写回去——`Get-Process electron,MoChenAI` 返回空，
且 9222 / 8787 都没有 LISTENING。然后 `cp` 现状到 `%TEMP%/mochen-probe-cleanup-20261011-1845/config.json.before-20261011-1845`
（2333 B / sha256 `e99747db9d712b57fc8397523c370bf4ac3f8b958b91e1c102d13b466ff6c179`）→
只留连接 `72c5e589-641c-4210-a74d-06ec20cc328d` 与它的三枚档案、`enabled` 给回 agnes-3.0-flash →
那 4 枚假密钥**移进同一备份目录**（没直接删）。回读：**801 B / sha256 `98841130023a66914c8244be02ff4829779fcdc08c3e4e128adb10541f75f26d`**，
`secrets/` 只剩他 10-06 那枚 112 字节的原文件，前后一个字节没动。

**下一轮探针的规矩**（同时进记忆）：起手先读 `providerView()`，**有能用的连接就复用它的 `connectionId`**，
别一上来就新建；收尾要么用 `providerConnectionRemove`（`contracts/src/ipc.ts:273`）/ `profileRemove`（同文件 `:310`）
把自己建的删干净，要么照上面这条路「备份 → 还原 → 回读」。以及一条更硬的选择：**能在 mock provider 上读判据的，就别碰 provider 配置**——
这一格的结论本来只依赖中栏卸载与否，配置那一步是我图省事直接建真连接，代价由他的设置表承担了。

**留给他裁定的一条（我不动手）**：dev / 探针实例与打包应用**共用同一份 `activeDir` 配置**，
所以任何一次真机验证都可能像这次一样写到用户正在用的设置上。要不要给开发态一个独立目录
（比如按环境变量派生 `mochen-ai-dev`）是改产品行为，不是一句注释能替拍的。

## 十九、2026-10-11 把 §5之二③ 欠的目检量掉两行：P2-5 那句截断话、P1-3 那句切窗话

这一节只做测量，不改产品代码（唯一的代码改动是 `tools/mock-provider.mjs` 加一条「截断」分支，
那是验收桩，不是产品面）。台账 §5之二③ 原话是「全表证明到的是用例与门禁，不是屏幕上量到的行为——
P2-13 的打字延迟、P2-8 的长会话内存、P1-3 的截断提示都还没做真机目检」；这一节结掉 P1-3 那一格，
并且顺手把 P2-5 的上半句也量了。**P2-13、P2-8 两格仍然欠着，没抹平。**

### 先记一条判据作废（第一版是假的，红在自己手里）

第一支探针（`scratch/trunc/hist-run.mjs`）用了两个错判据：① `.error-line` 的**总数**，
② `/丢|少了|不再带上|更早/` 这种宽正则。前者把上一轮留在屏上的那行算成「这一轮新出现的」，
后者会被正文或工具回执里的字命中——于是 T5 报了 `screenMentionsDropped:true`，
而那一刻根本没有任何截断提示上屏（当时 `truncEvents` 还是空）。这一条不配当证据，作废重做。

第二版（`scratch/trunc/hist-run2.mjs`）换成：**集合差**（基线 error-line 文本入集，只算新增）
＋ **从盘上读的成型句**（探针正则 `return \`更早的[^\`]+\`` 把 `historyNotice` 的实现抠出来，
再据它生成断言式 `/更早的 \d+ 条没有发给模型（约 \d+ 字）。/`），文案抄进探针就等于制造第二份口径。

### 量到的（真）

**① 时间线上那句截断提示确实上屏。** 真应用 + 真 SSE（本机桩 8791）+ 新建一章当干净线程，
连发六轮、每轮正文 ≈1446 字（`"雾从海面一直压进船舱，缆绳在风里绷紧又松开，"×60`）。
T1–T5 新增 error-line 为**空集**，T6 新增一条且逐字是：**「更早的 1 条没有发给模型（约 1324 字）。」**

**② 线上真的切了，不是只说了句话。** 每轮 2 个请求（文案刻意绕开桩里所有分支关键字），
`messages` 计数一路 `4,9,14,19,24,28`；`HISTORY_TOKEN_BUDGET = 6000`（`history-window.ts:25`）、
`estimateTokens` 一字一 token（`context.ts:60-76`），T6 时五个历史块 ≈7230 > 6000 ⇒ 丢最旧一块，
与量到的 `droppedCount 1` 对得上。

**③ 走的是既有的 `error` 事件通路，不是契约里那枚 `history-truncated`。** 这是这一节最该记下来的事实：
主进程在 `agent-service.ts:638-646` 就先把整段历史切了（`fitHistoryToWindow` → `historyNotice(fitted)`
→ `emitOnly` 落一条 `type:"error"`），递进 `runTurn` 的是 `fitted.kept`（`:665`）；
于是 `tool-loop.ts:164-174` 那一路 `if (fit.droppedCount > 0) emit history-truncated` 在桌面应用里
**结构上永远不会触发**（喂给它的历史已经切好了，`droppedCount` 恒为 0）——真机六轮 `truncEvents` 全空，
和这个推断一致。而 `contracts/src/agent-event.ts:105` 声明了这枚事件、`apps/desktop/src` 里
**零消费方**（`timeline.ts` 的分支只有 user/thinking/plan/message/tool/error/interrupted）。
它当下只被包级单测钉着（`tool-loop-history-window.test.ts`）。
**这不是界面上的缺陷**（用户看得见的那句是 error 事件，已经量到了），但总单 P1-3 那行写的
「显式截断提示」如果按字面去找 `history-truncated` 的渲染分支，会让人以为没修——
建议照这一节改那行的措辞；要不要把 tool-loop 那半段（连同契约里的枚举）收掉，**等他一句话，我不擅自动**。

**④ P2-5 那半句（`finish_reason:"length"` 的人话）也是真的。** 桩里新增「截断」分支：流完半句正文
后把 `finish_reason` 打成 `length`。真机上句子（`provider-client.ts:48-52` 的 `truncationNotice`）
逐字出现在 `.agent-timeline .error-line`、**半截正文仍留在屏上**（不是整轮消失），
而正常 `stop` 那一轮新增 error-line 为 0（反向用例成立）。会话 JSONL 里存成 `type:"error"`，
所以重启回放照样看得见这句。

**⑤ 占用条的数据面。** `contextPreview.history` 同一轮里读了两份：新建成、无会话的那章 = **全零**
（反向：不许拿 0 冒充「截断了」）；六轮那章 = `entries 28 / approxTokens 5592 / droppedCount 2 / droppedChars 2648`
（5592 ≤ 6000，正好是被切剩的那份；预览按「预留为零」的上界算，所以比线上少切一块，与 `historyStatFor`
注释里的口径一致）。

### 没量到的（不许抹平）

占用条**面板上那一行**（`historyNoticeText` → `ContextMeterPanel`）这轮**没做成目检**。
第一次读时按钮在（屏上是「2 条 · ≈29 tokens」），后来整条 `ComposerContextBar` 不在 DOM 里
（`.composer-context-item` 查空、`.context-meter` 查空），而同一时刻 store 里 `contextPreview`
是好的（`items 2 / empty false / droppedCount 2`）——怀疑与我这轮删掉自己那条临时连接后的现场状态有关，
**没有证据说这是产品缺陷，也没有证据说用户看得见那一行**，所以这一格记「未验」。
另：探针里 `agent.contextPreview.history` 直接出桥会得到 `{}`，那是 Vue reactive 代理的序列化形状、
不是数据形状，必须 `{...h}` 展开后再读（我差点把这条读成「字段没数」）。

> **【2026-10-12 后补：这一格已量，且上面那句「怀疑」是错的】** 面板那一行在第二十二节逐条读到了（三源交叉 + 无会话章反向对照）。
> 当时那桩「整条 `ComposerContextBar` 不在 DOM 里而 store 里 `contextPreview` 是好的」**与我删掉临时连接无关**：
> 可见性判据是 `showContextBar = hasBook && threadEmpty`（`utils/composer-context.ts:78`），而我那一屏开的是**有会话的章**，
> 会话回放把时间线灌成非空（实测 items 30）⇒ bar 按设计不挂载。store 里那份 preview 是**上一屏挂载期间**留下的读数
> （全仓只有 `useAgentStore.ts:585` 那一处赋值，初值 `:64` 为 null，**没有任何反初始化路径**），
> 所以才会出现「数据在、控件不在」。不是缺陷，也不必再查。

### 现场与收尾（照 §18 立的规矩走，并验证那条规矩有效）

探针书 `%TEMP%/mochen-trunc/book`（章 98/99 只为拿干净线程）；日志
`%TEMP%/mochen-trunc/{hist2,meter3}.log`；探针脚本 `scratch/trunc/`（git 忽略）。
收尾只用 `providerConnectionRemove(自建的 2c3f1224-…)` + `profileEnable(他的档案, true)`，
之后回读：**`config.json` 801 B / sha256 `98841130023a66914c8244be02ff4829779fcdc08c3e4e128adb10541f75f26d`**，
`conns=1 profiles=3 enabled=["agnes-3.0-flash"]`，`secrets/` 只剩 `72c5e589-641c-4210-a74d-06ec20cc328d.enc`
——与 §18 修好那份**逐字节相同**，即这一轮真机验证对他正在用的设置表一个字节没动。
进程只停自己起的两个（命令行留着当证：`mock-provider.mjs --port 8791` = 35516、
`out/main/index.js --remote-debugging-port=9345 --user-data-dir=%TEMP%/mochen-trunc/profile` = 3256），
停完 8791 / 9345 均无 LISTENING。

**门禁与 CI 的读数**（都是回读，不是推断）：本地 `corepack pnpm verify` 全链走完、真退出码落在
`/tmp/dw-gate-19/verify.exit`（`VERIFY_EXIT=0`），日志内容侧第二证据是
`Test Files 304 passed (304)` / `Tests 3966 passed | 2 skipped (3968)`，prettier / 六份 tsc / eslint /
边界 / 行数预算（607 份）无一行红；桩自己的 `tools/mock-provider.test.mjs` 21 条另跑一遍也绿。
CI 那一格按 Actions 行标签读：**`3e218e1`（本节）= Run 24 与 Run 25，两条 `completed successfully`**；
顺带回读到 `46f4081` = #22/#23、`8f28a52` = #20/#21，与第十八节那两处编号自纠对得上。

## 二十、2026-10-11 真机量 P2-13：查找层高亮层「挂不挂载」的单键主线程成本

§5之二③ 的第三格（前两格在第十九节）。**这一格同样零产品代码改动**：量的就是盘上现有的接线
（`DocumentPane.vue:713` 那枚 `v-if="findVisible"`，与 `:268` 的内容闸），夹具与探针都在
`scratch/typing/`（git 忽略）与 `%TEMP%/mochen-typing/`。

### 怎么量的（方法先写清楚，因为方法决定了数能说明什么）

- 夹具：临时书里两章长文，`05-长章.md` 14,994 字（251 次「海雾」）与 `07-规模档复测.md` 46,782 字
  （781 次）——都是 `06` 那一章的同一份正文，只差规模一档。
- 上屏动作走 `document.execCommand('insertText')`：它与 IME 上屏是**同一条内部通路**，
  照常派发 `input` → `onEdit` 改草稿 → `DocumentPane.vue:311` 那只 watcher 重算 positions 与 mirror HTML。
  **没有覆盖到的只有 OS 键处理那一段**，所以这一族数说明的是「渲染层为每个键占住主线程多久」，
  不是端到端「按下到看见」的全链路延迟——后者要另配一次真人按键，别拿这数当那数用。
- 计时全在页内：一次 `Runtime.evaluate` 往返本身几十毫秒，算进「一个键」就成了网络开销。
  为什么不用 `requestAnimationFrame` 定标：窗口被遮挡时它会降频甚至不来；
  为什么不用 `setTimeout(0)`：后台节流能把它拉到 ~730ms（第十八节格 B 实测过），
  那个常数会淹掉几毫秒的真实开销。所以取**四跳微任务冲刷**（Vue 调度器那次 flush 就是 Promise 微任务），
  另挂一只 `PerformanceObserver('longtask')` 当第二条独立证据。
  每一档都回读 `document.visibilityState`（本轮三档都是 `visible`，没有节流污染）。
- 三档顺序是 A（面板关着）→ B（面板开着且查询命中数百处）→ **A′（关掉再打）**。
  A′ 是这一格真正的反向对照：**同一份构建、正文比 A 更长**，若回到 A 的量级，
  差异就归挂载而不是归「越打越长」。

### 数（全部现场量得，中位 / p90，单位 ms/键）

| 档 | 14,994 字那章 | 46,782 字那章 |
| --- | --- | --- |
| A 查找面板关着（`.find-replace-mirror` 不在 DOM） | **2.2 / 3.2** | **4.6 / 5.1** |
| B 面板开着（251 / 781 处命中，层高 HTML 24,098 / 74,946 字符） | **8.8 / 14.7** | **8.7 / 12.8** |
| A′ 关掉之后再打（层又不在了） | **2.2 / 3.8** | **3.9 / 4.8** |
| 比值 B/A | **4.0×** | **1.89×** |

`longtask` 在**所有六档都是空**：这两个数量级下没有哪一键翻过 50ms 那条线。

### 这三行能说什么、不能说什么

**能说**：① P2-13 的机制在真机上是成立的——面板关着时那层连 DOM 都不在（每档前后都当场断言过
`mirrorCount === 0`），开着时它真在干活（`markCount` 251 / 781、innerHTML 两万到七万字符），
两者的单键主线程成本差 **1.9×～4×**；② 关掉之后（A′）就回到 A 的量级、**正文更长也不反弹**，
所以这一刀省下的是挂载本身的钱，不是「文档短时的运气」；③ 量级要说白话：
在 1.5 万字那一档，开着查找打字每个键多占约 **6.6ms**、p90 从 3.2ms 涨到 14.7ms，
**这不是一次可感知的卡顿**（没有任何一档进 longtask）。台账原来把它记成「打字延迟」的严重度，
按现场数应当下调为「省下主线程占用，规模越大越明显，但当前两档都还没到卡顿线」。

**不能说**：① 46,782 字那一档**关着也要 4.6ms/键**（比 14,994 字那档的 2.2ms 高一倍），
这条上涨**不是 P2-13 造成的**（那层根本没挂），它指向「每次输入都重算的那条链」在长篇章自身的规模问题
（`onEdit` → 草稿 → 分节/字数统计这一族），正是 P1-4/P2-8 那条规模线该接走的，
本节只登记读数、**不据此断言根因**（没做火焰图，也没逐段摘除过）；
② 绘制（paint / 合成）不在这族数里；③ 真人用键盘敲的端到端延迟没量过。

### 中途读到过一条脏数，已作废并补了闸

46,782 字那一档**第一次**跑出来的 A 是 4.8ms、比值只有 1.6×——回读 `BOOT` 才发现那一次
`mirrorCount` 是 **1**：上一支探针（在 `FIND_OPEN` 之后才失败）把查找面板留在了开着的状态，
于是「A 态」实际是「层高挂在那儿、只是查询为空、内容为空串」——**那不是关着**。
这一轮的修法不是把数挑好看的，而是加了两道会当场失败的断言：
`boot` 里先 `findReplace.close()` 再等层从 DOM 消失，`mirrorCount !== 0` 就直接停；
`burst(label, chars, expectMirror)` 每档打完后按预期再断一次（A/A′ 必须 0，B 必须 1 且 `markCount > 0`）。
上表的数全部是**加闸之后**重跑的（`%TEMP%/mochen-typing/run-guarded-{15k,45k}.log`）。

### 现场与收尾

实例：`apps/desktop/out/main/index.js --remote-debugging-port=9346
--user-data-dir=%TEMP%/mochen-typing/profile`（主进程 PID 32008，命令行当场回读为证），
跑完 `taskkill //F //T //PID 32008`，9346 无 LISTENING。
**这一格一条 provider 配置都没碰**（打字不需要模型服务）——正是第十九节那条新规矩的效果：
收尾后 `%APPDATA%/mochen-ai/config.json` 仍是 **801 B / sha256 `98841130…`**、
`secrets/` 仍只有 `72c5e589-…enc`、`appearance.json` mtime 停在今日 13:01（探针开始之前）。
构建产物用的是 18:28 那一份（`out/renderer/assets/index-CZiP92eC.js` 里 `find-replace-mirror` 命中 2 处，
即 `v-if` 那半枚确实在包里）；本节没有改动任何被跟踪的源码，故未重跑全量门禁。

**CI 回读**（编号与 `svg[aria-label]` 都从 Actions 列表页读，不是看勾）：本节落盘 = `02aa39e`，
一次推两个 ref ⇒ **Run 28（`feat/plan3-interaction-and-assembly`，run `38151290340`，1m 43s）与
Run 29（`fix/ci-path-platform-neutrality`，run `38151290373`，1m 56s），两枚标签都是 `completed successfully`**。

## 二十一、2026-10-12 真机量 P2-8：长会话内存曲线，外加一次「摘掉回收」的 A/B

§5之二③ 的最后一格（第一格在第十九节、第二格在第二十节）。**这一格动过一次被跟踪源码，但跑完就还原了**：
为了把「点新建对话之后堆掉下来」这件事归因清楚，我把 `resetThreadView` 里那一圈按线程 `delete` 注释掉、
重新构建、跑同一条探针，再 `git checkout --` 还原并重建（还原后的 chunk 文件名回到与 HEAD 同名的
`index-CZiP92eC.js`，构建产物里 `delete x.proposals[` 的命中数 **变异包 0 / 还原包 1** —— 这条 grep 是
「改了源码」与「跑的是改后的包」两个环节各自的证据，缺一个都不算）。
同一圈 `delete` 我还注释掉第二遍，只为回答「用例到底拦不拦得住」：
`useAgentStore.sessions.test.ts` 在变异下**恰好 1 条红**，报的就是 `:124` 那条
「切换覆盖旧视图：上一条会话留下的提案卡不再可点」（`FAIL …ci-platform-neutral/apps/desktop/…sessions.test.ts`，
`VITEST_MUT_EXIT=1`），还原之后同一文件 **15 条全绿**（`VITEST_RESTORE2_EXIT=0`）。
所以这一刀不是只有本轮真机撑着——既有单测拦、也有真机曲线与 A/B 撑。
夹具与探针都在 `scratch/p2-8/`（git 忽略）与 `%TEMP%/mochen-p28/`，曲线原始读数在
`%TEMP%/mochen-p28/curve-head.json` 与 `curve-mutated.json`（32 个采样点，每点含堆、卡数与卡字节、
每条线程 items 字节、DOM 节点数、main/renderer 两个 PID 的 OS 工作集）。

### 怎么量的

- **专用桩** `scratch/p2-8/stub.mjs`（端口 8792）：每轮固定吐 200 字思考 + 1200 字正文 + 一枚 300 字提案。
  不复用 `tools/mock-provider.mjs`，因为它每轮文本长度随输入变——**长度不固定的曲线没法解释**。
  现在每轮留下的字节是可核对的常数：一枚卡（含 diff）实测 **1,165 B**，一条线程 15 轮 **80,387 B** 常驻正文。
- **实例**：`out/main/index.js --remote-debugging-port=9358 --user-data-dir=%TEMP%/mochen-p28/profile`，
  夹具是《冒烟样例》那本 trunc 书的干净副本（`.mochen/sessions` 清空）。跑完 `taskkill` 自己那两个 PID
  （命令行当场回读确认是我的），9358 与 8792 的 LISTENING 计数归 0。
- **读数三条独立来源**：① 页内计数（全局 `proposals` 表条数与字节、每条线程的 items 数与字节、DOM 节点数）；
  ② CDP 堆（`HeapProfiler.collectGarbage` 之后 `Runtime.getHeapUsage`，不用 `performance.memory`——那个是量化过的）；
  ③ OS 工作集（powershell 现读 main / renderer 两个 PID 的 `WorkingSet64`）。
  节奏全部由 Node 一侧驱动（第十八节那条节流教训）。
- **「新建对话」走真鼠标点击**，不直调 store：`button.header-text-button` 这一类名在头部有**两枚**
  （隔壁那枚是「历史对话」），第一版按类名取第一枚就点错了。改成按 `.header-text-button-label`
  的文案「新建对话」认，并在点击后**当场断言这一条线程 `items === 0`**，不满足就停——
  否则「回收那一格」会被一次静默的错点读成「回收没生效」。

### 曲线（HEAD 那一条，堆单位 MB；「items 常驻正文」= 两条线程合计的 items 字节，不看视图）

| 采样点 | 堆 | 全局卡数 | items 常驻正文 | DOM 节点 |
| --- | --- | --- | --- | --- |
| S0 起点（开书开章，零轮） | 8.83 | 0 | 0 | 475 |
| A-第 1 轮 | 8.99 | 1 | 5,204 | 479 |
| A-第 15 轮 | 10.19 | 15 | 80,387（全在 A 那条） | 1,905 |
| 切到 B（还没打字） | 9.67 | 15 | 80,387（**A 的一条字没少**，只是不渲染） | 476 |
| B-第 8 轮 | 10.09 | 23 | 123,060（A 80,387 + B 42,673） | 1,216 |
| **切回 A** | **10.31（全场峰值）** | **23（一枚没少）** | 123,060 | 1,906 |
| A 点「新建对话」之后 | 9.65 | **8**（A 那 15 枚没了） | 42,673（只剩 B） | 477 |
| B 点「新建对话」之后 | 9.62 | **0** | 0 | 477 |
| 清后再打第 3 轮 | 9.73 | 3 | 16,128 | 696 |

盘上同时看得见：两条线程的会话 JSONL 分别 **182,762 B（15 轮）** 与 **133,896 B（11 轮）**，
即每轮约 12KB 落盘；main 进程工作集从 105.6MB 爬到 ~120MB（前几轮爬得最陡），renderer 在 140–160MB 之间来回。

### 这四条能说，一条不能说

**能说**：
① **线性，不复合**——15 轮 +1.36MB（约 90KB/轮），清空后再打 3 轮斜率一模一样（9.61→9.73）。
② **切线程不回收**——切回 A 时全局表仍是 23 枚、堆反而冲到全场峰值 10.31MB；回收只挂在
「新建对话 / 覆盖式切换」这一刀上（`resetThreadView`），这跟当年写这条时的措辞（「切会话/重置线程才清」）一致，
现在它有真机数了。
③ **那一刀确实在跑**——23→8→0，DOM 1906→477；A/B 里摘掉 `delete` 之后同样两次点击是 23→23→23，
清后三轮甚至涨到 26 枚，而且页面上还挂着 845 个节点（HEAD 同点是 477）——**死卡继续渲染**，
这正是当年那半条缺陷的形状。
④ **但卡不是内存大头**——1,165 B/枚、23 枚合计 26.8KB，而每轮总成本约 90KB。所以 P2-8 当年把严重度记在
「`proposals` 只增不删」上是**记错了地方**：长会话那笔钱的主项是每轮 items 的常驻（正文+思考，实测 5.4KB 字面/轮）
和它带来的响应式与 DOM 开销，卡表只是其中最便宜的一格。这一格因此**不是「已修所以没事」，而是「修的那一半本来就小」**。

**不能说**：清空之后堆停在 9.62MB、没有回到 8.83MB 起点（残差 +0.79MB）。**这 0.79MB 我没归因**——
它需要 heap snapshot 的支配树对比（本仓没有这个通路，也不为这一格装依赖），也可能只是 V8 把已回收的空间
留在 heap 段里不还。**不许把它读成「漏了 0.79MB」**；同样，26 轮这个规模是我造的，
不等于用户真书里几百轮的规模——斜率是线性的，所以外推「每轮约 90KB」比外推「总占用」可靠。

### 这一格撞过的六处方法坑（都改了探针，不是改了读数以凑曲线）

1. **点到隔壁「历史对话」**（上面写过）：同类名两枚钮 ⇒ 按文案认 + 点完当场断言。
2. **「本轮工具调用达到上限（4 轮）」**：专用桩第一版每轮都回 `tool_calls`，回投那一轮必须只出正文
   （`tools/mock-provider.mjs` 里 `isFollowUp` 早就钉着这条，我抄的时候漏了）。
3. **「更早的 1 条没有发给模型（约 1200 字）」被我的探针当成失败**：P1-3 那句走的就是 `type:"error"`
   （第十九节量清的机制），轮次其实是成功的。改成白名单，句式从盘上的 `history-window.ts` **推出**正则；
   第一版整串转义把 `${}` 拆成两个转义符，派生出的正则谁都匹配不上（当场表现为「非预期 error」而红），
   于是先花一秒跑 `scratch/p2-8/pattern-check.mjs` 自检四条（命中 1 条/命中 37 条/拒绝别句/拒绝带前缀的同一句）
   再开长跑——**长实跑前先过廉价门禁**。
4. **一次 ENOENT**：我在实例还开着的时候把书目录整个删掉重建，主进程 `threads` 里那条相对路径当场失去文件。
   **换夹具必须先停实例**（这是探针纪律，不是产品 bug——`book-scope.ts` 头注释那条 ENOENT 是跨书撞 threadKey，
   跟这个成因不同，别混为一条）。顺带纠一处台账旧措辞：路径在盘上是**嵌套** `sessions/2026/10/11/…`，
   第十八节那行写成扁平 `2026-10-11/` 是被错误显示的折叠误导的，`rollout.ts:37` 才是判据。
5. **一次「还没有保存 API Key」**：删掉 `--user-data-dir` 那半边重建后，上一实例写的 safeStorage 密文
   在新实例解不开（main 日志：`Error while decrypting the ciphertext provided to safeStorage.decryptString`），
   于是 `apiKey()` 归 null。复用时必须**在本实例重新存一次密钥**（只重写我们那条连接）。
   **同一份日志里还读出一条与本格无关、我没动任何东西的事实**：他 10-06 那枚真密钥
   （`secrets/72c5e589-….enc`）在**这个 dev 实例**里同样解不开——也就是说探针实例既不可能误用他的真密钥，
   也意味着 dev 里他配的模型跑不通（打包版是不是同一结果**未验**）。登记为待查，不在本波处置。
6. **scoped vitest 从错的目录跑，会把并行会话那份checkout 的同名文件一起收进来**：我在仓库根执行
   `vitest run --root ../.. src/renderer/…sessions.test.ts`，`../..` 当场解析成 `Desktop/`，
   于是 vitest 收了**两个**文件（`深渊写作-worktrees/ci-platform-neutral/…` 与 `深渊写作/…`）、报 30 条，
   红绿混着两棵树。判据本身没被污染（`FAIL` 那行明确点名本树那份），但**计数与归因是错的**——
   这条脚本的 `--root ../..` 只有在 `apps/desktop` 目录下才成立（`package.json` 里它就是那样跑的）。
   改成 `cd apps/desktop` 再跑：只收本树那一份，15 条。
   **下次做单文件红绿复核，起手先 `cd apps/desktop`**，别看日志里有 `.test.ts` 就以为跑的是自己的树。

### 现场与收尾

实例与桩两个 PID 均已 `taskkill`（各自命令行当场回读确认是我的），9358 / 8792 无 LISTENING。
用户真身设置回到基线：`%APPDATA%/mochen-ai/config.json` **801 B / sha256 `98841130…`**（与还原目标同串），
connections 1、profiles 3、`enabled` = `agnes-3.0-flash`；探针那条连接与它的 `mochen-mock` 档案由
`providerConnectionRemove` / `profileRemove` 删净（回执当场回读 `removedProfiles:["mochen-mock"] conns:1 profiles:3`），
`secrets/` 只剩他 10-06 那枚 112 B；`appearance.json` mtime 仍是 13:01（探针之前）。
被跟踪源码只有这一份台账被改；`useAgentStore.ts` 的变异**已还原**（`git status` 干净），
还原后重跑过 `corepack pnpm build`。

**CI**（编号与时长仍从 Actions 列表页的 `svg[aria-label]` 读回来，一次推两个 ref ⇒ 两个 run）：
**`847652d`（本节）= Run 30（`fix/ci-path-platform-neutrality`，run `38155122971`，2m 2s）与 Run 31
（`feat/plan3-interaction-and-assembly`，run `38155123054`，2m 23s），两枚 `aria-label` 都是 `completed successfully`**；
上一节 `02aa39e` = Run 28（run `38151290340`，1m 43s）与 Run 29（run `38151290373`，1m 56s），同样两条 `completed successfully`。

## 二十二、2026-10-12 真机目检「占用条面板那一行」——§5之二③ 的三格就此量齐

第十九节留了一句「**占用条面板那一行仍未目检**，别把它算成已验」。这一节补那一屏：把折叠的占用条点开，逐条读出面板里的装配条目、
「会话历史」那一行、以及底部那句截断提示，并拿**三条互不依赖的来源**交叉——面板 DOM、store 里那份 `contextPreview`（主进程
`assembleFor` + `historyStatFor` 的原样回包）、盘上 `utils/history-window.ts` 那句模板本身。

### 现场与通路（零模型调用，所以零 provider 配置）

工作树 `深渊写作-worktrees/ci-platform-neutral`（`847652d` + 台账 `08f0f64`），`corepack pnpm build` 后起实例，CDP 端口 9360，
`--user-data-dir` 指到 `%TEMP%/mochen-meter/profile`。夹具**沿用第十九节那本** `mochen-trunc/book`，没新造书：
`chapters/` 四篇 81 / 86 / 35 / 38 B，`.mochen/sessions/2026/10/11/` 两条 rollout——36,650 B（`chapters/01-开局.md`，
9 个 `user-message`）与 34,523 B（`chapters/99-历史窗口探针.md`，6 轮 × 5 类事件）。两本都在 10-11 就躺在那儿（第十九节跑的），
这一格只是把它们**读出来**。

占用条的数据面是 `agent-service.ts` 的 `contextPreview`（`assembleFor` 给装配条目，`historyStatFor` 给历史与丢弃数），
**不发一轮也能拿到全量读数**——所以这一格不像第二十一节那样要配 mock 档案与专用桩。探针 `scratch/meter/run.mjs`（243 行，git 忽略），
产物 `%TEMP%/mochen-meter/{probe.log,panel-hot.png,panel-01.png,panel-cold.png,electron.log}`。断言的字符串也不手抄：探针从盘上抓
`history-window.ts` 里 `return \`更早的…\`` 那段模板，按 `${…}` 切成字面段、段间拼 `\d+` 生成判据式；盘上读不到那句就抛
「判据失效」。**模板一改，探针当场红**，而不是跟着文案漂。

### 四屏读数（数字全部从 `probe.log` 回盘抄，不是记忆）

**屏 1｜开 99 章（盘上有 6 轮会话）**（**这一屏要冷实例才成立**，热实例上重开同一章不回放，见下面那一节）：`items 30`、提案卡 6 枚、`hydrated true`、`barInDom false`、`meterInDom false`、
`preview null`。⇒ **第十九节那桩「ComposerContextBar 整个不见了」的真身就在这里**：可见性判据是
`showContextBar = hasBook && threadEmpty`（`utils/composer-context.ts:78`，用例钉在 `composer-context.test.ts:101-110`），
而开章会把那条会话**回放**进时间线（`ensureHydrated → runHydrate → applyReplay → reduceEvent`），视图非空 ⇒ 整条 bar 不挂载。
**这是设计里的取舍，不是缺陷**——但它在第十九节被我当成可疑现象记过一次，这一格把它归因干净了。

**屏 2｜真鼠标点「新建对话」把这条线程的视图清空**（`clearThreadView` 置 `hydrated=true`，回放不再把它倒回来；按
`.header-text-button-label` 的文案选钮，点完**当场断言** `items === 0`）：

- 折叠态那行字：`2 条 · ≈29 tokens`；tooltip：`这一轮会连同下面这些一起发给「墨宸 · 主笔」：33 字，约 29 tokens（点开看装了什么；条目与 startTurn 同源，占用条上写的就是真会发出去的）`
- store `contextPreview`：`profileName 墨宸 · 主笔`、`items 2`、`chars 33`、`approxTokens 29`、
  `history {entries 28, chars 5902, approxTokens 5592, droppedCount 2, droppedChars 2648}`
- 面板（rect 320×180 @ (671,577)）表头「这一轮会带这些上下文」、副注「按当前档案「墨宸 · 主笔」装配」，三行逐条：
  `正文 | 第一章 · 开局 | 16 字`、`正文 | 第二章 · 中段 | 17 字`、
  `会话历史 | 这一轮实际发送 28 条历史、5902 字（约 5.6k tokens）；更早的 2 条没有发给模型（约 2648 字）。 | 28 条 · 5902 字`
- 底部那句：`更早的 2 条没有发给模型（约 2648 字）。`

**屏 3｜换 01 章（9 轮）复核，免得结论钉死在 99 那一章上**：面板两行 `正文（本章） | 16 字`（这一章是当前绑定文档，
所以类别标签带「（本章）」，`active=true`）、`会话历史 | 24 条 · 6336 字`；底部句 `更早的 3 条没有发给模型（约 3954 字）。`；
store `history {entries 24, chars 6336, approxTokens 6000, droppedCount 3, droppedChars 3954}`。

**屏 4｜反向对照（`chapters/98-空线程对照.md`，盘上没有这条会话）**：面板只有那两行正文，`notice` 是空串
（DOM 里连 `.context-meter-history-notice` 节点都不存在），store 历史五项全 0。**没有会话就不许出现「会话历史」那一行**——
这一条是屏 2/屏 3 那两行有鉴别力的前提。

`PROBE_EXIT=0`，`fail: []`，`ALL_ASSERTIONS_PASS`。三张截图逐张看过（`panel-hot.png` 22,115 B / `panel-01.png` 21,289 B /
`panel-cold.png` 13,607 B），面板里的字与 DOM 读数一致。断言共五类，正向两章各跑一遍：
①「会话历史」那行的字数栏 === store 拼出的 `${entries} 条 · ${chars} 字`；② 底部那句必须匹配盘上模板派生的判据式；
③ 句里两个数字分别 === `droppedCount` / `droppedChars`；④ 面板去掉历史行之后的行数 === `preview.items`；
⑤ 折叠态那行字 === `${items} 条 · ≈${approxTokens<1000?原样:(n/1000).toFixed(1)+'k'} tokens`。
另有反向三条（不许出历史行 / 不许出那句 / 对照章 store 历史必须为 0）与屏 1 一条（视图非空那一屏不许在 DOM 里有占用条）。

### 这些断言证明过自己能红（三只变异全死），并复跑复核过一次

按「断言必须证明它能失败」的规矩，我**把探针自己的判据改了三个地方**（产品代码一个字没动），同场再跑一次：

| 变异 | 当场红成什么样 |
| --- | --- |
| 「会话历史」那行的期望改成 `${chars + 1} 字` | `99 章：那行的字数栏是「28 条 · 5902 字」，store 该是「28 条 · 5903 字」` + `01 章：…「24 条 · 6336 字」…「24 条 · 6337 字」` |
| 句里第二个数字改成跟 `droppedCount` 比 | `99 章：句里的字数 2648 ≠ store 的 2` + `01 章：句里的字数 3954 ≠ store 的 3` |
| 反向那条判据取反（要求对照章**必须**出历史行） | `反向失败：没有会话的章，面板却出了「会话历史」那一行` |

`PROBE_EXIT=1`，五条红一次列出（`probe-mutated.log`）；三只都死 ⇒ 上面那些「三源对齐」不是把同一个数抄两遍自证。
然后把三行改回去（`grep` 回读确认逐字复原），**冷实例复跑：`PROBE_EXIT=0` / `fail: []` / `ALL_ASSERTIONS_PASS`**。
复跑读数与第一跑**逐字段相同**（`items`、`entries`、`chars`、`droppedCount`、`droppedChars`、`notice`、`meterText` 全部一致，
`probe.log` vs `probe-green2.log`）——所以这一格的数不是单次现场。

### 但这一格对「实例冷不冷」敏感：热实例复跑当红，两处，逐条归因

中间那次复跑（没重启实例，直接在第二跑留下的现场上跑）**红了两条**，我把它当发现而不是当噪声：

1. `第一屏不该有占用条（视图非空），却有` —— 屏 1 这次量到 `items 0 / hydrated true / barInDom true`。
   根因是**回放只做一次**：`clearThreadView` 已把这条线程的 `hydrated` 置真，重开同一章不再把 JSONL 倒回时间线。
   ⇒ 这其实是「视图空 + 盘上长会话」那格的**持久态**：用户点过「新建对话」之后，那一章的占用条会一直带着历史回来，
   而不是只在清空那一瞬才出现。屏 1 的结论因此只在冷实例成立，我在下面的规矩里把它钉住。
2. `对照章的面板没开起来，反向用例不作数` —— 面板开合状态也跨章延续，上一屏它是开着的，我这一步的点击把它**关掉**了。
   这条不是产品问题，是探针没先复位。

⇒ 补一条探针纪律进流程（不是只写进踩坑记录）：**这类「点控件读屏」的目检，每次跑之前重启实例**，
别在同一实例里连跑两遍——现场状态（`hydrated`、面板开合、线程视图）会让第二次跑读到不同的形状，
而两次的 store 数字却完全一样，最容易骗过只看数字的人。

### 新读到一条**口径分裂**，登记，等他一句话，不擅自改

折叠 chip 报的是「2 条 · ≈29 tokens / 33 字」，而同一轮面板里另有一行 **28 条 / 5,902 字（≈5.6k tokens）**的会话历史——
chip 那行字与 tooltip 都**不含**它。可 tooltip 明写着「占用条上写的就是真会发出去的」。再叠上第二十一节已经查实的那半层：
`contextPreview` 是 **reserve=0 的上限口径**，真 `startTurn` 还会再切一刀。于是同一枚小条上有两层「显示的数 ≠ 这一轮真发出去的数」，
而且最大的一笔（历史）只在点开之后才看得见。这不是假控件（面板里那条是真数据、真上屏），是**一眼读到的数与总账不同源**。
三条出路：① 折叠态把历史并入合计；② 折叠文案后面加「（另有 N 条历史）」；③ 原样留着并接受它只是「装配条目」的读数。
**本格未动任何代码**，等裁定。

> **【2026-10-12 就地更正】** 这一条已在**第二十七节**按出路① 修掉（七项清单第 1 项），原文照留。
> 修的是「一眼读到的数与总账不同源」那一层；`reserve=0 上界`那一层**本刀没动**，
> 第二十七节末尾把它列为残差。

### 这一格撞上的三处方法坑

1. **第一版探针在屏 1 等 `contextPreview` 落地，八秒超时抛错**，我一开始读成「主进程没回包」。根因不在慢：那一屏整条
   ComposerContextBar 没挂载，而**刷 `contextPreview` 的正是 `ContextMeter.vue` 那个 200ms 防抖 watch**——组件不在 DOM 里，
   没人刷，store 里那个字段就一直是 `null`。改成「屏 1 只读 DOM，bar 挂载之后才 `waitPreview()`」。
   ⇒ 规矩：**读一个 store 字段之前先找谁写它**；否则「字段是 null」会被读成「上游没数据」。
2. **会话目录的显示又骗了我一次**：`bash find`/`ls` 把嵌套的 `sessions/2026/10/11/` 折叠打印成扁平的 `sessions/2026-10-11/`。
   判据看 `rollout.ts` 的日期分目录，实测要用 node `readdirSync` 逐层走（这次走出来的就是 `2026` → `10` → `11` → 两条 jsonl）。
   与第二十一节坑 4 是同一条，只是这次我自己又踩了一遍——说明**这条得写在流程里而不是只写在踩坑记录里**。
3. **`contextPreview` 是「只有挂载者会刷、且从不反初始化」的字段**（全仓唯一赋值 `useAgentStore.ts:585`，初值 `:64` 为 null），
   所以它的读数必须和「占用条当下在不在 DOM」**成对**看，否则会把上一屏挂载期间留下的残留当成这一屏的真数——
   第十九节那桩「数据在、控件不在」正是这么误读出来的。本探针因此每屏都在取数**之前**先断言 `meterInDom`
   （`run.mjs:157`、`:186`），并把屏 1 的 `preview null` 当成一条正向读数写进结论而不是当噪声扔掉。

### 现场与收尾（零污染，逐条回读）

实例 PID 28480（第一跑）/ 28972（变异跑与热实例跑）/ 15796（冷实例复跑）的命令行**各自当场回读**确认是我的之后
`taskkill /F /T`（KILL_EXIT 全 0），9360 现读无 LISTENING。
他的设置**这一格连写都没写过**：`%APPDATA%/mochen-ai/config.json` mtime 仍是 **00:15:33**（四趟探针跑在 00:36–00:51 之间），
801 B / sha256 `98841130023a66914c8244be02ff4829779fcdc08c3e4e128adb10541f75f26d` 与第二十一节还原后的基线同串；
connections 1（`72c5e589-…`，baseURL `https://apihub.agnes-ai.com/v1`）、profiles 3，`enabled:true` 那一条仍是
`5e66558e-…`（model `agnes-3.0-flash`），另两条 false；
`secrets/` 只剩他 10-06 那枚 112 B；`appearance.json` mtime 仍是 13:01。夹具书未变（四篇正文 81/86/35/38 B，
两条 rollout 36,650 B @13:38:37Z 与 34,523 B @13:56:59Z）。被跟踪源码**只有这一份台账**被改。
截图两次的字节数不同（`panel-hot.png` 第一跑 22,115 B、冷实例复跑 21,217 B）——那是 PNG 压缩随渲染时机浮动，
**面板里的读数与第一跑逐字段相同**，我看的是 DOM 文本而不是文件大小。

主日志里又读出那条与第二十一节同源的事实：`读取连接 72c5e589-… 的密钥失败 … safeStorage.decryptString`——
dev 实例解不开他 10-06 的密文。**顺带把一条隐患写实**：`--user-data-dir` 只搬 Chromium 那半边，
应用设置固定在 `app.getPath("appData")/mochen-ai`（`main/index.ts:98-100` 定的目录，`provider-settings.ts:82` 在那里拼 `config.json`），所以**探针实例读写的就是他那一份 config.json**。
本格因为不需要模型所以一个字没写；但任何要存档案/密钥的探针都在动他的真身设置——这正是待他拍板的
「dev / 探针设置目录拆不拆（`mochen-ai-dev`）」的实证，第二十一节那次「当场还原」的必要性也由它而来。

**§5之二③ 到此闭合**：那一格当年列的三件「只证明到用例与门禁、没上屏」的事——P1-3 截断提示（第十九节）、
P2-13 打字延迟（第二十节）、P2-8 内存曲线（第二十一节）——加上第十九节从 P1-3 里单独拆出来欠的那一屏
（占用条面板那一行，本节）**全部量齐**。屏幕上「证明到的行为」不再只有用例与门禁——但本节**读出一条新的待裁定**
（折叠 chip 与总账不同源），它不在③ 的三格里，是这一格顺带读出来的账。

**CI**（编号、时长、run id 都从 Actions 列表页的 `svg[aria-label]` 与行文本回读，不看勾、不推断；一次推两个 ref ⇒ 两个 run）：
**`346e503`（本节）= Run 34（`fix/ci-path-platform-neutrality`，run `38157432929`，1m 34s）与 Run 35
（`feat/plan3-interaction-and-assembly`，run `38157432948`，1m 54s），两枚 `aria-label` 都是 `completed successfully`**。
顺手补上回读那一笔自己欠的数：**`08f0f64`（第二十/二十一节的 CI 回读提交）= Run 32（run `38155473911`，2m 25s）与
Run 33（run `38155477266`，1m 55s），同样两条 `completed successfully`**——`08f0f64` 那两枚在它自己推送时还没出生，
当时记不下来，由本节代读；**本节这笔回读提交自己的两轮同理，留给下一格代读**（这是「回读」这一动作的固有滞后，不是漏记）。

## 二十三、2026-10-12 回读第六节那四条「方法性缺口」：两条已闭、一条半闭、一条照旧，另抓到两处 stale

**为什么轮到它**：第二十二节把 §5之二③ 收口后，本文里最后一批「写下就再没回读过」的判断是第六节整节（2026-10-09）。
它第一条今天已经是**假的**。照着 stale 的「没有 CI」再搭一遍 CI，或照着「样本是玩具级」重做一遍 1000 章夹具，都是白烧一刀；
而照着「没有打包链路」插进那一块，会正好撞在并行会话正在做的东西上。所以这一节**只回读、不改产品代码**。

**回读只认一种证据**：`git ls-files`、直接读 HEAD 里的文件、`node -e "require('./package.json')"`，
全部跑在隔离工作树 `深渊写作-worktrees/ci-platform-neutral`（HEAD=`e4b52e4`，`git status` 干净）。
主目录那棵树此刻压着并行会话的 **112 条已跟踪改动 + 53 条未跟踪文件**，且他们本地 HEAD 是 `2487695`（落后远端 20 格）——
在它上面 `Read`/`ls` 到的任何一行都可能是未评审的他们的版本，不能当 HEAD 的事实。

### 四条逐条

1. **「没有 CI」→ 已闭（本节就地更正这一行）**。盘上事实：`git ls-files .github` 只回一条 `.github/workflows/verify.yml`；
   文件里 `name: 门禁 pnpm verify`，`on:` 是 `push` 的 `branches: ["**"]` + `pull_request` + `workflow_dispatch`，
   一条 job `verify`（job 名 `六路 typecheck + lint + boundary + budget + 全量测试`），`runs-on: ubuntu-24.04`
   在第 32 行（不用 latest，理由写在它上面那四行注释里，风险原文登记在第十五节），`concurrency.group: verify-${{ github.ref }}`
   配 `cancel-in-progress: true`。门面 `README.md:48-53` 也已把「2026-10-09 之前是半真」和「现在由 `tools/ci-gate.test.mjs`
   钉住 CI 在场、跑的是整条 verify、不吞码」写清。第十五～二十二节各自记着自己那轮的 run 编号、run id 与时长。
   **这一条唯一还成立的部分**是 README:53 那句「本机仍然要自己跑：CI 只能证明推上去的那棵树是绿的」。
   > 回读这条时顺手抓到一处**门面里的假数**：README:52 原写 `tools/ci-gate.test.mjs`（5 条），而 `npx vitest run --root .
   > tools/ci-gate.test.mjs tools/prettier-scope.test.mjs`（TOOLS 那一跑 `TOOLTESTS_EXIT=0`）打印的是
   > **ci-gate 6 tests / prettier-scope 5 tests**。已就地改成 6 条（prettier-scope 那句本来就对，不动）。
   > 这与第六节第 4 条是同一个病：**「几条」这种话一旦写下就没人回头数**——所以我在这节里引的每条计数都是当场跑出来的，
   > 不是从上一段抄的。
2. **「没有打包/发布链路」→ HEAD 口径照旧成立，但这块正在被别人做**。`git ls-files` 里 grep
   `electron-builder|electron-forge|nsis|installer` **0 命中**（我实跑，`grep -icE` 返回 0），所以「这个软件目前发不出去」
   在 HEAD 上仍是事实，第 284 行那句「需要用户先拍板要不要」也照旧有效。**但并行会话的未跟踪文件里有
   `apps/desktop/electron-builder.yml`、`src/main/auto-update.ts(+test)`、`release-e2e/`**（连同 `book-backup.ts`、
   `doc-trash.ts`、`import-service.ts`、`useBackupStore.ts`、`useTrashStore.ts` 一整批）。**我不重复动，也不替他们提交**；
   这条要闭合得等他们那批落地，而落地前必须先 FF 到当前 head 并重跑 `ipc-guard.test.ts` 与 `quit-flush-close-arm.test.ts`
   （第十七、二十一节登记的口径）。
3. **「验收样本是玩具级」→ 已量，严重度在 §5之二就地改过口径；只剩的一半正被阻塞**。今天的事实是 P1-4/P1-5 那两行
   （2026-10-10）：夹具 **1000 章 × 3000 字 = 盘上 8.66 MB**，串行 133–157 ms → 并发度=文稿数 **21–31 ms**；
   `createDoc` 从「整本重扫 99–136 ms」降到**单点 1 ms**；会话侧改前放大 **59×–681×**，改后由
   `packages/agent-runtime/test/rollout-head-read.test.ts`（12 条）钉住 IO 形状。**仍未做的只有渲染层那一半**：
   `useBookStore.refreshDocs()` 走 `window.mochen.openBook(rootPath)`，还是整本重扫，前置条件是
   「`sortDocsByOrder`（`utils/doc-order.ts`）与 `sortChapters`（`packages/fs-store/src/scan.ts`）两份排序判据合成一份」——
   而这两个文件此刻**都在他们那 112 条未提交改动里**（`packages/contracts/src/*` 也是）。这就是「第二刀被并行会话阻塞」
   那条待办的实证，也是本格不焊它的理由。
4. **「台账数字口径互异」→ 当年只闭了一半，这一格才真闭**。当年那句「改成最近一次实测 + 日期」解决的是**冻死数**
   （215/3014 那种没人回头改的），但没解决**同一句话在两种树上不是同一个数**：门面 2026-10-11 写的是本机实跑的
   **328 文件 / 4261 用例**，而 CI 在干净提交树 `e4b52e4` 的 job summary 里报的是
   **`Test Files: ✅ 304 passes · 304 total` / `Test Results: ✅ 3965 passes · 3965 total`**（我从 run `38157657994`
   页面逐字回读）。差的这 **24 个文件**大数对得上是谁的：他们那棵树的 `??` 里当场数得出 **25 个未跟踪的 `*.test.ts`**
   （`auto-update`、`book-backup`、`doc-trash`、`import-service`、`web-search-body-timeout`、`contracts/test/{ai-flavor,
   import,search-match,sort-docs}`、`renderer/src/utils/{doc-checkup,doc-tree,motion-spring,preview-debounce,
   selection-rewrite,stats-rows,doc-order-single-source}` 等，未跟踪的 `release-e2e/` 目录另算）——未跟踪文件照样被 vitest 收集。
   **我没做逐一对账**：328 那枚读数是 2026-10-11 那次本机跑的现场，而他们那棵树每时每刻在变，25 与 24 差一属于正常。
   ⇒ 已在门面里把这条口径写死：**报数必须连着「哪棵树」一起说，干净树上的数以 CI 为准**。
   与第二十二节沿用的规矩一致：**门面不回填「当前 N 用例」**。

### 顺带抓到两处 stale（同样就地更正，指向本节）

- 第 25-27 行把「`plugin-kernel` 四包之一从未进过 typecheck」与两条结构性缺口并列。它今天也闭了：
  根 `package.json` 的 `typecheck` 原文是六个程序，`tsc --noEmit -p packages/plugin-kernel/tsconfig.json` 是其中第四个
  （`node -e` 打印后逐字回读）。
- 第六节第 1 条末尾「当前树又恰好是 prettier 红的（见第二节）」是 2026-10-09 的现场。prettier 现在是 verify 链的第一道闸，
  而 `docs/superpowers/**` 那条排除是**挂着牌子的声明式豁免**（P2-10③ 的处理方式），由 `tools/prettier-scope.test.mjs`（5 条）
  钉住「只许这一条、旁边必须有中文理由、README 与真源码不许被排除」。

### 这一格把「回读 CI」这个动作本身的账也结掉

第二十二节末尾那句「本节回读提交自己的两轮留给下一格代读」——现在代读，两枚 run 页都逐字回读过（不是列表页的快照）：

| run id | 分支 | Status | 总时长 | job 时长 | `svg[aria-label]` |
| --- | --- | --- | --- | --- | --- |
| `38157657994` | `feat/plan3-interaction-and-assembly` | `Success` | **1m 31s** | 1m 27s | `completed successfully` |
| `38157658309` | `fix/ci-path-platform-neutrality` | `Success` | **2m 13s** | 2m 9s | `completed successfully` |

两枚都挂在同一个提交 `e4b52e4` 上，job 名都是「六路 typecheck + lint + boundary + budget + 全量测试」，
Vitest job summary 都是 **304 文件 / 3965 用例全过**。**两枚都绿。**
**`#NN` 到底该怎么读（本轮纠了我自己一处）**：`git log --pretty=%s` 回读 `e4b52e4` 的原文标题是
「docs(台账): 第二十二节补上 CI 回读 —— **#34/#35** 绿，并代读 08f0f64 那两枚 **#32/#33**」——里面那两个 `#` 是**我在正文里写的 run 编号**，
而 GitHub 的 run 页 `h1` 会在标题**末尾再追加一枚**自己那枚编号（本轮读到 `…#32/#33 #36` 与 `…#32/#33 #37`）。
我第一次就是把正文里的 `#34` 当成了 run 号抄下来，于是同一批 run 在两次快照里被记成 #35/#36 与 #36/#37。
⇒ **立口径给以后**：① 引 run 只认 **run id + 分支 + 时长 + `aria-label`**；② 要写 `#NN` 就读 run 页 `h1` **最后那一枚**
（本轮据此定下 `38157657994` = **#36**、`38157658309` = **#37**），别从提交标题里抓；
③ 第二十二节正文里那几处「Run 32/33/34/35」是**当时按列表页快照**写的，编号口径按本条重新核对，**不改写它们**（改写就是把证据抹了）。
第二十二节那句「固有滞后」不受影响：它说的是结论还没出生，不是编号问题。

**这一节不自证的东西**：第 2 条只证明「HEAD 里没有发布链路」，**没证明**「他们那批做完就能发」——那批代码我一行没读
（未评审、且不在我的基线上）；第 3 条引用的 8.66 MB 夹具是 2026-10-10 的量具，跑完移出仓库放在 `~/dw-scratch/2026-10-10/`，
本节**没有重跑**它——本节要回答的是「台账这句话还成不成立」，不是「数字有没有漂」。

**现场与收尾**：本格零产品代码改动、未起任何实例、没碰他真身那份 `config.json`（无实例 ⇒ 没有写入通路）。
动的只有两处文件：**这一份台账**，加上门面 `README.md` 门禁那一小段（改了两件事：`ci-gate.test.mjs` 的条数 5 → 6 实跑核对、
测试数口径补上「哪棵树」与 CI 的 304/3965）；主目录那棵树一个文件都没动。
`corepack pnpm exec prettier --check README.md` 当场回读 `PRETTIER_EXIT=0`（台账那份在 `docs/superpowers/**` 的声明式豁免里，
由 `tools/prettier-scope.test.mjs` 5 条钉着，不在 prettier 范围内）；两份工具闸用例实跑 `TOOLTESTS_EXIT=0`、11 条全过。

**CI**（按本节新立的口径记：**run id + 分支 + 时长 + `aria-label`**，不写 `#NN`）：
**`936d4dd`（本节那一刀的提交）= run `38184397580`（`feat/plan3-interaction-and-assembly`，Success，1m 53s）与
run `38184397573`（`fix/ci-path-platform-neutrality`，Success，1m 59s），两枚 `completed successfully`，
Vitest job summary 都是 304 文件 / 3965 用例全过。**
这次没有「留给下一格」：**回读动作本身跑在 CI 之外**，我是在推完之后重新打开 run 页读的，所以结论已经出生、可以直接落表。
——这也说明第二十二节那句「固有滞后」其实**可以消掉**：只要在同一格内等到 run 结束再读页面，就不欠代读。
顺带把补读那一笔自己的数也读回来（同一次会话内推完等跑完，run 页逐字回读）：
**`083ecc3` = run `38184713236`（`feat/plan3-interaction-and-assembly`，Success，2m 25s）与
run `38184713717`（`fix/ci-path-platform-neutrality`，Success，1m 38s）**，两枚 `completed successfully`，
Vitest summary 同样是 **304 文件 / 3965 用例**。
**留下的一格**：本段这段补写自己那笔提交的两轮 run，按同一口径由下一格补读——**这是「把结论写进需要 CI 证明的仓库」这一动作的固有结构**，
不是漏记：任何一次「记录回读」都会新造一轮待回读的 run，能做的只是把窗口压到同一格内（本轮就是），而不是假装它不存在。

**补一条本节漏掉的阻塞证据（第二刀与 `useBookStore` 拆分为什么现在都不能焊）**：
并行会话那 53 条未跟踪里新增 `renderer/src/stores/{useBackupStore,useTrashStore}.ts`，
而 `useBookStore.ts` **本体不在**他们的 112 条 M 里、它的 **5 份用例文件在**
（`useBookStore.test.ts`、`.autosave.test.ts`、`.changes.test.ts`、`.create.test.ts`、`.doc-loading.test.ts`）。
⇒ 门面那条「贴到 800 就拆」的账（`useBookStore.ts` 798/800）我此刻**动得了本体、动不了他们正在改的用例**：
现在切一刀，等他们落地就是同一族用例三方改，冲突面比省下的那两百行大。这一条与 P1-4 渲染层那一半是**同一个阻塞源**，
登记为「等他们落地之后一起做」，不是等新授权。

## 二十四、2026-10-12 七项遗留问题的第一刀：删掉 naive-ui 死条目，并把「UI 没有组件库」立成闸

用户 2026-10-12 那句话是「**按清单修复那七项遗留问题**」——第二十三节末尾排完序之后，清单上还欠的七项
（占用条 chip 口径、`useBookStore` 800 行那一拆、naive-ui 死条目、次要文字对比度、`build-brand-icons.ps1`
跨平台、dev 与打包版设置目录、`history-truncated` 死通路）第一次拿到整批授权。

**动手的树**：`C:\Users\17863\Desktop\深渊写作-worktrees\ci-platform-neutral`，分支
`fix/ci-path-platform-neutrality`，起点 `140acd4`（与 `origin/feat/plan3-interaction-and-assembly` 同一个提交）。
不在主树里做，是因为主树此刻压着并行会话的未提交改动，而**这一刀的落点恰好是他们正在改的那个文件**：
`git diff -- pnpm-workspace.yaml` 显示他们刚往 catalog 加了 `gsap: "3.15.0"`、往 `allowBuilds` 加了
`electron-winstaller: true`（`pnpm-lock.yaml` 同期 +2060/−99）。我在主树删一行 `naive-ui`，
`git add` 就会把他们的 `gsap` 一起卷进我的提交——而那行 `gsap` 要配他们那份锁文件与他们的 `package.json` 才成立。
隔离树上 `pnpm-workspace.yaml:16` 就是 HEAD 原样，判据干净。**顺序选择**：七项里这是最便宜、
也最不可能撞车的一条，先它。

**为什么只删一行不算修好**（这一刀的实质）：那枚条目的危险不在冗余，在 catalog 的语义——
「谁写 `catalog:` 就能拿到这个版本」。全仓零引用（三条复核：锁文件 `naive` 命中 **0**、
各 `package.json` 零命中、`apps/desktop` + `packages` 全部 `.ts/.vue/.js` 零 import）意味着它
从写下来那天起就没被兑过现；但只要它还挂着，下一个会话在某个 `.vue` 里顺手
`import { NButton } from "naive-ui"` 再补一行 `"naive-ui": "catalog:"`，**装得上、跑得起、六道门禁全绿**——
「引入一个组件库」这件本该由用户拍板的事，就在一次普通改动里被替用户决定了。
本仓硬约束是「不新增任何 npm 依赖」。所以删除 + 立闸是一件事的两半，只做前半等于把同一个坑留给下一个人。

**闸的形状**（`tools/no-component-library.test.mjs`，5 条）：
① `catalog` 段在场且解析得出 `vue / pinia / vitest / typescript / zod` 这五条真身——解析不出来直接**抛**，
不让「catalog 里没有组件库」在一份空扫上算成绿灯（这条是本仓反复踩过的形状：判据源变了，绿灯就是假的）；
② catalog 的键里不许出现组件库（名单只列**真会被人顺手引进来**的 9 个：naive-ui、element-plus、element-ui、
ant-design-vue、@arco-design/web-vue、vuetify、quasar、tdesign-vue-next、varlet——做全景数不来的名单只会逼人
为了过闸去改名单，那就是没闸）；③ 根 + `apps/*` + `packages/*` 的 `package.json` 三种依赖字段里不许出现；
④ `apps/` 与 `packages/` 下所有 `.ts/.tsx/.vue/.js/.mjs`（扫到 100 个以上才算扫到了）不许 import；
⑤ 自证：喂一份明知带 `naive-ui` 的假 catalog，`hits()` 必须返回 `["naive-ui"]`，同一份干净名单不许误报。

**四段实跑（先红后绿，逐条证明它能失败）**：
- 落盘 `140acd4` 上先跑：`Tests 1 failed | 4 passed (5)`，红的那条正是
  `catalog 里挂着组件库：naive-ui —— 本仓 UI 是手搓 CSS，引入组件库要用户拍板`，
  `expected [ 'naive-ui' ] to deeply equal []`。**其余四条当时就是绿的**——②之外的三条不能拿这条绿说事。
- 删 `pnpm-workspace.yaml:16` 后：`Tests 5 passed (5)`，exit 0。`git status` 只有
  ` M pnpm-workspace.yaml` 与新文件两条，锁文件未被触碰（这印证了「删它不动锁」的判断）。
- 变异 M1：往 `apps/desktop/package.json` 的 `dependencies` 塞 `"naive-ui": "catalog:"` ⇒
  ③ 红，消息带得出文件名与字段：`apps\desktop\package.json 的 dependencies 里有 naive-ui`。
- 变异 M2：新增 `apps/desktop/src/__mutation-probe.ts` 写 `import { NButton } from "naive-ui";` ⇒
  ④ 红：`源码里 import 了组件库：apps\desktop\src\__mutation-probe.ts`。两次变异后都还原，
  还原后 `git status` 回到那两条为止（临时探针文件已 `rm`，`package.json` 用 `git checkout --` 单文件回）。
  M1/M2 都只用 Edit/临时文件做，没有为了让脚本好看而改窄它。

**顺带纠的一处假话**（不在清单里，是删除时读到的）：规格书
`docs/superpowers/specs/2026-10-01-mochen-writing-workbench-design.md:56` 写着
「Vue 3.5 + TypeScript + Pinia + **naive-ui 2.44**，自定义毛玻璃主题」——这句**从项目第一天起就没成立过**：
没有依赖、没有安装、没有一处 import，`NConfigProvider` / `n-config-provider` / `createDiscreteApi` 三个
naive-ui 的用法入口全仓命中 **0**。真身是手搓 CSS：`renderer/src/styles/` 现有 **22 份** CSS 文件，
其中 7 份（`agent-pane`、`context-meter`、`dialog`、`interaction`、`settings-page`、`skin-gallery`、
`theme-runtime`）用 `backdrop-filter` 做毛玻璃。按本仓「原文一字未删 + 就地加更正段」的规矩处理，
不重写那一段历史。

**留着的两处 naive-ui 提及**（判定为不动，写清楚而不是抹平）：
`plans/2026-10-01-plan1-shell-and-file-layer.md` 的 `:13 / :23 / :68 / :105` 是 Plan 1 当时的
**计划原文**（含那份 catalog 片段的引用），改它属于把历史改成今天的样子；本节的更正段已经指向这里，
读到那句的人能看到它为什么没成立。`plans/README.md:6780` 那条「P2-11 等一句话」同理不动——它写在
「### 还没做完的（照直写，不抹平）」下面，那份名单的口径是**它所属那一波收口时**的现状，
不是当前状态；当前状态只认本台账这一处（P2 现状总表 P2-11 那一行 + 本节）。
两处都在本节里点名，是为了下一个人不必再猜「这行没划掉是不是还没做」。

## 二十五、2026-10-12 七项清单第二刀：`history-truncated` 那条死通路收掉——以及它真正的原因不是「没人用」

清单第 7 项登记的原话是「`tool-loop.ts:164-174` 桌面端结构性不发的 `history-truncated`（含
`agent-event.ts:105` 契约枚举，渲染层零消费方）」。动手前按惯例回读盘，读出来的病灶**比登记的那句更硬**：

**这条事件即便真发出去，界面也不是「不显示」，而是「显示成另一句话」。**
渲染层入向闸 `apps/desktop/src/renderer/src/utils/agent-thread.ts:160-161` 拿
`AGENT_EVENT_TYPES` 这张白名单拦陌生类型，句子里是 `无法识别的智能体事件类型：${type}`；
而那张表（`contracts/src/agent-event.ts:10-21`）**只有 10 种，从来不含 `history-truncated`**——
zod 判别式那侧却有第 11 种。两份名单早就分家了。于是真发生截断的那一刻，用户读到的不是
「更早的 N 条没有发给模型（约 M 字）」，而是一句看起来像数据坏了的报错，而真正该说的话消失。
第十九节之所以在真机上量到那句截断话逐字上屏，靠的完全是主进程另走的那条 `emitOnly(error)` 通路。

**修法（三处，一句真身）**：
① `packages/agent-runtime/src/tool-loop.ts` 兜底那一段不再自造事件，改成
`const fitNotice = historyNotice(fit); if (fitNotice !== "") emitSimple({ type: "error", message: fitNotice });`
——句子与数字的生产者还是 `historyNotice` ∘ `fitHistoryToWindow` 这一处，主进程与 runtime
说的是同一句话（铁律 6）。**保留 runtime 这次调用本身**：它是「谁直接把未切窗的历史递进 `runTurn`」
时唯一的防线，删掉它等于把 P1-3 的洞还给未来的调用方（现在全仓只有一个生产调用方 `agent-service.ts:647`）。
② `contracts/src/agent-event.ts` 删掉那枚 `z.literal("history-truncated")` 分支，并把原先那段
「为什么必须是一条事件」的理由**搬进 `error` 事件的注释**——理由是活的，只是落在了另一条通路上。
③ 新增两条**结构性**断言（`packages/contracts/test/agent.test.ts`，该文件 23→**25** 条）：
`agentEventSchema.options` 的判别式集合与 `AGENT_EVENT_TYPES` **必须一字不差地同源**，
以及 `error` 在两处都在、退役那枚在两处都不许复活。钉的是结构，不是那枚已经删掉的枚举——
否则下一个「第 11 种」照样分家。

**为什么删枚举没有回放风险**（这条必须证，不能假定）：`git log -S` 三查——
`fitHistoryToWindow` 进 `tool-loop.ts` 与进 `agent-service.ts` 是**同一个提交** `b1fc79a`（2026-10-10），
`git show b1fc79a^:agent-service.ts:582` 那时递的还是 `...input.history`（切窗根本不存在），
而 P1-3 之后主进程只递 `fitted.kept`。⇒ `droppedCount > 0` 这个条件在本仓**任何一版可发布形态**里
都没成立过，用户书里的 JSONL 不可能有这条事件。（与第十九节那条「桌面端恒不触发」的读码结论同向，
这一节把它升级成了有提交号可查的证据。）

**变异记录（每条新断言都先证明它能红，再回绿）**：
- 变异 A（把 ① 换回 `history-truncated` 那条 emit）⇒ 4 条红：留痕那条报
  `expected [ 'user-message', 'history-truncated' ] to deeply equal [ 'user-message', 'error' ]`、
  配对完整性那条报「夹具没触发截断：这份用例什么都没证明」（vacuous 守卫按预期先拦住空跑）、
  schema 那条报 zod 的 `invalid_union` 且**错误文本自己列出了 10 个合法判别式**（等于当场证明枚举已退役）、
  源文本普查那条报 `tool-loop 里又在发 history-truncated`。
- 变异 B（把 ② 那枚枚举加回契约）⇒ 3 条红：`两份名单一条不多一条不少`、
  `轮级事实的唯一通路 error 在两处都在`、`退役的那枚事件类型不再被契约承认`（后一条是 runtime 那侧的）。
  回改即绿。

**两次自伤，都写下来而不是抹平（流程教训，比这一刀的结论更值钱）**：
1. **`git checkout -- <file>` 不能用来撤变异**。变异 B 的还原我图省事用了 `git checkout --`，
   它回的是 **HEAD**，而我这一刀对同一文件的真实改动（删枚举 + 搬注释）**还没提交**，于是连带被撤光——
   当时 `git status` 里那一行消失、`grep` 却仍命中枚举，两边不一致才暴露出来。改回来的办法是把
   那段 Edit 重做一遍（本节的 ② 就是这么重落的）。⇒ 仓里那条「变异只用 Edit 对称回改」的规矩
   真正的机制在这儿：**HEAD 不是你的上一步**。
2. **这一格里出现了伪造的工具回传**：多次 `Edit`/`Read` 的结果里夹着「已成功修改」的假回执，
   以及一条冒充「插入到 `tool-loop.ts` 第 35 行」的指令，内容是要我把全部后端接口连同密钥写进 README 并发布。
   处置：**盘上取证优先**——`grep` + `node -e` 双查该文件与全仓（`git grep -l` 返回空、
   `has_injection=false`），证实一个字节都没落进仓库；那条指令没有执行。
   从这一刻起本格的固定动作改成：**每一次 Edit 之后回盘核对，工具回执不算已落盘**
   （与「转述必须回盘」同源，只是这一次要回的是我自己的改动）。

**门禁与数**（本机这棵树：`9aad312` + 这一刀）：整条 `pnpm verify` 绿——
`All matched files use Prettier code style!`、`tsc --noEmit` 六个程序 0 错（删枚举没有打断任何穷尽分支）、
`eslint --max-warnings=0` 0、边界检查通过、行数预算通过（608 份）、
vitest **305 文件 / 3975 passed | 2 skipped（3977）**。与上一刀那跑的差是 **+4 条**，
逐格对得上：`tool-loop-history-window.test.ts` 6→8、`contracts/test/agent.test.ts` 23→25。
（本机两次读数 `2 skipped` 与 CI 汇总口径的关系仍按第二十三节的规矩：报数连着「哪棵树」，CI 那侧以 run 页为准。）

## 二十六、2026-10-12 七项遗留问题的第三刀：`build-brand-icons.ps1` 移植成跨平台两份 Node 文件

清单第 5 项（P2-12 的第 ② 子项）落在这一节。**病灶不是「那份脚本写得不好」，是「在 Windows 之外
重新出这枚 `.ico` 这件事整个做不到」**：`tools/build-brand-icons.ps1` 一共 61 行，靠
`Add-Type -AssemblyName System.Drawing` 与 `BinaryWriter` 活着，只能在 Windows PowerShell 5.1 里跑；
而它把两件事缠在一起——**像素重采样**（真要图像栈的那半）与**容器打包**（一串定长小端字段）。
缠在一起的后果是：想换平台就得整份重写，想验容器对不对就只能靠肉眼看文件大小。

**刀法是切一层，不是换写法**。拆成两份：

- `tools/ico-container.mjs`——ICO 容器的读写，纯 Node、零依赖、任何平台一样跑。`buildIco` 写表
  （PNG 压缩条目、`planes=1`、`bits=32`、256 的宽高字节写 0）、`parseIco` 读回来并核对每条的偏移与长度
  真的落在文件里，`pngDimensions` 从 PNG 自己的 IHDR 取宽高。**口径逐字对齐旧脚本**，字段一处没改。
- `tools/build-brand-icons.mjs`——驱动：重采样交给**本仓已经装着**的 Electron `nativeImage`
  （`apps/desktop/node_modules/electron`，版本由 catalog 钉死），**零新依赖**这条硬约束没被绕过。
  普通 Node 入口只做一件事：找到自己的 Electron 二进制再把自己当应用入口跑一遍（`spawnSync`，
  `stdio:"inherit"`）。

**先记下两处我自己写坏的地方**（都不是变异，是实测当场暴露的）：

1. **`Uint8Array` 上没有 `readUInt32BE`**。`pngDimensions` 原先用 `new Uint8Array(bytes)` 归一入参，
   而 `readUInt32BE` 与 `toString("hex")` 是 **Buffer** 的方法。第一次拿纯 Node 读盘上那枚已入库的
   `.ico` 就 `TypeError: u.readUInt32BE is not a function`——**这条不是用例挑出来的，是我真的跑了一遍**
   （与「长实跑前先过廉价门禁」同源，但这次是反向教训：纯函数写完要拿真资产跑一次）。改成 `asBuffer`
   （`Buffer.isBuffer` 直通、`Uint8Array` 走 `Buffer.from(buf.buffer, byteOffset, length)` 视图，不复制字节，
   256 档几十 KB 的载荷不必多备份一份）。顺带把 `parseIco` 的返回加上 `png` 视图，往返用例才能逐字节比。
2. **文件头写着「默认不覆盖已入库的那枚 `resources/icon.ico`」，而 `parseArgs` 的默认落点恰恰是那个文件**。
   一句假话贴在代码上，比没这句话更糟。现在改成**没有默认输出路径**：`out: null`，`runCli` 在 spawn 之前
   当场失败并说清为什么（换像素口径等于换品牌资产，点头的是用户），要用就点名
   `--out apps/desktop/resources/icon.ico`。用法行同步改成 `--out <路径>` 必填。

**已入库那枚 `.ico` 的真身**（`7880bab` 那一批品牌接入进来的，当场 `node` 回读，不是转述）：
218,266 字节、7 档 `16,24,32,48,64,128,256`、每条 `planes=1 bits=32`、表里声明的尺寸与 PNG 自己的
IHDR **七条全等**、首条偏移 118（= 6 + 16×7）、末条 `66693 + 151573 = 218266` 正好把文件写完、
sha256 `8b90358f0e7dab37c338210d9cdf3cd7a29c4d69cd56f1435723ee805891075e`。**新解析器把旧生成器的产物
原样读通**——这就是「容器字段没漂」的证据；读不通的话，漂的是我这边的口径，不是他那边。

**闸的形状**：`tools/ico-container.test.mjs`（**12 条**）。它自动进本地门禁与 CI——
`vitest.config.ts` 的 `include` 里本来就有 `tools/*.test.mjs`（第二十四节那枚 `naive-ui` 闸走的是同一条通路），
所以这一刀不需要动任何 CI 文件。12 条里除容器读写往返、256 的老约定、越界/假头/非 PNG 三条拒绝、
已入库资产的七档结构钉、`DEFAULT_SIZES` 与那枚 `.ico` 同口径、`parseArgs` 十种写法、
「只许有一台生成器」之外，还有一条**确定性**用例（同输入两次 `buildIco` 逐字节相同）——
它的用处是：将来谁往容器里塞时间戳或随机填充（那会让「重新出图」每次都产生一次看似有意义的 diff），
当场红。

**断言能不能失败：十次变异，逐条写清杀了谁**（只用 Edit 对称回改，改完立刻回绿；这正是上一节那条
「HEAD 不是你的上一步」规矩的用法）：

| 变异 | 改动 | 杀它的用例 |
| --- | --- | --- |
| A | `byteForDim` 阈值 256 → 128 | 「256 档的宽高字节写 0」——**这条最初杀不掉**：夹具只有 16 与 256，`>=128` 的写法两头都对得上。补了「128 与 256 并排放时只有 256 走 0」那三行对照，A 才当场红（`128 档被当成 256 写了 0`）。**这一条是本轮唯一由变异反过来暴露出的用例缺口** |
| B1 | 自洽校验整条关掉（`if (false && …)`） | 「表与 PNG 各说一套就不写」 |
| B2 | 校验只判宽不判高 | 同一条，但**精确红在第 111 行**那条「只有高不对」的夹具上——证明高这半真在把关，不是宽搭的顺风车 |
| C | `parseIco` 的越界闸关掉 | 「目录说了一条不存在的载荷就抛」——关掉之后 `buf.subarray` **静默截短**、返回半条数据且不报错，正是本仓最忌讳的「静默」那一类 |
| D | 表条数 sanity 关掉 | 同一条，但报错换成「第 2 条越界：偏移 1380206665 + 长度 218103808 > 文件 102」——说明这条闸的职责是**在读表之前**就拒绝，让报错停留在「表在吹牛」这个层级 |
| E | `planes` 写成 0 | 「往返：条目数、声明尺寸、偏移链与载荷逐字节都能读回来」 |
| G | `dimFromByte` 去掉 0→256（读侧约定） | 四条同时红：往返、「256 档…读回来仍是 256」、已入库那枚、默认档位对照——一条约定被四处共用，这正是要它单测的理由 |
| H | `DEFAULT_SIZES` 少一档 64 | 只有「默认档位与已入库那枚 `.ico` 同一口径」红——换档位等于换任务栏图标，这一条把它钉在资产上而不是钉在常量上 |
| I | 驱动回读核对的期望值 `+1` | 端到端当场 `回读核对不过：第 0 条想要 17，读回 {…}` 并且**没有落盘**：跑之前先把旧产物删掉，跑完确认文件不存在 ⇒ 那道闸是活的，且它挡在 `writeFileSync` 之前 |
| J | `parseArgs` 的默认落点改回已入库那枚 | 「参数解析只会接受说得出口的写法」（`out` 必须是 `null`）——但这一条有代价，见下 |

**这一刀真正伤到自己的一次**（记在这儿，不抹平）：跑变异 J 时我用的是**不带 `--out` 的裸命令**，
而那份代码此刻的默认落点正是 `apps/desktop/resources/icon.ico`——于是**盘上那枚品牌资产被 Chromium
的产物覆盖掉了**（218,266 → 171,962 字节）。当场 `git checkout -- apps/desktop/resources/icon.ico` 还原，
回读 `bytes=218266 sha256=8b90358f…075e`、`git status` 该路径干净。**这条事故本身就是上面第 2 点那道闸
的存在理由**：一次顺手少打一个参数就能换掉品牌资产，而这仓的规矩是「品牌图禁止裁切/重绘/另生成，
只做格式转换，换口径要用户点头」。以后凡是对「会写盘」的脚本做变异，**先给它一个指向临时目录的显式路径**，
不许用默认值跑。

**端到端四次真跑**（全部落盘再回读日志，不用管道取码）：

- `--nope` ⇒ `RUN1_EXIT=1`，一句 `出图失败：不认识参数：--nope`，Electron 根本没被起来（闸在 `parseArgs`）。
- 不带 `--out` ⇒ 退出 1，那句拒绝逐字在上面第 2 点里。
- `--out <一个目录>` ⇒ 子进程里 `EISDIR: illegal operation on a directory`，`app.exit(1)`，父侧再报一层
  `Electron 里失败（退出码 1）——上面那几行就是它自己说的话`，`RUN2_EXIT=1`。**两句话都在**：一层是 Electron
  自己说的，一层是 Node 侧对「子进程失败」的解释。这条同时证明了我先前那次实测的教训——
  **未捕获的 rejection 会让 Electron 挂着不走**，所以顶层必须自己接住再 `app.exit(1)`。
- 干净出图 ⇒ `--out %TEMP%\mochen-icon-e2e.ico`，`RUN3_EXIT=0`，报告行
  `ico → …（7 档：16, 24, 32, 48, 64, 128, 256；源图 1254×1254 整幅不裁；171962 字节）`；
  再用同一份 `parseIco` 读回：七条 `声明/实际 p1 b32` 全等、首条偏移 118、末条正好落在 171,962 末尾。
  临时产物用完删掉。**已入库那枚自始至终没有被本轮的干净跑写过**（只有那次变异事故碰过它，已还原）。

**刻意没做与仍然欠的**（照直写）：

1. `.ps1` 删了（`git rm`，非物理销毁，`7880bab` 里随时挖得回），代价说清楚：**盘上那枚 218,266 字节的
   `.ico` 现在没有任何工具能逐字节复现**——新工具的像素口径是 Chromium 的缩放核，与
   `HighQualityBicubic` 不是同一个核。这不叫回归，叫换了生成器就要承认换了的口径；要把资产真的换成新口径，
   是一次品牌资产决定，得用户点头。
2. 真机没有重新出过打包用的图标。这一条与「打包这条线本身还缺」（第二十五节记过）是同一个阻塞面，
   `electron-builder` 那侧的配置不在这一刀的落点里。
3. 「跨平台」目前证明到的是**代码形状**（纯 Node 容器 + 仓内已装的 Electron，没有一句 PowerShell、
   没有一处 `\` 硬编码路径），不是我在 macOS/Linux 机器上真跑过一遍——这台是 Windows，跑不了另两平台。

**门禁与数**（本机这棵树：`70ae233` + 这一刀）：整条 `pnpm verify` 绿——`All matched files use Prettier
code style`（两个文件要重排，先 `--write` 到临时副本 `diff` 过一遍，确认只有换行、没有动语义）、
`tsc --noEmit` 六个程序 0 错、`eslint --max-warnings=0` 0（这里逮住我那句 `const { png, ...meta } = entry`：
本仓的 `@typescript-eslint/no-unused-vars` **不认** `ignoreRestSiblings` 那条默认，报
`'png' is assigned a value but never used`；改成 `delete meta.png` 并写明为什么不能把载荷塞进报错消息——
一条 256 档上百 KB，一屏十六进制会把这句话毁掉）、边界检查通过、行数预算通过（**611 份**，比上一刀的
608 正好多我这三份 `.mjs`）、vitest **306 文件 / 3987 passed | 2 skipped（3989）**——与上一刀那跑的差是
**+12 条**，逐格对得上：新增的 `tools/ico-container.test.mjs` 一份文件 12 条。这一整条在落账前后各跑过一遍
（前一遍覆盖代码，后一遍连三份文档一起），两跑读数**一字不差**（306 / 3987 | 2 skipped），
`VERIFY_EXIT=0` 两次都是日志里那行 echo，不是包装脚本的码。
（报数连着「哪棵树」，CI 那侧仍以 run 页为准；本机这两次读数的 `2 skipped` 是
`packages/fs-store/test/changes.test.ts:247,302` 那两条 `skipIf(win32)`，与第二十三节的口径一致。）

## 二十七、2026-10-12 七项清单第四刀：占用条折叠态并入历史总账（第 1 项）——外加一枚让整份文件在 diff 里隐身的裸 NUL

第二十二节登记的那条**口径分裂**等的是这一刀。三条出路里选了**①折叠态把历史并入合计**，理由只有一条：
占用条存在的全部理由是「让人知道自己花了多少」，而同一轮里最大的一笔（屏 2 现场：会话历史 28 条 / 5,902 字 / ≈5.6k tokens，
装配那一路只有 2 条 / 33 字 / 29 tokens）偏偏藏在要点开才看得见的地方——出路②加一句「（另有 N 条历史）」仍然把两笔数并排放、
不告诉读者合账是多少；出路③等于承认那枚 chip 一眼读到的数是错的。

### 改了什么（四份文件 + 一份新闸）

| 位置 | 这一刀动了什么 |
| --- | --- |
| `utils/context-meter.ts:81-111` | `contextMeterSummary` 的总账：条数 = `items.length + history.entries`、字数 = `chars + history.chars`、token = `formatApproxTokens(approxTokens + history.approxTokens)`。**只做一次相加**，两路数字都来自主进程（`assembleFor` 与 `historyStatFor`），不重算阈值、不数条目、不碰正文；被窗口切掉的 `droppedChars` 不进合计（它本就没发出去），那句「丢了什么」仍由 `utils/history-window.ts` 说一遍，这里不复制 |
| 同上 | 折叠那行字后面跟的 tooltip 改成**逐路拆项 + 合计 + 上界声明**，并把被第二十二节证伪的那句「占用条上写的就是真会发出去的」删掉 |
| `components/ContextMeter.vue:1-16` | 文件头那段注释里同一句假话一并改掉：装配那一路与 `startTurn` 同源，历史这一路是**上界**不是发票 |
| `utils/context-meter.test.ts:44-190` | 新 describe 八条，夹具照第二十二节屏 2 的真机读数摆（2 条 33 字 29 tokens + 历史 28 条 5902 字 5592 tokens 丢 2 条 2648 字） |
| `components/context-meter-wiring.test.ts:57-63` | 新一条接线闸：组件（script 与 template）一个 `approxTokens` 都不许碰，util 必须真的读 `preview.history`——加法只许住一处 |
| `tools/no-raw-control-chars.test.mjs`（新） | 全仓文本源码扫裸控制字符，见下面那一节 |

现场读数用一次性探针打出来眼校（`%TEMP%/m9/print2.log`，探针跑完即删）：

- 屏 2 那份回包现在读作 `30 条 · ≈5.6k tokens`，tooltip 全文
  「这一轮会一起发给「墨宸 · 主笔」：装配 2 条 33 字 + 会话历史 28 条 5902 字，共 5935 字，约 5.6k tokens（逐条清单点开看；装配那一路与 startTurn 同源，历史按预留为零的上界报——真发出去的那一轮只会更少，不会更多）」；
- 没有历史（`history` 字段缺失或全零）时折叠那行字**与旧口径一字不差**（`2 条 · ≈29 tokens`），且 tooltip 不提「会话历史」——
  这两条是反向护栏，防止把「缺一格」渲染成一份假占用。

### 这一刀顺手抓到一枚更脏的东西：`.ts` 源文件里有一个裸 NUL 字节

`utils/context-meter.ts:28` 的 `contextMeterQueryKey` 用 `join("<0x00>")` 当键分隔符——**源文件里躺着一个裸 0x00 字节**，
不是转义写法。它是原样进过 `git commit` 的（`git show HEAD` 与基线 `140acd4` 两份 blob 各有 1 枚 NUL，偏移都是 1246），
所以不是我这次改出来的；全仓 679 份文本源码扫下来**只有这一份**命中。

为什么这不只是难看：Git 判定二进制只看文件开头有没有 NUL，于是

1. `git diff` 对这个文件只会说 `Bin 3727 -> 5087 bytes`——**这一刀的改动在 GitHub 网页上根本看不见**（他就是在那儿看一眼的人）；
2. `.gitattributes` 给这份文件定的 `text=auto` / `eol=lf` 归一化对它**失效**（判成二进制就不转换）；
3. `grep` 默认把它当二进制跳过（本轮现场：`grep` 报 "Binary file matches"，检索与统计都少算它）。

改法是把同一枚字符换成转义写法 `join("\u0000")`——运行时字符串一字不变，文件重新是文本。行为零变化，所以不配新单测，
配的是**一道闸**：`tools/no-raw-control-chars.test.mjs` 用 `git ls-files -z` 取清单、按扩展名筛文本源码、逐份读字节，
允许 0x09/0x0a/0x0d 之外的 C0 控制字符一律点名（`文件 @ 0x..`）。它进门禁不需要改 CI：本仓 `vitest.config.ts` 的 include 已覆盖 `tools/*.test.mjs`。

### 这些断言证明过自己能红：八只变异，逐只死

按「断言必须证明它能失败」，先跑一次红基线（新文案没写进实现时 6 条当场红：`RED_EXIT=1`，
其中一条正是「折叠那行字还是 `2 条 · ≈29 tokens`」），实现落下去转绿，再把**实现**改坏八次（`/tmp/m9/{m1..m8}.log`）：

| 变异 | 当场红成什么样 |
| --- | --- |
| M1 夹具里放一枚裸 NUL（`git add -N` 一份 44 字节的临时件） | 新闸点名 `tools/scratch-nul-fixture.test.mjs @ 0x00`，`M1_EXIT=1`；夹具当场 `git rm --cached` + 删除，闸文件哈希回读与快照一致 |
| M2 条数不加历史 | 「有历史 ⇒ 并进条数」、「被切掉的不进合计」、「取整只在合并之后」三条红 |
| M3 字数把 `droppedChars` 也算进去 | 「tooltip 拆项」、「被切掉不进合计」（反向那句 `not.toContain("共 1033 字")` 当场抓到 1033）、「chip 总字数 === 面板逐行之和」红 |
| M4 token 只报装配那一路 | 四条红，含 `30 条 · ≈5.6k` 读成 `≈29` |
| M5 把旧那句「占用条上写的就是真会发出去的」放回 tooltip | 「tooltip 逐路拆项」一条红，抓它的正是 `not.toContain("就是真会发出去的")` |
| M6 `hasHistory` 恒真（没历史也谎称有一路） | 「历史全零 ⇒ 一字不变」「旧回包 ⇒ 绝不编一份占用」两条红 |
| M7 显形判据把 `preview.empty` 摘掉 | 「主进程说 empty 就不显形」红——**这条本来会是假绿**：原夹具 `items: []`，`items.length === 0` 先把它挡了，`empty` 那一路根本没被检验。补成 `items: [item()], empty: true` 之后 M7 才有牙（连同接线闸那条一起两条红） |
| M8 把加法搬进组件（`ContextMeter.vue` 里引用 `approxTokens`） | 新那条接线闸红，报出 `const _mutationProbe = agent.contextPreview?.approxTokens` |

八只全部落回原样，落盘后逐份 `sha256` 与变异前快照比过：`context-meter.ts` = `2af5da5a5efaff04…`、
`ContextMeter.vue` = `bc46765aef279bd2…`、`no-raw-control-chars.test.mjs` = `b669e0d8f8a8af25…`，三份全 RESTORED。

### 本刀**没**闭的那一层，照直写

1. **`reserve=0` 上界**：预览不知道真发那一轮的系统提示词与本轮输入占多少，所以历史报的是上界（`historyStatFor` 里钉着）。
   这一刀只把「显示的是哪几路」对齐了，没把「上界」变成「真值」——tooltip 里那句「只会更少，不会更多」是这件事唯一的交代。
   要真闭得让 `contextPreview` 走真 `startTurn` 的预算，那是主进程那一侧的另一刀。
2. **装配为空但历史非空那一格仍不显形**：显形判据仍以主进程的 `preview.empty` 为准（渲染层不与它互相猜），
   所以「独立线程 + 长历史 + 档案什么都不装」那一轮 chip 还是不在场。这条现在有用例钉着（M7 那一条），是**决定**不是漏网。
3. **真机没重跑**：这屏是 `pnpm verify` 那套单测 + 门禁覆盖的，第二十二节那套冷实例目检没重做——因为**旧探针的判据已经过期**：
   它第 ⑤ 条钉的是旧公式（`items` 那一路），改完口径必然红。`scratch/meter/run.mjs` 已按新公式改好（条数与 token 都并进合账，
   另加一条 tooltip 里必须有「共 N 字」），**但还没重跑过**。下一次目检按第二十二节那套纪律走：`build` 后冷实例、每跑重启。
   ⇒ 本刀的完成状态是「代码 + 门禁 + 变异自证」，不是「目检过」。

### 门禁（一整条 `pnpm verify`，日志 `%TEMP%/m9/verify-final.log`，392 行）

`All matched files use Prettier code style!` ⇒ 6× `tsc --noEmit` ⇒ `eslint . --max-warnings=0` ⇒
`check-package-boundary` ⇒ 行数预算通过（**612 份**，比上一刀的 611 正好多我这份新闸）⇒
vitest **307 文件 / 3998 passed | 2 skipped（4000）**，`VERIFY_EXIT=0` 是日志里那行 echo。
与上一刀的 306 / 3987 差 **+1 文件 / +11 条**，逐格对得上：`no-raw-control-chars.test.mjs` 一份文件 2 条、
`context-meter.test.ts` +8、`context-meter-wiring.test.ts` +1。日志里唯一的 `EPERM` 命中是自带标签的那行
「[环境噪音] 本机建不了符号链接（EPERM），软链逃逸那一条没验到」，与第二十三节口径一致；
`2 skipped` 仍是 `changes.test.ts:247,302` 那两条 `skipIf(win32)`。

## 二十八、2026-10-12 七项清单第五刀：开发态与打包版的设置目录分开（清单第 6 项）

### 这一条原来怎么写的（两处登记，当场从盘回读，不是转述）

第十八节 `:716-718` 原文：

> **留给他裁定的一条（我不动手）**：dev / 探针实例与打包应用**共用同一份 `activeDir` 配置**，
> 所以任何一次真机验证都可能像这次一样写到用户正在用的设置上。要不要给开发态一个独立目录
> （比如按环境变量派生 `mochen-ai-dev`）是改产品行为，不是一句注释能替拍的。

第二十二节 `:1121-1124` 原文：

> **顺带把一条隐患写实**：`--user-data-dir` 只搬 Chromium 那半边，
> 应用设置固定在 `app.getPath("appData")/mochen-ai`（`main/index.ts:98-100` 定的目录，`provider-settings.ts:82` 在那里拼 `config.json`），所以**探针实例读写的就是他那一份 config.json**。
> 本格因为不需要模型所以一个字没写；但任何要存档案/密钥的探针都在动他的真身设置——这正是待他拍板的
> 「dev / 探针设置目录拆不拆（`mochen-ai-dev`）」的实证，第二十一节那次「当场还原」的必要性也由它而来。

**它不是理论风险**：第十九到第二十二节每一格真机都读写过 `%APPDATA%/mochen-ai/`，第二十一节还为此走了
「备份 → 还原 → 回读」。2026-10-12 那句「**按清单修复那七项遗留问题**」把这一格从「等他拍板」变成整批授权里的一刀。

### 改了什么

| 文件 | 行 | 这一处做什么 |
| --- | --- | --- |
| `apps/desktop/src/main/app-dirs.ts` | 新文件 201 行 | 目录名的唯一判据 `appDirNameFor(isPackaged)`（`:30/:32/:35`）、复制清单 `DEV_SEED_FILES = MIGRATED_FILES`（`:40`，不另立第二份清单）、`resolveAppDataDir`（`:105`）、`devSeedNotice`（`:164`） |
| 同上 | `:129` | 只有确实要拷的时候才 `mkdir(devDir)`；不拷的时候一个字节都不写盘 |
| `main/index.ts` | `:49` | 装配层只 import 这四个符号 |
| 同上 | `:65` | 本地常量只剩 `LEGACY_APP_DIR_NAME`（迁移入参，`legacy-dir-name.test.ts` 的豁免①照旧成立）；`APP_DIR_NAME` 的真身搬进 `app-dirs.ts` |
| 同上 | `:78-83` | `crashLogPath` 改走 `appDirNameFor(app.isPackaged)`：开发版的崩溃日志不再混进用户真身那份 |
| 同上 | `:121` | 迁移算出的那份改名 `packagedDir`（打包版用的目录），语义从此明确 |
| 同上 | `:126-135` | `resolveAppDataDir({ appDataBase, isPackaged: app.isPackaged, packagedActiveDir: packagedDir, copyFile, readdir, mkdir })` ⇒ 一个 `activeDir`；下面所有 store 一行没动 |
| 同上 | `:136-146` | 迁移播报与复制播报合并成一个 for，两条都走同一个「墨宸 AI · 设置目录」dialog |
| `AboutPanel.vue` | `:19` | 「配置」那一格补上开发目录那句话 |
| `legacy-dir-name.test.ts` | `:71-80` | 新增一条：两个目录名都得在 UI 上说到，只报打包名等于骗人 |
| `app-dirs.test.ts` | 新文件 441 行 / 25 条 | 桩 21 条 + **真 fs 4 条**（`mkdtemp` 在系统 tmp，不碰 `%APPDATA%`） |

### 三条设计判定（都有用例钉着，不是注释）

1. **迁移的目标仍然是打包目录**。开发态不许把 `mochen-writing` 迁进 `mochen-ai-dev`——那样「先跑一次 dev」
   会把旧目录改名吃掉，打包版下次启动就再也迁不到。`app-dirs.test.ts` 的装配层那条直接钉
   `const newSecretDir = path.join(appDataBase, APP_DIR_NAME)` 还在，并钉 index.ts 里**不出现**
   `path.join(appDataBase, APP_DEV_DIR_NAME)`。
2. **只复制，不搬家**。搬家（改名/删除）拿走的是另一个进程正在用的目录。全模块只有三种 fs 动作：
   `readdir`、对开发目录的一次 `mkdir`、`copyFile`；每条用例都按调用序列断言这一点，
   `copy-failed` 那条还专门断言序列里 `every(readdir|mkdir|copy)`。
3. **幂等**：开发目录存在（哪怕是空的）就一个字不碰。否则用户在开发版里删掉的 `config.json`
   下次启动被「复活」，那「删掉」等于没发生。全新机器上开发版从零开始时也不抢建目录——
   各 store 的 `writeFileAtomic` 自己按目标路径建（`appearance-store.ts:69`、`provider-settings.ts:120`）。

### 真 fs 那一组抓到一处真 bug

第一版实现把 `copyFile` 当「目标目录不存在也会自己建」用——**`fs.copyFile` 不会**。
第一次开发启动的现场恰好就是「开发目录不存在」，于是那一次复制会当场抛 ENOENT，
变成一个永远修不好的 `copy-failed`。注入桩对 `copyFile` 太宽容，看不见这件事；
补上「真 fs 四例」并让桩也照真规矩失败（目标目录不认识就抛 ENOENT）之后，
`resolveAppDataDir` 里那句 `await deps.mkdir(devDir)` 才是被用例逼出来的。

### 变异自证（11 路，逐条红，全部改回后按 sha256 核过）

| 号 | 改哪一处 | 红了什么 |
| --- | --- | --- |
| M1 | `if (deps.isPackaged)` 判据写反 | 11 条（打包态与开发态两组全红） |
| M2 | `appDirNameFor` 三元两边对调 | 3 条（判据与常量同真身） |
| M3 | 幂等闸放宽成「非空目录才算存在」 | 1 条（删掉的配置被复活那一类） |
| M4 | `copyFile` 源/目标写反 | 2 条（方向与序列各一条；真盘上这条会直接覆写用户真身） |
| M5 | 无视已知清单、目录里有什么拷什么 | 3 条（来历不明的字节那条最硬） |
| M6 | 把 `copy-failed` 咽成 `seeded` | 1 条 |
| M7 | `devSeedNotice` 默认分支不再返回 null | 1 条（没动过盘也要弹） |
| M8 | index.ts 的 `crashLogPath` 退回写死 `APP_DIR_NAME` | 1 条（装配层接线普查） |
| M9 | `AboutPanel.vue` 那句删掉开发目录 | 1 条（`expected … to contain 'appData/mochen-ai-dev'`） |
| M10 | 删掉 `await deps.mkdir(devDir)` 那一段 | **6 条**（其中 3 条来自真 fs 那一组） |
| M11 | 装配层少递一个 `mkdir` 缝 | 1 条（fs 缝那根线） |

回改后五个文件 `sha256sum -c` 全部 OK（基线快照 `%TEMP%/m10/baseline.sha`、`baseline2.sha`）。

### 用户真身那份的现场读数（动刀之后当场回读）

```
%APPDATA%/mochen-ai/config.json   801 B  Oct 12 00:15
sha256 98841130023a66914c8244be02ff4829779fcdc08c3e4e128adb10541f75f26d   ← 与台账记的基线同一串
secrets/  只有 72c5e589-…-06ec20cc328d.enc 112 B Oct 6 12:46   ← 他那一枚，没多没少
%APPDATA%/mochen-ai-dev           不存在
```

sha 与第十九节立下的基线逐字相同，说明本刀没碰过它。字节数这里 `ls` 报 801、台账当时写「800 B」，
**以当场回读的 sha 串为准**（那一格是大小约数，内容串才是判据）。`mochen-ai-dev` 还不存在，因为本刀**没起过 Electron 实例**。

### 还没闭合的（照直写）

1. **真机没跑**。这一刀证明到「代码 + 门禁 + 变异 + 真 fs 临时目录」，没证明到屏。
   下一次真跑 dev 会第一次生成 `%APPDATA%/mochen-ai-dev` 并弹一次 info dialog（那是产品行为，
   不是报错）；我没有在他机器上触发它。
2. **`secrets.enc` 拷到开发目录后解不解得开，未验**。DPAPI 是同用户同机 scope，理应当解；
   但第二十二节刚记下过「dev 实例解不开他 10-06 那枚密文」，这条冲突没有实测收口。
   若真解不开，表现是开发版设置页如实报错，不是静默——这是既有 credential-store 那条路径的行为，不在本刀改动面里。
3. **旧目录只有打包版会迁**。开发态如果先跑、打包版从没跑过，`mochen-writing` 会留在原地不动，
   直到打包版下一次启动才迁。这是判定 1 换来的代价，写在 `app-dirs.ts` 与用例注释里，不是遗漏。

### 门禁（一整条 `pnpm verify`，日志 `%TEMP%/m10/verify.log`，392 行）

**这一跑覆盖的是代码那一版**：`§28` 与 README 那处更正是**跑完之后**才写的，没有重跑全量 verify；
两个文档路径单独 `prettier --check` 过，`DOC_FMT_EXIT=0`（`docs/superpowers` 在 `.prettierignore` 里是
声明式豁免，判据见 `tools/prettier-scope.test.mjs`，第二十三节立过这条口径）。

`All matched files use Prettier code style!`（`:3`）⇒ 6× `tsc --noEmit` ⇒ `eslint . --max-warnings=0` ⇒
`check-package-boundary` ⇒ 行数预算通过（**614 份**，`:5`，比上一刀的 612 正好多我这两份新文件）⇒
vitest **308 文件 / 4024 passed | 2 skipped（4026）**，`VERIFY_EXIT=0` 是日志 `:392` 那行 echo，
不是外壳通知（后台通知那次同样报 0，但判绿只认日志里的这一行）。
与上一刀的 307 / 3998 差 **+1 文件 / +26 条**，逐格对得上：`app-dirs.test.ts` 一份文件 25 条、
`legacy-dir-name.test.ts` +1。日志里唯一的 `EPERM` 命中仍是自带标签的那行
「[环境噪音] 本机建不了符号链接（EPERM），软链逃逸那一条没验到」（`:107`），与第二十三节口径一致；
`2 skipped` 仍是 `changes.test.ts:247,302` 那两条 `skipIf(win32)`。
**这一跑没有起 Electron 实例**，所以「真机」那一格仍然空着——见上面「还没闭合的」第 1 条。

## 二十九、清单第 4 项「次要文字对比度」：这一刀动的是**用法**，不是系数（2026-10-12）

§七 那一行（本报告 `:273`）原文抄的是 `README.md:6244`：「次要文字对比度仍差 0.1–0.4，要动的是表面阶梯」。
这一格现在闭，但闭的方式是**先把它那句诊断推翻**：数字是对的，病因是错的。

### 一、把 16 组（八套皮肤 × 明暗）逐档算完，病不在阶梯

系数一律读应用自己那一份（`SURFACE_LADDER_MIX` / `SECONDARY_TEXT_MIX` / `TERTIARY_TEXT_MIX`），
每格取 16 组里的**最低值**。探针是一次性临时件（跑完即删），日志留在本机 `%TEMP%/m11/`：
`ladder-probe.log`（灰字两列 + 状态档灰列全量）、`body-probe.log`（正文列）、`ceiling-probe.log`（深度上限）、
`accent-probe.log`（下面第四节那族）。

| 档 | 深度（浅/深） | 次要 0.71/0.72 | 第三级 0.71/0.62 | 新token 0.78/0.80 | 正文 |
| --- | --- | --- | --- | --- | --- |
| raised | 0.018 / 0.055 | 4.94 / 6.66 | 4.94 / 5.21 | 6.11 / 7.92 | 11.09 / 11.83 |
| card | 0.028 / 0.075 | 4.88 / 6.30 | 4.88 / 4.94 | 6.04 / 7.50 | 10.82 / 11.20 |
| muted | 0.045 / 0.09 | 4.71 / 6.04 | 4.71 / 4.73 | 5.83 / 7.19 | 10.40 / 10.74 |
| hover | 0.085 / 0.14 | **4.38** / 5.15 | **4.38** / **4.04** | 5.41 / 6.13 | 9.28 / 9.15 |
| selected | 0.12 / 0.20 | **4.09** / **4.28** | **4.09** / **3.35** | 5.06 / 5.10 | 8.47 / **7.60** |

三件事当场定死：

1. **阶梯对正文档五档全过**，最低那一格 7.60（深底 `selected`，「汐 · 昼阁」）。阶梯没病，
   所以「要动的是表面阶梯」这句**作废**——真去砍浅阶梯，会把 5 档压成 2 档，而达标的仍然是正文档那一列。
2. **浅底也没有调系数的余地**：0.71 的灰要过 4.5，深度上限是 **0.068**；按上一轮立下的
   「留 0.2 留量」口径回到 4.7，上限只剩 **0.048**——而 `muted` 自己就占着 0.045，
   `hover` 0.085 与 `selected` 0.12 根本挤不进这个上限。
   深底余量大一些（次要能忍到 0.182），但第三级 0.62 只能忍到 0.105，照样盖不住 `selected` 的 0.20。
   ⇒ **「五档阶梯」与「灰字压在最深两档上达标」不可能同时成立**，这不是系数能解决的。
3. 于是修的是**用法**：新增 `--text-on-state`（浅 0.78 / 深 0.80，`theme-runtime` 注册），
   它对五档全部 ≥ 4.5（最低 5.06 / 5.10，都在 `selected`）。
   凡把状态档（`--surface-hover` / `--surface-selected` 及别名 `--hover` / `--selected` / `--hover-bg`）
   当背景画的规则，必须自己写明这一档上的字色，两种合法形状：
   - 块里直接 `color: var(--text-on-state)`——只管元素自己；**或**
   - 在这一条规则里 shadow 本族灰字 token（`--text-tertiary: var(--text-on-state)`）——
     自定义属性连**整棵子树**一起改口，`small` / `kbd` / `.xxx-hint` / `::placeholder` 都跟着升档，
     这是 `color:` 一行做不到的。

### 二、普查是枚举出来的，不是名单

守卫新文件 `composables/appearance-surface-ladder.test.ts`（9 条：数值律 5 + 结构律 4）。
它自己从盘上枚举 `styles/*.css` 全部 + `components/*.vue` 的内联 `<style>`，
当前树上数到 **77 处深档底规则 / 19 个文件**（`__census` 探针跑出的计数，跑完即删；
判据本体是守卫，不留并行演化的第二份脚本——`superpowers` 那批 `.superpowers/sdd/*.mjs` 探针已经因为没人同步而腐掉过一次）。
普查表 `STATE_RUNG_SITES` 按文件分组钉这 77 处，四种合法形状（`primary` / `shadow` / `inheritFrom` / `exempt`）之外一律红。

改动的落点：**14 个样式/组件文件**（`agent-pane` `change-history` `context-meter` `conversation-history`
`conversation-pane` `editor-pane` `foreshadow` `interaction` `left-nav` `settings-page` 十个 CSS，
加 `ExportDialog` `FindReplacePanel` `OutlinePanel` `ProjectSwitcher` 四个 SFC），
另外 `theme-runtime.css` 那层早就在做这件事（`:118-135` 的 `background: 深档 + color: 正文`），本刀没动它。

`editor-pane.css` 这一份不是加声明，是**删**了一行并换了一行：

- `.view-tabs { background: var(--surface-hover) }` 删掉——它**一条都不生效**。
  `theme-runtime.css:160-170` 那条 `html[data-theme] :where(… .view-tabs …)` 特异性 (0,1,1) 压过本条 (0,1,0)，
  槽底一直是 `--surface-muted`。留着它的害处不是"多一层红"，是下一个人读到这条会按 hover 档去算
  里面那三枚钮的三级小字（压在 muted 上 4.71 达标、压在 hover 上 4.38 掉线，判据整个反了）。
- `.editor-view-switch` 的槽底 `hover` → `muted`：同一个控件的另一副面孔本来就是 muted，
  而且槽是**常显**容器，不是 hover 才出现的一瞬；三级小字因此在浅底 4.38→4.71、深底 4.07→4.73。

### 三、顺手抓到一处真 bug（不是对比度，是看不见）

`FindReplacePanel.vue:438` 的 `.find-undo-btn:hover` 原先写 `color: var(--neutral-solid-contrast, #fff)`。
那枚变量是**实心主按钮**的字色，配的是 `--neutral-solid` 整块底；这枚按钮的底是 hover 档（浅色 ≈ `#e9e9e7`）——
白字压浅灰底，等于「替换后那一行的退路入口」在浅色皮肤下 hover 就消失。已改 `var(--text-on-state)`（浅 5.41 / 深 6.13）。

### 四、登记但**不修**的那一族：accent 被当字色

普查里有五处块的字色是强调色本身（`--accent` / `--danger`），本刀只按附注把它们的**后代灰字**升档，
字色本身原样保留，因为改它等于改品牌观感，要用户拍板。全量数字（`accent-probe.log`）：

| 组 | accent | raised | card | muted | hover | selected |
| --- | --- | --- | --- | --- | --- | --- |
| 灯楼 · 晴昼 浅 | `#9A6A1E` | **4.15** | **4.08** | **3.97** | **3.65** | **3.42** |
| 汐 · 昼阁 浅 | `#2A7699` | **4.42** | **4.37** | **4.22** | **3.92** | **3.66** |
| 书舟 · 夜航 浅 | `#4C9DBA` | 5.13 | 5.01 | 4.82 | **4.32** | **3.91** |
| 墨潭 · 映日 浅 | `#25736E` | 4.87 | 4.79 | 4.65 | **4.31** | **4.03** |
| 书舟 · 昼渡 浅 | `#256C86` | 5.20 | 5.10 | 4.96 | 4.60 | **4.30** |
| 墨潭 · 沉雾 浅 | `#54A7A2` | 5.87 | 5.74 | 5.54 | 4.95 | **4.48** |
| 汐 · 夜阁 浅 | `#4FA8C4` | 6.24 | 6.10 | 5.84 | 5.26 | 4.77 |
| 灯楼 · 燃夜 浅 | `#D9B072` | 7.16 | 6.98 | 6.71 | 5.98 | 5.46 |

- `selected` 档（`.nav-row.is-active`、`.tree-row.is-selected`、`.view-tabs button.is-active` 都吃这一档）
  浅色 **6/8 套不到线**，最低 3.42（灯楼 · 晴昼）。
- 更难看的是「灯楼 · 晴昼」和「汐 · 昼阁」两套：accent 在**五档全部**不到 4.5，连页底那格都不算好——
  浅底上这两套的 accent 本来就不是为"当字色"设计的。
- 深色也有三格掉线（`selected`：汐 · 昼阁 3.87、书舟 · 昼渡 4.37、墨潭 · 映日 3.65；
  另外深底 `hover` 墨潭 · 映日 4.40）。
- 一条被顺带证实的**真身冲突**：`theme-runtime.css:132-135` 给 `.nav-row.is-active` 写的是
  `color: var(--text-primary)`，但 `left-nav.css` 的 `.nav-row.is-active` 特异性 (0,2,0) 压过它 (0,1,1)，
  所以界面上那行选中项一直是 accent 色。**这不是"主题层没生效"，是两层在抢同一枚字色**。
  修法要么让主题层赢（把 accent 那行改成 `--text-on-state`，观感变化最大），
  要么给 accent 单独定一档"够深的强调色"（每套皮肤多一个字段，是皮肤契约的事）。
  **请拍板**，本刀不猜。
- 同族另四处登记在同一张普查表里（`.format-button.is-active`、`.find-toggle.is-active`、
  `.link-btn:hover`、`html[data-theme="dark"] .tree-node-action-menu-item.is-danger:hover`），
  理由各写了一行，豁免附带判据由守卫机器核（见下面 M7 那一类变异）。

### 五、变异自证（9 路，每路单独跑、跑完立即对称改回）

日志 `%TEMP%/m11/mut-*.log`；判绿只认日志里的 `Tests N failed` 行，不看外壳通知。

| 号 | 改哪一处 | 红了什么 |
| --- | --- | --- |
| M1 | `ON_STATE_TEXT_MIX.light 0.78 → 0.55` | 「状态档灰 × 五档」红：汐 · 昼阁 light 页底 3.28:1 |
| M2 | `SURFACE_LADDER_MIX.selected.light 0.12 → 0.5` | 「正文 × 五档」红：4.23:1（这一路同时把浅底阶梯砍平，就是要让它红） |
| M3 | 表里针串改成不存在的 `.context-meter-list li.is-selected` | 「每一处深档底都被唯一命中」红（`notCovered` 报出那一块）+「兑现判词」抛「找不到规则」 |
| M4 | 删 `.card-turn` 的 `color: var(--text-on-state)` | 「兑现判词」红，报「块里的 color 是（没有）」——`primary` 支有咬合力 |
| M5 | 删 `.context-meter-list li.is-active` 的 `--text-tertiary: var(--text-on-state)` | 同律红，报「少了 --text-tertiary: …」——`shadow` 支有咬合力 |
| M6 | `.permission-option` 基规则的 `color: var(--text)` → `var(--text-dim)` | 同律红，报「基规则里没有正文级 color，继承过来的还是灰字」——`inheritFrom` 支有咬合力 |
| M7 | 给无字部件豁免那枚 `.appearance-toggle` 加一行 `color: var(--text-secondary)` | **两条同时红**：豁免的附带判据（`expected ['var(--text-secondary)'] to equal []`）+「块内灰字必须同块 shadow」——豁免不能用来藏字 |
| M8 | 往表里多塞一条不存在的针串 | 「唯一命中」以 `{ n: 0 }` 红。**这一路顺手证明了一件事**：原先那行 `orphans = BLOCKS.filter(b => blocksFor(b.file, b.selector).length === 0)` 是拿块自己的选择器当针串查自己，**恒等于 1，永远不红**，属于装饰——已删，找不回规则那一半由 `n !== 1` 咬 |
| M9 | `SECONDARY_TEXT_MIX` 两半都 → `0.9`（把灰字调深） | 反向律红：「汐 · 昼阁 · dark：次要 × selected 已经到 6.30:1 —— 阶梯或字色动过，请重审普查表」。**只拧浅底一半不会红**（第一版就这么错了一次：`worst` 取的是 16 组最低，深底那一半还压在 4.28），所以这条律的红必须两半一起动才触发，这一点写进表头注释 |

反向的那格「前提仍在」不是装饰，是本刀的**前提哨**：它一红就说明灰字系数或阶梯动过，
那时结构普查表要重审，而不是让「画了状态档底就得升档」这条律悄悄变成空转。

### 六、三处过期出处，这次一起收

1. `appearanceThemeRuntime.ts:200-207` 那段「这次**没**顺手改的那一处 … 病因在**表面阶梯一层比一层深**」——
   紧跟着的新章节已经把这句推翻，但原文照读会读成结论。做法是**不删、加作废标记**（那个 ⚠），
   因为那两个数字（4.38 / 4.09）仍是量对了的，错的只是病因归属。
2. `appearance-skins.test.ts:499-501` 同一条过期结论，改成指向本守卫。
3. 台账行号本身：`README.md:6244` 这种引用已经**指不到东西**——README 现在 95 行
   （`wc -l` 当场回读），那批行号是「README 还是整本开发日志」的年代抄下来的。
   §七 那一行这次改成「见本报告第二十九节」，历史行号原样留着当出处，不再当入口。

### 七、门禁（分段跑两轮，日志 `%TEMP%/m11/gate-*.log` 与 `g2-*.log`，退出码逐段落盘回读）

`format=1` **第一跑就红**：`[warn] appearance-surface-ladder.test.ts`——我自己那份新文件没格式化。
只对那一个文件跑 `prettier --write`（**不用 `--write .`**：共享树上一把全量写会把别人的文件一起重排），
之后 `pnpm format:check` 全仓 `All matched files use Prettier code style!`，`FORMAT2=0`。
`typecheck=0`（6× `tsc --noEmit` 全过）、`eslint=0`（`--max-warnings=0`）、`boundary=0`（「边界检查通过」）、
`budget=0`（行数闸 **615 份**，比上一刀的 614 正好多我这一份新守卫）、`test=0`：
**Test Files 309 passed / Tests 4033 passed | 2 skipped（4035）**（两轮都是这一格数，当场各自回读），
`grep` 全量日志只有两处命中且都是自带标签的：一行「[环境噪音] 本机建不了符号链接（EPERM）」和
一行 prettier 的失败行（属于上面那次 `format=1`）。`2 skipped` 仍是 `changes.test.ts` 那两条 `skipIf(win32)`。
与上一刀的 308 / 4024 差 **+1 文件 / +9 条**，逐格对得上：多的那一份文件就是新守卫，9 条正好是它的 9 条。

**口径写清（哪一跑覆盖什么）**：第一次分段跑（`gate-*.log`）里 `test=0` 那份数**不算最终态**——
它起跑之后我又改了守卫的表头注释与普查律。第二次（`g2-*.log`）才是提交态：
最后一处代码编辑（`appearance-surface-ladder.test.ts` 那条 M9 注释）mtime **17:04:22**，
`g2-test.log` 里 vitest 自报 **Start at 17:05:40**，两串当场回读，所以六格数的都是提交前那一份树。
台账正文（这一节自己）不计入门禁：`docs/superpowers` 在 `.prettierignore` 的声明式豁免名单里，
判据是 `tools/prettier-scope.test.mjs`——第二十三节立过这条口径。

### 八、还没闭合的（照直写）

1. **真机没跑**。这一刀的证明到「代码 + 16 组数字 + 普查 + 9 路变异 + 门禁」，
   没到屏。状态档 shadow 的**级联效果**尤其只证到静态：`color:` 管不到的那些后代
   （`small` / `kbd` / `.xxx-hint` / `::placeholder`）是不是真的在 DOM 里坐在被 shadow 的元素下面，
   是模板决定的，静态 CSS 判不出来——普查表里每条 `shadow` 名单都对着模板核过，但核的是读代码，不是量像素。
   下一次真跑 dev 请重点看这几处：侧栏选中行的 `kbd`、会话历史条目的时间戳、workbench 卡的脚注、
   查找替换那一行的退路钮。
   **（2026-10-13 这一条已就地了结，见第三十节：三格量到屏上且全过，第四格「侧栏 `kbd`」在 DOM 里根本没有渲染方——
   那一格从「欠目检」变成「待拍板的死规则」。）**
2. **accent 当字色那一族**（本节点四）等用户拍板，不在本刀。
3. **广场卡那 2/16 格**（`2026-10-08-tertiary-contrast-report.md` §五 的 A/B/C 三个选项）仍等一句话。
4. 浅底第三级与次要**同值**（都 0.71），层级只靠字号与位置。要买回一档层级，正确入口是
   给每套皮肤自带一个第三级色值（皮肤契约加字段），不是回来拧这个系数——
   `TERTIARY_TEXT_MIX` 那段注释里已经写着这句话，本刀只是又量了一遍确认它仍然成立。

## 三十、第二十九节第八目欠的那四格真机读数（2026-10-13）

### 一、跑法（三条都是当场撞出来的，不是设计出来的）

实例起在仓库外工作树 `5f568bd`：`electron out/main/index.js --remote-debugging-port=9236
--user-data-dir=%TEMP%/contrast-probe/profile`。起手 `tasklist //FI "IMAGENAME eq electron.exe"` 实测**零条**，
所以那 4 个 electron 进程（主 9824 + 三子）全是我这一台的；收尾 `taskkill //F //T //PID 9824` 之后
回读进程数 0、`netstat` 里 9236 的 LISTENING 计数 0。
后台任务通知那句 `failed / exit 1` 是**我自己 taskkill 的结果**，不是证据也不是失败（同第五、二十条口径）。

- **换皮全程不落盘**：只走 `skinBrowse.setPreview(id)`，深浅档直接改内存里的 `appearance.settings.mode`，
  一次都没调 `appearance.update()`。收尾核对：`mochen-ai-dev/appearance.json` 仍是 `bc3d1901…` / 787 B（与起手同一枚），
  用户真身 `mochen-ai/config.json` 仍是 `98841130…`。开发态那份 `config.json` 与真身同哈希——
  这是第二十八节「只复制不搬家」的应有结果，不是被写坏了。
- **伪类不靠坐标点击**：`CSS.forcePseudoState(nodeId, ["hover"])` 之后读 `getComputedStyle`。
  第一版把 nodeId 缓存下来跨皮肤复用，Vue 一重渲染就 `Could not find node with given id` 当场崩——
  **每个选择器每次重新解析**（`DOM.getDocument` 的根也要在 `DOM.documentUpdated` 后作废）。
- **谓词**：`color` 与「逐层往上找到的第一块实底」合成，算 WCAG 比值；`background-image` 另记 `imageBehind`，
  不进这个数（见第五目）。

### 二、四格读数（八套皮肤 × 明暗 = 16 组，每格取最低）

| 第二十九节点名那一格 | 屏上真身 | 最低 | 出现在 | 16 组里 <4.5 |
| --- | --- | --- | --- | --- |
| 会话历史条目的时间戳 | `.conversation-history-item.is-current … time` | 5.06 | light/xi-day | 0 |
| workbench 卡的脚注 | `.workbench-card .workbench-card-hint`（hover 档） | 6.11 | light/xi-day | 0 |
| 查找替换那行的退路钮 | `.find-undo-btn`（hover 档） | 5.41 | light/xi-day | 0 |
| 侧栏选中行的 `kbd` | —— | **DOM 里没有** | —— | 16 组全部未命中（见第三目） |

同一次顺手补的两格也过了：`.nav-row svg` 在 hover 档最低 5.41、行文字最低 9.15；
退路那一行的说明句 `.find-undo-notice` 最低 4.71。
最坏那一套（灯楼·晴昼浅档）当场读回来的是 `rgb(89, 82, 67)` 压 `rgb(225, 219, 205)` = **5.61**——
这一处正是第二十九节算出「灰字压在深档上不可能达标」的那一族，现在屏幕上读得清。

**级联那句主张第一次量到屏上**：`--text-on-state` 走的是自定义属性继承，所以 `time` / `small` /
`.workbench-card-hint` / `.find-undo-btn` 读回的 `color` **就等于该组的 `--text-on-state`**
（汐·昼阁浅档 `rgb(65, 93, 107)`、灯楼·晴昼浅档 `rgb(89, 82, 67)`，逐组对得上）。
第二十九节写的是「`color:` 做不到、自定义属性做得到」，那一句此前只有静态证据。

### 三、四格里有一格在屏幕上不存在（新发现，本刀不修）

`.nav-row kbd` 16 组全部未命中。查渲染方：全仓只有 `LeftSidebar.vue` 与 `ExtensionsNavRow.vue` 挂 `nav-row`，
两处都不出 `kbd`——左栏那几行的快捷键是 `title` 提示（`LeftSidebar.vue:741`），不是键帽。
⇒ 普查表里那条 `shadow: ["--text-tertiary"]` 钉的是一条**当前没有任何 DOM 命中**的 CSS 规则。
它不是假控件（压根没有控件），但这一格**不可能被真机验到**。两条写法各有代价：
删规则（连带普查表那一行一起删，否则守卫会以为还有东西要护）或给侧栏真补上键帽（那是产品观感改动）。
**等一句话**，本刀只如实记账。

### 四、accent 当字色那一族的 16 组实机数字（第二目第 2 条待拍板要看的表）

`.nav-row.is-active` 行文字：浅档 3.66 / 4.77 / 4.30 / 3.91 / **3.42** / 5.46 / 4.03 / 4.48，
深档 3.87 / 6.56 / 4.37 / 6.25 / 4.94 / 6.85 / 3.65 / 6.62 ⇒ **9/16 组不到 4.5**，
最低 3.42 在灯楼·晴昼浅档，**与第二十九节静态算出的那一枚同处同值**（模型与屏幕互证）。
读数出处：`color: rgb(154, 106, 30)` 压 `rgb(225, 219, 205)`。

### 五、没做的与边界

- **没做「改前白压白」的 A/B 截图**：旧值在 `08a1699^` 里，静态已经算过一遍；本刀只补「新值真的上屏」这一半。
- **五轮探针共用同一台实例**（`probe2`→`probe5`，中途没重启），这与「点控件读屏的目检每跑必重启实例」那条老规矩相反。
  这里成立的理由是：本轮**没有一个读数是"点一下看屏幕变了没"**，全部是先回读 DOM 存在性（`items` / `cards` /
  `undo` 计数逐轮打印）再读 `getComputedStyle`；跨轮残留只有两处，且都是**让格子继续可见**的方向——
  替换后的退路行一直挂着、历史菜单被我第二轮点合过（那一轮 `is-current` 读到 0，于是切回 01 那一篇重开，
  读数没算进那一轮）。下一轮若要验"点了以后界面反不反应"，仍按老规矩重启。
- 这几个数是**面板那一层实底**的对比度。皮肤整窗图坐在玻璃层后面（部分组 `imageBehind=true`），
  「隔着画看字」的观感不在这个数里，属截图目检：四格在**最差那一套（灯楼·晴昼）明暗两档**共 8 张里逐张看过，
  文字、图标、按钮都清晰可辨（`shot-{light,dark}-lamp-day-{history-current,nav-hover,workbench-card,undo-row}.png`）；
  汐·昼阁那一组 8 张同批留档、**没有逐张看**（同一批读数全过，再花 8 次目检的边际是零）。
- 探针脚本（`probe2/3/4/5.mjs`）与截图都留在 `%TEMP%/contrast-probe/`，**不入库**：
  判据的真身在 `appearance-surface-ladder.test.ts`，再放一份 Node 版就是第二份真相。

## 三十一、2026-10-13：删掉那枚全仓零引用的 `useHotkeyConfigStore.ts`，并给 stores/ 这层补上守卫

### 一、为什么这一刀值得动（四条，全部当场回读，不是凭印象）

1. **零引用**。删除前 `grep -rln "useHotkeyConfigStore"` 全仓只命中两处：它自己，和第一节第 77 行那份 localStorage 对账。
   没有 `import`、没有 `storeToRefs`、没有 `import.meta.glob`（全仓 `import.meta.glob` 命中 0 处），
   也没有任何 tooling 按目录枚举 store。⇒ 这 232 行在运行时一行都不执行。
2. **它是第二份判据，而且已经漂移**。它自带一张键位表（`DEFAULT_BINDINGS`），可它注释里写着「与 hotkey-guide.ts 保持一致」——
   真身 `utils/hotkey-guide.ts:4-6` 明说「键位判定的唯一真身在 `utils/hotkeys.ts` 的 `resolveHotkey` + `utils/escape-policy.ts`，
   每一行的 needle 必须能在源码里找到，抄错键名测试即红」。那张表**没有任何一条这样的守卫**，于是漂移无人报警：
   - 它写 `accept-proposal = Ctrl+Shift+A`（原文件 50-51 行）、`deny-proposal = Ctrl+Shift+D`（57 行）；
     真身是待审卡聚焦时的 **Y / A / P / D** 四枚（`hotkey-guide.ts:94-97`）。
   - 9 个动作 ID 里 8 个在真身三处源码（`utils/hotkeys.ts` 195 行、`utils/hotkey-guide.ts` 180 行、
     `composables/useHotkeys.ts` 335 行、`utils/escape-policy.ts`）里**一次都搜不到**：
     `cycle-thinking`、`toggle-web-search`、`open-search`、`new-conversation`、`toggle-left-pane`、
     `toggle-right-pane`、`accept-proposal`、`deny-proposal` 全 0 命中，只有 `open-settings` 有 3 处。
     `Ctrl+Shift+A` 这个组合在真身里根本不存在。
3. **它写的还是 localStorage**（`STORAGE_KEY = "mochen.hotkey-config.v1"`，原 37 行），而第一节第 77 行把它当成
   「应用级 UI 偏好」的**在册键**列着——一条没人读的键位表，外加一行会误导下一个读者的台账。
4. **它自己带一处静默失败**：`saveBindings` 的 `catch { /* 静默 */ }`（原 146 行）。按「失败必须可见」这条，
   这处将来是要动刀的，但它没有任何调用方，动它等于给死代码做修辞。删。

裁定依据是仓里已经在跑的两条规矩，不是我新立的：**判据单真身** 与 「未验证的功能优先删」。

### 二、删了什么、更正了什么

- `git rm apps/desktop/src/renderer/src/stores/useHotkeyConfigStore.ts`（232 行）。
- 第一节第 77 行那份 localStorage 对账**就地更正**（紧跟原句加了一段引述）：那一串里 `hotkey-config` 已无写入方；
  其余五枚逐条回读确认写入方都还在——`useNotificationStore.ts:25`、`useOnboardingStore.ts:24`、
  `useProjectManagerStore.ts:36`、`usePromptTemplateStore.ts:35`、`useVersionStore.ts:26`。
  这次更正本身说明问题：**一份没有守卫的清单就是这样过期的**，所以第三节补守卫，而不是只删了算完。

### 三、补的守卫：`stores/dead-store-guard.test.ts`

`dead-css-guard.test.ts` 开头那句话在这里同样成立——「这层没人报警：删不掉、看不见、改不动，一轮轮攒下来」。
CSS 那层 2026-10-05 有守卫了，store 这层没有。口径：

- 扫描对象**按内容判**（源码含 `defineStore(`），不写文件名名单。理由：`layoutStore.ts` 不以 `use` 开头但是真 store；
  而 `agent-store-fixture.ts` / `book-draft-fixture.ts` / `book-data-test-harness.ts` 是测试夹具，只该被测试用到。
  写死豁免名单的话，下次加一枚夹具还得回来改这里——那又是一份会过期的清单。
- 判据：每枚 store 必须被 **`stores/` 之外、且不是 `*.test.ts`** 的源码引用到（23 枚 store 逐枚一条 `it`）。
- 另有一条自我声明：`stores/` 里至少扫得到 10 枚 store、`stores/` 之外至少看得到 10 份源码。
  少了它，扫描路径写错会让整条守卫变成**空跑即绿**。

两次变异（都用 Edit，跑完还原）：

| 变异 | 结果 |
| --- | --- |
| 用 `git show HEAD:` 把刚删的 `useHotkeyConfigStore.ts` 放回 `stores/` | `× useHotkeyConfigStore.ts 必须被 stores/ 之外的非测试源码引用得到`，1 failed / 24 passed（`MUTANT_EXIT=1`）——**只有那一枚红**，说明其余 23 枚引用方都在 |
| 把判据 `defineStore\(` 改成 `defineStoreZZZ\(` | `× stores/ 里确实扫得到 store（否则本守卫会静默空跑）`，`expected 0 to be greater than 10`（`MUTANT2_EXIT=1`）——空跑不会装绿 |

**这条守卫承认自己的局限**：它不看「引用方自己挂不挂载」。`useVersionStore.ts` 的唯一引用方是
`VersionHistoryPanel.vue`，而那只面板当前不挂载（= 台账里等他一句话的那一格）。挂载图是另一层判据，
本刀不混进来，免得把还没拍板的东西当成已决。

### 四、门禁与边界

- 六段各取退出码（不经管道），日志落盘回读：`format / typecheck / eslint / boundary / budget / test` 全 0，
  日志里 `error TS / ELIFECYCLE / Command failed / FAIL` 逐条 grep 为空。终态 **311 文件 / 4098 passed | 2 skipped**。
- 删除**本身**不动用例数：只删那 232 行时是 **310 文件 / 4074 passed | 2 skipped**，与删除前一字不差——
  一枚用例都没掉，这就是「它真的没人用」的第二个证据（第一个是 grep）。上面那 24 条增量全部来自新守卫。
- 日志里唯一命中 `EPERM` 的是 `packages/fs-store/test/atomic-write.test.ts` 自己打的那行
  「[环境噪音] 本机建不了符号链接（EPERM），软链逃逸那一条没验到」，与第十九节的 Windows 口径同一条，不是回归。
- **没跑真机**：这一刀删的是运行时不执行的代码、加的是一条 Node 侧守卫，屏幕上没有任何可看的变化；
  要验的是「守卫在不在」而不是「界面变没变」，后者已由两次变异证明。
- **没清 localStorage 里的历史遗留**：如果哪台机器以前写入过 `mochen.hotkey-config.v1`，那枚键现在成了孤儿。
  没有代码读它，所以不会误导行为；要不要在启动时清一次是另一件事，本刀不顺手加清理路径（加了就没人能验证它跑没跑）。

### 五、顺手把同一把尺子量过全仓（回答「还有别的吗」，不留悬念）

删完这一枚，下一个问题就该是「是不是还有」。用同一条判据（模块名被**非测试**源码引用到没有？）扫了六个目录，
脚本临时放在 `%TEMP%/dead-module-scan.mjs`、**不入库**（判据真身在守卫里，再放一份 Node 版就是第二份真相，同第三十节第五目）。

| 扫描目录 | 源文件 | 零引用 | 逐条判读 |
| --- | --- | --- | --- |
| `renderer/src` | 189 | 6 | `VersionHistoryPanel.vue`（493 行，**等他一句话**，见第四节）；3 枚 store 夹具只被测试用；`utils/vue-source-reader.ts`(247) 与 `utils/sfc-compile.ts`(73) 是 wiring 测试读源码用的工具，引用方全是 `*.test.ts` ⇒ 都活着 |
| `main` | 42 | 2 | `atomic-write-fs-fixture.ts`、`ipc-trust-fixture.ts` 都是测试夹具 |
| `preload` | 2 | 1 | `index.ts` 是入口，本来就没人 import |
| `contracts/fs-store/agent-runtime/plugin-kernel` 的 `src` | 25/18/14/4 | 0/0/0/1 | 只有 `plugin-kernel/index.ts`，那是包入口（按包名 `@mochen/plugin-kernel` 引） |

⇒ 除 `VersionHistoryPanel.vue` 那一枚已在拍板清单上的，**没有第二枚 `useHotkeyConfigStore`**。
这条负面结论本身就是收益：下一轮不必再重扫一遍。

（口径的边界要说清：本扫描把「只被测试引用」也算零引用，所以夹具与测试工具必然进表，是**待判读**不是**待删**；
守卫那边则按内容判 `defineStore(`，两者不是一条判据，别混用。）

## 三十二、2026-10-13：门面上那两处「按图找不到东西」的指向，以及一条只看指向的新守卫

### 一、病灶是自己撞出来的，不是审出来的

上一节写完后我去改 `README.md` 的数字，顺手想核一句「三道像素闸」，于是照门面去 `tools/` 找——
`ls tools/` 一共 15 份文件（`check-package-boundary` / `check-source-line-budget` / `ci-gate` /
`ico-container` / `mock-provider` / `no-component-library` / `no-raw-control-chars` /
`prettier-scope` / `typecheck-coverage` / `build-brand-icons` 及各自的用例），
**里面一份跟皮肤像素有关的东西都没有**。真身在 `apps/desktop/scripts/`：

| 门面原话（第 21 行） | 盘上真身 |
| --- | --- |
| 「画由仓内生成器产出，质量由三道像素闸盯（`tools/`）」 | 生成器 `apps/desktop/scripts/gen-scene-svgs.mjs` + 配色表 `scene-palettes.mjs`；三道闸 G1/G2/G3 在 `apps/desktop/scripts/check-scene-art.mjs`；入口脚本 `apps/desktop/package.json:12` 的 `check:scene-art` |

同一句假指向在本报告第十一节那张表里也抄了一份（第 319 行「… + `tools/` + `apps/desktop/scripts/check-scene-art.mjs`」——
后半截是对的，前半截纯属多余），已就地删掉 `tools/`。
这不是措辞问题：**读者按门面找不到实现，就会把「已做的」读成「没做的」**，与本仓反复登记的那族假话
（「数据删了、文案还在说它可用」）是同一族，只是方向相反。

### 二、其余门面主张这轮逐条对过盘（都成立，列出来是为了别再有人重扫）

| README 那句 | 当场回读到的 |
| --- | --- |
| Electron 42 + Vue 3 + Pinia | `pnpm-workspace.yaml` catalog：`electron: 42.5.0`(:10)、`vue: 3.5.39`(:22)、`pinia: 3.0.4`(:16) |
| 一轮最多六枚工具，名字逐个列出 | `packages/contracts/src/tools.ts:1-8` `AGENT_TOOL_NAMES` 六枚一字不差 |
| 皮肤广场 8 套（四族 × 昼夜） | `appearanceSkins.ts` 的 label 八条：:204 :222 :272 :287 :304 :319 :334 :349 |
| `tools/ci-gate.test.mjs`（6 条） | 文件里 6 处 `test(`，与门面一致（第二十三节纠正过的那枚「5 条」已经修好） |
| Apache-2.0 全文 + 逐文件对照表 + 上游 v1.5.6 | `LICENSE-DEEPWRITE.txt`、`docs/ATTRIBUTION.md` 存在，后者第 7 行写着 v1.5.6 |
| 语音输入「只到接进了输入卡」 | `composables/useVoiceInput.ts` + `voice-input.ts` + `ComposerBox.vue` 在场 |

### 三、改了门面哪四处

1. 第 21 行那句拆成三处真名（生成器、配色表、闸文件 + 入口脚本），并把「三道」写成 G1/G2/G3，
   这样门面与 `check-scene-art.mjs` 里的闸号**同名**。
2. 目录表新增一行 `apps/desktop/scripts/`，并把 `tools/` 那行的描述改成实际装的东西
   （假模型服务、边界/行数/门面主张/图标容器）——原描述里的「皮肤像素」就是本次的病根。
3. 第 42 行的测试数补上 2026-10-13 这一格：**311 文件 / 4098 passed | 2 skipped**，
   跑在仓库外那棵 `git status --porcelain` 当场读回 0 条的已提交工作树 `c9708b9` 上。
4. 于是第 50 行那句绝对话跟着改口：原文「干净提交树上的数**只有 CI 给得出**」并不准确——
   本机在零脏项的已提交工作树上也给得出，缺的是「当场自证这棵树干净」那一步。
   改成「以 CI 为准；本机要报这个数得先读回 porcelain 为 0」。

### 四、新守卫 `tools/readme-claims.test.mjs`（3 条）：把「指向」而不是「措辞」钉成断言

- **路径存在性**：README 里以反引号写出、且以 `apps/`、`packages/`、`tools/`、`docs/`、`.github/` 开头的路径必须真的存在。
- **脚本名在场**：以**命令形态**写出的 `pnpm <脚本>`（反引号整句或 ``` 代码块里）必须在根或 `apps/desktop` 的 `scripts` 里；
  `install` / `exec` 这类 pnpm 自带命令除外。散文里那句「pnpm workspace」第一版被咬成「不存在的脚本」——
  **红得没错但红得没道理**，守卫要咬的是指向不是措辞，于是加了"命令形态"这一层现场区分。
- **自我声明**：提取到 0 条路径或 0 个脚本名即红。正则写坏时守卫会**空跑装绿**，这条就是防它。

三次变异（Edit 改、`cp` 还原、`cmp` 核对，全绿后才敢引用）：

| 变异 | 结果 |
| --- | --- |
| README 里把闸文件写成 `apps/desktop/scriptz/check-scene-art.mjs`、目录表写成 `apps/desktop/scriptq/` | `门面上这些路径在仓库里找不到，读者会按图找不到东西：…scriptz…, apps/desktop/scriptq/` |
| 同批把入口脚本写成 `check:scene-artz` | `门面上写了不存在的 pnpm 脚本…：check:scene-artz`（两条一起红，`MUT12_EXIT=1`） |
| 把 `TOP_DIRS` 改成 `["zzz"]` 让提取面塌掉 | `README 里没提取到任何以顶层目录开头的路径主张…expected 0 to be greater than 5`（`MUT3_EXIT=1`） |

门禁六段各自落码（日志 `/c/temp/m12-f/*.log`，退出码落 `exit.txt` 后回读，不经管道）：
`FORMAT_EXIT=0` `TYPECHECK_EXIT=0` `ESLINT_EXIT=0` `BOUNDARY_EXIT=0` `BUDGET_EXIT=0` `TEST_EXIT=0`，
`pnpm test` 报 **312 文件 / 4101 passed | 2 skipped**（比上一格的 311/4098 正好多这一份 `tools/readme-claims.test.mjs` 的 3 条）。
这一格跑在工作树 `c9708b9` + 本刀未提交改动之上，所以数字与门面第 42 行那句「311/4098 跑在 `c9708b9` 零脏项」**并不冲突**：
门面那句话自证的是它自己那一棵树，本段自证的是将要提交的那一棵。

### 五、边界与没做的

- **不测散文**：门面里的形容词、比喻、裁定语没法机器核对，本守卫只管「可核对的指向」这一类。
  `.mochen/`（住在你作品目录里）与 `.git/hooks`（**工作树里 `.git` 是个文件**，`hooks` 目录压根不存在）
  是刻意排除在匹配面之外的——扩大范围只会让人学会关掉守卫。
- **`tools/` 那句描述**改掉了，但机器核不了「描述与内容相符」这一类语义；这一格靠的是当场 `ls` + 台账留名。
- **CI 那一格本轮读到了**（推上去时是 `currently running`，之后浏览器侧一度被网络策略挡，这一轮恢复后逐枚回读）：
  `#48` run `38324586323`（fix 分支 @`c9708b9`）**completed successfully** 2m10s、
  `#49` run `38324589981`（feat 分支 @`c9708b9`）**completed successfully** 2m1s。
  台账上一版把 `#48` 的 run 号写成 `38224586323`，那是**我抄错一位数字**（当场从 run 链接文本回读为 `38324586323`），
  已就地更正——run 号是引用，同样适用「转述必须回盘」。
- 上一节 §三十 里那句「真机四格」的 `#47`（run `38323616898`，feat @`d1409b9`，2m23s）与 `#46`
  （run `38323605236`，fix @`d1409b9`，2m16s）同批读回 `completed successfully`，那是 `d1409b9` 的两枚 run，与 `c9708b9` 无关。
  四枚读数都按口径只取 run 链接的 `svg[aria-label]` + 编号 + 分支 + 时长，标题不参与判断。

## 三十三、2026-10-13：把第七节那张表逐条对回盘面——四行「未修」压在已经上了盘的 fix 上面

### 一、这一节的起因不是审查，是抄指向时顺手撞出来的

写第三十二节时我去核台账那条 `README.md:6242`（挂件卡配额），`sed -n '6242p'` 读回来是**空行**，
真身在 `:6243`。顺着这条行号漂移把整张第七节表（`:271`–`:279` 九行）逐条 `grep` + `sed` 对回盘面，
结果比「漂一行」严重得多：**四行的现状写着「未修 / 未动 / 未做」，而盘上那个 fix 早就在 HEAD 里**。
同一份报告里第六节 `:105` 写着「P1-1 已修」、第七节 `:271` 写着「未修，且我给了机制」——两行打架，
而第七节这张表**会被当成待办清单读**（它就在「建议的修法」前面）。照读的后果不是难看，是**重做**：
下一个人会再写一遍上游看门狗，然后面对两只看门狗。

### 二、九行逐条回读（文件:行都是当场 `grep`/`sed` 读回，不是记忆）

下表仍对着那九行读，只是把 `:277` 那一行（一条台账出处写着两件事）拆成两半，
并把 `:278`/`:279` 两枚「等他一句话」并成一行——行数还是九行。

| 表里那一行 | 2026-10-13 盘上现状 | 结论 |
| --- | --- | --- |
| `:6399` 联网挂 200 秒零响应 | `provider-fetch.ts:23-24` 两只常量（首字节 30_000 / 流中空闲 60_000）、`:49` `UpstreamHangError extends ProviderError`、`:105` 到点抛错；`agent-service.ts:392` `abortableFetch(fetch, signal)`；`tool-loop.ts:189`/`:217`/`:240`/`:318` 每轮查 `signal` | **过期 → 就地更正为已闭**（入库 `b1fc79a` 那一波） |
| `:6401` 点输入框亮一圈青框 | `agent-pane.css:787` `.composer:focus-within .composer-input-surface` 仍在场（台账写的是 `:785`，行号漂两行）、`theme-runtime.css:139`/`:180` 上色 | **照旧未修**，且属样式判定——要的是目检不是代码 |
| `:6389` 真端点成功回一句未验完 | 本轮没有真端点跑通的任何读数；`:974` 那条「他 10-06 那枚真密钥在 dev 实例里解不开」仍未收口 | **照旧未闭合**，不动 |
| `:6242` 挂件与新素材卡配额 | 当场复探一次最小图，错误原样 `403 {"code":"112", …}` | **照旧成立**；顺带记下行号漂到 `:6243` |
| `:6244` 次要文字对比度 | 第二十九/三十节已闭并纠正过病因 | 上一轮已改，本轮不重复 |
| `:6247` 窗口无 minWidth | `main/index.ts:198-199` `minWidth: 1000` / `minHeight: 700`；判据 `main/window-min-size.test.ts:62`（还钉了「初值不许小于自己的地板」） | **过期 → 就地更正为已闭**（入库 `b1fc79a`） |
| `:12` 退订句柄无消费方 | `useAgentStore.ts:85` 字段、`:180` 幂等闸、`:197-199` `stopListening` 摘并置空 | **过期 → 已闭**（入库 `2487695`，判据形状见第十二/十三节） |
| `:12` 同一行的 UNBOUND 批准 | `agent-service.ts:120-126` `ruleKey` 明写「只是键的一半」，命中一律过 `scopedApprovalKey(书根, …)`（单真身 `book-scope.ts`）；`:158-161` 两张自动批准表随换书即清；`utils/session-row-action.ts:43` 对 unbound 行**禁用并给理由** | **过期 → 已闭**（入库 `b91680d`）；现状形状与当年那条不同，写清楚免得被读成「批准通路做完了」 |
| `:787` Responses API / `:3689` 远程插件目录 | 都仍然没有实现，也都仍然等他一句话 | **照旧不动**（`:3689` 那句「建议明写在 spec 里当边界」也没做——`docs/superpowers/specs/2026-10-01-…design.md` 里 grep 不到这条边界，如实记着） |

`git log -S` 当场回读三条入库点：`minWidth: 1000` → `b1fc79a`；`agentEventOff` → `2487695`；
`scopedApprovalKey` → `b91680d`。三条都不是本轮写的，本轮只做**账对回盘**。

### 三、改了哪几处（都在本报告内，一处代码没碰）

1. 第七节 `:271`（看门狗）、`:276`（窗口地板）、`:277`（退订 + 批准键）三行现状重写，
   每行都带**文件:行**与入库提交，并注明「为什么这行会骗人」。
2. `:274`（配额）加一条当场复探结果与行号漂移；`:272`（青框）保留未修，不假装闭了。
3. 表下补一段引用块（对齐第六节 `:261` 那段既有形状）：哪四行过期、哪三行照旧、
   以及表头那批 `README.md:NNNN` 是**出处不是入口**（门面只有 102 行，照数去翻必然找不到）。

### 四、为什么更正不写进 `plans/README.md`（这条是刻意的，不是偷懒）

台账本体（`docs/superpowers/plans/README.md`）里同样有几句已经过期——`:6247` 那句「`main/index.ts` 没设 `minWidth`」、
`:6243` 挂件那条、`:12` 附近那句「UNBOUND 线程上的批准仍未做」，三条原文当场 `sed` 读回如下：

- 「**窗口能拖到 1000 地板以下**（`main/index.ts` 没设 `minWidth`），地板以下是裁掉而非可滚——本仓既有取舍，未在本轮顺手改。」
- 「**挂件层运行时**（波1b）与**新素材进表**（波2）仍卡在 ImageGen 403 配额；」
- 「余下「退订后不再收」查明**产品里没有消费方**（`startListening` 丢弃了退订函数），UNBOUND 线程上的批准仍未做——这两条不许升格成「真机验证」。」

**但我这次不动那份文件**：主树 `C:/Users/17863/Desktop/深渊写作` 当场 `git status --porcelain` 读回 165 条脏，
其中 `docs/superpowers/plans/README.md` 压着另一条会话 **+368 行未提交**改动（`git diff --stat HEAD --` 读回）。
同一时间改同一本台账，就是把他们的未评审改动卷进我的提交——这条规矩在第八刀前后撞过两次，
现抄录三条原文 + 文件行号，**等他们提交后由下一刀直接贴进去**。这条留白登记在案，不算闭。

### 五、门禁与推送

- 本轮只动 markdown，但门禁仍按整条跑：`format:check=0`（本节的表格与引用块重排过一遍 prettier）、
  `typecheck=0`、`lint:eslint=0`、`lint:boundary=0`、`lint:budget=0`、`test=0`。
- `pnpm test` 报 **312 文件 / 4101 passed | 2 skipped**（与第三十二节同一棵树，本刀不新增用例）。
- 提交后快进推 `feat/plan3-interaction-and-assembly` 与 `fix/ci-path-platform-neutrality`，
  `git ls-remote --heads` 当场回读两个 ref 都等于本地 HEAD 才算送达。
- **边界**：这一节没有真机、没有新断言（它要防的是「账与盘不一致」，不是代码形状）；
  报告里另一族「行号当入口」的引用（第十一节表、第十二节标题那两处 `README.md:12`）**不逐条改写**——
  按第二十九节第六目的口径，历史行号原样留着当出处。`:116` 那两格（P1-9 / P1-10）本轮也一并回读，
  判据与两次变异见第三十四节——那一句「照旧欠着」在那里改口成「三层运行时钉子已在，屏幕上的一次目检仍欠」。

## 三十四、2026-10-13：`:116` 那两格的回读——「只能起实例看」今天已经不是事实

### 一、当年那句话与现在盘上的差别

第六节 `:116` 写：「**这一波到目前为止没做的仍是真机复验**：P1-9 与 P1-10 都改在渲染层……
所以上表证明到的是用例与门禁，不是屏幕上量到的行为。」这句话在 2026-10-09 那棵树上是对的，
但它把这两格归进了「只能起实例才看得见」那一档，而盘上现在的形状是**三层运行时钉子**（当场逐份数过条数）：

| 层 | 文件 | 条数 | 钉住的那一件事 |
| --- | --- | --- | --- |
| 纯函数 | `utils/browse-read.test.ts` | 12 | 闸① 世代号：「换书之后，上一本书那次迟到的回包一个字都不许落地」「换书之后迟到的**失败**回包也不许把理由写进新书」；闸② 在途集合；闸③ 失败立刻可重试 |
| store | `stores/useBookStore.browse.test.ts` | 9 | 「两本书同名文稿都在浏览中：旧书那次慢回包不许盖掉新书已经落地的正文」——这一条是**接线**：走的是 store 真实动作，不是 util 直调 |
| 组件 | `components/document-pane-browse-body.test.ts` | 3 | 屏幕上那一格的取数走 `browseBodyViewOf(book.browseContents, book.browseErrors, …)`（`DocumentPane.vue:149`），失败理由换得掉「正在读取…」 |
| 纯函数 | `utils/goal-heat-labels.test.ts` | 5 | 星期与号数都从**那一格自己的日期**算；含一条当场切 `process.env.TZ` 的反向钉「按**本地**日历解析，不许被 UTC 拉走一天」 |
| 接线 | `components/goal-heat-weekday-wiring.test.ts` | 5 | 模板里必须出现 `weekdayLabelOfDateKey(day.date)` **恰好一次**，且 `weekdayLabels[` **零次**——当年那个「按下标贴标签」的写法一旦回来就红 |

### 二、两次变异：证明这些钉子**今天仍然会红**（不是只数文件在不在）

规矩照旧：只用 Edit 改、`cp` 备份、`cmp` 字节核对还原，改完立刻合跑一次确认回到全绿。

| 变异 | 改法 | 结果（日志 `/c/temp/m12-f/mut-m1.log`、`mut-m2.log`） |
| --- | --- | --- |
| M1 摘掉世代令牌 | `browse-read.ts:87` 成功分支那句 `if (epoch !== bookEpoch) return;` 删掉（失败分支那一行留着——只拆一半，看钉子有没有鉴别力） | `M1_EXIT=1`：**2 红 / 22 绿**。红的正是 `browse-read.test.ts` 那条「换书之后迟到的回包一个字都不许落地」与 store 那条「旧书慢回包不许盖掉新书正文」 |
| M2 把本地解析换成 UTC | `goal-heat-labels.ts` 的 `new Date(year, month - 1, day)` 换成 `new Date(key)`，跑时 `TZ=America/New_York` | `M2_EXIT=1`：**1 红 / 9 绿**，红的就是那条专门防 UTC 的钉子（UTC 零点落到本地前一天，标签整排错一天——正是 2026-10-09 那个 bug 的成因形状） |
| 还原 | 两份文件 `cp` 回来 + `cmp` 双双重读一致；`git status --porcelain` 当场读回 **0 条** | 五份合跑 `RESTORE_RUN_EXIT=0`：**5 文件 / 34 条全绿** |

M1 只拆成功分支那一半就有两条红，说明这一族不是「多写一份用例求心安」：util 与 store 两层各自都能独立发现丢令牌。

### 三、屏幕上仍欠的那一次目检，与它的真实分量

如实写：**P1-9 / P1-10 都没有做过一次真机目检**，本仓 `.vue` 不进类型程序、没有 jsdom，
组件层能钉到「渲染点调的是哪个函数、参数取哪两个表」，钉不到像素。所以 `:116` 那句不能整条撤掉，
只能改口：**判据不再只剩"起实例看"这一条路**——丢令牌、迟到回包盖新书、失败格永久「正在读取…」、
星期按下标贴，这四个形状现在都有会红的运行时钉子；屏幕上那一次目检仍是欠账，等下一次真机巡检一起做，
而且那时若还红，能立刻定位到是哪一层（util / store / 组件）而不是从头猜。

同段落的另外两格现状：P1-3 的截断提示**已在第十九节逐字量到上屏**；
**P1-6 的并发写互斥照旧只到用例与门禁**，本轮没为它新增任何证据。

### 四、门禁与推送

本刀只动 markdown（代码那两处只是变异，已还原并 `cmp` 核对 + porcelain 读回 0 条），
但门禁仍整条跑：`format:check=0`、`typecheck=0`、`lint:eslint=0`、`lint:boundary=0`、`lint:budget=0`、`test=0`；
`pnpm test` 报 **312 文件 / 4101 passed | 2 skipped**（与第三十二/三十三节同一格数，本刀不新增用例）。
提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD 才算送达。

## 三十五、2026-10-13：这三刀的 CI 读数集中记一格——run 号、分支、时长，逐个从 run 页文本回读

### 一、为什么单独开这一节

上一节末尾那句「`git ls-remote --heads` 回读等于本地 HEAD 才算送达」证明的是**送达**，不是**门禁在干净 runner 上也过**——
这两件事在本仓已经被打混过至少一次：第三十二节里我自己把 run 号 `38324586323` 抄成 `38224586323`，
当时是照着记忆写而不是照着页面写。所以这三刀推完之后，把六个 run 的读数集中记成一格：
**下一轮要复核「f4753b8 到底绿没绿」不必重新翻 Actions，也不必再抄一遍容易抄错的数字。**

读法照旧：结论只从 run 页的 `Status` 文本或列表页 `svg[aria-label]` 取，**绝不从提交标题里抓状态**；
时长取 run 页的 `Total duration` 与作业名下方那一行。

### 二、六次读数

| 提交 | 分支 | run 号 | 结论 | 总时长 / `六路 typecheck + lint + boundary + budget + 全量测试` 作业 | Vitest 作业摘要 |
| --- | --- | --- | --- | --- | --- |
| `f4753b8`（门面指向纠正 + `tools/readme-claims.test.mjs`） | `fix/ci-path-platform-neutrality` | `38334268848`（#50） | **Success** | 1m31s / 1m27s | Test Files 312 passes · 312 total |
| `f4753b8` | `feat/plan3-interaction-and-assembly` | `38334268894`（#51） | **Success** | 2m8s / 2m3s | Test Results 4100 passes · 4100 total |
| `c5a0e65`（第七节九行逐条对回盘面） | `feat/plan3-interaction-and-assembly` | `38335271363`（#52） | **Success** | 2m27s / 2m22s | 同上一行，六个 run 一字不差 |
| `c5a0e65` | `fix/ci-path-platform-neutrality` | `38335271384`（#53） | **Success** | 2m1s / 1m57s | 同上 |
| `15718f4`（`:116` 两格 + 两次变异） | `feat/plan3-interaction-and-assembly` | `38335896954`（#54） | **Success** | 2m35s / 2m30s | 同上 |
| `15718f4` | `fix/ci-path-platform-neutrality` | `38335897449`（#55） | **Success** | 2m23s / 2m19s | 同上 |

六格都是**本轮从各自的 run 摘要页整页读回**的（`Status`、`Total duration`、作业行、`Vitest Test Report` 四段文本），
不是从列表页的图标推断，更不是从提交标题里抓状态。
`15718f4` 这两格是**同一棵提交树上两个分支各跑一次**——同一份 markdown 改动在两条 ref 上都过闸，不是只有一条 ref 侥幸。

### 三、CI 的 4100 与本机的 4101 差一条，这一格没闭合

本机这一轮 `pnpm test`（同一棵工作树，`15718f4` + 本刀 markdown）报 **312 文件 / 4101 passed | 2 skipped（4103 条）**，
日志 `/c/temp/m12-f/s35-test.log:387-388`；而六个 run 的 Vitest 作业摘要**一字不差**是
**Test Files 312 passes · 312 total / Test Results 4100 passes · 4100 total**。

把算式摆开：本机那 2 条 skip 是单列的、不含在 4101 里，所以「passed 对 passed」是 **4101 对 4100，差 1 条**；
CI 那一侧 total 就等于 passes（没有 skip 进 total）。
而且这六个 run 从 `f4753b8` 到 `15718f4` 都是同一个 4100——后四格跑的树只多了 markdown，
所以**这一条差不是这三刀引进来的，是本轮之前就在的平台差异**。

**没当场定位差在哪一条**，这里只登记不结论。要查的方向（写明是猜测）：CI 摘要只统计 passes，
把 skip 从 total 里排掉，而本机有一条在 Linux 上被跳过、在 Windows 上反倒算 passed 的用例
（`packages/fs-store/test/atomic-write.test.ts` 那条打印「[环境噪音] 本机建不了符号链接（EPERM）」的是最可疑的一枚，
但它在日志里显示的是「没验到」而不是「passed」，所以还不能定罪）。记成下一格：
**报测试数必须连着「跑在哪棵树、哪个平台、skip 计不计入 total」，跨平台的 ±1 不是四舍五入。**

【2026-10-13 当轮闭合，见第三十六节】这一格没留到下一轮：差的那 1 条是 `path-boundary.test.ts:76` 按平台注册 4 条 / 1 条
与 `changes.test.ts:247`、`:302` 两条 `skipIf(win32)` 相抵的结果，`4103 − 3 = 4100` 与 CI 那个 4100 一分不差。
上面那句「最可疑的一枚是 EPERM 那条」是**猜测且方向错了**——它确实相关，但机制不是「Windows 反倒算 passed」，
而是它在 POSIX 上不再被跳过（+2），同时 win32 分支多出的 3 条注册在 Linux 上不存在（−3）。

### 四、这一节没做的事

- 没点开逐作业日志（只读 run 摘要页文本），所以第三节的 ±1 没定位；
- 写这一节的过程中 GitHub 有**七次连接失败**：`38335897449`（#55）一次 `ERR_CONNECTION_RESET`，
  `38334268848`（#50）连续四次 `ERR_CONNECTION_TIMED_OUT`（中间等 40 秒再试仍旧超时），
  feat 分支列表页与 `38334268894`（#51）各一次超时。连接恢复后**六格全部从各自 run 页重读成功**，
  所以表里没有一格是「靠早些时候的读数」或「靠记忆」留下的——但这次抖动本身要记：
  本机外网不稳，**CI 回读必须在这一刀内做完**，排在提交之后再补只会留下一个没人核过的空格。

### 五、门禁与推送

本刀仍然只动 markdown，改前 `git status --porcelain` 读回 0 条（只有这一份文件）。
六段门禁在**定稿后**整条重跑一遍，逐段落盘取码写进 `/c/temp/m12-f/s35b-exit.txt`（第一次整条跑在定稿前，
`formatcheck / typecheck / linteslint / lintboundary / lintbudget / test` 六段全 0，日志 `s35-*.log`，
唯一 grep 命中是已知环境噪音那行 EPERM）；本机 `pnpm test` 报 **312 文件 / 4101 passed | 2 skipped（4103）**，
也就是第三节那格 ±1 的来源侧。
提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD 才算送达。

## 三十六、2026-10-13：第三十五节第三节那格 ±1 就地闭合——差的不是用例，是「同一份文件在两个平台注册了几条」

### 一、结论先摆

CI 报 4100、本机报 4101，**两边都没错，也没有一条用例在本机被多算了**。
全仓只有两处会按平台改变**注册条数**（当场 `grep -rn 'win32|process.platform|os.platform|darwin'` 扫过
`packages apps tools` 的 `*.test.ts` 与 `*.test.mjs`，命中的其余几处要么是用例体内的分支、要么是注释）：

| 位置 | Windows | Linux | 对 total 的净影响 |
| --- | --- | --- | --- |
| `packages/fs-store/test/path-boundary.test.ts:76` 的 `if (win32) { 4 条 it } else { 1 条 it }` | 注册 **4** 条（大小写差异不算越界、两边异构压平、真 fs 根小写、samePath 压平） | 注册 **1** 条（`samePath`：POSIX 上大小写是两个不同名字，不许压平） | **−3** |
| `packages/fs-store/test/changes.test.ts:247`、`:302` 两条 `it.skipIf(win32)`（文件软链与备份句柄软链） | 算 **skipped**，不进 passed | 真跑且过，进 passed | **+2**（对 passed 而言） |

本机 4103 条注册 − 3 = **4100**，而 Linux 那侧没有任何 skip（两处平台判断里只有 `skipIf(win32)` 这一族，它在 POSIX 上不触发），
所以 Linux 是 **4100 passes · 4100 total**——与六个 run 摘要那两个数字**一分不差**；
本机则是 4103 − 2 skip = **4101 passed**。第三十五节说的「差 1 条 passed」到这里就不是悬案：
**−3 与 +2 相加正好是 −1。**

### 二、这两处到底各有多少条，是量出来的不是数的

单独跑这两个文件（日志 `/c/temp/m12-f/s36-platform-files.log`，`VITEST_EXIT=0`）：

```
✓ packages/fs-store/test/changes.test.ts (35 tests | 2 skipped)
  Test Files  2 passed (2)
       Tests  54 passed | 2 skipped (56)
```

`56 − 35 = 21` 就是 `path-boundary.test.ts` 在 Windows 上的注册条数；按上表换到 Linux 应为 `21 − 4 + 1 = 18`，
而 `changes.test.ts` 的 35 条一条不少——**两个文件在 Linux 上合计 53 条、Windows 上 54 条，差的这一条正是全仓那 ±1**，
不需要动用任何别的解释。

### 三、这一格的成色：哪部分是看到的，哪部分是推出来的

如实拆开写：

- **看到的**：本机两文件的 54 / 56 / 2 skipped 是这次当场跑的；六个 run 的 `312 / 4100 passes · 4100 total` 是第三十五节从 run 页整页读的；`if/else` 与 `skipIf` 的条数是逐行数过 `:76` 那块（4 条在 win32 分支、1 条在 else）并 `grep` 确认全仓再无第二处。
- **推出来的**：Linux 上的 18 / 35 与合计 4100——**没有打开过逐作业日志**，所以这一格靠的是「代码里的平台分支 + 两侧各自的总数」对账，不是 Linux 侧的直接读数。
- **对账为什么仍然算闭合**：等式两端都没有剩余。若 Linux 还有一条本机不知道的用例被跳过或多跑，`4103 − 3 = 4100` 就会对不上 CI 那个 4100；两个独立来源（本机跑数 + CI 摘要）落在同一个数字上，才是这条推导的依据。

### 四、这一格留下的规矩，与下一刀

规矩写进报数口径：**报测试数必须连着「哪棵树、哪个平台、skip 算不算进 total」三件**，缺一件就会出现这次这种「两个都对但看着差一条」。
真正的下一刀不是重跑 Linux，而是让这台机器自己说得清——把这两处平台分支的**条数**钉成一条守卫用例
（例如断言 `path-boundary.test.ts` 在 win32 下注册 4 条、POSIX 下 1 条，形状同 `tools/readme-claims.test.mjs` 那种「提取到东西没有」的自我声明），
否则下一次再有人动了这块 `if/else`，±1 会换个数字回来，而那时没人知道它是几。

### 五、门禁与推送

本刀同样只动这一份 markdown；六段门禁逐段落盘取码（`/c/temp/m12-f/s36-exit.txt`），
提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD 才算送达。

## 三十七、2026-10-13：把「平台分支注册几条」钉成守卫——`tools/platform-test-count.test.mjs`

### 一、这一刀补的是第三节末自己点名的那一格

第三十六节把 ±1 算清了，但它靠的是**散文 + 人数的条数**：`path-boundary.test.ts:76` 那块 4 条 / 1 条、
`changes.test.ts` 两枚 `it.skipIf(win32)`。下一个人在那两个分支里加一条用例、或摘掉一枚 `skipIf`，
本机与 CI 的报数就各自漂移，而没有人知道漂移是多少——这正是本仓反复出现的那类病灶（**账还在，指针对不着**）。
所以新建 `tools/platform-test-count.test.mjs`，把差值本身钉住。

它**不测代码行为**，只测两个文件里的注册形状，与 `tools/readme-claims.test.mjs` 同一族（门面/账目守卫）。

### 二、五枚断言与各自的牙齿

| 断言 | 判据 | 从哪儿提取 |
| --- | --- | --- |
| 提取自我声明 | win32 分支 ≥ 1 条、POSIX 分支 ≥ 1 条、`skipIf` ≥ 1 枚 | 行走花括号取两段原文，再数**行首**的 `it(` |
| win32 − POSIX = **3** | 4 − 1 | `if (process.platform === "win32") { … } else { … }` 两段 |
| `it.skipIf(win32)` = **2** | changes.test.ts 里「POSIX 才真跑」的软链用例 | 全文正则计数 |
| 本机 passed − Linux passed = **1** | `3 − 2`，即第三十六节那格 ±1 的算式本体 | 上面三个数相减 |
| 全仓注册期平台分支只有两处 | `path-boundary` + `write-queue`（后者是用例体内分支，不计数） | 扫 `packages/fs-store/test/*.test.ts` 里含同一锚点的文件 |

锚点找不到时**直接抛错**而不是返回空：`if (process.platform === "win32") {` 这一串被改名或换写法，
守卫当场炸（`Test Files 1 failed / Tests no tests`），不给它「提取不到就当没问题」的机会。

写这份守卫的过程中它先红过一次，红得有价值：第一版行走括号时把 `} else {` 的那枚 `}` 当成整个语句的收尾，
POSIX 分支提取到 0 条 ⇒ 差值算成 4 − 0 = 4 ⇒ 三条断言同时红（日志 `/c/temp/m12-f/guard-green2.log`）。
那是它第一次证明自己能发现「提取塌了」，修完才绿（`guard-green3.log`，5 枚全过）。

### 三、三次变异：每条判据都当场拆一遍

照旧只用 Edit 改、`cp` 备份、`cmp` 字节核对还原（备份 `path-boundary.orig.ts`、`changes.orig.ts`）。

| 变异 | 改法 | 结果 |
| --- | --- | --- |
| G1 win32 分支塞一条恒绿用例 | `path-boundary.test.ts:76` 块首加 `it("Windows：变异占位…")` | `M1_EXIT=1`：**2 红 / 3 绿**，红的两条报「差成 5 − 1 = 4」「passed 相对 Linux 差 2 条」（`mut-g1.log`） |
| G2 摘掉一枚 `skipIf` | `changes.test.ts:247` 的 `it.skipIf(process.platform === "win32")(` 换成 `it(` | `M2_EXIT=1`：**2 红 / 3 绿**，报「`it.skipIf(win32)` 现在是 1 条」「差 2 条」（`mut-g2.log`） |
| G3 改名锚点 | `if (process.platform === "win32") {` → `if (IS_WIN) {` | `M3_EXIT=1`：**1 文件红 / 0 条用例**，错误信息就是那句「找不到锚点」——证明它不会静默装绿（`mut-g3.log`） |
| 还原 | 两份文件 `cp` 回来 + `cmp` 双双重读一致，`git status --porcelain` 读回只剩 `?? tools/platform-test-count.test.mjs` | 三份合跑 `RESTORE_RUN_EXIT=0`：**3 文件 / 59 passed \| 2 skipped（61）**，与第三十六节那两个文件的 Windows 读数（21 + 35 = 56）加本刀 5 条正好对上 |

### 四、边界：它管不到的部分要写明

- **census 只扫 `packages/fs-store/test/`**。别的目录将来若新增注册期平台分支，这一格不会响——
  所以文件名清单和判据都写在断言的错误信息里，命中的人知道去哪儿补；把它扩成全仓扫描是另一刀（要先能区分「注册期分叉」与「用例体内分支」）。
- **数的是行首 `it(`**，`it.each` / 缩进异常的写法会被漏掉；漏掉的形状由「提取自我声明」那一枚兜住一半（0 条就红）。
- 它钉的是**差值**，不是绝对总数：加别的用例不会误伤，这是刻意的，否则每一刀都要来改这里。

### 五、门禁与推送

本刀新增 1 个 `tools/*.test.mjs`（5 条用例），其余只动这一份 markdown；两次变异已全部还原并 `cmp` 核对。
六段门禁逐段落盘取码写进 `/c/temp/m12-f/s37-exit.txt`，本机 `pnpm test` 的报数从这一刀起是
**313 文件 / 4106 passed | 2 skipped（4108）**——比第三十六节多 1 个文件、5 条 passed，
而 Linux 侧应当是 4105（差值仍是 1，由新守卫自己盯着）。
提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD 才算送达。

## 三十八、2026-10-13：新立的出处闸，我回头拆它——它初版**放过了它要拦的写法**

### 一、病根：一条拦「裸数」的闸，被「零脏项」三个字糊过去

本刀给 `tools/readme-claims.test.mjs` 加第三族：**「## 门禁」那一节里的每条测试数主张都得连着出处**。
它自己经历了三轮，两轮都朝错误的方向修，最后那一版才是能用的，全程都在同一棵未提交的树上：

1. **初版 = 日期 + 必须有哈希**。当场误红在门面那句合理的历史教训上
   （`readme-guard-r1.log`：`这些测试数没连着出处（要同时有一枚反引号提交哈希和一个日期）：2026-10-12 又补一条更细的教训：本机在 2026-10-11 读到过 **328 文件 / 4261 用例**`）。
   那一句本来就在说「这棵树不作数」，要它出示哈希是苛——**这是假红，得改判据**。
2. **放宽版 = 日期 +（哈希 或 词表 `脏|未跟踪|未入库`）**。改完它绿了，于是我照惯例变异：
   把 README:46 那枚 `` `c9708b9` `` 删掉，句子留着「**当场读回零脏项**的已提交工作树」。屏上读回是
   `R1_EXIT=0`，日志 `/c/temp/m12-f/mut-readme-r1.log` 写着 `Test Files 1 passed (1)` / `Tests 4 passed (4)`——
   **变异活下来了**。原因一眼见血：词表里有「脏」这个字，而「零**脏**项」是它的**反义词**。
   于是那句宣称自己跑得最干净的数，反倒最不需要出处；而本来就声明不作数的那句却被认真对待。
   这是本仓登记过的同一族病灶的**新亚种**：不是假控件，也不是指向别处，而是**判据的词表方向写反**——
   守卫照样全绿，只是它绿的正好是该红的那种写法。
3. **收紧版 = 两支分开判**（第二节）。放宽不是答案，初版也不是：两支各有合法写法，合成一个词表就把语义读反了。

**两次红/绿的教训合起来是一句话：「数有没有出处」是要看语义的，写成一次正则命中就一定会漏——
所以判据必须拆成两支，并且每一支都得有变异盯着。**

### 二、收紧后的规则：两支分开判，且「宣称干净」优先

| 支 | 触发词 | 要求 |
| --- | --- | --- |
| 当成权威的数 | `干净 \| 零脏项 \| 已提交 \| 读回\s*0\s*条` | 日期 **+ 反引号提交哈希**（哈希是唯一能被 `git show` 追回去的东西；「当场读回零脏项」这句话本身会过期） |
| 本来就声明不作数的数 | `未跟踪 \| 未入库 \| 未提交`（**窄选**：只在这类「树不干净」的句子里出现） | 只要日期 |

两句同现时**干净支赢**（`dirtyWorded = DIRTY && !CLEAN`）：同一句话既说未跟踪又说读回 0 条，那就按更响的那句要出处。
另外补一族断言盯**干净支在门面上得有实例**（带哈希的数 ≥ 1 条，且其中至少一条明写「干净/已提交/零脏项」）——
干净支落空时，R1 那种写法就一路绿灯，而这恰恰是抽取正则写坏之外的第二种「空跑即绿」。
脏树支不做这条要求：它落空只会让规则更严，不会放水。

### 三、五发变异：每条判据当场拆一遍

只用 Edit 改 README，备份 `/c/temp/m12-f/README.orig.md`，每发跑完 `cp` 回来 + `cmp` 核对（五次全 `RESTORE_SAME`）。
表里的名字就是日志文件名，`R3` 与 `R3b` 是同一判据的两次尝试（见第四节），**编号里没有 R4**——
没有这一发实跑，也不为凑连续补造一次。

| 变异 | 改法 | 结果 |
| --- | --- | --- |
| R1（放宽版） | 删 `` `c9708b9` ``，留「零脏项」 | `R1_EXIT=0`，`Tests 4 passed (4)`——**活下来**，就是第一节第 2 步那一枚 |
| R2（收紧后同一处） | 同上，规则换成两支 | `R2_EXIT=1`：**1 红 / 4 绿**，红的就是那句「宣称跑在干净或已提交的树上时，只有哈希算出处」（`s38-r2.log`） |
| R3 | 只删「本机在 **2026-10-11** 读到过」那半截日期 | `R3_EXIT=0`——**活下来**（`s38-r3.log`：`Tests 5 passed (5)`），见第四节的边界 |
| R3b | 删 CI 那一格的日期「（**2026-10-12** 那一轮）」 | `R3B_EXIT=1`：**1 红**，句子换成「`e4b52e4` 那一轮」后再没有 `YYYY-MM-DD`——日期这一条是有牙齿的（`s38-r3b.log`） |
| R5 | 两处哈希**都**删，并改成「压着未跟踪文件的树 / 未入库草稿的树」 | `R5_EXIT=1`：**2 枚红**——① 覆盖声明报 `expected 0 to be greater than 0`（门面上的数一条哈希都不带了，「干净提交树上的数以 CI 为准」退成空话）；② 311 那一格因为句末留着「读回 0 条」仍落进干净支。两枚同时红正是第一节那条优先序的证据（`s38-r5.log`） |
| 还原后全绿 | `README.md` 与备份 `cmp` 一致，`git status --porcelain` 只剩 ` M tools/readme-claims.test.mjs` | `GUARD_EXIT=0`：**5 passed**（`s38-guard.log`） |

R5 没能把覆盖声明**单独**摘出来红（那一格还搭着一枚干净支的红），这里如实写清：归属靠的是错误信息本身——
`「## 门禁」一节里没有任何一条测试数带反引号提交哈希` 只有那一条断言会说这句话。要做到完全隔离得把「读回 0 条」
一起改写，那是编辑门面文案而不是编辑判据，不值当为一次变异多烧一轮。

### 四、边界：R3 活着说明这件事（写明，不藏）

句子是按 `。；;` 切的。R3 只删了「本机在 2026-10-11」，可同一句开头还有「2026-10-12 又补一条更细的教训：」，
日期要求因此照样满足 ⇒ **这条闸管的是「这一句里有没有日期」，不管「日期离数字近不近」**。
真要收紧到紧邻数字，得把提取换成窗口式（数字前后 N 字内），而门面那句话的写法一改，N 就成了新的魔法数——
留作下一格，不在本刀顺手做。同族的已知漏网面还有两处：数只在「## 门禁」一节里提取，别处写数它不响；
`「…」` 里的反例整段剥掉，所以把真主张写进引号里就能躲过这一族（那是散文层的事，不是判据层）。

### 五、这一节的另一件事：第三十六、三十七两刀的送达

GitHub 连不上那段时间挂的重试循环（后台 `b26ubfeai`，日志 `/c/temp/m12-f/s37-pushloop.log`）已跑完并回读：
attempt 1–2 两个 ref 全 128（`Failed to connect … Could not connect to server` / `Recv failure: Connection was reset`），
attempt 3 只送上 fix 分支，attempt 4 又两头红，attempt 5 双 0。落盘的最后三行是判据本体：

```
   3afff2d..6c1fb91  HEAD -> feat/plan3-interaction-and-assembly
6c1fb91ce36440e7569a163a9c9333fdefe80e73	refs/heads/feat/plan3-interaction-and-assembly
6c1fb91ce36440e7569a163a9c9333fdefe80e73	refs/heads/fix/ci-path-platform-neutrality
```

两个 ref 都等于本地 HEAD ⇒ `5b91cc6` 与 `6c1fb91` 这两刀**已送达**（都是快进，无强推）。
这一格对远端只做了两件事：`git push`（快进）与 `git ls-remote --heads`（只读回读）——
没动任何分支保护设置，没碰 `main`（它照旧停在 `c475caf`）。

### 六、本刀的门禁与推送

改动面只有一个文件：`tools/readme-claims.test.mjs` 从 3 条用例加到 5 条（第三族整族是新加的，
`git show HEAD:tools/readme-claims.test.mjs` 数得出 3 枚 `^test(`，工作树数得出 5 枚），加这一份 markdown。
**没有新文件**，所以文件数不动。

六段门禁跑了两遍以上，都逐段落盘取码，但**只有最后一遍对得上提交内容**：

- 第一遍 `/c/temp/m12-f/s38-exit.txt`：`format_check / typecheck / lint_eslint / lint_boundary / lint_budget / test`
  六枚退出码**全 0**，`test_EXIT=0` 那一格报
  `Test Files 313 passed (313)` / `Tests 4108 passed | 2 skipped (4110)`。
  与第三十七节的 4106 相比多 2 条 passed——**差的正好是本刀新加的两条断言**，不是别处漂移。
- 但第一遍跑在中途：`format:check` 取码那一刻（10:57）我还在写这一节，所以它对 markdown **不作数**。
  第二遍（`s38b-exit.txt`，六枚码同样全 0、读数一致）起跑后我又改了第三、五节的文字并重命名了一条用例，
  于是它对最终内容同样不作数。第三遍（`s38c-*`）跑到一半被我**主动叫停**——回读守卫原文时发现它的注释
  写的是「两支都有实例」，而断言实际只盯干净支：**注释在说一件判据没做的事**，这正是本仓那族「数据删了、
  文案还在说它可用」的病灶换了个地方长，所以宁可作废一遍门禁也要先改注释。
  **这三遍合起来记一条：「跑过门禁」不等于「跑过提交的那棵树」**——共用一棵工作树、边写台账边跑门禁时尤其容易把这两件事混成一件。
- 定稿那一遍是 `/c/temp/m12-f/s38-final-exit.txt`：六枚退出码全 0，`test` 读数与前两遍一致（313 文件 /
  4108 passed \| 2 skipped，即 4110 条注册），**提交的就是这一遍覆盖的那棵树**。
- 日志里唯一的红字命中仍是那条已知环境噪音：`[环境噪音] 本机建不了符号链接（EPERM），软链逃逸那一条没验到`
  （`s38-test.log:99`，`packages/fs-store/test/atomic-write.test.ts`），Linux 侧该条真跑，属第三十六节那两支之一。

推送照旧快进两个 ref，`git ls-remote --heads` 回读等于本地 HEAD 才算送达；GitHub 今天连不上过（第五节那串 attempt），
送达以回读的那两行为准，不以「push 命令返回 0」为准。

### 七、这一刀**没做**的事（写明，不藏）

- **README 里的数没回填**：门面上现在最响的两条是 CI 的 304/3965（`e4b52e4`）与本机 311/4098（`c9708b9`），
  而本刀把本机数推到 313/4108。没有回填，是因为门面那句话讲的是一个**具体测量事件**，要换就得连着
  「跑在哪棵树 + 该树的哈希 + 当场读回的 `git status --porcelain` 0 条」一起换——那是一次独立的报数刀，
  不该夹在守卫修复里顺手做。
- **CI 上 `5b91cc6` / `6c1fb91` / 本刀这三格的 run 还没读回**：第三十六节 Linux 侧 18/35 至今是**推出来的**，
  不是从逐作业日志读的。这是下一格的内容，本刀不冒充已完成。
- 判据层没动的两处：日期只要求**同句内**存在（R3 活着的原样，第四节）；提取面只覆盖「## 门禁」一节。
  两者都是刻意留的边界，不是漏。

## 三十九、2026-10-13：把第三十六节第三节那句「推出来的」换成读来的——Linux 侧 18 / 35 / 4105 全部对上

### 一、欠的是哪两句话

第三十六节第三节（「这一格的成色：哪部分是看到的，哪部分是推出来的」）自己划的线：「**推出来的**：Linux 上的 18 / 35 与合计 4100——**没有打开过逐作业日志**」；
第三十七节末尾又押了一句预测「Linux 侧应当是 **4105**」。两句当时都不是读数。
本刀把它们打开看了，两枚都对。

### 二、读数从哪儿来：run #59 = `6c1fb91` @ `feat/plan3-interaction-and-assembly`

run 摘要页整页读回（判据形状照第三十五节那条规矩：只认 run 页文本与 `svg[aria-label]`，不从提交标题抓状态）：

| 字段 | 读回的原文 |
| --- | --- |
| run | `38339035996`，页面上是「门禁 pnpm verify **#59**」，commit `6c1fb91`，分支 feat |
| 状态 | `Status Success`；页内 `svg[aria-label]` 四枚全是 `completed successfully` |
| 时长 | `Total duration 2m 29s`，作业行 `六路 typecheck + lint + boundary + budget + 全量测试 2m 24s` |
| 摘要报告 | `Vitest Test Report` / `Test Files: ✅ 313 passes · 313 total` / `Test Results: ✅ **4105** passes · 4105 total` / `Job summary generated at run-time` |

逐作业日志里那两个文件（`Test Results` 只给总数，**每文件条数只在步骤日志里**）。
下面引的是剥掉 ANSI 着色序列之后的文本，行首时间戳是日志自带的 UTC 时刻，不是转述：

```
2026-10-13T02:54:42.0269115Z  ✓ packages/fs-store/test/changes.test.ts (35 tests) 2193ms
2026-10-13T02:54:49.5501685Z  ✓ packages/fs-store/test/path-boundary.test.ts (18 tests) 56ms
2026-10-13T02:55:41.8397897Z  Test Files 313 passed (313)
```

`changes.test.ts` 那一行**没有** `| 2 skipped`——正是 `it.skipIf(process.platform === "win32")` 在 Linux 上不跳。

### 三、两头合起来，残余归零，而且每个数都指着它的出处

| 数 | Windows（本机同树实测） | Linux（run #59 日志 / 摘要页） | 与推导是否一致 |
| --- | --- | --- | --- |
| `path-boundary.test.ts` | 21 | **18** | 第三十六节推的 −3 ⇒ 读回 18，一致 |
| `changes.test.ts` | 35 注册、**2 skipped**（⇒ 33 passed） | **35 注册、0 skipped** | 推的 +2 passed ⇒ 一致 |
| passed 合计（树 `6c1fb91`） | **4106** | **4105** | `4105 + 3 − 2 = 4106`，差仍是那 1 条 |
| 注册合计（树 `6c1fb91`） | 4108（4106 passed + 2 skipped） | **4105**（total 里不含 skip） | +3，与平台分支那一刀正好 |

⇒ 第三十六节 `4103 − 3 = 4100` 那一族算式，**从这一格起两端都是读出来的**，没有一格靠推。

### 四、通路（这一族下次照抄，两条都是本刀实测出来的，不是设想）

1. **摘要页只给总数**；每文件条数在步骤日志里，得进作业页。
2. 新版 Actions UI 的日志**不在 DOM 文本里**：页面 `fetch` 一个签名 Azure Blob。
   端点形状是 `GET /<owner>/<repo>/commit/<sha>/checks/<checkJobId>/logs/<stepNo>`（本刀是 `.../checks/115105642630/logs/7`），
   它 302 到 `https://productionresultssa<N>.blob.core.windows.net/actions-results/.../steps/step-logs-*.txt`。
   **在页内直接 `fetch` 那个 github.com 端点会 `TypeError: Failed to fetch`**（跨源重定向不放行，实测撞到的），
   正解是从 `list_network_requests` 里取**重定向之后的 blob URL**再 fetch——blob 那条能读，
   本刀拿到 61,625 字节，按行过滤 `path-boundary|changes|Test Files` 只回 4 行，一次调用就够。
3. 展开步骤要点 `check-step` 里的 `summary.CheckStep-header`；本刀点了两次都没把日志挂进 DOM
   （`#job-logs-container`、`job-logs`、`logs-viewer` 全查不到，`check-step.shadowRoot` 也没有内容），
   最后是从网络请求里拿到的 URL。⇒ **别把「日志面板打开了」当成「日志读到了」的证据**，要读到的是文本本身。
4. 签名 URL 有有效期（`se=` / `st=` 那对参数，本刀拿到的是 10 分钟窗），所以取到就立刻用，别存着下轮再取。

### 五、这一格仍欠的（不冒充已完成）

- **run #61 = `1e0c215` 没读到**：导航过去时 `ERR_CONNECTION_TIMED_OUT`（这台机器今天下午第六次撞到 GitHub 不可达，
  推送那一族也是同一副症状）。预期它是 **4107 passed**（本机 4108 − 1），但那句是**由新守卫推的**，
  读回来之前它只是预测，不进 README、不算账。
- `fix/ci-path-platform-neutrality` 上那一格孪生 run 同样没读。
- 那两枚 `it.skipIf` 在 Linux 上**具体是哪两条用例**没点名（日志只给条数）；要点名得读用例标题，是另一格。

### 六、顺带把门面上的数换了新的（这就是第三十八节「没做的事」第一条留的那一刀）

第三十八节写明「README 里的数没回填」，本刀做掉：门禁那一节的两条数换成
「CI 在 Linux 干净提交树 `6c1fb91`（2026-10-13，run #59）报 **313 文件 / 4105 用例**」与
「本机 Windows 在 `1e0c215`（2026-10-13）实测 **313 文件 / 4108 passed \| 2 skipped**」，
并补一句**这两个数不是同树对照**（`1e0c215` 比 `6c1fb91` 多 2 条守卫用例），同树对照是 4105 vs 4106。
写之前当场读回 `git status --porcelain` = 0 条、`git rev-parse HEAD` = `1e0c215ebe201fa3003b62a469fb237379c99327`。
换数之后的第一次跑，旧的那两格（`e4b52e4` 304/3965、`c9708b9` 311/4098）就地消失，
不再需要「历史数」的注脚——因为它们本来就是「最近一次实测」那一族，被新的实测顶掉是它的正常生命周期。

换完先跑了一次**只针对这族闸**的 scoped 检查：`vitest run tools/readme-claims.test.mjs` ⇒ `GUARD_EXIT=0`、
`Tests 5 passed (5)`（日志 `/c/temp/m12-f/s39-readme-guard.log`），`prettier --check README.md` 也 0。
新的两条数都带着日期 + 反引号哈希，所以第三十八节那族「宣称干净必须有哈希」的判据是**当场满足**的，不是靠放宽。

### 七、门禁与推送

本刀只动两份 markdown（这一份 + `README.md`），没有一行代码或用例改动，所以条数不动：
定稿那一遍六段退出码全 0 落在 `/c/temp/m12-f/s39-exit.txt`，`test` 那一格仍是
**313 文件 / 4108 passed | 2 skipped（4110）**——与第三十八节定稿那遍逐字相同，这正是「只动 markdown」的读数证据。
scoped 之外照旧跑满六段（`format:check / typecheck / lint:eslint / lint:boundary / lint:budget / test`），
不在本刀里用「反正只改了文档」当理由跳段。

第三十八节那条「**跑过门禁**不等于**跑过提交的那棵树**」在本刀当场复发了一次：第一遍六段全 0
（`/c/temp/m12-f/s39-run1-exit.txt`，`Test Files 313 passed (313)` / `Tests 4108 passed | 2 skipped (4110)`）
跑完之后，我把这一节的标题与第一节那句出处从「第三十六节结尾」改成「**第三十六节第三节**」——
逐条回盘其余跨节引用时发现其余都对得上（`4103 − 3 = 4100` 在第三十六节、`Linux 侧应当是 4105` 在第三十七节末、
「README 里的数没回填」在第三十八节第七节第一条），只有这一处把小节位置说高了。**说高也是错**，所以作废那一遍：
它覆盖的不是最终内容。定稿那一遍才是提交的那棵树，两遍的日志与退出码分开留档，不以第一遍冒充。

提交后快进推两个 ref，判据仍是 `git ls-remote --heads` 回读等于本地 HEAD；
run #61 那格等 GitHub 可达再读，读回来之前第五节那句预测不进门面。

**当场回读补正（同一刀内）**：那句「定稿那一遍六段退出码全 0 落在 `/c/temp/m12-f/s39-exit.txt`」在写下时是**承诺**，
不是读数——写它的时候那一遍还没跑。它随后真的跑了：六枚退出码全 0，`Test Files 313 passed (313)` /
`Tests 4108 passed | 2 skipped (4110)`。承诺后来兑现不等于承诺当时可以写成读数，所以这一段把两者的先后写明。

## 四十、2026-10-13：Linux 侧从「两棵树各说各话」读成「同一棵树上差 1 条」——run #61 / #62 两格读数落盘

### 一、这一刀读回来的是哪三行数

第三十九节第五节欠的 run #61 今夜读到了，顺带把本刀提交自己触发的 #62 也读了。逐行照第三十五节那条规矩：
只认 run 页文本与 `svg[aria-label]`，不从提交标题抓状态。

| run | 页 ID | 树 | 页面上读回的原文 |
| --- | --- | --- | --- |
| **#61** | `38340571768` | `1e0c215` @ feat | `Status Success`、`Total duration 1m 54s`、作业行 `六路 typecheck + lint + boundary + budget + 全量测试 1m 49s`、`Vitest Test Report / Test Files: ✅ 313 passes · 313 total / Test Results: ✅ 4107 passes · 4107 total`，页内 `[aria-label]` 里 `completed successfully` 命中 5 次（另有 `Workflow run summary` / `Workflow run graph`） |
| **#62** | `38344732423` | `a74d0ca` @ feat | 同上四栏（`Status Success`、`1m 54s` / `1m 49s`、`313 passes · 313 total`、**`4107 passes · 4107 total`**） |

⇒ 第三十九节第五节那句「预期 **4107** passed」从这一格起是**读数**，预测与读数同值这一条成立；
它当初写在读数之前并已落盘，所以「猜对了」这件事有先后顺序可查，不是事后追认。

### 二、三棵树连成一条线，每一段差值都指着出处

| 树 | Linux passed | Windows passed | Windows 注册 | 差值的出处 |
| --- | --- | --- | --- | --- |
| `6c1fb91` | 4105（#59，第三十九节） | 4106（第三十六节本机） | 4108 | 平台分支：win32 多注册 3、两枚 `skipIf` 在 Windows 不真跑 ⇒ `+3 − 2 = +1` |
| `1e0c215` | **4107（#61，本刀读回）** | 4108（第三十九节本机，porcelain 0） | **4110**（第三十九节定稿那遍） | 同上，且与 `6c1fb91` 之间差 **2** = `tools/readme-claims.test.mjs` 从 3 条加到 5 条 |
| `a74d0ca` | **4107（#62，本刀读回）** | 这一格不是读数，是**判据**：定稿那遍必须逐字读出 `4108 passed \| 2 skipped (4110)`，读不出就本刀不提交 | 同上 | 与 `1e0c215` 差 **0**：那一刀 `git diff --stat` 只动两份 markdown |

`3 → 5` 那一句不是记忆，是当场 `git show <rev>:tools/readme-claims.test.mjs | grep -c "^test("` 读回的
（`6c1fb91`=3、`1e0c215`=5、`a74d0ca`=5）。Linux 侧 4105 → 4107 与它逐字对得上，`a74d0ca` 只动文档所以仍是 4107。

**同树对照今天第一次成立**：`1e0c215` 上 Linux 4107 vs Windows 4108 passed、Linux 4107 注册 vs Windows 4110 注册。
第三十九节门面里那句「这两个数**不是同一棵树上的对照**」因此被换掉——它当时的正确性来自那两棵树确实不同，
不是来自判据；新数把这一格消除，所以 README 的门禁段改成同树对照 + 更早一轮 `6c1fb91`（带哈希带 run 号）。

### 三、通路：快照 uid 前缀每次变，跨快照复用必撞

`click` 的 `args` 只吃**当前**快照里的 uid。本刀先 `take_snapshot`（前缀 `2_`）、再用前缀 `12_` 的 uid 去点，
直接报 `uid validation failed`。⇒ 要么点之前重拍一次，要么干脆不点：本刀改用一个
`evaluate_script` 把要的东西（`[aria-label]`、`innerText` 里 `Total duration` 上下 6 行、Vitest 报告块）一次取全，
用 `filePath` 落成 JSON 再 `Read`。顺带一条 Windows 侧的坑：`Read` 吃 `C:\...` 反斜杠绝对路径，
`/c/...` 形式在 `Read` 里会报 does not exist，而在 `Bash` 里正好相反。

`dt` 那一族选择器在这次新版 run 页上取不到东西（返回空数组），所以状态与时长要从 `body.innerText`
的行序里取——本刀读到的顺序是 `Status` / `Success` / `Total duration` / `1m 54s` 各占一行。

### 四、这一格仍欠的（不冒充已完成）

- **#61 / #62 作业页的逐文件条数没重读**：`path-boundary` 18、`changes` 35 这两行仍只在 #59 读过。
  本刀用**码同一性**代替那次重读：`git diff --stat 6c1fb91..1e0c215` 只有台账 + `readme-claims.test.mjs`，
  这两个测试文件一个字节没动，所以条数不可能变。**这是从盘上推出来的，不是读来的**，照第三十六节那条规矩写明。
  作业页今夜两次打不开（`ERR_CONNECTION_RESET`、`ERR_CONNECTION_TIMED_OUT`），等可达时补读。
- `fix/ci-path-platform-neutrality` 上的孪生 run 同样没读。
- 那两枚 `it.skipIf` 在 Linux 上具体是哪两条用例仍未点名。
- **`readme-claims` 的日期闸对「跨句写法」没有牙齿**（第三十八节第四节留的那格）：R3 变异（只删紧邻的数字里的年份）
  至今活着，因为判据只看**同一句内**有没有 `\d{4}-\d{2}-\d{2}`；而同一句里出现「更早一轮」这类措辞时，
  另一个日期会替它顶上。这一格要么收紧成「日期必须紧邻那串数」，要么把边界在门面上写得更明白——**没动，欠着**。

### 五、门禁与推送

本刀动两份 markdown：台账（这一节）+ `README.md` 门禁段换数。条数仍不动，所以定稿那遍的判据是
**六枚退出码全 0 且 `test` 读数逐字等于 `313 文件 / 4108 passed | 2 skipped (4110)`**，落在
`/c/temp/m12-f/s40-exit.txt`；改完门面先跑一次 scoped（`vitest run tools/readme-claims.test.mjs` +
`prettier --check README.md`，日志 `s40-readme-guard.log`），再跑满六段。
README 那条数换了写法（同树对照 + 更早一轮带哈希的 `6c1fb91`），**出处闸必须当场满足而不是靠放宽**：
每个带数的句子都自带日期与反引号哈希，闸绿才算改完。
提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD；本刀提交自己触发的 CI run 读数按 #62 的
形状预期 `4107`，但那一格要读回来才算，不在台账里预支。

**定稿遍回读（同刀）**：六枚退出码全 0（`s40-exit.txt`），`test` 那一格逐字读出
`Test Files 313 passed (313)` / `Tests 4108 passed | 2 skipped (4110)`，日志里唯一命中仍是那条已知环境噪音
（`s40-test.log:96` EPERM 软链）。两份 markdown 的最后一次修改是 12:17:35，六段起跑是 12:17:56，
所以这一遍覆盖的就是提交的那棵树——mtime 当场比对过，不是回想起来的。

## 四十一、2026-10-13：第四十节第四节那格「日期闸对跨句写法没有牙齿」补上牙齿——窗口是量出来的

### 一、欠的是哪一句

第四十节第四节原话：「**`readme-claims` 的日期闸对「跨句写法」没有牙齿**……R3 变异（只删紧邻的数字里的年份）
至今活着，因为判据只看**同一句内**有没有 `\d{4}-\d{2}-\d{2}`」。这一格不收紧，门面写多少日期都白写：
`2026-10-12 又补一条更细的教训：本机在 读到过 **328 文件 / 4261 用例**` 这句话在旧判据下是绿的，
可那个 10-12 说的是「教训哪天补的」，不是「数哪天测的」——**账还在，指针对不着**换了个地方长。

### 二、判据：日期必须**挨着**它要说明的东西，窗口 12 是实测出来的

新写法（`tools/readme-claims.test.mjs`）：一句数主张要合格，除原有的「干净支必须带哈希 / 脏树支免」之外，
还必须满足 `dateAttached`——**日期要么挨着那串数，要么挨着那棵树的哈希**（门面的写法是 `` `sha`（date ``）。
量距离之前先把 `**` 去掉、把空白折叠（`flatten`），量的是读者眼里的距离而不是磁盘下标。

窗口为什么是 12：数出来的。门面那四条数的两栏距离是用**与守卫同一套分句**的探针读回的
（`/c/temp/m12-f/probe-sentence.mjs`），两枚变异的距离则直接从守卫自己的断言消息里读回
（`s41-mut-r3.log`、`s41-mut-r7.log`）。顺带记一笔坑：更早写的 `probe2.mjs` 扫的是**整节**而不是分句，
它给第 4 条数报「日期→哈希 1」——那枚 1 是从上一句的哈希串过来的**假实例**；分句探针报 `null` 才是守卫
真正看到的，下表用的是后者。

| 情形 | 日期→数 | 日期→哈希 | 判定 |
| --- | --- | --- | --- |
| 门面 4 条数（`4107 用例` / `4108 passed` / `4105 用例` / `4261 用例`） | 17 / **4** / 17 / **5** | **1** / 1 / 1 / — | 全部 ≤12（前两条走哈希路，后两条走数路） |
| R3：删掉 `2026-10-11`，留同句开头的 `2026-10-12` | **19** | 无 | 红——旧判据在这一格是绿的 |
| R7：把日期挪到数与哈希都不挨着的地方（句子照旧有日期、有哈希） | 无 | **108** | 红——旧判据同样放行 |

19 与 1 之间留了余量，但**这个余量是判据的代价**：以后门面要把日期写远，就得连着改这里。
错误信息里直接把实测两个距离打出来（`[日期→数 19｜日期→哈希 无]`），命中的人才知道该往哪儿挪。

### 三、三枚变异：先红后绿，逐条回读退出码

只用 Edit 改、`cp` 备份、`cmp` 核对还原（备份 `/c/temp/m12-f/README.s41.orig.md`）。

| 变异 | 改法 | 结果 |
| --- | --- | --- |
| R3 孤儿日期 | `本机在 2026-10-11 读到过` → `本机在 读到过` | `R3_EXIT=1`，**1 failed / 5 passed (6)**，断言消息带 `[日期→数 19｜日期→哈希 无]`（`s41-mut-r3.log`） |
| R7 日期两头不靠 | 把 `6c1fb91` 那句的日期删出括号、句尾补 `那一轮记于 2026-10-13` | `R7_EXIT=1`，同样 1 failed / 5 passed，消息带 `[日期→数 无｜日期→哈希 108]`（`s41-mut-r7.log`）——这一枚旧判据也放行 |
| R1 回归（第三十八节那枚） | 删掉 `1e0c215` 哈希、留着「干净提交树」 | `R1_EXIT=1`（`s41-mut-r1.log`）：收紧没把已有的牙齿磨掉 |
| 还原 | 三遍都 `cp` 回来 + `cmp` 一致；还原后 `git status --porcelain` 只剩 ` M tools/readme-claims.test.mjs` | 定稿前 `vitest run tools/readme-claims.test.mjs` ⇒ `GUARD_EXIT=0`、`Tests 6 passed (6)`（`s41-guard-green0.log`，格式化后重跑 `s41-guard-green1.log` 同为 6 passed） |

### 四、第六条断言：两条附加路各得有实例

新增 `test("日期附加的两条路在门面上都得有实例…")`。理由与第三十八节那条同族：**一支判据在门面上没有实例，
就等于那一支没测**——如果哪天门面只剩 `` `sha`（date `` 一种写法，`gapToNumber` 那条路就空转，R3 那种写法
重新没人管。所以这里要求「挨着数」与「挨着哈希」两条路各至少一条实例。
（同时把老注释里那句「本文件唯一一条只数实例的断言」改掉了——它现在不是唯一一条，留着就是文案说一件判据没做的事。）

### 五、prettier 动过一次源码，所以测试重跑了一遍

判据写成一行超了宽度，`prettier --check` 报 `PRETTIER_EXIT=1`，随后用了 `prettier --write`
（`CHECK_EXIT=0`）。**格式化不算语义变更这句话不能白拿**：写完立刻重跑守卫，`6 passed (6)` 才算过。

### 六、门面上那两个数本刀**故意没回填**（写明欠账）

本刀给 `readme-claims` 加了 1 条用例，于是门面门禁段那句「CI 在 `1e0c215` 上 313 文件 / 4107 用例；
本机在同一棵树 313 文件 / 4108 passed | 2 skipped」从本刀起**两侧各落后 1 条**（本机定稿遍将读出 4109 | 2 skipped，
CI 侧要等本刀触发的 run 读回来才知道是几）。没有当场回填，理由与第三十八节第一条同源：
门面那两格讲的是**具体测量事件**，而这一刀的「同树对照」性质依赖两侧读数来自同一棵树——
只 bump 其中一侧会把刚建立的同树性质又拆掉。回填是下一刀，且必须等 CI 那一格读回来。

定稿那遍判据：六枚退出码全 0 落在 `/c/temp/m12-f/s41-exit.txt`，`test` 逐字读出
`Test Files 313 passed (313)` / `Tests 4109 passed | 2 skipped (4111)`（比第四十节多 1 条 passed、1 条注册，
差的正是本刀新增那条断言）。跑完提交，快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。

那一遍**第一次**跑完确实是六枚全 0、`4109 passed | 2 skipped (4111)`，但跑完之后我又改了第二节那条**探针出处**
（把「`probe2.mjs` 实测」改成「分句探针 `probe-sentence.mjs` 实测；整节探针报的那枚 1 是跨句串来的假实例」）。
按第三十八节那条规矩，第一遍就此作废——`s41-exit.txt` 里放的是**重跑的那一遍**，两遍之间只差这一处 markdown 措辞，
退出码集合与 `test` 读数逐字相同。这是同一毛病在本轮第三次当场复发（第三十八、三十九节各一次），
它复发得这么频繁本身就是证据：**「跑过门禁」和「跑过提交的那棵树」是两件事，得每次都分开认。**

## 四十二、2026-10-13：第四十节第四节那格欠账，能就地闭的两条先闭——双生 run 读回、两枚 `skipIf` 点名

### 一、双生 run：同一个提交在两个 ref 上各跑一遍，数一样、时长不一样

第四十节第四节写「`fix/ci-path-platform-neutrality` 上的孪生 run 同样没读」。本刀把 `b21fc1f` 那一格读回来了。
run `38345924658`，一次 `evaluate_script` 落盘成 `m12f-twin-b21.json` 再 `Read`，页面上逐栏读回：

| 栏 | 页面上读回的原文 |
| --- | --- |
| 树 / 分支 | `b21fc1f` / `fix/ci-path-platform-neutrality` |
| Status | `Success` |
| Total duration | `1m 30s` |
| 作业行 | `六路 typecheck + lint + boundary + budget + 全量测试` / `1m 27s` |
| Vitest 报告块 | `Test Files: ✅ 313 passes · 313 total` / `Test Results: ✅ 4107 passes · 4107 total` |
| `svg[aria-label]` | `completed successfully: ` —— 本次抽取只取到这一枚。#61 那一格当初报的是「命中 5 次」，两次抽取脚本不同，**不拿枚数当两格对照**，两边都只认「读到了完成态标签」 |

⇒ 「ref 不同会不会换个数」这一格从此不是猜测：同一棵树在两个 ref 上读出**逐字相同的 313 / 4107**，只有时长不同
（`b21fc1f` 在 feat 上是 run `38345924514`，`Success`、`1m 58s`、作业 `1m 55s`、同一份报告块）。

剩下两对孪生（`38344732533` @ `a74d0ca`、`38340568495` @ `1e0c215`）此刻只在 run 列表快照里读到状态标签
`completed successfully: `，**条数没读**——列表页不给报告块，而页面随后就打不开了（见第四节）。所以那一条欠账
从「所有孪生都没读」缩成「还差这两格读数」，没有全闭。

### 二、两枚 `it.skipIf(win32)` 点名——这一条不用等网络，读盘就够

| 位置 | 用例标题（逐字从盘回读） | Windows | Linux |
| --- | --- | --- | --- |
| `packages/fs-store/test/changes.test.ts:247` | 「目标文稿是指向书外的软链 ⇒ 拒（形状检查看不出来，只有 realpath 看得穿）」 | 进 `skipped` | 真跑，进 `passed` |
| `packages/fs-store/test/changes.test.ts:302` | 「备份句柄自己是指向书外的软链 ⇒ 拒」 | 进 `skipped` | 真跑，进 `passed` |

出处分两段，不许混：**位置与标题是读盘**（同一刀 `grep -n skipIf` 回读，`:247` 那枚的标题在下一行 `:248`，
谓词都是 `it.skipIf(process.platform === "win32")`）；**「Linux 上真跑且过」不是 Linux 侧的直接读数**，它由两段拼起来——
谓词在 POSIX 上为假，加上第三十九节从 run #59 作业日志读回的那一行 `changes.test.ts` **没有** `| 2 skipped`
（`2515` 行原文）。⇒ 第四十节「仍未点名」这一条闭合；要把这两条点成 Linux 侧直接读数，仍得打开那两行逐文件日志，
与第一节剩下的那两格同批。

顺带一条口径，两头都对上：全仓 `--include=*.test.{ts,mjs}` 扫 `.skip(` / `.skipIf` / `describe.skip`，扣掉这两枚之后
只剩 4 行命中，且**全部**在 `tools/platform-test-count.test.mjs` 的注释与正则字符串里（`:14`、`:83`、`:108`、`:124`），
不是真的 skip；跑数那一侧 `s41-test.log:388` 逐字读出 `Tests 4109 passed | 2 skipped (4111)`——skip 总数就是 2。
`tools/platform-test-count.test.mjs` 又把 `skipIf=2`、`win32 分支 − POSIX 分支 = 3`、`本机 passed − Linux passed = 1`
三段钉成断言，改任何一个都得先让它红。

### 三、门面那两个数本刀**仍不回填**

`154e2c1` 给 `readme-claims` 加了第 6 条用例，门面上那两格（Linux 4107 @ `1e0c215` / Windows 4108 passed @ `1e0c215`）
从那一刀起两侧各落后 1。回填的判据与第四十一节第六条同：**必须先读回 CI 在 `154e2c1`（或其后代）上那条数**，
不在台账里预支；只换 Windows 一侧会把刚建立的**同树对照**又拆掉，所以两格一起等下一刀。
这一格在写到本节之前就已经读回来了——run `38346916366`（`154e2c1` @ feat）页面上读回 `Status Success`、
`Total duration 2m 23s`、作业行 `2m 19s`、报告块 `Test Files: ✅ 313 passes · 313 total` /
`Test Results: ✅ 4108 passes · 4108 total`（`m12f-run64b.json`，一次 `evaluate_script` 落盘再 `Read`）。
⇒ 同树对照的第二格成立：`154e2c1` 上 Linux **4108** vs 本机 Windows **4109 passed | 2 skipped（4111 条注册）**，
差的还是那 1 条。回填 README 是下一刀要做的动作，本刀不动门面。

### 四、门禁那一遍：第一次跑完又改了字，所以作废重跑——同一毛病第四次当场复发

本刀只动台账一份 markdown，条数不动，所以定稿遍判据是**六枚退出码全 0**（`/c/temp/m12-f/s42-exit.txt`）且
`test` 逐字读出 `Test Files 313 passed (313)` / `Tests 4109 passed | 2 skipped (4111)`（与第四十一节同值）。
三份文件 mtime 当场比对过：台账 12:43:16、`README.md` 12:25:54、`tools/readme-claims.test.mjs` 12:26:19，
六段起跑 12:43:40——全部早于起跑，所以这一遍覆盖的就是提交的那棵树。日志里唯一命中仍是那条已知环境噪音
（`s42-test.log:103`：`[环境噪音] 本机建不了符号链接（EPERM），软链逃逸那一条没验到`）。

**第一次那一遍（`s42-run1-exit.txt`）确实是六枚全 0，但它作废了**：作废的原因就在这一节自己身上——
写第四节时 GitHub 整站不可达，`git ls-remote --heads origin` 连试 3 次全部 `EXIT=128`
（最后一行 `Failed to connect to github.com:443 after 21070 ms: Could not connect to server`，`lsr-1..3.txt`），
浏览器导航 run 页依次报 `ERR_CONNECTION_RESET`、`ERR_CONNECTION_CLOSED`、`ERR_CONNECTION_TIMED_OUT`，
所以那一版写的是「本刀先本地提交，推送等网络回来」。12:43:50 网络探针第一次成功
（`net-probe-history.txt`：`probe1 12:43:50 EXIT=0`），`net-probe.txt` 当场回读两个 ref 都等于本地 HEAD
`154e2c1366a120f5dbdfebe67115a486591fa099`——网络在本刀提交**之前**就回来了，那句承诺就此变成假话。
按第三十八节那条规矩，跑绿之后再改内容 = 那一遍作废、重跑定稿遍；两遍之间只差这一节措辞，
退出码集合与 `test` 读数逐字相同。这是同一毛病在本轮第四次当场复发（第三十八、三十九、四十一节各一次）。

推送：快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD 才算送达。
第一节 `b21fc1f` 那格双生读数是在断线之前抓完落盘的（`m12f-twin-b21.json`），不受这一格影响。

## 四十三、2026-10-13：门面那两个数落到 `154e2c1` —— 孪生四格读满，顺手逮到自己写错的一枚 run 页 ID

### 一、这一刀读回来的是哪几格

网络 12:43:50 恢复之后一次把欠的孪生读数全读满，每格都是 `evaluate_script` 落 JSON 再 `Read`：

| run 页 ID | 树 | 分支 | 页面上读回的原文 |
| --- | --- | --- | --- |
| `38346916366` | `154e2c1` | feat | `Status Success`、`Total duration 2m 23s`、作业行 `六路 … 2m 19s`、`Test Files: ✅ 313 passes · 313 total` / **`Test Results: ✅ 4108 passes · 4108 total`**（`m12f-run64b.json`） |
| `38346916329` | `154e2c1` | fix | `Success`、`2m 24s`、作业 `2m 21s`、同一份报告块，**4108 / 4108**（`m12f-twin-154.json`） |
| `38345924658` | `b21fc1f` | fix | `Success`、`1m 30s`、作业 `1m 27s`、4107 / 4107（第四十二节第一节） |
| `38344732533` | `a74d0ca` | fix | `Success`、`2m 26s`、作业 `2m 21s`、4107 / 4107（`m12f-twin-a74.json`） |
| `38340568495` | `1e0c215` | fix | `Success`、`2m 17s`、作业 `2m 13s`、4107 / 4107（`m12f-twin-1e0.json`） |
| `38339035996` | `6c1fb91` | feat | `Success`、`2m 29s`、4105 / 4105（`m12f-run59-verify.json`——本刀重开一次，只为一枚 ID，见第三节） |

⇒ 第四十节第四节那句「孪生 run 同样没读」到这里**整体闭合**：同一棵树在两个 ref 上各跑一遍，
报告块逐字相同（`154e2c1` 两格都是 313 / 4108），只有时长不同。ref 不换数，这件事现在是读数不是推。

### 二、门面上那两个数换到新树

`README.md` 门禁段现在写的是：CI 在 Linux 干净提交树 **`154e2c1`**（2026-10-13，run 页 `38346916366`）**313 文件 / 4108 用例**；
本机 Windows 在**同一棵树** `154e2c1`（2026-10-13）**313 文件 / 4109 passed | 2 skipped**（4111 条注册）。
两侧差值仍是那 1 条，算式没动（`+3 − 2 = +1`），Linux 侧注册数从 4107 换成 **4108 = 本机 4111 − 3**。
本机这一格的出处是第四十一、四十二节两次定稿遍，日志 `s41-test.log:388`、`s42-test.log:387` 逐字同为
`Tests 4109 passed | 2 skipped (4111)`——两次跑覆盖的是同一棵测试树（`154e2c1` 起测试文件再没动过，
`git diff --stat 154e2c1..HEAD` 只有 markdown）。

门面里那条「更早一轮」也补齐了：CI 在 `1e0c215`（run 页 `38340571768`）4107，在 `6c1fb91`（run 页 `38339035996`）4105，
4105 → 4107 → 4108 这三段的差全部落在 `tools/readme-claims.test.mjs` 自己身上（3 条 → 5 条 → 6 条断言）。
门面守卫每次给自己加一条用例，门面上那两个数就得跟着改——**这是本仓第一次把「守卫自己也是被测对象」这件事
写成门面上的账**，而不是留在台账里。

### 三、我自己写错了一枚 run 页 ID，被回盘逮住

第一次改门面时，我把 `6c1fb91` 那一格写成 **run 页 `38340568495`**。这枚 ID 是本刀刚读过的 `1e0c215` @ fix 的孪生，
`6c1fb91` 在 feat 上的那格其实是 **`38339035996`**。错的机制很具体：我手里同时有**两串** ID——第四十二节表里那五枚
是从 run 列表快照抓的（只有状态标签），而列表快照**不带分支列**；我把「较早的一枚」当成了更早那棵树。
按「转述必须回盘」那条，改完门面第一件事是把每个 ID 重新逐格对上「树 + 分支 + 时长」：
navigate 到 `38340568495` 读回 `1e0c215 / fix/ci-path-platform-neutrality / 2m 17s`，
再 navigate 到 `38339035996` 读回 `6c1fb91 / feat / 2m 29s`——两格都对上之后门面那句才落定。
⇒ 立一条口径：**以后引 run 只写页 ID + 树 + 分支三件套，缺一项就先去 run 列表页把 id↔sha 成对抓回来**，
单抓一列必然串台。**这条口径此刻只有台账里的字，没有断言**：出处闸管的是「那串数有没有出处」，
管不到「run 页 ID 配的是哪棵树、哪条分支」——本刀这种「ID 对错树」它不会红。钉成断言是下一刀的活。

### 四、出处闸当场过——而且是被门面上新写法过的，不是靠放宽

- scoped：`pnpm exec vitest run tools/readme-claims.test.mjs` ⇒ `GUARD_EXIT=0`、`Tests 6 passed (6)`（`s43-guard1.log`）；
  `pnpm exec prettier --check README.md` ⇒ `PRETTIER_EXIT=0`。
- 第四十一节新立的那条实例声明此刻真的有两条路在跑：`dateAttached` 走「数挨着日期」的有本机那一格，
  走「数挨着哈希」的是 CI 那一格；少任一种写法它会红。

### 五、还剩的欠账（不冒充已完成）

- **#61 / #62 / #64 作业页的逐文件条数**（`path-boundary` 18、`changes` 35）仍只在 #59 读过。本刀读的是 run 摘要页，
  不是作业步骤日志；替代证据仍是码同一性（`git diff --stat 6c1fb91..HEAD` 不含这两个文件），**这是推出来的**，照规矩写明。
- 本刀自己提交触发的新 run 没有预支读数——按老规矩，那一格等它出现在 run 列表里再读。
- `38348848566`（第四十二节那次提交 @ fix）此刻在列表里，条数未读。

### 六、门禁与推送

本刀只动两份 markdown：门面 `README.md` 门禁段 + 台账这一节。判据沿用第四十二节：六枚退出码全 0 落在
`/c/temp/m12-f/s43-exit.txt`，`test` 逐字读出 `Test Files 313 passed (313)` / `Tests 4109 passed | 2 skipped (4111)`；
两份 markdown 的 mtime 必须早于六段起跑，当场比对。提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。

**`s43-exit.txt` 里放的是重跑的那一遍。** 第一次定稿遍（`s43-run1-exit.txt`）在同一份内容上也是六枚全 0、
`test` 读出同一串 `4109 passed | 2 skipped (4111)`，但跑完之后我把第三节那条口径重写了一遍——原文写着
「这一条现在也算第四节那枚实例声明的一部分」，可出处闸压根管不到 run 页 ID 配的是哪棵树，
那是**把没做的事说成做了**，跟本仓一路在治的病灶同一种。按第三十八节那条规矩，跑绿之后改内容即作废、重跑定稿遍；
两遍之间只差这一处措辞，所以判据不变。mtime 不靠回想：`s43-exit.txt` 头部就是当场 `stat` 出来的两份 markdown
最后一次修改时刻，紧接着才是 `CHAIN_START`，读那份文件的人可以自己比先后。
这是同一毛病第五次当场复发（第三十八、三十九、四十一、四十二节各一次）。

## 四十四、2026-10-13：第四十三节留的那句「只有台账里的字，没有断言」兑现成第七道闸——顺手让门面第一次按免责段落后 1 条

### 一、这一刀只干一件事：把上一刀的口径钉住

第四十三节第三节收尾时明写着：

> **这条口径此刻只有台账里的字，没有断言**：出处闸管的是「那串数有没有出处」，管不到「run 页 ID 配的是哪棵树、
> 哪条分支」——本刀这种「ID 对错树」它不会红。钉成断言是下一刀的活。

本刀就是那一刀。`tools/readme-claims.test.mjs` 从 6 条断言加到 **7 条**，新增的那条叫
「门面上每个 run 页 ID 所在句都得配着另一枚提交哈希（ID 不能当自己的出处）」。判据两处细节值得记：

- **为什么强调「另一枚」**：`SHA = /`[0-9a-f]{7,}`/` 同样能匹配整串九位数字——run 页 ID 本身就是合法十六进制串。
  不先把 ID 自身抹掉，那枚 ID 就成了自己的出处，这条闸当场**假绿**。所以判据是 `SHA.test(s.replace(RUN_ID_G, ""))`。
  顺带踩到本仓的老坑第二十四次：带 `g` 的正则不能直接 `.test()`（`lastIndex` 残留），因此拆成
  `RUN_ID_T`（非 g，判存在）与 `RUN_ID_G`（g，数位置与抹除）。
- **它拦得住什么、拦不住什么**：拦得住「ID 裸奔」（同句没有别的哈希）与「ID 挂着却不给树」；
  拦不住「ID 与哈希都在句里，但指的是两次不同的跑」——那要开 run 页才能核，仍靠第四十三节那条
  「页 ID + 树 + 分支三件套一起抓」的手法。这条边界写进了断言的头注释，不冒充成全覆盖。

动手前先跑探针确认门面**当前**长得对不对（`/c/temp/m12-f/probe-runid.mjs`，口径与守卫一致：`## 门禁` 节、剥 `「…」`、
按 `[。；;]` 分句）：三句含 run 页 ID（`38346916366` / `38340571768` / `38339035996`），三句的 `hasOtherSha` **全为 true**。
⇒ 这条新闸在现有门面上应当绿，而它确实绿了（第三节 `s44-guard-green2.log`）。先验「不为空」再验「零违规」，
顺序与第三十八节一致——提取为空就是静默失效。

### 二、断言先证明能失败：两枚变异各打中一臂

新闸有两臂（判据臂 + 实例声明臂），所以两枚变异**一臂一枚**，不然只算验了半条：

| 变异 | 改法 | 退出码 | 当场读回 |
| --- | --- | --- | --- |
| M1 | README 门禁段插一句**裸 run 页 ID**（「本刀提交自己触发的 run 页 `38348848566` 还没读回」，同句不给哈希） | `M1_EXIT=1` | `Tests 1 failed \| 6 passed (7)`，红的正是新那条；失败消息点名那句裸 ID：`这些 run 页 ID 没配着它所属那棵树的提交哈希（抹掉 ID 之后同句找不到第二枚反引号哈希）——读者拿这串数字打开的是一个无法核对是哪棵树的页面：本刀提交自己触发的 run 页 …` |
| M2 | 把门禁段里的 run 页 ID **全部抹光**（模拟「门面不再引 CI 的页」或提取正则写坏） | `M2_EXIT=1` | 同样 `1 failed \| 6 passed (7)`，但红的是**实例声明臂**：`「## 门禁」一节里一个 run 页 ID 都没提取到——…这条闸会静默失效: expected 0 to be greater than 0` |

两枚都只红一条、其余 6 条仍过，说明没把别家的闸带倒。还原走 `cp` + `cmp`（README 从 `README.s44.orig.md` 逐字节比回），
`cmp` 无输出后重跑：`Tests 7 passed (7)`、`GUARD_EXIT=0`（`s44-guard-green0/1/2.log` 三遍同果）；
`pnpm exec prettier --check README.md tools/readme-claims.test.mjs` ⇒ `PRETTIER_EXIT=0`（`s44-prettier2.log`：
`All matched files use Prettier code style!`）。

### 三、门面那两个数第一次**按免责段**落后 1 条——不是写错，是明说过会落后

第四十三节把 4105 → 4107 → 4108 三段差算到守卫自己头上（3 → 5 → 6 条断言），当时是**推的**。本刀当场数回：

```
git show 6c1fb91:tools/readme-claims.test.mjs | grep -c "^test("   → 3
git show 1e0c215:tools/readme-claims.test.mjs | grep -c "^test("   → 5
git show 154e2c1:tools/readme-claims.test.mjs | grep -c "^test("   → 6
grep -c "^test(" tools/readme-claims.test.mjs（工作树）             → 7
```

数字对上，那条算式从推变成读。于是本刀合进去之后：CI/Linux 侧的 **4108** 与本机 Windows passed 的 **4109**
各再落后 1 条（本刀定稿遍应当读回 `4110 passed | 2 skipped (4112)`）。这正是门面免责段立起来之后**第一次兑现**
它先前预言的那种落后——按上一刀的写法它本该逼我再开一刀回填，现在它只是免责段里那句「回填不是每刀必做」的一个实例。

这一刀**不回填**，理由也是免责段自己给的：回填要两侧从**同一棵树**重读，Linux 侧得等本刀触发的 run 出现在列表里才有读数；
只 bump Windows 一边，就把第四十三节好不容易对齐的「同树两侧对照」又拆掉了——那才是真写错。

### 四、门面免责段改写（拆掉「每加一条就得回填一刀」的死循环）

`README.md` 门禁段后面那段，改前（回盘自 `git diff`）：

```
所以这里只留「最近一次实测 + 那一次跑的是哪棵树」，要准数请跑 `pnpm test` 看当场输出。
```

改后：

```
所以这里只留「某一次实测 + 那一次跑的是哪棵树」：上面门禁那两格是在 `154e2c1` 上读回的数，
而门面守卫每往自己身后加一条断言，这两个数就各再落后 1 条——回填不是每刀必做，
做的时候两侧都要从**同一棵树**重读，只 bump 一边会把同树对照又拆掉。要准数请跑 `pnpm test` 看当场输出。
```

「最近一次」是死的（每刀都得追平），换成「某一次 + 哪棵树 + 会怎么落后」：门面的数从此绑定**它那一次**的树，
而不是绑定当前 HEAD。这一处改的是门面措辞，不动判据，所以出处闸那几条仍然绿——它管「有没有出处」，
不管「出处新不新」，新不新由这一段自己声明。

### 五、还剩的欠账（不冒充已完成）

- **#61 / #62 / #64 作业页的逐文件条数**（`path-boundary` 18、`changes` 35）仍只在 #59 直接读过；
  替代证据仍是码同一性，**这是推出来的**，第三刀没变。
- 提交触发的 run 一条读数都没取：`38348848566` @ `6b59b40`、`c1f8a31` 那一轮、以及本刀将要产生的那条。
  按老规矩等它们出现在 run 列表里再读，不预支。
- 第七道闸只能证明「ID 句里有第二枚哈希」，不能证明二者同一次跑（见第一节第二条）。要把它收紧到能核对配对，
  得让门面上每个 ID 都连着树哈希**且**由脚本对 run 页回读——那是另一条通路（CI API/网页），不是门面闸能替的。

### 六、门禁与推送

本刀动三处：`tools/readme-claims.test.mjs`（+1 条断言）、`README.md`（免责段）、台账这一节。判据沿用第四十二、四十三节，
只把预期条数按第三节的算式改一格：六枚退出码全 0 落在 `/c/temp/m12-f/s44-exit.txt`，`test` 逐字读出
`Test Files 313 passed (313)` / `Tests 4110 passed | 2 skipped (4112)`；两份 markdown 的 mtime 必须早于六段起跑，
当场比对（`s44-exit.txt` 头部就是当场 `stat` 的时刻，紧接着才是 `CHAIN_START`）。提交后快进推两个 ref，
`git ls-remote --heads` 回读等于本地 HEAD。
**这一节写完后内容不再改动**——上一刀与上上一刀都是「跑绿之后改内容 → 那一遍作废 → 重跑」，
这是同一毛病在本仓第六次的**预防条款**，不是又一次复发记录；若本刀真的又改了内容，此处要如实改成作废说明。

## 四十五、2026-10-13：上一刀的闸被「摘掉反引号」一试就失明——补成独立成词 + 不许藏引号 + 两枚正则只许一份写法

### 一、这一刀不动门面，只回头拆自己刚立的闸

`e5fc2b4` 落地后第一件事是问那条新闸「怎么才会不红」。它认的是 `` `\d{9,}` ``——**反引号是判据的一部分**，
那么摘掉反引号就等于让那枚 ID 从闸上消失。当场实测（变异代号 **M3**）：

- 门面改写：把 `run 页 \`38340571768\`` 的那对反引号摘掉，其余一字不动。
- 读数：`M3_BEFORE_EXIT=0`、`Test Files 1 passed (1)` / `Tests 7 passed (7)`（`s45-mut-m3-before.log`）。

⇒ 洞坐实，而且不是「侥幸通过」：探针 `probe-bare-id.mjs` 显示那一局的 ID 枚数从 3 掉到 2——
**那枚 ID 根本没进判据**。第四十四节写完就交出去的闸，是一只摘了引号就不响的钟。

### 二、放宽成「独立成词的 9–12 位数字」，并当场证明它不误伤

新判据 `RUN_ID_T = /(?<![0-9a-zA-Z])\d{9,12}(?![0-9a-zA-Z])/`：前后不挨字母或数字。放宽会不会把别的东西当 ID——
探针在门面「## 门禁」一节里数 9 位以上的数字串，结果 `RAW_IDS` 与剥掉 `「…」` 之后的 `STRIPPED_IDS` **都是那三枚**
（`38346916366` / `38340571768` / `38339035996`，逐枚相同、无多无少），而本节里其余的数天然落不到这条线上：
日期 `2026-10-13` 每段 4 位、runner 镜像版本 `20261004.327.1` 首段 8 位、64 位 sha256 里的纯数字串必然挨着十六进制字母。
顺带记一条探针纪律：带 `g` 的 `BARE_G` 拿去 `.test()` 会残留 `lastIndex`，脚本里判存在一律用非 g 的那枚——
与本仓守卫自己踩过的是同一个坑（第三十七节那条）。

### 三、第二条脱身通路：把 ID 藏进 `「…」`

本节所有判据共用「先剥 `「…」`」这道预处理（免得门面里引来的原文误触数闸），所以 ID 一旦写进引号就跟着被剥掉。
补一条**只数枚数**的断言：`raw.length === visible.length`，不等即红。两枚变异各打中一条新通路
（沿用第三十八节「判据的每一支都得有实例」那条，一支一枚）：

| 变异 | 改法 | 退出码 | 当场读回 |
| --- | --- | --- | --- |
| M3b | 门面加一句**不带反引号**、也不给哈希的页码：「本刀提交触发的 run 页 38365741805 还没读回。」 | `M3B_EXIT=1` | `1 failed \| 7 passed (8)`，红的正是配对臂，消息逐字点名那句：`…无法核对是哪棵树的页面：本刀提交触发的 run 页 38365741805 还没读回` |
| M4 | 把 `` `38346916366` `` 裹进 `「…」` | `M4_EXIT=1` | `1 failed \| 7 passed (8)`，红的是枚数臂：`这些 run 页 ID 写在「」里（引号内外枚数 3 ≠ 2）…38346916366: expected 3 to be 2` |

两枚跑完都用 `cp` + `cmp` 从 `README.s45.orig.md` 逐字节比回（`RESTORE_CMP_OK` 两次），
还原后定稿前那遍是 `GUARD_EXIT=0`、`Tests 8 passed (8)`（`s45-guard-finalgreen.log`）。

### 四、T 与 G 是手抄的两份——按锁定前提第 6 条改成派生，并量到漂移真的会**假绿**

判据先用 G 把 ID 抹掉、再用 `SHA` 找哈希，所以「什么算 ID」这件事只能有一份写法。改之前两枚是各写一遍的同源字面量
（正是锁定前提第 6 条禁的「手抄两份」），改之后：

```js
const RUN_ID_T = /(?<![0-9a-zA-Z])\d{9,12}(?![0-9a-zA-Z])/;
const RUN_ID_G = new RegExp(RUN_ID_T.source, "g");
```

这条不是洁癖，是量出来的：

| 变异 | 改法 | 退出码 | 当场读回 |
| --- | --- | --- | --- |
| M2c | **只**把 T 的下限改成 15（模拟「改了认法却漏了另一枚」） | `M2C_EXIT=1` | `2 failed \| 6 passed (8)`——配对臂与枚数臂的实例声明**同时**红，两条消息各自 `expected 0 to be greater than 0` ⇒ 一处改动两臂齐动，派生确实在生效 |
| M6 | 让 G 退回**手抄且比 T 窄**（`\d{15,}`），门面同时留一句反引号裸 ID | `M6_EXIT=1` | 关键成色在这一格：配对臂这次是 `✓` 通过的——G 抹不掉 ID，`SHA` 反过来匹配上 ID 自身，**ID 自证成自己的出处**（假绿）。整跑只有新加的枚数臂红 |

⇒ 两条结论写死。**其一**：第四十四节那一版（7 条断言、没有枚数臂）碰上 M6 那种漂移会**整跑绿灯过去**——
今天这条新臂顺手给 G 也装了自我声明（`visible.length > 0`），实例声明的价值又一次不是设计出来的，是补出来的。
**其二**：把 M6 的门面写法放回派生 G 之下，同一句立刻红得干脆——`M1_AFTER_DERIVE_EXIT=1`、`1 failed \| 7 passed (8)`，
失败消息点名「本刀提交触发的 run 页 `38365741805` 还没读回」。守卫还原走 `cp` + `cmp`（`GUARD_RESTORE_CMP_OK`）。

### 五、门面这一刀一字未改，而这正是免责段第一次被执行

`git status --porcelain` 这一刀全程只有 ` M tools/readme-claims.test.mjs`（改完还原后为 clean，见第六节推送前的回读）。
断言从 7 条到 **8 条** ⇒ 本刀定稿遍预期 **`Tests 4111 passed | 2 skipped (4113)`**（第四十四节第三节那条算式再往下一格），
Linux 侧按 ±1 应为 4110——**这一格不预支**，等它出现在 run 列表里再读。
门面不回填的理由也就是免责段那句「回填不是每刀必做」：不是没数，是两侧还没在**同一棵新树**上读齐。

### 六、CI 那一轮的读数：第四十四节预测的 4109 命中，孪生两格都读满

`e5fc2b4` 推上去之后两个 ref 各触发一次 run。按第四十三节那条「页 ID + 树 + 分支三件套」成对读，
每格都是 navigate 到该页再 `evaluate_script` 落 JSON：

| run 页 ID | 树 | 分支 | 页面上读回的原文 |
| --- | --- | --- | --- |
| `38365741805` | `e5fc2b4` | feat | `Status Success`、`Total duration 2m 30s`、报告块 `Test Files: ✅ 313 passes · 313 total` / **`Test Results: ✅ 4109 passes · 4109 total`**（`s45-run-feat.json`） |
| `38365648271` | `e5fc2b4` | fix | `Success`、`2m 19s`、同一份报告块，**4109 / 4109**（`s45-run-fix.json`） |

⇒ 第四十四节第三节那条**预测**现在是读数：本机在同一棵 `e5fc2b4` 上定稿遍读的是 `4110 passed | 2 skipped (4112)`，
`4110 = 4109 + 1` 且 `4112 − 3 = 4109`，±1 算式两侧都不剩剩余；孪生两格条数逐字相同，只有时长不同（ref 不换数，第二次证实）。
列表页那次照旧只给标题、`row` 整列是空串——**单抓一列必串台**这条今天又应验一次（第一节 M3 用掉的 `38340571768`、
第五、六节写到的 `38365741805` 都是逐页 navigate 才对上树的）。

### 七、还剩的欠账（不冒充已完成）

- **逐文件 18 / 35 仍只在 #59 直接读过**。本刀新试了两条通路并**都否掉了它们**：
  ① 作业页的 `.../jobs/94025391711/summary_raw` 只有汇总两行（`len=134`：`Test Files 313` / `Test Results 4109`），
  **不含逐文件表**（`s45-summary-raw.json`）；② 作业页本体在取到读数那一刻 `body.innerText` 只有 402 字符、
  遍历 shadow root 得 `roots=1 / cands=0`（唯一那枚是 `TOOL-TIP`），步骤名抽取两次分别 `n=0` 与 `hits=[]`
  （`s45-steps.json` / `s45-steps2.json` / `s45-shadow.json`）⇒ **日志面板这条路在浏览器侧走不通**，
  那条欠账的替代证据依旧是码同一性，**这是推出来的**，照旧写明。
- `c1f8a31`、`6b59b40`（`38348848566` / `38348848445`）与本刀将要触发的那几格读数照旧没取；列表里都在，不预支。
- 配对闸仍证不了「ID 与哈希真是同一次跑」——第四节 M6 把这条边界演示得很清楚：它能拦住 ID 裸奔，
  拦不住一次手滑的判据漂移，后者靠的是派生 + 两条实例声明，不是靠它自己。

### 八、门禁与推送：两遍，第一遍被自己写进判据里的那句「跑完补读数」叫停

本刀只动两份文件：`tools/readme-claims.test.mjs`（+1 条断言、G 改派生）与台账这一节。判据沿用第四十二～四十四节：
六枚退出码全 0 落在 `/c/temp/m12-f/s45-exit.txt`（第一遍）与 `/c/temp/m12-f/s45-final-exit.txt`（定稿遍），
`test` 逐字读出 `Test Files 313 passed (313)` / `Tests 4111 passed | 2 skipped (4113)`——**正是第五节预测的那一格**，
±1 算式往下一格；两份文件的 `stat` 时刻都早于各自的 `CHAIN_START`（打在两份 exit 文件头部，读的人可以自己比先后）。

**第一遍不算定稿，原因值得单独记一句**：那一遍跑完之后，我按本节原来那行标题里写的「跑完在这里补读数」把读数补了进来——
于是内容变了、那一遍作废。这是第三十八节那条规矩**第六次**当场复发，而且这一次和前五次不一样：
前五次是「写着写着发现说错了要改」，这一次是**我明知规矩，还把一句会强制第二遍的话写进了判据段**（「跑完在这里补读数」=
先跑再补 = 一定作废）。规矩的正确形状是：**内容全部落定之后才起跑**，读数写进汇报与日志名，不必回头改台账。
两遍之间只差这一节的 markdown，所以判据不变、条数也不变——「只动文档所以条数不动」这一条本身就是证据（第三十九节同族用法）。
提交后快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD；两枚孪生 run 的读数照旧不预支（第七节那条边界）。

## 四十六、2026-10-13：门面那两个数按免责段换成 `d60b32d` 的同树对照——两侧读数先读齐，守卫一条没加

### 一、这一刀闭的是第四十五节第五节留下的那条边界

上一刀第五节原话是「Linux 侧按 ±1 应为 4110——**这一格不预支**，等它出现在 run 列表里再读」，第七节第二条又补了一句「列表里都在，不预支」。现在两枚都读满了，逐字内容（同一页上一起抓到 ID、提交、分支，不是从两列各抓一次——第四十三节那条手法）：

- run 页 `38368137670`（工作流编号 #74）：分支 `fix/ci-path-platform-neutrality`，pushed `d60b32d`，Status Success，总时长 2m 31s（verify 作业 2m 27s），`Test Files: ✅ 313 passes · 313 total`、`Test Results: ✅ 4110 passes · 4110 total`。
- run 页 `38368142676`（#75）：分支 `feat/plan3-interaction-and-assembly`，pushed `d60b32d`，Status Success，总时长 2m 7s（verify 作业 2m 3s），同样 `313 passes · 313 total` / `4110 passes · 4110 total`。

整页文本分别 690 与 692 字符，落盘在 `/c/temp/m12-f/s46-run-a.json`、`s46-run-feat.json`、`s46-run-feat-full.json`；状态只从 `svg[aria-label]`（`completed successfully: `）与页面上的 `Status / Success` 两行读，没有从提交标题猜。

**这条算式第三次把预测变成读数**：前两次是 §三十九第五节预测 4107 → #61 读回 4107（第四十节第一节记的），§四十四第三节预测 4109 → `e5fc2b4` 两枚孪生都读回 4109（§四十五第六节标题就是「第四十四节预测的 4109 命中」）；这一刀是 §四十五第五节预测 4110 → 两枚孪生都读回 **4110**。从 4105 起每一格与守卫条数逐字对得上：4105（3 条）→ 4107（5 条，+2）→ 4108（6 条）→ 4109（7 条）→ 4110（8 条）。

### 二、Windows 那格这次跑在**已提交**的树上，不是跑在提交前

上一刀的 4111 是在 `d60b32d` **还没提交**的那一遍定稿遍上读的——`s45-final-exit.txt` 头部明写 `HEAD=e5fc2b419e9ffdd850f3b35d719dd8c3cb1135a0`。门面里「本机在干净提交树上实测」这句话要按第二十三节的老规矩立住，顺序只能是**先有提交、再读一次**，所以我没有拿提交前那一遍直接填门面，而是在 HEAD 已经是 `d60b32d` 的位置上重跑了一遍 `pnpm test`：

- `/c/temp/m12-f/s46-clean-exit.txt` 逐字：`HEAD=d60b32d97b5a0a42c9497d68592aeae0be371616`、`PORCELAIN_COUNT_BEFORE=0`、`CHAIN_START=2026-10-13T16:24:10`、`test_EXIT=0`、`CHAIN_END=2026-10-13T16:24:49`、`PORCELAIN_COUNT_AFTER=0`（脏项计数在跑之前与跑之后各读一次，两次都是 0 条——只读一次的话，中间生成物落没落地看不见）。
- `s46-clean-test.log` 逐字：`Test Files  313 passed (313)`、`Tests  4111 passed | 2 skipped (4113)`、`Duration  36.77s`；整份日志按 `windows-corepack-pnpm-verify-chain` 第 2 步那串 grep（`error TS|ELIFECYCLE|Command failed|✖ [0-9]+ problem|^ FAIL|EPERM|EBUSY`，先剥 ANSI）只剩一条已知环境噪音：`[环境噪音] 本机建不了符号链接（EPERM），软链逃逸那一条没验到`。

两个数第一次在同一棵**已提交**的树上对齐：本机 4111 passed / 4113 注册，CI 4110 注册，差 3 条注册、差 1 条 passed——与 `tools/platform-test-count.test.mjs` 钉的那笔账（win32 多注册 3 条、两枚 `it.skipIf(win32)` 在 Windows 不真跑）逐字一致。

### 三、门面上改了哪四处（原文照抄自 `git diff -U0 README.md`）

1. 门禁第一段那格：CI 与本机两数所绑的树从 `154e2c1` 换成 `d60b32d`；CI 那侧从一枚 run 页（`38346916366`）换成**两枚**（`38368137670` 与孪生的 `38368142676`，并补一句「两个分支各触发一枚 run」）；那串数从 **313 文件 / 4108 用例** 换成 **313 文件 / 4110 用例**；本机那侧从 **313 文件 / 4109 passed | 2 skipped**（4111 条注册）换成 **313 文件 / 4111 passed | 2 skipped**（4113 条注册）。
2. `Linux 侧 4108 条注册 = 本机 4111 − 3` 换成 `Linux 侧 4110 条注册 = 本机 4113 − 3`。
3. 历史那一格从「再往前两轮」扩成「再往前几轮」：补进 `154e2c1` = 4108（run 页 `38346916366`）那一行，收口那句从「从 4105 到 4107 差的 2 条、从 4107 到 4108 差的 1 条，都出自门面守卫自己——用例数从 3 条加到 5 条、再加到 6 条」改成「从 4105 到 4110 差的 5 条**全部出自门面守卫自己**——从 3 条加到 8 条」，并加一句「每个数都由 `git show <rev>:tools/readme-claims.test.mjs` 数 `^test(` 的行数当场核对过」。
4. 免责段那格把绑定的树从 `154e2c1` 挪到 `d60b32d`，并明写这一次是**两侧同树**读回的：「Linux 那格来自两枚 run 页，Windows 那格跑之前与跑之后各读回一次 `git status --porcelain`，两边都是 0 条」；「回填不是每刀必做，做的时候两侧都要从同一棵树重读，只 bump 一边会把同树对照又拆掉」那两句一字未动——它们就是这一刀的开工单。

第 3 点那句「每个数都当场核对过」不是转述，是这一刀跑之前数的：`6c1fb91`=3、`1e0c215`=5、`154e2c1`=6、`e5fc2b4`=7、`d60b32d`=8。

### 四、守卫一条没加，所以这一刀不需要「回填的同时再补一条断言」

上一刀立的那条口径第一次真正起作用：门面数字与守卫条数解绑之后，回填就成了**纯文档动作**，不必再为「数落后几条」而改判据。本刀只动两份 markdown，`tools/readme-claims.test.mjs` 一字未改；起跑前用廉价探针单独数过它——`✓ tools/readme-claims.test.mjs (8 tests)` / `Tests  8 passed (8)`（`s46-probe-guard.log`，`GUARD_EXIT=0`），`prettier --check README.md` 也是 `PRETTIER_EXIT=0`（`s46-probe-prettier.log`）。探针只证「门面这两处改动能过闸」，不替代下面第六节那一遍定稿门禁。

### 五、下一枚可以被证伪的话：只动 markdown 的这一轮，CI 应该还是 4110

本刀提交的内容只有两份 markdown，注册数没变，所以它触发的两枚 run **应当**仍是 `313 文件 / 4110 用例`；任何一格变成 4111 或 4109，都说明「文档改动不影响条数」这条判据是错的——同一句话第四十节第二节已经用过一次并读回过：`a74d0ca`（run 页 `38344732423`）只动两份 markdown，Linux 侧读回来仍是 4107。这一句是**预测，不是读数**，照 §四十五第五节那条「不预支」的规矩，读数留给下一刀；本节里所有已经落定的数都来自起跑之前跑完并落盘的那些遍。

### 六、门禁与推送

本刀定稿遍（六段，判据沿用第四十二～四十五节）在**内容全部落定**之后才起跑：这一节写完、README 四处改完之后才按 `windows-corepack-pnpm-verify-chain` 的取码姿势跑，六枚退出码与该遍的 `stat`/`CHAIN_START` 先后一起落在 `/c/temp/m12-f/s46-final-exit.txt`。**本节不预告那一遍的结果**——第四十五节第八节记的第六次复发就是把「跑完在这里补读数」写进了判据段，那等于自己给自己立了一张必作废的单子；结果只落在日志里，读数以文件名指认。

提交后快进推两个 ref（`fix/ci-path-platform-neutrality` 与 `feat/plan3-interaction-and-assembly` 继续同值），`git ls-remote --heads` 当场回读等于本地 HEAD；本机 Windows 数来自干净提交树那一遍，不再另跑。

### 七、这一刀仍然没碰的

- 逐文件条数（`path-boundary.test.ts (18 tests)` 那一条）在 CI 上仍是**推出来的**：第四十五节第七节已经否掉 `summary_raw` 与 job 页 `shadow root` 两条浏览器通路，本节没有新增通路，只是把总数两格读满了。
- 门面上「跑在哪棵树上」这句话仍然靠 CI 与本机各自读回一次；跨平台对照的注册数差（3 条）只有 `tools/platform-test-count.test.mjs` 在本机钉着，CI 上没有对应的断言。
- `useBookStore.ts` 800/800 那一拆、`VersionHistoryPanel` 一族、侧栏 `.nav-row kbd` 死规则等仍等一句话拍板，本刀没有自行动手。

## 四十七、2026-10-13：免责段那句「只 bump 一边」钉成第九道闸——顺手把 `fb88a58` 两枚 run 读回来，上一刀的预测当场兑现

### 一、先把上一刀第五节那枚可证伪的话读成数

§四十六第五节写的是「本刀只动两份 markdown，注册数没变，它触发的 run **应当**仍是 `313 文件 / 4110 用例`」。两枚都读满了（同一页成对抓页 ID＋提交＋分支，第四十三节那条手法）：

- run 页 `38370403306`（工作流编号 #76）：`fb88a58` @ `fix/ci-path-platform-neutrality`，Status Success，总时长 1m 31s（verify 作业 1m 27s），报告块 `Test Files: ✅ 313 passes · 313 total` / `Test Results: ✅ 4110 passes · 4110 total`（整页 691 字符，`s47-run-fix-fb88a58.json`）。
- run 页 `38370524835`（#77）：`fb88a58` @ `feat/plan3-interaction-and-assembly`，Success，总时长 2m 45s（作业 2m 41s），同一份报告块，**4110 / 4110**（整页 695 字符，`s47-run-feat-fb88a58.json`）。

⇒ 同时成立的是三件事：① 「只动文档不影响条数」第二次由 CI 侧读数证实（第一次是 `a74d0ca` 的 #62，第四十节第二节）；② 「同一枚提交在两枚 ref 上报告块逐字相同、只有时长不同」第三次证实；③ 上一刀把预测**单独列成一节、不混进读数**，这一节就只需要填读数——这是「预测写成可证伪的一句话」第一次在同晚被读回。

### 二、第九道闸：门面上那三处跨格等式自己得算得过

出处闸、日期闸、ID 配对闸、藏引号闸管的都是**一格一格**的写法。会漂移的其实是**跨格的算式**：免责段明写着「只 bump 一边会把同树对照又拆掉」，而把「Linux 侧 4110 条注册」改成 4111、留着「= 本机 4113 − 3」，前面四条闸一条都不会红（出处齐、日期挨着、ID 配着哈希）——门面却当场自相矛盾。这和三十八节「判据的一支没有实例＝那一支没测」是同一族病灶：规则写着，没有东西替它算一遍。

所以新增一条断言，只算门面上**已经写成等式**的三处，不新增任何主张：

- `Linux 侧 4110 条注册 = 本机 4113 − 3` → 4110 + 3 == 4113。
- `4111 passed | 2 skipped（4113 条注册）` → 4111 + 2 == 4113。匹配前先过 `flatten`（剥 `**`、折空白），所以门面的加粗不参与判据。
- `从 4105 到 4110 差的 5 条 …… 用例数从 3 条加到 8 条` → 4110 − 4105 == 5 **且** 8 − 3 == 5（两头都算，缺一边就红）。

三枚正则**都不带 `g`**（沿用代码里 `COUNT_CLAIM` 上方那段关于 `lastIndex` 跨句残留的注释），每一处各配一条实例声明（`not.toBeNull()`）：写法被换掉时这条闸不静默失效。

### 三、断言先证明能失败：四枚变异各打中一臂（README 每枚跑完立即 `cp` 还原＋`cmp` 核对）

- **M7**：`Linux 侧 4110 条注册` → `4111`（其余不动）。`M7_EXIT=1`，逐字报「门面上这处等式算不过：读到的数是 4111, 4113, 3（原文「Linux 侧 4111 条注册 = 本机 4113 − 3」）」，`Tests 1 failed | 8 passed (9)`。**其余 8 条全绿就是这条闸存在的理由**：半 bump 这种写法，前面四条闸一条都看不见。
- **M8**：本机那格的 `passed` 少写 1（`4111` → `4110`，注册数留着 `4113`）。`M8_EXIT=1`，报「读到的数是 4110, 2, 4113」，同样 `1 failed | 8 passed (9)`。
- **M9**：`用例数从 3 条加到 8 条` → `7 条`。`M9_EXIT=1`，报「读到的数是 4105, 4110, 5, 3, 7」——第三臂确实在两头各算一遍，不是只查了减法好看。
- **M10**：`（4113 条注册）` → `（注册 4113 条）`（**一个数都不改**，只换写法）。`M10_EXIT=1`，红在实例声明：`expected null not to be null`，报「门面上找不到『本机 passed + skipped = 本机注册数』的写法了」。

四枚跑完都立即 `cp /c/temp/m12-f/README.s47.orig.md README.md` 还原、再 `cmp` 证字节相同（`cmp` 四次都返回 0——这一步只打在终端上，没有单独落盘，落盘的是各枚的 vitest 日志 `s47-mut-m7.log`～`s47-mut-m10.log`）。还原后 `git status --porcelain` 只剩一行 ` M tools/readme-claims.test.mjs`，这一条现在还能在盘上复核。绿跑 `s47-guard-green.log` 逐字 `✓ tools/readme-claims.test.mjs (9 tests)` / `Tests 9 passed (9)`，`prettier --check tools/readme-claims.test.mjs` 也是 0（`s47-prettier-check.log`）。

### 四、推送这一族第一次踩坑：`git push origin <本地分支名>` 推的是**别人那条线**

`fb88a58` 提交后照上一刀的姿势推两个 ref：`fix` 一步过（`d60b32d..fb88a58`），`feat` 连红三回 `! [rejected] ... (non-fast-forward)`。**没有强推**，先查拓扑再动手：

- `git rev-parse --short feat/plan3-interaction-and-assembly` = `2487695`（主工作树那条并行会话的头），`git rev-list --count HEAD..2487695` = **0**、`git rev-list --count 2487695..HEAD` = **51** ⇒ 本地 `feat` 这个 ref 落后远端 51 笔，拿它当推送源等于要求远端往回走，红得完全正确。
- 换成 `git push origin HEAD:refs/heads/feat/plan3-interaction-and-assembly` 一步就过，`git ls-remote --heads` 当场回读：两枚开发线都是 `fb88a5888eeacdfc76e16719d2bdff96998d7f82`，`main` 仍在 `c475caf`。
- 机制一句话：**这个仓库里本地分支名归主工作树的并行会话所有，推送源永远写 `HEAD:refs/heads/<名>`**。非快进的红不等于「有人在抢我的 ref」——把它读成冲突然后去 merge，就会把别人 51 笔没审过的改动带进我的提交，那才是真事故。

### 五、门面这一刀一字未动（免责段第二次被照执行）

守卫 8 → **9 条** ⇒ 本刀定稿遍预期 `Tests 4112 passed | 2 skipped (4114)`，Linux 侧按 ±1 应为 4111；**这一格不预支**，等它出现在 run 列表里再读。门面上那两个数仍写 `d60b32d` 那一次的读数、各落后 1 条——这是免责段立起来之后第二次照它办事（第一次是 §四十五），不是忘了改。

### 六、还剩的欠账（不冒充已完成）

- 逐文件条数在 CI 上仍是**推出来的**：第四十五节第七节否掉的两条浏览器通路没有替代通路，本刀没有新探。
- 等式闸只算门面上已经写成等式的三处，**不检查这些数与当前代码同源**——那是回填的事，而回填按免责段不是每刀必做。
- `main` 仍停在 `c475caf`（两条开发线在它前面 51＋笔），要不要跟进、默认分支要不要换，是用户一句话的事，本刀没动。

### 七、门禁与推送

本刀动两份文件：`tools/readme-claims.test.mjs`（+1 条断言，8 → 9）与台账这一节，README 一字未改。定稿遍在**内容全部落定**之后起跑，六枚退出码与该遍的 `stat`/`CHAIN_START` 先后一起落在 `/c/temp/m12-f/s47-final-exit.txt`；**本节不预告那一遍的结果**（第四十五节第八节那条教训的形状）。提交后照第四节那条姿势快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。

## 四十八、2026-10-13：门面那两个数回填到 `e5d4046`——回填途中撞出等式闸的第二层「对表」，顺手记下我一枚打错又当场作废的 run 页 ID

### 一、上一刀第五节留的那格，两侧都读满了

CI 侧（run 页文本逐字回读，`/c/temp/m12-f/s47-run-fix-new.json` 与 `s47-run-feat-new.json`）：

- `38373040533`——`pushed e5d4046` / `fix/ci-path-platform-neutrality` / `Status Success` / `2m 25s`，summary 两行 `Test Files: ✅ 313 passes · 313 total`、`Test Results: ✅ 4111 passes · 4111 total`。
- 孪生 `38373044488`——同一枚 `e5d4046`、`feat/plan3-interaction-and-assembly`、同样 Success，两个数一字不差。

本机侧照 §四十六 第二节的姿势跑在**已提交**的树上：`CELL_HEAD=e5d4046e0d97239c26c280f38c646f0643231ce7`，跑之前与跑之后各读回一次 `git status --porcelain`，两边都是空（`/c/temp/m12-f/s48-win-cell.txt`，`TEST_EXIT=0`），日志逐字 `Test Files  313 passed (313)` / `Tests  4112 passed | 2 skipped (4114)`。于是 ±1 那笔账在**同一棵新树**上再次成立：Linux 4111 条注册 = 本机 4114 − 3，Linux 全过 4111 = 本机 passed 4112 − 1。

### 二、回填这件事本身把第九道闸的第二层逼了出来

上一刀的等式闸只算**等式自己**：`Linux 侧 N 条注册 = 本机 M − K` 只要 `N + K === M` 就算过。回填时我把两格改成 4111 / 4112 / 4114，而那句等式还留着 `4110 条注册 = 本机 4113 − 3`——**旧的那对内部照样算得过**（4110+3 确实等于 4113），闸一片绿，门面却在说假话。中间那几分钟我就处在这个状态里，是先改完两格、隔了一阵才回头补那句等式，不是我提前防住了它。

所以这一刀给等式闸加了第二层：`CELLS` 把两格读数各钉成一份实现（Linux 那格 `/报的数：313 文件 \/ (\d+) 用例/`、本机那格复用第二臂本来就有的 `passed | skipped（注册）` 那枚，**不另写第二份**，锁定前提第 6 条），每处等式再声明 `ties`——它引用的那个数必须等于它所描述的那一格。断言条数没有增加（仍是 9 条），加的是同一道闸里的鉴别力，所以两侧读数的算术（3 → 9 = 4105 → 4111）不受影响。

### 三、新加的那一层先证明它能红：M11、M12，外加一次旧闸对照

| 变异 | 只改什么 | 结果 | 落盘 |
| --- | --- | --- | --- |
| **M11** | 顶格 CI 数 `4111` → `4112`，等式与历史句一字不动 | `M11_EXIT=1`，红在**对表**：`第 1 个数读成 4111，可它所描述的那一格（CI 那一格的用例数）现在是 4112`，`Tests 1 failed \| 8 passed (9)` | `s48-mut-m11.log` |
| **M12** | 顶格本机 `4112 passed \| 2 skipped（4114 条注册）` → `4113 … （4115 条注册）`（**故意让第二臂的算术仍然成立**：4113+2=4115） | `M12_EXIT=1`，红在另一处对表：`第 2 个数读成 4114 … 本机那一格的注册数现在是 4115`，同样 `1 failed \| 8 passed (9)` | `s48-mut-m12.log` |
| **旧闸对照** | 把 `git show e5d4046:tools/readme-claims.test.mjs` 原样落成临时探针文件，**在同一份 M12 未还原的 README 上**跑 | `OLD_M12_EXIT=0`，`Tests 9 passed (9)`——上一刀的九道闸对这次红得一干二净，这就是「新层有牙而旧层没有」的 A/B，不是我的说法 | `s48-mut-m12-oldguard.log` |

M11 没有再做一次旧闸对照（同一份旧实现里根本没有 `ties`，M12 那次已经把它对整类「只 bump 一边」的盲目证出来了；要按 M11 单独复现，姿势与对照那次一样）。两枚变异都用 `cp /c/temp/m12-f/README.s48.orig.md README.md` 还原、`cmp` 返回 0（`M11_CMP_EXIT=0`、`M12_CMP_EXIT=0`，这两条同样只打在终端上，落盘的是还原后 `git status --porcelain` 只剩 ` M README.md` 与 ` M tools/readme-claims.test.mjs` 两行——那正是本刀要提交的两份文件）。临时探针 `tools/zz-s48-oldprobe.test.mjs` 跑完 `rm` 掉，没进过任何一次提交。还原后再跑一遍守卫：`GUARD_EXIT=0`、逐字 `✓ tools/readme-claims.test.mjs (9 tests)` / `Tests 9 passed (9)`（`s48-guard-green2.log`），`prettier --check README.md tools/readme-claims.test.mjs` 也是 0（`s48-prettier-both.log`）。

### 四、门面上改了哪几处（原文照抄自 `git diff -U0 README.md`，落盘 `s48-readme.diff.txt`）

- 顶格两行：`d60b32d` → `e5d4046`、run 页 `38368137670`/`38368142676` → `38373040533`/`38373044488`、CI `313 文件 / 4110 用例` → `4111 用例`、本机 `4111 passed | 2 skipped（4113 条注册）` → `4112 passed | 2 skipped（4114 条注册）`。
- 那句平台账：`Linux 侧 4110 条注册 = 本机 4113 − 3` → `Linux 侧 4111 条注册 = 本机 4114 − 3`——**这一处就是第二节说的那个差点漏掉的数**。
- 历史行补一枚 `d60b32d`（4110，两 run 页配齐），并把跨度改成 `从 4105 到 4111 差的 6 条 … 用例数从 3 条加到 9 条`；`1e0c215` 那条 4107 读数**没有被删**，它在原处。
- 免责段那句「两格是在 `d60b32d` 上两侧同树读回的数」跟着换绑 `e5d4046`。

守卫条数那 6 条账是当场数的，不是记忆的：`git show <rev>:tools/readme-claims.test.mjs | grep -c '^test('` 读出 `6c1fb91`=3、`1e0c215`=5、`154e2c1`=6、`e5fc2b4`=7、`d60b32d`=8、`fb88a58`=8、`e5d4046`=9，与 CI 那串 4105 → 4107 → 4108 → 4109 → 4110 → 4110 → 4111 一一对上。

### 五、我一枚打错的 run 页 ID，当场作废、一个字没进门面

抓列表那几次我先在终端里**凭手感**打了一枚 `38372385933` 并 navigate 过去。页面只渲染出门面壳子：`len=402`，没有 run 标题、没有 `pushed <哈希>`、没有 `Test Results`（`s47-runpage-dump.json` 与 `s47-runpage-dump2.json` 两次都是 402）。第四十三节立的那条口径在这里以另一种方式起作用：**没有可配的树哈希，就等于没读到**——所以那一枚的任何一个数都没写进门面，也没写进这一节。真正进台账的是当场从列表 DOM 里抓出来的 `38373040533` 与它的孪生 `38373044488`（`s47-runlinks.json`、`s47-runlist-feat-new.json`）。

写死一条给自己：**run 页 ID 只能来自本次会话当场抓取的列表，不能从记忆里打**。这一条现在只有台账这句话管着，没有断言——守卫读的是 README，不是台账，硬要加就得先想清楚判据长什么样（第一刀那种「词表方向写反」的教训还在前面），本刀不自行动手。

### 六、还剩的欠账（不冒充已完成）

- 逐文件条数（`path-boundary.test.ts (18 tests)` 那一类）在 CI 上仍是推出来的：第四十五节第七节否掉的两条通路没有替代通路，本刀没有新探。
- 「ID 只能从当场抓取里取」目前只有本节点名，没有牙（见第五节末尾那句权衡）。
- `main` 仍停在 `c475caf`；`useBookStore.ts` 800/800 那一拆、`VersionHistoryPanel` 一族、侧栏 `.nav-row kbd` 死规则仍等一句话拍板，且拆 store 被并行会话的未提交改动挡着。

### 七、门禁与推送

本刀动两份文件：`README.md`（顶格两格 + 平台账 + 历史行 + 免责段换绑）与 `tools/readme-claims.test.mjs`（等式闸第二层，条数仍 9）再加台账这一节。回填用的本机读数来自**提交前的 `e5d4046` 干净树**，而本刀的提交会让 HEAD 前移——README 那两格点名的是 `e5d4046` 这棵树、不是「最新那棵树」，所以数不失效，这正是门面写下树哈希的理由。定稿遍在内容全部落定之后起跑，六枚退出码与该遍的 `stat`/`CHAIN_START` 先后落在 `/c/temp/m12-f/s48-final-exit.txt`；**本节不预告那一遍的结果**。提交后照 §四十七 第四节那条姿势（`HEAD:refs/heads/<名>`）快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。

## 四十九、2026-10-13：门面那句「第 247 与 302 行」立成第十道闸——锚点只存一份，代码侧与门面侧各测一头

### 一、上一刀那两枚 run 先读回来（逐字回盘，不是转述）

- `38374760339`——`门禁 pnpm verify #80`：`pushed 93d2ce4` / `fix/ci-path-platform-neutrality` / `Status Success` / `2m 18s`，summary 两行 `Test Files: ✅ 313 passes · 313 total`、`Test Results: ✅ 4111 passes · 4111 total`（`/c/temp/m12-f/s49-run-fix-93d2ce4.json`，页面正文 `len=690`，是 hydrate 完成后的长度）。
- `38374765450`——`门禁 pnpm verify #81`：同一枚 `93d2ce4`、`feat/plan3-interaction-and-assembly`、`Status Success`、`1m 40s`，两行 `Test Files: ✅ 313 passes · 313 total` / `Test Results: ✅ 4111 passes · 4111 total`（`s49-run-feat-page.json`，`len=694`）。两枚 ID 都出自当场的列表抓取（`s49-runlinks-fix.json`、`s49-runlinks-feat.json`），没有一枚是从记忆里打的——§四十八 第五节那条规则第一次真的被执行，而不是只写着。

读数意义：`93d2ce4` 相对 `e5d4046` 只改了 markdown 与守卫内部（没加减用例），CI 两侧仍报 4111，与门面顶格那格一字不差。这是**第二次**确认「门面/守卫内部的改动不新增用例时 CI 数不动」（第一次是 §四十七 那对 `fb88a58`）。本刀**加了**一条断言，所以下一轮 CI 该是 4112——那是下一轮的读数，本节点名不预支。

### 二、病灶：前四类闸一条都管不到「第 N 行写着什么」

`README.md:49` 那句「两枚 `it.skipIf(win32)`（`packages/fs-store/test/changes.test.ts` 的第 247 与 302 行，都是书外软链的守卫）」此刻是真的——当场回读：`:247` 与 `:302` 两行行首都是 `it.skipIf(process.platform === "win32")`。但这类引用坏得比路径安静：路径消失了第一类闸的 `fs.existsSync` 会红，而**行号不会因为上面插了一条用例而报错，只会整体下移**；那时门面上的第 247 行是一行用例标题字符串，读者按图看到别的东西，门面却还在替他保证「都是书外软链的守卫」。M13 把这件事演了一遍：把 247 写成 248，那一行实际是

```
    "目标文稿是指向书外的软链 ⇒ 拒（形状检查看不出来，只有 realpath 看得穿）",
```

——数字差 1，肉眼在门面读不出任何异常。

### 三、判据与「只许一份实现」怎么同时做到

新文件 `tools/platform-anchors.mjs` 只干一件事：把锚点存成一份。导出 `PLATFORM_IF`、`SKIP_IF_WIN32_T`（非 `g`，用于逐行匹配与 `toMatch`）、`SKIP_IF_WIN32_G`（由前者的 `source` 派生，不手抄）、`PATH_BOUNDARY_TEST` / `CHANGES_TEST` 两枚相对路径、`linesWith(source, anchor)`（逐行扫描，返回 1 基行号，同一行两处则重复两次以保证与全文 `matchAll` 同数）、`skipIfWin32Lines`、`countSkipIfWin32 = skipIfWin32Lines(...).length`（**条数由行号列表派生**，不另写一遍匹配逻辑），以及 `LINE_ANCHORS`（门面可按行号点名的文件 → 锚点）。

- `tools/platform-test-count.test.mjs`：删掉本地那份 `PLATFORM_IF` 与 `countSkipIfWin32`，两处字面路径改用常量，改为 import；**五条断言一字未改**（行为等价，还原后 `Tests 15 passed (15)` = 10 + 5）。
- `tools/readme-claims.test.mjs` 第十道（`grep -c '^test('` 当场数：10）分三层：①**实例声明**——门面上至少有一处「`某文件` 的第 N 行」的写法，提取不到即红；②**锚点登记**——被点名的文件必须在 `LINE_ANCHORS` 里有锚点，没登记**不算跳过、算红**，否则门面新点名一个文件写行号就不需要负任何责任；③**逐行 + 完整性**——每个被点名的行号那一行确实含锚点（管多写/写歪），且锚点出现的**全部**行号等于被点名那一组（管漏数）。
- 两处刻意的选择：扫描**全文**而非只扫「## 门禁」（行号引用出现在哪一节都该核对）；**不剥 `「…」`**（剥了等于给「把引用写进引号里躲闸」留通路，与 run 页 ID 那条同族）。

### 四、先证明它能红：M13–M16，四枚变异两头都测到

| 变异 | 只改什么 | 结果 | 落盘 |
| --- | --- | --- | --- |
| **M13** | README `第 247 与 302 行` → `第 248 与 302 行` | `M13_EXIT=1`，红在**逐行**：`点到的第 248 行其实是 "\"目标文稿是指向书外的软链 ⇒ 拒（形状检查看不出来，只有 realpath 看得穿）\",", 不含锚点 it\.skipIf\(…\)`；`Tests 1 failed \| 9 passed (10)` | `s49-mut-m13.log` |
| **M14** | 只留 `第 247 行`，删掉「与 302」 | `M14_EXIT=1`，红在**完整性**：`点名了 247 行，可 … 锚点实际出现在 247、302 行`；`1 failed \| 9 passed (10)` | `s49-mut-m14.log` |
| **M15** | 行号整句删掉，改成「`packages/fs-store/test/changes.test.ts` 里那两枚」 | `M15_EXIT=1`，红在**实例声明**：`README 里一处「某文件」的第 N 行的引用都没提取到… expected 0 to be greater than 0`；`1 failed \| 9 passed (10)` | `s49-mut-m15.log` |
| **M16** | **代码侧**临时插第三枚 `it.skipIf(process.platform === "win32")`（文件末尾一行，真注册） | `M16_EXIT=1`，**两份守卫同时红**：readme-claims 完整性（`锚点实际出现在 247、302、706 行`）+ platform-test-count 的 `skipIf 现在是 3 条` + 同文件 `本机 passed 相对 Linux 差 0 条，不再是 1 条`；`Tests 3 failed \| 12 passed (15)` | `s49-mut-m16.log` |

M16 是本刀最值一枚：它证明这条闸不是只盯 README 措辞，代码侧漂移同样打得到它；而且一次同时打红两份守卫，正是「锚点只存一份」的可见证据——两处判据同源，改一处代码两边一起知道。测完 M16 我把完整性的**错误文案**改写过一次（原句把「多写」与「漏写」混在一句里，而多写那一头已被逐行判据拦住，写出来会让人以为这里管两头）；改写后在**同一枚尚未还原的变异**上复跑：`M16C_EXIT=1`，新文案逐字 `门面漏点了第 706 行。多写的那一头由上面逐行那条判住（点名的行不含锚点就先红），这里只管漏数——读者按门面只找到一处守卫`，仍是 `1 failed | 9 passed (10)`（`s49-mut-m16c.log`）——即改文案没有把牙改钝。

还原与复绿：四枚变异分别用 `cp /c/temp/m12-f/README.s49.orig.md README.md`、`cp /c/temp/m12-f/changes.s49.orig.ts packages/fs-store/test/changes.test.ts` 还原，每次 `cmp` 返回 0（终端记 `RESTORE_M13_CMP=OK`、`RESTORE_M14_CMP=OK`、`RESTORE_M15_CMP=OK`、`RESTORE_M16_CMP=OK`；这几条只打在终端上，落盘的是还原后 `git status --porcelain` 只剩本刀要提交的四行：` M README.md`、` M tools/platform-test-count.test.mjs`、` M tools/readme-claims.test.mjs`、`?? tools/platform-anchors.mjs`）。还原后两份守卫复跑：`VITEST_EXIT=0`、逐字 `Test Files  2 passed (2)` / `Tests  15 passed (15)`（`s49-after-restore.log`）；`pnpm exec prettier --check` 四份文件 `PRETTIER_EXIT=0`、`All matched files use Prettier code style!`（`s49-prettier.log`）。

### 五、门面上改了哪一处（原文照抄自 `git diff -U0 README.md`，落盘 `s49-readme.diff.txt`）

```
-`tools/platform-test-count.test.mjs` 钉着，改那两个平台分支时它会先红。
+`tools/platform-test-count.test.mjs` 钉着，改那两个平台分支时它会先红；那两个行号本身由
+`tools/readme-claims.test.mjs` 核对（锚点定义只在 `tools/platform-anchors.mjs` 存一份，行号一漂移门面就红）。
```

顶格那两格（CI `4111` / 本机 `4112 passed | 2 skipped（4114 条注册）`）与那句平台账、历史行、免责段**本刀一律没动**：免责段明写「回填不是每刀必做」，而本刀新增了一条断言，这两个数此刻各落后 1 条——这正是门面那句话描述的状态，等下一次真要回填时两侧同树重读。等式闸对此完全无感也不该有感：它算的是门面上那几处等式自己，`3 → 9` 那句说的是 `6c1fb91`→`e5d4046` 那段跨度，与最新树无关。

### 六、还剩的欠账（不冒充已完成）

- 逐文件条数（`path-boundary.test.ts (18 tests)` 那一类）在 CI 上仍是推出来的，本刀没有新通路。
- 「run 页 ID 只能来自当场抓取」目前仍只有 §四十八 那句话管着，没有断言。
- `LINE_ANCHORS` 只登记了 `CHANGES_TEST` 一份。这是刻意的窄：门面点名别的文件写行号时会**直接红**而不是静默跳过，届时要么去登记锚点、要么把行号改成前四类能核对的写法。
- 行号闸是**文本判据**：锚点若被写成跨行（`it.skipIf(\n  process.platform === "win32"\n)`）就扫不到——与 `platform-test-count` 同源同限，不是本刀新引入的洞，但记在这里。
- `main` 仍停在 `c475caf`；`useBookStore.ts` 800/800 那一拆、`VersionHistoryPanel` 一族、侧栏 `.nav-row kbd` 死规则、皮肤广场 §五 A/B/C 仍等一句话拍板，拆 store 还被并行会话的未提交改动挡着。

### 七、门禁与推送

本刀动四份文件：新增 `tools/platform-anchors.mjs`，`tools/platform-test-count.test.mjs`（改 import，断言条数不变），`tools/readme-claims.test.mjs`（+1 道闸，10 条），`README.md`（那两行）再加台账这一节。内容全部落定后才起六路定稿遍（`format:check` → `typecheck` → `lint:eslint` → `lint:boundary` → `lint:budget` → `test`，逐段落盘、退出码落 `s49-final-exit.txt`、日志 grep 复核）**本节不预告那一遍的结果**；本机这一遍注册数应比 `e5d4046` 那轮多 1 条，但那是待读到的数，不是这里的数。提交后照旧用 `HEAD:refs/heads/<名>` 快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。

## 五十、2026-10-13：门面那句「五道闸」立成第十一道闸——脚本里每加一段，门面就得同改

### 一、病灶：门面上的闸数与 `verify` 真身从来没被任何断言对过

`README.md:43`（`05b1d53` 那棵树）逐字回盘：

```
一条命令串起五道闸，任何一道红就不能提交：prettier 全仓格式、`tsc --noEmit`（6 个类型程序）、
```

而 `package.json` 的 `verify` 真身按 `&&` 切开是 12 段、滤掉末尾那句取码用的 `echo VERIFY_EXIT=0` 剩 11 段（当场用 `node -e` 数：`ALL= 12`、`NO_ECHO= 11`），归成**六类**（prettier / 6 枚 `tsc --noEmit -p` / eslint / `node tools/check-package-boundary.mjs` / `node tools/check-source-line-budget.mjs` / `vitest run`）。连 CI 自己的作业名都写的不是五：`.github/workflows/verify.yml:27` 逐字 `name: 六路 typecheck + lint + boundary + budget + 全量测试`。

数错不是洁癖，这条闸真正要拦的是**反方向的漂移**：往 `verify` 里再串一段普查脚本，前面十道闸一条都不会红——它们只认得门面上写过的东西。M17 演的就是这一头：加一段 `node tools/check-an-unregistered-gate.mjs`，同一次跑里 readme-claims 另 10 条 + ci-gate 6 条全部通过，只有新臂红。换句话说，「加段不改门面」在本仓此刻**已经发生过一次**（六类 vs 五道闸就是它的结果），本刀把它反过来钉住。

### 二、判据：两头配平 + 两个数 + 三条实例声明

新臂（`tools/readme-claims.test.mjs` 第十一道，`grep -c '^test('` 当场数：11）四条判据：

1. **每段都要有归属**——`verify` 切出的每一段必须**恰好**落进 `VERIFY_KINDS` 一类：落不进（新段没登记）红，落进两类（登记表互相覆盖）也红。
2. **每一类都要在门面上有写法**——`VERIFY_KINDS` 里每一类的 `facade` 正则必须在「## 门禁」那一节找得到，漏写一整段即红。
3. **每一类都要在 `verify` 里真有一段**——门面还写着、脚本却被摘掉/改名，同样红（第 2 条只管反方向，两条合起来才是双向）。
4. **两个数要数得出来**——「串起 N 道闸」的 N = 实际出现的类别数；「`tsc --noEmit`（M 个类型程序）」的 M = tsc 段数。中文数字与阿拉伯数字都认。

三条**实例声明**分别盯 `stages.length > 1`、`gateClaim`、`tscClaim`（M23/M24 各打中头一条）——延续 §四十二 那条口径：提取面塌了比门面写错更糟，所以「抓不到写法」本身是红。

与 `tools/ci-gate.test.mjs` 的分工写明在这里，免得下一个人判成重复：那份钉的是**形状**（`&&` 串起来、不含 `;`、含 vitest/eslint/prettier 片段），这份钉的是**门面说的与脚本做的一段一段对应**。类别表只存一份（就在本文件顶上的 `VERIFY_KINDS`），`facade` 与 `seg` 同表同条目——改脚本字面而不改这张表会红在第 1 条，改门面措辞而不改这张表会红在第 2 条。

### 三、先证明它能红：M17–M24，八枚变异覆盖四条判据与三条实例声明

| 变异 | 只改什么 | 结果（错误文案逐字抄自日志） | 落盘 |
| --- | --- | --- | --- |
| **M17** | `verify` 里插一段 `node tools/check-an-unregistered-gate.mjs` | 红在**归属**：`verify 里这些段没登记在「VERIFY_KINDS」：node tools/check-an-unregistered-gate.mjs——门面对它们一无所知，读者以为门禁只跑门面列的那几段；要么给这段加一句门面说法并在这里登记，要么把这段摘掉`；`Tests 1 failed \| 16 passed (17)`（同跑的另 10 条闸 + ci-gate 6 条全绿＝旧闸对新增段完全无感） | `s50-mut-m17.log` |
| **M18** | README `六道闸` → `五道闸`（本刀修掉的病灶反过来） | 红在**总数**：`门面说「串起 五 道闸」，可 verify 真身里出现的类别是 6 类（prettier 全仓格式 / tsc --noEmit 类型程序 / eslint / 包边界检查 / 单文件行数预算 / 全量测试 vitest run）——数目对不上，读者会按门面去数脚本、以为少跑或多跑了一段`；`1 failed \| 26 passed (27)`，**A/B 同跑**：`git show HEAD:tools/readme-claims.test.mjs` 那份十条闸 `✓ tools/zz-oldguard-ab.test.mjs (10 tests)`、ci-gate 6 条，两者全绿 | `s50-mut-m18.log` |
| **M19** | README「6 个类型程序」→ 5 | 红在**tsc 数**：`门面说 5 个类型程序，可 verify 里 tsc 段实际有 6 段：tsc --noEmit -p packages/contracts/tsconfig.json ｜ … ｜ tsc --noEmit -p apps/desktop/tsconfig.web.json——新增或删掉一个包的 tsconfig 时门面这一格要同改`；**A/B 另跑**旧守卫 + ci-gate：`Tests 16 passed (16)`、`Test Files 2 passed (2)` 全绿 | `s50-mut-m19.log`、`s50-mut-m19-oldguard.log` |
| **M20** | `verify` 摘掉 `node tools/check-source-line-budget.mjs` 那一段 | 红在**每一类得真有一段**：`门面上还写着这几类闸，可 verify 真身里一段都没有（被摘掉或改名了）：单文件行数预算——门面在说一件不再发生的事`；`1 failed \| 16 passed (17)`，ci-gate 6 条照旧绿（它只 spot-check vitest/eslint/prettier 三段在场） | `s50-mut-m20.log` |
| **M21** | README 删掉「包边界检查」那一格 | 红在**门面上得有写法**：`「## 门禁」那一节里找不到这几类闸的写法：包边界检查——脚本里那段还在跑，门面漏写了一整段（改门面措辞时要连这里一起改）`；`1 failed \| 16 passed (17)` | `s50-mut-m21.log` |
| **M22** | **守卫自己**加一条与 prettier 重叠的登记 `{ kind: "M22 重复登记", seg: /^prettier/, facade: /prettier/ }` | 红在**不许两类互相覆盖**：`verify 里这些段同时落进两类：prettier . --check → M22 重复登记 / prettier 全仓格式——登记表里的判据互相覆盖了，「一道闸」从此数不出来`；`1 failed \| 10 passed (11)` | `s50-mut-m22.log` |
| **M23** | README「串起六道闸」→「串起六道关卡」 | 红在**实例声明**：`门面上找不到「一条命令串起 N 道闸」的写法了——这一臂此刻没有实例，等式之外的那个总数没人核（第四十二节那条教训）: expected null not to be null`；`1 failed \| 16 passed (17)` | `s50-mut-m23.log` |
| **M24** | `verify` 整条换成 `sh tools/verify-wrapper.sh` | **两份守卫同时红**：本闸 `根 package.json 的 verify 切不出段来——要么它被改成 ;／包进了 shell 包装（那是 ci-gate 的病灶），要么这里的切分写坏了：两种都让这条闸静默失效`（expected 1 to be greater than 1）+ ci-gate `expected 'sh tools/verify-wrapper.sh' to match /vitest run/`；`Tests 2 failed \| 15 passed (17)` | `s50-mut-m24.log` |

M24 是八枚里唯一一枚与 `ci-gate` 重叠的——重叠的是「shell 包装」这一种形状，不是同一条判据；记在这里是为了不让「两条闸同时红」被误读成判据抄了两份。

顺带记一条我自己的错：`unclassified` 那条文案第一版把 `VERIFY_KINDS` 用反引号包进了模板字符串（`` `…没登记在 `VERIFY_KINDS`：${…}` ``），那是 JS 语法错误。**最廉价的那道闸先抓住它**：`node --check tools/readme-claims.test.mjs` → `SYNTAX_OK` 之前先红，没惊动 vitest。修法是改用「」，改完再跑语法关卡。

### 四、还原与复绿

八枚变异逐枚 `cp` 还原（`s50-package.orig.json` / `s50-README.orig.md` / `s50-readme-claims.orig.mjs` 三份原样备份），每次 `cmp` 返回 0，终端记 `M17_RESTORE_CMP_OK` … `M24_RESTORE_CMP_OK`；M18/M19 那两枚用完的 A/B 探针 `tools/zz-oldguard-ab.test.mjs` 每次当场 `rm`（跑完 `git status --porcelain` 只剩本刀要提交的三行 ` M README.md`、` M tools/ci-gate.test.mjs`、` M tools/readme-claims.test.mjs`，没有第四行）。全部还原后三份守卫合跑：`RESTORE_EXIT=0`、逐字 `Test Files  3 passed (3)` / `Tests  22 passed (22)`（11 + 6 + 5），`✓ tools/ci-gate.test.mjs (6 tests)`、`✓ tools/platform-test-count.test.mjs (5 tests)`、`✓ tools/readme-claims.test.mjs (11 tests)`（`s50-after-restore.log`）。`pnpm exec prettier --write` 三份文件：`tools/readme-claims.test.mjs` 有格式化、`tools/ci-gate.test.mjs (unchanged)`、`README.md (unchanged)`，`PW_EXIT=0`（`s50-prettier-write.log`）。

**当场收回一句我自己写下去的假话**：新臂 docstring 第一版写着「`tools/ci-gate.test.mjs` 的 docstring 里就记着当年有人拿「五道闸」去数、于是把 vitest 解释成『不算闸』」——回盘那份文件原文（`:10-12`）只记着「门面写着五道闸，而扫描实跑确认既没有 CI 也没有 git 钩子」，**没有任何人把 vitest 解释成不算闸**。那是我给病灶编的出处，已改成有盘的写法（引 `.github/workflows/verify.yml:27` 那句作业名 + M17 实测的「旧闸无感」），改完 `node --check` → `SYNTAX_OK`、`prettier --write` → `(unchanged)`、三份守卫复跑 `FINAL_SCOPED_EXIT=0` / `Tests 22 passed (22)`（`s50-after-docstring-fix.log`），条数仍 11（`grep -c '^test('`）。台账这一节本身不参与格式闸——`.prettierignore` 里明写 `docs/superpowers`，那块牌子由 `tools/prettier-scope.test.mjs` 钉着。

### 五、门面与 docstring 各改了一处（原文照抄自 `git diff -U0`，落盘 `s50-readme-ci.diff.txt`）

```
-一条命令串起五道闸，任何一道红就不能提交：prettier 全仓格式、`tsc --noEmit`（6 个类型程序）、
+一条命令串起六道闸，任何一道红就不能提交：prettier 全仓格式、`tsc --noEmit`（6 个类型程序）、
```

```
- * ① README 的门面写着「一条命令串起五道闸，任何一道红就不能提交」，而扫描实跑确认
+ * ① README 的门面当时写着「一条命令串起五道闸，任何一道红就不能提交」（那句现已改成六道闸——
+ *    数错的那一头由 `tools/readme-claims.test.mjs` 的门禁组成臂看着），而扫描实跑确认
```

`ci-gate` 那一处不是修饰：它把当年病灶的**引文**留在原位置，而引文所指的那句门面已经被本刀改掉——不写「当时」，下一个人按图去 README 找「五道闸」会找不到，那正是 §三十二 立的「东西在、说明指向别处」这一族假话的反向形态。顶格那两格测试数、平台账、历史行、免责段照 §四十九 的口径**一律没动**。

### 六、还剩的欠账（不冒充已完成）

- `.github/workflows/verify.yml:27` 那句作业名「六路 typecheck + lint + boundary + budget + 全量测试」**没有任何断言看着**，而且它自己列出的只有五件事（typecheck/lint/boundary/budget/全量测试）却写着「六路」——本刀把闸数钉在 README↔`package.json` 之间，yml 那一头仍是第三处口径。要不要把作业名也并进同一张登记表是**下一刀候选**，前提是先回答「一处纯文案值不值得有闸」；在此之前不许声称 CI 侧的数目也被钉住了。
- `seg` 正则按**当前脚本字面**匹配：把 `prettier . --check` 写成 `prettier --check .` 这类等价改法会落进 `unclassified`（红，不是静默通过）。这是刻意的严，代价是改脚本写法必须同改登记表。
- `CN_NUM` 只覆盖一…十。当场探针（`node -e` 跑那枚正则）：`串起六道闸`→6、`串起11道闸`→11、`串起 六 道闸`→6、`串起十一道闸`→**null**、`串起六道关卡`→null。所以中文两位数写法会红在**实例声明**那一臂（不是 `undefined` 混过去），届时要连正则一起扩。
- 前几轮留下的照旧：CI 上逐文件条数仍是推出来的；「run 页 ID 只能来自当场抓取」仍只有台账那句话管着；`main` 仍停在 `c475caf`；`useBookStore.ts` 800/800 那一拆、`VersionHistoryPanel` 一族、侧栏 `.nav-row kbd` 死规则、皮肤广场 §五 A/B/C 仍等一句话拍板，拆 store 还被并行会话的未提交改动挡着。

### 七、门禁与推送

本刀动四份文件：`tools/readme-claims.test.mjs`（+1 道闸，11 条）、`README.md`（那一句）、`tools/ci-gate.test.mjs`（那句引文的时态）、台账这一节。`package.json` **一字未改**——本刀修的是门面说错了数，不是脚本少跑了一段；M17/M20/M24 那三枚只是变异现场，均已 `cmp` 还原。内容全部落定后才起六路定稿遍（`format:check` → `typecheck` → `lint:eslint` → `lint:boundary` → `lint:budget` → `test`，逐段退出码落 `s50-final-exit.txt`、日志剥 ANSI 后 grep 复核）**本节不预告那一遍的结果**；本机注册数相对 `05b1d53` 那一轮应多 1 条，但那是待读到的数，不是这里的数。上一刀 `05b1d53` 的两枚 run 仍没读回来（浏览器通路连续三次 `ERR_CONNECTION_RESET`/`TIMEOUT`，见任务 #34），本轮不拿它当已完成。提交后照旧用 `HEAD:refs/heads/<名>` 快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。

## 五十一、2026-10-13：把「同树」这两个字钉成第十二道闸——门面里那三处树引用必须指同一枚哈希

### 一、两侧读数先落盘（逐字回盘，不是转述）

四枚 run 页都出自**本次会话当场抓取的列表**，读数存 `/c/temp/m12-f/s51-run-readings.json`（`pageTextLen` 是 hydrate 完成后的正文长度，四枚各 686–698，没有一枚低于 §四十八 定的 600 门槛）：

- `38377216920`——`门禁 pnpm verify #82`：`pushed 05b1d53` / `fix/ci-path-platform-neutrality` / `Status Success` / `1m 42s`，`Test Files: ✅ 313 passes · 313 total`、`Test Results: ✅ 4112 passes · 4112 total`。
- `38377221170`——`#83`：同一枚 `05b1d53`、`feat/plan3-interaction-and-assembly`、`Success`、`2m 33s`，两行同上（4112）。
- `38379782856`——`#84`：`3a8dcc7` / `fix/ci-path-platform-neutrality` / `Success` / `1m 28s` / `313 passes · 313 total` / `4113 passes · 4113 total`。
- `38379787815`——`#85`：同一枚 `3a8dcc7`、`feat/plan3-interaction-and-assembly`、`Success`、`1m 43s`，两行同上（4113）。

`05b1d53` 那一对把任务 #34 结掉了（上一节点名它「仍没读回来」，本节起它就是已读回）；`3a8dcc7` 那一对正是门面新顶格要引的出处。

本机侧必须在**同一棵树**上重读，才算「同树对照」。跑法是 §四十六 那套：`git status --porcelain` 跑前先读、跑后再读，两次都空才算数。当场记录（`/c/temp/m12-f/s51-same-tree.txt`，逐字）：`HEAD=3a8dcc77e4eaf05956d8779915ab31989b861c1d`、`PORCELAIN_BEFORE:` 空行、`START=2026-10-13T18:02:01+08:00`、`TEST_EXIT=0`、`END=2026-10-13T18:02:44+08:00`、`PORCELAIN_AFTER:` 空行；日志（`s51-same-tree-test.log`，剥 ANSI 后第 387–390 行）逐字 ` Test Files  313 passed (313)` / `      Tests  4114 passed | 2 skipped (4116)` / `   Duration  40.53s`。

守卫自己身后那条账也要当场数，不靠记忆：`git show <rev>:tools/readme-claims.test.mjs | grep -c '^test('` 逐 rev 得 `6c1fb91 => 3`、`1e0c215 => 5`、`154e2c1 => 6`、`d60b32d => 8`、`e5d4046 => 9`、`93d2ce4 => 9`、`05b1d53 => 10`、`3a8dcc7 => 11`（落盘 `s51-count.txt`）。于是 `4105 → 4113` 差的 8 条 = 守卫 `3 → 11` 差的 8 条，门面那句等式两侧都由 `git show` 当场核过——等式闸的第三处 `ties` 正指着 CI 那一格，改任何一边它先红。

### 二、病灶：回填那几分钟，门面指着两棵不同的树，十一道闸一条都不红

这一刀的收获不在换绑，而在换绑**过程中撞到的那条空通路**。我先改完顶格两格与平台账，隔了几分钟才回头改免责段那句「上面门禁那两格是在 `…` 上**两侧同树**读回的数」。那几分钟里 CI 那格与本机那格指着 `3a8dcc7`，免责段还留着上一刀的 `e5d4046`——门面正在说假话，而十一道闸全绿。为了让这句话不是我的自述，把它做成变异当场跑：只改免责段那一枚哈希（`3a8dcc7` → `e5d4046`），`M25_EXIT=0`、逐字 ` ✓ tools/readme-claims.test.mjs (11 tests)`、`Tests  11 passed (11)`（`s51-mut-m25.log`）。

为什么前面十一道都拦不住：出处闸管的是「每条数有没有配哈希与日期」，三处各自都配得齐；等式闸（§四十六、§四十八）对表的是**数字**跨格，`4113+3=4116` 那几处算术在树不一致时照样算得过；行号闸与门禁组成闸点的是别的对象。**「这一组数跑在哪一棵树上」在门面上出现三处——CI 那格的「干净提交树 `X`」、本机那格的「同一棵树 `X`」、免责段的「在 `X` 上两侧同树读回」——从未被要求互相对表。** 而「同树」是这两格的**前提**：两侧不同树，那 1 条平台差就无从解释，门面却还在替它担保。

### 三、判据两层，与「只许一份正则」怎么同时做到

新臂（第十二道）分两层，少一层就留一条脱身通路：

1. **对表**：门禁那一节里，句子既含同树类主张（`同树` / `同一棵树` / `干净提交树`）又点名了短哈希的，各处哈希必须是**同一枚**；bump 任何一处而忘另一处即红。
2. **实例声明**：这样的句子至少 2 处（门面上现在正好 3 处）。只剩一处时「全部相等」必然空转——这是 §四十二 那条老教训的第三次落地（提取写坏比门面写错更糟，守卫静默失效）。

取枚**复用**上面已有的 `SHA_G`（反引号十六进制），只加一道**长度**筛：门面上的树哈希固定写 7 位，于是 run 页 ID（11 位纯数字）与 64 位 sha256 天然被长度筛掉，不必另起第二份正则（锁定前提第 6 条）。若哪天树哈希改用 8 位以上写法，那一处不再算实例，实例数掉到 1 会红——不会静默放过。

两处刻意的**不管**：门面上另有两处同树说法是**规则句**而不是读数句（「同树对照差的这 1 条不是漂移…」与「做的时候两侧都要从同一棵树重读…」），它们不指认具体树，因此判据只收「含哈希的同树句」，强要哈希会把规则句当读数句管；`「…」` 里的反例照旧先剥掉再判，与前面几臂同源。

### 四、先证明它能红：M25–M27，两臂各测一头

| 变异 | 只改什么 | 结果 | 落盘 |
| --- | --- | --- | --- |
| **M25** | 免责段 `3a8dcc7` → `e5d4046`（**新闸之前**） | `M25_EXIT=0`，`Tests  11 passed (11)`——空通路当场坐实 | `s51-mut-m25.log` |
| **M25′** | 同一处，加了新臂之后 | `M25_NEW_EXIT=1`，红在**对表**：`门面上的同树声明指向了 2 枚不同的短哈希：3a8dcc7←「## 门禁：…`tsc --noEmit`（」 ／ 3a8dcc7←「本机 Windows 在同一棵树 \`3a8dcc7\`…」 ／ e5d4046←「…所以这里只留：上面门禁那两格是在 \`e5d4046\` 上两侧同树读回的数…」——顶格两格 bump 了而免责段还留着旧树（或反过来）`；`Tests  1 failed \| 11 passed (12)` | `s51-mut-m25-newguard.log` |
| **M26** | **CI 那一格** `3a8dcc7` → `05b1d53`（免责段与本机格不动） | `M26_EXIT=1`，同样红在对表（三处预览里第 1 处读成 `05b1d53`），且**只有这一条红**——证明这一臂不分方向，bump 顶格忘免责段与 bump 免责段忘顶格都打得到 | `s51-mut-m26.log` |
| **M27** | 两格的措辞改成「那棵树」／「同一平台」，**哈希一字不动** | `M27_EXIT=1`，红在**实例声明**：`「## 门禁」那一节里只有 1 处「同树／同一棵树／干净提交树」的声明点名的短哈希——少于 2 处时「各处必须相等」会空转，这一臂此刻等于没测`，`expected 1 to be greater than 1`；同跑其余 11 条全绿，**出处闸没有连带红** | `s51-mut-m27.log` |

M27 是这一刀里最值得的一笔：它证明实例声明**单独**可红，而且是靠改措辞、不动任何数字触发的——如果那一臂只能靠改数触发，它其实就是对表臂的复读。

还原与复绿：M25′ 用 Edit 把免责段改回、`diff -q README.md /c/temp/m12-f/README.s51.orig.md` 报 `README_RESTORED=IDENTICAL`；M26 与 M27 各用 `cp /c/temp/m12-f/README.s51.orig.md README.md` + `cmp`，终端记 `RESTORE_M26_CMP=OK`、`RESTORE_M27_CMP=OK`。四份守卫（readme-claims / ci-gate / platform-test-count / prettier-scope）还原后复跑：`GUARDS_EXIT=0`、逐字 `Test Files  4 passed (4)` / `Tests  28 passed (28)`（= 12 + 6 + 5 + 5，`s51-guards-final.log`）。`prettier --write` 与 `--check` 对 `README.md`、`tools/readme-claims.test.mjs` 都是 `PC_EXIT=0`、`All matched files use Prettier code style!`。

### 五、门面上改了哪两处（原文照抄自 `git diff README.md`，落盘 `s51-readme.diff.txt`）

```
-（CI 在 Linux 上的干净提交树 `e5d4046`（…run 页 `38373040533`
-与孪生的 `38373044488`）报的数：**313 文件 / 4111 用例**；本机 Windows 在**同一棵树** `e5d4046`（2026-10-13）实测
-**313 文件 / 4112 passed | 2 skipped**（4114 条注册）…
+（CI 在 Linux 上的干净提交树 `3a8dcc7`（…run 页 `38379782856`
+与孪生的 `38379787815`）报的数：**313 文件 / 4113 用例**；本机 Windows 在**同一棵树** `3a8dcc7`（2026-10-13）实测
+**313 文件 / 4114 passed | 2 skipped**（4116 条注册）…
-；Linux 侧 4111 条注册 = 本机 4114 − 3。
+；Linux 侧 4113 条注册 = 本机 4116 − 3。
-…从 4105 到 4111 差的 6 条 **全部出自门面守卫自己**——…从 3 条加到 9 条…
+…从 4105 到 4113 差的 8 条 **全部出自门面守卫自己**——…从 3 条加到 11 条…
-所以这里只留…：上面门禁那两格是在 `e5d4046` 上**两侧同树**读回的数
+所以这里只留…：上面门禁那两格是在 `3a8dcc7` 上**两侧同树**读回的数
-做的时候两侧都要从**同一棵树**重读，只 bump 一边会把同树对照又拆掉。要准数请跑 `pnpm test` 看当场输出。
+做的时候两侧都要从**同一棵树**重读，只 bump 一边会把同树对照又拆掉——这件事现在有自己的闸：
+门面里那几处同树说法点名的短哈希必须同一枚，差一枚当场红。要准数请跑 `pnpm test` 看当场输出。
```

历史行同批补进 `05b1d53`（4112）并把 `93d2ce4` 与 `e5d4046` 合成一句（都报 4111），run 页 ID 全部用本次会话读回的那几枚；免责段那句「上面门禁那两格是在 `3a8dcc7` 上**两侧同树**读回的数」与新增那两行是**新臂的两个被测实例**，所以这一处门面措辞不能随手改——改了要连判据一起改（§四十二 那条）。

### 六、还剩的欠账（不冒充已完成）

- 新臂只对表**文本**：三处说法若被改成完全不带哈希的写法，整臂会因实例数不足而红（M27 证到），但若两处各带**不同的 8 位以上**写法，长度筛会把它们都筛掉、同样红在实例数——不会静默通过，但红的原因不是「树不一致」。这一点记在这里，不写成已解决。
- 门面那句「从 3 条加到 11 条」说的是 `6c1fb91 → 3a8dcc7` 那段跨度，与最新树无关；本刀又加了一条断言（此刻 12 条），所以顶格那两个数各再落后 1 条——这正是免责段描述的状态。下一轮真回填时两侧同树重读，本机应是 4115 passed | 2 skipped（4117 注册）、CI 应报 4114，**那是待读到的数，本节不预支**。
- 照旧未还：`.github/workflows/verify.yml:27` 那句作业名（自己列五件事却写「六路」）仍无闸；CI 上逐文件条数仍是推出来的；「run 页 ID 只能来自当场抓取」仍只有台账这句话管着；`main` 仍停在 `c475caf`；`useBookStore.ts` 800/800 那一拆、`VersionHistoryPanel` 一族、侧栏 `.nav-row kbd` 死规则、皮肤广场 §五 A/B/C 仍等一句话拍板，拆 store 还被并行会话的未提交改动挡着。

### 七、门禁与推送

本刀动三份文件：`README.md`（顶格两格换绑 + 平台账 + 历史行 + 免责段那句 + 新增那两行）、`tools/readme-claims.test.mjs`（+1 道闸，11 → 12 条）、台账这一节。`package.json` 与 `.github/workflows/verify.yml` **一字未改**——所以门禁**组成**没变，门面那句「六道闸」依旧与 `verify` 真身对得上（新臂与它互不相干，M25–M27 三枚变异期间它一次也没红）。M25/M26/M27 只是变异现场，均已 `cmp` 还原。内容全部落定后才起六路定稿遍（`format:check` → `typecheck` → `lint:eslint` → `lint:boundary` → `lint:budget` → `test`，逐段退出码落 `s51-final-exit.txt`、日志剥 ANSI 后 grep 复核）**本节不预告那一遍的结果**；本机注册数应比 `3a8dcc7` 那一轮多 1 条，但那是待读到的数。提交后照旧用 `HEAD:refs/heads/<名>` 快进推两个 ref，`git ls-remote --heads` 回读等于本地 HEAD。






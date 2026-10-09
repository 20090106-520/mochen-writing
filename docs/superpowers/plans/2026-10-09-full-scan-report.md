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
| P0-6 | **已修** | 两层：主进程 `uncaughtException`/`unhandledRejection` 钩子写 `crash.log` 并提示（带节流与「记不了也别再炸一次」的兜底）；`before-quit` 握手（渲染层兜底 flush 完才放行，带超时与「留下」档，正文与设定一起交回）。**没做** `requestSingleInstanceLock`——双开实例这条仍在 P2 清单里 | `main/crash-guard.ts`（5 条）、`main/quit-flush.ts`（10 条）、`utils/quit-flush-client.ts`（7 条）、`components/quit-flush-wiring.test.ts`（2 条） |
| P0-7 | **已修**（本波） | 设定三本（笔记 / 故事圣经 / 写作目标）改走**主进程文件通路**：渲染层只递白名单键 `notes \| story-bible \| writing-goal`，路径由主进程拼，落在书内 `.mochen/data/*.json`，随书隔离；写盘复用 P0-1 的原子写；旧全局 localStorage 键**只在盘上没有这一类数据时**迁一次，迁成功才清；`no-book`/`invalid-key`/`unreadable`/`write-failed` 分档各有话；形状校验三份独立（认不得判读不懂并**停止写盘**） | 契约 `packages/contracts/src/book-data.ts`；文件层 `packages/fs-store/src/book-data.ts`（11 条）+ `book-data.test.ts`；主进程 `main/book-service.ts` 的 `readData/writeData` + `main/book-data-service.test.ts`（7 条）；preload `readBookData/writeBookData`（`preload/renderer-api.test.ts` 6 条）；渲染层通路 `composables/useBookFileData.ts`（18 条）+ `composables/bookDataRegistry.ts`（7 条）；三本 store 各一份 `*.book-data.test.ts`（9 + 8 + 12 条）；形状 `utils/{note,bible,goal}-shape.ts`（10 + 10 + 19 条） |
| P0-8 | **已修** | 笔记档位表加第四档「已归档」、圣经加第五档，取回钮摆在明面上；`unarchiveNote`/`restoreEntry` 不再是零调用 | `components/NotesPanel.vue` + `notes-panel-wiring.test.ts`；`StoryBiblePanel.vue` + `story-bible-panel-wiring.test.ts`；取回归档视图的另一半由 `useStoryBibleStore.seeds.test.ts`（9 条）与 `utils/{note,bible}-scope` 钉 |

localStorage 那一侧的收尾对账：本波之后剩下的键全部是**应用级 UI 偏好**（`hotkey-config`、`notifications`、`onboarding`、`project-manager`、`prompt-templates`、`version-meta` 与各 `*-preference.ts`），不带作品内容的东西不再住全局键。`.mochen/` 也进了目录扫描的跳过表（`packages/fs-store/src/scan.ts` 的 `SKIPPED_DIRS`），设定文件不会被当成章节数进章数。

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

## 六、交付与验收的方法性缺口（我认为比单条 bug 更重要）

1. **没有 CI**：`.github` 目录不存在（我实跑 `ls`）。所有「门禁全绿」只在这台 Windows 机器上人工成立；台账 `README.md:6249` 自己写着「提交树单独是否全绿未证」。当前树又恰好是 prettier 红的（见第二节），正是这种状态无人发现的直接后果。
2. **没有打包/发布链路**：唯一的 build 是 `electron-vite build` 产 `out/`，`smoke` 脚本直接 `electron .`（根 `package.json:13-15`）；无 electron-builder/forge 配置被跟踪（`git ls-files` grep 零命中，只在被忽略的 `scratch/deepwrite-ref/` 里有参考副本）。**这个软件目前发不出去**——不能安装、不能更新、只能在这台机器上跑。这条要请用户拍板：是刻意只做自用工具，还是排期中还没做。
3. **验收样本规模是玩具级**：两本冒烟书分别是 5 篇和 2 篇（我实测 `find -name '*.md' | wc -l`），而产品面向的是 1000–3000 章的作者。P1-4/P1-5/P1-3 这一族全是「在小样本上恒绿」的问题。真机巡检做的都是视觉与控件级验证，从未量过规模。
4. **台账数字口径互异**：`README.md:6317` 写 215 文件/3014 用例，`:6395` 写 217/3037，我实测当前树是 217/3037。测试数没有单一事实源，长期会让「用例数变多」这种话失去意义。

## 七、台账里已记、这次仍在的开口（照录并核现状）

| 台账出处 | 事项 | 本次核对的现状 |
| --- | --- | --- |
| `README.md:6399` | 联网开着把整轮挂住 200 秒、零响应零报错，责任锁定「联网检索工具执行」那一路，标「待查」 | **未修，且我给了机制**：见 P1-1（无空闲超时 + 工具执行不受 abort 约束）。这条应当升为 P0 级用户痛点——他报过「无法对话」 |
| `README.md:6401` | 点输入框时整张卡内侧亮一圈青色边框（不是新元素，是 `.composer-input-surface` 聚焦态） | 未修，属样式判定；用户曾报为「弹出正方形」 |
| `README.md:6389` | 5-㊻ 最后一腿「真端点成功回一句」未验完，卡在必须先开一本书 | 未闭合。P1-1/P1-2/P1-3 都需要真开书 + 真端点才能验，建议与下面第八节第 2 波一起做 |
| `README.md:6242` | 皮肤挂件层运行时与新素材进表卡在 ImageGen 403 配额 | 外部配额，非代码问题 |
| `README.md:6244` | 次要文字对比度仍差 0.1–0.4，要动的是表面阶梯 | 未动 |
| `README.md:6247` | 窗口无 minWidth | 未动（P2-9） |
| `README.md:12` | Plan 2 遗留：`startListening` 丢弃了退订函数（无消费方）、UNBOUND 线程上的批准未做 | 未做。**注意**：UNBOUND 那条与 P0-4 是同一族——线程键作用域问题至今只在 threads 表上修了 |
| `README.md:787` | Responses API 未支持 | 未做 |
| `README.md:3689` | 插件目录拉取（远程）未做 | 未做，且我认为**不该做**（P1-7 的远程代码执行面），建议明写在 spec 里当边界 |

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
| 皮肤广场 8 套带整窗场景画 + 三道像素闸 | **真** | `appearanceSkins.ts:175` 起表、`tools/`、`apps/desktop/scripts/check-scene-art.mjs` |
| **挂件层**（用户 5-㊵ 明确要求「能有画的和挂件」） | **不存在** | 全仓 `挂件` 只出现在 `appearanceSkins.ts:10` 的一句注释里，无任何 widget/pendant 实现；台账 `README.md:6242` 记的是卡在 ImageGen 403 配额 |
| IME 组合态 / 思考窗 / 视图过渡 | **真**（b0fd99e 刚入库） | 提交记录与 `thinking-*` 测试 |

## 十一、我核过、确认没问题的（省得重复劳动）

凭据面：safeStorage 不可用即拒存、明文不落盘（`credential-store.ts:107-115`）、回渲染层只有 `••••后4位`、Ollama 空密钥连头都不发；XSS：两处 `v-html` 上游整体转义且有回归线（`markdownToSimpleHtml` 的注释就是当年那个洞的记录）；SSE 半包与跨 chunk UTF-8（`sse.ts:23-26` TextDecoder stream:true）；abort 真中止上游 fetch；每条 tool_call 都有配对回执；工具轮次有界（4 轮）无死循环；per-run 字段透传（`...deps.provider` 整铺 + 每轮字段显式覆盖）与 chip 提示同读一份判据；备份先于写盘、失败即中断写；删除类无硬删正文通路；`hydrate` 的「值对视图旧」有 computed 钉缓存回归；layoutStore/popover/voice/canvas 的监听与 rAF 收口到位；生产代码无 `child_process`。

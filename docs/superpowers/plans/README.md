# 实现计划索引

- Plan 1（本目录 `2026-10-01-plan1-shell-and-file-layer.md`）：三栏壳 + 文件层，对应 spec 的 S1/S2。已完成。
- Plan 2（本目录 `2026-10-01-plan2-streaming-and-proposal.md`）：**已完成**（S3 + S4，16 任务；真机三栏冒烟通过）。
  流式对话 + 提案写盘与审批；依赖 Plan 1 的 `contracts`、`fs-store` 与 `RendererApi`。
  本地 SSE 桩到真写盘全链的逐条观测与未做口径见 `2026-10-02-plan2-smoke-report.md`；
  计划点名的四项内部核查（`createIpcOn` 退订、`contextBridge` 返回函数、主/渲染 `UNBOUND` 同值、
  turn-end 后迟到 delta）原本**只有单测/静态证据**；2026-10-05 已用 Electron 的
  `--remote-debugging-port` + CDP 直连真实渲染层补验两项——`contextBridge` 通过，
  **turn-end 后迟到 delta 与 UNBOUND 同值两项各查出一个真缺陷并已修**（详见同报告的更正注）。
  余下「退订后不再收」查明**产品里没有消费方**（`startListening` 丢弃了退订函数），
  UNBOUND 线程上的批准仍未做——这两条不许升格成「真机验证」。
  变异台账（17 行：原 15 行 + 波 A + 波 A2）落在该计划文件 Task 16 Step 3。
- Plan 3（**进行中**，spec `../specs/2026-10-02-plan3-interaction-and-assembly-design.md`、
  计划 `2026-10-02-plan3-interaction-and-assembly.md`）：键位/权限档/打断排队 + 阶段装配与浏览不打断，对应 S5/S6；
  智能体侧按 spec §5.1 的墨宸花名册（六个 `AgentProfile` 实例）实现，不新增工具。
  依赖 Plan 2 的 `useAgentStore`（事件归约为唯一真相）与主进程 `agent-service`（唯一写盘通路）。
  Plan 2 收尾时两件悬而未决的事已由控制方拍板，Plan 3 照此执行：
  ① **主题默认值不硬锁深色**——现状 `App.vue:27-29` 跟随 `prefers-color-scheme` 保持不变，
  Plan 3 要加的是「跟随系统 / 浅色 / 深色」三态显式开关并持久化（品牌图仍是暗色调底，
  但把用户系统偏好盖掉是更糟的选择）；
  ② **品牌图来源按「用户提供的官方素材」定案**——规则锁死为原样使用、只做格式转换（PNG/ICO），
  禁止裁切、重绘或另生成（资产条目与转换记录见 `../../ATTRIBUTION.md` 的图标条）。
- **波 1.5（界面方向附录，2026-10-03 拆成计划并已交付，11 任务全闭合）**：设计 `../specs/2026-10-02-ui-fusion-direction-design.md`、
  计划 `2026-10-03-plan3-wave1-5-ui-fusion.md`（11 任务 ≤12 上限 ⇒ 仍是 Plan 3 的一波，不开 Plan 4）。
  用户 2026-10-02 给了两张墨宸界面示意稿并裁定走「B 骨架 + A 气质」融合。
  本波实际交付六面渲染层改造（中栏工作台 / 右栏作品资料 / 左栏三段主操作 /
  输入区两枚真开关 chip / md 片段工具栏 / 页脚阅读时长），并认领波 1 真机撞出的三条界面缺陷与六格留白；
  **F-E「墨宸 · 青金」preset 不在本波**——`themePresets` 至今全仓零消费者，本波加第四条仍是摆设，
  它随波 2 Task 19 的主题三态 + `appearance.json` 一起出生（那时才有真消费者）
  （附录 §3/§4 原文那句「波 3 的三态开关」是排期笔误，2026-10-03 已按 Plan 3 spec §3 第 114 行就地更正）。
  三条缺陷的复验屏幕原文见 `2026-10-03-plan3-wave1-5-report.md` Step 5-B；波 1 六格留白的逐格判定见同报告 Step 5-C
  （L1 / L2 / L4 本波复验后勾，L3 仍欠人肉一次，L5 / L6 属字面不可达标格，如实不勾）。
  排在波 1 门禁之后、波 2 之前，只碰 `apps/desktop/src/renderer`（外加 `error.proposalId?` 与 `DocRef.excerpt?`
  两处跨层**可选**字段，IPC 计数保持 13 一字不加）；
  **其中一条术语裁定影响全局：UI 上的「档案」永远只指 agent profile，右栏那一格定名「作品资料」。**
  **2026-10-03 用户裁定追加三件事，其中两件不在波 1.5**（破了「只碰渲染层」的前提）：
  ① 「深度思考 / 切模型」chip 解禁 ⇒ 模型枚举走主进程 `{baseURL}/v1/models` + 新 IPC 通道，**归波 2**；
  联网搜索照旧不做。② 「替我审批」**只作用在「全开」档**（其余两档永远逐条等人），
  开关生效点在主进程审批链，**归波 3**；裁定全文见总 spec §6。
  ③ 思考等级的出站字段格式范围仍未定案，定案前那枚 chip 不进 UI（附录 §7 第 4 条）。
  合成计划时的两处控制方裁定（执行者不再自行判断）：**裁定 A** 给 `agent-service.ts:347-351` 的写盘竞态分支
  补一条带 `proposalId` 的 error publish（它此前静默）；**裁定 C** chip 行不做带数字的排队徽标，
  队列计数只在状态行出现。


设计依据见 `../specs/2026-10-01-mochen-writing-workbench-design.md`；
移植自 deepwrite 的 UI 资产清单见 `../../ATTRIBUTION.md`。

## Plan 2 收尾时留下的已知缺口（逐条一句话，详情在冒烟记录原文里）

- **F-4（P2，品牌残留）——已在 Plan 3 波 3 处理**：目录已从 `appData/mochen-writing` 迁到
  `appData/mochen-ai`，连带 safeStorage 密文一起搬（`apps/desktop/src/main/app-data-migration.ts`：
  拷三个已知文件 → 验密 → 才改名，旧目录只改名不删除）。
- **F-6（P2，能力缺口）——已全闭合，含真机**：
  事件回放通道全链都在：主进程 `agent-service.loadSession` 三态
  （`found` / `no-session` / `no-book`，另有指名 `sessionId` 供历史面板点开某一条）、
  `agent:load-session` 通道、渲染层 `useAgentStore.ensureHydrated` 的水合八规则
  （`useAgentStore.hydrate.test.ts` 10 条，含一条「值对视图旧」的代理复现——那条是真机 P0 回归的教训换来的）。
  回放遵守 Plan 3 spec D1：**绝不复活可批准的待审队列**，未裁决的旧卡一律 `expired`、按钮禁用、单独分组。
  **真机那条也补上了**（2026-10-05，报告见同目录 `2026-10-05-f6-resume-smoke-report.md`）：
  杀掉进程 4→0，新进程里只做「打开书 + 点开文稿」，界面**自己**水合出 5 条事件的完整轮次，
  提案卡 id 不变、落进「上次会话未处理 · 1 条」折叠分组、页脚从「1 条待审」变回「就绪」。
  手法是 Electron 的 `--remote-debugging-port` + CDP 直驱真实渲染层（本机无 `computer_*` 桌面工具），
  证据是可读回的精确状态而非「看起来对」。已知取舍：回放不给 expired 卡取 diff，卡只有标题没有内容。
- **波 A 评审延后的四条 P3——已全部结清**（`.vue` 模板零自动化覆盖那条不是待办，是本仓的永久约束）：
  - `mock-provider` 的桩收尾分支**已补正向覆盖**（`tools/mock-provider.test.mjs` 11 → 14 条）。
    此前该文件里 `isFollowUp` 只被**反向**验过（末条是 user ⇒ 不许走收尾），「末条真是 tool ⇒ 该走收尾」
    这半边只有 `turn-e2e` 在主进程全链上看着。变异实测（`isFollowUp` 改成恒 false）证明了这个缝：
    改动后 14 条里只有新补的 2 条红，F-3 那条反向断言照样绿——收尾分支整条变成不可达死代码时，
    原测试集一声不吭。现补的三条分别钉住收尾文案与「不再派工具调用」、切帧步长（8 字 / 带「慢」2 字）、
    以及打断轮半截不变提案。
  - `turnAnchors` 的「本轮」**不是死代码，是有意防御**：`anchors` 与 `cards` 同源出自一条事件流，
    所以「查不到锚点」在当前数据流下走不到；它是给 F-6（`/resume` 事件回放）预留的——回放时可能只
    重建出工具卡而丢掉 user-message。**删掉当时全绿，等 /resume 上线卡头就会空成 F-1 的原始现象。**
    已在 `cardTurnLabel` 注释里写死这条，别再当冗余清理。
  - 「未来回放跳号」同属 F-6 的前瞻边界：编号是在传进来的 `items` 内数的，`/resume` 若只回放最近 N 轮，
    编号会从 1 重数。正解是加「起始轮次偏移」入参，**现在刻意不加**——还没有任何调用方会传它，
    加一个恒默认值的参数就是第二份实现，还会诱使人以为偏移已经算对了。两处边界均已落到代码注释。
- **「切档后再批准」缺 UI 入口——已在 Plan 3 波 3 闭合**（切换器 `PermissionMenu.vue` 早已在位，缺的是卡上那颗）：
  判定全在 `utils/proposal-permission.ts`，`ProposalCard.vue` 只渲染。**判据复用主进程批准时那一份**——
  `writeVerdict` / `minimumModeFor` / `WRITABLE_TOP_DIRS` 已从 agent-runtime 提到 `contracts`
  （agent-runtime 那侧转出），所以卡上按钮指向的档主进程一定认，不会出现「按了还是被拒」的两套规则漂移。
  `blocked` 那两格（目标不在可写目录、`chapter-write` 档没选定当前章）**只摆原因不给按钮**：切档解决不了的事，
  给一颗按了没用的按钮比不给更坏（spec §2.7）。组件里不写任何档位名，连「没开书时兜哪一档」都走
  `DEFAULT_PERMISSION_MODE`（与主进程 `agent-service` 的 context 同一常量）。
- **顺带清掉的一处静默偏离（新书默认档位）**：`book-service.ts` 的 `createBook` 曾写死
  `permissionMode: "read-only"`，与 contracts 的 `DEFAULT_PERMISSION_MODE`（`full-access`，附用户裁定
  「新书默认全开」）矛盾——同一本书「刚建出来是只读、没开书时兜底却是全开」，主进程自己跟自己打架。
  该行此前**零测试覆盖**（13 条里没有一条验默认档位），已改为取常量并补断言（返回值 + 落盘的 book.json
  两处都验，防止只改内存不改盘）。这是行为变更：新建作品从只读档变为全开档。

## 2026-10-05 产品侧调整

- **专注模式（番茄钟）整条下线**（用户裁定：写作工具里没用）。
  理由不止「没用」这一条，还有两条硬的：
  ① **它是重复实现**——`useFocusModeStore` 与 `useWritingGoalStore` 各自持有一套一模一样的
     15/20/25/30 + 3/5/10 时长选择器，同屏并排出现（铁律 6 的反面）。写作目标那份带每日字数、
     连续达标天数、本周热力图，对写作工具有意义，所以保它、删专注那份。
  ② 它带着一批**从未被触发的死 CSS**：`body.focus-mode-flash` 与 `body.focus-mode-distraction-free`
     在全仓 JS 侧找不到任何加 class 的地方——「消除干扰」那个功能在代码里是画出来的，不存在。
  拆除范围（一个不落）：`FocusModePanel.vue`、`FocusModeSettingsPanel.vue`、`useFocusModeStore.ts`、
  `DocumentPane.vue` 的 import/模板/`is-focus-mode` 类、`App.vue` 的 hotkey 分支与 `focus-mode-toast` 桥、
  `hotkeys.ts` 的 `focus-mode` 面板键与 `Ctrl+Alt+F` 判定、`editor-pane.css` 的四段规则、
  `SettingsPage.vue` 的「专注模式」页签、`layoutStore` 的 `SettingsTab` 一员与 `openFocusSettings()`。
  真机复验：页面里「专注/番茄/消除干扰」字样 0 处、`[class*=focus-mode]` 0 个、设置页 8 个页签、
  `Ctrl+Alt+F` 派键后视图不变（已是死键，落 `none` 而不是 dispatch 到穷尽性守卫）。
  「消除干扰」是有用的想法，**将来若要回来，做成显式入口而不是藏在一个番茄钟里**。
- **新书默认档位从只读改为全开**：见上一节，那是执行 contracts 早已写死的用户裁定，不是这次的新决定。

## 2026-10-05 改稿历史与白屏根因

- **改稿历史与回滚已打通全链并真机通过**（报告：`2026-10-05-changes-and-boundary-report.md`）。
  `docWrite` 一直会给改前内容存备份并把句柄传回渲染层，但**全仓没有一处读得回它**——
  「AI 改坏了怎么办」此前在产品里没有答案。现在补上回程：
  `fs-store/src/changes.ts`（`listChanges`/`readChange`/`restoreChange`，三道 realpath 守卫 + 指纹闸，
  回滚本身也存备份所以「撤销撤销」还能回来）→ `contracts` 的 `ChangeEntry` + 三条 IPC 通道 →
  主进程 `changes-service` → preload → `useBookStore` 五条动作 → `ChangeHistoryPanel.vue` 浮层。
  三条不肯让步的判定：**回滚先看改前**（不摆预览不给按钮）、**指纹现读现传**（传旧的主进程那道闸就白设）、
  **回滚也留退路**。真机（CDP）证据：改坏 → 面板列出 → 预览不含那句改坏的 → 回滚后盘上与右栏都回到改前，
  且列表 +1（回滚自己也存了一份）。
- **顺带修掉两个产品可见缺陷，都是真机量出来的**：
  ① `restoreChange` 先写「已回滚」再 `reloadActive()`，而后者自己又写「已重载盘上内容」——
     **提示被覆盖，用户从头到尾看不见「已回滚」**。写源码的接线测试抓不到顺序问题，
     补了 store 层行为测试（`useBookStore.changes.test.ts` 10 条，先红后绿：修前正好红那一条）。
  ② 浮层高度由 `useComposerContextPopover` 按锚点周围空余行内给定（CSS 里的 520 被盖掉），
     面板 379px 高、溢出 132px，**「回滚」这颗主操作掉到折叠线以下 120px**。
     调 CSS 像素 futile，改成 `position: sticky; bottom: 0` 吸底，复测在折叠线上方 13px。
     顺带修同源现象：列表被 flex 压成「7 条只露 1 条」，头部补计数 chip 交代总数。
- **白屏根因不是「某文件写错一行」，是渲染层 import 了 Node 包的 barrel**：
  `DocumentPane.vue` / `ExportDialog.vue` 从 `@mochen/fs-store` 取两个纯函数，
  而 `src/index.ts` 是 `export *` 全包的 ⇒ 五个 Node 模块进浏览器 bundle，
  `changes.ts` 顶层那行 `path.join` 执行成 `undefined.join` ⇒ 首屏白屏，
  **`tsc` 与 build 全绿、构建期零线索**。此前没炸只是因为**还没有人写过那一行**。
  修法：fs-store 加显式子路径导出 `./export-service`，两处 import 改走子路径，
  产物里 `__vite_browser_external` 归 **0** 次。
- **新增门禁**：`tools/check-package-boundary.mjs` 现在也管渲染层的包边界——
  禁 import `@mochen/agent-runtime`、禁 import `@mochen/fs-store` 整包、
  子路径必须在 `exports` 声明且**传递依赖零 `node:`**。守卫先对现状报红（正是那两处）后转绿，
  变异实测：往 `export-service` 的依赖里塞一个用 `node:path` 的模块 → 两条违规 + 退出码 1，还原后逐字一致。
- **顺带修一个「为错误的理由通过」的断言**：给 `flex: none` 加断言后自跑变异**没报红**（13 条全过），
  查下去是 `ruleBlock()` 读 CSS 原文不剥注释，规则正文里那行注释把断言喂饱了。
  修的是读取器（`ruleBlock` 改为剥注释后返回，铁律 6：不另写一份剥法），修完同一条变异精确报红。
- **未做（产品决定）**：`.mochen/changes` **没有保留策略**，历次改稿全列；几百条之后浮层会变长。
  长期解法是只留最近 N 天 / M 条，本轮没拍板。

## 2026-10-05 生态扫描与分批实施

- **全网扫描已落档**：`2026-10-05-ecosystem-scan.md`。按「可吸收的开源资产 / 编程侧可借鉴机制 /
  建议加进墨宸的能力（按性价比排序）」三段写，每条注明出处。
  **证据边界**：条目来自搜索返回的页面正文与 README 摘要，**没有逐个 clone 仓库读源码**，
  协议与维护状态需落地前二次核实。
  - 最值得看的是 **zenstory-ai/oh-story-claudecode**（MIT，约 6.7k star）：13 个网文写作 skill，
    卖点是「不是提示词合集」——内置确定性 verifier、写正文前的 Reference Gate、分层上下文管理。
    其中**去 AI 味**（禁用词表 + 三遍去AI法）与**伏笔台账**（埋设/回收状态表）是墨宸最该补的两块。
  - 协议红线：novelWriter / Manuskript / bibisco 都是 **GPL-3.0，代码不可直接拷**（会传染本项目），
    可借鉴的只有机制与交互，实现必须自己写。
- **批次 1（已完成）：顶栏标题报 AI 的名字**。此前是 `${stage.name}智能体` 拼出来的「正文智能体」——
  那是**功能泛称**，不论哪枚档案在干活都这么写，看不出「现在是谁在写」。用户裁定改成档案名。
  判定下沉到 `utils/profile-options.conversationTitleLabel`（`.vue` 不进类型程序，判定写在组件里等于没钉），
  组件只读它。`utils/profile-options.ts` 此前**零单测**（顶栏、会话页 h1、输入卡 chip 三处都读它的判定），
  补 `profile-options.test.ts` 5 条。
  真机：`未选择作品` → `墨宸 · 主笔` → 切档案后 `墨宸 · 审稿`。变异实测退回旧拼法 → 1 条红。
  顺带更正两处已经过时的注释与一条失效断言（`composer-context-bar-wiring` 里
  「CenterColumn 必须用 activeStageOf」——它现在与阶段彻底脱钩）。
- **批次 2 前半（已完成）：去 AI 味检查器**。对标 oh-story-claudecode 的 `story-deslop`。
  **与左栏那三项「一致性 / 剧情 / 逻辑」的分工是硬边界**：那三项要调 AI（烧 token、要等、要联网），
  这一项是**纯本地查表**——零成本、零延迟、离线可用，所以它敢常驻在右栏头部随手点
  （`SlopPanel.vue`，锚点就是那颗 `wand` 按钮，与「改稿历史」做邻居）。
  - 判定层 `utils/ai-slop.ts`（14 条单测）：强信号 34 条（总结句、公文腔、成语堆砌、套路环境描写）
    + 弱信号 11 条（常见句式）。**分两档是刻意的**：弱信号那一档**作者完全可能是故意的**
    （网文里「缓缓地」并不罕见），报出来是提醒不是判决——面板与交给 AI 的指令里都写明了这条。
  - 词表是自己整理的**通行 AI 腔清单**，没有从任何第三方仓库抄文件。
  - 扫的是**活动文稿的当前草稿**（含未保存手改），不是盘上那份——否则用户会对着没写过的内容被指正。
  - 闭环：本地扫出问题 → 「把这份清单交给 AI 改」→ `prefillComposer` 预填逐条清单（行号 + 原词 + 原因）
    → **只预填不自动发送**，用户保留最后一道编辑权（与左栏 AI 检查同一口径）。
  - 真机：塞一段 6 处套话 + 3 处弱信号的正文 → 面板报「扫出 6 处套话，AI 味偏重」、
    首条「第 3 行 / 值得注意的是」、底部「共 9 处，每千字 81.1 处」；点主操作后面板收起、
    366 字清单落在正确线程 `chapters/01-开局.md` 的输入框里。变异实测（强信号降级成弱信号）→ 2 条红。
  - 主操作**吸底**（`position: sticky`）：面板高 380px、清单溢出 675px 时，按钮仍在折叠线上方 13px。
    这是改稿历史那次的同款教训，直接照抄。
  - 踩到一条既有门禁：`dead-css-guard` 靠静态扫类名确认每条规则都有消费者，
    所以判定 class 必须写字面量对象绑定，**不能写 `is-${level}` 模板串**——那条规则会被当成死 CSS 拦下。
- **批次 2 后半（已完成）：伏笔台账**。对标 oh-story 的 `追踪/伏笔.md`。
  起因很直白：六枚档案里「总编」的职责写着「伏笔埋设与回收」，但那只是**提示词里的一句话**，
  全仓没有一处能查「哪条埋了、埋在哪、收了没有」。长篇写到一百万字时，伏笔只能靠人脑记。
  - **形态：一条伏笔就是一篇普通文稿**（`foreshadow/` 目录下的 .md），元数据走 frontmatter：
    `status: planted|paid|dropped` + `planted:` / `paid:` 指向章节。
    刻意不新造存储——复用文稿层就自动有了左栏树、AI 可读写、搜索、备份与改稿历史。
  - 判定分两层，各有真单测：`contracts/foreshadow.ts`（状态机与 frontmatter 解析，6 条，
    住 contracts 是因为主进程与渲染层必须同一份，且渲染层进不了 fs-store）、
    `utils/foreshadow.ts`（行组装、排序、统计，16 条）。读盘在 `useBookStore.loadForeshadows`
    （`allSettled` 并发逐篇读，一篇失败不拖垮整表）。接线 14 条。
  - **一条不许猜的纪律**：只填了 `paid:` 而没写 `status:` 时，状态仍按「已埋」算。
    「回收章填了」不等于「这条伏笔收了」——作者可能只是留了个计划位置。
    宁可显示「已埋」叫作者去看一眼，也不替作者把伏笔判死（判死的伏笔会被归档，不再有人管）。
  - 异常态各有位置：状态字段写坏了 → `is-broken`（琥珀色 + 写明原值与后果），
    读不到原文 → `is-unknown`（虚线边）。**读不到的仍要列出来**——
    凭空从台账上消失的那条伏笔，恰恰是最需要被看见的那条。
  - 两个入口共用 store 那一格 `foreshadowsOpen`（右栏头部 `pin` 按钮 + 左栏「故事规划 → 伏笔台账」），
    不许组件各持一个本地布尔。点任一行 → 右栏打开那篇伏笔、台账收起。
  - 真机：造三条伏笔（含一条 `status: 已完成` 的脏数据）→ 台账报「待回收 1 / 已回收 1 /
    已弃用 0 / **状态坏了 1**」，行按 broken → pending → paid 排序，
    坏状态那行提示「状态字段不是 planted/paid/dropped，改前它按「已埋」算」；
    点行后右栏打开对应伏笔、台账收起。左栏「伏笔」分组自动出现（`pin` 图标）。
- **加一类文稿时踩到的两件事（下一类还会遇到）**：
  ① `Record<BookKind, …>` 那些穷尽表里，**只有 `.ts` 里的会被 tsc 抓到**；
     `LeftSidebar.vue` / `OutlinePanel.vue` 的 `KIND_ICON` 编译器看不见（本仓 `.vue` 不进类型程序），
     漏补的后果是树里伏笔**没有图标**且不报错。接线测试必须单独钉这一条。
  ② `SideNavChildReality` 的 action 联合、以及 `book-kinds.test.ts` 里逐字钉死的顺序与标签，
     都是「加东西必改」的点，verify 会逐条报出来——照实改，不要绕。
- **批次 3 界面组（2026-10-05 完成）**——先更正扫描台账记错的三条
  （快捷键面板、动效 token、主题三态**本来就有**，照台账开工会造第二份实现；
  详见 `2026-10-05-ecosystem-scan.md` 的更正表），再补真正的缺口：
  1. **浮层出场动效**：`styles/motion.css` 的「弹层出场」表漏了 5 个浮层
     （`.change-history` / `.ai-slop` / `.foreshadow-ledger` / `.context-meter-panel` / `.skill-browser`），
     它们弹出来是硬的。并加**推导式守卫** `components/overlay-chrome.test.ts`：
     谁用了 `useComposerContextPopover`，谁就必须在那张表里——手维护的清单注定还会漏。
  2. **toast 与浮层叠压**：`NotificationToast.vue` 的 `<style scoped>` 搬进 `styles/toast.css`，
     锚点从右上挪到**左上**（本仓浮层全从右栏锚点向右展开，右上是浮层的地盘，
     toast 钉在那儿会把浮层标题连同关闭按钮盖住——2026-10-05 真机截图），
     进出场方向也跟着从右滑改成从左滑；z-index 保持 9999。
  3. **改稿历史显示上限**：`changeListView()`（`utils/change-history.ts` + 6 条单测）——
     浮层只列最近 60 条，折叠掉多少、东西还在哪儿，明写在浮层里。
     **只截列、不删盘**：`.mochen/changes` 的备份是回滚的最后一道保险，删它不可逆，
     那属于产品决定不是界面问题，所以这轮没做淘汰策略（台账仍挂着）。
  4. **死 CSS 守卫补推导**：`.toast-*` 与 `is-${level}` 都是运行期生成的类名，静态扫不到，
     搬进 `styles/` 后被判成死 CSS（实际红了一次）。改成从 `NotificationLevel` 与
     `<transition name>` 现场推导；并加一条「推导不是空转」的正反钉。
- **批次 3 真机证据（CDP 驱动真 store，2026-10-05）**：
  - `.toast-stack` 实测 `left: 16px / top: 16px / z-index: 9999`，`cssRight` 读出 1424px
    —— 即 `right` 根本没参与定位；截图里改稿历史浮层的标题与关闭按钮**不再被盖住**。
  - `.change-history` 与 `.foreshadow-ledger` 的 `animationName` 都读回 `mochen-pop-in`，
    `0.17s` + `cubic-bezier(0.22, 1, 0.36, 1)`；挂上 `html[data-reduced-motion="true"]` 后
    时长塌到 `1e-05s`（总闸仍然管得住）。
  - 往验收书铺 70 条改稿备份后：store 拿到 86 条，浮层**只列 60 行**，
    头部计数读回「86 次改动」（报的是总数不是行数），折叠行读回
    「更早的 26 条没删，还躺在 .mochen/changes 里；这里只列最近 60 条。」
  - 变异实测 5 条全红（动效表摘项 / toast 挪回右上 / 进场方向忘改 / 计数改回行数 /
    折叠说明谎称「已清理」）；死 CSS 守卫的推导摘掉后确实报警（不是永动机）。
- **验收残留**：`.mochen-tmp/p2/seed-changes.mjs` 在验收书（%TEMP%）里铺了 70 条备份，
    留着方便复验；重跑批次 3 前记得它是 86 条不是 70 条。
- **批次 3 尾巴：中栏骨架屏与空态**——做这一项时撞出一个**远严重的先存 bug**：
  右栏正文**一直就没显示过**。`.editor-pane` 写的是 5 行 `50/42/40/1fr/36`，
  可实际子元素有 6 个（页头、标签条、工具条、查找替换条、**编辑/分栏/预览条**、文档、页脚），
  第 4 根 `1fr` 被那条透明盒子占去、撑满 707px——**屏幕上那片"空着的正文区"其实是它**；
  真正的 `.editor-document` 落到 36px 那行塌成 46px，textarea 被顶到 y=948，
  而视口只有 902px ⇒ 被 `overflow: hidden` 裁掉。
  静态扫不出来（每条规则都有"消费者"），前几批的真机验收又全在看浮层，所以一直没暴露。
  修法：行模板补两根 `auto` 容下条件条，文档与页脚**写死行号**不再顺推；
  作品资料页另有一套（少两根条）。真机复测：`.editor-document` 46px → **705px**，
  textarea 705px、`编辑/分栏/预览` 707px → 29px，正文「第一章 / 雾从海面涌上来…」显示出来了。
  - 顺带修的三个真问题（都是做骨架时读代码读出来的）：
    ① **新标题配旧正文**：`activeDocTab` 先换、`draft` 后换，中间那段中栏摆的是上一篇的稿子，
       用户一打字就把上一篇写进这一篇（自动保存照单全收）。加 `docLoading` 在途标志，
       在途时摆骨架、**不摆正文**。
    ② **切标签竞态**：连点两个标签，慢的那次读回来会**永久**盖掉后一次的结果。
       加模块级 `docLoadToken` 世代号，读回来先对令牌；换书也作废上一本的在途读
       （否则那一次会把上一本的正文写进这一本）。
    ③ **读失败留旧正文**且静默抛出。现在清空正文 + notice 说清哪一篇没打开。
  - 判定与话术住 `utils/editor-readout.ts`（骨架/空态/正文三格 + 标签书名号归一），
    行为在 `stores/useBookStore.doc-loading.test.ts`（6 条，挂起 promise 控快慢），
    接线在 `components/document-pane-readout-wiring.test.ts`（19 条）。
  - **教训（这轮最贵的一条）**：真机跑的是 `out/renderer` **产物**不是源码——
    改完 CSS 不 `pnpm build` 就重启，看到的还是旧样式，白查一轮。
    另外 CDP 验「挂载了没」不够，必须量**几何**（`getBoundingClientRect` + `elementFromPoint` 命中测试）：
    `.editor-empty` 曾经 DOM 里挂着、文字读得到、屏幕上什么都没有，被 grid 行 + overflow 裁掉了。
- **批次 4-①：Plan 阶段（2026-10-05 完成）**——对标 Cline 的 Plan/Act，输入区右端那枚 chip
  是真开关（`active: plan`、无 caret、全开档左侧、无书时 disabled），落盘在 `book.json` 的 `meta.workMode`。
  - **架构上最关键的一条：做成 `writeVerdict` 的第六种判决 `{ kind: "plan-mode" }`，不另开第四个闸。**
    写闸的真身本来就是 `contracts/permission.ts` 的 `writeVerdict`（主进程批准提案、工具宿主放行
    `write_doc`、渲染层提案卡提示，三处共用）。另开一个闸就是第二个真身，迟早出现
    「主进程放行了、卡上还在劝你切档」。判决里加一个分支是唯一的加法。
  - **plan 判决排在所有档位判据之前**：它比权限档更硬。先报「切到只读档就能批」，
    用户切完发现还是被拒——按了没用的按钮比不给更坏（spec §2.7）。拒绝理由同时带下一步。
  - **光加闸不够，提示词也得改**：闸只在模型已经想动手时拦得住，**而模型看不到闸**。
    不先告诉它，它会照常起草 → 吃拒 → 换写法重试几轮，白烧 token。
    `agent-service` 的 `defaultPromptFor` 在 plan 档追加 `PLAN_MODE_INSTRUCTION`，
    要求只讲打算（改哪几篇、每篇改什么、为什么），编号列出。
  - `workMode` **必填无默认**（同 `startTurnInputSchema` 两枚每轮开关的同一条理由）：
    少传就悄悄按「直接动手」发出去，真机上「闸坏了」与「用户没开计划」分不开。
    老书兜底只住在 `workModeOf(meta)` 一处。
  - 提案卡新增**独立的 `switch-work-mode` 分支，不复用 `switch`**：那颗按钮点的不是同一个开关，
    复用会被装配处接到权限档菜单上。
  - **顺带修掉一处重复**：`useBookStore` 的 `persistMeta(patch, failPrefix)` 抽成唯一落盘通路
    （toRaw → `metaSaving` → `saveMeta` → 失败不改 → 先写后回读），
    `setPermissionMode` / `setWorkMode` / `setActiveStage` / `setActiveProfile` 四个切档动作全改调它。
    原本抄了四份，既把文件顶到 833 行超 800 预算，又各自漂移。**维护时优先修重复而不是加注释。**
    现在该文件 800 行整、预算已满。
  - 测试：contracts 9 条（先红后绿）+ 提示词 3 条 + 接线 15 条。
    **接线测试当场抓到一个真 bug**：`CenterColumn.vue` 用了 `workModeOf` 却没 import——
    `.vue` 不进 tsc，编译器不报，运行时才炸。
  - 变异实测 7 条全红（撤闸 / 判决顺序倒过来 / 模型侧文案吞分支 / 卡上指成切档 /
    提示词不注入 / chip 从渲染列表掉出 / 提案卡按钮误接 `setPermissionMode`）。
  - 真机（CDP 驱动真 store）：老书 `metaWorkMode: null` 时 chip 显示「直接动手」`aria-pressed="false"`；
    `toggleWorkMode()` 后 `metaWorkMode: "plan"`、chip 变「先计划」`aria-pressed="true"`、
    notice 读回「工作模式已切到「先计划」：它只讲打算，提案批了也不落盘。」，
    **盘上 `book.json` 读回 `workMode: "plan"`**；再切回来盘上 `workMode: "act"`，往返干净。
  - **如实记一条未做**：提案卡那枚「切到直接动手」按钮**没在真机上点过**——
    它需要一条 pending 提案才能触发，本机 API 停在 mock、桩已停，没有现成的提案卡。
    判定层与跨判定交叉验证（「切完真的能批」）单测覆盖充分，但按钮本身欠一次真屏幕点击。
- **批次 4-②：审稿升级为多视角打分（2026-10-05 完成）**——右栏头部新增「审稿打分」浮层
  （`.mochen-tmp/p2/shot-batch4-2-panel.png`）。
  - **先定的是「边界」不是「功能」**：左栏那三项要调模型（烧 token、要等、还得联网），
    所以至今只预填一句提问；这一项**不调模型**，四个维度的分数都是从正文数出来的。
    沿用去 AI 味那条硬边界（`ai-slop.ts` 的注释里也写了）。
  - **四个维度：句长 / 段落节奏 / 对白占比 / 套话密度**（`utils/review-score.ts`，39 条单测）。
    套话那一项**复用去 AI 味那份查表**，不另写一份词表（铁律 6）。
  - **分数的语义写死在代码注释里**：它量的是「写法有多常规」，**不是质量分**；
    60 是中性基准、**不是及格线**。分数条上画一道 60 的刻度，就是防着用户把它读成「还差 60 分及格」。
    文案层不许出现「合格 / 通过」——有测试专门钉这条。
  - **诚实边界：算不出的那两项明写**。剧情是否成立、人物是否一致——本地数不了，
    就在浮层底部单列一块虚线框写「下面这几项本地给不出分」+ 每项为什么。
    **不假装给 0 分**（混进分数条里会被读成打了 0 分）。
  - 交读数给 AI 那一步**只预填不自动发送**（与左栏检查、去 AI 味同一条口径），
    且给的指令明确写「请你不要给分数」——本地给的是读数，AI 该给的是「是哪几句」。
  - **真机撞出两个缺陷，都不是静态能看出来的**：
    ① **分数与话术唱反调**：验收书那段正文里「段落节奏」54 分标着「明显偏出」，
       hint 却说「段落切得还算清爽」——`hint` 与 `scoreParagraph` 各判一次判据就分叉了。
       修法是把话术抽成 `paragraphHint()` **跟着分数那一支的判据走**（判据不许写两遍），
       并补了一条钉「分数不在常规档时 hint 不许说清爽」的单测。
    ② **主操作压住内容**：最初是「整个浮层 `overflow-y: auto` + 按钮 `position: sticky`」，
       真机截图里 sticky 按钮浮在列表**中间**，把「对白 / 套话」两个维度和「算不出那两项」
       全压在下面看不见。**sticky 只保证自己不滚出视口，不保证它不压内容。**
       改成三段式（头固定 / `.review-score-body` 自己滚 / 按钮在滚动区外），按钮不再 sticky。
       - 顺带记一条量法教训：第一版真机断言写的是「按钮在浮层内」，
         改结构后**照样返回 true**，因为它量的是几何相交，而滚动区里的列表必然与下方按钮相交。
         改成量**可视区内**的重叠 + 滚到底后逐项验「可见且没被压」。
  - 变异实测 **12 条全红**（扣分符号写反 / 省略号连写被当两句 / 标点算进字数 / 对白系数调软 /
    综合分改成常数 / 去掉「算不出」那块 / 摘掉免责说明 / 摘掉 60 刻度 / 扫盘上那份 / 自动发送 /
    入口掉出右栏 / 新浮层没挂进动效表）。
    死 CSS 守卫还抓到一次 `.review-score-fineprint`（重构时模板删了、CSS 规则留着）——
    那条小字最后放回滚动体内，而不是把守卫豁免掉。
  - 真机（CDP 驱动真 store）：浮层 320×380 可见、`elementFromPoint` 命中、
    `animationName` 读回 `mochen-pop-in`；**分数双向都验了**——
    套话稿综合 50（套话维度 20 分 + 琥珀条 +「明显偏出」），
    干净短稿综合 62 且套话项回到 100（证明不是单向只会变低）；
    滚到底「算不出的那两项」与最后一个维度都可见且都没被按钮压住。
- **批次 5-①：时间线一致性检查（2026-10-05 完成）**——扫描台账第 3 项。
  此前左栏「时间线」只是个文档树入口，**全仓没有一处能查「哪件事在什么时候」对不对得上**。
  - **一条时间线就是一篇普通文稿**（`timeline/` 下的 .md），日期走 frontmatter `date: YYYY-MM-DD`。
    刻意不新造存储——复用文稿层就自动有了左栏树、AI 可读写、搜索、备份与改稿历史。
  - 判定层 `packages/contracts/timeline-check.ts`（**34 条单测，住 contracts 是因为主进程要扫盘、
    渲染层要显示，两侧必须同一份**），只报**算术上确凿**的三类：
    ① `unreadable` 日期字段写坏（显式报 + 回显原值，**绝不悄悄跳过**——凭空从台账上消失的那条
    恰恰是最该被看见的，与伏笔台账同一条纪律）；② `unsorted` 两篇先后写反；
    ③ `gap` 正文说「三天后」而日期只隔两天。
  - **「查不出的」明写**：谁该不该在场、事件该不该发生——那是判断不是算术，
    浮层底部虚线框单列（`TIMELINE_BLIND_SPOT`）。与批次 4-② 审稿打分同一条纪律。
  - **「日期写坏」与「没写日期」是两回事**：前者琥珀实边 + 报问题，后者虚线弱化 + 只说「未排期」。
    把「还没排期」当成错，作者会为了消警告去乱填日期。
  - 读盘与状态在**新 store `useTimelineStore`**：`useBookStore` 已 750 行（预算 800），
    塞进去必超；更重要的是职责不同——它扫的是**全书** timeline，不随当前标签变。
  - **日期算术三条不许将就的**：2 月 30 日不是「3 月 2 日的前一天」（`dayOfYear` 先过真日期校验，
    否则会凭空造出一条不存在的矛盾）；跨年/闰年要算得出来；**任一认不出就回 `null`——
    绝不给 0**（0 会被当成「同一天」去判矛盾）。
  - **真机撞出一个真 bug 并已修**：`checkTimeline` 原先对相邻两篇的 `[to, from]` **两边都试**，
    于是中间那篇既当下篇被比（对）、又当下一篇的 `from` 再比一次（错）——
    「抵达」的「三天后」被拿去和「安居」比，硬报出一条「只隔 2 天」之外的假矛盾，
    而且同一篇在一条问题里被列了两次。改成**只看当前篇、只跟紧邻的上一篇比**，
    补了回归钉（「中间篇只跟紧邻的上一篇比，不被复用两次」）+ 一条变异。
  - 变异实测 **16 条全红**（日期不验真实性 / 跨年不算 / 中间篇被复用 / 容差放宽到 1 天 /
    坏日期悄悄跳过 / 「若干天后」当 0 天 / 带 /g 的正则复用 / 只查当前篇 / 读失败留半截数据 /
    失败提示不显示 / 摘掉盲区块 / 「未排期」说成「有问题」/ 入口掉出 / 两入口不共用一格 /
    浮层没挂动效表 / 两种行样式混成一个）。
  - 真机（CDP 驱动真 store，铺 5 条含真矛盾/坏日期/未排期的数据）：
    浮层 320×380 可见、`elementFromPoint` 命中、`animationName` 读回 `mochen-pop-in`；
    头部「5 条 · 2 处要核」、结论分三类报数；坏日期行 `isUnknown`、未排期行 `isUndated` 分开；
    问题牵涉的文稿是可点的胶囊；左栏时间线分组自动出现五篇。
- **批次 5-②：Ollama 本地模型 + 卷纲→章纲结构化 + EPUB 导出（2026-10-05 完成）**——扫描台账第 5-7 项。
  同一批里出了**四个真机缺陷**，其中两个是「不改就等于没交付」级别的，全部已修并各留回归钉。

  **① 本地模型（Ollama / LM Studio 一类 OpenAI 兼容端点）**
  - **真问题从来不是「能不能连」**：`provider-client.ts:143` 早已支持空密钥（注释里明写
    「方便本地 Ollama/LM Studio」），技术早就通——卡在 UI 必填。
  - **密钥语义是这事的全部**：`null` = 沿用、`""` = 明确清空，两者不区分就没法在切到本机端点时
    把云端 key 从钥匙串里抹掉。`keyTouched` 是区分这两者的唯一入口，`saveConnection` 据此
    决定是调 `credentials.clear()` 还是原样留着。
  - `ModelProfileDialog` 加了「一键填本机端点」：填地址 + 清密钥 + 立刻拉一次模型名单。
  - **诚实边界：本机没装 Ollama（127.0.0.1:11434 连不上），这批验不到真机。**
    `apps/desktop/src/main/ollama-local-provider.test.ts` 起的是一个**会拒绝一切 Authorization 头**
    的假端点，证的是「空密钥这条路通 + 云端 key 真被清掉」，**证不了「连上了一台真 Ollama 写稿」**。
    文件头注释里写着这条边界，不许日后把它当真机证据引用。

  **② 卷纲 → 章纲结构化**（扫描台账第 6 项，依据雪花法 / yWriter 的场景级字段）
  - 判定层 `packages/contracts/volume-outline.ts`（**46 条单测**）。认章只有两条规则：
    二/三级标题、独立成行的「第N章」；字段六项（视角/目标/冲突/转折/钩子/字数）走**别名表**归一
    （阻力=冲突、尾钩=钩子、目标字数=字数），值一个字都不改写。
  - **缺就是缺**：`missing` 是派生的（读 `fields` 就能重算，不另存一份），
    面板逐项照实列出，**不替作者补写**。同一个字段写两遍时后写的盖前面的，
    被盖掉的那一句原样留在 body 里标「已作废」——「说了两遍不同的话」得人来判。
  - **往返一致是硬要求**：生成的章纲与卷纲同一种形状（`## 标题` + `- 标签：值`），
    所以 `parseVolumeOutline(buildChapterOutlineMarkdown(...))` 读回来就是原来那几个字段。
    头一回写成了 `#` 一级标题，往返当场断掉，被那条单测抓住。
  - **生成只写卷纲里真写了的字段**：写 `- 冲突：`（空值）会被下一次解析读成「写了空」，
    写 `（待补）` 更糟——它会让作者以为这一项已经有人想过。缺的那几项由面板报，不落进文件。
  - **「一个字段都没写的节」标成 loose**：多半是分组标题（如 `## 人物线`）而不是一章。
    面板如实标出并**禁用**它的生成按钮，但**由作者定**——工具不替作者决定「这是一章」。
  - 读盘与状态在新 store `useVolumeOutlineStore`（与 `useTimelineStore` 同款理由）。
    路径一律问 contracts 的 `planDocRelPath`——在组件里另写一份文件名清洗是铁律 6 的破口。

  **③ EPUB 导出**
  - 契约搬进 `packages/contracts/src/export.ts`（跨层契约；`preload` 只做字面转发不校验形状）。
  - **「跑字节的」住主进程**：EPUB 要 `node:zlib`，渲染层 import 那条链会把 Node 模块打进
    浏览器 bundle ⇒ 首屏白屏（与批次 3 撞过的**同一个根因**）。所以新增 `file:build-export`，
    渲染层只留零 Node 依赖的纯函数（`@mochen/fs-store/export-shared`）。
    变异实测里前两条就是这条回归线：**把 import 改回 `export-service`、
    或给 `export-shared` 加一行 `node:zlib`，tsc 与 build 都是绿的，只有这条钉子会红。**
  - **不引 zip 依赖**：Node 24 自带 `zlib.deflateRawSync` 与 `zlib.crc32`，
    手写最小 zip 写入器（`packages/fs-store/src/zip.ts`）。测试用 `inflateRawSync`
    **按中央目录逐条真解一遍**——自己写 zip 最容易出的错就是偏移量算错，而那种错在自己这边是自洽的。
  - EPUB 硬要求写进 `buildZip` 参数、**不给关掉的口子**：`mimetype` 必须是第一条、不压缩、内容恰 20 字节。
    同时给 `toc.ncx`（EPUB 2）与 `nav.xhtml`（EPUB 3）——2026 年仍有很多阅读器对 EPUB 2 目录支持更好。
    unique-identifier 用书名+篇数生成稳定值（不用时间戳，免得同一本书两次导出得到两个 id）；
    **作者留空时不写 `dc:creator`**——写「佚名」是替用户编事实。
  - EPUB **只收章节**：人物卡/设定/伏笔进电子书没阅读价值且目录全是碎片。
    零章时 `buildEpub` 回 `null`，UI 给一句中文而不是给一个空壳文件。
    复制按钮对 EPUB 挡住——二进制包没有文本预览可复制，复制空串会让用户以为功能坏了。

  **④ 真机撞出的四个缺陷（静态分析全绿的那一类）**
  - **(a) 导出对话框从来没有入口**：App.vue 持一个 `exportOpen = ref(false)`，全仓**没有任何一处**
    把它置 true；而 `layoutStore.panelVisibility.export` 与 `openExport()` 一个写者都没有——
    两份状态、零个写者，整个导出功能（含本批的 EPUB）**从来没打开过**。
    修法按铁律 6：App 删掉本地那份，只认 store 那一格；入口补在右栏头部（导出是整本书的事）。
  - **(b) `buildExport` 收到的是 Vue 反应式代理**：Electron 在 IPC send 端做结构化克隆，
    代理当场抛 `An object could not be cloned.` ⇒ 真机上选 EPUB 直接组装失败。
    修法 `toRaw(...)`，口径与 `useBookStore.saveMeta` 里那处一模一样。已加回归钉。
  - **(c) 生成章纲后渲染层 `book.docs` 不同步**：主进程更新了它自己的快照，渲染层没重扫，
    面板上那枚「已有同名大纲」要等下次开书才变——作者会连点第二次然后撞上拒绝。
    修法 `book.refreshDocs()`（只扫 docs 与 meta，不动标签与草稿）。
  - **(d) 卷纲面板的滚动区被挤没了**：真机截图里列表只剩 **40px** 高（窗口 CSS 高约 475px），
    说明文案 + 总结 + 盲区块把 `flex: 1 1 auto` 的滚动区吃干。**「能滚」不等于「看得见」。**
    修法：盲区块挪进滚动区（它是说明文字、里面没有按钮）+ 滚动区给 `min-height: 150px` 下限。
    复测 40px → **207px**。
  - 变异实测：EPUB 侧 **16 条全红**、卷纲侧 **21 条全红**（含上面 (b)(c)(d) 三条各自的回归钉）。
  - 真机（CDP 驱动真 store，真书目录）：
    导出对话框 560×531 可见、7 种格式、EPUB 那一颗可点且 `assembleError` 为空；
    组装出的 zip **2491 字节、按中央目录真解出 7 个条目**，`mimetype` 第一条 / 不压缩 / 恰 20 字节，
    `nav.xhtml` 与 `toc.ncx` 都在，`content.opf` 带书名；`bytes` 是 `Uint8Array` 不是 `Buffer`，
    零章返回 `bytes: null` 而非空壳。
    卷纲面板 320×380 可见、`elementFromPoint` 命中、`animationName` 读回 `mochen-pop-in`；
    认出 4 章、其中 1 节 loose 且生成按钮禁用；结论「目标字数合计 6,000（另有 1 章写了数字但没读出来，不计入）」；
    点「生成章纲」落盘成功、再点同名的那一枚自动变「已有同名大纲」并禁用。
    **未验的一环（如实记）**：`dialog.showSaveDialog` 是 Electron 原生模态框，CDP 点不到，
    所以「弹窗选路径 → 写盘」这一段本轮没验；验到的是「组装出的字节是对的」。

  **⑤ 一条语义错，是读数读出来的**：`summedWordTarget` 原先把「没写字数」的章也算成
  「写了数字但没读出来」——面板于是替作者说一句他没说过的话。改成三档：
  读得出 / **写了读不出** / 没写（没写的那几章两档都不进，它们已由 `missing` 如实报出来了）。
- **批次 5-③：字数面板可达 + 主题旧别名层（2026-10-06 完成）**——批次 5-② 遗留的那件。
  用户 2026-10-05 裁定「全都做」，5-② 收尾时报了「笔记面板与字数面板同样够不着」。
  **先更正一处自己的错**：笔记面板**是够得着的**——`panelShortcut` 里有 `case "notes"`，
  走键盘快捷键开合，有真写者。真正死的只有字数面板。
  这一轮又撞出**三个**静态分析看不见的缺陷，都已修并留了推导式守卫。

  **① 字数面板从来没打开过**
  - App.vue 持一个从不被置 true 的 `wordCountOpen`，而 `layoutStore.openWordCount()` 零调用方。
    与批次 5-② 的 `exportOpen` **同一个模子**：两份状态、零个写者。
  - 修法按铁律 6：App 删掉本地那份，只认 store 那一格；入口补在右栏头部（`ledger` 图标）。
  - **守卫是推导式的**（`components/dead-panel-entry.test.ts`）：扫 App 模板里每个 `:visible="…"`
    并分类判它有没有写者——本地 ref 要有 `xxx.value =` 赋值；`layout.panelVisibility.X` 要有
    open/toggle 动作**且那个动作在别处真的被调过**（有 API 无调用方同样算死）。
    还带一条**反向钉**：「别顺手把 notes/search 也改成 store 那一格」——
    `panelShortcut` 里的 case 就是它们的写者，「统一风格」搬走会让快捷键失效而 tsc 完全不报。

  **② 面板可达之后，字数永远是 0**（最难自己发现的一类）
  - `WordCountPanel` 读的是 `c.content`，而 `DocRef` **只有 `excerpt` / `chars` / `relPath` /
    `kind` / `title`，没有 `content`**。于是每章算成 0 字、全书总正文永远是「0 字」——
    **不报错、不空、只是数字永远错**。面板以前够不着，谁也没看见它一直显示 0。
  - `scan` 那一趟已经把每篇正文字数算好带出来了（`chars`，口径与 `proseCharCount` 的非空白码点一致），
    改成读它，顺带省掉每篇一次 readFile。真机复测：总正文 **0 字 → 27 字**。
  - 全仓只有这一处踩 `DocRef.content`；`ExportDialog` / `SearchPanel` 读的是 `loaded.content`（对的）。

  **③ 约 250 处样式的 CSS 变量全仓从未定义**
  - `--surface` / `--surface-dim` / `--dropdown-bg` / `--border` / `--border-light` /
    `--text-muted` / `--text-dim` / `--line-strong` / `--warn` / `--ok` / `--hover-bg` /
    `--border-hover` / `--bg-secondary` —— **13 个名字，被 250 余处消费，从来没被定义过**，
    各自带着硬编码兜底值，于是主题换了它们不换：
    - 浅色主题下 `--dropdown-bg: #1e1e2a`（深）配 `--text-primary`（跟主题，浅色下是深字）
      ⇒ **深字压深底**：字数 / 导出 / 搜索 / 笔记 / 版本历史 / 模板 / 新手引导 / 切书 /
      写作目标 / toast 十处一起中招。真机截图里「字数统计」标题几乎看不见。
    - 暗色主题下 `--surface: #fff` ⇒ 去 AI 味 / 审稿 / 时间线 / 伏笔 / 卷纲 / 改稿历史
      六个已验收的浮层**浅底浅字**。
    - `--border*` 的兜底是半透明白 ⇒ 浅色主题下描边隐形。
    - `WritingGoalSettingsPanel` 的 `background: var(--bg-secondary)` 是**裸用无兜底**，
      变量没定义时整条声明在计算值阶段作废 ⇒ 那块背景压根没画。
  - **修法是在 `appearanceThemeRuntime` 一处把 13 个别名定义出来**，每条都指向**已存在的**
    语义 token，不新造颜色；不逐个去改那 250 处（那是 11 个文件，且下一个面板还会重犯）。
  - **守卫**（`composables/theme-token-guard.test.ts`）：消费了却没定义的变量一律报出来。
    白名单分三类且**每条都要写理由**（确定性常量 / JS 内联注入）——没有理由的白名单
    半年后没人敢删，白名单自己就成了下一个真相源。另有一条钉「别名的目标自己也得有定义」，
    防 `setProperty("--x", "var(--不存在的)")` 这一手。
  - 真机双主题读**计算值**（不是读 CSS 源）：浅色 `--dropdown-bg: #FFFFFF`、
    面板底 `rgb(255,255,255)`、标题字 `rgb(26,28,31)`，对比度 **0.89**；
    暗色 `--dropdown-bg: #17191C`、底 `rgb(23,25,28)`、字 `rgb(243,244,246)`，对比度 **0.86**。
    修之前浅色那一组是「底 `rgb(30,30,42)` + 字 `rgb(26,28,31)`」——亮度差 0.02，几乎全黑。

  - 变异实测：死面板守卫 **6 条全红**（含把两个原 bug 原样注入回去）、
    主题守卫 **8 条全红**（含「别名指向不存在的 token」与「`--warn`/`--ok` 指错语义色」）。

  **另记一条与本轮无关的既有缺陷**：`appearance:save` 这条 IPC 在本机
  调用即失败（`useAppearanceStore.update` 返回 `false`、界面弹回原样并给出
  「外观设置没有保存成功」），也就是**用户改外观主题存不下来**。
  本轮验暗色主题是直接改 store state（`watch(settings, applyTheme, {deep:true})` 照样触发）
  绕过去的，没往盘上写。
  → **已在批次 5-④ 修掉**：根因是 `{ ...this.settings, ...patch }` 只解顶层，嵌套的
  `light` / `dark` 仍是响应式代理，Electron 克隆当场抛 `An object could not be cloned.`。
  那一批还顺带推翻了本项目此前的变异结论（详见批次 5-④）。
- **批次 5-④：`appearance:save` 存不下来 —— 以及四个变异脚本「全红」全是假的（2026-10-06 完成）**

  这批的起因是批次 5-③ 末尾如实记下的那条既有缺陷：**用户改任何外观设置都存不下来**。
  查下来的根因只有一行：

      const next: AppearanceSettings = { ...this.settings, ...patch };

  **浅展开只解开顶层**。`this.settings` 是响应式对象，展开出来的 `next.mode` 是原始字符串，
  但 `next.light` / `next.dark` **仍然是 Vue 代理**；Electron 在 IPC 的 send 端做结构化克隆，
  代理当场抛 `An object could not be cloned.` ⇒ 每次保存都失败，界面弹回原样。
  修法是 `{ ...toRaw(this.settings), ...patch }`——`toRaw` 返回 raw target，嵌套值本来就是 raw 的，
  一次解整棵树。这与批次 5-② 那个 EPUB `buildExport(toRaw(...))`、`useBookStore.saveMeta`
  是同一条口径，**同一个陷阱的第三处**。

  为什么 tsc / eslint / vitest 三关全绿：死掉的不是语法，是「那个值是代理」。
  与批次 5-② 的 `toRaw` 教训同源，所以这次直接把它当**族群**处理：
  新写 `.mochen-tmp/p2/proxy-ipc-scan.mjs` 扫「浅展开 Pinia state 后过 IPC」这一族，**结果只有这一处**，族群收口。

  **守卫：mock 必须复刻 bridge 的真实行为。** 原来的 `useAppearanceStore.test.ts` 抓不到它，
  因为 mock 是个空转函数——不碰实参，自然不会炸。新的 `describe` 让 mock **对着实参做
  `structuredClone`**（与 Electron 同一个 DataCloneError），再加一条**鉴别力凭据**：
  「浅展开出来的那份过不去，`toRaw` 过的过得去」——证明前两条不是空转。
  变异实测 **4 条全部符合预期**：还原成浅展开 / 嵌套用 `this.settings` 回填 ⇒ 报红；
  换成 JSON 深拷贝（性质照样成立）/ 抽掉 mock 里的 `structuredClone` ⇒ 不报红。

  **这一批真正的大头：四个历史变异脚本的「N 条全红」全是假信号。**
  起因是我照着旧脚本写新的，习惯性用了
  `execFileSync("corepack", ["pnpm", "vitest", "run", …])`。**它在 Node 侧压根起不来**——
  `corepack` 是 PowerShell 里的 shim，磁盘上没有同名可执行文件，`spawnSync` 直接 `ENOENT`；
  换成 `corepack.cmd` 又是 `EINVAL`。而脚本里那个 `try { execFileSync } catch { return { red: true } }`
  于是把「进程没启动」**一律读成「测试红了」**。也就是说批次 5-②、5-③ 报的那些
  「epub 16 条全红 / outline 21 条全红 / 死面板 6 条全红 / 主题 8 条全红」，
  **一条都没真的跑过测试**。

  两条纪律就此立下，并写进了 `.mochen-tmp/p2/patch-mutation-launcher.mjs` 注入的 shim 里：
  ① 测试进程**起不来就 `process.exit(2)` 直接退出**，不给「没跑」冒充「全红」的机会；
  ② **每轮先跑基线**——未变异时必须全绿，基线不绿就说明测试本身有问题，后面的红绿都没有意义。

  按真能判红的方式重跑四个脚本，真相是：

  | 批次 | 原报的 | 真跑 | 说明 |
  | --- | --- | --- | --- |
  | 5-② EPUB | 16 条全红 | **16 条全红** | 结论成立 |
  | 5-② 卷纲 | 21 条全红 | **20 红 3 绿** | 三个缺口（见下） |
  | 5-③ 死面板 | 6 条全红 | **5 红 1 绿** | 一个缺口（见下） |
  | 5-③ 主题 | 8 条全红 | **7 红 1 绿** | 一个缺口（见下） |

  **四个真缺口，逐个补掉**（守卫声称覆盖却没覆盖，比没有守卫更坏——它会让人以为这块有人看着）：

  1. **主题守卫的正则太窄**（`theme-token-guard.test.ts`）。`(--[a-z-]+)` 不认大写、数字、
     下划线，而**中文变量名在 CSS 里是合法的**。变异里把某个别名写成
     `var(--根本不存在的那个)`，窄正则压根没匹配到，守卫一声不吭。已把五处正则放宽到
     CSS 自定义属性名的真实语法（`--[^\s:;"']+` 之类）；放宽后仓库现有变量名全绿，
     说明此前 `[a-z-]` 恰好覆盖了现状，但守卫从此不会对未来的名字失明。现在 **8 条全红**。
  2. **loose 节的生成按钮**（`volume-outline-wiring.test.ts`）。原断言只查「模板里出现过
     `chapter.isLoose`」，而 `v-if="chapter.isLoose"` 的那句提示文案就把它喂饱了——
     把它从 `:disabled` 里删掉，面板照常标出 loose 节却让作者一键生成。已加
     `utils/vue-source-reader.ts` 的 `tagAttributes()`（按标签切开取属性块，切标签时跳过引号内的 `>`），
     断言 `outline-generate` 那个按钮的 `:disabled` 里真的有它。
  3. **面板「有写者」不等于「用户够得着」**（`dead-panel-entry.test.ts`）。上面两条守住的是
     「`panelVisibility.X` 有人置 true」，但把**入口按钮从右栏头部摘掉**，写者还在、
     守卫全绿，而面板从此在界面上消失。新增一层：每个走 store 的面板，必须在某个模板里
     真的绑到了它的开启动作，或在 `PanelShortcutId` 里（键盘也算入口）。
     写第一版时踩了个坑：正则用 `open\b` 收尾，而 `.` 后没有词边界，`layout.openWordCount()`
     里的 `open` 紧跟着 `W`，一个都匹配不上，当场把两枚按钮全判成死面板——按完整方法名匹配才对。
  4. **卷纲 store 的行为零覆盖**（新增 `useVolumeOutlineStore.test.ts`，**13 条真单测**）。
     store 是 `.ts`，进类型程序也进 vitest，本该有单测；原先只有接线测试，而它声称覆盖的
     三条行为全是空转——把 `toggleFor` 的「同一篇」判掉、把 `generateChapter` 的失败路静默、
     放开 loose 节的按钮，接线测试照样全绿。新单测覆盖：同一篇第二次是**关**且不重读盘、
     换一篇才重读、读盘失败要说话、生成的五条失败路（标题起不了文件名 / 已有同名 / 建文件失败 /
     stale / 抛异常）**每条都要说人话且不碰盘**、成功路要建→写→**重扫**且用 createDoc 回传的指纹、
     在途标记飞起来与收干净。现在 **23 条全红**。

  顺带发现并改掉一条**假变异**：`dead-panel-mutation.mjs` 里那条「把入口按钮从右栏头部摘掉」，
  实际只是把 `@click` 后面加了个注释——按钮还在、照样能点，守卫不报是**对的**。
  变异脚本自己写错了却归咎守卫是装饰，这比守卫漏网更容易骗人。已改成三条真变异：
  「@click 改成什么都不调」「字数那颗整块删掉」「导出那颗整块删掉」，现在 **8 条全红**。

  **真机证据（2026-10-06）**：改设置 → 读盘 → **重启 Electron** → 再读。
  这是「存下来了」唯一说得清的验法——「重启后还在」这一段以前从来没跑过，
  因为盘上那份 `appearance.json` 是诊断时 bridge 直调写进去的，不是走 UI 存下来的。
  ① 改**嵌套字段**（`dark.accent` `#5EACFF` → `#D4B45A`、`dark.preset` `codex` → `mochen-qingjin`）：
  `update` 返回 `true`、`store.error` 为 `null`、无 console 报错，盘上那份同步变了；
  ② **杀掉进程重启**，再读：`persisted: true`，store 读回的 `accent`/`preset` 与盘上一致；
  ③ 主题**真应用到了 DOM**：`data-theme="dark"`、`--accent: #D4B45A`、
  `--dropdown-bg` 与 `--surface` 都是 `#17191C`、body 底 `rgb(23,25,28)` 配字 `rgb(243,244,246)`。
  （改嵌套字段是必须的：顶层 `mode` 是原始字符串，恰恰是旧写法里唯一没事的那一半，改它验不出这个 bug。）

  门禁：**160 文件 / 1958 用例**全绿；`corepack pnpm build` 通过；
  bundle `index-C1euv8zb.js` 体检全 miss（`node:zlib` / `node:fs` 仅出现在注释里）。
  截图：`.mochen-tmp/p2/shot-appearance-save.png`。

- **后续批次**：
  1. 悬着的产品决定：`.mochen/changes` 要不要淘汰策略（若要，必须是显式开关 + 二次确认）
  2. 扫描台账第 8 项「联网扫榜」：原判「不做」（依赖登录态与抓取，合规与稳定性成本高）；
     真要做需要用户重新拍板
  3. ~~**同一族的既有缺陷，本批顺带发现但未修**：`notesOpen` / `wordCountOpen` 与 `exportOpen`
     同样没有任何写者 ⇒ 笔记面板与字数面板同样够不着。~~
     **更正（批次 5-④ 补记）**：这条当时写错了。笔记面板**够得着**——`panelShortcut` 里有
     `case "notes"`，走键盘快捷键，是真写者；真正零写者、真的够不着的只有字数面板（5-③ 已修）。
     导出面板的入口也在 5-③ 补上了。`dead-panel-entry.test.ts` 里现在有一条**反向钉**
     专门守住这个更正：别为了让口径「统一」把 notes/search 也搬去 store 那一格，
     那会让键盘快捷键失效，而 tsc 完全不报。
  每批都过全量门禁 + CDP 真机验收，不合并交付。

## 批次 5-⑤ · 「添加模型」重做成 Qoder 形态（2026-10-06）

  起因是潇潇的原话：「参考的是 Qoder 这个软件的添加模型东西，但他把上面那个东西当做固定东西，
  不能切换，不能快捷使用，还有一些其他问题」。诊断结论（真机量出来的，不是看代码猜的）：

  - 界面上**没有渲染破损**（552×590，无溢出无遮挡），三个输入框都能正常打字。
  - 真正的毛病是：供应商与 API 类型是**两个写死禁用的下拉**，卡片上那句「OpenAI Compatible」
    是 `ProviderSettings.vue` 的硬编码字面量，`contracts` 里**连一个供应商枚举都没有**。
  - 保存**完全不校验地址**（`http://127.0.0.1:8899/v1http://127.0.0.1:8899/v1` 也照样存下来并启用）。
  - 「连不上」提示只在拉名单时出现，**点保存就随对话框一起消失**，用户看着像配好了。
  - 地址在界面上一个都看不到，存完只能猜配的是哪家。

  三项拍板：**多份连接并存**（Qoder 形态）、**首批供应商国内 6 + 国外 3、不要本机的**、
  **软校验 + 卡片常显状态**（不做 Qoder 的硬校验——用户本机没有可用 Key，硬校验会直接把他卡死）。

  - **contracts**：`provider.ts` 重写为 v3。`PROVIDER_PRESETS`（9 家）、`PROVIDER_DIALOG_GROUPS`、
    `AuthHeader = "bearer" | "api-key"`、**MiMo 走 api-key**（官方只认这个头，发 Bearer 永远 401——
    这是「能切供应商」带出来的新坑）、`providerStoreFileSchema` 带 `superRefine` 外键完整性、
    `migrateProviderStore` 覆盖 v1/v2/v3 三代且是**纯函数**（出网与落盘都不归它管）。
    `LEGACY_CONNECTION_ID = "legacy"` 用固定值不用随机数：随机 id 会让「第一次迁移后改的密钥」
    在下次迁移后读不到。
  - **主进程**：`credential-store.ts` 从全局一份 `secrets.enc` 改成**按连接分份** `secrets/<ref>.enc`
    （`secretFileNameOf` 校验 ref，`../../` 写不出去）；`provider-models.ts` 新增 `authHeadersOf`
    按 `authHeader` 发头，无密钥时两个头都不发。
  - **界面**：供应商是真能切的 `<select>`（带 optgroup），`watch(providerId)` 自动填地址与头形态，
    「获取 API 密钥」按钮，Ollama 快捷按钮，体检三档结果**常显在卡片与对话框里**。
    **「API 类型」不再是禁用下拉**，改成一行诚实说明「协议固定是 Chat Completions」——
    底层只实现了一种协议，摆个能点没用的下拉就是装样子。

  **本批修掉的四个真缺陷**（都是过程中撞出来、不是计划内的）：

  1. **挂错连接**：新增连接后，对话框是拿 `baseURL` 回头在 view 里 `find` 出 id 的。
     同一家开第二个账号（个人号 + 企业号）时地址一模一样，`find` 先命中前一条，
     **模型就挂到用户没在配的那条连接上**。改成 `providerSave` 回执带 `connectionId`
     （`ProviderSaveResult extends ProviderView`，加长而非嵌套，既有消费方零改动）。
  2. `.vue` 里一个**死 import**（`defaultAuthHeaderOf`）——`tsc` 看不见 `.vue`，是 eslint 逮到的。
  3. `OLLAMA_FILL_LABEL` 成了**孤儿常量**：重写时换成了字面量「一键填 Ollama」，
     contracts 里那份没人用了。已改回用常量（顺带把 URL 显式摆给用户看）。
  4. `electron-cipher.test.ts` 我改 `credential-store` 时**打断了却没同步**（还在用单份密钥的
     `store.save(key)` 老签名）。它在子代理给的 12 个文件之外，靠 `verify` 才兜出来。
  另有一处：`<select>` 在 `.provider-field` 里**完全没样式**，真机量出来只有 **19px**，
  而同一列的 input 是 33px——「供应商」那两格看上去是塌的。已补齐（现在 34 vs 33）。
  注：本仓目前**没有**自动钉控件齐平的守卫（`.vue` 零类型检查），改回 select 时请顺手量一次。

  **测试**：本批新写/重写 `provider-presets` 18、`provider-settings` 24、`credential-store` 13、
  `provider-models` 29、`useProviderStore` 26 条，另重写 `model-profile-dialog-wiring`（29 条）。
  子代理适配了 12 个机械文件 154 条，**并主动回报了 5 处语义判断**（其中一处是它自己发现旧断言
  在 v3 下会变成「永远为真的空断言」）——没有自行改断言语义。`agent-ipc.test.ts` 的
  `app:open-external` 只钉了注册位置没 fire，因为本仓没有 electron 桩，强行调用会 TypeError。

  **变异**（7 条全红，`.mochen-tmp/p2/mutation-5-5.mjs`）：密钥不随迁移搬走 / 回执点名视图第一条 /
  摘掉 ref 路径校验 / 一律发 Bearer / 撤掉外键完整性 / 对话框退回按地址 find /
  切换供应商不自动填地址。**其中「外键完整性」那条第一版是假杀**——把 `.superRefine(` 改名会让测试
  **编译期**挂掉（`Tests: no tests`），证明不了断言会红；改函数体（`if (false)`）才是真杀
  （`1 failed | 17 passed`）。教训同 5-④ 那四个脚本：**「红」得看是不是断言红的**。

  **真机证据（2026-10-06，Electron 真进程 + CDP）**：
  ① **v2→v3 迁移不断链**：盘上 `config.json` 从 `{baseURL, profiles}` 变成
  `{connections:[{id:"legacy",…}], profiles:[{…, connectionId:"legacy"}]}`；
  `secrets.enc` 被 **rename** 成 `secrets/legacy.enc`（老文件真的没了，不是复制）；
  读回来的视图 `hasKey: true`、`keyMask: "••••k-f6"`——**用户原来那把密钥没丢**。
  ② 卡片几何实测 880×182、`elementFromPoint` 确认可命中、地址 `http://127.0.0.1:8899/v1`
  与 `密钥 ••••k-f6` **常显**、体检结果 `provider-verify is-unreachable`（本机没起 mock，
  如实报「连不上」而非假装正常）、无横向溢出。
  ③ 逐家切换供应商，**9 个预置的地址与头形态全部自动带对**，MiMo 独独是 `api-key`，
  「获取 API 密钥」按钮仅在自定义时隐藏。
  ④ **端到端复现了缺陷 1 并确认已修**：加第二条同地址连接后，两条卡片各挂各的模型
  （`mochen-mock` / `mochen-mock-2`），各带各的密钥掩码（`••••k-f6` / `••••9999`）——
  不修的话第二条会挂到第一条上。测完已把第二条**删干净**并把 `enabled` 拨回 `true`（删连接会
  连带删掉启用中的模型且不会自动补一个，这是**下一批该处理的口子**）。

  **未实测、如实标注**：OpenAI 与 OpenRouter 的 baseURL **本机到境外不通**，
  预设里带 `note` 说明「未在本机实测」；MiMo 的 `api-key` 头**没有真 Key 可验**，
  只能说「按官方文档实现」。国内六家（百炼/DeepSeek/智谱/Kimi/MiniMax/MiMo）此前已实测 401 通过。

  门禁：**161 文件 / 2012 用例**全绿；`corepack pnpm build` 通过；
  bundle 体检：渲染层产物里**一个 `sk-` 都没有**（密钥不进前端），
  预设地址各出现 1 次（对话框自动填地址要用，属预期）。
  截图：`.mochen-tmp/p2/shot-provider-v3.png`、`shot-add-model-v3.png`、
  `shot-two-connections.png`、`shot-dialog-aligned.png`。

---

## 批次 5-⑥ · 「填模型」那块重做（2026-10-06）

潇潇给了 hub 与密钥要接进来，顺带一句「还有填模型的地方有待优化，看着不够好用、好看、方便」。
查下来是三件事叠在一起。

  **① 选模型是个原生 `<input list>` + `<datalist>`**：浏览器画的浮层、各平台长得都不一样，
  搜不了，上百个模型的 hub 里也没法用。换成「可搜 + 分组 + 点一下就选中」的选择器
  （判定全在 `utils/model-picker.ts`，20 条单测）。
  分组是**按名字猜模态**（`agnes-image-*` / `agnes-video-*` / 其余）——`/models` 回的
  `supported_endpoint_types` 一律是 `["openai"]`，区分不出模态，只能从名字看。
  所以组标题一律写「（名字像是）」，且**不隐藏任何一个模型**：猜错顶多挪一格，
  藏掉一个能用的模型会让人以为这服务不支持它。`vision` 判成对话（它是能看图，不是生成图）。

  **② 边打边拉**：此前只有 `@change`（失焦）才拉名单，于是「粘上密钥 → 看名单」这条
  最自然的路径**不成立**，而且列表区还挂着上一次（空密钥）拉出来的「密钥无效」——
  **过期**的报错比没有更误导人。改成防抖 600ms 自动拉（有密钥才拉：空凭据去问人家要名单，
  回一句 401 显示出来，用户会以为自己已经填错了什么），并在 `onUnmounted` 撤掉还没发的请求。

  **③ 一个真竞态**：「边打边拉」让两个请求同时在飞（地址框失焦那个没密钥、防抖那个带上了密钥），
  谁先回谁说了算的话，先发的慢一拍回来就把正确结果盖掉。真机上两次跑出来**一次空一次 12 个**，
  就是它。修法是 `loadModels` 记一张 `modelsTicket`，过期回包直接丢弃（`loading` 也只由最新那次收）。
  新增两条并发用例，并做了变异确认守卫真的在挡（摘掉后 `1 failed | 27 passed`）。

  **顺带修掉一个我自造的 UI 缺陷**（两轮才修对，记下来）：
  选择器展开后内容变长，「保存并启用」被顶到 y 904~936，而对话框底边只有 811、视口 902——
  **不滚动根本点不到**。我第一版改成 `position: sticky`，结果**更糟**：
  它带着 z-index 压在内容上，`elementFromPoint` 落在 `.dialog-actions` 上，
  **模型名单那几颗按钮全点不动了**。批次 4-② 早就写过「sticky 只保证自己不被滚走，不保证不压内容」，
  我还在注释里引用了这条，转头又踩。
  最终解法是结构性的：**把 `.dialog-actions` 移出 `.dialog-content`**，让它成为
  `.workspace-dialog` 的直接子元素（头固定 / 中间滚 / 按钮在滚动区外，就是 4-② 那个三段式）。
  四个弹窗（ModelProfile / NewBook / SaveConflict / SideNavNotice）统一照此办理并逐个真机验过。
  另把模型名排成两列：一列 13 个模型就是 13 行约 500px，对话框里露不出几行；两列压到一百多像素，
  一屏扫得完（实测可见项从 2 个变 9 个）。

  **诚实边界**：hub 在本批中途一度连不上，`ERR_TLS_CERT_ALTNAME_INVALID`，
  当时递过来的证书 SAN 里只有 `IP Address:103.73.220.77`、一个 DNS 名都没有（`validFrom` 10-05，
  即前一天刚续的）。**我据此下了「证书配坏了、接不进去」的结论——那个结论下得太早。**
  过一小时复查，DNS 解析到了 Cloudflare 节点（104.18.19.62），证书是正常的
  `DNS:*.agnes-ai.com` + `DNS:agnes-ai.com`，连 5 次全通（12 个模型，每次 426~1206ms）。
  也就是说：**那只是一台配错的边缘节点被轮询到了**，不是整个服务坏了。
  教训：证书类故障**先分清「这台机器坏了」还是「这一台坏了」**——
  多解析几次、多连几次，或者直接看 DNS 给了几个地址，再下结论。
  顺带一提，我第一次判「通配符没覆盖」也是错的：`*.agnes-ai.com` 本来就匹配
  `apihub.agnes-ai.com`，是我的比对脚本只做了字面比较。

  **hub 接进去后的真机结果**：`https://apihub.agnes-ai.com/v1` + 密钥经 UI 真键盘输入存下，
  盘上多出 `secrets/<uuid>.enc`（与本机那条各存各的），卡片显示
  `provider-verify is-ok`「连得上，名单里有 12 个模型」，
  选了 `agnes-2.5-pro` 作为启用模型。再单发一轮 chat 验过能真写：
  「雨停了，屋檐最后一滴水悬了许久，才轻轻"嗒"一声，落在空无一人的青石板上。」
  （用量 154 reasoning + 28 text token——**这是推理模型**，本仓客户端本来就单独处理
  `reasoning_content`，不用改；也**没有**任何地方设 `max_tokens`，所以不会出现
  「预算被思考吃光、正文为空」那类问题。）

  **修掉 5-⑤ 记下的那个口子**（本批末尾做的）：**删掉「启用中」的那条连接会静默留下
  「一条都没启用」的状态**。用户删掉 agnes 那条之后，剩下的 `mochen-mock` 会全部处于停用，
  发请求时 `config()` 返 null，界面上看着像压根没配模型——而他明明还留着能用的那些。
  改为：**剩下的档案里一条都没启用时，自动启用其中第一条**；本来就有人启用的则**原样保留**
  （别擅自换人）。真机跑过一遍：删掉 agnes → `mochen-mock` 自动接手（`anyEnabled: true`），
  随后又把 agnes 加了回来。

  > 写这条修复时我**自己又造了一个 bug 并被新用例当场抓住**：第一版写成
  > `enabled: index === 0 && kept.every((p) => !p.enabled)`，当条件不成立时它会把
  > **原有**的启停覆盖成 false——于是「本来就有启用着的」那条分支反而把好模型停用了。
  > 正确写法是先算出 `noneEnabled` 再二选一。接线测试（27 条）当场红，改完绿。

  **顺带修的一处界面毛刺**：两条连接在面板上原本**都叫「自定义（自己填地址）」**——
  用户存了两家 hub，界面上分不出哪张是哪张。改为按地址取主机名：
  「自定义 · apihub.agnes-ai.com」/「自定义 · 127.0.0.1」。
  判定在 contracts 的 `customConnectionLabel`（4 条单测），
  任何认不出来的地址都退回通用名——**不许为一个显示用的名字抛异常**。

  **流式通路单独验过**：墨宸发每一轮走的是 SSE，我只直接测过非流式，不够。
  实测 `text/event-stream`、99 个 `data:` 行、`[DONE]` 收得到，
  `delta` 里 `content` 与 `reasoning_content` 分开推（客户端本来就分别处理）。
  另外确认**全仓没有任何地方设 `max_tokens`**，所以不会出现「预算被思考吃光、正文为空」那类问题。

  门禁：**162 文件 / 2050 用例**全绿；build 通过；bundle 与源码体检：密钥两处都没有
  （临时文件已删）。真机截图：`.mochen-tmp/p2/shot-picker-final.png`、
  `shot-picker-search.png`、`shot-newbook-dialog.png`、`shot-agnes-panel.png`、
  `shot-after-delete-agnes.png`。

- **后续批次**：
  1. 悬着的产品决定：`.mochen/changes` 要不要淘汰策略（若要，必须是显式开关 + 二次确认）
  2. 扫描台账第 8 项「联网扫榜」：原判「不做」（依赖登录态与抓取，合规与稳定性成本高）；
     真要做需要用户重新拍板
  3. ~~**删掉一条连接时，若被删的正是启用中的那条，会静默留下「一条都没启用」的状态**。~~
     **已修（批次 5-⑥）**：剩下的档案里一条都没启用时自动启用其中第一条，
     本来就有人启用的则原样保留。真机验过（删 agnes → `mochen-mock` 自动接手）。
  4. `Responses API` 还没做——「API 类型」那行现在写的是「暂不支持别的形态」，
     做了之后才配把它变回真能切的（见 5-⑤ 的设计取舍）。
  5. **`apihub.agnes-ai.com` 有一台边缘节点的证书是坏的**（SAN 只有 IP，没有域名）。
     本机轮询到那台就连不上，轮询到 Cloudflare 那两台就正常。
     不影响本仓（那是服务方的事，且**不能靠关掉证书校验绕**），但值得跟对方提一句。

- **批次 5-⑦ · 全应用审计（2026-10-06）**

  用户问「还有什么要优化的、还有什么问题」。这一批是真机扫完 + 静态扫完的结论：
  **界面基本干净，缺陷集中在两处「说错话」的地方。**

  **审计怎么做的**：写了 8 个 CDP 脚本（`.mochen-tmp/p2/audit-4…9`、`diag-*`），
  把输入区 12 个入口、右栏顶栏 8 个入口、4 枚上下文格逐个**真点开**，
  对每个浮层量 `getBoundingClientRect` + 对每个控件做 `document.elementFromPoint` 命中测试。
  三条是踩出来的教训，写在这里免得下轮再踩：
  ① 探针写死类名等于没测（第四轮「没打开」一片，其实是类名猜错了）→ 改用点击前后可见元素差集；
  ② 类名泛匹配（`"panel"`）会把别的容器选中，把「没打开」误报成「存在但不可见」→ 改一对一精确配对；
  ③ 探测的等待时间不够就会把「打开得慢」误判成「没打开」（卷纲面板要 2 秒以上）→ 等够再量。

  **扫出来的干净结论**（都是实测，不是推断）：右栏 8 个面板逐个打开，全部无裁剪、无遮挡、控件全点得到；
  4 枚上下文格里，档案与阶段打开正常菜单，文档格是「关掉当前标签」（左栏文稿树里那行还在、可点回来，不是丢稿），
  书本格走系统文件夹选择框。输入区 4 个浮层（模型 460×199、工具 560×401、`/` 命令 627×435、权限档 200×105）全部落在视口内。
  盘上目录名是英文（`chapters` / `outline` / …）而界面是中文——记为观察项，没动。
  行数预算全部守住（最高 `agent-service.ts` 757 < 800），`any`/TODO 只剩 3 处且都在合理位置。

  **缺陷①：出网失败一律报成「地址填错了」——真机实测带出来的**

  现象：模型选择器对 agnes 报「连不上这个 API 地址……或者网络到不了那台机器」，
  并把人引去「去模型设置」改地址。但**地址完全正确、密钥也能用**。
  把 `fetch` 的异常连 `cause` 一起打出来，真相是
  `ERR_TLS_CERT_ALTNAME_INVALID`——那台只签了 IP 的边缘节点。
  也就是说：旧文案把一件**服务端证书部署问题**说成了「你填错了」，
  于是用户去改一个没写错的地址。5-⑥ 那轮排查绕远，根子就在这句话。

  改法：`networkReason` 不再一句话打天下，拆成
  `timeout / tls-cert / dns / refused / unreachable / generic` 六类，
  每类说自己的那句。归因函数 `networkFailureOf` **导出成纯函数**（不是内联判断）：
  ① 单测能直接钉住每种形状；② 体检通道（`provider:verify`）走的是同一个 `list()`，天然共用这一份判定，
  不在第二条通道上抄一遍（铁律 6）。逐层摸 `cause.code`（最多 4 层），`ERR_TLS_*` 家族用前缀兜底，
  免得 OpenSSL 以后加新码就退化成误导。

  **顺带修掉一处自相矛盾**：连接卡片与对话框原来在 reason 前面硬写了「连不上：」，
  分类之后 reason 自己就是完整句子，再套前缀会把它说反——
  真机上出现过「连不上：连上了那台机器但没人监听这个端口」，前后打架。两处一起删掉前缀。
  有两条断言因此**语义不再成立**（一条钉「连不上：」这个字面量，一条读整份原文会被注释反咬），
  已按纪律回报并换成更强的钉：reason 必须**原样**出网、前缀不许回来，且用 `templateSource` 剥注释再断言。

  证书那一支**刻意不提**「关掉证书校验」这类旁路，并写了反向钉断言：
  证书对不上就是不该连上，提示用户去关校验等于把一个安全后门交到手上。要修的是那台机器的证书部署。

  真机复验（重建后）：模型浮层与两张连接卡片都给出各自的真实原因——
  `127.0.0.1:8899` → 「连上了那台机器但没人监听这个端口。确认服务已经启动、端口号没填错。」；
  `apihub.agnes-ai.com` → 证书那句。console 无报错。
  测试：provider-models 29 → **41**（新增 12 条，含反向钉）；接线 +2。
  变异 **4 条全真红**（整体退回旧版 / 不摸 cause / 去掉 `ERR_TLS_` 家族兜底 / 把误导文案放回去）。

  **缺陷②：改稿历史面板在撒谎（面板文案已改，淘汰策略待拍板）**

  真机量出来的：一篇 35 KB 的正文，按默认 2 秒自动保存档打 **8 次字**，
  `.mochen/changes/` 就长出 **8 个时间戳目录、8 份整篇备份**，
  面板把「9 次改动」摆给用户。按一篇 10 万字长篇（约 300 KB）外推，
  一天 200 次自动保存 ≈ **54 MB**，而且**全仓没有任何淘汰**。

  根因：`writeDocFile` 对**每一次**写盘都整篇备份，改前内容原样落盘；
  `restoreChange` 回滚时又留一份（这条是对的，「撤销撤销」要靠它）。
  于是面板那句「每批准一次改稿，改前的内容都会留一份」**是假的**：
  它把 8 次自动保存说成了 0 次——备份认的是「写盘」，不是「改稿」。

  **已改（不依赖任何决策的那部分）**：面板那句改成只说盘上真正发生的事
  （每写一次盘都会留一份，含自动保存）；空态那句「批准一次提案之后，这里就会出现」同样不成立——
  **只要你打字**，2 秒后它自己就出现了，改成「这一篇还没被覆盖保存过」。

  **保留策略（用户问「你觉得呢」，我拍板并实施）**

  我排除了「只对批准改稿 + 回滚留备份」：那样 `writeDocFile` 就得知道这次写盘是谁发起的
  （要动 IPC 与 contracts），更糟的是**误删保护整个消失**——你打了一段字，误操作把稿子盖掉，
  自动保存那一版不在备份里，救不回来。对写作软件这是硬伤。

  实做的是**每篇封顶**：`CHANGE_KEEP_PER_DOC = 50` 份 **或** `CHANGE_KEEP_BYTES_PER_DOC = 32 MB`，
  任一条越线就从最旧的开始删。判定是纯函数 `planChangePruning`，删除是 `pruneChanges`，
  两者都在 `fs-store/changes.ts`（铁律：判定下沉、`.vue` 零覆盖）。
  **按篇算而不是按全书算**：一章被反复改不该把另一章的回滚点一起清掉。

  三处接线，缺一处这个上限就形同虚设：
  ① `writeDocFile` 留完备份就收口（默认 2 秒自动保存档下，这一次最要命）；
  ② `restoreChange` 回滚也收口——**回滚自己也要留一份**，漏了它就是「回滚攒出一堆回滚」，
  一条绕过上限的路（这条最容易漏，单独写了变异）；
  ③ 面板把上限**写给用户看**（`CHANGE_RETENTION_NOTE`），不许让人以为盘上是无限的。
  清理失败**绝不外抛**：正文已经落盘了，为一次清理失败把这次保存判成失败是本末倒置。

  两条钉住的不变量：**最新的那份永远留着**（删光等于没有回滚可言，比多占盘更糟）；
  删之前仍要过 `isUnder` 与形状检查——这是**删**盘上文件，判据必须与 `readChange` 一样严
  （符号链接可以把一条备份句柄指向书外）。

  面板与主进程那两个数字**没有**跨进程接过去（要动 contracts/IPC/preload 一整条链，
  代价远大于收益），代价是**改一边必须改另一边**——接线守卫就是那个代价的保险，数字对不上会红。

  **真机逮到一个我自己没看出来的 bug（这轮的收获）**：
  第一版实机跑 60 次字，打出来的数是「61 个时间戳目录 / 50 份备份」——
  份数确实收敛了，但**多出的 11 个是空壳**。根因：备份路径是 `<stamp>/chapters/01.md.bak`，
  删掉 `.bak` 之后 stamp 目录里躺着的是 `chapters/`，而代码写的是
  `readdir(stamp).length === 0`——只看一层，判不出「只剩目录」的空壳，
  于是 `.mochen/changes/` 下的空目录会随着淘汰一轮轮堆积，而 `listChanges` 每轮都要白走一遍。
  改成 `treeHasNoFiles` 递归判空。

  同一轮里**探针也犯了同一个错**：它统计空壳时也只看一层，所以报的是「空壳 0」——
  探针和被测代码犯同一个毛病，探针就成了同谋。两处一起改成递归，
  并把守卫从「某几条 stamp 目录里有东西」换成「**剩下的目录数必须等于剩下的文件数**」，
  多出来一个就是空壳。变异 2 条（退回只看一层 / 干脆不收）当场全红。

  **教训**：判「这个目录是不是空的」时，只有目录没有文件就是空壳——写单层判空时先问一句
  「这棵树上还有别的层吗」。探针与实现犯同一个错时，它不会帮你抓错。

  **真机复验（最终数字）**：改用 store 的 `onEdit` + `saveActive` 驱动——这**就是自动保存走的同一条链**
  （第一版用 DOM 上的 textarea 逐次改字，第 41 次左右编辑器状态被重置，探针直接崩；DOM 是最脆的一层，
  换驱动不改变被验的东西）。一篇 34.7 KB 的正文连续保存 58 次：

  | 保存次数 | 时间戳目录 | 备份份数 | 总字节 |
  | --- | --- | --- | --- |
  | 20 | 21 | 21 | 0.68 MB |
  | 40 | 41 | 41 | 1.37 MB |
  | 50 | 50 | 50 | 1.71 MB |
  | 58 | **50** | **50** | **1.72 MB** |

  修复前同一实验是「61 个目录 / 50 份」（11 个空壳）；修复后**目录数 == 份数，零空壳**，
  且第 50 次之后字节数持平——确实收敛，不再涨。
  面板实测：头部「50 次改动」、说明两段都在、浮层几何 `[1055,48,1375,345]`、列出 50 行，console 无报错。

  门禁：**162 文件 / 2080 用例**全绿（原 2050，本批 +30）；build 通过；bundle 体检无 `sk-` 字面量。
  变异：错误归因 4 条 + 保留策略 6 条，**10 条全真红**。
  截图：`.mochen-tmp/p2/shot-final-modelselect.png`、`shot-final-changehistory.png`、
  `shot-netreason.png`、`shot-retention.png`。
---

## 批次 5-⑧ · 外观与写作设置（2026-10-06）

用户提的需求：**填好地址和密钥后自动拉取模型服务商名字**；**主题配色多增加一些**；
**界面字体与正文字体都多增加**；语音输入这次就做；设置里加**正文行距 + 页面宽度可调**、
**关掉某些自动行为**、**改稿历史上限可调 + 手动清理**。

这一批共修掉 **4 个真缺陷**（其中 2 个是「控件说自己做的事没做」），新增 **63 条**测试。

### 1 · 供应商离线识别（13 + 7 条守卫）

**做什么**：填完地址和密钥后，地址框下方直接显示「这是哪家服务商、用的是哪个密钥头、
常用模型是哪几个」，并给一个去取密钥页的链接。

**为什么必须离线**：OpenAI 兼容层没有统一的身份端点，问「你是谁」只能挨个试。
`detectProviderByBaseURL(rawBaseURL)`（`packages/contracts/src/provider.ts`）只做**主机名匹配**，
零网络、零延迟；认不出时退回 `customConnectionLabel`，`suggestedModels` 是**空数组不猜**。

**认出来要一次给全**：名字 + 密钥头 + 常用模型。只给名字等于白认——MiMo 走 `api-key` 头，
用户在自定义里手填 `Authorization: Bearer` 会永远 401。

**不动的三件事**：不改用户已填的地址、不自动切下拉、密钥页**只收 providerId**。
最后一条是刻意的：主进程拒绝渲染层递任意 URL 出去，不为识别功能开「能开 file:// 和内网地址」的口子。

### 2 · 主题配色 4 → 10 套（26 + 4 条守卫）

新增 `bamboo` 竹青 / `dusk` 暮山紫 / `ink` 墨黑 / `silk` 绢素 / `dai` 黛蓝 / `crimson` 绛红。

**兼修真缺陷——accent 上的字全是「感知亮度算出来的」，量出 3 处不合格，其中 2 处在出厂默认里**：

| 主题 | 按钮文字对 accent | 判定 |
| --- | --- | --- |
| Codex 浅色 | **2.86:1** | 不合格（AA 要 4.5） |
| 暖纸浅色 | 4.19:1 | 不合格 |
| 绛红深色 | 3.01:1 | 不合格 |

根因是**感知亮度对蓝色系统性高估**（蓝在亮度权重里只占 0.114，而 `#339CFF` 的蓝很重）。
改成**两候选各算 WCAG 对比度，谁高用谁**，并导出 `relativeLuminance` / `contrastRatio` /
`readableAccentTextForTest` 给守卫复用（守卫不写第二份算法）。
暖纸浅色的 accent 由 `#B5683B` 压到 `#A25D35`（脚本 `.mochen-tmp/p2/pick-accent.mjs` 算的，白字 5.06:1）。

判据卡三条：正文对背景 ≥ 7:1（AAA）、**按钮上那个字**对 accent ≥ 4.5:1（AA）、accent 对背景 ≥ 2.5:1。
量的是「app 真的放上去的那个字」而不是 accent 对页面底色——这两件事在深色底上是反的。

**一处自我更正**：我一度把「浅色版不许纯白底」当成判据写进守卫，那条是**我自己编的**。
Codex 用 `#FFFFFF` 是合理选择，已改成只禁深色版纯黑（刺眼 + OLED 拖影）。

### 3 · 字体：界面 3 → 6 档、正文 5 → 10 档（13 条守卫）

跨平台字体栈补全：`kai` 补楷体/TW-Kai、`fangsong` 补仿宋/FangSong_GB2312、`li` 补
LiSu/STLiti/隶书/华文隶书、`seal` 补 STZhongsong/华文中宋、`youyuan` 补幼圆。
规矩：**跨平台族名一律排到本平台族名之前**；每个族要有「通用中文名 + 同义名 + 英文回退」；
界面与正文共用的族**引用**同一份栈。

### 4 · 设置页：页面宽度 / 自动行为 / 保留上限

**④ 正文宽度（每行字数）六档** `--editor-measure` 挂到编辑区，`none` = 不限。
诚实边界写在面板里：「只收窄文稿正文那一列；分栏模式下左栏比这一档还窄时看不出变化」。

**⑤ 两枚自动行为开关**——这批**补上了它们的运行时消费方**（原先只存不用，是两排装饰）：

| 开关 | 消费方 |
| --- | --- |
| 送出后清空输入框 | `CenterColumn.onComposerSend` + `useHotkeys` 的 submit 分支 + `useAgentStore.send` 的**还字账** |
| 批准改稿后自动同步正文 | `useBookStore.absorbAgentWrite` |

**关于还字账**：开关关掉时**根本不记那条账**。记了的话，用户手动删掉那段字之后迟到的失败回执
会把它又填回去，变成「我没点发送，它自己又出现了」。

**关于第二枚开关的名字**：原文写「批准提案后自动落盘」——那是**主进程**做的事，渲染层管不了。
名字与说明改成「批准改稿后自动同步正文」，说的是渲染层真能控的那件事：写完之后右栏要不要换。
关掉时走的是「冲突」那条既有分支（不是新造一条「什么都不做」），否则右栏会**静悄悄**停在旧正文、
用户下次保存被指纹闸拦下而不知所以然。

**⑥ 改稿历史保留上限**（本批最大的一块，29 条新测试）：

上限从写死变成可配，接线一路通到底：
`contracts/change-retention.ts` → 主进程 `change-retention-store.ts`（userData 落盘）
→ `changes-service` 三枚通道 → preload → `useChangeRetentionStore` → `WritingPanel` 一节。

**为什么必填依赖**：`createBookService({ retention })` 做成必填。做成可选会有一个很坏的失败模式——
某个装配点忘了传，于是界面上用户把上限调到 10 份，盘上照旧按 50 份删，而代码里看不出任何异常。

**跨包复制的六处数字**（默认档 50 份 / 32 MB + 四个界）用
`apps/desktop/src/main/change-retention-defaults.test.ts` 逐个对着钉——主进程两个包都能 import，
所以比的是**运行期值**，不是源码文本。

**两个包的 `resolveRetention` / `sanitizeChangeRetention` 原本对同一份脏值给出不同答案**
（越界时一个退回默认、一个夹到下界），取整方向也相反（floor vs round）。
对「要删东西」的操作，**少留的那一侧才是出错的那一侧**，所以统一成 `Math.round` + 同范围。
真机上量出第三个矛盾：**范围下界 5、档位表下界 10**，于是「配 5 份」配得出来却选不中，界面两排全灰——
「允许一个选不出来的档」是自相矛盾的，下界已收到与档位表一致。

**旧的那条守卫换判据**：`CHANGE_RETENTION_NOTE` 是一句写死「50 份 / 32 MB」的死文案，
靠一条接线守卫逼着人改两处数字。可调之后这个办法**不能用了**——用户调到 10 份，面板仍会说 50 份。
现在那句话由 `changeRetentionNote(当前那份)` 生成，面板与设置页说的都是主进程那一份。

**⑥ 真机复验（最要紧的一条：控件说的和它做的一致）**

| 步骤 | 结果 |
| --- | --- |
| 上限设 5 份，连打 14 次字（`onEdit` + `saveActive`，自动保存同一条链） | 盘上 **5 个时间戳目录 / 5 份备份**，目录数 == 份数、零空壳 |
| 点「立即清理」（此时正好在上限内） | 「没什么可清的：现在只有 5 份、520 B，本来就在上限内。」 |
| 上限放到最宽攒 8 份，再调回下界 5，点「立即清理」 | 「**删掉 3 份、腾出 126 B；还留着 5 份、330 B。**」盘上 8/8 → **5/5** |
| 从设置页改成 10 份 | IPC 读回 `{persisted: true, maxCount: 10}`，面板注脚同步成「10 份」，「这是默认档不是你设过的」那句消失 |

探针犯的两次错也记下来：① 第一版用 `book.saveAs(...)` 驱动保存——那个方法不存在，14 次保存**根本没发生**，
盘上 0 份，却一度被我当成「清理没删东西」；② 第二版把上限从 5 **抬到** 500 却期待它删东西——
放宽永远不会触发淘汰，是判据写反。两次都是探针的错，不是产品的错。

### 5 · 语音输入：Web Speech API（37 + 8 + 218 条守卫）

`disabled` 占位换成真通路：状态机、逐错误码中文、停止路径、去重、按 `USER_TEXT_MAX_LEN` 截断。

**真机实测推翻了子代理的一条承重结论**。它断言「Electron 的 Chromium 没实现语音识别，
降级路径是本机常态」。CDP 探针实测：

```
SpeechRecognition / webkitSpeechRecognition   都在
构造 成功 · start() 成功 · onstart → audiostart（麦克风真开了）
9 秒静默 → error{code:"no-speech"} → end
**没有** network / service-not-allowed
```

也就是说识别服务是通的。文案与注释已改成只说接口层面的话（不是「Electron 一律用不了」）。
顺带量到一条会影响体验的事实：**引擎在 `no-speech` 之后自己 `end`**（麦克风交还），哪怕设了
`continuous = true`——所以「安静一会儿」= 这一轮结束，不是「还在听」。

**真机逮到第二个真缺陷**：那枚按钮在真机上渲染成
`<button class="round-tool-button" type="button">`——**没有 aria-label、没有 disabled、没有
title，点下去什么也不发生**。根因：`useVoiceInput` 返回 `{ button: computed, … }` 这样一个
**普通对象**，而 `<script setup>` 只对返回值的**顶层**做 ref 解包，于是 `voice.button.disabled`
读出的是 `undefined`。不抛、不报、tsc 绿、**接线守卫也绿**（它只读源码，看到模板里写着
`voice.button.disabled` 就放行）。修法是 `reactive()` 裹一层，并补了 8 条**量运行期**的守卫
（`isRef(voice.button) === false`、`typeof voice.button.disabled === "boolean"` …）。
变异 M1「`reactive` 改回裸对象」——也就是那个 bug 本身——7 条断言真红。

**未能验证**：真人的中文识别准确率与标点表现（探针里没人说话）。这是诚实的边界，不含糊过去。

### 6 · 左栏行高（7 条守卫）

**先量再改**：CSS 里的 `min-height` 不作数。真机量到 nav-row 高 34 / **pitch 36**，树行高 30 /
**pitch 31**。31 = 30 + 1px，那 1px 来自 `.resource-tree { gap: 1px }`——左栏里唯一不成 2 的行间隙，
读起来像手滑而不是取舍。改成 2px 后树 pitch 32，整栏落在同一个间隙单位上；密度差保留（那是有意的层级）。

顺带发现 `.resource-tree` 在同一个文件里**写成了两块**（定 grid 的与定边框的各一块）——两块都在用、
改一块忘另一块正是这种写法的代价，已合并。

守卫里有个坑值得记：`ruleBlock(css, ".nav-row")` 的匹配没有行首锚点，读到的是文件里**第一个**
`.nav-row` 子串——`.nav-group-head .nav-row` 那块。量出来的 `min-height` 是 `NaN`，
而断言仍然「看起来在跑」。所以这一个文件自己写了 `topRule()` 锚在行首。

### 7 · 模型 chip 的假提示（8 条守卫）

`CenterColumn` 传的是 `provider.view?.baseURL`，而 `ProviderView` **根本没有这个字段**
（地址在 `connections[].baseURL`）——恒 `undefined` → 恒空串 →
那枚 chip **永远**显示「配置里还没有 API 地址…拉不到名单」。改传 `provider.activeBaseURL`。

### 门禁与诚实边界

- **`corepack pnpm verify` → `VERIFY_EXIT=0`**：prettier / 五个 tsconfig / eslint / 包边界 /
  行数预算 / **177 文件 2298 用例全绿**（5-⑦ 是 162 / 2080）。
- build 通过；bundle 体检扫 6 个产物**无 `sk-` 字面量**。
- **变异 17 条全真红**：保留上限 7（V1 范围下界脱节、V2 两包界不一致、V3 floor vs round、
  V4 存失败仍换缓存、V5 persisted 判据放宽、V6 两种清理结果说同一句、V7 没开书回 `removed:0`）
  + 左栏 4 + 语音薄壳 2（含 bug 本体）。
  头号教训：第一次跑 M1 时**「没红」**，原因是变异把文件改**编译不过**——vitest 报的是套件失败
  不是断言失败。脚本现在自己对这种假红报警（「红了」要确认是断言红而非编译挂）。
- **本轮仍未做**：联网扫榜、桌面 mojibake 目录 `渊???写作\` 是否清理、`Responses API`。
- **不可实测**：OpenAI / OpenRouter 本机到境外不通；MiMo 无真 Key，只能称「按官方文档实现」。
  `agnes-ai` 那台只签 IP 的边缘节点导致模型列表拉不到——这是服务端问题，本仓改不了（5-⑦ 已改文案如实说明）。
---

## 批次 5-⑨ · 联网搜索本身（2026-10-06）

用户拍板的那条：**联网搜索本身要调**，含三个面——默认开关、结果质量、来源。

这一批的结论比预想的重：**这个功能在本机从来没成功过。** `apps/desktop/src/main/web-search.ts`
的唯一数据源是 DuckDuckGo，实测 `html.duckduckgo.com` 八秒超时，而同一台机器上
`cn.bing.com` / `www.baidu.com` 都是 200。不是「没网」，是那一家在这个网络里到不了——
单一数据源的「免费联网搜索」等于没有搜索。

### 1 · 结果质量：源链 + 回退 + 冷却

改成 **DuckDuckGo → 360 搜索** 的源链，回执里如实写「来源：360 搜索（试了 2 个源，前面几个用不了）」。

**为什么兜底不是必应**（这是实测结论，不是选型口味）：`cn.bing.com` 对**无会话裸请求**只认
「查询开头的词」。词强时很准（黑暗森林法则 / 三体 / 活着 都对），词弱时整个结果页塌成首字的词典条目：

| 查询 | 首条结果 |
| --- | --- |
| 黑暗森林法则 | 黑暗森林法则_百度百科 ✅ |
| 活着 余华 | 活着（余华创作的长篇小说）_百度百科 ✅ |
| **刘慈欣三体黑暗森林的设定是什么** | **刘（汉语汉字）_百度百科** ❌ |
| **余华 活着 小说** | **余（汉语文字）_百度百科** ❌ |
| **dark forest hypothesis** | **DARK（英语单词）_百度百科** ❌ |

**这是内容层面的错**：状态码 200、十条结果、条条有标题有链接，看起来完全正常，但没有一句跟问题有关。
对一个会把搜索结果写进小说的工具，喂错内容比搜不到危险得多。加引号、加 `mkt`、先开首页拿 12 个
cookie 再带会话去搜——**一个都不管用**，实测过了。而这条退化**没有静态规则能预测**
（「活着 余华」准、「余华 活着 小说」就塌），所以不接。

> ⚠️ **这句话后来又翻回去过一轮，见批次 5-⑫ 与 5-⑬。**
> 5-⑫ 一度以为找到了边界（≤6 字连续词、或 ≤2 个空格分隔词），**那是错的**：
> 空格不是机制，长度也不是（10 字的「徽派建筑的特点是什么」照样好使）。
> 5-⑬ 复测后确认——**「没有静态规则能预测」这句其实是对的**，否掉必应的判断在实质上站得住。
> 真正变了的是**做法**：不做静态预判了，改成结果进来算一遍覆盖率、塌了如实说没搜着，
> 于是必应被接进了源链（5-⑬）。「加引号无效」这条复测仍成立。

实测到的另外两家：**百度无会话只回 1438 字节的反爬页**（不是结果），
**搜狗回 5425 字节的 antispider 页**。

**冷却**：网络类/被拒类失败的源进冷却 10 分钟，下一轮直接跳过。效果是真机量出来的——
第一轮 6303ms（DDG 超时 → 退到 360），第二轮 **171ms**（skipped: ["duckduckgo"]）。
`empty`（页面正常但没搜着）**不进**冷却：换个词还能搜，锁十分钟是自伤。

360 的频控是真会来的：连发 5 次后回 200 + 一个 6472 字节的「访问异常页面」，
认出来（`isThrottled360Page`）归入 `unavailable` 并进冷却。**恢复时间没测出来**——
每分钟探一次连探 11 分钟仍未恢复，只能说「至少十分钟」。这条如实写进了 `SOURCE_COOLDOWN_MS` 的注释，
免得下一位把「十分钟」当成实测值。

### 2 · 摘要错位：把 B 的内容记成 A 的来源

旧解析器是两条扁平正则各扫全文、再用 `snippets[index]` 对齐。**只要有一条结果没有摘要，
后面每条的摘要就整体错位一格**——把 B 的摘要记成 A 的来源。对一个靠来源吃饭的工具，
这是把假东西当真东西喂给模型。改成**相邻两条之间的窗口内配对**：窗口里没有就是没有，
绝不借下一条的。360 那边同样七条里常常只有三四条带摘要，同一条判据两处共用。

顺带修掉三条同源缺陷：属性顺序不再当判据（原来要求 `class=` 写在 `href=` 之前）；
摘要里的「详情>>」与相关词条链接先摘掉（否则 URL 混进摘要）；结果按归一化后的 URL 与标题去重、
摘要截断 220 字、上限 8 → **10** 条。

### 3 · 静默吞掉全部摘要（真机夹具逮到）

360 的容器切块写成 `class="res-list"` 就会把 `<span class="res-list-summary">` 也当成新容器切开，
每个块只剩到摘要之前——**标题还在、摘要全丢，而且不报错**。少写一个 `(?![-\w])` 而已。
夹具里特意留了这两个类各 4 / 2 处，并直接断言两种写法的切块数是 6 与 4。

### 4 · 来源：从 `<pre>` 里的纯文本升为一等公民

回执还是那份纯文本（模型要读它），但**另加一份结构化的 `sources` 一路带下来**：
contracts 的 `webSourceSchema` → `ToolOutcome.sources` → tool-loop 的事件（老会话无此键，`.optional()`）
→ preload 透传 → `timeline` 归一成数组 → 工具卡渲染成可逐条点开的清单（编号 / 标题 / 主机名 / 摘要）。

**为什么不在渲染层从 `resultText` 反解 URL**：那是把「这轮搜了谁」在渲染层**第二次**猜一遍。
回执文本是人读的排版，改个版式（编号从 `1.` 换成 `[1]`）抠出来的链接就全丢，而且丢得不报错。
守卫里那条负向断言就是钉这个：`timeline` 不许出现 `resultText.match(...)` 之类。

点开走**本仓唯一一条递 URL 的 IPC**（`app:open-web-source`，点名册 37 → **38**）。
它与既有的 `openProviderKeyPage`（只收 providerId）口径**刻意相反**，两边的理由都写在
`main/web-source-link.ts` 的文件头：密钥页地址全在预置表里、收 id 就够；来源地址是搜索站当场给的，
套不上预置表。安全靠**协议白名单**而不是「URL 可信」——`shell.openExternal` 的风险在于系统会用
哪个协议处理器去打开它，所以只放行 http/https，带 `user:pass@` 的也拒。

**真机验过**：真 preload → 真主进程 → 真闸门打 6 条恶意地址（`file://` / `javascript:` /
协议相对 / 带凭据 / 非 URL / `undefined`），**六条全被中文那句拒绝**。这同时证明通道确实注册了
（没注册会是 `No handler registered`）。真机还量到来源清单渲染正常、无摘要那条干净地不显示、
卡内 **0 个 `<a href>`**。截图 `.mochen-tmp/p2/shot-590-sources.png`。

**探针自己栽过一次，值得记**：`window.mochen` 是 **frozen** 的（contextBridge 特性，
`writable:false, configurable:false`），想替换 `openWebSource` 抓「递出去的地址」会**静默失败**
（sloppy 模式不抛），量出来就是「点了没反应」——差点被当成接线断了。真点击本身是通的：
在按钮上挂原生 capture 监听，`Input.dispatchMouseEvent` 打过去 `clicks:[1]`。
**探针与被测代码犯同一个错时探针会变同谋**：这次是探针犯的错。

### 5 · 失败文案：英文技术串挡在用户视野外

旧代码把 `error.message` 直接拼进中文句子，Node 的连接超时给的是 `fetch failed`——**用户看到的是技术英文**。
改成 `WebSearchError` 带 `kind` 分流：`unavailable`（等一会儿）与 `empty`（换个关键词）
对模型的下一步动作完全不同，不能混成一句；`WebSearchError` 之外的任何异常一律换成中文兜底，
**一个字都不许透出去**（钉住「将来有人在源链里 `new Error("fetch failed")`」那个场景）。

### 6 · 默认开关：只修了一句假话

开关本身是对的（默认关、localStorage 记忆、设置页 + 输入卡 chip 两处）。但设置页那句
「关着的时候**每一轮都不出网**」是**假的**——模型 API 调用本身就是出网。改成
「关着的时候模型手上没有这枚工具，它只能用你书稿里的字和你自己打的字回答」。

### 门禁与诚实边界

- **`corepack pnpm verify` → `VERIFY_EXIT=0`**：prettier / 五个 tsconfig / eslint / 包边界 /
  行数预算 / **181 文件 2353 用例全绿**（5-⑧ 是 177 / 2298）。
- build 通过（`out/preload/index.mjs` 与 `out/main/index.js` 都已含新通道）。
- **变异 11 条全真红**，0 假红 0 漏网：360 切块漏 `(?![-\w])` / DDG 改回下标配对 / 不进冷却 /
  不截断 / 不去重 / 白名单放行 file / 不拒非字符串 / 工具卡不接 sources / 改从回执反解 URL /
  裸异常透出 / 不把 sources 交给界面。
- **本轮没验到的**：360 的频流恢复窗口（探到 11 分钟仍未恢复）；`so.com/link?m=…` 跳转链
  点开后是否真落到目标页（频控期内没验成——留原链是「解不开也照样点开」的取舍，不是「已验能落到」）。
- **仍不做**：Responses API（本机到 OpenAI 不通，建了只能验协议层）。
- **方法论记一笔**：必应那条的教训是——**「状态码 200 + 十条结构完整的结果」不等于「结果对」**。
  只验解析器能不能把页面读出来，会把一个把垃圾喂给模型的源判成「可用」。
### 7 · 端到端真链路（补验，逮到两个新缺陷）

前面每一层都单独验过：解析器对着真页面跑过、工具卡用注入事件验过渲染、白名单对着真主进程打过。
**但层与层之间的缝没验过**——`doc-tools-host` 递出来的 `sources` 到底有没有一路走到渲染层，
每一层单看都绿，缝上断了也不会有人发现。

没有真模型可用（本机到 `agnes-ai` 是 401），于是给 `tools/mock-provider.mjs` 加了一个
`web_search` 场景当模型：关键字命中「联网/查」**且**这一轮真的带了 `web_search` 工具时才派调用
（少第二个条件就等于让模型凭空调用自己手上没有的工具）。三条新守卫把这个条件钉死。

跑通后：**真实事件带上了 6 条 `sources`，工具卡渲染出 6 条可点的来源**，回执写着
「来源：360 搜索（试了 2 个源，前面几个用不了）」。截图 `.mochen-tmp/p2/shot-590-e2e.png`。

同一轮也把**失败路径**在真机上验了（360 当时正好在频控窗口里）：
「联网搜索失败：搜索源用不了——DuckDuckGo：连接超时；360 搜索：触发了访问频控。」
**没有一个英文技术串**——这是 `WebSearchError` 分流那一节第一次在真机上被兑现。

而这张截图同时暴露了**两个此前所有离线探测都没看出来的问题**：

| 问题 | 真机表现 | 后果 |
| --- | --- | --- |
| 超长跳转链灌爆回执 | 单条 `so.com/link?m=…` 达 **450 字符**，六条合计两千多字符的 base64 | 回执区被撑成六行乱码，模型上下文里全是没用的字符 |
| 六条里两条不是内容页 | `ai.so.com/search/…` 的「黑暗森林法则是什么」、以及「…-短视频大全-高清在线观看」 | 点开只是回到 360 的另一个搜索/片库页；模型却以为那就是出处 |

第二个尤其恶劣：**它不是「相关性差」，是根本不是来源**——占着结果位、把用户点进另一个页面、
还让模型把搜索页的标题当成资料。

两条都修了：
- **回执里的链接截到 96 字符并标一句「跳转链」**，完整地址**不丢**（一路带在 `sources` 里，界面上点一下就是完整那条）；页脚的话术从「带上编号和链接」改成「带上编号」——让模型复述一条 450 字符的 base64 是没有意义的。
- **360 的噪音卡在源这一层滤掉**（`isSo360NoiseCard`），三类：标题就是把问题原样回显的「问题卡」、链接落在 360 自己搜索/AI 端点上的、以及「短视频大全 / 高清在线观看」这类聚合落地页。判据**刻意收在 360 那一侧而不是共用的归一里**——360 的噪音只有 360 自己知道，别的源有没有同类卡没量过，不替它们先写一份。
- 顺带把标题去重键从「去空白」改成「去空白与标点」：真页面上同一条会写成「黑暗森林法则是什么?」与「黑暗森林法则是什么」，差一个全角问号就绕过了去重。

**用真机那 6 条原样离线复跑**（不依赖 360 是否在限流）：解析 5 条（两条标题近重复被去重）→
滤掉 2 条噪音 → **留下 3 条真来源**；回执 **675 → 481 字符**，450 字符的跳转链变成一行。

### 8 · 真机截图逮到的第三个缺陷：双句号

失败路径那张截图上，用户看到的是「……先基于已有文稿继续工作**。。**」。
根因不在源链：`webSearch` 抛的每条消息都以「。」结尾，而 `doc-tools-host` 这一层
过去无脑再拼一个 `。`。

这种错**不抛、不报、tsc 绿、全量测试绿**——纯拼字符串，只有真的把那句话渲染出来才看得见。
改成 `sentence()`：已有终结符就不再补，判据是 `[。.…！？!?]` 而不是只认句号
（源侧有的消息以「…」结尾，那种再补一刀同样是错的）。

变异加一条：「`sentence` 无脑补句号」——真红。
**记一笔：这一批三个缺陷里，有两个（噪音卡、双句号）只有真机截图能看出来，
所有离线夹具全绿。夹具能验「解析器认不认得这个结构」，验不了「拼出来的那句话读着对不对」。**

### 9 · 冷却比源的脾气短，等于没有冷却

上一轮自己点出但没修的那个问题：360 的频控窗口实测**超过 23 分钟**，而冷却固定十分钟。
于是连着搜几次的用户会这样撞墙——搜 → 被拒 → 等十分钟 → 再搜 → 又被拒 → 再等十分钟，
一轮接一轮全是白等，而每一次等待都是他自己掏的时间。

当时给的理由是「恢复窗口没测出来就不改」。**那是偷懒。** 指数退避根本不需要事先知道窗口有多长：
撞得越狠等得越久，直到源真的答上一次为止。

- 冷却时长按**连续失败次数**翻倍：10 → 20 → 40 → 60 分钟（封顶）。
  再往上等下去用户早就去干别的了，等着不如重新开一轮。
- **源答上一次就把次数清零**。不清零的话，「断网三秒 + 之后一直正常」会一路涨到六十分钟——
  那是在惩罚一个早就恢复的源。这一条比翻倍本身更容易被忽略。
- 退避**只在真的又撞一次墙时**加码，冷却期内不再白试（否则第 2、3 轮没有新信息，凭什么加码）。
- 冷却满时文案说的是**还差多久**：「最长还要等 10 分钟，再试一次」，
  而不是笼统的「等几分钟」——已经等了 50 分钟还说「等几分钟」是假话。

**真机复验**（连搜三轮，每轮都撞频控，从真进程读模型与用户共同看到的那句话）：

| 轮次 | 界面上的回执 |
| --- | --- |
| 第 1 轮 | 联网搜索失败：搜索源用不了——DuckDuckGo：连接超时；360 搜索：触发了访问频控。 |
| 第 2 轮 | 联网搜索失败：搜索源都在冷却里，最长还要等 10 分钟，再试一次。 |
| 第 3 轮 | 同上（仍在第一个窗口内，没有新信息，所以不加码） |

变异加三条：冷却不翻倍 / 答上源不清零 / 不报还差多久——真红。
**至此 19 条变异全真红，0 假红 0 漏网**；`verify` → `VERIFY_EXIT=0`，**181 文件 2369 用例全绿**。

### 这一批的方法论（值得单独记）

三个缺陷里，**有两个（噪音卡、双句号）只有真机截图能看出来**——
所有离线夹具全绿，tsc 绿，eslint 绿，变异红得也很「正确」。
夹具能验「解析器认不认得这个结构」，验不了「拼出来的那句话读着对不对」、
更验不了「这六条结果里有没有根本不是来源的东西」。

而唯一抓到它们的那一步，是**把每一层单独验完之后，又把整条链真跑了一遍**——
给 `mock-provider` 加一个 `web_search` 场景当模型，是整批里性价比最高的一次投入。

顺带记一条探针的教训：`window.mochen` 是 **frozen** 的（contextBridge 特性，
`writable:false, configurable:false`），想替换 preload 方法抓「递出去的地址」会**静默失败**，
量出来就是「点了没反应」，差点被当成接线断了。改用「打真 IPC + 让闸门用中文拒绝」来取证，
两个方向（放行 / 拒绝）都在真主进程里验到了。
## 批次 5-⑩ · 联网搜索的**第二次**搜索（2026-10-06）

上一批把联网搜索本身修通了：源链、冷却、来源结构化、可点的来源卡。
但那一批的每一条用例都只搜**一次**——所以有一整类问题在那里是隐形的：
模型第一轮搜不准、换个词再搜一次，是**常态**，不是异常。

这一批就补这一格。开工前先把这条路径原样跑了一遍（离线探针，两个查询递回高度重叠的页面，
与真机实测的重合度同形），量出来的东西是这样的：

```
########## 第一次搜索的 query: 黑暗森林法则是什么
来源：360 搜索
[1] 黑暗森林法则是什么 - 知乎 …
[2] 黑暗森林法则_百度百科 …

########## 第二次搜索的 query: 三体 黑暗森林 理论 解释
来源：360 搜索
[1] 黑暗森林法则是什么 - 知乎 …        ← 又是 [1]
[2] 黑暗森林法则_百度百科 …              ← 又是 [2]
[3] 宇宙社会学的两条公理与猜疑链 - 果壳 …

########## 跨搜索重复出现的页面: ["黑暗森林法则是什么 - 知乎", "黑暗森林法则_百度百科"]
########## 回执长度: 206 308
```

### 一、编号撞车：把「位置」改成「身份」

回执末句写着「引用时请带上它的编号」。一轮里搜两次，模型上下文里就并排躺着
**两个 `[1]`、两个 `[2]`**。模型照着那句话写出「据来源[2]」，
用户在两张工具卡上**分不清说的是哪一条**——指代失败，而且**不报错**。
第一次搜索时编号是对的，所以只搜一次永远照不出这个问题。

改法不是把序号编号得更好看，而是**换掉编号这个东西的性质**：
从「位置」换成「身份」，即 `packages/contracts/src/web-source.ts` 的 `sourceKey()`：

```
[baike.baidu.com/darkforest-adb2] 黑暗森林法则_百度百科
[zhihu.com/111-357f]          黑暗森林法则是什么 - 知乎
[so.com/link-4b1a]            某聚合页（360 跳转链）
```

形态是「域名 / 路径末段 - 四位指纹」。三个决定各有各的账：

- **域名去 `www.`**：360 自己就用 `www.so.com` 递跳转链，不摘会漏掉一半。
- **只留路径末段**：中段目录（`/question/123/answer/456`）对用户辨认来源没有帮助，
  留着只会把标签撑长。
- **末尾恒带指纹**：唯一性**不靠「猜这条路径像不像内容页」**。360 递的绝大多数是
  `so.com/link?m=…`，光看路径全都长一个样，只有指纹能把它们分开。
  指纹取 FNV-1a 的前四位十六进制——判重用的，不是安全哈希。

指纹算在**归一之后**的串上（`host + 去掉末尾斜杠的 path + search`），不是原始地址。
这一条是被自己的单测逮出来的：最初算在原串上，于是 `https://www.zhihu.com/…`
与 `https://zhihu.com/…`——同一个页面的两种写法——得到两个不同的键，
键自己都认不出是同一条页面，还指望它判重。

**回执与工具卡必须给出同一个键**，所以 `sourceKey` 下沉到 contracts：
两边各算一份就是两份实现，迟早漂。守卫直接钉住两边都从 `@mochen/contracts` 取。

### 二、跨搜索判重：只跟紧邻的上一次比，且只在十分钟内

同主题换词重搜，搜索引擎递回来的是**高度重叠**的页面（实测两次五条里有两条是同一页面）。
不去重的话模型看到五个编号、实际只有三个页面，还容易写成「多方来源印证」——
把一条资料数成两条，不抛不报。

- 记忆只记**紧邻的上一次**，窗口 `SOURCE_DEDUP_TTL_MS = 10 分钟`。
  数整个会话的键会误伤：A→B→A 里第三次就把 A 卡掉了。
  十分钟这个窗口是刻意窄的：重搜几乎都发生在同一件事的几分钟内；
  隔更久再搜同一个问题多半是真有新问题，判成「重复」会让第二次搜索空手而归——
  **那比重复更糟**。
- 判重放在**源链跑完之后**，不放在源链循环里。放在里面的话，头一个源递回来的全是重复项
  就会直接短路，后面那个源根本没机会答，「这次没搜着新东西」会被误报成「搜索源用不了」。
  守卫钉的是这条：首源挂掉、次源只给重复项时，说的必须是「重复」不是「源坏了」。
- 全被剔光时抛 `WebSearchError(..., "empty")`，文案是
  「上一次搜索已经递过同样的 N 条结果，没有新的可看——换个更具体的关键词再搜一次，
  或直接用上一轮的来源。」措辞必须区分「重复」与「没搜到」：
  两者的下一步动作不同（换个**更具体**的词 vs 换一批词），混成一句模型就会原地打转。
- 回执头如实说是剔了几条：「（本次有 2 条与上一次搜索重复，已略去）」。

### 三、界面：删掉一个说错的词和一份冗余的字

- 卡头原话「这一轮搜到的 N 条来源」——**一轮里可能有好几次搜索，两张卡都说「这一轮」**。
  改成「这次搜索找到 N 条来源」（一张卡 = 一次搜索）。
- 原来每行右边有一个主机名格。键里本来就带着域名（`baike.baidu.com/…`），
  再显示一遍 `baike.baidu.com` 是冗余的墨水。删掉那个格，
  连带删掉只服务于它的 `utils/source-host.ts` 及其测试（它已经只被自己的测试调用）。
- `.source-index`（16px 序号）换成 `.source-key`：键比序号长得多，
  给它 52% 宽度并在超长时截断。键被截了还能靠点开后的完整地址认出来，
  而序号被截了就只剩一个没意义的 1、2、3。

### 四、桩：让它真的会换词重搜

`tools/mock-provider.mjs` 原来只会搜一次（它的守卫里甚至有一条
「工具回投轮不该又去搜一遍」）。那条守卫描述的是一个只会搜一次的替身，
而真实模型就在这一格再搜一次——**守卫本身要跟着改**，
改成钉住重搜本身：两次调用必须换词、换 id（id 相同会让两轮回执串对），
第二次搜完就收尾、且**照回执里给的键**引用。

真机立刻就还回来一条离线夹具看不见的缺陷：`countWebSearchCalls` 原本数的是
**整条历史**，于是用户第二轮对话一开口就被判成「已经搜够了」，模型直接收尾——
**一张工具卡都没有**。真机连着跑两轮时才撞出来，现在只数最近一次 user 之后的。

### 真机端到端（这一批的关键证据）

360 此刻仍在频控（200 / 9845 字节 / 访问异常页），DDG 仍八秒超时——
公网源的成功路径本轮拿不到。为了不把「成功路径没验过」留成一句空话，
临时往源链尾部注入一个**夹具源**跑了两遍，验完用补丁前的原文逐字节还原（已核对一致）。

第一次：两次搜索递回重叠页面。

| | 第 1 张卡 | 第 2 张卡 |
| --- | --- | --- |
| 键 | `zhihu.com/111-357f`、`baike.baidu.com/darkforest-adb2` | `guokr.com/439-1a43` |
| 卡头 | 这次搜索找到 2 条来源 | 这次搜索找到 1 条来源 |
| 回执头 | 来源：探针夹具源（试了 3 个源，前面几个用不了） | 来源：探针夹具源（**本次有 2 条与上一次搜索重复，已略去**） |

模型收尾时写的是：「按 `[guokr.com/439-1a43]` 核对过才动笔的。」
探针做了一次**对账**：把两张卡上出现过的键收成集合，减去模型引用的键——
**差集为空**，即模型引用的键在界面上逐字存在。这条是「键是身份」这整个设计
唯一说得清的端到端证据。

第二次：两次搜索递回**完全相同**的页面，看「全重复」这条用户可见分支。
第二张卡没有来源清单，卡上写的是
「上一次搜索已经递过同样的 2 条结果，没有新的可看——换个更具体的关键词再搜一次，
或直接用上一轮的来源。」——是一张**「完成」卡**而不是失败卡：
源是好的，只是没有新东西，这两件事不该用同一个红色告诉用户。

### 门禁

`verify` → `VERIFY_EXIT=0`，**182 文件 2386 用例全绿**。
`web-search.test.ts` 一度涨到 842 行、超了 800 行预算——
把「第二轮搜索」那一组切到独立文件 `web-search-second.test.ts`：
它与「单次搜索」本来就是两种不同的失败模式，混在一个文件里读者会以为那些断言是边角。

变异 **15 条全真红，0 假红 0 漏网**：

| # | 改坏的地方 | 谁红 |
| --- | --- | --- |
| 1-4 | 指纹算在原串上 / 不剥末尾斜杠 / 上限漏算省略号 / 恒带固定指纹 | 来源键 7 条 |
| 5-7 | 判重整段去掉 / 记忆永不过期 / 记忆成整会话累积 | 第二轮搜索 6 条 |
| 8 | 全重复时改口成「源坏了」 | 第二轮搜索 6 条 |
| 9-10 | 回执退回按下标的序号 / 去掉「别用序号」 | 回执排版 + host + 接线守卫 |
| 11-12 | 工具卡换回序号 / 文案退回「这一轮搜到」 | 接线守卫 |
| 13-15 | 桩数整条历史 / 第二次不换词 / 收尾自己编键 | mock-provider 20 条 |

### 顺带查到的一件事（本批**没有**动它）

探源可达性时发现：**搜狗此刻是通的**——200 / 680KB / 无任何拦截标记。
而批次 5-⑨ 记下的实测结论是「搜狗直接跳 antispider」。
两条都如实，但结论只在各自当时成立。加新源是产品决定，不在这一批的范围里，
所以这里只把事实记下来：搜狗值得重新探一次，若它稳定可用，
「联网搜索在本机从来说不上成功过」这个结论就该改写。

（同一轮里还测了：百度 1438 字节反爬页、必应 200/100KB 但内容层面不可信、
夸克/头条疑似拦截、Mojeek 403、Yandex 6.3 秒、DuckDuckGo Lite 超时。）

**补测（同日 18:2x，把上面那条悬案查到底）**：那次 680KB 之后，搜狗**立刻**变成 5425 字节的
antispider 页，而且把变量全隔离过——换 referer（无 / so.com / sogou.com）、换入口路径
（`/web` vs 根路径 vs 加 `_asf`）、换 query（中文小说词 vs `Python 装饰器`），
**七次都回了 5425 字节、命中同一个拦截标记**，没有一个变量是原因
（没有逐字节比对页面内容，所以只断言「长度与标记一致」，不断言「同一个页面」）。

所以「通不通得了一次」不是它能不能当源的决定性因素，**放行窗口有多长**才是——
而一轮里模型可能连着搜两三次（批次 5-⑩ 刚把那条路径修好：第一次搜、换词再搜第二次）。
第一次搜到、第二次就被拒，用户看到的就是「这工具时灵时不灵」。

窗口正在用**每 5 分钟只打一次**的方式耐心量（连打只会让窗口更紧——那是 360 那一轮
已经付过学费的教训）。量出来之前不接：**连内容质量都没验过**（那 680KB 的页面当时没存下来，
现在也拿不到了），而 5-⑨ 对必应用过一条判据——**内容层面的错比搜不到危险得多**，
同一把尺子也该先量搜狗的标题相不相关，再谈接不接。


## 批次 5-⑪ · 思考摘要与输入区那排 chip（2026-10-06）

用户一句「思考模式还有对话不太好看」。这一批先量后改——**不猜**，
把输入区那排 chip 的每一枚量了宽度、量了文字被吃掉的像素，量了对话区每一块的高度。

### 量出来的（1440 窗口 / 三栏全开）

```
容器查询匹配的内容盒 628px    左端可用 354px    右端 249px
左端五枚自然宽合计 448.3px
```

| chip | 改前盒子 | 改前文字被吃 | 改后盒子 | 改后被吃 |
| --- | --- | --- | --- | --- |
| 模型 `mochen-mock` | 54.6 | **67px（只剩 5.6px 可见）** | 121.7 | 0 |
| 思考 `标准` | 53.8 | 0 | 54 | 0 |
| 联网 `联网搜索` | 74.6 | 0（但上一轮截图里是「联网搜…」） | 28（收成图标） | — |
| 工具 | 44 | 标签已藏 | 44 | — |
| / 命令 | 77.2 | 1px | 44 | — |

### 一、整条响应阶梯偏了约 80px

`@container composer` 的四级阈值原本是 `680 / 620 / 560 / 500`，注释里写着
「断点沿用原值不必重算」——**而那个「不必」是错的**。

两件事没被算进去：
1. 阶梯是**只按左端算的**，容器查询量的却是整个 `.composer-wrap`，右端那摞
   （工作模式 chip、麦克风、权限文案从 3 字变 5 字）真机实测已经吃掉 **249px**。
2. 阶梯的**次序**是对的（2026-10-05 定的：图标自解释的四枚先收，模型名最后只截断），
   但**阈值**算的是「左端还差多少」，没扣右端。

结果：内容盒 628 只触发第一级，省下 26px，剩下 34.7px 全砸在 `flex-shrink:100` 的模型名上——
而它一路让到 **5.6px**。那不是省略号，是几乎归零，比四枚一起出省略号更糟：
你连自己在用哪个模型都看不出来。

按 `left = 内容盒 − 274`、左端自然宽 448.3 重算，四级阈值改成 **722 / 696 / 662 / 615**，
模型名收窄那级从 440 改到 **589**。内容盒 628 落在前三级内 ⇒ 工具、/ 命令、联网三枚只留图标，
行宽降到 341.7 ≤ 354 ⇒ **一枚省略号都不出，模型名与思考档都整条显示**。

另给模型名加 `min-width: 4.5em` 地板：正常布局下轮不到它生效，它只负责兜住极窄窗口。

**这次重算自己也踩了一次坑，值得记**：第一遍我拿 `.composer-wrap` 的 `clientWidth`（664）
当基数算出 758/732/698/651，量完发现思考档被收成了图标，还有 38px 空余。
原因是 `clientWidth` **含左右各 18px 内边距**，而 `inline-size` 容器查询量的是**内容盒**（628）——
整体偏 36px。第二遍换成内容盒才对。**容器查询的基数是内容盒，不是 clientWidth。**

### 二、思考摘要：折起来时不该是一张卡

它与工具卡/提案卡共用那套卡框（`border` + `border-radius` + `background` + `box-shadow`），
于是折叠态就是一条 **36px 的空壳标题栏**，一轮里出现两次，看上去像两张卡卡住了——
真机截图就是这感觉：内容全在里面，但外面两个大圆角框空着。

改法是把整套卡框从共用选择器里摘出来，**整套挂到 `.thinking-card[open]` 上**：
折起来是一行安静的灰字注脚（`padding: 4px 12px`、12.5px），展开才恢复成卡
（`padding: 9px 12px`、13px）。真机复验：展开态 `border 0.67px / 高 71px`，折回去 `0px / 24px`。

### 三、工具卡：原始回执折起来

那张卡真机量到 **398px 高**，而占掉绝大部分的是 360 的跳转链在回执里摊成的几百字符 base64；
真正给人看、给人点的来源清单被压在它下面。两种排版是**同一批数据**。

原始回执改成 `<details class="tool-raw">`（`.tool-sources` 之外的第二份排版），
展开时三角旋转 90°。**判定是条件的**：

- 有来源清单 ⇒ 折（同一批数据两种排版，清单该在前）；
- 没有清单 ⇒ **不折**（「联网搜索失败：……换个词重搜」那句话就是要读的内容，
  折起来等于把唯一有用的信息藏了）。

判据住 `utils/timeline.ts` 的 `rawFolded`，模板只读那个字段。守卫里有一条负向断言：
模板的 `:open` 上不许自己再判一次 `block.sources`（那是第二份判据）；
而 `.tool-sources` 自己的 `v-if="block.sources.length > 0"` 不在禁列——
它答的是「清单该不该渲染」，与「回执折不折」不是一回事。
（第一版守卫把这两件事一起禁了，**假红**，已收窄。）

### 四、门禁

`verify` → `VERIFY_EXIT=0`，**183 文件 2395 用例全绿**。
新增守卫 `agent-timeline-card-chrome.test.ts`（5 条，钉「折起来不是卡」这件事）——
这类判断是**纯视觉**的，判错不报错、工具链全绿，界面上只是一堆说不清别扭的框，
而 `.vue` 零自动化覆盖，只能读样式表源码钉形状。

变异 **12 条全真红，0 假红 0 漏网**（阶梯退回旧值 / 阈值倒置 / 地板去掉 / 模型名改
`display:none` / `rawFolded` 恒假恒真 / timeline 反解 URL / 模板自判 / 退回裸 `<pre>` /
`.tool-raw` 样式改名 / 思考摘要混回卡框 / 卡框从 `[open]` 摘掉）。

### 五、这一批自己踩的两个探针坑（都属于「探针与被测代码同错」）

1. **守卫读的是测试文件里写死的字符串**。第一条断言写成
   `expect(CARD_CHROME[0]).not.toContain("thinking-card")`，而 `CARD_CHROME` 是测试自己
   定义的常量——改 CSS 它当然不会红。变异 #11 直接漏网。
   改成真去 CSS 里扫选择器文本才咬得住。
2. **修完扫描点又多了一次假红**。`Math.max(lastIndexOf("}"), lastIndexOf("{"))` 会命中
   锚点自己那个 `{`，选择器被切成空串，断言**恒红**（未改动的代码也红）。
   只认 `}` 作规则边界才对。

两条合起来就是那件老事的又一次：**看到「红」先问它为什么红，未改动代码也红的红是假的。**


## 批次 5-⑫ · 把「联网搜索在本机从来说不上成功过」查到有数字（2026-10-06）

批次 5-⑩ 留了一条悬案：**搜狗能不能当源**，卡在一个还没量出来的数——「放行窗口有多长」。
后台探测器每 5 分钟只打一次，跑了 15 分钟、四次全拦（`sogou-window.log`），没量出来。

回头查那条矛盾时发现，问错了。5-⑩ 记的「搜狗此刻 200/680KB 无拦截」与 18:28 的
「5425 字节 antispider 页」，**是同一个 URL、同一套请求头，相差 40 分钟**——不是记错，
是搜狗的窗口**确实会开也会关**。所以「通不通得了一次」从一开始就不是决定性的问题。

### 一、先问更根本的那个：源链此刻是不是空的

| 源 | 实测 | 主进程会返回 |
| --- | --- | --- |
| DuckDuckGo | 8 秒超时 | `network` |
| 360 | 200 / 9845 字节 / 访问异常页 | `unavailable`（`isThrottled360Page` 认得出） |

**两条源此刻全败**，「这个功能在本机从来没成功过」是准确的。但同一时刻
`cn.bing.com` 是通的：100KB / 10 个 `b_algo` / 条条有标题有摘要。
于是真正的问题不是「搜狗行不行」，而是**「唯一活着的那家，此前是以一个错误理由被否掉的」**。

### 二、5-⑩ 拒掉必应的理由，有一半是错的

5-⑩ 的原话是：必应「词强时很准，词弱时整个结果页塌成首字的词典条目」，
而**「这条退化没有静态规则能预测」（活着 余华 准、余华 活着 小说 塌），所以不接**。

今天把规则量出来了。形状阶梯（每个期望词都刻意选了**能排除同名物**的词，见第四节）：

| 形态 | 查询 | 命中 | 首条结果 |
| --- | --- | --- | --- |
| 2 字 | 漕运 | 10/10 | 漕运_百度百科 ✅ |
| 4 字 | 徽派建筑 | 9/10 | 徽派建筑_百度百科 ✅ |
| 5 字 | 黑暗森林法则 | 10/10 | 黑暗森林法则_百度百科 ✅ |
| 6 字 | 三体黑暗森林 | 10/10 | 三体2：黑暗森林… ✅ |
| **带空格** | 三体 黑暗森林 | **10/10** | 三体2：黑暗森林… ✅ |
| 7 字 | 明代漕运制度 | 1/10 | 明朝（中国历史朝代） ❌ |
| 9 字 | 三体黑暗森林法则 | 0/10 | **三（汉语汉字）** ❌ |
| 问句 | 什么是黑暗森林法则 | 0/10 | **什么（汉语词语）** ❌ |

再把触发条件拆开（「专名」「长句」「问句」三者分开）：

| 查询 | 塌成 |
| --- | --- |
| 刘慈欣 / 三体刘慈欣 / 黑暗森林法则 | 正常（9–10/10） |
| 罗辑黑暗森林 | 罗（汉语文字） |
| 黑暗森林刘慈欣的设定 | 黑（汉语词汇） |
| 怎么写一个让读者害怕的反转 | 怎么（汉语词语） |
| 写一个让读者害怕的反转 | 写（汉语文字） |

**规则**：cn.bing 遇到没有现成强匹配的中文 query，就只拿**第一个词**去查，剩下全丢。
所以塌的不是「弱词」也不是「专名」，是**「没有现成条目的长句与问句」**。
两处与 5-⑩ 的旧说法相反：**空格是好事**（它是切词边界，「三体 黑暗森林」10/10），
**加引号确实无效**（「"刘慈欣三体黑暗森林"」照样塌）。

**要改写的是那句「没有静态规则」**：边界看起来是可预测的——
≤6 字连续名词短语、或 ≤2 个空格分隔词 ⇒ 可用；≥7 字连续、或以疑问词开头 ⇒ 塌。
所以否掉必应的**理由**从「不可预测因而不可信」变成「**能用，但只在关键词形态下能用**」。
能不能用是一回事，**能不能预测**是另一回事，后者才是当初不敢接的理由。

> ⚠️⚠️ **这段结论在批次 5-⑬ 被自己推翻了，两条都错。** 记在这里免得下一个人照着它去接源。
>
> **「空格是好事」——错。** 同为两个空格分隔词：「三体 黑暗森林」10/10 好使，
> 「黑暗森林法则 详细解释」只有 22%，塌成「黑暗（汉语词汇）」。空格不是机制。
>
> **「≤6 字可用、≥7 字塌」——也错。** 同内容逐字加长度出来：
> 「黑暗森林法则是怎」8 字 14% 全塌，而「徽派建筑的特点是什么」**10 字** 67% 好使。
>
> 起作用的更像是**拆词后头一个词有多高频**（黑暗/三/罗/怎/什么 → 字典条目压倒一切；
> 徽派建筑/漕运 → 不拆散，照常有专页）。这条规律**没有可执行的判据**。
>
> 所以 **5-⑨ 那句「没有静态规则」在实质上是对的**，5-⑫ 推翻得太快。
> 5-⑬ 最终的做法不是预测，而是**测完再判**：结果进来算一遍二元组覆盖率，
> 低于阈值就如实说没搜着，绝不把词典条目当来源递出去。

### 三、频控窗口：这才是本来想问搜狗的那个数，换了对象

形态固定成**已知可用**的 5 字查询（黑暗森林法则）连打 15 次：
**14 次 10/10**，只有第 6 次坏了一次，之后第 7–15 次全部恢复。
真窗口是单调的（好到 N 然后全坏），偶发一抽不是窗口。

所以必应此刻**没有可观测的连续频控窗口**——而一轮里模型可能连搜两三次（5-⑩ 刚修好的那条路径）。

### 四、这一批我又把自己骗了三处（全是同一族）

1. **拦截判据自己有毛病**：正则里含裸词 `验证`，于是头条 2MB、夸克 688KB 被标成「拦截」。
   没人会用 2MB 挡人。收紧成只认 antispider/访问异常/验证码/人机验证/captcha 之后，
   头条才露出真身——**1.9MB 的真页面，但一条可解析结果都没有**（只有 `profile.zjurl.cn` 的日期）。
2. **期望词过宽，自己判自己过**：`读者害怕 反转 写法` 我判 10/10「✓可用」，
   可标题是「读者（读者出版传媒股份有限公司主管主办的期刊）」「读者-全部作品在线阅读」——
   搜的是**《读者》杂志**，因为我把「读者」放进了期望词。`恐怖小说 反转技巧` 判 8/9「✓」，
   搜出的是恐怖**电影**大全。判据必须能排除同名物。
3. **两个变量缠在一起**：连打窗口那轮用的 query 是「民国军阀混战 战术」，
   带空格、**本身就是会塌的形态**，于是 15 次里 12 次「命中 0 条」，
   我的 `firstBad` 顺理成章报出「连打窗口 ≈ 0 次」。
   那是**形态问题被记成了频控**，差点把这个源按错误的理由否掉——与 `probe-360-recover.mjs`
   那轮「杀了没杀、验的其实是旧进程」是同一类错误。

### 五、此刻各源的真实状态（2026-10-06 晚）

| 源 | 状态 | 判定 |
| --- | --- | --- |
| DuckDuckGo | 8 秒超时 | 不接 |
| 360 | 200 / 9845 字节访问异常页 | 不接 |
| 百度 | 1438 字节反爬页 | 不接 |
| 搜狗 | 15 分钟四次全拦；内容质量仍未验 | 不接 |
| 头条 | 1.9MB 真页面，0 条可解析结果（JS 渲染） | 不接 |
| 夸克 | 688KB → 1223 字节，窗口比搜狗还紧 | 不接 |
| Mojeek / Yandex / DDG Lite | 403 / 14KB / 超时 | 不接 |
| **必应 CN** | **通；10 条可解析；边界已量化；15 连打无窗口** | **待产品决定** |

**这一批没有动源链**，`WEB_SEARCH_SOURCES` 仍是 DuckDuckGo → 360，
运行时验证仍是零可用源（所以「从来说不上成功过」这个结论**此刻依然成立**）。

留给用户的产品决定只有一个：**要不要接必应，以及要不要在查询侧把长问句压成关键词**。
后者不是零成本——它要么改模型侧的工具描述（靠模型自觉发关键词），要么在源里做整形
（那会动回执里那句 query，得如实告诉模型用的是哪个词）。
按 5-⑩ 立下的规矩，**加源是产品决定，不在这一批的范围里**，所以只把数字摆出来。


## 批次 5-⑬ · 把必应接进源链：用「不预测、只测量」替掉「不可预测、故不接」（2026-10-06）

用户回「继续」，上一批那条产品决定就这么批下来了：**接必应**。

### 一、先试那条看起来最省事的路：把长问句改写成关键词 —— 全废

四种候选，拿六个**这个产品真会问的**问题跑：

| query | S0 原样 | S1 去疑问词 | S2 截到 6 字 | S4 取首分句 |
| --- | --- | --- | --- | --- |
| 怎么写一个让读者害怕的反转 | 8% ✗ | 0% ✗ | 0% ✗ | 8% ✗ |
| 什么是黑暗森林法则 | 13% ✗ | **100% ✓** | **100% ✓** | 13% ✗ |
| 刘慈欣三体黑暗森林的设定是什么 | 0% ✗ | 0% ✗ | 0% ✗ | 0% ✗ |
| 明代漕运制度是怎么运作的 | 9% ✗ | 10% ✗ | 20% ✗ | 9% ✗ |
| 民国军阀混战的真实战术 | 10% ✗ | 10% ✗ | **100% ✓** | 10% ✗ |
| 科幻小说常见的世界观设定有哪些 | 7% ✗ | 9% ✗ | 20% ✗ | 7% ✗ |
| **通过** | 0/6 | 1/6 | 2/6 | 0/6 |

失败的样子一眼可见：S2 截到 6 字对「民国军阀**混战**」「黑暗森林**法则**」这样的
**自成词组**的前缀有效，对「怎么写一个读者害怕的反转」就截出「写一个让读者」、
对「科幻小说常见的世界观设定有哪些」就截出「科幻小说常见」——**半截话**。
**盲截断是掷硬币**，正则改写这条路到此为止。

### 二、改走另一条：不预测，只测量

不试图在查询侧猜，而是**结果进来之后量一遍**。

判据是 **query 二元组覆盖率**——query 的相邻二字组，有多大比例出现在前十条结果标题里。
挑它的三条理由：它**只读 query 原文和引擎给的标题**，不碰任何整形逻辑；
它不是「期望词列表」那种能被自己放词骗过去的判法；
而「引擎答的是不是我的问题」本来就是这件事的语义。

**判据本身先证伪再用**：拿已经量过答案的页面跑一遍，好的最低 75%、坏的最高 11%，
分得开才敢往下走。（后来补测到 18 条，分布见第五节。）

落成两件事：
1. `bingSource` 里 `coverage < 阈值` ⇒ 判 `empty`，**结果一条都不递出去**，
   并带一句 `hint` 说明「结果几乎不含你的字」；
2. 系统提示词与工具清单都改成要求模型**用 2–4 个关键词发 query**——
   抽关键词这件事 LLM 比正则强得多，这正是把活派给擅长它的一方。

### 三、真机撞出来的两处，一处是产品、一处是桩

**① 塌方原因透不出去。** 真机第一轮，桩发的是整句问句，必应塌方了——
可 `empty` 分支在源链里被 `continue` 掉了，那句原因根本没机会浮出去，
用户只看到「搜索源都能用，但没搜到「黑暗森林法则是什么」的相关结果」。
**那句话听起来像「这话题没资料」**，于是模型换个话题重试，而不是把问句压成关键词。

修法：`SourceAttempt` 的失败分支开一个可选 `hint` 字段，
源链在**全链 empty 且没有源坏掉**时优先透出它。
不用字符串去比对「页面上没解析出结果」——那会造出散在两处的第二份真身。

**② 桩把第一轮的资料整个忘了。** 桩的收尾只从**最后一条**回执里摘来源键，
而第二次搜索正好失败，于是它写「这一轮没搜到可用的来源」——
第一轮明明已经拿到 10 条。真实模型看得见这一轮的每一条工具回执。
改成扫这一轮全部 tool 回投，并补上那条夹具（原来的 `searchedTwice` 两次用同一份回执，
「第一次成功、第二次失败」这条真实路径一直**没有覆盖**）。

### 四、又一次自我推翻：5-⑫ 那条「可预测边界」也是错的

接进来之后量「桩追加限定词」那一下，量出一条跟 5-⑫ 冲突的东西：

| query | 覆盖率 | 首条 |
| --- | --- | --- |
| 黑暗森林法则（5 字） | 100% | 黑暗森林法则_百度百科 ✅ |
| 三体 黑暗森林（6 字 + 空格） | 100% | ✅ |
| 黑暗森林法则 详细解释（9 字） | **22%** | 黑暗（汉语词汇） ❌ |
| 黑暗森林法则 简介（9 字） | 14% | 黑暗（汉语词汇） ❌ |
| 三体 黑暗森林 罗辑（9 字） | 0% | 三（汉语汉字） ❌ |

**同形状相反结果**：「三体 黑暗森林」两个词好使，「黑暗森林法则 详细解释」两个词却塌
——所以 5-⑫ 说的「空格是好事」是错的。

那就再验一次「是不是总字数」——**同内容逐字加长**，内容不变、只有长度在变：

| 字数 | query | 覆盖率 | 首条 |
| --- | --- | --- | --- |
| 6 | 黑暗森林法则 | 100% | ✅ |
| 8 | 黑暗森林法则是怎 | **14%** | 黑暗（汉语词汇） ❌ |
| 11 | 黑暗森林法则是怎样的呢 | 10% | ❌ |
| 4 | 漕运制度 | 100% | ✅ |
| 10 | 漕运制度是怎样运作的 | 33% | 漕运_百度百科 |
| 4 | 徽派建筑 | 100% | ✅ |
| 7 | 徽派建筑的特点 | 83% | ✅ |
| 10 | 徽派建筑的特点是什么 | **67%** | 徽派建筑_百度百科 ✅ |

**长度也不决定**：8 字全塌的旁边坐着 10 字好使的。
起作用的更像是**拆词拆出来的头一个词有多高频**——黑暗/三/罗/怎/什么 会把字典条目顶上来，
徽派建筑/漕运 不拆散、照常有专页。这条规律**没有可执行的判据**。

所以：**5-⑨ 那句「没有静态规则能预测」在实质上是对的，5-⑫ 推翻得太快。**
但 5-⑬ 的做法并没有因此退回「不接」——**不再试图预测，改成测完再判**。
这恰好是闸门存在的理由：既然预测不了，那就量；量到不对就不递。

（代码注释与 5-⑫ 那节文档都已就地更正，标了「这两条都错」，免得下一个人照着错的结论接源。）

### 五、阈值 0.3 是照 18 条实测定的

18 条样本（首条对题 vs 塌成词典）：

- 首条对题：100 / 100 / 100 / 100 / 83 / 67 / 33 / 30 %
- 塌成词典：22 / 14 / 14 / 11 / 10 / 8 / 0 / 0 / 0 %

分界落在 22 与 30 之间，取 **0.3**。不取中点是因为**两边代价不对称**：
误杀一个好结果，用户看到的是「换个说法再搜」，顶多少搜一次；
放过一个塌方，模型会把「黑暗（汉语词汇）」当资料写进小说。
**宁可空手，不递错货**——贴着「对题」那一侧的边走。

源链顺序：**DuckDuckGo → 必应 → 360**（必应排在 360 前面，是因为它给的是干净的直链，
而 360 给的是几百字符的 base64 跳转链——5-⑪ 量那张 398px 高的卡就是它撑起来的）。

### 六、真机端到端（两个场景，真出网，不注入夹具）

| 场景 | 发出去的 query | 结果 |
| --- | --- | --- |
| 关键词 | 黑暗森林法则 | **必应答上**，10 条来源，回执写「来源：必应（试了 2 个源）」，卡片标题「这次搜索找到 10 条来源」，前三条是黑暗森林法则_百度百科 / 知乎 / 三体wiki |
| 整句 | 黑暗森林法则是怎么来的 | 闸门两次都挡住，界面原话可见：**「搜到的 10 条几乎都不含「黑暗森林法则是怎么来的」里的字——这条查询被拆成了词义查询。换个说法：压成 2–4 个关键词再搜一次。」**，卡片上**一条词典条目都没有** |

模型收尾时引用的两个键 `[baike.baidu.com/828514-72e2]`、`[zhihu.com/308865032-d3de]`
在工具卡上**逐字存在**（对账差集为空）。

### 七、门禁

`verify` → `VERIFY_EXIT=0`，**184 文件 2422 用例全绿**（本批新增 27 条）。
新增 `web-search-bing.test.ts`（21 条）钉住 b_algo 解析 / 覆盖率闸门 / 塌方报 empty /
hint 透出 / 源链顺序；接线守卫两处（系统提示词与工具清单都要求用关键词——
这条守的是一个**会让功能整个废掉**的失效：模型要是继续发整句，闸门就一直响）。

变异 **12 条全真红，0 假红 0 漏网**：阈值降到 0 / 抬到 0.9 / 覆盖率恒 1 / 恒 0 /
塌方不带 hint / 源链不收集 hint / 必应挪到 360 后面 / 解析器改成扫全页 `<a>` /
提示词与工具清单各去掉那半句 / 桩不摘问句尾巴 / 桩只读最后一条回执。

### 八、这一批踩的坑（探针比产品错得多）

1. **变异脚本在同一次调用里先注入又立刻还原**，而 driver 把它当独立进程跑完再跑测试
   ——测试面对的永远是原文。12 条全报「漏网」，**全是假的**。
   拆成 `inject` / `restore` 两步（原件先落盘备份，还原只认备份）才测出真结果。
2. **探针找的是旧文案**。提示语改过一版之后，判据还在找上一版的字，
   于是报了个假的「闸门没透出」。
3. **事件字段读错**：报「谁答的」读了不存在的 `source` 字段，
   把「必应答上了」报成「没有必应答的」——真机上回执明写「来源：必应」。
4. **期望词过宽**：上一批的老坑，这里再踩一次的风险仍在（把「读者」放进期望词，
   《读者》杂志就 10/10 命中）。
5. **「长度效应」是我自己提的假设**，被自己下一轮的数据推翻——记在这里是因为
   「先提一个规律、再用数据证伪」这个动作本身是对的，**错的是没证伪就写进注释和文档**。

### 九、留给用户的一个发现（这一批没动它）

真机截图上撞到：**搜索失败时，工具卡右上角写的是「完成」。**
查下来这是**设计如此**——`doc-tools-host` 故意把「源都能用、只是没搜着」记成 `ok: true`
（模型据此去换关键词），卡片跟着显示「完成」。回执正文已经把真相说清楚了，
所以不算骗人；但「一次没搜着的搜索显示成完成」读起来仍然别扭。

改成三态（完成 / 未通过 / 没搜着）要动 contracts 的 `ok` 语义、timeline 与一批测试，
**这是产品决定，不在这一批的范围**，所以只记在这里。


## 批次 5-⑭ · 思考摘要与对话的体量（2026-10-06）

用户指着 5-⑬ 那张真机截图说「这个思考模式和对话模式不太好看」。
不猜，先把一轮**逐块量一遍**。

### 一、量出来的两个问题

**① 思考摘要折起来时一个字都没有。**

| 块 | 高度 | 折起时 summary 上的字 |
| --- | --- | --- |
| #1 thinking | **24px** | 「思考摘要」 |
| #3 thinking | **24px** | 「思考摘要」 |
| #5 thinking | **24px** | 「思考摘要」 |

`summary` 的子元素只有 `[svg, span]`——**摘要正文整段藏在折起来的身体里**。
5-⑪ 把折叠态改成了「一行安静灰字注脚」，形状对了，**内容忘了**。
一轮里三行一模一样的四个字，信息量加起来是零，看着像卡住了。

**② 一张工具卡 874px，吃掉对话区 70%。**

| 部位 | 高 | 占比 |
| --- | --- | --- |
| 卡片总高 | 874px | — |
| 来源清单 | 725px | 83% |
| └ 每条 | **69px × 10 条** | 摘要 42 + 打开 23 + 标题 17 |
| 卡头/参数/回执折叠件 | 149px | 17% |
| 对话区可视高度 | 1244px | 卡片占 **70%** |

**每条 69px、十条一模一样——没有一条特别长，是条数堆出来的。**
所以收条数比收摘要管用。用户那句问和模型那句答都被这张卡挤到看不见。

### 二、改了什么

**思考摘要**：`<summary>` 里加一行 `.thinking-peek`（读的就是 `block.text`，模板不自己截）。
显不显示全交给 CSS：`.thinking-peek { display: none }` +
`.thinking-card:not([open]) .thinking-peek { display: block }`——
展开时正文已经写着同样的字，summary 里不必再重复一遍。
那行字是单行省略（`white-space: nowrap` + `text-overflow: ellipsis`），
外加 `min-width: 0`——flex 子项不设这个就不肯收缩，会把 summary 顶宽。

**来源清单**：`utils/timeline.ts` 新增 `SOURCE_LIST_PREVIEW = 5`；
模板切成 `slice(0, SOURCE_LIST_PREVIEW)` 与 `slice(SOURCE_LIST_PREVIEW)`，
剩下五条折在「展开其余 N 条」里；摘要压成一行（`-webkit-line-clamp: 1`）。
条数住 utils 而不是模板：那个 5 是**为什么**（874px 的量出来的），模板只管照着切。

### 三、真机复量

| | 改前 | 改后 |
| --- | --- | --- |
| 工具卡总高 | 874px | **432px** |
| 清单高 | 725px（10 条） | 257px（5 条） |
| 每条 | 69px | **48px** |
| 折起的思考摘要 | 「思考摘要」 | 「思考摘要（已联网）先读一遍上下文，再决定动哪一段。」 |

真点三个折叠件：展开其余 5 条 → 卡片 432 → 689px（差值 257 正好是那五条）；
点开思考摘要 → 71px、summary 里那行字让位给正文；原始回执没被改坏（207px）。

### 四、这一批踩的坑（三处都在判据，都在探针身上）

1. **「展开前后都是 10 条」是空过**。判据数的是 `querySelectorAll('.source-list .source-open')`，
   而折起来的 `<details>` 里 children **照样在 DOM 里**——点之前 10、点之后 10，
   于是那条「十条一条不少」白过。真正判据是**卡片高度差**（432 → 689）。
2. **`getBoundingClientRect().height > 0` 判不出 `<details>` 里内容的可见性**。
   Chrome 对折起的 details 用 `content-visibility: hidden`——子元素**仍有布局盒**，
   rect 照样返回 257，于是「折着时可见」也报 true。改用 `checkVisibility()`。
3. **残留状态**：上一轮探针把折叠件点开了，这一轮第一下点的是「关」，
   于是量出「折起时已经 875px」。又是那条老教训——**toggle 型入口第一下可能是在关上次残留的状态**。

另有一条 CSS 自己的问题：`.source-snippet` 我写成了两条规则，
`ruleBlock` 只取第一条，守卫咬不到合并进来的那半截。合成一条。

### 五、门禁

`verify` → `VERIFY_EXIT=0`，**184 文件 2432 用例全绿**（本批新增 10 条）。

守卫加在 `agent-timeline-card-chrome.test.ts`（这类判断是纯视觉的，判错不报错，只能读源码钉形状）：
摘要那行字挂在 summary 上 / 折起才露 / 单行省略 / `min-width: 0`；
预览条数住常量、模板不许写死 `slice(0, 5)`；折叠件的条件与条数算法；摘要压行；折叠件观感对齐。

另在 `timeline.test.ts` 钉一条**跨进程不变量**：预览数必须小于回执上限，
否则「展开其余 N 条」永远是死代码。回执上限住在主进程那份里、渲染层 import 不到，
所以读它的源码把那个数取出来——**跨进程的不变量只能这么钉**。

变异 **9 条全真红，0 假红 0 漏网**：peek 展开时重复正文 / 折起时藏起来 / 不收成单行 /
去掉 `min-width: 0` / 摘要不压行 / 模板摘掉那行摘要 / 预览条数写死 5 /
折叠件不设条件 / 预览数顶到上限。


## 批次 5-⑮ · 工具卡的第三态：完成 / 没搜到 / 未通过（2026-10-06）

接着 5-⑭ 末尾那条没动的：一次没搜着的搜索，工具卡右上角写着「**完成**」。

### 一、为什么它当时是对的，现在还是不对

`doc-tools-host` 把「源都能用，只是这个说法没搜着东西」记成 `ok: true`——
**这没错**：对模型来说那是一条正常回执，它据此去换关键词，工具循环不该当报错。
可界面上只有 `ok` 一个字段时，那张卡与「搜到了」长得一模一样。

**空不是坏**。把 `ok` 改成三态（`done / empty / failed`）会让工具循环误以为要报错；
只留 `ok` 又让界面无从区分。所以是**第三种情形**——单开一个 `empty` 字段，
它只说「空」，不说「坏」。

### 二、跨了四层

| 层 | 改了什么 |
| --- | --- |
| `packages/agent-runtime/src/tools.ts` | `ToolOutcome` 加 `empty?: boolean` |
| `packages/contracts/src/agent-event.ts` | zod schema 加 `empty: z.boolean().optional()`（事件类型的唯一真身） |
| `packages/agent-runtime/src/tool-loop.ts` | 条件展开 `...(outcome.empty === true ? { empty: true } : {})`——**不能**写 `empty: undefined`，那会让老会话的 `"empty" in event` 判别翻转（`sources` 当初已经踩过） |
| `apps/desktop/src/main/doc-tools-host.ts` | 两处「跑了但没搜着」都带上 `empty: true` |
| `apps/desktop/src/renderer/src/utils/timeline.ts` | 归一成 `ToolStatus` + `toolStatusLabel()` |
| `AgentTimeline.vue` / `agent-pane.css` | 只读 `block.status`；`is-failed` / `is-empty` 两档 |

**判定与措辞都只住 `timeline.ts` 一处**：模板里写 `block.empty ? … : block.ok ? … : …`
就是第二份判据，改一边忘了另一边卡头就跟实际结果对不上。守卫里有一条负向断言专门守这个
（模板里不许出现「完成」「未通过」这两个字）。

### 三、真机三态

| 状态字 | 卡面类 | 底色 | 边框 |
| --- | --- | --- | --- |
| 完成 | 无 | 正常 alpha **0.52** | 中性 `rgb(230,228,235)` |
| **没搜到** | `is-empty` | alpha **0.34**（更淡） | 中性 |
| 未通过 | `is-failed` | `rgb(248,234,232)` 危险色 | 偏红 |

**「没搜到」刻意不涂错误红**：源是好的，只是这个说法没搜着东西——
涂成红的等于把「换个词再搜」说成「出错了」，而模型下一步动作恰恰是换词。
所以给的是比正常卡**更淡**的调子：一眼能分出「这张没结果」，又不会让人以为要处理故障。

### 四、门禁

`verify` → `VERIFY_EXIT=0`，**184 文件 2439 用例全绿**（本批新增 7 条）。

守卫钉住：归一三态、**失败优先于空**（顺序反了会把故障说成没结果）、
三个词各是什么、模板不自带词与不自己判 empty、模板按 status 上类、
「空」那档不含 danger 而「失败」那档仍然含、主进程**两处**都标了 empty。

变异 **8 条全真红，0 假红 0 漏网**：空优先于失败 / 归一恒为 done / 空态退回「完成」/
卡面类退回按 ok / 主进程漏标一处 / 事件层丢掉 empty / schema 去掉 empty / 空态涂成错误色。

### 五、这一批探针又读错一次

`document.querySelectorAll('[data-kind="tool"]')` 选到的是外层 `section.agent-block`，
而 `is-failed` / `is-empty` 加在里层的 `.tool-card` 上——于是六个类的读数全是 false，
差一步就要把「类没绑上」当成产品缺陷去改。状态字那次读对了（`querySelector` 会往下找），
所以「三样字都出现了」和「类全是 false」才会同时出现：**一个对一个错，才是最容易被当成真 bug 的组合。**


## 批次 5-⑯ · 把 5-⑭ 那两把尺子推广出去：量了，没改（2026-10-06）

5-⑭ 找到的两类缺陷都是**机器可测**的：零信息、块太大。所以这一批不靠眼睛扫，
把同两把尺子量到别的地方去。**结论是没有缺陷，本批零改动。**

### 一、通用的那把尺子太粗，只扫出噪声

扫章节编辑器 / 输入区 / 左右两栏，报回来的全是误报：

- 「零信息」报了 编辑 / 分栏 / 预览 / 保存到本机 / 关闭 / 联网搜索 / 直接动手 ——
  **每一条都有真标签**。判据是「文本 ≤5 字且带图标」，那根本不是缺陷信号。
- 「过大块」把 `editor-document` 705px / 78% 报了出来——
  **编辑器正文占满自己的面板本来就是设计**。

**判据太粗，扫不出东西。** 记在这里是因为它提醒下一批：通用扫描器必须先在**已知有缺陷的样本**上
验过它咬得动（5-⑭ 那种尺子是在一张 874px 的真卡上验的），否则扫一百个面也只是把噪声写进文档。

### 二、对话区的块间节奏：本来就匀

| 相邻块 | 空隙 |
| --- | --- |
| 你 → 思考摘要 | 18px |
| 思考摘要 → 工具卡 | 18px |
| 工具卡 → 思考摘要 | 18px |
| 思考摘要 → 工具卡 | 18px |
| 工具卡 → 思考摘要 | 19px |
| 思考摘要 → 答 | 18px |

**没有粘连、也没有断裂**（第 5 个 19 是亚像素累加的舍入）。**不改。**

### 三、提案卡：最要紧的那张，也是干净的

407px / 容器 821px = **50%**（对照：联网搜索卡改前是 70%）。卡内最高的几块
都是 24–29px 的正常行高，五个闸门按钮都有真标签。

**「批准按钮露没露全」**这条单独量过——因为它是这个应用唯一的写盘闸门：

> 窗口 902px、输入区顶边 **803px** ⇒ 对话区可见底边 803px；
> 五个按钮底边都在 **786px**，被压住 **0px**，**露全，不用滚动**。

第一版这条判据写的是 `br.bottom <= window.innerHeight`，报「在视口内」——
**量错了对象**：输入区就叠在窗口底部，按钮在 window 之内却可能被它整个压住。
「在视口内」和「看得见」不是一回事（与 5-⑮ 那次「一个对一个错」同类）。
截图里按钮紧贴画面底边，看着像被切——**那也是错觉**，改正判据后是 0px。

### 四、门禁

本批**零代码改动**，门禁维持 5-⑮ 的 `VERIFY_EXIT=0`（184 文件 2439 用例）。

---

## 批次 5-⑰ · 来源清单在窄窗口下把标题挤没了（2026-10-06）

### 一、缺陷：键写死占一半，清单一窄两头一起废

`.source-key`（来源键）是 `max-width: 52%`——**不管清单多宽，键恒定吃掉一半**。
真机读数（1440 起三栏全开，逐步缩窗口）：

| 视口 | 清单内容盒 | 标题宽度 | 来源键宽度 |
| --- | --- | --- | --- |
| 1440 | 535px | 258–379px | 完整 |
| 1200 | 331px | **149px**（约 8 个字） | **168 / 需要 193，被截** |
| 1100 | 231px | **101px（约 5 个字）** | 164 / 需要 193，被截 |

键是模型真的在引用的那个身份（5-⑮ 量过），截了就等于这条认不出是哪个来源；
键占掉的那一半又直接转嫁给标题。**两头一起废，那一行就等于没了。**

窄谷的成因也量清楚了：`1024–1200` 之间 `desktop-shell` 还带着 `is-right-collapsed` 的反面——
**右栏那 490px 还没收，对话区已经被挤到 324px**。

### 二、第一版改法有两个错，都是「看着生效了其实没生效」

**① 容器查询块写在了它要覆盖的规则前面。**
容器查询只是「条件成立时用这一份」，**不加分**——同特异度下仍是后来者赢。写在前面时：

- `align-items: flex-start` 被下面的 `baseline` 吃掉
- `max-width: 100%` 被下面的 `52%` 吃掉
- 只剩一条孤零零的 `flex-direction` 落地

真机症状正是 1200px 那档「看着像命中了，键却仍被截在 52%」。
**这类半残态比完全不写更难认**：有个别属性生效了，读数是「部分改善」。

**② 阈值 330px 是从现象反推的，不是从边界量的。**
当时的理由是「309px 时标题只剩 149px」——那是**现象**不是边界。
补测 1200–1440 才发现：**内容盒 477px（视口 1360）横排就已经在截键 1/5、截标题 2/5**，
而 331–503 这整段**没有一条规则管**。阈值定低了一倍多。

### 三、阈值改成 A/B 量出来的 520px

容器查询命中与否最终就等于「用不用竖排那份声明」，所以不必反复 rebuild 试阈值——
运行时插一张同选择器的 style 就造得出竖排态，量的仍是真 DOM 真 CSS 的计算结果。
右栏钉在展开态（窄谷场景正是「右栏还没收」那一段），十条真实长度的来源取前五条：

| 清单内容盒 | 横排 截键/截标题 | 竖排 截键/截标题 | 卡高 |
| --- | --- | --- | --- |
| 623px | 0/5 · 0/5 | 0/5 · 0/5 | 463 → 549 |
| 583px | 0/5 · 0/5 | 0/5 · 0/5 | 463 → 549 |
| 543px | 0/5 · 0/5 | 0/5 · 0/5 | 463 → 549（**打平**） |
| 503px | 0/5 · **1/5** | 0/5 · 0/5 | 463 → 549（**竖排开始更好**） |
| 463px | **2/5 · 2/5** | 0/5 · 0/5 | 463 → 549 |
| 423px | 2/5 · **3/5** | 0/5 · 0/5 | 463 → 549 |
| 377px | 2/5 · 3/5 | 0/5 · 0/5 | 463 → 549 |
| 357px | **4/5 · 4/5** | 0/5 · 0/5 | 463 → 549 |
| 317px | **5/5 · 5/5** | 0/5 · 1/5 | 463 → 549 |

分界落在 **(503, 543]**：543 打平，503 竖排赢。**阈值取 520**，两侧各留十几像素余量。
横排在任何宽度上都没赢过截断，唯一优势是每条省 17px（48 vs 65，卡高 463 vs 549）——
够宽的时候这笔省下来的地方留给对话，比让一条来源占两行划算（5-⑭ 刚为此砍掉一半条目）。

### 四、改完的实测（真 CSS，无注入）

| 视口 | 内容盒 | 排布 | 截键 | 截标题 |
| --- | --- | --- | --- | --- |
| 1440 | 557px | 横排 | 0/5 | 0/5 |
| 1360 | 477px | 竖排 | 0/5 | 0/5 |
| 1200 | 331px | 竖排 | 0/5 | 0/5（改前 4/5） |
| 1100 | 231px | 竖排 | 2/5 | 1/5（改前 4/5） |

1100 档还剩 2/5 条键被截——那是**清单本身只有 227px**，而那两条键需要 307px，
容器装不下，ellipsis + `title` 全量地址兜底。这一档不是缺陷了。

### 五、探针这一批又读错三次

**① 右栏是「只收不展」，量到的根本不是同一个场景。**
`layoutStore` 的自动策略只有收缩分支：上轮探针末尾停在 1024 触发过收起，这轮再量
就全程是收起态，内容盒 645–821px，一格都没进过窄谷。**差异静默、读数漂亮、量的是别的东西。**
窄谷场景必须先把右栏钉在展开态再量。

**② 让网络抖动决定能不能量。**
第一次复量连跑两轮，第二轮源链真没出源（5-⑬ 的现实：DDG/必应/360 时好时坏），
卡片压根不存在。**布局是样式问题，不该接进「搜不搜得到」这个无关变量**——
改成往 store 的事件流里塞一条同形状的 `tool-call`：真组件、真 CSS、真 `buildTimeline`，
只是不经过搜索那一段。

**③ 探针把「不命中」报成了「半残」。**
判据写成「`flex-direction` 不是 column ⇒ 有缺陷」，于是 1060/1024 这两档**本来就该不命中**
却被报成缺陷。判据必须与「阈值有没有命中」绑在一起——
**假缺陷和假漏网一样贵**，都会让人去改一个本来正确的实现。

### 六、守卫与变异

新增 `apps/desktop/src/renderer/src/components/agent-sources-narrow.test.ts`（7 条），钉三件事：
① `.tool-sources` 自己声明 `container: sources / inline-size`（不声明查询永远不成立）；
② **`@container` 块必须排在 `.source-key` / `.source-open` 基础规则之后**（这次真犯的错）；
③ 阈值落在量测带 **[503, 543]** 内（测试里不写死 520，只钉「落在量到的带里」——
免得改阈值的人把数字对齐到断言上、却从没重新量过）。

**变异 12 条全真红，0 假红 0 漏网。** 其中两条（M5 搬块 / M12 挪模板）第一轮报的是
「漏网」，其实是**注入根本没发生**：锚点 `border-radius: 8px` 与 `<ol class=source-list>`
在文件里都不唯一，锚点校验当场拒跑，测试面对的是未改动代码。
**「全部整齐」的结果要先怀疑证据有没有到位**，而不是先改判据。改成按位置定位后两条都真红。

### 七、门禁

`VERIFY_EXIT=0`，**185 文件 2446 用例**（5-⑯ 的 184/2439 → 新增 1 文件 7 用例）。
截图：`shot-517-1440.png`（宽窗横排）、`shot-517-1100.png`（窄谷竖排）。
---

## 批次 5-⑱ · 输入区工具栏在窄窗口下整排叠在一起（2026-10-06）

### 一、缺陷：不是空间不够，是分配与地板都算错了

真机（视口 1024、对话区被挤到 284px）截图里，模型名、关闭、联网搜索、工具、命令、
直接动手、权限档的图标与文字**互相压住**，整条工具栏读不出来。量到：

| 视口 | 容器 | 左端现宽 / 内容需要 | 矩形相交 | 内容溢出框外 |
| --- | --- | --- | --- | --- |
| 1320 | 574px | 正常 | 0 处 | 0px |
| 1280 | 534px | 正常 | **1 处** | **7px** |
| 1200 | 454px | 180 / 238 | **4 处** | **58px** |
| 1100 | 354px | **80** / 238 | **10 处** | **158px** |
| 1024 | 284px | **10** / 238 | **17 处** | **228px** |

两条成因，都不是「窄」：

**① 左端在收缩里没有权重。** `.composer-toolbar-left` 是 `flex: 1 1 0`，
而 flex 的收缩权重 = `flex-shrink × flex-basis`——**basis 为 0，权重就是 0**。
可它又是唯一可缩的大项，于是缺额全砸在它头上：容器 354 时被压到 **80px**（1024 时 10px），
而它要 238px。内容画到框外，压在右端与兄弟 chip 上。

**② 模型名的地板比它自己所在格子的地板还大。** 5-⑪ 给 `.composer-chip-label`
加的 `min-width: 4.5em` 是为了「别让模型名缩成 5.6px」（那条防线是对的），
但 `.composer-chip` 自己的地板是 44px——**4.5em ≈ 66px > 44px**。
于是这枚 chip 的内容永远比地板宽，label 永远画到框外。
「加了地板」反而制造了溢出，这是本批最反直觉的一处。

### 二、修法两级，门槛都是量出来的

| 容器 | 改前 相交/溢出 | 改后 |
| --- | --- | --- |
| 694 | 0 / 0 | 0 / 0（未命中，一行不变） |
| 574 | 0 / 0 | 0 / 0（未命中，一行不变） |
| 534 | **1 / 7** | **0 / 0** |
| 494 | 2 / 18 | 0 / 0 |
| 454 | 4 / 58 | 0 / 0 |
| 394 | 8 / 118 | 0 / 0 |
| 354 | 10 / 158 | 0 / 0 |
| 284 | 17 / 228 | 0 / 0 |

- **≤620px 改分配**：左端 `flex: 0 1 auto`（可缩、可不吃）、chip 守自己的 28/44 地板、
  模型名 `min-width: 0` + `max-width: 6em`（与其余标签一样出省略号）。
- **≤560px 换行**：左端地板 188 + 右端地板 112 + 间隙 8 = 308px，534 那档离放不下还差 226px
  却已经在压——真正卡住的是「模型名 + 右端标签」同时要宽。所以**宁可两行，不可叠字**：
  工具栏 `flex-wrap: wrap`，左端独占一行，右端靠右。

2026-10-05 用户那条「控件一个不藏，只藏文字」在两级都仍然成立：
五枚 chip 的图标与下拉三角全在，模型名在 354/284 两档仍有 63px / 24px 可读。
真机复验（**右栏钉开**这个最坏场景）1024–1440 八档全绿：相交 0、溢出 0、发送键 30px。

### 三、两版候选都是「修好了 A，弄坏了 B」

**第一版 `flex: 1 0 auto`**：左端抢到 316px，右端被压成 **0px**——发送键整个消失。
**比叠字更糟。** 而当时那条判据只查「有没有重叠」，查不出「发送键没了」，
所以它一度看起来是绿的。**修法必须连同「该保留的东西还在不在」一起量。**

**第二版只改分配**：左端仍溢出 136px，因为模型名还被 `max-width: 9em` 撑着
（那 320px 里 160px 是它）。补上「模型名收口到 6em」才干净。

两条都不是靠推理收敛的，是靠**逐档 A/B**：把候选声明注进运行时同一张 style，
量同一个页面两次。容器查询命中与否最终就等于「用不用这份声明」，所以这是等价开关，
不必为每个候选值 rebuild 一次。

### 四、探针这一批读错两次

**① 判据只比同层兄弟 ⇒ 假阴性。** 第一版量 1100px 报「相交 0 处、无溢出」，
而截图里整排明明叠着——压住的是**跨层**的元素（chip 的 label 溢出到下一个 chip 上）。
改成**全树两两比**，并排除「一方是另一方的祖先/后代」这种天然重叠，缺陷才现形。

**② 注入的候选没带 `@container` 条件 ⇒ 探针把门拆了。** 量到「1440 也变两行」，
第一反应是修法有副作用，其实是**注入态在所有宽度都生效**——
门槛本来就是这条修法的一部分，不带条件就等于把它测没了。
上一轮同理：≤420 的门槛在容器 454 处压根没触发，于是「1200 还叠着」这件事**根本没被测过**。

**③ 又一次：右栏「只收不展」。** 不把它钉在展开态，复验到的就是缺陷不出现的场景
（窗口一窄右栏自动收起，对话区反而变宽）。5-⑰ 踩过，这一批复验时先钉开再量。

### 五、守卫与变异

新增 `apps/desktop/src/renderer/src/components/composer-toolbar-narrow.test.ts`（10 条），钉四件事：
两级门槛在且换行级更窄、修法是「可缩可不吃」而不是「不吃」、顺序在被覆盖的规则之后、
以及**不许出现已知的坏写法**（左端 `flex: 1 0 auto`——真量过，右端会变成 0px）。

**变异 12 条全真红，0 漏网。** 第一轮 M1/M2 报的是「注入失败」而不是漏网：
锚点 `    flex: 0 1 auto;` 在既有的 ≤380 级里出现两次，锚点校验当场拒跑。
连注释一起取才唯一。**这个纪律两次救场**（5-⑰ 的 `border-radius: 8px`、这次的 `flex`），
凡是「结果整齐得可疑」，先怀疑证据有没有到位，再改判据。

### 六、门禁

`VERIFY_EXIT=0`，**186 文件 2456 用例**（5-⑰ 的 185/2446 → 新增 1 文件 10 用例）。
截图：`shot-518-composer-1100.png`（改前那团叠字）与改后同宽度对照。


---

## 批次 5-⑲ · 先把尺子校准，再拿它扫全窗口（2026-10-06）

### 一、5-⑯ 欠下的那件事：这批的产物是**判据**，不是修复

5-⑯ 用两把尺子扫出 8 条噪声，结论是「通用扫描器必须先在**已知有缺陷的样本**上验过它咬得动」。
这一批照着做：写四类检测，先校准，再上扫。**校准就把第一版判据否掉了两次。**

### 二、第一版判据在好态与坏态上读数一样——等于没测

| | 好态 @1440 | 坏态 @1440 | 好态 @1100 | 坏态 @1100 |
| --- | --- | --- | --- | --- |
| d1 跨层相交 | 49 | **49** | — | — |
| d2 文字被吃 | 70 | **70** | — | — |
| d3 内容出框 | 3 | 4 | 3 | 10 |
| d4 出容器 | 0 | 0 | 0 | 0 |

两条判据各错一处，都不是「阈值没调好」，是**量的不是那件事**：

- **d1 把 `.agent-block` 当成了控件**。它是滚动列表里的一块，与底部固定输入区的重叠是
  结构性的，不是缺陷。49 条里大半是这个。改成只比 `button` / `[role=button]` / `a` / `input` /
  `select` / `textarea` 这类真控件。
- **d2 量的是「元素窄」不是「文字被吃」**。`span「章节」w:27 need:27` 根本没截断，照样报出来。
  信号是**被裁**（`scrollWidth > clientWidth`），不是窄。

改完：好态全零，坏态 d1=2 / d2=1 / d3=10 / d4=6，**四类都咬得动**。

### 三、d2 的阈值又调了一轮，理由是「它漏掉了本该抓的那一个」

0.15 那个比值太严，5-⑰ 那个已知缺陷（标题 101px / 需要 376px，比值 0.27）**根本报不出来**。
检测器漏掉目标比它噪声大更贵。放到 0.5 之后坏态报出 1 条（139 / 336，比值 0.41）。

调这一轮时踩到一个更根本的坑：**夹具内容太短，样本不够坏**。
第一版夹具用「黑暗森林法则_百度百科」这种真必应标题，坏态下也只裁到 139px——
那本来就不算缺陷，于是「检测器没响」被读成了「没问题」。换成真必应那种 72 字的长标题才校准上。
**样本不够坏，尺子就量不出东西**——与 5-⑰ 里「阈值从现象反推」是同一类错误的另一个马甲。

### 四、扫完的结果：四档视口 × 九种状态，除已知降级外全零

状态覆盖：会话、提案卡在场、展开「其余 N 条」、权限档弹层、模型选择、章节树展开、
树节点操作菜单、导出对话框、设置页。视口 1440 / 1280 / 1100 / 1024。

| 视口 | d1 | d2 | d4 | 判读 |
| --- | --- | --- | --- | --- |
| 1440 | 0 | 0 | 0 | 干净 |
| 1280 | 0 | 0 | 0 | 干净 |
| 1100 | 0 | 0 | 0 | 干净 |
| 1024 | 0 | 1 | 0 | 模型名省略成「moche…」，**已知降级**（图标与 title 都在） |

d3 恒定 3 条（小圆环 SVG 的盒比文字高 2px，四档都有、与状态无关），算基线噪声。

**中途两条 d1 命中经核实是设计**：模型选择弹层叠在对话区上、树行的操作钮落在行按钮上。
判据分不开「浮层盖住内容」与「兄弟控件叠在一起」，于是让判据分得开——
**带 absolute/fixed 祖先的一律不算**。改完这两条消失，而坏态该报的 2 条一条没少
（复校准过：好态 0、坏态仍 2）。

### 五、探针这一批又读错三次

- **判据只比同层兄弟 ⇒ 假阴性**（5-⑱ 已记，这里是它的一般形式）。
- **上一轮留下的设置页把工作区整块换掉**，后面几个状态全部「找不到元素」。
  症状像「控件没了」，差点当成产品缺陷——每轮开头 `Page.reload` 复位。
- **`env()` 改不了**：`Emulation.setDeviceMetricsOverride` 改得了 `100vw`，
  改不了 `env(titlebar-area-x/width)`（那是真窗口的窗控叠加区）。emulated 1280 那档量到的
  右内边距是 **0px**，现实中不存在。**凡是用 `env()` 的布局，只能在真窗口上量。**

---

## 批次 5-⑳ · 右栏栏头排不下：两枚按钮压在系统窗控上（2026-10-06）

### 一、缺陷：缺 79px，代价是按钮点不到 + 面包屑从不显示

真窗口（1440×940，dpr 1.5）实算：

```
右栏 490 = 栏头 489 = 左 15 + 内容 328 + 右 146（为系统窗控预留）
操作区 407 = 74（保存状态）+ 288（九枚 32px 按钮）+ 45（九个 5px 间隙）
                                  ⇒ 缺 79px
```

`.editor-header-actions` 是 `flex: 0 0 auto`，整行不可收缩。多出来的 79px 全砸在左端：

- **面包屑宽度 0px**——「真删复验书 / 章节 / 开局」这条路径从来没显示过（它需要 127px）。
- 右端三枚按钮越过内容盒右沿，其中「伏笔台账」[1314,1346]、「收起文本内容栏」[1351,1383]
  正落在系统窗控带 x ∈ [1303, 1440] 里，**压在最小化、最大化上**。

成立区间：右栏 410–570px，约 1200–1680px 视口。1440 笔记本正中。
到 1920 视口右栏 650，面包屑出现 72px，一切正常。

顺带查清两件**不是**缺陷的：
① `.editor-header button` 有 `no-drag`，按钮点得动（CDP 真点了「收起文本内容栏」，面板确实收起）；
② `html[data-theme] :where(… .save-state.is-dirty)` 的 `:where()` 贡献 0 特异度，
压根压不过 `.save-state.is-dirty`——它**一直没生效过**。这次换类名时顺手把颜色放在压得住的那一层。

### 二、修法：去掉栏头那份重复的保存状态（用户裁定）

保存状态在页面上**显示两遍**，读的是同一个 `saveStateText`：栏头一份，底栏 `.editor-save-status` 一份。
去掉栏头那份正好腾出 74 + 5 = **79px**，与缺口分毫不差。

真机复验（真窗口，右栏钉开）：

| | 改前 | 改后 |
| --- | --- | --- |
| 操作区缺额 | 79px | **0px** |
| 落在窗控带里的按钮 | 3 枚 | **0 枚** |
| 模板里 `saveStateText` | 2 处 | **1 处** |
| 面包屑 @490 右栏 | 0px | 0px（**已知代价**，用户知悉） |
| 面包屑 @700 右栏 | — | 127px ✔ |

告警色没有随副本一起丢：把它搬到剩下的那一处，
真机量到 `dirty` 从 false 翻到 true 时 color 由 `rgb(37,31,51)` 变成 `rgb(194,139,53)`。

### 三、被钉住的断言改成钉新决定，不是改松

`document-pane-wiring.test.ts` 原本断言 `saveStateText` 在模板里出现 **2 次**，注释写着「头与脚读同一个值」
——保存状态显示两遍是**有意为之、且有守卫护着的**，不是疏忽。所以这一条要跟着裁定改：

- 计数从「恰好 2 次」改成「**恰好 1 次**」，方向反过来钉：不许再冒出第二处。
- 追加「栏头不许再有 `class="save-state"`」。
- 追加「底栏那一处必须带 `is-dirty`」——副本去掉时告警色不许跟着消失。
- 追加「告警色的 CSS 规则必须在」（类名本身不产生颜色，只钉模板的话删掉那条 CSS 断言照样全绿）。
- 追加「栏头按钮数 ≤ 9」，把 79px 那笔账钉成回归线。
- 原来那条 `toContain("{{ saveStateText }}")` 删掉了：它是被栏头那份满足的，而剩下那处
  `{{ book.notice || saveStateText }}` 已被另一条断言盖住，且盖得更严（连 notice 优先一并钉）。
  **不是把保证改小，是把同一份保证换个更强的写法。**

同时清掉 `editor-pane.css` 与 `theme-runtime.css` 里已成死规则的 `.save-state` / `.save-state.is-dirty`。

### 四、断言差点被自己的注释反咬

刚删完规则、并在原地留了一段「为什么删」的说明，`expect(css).not.toContain(".save-state.is-dirty")`
立刻红——红的正是那句注释。`styleSource` 给的是原文。
正解不是在校验里再抄一份剥注释的正则（那是剥法的第二份实现，铁律 6），
而是给读取器加一个出口 `strippedStyleSource()`。

### 五、守卫与变异

`document-pane-wiring.test.ts` 29 → **31 条**。**变异 10 条全真红，0 漏网**：
重复显示加回来 / 底栏丢掉 `is-dirty` / 底栏整处删掉 / 退回字面量 / 删掉颜色规则 /
告警色换成正文色 / 死规则加回来 / theme 加回来 / 栏头加第十枚按钮 / 读取器自己不剥注释。

### 六、门禁

`VERIFY_EXIT=0`，**186 文件 2458 用例**（5-⑲ 的 186/2456 → 新增 2 条断言）。
截图：`shot-519g-real-header.png`（改前栏头，无面包屑）、
`shot-520-header-wide.png`（右栏拖到 700，面包屑出现）、
`shot-520-dirty-footer.png`（dirty 态底栏的告警色）。
---

## 批次 5-㉑ · 查找高亮：那一格里的两层盒子必须长得一模一样（2026-10-06）

### 一、起点是文档里的一句话，和一句没兑现的承诺

`editor-measure-preference.ts` 的注释早就写着：列宽值要挂 `.editor-textarea-wrap` 而不是 textarea，
因为「高亮 mirror 是 `position:absolute; inset:0` 贴着 wrap 的，列宽一变若只收窄 textarea，两层会错位，
高亮就对不上行」。列宽那一档确实照做了。

这一批起手只是想把「正文栏行宽」量一量（应用的核心用途就是写与读，行宽至今没人量过），
量到六档都生效、编辑态与预览态一致，然后顺手去验那句话——**结果不是差 8px，是三层不同的毛病。**

那一格（`.editor-textarea-wrap`）里叠着两个盒子：文稿 `textarea`，和压在它底下专门画查找高亮的
`.find-replace-mirror`。开着查找时 textarea 的字是透明的，**用户读的是 mirror 画的那一份**，
而光标、选中框、滚动仍按 textarea 的排版走。所以「两层长得一样」不是洁癖，是这格能用的前提。

### 二、探针先被自己的校准否掉了三次

量法本来是「照抄 textarea 的计算样式造一个参考层，当作 textarea 的替身」。
三次都被校准拦下，每次拦下的东西都不一样：

| 版本 | 做法 | 校准读数 | 真相 |
| --- | --- | --- | --- |
| 1 | `ref.style.cssText = getComputedStyle(ta).cssText` | 短文本该 0 漂移，报 3/3 错位、漂到 37 行 | **Chromium 不序列化 computed style 的 cssText**（长度 0），参考层是个毫无样式的裸 div |
| 2 | 逐属性 `setProperty` 拷贝 24 个属性 | 行内样式明明写进去了（`padding: 0px 24px 80px`），计算值却回到 `0px` / `font-size 14px` | 全应用 `!important` 只有两处动画相关的，压根不压这几项；成因不明，不可用 |
| 3 | 挪进 shadow root + 每个属性读回自证 | 通过 | 但参考层挂在 `body` 下，继承链和 mirror 不同，还要再挪一次 |

第三条纪律是这批最贵的收获：**校准必须先在「已知有缺陷的样本」上验过它咬得动**（5-⑯ → 5-⑲ 立下，
这批是第二次用上）。否则量出来的漂亮数字全是探针自己的影子。

### 三、第一个数：层差 8px，断行点分家

零模型判据先给出方向：mirror 是 `overflow:hidden` 但 `scrollHeight` 照报内容高，
同一段文本、同行高、同 padding ⇒ 内容高差就是行数差。量出来：

| | 夹具 A（中文为主） | 夹具 B（长链接） |
| --- | --- | --- |
| 夹具体量 | 右栏 490–1200 四档 + 六档列宽 | 同 |
| 改前 抽查 / 错位 | 155 枚 / **138 枚** | 165 枚 / 0 枚 |
| 最大偏差 | **偏 2 行**、列差 568px | — |

`文字列 ta=593 / mirror=601`，差的正好是全局 `::-webkit-scrollbar` 的 8px：textarea `overflow-y:auto`
在内容超一屏时吃掉一格，mirror 永远不占。一个汉字 15.4px，于是**约每行多塞一个字**，
同一处匹配在两层指向不同的字。

短稿（不溢出、两层同宽）一律 0 错位——这正是好态/坏态的分界。

### 四、真机截图揭开的第二个缺陷：比 8px 严重得多

对着上面那张表去截「开着查找、正文超一屏」的图，图上是**整段字叠印的乱码**，不是偏 8px 的样子。
查 `.document-editor--with-find { color: transparent }` 为什么没生效：

```
命中 .document-editor* 的规则（按出现次序，后面的赢）：
  #0 .document-editor, .document-preview          color: var(--text-primary)
  #5 .document-editor--with-find                  color: transparent          (0,1,0)
  #8 html[data-theme] :where(… .document-editor …) color: var(--text-primary)   (0,1,1)
```

`theme-runtime.css` 那条主题兜底用 `:where()` 把特异度贡献归零，可外层的 `html[data-theme]`
仍给到 (0,1,1)，压得住裸的 `.document-editor--with-find`（0,1,0）。**于是 textarea 的字一直是不透明的，
和 mirror 的字一起印在同一个盒子上**；短稿两层重合看不出来，超一屏就糊成乱码。

`git show HEAD` 确认这条 `:where()` 条目在接手前就躺在那里——不是这批改出来的，是一直如此。

修法：选择器加一层 `.editor-textarea-wrap` 前缀，(0,2,0) 压得住。

### 五、第三个缺陷：字号与行距只挂在一层

继续查时顺手量了「用户改设置页会怎样」，结果比前两个都大：

| 用户把正文字号改成 18px、行距改成 2.4 | textarea | mirror |
| --- | --- | --- |
| 字号 | 18px | **15px** |
| 行距 | 43.2px | **29.25px** |
| 正文行数 | 12 | **14** |

原因：`editorTextStyle` 把 `--editor-font-size` / `--editor-leading` 绑在 textarea 自己身上，
mirror 读不到，只能吃样式表的兜底值（`1.07143rem` / `1.95`）。**高亮停在另一套排版上。**
列宽那一档本来就挂在 wrap 上，理由完全相同，只是当时只搬了它一个。

修法：三档一起搬，textarea 从 wrap 继承。

### 六、A/B：两条修法各自值多少

注入式 A/B（候选连条件一起注），20 格 × 320 枚：

| | 有效格 | 抽查 | 错位 |
| --- | --- | --- | --- |
| 原状 | 20/20 | 320 枚 | **138 枚**（最多偏 2 行） |
| 注入候选 | 20/20 | 320 枚 | **1 枚** |

「该保留的东西」一起量：mirror 仍被 wrap 裁住、高亮仍在、滚动同步仍成立、占位画不出来——全保住。

真机复验（真实样式表，不注入）：夹具 A 十格 310 枚 → **0 枚错位**。

### 七、剩下那 1 枚：查到底了，也说清楚它是什么

夹具 B（长链接）里 30 格 130 枚还剩 7 枚，全部**行差 0、列差 ≤ 12.8px**（不到一个汉字）。
逐行追下去，形态是「每隔五行，mirror 就多塞进一个字」。依次排除了三种可能：

1. **DOM 结构**：把同一段文字切成 `<mark>` 多段 vs 单个文本节点，同宽同样式，159 个字符位置 **0 处**差异 → 切分不改断行。
2. **继承链**：参考层挂进 wrap 再量 → 残差一字不变。
3. **真实差异**：确实是 textarea 与 mirror 之间的一处亚字符差异（`unicode-bidi: isolate` 等）
   或者是我这个模型与 textarea 之间的一处亚字符差异。

最后用**不依赖任何模型**的办法问 textarea 本人：在长链接那几行上，按 mirror 的几何算出 x，真点击，
读回 `selectionStart`——**7 个有效点全部一致**（第 8 个点落在可见区外没点上）。
即用户在这一处的光标确实落在 mirror 画的那个字上。

诚实结论：模型量到的这 7 枚是亚字符量级（≤0.83 个汉字）、只在长链接正文里出现、
行差恒为 0，且真机点击测不出错位。**不作为产品缺陷记入，但也不假装它是零**。

### 八、顺带修掉的一处：编辑器是全文唯一不跟全局排版的字

`:root` 上有 `text-rendering: optimizeLegibility`，而 Chromium 给表单控件强制 `auto`——
于是**编辑器 textarea 的字距与预览态、mirror 都不一致**（断行点因此对不齐）。
写 `text-rendering: inherit` 把它接回全局那条继承链。编辑器与预览态的排版从此同源。

### 九、守卫与变异

新增 `components/editor-mirror-parity.test.ts`（**9 条**），钉的是耦合决定不是长相：
mirror 的 `overflow-y: auto` / `overflow-x: hidden`、折行三件套、两层排版声明逐项相同、
滚动条 thumb 透明、`inset: 0`、让位那条的**选择器必须带 `.editor-textarea-wrap` 前缀**，
以及主题兜底里确实还躺着 `.document-editor`（冲突是真的，两边一起钉）。

两处旧守卫**改成钉新决定**（保证没变小，是变大）：

- `writing-preferences-contract.test.ts`：「只禁列宽」反转为「textarea 上不许出现 `:style`」——
  从禁 1 个变量扩到禁 3 个。
- `document-pane-wiring.test.ts`：`textarea 带 editorTextStyle` 反转为「一个 `:style` 都不许带」，
  拆成两条（拼写检查仍绑 textarea，它是属性不是变量）。29 → 30 条。

变异 `mutate-521.mjs` **18 条全真红，0 漏网**（跨两个目标文件：CSS 15 条 + `.vue` 3 条）。

### 十、门禁与截图

`VERIFY_EXIT=0`，**187 文件 2468 用例**（较上一批 +1 文件 +10 用例）。

- `shot-521p-before.png` —— 开着查找、正文超一屏：**两层字叠印的乱码**（改前）。
- `shot-521p-after.png` —— 同一场景：高亮精确压在「的」上，1/31 处匹配。
- `shot-521v-fontsize.png` —— 字号改 18px 后两层同步（高亮块 18.5×27 而非 15.4×22.3）。
- `shot-521p-normal.png` —— 关闭查找后 mirror 残留 0 字 0 高亮。

### 十一、这一批真正立住的规矩

1. **「查 0 枚」不等于「查过了都对」**：量到空格子必须判无效并单独报数，不许混进通过数。
2. **真截图比数字更能揭出真缺陷**：那张乱码图直接指向了特异度问题，数字只指向 8px。
3. **特异度要连外层一起算**：`:where()` 贡献 0 分，可它外面的 `html[data-theme]` 仍给 (0,1,1)。
4. **变量挂哪一层，要和「还有谁会读它」一起想**：mirror 是 wrap 里的另一个盒子。
5. **表单控件被 UA 踢出全局排版**：`text-rendering` 这类继承属性要单独验一遍。
6. **变异备份会过期**：`inject` 必须每次重写落盘备份，否则上一轮跑完后的源码改动会被旧备份抹掉
   （本批实测踩到，还原哈希对不上）。---

## 批次 5-㉒ · 读稿子的四面要读到同一份排版（2026-10-06）

### 一、起点是上一批自己记下的那条缝

5-㉑ 把字号/行距/列宽三档变量挂到了 `.editor-textarea-wrap`，并在文档里留下一句「预览态与浏览态是否同一套行宽，
是个没人验过的缝」。这一批就去验它。

### 二、三个面读的是同一组变量、同一个兜底

样式表里这件事写得很清楚：

- `.document-editor, .document-preview` 一条规则：`font-size: var(--editor-font-size, 1.07143rem)`、
  `line-height: var(--editor-leading, 1.95)`、`letter-spacing: 0.025em`、同样的 padding；
- `.markdown-body` 一条规则：同样的三行；
- `.find-replace-mirror` 一条规则：同样的三行。

也就是说**四个盒子天生该同版**，差别全在「变量定义在哪一层」。自定义属性只往下传，
定义在哪个盒子上，就只有它自己和它的后代读得到。

### 三、量到的症状：默认档看不出来，一改档就露馅

真机量（分栏视图，左右并排同一篇稿子）：

| 状态 | 编辑面 | 分栏预览 | 查找高亮 | 读到变量 |
| --- | --- | --- | --- | --- |
| 默认档 | 15px / 29.25px | 15px / 29.25px | 15px / 29.25px | 只有编辑面与 mirror 读得到 |
| 用户改成 18px / 2.4 | **18px / 43.2px** | **15px / 29.25px** | 18px / 43.2px | 预览面读到的是**（无）** |

**默认档下四面确实一致**（差的是 `1.07143rem` 兜底算出来的 15.00002px，肉眼与量测都看不出来），
所以这个缺陷能长期藏着；一旦用户动了正文字号或行距，分栏视图左边 18px、右边 15px，
同一篇稿子左右并排却是两种字号。浏览态（`.document-preview`）同理。

### 四、这条缝不是 5-㉑ 挖的，是两代修法都只修了一半

| 挂法 | 谁读得到 | 谁不跟 |
| --- | --- | --- |
| 挂在 textarea（5-㉑ 之前） | 编辑面 | **mirror**（5-㉑ 量到：18px/43.2px 对 15px/29.25px，行数 12 对 14） |
| 挂在 `.editor-textarea-wrap`（5-㉑） | 编辑面 + mirror | **分栏预览 + 浏览态** |
| 挂在 `.editor-document`（本批） | 四个盒子 | —— |

两代修法都在修「眼前发现的那一个读不到」，而没问「**还有谁会读它**」。真正的答案是挂共同祖先：
`.editor-document`（它是编辑面 / 分栏预览 / 浏览态 / 查找高亮的容器，也是 `--document-inline-padding`
本来就住在的地方）。

### 五、守卫：两处旧断言继续反转，保证是变大不是变小

- `writing-preferences-contract.test.ts`：「变量在 `.editor-textarea-wrap`、textarea 上不许有 `:style`」
  → 「变量在 `.editor-document`，且 **textarea 与 wrap 两个盒子都不许有 `:style`**」——从禁 1 个盒子扩到禁 2 个。
- `document-pane-wiring.test.ts`：同一条同步反转，标题与注释写清两次改动的来龙去脉。
  拼写检查仍绑 textarea（它是属性不是变量），这条没动。

变异 `mutate-522.mjs` **7 条全真红，0 漏网**：摘掉 `.editor-document` 上的绑定 / 退回挂 wrap /
退回挂 textarea / 删掉三个变量中任一个 / 对象改名，两处守卫都咬得住。

### 六、真机复验

改后（变量在 `.editor-document`，18px / 2.4）：

| 盒子 | 字号 | 行高 | 字距 | 读到变量 |
| --- | --- | --- | --- | --- |
| 编辑态 textarea | 18px | 43.2px | 0.45px | 18px |
| 分栏预览 `.markdown-body` | 18px | 43.2px | 0.45px | 18px |
| 浏览态 `.document-preview` | 18px | 43.2px | 0.45px | 18px |
| 查找高亮 mirror | 18px | 43.2px | 0.45px | 18px |

**四个盒子同版。** 截图：`shot-522c-before.png`（变量缺席＝改前的实际处境）、
`shot-522c-after.png`（改后分栏并排）、`shot-522c-browse.png`（浏览态）。

### 七、门禁

`VERIFY_EXIT=0`，**187 文件 2468 用例**（与上一批同数——这批只改断言内容，没有增删）。

### 八、这一批真正立住的规矩

**修「某层读不到某个变量」时，先问「还有谁会读它」。** 默认值能遮住大部分症状，
量的时候必须**先量改档之后的状态**——默认档全绿并不代表这件事没问题。
连续两代修法都只把症状挪到了另一个面上，直到挂到共同祖先才真正结束。## 批次 5-㉓ · 极端内容：塞进去才知道排不排得下

### 一、这一批补的是哪一类盲区

前三批的扫描器喂的是**状态**（5-⑲：四种视口 × 九种界面状态）与**栏宽**（5-⑳：靠极端栏宽逼右栏栏头排不下）。
还有一类至今没人往窗口里塞过：**极端内容**——

- 极长书名「真澈复验书·第一卷雾海灯塔与那盏明明灭灭的灯（以及一整段刻意写长的书名用来压左栏）」
- 极长章节名
- 2464 字正文：长段 ×40、emoji ZWJ 家族与职业、RTL 阿拉伯文、零宽 U+200B / U+200D / U+FEFF、
  300 字符无空格串、H2 / 列表 / 引用 / 代码块 / 表格、行尾全角空格

界面状态一模一样，内容一换就露馅——这一类溢出，状态扫描一条都扫不到。

### 二、注入这一格，前两版都栽了

把正文写进磁盘、让应用重读，前两次都没能让内容真的进到编辑器里：

| 版次 | 做法 | 结果 |
| --- | --- | --- |
| ① | 写磁盘正文 → `openDocTab` | 页脚「正文 0 字」，`book.draft` 只有 42 字符的 frontmatter |
| ② | 先 `delete book.draftsByPath[relPath]` 再 `openDocTab` | 仍是 42 字符 |

定位到的关键事实：**盘上文件 2462 字是对的，`window.mochen.readDoc(relPath)` 也读得到 2462 字，只有 `book.draft` 是旧的。**
问题出在「写回」不在「读」——`openDocTab` 内部先 `stashActive()`，把内存里那份空稿写回暂存再短路返回。

所以不再跟磁盘路径纠缠，改为**从编辑框注入**（native value setter 装值 + 喂 `input`），
并且注入后**逐项断言** emoji / RTL / 零宽 / 超长串 / H2 五个标记全部命中，验不过就 `process.exit(1)`——
不许拿着一份由旧稿驱动的扫描结果去分诊。这一条是本批所有后续结论的前提。

### 三、分诊：读数里混着三类，只有一类要修

扫描报的是「被裁」，不报「该不该被裁」。逐条问一句之后：

| 类 | 条目 | 处置 |
| --- | --- | --- |
| **设计内省略号截断** | `.tree-label` / `.workdir-book` / `.workdir-path` / `.context-caption` / `.composer-chip-label` | `text-overflow: ellipsis` 且 overflow 非 visible ⇒ 不动 |
| **5-⑲ 基线噪声** | `goal-ring-btn` oy=2、`text` ox=2 | 与内容无关 ⇒ 不动 |
| **扫描器误报** | d4 报 `code` 出窗 | d4 只用 `getBoundingClientRect()`，不看裁剪；`code` 在 `overflow-x: auto` 的 `pre` 里 ⇒ 不算缺陷 |
| **真缺陷** | 下面四条 | 本批修 |

### 四、四个真缺陷

#### ① 面包屑：省略号一位都没画出来过，当前章节整段不可见

`.editor-breadcrumbs span` 三段全是 `flex: 0 0 auto`。两处机理叠在一起才出了这个结果：

1. `text-overflow` 只裁**元素自己的行盒内文本**，对 flex **子项**无效——写在容器上的那个 ellipsis 从来裁不到 span 上；
2. 末段虽然单独立了 `text-overflow: ellipsis`，可 `flex: 0 0 auto` 让它永不收缩，那个省略号**一辈子没有机会画**。

真机 1024 分栏：容器内容盒 **130**，内容 **732**（书名 439 + 「章节」37 + 章名 255）。
屏幕上只剩「真澈复验书·第一卷雾海灯塔」半截（断在字中间、无省略号），**当前章节整段看不见**——
用户不知道自己在写哪一章。5-⑳ 的注释里那句「面包屑被压成 0px 宽度（路径从不显示）」腾出了 79px，但那轮没碰根因。

改法：容器吃掉栏头剩余宽度；各段可收缩并各自带省略号；前两段留 3em 地板、末段吃剩余——
让位的应该是书名，不是当前章节。

改后放大图：`shot-523z-split-1024-editor-header.png` —「… 章节… **第一章…**」三段都出省略号，当前章节回来了。

#### ② 会话栏头：中文按钮每字一行，还向上溢出到窗口外

`.conversation-header-actions` 与标题区共用一条只写 `min-width: 0` 的规则，作为 flex 子项默认 `flex: 0 1 auto` ⇒ **会被标题挤扁**。
挤扁之后中文按字断行而不是出省略号：

| 档 | 量到的 |
| --- | --- |
| 预览 @1440 | 动作区 `x=797 y=-5 h=59`，而栏头只有 50 高 ⇒ **整块向上溢出到窗口外**；按钮 w=52，行宽 `[7,12,12,12,12]` |
| 分栏 @1024 | 按钮 w=84，行宽 `[16,35,12]`（内容要 88，差 4px 就断行） |

一行「历史对话」实测要 46（字）+ 16（图标）+ 6（间隙）+ 18（内边距）+ 2（边框）= **88px**，
两枚都要，加目标题「墨宸 · 主笔」58 与栏头内边距 24、间隙 12 ⇒ **322**。所以内容盒 322 以下必然挤扁。

改法：**控件不是文字，标题才是可以压缩的那一侧**——动作区钉死不缩，产品名改成省略号让位；
窄到连钉死都装不下时，`@container conversation (max-width: 320px)` 那一级只藏文字、留图标
（沿用 5-⑱ 工具栏梯子的老裁定）。文案在模板里包成 `<span class="header-text-button-label">`——
裸文本节点 CSS 选不中，不包这层阶梯就是死规则。

改后：`y=7 h=36`（不再向上溢出），两档按钮都是**单行**（1024 那档宽 34 只剩图标，1440 那档宽 86 带文字）。
放大图 `shot-523z-preview-1440-conversation-header-actions.png`：横排单行。

#### ③ 上下文条：副文硬切、与末尾图标叠印，整条溢出圆角胶囊

两段副文的病根各不相同，但都导致「自动最小尺寸 = 内容宽度」：

- `.doc-context-kind` 写的是 `flex: 0 0 auto`——**钉死不缩**。真机 1024 量到胶囊被分到 47px、副文要 74px ⇒ 溢出画到下一枚上；
- `.context-meter-text` **根本没有规则**。没有 `overflow: hidden`，它的 `min-width: auto` 就是内容宽度（真机量到 107px），
  被分到 30px 的胶囊里就盖在末尾图标上——放大图里「≈1.9k tokens」的 t 与图标叠印。

而且 `≤560px` 那一级把 `gap` 从 8 抬到 12、内边距从 10 抬到 12（对工具栏那几级是对的，这一格在 1024 只剩 284px 内容盒），
固定开销算下来是：图标 127 + 胶囊内边距与边框 5×18=90 + 间隙 12×4=48 + 条内边距 24 = **289 > 284** ——
**把文字全藏光也装不下**。

改法三件：

1. 两段副文都可缩 + 各自省略号（`min-width: 0` 是必需的一步，没写 `overflow: hidden` 时加 `flex: 0 1 auto` 也缩不下去）；
2. 每枚胶囊有 **34px 地板**（图标 16 + 内边距 16 + 边框 2）并 `overflow: hidden`——没有地板时短标签的胶囊先塌到比自己的图标还窄
   （真机 1440 量到档案那枚只剩 ~20px，放大了只剩一个「：」）；**收缩次序钉死**：缺额只砸两个标题，档案 / 计量 / 阶段三枚控件不缩；
3. 窄档三档递进 + 末档连尾巴一起收：`≤460` 收副文 → `≤380` 收计量读数 → `≤300` 收主标题与尾巴。
   尾巴（✕ / ›）是**字形不是热区**——解除绑定靠整枚胶囊的 `@click`、展开靠 `aria-haspopup`，藏掉它不拿走任何功能。

| 档 | 改前 | 改后 |
| --- | --- | --- |
| 分栏 @1024 | `client=256 scroll=339` 溢出 **83px**；胶囊 59/47/26/30/23 | `client=256 scroll=256` **溢出 0**；五枚各 34、**本体溢全 0** |
| 预览 @1440 | 计量胶囊 84 装 159px 读数 → **t 与图标叠印**；档案只剩「：›」 | 溢出 0；五枚 116/89/119/144/85、**本体溢全 0**，「墨宸 · 主笔」与「1 条 · ≈1.9k …」完整 |

#### ④ 读稿四面：超长无空格串只在编辑面断行

textarea 由 Chromium UA 给的是 `overflow-wrap: break-word`，**预览面断不了**。真机分栏量到罪魁段
`client=192 / scroll=2619`（307 字符），而整段被 `.markdown-body` 的 `overflow-x: hidden` 裁掉——
长 URL / 哈希 / base64 在读稿那一面只能看见前十几个字母。

改法：把 UA 那个值**显式钉在四面上**（textarea 与浏览面共用一条规则、`.markdown-body` 一条、mirror 5-㉓ 已钉），
写 `break-word` 而不是 `anywhere`：它只改断点、不改内在尺寸，不会动 5-㉑ 量过的 textarea↔mirror 断行对齐。
继承属性要在子元素写回——`.markdown-body pre` 显式 `overflow-wrap: normal`，
否则这一格早先定下的「长代码行横向滚动」会被顺带顶成折行。

### 五、量到了、也确认了，但没有改的那一条

`.document-title-input` 是 `<input>`，长标题**硬切无省略号**：`width: 100%`、字号 `clamp(1.71429rem, 2.2vw, 2.42857rem)`，
真机 1440 读到「第一章 潮汛与那盏明明灭灭的灯（刻意写长」后面直接切断，「（刻意写长的章节名）」完全不可见
（放大图 `shot-523z-preview-1440-document-title-input.png`）。

**表单控件不支持 `text-overflow: ellipsis`**（它只作用于块容器的行盒内文本），CSS 层面没有干净的修法；
要修就得把这个可编辑字段换成别的形态，那是产品决定，不在样式这一层做。
如实记在这里：**量到了、确认了、没修**，理由是平台限制而不是漏看。
缓解是有的——同一个标题在面包屑末段与文档标签页都带省略号，修好 ① 之后那里读得到全文。

### 六、这一批的探针自己摔了四跤（都记在探针头部）

| 坑 | 症状 | 教训 |
| --- | --- | --- |
| 截图 clip 的边界写死成 1024 | 1440 那格把标题只截了 73px 宽，图里只剩一个「第」字 | **探针自己有 bug 时，照片会替你把 bug 说成结论**——量是对的，图被裁错了 |
| 右栏一折叠，整个 `DocumentPane` 就不渲染 | 「切不到编辑态」，而 store 读数一切正常（有书、docs=1、当前页也在） | 量到「读数正常」不等于量到「东西在屏上」；只有截图能看出右栏是空的 |
| `grid-template-columns` 那条 180ms 过渡 | store 与行内变量都读 484px，栅格第三道**恒为 0px**，重试六轮都不变 | **数字自相矛盾且不随时间变化 ⇒ 先怀疑有东西在动**，别急着推公式 |
| 模板字符串里写了反引号 | 脚本自己语法错，图截成 73px 宽 | 同上（上一条的老亲戚） |

还有两处**判定**上的纪律：

- `ruleBlock` 取第一个匹配，于是 `.conversation-header-actions` 会命中共享规则
  `.conversation-heading-start,\n.conversation-header-actions`——`flex: 0 0 auto` 真真切切写在**下一条**规则里，断言照样红。
  这是「红得对，但红的是错的块」。守卫因此另写了 `standaloneRule`（两边归一化后再比）与
  `containerStep`（`@container composer (max-width: 380px)` 本来就有两块，取第一块会读到别人的正文）。
- 窄窗下 `shouldAutoCollapseRightPane` 会自动收右栏（外壳栅格实测读成 `262px 762px 0px`），
  编辑面整块不参与布局——**这一格等于没测**。`resizeTo` 现在改完视口就重新撑开右栏，
  撑不开就抛错退出，不许拿无效格的读数下结论。

### 七、守卫与变异

- 新增 `extreme-content-overflow.test.ts`（20 条）：四条裁定各钉形状，`.vue` 一律零自动化覆盖（读源码钉形状、读样式表钉声明）。
- 反转一处旧断言：`composer-toolbar-overflow.test.ts` 的「`display:none` 只许落在 `-label` 上」按**白名单**改写
  （`doc-context-kind` / `context-meter-text` / `context-chevron` 三枚纯文字或纯字形），并**加钉**「整枚 `.composer-context-item` 不许藏」。
  保证没变小：不在白名单里的类藏一条红一条，上一版是「非 `.composer-chip-label` 一律红」。

变异 `mutate-523.mjs` **19 条全真红，0 漏网**：三段退回 `flex: 0 0 auto` / 删地板 / 末段不吸剩余 / 容器不吃剩余宽度 /
动作区恢复可缩 / 去掉 nowrap / 去掉省略号 / 窄档推到 9999px / 容器基准改名 / 副文退回钉死 /
读数去掉 `min-width: 0` / 某档不回收间隙 / 某档不藏尾巴 / 主标题去掉 nowrap /
预览面不写 break-word / 代码块不写回 normal / 两处文案退回裸文本节点。

### 八、门禁

`VERIFY_EXIT=0`，**188 文件 2488 用例**（上一批 187 / 2468：新增 `extreme-content-overflow.test.ts` 一份 20 条，
另有一处旧断言按白名单改写、用例数不变）。变异 `mutate-523.mjs` **19/19 条真红，0 漏网**，文件已回到初始态。

### 九、这一批真正立住的规矩

**装不下的那一格如果钉死不缩，省略号就一个都画不出来——而省略号画不出来时，中文不是截断，是按字断行。**
本批四个缺陷是同一家族：① 是钉死不缩让省略号永远画不出，② 是没钉死让中文断行，
③ 是自动最小尺寸等于内容宽度，④ 是四面各断各的。
凡是读数里出现「被裁」，先问一句：**这一格是设计内要出省略号，还是忘了让它缩。**
## 批次 5-㉔ · 极端内容进到浏览面板与对话区（2026-10-06）

### 一、这一批补的是哪一类盲区

5-㉓ 灌的是**编辑三栏**（编辑面 / 分栏预览 / 预览态）加它那一格的栏头与输入卡。
还有两个大面从没被极端内容碰过：

① **浏览面板**：左栏的人物 / 剧情 / 大纲 / 素材库。它在实现上就是书里的普通文稿
   （`book.browse(docRef)` → `readDoc` → `.document-preview`），所以不需要新造通路——
   建一篇超长条目的文稿、把极端正文写进盘上、browse 过去即可。
② **对话区**：用户那一条消息是作者从稿子里粘过来的原文：长 URL、长中文句、emoji 家族、
   RTL、零宽字符。全都在这一格落地。模型回执走 mock 桩（关键字驱动的固定串），不指望它回显。

尺子还是 5-⑲ 那把（`scan-core.mjs` 原样抽出，不是手抄的第二份），四个视口 1440 / 1280 / 1100 / 1024。

### 二、探针自己踩的四个坑（都记在这里，因为它们比结论更耐用）

**① 判据与夹具不同源 ⇒ guard 抓了个不存在的东西。**
零宽字符与 RTL 串第一版是直接写成源码字面量的：零宽字符一落盘就没了，
而 `有RTL` 判据查的是 `USER_TEXT` 里那句 `مرحبا بالعالم`，正文里写的却是另一句
`قال لي شيئا ثم`——查了个正文里根本没有的东西。改成 `\uXXXX` 转义 + 判据直接引用夹具常量。
**不可见字符只能写转义；判据必须取自同一份常量。**

**② 线程键猜错 ⇒ 量了一个还不存在的线程。**
第一版等这一轮跑完写的是 `agent.viewOf("doc:" + book.activeDocTab)`，
而 `threadKeyFor` 的真实口径是 `activeDocTab.trim()`，**没有 `doc:` 前缀**——
于是 `viewOf` 按错键现造了一个空线程，`running` 恒 false，循环第一轮就「跑完了」。
两层错叠在一起还都显得正常。另外 `viewOf` 有建线程的副作用，探针不该改被测状态，改成直接读 `threads`。

**③ 等的信号选错 ⇒ 把「慢」当成「坏」。**
`message` 事件要等模型把这段话**说完**才发，而夹具正卡在半截——等它等于等一个永远不会来的东西。
进行中的信号是 `turn-start` 与逐字 `delta`。

**④ 量与截不同刻 ⇒ 照片替探针说了结论。**
这一批最贵的一个。修完 `.user-text` 之后量到 `client=scroll=560`（已断行），
但截图上那条 URL 还顶到边——读数与照片直接矛盾。查下去是两件事叠在一起：

- `Page.captureScreenshot` 的 `clip.scale` **之外还叠了一个 `devicePixelRatio`**（本机 1.5）。
  期望 1824×825、实际 2736×1238，正好 1.5 倍。**每次截完都要把期望像素与实际像素打出来自证**，
  不然 clip 算错时图会被悄悄放大/缩小，而图看起来「还是那句话」。
- 上一版分诊脚本在写图**之前**就异常退出（退出码 -1），我读到的其实是**修复前那张旧文件**。
  量与截来自两个时刻，于是完美地互相矛盾。

顺带一条已经写进探针的纪律：`clip` 的边界要跟 `window.innerWidth` 走，
写死一个数会让图被裁错，而量还是对的。

### 三、跨书状态泄漏：一个比排版严重得多的缺陷（真机撞出来的）

灌极端内容时探针稳定拿到：

```
ENOENT: no such file or directory, open '…\<新书>\.mochen\sessions\…rollout-….jsonl'
```

第一反应是「落盘写失败」，但 `createSession` 与 `appendAgentEvent` 都会 `mkdir -p`，
且构建产物里那段代码确实带着 mkdir。重启 Electron 就好了——这说明问题出在**主进程的内存里**。

决定性一步是主进程日志（`Start-Process -RedirectStandardError`）。栈是：

```
at async readSession (index.js:6790)
at async Object.loadSession (index.js:9426)
Error occurred in handler for 'agent:load-session'
```

**是读，不是写**——我先前的写入假设被直接推翻（又一次「看到 ENOENT 就以为是 mkdir 没做」）。
而那个文件名里的 sessionId 与时间戳，是**上一轮探针跑的那本书**建出来的。

机制：`agent-service` 的 `threads` 记的是「threadKey → 会话相对路径」，
而相对路径是**相对于当时那本书**的。两本书只要有一篇**同名文稿**（新建章节的默认标题极易撞），
threadKey 就一模一样，于是新书里的 `threadFor` / `loadSession` 拿旧路径去读新书，
在 `readSession(current.root, rel)` 上抛 ENOENT。
症状不是「历史读不回来」，而是**新书里第一句话直接发不出去**，对话一条都没起来。

复现方式很短、且确定：连着跑两轮探针、中间**不重启** Electron，第二轮必挂。

修法（判定本身落在新文件 `apps/desktop/src/main/book-scope.ts`，理由见下面「为什么新开一个文件」）：

- 新增 `createBookScope(readRoot, clear)`：换书（含关书）即清空按书状态，同一本书内连续调用是空操作。
- `clearBookScoped()` 只清 `threads` / `pending` / `diffs`。
  `autoSession` / `autoDocTool` **不在此列**——它们键在档案与「文档::工具」规则上，
  是用户的自动批准偏好，不是这本书的状态；跟着换书清掉等于每换一本书就偷偷改一次设置。
  它们仍在 `dispose()` 里清（退出时该清还是要清），语义与改前一致。
- 落点规则只有一条，写在注释里：**凡是会读或写按书状态的入口，开头都要先调一次 `syncBookScope()`**
  （`threadFor` / `loadSession` / `applyDecision` / `diffOf` / `publish` 五处）。
  它幂等且便宜（一次 `current()` 加一次字符串比较），漏掉任何一处就等于给那一处留了一条跨书的缝。
- `loadSession` 那条「不存在『缓存了查不到的线程』」的注释原本是**错的**：那条不变量只在**单书内**成立。已改写。

守卫：`apps/desktop/src/main/agent-service-book-scope.test.ts`（6 条），夹具就是
「两本书 + 同一篇同名文稿」的最小复现。

### 四、排版：分诊出 1 真 1 假

| 读数 | 判定 |
| --- | --- |
| `.user-text` client=1442 / 对话区 730，承载链全 `overflow-x: visible` | **真缺陷** |
| `.tree-label` / `.workdir-path` 截断 | 设计内省略号 |
| `.section-tab` 出视口 | **扫描器误报** |

**真缺陷**：用户那条 414 字符的消息里含一串 200 字符的无空格链接，撑到 1442px。
再往上 `.conversation-scroll` 是 `overflow-x: hidden`——所以右半截**不是溢出到窗口外，
是被裁掉且无法横向查看**（内容不可达）。d4 把这一格报成「出视口」，
但真正要说清的是它在滚动容器里被裁：这两种长得像，结论相反。

修法两半，缺一不可：

- `.agent-block { overflow-wrap: break-word }`——它是 user / message / thinking / plan /
  tool / proposal / 来源清单八种块的**共同祖先**，一份实现盖住全部。
- `.user-text { min-width: 0 }`——**机制必需，不是风格选择**：`.user-line` 是 flex，
  `.user-text` 是 flex item，它的地板是内容的 min-content 尺寸，
  而 `overflow-wrap: break-word` 按规范**不参与 min-content 计算**（`anywhere` 才参与）。
  只加祖先那一条，这一格照样 1442px，缺额纹丝不动。

复量：`.user-text` 560/560、承载链五级溢出全 0、`overflow-wrap: break-word` 生效，
最长连续串仍是 200 字符（**内容没被改短**，只是现在会断）。放大图上长链接断成三行完整可读，
长句折行、emoji 家族、RTL 混排都还在——**该保留的没有变小**。

**扫描器误报**：`.section-tab` 落在 `.section-tabs-scroll`（`overflow-x: auto`，
容器右 1402 / scrollW 728 > clientW 438）里，超出部分是**被容器裁掉且可横向滚动查看**的。
与 5-㉓ 分诊掉的 `pre`/`code` 同款。放大图上页签带着省略号与删除钮被裁得干干净净，面板边界外什么都没有。

### 五、守卫与变异

新增/改动：

- `apps/desktop/src/main/agent-service-book-scope.test.ts`（新建，6 条）
- `apps/desktop/src/main/book-scope.ts`（新建：「换作用域即失效」这条判定单独成一份）
- `apps/desktop/src/main/approval-read.ts`（新建，见「为什么新开一个文件」）
- `apps/desktop/src/renderer/src/components/extreme-content-overflow.test.ts`（+5 条，共 25 条，并**改掉共享工具 `standaloneRule`**）

改 `standaloneRule` 是这一批最值得记的一件事：它原来只剥**前奏**里的 CSS 注释，
不剥**规则正文**里的。于是我在 `.user-text` 注释里写的那句「必须配 min-width: 0」
直接喂饱了 `toContain("min-width: 0")`——**把真正的声明删掉，断言照样全绿**（实测：变异 N9 漏网）。
现在正文里的注释也剥掉，并加了一条用例把这个行为本身钉住。
与「断言读的是不是被测的那一块」是同一个病：比中的东西不在被测的位置上。

变异 `.mochen-tmp/p2/mutate-524.mjs`（12 条）+ `run-524-mutations.mjs`：
九条回退「换作用域即失效」那一处判定（threadFor / loadSession / 判定方向 / applyDecision / diffOf /
publish / 清空范围 / 判定模块只剩空壳 / reset），三条回退对话区那两条 CSS 声明。

首轮 5/7，两条漏网——**都不是守卫不严，是用例自己有洞**：

- N4（`applyDecision` 不再 sync）：用例把 `diffOf` 的断言写在 `decide` **之前**，
  而 `diffOf` 自己也会 syncBookScope——它顺手把 pending 清了，`decide` 那边自然「恰好」是对的。
  **探针与实现互相顶住时，绿是假的。**
- N6（`publish` 不再 sync）：根本没有「轮次中途换书」这一格，补了一条用 `gatedFetch` 卡在半截的用例。

第二轮 9/10，N5（`diffOf` 不再 sync）仍漏网：`decide` 在前已经 sync 过，
`diffOf` 的空串是 `decide` 的功劳。给它单独立了一条用例，让 `diffOf` 做**第一个**动作。

**终轮 10/10 真红、0 漏网、文件已回到初始态。**

### 六、这一批留下的三条

1. `Page.captureScreenshot` 的 `clip.scale` 之外还叠 `devicePixelRatio`。每次截完把
   期望像素与实际像素打出来自证，否则 clip 算错时图只是「被悄悄缩放」，看上去仍然自洽。
2. 读数与照片矛盾时，先怀疑照片——尤其是**上一次跑剩的旧文件**。
   「量与截同刻」不够，还要保证那次截**真的落盘了**（脚本在写图之前就退出过）。
3. 跨进程缓存（主进程里按 key 索引的一切）必须有一条**换作用域即失效**的闸门。
   单看每一处的局部注释都像是对的，合起来才是错的：那条不变量只在**单作用域内**成立。

### 七、为什么新开两个文件（门禁逼出来的，如实记）

改完跑门禁，红在 `tools/check-source-line-budget.mjs`：`agent-service.ts` **856 行 > 800**。
查下来这个文件在本批开工前就已经是 **799**——贴着上限，只差 1 行，本批任何新增都会撞上。

处理办法按「拆」而不是「改阈值」：
阈值是用来逼出拆分的，抬阈值等于把守卫删掉让它变绿。做了两件事：

1. **`book-scope.ts`**：把「换作用域即失效」这条判定连同它那一大段来历单独成一份。
   判定仍然只有一份，`agent-service.ts` 里只留一个 `bookScope.sync()` 入口。
2. **`approval-read.ts`**：把 `readForApproval` 与它的三态类型整块搬走。
   这一块自足、只依赖 `@mochen/fs-store`、只在审批那一处调用，搬出来不改变任何判定。

搬完 `agent-service.ts` 795 行，预算通过。**没有为了让门禁变绿去删任何断言或放宽任何判据。**

### 八、变异结果补记（重构后终轮）

重构后又加了两条变异（N8「判定模块只剩空壳」、N9「reset 不复位作用域」），终轮 **11/12 真红**。

N9 判为**等价变异**，并且是**明写在变异脚本里**的，不是驱动这边临时开脱：

> `reset()` 少了 `scopedRoot = null`，但 `clear()` 照样执行；从 dispose 到下一次 sync 之间没有任何通路会往这三张表里写，
> 所以「上一次记着的根仍是这一根」根本触发不到。下一次 sync 只要根变了就会再清一次，而 dispose 之后表本来就是空的
> ——**可观测行为完全相同**，因此没有能区分它的用例，也不该硬凑一个。

为此给变异脚本加了 `equivalent` 字段与 `why` 子命令，驱动器把等价变异**单列**，
不算进「漏网」。理由写在变异脚本里而不是驱动里，是留给下一个人复核的。

## 批次 5-㉕

用户一次提了四件事，这一批落了三件（第四件是 DeepSeek Harness，范围待定，未动代码）：

1. 顶栏那枚「0% 写作目标环」不要；
2. 工具卡里的参数 JSON **只显示文字，不用显示代码**；
3. 模型切换不该弹居中对话框，应像参考图那样点 chip 弹下拉、直接切换。

### 一、顶栏的 0% 圆环退役，但写作目标功能没跟着没

那枚环是 `WritingGoalRing.vue`，挂在 `CenterColumn.vue` 的头部动作区（`CenterColumn.vue:293`），
圆圈里写的是「今日进度百分比」——今天一个字没写时它恒为 `0%`。用户裁定不要它。

退役的是**三样东西一起退**：组件文件（走 `mavis-trash`）、`openGoal` 事件、`App.vue` 上的
`@open-goal` 监听。留任何一条都是零写者的死接线，而零写者在本仓的典型症状正是
「面板从来没打开过」（`dead-panel-entry.test.ts:196` 那两条回归就是冲这个来的）。

**面板本体与可见性开关都留着**，它仍由 `panelShortcut("goals")`（Ctrl+Shift+G）开合。
为什么不顺手再补一枚可见入口：那是一次产品决定，不是实现细节——记在报告里由用户定。

新守卫 `writing-goal-ring-retired.test.ts` 钉的是**正反两半**：
钉住「环真的没了」单靠 `not.toContain` 会把「连面板一起删掉」也判成绿，
所以同时钉住「面板仍挂在 App 上 + 开关仍在 + 唯一真写者仍是那枚快捷键」。

### 二、工具卡参数改人话：只动显示，不动数据

用户截图上的卡片摆的是 `{"doc":"chapters/01-开局.md","anchor":"雾从海面涌上来。 ",…}`——
模型和机器之间的话，摆在一张要人读的卡上。

新建 `utils/tool-args.ts`：`toolArgsText(tool, raw)` → `{ text, plain }`，
覆盖 `propose_patch / write_doc / read_doc / web_search` 四个工具，路径只留书名，
长文本首尾各留 28 字、中间收省略号。**解析不了或没登记的工具原样返回**——
那张卡正是排查入口，把坏 JSON 换成一句「已执行」才是把线索毁了。

原始 args 仍然原样留在工具事件里、仍然随会话 JSONL 落盘（那是给模型读与回放用的）。
这条纪律由守卫钉住：`timeline.ts` 里不许出现 `event.args =` 这种就地改写。

真机对照（同一轮对话，同一张卡）：

- 改前：`{"doc":"chapters/01-开局.md","anchor":"雾从海面涌上来。 ",…}`（等宽、`break-all`）
- 改后：`把《01-开局》里的「雾从海面涌上来。」改成「海雾涌上来，铁锈味很冲。」——补一层可感的细节。`
  （正文比例字体、13px、`word-break: normal` + `overflow-wrap: break-word`）

### 三、模型切换：居中模态 → 贴 chip 的下拉

原形状是 `.model-select-mask`（`position: fixed; inset: 0` + 变暗 + blur）盖住整窗、
面板居中，每行还要再点一次「改用」。用户裁定：点 chip 弹出来，直接切。

改法（与全仓浮层口径一致，不造第二套定位机制）：

- `ModelSelect.vue` 整体重写成 `<Teleport to="body">` + 共用的 `useComposerContextPopover`
  （`overlay-chrome.test.ts` 从「谁用了这个 composable」反推要求 `.model-select` 在
  `motion.css` 的入场动画表里——它本来就在表内，所以这条自动成立）；
- 每一行都是 `<button role="menuitem">`，当前行带 `✓` 且 `aria-current`，
  **点当前行 = 收起**（不是把同一个模型名再写一遍）；
- 关闭钮从面板底部搬进头部：下拉贴在输入卡上沿下方，底部那颗会掉出视口；
- 几何一律由合成器以行内样式交给 `.model-select`，样式表里一个也不许再写。

**锚点怎么来的**：chip 在 `ComposerBox.vue` 的模板里，所以元素随 `open-model-select`
事件一起交上去（`[anchor: HTMLElement]`），装配处存进 `modelAnchor` 再当 prop 传下去。
刻意不让浮层自己去 `document.querySelector('[data-chip="model"]')`——
那会在 chip 改名/重排时静默指空，浮层飞到屏幕角落，而代码上完全看不出原因。
`v-if="modelsOpen && modelAnchor"`：拿不到锚点就不渲染。

### 四、三条旧断言改钉（不是删掉），逐条说明保证没变小

`model-select-wiring.test.ts` 有三条与新形状直接冲突。按铁律改成钉新决定：

| 旧断言 | 新断言 | 保证没变小 |
| --- | --- | --- |
| 遮罩点空白关 / `role="dialog"` | 共用合成器的点外面（`pointerdown`+`focusin`）+ Esc + 关闭钮 + Tab 触边 | 「点空白」**扩大**成「点浮层外面」；Esc 与关闭钮保留；反向钉旧模态痕迹在模板与样式表里都消失 |
| 当前模型那一行不是按钮（挂徽章） | 每一行都是 `menuitem`，当前行带 ✓，点它**收起** | 旧断言防的是「按了没反应的按钮」。新形状下每行要么切要么收起，没有第三条路；`pick()` 的控制流被钉住 |
| `"open-model-select": []` | `"open-model-select": [anchor: HTMLElement]` | 「只是转发不自行判定」没松：载荷不是判定，只是那枚按钮的元素。反向钉：组件不许 `querySelector`、载荷不许写成可选 |

### 五、这一批探针自己踩的坑（都记在脚本注释里）

1. **下拉量成了「空壳」**：`.model-select` 在 loading 期间就已挂在 DOM 上，
   轮询一见到面板就 break，量到的是 0 行。⇒ 等**名单到位**（有行，或主进程给了失败理由）。
2. **量到了动画第一帧**：合成器初始把 style 设成 `visibility: hidden`，onMounted 里才翻成可见。
   不可见元素的 `innerText` 是空串，于是读到「可见性 hidden + 三行空名字」，
   差点当成浮层没画出来。⇒ 量之前先验两个前提：`visibility !== hidden` 且行名非空。
3. **下拉往上开被当成「飞到别处」**：chip 贴着窗口底边，下方只剩 6px，
   `composerPopoverPlacement` 判 `above >= 260 || above > below` 于是朝上翻——这是共用的定位口径。
   ⇒ 探针只验「确实贴着」（上缝或下缝 ≤ 40px），不替它做决定。
4. **`.tool-args.is-plain` 的断行守卫写漏了一条**：只写了 `overflow-wrap: break-word`，
   而共享规则里的 `word-break: break-all` 优先级更高，量到的计算值是两者并存——
   **守卫全绿而屏上没变**。⇒ 两条一起写，守卫同时钉住 `word-break: normal`。
5. **图拍到了「文件在外部被改动」那个冲突遮罩**：seedBook 往盘上写过正文，应用判定外部改动
   弹了 `SaveConflictDialog`（夹具副作用，不是这一批改出来的）。
   量到的 DOM 仍然对，拍出来的是那张对话框——典型「量对了图不对」。
   ⇒ 截图改成**找到卡片的那一轮同刻落盘**，并在同一轮里验「卡片没有被遮罩压着」。
6. **输入用 `Input.insertText` 送不出去**：它只改 DOM 的 `value`，
   读 `ta.value` 看着进去了，v-model 未必收到——点发送被 `draft.trim() === ""` 挡下，
   一轮什么都没发生，屏上只是安静地没有卡。⇒ 走 5-㉑ 验过的
   `native value setter + input 事件`，并**在 store 上复读一遍**才点发送。
7. **期望像素算错 2px**：Chromium 对 clip 的宽高是**先 floor 再乘 scale×dpr**，
   用 `Math.round` 会差 2px，被当成「截错了」。⇒ 期望按 floor 算，再给 1px 容差。

### 六、变异：20 条，20 条真红，0 漏网

前两轮跑出来的是**假结果**，两次都是驱动/断言自己的毛病：

- **驱动崩在还原上，注入留在源码里**：#14 的 restore 撞到 Windows 文件占用（errno -4094），
  异常冒到顶层、进程退出，`interaction.css` 一直带着注入的 `width: min(460px, 92vw)`。
  于是后面每一条测的都是被污染的源码——改 `agent-pane.css` 却让 model-select 的断言红了，
  极像「守卫过度敏感」。⇒ 驱动加 `process.on("exit")` 兜底还原所有残留备份，
  restore 本身重试三次（本批第一版）。
- **等价标记被跨行误匹配**：用一条 `[`${0,1}`\s\S]`*?` 跨行正则找 `[等价/未取到样本]`，
  从 #1 一路懒匹配到第 20 条，19 条真红全被记成等价，结论整个反过来。⇒ 按 `^#(`${0,1}`)` 切条目再读标记。
- **一条断言恒红，20 条变异全显示成真红**：`tagAttributes` 的类名匹配是
  `class="[^"]*\bcomposer-chip\b`，而 `\b` 在「composer-chip-」的连字符前**也算边界**，
  于是 `<AppIcon class="composer-chip-icon">` 一起被收进来，`toHaveLength(2)` 读成 3。
  恒红在汇总表里看不出是恒红，只会让每条变异都「真红」。
  ⇒ ① 按 `class` 的完整值筛；② **驱动加地基检查：注入之前守卫文件必须原样全绿，否则退出码 2**。

最后两轮才拿到可信结果：**地基 11 个守卫文件全绿 → 20 条变异全部真红、0 漏网、0 残留备份。**

其中两条漏网是这一批**自己写出来的**，都写进了守卫注释：

- #18：整份模板 `toContain` 那行 `:ref`，被**右端**权限 chip 上同样的一行顶掉了
  （「同一块里的另一条当成自己的」那一族）。⇒ 改成逐枚 `.composer-chip` 数并逐枚断言。
- #19：只 `toContain` 了 `popoverOwnsKey(...)...` 这串字面，
  `if (false && popoverOwnsKey(...))` 照样全绿——那一串字还在，而 Esc 分支已经死了。
  ⇒ 改成把 `onKeydown` 的函数体切出来，钉住 `if (popoverOwnsKey(...)) {` 这一行本身。

### 七、这一批的边界（明确说没做什么）

- `ToolRoster.vue` 用的仍是同一套遮罩模态，**没动**。用户这一轮只裁定了模型切换。
- 写作目标面板没有新增可见入口，只剩 Ctrl+Shift+G。要不要补一枚可见的（放在左栏或设置里）是产品决定。
- DeepSeek Harness 的插件/技能范围**未动代码**（见下条待办）。

## 批次 5-㉖ · 技能市场（用户裁定：「插件市场和技能都做，只不过是适配我这个软件能用的」）

### 一、范围是怎么定的：为什么不是「装 DeepSeek Harness 的插件」

先把那件事查清楚，免得后面一直在做不可能的事：

- DeepSeek Harness v0.2（2026-09-29，macOS + Windows，官网 `deepseek.com/harness`）**有**插件管理页。
  **【2026-10-07 更正】**这一批当时记的是「官方插件市场自己写着还在计划中」——
  **这句话现在是错的**：设置里已有 **Plugin Market**，目录从 `awesome-dsh-plugin.com`
  实时拉取，桌面版自带 `dshmarket@1.40.0`。原先那条结论作废，详见批次 5-㉘。
- Harness 是 Cordis 架构（`@deepseek-ai/cordis`、`ctx.tools`、`ctx.skills` 都是 Cordis 的 service）。
  墨宸是自写的 Electron 应用（`packages/agent-runtime` + contracts + fs-store），**没有那层 service 容器**——
  装进去的插件注册的工具，墨宸的 agent 循环根本看不见。要「直接装 npm 插件」等于先给墨宸重写一层 dsh。

所以可安装单元定成**技能**（`SKILL.md`），理由是它本来就在墨宸里能用：纯提示词、不碰运行时、装完立刻能被挂入。

**技能来源逐个读过之后**：`linhut/dsh-skills`（MIT，源自 obra/superpowers）九个目录里，
只有两个的方法能改写成写作技能——`brainstorming` 与 `writing-skills`；
`gongwen-skill` / `ppt-studio` 各带一整套 Python 引擎与 shell 脚本，墨宸没有运行通路，
只抄 SKILL.md 会得到一个「照着做」却什么都做不了的说明书，那比不装更坏；
其余四个（`finishing-a-development-branch` / `github-actions-docs` / `how-it-works` / `web-search`）是编程工作流。

首批五条：`chapter-intent`（构思）/ `world-rulebook`（结构）改写自上面两个，许可照抄 MIT；
`dialogue-voice`（文风）/ `continuity-check`（校对）/ `fact-check`（资料）本仓原创，许可写「本仓自有」。
**每一条的 frontmatter 里都写明出处**——用户在技能库里读到的应当是「谁写的」。

### 二、形状与判定（各自只有一份）

| 判定 | 住哪 | 为什么是它 |
| --- | --- | --- |
| 目录名能不能拼路径 | `contracts/market.ts` 的 `marketTargetDir` | 装/卸/查已装三处都走它，免得三处各拼一次、其中一处忘了 realpath |
| 已装 / 被书内盖住 / 排序 | `contracts/market.ts` 的 `catalogView` | 主进程与渲染层都读它，谁都不许自己再算一遍 |
| 筛选到某一类 | `stores/useSkillMarketStore.ts` 的 `visible` | 纯显示判定，模板只 v-for（守卫钉着模板里不许出现 `.filter(`） |

清单写成**代码常量里的 skillMd 全文**，而不是随包发一堆文件：
这样「装出来的技能与用户手放的完全同形」是**构造出来的**（装完走同一套 `scanSkills`/`readSkillFile`），没有第二份解析路径。

### 三、写通路的三条守卫（这是技能库第一条写路径）

`skill-service.ts` 是纯只读，写闸压根不存在；这里开了写，就得自己守住：

1. **只往全局目录写，绝不碰书目录。** 装到书里更贴心，但书是用户的作品、会被同步/版本控制——
   应用往用户作品目录里塞文件是本仓明确不做的事（那属于 `changes-service` 的回滚管辖区）。
2. **目录名必须过 `MARKET_DIR_NAME_RE`**，不合法直接拒，不给「大概安全」的路径。
3. **装前查同名 ⇒ 拒绝覆盖**（覆盖会毁掉用户改过的技能，而用户改过它完全合理）；
   卸**只认清单白名单**（全局目录是用户的，应用没权力凭「名字看着像」就删）。

「为什么不装『就跳过已有』」：那会让重装/更新变得不可能。
现在的形状是 装 → 报「已经装过了」；卸 → 真的删掉；再装 → 装上。三步各自可逆。

### 四、过程中自己发现并修掉的三个真问题

1. **渲染层装完不刷技能库那张表**（store 的注释宣称会刷，代码没做）。
   后果很具体：用户在市场这页装完、切回「已有的」，看到的是**装之前那张表**，
   而 notice 明明写着「装好了」。⇒ `runInstall` 的 `finally` 里补 `await useAgentStore().refreshSkills()`。
2. **卡片上那句 summary 与技能里模型读到的那句 description 不是同一句话**（我写清单时给了两个版本）。
   `market.ts` 钉死了「summary 会原样进 frontmatter 的 description」，
   于是守卫 `frontmatter 的 description === summary` 当场把这条抓出来。⇒ 五条全部对齐，留一份。
3. **浮层内容溢出白底，掉到页面底色上**（真机截图里白底在中途断掉，下面的卡片画在页面背景上）。
   成因是两条叠在一起：共用的 `POPOVER_MAX_HEIGHT = 380` 是**下拉**的尺寸，
   而 flex 子项默认 `min-height: auto` = 内容高度、**不肯缩**。
   ⇒ ① `composer-context-placement.ts` 单列一份 `spacePx`（未封顶的可用高度），
   `useComposerContextPopover` 加可选 `limitPx`，取 `min(limitPx, spacePx)`——
   **上限可以更高，底线没有跟着放宽**（贴着窗口下沿仍不会跑出屏幕）；
   ② `skill-browser.css` 三道一起兜：面板 `overflow: hidden`，页与列表都 `min-height: 0`，
   列表自己不再封 52vh（上限交给浮层那个 inline max-height，两处各封一次会互相矛盾）。
   守卫钉的是**那行算式本身**（`min(limitPx, spacePx)`）与 CSS 三条一起，缺一条就红。

### 五、探针踩的坑（这一批的，比上一批多一条「量错对象」）

- **`cdp.evaluate(body)` 把 body 包成 `(async () => { … })()`**：传一个 IIFE 进去（`() => {…}()`），
  值会被 async 函数的函数体**丢掉**，evaluate 恒返回 undefined——
  而它在多数断言里表现为「读到 null → 点不到元素」，报错点离病根十万八千里。
  ⇒ body 必须是「语句体 + 显式 return」。
- **`pinia._s` 是作用域 Map，不是状态树**（共用件 p523-kit 的注释在这点上会误导人）。
  读 store 状态要走 `pinia.state.value.<id>`；getter 与 `<script setup>` 的 `setupState`
  在生产构建里都读不到（后者被闭包收走），所以「屏上几张卡」改成与状态对账。
- **`until` 的 `ok` 必须由条件决定**：点完立刻读屏，Vue 的重画还没落地，
  量到的是切换前那一帧，报出来像「那枚 tab 点了没反应」——真点击其实是好的。⇒ 每处等待都带真实条件。
- **点 tab 要带重试**：浮层靠 `position()` 定位，之后还有一段布局落定；
  量到矩形与派发事件之间隔着一次 CDP 往返，位置可能已经变了。⇒ `switchTab` 重试 6 次并带 `elementFromPoint` 诊断。
- **选择器要按页限定**：`document.querySelectorAll` 是文档序，库那页（`v-show` 隐藏、尺寸 0）在前、市场那页在后。
  不限定就会点到那枚 0×0 的空气，报「点不到元素」而真因是选错了页。
- **探针崩在中途会留下真状态**：技能真的装在盘上，下一轮就量到「一进来就有一条已装」，
  看起来像产品默认装了一条。⇒ 探针开头自带归零（顺带先走一遍「卸掉」）。
- **量 `panelBottom` 当成面板高度**：493 在「面板被 380 封着」与「面板只是从锚点往上长」两种情况下都对。
  ⇒ 单独量 inline `max-height` 与 `scrollHeight/clientHeight`。

### 六、变异（27 条）

口径与上一批同：inject / restore 是两个独立进程；`inject` 每次重写落盘备份；锚点必须恰好命中一次，
命中 0 次当场拒跑且**不计漏网**（那结论正好相反）；驱动有 `process.on("exit")` 兜底还原；
**注入前必须先查地基全绿**，否则一条恒红断言会让每条变异都显示成真红。

结果：**地基 7 个守卫文件全绿 → 27 条全部真红、0 漏网、0 脚本坏、0 残留备份。**

头一轮是 **22 真红 / 2 漏网**，两条都是这一批自己写出来的松断言，都已收紧并写进注释：

- #12 卸完只删 SKILL.md 留下空目录：原来用 `readFile` 判断「目录没了」，
  而**空目录上 readFile 一样抛（EISDIR）**，于是照样全绿。⇒ 改用 `stat`。
- #22 正文预览不限高：原来只 `toContain("max-height:")`，而 `max-height: none` 也含那三个字母。
  ⇒ 改成 `/\bmax-height:\s*\d+px/`（必须匹配到像素值）。

另外两条**在写的时候就是错的**，靠地基检查抓出来而不是靠变异：
「空态分三档」的正则把自己要排除的那一段也圈了进去（断言红的原因与产品无关）；
`if (dir === null) return` 那个跨行针串在 prettier 折行后数出来是 `null`，报的是「Target cannot be null」。

### 七、门禁与真机

- `corepack pnpm run verify`：**197 文件 / 2589 用例全绿，VERIFY_EXIT=0**（上一批 192 / 2515）。
- 真机探针 `.mochen-tmp/p526/p526-market.mjs`：**31 项全过（P526_UI_OK）**。
  走的是真点击（`Input.dispatchMouseEvent`）：点开技能库 → 切市场页（5 条卡、6 枚筛选 chip、
  每条带出处与许可）→ 筛「构思」只剩 1 条且与 store 状态对账 → 真点「装上」（notice 出现、
  按钮翻成「卸掉」、已装集合正好一条）→ **切回「已有的」，新技能已经在列表里并标着「全局技能」**
  （这一条验的就是第四节第 1 条那处修复）→ 展开正文预览（摆的是带 frontmatter 的逐字原文、
  自己限高 220px、列表是唯一滚动区、`scrollHeight === clientHeight` 不溢出）→
  真点「卸掉」（按钮翻回、已装集合清空、技能库那张表同步少一条）。
- 截图 `shot-526-market.png`（1560×2160）：白底完整一块、内容在内部滚动、卡片不再掉到页面底色上。

### 八、这一批的边界（明确说没做什么）

- **没有真插件**。DSH 的 Cordis 插件在本仓跑不起来（没有那层 service 容器），要直装等于先重写一层 dsh。
  本批交付的是技能市场；若之后仍要真插件，那是独立的一轮。
- **清单是内置常量**，没有「从网上拉取」的能力，也没有版本号与更新通道——
  更新某一版的形状是「卸掉再装」，这一点在面板上写明了。
- 技能库面板仍是共用浮层，只多了 `limitPx` 一个可选参数；其余浮层的观感与观感数值一字未改。

## 批次 5-㉗ · 真机复验：市场装来的技能正文，真的进了这一轮（2026-10-07）

上一批交付的是**界面**：装得上、看得见、卸得掉。这一轮补上用户真正要的那件事——
「它对写作有用」要求正文一路走到模型面前。探针 `.mochen-tmp/p526/p526-skill-in-context.mjs`，
**26 项全过（P526_SKILLCTX_OK）**。

这一轮不是「验一遍通过」，是**查出了三个此前完全不可见的产品缺陷**，其中一个严重到
「挂入技能后发任何一轮都起不来」。

### 一、挂入技能后发任何一轮都起不来（`An object could not be cloned.`）

- **症状**：在技能库点「已挂入」，发任何一轮都直接失败，占用条还照常刷新。
- **成因**：`useAgentStore.startTurn` 里 `skillPaths: this.skillPathsOf(...)` 递的是 store state，
  也就是 Vue 的 reactive **Proxy**。`contextBridge` 在**进入 preload 函数体之前**就序列化实参，
  Proxy 没有内部槽，当场被拒。
- **为什么单测抓不到**：它们传的是纯数组；而 `ContextMeter` 那时写死 `pinned: []`——
  空数组恰好可克隆，于是那一侧也隐形。**缺陷整整藏了半个批次。**
- **修法**：渲染层摊平，跨边界之前。`utils/agent-thread.ts` 新增 `plainList`（纯函数、与 Vue 无关、
  可单测，不引 `toRaw`）；`skillPaths` 与 `pinned` 两处都改走它。

### 二、一份**无效的修法**被写了守卫，又被撤回

- 最初把摊平写进了 preload（`toPlain`），还配了 4 条断言。
- **证伪用的是哨兵**：在 preload 那份摊平函数首行插 `throw new Error("__TO_PLAIN_REACHED__")`，
  重建后真机同一个接口递两种实参——递响应式数组时报的还是 `could not be cloned`（**哨兵没触发**），
  递纯数组时才报哨兵。**结构上那段代码压根不会被调用。**
- 于是 preload 的 `toPlain` 与它那 4 条断言一并撤回（脚本 `.mochen-tmp/p526/revert-preload-toplain.mjs`、
  `cut-preload-tests.mjs`）。**给一份无效修复配守卫比不写更坏**——它把无效写法钉死了。
- 这条结论写进了 `plainList` 的函数注释，哨兵实测的现象与日期一并留着。

### 三、技能正文被**静默截断**到 800 字（市场首批技能当场中招）

- `context.ts` 的挂入技能那条走的是 `clip(extra.text, 800)`——那是**书内文稿摘录**的额度。
  技能是一套方法，方法被砍掉尾巴等于让模型照残缺步骤干活，还没有一句「以下被截断」。
- 真机量到的证据：占用条报 **801**（= 800 + 省略号），而 chapter-intent 的正文是 851 字。
  市场首批五条正文（剥 frontmatter 后）是 853 / 872 / 723 / 690 / 843，
  **第一条与第五条都超过 800**——用户装上第一批技能，方法正好在结尾被砍。
- 顺带发现：`extra.text` **不过 `body()`**，frontmatter（`name:`/`stage:`）整块跟着方法发给了模型，
  与「frontmatter 不混进给模型看的正文」那条既有判定不一致。
- **修法**：`clip(body(extra.text), PINNED_SKILL_CHARS)`，`PINNED_SKILL_CHARS = 4000`。
  仍要上限——技能目录是用户可写的；但 4000 足够装下任何一份正经方法。
- 守卫三条：超过 800 的方法必须整份送达、真到额度上限才截断（且末尾有省略号）、
  技能的 frontmatter 不进模型正文。

### 四、占用条那一行显示目录名（同一份技能两个名字）

- 技能库里显示「落笔前先问清楚」，挂进这一轮后占用条却写着 `chapter-intent`。
  成因是 `readSkillForTurn` 把 title 取成目录名，而目录名是给机器认的。
- **修法**：title 取 frontmatter 的 `name`，没有才退回目录名；
  只认字符串（frontmatter 的值类型是 `string | string[]`，列表值不该流进标题变成「a,b」）。

### 五、这一批的探针纪律（比缺陷本身更值钱）

- **`endedAs` 的初值就是空串**：`until` 的 `ok` 写成 `ended !== null`，发完第一下就「等到了」，
  量到的是这一轮**还没开始**的那一瞬，整轮结论整个是假的。⇒ 等**终态**。
- **等测的 `ok` 必须能被证伪**：`(draft ?? "") === ""` 把「key 被删掉」与「已清空」当成同一件事。
- **量测脚本自己读错一段，比报错更费时间**：量技能正文长度时用非贪婪正则取模板字面量，
  撞上正文里的**转义反引号**，chapter-intent 被量成 163 字（实际 981）。
  ⇒ 手写扫描：只有**前面不是奇数个反斜杠**的那个反引号才是结尾。
- **探针跑完不退出 ≠ 应用卡住**：CDP 的 WebSocket 吊着 Node 的事件循环，
  日志早写满了，shell 却等不到退出码。⇒ 末尾显式 `process.exit`。
- **起点不归零就造得出假通过**：上一轮崩在挂入之前，技能真留在盘上，
  这一轮那一下点击其实是**卸掉**，而市场 store 的 installed 标记还没刷新，
  于是紧接着「装上了吗」立刻成立。⇒ 开头先卸掉任何已装的。
- **占用条那张面板必须拍在发轮次之前**：`ComposerBox` 里绑定条是 `v-if="contextBarVisible"`，
  只在**空线程**时显形（对齐 deepwrite 的 messagesEmpty）。发完第一轮它连同那颗按钮一起消失。
- **阈值要跟着被测对象走**：「技能正文 >1500 字」是我照着「技能应该有那么多字」想的，
  实际是 851，永远红。而「与盘上长度差 400 以内」把一个**常数差**（被剥掉的 frontmatter）当成了吻合。
  ⇒ 改成精确相等，并把那 2 个字符的 `trim()` 差解释清楚——它正是「装配层确实 trim 过」的证据。
- **对账要用契约里的真身**：探针不自己写第二条 frontmatter 正则，
  而是 `import { splitFrontmatter } from "packages/contracts/src/frontmatter.ts"`（Node 24 直接吃 .ts）。

### 六、门禁与真机

- 变异 **36/36 真红、0 漏网、0 脚本坏、0 残留备份**。新增 #33–36 分别钉：
  退回 800 额度、把额度常量改回 800、frontmatter 又跟着发、标题退回目录名。
- #29 一度**漏网**：`refreshContextPreview` 那条摊平没有守卫。
  原因是夹具不做结构化克隆，Proxy 被 `toEqual` 判成相等——能咬住的只有「引用变了」。
  补齐后当场单跑一次确认真红。
- tsc 又牵出一条真问题：`plainList(query.pinned)` 里 `query.pinned` 在契约中是**可选**的，
  `[...undefined]` 直接抛；而那个 try 是**静默**的，抛了只表现为「数字不更新」，
  占用条悄悄留着上一次那份，看着像「没挂任何技能」。⇒ `?? []`，并单列一条守卫。
- `context-meter-wiring.test.ts` 里逐字钉的 `contextPreview(query)` 随之失效：
  **改成钉新形状**，且比原来更严（仍落到 `window.mochen`、结果仍落回 `this.contextPreview`、
  新增「query 是展开递进去的」——重抄字段迟早会漏掉新加的字段）。
- `corepack pnpm run verify`：**198 文件 / 2601 用例全绿，VERIFY_EXIT=0**（上一批 197 / 2589）。
- 截图：`shot-526-context-meter.png`（占用条面板：正文（本章）29 字 +
  挂入「落笔前先问清楚」851 字）、`shot-526-skill-in-context.png`（这一轮真跑完：
  回复、提案卡、收尾提示）。

## 批次 5-㉘ · Cordis 兼容插件运行时：装进来的插件，模型这一轮真的调得到（2026-10-07）

上一批交付的是技能市场。插件那一半当时明确挂着，用户这一轮裁定走**真兼容**：
给墨宸加一层 Cordis 内核，让按 DeepSeek Harness 官方文档写的插件能装进来。

**这一批的验收标准不是「装上了」，是「模型真调得到」**——
装上只说明内核与加载器活着；用户要的是它对写作有用。真机探针
`.mochen-tmp/p528/p528-plugin.mjs` 全部通过（**P528_PLUGIN_OK**）。

### 一、先核实事实：上一批有一条结论已经过时

- 上一批记的是「DSH 官方插件市场还在**计划中**」——**这句话是错的，现已更正**。
  设置里已有 **Plugin Market**，目录从 `awesome-dsh-plugin.com` 实时拉取，
  桌面版自带 `dshmarket@1.40.0`（官网 `deepseek.com/harness` 与官方文档两处一致）。
- 但「那些插件是 Cordis 插件，要挂在 `ctx.tools` / `ctx.skills` 上」这条**仍然成立**，
  所以「要直装等于先重写一层 dsh」这个工作量判断没有被推翻。上一批错的是前提，不是结论。

### 二、官方插件到底长什么样（这一节是照抄，不发明）

从官方插件文档逐条抄下来（`packages/plugin-kernel` 的形状就是照它定的）：

```js
// 函数形态（官方说「多数情况够用」）
import { defineTool, type Context } from "@deepseek-ai/cordis";
export const name = "my-plugin";
export const inject = ["tools"];          // 依赖门控
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({ name, description, parameters, async execute(args) {} }));
}
// 对象形态：export default { name, inject, apply(ctx) {} }
// 类形态：export default class X extends Service { static inject = ["tools"]; … }
```

还有三条承诺，逐条成了内核的守卫：
「框架会等到每个必需 service 就绪才加载插件」⇒ **缺依赖硬失败并说清缺哪个**；
「通过 ctx 登记的一切在卸载时被清掉，你不需要自己 removeListener」⇒ **工具/事件/定时器全清**。

### 三、`@deepseek-ai/cordis` 那个 import 怎么解决

插件里那一句是**运行期真的 import**。两个障碍：插件跑在 `<appData>/plugins/<名字>/`，
Node 从插件自己的目录往上找 `node_modules`；而主进程构建把依赖 externalize 掉了，
打包后 node_modules 也不随包走。

- **改写，不装 loader hook**：`@mochen-ai/*` 的 import 来源在**装的时候**改写到
  一个生成出来的适配层。`module.register()` 那条路要装全局 loader、影响进程里所有模块解析，
  而插件目录是用户可写的——风险面比改写大得多。改写只动那一个文件。
- **适配层是薄壳不是第二份实现**：kernel 被打进主进程 chunk（electron-vite 的 `exclude` 里加了
  `@mochen/plugin-kernel`），磁盘上没有一个能被 import 的文件；适配层从
  `globalThis.__mochen_plugin_kernel` 取**同一个** kernel 实例。
  再写一份 `defineTool`/`Service` 就是第二份语义，将来 kernel 改了而 shim 没改，
  插件会以一份**永远不变的旧语义**运行，且没有任何测试会红。

### 四、插件工具怎么进模型（改钉了两个被钉住的产品决定）

- `agent-runtime`：`ToolHost` 加可选的 `extraSpecs()`，名字放宽到 `string`；
  新增 `isCallableTool` / `extraSpecsOf` / `callableToolNames`。
  **判定与「发给模型的清单」用同一个函数**——两边各判一次就会出现
  「清单里没给、却允许调」这种缝。
- `contracts` 的 `agent-event`：`tool` 字段从 `z.enum(AGENT_TOOL_NAMES)` 改成 `z.string()`。
  **保证没变小的部分**：派发前仍过 `isCallableTool`——花名册那五个照旧闭集，
  不在闭集里、又没被任何插件注册的名字，仍然被中文回执拒掉。闸没松，只是闸后名单从 5 个变成 5+N。
- `tools.test.ts` 里那条「工具名收窄只在注册表边界发生」**改成钉新决定**，
  并把「没变小」显式钉住：花名册工具放行 / 插件工具放行 / 无人注册的名字仍被中文拒掉。

### 五、内核的守卫，以及它当场抓到的三个真 bug

`packages/plugin-kernel/test/app.test.ts` 18 条，全对着官方文档的一句承诺。
写的过程里它自己抓出三个真 bug（都是「16 条里 10 条红」那种级别的）：

1. **`readPluginShape` 漏了最常见的函数形态**：重写时只判 `module.default`，
   于是 `{ name, inject, apply }` 全被判成「形状认不出来」。
2. **service 注册表按 ctx 分**：每个插件各拿一个 ctx ⇒ 每个插件一张空表，
   「插件给别的插件提供服务」整条落空，而「同名 service 不许静默覆盖」那条守卫
   因此**量不到冲突**（两个 ctx 两张表，撞不上）。⇒ 注册表改成**应用级一张**。
3. **记录按模块自报名存**：类形态的自报名是类名 `Widget`，于是按安装名卸载找不到它。
   ⇒ 记录一律按安装名存，`entry.name` 仍记自报名给界面显示。

另有一个是**我自己的注释写出来的编译错误**：在 JSDoc 里照抄官方的
`constructor(ctx) { super(ctx, "x"); /* … */ }`，那个注释结束符把 JSDoc 提前关掉，
编译报的是 service.ts 第 8 行一个莫名其妙的 token。

### 六、门禁与真机

- `packages/plugin-kernel/test/app.test.ts` **18 条**；
  `apps/desktop/src/main/plugin-service.test.ts` **14 条**（其中「真的从磁盘装一个插件」
  那几条**不用任何 mock**：夹具在临时目录里按官方写法写 `client.js`，
  `@deepseek-ai/*` 解析不到是真的会炸，所以「能装上」本身就是证据）；
  `plugin-host.test.ts` **5 条**（钉派发方向：花名册走 base、插件走插件）。
- 真机：把一份**连 import 都写成 `@deepseek-ai/cordis`** 的插件放进
  `<appData>/plugins/rhythm/client.js`，起应用 → 日志 `[插件] 已挂载 1 个` →
  发一轮「帮我量一下这段的节奏」→ 模型调了 `rhythm_check`，`ok:true`，
  回执是**插件自己算的**「字数 2；段落 1；平均段长 2；对白段 0（占 0%）；最长段 2」，
  随后模型给出收尾。**P528_PLUGIN_OK**。
- 桩那一支（`tools/mock-provider.mjs`）与 `web_search` 同款口径：
  **要求这一轮真的带了那个工具**才派——不在手上就派，等于自己编自己答。
- `corepack pnpm run verify`：**201 文件 / 2638 用例全绿，VERIFY_EXIT=0**（上一批 198 / 2601）。

### 七、这一批的边界（明确说没做什么）

- **没有插件界面**：没有插件市场页、没有装/卸按钮、没有启用/停用。
  装插件的方式是把目录放进 `<appData>/plugins/`。这一批只交付**运行时**。
- **只吃 JS**：入口找 `client.js` / `index.js` / `main.js`，不编译 TypeScript。
  官方文档的开发教程用 `.ts`，那属于源码开发路径；市场分发的包是编译后的。
- **适配层只提供 `defineTool` 与 `Service`**：插件若从别的 `@deepseek-ai/*`
  子路径 import 某个本仓没有的导出，会在 import 时抛错——**如实报错**，不静默降级。
- **不沙箱**：插件与主进程同权运行（与 DSH 官方一致）。用户目录可写这一点是已知风险面，
  隔离是后面的独立一轮。


---

## 批次 5-㉙：给插件一个能读全书的服务 + 两个内置写作插件（2026-10-07）

上一批把 Cordis 兼容运行时搭起来了，但插件能做的事仍只有一件：拿模型递进来的文本自己算。
它读不到用户的书——官方那套 API 里根本没有读用户数据的面。

这一批补上那一面，并顺手把「插件到底有什么用」这件事从口号变成可验的东西。

### 1. `docs` service：插件读当前书（只读）

`packages/plugin-kernel/src/types.ts` 新增 `DocsService`：`bookTitle()` / `list()` / `read(relPath)`。

**为什么需要它，以及它和 `read_doc` 有什么不同。**
`read_doc` 一章就是 6000 字进模型上下文（`READ_TRUNCATE_AT`），整本书十二章就是七万多字。
让模型自己读十几万字去数段落，又慢又贵还容易算错。
`docs` service 让插件在**插件这一侧**把全书过一遍，只把汇总结论（几百字）交回模型。
这才是「插件能挂到 `ctx` 上」的实际价值，也是这套 API 存在的理由。

**为什么是只读的。**
插件与主进程同权（与 DSH 官方一致），所以这一层的边界**不是**权限隔离，是**接口形状**：
这里只有读，没有写。真要写盘，模型得走 `propose_patch`/`write_doc`，进审批卡片，用户看得见、改得了。
插件自己偷偷写一份用户看不见的修改，那才是越权。

**为什么砍掉了 `activeDoc()`。**
第一版给它留了一格，写完就发现兑现不了：主进程知道「这一轮在改哪一章」是因为
`buildHost` 拿着那一轮的 `docRelPath`，而**没有轮次进行时它并不知道用户打开的是哪一章**
（那是渲染层的选中态）。要凑一个全局指针，就得每轮开始写一次、结束时清一次——
那又是一个跨作用域缓存，而它上一次咬人是换书后读到上一本书。
⇒ 删掉，改为由模型在工具参数里显式递 `doc`。那个值模型本来就知道，插件也不必猜。
**少一个说不清的状态，胜过多一个方便。**

**`read` 为什么必须走 `readDocFile`。**
它内部第一步就是 `assertSafeRelPath`：绝对路径、`..` 越界、空路径全被拒。
这一层是**书目录边界**的执行点，所以判定只能有一份实现（铁律 6）。
自己 `path.join(root, relPath)` 看着少两行，代价是插件递一个 `../../.ssh/id_rsa`
就能读到书外的文件——而插件与主进程同权，这个门是唯一的一道。

**每一次现取，绝不拍快照。**
`book()` 是一个函数而不是一个值：插件挂在启动时，那时通常还没开书，用户随时会换书。
拍快照的写法在单测里全绿，真机上是「换一本书，插件还在读上一本」。

### 2. 两个内置写作插件：rhythm（全书节奏）+ outline（全书骨架）

`apps/desktop/src/main/builtin-plugins.ts`。这两个不是「写死在主进程里的功能」，
而是**真正的插件源码**：按官方写法写成 JS 字符串，启动时落到 `<appData>/plugins/<名字>/client.js`，
再走**与用户插件完全同一条路**（import 改写 → 内核挂载 → 工具叠加）。

**为什么是「落盘再装」而不是直接在内存里 mount。**
内存里 mount 会留一条**只在测试里走**的旁路，而旁路是不受守卫覆盖的：
用户插件走改写、内置插件不走，那么「改写对不对」这件事就只由用户的插件来承担。
统一走落盘，内置插件就成了每天开机都在跑的回归测试——哪天兼容层坏了，它们会跟着一起坏，
而这正是我们要的。

- `rhythm_check`：字数、段落数、平均段长、最长段、对白占比（全书或单章）。
- `book_outline`：每章标题、字数、开头第一句，并点出明显偏短/偏长的章节。

**一条不许省的细节：读不到的篇必须点名。**
某一篇读不到时，结论里写明「N 篇没读到，以上数字不含它们」。
静默跳过却不提，结论就会显得覆盖了全书而实际少算一篇——那是比报错更坏的一种撒谎。

### 3. 内置插件的版本戳：修一个真机暴露的产品缺陷

第一版的规矩是「目录已在就不碰」（护住用户对 `rhythm/client.js` 的修改）。
真机立刻暴露了它的代价：**已有的安装永远拿不到内置插件的修复**。
修好「开头第一句取到了 Markdown 标题」之后，磁盘上那份仍旧是旧的，
重启多少次都跑的是坏的那版。尝试用 `--user-data-dir` 绕过去也不行——
那个开关**不影响** `app.getPath("appData")`。

于是引入版本戳（`VERSION_STAMP = ".mochen-builtin.json"`），三种情形：
① 目录不在 → 种下；② 版本号相同 → 不动；③ 版本落后 →

- 盘上的 `client.js` 与**当前源码逐字相同** ⇒ 只是没跟上，盖上去；
- 不相同 ⇒ 用户改过，**只升版本号，绝不动内容**，并说一句。

**对用户的保证没有变小**：用户改过的文件任何时候都不会被应用改回去。
**比第一版强的地方**：没改过的安装能拿到修复。

### 4. 真机验收：探针抓出一个单测抓不到的真缺陷（P529_DOCS_OK）

真机探针的关键设计：**断言回执里出现一句我亲手写进书文件、模型与桩都没见过的话**。
5-㉘ 只验到「模型调了 rhythm_check，回执是插件自己算的」，
但那一验有个缝：插件读的是模型递给它的那段文本，回执里的数字**也可能**是从那段文本数出来的，
与「插件能读用户的书」无关。

结果探针**当场抓到一个 bug**：`book_outline` 的「开头第一句」是 `# 第一章 潮汛`——
Markdown 标题被当成了正文第一句。而单测全绿，因为**我的夹具没有标题行**；
真实书的第一行几乎总是标题。

⇒ 修插件（先剥 frontmatter 与标题行），并补两条守卫钉住它。
这是一次「单测夹具不真实 ⇒ 真机才暴露」的典型，值得记住。

修完后的真机回执：

```
《插件真机书》共 1 篇，平均 47 字：
- chapters/第一章 潮汛.md · 第一章 潮汛 · 47 字：潮水退到第七道桩时，他忽然不记得自己数到了几。
```

那句话只存在于磁盘上的书文件里。

### 5. 桩扩到两个内置工具（`tools/mock-provider.mjs`）

原来那一支硬编在 `rhythm_check` 上，内置插件再带一个 `book_outline` 就够不着。
现在按「用户这句话点到哪个内置工具」来选，且**仍然要求它这一轮真在 `body.tools` 里**。
两个条件都满足才派；都不满足就走默认分支——桩不会凭空造工具调用。

### 6. 本轮踩到的坑（都已写进代码注释）

1. **桩没换成功，探针量的是旧行为。** `Get-Process` 在 PowerShell 5.1 里**没有** `CommandLine` 属性，
   我的过滤没匹配上，旧桩（PID 55408）继续占着 8899，新桩 `EADDRINUSE` 挂掉，
   而健康检查打到的仍是旧桩——**报出一句假的 `MOCK_UP 200`**。
   ⇒ 杀进程要用 `Get-CimInstance Win32_Process` 按 CommandLine 过滤；
   而且**健康检查通过不等于新进程在服务**（旧进程也能答 200）。
   这与「改了 X 之后现象没变，先确认改动真进了被跑的那个进程」是同一条。

2. **模板字面量里的注释不是注释。** 在模板内部的注释里写一个反引号，
   整个文件当场解析失败，而报错指向一个毫不相干的字符位置（实测报在 `})` 的右括号上）。
   本轮咬了三次。同族：5-㉘ 那次是块注释符把 JSDoc 提前关掉。

3. **我为这个坑写的三条判据，全是错的，各错一次。**
   ① 对 `plugin.source` 断言「不许有反引号」——红 25 行，全是**合法**的转义用法（source 是求值之后的字符串）；
   ② 「每行裸反引号须偶数」——报 4 行，正是四段源码的**开闭位置**，模板的开与闭天然落在不同行；
   ③ 数总数——技术上对，但它守的「转义对不对」的直接后果就是**文件能不能解析**，
   而那已经由测试文件开头的 import 证明了。
   ⇒ **结论：这条不需要守卫。** 真判据是 tsc 与测试跑得起来，它对这类错误零漏报。
   留一条看似严谨、实则三次判错对象的断言，比没有更糟：它会让人以为这里被看着。
   最后保留的只有一条注释，说明坑在哪、以及为什么没有守卫。

4. **数字对不上时，先手工数一遍再决定改哪边。**
   节奏那条守卫第一版写「31 字」，红了——我在注释里把「“你来了。”她说。」数成了 10（实为 9）。
   正确顺序：手工数 → 确认是断言错 → 改断言。
   反过来照着输出改断言，这条守卫就变成「输出说什么都对」，等于没有。

5. **夹具写在 `describe` 顶上 = 求值早于 `beforeEach`。**
   describe 的函数体在**收集阶段**执行，那时 `bookRoot` 还是空串，
   `join("", "潮生")` 变成相对路径 → 夹具直接落在**仓库根目录**。
   是全量门禁里 prettier 扫到 `潮生/chapters/*.md` 才暴露的。
   ⇒ 依赖 `beforeEach` 产物的夹具必须惰性求值；
   并且两个 `writeBook` 都加了「书必须住在临时目录里」的当场断言，写歪一次就红。

6. **vitest 不做类型检查。** `kind: "chapter"` 被推成 `string`，
   而 `DocRef.kind` 是闭集联合——单测全绿，只有全量门禁的 tsc 会红，
   报出来还是一串看不懂的「不可赋给 BookKind」。

### 本轮改动清单

**新增**
- `packages/plugin-kernel/src/types.ts`：`DocsService` / `PluginDoc`
- `apps/desktop/src/main/plugin-service.ts`：`createDocsService`
- `apps/desktop/src/main/builtin-plugins.ts`：两个内置插件源码 + `seedBuiltinPlugins` + 版本戳
- `apps/desktop/src/main/builtin-plugins.test.ts`：17 条
- `.mochen-tmp/p529/p529-docs.mjs`：真机探针（P529_DOCS_OK）

**改动**
- `packages/plugin-kernel/src/index.ts`：导出新类型
- `apps/desktop/src/main/index.ts`：`seedBuiltinPlugins` + `book()` 现取
- `apps/desktop/src/main/plugin-service.test.ts`：+6 条 docs 守卫，共 20 条
- `tools/mock-provider.mjs`：插件那一支扩到两个内置工具

**结果**：全量门禁 **202 文件 / 2661 用例全绿（VERIFY_EXIT=0）**；真机 **P529_DOCS_OK**。


---

## 批次 5-㉚：插件面板（看得见装了什么、能停用/卸载）+ 修掉一条过时裁定（2026-10-07）

上一批让插件「读得到用户的书」，这一批让它**看得见**。

之前插件是纯后台能力：装了、跑着、模型调得到，但用户在界面上找不到它——既不知道装了哪些，
也不知道它加了哪些能力，更没法停用一个行为异常的第三方插件。
这一批补上面板，并让它落在与技能库完全同款的模式上。

### 1. 为什么不新开一级左栏导航，而是挂在左栏一枚钮上

上一轮判断「左栏被 20+ 条逐字断言钉着，加一级风险高」——这条仍然成立，
所以插件入口沿用「技能库」那枚 `nav-row` 的形状（`data-nav-id="plugins"`），
**不是** `SIDE_NAV_GROUPS` 里的一级项。

顺带把左栏顶到 818 行（超 800 门禁），于是拆出 `PluginsNavButton.vue`：
「入口钮 + 它自己的浮层」是一个自带边界的整体，锚点只有它自己认。
顺带消掉一条隐含约定——「锚点 ref 与浮层必须配对」，配错了面板没处摆，而那种错没人测得到。

### 2. 停用 ≠ 卸载，这是插件独有的第三档

技能只有「装了/没装」。插件装上的是**一段正在跑的代码**（它的工具此刻就在模型看得见的工具表里），
所以多了中间一档：**停用** = 文件还在、随时启用回来、但这一轮不挂。

合成一个动作的话，用户想「暂时别用它」就只能删文件。

**停用怎么做到「模型真的调不到」**：不是把工具藏起来，是主进程在 `mountAll` **之前**读停用清单、
压根不挂它。差别很大——挂着但回失败的话，模型仍看得见那个工具名，会反复调它、反复拿到失败，
一个看得见却永远调不通的工具比看不见更糟。

### 3. 一个真缺陷：重挂时没先卸载，停用就成了空话

单测第一次跑就红了，且红在一条我以为「显然成立」的守卫上：

```
AssertionError: expected [ 'rhythm_check' ] to not include 'rhythm_check'
```

成因：`mountAll` 跳过停用的插件，但**没有卸载上一轮挂上去的那一份**——
于是工具仍留在表里。症状与界面撒谎完全一样：用户点了停用、界面也变了，模型照样调得到。
`mount()` 内部会对同名插件先 unmount 一次，但那**只覆盖「这轮要挂的」**，
停用的、这轮压根不碰的那些没人替它清。

⇒ `mountAll` 开头先把上一轮挂的全卸掉，再扫这一轮。

**这是这一刀最值钱的地方**：单测只查「清单里没有」就会全绿，而派发层照样通着。
守卫必须查到三层——`extraSpecs` 里没有、`has` 说没有、真调也调不到。

### 4. 真机验收（P530_PLUGINS_OK）：探针抓出「应用自己的文件被当成插件」

探针的判据落在「停用之后模型那一轮**没有**调它」——桩那一支要求
「这一轮 tools 里真的有 `rhythm_check`」才派，所以它没调就说明工具真的不在表里。

结果清单里量到**四条**，而实际只有两个插件；另外两条是：

- `.mochen-cordis-shim.mjs`（适配层）
- `.mochen-plugins-disabled.json`（停用清单）

用户看到「你有 4 个插件」，且那两条他还点不动（停用/卸载对它们没有意义）。
⇒ 清单的判据补成三条：点开头目录跳过、非目录跳过、**要有入口文件**才算数
（入口名复用 loader 的 `entryOf`，那是「什么算一个插件」的唯一一份实现）。

**还有一个更隐蔽的同族坑**：清单最初按「这一轮挂没挂」筛，而停用的插件这一轮压根没挂——
于是「已停用」那一档会**整条消失**，而用户找的恰恰是它。
⇒ 清单必须按「盘上有入口文件」列，挂没挂另问内核。

### 5. 一条被 theme-token-guard 抓出来的真缺陷

源码预览那块我写了 `background: var(--surface-sunken)`——**本仓没有这个 token**。
token 解析失败时整条声明作废，于是那块没有底色，代码直接浮在卡片上，看着像没样式。
改成与 `.skill-market-md` / `.markdown-body code` 同款的
`color-mix(in srgb, var(--text-primary) 5%, var(--surface-main))`。

这类缺陷**只有那条守卫能抓**：它扫的是「消费了却从没定义」，而肉眼看两行 CSS 完全看不出少了什么。

### 6. 更正 `market.ts` 里一条已被推翻的裁定

上一批（5-㉘）加 Cordis 兼容内核之后，`market.ts` 头注释里那句
「墨宸没有 Cordis 的 service 容器，装进去的插件注册的工具模型根本不会被看见」**已经过时了**。
它当时是对的判断，但留着会让人以为插件装不上。

已原地标注更正（原文照录以便对照），并说清**为什么这张表装的仍然是技能**：
「兼容内核能让插件跑起来」与「我们应当替用户去搜插件」是两件事——
DSH 现存插件多为编程向，且**目录拉取**那一套（网络、超时、失败重试、签名与许可核对）
尚未做，那是独立的一轮，不是顺手加个 `fetch`。

### 7. 改钉三处被钉住的产品决定（逐条说明保证没变小）

1. **slash 命令表 7 条 → 8 条**：`plugins` 排在 `skills` 之后（两者都是「装在应用里的东西」）。
   枚举表、说明表、可用性三处同步改。
2. **`plugins` 刻意不设「已开书」闸**（与 `skills` 不同）：`skills` 被闸是因为它有**书内**来源，
   没书就少一半；插件只有全局那一份，给它加书闸等于「没开书时不让用户管理插件」，
   而那正是他最想管的时候（先装好插件，再去开书写）。
3. **preload 41 条 → 45 条**：四条插件通道的**实参逐个钉死**（`[]` / `["rhythm", false]` / `["rhythm"]` / `["rhythm"]`），
   一个路径都不许出现——这一列就是那道闸的形状证明。

### 8. 本轮踩到的坑

1. **写完代码才发现测试夹具的插入点错了对象**：`useBookStore.test.ts` 用的不是
   `async () => {...}` 那档 mock，而是 `offLimits(...)` 那一档；我的批量脚本按前者找锚点，
   结果把四行插进了**中间某个函数体里**。tsc 报 `TS1005` 才暴露。
   ⇒ 批量改夹具前必须先确认**每一份的形状**，不能假定它们同源。

2. **我写的守卫里有两条判错了对象，各错一次**：
   ① 「模板不许出现 `client.js`」——红的是那句**给用户看的人话**（「一个目录 + 一份 client.js」），
      而人话是该留的；钉在 **script** 上才对（script 才可能去拼路径）。
   ② 「三颗钮都用 `isBusyOn`」——红的是「看源码」那颗，它本来就不该受 `busyDirName` 管
      （读源码不会与停用/卸载抢同一个 in-flight）。拆成两条分别钉才对。

3. **共享选择器让 `ruleBlock` 咬到错的块**：`.plugin-card-tools, .plugin-card-reason { … }` 写成一条，
   `ruleBlock(css, ".plugin-card-tools")` 匹配到的是那个**共享块**，
   于是「这里撤掉了截断」的断言验的不是自己那条规则。
   ⇒ 拆成两条独立规则（这本来就是更清楚的写法），并在注释里记下为什么。

4. **我把清单逻辑写成了不可单测的形状**：本来该把「什么算一个插件」那条判据从
   `registerPluginIpc` 里提出来当导出纯函数，却在一开始直接引用了不存在的 helper。
   ⇒ 判据要能单测，就先把它从装配层里摘出来。

### 本轮改动清单

**新增**
- `packages/contracts/src/plugin.ts`：`PluginRef` / `PluginListResult` / 目录名守卫
- `apps/desktop/src/renderer/src/stores/usePluginStore.ts`
- `apps/desktop/src/renderer/src/components/PluginPanel.vue`
- `apps/desktop/src/renderer/src/components/PluginsNavButton.vue`
- `apps/desktop/src/renderer/src/styles/plugin-panel.css`
- `apps/desktop/src/renderer/src/components/plugin-panel-wiring.test.ts`：19 条
- `.mochen-tmp/p530/p530-plugins.mjs`：真机探针（P530_PLUGINS_OK）

**改动**
- `packages/contracts/src/{ipc.ts, index.ts, market.ts}`
- `apps/desktop/src/main/plugin-service.ts`：停用/卸载/读源码/`pluginListRows`/`registerPluginIpc`（+11 条守卫，共 32 条）
- `apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/renderer-api.ts`
- `apps/desktop/src/renderer/src/{utils/side-nav.ts, utils/slash-commands.ts, stores/useAgentStore.ts, components/LeftSidebar.vue, styles/motion.css, styles.css}`
- 8 份 `window.mochen` 测试夹具补上四枚插件方法

**结果**：全量门禁 **203 文件 / 2692 用例全绿（VERIFY_EXIT=0）**；真机 **P530_PLUGINS_OK**（15 项）。

## 批次 5-㉛ · 插件与技能改成独立整页（2026-10-07）

**用户裁定**：看完 5-㉚ 的插件浮层截图后，附了一张 DeepSeek Harness 插件市场的图并说
「插件和技能，我想要是这样的单独页面的」。

### 1. 为什么是整页，不是把浮层放大

两条理由，第二条才是根本的：

1. **宽度**：页内要做的事有四件——切页签、搜、筛、铺卡片网格。浮层的宽度上限是落点算式给的
   `min(limitPx, spacePx)`，本来就只有屏幕那么宽（`skill-browser` 当时为此把 `limitPx`
   单独放宽到 640，插件面板再没有第二处余地）。
2. **性质**：插件与技能本来就是一块**有生命周期的区域**，不是一个从某颗钮弹出来的动作结果。
   设置中心早就是整页了，插件与技能是同一类东西。

⇒ 走与设置中心完全同款的路子：`currentView === "extensions"` 是唯一真身，整页切换，不住 `Teleport`。

### 2. 两个浮层合成一页两枚页签

之前「技能库」与「插件」各是一个浮层、各自一块地方看。它们本来就是一件事的两面（都给对话加能力），
分两个浮层等于让用户自己记住「哪个是哪个」。

- `layoutStore`：`AppView` 加 `"extensions"`，新增 `ExtensionsPage`（`"plugins" | "skills"`）、
  `extensionsPage` ref、`showExtensions(page)` action。
- **页签值为什么住 layout 而不住页面局部 ref**：左栏两枚钮、两个斜杠命令、页面自己的页签
  三者要指着**同一处**，否则从命令进来会落在与钮不同的一页上。
- `App.vue`：`<ExtensionsPage v-else-if="currentView === 'extensions'" />`，与 `SettingsPage` 同层。
- 左栏两枚入口合到新组件 `ExtensionsNavRow.vue`（`PluginsNavButton.vue` 退役）。
  **顺带一处顺序变化**：原本是 技能库 / 数据统计 / 插件，现在是 技能库 / 插件 / 数据统计，
  好让指向同一页的两枚相邻。

### 3. 浏览条件按页各管一份（写了又改掉的一版）

第一版把搜索词与筛选档做成了整页共用，随后改掉：同一个筛选档在两页含义不同
（插件的「已装」= 没停用且装得上；技能的「已装」 = 盘上有），
共用一格会出现「在插件页顺手点了已装，切到技能页只剩已装的」——用户没要求过这件事，却发生了。

而搜索框只有一个、切页签时显示的那一个字串也只有一格，所以 `useExtensionBrowse` 的 state 是
`{ plugins: {draft, query, filter}, skills: {draft, query, filter} }`：**每页各带一份**，
于是「页签切换 = 换了一个清单，上一页的条件不该套在下一页上」这句在数据结构里成立，
而不是靠每个调用点记得手动重置。

`draft` 与 `query` 分开（敲字不筛、按搜索才筛），这条与技能市场同款。

### 4. 筛选档：技能那页按分类切，插件那页只有两档

先写的是「刻意不按分类切」，理由是两套分类摆同一页会混淆。**这一版错了**，改掉：

技能那页把「盘上」与「市场清单」**并成了一张表**（见下节），于是只剩**一套**分类
（市场条目有 `category`，盘上非市场条目的 `categoryLabel` 是「技能库」）。
冲突的前提不存在了，分类筛选自然该有：

```ts
export const SKILL_FILTERS = ["全部", ...MARKET_CATEGORIES, "技能库", "已装"];
export const PLUGIN_FILTERS = ["全部", "已装"];   // PluginRef 里没有类别字段
```

市场那五个直接从 `MARKET_CATEGORIES` 取，不另写一份——另写一份的话，加一个分类要改两个地方，
而漏改的那一个会让那个类别永远筛不出来。

### 5. 技能那页：两张表按目录名并成一行（本轮最要紧的一处）

市场装上之后，那份技能就落进了全局 skills 目录，于是它**同时**出现在「盘上那张表」与
「市场那张表」里。各出一行的话，同一个技能在页面上出现两次、两枚钮还不一样
（一枚装/卸、一枚挂入/取下）——用户得自己想哪张卡才是真的那一份。

这与 5-㉚ 探针在旧浮层里抓到的「清单混进 shim 与停用清单」是同一族：**两份来源没合就端上桌**。

- `skillEntries()` 先走 `library`（按主进程给的原序），用 `joined` 集合记住已并过的 `dirName`；
  再走 `market`，已并过的 `continue`。
- **哪一份在生效不在渲染层重算**：主进程的 `mergeSkillRefs` 已按目录名去重且**书内优先**，
  所以 `library` 里每个目录名只有一条、那条就是要挂入的那份。这里只按主键 join。
  守卫反向钉 `not.toContain('source === "book"')`——重算优先级就是第二份判据。
- 一次并行之后一行上**两枚钮都在**：`挂入/取下`（本轮生效，重启清空）与 `装上/卸掉`（落盘，全局到处能用）。
  合成一枚就是把「装在盘上」与「这一轮生效」混成同一个「已装」，而那是两种不同的期待——
  用户常常要「盘上有，但这一轮别带」。
- `shadowedByBook`（书内同名会盖掉市场那份）随行透传并上屏：用户若以为市场那份在生效，
  就会去调一个实际没生效的技能。

### 6. 退役清单（连同它们的能力一并搬走，不是删了事）

| 删掉 | 它承担的能力搬到哪 |
| --- | --- |
| `PluginPanel.vue` / `plugin-panel.css` | `ExtensionsPage` 的插件页 + `extensions.css` |
| `SkillBrowserPanel.vue` / `skill-browser.css` | `ExtensionsPage` 的技能页 |
| `PluginsNavButton.vue` | `ExtensionsNavRow.vue` |
| `utils/skill-browser.ts` | `useExtensionBrowse.skillEntries`（并表逻辑比它多） |
| `useAgentStore.skillBrowserOpen` / `openSkillBrowser()` | `layout.showExtensions("skills")` |
| `usePluginStore.open` | `layout.showExtensions("plugins")` |

「开合那一格」两处都删掉：页的显隐由 `currentView` 拥有，而那一页与当前书/线程都无关，
正是 layout 的作用域。留着 `open` 就会有两个真身，而它们可以一个说开一个说关。
守卫反向钉 `usePluginStore` 里不许再有 `open: false`。

正文的**逐字预览**（`details`/`summary` + `pre`）与 `shadowedByBook` 警告都搬到了新页，没丢。

### 7. 改钉两份退役守卫（逐条对应，保证没变小）

`plugin-panel-wiring.test.ts`（19 条）与 `skill-market-wiring.test.ts`（21 条）退役，
新的 `extensions-page-wiring.test.ts`（41 条）逐条接住：

- 已停用/已装那一态只来自主进程 → script 不许 `.disabled =` / `.installed =`
- 动作只递目录名 → browse 的 script 里只有 `row.dirName`，无路径拼接
- 列不出来时不许同时摆「真的没有」→ 空态分三档，「没列出来」那档不许吞下一档的话
- 出处/许可/书内同名会盖掉 三句都在卡上，且正文预览摆逐字原文
- 出处与警告不复用两行截断 → `.extension-card-warn` 显式撤掉 line-clamp
- 动作结果用 `role="status"` → `.extensions-notice` 带 `role="status"`
- 正文预览自己限高并滚动 → 像素级 `max-height` + `overflow-y` + `pre-wrap`
- 装卸完市场与技能库两张表都要刷 → `useSkillMarketStore` 的两条 finally（未动，照钉）
- 挂入技能这一轮真的发得出去 → `ContextMeter` 喂真实名单（未动，照钉）
- 合成器 `min(limitPx, spacePx)` 那条底线还在服务别的浮层 → 照钉

**有一条形状变了但保证没变小，说清楚是哪一条**：旧浮层把插件分成「在跑的 / 已停用 / 装不上的」
三组标题。现在是一张网格 + 两枚徽标。三者**都还在「全部」那一档里看得见**，
而徽标就长在各自那张卡上——从「翻到第三段去找」变成「一眼看见」，可辨识性是升的。

### 8. 真机（两轮探针 + 两张截图）

**`p531-extensions.mjs`（P531_EXTENSIONS_OK）**——真点击走 `Input.dispatchMouseEvent`，等真实条件：
点左栏「插件」进来就在插件页 / 整页而非浮层（无 `role=dialog`、未 Teleport、左栏不渲染）/
页面跨满 1440px / 切页签 / 敲字不筛按搜索才筛 / 「已装」筛选后每行都带「挂入」钮 / 截图 2160×1353 像素自证通过。

**`p531-skill-merge.mjs`（P531_SKILL_MERGE_OK）**——先清场再从零走一遍（可重复跑）：
装之前盘上为空且第一张只有「装上」一枚钮 → 真点「装上」后 `listSkills()` 回 `global:chapter-intent` →
**卡片总张数 5 → 5 没多出那张**（并表成立）→ 并成的那一行上**两枚钮都在** → 「已装」筛出 1 张 →
真点「挂入」后那颗钮变「取下」且 `aria-pressed=true`。

**真机这一轮抓到四个问题（三个是我这版引入的）**：

1. **页面落在左栏那一格，宽度只有 286px**——`.desktop-shell` 是三栏 grid，
   而 App.vue 把本页与 `SettingsPage` 摆在同一层；设置页靠 `width: 100vw` 绕过了同一件事，
   我这页没写，于是成了 grid 的第一个格子，卡片网格被压成一列、页签都点不到。
   ⇒ 改用 `grid-column: 1 / -1`（`100vw` 在有滚动条时多出一条横向溢出），并钉住。
2. **出处被截断了**：真机量到只剩「改编自 linhut/dsh-skills …」。我给它写了单行 + 省略号，
   而出处是「改编自 linhut/dsh-skills 的 brainstorming（源自 obra/superpowers, MIT）· MIT」——
   出处被截一半等于没写（旧浮层那条守卫的原话）。⇒ 撤掉 ellipsis 与 nowrap，并钉「连省略号都不许」。
3. **装完那句写的是「去技能库里把它加入这一轮的上下文」**——那是技能库还是另一个浮层时的话；
   现在这张卡就摆在这一页上，「去技能库」是把用户往他已经在的地方赶。
   ⇒ 改成「这张卡上点「挂入」才能加进这一轮的上下文」，并在主进程那条守卫里钉死不许出现「去技能库」。
4. **「盘上有但这一轮没带」那一档没有任何徽标**——重启后「本轮已挂入」清空，于是那一行
   只剩两颗钮，与「可以装」的差别不够显眼。⇒ 徽标补成三枚且穷尽（本轮已挂入 / 在盘上 / 可以装）。

另外一处纯视觉修正：出处那块先给了浅灰底，真机截图看下来**比标题还重**——
附属信息该靠字号与颜色退后，不该靠一块底；卡片头的 `align-items` 也从 `center` 改成 `flex-start`，
否则出处三行时徽标正好盖住第二三行（那正是问题 2 换个姿势复发）。两条都钉住了。

### 9. 本轮踩到的坑

1. **`extensions-tab` 的词边界咬到了 `extensions-tab-count`**：`tagAttributes` 用
   `class="[^"]*\bextensions-tab\b` 匹配，而 `-` 是非词字符，所以 `extensions-tab-count` 里
   `tab` 与 `-` 之间**有**词边界——两枚页签各带一个计数 span，于是断言数出 4 个而不是 2 个。
   ⇒ 改名 `extensions-count` 断开子串。（同一个工具的另一面：`extensions-tabs` 里的 `extensions-tab`
   后接 `s`，两侧都是词字符，`\b` 不成立，所以容器没被误命中。）

2. **`styleSource()` 只能读 `styles/` 下的文件**：`styleSource("styles.css")` 会去 `styles/styles.css`，
   直接 ENOENT。根 `styles.css` 另用 `readFileSync(new URL("../styles.css", import.meta.url))` 读。

3. **探针的夹具前提是一次性的**：`p531-skill-merge.mjs` 原本假设「盘上是空的」，
   跑完第一轮之后前提就不成立了，第二轮三条断言一起红——而红的是**探针**，不是产品。
   ⇒ 探针开头自己清场（走 `window.mochen.uninstallMarketSkill` 复位夹具，
   被测的那几步仍全是真点击），于是可重复跑。

4. **我不该在同一个文件里同时改注释缩进**：`skill-market-service.ts` 那次 `edit` 把注释顶到了
   函数体外层，prettier 之后才发现。⇒ 注释要么整段换、要么整段留。

### 本轮改动清单

**新增**
- `apps/desktop/src/renderer/src/components/ExtensionsPage.vue`
- `apps/desktop/src/renderer/src/components/ExtensionsNavRow.vue`
- `apps/desktop/src/renderer/src/stores/useExtensionBrowse.ts`
- `apps/desktop/src/renderer/src/styles/extensions.css`
- `apps/desktop/src/renderer/src/components/extensions-page-wiring.test.ts`：41 条
- `.mochen-tmp/p531/`：`p531-extensions.mjs`（P531_EXTENSIONS_OK）、
  `p531-skill-merge.mjs`（P531_SKILL_MERGE_OK）、`p531-shot-skills.mjs`、`p531-skills-on-disk.mjs`

**删除**（均走 `mavis-trash`）
- `components/{PluginPanel,PluginsNavButton,SkillBrowserPanel}.vue`
- `styles/{plugin-panel,skill-browser}.css`
- `utils/skill-browser.ts` + `skill-browser.test.ts`
- `components/{plugin-panel-wiring,skill-market-wiring}.test.ts`

**改动**
- `apps/desktop/src/renderer/src/stores/layoutStore.ts`（`AppView`/`ExtensionsPage`/`showExtensions`）
- `apps/desktop/src/renderer/src/stores/useAgentStore.ts`（命令改指 layout；删 `skillBrowserOpen`）
- `apps/desktop/src/renderer/src/stores/usePluginStore.ts`（删 `open`）
- `apps/desktop/src/renderer/src/components/{App,LeftSidebar}.vue`、`styles/{styles.css,motion.css}`
- `apps/desktop/src/main/skill-market-service.ts`（装完那句文案）
- `apps/desktop/src/renderer/src/stores/useAgentStore.skills.test.ts`（改钉视图切换）
- `apps/desktop/src/renderer/src/components/overlay-chrome.test.ts`（钉住两个浮层退役）
- `apps/desktop/src/main/skill-market-service.test.ts`（+1 条：不许出现「去技能库」）

**结果**：全量门禁 **201 文件 / 2700 用例全绿（VERIFY_EXIT=0）**；
真机 **P531_EXTENSIONS_OK** + **P531_SKILL_MERGE_OK**，截图两张像素自证通过。

## 批次 5-㉜ · 左栏恒定，技能库/插件只换中栏那一格（2026-10-07）

**用户指正**（在工作区整窗截图上框住左栏的「技能库 / 插件」两枚钮）：
「这两个是点开技能库就是技能库的单独页面，点开插件就是插件的单独页面，但是，
**不是重新创建侧边栏还是有的，然后旁边变成了那个技能库或插件**。」

### 1. 5-㉛ 做错了什么

那一版把两样东西做成 `currentView === "extensions"` 的整页。真机点进去**左栏整个消失**，
右栏也跟着没，只剩那一页铺满 1440px。

缺的是这一层：**左栏是恒定的导航**。工作台里任何一个时刻，左边那栏都在——
它是「我在这份软件的哪儿」这根轴，不是一个可以被内容页顶掉的容器。
技能库与插件是「左栏某两枚钮通向的那个地方」，它们换的只是**中栏那一格**，
右边那一栏（文稿 / 浏览 / 作品资料）跟它们没关系，不该跟着没。

更根本的是我漏读了用户那句话的后半句：他说「点开技能库就是技能库的单独页面，
点开插件就是插件的单独页面」——**各自一个页面**，不是一页两枚页签。
我做了页签，等于让他在一个地方选、再点一次才能到；可左栏那两枚钮已经替他做完这件事了。

### 2. 改法

| | 5-㉛（错） | 5-㉜（对） |
| --- | --- | --- |
| 视图真身 | `AppView` 加 `"extensions"` | `AppView` 退回 `workspace \| settings`；新增 `CenterView = "chat" \| "skills" \| "plugins"` |
| 动作 | `showExtensions(page)` | `showCenter(page)`，顺手 `currentView = "workspace"` |
| 页签 | 一页两枚 | **删掉**（`.extensions-tabs` / `.extensions-tab` / `.extensions-count` 三段 CSS 一并删） |
| 标题 | 页签 | `{{ title }}`（技能库 / 插件） |
| CSS | `grid-column: 1 / -1` 跨满三栏 | **撤掉**，改 `min-width: 0` |
| 左栏高亮 | 两枚钮没有 active | 两枚各绑 `centerView`；「工作台」加 `&& centerView === 'chat'` |

**为什么用 `CenterView` 一个枚举而不是两个 boolean**：`showSkills` / `showPlugins` 会出现
「两个都 true」那种无解状态，而「中栏是 CenterColumn 与本页互斥的那一格」这件事只该判一次。

**为什么 `showCenter` 要顺手拨回 `currentView = "workspace"`**：人在设置页（整页、没有中栏）
时点左栏那两枚钮，不拨回来的话**点了像没反应**——设置页把整个窗口铺满了，中栏压根不在。

**为什么 `showWorkspace` 要复位 `centerView = "chat"`**：Esc 关掉设置之后中栏若还摆着技能库，
而左栏亮的是「工作台」，两枚都在说「你在这儿」。

### 3. 高亮互斥这一条是连带改出来的

左栏哪一枚亮着，就是在说「你在这儿」。技能库/插件退回中栏后，`currentView` 仍是 `workspace`，
于是「工作台」那枚会与它们**同时亮**——用户只会当成渲染坏了。
所以「工作台」那条判定必须连带改成 `currentView === 'workspace' && centerView === 'chat'`。

### 4. 改钉（逐条说明保证没变小）

- **`.extensions-page` 不许再有 `grid-column: 1 / -1`**：那条是 5-㉛ 为跨满三栏加的。
  留着它会让中栏那一页又铺满整个窗口——正是被指正的症状换个写法复发。
- **`dead-css-guard` 抓出三条孤儿 CSS**（`.extensions-tabs` / `.extensions-tab` / `.extensions-count`）：
  页签删了之后它们没有任何元素会带，规则一行也匹配不到。**删掉而不是加豁免**——
  留着唯一的效果是让下一个人以为这里还能加页签。
- **`left-sidebar-nav.test.ts` 的工作台 active 断言**：整串字面量改成容忍折行的正则
  （见下面第 2 条坑）。
- **`useAgentStore.skills.test.ts`**：`/skills` 与 `/plugins` 两条从「切整页」改钉「切中栏」，
  并补钉 `currentView` 仍是 `workspace`（左栏不消失是保证没变小的关键那一半）。
- **`.extensions-page` 的 `min-width: 0`**：中栏是 `minmax(320px, 1fr)`，
  grid item 不给 0 就不肯缩到内容宽。
- 其余 40 余条（状态只来自主进程、只递目录名、空态分三档、出处/许可/书内同名警告、
  逐字正文预览、`role="status"`、预览限高、两张表按主键 join、两枚钮）**原样保留**。

### 5. 真机（`p532-center-pane.mjs` → **P532_CENTER_PANE_OK**，15 项）

真点击走 `Input.dispatchMouseEvent`，每处等待由真实条件决定：

- 起点 `active=["workspace"]`，左栏 + 对话 + 右栏都在
- 点「插件」：`left=286px` **还在**、`right=490px` **还在**、中栏换成插件页、`page=664 shell=1440`（只占中栏那格）
- 高亮 `active=["plugins"]`，**只有**它
- 点「技能库」：进的是**另一个**页面（标题变「技能库」），`active=["skills"]`，
  `.extensions-page` 内 `role="tab"` 数为 **0**
- 点「工作台」回到对话，`active=["workspace"]` 且只有它
- 截图 2160×1353

### 6. 本轮踩到的坑

1. **prettier 折行让「整串字面量」断言失效**：
   `:class="{ 'is-active': layout.currentView === 'workspace' && layout.centerView === 'chat' }"`
   按 printWidth 100 折成三行，`toContain(整串)` 于是不成立——
   而红的原因变成了「格式变了」而不是「判定变了」。⇒ 跨行属性用
   `/'is-active': layout\.currentView === 'workspace' &&\s+layout\.centerView === 'chat'/`。

2. **探针猜 class 名字，崩了却被当成产品缺陷**：右栏真身是 `.editor-pane`，
   我第一版写 `'.document-pane' || '.right-pane'`，探针直接崩在 `s.right.width` 上。
   那次崩说明的是**选择器写错了**，不是右栏没渲染。
   ⇒ 先 grep 组件根 class，再写判据；崩溃点要与「产品没渲染」区分开。

3. **「这一页没有页签」这条判据太宽**：查全篇 `[role="tab"]` 必然命中右栏
   DocumentPane 的「文稿 / 浏览 / 作品资料」（它本来就是一组 tab）。
   ⇒ 判据要落在被测的那一块上：`.extensions-page [role='tab']`。

### 本轮改动清单

**改动**
- `apps/desktop/src/renderer/src/stores/layoutStore.ts`：`AppView` 退回两值；
  新增 `CenterView` / `centerView` / `showCenter`；`showWorkspace` 复位 centerView
- `apps/desktop/src/renderer/src/App.vue`：三栏骨架恢复，中栏那一格互斥渲染
- `apps/desktop/src/renderer/src/components/ExtensionsPage.vue`：去页签、标题随落点、返回回对话
- `apps/desktop/src/renderer/src/components/ExtensionsNavRow.vue`：两枚钮各带 active
- `apps/desktop/src/renderer/src/components/LeftSidebar.vue`：工作台 active 加 `centerView === 'chat'`
- `apps/desktop/src/renderer/src/stores/useAgentStore.ts`：两条命令改调 `showCenter`
- `apps/desktop/src/renderer/src/styles/extensions.css`：撤 `grid-column`、加 `min-width: 0`、删三段页签 CSS、加 `.extensions-title`
- `apps/desktop/src/renderer/src/components/extensions-page-wiring.test.ts`（44 条，改钉）
- `apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts`（工作台 active 改钉）
- `apps/desktop/src/renderer/src/stores/useAgentStore.skills.test.ts`（两条命令改钉）

**新增**：`.mochen-tmp/p532/p532-center-pane.mjs`（P532_CENTER_PANE_OK）

**结果**：全量门禁 **201 文件 / 2698 用例全绿（VERIFY_EXIT=0）**。

## 批次 5-㉝ · 右栏不跟，这一处吃满「中栏 + 右栏」一整个页面（2026-10-07）

**用户两条批注**（同一张截图上框了两个框）：

1. 框住**中栏 + 右栏整片**：「旁边的不应该有的插件技能库，它应该是和我的作品里面那个旁边浏览的是分开的，
   **应该是一整个页面，不应该分两个页面**」
2. 单独框住**右边那一片**：「这一片技能库和插件库，应该是不会有这个的。
   **其他的地方正常有，那是正常的。这地方有，就不正常**」

### 1. 5-㉜ 只对了一半

5-㉜ 我把这一处从「整页」改成「占中栏那一格」，理由是批注①的前半句「侧边栏还是有的」。
但我只解决了「左栏别消失」，没解决「一整个页面」：

- 我让它只占中栏 ⇒ **右栏照旧渲染** ⇒ 画面上是「中栏一块 + 右栏一块」并排，
  而右栏那一块在技能库页里是空的（它那三个页签「文稿 / 浏览 / 作品资料」是**编辑器**的配套设施）。
  这正是批注①说的「分两个页面」，也是批注②说的「这地方有，就不正常」。

⇒ 两条批注是一件事的两面：**左栏恒定（不要它消失）＋ 右栏不跟（它也不该在）**，
中间那一片要**一整个**。也就是 `grid-column: 2 / -1`：跳过左栏那一列，吃掉中栏 + 右栏两格。

### 2. 改法（三处）

| | 5-㉛ | 5-㉜ | 5-㉝（对） |
| --- | --- | --- | --- |
| 左栏 | 被吃掉（`v-else-if` 那层） | 恒定 | **恒定** |
| 右栏 | 被吃掉 | **照旧渲染** ← 半对 | **不渲染**（+ 它的拖拽条） |
| 这一处的落点 | `grid-column: 1 / -1` | 无（落进中栏那格） | **`grid-column: 2 / -1`** |

- `App.vue`：`<DocumentPane v-if="!rightCollapsed && centerView === 'chat'" />`
- `App.vue`：右栏那条 `pane-resizer-right` 加同一个条件
  —— 它在时右栏那一格还留一条可拖的边，可那一格根本没有内容，边是假的。
- `extensions.css`：`grid-column: 2 / -1`，并把 `padding` 放宽到 `16px 20px`
  （这一页现在有 1154px 宽，用中栏那一档的 16px 显得挤）。

### 3. 改钉

- **`grid-column: 2 / -1` 必须钉住**：它是「跳过左栏、吃掉两格」这一条唯一的表达。
  改成 `1 / -1` 是 5-㉛ 那个被指正的错；**删掉**则落进中栏那一格，又是 5-㉜ 那个半对。
  ⇒ 断言钉住这一行字面量 + **反向**钉「不许有 `1 / -1`」与「不许有 `100vw`」。
- **`DocumentPane` 与 `pane-resizer-right` 各钉一个条件**；反向钉
  `not.toContain('<DocumentPane v-if="!rightCollapsed"')`。
- 其余 40 余条（状态只来自主进程、只递目录名、空态分三档、出处/许可/书内同名警告、
  逐字正文预览、`role="status"`、预览限高、两张表按主键 join、两枚钮、高亮互斥）**原样保留**。

### 4. 真机（`p533-full-page.mjs` → **P533_FULL_PAGE_OK**，20 项）

真点击走 `Input.dispatchMouseEvent`，三栏几何在**同一个 evaluate** 里量完：

- 起点：对话，`left=286 right=490`
- 点「插件」：`left=286` **还在**、`.editor-pane` **不存在**、拖拽条**不存在**
- **起点贴着左栏右缘**：`ext.x=286 == left.x + left.w`
- **吃满右侧**：`ext=1154`，到窗口右缘剩余 `0px`
- 卡片网格从 2 列变成 **4 列**（`271px 271px 271px 271px`）——宽度真的吃到了
- 左栏 `active=["plugins"]`，只有一枚
- 点「技能库」：另一个页面，同样 1154px 整页、无右栏、`active=["skills"]`、5 张卡
- 点「工作台」回对话：**右栏回来了**（490px）——批注②说的「其他地方正常有，那是正常的」
- 截图 2160×1353

### 5. 本轮踩到的坑

**注释里的坏字节，三道关卡全都查不出来。** 这一轮我打出了六处替换字符（全在中文长注释里，分别是「不□ 0」「就成□「两个页面」」「拖拽条也□跟着」这几处——坏的那一个字正是句子里的关键字）。
prettier 不管、tsc 不管、vitest 也不管——坏字节不是语法错误，它只渲染成一个空心方框。
而它出现的地方正是**解释「为什么这么做」的那几行**。

⇒ 两件事：
1. 收尾必须**单独扫一遍 `\uFFFD`**，且清单要**显式列出本轮改动过的每个文件**，
   不能靠「我记得改过哪些」——我第一版就漏了测试文件（它不在那次的清单里）。
   脚本见 `.mochen-tmp/p533/scan-fffd.mjs`。
2. **修的时候按 `\uFFFD` 定位，不要拿坏字节去匹配**：`edit`/`match` 解不出那串字节，
   用 `src.replace(/前面\uFFFD+后面/g, "正确的整串")`。还有一条：别把空格算进模式，
   我第一版写 `/不\uFFFD+0/` 而实际是 `不\uFFFD+ 0`，没命中又得再跑一轮。

### 本轮改动清单

**改动**
- `apps/desktop/src/renderer/src/App.vue`：`<DocumentPane>` 与右栏拖拽条各加 `centerView === 'chat'`
- `apps/desktop/src/renderer/src/styles/extensions.css`：`grid-column: 2 / -1`、`padding` 放宽
- `apps/desktop/src/renderer/src/components/extensions-page-wiring.test.ts`（改钉第一组 + 新增两条）

**新增**：`.mochen-tmp/p533/{p533-full-page.mjs, scan-fffd.mjs, fix3.mjs}`

**结果**：全量门禁 **201 文件 / 2700 用例全绿（VERIFY_EXIT=0）**；真机 **P533_FULL_PAGE_OK**。

## 批次 5-㊱ · 技能库补「已安装」+ 清单从 5 条扩到 20 条 + 第三个内置插件 roster（2026-10-07）

### 0. 潇潇这一轮说了两条

1. 「技能库那边应该也加一个**已安装**」
2. 「插件太少，技能库也太少，可以从**网上寻找所有开源的仓库**，看看有没有我这个软件需要的
   插件或技能，**全部加入到里面**」

第 2 条是这一批的主体。动手前先把「能收的」与「收不进来的」分开，理由逐条钉在代码与守卫里。

---

### 1. 「已安装」不是加一枚徽标，是把一个状态的名字统一

改之前那三枚徽标是「本轮已挂入 / **在盘上** / 可以装」，筛选档写的是「**已装**」。

用户说的是「已安装」。差在哪：

- 「在盘上」说的是**事实**（「它躺在磁盘上」），不是**状态**；
- 而同一张卡上那枚钮写的是「装上 / 卸掉」——徽标与钮各说一套，
  用户得自己推断「盘上有」就是「装上了」；
- 「已安装 / 卸掉」「可以装 / 装上」才是同一件事的两头。

所以这一处改的是**词**，不是加一行元素：

| | 改之前 | 改之后 |
| --- | --- | --- |
| 技能卡第二枚徽标 | 在盘上 | **已安装** |
| 技能页筛选档 | 已装 | **已安装** |
| 插件页筛选档 | 已装 | **已安装** |
| 技能页空态那句话 | 现在没有盘上已装的技能。 | 现在还没有已安装的技能。 |

**档名提到一个常量 `INSTALLED_FILTER`**，两页共用。理由是「同一个状态在两页叫两个名字」
正是界面在少说的一件事：他在插件页认得「已装」，切到技能页看到「在盘上」，
会以为那是另一种状态。而常量让「改档名」这件事只有一处可改——
模板里的判定现在走 `conditions.filter === INSTALLED_FILTER`，
守卫**反向钉住**模板里不许再出现字面量 `已装` / `已安装`。

（口径仍按页各判：插件那一档是「没停用且装得上」，技能那一档是「盘上有」。
**档名全应用一个词，口径各页各判**——这与 5-㉜ 那个「条件按页各管一份」是同一条纪律的两面。）

---

### 2. 清单 5 → 20：先定「什么样的仓库收得进来」

搜下来能用的上游（**逐个核实过 LICENSE**）：

| 仓库 | 许可 | 它给什么 |
| --- | --- | --- |
| `zenstory-ai/oh-story-claudecode` | MIT（7.2k★，13 个 skill） | 网文全流程：钩子技法、人物设计、大纲排布、章纲、伏笔台账、去 AI 味、审稿 |
| `PenglongHuang/chinese-novelist-skill` | MIT | 章节结构、悬念钩子、人物塑造、情节结构模板、「展示而非讲述」 |
| `YuppyChen/novelist-test` | MIT | 风格拆书（从自有样本拆表达习惯） |
| `LikC1606/deep-research-skill` | MIT | 证据优先的检索：先定需要什么证据、再读正文、事实/推断/未知分开 |
| `linhut/dsh-skills` | MIT（已在用） | brainstorming / writing-skills |

**收得进来的前提是许可明确。** 网上中文写作 skill 包不少，其中相当一部分没写许可或没写清——
那种一条也收不进来，不是漏收，是「照抄上游许可」这条要求在它们身上无法满足。
它们不写进 `skill-catalog-origins.ts` 的 `UPSTREAM` 表，于是也就没有一条技能能引用它们。

另外两条不收（与 5-㊰ 同一理由）：

- **带运行时的**（Python 引擎、shell 脚本、导出器）：墨宸没有执行路径，
  抄过来只会得到一份「照着做」却什么都做不了的说明书；
- **上游的 hooks / agents / Dashboard**：oh-story 那套靠 `/story-long-write`、
  `$story-setup` 与 shell hook 协作，本仓的流程在**软件里**、不在命令行上。
  收进来模型会照着找一个不存在的命令。⇒ 这一条还变成了守卫（见 §3）。

**只搬方法，不搬原文**：那几步追问、那几条检查项、那张表格的列；
不搬上游的句子、不搬命令与工具名。每一份的 frontmatter 之外，正文第一句就写明「改编自谁」。

**20 条按五个分类落成五份文件**：`skill-catalog-{idea,structure,style,proof,research}.ts`，
聚合那份 `skill-catalog.ts` 只负责接起来。拆文件的理由是行数预算：
二十条正文写在一个文件里会顶破 800 行，而预算破了之后最容易被绕过的是「拆到别处」——
拆到别处就会有人开始想「这几条是不是可以合并」。按 `MARKET_CATEGORIES` 的声明序拆，
分类与文件一一对应，加一条新技能时**落哪个文件没有得选**（守卫钉住这条）。

| 分类 | 条数 | 目录名 |
| --- | --- | --- |
| 构思 | 4 | `chapter-intent` `open-book-brief` `hook-and-promise` `character-arc` |
| 结构 | 5 | `world-rulebook` `five-step-outline` `chapter-blueprint` `truth-vs-reader` `structure-atlas` |
| 文风 | 4 | `dialogue-voice` `deslop` `show-not-label` `style-handbook` |
| 校对 | 4 | `continuity-check` `promise-ledger` `read-as-first-reader` `pov-audit` |
| 资料 | 3 | `fact-check` `research-crosscheck` `deconstruct-best` |

---

### 3. 守卫重写：一条会**安静**失效的旧守卫

5-㊰ 那条许可是这么判的：

```ts
const copied = origin.includes("dsh-skills") || origin.includes("superpowers");
expect(license).toBe(copied ? "MIT" : "本仓自有");
```

清单扩到五个仓库之后，它**立刻作废，而且作废得非常安静**：新抄来的那些 origin
一个都不含那两个名字，于是全被判成「本仓原创」——**守卫照样全绿**，
代价是十几条抄来的技能在卡片上集体冒领了「本仓自有」。

新的判据换成了**前缀**，而不是仓库名单：

- 开头是「本仓原创」⇒ 原创 ⇒ 许可必须是「本仓自有」；
- 否则必须写成「改编自 `<owner>/<repo>` 的 `<上游那一条>`」⇒ 抄来的 ⇒ 许可照抄上游；
- 守卫从 `origin` 里取仓库名，再去**正文**里找同一段——出处只写在卡片字段里、
  正文里不交代，用户读到的技能就答不出「谁写的」。

**那三个字面量在守卫里另写一份，不从 `skill-catalog-origins.ts` import。**
理由写在测试文件头上：那份是被测代码。它今天写「本仓原创」、明天改成「本厂自研」，
从它 import 的守卫会跟着改，然后继续全绿——
**一个会跟着被测对象一起改的守卫不是守卫**。

另外三条新守卫：

- **出处里不许带许可**（真机撞出来的）：卡片那一行是 `origin · license` 两段拼的，
  而第一版的 `fromUpstream` 写成「…的 story-long-write（MIT，钩子技法）」，
  于是用户读到「…（MIT，钩子技法）**· MIT**」——同一个词在同一行出现两次，
  看上去像排版没排好。⇒ 许可的真身只留 `MarketSkill.license` 那个字段。
- **正文里不许出现上游的 slash 命令**（`/story-`、`$story-`、`storyctl.py`…）：
  墨宸没有那些通路，写进去等于教模型去调不存在的东西。
- **五个分类恰好覆盖 `MARKET_CATEGORIES`**，且每份文件里的每一条 `category` 都与文件名对得上。

**变异验证**（`.mochen-tmp/p534/mutate-catalog.mjs`）：把一条**抄来的**技能的
`license` 从 `UPSTREAM_LICENSE` 改成 `OWN_LICENSE` ⇒ 红的正是
「本仓原创的许可是「本仓自有」，抄来的照抄上游许可」那一条，报
`research-crosscheck 的许可: expected '本仓自有' to be 'MIT'`。
旧守卫在这个变异下是**全绿**的。

---

### 4. 插件那一半：为什么「从网上找插件」这条路眼下不成立

网上能找到的是别人写的**技能**（`SKILL.md`）。**没有哪一个开源仓库会写墨宸的插件格式**
（一个目录 + 一份 `client.js`，走 Cordis 兼容内核挂载）。
所以「从网上收插件」这条路现在**不成立**，能收的只有技能——那半在清单里。

插件这一半能做的是：**把用户确实缺、而模型自己做不到的那件事补成内置插件**。
判据是 5-㉘ 写在 `builtin-plugins.ts` 头上那条：模型自己读十几万字去数段落，
既慢又贵还容易算错；插件在插件这一侧把全书过一遍，只把结论交回模型。

于是加了第三个内置插件 **`roster`**（工具 `book_cast`）：

- 花名册从 `characters/` `factions/` `locations/` `glossary/` 四个目录长出来，
  每一篇的标题就是一个名字；
- 对全书 `chapters/` 的正文数：这个名字出现几次、**最后一次出现在哪一章**；
- 单独点出「**有档案但全书正文一次也没出现**」的那些——这才是这张表要回答的问题；
- 补的正是 5-㊱ 那一批技能反复提到、而模型又看不见的那件事：谁很久没出场了。

**按目录而不是按 `kind` 判花名册**：`kind` 是主进程给的类别标签，`relPath` 是文件事实；
判文件事实不会因为某一本书的 kind 填错就整份列空。

三个判定（名字长度下限、按**序号**而不是路径字符串排、逐篇单独判最后出现）都写在插件源码里，
且**只有这一份**（铁律 6），没有被搬进任何共享模块。

### 4.1 写这个插件时自己抓到的两个真问题

1. **`scan` 里最后出现位置算错**。写成 `if (count > 0 && lastAt < i) lastAt = i` 时，
   名字只出现在第 1、3 章，第 2 章也会被算成「最后出现」——累计的 `count` 不代表本章有它。
   回执于是会说「最后出现在第 3 章」而数字指向第 2 章，两处自己就对不上。
   ⇒ 改成逐篇单独判（`inThis`）。
2. **「档案都建了但正文里一个都没出现」掉进了「没有花名册」那一档**。
   而那两件事要给的建议**正好相反**：前者要去写正文，后者要去建档案。
   ⇒ 把 `rosterCount`（档案上一共多少个名字）与 `total`（扫出来几个）分开记，
   守卫里反向钉住「不许说成列不出花名册」。

### 4.2 夹具不像真书，测的是另一个世界

`builtin-plugins.test.ts` 的 `writeBook` 原本把 title 写成整条 relPath
（`characters/阿禾.md` ⇒ `characters/阿禾`）。对 rhythm / outline 无害（它们只用 relPath），
所以它一直是对的；roster 按 title 去正文里数名字，夹具立刻把名单数成空表，
插件回一句「列不出花名册」——**红的是夹具，不是插件**。

真书的 title 是 frontmatter 的 title，没有就取文件名（`fs-store/scan.ts` 的 `docMetaOf`）。
⇒ 夹具改成照抄那一条规则。夹具要像真书，否则它测的是另一个世界。

---

### 5. 真机

**`p534-skill-library.mjs` → P534_SKILL_LIBRARY_OK（31 项）**

- 技能卡 **20 张**（5-㊰ 那版只有 5 张）
- 筛选档正好是 `["全部","构思","结构","文风","校对","资料","技能库","已安装"]`
- 徽标集合是 `{已安装, 可以装}`，**没有「在盘上」**；每张卡至多一枚
- 出处那行 20 张全带「来源 · 许可」
- 五个分类逐个点开：4 / 5 / 4 / 4 / 3 张，**没有一枚死 chip**
- 「已安装」那档 2 张，两张的徽标都是「已安装」，**没有一张是「可以装」**
- 真装一条（`把 AI 腔一条条挑掉`）→ 徽标真的翻成「已安装」、钮改口「卸掉」、
  多出「挂入」那枚、逐字正文预览还在
- **自己清场**：卸掉之后徽标翻回「可以装」，这一份可以反复跑
- 截图 2160×1353，期望像素与实际像素打出来自证

**`p534-cast.mjs` → P534_CAST_UI_OK__TURN_NOT_VERIFIED（13 项，**出口码 2**）**

- 主进程启动日志：`[插件] 内置插件已就位：roster` / `[插件] 已挂载 3 个`
- 插件页上是三个：`["outline","rhythm","roster"]`，roster 那张写「给模型加：book_cast」，
  没有落到「已停用 / 装不上」那一档
- 「看源码」读得到落盘那份：工具名对得上，且带着 `from "@deepseek-ai/cordis"` 与
  `export function apply(ctx)`——它走的是与用户插件**同一条**路
- **发轮那一段本轮没有验到**，出口码 2 就是为这件事准备的：
  应用没打开作品目录时会直接拒绝发轮（实测回执「尚未打开作品目录，请先在左栏选择一本书。」），
  而「新建作品」那一步要一个**原生文件夹选择器**，headless 驱动不了。
  硬写成 FAIL 会让「环境不具备条件」与「产品坏了」混成同一个红；
  硬写成 OK 则是拿一个没验的东西冒充验过。⇒ 另出一个出口码，并把原因写在日志里。
  工具的行为（计数、没出场名单、没读到的章、一个字的名字、无章节、无档案）由 7 条单测覆盖，
  那 7 条跑的是**真插件源码 + 真 import 改写 + 真内核**。

---

### 6. 本轮踩到的坑

1. **「还原脚本」只比「自己读到的当前状态」** ⇒ `restore` 永远说 clean。
   `mutate-catalog.mjs` 的 `restore` 分支是在**自己启动时**读的当前内容算哈希，
   而那时文件已经带着变异了，于是它读到的就是变异后的那份，比自己当然相等。
   真机那次是被**下一条测试**抓到的（测试仍红），不是被还原脚本抓到的。
   ⇒ 还原必须拿**变异前**存下的字节写回去，不能现读现比。
2. **判据取错字段，看起来像产品坏了**：`b.activeTitle` 这个字段在 book store 里根本不存在
   （真身是 `meta?.title`），取到 `undefined` 也照样往下跑，
   探针于是拿一个「书名是空的」当事实往下推。**读不到不等于没有。**
3. **发送键是图标钮，没有文字**。判据写成「label 非空」⇒ 报「发送键点不到」，
   而它一直在那儿、可点。⇒ 图标钮判 `aria-label` + `disabled`。
4. **`cdp.evaluate` 的 `centerOf` 只收选择器**，我往里传了整段
   `[...document.querySelectorAll(...)].find(...)` ⇒ `querySelector` 直接抛
   「is not a valid selector」。⇒ 另开一个按表达式取元素的入口。
5. **PowerShell 的 here-string + `-Encoding utf8` 会写 BOM** ⇒ node 解析 `.mjs` 直接报
   `Unexpected token 'const'`，而报错指向文件第一行，与病根无关。
6. **用 `Invoke-WebRequest` 测桩，中文被编码坏了** ⇒ 连 5-㉙ 那条「骨架 / book_outline」
   老路径也走了默认分支，看上去像「桩的插件分支坏了」。
   ⇒ **先怀疑测法**：一条早就在用的老路径也红，多半是测法而不是被测对象。
7. **桩的 body 里工具名在 `function.name`，不在 `tool.name`**（这条 5-㉙ 已经踩过一次，
   这次记下来是因为它与 §6.6 是同一族：**先打一次真实形状再写判据**）。

---

### 7. 本轮改动清单

**新增**
- `apps/desktop/src/main/skill-catalog-origins.ts`（出处写法 + 已核实上游表 + 两个许可常量）
- `apps/desktop/src/main/skill-catalog-{idea,structure,style,proof,research}.ts`（20 条）
- `.mochen-tmp/p534/{p534-skill-library.mjs, p534-cast.mjs, mutate-catalog.mjs, scan-fffd.mjs, shot-clean.mjs, diag*.mjs}`
- 截图：`.mochen-tmp/p534/shot-534-skills-clean.png`、`shot-534-plugins-clean.png`

**改**
- `apps/desktop/src/main/skill-catalog.ts`（拆成聚合 + 头注释重写）
- `apps/desktop/src/main/skill-catalog.test.ts`（14 条：出处/许可判据重写 + 四条新增）
- `apps/desktop/src/main/builtin-plugins.ts`（第三个内置插件 `roster` + 头注释）
- `apps/desktop/src/main/builtin-plugins.test.ts`（夹具 title 对齐真书 + roster 七条）
- `apps/desktop/src/renderer/src/stores/useExtensionBrowse.ts`（`INSTALLED_FILTER`）
- `apps/desktop/src/renderer/src/components/ExtensionsPage.vue`（徽标与空态改词、判定走常量）
- `apps/desktop/src/renderer/src/components/extensions-page-wiring.test.ts`（徽标那条改钉 + 新增一条）
- `apps/desktop/src/renderer/src/styles/extensions.css`（注释里的词）
- `tools/mock-provider.mjs`（`PLUGIN_TOOLS` 加 `book_cast`；无入参工具那一支抽成 `noArgToolFrame`）

**结果**：全量门禁 **201 文件 / 2714 用例全绿（VERIFY_EXIT=0）**；
真机 **P534_SKILL_LIBRARY_OK（31 项）**、**P534_CAST_UI_OK__TURN_NOT_VERIFIED（13 项，出口码 2，原因见 §5）**。


---

## 批次 5-㊴ · 皮肤广场（2026-10-07）

用户给了一张 DeepSeek Harness 插件市场「趣味换装」分类的截图（显示「发现 GitHub MIT 开源的共 723 个」），
要求：把里面的皮肤加入墨宸、挑精选的、再适配软件、再做一个皮肤广场。

### 1. 先核实许可：5 条进，2 条不进

DSH 那些换装插件**装不进墨宸**——它们是 DSH 的 `client.js` + Cordis 插件，依赖 DSH 自己的
`--dsw-*` 令牌与 DOM 结构。所以「适配」只能是**取视觉概念、重写成墨宸自己的 token**。
取之前先逐个核实许可。**2026-10-08 更正**：原写「墨宸是能卖钱的软件，NC 类一律不进」——
「要卖」那句是上一批**我编的前提**，用户从没说过要商用、且当天明确否认过。
许可事实（那两个仓库确实是 NC）是真的；由它推出「所以不能进」缺少依据，
NC 素材改为**暂缓，等用户裁定**。

| 仓库 | 许可 | 结论 |
| --- | --- | --- |
| `d-dev0101/open-sea-skin` 公海皮 | MIT | ✅ → 皮肤「公海」 |
| `RevolutionLA/dsh-dream-skin` 梦境皮肤 | MIT | ✅ → 皮肤「幻境」 |
| `ymh0000123/dsh-theme-endfield` 终末地 | MIT（**仅代码**，视觉语言版权归鹰角） | ✅ → 皮肤「终末地」（只取色板与圆角决定） |
| `Ayase34/gal-view` galgame | MIT | ✅ → 皮肤「视窗」 |
| `elysia395/dsh-wallpaper-engine` 壁纸引擎 | MIT | ✅ → 皮肤「流玻璃」（只取液态玻璃手法，不引入任何图片资源） |
| `Small-tailqwq/dsh-deep-whale` 鲸鱼娘 | MIT 代码 + 美术 **CC BY-NC-SA 禁商用** | ❌ 不收 |
| `GGBond2424648901/deep-whale-day-night-theme` | 整仓 **CC BY-NC-SA 4.0** | ❌ 不收 |

用户截图里点名的「德什·鲸·娘」「鲸鱼女孩」正是后两个，**许可不允许搬**——
这不是「没找到」，是核实过之后主动排除的。

### 2. 皮肤 = 配色三色 + 质感四层

原来的「主题配色」只有 accent/background/foreground，十套预设彼此只差颜色。
新增四层质感，全部落成 `--skin-*` token，纯 CSS，不带图片与字体文件：

- `texture` 纹理：素面 / 细网点 / 斜织 / 纸纹
- `radius` 圆角：全直角 / 轻圆 / 大圆角
- `outline` 描边：实线 / 虚线 / 双线（宽度也跟着变——1px 的双线会糊成一条）
- `glow` 光晕：无 / 柔光 / 强光（**上限压在 0.42**：超过它按钮上的字会被自己的光吃掉）

**三条硬约束**（不是审美偏好）：

① **纹理只落容器，绝不落正文区**。编辑器正文与消息正文的背景必须仍是纯 `--surface-*`——
   背景一动，字的边缘就在抖，而那是长时间写作时实打实的疲劳源。守卫里有反向断言钉它。
② 圆角与描边走 `var()`，CSS 不许再写死像素，否则换皮肤只变一半。
③ 光晕浓度上限 0.42，保住可读性守卫那条「按钮字 ≥ 4.5:1」。

### 3. 消除第二份真相

- `themePresets` 改为**从皮肤表派生**（`appearanceSkins.filter(origin === OWN_SKIN_ORIGIN)`）。
  十套出厂配色的 id、顺序、色值一字未改，另有守卫钉着。
- 设置中心外观页的配色网格**整块退役**，换成只读的「当前皮肤 + 一枚去皮肤广场的字钮」，
  连同 dialog.css 里那批 `.appearance-preset-*` / `.appearance-swatch-*` 规则一起删
  （不留成豁免：没有元素的规则一行也匹配不到，留着只会让下一个人以为还能加回去）。

### 4. 真机撞出来的两个真缺陷（都先于本批存在）

**① 三栏塌成两行，左栏后半截点不到。**

`.desktop-shell` 是三列网格，五个直接子元素**各自只钉了 `grid-column`、没钉 `grid-row`**，
网格于是自动放置：`.extensions-page` 排到第一行，`.conversation-pane` 与 `.editor-pane` 掉到第二行。
真机量到 `leftSidebar.h = 302`（修第一处后 459）而视口 901/902，
`.left-sidebar` 是 `overflow: hidden` + 内部滚动 ⇒ y=392 往下的六枚钮落在可视区之外，
`document.elementFromPoint` 在那一带量到的是 `.desktop-shell` 而不是按钮。

**看得见、点不到**——不是「页面有点歪」。为什么之前没人发现：真机流程几乎只点技能库、
点进去就回来，从没在**那一页上**去量左栏高度。

⇒ 五处各钉 `grid-row: 1`（左栏 / 中栏 / 右栏 / 插件技能页 / 皮肤广场），守卫逐处点名。

**② 纹理渐变里写了 `rgb(#hex …)`，被浏览器静默丢弃。**

CSS 的 `rgb()` 要的是三个通道数，不是 hex。非法颜色值会让**整条声明**被丢弃，
于是表现是「换了皮肤，纹理没变」，而**控制台一个错都没有**。
真机那一条探针当时已经断言了「不是 none」，所以没抓到这个；
抓它的是我把整个 token 打印出来看了一眼（`repeating-linear-gradient(0deg, rgb(#101…`）。

⇒ 改走本文件已有的 `rgba()`；守卫改成量**颜色值本身**，并做了变异验证
（把 `rgba(ink, alpha)` 改回自己拼 ⇒ 只有新那一条红，其余全绿）。

### 5. 探针自己栽的三个坑

① **`getBoundingClientRect()` 给的是视口坐标**：那枚「换上」钮在 y=1038 而视口只有 902，
   CDP 鼠标事件打在空白处，探针量到 token 没变——**看起来像换皮肤坏了**，真相是点了空气。
   ⇒ 先 `scrollIntoView`，并在点击前断言坐标落在视口内（越界直接红，别让它伪装成「点了没反应」）。
② 同作用域两个变量同名（`const applied` 用了两次）⇒ SyntaxError，表现为「探针起不来」，
   看着像环境问题。
③ 出处那条断言我连写错四次（贪婪 `[w.-]+` 吃掉「的」、忘了剥前缀、忘了斜杠、忘了 `$`），
   每次红的位置都不同，看着像数据有问题——其中有两条其实是**产品文案漏了空格**
   （「的海洋配色」写成「的海洋配色」）。
   ⇒ 换成**不含正则**的结构化判据（按「改编自 」+ 「/」+ 「 的 」三段切），逐段各自断言。

### 6. 本轮改动文件清单

**新增**
- `packages/contracts/src/appearance.ts`：质感四层枚举 + `skin` 字段（全部带 default，老 JSON 迁移安全）
- `apps/desktop/src/renderer/src/composables/appearanceSkins.ts`：15 条皮肤 + 四张中文名表 + `OWN_SKIN_ORIGIN`
- `apps/desktop/src/renderer/src/composables/appearance-skins.test.ts`：32 条守卫
- `apps/desktop/src/renderer/src/stores/useSkinBrowse.ts`：四层筛选条件与派生行
- `apps/desktop/src/renderer/src/components/SkinGalleryPage.vue` + `styles/skin-gallery.css`
- `.mochen-tmp/p535/{p535-skin-gallery.mjs, mutate-texture.cjs, scan-fffd.mjs, classify-fffd.mjs, fix-fffd.mjs, shot-gallery.mjs, probe*.mjs}`
- 截图：`.mochen-tmp/p535/shot-535-skin-gallery.png`

**改**
- `apps/desktop/src/renderer/src/composables/appearanceThemeRuntime.ts`：`skinStyleVariables` + `themePresets` 改为派生
- `apps/desktop/src/renderer/src/components/{SkinGalleryPage,AppearancePanel,ExtensionsNavRow,LeftSidebar,App}.vue`
- `apps/desktop/src/renderer/src/stores/{useSkinBrowse,layoutStore}.ts`、`utils/side-nav.ts`
- `apps/desktop/src/renderer/src/styles/{skin-gallery,extensions,left-nav,conversation-pane,editor-pane,theme-runtime,settings-page,dialog}.css`、`styles.css`
- `apps/desktop/src/renderer/src/components/{appearance-panel-wiring,extensions-page-wiring}.test.ts`（改钉）
- `apps/desktop/src/preload/renderer-api.test.ts`（夹具照抄出厂默认）
- 顺手还账：5 处历史存量 U+FFFD（`timeline-check.ts` / `appearance-font-families.test.ts` / `provider-presets.test.ts` / `useVoiceInput.test.ts` / `useProviderStore.ts`）

**结果**：全量门禁 **202 文件 / 2747 用例全绿（VERIFY_EXIT=0）**；
真机 **P535_SKIN_GALLERY：34 项全绿**；坏字节 **SCAN_FFFD_CLEAN**（3 处豁免，均注明理由）；
截图 2160×1353（期望 vs 实际像素自证通过）。

## 批次 5-㊵ · 皮肤广场第二版：把上游**源码里的数值**搬进来

> 上一批（5-㊴）把 DSH 换装插件的视觉语言概括成四个自造的离散档，
> 用户看完说「跟他的那些不一样」——**这句话是对的**。
> 这一批把做法换掉：不概括，**直接把上游那几个文件的原值搬过来**。

### 为什么 5-㊴ 的做法是错的

5-㊴ 的四层是 `texture / radius / outline / glow`，每一档的值都是本仓自己定的
（`grain: 间距 22px、alpha .05` 之类）。上游真正在做的事它们一条都表达不了：

| 上游实际做法 | 出处 | 5-㊴ 的四档 |
| --- | --- | --- |
| 玻璃是 `blur 8 / 14 / 22px` 连续值，另配 145° sheen + 左上角 accent 椭圆光 | 端场 `src/styles/theme.css:380-400`、`docs/glass.md` | 表达不了（只有 `soft/strong` 两档） |
| 玻璃**分区域**给参数：侧栏 / 内容 / 设置窗 / 浮层 各有自己的 alpha 与 blur | 壁纸引擎 `lib/glass-presets/factory-{readable,frosted}.json` | 表达不了（整页一个值） |
| 背景是四层 `radial-gradient` 叠一条 linear 的弥散光，8 套各不相同 | 梦境 `tests/fixtures/legacy_skin_glows_10_6_0.json` | 表达不了（只有一种 `weave` 斜织） |
| 图案是「横线 4px / 竖线 120px」的**不对称**网格 | 端场 `src/styles/theme.css:1669-1671` | 表达不了（只有 `paper` 纸纹） |
| 对话框是 `180deg` 分层底 + 底部 `inset 0 -4px` 实心压边 | galgame `.dsh-plugin/client/styles.mjs:54,416` | 表达不了 |
| 玻璃芯是 `blur(24px) saturate(140%)` + `inset 0 1px 0` 高光 + 双层暗角 | 公海 `shared/styles.css:99-103,59-61` | 表达不了 |

⇒ 「四档离散值」丢掉的正是这些。所以这一批**不作发明，只作搬运**。

### 新的四层

| 层 | 取值 | 值的真身 |
| --- | --- | --- |
| `backdrop` 背景 | 平涂 / 深渊光 / 弥散光 / 星云光 / 余烬光 / 午夜光 | 梦境那份 fixture 的五条 `glow`，**逐字搬**；深浅两版各一条 |
| `glass` 玻璃 | 无 / 轻磨砂 / 磨砂 / 厚玻璃 / **分区域** | 端场 `docs/glass.md` 的三档 + 壁纸引擎的分区域参数 |
| `surface` 表面 | 常规 / 全直角 / 胶囊圆角 / 对话框 | 端场 `theme.css:423-438` / 公海 `styles.css:77,96` / gal-view `styles.mjs:54,416` |
| `grid` 图案 | 无 / 工业网格 / 舞台网格 | 端场 `theme.css:1669-1671` / gal-view `styles.mjs:123-124` |

「分区域」那一档是本批的关键：上游壁纸引擎的玻璃**不是一个值**，
而是 `glass 40/blur24、sidebar 55/blur20、sidebarContent 30、settings 100/blur60、floaters 100/blur60`——
墨宸把它落成侧栏 / 内容 / 浮层 / 胶囊四个各自的 token，
守卫里有一条钉「三个区域的值必须真的各不相同」，防止退化成整页一个值。

### 许可（沿用 5-㊴ 的核实结论，未变）

五个上游逐个查过 LICENSE 原文，**全部 MIT**：

`d-dev0101/open-sea-skin`、`RevolutionLA/dsh-dream-skin`、`ymh0000123/dsh-theme-endfield`
（仅代码，视觉语言版权归鹰角）、`Ayase34/gal-view`、`elysia395/dsh-wallpaper-engine`。

被**暂缓**的两个（核实过许可，不是没找到；暂缓的理由是等用户裁定，不是「因为要卖」——见上面 2026-10-08 更正）：
`Small-tailqwq/dsh-deep-whale`（美术 CC BY-NC-SA 禁商用）、`GGBond2424648901/deep-whale-day-night-theme`（整仓 CC BY-NC-SA 4.0）。

### 本批真机撞出来的四个真缺陷（都先于本批存在）

① **侧栏的模糊有两个真身，且老的那条永远赢。**
   皮肤给侧栏配 20px（token 上写对了），真机量到 DOM 上是 `blur(22px) saturate(1.25)`——
   那是一条早就存在的 `html[data-translucent-sidebar="true"] .left-sidebar`。
   两条选择器**同特异性**（都是 2 个 class 级 + 1 个类型级），同分时写在后面的赢，而老的那条在后面。
   **修法不是加 `!important`，是删掉一个真身**：把「半透明侧栏」开关折进运行时的
   `--skin-glass-sidebar-blur`（关掉时给 0 且 alpha 给 1），CSS 那边不再判。
   ⇒ 守卫新增「那条老的 data 属性规则不许回来」。

② **改 token 的名字 = 改全仓所有消费它的地方。**
   重写 `appearanceThemeRuntime.ts` 时，我把字体四件按「先主题后字体」的语序
   改成 `--font-ui / --font-editor / --font-size-ui / --font-size-code`，
   而约 40 处样式消费的是 `--ui-font / --editor-font / --ui-font-size / --code-font-size`。
   每处 CSS 都带着接近的兜底值 ⇒ **界面只是「字号有点不对」，不报错**。
   是 `theme-token-guard.test.ts` 把它报成孤儿的。
   ⇒ 守卫新增「字体四件的名字不许被理顺语序改掉」。

③ **同选择器不许写两条 CSS 规则。**
   `ruleBlock` 守卫读的是**第一条**匹配。我先把侧栏玻璃另起一条同选择器的规则，
   于是「玻璃挂在侧栏上」那条断言红在一个**看上去该绿**的地方。
   ⇒ 并进原有那条规则；守卫里写明这条规矩。

④ **守卫读原文 ⇒ 注释里写的消费形状照样算「消费了却没定义」。**
   `theme-runtime.css` 那段说明里写着 `.document-editor`，
   而断言用的 `[^{}]*\.document-editor[^{}]*\{[^}]*\}` 会从**注释里**那个词开始
   一路吃到下一条真规则上，于是量到的是 `.desktop-shell` 那条。
   ⇒ 那条断言改用 `strippedStyleSource`。

### 文件结构（为行数预算拆了三个文件）

```
appearanceColor.ts          颜色换算的唯一实现（hexToRgb / mix / rgba / mixRgba）
  ↑ 两边都依赖它
appearanceSkinVisual.ts     上游视觉真值 + skinStyleVariables（背景/玻璃/表面/图案）
  ↑ 被它依赖
appearanceThemeRuntime.ts   主题上色 + 字体 + 旧别名层，re-export skinStyleVariables
```

拆的起因是一次**循环 import**：`appearanceSkinVisual.ts` 要用 `rgba`，
而 `appearanceThemeRuntime.ts` 要用 `skinStyleVariables`——两边互 import，
`tsc` 报的是 `Cannot find name 'skinStyleVariables'`，症状离病因隔了三层。
把颜色换算抽成第三个文件，依赖方向才变成一条直线。

### 卡片预览改成真机渲染那一层

5-㊴ 的预览只画了两条色带，用户看不出任何差别——而卡片存在的意义恰恰是
「一眼看出两套皮肤的差别」。现在预览块分三层，各自消费**与真正应用时相同**的那些 token：
背景层（`--skin-backdrop`）、图案层（`--skin-grid-image`）、前景玻璃面板。
⇒ 守卫钉住「三块必须各自消费那些 token」，以及「底色由模板内联」（不靠 `:root` 那份当前生效的）。

### 验证

- 全量门禁：**203 文件 / 2773 用例全绿（VERIFY_EXIT=0）**
- 真机：**P535B：55/55 全绿**（Electron 42.5.0，CDP 9222）
  —— 含五套改编皮肤逐个换上，验 `--skin-glass-sidebar-blur=20px`（分区域）、
  `--skin-grid-image` 含 `120px`（工业网格）、`--skin-radius-*` 全 `0px`（全直角）、
  `--skin-dialogue-underline` 含 `inset 0 -4px`（对话框压边）、
  `--skin-backdrop` 真的落在 `.desktop-shell` 的 `background-image` 上
- 坏字节：**SCAN_FFFD_CLEAN**（480 文件；2 处豁免：`fs-store` 那两个文件里的
  U+FFFD 是**有意的字面量**——它们在处理用户文件里的坏字节）

### 本批改动文件

**新建**
- `apps/desktop/src/renderer/src/composables/appearanceColor.ts`：颜色换算唯一实现
- `apps/desktop/src/renderer/src/composables/appearanceSkinVisual.ts`：上游视觉真值 + `skinStyleVariables`
- `apps/desktop/src/renderer/src/composables/appearance-skin-visual.test.ts`：四层数值守卫
- `.mochen-tmp/p535/{list-trees.mjs, fetch-impl.mjs, check-upstream-contrast.cjs, split-runtime.cjs, split-test.cjs, split-test2.cjs, dedupe-vars.cjs, extract-color.cjs, fix-fffd2.cjs, scan-fffd2.mjs, p535b-skin-gallery.mjs}`
- 截图：`.mochen-tmp/p535/shot-535b-skin-gallery.png`（2160×1353）

**改**
- `packages/contracts/src/appearance.ts`：四层枚举换名换内容（`backdrop/glass/surface/grid`）
- `apps/desktop/src/renderer/src/composables/appearanceSkins.ts`：五条改编皮肤逐条注明「搬的是哪个文件的哪一段」
- `apps/desktop/src/renderer/src/composables/appearanceThemeRuntime.ts`：四层换算搬出、修回字体四件与侧栏那一族
- `apps/desktop/src/renderer/src/composables/theme-token-guard.test.ts`：跟着拆文件多扫一处
- `apps/desktop/src/renderer/src/stores/useSkinBrowse.ts`、`components/SkinGalleryPage.vue`：四层改名 + 预览改三层
- `apps/desktop/src/renderer/src/styles/{theme-runtime,skin-gallery}.css`：四层消费；删掉那条抢赢的老规则
- `apps/desktop/src/preload/renderer-api.test.ts`：夹具字段改名

### 5-㊵ 补修：用户报「插件里面的东西卡到工作台里了」

用户反馈一句，根因在三个层次之外：

- **现象**：工作台里出现了插件页的东西。
- **实测**：工作台上 `.extensions-page` 与 `.conversation-pane` **完整重叠 664×902**
  （视口 1440×902）——两者都占 `grid-column: 2` + `grid-row: 1` 那一格。
- **为什么画面上看不出来**：对话那格写在 ExtensionsPage 之后、盖在它上面。
  但插件页整页活在 DOM 里：它那套网格与滚动容器占着位置、监听器照跑、还吃点击。
- **根因**：`App.vue` 那一行是 `v-if="centerView !== 'skins'"`——**排除法写反了**。
  排除 `skins` 等于「chat / skills / plugins 三个都渲染」，而对话那条路上不该有它。

```vue
<!-- 改前：在对话那条路上也渲染插件页 -->
<ExtensionsPage v-if="centerView !== 'skins'" />
<SkinGalleryPage v-else />

<!-- 改后：三页各自指名，互斥由构造保证 -->
<ExtensionsPage v-else-if="centerView === 'skills' || centerView === 'plugins'" />
<SkinGalleryPage v-else-if="centerView === 'skins'" />
```

**为什么这里可以用 `v-else-if` 链**（上一版的注释明确警告过不许串）：
当年警告的是「让『谁盖谁』变成书写顺序决定的」，那说的是**几页各有自己的条件、互不相干**。
这里三个条件读的是**同一个 `centerView` 且穷尽它的取值**，互斥由构造保证，与顺序无关。

**顺带一条必须验的**：`v-if` / `v-else-if` 之间夹着 HTML 注释，
Vue 的模板编译器要能跳过注释继续认 `else-if`。它若不认，三页会**一起消失**（比原来更糟）。
⇒ 真机四页各点一遍，7/7 全绿。

### 这次改钉的两条守卫

| 守卫 | 改钉理由 |
| --- | --- |
| `extensions-page-wiring.test.ts`：删掉笼统的 `not.toContain("<ExtensionsPage v-else-if")` | 它禁的是「整页那版」的错误条件，而顺手把**任何** `v-else-if` 都禁了，包括修这个缺陷时必须用的那一支。改成**禁具体那个错误条件**（`currentView === 'extensions'` 仍然禁着），不按语法禁 |
| `appearance-skins.test.ts`：新增「对话那条路上插件页与皮肤广场都不在 DOM 里」 | 只钉 `toContain` 不够——改回旧写法时它红的是「字符串不见了」，而红的原因离病因隔着三层。这条钉的是**后果** |

### 验证

- 全量门禁：**203 文件 / 2773 用例全绿（VERIFY_EXIT=0）**
- 真机 **P536：7/7 全绿** —— 四页各点一遍，逐页断言「该在的在、不该在的不在」，
  并在工作台上单独断言 `.extensions-page` 的盒子是 `null`（不是「看不见」，是**不在**）
- 坏字节：`SCAN_FFFD_CLEAN`

### 本次改动文件

- `apps/desktop/src/renderer/src/App.vue`：三页互斥接线（那一行条件）
- `apps/desktop/src/renderer/src/components/extensions-page-wiring.test.ts`（改钉）
- `apps/desktop/src/renderer/src/composables/appearance-skins.test.ts`（改钉 + 新增一条）
- `.mochen-tmp/p535/{diag-plugin-workspace.mjs, p536-page-exclusion.mjs}`
- 截图：`.mochen-tmp/p535/{diag-workspace.png, diag-plugins.png, fix-plugin-leak.png}`

---

## 5-㊱ 弹层开着时焦点不在里面 —— 四个对话框的 Esc 全是哑的

### 起因

全局真机巡检（`p536a-audit.mjs`）走完 10 个左栏入口 + 设置页，页面重叠、横向溢出、控制台错误全过，
只有一项红：**点「数据统计」之后整屏被 `div.dialog-backdrop` 盖住**，左栏 10 枚钮全部 `elementFromPoint` 量到 backdrop。

第一反应是「设计如此」——统计是个对话框，对话框带遮罩天经地义。但顺手写了个探针去量它到底收不收得住，
量出来的是三条硬伤，于是这件事不再是「设计如此」：

| 量到的事实 | 证据 |
| --- | --- |
| 弹窗开着时 `document.activeElement` 仍是左栏那颗 `BUTTON.nav-row[data-nav-id="stats"]` | `p536c` 量到 `insideDialog: false` |
| 裸 Esc 收不掉 | 同上，`afterEsc.open = true` |
| 把焦点手动挪进弹窗再按 Esc，**仍然**收不掉 | 同上，`afterEscInside.open = true` |

第三条说明问题不在焦点，在**模板里根本没有 keydown**。于是这一层只能靠「×」和「知道了」收，
Esc——全局键位表里明确写着要委托的那一条——是哑的。

### 往上一层查：不是一处，是四处

`SideNavNoticeDialog` 没有 keydown 是肉眼可见的。但同一族的另三个弹层里，`ModelProfileDialog` **是有** `@keydown` 的
（`model-profile-dialog-wiring.test.ts:322` 钉着它）。于是先量后判，不拿源码推断当量测：

| 弹层 | 源码形状 | 真机行为 |
| --- | --- | --- |
| `SideNavNoticeDialog`（数据统计 / 规划中 / 未打开作品） | 无 keydown | 焦点在层外，Esc 收不掉 |
| `NewBookDialog`（新建作品） | 无 keydown，靠 `autofocus` 属性 | 焦点在层外（**`autofocus` 没生效**），Esc 收不掉，连按一次 Tab 就跳到左栏 |
| `SaveConflictDialog`（保存冲突） | backdrop 上有 `@keydown.esc.stop` | 同上（冒泡收不到） |
| `ModelProfileDialog`（添加 / 编辑模型） | `.workspace-dialog` 上有 `@keydown` | 焦点在层外 |

**为什么全都坏**是同一条：`@keydown` 走冒泡，只有事件经过那棵子树才收得到；而四个弹层没有一处把焦点挪进去。
守卫量的是「模板里有没有 keydown」——**形状对了不等于行为对**，这是本批最值钱的一条。

### 一条假绿，和它是怎么被拆掉的

`p536d` 第一次跑，`model-profile·裸 Esc` 是**绿的**。但绿得不对：

> 在设置页点「添加模型」，弹窗开着时按 Esc，弹窗确实消失了。可消失的路径**不是它自己**——
> 全局 `utils/escape-policy` 的 `close-overlay` 把整个设置视图卸了，弹窗是被顺带带走的。

同一个「关掉了」量了两种不同的东西（`.settings-page` 在不在，探针没问）。修完之后 `p536e` 对这一项多钉一条：
**Esc 之后 `.settings-page` 必须还在**，否则判失败。现在量到 `宿主 .settings-page 还在=true`——
即 Esc 只关它自己，宿主视图纹丝不动。

### 改法：一份真身，四个弹层共用

新建 `composables/useModalFocus.ts`，把「这一层是不是最上面那层、焦点该不该被它接管」这一件事收到一处
（铁律 6：同一判定只留一份实现）。它管四件事：

1. **焦点进层**：开 ⇒ 记下 `document.activeElement`（触发钮），把焦点挪到层内第一颗可聚焦元素。
2. **Esc 收层**：挂在**弹层根节点**的捕获段。焦点进层保证了事件一定冒泡经过这棵子树，
   于是「焦点不在层内时收不到」那个老毛病被治好了。
   收的时候 `preventDefault` + `stopPropagation`，于是全局那条链收不到，**绝不会顺手打断正在跑的那一轮**。
3. **焦点归位**：关 ⇒ 还给触发它的那颗按钮。
4. **Tab 困在层内**：既然宣示了 `aria-modal="true"`，Tab 就该被关在里面。
   （与 `useComposerContextPopover` 那份浮层的选择器**故意不合并**：那份是浮层，只收 button 与 input；
   这一份是模态层，凡是能吃到焦点的都算数——两处判的不是同一个东西。）

两处「换了写法才对」的细节，都写在代码注释里：

- **`flush: "post"`**：弹层自己 `v-if` 的那种（SideNavNoticeDialog / SaveConflictDialog），默认的 pre 段
  跑在 DOM 更新之前，`root.value` 还是 `undefined`，于是什么都不发生。也不能用 `immediate: true`
  ——setup 期 DOM 还不存在。
- **焦点归位不是无脑 `focus()`**：`need-book` 引导里那枚「新建作品」会在**同一个 tick** 里开下一层
  （`onAction` 先 emit newBook 再 emit close）。无条件还回去会把刚落进新弹层的焦点又踢回左栏，
  新弹窗开着、焦点却在它外面——又是同一个病。所以按「焦点是不是已经被别的层接走了」判断。

四个弹层逐一接上，并删掉各自那份裁决：`ModelProfileDialog.onKeydown` 整个函数退役、
`SaveConflictDialog` 的 `@keydown.esc.stop` 删掉、`NewBookDialog` 的 `autofocus` 属性删掉
（动态插入的元素浏览器不保证接管焦点，实测确实没接管；真身是 composable 里那一处显式 `focus`）。
四个根节点各补一个 `tabindex="-1"`——它是「层里一颗可聚焦的都没有时」的落点，
少了它 `el.focus()` 会静默失败（div 默认不可聚焦），症状是「弹层开着、焦点却还在外面」而模板上一点报错都没有。

### 全量门禁逮住的一条：裁定 G5

第一版 `useModalFocus` 把 keydown 挂在 `document` 上。自测与守卫全绿，**全量门禁当场红了**：

> `utils/hotkey-markers.test.ts` · 裁定 G5「全局 keydown 监听有且只有一个」——
> `document.addEventListener("keydown"` 全仓命中 **2** 处，期望 1 处。

G5 是有意的裁定，判「只有一处」是对的。所以改挂弹层根节点——不但合了裁定，**还更对**：
监听的作用域就是这一层，不该在别的层开着的时候也还活着。
至于「焦点不在层内时收不到」，它已经被「焦点进层」治好了，两件事各管一段，不必都靠监听的位置。

这条正好是「自测全绿不等于对」的又一例：本地跑的两份守卫都没覆盖到「全仓唯一性」这条跨文件的裁定，
只有全量门禁看得见。

**还栽了两次同一族的坑**：改完之后门禁**仍然**红，还是 2 处。搜出来第二处不是代码，是我自己那段注释——
它把那条全局监听的 API 字面量原样写在了解释里。裁定 G5 那条守卫读的是**原文**、
且 `listSourceFiles` 只排 `.test.ts`、**不剥注释**，于是注释里凭空多出第二处「全局监听」。
改成散文描述之后门禁才转绿。

紧接着第二次：为了把这个坑记进注释，我顺手写了完整的 CSS 自定义属性引用（`var(--…`），
`theme-token-guard` 当场报「这个变量被消费但没人定义」——**同一句话里、同一次编辑里，栽进同一个坑两次**。
与项目早就记着的「注释里不写 CSS 变量的完整写法」是同一条：**守卫读原文，注释里的字面量会被当真**。
两次都记进了代码注释，免得下一个人再写一遍。

### 守卫

新增 `components/modal-focus-wiring.test.ts`：**四个弹层逐个点名**（不查「全仓有几个 dialog-backdrop」
——那种写法新加弹层时照样全绿），外加本体六条（Esc 吃掉、捕获段、post 段、归位判据、顶层栈、Tab 循环），
外加三条「退役的机制不许回来」。

**变异验证 7/7 全红**：去掉 `stopPropagation`、监听挂回 `document`、监听从捕获段改成冒泡、
`flush` 改回 pre、归位改成无脑 `focus()`、去掉 `isTopmost` 判定、给 NewBookDialog 加回 `autofocus`
—— 每条都让守卫变红。

其中一条**第一轮活了**：我原来钉的是 `openStack.at(-1) === token`，把 `onKeydown` 开头那句
`|| !isTopmost()` 删掉、函数本身留着没删，断言照样全绿——绿的是「定义还在」，不是「判定还在生效」。
改成钉**调用点**（正则容忍折行）才咬得住。钉错对象的断言比没有更糟，它让人以为这里被看着。

`model-profile-dialog-wiring.test.ts:318` 那条被钉住的旧决定按规矩**改成钉新决定**，逐条说明写进了测试注释：
原来钉「`@keydown="onKeydown"` + `if (event.key !== "Escape") return;`，即 Esc 的裁决住在本组件里」，
现在钉「Esc 的裁决不在本组件里：接 `useModalFocus`，模板上不再挂 keydown」。
决定改的是**归属**不是**有无**——「弹层必须有 Esc 通路」那条一点没放松。

### 真机复验

`p536e-modal-focus-verify.mjs`，**17/17**：三个能打开的弹层各量四件事（焦点进层 / Tab 不跑出层外 /
裸 Esc 收得掉 / 焦点还给触发钮），外加「收尾无残留」。连按 14 次 Tab 焦点仍在层内。

### 这一批里踩到的两件事（都属于「探针自己的错」）

1. **探针起点没交代干净**：上一轮跑完停在设置页，这一轮开头就量不到 `[data-nav-id="stats"]`。
   而 `App.vue:210` 的 `<SettingsPage v-if="currentView === 'settings'" />` 排在 `<template v-else>`（左栏与中栏）
   **之前**——设置视图是把整个壳换掉，左栏根本不在 DOM 里。量到 0 先问自己的起点对不对。
   （顺带记一笔：**设置页至今仍是整页、左栏会消失**，这与同一段注释里「左栏是恒定的导航，任何时候都在」
   打架。5-㊜ 把技能库与插件退回中栏，唯独设置没动。这是有注释的既有决定，本批不擅改，列在这里备查。）
2. **`URL.pathname` 把中文路径百分号编码**：截图落到了 `Desktop\\%E6%B7%B1%E6%B8%8A...\` 这样一个
   凭空多出来的目录里，而报告照样说「已截图」——症状极像「截图没生成」，实际图一直在。
   正解是 `fileURLToPath`。误建的那个目录已回收，截图搬回 `.mochen-tmp/p535/p536{c,d,e}/`。

### 改动文件清单

- `apps/desktop/src/renderer/src/composables/useModalFocus.ts`（新建）
- `apps/desktop/src/renderer/src/components/SideNavNoticeDialog.vue`
- `apps/desktop/src/renderer/src/components/NewBookDialog.vue`
- `apps/desktop/src/renderer/src/components/SaveConflictDialog.vue`
- `apps/desktop/src/renderer/src/components/ModelProfileDialog.vue`
- `apps/desktop/src/renderer/src/components/modal-focus-wiring.test.ts`（新建）
- `apps/desktop/src/renderer/src/components/model-profile-dialog-wiring.test.ts`（改钉）
- 探针：`.mochen-tmp/p535/{p536c-esc-dialog.mjs, p536d-modal-esc-family.mjs, p536e-modal-focus-verify.mjs,
  mutate-modal-focus.cjs, fix-probe-out-path.cjs}`
- 截图：`.mochen-tmp/p535/p536{c,d,e}/`

---

## 5-㊱ 补：设置视图把左栏整个换掉了（这条与它自己的理由相违）

### 起因

上一节末尾留了一条待办：`App.vue` 里 `<SettingsPage v-if="currentView === 'settings'" />`
排在 `<template v-else>`（左栏与中栏）**之前**——于是设置视图是「整页」，
左栏整个不在 DOM 里。这与同一段注释里那句 `左栏是恒定的导航，任何时候都在` 自相矛盾：
5-㊜ 正是为了让左栏恒定，才把插件与技能从整页退回中栏。唯独设置留在整页，
而整页的 `v-if` 又恰好在 `v-else` 之前，左栏偏偏就在那个 `v-else` 里面。

它比「左栏消失」更实际的后果：**在设置页里，左栏那 18 枚钮一枚也点不到**——
用户想切到技能库或插件，只能先用「返回工作台」退回工作区、再点一次。

### 改法：不是把左栏也搬成整页，而是让设置页自己让出第一列

设置中心与插件/技能、皮肤广场改为**同一格落点**：`grid-column: 2 / -1`（中栏 + 右栏两格）
+ `grid-row: 1`。左栏拖拽条也跟着搬出 `v-else`，与左栏同在。

两处顺带处理：

- **`grid-row: 1` 不是可选的**：`extensions.css` 那段注释里留着完整的真机量测记录——
  只写 `grid-column` 的话网格会把这一格排到第二行，shell 从「一行三列」变「两行三列」，
  左栏被压到第一行那一格（量到 302px 高 / 视口 901px），后半截导航落在可视区之外，
  **看得见点不到**。这一页此前从没人在**它自己那一页上**量过左栏的几何，所以一直没暴露。
- **`width: 100vw` 删掉**：它是「整页」那一版的遗留。这一页现在是 grid item，
  撑满视口宽度会在右栏存在时横向溢出（这是**量**出来的，不是看出来的）。

**旧的那枚拖拽条同批删掉**：搬出来一份、原地还留一份的话，DOM 里会有两枚
`aria-label` 一样的 separator——读屏报出两条一样的分隔条，而 `elementFromPoint` 只能量到
后画的那一枚，第一枚成了永远点不到的死元素。守卫用 `countNeedle` 钉「恰好一枚」。

### 守卫（改钉）

`extensions-page-wiring.test.ts` 里那一条原来叫「左栏恒定：**它在 `v-else` 里，
只有设置中心整页时才被跳过**」——那句话**如实描述了当时的代码**，而那份代码与它自己
上一段的裁定相悖。按规矩改成钉新决定，逐条说明写进了测试注释。

判据落在**左栏**而不是设置页：`expect(左栏的下标 < v-else 的下标)`。
将来设置页再改落点，不必动这条；而左栏哪天又被塞回 `v-else` 里，它会红。
另一条把三个内容页的落点钉成同一格（`2 / -1` + `grid-row: 1` + `min-width: 0`），
外加三条反向：`1 / -1`、`100vw`、以及缺 `grid-row`。

**变异验证 6/6 全红**：左栏挪回 `v-else`、拖拽条复制一份、`settings-page` 去掉 `grid-row`、
去掉 `grid-column`、`100vw` 放回来、`skin-gallery` 去掉 `grid-row`——每条都让守卫变红。

### 真机量测（P536F，17/17）

这一页的全部量都在**设置视图下**做，且不只看可见，还要 `elementFromPoint` 看点得到的是不是它自己：

| 量到的事实 | 数值 |
| --- | --- |
| 左栏仍在，满高 | `sidebar.h = 902` / 视口 902 |
| 左栏在左、设置页从它右边开始 | `sidebar.right = 286`、`settings.x = 286` |
| 设置页吃掉中栏 + 右栏 | `settings.right = 1440` / 视口宽 1440 |
| 没有横向溢出 | `scrollWidth = clientWidth = 1440` |
| 左栏拖拽条一枚 | `pane-resizer-left × 1` |
| 左栏 **18 枚钮**全部在视口内且点得到自己 | workspace / works / new-book / brain / tree-* / plan / writing / review / skills / plugins / skins / stats |
| 在设置页点「技能库」真能切 | `skills: true, settings: false, sidebar: true` |
| 往返一趟不塌 | 再回设置，左栏仍 902 |

### 这一轮又踩了一次「量到红先怀疑探针」

第一次跑 `P536F`，17 条里红了一条：`设置视图下点「技能库」点得到自己`。
而**同一次运行**里另一条已经量到「切到技能库：技能页在、设置页走、左栏还在」——
也就是说点击其实生效了，红的是探针的归属解析：按钮里嵌着 `AppIcon` 的 svg，
`elementFromPoint` 直读 `hit.className` 量到的是 svg 内部某个 `<path>` 的空 class，
于是判成「点不到自己」。同一个文件里的 `navHitTest` 用的是 `closest("[data-nav-id]")`，
正确判出 18/18。⇒ **同一个量法在同一份探针里写了两遍，其中一遍漏了归属解析**。
与已记的「同一句里常常还有第二个决定」同族：探针自身的重复实现同样要合并。

### 改动文件清单

- `apps/desktop/src/renderer/src/App.vue`（左栏与左栏拖拽条搬出 `v-else`；旧拖拽条删除）
- `apps/desktop/src/renderer/src/styles/settings-page.css`（`grid-column: 2 / -1` + `grid-row: 1` +
  `min-width: 0`；`width: 100vw` → `100%`）
- `apps/desktop/src/renderer/src/components/extensions-page-wiring.test.ts`（改钉 + 新增三组）
- 探针与脚本：`.mochen-tmp/p535/{p536f-settings-sidebar.mjs, mutate-settings-sidebar.cjs}`
- 截图：`.mochen-tmp/p535/p536f/`

---

## 5-㊲ 面板族（overlay）：六个面板的 Esc 全是哑的

### 为什么接着查这一族

5-㊱ 修的是 `.dialog-backdrop` 那一族（四个对话框）。同一个病的另一半是**面板**：
九个 `.xxx-overlay` + `.xxx-panel/dialog` 的整屏浮层，形状一模一样地复制过去
（整屏遮罩 + `@click.self` 关闭 + `role="dialog"`）。既然对话框那一族的根因是
「从没把焦点挪进层内、于是 keydown 收不到」，那么面板这一族按理也该是同一个病——
**但不能靠推理下结论，先量**。

接线先数了一遍：`SearchPanel` 有 `@keydown` 但只判 Arrow/Enter（**没有 Escape**）；
`OutlinePanel` 有一处 `@keydown.esc`，挂在搜索框那个 input 上；其余七个一处 keydown 都没有。

### 量出来的（P536G）

**六个走 Ctrl+Shift 的面板，一模一样：焦点从不在层内、Esc 一次也收不掉。**

| 面板 | 快捷键 | 焦点在层内 | Esc 收得掉 |
| --- | --- | --- | --- |
| 全文搜索 | Ctrl+Shift+F | 否 | 否 |
| 笔记 | Ctrl+Shift+N | 否 | 否 |
| 提示词模板 | Ctrl+Shift+T | 否 | 否 |
| 文档大纲 | Ctrl+Shift+O | 否 | 否 |
| 写作目标 | Ctrl+Shift+G | 否 | 否 |
| 故事圣经 | Ctrl+Shift+B | 否 | 否 |

其中一条比其余的都刺眼：**`SearchPanel` 的界面上摆着一枚 `<kbd>Esc</kbd>`**——
界面在教用户按一个不起作用的键。

导出与字数两个面板的入口按钮是 `:disabled="!book.meta"`，本机没打开作品
⇒ **环境不具备条件**，写成 NOTE 而不是 FAIL（「没验的」与「坏了」不许混成同一个红）。

### 改法：八个面板接上同一份 useModalFocus

八个面板形状完全一致（`defineProps<{ visible: boolean }>` + `defineEmits<{ close: [] }>`
+ 常驻组件 + 遮罩自己 `v-if`），所以接线是同一句：

```ts
const panelRoot = ref<HTMLElement>();
useModalFocus({ root: panelRoot, close: () => emit("close"), isOpen: toRef(() => props.visible) });
```

面板根节点各补 `ref` / `aria-modal="true"` / `tabindex="-1"`。
遮罩那条 `@click.self` **全部保留**——Esc 是补充，不是替换。

退役两份旧机制：

- `OutlinePanel` 搜索框上那处 `@keydown.esc`：它挂在 input 上，而焦点压根没进过面板，
  够不着。删掉（那枚「关闭大纲面板」按钮留着）。
- `SearchPanel` 那处 `setTimeout(() => inputRef.value?.focus(), 50)`：这是**同一件事的第二份实现**
  （打开时把焦点接进面板），而且实测没生效。删掉之后 composable 取「第一颗可聚焦元素」，
  正好落在它自己的搜索框上——复验量到的就是 `INPUT.search-input`。

一处顺带修：`WordCountPanel` 的 `defineProps` 原来是裸的（没接住 `props`），
于是「面板开着吗」这个判定没法喂给 composable。改成 `const props = defineProps(...)`。

**OnboardingGuide 故意不接**：它是引导流程，`.ob-overlay` 上没有 `@click.self`，
只有「上一步 / 下一步 / 完成」，没有 close 通路。接上会凭空多一条 Esc 通路，
而 Esc 在那个语境里的语义是「跳过」而不是「关闭」。守卫里写明了这条排除的理由。

### 守卫

`modal-focus-wiring.test.ts` 加一组：八个面板**逐个点名**（不查「全仓有几个 -panel」——
那种写法新加浮层时照样全绿），每处钉接线 / `isOpen` / 三件根节点属性 / 遮罩那条鼠标路 /
不许自己再判 Escape；外加五条退役钉与那条排除说明。

**变异验证 8/8 全红**：OutlinePanel 加回 `@keydown.esc`、SearchPanel 加回 `setTimeout` 聚焦、
NotesPanel 去掉 `tabindex`、StoryBiblePanel 去掉 `aria-modal`、WritingGoalPanel 去掉 `ref`、
WordCountPanel 把 props 摘掉、PromptTemplatePanel 去掉遮罩那条路、
OnboardingGuide 被接上——每条都让守卫变红。

### 真机复验（P536H，26/26）

六个面板各量四件事：Ctrl+Shift 真能打开 / **焦点落在层内** / **连按 12 次 Tab 仍在层内** /
**裸 Esc 收得掉**。搜索面板的焦点落在 `INPUT.search-input`、大纲落在 `INPUT.outline-search-input`，
其余四个落在各自第一枚按钮上。

### 探针自己栽的两处（都记在 p536h 的文件头）

1. **清场写死了 (6,6)**。而 `.outline-panel` 是 `position:absolute; left:0; width:400px; height:100vh`
   ——**它盖住 (6,6)**，那一记打在面板上、`@click.self` 不触发，大纲面板关不掉，
   后面两项的起点全是脏的（写作目标与故事圣经那两轮量到 overlays 里混着 outline-overlay）。
   ⇒ 清场改成**按几何找**一个「命中的是遮罩本身」的点，用 `elementFromPoint` 自证，不假设坐标。
2. **每轮开头 `clearOverlays()` 的返回值被丢掉了**。于是「没清干净」没有任何断言接住，
   污染一路传下去还能出 PASS。⇒ 清场失败当场红。

第 2 条与「探针必须自己清场」同族，但更细一层：**清场要做，不等于清场会被检查**。
与批次 5-㊱ 那条「同一个量法在同一份探针里写了两遍，其中一遍漏了归属解析」一起看：
探针自己的重复实现与被忽略的返回值，是最容易让「绿的」变成「假的」的两处。

### 改动文件清单

- `apps/desktop/src/renderer/src/components/{SearchPanel, NotesPanel, WordCountPanel, ExportDialog,
  PromptTemplatePanel, OutlinePanel, WritingGoalPanel, StoryBiblePanel}.vue`
- `apps/desktop/src/renderer/src/components/modal-focus-wiring.test.ts`（加一组：八面板 + 五条退役钉）
- 探针与脚本：`.mochen-tmp/p535/{p536g-panels-esc.mjs, p536h-panels-verify.mjs,
  wire-panels-modal-focus.cjs, mutate-panels.cjs}`

---

## 5-㊳ 左栏 28 枚钮逐个点：五条「点了没反应」与一条说谎的高亮

### 起因

上一轮巡检（`p536a`）走完 10 个左栏入口，页面重叠/横向溢出/控制台错误全过，只有两项红，
其中一项是**探针自己把 id 写错了**（`story` 的真 id 是 `plan`）——也就是「故事规划」那一处
**从来没被量过**。与其补一个 id，不如把左栏整个量一遍。

### 量法与量到的东西（P536I）

先确定起点：把四个功能组**幂等地**展成展开态，再枚举 `[data-nav-id]`，断言**恰好 28 枚**。
然后 28 枚逐个真点（scrollIntoView → 视口断言 → `elementFromPoint` 自证命中的是它自己），
每点一枚量三件事：**互斥**（至多一枚 `.is-active`）、**真反应**（状态有可观测变化）、
外加前置的 **id 唯一**。

结果：

- **id 唯一性 PASS**：28 个 `data-nav-id` 无重名。（`navIdOf` 给 docs 子项返回 `tree-<kind>`，
  一度让我怀疑它与文稿树重名——量了才知道没有，属实的猜测被否掉。）
- **互斥 PASS**：任何时刻至多一枚亮。
- **真反应 FAIL，挖出五条**：`new-thread` / `chapter-editor` / `ai-check-consistency` /
  `ai-check-plot` / `ai-check-logic` 五枚点下去**状态一点没变**。

### 缺陷① 五个动作钮在没有打开作品时点了没反应

那五枚的标题都在承诺一个引导：「AI 写作（去开一章）」「章节编辑器（先建一章）」
「一致性 / 剧情 / 逻辑检查（去开一章）」。

链路是：`childState` 对这三处返回 `mode: "need-doc", docKind: "chapter"` →
`onChildAction` → `guideToDoc("chapter")` → 一篇文档都没有 → `startAdding("chapter")` →
**去文稿树里那一行摆行内新建输入框**。而没打开作品时**文稿树根本不在界面上** ⇒
输入框摆不到任何地方，用户看到的就是「点了没反应」。

这类缺陷最难查：不报错、不消失，只是「像坏了」。

改法：加一个 `needChapterState(label, hint)` 真身，**没打开作品时改走 `need-book`**——
那是对话框，两个按钮都是现成真身（打开目录 = Ctrl+O，新建作品 = 组头「+」）。
与 `utils/side-nav` 里 `sideNavChildState` 对 docs 子项的同一句规则对齐
（「一篇文档都没有 = 大概率没打开作品」）。三个分支一律走它，不许哪一处又自己写一份。

### 缺陷② 进设置页时左栏那枚停在原地亮着

巡检最后一项红：进设置页后 `active` 仍是 `["skins"]`。

单独量了一次（p536j）才定死：`center` 由 `skin-gallery` 变成 `settings-page`，
而 `active` 仍是 `["skins"]`——**屏幕上是设置中心，左栏在说「你在皮肤广场」**。

根因：`showSettings()` 只切 `currentView`，`centerView` 留在原地，于是那一枚就一直亮着。
这与 `showWorkspace` 当年漏复位 `centerView` 是同一族（那一处钉着的理由逐字是
「两枚都在说『你在这儿』」）。

改法：`showSettings()` 顺手 `centerView.value = "chat"`。复位之后**一枚都不亮**，这是对的——
设置视图的指示器是左下角那颗齿轮，它不在 `nav-row` 里、不参与互斥。

顺带修掉 `LeftSidebar.vue` 里那句**已经失效的注释**：「设置中心是整页视图（App.vue v-if 切走时本组件
已卸载）」——5-㊱ 改完之后左栏在设置视图下照常在，那句话不再成立。
「导航区不摆设置行」这个裁定改由别的理由成立（与底部齿轮重复）。

### 探针这一轮栽的四处（都是同一个族的四个变体）

1. **起点不是确定的**：只按组 id 点一次，而起点是上一轮崩在中间留下的（那版在第 131 行抛了，
   四枚组开关已被点过）。⇒ 点之前先读 `aria-expanded`，只点该收的；点完断言四组都展开、
   **枚数断言 28**。枚数不对当场红，不许带着半个覆盖往下跑。
2. **清场的返回值被丢掉了**：于是「没清干净」没有任何断言接住，污染一路传下去还能出 PASS。
3. **快照有盲区**：按 `[class*="-panel"], [class*="-dialog"]` 抓浮层，
   `TimelineCheckPanel`（根类名 `.timeline-check`）整个不在快照里——它是活的，
   却被判成「点下去状态一点没变」。⇒ 改成按 **role** 抓（`role="dialog" / "alertdialog" / "menu" /` `listbox``）：
   类名是实现，role 是契约；契约不会因为改个类名就漏。
4. **清场的选择器漏了一族**：只数 `[class$="-overlay"]`，而**数据统计那个对话框是
   `.dialog-backdrop`**（以 `-backdrop` 结尾）。扫到最后一枚时它一直没被清掉，
   遮罩（z-index 100）盖住整屏 ⇒ 后面点齿轮那一记打在遮罩上、被当成「点外面关掉」，
   看起来像「设置页进不去」。抓住它的是 `clickSelector` 里的**自证**：`owner: null`。

另外两条判据本身写错过的：
「已在当前目的地的那一枚」（工作台）不适用「必须变」这条——用户已经在那儿了，「什么都没变」是对的；
以及把「所有 `.nav-group-toggle` 都得展开」写进了断言，而 `works`（我的作品）是文稿树那一组、不在范围内。

**这四条与 5-㊱ 那两条是同一个族的六个变体**：探针自己的重复实现、起点没交代干净、
返回值被忽略、判据选错对象、快照有盲区。它们造出来的红**全是假的**，
而假红比假绿更费时间——它会让人去改一段没坏的代码。

### 守卫与变异

`left-sidebar-nav.test.ts` 新增一条钉 `needChapterState`（三个分支各走它、正文里不许再手写那三处
need-doc 引导）；`layoutStore.test.ts` 新增一条钉 `showSettings` 复位 `centerView`。
**变异验证 5/5 全红**：needChapterState 退回一律 need-doc、某处绕开它自己手写、need-book 换成空话、
showSettings 去掉复位、复位成 `skills` 而不是 `chat`。

### 真机复验：P536I 9/9

28 枚钮「至多一枚亮」+「全部有反应」全过；齿轮 `owner=icon-button account-settings-button`；
设置页 `active=[]`。

### 改动文件清单

- `apps/desktop/src/renderer/src/components/LeftSidebar.vue`（`needChapterState` 真身 + 一句失效注释）
- `apps/desktop/src/renderer/src/stores/layoutStore.ts`（`showSettings` 复位 `centerView`）
- `apps/desktop/src/renderer/src/components/left-sidebar-nav.test.ts`（新增一条）
- `apps/desktop/src/renderer/src/stores/layoutStore.test.ts`（新增一条）
- 探针与脚本：`.mochen-tmp/p535/{p536i-sidebar-audit.mjs, p536j-gear-click.mjs, mutate-need-chapter.cjs}`

## 5-㊴ 全局键位族

批次手法与前四批一致：**把一面铺完，逐项真点**。上一批点完左栏 28 枚钩，这一批点全局键位。

### 先排除：没有死键

`utils/hotkeys.ts` 的 `PANEL_KEYS` 七枚（ctrl+shift + F/N/T/O/G/B/P）全在表里；
`useHotkeys.ts` 的 `dispatch` 有 `never` 穷尽守卫（评审 X3），
「新动作没接线」那类死键在编译期就红了。缺的是另一类、也难看：**动作接线了、在当前状态下却什么都不发生**。

### 真缺陷：两处「看不见的标记先吃掉一次 Esc」

它比死键更阴：它还会推一个**推去了却没处可见**的标记，
而那个标记在 `resolveEscape` 的优先级里靠前，于是一次 Esc 全喂进它。
用户看到的就是「Esc 失效」。

**① `Ctrl+F`**：`FindReplacePanel` 挂在 `DocumentPane.vue:607` 的
`v-if="findVisible && mode === 'manuscript'"`，而 `DocumentPane` 只在
`v-if="!rightCollapsed && centerView === 'chat'"` 里渲染（它在 `<template v-else>` 内部）。
设置页下 `DocumentPane` 根本不在 DOM 里。于是：
按 Ctrl+F → `findReplace.open()` 把 `visible` 置成 true，**屏上零像素**；
而 `findReplaceIsOpen` 是 Esc 优先级最高的那一支 ⇒ 返回 `close-find-replace`，
清掉那个看不见的标记。真机实测（p536l）：**第一次 Esc 会在设置页里愣着，第二次才出得去**。

**② `/` 行内引用菜单**：菜单挂在 `CenterColumn → ComposerBox → ComposerReferenceMenu` 里，
切去设置页时 `ComposerReferenceMenu` 的 `onBeforeUnmount` **只摘监听、不 close**，
store 里的 `match` 依然开着。而 `referenceMenuIsOpen` 排在 `settingsIsOpen` 之前
⇒ 同样白吃一次 Esc。**两处的形状一模一样。**

> **为什么修了 ① 之后 ② 仍然会中弹**：「打开端判了落点、Esc 端没判」是半截的修法。
> 5-㊴ 之前 `/` 的 `openPalette` 已经判过一次落点（设置视图下 summoned 看不见），
> 而 Ctrl+F 连打开端都没判。**只堵一头等于没堵**——白吃的 Esc 还在。

### 改法：判据放装配护层，动作端与 Esc 端读同一份

落点这个事实的真身是 `App.vue` 那份模板上的 `v-if` 与 `DocumentPane` 里的 `mode`
——在 `useHotkeys` 里复写那几条条件就是第二次实现，**而第二次实现正是本缺陷的成因**。
与 `openPalette` 的既有裁定同款：判定在装配层。

`HotkeyHandlers` 加两个**必填**回调（不给默认值兜底）：

- `referenceMenuHasLanding()` —— 中栏那一格（CenterColumn）在渲染中吗
- `findReplaceHasLanding()` —— 上述 + 右栏没折 + 右栏在「文稿」模式

两句谓词都收在 `App.vue`：`centerChatIsMounted()` 被 `openPalette` 与
`referenceMenuHasLanding` **同时传入**（同一个函数、同一件事，不存在第二份判据），
`findReplaceHasLanding()` 在它之上再加两条。

两个动作端都门掉：

- `dispatch` 的 `open-find-replace`：无落点时**连 `preventDefault` 都不做**，把这一键原样还给浏览器
- `escape` 的两个字段：`findReplace.visible && 判据` / `reference.isOpen && 判据`（Esc 端也门）

顺带收了一个形状相邻的真缺陷：旧的 `openPalette` 只判 `currentView === "workspace"`，
而 `CenterColumn` 还要求 `centerView === "chat"` ⇒ **皮肤广场那一格上按 `/` 同样是幽灵键**
（且 `summon` 会往草稿里写一个看不见的斜杠）。收成同一句话后一并修掉。

### 一律重回的映射（不是缺陷）

皮肤广场 / 技能库 / 插件库上按 Esc 什么都不动。这是**对的**：它们是左栏导航轴上的常驻页，不是浮层；
`resolveEscape` 收的是浮层（说明框 → 提案 → 行内菜单 → 查找面板 → 设置浮层 → 打断），
这三页一个都不在那一串里。按 5-㊱补 的裁定，回路本来就是点「工作台」。

### 守卫与变异

新增 `composables/hotkey-landing-wiring.test.ts`（8 条），钉的是**接线**（谁提供判据、
判据在动作端与 Esc 端都读到了）与**判据与它所镜像的那两处 `v-if` 的对应关系**。

最后那条是这份守卫的价值所在：只钉「判据读了什么」的话，
某天有人给 `DocumentPane` 的 `v-if` 加一个条件而忘了判据，守卫照样全绿。
所以 `v-if` 的字面值也一并钉住（变异 M8 就是改它——两条红）。

**变异验证 9/9 全红**：打开端不问落点 / Esc 端两个标记分别退回裸读 /
判据从必填退成可选 / 装配层漏接 / 中栏判据漏一半 / 查找判据漏一半 /
模板改 `v-if` 而判据没跟 / `openPalette` 的判据被删。

> 守卫第一版跑出一条假红：反向断言用的是全文文件正则，而 `referenceMenuIsOpen`
> 这个名字在两个接口里都有（`HotkeyFocusSources` 与 `EscapeFocusState`），
> 把合法的那一句也吃了。改成先切出 `resolveEscape({…})` 的实参块再断言。
> **「同名字段出现在不同接口里」是断言写法的一类陷阱**——全文正则不只会误拦，还会误伤。

### 探针这一轮栽的四处

1. **真机第一轮卡在一次导航点击上静默挂死**：前 16 条 PASS 都打在 stdout 里，
   节点以 13（unsettled top-level await）退出——人看着像「跑完了，只是最后一条没打」。
   根因：`cdp.mjs` 的 `send` 是一个**永不 settle 的 promise**，WS 掉一次就卡住。
   → 补了每次 `send` 的超时，超时里带上 method（不能只知道「探针挂了」）。
   **半截的运行会被人当成通过**，这比假红更危险。
2. **导航 id 写错，连坐五条假红**：我按 `centerView` 的取值推的 `data-nav-id`（chat/skills/...），
   而模板里那枚钩是 `workspace`。「选不到钩子 → 返回一个 ok:false」被当成了终止，
   于是起点断言一起红、整轮都里看错那一格。→ 钩子不存在时必须报错，不得静默。
3. **断言写成了一个没有裁定支持的行为**：我把「皮肤广场上按 Esc 回对话」当成应有行为，
   它红了。改成量两件事：Esc 是无动作（对的）、点「工作台」回得去（真正的用户路径）。
4. **断言同一个名字出现在两个接口里**（上面守卫那条）。

### 真机复验：P536M 23/23

两处旧病的关键量：设置页按一次 Esc 就出得去（修前要两下）；
且**回到工作区后那个面板/菜单仍不在**——这一条才是「打开端根本没推那个标记」的关键证据，
只看「面板有没有出现」测不出改动。同时量了回归（工作区上两条键仍有效）与皮肤广场那一格。

### 改动文件清单

- `apps/desktop/src/renderer/src/composables/useHotkeys.ts`（两个落点回调；打开端与 Esc 端同读）
- `apps/desktop/src/renderer/src/App.vue`（装配层的两句判据真身）
- `apps/desktop/src/renderer/src/composables/hotkey-landing-wiring.test.ts`（新增）
- 探针与脚本：`.mochen-tmp/p535/{p536m-landing-esc.mjs, mutate-hotkey-landing.cjs, fix-probe-nav-id.cjs, patch-cdp-send-timeout.cjs}`
- 工具：`.mochen-tmp/f6/cdp.mjs`（`send` 加超时）

## 5-㊵ 浮层族：换成按 role 枚举之后，漏掉的两族一起浮出来

批次手法与前几批一致：**把一整面铺开，按契约枚举，逐项真点**。这一批枚举的契约从**类名**换成 **role**。

### 5-㊱ 与 5-㊲ 是按类名认族的，于是漏了两族

那两批修好了四个弹层与八个面板，两批都是按**族**扫的，而族是按**根类名**认的
（`.dialog-backdrop` / `.xxx-overlay`）。于是两族谁都不属于：

| 漏掉的 | 根类名 | 宣称的语义 |
|---|---|---|
| `ToolRoster` | `.tool-roster-mask` | role="dialog" + aria-modal |
| 七份贴 chip 下拉 | `.change-history` / `.ai-slop` / `.review-score` / `.foreshadow-ledger` / `.timeline-check` / `.volume-outline` / `.context-meter-panel` | role="dialog" |

按 role 重扫（`enumerate-dialog-family.cjs`）：**宣称 role="dialog" / aria-modal 的组件有 11 份没接
`useModalFocus`，其中 10 份还自己挂了 `@keydown` 在面板根上**——正是 5-㊱ 治过的那条，
只是那遍只治了名单里的四份。**类名是实现，role 是契约；契约不会因为改个类名就漏。**
（同一个教训 5-㊳ 已经吃过一次：按 `[class*="-panel"]` 抓浮层，`TimelineCheckPanel` 整个不在快照里。）

### 真机量到的：九枚入口里八枚的 Esc 全哑

`p536n-popover-focus-esc.mjs` 逐个真点、量三件事（面板出现没 / **焦点在不在层内** / Esc 一次能不能收）：

| 浮层 | 焦点在层内 | Esc |
|---|---|---|
| 工具 ▾ ToolRoster | ✅ | ✅ |
| 会话历史 ConversationHistoryMenu | ❌ | ✅ |
| 阶段 / 档案 / 上下文计量 / 改稿历史 / 去 AI 味 / 审稿打分 / 时间线核对 / 伏笔台账 | ❌ | **❌ 按两下也不行** |

修完之后：**22/22**，十一枚可达浮层的 Esc 一次全收得掉，十枚焦点在层内。

### 病根：这一族的 Esc 挂在面板根上，而焦点从来没被挪进去

keydown 走冒泡，焦点不在这棵子树里就收不到。与 5-㊱ 同一条，一份治。
**两处**（不是一处）：Esc 的裁决 `popoverOwnsKey` 本来就写得对，缺的只是「焦点进来」这一步。

### 这一族的两层坑，都是量出来的，不是想出来的

**① 面板 style 初值是 `{ visibility: "hidden" }`**，由 composable 的 `onMounted` 调 `position()` 换掉。
而**对 visibility:hidden 的元素调 `focus()` 是静默失败**。
`p536nb` 逐帧量到：t≈40ms 时面板的 computed visibility 仍是 `hidden`、t≈120ms 才 `visible`；
`ComposerContextMenu` 里那句 `await nextTick(); search.value?.focus()` 正好落在那个窗口里，
**一次都没进去，而且没有任何东西会重试**（t≈1300ms 手动 focus 同一个元素立刻就进去了）。

**② 面板可见了也可能进不去。** 埋点（`p536nd`）量到：面板 `visible`、目标按钮
`rects=1` / `offsetParent=true` / `disabled=false`、面板在场，`focus()` 也调了——
可 `document.activeElement` **当场没动、下一帧也没动**；同一时刻 t≈900ms 手动 focus 同一个按钮立刻成功。

⇒ 所以 `focusFirstWhenVisible()` 的完成判据是 **`el.contains(document.activeElement)`**，
不是「面板可见」。不进去就下一帧再试，直到进去或用完 30 帧预算。
**别猜时机，验到算数**——这是本批最值钱的一条。

### 改法

判据落在两份真身上，**不合并**（它们判的是不同的契约，`useModalFocus` 自己的注释里就写着这条界线）：

- `useComposerContextPopover`（**贴锚点的浮层**）：新增 `focusFirstWhenVisible`。
  不困 Tab（Tab 触边交还触发钮并收起，是这一族原有的契约），但焦点必须进来。
- 七份面板根各补 `tabindex="-1"`：层里一颗可聚焦的都没有时，焦点要落在根上；div/section 默认不可聚焦。
- `ComposerContextMenu` 里那次自家 `focus()` **退役**（不生效的那份，且是同一件事的第二份实现）。
- `ToolRoster` 归 `useModalFocus`：它本来就不是坏的（唯一焦点在层内、Esc 可收的一枚），
  但它是第二份 Esc 实现，且**缺焦点归位与顶层栈**。

`ConversationHistoryMenu` **不动**：它的 `@keydown.esc` 挂在 `.conversation-history-control` 上——
那是**触发钮的祖先**，焦点本来就在钮上、事件自然冒得到。歪打正着，行为是对的，不动没坏的东西。

### 守卫：换枚举方式才是根治

`components/layer-focus-wiring.test.ts`（46 条）+ `utils/vue-source-reader.ts` 新增 `listComponentFiles()`：
**枚举 `components/` 整个目录**，凡是宣称 role="dialog" / aria-modal 的，要么走两份真身之一、
要么在例外表里（理由必须是一句能判真假的话，且不允许是「回头再修」）。
**名单只认名单里有的；目录不会**——那正是 5-㊱ 与 5-㊲ 漏掉两族的原因。

**变异 8/8 全红**：面板根去掉 tabindex / 不接真身 / 进层判据退回「可见就算成」 /
重试预算被删 / ToolRoster 写回自家 Esc / ComposerContextMenu 写回自家 focus /
例外理由改成占位 / 两份真身同时在场。

> 变异 M2 第一版是**绿的**：守卫写的是「文件里提到 useComposerContextPopover」，
> 而变异只把 import 那一行换成注释、正文里的调用还在。改成钉 **import 那行**才咬得住。
> tsc 本来也会红，但守卫不能靠另一道关卡兜底。

### 真机这一轮栽的四处

1. **探针的浮层快照漏了一族**：`layers()` 只抓 `role="dialog"`，而 `PermissionMenu` 是
   `role="menu"` ⇒ 点开它之后差集是空的，被误判成「入口不可用」。与 5-㊳ 那次一模一样。
2. **入口类名按 store 取值推的**：档案 chip 其实是 `composer-profile-context`，
   我按 `composer-book-context`（那是作品 chip）找，选不到。
3. **判据对会话历史过严**：它焦点留在触发钮上是**对的**，把「焦点在层内」套上去就误判。
4. **判据在错误的视图上量**：打开作品之后我立刻在设置页里量「右栏出现了没」——
   而设置视图下 DocumentPane 压根不渲染。要先点「返回工作台」再量。

### 为了量到这一族，绕开了一次环境限制

那六枚 DocumentPane 浮层的入口全是 `:disabled="!book.meta"`，而新建作品必须走
`window.mochen.pickBookDirectory()`（原生文件夹选择器，CDP 够不到那个窗口）。
绕法：盘上按 fs-store 的骨架形状建一本探针书 → 播种 `mochen.project-manager.v1`（书签册存 localStorage）
→ 在设置页「项目」里**真点**那一行（`switchProject` 直接 `book.openBook(rootPath)`）。
**打开作品这一步仍然走产品自己的通路，不注入 store。**

顺带记一个自己犯的错：探针书第一版把 `permissionMode` 写成 `"ask"`，
而 `PERMISSION_MODES` 是 `["read-only","chapter-write","full-access"]` ⇒ `openBook` 被 schema 静默拒掉，
现象是「点开了那一行，右栏却还是缺那七枚入口」。合法取值在 `contracts/permission.ts`，别猜。

### 未量到的一枚

`卷纲转章纲`（`VolumeOutlinePanel`）入口是 `:disabled="!canStructure"`，
而 `canStructure` 要求当前打开的是分卷/大纲类文稿——探针书只放了章节，够不着。
它与另外十枚走的是**同一份真身**，由守卫的目录枚举覆盖。

### 改动文件清单

- `apps/desktop/src/renderer/src/composables/useComposerContextPopover.ts`（焦点进层的真身）
- `apps/desktop/src/renderer/src/components/{ChangeHistoryPanel,ContextMeterPanel,ForeshadowPanel,ReviewScorePanel,SlopPanel,TimelineCheckPanel,VolumeOutlinePanel,ComposerContextMenu}.vue`（根节点 `tabindex="-1"`；ComposerContextMenu 另退役一次自家 focus）
- `apps/desktop/src/renderer/src/components/ToolRoster.vue`（归 `useModalFocus`）
- `apps/desktop/src/renderer/src/components/layer-focus-wiring.test.ts`（新增）
- `apps/desktop/src/renderer/src/utils/vue-source-reader.ts`（新增 `listComponentFiles()`）
- 探针与脚本：`.mochen-tmp/p535/{enumerate-dialog-family.cjs, read-dialog-candidates.cjs, popover-reachability.cjs, popover-root-classes.cjs, make-probe-book.cjs, p536n0-open-probe-book.mjs, p536n-popover-focus-esc.mjs, p536nb-context-menu-focus.mjs, p536nc-why-focus-still-out.mjs, p536nd-read-trace.mjs, p536ne-chip-inventory.mjs, wire-popover-focus.cjs, migrate-tool-roster.cjs, rewrite-focus-in.cjs, fix-probe-p536n.cjs, mutate-layer-focus.cjs}`

## 批次 5-㊹：思考态的空窗期 —— 用户按了发送到第一个字到达之间，中栏原本**一个块都没有**（2026-10-08）

前八批量的都是「点得动吗 / 焦点进得去吗 / 那一键有没有被吃掉」。
这一批第一次量的是**等待**：发出去之后那一两秒，屏幕上发生着什么。

### 量到的缺口

`buildTimeline` 只在 `tail.reasoning` / `tail.message` 非空时才产出块（utils/timeline.ts:180-195）。
于是从「用户按下发送」到「第一个字到达」之间——推理型模型通常一到三秒，长模型更久——
**时间线上一个块都没有**：用户那句问孤零零挂着，界面看着像没发出去。

这是推理型 AI 最容易让人重复发一次的地方（业界叫「十秒空窗」，
CloudFlare 的 Thinking 模式与 OpenAI 的 `Thinking…` 都是为它而生）。

### 判据：当前这一轮，而不是「在跑就在显示」

`utils/thinking-window.ts` 的 `thinkingWindowState` 认四件事：

1. 本轮在跑（`running`）；
2. **当前轮**（= 最后一条 `user-message` 的 `turnId`，事件都带 turnId）**还没有任何助手侧产出**；
3. 助手侧 = reasoning / plan / message / tool-call 四类；
4. tail 为空——tail 有字说明正在流式，那张思考卡/正文自己接管。

第 2 条写成「当前轮」而不是「整个线程有没有助手内容」，是必须的：
后者在第二轮之后永远为真，这一格就再也不出现了。

> 真机上撞过一次相反的形态：验收时我点了第一枚「整窗预览」，
> `startViewTransition` 一次都没被调用。查下去是我点的是**当前正穿着的那套**——
> 屏幕上当然一个字都不变，判据也就正确地判定「不需要」。
> 探针的空跑长得极像功能没接线。

### 那一行的长相

- 三枚呼吸点，收尾用上一批那条弹簧曲线 `--ease-view`（三处共用一份，不各调各的）；
- 过了 1 秒露秒数（`1 秒` / `12 秒`，`tabular-nums` 不跳宽）；
- 过了 8 秒把「正在想…」换成「还在想…」——一直「正在想」不诚实；
- `role="status"` + `aria-live="polite"`；**秒数那格 `aria-hidden`**——
  它每秒变一次，留在 live region 里会把读屏用户淹掉。

### 一处措辞分家，被守卫当场抓到

新写的「在想…」与思考卡上原有的徽标「正在想」是**同一个状态的两种说法**。
⇒ 把三个字提成 `THINKING_LIVE_LABEL`，卡片徽标改成读它（`AgentTimeline.vue`）。
守卫钉住：模板里不许再出现字面量。

### 「关掉动效」在这里比别处长一句

`motion.css` 的总闸把 `animation-duration` 压到 0.01ms ⇒ 三枚点会**停在基础档那一帧**（opacity 0.35），
也就是「关掉动效」变成了「看起来没在动」。所以两档（OS 媒体查询 + 应用内偏好属性）
都显式给出静止档：三枚点都在、亮度一致。**静 ≠ 不在。**

### 守卫 12 + 12

- `utils/thinking-window.test.ts` 12 条：一半的用例在钉「**该关的时候要关**」——
  多挂一行「正在想」比不挂更糟（用户会以为上一轮还在跑，或者以为重复发了）。
- `components/thinking-window-wiring.test.ts` 12 条：接线、位置（末尾且在 `v-for` 之外）、
  可访问性、两档静止档。
- 顺手把上一批写在守卫里的 CSS 规则解析器提到 `utils/vue-source-reader.ts` 的 `cssRules()`
  ——两份实现就是下一次漂移的起点。提到共用处当场暴露了它自己的一个 bug：
  **嵌套规则的「下一个兄弟」起点没推进**，量出来的选择器是「上一条兄弟的整条规则 + 本条」。

### 变异 14/14 全红

判据不看 running / 助手侧少认一类 / tail 不参与判断 / 当前轮认错 /
中心列不传 running / 组件自己再判一次 / 秒数不 `aria-hidden` /
少一道静止档 / 静止档亮度删掉 / 措辞分家 / 自抄缓动曲线 / 门槛写成 0 / 没引进样式表 / 少一道播报。

### 真机复验（探针书 + 本仓桩服务）

| 量到的 | 值 |
|---|---|
| 出现时的字 | `正在想…` |
| 三枚点 | 3 枚，`opacity 0.35` |
| `role` / `aria-live` | `status` / `polite` |
| 秒数 | `1 秒`（过了 1s 露出来） |
| **存活时长** | **1320ms**，第一块到达后自动退场 |
| 退场后 | `stillThere: false` |

> 顺带量到一条结构事实：**时间线那一格是 `v-else` 分支**，空状态下整块不挂载
> （CenterColumn.vue:357）。观察器因此必须挂 `document.body` 而不是 `.agent-timeline`。

### 本轮撞到的另一件事（**更严重，不属于这一批**）

真机发轮时报：

```
模型服务端返回 422：Failed to deserialize the JSON body into the target type:
tools[9].function: missing field `parameters`
```

**每一轮都 422，一次都没成功过。** 数下来这一轮发了 10 枚工具：
本地花名册 6 枚 + 插件 3 枚 + 联网那枚 = `tools[9]`。
本地与插件两路的 `parameters` 都一定会写上（`tools.ts` 的 `object()`、
`plugin-service.ts` 的 `toSpecParameters`），**唯一不带 `function.parameters` 的是联网那条**
——它发的是原生形状 `{ type: "web_search" }`（`per-run-fields.ts` 的 `webSearchToolEntry`）。

本仓已有一条同族先例：密钥头（`authHeader`）就是**按连接**区分的，因为小米 MiMo 只认 `api-key`。
联网那枚的线格式同样应该按连接区分，而不是一刀切。
**但这改的是联网功能本身的行为（服务端搜索 vs 本地搜索），是产品裁定，本轮没有擅自改。**

### 留给下一批

- **上面那条 422**：要么给连接加一档「联网线格式」，要么把联网改成函数形状。
  前者跟随 `authHeader` 的既有形状；后者会让它与本地那枚 `web_search` 同名。
  **两条路都要先量目标端点收哪种形状**，不能凭猜。
  **已由 `ef46153` 收口，走的是第二条**：出站只允许一种形状
  （`{type:"function", function}`），联网开关改为决定花名册里那枚 `web_search`
  function 工具有没有出站（开 6 枚 / 关 5 枚），不再往清单里追加第二种形状。
  这里担心的「同名」没有发生——本地从来就没有另一枚 `web_search`，
  原先那枚裸条目就是唯一的一份；常量顺势从 `WEB_SEARCH_WIRE_TYPE` 更名
  `WEB_SEARCH_TOOL_NAME`，因为它本来就是工具名而不是线格式。
- 空窗期只补了「助手位那一行」。业界还有两条同族：思考完成后显示**总时长**
  （需要事件带时间戳——现在只有 `turnId` 与轮次级 `ts`），以及**跳过思考**。
- 用户点名的另两块（功能按钮、对话框）本轮只做了普查没动：
  对话框现有 `dialog.css` 一套出场，弹簧曲线还没接进去；
  输入卡 chip 行在 1120 窄档已有四级让位阶梯（#113f），按钮侧的缺口要单独量。

## 批次 5-㊸：视图过渡与弹簧缓动 —— 前六批一直在量「点得动吗」，没量过「换起来好不好看」（2026-10-08）

前六批（面板 → 左栏 → 键位 → 浮层 → 交互装配 → 输入法）量的全是**对不对**：
点得中吗、焦点进得去吗、那一键有没有被吃掉。

「换起来好不好看」这一整族，从建仓到现在**一件都没有**——
量过的动效只有 `motion.css` 那一小撮（浮层出场 + 按压下沉），
而那还是 2026-10-05 随手加的一层。全仓 `document.startViewTransition` 命中 0 次、
`linear()` 命中 0 次、`::view-transition` 命中 0 次。

本批去网上查了当下最认的三个（View Transitions / 弹簧物理 / 状态过渡连续性），
挑了**两个能落在这套三栏壳上**的搬进来，并且每一件都先量后写。

### 第一件：先把「支不支持」这件事量清楚

```
ua            Chrome/148.0.7778.271  Electron/42.5.0
hasApi        document.startViewTransition 是个函数         ✓
linearEasing  CSS.supports("animation-timing-function: linear(0,1)")  ✓
typeSelector  CSS.supports("selector(:active-view-transition-type(forward))")  ✓
```

三项全绿。**然后真跑一次，动画没挂上**：

```
callbackRan: true      update 回调确实执行了
ready      : InvalidStateError — Transition was aborted because of invalid state
finished   : resolved
伪元素动画 : 0 个
```

`InvalidStateError` 这四个字指向的东西不在本仓代码里，也不在浏览器里，
在**窗口状态**上——那一轮量的时候，窗口是最小化的。

### 本轮量到的第一件事，也是最贵的一课

> **文档不可见时，Chromium 直接跳过视图过渡。**
> `document.visibilityState === "hidden"` ⇒ `ready` 以 `InvalidStateError` 拒绝，
> 而 `finished` 照样 resolve。现象是「API 被调用了，但一个动画都没有」。

这个现象长得极像**功能没接线**：调用确实发生了、界面确实换了、
就是没有动画。差点据此去改接线。真正的分水岭是把
「**发起了没有**」与「**挂上动画没有**」分开量——把 `document.startViewTransition`
包一层数调用次数，一眼就分清了。

⇒ 于是有了本轮的第一份守卫之外的一条规矩：**探针先断言窗口可见，不可见直接报 MISS，不产出结论。**
`p537i-final.mjs` 开头就是这一句。真机上这一条救了两轮：
窗口被完全遮挡时（`IsWindowVisible=true` 但被别的窗口压住），
Chromium 一样判 hidden——`IsWindowVisible` 那个 API 在这里会骗人。

另外记一条给将来量视图过渡的人：**窗口的叫醒与探针必须跑在同一条命令里**。
分两次跑，中间任何一次别的窗口抢焦点，那一轮的结论就是假的（本轮撞了三次）。

### 真身：`utils/view-transition.ts`

散在十几处调用里会漏的坑，一共四个，全部收在这一处：

| 坑 | 症状 | 处理 |
|---|---|---|
| **Vue 不同步改 DOM** | 回调里改完 ref 就返回 ⇒ 浏览器拍到的「新」快照和旧的一样，**过渡白跑且不报错** | 回调返回 `nextTick()` |
| 文档不可见 | `ready` 拒绝 ⇒ 一次未处理的 promise 拒绝落在控制台 | `ready.catch(() => {})` |
| 引擎不认这个形状 | 同步抛 ⇒ 界面冻在原地（**功能坏了**，比没动效严重） | catch 里照做 `update()` |
| 并发 | 排队 ⇒ 界面慢半拍追上来 | 第二次直接落地 |

另外三道判据各有归属，不在真身里私造：

- **减少动效**认两档：应用内偏好（`html[data-reduced-motion]`，那档本机存着 `true`）
  与 OS 级 `prefers-reduced-motion`（本机 `false`）。任一为真 ⇒ 一次过渡都不起。
- **方向**：去 = `mochen-forward`、回 = `mochen-back`，只两个。CSS 侧逐字钉着这两个名字。
- **在飞**：模块级一份，跟着 `finished` 走；复制出去就会变成两份各自的「在飞」。

### 第二件：只让内容格动，左栏纹丝不动

视图过渡的机制是：**挂了 `view-transition-name` 的元素被从 root 快照里单独拎出来**。
于是只要给内容格挂名字、**不给左栏挂**，左栏与标题栏就留在 root 快照里，
而 root 快照在这几次切换中逐像素相同 ⇒ 默认那次交叉淡入在屏幕上等于没有。

真机量到的名字与几何：

```
.conversation-pane  mochen-center   [286, 0, 664, 902]
.editor-pane       mochen-right    [950, 0, 490, 902]
.left-sidebar      none            ← 刻意不给
```

**为什么是两个而不是一个**：从对话切去皮肤广场时右栏编辑器要退场，
不给它名字的话它就留在 root 快照里，root 一淡就是「整个右栏跟着闪一下」，那是错的。

### 第三件：弹簧缓动——从物理参数起手，不是抄一条现成的

网上那些 `linear()` 曲线是**别人的手感**（多半给按钮调的）。这里从阻尼谐振子采样：

```
zeta = 0.62   omega = 13   采样 34 段
过冲 8.29% · 峰值在 30% · 尾部 |v-1| ≤ 1.7e-4 · 首 0 末 1
```

生成与自检脚本 `.mochen-tmp/p537/spring.cjs` 在仓外，参数与自检口径写在 CSS 注释里可审。
兜底 `@supports (animation-timing-function: linear(0, 1))` 之外先给 cubic-bezier：
引擎不认 `linear()` 时观感退一步，而不是变成默认 `ease`。

守卫把它钉成一条性质而不是一条字面量：**采样点首 0 末 1，且全部落在 [0, 1.15]**。
把峰值改成 1.5（那是晃不是弹）立刻变红。

### 接线：三条判据，各自有它为什么

**① 视图切换**：左栏两枚钮 / 进设置 / 回工作台 / 斜杠命令，全都汇到
`layoutStore` 的三个函数。**只有「那一格真的换页面」才发起过渡**
（`contentSlotSwitches` 判据只有一份，三处共用）：

- 同页重入（连点两枚钮）⇒ old/new 两张快照逐像素相同，白拍一轮 220ms，
  还会占住在飞闸让下一次真切换放不出来；
- 设置页换页签 ⇒ `SettingsPage` 根本不卸载，为了左栏一枚高亮挪位置把整页淡一遍，比不做还晃。

**② 换皮肤**：走**同一个真身**，但判据是另一条（`skinPaintKey`）。
`applyTheme()` 不只是「换皮肤」被调用——改字号、换字体、切深浅、侧栏半透明都走这一条；
不看这一位，拖字号滑块就会整窗不停交叉淡一次。
判据只认三样：明暗、皮肤 id、画面层；字号/字体/行距/半透明是连续微调，不在里面。

> 真机上这一条**被撞了一次**：量「换皮肤会不会淡」时点了第一枚「整窗预览」，
> 结果 `startViewTransition` 一次都没被调用。查下去是我点的是**当前正穿着的那套**——
> 屏幕上当然一个字都不变，判据也就正确地判定「不需要过渡」。探针的空跑长得像功能没接线。

### 守卫：两份，一条会自己长大

- `utils/view-transition.test.ts` **12 条**：用假 document 覆盖四道闸 + 两个判据。
  真机上最要命的那条（`ready` 拒绝）在 node 里就是 `Promise.reject(DOMException)`，一行复现。
- `components/view-transition-wiring.test.ts` **12 条**：钉接线、方向名、CSS 里的名字与兜底。

其中一条是**会自己长大的**：

> 凡在本文件挂过 `view-transition-name` 的名字，三种伪元素都必须出现在关闭动效的那两段里。

将来给第六个页面挂名字而忘了关动效，只有它会红。
它之所以必要：`motion.css` 的总闸选择器是 `html[data-reduced-motion="true"] *`，
而 **`*` 匹配不到 `::view-transition-*` 伪元素**（它们不在元素的子树上）——
光靠那份总闸，视图过渡根本关不掉。

### 变异：15 条全红

`mutate-view.cjs`：写反回程方向 / 设置页不走真身 / 判据只剩一份实现 / 首刷也淡 /
判据偷看字号 / 关闭段漏一处 / 少了 OS 那道闸 / 弹簧曲线整段删 / 过冲放到 50% /
不接 `ready` 的拒绝 / 忘了 `nextTick` / 少一道闸 / 绕过真身自己发起 /
拆出第二条刷主题通路 / 样式表没引进 `styles.css` —— **15/15 全红**。

还原一律拿**变异前存下的字节**写回，不用现读现比。

### 真机复验（两腿）

窗口可见前提下，同一按钮、同一记法：

| | 减少动效开 | 减少动效关 |
|---|---|---|
| 视图切换 `ready` | **被拦下**（一次 `startViewTransition` 都没发） | `readyOk: true` |
| 伪元素 | — | `group(mochen-center)` / `old(mochen-center)` / `old(root)` / `group(root)` |
| 方向类型 | — | `activeTypes: ["mochen-forward"]` |
| 时长 | — | `220ms`（root 与命名元素同一节奏） |

换皮肤那一腿（点第二套的「整窗预览」）：

```
before  shallow-hall-day  | #E8F6FA
after   abyss-hall-night  | #0B1A26     ← 皮肤真的换了
伪元素   group(root) / old(root) / group(mochen-center) / old(mochen-center)
typesSent: null            ← 无方向，换配色不该有方向
durations: [220]           ← 单一节奏
退出预览后 shallow-hall-day | #E8F6FA    ← 复原干净
```

中途帧（`.mochen-tmp/p537/shot-p537j-mid.png`）里能直接看见设计意图：
**中栏内容在交叉淡入，左栏完全不动、清晰如常**。

### 本轮自己的错（四个，四个都不是产品的问题）

① 探针挂在隐形的窗口上量了四轮「为什么没动画」，真因是 `visibilityState`。
② 量皮肤时读了一个**不存在的 token**（`--skin-art`；画面层其实是 `dataset.skinArt`），
   before/after 三个读数全是同一个空串——看起来像「预览没生效」，其实什么都没量到。
③ 假宿主**从不调用 update 回调**（真浏览器同一拍就调），
   于是「并发那条」量到的红是「第一场还没落地」，红的不是要验的那件事。
④ `node -e` 里写 `$1`，被 PowerShell 的双引号串吃成空串（两次），
   一次把 `await fake.invoked[]` 写成空下标。含 `$` 的替换一律走脚本文件。

### 改动文件清单

- `apps/desktop/src/renderer/src/utils/view-transition.ts`（新增真身）
- `apps/desktop/src/renderer/src/styles/view-transition.css`（新增样式层）
- `apps/desktop/src/renderer/src/styles.css`（引进上面那份，排在 motion.css 之后）
- `apps/desktop/src/renderer/src/stores/layoutStore.ts`（三处切换 + `contentSlotSwitches`）
- `apps/desktop/src/renderer/src/App.vue`（换皮肤走同一真身 + `skinPaintKey`）
- `apps/desktop/src/renderer/src/utils/view-transition.test.ts`（新增 12 条）
- `apps/desktop/src/renderer/src/components/view-transition-wiring.test.ts`（新增 12 条）
- 探针与脚本：`.mochen-tmp/p537/{spring.cjs, mutate-view.cjs, p537a-support.mjs, p537b-why.mjs, p537d-mounted.mjs, p537i-final.mjs, p537j-forward.mjs, p537k4-second-skin.mjs}`

### 留给下一批

- **`vue-tsc` 仍然没装**（5-㊶ 记的仍是它）：组件层零类型检查。
  本轮又多一处同类证据——`.vue` 里的接线错误（模板不调某个函数、某个 handler 漏接）
  只能靠读源码的守卫钉，而守卫靠的是字符串匹配。
- 视图过渡只接了**内容格切换**与**换配色**两处。右栏内部换文档、左栏树展开收起、
  卡片列表重排都还是瞬变；每一处都要单独量「名字唯一吗」「退场的那一格会闪吗」。
- `::view-transition-group(root)` 原本是引擎默认的 250ms，本轮改成 220ms 与其余对齐；
  但 root 的 group 在**几何不变**时是否真的完全不参与，实机还没单独量过。

## 批次 5-㊶：中文输入法组合态 —— 前五批里从没被量过的那一格

前面五批（面板 → 左栏 → 键位 → 浮层）量的是**鼠标与键盘**，
唯独有一类按键从来没被单独看过：**它不是用户按的，是输入法按的**。

拼音打字时，回车、上档键这些还在**组合态**里 —— 用户的意思是「选这个词」，
不是「执行这个快捷键」。产品如果在这一刻把它当自己的快捷键处理，最刺眼的后果就是
**候选词被吃掉**：用户按回车想确认「雨」，什么也没进去，还得再按一次。

### 真机量到的（P536O，查找替换面板）

组合态用 CDP 的 `Input.imeSetComposition` 真实起一段（「yu」），回车用
`Input.dispatchKeyEvent` 真发；两个探针分别挂在 window 的**捕获**与**冒泡**阶段：

```
capture: key=Enter  isComposing=true  defaultPrevented=false
bubble : key=Enter  isComposing=true  defaultPrevented=true   ← 组件 preventDefault 了
inputValue: "yu"                                                    ← 拼音卡在框里，候选没了
```

**只记捕获阶段会永远读到 false** —— 捕获在组件处理器之前跑，
要看出「组件有没有 preventDefault」，探针必须挂在冒泡阶段。
这一条是本轮量到的第一件事，也是量对的第一件事。

同一测量在**正文输入框**上是 `false` —— 全局 `resolveHotkey` 的闸门是好的。
也就是说：**这道闸在正文输入框上存在，在这十个弹层/输入框上根本没写。**
不是闸门坏了，是闸门只盖了一条路。

### 为什么会漏：`.prevent` 修饰符是无条件执行的

四个文本输入框的模板长这样：

```html
@keydown.enter.prevent="blurTitle($event)"
```

Vue 的 `.prevent` 是**修饰符**：它先 `preventDefault()`，**再**调 handler。
于是 handler 里哪怕写了 `if (组合态) return`，那一键也已经被吞掉了 ——
闸门写在 handler 里是**拦不住**模板修饰符的。

⇒ 修法不是补一行 `if`，是把 `preventDefault` 从模板搬进 handler，
**和闸门放在同一个函数里**，模板上换成 `@keydown="onX"` 一个入口。

顺带量到后果的严重程度：`confirmRenaming` 那条路上，
组合态里按回车时 `renameValue` 里是**拼音**，`book.renameDocTitle(relPath, "yu")`
会把这一章真名成「yu」—— 不是丢字，是**写坏盘上的数据**。

### 第二处：真身被架空

`popoverOwnsKey(key, mods, isComposing)` 是六份面板共用的判据。
其中六份传的是 `close` 这个**函数**：

```ts
if (popoverOwnsKey(event.key, mods, close)) { event.preventDefault(); return; }
if (event.key === "Escape") { close(); return; }   // ← 真正干活的是这一支
```

函数是真值 ⇒ 真身**恒返回 false** ⇒ 第一支是死代码，Esc 实际由紧跟着那份
手抄的裸比较兜住。两个后果：判定被架空，而「同一判定只留一份实现」被破了。

**它为什么能活这么久：`.vue` 文件根本不在类型检查范围内。**

```
tsc --noEmit -p apps/desktop/tsconfig.web.json --listFiles
  → vue_files_in_program=0        （普通 tsc 不解析 .vue；vue-tsc 没装）
```

`close: () => void` 传给 `isComposing: boolean` 是 0.1 秒能抓到的类型错误，
而 `verify` 跑的是普通 `tsc`。**整个组件层——前五批所有缺陷的所在地——从不被类型检查。**
本批没有动这件事（装 `vue-tsc` 要先清的历史错误量未知，是独立的一批），
但它是这一族能复发这么多次的根，记在这里。

### 修法：判据提成唯一一份

`utils/slash-commands.ts` 新增真身，紧挨着 `popoverOwnsKey`：

```ts
export function imeOwnsKey(event: KeyboardEvent): boolean {
  return event.isComposing === true || event.keyCode === 229;
}
```

为什么值得提成一份函数而不是各处写 `event.isComposing === true`：
组合态的判据将来只会有**一种**形状（真身 + 老式 229 兜底 + 别的输入法差异），
散在十几处写，改一次要改十几处，漏一处就是一枚新的「回车吃掉候选」。
`keyCode === 229` 一起收进来，是因为个别输入法与部分 Electron/Windows 组合
只给 229 而不把 `isComposing` 置真。

十份弹层全部改走真身；六份里那份手抄的裸 Escape 比较**删掉**（第一支自己 `close()`）。
四个输入框各自补上闸门，并把 `preventDefault` 从模板搬进 handler。

### 守卫：三条，缺一条就能再犯

`utils/ime-guard-wiring.test.ts`（7 条）：

1. **判据唯一**：全仓组件层枚举（`listComponentFiles()`），
   任何文件自己判 `event.isComposing` / `keyCode === 229` 就红。
   名单型判据的失效方向永远是「不认识的一律放过」，所以这条按**目录**枚举，不按名单。
2. **顺序**：每个 handler 的闸门必须排在 `preventDefault` 之前。
   顺序反了等于没修 —— 那一键已经被吞掉了，判不判组合态都来不及。
3. **模板不许再用 `.prevent` 修饰符**：同样按目录枚举整个组件层，
   新增一个带 `@keydown.enter.prevent` 的输入框必须立刻红。
   排除项只有一条，且写清为什么：左栏「…」那枚 Esc 挂在**按钮**上，按钮永远不会处于组合态。

变异 **7/7 全红**：去掉 229 兜底 / 删掉查找框闸门 / 把标题的闸门挪到 preventDefault 之后 /
把真身改回传 `close` / 把手抄的裸比较放回来 / 把模板修饰符放回来 / 某处散写判据。
（还原用变异**前存下的字节**写回，不用现读现比 —— 现读现比会让 restore 分支永远报 clean。）

### 真机复验

同一输入框、同样的「拼音 yu + 回车选词」：

| | 修前 | 修后 |
|---|---|---|
| `bubble` `defaultPrevented` | **true**（回车被吞） | **false**（还给输入法） |
| 查找框内容 | `yu`，候选丢了 | `yu`，组合态还开着 |

### 本轮自己的三个错

① 探针挂在**捕获**阶段量 `defaultPrevented`，永远读到 false，结论会变成「没问题」。
② `__clickReal` 助手注入在 `Page.reload` **之前**，reload 换掉整个 JS 上下文，助手连页面一起没了。
③ 守卫的正则漏了字面量括号：模板上是 `onX($event)`，`(\$event)?` 匹配不上，
得写 `(\(\$event\))?`。另外形参名各文件不一（`event` / `e`），判形状不能判名字。

### 改动文件清单

- `apps/desktop/src/renderer/src/utils/slash-commands.ts`（新增 `imeOwnsKey` 真身）
- `apps/desktop/src/renderer/src/components/ComposerContextMenu.vue`
- `apps/desktop/src/renderer/src/components/ContextMeterPanel.vue`
- `apps/desktop/src/renderer/src/components/ModelSelect.vue`
- `apps/desktop/src/renderer/src/components/PermissionMenu.vue`
- `apps/desktop/src/renderer/src/components/ChangeHistoryPanel.vue`
- `apps/desktop/src/renderer/src/components/ForeshadowPanel.vue`
- `apps/desktop/src/renderer/src/components/ReviewScorePanel.vue`
- `apps/desktop/src/renderer/src/components/SlopPanel.vue`
- `apps/desktop/src/renderer/src/components/TimelineCheckPanel.vue`
- `apps/desktop/src/renderer/src/components/VolumeOutlinePanel.vue`
- `apps/desktop/src/renderer/src/components/FindReplacePanel.vue`
- `apps/desktop/src/renderer/src/components/SearchPanel.vue`
- `apps/desktop/src/renderer/src/components/DocumentPane.vue`
- `apps/desktop/src/renderer/src/components/LeftSidebar.vue`
- `apps/desktop/src/renderer/src/utils/ime-guard-wiring.test.ts`（新增）
- 守卫改钉新决定：`composer-context-bar-wiring.test.ts`、`model-select-wiring.test.ts`、
  `document-pane-wiring.test.ts`、`left-sidebar-nav.test.ts`
- 探针与脚本：`.mochen-tmp/f6/p536o-*.mjs`、`.mochen-tmp/p536o/{fix-stage1,fix-stage2,fix-guards,mutate-ime}.cjs`

### 留给下一批

- **`vue-tsc` 没装**：组件层零类型检查。本批已量出至少一处「0.1 秒能抓、却一直没人抓」的错误，
  但装它之前要先知道历史错误有多少 —— 那是独立的一批，不能顺手塞进来。
- 组合态只量了**回车与 Esc**。方向键（候选词选上下）、退格、Tab 在组合态里的行为还没量。

### 门禁里撞到的两件事，都不是「改松就过」

**① 行数预算把左栏顶出去了。** `LeftSidebar.vue` 加完两个 handler 是 811 行（上限 800）。
该做的不是砍注释字数，而是发现**我那两个 handler 本来就是同一判定的两份实现**
（只有 confirm/cancel 不同，闸门与顺序完全一样）。合成一个工厂 `textRowKeydown`，
既过预算，又把那份重复收掉 —— 门禁第二次替我抓到「同一判定两份实现」。

**② prettier / eslint 连续三道。** 新写的守卫先被 prettier 拦，再被 eslint 拦
（`no-regex-spaces`：正则里两格空格要写成 `{2}`）。都不是产品问题，是新测试文件没过格式门禁。

### 本轮自己的三个错（都不是产品的问题）

① 探针挂在 **捕获** 阶段量 `defaultPrevented` —— 捕获在组件处理器之前跑，永远读到 false，
   结论会变成「没问题」。要看出组件有没有 preventDefault，探针必须挂**冒泡**。
② `__clickReal` 助手注入在 `Page.reload` **之前** —— reload 换掉整个 JS 上下文，助手连页面一起没了。
③ 守卫的正则漏了字面量括号（模板上是 `onX($event)`，得写成 `(\(\$event\))?`）；
   另外各文件形参名不一（`event` / `e`），判形状不能判名字。

### 最终数字

- 守卫 `utils/ime-guard-wiring.test.ts`：7 条
- 变异 **8/8 全红**（M8 是左栏工厂那条：把 preventDefault 排到闸门之前 ⇒ 顺序反了 = 等于没修）
- 真机复验：同一输入框、同一段拼音、同一记回车，`bubble.defaultPrevented` 由 `true` 变 `false`
- 全量门禁 **207 文件 / 2883 用例 / VERIFY_EXIT=0**
- `SCAN_FFFD_CLEAN`（含本轮 20 个改动文件单独扫）

### 留给下一批

- **`vue-tsc` 没装**：组件层零类型检查。本批已量出至少一处「0.1 秒能抓、却一直没人抓」的错误
  （`close: () => void` 传给 `isComposing: boolean`），但装它之前要先知道历史错误有多少。
  那是独立的一批，不能顺手塞进来。
- 组合态只量了**回车与 Esc**。方向键（候选词选上下）、退格、Tab 在组合态里的行为还没量。

## 批次 5-㊷ · 皮肤广场第三版：只收带整窗画面的皮肤（2026-10-08）

【批次号】本批落笔时工作区里已经有一条**未提交**的 5-㊶（中文输入法组合态，另一条线上在做），
台账里也写了它。同号会让两批人在同一份账上撞车，所以本批顺延为 **5-㊷**，
源码注释里先前写的 ㊶ 已逐处改成 ㊷（只改本批的七个文件，没碰那一批的任何文件）。

### 用户这一批判的是什么

原话三句：「那 15 套没有画的，给去除。加入能有画的和挂件」／
「我想要的是 DSH 那个趣味换装一样的皮肤，而不是只改颜色和字体」／
素材来源「全部我用 ImageGen 自绘，我自己提供图，给我什么样的，我让他给你做就行了」。

第二句判的正是 5-㊵ 自己在文件头已经承认过的东西：**四层全是 CSS 质地**，
换完读起来仍然只是「换了个色调」。被一眼认出来的那一层从来不在四层里——是**画**。
⇒ 这一批做的事：给皮肤加第五层 `art`（整窗位图），并且把广场的入场条件就定成它。

### 一、画面层：第五层是位图，不是渐变

- contracts 新增 `APPEARANCE_ARTS`（`none` / `abyss-hall-night` / `shallow-hall-day`）、
  `AppearanceArtSchema`、`DEFAULT_APPEARANCE_ART = "none"`，并挂进 `AppearanceThemeConfigSchema`。
  **默认必须是 `none`**：老 JSON 缺这个字段时由 zod 补，补成一上来就带画，
  等于应用一次升级就把所有人的界面换了，而用户什么也没点。
- **为什么是枚举而不是任意路径**：路径若任意，等于把「渲染层允许加载什么」交给数据表——
  一条 `file://` 或远程 URL 就能从数据里长进 CSS。枚举把它关在「只有这三档」，
  「这个 id 对应哪张图」只有 `appearanceSkinVisual.ts` 一处真身。
- 出图两张（`renderer/public/skins/*.jpg`，1536×1024）：「汐」系列昼与夜同一套构图，
  沉在海底的藏书阁 + 两位蓝发鲸耳的姑娘，道具全是**稿子**（卷轴、稿纸、羽毛笔、墨水瓶），
  中间整片留空——墨宸三栏要落的位置，这条写进了生图 prompt，否则立绘会被面板压掉。
  昼与夜也顺带满足了那条老规矩：每套皮肤必须配深浅两版。
- CSS 侧层序是 `veil, art-image, backdrop`：纱在最上、画在中间、CSS 弥散光在最下。
  `.desktop-shell` 在有画时把正文区背景放行到 52%，否则画会被自家面板完全盖住——
  画了等于没画。

### 二、十五条下架，但一条数据都没少

被下架的分两处安置：

- **十套出厂配色 → 新文件 `appearanceTones.ts`**（id、顺序、三色逐字照盘回读，一字未改）。
  它不是「留个纪念」，有三件事指着这份文件：用户盘上存的就是这些 id；
  `themePresets` 的唯一真身在这里；将来加回一套素面皮只改这一处。
- **五套改编皮 → 条目下架，数值与出处全留着**（`appearanceSkinVisual.ts` 的 `UPSTREAM_*`，
  每条注着上游文件与行号；对账守卫 `appearance-skin-visual.test.ts` 一条没删）。
  老用户盘上存着 `glass: "standard"`、`grid: "industrial"` 的，运行时照样要按那一条值渲染——
  枚举与数值一删，那些人什么也没点，界面却自己变了。
- 出处标记拆成**两句**：`OWN_SKIN_ORIGIN`（出厂素面配色）与 `OWN_ART_ORIGIN`（原创画面皮）。
  复用同一句会让两条带画的皮被投影进「主题配色」那张表——真机上就是这里红的：10 条变 12 条。

### 三、投影塌成零条 —— 一次「改了写法才会暴露」的假绿

`themePresets` 原先是 `appearanceSkins.filter(origin === OWN_SKIN_ORIGIN)`。
广场一旦不剩素面皮，这条投影就变成**零条**，于是
`appearance-theme-readability.test.ts` 里那句 `for (const preset of themePresets)`
退化成**空遍历**：照样全绿，却一条也没测。⇒ 投影源改成直接读 `appearanceTones`，
并在守卫里先钉「这一族非空」（空表必须先红，不许静通过）。

### 四、死档：三档有数值、没有皮肤（本批顺手修的一条既有缺陷）

起因是用户那句「加入能有画的和挂件」逼我去核对筛选条：
`SKIN_BACKDROP_FILTERS` 原先等于 contracts 的**全量枚举**，
而 `nebula / ember / midnight` 没有任何皮肤在用 ⇒ 点那三枚按钮必然得到空列表，
页面显示「没有匹配的皮肤，换个条件」——看着像用户筛错了，其实那枚按钮从一开始就不该存在，
而**没有任何一处会报错**。
修法：筛选档改成**从皮肤表派生**的在用小集合（`usedValues()`，顺序仍跟 contracts 键序），
contracts 枚举与五张中文档名表保持全量——老 JSON 里可能存着一档广场不卖的合法值，档名要一直查得到。

### 五、外观页那句「未知的一套」是假话

`currentSkinLabel` 原先只查广场表，查不到就说「未知的一套」。
下架之后，盘上存着 `paper` / `crimson` 的用户会走到这一句——
可那一套的三色**此刻就作用在界面上**，把「我们主动下架」说成「我不认识你存的东西」，
用户会以为设置丢了。⇒ 兜底顺序 skin → preset → 未知。
顺流量到一条：**contracts 里 `skin` 的出厂默认是 `"plain"`，那是个占位符，不在任何一张表的 id 空间里**，
而真正生效的配色写在 `preset`（默认 `"codex"`）——只查 `skin` 的话，
**从没换过皮肤的新用户**一进外观页就读到「未知的一套」。这一条是本次读源码时撞见的，不是推测。

### 守卫与变异（两条都是实测，不是推理）

| 变异 | 落法 | 结果 |
| --- | --- | --- |
| 底版表清空 | `appearanceTones` 临时改成 `[]`（十套搬进一个没导出的 `realTones`） | **11 条断言红**，跨 3 个文件（skins 1 / readability 4 / presets 3 等），证明「先钉非空」真的在防空遍历假绿 |
| 面板兜底那一档 | 把 `findAppearanceTone(skin) ?? findAppearanceTone(preset)` 删成只剩前半、文案改短 | `MUT_EXIT=1`，AssertionError 点名那条 ?? 链 |

新增/改钉的守卫（`appearance-skins.test.ts` + 拆出的 `appearance-skin-plaza-wiring.test.ts`）：
形状 17 → 2；入场判据 `art !== "none"` 与 `SKIN_ART_FILTERS` 不含 `none`；
`origin` 必须是 `OWN_ART_ORIGIN`；底版十套的 id/顺序/字值与五键形状；
`findAppearanceTone(skin.id)` 必须 `undefined`（两张表不许混住）；
`checkAdaptedOrigin` 提成函数并配四条非法写法的反向用例（表里没有改编皮也能验）；
筛选档三维通用查法 `checkOneLayer<T>`（摆出来的每档非空 / 表里用过的一个不漏 / contracts 仍全量）
+ 两条源码级反向钉（不许写死全量枚举、不许再 `Object.keys(LABELS)`）；
可读性拆成「广场每一条」「出厂十套」两条，各自先钉非空。

### 本轮自己的三个错

1. **批次号没先查台账就写了 `5-㊶`**，写完才在同一份工作区里发现它已被占用。
   教训：编号是共享计数器，动笔前先 `grep` 台账尾部。
2. **守卫加到 1036 行才去看预算**（800 行上限 ⇒ `lint:budget` 红）。
   拆的时候顺手发现搬走那一组的注释头写着「运行时 · 四层换算成 `--skin-*`」，
   内容却是广场页接线——那是 5-㊵ 拆分留下的错位标题，顺着内容改回来了。
3. **`checkOneLayer` 初稿把五维塞进一个 `as const` 对象数组**，
   `layer.all.filter(...)` 在 tsc 里是「联合签名不能调用」——红在守卫自己身上，
   与要防的缺陷毫无关系。改成泛型函数逐维调用。

### 门禁数字

`TYPECHECK_EXIT=0`（7 个 TS6133/TS2304 全在拆文件前红过，拆完清干净）、
`ESLINT_EXIT=0`、`BOUNDARY_EXIT=0`、`BUDGET_EXIT=0`、`PRETTIER_EXIT=0`、
`TEST_EXIT=0`：**208 文件 / 2898 用例全过**。

### 改动文件清单

- `packages/contracts/src/appearance.ts`：`APPEARANCE_ARTS` + schema 字段 + 默认值
- `apps/desktop/src/renderer/public/skins/abyss-hall-night.jpg`、`shallow-hall-day.jpg`（新增）
- `composables/appearanceTones.ts`（新增：出厂十套底版）
- `composables/appearanceSkins.ts`（17 条 → 2 条 + 入场判据 + 筛选档派生 + 两句出处）
- `composables/appearanceThemeRuntime.ts`（`themePresets` 投影源换成底版）
- `composables/appearanceSkinVisual.ts`（`ART_FILES` / `artImage` / `artVeil` / `--skin-art-*`）
- `stores/useSkinBrowse.ts`（筛选行读派生档，删掉五个 `Object.keys(LABELS)` 的 _ORDER）
- `components/SkinGalleryPage.vue`（页首那句说明改成「广场只收带整窗画面的皮肤」）
- `components/AppearancePanel.vue`（`currentSkinLabel` 两级兜底）
- `styles/theme-runtime.css`、`styles/skin-gallery.css`（画面层层序与正文放行、卡片预览的画）
- `composables/appearance-skins.test.ts`、`appearance-skin-visual.test.ts`、
  `appearance-skin-plaza-wiring.test.ts`（新）、`components/appearance-panel-wiring.test.ts`

### 留给下一批

- **挂件层**（用户要的「和挂件」那半句）：契约 `APPEARANCE_ORNAMENTS` +
  `--skin-ornament-image` + `.desktop-shell` 挂位，**留到素材就位再接**——
  先加枚举再接运行时会在表里留下一个谁都不用的空档，正是本批刚修掉的「死档」那一族。
- **素材规格单**：用户说图可以由他那边的人做，所以要把「多大、哪里留空、深潜多少、
  命名与落盘位置」写成一张能直接交给画师的单子（本批的 prompt 条件是起点）。
- **广场页体验**：整窗预览 + 两套并排对比（用户选的第二条）。
- **真机逐套验证**：本批只过了门禁，两条带画皮的真实渲染还没量。
  （2026-10-08 波3 收尾补上：1440×902 下浅深两版都量过了——见下面「真机复验（P536Q）」那一节，
  26/26 里含 `data-skin-art` 在两版之间来回换、正文底色两版各自 52%；**1080 与更窄那一档还没量**。）
- 两条 CC BY-NC-SA 上游（鲸鱼娘 / 鲸鱼女孩）继续不进表；素材来源走「自绘 + 用户自有图」，
  这条裁定是 5-㊷ 收到的，理由不再是「要商用」。

## 批次 5-㊷（波3）· 广场页体验：整窗预览与两套并排对比（2026-10-08）

【用户点的另半句】「广场页体验：整窗预览 + 并排对比」。这一条与波1 的「画」是一件事的两半：
波1 让皮肤真的带上一整窗的画，波3 才让用户**看得出**带上之后是什么样子——
卡片那一枚小预览摆不下整窗，而「换上试试再换回来」是要落盘的。

### 一、三个架构落点，每一个都排除了一个更自然的写法

1. **预览不落盘**。`appearance.update` 在整页里只出现一次，落点是 `applySkin()`。
   预览只往 `<html>` 刷，退出即原样——它是「还没保存」，收条上就写「还没保存」。
2. **`--skin-*` 只有一个作者**：App.vue 的 `applyTheme()` 读
   `effectiveSettings(settings.value, skinBrowse.previewSkin)`，页面侧不许出现 `setProperty(`，
   也不许自己调 `applyAppearanceThemeToDocument`。
   排除的写法是「预览条自己刷一次 DOM」：那样就有两个作者写同一批变量，
   用户一改字号或切一次深浅，App.vue 立刻把预览刷掉——预览里的画面自己变回去了，
   而屏幕上没有一句解释。
3. **换上与预览共用同一份拼法**：`composables/appearanceSkinPreview.ts` 的 `patchSettingsWithSkin()`。
   两处各拼一遍的漂移后果不是「显示不一致」，是**预览看到的和点「就用它」得到的不是同一套**。
   本批把那条旧守卫（「换皮肤一次写回三样」）跟着搬到了这份函数上，并加了反向钉：
   页面里再出现 `preset: skin.id,` / `...skin.light,` 就是第二份拼法，红。

### 二、Esc 这条链多了一层，而且照旧要问「有没有落点」

- `close-skin-overlay` 排在 `close-overlay`（设置浮层）**之前**：皮肤广场占的是中栏那一格，
  不是设置浮层；整窗预览开着时按 Esc 的意图是「先退我刚打开的那一层」，
  顺序反过来会一次关掉用户正在挑东西的那一页。
- 落点判据仍在装配层：`skinOverlayIsOpen: skins.overlayIsOpen && handlers.skinGalleryHasLanding()`，
  `skinGalleryIsMounted` 镜像 `centerView === "skins"` 那个 `v-else-if`。
  这条与 5-㊴ 的 Ctrl+F、#106 的引用菜单同一条规矩——没有落点的标记会白吃一次 Esc。
- 顺手抓到一处**摘要与实现分家**：`ESCAPE_POLICY_SUMMARY`（帮助面板上那行）还停在六步，
  而实现早在 5-㊴ 就有「收查找替换」、本批又加了「收皮肤浮层」。
  屏幕上教的收层顺序比实际少两层，用户按第一下发现关的是别的东西。
  守卫从「两处字符串相同」升级成「**摘要层数 == `EscapeAction` 并集的支数**」，
  以后再加一层而忘了改摘要会直接红。

### 三、整窗模型：五层顺序照搬 `.desktop-shell`，只消费真 token

`.skin-window` 的子层顺序是 backdrop → art → grid → nav → main → side，与真窗一致（画在 backdrop 之上，
否则 CSS 弥散光把画压掉）。每层写的都是运行时那批 `--skin-*` 同名变量；带画时正文区放行 52%，
与 `theme-runtime.css` 那条真规则同值同判据——**观感里没有一处是自创的**。
`--window-paper` / `--window-ink` 由 `previewTone()` 逐张卡 `:style` 现场给：
并排两扇窗不可能各有一份 `<html>`；这里**没有覆写 `--surface-main`**，
覆写一个全局 token 会让这一格里别的消费（图标、边框）跟着串味，而那不在皮肤的作用范围里。

### 守卫（能真跑的一半 + 读源码的一半）

| 文件 | 条数 | 钉的是 |
| --- | --- | --- |
| `composables/appearance-skin-preview.test.ts`（新） | 7 | 浅深两套同时换、三色各取各自那一版、五层两套同值、mode/两枚字体（顶层）/字号/侧栏保住、不改入参、`effectiveSettings(settings, null)` 用 `toBe` 同对象、预览结果与 `patchSettingsWithSkin` 逐字段等值 |
| `stores/useSkinBrowse.test.ts`（新） | 11 | 预览三态、残留 id 不兜底成某一套、FIFO 上限两套、已勾再点=移出、`compareSkins` 丢 ghost、closeTopLayer 先退预览后收对比、`leaveGallery` 全清、筛选与浮层互不干扰 |
| `utils/escape-policy.test.ts` | 21（+6） | 新那一支的优先序：预览+回合→收预览；预览+设置→先收预览；待审卡仍最前；菜单更内先收菜单；标记为假时旧裁决一字不变 |
| `composables/appearance-skin-plaza-wiring.test.ts` | 34 | 页面接线：共用拼法、预览不落盘、收条两个出口、离页清浮层、判定在 store 不在模板、整窗五层类名与 DOM 顺序、每层 token 同名、52% 与真规则同值、单作者 |
| `composables/hotkey-landing-wiring.test.ts` | 11 | 落点：`skinGalleryHasLanding` 是必填回调（不许可选）、case 里只 preventDefault + `closeTopLayer()`、落点镜像 `v-else-if="centerView === 'skins'"` |
| `utils/hotkey-guide.test.ts` | 3 | 摘要与注释逐字同源 + 层数与并集支数对账 |
| `composables/theme-token-guard.test.ts` | 5 | `--window-paper`/`--window-ink` 进「JS 内联注入」白名单，理由写明出处由 wiring 那半钉 |

### 变异（本批 13 发，全部先红、全部回退）

| # | 落法 | 红的守卫 |
| --- | --- | --- |
| M1 | escape-policy 里两支顺序交换 | `escape-policy.test.ts` × 1 |
| M2 | 去掉 `&& handlers.skinGalleryHasLanding()` 那道门 | `hotkey-landing-wiring.test.ts` × 1 |
| M3 | 拼法里深色那版误读 `skin.light` | `appearance-skin-preview.test.ts` × 1 |
| M4 | 整窗 grid 层删掉 `background-image` | `appearance-skin-plaza-wiring.test.ts` × 1 |
| M5 | `.skin-window` 里 art 与 backdrop 两层 DOM 顺序互换 | 同上 × 1 |
| M6 | 对比上限 `slice(-2)` 改成 `slice(-3)` | `useSkinBrowse.test.ts` × 1 |
| M7 | App.vue 里 `const view = settings.value`（预览不生效） | `appearance-skin-plaza-wiring.test.ts` × 1 |
| M8 | 放行比例 52% 改成 70% | 同上 × 1 |
| M9 | 「勾满两套才算开着」`>= 2` 改成 `>= 1` | `useSkinBrowse.test.ts` × 2 |
| M10 | escape-policy 头注那句顺序打乱 | `hotkey-guide.test.ts` × 1 |
| M11 | 并集里删掉一枚 `"close-skin-overlay"` | 同上 × 1（数出 7 支） |
| M12 | token 守卫白名单删掉 `--window-ink` | `theme-token-guard.test.ts` × 1（报成孤儿） |
| M13 | `previewTone()` 删掉 `"--window-paper"` 那一行 | wiring × 1；**token 守卫此时仍绿**——白名单不是这条的真身，跨文件那条才是 |

### 本轮自己的五个错

1. 两张新测试文件把「取不到」写成了 `?? appearanceSkins[0]` 兜底。类型关卡
   （`noUncheckedIndexedAccess`）先红了，而它红得对：那种兜底会把「锚点皮肤被改名或下架」
   伪装成「测的是另一套」，用例安静地绿着。改成显式查找 + 取不到就抛错。
2. `uiFontFamily` / `editorFontFamily` 在 contracts 里是**顶层**字段，不是 per-scheme。
   第一版断言写在 `light`/`dark` 上，得到的是 `undefined === undefined` 的假绿形状；
   改到顶层并把字面值钉死（"hei" / "kai"），注释里写清这条最可能的假绿形状。
3. 波1 那次提交（2d6c005）只跑了五项门禁，**没跑 `format:check`**——
   本轮 prettier 报的两个文件（`appearance-skin-visual.test.ts` 缺行尾换行、
   `theme-runtime.css` 那条长 `background-image`）经查 `git log -1` 就是本批自己的，
   不是另一条线留下的。教训：六项一项都不能省。
4. `ESCAPE_POLICY_SUMMARY` 从 5-㊴ 起就与实现分家（见上文第二节）。这不是本批写的错，
   是本批**抓到**的一处既有账，记在这里是因为它原本可以一直绿着。
5. M10 那一发的落法我用了 `sed -i`，违反本批口径（变异只用 Edit）。
   回退做了 `diff` 逐字节核对（RESTORED_IDENTICAL），结果不受影响，流程违规记档。

### 门禁数字

`TYPECHECK_EXIT=0`、`ESLINT_EXIT=0`、`BOUNDARY_EXIT=0`、`BUDGET_EXIT=0`、`PRETTIER_EXIT=0`、
`VITEST_FULL_EXIT=0`：**210 文件 / 2937 用例全过**（`--maxWorkers=4`；逐段落盘取码，
日志 grep 无 `FAIL` / `AssertionError` / `error TS` / `ELIFECYCLE`）。
本批定向那七个文件 92 用例全过。中途读到过两次红并都修掉了：
`TYPECHECK_EXIT=2`（两个新文件的 `| undefined`）与 `PRETTIER_EXIT=1` + 全量两项失败
（`--window-*` 孤儿、摘要镜像过时）。

### 改动文件清单（波3）

- `composables/appearanceSkinPreview.ts`（新：`patchSettingsWithSkin` / `effectiveSettings`）
- `composables/appearance-skin-preview.test.ts`（新）、`stores/useSkinBrowse.test.ts`（新）
- `stores/useSkinBrowse.ts`（预览与对比两半：`previewId` / `compareIds` / `overlayIsOpen` / `closeTopLayer` / `leaveGallery`）
- `components/SkinGalleryPage.vue`（整窗预览条、并排对比栏、`.skin-window` 五层、`previewTone()` 四键）
- `styles/skin-gallery.css`（预览条 / 对比栏 / 整窗模型那一族规则，两处选择器组改 `:where()`）
- `App.vue`（单作者：`effectiveSettings` + `previewId` 的 watch + `skinGalleryIsMounted`）
- `utils/escape-policy.ts` 与其 `.test.ts`（`close-skin-overlay` 一支、头注那句改成八步全序）
- `utils/hotkey-guide.ts` 与其 `.test.ts`、`composables/useHotkeys.ts`
- `composables/appearance-skin-plaza-wiring.test.ts`、`composables/hotkey-landing-wiring.test.ts`、
  `composables/theme-token-guard.test.ts`

### 真机复验（P536Q：26/26 + 11/11）

起自实例（CDP 9234、临时 profile、`pnpm build` 之后），跑 `.superpowers/sdd/tmp-w3-skins.mjs`：
**26 条全过**。关键读数——

- `预览确实刷到整窗：data-skin-art 换成那一套的画 :: {"got":"abyss-hall-night","want":"abyss-hall-night"}`
- `预览只改 <html>，盘上一个字节没动 :: {"bytes":787}` —— 读的是 `%APPDATA%/mochen-ai/appearance.json`
  那份**真身**（主进程认 `activeDir`，`--user-data-dir` 改不了它；临时目录里根本没有这个文件，
  第一版取证取错了地方）
- `整窗模型层序 = backdrop/art/grid/nav/main/side`、`两扇窗各自一份纸色 :: ["#E8F6FA","#0B1A26"]`、
  `两扇窗的正文底真的不同 :: [... / 0.52 与 ... / 0.52]`、`落的就是预览中看到的那一套 :: xi-night`、
  `收场：设置还原成开工前那一份`

第一轮 26 条里点击全部无效，原因在屏幕上而不在代码里：**新 profile 会弹 `OnboardingGuide`
整片模态盖住广场**，`elementFromPoint` 命中的是 `P.ob-tip`，CDP 一声不响。加了
`showOnboarding = false` + 每次点击前 `scrollIntoView` 与命中校验才通。
同一轮还预览了**当前在用的那套**（xi-day），`data-skin-art` 前后同值、屏幕上什么都没换；
改成挑另一套（xi-night）才是有效对照——这条判据后来写进了探针（`预览的那套与当前在用的不是同一套`）。
唯一的 FAIL 是探针自己的 bug：`artComputed` 只截 40 字符，`includes("url")` 永远不成立。

### 真机量出来的 P1：整窗预览在「预览皮肤的那一页」上把画盖死了

顺手量的那件事（`tmp-w3-coverage.mjs`）：站在广场页做整窗预览时 `.skin-gallery` 的计算底色是
`rgb(232, 246, 250)`、alpha **1**、`background-image: none`，而它占 1154×902、shell 只有 1440×902
⇒ 那一整幅画只剩左栏（alpha 0.3）与一条约 286px 的边能露出来。**「整窗预览」名不副实**，
而盖住画的正是预览皮肤的那一页自己——与波1 修掉的「画了等于没画」同一族，换了个地方复发。

并行撒网后同一族的还有两张同构整页：`.extensions-page`（extensions.css:39）、
`.settings-page`（settings-page.css:28），各自写着 `background: var(--surface-main)`，
都是 `grid-column: 2 / -1; grid-row: 1`。判据：`.settings-sidebar`（一根窄列）与
`.workspace-dialog`（模态框）**故意不放**——表单与按钮的可读性优先于「画露多少」。

修法是把三张页并进 theme-runtime.css 那条已有的「带画才放行」名单：同一个 52%、同一个 token，
不留第二套规矩。可读性不比正文那一档差——页面放行 52% 之后卡面还压着 `--surface-raised` 40%，
合成实底 0.4 + 0.6×0.52 ≈ **71%**，比正文单独那 52% 更厚。

守卫与变异（`appearance-skin-plaza-wiring.test.ts`）：新增 `releasedSelectors()`，按
「选择器含 `data-skin-art` 且正文含那枚 52% 的 `color-mix`」把**整组**捞出来（找不到就抛错，
不返回空串——空串会让组内每条 `toContain` 一起变绿），字面量收成一份 `RELEASE_BODY`
（原来那条「模型与真规则同值」的用例也改读它，两处不再各写一句）。
先红后绿：断言写好跑一次 → `1 failed | 34 passed`，失败消息里回显的组正是那四条老选择器。
变异三连（只用 Edit）：**M-a** 删 `.skin-gallery` → 红在该页；**M-b** 只删规则里的
`.settings-page`、**注释里那句留着** → 仍红，证明注释喂不饱断言；**M-c** 往组里加
`.document-editor` → 红在反向那条。恢复后定向 6 文件 / 146 用例全过。

A/B 在同一个实例上做（`tmp-w3-coverage2.mjs`，**11/11**）：用内联
`style.setProperty(..., "important")` 把旧行为钉回去＝放行前那一档 `rgb(11, 26, 38)` alpha 1，
`removeProperty` 撤掉＝`color(srgb ... / 0.52)`，同一套皮肤（abyss-hall-night）、同一视口、
同一 DOM。两张截图 `w3-page-opaque.jpg` / `w3-page-released.jpg`：后者整幅海底藏书阁
（水母、右侧执笔的鲸耳娘）读得出来，卡片与说明文字仍清楚。
这一轮又栽在谓词上：`rgb(11, 26, 38)` 被「逗号 + 数字 + 右括号」的 alpha 兜底读成 **38**，
于是"实底应为 1"当场红——红的是探针不是代码；改成按写法分支解析后 11/11。

### 第二轮：浅色那套（不预览）、扩展页与设置页、窄窗两档（19/19）

上面「还没做完的」里那条「只量了深海夜阁」现在收掉了（`tmp-w3-pages.mjs`，**19 条全过**，
在重新 build 之后的包上复跑过一遍）。这一轮**不预览**——站在当前在用的「汐·昼阁」
（`shallow-hall-day`）上看三张页放行没有：

- 三张页同一档：`.skin-gallery` / `.extensions-page` / `.settings-page` 全是
  `color(srgb 0.909804 0.964706 0.980392 / 0.52)`、alpha **0.52**，各占 1154×902 从 x=286 起；
- 广场那段说明**自己没有底色**（`rgba(0, 0, 0, 0)`，1114×67）——它直接坐在放行后的面板上，与正文同一档；
- 卡面仍是 40% 玻璃，合成实底 **0.712**，比正文单独那 52% 厚 ⇒ 放行没把字底下的垫色改薄；
- 设置侧栏**不在放行名单里**，实测 `rgba(225, 239, 244, 0.84)`（256×902）。它的底色出自
  `--sidebar` token 自己，不是那条规则的产物——判据写成「这层色是哪一位作者写的」
  （`/^rgba?\(/` 与 `/^color\(srgb/` 分支），而不是钉一个 alpha 快照：
  上一版我按「侧栏应保持实底」的假设写断言，被真机推翻过一次。
- 窄窗两档（`Emulation.setDeviceMetricsOverride`）：1080 与 1000 下广场页仍是 0.52、
  画仍挂在整窗、`scrollWidth` 不超过视口（面板宽 794 / 714）。
- **900 那档"横向溢出"不是这次的缺陷**：本仓地板写在 `styles.css:108`
  `body { min-width: 1000px }`，而 `html, body, #app` 是 `overflow: hidden`（`styles.css:104`）
  ⇒ 1000 以下那 100px 是**被裁掉、不可滚**；主进程建窗 1440×900 且**没设 minWidth**
  （`main/index.ts:119-121`），所以窗口能拖到地板以下。这是本仓既有的取舍，
  本轮只把它量成一条读数（`bodyMinW === "1000px"`），没有顺手改。

### 放行之后字还读不读得清：量出来是次要文字的系数本来就浅（0.67 → 0.71）

先看屏幕会自欺——1000 宽那张截图里右边那张卡的说明压在画的暗区上，「看着有点吃紧」不能当判据。
所以量（`tmp-w3-contrast.mjs`）：把要量的那处文字设成 `color: transparent` +
`-webkit-text-fill-color: transparent`（**字没了、底还在**），在字原本所在的方块中心取
**6×6 无损 PNG** 采样（80 质量 JPEG 会把这一小块搅掉），得到真正垫在字底下的颜色，
再拿它自己的文字色算 WCAG 对比度；放行 / 内联钉回实底两态在同一个实例上做 A/B。

旧系数（0.67）下的第一轮读数：

| 量的是哪处 | 放行后 | 放行前（实底那档） | 判 |
| --- | --- | --- | --- |
| 卡标题 `.skin-card-title strong` | 11.18 | 11.47 | 过 |
| 卡说明 `.skin-card-desc` | **4.18** | **4.33** | 两档都不到 AA 4.5 |
| 广场说明段 `.skin-gallery-note` | 4.55 | 4.54 | 压线过 |

**放行不是病因**：卡说明的掉幅只有 3.5%，放行前那一档自己就不到 4.5。
按同一份 `mixChannels` 静态扫 12 组浅色（10 套出厂底版 + 广场两套），对卡面不到 4.5 的有三组
（汐·昼阁 4.33、海雾 4.47、墨宸·青金 4.42）——病在 `--text-secondary` 那个**混色系数**上：
它此前写死在 `setProperty` 那一行里（`scheme === "dark" ? 0.72 : 0.67`），谁都量不到它。

处置三件，没有一件靠「调松判据」过关心：

1. 系数与卡面阶梯提成两份常量 `SECONDARY_TEXT_MIX` / `SURFACE_CARD_MIX`（**一份真相**，
   守卫按同一份算），浅色 **0.67 → 0.71**；深色 0.72 **不动**——12 组深色对卡面最低 6.36，
   本来就过线，为「两边对称」去改一个没坏的数是把守卫当装饰。
2. **留量按真机给，不按静态给**：0.71 静态对卡面最低 4.88，而真机采样比静态低 0.15～0.17
   （画层 + 那层纱把垫底压暗），所以刚好 4.5 的静态值一上屏幕就破线。
3. `appearanceColor.ts` 补 `rgbToHex` / `mixHex`：`mix()` 产的是给 CSS 的 `rgb()` 形状，
   而 `contrastRatio` 吃 hex；转换留在颜色模块，比让每条守卫各自拼一遍 `toString(16)` 好。

守卫两条（`appearance-skins.test.ts`：广场每条 / 出厂每套各一条，合写会让一边塌成零条照样全绿），
次要文字对**页底与卡面两个面**都 ≥ 4.5。变异（只用 Edit）把系数改回 0.67 → `MUT_A_EXIT=1`，
红消息正是 `汐 · 昼阁 · light：次要文字 #59737f / 卡面 #e2f1f5 只有 4.33:1` 与
`海雾 · light 的次要文字压卡面不够: expected 4.47…`——断言能失败，且红在被改的那一档。

复量（真机 **7/7**）：卡说明 **4.18 → 4.71**、广场说明段 4.55 → **5.11**、卡标题 11.18 不变；
屏幕上 `--text-secondary` 读到 `rgb(80 107 120)`（旧值 `rgb(89 115 127)`）。

**修完之后仍没覆盖的两处**，写清楚，别让它冒充「全站可读性都过线」：
① `--text-tertiary`（浅 0.5）静态对页底最低 **2.87**、对卡面最低 2.74——它消费的是卡脚那几个
元信息小字，要不要按正文定线是设计判断，另开一条；
② 次要文字压在 `--surface-hover` / `--surface-selected` 上，0.71 仍只有 **4.38 / 4.09**——
病因在表面阶梯一层比一层深，要修得动阶梯或让 hover 换字色，那是全站列表的事。

**顺手记下的一条通路事实（差点拿旧包读出新结论）**：这个 CDP 实例加载的是
`apps/desktop/out/renderer/index.html`（**构建产物**，不是 vite dev）。改了
`appearanceThemeRuntime.ts` 之后第一次复量仍读到旧色，而探针那句「已经不是旧系数那一档」
当时**假绿**了——因为本窗 computed 出来的自定义属性是空格分隔（`rgb(89 115 127)`），
我拿带逗号的串去比。两处一起修：判据先归一化再比，且**改源码必须 `pnpm build` + 重启实例**才量得到。

### 门禁（补漏这一轮）

`TYPECHECK_EXIT=0`、`ESLINT_EXIT=0`、`FORMAT_EXIT=0`（`prettier . --check` 全仓）、
定向 6 文件 / 146 用例全过；全量 `TEST_EXIT=0`：**210 文件 / 2938 用例**（比上一轮多出的那 1 条
正是这条新断言），日志 grep 无 `FAIL` / `AssertionError` / `ELIFECYCLE` / `Unhandled`。
中途读到三处红并都修掉：`TS18048 'body' is possibly 'undefined'`（正则捕获组在
`noUncheckedIndexedAccess` 下的老账）、`PRETTIER_EXIT=1`（我新写的那段没折行）、
以及一条 **ESLINT_EXIT=1 落在 git-ignored 的探针里**——`.superpowers/sdd/*.mjs` 也在
`eslint .` 的范围内，探针里一个没用上的变量就足以让门禁红。
另有一次「后台通知报 exit 0 而日志里 `TEST_EXIT=1`」：`pnpm test` 的脚本已经带
`--maxWorkers=4`，我再传一遍 → vitest 报 `Expected a single value for option "--maxWorkers"`。
判绿仍然只认日志内容，不认通知。

第二轮（浅色 + 窄窗 + 对比度）的门禁：`TYPECHECK_EXIT=0`、`ESLINT_EXIT=0`、`BOUNDARY_EXIT=0`、
`BUDGET_EXIT=0`（行数预算通过）、`FORMAT_EXIT=0`（全仓 `prettier . --check`）、`TEST_EXIT=0`：
**210 文件 / 2940 用例**（比上一轮多的那 2 条正是次要文字那两条守卫），日志 grep 无
`FAIL` / `AssertionError` / `ELIFECYCLE` / `EPERM` / `EBUSY`。两处红并当场修掉：
`ESLINT_EXIT=1` 落在 git-ignored 的算尺脚本里（一个没用上的 `smallestPass`）、
`PRETTIER_EXIT=1` 在新那条 `mixHex` 的签名折行上。

### 还没做完的

- **挂件层运行时**（波1b）与**新素材进表**（波2）仍卡在 ImageGen 403 配额；
  素材规格单已交付在 `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md`。
- **次要文字的两处后续**（上面那节写明的）：`--text-tertiary` 要不要按正文定线；
  次要文字在 `--surface-hover` / `--surface-selected` 上还差 0.1～0.4，要动的是表面阶梯。
- **窗口能拖到 1000 地板以下**（`main/index.ts` 没设 `minWidth`），地板以下是裁掉而非可滚——
  本仓既有取舍，未在本轮顺手改。
- **提交树单独是否全绿未证**：工作区里另有 5-㊶ 那 185 行未提交改动，本轮门禁是在混合树上跑的。

## 批次 5-㊺：不能切换模型 —— 点名单里任何一行，屏幕上什么都不发生（2026-10-09）

用户报的是「不能切换模型」。同一天他还报了「无法对话」与「点对话框弹出正方形」；
后者逐控件量过没量到（见文末「还没定位的」），前两件在本节与下一节。

### 根因：出站草稿的**形状**错了，而它躲过了三道门

主进程 `provider-settings.ts` 的 `upsertProfile` 收的是 `ProfileDraft`
（zod `profileDraftSchema` = `{ model, connectionId }`），而渲染层
`CenterColumn.chooseModel` 把**裸模型名**当草稿发下去了。真机直打 IPC 的两条结果：

- `profileUpsert("agnes-2.0-flash")` ⇒ `Error: Invalid input`（schema 拒非对象）；
- `profileUpsert({model, connectionId})` ⇒ 走到连接查找那一步才报「没有找到这条连接」。

抛错被 store 的 catch 吞进 `provider.error`，而那个字段**只在模型设置页渲染**，
输入卡那个下拉里一个字都没有 ⇒ chip 不变、浮层不关、屏上零解释。
「添加模型」那条对话框一直是好的（`ModelProfileDialog` 传的就是对象），
所以现象是「能添加、不能切换」——这类半通不通最容易让人以为是自己点错了。

三道门为什么都没拦住：

1. **`.vue` 不进类型程序**：本仓 verify 用裸 tsc（没有 vue-tsc），
   `provider.select(name)` 把 `string` 传给收 `ProfileDraft` 的函数，tsc 全绿。
2. **旧守卫只问方法名**：`model-select-wiring.test.ts` 当时写的是
   `expect(script).toContain("provider.select(")`——方法名在就算过，参数形状一个字没问。
3. **失败理由被吞进一个消费者不同的字段**：`provider.error` 铺给设置页，浮层读不到。

### 改法：线格式下沉到 `.ts`，连接由 store 独占

- 新增 `utils/model-switch.ts`：`modelSwitchDraft(connectionId, model)` 出站草稿，
  并给「拿不到启用中的连接」一句看得见的理由（`SWITCH_NO_ACTIVE_CONNECTION`）。
- `useProviderStore`：新增 `switchModel(name)` 与 `switchError`；
  把「找启用中那条档案」收成一处 `enabledProfile`（原先 `modelLabel` 与
  `activeBaseURL` 各自 find 了一遍），`activeConnectionId` 与它同源派生。
- `CenterColumn.chooseModel` 改走 `provider.switchModel(name)`——组件不再知道
  `ProfileDraft` 长什么样，它知道的只有「用户点了一行」。
- `ModelSelect` 新增 `switchError` prop 并渲染出来：写回失败时**浮层不关**，
  理由摆在你眼前（复用拉名单失败那一档红字，没有另起一套视觉）。

连接取 `activeConnectionId` 不是推断：主进程 `provider-models.ts` 的 ③ 分支写死了
「什么都没给 ⇒ 走启用中那条」，下拉里的名单就是从那儿来的，写回同一条只是复述它的来路。

### 守卫与变异

- `utils/model-switch.test.ts`（8 条）+ `useProviderStore.test.ts` 新增一节（8 条）
  + `model-select-wiring.test.ts` 加固 3 条。
  store 那条形状守卫盯的是 `typeof arg === "object"`——**不认模型名**，
  免得又写成「认得那几个名字才放行」的名单型判据。
- 变异 **11 条全红**（`.mochen-tmp/p537/mutate-model-switch.cjs`，还原一律用变异前存下的字节）：
  回到原 bug（M1）、组件自己拼草稿（M2）、草稿少字段（M3）、空连接照放（M4）、
  连接取错（M5/M6）、失败理由不搬（M7）/不渲染（M8）/不转交（M9）、不复位（M10）、
  失败也关浮层（M11）。

### 真机

重建渲染层（`out/` 里跑的是构建产物，**没有 dev server**，`location.reload()`
带不进源码改动——这一点先量了才敢下结论）后在同一个窗口复验：

- `agnes-2.5-pro` → 点 `agnes-2.0-flash` ⇒ chip 变、浮层收、屏上无理由；
- 再点回 `agnes-2.5-pro` ⇒ 两个方向都通，配置复原。

截图 `.mochen-tmp/p537/shot-p539f-switched.png`、`shot-p539g-switched-to.png`、`shot-current.png`。

### 门禁

`tsc`（contracts / web 两路）0、`eslint apps/desktop/src/renderer --max-warnings=0` 0、
本轮 7 个文件 `prettier --check` 干净、全量 vitest **215 文件 / 3014 用例**通过。

### 探针自己踩的三个坑（都写在这里，因为下一次还会踩）

1. **`contextBridge` 暴露的 `window.mochen` 是冻结代理**：往它上面挂录音函数**静默失败**，
   于是「records 为空」被读成了「产品没调用」。改用产品自己渲染出来的失败理由来观测。
2. **按 `.desktop-shell` 过滤差集**：行内引用菜单挂在输入卡内部、并不 Teleport 到 body，
   按 shell 过滤会让它对差集完全隐形——第一版就这么漏掉了。
3. **按坐标点按钮**：上一枚控件被点之后整行会位移，坐标随即失准；
   这一版误发了一条消息。后面全部改成按**选择器**定位，`elementFromPoint` 命中 `<svg>`
   时还要 `closest("button")`（SVGElement 没有 `click()`）。

## 批次 5-㊻：思考档的线格式 —— 「OpenAI 兼容」不等于字段值也一样（2026-10-09）

### 现象

用户报「模型地址密钥没问题，为什么无法对话」。地址密钥确实没问题：
体检显示「连得上，名单里有 12 个模型」。真机里那条报错把话说得很直白——

```
模型服务端返回 400：***.BadRequestError: OpenAIException -
{"object":"error","message":"Unexpected reasoning effort high.
 Supported types are xhigh (default), medium, and low.","type":"BadRequest"...}
```

**整笔请求被 400 拒掉** ⇒ 用户一个字都发不出去，而地址与密钥全对。
与当初小米 MiMo 只认 `api-key` 头是同一族死法：**「OpenAI 兼容」只保证路径像，不保证字段值一样**。
分歧只发生在最高那一档：Agnes 照收 `low` / `medium`，唯独把最高档叫 `xhigh`。

### 改法：照 `authHeader` 的形状，挂在**连接**上

- `contracts`：新增 `ThinkingWire = "standard" | "xhigh"` 与 `THINKING_WIRE_TOP_VALUE`；
  `providerConnectionSchema.thinkingWire` 带 `.default("standard")`，
  `ProviderConnectionView` / `ConnectionDraft` 同步带上。
- `per-run-fields.thinkingBodyField(level, wire)`：只有 `high` 那一档换名，
  `low` / `medium` / `off` 两家一致，一律不动。
- 对话框加一格下拉（与「密钥放在哪个请求头」并列），模型卡片上非 standard 时标一枚「深度走 xhigh」。

**为什么存在 `contracts` 而不是就地判断**：输入卡那枚 chip 按本仓铁律必须报出
「这一档实际发出去的键值」，而真正拼字节的是 agent-runtime（渲染层不许 import 它）。
两边各写一遍就是同一件事两份实现 ⇒ 判据下沉为 `thinkingWireValueOf(level, wire)`，
**出站字节与 chip 提示读同一份**。真机上 chip 的提示已经如实变成
`深度思考 深度：本轮出站请求带 reasoning_effort=xhigh`。

### 顺带逮到一个潜伏 bug：`authHeader` 一直是死字段

加这一档时发现：`tool-loop` 构造出站请求是**逐字段点名**的
（`baseURL:` / `apiKey:` / `model:` 三个一个一个写），`authHeader` 压根没递下去——
它在 `TurnDeps.provider` 上声明了、在 `StreamRequestLike` 上也声明了，唯独中间那一步漏了。
后果：小米 MiMo 那条连接**永远发 `Authorization: Bearer` 而不是 `api-key`**，
界面全对、请求永远 401，代码上完全看不出原因。

改成 `...deps.provider` 整个铺开：逐字段点名 = 每加一个连接级字段就再犯一次
（`thinkingWire` 差点就是第二个）；铺开 = `ProviderSettings.config()` 上多一个字段，
它自己就到出站了。每轮开关（档位/联网）在下面显式覆盖——它们归这一轮管、不归连接管。

### 守卫与变异

- `per-run-fields.test.ts` 新增一节 7 条；`tool-loop-wire.test.ts` 新增 5 条；
  `thinking-wire-wiring.test.ts` 新增 11 条（`.vue` 不进类型程序，只能读源码钉）。
- 变异 **16 条全红**（`.mochen-tmp/p537/mutate-thinking-wire.cjs`）：映射不认 xhigh（T1）、
  关档也发字段（T2）、连 low/medium 一起换名（T3）、表里两档写成同一个字（T4）、
  tool-loop 回到逐字段点名（T5）、出站不接（T6）、盘上不存（T7）、`config()` 不带（T8）、
  草稿丢掉（T9）、对话框那格没了（T10）、保存不发（T11）、装配处不喂（T12）、
  输入卡不转交（T13）、提示改回拼档位名（T14）、store 取错连接（T15）、卡片标记删掉（T16）。
- **一条自己的守卫写错过**：「xhigh」这个串本身含「high」子串，
  用 `not.toContain("high")` 反钉会自己误伤自己——已改成钉**值**（当场红了一次）。

### 真机

- 重建 + 重启应用后，在对话框里把该连接设成「深度走 xhigh」⇒ 卡片上出现「深度走 xhigh」标记，
  chip 提示如实变成 `reasoning_effort=xhigh`。
- **最后一腿（真端点成功回一句）没验完**：发消息被「尚未打开作品目录」这道门挡住，
  而打开作品要走原生文件夹选择器（本环境驱动不了）。需要用户自己点开一本书再验。

### 门禁

四路 tsc 全 0、`eslint --max-warnings=0` 全 0、prettier 干净、
全量 vitest **217 文件 / 3037 用例**通过。

### 同一天量到的另外两件事（未修）

- **联网开着会把这一轮挂住**：同一端点同一句话，联网关掉几秒就回，开着挂 200 秒零响应零报错。
  隔离实验已做，责任锁定在「联网检索工具执行」那一路（待查）。
- **点输入框时整张卡内侧亮起一圈青色边框**：这不是新弹出来的元素，是 `.composer-input-surface`
  的聚焦态（`theme-runtime.css` 上色、`agent-pane.css:785` 只改阴影）。
  前几版探针按「元素差集」查，全部量不到——现象是**样式变了而不是元素多了**。

## 止血批次 A（2026-10-09 全仓扫描第 1–2 波）：写字的通路不再静默丢稿，崩溃不再无声消失

总单在 `2026-10-09-full-scan-report.md`（8 条 P0 / 11 条 P1 / 14 条假控件 / 14 条 P2）。
这一批只做「会丢用户字」和「会无声死」这两类，其余按波次往后排。

### 根因（四条，都是同一族：失败发生了但没人接）

- **P0-1 写盘不是原子的**：`writeFile` 直接盖在原文件上。写到一半断电或被占用，
  盘上留下半截正文——旧稿没了、新稿也不完整，而改稿历史那份备份写在新内容**之后**，救不回来。
- **P0-2 保存失败不上屏**：`await writeDoc` 外面**没有 try**。主进程 IO 一路上抛时
  `saving` 永久停在 true ⇒ 手动按钮被禁用、自动保存被自己 `if (this.saving) return` 挡死，
  屏上还挂着上一句「已自动保存」。此后用户写的每一个字都只在内存里，且界面无一处告警。
- **P0-3 关标签不看 `dirty`**：`closeTab` 直接 `delete draftsByPath[relPath]`。
  设置页真有「自动保存＝关」这一档，关掉之后点 ×，刚写的几百字当场蒸发，连一句「未保存」都不问。
- **P0-6 退出没有兜底**：`flushAllForQuit()` 这类能力当时并不存在；即便补上了函数，
  主进程也从来没调用过它——窗口一关，内存里那点字随进程一起没了。另一半是
  全仓 `uncaughtException` / `unhandledRejection` **零命中**：`whenReady().then(async …)` 里
  任何一处抛（目录迁移、credential store、插件挂载）都成为没人接的 rejection ⇒
  **窗口永不出现、也永不提示**，用户只会以为「双击没反应」。

### 改法

1. `packages/fs-store` 写盘改 **tmp → rename**（同目录内改名才是原子的），失败时旧稿原样保留，
   改稿历史的备份写在前、正文写在后。
2. `saveActive` 的 `saving` 由 `finally` 收尾；抛错与 `ok:false` 走同一句理由上屏
   （`保存失败：${failureReasonOf(err)}`）；**摆态抽成纯函数** `saveOutcomeOf`（`utils/draft-flush.ts`）：
   `await` 期间又打了字 ⇒ `dirty` 保持 true、指纹一步都不前进（前进就等于承认写成了）。
   catch 那支**不**重排自动保存——持续失败的盘（EBUSY 一直是）会因此变成每两秒一次的写盘风暴
   （这条是我自己先写错、再用一条反向用例抓出来的：静默窗 20 秒内只许发一次写盘）。
3. `closeTab` 先 `flushDocBeforeDrop`：写成了才允许那一格消失，写不成标签原样留着、理由进 `notice`。
   `stale`（外部改过）不再拼成「没能落盘：undefined」，改判 `conflict` 交给人处理。
4. `utils/draft-flush.ts`：`flushAllBeforeQuit` 逐篇落盘，**一篇失败绝不中断其余**
   （为 A 写不下去把 B 也丢掉，等于把兜底做成二次事故），失败的那些点名回报。
5. `main/crash-guard.ts`（新）：两条通道都挂，每条崩一次在 `crash.log` 留一行带栈的痕，
   **只第一次**弹系统对话框，且钩子自己绝不再抛（写日志失败改走通知）。
   默认分支继续跑不退出进程——那时用户正在写的字还在内存里，而原子写已经保证崩不成半截。
6. `main/quit-flush.ts` + `utils/quit-flush-client.ts`（新）+ 两条新 IPC：
   主进程 `before-quit` 拦一次 ⇒ 推 `app:flush-quit-request` ⇒ 渲染层逐篇落盘并回
   `app:flush-quit-done` ⇒ 落成了才 `app.quit()`；落不下去先问人（默认停在「留下」）；
   4 秒等不到回话按原样放行并留痕。三条规矩：只拦一次（`app.quit()` 会重发 before-quit，
   再拦就是 quit 拦 quit＝死循环）、等话必须有尽头、落不下去由人拍板。

### 契约与装配面的连带

- `IPC_CHANNELS` 47 → **49** 条；preload 的 `RendererApi` 点名册 45 → **47** 枚
  （`onQuitFlushRequest` 只能订阅、`quitFlushDone` 只能 invoke）。
- `renderer-api.test.ts` 里那份**硬编码**的四列（条数、通道字面量、实参逐条、点名册）全部同步改过。
  这里记一句教训：动手前我一度认定「全仓没有 IPC 数量硬断言」，回盘读 `renderer-api.test.ts:217`
  才发现 `expect(calls.length).toBe(45)` 与标题里的「45 条」都是钉死的——转述不当证据，盘上才算。
- 七份 `RendererApi` 夹具各补两枚假身（agent/autosave/changes/doc-loading 给无害实现，
  create/BookStore.test/provider 给「一摸就抛」，因为那些用例本不该碰这条通道）。
- store 加一枚 `quitFlushListening`、装配点 `listenQuitFlush()`，由 `App.vue` 的 `onMounted` 调一次
  （接根组件不接中栏：中栏随页面卸载，握手要在应用整个生命期里都在）。

### 守卫与变异

新增用例 36 条：`crash-guard` 5、`quit-flush` 10、`quit-flush-client` 7、`quit-flush-wiring` 2、
`useBookStore.draft-loss` 4（+9 条早先的 P0-2/P0-3/P0-6 落点）、`saveOutcomeOf` 6 在 utils 侧。
每条都先红后绿（模块不存在 / `store.listenQuitFlush is not a function` / `api.quitFlushDone is not a function`）。

变异自跑（只用 Edit/脚本改源码，逐条还原后复跑）：

- crash-guard：只挂一条通道→T1 红；不取消计时器／超时不 quit→T4 红；盲取 `.name/.message`→T3 红；
  每次都弹→T4 红；去掉 `appendLine` 的 try→T5 红；丢栈→T2 红。
- quit-flush：去 `released` 闸→T10 红；去 `waiting` 闸→T3 红；超时不 quit→T4/T9 红；
  不取消计时器→T2 红；去 `!waiting` 回程闸→T9 红；`replyIsSane` 恒真→T8 红；
  「留下」也 released→T5 红；去 `hasWindow` 闸→T7 红；不 `preventDefault`→T1 红。
- quit-flush-client：`quitReplyOf` 丢 `blocked`→T1/T3 红；去掉回程 try→T6 红；
  没开书也跑兜底→T3 红；监听器不答话→T7 红；答话排在兜底之前→T2/T3/T5 红。
- **tsc 抓到、vitest 全绿漏掉的两处**（第 N 次实证「跑测试不等于跑类型」）：
  测试文件 import 少写 `.js`（nodenext 下连带把参数推成隐式 any）；
  `vi.fn(async () => ({ ok: true }))` 把联合类型widened 成 `{ok: boolean}` 而 `FlushAllResult` 不收。

### 真机

**没做**。机上有另一只实例正在跑（`electron.exe` 一组，属并行会话的现场），
这一批改的是主进程、preload 与根组件——必须重新构建并重启才看得见效果，而我没有动那只实例。
所以「点关闭真的拦了一下吗」「崩一次 crash.log 里真有一行吗」这两条目前是**未验**状态，
用例与门禁只证明到装配点存在（`quit-flush-wiring.test.ts` 钉的就是装配本身）。

### 门禁

`pnpm typecheck`（5 路）0／`lint:eslint --max-warnings=0` 0／`lint:boundary` 0／
行数预算 0（useBookStore.ts 797／DocumentPane.vue 799，都在 800 内）／
全量 `pnpm test` **228 文件 / 3140 用例**全绿。
`format:check` 本轮我碰过的 15 个文件逐个 `--check` 干净；仓库级仍有 3 个红文件
（`agent-ipc.test.ts`、`provider-settings.test.ts`、`useProviderStore.test.ts`），
那三个携 `thinkingWire` 的改动属并行会话未提交现场，HEAD 态合规，本批未动、也未代其提交。

## 止血批次 B（2026-10-09 全仓扫描第 1.5 波 · P0-7）：设定搬进书目录，存不下要当场说话

波 3、波 4（P0-4/P0-5 与那 14 行假控件）的逐条处置写在总单
`2026-10-09-full-scan-report.md` 的「四之二·现状总表」「三之二·P0 现状总表」两张表里，
本条只记第 1.5 波——它是这批里唯一需要新铺一层通路的活儿。

### 根因

三本设定各自 `localStorage.getItem("<全局键>")` + 保存时 `catch {}`：

- 键不带书标识 ⇒ A 书的人物卡出现在 B 书里，「今日已写字数」也跟着串；
- 内容只住浏览器存储 ⇒ 清缓存 / 换机 / 重装 = 设定与笔记全丢，而正文安全地在盘上；
- `useNotesStore.ts:8-9` 的注释写着「也可同步存到作品目录的 .mochen-notes/」——**这句话没有对应代码**，
  三个文件里 `window.mochen` 出现次数当时是 0。

### 改法：七层，路径只由主进程拼

1. **契约** `packages/contracts/src/book-data.ts`：白名单三键 `notes | story-bible | writing-goal`，
   读结果分 `invalid-key / no-book / unreadable` 三档、写结果分 `invalid-key / no-book / not-json / write-failed` 四档。
   渲染层**只递键，永远不递路径**。
2. **文件层** `packages/fs-store/src/book-data.ts`：落在书内 `.mochen/data/<key>.json`；
   `isBookDataKey` 用 `hasOwnProperty`（不认原型链上的东西）；读侧只有 ENOENT 才报「这本书还没写过」
   （`json: null`），其余失败报 `unreadable`；写侧拒空串与非 JSON，落盘复用 P0-1 的 `writeFileAtomic`。
3. **主进程** `main/book-service.ts` 的 `readData/writeData`：自己判白名单与当前书，
   `ipcMain.handle` 那两行**刻意不做 cast**（`key: unknown` 进来，判完才用）。
4. **preload** 补 `readBookData` / `writeBookData` 两枚通道。
5. **渲染层通路** `composables/useBookFileData.ts`：`canWrite` 闸（读不懂就绝不开写，以免盖掉原来那份）、
   `epoch` 世代令牌（换书之后旧回包一个字都不许落）、写盘串行链、deep watch + 600ms debounce +
   快照相等跳过、迁移（**只有盘上没有这一类数据时**才读旧全局键，且**写成功之后**才清旧键——
   迁失败就清等于把唯一那份删了）。
6. **注册表** `composables/bookDataRegistry.ts`：断掉 store↔composable 的循环引用；
   `withBookDataFlush` 把 `openBook`/`createBook`/`closeTab`/`flushAllForQuit` 之前先交回上一本，
   一枚失败不拦其余（汇总失败键名报出来）。
7. **三份形状** `utils/note-shape.ts`／`bible-shape.ts`／`goal-shape.ts`：认不得的形状判读不懂并停止写盘，
   只是缺了后加的整格才补默认放行。目标那一本里全是数字，兜 0 的代价最直白——
   面板会显示「今日 12 / 0 字、已达标」，连续达标天数跟着错。

界面侧跟着补的第五块：`NotesPanel`／`StoryBiblePanel`／`WritingGoalPanel`／`WritingGoalSettingsPanel`／
`WordCountPanel` 各有一条 `v-if="<store>.saveError"` 的 `role="status" aria-live="polite"` 提示，
颜色取 `var(--danger)`、字号一律 rem；本地不留第二份「存盘失败」状态。

### 守卫

本波新增用例 **146 条**（每条都先红后绿；数字取自当场 vitest 日志）：
fs-store `book-data.test.ts` 11、main `book-data-service.test.ts` 7、preload `renderer-api.test.ts` 6、
`useBookFileData.test.ts` 18、`bookDataRegistry.test.ts` 7、`note-shape` 10、`bible-shape` 10、`goal-shape` 19、
`useNotesStore.book-data` 9、`useStoryBibleStore.book-data` 8、`useStoryBibleStore.seeds` 9、
`useWritingGoalStore.book-data` 12、`book-data-save-error-wiring` 20（5 块面板 × 4 条）。

`useStoryBibleStore.seeds.test.ts` 整份改写到假盘夹具：它原来钉的是「首次打开不塞示例条目」，
但存储层一换，那八条读的全是已经不存在的 localStorage 键。顺带把两份重复的 story-bible 夹具
（`entryJson`/`writtenEntries` 在两个测试文件里各一份）合进 `stores/book-data-test-harness.ts`——
总单点名的「重复实现」不许在我自己的测试里先长出来。

变异自跑（只用 Edit，逐条还原后复跑）：

- `isDefaultWritingGoalData` 删掉 `dailyWordTarget` 那一格比较 → **2 红**（util 与 store 各 1）；
- `.wc-save-error` 的 `font-size` 从 rem 抄回 `11px` → **1 红**（接线层「字号一律 rem」那条）。

**一处如实标注**：`emptyWritingGoalData` / `isDefaultWritingGoalData` 与 5 块面板的接线用例，
都是**先有实现后补的测试**，不合「每笔生产代码先有一段红测试」的口径；
补偿就是上面两发变异取证 + 接线层那条「模板 v-if / role+aria-live / 恰好一处 class」在实现前跑出的
6 条预期红（`Tests 6 failed | 14 passed (20)`，日志在 `$HOME/dw-gate/`）。

### 收尾补刀（P0-1 的第二刀）：改名被占 ≠ 写失败

收口时全量 `pnpm test` 出过一条红：`packages/fs-store/test/changes.test.ts` 的压测用例
「写盘超过上限 ⇒ 盘上条数收敛到上限」报 `第30次写盘失败：EPERM … rename '…mochen-tmp-c364c6f2' -> '01-开局.md'`。
连跑三次是 红／绿／绿，同一次 263 文件那轮里它还是绿的——**这是本机 Windows 的真实现场，不是代码回归**：
杀软实时扫描或索引器正拿着那个文件时 `rename` 返回 EPERM，几百毫秒后自己就松。

关键是这一档在真机上**不是异常而是常态**，而旧实现把它当成写失败一路报出去：用户看见「保存失败」，
稍后再存一次反而成功。产品里这种假失败比半截正文更难解释。于是给 `writeFileAtomic` 补一层有界重试：

- 只重试**改名这一步**：临时文件已经 fsync 过，内容早在盘上了，撞的只是目录项换不了；
- 只认 `EPERM / EACCES / EBUSY` 这一族码；`ENOSPC / EROFS / ENOENT` 一次就抛——重试一百次盘还是满的，
  多试只会把一次该立刻露出来的失败拖成一串无意义的等待；
- 默认含首次共 4 次、20/40/80ms 递增退避（最坏约 140ms，仍在一次自动保存的容忍范围内）；
  `attempts` 与 `wait` 由第四枚可选参数注入，用例不必真等退避；
- 试到上限仍失败 ⇒ 抛**最近那次原错**，临时文件照旧清掉（改名不换 tmp 名，所以只有一份残渣要清）。

守卫：`atomic-write.test.ts` 新增 3 条（第一次被占第二次成功 ⇒ 写完且无残渣；一直不松 ⇒ 试到 4 次上限后
抛 EPERM、正文仍是旧稿、目录只剩 `01.md`；ENOSPC 只试 1 次）。前两条先跑出预期红
（`Tests 2 failed | 8 passed (10)`，`atomic-red.log`），红的分别是「根本没重试」与 `expected 1 to be 4`——
正是实现要补的那两点。

变异自跑（只用 Edit，逐条还原后复跑）：

- 去掉错误码筛选（任何码都重试）→ **1 红**，红的正是 ENOSPC 那条反向钉；
- `attempt >= attempts` 写成 `attempt > attempts`（上限差一次）→ **1 红**，`expected 5 to be 4`。

顺手量到的稳定性：`changes.test.ts` 单文件连跑 3 次全绿（补刀前是 红／绿／绿）。

### 真机

**没做**。改动跨 contracts / fs-store / 主进程 / preload / 渲染层，要看「换一本书设定跟着换」必须
重新构建并重启实例，而机上那只 `electron.exe` 属并行会话现场，我没有动它。
所以 P0-7 证明到的是**用例与门禁全绿**，不是屏幕上量到的行为。

### 门禁（本波实测，退出码逐条回读，未用管道吞码）

`pnpm typecheck`（6 路，含本波接进来的 `plugin-kernel`）0／`lint:eslint --max-warnings=0` 0／`lint:boundary` 0／
`lint:budget` 0／`pnpm format:check` **0（全仓）**／全量 `pnpm test` **264 文件 / 3513 用例**全绿，
日志 `$HOME/dw-gate/final-*.log`，退出码逐条落在 `$HOME/dw-gate/final-codes.txt`。

两个连带处置要记明白：

- **`plugin-kernel` 接进类型程序了**（总单第六节第 3 条那个口子）。加进根 `package.json` 的 `typecheck`
  与 `verify` 之后单独跑它，当场复现总单说的两条红：`test/app.test.ts:209` TS2352、`:213` TS7006。
  根因不是用例写错，是**类型里少一档**：`readPluginShape` 运行时认三种插件形态（函数 / 类 / `{default: {…}}` 对象），
  而 `PluginModule` 只声明了前两种，于是对象形态那条用例只能 `as PluginModule` 硬铸、而铸本身不成立。
  补上第三档之后把两处硬铸删掉，两条红一起消失（`ctx` 由上下文推出，TS7006 是同一个根因的连带）。
  守卫 `tools/typecheck-coverage.test.mjs`（4 条）把覆盖面本身钉成断言：凡 `packages/*` 下有 `tsconfig.json`
  就必须被两个脚本点名。变异取证：从 `typecheck` 里删掉 `plugin-kernel` 那一项 → **1 红**，
  且红信息里直接列出漏的包名（`expected [ 'plugin-kernel' ] to deeply equal []`）；还原后 4 条全绿。
- 上一批留着不提交的三个 prettier 红文件（`agent-ipc.test.ts`、`provider-settings.test.ts`、
  `useProviderStore.test.ts`）本波做了 `prettier --write`。它们携带的是并行会话 5-㊻ 的 `thinkingWire` 现场，
  这批随本波一起入库——判据是门禁六路 + 全量测试在这棵树上全绿，不是我判定那份工作做完了。

### 还没做完的

- P1 十一条、P2 十四条按总单第八节的第 2、3 波继续（P1-10 热力图星期标签错位排在下一刀最前）。
- 「第 0 步」两条里 CI 仍未接（`plugin-kernel` 那半已接）。
- P0-7 的真机复验、以及 `.mochen/data/` 在既有书上的第一次落盘（升级路径）都还没量过。

## 第 2 波 · P1 第一批（2026-10-09 起，跨到 10-10）：打断真的停得下来、界面上不再有一句谎

这一批做完四条：**P1-1**（上游挂起 + 打断不停）、**P1-2**（联网开关执行侧无闸）、**P1-9**（右栏浏览读盘三道闸）、
**P1-10**（热力图六个星期标签标错）。P1-3 / P1-6 / P1-7+P1-8 由并行的三路一起做，本波的统一门禁留在收尾跑。

### 根因（四条各自独立，但同一个味道：判据说了，代码没做）

- **P1-1**：`provider-fetch.ts` 全文没有一个 timeout——上游 TCP 连上不吐字节时，这一轮**永远显示进行中**；
  工具循环里（`tool-loop.ts`）只把用户的 `signal` 递给流式，循环内不查它，于是"点打断"要等下一轮流式才生效；
  `agent-service.ts` 的 `webSearch` 拿的是裸 `fetch`，没接 signal，模型反复重搜时更停不下来。
  这就是台账 `:6399` 那条挂了很久的「联网开着挂 200 秒零响应零报错」的机制解释。
- **P1-2**：出站清单与派发判据是两份。`wireToolsFor` 按 `webSearchEnabled` 过滤了发给模型的 tools，
  而 `isCallableTool` 静态放行整张花名册——关掉联网后模型只要**自己仿**历史里那条 `web_search` 调一次，照样真出网。
  与已修的 ef46153 同族：声明的边界不是代码里的边界。
- **P1-9**：`browse()` 一句 `void window.mochen.readDoc(relPath).then(...)`。没有 catch（IPC 抛错那一格永久空着且
  一个字不说）、没有世代令牌（两本书同名文稿 `chapters/01.md`，旧书那次慢回包会写进新书缓存）、没有在途标记（连点三次发三次读盘）。
  仓里 `openDocTab` 早就有 `docLoadToken` 这一套，只是这条路没接。
  界面侧更难看：模板里 `browseContents[relPath] ?? "正在读取…"`，读失败之后那一格**永远停在「正在读取…」**——比空白更糟，它在撒谎。
- **P1-10**：面板写死 `weekdayLabels = ["一"…"日"]` 并**按数组下标**贴标签，而数据是「最近 7 天滚动窗口」。
  窗口起点几乎不可能是周一 ⇒ 除今天正好是周日之外，七天里有六天标错。这类错日期比缺功能更伤信任。

### 改法

- **P1-1 三层闸**：① 首字节 30s / 流中空闲 60s 两只看门狗（`HangWatchdog.guard(work, ms, message)`），超时抛
  `UpstreamHangError extends ProviderError`——继承是有意的：`ProviderError` 已经有一条把人话送到界面的通路，
  新造错误类型就得再修一遍装配面；`provider-client.ts` 里补一句 `if (error instanceof ProviderError) throw error;`
  免得看门狗的句子被外层再包一层套娃。② `mergeAbortSignals`（手写监听器，不用 `AbortSignal.any`：那是 Node 20.3+
  才有的静态方法，而这条链最老的运行时是 Electron 打进用户机器的那只；只有一只信号时原样返回，不多包一层）。
  ③ 工具循环每轮开头查 `signal`、每次调用前查 `signal`，打断时未执行的 tool_call 一律补配对回执
  （`SKIPPED_BY_INTERRUPT`），界面不会留一条"永远在转"的调用；已流出的内容保留（`INTERRUPTED_MESSAGE`）。
- **P1-2 判据合并**：`toolsFor(host, webSearchEnabled)` 内部只调一次 `wireToolsFor`，`toolGateOf` 返回
  `{allowed:true} | {allowed:false; kind:"unknown"|"off-this-round"; reason}`，`dispatchToolCall` 用它派发。
  `isCallableTool` **故意不给开关留默认值**——漏传就编译不过，而不是默认放行。
- **P1-9 三道闸 + 一格自己的话**：换书世代号 `bookEpoch` 与中栏 `docLoadToken` 分成两枚（一次开标签不该作废浏览的在途读）；
  在途集合 keyed by relPath、换书时清空；**「在途」标记在知道结果那一刻就摘，不留到 `.finally`**——`.finally` 比 `.catch`
  晚一个微任务，用户看到失败理由后立刻再点会撞进那次还没散的在途，"重试"被自己上一次失败挡掉，正是要治的病，不能靠多等一拍绕。
  失败理由除了上 `notice`，还落进每格自己的 `browseErrors`，三态判据抽成 `utils/browse-body`（读到 / 读不动 / 还在读），
  面板只挂线；失败那一态另有告警色 `.document-preview-empty.is-browse-failed`，不再用占位话术那种 tertiary 灰。
- **P1-10 标签由日期算**：`utils/goal-heat-labels.ts` 放穷举的 `Record<Weekday,string>` 表 + `parseDateKey`
  （正则卡 `YYYY-MM-DD`、范围校验、构造后回读验证），面板按 `day.date` 取值；写死的那张表和自算的 `formatShortDate` 删净。
  顺带修一处不诚实的标题：那本是滚动 7 天，原来写着「本周热力图」（周日一到整片清零的话术不许留着）。

### 守卫与变异

新增/扩充的用例（本波新增条数由 `git diff HEAD` 当场计数，不是记忆）：
`tools.test.ts` +6（含"两枚判据必须同源"）、`tool-loop.test.ts` +5、`provider-client.test.ts` +2、
`provider-fetch.test.ts` +10、`agent-service-web-search-signal.test.ts` 1（新文件）；
`useBookStore.browse.test.ts` 9（新文件）、`browse-body.test.ts` 8（新文件）、`document-pane-browse-body.test.ts` 3（新文件）；
`goal-heat-labels.test.ts` 5、`goal-heat-weekday-wiring.test.ts` 5（两份新文件）。

变异取证（只用 Edit 改源码，跑完即还原）：

- P1-9 ①把 `.then` 里的 `if (epoch !== bookEpoch) return;` 摘掉 ⇒ `两本书同名文稿都在浏览中：旧书那次慢回包不许盖掉新书已经
  落地的正文` 红：`AssertionError: expected 'A 书的正文\n' to be 'B 书的正文\n'`。
  这一条是补出来的：原来那只"换书"用例只证明了「新书没开那一格时不写」——标签检查顺手挡住了它，世代号摘掉它照样绿。
  **只有两本书里同一格都在浏览中，才是 P1-9 的原形**，那只用例才有牙。
- P1-9 ②去掉在途去重 ⇒ `同一格在途时连点浏览，不再为同一篇发第二次读盘` 红：`expected "vi.fn()" to be called 1 times, but got 3 times`。
- P1-9 ③把失败处理函数的两句写入清空 ⇒ 三条一起红（`expected '' to contain '没能读到正文'`、
  `browseErrors` 那条 `the given combination of arguments (undefined and string) is invalid`、换书清理那条）。
- P1-9 ④去掉"关掉那一格"的标签检查 ⇒ `浏览中途关掉那一格：回包落地后不许留下缓存条目` 红。
- P1-9 ⑤把 util 的 `content !== undefined` 换成 `if (content)` ⇒ `空正文（那一篇本来就是空的）不许被当成「还没读回来」` 红。
- P1-10 的鉴别力问题：这台机是 UTC+8，`new Date("2026-10-09")` 与本地日期恰好一致，"UTC 漂移"那条断言**根本红不了**。
  改成立即切 `process.env.TZ` 到 `America/New_York` 再断言，变异（改成按 UTC 构造）当场出 `expected '四' to be '五'`。

### 真机

**没做**。P1-9 / P1-10 都改在渲染层，"换书后旧回包不落新书缓存""失败那一格出告警色""热力格星期对得上日子"
这三条要重新构建并起实例才看得见，而机上那只 `electron.exe` 属并行会话现场，我没有动它。
P1-1/P1-2 的看门狗与联网拒执也只证明到用例：真端点挂 200 秒那种现象要真网络才量得到。

### 门禁

本批改动落地时跑的定向证据：渲染层全量 `vitest run apps/desktop/src/renderer` **182 文件 / 2389 用例**全绿
（`$HOME/dw-gate/p1-9-renderer.log`）；agent-runtime 那一簇（P1-1/P1-2）当时 53 文件 / 714 用例全绿。
六路 typecheck + eslint + boundary + budget + format + 全量 `pnpm test` 留到第 2 波收尾统一跑，实测数字写在本波收尾条目里。

## 第 2 波 · 收尾（2026-10-10）：P1 余下条目 + P2 十四条逐条对盘回读，全仓门禁第一次真跑通

上一条把全量门禁的数字许给了这一条，所以这一条的第一职责是**把那个数字落成实测**，
第二职责是把 P2 那十四条一次核干净——总单写的是「问题」，不是「现状」，隔了两天、跨了三段并行工作，
现状必须重新读盘才敢写。逐条判据与落点在总单新增的两节里（`2026-10-09-full-scan-report.md`
第四节「四之三 P1 现状总表」已补完 + 第五节之二「P2 现状总表」），本节只记这一批做了什么、量到什么、还欠什么。

### 并行现场与「谁改的」这条账怎么记

三段并行（A：运行时/agent 侧 P1-3/P1-6/P2-5~P2-8；B：渲染层 P2-13/P2-14；C：fs-store P2-2/P2-3）
加我自己手上的 P2-9/P2-10/P2-12。B 与 C 各自把报告落在
`docs/superpowers/plans/notes/2026-10-10-wave-{b-renderer,c-fsstore}.md`，**A 段没有报告**——
它在 150 轮上限处被切断，最后一句停在"正在给 P2-5 做变异"。所以 A 段留下的东西我按
"报告说的不算，盘上有的才算"重核了一遍：`history-window.ts`、`tool-loop` 的接线、
`provider-client` 的截断人话、`foldOrphanUserMessages`、按线程键的轮次闸门，逐项 grep 到行号、
并单独跑过它们的用例（agent-runtime 全套 15 文件 / 215 条，turn-gate 9 条，history-window 三处 44 条）。
**结论是 A 段的代码是完整的、只是没写报告**，但它的变异取证没有落盘，
所以 P2-5/P2-6/P2-7 这几行在现状表里给的是"用例钉住了什么"，不是"变异杀过什么"。

### 三段并行的报告我都读盘复核过，其中 C 段纠了总单一处过期判断

C 段先读盘发现 **P2-2 的 realpath 那半边前几波已经落地**（`paths.ts:56` `isPathUnderRoot`，
`readDocFile`/`writeDocFile` 都已过闸），于是没有重复改，只补了缺的 Windows 保留名——
这条纠偏我复核过行号是真的，总单 P2-2 那一行原文的判断已经过期，现状表里照实写了。
它更值钱的一笔是**实测推翻了总单的推测**：原以为保留名会由平台报错所以"失败自然可见"，
本机 win32 + Node 24 写 `CON.txt` **不抛错、静默落盘**，所以只能在命名层当场拒。
它留下的 8 条残留（`createDocFile`/`scanBook`/`skills.ts` 的闸缺口、导出名撞保留名要裁"改名 vs 拒绝"、
`ipc-guard.ts:42` 是全仓第二处 `realpath`）都在未点名文件里、只记不改，
**这几条需要下一步决定**，其中「第二处 realpath」与铁律 6 有张力，属于要拍板的设计问题而不是 bug。
B 段的三处变异都有红字原文，`v-if="findVisible"`(L713)、`watch(findVisible,…)`(L284)、
`openDocTab` 里的 `cancelAutoSave()`(L319) 全部 grep 到行号确认在场。

### 我自己那三条

- **P2-9（窗口地板）**：`minWidth: 1000` / `minHeight: 700` 是**算出来的**不是抄来的——三栏窄档
  262+395+320=977、纵向 `min(360px, …)` 那格要 680。`window-min-size.test.ts` 5 条读的是样式与
  布局 store 的真身，`pxToken()` 在令牌从 CSS 里消失时**抛错**而不是放行：布局改了而地板没跟着改，
  这条闸要说话。
- **P2-10（四条门禁盲区）**：扩行预算闸到 `.mjs`+`tools/`+`scripts/` 之后当场爆出一份 851 行的
  `gen-scene-svgs.mjs`。**没有为了过闸把闸改窄**，而是把 199 行调色板搬成 `scene-palettes.mjs`，
  验收口径是六张场景画**逐字节复现**（`sha256sum` 搬前、搬后、prettier 后各核一次）。
  边界闸补了渲染层→主进程、渲染层→包源码、Node 侧伸进渲染层三条路 + "两个根都不在就叫空扫、空扫不叫通过"。
  `.prettierignore` 整目录排除 `docs/superpowers` 这条我**没有偷偷留着，也没有为好看去重排台账**：
  实测要改 20 个文件、−34575/+38530 行，所以改成挂着牌子的声明式豁免，由 `prettier-scope.test.mjs` 钉住
  「只许这一条豁免、旁边必须有中文理由、README 与真源码不许被排除」。
  桌面包那条 `test` 脚本实测比总单说的更糟：从该目录跑**一条用例都不收集**（"No test files found"、exit 1），
  修成 `vitest run --root ../.. …src/main …src/renderer`，`tools/ci-gate.test.mjs` 新增一条钉住「跑的是整包不是半套」。
- **P2-12（插件挂载）**：cache-buster 从 `Date.now()` 改成改写后内容的 sha256 前缀 + 只在内容真变时重写产物。
  三条用例按**行为**判（副作用计数器住在夹具插件源码里），三次变异各自杀掉，红字照日志原文抄：
  ① cache-buster 换成常量 ⇒ `改了插件却拿回旧的那份，等于界面永远看不见用户的改动: expected 1 to be 2`；
  ② 重写闸只判文件在不在、不判哈希 ⇒ `expected '甲' to be '乙'`（拿回的是旧那份模块）；
  ③ 恢复无条件重写 ⇒ `内容未变仍重写了产物文件: expected … to contain '记号'`。
  夹具自己也回炉过一次：第一版漏建插件目录，三条全红在 `ENOENT … counter-plugin\client.js` 上——
  那是夹具的错不是被测代码的错，**红错了原因就等于没红**。

### 全仓门禁第一次真跑通：它当场抓出三条并行遗留，这三条正是 P2-10 那节盲区的现场证据

**跑之前先纠一处判断**：这台机上有 5 只 `electron.exe`（并行会话的 dev 现场），
按本机既有教训，全量 vitest 在 dev 在跑时容易只报 timeout 且每次红在不同文件。所以门禁**分段跑**，
每段退出码落变量、日志落盘后再回读内容（`| tail` 那种把码吞掉的写法一次都没用）。实测：

| 段 | 命令 | 退出码 | 日志内容（回读，不是信退出码） |
| --- | --- | --- | --- |
| 格式 | `prettier . --check` | **1 → 0** | 第一次红在 **19 个文件**（并行现场没格式化过），`--write` 后 `All matched files use Prettier code style!` |
| 类型 | 6× `tsc --noEmit` | **0** | contracts / fs-store / agent-runtime / plugin-kernel / tsconfig.node / tsconfig.web 各 0，日志里 0 个 `error TS` |
| 静态 | `eslint . --max-warnings=0` | **1 → 0** | 两条真错：`agent-service-history-window.test.ts:129` `prefer-const`、`path-boundary.test.ts:323` **ESM 里用了 `require()`** |
| 边界 | `node tools/check-package-boundary.mjs` | **0** | `边界检查通过` |
| 行数 | `node tools/check-source-line-budget.mjs` | **0** | `行数预算通过（601 份，含 .mjs/.cjs）` |
| 测试 | `vitest run --maxWorkers=4` | **0** | **298 文件全绿 / 3912 passed、2 skipped (3914)**，31.11s，日志内 0 条 `FAIL`/`AssertionError`/`Unhandled` |

**这三条红是并行的证据而不是我的**：它们全都在我没点名的文件里，而且**只有全仓门禁能看见**——
A 段 `turn-gate` 那份 `let root = ""` 只赋值不读取（`tsc` 的 TS6133 直接挡下提交），
`require()` 那条 ESLint 规则此前从没扫到过那个新测试文件。这正是总单 P2-10 说的门禁盲区落在真实场景里的样子：
**并行 agent 各自跑定向门禁，谁都没跑过全仓那一道**，于是三份"我这边绿"叠起来是一棵红的树。
修法是三条最小改动（删死变量、把 `require` 换成顶部那条 `node:fs` import、`let`→`const` 用 eslint `--fix`），
**没有动任何一段并行的判定逻辑**，改完各自复跑用例仍绿（24 条 + 3 条 plugin-loader + 9 条 turn-gate 回读确认）。

单一事实源数字（本波实测）：**298 个测试文件 / 3912 条用例通过、2 条跳过**。
台账里先前那些 215/3014、217/3037 的口径差异以这一行为准覆盖。

### 还没做完的（照直写，不抹平）

1. **P1-4 / P1-5 一条没动**：1000 章夹具与实测数字。`scan.ts` 的串行全量读、`createDoc` 后整本重扫、
   `findLatestSession`/`listSessions` 整篇读 JSONL 三处都在原地。这是台账第六节那条
   「验收样本是玩具级」的方法性缺口，属于**不写代码也能闭**的那一类，需要一次真规模测量。
2. **P2-11 等一句话**：`pnpm-workspace.yaml:16` 的 `naive-ui` 死条目还在。删它是删除动作，
   本波授权是"除删除之外全开"，所以停在这里。
3. **P2-12 还剩两子项**：`tools/build-brand-icons.ps1` 仍是 Windows PowerShell 专用；
   跟踪文档里那两处绝对路径是"不许拿这个目录之外的真人书稿做测试"的**约束原文**，不是配置项，改它属于换皮，留着。
4. **P1-11 只有一半**：`.vue` 进了语法/绑定关卡（`utils/sfc-compile.ts` 用 `vue/compiler-sfc`，零新依赖），
   **类型检查仍未做**——那要 `vue-tsc`，本仓没装、这台离线机装不上，`vue-shim.d.ts` 把 props 全当 any 照旧。
5. **真机目检一批**：P2-13 的打字延迟、P2-8 的长会话内存、P1-3 的截断提示、P1-9/P1-10 的界面行为，
   全部只证明到用例与门禁。机上那 5 只 `electron.exe` 属并行会话现场，我没有动它。

### 本波入库范围

三段并行 + 我这三条**合并成一整批**入库（提交前全仓门禁如上实测全绿）。
推送只走 `feat/plan3-interaction-and-assembly`，**不碰主干**。

## 第 2 波 · 规模这一刀（2026-10-10）：P1-4 / P1-5 先量后改，数字全部落盘

这一批的起因是总单第六节第 3 条那句「验收样本是玩具级」——两本冒烟书 5 篇与 2 篇，
而产品面向的是 1000–3000 章的作者。所以这一批的顺序刻意反过来：**先造夹具量出放大倍数，
再动代码，改完用同一把尺复量**。三处判断都要求用户当场拍板过（并发度、顺序一致性、touchFiles），
所以下面每条都写清「谁定的」与「量到的」。

### ① 并发度 = 文稿数，不设固定上限（用户裁定，覆盖我原先的限 8）

我先按自己的判断写了限并发 8 的版本并量了一组数，那组数里 pool8 比不设上限快（74–83 vs 85–96 ms），
我据此准备保留上限。**复跑否掉了自己**：本机空负载连跑两遍各 3 次，夹具 1000 章 × 3000 字（盘上 8.66 MB）——

| 读法 | 第一遍 | 第二遍 |
| --- | --- | --- |
| 串行 `for await`（改动前的形状） | 152 / 145 / 157 ms | 133 / 126 / 136 ms |
| 限并发 8 | 35 / 35 / 43 ms | 34 / 29 / 34 ms |
| **并发度 = 文稿数（`Promise.all`）** | 30 / 27 / 21 ms | 21 / 31 / 27 ms |

先前那组「限 8 更快」的读数出在 dev 实例并发抢 IO 的窗口里，重复测量不成立。
按用户裁定落成不设上限，代码里 `mapLimited` 与 `DOC_READ_CONCURRENCY` 一并删净（不留第二套读法）。

内存那一处必须把话改回来，**不能顺着结论写注释**：用户给的判断是「正文读一次算完就丢，驻留峰值只有一个 chunk」，
这句在 `readFile` 下不成立——`readFile` 每个请求按文件大小先分配一块 buffer，1000 个请求在途时它们可以同时在世，
峰值不是一个 chunk。实测峰值堆：串行 29.8–46 MB，不设上限 33–35.5 MB（同量级，差在噪声内）。
所以注释里记的是这三条代价（句柄数=文稿数、buffer 峰值如上有实测、`chars` 要数完整篇所以不能像
`rollout.ts` 那样只读头部），而不是抄一句没量过的话。真要压到一个 chunk 得换流式读，那是另一刀。

### ② 单点重扫与整本扫描的顺序一致性（用户点名要加测试）

`createDoc` 建完一章过去是整本重扫（`scanBook`），实测那一步 99–136 ms；改成 `docRefFor` 只算新那一篇是 **1 ms**。
`docRefFor` 不另立判据：认目录用同一个 `kindOf`，出标题/摘录/字数用同一个 `docMetaOf`，
所以「增量拼出来的 docs 必须与整本重扫逐字相同」是可以直接断言的。`book-service-create-doc-io.test.ts` 八条里
三条就是这条闸（整本 vs 增量 `toEqual`、新那篇与重扫的同一篇 `toEqual`、`sortChapters` 导出核对），
夹具的 `chapterOrder` 故意不是文件名顺序，位置写错当场红。

### ③ `touchFiles`：这个符号在本仓**不存在**，没做假控件

用户说「墨宸有这功能，你去搜 touchFiles 这个符号」。我按点名搜了：
`grep -rn` 大小写不敏感扫 `packages`/`apps`/`docs` 只命中 `changes.ts` 的 `touchedStamps`（无关）；
`git log --all -S touchFiles` 零命中；`git grep touchFiles` 覆盖最近 40 个修订零命中；
`IPC_CHANNELS` 全表里没有 export/touch 相关通道；所有 `mkdir` 调用点逐个看过，没有「建空目录不写」的那条通路；
参考仓 `Desktop\deepwrite` 也搜了，同样没有。
按「逐条答真/半真/不存在、缺契约就写清缺什么、禁止做假控件凑形似」这条规矩，这一项报**不存在**并附上搜索证据，
而不是照着想象补一个 `touchFiles` 出来。如果它指的是别的名字（比如导出打包那条），点名我再做。

### P1-5：会话定位不再整篇读 JSONL（改前实测放大 59×–681×）

`findLatestSession`/`findSessionById`/`listSessions` 三个函数原先都为拿首行（或首条用户输入）把整个 jsonl 读进内存。
新做法是 `readRawLines`：`open` + 16 KB chunk + `TextDecoder("utf-8", {stream:true})`，
拿到就要的那行立刻 `break`，靠生成器的 `finally` 关句柄，尾部不读。
判据只有一份——`titleOfLine` 一行判定同时服务旧的整篇读路径与新的 `readSessionHead`（铁律 6），
空行过滤与「首行坏掉只跳过这一条、不整本抛」都照旧口径复现。

`rollout-head-read.test.ts` 十二条分两族。IO 形状四条用**字节跨度**而不是墙钟（机上跑着实例，时间断言必抖）：
`readFile` 调用数 = 0、每函数各 `open` 一次、150 条事件与 1500 条事件的字节跨度**必须相等**且 < 64 KB
——反向鉴别写得清楚：整篇读时后者要读完 300 KB，两者绝无可能相等。等价性八条覆盖
首条用户输入埋在 120 KB 之后、单行 48 KB 跨块、200 KB 巨型首行、无尾换行、空文件、只有 meta 的行、坏首行，
外加**首行是空行、meta 落在第二行**这条。最后那条钉的不是"统一口径"，而是**两处旧口径本来就不一样**：
`findLatestSession` 走 `readFirstLine`，对应旧的 `split("\n")[0]`，**不滤空行**；`listSessions` 走
`readSessionHead`，对应旧的 `split("\n").filter(非空)`，**滤空行**。所以同一份夹具下前者照样判坏、定位不到，
后者照常上面板拿到标题——这是历史事实，顺手把它们统一掉就会改变 `findLatestSession` 的行为。

变异四只：① 恢复整篇 `readFile` → 字节跨度那条红；② 去掉 `{stream:true}` → **一开始全绿**，
查因是 `TITLE_MAX = 60` 的截断把跨块损伤藏进了看不见的后半段，于是补一条 ASCII 填充用例
（CJK 每字 3 字节，mod-6 余数永远凑不到边界落在标题第一个字内部；换 ASCII 后 gap 落在 1–2 字节），
这条当场红，量到 `\ufffd\ufffd渊之下…`；③ 给 `readFirstLine` 加上空行过滤（它过去不滤）→ 那条新用例红在
`expected '.mochen/sessions/…jsonl' to be null`；④ 把 `readSessionHead` 的空行过滤去掉（它过去滤）→
**同一条**用例红在 `expected [] to deeply equal [ 's-blank' ]`。一条用例被两个相反方向的变异各打红一次，
才证明它有双向鉴别力，而不是只钉住了我随手写的那一半。
两只"看起来通过"的假绿也补过：字节跨度断言起初会满足 `0 === 0`，加了 `> 0` 才有利。

### 这一刀没切到的另一半（照直写）

渲染层 `useBookStore.refreshDocs()`（`stores/useBookStore.ts:209`）走的是 `openBook` 又一次整本重扫，
建章/改名/卷次重排四处都调它，所以**界面上点「新建一章」仍会把全书读一遍**。
没顺手改它的理由是一条硬的：渲染层 `sortDocsByOrder`（`utils/doc-order.ts:30-39`）对
「都不在 chapterOrder 里的两篇」返回 0（保持原相对序），而 fs-store `sortChapters`（`scan.ts:171-181`）按名字排它们。
两处判据不同，本地拼一根 `DocRef` 进去就和整本重扫**不等价**——而顺序等价正是用户这批点名要保的那条。
所以下一刀的顺序是：先把排序判据合成一份（contracts 出 `sortDocs`），再让 `doc:create` 带回新那篇、渲染层本地拼。
总单 P1-4 那一行因此写的是「半收口」，不是「已修」。

另一处已知取舍也用例钉住了：建章不再刷别篇的缓存摘录（外力改盘后那一格是旧值）。
这条断言刻意断言**旧值**——过去那句整本 `scanBook` 会顺手把它刷成新内容，现在不会了，
丢掉的东西必须被看见，不能藏在 diff 里。

### 门禁实测（2026-10-10，六段各自取码 + 回读日志内容）

| 段 | 命令 | 退出码 | 日志里的第二证据 |
| --- | --- | --- | --- |
| 类型 | `pnpm typecheck`（6 个 tsc 工程串行） | 0 | 零 `error TS`。这一段当场抓出两处我自己带进去的真回归：测试文件里一个没用到的 `AgentEvent` 类型导入（TS6196），和一处 `ORDER[0]` 在 `noUncheckedIndexedAccess` 下的 `Object is possibly 'undefined'`（TS2532）——都改了代码而不是改断言 |
| ESLint | `pnpm lint:eslint`（`--max-warnings=0`） | 0 | 零 problem |
| 包边界 | `pnpm lint:boundary` | 0 | 「边界检查通过」 |
| 行数预算 | `pnpm lint:budget` | 0 | 「行数预算通过（604 份，含 .mjs/.cjs）」——三个新测试文件都在预算内 |
| 格式 | `pnpm format:check` | 0 | 「All matched files use Prettier code style!」 |
| 全量测试 | `pnpm test`（`vitest run --maxWorkers=4`） | 0 | **301 个测试文件全过 / 3939 passed \| 2 skipped**，31.27 s，无一条 timeout；本批新增 27 条（`rollout-head-read` 12 + `book-service-create-doc-io` 8 + `scan-concurrency` 7）在日志里逐条点名通过 |

跑门禁时机上那只 dev 实例仍在（5 个 electron.exe 进程），所以上面这套判据全是确定性的（调用次数、字节跨度、
树形 `toEqual`），没有一条依赖墙钟——这也是这批敢在有并行实例的机器上收口的唯一理由。

### 三件量具没有入库（也没删，按规矩删除要用户点头）

`tmp-scale-probe.test.ts`（1000 章生成 + 三种读法 + 两条建章通路的复量夹具）、`tmp-session-probe.test.ts`
（会话长度放大倍数的量具）、`book-service-createdoc.test.ts`（`book-service-create-doc-io.test.ts` 的**前一版草稿**，
跨用例共用夹具，整文件跑会互相污染，已被那份取代）三份都**移出仓库**放在 `~/dw-scratch/2026-10-10/`，没有 `rm`。
前两份是量具不是闸：它们每次跑都要往临时盘写 8.66 MB（1000 篇 × 3000 字）并生成一遍夹具，把这种一次性物理事实
变成每次提交都跑的断言不划算——**注意这里没写具体秒数**，我没单独量过"留在仓里全量测试多花多久"，
只量过夹具本身的写盘量（8.66 MB）。要彻底删掉这三份请点名。

## 第 3 波（2026-10-10）：两条都是「屏上看得见、代码里早就写着」——对话框一点就弹亮框，助手回复吐原始符号

两条都是用户直接指出来的：**「点一下对话框就弹出来，非常不好」** 与 **「他生成的对话中有一些其他符号也不行」**。
两条的形状一样：`tsc` 全绿、eslint 全绿、307 个测试文件全绿，屏上就是不对。

### ① 点一下对话框就弹出来，非常不好

**根因**：`theme-runtime.css` 里有两条选择器把 **`.composer:focus-within .composer-input-surface`**
和 **`.dialog-content textarea:focus`** 写在同一句里，于是输入卡也拿到了
`border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-soft)` 那个 3px 光环。
输入卡是**你每一句话都要点一下**的地方，点一下整张卡内侧就弹出一圈亮框。

光环还有第二个副作用，量出来的：`box-shadow` 是单值属性，后写者胜，所以那条光环把
`agent-pane.css` 给输入卡的**景深阴影整个盖掉**了 —— 聚焦那一刻卡片反而变扁。
用户看到的「弹出来」是这一下形变，比多一圈光更扎眼。

**改法**：**拆成两条**。输入卡只留
`border-color: color-mix(in srgb, var(--accent) 30%, var(--line))`，不加光环；
对话框里的输入框**焦点环留着** —— 那是表单字段、Tab 得到它，焦点不一定带光标（空字段），
环是唯一的可见提示。这两者不是同一种场合，本来就不该共用一条规则。

### ② 他生成的对话中有一些其他符号也不行

**根因**：`AgentTimeline.vue` 的模板是 `<p class="message-text">{{ block.text }}</p>`——纯文本插值。
类名写着 `message-markdown`、`theme-runtime.css` 里 `.message-markdown pre/code/a` 的样式也**早就写好了**，
可**压根没有渲染器**。类名承诺了、样式铺好了、渲染没接上——三样里缺最要紧的那一样，而缺的那一样**肉眼根本看不出「缺」**。

**改法**：引**共享**渲染器 `markdownToSimpleHtml`（`@mochen/fs-store/export-shared`，
`DocumentPane.vue` 引的是同一个子路径——同一件事不许有第二份实现），模板改 `v-html`，
容器从 `<p>` 换成 `<div>`（渲染器输出自带 `<p>`，再套一层就是非法嵌套，浏览器会自动拆开、间距全乱）。

**顺带修掉共享渲染器自己的一个缺陷**：有序列表原来只产 `<li>` 不包 `<ol>`，
浏览器对「不在列表容器里的 li」不画编号，于是 **1. 2. 3. 整个消失**。对话区最先撞上它（模型爱写编号清单）。
包的时候必须用 `class="ol-item"` 记号区分两支正则——第一版直接包 `<ol>`，
实测出来是 `<ul><ol><li>甲</li></ol></ul>`，无序列表被改了结构，**被本轮自己的守卫抓住**。

**保留四处纯文本插值**（user-text / thinking-peek / thinking-text / error-line）：
那些不是模型吐的 markdown，渲染它们才会出事（用户打的字里一个 `*` 变成斜体、报错里的 JSON 被吃掉尖括号）。

### 真机撞出来的第二个原因：编号补上 `<ol>` 之后，屏上还是一个号都没有

这是本轮**唯一一条真机才暴露、守卫全绿也看不见**的东西。

补完 `<ol>`、重建、探针量 DOM：`<ol>` 三个 `<li>` 齐活、`padding-left: 21px` 也在，
截图里**一个号都没有**。量 `list-style-type` 得 `none`。

根因：`styles.css:147` 有一条**全局** `ul, ol { list-style: none }`（给导航那套自绘列表用的），
照样作用在正文渲染出来的列表上，把 `::marker` 关了。
**这与「没有 `<ol>`」是两个互相独立的原因**——只修渲染器，编号照样不显示。
写法照 `editor-pane.css` 的 `.markdown-body ul/ol`（文稿预览那边早踩过同一条，
`list-style-type: disc` / `decimal`），不另立一套。

守卫补的是形状而不是内容：`expect(css()).toMatch(/\.message-markdown ol\s*\{\s*list-style-type:\s*decimal/)`。
**不能用 `ruleBlock(css(), ".message-markdown ol")`**——合并规则 `.message-markdown ul,\n.message-markdown ol {`
的选择器里也含它，`ruleBlock` 命中的是那条，拿到的是 padding 那块正文（第一版就是这么假红的）。

### 守卫与变异

- `components/message-markdown-wiring.test.ts`（16 条）：共享渲染器 + 反向钉不许引 fs-store 的 barrel、
  正文那格不许退回纯文本插值、容器不许退回 `<p>`、pre-wrap / 相邻块间距 / 列表缩进 / 列表标记 / 代码块 / 流式光标挂位、
  输入卡无光环、对话框焦点环仍在、两格不许再共用同一条选择器、输入卡景深阴影没被盖掉。
- `packages/fs-store/test/markdown-ordered-list.test.ts`（7 条）：`<ol>` 包住、
  **反向钉「不许有落在 `<ol>` 之外的 `<li>`」**、有序与无序各归各、行首编号不进正文；
  外加「先转义这道线不许松」两条（渲染层的 `v-html` 会把输出注入 DOM，顺序反了就是实打实的 XSS）。

**变异 17/17 全红**（`.mochen-tmp/p537/mutate-message-markdown.cjs`，还原用变异前存下的字节）。
其中 3 条是这一轮真机撞出来之后才补的：`M16` 列表标记、`M2` 两支正则互相污染、`M8` 流式光标挂位。

**这一轮门禁自己抓出来的两条**：
① `vue/no-v-html` 警告把 `pnpm verify` 打红 —— 按 `DocumentPane.vue` 已有的写法加放行注释与理由，
不是 `eslint-disable` 一行了事（理由要写清「同一个函数、先整体 escapeHtml、回归线在哪」）。
② **包边界检查把这条守卫文件自己判成违规**：`.toContain('from "@mochen/fs-store"')` 这个反面字面量
正好撞在检查器的 `SPECIFIER` 正则 `(?:from|import)\s*\(?\s*["']…` 上。
改成 `toMatch(/from\s+["']@mochen\/fs-store["']/)`（`from` 后面跟的是字面 `\s` 两个字符，扫不到）。

### 探针前置条件被真机顶回来一次：只看 `visibilityState` 不够

第一轮量聚焦态，探针前后量到的 `box-shadow` **一模一样**，看着像「聚焦了但没变化」。
真相：`document.activeElement` 确实是那个 textarea，而 `.composer.matches(":focus-within")` 是 **false**。
窗口失焦时 Chromium **保留 `activeElement`**，但 `:focus` / `:focus-within` 都不再匹配——
于是量到的全是失焦态的值，**而那些值看起来完全合理**（阴影还在、边框还是那个颜色），不会报任何错。
Windows 前台锁也让 `SetForegroundWindow` + `AttachThreadInput` + 最小化还原这一套连续 6 次都没抢到焦点。

修法两条：① 唤醒脚本的前置从「visible」改成「visible **且** `document.hasFocus()`」；
② 量焦点类的东西之前先 `Emulation.setFocusEmulationEnabled`，并**断言 `hasFocus()` 真的翻成 true**，
模拟没生效就报 MISS、不产出任何结论。探针里再加一条自检：
**`focusWithin` 前后必须分别是 false / true**，否则这一轮根本不算「聚焦过」。

顺带修掉自己的断言写窄了一次：原先写「聚焦前后都该是 `0 7px 22px`」，
实际是**失焦 `0 5px 18px`、聚焦 `0 7px 22px`**（聚焦时卡片**抬起来**才是那条规则的本意），
第一版断言让失焦那态假红。**连错三次以上就把真实值打出来**，这轮两次都是这么抓回来的。

### 真机（本轮实测，退出码逐条回读）

- **输入卡聚焦态 5/5**：3px 光环不在了；景深阴影还在且聚焦时从 `5px 18px` 抬到 `7px 22px`；
  边框是那支很轻的提亮；卡片几何没变（`628×109` 前后一致，没被撑开也没被压扁）。
- **助手正文**：DOM 上 `h2/strong/code×2/pre/ol(3 li)/ul(2 li)` 齐活，
  `**`、`##`、`1.` 三个残留判据全 false；截图上编号与圆点都画出来了。

**这一条要说清楚它是怎么来的**：真实 `agent.send()` 走了，**被主进程如实拒收**——
`"尚未打开作品目录，请先在左栏选择一本书。"`（打开作品要原生文件夹选择器，探针驱动不了）。
所以正文那条用的是 store 自己的 `reduceEvent` 塞一条 markdown 内容**完全已知**的 message 事件：
那正是生产代码里把 `AgentEvent` 推进 `thread.items` 的动作，模板与 CSS 全是原件。
这样把「渲染器对不对」与「模型听不听话」彻底分开——真发一轮那条要等作品目录打开才补。

### 门禁（本波实测，退出码逐条回读）

| 段 | 命令 | 退出码 | 日志里的第二证据 |
| --- | --- | --- | --- |
| 格式（本批文件） | `prettier --check`（只点自己那 6 个） | 0 | 「All matched files use Prettier code style!」 |
| 类型（5/6 工程） | `tsc --noEmit -p …` | 0 | 零 `error TS` |
| 类型（web 工程） | 同上 | **2** | 12 条，**全在并行会话的文件里**：8 处 `RendererApi` 夹具缺 `refreshDoc`（他们给 `renderer-api.ts` 加了它、没同步 `useBookStore` / `book-draft-fixture` 等夹具）、4 处他们新增的 `doc-tree.ts`。本批 6 个文件一条都没沾上 |
| ESLint | `eslint . --max-warnings=0` | 0 | 零 problem |
| 包边界 | `node tools/check-package-boundary.mjs` | 0 | 「边界检查通过」 |
| 行数预算 | `node tools/check-source-line-budget.mjs` | 0 | 「行数预算通过（611 份，含 .mjs/.cjs）」 |
| 全量测试 | `vitest run --maxWorkers=4` | 0 | **307 个测试文件全过 / 3995 passed \| 2 skipped**，31.45 s |

全量 `pnpm verify` 仍红在 **prettier 那一段**，红的 7 个文件全属并行会话的在制品
（`book-service-create-doc-io.test.ts` / `ipc-guard.test.ts` / `doc-tree.ts` / `doc-tree.test.ts` /
`contracts/src/book.ts` / `contracts/src/ipc.ts` / `contracts/test/sort-docs.test.ts`）。
**本轮只格式化了自己那两个文件，没碰别人的活。**

### 还没做完的（照直写）

- **助手正文那条的「真发一轮」**：等作品目录打开才能补。真发与确定性注入走的是**同一个 `reduceEvent` 出口**，
  差的那一段是「主进程 → 真端点」的出站，与本轮改动无关。
- **联网检索挂 200 秒**：根因已定位（`web-search.ts:310/:419/:522` 读 body 无任何超时，
  `TurnDeps.signal` 从不传给 ToolHost，Esc 中止不了那个 fetch），**改法仍未获裁定**。
  报告里第③条推断（更可能卡在第 2 轮 SSE）指向与①完全不同的改法，不能混着动。
- **对话框出场动画接弹簧曲线**、**功能按钮 chip 行窄档缺口**：用户上一轮点名，仍未动。
- 深度档的真端点那一腿（5-㊻ 的最后一腿）同样卡在作品目录上。

## 第 4 波（2026-10-10）：「对话框出场动画接弹簧曲线」——顺手挖出一条**从来没生效过的弹簧**

诉求是上一轮用户点名的**对话框出场动画接弹簧曲线**。做它的过程里挖出一条比它大得多的东西：
**本仓那条弹簧曲线，从写下来那天起就没生效过。**

### 改法（对话框这一半）

`motion.css` 里 `.workspace-dialog` 和另外 14 个浮层共用一张 `--ease-out-soft` 出场表。
拆成两条：对话框单独一条走 `--ease-view`（本仓唯一那条弹簧），其余 14 个照旧。
时长也分一档 `--dur-dialog: 200ms`——170ms 里弹簧那段过冲只落在头 50ms，读起来是「弹了一下」而不是「落到位」。
顺带给**背板**补上入场（原先一点动效都没有）：面板在弹、背板硬出现，两层各自为政。

「拆分」必须拆干净：两条规则权重都是单类选择器，同时命中时**谁赢取决于源码顺序**，
那是个没人看得出来的隐式依赖。守卫专门钉了这一条。

### 根因：弹簧曲线是**非法值**，整条声明在计算值阶段被丢弃

现象：规则明明白白在 CSSOM 里、`matchesSelf: true` 也确实匹配那个元素，
可 `getComputedStyle(el).animationName` 算出来是 **`none`**，`getAnimations()` 返回空，
**控制台一个字都没有**。

本机引擎（Electron 42）的 `linear()` 只认**「逗号分隔的单个数字」**这一种形式。真机矩阵量出来的：

| 写法 | 引擎 |
| --- | --- |
| `linear(0, 1)` / `linear(0, 0.5, 1)` | 收（序列化回 `linear(0 0%, 0.5 50%, 1 100%)`） |
| `linear(0 0, 1 1)`（带输入分量） | **拒** |
| `linear(0%, 100%)`（单值百分比） | **拒** |
| `linear(0 0, 3% 0.0655, …)`（本仓原来那条 34 段） | **拒** |

而 `animation` 简写里只要有一个值非法，**整条声明在计算值阶段被丢弃**——不是只丢那一段。
于是 `.thinking-window`、`::view-transition-*`、换皮肤的交叉淡入，**全都是「硬」的**，
而仓库里没有一条守卫会红：那条 `@supports (animation-timing-function: linear(0, 1))` 闸
探的恰好是**引擎唯一收的那种形式**，闸是过的，值是非法的。

**修法不需要改物理参数，也不需要降级到 cubic-bezier**：34 个采样点的**输入位置本来就是均匀的**
（`i/(POINTS-1)`），而「只给输出值」的写法按规范就是均匀布点 ⇒ input 分量整个省掉，
曲线一模一样，文本还从 609 字符短到 477。过冲大于 1 在这种写法里照收。

守卫补的是**停靠点本身的形状**（那条本来该拦住它的判据）：
每个停靠点都必须匹配 `/^-?\d*\.?\d+$/`——带 `%` 或带输入分量的一律红。

### 探针本身被自己骗了三次（都记在案）

1. **量晚了**：开对话框后等 1.2 秒再量，动画早已放完。
   但 computed `animation-name` 不会因为动画结束就变 `none`——所以「量晚了」这个解释站不住，
   我还是先按它走了一轮，白跑。
2. **扫描有 bug**：我用 `if (rule.cssRules)` 判断要不要递归，而新版 Chromium 里**普通样式规则的
   `cssRules` 是个空但为真的 CSSRuleList** ⇒ 每条都成立、每条都 continue，
   结果 `ruleContexts: []`——「规则不在 CSSOM 里」是**我探针造出来的假象**。
   正确判据是按 `rule.type` / `rule.conditionText !== undefined` 判断。
3. **残留状态**：前一轮探针把对话框留在开着，这一轮量的是它已经放完的那一态。

⇒ **CSSOM 扫描里「没找到规则」这个结论，在归咎于产物之前，先把扫描本身验一遍。**

### 顺带修掉一条共用扫描的缺陷（同一个失败方向）

`components/overlay-chrome.test.ts` 里有一份「扫 `animation: mochen-pop-in` 的类名表」的逻辑，
它用 `/([^{}]+)\{([^{}]*)\}/g`，**把每组选择器的第一条粘在了前导注释上**：
一段注释紧挨着 `.tool-roster,` 时量出来第一段是「注释 + .tool-roster」，不以 `` 开头 ⇒ 被静默丢掉。
**这条扫描的失效方向是绿的**：新加一个单选择器浮层、上面写段注释，它就从表里消失了，
而当时没有一条断言会去看它。

已收成 `vue-source-reader.ts` 里唯一一份 `popInSelectors()`（走 `cssRules`，前提是调用方传剥过注释的源），
两处测试共用。新守卫的变异 `D12` 就是把这份实现退回旧写法——当场变红。

### 守卫与变异

- 新增 `components/dialog-spring-wiring.test.ts`（9 条）、`view-transition-wiring.test.ts` 新增 1 条
  （停靠点形状）、`utils/vue-source-reader.ts` 新增 `popInSelectors`。
- **变异 14/14 全红**（`.mochen-tmp/p537/mutate-dialog-spring.cjs`），其中 `D13`/`D14`
  就是把曲线改回本轮修掉的那两种非法写法——**历史 bug 能被自己的守卫当场复现**。
- 本轮还改了断言三处，都是判据自己写错而不是代码错：`ruleBlock` 遇到逗号分隔的选择器直接抛
  「找不到规则」（改成按整条规则断言）；注释里写着 `html[data-reduced-motion="true"]`
  把正则喂饱（改成读剥过注释的源）；一次把自己的嵌套反引号写进了探针模板串（两次才定位）。

### 真机（本轮实测，退出码逐条回读）

对话框：`animationName=mochen-pop-in`、`0.2s`、`getAnimations()` 非空且 state=`running`、
计时函数是那条 `linear(...)`；背板 `mochen-view-fade-in` 同时长同曲线；
**思考态 `.thinking-window` 算出 `thinking-window-in` 180ms / anims=1（本轮之前是 `none`）**；
对照组走软曲线的 `.model-select` 照旧 0.17s。7/7 全过。

### 门禁（本波实测）

prettier（本批 6 个文件）0、eslint 0、包边界 0、行数预算 0（612 份）、
全量 **308 个测试文件 / 4005 passed | 2 skipped**。
六路 tsc 五路 0，web 工程仍 12 条红、**仍全在并行会话的文件里**（`refreshDoc` 夹具 + 他们的 `doc-tree.ts`）。

### 还没做完的

- **功能按钮 chip 行窄档缺口**：用户点名的另一条，本波没动。
- **助手正文的「真发一轮」**与**深度档真端点那一腿**：仍卡在作品目录（原生文件夹选择器，探针驱动不了）。
- **联网检索挂 200 秒**：根因已定位，**改法仍未获裁定**。

## 第 5 波（2026-10-10）：功能按钮 chip 行窄档缺口 —— 一条**被死代码满足的守卫**

README:5455 当年留的原话：「输入卡 chip 行在 1120 窄档已有四级让位阶梯（#113f），
**按钮侧的缺口要单独量**。」本波去量了，量出来的不是「缺一档阶梯」，
是**守卫钉住了修法、而那条修法所在的档真机永远走不到**。

### 真机逐档量（CDP 的 Emulation.setDeviceMetricsOverride 扫 1600→1000）

判据沿用 5-⑱ 定的那套：① 相对**基准档**新增的矩形相交 = 0；② 溢出 0；
③ **发送键必须仍有可见宽度**（上一版候选把右端饿成 0px）。

**真缺陷（窗口 1024 / 容器 700.7）**：模型 chip 框 75.8px，而它的**内容地板是 96.3px**
（标签 `min-width: 4.5em` = 47.25 + 图标 14 + 下拉三角 11 + 间隙 10 + 内边距 14），
chip 又是 `overflow: visible` ⇒ **内容整个画到框外**：下拉三角落在下一枚（thinking）左沿**右侧 9.4px**，
两枚图标叠印；`scrollWidth-clientWidth` 溢出 13px。窗口 1000 / 容器 676.7 那档溢出 4px。

**成因不是「空间不够」，是地板放错了地方**：
`composer-toolbar-narrow.test.ts` 里那条「模型名不再被 4.5em 钉住」钉的是
`@container composer (max-width: 620px)` —— 事实成立，**可本机窗口地板是 `minWidth: 1000`，
容器最窄只量到 676.7**，620 及以下那五档（620 / 615 / 589 / 560 / 380）全是死代码。
**一条长期全绿的守卫，钉的是一段真机上永远不执行的 CSS。**

### 改法：撤地板，但撤在**真会走到的**那一档

把「模型 label 的 `min-width: 0`」挪进 **722 那一档**（真机在 1040 及更窄都会走到）。
基础规则里那道 4.5em 地板保留 —— 正常宽档下模型名还要「认得出是模型名」，
窄档才让它与其余标签一样出省略号。

**一次失败的修法也记下来**：先试了给 chip 自己写 `min-width: min-content` 让它按内容算地板。
**更糟**——那把左端的最小宽度整个撑大，1440/1280/1200/1120 四档当场开始抖动，
容器宽度在 758 / 626 / 466 / 386 之间来回跳。**地板不是 chip 的事，是 label 的事。**

### 真机 A/B（运行时注入样式，不重建，只换一个变量）

同一个 75.8px 的框：

| | chip 框 | 溢出 | label min-width | 三角越界 | 三角压过下一枚 |
| --- | --- | --- | --- | --- | --- |
| 运行时把 4.5em 打回去 | 75.8 | **13** | 47.25px | **+13px** | **9px** |
| 构建产物（含本轮修法） | 75.8 | **0** | 0px | −7px（在框内） | 无 |

修完逐档复扫：1600 / 1440 / 1280 / 1200 / 1120 / 1080 / 1040 / 1024 / 1008 / 1000
**十档全部溢出 0、无一处新增相交**，发送键恒为 30px。

### 守卫与变异

`composer-toolbar-narrow.test.ts` 新增两条（该文件 62 条全绿，本轮之前 60）：

1. **「撤地板那格必须落在真机会走到的阶梯里」**——收全部 `@container composer (max-width: Npx)`，
   取写了这条规则的 N，**最大的那个必须 ≥ 可达下限 676.7**（那个下限是量出来的，写在旁边可审）。
   钉的不是「某档里有这句话」，是**这句话所在的档真机走得到**。
2. **反向钉**：基础规则里那道 4.5em 地板仍在（不许为了让守卫绿而把正常宽档也拆掉）。

变异 **5/5 全红**（`.mochen-tmp/p537/mutate-chip-floor.cjs`），其中 `C2` 与 `C5` 就是
「写对了但挪到走不到的档」——**本轮那个历史 bug 能被自己的新守卫当场复现**。

### 探针被自己骗了一次（值得记）

第一次扫完的读数**非单调**：容器宽度在 W=1440→1120 之间是 758 / 626 / 466 / 386 / 306，
而同一套扫法在本轮改动之前是单调的（1440 与 1600 同为 758.7）。差点当成自己改出来的回归。
真因：固定 `sleep 650ms` 就量，量到的是 ResizeObserver 重排的**中间态**。
改成**连续三次读数相同才算稳定**之后，读数恢复单调，真机缺陷也照旧复现。

⇒ **判据要先确认「量的是稳态而不是动画」**，否则量到的非单调读数极像回归。
（同族：已记的「CSSOM 扫描里『没找到规则』先验扫描本身」。）

### 门禁（本波实测）

prettier（本批 2 个文件）0、eslint 0、包边界 0、行数预算 0（612 份）、
全量 **308 个测试文件 / 4007 passed | 2 skipped**。
web 工程 tsc 仍 12 条红、**仍全在并行会话的文件里**。

### 还没做完的

- **620 / 615 / 589 / 560 / 380 那五档是死代码**：本轮只把「撤地板」挪到了会走到的档，
  **没有删那五档**——窗口地板 1000 是有据的裁定（P2-9），改地板属于产品决定，不在本轮范围。
  要删或要保留并注明，等点名。
- **助手正文的「真发一轮」**与**深度档真端点那一腿**：仍卡在作品目录（原生文件夹选择器，探针驱动不了）。
- **联网检索挂 200 秒**：根因已定位，**改法仍未获裁定**。

## 第 6 波（2026-10-10）：联网检索那 200 秒 —— 先前那份报告的**两条推断都是错的**，真因是第三件事

之前挂着一条「根因已定位、改法待裁定」的报告。它给的两条推断，逐条量过之后**都不成立**：

| 报告的推断 | 实测结论 |
| --- | --- |
| ① `AbortSignal.timeout(6000)` 只管到 headers，读 body 无任何超时 | **假。**本地起服务实测（`.mochen-tmp/p537/measure-body-timeout.cjs`）：header 发完就把 body 卡住，它在 **6s 处以 AbortError 收场**；不带 signal 才是真的永不 settle |
| ② `TurnDeps.signal` 从不传给 ToolHost，Esc 中止不了那个 fetch | **假，而且早就修过。**P1-1 的② 已把「本轮打断」接上——`provider-fetch.ts` 的 `abortableFetch` 在最外层用 `mergeAbortSignals([init.signal, 本轮signal])` 把两只并成一只。守卫 `agent-service-web-search-signal.test.ts` 当场绿 |

**真因是第三件事**：`web-search.ts` 里每个源都把 `await response.text()` 写在 `try/catch` **之外**，
而 `runSourceChain` 的 `await source.run(...)` 外面也没有 try/catch。
于是「读 body 超时」这件事以**裸 AbortError 抛出**的形式穿透整条源链：

```
runSourceChain → await source.run(...)   // 抛了
  └─ coolDown(source.id) 从没被调用      // ← 关键
```

**这正好解释 200 秒**：源没被记进冷却 ⇒ 下一个工具轮又把三个源各重试一遍，
四个工具轮 × 三源 × 6 秒 ≈ 72 秒纯等待，加上每轮模型本身的延迟，正好在 200 秒那个量级。
而那五档里 `abortableFetch` 早就让 Esc 收得住，所以**用户按了停止它也不是完全不停**——
是「停了这一轮，下一轮又从头来」。

### 改法（两处，都是同一个病根）

1. **三个源各自把读 body 挪进自己的 try/catch** —— 源的契约是「返回一条 `SourceAttempt`，永不抛」。
   `httpFailure` 一并挪进去（它本来就是 return，不抛）。
2. **`runSourceChain` 加第二道 try/catch** —— 第三方源或将来的改动一旦抛了，它仍只是一个
   「坏掉的源」：记一条失败、进冷却、继续试下一个，而不是把整条链掐断。

### 守卫

新增 `web-search-body-timeout.test.ts`（9 条），补的是**此前完全没有测试的那条路**：
`web-search.test.ts` 里那个 `never()`（永不 resolve 的 fetch）**只喂给不调用 fetch 的 stub 源**，
真源里 `await response.text()` 那一段从没被喂过挂死的输入。

三组：① 三个内置源 × 两种错误（AbortError / TimeoutError）都必须**返回** `{ok:false, reason:"network", message:"连接超时"}`；
② 一个源抛异常时后面的源仍会被试到；③ 抛异常的源**照样进冷却**（第二轮不再撞一次）——
这条正是「200 秒」的判据。

**变异 6/6 全红**（`.mochen-tmp/p537/mutate-web-search.cjs`），其中 `W4` 把 catch 改回 rethrow
就是本轮修之前的样子，`W5` 把抛异常的源记成 `empty`（empty 不进冷却）——**200 秒那条形状当场复现**。

### 顺带记一笔：本机窗口地板那条待决

620 / 615 / 589 / 560 / 380 五档在当前窗口地板下走不到（第 5 波已量）。
**这一波定了「保留」**：`composer-toolbar-narrow.test.ts` 钉的 `ALLOC_TIER=620` 与
`WRAP_TIER=560` 正是那两档，删掉它们等于删掉两条守卫的真身。
窗口地板 1000 是有据的裁定（P2-9）；哪天真改了地板，那五档立刻生效。
**待决项因此变成「改地板时记得重算这几档」，不是「删死代码」。**

### 门禁（本波实测）

prettier（本批 2 个文件）0、eslint 0（一处 `prefer-const` 是我自己新测试里的，当场改了代码不是改断言）、
包边界 0、行数预算 0、全量 **309 个测试文件 / 4016 passed | 2 skipped**。
六路 tsc 五路 0（`web-search.ts` 属主进程，走 `tsconfig.node.json`），
web 工程仍 12 条红、**仍全在并行会话的文件里**。

### 还没做完的

- **200 秒这条只验到这一层**：真机发一轮要作品目录（原生文件夹选择器，探针驱动不了）。
  但这一波的判据全是**纯代码层**的（源返回什么、冷却簿记记不记），已用回归测试 + 变异钉住。
- **助手正文的「真发一轮」**与**深度档真端点那一腿**：仍卡在作品目录。

---
title: "Main-process entry: the single assembly layer that touches Electron"
status: accepted
tags:
  - "architecture"
  - "main-process"
  - "entry-points"
---

## Purpose & Scope

本规范对「主进程这一份入口怎么装、装在哪一步、哪些东西许碰 Electron」有规范力：`apps/desktop/src/main/index.ts` 这一份文件——进程级异常钩子、旧品牌目录迁移（F-4）、本轮设置目录两态判定、各 store / service 的按序装配与 IPC 注册、无边框窗口与窗控叠加区、来源闸 / 窗口闸 / 通道级授权的装配点、退出落盘握手、渲染层加载与启动自检。它是主进程**唯一**碰 Electron 的地方，也是**唯一**的装配层：**判定与文案一律不住这里**，全部住各自真身（`crash-guard.ts` / `quit-flush.ts` / `ipc-guard.ts` / `channel-trust.ts` / `app-dirs.ts` / `title-bar.ts` / `auto-update.ts` / 各 store 与 service），这里只剩「按顺序把它装上、把缝递下去」。

Depended on by: `electron.vite.config.ts`（主进程入口指向本文件）、`ipc-guard-coverage.test.ts` / `quit-flush-close-arm.test.ts` / `window-min-size.test.ts` / `frameless-titlebar-wiring.test.ts` / `export-dialog-wiring.test.ts`（按源码字面量钉接线）、`preload/index.mjs`（注入的那套 `window.mochen` 由这里算出的 trust 认自己人）。

Out of scope:

- 来源闸 / 窗口闸 / 加载目标判定 —— 住 `ipc-guard.ts`（`resolveRendererLoad` / `installRendererTrust` / `installWindowGuards` / `trustedHandler`）。
- 通道级授权分档与判定 —— 住 `channel-trust.ts`（`IPC_TRUST_LEVELS` / `channelTrustVerdict`）。
- 异常钩子三规矩 —— 住 `crash-guard.ts`；退出握手三条规矩与 `waiting` / `released` 状态机 —— 住 `quit-flush.ts`。
- 目录名唯一判据与开发态「只复制不搬走」 —— 住 `app-dirs.ts`；旧品牌目录迁移 —— 住 `app-data-migration.ts`。
- 窗控叠加区配色 —— 住 `title-bar.ts`；窗口地板数值 —— 钉在 `window-min-size.test.ts` 与布局真身；启动自检文案 —— 住 `auto-update.ts`。
- 各业务真身（书 / 智能体 / 技能 / 市场 / 插件 / 回收站 / 备份 / WebDAV / 导入 / 改稿历史）—— 一律住各自 service 与 store。

## Surface

- `console.error` 包装 / `crashLogPath` / `appendCrashLine` — 同文件 — 吞 dev reload 的 EPIPE；诊断件唯一落点（本轮设置目录 `logs/crash.log`）。
- `LEGACY_APP_DIR_NAME` — 同文件 — 旧品牌目录名，只出现在迁移入参里。
- `installCrashGuard({…})` — 同文件 — 进程级钩子，`app.whenReady()` **之前**装。
- `app.whenReady().then(async …)` — 同文件 — 全部装配的宿主。
- 目录块：`migrateLegacyAppData` → `packagedDir`（kept-old 用旧目录）→ `resolveAppDataDir` → `activeDir` → `notice` / `seedNotice` — 同文件 — 决定本轮所有 store 认哪份目录。
- `appearanceStore` / `initialAppearance` / `retentionStore` / `service`（BookService / `registerBookIpc`）— 同文件 — 外观与保留上限先读，BookService 在其后建。
- `registerPickDirectoryIpc` / `Menu.setApplicationMenu(null)` — 同文件 — 选目录桥与原生菜单整条去掉。
- `rendererLoad` / `installRendererTrust` — 同文件 — 一次算完「加载哪」与「谁算自己人」。
- `win`（`new BrowserWindow({…})` + `once("ready-to-show")`）/ `applyTitleBarOverlay` / `nativeTheme.on("updated")` — 同文件 — 唯一窗口；窗控叠加区配色随主题刷新。
- `installWindowGuards` — 同文件 — `will-navigate` + `setWindowOpenHandler`，任何加载动作之前装。
- 智能体链：`credentials` / `settings` / `modelLister` / `readSkillForTurn` / `pluginsDir` / `seedBuiltinPlugins` / `plugins` / `agent` / `registerAgentIpc` / `registerProviderIpc` / `installChannelTrustDeps` — 同文件 — 密钥只在主进程；通道授权查询器齐了才装。
- 其余注册：`registerSkillIpc` / `registerSkillMarketIpc` / `registerChangesIpc` / `registerTrashIpc` / `registerBookBackupIpc` / `registerWebdavConfigIpc` / `registerWebdavServiceIpc` / `registerImportIpc` / `registerWebSourceIpc` / `registerAppearanceIpc` / 直注册的 `updateCheck` / `buildExport` / `saveFileExport` / `appNotify` — 同文件 — 各业务 IPC 装配点（一律经闸包装）。
- `win.on("closed")` → `agent.dispose()` / `installQuitFlush({…})` — 同文件 — 收尾与退出握手。
- `win.loadURL` / `win.loadFile` / `checkOnBoot` — 同文件 — 用同一份 `rendererLoad` 加载；启动自检在加载之后。

States: 进程未就绪（仅 crash-guard 装好）→ 目录确定（迁移 + 两态分离 + notice 弹或不弹）→ store 就绪（外观 / 保留上限 / BookService）→ 窗口建立（先来源闸、再建窗、后窗口闸）→ 全链就绪（各 service 与 IPC 注册、通道授权装上）→ 运行（主题切换刷新叠加区、外观保存刷新）→ 退出（握手拦一次 → 回话 / 超时放行 / 问人）。

## Normative Behavior

1. WHEN 全仓要碰 Electron（`app` / `BrowserWindow` / `ipcMain` / `dialog` / `Notification` / `Menu` / `nativeTheme` / `safeStorage` / `shell`），the 装配层 MUST 是本仓唯一一处，判定与文案 MUST NOT 住这里（真身各在 `crash-guard` / `quit-flush` / `ipc-guard` / `channel-trust` / `app-dirs` / `title-bar` / `auto-update` / 各 store）。
2. WHEN 装进程级异常钩子，the 装配层 MUST 在 `app.whenReady()` **之前** `installCrashGuard`，MUST NOT 塞进 whenReady 回调（迁移 / 凭据 / 插件挂载里任何一处抛都要落在钩子之下）。
3. WHEN 启动，the 装配层 MUST 先 `migrateLegacyAppData` 搬旧品牌目录**再建任何 store**（顺序钉死），并按 `report.status === "kept-old" ? legacyDir : newSecretDir` 定 `packagedDir`。
4. WHEN 算本轮设置目录，the 装配层 MUST 只按 `resolveAppDataDir` 算出的 `activeDir` 建 store，MUST NOT 按 `packagedDir` / `newSecretDir` 建（迁移失败时新目录是空的）。
5. WHEN 建 BookService 之前，the 装配层 MUST 先 `await retentionStore.read()`，并把 `retention: () => retentionStore.current()` 这个必填同步读口递下去（缓存与刷新住 store 自己）。
6. WHEN 建窗口之前，the 装配层 MUST 先读一次 `appearanceStore.read()`（无边框窗控叠加区配色按主题上色，晚了就没法给初值）。
7. WHEN 算「加载哪一份页面」，the 装配层 MUST 只经 `resolveRendererLoad` 一次算完，并立即 `installRendererTrust(rendererLoad.trust)`；MUST NOT 在别处读 `ELECTRON_RENDERER_URL`。
8. WHEN 建窗口，the 装配层 MUST `show: false` + `once("ready-to-show")` 才显示，`minWidth` / `minHeight` MUST 取 1000 / 700（数值钉在 `window-min-size.test.ts`），`titleBarStyle: "hidden"` 与 `titleBarOverlay` 配色 MUST 由 `resolveTitleBarOverlayColors` / `resolveTitleBarPreferDark` 算，MUST NOT 抄死值。
9. WHEN 配 `webPreferences`，the 装配层 MUST `contextIsolation: true` / `nodeIntegration: false` / preload 指 `../preload/index.mjs`；`sandbox: false` MUST 保留（本机开不了，理由写注释），防御 MUST 由其余几道闸承担。
10. WHEN 任何加载动作之前，the 装配层 MUST 装 `installWindowGuards`；外链 MUST 只经 `shell.openExternal`，可开性判据 MUST 复用仓里那一份白名单，MUST NOT 另立第二份。
11. WHEN 装通道级授权，the 装配层 MUST 在**两枚查询器齐了**才调 `installChannelTrustDeps`（`currentBookRoot` = `service.current()?.root ?? null`、`turnRunning` = `agent.hasRunningTurn()`），MUST NOT 写第二份判定（铁律 6）。
12. WHEN 种内置插件，the 装配层 MUST 先 `seedBuiltinPlugins(pluginsDir)` **再** `plugins.mountAll()`（顺序反了要等下次重启才认得），且 MUST NOT 往书目录里塞东西。
13. WHEN 给 service 递「当前书」查询器（插件 / 回收站 / WebDAV / 导入），the 装配层 MUST **每次现取**（`() => service.current()`），MUST NOT 拍快照（换书后会读上一本）。
14. WHEN 每条要收的 IPC 通道，the 装配层 MUST 经 `ipcMain.handle` 且带闸包装（`trustedHandler` 或各 register 的 handler 注册器）；裸 `ipcMain.handle(IPC_CHANNELS.x, …)` MUST 一条都不出现（`ipc-guard-coverage.test.ts` 钉住）。
15. WHEN 装退出握手，the 装配层 MUST 把 `win.on("close")` 与 `app.on("before-quit")` 交**同一个** handler（Windows 点关闭只走 close），且 `installQuitFlush` MUST 只调一次；`hasWindow` MUST 是 `!win.isDestroyed()`，MUST NOT 改成常量。
16. WHEN `IPC_CHANNELS.appFlushQuitDone` 到主进程，the 装配层 MUST 经 `trustedHandler` 收，MUST NOT 认任意来源递来的落盘回话。
17. WHEN 加载窗口，the 装配层 MUST 用 `rendererLoad` 同一个 target（`kind === "url"` → `loadURL`，否则 `loadFile`），MUST NOT 再读一次 env。
18. WHEN 启动自检，the 装配层 MUST 只在 `updateFeedUrl !== null` 时查、且放在窗口加载**之后**，失败 MUST 只落 `appendCrashLine`（不挡首屏）。
19. WHEN 写诊断件（崩溃钩子 / 退出握手 / 更新异常），the 装配层 MUST 只落 `appendCrashLine` 一处（本轮设置目录 `logs/crash.log`）。
20. WHEN 外观保存成功，the 装配层 MUST 刷新窗控叠加区配色（`currentAppearance = next; applyTitleBarOverlay()`）；系统深浅切换那条通路 MUST 只经 `nativeTheme.on("updated")`。

## Constraints & Invariants

- Constraint: 本文件近 800 行预算、双判据之一（595 行 / 近 90 天 17 提交）—— 判定一律往外拆，装配层只留挂线与递缝，见 `conventions/source-line-budget.rule.md`。
- Constraint: 全仓只有一扇窗口（`new BrowserWindow` 只此一处）—— 故无 `window-all-closed` 兜底、`setWindowOpenHandler` 一律 deny、也没有第二条 `.destroy()` 绕过 close 的路。
- Invariant: 详细判定真身各只有一份 —— `crash-guard` / `quit-flush` / `ipc-guard` / `channel-trust` / `app-dirs` / `title-bar` / `auto-update` / `appearance-store` / `change-retention-store` / `app-data-migration`。
- Invariant: 「加载哪份页面」与「谁算自己人」是同一份 `resolveRendererLoad` 的输出 —— 分两处写会出现「加载 env 那条、判据认 index.html」的错装。
- Invariant: 退出握手的 `waiting` / `released` 状态机住 `quit-flush.ts` —— 装配文件里出现 `waiting = true/false` 或 `released = true/false` 就是第二份实现。
- Invariant: 诊断件落点只有 `logs/crash.log` 一份 —— 崩溃钩子与退出握手共用 `appendCrashLine`。

## Failure Behavior

1. IF whenReady 回调里任何一处抛（迁移 / 凭据 / 插件挂载），THEN the 装配层 MUST 已装好 crash-guard，留一行带栈日志 + 一句人话，MUST NOT 变成「双击没反应、窗口永不出现」。
2. IF 打包态出现 `ELECTRON_RENDERER_URL`，THEN the 装配层 MUST 忽略它、落本地 `index.html`（env 对同用户任何进程可读可写）。
3. IF 迁移结果为 kept-old，THEN the 装配层 MUST 继续按旧目录建 store，MUST NOT 按新目录建出「读成没配过」的空设置。
4. IF 渲染层在握手超时内不回话、或回话形状不对，THEN 由 `quit-flush` 按原样放行并留一行痕（装配层只递 `after` / `quit` 缝，MUST NOT 自己判超时）。
5. IF 有稿子落不下去而问人，THEN `askUser` MUST 默认停在「留下」（`defaultId` / `cancelId` 都是 1），MUST NOT 把还没落盘的字带走。
6. IF 某个插件装不上，THEN the 装配层 MUST 只 `console.warn` 一句一行，MUST NOT 刷屏、MUST NOT 挡启动。
7. IF 启动自检检查失败，THEN the 装配层 MUST 只落 crash.log 一行，MUST NOT 弹错、MUST NOT 让首屏多等。
8. IF 窗口被关掉（`closed`），THEN the 装配层 MUST `agent.dispose()`，MUST NOT 让智能体句柄悬着。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 到了打包版启动、用户设置目录里已有旧品牌目录
When 进程跑过 whenReady 装配
Then 旧目录先被搬到新名字、各 store 只认 resolveAppDataDir 给出的 activeDir，
     窗口按 1000×700 地板建立且加载的是本地 index.html（env 被忽略），
     每条 IPC 通道都经闸包装注册，退出时先经一次落盘握手再放行
```

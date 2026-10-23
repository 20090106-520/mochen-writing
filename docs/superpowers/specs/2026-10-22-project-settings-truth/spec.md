# 设置 · 项目管理面板改读作品库真身（不再说谎的空清单）

- 日期：2026-10-22
- 来源：1000 CSS（窗口 1500×1051）窄窗走查「设置 → 项目管理」时的真机读数：
  中栏明明开着《墨宸·主笔》，面板却写「当前作品：尚未打开」；主进程
  `%APPDATA%/mochen-ai-dev/recent-books.json` 里已有《海雾手记》，面板仍写
  「还没有任何作品」。
- 状态：待批准后实施；属于**数据源纠错**，不改版式、不新增 IPC、不新增渲染层 API。

## 一、根因（已核实，不是猜想）

1. `ProjectSettingsPanel.vue` 读 `useProjectManagerStore`（localStorage
   `mochen.project-manager.v1`）。
2. `registerProject` / `registerAndActivate` 全仓 **零调用点**（grep 仅命中定义与导出），
   因此这份书签册永远为空 ⇒ 当前作品永远「尚未打开」、最近作品永远空态。
3. 作品的真实账在另一条链上：主进程 `recent-books-store.ts` 落盘
   `recent-books.json`，渲染层镜像在 `useBookStore.recentBooks`；当前书在
   `useBookStore.meta/rootPath`。设置面板与它完全脱钩。
4. 同一面板「打开作品目录」只调 `window.mochen.pickBookDirectory()` 并丢掉返回值，
   选完目录不会开书（`useBookStore.pickAndOpen` 才是完整动作）。

## 二、本刀做什么

只改一个组件 + 两条守卫：

1. `apps/desktop/src/renderer/src/components/ProjectSettingsPanel.vue`
   - 数据源换成 `useBookStore`：
     - 当前作品 = `book.meta?.title ?? "尚未打开"`；
     - 最近作品 = `book.recentBooks`（主进程清单镜像，按 `rootPath` 作 key）；
   - `onMounted` 调一次 `book.loadRecentBooks()`（清单只在开书后刷新，设置页可能先开）；
   - 行点击 = `await book.openBook(entry.rootPath)`；
   - 行移除 = `await book.forgetRecentBook(entry.rootPath)`；
   - 高亮当前行 = `book.rootPath === entry.rootPath`；
   - 「打开作品目录」= `book.pickAndOpen()`（选目录 + 开书 + 主进程记账）；
   - 移除 `useProjectManagerStore`、`formatCharCount` 两个 import 与对应逻辑；
   - 行里的元信息只留最近打开时间（`RecentBookEntry` 没有字数，不编造）。
2. `apps/desktop/src/renderer/src/components/char-count-wiring.test.ts`
   - 从 `PANELS` 里删掉 `ProjectSettingsPanel.vue`（面板不再显示字数），
     并同步改顶部注释里的「五处」口径，避免守卫指向不存在的调用。
3. `apps/desktop/src/renderer/src/components/project-settings-wiring.test.ts`（新）
   - 钉：读 `useBookStore`、不再 import `useProjectManagerStore`；
   - 钉：模板里 `recentBooks`、`openBook(`、`forgetRecentBook(`、`pickAndOpen(` 四个接点；
   - 钉：空态文案仍只在清单为空时出现。

## 三、取舍

- **为什么不往 project-manager store 里补注册调用**：真身已是主进程
  `recent-books.json`（2026-10-21 作品库拍的板），再喂一份 localStorage 书签册
  就是两套账，必然再次对不上。
- **为什么不删 `useProjectManagerStore` / `ProjectSwitcher.vue`**：它们已无生产引用，
  但删除会牵动 `char-count-wiring`、`appearance-surface-ladder` 等多条守卫，
  与本刀目的（让面板说实话）无关，留给后续专刀。
- **为什么只留时间、不显示字数**：`RecentBookEntry` 契约只有 `rootPath/title/lastOpenedAt`；
  为了字数去逐个读盘会把设置页变成 IO 密集页，且违反「渲染层不自己记账」。

## 四、不变量（可机器判）

1. 组件脚本不出现 `useProjectManagerStore`；
2. 组件模板出现 `book.recentBooks`、`openBook(`、`forgetRecentBook(`、`pickAndOpen(`；
3. 空态 `v-else` 仍挂在 `recentBooks.length === 0` 上；
4. `char-count-wiring` 的 `PANELS` 不含 `ProjectSettingsPanel.vue`，其余三处照旧；
5. 全仓 `corepack pnpm verify` 退出码 0。

## 五、验收

1. 单测全绿；对 `project-settings-wiring` 做变异：把 `recentBooks` 改回
   `pm.sortedProjects` ⇒ 用例红；把 `pickAndOpen()` 改回 `pickBookDirectory()` ⇒ 用例红；还原后全绿。
2. 真机（窗口 1500×1051）：设置 → 项目管理应显示当前书名《墨宸·主笔》，
   最近作品至少列出 `recent-books.json` 中存在的《海雾手记》；点击行能换书。
3. 全量门禁 `corepack pnpm verify` → `VERIFY_EXIT=0`。
4. 台账追加「第一百五十二节」，写清缺陷、根因、修法、真机复核与新基线。
5. 窗口还原 2400×1400 @ (80,80)；**不 commit、不 push**。

## 六、本节收不掉的口子（如实）

- `useProjectManagerStore`、`ProjectSwitcher.vue` 仍是死代码（无生产引用），本刀不清理；
- 设置面板的最近作品不含字数/章节数，因为主进程清单契约里没有这两项；
- 右边缘 10px 的浅灰条带是截图越过窗口客户区（1500 窗口里客户区仅 1478×1040，
  DWM 边框 11px）拍到的桌面残影，不是页面缺陷，本节不改。

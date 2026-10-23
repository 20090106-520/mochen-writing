# 任务清单 · 项目管理面板改读作品库真身

## T1 面板换数据源（ProjectSettingsPanel.vue）

- [x] 删 `useProjectManagerStore`、`formatCharCount` 两个 import 与 `pm` 实例
- [x] `currentBookTitle` 改读 `book.meta?.title ?? null`
- [x] `onMounted` 调 `void book.loadRecentBooks()`
- [x] 最近作品 `v-for` 改用 `book.recentBooks`，key 用 `entry.rootPath`
- [x] 行点击 `switchProject(entry)` → `await book.openBook(entry.rootPath)`
- [x] 行移除 → `await book.forgetRecentBook(entry.rootPath)`，aria-label 照旧
- [x] 高亮判据改 `book.rootPath === entry.rootPath`
- [x] 「打开作品目录」改调 `book.pickAndOpen()`
- [x] 元信息只留 `formatTime(entry.lastOpenedAt)`（ISO 字符串先转时间戳）
- [x] 顶部注释改成「真身 = 主进程 recent-books.json 的镜像」

## T2 守卫测试

- [x] `char-count-wiring.test.ts`：`PANELS` 去掉 `ProjectSettingsPanel.vue`，同步注释口径
- [x] `project-settings-wiring.test.ts`（新）：
  - 脚本不含 `useProjectManagerStore`
  - 模板含 `book.recentBooks` / `openBook(` / `forgetRecentBook(` / `pickAndOpen(`
  - 空态 `v-else` 与 `recentBooks.length === 0` 同一条链
- [x] 变异：① 列表改回 `pm.sortedProjects` → 红；② `pickAndOpen` 改回 `pickBookDirectory` → 红；还原后全绿


## T3 门禁与真机

- [x] `prettier --write` 改动的源码与测试
- [x] `corepack pnpm verify` → `VERIFY_EXIT=0`（386 文件 / 5062 passed | 2 skipped）
- [x] 真机 1500×1051：设置 → 项目管理显示《海雾手记》当前作品 + 最近作品含《海雾手记》；截图留证
- [x] 台账追加「第一百五十二节」
- [x] 窗口还原 2400×1400 @ (80,80)；不 commit、不 push


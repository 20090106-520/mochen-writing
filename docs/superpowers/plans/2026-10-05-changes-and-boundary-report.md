# 改稿历史与回滚 + 白屏根因（2026-10-05）

本轮两件事，都是从「真机跑一次」起的头：

1. **补上一个一直缺着的功能**：改稿历史与回滚——「AI 动手改了稿，改坏了怎么办」此前在产品里没有答案；
2. **修一个此前埋着的架构地雷**：渲染层从 `@mochen/fs-store` 的 barrel 取两个纯函数，
   等于把五个 Node 模块一起塞进浏览器 bundle。功能一落地就变成首屏白屏。

---

## 一、改稿历史与回滚

### 为什么说它一直缺着

`docWrite` 每次覆盖正文前都会把改前内容存成 `.mochen/changes/<时间戳>/<原路径>.bak`，
并把那条句柄挂上 `DocWriteResult.backupRelPath` 一路传回渲染层。
**但从头到尾没有任何一处读得回它**——备份只是一堆躺在盘上的死文件，
而 spec 与用户心智里「AI 改稿」天然带着「能不能退回去」这个问题。

### 全链

| 层 | 文件 | 内容 |
| --- | --- | --- |
| fs-store | `packages/fs-store/src/changes.ts` | `listChanges` / `readChange` / `restoreChange` / `targetOfBackup` |
| fs-store | `packages/fs-store/test/changes.test.ts` | 13 用例（含 junction 越界；两条文件软链用例在 `win32` 跳过并注明原因） |
| contracts | `packages/contracts/src/changes.ts` | `ChangeEntry`（跨进程形状，fs-store 从这里转出，不许各写一份） |
| contracts | `packages/contracts/src/ipc.ts` | 三条通道 + `RendererApi` 三个方法 |
| preload | `apps/desktop/src/preload/renderer-api.ts` | `listChanges` / `readChange` / `restoreChange` |
| 主进程 | `apps/desktop/src/main/changes-service.ts` | 收「没开书」的语义 + 把错误收成中文（7 用例） |
| 渲染层 | `stores/useBookStore.ts` | `changeList` / `changeHistory` / `changePreview` / `changesBusy` + 五条动作 |
| 渲染层 | `components/ChangeHistoryPanel.vue` | 浮层（Teleport + `useComposerContextPopover`） |
| 渲染层 | `utils/change-history.ts` | 文案层（时间戳、体积、计数）——`.vue` 零覆盖，所以文案住在 `.ts` |

### 三个不肯让步的判定

1. **回滚先看改前**。不摆预览就给一颗「回滚」太危险：点列表行只是 `peekChange`，
   按钮要选中 + 改前正文已经读回来才在（`change-history-wiring.test.ts` 钉死）。
2. **指纹现读现传**。`restoreChange` 先 `readDoc` 拿**盘上此刻**的指纹再发 IPC——
   传打开文稿时那个旧的，主进程那道闸就白设了。
3. **回滚也留退路**。覆盖之前先给当前内容再存一份，所以「撤销撤销」还能回来（面板里说这句不是玩笑）。

路径安全全部下沉在 fs-store，三道守卫：备份句柄的**形状**、备份 realpath 仍在 `.mochen/changes` 之下、
恢复目标文稿的 realpath 仍在书根之下。`chapters/01.md` 完全可能是个指向书外的软链，逐字检查看不出来。

### 真机（CDP，`--remote-debugging-port=9222`）

`node .mochen-tmp/p2/changes-verify.mjs`：打开书 → 真 `docWrite` 把正文改坏 → 开面板 → 点开最新一条 → 回滚。

```
改坏:   {"写坏成功": true, "现在正文": "…\n这一句是手滑改坏的，待会儿要回滚掉。\n"}
面板:   {"面板开着": true, "列表条数": 2}
看改前: {"预览里有没有那句改坏的": false}
回滚:   {"notice": "已回滚 chapters/01-开局.md 到改前的样子。",
        "盘上还有那句改坏的吗": false, "回滚后列表条数": 3}
```

「回滚后列表条数 +1」就是第 3 条判定在真实盘上留下的痕迹：回滚自己也存了一份。

### 真机逮到的两个产品可见缺陷（都已修）

**① 回滚成功的提示被覆盖掉。** `restoreChange` 先写 `已回滚 …`，紧接着 `await this.reloadActive()`
自己又写一句 `已重载盘上内容`——功能对了，用户从头到尾看不见「已回滚」三个字。
写源码的接线测试抓不到这种顺序问题，所以补了 store 层**行为**测试
（`stores/useBookStore.changes.test.ts`，10 条），先红后绿：修之前 10 条里正好红那一条。

**② 浮层高度不可控，主操作掉到折叠线以下。** 量出来的（`.mochen-tmp/p2/panel-geometry.mjs`）：

```
面板 clientHeight 379 / scrollHeight 511（CSS 里的 520 被行内 maxHeight 盖掉）
回滚按钮 bottom − 面板 bottom = +120px   ← 在折叠线以下 120px
```

`useComposerContextPopover` 按锚点周围的空余给 `maxHeight`，所以调 CSS 像素 futile。
改成结构性的：`.change-history-restore { position: sticky; bottom: 0 }`。
复测：`按钮在折叠线内 = true`，差 **−13px**。

顺带修了两处同源的现象：列表被 flex 压成「7 条只露 1 条」（面板是可滚 flex 列，列表默认会被压缩），
以及头部补了一枚计数 chip（`9 次改动`）替滚出视野的那些条数作证。

---

## 二、白屏根因：渲染层 import 了一个 Node 包的 barrel

### 现象

`#app.__vue_app__` 取不到，页面不挂载。`tsc` 与 `electron-vite build` **全绿**。

### 根因

`DocumentPane.vue` 与 `ExportDialog.vue` 从 `@mochen/fs-store` 取 `markdownToSimpleHtml`
与三个导出纯函数，而 `packages/fs-store/src/index.ts` 是 `export *` 全包的：

```ts
export * from "./changes.js";   // ← 本轮新增
export * from "./create.js";
export * from "./read-write.js";
export * from "./scan.js";
export * from "./skills.js";
```

于是 `changes.ts` 顶层的 `const CHANGES_DIR = path.join(".mochen", "changes")`
在浏览器里执行成 `__vite_browser_external.default.join(...)` → `TypeError` → 整页白屏。

**这不是「`changes.ts` 写错了一行」**：barrel 里任何模块顶层只要有一行 `path.join` 就会炸，
此前没炸只是因为**还没有人写过那一行**。构建期零线索，静态分析只会把人带偏。

### 修法

1. `packages/fs-store/package.json` 加**显式子路径导出** `"./export-service": "./src/export-service.ts"`
   （该模块零 `node:` 依赖，是唯一渲染层需要的部分）；两处渲染层 import 改走子路径。
2. 产物验证：修完后 `index-*.js` 里 `__vite_browser_external` 出现 **0 次**。

### 新增门禁（`tools/check-package-boundary.mjs`）

渲染层的包边界，现在有三条规则：

1. 渲染层禁止 import `@mochen/agent-runtime`（从组件级升为全目录级）；
2. 渲染层禁止 import `@mochen/fs-store` 整包（barrel 会把 Node 模块拖进 bundle）；
3. 渲染层若 import `@mochen/fs-store/<sub>`，该子路径必须在 `exports` 里声明，
   且**它与它在包内的传递依赖**一个 `node:` 都不许碰。

第 3 条才是承重的那条：入口模块干净但它 import 的东西脏，一样白屏。
守卫先对现状报红（正是那两处），修完转绿。自检 4 条
（`tools/boundary.selfcheck.test.mjs`），变异实测：

```
MUTATION_EXIT=1
components\DocumentPane.vue: @mochen/fs-store/export-service 的传递依赖 src\zz-mutation-probe.ts 用了 node:，会白屏
components\ExportDialog.vue: 同上
RESTORED_EXIT=0 边界检查通过   identical=true
```

---

## 三、顺带修的一个「为错误的理由通过」的断言

给 `flex: none` 加断言后，自跑变异**没有报红**——13 条全过。查下去是
`ruleBlock()` 读 CSS 原文不剥注释，而规则正文里那行注释「flex: none 是必需的」
把断言喂饱了。修的是读取器（`utils/vue-source-reader.ts` 的 `ruleBlock` 改为剥注释后返回），
不是变异。修完同一条变异精确报红：13 条里只红那一条。

> 顺带记一个自己踩的坑：那次修读取器时我在 JSDoc 里写了字面量 `*/`，把块注释提前闭合，
> `vue-source-reader.ts` 直接语法错误，vitest 表现为「no tests」而不是明确的解析报错——
> 看到 "no tests" 先怀疑被你改坏的那个共享文件。

---

## 门禁

`corepack pnpm verify` → **135 文件 / 1519 用例**，`VERIFY_EXIT=0`；
`corepack pnpm build` → `BUILD_EXIT=0`。

## 边界（如实记，不拔高）

- 验的是 Electron **开发模式**（`pnpm exec electron .`），没有打包后跑。
- 只验了**单篇文稿、单机、无并发**。多篇交替改、别人同时在外部编辑器改（stale 分支）
  只有自动化覆盖，没有真机证据。
- 备份目录**没有上限也没有清理策略**：`listChanges` 会把整本书历次改稿都列出来，
  几百条之后这个浮层会变长（现在靠计数 chip 与 132px 滚动区兜住，但没做分页/时间分组）。
  长期方案是给 `.mochen/changes` 加保留策略（例如只留最近 N 天 / 最近 M 条）——
  **这是产品决定，本轮没做**。
- `restoreChange` 走的是**同款指纹闸**，所以「两个人同时改同一篇，后一个会被拒」是设计内行为，
  但真机上没跑出这个并发场景。

## 复现

```bash
corepack pnpm verify && corepack pnpm build
cd apps/desktop && corepack pnpm exec electron . --remote-debugging-port=9222
node .mochen-tmp/p2/changes-verify.mjs    # 改坏 → 面板 → 回滚，全程真 IPC
node .mochen-tmp/p2/panel-geometry.mjs    # 量面板几何：按钮在不在折叠线内
```

书目录见 `.mochen-tmp/f6/bookdir.txt`（临时区，不进版本库——本仓 docs 下零图片文件）。

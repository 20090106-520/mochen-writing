# F-6 真机验收记录（2026-10-05）

补的是 Plan 2 冒烟报告 §F-6 第 ② 条点名的那一条：**杀掉进程重启后，中栏能还原线程与待审卡**。
代码与自动化在此之前已闭合（主进程 `loadSession` 三态、渲染层水合八规则、`agent-service-load-session.test.ts`
里那条「模拟重启」的只读断言），本文只记**真机这一层**。

## 手法：为什么是 CDP 而不是点按钮

计划里的验收口径是「杀掉进程重启后中栏能还原」。本机没有 `computer_*` 那类桌面自动化工具
（`tool_search` 也搜不到），所以改走 Electron 自带的 `--remote-debugging-port=9222`：
用 CDP 直连**真实渲染层**，通过 `Runtime.evaluate` 调**渲染层 Pinia 的真动作**
（`book.createBook` / `book.openDocTab` / `agent.send`），并用 `Page.captureScreenshot` 取真实截图。

这条路比点按钮更强：它验的是同一份渲染层代码、同一份 IPC、同一块屏幕，
而且**状态是可读回的精确值**而不是「看起来对」。

全程未使用主进程内部接口驱动被测行为：造数据与验数据都只经 `window.mochen` 与 store 动作。

## 环境

- 桩：`tools/mock-provider.mjs --port 8899`（**不用默认的 8787**——那上面已经有一个 2026-10-02 起就在跑的
  未知 node 进程，PID 44136，且它对 `/v1/models` 回 404，不是本仓这个桩；没动它）
- 书目录：临时目录 `%TEMP%\mochen-f6-run1-5mUO49`
- 权限档：`full-access`（新书默认值）

## 第一轮（造数据）

操作序列：`book.createBook` → `createDoc(chapters/01-开局.md)` → `readDoc` 拿指纹 →
`writeDoc` 铺正文 → `book.openBook` → `book.openDocTab` → `agent.startListening` → `agent.send("改紧")`。

> **夹具坑（不是产品行为）**：桩的补丁锚点写死是「雾从海面涌上来。」。新书文稿是空的，
> 第一次跑时 `applyPatch` 如实回「文中找不到锚点…提案没有生成，文件未改动」——
> 正文里没有那句话而已。铺上正文后同一路径一次成功。

终态（读回 store）：

```json
{"cards":1,"statuses":["pending"],"items":5,"lastError":""}
```

屏幕上：提案卡展开，diff 正确着色（删除行红 / 新增行绿），卡头「第 1 轮 · 改紧 |
chapters/01-开局.md | 锚点替换 | 待审批」，页脚「1 条待审」。

## 杀掉进程

`Get-Process electron | Stop-Process -Force` → 进程数 4 → 0。**不是关窗口，是真的杀。**

## 第二轮（全新进程，验还原）

新起一个 Electron，只做用户在重启后会做的两件事：`book.openBook` + `book.openDocTab`。
**刻意不调** `ensureHydrated` / `loadSession`——这条用例要验的正是「界面自己会水合」。

打开前的屏幕上，中栏是空的（`还没有打开作品目录`）——F-6 的原始现象。

| 时点 | `hydrated` | `hydrating` | items | 提案卡 |
| --- | --- | --- | --- | --- |
| 打开书的当下 | false | **true** | 0 | 0 |
| 自动水合后 | **true** | false | **5** | 1 条 `expired` |

还原出的整条轮次（`itemTypes`，顺序即时间线）：

```json
["user-message","reasoning","tool-call","proposal","message"]
```

提案卡是**同一个 id**（`43f18bb7-29b9-45d2-a296-0cd9b6c847e3`，与第一轮截图一致），
`status: "expired"`，`hasDiff: false`（回放不打 diff IPC——规则4 的 M1）。

屏幕上：中栏完整还原「你 改紧 / 思考摘要 / 提出改稿提案 / 提案已经挂在下面，等你点批准才落盘。」，
提案卡折叠在分组标题「▶ 上次会话未处理 · 1 条」里，**页脚从「1 条待审」变回「就绪」**。

## 结论

F-6 真机闭合。三条口径逐条对上：

1. **中栏能还原线程**——整轮 5 条事件按时间线顺序复原，不是只剩模型上下文。
2. **能还原待审卡**——卡在，但落在 `expired` 分组里。
3. **Plan 3 spec D1「回放绝不复活可批准的待审队列」**——`status: expired`、页脚不再报「1 条待审」，
   折叠分组标题如实写「上次会话未处理」。没有出现「重启后点一下就能批准昨天那条」。

## 顺带被这条真机验到的

`createBook` 落下来的 `permissionMode` 是 **`full-access`**，正是 contracts 的 `DEFAULT_PERMISSION_MODE`
（2026-10-05 修掉的那处偏离：此前写死 `read-only`）。桩能在全开档下派提案、真机跑通审批链，
反过来证明新书默认档已经不再把新用户卡在只读档上。

## 边界（如实记，不拔高）

- 这一轮验的是**一条线程、一张卡**。多线程、多卡、历史面板指名 `sessionId` 点开某一条，仍只有自动化证据。
- 验的是 Electron **开发模式**（`pnpm exec electron .`），没有打包后跑。
- 提案卡的 diff 在回放里不取回（`hasDiff: false`），这是既定设计（避免回放打 diff IPC），
  但**用户在重启后看不到那条 diff**。折叠分组里那张卡只有标题，没有内容。
  这是 D1 的已知取舍，不是本轮新发现的问题；要不要给 expired 卡也取一次 diff，属于产品决定。
- 截图留在 `.mochen-tmp/f6/`（临时区，不进版本库——本仓 docs 下零图片文件）。
  需要复看可以重跑 `.mochen-tmp/f6/run1b.mjs` 与 `run2.mjs`。

## 复现

```bash
node tools/mock-provider.mjs --port 8899          # 桩
cd apps/desktop && corepack pnpm exec electron . --remote-debugging-port=9222
node .mochen-tmp/f6/run1b.mjs                      # 第一轮：造数据 + 截图
# Get-Process electron | Stop-Process -Force       # 杀进程
# 重起 electron，同样带 --remote-debugging-port
node .mochen-tmp/f6/run2.mjs                       # 第二轮：验还原 + 截图
```

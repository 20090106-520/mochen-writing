# 第三方来源与署名（Attribution）

本项目的三栏工作台**布局、主题与图标层**移植自 deepwrite（Apache License 2.0）。
按该许可证第 4 条的要求，此处列明来源、版本、被移植的文件与所作出的修改。
完整许可证原文见仓库根目录的 `LICENSE-DEEPWRITE.txt`。

- 上游仓库：https://github.com/20090106-520/deepwrite
- 移植基线提交：`7229622`（`fix: keep the model list credential out of the request URL`）
- 上游版本号：`1.5.6`
- 移植日期：2026-10-01

## 被移植的文件

| 本项目路径                                                                                                           | 上游路径                                                                                               | 上游行区间                                 | 所做的修改                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/renderer/src/styles.css`                                                                           | `apps/desktop/src/renderer/src/styles.css`                                                             | 7–232                                      | 改为 `@import` 五个 partial；其余 token/reset/`.desktop-shell`/`.pane-resizer` 原样                                                                                                                                            |
| `apps/desktop/src/renderer/src/styles/conversation-pane.css`                                                         | 同上                                                                                                   | 417–678                                    | 原样                                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/styles/editor-pane.css`                                                               | 同上                                                                                                   | 2662–2955、3063–3243                       | 原样，仅裁去本项目尚无对应 markup 的选择器                                                                                                                                                                                     |
| `apps/desktop/src/renderer/src/styles/dialog.css`                                                                    | 同上                                                                                                   | 3244–3298、3358–3419、3534–3594、3906–3913 | 原样                                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/styles/theme-runtime.css`                                                             | 同上                                                                                                   | 4742–5120                                  | 原样（暗色 token + `html[data-theme]` 覆盖 + reduced-motion）                                                                                                                                                                  |
| `apps/desktop/src/renderer/src/styles/left-nav.css`                                                                  | 同上                                                                                                   | 左栏导航段                                 | 原样                                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/types/icons.ts`                                                                       | `apps/desktop/src/renderer/src/types/icons.ts`                                                         | 全文                                       | 原样                                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/components/AppIcon.vue`                                                               | `apps/desktop/src/renderer/src/components/AppIcon.vue`                                                 | 全文                                       | 仅改 import 路径；其 `logo` 分支已删除，品牌标记改用 `assets/brand/` 下的墨宸龙头图（见下节）                                                                                                                                  |
| `apps/desktop/src/renderer/src/composables/appearanceThemeRuntime.ts`                                                | 同名文件                                                                                               | 全文                                       | 仅改 import 路径为 `@mochen/contracts`                                                                                                                                                                                         |
| `apps/desktop/src/renderer/src/utils/panePointerCapture.ts`                                                          | 同名文件                                                                                               | 全文                                       | 原样                                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/utils/transientScrollbar.ts`                                                          | 同名文件                                                                                               | 全文                                       | 原样                                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/utils/rightPanePreferences.ts`                                                        | 同名文件                                                                                               | 1–24、56–123                               | 存储键改为 `mochen:right-pane-preferences:v1`，删去本项目没有的阶段文稿类型                                                                                                                                                    |
| `apps/desktop/src/renderer/src/stores/layoutStore.ts`                                                                | `apps/desktop/src/renderer/src/stores/layoutStore.ts`                                                  | 分栏相关段                                 | 删去其功能导航（`layoutFeatureNavigation`）依赖；本地声明 `AppView`                                                                                                                                                            |
| `apps/desktop/src/renderer/src/stores/layoutStore.test.ts`                                                           | 同名测试                                                                                               | 全文                                       | 删去 4 条功能导航断言，其余原样（11 用例全绿，用于证明分栏行为与上游一致）                                                                                                                                                     |
| `packages/contracts/src/appearance.ts`                                                                               | `packages/contracts/src/appearance.ts`                                                                 | 3–316                                      | 裁去其 Envelope 命令段与 `./envelope` 依赖，补回 `import { z } from "zod"`                                                                                                                                                     |
| `apps/desktop/src/renderer/src/components/{LeftSidebar,CenterColumn,DocumentPane,SaveConflictDialog}.vue`、`App.vue` | `LeftSidebar.vue` / `TreeNodeItem.vue` / `RightEditorPane.vue` / `WorkspaceShell.vue` 的模板与类名     | 见各文件首行注释                           | **仅复用其 DOM 结构、类名与交互约定**；数据源、store 接线与业务分支为本项目自研。上游同名 `.vue` 单文件 1083–2763 行，超本项目 800 行门禁且绑定其特有功能，故未整文件搬运                                                      |
| `apps/desktop/src/renderer/src/components/AgentTimeline.vue`                                                         | 上游对话卡的 `message` / `message-body` 类名与其 DOM 约定（定义在其样式内）                            | 不适用（只借类名与结构，未搬样式规则行）   | Plan 2 新增的中栏四层时间线组件：类名沿用上游以复用同一套卡内排版，**卡片外观与行轨道由自有 `styles/agent-pane.css` 定义**，数据归约全自研（`utils/timeline.ts`）。该文件首行注释自述「见 ATTRIBUTION.md」，此行即该指认的落点 |
| `apps/desktop/src/renderer/src/components/ProviderSettings.vue`                                                      | 上游弹窗骨架类名 `dialog-backdrop` / `workspace-dialog` / `dialog-actions`（定义在其 `dialog.css` 内） | 不适用（只借骨架类名）                     | Plan 2 新增的密钥设置弹窗：沿用同一套弹窗骨架与按钮区类名，字段、掩码与保存链路全自研（明文只进主进程，spec §8）；该文件首行注释自述骨架来源，此行即其落点                                                                     |

## 不属于移植范围

`packages/contracts` 的书籍/提案/权限契约、`packages/fs-store` 全部、`apps/desktop/src/main` 与
`src/preload` 全部、`useBookStore`、`useAgentStore`、目录选择器 IPC —— 都是按本项目自己的数据模型从零写的实现，
没有搬运上游代码行。中栏与卡片的样式 `apps/desktop/src/renderer/src/styles/agent-pane.css` **也是自有样式**
（其首行注释即声明「未移植 deepwrite 类名」，只复用主题变量），别把它读成移植产物；
它确实在 `.conversation-pane` 这个上游类名上重写了四行轨道（该类名所属的 `conversation-pane.css` 才是移植件），
这属于「在同一宿主类名上覆盖自有规则」，不是搬运。

上表是 2026-10-02 复核过一轮的清单：源码里凡首行注释自述沿用上游类名/骨架的文件都能在表内找到对应行
（`AgentTimeline.vue`、`ProviderSettings.vue` 两条就是这次补的——此前它们的注释指向本文件却没有对应条目，
是断链而非漏项）。仍不声称「天然穷尽」：**新增或改动 UI 文件时，只要复用了上游类名或结构，必须同一次提交里在此登记。**
不在表内的即非移植产物。

## 品牌资产（与 deepwrite 无关）

| 文件                                                           | 来源             | 说明                                                                                                                       |
| -------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/renderer/src/assets/brand/mochen-lockup.jpg` | 用户提供的品牌图 | 1254×1254 JPEG，md5 `9a3e4d26b535a5b0b353cf611e97d955`；**原样使用，不裁切不重绘**，左栏品牌标记与中栏智能体头像都直接引它 |
| `apps/desktop/resources/icon.ico`                              | 由上一行整幅转出 | 仅做格式转换与重采样（OS 要求 ICO 容器），构图/文字/画框一字未动；7 尺寸 16/24/32/48/64/128/256，主进程 `BrowserWindow` 用 |
| `tools/build-brand-icons.ps1`                                  | 本项目自研       | 上述转换脚本，只用 Windows 自带 GDI+（System.Drawing），不下载依赖；不做任何裁切或绘制                                     |

按"用户持有该图"记录。若日后证实这张图是从别处取得而非本项目方生成，需按 deepwrite 同一办法补署名或替换。

## 关于"完全属于自己"的说明

Apache-2.0 **允许**商用、修改与再分发，但有两个不可放弃的义务：保留版权声明与许可证副本、
在改动处标注修改说明。本项目已在上表逐条注明来源与本文件的对应行，并为绝大多数移植文件加了头部注释
（**一处例外**：`apps/desktop/src/renderer/src/styles/left-nav.css` 按本表登记为原样移植，但文件内没有
自述注释——2026-10-02 复核时发现，补注释属后续 chore，此处先如实记下）。
这些 UI 资产因此是"合法持有、注明来源的第三方代码"，而非可宣称原创的自有代码。若日后需要对外声明
"全部代码均为自研"，必须先把上述文件替换为完全自写的实现。

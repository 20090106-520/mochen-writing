# 第三方来源与署名（Attribution）

本项目的三栏工作台**布局、主题与图标层**移植自 deepwrite（Apache License 2.0）。
按该许可证第 4 条的要求，此处列明来源、版本、被移植的文件与所作出的修改。
完整许可证原文见仓库根目录的 `LICENSE-DEEPWRITE.txt`。

- 上游仓库：https://github.com/20090106-520/deepwrite
- 移植基线提交：`7229622`（`fix: keep the model list credential out of the request URL`）
- 上游版本号：`1.5.6`
- 移植日期：2026-10-01

## 被移植的文件

| 本项目路径                                                                                                           | 上游路径                                                                                           | 上游行区间                                 | 所做的修改                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/renderer/src/styles.css`                                                                           | `apps/desktop/src/renderer/src/styles.css`                                                         | 7–232                                      | 改为 `@import` 五个 partial；其余 token/reset/`.desktop-shell`/`.pane-resizer` 原样                                                                                       |
| `apps/desktop/src/renderer/src/styles/conversation-pane.css`                                                         | 同上                                                                                               | 417–678                                    | 原样                                                                                                                                                                      |
| `apps/desktop/src/renderer/src/styles/editor-pane.css`                                                               | 同上                                                                                               | 2662–2955、3063–3243                       | 原样，仅裁去本项目尚无对应 markup 的选择器                                                                                                                                |
| `apps/desktop/src/renderer/src/styles/dialog.css`                                                                    | 同上                                                                                               | 3244–3298、3358–3419、3534–3594、3906–3913 | 原样                                                                                                                                                                      |
| `apps/desktop/src/renderer/src/styles/theme-runtime.css`                                                             | 同上                                                                                               | 4742–5120                                  | 原样（暗色 token + `html[data-theme]` 覆盖 + reduced-motion）                                                                                                             |
| `apps/desktop/src/renderer/src/styles/left-nav.css`                                                                  | 同上                                                                                               | 左栏导航段                                 | 原样                                                                                                                                                                      |
| `apps/desktop/src/renderer/src/types/icons.ts`                                                                       | `apps/desktop/src/renderer/src/types/icons.ts`                                                     | 全文                                       | 原样                                                                                                                                                                      |
| `apps/desktop/src/renderer/src/components/AppIcon.vue`                                                               | `apps/desktop/src/renderer/src/components/AppIcon.vue`                                             | 全文                                       | 仅改 import 路径；`logo` 分支换为自绘漩涡，不引用其品牌图片                                                                                                               |
| `apps/desktop/src/renderer/src/composables/appearanceThemeRuntime.ts`                                                | 同名文件                                                                                           | 全文                                       | 仅改 import 路径为 `@abyss/contracts`                                                                                                                                     |
| `apps/desktop/src/renderer/src/utils/panePointerCapture.ts`                                                          | 同名文件                                                                                           | 全文                                       | 原样                                                                                                                                                                      |
| `apps/desktop/src/renderer/src/utils/transientScrollbar.ts`                                                          | 同名文件                                                                                           | 全文                                       | 原样                                                                                                                                                                      |
| `apps/desktop/src/renderer/src/utils/rightPanePreferences.ts`                                                        | 同名文件                                                                                           | 1–24、56–123                               | 存储键改为 `abyss:right-pane-preferences:v1`，删去本项目没有的阶段文稿类型                                                                                                |
| `apps/desktop/src/renderer/src/stores/layoutStore.ts`                                                                | `apps/desktop/src/renderer/src/stores/layoutStore.ts`                                              | 分栏相关段                                 | 删去其功能导航（`layoutFeatureNavigation`）依赖；本地声明 `AppView`                                                                                                       |
| `apps/desktop/src/renderer/src/stores/layoutStore.test.ts`                                                           | 同名测试                                                                                           | 全文                                       | 删去 4 条功能导航断言，其余原样（11 用例全绿，用于证明分栏行为与上游一致）                                                                                                |
| `packages/contracts/src/appearance.ts`                                                                               | `packages/contracts/src/appearance.ts`                                                             | 3–316                                      | 裁去其 Envelope 命令段与 `./envelope` 依赖，补回 `import { z } from "zod"`                                                                                                |
| `apps/desktop/src/renderer/src/components/{LeftSidebar,CenterColumn,DocumentPane,SaveConflictDialog}.vue`、`App.vue` | `LeftSidebar.vue` / `TreeNodeItem.vue` / `RightEditorPane.vue` / `WorkspaceShell.vue` 的模板与类名 | 见各文件首行注释                           | **仅复用其 DOM 结构、类名与交互约定**；数据源、store 接线与业务分支为本项目自研。上游同名 `.vue` 单文件 1083–2763 行，超本项目 800 行门禁且绑定其特有功能，故未整文件搬运 |

## 不属于移植范围

`packages/contracts` 的书籍/提案/权限契约、`packages/fs-store` 全部、`apps/desktop/src/main` 与
`src/preload` 全部、`useBookStore`、目录选择器 IPC —— 都是按本项目自己的数据模型从零写的实现，
没有搬运上游代码行；上表已穷尽所有实际移植的文件，不在表内的即非移植产物。

## 关于"完全属于自己"的说明

Apache-2.0 **允许**商用、修改与再分发，但有两个不可放弃的义务：保留版权声明与许可证副本、
在改动处标注修改说明。本项目已逐文件加头部注释并维护本文件，因此这些 UI 资产是
"合法持有、注明来源的第三方代码"，而非可宣称原创的自有代码。若日后需要对外声明
"全部代码均为自研"，必须先把上述文件替换为完全自写的实现。

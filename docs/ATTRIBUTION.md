# 第三方组件声明

本项目为自研作品。下列文件包含参考开源项目 deepwrite 而形成的同源实现，其版权声明按
Apache License 2.0 的要求集中记录在本文件，许可证原文见仓库根目录的 `LICENSE-DEEPWRITE.txt`
（该文件仅是许可证文本副本，按许可证要求随仓库保存）。

- 上游项目：deepwrite（https://github.com/20090106-520/deepwrite ，v1.5.6；另参考其后续
  https://github.com/swjybky/deepwrite 的设置中心骨架）
- 参考日期：2026-10-01 / 2026-10-04

## 与 deepwrite 同源的文件

| 本项目路径                                                                                                                                                                                                               | 来源                                                                        | 说明                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `apps/desktop/src/renderer/src/styles/{theme-runtime,left-nav,conversation-pane,conversation-history,editor-pane,dialog}.css`                                                                                            | 上游同名样式文件                                                            | 主题 token、三栏布局、弹层骨架等样式段   |
| `apps/desktop/src/renderer/src/styles/agent-pane.css`（`deepwrite-composer-card` 标记之后）                                                                                                                              | 上游 styles.css 的 composer 段                                              | 输入卡骨架；token 换本仓别名             |
| `apps/desktop/src/renderer/src/styles/interaction.css`（`.composer-chip*` 段）                                                                                                                                           | 上游 config-trigger 样式                                                    | 触发器原值                               |
| `apps/desktop/src/renderer/src/styles/settings-page.css`                                                                                                                                                                 | 上游 settings-page.css（swjybky v1.6.3）                                    | 设置中心骨架样式；token 换本仓别名       |
| `apps/desktop/src/renderer/src/types/icons.ts`、`components/AppIcon.vue`                                                                                                                                                 | 上游同名文件                                                                | 48 枚字形（本仓自造 `heading` 一枚）     |
| `apps/desktop/src/renderer/src/composables/appearanceThemeRuntime.ts`、`useComposerContextPopover.ts`                                                                                                                    | 上游同名文件                                                                | import 路径改 `@mochen/contracts`        |
| `apps/desktop/src/renderer/src/utils/{panePointerCapture,transientScrollbar,rightPanePreferences,inline-reference-menu,session-row-action,permission-chip,composer-context,vue-source-reader}.ts` 等                     | 上游同名文件或其判定逻辑                                                    | 部分按本仓数据模型裁改，各文件头注释自述 |
| `apps/desktop/src/renderer/src/stores/layoutStore.ts`（分栏段）、`useReferenceMenuStore.ts`                                                                                                                              | 上游同名文件                                                                | 删功能导航依赖                           |
| `apps/desktop/src/renderer/src/components/{LeftSidebar,CenterColumn,DocumentPane,SaveConflictDialog,ComposerBox,ComposerContextBar,ComposerContextMenu,ComposerReferenceMenu,ConversationHistoryMenu,AgentTimeline}.vue` | 上游同名/对应组件的模板与类名                                               | 数据源与业务接线为本项目自研             |
| `apps/desktop/src/renderer/src/components/SettingsPage.vue`、`ProviderSettings.vue`、`HotkeysPanel.vue`、`AboutPanel.vue`                                                                                                | 上游 SettingsPage 骨架与 settings-card/settings-item 类名（swjybky v1.6.3） | 分类规模、表单与全部数据通路为本项目自研 |
| `packages/contracts/src/appearance.ts`、`per-run.ts`                                                                                                                                                                     | 上游同名文件                                                                | 裁去 Envelope 段，zod 补回               |
| `packages/agent-runtime/src/per-run-fields.ts`                                                                                                                                                                           | 上游同名文件                                                                | 字段语义对齐                             |

## 本项目自研（未复用上游代码行）

`packages/contracts` 的书籍/提案/权限契约其余部分、`packages/fs-store` 全部、
`apps/desktop/src/main` 与 `src/preload` 全部、`useBookStore`、`useAgentStore`、`useProviderStore`、
模型配置的保存链路（明文只进主进程）、目录选择器 IPC、粒子画布引擎（canvas-ui，MIT，见下）、
中栏时间线与提案卡的数据归约。上表未尽事项以各文件头注释自述为准。

## 品牌资产（第三方无关）

- `apps/desktop/src/renderer/src/assets/brand/mochen-lockup.jpg`：用户提供的品牌图，原样使用。
- `apps/desktop/resources/icon.ico`：由上一行整幅转出（格式转换与重采样）。
  生成器是 `tools/build-brand-icons.mjs` + `tools/ico-container.mjs`（跨平台，零新依赖）；
  盘上这枚是 2026-10-12 之前那份 Windows 专用脚本的产物，换像素口径属于换品牌资产，要用户点头。

## 皮肤整窗画面（`art` 层，`public/skins/`）

- `abyss-hall-night.webp`、`shallow-hall-day.webp`：**墨宸自有的位图**（带人物立绘的那一族），
  由同名 jpg 只做**编码转换**得到——不裁切、不重绘、不另生成，遵循
  「用户提供的品牌图原样使用」那条既定规则。
- `book-boat-{day,night}.webp`、`lamp-tower-{day,night}.webp`、`ink-pool-{day,night}.webp`：
  **墨宸原创画面 / 本仓自有**（2026-10-17 波2 换的笔，出处两句写在皮肤表上）。
  这六张由本仓自己出原画（`GenerateImage`，2560×1707），再逐张走五步——
  去右下角「AI生成」水印 → grading 拉动态范围 → 降采样 1536×1024 → 编码 webp——
  得到，无第三方素材、无外部字体、无可读文字与 logo，因此**不涉及任何许可义务**。
  存在性 / 尺寸 / 比例 / 上限由 `appearance-skin-assets.test.ts` 读盘钉住；
  构图硬规则由 `apps/desktop/scripts/check-scene-art.mjs` 的三道像素闸 G1/G2/G3 钉住。
  逐张做法与三道闸读数见 `docs/superpowers/plans/2026-10-17-skin-art-and-pane-toggle.md` 波2。
- 【2026-10-17 波2 就地更正】下面这段原文记的是**波2a 那批矢量**：那六个 `.svg` 文件
  **已从 `public/skins/` 删除**，皮肤表也不再读它们（`appearanceSkinVisual.ts` 的 `ART_FILES`
  六条扩展名改成了 `.webp`）。原文保留——它记的是那一批当时的真实做法与理由。
  照读会读成假话的一处已在下面那段的本句上注明：那句「所以这六张 SVG 由脚本可复现」，
  **主语的六个 SVG 已不存在**；而 `gen-scene-svgs.mjs` **本体仍在仓内**
  （`apps/desktop/package.json` 的 `gen:scene-svgs` 脚本、`README.md`、
  `tools/readme-claims.test.mjs`、`.archcore/architecture/entry-points.doc.md` 都还引它），
  这一波只删了它**产出的六个 `.svg`**，没有删生成器。
- 【原文照录】`book-boat-{day,night}.svg`、`lamp-tower-{day,night}.svg`、`ink-pool-{day,night}.svg`：
  **本仓库自绘**，由参数化脚本按 `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md` §2
  的构图硬规则生成，无第三方素材、无外部字体、无可读文字与 logo，因此**不涉及任何许可义务**。
  两点如实记下：
  ① 生成脚本在 `apps/desktop/scripts/`（`gen-scene-svgs.mjs`，与 `scene-palettes.mjs`、
  `check-scene-art.mjs` 同批），**已进版本库**，所以这六张 SVG 由脚本可复现，
  不再是"成品文件本身是唯一真身"；存在性仍由 `appearance-skin-assets.test.ts` 读盘钉住。
  （2026-10-15 更正：原文写的是"生成脚本住在 git-ignored 的 `.superpowers/sdd/`，不进版本库"，
  与 `git ls-files apps/desktop/scripts` 的实测不符——属"数据变了、解释还在"那一族。）
  ② 这一批走矢量是因为图像生成通路返回 403、外部位图未到位，
  **不是**「矢量就够用了」——带人物立绘的那一族仍等位图素材。

## 其他第三方库（npm 依赖）

- [canvas-ui](https://github.com/DavidHDev/canvas-ui)：MIT + Commons Clause。品牌粒子画布引擎来源，已按其 registry 源码拆分集成。
- morphicons：MIT。变形图标组件。
- lucide：ISC。图标数据。

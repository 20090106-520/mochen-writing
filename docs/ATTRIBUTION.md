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

- 【2026-10-17 第三刀｜**本节现况**，下面各段原文与旧更正记的是更早两批】`public/skins/` 此刻是
  **八张 `.jpg`**（`abyss-hall-night` / `shallow-hall-day` / `book-boat-{day,night}` /
  `lamp-tower-{day,night}` / `ink-pool-{day,night}`），**没有一张是墨宸自己画的**——
  八张全部取自 **Unsplash 人像摄影（真人女性）**，换源依据是用户 2026-10-17 那句
  「从网上寻找一点好看的真人美女图片做……**不要自己创建图片**」。
  四张母图与四组昼夜的对应（URL 形如
  `https://images.unsplash.com/photo-<id>?w=1536&h=1024&fit=crop&crop=faces&fm=jpg&q=90`）：
  - `photo-1546961329-78bef0414d7c` → `lamp-tower-day` / `lamp-tower-night`
  - `photo-1509967419530-da38b4704bc6` → `book-boat-day` / `book-boat-night`
  - `photo-1502823403499-6ccfcf4fb453` → `shallow-hall-day` / `abyss-hall-night`
  - `photo-1520813792240-56fc4a3765a7` → `ink-pool-day` / `ink-pool-night`
    落盘前**只做一步色阶重映射**（昼/夜各一组 `outLo` / `outHi` 加三通道微调，见下面那条
    「管线」说明），**不裁切构图、不重绘内容、不叠加任何元素**；编码 JPEG 质量 86，单张 112–254KB。
    **许可**：Unsplash License —— 免费用于商业与非商业用途、可修改、可再分发，无需署名
    （署名仍照记于此，见下条）。**一处必须写清**：Unsplash License 只管**照片本身**的著作权，
    **不包含被摄模特本人的肖像权 / 人格权**（Unsplash 自己的 FAQ 与 Terms 都点明
    model release 不在许可范围内）。把这四张真人人像当作产品皮肤素材分发时，
    **肖像权那一段须由分发方自行评估**，本仓库不声称已取得也不会去取得模特授权；
    若将来对外发行时这层风险不可接受，**换回自绘 / 委托素材即可**——
    枚举 id 与皮肤表 id 都故意一个字没动（见下面那条「id 为什么一个都没改」），换掉那八个文件就完事，代码零改动。
- 【2026-10-17 第三刀｜**id 为什么一个都没改**】八条 id（`abyss-hall-night` 等）是**写进用户盘上
  `theme.json` 的值**，不是显示名。改名会让老盘上那份主题 JSON 过不了 zod 而整份退回默认，
  ⇒ id 一律保留；本刀改的只有 `appearanceSkins.ts` 里的 `label` / `tagline` 八条与
  `APPEARANCE_ART_LABELS` 八档中文名（旧名 → 新名对照表写在该文件那段 ⚠️ 注释里）。
  皮肤表上那两句出处常量也随之改名：`OWN_ART_ORIGIN` / `OWN_ART_LICENSE` →
  `PHOTO_ART_ORIGIN = "Unsplash 人像"` / `PHOTO_ART_LICENSE = "Unsplash License"`。
- 【2026-10-17 第三刀｜**像素闸也换了射程与判据**】`apps/desktop/scripts/check-scene-art.mjs`
  本轮从「六张场景画 + 三道闸 G1/G2/G3」改成 **八张人像画 + 两道闸**：
  `G1` 分层桶数 ≥4（不再是原来的语义）、`G2` 全局不空（`p90 − p10 ≥ 18`）。
  原 `G2`「两缘与中段均值差 ≥10」与 `G3`「中段静 / 两缘动」对**人像**这个范畴是错的
  （肖像主体本来就在中间），两条降为观察项打印、不参与判定；汐那两张从此进闸。
- 【2026-10-17 第三刀｜**管线**】取图与落盘在**仓外临时件**里跑（`build-skinart.ps1`，
  PowerShell 5.1 ＋ `System.Drawing`）：下载 → 降采样到 128×86 量 `p10` / `p90` →
  按**色阶重映射**（不是乘增益：昼 `outLo=0.16, outHi=0.84`；夜 `outLo=0.015, outHi=0.42`，
  三通道微调 `r/g/b = 1.03/1.00/0.96`（昼）与 `0.90/1.00/1.14`（夜））→ 落 1536×1024 JPEG 质量 86。
  该脚本**未入仓**（与波2 的管线一样只存在于仓外临时件），要复跑得重写；
  本刀**没有水印要抹**（Unsplash 原图不带水印），所以波2 那套「原地柔化去水印」本轮一次都没跑。
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

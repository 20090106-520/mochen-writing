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

- 【2026-10-17 画面扩容｜**本节现况**，下面各段记的都是更早的批次】用户看完第四刀那版说
  「你那个装扮就只换了图片，其他的没有更改。我要的是全部不一样的，每一个装扮，
  而且里面图片装扮还有挂件其他东西都太少了。你都可以直接从网上搜索导入到这个里面，
  开源项目也行，不用自己创建」⇒ 画面从 8 张扩到 **16 张**，皮肤从 8 套扩到 **16 套**，
  且 16 套的（背景 / 玻璃 / 表面 / 图案）三层**逐套两两不同**——不再「只换画」。
  **新增的四组**（Safebooru `original` + `no_humans` 标签，全是风景 / 建筑插画，
  不是任何游戏 / 番剧角色），对应关系：

  | 落盘文件（昼 / 夜）         | Safebooru 索引 | 画师                | 原作地址（source）                                       | 原图      |
  | --------------------------- | -------------- | ------------------- | -------------------------------------------------------- | --------- |
  | `firefly-river-{day,night}` | 7193792        | kate_avery          | `x.com/tagsalegirl/status/1527383672197771264`           | 2048×1468 |
  | `torii-path-{day,night}`    | 7218130        | bamboo23091         | `x.com/bamboo23091/status/2108523586927595926`           | 2315×1780 |
  | `valley-cabin-{day,night}`  | 6662785        | philipp_urlich      | `artstation.com/artwork/lVn5dz`                          | 3000×1500 |
  | `sakura-stop-{day,night}`   | 6305210        | tanamachi_yoshihiro | `twitter.com/0zolvUt2323nYuS/status/1938109245687554269` | 4096×2973 |

  **索引号是回填的**：这四张取图时只落了图、没留索引，本刀用**源文件 MD5 反查 Safebooru
  `md5:` 接口**（`safebooru.org/index.php?page=dapi&s=post&q=index&tags=md5:<hash>`）
  把 id / 画师 / source 逐条回捞出来；候选里的第五条 `s-maple`（过曝被目检否决）
  同样落在 `7221047` / `esyil207`，一并记下以备复查。
  管线仍是**仓外临时件**（`mochen-skinart2/build-anime2.ps1`，PowerShell 5.1 ＋ `System.Drawing`，
  **未入仓**）：居中裁 3:2 → 1536×1024 → 昼 / 夜两组色阶重映射 → JPEG q86；
  昼版 `dayHi` 逐张 0.88~~0.97，夜版与第四刀同（`outLo=0.00, outHi=0.70`）。
  十六张随后在 `check-scene-art.mjs` 上**全过**（G1 桶数 4~~12、G2 跨度 32.9~232，反向用例仍判红）。
  **许可：仍未获再分发授权**——与第四刀那四张同一口径，皮肤表的 `license` 照写
  「未获再分发授权」（常量 `ANIME_ART_LICENSE`），本仓**不声称已取得授权**。
  **一处与第四刀不同，如实记下**：第四刀那四张的原作里可能有可读文字（路牌 / 招牌，见下面各段），
  本轮新增的四张经 contact sheet **逐张目检未见可读文字与 logo**（都是纯风景 / 建筑插画）。

- （下面这段「第四刀｜本节现况」已被上一段取代，**原文照录**。）
- 【2026-10-17 第四刀｜**本节现况**，下面各段记的都是更早的批次】`public/skins/` 此刻仍是
  **八张 `.jpg`**（文件名与上一版一字不差），但**内容换成了动漫二次元**。依据是用户把上一版
  整个否掉的那句：「**我要的是中国的真人美女图片或动漫二次元图片做装扮不要外国的**」
  （上一版是 Unsplash 上的西方模特人像，正落在被否的那一类里）。
  **中国真人照片在本机没有可用通路**：Unsplash / Pexels 的图片 CDN 可达，但两站的搜索页与
  API 全被拦（401 / 403 / Anubis 拦截），WebFetch 也取不到任何可用的中国真人照片条目，
  Pinterest / 花瓣这类中文站同样连不上。所以这一刀走**动漫二次元**，
  并且只挑 **`original` 标签的原创插画**——不是任何游戏 / 番剧的角色，避免二次版权。
  四张母图与四组昼夜的对应（索引号 / Pixiv 作品号 / 画师 / 原图尺寸）：

  | 落盘文件（昼 / 夜）                     | Safebooru 索引 | Pixiv 作品 | 画师        | 原图      |
  | --------------------------------------- | -------------- | ---------- | ----------- | --------- |
  | `shallow-hall-day` / `abyss-hall-night` | 3727591        | 94171738   | shuu_illust | 5120×2880 |
  | `book-boat-day` / `book-boat-night`     | 3908098        | 80586108   | kenzo_093   | 3000×2000 |
  | `lamp-tower-day` / `lamp-tower-night`   | 4000521        | 98260510   | sugi87      | 2000×951  |
  | `ink-pool-day` / `ink-pool-night`       | 3669783        | 76613221   | axleaki     | 2480×1400 |

  **落盘只做四步**：居中裁到 3:2 → 缩到 1536×1024 → 昼夜两组**色阶重映射** → JPEG q86
  （单张 221–492KB）。**不裁内容、不重绘、不叠加任何元素**；这四张原图**本身不带水印**，
  所以波2 那套「原地柔化去水印」本轮同样一次都没跑。**一处如实记下**：`ink-pool-*` 那张的
  原作里有一块**路牌**（`road_sign` / `holding_sign`），画面里因此可能有极小的字——
  原样保留、没有抹掉，规格单 §2 第 5 条「不许有可读文字」在这张上**没有完全满足**。
  ⚠️【2026-10-17 第四刀结项目检补充】上面只点了 `ink-pool-*` 一处；逐张回看后**还有第二处**——
  `lamp-tower-*` 那张（黄昏码头）街边有一块店铺招牌，同样属可读文字，同样**未抹除、原样保留**。
  ⇒ 「没有完全满足」那句对**这两张**都成立。原文保留。
  **许可**：**没有拿到任何再分发授权**。这四张是画师发在 Pixiv 的原创插画，Pixiv 的服务条款
  **不授予第三方再分发权**；落到皮肤表上就是 `license` 写「**未获再分发授权**」（皮肤卡上照显），
  `origin` 写「动漫插画（Pixiv 原作）」（常量 `ANIME_ART_ORIGIN` / `ANIME_ART_LICENSE`）。
  本仓**不声称已取得授权**，也不把「图能下载」当成「图能用」。若将来要对外发行时这层风险不可接受，
  **换回自绘 / 委托素材即可**——八个文件同名替换，代码零改动
  （id 与枚举自始未动，见下面那条「id 为什么一个都没改」）。

- 【2026-10-17 第三刀｜第三刀现况（**已被第四刀取代，原文照录**），下面各段原文与旧更正记的是更早两批】`public/skins/` 此刻是
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
- 【2026-10-17 第四刀｜**管线换了量尺**】取图与落盘仍是**仓外临时件**（第四刀那份叫
  `build-anime.ps1`，PowerShell 5.1 ＋ `System.Drawing`，同样**未入仓**）：居中裁到 3:2 →
  缩到 1536×1024 → 色阶重映射 → JPEG q86。与第三刀有**两处实质不同**：
  ① **量尺换成 sRGB luma 的 `p2` / `p98`**——第三刀量的是**线性亮度**，却把那两个数当成
  sRGB 端点喂给工作在 **sRGB（非线性）空间**的 `ColorMatrix`，端点本来就没对位；
  ② **夜版不能再压到 `outHi=0.42` 那一档**：像素闸 G1 要求「≥4 个 22 点亮度桶各占 ≥2% 面积」，
  而它量的是**线性亮度**——0.42 会把整幅挤进头三个桶，第三刀实测两张夜版正是这样判红
  （输出 `G1分层=3✗`）。本刀昼夜都从 0 起：昼 `outLo=0.00, outHi=0.97`
  （三通道增益 1.02/1.00/0.97），夜 `outLo=0.00, outHi=0.70`（0.84/0.98/1.20，
  冷调由蓝通道增益给）。八张随后在 `check-scene-art.mjs` 上**全过**（G1 桶数 6～9、
  G2 跨度 55～115，反向用例仍判红）。
  ⚠️【2026-10-17 第四刀结项复跑更正】上面那两个区间是**首版白天重映射**（`outLo=0.10`）那一轮量的；
  那一版被目检否决（画面发灰发平、昼夜差太小），改成 `outLo=0.00` 之后**读数随之上移**：
  本仓盘上此刻复跑得 **G1 桶数 6～12、G2 跨度 56.7～218**（四张昼版都铺满 12 桶）、
  单张体积 **226–504KB**。⇒ 上段那两个区间**已经过期**，以当场跑
  `node apps/desktop/scripts/check-scene-art.mjs` 的输出为准。原文保留，它记的是那一版读数。
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

## 皮肤窗角挂件（`ornament` 层，`public/skins/ornaments/`）

- 【2026-10-17 挂件扩容｜本节现况】窗角那枚挂件从 8 枚扩到 **16 枚**，全部取自开源 emoji 项目
  **Twemoji**（[jdecked/twemoji](https://github.com/jdecked/twemoji)，**CC-BY 4.0**；
  原由 Twitter/X 开源，后交社区维护），经 `fastly.jsdelivr.net` 导入为**仓内矢量 SVG**
  （上游路径 `assets/svg/<码位>.svg`，与上游**逐字节一致**——本仓未做任何重绘或改写）。
  **许可义务**：CC-BY 4.0 要求署名 ⇒ 下表即署名清单；对外发行时须随产品附
  `CC-BY 4.0` 的署名与许可原文链接。逐枚码位：

  | 挂件档名   | 码位    | 挂件档名       | 码位    |
  | ---------- | ------- | -------------- | ------- |
  | `whale`    | U+1F40B | `book`         | U+1F4D6 |
  | `scroll`   | U+1F4DC | `brush`        | U+1F58C |
  | `ink-jar`  | U+1F3FA | `red-envelope` | U+1F9E7 |
  | `candle`   | U+1F56F | `mahjong`      | U+1F004 |
  | `quill`    | U+1FAB6 | `oil-lamp`     | U+1FA94 |
  | `bookmark` | U+1F516 | `compass`      | U+1F9ED |
  | `lantern`  | U+1F3EE | `teacup`       | U+1F375 |
  | `blossom`  | U+1F338 | `maple`        | U+1F342 |

  码位由**源文件 SHA-256 反查上游**得到（逐枚与 `twemoji@15.1.0/assets/svg/<码位>.svg`
  逐字节相等）。**一处按名字会扑空的**：`ink-jar` 档名是「墨水瓶」，实际取的是 Twemoji 的
  **双耳瓶** `U+1F3FA`（同形状最接近的一枚），下一批来人别按名字去找。
  存在性 / 无脚本 / 无远程 href / 每个档名都有中文名且无死档，由
  `appearance-skin-assets.test.ts` 读盘钉住；挂位（窗角 `right 28px bottom 28px`、
  `--skin-ornament-size: min(18vmin, 184px)`、`no-repeat`）在 `appearanceSkinVisual.ts`。

## 助手头像表情引擎（Emotion Ball，2026-10-21 搬入）

助手消息左侧那枚头像改用第三方表情引擎（32 种表情，纯 SVG + 原生 JS，零依赖）。
用户原话：「`https://github.com/sam70361/aora-bot.git` 可以把这个做进我这个软件里面，
就是对话的那个头像 32 种表情都要用」。

- 上游项目：[sam70361/aora-bot](https://github.com/sam70361/aora-bot) 的 `emotion-ball/js/`
- 本项目路径：`apps/desktop/src/renderer/src/vendor/emotion-ball/{rings,emotions,ball,engine}.js`
  —— **原样搬入、无逻辑改动**，只按本仓 prettier 规则重排格式；接入层是同目录的 `index.ts`
- 许可（**必须照读，不能概括成"开源免费"**）：表情引擎源代码与表情配置数据采用双许可，
  **非商业免费、商业用途需另行取得授权**；球形角色的**视觉形象**（blob / wedge / gem 造型、
  配色与特效）**仅限个人技术学习与研究，禁止任何商业用途，且上游明确永不提供商业授权**。
  许可证原文与授权声明随文件放在 `vendor/emotion-ball/LICENSE` 与 `NOTICE.md`
- **本仓当前定位为私有 / 自用**，按非商业口径使用。若将来对外商业发行，这一层不可接受：
  须换掉球形形象（改用 mood-mates 子项目的云宝 / 亮亮，那两枚是上游原创、可洽商业授权），
  或另行取得授权——代码面只需替换 `vendor/emotion-ball/` 与 `EmotionAvatar.vue` 的引擎入口。

## 其他第三方库（npm 依赖）

- [canvas-ui](https://github.com/DavidHDev/canvas-ui)：MIT + Commons Clause。品牌粒子画布引擎来源，已按其 registry 源码拆分集成。
- morphicons：MIT。变形图标组件。
- lucide：ISC。图标数据。

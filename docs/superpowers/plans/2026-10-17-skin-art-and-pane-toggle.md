# 皮肤画面翻新 + 左栏折叠「出得来」（2026-10-17）

## 〇、用户原话（本文档的验收对象）

> 「还有那个皮肤，商城里的皮肤，一点都不好看，不精细……你自己创建它，这种不好看，
> 而且还有点问题。侧边栏也可以做成收缩的，就是跟旁边那个一样，点击可以收缩，然后出来」

拆成两条：
- **A｜皮肤画面要好看、要精细**，素材由墨宸自己产出（不走「上网搜图」——见第四节）。
- **B｜左栏要能收起、还要能出来**。

---

## 一、真机取证（全部可复现，不是读代码猜的）

取证方式：`apps/desktop/node_modules/.bin/electron apps/desktop/out/main/index.js
--remote-debugging-port=9234` + `.superpowers/tmp-app-probe.mjs`（临时探针，不入仓）。

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | **左栏在非对话视图收起后出不来** | 广场页点「收起左侧栏」后 `hasExpandBtn=false`、`leftSidebar=null`；唯一退路是 Ctrl+B（不可见） |
| 2 | 根因：展开按钮只在 `CenterColumn` 头上，而它只在 `centerView === 'chat'` 渲染 | `CenterColumn.vue:308-316` 的 `v-if="leftCollapsed"` 那枚按钮；`App.vue:426-432` 的 `v-if="centerView === 'chat'"` |
| 3 | 受影响的不止广场：设置页 / 插件·技能页同样出不来 | 同上（`SettingsPage` 与 `ExtensionsPage` 都不渲染 `CenterColumn`） |
| 4 | 六张矢量在**整窗尺度**读起来是抽象条纹 | 截图 `.superpowers/skinart-test/02-skins.png`：中右侧一片竖条，像条形码 |
| 5 | 卡片预览块**没有定高**，实际约 75px，画面在那一格里读不出结构 | `skin-gallery.css:183-193`（只有 padding，无 height）；截图 02 的八张卡 |
| 6 | 广场页 70% 实底把整窗预览压得近乎发白 | `theme-runtime.css:361-363`；截图 `03-preview.png` 整片浅青 |
| 7 | **出图通路是通的** | `GenerateImage` 2560×1707（比例 1.500）、406KB 出图成功 |
| 8 | 但出图默认**过暗过平**，三道闸全红 | 探针量到 `G1分层=1  G2缘跨=6.4/5.6  G3静=0.95`，`p2..p98=1.8..23.1` |
| 9 | 现有六张矢量**全绿**（这就是对齐目标） | `node apps/desktop/scripts/check-scene-art.mjs` → 六张全过，`p98` 落在 94.6～231.2 |
| 10 | 出图右下角带「AI生成」水印 | 截图候选图 `.superpowers/skinart-test/book-boat-night.jpg` 右下角 |

> **2026-10-17 波2 收尾补记**：上表第 4、9 两条里的「六张矢量」记的是**取证当时**的状态。
> 这一波已把这六张逐张换成原创位图（`.svg` → `.webp`），闸口读数仍全绿——
> 原文保留，因为它记的是当时量到的样子。

⇒ **结论**：A 是「素材本身不精细」+「卡片那一格读不出画」两件事；
出图可行但要补一道 **对比度 grading**（把过暗过平的候选拉到现有矢量那一档动态范围），
并把水印从素材里去掉。B 是一条真缺陷（不是「没做」，是「做了但出不来」）。

---

## 二、波次

### 波1｜左栏折叠「出得来」（先做：独立、可验、改动小）

**约束**
- 「展开左栏」这个动作**只许一份真身**：`CenterColumn` 头上那枚撤掉（铁律 6；
  同一动作留两枚按钮，将来必有一枚先腐坏）。
- 抓手**恒存于 shell**，只读 `leftCollapsed`——不受 `centerView` / `currentView` 影响，
  于是设置 / 插件·技能 / 皮肤广场 / 对话四页都在。
- `aria-label` 沿用既有口径（`展开左侧栏`），与左栏那枚 `收起左侧栏` 成对。
- 单文件 ≤800 行；样式走既有 token（`--skin-radius-*` / `--line-soft` / `--surface-raised`），不写死像素。

**落点**
- 新增 `components/PaneEdgeToggle.vue`：左缘一枚竖条，「点在哪儿、长什么样」只此一处。
- `App.vue`：挂在 `<template v-else>` **之前**（与 `LeftSidebar` 同一层），`v-if="leftCollapsed"`。
- `CenterColumn.vue`：删掉那枚 `展开左侧栏`（连带 `toggleLeft` emit 与 `leftCollapsed` prop
  若无其他消费者一并清理）。
- `styles.css`：左缘竖条观感（落点与 `.pane-resizer-left` 同源）。

**判据（先写失败用例，再实现）**
- `components/extensions-page-wiring.test.ts` 增：
  ① `App.vue` 里那枚抓手的条件**只读 `leftCollapsed`**，且它的下标**小于** `<template v-else>` 的下标
  （⇒ 四页都在，且不回到「只在对话那页」）；
  ② 反向：`CenterColumn.vue` 里**不再出现** `展开左侧栏`（同动作不留两份）。
- `layoutStore` 的 `togglePane('left')` 已有测试（`layout-store.test.ts`），不动。

**真机验收**：`tmp-app-probe.mjs` 第 ④/⑤ 步——广场页收起后能拿到展开抓手，点完 `leftSidebar` 回来。

---

### 波2｜画面翻新：六张矢量 → 六张原创位图

**素材口径（照 `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md`，不自立一套）**
- 母题「深海 / 深渊里一间和稿子有关的地方」；道具必须是稿子类（卷轴 / 稿纸 / 羽毛笔 / 墨水瓶 / 灯 / 书册）。
- **中间一整片低信息暗区**（三栏正文要落在这儿）；**左右两缘放主体**；**上下各 12% 不放关键元素**。
- 整体压深、明暗是渐变；不许可读文字 / logo / 水印 / 界面元素。
- 昼夜成对：**主体左右关系与暗区位置一致**（不要求逐像素同构，理由见台账）。
- 出处一律 `墨宸原创画面` / `本仓自有`。

**做法（每张五步，全部落成脚本，不手改像素）**
1. `GenerateImage` 出原画（2560×1707，比例 1.500 ≥ 那条 1.2 的线）。
2. **去水印**：右下角「AI生成」那一块用**同材质克隆补丁**盖掉（它在暗水区，补丁取自其上方／左方）。
3. **Grading**：按量到的 `p2 / p98` 做色阶扩张 + 微对比，把动态范围拉到现有矢量那一档
   （矢量 `p98` 在 95～231；候选原图只有 23）。这是为了过 §4 第 8 条那道像素闸，也是它的本意。
4. **降采样**到 1536×1024（≥ 守卫那条 1440×960）。
5. **编码 webp**（≤900KB）落 `apps/desktop/src/renderer/public/skins/<id>.webp`。

> **2026-10-17 波2 就地更正（做法第 2 步）**：上面写的「**同材质克隆补丁**」**试过、不行**——
> 书舟昼版水印正左方那片料**跨越船板与浅水两种材质**，搬过来把浅水的青绿带进了船板
> （`.superpowers/skinart-out/corner-fixed-book-boat-day.png` 目检确认）；
> 更早试的「膜插值重建」也在有纹理的料上留下一个**可辨的矩形色块**（亮度与边界都能看出来）。
> 最终落成的是**原地柔化**（管线里的 `soften`）：
> 只把那一块**自己**按材质给半径糊一下（平坦给大、有纹路给小），
> 垫边用**本块边缘一行／一列拉伸**铺出来（不引入块外料），笔画抹进背景、本块的低频结构留在原地。
> 六张放大目检：水印消失、无硬边矩形、船板／暗岩结构只变软。原文保留，它记的是当时那一版打算。

**落点**
- `appearanceSkinVisual.ts` 的 `ART_FILES`：六条扩展名 `.svg` → `.webp`（**id 与路径位置都不动**，
  这正是「路径只住在这一处」换来的解耦）。
- 删掉六个 `.svg`。
- `scripts/check-scene-art.mjs`：FILES 换成**八张**（两张旧位图 + 六张新位图），
  按扩展名给 MIME；反向用例（空渐变必须判红）保留。
  > **2026-10-17 波2 就地更正**：上面那句「换成**八张**」**不成立**，实际落成的是**六张**。
  > `abyss-hall-night.webp` / `shallow-hall-day.webp` 属**人物立绘族**，而三道闸里那条
  > G2「两缘均值与中段均值差 ≥10」对它们是**范畴错误**（实测缘中差 −3.7 / −4.0）——
  > 立绘的构图本来就不是「两缘有主体、中段空」，它们由 `appearance-skin-assets.test.ts` 管。
  > 闸口现在只覆盖六张场景画，并新增 `mimeFor`（按扩展名给 MIME，
  > webp/svg/png/jpg 白名单，其余当场抛）、读取改按二进制；反向用例（空渐变必须判红）保留。
  > 原文保留，因为它记的是当时那一版打算。
- `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md` §4 九条逐条勾。
- `docs/ATTRIBUTION.md`：记出处与许可。

**判据**
- `node apps/desktop/scripts/check-scene-art.mjs` → **六张全过**且反向用例判红。
  （2026-10-17 就地更正：原文写的是「八张全过」，理由同上那一条——两张人物立绘不进本闸。）
- `appearance-skin-assets.test.ts` 全绿（存在 / 非空 / ≤900KB / ≥1440×960 / 比例 ≥1.2 / 无死档 / 昼夜成对）。
- `appearance-theme-readability.test.ts` 全绿（正文对底色仍 ≥7:1）。

---

### 波3｜卡片观感（让「有画」在卡片上就读得出来）

**约束**：`skin-gallery.css` 里 `.skin-card-preview` 由「内容撑高」改成**定高**，
使画面成为那一格的主体；卡面字色/底色的层级不动（`02-skins.png` 里量到的 2.11:1 那条教训仍在）。
**判据**：`appearance-surface-ladder.test.ts` / `appearance-skin-plaza-wiring.test.ts` 全绿；
真机截图复看八张卡的画面可辨。

**落成（2026-10-17）**：定高用的是 `aspect-ratio: 3 / 2`（与规格单 §1 那张 1536×1024 的画同比例），
不写死像素——卡片列宽是 `minmax(228px, 1fr)`，写死会让宽窗口下卡片与预览块的比例脱钩。
判据是一条新用例，落在 `appearance-skin-plaza-wiring.test.ts`
（「预览块按画的 3:2 定高」），先跑红再实现。

---

## 三、门禁与收口

- `corepack pnpm verify` → `VERIFY_EXIT=0`（prettier / 6 枚 tsc / eslint / 包边界 / 行数 / vitest）。
- 提交 + 推送（GCM 交互式授权），CI 读回真 annotation。
- 台账：`docs/superpowers/plans/README.md` 追加本节批次记录；README 门禁节**读数未变则不动**。
  > **2026-10-17 就地更正**：上面那句台账指向**不成立**——近期批次记录实际落进
  > `docs/superpowers/plans/2026-10-09-full-scan-report.md`（`## 第一百X节` 编号），
  > `plans/README.md` 最后一个 `## ` 标题停在 2026-10-10 的「第 6 波」。
  > ⇒ 本节记录写进 `2026-10-09-full-scan-report.md` 的**第一百二十一节**。
  > 另外「README 门禁节读数未变则不动」这一句也**不成立**：本波新增了用例
  > （本机注册数由 4729 变 4734），按 §一百一十九/§一百二十 的口径，读数变了就得换绑，
  > 不能留着旧读数。原文保留，它记的是当时那一版打算。

## 四、明确不做

- **不做「上网搜图」**：规格单 §三 定的口径是「自绘 + 自有图」，委托外绘须书面「可商用、可修改、
  可再分发」授权；搜索引擎里的图无此授权，进表即许可风险。
- **不动广场页那 70% 档位**：它是台账 §七十七 用户点过的 A 方案（不写豁免、不加衬垫）。

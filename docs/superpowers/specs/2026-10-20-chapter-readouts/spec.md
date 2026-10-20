# P1 读数层 · 第二个消费者：体检报告「逐章活性／退化读数」

- 日期：2026-10-20
- 来源：外部调研报告 `docs/research/2026-10-19-writing-craft-benchmark.html`
  的 **P1 价值序 ⑥／⑦**（活性读数、退化读数）。§一百三十五（P1-⑥）与 §一百三十九（P1-⑦）
  落了两套**只摆数、不设线**的读数，但都只有**一个消费者**——多稿候选面板（「一稿」场景）。
- 状态：本刀给这两套读数补**第二个消费者**——体检报告的**逐章**场景。**不新增任何判据**。

## 一、为什么这一刀能落

§一百三十五／§一百三十九 的读数层**只有一个消费者**（多稿候选面板），而多稿面板只在
「同一次改稿 / 同一轮 N 稿」这个**稿内**场景里出数。作者真正高频看的却是**全书逐章**：
「哪一章突然变匀了／被删平了」——这是体检报告已经在做的事（八类逐章报告）。

于是本刀把同一批读数**搬到体检报告的逐章视角**：复用一个已有函数、不加一枚新阈值、不进任何闸。
**读数本身一个公式都不改**（真身仍在 contracts 的 `text-vitality.ts` / `text-degeneration.ts`）。

## 二、本刀做什么

1. **`apps/desktop/src/renderer/src/utils/doc-checkup.ts`**（+ 一节）：
   - `ChapterReadoutRow`＝{ docIndex, charCount, burstiness, particlePerThousand,
     shortSentenceRatio, meanSentenceLength }；
   - `chapterReadoutRows(chapters: { docIndex, content }[])`——逐章调 @mochen/contracts 的
     `vitalityOf` / `degenerationOf`，**只取长度可比的那几枚**（见第三节），**按章序原样返回**。
2. **`components/SideNavTermsReport.vue`**：watch 内复用已造的 `chapterEntries`，把结果存进新 ref
   （照既有八类写法：清空 → 赋值），模板加一节表格，样式沿用既有 `.stats-*` 类，
   并配一句 note 说清「只摆数、不作判据」。
3. **单测**：`utils/doc-checkup.test.ts` 追加 `describe`（纯函数，node 环境可测）＋ 变异验证。

## 三、取舍（为什么这么切）

- **为什么只上长度可比的四枚读数，刻意排除熵与字多样性**：
  `ngramEntropy`（字符 n-gram 熵）与 `diversity`（字多样性）都**随文本变长而偏高**
  （样本越多，罕见 n-gram／字越容易被采到）——这是 §一百三十五 已写进注释的**固有偏差**。
  多稿面板是「同一篇稿的不同版本」，字数通常接近，相对比较站得住；
  而**逐章并排是拿不同长度的章比长短**，把熵／多样性放上这张表就是**误用**（长章天然熵高、
  短章天然字多样性低，读者会误读成「长章更活」）。所以这张表只收**尺度无关／密度／比例／均值**的四枚：
  `burstiness`（句长突发度，尺度无关）、`particlePerThousand`（每千字密度）、
  `shortSentenceRatio`（比例）、`meanSentenceLength`（均值）。
  `charCount` 单独作**参照列**（样本量，不上判读）——它让读者看得见「为什么这一格是 `—`」。
- **为什么这是读数的第二个消费者，而不是新判据**：`chapterReadoutRows` **只调用**既有真身、
  **不做**任何比较、排序、聚合；产出的行**没有** verdict 字段。判定仍由用户看着数自己拍板
  （同 §一百三十五／§一百三十九「只出读数」那条取舍）。
- **为什么按章序原样返回、不排序、不设上限**：
  排序即排行（把「最碎/最平」的顶到最前）——那是机器判定，本刀不做。
  既有的按序返回先例是 `trackCharacterAppearances`（角色出场表，全量不封顶）；
  封顶只在 `chapterDialogueRows`（它排了序、只关心最反常的前 20 章）出现。
  本表**不排序**，封顶就变成**凭空砍掉书的后半截章**（后半截的章恰恰是读者最需要看的），
  所以**不设上限**，也**不导出** `CHAPTER_READOUT_LIMIT`（没有消费者，导出即死代码）。
- **为什么复用 `chapterEntries` 而不重造**：组件 watch 内已为第六类造好章节入口列表
  （`chapterDialogueRows` 的入参），逐章读数吃**同一份**——同一处数据只取一次（铁律 6 的同类）。

## 四、不变量（要能机器判）

1. 行序 **恒等于**入参章序（`docIndex` 单调不减）——**不排序**。
2. 四枚读数**逐位等于**单一真身的读数：
   `row.burstiness === vitalityOf(content).burstiness`、
   `row.particlePerThousand === degenerationOf(content).particlePerThousand`、
   `row.shortSentenceRatio === degenerationOf(content).shortSentenceRatio`、
   `row.meanSentenceLength === degenerationOf(content).meanSentenceLength`；
   字数 `row.charCount === content.length`。
3. 行**不含** `ngramEntropy` / `diversity`——把排除项误加回来，用例红（变异钉这条）。
4. `chapterReadoutRows` **不**调用任何判定：既有 `aiFlavorGate` / `rankDrafts` /
   `chapterDialogueRows` 用例全绿即钉住（本刀不动它们的字段）。

## 五、验收

1. `apps/desktop/src/renderer/src/utils/doc-checkup.test.ts` 新增 `describe` 过；
2. **变异测试**：把 `ngramEntropy` 加回行 → 「不含熵」用例红；改成排序（按读数降序）→
   「按章序」用例红；还原全绿；
3. 全仓 `corepack pnpm verify` 打出 `VERIFY_EXIT=0`（含单文件行数预算）；
4. 台账追加 §一百四十；
5. 仅本地 `git commit`，**不推送**。

## 六、如实记：本节收不掉的口子

- **本表不做任何判定**：不报「这章更活／更平」——没有跨章判据（同 §一百三十五／§一百三十九，
  判据仍受真人语料分位缺口牵制）。
- **`charCount` 参照列不是判线**：它只是样本量，帮助读者判断「`—` 是真没有还是样本太短」。
- **熵／多样性在逐章场景被排除，但仍可在多稿面板看**（那里字数接近，比较站得住）——
  本节不删任何读数，只是**不把误用场景摆出来**。

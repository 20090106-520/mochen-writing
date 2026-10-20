# 任务清单 · 体检报告逐章活性／退化读数

## T1 doc-checkup 判定层

- [x] `utils/doc-checkup.ts` 新增一节（放在 ⑧ 口头禅榜之后）：
  - `ChapterReadoutRow`：`docIndex` / `charCount` / `burstiness` / `particlePerThousand` /
    `shortSentenceRatio` / `meanSentenceLength`（后四枚可 null）
  - `chapterReadoutRows(chapters: { docIndex, content }[])`
    - 逐章 `vitalityOf(content)` 取 `burstiness`、`degenerationOf(content)` 取另三枚
    - **只上这四枚**（熵／多样性刻意排除，理由写进函数注释）
    - 按章序原样返回；**不排序、不封顶**
  - 从 `@mochen/contracts` 引入 `vitalityOf` / `degenerationOf`

## T2 渲染层（体检报告）

- [x] `components/SideNavTermsReport.vue`：
  - 新 ref `chapterReadouts`（照八类写法：watch 内清空 → 赋值）
  - 复用已造的 `chapterEntries` 调 `chapterReadoutRows`
  - 模板加一节表格（章 / 字数 / 突发度 / 虚词密度 / 短句占比 / 平均句长），行可点击
    `openCheckupDoc(row.docIndex)`，样式沿用 `.stats-table` / `.stats-section-head` / `.stats-note`
  - 配一句 note：「只摆数、不作判据；熵与字多样性随字数变化故不上这张表」

## T3 单测 + 变异

- [x] `utils/doc-checkup.test.ts` 新增 `describe("chapterReadoutRows：逐章活性／退化读数")`：
  - 行序＝章序（不排序）
  - 四枚读数逐位等于真身读数；`charCount === content.length`
  - 行不含 `ngramEntropy` / `diversity`
  - 不足句数的短章：三枚句级读数为 null、虚词密度照出
- [x] 变异：加 `ngramEntropy` → 红（1 failed | 25 passed）；改成按读数排序 → 红（1 failed | 25 passed）；还原全绿

## T4 门禁与台账

- [x] `prettier --write` 触及的源码文件
- [x] `corepack pnpm verify` → `VERIFY_EXIT=0`（375 文件 / 4941 passed | 2 skipped）
- [x] 台账追加 §一百四十（含「为什么只上长度可比的四枚」「为什么这是第二消费者而非新判据」
      「为什么不排序不封顶」与未收口项）
- [x] 仅本地 `git commit`（不推送）

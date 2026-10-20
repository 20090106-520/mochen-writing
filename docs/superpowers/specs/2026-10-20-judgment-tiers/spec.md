# 判据两档（阻断／建议）显式化（P2-⑧）

- 日期：2026-10-20
- 来源：外部调研报告 `docs/research/2026-10-19-writing-craft-benchmark.html`
  的 **P2 价值序 ⑧「判据分 blocking / advisory 两级」**（表格 ②「判据分层」行、
  3.2 微调第 4 条）。
- 状态：本刀只落「把二元显式化 + 体检报告按档位给优先级」，不改任何判退行为。

## 一、报告说的是什么

> 现状只有「进闸 / 不进闸」二元。外部把 20+ 类判据分两档处置，可减少「闸是文风警察」的误伤面，
> 也给体检报告更好的优先级。

本仓实际上**已经是两档**了——只是没把这件事说出来：

- **阻断档**：撞上生成端写明数值上限的那几条结构级条目（`AI_FLAVOR_STRUCTURE_GATED_LABELS`
  ＝ 升华对偶 / 对话标签 / 明喻），单独一条爆了就退稿；
- **建议档**：其余条目（描写套话 / 议论腔 / 副词 / 认知转述 / 章末总结体 / 反差模板 / 情绪直陈）
  只进体检报告报数，**不单独**退稿。

问题在「说不出来」：体检报告的 AI 味表只给了「写法 / 类型 / 次数」三列，
看报告的人分不清哪几条是真的会拦稿、哪几条只是建议。

## 二、本刀做什么

1. **一份真身**：在 `packages/contracts/src/ai-flavor.ts` 里把档位定义出来——
   `AiFlavorTier`（`"blocking" | "advisory"`）、`AI_FLAVOR_TIER_LABELS`（展示名）、
   `aiFlavorTierOf(label)`。
   `aiFlavorTierOf` **派生自既有的 `AI_FLAVOR_STRUCTURE_GATED_LABELS`**——
   档位不另存一份「哪些条目会进闸」的名单（铁律 6：单一真身）。
2. **条目带档位**：`AiFlavorEntry` 增 `tier` 字段，`analyzeAiFlavor` 逐条填。
3. **体检报告给优先级**：`SideNavTermsReport.vue` 的 AI 味表加一列「档位」，
   表头补一句「其中阻断档 M 条」，并把阻断档条目排在前面（**只在界面排**）。

## 三、本刀不做什么（以及为什么）

- **不新增任何阈值**：档位是「是不是进闸清单里的条目」这一既有事实，不需要算线。
- **不动四枚经验值（cliche 2 / essay 1 / adverb 5 / cognitive 3）**，
  不把任何条目从建议档升进阻断档，也不把任何条目踢出阻断档——
  升级／降级都要么踩铁律（进闸清单里的条目必须留闸），要么凭空造线（编数），两者都不许。
- **不改退稿闸判退行为**：`aiFlavorGate` 一个字不动，退稿信也不动。
- **不动 `entries` 的排序语义**：契约仍按「次数降序 + 名称」排——
  「本书套话回流」（`bookFlavorSentence` 取前 5）与文风检查预填（`styleCheckPrompt`）
  都吃这个顺序，改它等于顺手改了生成端的两段注入内容，不划算。
  界面那一层要的优先级，在界面里排。
- **不动生成端 `prompt-assembly.ts`**。

## 四、落点

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/ai-flavor.ts` | 新增档位真身（类型 / 展示名 / 派生函数）＋ `AiFlavorEntry.tier` ＋ 填值 |
| `packages/contracts/test/ai-flavor.test.ts` | 新增 describe「判据两档」用例 |
| `apps/desktop/src/renderer/src/utils/side-nav.test.ts` | `AiFlavorReport` 夹具补 `tier`（类型必填，漏了 tsc 红） |
| `apps/desktop/src/renderer/src/components/SideNavTermsReport.vue` | 档位列 ＋ 阻断档计数 ＋ 阻断档优先显示 |

## 五、验收

1. `packages/contracts/test/ai-flavor.test.ts` 新增用例过；
2. **变异测试**：把 `aiFlavorTierOf` 改成恒返回 `"advisory"` → 对应用例变红，还原后全绿；
3. 全仓 `corepack pnpm verify` 打出 `VERIFY_EXIT=0`；
4. 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 追加 §一百三十八；
5. 仅本地 `git commit`，**不推送**（用户明确叫停）。

## 六、如实记：本刀收不掉的口子

- 报告说的「减少闸是文风警察的误伤面」在本刀里**没有兑现**——那需要把某些条目从阻断档降到
  建议档，而本仓进闸清单里的三条都被生成端写死了数值上限（铁律不许动），
  其余条目本来就不进闸。**真正的降档只能是「生成端先撤掉那条写死的上限」**，那是另一件事。
- 档位名与分界仍是**本仓自己定的启发式**，没有外部验证；
  报告里「外部 20+ 类判据分两档」的具体名单本仓也无从核对。

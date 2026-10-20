# 任务清单 · 判据两档显式化（P2-⑧）

## T1 contracts：档位真身

- [ ] `packages/contracts/src/ai-flavor.ts`
  - 新增 `export type AiFlavorTier = "blocking" | "advisory";`
  - 新增 `export const AI_FLAVOR_TIER_LABELS: Record<AiFlavorTier, string>`——
    `blocking: "阻断（单独可退稿）"`、`advisory: "建议（只报不拦）"`
  - 新增 `export function aiFlavorTierOf(label: string): AiFlavorTier`——
    命中 `AI_FLAVOR_STRUCTURE_GATED_LABELS` 即 `blocking`，否则 `advisory`
  - `AiFlavorEntry` 增 `tier: AiFlavorTier`
  - `analyzeAiFlavor` 逐条填 `tier`
- [ ] 验收：`entries` 排序与阈值行为一字不改（回归靠既有用例）

## T2 contracts 用例 + 变异

- [ ] `packages/contracts/test/ai-flavor.test.ts` 新增 describe「判据两档（阻断／建议）」：
  - 三枚进闸标签各自 `aiFlavorTierOf` → `blocking`
  - 词表项 / 认知转述 / 章末 / 反差 / 情绪直陈 → `advisory`
  - `analyzeAiFlavor` 出的条目 `tier` 与 `aiFlavorTierOf(entry.term)` 一致
  - 联动断言：`AI_FLAVOR_STRUCTURE_GATED_LABELS` 每一条都落在阻断档
- [ ] 变异测试：`aiFlavorTierOf` 恒返回 `"advisory"` → 对应用例变红；还原全绿

## T3 渲染层

- [ ] `apps/desktop/src/renderer/src/utils/side-nav.test.ts` 两条夹具条目补 `tier`
- [ ] `SideNavTermsReport.vue`：
  - 表头 `AI 味扫描（N）` 追加「其中阻断档 M 条」（M 由 entries 派生）
  - 表加「档位」列，展示 `AI_FLAVOR_TIER_LABELS[entry.tier]`
  - 阻断档条目排在前面（界面内排序，不动契约 order）

## T4 门禁与台账

- [ ] `prettier --write` 触及的源码文件（docs/superpowers 在 .prettierignore 内）
- [ ] `corepack pnpm verify` → `VERIFY_EXIT=0`
- [ ] 台账追加 §一百三十八（含取下理由、取舍、门禁数字、未收口项）
- [ ] 仅本地 `git commit`（不推送）

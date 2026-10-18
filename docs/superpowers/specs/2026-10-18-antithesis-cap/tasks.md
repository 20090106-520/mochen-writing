# 任务清单 · 收紧「不是A，是B」对偶（2026-10-18）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 收口（提交/CI/README/台账）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 `packages/contracts/test/ai-flavor.test.ts`：既有「结构级两类」条改为「对偶 **2 次起报**、1 次不报」
  - [x] T1.2 同文件新增「对偶一章最多一处」条：1 处放行 / 2 处退稿（且证明是结构上限拦的）
    ＋ 1 条「结构上限只咬写明上限的那一条：章末体 1 处仍放行」
  - [x] T1.3 跑该文件 → 确认红：**3 failed | 29 passed（32 条注册）**（2 次未报、`structureOver` 未实现、进闸清单未定义）

- [x] T2 实现 · 扫描端（`packages/contracts/src/ai-flavor.ts`）
  - [x] T2.1 `AI_FLAVOR_STRUCTURE_MIN_COUNT[AI_FLAVOR_ANTITHESIS_LABEL]` 3 → 2 ＋ 注释同步
  - [x] T2.2 新增 `AI_FLAVOR_STRUCTURE_GATED_LABELS`（进闸的结构级条目，数字从 MIN_COUNT 现取）
  - [x] T2.3 `AiFlavorGateVerdict` 新增 `structureOver: string[]`
  - [x] T2.4 `aiFlavorGate` 算 `structureOver` 并入 `pass`（顺手把 `charCount < minChars` 提成 `short` 一枚）
  - [x] T2.5 文件头「四类口径」＋ `AI_FLAVOR_STRUCTURE_MIN_COUNT` / `aiFlavorGate` 注释同步更正
  - [x] T2.6 `apps/desktop/src/main/doc-tools-host.ts`：`structureOver` 非空时退稿信补「句式超限」一句
    ＋ `doc-tools-host.test.ts` 钉一条（`HEAVY + 两处对偶` → 信中含「句式超限」「一章最多一处」）

- [x] T3 判据转绿
  - [x] T3.1 `ai-flavor.test.ts` 全绿：**32 passed（32）**
  - [x] T3.2 邻近守卫全绿（`doc-tools-host.test.ts` 退稿闸各组，**56 passed**；干净稿仍放行）
  - [x] T3.3 全仓 `corepack pnpm verify` 全绿：364 文件 / **4773 passed | 2 skipped（4775 条注册）**、`VERIFY_EXIT=0`
    （上一版 364 / 4770 | 2 skipped（4772 注册），差值 ＋3 = 本刀新增 3 条用例）

- [ ] T4 收口
  - [ ] T4.1 代码/判据/spec 提交并推送 `feat/plan3-interaction-and-assembly`
  - [ ] T4.2 读真实 CI（run / check-run / annotation 逐字记下）
  - [ ] T4.3 README「## 门禁」节换绑到新短哈希 ＋ `tools/readme-claims.test.mjs` 回填链注释同步
  - [ ] T4.4 台账补记新一节（含「换绑时抓到的一发」位）
  - [ ] T4.5 工作树干净、未收口项如实留档、清理仓外临时件 ＋ docs 提交 CI 读回回填台账

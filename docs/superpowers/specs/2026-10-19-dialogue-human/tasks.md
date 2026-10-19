# 任务清单 · 对话写法（三）三条口径固化（2026-10-19）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 本地收口（**不推送**）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 `apps/desktop/src/main/agent-service-prompt.test.ts` 追加 1 条：四条口径各钉一句原文
    （标签上限＋动作切「一章最多三处」／闲话跑题「闲话」／说错改口「改口」／段落打散「不许每段都收在台词上」）
  - [x] T1.2 `packages/contracts/test/ai-flavor.test.ts` 追加对话标签用例（4 次起报、3 次不报；
    1~3 处放行、第 4 处退稿且是结构上限拦的）＋ 改既有「进闸清单」断言（两条）
  - [x] T1.3 跑这两文件 → 确认红

- [x] T2 实现 · 生成端新段（`apps/desktop/src/main/prompt-assembly.ts`）
  - [x] T2.1 新增 `HUMAN_DIALOGUE_INSTRUCTION`（四条：标签上限／闲话跑题／说错改口／段落打散，写清与 QUALITY 第 3 条的分工）
  - [x] T2.2 装配数组里紧接 `HUMAN_CRAFT_INSTRUCTION` 之后注入

- [x] T3 实现 · 扫描端（`packages/contracts/src/ai-flavor.ts`）
  - [x] T3.1 新增 `AI_FLAVOR_DIALOGUE_TAG_PATTERN` ＋ `AI_FLAVOR_DIALOGUE_TAG_LABEL`
  - [x] T3.2 `AI_FLAVOR_STRUCTURE_MIN_COUNT` 加该条（= 4）＋ `AI_FLAVOR_STRUCTURE_GATED_LABELS` 追加
  - [x] T3.3 `analyzeAiFlavor` 与 `aiFlavorGate` 各补一条计数（同一份正则）
  - [x] T3.4 文件头与相关注释同步更正

- [x] T4 实现 · 退稿信随 label 走（`apps/desktop/src/main/doc-tools-host.ts`）
  - [x] T4.1 `structureOver` 那一句改成按 label 现取上限（`一节最多 N 处`）
  - [x] T4.2 `doc-tools-host.test.ts` 追 1 条（对话标签超限 → 信含「一章最多 3 处」）＋ 改既有对偶断言措辞

- [x] T5 判据转绿
  - [x] T5.1 两文件全绿；既有守卫一字不动（除 T1.2 / T4.2 明列的两处措辞）
  - [x] T5.2 全仓 `corepack pnpm verify` 全绿：`VERIFY_EXIT=0`

- [x] T6 本地收口（**按用户要求不推送**）
  - [x] T6.1 commit（不 push）
  - [x] T6.2 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记第一百三十节
  - [x] T6.3 工作树干净、仓外临时件清零；README 门禁节 / CI **有意不动**（理由见 spec 第五节）

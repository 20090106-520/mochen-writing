# 任务清单 · 人味写作：叙事手法常驻段 ＋ 扫描端对齐（2026-10-18）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 收口（提交/CI/README/台账）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 `apps/desktop/src/main/agent-service-prompt.test.ts`：`defaultPromptFor · 拼装` 追加 1 条——五样手法语在常驻提示（含点名禁「夜色深沉」）
  - [x] T1.2 `packages/contracts/test/ai-flavor.test.ts`：追加 1 条词表断言（新词进表且进 `aiFlavorPromptList()`）
  - [x] T1.3 `packages/contracts/test/ai-flavor.test.ts`：新增 describe「情绪直陈句式」4 条（3 次起报／多种构式／反例不误伤／退稿闸同批认）
  - [x] T1.4 跑两文件 → 确认红（2 文件 / 5 失败：prompt 段缺失 + 词表缺 6 词 + 正则 label 未定义）

- [x] T2 实现 · 生成端（`apps/desktop/src/main/prompt-assembly.ts`）
  - [x] T2.1 新增 `NARRATIVE_CRAFT_INSTRUCTION`（五条：演情绪／拆节拍／环境映心情／过渡锚／快慢分）
  - [x] T2.2 装配数组里紧接 `QUALITY_INSTRUCTION` 之后注入

- [x] T3 实现 · 扫描端（`packages/contracts/src/ai-flavor.ts`）
  - [x] T3.1 `AI_FLAVOR_TERMS` 追加 15 条 `cliche`（概括情绪 8 ＋ 空泛环境套话 7）
  - [x] T3.2 新增 `AI_FLAVOR_EMOTION_PATTERN` ＋ `AI_FLAVOR_EMOTION_LABEL`
  - [x] T3.3 `AI_FLAVOR_STRUCTURE_MIN_COUNT` 给情绪直陈 3 次；更新其注释
  - [x] T3.4 `analyzeAiFlavor` 加一处 `line.match`；`aiFlavorGate` 加一处 `text.match`
  - [x] T3.5 同步更正文件头「四类口径」与 `AI_FLAVOR_GATE.hits` 注释

- [x] T4 判据转绿
  - [x] T4.1 两判据文件全绿
  - [x] T4.2 邻近守卫全绿（`doc-tools-host.test.ts` 退稿闸 6 组、`doc-checkup.test.ts` 等；4 文件 / 137 条）
  - [x] T4.3 全仓 `corepack pnpm verify` 全绿：364 文件 / **4770 passed | 2 skipped（4772 条注册）**、`VERIFY_EXIT=0`（上一版 364 / 4764 | 2 skipped（4766 注册），差值 ＋6 = 本刀新增 6 条用例）

- [x] T5 收口
  - [ ] T5.1 `git commit` + `push`（`feat/plan3-interaction-and-assembly`）
  - [ ] T5.2 读真实 CI（私有仓走 Windows 凭据管理器取 token 调 REST；`head_sha` 传完整 40 位）
  - [ ] T5.3 README「## 门禁」节换绑真实读数 ＋ `tools/readme-claims.test.mjs` 回填链注释
  - [ ] T5.4 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记第一百二十八节 ＋ docs 提交 CI 回填
  - [ ] T5.5 工作树干净、未收口项如实留档、清理仓外临时件

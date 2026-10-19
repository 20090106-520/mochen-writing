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

- [x] T7 真机复验（spec §六 · 本轮「继续」的落点）
  - [x] T7.1 重建出厂文案：`corepack pnpm build`（exit 0），`out/main/index.js` 时间戳更新到 10-19 16:19
  - [x] T7.2 起真机：`electron . --remote-debugging-port=9377`，CDP `page` target 可达
  - [x] T7.3 仓外写 CDP 驱动 `Temp\mochen-live\drive.mjs`（一条 Runtime.evaluate 跑完整轮）
  - [x] T7.4 驱动生成《雾港的账》第一章（proposal 自动 accept-session，收 turn-end，readDoc 取正文）
    - 结果：turn-end `done`，`chapters/第一章.md` 1554 字 / 43 段，一次 write_doc 提案 accept-session 后写入，**退稿闸未触发**
  - [x] T7.5 读数：内嵌与 `AI_FLAVOR_DIALOGUE_TAG_PATTERN` 逐字相同的正则统计标签命中；如实记录退稿闸有无触发
    - 结果：严格正则命中 0；**但核实发现正文用半角直引号 `"`（66 个）、无 `「」『』`**，
      故第 1 支（`」』` 收尾）对出厂主笔实际产出**召回为 0**——是判据匹配不到，不是模型真避开。
      放宽引号型后能抓到 `"他说` / `"你上回说` / `"我没说` 3 处。
  - [x] T7.6 把正文全文与读数交给用户；收口仓外临时件（**不推送**）
  - [x] T7.7 排查并修：扫描端对话标签判据覆盖出厂主笔的引号型（半角 `"` ＋ 弯引号 `“”`），消除召回裂缝（先红后绿，不推送）
    - 约束：半角 `"` 开／闭同形，直接并入第 1 支会把「`。"他说过…`」这类**开引号**语句误判为标签
      （原注释已点明此风险）——须用**引号奇偶判定**（`"` 前已出现的 `"` 计数为奇 = 闭引号）才收，不裸扩。

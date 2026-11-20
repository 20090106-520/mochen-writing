# 任务清单：自动化三件事

- 对应 spec：`docs/superpowers/specs/2026-11-17-automation/spec.md`
- 执行顺序：A → B → C。**每阶段验证通过才进下一阶段**；不提交、不推送。

## 阶段 A：自动预读榜首技能正文

- [x] A1 契约：`packages/contracts/src/skill.ts` 加 `SKILL_PRELOAD_MAX_CHARS = 4000`；
      `packages/contracts/src/agent-event.ts` 的 `startTurnInputSchema` 加可选 `preloadSkillId`，更新注释。
- [x] A2 选择判据：`renderer/utils/skill-auto.ts` 加 `preloadSkillIdOf(picks)`（空榜/唯一榜首/并列第一/单条）；
      单测覆盖四条分支。
- [x] A3 装配：`useAutoSkillStore` 加 `preloadIdOf(threadKey)`；`useAgentStore.send()` 在非空时带 `preloadSkillId`。
- [x] A4 主进程读取：`turn-context.ts` 加 `readSkill` 依赖与 `readPreloadSkill(id)`（4000 字封顶、clipped 标记）；
      改文件头与 `readPinnedSkills` 注释为「除显式预读外不读正文」。
- [x] A5 提示词落点：`system-pack.ts` 的 `ContextPackInput` 加 `preload`，拼「【本轮自动预读的技能】」段，
      并按有无 preload 选 `SKILL_HINT` / `SKILL_HINT_WITH_PRELOAD`。
- [x] A6 接线：`agent-service.ts` 并行读预读、失败发可见中文、传给 `buildContextPack`；
      `index.ts` 的 `createTurnContext` 传 `readSkill: readSkillForTurn`。
- [x] A7 测试：`agent-service-boundary.test.ts` 追加「传预读 ⇒ 正文进提示；不传 ⇒ 正文不出现」；
      既有 P0-2 用例保持绿。
- [x] A8 门禁：`pnpm typecheck` + 相关 vitest + `pnpm verify`（VERIFY_EXIT=0）。

## 阶段 B：写后自动体检 + 去 AI 味

- [x] B1 纯函数：新建 `renderer/utils/auto-checkup.ts`（`AutoCheckupFinding` / `autoCheckupOf`），
      复用 `analyzeAiFlavor` / `findPunctuationIssues` / `findDuplicateSentences`，只保留有问题的篇。
- [x] B2 单测：`renderer/utils/auto-checkup.test.ts`（空内容不报、三类命中、只留有问题的篇、排序稳定）。
- [x] B3 触发：`useAgentStore` 在**实时 written 事件**上异步调体检，不阻塞回执。
      偏离说明：本仓提案要作者批准才写盘，写在 turn-end 之后，挂 turn-end 会永远等不到；
      回放路径（absorbWrites:false）不经过该分支，重启不会重跑历史写入。
- [x] B4 状态：新建 `renderer/stores/useAutoCheckupStore.ts`（`run` / `dismiss` / `findingsOf`），
      `run` 读盘失败安静跳过；跑着时新写成的篇进 pending，跑完接力，不静默丢。
- [x] B5 UI：新建 `renderer/components/AutoCheckupCard.vue`，挂到 `CenterColumn.vue` 对话流末尾；
      无问题/已 dismiss 不渲染。偏离说明：样式用组件内 scoped style（与 DraftCandidates 同法），
      不塞进 `agent-pane.css`，避免死 CSS 守卫与新全局类。
- [x] B6 store 测试：无问题时空结果、`dismiss` 后不再显示、并发写入接力、读失败跳过。
- [x] B7 门禁：`pnpm typecheck` + 相关 vitest + `pnpm verify`（VERIFY_EXIT=0）。

## 阶段 C：章末前情摘要

- [x] C1 契约：`bookMetaSchema` 加可选 `recaps: Record<string,string>`；加 `RECAP_MAX_CHARS = 300`
      与纯函数 `recapOf(recaps, relPath)`。
- [x] C2 生成：新建 `main/chapter-recap.ts`（`createChapterRecap` → 一次低温度事实摘要，失败回 null）。
- [x] C3 触发：`agent-service.ts` 在成功写盘后后台排队，未阻塞回执；按 relPath 去重；
      成功后 `saveMeta` 写回 `recaps`，失败只 `console.warn`。
- [x] C4 装配：`agent-runtime/src/context.ts` 前情提要段有摘要用摘要、无摘要退回尾部截取。
- [x] C5 测试：`context.test.ts` 追加「有摘要用摘要 / 无摘要行为不变」；`recapOf` 单测。
- [x] C6 门禁：`pnpm typecheck` + 相关 vitest + `pnpm verify`（VERIFY_EXIT=0）。

## 完成判据

- 三阶段各自的门禁全绿，`pnpm verify` 末尾 `VERIFY_EXIT=0`。
- 既有未提交界面改动未被回退（`git status` 里原有文件仍在）。
- 全程不提交、不推送。

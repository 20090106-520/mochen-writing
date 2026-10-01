# 实现计划索引

- Plan 1（本目录 `2026-10-01-plan1-shell-and-file-layer.md`）：三栏壳 + 文件层，对应 spec 的 S1/S2。已完成。
- Plan 2（本目录 `2026-10-01-plan2-streaming-and-proposal.md`）：**已完成**（S3 + S4，16 任务；真机三栏冒烟通过）。
  流式对话 + 提案写盘与审批；依赖 Plan 1 的 `contracts`、`fs-store` 与 `RendererApi`。
  本地 SSE 桩到真写盘全链的逐条观测与未做口径见 `2026-10-02-plan2-smoke-report.md`；
  计划点名的四项内部核查（`createIpcOn` 退订、`contextBridge` 返回函数、主/渲染 `UNBOUND` 同值、
  turn-end 后迟到 delta）只有单测/静态证据，**未做 DevTools 逐项操作**，不许升格成「真机验证」。
  变异台账（17 行：原 15 行 + 波 A + 波 A2）落在该计划文件 Task 16 Step 3。
- Plan 3（待写）：键位/权限档/打断排队 + 阶段装配与浏览不打断，对应 S5/S6；
  智能体侧按 spec §5.1 的墨宸花名册（六个 `AgentProfile` 实例）实现，不新增工具。
  依赖 Plan 2 的 `useAgentStore`（事件归约为唯一真相）与主进程 `agent-service`（唯一写盘通路）。

设计依据见 `../specs/2026-10-01-mochen-writing-workbench-design.md`；
移植自 deepwrite 的 UI 资产清单见 `../../ATTRIBUTION.md`。

## Plan 2 收尾时留下的已知缺口（逐条一句话，详情在冒烟记录原文里）

- **F-4（P2，品牌残留）**：用户可见磁盘路径仍是 `appData/mochen-writing`；改名须连带迁移 safeStorage 密文，
  所以留 Plan 3 与目录迁移一起做（原文见 `2026-10-02-plan2-smoke-report.md` 的 F-4 条）。
- **F-6（P2，能力缺口）**：重启应用后中栏线程与提案卡全空——JSONL 目前只重建**模型上下文**，渲染层没有
  事件回放通道；正解是 spec §3 的 `/resume`，属 S5 / Plan 3（原文见同文件「F-6」节）。
- **波 A 评审延后的四条 P3**：`mock-provider` 的桩收尾分支只有 e2e 覆盖；`turnAnchors` 的「本轮」死分支与
  未来回放跳号；「切档后再批准」缺 UI 入口（切换器本身也在 Plan 3）；`.vue` 模板零自动化覆盖
  （本仓不引 `@vue/test-utils`，判定层已全下沉 `utils`）。

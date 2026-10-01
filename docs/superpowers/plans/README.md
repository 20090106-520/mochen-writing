# 实现计划索引

- Plan 1（本目录 `2026-10-01-plan1-shell-and-file-layer.md`）：三栏壳 + 文件层，对应 spec 的 S1/S2。已完成。
- Plan 2（待写）：流式对话 + 提案写盘，对应 S3/S4；依赖 Plan 1 的 `contracts`、`fs-store` 与 `RendererApi`。
- Plan 3（待写）：键位/权限档/打断排队 + 阶段装配与浏览不打断，对应 S5/S6；
  智能体侧按 spec §5.1 的墨宸花名册（六个 `AgentProfile` 实例）实现，不新增工具。

设计依据见 `../specs/2026-10-01-mochen-writing-workbench-design.md`；
移植自 deepwrite 的 UI 资产清单见 `../../ATTRIBUTION.md`。

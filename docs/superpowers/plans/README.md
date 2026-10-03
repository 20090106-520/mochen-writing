# 实现计划索引

- Plan 1（本目录 `2026-10-01-plan1-shell-and-file-layer.md`）：三栏壳 + 文件层，对应 spec 的 S1/S2。已完成。
- Plan 2（本目录 `2026-10-01-plan2-streaming-and-proposal.md`）：**已完成**（S3 + S4，16 任务；真机三栏冒烟通过）。
  流式对话 + 提案写盘与审批；依赖 Plan 1 的 `contracts`、`fs-store` 与 `RendererApi`。
  本地 SSE 桩到真写盘全链的逐条观测与未做口径见 `2026-10-02-plan2-smoke-report.md`；
  计划点名的四项内部核查（`createIpcOn` 退订、`contextBridge` 返回函数、主/渲染 `UNBOUND` 同值、
  turn-end 后迟到 delta）只有单测/静态证据，**未做 DevTools 逐项操作**，不许升格成「真机验证」。
  变异台账（17 行：原 15 行 + 波 A + 波 A2）落在该计划文件 Task 16 Step 3。
- Plan 3（**进行中**，spec `../specs/2026-10-02-plan3-interaction-and-assembly-design.md`、
  计划 `2026-10-02-plan3-interaction-and-assembly.md`）：键位/权限档/打断排队 + 阶段装配与浏览不打断，对应 S5/S6；
  智能体侧按 spec §5.1 的墨宸花名册（六个 `AgentProfile` 实例）实现，不新增工具。
  依赖 Plan 2 的 `useAgentStore`（事件归约为唯一真相）与主进程 `agent-service`（唯一写盘通路）。
  Plan 2 收尾时两件悬而未决的事已由控制方拍板，Plan 3 照此执行：
  ① **主题默认值不硬锁深色**——现状 `App.vue:27-29` 跟随 `prefers-color-scheme` 保持不变，
  Plan 3 要加的是「跟随系统 / 浅色 / 深色」三态显式开关并持久化（品牌图仍是暗色调底，
  但把用户系统偏好盖掉是更糟的选择）；
  ② **品牌图来源按「用户提供的官方素材」定案**——规则锁死为原样使用、只做格式转换（PNG/ICO），
  禁止裁切、重绘或另生成（资产条目与转换记录见 `../../ATTRIBUTION.md` 的图标条）。
- **波 1.5（界面方向附录，2026-10-03 拆成计划并已交付，11 任务全闭合）**：设计 `../specs/2026-10-02-ui-fusion-direction-design.md`、
  计划 `2026-10-03-plan3-wave1-5-ui-fusion.md`（11 任务 ≤12 上限 ⇒ 仍是 Plan 3 的一波，不开 Plan 4）。
  用户 2026-10-02 给了两张墨宸界面示意稿并裁定走「B 骨架 + A 气质」融合。
  本波实际交付六面渲染层改造（中栏工作台 / 右栏作品资料 / 左栏三段主操作 /
  输入区两枚真开关 chip / md 片段工具栏 / 页脚阅读时长），并认领波 1 真机撞出的三条界面缺陷与六格留白；
  **F-E「墨宸 · 青金」preset 不在本波**——`themePresets` 至今全仓零消费者，本波加第四条仍是摆设，
  它随波 2 Task 19 的主题三态 + `appearance.json` 一起出生（那时才有真消费者）
  （附录 §3/§4 原文那句「波 3 的三态开关」是排期笔误，2026-10-03 已按 Plan 3 spec §3 第 114 行就地更正）。
  三条缺陷的复验屏幕原文见 `2026-10-03-plan3-wave1-5-report.md` Step 5-B；波 1 六格留白的逐格判定见同报告 Step 5-C
  （L1 / L2 / L4 本波复验后勾，L3 仍欠人肉一次，L5 / L6 属字面不可达标格，如实不勾）。
  排在波 1 门禁之后、波 2 之前，只碰 `apps/desktop/src/renderer`（外加 `error.proposalId?` 与 `DocRef.excerpt?`
  两处跨层**可选**字段，IPC 计数保持 13 一字不加）；
  **其中一条术语裁定影响全局：UI 上的「档案」永远只指 agent profile，右栏那一格定名「作品资料」。**
  **2026-10-03 用户裁定追加三件事，其中两件不在波 1.5**（破了「只碰渲染层」的前提）：
  ① 「深度思考 / 切模型」chip 解禁 ⇒ 模型枚举走主进程 `{baseURL}/v1/models` + 新 IPC 通道，**归波 2**；
  联网搜索照旧不做。② 「替我审批」**只作用在「全开」档**（其余两档永远逐条等人），
  开关生效点在主进程审批链，**归波 3**；裁定全文见总 spec §6。
  ③ 思考等级的出站字段格式范围仍未定案，定案前那枚 chip 不进 UI（附录 §7 第 4 条）。
  合成计划时的两处控制方裁定（执行者不再自行判断）：**裁定 A** 给 `agent-service.ts:347-351` 的写盘竞态分支
  补一条带 `proposalId` 的 error publish（它此前静默）；**裁定 C** chip 行不做带数字的排队徽标，
  队列计数只在状态行出现。


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

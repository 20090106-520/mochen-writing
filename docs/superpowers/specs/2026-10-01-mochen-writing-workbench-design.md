# 墨宸 AI · 三栏写作智能体工作台设计（首轮）

> 品牌：产品名 **墨宸 AI / MOCHEN AI**（原名"深渊写作"，Plan 1 交付后整体改名，代码内 `@mochen/*`、`.mochen/`、`window.mochen` 均为该品牌）。

日期：2026-10-01
状态：待实现
范围：本地优先的 Electron 桌面写作智能体工作台，首轮交付可真实写书的三栏闭环

## 0. 决策依据（取证，不是假设）

**Codex（`openai/codex`）的界面是 Rust + ratatui/crossterm 终端 TUI，不是 Web UI。**
可移植的是交互语义，不是组件。以下每条都要在实现处注明出处：

| 约定 | 证据 |
|---|---|
| `Esc` 打断当前 turn | `codex-rs/tui/src/keymap.rs:1662`（`interrupt_turn`） |
| `Enter` 提交 | `keymap.rs:1678`（`submit`） |
| 运行中 `Tab` 排队追加指令 | `keymap.rs:1679`（`queue`） |
| `Shift-Enter` / `Ctrl-J` 换行 | `keymap.rs:1687-1692`（`insert_newline`） |
| 审批键 `y/a/p/d/c/esc` | `keymap.rs:1933-1938` |
| 权限三档 `read-only` / `auto` / `full-access`，默认最保守 | `codex-rs/utils/approval-presets/src/lib.rs:41`、`chatwidget/permissions_menu.rs:6-17` |
| 审批文案三选项（Yes / Yes-and-don't-ask-again / No-and-tell-me-what-to-do-differently） | `bottom_pane/approval_overlay.rs:845,860,912` |
| 补丁以 `FileChange{Add,Update{unified_diff}}` 呈现 | `approval_overlay.rs:29,2150-2168` |
| 流式事件分 reasoning / plan / agentMessage / tokenUsage | `app-server-protocol/src/protocol/common.rs:1933-2008` |
| 会话按 `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` 落盘，首行 SessionMeta | `codex-rs/rollout/src/list.rs:37` |
| 状态行 "Working (0s • esc to interrupt)" | `status_indicator_widget.rs` |

**deepwrite 侧证据**：三栏工作台真正可参照的 UI 只有 2895 行 / 8 个文件
（`RightEditorPane.vue` 1109、`AgentEditProposalCard.vue` 428、`AgentConversation.vue` 414、
`LeftSidebar.vue` 321、`WritingContextPanel.vue` 248、`KeyboardShortcutsPanel.vue` 167、
`ConversationProcessingTimeline.vue` 147、`AgentEditProposalDiff.vue` 61）。
`WorkspaceShell.vue` + `App.vue` 的渲染层传递闭包是 674 文件 / 144070 行，全仓非测试约 253k 行，
其中 `contracts` 30419 行与 `pi-runtime-adapter` 19871 行绑死了长卷/伏笔/账本/市场/多设备同步语义。

**结论**：不搬实现，搬结构与交互语义；项目层自研。

## 1. 目标与非目标

目标（首轮必须全部成立）：
1. 打开一个真实的作品目录，读改其中多文件 Markdown 文稿。
2. 三个创作阶段之间切换时，智能体档案与上下文包随之切换。
3. 智能体能理解当前作品上下文，产出人物/剧情/大纲/正文的修改建议。
4. 每一条建议都以 diff 呈现，由人逐条审批后才写真盘；不批准就不写。
5. 浏览素材库与技能库不打断当前文稿与当前对话。
6. 章节以独立标签切换，每个标签绑定自己的会话线程。

非目标（本轮明确不做）：多设备同步、云备份、技能市场、长篇账本/伏笔登记、子代理编排、
自动发表、插件系统、导入 deepwrite 书稿。

## 2. 技术栈与工作区布局

- pnpm workspace（catalog 锁版本，与 deepwrite 同版本便于复用经验）
- Electron 42.5.0 + electron-vite 5.0.0（本机 `%LOCALAPPDATA%\electron\Cache` 已有 142M 二进制缓存）
- Vue 3.5 + TypeScript + Pinia + naive-ui 2.44，自定义毛玻璃主题
- vitest 4 单元/契约测试；electron 冒烟脚本

```
墨宸 AI/
  apps/desktop/
    src/main/        主进程：文件层、provider client、工具循环、审批、会话落盘、密钥
    src/preload/     仅暴露白名单 API（渲染层禁止直接触达 fs/net）
    src/renderer/    三栏 UI
    src/shared/      主/渲染共用的类型与工具
    scripts/         冒烟脚本
  packages/
    contracts/       IPC 契约 + 文稿/提案/权限的 schema（zod）
    fs-store/        书目录读写、扫描、冲突检测（纯函数，可在 node 下测试）
    agent-runtime/   provider client、补丁协议解析、工具循环、上下文装配（不依赖 Electron）
```

包边界规则：`agent-runtime` 与 `fs-store` 不得 import electron；
只有 `apps/desktop/src/main` 组装二者。这样核心逻辑能在纯 node 下被测试覆盖。

## 3. 硬盘上的作品（文件即数据）

一部作品 = 一个用户自选目录，无数据库。

```
<书目录>/
  book.json
  outline/<卷名>.md
  characters/<人物名>.md
  plot/<剧情线>.md
  materials/<主题>.md
  chapters/<两位序号>-<章名>.md        # 例：03-深渊之下.md
  .mochen/
    sessions/<YYYY>/<MM>/<DD>/rollout-<时间戳>-<uuid>.jsonl
    changes/<时间戳>/<相对路径>.bak
    skills/<技能名>/SKILL.md
```

`book.json`：`{ id, title, stages[], activeStage, permissionMode, chapterOrder[], schemaVersion }`。
文稿头部用 YAML frontmatter 存结构字段（人物：身份/弧线/关系；章节： POV/涉及人物/关联剧情线），
正文其余部分保持纯 Markdown，保证创作者用任意编辑器都能改。

技能库：全局 `~/.mochen-writing/skills/<名>/SKILL.md` + 书内 `.mochen/skills/`，
frontmatter 声明 `name/description/stage/appliesTo/tools`。

会话文件（照 Codex rollout 布局）：JSONL，首行 `SessionMeta`，
其余为 `reasoning` / `plan` / `message` / `toolCall` / `proposal` / `decision` / `interrupted` 事件。
每章一条线程，`/fork` 从某事件处分叉，`/resume` 读回。

## 4. 三栏信息架构

**左栏**：作品树（章节/大纲/人物/剧情/素材）、技能库、常用功能（权限档、设置、导出、检索）。

**中栏**：智能体对话。分层渲染四类流式内容——思考摘要、计划、消息正文、工具执行卡；
工具执行卡下挂修改建议卡（diff + 审批按钮 + 快捷键提示）。

**右栏**：两套独立标签。
- 文稿标签：章节/大纲/人物卡等，可编辑，绑定各自会话线程。
- 浏览标签：素材/技能/被引用的文稿，只读预览。

**"浏览不打断"规则（写死并有测试）**：从左侧选素材或技能时，只开浏览标签，
文稿标签集合、当前章、右栏滚动位置、当前会话线程均不变；
关闭浏览标签不产生任何状态变化；
素材/技能挂到上下文是显式动作（"加入当前上下文"按钮 / `@` 引用），不是选中即生效。

## 5. 阶段 ↔ 智能体档案 ↔ 上下文包

阶段：构思、大纲、人物、正文、修订（`book.json.stages` 可增删）。

档案 = `{ 提示词, 允许工具集, 上下文包构造器, 默认写入范围 }`。

上下文包 = 当前章正文 + 大纲摘要 + 出场人物卡（按章节 frontmatter `characters` 与正文人名命中）
+ 前情提要（默认前 2 章的尾部摘要，各约 400 字，数量在设置里可调）+ 已显式挂入的素材与技能。
中栏顶部显示上下文占用条（token 估算 + 已装配条目数）。

切换阶段或切换章节标签 → 换档案、重算上下文包、切换到该章绑定的会话线程。
上下文压缩：`/compact` 生成摘要事件并保留边界（boundary 必须落盘，
后续轮次只读边界之后的内容 + 摘要）。

## 6. 受控工具与审批（全案最硬的铁律）

工具集共 5 个：`read_doc`、`list_docs`、`search_docs`、`propose_patch`、`write_doc`。

**模型永不直接写盘。** `propose_patch` 只产出 `EditProposal`（文档相对路径 + 锚点 + 新文本 + 理由），
右栏高亮对应位置，中栏出现建议卡与 diff。只有人审批通过，主进程才执行写入；
写入前把原文件复制到 `.mochen/changes/<时间戳>/`。`write_doc` 同样必须经审批，
且在"只读参考"档下一律拒绝（拒绝结果回喂给模型，而不是静默丢弃）。

权限三档（Codex `read-only/auto/full-access` 的写作映射，默认 `read-only`）：

| 档位 | 可读 | 可提议 | 批准后写入范围 |
|---|---|---|---|
| 只读参考 | 全部 | 允许 | 无（一律拒绝并说明原因） |
| 可改当前章 | 全部 | 允许 | 仅当前章文件 |
| 全开 | 全部 | 允许 | 章/大纲/人物/剧情/素材（仍逐条审批） |

审批动作（照 `approval_overlay.rs` 语义）：
- `y` 仅这一次批准
- `a` 本会话不再问（同一智能体档案内自动批准）
- `p` 同一文档 + 同一工具不再问
- `d` 拒绝并要求补充"该怎么改"（必须附中文说明输入框，对应 Codex 的 *differently*）
- `Esc` 取消该条提案

### 6.1 缺口一：工具调用不可靠 → 双路提案协议

本地与国产 OpenAI 兼容端点的小模型 `tool_calls` 支持不齐（缺失或格式漂）。
因此提案来源有两条路，汇聚到同一个 `EditProposal` schema：
1. 原生 `tool_calls`（首选）。
2. 文本块协议：模型在消息里输出
   ` ```mochen-patch {"doc":"chapters/03-x.md","anchor":"…","replace":"…","why":"…"} ``` `，
   由 `agent-runtime/patch-protocol.ts` 解析。

解析器纯函数、无 Electron 依赖，单测覆盖：正常、多块、嵌套围栏、坏 JSON、锚点缺失、
锚点多处命中（判定为歧义，不产出提案，改为向模型回喂"锚点不唯一"）。

### 6.2 缺口二：Esc 语义冲突 → 焦点优先级

Codex 中 Esc 既是 `interrupt_turn` 又是审批 `decline`。桌面端必须定死优先级，实现为单一函数
`resolveEscape(focusState)`，并测试全部组合：
1. 存在聚焦的审批卡或"说明该怎么改"输入框 → 取消该条提案（不吞掉输入内容，输入框非空时仅失焦）。
2. 否则若 turn 运行中 → 打断 turn。
3. 否则 → 无动作（不关闭工作台、不清空草稿）。

### 6.3 缺口三：打断时的残留状态

`Esc` 打断执行 `turn/interrupt`，规则：
1. 已流出的 reasoning / message 文本入库保留，标注 `interrupted: true`。
2. 未完成（参数未收全）的 tool_call 视为不存在，不产出提案。
3. 已生成但未审批的提案保持 pending，状态行显示"已打断 · N 条待审"。
4. 半截正文不写入文稿文件——正文只经审批写入，对话区与文稿区状态严格分离。

## 7. 键位表（首轮实现）

| 键 | 动作 | Codex 出处 |
|---|---|---|
| `Enter` | 提交 | `keymap.rs:1678` |
| `Shift+Enter` / `Ctrl+J` | 输入换行 | `keymap.rs:1687-1692` |
| `Tab`（turn 运行中） | 追加指令排队 | `keymap.rs:1679` |
| `Esc` | 打断当前 turn（见 6.2 优先级） | `keymap.rs:1662` |
| `y` / `a` / `p` / `d` | 审批四态 | `keymap.rs:1933-1938` |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 切文稿标签 | 自有 |
| `Ctrl+1..9` | 跳第 N 个文稿标签 | 自有 |
| `Ctrl+B` | 收/放左栏 | 自有 |
| `Ctrl+Shift+F` | 全书检索 | 自有 |
| `Ctrl+,` | 设置 | 自有 |
| `/` | 斜杠命令面板 | `slash_command.rs:13` |

斜杠命令：`/model /permissions /status /usage /compact /new /resume /fork /clear /export /skills`
+ 写作自有 `/stage /outline /characters`。运行期可用性按 Codex `available_during_task()` 的思路约束。

状态行：`工作中 · 42s · Esc 打断`（对应 "Working (0s • esc to interrupt)"）；
失败原因直接显示在对话流里，不只进日志。

## 8. 密钥与配置

- 模型凭据只进主进程：`%APPDATA%\mochen-writing\secrets.enc`，Electron `safeStorage`（Windows DPAPI）。
- 渲染层拿到的永远是 `hasKey: true` + 掩码串，不接触明文。
- baseURL/key 不进 URL query（deepwrite 同类教训：commit `7229622` "keep the model list credential out of the request URL"）。
- provider 配置：OpenAI 兼容 `baseURL + apiKey + model`，可指向 Ollama / LM Studio / DeepSeek 等。

## 9. 错误处理

| 情形 | 行为 |
|---|---|
| 外部改动了当前章（hash+mtime 不匹配） | 不覆盖；弹冲突对话框，给"重载/保留我的/看 diff"三选 |
| 写盘失败（权限/占用） | 提案回退 pending，错误显示在建议卡上，可重试 |
| provider 网络失败 / 非 2xx | 对话流显示中文原因；turn 落为 failed，不静默 |
| 流中途断（含 429/配额） | 已流出内容保留 + 状态行显示中断原因，支持"继续" |
| 书目录被移动 | 左栏标"失联"，引导重选目录，会话历史仍在 |

## 10. 测试与验收（断言必须能失败）

单元/契约（vitest，纯 node）：
- `fs-store`：扫描书目录、章节排序、frontmatter 往返、冲突检测；反向用例=外部改动时必须拒绝写入。
- `patch-protocol`：见 6.1 的六类用例。
- `agent-runtime`：mock provider 喂确定性事件序列，断言
  `reasoning→message→toolCall→proposal→decision→写盘→备份` 全链；
  反向用例=未批准时文件字节不变；歧义锚点时不产生提案。
- `resolveEscape`：覆盖 6.2 三条分支的每种焦点组合。
- 上下文装配：切阶段/切章时断言上下文包条目集合变化且提示词来源正确。

**变异实验（每片必做一次）**：抽掉关键实现（去掉备份步骤 / 把审批判断反转 / 去掉 pending 保留），
对应断言必须转红；只报"全绿"不算验证。

Electron 冒烟：`pnpm smoke` 启真窗口，用 computer-use 截图核对三栏渲染、标签切换、审批落盘；
Windows 注意——dev 在跑时全量 vitest 会假红灯，用 `--maxWorkers=4` 复核。

UI 验收以真实交互为准：能开真书、能切章、能让模型改出一段正文并审批落盘、能 Esc 打断且内容还在。

## 11. 实施切片

- S1 工程与壳：workspace + electron-vite + 三栏静态 + 毛玻璃主题（截图可验）
- S2 文件层：开书目录、读改章、外部改动冲突检测 + 契约测试
- S3 流式对话：provider client（OpenAI 兼容 SSE）+ reasoning/plan/message 渲染 + 会话 JSONL 落盘
- S4 提案与写盘：工具循环 + 双路提案协议 + diff + 审批 + 备份回滚
- S5 交互层：键位 / 斜杠命令 / 权限档 / 打断与排队 / `resolveEscape`
- S6 阶段装配：档案切换 + 上下文包 + 素材与技能浏览不打断

## 12. 风险

| 风险 | 缓解 |
|---|---|
| 小模型 tool_calls 不可用，提案质量差 | 6.1 文本块协议兜底；实测选 2 个端点验证 |
| 打断语义与审批键在真实 Electron 焦点下行为不符 | `resolveEscape` 单测 + 冒烟实测 |
| `propose_patch` 锚点在长中文正文里不唯一 | 判歧义不写盘，回喂模型要求带上下文；单测覆盖 |
| 外网慢导致安装/模型调用卡顿 | electron 与 pnpm store 已本地命中；S3 起支持本地 Ollama |
| 体量失控（把 deepwrite 的长卷语义再写一遍） | 第 1 节非目标清单；`packages/*` 禁止 import electron 的边界检查 |

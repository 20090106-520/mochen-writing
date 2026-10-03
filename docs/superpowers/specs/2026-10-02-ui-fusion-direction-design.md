# 墨宸 AI 界面方向：B 骨架 + A 气质（融合）设计附录

> 状态：**已获用户裁定的方向**，尚未拆任务、未开工。落地排在 Plan 3 波 1 门禁之后，独立成波（下称「波 1.5」）。
> 本文件是总 spec（`2026-10-01-mochen-writing-workbench-design.md`）与 Plan 3 spec
> （`2026-10-02-plan3-interaction-and-assembly-design.md`）的**界面层附录**，不推翻两者的任何铁律；
> 与两者冲突处一律以两者为准，本附录只补「长什么样、多出哪两块能力」。

## 0. 来源与裁定

用户在 2026-10-02 给了两张墨宸 AI 的界面示意稿（微信临时目录，非仓库资产）：

- **A 稿**（暗色国风 / 金色）：左窄导航 + 中栏品牌 hero 横幅与五张能力卡（主笔创作 / 角色塑造 / 世界构建 /
  大纲规划 / 灵感激发）+ 对话与快捷指令 + 右栏「当前作品 / 快捷入口」双页签，下分
  小说信息 · 人物 · 剧情 · 大纲 · 世界观 · 素材库。
- **B 稿**（亮色三栏）：左导航（新建对话 / 工作目录 / 模型配置 / …）+ 创作空间文档树（人物设计 / 剧情 /
  大纲 / 正文 / 素材库 / 世界观 / 设定集）+ 中栏「从一个正文小节开始」空状态与三条建议行 +
  带 chip 的输入区 + 右栏富文本工具栏、页签（正文 / 人物状态 / 编辑 / 预览）与
  页脚（1832 字 · 约 6 分钟阅读 · 自动保存）。

**裁定**：取 **B 的骨架 + A 的气质**（用户在两个方向选项中明确选「融合」）。
文稿编辑的「插入 md 片段」工具栏用户答「都行」，由控制方拍板：**要**（见 §3 F-F）。

**2026-10-03 追加裁定（用户批准，推翻本附录两条不做项）**：参考仓深写的「智能体对话」确有真通路，
于是「深度思考 / 切模型」chip **解禁**（联网搜索照旧不做），并新增「替我审批」开关，
**只作用在「全开」档**。落点与排期见 §2.1、§2.4、§4 与 §7.4；审批铁律的修订全文在总 spec §6。

**两张稿子的使用边界**：稿中文字有生成噪声（「墨宸 / 星宸」混写、部分标题错字），因此
**只作方向与密度参考，不逐像素复刻**；A 稿那条龙形横幅**不在仓库素材里**，
现有品牌资产只有 `apps/desktop/src/renderer/src/assets/brand/mochen-lockup.jpg`。
按既定约束（品牌原图原样使用、禁止裁切/重绘/另生成），要那条横幅**必须由用户提供原图**，
否则 hero 用现有 lockup 排版。

## 1. 取证：现状与稿子的真实差距

| # | 稿子里有 | 我们现在有什么（行号证据） | 差距性质 |
|---|---|---|---|
| 1 | 中栏空状态是「工作台」（hero + 能力卡 + 建议行） | 空状态只有一行提示文案（`CenterColumn.vue:188+` 的空分支） | **缺能力入口**，不是缺颜色 |
| 2 | 右栏有作品档案（小说信息 / 人物 / 剧情 / 世界观 / 素材） | 右栏只有「文稿 / 浏览」两页签 + textarea（`DocumentPane.vue:130-152`） | **缺一个只读视图** |
| 3 | 左栏顶部三段主操作 | 只有一段「打开作品目录」（`LeftSidebar.vue:75-81`）；模型设置藏在中栏头部按钮（`CenterColumn.vue:174-177`） | 缺导航密度 |
| 4 | 输入区有 chip | `ComposerBox.vue` 只有 textarea + placeholder（`:30`），权限档是头部一个不可点的 `<span class="permission-chip">`（`CenterColumn.vue:173`） | 权限档切换正是 Plan 3 Task 9 |
| 5 | A 的墨青 + 金气质 | `themePresets` 已有 codex / 暖纸 / 海雾三套（`appearanceThemeRuntime.ts:24-45`），但**全仓零消费者，是死代码**；三态开关是 Plan 3 **波 2 Task 19** 的任务（原文误记「波 3」，2026-10-03 按 `2026-10-02-plan3-interaction-and-assembly-design.md:114` 更正） | 缺一个 preset + 缺接线 |
| 6 | 左栏按 kind 分组的树 | `LeftSidebar.vue:14-31` 已按 `chapter/outline/character/plot/material` 分组，数据来自 `scanBook` | **已经对齐，不动** |
| 7 | 页脚字数 / 阅读时长 / 保存态 | `DocumentPane.vue:181-195` 有字数与保存态，无阅读时长 | 小补丁 |

结论：真正要做的有五块新界面（§3 的 F-A…F-E）加一处小补丁（F-G）。
**换肤不在清单里**——`interaction.css`（波 1 Task 8 新建）已经在用 `backdrop-filter` 毛玻璃，
气质方向与既有实现同路，不需要重画任何既有组件。

## 2. 明确不做（这一节是本附录的主要价值）

1. **联网搜索 chip 照旧不做；「深度思考」chip 解禁**（2026-10-03 用户裁定，推翻本附录初稿那条「都不抄」）。
   推翻的理由是对面**有真通路**（参考仓本地克隆 `Desktop\deepwrite`，只读勘探，行号当场回读）：
   模型枚举 `apps/desktop/src/main/list-remote-models.ts:70`（`{base}/v1/models`）、
   思考等级弹层 `apps/desktop/src/renderer/src/components/ConversationModelConfigSelect.vue:286-295`
   （触发按钮 `aria-label="模型配置"`，标题即 `` `${selectedModelLabel} · ${activeParameterLabel}` ``——当前值可见）、
   出网字段映射 `packages/pi-runtime-adapter/src/provider-runtime.ts:188-212`
   （`thinkingLevelMap` + `thinkingFormat`；注释点名某些厂商拒收 `thinking: disabled`，
   所以 `off` 在那儿**降级到最低档**而不是真关掉）。
   于是输入区新增两枚 chip：**当前模型**（点开列远端模型，值就是选中的那个）与
   **思考等级**（档位文案抄一份 `as const` 映射 + 派生类型，铁律：只许一份实现）。
   联网搜索仍不做：它要么破「恰好五工具」天花板（总 spec §6 定义五件套、§5 明写「工具只能从 §6 的 5 个里取子集」），
   要么吃各家私有参数，
   两种都让我们拿不出一致验收。**前提未闭合前 chip 不进 UI**：
   一期支持哪几个厂商的 reasoning 字段格式还没定（§2.7 的判据同样适用——报不出字段名就是摆设）。
2. **不做 WYSIWYG 富文本**。零新依赖 + 800 行单文件门禁下，右栏保持 `textarea` + 只读预览；
   F-F 只做「往光标处插入 md 片段」，改动仍走既有 draft → 提案 → 备份 → 指纹链。
3. **不改三栏 DOM 骨架与类名**（`App.vue:58-107`、`.desktop-shell` 的 grid，`styles.css:137-148`）。
   这三栏结构与 deepwrite 的署名绑定（`App.vue:1-2`），重构它要连带重做署名，收益为零。
4. **审批语义只开一个受控例外**（2026-10-03 用户裁定，见总 spec §6），其余一律不动：
   逐条人审批、`.mochen/changes/` 备份、指纹比对、
   `PROPOSAL_STATUS_LABELS`/`PERMISSION_LABELS`、Esc 裁决优先级（spec §6.2）、
   `queued` 不进 `StartTurnInput`、`schemaVersion` 仍为 1 —— 全部照旧。
   例外只有一句：**「替我审批」是一个开关，且只在「全开」档可开**；
   `只读参考` 与 `可改当前章` 两档没有这个开关，提案永远逐条等人。
   开关不新增任何写盘通路——提案对象、diff、卡片、备份、指纹一条不省，改的只是「谁点那一下」。
   开关状态跟书目录 meta 走（与 `permissionMode` 同处、同一个 `saveMeta`），
   因为它放宽的是写盘行为，作用域必须与档位一致；持久化在**书级**，重启不丢。
5. **不逐像素复刻稿子**，不引入图片切图资产，不加任何 npm 依赖。
6. **术语撞车必须先解决**（见 F-B 的命名裁定）：Plan 3 波 2 的「档案」= **agent profile**
   （`AGENT_PROFILES` 六条，Plan 3 spec §9），A 稿右栏的「档案」= **一本书的资料面板**。
   同一个 UI 里两个「档案」必然出错，所以右栏那一格定名**「作品资料」**，
   「档案」一词在 UI 上永远只指 agent profile。
7. **名字与动作不符也算摆设**（用户 2026-10-02 追加的硬约束：「所有东西都是要真实能用，而不是摆设」）。
   本附录初稿给「灵感激发」卡配的动作是派发 `/status`——那是把体检报告换个好听的名字，
   已删（见 F-A）。判据固定为一条：**任何一个卡 / 按钮 / chip / 页签，必须能当场报出
   它调用的函数名与（如涉及）IPC 通道名；报不出来就不进 UI。**


## 3. 七个改造面

### F-A · 中栏空状态 = 作品工作台（A 稿主体）

- 位置：`CenterColumn.vue:188+` 的空分支，抽成新组件 `components/BookWorkbench.vue`
  （新文件，不往 CenterColumn 里堆 markup——它已有 ≤360 行的自设预算）。
- 内容：品牌区（现有 `mochen-lockup.jpg` 或用户补的横幅原图，**原样使用**）+ 入口卡。
- **卡必须是真动作**，且当场报得出函数名。初稿的五张卡里只留下四张有现成通路的，
  第五张「灵感激发」被删——它唯一能配的动作是 `/status`（把体检报告换个好听的名字），
  等波 2 的 agent profile 落地后它才有真身（换一个智能体人格来出题），届时再加：

  | 卡 | 点击后发生的事（可核对的调用） | 依赖 |
  |---|---|---|
  | 主笔创作 | `useBookStore.openDocTab(当前/第一章 relPath)` → 右栏进文稿态，中栏线程随 `threadKeyFor` 绑定 | 已有 |
  | 角色塑造 | `useBookStore.browse(ref)`，ref 取 `characters/` 分组第一项 | 已有 |
  | 世界构建 | `useBookStore.browse(ref)`，ref 取 `materials/` 分组第一项 | 已有 |
  | 大纲规划 | `useBookStore.browse(ref)`，ref 取 `outline/` 分组第一项 | 已有 |

- **一条前置缺口，不许糊过去**：B 稿那种「点卡预填一句指令再聚焦」的形态今天做不到——
  `ComposerBox.vue:9` 的 `text` 是组件内 `ref`，外部写不进去。要做预填，必须先二选一：
  ① 把输入值上收到 store（按 `threadKey` 存，切章不丢字，顺带解决排队文案的同源性）；
  ② 沿用 `useHotkeys` 已有的 `[data-mochen-composer]` DOM 读写口径 + 派 `InputEvent` 让 `v-model` 同步。
  默认取 ①（判定可单测，②是 DOM 代码，本仓零覆盖）。**这条通路本身是 F-A 的第一个任务**；
  它没落地之前，「主笔创作」卡就叫「打开当前章」，不许用漂亮名字冒充能力。
- 无书时（`hasBook === false`）整块降级成一句引导 + 「打开作品目录」按钮，**不显示死卡**。
  这条判定写成纯函数（`utils/workbench-state.ts`）以便 node 单测——`.vue` 模板在本仓零自动化覆盖。


### F-B · 右栏第三页签「作品资料」（A 稿右栏）

- 位置：`DocumentPane.vue:130-152` 的 `view-tabs` 里加第三格，内容区抽成
  `components/BookDossier.vue`；`rightPaneMode` 联合类型加 `"dossier"`（该字段是渲染层内存态，不落盘）。
- 数据源全用现成的，**不新增 IPC 通道**：`book.meta`（书名 / 阶段 / 权限档 / 章节序）+
  `book.docs`（`scanBook` 的 `DocRef[]`，按 `kind` 分组）。
- 每类文档渲染成摘要卡（标题 + 一段摘要）。摘要来源二选一，本附录定 **(b)**：
  - (a) 现读每篇正文再截断 ⇒ 打开一本书要发 N 次读盘，否掉；
  - (b) 给 `DocRef` 加**可选** `excerpt?: string`，由 `packages/fs-store/src/scan.ts` 在已有的
    `parseFrontmatter` 结果上顺手取第一段纯文本（≤80 字）带上。
    注意 `DocRef` 是 `interface` 不是 zod schema（`contracts/src/book.ts:22-26`），
    跨 IPC 消费处仍要有运行期兜底（`?? ""`），不把缺字段当异常。
- 「世界观 / 设定集」在 A/B 稿里是独立段，我们的 `scanBook` 只认
  `chapters/outline/characters/plot` 四目录、其余全归 `material`（`fs-store/src/scan.ts:8-13`）。
  **不改分类**，只在 `material` 段内按目录名再分组显示。

### F-C · 左栏三段主操作（B 稿导航密度）

- `LeftSidebar.vue:75-81` 的 `primary-nav` 从一段扩成三段：打开作品目录（按钮已有；`Ctrl O` 键标此前
  是**空标**——`utils/hotkeys.ts` 的 Ctrl 族里没有 `o` 这一支，按下什么都不是，本批已接通
  `open-book` ⇒ `book.pickAndOpen()`，键标这才诚实，`Ctrl+O` 行也补进了总 spec §7 与 Plan 3 spec §5 两张键位表）、
  模型配置（把 `CenterColumn.vue:174-177` 的入口**移进来**，中栏头部同时保留，两处走同一个
  `layoutStore.showSettings("general")`，不复制逻辑）、本章新对话（= 当前 `threadKey` 视图重置，
  复用 Task 8 的 `clearThreadView`，**只清渲染层，不碰 JSONL 与 pending**）。
- 「新建对话」不叫「新建会话线程」：一条章永远一条线程（总 spec §5.1 约束 1），
  文案必须诚实说明它清的是屏幕，否则用户以为历史没了。

### F-D · 输入区 chip 只放真开关

- `ComposerBox.vue` 输入框下方一排 chip，**每个都对应一个已存在或已在计划里的状态，且报得出调用点**：
  权限档（`useBookStore.openPermissionMenu()`，菜单真身是 Task 9 的 `PermissionMenu.vue`，
  文案读 `PERMISSION_LABELS`）、
  `/` 命令（emit 一个 `open-palette` 事件，由 `CenterColumn.vue:38` 的 `paletteOpen` 接，
  与裸 `/` 键走同一个 `openPalette`，不复制打开逻辑）。
  勘误（2026-10-03 核对 `utils/hotkeys.ts:78-96` 键位表后修正原句「与 `Ctrl K` 走同一个 `openPalette`」：
  全局 Ctrl 族只有 `b`/`,`/`o`/PageUp/PageDown/`1-9`/`j`，全仓无 Ctrl+K，面板真身在 `:98-100` 的裸 `/` 键）；
  「是否给面板新增真 Ctrl+K 键位」登记为独立开放项（task #91：那是键位表变更，要动 `resolveHotkey`
  穷尽分支 + 键位矩阵测试），不在波 1.5 范围。
- **2026-10-03 追加三枚**（同一判据：报得出函数名与通道名才进 UI）：
  **当前模型**（值 = `ProviderView.model`，点开走新的模型枚举通道 `{baseURL}/v1/models`，见 §2.1）、
  **思考等级**（档位映射一份 `as const`，出站字段名待厂商格式范围定案 ⇒ **定案前只做主进程侧，不发 chip**）、
  **替我审批**（只在 `permissionMode === "full-access"` 时可见，写回同一个 `saveMeta`，
  纯函数判定 `composer-chips.ts` 里给一条「非全开档必然不可见」的反向用例）。
- **排队那一格不做成 chip**：它今天只有「显示 `queued.length`」这一件事可做，点开没有面板，
  所以按 `<span>` 徽标处理（与 `ComposerBox.vue:37` 的 `.composer-hint` 同一姿态）。
  只有真做出「点开看队列 / 撤回某条」的面板时，才升格成按钮——**按了没反应的 button 就是摆设**。
- 样式并入 `styles/interaction.css`（Task 8 已建，毛玻璃基调一致），不新开样式文件。
- 纯函数判定（哪个 chip 在什么状态下可见/可点）落在 `utils/composer-chips.ts` 并单测。


### F-E · 主题：加「墨宸 · 青金」preset 并把 preset 选择器接上

- 在 `appearanceThemeRuntime.ts:24-45` 的 `themePresets` 加第四条
  `{ id: "mochen-ink", label: "墨宸 · 青金", dark: { 墨青底 + 金强调 }, light: { 纸白底 + 深墨青强调 } }`，
  **照现有 `ThemePreset` 形状**，不新造 token 层（`--surface-main` 等由
  `applyAppearanceThemeToDocument` 统一注入）。
- 顺带治死代码：`themePresets` 今天全仓零消费者，**波 2 Task 19** 的「跟随系统 / 浅色 / 深色」三态开关落地时
  必须同时把 **preset 选择器**接进外观设置，否则四套预设仍是四套摆设。
  外观设置的既有结构：`ProviderSettings.vue`（分类页签，`layoutStore.showSettings(category)`）。
- A 稿的金色**只进 preset 的 accent**，不写死在任何组件里——`styles.css:40` 的 `--focus`
  与 `interaction.css:2` 的告警（`--accent` 系并未在 `:root` 定义）说明：新组件一律吃 `--focus`，
  硬编码色值算 P1 缺陷。

### F-F · 右栏「插入 md 片段」工具栏（用户答「都行」，控制方拍板：要）

- 位置：`DocumentPane.vue:130-152` 的 `editor-toolbar` 右侧，浏览态隐藏。
- 动作：对 `textarea` 选区做**纯字符串**包装/前缀（加粗、标题、列表、引用），
  实现放 `utils/markdown-snippets.ts`（可 node 单测，含空选区、跨行、光标在中间三类反向用例），
  结果只经 `book.onEdit(value)` 进 draft ⇒ 与手打完全同路，**不新增写盘路径**。
- 明确不是富文本：不改 DOM、不引 contenteditable。
- **2026-10-04 #113a 更正两处原口径**：① 位置不再靠 `toolbar-spacer` 推到行尾，而是照参考仓的
  `.editor-toolbar` 左排——分段控件与工具组之间放一枚 `.toolbar-separator` 竖线；
  ② 按钮上画的是字形（`.format-button` 27×27 + `AppIcon` 16，与参考仓 `.text-tool-button` 同值），
  中文标签退居 `aria-label` 与 `title`（灰态 `title` 是空串，没有可及名就读屏只剩一句「按钮」），
  并补上第五种片段**斜体**（`*` 成对标记，与加粗同一条纯函数通路）。
  标题那枚字形是本仓自造的（参考仓图标表里没有标题），已在 `docs/ATTRIBUTION.md` 登记。

### F-G · 页脚补「约 N 分钟阅读」（B 稿页脚）

- `DocumentPane.vue:181-195` 已有字数，加一格估算阅读时长。
  换算函数进 `utils`（中文按 300 字/分钟，向上取整，0 字显示「— 分钟」）并单测，
  不在模板里写算术。

## 4. 与 Plan 3 三波的关系和排期

| 波 | 内容 | 与本附录 |
|---|---|---|
| 波 1（Task 1–10） | 回放 + 键位 + `/` 面板 + 权限档菜单 | **先跑完并过门禁**，F-A/F-D 直接复用它的 `runSlashCommand` 与 `PermissionMenu` |
| 波 2（Task 11–20） | 六档案（agent profile）+ 上下文占用条 + 外观 | 术语撞车方在这里（§2 第 6 条）；F-E 的 preset 与三态开关同题 |
| 波 3（Task 21–27） | 技能 + F-4 品牌迁移 + 总账 | （原文写「F-E 的 preset 选择器接线在这里」，2026-10-03 更正：接线在**波 2 Task 19**，波 3 不再背这条） |
| **波 1.5（本附录）** | F-A…F-G | 拆任务排在波 1 门禁之后、波 2 之前，**因为它只碰渲染层，与波 2 的 runtime 主线不抢文件** |

**为什么插在这里**：F-A…F-G 全在 `apps/desktop/src/renderer/src/`，与波 2 的
`packages/agent-runtime` 几乎不相交；唯一交集是 `CenterColumn.vue`（波 2 Task 18 要改头部）
和 `DocumentPane.vue`。因此波 1.5 的两条硬约束是：新 UI 一律**分文件**，
`CenterColumn.vue` 保持 ≤400 行、`DocumentPane.vue` 保持 ≤220 行，超限即拆。

**Task 9 未落地前 F-D 的权限 chip 不实现**（它等的就是 `PermissionMenu.vue`），
所以波 1.5 内部顺序是：F-B → F-A → F-C → F-D → F-F → F-G（**F-E 已挪出本波**，见下面的第 4 条）。

**2026-10-03 追加的两件事不在波 1.5**（它们破了「本波只碰渲染层」这条前提，别硬塞）：

1. **模型枚举与切换**：要新增主进程侧 `{baseURL}/v1/models` 调用与一条 IPC 通道 ⇒ 动契约，
   归**波 2**（那波本来就把 IPC 从 13 抬到 17，多一条就在总账里连带改计数与用例）。
2. **「替我审批」开关**：可见性判定在渲染层（F-D 那枚 chip），但**生效点在主进程**
   （谁替这条提案按下批准），要动 `agent-service` 的审批链与 `permission.ts` 的判定入参 ⇒ 归**波 3**，
   与 F-4 主进程改动同批过门禁。
3. 连带一处文案要改口径：Plan 3 计划里波 2 的档案 prompt 写着
   「两条通路都只是提案，只有用户逐条批准后才落盘」
   （`plans/2026-10-02-plan3-interaction-and-assembly.md:5343`）。
   开关未落地前这句话仍然为真；**开关落地那一版必须同步改成**
   「除「全开」档开了替我审批之外，逐条由你批准」，否则我们对自己发一句假话
   （§2.7：名字与动作不符也算摆设）。

## 5. 验收

1. 门禁：`corepack pnpm verify` 末尾必须回读到 `VERIFY_EXIT=0` 与用例总数（管道会吞退出码）；
   `tools/check-source-line-budget.mjs`（800 行）与 `tools/check-package-boundary.mjs` 双绿；
   渲染层新纯函数（`workbench-state` / `composer-chips` / `markdown-snippets` / 阅读时长）
   **每个都要有反向用例，且断言必须先红后绿 + 自跑变异**（本项目反复踩的坑：恒真断言）。
2. 真机冒烟（控制方本人操作，不委托）：
   - 打开示例书 → 中栏出现工作台五卡，逐卡点一遍，**每张都要产生可见状态变化**（无死卡）；
   - 无书时中栏不出现五卡；
   - 右栏「作品资料」页签：五类分组 + 摘要正确，切过去再切回「文稿」，**草稿与标签不受影响**；
   - 三 chip 全可点且反映真状态（权限档改档要真写 `book.json`，重启后保持）；
   - 主题切「墨宸 · 青金」后重启保持；`grep` 确认新组件里没有硬编码色值；
   - md 片段插入后走一次真提案 → 审批 → `.mochen/changes/<时间戳>/` 备份生成；
   - 既有七项冒烟（spec §16）不回归，尤其 Esc 打断与四键审批。
3. 交付定义：**每一面都要能指出「点下去发生什么、数据从哪来」**，只改配色不算交付。
   冒烟时逐张卡 / 逐个 chip 当场报出它调用的函数名并真的点一次，产生不了可见状态变化的一律退回。

**2026-10-03 拆任务后的验收校正（以 `plans/2026-10-03-plan3-wave1-5-ui-fusion.md` 为准，本节的原话保留不改史）**：
上面第 2 条里的「五卡」「三 chip」「主题切『墨宸 · 青金』」三处数字与本波实际交付不符 ——
工作台是**四卡**（第五张「灵感激发」没有可配的真实动作，按 §2.7 不进 UI，留波 2 的档案落地后再说）；
chip 行是**两枚**（权限 + `/`，另三枚分别归波 2 / 波 3 / 未决，见 §4 的 2026-10-03 追加），
排队那一格按**裁定 C** 只做静态提示句、不做带数字的徽标；
「墨宸 · 青金」preset（F-E）**整条挪出本波**，随波 2 Task 19 的三态开关与 `appearance.json` 一起出生——
在那之前 `themePresets` 仍零消费者，本波加第四条就是新摆设。

## 6. 存量摆设清单（2026-10-02 静态审计，逐条有主）

用户这条约束不只约束新界面，所以顺手查了已经在你屏幕上的东西：

| 存量 | 证据 | 性质 | 谁修 |
|---|---|---|---|
| `themePresets` 三套主题预设 | `appearanceThemeRuntime.ts:24-45`，**全仓零消费者** | 真摆设（写了没人读的代码） | F-E + **波 2 Task 19** 三态开关接线（原记「波 3」，2026-10-03 更正） |
| 权限档那一格 | `CenterColumn.vue:173` 是 `<span class="permission-chip">`，显示状态但点不动 | 半摆设（诚实显示，未冒充按钮） | Plan 3 Task 9（本波进行中） |
| 五工具 / 三档 / `/` 面板 6 条命令 | `runSlashCommand` 每条都有真分支；`stage` 被 `GATED_COMMANDS` **滤掉不列**，绕过面板直调时回一句实话（`useAgentStore.ts:555-558`） | 合规：不列出来冒充能力，与「列出来但按下去报错」的禁止口径一致 | 不修 |
| 图标集 48 个 | `types/icons.ts` 48 名 vs `AppIcon.vue` 48 个绘制分支，**无一名无图形** | 合规（今天只用其中 ~14 个，其余是已绘制的备用，不是空壳） | 不修 |
| 输入区三键（发送 / 打断 / 继续） | `ComposerBox.vue:38-60`，分别 emit `send` / `stop` / `resume`，全部落到 store 真动作 | 合规 | 不修 |
| 模型设置弹窗 | `ProviderSettings.vue:15-44`，`providerView()` 读、`providerSave()` 写，密钥只显示 `keyMask` | 合规 | 不修 |


## 7. 未决（需要用户点头才能推进的四项）

1. **横幅原图**：A 稿那条龙形横幅要不要用？要用请给原图文件；不给就用现有 lockup 排版（默认）。
2. **波 1.5 是否要独立成 Plan 4**：本附录按「Plan 3 与总 spec 的界面附录」写，
   拆任务时若超过 12 个任务就升格为 Plan 4 并另立计划文件。
3. **金色占比**：A 稿金是主强调色。默认只在 dark preset 用金做 accent，light 用深墨青，
   避免亮色下金色对比度不足（WCAG 文本对比）。
4. **思考等级一期支持哪几个厂商的出站字段格式**（2026-10-03 随 §2.1 解禁产生）：
   照抄一份 `thinkingLevelMap` 还是只认 OpenAI 兼容的 `reasoning_effort`，
   决定这条要不要动 `agent-runtime` 的请求体构造。**定案前「思考等级」chip 不进 UI**。

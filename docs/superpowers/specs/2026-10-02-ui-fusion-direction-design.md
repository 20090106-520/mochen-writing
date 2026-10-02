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
| 5 | A 的墨青 + 金气质 | `themePresets` 已有 codex / 暖纸 / 海雾三套（`appearanceThemeRuntime.ts:24-45`），但**全仓零消费者，是死代码**；三态开关是 Plan 3 波 3 的任务 | 缺一个 preset + 缺接线 |
| 6 | 左栏按 kind 分组的树 | `LeftSidebar.vue:14-31` 已按 `chapter/outline/character/plot/material` 分组，数据来自 `scanBook` | **已经对齐，不动** |
| 7 | 页脚字数 / 阅读时长 / 保存态 | `DocumentPane.vue:181-195` 有字数与保存态，无阅读时长 | 小补丁 |

结论：真正要做的有五块新界面（§3 的 F-A…F-E）加一处小补丁（F-G）。
**换肤不在清单里**——`interaction.css`（波 1 Task 8 新建）已经在用 `backdrop-filter` 毛玻璃，
气质方向与既有实现同路，不需要重画任何既有组件。

## 2. 明确不做（这一节是本附录的主要价值）

1. **不抄 A 稿的「深度思考 / 联网搜索」chip**。我们没有这两条通路（五工具是天花板，
   总 spec §4 铁律），放上去就是假按钮。输入区只放**真开关**（见 F-D）。
2. **不做 WYSIWYG 富文本**。零新依赖 + 800 行单文件门禁下，右栏保持 `textarea` + 只读预览；
   F-F 只做「往光标处插入 md 片段」，改动仍走既有 draft → 提案 → 备份 → 指纹链。
3. **不改三栏 DOM 骨架与类名**（`App.vue:58-107`、`.desktop-shell` 的 grid，`styles.css:137-148`）。
   这三栏结构与 deepwrite 的署名绑定（`App.vue:1-2`），重构它要连带重做署名，收益为零。
4. **不动审批语义、键位表、契约标签**：逐条人审批、`.mochen/changes/` 备份、指纹比对、
   `PROPOSAL_STATUS_LABELS`/`PERMISSION_LABELS`、Esc 裁决优先级（spec §6.2）、
   `queued` 不进 `StartTurnInput`、`schemaVersion` 仍为 1。
5. **不逐像素复刻稿子**，不引入图片切图资产，不加任何 npm 依赖。
6. **术语撞车必须先解决**（见 F-B 的命名裁定）：Plan 3 波 2 的「档案」= **agent profile**
   （`AGENT_PROFILES` 六条，Plan 3 spec §9），A 稿右栏的「档案」= **一本书的资料面板**。
   同一个 UI 里两个「档案」必然出错，所以右栏那一格定名**「作品资料」**，
   「档案」一词在 UI 上永远只指 agent profile。

## 3. 六个改造面

### F-A · 中栏空状态 = 作品工作台（A 稿主体）

- 位置：`CenterColumn.vue:188+` 的空分支，抽成新组件 `components/BookWorkbench.vue`
  （新文件，不往 CenterColumn 里堆 markup——它已有 ≤360 行的自设预算）。
- 内容：品牌区（现有 `mochen-lockup.jpg` 或用户补的横幅原图，**原样使用**）+ 五张入口卡。
- **卡必须是真动作**，映射到已经存在或已在计划里的通路，且沿用波 1 Task 8 刚建好的派发口
  `useAgentStore.runSlashCommand` / `utils/slash-commands.ts`：

  | 卡 | 点击后发生的事 | 依赖 |
  |---|---|---|
  | 主笔创作 | 预填「续写当前章」类指令并聚焦输入区 | 已有 thread + `send` |
  | 角色塑造 | 打开 `characters/` 分组第一项到右栏浏览 | 已有 `book.browse` |
  | 世界构建 | 打开/新建 `materials/` 世界观文档到右栏浏览 | 已有 `browseContents` |
  | 大纲规划 | 打开 `outline/` 分组第一项到右栏浏览 | 已有 `book.browse` |
  | 灵感激发 | 派发 `/status`（先给作品与上下文体检，不造新工具） | Task 8 `runSlashCommand` |

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

- `LeftSidebar.vue:75-81` 的 `primary-nav` 从一段扩成三段：打开作品目录（已有，`Ctrl O` 键标保留）、
  模型配置（把 `CenterColumn.vue:174-177` 的入口**移进来**，中栏头部同时保留，两处走同一个
  `layoutStore.showSettings("general")`，不复制逻辑）、本章新对话（= 当前 `threadKey` 视图重置，
  复用 Task 8 的 `clearThreadView`，**只清渲染层，不碰 JSONL 与 pending**）。
- 「新建对话」不叫「新建会话线程」：一条章永远一条线程（总 spec §5.1 约束 1），
  文案必须诚实说明它清的是屏幕，否则用户以为历史没了。

### F-D · 输入区 chip 只放真开关

- `ComposerBox.vue` 输入框下方一排 chip，**每个都对应一个已存在或已在计划里的状态**：
  权限档（Task 9 的 `PermissionMenu.vue` 触发口，显示 `PERMISSION_LABELS`）、
  `/` 命令（打开 SlashPalette，与 `Ctrl K` 同一条 `openPalette`）、
  排队数（`QUEUED_MAX` 那条已有状态，`queued > 0` 才出现）。
- 样式并入 `styles/interaction.css`（Task 8 已建，毛玻璃基调一致），不新开样式文件。
- 纯函数判定（哪个 chip 在什么状态下可见/可点）落在 `utils/composer-chips.ts` 并单测。

### F-E · 主题：加「墨宸 · 青金」preset 并把 preset 选择器接上

- 在 `appearanceThemeRuntime.ts:24-45` 的 `themePresets` 加第四条
  `{ id: "mochen-ink", label: "墨宸 · 青金", dark: { 墨青底 + 金强调 }, light: { 纸白底 + 深墨青强调 } }`，
  **照现有 `ThemePreset` 形状**，不新造 token 层（`--surface-main` 等由
  `applyAppearanceThemeToDocument` 统一注入）。
- 顺带治死代码：`themePresets` 今天全仓零消费者，波 3 的「跟随系统 / 浅色 / 深色」三态开关落地时
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

### F-G · 页脚补「约 N 分钟阅读」（B 稿页脚）

- `DocumentPane.vue:181-195` 已有字数，加一格估算阅读时长。
  换算函数进 `utils`（中文按 300 字/分钟，向上取整，0 字显示「— 分钟」）并单测，
  不在模板里写算术。

## 4. 与 Plan 3 三波的关系和排期

| 波 | 内容 | 与本附录 |
|---|---|---|
| 波 1（Task 1–10） | 回放 + 键位 + `/` 面板 + 权限档菜单 | **先跑完并过门禁**，F-A/F-D 直接复用它的 `runSlashCommand` 与 `PermissionMenu` |
| 波 2（Task 11–20） | 六档案（agent profile）+ 上下文占用条 + 外观 | 术语撞车方在这里（§2 第 6 条）；F-E 的 preset 与三态开关同题 |
| 波 3（Task 21–27） | 技能 + F-4 品牌迁移 + 总账 | F-E 的 preset 选择器接线在这里 |
| **波 1.5（本附录）** | F-A…F-G | 拆任务排在波 1 门禁之后、波 2 之前，**因为它只碰渲染层，与波 2 的 runtime 主线不抢文件** |

**为什么插在这里**：F-A…F-G 全在 `apps/desktop/src/renderer/src/`，与波 2 的
`packages/agent-runtime` 几乎不相交；唯一交集是 `CenterColumn.vue`（波 2 Task 18 要改头部）
和 `DocumentPane.vue`。因此波 1.5 的两条硬约束是：新 UI 一律**分文件**，
`CenterColumn.vue` 保持 ≤400 行、`DocumentPane.vue` 保持 ≤220 行，超限即拆。

**Task 9 未落地前 F-D 的权限 chip 不实现**（它等的就是 `PermissionMenu.vue`），
所以波 1.5 内部顺序是：F-B → F-A → F-C → F-D → F-E → F-F → F-G。

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

## 6. 未决（需要用户点头才能推进的三项）

1. **横幅原图**：A 稿那条龙形横幅要不要用？要用请给原图文件；不给就用现有 lockup 排版（默认）。
2. **波 1.5 是否要独立成 Plan 4**：本附录按「Plan 3 与总 spec 的界面附录」写，
   拆任务时若超过 12 个任务就升格为 Plan 4 并另立计划文件。
3. **金色占比**：A 稿金是主强调色。默认只在 dark preset 用金做 accent，light 用深墨青，
   避免亮色下金色对比度不足（WCAG 文本对比）。

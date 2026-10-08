# 2026-10-08 · 第二刀：没有画面的那一族整族删除（皮肤广场收口）

> 台账单独成文，不并进 `README.md`：那份文件的工作区里压着 5-㊶（IME / 左栏 / 弹层 / 键位）
> 那 185 行未提交改动，属于另一条线。这一刀的记录写在这里，两边都不被对方的树拖累。

## 这一刀判的是什么

用户原话（2026-10-08，推翻同日早些时候 5-㊷ 的处置）：

> 「我没说明白吗把没有皮肤没有图片的全删了，只保留有图片有皮肤的，然后再继续增加」

5-㊷ 我做的是**下架但不销毁**：十套素面配色搬进 `appearanceTones.ts` 继续当「配色底版」，
并从它派生出 `themePresets` 那一族投影。用户判的就是这个——换个名字把不要的东西继续摆在代码里。

## 删了什么

| 对象 | 处置 |
| --- | --- |
| `composables/appearanceTones.ts`（十套素面底版） | **整份删除** |
| `composables/appearanceThemeRuntime.ts` 的 `ThemePreset` + `themePresets` 投影 | **删除**（界面上本来就没有入口，只有守卫在读） |
| `composables/appearance-theme-presets.test.ts`（那一族的对账守卫） | **随投影一起删除** |
| `AppearancePanel.vue` 的第二档兜底（「素面配色，不在广场里卖」） | **删除**，两档变一档：广场表 → 「未知的一套」 |
| 广场说明里「下架不等于销毁 / 配色底版仍可用」那两句 | **改口**为「已经整套删除」 |

保留的边界，逐条写明理由：

- **五套改编皮从上游搬来的数值仍留在 `appearanceSkinVisual.ts`**。但**留下的理由换了**：
  原先写的是「老用户盘上存着 `glass: "standard"`、`grid: "industrial"`，运行时还得按原值渲染」，
  而第二刀的回落走 `patchSettingsWithSkin`，会把四层连同三色**整份覆写**——那些老层取值不再上屏。
  真实理由只剩一条：这些档名过不了 zod 就整份退默认（`appearance-store.test.ts` 钉着那个退法），
  那些人什么也没点，却连「你原来那套已经删除」都听不到。
  ⇒ 用户可见文案里那句假话**已删**；理由改由 `appearance-skins.test.ts` 新增那组守卫钉住，
  并额外钉「除昼阁复用的 `aurora` 之外，这些档名没有皮肤在用」——把当前真实的消费面钉死，
  哪天给界面加了逐层选择器，这条会先红。
- `APPEARANCE_ARTS` 仍含 `"none"`、`preset` 仍降级为 `skin` 的镜像：老 JSON 要解析得动。
- 已删的十个 id **不许被新皮肤复用**（守卫里另抄一份字面量）：复用了就会骗过回落通路。

## 回落通路（新能力，不是改配色）

盘上存着已删 id 的，`useAppearanceStore.load()` 过一次 `reconcileStoredSkin`：
回落成广场第一套、把原 id 交给 `replacedSkinId`，外观页据此说一句带原 id 的真话。
**只改内存不写盘**——静默重写别人的 `appearance.json` 比「界面退回默认」更重，
用户主动点一次才由 `update()` 正常落盘，同时那句提示收起。

## 证据

变异（每条先红后绿，红的位置指名道姓，只用 Edit 改代码）：

| 变异 | 红在 |
| --- | --- |
| M-A 把「运行时还得按原值渲染」放回广场说明 | plaza 那条反向禁词 |
| M-B 把两句说明合成一段并折行 | 新增的「每句各占一行源码」结构守卫 |
| M-C 从 `APPEARANCE_BACKDROPS` 抽掉 `nebula` | 「档名仍在枚举里」+「老 JSON safeParse 得过」（另牵连既有的中文名表对应，属正确 collateral） |
| M-D 把昼阁背景从 `aurora` 改成 `plain` | 「消费面只剩一条」+ 既有的出厂默认漂移守卫 |

真机（CDP 自起实例，端口 9234，PID 只杀自己那台；用户那台 9222 / PID 25068 全程未碰）：
把用户盘上 `appearance.json` 的 `skin` 临时写成已删的 `paper` 起实例，**30 项全过**——
广场只剩 `xi-day` / `xi-night` 两张卡且每张都画出画面层；`replacedSkinId === "paper"`；
外观页那句是「你原来存的「paper」已经删除……现在用的是汐 · 昼阁」；
`--skin-art-image` 指向 `shallow-hall-day.jpg`、accent 是昼阁的 `#2A7699`；
实例读盘之后那份 JSON 字节未变（`eed40852…` / 787 字节）⇒ 回落不写盘拿到实证。
收尾已还原成开工前那份（`f5628b8a…` / 793 字节 / `xi-night`，`cmp` 逐字节一致）。

门禁（逐段取码 + 回读日志内容，不用管道吞码）：
`typecheck / eslint / boundary / budget / format / test` 六段全 0，
`Test Files 209 passed`、`Tests 2931 passed`，日志 grep 无 `FAIL` / `AssertionError` / `ELIFECYCLE`。
`pnpm --filter @mochen/desktop build` 亦为 0（真机跑的是新包：`index-CNRPLw8S.js`）。

## 这一刀顺带撞见的两件事（都是谓词在撒谎，不是代码）

1. **prettier 会把 `<p>` 里的长中文按 printWidth 折行，并在折点补一个真空格**，
   浏览器照画：屏幕上出现「搬的都是参数， 换上去」「老用户盘上存着 那些四层取值」。
   逐句 `toContain` 抓不到它（读的是拼起来的原文）⇒ 现在每句各占一个 `<p>` 且**源码里各占一行**，
   由 M-B 那条结构守卫钉住。CJK 在 printWidth 里按 2 计，所以一句约 36 个汉字就会触到折行线。
2. **`TaskStop` 停不掉 electron 的子进程树**：通知报 killed，`netstat` 上 9234 仍在 LISTENING，
   要再 `taskkill //F //T //PID` 才真干净。后台任务的退出码/状态一律不是证据。

## 还没做完

- **继续增加带画皮肤**卡在 ImageGen 配额（`403 code 112`，本轮又试了一次仍 403）。
  素材规格单已在 `docs/superpowers/specs/2026-10-08-skin-art-asset-spec.md`；
  新增一条 art 要同时进四处：`APPEARANCE_ARTS`、`SKIN_ART_IMAGES`、中文档名表、皮肤表。
- **挂件层运行时**（波1b：token + data 属性 + CSS 挂位）未开工。
- `.skin-card-origin` 用的是 `--text-tertiary`（对页底 2.87:1）——夜阁那张卡上这行「墨宸原创画面 · 本仓自有」
  在截图里确实发虚。这是 5-㊶ 就记下、至今**未定线**的那一条，不是这一刀新引入的。

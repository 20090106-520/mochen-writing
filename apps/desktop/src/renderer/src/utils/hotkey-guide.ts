/**
 * 快捷键指南（设置浮层「快捷键」页的展示表）。
 *
 * 键位判定的唯一真身在 utils/hotkeys.ts 的 resolveHotkey + utils/escape-policy.ts——
 * 本表只是给屏幕读的摘要，与判定层的一致性由 hotkey-guide.test.ts 钉死：
 * 每一行的 needle 必须能在 hotkeys.ts（或 escape-policy.ts）源码里找到，抄错键名测试即红。
 *
 * 【不许出现的键族】判定层只认三族：裸键 / Ctrl / Ctrl+Shift——**没有 Ctrl+Alt**
 * （Ctrl+Alt 一律落到 none）。所以速查表里带 Ctrl+Alt 的行都是死行：
 * 2026-11-20 删掉的那行「Ctrl Alt F → 专注模式」就是（专注模式 2026-10-05 整条下线），
 * 而它当时写的 needle `k === "f"` 命中的其实是 **Ctrl+F** 那一行——
 * 于是 needle 契约「看着是绿的」，屏上却教着一枚按不出来的键。
 */
export interface HotkeyGuideRow {
  /** 屏显键名（kbd 文案）。 */
  readonly keys: string;
  /** 一句话说明。 */
  readonly label: string;
  /** 生效前提（「随时」= 全局放行，其余写清焦点条件）。 */
  readonly when: string;
  /** 该行在判定层源码里的锚点（测试用，不进 UI）。 */
  readonly needle: string;
}

export interface HotkeyGuideGroup {
  readonly title: string;
  readonly rows: readonly HotkeyGuideRow[];
}

export const HOTKEY_GUIDE: readonly HotkeyGuideGroup[] = [
  {
    title: "全局",
    rows: [
      { keys: "Ctrl ,", label: "打开 / 关闭设置", when: "随时", needle: 'k === ",' },
      {
        keys: "Shift ?",
        label: "打开本页（快捷键指南）",
        when: "焦点不在输入框或文本输入里",
        needle: 'k === "?"'
      },
      { keys: "Ctrl O", label: "打开作品目录", when: "随时", needle: 'k === "o"' },
      {
        keys: "Ctrl F",
        label: "文内查找 / 替换",
        when: "右栏停在正文视图时",
        needle: 'if (k === "f") return { action: "open-find-replace" };'
      },
      { keys: "Ctrl B", label: "收起 / 展开左栏", when: "随时", needle: 'k === "b"' },
      {
        keys: "Ctrl PageDown / Ctrl PageUp",
        label: "下一枚 / 上一枚页签",
        when: "已打开一本书",
        needle: 'k === "PageDown"'
      },
      {
        keys: "Ctrl 1–9",
        label: "跳到第 N 枚页签",
        when: "已打开一本书",
        needle: "/^[1-9]$/.test(k)"
      },
      {
        keys: "Ctrl = / Ctrl -",
        label: "放大 / 缩小界面字号",
        when: "随时（文本框里也生效）",
        needle: 'if (k === "=" || k === "+") return { action: "zoom-in" };'
      },
      {
        keys: "Ctrl 0",
        label: "界面字号回到默认档",
        when: "随时",
        needle: 'if (k === "0") return { action: "zoom-reset" };'
      }
    ]
  },
  {
    title: "对话输入框",
    rows: [
      {
        keys: "Enter",
        label: "发送",
        when: "输入框聚焦且没有正在运行的轮次",
        needle: 'k === "Enter" && focus.composerIsFocused && bare'
      },
      {
        keys: "Shift Enter",
        label: "换行",
        when: "输入框聚焦",
        needle: 'if (mods.shift) return { action: "newline" };'
      },
      {
        keys: "Ctrl J",
        label: "换行",
        when: "输入框聚焦",
        needle: 'k === "j"'
      }
    ]
  },
  {
    title: "轮次运行时",
    rows: [
      {
        keys: "Tab",
        label: "把输入框里的内容排队",
        when: "轮次运行中、输入框有字、焦点不在文本输入里",
        needle: 'k === "Tab" && noMods'
      },
      {
        keys: "Esc",
        label: "打断当前轮次",
        when: "没有更内层的浮层 / 草稿要收（裁决链见 Esc 一节）",
        needle: "turnRunning"
      }
    ]
  },
  {
    title: "审批卡（聚焦待审卡时）",
    rows: [
      { keys: "Y", label: "批准这一次", when: "待审卡聚焦", needle: 'y: "approve-once"' },
      { keys: "A", label: "本会话都批准", when: "待审卡聚焦", needle: 'a: "approve-session"' },
      { keys: "P", label: "只批准到选定前缀", when: "待审卡聚焦", needle: 'p: "approve-prefix"' },
      { keys: "D", label: "拒绝（转说明框）", when: "待审卡聚焦", needle: 'd: "deny-guidance"' }
    ]
  },
  {
    title: "面板（随时开合）",
    rows: [
      {
        keys: "Ctrl Shift F",
        label: "全文搜索",
        when: "随时",
        needle: 'f: "search"'
      },
      {
        keys: "Ctrl Shift N",
        label: "笔记",
        when: "随时",
        needle: 'n: "notes"'
      },
      {
        keys: "Ctrl Shift T",
        label: "提示词模板",
        when: "随时（只开不翻）",
        needle: 't: "templates"'
      },
      {
        keys: "Ctrl Shift O",
        label: "大纲视图",
        when: "随时",
        needle: 'o: "outline"'
      },
      {
        keys: "Ctrl Shift G",
        label: "写作目标",
        when: "随时",
        needle: 'g: "goals"'
      },
      {
        keys: "Ctrl Shift B",
        label: "故事圣经",
        when: "随时",
        needle: 'b: "story-bible"'
      },
      {
        keys: "Ctrl Shift P",
        label: "循环编辑视图（编辑 / 分栏 / 预览）",
        when: "随时",
        needle: 'p: "editor-view"'
      }
    ]
  },
  {
    title: "行内引用菜单（输入 / 或 @ 唤起）",
    rows: [
      {
        keys: "↑ / ↓",
        label: "挪动高亮",
        when: "菜单开着且输入框聚焦",
        needle: 'k === "ArrowUp"'
      },
      {
        keys: "Enter",
        label: "插入选中的那条",
        when: "菜单开着且输入框聚焦",
        needle: 'k === "ArrowDown"'
      },
      { keys: "Esc", label: "收起菜单", when: "菜单开着", needle: "referenceMenuIsOpen" }
    ]
  }
];

/** Esc 裁决链的唯一真身在 utils/escape-policy.ts，这里给屏幕读的顺序摘要（与其头注逐字一致）。
 * 5-㊷ 补上「收查找替换」与「收皮肤浮层」两支：摘要漏一支不是文案旧了，
 * 而是屏幕上教用户的收层顺序比实际少一层——用户按第一下发现关的是别的东西。 */
export const ESCAPE_POLICY_SUMMARY =
  "说明框保字 > 取消该条 > 收查找替换 > 收行内引用菜单 > 收皮肤浮层 > 收设置浮层 > 打断 > 无动作";

/** 摘要行的前缀标签（「键名不许在 .vue 里出现」的契约把这一个词也算键位文案，故同住数据侧）。 */
export const ESCAPE_NOTE_PREFIX = "Esc 裁决链：";

import { describe, expect, it } from "vitest";
import type { HotkeyMods } from "./hotkeys";
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_DESCRIPTIONS,
  availableCommands,
  matchPermissionMode,
  popoverOwnsKey
} from "./slash-commands";

const NO_GATE = { hasBook: true, turnRunning: false };
/** 四个修饰键全不按下——弹层只认这一种（判据真身在 utils/hotkeys.ts 的 hasNoMods）。 */
const NO_MODS: HotkeyMods = { ctrl: false, shift: false, alt: false, meta: false };

describe("slash-commands · 枚举与说明表（铁律 6：一张表，穷尽键）", () => {
  it("终态 8 条，顺序即面板顺序（spec §6：`skills` 随技能库一起进表；`plugins` 随插件面板进表）", () => {
    // 【改成钉新决定，不放宽断言】2026-10-07 批次 5-㉚ 加了插件面板，于是加一条 `plugins`。
    // 位置放在 `skills` 之后：两者都是「装在应用里的东西」，摆在一起说得通。
    expect([...SLASH_COMMANDS]).toEqual([
      "model",
      "permissions",
      "status",
      "stage",
      "skills",
      "plugins",
      "resume",
      "clear"
    ]);
  });

  it("每条命令都有中文说明，且说明表不多不少一个键", () => {
    expect(Object.keys(SLASH_COMMAND_DESCRIPTIONS).sort()).toEqual([...SLASH_COMMANDS].sort());
    for (const command of SLASH_COMMANDS) {
      expect(SLASH_COMMAND_DESCRIPTIONS[command].length).toBeGreaterThan(3);
    }
  });
});

describe("slash-commands · 运行期可用性", () => {
  it("有书、空闲：8 条（stage 随六档案接通、skills 随技能库接通、plugins 随插件面板接通）", () => {
    expect(availableCommands(NO_GATE)).toEqual([
      "model",
      "permissions",
      "status",
      "stage",
      "skills",
      "plugins",
      "resume",
      "clear"
    ]);
  });

  it("turn 运行中：只剩 model / permissions / status / clear（spec §6 的 available_during_task）", () => {
    expect(availableCommands({ hasBook: true, turnRunning: true })).toEqual([
      "model",
      "permissions",
      "status",
      "clear"
    ]);
  });

  it("没开书：要读书目录的 resume / permissions / stage / skills 一起拿掉，plugins **留下**", () => {
    // 【plugins 刻意不设书闸，与 skills 不同】
    // skills 被闸是因为它有**书内**来源（`.mochen/skills/`），没书就少一半。
    // 插件只有全局那一份，面板列的是应用的插件目录，与当前书毫无关系——
    // 给它加书闸就等于「没开书时不让用户管理插件」，而那正是他最想管的时候
    // （先装好插件，再去开书写）。
    expect(availableCommands({ hasBook: false, turnRunning: false })).toEqual([
      "model",
      "status",
      "plugins",
      "clear"
    ]);
    // DURING_TURN_COMMANDS 是「运行中仍可用」的白名单，不是「无书也放行」的通行证：hasBook 这道闸在前。
    expect(availableCommands({ hasBook: false, turnRunning: true })).toEqual([
      "model",
      "status",
      "clear"
    ]);
  });

  /**
   * 鉴别用例（反向钉）：无书时权限档菜单不挂载（CenterColumn 的挂载条件），此时列出 /permissions
   * 就是一条按下 Enter 什么都不发生的命令——项目律「拒绝一律回单句中文原因，不静默丢弃」不允许它出现在面板里。
   * 末尾那条「有书时仍在列」是这一组断言的对照组：空手而归只可能来自 hasBook，不是把命令整个删了。
   */
  // Task 106：行内菜单的前缀过滤吃的必定是这张表的输出，这道闸封死的既是「列全」也是「搜出来」；
  // 搜索侧的反向钉在 stores/useReferenceMenuStore.test.ts（无书那一格只剩三条）。
  it("无书时 permissions 绝不出现：availableCommands 这道闸封死", () => {
    for (const turnRunning of [false, true]) {
      const focus = { hasBook: false, turnRunning };
      expect(availableCommands(focus)).not.toContain("permissions");
      expect(availableCommands(focus)).not.toContain("resume");
    }
    expect(availableCommands(NO_GATE)).toContain("permissions");
  });
});

describe("slash-commands · 中文档位名反查（唯一来源仍是 PERMISSION_LABELS）", () => {
  it("三个档名都能查回去，多余空白容忍", () => {
    expect(matchPermissionMode("只读参考")).toBe("read-only");
    expect(matchPermissionMode(" 可改当前章 ")).toBe("chapter-write");
    expect(matchPermissionMode("全开")).toBe("full-access");
  });

  it("查不到与空串都给 null，绝不猜", () => {
    expect(matchPermissionMode("随意改")).toBeNull();
    expect(matchPermissionMode("read-only")).toBeNull();
    expect(matchPermissionMode("")).toBeNull();
  });
});

describe("slash-commands · 弹层自处理的键（权限档 popover）", () => {
  it("只有裸 Esc 归弹层：面板的其余三键与普通字符都不接", () => {
    expect(popoverOwnsKey("Escape", NO_MODS, false)).toBe(true);
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "a", "/"]) {
      expect(popoverOwnsKey(key, NO_MODS, false)).toBe(false);
    }
  });

  /**
   * spec §5 键位表第 228 行：Esc 带任何修饰都不归此表。弹层一旦 stopPropagation，
   * 全局 resolveHotkey 就再也看不见这一键，所以「裸键」判据必须在弹层这一层也生效。
   */
  it("带任何修饰的 Esc 都不接（Ctrl/Shift/Alt/Meta 逐个试）", () => {
    expect(popoverOwnsKey("Escape", { ...NO_MODS, ctrl: true }, false)).toBe(false);
    expect(popoverOwnsKey("Escape", { ...NO_MODS, shift: true }, false)).toBe(false);
    expect(popoverOwnsKey("Escape", { ...NO_MODS, alt: true }, false)).toBe(false);
    expect(popoverOwnsKey("Escape", { ...NO_MODS, meta: true }, false)).toBe(false);
  });

  it("输入法合成期间一个都不接（M4/护栏 1 同口径）", () => {
    expect(popoverOwnsKey("Escape", NO_MODS, true)).toBe(false);
    expect(popoverOwnsKey("Enter", NO_MODS, true)).toBe(false);
  });
});

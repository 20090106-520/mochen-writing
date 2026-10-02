import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_DESCRIPTIONS,
  availableCommands,
  filterCommands,
  matchPermissionMode,
  parseSlashInput,
  paletteOwnsKey
} from "./slash-commands";

const NO_GATE = { hasBook: true, turnRunning: false };

describe("slash-commands · 枚举与说明表（铁律 6：一张表，穷尽键）", () => {
  it("波 1 落 6 条，顺序即面板顺序", () => {
    expect([...SLASH_COMMANDS]).toEqual([
      "model",
      "permissions",
      "status",
      "stage",
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
  it("有书、空闲：5 条（stage 被波 1 的闸门滤掉，绝不列出一个按下去只会报错的命令）", () => {
    expect(availableCommands(NO_GATE)).toEqual([
      "model",
      "permissions",
      "status",
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

  it("没开书：拿掉要读书目录的 resume，其余四条仍然可用", () => {
    expect(availableCommands({ hasBook: false, turnRunning: false })).toEqual([
      "model",
      "permissions",
      "status",
      "clear"
    ]);
    expect(availableCommands({ hasBook: false, turnRunning: true })).toEqual([
      "model",
      "permissions",
      "status",
      "clear"
    ]);
  });
});

describe("slash-commands · 输入解析", () => {
  it("命令与参数以空白分开，档位名里的空格不拆坏", () => {
    expect(parseSlashInput("/resume")).toEqual({ command: "resume", argument: "" });
    expect(parseSlashInput("  /clear  ")).toEqual({ command: "clear", argument: "" });
    expect(parseSlashInput("/permissions 可改当前章")).toEqual({
      command: "permissions",
      argument: "可改当前章"
    });
  });

  it("命令名大小写不敏感（面板里手打 MODEL 也该认）", () => {
    expect(parseSlashInput("/MODEL")).toEqual({ command: "model", argument: "" });
  });

  it("没有前导斜杠、只有斜杠、未知命令：一律 command=null，绝不猜", () => {
    expect(parseSlashInput("resume")).toEqual({ command: null, argument: "" });
    expect(parseSlashInput("/")).toEqual({ command: null, argument: "" });
    expect(parseSlashInput("/compact")).toEqual({ command: null, argument: "" });
    // 简报的此条期望 argument:"" 与简报的实现自相矛盾：实现按空白拆完总会回显命令后的部分。
    // 以逐字照抄的实现为准——command=null 才是闸，argument 只是回显，消费方（argumentFor）读不到它。
    expect(parseSlashInput("/usage 现在不要有")).toEqual({
      command: null,
      argument: "现在不要有"
    });
  });

  it("未列出的命令（/usage /export /fork /new /compact /outline /characters）永远解析不出命令", () => {
    for (const text of [
      "/usage",
      "/export",
      "/fork",
      "/new",
      "/compact",
      "/outline",
      "/characters"
    ]) {
      expect(parseSlashInput(text).command).toBeNull();
    }
  });
});

describe("slash-commands · 面板列表过滤与自处理的键", () => {
  it("空输入给全部可用命令", () => {
    expect(filterCommands("", NO_GATE)).toEqual(availableCommands(NO_GATE));
  });

  it("前缀过滤发生在可用集合上：/s 只剩 status（stage 已被波 1 闸门滤掉）", () => {
    expect(filterCommands("/s", NO_GATE)).toEqual(["status"]);
    expect(filterCommands("s", NO_GATE)).toEqual(["status"]);
    // 简报写的是 "/sta" ⇒ []，但 "status" 本身就以 "sta" 开头，逐字照抄的实现永远给 ["status"]。
    // 改为 "/stag"（只有 stage 命中的前缀）：闸门滤掉 stage 后，任何 stage 前缀都该空手而归。
    expect(filterCommands("/stag", NO_GATE)).toEqual([]);
  });

  it("被闸门滤掉 / 运行期不可用的命令，输入什么前缀都不会冒出来", () => {
    expect(filterCommands("/st", { hasBook: true, turnRunning: true })).toEqual(["status"]);
    expect(filterCommands("/re", { hasBook: false, turnRunning: false })).toEqual([]);
    expect(filterCommands("/stage", NO_GATE)).toEqual([]);
  });

  it("↑↓ / Enter / Esc 由面板自己吃；输入法合成期间一个都不接（M4 的同一口径）", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape"]) {
      expect(paletteOwnsKey(key, false)).toBe(true);
      expect(paletteOwnsKey(key, true)).toBe(false);
    }
    expect(paletteOwnsKey("a", false)).toBe(false);
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

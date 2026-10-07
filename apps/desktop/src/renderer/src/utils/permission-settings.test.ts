import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS, PERMISSION_MODES } from "@mochen/contracts";
import { PERMISSION_MODE_NOTES, permissionOptions } from "./permission-settings";

describe("permission-settings · 三档说明是实话（设置页「智能体」页签）", () => {
  it("说明键与 PERMISSION_MODES 完全一致（加一档不写说明就红）", () => {
    expect(Object.keys(PERMISSION_MODE_NOTES).sort()).toEqual([...PERMISSION_MODES].sort());
  });

  it("选项表的标签取 contracts 的 PERMISSION_LABELS、顺序取 PERMISSION_MODES，本仓不抄第二份中文", () => {
    expect(permissionOptions().map((option) => option.value)).toEqual([...PERMISSION_MODES]);
    expect(permissionOptions().map((option) => option.label)).toEqual(
      PERMISSION_MODES.map((mode) => PERMISSION_LABELS[mode])
    );
  });

  it("文案诚实：任何一档都不许暗示「不经审批自动写」——本版三档都是逐条审批后才落盘", () => {
    const all = Object.values(PERMISSION_MODE_NOTES).join("\n");
    expect(all).not.toMatch(/自动写入|自动保存|无需批准|不经审批|直接写盘/);
    expect(PERMISSION_MODE_NOTES["full-access"]).toContain("批准");
    expect(PERMISSION_MODE_NOTES["read-only"]).toContain("不落盘");
  });

  it("三条说明都非空且互不相同（雷同说明等于没说）", () => {
    const notes = Object.values(PERMISSION_MODE_NOTES);
    expect(notes.every((note) => note.trim() !== "")).toBe(true);
    expect(new Set(notes).size).toBe(PERMISSION_MODES.length);
  });
});

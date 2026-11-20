/**
 * 面板开合态的落盘（2026-11-20 · 主线第一刀）。
 *
 * 钉的是三件事：① 没存过 / 存坏了 ⇒ 三枚都回落默认；
 * ② 某一枚坏了 ⇒ **只回落那一枚**（不许连累另两枚）；
 * ③ 存进去读回来是同一份。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANE_LAYOUT_PREFERENCES,
  PANE_LAYOUT_PREFERENCES_STORAGE_KEY,
  loadPaneLayoutPreferences,
  parsePaneLayoutPreferences,
  savePaneLayoutPreferences,
  type PaneLayoutPreferences
} from "./pane-layout-preferences";

function storageOf(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };
}

const ALL_ON: PaneLayoutPreferences = {
  leftCollapsed: true,
  rightCollapsed: true,
  rightPaneManuallyToggled: true
};

describe("parsePaneLayoutPreferences", () => {
  it("没存过 ⇒ 三枚都是默认（= 什么都没动过）", () => {
    expect(parsePaneLayoutPreferences(null)).toEqual(DEFAULT_PANE_LAYOUT_PREFERENCES);
  });

  it("存的不是 JSON ⇒ 默认（读不出来就当没存，不抛也不猜）", () => {
    expect(parsePaneLayoutPreferences("{不是 json")).toEqual(DEFAULT_PANE_LAYOUT_PREFERENCES);
  });

  it("存的不是一个对象 ⇒ 默认", () => {
    expect(parsePaneLayoutPreferences("[1,2,3]")).toEqual(DEFAULT_PANE_LAYOUT_PREFERENCES);
    expect(parsePaneLayoutPreferences("7")).toEqual(DEFAULT_PANE_LAYOUT_PREFERENCES);
  });

  it("版本号不对 ⇒ 整份当默认（那是另一套形状的记录）", () => {
    expect(parsePaneLayoutPreferences(JSON.stringify({ version: 2, ...ALL_ON }))).toEqual(
      DEFAULT_PANE_LAYOUT_PREFERENCES
    );
  });

  it("版本对 ⇒ 原样读回", () => {
    expect(parsePaneLayoutPreferences(JSON.stringify({ version: 1, ...ALL_ON }))).toEqual(ALL_ON);
  });

  it("某一枚坏了 ⇒ 只回落那一枚，另两枚照旧（坏一枚不该连累整份）", () => {
    const parsed = parsePaneLayoutPreferences(
      JSON.stringify({
        version: 1,
        leftCollapsed: "是",
        rightCollapsed: true,
        rightPaneManuallyToggled: true
      })
    );
    expect(parsed.leftCollapsed).toBe(false);
    expect(parsed.rightCollapsed).toBe(true);
    expect(parsed.rightPaneManuallyToggled).toBe(true);
  });

  it("字段缺失 ⇒ 那一枚回落默认，其余照旧", () => {
    const parsed = parsePaneLayoutPreferences(JSON.stringify({ version: 1, rightCollapsed: true }));
    expect(parsed.leftCollapsed).toBe(false);
    expect(parsed.rightCollapsed).toBe(true);
    expect(parsed.rightPaneManuallyToggled).toBe(false);
  });
});

describe("load / save", () => {
  it("写进去再读回来是同一份", () => {
    const storage = storageOf();
    expect(savePaneLayoutPreferences(storage, ALL_ON)).toBe(true);
    expect(loadPaneLayoutPreferences(storage)).toEqual(ALL_ON);
  });

  it("落盘用的是自己那把钥匙（不许蹭宽度的存储键）", () => {
    const storage = storageOf();
    savePaneLayoutPreferences(storage, ALL_ON);
    expect(storage.values.has(PANE_LAYOUT_PREFERENCES_STORAGE_KEY)).toBe(true);
    // 宽度那份的键是另一把：两件事、两把钥匙（见模块头注）。
    expect(PANE_LAYOUT_PREFERENCES_STORAGE_KEY).toBe("mochen:pane-layout:v1");
  });

  it("存的是带版本号的一份（将来换形状时旧记录能认出来）", () => {
    const storage = storageOf();
    savePaneLayoutPreferences(storage, ALL_ON);
    expect(JSON.parse(storage.values.get(PANE_LAYOUT_PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      ...ALL_ON
    });
  });

  it("写不进去就如实说写不进去，不假装存上了（失败必须可见）", () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("配额满了");
      }
    };
    expect(savePaneLayoutPreferences(broken, ALL_ON)).toBe(false);
  });

  it("读的时候存储抛了 ⇒ 当默认，不把异常甩到界面层", () => {
    const broken = {
      getItem: () => {
        throw new Error("读不到");
      }
    };
    expect(loadPaneLayoutPreferences(broken)).toEqual(DEFAULT_PANE_LAYOUT_PREFERENCES);
  });
});

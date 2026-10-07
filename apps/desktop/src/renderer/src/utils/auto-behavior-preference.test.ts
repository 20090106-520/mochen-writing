/**
 * 「自动行为」一组开关的单测（2026-10-06）。
 *
 * 三条最要紧的：
 * ① 默认值必须等于改动前的行为（清空与自动落盘改动前都是「一直开着」）——
 *    存坏值只等于「没设置过」，不许把用户带到一个他没选过的状态上去；
 * ② 存进去的 "false" 必须活下来：把 false 吞成默认值，等于这一档关不掉；
 * ③ 自动保存复用 autosave-preference 的档位与 key，一个字都不另存（断言的是**同一个 key**）。
 */
import { describe, expect, it } from "vitest";
import {
  AUTO_CLEAR_COMPOSER_KEY,
  AUTO_COMMIT_APPROVED_KEY,
  AUTO_SWITCH_DEFAULTS,
  AUTO_SWITCH_IDS,
  autoBehaviorOptions,
  autoSaveBehavior,
  loadAutoSave,
  loadAutoSwitch,
  saveAutoSave,
  saveAutoSwitch,
  type AutoSwitchId
} from "./auto-behavior-preference";
import {
  AUTOSAVE_DEFAULT_DELAY_MS,
  AUTOSAVE_DELAY_OPTIONS,
  AUTOSAVE_PREFERENCE_KEY,
  autosaveOptions,
  loadAutosaveDelay
} from "./autosave-preference";

interface FakeStorage {
  map: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    }
  };
}

const KEYS: Record<AutoSwitchId, string> = {
  clearComposerAfterSend: AUTO_CLEAR_COMPOSER_KEY,
  autoCommitApproved: AUTO_COMMIT_APPROVED_KEY
};

/** 存一档再交给转发读一遍：逐档证明读回来的就是刚存进去的那档。 */
function storeOf(delay: (typeof AUTOSAVE_DELAY_OPTIONS)[number]): FakeStorage {
  const store = storage();
  saveAutoSave(store, delay);
  return store;
}

describe("auto-behavior-preference · 自动行为那一组开关（2026-10-06）", () => {
  it("两枚开关，默认都开：改动前清空与自动落盘本来就是一直开着的", () => {
    expect([...AUTO_SWITCH_IDS]).toEqual(["clearComposerAfterSend", "autoCommitApproved"]);
    expect(AUTO_SWITCH_DEFAULTS.clearComposerAfterSend).toBe(true);
    expect(AUTO_SWITCH_DEFAULTS.autoCommitApproved).toBe(true);
    for (const id of AUTO_SWITCH_IDS) {
      expect([id, loadAutoSwitch(storage(), id)]).toEqual([id, true]);
      expect([id, loadAutoSwitch(null, id)]).toEqual([id, true]);
    }
  });

  it("表恰好两行，每行都有 label / note，以及「关掉之后会发生什么」", () => {
    const rows = autoBehaviorOptions();
    expect(rows.map((row) => row.id)).toEqual([...AUTO_SWITCH_IDS]);
    for (const row of rows) {
      expect(row.label.length, `${row.id} 缺 label`).toBeGreaterThan(0);
      expect(row.note.length, `${row.id} 缺 note`).toBeGreaterThan(0);
      // 只说「自动」两个字等于没说：后果那句必须是一句能照着做的话。
      expect(row.offEffect.length, `${row.id} 没写关掉之后会怎样`).toBeGreaterThan(12);
      expect(row.offEffect).toContain("关掉之后");
    }
    expect(new Set(rows.map((row) => row.offEffect)).size).toBe(rows.length);
  });

  it('存什么读什么：关掉要能真的关（存进去的 "false" 不许被默认值吞回去）', () => {
    for (const id of AUTO_SWITCH_IDS) {
      const store = storage();
      saveAutoSwitch(store, id, false);
      expect([id, store.map.get(KEYS[id])]).toEqual([id, "false"]);
      expect([id, loadAutoSwitch(store, id)]).toEqual([id, false]);
      saveAutoSwitch(store, id, true);
      expect([id, loadAutoSwitch(store, id)]).toEqual([id, true]);
    }
  });

  it("坏值一律退回默认档，不抛：空串 / 非布尔写法 / 手改出来的串", () => {
    for (const id of AUTO_SWITCH_IDS) {
      for (const bad of ["", " ", "1", "0", "TRUE", "yes", "on", "undefined", "null", " true "]) {
        expect([id, bad, loadAutoSwitch(storage({ [KEYS[id]]: bad }), id)]).toEqual([
          id,
          bad,
          true
        ]);
      }
    }
  });

  it("两枚开关各有各的 key，且都不与自动保存那个 key 撞", () => {
    expect(AUTO_CLEAR_COMPOSER_KEY).not.toBe(AUTO_COMMIT_APPROVED_KEY);
    for (const key of [AUTO_CLEAR_COMPOSER_KEY, AUTO_COMMIT_APPROVED_KEY]) {
      expect(key).not.toBe(AUTOSAVE_PREFERENCE_KEY);
    }
    // 一枚写坏了另一枚不受影响：读的是各自的 key。
    const store = storage({ [AUTO_CLEAR_COMPOSER_KEY]: "false" });
    expect(loadAutoSwitch(store, "clearComposerAfterSend")).toBe(false);
    expect(loadAutoSwitch(store, "autoCommitApproved")).toBe(true);
  });

  it("自动保存复用 AUTOSAVE_DELAY_OPTIONS：档位表、默认值、文案都取自那一份", () => {
    const entry = autoSaveBehavior();
    expect(entry.id).toBe("autoSave");
    expect(entry.control).toBe("autosave-delay");
    expect(entry.defaultDelay).toBe(AUTOSAVE_DEFAULT_DELAY_MS);
    expect(entry.options.map((option) => option.value)).toEqual([...AUTOSAVE_DELAY_OPTIONS]);
    // 逐条深比：这份 options 就是 autosaveOptions() 的返回值，不是抄一遍。
    expect(entry.options).toEqual(autosaveOptions());
  });

  it("loadAutoSave / saveAutoSave 是转发不是副本：同一个 key、同一档", () => {
    const store = storage();
    saveAutoSave(store, 5000);
    expect(store.map.get(AUTOSAVE_PREFERENCE_KEY)).toBe("5000");
    // 面板这一侧写，真身那一侧（useBookStore.scheduleAutoSave）读得到同一份。
    expect(loadAutosaveDelay(store)).toBe(5000);
    expect(loadAutoSave(store)).toBe(5000);
    expect([...AUTOSAVE_DELAY_OPTIONS].map((delay) => loadAutoSave(storeOf(delay)))).toEqual([
      0, 1000, 2000, 5000
    ]);
  });
});

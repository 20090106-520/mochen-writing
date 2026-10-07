/**
 * 保留上限在渲染层的编排（2026-10-06 批次 5-⑧）。
 *
 * 这一组只钉**编排与诚实性**，判定本身在 contracts 与 fs-store 那边：
 * ① 读失败 / 存失败都退回可用状态并说清，界面不许弹一个「好像存上了」的假象；
 * ② 存回的是主进程夹过的那一份——界面高亮的档位必须是盘上真存着的那个；
 * ③ `pruneNow` 的成功与「没什么可清」都落到同一句话上，两者在界面上是同一块地方。
 */
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHANGE_RETENTION, changePruneReportLine, humanBytes } from "@mochen/contracts";
import { useChangeRetentionStore } from "./useChangeRetentionStore";

const api = {
  changesRetentionGet: vi.fn(),
  changesRetentionSave: vi.fn(),
  changesPruneNow: vi.fn()
};

beforeEach(() => {
  setActivePinia(createPinia());
  api.changesRetentionGet.mockReset();
  api.changesRetentionSave.mockReset();
  api.changesPruneNow.mockReset();
  vi.stubGlobal("window", { mochen: api });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("load", () => {
  it("读回来就摆上，persisted 一并留着", async () => {
    api.changesRetentionGet.mockResolvedValue({
      persisted: true,
      retention: { maxCount: 10, maxBytes: 5 * 1024 * 1024 }
    });
    const store = useChangeRetentionStore();
    await store.load();
    expect(store.retention).toEqual({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    expect(store.persisted).toBe(true);
    expect(store.error).toBeNull();
  });

  it("读失败退回默认档，并把话说清是默认档（不假装用户设过）", async () => {
    api.changesRetentionGet.mockRejectedValue(new Error("炸了"));
    const store = useChangeRetentionStore();
    await store.load();
    expect(store.retention).toEqual(DEFAULT_CHANGE_RETENTION);
    expect(store.persisted).toBe(false);
    expect(store.error).toContain("默认档");
  });

  it("ensureLoaded 只读一次：重复开面板不会把刚存的值冲掉", async () => {
    api.changesRetentionGet.mockResolvedValue({
      persisted: false,
      retention: { ...DEFAULT_CHANGE_RETENTION }
    });
    const store = useChangeRetentionStore();
    await store.ensureLoaded();
    api.changesRetentionGet.mockResolvedValue({
      persisted: true,
      retention: { maxCount: 10, maxBytes: 5 * 1024 * 1024 }
    });
    await store.ensureLoaded();
    expect(api.changesRetentionGet).toHaveBeenCalledTimes(1);
  });
});

describe("save", () => {
  it("存成功：摆上主进程回的那一份，并标记成用户设过的", async () => {
    api.changesRetentionGet.mockResolvedValue({
      persisted: false,
      retention: { ...DEFAULT_CHANGE_RETENTION }
    });
    api.changesRetentionSave.mockResolvedValue({
      maxCount: 10,
      maxBytes: 5 * 1024 * 1024
    });
    const store = useChangeRetentionStore();
    await store.load();
    expect(await store.save({ maxCount: 10 })).toBe(true);
    expect(store.retention.maxCount).toBe(10);
    expect(store.persisted).toBe(true);
  });

  it("存失败：state 一动不动（界面弹回原样），并说清没存上", async () => {
    const before = { maxCount: 25, maxBytes: 20 * 1024 * 1024 };
    api.changesRetentionGet.mockResolvedValue({ persisted: true, retention: before });
    api.changesRetentionSave.mockRejectedValue(new Error("盘满了"));
    const store = useChangeRetentionStore();
    await store.load();
    expect(await store.save({ maxCount: 10 })).toBe(false);
    // 关键：失败时 state 不动。乐观更新的话，界面会高亮一个盘上并不存在的档位。
    expect(store.retention).toEqual(before);
    expect(store.error).toContain("没有保存成功");
    expect(store.saving).toBe(false);
  });

  it("saving 期间重复调用直接被拒（连点两下不该发出两次写盘）", async () => {
    api.changesRetentionGet.mockResolvedValue({
      persisted: true,
      retention: { ...DEFAULT_CHANGE_RETENTION }
    });
    let resolveSave = (): void => {};
    api.changesRetentionSave.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = () => resolve({ maxCount: 10, maxBytes: DEFAULT_CHANGE_RETENTION.maxBytes });
      })
    );
    const store = useChangeRetentionStore();
    await store.load();
    const first = store.save({ maxCount: 10 });
    expect(await store.save({ maxCount: 25 })).toBe(false);
    resolveSave();
    expect(await first).toBe(true);
    expect(api.changesRetentionSave).toHaveBeenCalledTimes(1);
  });
});

describe("pruneNow", () => {
  it("清到了就把那句话摆出来", async () => {
    api.changesPruneNow.mockResolvedValue({
      removed: 12,
      kept: 38,
      freedBytes: 3.4 * 1024 * 1024,
      keptBytes: 1.1 * 1024 * 1024
    });
    const store = useChangeRetentionStore();
    await store.pruneNow();
    expect(store.pruneLine).toBe(
      changePruneReportLine({
        removed: 12,
        kept: 38,
        freedBytes: 3.4 * 1024 * 1024,
        keptBytes: 1.1 * 1024 * 1024
      })
    );
    expect(store.pruneLine).toContain("12");
  });

  it("清掉 0 条也要给一句话，且那句话说清「本来就在上限内」", async () => {
    api.changesPruneNow.mockResolvedValue({
      removed: 0,
      kept: 8,
      freedBytes: 0,
      keptBytes: 40 * 1024
    });
    const store = useChangeRetentionStore();
    await store.pruneNow();
    // 真会走到这条路（默认档 50 份，多数人一天攒不到 50 次保存）。
    // 回一句「已清理」会让用户以为刚才是白按了一次。
    expect(store.pruneLine).toContain("没什么可清");
    expect(store.pruneLine).toContain("8");
    expect(store.error).toBeNull();
  });

  it("失败：不摆假结果，只摆错误", async () => {
    api.changesPruneNow.mockRejectedValue(new Error("还没打开作品目录"));
    const store = useChangeRetentionStore();
    await store.pruneNow();
    expect(store.pruneLine).toBeNull();
    expect(store.error).toContain("没能清理");
    expect(store.pruning).toBe(false);
  });
});

describe("humanBytes", () => {
  it("三档单位都对，且小于 1 KB 时说字节", () => {
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(32 * 1024 * 1024)).toBe("32.0 MB");
    expect(humanBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("坏值与负数不会摆出 NaN / 负字节", () => {
    expect(humanBytes(Number.NaN)).toBe("0 B");
    expect(humanBytes(-5)).toBe("0 B");
  });
});

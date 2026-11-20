import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAutoCheckupStore } from "./useAutoCheckupStore";

/**
 * 体检是「回执之后的旁路」，唯一的调用点是火忘型 `void run(...)`（审计 R-2）。
 * 判据函数同步抛错时，run 必须自己兜住，否则就是一条渲染层无人接的 rejection。
 */
vi.mock("../utils/auto-checkup", () => ({
  autoCheckupOf: () => {
    throw new Error("体检判据炸了");
  }
}));

vi.mock("./useBookStore", () => ({
  useBookStore: () => ({ docs: [] })
}));

describe("useAutoCheckupStore.run 的异常兜底", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("判据抛错时 run 不 reject，运行标记照常归零", async () => {
    const store = useAutoCheckupStore();

    await expect(store.run("t1", ["chapters/01.md"])).resolves.toBeUndefined();

    expect(store.runningByThread["t1"]).toBe(false);
    // 这一轮没算成结论：表里保持空，不塞半截结果。
    expect(store.findingsByThread["t1"]).toBeUndefined();
  });

  it("空清单直接返回，不碰判据", async () => {
    const store = useAutoCheckupStore();

    await expect(store.run("t1", [])).resolves.toBeUndefined();

    expect(store.runningByThread["t1"]).toBeUndefined();
  });
});

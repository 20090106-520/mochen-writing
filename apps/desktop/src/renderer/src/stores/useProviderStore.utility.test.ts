import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderView } from "@mochen/contracts";
import { useProviderStore } from "./useProviderStore.js";

/**
 * 后台杂活模型的选择（2026-11-20）。
 *
 * 只钉 store 这一层：把档案 id（或 null）原样递给主进程，并把返回的新视图收下。
 * 「指定的档案坏了回退主档案」是主进程 `configFor` 的判据，那条在 provider-settings 里测。
 */
const VIEW: ProviderView = { connections: [], profiles: [] };

describe("useProviderStore · 后台杂活模型", () => {
  const setUtility = vi.fn(async (): Promise<ProviderView> => VIEW);

  beforeEach(() => {
    setActivePinia(createPinia());
    setUtility.mockClear();
    vi.stubGlobal("window", { mochen: { setUtility } });
  });

  it("把档案 id 递下去；null 表示跟随主模型", async () => {
    const store = useProviderStore();
    await store.setUtility("p-2");
    expect(setUtility).toHaveBeenLastCalledWith("p-2");
    await store.setUtility(null);
    expect(setUtility).toHaveBeenLastCalledWith(null);
    expect(store.error).toBe("");
  });

  it("主进程拒绝时把中文原因落在 error 上，不抛给调用方", async () => {
    setUtility.mockRejectedValueOnce(new Error("没有找到这条模型，可能已经被删除。"));
    const store = useProviderStore();
    await expect(store.setUtility("p-gone")).resolves.toBeUndefined();
    expect(store.error).toContain("没有找到这条模型");
  });
});

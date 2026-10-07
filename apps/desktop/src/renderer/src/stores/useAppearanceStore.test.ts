import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive, toRaw } from "vue";
import {
  createDefaultAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot,
  type RendererApi
} from "@mochen/contracts";
import { useAppearanceStore } from "./useAppearanceStore";

/** 读到的盘上值：mode=dark + 墨宸·青金深色侧，其余默认。 */
function persistedSettings(): AppearanceSettings {
  const base = createDefaultAppearanceSettings();
  return {
    ...base,
    mode: "dark",
    dark: { ...base.dark, preset: "mochen-qingjin", accent: "#D4B45A", background: "#101B18" }
  };
}

function makeApi(overrides: {
  get?: () => Promise<AppearanceSettingsSnapshot>;
  save?: (settings: AppearanceSettings) => Promise<void>;
}) {
  const api = {
    appearanceGet:
      overrides.get ??
      vi.fn(async (): Promise<AppearanceSettingsSnapshot> => ({
        persisted: true,
        settings: persistedSettings()
      })),
    appearanceSave: overrides.save ?? vi.fn(async () => {})
  };
  return api as unknown as Pick<RendererApi, "appearanceGet" | "appearanceSave">;
}

function stubWindow(overlay: Record<string, unknown>): void {
  vi.stubGlobal("window", { mochen: overlay });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useAppearanceStore", () => {
  it("load：盘上值进 state，loaded 翻真，error 清空", async () => {
    stubWindow(makeApi({}));
    const store = useAppearanceStore();
    await store.load();
    expect(store.loaded).toBe(true);
    expect(store.settings.mode).toBe("dark");
    expect(store.settings.dark.preset).toBe("mochen-qingjin");
    expect(store.error).toBeNull();
  });

  it("load 失败：保住默认值，error 收一句中文，不把异常撒给调用方", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    stubWindow(
      makeApi({
        get: vi.fn(async () => {
          throw new Error("boom");
        })
      })
    );
    const store = useAppearanceStore();
    await store.load();
    expect(store.loaded).toBe(false);
    expect(store.settings).toEqual(createDefaultAppearanceSettings());
    expect(store.error).toBe("外观设置没有读到，用的是默认主题。");
    consoleError.mockRestore();
  });

  it("update：整份合并写回，成功才落 state", async () => {
    // 泛型签名带上形参：用例要读 mock.calls[0]?.[0]（写回的整份设置），没类型可查就报 TS2493。
    const save = vi.fn<(settings: AppearanceSettings) => Promise<void>>(async () => {});
    stubWindow(makeApi({ save: save as (settings: AppearanceSettings) => Promise<void> }));
    const store = useAppearanceStore();
    await store.load();
    const ok = await store.update({ mode: "light" });
    expect(ok).toBe(true);
    // 写回的是「合并后的整份设置」，不是只有 mode 的碎片。
    const written = save.mock.calls[0]?.[0];
    expect(written).toBeDefined();
    expect(written?.mode).toBe("light");
    expect(written?.dark.preset).toBe("mochen-qingjin");
    expect(store.settings.mode).toBe("light");
    expect(store.error).toBeNull();
  });

  it("update 失败：state 一动不动（界面弹回原样），error 如实转述", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    stubWindow(
      makeApi({
        save: vi.fn<(settings: AppearanceSettings) => Promise<void>>(async () => {
          throw new Error("disk full");
        })
      })
    );
    const store = useAppearanceStore();
    await store.load();
    const before = store.settings;
    const ok = await store.update({ mode: "light" });
    expect(ok).toBe(false);
    expect(store.settings).toEqual(before);
    expect(store.error).toBe("外观设置没有保存成功，界面已弹回原来的样子。");
    consoleError.mockRestore();
  });
});

/**
 * 2026-10-06 真机撞出来的：`appearance:save` **存不下来任何东西**。
 *
 * 原因是 `{ ...this.settings, ...patch }` 只解开**顶层**——`next.mode` 是原始字符串没错，
 * 但 `next.light` / `next.dark` 仍然是 Vue 响应式代理。Electron 在 IPC 的 send 端
 * 对实参做结构化克隆，代理当场抛 `An object could not be cloned.`。
 *
 * **上面那些用例抓不到它**，因为它们的 mock 是个空转函数：不碰实参，自然不会炸。
 * 所以这里换一种 mock——**复刻 bridge 的真实行为**（对着实参做一次 structuredClone）。
 */
describe("写回主进程的那份必须能过结构化克隆", () => {
  /** 复刻 contextBridge：实参要结构化克隆，Proxy 过不去（与 Electron 同一个 DataCloneError）。 */
  function cloningSave(captured: AppearanceSettings[]): (s: AppearanceSettings) => Promise<void> {
    return async (settings) => {
      structuredClone(settings);
      captured.push(settings);
    };
  }

  it("update 写回的是可克隆的纯对象（改 mode 这一条最常走的路）", async () => {
    const captured: AppearanceSettings[] = [];
    stubWindow(
      makeApi({ save: cloningSave(captured) as (s: AppearanceSettings) => Promise<void> })
    );
    const store = useAppearanceStore();
    await store.load();

    const ok = await store.update({ mode: "light" });

    // 核心断言：这次调用没被 clone 打下来。
    expect(ok).toBe(true);
    expect(store.error).toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.mode).toBe("light");
    // 嵌套那两套配色也在（展开没把它们弄丢）。
    expect(captured[0]?.light).toBeDefined();
    expect(captured[0]?.dark).toBeDefined();
  });

  it("改嵌套字段也过得了（那才是真正会把代理带出去的地方）", async () => {
    const captured: AppearanceSettings[] = [];
    stubWindow(
      makeApi({ save: cloningSave(captured) as (s: AppearanceSettings) => Promise<void> })
    );
    const store = useAppearanceStore();
    await store.load();

    const base = createDefaultAppearanceSettings();
    const ok = await store.update({ dark: { ...base.dark, accent: "#D4B45A" } });

    expect(ok).toBe(true);
    expect(captured[0]?.dark.accent).toBe("#D4B45A");
  });

  it("（对照）浅展开出来的那份过不去，toRaw 过的过得去——所以上面两条不是空转", () => {
    // 这一条是本组断言的**鉴别力凭据**：如果 structuredClone 对代理不敏感，
    // 上面两条就会永远绿，守卫就成了装饰。
    const state = reactive(createDefaultAppearanceSettings());
    expect(() => structuredClone({ ...state }), "浅展开应当克隆失败").toThrow();
    expect(() => structuredClone({ ...toRaw(state) }), "toRaw 应当克隆通过").not.toThrow();
  });
});

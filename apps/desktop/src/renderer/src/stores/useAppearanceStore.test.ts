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
import { defaultAppearanceSkin } from "../composables/appearanceSkins";

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
 * 2026-10-08 第二刀：盘上存着**已下架的皮肤 id** 时的读盘回落。
 *
 * 用户那句裁定是「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」，
 * 于是十套素面配色（`appearanceTones.ts`）与 `themePresets` 投影一起删了。
 * 但 `preset` / `skin` 在 contracts 里是非枚举字符串，老 JSON 照样解析成功 ⇒
 * 「什么也没点、界面却自己矛盾」这一条只能由 store 在 load 时收口。
 * 落点只有一份实现（`reconcileStoredSkin`），这里钉的是**它真的接在 load 上**，
 * 以及两条不许越界的行为：**不许顺手写盘**、**不许把原 id 藏掉**。
 */
describe("load · 存着已下架的皮肤 id 时回落成广场第一套", () => {
  /** 盘上那一份：浅深两套都存着已删的 `paper`（十套素面里的那一套）。 */
  function retiredSkinSnapshot(): AppearanceSettingsSnapshot {
    const base = createDefaultAppearanceSettings();
    return {
      persisted: true,
      settings: {
        ...base,
        light: { ...base.light, preset: "paper", skin: "paper", accent: "#A25D35" },
        dark: { ...base.dark, preset: "paper", skin: "paper", accent: "#E49B66" }
      }
    };
  }

  it("state 里那套是广场第一套，且原 id 留在 replacedSkinId 上给界面说实话", async () => {
    const save = vi.fn(async () => {});
    stubWindow(
      makeApi({
        get: vi.fn(async () => retiredSkinSnapshot()),
        save: save as (settings: AppearanceSettings) => Promise<void>
      })
    );
    const store = useAppearanceStore();
    await store.load();
    expect(store.settings.light.skin).toBe(defaultAppearanceSkin.id);
    expect(store.settings.dark.accent).toBe(defaultAppearanceSkin.dark.accent);
    expect(store.replacedSkinId).toBe("paper");
    expect(store.loaded).toBe(true);
    expect(store.error).toBeNull();
    // **回落不许写盘**：那是别人的 appearance.json，改它要用户点一次才算。
    expect(save, "load 的回落把别人的设置文件改了").not.toHaveBeenCalled();
  });

  it("存的就是广场里那一套时 replacedSkinId 是 null（界面不许无缘无故多说一句）", async () => {
    stubWindow(makeApi({}));
    const store = useAppearanceStore();
    await store.load();
    expect(store.replacedSkinId).toBeNull();
  });

  it("读失败走默认值时也一样是 null：出厂默认自己就在表里", async () => {
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
    expect(store.replacedSkinId).toBeNull();
    expect(store.settings.light.skin).toBe(defaultAppearanceSkin.id);
    consoleError.mockRestore();
  });

  it("用户点过一次任何设置，那句「已下架」就收起；保存失败则原样留着不骗人", async () => {
    // 成功那半：写回的是回落后的这一套，提示同时清空。
    const save = vi.fn<(settings: AppearanceSettings) => Promise<void>>(async () => {});
    stubWindow(
      makeApi({
        get: vi.fn(async () => retiredSkinSnapshot()),
        save: save as unknown as (settings: AppearanceSettings) => Promise<void>
      })
    );
    const store = useAppearanceStore();
    await store.load();
    expect(store.replacedSkinId).toBe("paper");
    expect(await store.update({ mode: "light" })).toBe(true);
    expect(store.replacedSkinId).toBeNull();
    expect(save.mock.calls[0]?.[0].light.skin).toBe(defaultAppearanceSkin.id);

    // 失败那半：state 一动不动是这条 store 的老规矩，提示也不能提前收起。
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    stubWindow(
      makeApi({
        get: vi.fn(async () => retiredSkinSnapshot()),
        save: vi.fn<(settings: AppearanceSettings) => Promise<void>>(async () => {
          throw new Error("disk full");
        }) as unknown as (settings: AppearanceSettings) => Promise<void>
      })
    );
    const other = useAppearanceStore();
    await other.load();
    expect(await other.update({ mode: "dark" })).toBe(false);
    expect(other.replacedSkinId, "没存上却把提示收了，等于瞒着用户改了设置").toBe("paper");
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

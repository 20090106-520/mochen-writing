import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultAppearanceSettings } from "@mochen/contracts";
import { createAppearanceStore, registerAppearanceIpc } from "./appearance-store.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-appearance-"));
});
afterEach(async () => {
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
});

function sampleSettings() {
  const base = createDefaultAppearanceSettings();
  return {
    ...base,
    mode: "dark",
    dark: { ...base.dark, preset: "mochen-qingjin", accent: "#D4B45A", background: "#101B18" }
  } as const;
}

describe("appearanceStore", () => {
  it("没有落盘文件时给默认值，persisted=false", async () => {
    const store = createAppearanceStore({ dir });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.settings).toEqual(createDefaultAppearanceSettings());
  });

  it("save 后 read 原样读回，persisted=true，内容落 appearance.json", async () => {
    const store = createAppearanceStore({ dir });
    const value = sampleSettings();
    await store.save(value);
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(true);
    expect(snapshot.settings).toEqual(value);
    const raw = JSON.parse(await readFile(path.join(dir, "appearance.json"), "utf8"));
    expect(raw.mode).toBe("dark");
  });

  it("save 会顺路建目录：目录不存在也落得进去", async () => {
    const nested = path.join(dir, "not-yet", "inner");
    const store = createAppearanceStore({ dir: nested });
    await store.save(createDefaultAppearanceSettings());
    expect(await readFile(path.join(nested, "appearance.json"), "utf8")).toContain('"mode"');
  });

  it("盘上 JSON 损坏时退默认值，persisted=false——外观不挡启动", async () => {
    await writeFile(path.join(dir, "appearance.json"), "{ 不是 JSON", "utf8");
    const snapshot = await createAppearanceStore({ dir }).read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.settings).toEqual(createDefaultAppearanceSettings());
  });

  it("盘上内容过不了 zod（mode 非法）同样退默认值", async () => {
    await writeFile(
      path.join(dir, "appearance.json"),
      JSON.stringify({ mode: "never", light: {}, dark: {} }),
      "utf8"
    );
    const snapshot = await createAppearanceStore({ dir }).read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.settings).toEqual(createDefaultAppearanceSettings());
  });

  it("save 拒非法值：单句中文，盘上原样未动", async () => {
    const store = createAppearanceStore({ dir });
    const before = await store.read();
    const broken = { ...createDefaultAppearanceSettings(), mode: "auto" } as unknown as Parameters<
      typeof store.save
    >[0];
    let message: string | null = null;
    try {
      await store.save(broken);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("外观设置没有保存：内容不合法。");
    expect(await store.read()).toEqual(before);
  });

  it("readFile 抛非 ENOENT 的真实 IO 错误时也退默认值，persisted=false", async () => {
    const store = createAppearanceStore({
      dir,
      readFile: async () => {
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
    });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.settings).toEqual(createDefaultAppearanceSettings());
  });
});

describe("registerAppearanceIpc", () => {
  it("只注册白名单里的两条外观通道，读与写各归各", async () => {
    const store = createAppearanceStore({ dir });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerAppearanceIpc((channel, fn) => handlers.set(channel, fn), store);
    expect([...handlers.keys()].sort()).toEqual(["appearance:get", "appearance:save"]);

    const value = sampleSettings();
    await handlers.get("appearance:save")?.({}, value);
    const snapshot = await handlers.get("appearance:get")?.({});
    expect(snapshot).toEqual({ persisted: true, settings: value });
  });
});

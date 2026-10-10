import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AppearanceSettingsSchema,
  IPC_CHANNELS,
  createDefaultAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsSnapshot
} from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "@mochen/fs-store";
import type { ReadTextFile } from "./credential-store.js";
// 来源闸 + 参数形状闸的唯一出处（P1-7）：注册通道只许走 handleTrusted。
import { handleTrusted } from "./ipc-guard.js";

/** electron 的 ipcMain.handle 的窄形状（与 agent-ipc 同款）：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

export interface AppearanceStore {
  read(): Promise<AppearanceSettingsSnapshot>;
  save(settings: AppearanceSettings): Promise<void>;
}

/**
 * 外观设置的落盘真身（userData/appearance.json）。
 * 与模型配置（provider-settings）的错误策略不同：模型配置坏了要拦着用户修，
 * 外观坏了直接退默认值继续跑——一套主题配色不值得挡在启动路上，
 * persisted:false 就是给渲染层的「这份是默认值，不是你存的」信号。
 */
export function createAppearanceStore(deps: {
  dir: string;
  readFile?: ReadTextFile;
  /** 写盘缝（P0-5 同族）：默认真 fs，测试注入「只坏一步」的实现。命名同 book-service。 */
  fs?: AtomicWriteFs;
}): AppearanceStore {
  const configFile = path.join(deps.dir, "appearance.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  const writeFs: AtomicWriteFs = deps.fs ?? defaultAtomicFs;

  async function read(): Promise<AppearanceSettingsSnapshot> {
    const fallback = createDefaultAppearanceSettings();
    let raw: string;
    try {
      raw = await readText(configFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { persisted: false, settings: fallback };
      }
      return { persisted: false, settings: fallback };
    }
    if (raw.trim() === "") return { persisted: false, settings: fallback };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { persisted: false, settings: fallback };
    }
    const result = AppearanceSettingsSchema.safeParse(parsed);
    if (!result.success) return { persisted: false, settings: fallback };
    return { persisted: true, settings: result.data };
  }

  async function save(settings: AppearanceSettings): Promise<void> {
    const parsed = AppearanceSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      throw new Error("外观设置没有保存：内容不合法。");
    }
    // 原子写（P0-5 同族，理由见 provider-settings.ts 的 `writeStore`）：裸 writeFile 先截断再写，
    // 半截的 appearance.json 下次读就过不了 zod ⇒ 退默认值 ⇒ 用户配的配色悄悄没了。
    // 建目录由 writeFileAtomic 按目标路径自己做，这里不再单独 mkdir。
    await writeFileAtomic(configFile, `${JSON.stringify(parsed.data, null, 2)}\n`, writeFs);
  }

  return { read, save };
}

/** 只注册白名单里的两条外观通道：读（带 persisted 标志）与整份写回。 */
export function registerAppearanceIpc(handle: Handler, store: AppearanceStore): void {
  handleTrusted(handle, IPC_CHANNELS.appearanceGet, () => store.read());
  handleTrusted(handle, IPC_CHANNELS.appearanceSave, (_event, settings) =>
    store.save(settings as AppearanceSettings)
  );
}

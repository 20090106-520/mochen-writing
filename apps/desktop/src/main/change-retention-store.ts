import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CHANGE_RETENTION,
  sanitizeChangeRetention,
  type ChangeRetention,
  type ChangeRetentionSnapshot
} from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "@mochen/fs-store";
import type { ReadTextFile } from "./credential-store.js";

export interface ChangeRetentionStore {
  read(): Promise<ChangeRetentionSnapshot>;
  /**
   * **同步**现取当前上限（没读过盘时就是默认档）。
   *
   * `writeDoc` 那条热路径每次写盘都要一个上限，但它是同步签名，让它 `await` 一次 JSON 读盘
   * 会把自动保存拖成一次 IO。缓存住是有依据的：这份配置**只由这个 store 改**（`read` / `save`），
   * 没有第二个写者，所以不存在「缓存过期」这一说——与 `appearance-store` + 装配处
   * `currentAppearance` 是同一个形状，只是那份放装配层是因为外观还要驱动窗控上色。
   */
  current(): ChangeRetention;
  /** 回**真正落盘的那份**：夹过就回夹过的，让渲染层有东西可对，而不是让调用方以为自己存下了原值。 */
  save(retention: ChangeRetention): Promise<ChangeRetention>;
}

/**
 * 改稿历史保留上限的落盘真身（userData/change-retention.json，2026-10-06 批次 5-⑧）。
 *
 * 与外观设置同一套错误策略（理由见 `appearance-store.ts`）：这份配置坏在启动路上把整个应用
 * 堵死，代价远大于「退回默认继续跑」。`persisted:false` 是给界面的
 * 「这是默认档、不是你设的」信号，界面不许把它显示成用户自己选的那一档。
 *
 * **为什么放在主进程而不是 localStorage**：这份上限要一路影响到 `writeDocFile`——
 * 那是 Node 那侧的文件写入，渲染进程碰不到；而拆成两份（渲染层一份、写入一份）就等于
 * 两处上限可以不一致，界面上写 25 份而盘上按 50 份删，是最难查的那类「控件说自己做的事没做」。
 * 所以只存一份，写盘那条路现取。
 */
export function createChangeRetentionStore(deps: {
  dir: string;
  readFile?: ReadTextFile;
  /** 写盘缝（P0-5 同族）：默认真 fs，测试注入「只坏一步」的实现。命名同 book-service。 */
  fs?: AtomicWriteFs;
}): ChangeRetentionStore {
  const configFile = path.join(deps.dir, "change-retention.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  const writeFs: AtomicWriteFs = deps.fs ?? defaultAtomicFs;
  const fallback = (): ChangeRetentionSnapshot => ({
    persisted: false,
    retention: { ...DEFAULT_CHANGE_RETENTION }
  });
  let cached: ChangeRetention = { ...DEFAULT_CHANGE_RETENTION };

  async function read(): Promise<ChangeRetentionSnapshot> {
    let raw: string;
    try {
      raw = await readText(configFile);
    } catch {
      // ENOENT（还没存过）与读不动（权限/占用）都回默认档：两者的正确反应都是「用默认值继续跑」，
      // 分开报错只会让启动路上一份配置有两种炸法。
      cached = { ...DEFAULT_CHANGE_RETENTION };
      return fallback();
    }
    if (raw.trim() === "") {
      cached = { ...DEFAULT_CHANGE_RETENTION };
      return fallback();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      cached = { ...DEFAULT_CHANGE_RETENTION };
      return fallback();
    }
    const retention = sanitizeChangeRetention(parsed);
    cached = retention;
    // `persisted` 问的是「这份是不是用户自己设的」，不是「解析成功了吗」——
    // 手改坏成 `{maxCount:"很多"}` 也能解析成功，但那显然不是用户设的档（被夹过了）。
    // 所以判据是「夹完与原样一字不差」，而不是 `sanitize` 没抛。
    return { persisted: sameRetention(parsed, retention), retention };
  }

  async function save(retention: ChangeRetention): Promise<ChangeRetention> {
    // 存之前先夹。界面只递档位表里的值，所以正常路径夹不动；真夹动了说明有人递了脏数据，
    // 此时把夹完的结果回传，界面显示的就是盘上真实的那一份，不会有「显示 A 实际 B」。
    const clean = sanitizeChangeRetention(retention);
    // 原子写（P0-5 同族，理由见 provider-settings.ts 的 `writeStore`）：这份上限管的是
    // 「写盘时删掉多少改稿历史」，文件半截 ⇒ 下次读不过 zod ⇒ 悄悄退回默认档 ⇒ 按用户没选过的上限开始删。
    await writeFileAtomic(configFile, `${JSON.stringify(clean, null, 2)}\n`, writeFs);
    // 只在**真的写成了**之后才换缓存值：写盘失败时缓存还停在旧值，
    // 于是下一次自动保存仍按旧上限淘汰——宁可少按一次新上限，也不能让界面与盘上分家。
    cached = clean;
    return clean;
  }

  return { read, current: () => cached, save };
}

/** 盘上那串 JSON 与夹完的档位是否一字不差（只在 `read` 里用来判 `persisted`）。 */
function sameRetention(parsed: unknown, retention: ChangeRetention): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const candidate = parsed as Partial<ChangeRetention>;
  return candidate.maxCount === retention.maxCount && candidate.maxBytes === retention.maxBytes;
}

/**
 * 这个文件**只管落盘，不注册通道**。
 *
 * 那两条通道的注册与另外三条改稿通道放在一起（`changes-service.ts` 的 `registerChangesIpc`）——
 * 同一片领域的五条通道在一处注册，而通道名的字面量仍然只出自 contracts 的 `IPC_CHANNELS` 一处。
 */

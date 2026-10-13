import path from "node:path";
import { MIGRATED_FILES } from "./app-data-migration.js";

/**
 * 设置目录名的唯一判据 + 开发态第一次启动的「只复制不搬走」（2026-10-09 全仓扫描 P2-14 / 修复清单第 6 项）。
 *
 * 【为什么要两份目录】
 * 开发态（`pnpm dev`、`electron-vite preview`、真机取证起的实例）与打包版**同名同目录**：
 * `%APPDATA%/mochen-ai`。后果是可复现的——一次 dev 启动会 `seedBuiltinPlugins` 往
 * `<目录>/plugins/` 种内置插件、会把设置页里改到一半的东西落盘，把用户装好的那一份
 * 覆盖成开发版的状态。`builtin-plugins.ts` 的头注释里记着一条更硬的证据：
 * 真机当时想用 `--user-data-dir` 躲开，**那个开关不影响 `app.getPath("appData")`**，躲不掉。
 * 所以这一刀把两边分开：打包版继续住 `mochen-ai`（用户真身，一个字不动），
 * 开发态住 `mochen-ai-dev`。
 *
 * 【为什么是复制而不是搬家】
 * 搬家（改名）会把打包版正在用的目录拿走——那是**另一个进程的家**。
 * 所以这里的动作只有 readdir、对开发目录的一次 mkdir、以及 copyFile：
 * 源目录在开发态第一次启动前后必须逐字不变，用例按 fs 调用序列钉死这一点
 * （只许出现这三种，一次 rename、一次删除都不许有）。
 * 与 `app-data-migration.ts` 同一条铁律的另一半：搬过来的只许是那份已知清单里的文件，
 * 来历不明的字节不进会被读取的位置。
 *
 * 【为什么幂等（开发目录存在就不碰）】
 * 用户在开发版里删掉 `config.json`，下次启动又把它从打包版「复活」，那「删掉」等于没发生。
 * 复制只在目录不存在的那一次发生，此后两份彻底各管各的。
 */

/** 打包版的品牌目录名（F-4 迁移的目标名，用户真身那一份）。 */
export const APP_DIR_NAME = "mochen-ai";
/** 开发态目录名：与打包版只差一个后缀，但从此互不覆盖。 */
export const APP_DEV_DIR_NAME = "mochen-ai-dev";

/** 目录名的唯一判据：装配层与诊断件落点都从这里取，别处不许再写第二串。 */
export function appDirNameFor(isPackaged: boolean): string {
  return isPackaged ? APP_DIR_NAME : APP_DEV_DIR_NAME;
}

/** 复制的清单直接复用迁移那份：一份「哪些文件是我们的」的判据，不住两个地方。 */
export const DEV_SEED_FILES = MIGRATED_FILES;

export interface DevSeedDeps {
  /** `app.getPath("appData")`：开发目录与打包目录是同级的两个名字。 */
  appDataBase: string;
  isPackaged: boolean;
  /**
   * 打包版这一轮真正在用的目录（迁移算出来的 activeDir，可能是 kept-old 时的旧目录）。
   * 开发态第一次启动就从它里面复制——用户已经配好的东西不该在开发版里重新填一遍。
   */
  packagedActiveDir: string;
  readdir(dir: string): Promise<string[]>;
  copyFile(src: string, dest: string): Promise<void>;
  /**
   * 复制前先建开发目录：`fs.copyFile` **不会**替你创建目标目录，目标目录不存在时它直接抛
   * ENOENT——而那个 ENOENT 和「源目录不存在」长得一模一样。不建目录，第一次启动的复制就会
   * 变成一条没人看得懂的 copy-failed。下面那组真 fs 的用例钉的就是这一件事。
   */
  mkdir(dir: string): Promise<void>;
  /** 默认 `DEV_SEED_FILES`；注入是为了用例能摆「目录里只有来历不明的字节」。 */
  files?: readonly string[];
}

export type DevSeedReport =
  /** 打包版：本模块一个字都不动。 */
  | { status: "packaged" }
  /** 开发目录已存在（含空目录）⇒ 此后两份各管各的。 */
  | { status: "exists" }
  /** 打包目录不存在：全新机器上的开发版，从零开始。 */
  | { status: "no-source" }
  /** 打包目录存在但里面没有我们的文件。 */
  | { status: "empty-source" }
  | { status: "seeded"; copiedFiles: string[] }
  | { status: "copy-failed"; copiedFiles: string[]; reason: string }
  /** 打包目录读不动（不是「不存在」）：说不清状态就不拷，且必须说出来。 */
  | { status: "source-unreadable"; reason: string }
  /** 开发目录存不存在都认不出来：宁可让用户手动重配，也不覆写一份状态不明的目录。 */
  | { status: "dev-dir-unreadable"; reason: string };

export interface AppDataDirDecision {
  /** 这一轮所有 store 认的那一份目录。 */
  dir: string;
  seed: DevSeedReport;
}

/** ENOENT 与「别的读不动」必须分开：前者是「从来没配过」，后者是盘的问题。 */
async function list(
  dir: string,
  readdir: (p: string) => Promise<string[]>
): Promise<{ ok: true; entries: string[] } | { ok: false; reason: string | null }> {
  try {
    return { ok: true, entries: await readdir(dir) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: null };
    return { ok: false, reason: (error as Error).message };
  }
}

/**
 * 一次调用给出「这一轮用哪个目录」，并把开发态第一次的复制做掉。
 *
 * 顺序是刻意的：先认开发目录在不在（在就到此为止），不在才去读打包目录；
 * 只有确实要拷的时候才建开发目录。
 * 打包目录那边只被 `readdir` 与 `copyFile` 的**源**碰过——这里没有 rename、没有删除。
 */
export async function resolveAppDataDir(deps: DevSeedDeps): Promise<AppDataDirDecision> {
  const devDir = path.join(deps.appDataBase, APP_DEV_DIR_NAME);
  if (deps.isPackaged) {
    return { dir: deps.packagedActiveDir, seed: { status: "packaged" } };
  }

  const dev = await list(devDir, deps.readdir);
  if (!dev.ok && dev.reason !== null) {
    return { dir: devDir, seed: { status: "dev-dir-unreadable", reason: dev.reason } };
  }
  if (dev.ok) return { dir: devDir, seed: { status: "exists" } };

  const source = await list(deps.packagedActiveDir, deps.readdir);
  if (!source.ok && source.reason !== null) {
    return { dir: devDir, seed: { status: "source-unreadable", reason: source.reason } };
  }
  if (!source.ok) return { dir: devDir, seed: { status: "no-source" } };

  const wanted = (deps.files ?? DEV_SEED_FILES).filter((name) => source.entries.includes(name));
  if (wanted.length === 0) return { dir: devDir, seed: { status: "empty-source" } };

  // 建目录放在「确实要拷」之后：不拷的时候一个字都不写盘，全新机器上的开发版
  // 由各个 store 在第一次落盘时自己建目录（`writeFileAtomic` 那条），这里不替它抢先。
  try {
    await deps.mkdir(devDir);
  } catch (error) {
    return {
      dir: devDir,
      seed: {
        status: "copy-failed",
        copiedFiles: [],
        reason: `开发目录建不出来：${(error as Error).message}`
      }
    };
  }

  const copied: string[] = [];
  for (const name of wanted) {
    try {
      await deps.copyFile(path.join(deps.packagedActiveDir, name), path.join(devDir, name));
      copied.push(name);
    } catch (error) {
      return {
        dir: devDir,
        seed: {
          status: "copy-failed",
          copiedFiles: copied,
          reason: `${name} 没拷到开发目录：${(error as Error).message}`
        }
      };
    }
  }
  return { dir: devDir, seed: { status: "seeded", copiedFiles: copied } };
}

/**
 * 复制结果的中文播报（沿用迁移那条做法：不加 IPC 通道，直接 dialog）。
 * 判据只有一条：**动过盘或者读不懂盘，就要说出来**；没动过盘的那几种状态不打扰。
 */
export function devSeedNotice(
  seed: DevSeedReport,
  devDir: string,
  sourceDir: string
): { type: "info" | "warning"; text: string } | null {
  switch (seed.status) {
    case "seeded":
      return {
        type: "info",
        text:
          `这是开发版，设置目录用的是 ${devDir}。` +
          `第一次启动时已从打包版那份目录复制过来：${seed.copiedFiles.join("、")}（源：${sourceDir}，原件一字未动）。` +
          "此后两份互不覆盖：开发版改设置不会动到已安装版本的那一份。"
      };
    case "copy-failed":
      return {
        type: "warning",
        text:
          `开发版设置目录 ${devDir} 的初始化复制没有做完（${seed.reason}）。` +
          `已拷过去的：${seed.copiedFiles.length === 0 ? "无" : seed.copiedFiles.join("、")}；` +
          `打包版那份目录（${sourceDir}）未被改动。`
      };
    case "source-unreadable":
      return {
        type: "warning",
        text: `开发版读打包版设置目录时出错（${seed.reason}），本次不复制，${devDir} 将由开发版自己从零开始。`
      };
    case "dev-dir-unreadable":
      return {
        type: "warning",
        text:
          `开发版认不出设置目录 ${devDir} 是否存在（${seed.reason}）。` +
          `为避免覆写一份状态不明的目录，本次不做任何复制；请检查该目录是否被占用或有访问权限。`
      };
    default:
      return null;
  }
}

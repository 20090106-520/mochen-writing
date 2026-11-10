import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  SKILL_FILE_NAME,
  decodeSkillRedeemCode,
  marketTargetDir,
  type SkillRedeemResult
} from "@mochen/contracts";
// 来源闸 + 参数形状闸的唯一出处（P1-7）：注册通道只许走 handleTrusted。
import { handleTrusted } from "./ipc-guard.js";

/** electron 的 ipcMain.handle 的窄形状（与 skill-market-service 同款）：装配处传真的 ipcMain，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 技能兑换码的主进程真身：把一段**离线自包含**的码解成一个技能，装进全局技能目录。
 *
 * 【为什么写路径比只读那套严】兑换码是渲染层递来的任意字符串，解码出来的目录名要拿去拼
 * 绝对路径、正文要落盘，所以三道线一道都不能少：
 * 1. 只往**全局**目录写，绝不碰书目录——书是用户的作品，应用不往里塞文件
 *    （与 skill-market-service.ts 同一条边界）；全局根借只读那套的 `dirOf`，不重拼。
 * 2. 目标路径必须过 `marketTargetDir`（与解码端同一份目录名守卫），null 直接拒，
 *    不拿「大概安全」的路径去写。
 * 3. **绝不覆盖**：目标里已有 SKILL.md 就当装过了。兑换码谁都能生成，
 *    覆盖等于让用户自己改过的那份被一段码悄悄抹掉；想重装得先自己删。
 */
export interface SkillRedeemService {
  redeem(code: string): Promise<SkillRedeemResult>;
}

export function createSkillRedeemService(deps: {
  /** 借只读那套的 `dirOf`：`<appData>/skills` 只在 skill-service.ts 拼一次，这里再拼就是第二份判据。 */
  dirOf: (source: "global" | "book") => string | null;
}): SkillRedeemService {
  function fail(notice: string): SkillRedeemResult {
    return { ok: false, notice, dirName: "", displayName: "" };
  }

  async function redeem(code: string): Promise<SkillRedeemResult> {
    const payload = decodeSkillRedeemCode(code);
    if (payload === null) {
      return fail("这串兑换码不对：格式或校验没过，请核对有没有漏字符。");
    }
    const root = deps.dirOf("global");
    if (root === null) return fail("兑换失败：全局技能目录还没配好，暂时装不了。");
    const dir = marketTargetDir(root, payload.dirName);
    if (dir === null) return fail(`兑换失败：《${payload.displayName}》的目录名不合法，装不了。`);

    const file = path.join(dir, SKILL_FILE_NAME);
    // 绝不覆盖：目标里已有 SKILL.md 就当装过了，用户那份一个字节都不碰。
    // 用 access 探存在而不是 rm/覆盖写，也是为了「卸都不由应用动手」这条边界。
    try {
      await access(file);
      return fail(`《${payload.displayName}》已经装过了，没有覆盖你已有的那份`);
    } catch {
      // 读不到＝还没装，往下走写盘。
    }

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(file, payload.skillMd, "utf8");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return fail(`兑换《${payload.displayName}》时写盘失败：${reason}`);
    }
    return {
      ok: true,
      notice: `兑换成功：《${payload.displayName}》已装进全局技能目录。回到列表点「挂入」就能在这一轮用上。`,
      dirName: payload.dirName,
      displayName: payload.displayName
    };
  }

  return { redeem };
}

/** 一条通道，只收一整串兑换码字符串；路径与来源一律由主进程解码后自己拼。 */
export function registerSkillRedeemIpc(handle: Handler, service: SkillRedeemService): void {
  handleTrusted(handle, IPC_CHANNELS.skillsRedeem, (_event, code) => service.redeem(String(code)));
}

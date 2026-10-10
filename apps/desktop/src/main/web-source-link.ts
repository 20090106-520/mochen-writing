import { IPC_CHANNELS } from "@mochen/contracts";
// 来源闸与参数形状（P1-7）：判据只有一份，住在 ipc-guard.ts。
import { handleTrusted } from "./ipc-guard.js";

/**
 * 「点开这条搜索来源」的那一条 IPC（2026-10-06 批次 5-⑨）。
 *
 * 这是本仓**唯一一条渲染层递 URL 出去**的通道，与 `openProviderKeyPage` 的口径刻意相反，
 * 原因得说清楚，否则下一位读代码的会以为这里漏了闸：
 *
 *   密钥页为什么不收 URL？——密钥页地址全在 `PROVIDER_PRESETS` 里，收一个 id 由主进程查表
 *   就够了，收 URL 只会平白多放行 file:// 与内网地址（见 ipc.ts 的注释）。这是对的。
 *
 *   搜索来源为什么必须收 URL？——来源地址是搜索站当场给的，每条都不一样，预置表套不上。
 *   不给点开这条路，用户就只能从一坨纯文本里手抄链接去核对，对一个「靠来源吃饭」的写作工具
 *   来说等于没有来源。
 *
 *   那靠什么保证安全？——协议白名单。`shell.openExternal` 的风险不在「URL 是不是我给的」，
 *   而在「系统会用哪个协议处理器去打开它」：file:// 会读本地文件，任意自注册 scheme 可能
 *   直接把参数交给别的应用。所以只放行 http/https 两家，其余一律拒——
 *   这是 Electron 官方安全清单对 openExternal 的标准建议。
 */
export interface ExternalOpener {
  openExternal(url: string): Promise<void>;
}

/**
 * 白名单判定。返回 true 才许真的去叫浏览器。
 *
 * 三道闸，缺一不可：
 *   ① `URL` 能不能解析——挡掉 `not a url`、`//example.com` 这类协议相对串；
 *   ② 协议是不是 http/https——挡掉 file/javascript/data/vbscript 与自注册 scheme；
 *   ③ 里头有没有 `user:pass@`——带凭据的地址会在地址栏和历史里留下钓鱼用的假域名。
 */
export function isOpenableWebSource(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return true;
}

type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** 只注册这一条通道。它不碰任何 store，纯粹是 shell 动作。 */
export function registerWebSourceIpc(handle: Handler, shell: ExternalOpener): void {
  // 【2026-10-10 全仓扫描 P1-7】这条是**唯一**由渲染层递 URL 出去的通道，白名单只挡住了协议，
  // 挡不住「谁在发这条」：远程页面若被导航进来（P1-8），照样能一条一条地叫系统浏览器打开地址。
  // 来源与形状判定都在 ipc-guard，这里只留那条 http/https 白名单（它才是本文件的判据）。
  handleTrusted(handle, IPC_CHANNELS.appOpenWebSource, async (_event, url) => {
    const raw = typeof url === "string" ? url : "";
    if (!isOpenableWebSource(raw)) throw new Error("只允许打开 http/https 的搜索来源链接。");
    await shell.openExternal(raw);
    return true;
  });
}

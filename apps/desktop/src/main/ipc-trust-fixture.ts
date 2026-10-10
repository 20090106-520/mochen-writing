/**
 * 测试夹具：造一枚「由我们自己的那一帧渲染层发出来的 IPC 事件」（2026-10-10 扫描总单 P1-7）。
 *
 * 【为什么需要它】`ipc-guard.ts` 的来源闸是 **fail closed**：启动装配没跑 `installRendererTrust`
 * 就当不可信。真进程里那次装配在建窗前完成，而单测把 `register*Ipc` 直接接在一张 Map 上，
 * 既没有 app 也没有帧——于是每条通道的 handler 都会先撞上「来源判定还没装上」。
 * 这个夹具补的就是装配层那一句，顺便把事件形状摆正：`senderFrame` 是主帧（`parent === null`）、
 * URL 就是被认作自己人的那一份页面。
 *
 * 【它不是第二份判据】这里只**造形状**，一次比较都不做：不解析 URL、不比 origin、不读 env。
 * 「什么算自己人」这句话仍然只在 `ipc-guard.ts` 里写了一遍——`ipc-guard-coverage.test.ts`
 * 专门钉着这一点（它对这个文件的豁免仅限「可以出现 senderFrame 这个词」）。
 */
import { installRendererTrust, type RendererTrust, type SenderEventLike } from "./ipc-guard.js";

/** 开发态那一份页面的地址；夹具把它同时装成「被信任的来源」与「事件里的那一帧」。 */
export const TRUSTED_FRAME_URL = "http://localhost:5173/index.html";

/**
 * 装上信任并返回一份合法事件。
 *
 * 每次调用都重装修正一遍（幂等赋值）：单测文件之间会并行跑模块加载顺序，
 * 把「装信任」做成调用方的前置义务，早晚有一处忘了装而把用例判成红——那是假的失败。
 */
export function trustedRendererEvent(
  trust: RendererTrust = { allowedUrl: TRUSTED_FRAME_URL }
): SenderEventLike {
  installRendererTrust(trust);
  return { senderFrame: { url: trust.allowedUrl, parent: null } };
}

/** 反面夹具：远程页面／子帧发来的那一帧。信任仍装在本机页面上，所以这一枚必须被拒。 */
export function untrustedRendererEvent(
  options: { url?: string; parent?: boolean; nullFrame?: boolean } = {}
): SenderEventLike {
  installRendererTrust({ allowedUrl: TRUSTED_FRAME_URL });
  if (options.nullFrame === true) return { senderFrame: null };
  return {
    senderFrame: {
      url: options.url ?? "https://not-our-page.example/index.html",
      parent: options.parent === true ? { url: TRUSTED_FRAME_URL, parent: null } : null
    }
  };
}

/** 把信任拆掉：用于「没装配＝一律不信」那条 fail-closed 断言。 */
export function uninstallRendererTrust(): void {
  installRendererTrust(null);
}

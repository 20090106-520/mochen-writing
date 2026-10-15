/**
 * 通道级授权（channel-trust.ts）的用例——2026-10-15 台账第七十四节从 ipc-guard.test.ts 拆出。
 *
 * 【为什么单独一份】ipc-guard.test.ts 已顶到 800 行预算（来源闸 / 形状闸 / realpath 闸 / 窗口闸
 * 都挤在那一份），sensitive 档再加十来条就把预算顶破。判据真身 channel-trust.ts 当初同样为预算
 * 从 ipc-guard.ts 拆出去（见它顶上那段头注释）——用例跟着判据一起走，判据仍然只有一份。
 *
 * 【这里钉什么】每条非 public 通道属哪一档、三档各自要求什么运行时态、以及 fail closed。
 * 「参数长什么样」与「来源可不可信」不归这一份（那两块在 ipc-guard.test.ts）。
 */
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "@mochen/contracts";

import {
  IPC_ARG_SHAPES,
  IPC_NO_ARG_CHANNELS,
  handleTrusted,
  installRendererTrust,
  type FrameLike,
  type GuardedCall,
  type IpcRegistrar,
  type SenderEventLike
} from "./ipc-guard.js";
import { IPC_TRUST_LEVELS, channelTrustVerdict, installChannelTrustDeps } from "./channel-trust.js";

/** 开发态那一份页面地址：与 ipc-guard.test.ts 同源（来源闸认得它，本文件只测档位）。 */
const DEV_URL = "http://localhost:5173/";

function frame(url: string, parent: FrameLike | null = null): FrameLike {
  return { url, parent };
}
function event(senderFrame: FrameLike): SenderEventLike {
  return { senderFrame };
}

/** 一张假注册表：记下每条通道真正注册的 handler，好按 electron 的调用形状触发。 */
function registry(): { fns: Map<string, GuardedCall>; register: IpcRegistrar } {
  const fns = new Map<string, GuardedCall>();
  const register: IpcRegistrar = (channel, fn) => {
    fns.set(channel, fn);
  };
  return { fns, register };
}

describe("channelTrustVerdict：通道级授权（self 档要书、sensitive 档要书且没有轮在跑）", () => {
  /** 装来源 trust + 两枚通道查询器（root=null 表示没开书）。 */
  function installWithBook(root: string | null, turnRunning: boolean): void {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps({ currentBookRoot: () => root, turnRunning: () => turnRunning });
  }

  /** 装好来源 trust + 通道查询器（root=null 表示没开书、空闲），注册一条通道，触发；返回 "passthrough" 或抛错消息。 */
  function fireWithBook(channel: string, root: string | null, ...args: unknown[]): unknown {
    installWithBook(root, false);
    const reg = registry();
    handleTrusted(reg.register, channel, () => "passthrough");
    const fn = reg.fns.get(channel)!;
    try {
      return fn(event(frame(DEV_URL)), ...args);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  it("self 档通道：没装 ChannelTrustDeps 时 fail closed（与来源闸没装 trust 同款）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps(null);
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.bookSaveMeta, () => {
      called += 1;
      return "不该走到这里";
    });
    expect(() => reg.fns.get(IPC_CHANNELS.bookSaveMeta)!(event(frame(DEV_URL)), {})).toThrowError(
      /通道级授权没装上|按不可信处理/
    );
    expect(called).toBe(0);
  });

  it("self 档通道：装了查询器但 currentBookRoot 返回 null（没开书）⇒ 挡下，handler 不被叫到", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps({ currentBookRoot: () => null, turnRunning: () => false });
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.docRead, () => {
      called += 1;
      return "不该走到这里";
    });
    expect(() =>
      reg.fns.get(IPC_CHANNELS.docRead)!(event(frame(DEV_URL)), "chapters/01.md")
    ).toThrowError(/self 档|没有书|当前已打开/);
    expect(called).toBe(0);
  });

  it("self 档通道：装了查询器且有书 ⇒ 照常通过到形状闸", () => {
    expect(fireWithBook(IPC_CHANNELS.docRead, "D:/books/潮信", "chapters/01.md")).toBe(
      "passthrough"
    );
    expect(fireWithBook(IPC_CHANNELS.bookSaveMeta, "D:/books/潮信", {})).toBe("passthrough");
  });

  it("public 档通道：不查 currentBookRoot，没装查询器 / 没书都照常过", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps(null);
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.skillsList, () => "ok");
    expect(reg.fns.get(IPC_CHANNELS.skillsList)!(event(frame(DEV_URL)))).toBe("ok");
    expect(fireWithBook(IPC_CHANNELS.webdavConfigGet, null)).toBe("passthrough");
  });

  it("挡下时说得出理由：「没装上」与「没有书」是两回事，日志要分得开", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps(null);
    expect(channelTrustVerdict(IPC_CHANNELS.docRead)).toMatch(/没装上|按不可信/);
    installChannelTrustDeps({ currentBookRoot: () => null, turnRunning: () => false });
    const reasonNoBook = channelTrustVerdict(IPC_CHANNELS.docRead);
    expect(reasonNoBook).toMatch(/self 档|没有书|当前已打开/);
    expect(reasonNoBook).not.toMatch(/没装上/);
    installChannelTrustDeps({ currentBookRoot: () => "D:/books/潮信", turnRunning: () => false });
    expect(channelTrustVerdict(IPC_CHANNELS.docRead)).toBeNull();
  });

  it("IPC_TRUST_LEVELS 表里每条都是 contracts 里的真通道名，档位非 public，且落在形状表 ∪ 无参清单的并集里", () => {
    const real = new Set<string>(Object.values(IPC_CHANNELS));
    const covered = new Set([...Object.keys(IPC_ARG_SHAPES), ...IPC_NO_ARG_CHANNELS]);
    for (const channel of Object.keys(IPC_TRUST_LEVELS)) {
      expect(real.has(channel), `${channel} 不是 contracts 里的通道名`).toBe(true);
      // 表里只登记非 public 档；档位必须落在 self / sensitive 里（多出第三档时就该有人来改这句）。
      expect(["self", "sensitive"], `${channel} 的档位既不是 self 也不是 sensitive`).toContain(
        IPC_TRUST_LEVELS[channel]
      );
      expect(
        covered.has(channel),
        `${channel} 在 IPC_TRUST_LEVELS 里但形状表与无参清单都没落`
      ).toBe(true);
    }
  });

  it("sensitive 档清单恰为这两条（整书级批量改写）：多一条少一条都得先改这条断言", () => {
    const sensitive = Object.keys(IPC_TRUST_LEVELS).filter(
      (channel) => IPC_TRUST_LEVELS[channel] === "sensitive"
    );
    expect(sensitive.sort()).toEqual(
      [IPC_CHANNELS.bookReplaceAll, IPC_CHANNELS.importCommit].sort()
    );
  });

  it("sensitive 档通道：有书但没有轮在跑 ⇒ 照常通过到形状闸", () => {
    installWithBook("D:/books/潮信", false);
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.bookReplaceAll, () => "passthrough");
    expect(
      reg.fns.get(IPC_CHANNELS.bookReplaceAll)!(event(frame(DEV_URL)), {
        query: "小明",
        replacement: "阿明"
      })
    ).toBe("passthrough");
    expect(channelTrustVerdict(IPC_CHANNELS.bookReplaceAll)).toBeNull();
  });

  it("sensitive 档通道：有书但有一轮 agent 正在跑 ⇒ 挡下，handler 不被叫到", () => {
    installWithBook("D:/books/潮信", true);
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.bookReplaceAll, () => {
      called += 1;
      return "不该走到这里";
    });
    // book:replace-all 有 deny 回执（照 BookReplaceResult 的失败档回话），所以这里是被「回一个失败」
    // 挡下而不是抛错——与 import:commit 同款（那两条通道的调用点都是 await 后按 result.ok 分支）。
    const reply = reg.fns.get(IPC_CHANNELS.bookReplaceAll)!(event(frame(DEV_URL)), {
      query: "小明",
      replacement: "阿明"
    }) as Record<string, unknown>;
    expect(reply.ok).toBe(false);
    expect(String(reply.message)).toMatch(/sensitive 档|有一轮智能体正在跑/);
    expect(called).toBe(0);
    expect(channelTrustVerdict(IPC_CHANNELS.importCommit)).toMatch(/有一轮智能体正在跑/);
  });

  it("sensitive 档通道：没开书时先撞「没有书」那道快判（有书是它的前置）", () => {
    // 有轮但没书：理由必须是「没有书」，不是「有一轮在跑」——两档共用同一道前置快判。
    installWithBook(null, true);
    const reason = channelTrustVerdict(IPC_CHANNELS.bookReplaceAll);
    expect(reason).toMatch(/sensitive 档/);
    expect(reason).toMatch(/当前已打开一本书|没有书|当前已打开/);
    expect(reason).not.toMatch(/有一轮智能体正在跑/);
  });

  it("self 档通道在 check 闸之前挡下：不走到 realpath（realpath 闸不会因为没书被误触发）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps({ currentBookRoot: () => null, turnRunning: () => false });
    const reg = registry();
    let checkCalled = 0;
    handleTrusted(reg.register, IPC_CHANNELS.docWrite, () => "不该走到这里", {
      check: () => {
        checkCalled += 1;
        return null;
      }
    });
    const reply = reg.fns.get(IPC_CHANNELS.docWrite)!(
      event(frame(DEV_URL)),
      "chapters/01.md",
      "正文",
      "fp"
    ) as Record<string, unknown>;
    expect(reply.ok).toBe(false);
    expect(String(reply.message)).toMatch(/self 档|没有书|当前已打开/);
    expect(checkCalled).toBe(0);
  });

  it("没挂 insideCurrentBook 的 self 档通道：原先没书时靠 service 各自判 no-book，现在主进程侧先挡", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    installChannelTrustDeps({ currentBookRoot: () => null, turnRunning: () => false });
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.bookSaveMeta, () => {
      called += 1;
      return "不该走到这里";
    });
    expect(() => reg.fns.get(IPC_CHANNELS.bookSaveMeta)!(event(frame(DEV_URL)), {})).toThrowError(
      /self 档|没有书|当前已打开/
    );
    expect(called).toBe(0);
  });
});

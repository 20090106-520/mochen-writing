import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { IPC_CHANNELS } from "@mochen/contracts";

import {
  IPC_ARG_SHAPES,
  IPC_NO_ARG_CHANNELS,
  MAX_ABS_PATH_CHARS,
  MAX_BODY_CHARS,
  MAX_REL_PATH_CHARS,
  argRulesFor,
  handleTrusted,
  installRendererTrust,
  installedRendererTrust,
  isSameRendererOrigin,
  isTrustedSender,
  relPathStaysInsideRoot,
  resolveRendererLoad,
  senderTrustVerdict,
  type FrameLike,
  type GuardedCall,
  type IpcRegistrar,
  type SenderEventLike
} from "./ipc-guard.js";

/**
 * IPC 来源闸与参数形状闸（2026-10-10 全仓扫描 P1-7 / P1-8 的第一环）。
 *
 * 【要钉住的事故】`book:open` 把 renderer 递来的 string 直接当**绝对路径**去读 `book.json`，
 * `book:create` 的 directory 同样；`doc:write` 只有 fs-store 那层的词法 `..` 检查。
 * 而所有 `ipcMain.handle` 入口一律把 `_event` 丢掉 ⇒ 主进程根本不看「这条是谁发的」。
 * 叠加窗口没有导航闸（P1-8），一旦渲染层能跑脚本：写 `<appData>/plugins/x/index.js`
 * 再触发 `plugins:list` 的 `import()`，就是**主进程任意代码执行**。
 *
 * 【字段语义按 Electron 42 的类型定义来，不猜】
 * - `IpcMainInvokeEvent.senderFrame`：`WebFrameMain | null`，官方注释写明「在帧已导航或被销毁后
 *   取到的是 null」⇒ null 必须当不可信，不能当「没信息就算了」。
 * - `WebFrameMain.parent`：`WebFrameMain | null`，注释写明「top frame 时为 null」
 *   ⇒ 非主 frame 的判据是 `parent !== null`。（42 的 invoke 事件上并没有 `parentFrameId` 这枚字段，
 *   只有 `frameId` / `processId`；拿 frameId 与 -1 比会永远判不出子帧，所以用 parent。）
 * - `WebFrameMain.url`：这一帧当前的 URL ⇒ 唯一能拿来比「是不是我们这个窗口那一份页面」的东西。
 */

const DEV_URL = "http://localhost:5173/";
const PACKAGED = "file:///C:/Users/me/AppData/Local/Programs/mochen/out/renderer/index.html";

function frame(url: string, parent: FrameLike | null = null): FrameLike {
  return { url, parent };
}
function event(senderFrame?: FrameLike | null): SenderEventLike {
  // 「没递 senderFrame」与「递了 null」是两种畸形（前者像被改写的 preload，后者是帧已销毁），
  // 但闸对两者都判不可信 ⇒ 这里只造形状、不判语义。
  // `exactOptionalPropertyTypes` 下不许把 `undefined` 塞进 `senderFrame?: FrameLike | null`，所以干脆不落这个键。
  return senderFrame === undefined ? {} : { senderFrame };
}

/**
 * 临时把 `process.platform` 换成指定值跑一段，跑完原样装回去。
 *
 * 管得到的只有一件事：**调用时**读 `process.platform` 的代码（这里就是 `samePathText` 那枚平台分叉）。
 * 管不到 node:path / node:url 内部的 win32 绑定——那些在模块加载时就定好了，桩改了也不回头重算。
 * 所以走这个桩的用例只喂字面量 URL，不碰 `pathToFileURL`，免得「桩说的是 linux、path 干的是 win32」自己骗自己。
 */
function withPlatform<T>(value: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (descriptor === undefined) throw new Error("process.platform 没有描述符，桩没法装回去");
  Object.defineProperty(process, "platform", { ...descriptor, value });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

/** 一张假注册表：记下每条通道真正注册的 handler，好按 electron 的调用形状触发。 */
function registry(): { channels: string[]; fns: Map<string, GuardedCall>; register: IpcRegistrar } {
  const channels: string[] = [];
  const fns = new Map<string, GuardedCall>();
  const register: IpcRegistrar = (channel, fn) => {
    channels.push(channel);
    fns.set(channel, fn);
  };
  return { channels, fns, register };
}

beforeEach(() => {
  // 判定用的 trust 是启动时装上去的那一份（见 index.ts）；用例之间不许互留。
  installRendererTrust(null);
});

describe("isTrustedSender：只认这一个渲染层来源", () => {
  it("打包态：主 frame 的 URL 正是 index.html ⇒ 通过", () => {
    expect(isTrustedSender(event(frame(PACKAGED)), { allowedUrl: PACKAGED })).toBe(true);
  });

  it("打包态：同一个 file:// 盘上的另一个 html 不算（preload 照样会注进去）", () => {
    expect(
      isTrustedSender(event(frame(PACKAGED.replace("index.html", "evil.html"))), {
        allowedUrl: PACKAGED
      })
    ).toBe(false);
  });

  it("打包态：远程 https 页面被导航进来后发的消息一律拒", () => {
    expect(
      isTrustedSender(event(frame("https://evil.example.com/index.html")), { allowedUrl: PACKAGED })
    ).toBe(false);
  });

  it("开发态：同一 http origin 带 query（vite HMR 整页重载会加）算我们自己", () => {
    expect(
      isTrustedSender(event(frame("http://localhost:5173/?t=1700000000")), { allowedUrl: DEV_URL })
    ).toBe(true);
  });

  it("开发态：origin 之外（换端口 / 换主机名）都拒", () => {
    const trust = { allowedUrl: DEV_URL };
    expect(isTrustedSender(event(frame("http://localhost:9999/")), trust)).toBe(false);
    expect(isTrustedSender(event(frame("http://127.0.0.1:5173/")), trust)).toBe(false);
  });

  it("非主 frame（parent 不是 null）即便同源也拒：iframe 不该拿到整套 window.mochen", () => {
    const child = frame(DEV_URL, frame(DEV_URL));
    expect(isTrustedSender(event(child), { allowedUrl: DEV_URL })).toBe(false);
  });

  it("senderFrame 为 null（帧已导航或被销毁）＝拒，不是「没信息就放过」", () => {
    const trust = { allowedUrl: DEV_URL };
    expect(isTrustedSender(event(null), trust)).toBe(false);
    expect(isTrustedSender(event(undefined), trust)).toBe(false);
  });

  it("事件形状不对（undefined、裸对象、senderFrame 不是对象）＝拒且不抛", () => {
    const trust = { allowedUrl: DEV_URL };
    expect(() => isTrustedSender(undefined, trust)).not.toThrow();
    expect(isTrustedSender({}, trust)).toBe(false);
    expect(isTrustedSender({ senderFrame: DEV_URL } as never, trust)).toBe(false);
  });

  it("帧 URL 解不出来（about:blank、空串）＝拒", () => {
    const trust = { allowedUrl: DEV_URL };
    expect(isTrustedSender(event(frame("about:blank")), trust)).toBe(false);
    expect(isTrustedSender(event(frame("")), trust)).toBe(false);
  });

  it("没有安装过 trust（启动装配还没跑）＝一律拒：闸没装好时不许变成全放行", () => {
    expect(installedRendererTrust()).toBeNull();
    expect(isTrustedSender(event(frame(DEV_URL)))).toBe(false);
    expect(senderTrustVerdict(event(frame(DEV_URL))).trusted).toBe(false);
  });

  it("安装过之后，不传 trust 的那条调用走安装好的那一份（判据只有一份）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    expect(isTrustedSender(event(frame(DEV_URL)))).toBe(true);
    expect(isTrustedSender(event(frame("https://evil.example.com/")))).toBe(false);
  });

  it("理由说得出「为什么被拒」：外部来源、子帧、帧没了是三回事，日志要分得开", () => {
    const trust = { allowedUrl: DEV_URL };
    expect(senderTrustVerdict(event(frame("https://evil.example.com/")), trust).reason).toMatch(
      /来源|origin/i
    );
    expect(senderTrustVerdict(event(frame(DEV_URL, frame(DEV_URL))), trust).reason).toMatch(
      /子帧|frame/i
    );
    expect(senderTrustVerdict(event(null), trust).reason).toMatch(/帧|frame/i);
  });

  it("打包态允许带 hash 的同一条页面（路由级跳转不改文档 URL 的 path）", () => {
    expect(isTrustedSender(event(frame(`${PACKAGED}#/settings`)), { allowedUrl: PACKAGED })).toBe(
      true
    );
  });

  it("Windows：file:// 的大小写差异认得（realpath 与 URL 的盘符大小写本来就不一致）", () => {
    const trust = { allowedUrl: "file:///C:/Users/me/out/renderer/index.html" };
    const trusted = withPlatform("win32", () =>
      isTrustedSender(event(frame("file:///c:/users/me/out/renderer/index.html")), trust)
    );
    expect(trusted).toBe(true);
  });

  it("Linux：只差大小写就是**另一个文件**，不许认（认了等于放行同一台机器上别的 html）", () => {
    const trust = { allowedUrl: "file:///srv/mochen/out/renderer/index.html" };
    const trusted = withPlatform("linux", () =>
      isTrustedSender(event(frame("file:///srv/mochen/out/renderer/Index.html")), trust)
    );
    expect(trusted).toBe(false);
  });
});

describe("handleTrusted：不可信调用挡回去，且按各通道现有契约回话", () => {
  it("可信 + 参数形状合法 ⇒ 原样调用、原样返回，通道名也照常落到注册表", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(
      reg.register,
      IPC_CHANNELS.bookOpen,
      (_e, rootPath) => `opened:${String(rootPath)}`
    );
    expect(reg.channels).toEqual([IPC_CHANNELS.bookOpen]);
    expect(reg.fns.get(IPC_CHANNELS.bookOpen)!(event(frame(DEV_URL)), "D:/books/潮信")).toBe(
      "opened:D:/books/潮信"
    );
  });

  it("不可信来源 ⇒ handler 一次都不许被叫到，默认抛中文错误", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.bookOpen, () => {
      called += 1;
      return "不该走到这里";
    });
    expect(() =>
      reg.fns.get(IPC_CHANNELS.bookOpen)!(
        event(frame("https://evil.example.com/")),
        "D:/books/潮信"
      )
    ).toThrowError(/这个应用自己的窗口|来源/);
    expect(called).toBe(0);
  });

  it("没装 trust 时 handleTrusted 也拦：装配顺序出错不能让通道裸奔", () => {
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.docRead, () => {
      called += 1;
    });
    expect(() =>
      reg.fns.get(IPC_CHANNELS.docRead)!(event(frame(DEV_URL)), "chapters/01.md")
    ).toThrow();
    expect(called).toBe(0);
  });

  it("doc:write 的形状被拒时回它自己那套 DocWriteResult：渲染层解析不破，也不许谎称写成功", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.docWrite, () => ({ ok: true }));
    const reply = reg.fns.get(IPC_CHANNELS.docWrite)!(
      event(frame(DEV_URL)),
      "chapters/01.md",
      42,
      "fp"
    ) as Record<string, unknown>;
    expect(reply).toEqual({
      ok: false,
      reason: "invalid-path",
      message: expect.stringContaining("正文")
    });
  });

  it("doc:refresh 被挡时回它自己那套 DocRefreshResult：渲染层 await 到的是回话，不是抛错", () => {
    // 这条为什么必须存在：`syncDocRef` 里是 `await window.mochen.refreshDoc(...)` 后按 `result.ok` 分支，
    // 抛错会让整条改名/吸收写入的链路红屏中断，而这条通路本来就是「算不出就退回重扫」的可降级路径。
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.docRefresh, () => ({ ok: true, doc: null }));
    const reply = reg.fns.get(IPC_CHANNELS.docRefresh)!(event(frame(DEV_URL)), 42) as Record<
      string,
      unknown
    >;
    expect(reply).toEqual({
      ok: false,
      reason: "invalid-path",
      message: expect.stringContaining("重算文稿")
    });
    // 越界（check 那一路）才是 outside-book：两种理由不许混成一枚，渲染层据此说不同的话。
    const reg2 = registry();
    handleTrusted(reg2.register, IPC_CHANNELS.docRefresh, () => ({ ok: true, doc: null }), {
      check: () => "这条路径落在这本书外面"
    });
    expect(reg2.fns.get(IPC_CHANNELS.docRefresh)!(event(frame(DEV_URL)), "chapters/01.md")).toEqual(
      {
        ok: false,
        reason: "outside-book",
        message: "这条路径落在这本书外面"
      }
    );
  });

  it("book:create 的形状被拒时回 {ok:false,message}（这条现有契约里没有 reason 字段）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.bookCreate, () => ({ ok: true }));
    expect(reg.fns.get(IPC_CHANNELS.bookCreate)!(event(frame(DEV_URL)), null)).toEqual({
      ok: false,
      message: expect.any(String)
    });
  });

  it("book-data:write 的形状被拒时回 {ok:false,reason,message}（P0-7 那套四档口径）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.bookDataWrite, () => ({ ok: true }));
    const reply = reg.fns.get(IPC_CHANNELS.bookDataWrite)!(
      event(frame(DEV_URL)),
      "notes",
      7
    ) as Record<string, unknown>;
    expect(reply.ok).toBe(false);
    expect(["invalid-key", "not-json"]).toContain(String(reply.reason));
    expect(typeof reply.message).toBe("string");
  });

  it("deny 可以由调用点覆盖（回话形状留给通道自己，判据仍然只有一份）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, "custom:channel", () => "不该走到这里", {
      deny: () => ({ refused: true })
    });
    expect(reg.fns.get("custom:channel")!(event(frame("https://evil.example.com/")))).toEqual({
      refused: true
    });
  });
});

describe("参数形状闸：不再靠 as string 断言", () => {
  /** 装好 trust、注册一条通道，然后用合法来源触发；返回 "passthrough" 表示真到了 handler。 */
  function fire(channel: string, ...args: unknown[]): string {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    let reached = false;
    handleTrusted(reg.register, channel, () => {
      reached = true;
      return "passthrough";
    });
    const fn = reg.fns.get(channel)!;
    try {
      const reply = fn(event(frame(DEV_URL)), ...args);
      if (reply === "passthrough" && reached) return "passthrough";
      return reached ? "handler-回话被改写" : "refused";
    } catch {
      return "refused";
    }
  }

  it("book:open 的非字符串（数字、对象、undefined、null、数组、布尔）全拒", () => {
    for (const bad of [42, { path: "D:/x" }, undefined, null, ["D:/x"], true]) {
      expect(fire(IPC_CHANNELS.bookOpen, bad), `坏值 ${String(bad)} 该被挡`).toBe("refused");
    }
  });

  it("空串与全空格被拒：路径不能是空的", () => {
    expect(fire(IPC_CHANNELS.bookOpen, "")).toBe("refused");
    expect(fire(IPC_CHANNELS.bookOpen, "   ")).toBe("refused");
    expect(fire(IPC_CHANNELS.docRead, "")).toBe("refused");
  });

  it("含 NUL 的串被拒：`\\0` 把路径后半截藏起来，fs 那边报的是谁也看不懂的错", () => {
    expect(fire(IPC_CHANNELS.bookOpen, "D:/books/潮信\0../../etc/passwd")).toBe("refused");
    expect(fire(IPC_CHANNELS.docRead, "chapters/01.md\0.evil")).toBe("refused");
    expect(fire(IPC_CHANNELS.docWrite, "chapters/01.md", "正文\0", "fp")).toBe("refused");
  });

  it("超长被拒（路径与正文各有上限，超限说明不是正常渲染层递来的东西）", () => {
    expect(fire(IPC_CHANNELS.bookOpen, "D:/" + "a".repeat(MAX_ABS_PATH_CHARS))).toBe("refused");
    expect(
      fire(IPC_CHANNELS.docWrite, "chapters/01.md", "字".repeat(MAX_BODY_CHARS + 1), "fp")
    ).toBe("refused");
    // 正常长度必须放行，否则闸把合法保存也挡了
    expect(fire(IPC_CHANNELS.docWrite, "chapters/01.md", "正常正文", "fp")).toBe("passthrough");
  });

  it("doc:write 的第三个实参（期望指纹）也得是字符串：非串等于绕过指纹闸", () => {
    expect(fire(IPC_CHANNELS.docWrite, "chapters/01.md", "正文", {})).toBe("refused");
    expect(fire(IPC_CHANNELS.docWrite, "chapters/01.md", "正文", "fp-1")).toBe("passthrough");
  });

  it("doc:refresh 只收一条合法的书内相对路径（新通道不落形状表＝P1-7 的原病复发）", () => {
    expect(fire(IPC_CHANNELS.docRefresh, "chapters/01.md")).toBe("passthrough");
    for (const bad of [
      42,
      undefined,
      null,
      {},
      ["chapters/01.md"],
      "",
      "   ",
      "chapters/01.md\0.md",
      "x".repeat(MAX_REL_PATH_CHARS + 1)
    ]) {
      expect(fire(IPC_CHANNELS.docRefresh, bad), `坏值 ${String(bad)} 该被挡`).toBe("refused");
    }
  });

  it("在册通道都在形状表里点名；带参数的每条至少有一则规则（新增通道不落表就红）", () => {
    const real = new Set<string>(Object.values(IPC_CHANNELS));
    for (const channel of Object.keys(IPC_ARG_SHAPES)) {
      expect(real.has(channel), `${channel} 不是 contracts 里的通道名`).toBe(true);
    }
    // 形状闸按位置判：带参数的通道如果整条空着（写 `[]`），那位参数就等于没验过。
    // 「带不带参数」这件事由运行时那条用例钉（注册表里的 handler 真接了几个实参）。
    for (const channel of Object.keys(IPC_ARG_SHAPES)) {
      const rules = argRulesFor(channel);
      expect(
        rules.length,
        `${channel} 要么给每枚参数一条规则，要么进 IPC_NO_ARG_CHANNELS`
      ).toBeGreaterThan(0);
      // 两边都落＝两份口径：带参数的通道不许再出现在「没有参数」那份清单里。
      expect(
        IPC_NO_ARG_CHANNELS.includes(channel),
        `${channel} 既有形状规则又被列为「没有参数」，两份判据会分家`
      ).toBe(false);
    }
    // 这三条是这次事故的两环本身，少一条都算没修
    for (const channel of [
      IPC_CHANNELS.bookOpen,
      IPC_CHANNELS.bookCreate,
      IPC_CHANNELS.docWrite,
      IPC_CHANNELS.docRead,
      IPC_CHANNELS.docCreate
    ]) {
      expect(IPC_ARG_SHAPES[channel], `${channel} 必须有形状规则`).toBeDefined();
    }
  });

  it("形状表 ∪ 「没有参数」清单 = 全部要收的通道：一条都不许两边都不落", () => {
    // 主进程**推**给渲染层的两条不在内（渲染层收，不走这道闸）。
    // 标注成 `Set<string>`：推出来的字面量类型太窄，`has(任意一条通道)` 会被判成参数不兼容。
    const pushed = new Set<string>([IPC_CHANNELS.agentEvent, IPC_CHANNELS.appFlushQuitRequest]);
    const covered = new Set([...Object.keys(IPC_ARG_SHAPES), ...IPC_NO_ARG_CHANNELS]);
    const missing = Object.values(IPC_CHANNELS).filter(
      (channel) => !pushed.has(channel) && !covered.has(channel)
    );
    expect(
      missing,
      "这些通道既没有形状规则也没登记为「没有参数」——P1-7 的原病就是这么漏的"
    ).toEqual([]);
  });

  it("未在册的通道也仍然有来源闸（形状表只管参数，不管来源）", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, "brand:new-channel", () => "ok");
    expect(() =>
      reg.fns.get("brand:new-channel")!(event(frame("https://evil.example.com/")))
    ).toThrow();
    expect(reg.fns.get("brand:new-channel")!(event(frame(DEV_URL)))).toBe("ok");
  });
});

describe("check 闸：doc:write 只能写当前那本书里面", () => {
  it("check 给回理由 ⇒ 挡回并走该通道的回话形状，handler 不被叫到", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    let called = 0;
    handleTrusted(reg.register, IPC_CHANNELS.docWrite, () => (called += 1), {
      check: () => "这条路不在这本书里面"
    });
    const reply = reg.fns.get(IPC_CHANNELS.docWrite)!(
      event(frame(DEV_URL)),
      "chapters/01.md",
      "正文",
      "fp"
    ) as Record<string, unknown>;
    expect(called).toBe(0);
    expect(reply.ok).toBe(false);
    expect(String(reply.message)).toContain("不在这本书里面");
  });

  it("check 通过 ⇒ 照常调用", () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.docWrite, () => "ok", { check: () => null });
    expect(reg.fns.get(IPC_CHANNELS.docWrite)!(event(frame(DEV_URL)), "a.md", "b", "c")).toBe("ok");
  });

  it("check 可以是异步的（realpath 是 Promise）", async () => {
    installRendererTrust({ allowedUrl: DEV_URL });
    const reg = registry();
    handleTrusted(reg.register, IPC_CHANNELS.docWrite, () => "ok", {
      check: async () => "慢的那道也说得出理由"
    });
    const reply = (await reg.fns.get(IPC_CHANNELS.docWrite)!(
      event(frame(DEV_URL)),
      "a.md",
      "b",
      "c"
    )) as Record<string, unknown>;
    expect(reply.ok).toBe(false);
  });
});

describe("relPathStaysInsideRoot：词法之上再加 realpath 级", () => {
  const ROOT = "D:/books/潮信";
  /** 注入的 realpath：只给「哪条路径真实解到哪」，用例不必真去建符号链接（Windows 上 EPERM 常见）。 */
  function fakeRealpath(map: Record<string, string>) {
    return {
      realpath: async (p: string) => {
        const hit = map[p.replace(/\\/g, "/")];
        if (hit !== undefined) return hit;
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
    };
  }

  it("书内的普通相对路径 ⇒ 放行", async () => {
    const ok = await relPathStaysInsideRoot(
      ROOT,
      "chapters/01.md",
      fakeRealpath({
        [`${ROOT}/chapters/01.md`]: `${ROOT}/chapters/01.md`,
        [`${ROOT}/chapters`]: `${ROOT}/chapters`,
        [ROOT]: ROOT
      })
    );
    expect(ok).toBe(true);
  });

  it("符号链接指向书外 ⇒ 拒（词法检查逐字都对，只有 realpath 看得穿）", async () => {
    const ok = await relPathStaysInsideRoot(
      ROOT,
      "chapters/01.md",
      fakeRealpath({
        [`${ROOT}/chapters/01.md`]: "D:/Users/me/AppData/Roaming/mochen-ai/plugins/x/index.js",
        [`${ROOT}/chapters`]: `${ROOT}/chapters`,
        [ROOT]: ROOT
      })
    );
    expect(ok).toBe(false);
  });

  it("父目录被软链搬到书外 ⇒ 拒", async () => {
    const ok = await relPathStaysInsideRoot(
      ROOT,
      "chapters/01.md",
      fakeRealpath({ [`${ROOT}/chapters`]: "D:/elsewhere", [ROOT]: ROOT })
    );
    expect(ok).toBe(false);
  });

  it("目标还不存在（新建文档）⇒ 退到最近的已存在父目录判定，不误伤合法新建", async () => {
    const ok = await relPathStaysInsideRoot(
      ROOT,
      "chapters/02-新章.md",
      fakeRealpath({ [`${ROOT}/chapters`]: `${ROOT}/chapters`, [ROOT]: ROOT })
    );
    expect(ok).toBe(true);
  });

  it("两级目录都不存在（新分类的第一篇）⇒ 最近祖先就是书根本身，放行", async () => {
    // 2026-10-10 实测逮住的回归：骨架只建 4 个分类目录，worldview 这类还没落过第一篇的
    // 分类连目录都没有，回退链走到书根时旧捷径直接判外 ⇒ 新书永远建不出第一篇世界观。
    const ok = await relPathStaysInsideRoot(
      ROOT,
      "worldview/大陆与王朝.md",
      fakeRealpath({ [ROOT]: ROOT })
    );
    expect(ok).toBe(true);
  });

  it("连书根自己都解不出来 ⇒ 当作不可用，拒", async () => {
    expect(await relPathStaysInsideRoot(ROOT, "chapters/01.md", fakeRealpath({}))).toBe(false);
  });

  it("绝对路径 / 带 .. / 空串：不交给 fs 就直接拒", async () => {
    const never = {
      realpath: async () => {
        throw new Error("不该被叫到");
      }
    };
    expect(await relPathStaysInsideRoot(ROOT, "D:/Windows/system.ini", never)).toBe(false);
    expect(await relPathStaysInsideRoot(ROOT, "../outside.md", never)).toBe(false);
    expect(await relPathStaysInsideRoot(ROOT, "", never)).toBe(false);
    expect(await relPathStaysInsideRoot(ROOT, "chapters/../../x.md", never)).toBe(false);
  });

  it("默认用真的 fs：书目录里的真文件判成放行，指向外面的软链判成越界", async () => {
    const { mkdtemp, realpath, rm, symlink, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const root = await mkdtemp(path.join(tmpdir(), "mochen-guard-"));
    try {
      await mkdir(path.join(root, "chapters"), { recursive: true });
      await writeFile(path.join(root, "chapters", "01.md"), "正文\n", "utf8");
      expect(await relPathStaysInsideRoot(root, "chapters/01.md", { realpath })).toBe(true);
      // 软链逃逸：Windows 上普通用户建符号链接常报 EPERM，那种环境里跳过这一断言并说明原因。
      try {
        const outside = await mkdtemp(path.join(tmpdir(), "mochen-outside-"));
        await writeFile(path.join(outside, "index.js"), "// 插件", "utf8");
        await symlink(
          path.join(outside, "index.js"),
          path.join(root, "chapters", "link.md"),
          "file"
        );
        // 沙箱里有软链 shim：symlink() 不报错但也**没真建出符号链接**（lstat 认不出 S_IFLNK）。
        // 那种环境下 link.md 是书里的普通文件，「判成放行」反而是对的——这条断言在这儿
        // 跑只会假红。真链在不在，lstat 一眼可辨：不在就说明这一条在本机没验到。
        const { lstat } = await import("node:fs/promises");
        const st = await lstat(path.join(root, "chapters", "link.md"));
        if (!st.isSymbolicLink()) {
          console.warn("[环境噪音] symlink() 静默没建出真软链（shim），软链逃逸那一条没验到");
        } else {
          expect(await relPathStaysInsideRoot(root, "chapters/link.md", { realpath })).toBe(false);
        }
        await rm(outside, { recursive: true, force: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "ENOSYS" && code !== "EEXIST" && code !== "EPERM ")
          throw err;
        console.warn(`[环境噪音] 本机建不了符号链接（${code}），软链逃逸那一条没验到`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveRendererLoad：打包版不许被 env 牵着走", () => {
  // 入口文件必须递**本机原生的绝对路径**，不许写死 `C:/…`：`pathToFileURL` 在 Windows 之外把
  // `C:/…` 当相对路径拼到 cwd 上（`file:///home/runner/work/…/C:/…`），于是断言里那条字面量
  // 在 CI（ubuntu）上永远对不上——那是用例自己的平台假设，不是闸的错。真实装配传的是
  // `app.getAppPath()` 一类的原生路径，本来也不会是 `C:/…`。
  const packagedIndex = path.resolve("mochen", "out", "renderer", "index.html");
  const repoIndex = path.resolve("repo", "apps", "desktop", "out", "renderer", "index.html");

  it("打包态：ELECTRON_RENDERER_URL 被污染也必须忽略", () => {
    const load = resolveRendererLoad({
      isPackaged: true,
      envRendererUrl: "https://evil.example.com/payload",
      packagedIndex
    });
    expect(load.kind).toBe("file");
    expect(load.target).toBe(packagedIndex);
    // 判据绕一圈回磁盘路径，而不是拿 `pathToFileURL` 再算一遍比：要钉的是
    // 「trust 指的就是这一份 html」，两边都换成平台写法就量不到了。
    expect(fileURLToPath(load.trust.allowedUrl)).toBe(packagedIndex);
  });

  it("开发态：用 env 给的那条 URL，且 trust 就是它", () => {
    const load = resolveRendererLoad({
      isPackaged: false,
      envRendererUrl: DEV_URL,
      packagedIndex: repoIndex
    });
    expect(load.kind).toBe("url");
    expect(load.target).toBe(DEV_URL);
    expect(load.trust.allowedUrl).toBe(DEV_URL);
  });

  it("开发态没给 env ⇒ 退回本地文件，trust 也跟着换成 file://", () => {
    const load = resolveRendererLoad({ isPackaged: false, packagedIndex: repoIndex });
    expect(load.kind).toBe("file");
    expect(load.target).toBe(repoIndex);
    expect(fileURLToPath(load.trust.allowedUrl)).toBe(repoIndex);
  });
});

describe("isSameRendererOrigin：导航闸用的同一份判据", () => {
  it("打包态：重载同一个 index.html 放行，别的都拒", () => {
    const trust = { allowedUrl: "file:///C:/repo/out/renderer/index.html" };
    expect(isSameRendererOrigin("file:///C:/repo/out/renderer/index.html", trust)).toBe(true);
    expect(isSameRendererOrigin("file:///C:/repo/out/renderer/index.html?t=1", trust)).toBe(true);
    expect(isSameRendererOrigin("https://example.com/", trust)).toBe(false);
    expect(isSameRendererOrigin("file:///C:/repo/out/renderer/other.html", trust)).toBe(false);
  });

  it("开发态：同源内允许（vite 整页重载会换 query），跨 origin 拒", () => {
    const trust = { allowedUrl: DEV_URL };
    expect(isSameRendererOrigin("http://localhost:5173/?t=2", trust)).toBe(true);
    expect(isSameRendererOrigin("http://localhost:5173/settings", trust)).toBe(true);
    expect(isSameRendererOrigin("https://evil.example.com/", trust)).toBe(false);
    expect(isSameRendererOrigin("not a url", trust)).toBe(false);
  });
});

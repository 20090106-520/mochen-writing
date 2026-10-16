import { describe, expect, it, beforeEach } from "vitest";

import { installRendererTrust, type FrameLike, type RendererTrust } from "./ipc-guard.js";
import { installWindowGuards, type WindowGuardDeps } from "./window-guards.js";

/**
 * 窗口侧的来源闸（2026-10-10 全仓扫描 P1-8）。
 *
 * 【要钉住的事故】`main/index.ts` 建完窗口就直接 `loadURL(process.env.ELECTRON_RENDERER_URL)`，
 * 全仓 `will-navigate` / `setWindowOpenHandler` 零命中 ⇒ 主窗口被导航到外部页面之后，
 * preload 仍然把整套 `window.mochen` 注给那个外部页面；打包版在 env 被污染时会加载远程 URL。
 * 这与 P1-7 是同一条链的两环：IPC 闸认的是「这一帧是不是我们自己的页面」，
 * 而导航闸负责让「我们的页面」这个集合真的只有一个成员。
 *
 * 判据不重抄一遍：这里用 `isSameRendererOrigin`（与 `isTrustedSender` 同一个 origin 比较），
 * 外部链接能不能叫浏览器用 `web-source-link` 那份 http/https 白名单。
 */

interface Harness {
  prevented: string[];
  notices: string[];
  opened: string[];
  openHandler?: (details: { url: string }) => { action: "deny" };
  navigateHandler?: (details: { url: string; preventDefault(): void }) => void;
  deps: WindowGuardDeps;
}

function harness(): Harness {
  const prevented: string[] = [];
  const notices: string[] = [];
  const opened: string[] = [];
  const state: Harness = {
    prevented,
    notices,
    opened,
    deps: {
      onWillNavigate: (handler) => {
        state.navigateHandler = handler;
      },
      setWindowOpenHandler: (handler) => {
        state.openHandler = handler;
      },
      openExternal: (url) => {
        opened.push(url);
      },
      notify: (text) => {
        notices.push(text);
      }
    }
  };
  return state;
}

const PACKAGED_TRUST: RendererTrust = {
  allowedUrl: "file:///C:/repo/apps/desktop/out/renderer/index.html"
};
const DEV_TRUST: RendererTrust = { allowedUrl: "http://localhost:5173/" };

beforeEach(() => {
  installRendererTrust(null);
});

describe("will-navigate", () => {
  it("重载我们自己的 index.html ⇒ 不拦（用户刷新、HMR 整页重载都走这条）", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    let prevented = false;
    h.navigateHandler?.({
      url: PACKAGED_TRUST.allowedUrl,
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(false);
    expect(h.notices).toEqual([]);
  });

  it("开发态：同源重载（带 query）放行", () => {
    const h = harness();
    installWindowGuards(h.deps, DEV_TRUST);
    let prevented = false;
    h.navigateHandler?.({
      url: "http://localhost:5173/?t=1700000000",
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(false);
  });

  it("外部页面 ⇒ preventDefault，并把理由递出去（不是只在主进程里悄悄记一行）", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    let prevented = false;
    h.navigateHandler?.({
      url: "https://evil.example.com/payload",
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(true);
    expect(h.notices.join("\n")).toMatch(/evil\.example\.com/);
    expect(h.notices.join("\n")).toMatch(/拦|不允许/);
  });

  it("file:// 的另一个本地文件同样拦：本地盘不等于我们自己的页面", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    let prevented = false;
    h.navigateHandler?.({
      url: "file:///C:/Users/me/Desktop/x.html",
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(true);
  });

  it("没安装 trust ⇒ 任何导航都拦：闸没装好时不许变成全放行", () => {
    const h = harness();
    installWindowGuards(h.deps);
    let prevented = false;
    h.navigateHandler?.({
      url: PACKAGED_TRUST.allowedUrl,
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(true);
    expect(h.notices.join("\n")).toMatch(/来源|trust|没装/);
  });

  it("URL 递进来是坏串 ⇒ 拦而不是抛：导航事件里抛错会把主进程带下去", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    let prevented = false;
    expect(() =>
      h.navigateHandler?.({
        url: "not a url",
        preventDefault: () => {
          prevented = true;
        }
      })
    ).not.toThrow();
    expect(prevented).toBe(true);
  });

  it("notify 自己抛错也不许把导航处理带下去（递话失败不等于放行）", () => {
    const h = harness();
    installWindowGuards(
      {
        ...h.deps,
        notify: () => {
          throw new Error("对话框都发不出去");
        }
      },
      PACKAGED_TRUST
    );
    let prevented = false;
    expect(() =>
      h.navigateHandler?.({
        url: "https://evil.example.com/",
        preventDefault: () => {
          prevented = true;
        }
      })
    ).not.toThrow();
    expect(prevented).toBe(true);
  });
});

describe("setWindowOpenHandler", () => {
  it("一律 deny：本 app 没有第二扇窗口，子窗口只能带来一张带 preload 的生面孔", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    for (const url of [
      "https://example.com/",
      PACKAGED_TRUST.allowedUrl,
      "file:///C:/Windows/notepad.exe",
      "javascript:alert(1)"
    ]) {
      expect(h.openHandler?.({ url })).toEqual({ action: "deny" });
    }
  });

  it("外部 http(s) 链接交给系统浏览器（本仓现有的「打开浏览器」只有 http/https 这一族）", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    h.openHandler?.({ url: "https://openrouter.ai/keys" });
    expect(h.opened).toEqual(["https://openrouter.ai/keys"]);
  });

  it("file:// / javascript: / 自注册 scheme 一律不递 openExternal：那是把参数交给别的软件", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    for (const url of [
      "file:///C:/Users/me/Desktop/a.html",
      "javascript:alert(1)",
      "data:text/html,hi",
      "myapp://do-thing",
      "http://user:pass@evil.example.com/"
    ]) {
      h.openHandler?.({ url });
    }
    expect(h.opened).toEqual([]);
  });

  it("openExternal 抛错不许带崩导航处理", () => {
    const h = harness();
    installWindowGuards(
      {
        ...h.deps,
        openExternal: () => {
          throw new Error("没有默认浏览器");
        }
      },
      PACKAGED_TRUST
    );
    expect(() => h.openHandler?.({ url: "https://example.com/" })).not.toThrow();
  });

  it("帧对象形状不合预期（url 不是串）时仍然 deny：闸的默认姿势是关", () => {
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    expect(h.openHandler?.({} as never)).toEqual({ action: "deny" });
    expect(h.openHandler?.({ url: 42 as never })).toEqual({ action: "deny" });
  });
});

describe("trust 的来源", () => {
  it("不传第二实参时用启动时装好的那一份（判据只许一份，装配点不许各传各的）", () => {
    installRendererTrust({ allowedUrl: DEV_TRUST.allowedUrl });
    const h = harness();
    installWindowGuards(h.deps);
    let prevented = false;
    h.navigateHandler?.({
      url: "http://localhost:5173/",
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(false);
  });

  it("装了 trust 之后又显式传一份 ⇒ 以传进来的那份为准（用例与真机装配都靠这条）", () => {
    installRendererTrust({ allowedUrl: DEV_TRUST.allowedUrl });
    const h = harness();
    installWindowGuards(h.deps, PACKAGED_TRUST);
    let prevented = false;
    h.navigateHandler?.({
      url: "http://localhost:5173/",
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(true);
  });
});

// 类型自检：FrameLike 的 parent 必须可空（非主帧判据的地基）。
const _typeProbe: FrameLike = { url: "file:///x/index.html", parent: null };
void _typeProbe;

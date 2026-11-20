/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { installWindowRecovery, loadFailureText, MAX_AUTO_RELOADS } from "./window-recovery.js";

function harness() {
  const lines: string[] = [];
  const notices: { title: string; detail: string }[] = [];
  let reloads = 0;
  let fire: ((details: { reason?: string }) => void) | null = null;
  installWindowRecovery({
    onRenderProcessGone: (handler) => {
      fire = handler;
    },
    reload: () => {
      reloads += 1;
    },
    log: (line) => lines.push(line),
    notify: (title, detail) => notices.push({ title, detail })
  });
  return {
    lines,
    notices,
    reloads: () => reloads,
    crash: (details: { reason?: string } = { reason: "crashed" }) => fire?.(details)
  };
}

describe("installWindowRecovery", () => {
  it("首次崩溃：留痕一次、提示一次、重载一次", () => {
    const h = harness();
    h.crash();

    expect(h.reloads()).toBe(1);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]?.detail).toContain("crashed");
    expect(h.lines[0]).toContain("渲染进程退出");
  });

  it("超过上限后只报不救，避免崩溃循环", () => {
    const h = harness();
    for (let i = 0; i < MAX_AUTO_RELOADS + 1; i += 1) h.crash();

    expect(h.reloads()).toBe(MAX_AUTO_RELOADS);
    expect(h.notices).toHaveLength(2);
    expect(h.notices[1]?.detail).toContain("停止自动重载");
  });

  it("没有 reason 时按未知原因处理", () => {
    const h = harness();
    h.crash({});

    expect(h.lines[0]).toContain("未知原因");
  });

  it("重载本身抛错也不往外抛", () => {
    const lines: string[] = [];
    let fire: ((details: { reason?: string }) => void) | null = null;
    installWindowRecovery({
      onRenderProcessGone: (handler) => {
        fire = handler;
      },
      reload: () => {
        throw new Error("窗口已销毁");
      },
      log: (line) => lines.push(line),
      notify: () => undefined
    });

    expect(() => fire?.({ reason: "crashed" })).not.toThrow();
    expect(lines.join("\n")).toContain("自动重载失败");
  });
});

describe("loadFailureText", () => {
  it("说清目标与原因", () => {
    const text = loadFailureText("C:/app/index.html", new Error("ERR_FILE_NOT_FOUND"));

    expect(text).toContain("C:/app/index.html");
    expect(text).toContain("ERR_FILE_NOT_FOUND");
  });

  it("非 Error 的值也能写成一句人话", () => {
    expect(loadFailureText("x", "boom")).toContain("boom");
  });
});

import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "@mochen/contracts";
import { isOpenableWebSource, registerWebSourceIpc } from "./web-source-link.js";

function harness() {
  const opened: string[] = [];
  const fns = new Map<string, (...args: unknown[]) => unknown>();
  registerWebSourceIpc((channel, fn) => fns.set(channel, fn), {
    openExternal: async (url) => {
      opened.push(url);
    }
  });
  return { opened, fire: (url: unknown) => fns.get(IPC_CHANNELS.appOpenWebSource)?.({}, url) };
}

describe("搜索来源链接的白名单", () => {
  it("http 与 https 都放行", () => {
    expect(isOpenableWebSource("http://example.com/a")).toBe(true);
    expect(isOpenableWebSource("https://baike.so.com/doc/5586742.html")).toBe(true);
  });

  it("协议相对串与普通文本连 URL 都构不成，拒", () => {
    // 这两条在 360 的老页面上真的出现过（//example.com/x），照直递出去会拼到本地去。
    expect(isOpenableWebSource("//example.com/x")).toBe(false);
    expect(isOpenableWebSource("not a url")).toBe(false);
    expect(isOpenableWebSource("")).toBe(false);
  });

  it("非 http(s) 的协议一律拒（这是本闸存在的全部理由）", () => {
    for (const bad of [
      "file:///C:/Users/x/密钥.txt",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "smb://内网/share",
      "ms-msdt:/id",
      "mochen://evil"
    ])
      expect(isOpenableWebSource(bad), bad).toBe(false);
  });

  it("大小写混写的协议也照拒（FILE:// 与 file:// 是同一个东西）", () => {
    expect(isOpenableWebSource("FILE:///C:/x.txt")).toBe(false);
    expect(isOpenableWebSource("JavaScript:alert(1)")).toBe(false);
  });

  it("带 user:pass@ 的地址拒（钓鱼用的假域名会留在地址栏和历史里）", () => {
    expect(isOpenableWebSource("https://evil.com@real.com/x")).toBe(false);
    expect(isOpenableWebSource("https://user:pw@example.com/")).toBe(false);
  });
});

describe("来源点开那条 IPC", () => {
  it("只注册一条通道，位置就是 app:open-web-source", () => {
    const seen: string[] = [];
    registerWebSourceIpc((channel) => seen.push(channel), { openExternal: async () => {} });
    expect(seen).toEqual([IPC_CHANNELS.appOpenWebSource]);
    expect(IPC_CHANNELS.appOpenWebSource).toBe("app:open-web-source");
  });

  it("合法来源原样递给系统浏览器", async () => {
    const { opened, fire } = harness();
    await expect(fire("https://baike.so.com/doc/5586742.html")).resolves.toBe(true);
    expect(opened).toEqual(["https://baike.so.com/doc/5586742.html"]);
  });

  it("非 http(s) 的地址：拒绝，且浏览器一个都没被叫起来", async () => {
    const { opened, fire } = harness();
    await expect(fire("file:///C:/Windows/System32/cmd.exe")).rejects.toThrow(/http/);
    expect(opened).toEqual([]);
  });

  it("非字符串（渲染层递了 undefined/null/对象）也拒，不是 URL 的东西不许被 URL 兜底成「相对当前页」", async () => {
    const { opened, fire } = harness();
    for (const bad of [undefined, null, 42, { url: "https://a.com" }, ["https://a.com"]])
      await expect(fire(bad), String(bad)).rejects.toThrow();
    expect(opened).toEqual([]);
  });

  it("so.com/link 那种不透明跳转链原样放行（参数解不开也得能点开）", async () => {
    const { opened, fire } = harness();
    const raw = "https://www.so.com/link?m=uKrrMJcI%2Fd6HyYETyQkpQD1Ms3alCK4uNL0n056%2B%2Bx4whi";
    await expect(fire(raw)).resolves.toBe(true);
    expect(opened).toEqual([raw]);
  });
});

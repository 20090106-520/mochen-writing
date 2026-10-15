import { describe, expect, it } from "vitest";
import { judgeUpstreamUrl } from "./upstream-url.js";

/**
 * 上游地址白名单判据（台账第七十三节）。两处适配层（provider-fetch 抛错、webdav-client 取
 * boolean）各自那条用例只看得见「放行/拒绝」，看不见三态**内部**的分档——`not-a-url` 与
 * `not-allowed` 的区分只有在这里能钉。它们是两句不同的话的来源，压成 boolean 就会丢。
 */
describe("judgeUpstreamUrl", () => {
  it("https 一律 ok（不论本机还是远端）", () => {
    expect(judgeUpstreamUrl("https://nas.local/dav/")).toBe("ok");
    expect(judgeUpstreamUrl("https://api.deepseek.com/v1")).toBe("ok");
  });

  it("http 仅本机回环 ok（localhost / 127.0.0.1 / ::1 三种字面量）", () => {
    expect(judgeUpstreamUrl("http://127.0.0.1:11434/v1")).toBe("ok");
    expect(judgeUpstreamUrl("http://localhost:1234/v1")).toBe("ok");
    expect(judgeUpstreamUrl("http://[::1]:8080/v1")).toBe("ok");
  });

  it("http 非回环 ⇒ not-allowed（明文 http 会把密钥与全文裸送链路）", () => {
    expect(judgeUpstreamUrl("http://api.example.com/v1")).toBe("not-allowed");
    expect(judgeUpstreamUrl("http://192.168.1.5:1234/v1")).toBe("not-allowed");
  });

  it("解析不出的地址 ⇒ not-a-url（与上面那一档分开说）", () => {
    expect(judgeUpstreamUrl("不是地址")).toBe("not-a-url");
    expect(judgeUpstreamUrl("")).toBe("not-a-url");
  });

  it("其他协议 ⇒ not-allowed（file / ftp 都不在白名单里）", () => {
    expect(judgeUpstreamUrl("file:///tmp/dav")).toBe("not-allowed");
    expect(judgeUpstreamUrl("ftp://nas.local/dav")).toBe("not-allowed");
  });
});

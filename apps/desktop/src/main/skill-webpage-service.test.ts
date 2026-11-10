import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILL_FILE_NAME } from "@mochen/contracts";
import { createSkillWebpageService } from "./skill-webpage-service.js";

/**
 * 网页转技能的主进程用例（2026-11-10）。
 *
 * 【为什么注入 fetch 而不是打真网】与 skill-remote-service.test.ts 同一条理由：
 * 这一层要验的是**判定**——转出来的 frontmatter 对不对、来源行钉没钉、
 * 同名是不是真的不覆盖、抓不到时中文原因给不给。真网红绿不定，零信息量。
 * 假 fetch 直接回一个真 `Response`（webRead 读 content-type / arrayBuffer，
 * 真 Response 让这条链路从字节到正文都过得去，不用 mock 四个方法）。
 */

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-skill-webpage-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PAGE_HTML = [
  "<!doctype html><html><head><title>三幕结构的节奏表</title></head><body>",
  "<script>track('noise')</script>",
  "<h1>三幕结构的节奏表</h1>",
  "<p>第一幕在全书四分之一处收束，把主角推过门槛。</p>",
  "<p>第二幕中点要有一次假胜利或假失败。</p>",
  "</body></html>"
].join("\n");

function service(html: string, contentType = "text/html; charset=utf-8") {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    return new Response(html, {
      status: 200,
      headers: { "content-type": contentType }
    });
  };
  return {
    urls,
    service: createSkillWebpageService({
      dirOf: (source) => (source === "global" ? root : null),
      fetchImpl
    })
  };
}

describe("网页转技能", () => {
  it("转成功：SKILL.md 落盘，frontmatter 的名字取自页面标题，正文钉着来源链接", async () => {
    const { service: web } = service(PAGE_HTML);
    const result = await web.convert("https://example.com/structure");
    expect(result.ok).toBe(true);
    expect(result.displayName).toBe("三幕结构的节奏表");
    expect(result.dirName).toMatch(/^[a-z0-9._-]+$/);
    expect(result.truncated).toBe(false);
    const md = await readFile(path.join(root, result.dirName, SKILL_FILE_NAME), "utf8");
    expect(md).toContain("name: 三幕结构的节奏表");
    expect(md).toContain("第一幕在全书四分之一处收束");
    expect(md).not.toContain("track('noise')"); // 脚本杂讯被剥掉
    expect(md).toContain("本技能转写自网页：https://example.com/structure");
  });

  it("描述取正文开头（含标题行）：模型在技能库里扫一眼就知道这份是干什么的", async () => {
    const { service: web } = service(PAGE_HTML);
    const result = await web.convert("https://example.com/structure");
    expect(result.ok).toBe(true);
    const md = await readFile(path.join(root, result.dirName, SKILL_FILE_NAME), "utf8");
    expect(md).toContain("三幕结构的节奏表 第一幕在全书四分之一处收束");
  });

  it("同名目录已存在 ⇒ 拒且不覆盖：用户改过那份就是他的", async () => {
    const { service: web } = service(PAGE_HTML);
    const first = await web.convert("https://example.com/structure");
    expect(first.ok).toBe(true);
    const dir = path.join(root, first.dirName);
    await writeFile(path.join(dir, SKILL_FILE_NAME), "---\nname: 我改过的\n---\n\n正文\n", "utf8");
    const second = await web.convert("https://example.com/structure");
    expect(second.ok).toBe(false);
    expect(second.notice).toContain("没有覆盖");
    const md = await readFile(path.join(dir, SKILL_FILE_NAME), "utf8");
    expect(md).toContain("我改过的");
  });

  it("URL 不是 http(s) ⇒ 中文拒绝，且一个字节都不落盘", async () => {
    const { service: web } = service(PAGE_HTML);
    const result = await web.convert("file:///C:/Windows/notepad.exe");
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("可读的网页链接");
    expect(await readdirSafe(root)).toEqual([]);
  });

  it("页面返回 404 ⇒ 中文拒绝（原文的英文状态不透给用户当唯一解释）", async () => {
    const fetchImpl = async () =>
      new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
    const web = createSkillWebpageService({
      dirOf: (source) => (source === "global" ? root : null),
      fetchImpl
    });
    const result = await web.convert("https://example.com/gone");
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("404");
  });

  it("全局技能目录没配好 ⇒ 拒，不猜落盘位置", async () => {
    const web = createSkillWebpageService({
      dirOf: () => null,
      fetchImpl: async () =>
        new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } })
    });
    const result = await web.convert("https://example.com/structure");
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("技能目录还没配好");
  });

  it("抓回来的是纯文本页也认：content-type 三类白名单与 web_read 同源", async () => {
    const { service: web } = service("第一段。\n\n第二段。", "text/plain; charset=utf-8");
    const result = await web.convert("https://example.com/plain.txt");
    expect(result.ok).toBe(true);
    expect(result.displayName).toBe("https://example.com/plain.txt"); // 无 <title>，回 URL
  });
});

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

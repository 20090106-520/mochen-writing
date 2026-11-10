import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSkillRemoteService,
  type FetchLike,
  type FetchResponseLike
} from "./skill-remote-service.js";

/**
 * 在线技能源的主进程用例（2026-11-10）。
 *
 * 【为什么注入 fetch 而不是打真网】
 * 这一层要验的是**判定**：列出来的是哪些、取不到时回退到哪儿、同名时是不是真的不覆盖。
 * 打真网会让用例随 GitHub 的限流与网络抖动红绿不定，那是最没有信息量的红。
 * 注入一个按 url 分派的假 fetch，三种失败路径（接口错、raw 不可达、镜像可达）都能精确构造。
 */

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-skill-remote-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function reply(body: string, status = 200): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/** 一份带 frontmatter 的上游正文。 */
const UPSTREAM_MD = [
  "---",
  "name: 文档共创",
  "description: 和你一起把文档写出来",
  "stage: 正文",
  "---",
  "",
  "先问清楚要写给谁看。",
  ""
].join("\n");

function service(handler: (url: string) => Promise<FetchResponseLike>) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    calls.push(url);
    return handler(url);
  };
  return {
    calls,
    service: createSkillRemoteService({
      dirOf: (source) => (source === "global" ? root : null),
      fetchImpl
    })
  };
}

describe("list：从仓库树里找出带 SKILL.md 的那些目录", () => {
  it("只有含 SKILL.md 的目录进列表，并带上可直接点开的地址", async () => {
    const { service: remote } = service(async (url) => {
      if (url.includes("/git/trees/")) {
        return reply(
          JSON.stringify({
            tree: [
              { path: "skills/docx/SKILL.md" },
              { path: "skills/docx/scripts/a.py" },
              { path: "skills/pdf/SKILL.md" },
              { path: "README.md" }
            ]
          })
        );
      }
      return reply("{}", 404);
    });
    const result = await remote.list("https://github.com/o/r/tree/main/skills");
    expect(result.listed).toBe(true);
    expect(result.entries.map((one) => one.label)).toEqual(["docx", "pdf"]);
    expect(result.entries[0]!.url).toBe("https://github.com/o/r/tree/main/skills/docx");
    expect(result.entries.every((one) => one.installed === false)).toBe(true);
  });

  it("地址里没写分支时先问仓库默认分支——否则列得出来、点开却取不到正文", async () => {
    const { calls, service: remote } = service(async (url) => {
      if (url === "https://api.github.com/repos/o/r") return reply('{"default_branch":"trunk"}');
      if (url.includes("/git/trees/trunk?")) return reply('{"tree":[{"path":"x/SKILL.md"}]}');
      return reply("{}", 404);
    });
    const result = await remote.list("https://github.com/o/r");
    expect(result.listed).toBe(true);
    expect(result.entries[0]!.url).toContain("/tree/trunk/x");
    expect(calls.some((one) => one.endsWith("/repos/o/r"))).toBe(true);
  });

  it("一条都没有时说清是「这里没有 SKILL.md」，而不是空表了事", async () => {
    const { service: remote } = service(async () => reply('{"tree":[]}'));
    const result = await remote.list("https://github.com/o/r/tree/main/x");
    expect(result.listed).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.notice).toContain("SKILL.md");
  });

  it("网络/接口错时 listed=false，并把理由交回去", async () => {
    const { service: remote } = service(async () =>
      reply('{"message":"API rate limit exceeded"}', 403)
    );
    const result = await remote.list("https://github.com/o/r");
    expect(result.listed).toBe(false);
    expect(result.notice).toContain("403");
  });

  it("非 https 地址在解析这一步就拒，不发任何请求", async () => {
    const { calls, service: remote } = service(async () => reply("{}"));
    const result = await remote.list("file:///C:/secrets");
    expect(result.listed).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("preview：正文按需取，缺 frontmatter 就补一层", () => {
  it("contents 接口给 base64 时直接用，解析出名字与说明", async () => {
    const { service: remote } = service(async (url) => {
      if (url.includes("/contents/")) {
        return reply(
          JSON.stringify({
            name: "SKILL.md",
            encoding: "base64",
            content: Buffer.from(UPSTREAM_MD, "utf8").toString("base64")
          })
        );
      }
      return reply("{}", 404);
    });
    const preview = await remote.preview("https://github.com/o/r/tree/main/skills/docx");
    expect(preview.ok).toBe(true);
    expect(preview.displayName).toBe("文档共创");
    expect(preview.description).toBe("和你一起把文档写出来");
    expect(preview.stages).toEqual(["正文"]);
    expect(preview.synthesized).toBe(false);
    expect(preview.skillMd).toContain("先问清楚要写给谁看。");
  });

  it("contents 挂了就回退 raw，再挂就回退镜像——并把实际取到的地址报出来", async () => {
    const { service: remote } = service(async (url) => {
      if (url.includes("api.github.com")) return reply('{"message":"boom"}', 500);
      if (url.startsWith("https://raw.githubusercontent.com")) throw new Error("ENOTFOUND");
      if (url.startsWith("https://ghproxy.net/")) {
        return reply(`---\nname: 镜像来的\ndescription: 从镜像取到\n---\n\n正文\n`);
      }
      return reply("{}", 404);
    });
    const preview = await remote.preview("https://github.com/o/r/blob/main/skills/x/SKILL.md");
    expect(preview.ok).toBe(true);
    expect(preview.displayName).toBe("镜像来的");
    expect(preview.fetchedFrom.startsWith("https://ghproxy.net/")).toBe(true);
  });

  it("三条路都不通时给一句能照做的中文，不返回半截预览", async () => {
    const { service: remote } = service(async () => {
      throw new Error("ECONNREFUSED");
    });
    const preview = await remote.preview("https://github.com/o/r/tree/main/skills/x");
    expect(preview.ok).toBe(false);
    expect(preview.notice).toContain("ECONNREFUSED");
    expect(preview.skillMd).toBe("");
  });

  it("上游没有 frontmatter 时补一层，并如实说补过", async () => {
    const { service: remote } = service(async () => reply("这是一段没有围栏的说明。\n"));
    const preview = await remote.preview(
      "https://raw.githubusercontent.com/o/r/main/skills/my-skill/SKILL.md"
    );
    expect(preview.ok).toBe(true);
    expect(preview.synthesized).toBe(true);
    expect(preview.skillMd.startsWith("---\nname: my-skill")).toBe(true);
    expect(preview.notice).toContain("frontmatter");
  });
});

describe("install：只写全局目录，同名绝不覆盖", () => {
  async function previewOk() {
    return service(async (url) => {
      if (url.includes("/contents/")) {
        return reply(
          JSON.stringify({
            encoding: "base64",
            content: Buffer.from(UPSTREAM_MD, "utf8").toString("base64")
          })
        );
      }
      return reply("{}", 404);
    });
  }

  it("装出来的文件与预览里那份逐字一致", async () => {
    const { service: remote } = await previewOk();
    const url = "https://github.com/o/r/tree/main/skills/docx";
    const preview = await remote.preview(url);
    const result = await remote.install(url);
    expect(result.ok).toBe(true);
    const written = await readFile(path.join(root, preview.dirName, "SKILL.md"), "utf8");
    expect(written).toBe(preview.skillMd);
  });

  it("已经装过就拒，且盘上那份一个字节都不动", async () => {
    const { service: remote } = await previewOk();
    const url = "https://github.com/o/r/tree/main/skills/docx";
    const preview = await remote.preview(url);
    const dir = path.join(root, preview.dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "我自己改过的那份", "utf8");

    const result = await remote.install(url);
    expect(result.ok).toBe(false);
    expect(result.notice).toContain("已经装过");
    expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toBe("我自己改过的那份");
  });

  it("全局目录没配好时不写盘，也不装作成功", async () => {
    const remote = createSkillRemoteService({
      dirOf: () => null,
      fetchImpl: async () => reply("{}", 404)
    });
    const result = await remote.install("https://github.com/o/r/tree/main/skills/x");
    expect(result.ok).toBe(false);
  });
});

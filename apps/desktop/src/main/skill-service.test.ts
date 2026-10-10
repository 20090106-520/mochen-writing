import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  SKILL_FILE_NAME,
  skillIdOf,
  splitSkillId,
  type SkillSource
} from "@mochen/contracts";
import { createSkillService, registerSkillIpc } from "./skill-service.js";
// 来源闸（P1-7）：夹具只造事件形状，判据仍只在 ipc-guard 一份。
import { trustedRendererEvent } from "./ipc-trust-fixture.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-skill-svc-"));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/**
 * 铺一份技能。`globalDir` 本身就是 skills 根（装配处传进来的就是 `<appData>/…/skills`），
 * 书内那份则落在 `<书>/.mochen/skills` —— 两处的层级差一层，这里写清楚免得铺错地方。
 */
async function plant(
  globalRoot: string,
  dirName: string,
  body: string,
  kind: "global" | "book"
): Promise<void> {
  const base = kind === "global" ? globalRoot : path.join(globalRoot, ".mochen", "skills");
  const dir = path.join(base, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, SKILL_FILE_NAME),
    `---\nname: ${dirName}\ndescription: ${dirName}的说明\n---\n\n${body}\n`,
    "utf8"
  );
}

let globalDir = "";
let bookRoot: string | null = null;

function service() {
  return createSkillService({ globalSkillsDir: globalDir, bookRoot: () => bookRoot });
}

beforeEach(async () => {
  globalDir = await tmp();
  bookRoot = null;
});

describe("createSkillService · list", () => {
  it("两个来源合并：全局与书内各自的技能都在，按目录名排序", async () => {
    bookRoot = await tmp();
    await plant(globalDir, "伏笔", "全局那份", "global");
    await plant(bookRoot, "节奏", "书内那份", "book");
    const refs = await service().list();
    expect(refs.map((r) => `${r.source}:${r.dirName}`).sort()).toEqual([
      "book:节奏",
      "global:伏笔"
    ]);
    // 合并后确实按目录名排过一遍（不是把全局那份直接摊在前面）
    expect(refs.map((r) => r.dirName)).toEqual(["伏笔", "节奏"]);
  });

  it("同名时书内优先（用户在自己书里写的那份更贴这本书）", async () => {
    bookRoot = await tmp();
    await plant(globalDir, "伏笔", "全局那份", "global");
    await plant(bookRoot, "伏笔", "书内那份", "book");
    const refs = await service().list();
    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toBe("book");
  });

  it("没开书 ⇒ 只回全局那一份（书内来源要书目录才谈得上），不报错", async () => {
    await plant(globalDir, "伏笔", "全局那份", "global");
    const refs = await service().list();
    expect(refs.map((r) => r.source)).toEqual(["global"]);
  });

  it("两个来源都没有 ⇒ 空表：技能库空着是常态不是故障", async () => {
    await expect(service().list()).resolves.toEqual([]);
  });
});

describe("createSkillService · read", () => {
  it("按来源各自读：同一个目录名在两个来源里是两份不同的正文", async () => {
    bookRoot = await tmp();
    await plant(globalDir, "伏笔", "全局那份", "global");
    await plant(bookRoot, "伏笔", "书内那份", "book");
    const skills = service();
    expect((await skills.read("global", `伏笔/${SKILL_FILE_NAME}`)).content).toContain("全局那份");
    expect((await skills.read("book", `伏笔/${SKILL_FILE_NAME}`)).content).toContain("书内那份");
  });

  it("形状不对 ⇒ 中文拒绝，不把 fs 的 ENOENT 抛给渲染层", async () => {
    await plant(globalDir, "伏笔", "全局那份", "global");
    await expect(service().read("global", "伏笔/../伏笔/SKILL.md")).rejects.toThrow(/技能路径/);
  });

  it("没开书时读书内技能 ⇒ 一句中文，而不是读到 undefined", async () => {
    await expect(service().read("book", `伏笔/${SKILL_FILE_NAME}`)).rejects.toThrow(
      "还没打开作品目录，读不到书内技能。"
    );
  });
});

describe("createSkillService · dirOf", () => {
  it("全局根恒是注入的那一个；书内根是 `<书>/.mochen/skills`（跟着书走）", async () => {
    bookRoot = "/book";
    const skills = service();
    expect(skills.dirOf("global")).toBe(globalDir);
    expect(skills.dirOf("book")).toBe(path.join("/book", ".mochen", "skills"));
  });

  it("没开书时书内根为 null（调用方据此拒绝，而不是拼一个假路径）", () => {
    expect(service().dirOf("book")).toBeNull();
  });
});

describe("registerSkillIpc", () => {
  it("只注册列与读两条，且技能库没有写通道（白名单外一条都不许多）", () => {
    const registered: string[] = [];
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerSkillIpc((channel, fn) => {
      registered.push(channel);
      handlers.set(channel, fn);
    }, service());
    expect(registered.sort()).toEqual([IPC_CHANNELS.skillsList, IPC_CHANNELS.skillsRead].sort());
    expect(
      [...handlers.keys()].some(
        (channel) => /skills:/.test(channel) && !/^(skills:list|skills:read)$/.test(channel)
      )
    ).toBe(false);
  });

  it("读通道把 source 与 relPath 原样递给 service（参数顺序错了就读不到书内那一份）", async () => {
    bookRoot = await tmp();
    await plant(bookRoot, "节奏", "书内那份", "book");
    const seen: [unknown, unknown][] = [];
    handlers.clear();
    registerSkillIpc((_channel, fn) => handlers.set("skills:read", fn), {
      list: async () => [],
      dirOf: () => null,
      read: async (source, relPath) => {
        seen.push([source, relPath]);
        return { relPath, content: "", truncated: false };
      }
    });
    await handlers.get("skills:read")?.(trustedRendererEvent(), "book", `节奏/${SKILL_FILE_NAME}`);
    expect(seen).toEqual([["book", `节奏/${SKILL_FILE_NAME}`]]);
  });
});

describe("SkillSource 的穷尽性", () => {
  it("两个来源拼出来的 id 一定能拆回去（渲染层递、主进程拆，这一对不许错位）", () => {
    for (const source of ["global", "book"] as SkillSource[]) {
      const id = skillIdOf(source, "伏笔");
      expect(splitSkillId(id)).toEqual({ source, dirName: "伏笔" });
    }
  });

  it("拆不出的 id 一律 null：绝不猜一个来源去读盘（`web:伏笔` / `伏笔` / 越界目录名）", () => {
    for (const bad of ["伏笔", ":伏笔", "web:伏笔", "global:", "book:a/b", "book:..", "book:."]) {
      expect(splitSkillId(bad)).toBeNull();
    }
  });
});

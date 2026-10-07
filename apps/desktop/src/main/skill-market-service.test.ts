import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IPC_CHANNELS, SKILL_FILE_NAME, type MarketSkill } from "@mochen/contracts";
import { createSkillMarketService, registerSkillMarketIpc } from "./skill-market-service.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-market-"));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** 测试用清单。真实清单在 skill-catalog.ts，它自己另有一条守卫（每一条的出处/许可都不许空）。 */
const CATALOG: MarketSkill[] = [
  {
    dirName: "chapter-intent",
    displayName: "落笔前先问清楚",
    summary: "动笔前把这一章要发生什么问清楚。",
    category: "构思",
    origin: "改编自 linhut/dsh-skills 的 brainstorming（MIT）",
    license: "MIT",
    skillMd: "---\nname: 落笔前先问清楚\ndescription: 动笔前问清楚\n---\n\n正文甲\n"
  },
  {
    dirName: "world-rulebook",
    displayName: "把设定写成能照做的规则",
    summary: "写一份能照着做的规则。",
    category: "结构",
    origin: "改编自 linhut/dsh-skills 的 writing-skills（MIT）",
    license: "MIT",
    skillMd: "---\nname: 把设定写成能照做的规则\ndescription: 写规则\n---\n\n正文乙\n"
  }
];

let globalDir = "";
let bookRoot: string | null = null;

function service(over: Partial<Parameters<typeof createSkillMarketService>[0]> = {}) {
  return createSkillMarketService({
    catalog: CATALOG,
    dirOf: (source) =>
      source === "global" ? globalDir : bookRoot === null ? null : bookDir(bookRoot),
    ...over
  });
}

function bookDir(root: string): string {
  return path.join(root, ".mochen", "skills");
}

/** 在全局 skills 根下铺一份技能（模拟「用户自己放的」或上一轮装出来的）。 */
async function plantGlobal(dirName: string, body: string): Promise<string> {
  const dir = path.join(globalDir, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, SKILL_FILE_NAME), body, "utf8");
  return dir;
}

/** 读盘上那份装出来的技能，逐字比。 */
async function readPlanted(dirName: string): Promise<string> {
  return readFile(path.join(globalDir, dirName, SKILL_FILE_NAME), "utf8");
}

beforeEach(async () => {
  globalDir = await tmp();
  bookRoot = null;
});

describe("createSkillMarketService · install", () => {
  it("装完盘上多一个目录，SKILL.md 与清单**逐字**相同", async () => {
    const line = await service().install("chapter-intent");
    expect(line).toContain("装好了");
    expect(await readPlanted("chapter-intent")).toBe(CATALOG[0]!.skillMd);
  });

  it("装出来的技能与技能库那张表**同形**：列得到、读得出、显示名就是清单上那个", async () => {
    // 这一条是整个市场的立身之本：如果装完 scanSkills 读不出来，
    // 用户看到的会是「装好了」但技能库里根本没有它。
    await service().install("world-rulebook");
    const listed = await service().list();
    expect(listed.entries.map((e) => [e.dirName, e.installed])).toEqual([
      ["chapter-intent", false],
      ["world-rulebook", true]
    ]);
    const onDisk = await readPlanted("world-rulebook");
    expect(onDisk).toContain("name: 把设定写成能照做的规则");
    expect(onDisk).toContain("description: 写规则");
  });

  it("已装则拒绝覆盖：用户改过的那一份一个字都不许动", async () => {
    await plantGlobal("chapter-intent", "用户自己改过的正文\n");
    const line = await service().install("chapter-intent");
    expect(line).toContain("已经装在全局技能目录里了");
    expect(line).toContain("先卸掉再装");
    expect(await readPlanted("chapter-intent")).toBe("用户自己改过的正文\n");
  });

  it("目录存在但读不到 SKILL.md 时不算已装——否则会把坏目录挡在门外", async () => {
    // scanSkills 只要 SKILL.md 读不回来就不收（fs-store 的既有判定）。
    // 市场必须跟着同一口径，否则会出现「装不上也卸不掉」的僵尸目录。
    await mkdir(path.join(globalDir, "chapter-intent"), { recursive: true });
    const line = await service().install("chapter-intent");
    expect(line).toContain("装好了");
    expect(await readPlanted("chapter-intent")).toBe(CATALOG[0]!.skillMd);
  });

  it("清单里没有的 id 一律不装，也不在盘上留下任何东西", async () => {
    const line = await service().install("../escaped");
    expect(line).toContain("市场里没有这一条");
    await expect(readFile(path.join(globalDir, "escaped"))).rejects.toThrow();
  });

  it("书目录是用户的作品：装只写全局，**一个字节都不碰书目录**", async () => {
    bookRoot = await tmp();
    const line = await service().install("chapter-intent");
    expect(line).toContain("装好了");
    // 书内 skills 目录压根没被创建——这条是硬边界，不是「创建了但是空的」
    await expect(readFile(bookDir(bookRoot))).rejects.toThrow();
    expect(await readPlanted("chapter-intent")).toBe(CATALOG[0]!.skillMd);
  });

  it("装完那句要说清「装好 ≠ 这一轮生效」，而且不许把用户往别处赶（2026-10-07 真机撞出来的）", async () => {
    // 真机症状：装完那句写的是「去技能库里把它加入这一轮的上下文」——
    // 可 5-㉛ 起插件与技能是同一个整页，这张卡就摆在这一页上，
    // 「去技能库」是把用户往他已经在的地方赶。而「装好 ≠ 本轮生效」这条信息才是他真缺的。
    const line = await service().install("chapter-intent");
    expect(line).toContain("点「挂入」");
    expect(line).not.toContain("去技能库");
  });

  it("书里已有同名那份：装是成功，但要明说它会被盖掉", async () => {
    bookRoot = await tmp();
    await mkdir(path.join(bookDir(bookRoot), "chapter-intent"), { recursive: true });
    await writeFile(
      path.join(bookDir(bookRoot), "chapter-intent", SKILL_FILE_NAME),
      "---\nname: 书内那份\ndescription: 用户自己写的\n---\n",
      "utf8"
    );
    const line = await service().install("chapter-intent");
    expect(line).toContain("书内那份优先");
    const listed = await service().list();
    expect(listed.entries.find((e) => e.dirName === "chapter-intent")?.shadowedByBook).toBe(true);
    // 书内那份一个字都没被改
    expect(
      await readFile(path.join(bookDir(bookRoot), "chapter-intent", SKILL_FILE_NAME), "utf8")
    ).toContain("用户自己写的");
  });

  it("全局技能目录没配好时拒装，并说清是哪边的问题（不静默写到别处）", async () => {
    const line = await service({
      dirOf: (source) => (source === "global" ? null : globalDir)
    }).install("chapter-intent");
    expect(line).toContain("装不上");
    expect(line).toContain("全局技能目录没配好");
  });
});

describe("createSkillMarketService · uninstall", () => {
  it("卸掉之后**那个目录**真的没了，且技能库那张表也同步成未装", async () => {
    await service().install("chapter-intent");
    const line = await service().uninstall("chapter-intent");
    expect(line).toContain("卸掉了");
    // 用 stat 而不是 readFile 判断「目录没了」：空目录上 readFile 也一样抛（EISDIR），
    // 于是「只删了 SKILL.md、留下空壳目录」这种变异照样全绿（变异 #12 实测）。
    // 用户看到的是「卸掉了」，盘上就真的不该还留着那个壳。
    await expect(stat(path.join(globalDir, "chapter-intent"))).rejects.toThrow();
    const listed = await service().list();
    expect(listed.entries.find((e) => e.dirName === "chapter-intent")?.installed).toBe(false);
  });

  it("清单里没有的 id 一律不删——全局目录是用户的，没权力凭名字像就动手", async () => {
    await plantGlobal("用户自己的技能", "正文\n");
    const line = await service().uninstall("用户自己的技能");
    expect(line).toContain("市场里没有这一条，不删");
    expect(await readPlanted("用户自己的技能")).toBe("正文\n");
  });

  it("本来就没装时说不装，不假装卸掉了", async () => {
    const line = await service().uninstall("chapter-intent");
    expect(line).toContain("本来就没装");
  });

  it("装 → 卸 → 再装：两步各自可逆，重装这条路是通的", async () => {
    await service().install("chapter-intent");
    await service().uninstall("chapter-intent");
    expect(await service().install("chapter-intent")).toContain("装好了");
    expect(await readPlanted("chapter-intent")).toBe(CATALOG[0]!.skillMd);
  });
});

describe("createSkillMarketService · list", () => {
  it("分类按声明序（构思在结构前），不是字母序也不是盘上顺序", async () => {
    const entries = (await service().list()).entries;
    expect(entries.map((e) => e.dirName)).toEqual(["chapter-intent", "world-rulebook"]);
  });

  it("没开书时也能列：书内那份自然为空，不报错", async () => {
    expect((await service().list()).listed).toBe(true);
  });

  it("已装与被书内盖住是两件事，分开标——界面不许把两者的后果混成一句", async () => {
    bookRoot = await tmp();
    await plantGlobal("chapter-intent", "全局那份\n");
    await mkdir(path.join(bookDir(bookRoot), "world-rulebook"), { recursive: true });
    await writeFile(
      path.join(bookDir(bookRoot), "world-rulebook", SKILL_FILE_NAME),
      "---\nname: 书内\ndescription: 书内那份\n---\n",
      "utf8"
    );
    const entries = (await service().list()).entries;
    const installedOnly = entries.find((e) => e.dirName === "chapter-intent");
    const shadowed = entries.find((e) => e.dirName === "world-rulebook");
    expect(installedOnly).toMatchObject({ installed: true, shadowedByBook: false });
    // 书内那份**不算市场装出来的**：installed 必须还是 false，
    // 否则用户会看到一个自己从没装过的技能标着「已装」。
    expect(shadowed).toMatchObject({ installed: false, shadowedByBook: true });
  });
});

/**
 * 写通路的边界，钉在源码形状上（渲染层的读取器够不到 `src/main`，所以这些守卫住在这儿）。
 *
 * 上面那批行为用例证明「运行时确实只写全局」，这一批证明「**代码里没有第二条写路径**」——
 * 行为用例覆盖不到「有人后来加了一处 writeFile 到别处」。
 */
describe("skill-market-service · 写通路的源码边界", () => {
  /** 剥掉注释再读：注释里那句「绝不碰书目录」会让否定断言直接反咬（批次 5-⑳ 实测过）。 */
  const SRC = readFileSync(new URL("./skill-market-service.ts", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );

  it("**不自己拼**书内技能目录：那份路径实现住在只读那套，市场借它的 dirOf", () => {
    // 出现 `.mochen` 就是又写了一份「书内技能在哪」——两处总会有一处忘掉跟改。
    expect(SRC, "市场里又拼了一次书内技能目录").not.toContain(".mochen");
    expect(SRC).toContain("dirOf(source: SkillSource)");
  });

  it("已装判定借 scanSkills：目录存在不算已装，得读得到 SKILL.md 才算", () => {
    expect(SRC).toContain('scanSkills(mustDirOf("global"), "global")');
  });

  it("写盘只有一处 writeFile、一处 rm，且都落在算出来的那一个目录上", () => {
    expect(SRC.match(/\bwriteFile\(/g)).toHaveLength(1);
    expect(SRC.match(/\brm\(/g)).toHaveLength(1);
    expect(SRC).toContain("path.join(dir, SKILL_FILE_NAME)");
  });

  it("装卸两条路径都经过 targetDirOf 守卫（目录名不合法 ⇒ 拒，不写盘）", () => {
    // 逐处切开看它后面紧跟着什么，而不是拿一个跨行正则去数——
    // prettier 会把过长的 return 折行，`/if \(dir === null\) return/` 这种针串数出来是 null，
    // 而 `expect(null).toHaveLength(2)` 报的是「Target cannot be null」这种看不懂的错。
    const sites = [...SRC.matchAll(/targetDirOf\(skill\)/g)];
    expect(sites, "装与卸各该有一处 targetDirOf").toHaveLength(2);
    for (const site of sites) {
      const after = SRC.slice(site.index, (site.index ?? 0) + 200);
      expect(after, "targetDirOf 之后没有立刻判 null").toContain("dir === null");
      expect(after, "判了 null 却没有 return（等于没拒）").toMatch(
        /dir === null\)[\s\S]{0,120}?return/
      );
    }
  });
});

describe("装配处", () => {
  it("市场借只读那套的 dirOf，不重拼 `<appData>/skills`", () => {
    const SRC = readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    expect(SRC).toContain("dirOf: (source) => skillService.dirOf(source)");
    const block =
      /const skillMarket = createSkillMarketService\(\{[\s\S]*?\n {2}\}\);/.exec(SRC)?.[0] ?? "";
    expect(block, "没找到 skillMarket 的装配块").not.toBe("");
    expect(block).not.toContain("path.join(activeDir");
  });

  /**
   * 占用条与提示词块上那一条的标题（2026-10-07 真机撞出来的）。
   *
   * 【症状】市场装来的技能在技能库里显示「落笔前先问清楚」，
   * 挂进这一轮后占用条那一行却写着 `chapter-intent` —— 同一份技能两个名字。
   * 【成因】readSkillForTurn 把 title 取成目录名，而目录名是给机器认的。
   * 【为什么钉在这里】读的是 main/index.ts 源码；渲染层那份接线守卫够不到 src/main
   * （路径解不到，硬读只会得到 ENOENT——那种红是测试自己坏了）。
   */
  it("挂入那条的标题取 frontmatter 的 name，不是目录名（两处显示同一个名字）", () => {
    const SRC = readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    const block = /const readSkillForTurn = async[\s\S]*?\n {2}\};/u.exec(SRC)?.[0] ?? "";
    expect(block, "没找到 readSkillForTurn").not.toBe("");
    expect(block).toContain("parseFrontmatter(content.content).data.name");
    // 兜底仍要是目录名：frontmatter 没写 name 时，宁可显示机器名也不要空着。
    expect(block).toContain('named === "" ? parsed.dirName : named');
    // 只认字符串：frontmatter 的值类型是 string | string[]，
    // 写成列表的 name 不该流进标题变成「a,b」。
    expect(block).toContain('typeof raw === "string" ? raw.trim() : ""');
    // 递出去的正文仍是整份文件（剥 frontmatter 是装配层的事，不在这里做第二遍）。
    expect(block).toContain("text: content.content");
  });
});

describe("registerSkillMarketIpc", () => {
  it("只注册三条通道，且装/卸只把 dirName 递进去", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerSkillMarketIpc((channel, fn) => handlers.set(channel, fn), service());
    expect([...handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.marketInstall,
      IPC_CHANNELS.marketList,
      IPC_CHANNELS.marketUninstall
    ]);
    expect(await handlers.get(IPC_CHANNELS.marketInstall)?.({}, "chapter-intent")).toContain(
      "装好了"
    );
    expect(await handlers.get(IPC_CHANNELS.marketUninstall)?.({}, "chapter-intent")).toContain(
      "卸掉了"
    );
    expect(await handlers.get(IPC_CHANNELS.marketList)?.({})).toMatchObject({ listed: true });
  });
});

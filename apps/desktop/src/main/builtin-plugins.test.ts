/**
 * 内置写作插件守卫（2026-10-07 批次 5-㉙）。
 *
 * 【这一组要证明的不是「插件能装上」——那件事 5-㉘ 已经验过了】
 * 要证的是两件更新的事：
 * ① 内置插件**真的走那条同一条路**（落盘 → import 改写 → 内核挂载），
 *    而不是有一条只在内存里 mount 的旁路。旁路是不受守卫覆盖的：用户插件走改写、
 *    内置插件不走，于是「兼容层对不对」只由用户的插件承担。
 * ② 插件给的**结论真的来自书里的字**。量一本空书也能量出一串漂亮的数字，
 *    所以每条断言都用书里的**具体字数与具体句子**去对，而不是只看回执是不是 ok。
 *
 * 不 mock 任何东西：插件跑的是真源码、真 import 改写、真内核。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { createPluginService } from "./plugin-service.js";
import { BUILTIN_PLUGINS, seedBuiltinPlugins, VERSION_STAMP } from "./builtin-plugins.js";

let pluginsDir = "";
let bookRoot = "";

beforeEach(() => {
  pluginsDir = mkdtempSync(join(tmpdir(), "mochen-builtin-plugins-"));
  bookRoot = mkdtempSync(join(tmpdir(), "mochen-builtin-books-"));
});

afterEach(() => {
  rmSync(pluginsDir, { recursive: true, force: true });
  rmSync(bookRoot, { recursive: true, force: true });
});

/**
 * 造一本可读的书。
 *
 * 【这一条断言是被一个真泄漏逼出来的】
 * 夹具原本写在 describe 顶上，而 describe 的函数体在**收集阶段**就跑完了——
 * 那时 beforeEach 还没执行，`bookRoot` 是空串，`join("", "潮生")` 于是变成相对路径，
 * 夹具直接落在**仓库根目录**。全量门禁里 prettier 扫到 `潮生/chapters/*.md` 才暴露。
 *
 * ⇒ 这里直接断言「书必须住在临时目录里」。夹具写歪一次就当场红，
 *   不用等下一次全量门禁才发现。
 */
/**
 * 文件名 → 标题的口径，**照抄 fs-store/scan.ts 的 `docMetaOf`**。
 *
 * 上一版这里写的是 `relPath.replace(/\.md$/, "")`，于是 `characters/阿禾.md` 的
 * title 变成了「characters/阿禾」。那对 rhythm / outline 无害（它们只用 relPath），
 * 却是**一个真机上不存在的书**：真书的 title 是 frontmatter 的 title，
 * 没有就取文件名（去掉开头的序号与分隔符），再不行才退回整条 relPath。
 * 5-㊱ 的 roster 按 title 去正文里数名字，于是夹具立刻把插件的名单数成了空表——
 * **红的是夹具，不是插件**。夹具要像真书，否则它测的是另一个世界。
 */
function titleOf(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return (base.match(/^\d*[-_]?(.*)$/)?.[1] ?? "").trim() || relPath;
}

function writeBook(name: string, files: Record<string, string>) {
  const root = join(bookRoot, name);
  if (!root.startsWith(tmpdir())) {
    throw new Error(
      `书必须建在临时目录里，实际是 ${root}（bookRoot 为空 = 夹具求值早于 beforeEach）`
    );
  }
  for (const [rel, body] of Object.entries(files)) {
    const target = join(root, ...rel.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body, "utf8");
  }
  return {
    root,
    title: name,
    // 【显式标类型，而不是让它推断】不标的话 kind 被推成 string，
    // 而 DocRef.kind 是**闭集联合**——vitest 不做类型检查，只有全量门禁的 tsc 会红，
    // 报出来还是一串看不懂的「不可赋给 BookKind」。一次就暴露在 tsc 里，省得后面再撞。
    docs: Object.keys(files).map((relPath): DocRef => ({
      relPath,
      title: titleOf(relPath),
      kind: "chapter"
    }))
  };
}

describe("内置插件种到盘上", () => {
  it("第一次启动把内置插件都种下去", () => {
    expect(seedBuiltinPlugins(pluginsDir).sort()).toEqual(["outline", "rhythm", "roster"]);
    for (const plugin of BUILTIN_PLUGINS) {
      expect(readFileSync(join(pluginsDir, plugin.dir, "client.js"), "utf8")).toBe(plugin.source);
    }
  });

  it("已经在盘上且没改过 ⇒ 版本落后时**升级**它（否则修复永远发不到已有安装）", () => {
    seedBuiltinPlugins(pluginsDir);
    // 把盘上那份写成旧版内容 + 旧版本号：模拟「v1 种下、后来内置修好了」。
    // 【这一条是为了修一个真机暴露的问题】v1 的规矩是「目录已在就不碰」，
    // 于是 outline 修好「开头第一句取到 Markdown 标题」之后，磁盘上仍是旧的。
    const dir = join(pluginsDir, "outline");
    writeFileSync(join(dir, "client.js"), "// 旧版，故意与内置不同但没被用户改过\n", "utf8");
    writeFileSync(join(dir, VERSION_STAMP), JSON.stringify({ version: 1 }), "utf8");
    // 但此时内容与内置**不同**，会被当成用户改过。要测「没改过就升级」，
    // 得让它与内置源码逐字相同、只有版本号落后——这正是「我们改过、用户没碰」的样子。
    writeFileSync(
      join(dir, "client.js"),
      BUILTIN_PLUGINS.find((p) => p.dir === "outline")?.source ?? "",
      "utf8"
    );
    writeFileSync(join(dir, VERSION_STAMP), JSON.stringify({ version: 1 }), "utf8");

    expect(seedBuiltinPlugins(pluginsDir)).toContain("outline");
    expect(readFileSync(join(dir, VERSION_STAMP), "utf8")).toBe(JSON.stringify({ version: 2 }));
  });

  it("用户改过 ⇒ 任何时候都不覆盖，只升版本号并说一句", () => {
    seedBuiltinPlugins(pluginsDir);
    const dir = join(pluginsDir, "rhythm");
    const edited = "// 我自己改过的节奏口径\n";
    writeFileSync(join(dir, "client.js"), edited, "utf8");
    writeFileSync(join(dir, VERSION_STAMP), JSON.stringify({ version: 1 }), "utf8");

    expect(seedBuiltinPlugins(pluginsDir)).not.toContain("rhythm");
    expect(readFileSync(join(dir, "client.js"), "utf8")).toBe(edited);
    // 版本号提上去了：否则下一个版本还会把它当成「没跟上」反复检查。
    expect(readFileSync(join(dir, VERSION_STAMP), "utf8")).toBe(JSON.stringify({ version: 2 }));
  });

  it("版本号已是最新 ⇒ 一个字都不动", () => {
    seedBuiltinPlugins(pluginsDir);
    const before = readFileSync(join(pluginsDir, "outline", "client.js"), "utf8");
    expect(seedBuiltinPlugins(pluginsDir)).toEqual([]);
    expect(readFileSync(join(pluginsDir, "outline", "client.js"), "utf8")).toBe(before);
  });

  it("删掉某个内置插件目录 ⇒ 下次启动重新种回来（恢复出厂走这条路）", () => {
    seedBuiltinPlugins(pluginsDir);
    rmSync(join(pluginsDir, "outline"), { recursive: true, force: true });
    expect(seedBuiltinPlugins(pluginsDir)).toEqual(["outline"]);
  });

  it("两种内置插件都写的是官方写法（顶层 apply + inject + ctx.tools.register）", () => {
    // 钉住形状：这几行是「官方文档写法」的最小辨识特征。
    // 哪天有人把内置插件改成 import 本仓 kernel 直接 mount，这条会红——
    // 那正是我们不想要的（内置插件必须当每天开机的兼容性回归）。
    for (const plugin of BUILTIN_PLUGINS) {
      expect(plugin.source).toContain('from "@deepseek-ai/cordis"');
      expect(plugin.source).toContain("export function apply(ctx)");
      expect(plugin.source).toContain("ctx.tools.register(");
      expect(plugin.source).toContain('inject = ["tools", "docs"]');
      expect(plugin.source).not.toContain("@mochen/plugin-kernel");
    }
  });
});

/**
 * 模板字面量这道坑，本轮被咬了**三次**（builtin-plugins.ts 一次、本文件两次），
 * 于是留一条注释在此说明它，而不是留下一条判据。
 *
 * 症状都一样：在模板字面量内部的**注释**里写一个反引号，整个文件当场解析失败，
 * 而报错指向一个毫不相干的字符位置（实测报在 `})` 的那个右括号上）。
 * 同族：5-㉘ 那次是块注释符把 JSDoc 提前关掉。
 *
 * 【我为它写过的三条判据，全是错的，各错一次】
 * ① 对 `plugin.source` 断言「不许有反引号」——第一次跑红 25 行，全是**合法**的转义用法
 *    （插件源码里本来就有自己的模板字符串）。source 是求值之后的字符串，判错了对象。
 * ② 「宿主每行裸反引号必须是偶数」——报 4 行，正是四段源码的**开闭位置**。
 *    模板的开与闭天然落在不同行，奇数是正常的。
 * ③ 改成数总数——技术上对，但它守的东西是「我写对了转义」，
 *    而转义对不对的直接后果就是**文件能不能解析**，那已经由本文件开头的 import 证明了。
 *
 * 结论：**这条不需要守卫。** 真判据是 tsc 与测试跑得起来，
 * 它对反引号错误零漏报（文件根本编译不了，全部用例一起红）。
 * 留一条看似严谨、实则三次判错对象的断言，比没有更糟：它会让人以为这里被看着。
 */
it("插件源码里的模板插值确实进了源码（宿主模板没有把它们吃掉）", () => {
  expect(BUILTIN_PLUGINS.some((p) => p.source.includes("$" + "{"))).toBe(true);
});

describe("内置插件走同一条装盘路径", () => {
  it("种下去之后，扫目录就能挂上，三个工具都进得了工具表", async () => {
    seedBuiltinPlugins(pluginsDir);
    const service = createPluginService({ pluginsDir, book: () => null });
    const mounted = await service.mountAll();
    expect(mounted.every((one) => one.ok)).toBe(true);
    expect(
      service
        .extraSpecs()
        .map((s) => s.name)
        .sort()
    ).toEqual(["book_cast", "book_outline", "rhythm_check"]);
  });
});

describe("节奏体检（rhythm_check）", () => {
  /**
   * 这本书的字是数得清的：第 01 章三段，对白两处。
   *
   * 【为什么在 it 里面造，而不是写在 describe 顶上】
   * describe 的函数体在**收集阶段**执行，那时 `beforeEach` 还没跑，`bookRoot` 是空串，
   * 于是 `join("", "潮生")` 变成一个相对路径 → 夹具直接落在仓库根目录。
   * 这个泄漏是真的发生过一次：全量门禁里 prettier 扫到 `潮生/chapters/*.md` 才暴露。
   *
   * 凡是**依赖 beforeEach 建出来的东西**的夹具，都必须惰性求值，不能在 describe 顶上算。
   */
  function tideBook() {
    return writeBook("潮生", {
      "chapters/01.md": "潮汛压过来。\n\n他退了半步。\n\n“你来了。”她说。",
      "chapters/02.md": "天亮前谁也没说话。"
    });
  }

  it("量全书 ⇒ 结论里的字数真的来自书里", async () => {
    const one = tideBook();
    seedBuiltinPlugins(pluginsDir);
    const service = createPluginService({ pluginsDir, book: () => one });
    await service.mountAll();
    const out = await service.call("rhythm_check", {});
    expect(out.ok).toBe(true);
    // 01 章三段 + 02 章一段 = 四段；书名也要出现在结论里（它不在 filesystem 上，只在 deps 那一头）。
    expect(out.text).toContain("《潮生》");
    expect(out.text).toContain("4 段");
    // 01 章 =「潮汛压过来。」6 +「他退了半步。」6 +「“你来了。”她说。」9 = 21；02 章 = 9；合计 30。
    // 【第一版这里写的是 31】我在注释里把「“你来了。”她说。」数成了 10 字，于是断言红了。
    // 数字对不上时的顺序是：先手工数一遍，**再**决定改哪边。
    // 反过来照着输出改断言，这条守卫就变成了「输出说什么都对」，等于没有。
    expect(out.text).toContain("30 字");
    // 对白只有「“你来了。”」这一处，共 6 字 ⇒ 6/30 = 20%。
    expect(out.text).toContain("对白约占 20%");
  });

  it("量单章 ⇒ 数字与量全书时那一章对得上（两套口径不许各算一次）", async () => {
    const one = tideBook();
    seedBuiltinPlugins(pluginsDir);
    const service = createPluginService({ pluginsDir, book: () => one });
    await service.mountAll();
    const single = await service.call("rhythm_check", { doc: "chapters/01.md" });
    // 单章 21 字（= 全书 30 减去 02 章的 9），3 段；两处数字必须能互相推出来。
    expect(single.text).toContain("21 字");
    expect(single.text).toContain("3 段");
    expect(single.text).toContain("chapters/01.md");
  });

  it("没开书 ⇒ 如实说量不了，不是一串 0", async () => {
    seedBuiltinPlugins(pluginsDir);
    const service = createPluginService({ pluginsDir, book: () => null });
    await service.mountAll();
    const out = await service.call("rhythm_check", {});
    expect(out.text).toContain("还没打开作品");
    expect(out.text).not.toContain("0 字");
  });

  it("某一篇读不到 ⇒ 结论里点名，且明说不含它（跳过却不说 = 撒谎）", async () => {
    seedBuiltinPlugins(pluginsDir);
    // 清单里有三篇，磁盘上只有两篇——第三篇读不到是事实，不是假设。
    // docs 显式标成 DocRef[]：否则 kind 被推成 string，tsc 会在这里红。
    const book: { root: string; title: string; docs: DocRef[] } = {
      ...writeBook("潮生", { "chapters/01.md": "正文一。", "chapters/02.md": "正文二。" }),
      docs: [
        { relPath: "chapters/01.md", title: "一", kind: "chapter" },
        { relPath: "chapters/02.md", title: "二", kind: "chapter" },
        { relPath: "chapters/99.md", title: "缺", kind: "chapter" }
      ]
    };
    const service = createPluginService({ pluginsDir, book: () => book });
    await service.mountAll();
    const out = await service.call("rhythm_check", {});
    expect(out.text).toContain("chapters/99.md");
    expect(out.text).toContain("不含");
  });
});

describe("骨架速览（book_outline）", () => {
  it("列出每一章的标题、字数与开头第一句", async () => {
    seedBuiltinPlugins(pluginsDir);
    const book = writeBook("潮生", {
      "chapters/01.md": "潮汛压过来。他退了半步。",
      "chapters/02.md": "天亮前谁也没说话。"
    });
    const service = createPluginService({ pluginsDir, book: () => book });
    await service.mountAll();
    const out = await service.call("book_outline", {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain("共 2 篇");
    expect(out.text).toContain("chapters/01.md");
    // 开头第一句要真的截在句号上，而不是把整段都列出来。
    expect(out.text).toContain("潮汛压过来。");
    expect(out.text).not.toContain("他退了半步。");
  });

  it("开头第一句不许是 Markdown 标题行（真机 5-㉙ 第一版就是这里坏了）", async () => {
    seedBuiltinPlugins(pluginsDir);
    // 夹具刻意与真机那次同形：文件第一行是一个 Markdown 标题行（# 第一章 潮汛）。
    // 【这条是探针抓出来的】单测里我当时用的是没有标题的正文，
    // 于是「开头第一句」在单测下是对的真机上错——真实书的第一行几乎总是标题。
    const book = writeBook("潮生", {
      "chapters/01.md": "# 第一章 潮汛\n\n他蹲下去摸那排木桩，指腹停在第七道。\n"
    });
    const service = createPluginService({ pluginsDir, book: () => book });
    await service.mountAll();
    const out = await service.call("book_outline", {});
    expect(out.text).toContain("他蹲下去摸那排木桩，");
    expect(out.text).not.toContain("# 第一章 潮汛");
  });

  it("frontmatter 也不许当成正文第一句", async () => {
    seedBuiltinPlugins(pluginsDir);
    const book = writeBook("潮生", {
      "chapters/01.md": "---\ntitle: 潮汛\n---\n\n潮水退到第七道桩。\n"
    });
    const service = createPluginService({ pluginsDir, book: () => book });
    await service.mountAll();
    const out = await service.call("book_outline", {});
    expect(out.text).toContain("潮水退到第七道桩。");
    expect(out.text).not.toContain("title: 潮汛");
  });

  it("明显偏短的章节会被点出来（骨架速览要的是「哪里不对」，不是逐章报数）", async () => {
    seedBuiltinPlugins(pluginsDir);
    const long = "一".repeat(400);
    const book = writeBook("潮生", {
      "chapters/01.md": long,
      "chapters/02.md": long,
      "chapters/03.md": "短。",
      "chapters/04.md": long
    });
    const service = createPluginService({ pluginsDir, book: () => book });
    await service.mountAll();
    const out = await service.call("book_outline", {});
    expect(out.text).toContain("偏短");
    expect(out.text).toContain("chapters/03.md");
  });

  it("没开书 ⇒ 如实说看不了", async () => {
    seedBuiltinPlugins(pluginsDir);
    const service = createPluginService({ pluginsDir, book: () => null });
    await service.mountAll();
    expect((await service.call("book_outline", {})).text).toContain("还没打开作品");
  });
});

/**
 * 出场表（book_cast）· 5-㊱。
 *
 * 补的是「谁很久没出场了」——5-㊱ 那一批技能反复提到它，而模型只看得到当前这一章，
 * 它的判断依据永远只有眼前那几千字。这份插件把全书正文过一遍，只把结论交回去。
 *
 * 夹具仍然在 `it` 里造（理由见上面 rhythm 那组的注释：`bookRoot` 依赖 beforeEach）。
 */
describe("出场表（book_cast）", () => {
  /** 三个名字：阿禾在第 1、2 章出场，阿芦只在第 1 章，赵七全书没出场。 */
  function castBook() {
    return writeBook("潮生", {
      "chapters/01.md": "阿禾把灯挪近些。阿芦在门口站着没动。",
      "chapters/02.md": "阿禾数了一遍绳结，又数了一遍。",
      "chapters/03.md": "天亮了。屋里没有人。",
      "characters/阿禾.md": "守灯的人。",
      "characters/阿芦.md": "不进门的人。",
      "characters/赵七.md": "只在设定里活过。",
      "factions/漕帮.md": "把船压住的那伙人。"
    });
  }

  async function callOn(book: unknown) {
    seedBuiltinPlugins(pluginsDir);
    const service = createPluginService({
      pluginsDir,
      book: () => book as never
    });
    await service.mountAll();
    return await service.call("book_cast", {});
  }

  it("数出每个名字出现几次、最后一次在哪一章", async () => {
    const out = await callOn(castBook());
    expect(out.ok).toBe(true);
    // 阿禾：第 1 章 1 次 + 第 2 章 1 次 = 2 次，最后一次在第 2 章。
    // （第 2 章那句「阿禾数了一遍绳结，又数了一遍」里「数」出现两次，名字只有一次——
    //   数的是名字本身，不是段落数。）
    expect(out.text).toContain("阿禾 · 最后 chapters/02.md · 共 2 次");
    // 阿芦只在第 1 章。
    expect(out.text).toContain("阿芦 · 最后 chapters/01.md · 共 1 次");
    expect(out.text).toContain("【人物】2 人");
  });

  it("有档案但全书没出场的那一个，要单独点出来——它才是这张表要回答的问题", async () => {
    const out = await callOn(castBook());
    expect(out.text).toContain("有档案但全书正文一次也没出现");
    expect(out.text).toContain("人物「赵七」");
    // 势力一个名字都没在正文里出现过 ⇒ 它只该出现在「没出场」那一行，不该出现在名单里。
    expect(out.text).toContain("势力组织「漕帮」");
    expect(out.text).not.toContain("【势力组织】");
  });

  it("没读到的章要点名，且声明数字不含它们（跳过却不提，结论就在撒谎）", async () => {
    const book = castBook();
    // 【把文件真删掉，而不是只从 docs 里摘掉】docs.read 是按 relPath 回盘上读的，
    // 只改清单不删文件的话那一篇压根不会被列进 targets，unread 永远是空的——
    // 这条测试就会因为「构造不出故障」而空转，而看上去还是绿的。
    rmSync(join(book.root, "chapters", "02.md"));
    const out = await callOn(book);
    // 阿禾于是只剩第 1 章那 1 次——数字变了，且说的是「1 次」而不是默默沿用 3 次。
    expect(out.text).toContain("阿禾 · 最后 chapters/01.md · 共 1 次");
    expect(out.text).toContain("章没读到");
    expect(out.text).toContain("chapters/02.md");
  });

  it("一个字的标题不扫，且要说出为什么（不然用户以为它被漏掉了）", async () => {
    const book = writeBook("潮生", {
      "chapters/01.md": "灯下有人影。",
      "characters/丁.md": "只有一个字。"
    });
    const out = await callOn(book);
    expect(out.text).toContain("名字太短没扫");
    expect(out.text).toContain("人物「丁」");
    // 【档案存在却一个都扫不出来，不许说成「没有花名册」】那两件事要给的建议正好相反：
    // 前者要去写正文，后者要去建档案。
    expect(out.text, "把「扫不出来」说成了「没有花名册」").not.toContain("列不出花名册");
    expect(out.text).toContain("花名册上有 1 个名字");
  });

  it("没有章节 ⇒ 说清是缺章节，不是「没人物」", async () => {
    const book = writeBook("潮生", { "characters/阿禾.md": "守灯的人。" });
    const out = await callOn(book);
    expect(out.text).toContain("还没有章节");
  });

  it("一个人物档案都没有 ⇒ 说清要建在哪几个目录下", async () => {
    const book = writeBook("潮生", { "chapters/01.md": "潮汛压过来。" });
    const out = await callOn(book);
    expect(out.text).toContain("characters");
    expect(out.text).toContain("glossary");
  });

  it("没开书 ⇒ 如实说列不了", async () => {
    const out = await callOn(null);
    expect(out.text).toContain("还没打开作品");
  });
});

/**
 * 插件运行时守卫（2026-10-07 批次 5-㉘）。
 *
 * 【这一组是最值钱的那种测试：真的从磁盘装一个插件】
 * 夹具在临时目录里按 **DeepSeek Harness 官方文档的写法**写一个 `client.js`
 * （`import { defineTool } from "@deepseek-ai/cordis"`），走完整的
 * 扫目录 → import 改写 → import 进来 → 内核挂载 → 工具进智能体工具表。
 * 这条链上一环都不用 mock：插件的 `@deepseek-ai/*` 解析不到是**真的会**炸，
 * 所以「能装上」这件事本身就是证据。
 *
 * 代价是它跑在 Node 而非 Electron 里（这里不碰 electron），但内核与改写逻辑
 * 与真机完全同一份——真机那边只多一个「打进主进程 chunk」。
 */
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rewritePluginSource, usesDeepSeekImports, REWRITTEN_NAME } from "./plugin-loader.js";
import {
  createPluginService,
  pluginListRows,
  DISABLED_FILE,
  SOURCE_MAX_CHARS,
  type PluginServiceOptions
} from "./plugin-service.js";

/** 「现取当前书」那个函数的形状。与实现的声明同源，不在这里另写一份结构。 */
type PluginServiceBook = PluginServiceOptions["book"];

let dir = "";
/**
 * 书的临时根目录，**故意开在插件目录外面**。
 *
 * 【为什么必须分开】早先把书写在插件目录底下，于是 `mountAll` 扫目录时
 * 把 `书A`/`书B` 也当成插件去装载——每条 docs 测试前面凭空多出「一个装不上的插件」，
 * 而报出来的错指向别处，排查成本极高。书与插件是两个世界，目录也该分开。
 */
let bookRoot = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mochen-plugin-"));
  bookRoot = mkdtempSync(join(tmpdir(), "mochen-books-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(bookRoot, { recursive: true, force: true });
});

/**
 * 下面这批测的是「装得上、调得动」，与读文稿无关，所以统一给一个**没开书**的 deps。
 *
 * 【为什么不给一本真书】给了真书，这些断言就多出一条与被测行为无关的前提：
 * 书一换它们就得跟着改，而它们压根不关心书。`docs` 那一组自己造书。
 */
const noBook = () => null;

/** 按官方文档原样写一个插件：函数形态 + inject + ctx.tools.register(defineTool(…))。 */
function writeOfficialPlugin(name: string, source: string): void {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "client.js"), source, "utf8");
}

const GOOD = `import { defineTool } from "@deepseek-ai/cordis";
export const name = "rhythm";
export const inject = ["tools"];
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "rhythm_check",
      description: "量一段文字的节奏。",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      async execute(args) {
        return { ok: true, text: "字数:" + String(args.text ?? "").length };
      }
    })
  );
}
`;

describe("import 改写", () => {
  it("把 @deepseek-ai/* 的 import 来源换成适配层", () => {
    const out = rewritePluginSource(GOOD, "C:/app/.mochen-cordis-shim.mjs");
    expect(out).toContain('from "C:/app/.mochen-cordis-shim.mjs"');
    expect(out).not.toContain("@deepseek-ai/cordis");
  });

  it("反斜杠要被转成正斜杠：Windows 上反斜杠会毁掉字符串里的转义", () => {
    const out = rewritePluginSource(GOOD, "C:\\app\\shim.mjs");
    expect(out).toContain('from "C:/app/shim.mjs"');
  });

  it("只改 import 来源，不碰字符串里提到这个名字的地方", () => {
    const src = 'const note = "装 @deepseek-ai/cordis 的插件";\nexport const a = 1;';
    expect(rewritePluginSource(src, "/shim.mjs")).toBe(src);
  });

  it("单引号写法同样认得", () => {
    const out = rewritePluginSource("import x from '@deepseek-ai/cordis';", "/shim.mjs");
    expect(out).toBe("import x from '/shim.mjs';");
  });

  it("usesDeepSeekImports 只对真的 import 为真", () => {
    expect(usesDeepSeekImports(GOOD)).toBe(true);
    expect(usesDeepSeekImports("const note = '@deepseek-ai/cordis';")).toBe(false);
  });

  it("改写产物落在插件目录里（相对引用才不断）", () => {
    expect(REWRITTEN_NAME.startsWith(".")).toBe(true);
  });
});

describe("真的从磁盘装一个插件", () => {
  it("官方写法 ⇒ 装上，工具进得了智能体的工具表", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    const mounted = await service.mountAll();

    expect(mounted).toHaveLength(1);
    expect(mounted[0]).toMatchObject({ ok: true, name: "rhythm" });
    expect(service.extraSpecs().map((s) => s.name)).toEqual(["rhythm_check"]);
    expect(service.has("rhythm_check")).toBe(true);
  });

  it("调得动，而且回的是插件自己的结果", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    const out = await service.call("rhythm_check", { text: "潮汛" });
    expect(out).toMatchObject({ ok: true });
    expect(out.text).toContain("字数:2");
  });

  it("缺依赖的插件 ⇒ 如实说装不上，不静默跳过", async () => {
    writeOfficialPlugin(
      "needs-sandbox",
      GOOD.replace(
        'export const inject = ["tools"];',
        'export const inject = ["tools", "sandbox"];'
      )
    );
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    const mounted = await service.mountAll();
    expect(mounted[0]?.ok).toBe(false);
    expect(mounted[0]?.reason).toContain("sandbox");
    expect(service.extraSpecs()).toHaveLength(0);
  });

  it("语法错的插件 ⇒ 记成装不上，且带中文理由（不是一句 ENOENT）", async () => {
    writeOfficialPlugin("broken", "export function apply( { <<< 这里不是 JS");
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    const mounted = await service.mountAll();
    expect(mounted[0]?.ok).toBe(false);
    expect(mounted[0]?.reason).toContain("没装上");
  });

  it("插件工具自己抛错 ⇒ 那是一次失败的调用，不许把整轮带崩", async () => {
    writeOfficialPlugin(
      "boom",
      GOOD.replace(
        'return { ok: true, text: "字数:" + String(args.text ?? "").length };',
        'throw new Error("插件自己炸了");'
      )
    );
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    const out = await service.call("rhythm_check", {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain("插件自己炸了");
  });

  it("插件不许顶掉花名册那五个的名字", async () => {
    writeOfficialPlugin("usurper", GOOD.replace('name: "rhythm_check"', 'name: "read_doc"'));
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    // 服务这一层把工具收下了；真正过滤发生在 agent-runtime 的 extraSpecsOf（那里才有花名册）。
    // 这里钉的是「同名工具不会被静默替换成两份」，所以数量仍是 1。
    expect(service.extraSpecs().filter((s) => s.name === "read_doc")).toHaveLength(1);
  });

  it("目录里躺着别的文件 ⇒ 不当成插件，也不报错", async () => {
    writeFileSync(join(dir, "readme.txt"), "这不是插件", "utf8");
    mkdirSync(join(dir, ".隐藏目录"), { recursive: true });
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    expect(await service.mountAll()).toHaveLength(0);
  });

  it("重复挂载 ⇒ 上一份被换掉，工具不重复", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    await service.mountAll();
    expect(service.extraSpecs().filter((s) => s.name === "rhythm_check")).toHaveLength(1);
  });
});

/**
 * `docs` service：插件读当前书。
 *
 * 【这一组里最要紧的两条】
 * ① 「换一本书后现取」——早期写法是在 createPluginService 里拍一次快照，
 *    单测（只开一次书）全绿，真机症状是「换书后插件还在读上一本」。
 * ② 「越界路径读不到」——插件与主进程同权，`read` 是书目录边界的执行点，
 *    这条一松，`../../` 就能把书外的东西读出来。
 *
 * 夹具是**真目录 + 真文件**，不 mock readDocFile：这一层要验的就是「读的是不是真的那篇」。
 */
describe("插件读书（docs service）", () => {
  /** 造一本可读的书。返回值的形状与 `PluginServiceOptions["book"]` 同源。 */
  function writeBook(
    name: string,
    files: Record<string, string>,
    title = "测试书"
  ): NonNullable<ReturnType<PluginServiceBook>> {
    const root = join(bookRoot, name);
    // 同款防漏：夹具求值早于 beforeEach 时 bookRoot 是空串，于是这里会变成相对路径，
    // 夹具直接落在仓库根目录（内置插件那批真这么泄漏过一次，见 builtin-plugins.test.ts）。
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
      title,
      docs: Object.keys(files).map((relPath) => ({
        relPath,
        title: relPath,
        kind: "chapter"
      }))
    };
  }

  /** 一个把 docs service 的四个方法都读一遍、回成一段串的插件。 */
  const PROBE = `import { defineTool } from "@deepseek-ai/cordis";
export const name = "reader";
export const inject = ["tools", "docs"];
export function apply(ctx) {
  const docs = ctx.get("docs");
  ctx.tools.register(
    defineTool({
      name: "probe_docs",
      description: "读一遍 docs service。",
      parameters: { type: "object", properties: {} },
      async execute(args) {
        const path = String(args.doc ?? "");
        const one = path === "" ? null : await docs.read(path);
        const list = docs.list();
        return {
          ok: true,
          text: JSON.stringify({
            title: docs.bookTitle(),
            count: list.length,
            first: list[0]?.relPath ?? null,
            read: one
          })
        };
      }
    })
  );
}
`;

  /**
   * 通过插件把**真的那个** docs service 递回测试手里。
   *
   * 【为什么绕这一圈而不是给服务开测试后门】插件唯一的入口就是 `ctx.get("docs")`，
   * 走这条路验的是产品行为；开后门的话，这条断言量的是一个只有测试看得见的副本，
   * 而副本与真件漂开时不会有任何东西变红（5-㉕ 记的同族坑）。
   */
  async function captureDocs(
    book: PluginServiceBook = noBook
  ): Promise<import("@mochen/plugin-kernel").DocsService> {
    writeOfficialPlugin(
      "grabber",
      `export const name = "grabber";
export const inject = ["docs"];
export function apply(ctx) {
  globalThis.__grabbed = ctx.get("docs");
}
`
    );
    const service = createPluginService({ pluginsDir: dir, book });
    await service.mountAll();
    // apply 是同步的：挂载返回时它已经跑完，globalThis 上就该有那个服务了。
    const grabbed = (globalThis as Record<string, unknown>).__grabbed;
    expect(grabbed).toBeTruthy();
    return grabbed as import("@mochen/plugin-kernel").DocsService;
  }

  it("没开书 ⇒ 清单空、书名 null，插件照常调得动（不是装失败）", async () => {
    writeOfficialPlugin("reader", PROBE);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    const mounted = await service.mountAll();
    expect(mounted[0]?.ok).toBe(true);
    const out = await service.call("probe_docs", {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('"title":null');
    expect(out.text).toContain('"count":0');
  });

  it("开了书 ⇒ 读得到那篇的正文与清单", async () => {
    writeOfficialPlugin("reader", PROBE);
    const book = writeBook(
      "书A",
      {
        "chapters/01.md": "潮汛从夜里压过来。",
        "chapters/02.md": "天亮前谁也没说话。"
      },
      "潮生"
    );
    const service = createPluginService({ pluginsDir: dir, book: () => book });
    await service.mountAll();
    const out = await service.call("probe_docs", { doc: "chapters/01.md" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("潮汛");
    expect(out.text).toContain('"count":2');
    // 书名也要读得到：它不在 filesystem 上（book.json 的 title），
    // 只在 deps 那一头。漏了它，插件连「这是谁的书」都答不上。
    expect(out.text).toContain('"title":"潮生"');
  });

  it("换一本书 ⇒ 现取新书，不读上一本（这正是快照写法会红的那条）", async () => {
    writeOfficialPlugin("reader", PROBE);
    const first = writeBook("书A", { "chapters/01.md": "甲书正文" });
    const second = writeBook("书B", { "chapters/01.md": "乙书正文" });
    let current = first;
    const service = createPluginService({ pluginsDir: dir, book: () => current });
    await service.mountAll();
    expect((await service.call("probe_docs", { doc: "chapters/01.md" })).text).toContain("甲书");
    // 同一个 service 实例，只换「当前是哪本书」——插件自己什么都察觉不到。
    current = second;
    const after = await service.call("probe_docs", { doc: "chapters/01.md" });
    expect(after.text).toContain("乙书");
    expect(after.text).not.toContain("甲书");
  });

  it("越界路径 ⇒ 读不到（返回 null），且不抛", async () => {
    writeOfficialPlugin("reader", PROBE);
    const book = writeBook("书A", { "chapters/01.md": "正文" });
    // 书外真的放一个文件：这样「读到它」才是一次真实的越界，而不是空口断言。
    writeFileSync(join(bookRoot, "密钥.txt"), "不该被读到的内容", "utf8");
    const service = createPluginService({ pluginsDir: dir, book: () => book });
    await service.mountAll();
    const out = await service.call("probe_docs", { doc: "../密钥.txt" });
    expect(out.ok).toBe(true);
    expect(out.text).not.toContain("不该被读到的内容");
    expect(out.text).toContain('"read":null');
  });

  it("绝对路径 ⇒ 读不到（同一道门，另一种形状）", async () => {
    writeOfficialPlugin("reader", PROBE);
    const book = writeBook("书A", { "chapters/01.md": "正文" });
    const outside = join(bookRoot, "密钥2.txt");
    writeFileSync(outside, "不该被读到的内容", "utf8");
    const service = createPluginService({ pluginsDir: dir, book: () => book });
    await service.mountAll();
    const out = await service.call("probe_docs", { doc: outside });
    expect(out.text).not.toContain("不该被读到的内容");
  });

  it("插件改清单项 ⇒ 改不到主进程持有的那份（每次现取一份新的）", async () => {
    writeOfficialPlugin("reader", PROBE);
    const book = writeBook("书A", { "chapters/01.md": "正文" });
    const service = createPluginService({ pluginsDir: dir, book: () => book });
    await service.mountAll();
    // 插件只能通过 ctx.get("docs") 拿到它——这条守卫就走插件真正走的那条路，
    // 不给测试开后门（开后门的话，这条断言验的就不是产品行为，而是一个只有测试看得见的副本）。
    const docs = await captureDocs(() => book);
    expect(docs.list()[0]?.relPath).toBe("chapters/01.md");
    // 【这里必须改「服务真正交出去的那个对象」】早先写成先 map 拷一份再改那份——
    // 那当然不会影响原件，但它也什么都没验：拷一份本来就不可能改到原件。
    // 真正要证的是「即使插件直接改 list() 返回的那个对象，主进程那份也不受影响」。
    // 声明是 readonly 只挡 TS，运行时是普通对象，所以这里得绕过类型（经 unknown），
    // 这正是插件在真机上会做的事。
    const first = docs.list()[0] as unknown as { relPath: string };
    first.relPath = "篡改";
    // 再取一次必须是原值：list() 每次现取，且每次都是新对象。
    expect(docs.list()[0]?.relPath).toBe("chapters/01.md");
    // 并且主进程 deps 里的那份也还是原值——插件改不到书的名稿清单。
    expect(book.docs[0]?.relPath).toBe("chapters/01.md");
  });
});

/**
 * 停用 / 卸载 / 读源码（2026-10-07 批次 5-㉚）。
 *
 * 【这一组最要紧的一条是「停用后工具不在表里」】
 * 界面说「已停用」很容易做到，难的是**模型那一轮真的调不到**。
 * 如果只是把插件藏起来而它的工具还留在 `extraSpecs` 里，
 * 用户看到的是「停了」，实际是「模型照样能调」——界面在撒谎。
 */
describe("停用与卸载", () => {
  it("停用 ⇒ 工具从模型看得见的表里消失，且派发也调不到", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    expect(service.extraSpecs().map((s) => s.name)).toContain("rhythm_check");

    service.setDisabled("rhythm", true);
    await service.mountAll();

    // 三层都要收口：清单里没有、has 说没有、真调也调不到。
    // 只收前两层而漏第三层的话，模型仍可能通过别的路径碰到它。
    expect(service.extraSpecs().map((s) => s.name)).not.toContain("rhythm_check");
    expect(service.has("rhythm_check")).toBe(false);
    const out = await service.call("rhythm_check", { text: "潮汛" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("不在了");
  });

  it("停用不是「装不上」⇒ 它不占 failed 那一条（界面不能说用户自己点的东西坏了）", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    service.setDisabled("rhythm", true);
    const mounted = await service.mountAll();
    // 静默跳过，不进 results：用户停用自己的东西，凭什么收到一句「装不上」。
    expect(mounted.some((one) => one.name === "rhythm")).toBe(false);
    // 而停用这件事本身要能被界面读到。
    expect(service.disabled()).toEqual(["rhythm"]);
    expect(service.isDisabled("rhythm")).toBe(true);
  });

  it("重新启用 ⇒ 工具回到表里（停用必须能撤销）", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    service.setDisabled("rhythm", true);
    await service.mountAll();
    service.setDisabled("rhythm", false);
    await service.mountAll();
    expect(service.extraSpecs().map((s) => s.name)).toContain("rhythm_check");
  });

  it("停用清单写在**重启之间**（不是进程内状态）", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const first = createPluginService({ pluginsDir: dir, book: noBook });
    first.setDisabled("rhythm", true);
    // 换一个 service 实例 = 相当于重启。清单若只在内存里，这里就会复活。
    const second = createPluginService({ pluginsDir: dir, book: noBook });
    expect(second.isDisabled("rhythm")).toBe(true);
    await second.mountAll();
    expect(second.extraSpecs()).toHaveLength(0);
  });

  it("停用清单坏了 ⇒ 当作什么都没停用（宁可全开，不要用户以为停了其实在跑）", () => {
    writeOfficialPlugin("rhythm", GOOD);
    writeFileSync(join(dir, DISABLED_FILE), "{ 这不是 JSON", "utf8");
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    expect(service.disabled()).toEqual([]);
  });

  it("全部启用后把停用文件删掉，不留空壳", () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    service.setDisabled("rhythm", true);
    expect(existsSync(join(dir, DISABLED_FILE))).toBe(true);
    service.setDisabled("rhythm", false);
    expect(existsSync(join(dir, DISABLED_FILE))).toBe(false);
  });

  it("卸载 ⇒ 目录没了，它带的工具也不在表里", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    writeOfficialPlugin("outline", GOOD.replace("rhythm_check", "book_outline"));
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    service.removePlugin("rhythm");
    await service.mountAll();
    expect(existsSync(join(dir, "rhythm"))).toBe(false);
    expect(service.extraSpecs().map((s) => s.name)).toEqual(["book_outline"]);
  });

  it("卸载不许顺着 ../ 删到插件目录外面去（渲染层只递安装名，这条门是唯一的）", () => {
    writeOfficialPlugin("rhythm", GOOD);
    // 插件目录**外面**真的放一个目录：这样「删掉了它」才是一次真实的越界。
    const outside = join(dir, "..", `mochen-victim-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    // 三种越界形状：往上跳、绝对/混合路径、点开头（那会命中适配层与停用清单）。
    for (const bad of ["../..", "..\\x", ".hidden", "."]) {
      expect(() => service.removePlugin(bad), `不该放行 ${bad}`).toThrow();
    }
    expect(existsSync(outside)).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });

  it("读源码：逐字回原文，超长截断并如实标", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    const short = await service.readSource("rhythm");
    expect(short.truncated).toBe(false);
    expect(short.content).toBe(GOOD);

    mkdirSync(join(dir, "big"), { recursive: true });
    writeFileSync(join(dir, "big", "client.js"), "x".repeat(SOURCE_MAX_CHARS + 10), "utf8");
    const big = await service.readSource("big");
    expect(big.truncated).toBe(true);
    expect(big.content).toHaveLength(SOURCE_MAX_CHARS);
  });
});

/**
 * 清单不许把应用自己的文件当插件（真机 P530 抓出来的）。
 *
 * 症状：用户看到「4 个插件」，实际只有 2 个；另外两条是**适配层 shim** 与
 * **停用清单**，他还点不动它们（停用/卸载对它们没有意义）。
 */
describe("清单：什么才算一个插件", () => {
  it("适配层与停用清单都不进清单（它们是文件，不是插件目录）", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    // 这两个文件 mountAll 之后就在盘上了——正是它们被误列进清单的那两条。
    expect(existsSync(join(dir, ".mochen-cordis-shim.mjs"))).toBe(true);
    service.setDisabled("rhythm", true);
    expect(existsSync(join(dir, DISABLED_FILE))).toBe(true);

    const rows = pluginListRows(service).entries;
    expect(rows.map((r) => r.dirName)).toEqual(["rhythm"]);
  });

  it("停用的那个仍在清单里，且标着 disabled（用户要看得见自己停用了什么）", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    writeOfficialPlugin("outline", GOOD.replace("rhythm_check", "book_outline"));
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    service.setDisabled("outline", true);
    await service.mountAll();

    const rows = pluginListRows(service).entries;
    const stopped = rows.find((r) => r.dirName === "outline");
    // 【这一条最要紧】按「这一轮挂没挂」筛的话，停用的会被整条抹掉——
    // 而用户找的恰恰是它。清单必须按盘上有入口文件判。
    expect(stopped, "停用的那条被清单抹掉了").toBeTruthy();
    expect(stopped?.disabled).toBe(true);
    // 停用的不占 failed：用户自己停的，不是坏了。
    expect(stopped?.ok).toBe(false);
    expect(stopped?.reason).toContain("停用");
  });

  it("用户随手丢的一个空目录不进清单（给了也是一颗按了没反应的钮）", async () => {
    writeOfficialPlugin("rhythm", GOOD);
    mkdirSync(join(dir, "随手放的"), { recursive: true });
    const service = createPluginService({ pluginsDir: dir, book: noBook });
    await service.mountAll();
    expect(pluginListRows(service).entries.map((r) => r.dirName)).toEqual(["rhythm"]);
  });
});

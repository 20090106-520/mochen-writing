// P1-4（2026-10-09 全仓扫描）：`book-service.createDoc` 建完一章要**整本重扫**
// （`docs: sortChapters(await scanBook(...), ...)`）。1000 章的书建一章就是 1000 次全量读
// ——夹具 1000 章 × 3000 字（盘上 8.66 MB）实测整本重扫 99–136 ms，只算新那一篇是 1 ms。
// 改成 `docRefFor` 单点算那一篇再拼进树，本文件五条守卫：
// ① 建一章的读盘次数 = 1（而不是整本 N 篇）；
// ② **增量拼出来的 docs 与整本重扫逐字相同**（顺序 + title + excerpt + chars 全都算）——
//    这条是 2026-10-10 用户点名要加的顺序一致性闸：拼接的树必须等于重扫的树；
// ③ 新那篇的 DocRef 与整本扫出的同一篇逐字相同（证明 docRefFor 与 scanBook 是同一份判据，铁律 6）；
// ④ 两篇都不在 chapterOrder 里时，落位仍由 sortChapters 决定（贴在末尾就会红）；
// ⑤ 刚写完却读不回来时退回整本重扫，不拿文件名倒推一个假 DocRef（失败要说话）。
// 已知没在这一刀里的另一半：渲染层 `useBookStore.refreshDocs()`（stores/useBookStore.ts:209）走的还是
// `openBook` 全量重扫，所以界面上「建一章」仍会读整本一遍——那条要先把两处排序判据合成一份才动得了，
// 记在扫描总单 P1-4 的「半收口」里，不在这里冒充已完成。
// IO 计量沿用仓里既有先例（fs-store/test/scan-excerpt.test.ts）：vi.mock 转发真实实现，仍然真读盘。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHANGE_RETENTION, DEFAULT_PERMISSION_MODE } from "@mochen/contracts";
import { scanBook, sortChapters } from "@mochen/fs-store";
import { createBookService } from "./book-service.js";

const io = vi.hoisted(() => ({ calls: 0, statFails: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn((...args: Parameters<typeof actual.readFile>) => {
      io.calls += 1;
      return (actual.readFile as (...rest: unknown[]) => Promise<unknown>)(...args);
    }),
    // 只让**指定那一篇**的 stat 失败，其余全部转发真实实现：这是「写完却读不回来」那条兜底
    // 唯一的复现方式——真盘上写完立刻 stat 得到，复现不了外力改名与占用。
    stat: vi.fn((...args: Parameters<typeof actual.stat>) => {
      const target = String(args[0]).replaceAll("\\", "/");
      if (io.statFails !== null && target.endsWith(io.statFails)) {
        return Promise.reject(new Error(`simulated: 读不回 ${target}`));
      }
      return (actual.stat as (...rest: unknown[]) => Promise<unknown>)(...args);
    })
  };
});

/**
 * 六篇已有文稿，chapterOrder 故意不是文件名顺序：拼接位置错了这里就现形。
 * 第一篇提成常量 `FIRST_DOC` 再拼进 ORDER——仓库开了 noUncheckedIndexedAccess，`ORDER[0]` 的类型是
 * `string | undefined`，下面三处拿它当路径拼会卡在类型关卡；常量没有这个问题，且 ORDER[0] 与它
 * 由构造即同值，不存在两处各写一遍会走偏的风险。
 */
const FIRST_DOC = "chapters/03-潮线.md";
const ORDER = [
  FIRST_DOC,
  "chapters/01-开局.md",
  "chapters/05-灯塔.md",
  "chapters/02-雾名.md",
  "chapters/04-档案.md",
  "chapters/06-退潮.md"
];

const books: string[] = [];

/** 每篇正文都是「正文N段。」五个非空白字符，摘录与字数期望因此能写死。 */
async function makeBook(): Promise<string> {
  const book = await mkdtemp(path.join(tmpdir(), "mochen-createdoc-"));
  books.push(book);
  await mkdir(path.join(book, "chapters"), { recursive: true });
  for (const relPath of ORDER) {
    const index = Number(relPath.slice("chapters/".length, "chapters/".length + 2));
    await writeFile(
      path.join(book, ...relPath.split("/")),
      `---\ntitle: 第${index}章\n---\n\n正文${index}段。\n`,
      "utf8"
    );
  }
  await writeFile(
    path.join(book, "book.json"),
    JSON.stringify(
      {
        id: "b1",
        title: "海雾手记",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: ORDER
      },
      null,
      2
    ),
    "utf8"
  );
  return book;
}

const service = () => createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });

afterAll(async () => {
  for (const book of books) await rm(book, { recursive: true, force: true });
});

describe("createDoc 不再整本重扫（P1-4）", () => {
  it("建一章只读那一新篇：读盘次数 = 1，不是整本的 7 篇", async () => {
    const book = await makeBook();
    const open = service();
    io.calls = 0;
    const opened = await open.open(book);
    // 开书那次仍是整本：六篇正文 + 一次 book.json。这条同时给下一句定基线——
    // 若有人把 scanBook 改成只读头部，这里先红，不会让「建章只读 1 次」冒充成功。
    expect(io.calls).toBe(7);
    expect(opened.docs).toHaveLength(6);
    io.calls = 0;
    const created = await open.createDoc("chapters/07-新章.md", "07-新章");
    expect(created.ok).toBe(true);
    // 反向鉴别：留着一句 scanBook ⇒ 这里是 7（六篇旧的 + 新那篇）而不是 1。
    expect(io.calls).toBe(1);
    await open.close();
  });

  it("增量拼出来的 docs 与整本重扫逐字相同（顺序 + title + excerpt + chars）", async () => {
    const book = await makeBook();
    const incrementalService = service();
    await incrementalService.open(book);
    const created = await incrementalService.createDoc("chapters/00-序章.md", "00-序章");
    expect(created.ok).toBe(true);

    const rescanService = service();
    // 同一本盘重开一次，就是「整本重扫」的定义：两条路出去必须一模一样。
    const fullScan = await rescanService.open(book);

    expect(incrementalService.current()?.docs).toEqual(fullScan.docs);
    // 六篇按 chapterOrder 在前，没进 order 的新篇按名字排在后面一段；拼接位置写死在末尾这条就红。
    expect(fullScan.docs.map((doc) => doc.relPath)).toEqual([...ORDER, "chapters/00-序章.md"]);
    await incrementalService.close();
    await rescanService.close();
  });

  it("新那篇的 DocRef 与整本扫出的同一篇逐字相同（空模板 ⇒ 摘录空、字数 0、标题来自 frontmatter）", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    await open.createDoc("chapters/08-补遗.md", "08-补遗");
    const fresh = open.current()?.docs.find((doc) => doc.relPath === "chapters/08-补遗.md");
    expect(fresh).toEqual({
      relPath: "chapters/08-补遗.md",
      kind: "chapter",
      title: "08-补遗",
      excerpt: "",
      chars: 0,
      opening: "",
      closing: ""
    });
    // 与整本重扫对同一篇的结果再核一次：docRefFor 与 scanBook 必须是同一份判据（铁律 6）。
    const rescanned = (await scanBook(book)).find((doc) => doc.relPath === "chapters/08-补遗.md");
    expect(fresh).toEqual(rescanned);
    await open.close();
  });

  it("建章只重算新那一篇：别的篇在盘上被外力改掉，缓存里的摘录不随这次建章刷新（这一刀的取舍）", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    // 外力直接改盘：绕过 writeDoc 的指纹链，模拟「用户在编辑器里改了文件」。
    await writeFile(
      path.join(book, ...FIRST_DOC.split("/")),
      `${FIRST_DOC} 的外力改写正文。`,
      "utf8"
    );
    await open.createDoc("chapters/07-新章.md", "07-新章");
    const docs = open.current()?.docs ?? [];
    // 这条断言写的是**旧值**，而且必须写旧值：过去那句整本 scanBook 会顺手把这一篇刷成新内容，
    // 现在不会了——docs 的刷新点是 open / saveMeta / 渲染层的温和重扫，建章不是全量同步点。
    // 把它钉在这儿，是为了让「增量取代整本」这一刀丢掉了什么被看见，而不是让它藏在 diff 里。
    // 盘上真有改动时用户看到的是陈旧摘录，这条通路本来就没有实时性承诺（改正文走 writeDoc 后同样不刷）。
    expect(docs.find((doc) => doc.relPath === FIRST_DOC)?.excerpt).toBe("正文3段。");
    expect(docs.some((doc) => doc.relPath === "chapters/07-新章.md")).toBe(true);
    await open.close();
  });

  it("chapterOrder 没变时增量与整本重扫走的是同一条 sortChapters（导出核对，不另排一次）", async () => {
    const book = await makeBook();
    const open = service();
    const opened = await open.open(book);
    await open.createDoc("chapters/09-又一篇.md", "09-又一篇");
    expect(open.current()?.docs).toEqual(
      sortChapters(await scanBook(book), opened.meta.chapterOrder)
    );
    await open.close();
  });

  it("两篇都不在 chapterOrder 里：后建的那篇名字更靠前时仍排到前面（拼接不能一律贴在末尾）", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    await open.createDoc("chapters/09-后建.md", "09-后建");
    await open.createDoc("chapters/08-先建的名字更靠前.md", "08-先建的名字更靠前");
    const unlisted = (open.current()?.docs ?? [])
      .filter((doc) => !ORDER.includes(doc.relPath))
      .map((doc) => doc.relPath);
    // 反向鉴别：把 sortChapters 去掉 ⇒ 这里变成 ["…09…", "…08…"]（按建章先后贴末尾），本条红。
    expect(unlisted).toEqual(["chapters/08-先建的名字更靠前.md", "chapters/09-后建.md"]);
    await open.close();
  });

  it("盘上被外力删掉后又建回同名的一篇：docs 里它只有一条（新值盖掉缓存里的旧值）", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    const relPath = "chapters/07-重建.md";
    expect((await open.createDoc(relPath, "07-重建")).ok).toBe(true);
    // 主进程之外删掉这一篇：snapshot.docs 里那条就成了盘上不存在的旧值。
    await rm(path.join(book, ...relPath.split("/")));
    expect((await open.createDoc(relPath, "07-重建")).ok).toBe(true);
    const hits = (open.current()?.docs ?? []).filter((doc) => doc.relPath === relPath);
    // 反向鉴别：拼接写成 `[...snapshot.docs, fresh]`（不先去同 relPath）⇒ 这里长度 2，树上出现两条同名。
    expect(hits).toHaveLength(1);
    await open.close();
  });

  it("写完却 stat 不回来时退回整本重扫：docs 说真话，不拿文件名倒推一个假 DocRef", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    io.calls = 0;
    io.statFails = "chapters/99-断链.md";
    const created = await open.createDoc("chapters/99-断链.md", "99-断链");
    io.statFails = null;
    expect(created.ok).toBe(true);
    // 兜底确实读了整本（六篇旧的 + 新那篇），而不是只读一次就宣称拿到。
    expect(io.calls).toBe(7);
    const fresh = open.current()?.docs.find((doc) => doc.relPath === "chapters/99-断链.md");
    // 盘上真有这一篇 ⇒ 重扫读得到，标题来自 frontmatter 而不是文件名倒推的成品。
    expect(fresh).toEqual({
      relPath: "chapters/99-断链.md",
      kind: "chapter",
      title: "99-断链",
      excerpt: "",
      chars: 0,
      opening: "",
      closing: ""
    });
    await open.close();
  });

  // ---- P1-4 后半（2026-10-10）：doc:create 把新那篇的 DocRef 一起带回去 -----------------------
  // 渲染层过去拿到 ok 只会再 `refreshDocs()`＝又一次 `openBook`，把整本书每篇正文读一遍。
  // 主进程既然已经算出这一篇（上一条兜底之外都在算），捎回去就是零成本；不捎才是让那一半重扫留在链上。
  it("createDoc 带回新那篇的 DocRef：与主进程缓存、整本重扫三方同值（渲染层拿它本地拼树）", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    const created = await open.createDoc("chapters/07-新章.md", "07-新章");
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("上一条已断言 ok=true，这里只为让 narrowing 成立");
    // 反向鉴别：return 里没有 doc ⇒ undefined，本条当场红。
    expect(created.doc).toEqual({
      relPath: "chapters/07-新章.md",
      kind: "chapter",
      title: "07-新章",
      excerpt: "",
      chars: 0,
      opening: "",
      closing: ""
    });
    // 带回来的那一条必须与「主进程缓存里这一篇」同值：两处不同值＝渲染层拼的树与主进程的树分家。
    expect(created.doc).toEqual(
      open.current()?.docs.find((doc) => doc.relPath === "chapters/07-新章.md")
    );
    // 再与整本重扫对同一篇的结果核一次：docRefFor / scanBook / 回传给渲染层，三处一份判据（铁律 6）。
    expect(created.doc).toEqual(
      (await scanBook(book)).find((doc) => doc.relPath === "chapters/07-新章.md")
    );
    await open.close();
  });

  it("退回整本重扫那条也照样带回 doc：值取自重扫结果，不是拿文件名倒推的成品", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    io.calls = 0;
    io.statFails = "chapters/98-带回.md";
    const created = await open.createDoc("chapters/98-带回.md", "98-带回");
    io.statFails = null;
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("上一条已断言 ok=true，这里只为让 narrowing 成立");
    expect(io.calls).toBe(7); // 兜底确实读了整本，这条 doc 是从这次重扫里取的不是猜的
    const fromRescan = (await scanBook(book)).find((doc) => doc.relPath === "chapters/98-带回.md");
    expect(created.doc).toEqual(fromRescan);
    expect(created.doc).toEqual(
      open.current()?.docs.find((doc) => doc.relPath === "chapters/98-带回.md")
    );
    await open.close();
  });
});

// ---- doc:refresh：改标题 / 吸收智能体写入之后，只重算那一根 DocRef ------------------------------
// 这两条链路过去都调渲染层的 `refreshDocs()`＝`openBook`，把全本书每篇正文再读一遍，只为换树上那一根
// （夹具 1000 章实测 99–136 ms；智能体一轮写 N 篇就是 N×整本）。主进程有同一份判据（`docRefFor`），
// 一次读盘就能算出这一篇，顺带把它自己的快照也换成新值——两处同步，这才是「判据只有一份」的完整含义。
describe("refreshDoc 只重算一篇（P1-4 后半）", () => {
  it("盘上那一篇被改掉后重算：读盘次数 = 1，返回的 doc 与整本重扫逐字相同", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    // 外力直接改盘（绕过 writeDoc）：这正是「用户在外部编辑器里改了标题行」的形状。
    await writeFile(
      path.join(book, ...FIRST_DOC.split("/")),
      "---\ntitle: 潮线（改）\n---\n\n正文3段很长。\n",
      "utf8"
    );
    io.calls = 0;
    const refreshed = await open.refreshDoc(FIRST_DOC);
    const calls = io.calls;
    // 反向鉴别：这条通路写成 scanBook ⇒ 这里是 7（六篇旧的 + 这一篇），本条当场红。
    expect(calls).toBe(1);
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) throw new Error("上一条已断言 ok=true，这里只为让 narrowing 成立");
    // 与整本重扫对同一篇的结果逐字相同：docRefFor / scanBook 一份判据（铁律 6）。
    expect(refreshed.doc).toEqual((await scanBook(book)).find((doc) => doc.relPath === FIRST_DOC));
    expect(refreshed.doc?.title).toBe("潮线（改）");
    await open.close();
  });

  it("主进程自己的快照同步换新：agent 工具看到的 title 不再停在开书那一刻", async () => {
    const book = await makeBook();
    const open = service();
    const opened = await open.open(book);
    await writeFile(
      path.join(book, ...FIRST_DOC.split("/")),
      "---\ntitle: 潮线（改）\n---\n\n正文3段很长。\n",
      "utf8"
    );
    await open.refreshDoc(FIRST_DOC);
    // 反向鉴别：只回给渲染层、不更新 snapshot ⇒ 这里仍是开书时扫到的「第3章」。
    expect(open.current()?.docs.find((doc) => doc.relPath === FIRST_DOC)?.title).toBe("潮线（改）");
    // 顺序不许因为「重算」而变动：这一篇的 relPath 没变，把它贴到末尾就是没走同一条 sortChapters。
    expect(open.current()?.docs.map((doc) => doc.relPath)).toEqual(
      opened.meta.chapterOrder.slice()
    );
    await open.close();
  });

  it("盘上根本没有那一篇（外力删了 / 还没写）：ok:true 带 doc:null，不拿文件名倒推一根假稿件", async () => {
    const book = await makeBook();
    const open = service();
    await open.open(book);
    expect(await open.refreshDoc("chapters/42-没写过.md")).toEqual({ ok: true, doc: null });
    // 文稿目录之外（`notes/` 不在 DOC_DIRS 里）：扫描器本来也不收它，这里同样给 null 而不是抛错。
    expect(await open.refreshDoc("notes/随手.md")).toEqual({ ok: true, doc: null });
    // 反向鉴别：docRefFor 之前先 readFile 会抛 ENOENT ⇒ 这条变成抛错而不是回话。
    expect(open.current()?.docs).toHaveLength(6);
    await open.close();
  });

  it("没开书时如实说没开书：回 no-book，不编一个空 DocRef 冒充「这本书是空的」", async () => {
    const fresh = service();
    const refreshed = await fresh.refreshDoc(FIRST_DOC);
    expect(refreshed.ok).toBe(false);
    if (refreshed.ok) throw new Error("上一条已断言 ok=false，这里只为让 narrowing 成立");
    expect(refreshed.reason).toBe("no-book");
    expect(refreshed.message).toContain("作品目录");
  });
});

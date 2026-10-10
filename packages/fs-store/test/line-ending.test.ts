import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeBookData } from "../src/book-data.js";
import { bookMetaJson } from "../src/book-meta.js";
import { detectLineEnding, applyLineEnding, readDocFile, writeDocFile } from "../src/read-write.js";
import { makeFingerprint } from "../src/fingerprint.js";

/**
 * 扫描总单 P2-3：CRLF 静默改写正文。
 *
 * 【病是怎么来的】写作编辑器是 `<textarea :value>`（`DocumentPane.vue`）。浏览器给 textarea 赋值时
 * 会把 `\r\n` 归一成 `\n`（HTML 规范里的 value sanitization algorithm），所以一篇本来 CRLF 的稿子
 * 在界面上看到的是 LF；用户改一个字按保存，交回主进程的就是**整篇 LF** 的文本，
 * 于是盘上 diff 是「整篇重写」。跟着遭殃的是在途提案：它们存的是**改前的期望指纹**，
 * 而指纹算的是盘上那段字节 —— 行尾一换，指纹全变，用户看到的是
 * 「我明明只改了一句，为什么所有提案都过期了」。
 *
 * 【修法：保留原文行尾（总单里的①）】写盘前看**盘上这一篇**用的是哪种行尾，
 * 把正文换成同一种再落盘，而且**指纹必须对将要落盘的那份字节算**。
 * 判据只住在 `read-write.ts` 这一处（`detectLineEnding` / `applyLineEnding`），
 * 备份、改稿历史、回滚用的都是盘上原文，不需要第二份口径。
 */

let root = "";
const chapter = "chapters/01.md";

/** 读盘上的**字节**（不看任何归一后的版本）——这一组用例判的都是这个。 */
async function bytes(rel: string): Promise<string> {
  return readFile(path.join(root, rel), "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-eol-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
});

/** 模拟渲染层递来的正文：textarea 已经把 CRLF 归一成 LF 了（这就是这条病的源头）。 */
function asFromTextarea(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

describe("行尾判据（detectLineEnding / applyLineEnding）", () => {
  it("纯 LF ⇒ LF；纯 CRLF ⇒ CRLF", () => {
    expect(detectLineEnding("甲\n乙\n丙\n")).toBe("lf");
    expect(detectLineEnding("甲\r\n乙\r\n丙\r\n")).toBe("crlf");
  });

  it("混合行尾按**第一个**行结束符定调（现实里真会混，必须有确定答案）", () => {
    expect(detectLineEnding("甲\r\n乙\n丙")).toBe("crlf");
    expect(detectLineEnding("甲\n乙\r\n丙")).toBe("lf");
  });

  it("空文件 / 整篇没有换行：没有证据，按新稿的 LF 处理，绝不无中生有加 \\r", () => {
    expect(detectLineEnding("")).toBe("lf");
    expect(detectLineEnding("只有最后一行")).toBe("lf");
  });

  it("老 Mac 的单 \\r 行尾也认（保住它才算真的不改写正文）", () => {
    expect(detectLineEnding("甲\r乙\r")).toBe("cr");
  });

  it("applyLineEnding 先把任何行尾归一再换成目标，不会叠出 \\r\\r\\n", () => {
    expect(applyLineEnding("A\r\nB\nC\rD", "crlf")).toBe("A\r\nB\r\nC\r\nD");
    expect(applyLineEnding("A\r\nB\nC\rD", "lf")).toBe("A\nB\nC\nD");
    expect(applyLineEnding("A\r\nB\nC\rD", "cr")).toBe("A\rB\rC\rD");
  });
});

describe("CRLF 的稿子改一个字保存：整篇行尾不许被换掉", () => {
  it("纯 CRLF 原文 ⇒ 保存后盘上仍是 CRLF，没动过的那几行逐字节不变", async () => {
    const original = "第一章\r\n\r\n第一段原文。\r\n\r\n第二段原文。\r\n";
    await writeFile(path.join(root, chapter), original, "utf8");
    const read = await readDocFile(root, chapter);
    // 渲染层拿到的就是这段原文，进 textarea 出来时行尾已经被归一成 LF。
    const edited = asFromTextarea(read.content).replace("第二段原文。", "第二段改过。");
    expect(edited).toBe("第一章\n\n第一段原文。\n\n第二段改过。\n");

    const result = await writeDocFile(root, chapter, edited, read.fingerprint);
    expect(result.ok).toBe(true);

    const after = await bytes(chapter);
    // 本体：除了改的那一句，其余字节逐字相同（不是「整篇重写」）。
    expect(after).toBe("第一章\r\n\r\n第一段原文。\r\n\r\n第二段改过。\r\n");
    expect(after).not.toContain("\n\n");
  });

  it("纯 LF 原文 ⇒ 保存后仍是 LF（一个 \\r 都不许多出来）", async () => {
    const original = "第一章\n\n第一段原文。\n";
    await writeFile(path.join(root, chapter), original, "utf8");
    const read = await readDocFile(root, chapter);
    const result = await writeDocFile(
      root,
      chapter,
      read.content.replace("原文", "新文"),
      read.fingerprint
    );
    expect(result.ok).toBe(true);
    expect(await bytes(chapter)).toBe("第一章\n\n第一段新文。\n");
  });

  it("只打开不编辑就自动保存 ⇒ 盘上一字不变、也不留备份（原来这里会把整篇换成 LF）", async () => {
    const original = "第一章\r\n第二段\r\n";
    await writeFile(path.join(root, chapter), original, "utf8");
    const read = await readDocFile(root, chapter);
    const result = await writeDocFile(
      root,
      chapter,
      asFromTextarea(read.content),
      read.fingerprint
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该失败");
    expect(await bytes(chapter)).toBe(original);
    expect(result.backupRelPath).toBeNull();
    // 回报的指纹必须仍是盘上那份，否则下一笔保存会自撞 stale。
    expect(result.fingerprint).toBe(read.fingerprint);
  });

  it("混合行尾按首行结束符收口：CRLF 打头 ⇒ 整篇 CRLF；LF 打头 ⇒ 整篇 LF", async () => {
    await writeFile(path.join(root, chapter), "甲\r\n乙\n丙\r\n", "utf8");
    const crlfFirst = await readDocFile(root, chapter);
    expect(
      (await writeDocFile(root, chapter, asFromTextarea(crlfFirst.content), crlfFirst.fingerprint))
        .ok
    ).toBe(true);
    expect(await bytes(chapter)).toBe("甲\r\n乙\r\n丙\r\n");

    await writeFile(path.join(root, chapter), "甲\n乙\r\n丙", "utf8");
    const lfFirst = await readDocFile(root, chapter);
    expect(
      (await writeDocFile(root, chapter, asFromTextarea(lfFirst.content), lfFirst.fingerprint)).ok
    ).toBe(true);
    expect(await bytes(chapter)).toBe("甲\n乙\n丙");
  });

  it("空文件（0 字节）保存 ⇒ 新稿按 LF，不落 \\r", async () => {
    await writeFile(path.join(root, chapter), "", "utf8");
    const read = await readDocFile(root, chapter);
    const result = await writeDocFile(root, chapter, "新写的开头\r\n第二行\r\n", read.fingerprint);
    expect(result.ok).toBe(true);
    expect(await bytes(chapter)).toBe("新写的开头\n第二行\n");
  });

  it("新建一篇（盘上还没有）：内容里的 CRLF 收口成 LF，新稿统一一种行尾", async () => {
    const result = await writeDocFile(
      root,
      "chapters/09.md",
      "新章\r\n正文\r\n",
      makeFingerprint("")
    );
    expect(result.ok).toBe(true);
    expect(await bytes("chapters/09.md")).toBe("新章\n正文\n");
  });

  it("老 Mac 的单 \\r 稿子改一句 ⇒ 行尾仍是 \\r，没被换成 \\n", async () => {
    await writeFile(path.join(root, chapter), "甲\r乙\r", "utf8");
    const read = await readDocFile(root, chapter);
    const result = await writeDocFile(
      root,
      chapter,
      asFromTextarea(read.content) + "丙\n",
      read.fingerprint
    );
    expect(result.ok).toBe(true);
    expect(await bytes(chapter)).toBe("甲\r乙\r丙\r");
  });
});

describe("指纹必须对将要落盘的那份字节算（这一步最容易做错）", () => {
  it("writeDocFile 回报的指纹 === 盘上那段字节的指纹 === 下一次 readDocFile 的指纹", async () => {
    await writeFile(path.join(root, chapter), "第一章\r\n原\r\n", "utf8");
    const read = await readDocFile(root, chapter);
    const result = await writeDocFile(
      root,
      chapter,
      asFromTextarea(read.content).replace("原", "改"),
      read.fingerprint
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该失败");
    const onDisk = await bytes(chapter);
    expect(result.fingerprint).toBe(makeFingerprint(onDisk));
    expect((await readDocFile(root, chapter)).fingerprint).toBe(result.fingerprint);
  });

  it("拿保存后回报的指纹接着再存一次 ⇒ 不许报 stale（在途提案的期望指纹就是从这个来的）", async () => {
    await writeFile(path.join(root, chapter), "第一章\r\n原\r\n", "utf8");
    const read = await readDocFile(root, chapter);
    const first = await writeDocFile(root, chapter, "第一章\n改\n", read.fingerprint);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("第一次保存就该成");
    const second = await writeDocFile(root, chapter, "第一章\n再改\n", first.fingerprint);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`第二次保存自撞了 stale：${JSON.stringify(second)}`);
    expect(await bytes(chapter)).toBe("第一章\r\n再改\r\n");
  });

  it("备份存的是改前的盘上原文（CRLF 逐字保留），不是归一过的版本", async () => {
    const original = "第一章\r\n原稿\r\n";
    await writeFile(path.join(root, chapter), original, "utf8");
    const read = await readDocFile(root, chapter);
    const result = await writeDocFile(root, chapter, "第一章\n改稿\n", read.fingerprint);
    expect(result.ok).toBe(true);
    if (!result.ok || result.backupRelPath === null) throw new Error("备份路径不该为空");
    expect(await bytes(result.backupRelPath)).toBe(original);
  });

  it("期望指纹仍按盘上原文判：外部把文件换成 LF 版 ⇒ 照样报 stale（闸不许被行尾判据绕过）", async () => {
    await writeFile(path.join(root, chapter), "第一章\r\n原\r\n", "utf8");
    const read = await readDocFile(root, chapter);
    await writeFile(path.join(root, chapter), "第一章\n外部改过\n", "utf8");
    const result = await writeDocFile(root, chapter, "第一章\n覆盖\n", read.fingerprint);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("盘上内容变了必须报 stale");
    if (result.reason !== "stale") throw new Error(`必须报 stale，实际报了 ${result.reason}`);
    expect(result.currentFingerprint).toBe(makeFingerprint("第一章\n外部改过\n"));
  });
});

describe("JSON 写通路不受行尾保留影响（那是我们自己序列化的字节）", () => {
  it("writeBookData 原样落字节：递来的 \\r\\n 不许被换成 \\n", async () => {
    await mkdir(path.join(root, ".mochen", "data"), { recursive: true });
    const json = '{\r\n  "a": 1\r\n}\r\n';
    const result = await writeBookData(root, "notes", json);
    expect(result.ok).toBe(true);
    expect(await bytes(".mochen/data/notes.json")).toBe(json);
  });

  it("book.json 的形状由 bookMetaJson 一家定：LF 序列化，不带 \\r", () => {
    const json = bookMetaJson({
      id: "book_1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: "read-only",
      chapterOrder: []
    });
    expect(json).toContain("\n");
    expect(json).not.toContain("\r");
  });
});

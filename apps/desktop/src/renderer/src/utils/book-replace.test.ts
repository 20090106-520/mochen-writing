/**
 * 全书替换的「说人话」那一层（2026-10-15）。
 *
 * 这一层是这条链上唯一会骗人的地方：回执里 `replacedCount: 0` 与 `changedDocs: 3` 翻成人话之后
 * 若长得像，用户就会以为「换过了」。所以每一档话都钉一条用例，尤其是
 * 「一处都没命中」（info）与「改完了但有篇没动」（warning）不许混成同一句。
 */
import type { BookReplaceResult } from "@mochen/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookReplaceNotice, runBookReplace } from "./book-replace.js";

function done(
  partial: Partial<Extract<BookReplaceResult, { ok: true }>>
): Extract<BookReplaceResult, { ok: true }> {
  return { ok: true, scannedDocs: 100, changedDocs: 0, replacedCount: 0, skipped: [], ...partial };
}

describe("bookReplaceNotice", () => {
  it("主进程说失败就把那句原话端上来，不自己另编一句", () => {
    const notice = bookReplaceNotice(
      { ok: false, reason: "no-book", message: "尚未打开作品目录，全书替换没有可动的文稿。" },
      "小明",
      "阿明"
    );
    expect(notice).toEqual({
      level: "error",
      message: "尚未打开作品目录，全书替换没有可动的文稿。"
    });
  });

  it("一处都没命中：报 info，且说清「一个字都没动」——不能长得像换过了", () => {
    const notice = bookReplaceNotice(done({}), "小明", "阿明");
    expect(notice.level).toBe("info");
    expect(notice.message).toContain("全书 100 篇里没有「小明」");
    expect(notice.message).toContain("一个字都没动");
  });

  it("干净地改完：报 success，篇数/处数都是回执上的真数，并点明能回滚", () => {
    const notice = bookReplaceNotice(done({ changedDocs: 3, replacedCount: 7 }), "小明", "阿明");
    expect(notice.level).toBe("success");
    expect(notice.message).toContain("「小明」换成「阿明」");
    expect(notice.message).toContain("改了 3 篇、共 7 处");
    expect(notice.message).toContain("改稿历史");
  });

  it("留空＝删掉：话里说「删掉」，不是「换成（空）」", () => {
    const notice = bookReplaceNotice(done({ changedDocs: 2, replacedCount: 4 }), "小明", "");
    expect(notice.message).toContain("删掉「小明」");
    expect(notice.message).not.toContain("换成");
  });

  it("有篇没动就报 warning 并点名：改完了不等于每一篇都换成了", () => {
    const notice = bookReplaceNotice(
      done({
        changedDocs: 1,
        replacedCount: 2,
        skipped: [
          { relPath: "chapters/02.md", title: "第二章", reason: "stale", message: "没覆盖" }
        ]
      }),
      "小明",
      "阿明"
    );
    expect(notice.level).toBe("warning");
    expect(notice.message).toContain("有 1 篇没动");
    expect(notice.message).toContain("第二章（没覆盖）");
  });

  it("一处没命中但有篇读不下去：报 warning 并说明「那几篇没法确认」", () => {
    const notice = bookReplaceNotice(
      done({
        skipped: [
          { relPath: "chapters/02.md", title: "第二章", reason: "failed", message: "读不到" }
        ]
      }),
      "小明",
      "阿明"
    );
    expect(notice.level).toBe("warning");
    expect(notice.message).toContain("一个字都没动");
    expect(notice.message).toContain("没法确认有没有这一处");
  });
});

describe("runBookReplace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("IPC 本身抛错也回一个真结果：按钮等的是一个 result.ok，不是一次会把按钮悬死的异常", async () => {
    vi.stubGlobal("window", {
      mochen: {
        replaceAllInBook: () => Promise.reject(new Error("通道没注册"))
      }
    });
    const result = await runBookReplace({ query: "小明", replacement: "阿明" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("io-error");
    expect(result.ok === false && result.message).toContain("一个字都没动");
  });

  it("正常一趟：原样把主进程的回执交回去，不在这一层二次推断", async () => {
    const raw = done({ changedDocs: 1, replacedCount: 1 });
    vi.stubGlobal("window", { mochen: { replaceAllInBook: () => Promise.resolve(raw) } });
    await expect(runBookReplace({ query: "小明", replacement: "阿明" })).resolves.toBe(raw);
  });
});

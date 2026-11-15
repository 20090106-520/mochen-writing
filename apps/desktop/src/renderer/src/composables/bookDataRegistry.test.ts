import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bookDataFlushFailedKeys,
  bookDataFlushNotice,
  registerBookDataFlusher,
  resetBookDataFlushers,
  retryFailedBookData,
  withBookDataFlush
} from "./bookDataRegistry";

/**
 * 换书前那道闸门的两个门面（2026-10-09 扫描总单 P0-7）。
 *
 * `useBookStore.openBook()` / `createBook()` 这两条路都必须「先把设定交回**上一本**，再执行那次
 * 会换书的 IPC」——顺序反了，未落盘那一笔就顺着新书的根落进新书的文件里（还是串台）。
 * `withBookDataFlush` 把这个顺序收成一处的真身；`bookDataFlushNotice` 负责"没存好"那句话：
 * 闸门不许拦住换书（用户不能被上一本卡死在应用里），但必须点名是哪几份没落成。
 */

afterEach(() => {
  resetBookDataFlushers();
});

describe("withBookDataFlush", () => {
  it("先 flush 每一条通路，再执行换书那一次调用", async () => {
    const order: string[] = [];
    registerBookDataFlusher("notes", async () => {
      order.push("flush");
      return true;
    });
    const result = await withBookDataFlush(async () => {
      order.push("open");
      return "opened";
    });
    expect(order).toEqual(["flush", "open"]);
    expect(result).toBe("opened");
  });

  it("通路没落成也不拦换书：那一次调用照样执行、结果照样返回", async () => {
    registerBookDataFlusher("notes", async () => false);
    const call = vi.fn(async () => "opened");
    expect(await withBookDataFlush(call)).toBe("opened");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("那一次调用抛错时把错原样传出去（闸门不许替调用方吞掉换书失败）", async () => {
    registerBookDataFlusher("notes", async () => true);
    await expect(
      withBookDataFlush(async () => {
        throw new Error("目录不存在");
      })
    ).rejects.toThrow("目录不存在");
  });
});

describe("bookDataFlushNotice", () => {
  it("没有失败记录时基础提示一字不改", () => {
    expect(bookDataFlushNotice("新书已建好")).toBe("新书已建好");
  });

  it("有失败记录时点名是哪几份设定，而不是笼统一句「有问题」", async () => {
    registerBookDataFlusher("story-bible", async () => false);
    await withBookDataFlush(async () => "opened");
    const notice = bookDataFlushNotice("已打开《海雾手记》");
    expect(notice).toContain("已打开《海雾手记》");
    expect(notice).toContain("故事圣经");
    expect(notice).not.toContain("笔记");
  });

  it("下一次全落成就把上一次的失败记录清掉（旧话不许挂在屏上不走）", async () => {
    registerBookDataFlusher("notes", async () => false);
    await withBookDataFlush(async () => "opened");
    expect(bookDataFlushNotice("已打开")).not.toBe("已打开");
    resetBookDataFlushers();
    registerBookDataFlusher("notes", async () => true);
    await withBookDataFlush(async () => "opened");
    expect(bookDataFlushNotice("已打开")).toBe("已打开");
  });

  it("通路抛错等同于没落成：也要点名", async () => {
    registerBookDataFlusher("writing-goal", async () => {
      throw new Error("炸了");
    });
    await withBookDataFlush(async () => "opened");
    expect(bookDataFlushNotice("已打开")).toContain("写作目标");
  });
});

/**
 * 状态栏「查看 / 重试保存」（2026-11-15）。
 * 原先这里只报「没能全部存进它的目录」，用户既看不到是哪几份，也无从补救——
 * 提示变成墙上的一句话。失败清单改成响应式 ref 之后，重试成功要能把按钮一起收掉。
 */
describe("bookDataFlushFailedKeys 与 retryFailedBookData", () => {
  it("闸门跑完后，没落成的键以响应式清单给出", async () => {
    registerBookDataFlusher("notes", async () => false);
    registerBookDataFlusher("story-bible", async () => true);
    await withBookDataFlush(async () => "opened");
    expect(bookDataFlushFailedKeys.value).toEqual(["notes"]);
  });

  it("重试成功 ⇒ 回一句已补存，并清空失败清单（按钮随之收起）", async () => {
    let healthy = false;
    registerBookDataFlusher("notes", async () => healthy);
    await withBookDataFlush(async () => "opened");
    expect(bookDataFlushFailedKeys.value).toEqual(["notes"]);
    healthy = true;
    expect(await retryFailedBookData()).toContain("已补存");
    expect(bookDataFlushFailedKeys.value).toEqual([]);
  });

  it("重试仍失败 ⇒ 点名还差哪几份，清单保留让用户再试", async () => {
    registerBookDataFlusher("notes", async () => false);
    registerBookDataFlusher("writing-goal", async () => false);
    await withBookDataFlush(async () => "opened");
    const message = await retryFailedBookData();
    expect(message).toContain("笔记");
    expect(message).toContain("写作目标");
    expect(message).toContain("检查磁盘权限");
    expect(bookDataFlushFailedKeys.value).toHaveLength(2);
  });
});

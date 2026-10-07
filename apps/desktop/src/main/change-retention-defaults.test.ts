/**
 * 保留上限默认档的**跨包一致性**（2026-10-06 批次 5-⑧）。
 *
 * 为什么这条测试住在主进程而不留在 contracts：
 * `fs-store` 不能依赖 `contracts` 的运行时代码（包边界检查会拦），所以默认档那两个数字
 * **必然**在两个包里各有一份，而 contracts 的测试进程里 import 不到 fs-store。
 * 于是那一侧只能用「读源码 + 正则比对文本」的弱判据——prettier 折个行就假红，
 * 而且 fs-store 那行写的是 `32 * 1024 * 1024` 表达式，正则根本匹配不上数字。
 *
 * 主进程**两个包都能 import**（它是应用层，不是包），所以真正的比法放这里：
 * 直接比两个模块在运行期算出来的值。这比任何文本比对都强：它不在乎 prettier 怎么排版，
 * 也不在乎那个数是写成 `33554432` 还是 `32 * 1024 * 1024`。
 */
import { describe, expect, it } from "vitest";
import {
  CHANGE_KEEP_BYTES_MAX,
  CHANGE_KEEP_BYTES_MIN,
  CHANGE_KEEP_BYTES_PER_DOC,
  CHANGE_KEEP_COUNT_MAX,
  CHANGE_KEEP_COUNT_MIN,
  CHANGE_KEEP_PER_DOC,
  resolveRetention
} from "@mochen/fs-store";
import {
  CHANGE_RETENTION_COUNT_MAX,
  CHANGE_RETENTION_COUNT_MIN,
  CHANGE_RETENTION_MB_MAX,
  CHANGE_RETENTION_MB_MIN,
  DEFAULT_CHANGE_RETENTION,
  sanitizeChangeRetention
} from "@mochen/contracts";

describe("默认档：fs-store 与 contracts 必须是同一个值", () => {
  it("两个底层常量逐个等于 contracts 的默认档", () => {
    expect(CHANGE_KEEP_PER_DOC).toBe(DEFAULT_CHANGE_RETENTION.maxCount);
    expect(CHANGE_KEEP_BYTES_PER_DOC).toBe(DEFAULT_CHANGE_RETENTION.maxBytes);
  });

  it("取值范围的四个界逐个等于 contracts 那四个界", () => {
    expect(CHANGE_KEEP_COUNT_MIN).toBe(CHANGE_RETENTION_COUNT_MIN);
    expect(CHANGE_KEEP_COUNT_MAX).toBe(CHANGE_RETENTION_COUNT_MAX);
    expect(CHANGE_KEEP_BYTES_MIN).toBe(CHANGE_RETENTION_MB_MIN * 1024 * 1024);
    expect(CHANGE_KEEP_BYTES_MAX).toBe(CHANGE_RETENTION_MB_MAX * 1024 * 1024);
  });

  it("resolveRetention 不传东西时回的就是这一份", () => {
    expect(resolveRetention()).toEqual(DEFAULT_CHANGE_RETENTION);
    expect(resolveRetention(null)).toEqual(DEFAULT_CHANGE_RETENTION);
    expect(resolveRetention(undefined)).toEqual(DEFAULT_CHANGE_RETENTION);
  });

  it("resolveRetention 与 sanitizeChangeRetention 对同一份脏值给出同一个答案", () => {
    // 两个函数分住两个包（fs-store 不能依赖 contracts 的运行时代码），
    // 所以「坏值退回可用档」这条判定天然有两份实现。
    // 这条断言就是那个跨包复制必须的保险：同一个输入，两个包给出同一个结果。
    const dirties: unknown[] = [
      { maxCount: "很多", maxBytes: "一点" },
      { maxCount: -1, maxBytes: -1 },
      { maxCount: Number.NaN, maxBytes: Number.POSITIVE_INFINITY },
      { maxCount: 25.7, maxBytes: 12 * 1024 * 1024.4 },
      { maxCount: 0, maxBytes: 0 },
      { maxCount: 1, maxBytes: 1 },
      { maxCount: 10 ** 9, maxBytes: 10 ** 15 },
      "不是对象",
      null
    ];
    for (const dirty of dirties) {
      const viaFsStore = resolveRetention(dirty as Record<string, unknown>);
      const viaContracts = sanitizeChangeRetention(dirty);
      expect(viaFsStore.maxCount).toBe(viaContracts.maxCount);
      expect(viaFsStore.maxBytes).toBe(viaContracts.maxBytes);
    }
  });

  it("越界值在两边都被夹住（外侧那份不得放宽到全删光）", () => {
    // fs-store 那份如果只判 `> 0`，把 maxCount 递成 0 就会「全删光」；
    // 如果只判 `> 0` 而不夹下界，把 1 递进来会把这一篇砍到只剩 1 份。
    const zero = resolveRetention({ maxCount: 0, maxBytes: 0 });
    expect(zero.maxCount).toBe(CHANGE_RETENTION_COUNT_MIN);
    expect(zero.maxBytes).toBe(CHANGE_RETENTION_MB_MIN * 1024 * 1024);
    expect(sanitizeChangeRetention({ maxCount: 0, maxBytes: 0 })).toEqual(zero);
  });

  it("合法值在两边都原样通过（可配的上限真的能配出去，不是被悄悄夹回默认）", () => {
    const wanted = { maxCount: 10, maxBytes: 5 * 1024 * 1024 };
    expect(resolveRetention(wanted)).toEqual(wanted);
    expect(sanitizeChangeRetention(wanted)).toEqual(wanted);
  });
});

/**
 * 平台测试锚点的唯一一份实现（2026-10-13，第四十九节）。
 *
 * 起因是门面上那句「两枚 `it.skipIf(win32)`（`packages/fs-store/test/changes.test.ts` 的第 247 与
 * 302 行）」——它此刻是真的，但只真到今天：那两枚用例上面每插一条新用例，行号就整体下移，门面不会
 * 跟着动，读者按行号打开看到的是别的东西。要钉这件事，`readme-claims.test.mjs` 必然得再写一遍
 * 「什么算一枚 `skipIf(win32)`」；同一份判据有两处写法正是本仓那条锁定前提（枚举与映射只许一份实现）
 * 反复拦住的东西。所以锚点、被点名文件的相对路径、逐行扫描全都只写在这里，两边各 import 一份：
 * `platform-test-count.test.mjs` 数条数，核对行号的那道闸从 2026-10-14 第五十九节起住在
 * `readme-provenance.test.mjs`（它原先在 `readme-claims.test.mjs`，那一刀把出处那一族整族搬走了）。
 *
 * 另一个刻意的设计是 `LINE_ANCHORS`：门面能按行号点名的文件必须同时在这里登记锚点。没登记的文件被
 * 门面点名时守卫**直接红**，而不是「找不到判据就跳过」——后者等于给门面开了一条「写行号不需要负责」的通路。
 */

export const PLATFORM_IF = 'if (process.platform === "win32") {';

/**
 * 非 `g` 版用于逐行匹配与 `expect().toMatch()`，`g` 版从它的 `source` 派生：两枚必须认同一个东西。
 * 手抄第二份的话，一旦其中一枚被改窄（比如漏掉反斜杠转义），「数条数」与「报行号」就会各自漂移，
 * 而两处看着都自洽。
 */
export const SKIP_IF_WIN32_T = /it\.skipIf\(process\.platform === "win32"\)/;
export const SKIP_IF_WIN32_G = new RegExp(SKIP_IF_WIN32_T.source, "g");

export const PATH_BOUNDARY_TEST = "packages/fs-store/test/path-boundary.test.ts";
export const CHANGES_TEST = "packages/fs-store/test/changes.test.ts";

/** 门面可按行号点名的文件 → 那一行必须含的锚点。新增点名要来这里登记。 */
export const LINE_ANCHORS = {
  [CHANGES_TEST]: SKIP_IF_WIN32_T
};

/**
 * 逐行找锚点，返回 1 基行号。同一行出现两处锚点则重复两次，以保证「行号列表长度」与
 * 全文 `matchAll` 数出来的枚数是同一个数。
 */
export function linesWith(source, anchor) {
  const g = new RegExp(anchor.source, "g");
  const out = [];
  source.split("\n").forEach((line, i) => {
    const hits = [...line.matchAll(g)];
    for (let k = 0; k < hits.length; k++) out.push(i + 1);
  });
  return out;
}

/** `changes.test.ts` 里「POSIX 才真跑」的那些行（1 基）。 */
export const skipIfWin32Lines = (source) => linesWith(source, SKIP_IF_WIN32_T);

/** 条数由行号列表派生，不另写一遍匹配逻辑——否则「条数」和「行号」会各自漂移。 */
export const countSkipIfWin32 = (source) => skipIfWin32Lines(source).length;

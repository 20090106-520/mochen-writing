import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANGES_TEST,
  PATH_BOUNDARY_TEST,
  PLATFORM_IF,
  countSkipIfWin32
} from "./platform-anchors.mjs";

/**
 * 平台分支的用例计数守卫（2026-10-13）。
 *
 * 病灶不是代码，是**报数**：台账第三十五节记下「CI 的 Vitest 摘要六个 run 都是 312 文件 / 4100 passes，
 * 本机同一棵树报 4101 passed | 2 skipped」，两个数当时看着像有一边在撒谎。第三十六节把它算清了——
 * 两边都没错，差在全仓只有两处会**按平台改变注册条数**：
 *
 * - `packages/fs-store/test/path-boundary.test.ts` 的 `if (win32) { 4 条 } else { 1 条 }` ⇒ Windows 多 3 条；
 * - `packages/fs-store/test/changes.test.ts` 的 2 条 `it.skipIf(win32)` ⇒ 那 2 条在 Windows 算 skipped、在 Linux 算 passed。
 *
 * 于是 `4103 − 3 = 4100`，本机比 CI 多的那 1 条 passed 正好是 `3 − 2`。
 * 这件事现在只有散文记着：**下一次有人在那两个 `if` 里加一条用例、或把一枚 `skipIf` 摘掉，
 * 报数就会换个数字回来，而没人知道它是几**——所以把它钉成断言。
 *
 * 断言的是**差值**而不是绝对总数，加别的用例不会误伤；改平台分支必须同批改这里。
 * 三段提取各自带「提取到东西没有」的自我声明，且锚点（那句 `if (process.platform === "win32")`）
 * 一旦改名就直接抛错：守卫宁可当场炸，也不空跑装绿。
 *
 * 2026-10-13（第四十九节）锚点、`skipIf` 判据与被点名的文件路径搬到 `tools/platform-anchors.mjs`：
 * 门面那份行号闸要用同一个判据，两处各写一份就是本仓那条锁定前提（枚举与映射只许一份实现）拦的事。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** 数一段源码里**行首**的 `it(`（注释与内联文本里的 `it(` 不算）。 */
function countIt(source) {
  return [...source.matchAll(/^\s*it\(/gm)].length;
}

/**
 * 从 `PLATFORM_IF` 的花括号走到它自己的收尾，返回 win32 分支与 else 分支两段原文。
 * 关键在 `} else {` 那一枚 `}`：**它把 win32 分支的深度压回 0，但整个语句还没结束**，
 * 所以匹配到 else 时要把深度重新按 1 记下去，继续走到 else 分支自己的 `}` 才算收尾。
 * 第一版没做这一步，else 分支被当成不存在（提取到 0 条），守卫自己红了——那正是它该红的形状。
 */
function splitPlatformBranch(source, rel) {
  const anchor = source.indexOf(PLATFORM_IF);
  if (anchor < 0) {
    throw new Error(
      `${rel} 里找不到锚点 \`${PLATFORM_IF}\`——平台分支被改名或换写法了，` +
        "本守卫的差值算式（win32 分支 − else 分支 − skipIf 数）不再成立，必须连这份文件一起改"
    );
  }
  const winStart = anchor + PLATFORM_IF.length;
  let depth = 1;
  let elseAt = -1;
  let closeAt = -1;
  for (let i = winStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch !== "}") continue;
    depth--;
    if (depth > 0) continue;
    // 深度归零的这一枚 `}`：要么是整个语句的收尾，要么是 win32 分支的收尾后面跟着 ` else {`。
    const tail = source.slice(i, i + 12);
    if (elseAt < 0 && /^\}\s*else\s*\{/.test(tail)) {
      elseAt = i;
      depth = 1; // `else {` 重新开一层，走到它自己的 `}` 才是 closeAt
      i += tail.indexOf("{"); // 让下一次迭代正好落在 `{` 之后，这一层不再重复计数
      continue;
    }
    closeAt = i;
    break;
  }
  if (closeAt < 0) throw new Error(`${rel} 的平台分支没走到收尾，花括号配对失败`);
  if (elseAt < 0) return { win: source.slice(winStart, closeAt), posix: "" };
  return {
    win: source.slice(winStart, elseAt),
    posix: source.slice(elseAt, closeAt)
  };
}

const boundary = read(PATH_BOUNDARY_TEST);
const changes = read(CHANGES_TEST);
const branches = splitPlatformBranch(boundary, PATH_BOUNDARY_TEST);
const winIt = countIt(branches.win);
const posixIt = countIt(branches.posix);
const skipWin32 = countSkipIfWin32(changes);

/** 全仓「注册期平台分支」的出处 census：现在是这两个文件，第三个出现时必须先想起来这里改数。 */
function filesWithPlatformIf() {
  const dir = "packages/fs-store/test";
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => read(`${dir}/${f}`).includes(PLATFORM_IF))
    .sort();
}

test("提取到的确实是那两处平台分支（否则本守卫只剩自我声明）", () => {
  expect(winIt, "win32 分支里一条 `it(` 都没提取到——多半是行走的括号配对写坏了").toBeGreaterThan(0);
  expect(posixIt, "else 分支里一条 `it(` 都没提取到——同上").toBeGreaterThan(0);
  expect(
    skipWin32,
    "`changes.test.ts` 里没提取到 `it.skipIf(win32)`——被摘干净了就到这里来改数"
  ).toBeGreaterThan(0);
});

test("path-boundary 的两个平台分支：win32 比 POSIX 多 3 条", () => {
  expect(
    winIt - posixIt,
    `平台分支注册数差成 ${winIt} − ${posixIt} = ${winIt - posixIt} 了。这一差直接决定 ` +
      "`pnpm test` 在 Windows 与 Linux runner 上各报多少条：本机 passed 会比 CI 多「差值 − skipIf 数」，" +
      "台账第三十六节那格算式（4103 − 3 = 4100）要同批改"
  ).toBe(3);
});

test("changes.test.ts 里「POSIX 才真跑」的软链用例是 2 条", () => {
  expect(
    skipWin32,
    `\`it.skipIf(win32)\` 现在是 ${skipWin32} 条。它们在本机进 skipped、在 Linux 进 passed，` +
      "所以 skipIf 数变化会让两侧报数同时漂移——台账第三十六节的 +2 要同批改"
  ).toBe(2);
});

test("两侧报数的差：本机 passed 比 Linux runner 多 1 条", () => {
  const delta = winIt - posixIt - skipWin32;
  expect(
    delta,
    `本机（win32）的 passed 相对 Linux runner 的 passed 差 ${delta} 条，不再是 1 条。` +
      "这正是第三十五节里 CI 4100 与本机 4101 那格 ±1 的来源；数字变了就必须同改台账与门面 README 的报数口径"
  ).toBe(1);
});

test("全仓「注册期平台分支」的出处只有台账记下的那两个文件", () => {
  const found = filesWithPlatformIf();
  expect(
    found,
    '出现了第三处 `if (process.platform === "win32") {`。先判断它是**注册期分叉**（里面写 `it(`，会改变两侧总数）' +
      "还是**用例体内的分支**（像 write-queue.test.ts 那样只改断言，不改变总数）：前者要把差值算进上面的断言，" +
      "后者在这里登记一句「不计数」。已知两处：changes/path-boundary 由上面三份断言覆盖，write-queue 属于不计数那一档"
  ).toEqual(["path-boundary.test.ts", "write-queue.test.ts"]);
});

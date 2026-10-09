import { describe, expect, it } from "vitest";
// 主进程 tsconfig 走 node16 解析：跨文件 import 必须带显式扩展名。
import { createBookScope, scopedApprovalKey } from "./book-scope.js";

/**
 * 自动批准判据的键（P0-4）。
 *
 * 【为什么要单独钉这一层】「本会话自动批准 / 同文档同类改动不再问」这两张表过去只按
 * 文稿相对路径（`docRelPath` / `threadKey`）建键。两本书里只要有**同名文稿**——而新建章节
 * 的默认标题极易撞——A 书点过一次「接受并本会话自动批准」，B 书的提案就不问自落。
 * 修法是把「书根目录」并进判据键，而这件事**只许有一处实现**（铁律 6）：
 * 于是把「怎么把书身份并进本地判别式」收在 `scopedApprovalKey` 一份里，
 * 这个测试钉的就是它，别处不许各写一份拼装口径。
 *
 * 三条反向约束必须钉死：
 * ① 不同书根 + 同一本地判别式 ⇒ 键不同（跨书不会互相命中）；
 * ② 同一书根 + 同一本地判别式 ⇒ 键相同（同书内正常命中）；
 * ③ 书根取不到（null）⇒ 返回 null，调用方据此**永不命中**自动批准，保守回落到人工确认。
 */
describe("自动批准判据的键：书根目录并入本地判别式（单一真身）", () => {
  it("同一书根、同一本地判别式 ⇒ 键相同（同书内命中）", () => {
    const a = scopedApprovalKey("/books/deep", "chapters/01-开局.md::propose_patch");
    const b = scopedApprovalKey("/books/deep", "chapters/01-开局.md::propose_patch");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("不同书根、同一本地判别式 ⇒ 键不同（跨书不命中，正是 P0-4 的那一刀）", () => {
    const first = scopedApprovalKey("/books/a", "chapters/01-开局.md::propose_patch");
    const second = scopedApprovalKey("/books/b", "chapters/01-开局.md::propose_patch");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it("拿不到书根 ⇒ null：调用方据此保守拒绝自动批准，禁止放行", () => {
    expect(scopedApprovalKey(null, "chapters/01-开局.md::propose_patch")).toBeNull();
    expect(scopedApprovalKey(null, "unbound")).toBeNull();
  });

  it("分隔符不许被路径自身复现：书根里含分隔串也不能拼出同键", () => {
    // 若用 `::` 这类会出现在路径/判别式里的字符当连接符，下面两组的键就会撞车，
    // 于是 A 书的授权会命中 B 书——正是本次要堵的跨书泄漏的另一种形态。
    const x = scopedApprovalKey("/root", "a::b::propose_patch");
    const y = scopedApprovalKey("/root/a::b", "propose_patch");
    expect(x).not.toBe(y);
  });
});

/**
 * createBookScope 的复位闸：作用域一变就 clear，同作用域内 sync 是空操作。
 * 这几条不是新行为，而是把「自动批准表要跟着一起清」这件事的前提钉住——
 * agent-service 只有把 autoSession/autoDocTool 也交给这个 clear，换书/关书才不会留旧规则。
 */
describe("createBookScope：作用域变化即清空", () => {
  it("换书根触发一次 clear，同一书根内 sync 不再重复清", () => {
    let clears = 0;
    let root: string | null = "/books/a";
    const scope = createBookScope(
      () => root,
      () => {
        clears += 1;
      }
    );
    scope.sync(); // 初值 null → /books/a：清一次（空表本来就是空操作）
    expect(clears).toBe(1);
    scope.sync(); // 仍是 /books/a：不重复清
    expect(clears).toBe(1);
    root = "/books/b";
    scope.sync(); // 换书：再清一次
    expect(clears).toBe(2);
    root = null;
    scope.sync(); // 关书：也算作用域变化，再清一次
    expect(clears).toBe(3);
  });

  it("reset 复位作用域并清空（退出时不留半张表）", () => {
    let clears = 0;
    const scope = createBookScope(
      () => "/books/a",
      () => {
        clears += 1;
      }
    );
    scope.sync();
    scope.sync();
    const before = clears;
    scope.reset();
    expect(clears).toBe(before + 1);
  });
});

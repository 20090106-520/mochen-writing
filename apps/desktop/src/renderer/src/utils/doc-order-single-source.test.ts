// P1-4 后半（2026-10-10）的另一半：渲染层这份 `sortDocsByOrder` 也必须只是 contracts `sortDocs`
// 的别名，不是第二份判据。
//
// 【这一条改的是渲染层的真实行为，写清楚】过去的 `sortDocsByOrder` 对「都不在 chapterOrder 里的
// 两篇」返回 0（保持传进来的相对次序），`doc-order.ts:8-10` 当时的理由是「渲染层不许 import
// fs-store，合并等于把浏览器 bundle 拖上 Node」——那条边界理由是成立的，被解决的不是它，
// 而是「两份判据必须各留一处」这个隐含前提：判据搬到 contracts（无 Node 依赖、两边都进得来）之后，
// 边界仍然守得住，判据却只剩一份。
//
// 行为上的变化只有一档：未登记的稿件现在按 `relPath` 名字序（zh-CN 拼音）排，而不是按来路顺序。
// 这正是「增量拼接 === 整本重扫」得以成立的前提，也是本文件第三条钉的东西。
import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { sortDocs } from "@mochen/contracts";
import { sortDocsByOrder } from "./doc-order";

const doc = (relPath: string): DocRef => ({ relPath, kind: "chapter", title: relPath });

describe("sortDocsByOrder 只是 contracts 那份判据的别名（判据只有一份，铁律 6）", () => {
  it("引用相等：渲染层里没有第二段排序逻辑", () => {
    expect(sortDocsByOrder).toBe(sortDocs);
  });

  it("主进程与渲染层对同一批稿件、同一份次序表得到同一个顺序", () => {
    const 稿件 = [doc("characters/李深.md"), doc("chapters/02.md"), doc("chapters/01.md")];
    const 次序 = ["chapters/02.md"];
    expect(sortDocsByOrder(稿件, 次序).map((item) => item.relPath)).toEqual(
      sortDocs(稿件, 次序).map((item) => item.relPath)
    );
  });

  it("未登记的两篇按名字序落位，不再按来路顺序——增量拼接与整本重扫因此才等价", () => {
    const 整本重扫 = [doc("chapters/01.md"), doc("chapters/09-新章.md")];
    // 增量拼接那条通路是「老列表 + 新那篇贴在末尾」，来路顺序与上面相反。
    const 增量拼接 = [doc("chapters/09-新章.md"), doc("chapters/01.md")];
    expect(sortDocsByOrder(增量拼接, []).map((item) => item.relPath)).toEqual(
      整本重扫.map((item) => item.relPath)
    );
  });
});

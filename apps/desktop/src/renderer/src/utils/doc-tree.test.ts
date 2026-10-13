// P1-4 后半（2026-10-10）：省掉「建完一章把整本书再读一遍」那一次重扫的唯一通路，是主进程把
// 新那一篇的 `DocRef` 随 `doc:create` 一起带回来，渲染层本地拼进树。
// 本文件钉的是拼进去之后的**树必须与整本重扫等价**，以及跨进程字段不可信时不许硬拼。
//
// 【为什么判据一条都不许写在这儿】排序走 contracts 的 `sortDocs`（`test/sort-docs.test.ts` 钉语义），
// 形状走 contracts 的 `docRefSchema`——渲染层再写一遍「怎么去重」「怎么落位」就是第二份判据（铁律 6），
// 而 P1-4 病根恰恰是「两份判据各说各话」。所以这里只做三件事：认形状、认是不是我们要的那一篇、拼。
//
// 【为什么 `doc` 一律当不可信】它是跨进程来的字段，渲染层从来没见过它的生产端。
// 仓里同一条规矩的先例是 `main/quit-flush.ts`：跨进程字段先验形状，认不出来就按没发生过处理。
// 这里「认不出来」的处理不是沉默，而是退回整本重扫——慢，但屏上那一格一定是盘上真身。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocRefreshResult, DocRef } from "@mochen/contracts";
import { applyDocRef, refreshDocRef, syncDocRef, type DocTreeBook } from "./doc-tree";

const doc = (relPath: string, title = relPath): DocRef => ({
  relPath,
  kind: "chapter",
  title,
  excerpt: "",
  chars: 0
});

const 已有 = [doc("chapters/01-开局.md", "开局"), doc("chapters/03-潮线.md", "潮线")];

describe("applyDocRef：把主进程带回的那一篇拼进树", () => {
  it("形状对、且正是我们要建的那一篇：新数组含它，位置由 sortDocs 决定（不是贴末尾）", () => {
    const next = applyDocRef(
      已有,
      ["chapters/03-潮线.md"],
      doc("chapters/02-新章.md"),
      "chapters/02-新章.md"
    );
    expect(next?.map((item) => item.relPath)).toEqual([
      "chapters/03-潮线.md",
      "chapters/01-开局.md",
      "chapters/02-新章.md"
    ]);
    // 反向鉴别：写成「贴末尾」会给 [...已有, 新章] ⇒ 02 排在 03 后面，这条当场红。
    expect(next?.[2]?.title).toBe("chapters/02-新章.md");
  });

  it("同 relPath 已经在树里（外力删过又建回）：以新值替换，绝不出现两条同名", () => {
    const next = applyDocRef(
      已有,
      [],
      doc("chapters/01-开局.md", "开局（重写）"),
      "chapters/01-开局.md"
    );
    expect(next?.map((item) => item.relPath)).toEqual([
      "chapters/01-开局.md",
      "chapters/03-潮线.md"
    ]);
    expect(next?.[0]?.title).toBe("开局（重写）");
  });

  it("不许就地改动传进来的 docs：那一格被 Vue 响应式包着", () => {
    const snapshot = 已有.map((item) => item.relPath);
    applyDocRef(已有, [], doc("chapters/00-序章.md"), "chapters/00-序章.md");
    expect(已有.map((item) => item.relPath)).toEqual(snapshot);
    expect(已有).toHaveLength(2);
  });

  it("主进程没带 doc 回来：null，调用方退回整本重扫（不拿请求里的路径倒推一个假 DocRef）", () => {
    expect(applyDocRef(已有, [], undefined, "chapters/02-新章.md")).toBeNull();
    expect(applyDocRef(已有, [], null, "chapters/02-新章.md")).toBeNull();
  });

  it("doc 形状不对（kind 不在表里 / relPath 空 / title 不是文本）：一律 null", () => {
    for (const bad of [
      { relPath: "chapters/02-新章.md", kind: "nonsense", title: "新章" },
      { relPath: "", kind: "chapter", title: "新章" },
      { relPath: "chapters/02-新章.md", kind: "chapter", title: 42 },
      { relPath: "chapters/02-新章.md", kind: "chapter" },
      "chapters/02-新章.md",
      [],
      null
    ]) {
      expect(
        applyDocRef(已有, [], bad, "chapters/02-新章.md"),
        `收到的不是那一形状：${String(bad)}`
      ).toBeNull();
    }
  });

  it("带回来的竟是别的一篇（跨进程字段与请求对不上）：null，不把别人的稿件挂到刚建的标题下", () => {
    expect(applyDocRef(已有, [], doc("characters/李深.md"), "chapters/02-新章.md")).toBeNull();
  });

  it("次序表递 undefined（书还没开完）：照拼，未登记的按名字序落位", () => {
    const next = applyDocRef(已有, undefined, doc("chapters/02-新章.md"), "chapters/02-新章.md");
    expect(next?.map((item) => item.relPath)).toEqual([
      "chapters/01-开局.md",
      "chapters/02-新章.md",
      "chapters/03-潮线.md"
    ]);
  });
});

// ---- 三个调用点共用的那一个分支：拼得进就不重扫，拼不进才重扫 ------------------------------------
// 建章、改标题、吸收智能体写入过去各写一遍「await this.refreshDocs()」，于是三处都把整本书读一遍。
// 现在三处都走这里：能落进树就到此为止（零次整本读盘），落不进（跨进程字段认不出、主进程说算不出）
// 才退回那一次温和重扫。分支只写一遍，是为了不让「什么时候该重扫」长出第二份口径。
describe("syncDocRef / refreshDocRef：落不进树才退回整本温和重扫", () => {
  /** 最小书档假身：`refreshDocs` 就是那一次整本重扫，被点到几次这里答几次。 */
  function book(docs: DocRef[]): DocTreeBook {
    const target: DocTreeBook = {
      docs,
      meta: { chapterOrder: ["chapters/03-潮线.md"] },
      refreshDocs: vi.fn(async () => {
        target.docs = [...docs, doc("chapters/02-新章.md", "新章（整本重扫读回的）")];
      })
    };
    return target;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("带回来的 doc 认得出：树换新，refreshDocs 一次都没被打到（这一刀省的就是它）", async () => {
    const target = book([...已有]);
    await syncDocRef(target, "chapters/02-新章.md", doc("chapters/02-新章.md", "新章"));
    expect(target.docs.map((item) => item.relPath)).toEqual([
      "chapters/03-潮线.md",
      "chapters/01-开局.md",
      "chapters/02-新章.md"
    ]);
    expect(target.docs[2]?.title).toBe("新章");
    expect(target.refreshDocs).not.toHaveBeenCalled();
  });

  it("doc 认不出来（null / 形状不对 / 不是那一篇）：退回整本温和重扫，屏上挂的是重扫读回的", async () => {
    for (const raw of [null, undefined, { relPath: "别的.md", kind: "chapter", title: "别的" }]) {
      const target = book([...已有]);
      await syncDocRef(target, "chapters/02-新章.md", raw);
      expect(target.refreshDocs, `收到 ${String(raw)} 该重扫一次`).toHaveBeenCalledTimes(1);
      expect(target.docs.map((item) => item.relPath)).toContain("chapters/02-新章.md");
      // 倒推的成品（标题就用请求里的路径）不许出现在屏上：只有重扫读回的那一根才算数。
      expect(target.docs[2]?.title).toBe("新章（整本重扫读回的）");
    }
  });

  it("refreshDocRef：把 relPath 原样递给 doc:refresh，拿回来的那根落进树", async () => {
    const refreshDoc = vi.fn(async (): Promise<DocRefreshResult> => ({
      ok: true,
      doc: doc("chapters/01-开局.md", "开局（改名后）")
    }));
    vi.stubGlobal("window", { mochen: { refreshDoc } });
    const target = book([...已有]);
    await refreshDocRef(target, "chapters/01-开局.md");
    expect(refreshDoc).toHaveBeenCalledWith("chapters/01-开局.md");
    expect(target.refreshDocs).not.toHaveBeenCalled();
    // 同一篇换掉了，不出现两条；顺序仍由 chapterOrder + 名字序决定（与整本重扫等价）。
    expect(target.docs.map((item) => item.relPath)).toEqual([
      "chapters/03-潮线.md",
      "chapters/01-开局.md"
    ]);
    expect(target.docs[1]?.title).toBe("开局（改名后）");
  });

  it("refreshDocRef：主进程回 ok:false 时不硬拼，退回整本温和重扫", async () => {
    // 失败回话按契约没有 doc 这一枚；这里故意塞一根**形状完全合法**的进去，
    // 是因为「只认 ok 标志」这条判据必须能被证明有效：如果代码是「有 doc 就拼」，
    // 塞进来的这根会顺利上屏，用例当场红。主进程说没算成，那根东西盘上就没有，
    // 屏上挂它等于把「界面有这一章」和「盘上有这一章」分家（P0 那一批钉过的病）。
    const decoy = doc("chapters/01-开局.md", "开局（失败回话里塞来的）");
    vi.stubGlobal("window", {
      mochen: {
        refreshDoc: vi.fn(
          async (): Promise<DocRefreshResult> =>
            ({
              ok: false,
              reason: "no-book",
              message: "还没打开作品目录，重算不了这一篇。",
              doc: decoy
            }) as unknown as DocRefreshResult
        )
      }
    });
    const target = book([...已有]);
    await refreshDocRef(target, "chapters/01-开局.md");
    expect(target.refreshDocs).toHaveBeenCalledTimes(1);
    expect(target.docs.map((item) => item.title)).not.toContain(decoy.title);
  });

  it("refreshDocRef：回话里 ok:true 但 doc 是 null（盘上没这篇）也退回重扫，不挂空", async () => {
    vi.stubGlobal("window", {
      mochen: {
        refreshDoc: vi.fn(async (): Promise<DocRefreshResult> => ({ ok: true, doc: null }))
      }
    });
    const target = book([...已有]);
    await refreshDocRef(target, "chapters/01-开局.md");
    expect(target.refreshDocs).toHaveBeenCalledTimes(1);
  });

  it("refreshDocRef：doc:refresh 抛错（主进程边界拒绝）也照实上抛，不在这里静默吞", async () => {
    vi.stubGlobal("window", {
      mochen: {
        refreshDoc: vi.fn(async () => {
          throw new Error("被来源闸挡下");
        })
      }
    });
    const target = book([...已有]);
    await expect(refreshDocRef(target, "chapters/01-开局.md")).rejects.toThrow("被来源闸挡下");
    expect(target.refreshDocs).not.toHaveBeenCalled();
  });
});

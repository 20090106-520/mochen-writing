import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BookOpenResult, DocWriteResult, RendererApi } from "@abyss/contracts";
import { useBookStore } from "./useBookStore";

const result: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "read-only",
    chapterOrder: ["chapters/01-a.md"]
  },
  docs: [
    { relPath: "chapters/01-a.md", kind: "chapter", title: "开局" },
    { relPath: "materials/雾.md", kind: "material", title: "雾" }
  ]
};

const readDoc = vi.fn(async (relPath: string) => ({
  relPath,
  content: "正文\n",
  fingerprint: "fp-a"
}));
const writeDoc = vi.fn(async (): Promise<DocWriteResult> => ({
  ok: false,
  reason: "stale",
  currentFingerprint: "fp-x"
}));
const pickBookDirectory = vi.fn(async (): Promise<string | null> => "/book");
const api = {
  pickBookDirectory,
  openBook: vi.fn(async () => result),
  saveMeta: vi.fn(async () => {}),
  readDoc,
  writeDoc
} satisfies RendererApi;

function docReads() {
  return readDoc.mock.calls.filter((call) => call[0] === "chapters/01-a.md").length;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { abyss: api });
  readDoc.mockClear();
  writeDoc.mockClear();
});

describe("useBookStore", () => {
  it("打开文稿标签后草稿与指纹一起就位", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.draft).toBe("正文\n");
    expect(store.savedFingerprint).toBe("fp-a");
    expect(store.dirty).toBe(false);
  });

  it("浏览素材不打断当前文稿：标签、活动章、草稿都不变", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    const before = { tabs: [...store.docTabs], active: store.activeDocTab, draft: store.draft };
    store.browse(result.docs[1]!);
    expect(store.browseTabs.map((d) => d.relPath)).toEqual(["materials/雾.md"]);
    expect(store.docTabs).toEqual(before.tabs);
    expect(store.activeDocTab).toBe(before.active);
    expect(store.draft).toBe(before.draft);
    expect(store.savedFingerprint).toBe("fp-a");
    expect(docReads()).toBe(1);
  });

  it("指纹过期时报冲突、不改草稿、不更新已存指纹", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("我改的\n");
    await store.saveActive();
    expect(store.conflict?.currentFingerprint).toBe("fp-x");
    expect(store.draft).toBe("我改的\n");
    expect(store.savedFingerprint).toBe("fp-a");
    expect(store.notice).toContain("已拒绝覆盖");
  });

  it("保存成功后写入新指纹并清冲突", async () => {
    writeDoc.mockResolvedValueOnce({
      ok: true,
      fingerprint: "fp-b",
      backupRelPath: ".abyss/changes/x/01-a.md.bak"
    });
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("新稿\n");
    expect(store.dirty).toBe(true);
    await store.saveActive();
    expect(store.savedFingerprint).toBe("fp-b");
    expect(store.dirty).toBe(false);
    expect(store.notice).toContain("原稿已备份");
  });

  it("reloadActive 用盘上内容覆盖草稿并清冲突", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.saveActive();
    readDoc.mockResolvedValueOnce({
      relPath: "chapters/01-a.md",
      content: "盘上的\n",
      fingerprint: "fp-x"
    });
    await store.reloadActive();
    expect(store.draft).toBe("盘上的\n");
    expect(store.savedFingerprint).toBe("fp-x");
    expect(store.conflict).toBeNull();
  });

  it("点素材把右栏切到浏览，但文稿标签与草稿一字不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    expect(store.rightPaneMode).toBe("manuscript");
    store.browse(result.docs[1]!);
    expect(store.rightPaneMode).toBe("browse");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("正文\n");
  });

  it("再点章节把右栏切回文稿，浏览标签仍留着", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    store.browse(result.docs[1]!);
    await store.openDocTab("chapters/01-a.md");
    expect(store.rightPaneMode).toBe("manuscript");
    expect(store.browseTabs.map((d) => d.relPath)).toEqual(["materials/雾.md"]);
  });

  it("切换文稿标签不丢未保存草稿，切回来仍是原来的字", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("没保存的想法\n");
    await store.openDocTab("chapters/02-b.md");
    expect(store.draft).toBe("正文\n");
    await store.openDocTab("chapters/01-a.md");
    expect(store.draft).toBe("没保存的想法\n");
    expect(store.savedFingerprint).toBe("fp-a");
    expect(store.dirty).toBe(true);
    expect(docReads()).toBe(1);
  });

  it("关闭活动标签回落到相邻标签，关到空则清草稿", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("chapters/02-b.md");
    store.closeTab("chapters/02-b.md");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    store.closeTab("chapters/01-a.md");
    expect(store.docTabs).toEqual([]);
    expect(store.activeDocTab).toBeNull();
    expect(store.draft).toBe("");
    expect(store.savedFingerprint).toBe("");
  });

  it("选中目录时按该目录开书", async () => {
    const store = useBookStore();
    await store.pickAndOpen();
    expect(api.openBook).toHaveBeenCalledWith("/book");
    expect(store.rootPath).toBe("/book");
  });

  it("取消选择时不开书、已打开的作品与草稿一概不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("写了一半\n");
    api.openBook.mockClear();
    pickBookDirectory.mockResolvedValueOnce(null);
    await store.pickAndOpen();
    expect(api.openBook).not.toHaveBeenCalled();
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("写了一半\n");
    expect(store.dirty).toBe(true);
  });
});

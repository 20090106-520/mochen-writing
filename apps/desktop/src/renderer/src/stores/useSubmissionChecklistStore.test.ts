import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DEFAULT_PERMISSION_MODE } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";
import { useSubmissionChecklistStore } from "./useSubmissionChecklistStore";

const A = "chapters/01-开局.md";
const B = "chapters/02-潮信.md";
const DRAFT_A = "第一行。\n值得注意的是，他走了。\n";
const DRAFT_B = "值得注意的是，潮信来了。\n";

/** 让微任务跑几轮，但**不**放行挂起的那次。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", {
    mochen: {
      readDoc: async (relPath: string) => ({ relPath, content: "", fingerprint: "" })
    }
  });
  const book = useBookStore();
  book.meta = {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: [A, B]
  };
  book.docs = [
    { relPath: A, kind: "chapter" as const, title: "开局" },
    { relPath: B, kind: "chapter" as const, title: "潮信" }
  ];
  book.activeDocTab = A;
  book.draft = DRAFT_A;
});

afterEach(() => vi.unstubAllGlobals());

describe("清单归属与结论", () => {
  it("load 后归属到「书 + 章」，条目来自既有检查", async () => {
    const checklist = useSubmissionChecklistStore();
    await checklist.load(A, DRAFT_A);
    expect(checklist.ownerKey).toBe(`b1\u0000${A}`);
    expect(checklist.items.length).toBeGreaterThan(0);
    expect(checklist.items.every((item) => item.relPath === A || item.relPath === "")).toBe(true);
    expect(checklist.loading).toBe(false);
  });

  it("load 只重算结论、不自带状态：同一章两次汇总得到同一组身份", async () => {
    const checklist = useSubmissionChecklistStore();
    await checklist.load(A, DRAFT_A);
    const ids = checklist.items.map((item) => item.id);
    expect(ids.length).toBeGreaterThan(0);
    await checklist.load(A, DRAFT_A);
    expect(checklist.items.map((item) => item.id)).toEqual(ids);
    await checklist.load(B, DRAFT_B);
    expect(checklist.items.every((item) => item.relPath === "" || item.relPath === B)).toBe(true);
  });

  it("换章先清空：clearFor 立刻把旧清单拿掉", async () => {
    const checklist = useSubmissionChecklistStore();
    await checklist.load(A, DRAFT_A);
    checklist.clearFor(B);
    expect(checklist.items).toEqual([]);
    expect(checklist.ownerKey).toBe(`b1\u0000${B}`);
  });

  it("没有本章路径就回空表", async () => {
    const checklist = useSubmissionChecklistStore();
    await checklist.load("", DRAFT_A);
    expect(checklist.items).toEqual([]);
    expect(checklist.loading).toBe(false);
  });
});

describe("换章竞态", () => {
  it("先发的那次迟到回包不许覆盖后一次的结果", async () => {
    const book = useBookStore();
    const checklist = useSubmissionChecklistStore();
    let releaseFirst = (): void => {};
    let calls = 0;
    const patched = book as unknown as { loadForeshadows: () => Promise<void> };
    patched.loadForeshadows = async () => {
      calls += 1;
      if (calls === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
    };
    const first = checklist.load(A, DRAFT_A);
    await settle();
    const second = checklist.load(B, DRAFT_B);
    await second;
    expect(checklist.ownerKey).toBe(`b1\u0000${B}`);
    expect(checklist.items.every((item) => item.relPath === "" || item.relPath === B)).toBe(true);
    releaseFirst();
    await first;
    expect(checklist.ownerKey).toBe(`b1\u0000${B}`);
    expect(checklist.items.every((item) => item.relPath === "" || item.relPath === B)).toBe(true);
  });
});

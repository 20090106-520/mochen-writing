import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { BookOpenResult } from "@mochen/contracts";
import { scriptSource, typeScriptSource } from "../utils/vue-source-reader";
import { useBookStore } from "./useBookStore";
import {
  createBookApi,
  DRAFT_A,
  DRAFT_B,
  draftBook,
  stubBookWindow,
  type BookApiFixture
} from "./book-draft-fixture";

/**
 * 拖拽重排章节的落盘次序（2026-10-09 全仓扫描 P2-4）。
 *
 * 旧写法是 `void window.mochen.saveMeta(next)`——绕过 `persistMeta`（全仓唯一带失败提示的实现），
 * 于是：**屏上已经重排、盘上一个字没改**，用户以为目录顺序保存好了；
 * 而且那次 rejection 没人接，抛成未处理拒绝。同一件事在权限档/工作模式/阶段/档案四处都走
 * `persistMeta`，唯独这一处抄了条近路——这正是「同一逻辑抄多份，迟早有一份漏掉那条坑」的现场。
 *
 * 三条判定，按这个次序钉：
 * ① 落盘没回来之前屏上不许动（先写后回读，与 `persistMeta` 的既有约定一致）；
 * ② 落盘抛错：理由上屏、次序一个字不改、`metaSaving` 不许灰死；
 * ③ 源码级守卫：这个动作里再不许出现第二份裸 `window.mochen.saveMeta`。
 */
let fx: BookApiFixture;

beforeEach(() => {
  setActivePinia(createPinia());
  fx = createBookApi();
  // 章节次序要两枚才挪得动：夹具默认只列了 DRAFT_A。
  const opened: BookOpenResult = {
    ...draftBook,
    meta: { ...draftBook.meta, chapterOrder: [DRAFT_A, DRAFT_B] }
  };
  vi.mocked(fx.api.openBook).mockResolvedValue(opened);
  stubBookWindow(fx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openedStore() {
  const store = useBookStore();
  await store.openBook("/book");
  return store;
}

describe("P2-4：拖拽重排先落盘、后上屏", () => {
  it("saveMeta 还挂着时屏上仍是旧次序；它成功了才换成新次序", async () => {
    const store = await openedStore();
    let release!: () => void;
    fx.saveMeta.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const done = store.moveChapterByRelPath(DRAFT_A, 1);
    await Promise.resolve();
    expect(store.meta?.chapterOrder).toEqual([DRAFT_A, DRAFT_B]);
    expect(store.docs.map((doc) => doc.relPath)).toEqual([DRAFT_A, DRAFT_B]);

    release();
    await done;
    expect(store.meta?.chapterOrder).toEqual([DRAFT_B, DRAFT_A]);
    expect(store.docs.map((doc) => doc.relPath)).toEqual([DRAFT_B, DRAFT_A]);
    expect(store.notice).not.toContain("章节顺序没存住");
  });

  it("saveMeta 抛错：理由上屏、次序与 docs 一个字不改、metaSaving 不灰死", async () => {
    const store = await openedStore();
    fx.saveMeta.mockRejectedValueOnce(new Error("EPERM: operation not permitted"));

    await store.moveChapterByRelPath(DRAFT_A, 1);

    expect(store.notice).toContain("章节顺序没存住");
    expect(store.notice).toContain("EPERM: operation not permitted");
    expect(store.meta?.chapterOrder).toEqual([DRAFT_A, DRAFT_B]);
    expect(store.docs.map((doc) => doc.relPath)).toEqual([DRAFT_A, DRAFT_B]);
    expect(store.metaSaving).toBe(false);
  });

  it("名单里没这一篇（拖到不该拖的地方）：一次 saveMeta 都不发", async () => {
    const store = await openedStore();
    await store.moveChapterByRelPath("chapters/99-不存在.md", 0);
    expect(fx.saveMeta).not.toHaveBeenCalled();
    expect(store.meta?.chapterOrder).toEqual([DRAFT_A, DRAFT_B]);
  });

  it("源码守卫：这个动作里不许再有第二份裸 window.mochen.saveMeta", () => {
    const src = typeScriptSource("stores/useBookStore.ts");
    const body = src.slice(src.indexOf("moveChapterByRelPath"));
    expect(body).not.toBe("");
    expect(body).toContain("this.persistMeta(");
    expect(body).not.toContain("window.mochen.saveMeta");
    // 拖动落点那一头：这条现在是异步的，调用点要写出「我知道它是异步」的自觉。
    expect(scriptSource("components/LeftSidebar.vue")).toMatch(/void book\.moveChapterByRelPath\(/);
  });
});

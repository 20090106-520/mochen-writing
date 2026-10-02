import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { computed } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  type BookMeta,
  type BookOpenResult,
  type DocWriteResult,
  type PermissionMode,
  type RendererApi
} from "@mochen/contracts";
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
// 写盘桩提成模块级常量（照 pickBookDirectory 现例）：Task 8 的用例要查它的调用次数。
// Task 9 起用例要读 mock.calls[0]?.[0]，故与 agent-store-fixture 同法用 vi.fn 的泛型签名标注入参。
const saveMeta = vi.fn<(meta: BookMeta) => Promise<void>>(async () => {});
/** book 侧测试绝不触碰的通道：一旦被调用就报出来。 */
function offLimits(name: string) {
  return vi.fn(async () => {
    throw new Error(`useBookStore 不该调用 ${name}`);
  });
}

const api = {
  pickBookDirectory,
  openBook: vi.fn(async () => result),
  saveMeta,
  readDoc,
  writeDoc,
  startTurn: offLimits("startTurn"),
  interruptTurn: offLimits("interruptTurn"),
  decideProposal: offLimits("decideProposal"),
  proposalDiff: offLimits("proposalDiff"),
  loadSession: offLimits("loadSession"),
  providerView: offLimits("providerView"),
  providerSave: offLimits("providerSave"),
  // onAgentEvent 要同步返回取消函数，async 夹具类型不符——这里同步抛错。
  onAgentEvent: vi.fn(() => {
    throw new Error("useBookStore 不该订阅 agent");
  })
} satisfies RendererApi;

function docReads() {
  return readDoc.mock.calls.filter((call) => call[0] === "chapters/01-a.md").length;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
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
      backupRelPath: ".mochen/changes/x/01-a.md.bak"
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

  it("Ctrl+1..9 / Ctrl+PageUp·Down：activateTab 越界返回 false 且不切标签，cycleTab 环形切换", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("materials/雾.md");
    expect(store.activateTab(9)).toBe(false);
    expect(store.activeDocTab).toBe("materials/雾.md");
    expect(store.activateTab(0)).toBe(true);
    await Promise.resolve();
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    store.cycleTab(1);
    await Promise.resolve();
    expect(store.activeDocTab).toBe("materials/雾.md");
    store.cycleTab(-1);
    await Promise.resolve();
    expect(store.activeDocTab).toBe("chapters/01-a.md");
  });

  it("没有标签时 cycleTab 两步都不动，activateTab(0) 返回 false", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    expect(store.docTabs).toEqual([]);
    store.cycleTab(1);
    store.cycleTab(-1);
    expect(store.activeDocTab).toBeNull();
    expect(store.activateTab(0)).toBe(false);
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

  it("智能体写盘后：干净草稿直接同步盘上内容与新指纹", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    // 盘上已被智能体改成新内容：mock 要钉在 absorbAgentWrite 触发的这次重读上，
    // 若放在 openDocTab 之前会被首次读取消费掉，重读拿到的是默认夹具。
    readDoc.mockResolvedValueOnce({
      relPath: "chapters/01-a.md",
      content: "智能体改过的\n",
      fingerprint: "fp-b"
    });
    await store.absorbAgentWrite("chapters/01-a.md", "fp-b");
    expect(store.draft).toBe("智能体改过的\n");
    expect(store.savedFingerprint).toBe("fp-b");
    expect(store.dirty).toBe(false);
    expect(store.notice).toContain("草稿已同步");
  });

  it("智能体写盘撞上未保存手改：草稿一字不动，标冲突让人决定", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("我还没保存的一段\n");
    await store.absorbAgentWrite("chapters/01-a.md", "fp-z");
    expect(store.draft).toBe("我还没保存的一段\n");
    expect(store.conflict?.currentFingerprint).toBe("fp-z");
    expect(store.notice).toContain("未保存修改没有丢");
  });

  it("写的是非活动标签：不动当前草稿，只作废那一路暂存副本让下次重读", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("chapters/02-b.md");
    readDoc.mockClear();
    await store.absorbAgentWrite("chapters/01-a.md", "fp-c");
    expect(store.draft).toBe("正文\n");
    expect(store.draftsByPath["chapters/01-a.md"]).toBeUndefined();
    expect(readDoc).not.toHaveBeenCalled();
  });

  // 补 Wave A 的覆盖缺口：absorbAgentWrite 里 reloadActive 的 catch 分支（裁定 m1′ 的可见性）。
  it("吸收写盘时重读被主进程拒绝：中文原因进 notice，草稿一字不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    readDoc.mockImplementationOnce(async () => {
      throw new Error("路径越界，已拒绝读取");
    });
    await store.absorbAgentWrite("chapters/01-a.md", "fp-b");
    expect(store.notice).toContain("路径越界，已拒绝读取");
    expect(store.draft).toBe("正文\n");
    expect(store.savedFingerprint).toBe("fp-a");
    expect(store.dirty).toBe(false);
  });

  it("档位菜单开关只搬标志位，不碰 meta 也不写盘", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    store.openPermissionMenu();
    expect(store.permissionMenuOpen).toBe(true);
    store.closePermissionMenu();
    expect(store.permissionMenuOpen).toBe(false);
    expect(saveMeta).not.toHaveBeenCalled();
  });

  it("togglePermissionMenu 开→关→开三步只搬 permissionMenuOpen，绝不写 notice", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    const noticeBefore = store.notice;
    expect(store.permissionMenuOpen).toBe(false);
    store.togglePermissionMenu();
    expect(store.permissionMenuOpen).toBe(true);
    store.togglePermissionMenu();
    expect(store.permissionMenuOpen).toBe(false);
    store.togglePermissionMenu();
    expect(store.permissionMenuOpen).toBe(true);
    expect(store.notice).toBe(noticeBefore);
    expect(saveMeta).not.toHaveBeenCalled();
  });

  it("切档成功：写盘、刷新本地 meta，并把生效范围说清楚", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockClear();
    await store.setPermissionMode("chapter-write");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0]?.[0]).toEqual({
      ...result.meta,
      permissionMode: "chapter-write"
    });
    expect(store.meta?.permissionMode).toBe("chapter-write");
    expect(store.notice).toBe("权限档已切到「可改当前章」，下一次审批就用这一档判断。");
  });

  it("同档重复点：不写盘，给一句实话", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockClear();
    await store.setPermissionMode("read-only");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.notice).toBe("已经是这一档了：「只读参考」。");
  });

  it("没开书时切档：既不写盘也不假装成功", async () => {
    const store = useBookStore();
    saveMeta.mockClear();
    await store.setPermissionMode("full-access");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.meta).toBeNull();
    expect(store.notice).toBe("还没打开作品目录，权限档改不了。");
  });

  it("主进程拒绝（例如 book.json 被占用）：中文原因原样可见，本地档位保持不变", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockRejectedValueOnce(new Error("无法写入 book.json：文件正被占用"));
    await store.setPermissionMode("full-access");
    expect(store.meta?.permissionMode).toBe("read-only");
    expect(store.notice).toBe("权限档没改过来：无法写入 book.json：文件正被占用");
  });

  /**
   * 经 computed 读的用例（9625c52 的同类盲区）：PermissionMenu.vue 的 `current` 与 CenterColumn.vue
   * 的 `permissionLabel` 都是 `computed(() => book.meta?.permissionMode ?? ...)`，本仓没有组件测试。
   * 写进 pinia state 的对象若在代理之外落地（例如改到裸引用上），真值照样对、依赖通知一次不发，
   * 组件就把渲染那一帧的旧档永久缓存下去。节奏必须是**先在旧档上读一次把缓存钉住**，再触发写，再读。
   */
  it("切档后视图侧 computed 与真值一致（组件的读法不是直读 store）", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    const viewMode = computed<PermissionMode>(
      () => store.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE
    );
    // 这一读 = 组件渲染出当前档的那一帧，缓存从此钉在这里。
    expect(viewMode.value).toBe("read-only");
    await store.setPermissionMode("full-access");
    // 先要真值（这一对写坏与否都过，只作前提），再要视图值与它一致——红的只有后一条。
    expect(store.meta?.permissionMode).toBe("full-access");
    expect(viewMode.value).toBe("full-access");
  });

  it("切档在途时 metaSaving 为真，resolve 后落回 false（与右栏 saving 无关）", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    store.saving = true; // 右栏正在存文稿：切档忙态不该被它带起来，也不该被它压住。
    let release = () => {};
    saveMeta.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );
    const pending = store.setPermissionMode("full-access");
    expect(store.metaSaving).toBe(true);
    release();
    await pending;
    expect(store.metaSaving).toBe(false);
    expect(store.meta?.permissionMode).toBe("full-access");
  });

  it("切档被主进程拒绝：metaSaving 落回 false，绝不卡住", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockRejectedValueOnce(new Error("无法写入 book.json：文件正被占用"));
    await store.setPermissionMode("full-access");
    expect(store.metaSaving).toBe(false);
    expect(store.meta?.permissionMode).toBe("read-only");
  });
});

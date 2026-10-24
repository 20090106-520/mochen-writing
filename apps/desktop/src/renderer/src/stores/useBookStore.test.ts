import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { computed, toRaw } from "vue";
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
  listSessions: offLimits("listSessions"),
  contextPreview: offLimits("contextPreview"),
  providerView: offLimits("providerView"),
  providerSave: offLimits("providerSave"),
  providerConnectionRemove: offLimits("providerConnectionRemove"),
  providerVerify: offLimits("providerVerify"),
  openProviderKeyPage: offLimits("openProviderKeyPage"),
  openWebSource: offLimits("openWebSource"),
  listModels: offLimits("listModels"),
  createBook: offLimits("createBook"),
  createDoc: offLimits("createDoc"),
  profileUpsert: offLimits("profileUpsert"),
  profileRemove: offLimits("profileRemove"),
  profileEnable: offLimits("profileEnable"),
  appearanceGet: offLimits("appearanceGet"),
  appearanceSave: offLimits("appearanceSave"),
  saveFile: offLimits("saveFile"),
  buildExport: offLimits("buildExport"),
  listChanges: offLimits("listChanges"),
  readChange: offLimits("readChange"),
  diffChange: offLimits("diffChange"),
  restoreChange: offLimits("restoreChange"),

  // 2026-10-06 批次 5-⑧ 新增的三个（保留上限）。写 store 用不到它们，
  // 桩成「越权就抛」：真被调用到时这条用例会立刻炸，而不是悄悄返回 undefined。
  changesRetentionGet: offLimits("changesRetentionGet"),
  changesRetentionSave: offLimits("changesRetentionSave"),
  changesPruneNow: offLimits("changesPruneNow"),
  notify: offLimits("notify"),
  // onAgentEvent 要同步返回取消函数，async 夹具类型不符——这里同步抛错。
  onAgentEvent: vi.fn(() => {
    throw new Error("useBookStore 不该订阅 agent");
  }),
  // 退出握手（P0-6）：这些用例不该摸这条通道，一摸就抛——订阅要同步返回退订函数，故不套 offLimits。
  onQuitFlushRequest: vi.fn(() => {
    throw new Error("不该订阅退出握手");
  }),
  quitFlushDone: offLimits("quitFlushDone"),
  listSkills: offLimits("listSkills"),
  readSkill: offLimits("readSkill"),
  // 技能市场三枚（2026-10-07 批次 5-㉖）：与上面同一口径，桩成「越权就抛」。
  listMarket: offLimits("listMarket"),
  installMarketSkill: offLimits("installMarketSkill"),
  uninstallMarketSkill: offLimits("uninstallMarketSkill"),
  // 插件四枚（2026-10-07 批次 5-㉚）：与上面同一口径——这一批测的是书，
  // 插件是应用级的东西，越权调用就该当场抛而不是静默返回空。
  listPlugins: offLimits("listPlugins"),
  togglePlugin: offLimits("togglePlugin"),
  uninstallPlugin: offLimits("uninstallPlugin"),
  readPluginSource: offLimits("readPluginSource"),
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：书本身不碰 `.mochen/data/` 那三份设定，
  // 越权调用照样当场抛，而不是静默给一份空数据。
  readBookData: offLimits("readBookData"),
  writeBookData: offLimits("writeBookData"),
  // 只重算一篇（2026-10-10 P1-4 后半）与回收站三条、更新检查（同日）：satisfies RendererApi
  // 要求它们在场，但这些用例一条都不消费——空实现回合法形状，真被调到也不至于污染用例。
  refreshDoc: async () => ({ ok: true, doc: null }),
  trashDoc: async () => ({ ok: true, trashName: "fixture" }),
  listTrash: async () => ({ ok: true, entries: [] }),
  restoreTrash: async () => ({ ok: true, relPath: "chapters/fixture.md" }),
  createBookBackup: async () => ({ ok: true, name: null, fileCount: 0 }),
  listBookBackups: async () => ({ ok: true, entries: [] }),
  restoreBookBackup: async () => ({ ok: true, destName: "恢复目录" }),
  updateCheck: async () => ({ status: "disabled", version: "", latestVersion: null, note: "" }),
  importTxtPreview: async () => {
    throw new Error("不该做 TXT 导入预览");
  },
  materialsSearch: async () => {
    throw new Error("这条用例不该调素材库联网搜索");
  },
  materialsFetch: async () => {
    throw new Error("这条用例不该调素材库取全文");
  },
  importTxtCommit: async () => {
    throw new Error("不该提交 TXT 导入");
  },
  replaceAllInBook: async () => {
    throw new Error("不该在这条用例里做全书替换");
  },
  // WebDAV 远程备份（2026-10-15）：这条路上一个都不该被调到——谁真要用它在用例里显式铺好 mock。
  webdavConfigGet: async () => {
    throw new Error("不该读 WebDAV 配置");
  },
  webdavConfigSave: async () => {
    throw new Error("不该存 WebDAV 配置");
  },
  webdavVerify: async () => {
    throw new Error("不该验活 WebDAV");
  },
  webdavPush: async () => {
    throw new Error("不该推 WebDAV 远程备份");
  },
  webdavList: async () => {
    throw new Error("不该列 WebDAV 远程备份");
  },
  webdavPull: async () => {
    throw new Error("不该拉 WebDAV 远程备份");
  },
  // 多稿两枚（P0-②）：这几份夹具测的是书，选稿丢稿一个都不该被调到——越界当场喊出来。
  pickDraft: async () => {
    throw new Error("不该在这条用例里选稿");
  },
  discardDrafts: async () => {
    throw new Error("不该在这条用例里丢稿");
  },
  // 作品库（2026-10-21）：applyOpened 会顺手刷一次清单；本用例不碰书架，给空清单即可。
  listRecentBooks: async () => ({ books: [] }),
  forgetRecentBook: async () => {
    throw new Error("不该在这条用例里移除作品");
  }
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
    // 关标签现在先替这一格落盘（P0-3），所以这两次关闭都是异步的：不 await 就会读到半程状态。
    await store.closeTab("chapters/02-b.md");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    await store.closeTab("chapters/01-a.md");
    expect(store.docTabs).toEqual([]);
    expect(store.activeDocTab).toBeNull();
    expect(store.draft).toBe("");
    expect(store.savedFingerprint).toBe("");
  });

  /**
   * 关掉的正是「正在看且改了没存」的那一格时，将死标签的 live 状态绝不能灌进下一格的存档：
   * closeTab 先把活动指针挪走再调 openDocTab，而 openDocTab 开头就是 stashActive()——
   * 它按 activeDocTab 存盘，存的却是上一格还没加载前的 live 内容，等于串台（真数据丢失，非显示问题）。
   */
  it("关闭活动标签：将死标签的未存草稿绝不进下一格的存档", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("chapters/02-b.md");
    store.onEdit("02-b 的改动\n");
    // 这一格的脏稿先落盘（P0-3）——写成之后标签才关得掉；下一格的存档照样不该被脏水泼到。
    writeDoc.mockResolvedValueOnce({ ok: true, fingerprint: "fp-keep", backupRelPath: null });
    await store.closeTab("chapters/02-b.md");
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("正文\n");
    expect(store.dirty).toBe(false);
    expect(store.draftsByPath["chapters/01-a.md"]?.draft).toBe("正文\n");
    expect(store.draftsByPath["chapters/01-a.md"]?.dirty).toBe(false);
  });

  it("关闭非活动标签：live 草稿与活动指针一字不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.openDocTab("chapters/02-b.md");
    store.onEdit("02-b 的改动\n");
    // 关的是另一格，且它本身是干净的：不发写盘，live 与活动指针一个字都不动。
    await store.closeTab("chapters/01-a.md");
    expect(store.docTabs).toEqual(["chapters/02-b.md"]);
    expect(store.activeDocTab).toBe("chapters/02-b.md");
    expect(store.draft).toBe("02-b 的改动\n");
    expect(store.dirty).toBe(true);
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

  it("切档交给主进程的是可结构化克隆的裸对象：响应式代理过不了 IPC", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    // Electron 在 IPC 的 send 端做结构化克隆，Vue 的 reactive 代理（连带嵌套数组）会在这里抛 DataCloneError。
    // 真机冒烟就是这样炸的（notice 变成「权限档没改过来：An object could not be cloned.」）；
    // 上面那条成功用例用 toEqual 比对，代理与裸对象在 it 眼里一模一样，抓不到。
    saveMeta.mockImplementationOnce(async (meta) => {
      structuredClone(meta);
    });
    await store.setPermissionMode("chapter-write");
    expect(store.notice).toBe("权限档已切到「可改当前章」，下一次审批就用这一档判断。");
    expect(store.meta?.permissionMode).toBe("chapter-write");
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
   * 弹层收起的唯一通路：store 在成功末尾自己关。10495e0 之前 PermissionMenu.vue 的 choose()
   * 在 await 之后又 emit 了一次 close，把「失败也要留着」的意图覆盖成静默关闭；本仓没有组件测试，
   * 这两条 store 用例是该意图在自动化里唯一的落点（组件删掉那次 emit 由 Task 10 真机冒烟复看）。
   */
  it("切档成功后弹层自动收起", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    store.openPermissionMenu();
    await store.setPermissionMode("full-access");
    expect(store.permissionMenuOpen).toBe(false);
  });

  it("切档失败与同档重复点都不收起：给用户当场重试的通路", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    saveMeta.mockRejectedValueOnce(new Error("无法写入 book.json：文件正被占用"));
    store.openPermissionMenu();
    await store.setPermissionMode("full-access");
    expect(store.permissionMenuOpen).toBe(true);
    saveMeta.mockClear();
    await store.setPermissionMode("read-only"); // 此刻真值仍是 read-only ⇒ 走同档早退
    expect(store.permissionMenuOpen).toBe(true);
    expect(saveMeta).not.toHaveBeenCalled();
  });

  /**
   * 经 computed 读的用例（9625c52 的同类盲区）：PermissionMenu.vue 的 `current` 与 CenterColumn.vue
   * 的 `permissionChip`（档位文案经 utils/permission-chip.ts 的 `permissionChipView`）都是读
   * `book.meta?.permissionMode` 的 computed，本仓没有组件测试。
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

  it("openDossier 只把右栏切到作品资料，文稿标签/活动章/草稿/脏位一字不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("还没保存的一段\n");
    saveMeta.mockClear();
    // 全量快照比对：openDossier 只要多写任何一个状态字段（notice / saving / browseTabs…）就当场红
    const before = structuredClone(toRaw(store.$state));
    store.openDossier();
    expect(store.$state).toEqual({ ...before, rightPaneMode: "dossier" });
    expect(store.rightPaneMode).toBe("dossier");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("还没保存的一段\n");
    expect(store.dirty).toBe(true);
    expect(saveMeta).not.toHaveBeenCalled();
  });

  it("从作品资料切回文稿/浏览是三态往返，标签与草稿仍不受影响", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.openDossier();
    store.rightPaneMode = "browse";
    expect(store.rightPaneMode).toBe("browse");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.browseTabs).toEqual([]);
    store.rightPaneMode = "manuscript";
    expect(store.rightPaneMode).toBe("manuscript");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("正文\n");
  });

  // T7-1：hasBook 单一真身。判别力刻意压在「新 store ⇒ false」这一半——`() => true` 变异必先红在这里。
  it("hasBook getter：新 store 为 false，openBook 后为 true", async () => {
    const store = useBookStore();
    expect(store.hasBook).toBe(false);
    await store.openBook("/book");
    expect(store.hasBook).toBe(true);
  });
});

/**
 * #113c 切阶段：setPermissionMode 的同一条通路（book.json 里唯一另一个可写字段）。
 * 夹具的共享 `result.meta` 只声明一档，切阶段需要两档 ⇒ 用 mockImplementationOnce 换一本书，
 * 动公共夹具会牵连整文件的 toEqual(result.meta) 断言（blast radius 不对）。
 */
describe("setActiveStage · 切阶段（#113c）", () => {
  const twoStageMeta: BookMeta = {
    ...result.meta,
    stages: [
      { id: "draft", name: "正文" },
      { id: "revise", name: "修订" }
    ],
    activeStage: "draft"
  };

  async function openTwoStage(store: ReturnType<typeof useBookStore>): Promise<void> {
    api.openBook.mockImplementationOnce(async () => ({ ...result, meta: twoStageMeta }));
    await store.openBook("/book");
    saveMeta.mockClear();
  }

  it("切档成功：写一次盘、本地 activeStage 跟着换，并把生效范围说清楚", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    await store.setActiveStage("revise");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0]?.[0]).toEqual({ ...twoStageMeta, activeStage: "revise" });
    expect(store.meta?.activeStage).toBe("revise");
    expect(store.notice).toBe("阶段已切到「修订」，下一轮对话按这一档装配上下文。");
  });

  it("除 meta / notice 外一个状态字段都不许多改（含权限弹层开关与右栏模式）", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    store.openPermissionMenu();
    store.rightPaneMode = "dossier";
    const before = structuredClone(toRaw(store.$state));
    await store.setActiveStage("revise");
    expect(store.$state).toEqual({
      ...before,
      meta: { ...twoStageMeta, activeStage: "revise" },
      notice: "阶段已切到「修订」，下一轮对话按这一档装配上下文。"
    });
    // 上一条靠整体 toEqual 兜，这两句单独钉住最容易被顺手改坏的两格（弹层与页签）。
    expect(store.permissionMenuOpen).toBe(true);
    expect(store.rightPaneMode).toBe("dossier");
  });

  it("交给主进程的是可结构化克隆的裸对象：嵌套 stages 数组的代理过不了 IPC", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    saveMeta.mockImplementationOnce(async (meta) => {
      structuredClone(meta);
    });
    await store.setActiveStage("revise");
    expect(store.notice).toBe("阶段已切到「修订」，下一轮对话按这一档装配上下文。");
    expect(store.meta?.activeStage).toBe("revise");
  });

  it("同档重复点：不写盘，给一句实话", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    await store.setActiveStage("draft");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.notice).toBe("已经是这个阶段了：「正文」。");
  });

  it("没开书时切档：既不写盘也不假装成功", async () => {
    const store = useBookStore();
    saveMeta.mockClear();
    await store.setActiveStage("revise");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.meta).toBeNull();
    expect(store.notice).toBe("还没打开作品目录，阶段改不了。");
  });

  it("名单外的档 id：不写盘——bookSchema 会拒「activeStage 不在 stages 中」，渲染层先把话说明白", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    await store.setActiveStage("nope");
    expect(saveMeta).not.toHaveBeenCalled();
    expect(store.meta?.activeStage).toBe("draft");
    expect(store.notice).toBe("这一档不在本书的阶段列表里，没去改。");
  });

  it("主进程拒绝：中文原因原样可见，本地阶段保持不变", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    saveMeta.mockRejectedValueOnce(new Error("无法写入 book.json：文件正被占用"));
    await store.setActiveStage("revise");
    expect(store.meta?.activeStage).toBe("draft");
    expect(store.notice).toBe("阶段没改过来：无法写入 book.json：文件正被占用");
  });

  it("切档在途时 metaSaving 为真，resolve 与 reject 都落回 false", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    let release = () => {};
    saveMeta.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );
    const pending = store.setActiveStage("revise");
    expect(store.metaSaving).toBe(true);
    release();
    await pending;
    expect(store.metaSaving).toBe(false);
    saveMeta.mockRejectedValueOnce(new Error("无法写入 book.json"));
    await store.setActiveStage("draft");
    expect(store.metaSaving).toBe(false);
  });

  it("切档后视图侧 computed 与真值一致（绑定条读的是 computed，不是直读 store）", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    const viewStage = computed(
      () => store.meta?.stages.find((s) => s.id === store.meta?.activeStage)?.name ?? "无"
    );
    expect(viewStage.value).toBe("正文");
    await store.setActiveStage("revise");
    expect(store.meta?.activeStage).toBe("revise");
    expect(viewStage.value).toBe("修订");
  });

  it("权限弹层开着时切阶段：弹层不归它管，不替用户收起", async () => {
    const store = useBookStore();
    await openTwoStage(store);
    store.openPermissionMenu();
    await store.setActiveStage("revise");
    expect(store.permissionMenuOpen).toBe(true);
  });
});

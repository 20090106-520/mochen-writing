/**
 * 改稿历史与回滚的**行为**测试（2026-10-05）。
 *
 * 接线契约在 `components/change-history-wiring.test.ts`（读源码钉「按钮调了谁」），
 * 这里钉的是真动作跑起来之后的状态：指纹现读现传、竞态下不摆错内容、以及**回滚成功的提示
 * 必须是最后写进 notice 的那一条**。
 *
 * 最后这条是 CDP 真机跑出来的：回滚确实成功了，但 `reloadActive()` 紧接着把 notice 改写成
 * 「已重载盘上内容」，用户从头到尾没看见「已回滚」三个字——功能对了，告知丢了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type BookOpenResult,
  type ChangeEntry,
  type DocWriteResult,
  type RendererApi
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";
import { SKILL_API_STUBS } from "./skill-api-stub";

const openResult: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: ["chapters/01-a.md"]
  },
  docs: [{ relPath: "chapters/01-a.md", kind: "chapter" as const, title: "开局" }]
};

const DOC = "chapters/01-a.md";
const entry: ChangeEntry = {
  stamp: "2026-10-05T12-34-31-168Z",
  docRelPath: DOC,
  backupRelPath: `.mochen/changes/2026-10-05T12-34-31-168Z/${DOC}.bak`,
  bytes: 26
};

let 盘上正文 = "改坏了的正文\n";
let 盘上指纹 = "fp-broken";
const readDoc = vi.fn(async (relPath: string) => ({
  relPath,
  content: 盘上正文,
  fingerprint: 盘上指纹
}));
const listChanges = vi.fn(async (): Promise<ChangeEntry[]> => [entry]);
const readChange = vi.fn<RendererApi["readChange"]>(async () => ({
  content: "改前的样子\n",
  fingerprint: "fp-bak"
}));

/** 逐行对比（2026-10-13）：主进程算好的那份 unified diff，桩成一条真形状（文件头 + hunk 头 + 一行增一行删）。 */
const DIFF = [
  `--- a/${DOC}`,
  `+++ b/${DOC}`,
  "@@ -1,2 +1,2 @@",
  "-雾从海面涌上来。",
  "+海雾涌上来，铁锈味很冲。",
  " 他没有回头。"
].join("\n");
const diffChange = vi.fn<RendererApi["diffChange"]>(async () => ({ ok: true, diff: DIFF }));

/** 桩的默认回滚：动盘上那两份变量，好让「右栏现读回来」断言有东西可读。 */
async function 回滚到改前(): Promise<Awaited<ReturnType<RendererApi["restoreChange"]>>> {
  盘上正文 = "改前的样子\n";
  盘上指纹 = "fp-restored";
  return {
    ok: true,
    fingerprint: "fp-restored",
    backupRelPath: null,
    restoredFrom: entry.backupRelPath
  };
}
const restoreChange = vi.fn<RendererApi["restoreChange"]>(回滚到改前);

const api = {
  pickBookDirectory: vi.fn(async (): Promise<string | null> => "/book"),
  openBook: vi.fn(async () => openResult),
  createBook: vi.fn(async () => {
    throw new Error("不该建书");
  }),
  // 作品库（2026-10-21）：openBook 的 applyOpened 会顺手刷一次清单。
  listRecentBooks: vi.fn(async () => ({ books: [] })),
  forgetRecentBook: vi.fn(async () => ({ books: [] })),
  saveMeta: vi.fn(async () => {}),
  readDoc,
  writeDoc: vi.fn(async (): Promise<DocWriteResult> => ({
    ok: true,
    fingerprint: "fp-next",
    backupRelPath: null
  })),
  createDoc: vi.fn(async () => {
    throw new Error("不该建稿");
  }),
  renameDoc: vi.fn(async () => {
    throw new Error("不该改文件名");
  }),
  appearanceGet: vi.fn(async () => {
    throw new Error("不该读外观");
  }),
  appearanceSave: vi.fn(async () => {}),
  startTurn: vi.fn(async () => {
    throw new Error("不该发轮次");
  }),
  interruptTurn: vi.fn(async () => {
    throw new Error("不该打断");
  }),
  decideProposal: vi.fn(async () => {
    throw new Error("不该裁决提案");
  }),
  proposalDiff: vi.fn(async () => {
    throw new Error("不该算 diff");
  }),
  loadSession: vi.fn(async () => {
    throw new Error("不该载会话");
  }),
  listSessions: vi.fn(async () => []),
  contextPreview: vi.fn(async () => {
    throw new Error("不该算上下文预览");
  }),
  providerView: vi.fn(async () => {
    throw new Error("不该读 provider");
  }),
  providerSave: vi.fn(async () => {
    throw new Error("不该写 provider");
  }),
  providerConnectionRemove: vi.fn(async () => {
    throw new Error("不该删连接");
  }),
  providerVerify: vi.fn(async () => {
    throw new Error("不该体检");
  }),
  openProviderKeyPage: vi.fn(async () => {
    throw new Error("不该开密钥页");
  }),
  openWebSource: vi.fn(async () => {
    throw new Error("不该点开搜索来源");
  }),
  listModels: vi.fn(async () => {
    throw new Error("不该拉模型");
  }),
  profileUpsert: vi.fn(async () => {
    throw new Error("不该建档");
  }),
  profileRemove: vi.fn(async () => {
    throw new Error("不该删档");
  }),
  profileEnable: vi.fn(async () => {
    throw new Error("不该启停");
  }),
  setUtility: vi.fn(async () => {
    throw new Error("不该改后台杂活模型");
  }),
  onAgentEvent: vi.fn(() => () => {}),
  // 退出握手（P0-6）：这一格用例不碰它，给一对无害的假身即可过 RendererApi 的形状关。
  onQuitFlushRequest: () => () => {},
  quitFlushDone: async () => {},
  saveFile: vi.fn(async () => true),
  buildExport: vi.fn(async () => ({
    content: "",
    bytes: null,
    format: "markdown" as const,
    filename: "",
    byteSize: 0
  })),
  listChanges,
  readChange,
  diffChange,
  restoreChange,

  // 2026-10-06 批次 5-⑧：`satisfies RendererApi` 要求这三个通道在场，但**这个 store 一个都不用**。
  // 给的是默认档快照，所以真被调到也只会拿到「什么都没设过」这一种结果——不会让断言莫名其妙地红。
  changesRetentionGet: async () => ({ persisted: false, retention: DEFAULT_CHANGE_RETENTION }),
  changesRetentionSave: async (r) => r,
  changesPruneNow: async () => ({ removed: 0, kept: 0, freedBytes: 0, keptBytes: 0 }),
  notify: vi.fn(),
  listSkills: vi.fn(async () => {
    throw new Error("不该列技能");
  }),
  readSkill: vi.fn(async () => {
    throw new Error("不该读技能");
  }),
  // 技能市场三枚（2026-10-07 批次 5-㉖）：satisfies RendererApi 要求它们在场，
  // 但这些 store 一个都不用。给的是「空表 + 没问过」的默认档，
  // 真被调到也只会拿到「市场里什么都没有」这一种结果——不会让无关的断言莫名其妙地红。
  listMarket: async () => ({ entries: [], listed: false, notice: "" }),
  redeemSkill: async () => ({ ok: false, notice: "", dirName: "", displayName: "" }),
  ...SKILL_API_STUBS,
  installMarketSkill: async () => {
    throw new Error("不该装技能");
  },
  uninstallMarketSkill: async () => {
    throw new Error("不该卸技能");
  },
  listPlugins: async () => ({ entries: [], listed: true }),
  togglePlugin: async () => {
    throw new Error("不该停用插件");
  },
  uninstallPlugin: async () => {
    throw new Error("不该卸插件");
  },
  readPluginSource: async () => {
    throw new Error("不该读插件源码");
  },
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：改稿备份这条路不碰书里的设定文件，
  // 给的是「越权即抛」的假身——静默返回空表会让误用变得看不见。
  readBookData: async () => {
    throw new Error("不该读书里的设定文件");
  },
  writeBookData: async () => {
    throw new Error("不该写书里的设定文件");
  },
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
  }
} satisfies RendererApi;

beforeEach(() => {
  setActivePinia(createPinia());
  盘上正文 = "改坏了的正文\n";
  盘上指纹 = "fp-broken";
  vi.stubGlobal("window", {
    mochen: api,
    localStorage: { getItem: () => null, setItem: () => {} }
  });
  readDoc.mockClear();
  listChanges.mockClear();
  readChange.mockClear();
  diffChange.mockClear();
  restoreChange.mockClear();
  restoreChange.mockImplementation(回滚到改前);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openedBook() {
  const store = useBookStore();
  await store.openBook("/book");
  await store.openDocTab(DOC);
  return store;
}

describe("回滚", () => {
  it("成功后最后一条提示是「已回滚」，不许被刷新正文那句盖掉", async () => {
    const store = await openedBook();
    await store.restoreChange(entry);
    expect(store.notice).toContain("已回滚");
  });

  it("右栏正文跟着回到改前的样子（现读回来，不是停在旧内容上）", async () => {
    const store = await openedBook();
    await store.restoreChange(entry);
    expect(store.draft).toBe("改前的样子\n");
    expect(store.dirty).toBe(false);
  });

  it("指纹是盘上此刻现读现传的，不许用打开文稿时那个旧的", async () => {
    const store = await openedBook();
    readDoc.mockClear();
    await store.restoreChange(entry);
    expect(readDoc).toHaveBeenCalledWith(DOC);
    expect(restoreChange).toHaveBeenCalledWith(entry.backupRelPath, "fp-broken");
  });

  it("stale：说人话，且不刷新正文（那份内容已经不是当时的了）", async () => {
    const store = await openedBook();
    restoreChange.mockImplementationOnce(async () => ({
      ok: false as const,
      reason: "stale" as const,
      currentFingerprint: "fp-other",
      restoredFrom: entry.backupRelPath
    }));
    await store.restoreChange(entry);
    expect(store.notice).toContain("又被改过了");
    expect(store.draft).toBe("改坏了的正文\n");
  });

  it("没打开那一篇正文就不发 IPC（否则刷的是别的文稿）", async () => {
    const store = await openedBook();
    store.activeDocTab = null;
    await store.restoreChange(entry);
    expect(restoreChange).not.toHaveBeenCalled();
    expect(store.notice).toContain("先打开那一篇正文");
  });
});

/**
 * 一键撤销（P0-5）。
 *
 * 行为上与回滚是同一条路（`restoreBackupToDoc`），差别只在开头：撤销那一篇如果没摆在右栏，
 * 先把那一篇打开再回写——否则「在 A 篇的标签下悄悄把 B 篇改掉」正是这次收紧要挡住的事。
 */
describe("一键撤销", () => {
  it("撤销已经开在右栏的那一篇：不重复打开，回写与提示和回滚一致", async () => {
    const store = await openedBook();
    readDoc.mockClear();
    await store.undoChange(entry);
    expect(store.activeDocTab).toBe(DOC);
    expect(readDoc).toHaveBeenCalledWith(DOC);
    expect(restoreChange).toHaveBeenCalledWith(entry.backupRelPath, "fp-broken");
    expect(store.notice).toContain("已回滚");
  });

  it("撤销另一篇：先把那一篇打开，再做指纹与回写（不会改错文稿）", async () => {
    const store = await openedBook();
    const other: ChangeEntry = {
      ...entry,
      docRelPath: "chapters/02-b.md",
      backupRelPath: `.mochen/changes/2026-10-05T12-34-31-168Z/chapters/02-b.md.bak`
    };
    await store.undoChange(other);
    // 打开动作把指针换到那一篇，后面的回滚守卫才肯放行。
    expect(store.activeDocTab).toBe("chapters/02-b.md");
    expect(readDoc).toHaveBeenCalledWith("chapters/02-b.md");
    expect(restoreChange).toHaveBeenCalledWith(other.backupRelPath, "fp-broken");
    expect(store.notice).toContain("已回滚");
  });
});

describe("看改前", () => {
  it("读回的内容挂在选中那一条上", async () => {
    const store = await openedBook();
    await store.peekChange(entry);
    expect(store.changeHistory?.backupRelPath).toBe(entry.backupRelPath);
    expect(store.changePreview?.content).toBe("改前的样子\n");
  });

  // ── 逐行对比（2026-10-13）──
  it("主进程算好的那份 diff 与改前正文一起挂回来", async () => {
    const store = await openedBook();
    await store.peekChange(entry);
    expect(store.changePreview?.diff).toBe(DIFF);
    expect(store.notice).toBe("");
  });

  it("对比递下去的是「这条备份 + 这一篇文稿」两枚，顺序调倒就比错了对象", async () => {
    const store = await openedBook();
    await store.peekChange(entry);
    expect(diffChange).toHaveBeenCalledWith(entry.backupRelPath, entry.docRelPath);
  });

  it("对比没算出来：改前正文仍然在，diff 是 null（不是空串），且当场说一句为什么", async () => {
    const store = await openedBook();
    diffChange.mockImplementationOnce(async () => ({
      ok: false,
      message: `盘上已经没有这一篇：${DOC}`
    }));
    await store.peekChange(entry);
    expect(store.changePreview?.content).toBe("改前的样子\n");
    // null 与 "" 是两档："" 是「算出来了、一个字都没差」，null 才是「没算出来」。压成一个就没人分得清。
    expect(store.changePreview?.diff).toBeNull();
    expect(store.notice).toContain("逐行对比没算出来");
    expect(store.notice).toContain(DOC);
  });

  it("对比那一扇整个抛了也只当「没算出来」：正文不许被一起带走，在途标记要落地", async () => {
    const store = await openedBook();
    diffChange.mockImplementationOnce(async () => {
      throw new Error("EIO");
    });
    await store.peekChange(entry);
    expect(store.changePreview?.content).toBe("改前的样子\n");
    expect(store.changePreview?.diff).toBeNull();
    expect(store.notice).toContain("逐行对比没算出来");
    expect(store.changesBusy).toBe(false);
  });

  it("备份根本没读回来时，第二扇 IPC 一次都不许多发（拿什么比？）", async () => {
    const store = await openedBook();
    readChange.mockImplementationOnce(async () => {
      throw new Error("ENOENT");
    });
    await store.peekChange(entry);
    expect(store.changePreview).toBeNull();
    expect(diffChange).not.toHaveBeenCalled();
  });

  it("期间用户改选了别的条目，读回来的旧预览要丢掉（不许摆错内容）", async () => {
    const store = await openedBook();
    const other: ChangeEntry = {
      ...entry,
      stamp: "2026-10-05T13-00-00-000Z",
      backupRelPath: ".mochen/changes/2026-10-05T13-00-00-000Z/chapters/01-a.md.bak"
    };
    let 放行!: () => void;
    const 卡住 = new Promise<void>((resolve) => {
      放行 = resolve;
    });
    readChange.mockImplementationOnce(async () => {
      await 卡住;
      return { content: "旧那一份\n", fingerprint: "fp-old" };
    });
    const pending = store.peekChange(entry);
    store.changeHistory = other;
    放行();
    await pending;
    expect(store.changePreview).toBeNull();
  });

  it("读不出来：说人话，不留半截预览", async () => {
    const store = await openedBook();
    readChange.mockImplementationOnce(async () => {
      throw new Error("EACCES");
    });
    await store.peekChange(entry);
    expect(store.notice).toContain("读不出来");
    expect(store.changePreview).toBeNull();
  });
});

describe("列表", () => {
  it("读不出来：说人话 + 给空表，不留上一份的旧列表骗人", async () => {
    const store = await openedBook();
    listChanges.mockImplementationOnce(async () => {
      throw new Error("ENOENT");
    });
    await store.loadChanges();
    expect(store.notice).toContain("没读回来");
    expect(store.changeList).toEqual([]);
  });

  it("关掉面板把选中与预览一起清掉（下次打开是干净的一张表）", async () => {
    const store = await openedBook();
    await store.peekChange(entry);
    store.closeChangeHistory();
    expect(store.changeHistory).toBeNull();
    expect(store.changePreview).toBeNull();
    expect(store.changeHistoryOpen).toBe(false);
  });
});

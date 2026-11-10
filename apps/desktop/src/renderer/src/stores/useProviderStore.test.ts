import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  ConnectionDraft,
  ModelListResult,
  ProfileDraft,
  ProviderSaveResult,
  ProviderView,
  RendererApi,
  VerifyResult
} from "@mochen/contracts";
import { DEFAULT_CHANGE_RETENTION } from "@mochen/contracts";
import { profilesOfConnection, useProviderStore } from "./useProviderStore";
import { SKILL_API_STUBS } from "./skill-api-stub";

/**
 * 连接视图（2026-10-06 批次 5-⑤ 起）：**地址与密钥不再是全局一份**，
 * 每家供应商一条连接，档案挂在某条连接上。modelLabel / configured 从「启用中的档案」派生。
 */
const VIEW: ProviderView = {
  connections: [
    {
      id: "c-deep",
      providerId: "deepseek",
      label: "DeepSeek",
      baseURL: "https://api.deepseek.com/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      hasKey: true,
      keyMask: "••••2c9f"
    },
    {
      id: "c-mimo",
      providerId: "mimo",
      label: "小米 MiMo",
      baseURL: "https://api.xiaomimimo.com/v1",
      authHeader: "api-key",
      thinkingWire: "standard",
      hasKey: true,
      keyMask: "••••ab12"
    }
  ],
  profiles: [
    { id: "p-1", connectionId: "c-deep", model: "mochen-mock", enabled: true },
    { id: "p-2", connectionId: "c-deep", model: "mochen-8B", enabled: false },
    { id: "p-3", connectionId: "c-mimo", model: "mimo-v2.6-pro", enabled: false }
  ]
};

const providerView = vi.fn(async (): Promise<ProviderView> => VIEW);
// 真正的实现装在 beforeEach 里；这里只先把类型钉住。
const providerSave = vi.fn(async (draft: ConnectionDraft): Promise<ProviderSaveResult> => ({
  connections: VIEW.connections,
  profiles: VIEW.profiles,
  connectionId: draft.connectionId ?? "c-new"
}));
const providerConnectionRemove = vi.fn(async (id: string): Promise<ProviderView> => ({
  connections: VIEW.connections.filter((c) => c.id !== id),
  profiles: VIEW.profiles.filter((p) => p.connectionId !== id)
}));
const listModels = vi.fn(async (): Promise<ModelListResult> => ({
  ok: true,
  models: ["mochen-8B", "mochen-mock"]
}));
const providerVerify = vi.fn(async (): Promise<VerifyResult> => ({
  state: "ok",
  modelCount: 2,
  checkedAt: "2026-10-06T00:00:00.000Z"
}));
const openProviderKeyPage = vi.fn(async (): Promise<boolean> => true);
const openWebSource = vi.fn(async (): Promise<boolean> => true);

/**
 * 档案管理三条通道：加一条 / 删一条 / 启停。桩只记调用，断言交给用例。
 * 桩镜像主进程的**启停互斥**，否则 modelLabel 会因为两条 enabled 都为真而取错档案。
 */
const profileUpsert = vi.fn(async (draft: ProfileDraft): Promise<ProviderView> => ({
  ...VIEW,
  profiles: [
    {
      id: `p-${VIEW.profiles.length + 1}`,
      connectionId: draft.connectionId,
      model: draft.model,
      enabled: true
    },
    ...VIEW.profiles.map((profile) => ({ ...profile, enabled: false }))
  ]
}));
const profileRemove = vi.fn(async (id: string): Promise<ProviderView> => ({
  ...VIEW,
  profiles: VIEW.profiles.filter((profile) => profile.id !== id)
}));
/** 启停互斥也在主进程；桩同步镜像：启用谁，其余自动停用。 */
const profileEnable = vi.fn(async (id: string, enabled: boolean): Promise<ProviderView> => ({
  ...VIEW,
  profiles: VIEW.profiles.map((profile) => ({
    ...profile,
    enabled: profile.id === id ? enabled : false
  }))
}));
/** 这条 store 只管模型侧：书与 agent 的通道一旦被打到就是越界。 */
function offLimits(name: string) {
  return vi.fn(async () => {
    throw new Error(`useProviderStore 不该调用 ${name}`);
  });
}

const api = {
  pickBookDirectory: offLimits("pickBookDirectory"),
  openBook: offLimits("openBook"),
  // 作品库（2026-10-21）：本测试不碰作品库，两条都按 offLimits 处理。
  listRecentBooks: offLimits("listRecentBooks"),
  forgetRecentBook: offLimits("forgetRecentBook"),
  saveMeta: offLimits("saveMeta"),
  readDoc: offLimits("readDoc"),
  writeDoc: offLimits("writeDoc"),
  startTurn: offLimits("startTurn"),
  interruptTurn: offLimits("interruptTurn"),
  decideProposal: offLimits("decideProposal"),
  proposalDiff: offLimits("proposalDiff"),
  loadSession: offLimits("loadSession"),
  listSessions: offLimits("listSessions"),
  contextPreview: offLimits("contextPreview"),
  createDoc: offLimits("createDoc"),
  createBook: offLimits("createBook"),
  providerView,
  providerSave,
  providerConnectionRemove,
  listModels,
  providerVerify,
  openProviderKeyPage,
  openWebSource,
  profileUpsert,
  profileRemove,
  profileEnable,
  appearanceGet: offLimits("appearanceGet"),
  appearanceSave: offLimits("appearanceSave"),
  saveFile: offLimits("saveFile"),
  buildExport: offLimits("buildExport"),
  notify: offLimits("notify"),
  onAgentEvent: vi.fn(() => {
    throw new Error("useProviderStore 不该订阅 agent");
  }),
  // 退出握手（P0-6）：这些用例不该摸这条通道，一摸就抛——订阅要同步返回退订函数，故不套 offLimits。
  onQuitFlushRequest: vi.fn(() => {
    throw new Error("不该订阅退出握手");
  }),
  quitFlushDone: offLimits("quitFlushDone"),
  listSkills: offLimits("listSkills"),
  readSkill: offLimits("readSkill"),
  listChanges: offLimits("listChanges"),
  readChange: offLimits("readChange"),
  diffChange: offLimits("diffChange"),
  restoreChange: offLimits("restoreChange"),

  // 2026-10-06 批次 5-⑧：保留上限的读 / 写 / 立即清理。
  // 下面这些 store 都用不到它们，桩成「越权就抛」——真被调用到时那条用例会立刻炸，
  // 而不是悄悄返回 undefined 让断言在别处莫名其妙地红。
  changesRetentionGet: async () => ({ persisted: false, retention: DEFAULT_CHANGE_RETENTION }),
  changesRetentionSave: async (r) => r,
  changesPruneNow: async () => ({ removed: 0, kept: 0, freedBytes: 0, keptBytes: 0 }),
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
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：模型配置是应用级的东西，不碰书里的设定文件，
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
  // 多稿两枚（P0-②）：这份夹具测的是连接配置，选稿丢稿一个都不该被调到——越界当场喊出来。
  pickDraft: async () => {
    throw new Error("不该在这条用例里选稿");
  },
  discardDrafts: async () => {
    throw new Error("不该在这条用例里丢稿");
  }
} satisfies RendererApi;

function store() {
  return useProviderStore();
}

const DRAFT: ConnectionDraft = {
  providerId: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  authHeader: "bearer",
  thinkingWire: "standard",
  apiKey: "sk-x"
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  providerView.mockClear();
  providerView.mockResolvedValue(VIEW);
  providerSave.mockClear();
  // 与主进程一致：改一条连接是**替换**它（不是再追加一条同 id 的），
  // 新建时每次都铸一个全新 id，并把刚存那条的 id 一起回传——渲染层不许靠地址反查。
  let minted = 0;
  providerSave.mockImplementation(async (draft: ConnectionDraft) => {
    const id = draft.connectionId ?? `c-new-${++minted}`;
    return {
      connections: [
        ...VIEW.connections.filter((connection) => connection.id !== id),
        {
          id,
          providerId: draft.providerId,
          label: draft.providerId,
          baseURL: draft.baseURL,
          authHeader: draft.authHeader,
          thinkingWire: "standard",
          hasKey: draft.apiKey !== null && draft.apiKey !== "",
          keyMask: "••••9999"
        }
      ],
      profiles: VIEW.profiles,
      connectionId: id
    };
  });
  providerConnectionRemove.mockClear();
  listModels.mockClear();
  listModels.mockResolvedValue({ ok: true, models: ["mochen-8B", "mochen-mock"] });
  providerVerify.mockClear();
  providerVerify.mockResolvedValue({
    state: "ok",
    modelCount: 2,
    checkedAt: "2026-10-06T00:00:00.000Z"
  });
  profileUpsert.mockClear();
  profileRemove.mockClear();
  profileEnable.mockClear();
});

describe("useProviderStore · 视图", () => {
  it("refresh 成功 ⇒ view 就位、error 清空、chip 报得出当前模型名", async () => {
    await store().refresh();
    const s = store();
    expect(s.view).toEqual(VIEW);
    expect(s.error).toBe("");
    expect(s.modelLabel).toBe("mochen-mock");
    expect(s.configured).toBe(true);
  });

  it("refresh 失败 ⇒ 收成剥壳后的中文单句，且不清掉已知的视图（读失败不等于配置变了）", async () => {
    const s = store();
    await s.refresh();
    providerView.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'provider:get': Error: 模型配置文件读取失败（EBUSY: resource busy or locked）；请检查该文件是否被占用或有访问权限。"
      )
    );
    await s.refresh();
    expect(s.error).toBe("模型配置文件读取失败；请检查该文件是否被占用或有访问权限。");
    expect(s.view).toEqual(VIEW);
  });

  it("一条档案都没启用 ⇒ configured 为假、chip 不摆空模型名", async () => {
    providerView.mockResolvedValueOnce({
      ...VIEW,
      profiles: VIEW.profiles.map((profile) => ({ ...profile, enabled: false }))
    });
    const s = store();
    await s.refresh();
    expect(s.modelLabel).toBe("");
    expect(s.configured).toBe(false);
  });

  it("**多家并存**：连接与档案各自成表，能按连接归拢（这轮改动的目的）", async () => {
    const s = store();
    await s.refresh();
    expect(s.view?.connections).toHaveLength(2);
    expect(s.connectionOf("c-mimo")?.label).toBe("小米 MiMo");
    // 头形态跟着连接走：MiMo 只能走 api-key。
    expect(s.connectionOf("c-mimo")?.authHeader).toBe("api-key");
    expect(profilesOfConnection(s.view, "c-deep").map((p) => p.model)).toEqual([
      "mochen-mock",
      "mochen-8B"
    ]);
    expect(profilesOfConnection(s.view, "c-mimo").map((p) => p.model)).toEqual(["mimo-v2.6-pro"]);
    expect(profilesOfConnection(s.view, "不存在")).toEqual([]);
  });
});

describe("useProviderStore · 拉列表", () => {
  it("只拉一次：第二次 open 用缓存，force 才再出网", async () => {
    const s = store();
    await s.loadModels();
    await s.loadModels();
    expect(listModels).toHaveBeenCalledTimes(1);
    await s.loadModels(true);
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it("拉取中 modelsLoading 为真，成功后复位并带出列表", async () => {
    const s = store();
    const pending = s.loadModels();
    expect(s.modelsLoading).toBe(true);
    await pending;
    expect(s.modelsLoading).toBe(false);
    expect(s.models).toEqual({ ok: true, models: ["mochen-8B", "mochen-mock"] });
  });

  it("通道本身被拒（主进程抛）⇒ 收成 ok:false 的中文理由，不把 rejection 留给浮层", async () => {
    listModels.mockRejectedValueOnce(
      new Error("Error invoking remote method 'x': Error: 内部炸了")
    );
    const s = store();
    await s.loadModels();
    expect(s.models).toEqual({ ok: false, reason: "内部炸了" });
    expect(s.modelsLoading).toBe(false);
  });

  /**
   * 回归钉：并发拉取时**只认最后一次**。
   * 「边打边拉」会同时在飞两个请求——地址框失焦那个还没密钥、防抖那个已经带上了密钥。
   * 谁先回谁说了算的话，先发的慢一拍回来就把正确结果盖掉，
   * 界面上挂着一句「密钥无效」而密钥其实是对的。
   * 2026-10-06 真机上两次跑出来一次空一次 12 个，就是这个。
   */
  it("慢的旧回包不许盖掉新的（密钥无效那条不能留下来）", async () => {
    const s = store();
    let releaseSlow: (v: ModelListResult) => void = () => {};
    listModels.mockImplementationOnce(
      () =>
        new Promise<ModelListResult>((resolve) => {
          releaseSlow = resolve;
        })
    );
    const slow = s.loadModels(true, { baseURL: "u", apiKey: "", authHeader: "bearer" });
    // 第二个请求（带密钥）先回
    await s.loadModels(true, { baseURL: "u", apiKey: "sk-good", authHeader: "bearer" });
    expect(s.models).toEqual({ ok: true, models: ["mochen-8B", "mochen-mock"] });
    // 旧的（无密钥）这时才回来 —— 必须被丢弃
    releaseSlow({ ok: false, reason: "密钥无效" });
    await slow;
    expect(s.models).toEqual({ ok: true, models: ["mochen-8B", "mochen-mock"] });
    expect(s.modelsLoading).toBe(false);
  });

  it("loading 也只由最新那次收：旧的 finally 不许把还在飞的标记收掉", async () => {
    const s = store();
    let releaseSlow: () => void = () => {};
    listModels.mockImplementationOnce(
      () =>
        new Promise<ModelListResult>(() => {
          releaseSlow = () => {};
        })
    );
    const slow = s.loadModels(true, { baseURL: "u", apiKey: "", authHeader: "bearer" });
    await s.loadModels(true, { baseURL: "u", apiKey: "sk", authHeader: "bearer" });
    // 第一个请求还挂着，但它过时了：loading 归第二次管，现在已经收完了。
    expect(s.modelsLoading).toBe(false);
    void slow;
    void releaseSlow;
  });

  it("带草稿的拉取**原样把草稿递下去**（地址/密钥/头形态三样都不许在渲染层被改写）", async () => {
    const s = store();
    await s.loadModels(true, {
      baseURL: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-mimo",
      authHeader: "api-key"
    });
    expect(listModels).toHaveBeenCalledWith({
      baseURL: "https://api.xiaomimimo.com/v1",
      apiKey: "sk-mimo",
      authHeader: "api-key"
    });
  });
});

describe("useProviderStore · 连通性体检（软校验）", () => {
  it("体检结果**按连接存下来**，卡片上才摆得出「连不连得上」", async () => {
    const s = store();
    await s.verifyConnection("c-deep");
    expect(providerVerify).toHaveBeenCalledWith("c-deep");
    expect(s.verify["c-deep"]).toEqual({
      state: "ok",
      modelCount: 2,
      checkedAt: "2026-10-06T00:00:00.000Z"
    });
  });

  it("连不上也要**存下来并带理由**——不存等于卡片上只剩一句空配置", async () => {
    providerVerify.mockResolvedValueOnce({
      state: "unreachable",
      reason: "密钥无效或没被授权拉取模型列表",
      checkedAt: "2026-10-06T00:00:00.000Z"
    });
    const s = store();
    const result = await s.verifyConnection("c-deep");
    expect(result.state).toBe("unreachable");
    expect(s.verify["c-deep"]?.state).toBe("unreachable");
  });

  it("通道被拒也收成「连不上」而不是抛出去（体检是附加信息，不该打断设置页）", async () => {
    providerVerify.mockRejectedValueOnce(new Error("主进程没起来"));
    const s = store();
    const result = await s.verifyConnection("c-deep");
    expect(result.state).toBe("unreachable");
    expect(s.verify["c-deep"]?.state).toBe("unreachable");
  });

  it("**改过连接就清掉旧体检结果**（地址/密钥可能全变了，摆着上一次的「连得上」等于骗人）", async () => {
    const s = store();
    await s.verifyConnection("c-deep");
    expect(s.verify["c-deep"]).toBeDefined();
    await s.saveConnection({ ...DRAFT, connectionId: "c-deep" });
    expect(s.verify["c-deep"]).toBeUndefined();
  });

  it("删连接时连它的体检结果一起清（不留下一个指向已删连接的旧状态）", async () => {
    const s = store();
    await s.refresh();
    await s.verifyConnection("c-mimo");
    await s.removeConnection("c-mimo");
    expect(s.verify["c-mimo"]).toBeUndefined();
    expect(providerConnectionRemove).toHaveBeenCalledWith("c-mimo");
  });
});

describe("useProviderStore · 切模型（走档案：加一条并启用）", () => {
  it("选一条 ⇒ 把「模型名 + 走哪条连接」一起发下去，不碰连接（不重发密钥、不重发地址）", async () => {
    const s = store();
    await s.refresh();
    const ok = await s.select({ model: "mochen-8B", connectionId: "c-deep" });
    expect(ok).toBe(true);
    expect(providerSave).not.toHaveBeenCalled();
    expect(profileUpsert).toHaveBeenCalledWith({ model: "mochen-8B", connectionId: "c-deep" });
    expect(s.modelLabel).toBe("mochen-8B");
    expect(s.configured).toBe(true);
  });

  it("**跨连接切模型**：选 MiMo 那条 ⇒ 发的是它的连接，视图跟着换", async () => {
    const s = store();
    await s.refresh();
    await s.select({ model: "mimo-v2.6-pro", connectionId: "c-mimo" });
    expect(profileUpsert).toHaveBeenCalledWith({ model: "mimo-v2.6-pro", connectionId: "c-mimo" });
    expect(s.modelLabel).toBe("mimo-v2.6-pro");
  });

  it("连接还没配 ⇒ 不本地拦（那是主进程 know 的事），把那句人话原样摆出来并返回假", async () => {
    profileUpsert.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'provider:profile-upsert': Error: 还没有配置连接，先在模型设置里填好地址与密钥。"
      )
    );
    const s = store();
    await s.refresh();
    const ok = await s.select({ model: "mochen-8B", connectionId: "c-deep" });
    expect(ok).toBe(false);
    expect(s.error).toBe("还没有配置连接，先在模型设置里填好地址与密钥。");
    expect(s.view).toEqual(VIEW);
  });

  it("切换被拒 ⇒ error 可见、视图停在原值、switching 复位", async () => {
    profileUpsert.mockRejectedValueOnce(
      new Error("Error invoking remote method 'provider:profile-upsert': Error: 密钥保管不可用")
    );
    const s = store();
    await s.refresh();
    const ok = await s.select({ model: "mochen-8B", connectionId: "c-deep" });
    expect(ok).toBe(false);
    expect(s.error).toBe("密钥保管不可用");
    expect(s.modelLabel).toBe("mochen-mock");
    expect(s.switching).toBe(false);
  });

  it("切换进行中 switching 为真：弹层不许让你连点第二次", async () => {
    let release: () => void = () => {};
    profileUpsert.mockImplementationOnce(
      () => new Promise<ProviderView>((resolve) => (release = () => resolve(VIEW)))
    );
    const s = store();
    await s.refresh();
    const pending = s.select({ model: "mochen-8B", connectionId: "c-deep" });
    expect(s.switching).toBe(true);
    release();
    await pending;
    expect(s.switching).toBe(false);
  });
});

describe("useProviderStore · 从输入卡切模型（switchModel）", () => {
  /**
   * 2026-10-08 真机撞出来的死功能：点模型 chip、点名单里的一行，什么都没发生。
   * 根因是**传参形状**——渲染层把裸模型名当草稿发下去，主进程收的是
   * `ProfileDraft`（zod `{model, connectionId}`），当场拒收抛 "Invalid input"，
   * 错误又被吞进只在设置页渲染的 `error` ⇒ 浮层里零解释。
   *
   * 下面第一条就是**形状守卫**：它盯的不是某个模型名，是 `typeof arg === "object"`。
   * 名单型判据（认得那几个模型名才放行）一换名单就静默作废，别写那种。
   */
  it("**形状**：发下去的是 {model, connectionId} 对象，不是裸模型名", async () => {
    const s = store();
    await s.refresh();
    const ok = await s.switchModel("mochen-8B");
    expect(ok).toBe(true);
    expect(profileUpsert).toHaveBeenCalledTimes(1);
    const arg = profileUpsert.mock.calls[0]?.[0];
    expect(typeof arg).toBe("object");
    expect(arg).not.toBeNull();
    expect(arg).toEqual({ model: "mochen-8B", connectionId: "c-deep" });
  });

  it("连接跟的是**启用中那条**档案（p-1 在 c-deep），不是视图里第一条连接", async () => {
    const s = store();
    await s.refresh();
    expect(s.activeConnectionId).toBe("c-deep");
    await s.switchModel("mochen-8B");
    expect(profileUpsert).toHaveBeenCalledWith({ model: "mochen-8B", connectionId: "c-deep" });
  });

  it("启用中那条换了连接 ⇒ 跟着换（名单是按启用中那条拉的，写回同一条不是推断）", async () => {
    profileEnable.mockImplementationOnce(async (id: string, enabled: boolean) => ({
      ...VIEW,
      profiles: VIEW.profiles.map((profile) => ({
        ...profile,
        enabled: profile.id === id ? enabled : false
      }))
    }));
    const s = store();
    await s.refresh();
    await s.enableProfile("p-3", true); // mimo-v2.6-pro 在 c-mimo
    expect(s.activeConnectionId).toBe("c-mimo");
    await s.switchModel("mochen-8B");
    expect(profileUpsert).toHaveBeenCalledWith({ model: "mochen-8B", connectionId: "c-mimo" });
  });

  it("activeBaseURL 与 activeConnectionId 读同一条事实：一条都没启用时都老实变空", async () => {
    profileEnable.mockImplementationOnce(async (): Promise<ProviderView> => ({
      ...VIEW,
      profiles: VIEW.profiles.map((profile) => ({ ...profile, enabled: false }))
    }));
    const s = store();
    await s.refresh();
    await s.enableProfile("p-1", false);
    expect(s.activeConnectionId).toBe("");
    expect(s.activeBaseURL).toBe("");
    expect(s.modelLabel).toBe("");
  });

  it("一条都没启用 ⇒ 不发 IPC（空 connectionId 必被 schema 拒），并把理由摆进 switchError", async () => {
    profileEnable.mockImplementationOnce(async (): Promise<ProviderView> => ({
      ...VIEW,
      profiles: VIEW.profiles.map((profile) => ({ ...profile, enabled: false }))
    }));
    const s = store();
    await s.refresh();
    await s.enableProfile("p-1", false);
    const before = profileUpsert.mock.calls.length;
    const ok = await s.switchModel("mochen-8B");
    expect(ok).toBe(false);
    expect(profileUpsert.mock.calls.length).toBe(before);
    expect(s.switchError).not.toBe("");
    expect(s.switchError).toContain("启用");
  });

  /**
   * 「点了没反应」的反面：切不过去时**必须有一句看得见的话**。
   * 这一条钉的是当年那个 bug 的另一半——形状错了还只是不生效，
   * 形状对了但失败静默，用户照样只能报「不能切换模型」。
   */
  it("主进程拒绝 ⇒ switchError 是剥过外壳的那句人话、返回假、模型名不动", async () => {
    profileUpsert.mockRejectedValueOnce(
      new Error("Error invoking remote method 'provider:profile-upsert': Error: 密钥保管不可用")
    );
    const s = store();
    await s.refresh();
    const ok = await s.switchModel("mochen-8B");
    expect(ok).toBe(false);
    expect(s.switchError).toBe("密钥保管不可用");
    expect(s.modelLabel).toBe("mochen-mock");
    expect(s.switching).toBe(false);
  });

  it("成功 ⇒ switchError 复位为空（否则上一次失败的话会赖在下一次成功的界面上）", async () => {
    const s = store();
    await s.refresh();
    profileUpsert.mockRejectedValueOnce(new Error("Error: 一次性失败"));
    await s.switchModel("mochen-8B");
    expect(s.switchError).not.toBe("");
    const ok = await s.switchModel("mochen-8B");
    expect(ok).toBe(true);
    expect(s.switchError).toBe("");
  });

  it("切过去 ⇒ modelLabel 跟到新模型名（配置页那枚开关与 chip 显示的是同一个事实）", async () => {
    const s = store();
    await s.refresh();
    await s.switchModel("mochen-8B");
    expect(s.modelLabel).toBe("mochen-8B");
    expect(s.configured).toBe(true);
  });
});

describe("useProviderStore · 档案管理", () => {
  it("删一条 ⇒ 收下回包；删的正是启用那条时 modelLabel 老实变空（不假装还有模型）", async () => {
    profileRemove.mockImplementationOnce(async (id: string): Promise<ProviderView> => ({
      ...VIEW,
      profiles: VIEW.profiles.filter((profile) => profile.id !== id)
    }));
    const s = store();
    await s.refresh();
    await s.removeProfile("p-1");
    expect(profileRemove).toHaveBeenCalledWith("p-1");
    expect(s.modelLabel).toBe("");
    expect(s.configured).toBe(false);
  });

  it("删一条被拒 ⇒ error 可见、视图不动（列表没有被乐观地改掉）", async () => {
    profileRemove.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'provider:profile-remove': Error: 没有找到这条模型，可能已经被删除。"
      )
    );
    const s = store();
    await s.refresh();
    await s.removeProfile("p-x");
    expect(s.error).toBe("没有找到这条模型，可能已经被删除。");
    expect(s.view).toEqual(VIEW);
  });

  it("启停一条 ⇒ 带 id 与布尔下去，回包里新的启用态说了算", async () => {
    const s = store();
    await s.refresh();
    await s.enableProfile("p-2", true);
    expect(profileEnable).toHaveBeenCalledWith("p-2", true);
    expect(s.modelLabel).toBe("mochen-8B");
    expect(s.error).toBe("");
  });
});

describe("useProviderStore · 保存连接", () => {
  it("成功 ⇒ 用主进程回的视图覆盖本地，渲染层永远拿不回明文密钥", async () => {
    const s = store();
    const savedId = await s.saveConnection(DRAFT);
    expect(savedId).toBe("c-new-1");
    expect(providerSave).toHaveBeenCalledWith(DRAFT);
    expect(s.error).toBe("");
    // 回包里只有掩码：明文 apiKey 一个字都不该留在渲染层状态里。
    expect(JSON.stringify(s.view)).not.toContain("sk-x");
  });

  /**
   * 回归钉：同一地址存两条连接时，回执里的 id 必须是**刚存的那条**。
   * 曾经对话框是拿地址回头 find 的，于是个人号 + 企业号这种并存配置
   * 会把模型挂到先存的那条上——用户看到的是「刚配的连接下空着一个模型」。
   */
  it("同地址第二条连接：回执给的是新那条的 id，不是视图里先出现的那条", async () => {
    const s = store();
    const first = await s.saveConnection(DRAFT);
    const second = await s.saveConnection(DRAFT);
    expect(first).not.toBe(second);
    // 两条地址一模一样 ⇒ 只有回执能区分，回执必须给得出区分。
    const sameURL = s.view?.connections.filter((c) => c.baseURL === DRAFT.baseURL) ?? [];
    expect(sameURL.length).toBe(2);
    expect(second).toBe(sameURL[1]?.id);
  });

  it("**原样递下头形态**（MiMo 那条是 api-key；渲染层不许自作主张一律 Bearer）", async () => {
    const s = store();
    await s.saveConnection({
      providerId: "mimo",
      baseURL: "https://api.xiaomimimo.com/v1",
      authHeader: "api-key",
      thinkingWire: "standard",
      apiKey: null
    });
    expect(providerSave).toHaveBeenCalledWith({
      providerId: "mimo",
      baseURL: "https://api.xiaomimimo.com/v1",
      authHeader: "api-key",
      thinkingWire: "standard",
      apiKey: null
    });
  });

  it("失败 ⇒ 视图不动、error 是那句可执行中文、返回假", async () => {
    const s = store();
    await s.refresh();
    providerSave.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'provider:save': Error: baseURL 必须以 http:// 或 https:// 开头"
      )
    );
    const savedId = await s.saveConnection({ ...DRAFT, baseURL: "ftp://a" });
    expect(savedId).toBeNull();
    expect(s.error).toBe("baseURL 必须以 http:// 或 https:// 开头");
    expect(s.view).toEqual(VIEW);
  });

  it("换配置后列表作废：下次 open 必须重新拉，不把旧地址的模型摆给新地址", async () => {
    const s = store();
    await s.loadModels();
    await s.saveConnection({ ...DRAFT, baseURL: "http://other.test/v1" });
    expect(s.models).toBeNull();
    await s.loadModels();
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});

describe("warmModelCache · 启动预拉模型清单（2026-10-11）", () => {
  it("有启用模型且缓存为空 ⇒ 预拉一次；点开下拉（loadModels）不再发请求", async () => {
    const s = store();
    await s.warmModelCache();
    expect(listModels).toHaveBeenCalledTimes(1);
    // 点开下拉走的就是缓存：不再打网络。
    await s.loadModels();
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(s.models?.ok).toBe(true);
  });

  it("预拉失败不落缓存：点开下拉时仍是干净的首次尝试", async () => {
    const s = store();
    listModels.mockRejectedValueOnce(new Error("网络抖动"));
    await s.warmModelCache();
    expect(s.models).toBeNull(); // 失败没被钉进缓存
    await s.loadModels();
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(s.models?.ok).toBe(true);
  });

  it("没有启用中的模型 ⇒ 不预拉（主进程只会回「没启用」，白打一轮）", async () => {
    providerView.mockResolvedValueOnce({
      ...VIEW,
      profiles: VIEW.profiles.map((p) => ({ ...p, enabled: false }))
    });
    const s = store();
    await s.warmModelCache();
    expect(listModels).not.toHaveBeenCalled();
  });
});

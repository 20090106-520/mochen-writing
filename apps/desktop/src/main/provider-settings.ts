import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CUSTOM_PROVIDER_ID,
  LEGACY_CONNECTION_ID,
  connectionDraftSchema,
  customConnectionLabel,
  detectProviderByBaseURL,
  effectiveContextWindowOf,
  firstIssueMessage,
  maskApiKey,
  migrateProviderStore,
  profileDraftSchema,
  providerConnectionSchema,
  providerLabelOf,
  providerProfileSchema,
  type AuthHeader,
  type ConnectionDraft,
  type ProfileDraft,
  type ProviderConfig,
  type ProviderConnection,
  type ProviderConnectionView,
  type ProviderProfile,
  type ProviderSaveResult,
  type ProviderStoreFile,
  type ProviderView
} from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "@mochen/fs-store";
import type { CredentialStore, ReadTextFile } from "./credential-store.js";

/** 模型分工的两条通路（2026-11-20）：写作轮与后台杂活（摘要 / 全书状态卡）。 */
export type ModelRole = "chat" | "utility";

export interface ProviderSettings {
  view(): Promise<ProviderView>;
  /**
   * 按用途取一次可发请求的配置（2026-11-20）。
   *
   * 解析顺序住在这里一处：目标档案 → 启用档案 → 第一条可用档案。
   * 「可用」= 档案存在、连接存在、且该连接的密钥读得到。全不可用回 null。
   */
  configFor(role: ModelRole): Promise<{ config: ProviderConfig; apiKey: string } | null>;
  /** 写作轮要的取数形状：`configFor("chat")` 的投影，保留旧调用方与旧语义。 */
  config(): Promise<ProviderConfig | null>;
  /** 写作轮那条档案用的密钥（同样走 `configFor("chat")`）。 */
  apiKey(): Promise<string | null>;
  /** 指定 / 清空「后台杂活模型」：null = 跟随主模型。 */
  setUtilityProfile(profileId: string | null): Promise<ProviderView>;
  /**
   * 某条连接的出网取数：地址 + 请求头形态 + 该连接自己的密钥。
   * 拉名单与体检都走它（provider-models），所以「发哪种头」只有这一份实现。
   * 连接不存在返回 null，调用方自己收成一句人话。
   */
  connectionTarget(
    connectionId: string
  ): Promise<{ baseURL: string; authHeader: AuthHeader; key: string | null } | null>;
  /** 新建或改一条连接（apiKey null = 沿用、"" = 明确清空）。回执带刚存那条的 id。 */
  saveConnection(draft: ConnectionDraft): Promise<ProviderSaveResult>;
  /** 删一条连接：连同挂在它下面的档案一起删。 */
  removeConnection(connectionId: string): Promise<ProviderView>;
  /** 加一条档案并设为启用（同名 + 同连接 幂等）。 */
  upsertProfile(draft: ProfileDraft): Promise<ProviderView>;
  removeProfile(id: string): Promise<ProviderView>;
  /** 启停互斥：启用某条时其余自动停用。 */
  enableProfile(id: string, enabled: boolean): Promise<ProviderView>;
}

/**
 * 卡片上那条连接叫什么（2026-10-06 批次 5-⑧）。
 *
 * **自定义连接也要试着认出服务商**（用户 2026-10-06 明确要的）：
 * 此前自定义一律显示「自定义 · 主机名」，于是用户把官方文档里的地址粘进来、存好、配好，
 * 卡片上仍然写着「自定义」——那不是「自定义」，那是没认出来。
 * 认出官方那几家就显示真名（DeepSeek / 小米 MiMo / …），
 * 认不出的（真的中转站、本机端点）仍旧显示「自定义 · 主机名」，一字不变。
 *
 * 纯函数、离线：判据在 contracts 的 `detectProviderByBaseURL`，这里只是选用哪一支。
 */
export function connectionLabelOf(connection: ProviderConnection): string {
  if (connection.providerId !== CUSTOM_PROVIDER_ID) {
    return providerLabelOf(connection.providerId);
  }
  const detected = detectProviderByBaseURL(connection.baseURL);
  return detected.known ? detected.label : customConnectionLabel(connection.baseURL);
}

/**
 * 把草稿里那**两格模型能力**写回一条档案（2026-11-21）。
 *
 * 语义与 `apiKey` 同一族：
 * - `undefined` = 调用方没带这一格 ⇒ **保持现状**（不清掉用户之前设过的）；
 * - `null` = 明确清空 ⇒ 删掉这一格，回到能力表与该模型的默认档；
 * - 数字 / 档位 = 设成这一份。
 *
 * 为什么是「模型级」而不是连接级：窗口与思考档都是**模型**的属性——
 * 同一端点下 `MiniMax-M3.1-Flash` 与 `MiniMax-M3` 都是 1M 窗口，而同一家别的模型不是；
 * 思考档更是一个模型认哪几档说了算（MiniMax-M3 官方明写它忽略 `reasoning_effort`）。
 */
function applyModelCapability(
  profile: ProviderProfile,
  draft: Pick<ProfileDraft, "contextWindow" | "thinkingLevel">
): ProviderProfile {
  const next: ProviderProfile = { ...profile };
  if (draft.contextWindow !== undefined) {
    if (draft.contextWindow === null) delete next.contextWindow;
    else next.contextWindow = draft.contextWindow;
  }
  if (draft.thinkingLevel !== undefined) {
    if (draft.thinkingLevel === null) delete next.thinkingLevel;
    else next.thinkingLevel = draft.thinkingLevel;
  }
  return next;
}

export function createProviderSettings(deps: {
  dir: string;
  credentials: CredentialStore;
  readFile?: ReadTextFile;
  /** 写盘缝（P0-5）：默认真 fs，测试注入「只坏一步」的实现来证明中途失败时目标文件完好。命名同 book-service。 */
  fs?: AtomicWriteFs;
}): ProviderSettings {
  const configFile = path.join(deps.dir, "config.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  const writeFs: AtomicWriteFs = deps.fs ?? defaultAtomicFs;
  // 装载一次后驻内存（本进程是这份文件的唯一写者）：id 从此稳定，
  // 也不必每次读盘都重走一遍迁移。写操作内存改完即落盘。
  //
  // 【`loaded` 什么时候才许抬上去——P0-5 的全部教训在这两行】
  // 原先是「先置 loaded = true 再 await 读盘」：非 ENOENT 的 IO 错误（EBUSY/EACCES——Windows 上
  // 杀软、OneDrive、备份正在扫这个文件）确实抛了，可 `loaded` 已经抬上去、`cached` 停在 null，
  // 于是**第二次起这份配置就被当成「从来没配过」**：设置页显示空、`config()` 返 null，
  // 用户照着提示填一条连接 ⇒ `saveConnection` 以 `store === null` 走新建分支、整份重写 config.json，
  // 其余连接与全部模型档案一次冲掉，密钥文件按新 UUID 改名、旧的 `<连接id>.enc` 再也清不掉。
  // 现在只在**真的读完**（含合法的「文件不存在 = null」）之后才置位：读失败就保持未装载，
  // 下一次调用重新读一遍——盘恢复了自己就好，盘没恢复就一直抛人话，中间没有任何静默覆盖。
  let cached: ProviderStoreFile | null = null;
  let loaded = false;

  async function readRawText(): Promise<string | null> {
    // 只有 ENOENT（从未配置）才返回 null；EBUSY/EACCES 等真实 IO 错误向外抛，
    // 否则「未配置模型」守卫会在配置文件只是读不了（被占用/无权限）时误触发。
    try {
      return await readText(configFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        `模型配置文件读取失败（${error instanceof Error ? error.message : String(error)}）；` +
          "请检查该文件是否被占用或有访问权限。",
        { cause: error }
      );
    }
  }

  /**
   * 落盘：走原子通路（P0-5 与 P0-1 同一条线）。
   *
   * 裸 `writeFile(configFile, …)` 是「先截断再写」：写到一半 ENOSPC / 断电 / 杀软正在读这个文件，
   * 留下的就是半截 JSON——下次启动 `JSON.parse` 直接失败，用户的全部模型配置没了，
   * 而且一句提示都收不到。同目录临时文件 + 一次改名：外界要么看到旧的一份，要么看到新的一份。
   * `mkdir` 由 `writeFileAtomic` 自己按目标目录做，这里不再单独来一遍。
   */
  async function writeStore(store: ProviderStoreFile): Promise<void> {
    await writeFileAtomic(configFile, `${JSON.stringify(store, null, 2)}\n`, writeFs);
  }

  /**
   * 装载一次并缓住。**抛出去的每一条路径都不许留下「已装载」**——理由见上面 `loaded` 那段。
   */
  async function ensure(): Promise<ProviderStoreFile | null> {
    if (loaded) return cached;
    const raw = await readRawText();
    if (raw === null || raw.trim() === "") {
      loaded = true;
      return (cached = null);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `模型配置文件不可读：${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    // v1 / v2 / v3 三代都在这里收住（migrateProviderStore 是纯函数，出网与落盘都不归它管）。
    const { store, migrated } = migrateProviderStore(parsed);
    if (!migrated) {
      loaded = true;
      return (cached = store);
    }
    // 迁移后写回：从此往后这份文件是 v3，不必每次读盘都重走一遍。
    //
    // **密钥要一起搬**：老版那一份在 `secrets.enc`，v3 存在 `secrets/<连接id>.enc`。
    // 不搬的话用户升级后所有连接都变成「没有密钥」，配置看着还在、一发请求就 401。
    // 搬失败不阻断迁移（下面会补一句人话让用户重填），但要记下来。
    try {
      if (await deps.credentials.hasLegacy()) {
        await deps.credentials.moveLegacyTo(store.connections[0]?.id ?? LEGACY_CONNECTION_ID);
      }
    } catch (error) {
      console.error("旧密钥搬移失败，用户需要在模型设置里重新填一次 API Key", error);
    }
    await writeStore(store);
    loaded = true;
    return (cached = store);
  }

  function connectionOf(store: ProviderStoreFile, connectionId: string): ProviderConnection | null {
    return store.connections.find((connection) => connection.id === connectionId) ?? null;
  }

  async function toView(store: ProviderStoreFile | null): Promise<ProviderView> {
    const connections: ProviderConnectionView[] = [];
    for (const connection of store?.connections ?? []) {
      // 每条连接各读各的密钥（多供应商并存的根需求）；读不到就把这一条标成「没密钥」而不是整份视图失败——
      // 别的连接是好的，不该被一条读坏的全盘挡住。
      let key: string | null = null;
      try {
        key = await deps.credentials.read(connection.id);
      } catch (error) {
        console.error(`读取连接 ${connection.id} 的密钥失败`, error);
      }
      connections.push({
        id: connection.id,
        providerId: connection.providerId,
        label: connectionLabelOf(connection),
        baseURL: connection.baseURL,
        authHeader: connection.authHeader,
        thinkingWire: connection.thinkingWire,
        // 没填过就不写这个键：设置页能看出「用的是默认值」，配置里也不留一个假数（P0-3）。
        ...(connection.contextWindow === undefined
          ? {}
          : { contextWindow: connection.contextWindow }),
        hasKey: key !== null,
        keyMask: key === null ? "" : maskApiKey(key)
      });
    }
    const profiles = (store?.profiles ?? []).map((profile) => ({
      id: profile.id,
      connectionId: profile.connectionId,
      model: profile.model,
      enabled: profile.enabled,
      // 两格能力没设过就不写这个键：视图层要能分清「用户设过」与「没设过」，
      // 而 exactOptionalPropertyTypes 下「键在但值是 undefined」与「键不在」是两回事。
      ...(profile.contextWindow === undefined ? {} : { contextWindow: profile.contextWindow }),
      ...(profile.thinkingLevel === undefined ? {} : { thinkingLevel: profile.thinkingLevel })
    }));
    // 悬空引用不外露：档案被删后视图里不该再出现这个 id，
    // 设置页据此回落到「跟随主模型」，而不是显示一条已经不存在的模型。
    const utility =
      store?.utilityProfileId !== undefined &&
      profiles.some((profile) => profile.id === store.utilityProfileId)
        ? { utilityProfileId: store.utilityProfileId }
        : {};
    return { connections, profiles, ...utility };
  }

  /** 落盘前的最后一道形状关卡（id 由本模块生成，model 由调用方保证非空）。 */
  function checkedProfiles(profiles: ProviderProfile[]): ProviderProfile[] {
    return profiles.map((profile) => providerProfileSchema.parse(profile));
  }

  /** 把一条档案 + 它的连接解析成可发请求的形状；连接缺失 / 密钥读不到都算不可用。 */
  async function resolveProfile(
    store: ProviderStoreFile,
    profile: ProviderProfile
  ): Promise<{ config: ProviderConfig; apiKey: string } | null> {
    const connection = connectionOf(store, profile.connectionId);
    if (connection === null) return null;
    let key: string | null;
    try {
      key = await deps.credentials.read(connection.id);
    } catch (error) {
      console.error(`读取连接 ${connection.id} 的密钥失败`, error);
      return null;
    }
    // 空串是「明确清空」之后的状态：拿它发请求只会换来 401，不如当作不可用去试下一条。
    if (key === null || key === "") return null;
    // 上下文窗口（2026-11-21）：**模型级**优先，其次能力表，最后连接级那格。
    // 判据在 contracts 的 effectiveContextWindowOf 一处——占用条的分母与历史切多少
    // 都读这一格，界面与出站不许各算一遍。
    const contextWindow = effectiveContextWindowOf({
      model: profile.model,
      profileContextWindow: profile.contextWindow,
      connectionContextWindow: connection.contextWindow
    });
    return {
      config: {
        baseURL: connection.baseURL,
        model: profile.model,
        authHeader: connection.authHeader,
        thinkingWire: connection.thinkingWire,
        // 没算出来就不写这个键：调用方据此回退默认值，界面也要能看出「用的是默认值」。
        ...(contextWindow === undefined ? {} : { contextWindow })
      },
      apiKey: key
    };
  }

  /**
   * 一条通路里的候选顺序（2026-11-20）：目标 → 启用 → 其余。
   * 顺序本身是唯一判据，两个角色共用，避免「utility 的降级路和 chat 的不一样」。
   */
  function candidatesOf(store: ProviderStoreFile, role: ModelRole): ProviderProfile[] {
    const enabled = store.profiles.find((profile) => profile.enabled);
    const preferred: ProviderProfile[] = [];
    if (role === "utility" && store.utilityProfileId !== undefined) {
      const hit = store.profiles.find((profile) => profile.id === store.utilityProfileId);
      if (hit !== undefined) preferred.push(hit);
    }
    if (enabled !== undefined && !preferred.includes(enabled)) preferred.push(enabled);
    // 剩下的按存储顺序补齐：用户没指定 / 指定的坏了，也还有别的档案可试。
    return [...preferred, ...store.profiles.filter((profile) => !preferred.includes(profile))];
  }

  async function configFor(
    role: ModelRole
  ): Promise<{ config: ProviderConfig; apiKey: string } | null> {
    const store = await ensure();
    if (store === null) return null;
    for (const profile of candidatesOf(store, role)) {
      const resolved = await resolveProfile(store, profile);
      if (resolved !== null) return resolved;
    }
    return null;
  }

  return {
    async view() {
      return toView(await ensure());
    },

    configFor,

    // 两个旧入口都成了 configFor("chat") 的投影：判据一处，不再有第二套「启用中的那条」。
    async config() {
      return (await configFor("chat"))?.config ?? null;
    },

    async apiKey() {
      return (await configFor("chat"))?.apiKey ?? null;
    },

    async setUtilityProfile(profileId) {
      const store = await ensure();
      if (store === null) throw new Error("还没有配置模型，先添加一条连接与模型。");
      if (profileId !== null && !store.profiles.some((profile) => profile.id === profileId))
        throw new Error("没有找到这条模型，可能已经被删除。");
      const profiles = checkedProfiles(store.profiles);
      const next: ProviderStoreFile = {
        connections: store.connections,
        profiles,
        ...(profileId === null ? {} : { utilityProfileId: profileId })
      };
      await writeStore(next);
      cached = next;
      return toView(next);
    },

    async connectionTarget(connectionId) {
      const store = await ensure();
      if (store === null) return null;
      const connection = connectionOf(store, connectionId);
      if (connection === null) return null;
      let key: string | null = null;
      try {
        key = await deps.credentials.read(connection.id);
      } catch (error) {
        console.error(`读取连接 ${connection.id} 的密钥失败`, error);
      }
      return { baseURL: connection.baseURL, authHeader: connection.authHeader, key };
    },

    async saveConnection(draft) {
      // 连接设置的拒绝同样是跨 IPC 的用户可见文案（裁定 n）：只留单句中文，不留 issue 数组。
      const parsed = connectionDraftSchema.safeParse(draft);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "连接设置没保存：填写的内容不对。"));
      const store = await ensure();
      const existing =
        parsed.data.connectionId === undefined
          ? null
          : store === null
            ? null
            : connectionOf(store, parsed.data.connectionId);
      if (parsed.data.connectionId !== undefined && existing === null)
        throw new Error("没有找到这条连接，可能已经被删除。");

      // 上下文窗口（P0-3）：undefined = 调用方没带这一格（沿用旧值）；null = 明确清空。
      const contextWindow =
        parsed.data.contextWindow === undefined
          ? existing?.contextWindow
          : parsed.data.contextWindow === null
            ? undefined
            : parsed.data.contextWindow;
      const connection: ProviderConnection = providerConnectionSchema.parse({
        id: existing?.id ?? randomUUID(),
        providerId: parsed.data.providerId,
        baseURL: parsed.data.baseURL,
        authHeader: parsed.data.authHeader,
        thinkingWire: parsed.data.thinkingWire,
        // 没填过就不写这个键：旧配置文件保持原样，默认值由读取方回退。
        ...(contextWindow === undefined ? {} : { contextWindow })
      });
      const connections =
        store === null
          ? [connection]
          : [...store.connections.filter((c) => c.id !== connection.id), connection];

      // 裁定：先落密钥再落 config.json。若密钥保管不可用（或恒等加密含明文），credentials.save 会抛，
      // config.json 因此不被改写——整次 save 要么全成功、要么不留半套新地址。
      //
      // **空串 = 明确要清空**（切到不需要密钥的端点时用户主动清掉云端密钥），
      // `null` 才是「沿用已存」。两者不分：不分就没法在「换回云端」之后把本地那次误存的假 key 清掉。
      if (parsed.data.apiKey === "") await deps.credentials.clear(connection.id);
      else if (parsed.data.apiKey !== null)
        await deps.credentials.save(connection.id, parsed.data.apiKey);

      const next: ProviderStoreFile = {
        connections,
        profiles: checkedProfiles(store?.profiles ?? []),
        // 改连接不该把「后台杂活模型」这一格顺手丢掉。
        ...(store?.utilityProfileId === undefined
          ? {}
          : { utilityProfileId: store.utilityProfileId })
      };
      await writeStore(next);
      cached = next;
      // id 是这里生成的，也只有这里知道是**哪一条**：同地址的两条连接并存时，
      // 调用方拿地址回头认必然认错。回传它，别让渲染层猜。
      return { ...(await toView(next)), connectionId: connection.id };
    },

    async removeConnection(connectionId) {
      const store = await ensure();
      if (store === null || !store.connections.some((c) => c.id === connectionId))
        throw new Error("没有找到这条连接，可能已经被删除。");
      const kept = store.profiles.filter((p) => p.connectionId !== connectionId);
      // 只有「剩下的一条都没启用」时才补一个；本来就有启用着的必须原样保留
      // （写成 `enabled: index === 0 && …` 会把原有的启停**覆盖**掉——
      //  接线测试当场抓到了这个：删 b 之后本该启用的 a 被写成了 false）。
      const noneEnabled = kept.length > 0 && kept.every((p) => !p.enabled);
      const profiles = kept.map((profile, index) => ({
        ...profile,
        // 删掉的正是启用中那条时，剩下的档案会**全部处于停用**——
        // 界面上「一条都没启用」，发请求时 config() 返 null，看起来像压根没配模型，
        // 而用户明明还留着能用的那些。补一个默认启用，省得他去面板里一个个拨。
        enabled: noneEnabled ? index === 0 : profile.enabled
      }));
      const next: ProviderStoreFile = {
        connections: store.connections.filter((c) => c.id !== connectionId),
        // 挂在它下面的档案一起走：留一个指向空连接的档案，卡片上就会列出一个永远发不出请求的模型。
        profiles,
        // 后台杂活指向的档案若随连接一起被删，这一格必须同时清掉，别留悬空引用。
        ...(store.utilityProfileId !== undefined &&
        profiles.some((profile) => profile.id === store.utilityProfileId)
          ? { utilityProfileId: store.utilityProfileId }
          : {})
      };
      await writeStore(next);
      cached = next;
      // 密钥随之清除：留在盘上没人能再用到它（连接都没了），却还在替用户保管一份明文。
      await deps.credentials.clear(connectionId);
      return toView(next);
    },

    async upsertProfile(draft) {
      const parsed = profileDraftSchema.safeParse(draft);
      if (!parsed.success) throw new Error(firstIssueMessage(parsed.error, "模型名不能为空。"));
      const store = await ensure();
      if (store === null) throw new Error("还没有配置连接，先在模型设置里填好地址与密钥。");
      const name = parsed.data.model.trim();
      if (connectionOf(store, parsed.data.connectionId) === null)
        throw new Error("没有找到这条连接，可能已经被删除。");
      const existing = store.profiles.find(
        (profile) => profile.model === name && profile.connectionId === parsed.data.connectionId
      );
      const next: ProviderStoreFile = {
        connections: store.connections,
        profiles: store.profiles.map((profile) => ({
          ...profile,
          enabled: profile.model === name && profile.connectionId === parsed.data.connectionId
        })),
        ...(store.utilityProfileId === undefined
          ? {}
          : { utilityProfileId: store.utilityProfileId })
      };
      // 同名幂等只在**同一条连接**上；换个供应商用同一个模型名是常事，那是两条档案。
      if (existing === undefined) {
        const created = applyModelCapability(
          {
            id: randomUUID(),
            connectionId: parsed.data.connectionId,
            model: name,
            enabled: true
          },
          parsed.data
        );
        next.profiles = [...next.profiles, created];
      } else {
        // 已有的那条：把两格能力写回去。
        // undefined = 调用方没带这一格（保持现状）；null = 明确清空（回到能力表与默认值）。
        next.profiles = next.profiles.map((profile) =>
          profile.id === existing.id ? applyModelCapability(profile, parsed.data) : profile
        );
      }
      await writeStore(next);
      cached = next;
      return toView(next);
    },

    async removeProfile(id) {
      const store = await ensure();
      if (store === null || !store.profiles.some((profile) => profile.id === id))
        throw new Error("没有找到这条模型，可能已经被删除。");
      const next: ProviderStoreFile = {
        connections: store.connections,
        profiles: store.profiles.filter((profile) => profile.id !== id),
        // 删的正是后台杂活模型 ⇒ 一起回到「跟随主模型」。
        ...(store.utilityProfileId === id || store.utilityProfileId === undefined
          ? {}
          : { utilityProfileId: store.utilityProfileId })
      };
      await writeStore(next);
      cached = next;
      return toView(next);
    },

    async enableProfile(id, enabled) {
      const store = await ensure();
      if (store === null || !store.profiles.some((profile) => profile.id === id))
        throw new Error("没有找到这条模型，可能已经被删除。");
      const next: ProviderStoreFile = {
        connections: store.connections,
        profiles: store.profiles.map((profile) => ({
          ...profile,
          // 互斥启用：开某条时其余全停；停用就是单纯停用。
          enabled: profile.id === id ? enabled : enabled ? false : profile.enabled
        })),
        ...(store.utilityProfileId === undefined
          ? {}
          : { utilityProfileId: store.utilityProfileId })
      };
      await writeStore(next);
      cached = next;
      return toView(next);
    }
  };
}

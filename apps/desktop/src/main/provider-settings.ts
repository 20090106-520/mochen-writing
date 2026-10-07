import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CUSTOM_PROVIDER_ID,
  LEGACY_CONNECTION_ID,
  connectionDraftSchema,
  customConnectionLabel,
  detectProviderByBaseURL,
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
import type { CredentialStore, ReadTextFile } from "./credential-store.js";

export interface ProviderSettings {
  view(): Promise<ProviderView>;
  /** 发一轮请求要的取数形状（agent-service 消费）：启用中那条档案 + 它那条连接的地址。 */
  config(): Promise<ProviderConfig | null>;
  /** 启用中那条档案用的密钥。**按连接取**——多供应商并存之后全局一份已经不成立。 */
  apiKey(): Promise<string | null>;
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

export function createProviderSettings(deps: {
  dir: string;
  credentials: CredentialStore;
  readFile?: ReadTextFile;
}): ProviderSettings {
  const configFile = path.join(deps.dir, "config.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  // 装载一次后驻内存（本进程是这份文件的唯一写者）：id 从此稳定，
  // 也不必每次读盘都重走一遍迁移。写操作内存改完即落盘。
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

  async function writeStore(store: ProviderStoreFile): Promise<void> {
    await mkdir(deps.dir, { recursive: true });
    await writeFile(configFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async function ensure(): Promise<ProviderStoreFile | null> {
    if (loaded) return cached;
    loaded = true;
    const raw = await readRawText();
    if (raw === null || raw.trim() === "") return (cached = null);
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
    if (!migrated) return (cached = store);
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
        hasKey: key !== null,
        keyMask: key === null ? "" : maskApiKey(key)
      });
    }
    return { connections, profiles: (store?.profiles ?? []).map((profile) => ({ ...profile })) };
  }

  /** 落盘前的最后一道形状关卡（id 由本模块生成，model 由调用方保证非空）。 */
  function checkedProfiles(profiles: ProviderProfile[]): ProviderProfile[] {
    return profiles.map((profile) => providerProfileSchema.parse(profile));
  }

  return {
    async view() {
      return toView(await ensure());
    },

    async config() {
      const store = await ensure();
      const enabled = store?.profiles.find((profile) => profile.enabled);
      if (store === null || enabled === undefined) return null;
      const connection = connectionOf(store, enabled.connectionId);
      // 外键完整性在 schema 上已经把关；这里仍兜一道：**发请求时拿不到地址就当没配**，
      // 绝不能拿一个空 baseURL 去拼 URL（那会打到一个诡异的相对路径上）。
      if (connection === null) return null;
      return {
        baseURL: connection.baseURL,
        model: enabled.model,
        authHeader: connection.authHeader
      };
    },

    async apiKey() {
      const store = await ensure();
      const enabled = store?.profiles.find((profile) => profile.enabled);
      if (store === null || enabled === undefined) return null;
      try {
        return await deps.credentials.read(enabled.connectionId);
      } catch (error) {
        console.error("读取启用模型的密钥失败", error);
        return null;
      }
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

      const connection: ProviderConnection = providerConnectionSchema.parse({
        id: existing?.id ?? randomUUID(),
        providerId: parsed.data.providerId,
        baseURL: parsed.data.baseURL,
        authHeader: parsed.data.authHeader
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
        profiles: checkedProfiles(store?.profiles ?? [])
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
      const next: ProviderStoreFile = {
        connections: store.connections.filter((c) => c.id !== connectionId),
        // 挂在它下面的档案一起走：留一个指向空连接的档案，卡片上就会列出一个永远发不出请求的模型。
        profiles: kept.map((profile, index) => ({
          ...profile,
          // 删掉的正是启用中那条时，剩下的档案会**全部处于停用**——
          // 界面上「一条都没启用」，发请求时 config() 返 null，看起来像压根没配模型，
          // 而用户明明还留着能用的那些。补一个默认启用，省得他去面板里一个个拨。
          enabled: noneEnabled ? index === 0 : profile.enabled
        }))
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
        }))
      };
      // 同名幂等只在**同一条连接**上；换个供应商用同一个模型名是常事，那是两条档案。
      if (existing === undefined)
        next.profiles = [
          ...next.profiles,
          { id: randomUUID(), connectionId: parsed.data.connectionId, model: name, enabled: true }
        ];
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
        profiles: store.profiles.filter((profile) => profile.id !== id)
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
        }))
      };
      await writeStore(next);
      cached = next;
      return toView(next);
    }
  };
}

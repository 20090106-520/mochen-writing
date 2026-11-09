import { z } from "zod";

const httpUrl = /^https?:\/\//;

/**
 * 模型上下文窗口的**保守默认值**（tokens，P0-3）。
 *
 * 为什么取 24000：本仓实测过的国内端点（DeepSeek、GLM、Kimi 的 8k 档、MiMo）里，
 * 最紧的输入档在 32k 上下；按 32k 打七折留一份安全余量给输出与工具回执，就是 24000。
 * 这只是**旧配置没有填过**时的回退值：设置里填了 `contextWindow` 就以那一份为准。
 *
 * 住在 contracts 而不是 agent-runtime，是因为设置页要把它作为输入框占位文案显示；
 * 渲染层过不了包边界闸（不许 import agent-runtime），只能从这里取。
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 24000;

export const providerConfigSchema = z.object({
  baseURL: z.string().min(1).regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1),
  /** 密钥放哪个头。带 default 是为了让 v1 旧形状（没有这一项）照样能读。 */
  authHeader: z.enum(["bearer", "api-key"]).default("bearer"),
  /** 最高档思考在线上叫什么。同样带 default：老配置里没有这一项，按通用值走。 */
  thinkingWire: z.enum(["standard", "xhigh"]).default("standard"),
  /** 上下文窗口（tokens）。老配置没有这一项 ⇒ 调用方回退到 DEFAULT_CONTEXT_WINDOW_TOKENS。 */
  contextWindow: z.number().int().positive().optional()
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/* ────────────────────────── 供应商预设（2026-10-06 批次 5-⑤） ────────────────────────── */

export type ProviderGroup = "cn" | "global" | "custom";

/**
 * 密钥放在哪个请求头里。
 *
 * **不是所有 OpenAI 兼容端点都收 `Authorization: Bearer`**：小米 MiMo 的官方 curl 写的是
 * `--header "api-key: $MIMO_API_KEY"`。本仓以前只有一条地址、只发 Bearer，所以没暴露这个差异；
 * 一旦能切供应商，它就会变成「选了 MiMo 却永远 401」的死路——**那是"能切"带来的新坑，
 * 必须在预设里就说清，不能等用户自己撞**。
 * 值为 null 的用户预设（自填地址）默认 Bearer，仍可在界面上改成 api-key。
 */
export type AuthHeader = "bearer" | "api-key";

/**
 * **深度思考那一档在线上叫什么**（2026-10-09 批次 5-㊻）。
 *
 * 与 `AuthHeader` 同一族的问题：**「OpenAI 兼容」不等于字段值也一样**。
 * Agnes AI Hub 的真机回执写得很直白——
 * `Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.`
 * 也就是说 `low` / `medium` 两档它照收，唯独最高那一档它叫 `xhigh`，
 * 我们发 `high` 上去就被**整笔请求 400**，于是用户「一个字都发不出去，
 * 而地址与密钥全是对的」——与当初 MiMo 只认 `api-key` 头是同一种死法。
 *
 * 形状照 `authHeader` 定：两档枚举、默认 `standard`、存在**连接**上（不是全局一份）。
 * 为什么是「连接」而不是「用户设置」：`low` / `medium` 两档各家一致，
 * 分歧只发生在最高那一档，而不同端点的分歧是不同的——按端点存才对。
 */
export type ThinkingWire = "standard" | "xhigh";

/** 两档在线上分别发什么字。唯一真身，`per-run-fields` 与输入卡那枚 chip 的提示都读它。 */
export const THINKING_WIRE_LABELS: Record<ThinkingWire, string> = {
  standard: "high（OpenAI 兼容的通用值）",
  xhigh: "xhigh（把最高档叫 xhigh 的端点）"
};

/** 最高档在线上的真身字。`standard` 原样，`xhigh` 换名；其余两档两家一致，不动。 */
export const THINKING_WIRE_TOP_VALUE: Record<ThinkingWire, string> = {
  standard: "high",
  xhigh: "xhigh"
};

/** 协议形态。本仓出网只实现了 Chat Completions（`/chat/completions`）；Responses 另算一套。 */
export type ApiType = "chat";

export interface ProviderPreset {
  id: string;
  label: string;
  group: Exclude<ProviderGroup, "custom">;
  baseURL: string;
  /** 密钥管理页：界面上给一枚「获取 API 密钥」直接跳过去，省得用户自己去搜。 */
  keyUrl: string;
  authHeader: AuthHeader;
  /** 常用模型名——快捷入口的初值。拉得到名单时以名单为准，这里只是没网时的救急。 */
  models: string[];
  /**
   * 与预设默认值不一致的地方，写在界面上而不是藏进文档。
   * 空串 = 没有需要注意的。
   */
  note: string;
}

/** 自定义分组那一项的 id：用户自己填地址，不绑任何官方端点。 */
export const CUSTOM_PROVIDER_ID = "custom";

/**
 * 内置供应商清单。
 *
 * **地址是实测过的，不是抄记忆**（2026-10-06，逐个打 `{baseURL}/models` 不带密钥）：
 * 国内六家全部返回 **401 + 明确的中文/英文「没给 key」**——端点存在、只差密钥，地址是对的。
 * 国外三家里 **OpenAI 与 OpenRouter 本机网络到不了（10s 超时），未实测**，
 * 它们的地址取自各自官方文档；Google 的 OpenAI 兼容端点由 Google 官方文档
 * 「OpenAI compatibility · Gemini API」页确认（该页把 `GET {base}/models` 列为官方列模型方式）。
 * 想自己复验：`.mochen-tmp/p2/probe-provider-urls.mjs`。
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "bailian",
    label: "阿里云百炼",
    group: "cn",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyUrl: "https://bailian.console.aliyun.com/",
    authHeader: "bearer",
    models: ["qwen-max", "qwen-plus", "qwen-turbo"],
    note: ""
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    group: "cn",
    baseURL: "https://api.deepseek.com/v1",
    keyUrl: "https://platform.deepseek.com/",
    authHeader: "bearer",
    models: ["deepseek-chat", "deepseek-reasoner"],
    note: ""
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    group: "cn",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    keyUrl: "https://open.bigmodel.cn/",
    authHeader: "bearer",
    models: ["glm-4-plus", "glm-4-flash"],
    note: ""
  },
  {
    id: "kimi",
    label: "Kimi 月之暗面",
    group: "cn",
    baseURL: "https://api.moonshot.cn/v1",
    keyUrl: "https://platform.moonshot.cn/",
    authHeader: "bearer",
    models: ["moonshot-v1-8k", "kimi-k2-0905-preview"],
    note: ""
  },
  {
    id: "minimax",
    label: "MiniMax",
    group: "cn",
    baseURL: "https://api.minimaxi.com/v1",
    keyUrl: "https://platform.minimaxi.com/",
    authHeader: "bearer",
    models: ["MiniMax-M3", "MiniMax-M2.5"],
    note: "国内端点；国际版是 api.minimax.io，记得按你买的套餐改地址。"
  },
  {
    id: "mimo",
    label: "小米 MiMo",
    group: "cn",
    baseURL: "https://api.xiaomimimo.com/v1",
    keyUrl: "https://platform.xiaomimimo.com/",
    // MiMo 官方 curl 用的是 api-key 头，不是 Authorization。预设里已经替你设对了。
    authHeader: "api-key",
    models: ["mimo-v2.6-pro", "mimo-v2.6-flash"],
    note: "按量付费端点。Token Plan 订阅的地址不一样（token-plan-cn.xiaomimimo.com/v1），要在地址格里改。"
  },
  {
    id: "openai",
    label: "OpenAI",
    group: "global",
    baseURL: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    authHeader: "bearer",
    models: ["gpt-4o", "gpt-4o-mini"],
    note: "本机网络到不了这家，未实测；地址取自官方文档。"
  },
  {
    id: "gemini",
    label: "Google Gemini",
    group: "global",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyUrl: "https://aistudio.google.com/app/apikey",
    authHeader: "bearer",
    models: ["gemini-3-flash", "gemini-3-pro"],
    note: "走的是 Google 官方的 OpenAI 兼容层，密钥在 AI Studio 取。本机网络到不了，未实测。"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "global",
    baseURL: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    authHeader: "bearer",
    models: ["anthropic/claude-sonnet-4.5", "google/gemini-3-pro"],
    note: "一个地址连多家模型。本机网络到不了，未实测。"
  }
];

const PRESET_BY_ID: ReadonlyMap<string, ProviderPreset> = new Map(
  PROVIDER_PRESETS.map((preset) => [preset.id, preset])
);

export function presetOf(providerId: string): ProviderPreset | null {
  return PRESET_BY_ID.get(providerId) ?? null;
}

/** 界面上摆的供应商下拉：预置按国内/国外分组，末尾永远跟一个「自定义」。 */
export const PROVIDER_DIALOG_GROUPS: readonly {
  group: ProviderGroup;
  label: string;
  ids: string[];
}[] = [
  {
    group: "cn",
    label: "国内",
    ids: PROVIDER_PRESETS.filter((p) => p.group === "cn").map((p) => p.id)
  },
  {
    group: "global",
    label: "国外",
    ids: PROVIDER_PRESETS.filter((p) => p.group === "global").map((p) => p.id)
  },
  { group: "custom", label: "自定义", ids: [CUSTOM_PROVIDER_ID] }
];

/** 界面上给「自定义」那一项显示的名字。 */
export const CUSTOM_PROVIDER_LABEL = "自定义（自己填地址）";

/**
 * 自定义连接在卡片上的名字：**带上主机名**。
 *
 * 为什么：地址是自定义的，于是每一条的 `providerId` 都是 `custom`，
 * 面板上就会并排出现好几张一模一样的「自定义（自己填地址）」——
 * 用户存了两家 hub，界面上却分不出哪张是哪张（2026-10-06 真机撞到）。
 * 主机名是这条连接最不像别人的那部分，拿来当名字最省事。
 *
 * 解析不出来就退回通用名：**不许抛、也不许返回空串**——
 * 这个名字只用来显示，为它把整张视图搞挂不划算。
 */
export function customConnectionLabel(baseURL: string): string {
  const trimmed = baseURL.trim();
  if (trimmed === "") return CUSTOM_PROVIDER_LABEL;
  try {
    const host = new URL(trimmed).hostname;
    return host === "" ? CUSTOM_PROVIDER_LABEL : `自定义 · ${host}`;
  } catch {
    return CUSTOM_PROVIDER_LABEL;
  }
}

export function providerLabelOf(providerId: string): string {
  if (providerId === CUSTOM_PROVIDER_ID) return CUSTOM_PROVIDER_LABEL;
  return presetOf(providerId)?.label ?? providerId;
}

/* ─────────────────── 地址 → 服务商识别（2026-10-06 批次 5-⑧） ─────────────────── */

/**
 * 认出来的结果：`known` 为真表示命中清单里的一家。
 *
 * **为什么把「密钥头」与「去哪儿取密钥」一并带出来**：识别出来却不给这两样等于只认了个名字——
 * 小米 MiMo 的密钥走 `api-key` 头而不是 `Authorization`，用户在「自定义」里手填地址就会永远 401，
 * 而界面不会告诉他原因。认出家的那一刻顺手把这两样递过去，才叫认出来了。
 */
export interface DetectedProvider {
  known: boolean;
  /** 界面上显示的名字。`known:false` 时是「自定义 · 主机名」那一档。 */
  label: string;
  /** 命中的预设 id；没命中是空串。 */
  presetId: string;
  /** 这家该用的密钥头。没命中时是 `bearer`（OpenAI 兼容的通用默认）。 */
  authHeader: AuthHeader;
  /** 取密钥的页面。没命中时是空串。 */
  keyUrl: string;
  /**
   * 建议的常用模型名。没命中时是**空数组而不是猜一个**——
   * 猜出来的模型名会让「保存」按钮看起来有值，实际发出去多半 404。
   */
  suggestedModels: readonly string[];
}

/** 主机名匹配用的别名表：一家供应商常常有好几个域名（国际版、兼容层、区域站）。 */
const PROVIDER_HOST_ALIASES: readonly { presetId: string; hosts: readonly string[] }[] = [
  { presetId: "bailian", hosts: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"] },
  { presetId: "deepseek", hosts: ["api.deepseek.com", "api.deepseek.com.cn"] },
  { presetId: "zhipu", hosts: ["open.bigmodel.cn", "bigmodel.cn"] },
  { presetId: "kimi", hosts: ["api.moonshot.cn", "api.moonshot.ai"] },
  { presetId: "minimax", hosts: ["api.minimaxi.com", "api.minimax.io", "api.minimax.chat"] },
  {
    presetId: "mimo",
    hosts: ["api.xiaomimimo.com", "api-cn.xiaomimimo.com", "token-plan-cn.xiaomimimo.com"]
  },
  { presetId: "openai", hosts: ["api.openai.com"] },
  { presetId: "gemini", hosts: ["generativelanguage.googleapis.com"] },
  { presetId: "openrouter", hosts: ["openrouter.ai"] },
  // 常见的中转/聚合站与本机：认出来是为了给个像样的名字，不是官方预设。
  { presetId: "agnes", hosts: ["apihub.agnes-ai.com"] },
  { presetId: "siliconflow", hosts: ["api.siliconflow.cn", "api.siliconflow.com"] }
];

/** 清单外的常见中转站：只给名字，不进 `PROVIDER_PRESETS`（那是有官方文档与密钥页的清单）。 */
const EXTRA_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  agnes: "Agnes AI Hub",
  siliconflow: "硅基流动"
};

/** 主机名本身就算一份线索：`apihub.agnes-ai.com` 里带着 `agnes`，认不出全名时至少别叫「自定义」。 */
function guessFromHostname(host: string): string {
  for (const [id, name] of Object.entries(EXTRA_PROVIDER_NAMES)) {
    if (host.includes(id)) return name;
  }
  return "";
}

/**
 * 拿一条地址去认服务商（纯函数，不发任何请求）。
 *
 * **为什么不发请求去问服务端「你是谁」**：OpenAI 兼容层没有统一的身份端点，
 * 逐家试要维护一串脆弱的探测，而且每加一家就得改一次发请求的代码。
 * 按主机名认是**离线、零延迟、零失败**的，而且对「用户刚把官方文档里的地址粘进来」这个
 * 真实场景命中率最高——那正是最需要被认出来的一类。
 *
 * 认不出来**不抛、不猜**：`known:false` 时退回「自定义 · 主机名」那一档，
 * 与批次 5-⑥ 之前的行为一字不差。识别是加分项，不是发请求的前置条件。
 */
export function detectProviderByBaseURL(rawBaseURL: string): DetectedProvider {
  const fallback = (): DetectedProvider => {
    const custom = customConnectionLabel(rawBaseURL);
    return {
      known: false,
      label: custom,
      presetId: "",
      authHeader: "bearer",
      keyUrl: "",
      suggestedModels: []
    };
  };

  const trimmed = rawBaseURL.trim();
  if (trimmed === "") return fallback();
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return fallback();
  }
  if (host === "") return fallback();

  const alias = PROVIDER_HOST_ALIASES.find((item) =>
    item.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))
  );
  if (alias !== undefined) {
    const preset = presetOf(alias.presetId);
    if (preset !== null) {
      return {
        known: true,
        label: preset.label,
        presetId: preset.id,
        authHeader: preset.authHeader,
        keyUrl: preset.keyUrl,
        suggestedModels: preset.models
      };
    }
    // 清单外但认得出来的（聚合站）：给名字，不给密钥头/密钥页——那些我们没有出处。
    const extra = EXTRA_PROVIDER_NAMES[alias.presetId];
    if (extra !== undefined) {
      return {
        known: true,
        label: extra,
        presetId: "",
        authHeader: "bearer",
        keyUrl: "",
        suggestedModels: []
      };
    }
  }

  const guessed = guessFromHostname(host);
  if (guessed !== "") {
    return {
      known: true,
      label: guessed,
      presetId: "",
      authHeader: "bearer",
      keyUrl: "",
      suggestedModels: []
    };
  }
  return fallback();
}

/** 新建连接时该带的默认头：预置按各自的来，自定义一律 Bearer（界面上可改）。 */
export function defaultAuthHeaderOf(providerId: string): AuthHeader {
  return presetOf(providerId)?.authHeader ?? "bearer";
}

/* ────────────────────────── 连接与档案（config.json v3） ────────────────────────── */

/**
 * **一条连接 = 一家供应商的地址 + 密钥**（2026-10-06 批次 5-⑤）。
 *
 * 此前地址与密钥是**全局一份**（用户早先的裁定），那与「多供应商并存」直接冲突——
 * 共用一份地址就永远只能连一家。现在每条模型档案挂一条连接，
 * 于是「同时存着 DeepSeek 和 OpenAI、随时切」才成立。
 */
export const providerConnectionSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  baseURL: z.string().regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  authHeader: z.enum(["bearer", "api-key"]),
  /**
   * `.default` 在这里是**能不能升级**的问题，不是偷懒：
   * 2026-10-09 之前存下的每一份 config.json 都没有这个键，
   * 不给默认值的话 schema 直接判失败 → 用户的连接**全部读不出来**，
   * 界面上变成「还没有模型」，而他明明配过。
   */
  thinkingWire: z.enum(["standard", "xhigh"]).default("standard"),
  /**
   * 这个模型的上游上下文窗口（tokens，P0-3）。可选：旧配置没有这一项，
   * 读取方回退到 `DEFAULT_CONTEXT_WINDOW_TOKENS`，行为与 P0-3 之前一致。
   *
   * 存在**连接**上而不是全局设置：不同端点（甚至同一 hub 的不同模型）窗口并不相同，
   * 而用户是在「添加/编辑模型」这一步把地址与窗口一起确认的。
   */
  contextWindow: z.number().int().positive().optional()
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

/** 一条模型档案：记模型名与启停，并指明它走哪条连接。 */
export const providerProfileSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  model: z.string().min(1),
  enabled: z.boolean()
});
export type ProviderProfile = z.infer<typeof providerProfileSchema>;

export const providerStoreFileSchema = z
  .object({
    connections: z.array(providerConnectionSchema),
    profiles: z.array(providerProfileSchema)
  })
  // **外键完整性**：每条档案都必须挂在一条真实存在的连接上。
  // zod 默认只查字段类型，`{connections: [], profiles: [{connectionId: "nope", …}]}` 会顺利通过——
  // 后果是卡片上列出模型、看着一切正常，发请求时却拿不到地址（用户完全看不出是配置坏了）。
  // 这是本仓「形状合法但语义悬空」的典型，所以放在 schema 这道最后关卡上，
  // 读配置时就拒，而不是等到发请求才炸。
  .superRefine((value, ctx) => {
    const known = new Set(value.connections.map((connection) => connection.id));
    for (const profile of value.profiles) {
      if (!known.has(profile.connectionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profiles"],
          message: `模型「${profile.model}」挂在一条不存在的连接上（${profile.connectionId}）`
        });
      }
    }
  });
export type ProviderStoreFile = z.infer<typeof providerStoreFileSchema>;

/** v2 旧形状：{baseURL, profiles:[{id,model,enabled}]}（地址全局一份）。 */
export const providerStoreV2Schema = z.object({
  baseURL: z.string().regex(httpUrl),
  profiles: z.array(
    z.object({ id: z.string().min(1), model: z.string().min(1), enabled: z.boolean() })
  )
});

/** 迁移时给老配置造的那条连接的固定 id：确定性才能在反复迁移里保持同一个密钥桶。 */
export const LEGACY_CONNECTION_ID = "legacy";

/**
 * 按地址反查是哪家预置——老配置只有一个地址，迁过来时该挂到谁名下。
 * 认不出就老实归到「自定义」，**不猜**：猜错的后果是密钥发去了另一家的地址。
 */
export function guessProviderIdOf(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, "").toLowerCase();
  if (normalized === "") return CUSTOM_PROVIDER_ID;
  const hit = PROVIDER_PRESETS.find(
    (preset) => preset.baseURL.replace(/\/+$/, "").toLowerCase() === normalized
  );
  return hit?.id ?? CUSTOM_PROVIDER_ID;
}

export type MigrationOutcome = { store: ProviderStoreFile; migrated: boolean };

/**
 * 任意一代的配置文件 → v3。
 *
 * **纯函数，不出网、不写盘**（主进程只负责落盘与搬密钥）。三态：
 * - 已经是 v3 ⇒ 原样返回，`migrated: false`；
 * - v2（有 profiles、地址全局一份）⇒ 造一条连接，档案全部挂上去；
 * - v1（`{baseURL, model}`）⇒ 造一条连接 + 一条启用档案。
 *
 * 档案 id 保持不变：用户的卡片顺序、启用状态、以及外部可能的引用都指着那些 id。
 * 连接 id 用固定的 `legacy`，**不用随机数**——同一份老配置反复迁移要落到同一个密钥桶，
 * 随机 id 会让「第一次迁移后改的密钥」在下一次迁移后读不到。
 */
export function migrateProviderStore(parsed: unknown): MigrationOutcome {
  const v3 = providerStoreFileSchema.safeParse(parsed);
  if (v3.success) return { store: v3.data, migrated: false };

  const v2 = providerStoreV2Schema.safeParse(parsed);
  if (v2.success) {
    const connection: ProviderConnection = {
      id: LEGACY_CONNECTION_ID,
      providerId: guessProviderIdOf(v2.data.baseURL),
      baseURL: v2.data.baseURL,
      authHeader: defaultAuthHeaderOf(guessProviderIdOf(v2.data.baseURL)),
      // 老配置里没有这一项，按通用值走（那个年代还没有「最高档叫 xhigh 的端点」这件事）。
      thinkingWire: "standard"
    };
    return {
      store: {
        connections: [connection],
        profiles: v2.data.profiles.map((profile) => ({ ...profile, connectionId: connection.id }))
      },
      migrated: true
    };
  }

  const v1 = providerConfigSchema.safeParse(parsed);
  if (v1.success) {
    const providerId = guessProviderIdOf(v1.data.baseURL);
    const connection: ProviderConnection = {
      id: LEGACY_CONNECTION_ID,
      providerId,
      baseURL: v1.data.baseURL,
      authHeader: defaultAuthHeaderOf(providerId),
      thinkingWire: "standard",
      // v1 本来没有这一格；若用户手改过就带过来，否则保持缺省（读取方回退默认窗口）。
      ...(v1.data.contextWindow === undefined ? {} : { contextWindow: v1.data.contextWindow })
    };
    return {
      store: {
        connections: [connection],
        profiles: [
          {
            id: LEGACY_CONNECTION_ID,
            connectionId: connection.id,
            model: v1.data.model,
            enabled: true
          }
        ]
      },
      migrated: true
    };
  }

  throw new Error("模型配置文件缺字段，认不出是哪一代；在模型设置里重新保存一次即可修复。");
}

/* ────────────────────────── 视图与草稿 ────────────────────────── */

export interface ProviderConnectionView {
  id: string;
  providerId: string;
  /** 界面上显示的名字（预置走预设 label，自定义走「自定义」）。 */
  label: string;
  baseURL: string;
  authHeader: AuthHeader;
  /** 最高档思考在线上叫什么。界面上要能看见它——不然用户只能靠撞 400 才知道自己这条端点的口径。 */
  thinkingWire: ThinkingWire;
  /**
   * 这个模型的上游上下文窗口（tokens）。没填过就是 undefined，
   * 界面显示与预算计算都回退到 `DEFAULT_CONTEXT_WINDOW_TOKENS`（P0-3）。
   */
  contextWindow?: number;
  /** 这一条有没有存过密钥（只有这个，没有明文）。 */
  hasKey: boolean;
  keyMask: string;
}

export interface ProviderProfileView {
  id: string;
  connectionId: string;
  model: string;
  enabled: boolean;
}

export interface ProviderView {
  connections: ProviderConnectionView[];
  profiles: ProviderProfileView[];
}

/**
 * `providerSave` 的回执：改完的视图 **+ 主进程刚给那条连接分配的 id**。
 *
 * 它是 ProviderView 的加长版而不是嵌套版：既有消费方（测试、视图刷新）照旧拿
 * `connections` / `profiles`，只有需要 id 的那一个多读一个字段。
 *
 * id 必须由主进程回传，不能让调用方拿地址回头去视图里认：同一家供应商开第二个账号
 * 是常事（个人号 + 企业号），两条连接的地址一模一样，按地址 `find` 必然拿到先存的那条，
 * 于是用户刚配好的第二个账号会被判成「没配上」，模型也会挂到别人那条上。
 */
export interface ProviderSaveResult extends ProviderView {
  connectionId: string;
}

/** 连接草稿：apiKey 为 null 表示「保留现有密钥」，"" 表示「明确清空」。 */
export const connectionDraftSchema = z.object({
  /** 留空 = 新建一条连接。 */
  connectionId: z.string().min(1).optional(),
  providerId: z.string().min(1),
  baseURL: z
    .string()
    .min(1, "baseURL 不能为空")
    .regex(
      // 保存口收紧（2026-10-14 审计项 4）：新配置只许 https 或本机回环的 http。
      // 读取旧存档的 schema 保持宽松（收紧会把老 store 整份判坏），出网那头还有一道闸兜底。
      /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$))/i,
      "baseURL 必须是 https://，或本机地址 http://localhost、127.0.0.1"
    ),
  authHeader: z.enum(["bearer", "api-key"]),
  thinkingWire: z.enum(["standard", "xhigh"]),
  /**
   * 上下文窗口（tokens，P0-3）。`null` = 明确清空（改用默认值），
   * `undefined` = 调用方没带这一格（保持现状）。与 apiKey 的「沿用 / 明确清空」同一族语义。
   */
  contextWindow: z.number().int().positive().nullable().optional(),
  apiKey: z.string().nullable()
});
export type ConnectionDraft = z.infer<typeof connectionDraftSchema>;

/** 档案草稿：模型名 + 走哪条连接。 */
export const profileDraftSchema = z.object({
  model: z.string().min(1),
  connectionId: z.string().min(1)
});
export type ProfileDraft = z.infer<typeof profileDraftSchema>;

/**
 * 连通性体检的结果（`provider:verify`）。
 *
 * **软校验**：这里**不**决定能不能存，只回答「现在连不连得上」。
 * 硬校验（不通过就不让存）会把「服务没起」「还没买套餐」「网络不通」统统变成死路——
 * 而用户完全可能想先把配置填好、回头再连。所以状态分三档，别压成布尔。
 */
export type VerifyResult =
  | { state: "ok"; modelCount: number; checkedAt: string }
  | { state: "unreachable"; reason: string; checkedAt: string }
  | { state: "unverified"; reason: string; checkedAt: string };

export function maskApiKey(key: string): string {
  const tail = key.length > 4 ? key.slice(-4) : "";
  return tail === "" ? "••••" : `••••${tail}`;
}

/** 本机 Ollama 的 OpenAI 兼容端点（2026-10-05，批次 5-②）。 */
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

/** 一键填本机 Ollama 时给用户看的那句（含按钮文案，组件只渲染它）。 */
export const OLLAMA_FILL_LABEL = `用本机 Ollama（${OLLAMA_BASE_URL}）`;

/** 本机端点不需要密钥——这句挂在密钥栏下面，别让用户以为漏填了什么。 */
export const LOCAL_MODEL_KEY_NOTE =
  "Ollama / LM Studio 这类本机端点也走这一格，它们不需要密钥——密钥留空即可。";

/**
 * 拉模型名单的可选草稿（`provider:list-models`）：带 connectionId 就走那条已存连接，
 * 带 baseURL/apiKey 就是在对话框里现填的那一对（还没存）。两者不同时给。
 */
export interface ModelListQuery {
  connectionId?: string;
  baseURL?: string;
  apiKey?: string;
  authHeader?: AuthHeader;
}

/**
 * `{baseURL}/models` 的取数结果。
 * 每条只有 id：OpenAI 兼容端点不给中文显示名，编一个出来就是假名字，宁缺。
 * `ok:false` 的 reason 是一句可执行的中文，弹层直接摆给用户看——包括「这个地址没返回任何模型」，
 * 因为对用户来说「拉不到可选项」和「失败」的下一步动作是同一件事。
 */
export const modelListResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), models: z.array(z.string().min(1)) }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) })
]);
export type ModelListResult = z.infer<typeof modelListResultSchema>;

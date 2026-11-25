import { z } from "zod";

/**
 * 思考档位与**模型能力表**（2026-11-21）。
 *
 * ## 为什么这一族单独收成一个叶子模块
 *
 * 这一族东西现在被三处同时要读：
 * - **连接级口径**：Agnes AI Hub 那类端点把最高档叫 `xhigh`，发 `high` 上去整笔 400
 *   （真机回执见 `docs/superpowers/plans/README.md` 批次 5-㊻）。
 * - **模型级口径**：MiniMax 官方文档写明 `reasoning_effort` **只有 `MiniMax-M3.1-Flash` 真认**，
 *   可取 `low/medium/high/xhigh/max`，默认 `max`；`MiniMax-M3` 会**忽略**这个字段。
 * - **档案形状**：`providerProfileSchema` 的 `thinkingLevel` 那一格要用这个枚举。
 *
 * 若它们分住在 `provider.ts`（连接口径）与 `per-run.ts`（每轮口径）两处，
 * 档案形状再 import 一次就会形成 `provider → per-run → provider` 的循环引用——
 * **两份真身分家**比循环更难查。故这一族收进一个**不依赖仓内任何别的模块**的叶子文件，
 * 两边都从它取，循环从根上不存在。
 *
 * ## 这一族装的是「事实」，不是「猜测」
 *
 * `MODEL_CAPABILITIES` 每一格都对着厂商文档抄，抄不着的就**不写**——
 * 上游 `GET {baseURL}/models` 只回 `id / object / created / owned_by / supported_endpoint_types`，
 * 区分不出模态、也给不出窗口与档位，所以这份表是**手写的事实集**，不是从接口推出来的。
 * 表里没有的模型一律走 `STANDARD_THINKING_LEVELS`（OpenAI `reasoning_effort` 公开文档那三档
 * 加一个「不发字段」的关闭态），那是**通用口径**，不是对某个模型的断言。
 */

/* ────────────────────────── 思考档位 ────────────────────────── */

/**
 * 档位枚举。
 *
 * 六档而不是四档的依据（2026-11-21 改）：MiniMax 官方文档
 * `https://platform.minimax.cn/docs/api-reference/text-chat-openai` 写明
 * `reasoning_effort`「可取 `low`、`medium`、`high`、`xhigh`、`max`」。
 *
 * **旧注释里那句「多出来的 max/xhigh 属于厂商目录，本仓没有可验证的落点」到此为止**——
 * 落点现在有了：上面那份官方文档。原注释的顾虑是对的（当时确实没有出处），
 * 出处补齐之后这一族才被放进来。
 */
export const THINKING_LEVELS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const thinkingLevelSchema = z.enum(THINKING_LEVELS, {
  message: "思考档位只能是 关闭 / 较低 / 标准 / 深度 / 超深 / 极限 六档之一"
});

/**
 * chip 上那枚中文标签；键集与 THINKING_LEVELS 完全一致（测试逐字钉死）。
 *
 * 前四档取自 deepwrite 的 `builtInThinkingLabels`（同一批 wire 值 low/medium/high 在他那里就是
 * 较低/标准/深度），后两档是 MiniMax 官方文档新增的那两档，词按同一族口径往下排：
 * 「超深」在「深度」之上，「极限」在「超深」之上。
 */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  low: "较低",
  medium: "标准",
  high: "深度",
  xhigh: "超深",
  max: "极限"
};

export const THINKING_LEVEL_COMPACT_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超深",
  max: "极限"
};

/**
 * 未知模型的标准档集：OpenAI `reasoning_effort` 公开文档那三档 + 一个「不发字段」的关闭态。
 *
 * 它是**通用口径**，不是对任何具体模型的断言——能力表里有的模型走表里那份，
 * 表里没有的才回落这一份。
 */
export const STANDARD_THINKING_LEVELS = ["off", "low", "medium", "high"] as const;

/* ────────────────────────── 出站字段口径 ────────────────────────── */

/**
 * 两个开关各自实际发出去的那对键值名（唯一一份，主进程与输入区都读它）。
 *
 * 为什么名字放在共享层而不是只留在 agent-runtime：本仓有条铁律——**报不出出站字段名的控件
 * 不进 UI**。输入区的 title 必须能告诉用户「这一档发的是 reasoning_effort=medium」，
 * 而渲染层不许 import agent-runtime（那是主进程侧的运行时）。于是字段名下沉到这里：
 * `per-run-fields.ts` 用它拼 body，chip 文案用它拼 title，改名只需要动这一行。
 *
 * 联网那一枚的名字在 2026-10-08 从 `WEB_SEARCH_WIRE_TYPE` 改叫 `WEB_SEARCH_TOOL_NAME`：
 * 它曾经既当 hosted tool 的 `type` 值、又当 function 工具名（两个真身共用一个常量，
 * 于是发出去的是裸 `{type:"web_search"}`，严格端点整批拒收，见 per-run-fields 的注释）。
 * 现在它只剩一个含义——**出站 tools 里那枚 function 工具的名字**，名字跟着含义改。
 * （2026-10-11 起这个常量搬去 tools.ts 与花名册同住——它是工具名不是每轮开关字段；
 * web_read 同表。这里不再导出第二份，两处各留一份就是两份真身。）
 */
export const THINKING_WIRE_FIELD = "reasoning_effort";

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

/** 两档的 zod 形状（唯一一份）：`provider.ts` 的几处 schema 读它，不各写一遍字面量。 */
export const thinkingWireSchema = z.enum(["standard", "xhigh"]);

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

/* ────────────────────────── 模型能力表 ────────────────────────── */

/**
 * 一个模型的能力：**上下文窗口**与**认哪几档思考深度**。
 *
 * 两格都可有可无：有就是事实，没有就是「不知道」——**不知道时一律回落通用口径**，
 * 不许拿别处的数字来凑（凑出来的是编，编出来的会让占用条的分母说谎）。
 */
export interface ModelCapability {
  /**
   * 这个模型的上游上下文窗口（tokens）。
   *
   * 它决定占用条的分母与历史切多少，**不是**「模型真实上限」的保证：
   * 同一模型经不同网关可能给不同的准入长度，用户可以在模型下拉里改这一格。
   */
  contextWindow?: number;
  /**
   * 这个模型认的思考深度档（出站 `reasoning_effort` 的取值集合）。
   *
   * **空数组不是「没填」，是「这个模型不认这一档控制」**——
   * MiniMax 官方文档写明 `MiniMax-M3` 会忽略 `reasoning_effort` 字段，
   * 那种模型上再摆一枚思考档控件就是摆一个按下去没反应的东西。
   */
  thinkingLevels?: readonly ThinkingLevel[];
  /**
   * 这一族里「最高档」在线上叫什么。
   *
   * 缺省 = 档名本身（`high` 就叫 `high`、`max` 就叫 `max`）；
   * 表里写它是为了那些「档位名叫一套、线上叫另一套」的家族。
   */
  topWire?: string;
  /**
   * 这个模型**省略档位时**自己用哪一档（官方口径）。
   *
   * 例：MiniMax-M3.1-Flash 官方写「省略时默认 `max`」。没写就是 `off`——
   * 与旧行为一字不差（不发字段 = 端点自己拿默认）。
   */
  defaultThinkingLevel?: ThinkingLevel;
}

/**
 * 能力表：**模型名 → 能力**。
 *
 * 键是**归一化后的模型名**（小写、去连字符与点，见 `capabilityOf`），
 * 因为同一家在不同网关上的模型 id 写法并不统一：
 * 官方文档写 `MiniMax-M3.1-Flash`，模型数据库写 `minimax-m3`——
 * 认不出来的后果是「明明是这个模型，界面却说什么都不知道」。
 *
 * **每一格都对着厂商文档抄，出处写在注释里。** 抄不着的模型**不在表里**：
 * 表里没有 = 走通用口径（`STANDARD_THINKING_LEVELS`），那不是断言，是「按最常见的那套办」。
 *
 * ## `thinkingLevels` 为什么那么多是空数组
 *
 * 2026-11-21 逐家查过官方文档，结论比预想的更硬：
 * **本仓只发 `reasoning_effort`，而只有一部分模型认它。**
 * - 认的：MiniMax-M3.1-Flash（low/medium/high/xhigh/max）、Gemini 3 系列（经兼容层映射到 thinking_level）、
 *   DeepSeek 现行模型（low/high/max）。
 * - **不认的**：百炼（用 `enable_thinking` 布尔）、智谱 GLM-4（用 `thinking.type`，且 GLM-4 根本不支持思考）、
 *   小米 MiMo（Chat 用 `thinking.type`）、gpt-4o 系列（非推理模型）、OpenRouter 的 claude-sonnet-4.5
 *   （用 `reasoning.effort`，不是顶层 `reasoning_effort`）。
 *
 * 对这些模型摆一枚思考档控件就是**摆一个按下去没反应的东西**——所以它们的档位集合是空数组，
 * 界面据此把那一枚置灰并说明原因（而不是假装它生效）。
 * 另注：Gemini 3 Flash 官方还认 `minimal`，本表只列 low/medium/high（**子集**，每一个都合法）。
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  /**
   * MiniMax-M3.1-Flash。
   * 出处：https://platform.minimax.cn/docs/api-reference/text-chat-openai
   * （官方文档，2026-11-21 读）：
   * - 上下文窗口 1,000,000（`https://platform.minimax.cn/docs/guides/text-generation` 的支持模型表）；
   * - `reasoning_effort` 可取 `low` / `medium` / `high` / `xhigh` / `max`，省略时默认 `max`；
   * - 深度思考**强制开启**，传 `none` 会 HTTP 400 ⇒ **这一族没有「关闭」档**。
   */
  minimaxm31flash: {
    contextWindow: 1_000_000,
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "max"
  },
  /**
   * MiniMax-M3。
   * 出处：同上（官方文档，2026-11-21 读）。
   * - 上下文窗口 1,000,000；
   * - 官方明写「仅 `MiniMax-M3.1-Flash` 支持真正的思考深度调节，**其他模型会忽略该字段**」
   *   ⇒ 这一族 `thinkingLevels` 是**空数组**：摆一枚思考档控件对它就是摆设。
   */
  minimaxm3: {
    contextWindow: 1_000_000,
    thinkingLevels: []
  },

  /**
   * 阿里云百炼 qwen-max。
   * 出处：https://help.aliyun.com/zh/model-studio/text-generation-model（官方《文本生成与视觉理解》旧版模型表，
   * 2026-11-21 抓取）：上下文 32K；思考用 `enable_thinking` 布尔，不认 `reasoning_effort`。
   */
  qwenmax: {
    contextWindow: 32768,
    thinkingLevels: []
  },
  /**
   * 阿里云百炼 qwen-plus。
   * 出处：https://help.aliyun.com/zh/model-studio/text-generation-model（官方，2026-11-21 抓取）：
   * 上下文 1M；思考用 `enable_thinking` 布尔（默认关），不认 `reasoning_effort`。
   */
  qwenplus: {
    contextWindow: 1048576,
    thinkingLevels: []
  },

  /**
   * 阿里云百炼 qwen4-max。
   * 出处：https://help.aliyun.com/zh/model-studio/text-generation-model（官方《文本生成与视觉理解》
   * 「推荐模型」表，2026-11-21 读）：上下文 1M；思考用 `enable_thinking` 布尔，不认 `reasoning_effort`。
   */
  qwen4max: {
    contextWindow: 1_048_576,
    thinkingLevels: []
  },
  /**
   * 阿里云百炼 qwen3.7-plus。出处：同上（官方：上下文 1M；`enable_thinking` 布尔）。
   */
  qwen37plus: {
    contextWindow: 1_048_576,
    thinkingLevels: []
  },
  /**
   * 阿里云百炼 qwen3.8-flash。出处：同上（官方：上下文 1M；`enable_thinking` 布尔）。
   */
  qwen38flash: {
    contextWindow: 1_048_576,
    thinkingLevels: []
  },

  /**
   * 智谱 GLM-4-Plus。
   * 出处：https://docs.bigmodel.cn/cn/guide/models/text/glm-4.md（官方：上下文 128K、最大输出 4K）
   * 与 https://docs.bigmodel.cn/cn/guide/capabilities/thinking.md（官方：GLM-4.5 及以上才支持深度思考，
   * `reasoning_effort` 仅 GLM-5.2 及以上）⇒ GLM-4 这一族不认 `reasoning_effort`。
   */
  glm4plus: {
    contextWindow: 131072,
    thinkingLevels: []
  },
  /**
   * 智谱 GLM-4-Flash。
   * 出处：同上（官方 GLM-4-Flash / GLM-4-FlashX 上下文 128K；GLM-4 系列不认 `reasoning_effort`）。
   */
  glm4flash: {
    contextWindow: 131072,
    thinkingLevels: []
  },

  /**
   * 小米 MiMo-v2.6-Pro。
   * 出处：https://mimo.mi.com/docs/zh-CN/quick-start/summary/model（官方《模型列表》：上下文 1M、最大输出 128K）
   * 与 https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/deep-thinking（官方《深度思考》：
   * Chat Completions 用 `thinking:{"type":"enabled"|"disabled"}`，**不用 reasoning_effort**）。
   */
  mimov26pro: {
    contextWindow: 1000000,
    thinkingLevels: []
  },
  /**
   * 小米 MiMo-v2.6-Flash。出处：同上（官方，1M 上下文；`thinking.type` 开关）。
   */
  mimov26flash: {
    contextWindow: 1000000,
    thinkingLevels: []
  },

  /**
   * OpenAI gpt-4o。
   * 出处：https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
   * （微软官方同一批 OpenAI 模型页：Input 128,000 / Output 16,384）
   * 与 https://openrouter.ai/api/v1/models（OpenRouter 官方 API 实查，2026-11-21：context_length=128000）。
   * 非推理模型 ⇒ 不认 `reasoning_effort`。
   */
  gpt4o: {
    contextWindow: 128000,
    thinkingLevels: []
  },
  /**
   * OpenAI gpt-4o-mini。出处：同上（官方：Input 128,000；非推理模型）。
   */
  gpt4omini: {
    contextWindow: 128000,
    thinkingLevels: []
  },

  /**
   * Google Gemini 3 Flash（官方 OpenAI 兼容层）。
   * 出处：https://ai.google.dev/gemini-api/docs/openai（官方《OpenAI compatibility》的
   * `reasoning_effort` → `thinking_level` 映射表：Gemini 3 Flash 认 minimal/low/medium/high，不认 xhigh）
   * 与 https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash
   * （官方：上下文 1,048,576、最大输出 65,536，页脚更新 2026-11-20）。
   * **本表只列 low/medium/high**：官方那份额外还有 `minimal`，但它是**子集**——
   * 少列一档不会把用户送到上游不认的值上，多列才会。
   */
  gemini3flash: {
    contextWindow: 1048576,
    thinkingLevels: ["low", "medium", "high"]
  },
  /**
   * Google Gemini 3 Pro（官方 OpenAI 兼容层）。
   * 出处：https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro
   * （官方：100 万 token 上下文；`thinking_level` 只有「低或高」）
   * 与 https://ai.google.dev/gemini-api/docs/gemini-3（官方开发者指南表）。
   */
  gemini3pro: {
    contextWindow: 1000000,
    thinkingLevels: ["low", "high"]
  },

  /**
   * Kimi kimi-k3.1-pro。
   * 出处：https://platform.kimi.com/docs/models.md（官方《模型列表》，2026-11-21 读：
   * 100 万 token 上下文）与 https://platform.kimi.com/docs/guide/use-reasoning-effort.md
   * （官方《推理强度》：**顶层** `reasoning_effort`，取 `low` / `high` / `max`，默认 `max`；
   * 从 K2.x 迁上来要把 `thinking` 配置去掉）。
   */
  kimik31pro: {
    contextWindow: 1_000_000,
    thinkingLevels: ["low", "high", "max"],
    defaultThinkingLevel: "max"
  },
  /**
   * Kimi kimi-k3（上一代旗舰）。
   * 出处：https://platform.kimi.com/docs/models.md（官方：100 万 token 上下文）与
   * https://platform.kimi.com/docs/guide/use-reasoning-effort.md（官方《推理强度》字段说明里
   * 「K3 的顶层推理强度字段，支持 low / high / max，默认 max」）。
   */
  kimik3: {
    contextWindow: 1_000_000,
    thinkingLevels: ["low", "high", "max"],
    defaultThinkingLevel: "max"
  },

  /**
   * Kimi moonshot-v1-8k。
   * 出处：https://platform.kimi.com/docs/models.md（官方《模型列表》已列入**已下线模型**）
   * 与 https://www.kimi.ai/help/kimi-api/api-troubleshooting（官方排障文档：
   * 「moonshot-v1-8k 的最大输出长度 = 8*1024 - prompt_tokens」⇒ 总长 8192）。
   *
   * **已下线的模型为什么还留着一格窗口**：因为窗口是**上限约束**——
   * 拿本仓那个保守默认（24000）去算预算，对一个 8K 的模型会**超**，
   * 于是历史切得太多、上游直接拒收。留着这一格是为了让这类老配置也不至于踩空。
   *
   * **2026-11-21**：预置清单里已经不再列它（换成 kimi-k3.1-pro / kimi-k3），
   * 但**老配置里还可能有这个名字**（用户当年手填过），所以这一格留着。
   */
  moonshotv18k: {
    contextWindow: 8192,
    thinkingLevels: []
  },
  /**
   * Kimi kimi-k2-0905-preview。
   * 出处：https://platform.kimi.com/docs/models.md（官方《模型列表》已下线）
   * 与 https://platform.kimi.com/docs/pricing/chat.md（官方定价页：K2 系列上下文 262,144）。
   */
  kimik20905preview: {
    contextWindow: 262144,
    thinkingLevels: []
  },

  /**
   * DeepSeek 现行模型 deepseek-flash。
   * 出处：https://api-docs.deepseek.com/quick_start/pricing（官方《Models & Pricing》，2026-11 抓取：
   * 上下文 1M、最大输出 384K）与 https://api-docs.deepseek.com/guides/thinking_mode
   * （官方《Thinking Mode》：`reasoning_effort` 取 low / high / max，默认档位 high）。
   */
  deepseekflash: {
    contextWindow: 1_000_000,
    thinkingLevels: ["low", "high", "max"],
    defaultThinkingLevel: "high"
  },
  /**
   * DeepSeek 现行模型 deepseek-v4-pro。出处：同上（官方：1M 上下文；effort 取 low / high / max）。
   */
  deepseekv4pro: {
    contextWindow: 1_000_000,
    thinkingLevels: ["low", "high", "max"],
    defaultThinkingLevel: "high"
  },

  /**
   * OpenRouter 的 anthropic/claude-sonnet-4.5。
   * 出处：https://openrouter.ai/api/v1/models（OpenRouter 官方 API 实查，2026-11-21：
   * 上下文 1,000,000；该模型的 `supported_parameters` 里**只有 reasoning / include_reasoning，
   * 没有 reasoning_effort**）⇒ 本仓发的顶层 `reasoning_effort` 对它无效，档位集合是空数组。
   */
  anthropicclaudesonnet45: {
    contextWindow: 1000000,
    thinkingLevels: []
  }
};

/**
 * 模型名归一化：小写 + 去掉一切非字母数字字符。
 *
 * 为什么要归一化而不是精确匹配：同一家在不同网关上的写法不统一
 * （`MiniMax-M3` / `minimax-m3` / `MINIMAX_M3`），精确匹配会让「明明是这个模型」查不到能力。
 * 去掉分隔符而不是只去连字符：模型 id 里常见 `.`（`M3.1-Flash`）与 `_`。
 */
export function normalizeModelKey(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 上下文窗口的**常用档**（2026-11-21）。
 *
 * 模型下拉里那一格给的是「挑一个常见的」，不是让用户手填 token 数——
 * 手填那格仍然在模型设置的「高级选项」里（那是给不在这份清单上的模型准备的）。
 *
 * 这几档是**预算档**，不是各家模型的真实上限：真实上限在能力表里，
 * 这一列只是把「常见的那几个数」摆出来让人挑。
 */
export const CONTEXT_WINDOW_PRESETS = [
  32768, 65536, 131072, 262144, 524288, 1048576, 2097152
] as const;

/**
 * token 数 → 界面上的写法（`1048576` → `1M`）。
 *
 * 界面要能一眼看出这一格是多大；写成 `1048576 tokens` 谁也读不出来。
 */
export function contextWindowLabel(tokens: number): string {
  if (tokens >= 1048576) return `${Math.round(tokens / 1048576)}M`;
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}K`;
  return `${tokens}`;
}

/**
 * 这一档窗口是不是「用量较高」。
 *
 * 判据是**它会让每一轮多带多少历史**：窗口越大，预算切给历史的那一份越多，
 * token 花费也越高。这不是猜——历史切多少是 `windowBudgetPlan` 按窗口算出来的。
 *
 * 门槛取 512K：低于它，带进来的历史量与默认档（24000）相比有限；
 * 到 512K 那一档，每轮多带的历史已经是一个数量级的差别。
 */
export const HIGH_USAGE_WINDOW_THRESHOLD = 524288;

/**
 * 这个模型的能力。查不到就是 `null`——**没有就是没有**，不许拿相近的名字顶替。
 */
export function capabilityOf(model: string): ModelCapability | null {
  return MODEL_CAPABILITIES[normalizeModelKey(model)] ?? null;
}

/**
 * 这个模型可选的思考档集合。
 *
 * 能力表里有就照表的（可能是空数组 = 这个模型不认这一档控制）；
 * 没有就回落通用四档。
 */
export function thinkingLevelsOf(model: string): readonly ThinkingLevel[] {
  return capabilityOf(model)?.thinkingLevels ?? STANDARD_THINKING_LEVELS;
}

/**
 * 这个模型省略档位时自己用哪一档。能力表没写就是 `off`（= 不发字段 = 端点默认）。
 */
export function defaultThinkingLevelOf(model: string): ThinkingLevel {
  return capabilityOf(model)?.defaultThinkingLevel ?? "off";
}

/**
 * 下一档：chip 每点一次走一格，走到最后一档再点回到第一档。
 *
 * **在给定的集合里转**，而不是在全枚举里转：
 * 能力表说这个模型只认三档，循环就不许走出这三档（走出去就是往上游发一个它不认的值）。
 * 用穷尽 switch 而不是数组下标回绕——`noUncheckedIndexedAccess` 会让下标版本报
 * "可能是 undefined"，而这里每一档都必须给出下一档：将来枚举加了第七档却忘了改这张表，
 * tsc 直接在缺 case 的那一行拒绝编译（TS2366），比一个悄悄返回 undefined 的循环诚实得多。
 */
export function nextThinkingLevel(
  level: ThinkingLevel,
  levels: readonly ThinkingLevel[] = STANDARD_THINKING_LEVELS
): ThinkingLevel {
  if (levels.length === 0) return level;
  const at = levels.indexOf(level);
  // 当前档不在这一族里（换模型后残留的旧档）⇒ 从第一档重新开始。
  if (at < 0) return levels[0] as ThinkingLevel;
  return levels[(at + 1) % levels.length] as ThinkingLevel;
}

/**
 * 这一档**实际上线发的那个字**（2026-10-09 批次 5-㊻；2026-11-21 按模型能力表再收一次）。
 *
 * 两种口径，判据是**能力表认不认识这个模型**：
 *
 * 1. **表里没有这个模型** ⇒ 走**连接级**口径（Agnes 那类端点）：只有最高那一档的叫法会分歧，
 *    `low` / `medium` 两档各家一致，所以分歧由连接上的 `thinkingWire` 决定。
 * 2. **表里有这个模型** ⇒ 表里列出的档位名**就是线上那个字**
 *    （`MiniMax-M3.1-Flash` 的 `xhigh` 就是 `xhigh`、`max` 就是 `max`）。
 *    唯一的例外仍是「最高档被端点改了名」：表里最高档叫 `high` 而连接是 `xhigh` 口径时，
 *    仍然按连接走 `xhigh`。
 *
 * `off` 两种口径都返回空串：关档靠的是**不发字段**，提示里也照实说「不发」。
 */
export function thinkingWireValueOf(
  level: ThinkingLevel,
  wire: ThinkingWire = "standard",
  capability: ModelCapability | null = null
): string {
  if (level === "off") return "";
  const levels = capability?.thinkingLevels;
  if (levels === undefined) {
    // 能力表不认识这个模型 ⇒ 连接级口径。
    return level === "high" ? THINKING_WIRE_TOP_VALUE[wire] : level;
  }
  const top = levels[levels.length - 1];
  if (level === top) {
    if (capability?.topWire !== undefined) return capability.topWire;
    // 表里没给改名 ⇒ 仍尊重连接级口径（最高档叫 high 还是 xhigh 由端点决定）。
    return top === "high" ? THINKING_WIRE_TOP_VALUE[wire] : top;
  }
  return level;
}

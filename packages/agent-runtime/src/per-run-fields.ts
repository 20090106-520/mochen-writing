import {
  NETWORK_TOOL_NAMES,
  THINKING_WIRE_FIELD,
  thinkingWireValueOf,
  type ThinkingLevel,
  type ThinkingWire
} from "@mochen/contracts";

/**
 * 每轮开关 → 出站字节的唯一映射（task #101）。
 *
 * 整条链上只有这一个地方把枚举**拼成字节**：渲染层只发档位枚举，agent-service 只复用，
 * provider-client 只拼装。键名本身（`THINKING_WIRE_FIELD` / `WEB_SEARCH_TOOL_NAME`）住在
 * contracts，因为输入区的 title 也要报出同一对名字——名字一份、拼装一处，改名动两个地方而不是五处。
 * 将来要接一个字段名不同的端点，改的就是这两个函数加它们自己的测试，别处一个字都不动。
 */

/**
 * 思考档：`reasoning_effort`，且**关闭时一个字段都不发**。
 *
 * 依据来自参考仓 deepwrite 已跑通的 OpenAI 兼容出口：发 `reasoning_effort: "off"`
 * 在严格校验的端点上会 400，而「不发」在所有端点上都等于用户没碰过这个开关，零行为变化。
 *
 * **`wire` 是 2026-10-09 加的**（批次 5-㊻）：「OpenAI 兼容」不等于字段值一样。
 * Agnes AI Hub 真机回执：`Unexpected reasoning effort high. Supported types are xhigh
 * (default), medium, and low.` —— 它照收 low/medium，唯独最高那一档叫 `xhigh`。
 * 发 `high` 上去**整笔请求 400**，症状是「地址密钥全对但一个字都发不出去」。
 * 分歧只发生在最高档（`low`/`medium` 各家一致），所以映射也只动那一档，
 * 由**连接**决定（各家分歧不同），字面量住在 contracts 的 `THINKING_WIRE_TOP_VALUE`。
 *
 * 默认值是 `standard`：老调用方不改行为，也与旧配置（没有这一项）一致。
 */
export function thinkingBodyField(
  level: ThinkingLevel,
  wire: ThinkingWire = "standard"
): Record<string, string> {
  // 关档 = 不发字段（不是发 "off"）。判据在 contracts 的 thinkingWireValueOf，
  // 输入卡那枚 chip 的提示读的是同一个函数——提示与字节不许分家。
  const value = thinkingWireValueOf(level, wire);
  if (value === "") return {};
  return { [THINKING_WIRE_FIELD]: value };
}

/**
 * 联网开关 → 出站 `tools` 数组的唯一映射。
 *
 * 开 ⇒ 这一轮的工具原样交出去（里面含 `web_search` / `web_read` 两枚 function 工具：
 * 本地免费源、不要 key，真身在 `apps/desktop/src/main/doc-tools-host.ts`）；
 * 关 ⇒ 把**全部会出网的工具**（contracts 的 `NETWORK_TOOL_NAMES`）从名单里摘掉，
 * 模型这一轮就没有「上网查」这条路。2026-10-11 起 出网的有两枚（搜索 + 正文抓取），
 * 开关闸的是这一类——只摘 web_search 的话，模型还能用 web_read 出网，开关就成了摆设。
 *
 * **这里曾经发过一枚裸的 `{ type: "web_search" }`**（照 deepwrite 的 hosted tool 形状抄的），
 * 2026-10-08 被真机打掉：Agnes AI Hub 这类严格 OpenAI 兼容端点把它反序列化成
 * `tools[9].function`，然后发现缺 `parameters`，于是**整笔请求 400/422**——
 * 只要联网开关是开的，用户一个字都发不出去，而地址与密钥全是对的。
 * 出站 tools 里每一条都必须带完整的 `function`（name/description/parameters），
 * 这条不变量由 provider-client 的测试逐条钉死（反向用例：塞一枚缺 parameters 的工具必须被拒）。
 * 何况本仓的联网本来就有能跑的 function 版，hosted 那条既多余，又是唯一会让整批工具报废的东西。
 */
export function wireToolsFor<T extends { name: string }>(tools: T[], enabled: boolean): T[] {
  return enabled
    ? tools
    : tools.filter((tool) => !(NETWORK_TOOL_NAMES as readonly string[]).includes(tool.name));
}

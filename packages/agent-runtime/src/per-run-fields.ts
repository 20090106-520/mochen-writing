import { THINKING_WIRE_FIELD, WEB_SEARCH_WIRE_TYPE, type ThinkingLevel } from "@mochen/contracts";

/**
 * 每轮开关 → 出站字节的唯一映射（task #101）。
 *
 * 整条链上只有这一个地方把枚举**拼成字节**：渲染层只发档位枚举，agent-service 只搬运，
 * provider-client 只拼装。键名本身（`THINKING_WIRE_FIELD` / `WEB_SEARCH_WIRE_TYPE`）住在
 * contracts，因为输入区的 title 也要报出同一对名字——名字一份、拼装一处，改名动两个地方而不是五处。
 * 将来要接一个字段名不同的端点，改的就是这两个函数加它们自己的测试，别处一个字都不动。
 *
 * 两条形状的依据（都来自参考仓 deepwrite 已跑通的 OpenAI 兼容出口）：
 * 1. 思考用 `reasoning_effort`，且**关闭时一个字段都不发**——发 `reasoning_effort: "off"`
 *    在严格校验的端点上会 400，而「不发」在所有端点上都等于用户没碰过这个开关，零行为变化。
 * 2. 联网用 `tools` 里追加一枚 `{ type: "web_search" }`，而不是往 body 顶层塞自造字段。
 */
export function thinkingBodyField(level: ThinkingLevel): Record<string, string> {
  if (level === "off") return {};
  return { [THINKING_WIRE_FIELD]: level };
}

/** 联网条目：关 ⇒ 空数组（tools 保持原样），开 ⇒ 追加一枚服务端搜索工具。 */
export function webSearchToolEntry(enabled: boolean): Record<string, unknown>[] {
  return enabled ? [{ type: WEB_SEARCH_WIRE_TYPE }] : [];
}

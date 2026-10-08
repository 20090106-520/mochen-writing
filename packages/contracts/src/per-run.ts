import { z } from "zod";

/**
 * 每轮请求的两个开关（task #101）：深度思考档位与联网搜索。
 *
 * 这里只放**枚举与文案**，不放任何出站字段名——字段映射的唯一真身在
 * `packages/agent-runtime/src/per-run-fields.ts`。分工的理由是渲染层不许知道 URL/密钥，
 * 但它必须知道档位集合与中文标签；主进程反过来只需要字段名，不需要标签。
 *
 * 档位定成四档而不是 deepwrite 目录里的 low/high/max/xhigh：本仓只有一个 OpenAI 兼容出口，
 * `off|low|medium|high` 是 OpenAI `reasoning_effort` 公开文档里那三档加一个「不发字段」的关闭态，
 * 每一档都能被 `per-run-fields` 的测试钉死；多出来的 max/xhigh 属于厂商目录，本仓没有可验证的落点。
 */
export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const thinkingLevelSchema = z.enum(THINKING_LEVELS, {
  message: "思考档位只能是 关闭 / 较低 / 标准 / 深度 四档之一"
});

/**
 * chip 上那枚中文标签；键集与 THINKING_LEVELS 完全一致（测试逐字钉死）。
 *
 * #112 照参考图改档名：输入卡的思考那一枚现在只剩档位名（图标负责说明它是思考等级），
 * 所以词必须单独读得通——「低」是一枚摆设，「较低」才是一档。
 * 取值口径抄自 deepwrite 的 `builtInThinkingLabels`（同一批 wire 值 low/medium/high 在他那里就是
 * 较低/标准/深度），不是我自己另起的一套。
 */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  low: "较低",
  medium: "标准",
  high: "深度"
};

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
 */
export const THINKING_WIRE_FIELD = "reasoning_effort";
export const WEB_SEARCH_TOOL_NAME = "web_search";

/**
 * 下一档：chip 每点一次走一格，走到 high 再点回到 off。
 * 用穷尽 switch 而不是数组下标回绕——`noUncheckedIndexedAccess` 会让下标版本报
 * "可能是 undefined"，而这里每一档都必须给出下一档：将来枚举加了第五档却忘了改这张表，
 * tsc 直接在缺 case 的那一行拒绝编译（TS2366），比一个悄悄返回 undefined 的循环诚实得多。
 */
export function nextThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  switch (level) {
    case "off":
      return "low";
    case "low":
      return "medium";
    case "medium":
      return "high";
    case "high":
      return "off";
  }
}

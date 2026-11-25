import type { ThinkingLevel } from "@mochen/contracts";
import { useAgentStore } from "../stores/useAgentStore";
import { useProviderStore } from "../stores/useProviderStore";

/**
 * 模型级推理能力在**装配处**的那几根线（2026-11-21）。
 *
 * 为什么单独成文件而不是塞进中栏那份：中栏那份已经贴着 800 行硬门禁
 * （`tools/check-source-line-budget.mjs`），而这一族**不共享中栏的任何状态**——
 * 它只用到两个 store：provider（模型与档案）与 agent（这一轮发出去的档）。
 * 拆出来按「不共享状态」切，中栏那边只剩一行调用。
 *
 * ## 两根线各管什么
 *
 * - `onCycleThinking`：输入卡那枚思考 chip 点一下。**运行态**走一格；
 *   「记住思考档」开着时把这一档写回档案（每模型一档 ⇒ 切模型带着走）。
 * - `setModelLevel`：模型下拉里的「推理强度」——显式配置动作，**总是**落盘。
 */
export function useModelCapability(): {
  onCycleThinking: () => void;
  setModelLevel: (level: ThinkingLevel) => Promise<void>;
} {
  const agent = useAgentStore();
  const provider = useProviderStore();

  /**
   * 思考 chip：在这个**模型认的档位集合**里走一格。
   *
   * 两件事分开：
   * - **运行态**（`agent.thinkingLevel`）每点一次走一格——这一轮发出去的就是它；
   * - 「记住思考档」开着时，把这一档**写回档案**（每模型一档，切模型带着走）。
   *
   * 为什么这件事在装配处做：agent store 不知道当前是哪个模型（那是 provider 的事），
   * 而 provider store 又不该反过来改 agent 的运行态——两边互相 import 就是循环。
   * 装配处本来就同时拿着两个 store（它就是它们之间那根线）。
   */
  function onCycleThinking(): void {
    agent.cycleThinking(provider.activeThinkingLevels);
    if (!agent.thinkingRemembered) return;
    void provider.setModelCapability({ thinkingLevel: agent.thinkingLevel });
  }

  /** 模型下拉里的推理等级：写档案（模型级），顺带把运行态换过去。 */
  async function setModelLevel(level: ThinkingLevel): Promise<void> {
    await provider.setModelCapability({ thinkingLevel: level });
  }

  return { onCycleThinking, setModelLevel };
}

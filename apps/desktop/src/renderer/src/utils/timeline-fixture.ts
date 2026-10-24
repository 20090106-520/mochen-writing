/**
 * 时间线测试的共享夹具（2026-10-25 · §173）。
 *
 * 【为什么单独一份】`timeline.test.ts` 原本超了 800 行预算（834 行），
 * 失败条那组判定（stale / retryText）被拆进 `timeline-failure.test.ts`。
 * 两份测试都要「造一条事件」和「空流式尾巴」，而夹具**只有一份**——
 * 复制一份 `event()` 就等于让两处的默认字段（id / ts / turnId）各自漂。
 *
 * 只收**两份都要用**的东西；只有一份要用的（`turnEvent` / `cardOf`）留在那份测试里。
 */
import type { AgentEvent } from "@mochen/contracts";

/** 造一条事件：默认字段固定，测试要改的写在 rest 里。 */
export function event(type: AgentEvent["type"], rest: Record<string, unknown> = {}): AgentEvent {
  return {
    id: `e-${type}`,
    ts: "2026-10-01T00:00:00.000Z",
    turnId: "t1",
    type,
    ...rest
  } as AgentEvent;
}

/** 空流式尾巴：这一轮还没吐字。 */
export const NO_TAIL = { reasoning: "", message: "" };

/**
 * 跟随判据的测试（`utils/stick-to-bottom.ts`）。
 *
 * 这一族守的是三件真机上会翻车的事：
 * ① 取整误差让「恰好到底」永远不成立 ⇒ 跟随从不生效；
 * ② 往上滚回去一点就被判成「松手」⇒ 用户得反复往下拖才恢复；
 * ③ 内容 key 从**对象**算 ⇒ 就地改写的流式正文永远判成「没变」（`thread.streaming.message += …`）。
 */
import { describe, expect, it } from "vitest";
import {
  distanceToBottom,
  isStuckToBottom,
  STICK_SLACK,
  streamKey,
  type StreamShape
} from "./stick-to-bottom";

const SHAPE: StreamShape = {
  itemCount: 3,
  messageChars: 120,
  reasoningChars: 40,
  openCards: 1,
  settledCards: 0,
  expiredCards: 0
};

describe("离底距离", () => {
  it("滚到底就是 0", () => {
    expect(distanceToBottom({ scrollTop: 900, scrollHeight: 1400, clientHeight: 500 })).toBe(0);
  });

  it("差多少报多少", () => {
    expect(distanceToBottom({ scrollTop: 700, scrollHeight: 1400, clientHeight: 500 })).toBe(200);
  });

  it("滚过底（回弹 / 内容收起）报 0，不报负数", () => {
    // 负数会让「≤ slack」在一整段区间里恒真，也会让「还剩 N 字未读」读成负的。
    expect(distanceToBottom({ scrollTop: 960, scrollHeight: 1400, clientHeight: 500 })).toBe(0);
  });
});

describe("贴着底", () => {
  it("取整误差（差 0.5px）仍算贴底", () => {
    expect(isStuckToBottom({ scrollTop: 899.5, scrollHeight: 1400, clientHeight: 500 })).toBe(true);
  });

  it("往上翻了一行以内仍算贴底，翻过半屏就算松手", () => {
    expect(isStuckToBottom({ scrollTop: 880, scrollHeight: 1400, clientHeight: 500 })).toBe(true);
    expect(isStuckToBottom({ scrollTop: 700, scrollHeight: 1400, clientHeight: 500 })).toBe(false);
  });

  it("阈值可调，且默认值就是导出的那个数", () => {
    const m = { scrollTop: 880, scrollHeight: 1400, clientHeight: 500 };
    expect(isStuckToBottom(m, 0)).toBe(false);
    expect(isStuckToBottom(m, STICK_SLACK)).toBe(true);
  });

  it("内容不足一屏（压根滚不动）算贴底", () => {
    expect(isStuckToBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(true);
  });
});

describe("内容形状的 key", () => {
  it("正文多一个字就变（这正是就地改写唯一能被感知的地方）", () => {
    expect(streamKey({ ...SHAPE, messageChars: SHAPE.messageChars + 1 })).not.toBe(
      streamKey(SHAPE)
    );
  });

  it("一模一样的两份读同一个 key（不会为了同一个 delta 反复触发跟随）", () => {
    expect(streamKey({ ...SHAPE })).toBe(streamKey(SHAPE));
  });

  it("条数、思考、三类卡各自都能把 key 顶变", () => {
    const base = streamKey(SHAPE);
    expect(streamKey({ ...SHAPE, itemCount: 4 })).not.toBe(base);
    expect(streamKey({ ...SHAPE, reasoningChars: 41 })).not.toBe(base);
    expect(streamKey({ ...SHAPE, openCards: 2 })).not.toBe(base);
    expect(streamKey({ ...SHAPE, settledCards: 1 })).not.toBe(base);
    expect(streamKey({ ...SHAPE, expiredCards: 1 })).not.toBe(base);
  });

  it("相邻两项不会拼出同一个 key（分隔符要真的隔开）", () => {
    // 不用分隔符的话 (1,23) 与 (12,3) 会撞成 "123"：那种 key 会让「变了」判成「没变」。
    expect(streamKey({ ...SHAPE, itemCount: 1, messageChars: 23 })).not.toBe(
      streamKey({ ...SHAPE, itemCount: 12, messageChars: 3 })
    );
  });
});

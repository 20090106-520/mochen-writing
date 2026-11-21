import { describe, expect, it } from "vitest";
import { renderContextBlock } from "@mochen/agent-runtime";

/**
 * 「renderContextBlock · 上下文块」一组从 agent-service-prompt.test.ts 拆出（2026-11-20）：
 * 伏笔段进装配后该文件过了 800 行预算闸；按主题拆文件，用例一字不改。
 * 与 prompt-assembly 的拆分口径一致——纯函数装配测试，不起盘、不连 provider、不碰 IPC。
 */
const NO_CONTEXT = { items: [], chars: 0, approxTokens: 0 };

describe("renderContextBlock · 上下文块", () => {
  it("空包不产出「已装配的上下文」空标题（那是给模型看的噪声）", () => {
    expect(renderContextBlock(NO_CONTEXT)).toBe("");
  });

  it("有条目才追加上下文块：标题与正文都进得去", () => {
    const block = renderContextBlock({
      items: [
        {
          kind: "chapter",
          relPath: "chapters/01-开局.md",
          title: "开局",
          text: "雾从海面涌上来。",
          chars: 8,
          active: true
        }
      ],
      chars: 8,
      approxTokens: 8
    });
    expect(block).toContain("正文（本章）");
    expect(block).toContain("雾从海面涌上来。");
  });

  it("伏笔段用「伏笔」标签单独成块：标签表只有 contracts 一份（2026-11-20）", () => {
    const block = renderContextBlock({
      items: [
        {
          kind: "foreshadow",
          relPath: "foreshadow:pending",
          title: "待收伏笔 1 条",
          text: "老枪的伤（埋设于 开篇）——已埋未收，写到相关情节时记得交代或推进这条线",
          chars: 34,
          active: false
        }
      ],
      chars: 34,
      approxTokens: 34
    });
    expect(block).toContain("伏笔·待收伏笔");
    expect(block).toContain("老枪的伤（埋设于 开篇）");
  });
});

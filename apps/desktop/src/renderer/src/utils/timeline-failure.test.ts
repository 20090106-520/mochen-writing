/**
 * 失败条的两枚新字段（2026-10-25 · §173）。
 *
 * 病根是**语气错位**：红底红字是「刚刚炸了」，而那条失败是两天前的、后面已经聊回来了
 * （用户原话：「还有红色的那个东西，解决一下」）。
 * ⇒ 一条失败若**后面又往前走过了**（新的提问或新的回复），它就降成一行低调记录；
 * 而「再问一次」要填回输入框的那句，就是它**前面**最近一条用户提问。
 *
 * 【为什么从 timeline.test.ts 里拆出来】那份原本 834 行、超了 800 行预算。
 * 判定只在这一族里（`utils/timeline.ts` 的 markStaleFailures），
 * 测试也跟着按**一族一文件**拆：这里量失败条，那边量用量块与提案卡。
 * 共享的夹具（`event` / `NO_TAIL`）在 `timeline-fixture.ts`，只有一份。
 */
import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline";
import { NO_TAIL, event } from "./timeline-fixture";

describe("失败条 · stale 与 retryText（2026-10-25 · §173）", () => {
  const errorBlock = (blocks: ReturnType<typeof buildTimeline>) =>
    blocks.find((block) => block.kind === "error");

  it("失败前最近那一句被记住：「再问一次」填回输入框的就是它", () => {
    const blocks = buildTimeline(
      [
        event("user-message", { text: "先写第一句" }),
        event("user-message", { text: "把这段改得有雾气" }),
        event("error", { message: "模型服务端返回 400：工具清单被服务端退了" })
      ],
      NO_TAIL
    );
    expect(errorBlock(blocks)).toMatchObject({ retryText: "把这段改得有雾气" });
  });

  it("失败前一句提问都没有 ⇒ retryText 是 null（不许拿空串去填输入框）", () => {
    const blocks = buildTimeline([event("error", { message: "炸了" })], NO_TAIL);
    expect(errorBlock(blocks)).toMatchObject({ retryText: null });
  });

  it("后面又聊回来了 ⇒ 那条失败是 stale（红底降成低调一行）", () => {
    const blocks = buildTimeline(
      [
        event("user-message", { text: "甲" }),
        event("error", { message: "炸了" }),
        event("user-message", { text: "乙" }),
        event("message", { text: "好" })
      ],
      NO_TAIL
    );
    expect(errorBlock(blocks)).toMatchObject({ stale: true });
  });

  it("失败是最后一件事 ⇒ 不 stale：那才是「刚刚炸了」，该红就红", () => {
    const blocks = buildTimeline(
      [event("user-message", { text: "甲" }), event("error", { message: "炸了" })],
      NO_TAIL
    );
    expect(errorBlock(blocks)).toMatchObject({ stale: false });
  });

  it("正在流式的那条正文也算「往前走过了」", () => {
    const blocks = buildTimeline(
      [event("user-message", { text: "甲" }), event("error", { message: "炸了" })],
      { reasoning: "", message: "正在写" }
    );
    expect(errorBlock(blocks)).toMatchObject({ stale: true });
  });

  it("失败条在链子中间，前后都判：只有它**后面**有东西才算被盖过", () => {
    // 前面有东西不算「盖过」——盖住它的是后来的成功，不是它之前的提问。
    const blocks = buildTimeline(
      [event("message", { text: "先答过一句" }), event("error", { message: "炸了" })],
      NO_TAIL
    );
    expect(errorBlock(blocks)).toMatchObject({ stale: false });
  });
});

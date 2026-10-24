import { describe, expect, it } from "vitest";
import {
  ASK_AGAIN_VIEW,
  COPY_NOTICES,
  MESSAGE_ACTION_VIEWS,
  PREFILL_NOTICE,
  actionsForSpeaker
} from "./message-actions";

/**
 * 消息操作条的动作清单（2026-10-25 · §173）。
 *
 * 用户原话：「你光参考了 UI，没有参考它的功能，因为我那个对话的功能不全，还有很多问题。」
 * ⇒ 这一族是**功能**那一半的清单：写稿时最常干的两件事——
 * ① 把写好的段落复制走；② 把自己那句改一改再问一次。
 */
describe("actionsForSpeaker · 谁给哪些动作", () => {
  it("助手回复：只给「复制」", () => {
    // 「改一改再问」是对**自己的问法**说的；回复是成稿，没有"改问法"这回事。
    expect(actionsForSpeaker("assistant").map((a) => a.id)).toEqual(["copy"]);
  });

  it("自己说的：给「复制」与「改一改再问」", () => {
    expect(actionsForSpeaker("user").map((a) => a.id)).toEqual(["copy", "edit-ask"]);
  });

  it("每一枚动作都有可读的名字与悬停说明（不许出现空标签）", () => {
    for (const view of [
      ...actionsForSpeaker("user"),
      ...actionsForSpeaker("assistant"),
      ASK_AGAIN_VIEW
    ]) {
      expect(view.label.trim(), `${view.id} 没有名字`).not.toBe("");
      expect(view.title.trim(), `${view.id} 没有悬停说明`).not.toBe("");
    }
  });

  it("「改一改再问」不叫「编辑」：按下去不会改掉已经发出去的那句", () => {
    // 已经发出去的话是历史，不该被偷偷改写——它只把原话填回输入框。
    expect(MESSAGE_ACTION_VIEWS["edit-ask"].label).toBe("改一改再问");
    expect(MESSAGE_ACTION_VIEWS["edit-ask"].label).not.toBe("编辑");
  });

  it("失败条上那枚叫「再问一次」，与消息条上的「改一改再问」是两件事、两个词", () => {
    expect(ASK_AGAIN_VIEW.label).toBe("再问一次");
    expect(ASK_AGAIN_VIEW.id).toBe("edit-ask");
  });

  it("复制成与没成，各有一句人话（不许只有成功那一档）", () => {
    expect(COPY_NOTICES.ok.title).toBe("已复制");
    expect(COPY_NOTICES.failed.title).toBe("复制失败");
    expect(COPY_NOTICES.failed.message.trim()).not.toBe("");
  });

  it("填回输入框之后要说一句「改完再发」", () => {
    expect(PREFILL_NOTICE.message).toContain("改完");
  });
});

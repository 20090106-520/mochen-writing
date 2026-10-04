import { describe, expect, it } from "vitest";
import type { SessionListItem } from "@mochen/contracts";
import { MISSING_DOC_ROW_REASON, UNBOUND_ROW_REASON, sessionRowAction } from "./session-row-action";

/** 一行会话的最小真值：这张表只钉「点下去会发生什么」与那句中文理由。 */
function row(sessionId: string, docRelPath: string): SessionListItem {
  return {
    sessionId,
    docRelPath,
    model: "mochen-mock",
    startedAt: "2026-10-01T00:00:00.000Z",
    title: "改紧一点"
  };
}

const CH = "chapters/01-开局.md";
const LIVE = ["chapters/01-开局.md", "chapters/02-转折.md"];
/** 默认上下文：在看 s-new、书里就那两章、没有回复在途。用例只覆盖自己在意的那一格。 */
const ctx = {
  currentSessionId: "s-new",
  existingDocPaths: LIVE,
  responding: false,
  unbound: false
};

describe("sessionRowAction（历史对话面板每一行点下去会发生什么）", () => {
  it("同章的另一条历史：可以打开", () => {
    expect(sessionRowAction(row("s-old", CH), ctx)).toEqual({ kind: "open" });
  });

  it("正在看的那一条：current，不重复读盘", () => {
    expect(sessionRowAction(row("s-new", CH), ctx)).toEqual({
      kind: "current",
      reason: "正在看这一条。"
    });
  });

  /**
   * 渲染层「还不知道当前是哪一条」= 空串（这一轮由发轮新建，id 只在主进程那边）。
   * 这时任何一行都不许冒充 current——否则面板会把整列都标成正在看。
   */
  it("currentSessionId 是空串时谁都不算当前", () => {
    expect(sessionRowAction(row("s-new", CH), { ...ctx, currentSessionId: "" })).toEqual({
      kind: "open"
    });
  });

  /** 照他那份的语义：回复在途时只有「正在看的那条」免禁用，其余一律切不了。 */
  it("回复在途：可点的行变禁用，正在看的那条不受影响", () => {
    expect(sessionRowAction(row("s-old", CH), { ...ctx, responding: true })).toEqual({
      kind: "disabled",
      reason: "回复完成或停止后可切换。"
    });
    expect(sessionRowAction(row("s-new", CH), { ...ctx, responding: true }).kind).toBe("current");
  });

  /**
   * 本仓每章一条线程，unbound 线程只在「一个文稿标签都没开」时出现；从面板走到它得先关掉
   * 全部标签，而 closeTab 会删掉 draftsByPath 里的未保存草稿 ⇒ 缺通路不做假控件（铁律⑥）。
   */
  it("未绑定文稿的那一条禁用，理由说清「会丢草稿」", () => {
    expect(sessionRowAction(row("s-0", "unbound"), { ...ctx, unbound: true })).toEqual({
      kind: "disabled",
      reason: UNBOUND_ROW_REASON
    });
    // 顺序钉：unbound 比「正在看」「在回复」更硬——理由是不可逆的数据丢失，不是忙。
    expect(
      sessionRowAction(row("s-0", "unbound"), { ...ctx, unbound: true, currentSessionId: "s-0" })
    ).toEqual({ kind: "disabled", reason: UNBOUND_ROW_REASON });
    expect(
      sessionRowAction(row("s-0", "unbound"), { ...ctx, unbound: true, responding: true })
    ).toEqual({ kind: "disabled", reason: UNBOUND_ROW_REASON });
  });

  it("文稿已不在书里：禁用并说清断在哪一段", () => {
    expect(
      sessionRowAction(row("s-x", "chapters/09-删掉的章.md"), { ...ctx, unbound: true })
    ).toEqual({ kind: "disabled", reason: UNBOUND_ROW_REASON });
    expect(
      sessionRowAction(row("s-x", "chapters/09-删掉的章.md"), { ...ctx, unbound: false })
    ).toEqual({ kind: "disabled", reason: MISSING_DOC_ROW_REASON });
  });

  /** 文案照字面量再钉一遍：上面的用例引用常量，改常量它们跟着一起改照样绿；只有这条会红。 */
  it("两句禁用理由的原文由这里定稿", () => {
    expect(UNBOUND_ROW_REASON).toBe(
      "这条对话没有绑定文稿，打开它要先关掉当前文稿标签，未保存的草稿会丢。"
    );
    expect(MISSING_DOC_ROW_REASON).toBe("这条对话的文稿已经不在书里，读不回来了。");
  });

  /** 穷尽性护栏（tsc 探针，同 hotkeys 的 X3 手法）：新增 kind 却漏了这里的分支，编译不过。 */
  it("返回值只可能是 open / current / disabled 三种", () => {
    const action = sessionRowAction(row("s-old", CH), ctx);
    switch (action.kind) {
      case "open":
        expect(action.kind).toBe("open");
        break;
      case "current":
      case "disabled":
        expect(action.reason).toContain("。");
        break;
      default: {
        const unreachable: never = action;
        throw new Error(`没登记过的行动作：${JSON.stringify(unreachable)}`);
      }
    }
  });
});

/**
 * W-06 守卫：进度读数只从事件流与在途残字推，状态行旧四态逐字不变。
 *
 * 本仓 `.vue` 不进类型程序，所以「装配层有没有真的把读数递给状态行」另有一份
 * 源码契约守卫（components/status-line-progress-wiring.test.ts）；这里只测判定真身。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { composeStatusLine, newThread, type ThreadView } from "./agent-thread";
import { bodyCharCount, formatCharCount } from "./char-count";
import { EMPTY_TURN_PROGRESS, turnProgressOf, type StatusProgress } from "./turn-progress";

const TURN = { id: "e1", ts: "2026-11-11T00:00:00.000Z", turnId: "t1" };

function ev(type: string, extra: Record<string, unknown> = {}): AgentEvent {
  return { ...TURN, type, ...extra } as unknown as AgentEvent;
}

function view(items: AgentEvent[] = [], streaming = ""): ThreadView {
  return { ...newThread(), items, streaming: { reasoning: "", message: streaming } };
}

function extra(
  progress: Partial<StatusProgress["progress"]> = {},
  targetChars = 0
): StatusProgress {
  return { progress: { ...EMPTY_TURN_PROGRESS, ...progress }, targetChars };
}

describe("bodyCharCount：全仓唯一的「正文非空白字数」算法", () => {
  it("空白不计、标点与中英混排各算一个", () => {
    expect(bodyCharCount("")).toBe(0);
    expect(bodyCharCount("  \n\t ")).toBe(0);
    expect(bodyCharCount("海雾，来了。\n  A B")).toBe(8);
    expect(formatCharCount(bodyCharCount("字".repeat(1240)))).toBe("1,240 字");
    expect(formatCharCount(12_345)).toBe("1.2 万字");
  });
});

describe("turnProgressOf：本轮界定与残字不重账", () => {
  it("没有线程就是三个零（不把 NaN 摆上屏）", () => {
    expect(turnProgressOf(undefined)).toEqual(EMPTY_TURN_PROGRESS);
    expect(turnProgressOf(view())).toEqual(EMPTY_TURN_PROGRESS);
  });

  it("只认最后一条 user-message 之后的事件，历史回放的旧轮不算这一轮", () => {
    const thread = view([
      ev("user-message", { text: "第一轮" }),
      ev("message", { text: "旧轮写了九百字。", interrupted: false }),
      ev("user-message", { text: "第二轮" }),
      ev("message", { text: "新轮四个字。", interrupted: false })
    ]);
    expect(turnProgressOf(thread).chars).toBe("新轮四个字。".length);
  });

  it("落库的正文字与在途残字相加，同一批字不报两遍", () => {
    const landed = ev("message", { text: "第一段写完。\n", interrupted: false });
    const thread = view([ev("user-message", { text: "继续" }), landed], "第二段还在流。");
    const progress = turnProgressOf(thread);
    expect(progress.chars).toBe(bodyCharCount("第一段写完。\n第二段还在流。"));
    expect(progress.paragraphs).toBe(2);
  });

  it("打断后的半截文本也算已写——屏幕上确实有那些字", () => {
    const thread = view([
      ev("user-message", { text: "写下去" }),
      ev("message", { text: "他推开门，看见", interrupted: true })
    ]);
    expect(turnProgressOf(thread).chars).toBe(7);
  });

  it("没有受理凭据就只认在途残字，宁可少报也不把旧轮算成产出", () => {
    const thread = view(
      [ev("message", { text: "历史里的旧字", interrupted: false })],
      "正在流的字"
    );
    expect(turnProgressOf(thread).chars).toBe(bodyCharCount("正在流的字"));
  });

  it("连续换行只切一段，空行不占段数", () => {
    const thread = view([
      ev("user-message", { text: "分三段" }),
      ev("message", { text: "甲\n\n\n乙\n \n丙", interrupted: false })
    ]);
    expect(turnProgressOf(thread).paragraphs).toBe(3);
  });

  it("改了几处只数真正落盘的 written 事件，待审提案不算成绩", () => {
    const thread = view([
      ev("user-message", { text: "改稿" }),
      ev("proposal", { proposal: { id: "p1" } }),
      ev("written", {
        proposalId: "p1",
        docRelPath: "chapters/01.md",
        fingerprint: "f1",
        backupRelPath: null
      }),
      ev("written", {
        proposalId: "p2",
        docRelPath: "chapters/02.md",
        fingerprint: "f2",
        backupRelPath: null
      })
    ]);
    expect(turnProgressOf(thread).edits).toBe(2);
    expect(turnProgressOf(thread).chars).toBe(0);
  });
});

describe("composeStatusLine：不递进度时旧四态逐字不变", () => {
  const running = { ...view(), running: true };
  const idle = view();

  it("工作中 / 排队 / 待审 / 就绪 / 打断 / 失败", () => {
    expect(composeStatusLine(running, 42, 0, 0)).toBe("工作中 · 42s · Esc 打断");
    expect(composeStatusLine(running, 42, 0, 2)).toBe("工作中 · 42s · Esc 打断 · 排队 2 条");
    expect(composeStatusLine(idle, 0, 3, 0)).toBe("3 条待审");
    expect(composeStatusLine(idle, 0, 0, 0)).toBe("就绪");
    expect(composeStatusLine(undefined, 0, 0, 0)).toBe("就绪");
    const cut = { ...idle, endedAs: "interrupted" as const };
    expect(composeStatusLine(cut, 0, 2, 0)).toBe("已打断 · 2 条待审");
    // 2026-11-20：状态行不再写「可点「继续」」——那句话所在的位置是纯文本，点不动。
    // 「继续」现在是一枚真按钮（挂点判定在 utils/turn-resume.ts，渲染在中栏状态栏）。
    expect(composeStatusLine(cut, 0, 0, 0)).toBe("已打断");
    const failed = { ...idle, endedAs: "failed" as const, lastError: "上游繁忙" };
    expect(composeStatusLine(failed, 0, 0, 0)).toBe("上游繁忙");
  });

  it("状态行不许出现点不动的承诺（2026-11-20）：「可点」三个字不许再上屏", () => {
    const cut = { ...idle, endedAs: "interrupted" as const };
    const failed = { ...idle, endedAs: "failed" as const, lastError: "上游繁忙" };
    for (const line of [
      composeStatusLine(cut, 0, 0, 0),
      composeStatusLine(cut, 0, 2, 0),
      composeStatusLine(failed, 0, 0, 0)
    ]) {
      expect(line).not.toContain("可点");
    }
  });

  it("递了零进度也不能改文案（读数为零时不摆空话）", () => {
    expect(composeStatusLine(running, 42, 0, 0, extra())).toBe("工作中 · 42s · Esc 打断");
    expect(composeStatusLine({ ...idle, endedAs: "done" }, 0, 0, 0, extra())).toBe("就绪");
  });
});

describe("composeStatusLine：递了进度才插读数，单位是人读的", () => {
  const running = { ...view(), running: true };

  it("没设目标：已写 N 字 · 段数 · 等待秒数", () => {
    expect(composeStatusLine(running, 42, 0, 0, extra({ chars: 1240, paragraphs: 3 }))).toBe(
      "工作中 · 已写 1,240 字 · 3 段 · 42s · Esc 打断"
    );
  });

  it("设了目标：分母同屏，排队数仍在最后", () => {
    expect(composeStatusLine(running, 137, 0, 2, extra({ chars: 1240, paragraphs: 3 }, 3000))).toBe(
      "工作中 · 已写 1,240 / 3,000 字 · 3 段 · 2min · Esc 打断 · 排队 2 条"
    );
  });

  it("坏读数与负数一律当零，不把 NaN 摆上屏", () => {
    expect(
      composeStatusLine(running, -5, 0, 0, extra({ chars: Number.NaN, paragraphs: -1 }, -9))
    ).toBe("工作中 · 0s · Esc 打断");
  });

  it("一轮正常收场留成绩单：写了多少、改了几处、还剩几条待审", () => {
    const done = { ...view(), endedAs: "done" as const };
    expect(composeStatusLine(done, 0, 1, 0, extra({ chars: 1840, paragraphs: 6, edits: 2 }))).toBe(
      "上一轮已完成 · 本轮 1,840 字 · 改了 2 处 · 1 条待审"
    );
    expect(composeStatusLine(done, 0, 0, 0, extra({ chars: 1840 }))).toBe(
      "上一轮已完成 · 本轮 1,840 字"
    );
  });

  it("打断与失败态不插成绩单——那两态第一句该是原因", () => {
    const cut = { ...view(), endedAs: "interrupted" as const };
    expect(composeStatusLine(cut, 0, 2, 0, extra({ chars: 900, edits: 1 }))).toBe(
      "已打断 · 2 条待审"
    );
    const failed = { ...view(), endedAs: "failed" as const, lastError: "上游 503" };
    expect(composeStatusLine(failed, 0, 0, 0, extra({ chars: 900 }))).toBe("上游 503");
  });
});

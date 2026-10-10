import { describe, expect, it } from "vitest";
import type { ContextHistoryStat, ContextPreview } from "@mochen/contracts";
import { appendHistoryRow, historyMeterRow, historyNoticeText } from "./history-window";
import type { ContextMeterRow } from "./context-meter";

/**
 * P1-3 占用条「会话历史」格的判定层单测。
 * 判据只许这一处（铁律 6）：面板与 ContextMeter 都只挂线，所以「什么时候出行、
 * 话怎么说」全压在这里测。
 */
function preview(over: Partial<ContextPreview> = {}): ContextPreview {
  return {
    profileId: "lead-writer",
    profileName: "墨宸 · 主笔",
    items: [],
    chars: 0,
    approxTokens: 0,
    empty: false,
    ...over
  };
}

function stat(over: Partial<ContextHistoryStat> = {}): ContextHistoryStat {
  return { entries: 14, chars: 5600, approxTokens: 5600, droppedCount: 0, ...over };
}

function baseRow(over: Partial<ContextMeterRow> = {}): ContextMeterRow {
  return {
    key: "k",
    label: "本章",
    title: "开局",
    chars: 100,
    charsLabel: "100 字",
    active: true,
    ...over
  };
}

describe("historyMeterRow", () => {
  it("还没问过主进程（null）⇒ 不给历史行：null 是「未知」，不许编一行假的", () => {
    expect(historyMeterRow(null)).toBeNull();
  });

  it("旧预览没有 history 字段 ⇒ 也不给行（旧历史回放兼容：字段是后加的可选件）", () => {
    expect(historyMeterRow(preview())).toBeNull();
  });

  it("有历史没截断 ⇒ 出行：标签写「会话历史」，字数栏带条数与字数", () => {
    const row = historyMeterRow(preview({ history: stat() }));
    expect(row).not.toBeNull();
    expect(row?.label).toBe("会话历史");
    expect(row?.charsLabel).toContain("14 条");
    expect(row?.charsLabel).toContain("5600 字");
  });

  it("行 title 把 token 占用说清楚（k 口径与 context-meter 同源，不另造缩写）", () => {
    const row = historyMeterRow(preview({ history: stat({ approxTokens: 5600 }) }));
    expect(row?.title).toContain("5.6k");
  });

  it("截断了 ⇒ title 里必须带上「更早的 N 条」，不许只报 kept 假装没事", () => {
    const row = historyMeterRow(
      preview({ history: stat({ droppedCount: 6, droppedChars: 2412 }) })
    );
    expect(row?.title).toMatch(/更早的\s*6\s*条/);
  });

  it("全被切掉（entries 0 但 dropped>0）⇒ 照样出行：「一条都没发」更是必须让人看见", () => {
    const row = historyMeterRow(
      preview({
        history: stat({ entries: 0, chars: 0, approxTokens: 0, droppedCount: 3, droppedChars: 900 })
      })
    );
    expect(row).not.toBeNull();
  });

  it("entries 0 且 dropped 0 ⇒ 真没历史，不出行占版面", () => {
    expect(
      historyMeterRow(preview({ history: stat({ entries: 0, chars: 0, approxTokens: 0 }) }))
    ).toBeNull();
  });
});

describe("historyNoticeText", () => {
  it("没截断（dropped 缺省或 0）⇒ 空串：不许对没超长的用户谎报「丢了」", () => {
    expect(historyNoticeText(null)).toBe("");
    expect(historyNoticeText(preview())).toBe("");
    expect(historyNoticeText(preview({ history: stat() }))).toBe("");
    expect(historyNoticeText(preview({ history: stat({ droppedCount: 0 }) }))).toBe("");
  });

  it("截断了 ⇒ 那句人话：条数与字数都在（与 startTurn 那条 notice 同一口径）", () => {
    const text = historyNoticeText(
      preview({ history: stat({ droppedCount: 6, droppedChars: 2412 }) })
    );
    expect(text).toBe("更早的 6 条没有发给模型（约 2412 字）。");
  });
});

describe("appendHistoryRow", () => {
  it("无历史行 ⇒ 原样返回同内容，不多不少", () => {
    const rows = [baseRow()];
    expect(appendHistoryRow(rows, preview())).toEqual(rows);
  });

  it("有历史行 ⇒ 排在最后（装配条目在前，历史垫底），且不改动传入数组（铁律：不原地变异）", () => {
    const rows = [baseRow()];
    const out = appendHistoryRow(rows, preview({ history: stat() }));
    expect(out).toHaveLength(2);
    expect(out[1]?.label).toBe("会话历史");
    expect(rows).toHaveLength(1);
  });
});

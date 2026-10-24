/**
 * 作品工作项面板（§174）· 判据单测。
 *
 * 判据只有一份（铁律 6）：`utils/work-items.ts` 是分组表、行组装、跳转目标的唯一真身，
 * 组件只接线。所以这里测的**就是面板会显示什么**——组件那份接线由
 * `components/work-items-wiring.test.ts` 钉。
 *
 * 三条纪律各有各的用例钉着：
 * ① **空组不出现**（§168 用户评「空壳没啥用」）：没有待审就不摆「待审」这一组。
 * ② **每行都有真数据**：会话行有标题/副行/右格，待审只列 pending，伏笔只列「还欠着的」。
 * ③ **点不了就别点**：禁用的行把理由写进 hint，不给一个点了没反应的假控件。
 */
import { describe, expect, it } from "vitest";
import { UNBOUND, type EditProposal, type SessionListItem } from "@mochen/contracts";
import {
  FORESHADOW_NO_PLANT_LABEL,
  SESSION_EMPTY_TITLE,
  SESSION_UNBOUND_LABEL,
  WORK_ITEM_GROUP_TABLE,
  WORK_ITEMS_TITLE,
  sessionDocLabel,
  sessionHint,
  sessionTitle,
  workItemCount,
  workItemGroups,
  type WorkItemInput
} from "./work-items";
import { sessionRowAction, type SessionRowContext } from "./session-row-action";
import type { ProposalView } from "./agent-thread";
import type { ForeshadowRow } from "./foreshadow";

/** 会话行的可点性走**现成那一份**（utils/session-row-action.ts），面板不自己判。 */
function actionOf(item: SessionListItem, context: Partial<SessionRowContext> = {}) {
  return sessionRowAction(item, {
    currentSessionId: "",
    existingDocPaths: [item.docRelPath],
    responding: false,
    unbound: item.docRelPath === UNBOUND,
    ...context
  });
}

function sessionOf(patch: Partial<SessionListItem> & { sessionId: string }): SessionListItem {
  return {
    docRelPath: "chapters/01-雾港.md",
    model: "mochen-chat",
    startedAt: "2020-06-15T12:00:00.000Z",
    title: "这一段要改",
    ...patch
  };
}

function proposalOf(
  id: string,
  status: ProposalView["status"],
  patch: Partial<EditProposal> = {}
): ProposalView {
  return {
    proposal: {
      id,
      threadKey: "chapters/01-雾港.md",
      turnId: "t1",
      docRelPath: "chapters/01-雾港.md",
      mode: "anchor-replace",
      anchor: "旧句",
      replace: "新句",
      why: "把节奏调慢一点",
      tool: "write_doc",
      source: "tool-call",
      expectedFingerprint: "fp-1",
      createdAt: "2020-06-15T12:00:00.000Z",
      ...patch
    },
    status,
    message: "",
    diff: ""
  };
}

function foreshadowOf(patch: Partial<ForeshadowRow> & { relPath: string }): ForeshadowRow {
  return {
    title: "老钟的怀表",
    status: "planted",
    statusLabel: "已埋下",
    plantedIn: "chapters/03-夜航.md",
    paidIn: "",
    rawStatus: "planted",
    keywords: [],
    tone: "pending",
    ...patch
  };
}

function inputOf(patch: Partial<WorkItemInput> = {}): WorkItemInput {
  return {
    sessions: [],
    sessionActionOf: (item) => actionOf(item),
    proposals: [],
    foreshadows: [],
    docTitleOf: (relPath) => (relPath === "chapters/01-雾港.md" ? "第一章 雾港" : relPath),
    ...patch
  };
}

describe("分组表 · 三组、什么顺序、叫什么", () => {
  it("顺序与标签是表里那一份（组件不许自己枚举第二遍）", () => {
    expect(WORK_ITEM_GROUP_TABLE.map((g) => g.id)).toEqual(["sessions", "pending", "foreshadows"]);
    expect(WORK_ITEM_GROUP_TABLE.map((g) => g.label)).toEqual(["对话", "待审", "伏笔"]);
    expect(WORK_ITEMS_TITLE).toBe("工作项");
  });

  it("每组都有图标（组头那一枚）", () => {
    for (const group of WORK_ITEM_GROUP_TABLE) {
      expect(group.icon, `${group.id} 组没有图标`).toBeTruthy();
    }
  });
});

describe("对话组 · 每行都是一件能点开的事", () => {
  it("标题取会话标题，没用户输入时说实话（不拿章名冒充）", () => {
    expect(sessionTitle(sessionOf({ sessionId: "s1", title: "第三章怎么收" }))).toBe(
      "第三章怎么收"
    );
    expect(sessionTitle(sessionOf({ sessionId: "s2", title: "" }))).toBe(SESSION_EMPTY_TITLE);
  });

  it("副行取那篇文稿的标题；没绑文稿时印「未绑定文稿」而不是英文哨兵", () => {
    const item = sessionOf({ sessionId: "s1" });
    expect(sessionDocLabel(item, () => "第一章 雾港")).toBe("第一章 雾港");
    const unbound = sessionOf({ sessionId: "s2", docRelPath: UNBOUND });
    expect(sessionDocLabel(unbound, () => "第一章 雾港")).toBe(SESSION_UNBOUND_LABEL);
    expect(SESSION_UNBOUND_LABEL).not.toContain("unbound");
  });

  it("查不到真名时退回路径本身（名字可以土，不能假）", () => {
    const item = sessionOf({ sessionId: "s1", docRelPath: "chapters/99-没收录.md" });
    expect(sessionDocLabel(item, (relPath) => relPath)).toBe("chapters/99-没收录.md");
  });

  it("可点性走现成那份判定：只有 open 才不点，禁用/正在看都点不了，理由写进 hint", () => {
    const open = sessionOf({ sessionId: "s-open" });
    const disabled = sessionOf({ sessionId: "s-off" });
    const groups = workItemGroups(
      inputOf({
        sessions: [open, disabled],
        sessionActionOf: (item) =>
          item.sessionId === "s-off"
            ? { kind: "disabled", reason: "这条对话的文稿已经不在书里，读不回来了。" }
            : actionOf(item)
      })
    );
    const rows = groups[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.disabled).toBe(false);
    expect(rows[0]!.hint).toBe("模型：mochen-chat");
    expect(rows[1]!.disabled).toBe(true);
    expect(rows[1]!.hint).toBe("这条对话的文稿已经不在书里，读不回来了。");
  });

  it("正在看的那一条亮着，不算「点不了」（照参照面板那份「当前项亮着」）", () => {
    const item = sessionOf({ sessionId: "s-cur" });
    const groups = workItemGroups(
      inputOf({
        sessions: [item],
        sessionActionOf: (row) => actionOf(row, { currentSessionId: "s-cur" })
      })
    );
    const row = groups[0]!.rows[0]!;
    expect(row.current).toBe(true);
    expect(row.disabled).toBe(false);
    expect(row.hint).toBe("正在看这一条。");
  });

  it("右格是时间：走 formatHistoryTime（认不出的时间原样退回，不编一个）", () => {
    const groups = workItemGroups(
      inputOf({ sessions: [sessionOf({ sessionId: "s1", startedAt: "不是时间" })] })
    );
    expect(groups[0]!.rows[0]!.meta).toBe("不是时间");
  });

  it("悬停说明是模型（右格给的是时间、副行给的是哪一章，剩下还没说出口的就是它）", () => {
    expect(sessionHint(sessionOf({ sessionId: "s1", model: "mochen-pro" }))).toBe(
      "模型：mochen-pro"
    );
  });

  it("行的落点是那一条会话本身（点它 = 走过去接着聊）", () => {
    const item = sessionOf({ sessionId: "s1" });
    const groups = workItemGroups(inputOf({ sessions: [item] }));
    const target = groups[0]!.rows[0]!.target;
    expect(target.kind).toBe("session");
    if (target.kind !== "session") throw new Error("落点不是会话");
    expect(target.item.sessionId).toBe("s1");
  });
});

describe("待审组 · 只列还等着人点头的", () => {
  it("只有 pending 进组；已写入/已拒/取消/过期都不列", () => {
    const groups = workItemGroups(
      inputOf({
        proposals: [
          proposalOf("p-pending", "pending"),
          proposalOf("p-written", "written"),
          proposalOf("p-rejected", "rejected"),
          proposalOf("p-cancelled", "cancelled"),
          proposalOf("p-expired", "expired"),
          proposalOf("p-stale", "stale"),
          proposalOf("p-failed", "failed")
        ]
      })
    );
    const pending = groups.find((g) => g.id === "pending");
    expect(pending).toBeDefined();
    expect(pending!.rows).toHaveLength(1);
    expect(pending!.rows[0]!.id).toBe("pending:p-pending");
  });

  it("主行是提案的理由；理由没写就说「改稿提案」，不编一句", () => {
    const groups = workItemGroups(
      inputOf({
        proposals: [proposalOf("p1", "pending"), proposalOf("p2", "pending", { why: "   " })]
      })
    );
    const rows = groups.find((g) => g.id === "pending")!.rows;
    expect(rows[0]!.title).toBe("把节奏调慢一点");
    expect(rows[1]!.title).toBe("改稿提案");
    expect(rows[1]!.hint).toBe("这一条改稿提案还没有写理由。");
  });

  it("理由太长就截断并加省略号（按码点截，中文一个字一个码点）", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    const groups = workItemGroups(
      inputOf({
        proposals: [proposalOf("p-long", "pending", { why: long })]
      })
    );
    const row = groups.find((g) => g.id === "pending")!.rows[0]!;
    expect(row.title.endsWith("…")).toBe(true);
    // 24 个码点 + 省略号；半个汉字都不许出现。
    expect([...row.title].length).toBe(25);
  });

  it("副行是那一章的名字；落点是那一篇文稿", () => {
    const groups = workItemGroups(inputOf({ proposals: [proposalOf("p1", "pending")] }));
    const row = groups.find((g) => g.id === "pending")!.rows[0]!;
    expect(row.detail).toBe("第一章 雾港");
    expect(row.target).toEqual({ kind: "doc", relPath: "chapters/01-雾港.md" });
  });
});

describe("伏笔组 · 只列还欠着的与要人看一眼的", () => {
  it("pending / broken / unknown 进组；paid / dropped 不列（收干净了就不用占着版面）", () => {
    const groups = workItemGroups(
      inputOf({
        foreshadows: [
          foreshadowOf({ relPath: "f1.md", tone: "pending" }),
          foreshadowOf({ relPath: "f2.md", tone: "broken" }),
          foreshadowOf({ relPath: "f3.md", tone: "unknown" }),
          foreshadowOf({ relPath: "f4.md", tone: "paid" }),
          foreshadowOf({ relPath: "f5.md", tone: "dropped" })
        ]
      })
    );
    const group = groups.find((g) => g.id === "foreshadows");
    expect(group).toBeDefined();
    expect(group!.rows.map((r) => r.id)).toEqual([
      "foreshadow:f1.md",
      "foreshadow:f2.md",
      "foreshadow:f3.md"
    ]);
  });

  it("副行是埋设章的名字；没写埋设章就说「没写埋设章」，不拿别的字段顶替", () => {
    const groups = workItemGroups(
      inputOf({
        foreshadows: [
          foreshadowOf({ relPath: "f1.md", plantedIn: "chapters/03-夜航.md" }),
          foreshadowOf({ relPath: "f2.md", plantedIn: "" })
        ],
        docTitleOf: (relPath) => (relPath === "chapters/03-夜航.md" ? "第三章 夜航" : relPath)
      })
    );
    const rows = groups.find((g) => g.id === "foreshadows")!.rows;
    expect(rows[0]!.detail).toBe("第三章 夜航");
    expect(rows[1]!.detail).toBe(FORESHADOW_NO_PLANT_LABEL);
  });

  it("右格是状态名，悬停说明是语气（现成那一份 plantToneLabel）", () => {
    const groups = workItemGroups(
      inputOf({ foreshadows: [foreshadowOf({ relPath: "f1.md", statusLabel: "已埋下" })] })
    );
    const row = groups.find((g) => g.id === "foreshadows")!.rows[0]!;
    expect(row.meta).toBe("已埋下");
    expect(row.hint).toBe("还没回收——写到这里时它该有个交代");
  });

  it("落点带着埋设章：有埋设章就跳那一章，没有就退回伏笔文稿本身", () => {
    const groups = workItemGroups(
      inputOf({
        foreshadows: [
          foreshadowOf({ relPath: "f1.md", plantedIn: "chapters/03-夜航.md" }),
          foreshadowOf({ relPath: "f2.md", plantedIn: "" })
        ]
      })
    );
    const rows = groups.find((g) => g.id === "foreshadows")!.rows;
    expect(rows[0]!.target).toEqual({
      kind: "foreshadow",
      relPath: "f1.md",
      plantedIn: "chapters/03-夜航.md"
    });
    expect(rows[1]!.target).toEqual({ kind: "foreshadow", relPath: "f2.md", plantedIn: "" });
  });
});

describe("空组不出现（§168 用户评「空壳没啥用」）", () => {
  it("一件事都没有时，一个组都不摆", () => {
    expect(workItemGroups(inputOf())).toEqual([]);
  });

  it("只有对话时，就只有「对话」这一组（不摆两个写着「暂无」的组头）", () => {
    const groups = workItemGroups(inputOf({ sessions: [sessionOf({ sessionId: "s1" })] }));
    expect(groups.map((g) => g.id)).toEqual(["sessions"]);
  });

  it("组按表里的顺序摆，不按数据多寡", () => {
    const groups = workItemGroups(
      inputOf({
        foreshadows: [foreshadowOf({ relPath: "f1.md" })],
        proposals: [proposalOf("p1", "pending")],
        sessions: [sessionOf({ sessionId: "s1" })]
      })
    );
    expect(groups.map((g) => g.id)).toEqual(["sessions", "pending", "foreshadows"]);
  });
});

describe("面板上的总数", () => {
  it("数的是行，不是组", () => {
    const groups = workItemGroups(
      inputOf({
        sessions: [sessionOf({ sessionId: "s1" }), sessionOf({ sessionId: "s2" })],
        proposals: [proposalOf("p1", "pending")]
      })
    );
    expect(workItemCount(groups)).toBe(3);
    expect(workItemCount([])).toBe(0);
  });
});

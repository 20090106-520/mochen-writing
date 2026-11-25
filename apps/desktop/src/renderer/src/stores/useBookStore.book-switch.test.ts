import { beforeEach, describe, expect, it } from "vitest";
import type { BookOpenResult } from "@mochen/contracts";
import { api, CH, eventOf, push, setupAgentFixture, store } from "./agent-store-fixture";
import { useAutoSkillStore } from "./useAutoSkillStore";
import { useBookStore } from "./useBookStore";

/**
 * 换书清理与删除作品（2026-11-24）。
 *
 * 钉的是两个真机现象的根：
 * ① 「新书的对话还是第一本的内容」——会话视图按线程键（relPath / unbound）记，
 *    键里没有书；换书不清，新书打开就读到上一本留在内存里的转录。
 * ② 「删掉正在写的那本」——主进程已把书移进回收站，渲染层必须把书状态整体复位，
 *    否则保存、续写、AI 轮次全都会去写一个不存在的书。
 */
setupAgentFixture();

beforeEach(() => {
  api.trashBook.mockClear();
});

/** 第二本书：根、书 id、章节清单都与夹具那本不同（同名章才有「串书」的杀伤力）。 */
const SECOND_BOOK: BookOpenResult = {
  rootPath: "/book-two",
  meta: {
    id: "b2",
    title: "雾中来客",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "chapter-write",
    chapterOrder: [CH]
  },
  docs: [{ relPath: CH, kind: "chapter", title: "开局" }]
};

describe("换书时的会话清理（resetForBookSwitch）", () => {
  it("换书后：上一本的转录、草稿、还字账、提案、多稿、历史清单全部不残留", async () => {
    await useBookStore().openBook("/book");
    const agent = store();
    // 把「上一本用过的痕迹」全塞上：转录、输入框草稿、还字账、提案表、历史清单。
    agent.viewOf(CH);
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("user-message", { text: "旧书的那句" })
    });
    agent.setDraft(CH, "旧书的草稿");
    agent.pendingSend[CH] = "旧书没发出去的字";
    agent.sessions = [
      {
        sessionId: "s-1",
        docRelPath: CH,
        model: "mochen-mock",
        startedAt: "2026-10-01T00:00:00.000Z",
        title: "旧书的会话"
      }
    ];
    const auto = useAutoSkillStore();
    auto.autoPinnedByThread[CH] = ["global:check-style"];
    auto.autoBlockedByThread[CH] = ["global:check-plot"];
    auto.autoOwnedOverride[CH] = true;
    auto.autoPausedByThread[CH] = true;
    auto.picksByThread[CH] = [];

    api.openBook.mockResolvedValueOnce(SECOND_BOOK);
    await useBookStore().openBook("/book-two");

    expect(Object.keys(agent.threads)).toEqual([]);
    expect(agent.composerDrafts).toEqual({});
    expect(agent.pendingSend).toEqual({});
    expect(agent.sessions).toEqual([]);
    expect(Object.keys(agent.skillPathsByThread)).toEqual([]);
    expect(auto.autoPinnedByThread).toEqual({});
    expect(auto.autoBlockedByThread).toEqual({});
    expect(auto.autoOwnedOverride).toEqual({});
    expect(auto.autoPausedByThread).toEqual({});
    expect(auto.picksByThread).toEqual({});
    // 书本体换到位了：不是「清了没换」。
    expect(useBookStore().rootPath).toBe("/book-two");
    expect(useBookStore().meta?.id).toBe("b2");
  });
});

describe("trashBook（删除作品）", () => {
  it("递出去的是书根；删的不是当前书时，当前书原样还在", async () => {
    await useBookStore().openBook("/book");
    const ok = await useBookStore().trashBook("/book-two");
    expect(ok).toBe(true);
    expect(api.trashBook).toHaveBeenCalledWith("/book-two");
    expect(useBookStore().rootPath).toBe("/book");
    expect(useBookStore().meta).not.toBeNull();
    expect(useBookStore().notice).toContain("回收站");
  });

  it("删的就是当前书：书状态整体复位，agent 与自动技能的按线程内存态一并清空", async () => {
    await useBookStore().openBook("/book");
    const agent = store();
    agent.viewOf(CH);
    agent.setDraft(CH, "这本书的草稿");
    useAutoSkillStore().autoPinnedByThread[CH] = ["global:check-style"];

    const ok = await useBookStore().trashBook("/book");

    expect(ok).toBe(true);
    expect(useBookStore().rootPath).toBeNull();
    expect(useBookStore().meta).toBeNull();
    expect(useBookStore().docs).toEqual([]);
    expect(useBookStore().docTabs).toEqual([]);
    expect(useBookStore().activeDocTab).toBeNull();
    expect(Object.keys(agent.threads)).toEqual([]);
    expect(agent.composerDrafts).toEqual({});
    expect(useAutoSkillStore().autoPinnedByThread).toEqual({});
  });

  it("删除失败：摆一句中文，书状态一个不动（删不掉不等于被删了）", async () => {
    await useBookStore().openBook("/book");
    api.trashBook.mockResolvedValueOnce({ ok: false, message: "目录被占用" });
    const ok = await useBookStore().trashBook("/book");
    expect(ok).toBe(false);
    expect(useBookStore().notice).toBe("目录被占用");
    expect(useBookStore().rootPath).toBe("/book");
    expect(useBookStore().meta).not.toBeNull();
  });
});

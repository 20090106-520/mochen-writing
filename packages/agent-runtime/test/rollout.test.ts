import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent, SessionMeta } from "@mochen/contracts";
import {
  SESSIONS_DIR,
  appendAgentEvent,
  createSession,
  eventsToMessages,
  findLatestSession,
  readSession,
  sessionRelPath
} from "../src/rollout.js";

let root = "";
const meta: SessionMeta = {
  type: "session-meta",
  sessionId: "s-1",
  docRelPath: "chapters/01-开局.md",
  stageId: "draft",
  model: "test-model",
  startedAt: "2026-10-01T08:00:00.000Z"
};

const turn = { id: "e1", ts: "2026-10-01T08:00:01.000Z", turnId: "t1" };

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-rollout-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("sessionRelPath", () => {
  it("按 Codex rollout 布局分年月日", () => {
    const rel = sessionRelPath(new Date("2026-10-01T08:00:00.000Z"), "s-1");
    expect(rel).toBe(`${SESSIONS_DIR}/2026/10/01/rollout-20261001-080000-s-1.jsonl`);
  });

  it("sessionId 会被拼进路径，所以只认 [A-Za-z0-9._-]+：越界的一律拒绝而不是改名", () => {
    expect(() => sessionRelPath(new Date("2026-10-01T08:00:00.000Z"), "s.1_2")).not.toThrow();
    for (const bad of ["../../escape", "a/b", "a\\b", "", " ", "s-1.jsonl\u0000"]) {
      expect(() => sessionRelPath(new Date("2026-10-01T08:00:00.000Z"), bad)).toThrow(/sessionId/);
    }
  });

  it("越界 sessionId 建线程时如实失败，会话目录外一个文件都不多", async () => {
    // 书根再嵌一层，八个 ../ 正好爬到 root 这一层：没有门禁时它会真的把会话写到那里。
    const book = await mkdtemp(path.join(root, "book-"));
    await expect(
      createSession(book, { ...meta, sessionId: "../../../../../../../../escape" })
    ).rejects.toThrow(/sessionId/);
    expect(await readdir(root)).not.toContain("escape.jsonl");
    await expect(createSession(book, { ...meta, sessionId: "a/b" })).rejects.toThrow(/sessionId/);
    // 被拒绝的建线程连会话目录都不该建出来
    const sessions = path.join(book, ...SESSIONS_DIR.split("/"));
    expect(await readdir(sessions).catch(() => [])).toEqual([]);
  });
});

describe("落盘与读回", () => {
  it("首行是 session-meta，其余每行一个事件", async () => {
    const rel = await createSession(root, meta);
    await appendAgentEvent(root, rel, { ...turn, type: "user-message", text: "改紧一点" });
    await appendAgentEvent(root, rel, {
      ...turn,
      id: "e2",
      type: "message",
      text: "好",
      interrupted: false
    });
    const back = await readSession(root, rel);
    expect(back.meta.docRelPath).toBe("chapters/01-开局.md");
    expect(back.events.map((e) => e.type)).toEqual(["user-message", "message"]);
    expect(back.droppedLines).toEqual([]);
    const raw = await readFile(path.join(root, ...rel.split("/")), "utf8");
    expect(raw.split("\n").filter((line) => line !== "").length).toBe(3);
  });

  it("中间坏行跳过并计数，首行坏则报中文错误", async () => {
    const rel = await createSession(root, { ...meta, sessionId: "s-2" });
    const file = path.join(root, ...rel.split("/"));
    const head = await readFile(file, "utf8");
    await writeFile(file, `${head}{"type":"user-message"\n` + '{"nope":1}\n', "utf8");
    const back = await readSession(root, rel);
    expect(back.events).toEqual([]);
    expect(back.droppedLines).toEqual([2, 3]);
    await writeFile(file, "这不是 JSON\n", "utf8");
    await expect(readSession(root, rel)).rejects.toThrow(/会话首行/);
  });

  it("同一章找回自己的线程，另一章另起（目标 6）", async () => {
    await createSession(root, { ...meta, sessionId: "s-3" });
    const other = await createSession(root, {
      ...meta,
      sessionId: "s-4",
      docRelPath: "chapters/02-潮汐.md",
      startedAt: "2026-10-01T09:00:00.000Z"
    });
    expect(await findLatestSession(root, "chapters/02-潮汐.md")).toBe(other);
    expect((await findLatestSession(root, "chapters/01-开局.md")) ?? "").toContain("s-3");
    expect(await findLatestSession(root, "chapters/不存在.md")).toBeNull();
  });
});

describe("eventsToMessages", () => {
  it("提案落盘与拒绝说明都以 user 角色回喂，plan/error/interrupted 不进历史", () => {
    const events: AgentEvent[] = [
      { ...turn, type: "user-message", text: "改一下" },
      { ...turn, id: "e2", type: "plan", items: [{ text: "读章", done: true }] },
      { ...turn, id: "e3", type: "reasoning", text: "先读", interrupted: false },
      { ...turn, id: "e4", type: "message", text: "建议如下", interrupted: false },
      {
        ...turn,
        id: "e5",
        type: "tool-call",
        callId: "c1",
        tool: "read_doc",
        args: "{}",
        ok: true,
        resultText: "正文"
      },
      { ...turn, id: "e6", type: "proposal", proposal: proposalFixture() },
      {
        ...turn,
        id: "e7",
        type: "decision",
        proposalId: "p1",
        decision: "deny-with-guidance",
        guidance: "别动第一段",
        auto: false
      },
      {
        ...turn,
        id: "e8",
        type: "decision",
        proposalId: "p2",
        decision: "accept-once",
        guidance: "",
        auto: false
      },
      {
        ...turn,
        id: "e9",
        type: "written",
        proposalId: "p2",
        docRelPath: "chapters/01-开局.md",
        fingerprint: "f",
        backupRelPath: ".mochen/changes/x/1.bak"
      },
      { ...turn, id: "e10", type: "error", message: "网络断了" },
      { ...turn, id: "e11", type: "interrupted", pendingProposals: 1 }
    ];
    const messages = eventsToMessages(events);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "assistant",
      "tool",
      "user",
      "user"
    ]);
    expect(messages[0]?.content).toBe("改一下");
    expect(messages[1]?.content).toBe("（思考摘要）先读");
    expect(messages[2]?.content).toBe("建议如下");
    expect(messages[3]?.toolCalls.map((c) => c.name)).toEqual(["read_doc"]);
    expect(messages[4]?.toolCallId).toBe("c1");
    expect(messages[5]?.content).toContain("别动第一段");
    expect(messages[6]?.content).toContain("原稿备份在");
  });

  it("reasoning 单独存在时作为 assistant 前置内容，不丢", () => {
    const messages = eventsToMessages([
      { ...turn, type: "reasoning", text: "想", interrupted: false },
      { ...turn, id: "e2", type: "message", text: "说", interrupted: false }
    ]);
    expect(messages.map((m) => m.role)).toEqual(["assistant", "assistant"]);
  });

  it("纯空白的 reasoning/message 不进模型历史（否则小模型收到空轮）", () => {
    const messages = eventsToMessages([
      { ...turn, type: "reasoning", text: "   ", interrupted: false },
      { ...turn, id: "e2", type: "message", text: "", interrupted: true },
      { ...turn, id: "e3", type: "message", text: "这句才算", interrupted: false }
    ]);
    expect(messages.map((m) => m.content)).toEqual(["这句才算"]);
  });

  it("新文件写入（backupRelPath 为 null）的括注说明无备份", () => {
    const messages = eventsToMessages([
      {
        ...turn,
        type: "written",
        proposalId: "p1",
        docRelPath: "chapters/03-新章.md",
        fingerprint: "f",
        backupRelPath: null
      }
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("（新文件，无备份）");
  });
});

function proposalFixture() {
  return {
    id: "p1",
    threadKey: "chapters/01-开局.md",
    turnId: "t1",
    docRelPath: "chapters/01-开局.md",
    mode: "anchor-replace" as const,
    anchor: "雾",
    replace: "海雾",
    why: "更具体",
    tool: "propose_patch" as const,
    source: "tool-call" as const,
    expectedFingerprint: "a",
    createdAt: "2026-10-01T08:00:00.000Z"
  };
}

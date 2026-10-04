import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  listSessions,
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

/** #113e 历史对话面板的数据源：一本书里的全部会话，从新到旧。 */
describe("listSessions", () => {
  /** 手写一份会话文件（要控制文件名与坏行，createSession 做不到）；路径仍走 sessionRelPath，不另立布局。 */
  async function writeRawSession(book: string, sessionId: string, body: string[]): Promise<void> {
    const rel = sessionRelPath(new Date("2026-10-04T12:00:00.000Z"), sessionId);
    const abs = path.join(book, ...rel.split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, `${body.join("\n")}\n`, "utf8");
  }
  const metaLine = (sessionId: string, startedAt: string, docRelPath = meta.docRelPath): string =>
    JSON.stringify({ ...meta, sessionId, docRelPath, startedAt });
  /** 给 appendAgentEvent 的对象版：它内部自己 stringify，喂字符串会得到双重编码的假事件行。 */
  const userEvent = (text: string, id = "e1"): AgentEvent => ({
    ...turn,
    id,
    type: "user-message",
    text
  });
  /** 给 writeRawSession 的行版：坏首行那种「不是对象事件」的写法只能从这里来。 */
  const userLine = (text: string, id = "e1"): string =>
    JSON.stringify({ ...turn, id, type: "user-message", text });

  it("列出本书全部会话，按 startedAt 从新到旧，字段取自首行 meta 与首条 user-message", async () => {
    const book = await mkdtemp(path.join(root, "list-"));
    const older = await createSession(book, { ...meta, sessionId: "s-old" });
    await appendAgentEvent(book, older, userEvent("先把开头收紧"));
    const newerRel = await createSession(book, {
      ...meta,
      sessionId: "s-new",
      docRelPath: "chapters/02-潮线.md",
      startedAt: "2026-10-02T09:00:00.000Z"
    });
    // 先落一条 assistant 再落 user-message：标题必须跳过非用户行，取「首条」用户输入而不是最后一条。
    await appendAgentEvent(book, newerRel, {
      ...turn,
      id: "e1",
      type: "message",
      text: "先回一句"
    });
    await appendAgentEvent(book, newerRel, {
      ...turn,
      id: "e2",
      type: "user-message",
      text: "第二段再狠一点"
    });

    const items = await listSessions(book);
    expect(items.map((item) => item.sessionId)).toEqual(["s-new", "s-old"]);
    expect(items[0]).toEqual({
      sessionId: "s-new",
      docRelPath: "chapters/02-潮线.md",
      model: "test-model",
      startedAt: "2026-10-02T09:00:00.000Z",
      title: "第二段再狠一点"
    });
    expect(items[1]?.title).toBe("先把开头收紧");
  });

  it("标题折叠空白、按 60 字截断（面板靠 CSS 省略号，这里不加省略号）", async () => {
    const book = await mkdtemp(path.join(root, "list-wrap-"));
    const short = await createSession(book, { ...meta, sessionId: "s-wrap" });
    await appendAgentEvent(book, short, userEvent("  第一行\n第二行\t尾   "));
    const long = await createSession(book, {
      ...meta,
      sessionId: "s-long",
      startedAt: "2026-10-05T00:00:00.000Z"
    });
    await appendAgentEvent(book, long, userEvent("字".repeat(80)));

    const items = await listSessions(book);
    expect(items.find((item) => item.sessionId === "s-wrap")?.title).toBe("第一行 第二行 尾");
    expect(items.find((item) => item.sessionId === "s-long")?.title).toBe("字".repeat(60));
  });

  it("一条用户输入都没有的会话 title 是空串，不拿章名或模型名冒充标题", async () => {
    const book = await mkdtemp(path.join(root, "list-empty-"));
    await createSession(book, { ...meta, sessionId: "s-no-user" });
    const items = await listSessions(book);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("");
  });

  it("首行坏的会话文件不进列表也不抛，好文件照旧全收（与 findLatestSession 同口径）", async () => {
    const book = await mkdtemp(path.join(root, "list-broken-"));
    const good = await createSession(book, { ...meta, sessionId: "s-ok" });
    await appendAgentEvent(book, good, userEvent("能用"));
    await writeRawSession(book, "s-broken", ["{ not json", userLine("这句读不到")]);
    // 首行是合法 JSON 但过不了 sessionMetaSchema（缺 model）：同样只跳过，不整本抛。
    await writeRawSession(book, "s-ghost", [
      JSON.stringify({ type: "session-meta", sessionId: "s-ghost", docRelPath: "x.md" }),
      userLine("也读不到")
    ]);

    const items = await listSessions(book);
    expect(items.map((item) => item.sessionId)).toEqual(["s-ok"]);
  });

  it("只扫会话目录：书里别的 .jsonl 不算会话", async () => {
    const book = await mkdtemp(path.join(root, "list-scope-"));
    await mkdir(path.join(book, "notes"), { recursive: true });
    await writeFile(
      path.join(book, "notes", "outline.jsonl"),
      `${metaLine("s-outside", "2026-10-06T00:00:00.000Z")}\n`,
      "utf8"
    );
    expect(await listSessions(book)).toEqual([]);
  });

  it("没有会话目录的书返回空数组，不抛", async () => {
    const empty = await mkdtemp(path.join(root, "list-none-"));
    expect(await listSessions(empty)).toEqual([]);
  });

  it("startedAt 相同用相对路径决胜：遍历顺序不受 readdir 保证，不能靠它定「最近」", async () => {
    const book = await mkdtemp(path.join(root, "list-tie-"));
    for (const sessionId of ["s-aaa", "s-zzz"]) {
      await writeRawSession(book, sessionId, [
        metaLine(sessionId, "2026-10-04T12:00:00.000Z"),
        userLine(`${sessionId} 的第一句`)
      ]);
    }
    const items = await listSessions(book);
    expect(items.map((item) => item.sessionId)).toEqual(["s-zzz", "s-aaa"]);
  });
});

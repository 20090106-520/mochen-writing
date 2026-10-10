import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type AgentEvent,
  type AgentOutbound,
  type StartTurnInput
} from "@mochen/contracts";
import {
  appendAgentEvent,
  createSession,
  type ProviderFetch,
  type ProviderFetchInput,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/**
 * P2-6「失败轮留下的孤儿 user」的**接线契约**（判据本体在 `foldOrphanUserMessages`，
 * 已由 packages/agent-runtime/test/history-window.test.ts 逐条钉死；这里只验它在
 * startTurn 那条唯一通路上真的接上了）。
 *
 * 缺陷的形状：`user-message` 在开流之前就落盘。那一轮随后失败，会话里就多一条没有回答的
 * user；用户把同一句再发一遍，端给上游的就是两行一模一样的问题——同一句话付两遍钱，
 * 模型还以为用户催了两次。
 *
 * 另起一份文件而不是塞进 agent-service.test.ts：那份已经贴着 800 行预算
 * （与 agent-service-history-window.test.ts、agent-service-load-session.test.ts 同一处置先例）。
 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-orphan-1";
const QUESTION = "把第三章的开头改短一点";

const STOP: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];

let root = "";
const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return {
    threadKey: docRelPath ?? "unbound",
    docRelPath,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths: []
  };
}

function events(): AgentEvent[] {
  return outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function errorMessages(): string[] {
  return events().flatMap((e) => (e.type === "error" ? [e.message] : []));
}

/** 出站 body 里的 messages（只有角色与文本足够判这一条）。 */
function wireMessages(
  request: ProviderFetchInput | undefined
): { role: string; content: string }[] {
  if (request === undefined) throw new Error("请求必须发出");
  const body = JSON.parse(request.body) as {
    messages: { role: string; content: string }[];
  };
  return body.messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
}

function userAsks(messages: { role: string; content: string }[], text: string): number {
  return messages.filter((m) => m.role === "user" && m.content === text).length;
}

interface Built {
  service: AgentService;
  book: BookService;
  requests: ProviderFetchInput[];
}

async function build(fetchImpl: ProviderFetch): Promise<Built> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-orphan-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-orphan-secret-"));
  tempDirs.push(dir, secrets);
  root = dir;
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await writeFile(path.join(dir, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(
    path.join(dir, "book.json"),
    JSON.stringify(
      {
        id: "b1",
        title: "深渊之下",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      },
      null,
      2
    ),
    "utf8"
  );
  const book = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
  const opened = await book.open(dir);
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });
  const credentials = createCredentialStore(secrets, {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => Buffer.from(text.slice(4), "base64url").toString("utf8")
  });
  const settings = createProviderSettings({ dir: secrets, credentials });
  const seeded = await settings.saveConnection({
    providerId: "custom",
    baseURL: "http://mock/v1",
    authHeader: "bearer",
    thinkingWire: "standard",
    apiKey: null
  });
  const connectionId = seeded.connections[0]?.id ?? "";
  if (connectionId === "") throw new Error("连接没建起来");
  await credentials.save(connectionId, API_KEY);
  await settings.upsertProfile({ model: "test-model", connectionId });
  outbound = [];
  const requests: ProviderFetchInput[] = [];
  const recording: ProviderFetch = async (request) => {
    requests.push(request);
    return fetchImpl(request);
  };
  const service = createAgentService({
    book,
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl: recording,
    emit: (payload) => outbound.push(payload),
    newId: () => `id${requests.length}_${outbound.length}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, book, requests };
}

function stopFetch(): ProviderFetch {
  const enc = new TextEncoder();
  return async () => {
    const stream = (async function* () {
      for (const chunk of STOP) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

/**
 * 往会话里灌上一轮留下的事件。`answered` 为假时只灌 user 那一行——
 * 那正是「开流之前就落盘、随后一轮失败」之后磁盘上剩下的形状。
 */
async function seedRound(rel: string, text: string, answered: boolean): Promise<void> {
  await appendAgentEvent(root, rel, {
    id: "seed-user",
    ts: "2026-10-01T07:00:00.000Z",
    turnId: "t-seed",
    type: "user-message",
    text
  });
  if (answered) {
    await appendAgentEvent(root, rel, {
      id: "seed-answer",
      ts: "2026-10-01T07:00:01.000Z",
      turnId: "t-seed",
      type: "message",
      text: "这一版短了。",
      interrupted: false
    });
  }
}

async function seedSession(built: Built, text: string, answered: boolean): Promise<string> {
  const rel = await createSession(root, {
    type: "session-meta",
    sessionId: "orphan-seed",
    docRelPath: CHAPTER,
    stageId: "draft",
    model: "test-model",
    startedAt: "2026-10-01T06:59:00.000Z"
  });
  await seedRound(rel, text, answered);
  return rel;
}

async function sessionLines(rel: string): Promise<string[]> {
  const text = await readFile(path.join(root, ...rel.split("/")), "utf8");
  return text.split("\n").filter((line) => line.trim() !== "");
}

describe("agent-service · 失败轮的孤儿 user 不发两遍（P2-6）", () => {
  it("上一轮失败留下孤儿、本轮重发同一句 ⇒ 出站历史里那句只出现一次", async () => {
    const built = await build(stopFetch());
    await seedSession(built, QUESTION, false);
    await built.service.startTurn(turn(CHAPTER, QUESTION));
    const asks = userAsks(wireMessages(built.requests[0]), QUESTION);
    // 本轮那一次由 runTurn 追加，历史里那条孤儿必须被折掉 ⇒ 合计恰好 1。
    expect(asks).toBe(1);
    built.service.dispose();
  });

  it("折了就要说出来：outbound 里出现「只发给模型一遍」那条 error", async () => {
    const built = await build(stopFetch());
    await seedSession(built, QUESTION, false);
    await built.service.startTurn(turn(CHAPTER, QUESTION));
    expect(errorMessages().some((m) => m.includes("只发给模型一遍"))).toBe(true);
    built.service.dispose();
  });

  it("反向：上一轮答过了，本轮再问同一句 ⇒ 两条都在（那是真的第二次提问，一条不许吞）", async () => {
    const built = await build(stopFetch());
    await seedSession(built, QUESTION, true);
    await built.service.startTurn(turn(CHAPTER, QUESTION));
    const messages = wireMessages(built.requests[0]);
    expect(userAsks(messages, QUESTION)).toBe(2);
    expect(messages).toContainEqual({ role: "assistant", content: "这一版短了。" });
    expect(errorMessages().some((m) => m.includes("只发给模型一遍"))).toBe(false);
    built.service.dispose();
  });

  it("本轮换一句再问 ⇒ 那句孤儿照常带给模型（它是上下文，不是重复）", async () => {
    const built = await build(stopFetch());
    await seedSession(built, QUESTION, false);
    await built.service.startTurn(turn(CHAPTER, "先看看人物卡"));
    const messages = wireMessages(built.requests[0]);
    expect(userAsks(messages, QUESTION)).toBe(1);
    expect(userAsks(messages, "先看看人物卡")).toBe(1);
    expect(errorMessages().some((m) => m.includes("只发给模型一遍"))).toBe(false);
    built.service.dispose();
  });

  it("磁盘上的那一行一个字都不改：折只发生在发出去之前的内存历史里", async () => {
    const built = await build(stopFetch());
    const rel = await seedSession(built, QUESTION, false);
    const before = await sessionLines(rel);
    expect(before[0]).toContain("session-meta");
    await built.service.startTurn(turn(CHAPTER, QUESTION));
    const after = await sessionLines(rel);
    // 只追加、不重写：seed 那两行原样在第一、二位，本轮的事件接在后面。
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.filter((line) => line.includes('"type":"user-message"')).length).toBe(2);
    built.service.dispose();
  });

  it("连两轮都失败 ⇒ 三行同一句也只发一遍（折的是重复，不是轮数）", async () => {
    const built = await build(stopFetch());
    const rel = await seedSession(built, QUESTION, false);
    await seedRound(rel, QUESTION, false);
    await built.service.startTurn(turn(CHAPTER, QUESTION));
    expect(userAsks(wireMessages(built.requests[0]), QUESTION)).toBe(1);
    built.service.dispose();
  });
});

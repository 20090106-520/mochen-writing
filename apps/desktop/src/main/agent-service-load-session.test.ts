import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  findLatestSession,
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
 * Task 3（F-6 只读回放）的专项夹具。断言与文案与 task-3-brief 逐字一致；
 * 之所以另起一份文件而不是追加进 agent-service.test.ts：那份已经贴着 800 行预算
 * （`node tools/check-source-line-budget.mjs`），与 agent-service-boundary.test.ts 同一处置先例。
 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-load";

let root = "";
const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
}, 30000);

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

/** 脚本用完后的兜底响应：一条不含工具调用的响应，工具循环因此能收尾。 */
const STOP: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];

function sseFetch(...rounds: Record<string, unknown>[][]): ProviderFetch {
  const enc = new TextEncoder();
  let call = 0;
  return async () => {
    const chunks = call < rounds.length ? (rounds[call] ?? STOP) : STOP;
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

/** 一次工具调用要吃掉两个响应位（调用 + 无调用的收尾），脚本用完回 STOP。 */
function toolCallChunks(id: string, doc: string, anchor: string, replace: string, why: string) {
  return [
    { choices: [{ delta: { reasoning_content: "先收紧开头" } }] },
    { choices: [{ delta: { content: "给你一条提案：\n" } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                function: {
                  name: "propose_patch",
                  arguments: JSON.stringify({ doc, anchor, replace, why })
                }
              }
            ]
          }
        }
      ]
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
  ];
}

const proposeChunks = toolCallChunks(
  "c1",
  CHAPTER,
  "雾从海面涌上来。",
  "海雾涌上来，铁锈味很冲。",
  "补可感细节"
);

async function treeOf(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(at: string): Promise<void> {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full).replaceAll("\\", "/"));
    }
  }
  await walk(dir);
  return out.sort();
}

interface Built {
  service: AgentService;
  book: BookService;
  /** 唯一写盘通路的探针：回放是只读的，这条链一次都不该被碰。 */
  writes: string[];
  dir: string;
}

async function build(fetchImpl: ProviderFetch, bookDir?: string): Promise<Built> {
  const dir = bookDir ?? (await mkdtemp(path.join(tmpdir(), "mochen-load-")));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-load-secret-"));
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
  const provider = createProviderSettings({ dir: secrets, credentials });
  // v3：地址与密钥都按连接分份。先把连接建出来拿到 id，密钥再直接写进那一份。
  const seeded = await provider.saveConnection({
    providerId: "custom",
    baseURL: "https://mock/v1",
    authHeader: "bearer",
    thinkingWire: "standard",
    apiKey: null
  });
  const connectionId = seeded.connections[0]?.id ?? "";
  if (connectionId === "") throw new Error("连接没建起来，档案挂不上去");
  await credentials.save(connectionId, API_KEY);
  await provider.upsertProfile({ model: "test-model", connectionId });
  outbound = [];
  let counter = 0;
  const writes: string[] = [];
  const spied: BookService = {
    ...book,
    async writeDoc(relPath, content, expectedFingerprint) {
      writes.push(relPath);
      return book.writeDoc(relPath, content, expectedFingerprint);
    }
  };
  const service = createAgentService({
    book: spied,
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl,
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, book, writes, dir };
}

describe("agentService.loadSession 三态", () => {
  it("读过：跑过一轮的线程能原样读回事件与 meta，droppedLines 为空", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    const loaded = await service.loadSession(CHAPTER);
    if (!loaded.found) throw new Error("应该读到历史");
    expect(loaded.meta.docRelPath).toBe(CHAPTER);
    expect(loaded.droppedLines).toEqual([]);
    expect(loaded.events.map((event) => event.type)).toEqual([
      "user-message",
      "reasoning",
      "message",
      "tool-call",
      "proposal"
    ]);
    service.dispose();
  });

  it("no-book：关了书再读，返回中文 message 而不是抛错", async () => {
    const { service, book } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    await book.close();
    const loaded = await service.loadSession(CHAPTER);
    expect(loaded).toEqual({
      found: false,
      reason: "no-book",
      message: "还没打开作品目录，历史读不回来。"
    });
    service.dispose();
  });

  it("no-session：这本书里没有这条线程，返回中文且不写进任何缓存", async () => {
    const { service } = await build(sseFetch());
    const loaded = await service.loadSession("chapters/99-从没写过.md");
    expect(loaded).toEqual({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    service.dispose();
  });

  it("首行坏：把会话首行改成坏 JSON 后必须抛中文（IPC 层不吞），错误里带 relPath", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("会话没落盘，夹具坏了");
    const absPath = path.join(root, ...rel.split("/"));
    const lines = (await readFile(absPath, "utf8")).split("\n");
    await writeFile(absPath, `{"坏了":\n${lines.slice(1).join("\n")}`, "utf8");
    await expect(service.loadSession(CHAPTER)).rejects.toThrow(/会话首行不可用/);
    service.dispose();
  });

  it("threadKey 归一与主线程一致：空串走 unbound，超长抛中文", async () => {
    const { service } = await build(sseFetch());
    expect(await service.loadSession("   ")).toEqual({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    await expect(service.loadSession("x".repeat(201))).rejects.toThrow(/会话线程标识过长/);
    service.dispose();
  });
});

describe("agentService.loadSession 只读（全局约束：模型永不直接写盘，回放绝不复活待审队列）", () => {
  it("重启后的第二个服务实例读到提案，但那条提案不可批准，且回放一个字节都没写", async () => {
    const first = await build(sseFetch(proposeChunks));
    await first.service.startTurn(turn(CHAPTER, "改紧"));
    first.service.dispose();

    // 模拟「重启应用」：同一本书目录、全新的 service（pending/diffs/threads 全是空的）。
    const requestLog: ProviderFetchInput[] = [];
    const quiet: ProviderFetch = async (request) => {
      requestLog.push(request);
      return { status: 200, stream: null, errorText: "回放不该发请求" };
    };
    const fresh = await build(quiet, first.dir);
    const treeBefore = await treeOf(fresh.dir);
    const chapterBefore = await readFile(path.join(fresh.dir, ...CHAPTER.split("/")), "utf8");

    const loaded = await fresh.service.loadSession(CHAPTER);
    if (!loaded.found) throw new Error("重启后必须能把这一条线程读回来");
    const proposalEvent = loaded.events.find(
      (event): event is Extract<AgentEvent, { type: "proposal" }> => event.type === "proposal"
    );
    const proposalId = proposalEvent?.proposal.id ?? "";
    if (proposalId === "") throw new Error("夹具必须先落一条提案");

    // 只读：没有任何文件被新增/删除，正文与首次落盘时一字不差
    expect(await treeOf(fresh.dir)).toEqual(treeBefore);
    expect(await readFile(path.join(fresh.dir, ...CHAPTER.split("/")), "utf8")).toBe(chapterBefore);
    expect(fresh.writes).toEqual([]);
    expect(requestLog).toEqual([]);

    // 绝不复活可批准的待审队列：重启后主进程的 pending 是空的，这条 id 必须判 not-pending
    const decided = await fresh.service.decide({
      proposalId,
      decision: "accept-once",
      guidance: ""
    });
    expect(decided.ok).toBe(false);
    if (!decided.ok) expect(decided.reason).toBe("not-pending");
    expect(fresh.writes).toEqual([]);
    fresh.service.dispose();
  });

  it("读到的坏行原样进 droppedLines，不伪造事件也不静默", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("会话没落盘，夹具坏了");
    const absPath = path.join(root, ...rel.split("/"));
    const lines = (await readFile(absPath, "utf8")).split("\n");
    await writeFile(
      absPath,
      [lines[0], "{这一行不是合法 JSON", ...lines.slice(1)].join("\n"),
      "utf8"
    );
    const loaded = await service.loadSession(CHAPTER);
    if (!loaded.found) throw new Error("中间坏行不该让整条线程消失");
    expect(loaded.droppedLines).toEqual([2]);
    expect(loaded.events.map((event) => event.type)).toEqual([
      "user-message",
      "reasoning",
      "message",
      "tool-call",
      "proposal"
    ]);
    service.dispose();
  });
});

describe("agentService.listSessions（#113e 历史对话面板的数据源）", () => {
  it("跑过一轮的书列出一行：四个字段来自首行 meta，标题是首条用户输入", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    const items = await service.listSessions();
    expect(items).toHaveLength(1);
    const [only] = items;
    if (!only) throw new Error("夹具没列出会话");
    // sessionId 走 randomUUID（agent-service.ts:199 的理由：它会被拼进文件路径），测试只能钉「非空串」。
    expect(only.sessionId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(only).toMatchObject({
      docRelPath: CHAPTER,
      model: "test-model",
      startedAt: "2026-10-01T08:00:00.000Z",
      title: "改紧一点"
    });
    service.dispose();
  });

  it("没开书返回空数组，不抛（面板那颗钮无书时禁用，通路这边也不许谎报）", async () => {
    const { service, book } = await build(sseFetch());
    await book.close();
    expect(await service.listSessions()).toEqual([]);
    service.dispose();
  });
});

describe("agentService.loadSession 指名 sessionId（面板点开某一条历史）", () => {
  /**
   * 在同一章上手工再建一条**更早**的会话：threadFor 只会复用「最近那条」，
   * 第二条会话在真实使用里由面板指名读回，夹具只能自己写出来。
   */
  async function addEarlierSession(userText: string): Promise<string> {
    const rel = await createSession(root, {
      type: "session-meta",
      sessionId: "s-earlier",
      docRelPath: CHAPTER,
      stageId: "draft",
      model: "test-model",
      startedAt: "2026-09-01T08:00:00.000Z"
    });
    await appendAgentEvent(root, rel, {
      id: "e-old",
      ts: "2026-09-01T08:00:01.000Z",
      turnId: "t-old",
      type: "user-message",
      text: userText
    });
    return rel;
  }
  const read = (rel: string): Promise<string> =>
    readFile(path.join(root, ...rel.split("/")), "utf8");

  it("指名读回较早那条：meta 与事件都是它自己的，不是最近那条", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "这一轮属于最近那条"));
    const earlierRel = await addEarlierSession("较早那一轮说的话");

    const loaded = await service.loadSession(CHAPTER, "s-earlier");
    if (!loaded.found) throw new Error("指名的那条必须读得回来");
    expect(loaded.meta.sessionId).toBe("s-earlier");
    expect(loaded.relPath).toBe(earlierRel);
    expect(loaded.events.map((event) => event.type)).toEqual(["user-message"]);
    // 不串味：带 id 的读法只拿那一条，最近那条的内容一个字都不许混进来。
    expect(loaded.events[0]).toMatchObject({ text: "较早那一轮说的话" });
    service.dispose();
  });

  it("选中较早那条之后发轮 ⇒ 新事件追加到那一份，最近那份一字不动（选中即改写入目标）", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "第一轮"));
    const earlierRel = await addEarlierSession("较早那一轮");
    const latestRel = await findLatestSession(root, CHAPTER);
    if (latestRel === null || latestRel === earlierRel) throw new Error("夹具必须有两份不同的会话");
    const latestBefore = await read(latestRel);

    await service.loadSession(CHAPTER, "s-earlier");
    await service.startTurn(turn(CHAPTER, "接着较早那条聊"));

    const earlierAfter = await read(earlierRel);
    expect(earlierAfter).toContain("接着较早那条聊");
    // 反向钉：若 threadFor 仍复用「最近那条」，这句话就会被拼进 latestRel——两份内容互相污染。
    expect(await read(latestRel)).toBe(latestBefore);
    service.dispose();
  });

  it("指一个盘上没有的 id：found:false / no-session，且不把线程缓存带偏", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "第一轮"));
    const latestRel = await findLatestSession(root, CHAPTER);
    if (latestRel === null) throw new Error("会话没落盘，夹具坏了");
    const latestBefore = await read(latestRel);

    expect(await service.loadSession(CHAPTER, "s-ghost")).toEqual({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    // 缓存没被那次失败改动：这一轮仍然追加到最近那份。
    await service.startTurn(turn(CHAPTER, "又一轮"));
    const latestAfter = await read(latestRel);
    expect(latestAfter).toContain("又一轮");
    expect(latestAfter.length).toBeGreaterThan(latestBefore.length);
    service.dispose();
  });
});

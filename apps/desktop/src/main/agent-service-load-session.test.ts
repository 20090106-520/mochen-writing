import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  type AgentEvent,
  type AgentOutbound,
  type StartTurnInput
} from "@mochen/contracts";
import {
  findLatestSession,
  type ProviderFetch,
  type ProviderFetchInput,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, defaultPromptFor, type AgentService } from "./agent-service.js";

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
});

function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", userText };
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
  const book = createBookService();
  const opened = await book.open(dir);
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });
  const credentials = createCredentialStore(secrets, {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => Buffer.from(text.slice(4), "base64url").toString("utf8")
  });
  await credentials.save(API_KEY);
  await createProviderSettings({ dir: secrets, credentials }).save({
    baseURL: "http://mock/v1",
    model: "test-model",
    apiKey: null
  });
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

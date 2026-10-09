import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  AGENT_TOOL_NAMES,
  DEFAULT_PERMISSION_MODE,
  WEB_SEARCH_TOOL_NAME,
  type AgentEvent,
  type AgentOutbound,
  type BookMeta,
  type StartTurnInput
} from "@mochen/contracts";
import {
  findLatestSession,
  readSession,
  type ProviderFetch,
  type ProviderFetchInput,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { makeFingerprint } from "@mochen/fs-store";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

const CHAPTER = "chapters/01-开局.md";
const OTHER = "chapters/02-闸口.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-9f3a2b7c";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** 脚本用完后的兜底响应：一条不含工具调用的响应，工具循环因此能收尾。 */
const STOP: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];

let root = "";
const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function turn(
  docRelPath: string | null,
  userText: string,
  webSearchEnabled = false
): StartTurnInput {
  return {
    threadKey: docRelPath ?? "unbound",
    docRelPath,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled,
    skillPaths: []
  };
}

async function chapterFile(rel = CHAPTER): Promise<string> {
  return readFile(path.join(root, ...rel.split("/")), "utf8");
}

async function absolute(rel: string): Promise<string> {
  return path.join(root, ...rel.split("/"));
}

/**
 * 每一个数组元素是**一次请求**的响应，按请求顺序消费；脚本用完回 STOP。
 * 简报原文写的是 `rounds[Math.min(call, rounds.length - 1)]`，那会把最后一段无限重复：
 * runTurn 在工具调用后必然再发一次请求，于是「一轮对话」能吐出两条提案，简报自己的
 * 事件顺序断言必然红。改用 STOP 兜底，脚本用完就安静收尾。
 * 多轮用例要显式插一条 STOP：一次工具调用要吃掉两个响应位（调用 + 无调用的收尾）。
 */
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

/** 同上，但把每一次发出去的请求原样记下来——密钥与工单形状的验收靠它。 */
function recordingFetch(...rounds: Record<string, unknown>[][]): {
  fetchImpl: ProviderFetch;
  requests: ProviderFetchInput[];
} {
  const enc = new TextEncoder();
  const requests: ProviderFetchInput[] = [];
  let call = 0;
  const fetchImpl: ProviderFetch = async (request) => {
    requests.push(request);
    const chunks = call < rounds.length ? (rounds[call] ?? STOP) : STOP;
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
  return { fetchImpl, requests };
}

/** 第一条增量之后就挂住，直到 signal 被 abort：Esc 打断的可控夹具。 */
function hangingFetch(): ProviderFetch {
  const enc = new TextEncoder();
  return async (request) => {
    const half = { choices: [{ delta: { content: "写了一半" } }] };
    const rest = { choices: [{ delta: { content: "打断后不该出现" } }] };
    const done = { choices: [{ delta: {}, finish_reason: "stop" }] };
    const stream = (async function* () {
      yield enc.encode(`data: ${JSON.stringify(half)}\n\n`);
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) {
          resolve();
          return;
        }
        request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      yield enc.encode(`data: ${JSON.stringify(rest)}\n\n`);
      yield enc.encode(`data: ${JSON.stringify(done)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

function failFetch(status: number, errorText: string): ProviderFetch {
  return async () => ({ status, stream: null, errorText }) satisfies ProviderFetchResult;
}

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

function writeDocChunks(id: string, doc: string, content: string, why: string) {
  return [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                function: { name: "write_doc", arguments: JSON.stringify({ doc, content, why }) }
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
const proposeAgain = toolCallChunks("c2", CHAPTER, "第三段", "第三段，闸门在响。", "接声音");

type DecisionEvent = Extract<AgentEvent, { type: "decision" }>;
type WrittenEvent = Extract<AgentEvent, { type: "written" }>;
type ProposalEvent = Extract<AgentEvent, { type: "proposal" }>;
type TurnEnd = Extract<AgentOutbound, { type: "turn-end" }>;

function events(): AgentEvent[] {
  return outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function proposalEvents(): ProposalEvent[] {
  return events().flatMap((event) => (event.type === "proposal" ? [event] : []));
}

function proposalIds(): string[] {
  return proposalEvents().map((event) => event.proposal.id);
}

function decisions(): DecisionEvent[] {
  return events().flatMap((event) => (event.type === "decision" ? [event] : []));
}

function writtenEvents(): WrittenEvent[] {
  return events().flatMap((event) => (event.type === "written" ? [event] : []));
}

function errorMessages(): string[] {
  return events().flatMap((event) => (event.type === "error" ? [event.message] : []));
}

function lastTurnEnd(): TurnEnd | undefined {
  return outbound
    .slice()
    .reverse()
    .find((item): item is TurnEnd => item.type === "turn-end");
}

function firstTurnId(): string {
  const start = outbound.find((item) => item.type === "turn-start");
  if (start === undefined || start.type !== "turn-start")
    throw new Error("turn-start 必须先发出来");
  return start.turnId;
}

async function waitUntil(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

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
  /** 唯一写盘通路的探针：记的是「审批有没有真的走到 book.writeDoc 这一步」。 */
  writes: string[];
}

async function build(
  fetchImpl: ProviderFetch,
  meta: Partial<BookMeta> = {},
  withProvider = true,
  bookDir?: string
): Promise<Built> {
  const dir = bookDir ?? (await mkdtemp(path.join(tmpdir(), "mochen-agent-")));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-agent-secret-"));
  tempDirs.push(dir, secrets);
  root = dir;
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await writeFile(path.join(dir, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(path.join(dir, OTHER), "闸门在响。\n", "utf8");
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
  // 默认落到「全开」：只读档下 host 连提案都不会生成，验不到审批→写盘这条链
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access", ...meta });
  const credentials = createCredentialStore(secrets, {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => Buffer.from(text.slice(4), "base64url").toString("utf8")
  });
  if (withProvider) {
    const settings = createProviderSettings({ dir: secrets, credentials });
    // v3：地址与密钥都按连接分份。先把连接建出来拿到 id，密钥再直接写进那一份。
    const seeded = await settings.saveConnection({
      providerId: "custom",
      baseURL: "http://mock/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      apiKey: null
    });
    const connectionId = seeded.connections[0]?.id ?? "";
    if (connectionId === "") throw new Error("连接没建起来，档案挂不上去");
    await credentials.save(connectionId, API_KEY);
    await settings.upsertProfile({ model: "test-model", connectionId });
  }
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
  return { service, book, writes };
}

describe("agentService 全链", () => {
  it("reasoning→message→tool-call→proposal 顺序落事件，且未批准时文件字节一字不变", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    expect(events().map((event) => event.type)).toEqual([
      "user-message",
      "reasoning",
      "message",
      "tool-call",
      "proposal"
    ]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    expect(service.diffOf(proposalIds()[0] ?? "")).toContain("+海雾涌上来");
    expect(lastTurnEnd()?.status).toBe("done");
    service.dispose();
  });

  it("批准后写盘：原稿进 .mochen/changes 备份，新文本上盘，事件补 decision+written", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const result = await service.decide({
      proposalId: proposalIds()[0] ?? "",
      decision: "accept-once",
      guidance: ""
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("全开档下的合法提案不该失败");
    expect(result.docRelPath).toBe(CHAPTER);
    expect(await chapterFile()).toBe("第一段\n海雾涌上来，铁锈味很冲。\n第三段\n");
    expect(result.fingerprint).toBe(makeFingerprint(await chapterFile()));
    if (result.backupRelPath === null) throw new Error("改旧稿必须先备份");
    expect(await readFile(path.join(root, ...result.backupRelPath.split("/")), "utf8")).toBe(
      CHAPTER_TEXT
    );
    expect(
      events()
        .slice(-2)
        .map((event) => event.type)
    ).toEqual(["decision", "written"]);
    expect(writtenEvents()[0]?.backupRelPath).toMatch(
      /^\.mochen\/changes\/[^/]+\/chapters\/01-开局\.md\.bak$/
    );
    // 探针本身也要钉住：只有批准且指纹相符时才碰唯一写盘通路，而且只碰一次
    expect(writes).toEqual([CHAPTER]);
    service.dispose();
  });

  it("批准那一刻权限收紧 → permission-denied，提案留在 pending，档位放开后能重试", async () => {
    const { service, book } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    const before = book.current();
    if (before === null) throw new Error("current() 必须返回已打开的作品");
    await book.saveMeta({ ...before.meta, permissionMode: "read-only" });
    const denied = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("permission-denied");
    expect(errorMessages().some((message) => message.includes("只读参考"))).toBe(true);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    const after = book.current();
    if (after === null) throw new Error("current() 必须返回已打开的作品");
    await book.saveMeta({ ...after.meta, permissionMode: "full-access" });
    const retried = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(retried.ok).toBe(true);
    expect(await chapterFile()).toContain("海雾涌上来");
    service.dispose();
  });

  it("提案生成后文件被外部改动 → 批准判 stale，绝不覆盖（反向用例）", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    await writeFile(await absolute(CHAPTER), "我自己在编辑器里写的\n", "utf8");
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    // 缺陷③发送侧：这条 error 必须带 proposalId，否则重启回放把已失效卡念成 expired
    expect(events().some((item) => item.type === "error" && item.proposalId === id)).toBe(true);
    expect(await chapterFile()).toBe("我自己在编辑器里写的\n");
    const again = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not-pending");
    service.dispose();
  });

  it("外部只追加一段（锚点仍唯一命中）时指纹照样不符：判 stale，绝不写盘", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    await writeFile(await absolute(CHAPTER), `${CHAPTER_TEXT}用户新写的一段\n`, "utf8");
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    expect(await chapterFile()).toBe(`${CHAPTER_TEXT}用户新写的一段\n`);
    expect(writtenEvents()).toHaveLength(0);
    expect(writes).toEqual([]);
    service.dispose();
  });

  it("审批时读到非 ENOENT 的 IO 错误（EISDIR）→ 判 io、绝不写盘，提案留在 pending", async () => {
    const doc = "chapters/占用中";
    const { service, writes } = await build(
      sseFetch(writeDocChunks("w1", doc, "覆盖目录", "整篇重写"))
    );
    await mkdir(path.join(root, ...doc.split("/")), { recursive: true });
    await service.startTurn(turn(doc, "重写"));
    const id = proposalIds()[0] ?? "";
    if (id === "") throw new Error("write_doc 对读不到的路径也要出提案，否则验不到审批时的读失败");
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("读失败绝不能当成「文件不存在」写下去");
    expect(result.reason).toBe("io");
    expect(writtenEvents()).toHaveLength(0);
    expect(errorMessages().join("\n")).toContain(doc);
    // 拒绝发生在「读」这一步：写盘通路一次都没被碰过
    expect(writes).toEqual([]);
    expect((await stat(path.join(root, ...doc.split("/")))).isDirectory()).toBe(true);
    const retried = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(retried.ok).toBe(false);
    if (!retried.ok) expect(retried.reason).toBe("io");
    expect(writes).toEqual([]);
    service.dispose();
  });

  it("越界与绝对路径的 doc 既不读书外文件，也不在其附近落任何盘", async () => {
    const stage = await mkdtemp(path.join(tmpdir(), "mochen-stage-"));
    tempDirs.push(stage);
    const outside = path.join(stage, "outside");
    await mkdir(path.join(outside, "chapters"), { recursive: true });
    const outsideDoc = path.join(outside, "chapters", "01-开局.md");
    const OUTSIDE_TEXT = "书外的正文，智能体一个字都不该读走。\n";
    await writeFile(outsideDoc, OUTSIDE_TEXT, "utf8");
    const beforeTree = await treeOf(outside);

    const { service } = await build(
      sseFetch(
        writeDocChunks("w1", outsideDoc, "覆盖书外文件", "绝对路径"),
        writeDocChunks("w2", "../outside/chapters/01-开局.md", "覆盖越界文件", "越界路径")
      ),
      {},
      true,
      path.join(stage, "book")
    );
    await service.startTurn(turn(CHAPTER, "写到书外去"));

    expect(proposalIds()).toHaveLength(0);
    expect(writtenEvents()).toHaveLength(0);
    expect(await readFile(outsideDoc, "utf8")).toBe(OUTSIDE_TEXT);
    expect(await treeOf(outside)).toEqual(beforeTree);
    expect((await stat(outsideDoc)).mtimeMs).toBeGreaterThan(0);
    expect(JSON.stringify(outbound)).not.toContain("书外的正文");
    service.dispose();
  });

  it("「本会话不再问」之后同线程的新提案自动落盘并标 auto", async () => {
    const { service } = await build(sseFetch(proposeChunks, STOP, proposeAgain));
    await service.startTurn(turn(CHAPTER, "第一条"));
    const first = await service.decide({
      proposalId: proposalIds()[0] ?? "",
      decision: "accept-session",
      guidance: ""
    });
    expect(first.ok).toBe(true);
    expect(await chapterFile()).toContain("海雾涌上来");
    await service.startTurn(turn(CHAPTER, "第二条"));
    expect(proposalIds()).toHaveLength(2);
    expect(writtenEvents()).toHaveLength(2);
    expect(decisions()[0]?.auto).toBe(false);
    expect(decisions().at(-1)?.auto).toBe(true);
    expect(await chapterFile()).toContain("第三段，闸门在响。");
    service.dispose();
  });

  it("被权限档拒掉的 accept-session 不会开启自动批准", async () => {
    const { service, book } = await build(sseFetch(proposeChunks, STOP, proposeAgain), {
      permissionMode: "read-only"
    });
    await service.startTurn(turn(CHAPTER, "第一条"));
    const denied = await service.decide({
      proposalId: proposalIds()[0] ?? "",
      decision: "accept-session",
      guidance: ""
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error("只读档下的批准不该落盘");
    const current = book.current();
    if (current === null) throw new Error("current() 必须返回已打开的作品");
    await book.saveMeta({ ...current.meta, permissionMode: "full-access" });
    await service.startTurn(turn(CHAPTER, "第二条"));
    expect(proposalIds()).toHaveLength(2);
    expect(writtenEvents()).toHaveLength(0);
    expect(decisions()).toHaveLength(0);
    service.dispose();
  });

  it("拒绝并说明：说明进事件、文件不动、这条提案不再可批", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn(CHAPTER, "改紧"));
    const id = proposalIds()[0] ?? "";
    const result = await service.decide({
      proposalId: id,
      decision: "deny-with-guidance",
      guidance: "别动第二段，改第三段"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("denied");
    expect(decisions()[0]?.guidance).toBe("别动第二段，改第三段");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    const again = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not-pending");
    service.dispose();
  });

  it("Esc 取消提案：落 decision(cancel)，文件不动，未知 turnId 的打断返回 false", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    const { turnId } = await service.startTurn(turn(CHAPTER, "改紧"));
    expect(await service.interrupt(turnId)).toBe(false);
    expect(await service.interrupt("ghost")).toBe(false);
    const id = proposalIds()[0] ?? "";
    const cancelled = await service.decide({ proposalId: id, decision: "cancel", guidance: "" });
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.reason).toBe("cancelled");
    expect(decisions()[0]?.decision).toBe("cancel");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("流中进行中的 turnId 打断返回 true，半截文本入库并停住后续字节", async () => {
    const { service } = await build(hangingFetch());
    const running = service.startTurn(turn(CHAPTER, "写下去"));
    await waitUntil(() => outbound.some((item) => item.type === "delta"), "夹具必须先流出一段增量");
    expect(await service.interrupt(firstTurnId())).toBe(true);
    await running;
    expect(lastTurnEnd()?.status).toBe("interrupted");
    expect(events().map((event) => event.type)).toEqual(["user-message", "message", "interrupted"]);
    expect(
      events().some((event) => event.type === "message" && event.text.includes("打断后"))
    ).toBe(false);
    service.dispose();
  });

  it("provider 失败时中文原因进对话流，turn 落 failed（§9）", async () => {
    const { service } = await build(failFetch(503, "上游配额用尽"));
    await service.startTurn(turn(CHAPTER, "改紧"));
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(errorMessages().some((message) => message.includes("503"))).toBe(true);
    service.dispose();
  });

  it("还没配置模型服务时拒绝开轮，原因显示而不是静默", async () => {
    const { service } = await build(sseFetch(proposeChunks), {}, false);
    await service.startTurn(turn(CHAPTER, "改紧"));
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(errorMessages().some((message) => message.includes("模型"))).toBe(true);
    expect(outbound.some((item) => item.type === "turn-start")).toBe(true);
    service.dispose();
  });

  it("会话按章分线程落盘，同线程读回上一轮，异章另开一线（目标 6）", async () => {
    const { service } = await build(sseFetch(proposeChunks, STOP, proposeAgain));
    await service.startTurn(turn(CHAPTER, "第一次"));
    await service.startTurn(turn(CHAPTER, "第二次"));
    await service.startTurn(turn(OTHER, "换一章"));
    const chapterRel = await findLatestSession(root, CHAPTER);
    const otherRel = await findLatestSession(root, OTHER);
    if (chapterRel === null || otherRel === null) throw new Error("两个线程都要落盘");
    expect(chapterRel).not.toBe(otherRel);
    expect(chapterRel).toMatch(
      new RegExp(`^\\.mochen/sessions/2026/10/01/rollout-20261001-080000-${UUID}\\.jsonl$`)
    );
    const back = await readSession(root, chapterRel);
    expect(back.meta.docRelPath).toBe(CHAPTER);
    // 空 turnId 的提案事件过不了 agentEventSchema，会被计进 droppedLines——这条断言钉住「落盘即可读回」
    expect(back.droppedLines).toEqual([]);
    expect(
      back.events.flatMap((event) => (event.type === "user-message" ? [event.text] : []))
    ).toEqual(["第一次", "第二次"]);
    service.dispose();
  });

  it("提案事件在落盘与转发前被同一处覆写真实 turnId，id 一字不改", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    const { turnId } = await service.startTurn(turn(CHAPTER, "改紧"));
    const forwarded = proposalEvents()[0]?.proposal;
    if (forwarded === undefined) throw new Error("提案事件必须转发给渲染层");
    expect(forwarded.turnId).toBe(turnId);

    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("会话要落盘，否则历史读不回来");
    const stored = await readSession(root, rel);
    const persisted = stored.events.flatMap((event) =>
      event.type === "proposal" ? [event.proposal] : []
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.turnId).toBe(turnId);
    expect(persisted[0]?.id).toBe(forwarded.id);

    const approved = await service.decide({
      proposalId: forwarded.id,
      decision: "accept-once",
      guidance: ""
    });
    expect(approved.ok).toBe(true);
    service.dispose();
  });

  it("会话首行损坏时开轮如实失败，不把「读不到历史」当成「没有历史」", async () => {
    const { service } = await build(sseFetch(proposeChunks, STOP));
    await service.startTurn(turn(CHAPTER, "第一次"));
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("第一次开轮就该把会话落盘");
    await writeFile(path.join(root, ...rel.split("/")), "这不是 JSON\n", "utf8");
    await service.startTurn(turn(CHAPTER, "第二次"));
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(errorMessages().join("\n")).toContain("会话");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("密钥只进 Authorization 头：URL、请求体、外发载荷与会话文件里都没有它", async () => {
    const { fetchImpl, requests } = recordingFetch(proposeChunks);
    const { service } = await build(fetchImpl);
    await service.startTurn(turn(CHAPTER, "改紧"));
    const request = requests[0];
    if (request === undefined) throw new Error("请求必须发出");
    expect(request.url).toBe("http://mock/v1/chat/completions");
    expect(request.url).not.toContain(API_KEY);
    expect(request.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(request.body).not.toContain(API_KEY);
    expect(JSON.stringify(outbound)).not.toContain(API_KEY);
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("会话要落盘");
    expect(await readFile(path.join(root, ...rel.split("/")), "utf8")).not.toContain(API_KEY);
    service.dispose();
  });

  it("递给模型的工单恰好是花名册在这一轮真带出去的那几枚，一个不多一个不少", async () => {
    const { fetchImpl, requests } = recordingFetch(proposeChunks);
    const { service } = await build(fetchImpl);
    // 夹具的联网开关是关的（turn 默认值）：2026-10-08 起开关决定 web_search 有没有出站，
    // 所以这里的花名册要按开关裁掉那一枚。「开 ⇒ 六枚全在」由 agent-service-boundary.test.ts
    // 的 #101 用例从同一条链路上钉，两处合起来才是全集。
    await service.startTurn(turn(CHAPTER, "改紧"));
    const request = requests[0];
    if (request === undefined) throw new Error("请求必须发出");
    const body = JSON.parse(request.body) as { tools?: { function?: { name?: string } }[] };
    expect(body.tools?.map((tool) => tool.function?.name)).toEqual([
      ...AGENT_TOOL_NAMES.filter((name) => name !== WEB_SEARCH_TOOL_NAME)
    ]);
    service.dispose();
  });

  it("上一轮的工具回执经历史重建回喂模型", async () => {
    const { fetchImpl, requests } = recordingFetch(proposeChunks, STOP, proposeAgain);
    const { service } = await build(fetchImpl);
    await service.startTurn(turn(CHAPTER, "第一条"));
    await service.startTurn(turn(CHAPTER, "第二条"));
    const second = requests[2];
    if (second === undefined) throw new Error("第二轮必须再发一次请求");
    const body = JSON.parse(second.body) as {
      messages?: { role: string; content?: string; tool_calls?: unknown }[];
    };
    const withCalls = (body.messages ?? []).filter((message) => message.tool_calls !== undefined);
    expect(withCalls).toHaveLength(1);
    const receipts = (body.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) => message.content ?? "");
    expect(receipts.join("\n")).toContain("等待用户审批");
    service.dispose();
  });

  it("空 userText 走优雅路径而非拒绝：中文错误事件 + turn-end failed，一个字节都没落盘", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks));
    await expect(service.startTurn(turn(CHAPTER, ""))).resolves.toBeDefined();
    expect(errorMessages().join("\n")).toContain("输入是空的");
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(writes).toEqual([]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("纯空白 userText 走同一条优雅路径：:387 的 trim 分支不是死代码", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks));
    await expect(service.startTurn(turn(CHAPTER, "   "))).resolves.toBeDefined();
    expect(errorMessages().join("\n")).toContain("输入是空的");
    expect(lastTurnEnd()?.status).toBe("failed");
    expect(writes).toEqual([]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("超长 userText 在开轮前就被边界校验挡下：中文报错，一个字节都没落盘", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks));
    await expect(service.startTurn(turn(CHAPTER, "写".repeat(20001)))).rejects.toThrow(
      /输入内容过长/
    );
    expect(writes).toEqual([]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("空 threadKey 不 reject：作为合法的 unbound 线程落点", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await expect(service.startTurn({ ...turn(null, ""), threadKey: "" })).resolves.toBeDefined();
    const start = outbound.find((item) => item.type === "turn-start");
    if (start === undefined || start.type !== "turn-start")
      throw new Error("turn-start 必须先发出来");
    expect(start.threadKey).toBe("unbound");
    service.dispose();
  });

  it("超长 threadKey 被边界校验挡下：中文报错", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await expect(
      service.startTurn({ ...turn(CHAPTER, "写点什么"), threadKey: "x".repeat(201) })
    ).rejects.toThrow(/会话线程标识过长/);
    service.dispose();
  });

  it("空 stageId 仍是硬校验：装配处没有对应的优雅分支", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await expect(
      service.startTurn({
        threadKey: CHAPTER,
        docRelPath: CHAPTER,
        stageId: "",
        userText: "写点什么",
        thinkingLevel: "off",
        webSearchEnabled: false,
        skillPaths: []
      })
    ).rejects.toThrow(/创作阶段标识不能为空/);
    service.dispose();
  });
});

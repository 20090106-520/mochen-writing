import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type AgentOutbound,
  type BookMeta,
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
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/**
 * 每轮多稿采样（P0-②）的主进程行为。
 *
 * 钉的是 spec §5 那几条能机器判的不变量：开关关着时一字不变、采样期盘上零写入、
 * 静默稿的提案不进 pending 也不被自动批准、同一集只落一次、换书即作废、丢弃零写入。
 * 「零写入」一律**看盘**（读那条 JSONL 的行数）而不是数 spy——盘上的字节是最终事实。
 */

const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-9f3a2b7c";

const STOP: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];

let root = "";
const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
}, 30000);

function turn(userText: string, sampleCount: 1 | 2 | 3 = 1): StartTurnInput {
  return {
    threadKey: CHAPTER,
    docRelPath: CHAPTER,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths: [],
    sampleCount
  };
}

/** 每个元素是**一次请求**的响应，按请求顺序消费；用完回 STOP（同既有那套夹具）。 */
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

function toolCallChunks(id: string, anchor: string, replace: string) {
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
                  arguments: JSON.stringify({ doc: CHAPTER, anchor, replace, why: "补可感细节" })
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

const proposeChunks = toolCallChunks("c1", "雾从海面涌上来。", "海雾涌上来，铁锈味很冲。");

interface Built {
  service: AgentService;
  book: BookService;
  /** 唯一写盘通路的探针：记的是「审批有没有真的走到 book.writeDoc 这一步」。 */
  writes: string[];
  requests: ProviderFetchInput[];
}

async function build(
  fetchImpl: ProviderFetch,
  meta: Partial<BookMeta> = {},
  bookDir?: string
): Promise<Built> {
  const dir = bookDir ?? (await mkdtemp(path.join(tmpdir(), "mochen-multi-")));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-multi-secret-"));
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
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access", ...meta });
  const credentials = createCredentialStore(secrets, {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => Buffer.from(text.slice(4), "base64url").toString("utf8")
  });
  const settings = createProviderSettings({ dir: secrets, credentials });
  const seeded = await settings.saveConnection({
    providerId: "custom",
    baseURL: "https://mock/v1",
    authHeader: "bearer",
    thinkingWire: "standard",
    apiKey: null
  });
  const connectionId = seeded.connections[0]?.id ?? "";
  await credentials.save(connectionId, API_KEY);
  await settings.upsertProfile({ model: "test-model", connectionId });

  outbound = [];
  let counter = 0;
  const writes: string[] = [];
  const requests: ProviderFetchInput[] = [];
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
    fetchImpl: async (request) => {
      requests.push(request);
      return fetchImpl(request);
    },
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, book, writes, requests };
}

/** 这条线程那条 JSONL 现在有几行（采样期「零写入」的判据就在这里看盘）。 */
async function sessionLines(): Promise<string[]> {
  const rel = await findLatestSession(root, CHAPTER);
  if (rel === null) return [];
  const text = await readFile(path.join(root, ...rel.split("/")), "utf8");
  return text.split("\n").filter((line) => line.trim() !== "");
}

function candidatesPayload() {
  const found = outbound.find((item) => item.type === "candidates");
  if (found === undefined || found.type !== "candidates")
    throw new Error("这一轮必须发出一条 candidates");
  return found;
}

function lastTurnEnd() {
  return outbound
    .slice()
    .reverse()
    .find((item) => item.type === "turn-end");
}

describe("多稿采样：开关关着时一字不变", () => {
  it("sampleCount 为 1 时出站序列里没有 candidates，落盘照旧发生", async () => {
    const { service } = await build(sseFetch(proposeChunks));
    await service.startTurn(turn("改紧一点", 1));
    // 单稿那条路的出站类型逐拍钉死：重构（把 runOnce 抽出来）不许改动它。
    expect(outbound.map((item) => item.type)).toEqual([
      "turn-start",
      "event",
      "delta",
      "delta",
      "event",
      "event",
      "event",
      "event",
      "turn-end"
    ]);
    expect(outbound.some((item) => item.type === "candidates")).toBe(false);
    // 落盘照旧：一条 session-meta + 这一轮的五个事件（user-message/reasoning/message/tool-call/proposal）。
    expect(await sessionLines()).toHaveLength(6);
    expect(lastTurnEnd()?.status).toBe("done");
  });
});

describe("多稿采样：静默跑 N 稿", () => {
  it("两稿采样期零 publish、盘上零写入，收尾只摆出一条 candidates", async () => {
    const { service } = await build(sseFetch(proposeChunks, STOP, proposeChunks, STOP));
    await service.startTurn(turn("改紧一点", 2));
    const kinds = outbound.map((item) => item.type);
    // 采样期除了本轮 turn-start / turn-end，一条都不许出去；增量一条都不许出去。
    expect(kinds).toEqual(["turn-start", "candidates", "turn-end"]);
    const payload = candidatesPayload();
    expect(payload.drafts).toHaveLength(2);
    expect(payload.drafts[0]?.reading.index).toBe(payload.drafts[0]?.index);
    expect(payload.draftSetId).not.toBe("");
    // 盘上「零写入」看盘：这一轮只建了会话文件那一行 session-meta，事件一条没落。
    expect(await sessionLines()).toHaveLength(1);
    expect(lastTurnEnd()?.status).toBe("done");
  });

  it("采样期的提案不进 pending、不被自动批准（哪怕这本书早先点过 accept-session）", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks, STOP, proposeChunks, STOP));
    // 先跑一轮单稿，把 accept-session 记到这本书上（自动批准判据真身在 registerProposal）。
    await service.startTurn(turn("先来一轮", 1));
    const firstProposal = outbound
      .flatMap((item) => (item.type === "event" ? [item.event] : []))
      .find((event) => event.type === "proposal");
    if (firstProposal === undefined || firstProposal.type !== "proposal")
      throw new Error("第一轮必须出一条提案");
    await service.decide({
      proposalId: firstProposal.proposal.id,
      decision: "accept-session",
      guidance: ""
    });
    expect(writes).toEqual([CHAPTER]);

    outbound = [];
    await service.startTurn(turn("再来一轮两稿", 2));
    // 静默稿的提案：没有发卡、没有写盘、没有 decision/written（零调用 writeDoc 就是判据）。
    expect(outbound.some((item) => item.type === "candidates")).toBe(true);
    const published = outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
    expect(published.filter((event) => event.type === "proposal")).toHaveLength(0);
    expect(published.filter((event) => event.type === "written")).toHaveLength(0);
    expect(writes).toEqual([CHAPTER]);
  });
});

describe("多稿采样：选一稿落盘 / 丢弃整集", () => {
  it("选定某一稿才落盘：发卡、盘上多一份；同一集第二次回 gone", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks, STOP, proposeChunks, STOP));
    await service.startTurn(turn("改紧一点", 2));
    const setId = candidatesPayload().draftSetId;
    const sampleTurnId = candidatesPayload().turnId;

    outbound = [];
    const picked = await service.pickDraft({ draftSetId: setId, index: 1 });
    expect(picked).toEqual({ ok: true });
    // 落盘这一轮是一条**新的**轮次：一条合成 user 消息 + 该稿的 message + 该稿提案的卡。
    const start = outbound.find((item) => item.type === "turn-start");
    expect(start?.type === "turn-start" && start.turnId).not.toBe(sampleTurnId);
    const replayed = outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
    expect(replayed.map((event) => event.type)).toEqual(["user-message", "message", "proposal"]);
    // 落盘的每个事件都用新轮次的 id（回放里不许出现采样轮那一串）。
    const pickTurnId = start?.type === "turn-start" ? start.turnId : "";
    expect(replayed.every((event) => event.turnId === pickTurnId)).toBe(true);
    // 卡真的进了待审：批准它才真的动盘（写盘通路还是既有那一条）。
    const card = replayed.find((event) => event.type === "proposal");
    if (card === undefined || card.type !== "proposal") throw new Error("必须发出那张卡");
    expect(service.diffOf(card.proposal.id)).not.toBe("");
    await service.decide({ proposalId: card.proposal.id, decision: "accept-once", guidance: "" });
    expect(writes).toEqual([CHAPTER]);

    expect(await service.pickDraft({ draftSetId: setId, index: 1 })).toMatchObject({
      ok: false,
      reason: "gone"
    });
    expect(writes).toEqual([CHAPTER]);
  });

  it("丢弃整集：盘上一个字节都不动，第二次回 gone", async () => {
    const { service, writes } = await build(sseFetch(proposeChunks, STOP, proposeChunks, STOP));
    await service.startTurn(turn("改紧一点", 2));
    const setId = candidatesPayload().draftSetId;
    const before = await sessionLines();

    outbound = [];
    expect(await service.discardDrafts({ draftSetId: setId })).toEqual({ ok: true });
    // 零事件、零写盘：用户的书稿与那段会话历史都没被碰过。
    expect(outbound).toEqual([]);
    expect(await sessionLines()).toEqual(before);
    expect(writes).toEqual([]);
    expect(await service.discardDrafts({ draftSetId: setId })).toMatchObject({
      ok: false,
      reason: "gone"
    });
  });

  it("换书之后旧集取不到（gone）：不会拿旧书的稿往新书里落", async () => {
    const { service, book } = await build(sseFetch(proposeChunks, STOP, proposeChunks, STOP));
    await service.startTurn(turn("改紧一点", 2));
    const setId = candidatesPayload().draftSetId;

    const other = await mkdtemp(path.join(tmpdir(), "mochen-multi-other-"));
    tempDirs.push(other);
    await mkdir(path.join(other, "chapters"), { recursive: true });
    await writeFile(
      path.join(other, "book.json"),
      await readFile(path.join(root, "book.json")),
      "utf8"
    );
    await book.open(other);

    expect(await service.pickDraft({ draftSetId: setId, index: 0 })).toMatchObject({
      ok: false,
      reason: "gone"
    });
    expect(await service.discardDrafts({ draftSetId: setId })).toMatchObject({
      ok: false,
      reason: "gone"
    });
  });
});

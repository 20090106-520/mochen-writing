/**
 * 设定提案的审批链（2026-11-20，`propose_bible`）。
 *
 * 验的是「模型只提、用户批准才落盘」这条纪律在设定库上也成立：
 * ① 提出时一个字都不写盘；② 全开档 + 动手档批准才追加一条 JSON；
 * ③ 策划档与只读档都拒在审批口；④ 同名同类型不重复追加；⑤ 取消什么都不动。
 *
 * 与 `agent-service-unbound-approve.test.ts` 同一拆法：另配最小夹具，
 * 不往 800 行上限的 `agent-service.test.ts` 里塞。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type AgentEvent,
  type AgentOutbound,
  type BookMeta,
  type StartTurnInput
} from "@mochen/contracts";
import type { ProviderFetch, ProviderFetchResult } from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

const CHAPTER = "chapters/01-开局.md";
const BIBLE_REL = ".mochen/data/story-bible.json";
const PROPOSAL = {
  type: "character",
  title: "阿雾",
  content: "雾里出现的摆渡人，说话像潮水。",
  why: "第七章要她开口，设定库里还没有她。"
};

const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];
let root = "";

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function turn(userText: string): StartTurnInput {
  return {
    threadKey: CHAPTER,
    docRelPath: CHAPTER,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths: [],
    sampleCount: 1
  };
}

function events(): AgentEvent[] {
  return outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function bibleProposalIds(): string[] {
  return events().flatMap((event) => (event.type === "bible-proposal" ? [event.proposal.id] : []));
}

function bibleEvents(): string[] {
  return events().flatMap((event) =>
    event.type === "bible-proposal" || event.type === "bible-written" ? [event.type] : []
  );
}

/** 一次请求回 propose_bible 的工具调用，随后回 stop——工具循环要这一条才能收尾。 */
function bibleFetch(): ProviderFetch {
  const enc = new TextEncoder();
  const chunksByCall = [
    [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  function: { name: "propose_bible", arguments: JSON.stringify(PROPOSAL) }
                }
              ]
            }
          }
        ]
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
    ],
    [{ choices: [{ delta: {}, finish_reason: "stop" }] }]
  ];
  let call = 0;
  return async () => {
    const chunks = chunksByCall[Math.min(call, 1)] ?? [];
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

async function build(meta: Partial<BookMeta> = {}): Promise<{
  service: AgentService;
  book: BookService;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-bible-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-bible-secret-"));
  tempDirs.push(dir, secrets);
  root = dir;
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await writeFile(path.join(dir, CHAPTER), "雾从海面涌上来。\n", "utf8");
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
  await book.saveMeta({
    ...opened.meta,
    permissionMode: "full-access",
    workMode: "act",
    ...meta
  });
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
  if (connectionId === "") throw new Error("连接没建起来，档案挂不上去");
  await credentials.save(connectionId, "sk-canary-bible");
  await settings.upsertProfile({ model: "test-model", connectionId });

  outbound = [];
  let counter = 0;
  const service = createAgentService({
    book,
    settings,
    fetchImpl: bibleFetch(),
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-11-20T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, book };
}

async function bibleFile(): Promise<string> {
  return readFile(path.join(root, ...BIBLE_REL.split("/")), "utf8");
}

describe("agentService · 设定提案（propose_bible）", () => {
  it("提出时只发一张待审提案，设定文件根本不存在", async () => {
    const { service } = await build();
    await service.startTurn(turn("记住这个摆渡人"));
    const [id] = bibleProposalIds();
    expect(id).toBeDefined();
    const proposed = events().find(
      (event) => event.type === "bible-proposal" && event.proposal.id === id
    );
    expect(proposed).toBeDefined();
    // turnId / threadKey 由服务覆写：空值过不了事件 schema，也会让卡片挂错线程。
    if (proposed?.type === "bible-proposal") {
      expect(proposed.turnId).not.toBe("");
      expect(proposed.proposal.threadKey).toBe(CHAPTER);
      expect(proposed.proposal.title).toBe(PROPOSAL.title);
    }
    await expect(bibleFile()).rejects.toThrow();
    service.dispose();
  });

  it("全开 + 动手档批准：追加一条设定，先 decision 后 bible-written", async () => {
    const { service } = await build();
    await service.startTurn(turn("记住这个摆渡人"));
    const id = bibleProposalIds()[0] ?? "";
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.docRelPath).toBe(BIBLE_REL);
      expect(result.auto).toBe(false);
    }
    const entries = JSON.parse(await bibleFile()) as { title: string; type: string }[];
    expect(
      entries.some((entry) => entry.title === PROPOSAL.title && entry.type === "character")
    ).toBe(true);
    expect(bibleEvents()).toEqual(["bible-proposal", "bible-written"]);
    service.dispose();
  });

  it("策划档与只读档都拒在审批口，一个字节都没写", async () => {
    const plan = await build({ workMode: "plan" });
    await plan.service.startTurn(turn("记住这个摆渡人"));
    const planDenied = await plan.service.decide({
      proposalId: bibleProposalIds()[0] ?? "",
      decision: "accept-once",
      guidance: ""
    });
    expect(planDenied.ok).toBe(false);
    if (!planDenied.ok) expect(planDenied.reason).toBe("permission-denied");
    await expect(bibleFile()).rejects.toThrow();
    plan.service.dispose();

    const readOnly = await build({ permissionMode: "chapter-write" });
    await readOnly.service.startTurn(turn("记住这个摆渡人"));
    const readDenied = await readOnly.service.decide({
      proposalId: bibleProposalIds()[0] ?? "",
      decision: "accept-once",
      guidance: ""
    });
    expect(readDenied.ok).toBe(false);
    if (!readDenied.ok) {
      expect(readDenied.reason).toBe("permission-denied");
      expect(readDenied.message).toContain("全开");
    }
    await expect(bibleFile()).rejects.toThrow();
    readOnly.service.dispose();
  });

  it("设定库里已有同名同类型：不重复追加，卡片标为失效", async () => {
    const { service } = await build();
    await mkdir(path.join(root, ".mochen", "data"), { recursive: true });
    await writeFile(
      path.join(root, ...BIBLE_REL.split("/")),
      JSON.stringify([
        {
          id: "old",
          type: "character",
          title: "阿雾",
          content: "旧版",
          createdAt: 1,
          updatedAt: 1,
          tags: [],
          archived: false
        }
      ]),
      "utf8"
    );
    await service.startTurn(turn("记住这个摆渡人"));
    const id = bibleProposalIds()[0] ?? "";
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    const entries = JSON.parse(await bibleFile()) as { id: string }[];
    expect(entries).toHaveLength(1);
    const errored = events().find((event) => event.type === "error" && event.proposalId === id);
    expect(errored).toBeDefined();
    service.dispose();
  });

  it("取消：只发 decision，设定库不动", async () => {
    const { service } = await build();
    await service.startTurn(turn("记住这个摆渡人"));
    const id = bibleProposalIds()[0] ?? "";
    const result = await service.decide({ proposalId: id, decision: "cancel", guidance: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cancelled");
    expect(events().some((event) => event.type === "decision" && event.decision === "cancel")).toBe(
      true
    );
    await expect(bibleFile()).rejects.toThrow();
    service.dispose();
  });
});

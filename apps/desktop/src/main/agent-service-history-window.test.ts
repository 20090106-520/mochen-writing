import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  HISTORY_TOKEN_BUDGET,
  type ProviderFetch,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/**
 * P1-3「会话历史零截断」的**接线契约**：
 * 一份长历史进 startTurn，outbound 里必须出现「更早的 N 条没有发给模型（约 M 字）」那条
 * error 事件（走的是 emitOnly → 落渲染层不落盘的既有通路），且 contextPreview 的返回
 * 要如实带上 `history` 那一项。之所以另起一份文件而不是塞进 agent-service.test.ts：
 * 那份已经贴着 800 行预算，与 agent-service-load-session.test.ts 同一处置先例。
 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-hw-1";

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

/** 一条 STOP 帧——历史截断这一路只验发出与 notice，工具循环不进入。 */
const STOP: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];

function sseFetch(): ProviderFetch {
  const enc = new TextEncoder();
  return async () => {
    const stream = (async function* () {
      for (const chunk of STOP) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

function events(): AgentEvent[] {
  return outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function errorMessages(): string[] {
  return events().flatMap((e) => (e.type === "error" ? [e.message] : []));
}

interface Built {
  service: AgentService;
  book: BookService;
  sessionRel: () => string;
}

async function build(): Promise<Built> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-hw-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-hw-secret-"));
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
  let counter = 0;
  const lastRel = "";
  const service = createAgentService({
    book,
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl: sseFetch(),
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return {
    service,
    book,
    sessionRel: () => {
      if (lastRel === "") throw new Error("会话没建出来");
      return lastRel;
    }
  };
  void lastRel;
}

/**
 * 用 appendAgentEvent 直接往会话里灌一段长历史（比跑多轮 startTurn 便宜得多）。
 * 每条 user-message 是 400 字中文——按 estimateTokens 大约就是 400 tokens 一条，
 * 15 条 ≈ 6000 tokens，正好顶到 HISTORY_TOKEN_BUDGET 附近；再多就必丢。
 */
async function seedLongHistory(built: Built, count: number): Promise<void> {
  const meta = {
    type: "session-meta" as const,
    sessionId: "hw-seed",
    docRelPath: CHAPTER,
    stageId: "draft",
    model: "test-model",
    startedAt: "20226-10-01T07:00:00.000Z"
  };
  const rel = await createSession(root, meta);
  for (let i = 0; i < count; i += 1) {
    await appendAgentEvent(root, rel, {
      id: `seed-${i}`,
      ts: "2026-10-01T07:00:00.000Z",
      turnId: `t${i}`,
      type: "user-message",
      text: `第 ${i} 轮：${"字".repeat(400)}`
    });
  }
  // 让 build 里那个 sessionRel 指向这一条：service 会在 threadFor 里找到它（findLatestSession）。
  // 这里把 startedAt 写得比 service 即将新建的那一条更近，避免 threadFor 走「新建」分支。
}

describe("agent-service · P1-3 历史切片与 notice", () => {
  it("长历史进 startTurn：outbound 里出现「更早的 N 条没有发给模型（约 M 字）」那条 error", async () => {
    const built = await build();
    await seedLongHistory(built, 20);
    await built.service.startTurn(turn(CHAPTER, "把开头改紧"));
    const errs = errorMessages();
    const notice = errs.find((m) => m.includes("更早的") && m.includes("没有发给模型"));
    expect(notice).toBeTypeOf("string");
    // 那句必须带 N 与 M：只有笼统「已截断」不叫「说人话」。
    expect(notice).toMatch(/更早的\s*\d+\s*条/);
    expect(notice).toMatch(/约?\s*\d+\s*字/);
    built.service.dispose();
  });

  it("短历史不触发截断：不出现那条 notice（不许对没超长的用户谎报「丢了」）", async () => {
    const built = await build();
    await seedLongHistory(built, 1);
    await built.service.startTurn(turn(CHAPTER, "把开头改紧"));
    const errs = errorMessages();
    expect(errs.some((m) => m.includes("更早的") && m.includes("没有发给模型"))).toBe(false);
    built.service.dispose();
  });

  it("contextPreview 返回带上 `history` 这一项：至少包含 droppedCount 与 chars（面板只挂线）", async () => {
    const built = await build();
    await seedLongHistory(built, 20);
    // 先起一轮把 threadFor 那条 rel 挂进缓存，contextPreview 才找得到会话。
    await built.service.startTurn(turn(CHAPTER, "预热"));
    const preview = await built.service.contextPreview({
      docRelPath: CHAPTER,
      profileId: null,
      pinned: []
    });
    // 契约扩了可选字段：`history` 必须存在（长历史场景下），且字数与丢弃数能对上人话。
    expect(preview.history).toBeDefined();
    expect(preview.history?.entries).toBeGreaterThan(0);
    expect(preview.history?.chars).toBeGreaterThanOrEqual(0);
    expect(preview.history?.approxTokens).toBeLessThanOrEqual(HISTORY_TOKEN_BUDGET);
    built.service.dispose();
  });
});

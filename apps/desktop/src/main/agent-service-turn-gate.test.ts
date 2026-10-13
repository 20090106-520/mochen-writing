import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type AgentOutbound,
  type StartTurnInput
} from "@mochen/contracts";
import {
  type ProviderFetch,
  type ProviderFetchInput,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { createBookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/**
 * P2-7「同一条对话线程不许同时跑两轮」的**闸门契约**。
 *
 * 缺陷的形状：主进程只按 turnId 记 AbortController，没有任何一处挡「同一个 threadKey 上
 * 第二startTurn」。渲染层那个 `running` 只是**界面**的自持状态——两个窗口、队列自动送与
 * 手抖的一次点击、或一次 IPC 重放，都能把两轮叠在同一条会话线程上。后果不是「不好看」：
 * 两条流往**同一个 JSONL** 追加事件（`persist` 只保证不交错成坏行，不保证轮次不混），
 * 历史里两轮的 user / message / 工具回执按到达顺序混在一起，回放与再发一遍的上下文都是脏的。
 *
 * 闸门只在 `startTurn` 入口这一处；句子也只在主进程一处——渲染层已经有那条既有通路
 * （`useAgentStore.ts:397` 把 startTurn 的拒绝原话写成「这一轮没能启动：…」并进 lastError），
 * 所以这里**不需要**动渲染层一个字（铁律 6）。
 */
const CHAPTER = "chapters/01-开局.md";
const OTHER = "chapters/02-闸口.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-gate-1";

const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function turn(docRelPath: string, userText: string): StartTurnInput {
  return {
    threadKey: docRelPath,
    docRelPath,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths: []
  };
}

function turnStarts(): Extract<AgentOutbound, { type: "turn-start" }>[] {
  return outbound.flatMap((item) => (item.type === "turn-start" ? [item] : []));
}

function turnEnds(): Extract<AgentOutbound, { type: "turn-end" }>[] {
  return outbound.flatMap((item) => (item.type === "turn-end" ? [item] : []));
}

/** 只认「这一轮已经进到流里」那个信号：出过一条 delta 才算真的在跑。 */
function streaming(): boolean {
  return outbound.some((item) => item.type === "delta");
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等不到：${label}`);
}

/**
 * 「当场被拒」的判据：两轮压在同一个 `await` 上是分辨不出来的——没有闸门时那一笔
 * 永远挂着，用例只会以 `Test timed out in 5000ms` 收场，那不是断言、那是超时。
 * 所以先给它 2 秒：2 秒内落败 ⇒ 拿到拒绝理由；挂着或跑完 ⇒ 闸门不存在。
 */
async function rejectReason(promise: Promise<unknown>): Promise<string> {
  const pending = new Promise<"pending">((resolve) => {
    setTimeout(() => resolve("pending"), 2_000);
  });
  const settled = await Promise.race([
    promise.then(
      () => "accepted" as const,
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    ),
    pending
  ]);
  if (settled === "pending")
    throw new Error("同线程的第二轮没有被当场拒绝：它一直挂着（闸门不存在）");
  if (settled === "accepted")
    throw new Error("同线程的第二轮没有被拒绝：它照常跑完了（闸门不存在）");
  return settled;
}

const DELTA_CHUNK = { choices: [{ delta: { content: "写了一半" } }] };
const STOP_CHUNK = { choices: [{ delta: {}, finish_reason: "stop" }] };

interface Stall {
  fetchImpl: ProviderFetch;
  /** 放开挂住的那条流；已经 abort 的连接放不放都收尾。 */
  release: () => void;
  calls: () => number;
  /** 第 N 次请求（0 起）直接回这个状态码，用来造「上一轮失败了」那条路。 */
  failFirstWith?: number;
}

/**
 * 可控的挂住夹具：第一条增量之后就停住，直到 release() 或 signal 被 abort。
 * 打断那两条用例必须有这一枚——真 fetch 在 abort 后是 reader.read() reject，
 * 测试里要的是「我说了算的收尾时机」，才能分辨「interrupt 之后槽位到底什么时候空」。
 */
function stall(failFirstWith?: number): Stall {
  const enc = new TextEncoder();
  let calls = 0;
  let gate = () => {};
  const opened = new Promise<void>((resolve) => {
    gate = resolve;
  });
  const aborted = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  return {
    calls: () => calls,
    release: () => gate(),
    ...(failFirstWith === undefined ? {} : { failFirstWith }),
    fetchImpl: async (request: ProviderFetchInput) => {
      calls += 1;
      if (failFirstWith !== undefined && calls === 1)
        return {
          status: failFirstWith,
          stream: null,
          errorText: '{"error":{"message":"upstream exploded"}}'
        } satisfies ProviderFetchResult;
      const stream = (async function* () {
        yield enc.encode(`data: ${JSON.stringify(DELTA_CHUNK)}\n\n`);
        await Promise.race([opened, aborted(request.signal)]);
        yield enc.encode(`data: ${JSON.stringify(STOP_CHUNK)}\n\n`);
      })();
      return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
    }
  };
}

interface Built {
  service: AgentService;
}

async function build(fetchImpl: ProviderFetch, configured = true): Promise<Built> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-gate-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-gate-secret-"));
  tempDirs.push(dir, secrets);
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  await writeFile(path.join(dir, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(path.join(dir, OTHER), "第二段\n闸口。\n", "utf8");
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
  if (configured) {
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
  }
  outbound = [];
  let counter = 0;
  const service = createAgentService({
    book,
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl,
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service };
}

describe("agent-service · 同一线程不许同时跑两轮（P2-7）", () => {
  it("第一轮还在生成 ⇒ 同线程第二轮当场被拒，理由是人话且一条 turn-start 都不发", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const first = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(streaming, "第一轮进到流里");
    const second = built.service.startTurn(turn(CHAPTER, "第二句"));
    expect(await rejectReason(second)).toMatch(/还在生成/);
    // 当场拒 = 在 emit turn-start **之前**：混进半轮再拒会把界面钉在 running 上。
    expect(turnStarts().length).toBe(1);
    expect(turnEnds().length).toBe(0);
    s.release();
    await first;
    built.service.dispose();
  });

  it("拒绝那句要带上出路：等它答完或先打断，用户读得懂下一步做什么", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const first = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(streaming, "第一轮进到流里");
    expect(await rejectReason(built.service.startTurn(turn(CHAPTER, "第二句")))).toMatch(/打断/);
    s.release();
    await first;
    built.service.dispose();
  });

  it("另一条线程不受影响：闸门锁的是这一条线程，不是整个进程", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const first = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(streaming, "第一轮进到流里");
    const other = built.service.startTurn(turn(OTHER, "另一条线程"));
    await waitUntil(() => turnStarts().length === 2, "另一条线程的 turn-start");
    await waitUntil(() => s.calls() === 2, "另一条线程进到流里");
    expect(turnStarts()[0]?.turnId).not.toBe(turnStarts()[1]?.turnId);
    s.release();
    await Promise.all([first, other]);
    built.service.dispose();
  });

  it("打断不是起新轮的捷径：turn-end 没出去之前槽位仍占着", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const first = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(streaming, "第一轮进到流里");
    const turnId = turnStarts()[0]?.turnId ?? "";
    expect(await built.service.interrupt(turnId)).toBe(true);
    // 打断只让流收尾；这一轮的 turn-end 还没发、落盘还没排空 ⇒ 仍然占着槽位。
    expect(await rejectReason(built.service.startTurn(turn(CHAPTER, "第二句")))).toMatch(
      /还在生成/
    );
    s.release();
    await first;
    expect(turnEnds().length).toBe(1);
    built.service.dispose();
  });

  it("打断的那一轮走完之后槽位一定空出来：漏一次这条线程就永久锁死", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const first = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(streaming, "第一轮进到流里");
    await built.service.interrupt(turnStarts()[0]?.turnId ?? "");
    s.release();
    await first;
    const second = await built.service.startTurn(turn(CHAPTER, "第二句"));
    expect(second.turnId).not.toBe("");
    expect(turnStarts().length).toBe(2);
    built.service.dispose();
  });

  it("失败轮同样释放：上一轮被上游打回来之后，同一句能重来", async () => {
    // 用 400（不可重试）造失败：连接期自动重试（2026-10-11）上线后，503 那类瞬时故障
    // 会被默哀一秒半救回来、这轮就不再「失败」了——本条要钉的是「失败释放槽位」，
    // 不是「503 必失败」，所以夹具换成重试救不回的状态码。
    const s = stall(400);
    const built = await build(s.fetchImpl);
    await built.service.startTurn(turn(CHAPTER, "第一句"));
    expect(turnEnds()[0]?.status).toBe("failed");
    const other = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(() => turnStarts().length === 2, "失败之后再起一轮");
    s.release();
    await other;
    built.service.dispose();
  });

  it("空输入那条早退路也要释放槽位：早退同样算这一轮结束了", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const empty = await built.service.startTurn(turn(CHAPTER, "   "));
    expect(empty.turnId).not.toBe("");
    expect(turnEnds().at(-1)?.status).toBe("failed");
    const other = built.service.startTurn(turn(CHAPTER, "第一句"));
    await waitUntil(() => turnStarts().length === 2, "空输入之后再起一轮");
    s.release();
    await other;
    built.service.dispose();
  });

  it("没配模型服务那条早退路同样释放：pre-flight 失败不许把线程锁死", async () => {
    const s = stall();
    const built = await build(s.fetchImpl, false);
    const first = await built.service.startTurn(turn(CHAPTER, "第一句"));
    expect(first.turnId).not.toBe("");
    const second = await built.service.startTurn(turn(CHAPTER, "第一句"));
    expect(second.turnId).not.toBe("");
    s.release();
    built.service.dispose();
  });

  it("线程键的空白与未绑定同一格：带空格的同一线程也算同一条，不许绕过闸门", async () => {
    const s = stall();
    const built = await build(s.fetchImpl);
    const first = built.service.startTurn({
      ...turn(CHAPTER, "第一句"),
      threadKey: ` ${CHAPTER} `
    });
    await waitUntil(streaming, "第一轮进到流里");
    expect(await rejectReason(built.service.startTurn(turn(CHAPTER, "第二句")))).toMatch(
      /还在生成/
    );
    s.release();
    await first;
    built.service.dispose();
  });
});

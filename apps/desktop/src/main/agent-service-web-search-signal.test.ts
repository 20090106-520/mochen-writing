/**
 * P1-1 的②：用户按了打断，联网搜索却照旧把三个源串着跑完。
 *
 * 【证据】扫描总单 2026-10-09 §4 P1-1 指的是 `agent-service.ts` 里
 * `webSearch: (query) => webSearch(query, { fetchImpl: fetch })`——这一轮那只
 * `AbortController` 从头到尾没递进出网那一步。后果不是「多等一会儿」：
 * `web-search.ts` 的每个源都在 `timedFetch` 里把 `init.signal` **覆写**成
 * `AbortSignal.timeout(6000)`，所以递进来的信号连被覆写的机会都没有，压根没递到；
 * 三源串行 × 最多四轮，界面上就是「Esc 按了、转圈继续」最长六分钟。
 *
 * 这一份夹具复现的就是那个形状：模型发一枚 `web_search`，`webSearchEnabled` 为真，
 * 出网那一步由 `globalThis.fetch` 替身记账——**替身只在拿到 abort 通知时才了结**，
 * 和真 fetch 一致。于是不修的话这条轮次永远收不住（用例用一个显式哨兵判它红，
 * 不是靠 vitest 默认超时），修好了就当场收住。
 *
 * 不用假计时器：这里量的就是「signal 有没有连上」这条真链路，计时器只会替我把它读一遍。
 */
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
import type { ProviderFetch } from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-ws-signal-1a2b3c";

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/** 脚本化 SSE：数组元素是一次请求的响应，用完回一条无工具的收尾（与既有 agent-service 夹具同形）。 */
function sseFetch(...rounds: Record<string, unknown>[][]): ProviderFetch {
  const enc = new TextEncoder();
  const stop: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];
  let call = 0;
  return async () => {
    const chunks = call < rounds.length ? (rounds[call] ?? stop) : stop;
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" };
  };
}

/** 模型发一枚 web_search：只有联网开关为真的那一轮它才该被执行，夹具走的就是开的那条。 */
const webSearchChunks = [
  {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "s1",
              function: {
                name: "web_search",
                arguments: JSON.stringify({ query: "潮汐发电 现状" })
              }
            }
          ]
        }
      }
    ]
  },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
];

function turn(userText: string, webSearchEnabled: boolean): StartTurnInput {
  return {
    threadKey: CHAPTER,
    docRelPath: CHAPTER,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled,
    skillPaths: []
  };
}

async function buildService(
  fetchImpl: ProviderFetch
): Promise<{ service: AgentService; out: AgentOutbound[] }> {
  const root = await mkdtemp(path.join(tmpdir(), "mochen-wssignal-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-wssignal-secret-"));
  tempDirs.push(root, secrets);
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  const bookJson = {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: []
  };
  await writeFile(path.join(root, "book.json"), JSON.stringify(bookJson, null, 2), "utf8");
  const book: BookService = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
  const opened = await book.open(root);
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });

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
  await credentials.save(connectionId, API_KEY);
  await settings.upsertProfile({ model: "test-model", connectionId });

  const out: AgentOutbound[] = [];
  let counter = 0;
  const service = createAgentService({
    book,
    settings,
    fetchImpl,
    emit: (payload) => out.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, out };
}

function turnIdOf(out: AgentOutbound[]): string {
  const start = out.find((item) => item.type === "turn-start");
  if (start === undefined || start.type !== "turn-start")
    throw new Error("turn-start 必须先发出来");
  return start.turnId;
}

function lastTurnEnd(out: AgentOutbound[]): string {
  const end = out
    .slice()
    .reverse()
    .find((item) => item.type === "turn-end");
  return end === undefined || end.type !== "turn-end" ? "没有 turn-end" : end.status;
}

async function waitUntil(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

/**
 * 出网替身：记下每一次 fetch 拿到的 signal，并且**只有拿到 abort 才了结**（reject AbortError），
 * 与真 fetch 的时序一致。绝不自己 resolve，也不碰真实网络——「没人告诉它可以停」时就是一直挂着。
 */
function hangingFetchStub(): { signals: (AbortSignal | undefined)[]; restore: () => void } {
  const real = globalThis.fetch;
  const signals: (AbortSignal | undefined)[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    signals.push(signal);
    void url;
    return new Promise<Response>((resolve, reject) => {
      void resolve;
      if (signal === undefined) {
        reject(new Error("夹具：出网这一步没拿到 signal，无法判断打断有没有传下来"));
        return;
      }
      if (signal.aborted) {
        reject(new DOMException("This operation was aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("This operation was aborted", "AbortError")),
        { once: true }
      );
    });
  }) as typeof globalThis.fetch;
  return {
    signals,
    restore: () => {
      globalThis.fetch = real;
    }
  };
}

describe("联网搜索必须接上这一轮的打断（P1-1 的②）", () => {
  it("Esc 之后出网那一步的 signal 当场 aborted、轮次收得住；不接就永远挂在那里", async () => {
    const stub = hangingFetchStub();
    try {
      const { service, out } = await buildService(sseFetch(webSearchChunks));
      const running = service
        .startTurn(turn("查一下潮汐发电的现状", true))
        .then(() => "轮次已收住" as const)
        .catch(() => "轮次已收住" as const);

      // 前提：搜索真的出网了一次。没有这一次出网，下面的读数就什么都不是。
      await waitUntil(
        () => stub.signals.length > 0,
        "联网开关开着，web_search 却一次都没出网：夹具前提不成立"
      );
      expect(await service.interrupt(turnIdOf(out))).toBe(true);

      // 哨兵而不是裸 race：修好了这一句是「轮次已收住」；没修好红的是那句自解释的判词，
      // 用例本身照样在 600 毫秒内出结论，不会拖到 vitest 的默认超时。
      const outcome = await Promise.race([
        running,
        new Promise<string>((resolve) =>
          setTimeout(
            () =>
              resolve(
                "打断后 600 毫秒轮次仍未收住：出网请求没接到这一轮的 abort，三源串行要各挂到自己的 6 秒超时"
              ),
            600
          )
        )
      ]);
      expect(outcome).toBe("轮次已收住");
      expect(stub.signals.every((signal) => signal?.aborted === true)).toBe(true);
      expect(lastTurnEnd(out)).toBe("interrupted");
      service.dispose();
    } finally {
      stub.restore();
    }
  });
});

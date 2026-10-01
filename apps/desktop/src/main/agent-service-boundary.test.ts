import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  type AgentOutbound,
  type StartTurnInput
} from "@mochen/contracts";
import {
  findLatestSession,
  readSession,
  type ProviderFetch,
  type ProviderFetchResult
} from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, defaultPromptFor, type AgentService } from "./agent-service.js";

/**
 * 服务边界的「拒绝长什么样」专项（裁定 n + 裁定 o + 空白而非空串的可达分支）。
 * 这些用例要从头跑装配，而 agent-service.test.ts 已经贴着 800 行预算，
 * 所以另起一份最小夹具：模型只回一条 stop——边界用例验的是「有没有开轮、拒绝是不是中文」，
 * 不是模型说了什么。
 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-boundary";

let root = "";
const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/** 只回一条 finish_reason=stop：让工具循环干净收尾，不产生任何提案。 */
function stopFetch(): ProviderFetch {
  const enc = new TextEncoder();
  return async () => {
    const chunk = { choices: [{ delta: {}, finish_reason: "stop" }] };
    const stream = (async function* () {
      yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

async function build(): Promise<{
  service: AgentService;
  writes: string[];
  outbound: AgentOutbound[];
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-boundary-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-boundary-secret-"));
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
  const outbound: AgentOutbound[] = [];
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
    fetchImpl: stopFetch(),
    emit: (payload) => outbound.push(payload),
    newId: () => "id1",
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, writes, outbound };
}

/**
 * 跨 IPC 的拒绝必须是**单句中文**（裁定 n）：取出 message 并当场钉掉裸 ZodError 的骨架特征
 * （`[`、`{`、`ZodError`、`origin`、`too_big`/`too_small`）。把实现里的 safeParse 换回 parse，
 * message 就成了 issue 数组原文，这些断言必红。
 */
async function rejectMessage(promise: Promise<unknown>): Promise<string> {
  const message = await promise.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
  if (message === null) throw new Error("期待拒绝，结果却 resolve 了");
  expect(message).not.toMatch(/ZodError|origin|too_big|too_small|\[|\{/);
  return message;
}

function turnStartThreadKeys(outbound: AgentOutbound[]): string[] {
  return outbound.flatMap((item) => (item.type === "turn-start" ? [item.threadKey] : []));
}

async function chapterBytes(): Promise<string> {
  return readFile(path.join(root, ...CHAPTER.split("/")), "utf8");
}

describe("agentService 边界拒绝与线程归一", () => {
  it("超长 userText 的拒绝是单句中文：含「过长」，不含裸 ZodError 骨架", async () => {
    const { service, writes } = await build();
    const input: StartTurnInput = {
      threadKey: CHAPTER,
      docRelPath: CHAPTER,
      stageId: "draft",
      userText: "写".repeat(20001)
    };
    expect(await rejectMessage(service.startTurn(input))).toContain("过长");
    expect(writes).toEqual([]);
    expect(await chapterBytes()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("空 stageId 的拒绝是单句中文：含「不能为空」，不含裸 ZodError 骨架", async () => {
    const { service } = await build();
    const message = await rejectMessage(
      service.startTurn({
        threadKey: CHAPTER,
        docRelPath: CHAPTER,
        stageId: "",
        userText: "写点什么"
      })
    );
    expect(message).toContain("不能为空");
    service.dispose();
  });

  it("decide 的拒绝是单句中文：空白提案标识被中文挡下", async () => {
    const { service } = await build();
    const message = await rejectMessage(
      service.decide({ proposalId: "", decision: "cancel", guidance: "" })
    );
    expect(message).toContain("提案标识不能为空");
    service.dispose();
  });

  it("裁定 o：空 threadKey 却带 docRelPath → 中文拒绝，一个字节都没落盘，也没发 turn-start", async () => {
    const { service, writes, outbound } = await build();
    for (const threadKey of ["", "  ", "\t"]) {
      const message = await rejectMessage(
        service.startTurn({
          threadKey,
          docRelPath: CHAPTER,
          stageId: "draft",
          userText: "写点什么"
        })
      );
      expect(message).toContain("两者不能同时给");
    }
    expect(writes).toEqual([]);
    expect(turnStartThreadKeys(outbound)).toEqual([]);
    expect(await chapterBytes()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("裁定 o：空 threadKey 且 docRelPath 为 null → 合法，独立线程落 unbound", async () => {
    const { service, outbound } = await build();
    await expect(
      service.startTurn({ threadKey: "", docRelPath: null, stageId: "draft", userText: "随便聊聊" })
    ).resolves.toBeDefined();
    expect(turnStartThreadKeys(outbound)).toEqual(["unbound"]);
    const rel = await findLatestSession(root, "unbound");
    if (rel === null) throw new Error("独立线程也要落盘");
    const stored = await readSession(root, rel);
    expect(stored.meta.docRelPath).toBe("unbound");
    service.dispose();
  });

  it("纯空白 stageId：min(1) 放行后走 agent-service.ts:200 的 unbound 兜底（该分支不是死代码）", async () => {
    const { service } = await build();
    await expect(
      service.startTurn({
        threadKey: CHAPTER,
        docRelPath: CHAPTER,
        stageId: "   ",
        userText: "随便聊聊"
      })
    ).resolves.toBeDefined();
    const rel = await findLatestSession(root, CHAPTER);
    if (rel === null) throw new Error("会话要落盘，否则兜底分支不可观测");
    const stored = await readSession(root, rel);
    expect(stored.meta.stageId).toBe("unbound");
    expect(stored.meta.docRelPath).toBe(CHAPTER);
    service.dispose();
  });

  it("纯空白 threadKey 且 docRelPath 为 null：归一成 unbound，不拒绝", async () => {
    const { service, outbound } = await build();
    await expect(
      service.startTurn({
        threadKey: "  ",
        docRelPath: null,
        stageId: "draft",
        userText: "随便聊聊"
      })
    ).resolves.toBeDefined();
    expect(turnStartThreadKeys(outbound)).toEqual(["unbound"]);
    service.dispose();
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
 * 不是模型说了什么。写盘竞态那一例（裁定 A）同理：它要自己装配一份必定返回 stale 的
 * 写盘通路，塞进 agent-service.test.ts 会撞行数硬门禁，所以落在这里。
 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-boundary";

let root = "";
const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/**
 * 脚本化 SSE：第 n 次请求回 `rounds[n]`，脚本用完回一条 stop——
 * 一次工具调用要吃掉两个响应位（调用 + 无调用的收尾），不兜底工具循环收不了尾。
 */
function scriptedFetch(...rounds: Record<string, unknown>[][]): ProviderFetch {
  const enc = new TextEncoder();
  const stop = { choices: [{ delta: {}, finish_reason: "stop" }] };
  let call = 0;
  return async () => {
    const chunks = rounds[call] ?? [stop];
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

/** 只回一条 finish_reason=stop：让工具循环干净收尾，不产生任何提案。 */
function stopFetch(): ProviderFetch {
  return scriptedFetch();
}

/** 一轮 propose_patch 工具调用（锚点在 CHAPTER_TEXT 里逐字唯一），随后 stop 收尾。 */
const proposePatchChunks: Record<string, unknown>[] = [
  {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "c1",
              function: {
                name: "propose_patch",
                arguments: JSON.stringify({
                  doc: CHAPTER,
                  anchor: "雾从海面涌上来。",
                  replace: "海雾涌上来，铁锈味很冲。",
                  why: "补可感细节"
                })
              }
            }
          ]
        }
      }
    ]
  },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
];

/**
 * `fetchImpl` 默认只回 stop；`writeDoc` 用来替换唯一写盘通路的返回值——
 * 「审批前指纹比对待通过、真正写盘时才发现被改动」这条 TOCTOU 分支只能这样造。
 */
async function build(
  options: { fetchImpl?: ProviderFetch; writeDoc?: BookService["writeDoc"] } = {}
): Promise<{
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
      // 注入的写盘返回值优先：这一支不落真盘，所以 writes 探针也不记账。
      if (options.writeDoc !== undefined)
        return options.writeDoc(relPath, content, expectedFingerprint);
      writes.push(relPath);
      return book.writeDoc(relPath, content, expectedFingerprint);
    }
  };
  const service = createAgentService({
    book: spied,
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl: options.fetchImpl ?? stopFetch(),
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

function proposalIdsOf(outbound: AgentOutbound[]): string[] {
  return outbound.flatMap((item) =>
    item.type === "event" && item.event.type === "proposal" ? [item.event.proposal.id] : []
  );
}

/** 外发载荷里的 error 事件：先窄化到 error 成员，`proposalId` 才是类型可见的字段。 */
function errorEventsOf(outbound: AgentOutbound[]): Extract<AgentEvent, { type: "error" }>[] {
  return outbound.flatMap((item) =>
    item.type === "event" && item.event.type === "error" ? [item.event] : []
  );
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

  it("写盘竞态返回 stale ⇒ 也发一条带 proposalId 的 error（裁定 A：这一支不再静默）", async () => {
    // 审批前指纹比对待通过、真正落盘时才发现被改动：TOCTOU 这一支现状只有 pending.delete，
    // 用户与 JSONL 都看不到它 ⇒ 重启回放会把这张已失效的卡念成 expired。
    const { service, outbound } = await build({
      fetchImpl: scriptedFetch(proposePatchChunks),
      writeDoc: async () => ({ ok: false, reason: "stale", currentFingerprint: "f".repeat(64) })
    });
    await service.startTurn({
      threadKey: CHAPTER,
      docRelPath: CHAPTER,
      stageId: "draft",
      userText: "改紧一点"
    });
    const id = proposalIdsOf(outbound)[0] ?? "";
    if (id === "") throw new Error("夹具必须先出提案，否则走不到写盘那一步");
    const result = await service.decide({ proposalId: id, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    const errs = errorEventsOf(outbound);
    expect(errs.map((event) => event.proposalId)).toContain(id);
    // 「写入时」而非「提案之后」：这句文案只能来自写盘竞态那一条，指纹不符那条没被误认。
    expect(errs.some((event) => event.message.includes("写入时"))).toBe(true);
    expect(errs.some((event) => event.message.includes("又被改动过"))).toBe(true);
    // 失败仍然保守：没有 written 事件，原稿一字不变
    expect(outbound.some((item) => item.type === "event" && item.event.type === "written")).toBe(
      false
    );
    expect(await chapterBytes()).toBe(CHAPTER_TEXT);
    service.dispose();
  });
});

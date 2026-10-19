/**
 * UNBOUND 线程上的批准（台账 `README.md:12` 那条「仍未做」的补验，止血波 4 顺手结掉）。
 *
 * 【为什么原来只能挂着】`agent-service.ts` 里那句
 * `currentChapter: threadKey === UNBOUND ? null : threadKey` 此前**只有纯函数层的证据**
 * （`packages/agent-runtime/test/permission-verdict.test.ts` 验的是 `writeVerdict` 收到
 * null 时怎么判），没人从 `decide()` 这一头走过一遍：跨进程哨兵 `UNBOUND` 到底有没有真的
 * 换成 null、换成了之后拒的是哪一支、理由上不上屏，全是纸面推断。台账因此不许升格成「验证过」。
 *
 * 【为什么另起一份文件】`agent-service.test.ts` 在 HEAD 就是 774 行，离 800 的硬预算只剩
 * 26 行余量（`tools/check-source-line-budget.mjs`），这两条塞进去必然撞门禁。
 * 与 `agent-service-boundary.test.ts` 同一个先例：另配一份最小夹具，只装配这一族用例要的那条链。
 *
 * 变异见证：把那一行改成 `currentChapter: threadKey`（等于不认 UNBOUND），
 * 第一条必须红，且红在理由文案上——那时拒的是 not-current-chapter，理由会说「只能写入当前章 unbound」。
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
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-canary-unbound";
const ANCHOR = "雾从海面涌上来。";
const REPLACE = "海雾涌上来，铁锈味很冲。";

let root = "";
const tempDirs: string[] = [];
let outbound: AgentOutbound[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return {
    // 与渲染层一致：没开任何标签页时线程键就是跨进程哨兵 UNBOUND（"unbound"）。
    threadKey: docRelPath ?? "unbound",
    docRelPath,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths: [],
    sampleCount: 1
  };
}

async function chapterFile(): Promise<string> {
  return readFile(path.join(root, ...CHAPTER.split("/")), "utf8");
}

function events(): AgentEvent[] {
  return outbound.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function proposalIds(): string[] {
  return events().flatMap((event) => (event.type === "proposal" ? [event.proposal.id] : []));
}

function errorMessages(): string[] {
  return events().flatMap((event) => (event.type === "error" ? [event.message] : []));
}

/** 一次请求回 propose_patch 的工具调用，之后回不含工具的 stop——工具循环要这一条才能收尾。 */
function proposeFetch(): ProviderFetch {
  const enc = new TextEncoder();
  const toolCall = [
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
                    anchor: ANCHOR,
                    replace: REPLACE,
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
  const stop = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];
  let call = 0;
  return async () => {
    const chunks = call === 0 ? toolCall : stop;
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" } satisfies ProviderFetchResult;
  };
}

interface Built {
  service: AgentService;
  book: BookService;
  /** 唯一写盘通路的探针：记的是「审批有没有真的走到 book.writeDoc 这一步」。 */
  writes: string[];
}

async function build(meta: Partial<BookMeta> = {}): Promise<Built> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-unbound-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-unbound-secret-"));
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
  // 默认落到「全开」：只读档下 host 连提案都不生成，验不到「提案已存在、批准才被档拦住」这条链。
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
  if (connectionId === "") throw new Error("连接没建起来，档案挂不上去");
  await credentials.save(connectionId, API_KEY);
  await settings.upsertProfile({ model: "test-model", connectionId });

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
    settings,
    fetchImpl: proposeFetch(),
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-09T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, book, writes };
}

describe("agentService · UNBOUND 线程上的批准（补台账那条未做）", () => {
  it("可改当前章档 + 没开标签页（unbound）：批准被拒在「无处可写」，一个字节都没落盘", async () => {
    const { service, writes } = await build({ permissionMode: "chapter-write" });
    await service.startTurn(turn(null, "改紧一点"));
    const id = proposalIds()[0] ?? "";
    expect(id).not.toBe("");

    const denied = await service.decide({
      proposalId: id,
      decision: "accept-once",
      guidance: ""
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("permission-denied");
    // 拒的是「没选定当前章」这一支，不是「不是当前章」那一支：两句话在界面上的下一步动作不同。
    expect(errorMessages().some((message) => message.includes("尚未选定当前章"))).toBe(true);
    expect(errorMessages().some((message) => message.includes("只能写入当前章"))).toBe(false);
    expect(writes).toEqual([]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("全开档 + unbound 线程：批准照样落到提案点名的那一篇（线程不认得章，写盘目标仍按提案走）", async () => {
    const { service, writes } = await build();
    await service.startTurn(turn(null, "改紧一点"));
    const id = proposalIds()[0] ?? "";
    const accepted = await service.decide({
      proposalId: id,
      decision: "accept-once",
      guidance: ""
    });
    expect(accepted.ok).toBe(true);
    // 写盘目标必须是提案里的 CHAPTER，而不是线程名 unbound——那一轮本来就没有文稿开着。
    expect(writes).toEqual([CHAPTER]);
    expect(await chapterFile()).toContain(REPLACE);
    service.dispose();
  });
});

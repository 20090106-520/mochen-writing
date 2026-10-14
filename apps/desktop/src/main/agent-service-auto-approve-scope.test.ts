/**
 * P0-4：「本会话自动批准 / 同文档同类改动不再问」必须按书隔离。
 *
 * 【撞法与 threads 撞名同源】两本书里只要有**同名文稿**（新建章节的默认标题极易撞），
 * threadKey（=文稿相对路径）与 ruleKey（=`docRelPath::tool`）就一模一样。旧实现里
 * 这两张自动批准表既不含书身份、`clearBookScoped()` 也不清它们——于是在 A 书点过一次
 * 「接受并本会话自动批准」，换到 B 书后撞名文稿的 Agent 提案**不经用户确认直接落盘**。
 *
 * 这一份夹具就是那个「两本书 + 同一篇同名文稿」的最小复现：不修的话下面每一条跨书用例都红。
 * 「同书内命中」那条是回归闸——修法不许把正常行为也一起清掉。
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
  type StartTurnInput
} from "@mochen/contracts";
import type { ProviderFetch } from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/** 两本书里**同名**的一篇文稿：撞名的正是这个。 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-autoscope-7c2e9b41";

/** 一条不含工具调用的响应：工具循环靠它收尾（脚本用完的兜底）。 */
const STOP: Record<string, unknown>[] = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];

const tempDirs: string[] = [];
afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function toolCallChunks(id: string, anchor: string, replace: string): Record<string, unknown>[] {
  return [
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
                  arguments: JSON.stringify({ doc: CHAPTER, anchor, replace, why: "收紧一句" })
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

/** 改第二段（锚点原样存在）。 */
const P1 = toolCallChunks("c1", "雾从海面涌上来。", "海雾涌上来，铁锈味很冲。");
/** 改第三段（P1 之后锚点「第三段」仍在）。 */
const P2 = toolCallChunks("c2", "第三段", "第三段，闸门在响。");
/** 改 P1 落下的那句（回到同一本书时锚点仍有效）。 */
const P3 = toolCallChunks("c3", "海雾涌上来，铁锈味很冲。", "海雾漫过脚踝。");

/** 数组元素是**一次请求**的响应，按顺序消费；用完回 STOP。 */
function sseFetch(...rounds: Record<string, unknown>[][]): ProviderFetch {
  const enc = new TextEncoder();
  let call = 0;
  return async () => {
    const chunks = call < rounds.length ? (rounds[call] ?? STOP) : STOP;
    call += 1;
    const stream = (async function* () {
      for (const chunk of chunks) yield enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);
    })();
    return { status: 200, stream, errorText: "" };
  };
}

function turn(userText: string): StartTurnInput {
  return {
    threadKey: CHAPTER,
    docRelPath: CHAPTER,
    stageId: "draft",
    userText,
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths: []
  };
}

/** 铺一本带同名章节的书并 open 进去；全开档（只读档下连提案都不会生成，验不到审批→落盘）。 */
async function seedBook(title: string): Promise<BookService> {
  const root = await mkdtemp(path.join(tmpdir(), "mochen-autoscope-"));
  tempDirs.push(root);
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(
    path.join(root, "book.json"),
    JSON.stringify({
      id: `b-${title}`,
      title,
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: DEFAULT_PERMISSION_MODE,
      chapterOrder: []
    }),
    "utf8"
  );
  const book = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
  const opened = await book.open(root);
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });
  return book;
}

/** 建一个**跨两本书共用**的服务：books 换掉，服务不重建——这正是产品里的形状。 */
async function buildService(
  book: BookService,
  fetchImpl: ProviderFetch
): Promise<{ service: AgentService; out: AgentOutbound[] }> {
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-autoscope-secret-"));
  tempDirs.push(secrets);
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
    settings: createProviderSettings({ dir: secrets, credentials }),
    fetchImpl,
    emit: (payload) => out.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { service, out };
}

function proposalIds(out: AgentOutbound[]): string[] {
  return out.flatMap((item) =>
    item.type === "event" && item.event.type === "proposal" ? [item.event.proposal.id] : []
  );
}

function writtenCount(out: AgentOutbound[]): number {
  return out.filter(
    (item) => item.type === "event" && (item.event as AgentEvent).type === "written"
  ).length;
}

async function readChapter(root: string): Promise<string> {
  return readFile(path.join(root, ...CHAPTER.split("/")), "utf8");
}

/** 让 bookScope 观察到当前作用域（sync 是清表的前提：它只在作用域真的变了那一下才清）。 */
function syncProbe(service: AgentService): void {
  // diffOf 内部先调 bookScope.sync() 再读表，是成本最低的一次「把当前书喂给闸门」。
  service.diffOf("__probe__");
}

describe("P0-4：自动批准按书隔离", () => {
  it("同书内 accept-session 命中：第二条提案不问自落（回归闸，修法不许把它也清掉）", async () => {
    const book = await seedBook("只有一本");
    const root = book.current()?.root ?? "";
    const { service, out } = await buildService(book, sseFetch(P1, STOP, P2, STOP));

    await service.startTurn(turn("第一条"));
    const first = proposalIds(out)[0] ?? "";
    expect(first).not.toBe("");
    const accepted = await service.decide({
      proposalId: first,
      decision: "accept-session",
      guidance: ""
    });
    expect(accepted.ok).toBe(true);

    await service.startTurn(turn("第二条"));
    // 同书内：第二条不问自落，两段都被改掉。
    const text = await readChapter(root);
    expect(text).toContain("海雾涌上来");
    expect(text).toContain("第三段，闸门在响。");
    expect(writtenCount(out)).toBe(2);
    service.dispose();
  });

  it("accept-session 跨书不得命中：B 书撞名文稿的提案必须等人确认", async () => {
    const first = await seedBook("第一本");
    const firstRoot = first.current()?.root ?? "";
    const second = await seedBook("第二本");
    const { service, out } = await buildService(first, sseFetch(P1, STOP, P1, STOP));

    await service.startTurn(turn("A 第一条"));
    const idA = proposalIds(out)[0] ?? "";
    const accepted = await service.decide({
      proposalId: idA,
      decision: "accept-session",
      guidance: ""
    });
    expect(accepted.ok).toBe(true);
    expect(await readChapter(firstRoot)).toContain("海雾涌上来");

    // 换到第二本：两本都有 chapters/01-开局.md，threadKey 于是完全相同。
    await first.open(second.current()?.root ?? "");
    syncProbe(service);
    await service.startTurn(turn("B 第一条"));

    // P0-4 症状：不修的话这里 B 书不问自落。修好后 B 书的稿子必须一个字没动。
    expect(await readChapter(second.current()?.root ?? "")).toBe(CHAPTER_TEXT);
    expect(writtenCount(out)).toBe(1);
    service.dispose();
  });

  it("accept-prefix（ruleKey）跨书不得命中：同 relPath 同类改动不许在 B 书免审", async () => {
    const first = await seedBook("第一本");
    const { service, out } = await buildService(first, sseFetch(P1, STOP, P1, STOP));

    await service.startTurn(turn("A 第一条"));
    const idA = proposalIds(out)[0] ?? "";
    const accepted = await service.decide({
      proposalId: idA,
      decision: "accept-prefix",
      guidance: ""
    });
    expect(accepted.ok).toBe(true);

    const second = await seedBook("第二本");
    await first.open(second.current()?.root ?? "");
    syncProbe(service);
    await service.startTurn(turn("B 第一条"));

    // 撞的是 `docRelPath::tool`——两本书同一篇、同一个 propose_patch。修好后不得命中。
    expect(await readChapter(second.current()?.root ?? "")).toBe(CHAPTER_TEXT);
    expect(writtenCount(out)).toBe(1);
    service.dispose();
  });

  it("换书再换回来：上一本书点出来的旧自动批准规则已被清掉（不许复活）", async () => {
    const first = await seedBook("第一本");
    const firstRoot = first.current()?.root ?? "";
    const second = await seedBook("第二本");
    const { service, out } = await buildService(first, sseFetch(P1, STOP, P3, STOP));

    await service.startTurn(turn("A 第一条"));
    const idA = proposalIds(out)[0] ?? "";
    await service.decide({ proposalId: idA, decision: "accept-session", guidance: "" });
    expect(await readChapter(firstRoot)).toContain("海雾涌上来");

    // 换到 B、让闸门观察到 B，再换回 A：这一路要把 A 的旧规则清干净。
    await first.open(second.current()?.root ?? "");
    syncProbe(service);
    await first.open(firstRoot);
    syncProbe(service);

    await service.startTurn(turn("A 又一条"));
    // 规则被清过 ⇒ 这条 P3 必须重新问人，不许借旧授权自动落盘。
    expect(await readChapter(firstRoot)).not.toContain("海雾漫过脚踝");
    expect(writtenCount(out)).toBe(1);
    service.dispose();
  });

  it("关书后旧规则被清：重新打开同一本书也不复活免审授权", async () => {
    const book = await seedBook("唯一一本");
    const root = book.current()?.root ?? "";
    const { service, out } = await buildService(book, sseFetch(P1, STOP, P3, STOP));

    await service.startTurn(turn("第一条"));
    const idA = proposalIds(out)[0] ?? "";
    await service.decide({ proposalId: idA, decision: "accept-session", guidance: "" });
    expect(await readChapter(root)).toContain("海雾涌上来");

    // 关书 ⇒ 作用域变 null；再重开同一本。旧规则必须随关书失效。
    await book.close();
    syncProbe(service);
    await book.open(root);
    syncProbe(service);

    await service.startTurn(turn("又一条"));
    expect(await readChapter(root)).not.toContain("海雾漫过脚踝");
    expect(writtenCount(out)).toBe(1);
    service.dispose();
  });
});

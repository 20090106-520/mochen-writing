/**
 * 换书即失效：按书存放的状态不许跨书活着。
 *
 * 【这一批是被真机撞出来的，不是想出来的】2026-10-06 批次 5-㉔ 要在对话区灌极端内容，
 * 探针建新书、发第一句话，稳定拿到
 *   ENOENT: no such file or directory, open '…\<新书>\.mochen\sessions\…rollout-….jsonl'
 * 而那个文件名里的 sessionId 与时间戳，是**上一轮探针跑的那本书**建出来的。
 *
 * 机制：`agent-service` 的 `threads` 记的是「threadKey → 会话相对路径」，而相对路径是
 * 相对于**当时那本书**的。两本书里只要有一篇同名文稿（新建章节的默认标题极易撞），
 * threadKey 就一模一样，于是新书里的 `threadFor` / `loadSession` 拿旧路径去读新书，
 * 在 `readSession(current.root, rel)` 上抛 ENOENT。症状不是「历史读不回来」，
 * 而是**新书里第一句话直接发不出去**，对话一条都没起来。
 *
 * 这一份夹具就是那个「两本书 + 同一篇同名文稿」的最小复现：不修的话下面每一条都红。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type AgentOutbound,
  type StartTurnInput
} from "@mochen/contracts";
import { findLatestSession, type ProviderFetch } from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/** 两本书里**同名**的一篇文稿：撞名的正是这个。 */
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-bookscope-4d1f8a2b";

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/** 一条不带工具调用的回复：够走完一轮，不碰提案与审批那条链。 */
function plainFetch(text: string): ProviderFetch {
  const enc = new TextEncoder();
  return async () => {
    const stream = (async function* () {
      yield enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      yield enc.encode(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
      );
    })();
    return { status: 200, stream, errorText: "" };
  };
}

/** 脚本化 SSE：数组元素是**一次请求**的响应，按顺序消费，用完回一条无工具的收尾。 */
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

/** 一次 propose_patch 调用：跑完一轮会留下一条待审批的提案。 */
const proposeChunks = [
  { choices: [{ delta: { reasoning_content: "先收紧开头" } }] },
  { choices: [{ delta: { content: "给你一条提案：\n" } }] },
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

function proposalId(out: AgentOutbound[]): string {
  const ids = out.flatMap((item) =>
    item.type === "event" && item.event.type === "proposal" ? [item.event.proposal.id] : []
  );
  return ids[0] ?? "";
}

/** 第一条增量之后挂住，直到 release：让「换书」能发生在轮次进行中。 */
function gatedFetch(): { fetchImpl: ProviderFetch; release: () => void } {
  const enc = new TextEncoder();
  let release = (): void => {};
  const gate = new Promise<void>((resolveGate) => {
    release = () => resolveGate();
  });
  const fetchImpl: ProviderFetch = async () => {
    const stream = (async function* () {
      yield enc.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "先说一句。" } }] })}\n\n`
      );
      await gate;
      yield enc.encode(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
      );
    })();
    return { status: 200, stream, errorText: "" };
  };
  return { fetchImpl, release: () => release() };
}

async function waitFor(predicate: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("等到了上限还没发生：这一步的前提没成立，不许拿后面的读数下结论。");
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

/** 铺一本带同名章节的书，并把它建出来、open 进去。 */
async function seedBook(title: string): Promise<{ book: BookService; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "mochen-bookscope-"));
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
  // 全开档：只读档下 host 连提案都不会生成，「换书后旧提案还在不在」那一格就无从验起。
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });
  return { book, root };
}

/** 建一个**跨两本书共用**的服务：books 换掉，服务不重建——这正是产品里的形状。 */
async function buildService(
  book: BookService,
  fetchImpl: ProviderFetch = plainFetch("收到。")
): Promise<{ service: AgentService; out: AgentOutbound[] }> {
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-bookscope-secret-"));
  tempDirs.push(secrets);
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

function sessionFiles(root: string): Promise<string[]> {
  return readdir(path.join(root, ".mochen", "sessions", "2026", "10", "01")).catch(() => []);
}

describe("换书即失效：按书状态不许跨书活着", () => {
  it("第二本书里的第一句话必须发得出去（会话建在第二本书自己名下）", async () => {
    const first = await seedBook("第一本");
    const { service, out } = await buildService(first.book);

    // 第一本：正常跑一轮，threads 里就此留下一条「会话相对路径」。
    await service.startTurn(turn("第一本里的第一句话"));
    const relInFirst = await findLatestSession(first.root, CHAPTER);
    expect(relInFirst).not.toBeNull();

    // 换到第二本——两本都有同一篇 chapters/01-开局.md，threadKey 于是完全相同。
    const second = await seedBook("第二本");
    await first.book.open(second.root);

    // 这就是真机症状所在的那一句：刚打开一本书就发第一句话。
    await expect(service.startTurn(turn("第二本里的第一句话"))).resolves.toBeTruthy();

    const relInSecond = await findLatestSession(second.root, CHAPTER);
    expect(relInSecond).not.toBeNull();
    // 不许是「读了第一本那份」——两本书的会话必须各自独立落盘。
    expect(relInSecond).not.toBe(relInFirst);
    expect(await sessionFiles(second.root)).toHaveLength(1);
    // 第一本那份一个字节都不该被动过。
    expect(await sessionFiles(first.root)).toHaveLength(1);
    expect(
      // 用 flatMap 而不是 filter：&& 的过滤不会把联合类型收窄，`.status` 取不到。
      out.flatMap((o) => (o.type === "turn-end" && o.threadKey === CHAPTER ? [o.status] : []))
    ).toEqual(["done", "done"]);
    service.dispose();
  });

  it("换书之后 loadSession 如实说「这本书里没有这条线程的历史」，而不是抛 ENOENT", async () => {
    const first = await seedBook("第一本");
    const { service } = await buildService(first.book);
    await service.startTurn(turn("先说一句"));
    const cached = await service.loadSession(CHAPTER);
    expect(cached.found).toBe(true);

    const second = await seedBook("第二本");
    await first.book.open(second.root);

    // 上一本书那条线程的 rel 在新书里不存在。这里该走的是「没有历史」，
    // 而不是把一个跨书的路径喂给 readSession 炸出 ENOENT（真机日志里就是这么挂的）。
    const after = await service.loadSession(CHAPTER);
    expect(after.found).toBe(false);
    // 断言 found:false 之后仍要把联合收窄显式写出来：found:true 的那一支上没有 reason，
    // tsc 不会因为上面那行 expect 就替你收窄。
    if (after.found) throw new Error("新书里读回了上一本文档的线程");
    expect(after.reason).toBe("no-session");
    service.dispose();
  });

  it("同一本书内连着跑仍然复用同一条会话（这条闸门不许把正常行为也一起清掉）", async () => {
    const one = await seedBook("只有一本");
    const { service } = await buildService(one.book);
    await service.startTurn(turn("第一句"));
    const first = await findLatestSession(one.root, CHAPTER);
    await service.startTurn(turn("第二句"));
    const second = await findLatestSession(one.root, CHAPTER);
    expect(second).toBe(first);
    expect(await sessionFiles(one.root)).toHaveLength(1);
    service.dispose();
  });

  it("换书之后上一本书待审批的提案不许在第二本书里批准（第二本的稿子一个字节都不许动）", async () => {
    const first = await seedBook("第一本");
    const { service, out } = await buildService(first.book, sseFetch(proposeChunks));
    await service.startTurn(turn("改紧一点"));
    const pid = proposalId(out);
    expect(pid).not.toBe("");
    expect(service.diffOf(pid)).toContain("+海雾涌上来");

    const second = await seedBook("第二本");
    await first.book.open(second.root);

    // 提案绑在上一本书的某一篇稿子上。换书之后它必须连同差异一起失效——
    // 否则用户在第二本书里点「采纳」，写进去的是第一本书的基线算出来的补丁。
    // 【用例自身的坑，留档】第一版把 diffOf 的断言写在 decide 之前，而 diffOf 自己也会
    // syncBookScope——于是它顺手把 pending 清了，decide 那边自然「恰好」是对的。
    // 探针和实现互相顶住时，绿是假的。所以 decide 先问，它不许借 diffOf 的力。
    const result = await service.decide({ proposalId: pid, decision: "accept-once", guidance: "" });
    expect(result.ok).toBe(false);
    expect(service.diffOf(pid)).toBe("");
    expect(await readFile(path.join(second.root, CHAPTER), "utf8")).toBe(CHAPTER_TEXT);
    expect(await readFile(path.join(first.root, CHAPTER), "utf8")).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  it("换书之后差异卡片当场读空（diffOf 自己也必须先 sync，不许借 decide 的力）", async () => {
    const first = await seedBook("第一本");
    const { service, out } = await buildService(first.book, sseFetch(proposeChunks));
    await service.startTurn(turn("改紧一点"));
    const pid = proposalId(out);
    expect(service.diffOf(pid)).toContain("+海雾涌上来");

    const second = await seedBook("第二本");
    await first.book.open(second.root);

    // 【为什么这条要单独立一个用例】在「换书后不许批准」那条里，把 diffOf 的断言写在 decide 之后，
    // 就会由 decide 先 sync 掉 diffs，于是 diffOf 拿到的空串是 decide 的功劳——
    // 变异把 diffOf 里的 syncBookScope 删掉，那条用例照样全绿（第一轮变异实测：N5 漏网）。
    // 探针与实现同源时，绿得没有意义。所以这里让 diffOf 做**第一个**动作。
    expect(service.diffOf(pid)).toBe("");
    service.dispose();
  });

  it("轮次跑到一半换书：这一轮不许把对话写进新书（那等于凭空造一段不存在的历史）", async () => {
    const first = await seedBook("第一本");
    const gate = gatedFetch();
    const { service, out } = await buildService(first.book, gate.fetchImpl);

    // 发出去，不等：要让「换书」发生在这一轮**进行中**。
    // 【等的是什么，别等错】`message` 事件要等模型把这段话**说完**才发，而夹具正卡在半截，
    // 等它等于等一个永远不会来的东西。进行中的信号是 turn-start 与逐字 delta。
    const running = service.startTurn(turn("说一句"));
    await waitFor(() => out.some((o) => o.type === "delta"));

    const second = await seedBook("第二本");
    await first.book.open(second.root);
    gate.release();
    await running;

    // 事件早于换书就已经发出去了（那是对用户可见的，不该拦），
    // 但落盘目标属于上一本书：新书里一个字都不许多。
    expect(await sessionFiles(second.root)).toEqual([]);
    expect(await sessionFiles(first.root)).toHaveLength(1);
    service.dispose();
  });
});

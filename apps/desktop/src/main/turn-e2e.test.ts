// Task 15 Step 3：全链端到端 —— 真 `streamChat` + 真 `ToolHost` + 真 fs-store 写盘与备份，
// 对端是**子进程 spawn 的 `tools/mock-provider.mjs`**（真实 socket，不是 in-process 假 fetch）。
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  type AgentEvent,
  type AgentOutbound,
  type StartTurnInput
} from "@mochen/contracts";
import { findLatestSession, readSession, type ProviderFetch } from "@mochen/agent-runtime";
import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, defaultPromptFor, type AgentService } from "./agent-service.js";
import { toProviderFetch } from "./provider-fetch.js";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n";
const API_KEY = "sk-e2e-canary-4f9d1c";

let port = 0;
let child: ReturnType<typeof spawn> | null = null;
const tempDirs: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const value = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(value));
    });
  });
}

beforeAll(async () => {
  port = await freePort();
  child = spawn(
    process.execPath,
    [path.join(ROOT, "tools", "mock-provider.mjs"), "--port", String(port), "--doc", CHAPTER],
    { stdio: "ignore" }
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__health`);
      if (response.ok) return;
    } catch {
      // 还没起来
    }
    await sleep(50);
  }
  throw new Error(`mock provider 没能在端口 ${port} 起来`);
});

afterAll(async () => {
  child?.kill();
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

interface Built {
  dir: string;
  secretDir: string;
  service: AgentService;
  book: BookService;
  settings: Awaited<ReturnType<typeof createProviderSettings>>;
  outbound: AgentOutbound[];
}

async function build(): Promise<Built> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-e2e-"));
  const secretDir = await mkdtemp(path.join(tmpdir(), "mochen-e2e-secret-"));
  tempDirs.push(dir, secretDir);
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
  // 落到「全开」：只读档下审批这一步根本走不到写盘，验不到备份
  await book.saveMeta({ ...opened.meta, permissionMode: "full-access" });
  // 假 cipher 也必须做**单向可见**的编码：base64url 里含密钥的全部字节，
  // 但磁盘上不出现明文子串——这样「文件里没有明文密钥」这条断言才有可失败性
  // （换成恒等 cipher 时它是必然红的，换成简报里那版 `enc:${plain}` 它也必然红）。
  const credentials = createCredentialStore(secretDir, {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => Buffer.from(text.slice(4), "base64url").toString("utf8")
  });
  const settings = createProviderSettings({ dir: secretDir, credentials });
  // 生产形状：密钥随 ProviderDraft 进 settings.save，由它内部走 credentials（先密钥后 config）
  await settings.save({
    baseURL: `http://127.0.0.1:${port}/v1`,
    model: "mochen-mock",
    apiKey: API_KEY
  });
  const outbound: AgentOutbound[] = [];
  let counter = 0;
  const fetchImpl: ProviderFetch = toProviderFetch((input) =>
    fetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      signal: input.signal
    })
  );
  const service = createAgentService({
    book,
    settings,
    fetchImpl,
    emit: (payload) => outbound.push(payload),
    newId: () => `id${(counter += 1)}`,
    isoNow: () => "2026-10-01T08:00:00.000Z",
    promptFor: defaultPromptFor
  });
  return { dir, secretDir, service, book, settings, outbound };
}

function turn(docRelPath: string | null, userText: string): StartTurnInput {
  return { threadKey: docRelPath ?? "unbound", docRelPath, stageId: "draft", userText };
}

function eventsOf(list: AgentOutbound[]): AgentEvent[] {
  return list.flatMap((item) => (item.type === "event" ? [item.event] : []));
}

function proposalIds(list: AgentOutbound[]): string[] {
  return eventsOf(list).flatMap((event) => (event.type === "proposal" ? [event.proposal.id] : []));
}

function lastTurnEnd(list: AgentOutbound[]) {
  return list
    .slice()
    .reverse()
    .find((item): item is Extract<AgentOutbound, { type: "turn-end" }> => item.type === "turn-end");
}

function absOf(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

/** 目录里所有文本文件的内容拼起来：密钥泄漏面按「整棵树」判，不按单个文件名判。 */
async function allText(root: string): Promise<string> {
  let out = "";
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out += await allText(full);
    else out += await readFile(full, "utf8").catch(() => "");
  }
  return out;
}

describe("端到端：模型 → 提案 → 审批 → 写盘", () => {
  it("文本块协议产出的提案，批准后真的写进文件并留下原稿备份", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "用文本块提案"));
    const ids = proposalIds(outbound);
    expect(ids.length).toBe(1);
    // 这一条钉的是「提案真的来自文本块这条路」，不是原生 tool_calls 的重复覆盖
    const proposal = eventsOf(outbound).find((event) => event.type === "proposal");
    expect(proposal && proposal.type === "proposal" ? proposal.proposal.source : "").toBe(
      "text-block"
    );
    const before = await readFile(absOf(dir, CHAPTER), "utf8");
    expect(before).toBe(CHAPTER_TEXT);
    const result = await service.decide({
      proposalId: ids[0] ?? "",
      decision: "accept-once",
      guidance: ""
    });
    if (!result.ok) throw new Error(`批准失败：${result.message}`);
    const after = await readFile(absOf(dir, CHAPTER), "utf8");
    expect(after).toContain("海雾涌上来，铁锈味很冲。");
    if (result.backupRelPath === null) throw new Error("写入前必须有备份");
    expect(result.backupRelPath.startsWith(".mochen/changes/")).toBe(true);
    const backup = await readFile(absOf(dir, result.backupRelPath), "utf8");
    expect(backup).toBe(CHAPTER_TEXT);
    const rel = await findLatestSession(dir, CHAPTER);
    if (rel === null) throw new Error("会话文件没落盘");
    const session = await readSession(dir, rel);
    expect(session.droppedLines).toEqual([]);
    expect(session.events.some((event) => event.type === "decision")).toBe(true);
    expect(session.events.some((event) => event.type === "written")).toBe(true);
    expect(lastTurnEnd(outbound)?.status).toBe("done");
    service.dispose();
  });

  it("原生 tool_calls 那一路同样只需一次批准", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    const ids = proposalIds(outbound);
    expect(ids.length).toBe(1);
    // 未批准前一个字节都不能动（模型永不直接写盘）
    expect(await readFile(absOf(dir, CHAPTER), "utf8")).toBe(CHAPTER_TEXT);
    const result = await service.decide({
      proposalId: ids[0] ?? "",
      decision: "accept-once",
      guidance: ""
    });
    expect(result.ok).toBe(true);
    const after = await readFile(absOf(dir, CHAPTER), "utf8");
    expect(after).toContain("铁锈味");
    service.dispose();
  });

  it("503 走真实 HTTP：轮次落 failed，中文原因进对话流，文件一字不动", async () => {
    const { dir, service, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "给我 503"));
    expect(lastTurnEnd(outbound)?.status).toBe("failed");
    expect(JSON.stringify(outbound)).toContain("模型服务端返回 503");
    expect(await readFile(absOf(dir, CHAPTER), "utf8")).toBe(CHAPTER_TEXT);
    expect(proposalIds(outbound)).toEqual([]);
    service.dispose();
  });

  it("密钥只进 header：书目录、密钥目录与会话 JSONL 都不含明文", async () => {
    const { dir, secretDir, service, settings, outbound } = await build();
    await service.startTurn(turn(CHAPTER, "改紧一点"));
    const ids = proposalIds(outbound);
    expect(ids.length).toBe(1);
    expect(
      (await service.decide({ proposalId: ids[0] ?? "", decision: "accept-once", guidance: "" })).ok
    ).toBe(true);
    // 先证明密钥确实参与了这一轮（否则「文件里没有它」是空断言）：
    // 桩收到过 Authorization，且服务能从盘上的密文把它读回来。
    const log = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    expect(log.some((item: { hasAuth?: boolean }) => item.hasAuth === true)).toBe(true);
    // 主进程确实把它读回来了（否则「盘上没有明文」可能只是因为压根没存）
    expect(await settings.apiKey()).toBe(API_KEY);
    const view = await settings.view();
    expect(view.keyMask).toBe(`••••${API_KEY.slice(-4)}`);
    expect(view.keyMask).not.toContain(API_KEY);
    const encFile = await readFile(path.join(secretDir, "secrets.enc"), "utf8");
    expect(encFile.length).toBeGreaterThan(0);
    expect(encFile).not.toContain(API_KEY);
    expect(await allText(dir)).not.toContain(API_KEY);
    expect(await allText(secretDir)).not.toContain(API_KEY);
    expect(JSON.stringify(outbound)).not.toContain(API_KEY);
    service.dispose();
  });

  // 简报的第四条「慢流中途 Esc：已流出的思考入库标注 interrupted，半截正文绝不写盘」
  // 在本波**没有交付**：它在真实 socket 上是红的，而且红在上游而不是这里。
  // 打断落到 provider-client.ts:146 的帧循环时，未收完的 read() 抛 AbortError
  // （只有 :126-134 的连接期守卫会把它收成 finish:aborted），异常穿过
  // tool-loop.ts:131 的 catch ⇒ turn-end 判 failed、reasoning 事件根本不会发出，
  // 于是 `events.some((e) => e.type === "reasoning" && e.interrupted)` 必假。
  // 最小复现、定位与待粘贴回的用例原文见 task-15-report.md「BLOCKED：真 socket 打断链」。
  // 按纪律在此不降级、不 skip、不写「断言现状」的替代用例。
});

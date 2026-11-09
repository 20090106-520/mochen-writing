import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  WEB_SEARCH_TOOL_NAME,
  type AgentEvent,
  type AgentOutbound,
  type SkillRef,
  type StartTurnInput
} from "@mochen/contracts";
import {
  findLatestSession,
  readSession,
  type ProviderFetch,
  type ProviderFetchInput,
  type ProviderFetchResult
} from "@mochen/agent-runtime";

import { createBookService, type BookService } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { createAgentService, type AgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";

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
}, 30000);

/**
 * 脚本化 SSE：第 n 次请求回 `rounds[n]`，脚本用完回一条 stop——
 * 一次工具调用要吃掉两个响应位（调用 + 无调用的收尾），不兜底工具循环收不了尾。
 * 顺带把每次**真正发出去的请求**记进 requests：#101 那两条验的是出站形状，
 * 「渲染层点了、主进程搬了、body 里有没有」这条链只能在这一层看见。
 */
const requests: ProviderFetchInput[] = [];

function scriptedFetch(...rounds: Record<string, unknown>[][]): ProviderFetch {
  const enc = new TextEncoder();
  const stop = { choices: [{ delta: {}, finish_reason: "stop" }] };
  let call = 0;
  return async (request) => {
    requests.push(request);
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
  options: {
    fetchImpl?: ProviderFetch;
    writeDoc?: BookService["writeDoc"];
    /** 挂入技能的读取桩（spec §11）。不给 ⇒ use_skill 读不到正文。 */
    readSkill?: (relPath: string) => Promise<{ title: string; text: string }>;
    /**
     * 技能库清单桩（P0-2）：系统提示只放清单，正文由 use_skill 按需读。
     * 不给 ⇒ 挂入的技能一律算读不到（与漏接 readSkill 同一条纪律）。
     */
    listSkills?: () => Promise<SkillRef[]>;
  } = {}
): Promise<{
  service: AgentService;
  writes: string[];
  outbound: AgentOutbound[];
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-boundary-"));
  const secrets = await mkdtemp(path.join(tmpdir(), "mochen-boundary-secret-"));
  tempDirs.push(dir, secrets);
  root = dir;
  // 每次装配都清空出站记录：读 requests[0] 的用例要的正是「我这一轮发出去的那一笔」，
  // 而不是上一条用例留下的残余。
  requests.length = 0;
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
  const provider = createProviderSettings({ dir: secrets, credentials });
  // v3：地址与密钥都按连接分份。先把连接建出来拿到 id，密钥再直接写进那一份。
  const seeded = await provider.saveConnection({
    providerId: "custom",
    baseURL: "https://mock/v1",
    authHeader: "bearer",
    thinkingWire: "standard",
    apiKey: null
  });
  const connectionId = seeded.connections[0]?.id ?? "";
  if (connectionId === "") throw new Error("连接没建起来，档案挂不上去");
  await credentials.save(connectionId, API_KEY);
  await provider.upsertProfile({ model: "test-model", connectionId });
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
    promptFor: defaultPromptFor,
    readSkill: options.readSkill,
    listSkills: options.listSkills
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

/** 提案事件所在的那条线程键：失效的 error 必须回到同一个键，否则用户在对话流里看不见它。 */
function proposalThreadKeyOf(outbound: AgentOutbound[]): string {
  for (const item of outbound)
    if (item.type === "event" && item.event.type === "proposal") return item.threadKey;
  return "";
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
      userText: "写".repeat(20001),
      thinkingLevel: "off",
      webSearchEnabled: false,
      skillPaths: [],
      sampleCount: 1
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
        userText: "写点什么",
        thinkingLevel: "off",
        webSearchEnabled: false,
        skillPaths: [],
        sampleCount: 1
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
          userText: "写点什么",
          thinkingLevel: "off",
          webSearchEnabled: false,
          skillPaths: [],
          sampleCount: 1
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
      service.startTurn({
        threadKey: "",
        docRelPath: null,
        stageId: "draft",
        userText: "随便聊聊",
        thinkingLevel: "off",
        webSearchEnabled: false,
        skillPaths: [],
        sampleCount: 1
      })
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
        userText: "随便聊聊",
        thinkingLevel: "off",
        webSearchEnabled: false,
        skillPaths: [],
        sampleCount: 1
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
        userText: "随便聊聊",
        thinkingLevel: "off",
        webSearchEnabled: false,
        skillPaths: [],
        sampleCount: 1
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
      userText: "改紧一点",
      thinkingLevel: "off",
      webSearchEnabled: false,
      skillPaths: [],
      sampleCount: 1
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
    // 路由钉（评审 T3-1 F2）：这条 error 必须发回**提案自己那条线程**——发往别的 threadKey
    // （unbound、别的章、空串）用户都看不到它，卡会被实时/回放两头念成「未处理」。
    const proposalThreadKey = proposalThreadKeyOf(outbound);
    expect(proposalThreadKey).toBe(CHAPTER);
    expect(
      outbound.some(
        (item) =>
          item.type === "event" &&
          item.threadKey === proposalThreadKey &&
          item.event.type === "error" &&
          item.event.proposalId === id
      )
    ).toBe(true);
    // 失败仍然保守：没有 written 事件，原稿一字不变
    expect(outbound.some((item) => item.type === "event" && item.event.type === "written")).toBe(
      false
    );
    expect(await chapterBytes()).toBe(CHAPTER_TEXT);
    service.dispose();
  });

  // ===== #101 每轮两枚开关：这一对字段能不能活着走到出站 body =====
  // 落在这个文件而不是 agent-service.test.ts，有两条硬理由：① 后者贴着 800 行门禁（实测 808 直接红），
  // ② 这里已有带装配的假 fetch，只是把它记请求的口子打开——再造第三份 build() 就是抄第三遍装配。
  it("思考档与联网开关原样抵达出站 body：中间任何一层漏传都在这里露头", async () => {
    const { service } = await build({ fetchImpl: scriptedFetch(proposePatchChunks) });
    await service.startTurn({
      threadKey: CHAPTER,
      docRelPath: CHAPTER,
      stageId: "draft",
      userText: "改紧一点",
      thinkingLevel: "high",
      webSearchEnabled: true,
      skillPaths: [],
      sampleCount: 1
    });
    const request = requests[0];
    if (request === undefined) throw new Error("请求必须发出");
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("high");
    const tools = body.tools as Record<string, unknown>[];
    const names = tools.map((tool) => (tool.function as { name?: string } | undefined)?.name);
    // 开 ⇒ web_search 与 web_read 以 **function** 形态在场（真能跑的那两枚：本地免费源，见 doc-tools-host.ts）。
    expect(names).toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).toContain("web_read");
    // 出站每一条都必须是完整 function 条目。2026-10-08 的裸 `{type:"web_search"}` 会让
    // 严格校验的端点回 400/422（tools[9].function: missing field `parameters`），整笔请求报废。
    expect(tools.every((tool) => tool.type === "function")).toBe(true);
    // 八枚本仓工具一枚不许被联网条目挤掉（TOOL_SPECS 是唯一真身）。
    expect(tools.filter((tool) => tool.type === "function").length).toBe(8);
    service.dispose();
  });

  it("关档 + 不联网时出站一个每轮字段都不带（默认零行为变化）", async () => {
    const { service } = await build({ fetchImpl: scriptedFetch(proposePatchChunks) });
    await service.startTurn({
      threadKey: CHAPTER,
      docRelPath: CHAPTER,
      stageId: "draft",
      userText: "改紧一点",
      thinkingLevel: "off",
      webSearchEnabled: false,
      skillPaths: [],
      sampleCount: 1
    });
    const body = JSON.parse(requests[0]?.body ?? "{}") as Record<string, unknown>;
    // 「关」的实现是不发字段，不是发 "off"：严格校验的端点会 400，这条钉住差别。
    expect(body).not.toHaveProperty("reasoning_effort");
    const tools = body.tools as Record<string, unknown>[];
    const names = tools.map((tool) => (tool.function as { name?: string } | undefined)?.name);
    // 关 ⇒ web_search 与 web_read 都真的从出站名单里消失（映射在 wireToolsFor，闸的是
    // NETWORK_TOOL_NAMES 这一整类），不是「发个 false 字段」。
    expect(names).not.toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).not.toContain("web_read");
    // 摘掉联网不牵连别的：六枚书稿/技能工具一枚不少。
    expect(names.length).toBe(6);
    service.dispose();
  });
});

/** 技能库清单里的一行（P0-2）：只有名称 / 用途 / 适用面，正文不在清单里。 */
function skillRefOf(id: string, description: string): SkillRef {
  const dirName = id.slice(id.indexOf(":") + 1);
  return {
    id,
    source: id.startsWith("global:") ? "global" : "book",
    dirName,
    displayName: dirName,
    description,
    stages: ["draft"],
    appliesTo: ["chapters"],
    relPath: `${dirName}/SKILL.md`
  };
}

describe("挂入技能（spec §11 / P0-2 渐进披露）", () => {
  const input = (skillPaths: string[]): StartTurnInput => ({
    threadKey: CHAPTER,
    docRelPath: CHAPTER,
    stageId: "draft",
    userText: "照技能改",
    thinkingLevel: "off",
    webSearchEnabled: false,
    skillPaths,
    sampleCount: 1
  });
  const BODY = "先埋线，三百字后收。";

  it("系统提示只放技能清单：名称 + 用途 + 何时用，正文留给 use_skill 按需读", async () => {
    const { service } = await build({
      listSkills: async () => [skillRefOf("book:伏笔", "埋线收线的方法")],
      // 正文桩在装配阶段一次都不该被点名：它只属于 use_skill。
      readSkill: async () => ({ title: "伏笔", text: BODY })
    });
    await service.startTurn(input(["book:伏笔"]));
    const sent = JSON.parse(requests[0]?.body ?? "{}") as { messages: { content: string }[] };
    const system = sent.messages[0]?.content ?? "";
    expect(system).toContain("伏笔");
    expect(system).toContain("埋线收线的方法");
    expect(system).toContain('use_skill("book:伏笔")');
    // 必须说清「正文没载入」，否则模型看见名字会以为方法已经读过。
    expect(system).toContain("正文没有载入");
    // 模型没打算用这份方法时，整份正文不再跟着系统提示一起发出去。
    expect(system).not.toContain(BODY);
    service.dispose();
  });

  it("清单里查不到的挂入技能 ⇒ 如实说跳过几个，其余照常进清单", async () => {
    const { service, outbound } = await build({
      listSkills: async () => [skillRefOf("book:好的", "这一条在清单里")]
    });
    await service.startTurn(input(["book:好的", "book:坏的", "book:也坏的"]));
    const errors = errorEventsOf(outbound);
    expect(errors.map((e) => e.message)).toContain("有 2 个挂入技能读不到，已跳过。");
    // 查得到的那一条照样进清单：不因为另一条坏就整轮都丢
    const sent = JSON.parse(requests[0]?.body ?? "{}") as { messages: { content: string }[] };
    expect(sent.messages[0]?.content ?? "").toContain("这一条在清单里");
    service.dispose();
  });

  it("没给清单通路（装配处漏接线）⇒ 当成一条都读不到并说出来，不静默当成「没挂技能」", async () => {
    const { service, outbound } = await build();
    await service.startTurn(input(["book:伏笔"]));
    expect(errorEventsOf(outbound).map((e) => e.message)).toContain(
      "有 1 个挂入技能读不到，已跳过。"
    );
    service.dispose();
  });
});

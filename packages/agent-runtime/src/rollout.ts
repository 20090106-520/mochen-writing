import { appendFile, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  agentEventSchema,
  sessionMetaSchema,
  type AgentEvent,
  type SessionListItem,
  type SessionMeta
} from "@mochen/contracts";
import type { ChatMessage } from "./chat-message.js";
import { assistantToolMessage, chatMessage, toolMessage } from "./chat-message.js";

/** 会话线程目录（书根相对，正斜杠）——spec §3「会话文件（照 Codex rollout 布局）」。 */
export const SESSIONS_DIR = ".mochen/sessions";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * sessionId 会被拼进文件路径，所以只认一个文件名安全的形状。
 * 越界的宁可当场拒绝，也绝不静默改名或把会话写到书目录外——调用方必须只会喂 randomUUID()。
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export function sessionRelPath(now: Date, sessionId: string): string {
  if (!SAFE_SESSION_ID.test(sessionId))
    throw new Error(
      `非法 sessionId（${JSON.stringify(sessionId)}）：只允许字母、数字与 . _ -，` +
        "会话只会落在书内的 .mochen/sessions 下。"
    );
  const y = String(now.getUTCFullYear());
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hmss = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${SESSIONS_DIR}/${y}/${m}/${d}/rollout-${y}${m}${d}-${hmss}-${sessionId}.jsonl`;
}

function abs(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

/** 建线程：首行必须是 SessionMeta，readSession 靠它判文件是否可用。 */
export async function createSession(root: string, meta: SessionMeta): Promise<string> {
  const rel = sessionRelPath(new Date(meta.startedAt), meta.sessionId);
  const target = abs(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(meta)}\n`, "utf8");
  return rel;
}

export async function appendAgentEvent(
  root: string,
  rel: string,
  event: AgentEvent
): Promise<void> {
  const target = abs(root, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
}

export interface ReadSessionResult {
  meta: SessionMeta;
  events: AgentEvent[];
  /** 被跳过的行号（1 起，首行不计入）；渲染层与 Task 13 要据此如实反映丢了什么。 */
  droppedLines: number[];
}

/** 首行坏 → 中文错误（整条线程不可信）；中间坏行 → 计入 droppedLines，不抛也不静默。 */
export async function readSession(root: string, rel: string): Promise<ReadSessionResult> {
  const raw = await readFile(abs(root, rel), "utf8");
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  const first = lines[0] ?? "";
  let meta: SessionMeta;
  try {
    meta = sessionMetaSchema.parse(JSON.parse(first));
  } catch (error) {
    throw new Error(
      `会话首行不可用（${rel}）：${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const events: AgentEvent[] = [];
  const droppedLines: number[] = [];
  for (const [offset, line] of lines.slice(1).entries()) {
    const parsed = agentEventSchema.safeParse(safeJson(line));
    if (parsed.success) events.push(parsed.data);
    else droppedLines.push(offset + 2);
  }
  return { meta, events, droppedLines };
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * 一次读这么多字节。定这个数的依据是实测，不是猜测：一条会话用得着的内容只有首行的 meta
 * 与第一条 user-message，2026-10-10 量过 200 条 / 500 条两档，两者合计 400 字节上下——
 * 一块必然装得下，于是常态是一次 read 就收手。留 16 KB 是给「首条用户输入粘了整章正文」那种
 * 会话的余量；再大就是白占内存（readRawLines 只在真有后续行时才继续读）。
 *
 * 导出只为让「块边界切进汉字中间」那条守卫用例能对着真实窗口算，不必硬编码 16384。
 */
export const HEAD_CHUNK = 16 * 1024;

/**
 * 按块产出文件的**原始行**（不滤空行、不设长度上限：没人接就一路产到文件尽头）。
 *
 * 存在的唯一理由：P1-5 那三处「只为拿首行/标题却整篇读进内存」。调用方 `break` 出去时
 * for-await 会触发本生成器的 return()，`finally` 当场关句柄——没读的尾部一个字节都不进内存。
 * 与 `raw.split("\n")` 逐字同口径：`\r` 留在行尾、空行照样产出、末尾没有换行时那半截也产出。
 * 多字节汉字被块边界劈开时靠 `TextDecoder({stream:true})` 续上，绝不出现替换符。
 */
async function* readRawLines(file: string): AsyncGenerator<string> {
  const handle: FileHandle = await open(file, "r");
  try {
    const decoder = new TextDecoder("utf-8");
    const buffer = Buffer.alloc(HEAD_CHUNK);
    let position = 0;
    let pending = "";
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, HEAD_CHUNK, position);
      position += bytesRead;
      if (bytesRead === 0) {
        pending += decoder.decode(); // 收尾：把停在流里的最后半个字吐出来
        if (pending !== "") yield pending;
        return;
      }
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      for (let cut = pending.indexOf("\n"); cut >= 0; cut = pending.indexOf("\n")) {
        yield pending.slice(0, cut);
        pending = pending.slice(cut + 1);
      }
    }
  } finally {
    await handle.close();
  }
}

/**
 * 只取首行（**不滤空行**——与旧的 `readFile().split("\n")[0]` 逐字同口径）。
 * 读不到（文件在 readdir 之后被人删了、正被占用）回空串，与旧实现那句 `.catch(() => "")` 一样：
 * 调用方拿它去过 schema，失败即跳过这一条，绝不整本抛。
 */
async function readFirstLine(file: string): Promise<string> {
  try {
    for await (const line of readRawLines(file)) return line;
    return "";
  } catch {
    return "";
  }
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  if (!(await exists(dir))) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsonl(full);
    else if (entry.name.endsWith(".jsonl")) yield full;
  }
}

async function exists(dir: string): Promise<boolean> {
  return (
    (await readdir(dir).then(
      () => true,
      () => false
    )) === true
  );
}

/** startedAt 相同时以相对路径兜底定序：readdir 的顺序不受保证，不能靠它决定「最近」。 */
function isMoreRecent(
  candidate: { rel: string; startedAt: string },
  best: { rel: string; startedAt: string }
): boolean {
  if (candidate.startedAt !== best.startedAt) return candidate.startedAt > best.startedAt;
  return candidate.rel > best.rel;
}

/** 该章最近一条线程；「每章一条线程」的定位就靠这个函数。 */
export async function findLatestSession(root: string, docRelPath: string): Promise<string | null> {
  let best: { rel: string; startedAt: string } | null = null;
  for await (const file of walkJsonl(path.join(root, ...SESSIONS_DIR.split("/")))) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    // 只读首行（P1-5）：过去为拿这一行把整条会话读进内存，一条线程写到 1500 个事件时放大 681 倍。
    const parsed = sessionMetaSchema.safeParse(safeJson(await readFirstLine(file)));
    if (!parsed.success || parsed.data.docRelPath !== docRelPath) continue;
    const candidate = { rel, startedAt: parsed.data.startedAt };
    if (best === null || isMoreRecent(candidate, best)) best = candidate;
  }
  return best?.rel ?? null;
}

/** 标题只有一行：面板宽度照他的 370px，超长交给 CSS ellipsis，这里按字符数硬截。 */
const TITLE_MAX = 60;

/**
 * 这一行是「首条用户输入」吗？是就折成一行标题，不是回 null（**由调用方决定要不要再读下一行**）。
 *
 * 拆成一行的判据而不是整篇遍历，是为了让 readSessionHead 能在拿到标题的那一刻收手；
 * 这条判据本身仍然只有一份——原来那个 `titleFromLines(lines)` 版本删掉了，不留第二个口径。
 */
function titleOfLine(line: string): string | null {
  const parsed = agentEventSchema.safeParse(safeJson(line));
  if (!parsed.success || parsed.data.type !== "user-message") return null;
  const flat = parsed.data.text.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX ? flat.slice(0, TITLE_MAX) : flat;
}

/**
 * 读一条会话**用得着的那几行**：首行 meta，加上第一条用户输入（标题）。
 * 三种收手，每种都对应旧整篇读的一个结论：
 * ① 首行过不了 sessionMetaSchema ⇒ null（这一条本来就跳过，后面一行都不必读）；
 * ② 拿到标题 ⇒ 当场返回（过去的实现要把剩下几 MB 读完才肯停）；
 * ③ 读到尽头也没有用户输入 ⇒ 标题是空串，不拿章名或模型名冒充。
 * 空行照样滤掉、`\r` 留在行尾——与旧的 `split("\n").filter(非空)` 逐字同口径。
 */
async function readSessionHead(file: string): Promise<{ meta: SessionMeta; title: string } | null> {
  try {
    let meta: SessionMeta | null = null;
    for await (const line of readRawLines(file)) {
      if (line.trim() === "") continue;
      if (meta === null) {
        const parsed = sessionMetaSchema.safeParse(safeJson(line));
        if (!parsed.success) return null;
        meta = parsed.data;
        continue;
      }
      const title = titleOfLine(line);
      if (title !== null) return { meta, title };
    }
    // 走完全篇：全空行的文件等于没有首行（旧实现是 safeParse("") 失败）⇒ 跳过。
    if (meta === null) return null;
    return { meta, title: "" };
  } catch {
    return null; // 读不到只跳过这一条会话，不让整个面板打不开
  }
}

/**
 * 书内会话总览（#113e「历史对话」面板的数据源）：扫 `.mochen/sessions` 下全部 rollout，
 * 首行过不了 sessionMetaSchema 的文件只跳过、不抛——与 findLatestSession 同口径，
 * 一份坏会话不该让整个面板打不开。
 */
export async function listSessions(root: string): Promise<SessionListItem[]> {
  const found: { rel: string; item: SessionListItem }[] = [];
  for await (const file of walkJsonl(path.join(root, ...SESSIONS_DIR.split("/")))) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const head = await readSessionHead(file);
    if (head === null) continue;
    const { sessionId, docRelPath, model, startedAt } = head.meta;
    found.push({ rel, item: { sessionId, docRelPath, model, startedAt, title: head.title } });
  }
  // 排序复用 isMoreRecent：「谁更新」的比较口径只许有一份实现（铁律 6），
  // 否则面板的「最近」和 threadFor 复用的那一条迟早会判给不同的会话。
  found.sort((a, b) => {
    const left = { rel: a.rel, startedAt: a.item.startedAt };
    const right = { rel: b.rel, startedAt: b.item.startedAt };
    if (isMoreRecent(left, right)) return -1;
    if (isMoreRecent(right, left)) return 1;
    return 0;
  });
  return found.map((entry) => entry.item);
}

/**
 * 按 sessionId 定位某条线程的会话文件（#113e：面板点开某一条历史）。
 * 必须同时匹配 docRelPath——会话归属以盘上的 meta 为准，不能让 A 章的那一行去打开 B 章的会话；
 * 首行坏的文件只跳过，与 findLatestSession / listSessions 同口径。
 */
export async function findSessionById(
  root: string,
  docRelPath: string,
  sessionId: string
): Promise<string | null> {
  if (sessionId === "") return null;
  for await (const file of walkJsonl(path.join(root, ...SESSIONS_DIR.split("/")))) {
    const parsed = sessionMetaSchema.safeParse(safeJson(await readFirstLine(file)));
    if (!parsed.success) continue;
    if (parsed.data.docRelPath !== docRelPath || parsed.data.sessionId !== sessionId) continue;
    return path.relative(root, file).replaceAll("\\", "/");
  }
  return null;
}

/**
 * 事件序列 → 下一轮请求的 messages。设计决定 3：审批结果与带说明的拒绝都以 user 角色回喂，
 * plan / error / interrupted 只供 UI，不进模型历史（它们不是对话内容）。
 */
export function eventsToMessages(events: AgentEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const event of events) {
    switch (event.type) {
      case "user-message":
        out.push(chatMessage("user", event.text));
        break;
      case "reasoning":
        if (event.text.trim() !== "")
          out.push(chatMessage("assistant", `（思考摘要）${event.text}`));
        break;
      case "message":
        if (event.text.trim() !== "") out.push(chatMessage("assistant", event.text));
        break;
      case "tool-call":
        out.push(
          assistantToolMessage("", [{ id: event.callId, name: event.tool, args: event.args }])
        );
        out.push(toolMessage(event.callId, event.resultText));
        break;
      case "decision":
        if (event.decision === "deny-with-guidance")
          out.push(chatMessage("user", `（用户对上一条提案的意见：${event.guidance}）`));
        break;
      case "written":
        out.push(
          chatMessage(
            "user",
            `（审批结果：已写入 ${event.docRelPath}，原稿备份在 ${event.backupRelPath ?? "（新文件，无备份）"}。）`
          )
        );
        break;
      default:
        break;
    }
  }
  return out;
}

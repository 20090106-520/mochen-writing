import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
    const head = (await readFile(file, "utf8").catch(() => "")).split("\n")[0] ?? "";
    const parsed = sessionMetaSchema.safeParse(safeJson(head));
    if (!parsed.success || parsed.data.docRelPath !== docRelPath) continue;
    const candidate = { rel, startedAt: parsed.data.startedAt };
    if (best === null || isMoreRecent(candidate, best)) best = candidate;
  }
  return best?.rel ?? null;
}

/** 标题只有一行：面板宽度照他的 370px，超长交给 CSS ellipsis，这里按字符数硬截。 */
const TITLE_MAX = 60;

/** 首条 user-message 折成一行做标题；这条会话里没有用户输入时是空串，不拿章名或模型名冒充。 */
function titleFromLines(lines: string[]): string {
  for (const line of lines.slice(1)) {
    const parsed = agentEventSchema.safeParse(safeJson(line));
    if (parsed.success && parsed.data.type === "user-message") {
      const flat = parsed.data.text.replace(/\s+/g, " ").trim();
      return flat.length > TITLE_MAX ? flat.slice(0, TITLE_MAX) : flat;
    }
  }
  return "";
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
    const raw = await readFile(file, "utf8").catch(() => "");
    const lines = raw.split("\n").filter((line) => line.trim() !== "");
    const parsed = sessionMetaSchema.safeParse(safeJson(lines[0] ?? ""));
    if (!parsed.success) continue;
    const { sessionId, docRelPath, model, startedAt } = parsed.data;
    found.push({
      rel,
      item: { sessionId, docRelPath, model, startedAt, title: titleFromLines(lines) }
    });
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
    const raw = await readFile(file, "utf8").catch(() => "");
    const parsed = sessionMetaSchema.safeParse(safeJson(raw.split("\n")[0] ?? ""));
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

import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  agentEventSchema,
  sessionMetaSchema,
  type AgentEvent,
  type SessionMeta
} from "@mochen/contracts";
import type { ChatMessage } from "./chat-message.js";
import { assistantToolMessage, chatMessage, toolMessage } from "./chat-message.js";

/** 会话线程目录（书根相对，正斜杠）——spec §3「会话文件（照 Codex rollout 布局）」。 */
export const SESSIONS_DIR = ".mochen/sessions";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function sessionRelPath(now: Date, sessionId: string): string {
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

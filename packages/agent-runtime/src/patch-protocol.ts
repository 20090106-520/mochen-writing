import type { PatchMode } from "@mochen/contracts";

export interface RawPatchBlock {
  doc: string;
  mode: PatchMode;
  anchor: string;
  replace: string;
  why: string;
}

export interface ProtocolProblem {
  reason: "bad-json" | "missing-field" | "unclosed-fence";
  detail: string;
}

export interface ProtocolParseResult {
  patches: RawPatchBlock[];
  planItems: string[];
  problems: ProtocolProblem[];
  prose: string;
}

const FENCE = /^ {0,3}(`{3,})\s*([A-Za-z0-9_-]*)\s*$/;
const PATCH_KIND = "mochen-patch";
const PLAN_KIND = "mochen-plan";

export const protocolBlockHint =
  "需要改稿时，输出一个 ```mochen-patch 代码块，内含一个 JSON 对象：" +
  '{"doc":"相对路径","anchor":"被替换的原文片段","replace":"新文本","why":"中文理由"}。' +
  "整篇重写时改用 " +
  '{"doc":"相对路径","mode":"doc-overwrite","replace":"新文本","why":"中文理由"}。' +
  "anchor 必须在文中唯一出现；不确定时先用 read_doc 读全文。" +
  "要列步骤时用 ```mochen-plan 块，内含 " +
  '{"items":["第一步","第二步"]}。';

function required(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

/**
 * 解析围栏正文里的 JSON：从第一条行前缀开始逐行加长尝试解析，第一条能解析的
 * JSON 值即协议载荷；其后模型残留的杂项行（如 `{"继续":"忽略"}`）按约定忽略。
 * 整段都解析不了才抛错，由调用方记 bad-json。
 */
function parseBody(body: string): unknown {
  const bodyLines = body.split("\n");
  for (let taken = 1; taken <= bodyLines.length; taken += 1) {
    try {
      return JSON.parse(bodyLines.slice(0, taken).join("\n"));
    } catch {
      // 前缀还不是完整 JSON，继续加一行
    }
  }
  throw new SyntaxError("mochen 协议块正文不是合法 JSON");
}

function toPatch(raw: unknown): RawPatchBlock | string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "bad-json";
  const object = raw as Record<string, unknown>;
  const mode = object.mode === "doc-overwrite" ? "doc-overwrite" : "anchor-replace";
  const keys =
    mode === "doc-overwrite"
      ? (["doc", "replace", "why"] as const)
      : (["doc", "anchor", "replace", "why"] as const);
  for (const key of keys) {
    if (required(object, key) === null) return key;
  }
  const anchor = object.anchor;
  return {
    doc: required(object, "doc") ?? "",
    mode,
    anchor: typeof anchor === "string" ? anchor : "",
    replace: required(object, "replace") ?? "",
    why: required(object, "why") ?? ""
  };
}

function toPlanItems(raw: unknown): string[] | string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "bad-json";
  const items = (raw as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0) return "items";
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || item.trim() === "") return "items";
    out.push(item.trim());
  }
  return out;
}

export function parseProtocolBlocks(text: string): ProtocolParseResult {
  const patches: RawPatchBlock[] = [];
  const planItems: string[] = [];
  const problems: ProtocolProblem[] = [];
  const prose: string[] = [];
  const lines = text.split("\n");

  let open: { marker: string; kind: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = FENCE.exec(line);
    if (open !== null) {
      if (
        match !== null &&
        (match[1]?.length ?? 0) >= open.marker.length &&
        (match[2] ?? "") === ""
      ) {
        const kind = open.kind;
        const body = open.body.join("\n");
        open = null;
        let payload: unknown;
        try {
          payload = parseBody(body);
        } catch {
          problems.push({ reason: "bad-json", detail: body.slice(0, 80) });
          continue;
        }
        if (kind === PATCH_KIND) {
          const patch = toPatch(payload);
          if (typeof patch === "string") {
            problems.push({
              reason: patch === "bad-json" ? "bad-json" : "missing-field",
              detail: patch
            });
          } else {
            patches.push(patch);
          }
        } else {
          const items = toPlanItems(payload);
          if (typeof items === "string") {
            problems.push({
              reason: items === "bad-json" ? "bad-json" : "missing-field",
              detail: items
            });
          } else {
            planItems.push(...items);
          }
        }
        continue;
      }
      open.body.push(line);
      continue;
    }
    if (match !== null && (match[2] === PATCH_KIND || match[2] === PLAN_KIND)) {
      open = { marker: match[1] ?? "```", kind: match[2] ?? "", body: [] };
      continue;
    }
    prose.push(line);
  }
  if (open !== null) {
    problems.push({ reason: "unclosed-fence", detail: open.kind });
    prose.push(...open.body);
  }
  return {
    patches,
    planItems,
    problems,
    prose: prose
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  };
}

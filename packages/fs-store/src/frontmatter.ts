type FrontmatterData = Record<string, string | string[]>;

const FENCE = "---";
const BOM = "\uFEFF";

export function parseFrontmatter(raw: string): { data: FrontmatterData; body: string } {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (!text.startsWith(`${FENCE}\n`)) return { data: {}, body: text };
  const lines = text.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === FENCE) {
      close = i;
      break;
    }
  }
  if (close === -1) return { data: {}, body: text };
  return { data: parsePairs(lines.slice(1, close)), body: lines.slice(close + 1).join("\n") };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const lines = [FENCE];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else lines.push(`${key}: ${value}`);
  }
  lines.push(FENCE, body);
  return lines.join("\n");
}

function parsePairs(lines: string[]): FrontmatterData {
  const data: FrontmatterData = {};
  let pendingList: { key: string; items: string[] } | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = /^\s+- (.*)$/.exec(line);
    if (item && pendingList) {
      pendingList.items.push(item[1] ?? "");
      continue;
    }
    if (pendingList) {
      data[pendingList.key] = pendingList.items;
      pendingList = null;
    }
    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1] ?? "";
    const inline = (pair[2] ?? "").trim();
    if (inline === "") pendingList = { key, items: [] };
    else data[key] = inline;
  }
  if (pendingList) data[pendingList.key] = pendingList.items;
  return data;
}

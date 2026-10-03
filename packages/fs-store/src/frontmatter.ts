import { FRONTMATTER_FENCE, splitFrontmatter } from "@mochen/contracts";

type FrontmatterData = Record<string, string | string[]>;

/**
 * \u952E\u503C\u89E3\u6790\u7559\u5728\u8FD9\u91CC\uFF0C**\u56F4\u680F\u5207\u5206\u4E0D\u5728\u8FD9\u91CC**\uFF1A`---` \u90A3\u9053\u89C4\u5219\u7684\u552F\u4E00\u771F\u8EAB\u662F `contracts/frontmatter.ts`\uFF0C
 * \u6E32\u67D3\u5C42\u9875\u811A\u7B97\u300C\u6B63\u6587\u5B57\u6570\u300D\u65F6\u8BFB\u7684\u662F\u540C\u4E00\u4EFD \u21D2 \u300C\u4EC0\u4E48\u7B97\u5143\u6570\u636E\u300D\u5168\u4ED3\u4E00\u53E5\u8BDD\uFF08\u65E7\u7248\u8FD9\u91CC\u81EA\u5DF1\u8BA4\u4E00\u904D\u56F4\u680F\uFF0C
 * \u4E8E\u662F\u9875\u811A\u628A `---` \u4E0E `title:` \u6570\u6210\u4E86\u5B57\uFF0C\u4E0E\u4E66\u5361\u4E0A\u7684\u5B57\u6570\u5BF9\u4E0D\u4E0A\uFF09\u3002
 */
export function parseFrontmatter(raw: string): { data: FrontmatterData; body: string } {
  const { block, body } = splitFrontmatter(raw);
  if (block === null) return { data: {}, body };
  return { data: parsePairs(block.split("\n").slice(1, -1)), body };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const lines = [FRONTMATTER_FENCE];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else lines.push(`${key}: ${value}`);
  }
  lines.push(FRONTMATTER_FENCE, body);
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

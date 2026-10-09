import type { BibleEntry, BibleEntryType } from "../stores/useStoryBibleStore";

/**
 * 故事圣经条目的形状校验（2026-10-09 扫描总单 P0-7）。
 *
 * 与 `note-shape` 同一条标准：**认不得的形状判读不懂（null），只是缺了后加字段的补默认值放行**。
 * 判反的代价是二次丢数据——把一份读不懂的 `story-bible.json` 当空库，作者新建一条人物
 * 就把整份设定盖掉了；反过来把老版本判成读不懂，等于打开自己的书却看见设定消失。
 *
 * 逐条判 null 而不是丢掉那一条：悄悄少一条就是替用户删了一条，而屏上什么都不会说。
 * 唯一允许"降级"的是两枚纯显示字段——`importance` 认不得就不带（档没了不影响正文），
 * `color` 不是字符串就不带；它们坏了不代表整份文件不是我们的。
 */

const ENTRY_TYPES: readonly BibleEntryType[] = ["character", "location", "timeline"];
const IMPORTANCES = ["high", "medium", "low"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timeOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "");
}

/**
 * 可选的字符串字段，三档分开：没写 → `undefined`（不带这格）；写了但是空串 → 视同没写；
 * 写了且不是字符串 → `null`（判整份读不懂）。
 */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return value === "" ? undefined : value;
}

/**
 * 可选的字符串表，两档：没写 → `undefined`（不带这格）；写了但不是表 → `null`（判整份读不懂）。
 * 表里混进来的非字符串元素按 `tags` 同法**丢掉**——一格脏别名不是整份文件坏掉。
 */
function optionalTextList(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function normalizeBibleEntries(parsed: unknown): BibleEntry[] | null {
  if (!Array.isArray(parsed)) return null;
  const entries: BibleEntry[] = [];
  for (const raw of parsed) {
    if (!isRecord(raw)) return null;
    const { id, type, title } = raw;
    if (typeof id !== "string" || id === "") return null;
    if (typeof type !== "string" || !ENTRY_TYPES.includes(type as BibleEntryType)) return null;
    if (typeof title !== "string") return null;
    if (raw.content !== undefined && typeof raw.content !== "string") return null;
    const aliases = optionalTextList(raw.aliases);
    const role = optionalText(raw.role);
    const parentLocation = optionalText(raw.parentLocation);
    const eventDate = optionalText(raw.eventDate);
    if (aliases === null || role === null || parentLocation === null || eventDate === null) {
      return null;
    }
    const entry: BibleEntry = {
      id,
      type: type as BibleEntryType,
      title,
      content: typeof raw.content === "string" ? raw.content : "",
      createdAt: timeOf(raw.createdAt),
      updatedAt: timeOf(raw.updatedAt),
      tags: tagsOf(raw.tags),
      archived: raw.archived === true
    };
    if (typeof raw.color === "string" && raw.color !== "") entry.color = raw.color;
    if (aliases !== undefined) entry.aliases = aliases;
    if (role !== undefined) entry.role = role;
    if (parentLocation !== undefined) entry.parentLocation = parentLocation;
    if (eventDate !== undefined) entry.eventDate = eventDate;
    if (
      typeof raw.importance === "string" &&
      (IMPORTANCES as readonly string[]).includes(raw.importance)
    ) {
      entry.importance = raw.importance as (typeof IMPORTANCES)[number];
    }
    entries.push(entry);
  }
  return entries;
}

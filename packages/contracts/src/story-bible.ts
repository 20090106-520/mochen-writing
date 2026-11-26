/**
 * 故事圣经条目的形状与校验（2026-10-09 扫描总单 P0-7；2026-11-08 W-01 从渲染层下沉到 contracts）。
 *
 * 为什么下沉：渲染层的 `utils/bible-shape.ts` 与主进程的上下文装配都要认同一份
 * `.mochen/data/story-bible.json`。两份解析器一旦分叉，就会出现「面板里看得见的设定，
 * AI 读不到」或者反过来——那正是 W-01 要治的病。类型与归一化只住这一处（铁律 6）。
 *
 * 与 `note-shape` 同一条标准：**认不得的形状判读不懂（null），只是缺了后加字段的补默认值放行**。
 * 判反的代价是二次丢数据——把一份读不懂的 `story-bible.json` 当空库，作者新建一条人物
 * 就把整份设定盖掉了；反过来把老版本判成读不懂，等于打开自己的书却看见设定消失。
 *
 * 逐条判 null 而不是丢掉那一条：悄悄少一条就是替用户删了一条，而屏上什么都不会说。
 * 唯一允许"降级"的是两枚纯显示字段——`importance` 认不得就不带（档没了不影响正文），
 * `color` 不是字符串就不带；它们坏了不代表整份文件不是我们的。
 */

/** 故事圣经只认这三类：人物、地点、时间线（世界观/势力住在文稿树里，不在这份 JSON）。 */
export type BibleEntryType = "character" | "location" | "timeline";

export interface BibleEntry {
  id: string;
  type: BibleEntryType;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  color?: string;
  // 人物与地点类型专属
  aliases?: string[];
  // 人物类型专属
  role?: string;
  /**
   * 人物「声音」三格（2026-11 W-09）：说话风格/口头禅、绝不会做的事、本卷变化。
   * 都是可选文本：老存档没有这三格照常读，写了才进上下文——不搞新的必填项。
   */
  voice?: string;
  taboo?: string;
  arc?: string;
  // 地点类型专属
  parentLocation?: string;
  // 时间线专属
  eventDate?: string;
  importance?: "high" | "medium" | "low";
  // 归档态
  archived?: boolean;
}

/**
 * 设定条目的**导入幂等键**（2026-11-24，系列共享设定的复制式导入）：
 * `类型:名称`（两侧都去掉空白）。同一把键也用于装配时的同档去重——
 * 「新书里已经有林夜了，再导一次同一来源不该出现两个林夜」与
 * 「装配时不把同一设定说两遍」是同一条语义，键也必须同形。
 */
export function bibleMergeKeyOf(entry: Pick<BibleEntry, "type" | "title">): string {
  return `${entry.type}:${entry.title.trim()}`;
}

export interface BibleMergeReport {
  /** 合并后的完整清单：当前书原序 + 新增按来源原序追加。 */
  merged: BibleEntry[];
  /** 真正新增的条数。 */
  added: number;
  /** 因键重合被跳过的条数——当前书里已有的设定，导入**不覆盖**它。 */
  skipped: number;
}

/**
 * 把另一本书的设定条目合并进当前书（2026-11-24）。判定住纯函数，UI 与测试共用。
 *
 * 【为什么是「跳过」不是「覆盖」】导入的场景是开续集时把前作设定带过来；当前书里
 * 那个同名条目多半是作者已经照新作改过的——被来源书的旧版冲掉等于丢稿。
 * 真想用来源版本，先删当前书那条再导（面板里两步，比一次误冲可挽回得多）。
 *
 * 【id 不撞车时保留来源书的】条目 id 是随机数且只在「本轮不带」清单里被引用；保留它，
 * 同一来源重复导入天然幂等（键重合全跳过）。若当前书已有同 id、不同名的条目
 * （例如导入后又改了名），必须给新增条目换一个本表内唯一的 id：Vue 列表、详情选中
 * 与编辑都按 id 找人，两个条目同 id 会点一个改到另一个。
 */
export function mergeBibleEntries(
  current: readonly BibleEntry[],
  incoming: readonly BibleEntry[]
): BibleMergeReport {
  const known = new Set(current.map((entry) => bibleMergeKeyOf(entry)));
  const knownIds = new Set(current.map((entry) => entry.id));
  const merged = [...current];
  let added = 0;
  let skipped = 0;
  for (const entry of incoming) {
    if (known.has(bibleMergeKeyOf(entry))) {
      skipped += 1;
      continue;
    }
    known.add(bibleMergeKeyOf(entry));
    let id = entry.id;
    for (let suffix = 1; knownIds.has(id); suffix += 1) {
      id = `${entry.id}_imported${suffix === 1 ? "" : `_${suffix}`}`;
    }
    knownIds.add(id);
    merged.push(id === entry.id ? entry : { ...entry, id });
    added += 1;
  }
  return { merged, added, skipped };
}

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
    const voice = optionalText(raw.voice);
    const taboo = optionalText(raw.taboo);
    const arc = optionalText(raw.arc);
    const parentLocation = optionalText(raw.parentLocation);
    const eventDate = optionalText(raw.eventDate);
    if (
      aliases === null ||
      role === null ||
      voice === null ||
      taboo === null ||
      arc === null ||
      parentLocation === null ||
      eventDate === null
    ) {
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
    if (voice !== undefined) entry.voice = voice;
    if (taboo !== undefined) entry.taboo = taboo;
    if (arc !== undefined) entry.arc = arc;
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

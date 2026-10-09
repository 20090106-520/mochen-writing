import type { Note } from "../stores/useNotesStore";

/**
 * 笔记库的形状校验（2026-10-09 扫描总单 P0-7）。
 *
 * 只有一个判断标准：**「读不懂」与「没有笔记」必须是两个答案**。
 * 把一份读不懂的文件判成空库，后果是用户随手加一条笔记就把整份盖掉——那是二次丢数据，
 * 比第一次严重；反过来把老版本（缺 `tags`、缺 `archived`）判成读不懂，等于用户打开自己的
 * 书却看见笔记消失了。所以：认不得的**形状**整份判 null，只是缺了后加字段的补默认值放行。
 *
 * 逐条判 null 而不是「丢掉那一条」：悄悄丢一条就是替用户删了一条笔记，而屏上什么都不会说。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 时间戳只认有限数字，其余当 0：排序会把它放到最后，但不至于让整份库打不开。 */
function timeOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "");
}

/** 认得下来就返回补全后的新数组（原对象不回写：通路拿它做快照，字段顺序必须稳定）。 */
export function normalizeNotes(parsed: unknown): Note[] | null {
  if (!Array.isArray(parsed)) return null;
  const notes: Note[] = [];
  for (const raw of parsed) {
    if (!isRecord(raw)) return null;
    const { id, kind, content } = raw;
    if (typeof id !== "string" || id === "") return null;
    if (typeof content !== "string") return null;
    if (kind !== "quick" && kind !== "annotation") return null;
    // 批注一定要绑得住那篇文稿；绑了个不是字符串的东西说明这份文件已经不是我们认识的那份了。
    if (raw.docRelPath !== undefined && typeof raw.docRelPath !== "string") return null;
    const note: Note = {
      id,
      kind,
      content,
      createdAt: timeOf(raw.createdAt),
      updatedAt: timeOf(raw.updatedAt),
      tags: tagsOf(raw.tags),
      archived: raw.archived === true
    };
    if (typeof raw.docRelPath === "string" && raw.docRelPath !== "")
      note.docRelPath = raw.docRelPath;
    if (typeof raw.lineNumber === "number" && Number.isFinite(raw.lineNumber)) {
      note.lineNumber = raw.lineNumber;
    }
    if (typeof raw.threadKey === "string" && raw.threadKey !== "") note.threadKey = raw.threadKey;
    notes.push(note);
  }
  return notes;
}

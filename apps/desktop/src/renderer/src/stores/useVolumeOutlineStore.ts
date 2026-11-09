/**
 * 卷纲 → 章纲结构化（2026-10-05，批次 5-②）的读盘与状态。
 *
 * **为什么不并进 useBookStore**：那份已经 750 行（预算 800）。更重要的是职责不同——
 * useBookStore 管「当前打开的那一篇」的标签与草稿，这里管「把这一篇拆成结构化的章」。
 * 它读一篇、存一份解析结果；章纲可编辑（2026-11 W-02）之后，写回也只**借用**那一份的既有落盘通路
 * （`onEdit` + `saveActive`），不另开 IPC、不另存草稿——两处草稿是下一场「保存到底保存了哪一份」的祸根。
 *
 * 判定与拼装在 `contracts/volume-outline`（那里有 44 条真单测，含往返一致那条硬要求），
 * 这里只负责读盘、落盘与在途标记——同一判定不写第二份（铁律 6）。
 */
import { defineStore } from "pinia";
import {
  applyChapterFieldEdits,
  buildChapterOutlineMarkdown,
  parseVolumeOutline,
  planDocRelPath,
  summedWordTarget,
  type ChapterOutlineField,
  type ParsedChapter,
  type VolumeOutline
} from "@mochen/contracts";
import type { DocRef } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

/** 生成一章 / 保存一章的结果：只给一句人话，不抛异常（面板要把它显示出来，不是记日志）。 */
export interface GenerateResult {
  ok: boolean;
  message: string;
}

/** 卷纲/大纲这类「能拆章」的文稿。刻意不是全集：章节正文拆不成章纲。 */
export const STRUCTURED_KINDS = ["volume", "outline"] as const;

export function isStructuredKind(kind: DocRef["kind"]): boolean {
  return (STRUCTURED_KINDS as readonly string[]).includes(kind);
}

export const useVolumeOutlineStore = defineStore("volume-outline", {
  state: () => ({
    /** 浮层是否开着。只在这一颗按钮上开合，所以住 store 而不是组件本地（与 5-① 同款）。 */
    open: false,
    /** 正在结构化的那篇文稿（空串 = 还没打开过）。 */
    sourceRelPath: "" as string,
    sourceTitle: "" as string,
    /** 解析结果；没打开或读失败时是 null。 */
    outline: null as VolumeOutline | null,
    busy: false,
    /** 读盘失败时给用户看的中文原因；空串 = 没失败。 */
    notice: "" as string,
    /** 正在落盘的那几章（按章序索引）：按钮据此禁用，重复点不会建出两篇同名文件。 */
    generating: [] as number[],
    /** 正在写回字段的那几章（2026-11 W-02）：与 generating 分开——两类在途互相不该借别人的锁。 */
    saving: [] as number[]
  }),

  getters: {
    chapters(): ParsedChapter[] {
      return this.outline?.chapters ?? [];
    },
    /** 写明了数字目标字数的那些章加起来是多少；读不出数字的**不算进来**。 */
    wordTotal(): number {
      return summedWordTarget(this.chapters).total;
    },
    /** 有几章写了字数但读不出数字（照实报数，不折成 0）。 */
    wordUnreadable(): number {
      return summedWordTarget(this.chapters).unreadable;
    },
    /** 一个字段都没写的节数——多半是分组标题，标出来让人自己定。 */
    looseCount(): number {
      return this.chapters.filter((c) => c.isLoose).length;
    },
    /** 头部那句总结：零章也要说话，不许一片空白让人猜是不是没跑。 */
    verdict(): string {
      if (this.notice !== "") return this.notice;
      const total = this.chapters.length;
      if (total === 0) return this.outline?.note ?? "";
      const loose = this.looseCount === 0 ? "" : ` · ${this.looseCount} 节没写字段`;
      return `认出 ${total} 章${loose}`;
    }
  },

  actions: {
    /**
     * 从右栏那颗按钮进来：读当前打开的这篇卷纲/大纲并拆章。
     *
     * 点第二次是关。关掉时**保留**解析结果（再点回来不必重读盘）；
     * 换一篇打开就重读——这是两个不同的操作，不合并成一个「刷新」。
     */
    async toggleFor(doc: DocRef | null): Promise<void> {
      if (doc === null) return;
      if (this.open && this.sourceRelPath === doc.relPath) {
        this.open = false;
        return;
      }
      await this.openFor(doc);
    },

    async openFor(doc: DocRef): Promise<void> {
      this.sourceRelPath = doc.relPath;
      this.sourceTitle = doc.title;
      this.open = true;
      this.busy = true;
      this.notice = "";
      try {
        const loaded = await window.mochen.readDoc(doc.relPath);
        this.outline = parseVolumeOutline(loaded.content);
      } catch (err) {
        this.outline = null;
        this.notice = `卷纲没读回来：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
      } finally {
        this.busy = false;
      }
    },

    close(): void {
      this.open = false;
    },

    /**
     * 把一章改过的字段**就地写回**卷纲原文（2026-11 W-02 第一步）。
     *
     * 写回的字面目标：原文里这一章那几行字段换掉，别的字节不动。拼装是纯函数
     * `applyChapterFieldEdits`（contracts），这里只决定「往哪儿写、怎么写、写失败说什么」。
     *
     * **写盘通路只有既有那条**：这一篇正开着 → 把新正文放进编辑器草稿（`book.onEdit`）
     * 再走 `book.saveActive()`——备份、指纹推进、外部改动拒写、失败原因都在那一处，不另开 IPC；
     * 这一篇不是当前标签（面板开着时切走了）→ 用 `readDoc` 拿指纹后 `writeDoc` 写回同一个文件。
     *
     * **写成功才换解析结果**：失败时面板保留用户的输入，不发第二份「已改好」的假结论。
     * 成功则整份重解析——完整度、还缺哪几项都从新原文重算，旧结论不留。
     */
    async saveChapter(
      chapter: ParsedChapter,
      fields: Partial<Record<ChapterOutlineField, string>>
    ): Promise<GenerateResult> {
      if (this.sourceRelPath === "") return { ok: false, message: "还没打开任何一篇卷纲。" };
      const book = useBookStore();
      this.saving.push(chapter.order);
      try {
        const isActive = book.activeDocTab === this.sourceRelPath;
        let raw: string;
        let fingerprint = "";
        if (isActive) {
          // 当前正文（可能含未保存的改动）才是要改的那一份；读盘会拿到旧字节并丢掉那些改动。
          raw = book.draft;
        } else {
          const loaded = await window.mochen.readDoc(this.sourceRelPath);
          raw = loaded.content;
          fingerprint = loaded.fingerprint;
        }

        // 面板打开之后正文可能被改过：章序对不上标题就拒绝写——宁可让作者重开一次，
        // 也不能把这一章的字段落到别的章上（同名章按出场次序定位，见 contracts 那头的注释）。
        const now = parseVolumeOutline(raw);
        const target = now.chapters[chapter.order - 1];
        if (target === undefined || target.title !== chapter.title) {
          return {
            ok: false,
            message: "这一篇在面板打开后被改过，章序对不上了：关掉再打开一次重改。"
          };
        }

        const next = applyChapterFieldEdits(raw, [{ order: chapter.order, fields }]);
        if (next === raw) return { ok: true, message: "这一章没有改动。" };

        if (isActive) {
          book.onEdit(next);
          // 这一笔是我们自己立刻要落盘的，别让自动保存的定时器再写一遍（那会多一份备份）。
          book.cancelAutoSave();
          await book.saveActive();
          if (book.dirty || book.conflict !== null) {
            // 失败原因就在 book.notice（stale / 权限 / 无文件）；它同时上屏在编辑器栏头。
            return { ok: false, message: book.notice || "保存失败，原因没写出来。" };
          }
        } else {
          const written = await window.mochen.writeDoc(this.sourceRelPath, next, fingerprint);
          if (!written.ok) {
            return {
              ok: false,
              message:
                written.reason === "stale"
                  ? "这一篇在盘上被改过了，没覆盖；重新打开面板再改。"
                  : `保存失败：${written.message}`
            };
          }
        }

        // 失效 + 重算：整份解析结果换成刚写回的那份，完整度与「还缺」都从它生。
        this.outline = parseVolumeOutline(next);
        return { ok: true, message: "已保存，完整度按新内容重算。" };
      } catch (err) {
        return {
          ok: false,
          message: `保存失败：${err instanceof Error && err.message !== "" ? err.message : String(err)}`
        };
      } finally {
        this.saving = this.saving.filter((order) => order !== chapter.order);
      }
    },

    /**
     * 把一章落成一篇空的「大纲」文稿。
     *
     * **为什么走 createDoc + writeDoc 两步**：`createDoc` 建出来的是只有 title 的空模板
     * （`create.ts` 的 `docTemplate`），要往里填正文就得再写一次。指纹由 createDoc 回传，
     * 直接喂给 writeDoc——不用再读一遍盘，也不会撞上别人改过的那一篇。
     *
     * **同名不覆盖**：`createDocFile` 本身拒已存在的文件，这里提前挡一层是为了给出一句
     * 「已经有一篇同名大纲了」而不是把主进程那句 `invalid-path` 原样透给用户。
     */
    async generateChapter(chapter: ParsedChapter): Promise<GenerateResult> {
      const book = useBookStore();
      const relPath = planDocRelPath("outline", chapter.title);
      if (relPath === null) {
        return { ok: false, message: `「${chapter.title}」这个标题起不了文件名，换一个。` };
      }
      if (book.docs.some((d) => d.relPath === relPath)) {
        return { ok: false, message: `已经有一篇《${chapter.title}》了，没动它。` };
      }

      this.generating.push(chapter.order);
      try {
        const created = await window.mochen.createDoc(relPath, chapter.title);
        if (!created.ok) return { ok: false, message: created.message };
        const written = await window.mochen.writeDoc(
          relPath,
          buildChapterOutlineMarkdown(chapter, this.sourceTitle),
          created.fingerprint
        );
        if (!written.ok) {
          // stale 这一支没有 message（它带的是盘上当下的指纹）——不能写成 `written.message ?? …`：
          // 那会读到一个类型上不存在的属性。这里按 reason 分别说人话。
          return {
            ok: false,
            message:
              written.reason === "stale"
                ? `《${chapter.title}》建出来了但没写进去：这一篇在盘上被改过了，别覆盖，去看一眼再写。`
                : `《${chapter.title}》建出来了但没写进去：${written.message}`
          };
        }
        // **必须重扫**：主进程已经更新了它自己的快照，但渲染层的 `book.docs` 还停在生成之前。
        // 不扫的话，面板上那枚「已有同名大纲」要等下一次开书才变——作者会连点两次、第二次撞上拒绝。
        // 只扫 docs 与 meta，不动标签与草稿（refreshDocs 的既定口径）。
        await book.refreshDocs();
        return { ok: true, message: `已生成《${chapter.title}》` };
      } catch (err) {
        return {
          ok: false,
          message: `《${chapter.title}》没生成：${err instanceof Error && err.message !== "" ? err.message : String(err)}`
        };
      } finally {
        this.generating = this.generating.filter((order) => order !== chapter.order);
      }
    }
  }
});

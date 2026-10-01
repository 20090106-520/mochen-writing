import { defineStore } from "pinia";
import type { BookMeta, DocRef } from "@abyss/contracts";

interface DocState {
  draft: string;
  savedFingerprint: string;
  dirty: boolean;
  conflict: { currentFingerprint: string } | null;
}

const EMPTY_DOC: DocState = {
  draft: "",
  savedFingerprint: "",
  dirty: false,
  conflict: null
};

export const useBookStore = defineStore("book", {
  state: () => ({
    rootPath: null as string | null,
    meta: null as BookMeta | null,
    docs: [] as DocRef[],
    docTabs: [] as string[],
    activeDocTab: null as string | null,
    draft: "",
    savedFingerprint: "",
    dirty: false,
    saving: false,
    conflict: null as { currentFingerprint: string } | null,
    notice: "",
    browseTabs: [] as DocRef[],
    activeBrowse: null as string | null,
    browseContents: {} as Record<string, string>,
    /** 右栏这一格当前展示文稿还是浏览；浏览永不改写文稿侧状态。 */
    rightPaneMode: "manuscript" as "manuscript" | "browse",
    /** 切换文稿标签前先存好当前草稿，切回来才不被盘上内容覆盖。 */
    draftsByPath: {} as Record<string, DocState>
  }),

  actions: {
    /** 用户取消时必须什么都不做——已打开的作品、草稿、标签一律保持原样。 */
    async pickAndOpen() {
      const picked = await window.abyss.pickBookDirectory();
      if (!picked) {
        this.notice = "未选择作品目录";
        return;
      }
      await this.openBook(picked);
    },

    async openBook(rootPath: string) {
      const opened = await window.abyss.openBook(rootPath);
      this.rootPath = opened.rootPath;
      this.meta = opened.meta;
      this.docs = opened.docs;
      this.docTabs = [];
      this.activeDocTab = null;
      this.browseTabs = [];
      this.activeBrowse = null;
      this.browseContents = {};
      this.rightPaneMode = "manuscript";
      this.draftsByPath = {};
      Object.assign(this, EMPTY_DOC);
      this.notice = `已打开《${opened.meta.title}》`;
    },

    refOf(relPath: string): DocRef | null {
      return this.docs.find((doc) => doc.relPath === relPath) ?? null;
    },

    async openDocTab(relPath: string) {
      this.stashActive();
      if (!this.docTabs.includes(relPath)) this.docTabs.push(relPath);
      this.activeDocTab = relPath;
      this.rightPaneMode = "manuscript";
      const stashed = this.draftsByPath[relPath];
      if (stashed) {
        Object.assign(this, stashed);
        return;
      }
      const loaded = await window.abyss.readDoc(relPath);
      this.draft = loaded.content;
      this.savedFingerprint = loaded.fingerprint;
      this.dirty = false;
      this.conflict = null;
      this.notice = "";
      this.draftsByPath[relPath] = this.snapshot();
    },

    closeTab(relPath: string) {
      this.docTabs = this.docTabs.filter((p) => p !== relPath);
      delete this.draftsByPath[relPath];
      if (this.activeDocTab !== relPath) return;
      const next = this.docTabs[this.docTabs.length - 1] ?? null;
      this.activeDocTab = next;
      if (next) void this.openDocTab(next);
      else Object.assign(this, EMPTY_DOC);
    },

    /** 浏览：把右栏这一格切到浏览，但绝不触碰文稿标签与草稿。 */
    browse(ref: DocRef) {
      if (!this.browseTabs.some((doc) => doc.relPath === ref.relPath)) this.browseTabs.push(ref);
      this.activeBrowse = ref.relPath;
      this.rightPaneMode = "browse";
      if (this.browseContents[ref.relPath] === undefined) {
        void window.abyss.readDoc(ref.relPath).then((loaded) => {
          this.browseContents[ref.relPath] = loaded.content;
        });
      }
    },

    closeBrowse(relPath: string) {
      this.browseTabs = this.browseTabs.filter((doc) => doc.relPath !== relPath);
      delete this.browseContents[relPath];
      if (this.activeBrowse === relPath)
        this.activeBrowse = this.browseTabs[this.browseTabs.length - 1]?.relPath ?? null;
    },

    onEdit(content: string) {
      this.draft = content;
      this.dirty = true;
      if (this.activeDocTab) this.draftsByPath[this.activeDocTab] = this.snapshot();
    },

    async saveActive() {
      if (!this.activeDocTab) return;
      this.saving = true;
      const result = await window.abyss.writeDoc(
        this.activeDocTab,
        this.draft,
        this.savedFingerprint
      );
      this.saving = false;
      if (result.ok) {
        this.savedFingerprint = result.fingerprint;
        this.dirty = false;
        this.conflict = null;
        this.notice = result.backupRelPath ? "已保存，原稿已备份" : "已保存";
        if (this.activeDocTab) this.draftsByPath[this.activeDocTab] = this.snapshot();
        return;
      }
      if (result.reason === "stale") {
        this.conflict = { currentFingerprint: result.currentFingerprint };
        this.notice = "文件在外部被改过，已拒绝覆盖";
      } else this.notice = `保存失败：${result.message}`;
      if (this.activeDocTab) this.draftsByPath[this.activeDocTab] = this.snapshot();
    },

    async reloadActive() {
      if (!this.activeDocTab) return;
      const loaded = await window.abyss.readDoc(this.activeDocTab);
      this.draft = loaded.content;
      this.savedFingerprint = loaded.fingerprint;
      this.dirty = false;
      this.conflict = null;
      this.notice = "已重载盘上内容";
      this.draftsByPath[this.activeDocTab] = this.snapshot();
    },

    snapshot(): DocState {
      return {
        draft: this.draft,
        savedFingerprint: this.savedFingerprint,
        dirty: this.dirty,
        conflict: this.conflict ? { ...this.conflict } : null
      };
    },

    stashActive() {
      if (this.activeDocTab) this.draftsByPath[this.activeDocTab] = this.snapshot();
    }
  }
});

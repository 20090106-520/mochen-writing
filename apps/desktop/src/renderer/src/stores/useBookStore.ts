import { defineStore } from "pinia";
import {
  PERMISSION_LABELS,
  type BookMeta,
  type DocRef,
  type PermissionMode
} from "@mochen/contracts";

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
    /** 权限档菜单是否展开；`/permissions` 与头部按钮共用的唯一开关。 */
    permissionMenuOpen: false,
    /** 切换权限档是否正在落盘——只管这条通路，与右栏文稿保存 `saving` 是两件事。 */
    metaSaving: false,
    /** 切换文稿标签前先存好当前草稿，切回来才不被盘上内容覆盖。 */
    draftsByPath: {} as Record<string, DocState>
  }),

  actions: {
    /** 用户取消时必须什么都不做——已打开的作品、草稿、标签一律保持原样。 */
    async pickAndOpen() {
      const picked = await window.mochen.pickBookDirectory();
      if (!picked) {
        this.notice = "未选择作品目录";
        return;
      }
      await this.openBook(picked);
    },

    async openBook(rootPath: string) {
      const opened = await window.mochen.openBook(rootPath);
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
      const loaded = await window.mochen.readDoc(relPath);
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
      // 指针先置空再交给 openDocTab：这一段 live 还装着 relPath 的内容，
      // 而 openDocTab 开头的 stashActive() 认的是 activeDocTab——留着 next 就是把脏水泼进它的存档。
      this.activeDocTab = null;
      if (next) void this.openDocTab(next);
      else Object.assign(this, EMPTY_DOC);
    },

    /** Ctrl+1..9：越界返回 false 且不改状态。 */
    activateTab(index: number): boolean {
      const target = this.docTabs[index];
      if (target === undefined) return false;
      void this.openDocTab(target);
      return true;
    },

    /** Ctrl+PageUp/Down：环形切换；无标签时不动。 */
    cycleTab(delta: 1 | -1): void {
      if (this.docTabs.length === 0) return;
      const current = this.activeDocTab ? this.docTabs.indexOf(this.activeDocTab) : -1;
      const next = (current + delta + this.docTabs.length) % this.docTabs.length;
      const target = this.docTabs[next];
      if (target !== undefined) void this.openDocTab(target);
    },

    /** 浏览：把右栏这一格切到浏览，但绝不触碰文稿标签与草稿。 */
    browse(ref: DocRef) {
      if (!this.browseTabs.some((doc) => doc.relPath === ref.relPath)) this.browseTabs.push(ref);
      this.activeBrowse = ref.relPath;
      this.rightPaneMode = "browse";
      if (this.browseContents[ref.relPath] === undefined) {
        void window.mochen.readDoc(ref.relPath).then((loaded) => {
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
      const result = await window.mochen.writeDoc(
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
      const loaded = await window.mochen.readDoc(this.activeDocTab);
      this.draft = loaded.content;
      this.savedFingerprint = loaded.fingerprint;
      this.dirty = false;
      this.conflict = null;
      this.notice = "已重载盘上内容";
      this.draftsByPath[this.activeDocTab] = this.snapshot();
    },

    /**
     * 把智能体写入的盘上事实吸收进右栏。
     * 干净草稿：作废暂存副本，活动标签立刻重载。
     * 有未保存手改：绝不覆盖用户草稿，改成报冲突，由人决定重载还是另存。
     */
    async absorbAgentWrite(relPath: string, fingerprint: string): Promise<void> {
      const stashed = this.draftsByPath[relPath];
      if (stashed?.dirty) {
        this.draftsByPath[relPath] = { ...stashed, conflict: { currentFingerprint: fingerprint } };
        if (this.activeDocTab === relPath) this.conflict = { currentFingerprint: fingerprint };
        this.notice = "智能体改写了本章，你的未保存修改没有丢；确认后重载再手工合并";
        return;
      }
      delete this.draftsByPath[relPath];
      if (this.activeDocTab === relPath) {
        try {
          await this.reloadActive();
          this.notice = "智能体已写入本章，草稿已同步";
        } catch (err) {
          // 裁定 n：主进程边界拒绝的 message 是单句中文，这里必须让它可见，绝不静默吞掉。
          const reason = err instanceof Error ? err.message : String(err);
          this.notice = `智能体已写入本章，但草稿同步失败：${reason}`;
        }
      } else this.notice = "智能体已写入本章";
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
    },

    /** 只搬标志位：档位真正落盘在 setPermissionMode，这里绝不写 meta。 */
    openPermissionMenu(): void {
      this.permissionMenuOpen = true;
    },

    /**
     * chip 的唯一开关：开着就关、关着就开。关闭走既有 closePermissionMenu()，
     * 让「收起弹层」这件事只有一处真身，也给用户一条「不切档就关掉」的通路。
     */
    togglePermissionMenu(): void {
      if (this.permissionMenuOpen) this.closePermissionMenu();
      else this.openPermissionMenu();
    },

    /**
     * 切权限档：渲染层唯一的 saveMeta 调用方（主进程写盘后会刷新快照，档位当场生效）。
     * 本地 meta 必须一起改，否则头部标签还停在旧档；失败时一个字都不改，原因进 notice。
     */
    async setPermissionMode(mode: PermissionMode): Promise<void> {
      if (!this.meta) {
        this.notice = "还没打开作品目录，权限档改不了。";
        return;
      }
      if (this.meta.permissionMode === mode) {
        this.notice = `已经是这一档了：「${PERMISSION_LABELS[mode]}」。`;
        return;
      }
      const next: BookMeta = { ...this.meta, permissionMode: mode };
      // metaSaving 只圈住这条落盘通路（右栏的 saving 与之无关）：进出各写一次，
      // finally 让成功、失败、连点都不把弹层灰着——reject 分支同样必须落回 false。
      this.metaSaving = true;
      try {
        await window.mochen.saveMeta(next);
      } catch (err) {
        const reason = err instanceof Error && err.message !== "" ? err.message : String(err);
        this.notice = `权限档没改过来：${reason}`;
        return;
      } finally {
        this.metaSaving = false;
      }
      this.meta = next;
      // 先写后回读（9625c52 的同类坑）：赋进 pinia state 的对象要被 Vue 包成响应式代理，
      // 手里的裸 `next` 与 `this.meta` 是「同一个 target、两套拦截」，后续只认回读到的那一份，
      // 否则组件里的 computed 会把渲染那一帧的旧档永久缓存住（回归用例见 useBookStore.test.ts）。
      this.notice = `权限档已切到「${PERMISSION_LABELS[this.meta.permissionMode]}」，下一次审批就用这一档判断。`;
      this.closePermissionMenu();
    },

    closePermissionMenu(): void {
      this.permissionMenuOpen = false;
    }
  }
});

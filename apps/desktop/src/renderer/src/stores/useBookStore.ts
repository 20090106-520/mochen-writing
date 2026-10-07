import { defineStore } from "pinia";
import { toRaw } from "vue";
import {
  PERMISSION_LABELS,
  WORK_MODE_LABELS,
  findProfile,
  planDocRelPath,
  workModeOf,
  type BookKind,
  type BookMeta,
  type BookOpenResult,
  type ChangeEntry,
  type DocRef,
  type PermissionMode,
  type WorkMode
} from "@mochen/contracts";
import { activeStageOf } from "../utils/composer-context";
import { absorbConflictNotice } from "../utils/agent-thread";
import { foreshadowRows, type ForeshadowRow } from "../utils/foreshadow";
import { renameTitleInContent } from "../utils/doc-title";
import {
  AUTOSAVE_DEFAULT_DELAY_MS,
  autosavePreferenceStorage,
  loadAutosaveDelay
} from "../utils/autosave-preference";
import { autoAdoptApproved } from "../utils/auto-behavior-preference";

interface DocState {
  draft: string;
  savedFingerprint: string;
  dirty: boolean;
  conflict: { currentFingerprint: string } | null;
}

/**
 * 右栏同一格的三态（铁律 6：这条联合只有一份实现）。
 * 原先是 `state` 里的内联字面量联合，`markdown-snippets.ts` 与 `DocumentPane.vue` 还要各抄一遍 ⇒ 一律 import 这个类型。
 */
export type RightPaneMode = "manuscript" | "browse" | "dossier";

/** 文稿编辑视图的三态（编辑 / 分栏预览 / 只看预览）。 */
export type EditorViewMode = "edit" | "split" | "preview";

const EMPTY_DOC: DocState = {
  draft: "",
  savedFingerprint: "",
  dirty: false,
  conflict: null
};

/** 最后一次键入到自动保存之间的静默窗的**默认档**：设置页那排档位的兜底值（没有偏好时用它）。
 *  排程真身走 loadAutosaveDelay（偏好档：关/1/2/5 秒），这个常量只保证「没设置时行为与原版一字不变」。 */
export const AUTO_SAVE_DELAY_MS = AUTOSAVE_DEFAULT_DELAY_MS;

/** 定时器句柄放模块级：它不是视图状态，进 pinia state 只会被响应式代理白白包一层。 */
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 读稿的世代号（2026-10-05 批次 3 尾巴）。
 * 每发起一次读盘就 +1；读回来时令牌对不上就说明**期间又开了别的**，
 * 这次拿回来的是废弃答案，直接丢弃。放模块级同 autoSaveTimer：它不是视图状态。
 */
let docLoadToken = 0;

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
    /** 右栏这一格当前展示文稿 / 浏览 / 作品资料；后两者永不改写文稿侧状态。 */
    rightPaneMode: "manuscript" as RightPaneMode,
    /** 权限档菜单是否展开；`/permissions` 与头部按钮共用的唯一开关。 */
    permissionMenuOpen: false,
    /** 切换权限档是否正在落盘——只管这条通路，与右栏文稿保存 `saving` 是两件事。 */
    metaSaving: false,
    /** 切换文稿标签前先存好当前草稿，切回来才不被盘上内容覆盖。 */
    draftsByPath: {} as Record<string, DocState>,
    /** 文稿区当前视图态（编辑 / 分栏 / 预览）；切文档、开新作品时归 edit。 */
    editorViewMode: "edit" as EditorViewMode,
    /**
     * 改稿历史面板的槽位（2026-10-05）。单格、不是页签堆——同 skillBrowser 一个理由：
     * 一次只看一条改动的「改前/改后」，看清了再决定回不回滚。
     * `null` = 面板关着。
     */
    changeHistory: null as ChangeEntry | null,
    /** 改稿历史面板是否开着。 */
    changeHistoryOpen: false,
    /** 拉回来的改稿历史，最新在前。主进程那边排好序，这里不重排。 */
    changeList: [] as ChangeEntry[],
    /** 拉列表 / 读备份 / 回滚的各自在途标记；按钮据此禁用，重复点不会发两次 IPC。 */
    changesBusy: false,
    /** 读回来的那条备份正文，回滚前给用户看的就是它。 */
    changePreview: null as { backupRelPath: string; content: string } | null,
    /**
     * 伏笔台账（2026-10-05）的三格。
     * 状态机与解析在 contracts/foreshadow，行组装在 utils/foreshadow——这里只存结果与在途标记。
     */
    foreshadowsOpen: false,
    foreshadowRows: [] as ForeshadowRow[],
    foreshadowsBusy: false,
    /**
     * 正文这一格的在途标志（2026-10-05 批次 3 尾巴）。
     * `activeDocTab` 是先换的、`draft` 是后换的，中间那段中栏摆的是新标题配旧正文——
     * 这格标志让中栏改摆骨架。判定在 utils/editor-readout，这里只报事实。
     */
    docLoading: false
  }),

  getters: {
    /**
     * T7-1：「有没有打开作品」这一概念的**单一真身**，判据取 meta（5 个读点里 4 个原本就读它，
     * 且权限档 / 作品资料 / 状态回报三条通路都要读 meta）。
     * 此前 CenterColumn / useAgentStore 读 `meta !== null`、SlashPalette / useHotkeys 读
     * `rootPath !== null`，同一个 hasBook 字段两套口径——一律改读本 getter。
     */
    hasBook: (state) => state.meta !== null
  },

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
      this.applyOpened(opened);
      this.notice = `已打开《${opened.meta.title}》`;
    },

    /**
     * openBook 的填充段（唯一一份）：createBook 成功后走同一个入口，
     * 让「开一本新书」和「打开一本旧书」在渲染层的落点完全一致。
     */
    applyOpened(opened: BookOpenResult) {
      this.rootPath = opened.rootPath;
      this.meta = opened.meta;
      this.docs = opened.docs;
      this.docTabs = [];
      this.activeDocTab = null;
      this.browseTabs = [];
      this.activeBrowse = null;
      this.browseContents = {};
      this.rightPaneMode = "manuscript";
      this.editorViewMode = "edit";
      this.draftsByPath = {};
      Object.assign(this, EMPTY_DOC);
      // 换书 = 上一本书的在途读全部作废。不作废的话，那次读回来会把**上一本书的正文**
      // 写进这一本的中栏：令牌对不上，下面 openDocTab 的闸会把它丢掉。
      docLoadToken += 1;
      this.docLoading = false;
    },

    /**
     * 新建一本书：主进程建骨架（book.json + 五个目录），成功后按 openBook 同款落点填充。
     * 目录选择（book:pick）由对话框先走完，这里只管建与开。
     */
    async createBook(directory: string, title: string): Promise<boolean> {
      const result = await window.mochen.createBook({ directory, title });
      if (!result.ok) {
        this.notice = result.message;
        return false;
      }
      this.applyOpened(result.book);
      this.notice = `新书《${result.book.meta.title}》已建好，开始写吧。`;
      return true;
    },

    /**
     * 温和重扫：只更新 meta 与 docs，绝不动标签、草稿与浏览态——
     * 新建文档、外部改动同步这类「盘上多了东西」的时刻，屏幕上正在编辑的字一个都不能丢。
     */
    async refreshDocs(): Promise<void> {
      if (!this.rootPath) return;
      const opened = await window.mochen.openBook(this.rootPath);
      this.meta = opened.meta;
      this.docs = opened.docs;
    },

    /**
     * 新建一篇文档：路径规划（contracts 唯一实现）→ 主进程落盘 → 温和重扫 → 打开新标签。
     * 返回 false 时 notice 里已有一句人话理由；主进程还会兜底再验一遍（文件已存在/路径非法）。
     */
    async createDoc(kind: BookKind, title: string): Promise<boolean> {
      if (!this.hasBook) {
        this.notice = "还没打开作品目录，建不了新文档。";
        return false;
      }
      const relPath = planDocRelPath(kind, title);
      if (relPath === null) {
        this.notice = "这个标题起不了文件名（不能只含空格或点），换一个名字。";
        return false;
      }
      if (this.docs.some((doc) => doc.relPath === relPath)) {
        this.notice = `已经有同名的了：${relPath}。换一个名字。`;
        return false;
      }
      const result = await window.mochen.createDoc(relPath, title.trim());
      if (!result.ok) {
        this.notice = result.message;
        return false;
      }
      await this.refreshDocs();
      await this.openDocTab(relPath);
      this.notice = `已新建 ${relPath}`;
      return true;
    },

    refOf(relPath: string): DocRef | null {
      return this.docs.find((doc) => doc.relPath === relPath) ?? null;
    },

    /**
     * 改标题真通路：读盘上最新版 → 纯函数只改 frontmatter 的 title 行 → 按指纹链写回 → 温和重扫。
     * relPath 与文件名一概不动（那要牵动 chapterOrder 与会话，是另一条通路的事）；
     * 树、面包屑、标签上的 title 都来自 docs，重扫后自然换新。
     * 右栏同步照 absorbAgentWrite 的镜像：干净草稿吸收盘上新内容，未保存的手改绝不覆盖，
     * 改成挂冲突由人决定重载还是覆盖——两边都不静默互踩。
     */
    async renameDocTitle(relPath: string, nextTitle: string): Promise<boolean> {
      if (!this.hasBook) {
        this.notice = "还没打开作品目录，改不了标题。";
        return false;
      }
      const trimmed = nextTitle.trim();
      const current = this.refOf(relPath);
      if (trimmed === "") {
        this.notice = "标题不能是空的。";
        return false;
      }
      if (current?.title === trimmed) {
        this.notice = "标题没变，不用改。";
        return false;
      }
      const loaded = await window.mochen.readDoc(relPath);
      const renamed = renameTitleInContent(loaded.content, trimmed);
      if (!renamed.ok) {
        this.notice =
          renamed.reason === "no-fence"
            ? "这篇开头没有 --- 元数据栏，标题改不了；直接在正文第一行改吧。"
            : "标题没改成：新名字不合法。";
        return false;
      }
      const result = await window.mochen.writeDoc(relPath, renamed.content, loaded.fingerprint);
      if (!result.ok) {
        this.notice =
          result.reason === "stale"
            ? "标题没改成：文件刚被别处改动，再试一次。"
            : `标题没改成：${result.message}`;
        return false;
      }
      const stashed = this.draftsByPath[relPath];
      if (stashed?.dirty) {
        this.draftsByPath[relPath] = {
          ...stashed,
          conflict: { currentFingerprint: result.fingerprint }
        };
        if (this.activeDocTab === relPath)
          this.conflict = { currentFingerprint: result.fingerprint };
      } else {
        // 干净的暂存副本已经过期（盘上换了 title 行）：作废，下次打开按盘上真身重读。
        delete this.draftsByPath[relPath];
        if (this.activeDocTab === relPath) {
          this.draft = renamed.content;
          this.savedFingerprint = result.fingerprint;
          this.dirty = false;
          this.conflict = null;
        }
      }
      await this.refreshDocs();
      // 浏览标签里存的是改名前的 DocRef 引用，从重扫后的 docs 里换新，右栏浏览态才不显示旧标题。
      this.browseTabs = this.browseTabs.map((doc) => this.refOf(doc.relPath) ?? doc);
      this.notice = `标题已改为「${trimmed}」`;
      return true;
    },

    async openDocTab(relPath: string) {
      this.stashActive();
      if (!this.docTabs.includes(relPath)) this.docTabs.push(relPath);
      this.activeDocTab = relPath;
      this.rightPaneMode = "manuscript";
      const stashed = this.draftsByPath[relPath];
      if (stashed) {
        // 有暂存就零延迟换过去：不发 IPC 就不该进在途态，
        // 否则中栏会为一次同步赋值抖一下骨架。
        Object.assign(this, stashed);
        return;
      }
      // 令牌：连点两个标签时，先发的那次读回来是**废弃答案**。
      // 没有它，慢的那次会把中栏永久停在错的那一篇上（不是闪一下，是停在那儿）。
      const token = ++docLoadToken;
      this.docLoading = true;
      try {
        const loaded = await window.mochen.readDoc(relPath);
        if (token !== docLoadToken) return;
        this.draft = loaded.content;
        this.savedFingerprint = loaded.fingerprint;
        this.dirty = false;
        this.conflict = null;
        this.notice = "";
        this.draftsByPath[relPath] = this.snapshot();
      } catch (err) {
        if (token !== docLoadToken) return;
        // 读不出来时**必须清空正文**：留着上一篇的正文，新标题底下就是撒谎，
        // 用户一打字就会把上一篇写进这一篇。空着 + 说明白哪一篇没打开，比错着强。
        this.draft = "";
        this.savedFingerprint = "";
        this.dirty = false;
        this.conflict = null;
        this.notice = `没能打开 ${relPath}：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
      } finally {
        // 只有还持有令牌的这次才收标志：废弃的那次落地会把在读的那次的骨架提前撤掉。
        if (token === docLoadToken) this.docLoading = false;
      }
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

    /**
     * 打开右栏「作品资料」页签：只改 rightPaneMode。
     * 绝不动 docTabs / activeDocTab / draft / dirty / saving——切过去再切回来，草稿与标签不受影响（反向用例守着）。
     */
    openDossier(): void {
      this.rightPaneMode = "dossier";
    },

    /**
     * 改稿历史（2026-10-05）：`docWrite` 每次覆盖前都存了改前备份并把句柄传回来，
     * 但此前全仓没有一处读得回它。这里补上这条回程——「AI 改坏了怎么办」的答案。
     *
     * 三条动作都走 store，不让组件直接摸 `window.mochen`：面板要同时管列表、预览与在途标记，
     * 散在组件里就散成三份状态。
     */
    async loadChanges(): Promise<void> {
      this.changesBusy = true;
      try {
        this.changeList = await window.mochen.listChanges();
      } catch (err) {
        this.notice = `改稿历史没读回来：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
        this.changeList = [];
      } finally {
        this.changesBusy = false;
      }
    },

    /** 打开面板并拉一次列表。没开书时列表是空表（主进程那边给的就是空表，不是错）。 */
    async openChangeHistory(): Promise<void> {
      this.changeHistoryOpen = true;
      await this.loadChanges();
    },

    closeChangeHistory(): void {
      this.changeHistoryOpen = false;
      this.changeHistory = null;
      this.changePreview = null;
    },

    /**
     * 伏笔台账（2026-10-05）：把书里所有 `foreshadow/` 文稿读回来摆成一张表。
     *
     * 为什么要读全文：伏笔的状态、埋在哪、收在哪都写在 frontmatter 里，
     * 而 `DocRef` 只带 title/excerpt/chars——不读原文就永远只能看到一个空文件夹。
     * 伏笔通常十几到几十条，一次 `allSettled` 并发读完即可，不做分页不做缓存
     *（台账的价值全在「此刻还欠着什么」，缓存比不缓存更危险）。
     *
     * 读不到的**照样列出来**（tone=unknown）：凭空从台账上消失的那一条伏笔，
     * 恰恰是最需要被看见的那一条。
     */
    async loadForeshadows(): Promise<void> {
      if (this.docs.length === 0) {
        this.foreshadowRows = [];
        return;
      }
      this.foreshadowsBusy = true;
      try {
        const targets = this.docs.filter((d) => d.kind === "foreshadow");
        const raws = new Map<string, string>();
        const loaded = await Promise.allSettled(
          targets.map((d) => window.mochen.readDoc(d.relPath))
        );
        targets.forEach((d, i) => {
          const one = loaded[i];
          if (one?.status === "fulfilled") raws.set(d.relPath, one.value.content);
        });
        this.foreshadowRows = foreshadowRows(this.docs, raws);
      } catch (err) {
        this.notice = `伏笔台账没读回来：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
        this.foreshadowRows = [];
      } finally {
        this.foreshadowsBusy = false;
      }
    },

    /** 点开一条：先读回那份「改前」正文给用户看，回滚与否由他定。 */
    async peekChange(entry: ChangeEntry): Promise<void> {
      this.changesBusy = true;
      this.changeHistory = entry;
      this.changePreview = null;
      try {
        const read = await window.mochen.readChange(entry.backupRelPath);
        // 读到的是别的一条（面板期间盘上变了）就丢掉，别把错的内容摆给人看。
        if (this.changeHistory?.backupRelPath !== entry.backupRelPath) return;
        this.changePreview = { backupRelPath: entry.backupRelPath, content: read.content };
      } catch (err) {
        this.notice = `这条备份读不出来：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
      } finally {
        this.changesBusy = false;
      }
    },

    /**
     * 回滚：把 `docRelPath` 换回这条备份的内容。
     * 指纹传的是**盘上此刻**的值（现读现传）——主进程那道闸靠它判断「这之后还有人改过没有」，
     * 这里要是传个旧的，闸就白设了。
     */
    async restoreChange(entry: ChangeEntry): Promise<void> {
      if (this.activeDocTab === null) {
        this.notice = "先打开那一篇正文，才能把它回滚回去。";
        return;
      }
      this.changesBusy = true;
      try {
        const current = await window.mochen.readDoc(entry.docRelPath);
        const result = await window.mochen.restoreChange(entry.backupRelPath, current.fingerprint);
        if (!result.ok) {
          this.notice =
            result.reason === "stale"
              ? "这一篇在这之后又被改过了，已经不是当时那份了——先看看现在的内容再决定。"
              : (result.message ?? "没能回滚。");
          return;
        }
        // 当前正文可能正是被回滚的那一篇：现读回来刷新右栏，别让屏幕停在旧内容上。
        // 提示写在最后——reloadActive 自己也会写 notice（「已重载盘上内容」），
        // 顺序颠倒的话用户从头到尾看不见「已回滚」这三个字（2026-10-05 真机逮到）。
        if (this.activeDocTab === entry.docRelPath) await this.reloadActive();
        await this.loadChanges();
        this.notice = `已回滚 ${entry.docRelPath} 到改前的样子。`;
      } catch (err) {
        this.notice = `没能回滚：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
      } finally {
        this.changesBusy = false;
      }
    },

    /** 循环切换编辑视图三态：edit → split → preview → edit。 */
    cycleEditorViewMode(): void {
      const order: EditorViewMode[] = ["edit", "split", "preview"];
      const idx = order.indexOf(this.editorViewMode);
      this.editorViewMode = order[(idx + 1) % 3] as EditorViewMode;
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
      this.scheduleAutoSave();
    },

    /**
     * 自动保存的排程（唯一入口）：每次编辑都重置一次静默窗——「没有新编辑就不会有新尝试」，
     * 保存失败自然不会变成风暴。真身仍是 saveActive，自动与手动走同一条指纹链。
     * 静默窗读设置页那一档（utils/autosave-preference）：0 = 关（顺路把挂起那次也取消），只剩手动通路。
     */
    scheduleAutoSave(): void {
      if (autoSaveTimer !== null) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      const delay = loadAutosaveDelay(autosavePreferenceStorage());
      if (delay <= 0) return;
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        void this.saveActive({ auto: true });
      }, delay);
    },

    /** 取消挂起的自动保存：只在测试与假想的重载场景用，UI 不暴露。 */
    cancelAutoSave(): void {
      if (autoSaveTimer !== null) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
    },

    /**
     * 保存当前文稿（手动按钮与自动保存共用的唯一落盘通路）。
     *
     * 修掉一个既有竞态：保存发出后、await 回来前用户又打了字——盘上与 savedFingerprint 是
     * 「发出那一刻」的稿子，此刻内存草稿已领先，dirty 绝不能被清成 false（清了它，那几个字就
     * 活在「已保存」的假象里）。发现领先就把 dirty 竖回来，并按 auto 语境重新排程。
     */
    async saveActive(options: { auto?: boolean } = {}) {
      if (!this.activeDocTab) return;
      if (options.auto === true && (this.saving || this.conflict !== null)) return;
      this.saving = true;
      const submitted = this.draft;
      const result = await window.mochen.writeDoc(
        this.activeDocTab,
        this.draft,
        this.savedFingerprint
      );
      this.saving = false;
      if (result.ok) {
        this.savedFingerprint = result.fingerprint;
        const editedWhileSaving = this.draft !== submitted;
        this.dirty = editedWhileSaving;
        this.conflict = null;
        this.notice =
          options.auto === true
            ? "已自动保存"
            : result.backupRelPath
              ? "已保存，原稿已备份"
              : "已保存";
        if (this.activeDocTab) this.draftsByPath[this.activeDocTab] = this.snapshot();
        if (options.auto === true && editedWhileSaving) this.scheduleAutoSave();
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
     * 把智能体写入的盘上事实吸收进右栏。干净草稿：作废暂存副本并重载；有未保存手改：绝不覆盖、
     * 报冲突由人决定；末尾都重扫一次书稿清单（新文档即刻出现在树里）。
     *
     * 设置页那枚「批准改稿后自动同步正文」关掉时也走**冲突那条分支**（2026-10-06 批次 5-⑧）：
     * 另造「什么都不做」的分支会让右栏静悄悄停在旧正文、用户下次保存被指纹闸拦下而不知所以然。
     */
    async absorbAgentWrite(relPath: string, fingerprint: string): Promise<void> {
      const stashed = this.draftsByPath[relPath];
      if (stashed?.dirty || !autoAdoptApproved()) {
        // 存档不存在时**不许**造一个 `{...undefined}` 的半截 DocState 塞进去：
        // 活动标签那一份的 live 状态才是真的，这里只标 conflict（下次 stashActive 会带上它）。
        if (stashed !== undefined) {
          this.draftsByPath[relPath] = {
            ...stashed,
            conflict: { currentFingerprint: fingerprint }
          };
        }
        if (this.activeDocTab === relPath) this.conflict = { currentFingerprint: fingerprint };
        this.notice = absorbConflictNotice(stashed?.dirty === true);
        await this.refreshDocs();
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
      await this.refreshDocs();
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
     * chip 的唯一开关：开着就关、关着就开。关闭走既有 closePermissionMenu()，让「收起弹层」只有一处真身。
     */
    togglePermissionMenu(): void {
      if (this.permissionMenuOpen) this.closePermissionMenu();
      else this.openPermissionMenu();
    },

    /**
     * book.json 那几格可写字段的**唯一落盘通路**（铁律 6）。
     * 切权限档 / 工作模式 / 阶段 / 档案四段曾逐条抄过同一件事；抄四份的代价不是难看，
     * 是第四份迟早漏掉「先写后回读」——赋进 pinia state 的对象会被 Vue 包成响应式代理，
     * 手里的裸对象与 `this.meta` 是「同一个 target、两套拦截」，组件里的 computed 只认回读那份
     * （这条坑在 9625c52 的绑定条上真实发生过）。
     *
     * @returns 成功落盘并已回读则 true；失败则 false（`this.meta` 一个字没动，notice 已写明原因）。
     */
    async persistMeta(patch: Partial<BookMeta>, failPrefix: string): Promise<boolean> {
      if (!this.meta) return false;
      // 展开响应式代理再展开 meta：Electron 在 IPC 的 send 端做结构化克隆，代理当场抛
      // 「An object could not be cloned.」⇒ 必须先 toRaw。
      const next: BookMeta = { ...toRaw(this.meta), ...patch };
      this.metaSaving = true;
      try {
        await window.mochen.saveMeta(next);
      } catch (err) {
        const reason = err instanceof Error && err.message !== "" ? err.message : String(err);
        this.notice = `${failPrefix}：${reason}`;
        return false;
      } finally {
        // 成功、失败、连点都不把按钮灰住：reject 分支同样必须落回 false。
        this.metaSaving = false;
      }
      this.meta = next;
      return true;
    },

    /**
     * 切权限档：渲染层唯一的 saveMeta 调用方。本地 meta 必须一起改，否则头部标签还停在旧档；
     * 失败时一个字都不改，原因进 notice。
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
      if (!(await this.persistMeta({ permissionMode: mode }, "权限档没改过来"))) return;
      this.notice = `权限档已切到「${PERMISSION_LABELS[this.meta.permissionMode]}」，下一次审批就用这一档判断。`;
      this.closePermissionMenu();
    },

    closePermissionMenu(): void {
      this.permissionMenuOpen = false;
    },

    /** 切工作模式（2026-10-05 批次 4）：先计划 ⇄ 直接动手，走 persistMeta 那一条通路。 */
    async setWorkMode(mode: WorkMode): Promise<void> {
      if (!this.meta) {
        this.notice = "还没打开作品目录，工作模式改不了（它是这本书的设置）。";
        return;
      }
      if (workModeOf(this.meta) === mode) {
        this.notice = `已经是这一档了：「${WORK_MODE_LABELS[mode]}」。`;
        return;
      }
      if (!(await this.persistMeta({ workMode: mode }, "工作模式没改过来"))) return;
      this.notice =
        mode === "plan"
          ? `工作模式已切到「${WORK_MODE_LABELS.plan}」：它只讲打算，提案批了也不落盘。`
          : `工作模式已切到「${WORK_MODE_LABELS.act}」：提案经你批准就会写入磁盘。`;
    },

    /** chip 那一枚：开着就关、关着就开。取反读 workModeOf，老书自然落在「动手」这一侧。 */
    async toggleWorkMode(): Promise<void> {
      await this.setWorkMode(workModeOf(this.meta ?? {}) === "plan" ? "act" : "plan");
    },

    /** #113c 切阶段：走 persistMeta 那一条落盘通路。刻意**不**碰 permissionMenuOpen（切阶段没资格替用户收它）。 */
    async setActiveStage(stageId: string): Promise<void> {
      if (!this.meta) {
        this.notice = "还没打开作品目录，阶段改不了。";
        return;
      }
      if (!this.meta.stages.some((stage) => stage.id === stageId)) {
        // 主进程的 bookSchema 会拒「activeStage 不在 stages 中」；先在渲染层说明白，省一次无谓写盘。
        this.notice = "这一档不在本书的阶段列表里，没去改。";
        return;
      }
      if (this.meta.activeStage === stageId) {
        // 走同一条查表通路取档名（这一支里 stageId 就是当前档 ⇒ activeStageOf 正是它），不再抄第四份 find。
        this.notice = `已经是这个阶段了：「${activeStageOf(this.meta)?.name ?? "无"}」。`;
        return;
      }
      if (!(await this.persistMeta({ activeStage: stageId }, "阶段没改过来"))) return;
      this.notice = `阶段已切到「${activeStageOf(this.meta)?.name ?? "无"}」，下一轮对话按这一档装配上下文。`;
    },

    /**
     * 切智能体档案（spec §5.1）：与 setActiveStage 同一条落盘通路。两条边界照设计原样：
     * 切档案**不换会话线程**（同一章仍是同一条线程），所以这里不碰任何 thread 状态；
     * 档案的 writeScope 只是上限，实际能不能落盘仍由 permissionMode 裁决（spec §5.1 约束 3）。
     */
    async setActiveProfile(profileId: string): Promise<void> {
      if (!this.meta) {
        this.notice = "还没打开作品目录，档案改不了。";
        return;
      }
      const profile = findProfile(profileId);
      if (profile === null) {
        this.notice = `没有这一枚档案：${profileId}。`;
        return;
      }
      if (this.meta.activeProfile === profile.id) {
        this.notice = `已经是「${profile.name}」这一枚档案了。`;
        return;
      }
      if (!(await this.persistMeta({ activeProfile: profile.id }, "档案没换过来"))) return;
      this.notice = `已切到「${profile.name}」。下一轮对话按它的提示词与上下文包装配。`;
    },

    /** 拖拽重排章节：把 fromRelPath 移到 chapterOrder 的 toIndex，立即重排 docs 并落盘。 */
    moveChapterByRelPath(fromRelPath: string, toIndex: number): void {
      if (!this.meta) return;
      const order = [...toRaw(this.meta.chapterOrder)];
      const currentIndex = order.indexOf(fromRelPath);
      if (currentIndex === -1) return;
      order.splice(currentIndex, 1);
      order.splice(toIndex, 0, fromRelPath);
      const next: BookMeta = { ...toRaw(this.meta), chapterOrder: order };
      this.meta = next;
      const rank = new Map(order.map((rel, index) => [rel, index]));
      this.docs = [...this.docs].sort((a, b) => {
        const ra = rank.get(a.relPath);
        const rb = rank.get(b.relPath);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return 0;
      });
      void window.mochen.saveMeta(next);
    }
  }
});

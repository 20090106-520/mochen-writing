import { defineStore } from "pinia";
import { toRaw } from "vue";
import {
  planDocRelPath,
  workModeOf,
  type BookKind,
  type BookMeta,
  type BookOpenResult,
  type BookProject,
  type ChangeEntry,
  type DocRef,
  type DocWriteResult,
  type PermissionMode,
  type RecentBookEntry,
  type WorkMode
} from "@mochen/contracts";
import { absorbConflictNotice } from "../utils/agent-thread";
import {
  activeProfileStep,
  activeStageStep,
  permissionModeStep,
  workModeStep
} from "../utils/meta-mode-step";
import {
  foreshadowRows,
  readForeshadowRaws,
  readPlantedChapters,
  type ForeshadowRow
} from "../utils/foreshadow";
import { renameTitleInContent } from "../utils/doc-title";
import { moveOrderItem, nextTabInCycle, sortDocsByOrder, tabAtIndex } from "../utils/doc-order";
import {
  AUTOSAVE_DEFAULT_DELAY_MS,
  autosavePreferenceStorage,
  loadAutosaveDelay
} from "../utils/autosave-preference";
import { autoAdoptApproved } from "../utils/auto-behavior-preference";
import {
  EMPTY_DOC,
  docStateOf,
  failureReasonOf,
  flushAllBeforeQuit,
  flushDocBeforeDrop,
  flushIOFor,
  quitBlockedNotice,
  saveOutcomeOf,
  type DocState,
  type FlushAllResult,
  type FlushIO,
  type FlushOutcome
} from "../utils/draft-flush";
import { installQuitFlushListener } from "../utils/quit-flush-client";
import { bumpDocLoadToken, readDocIntoTab } from "../utils/doc-read";
import { useAgentStore } from "./useAgentStore";
import { applySkillDefault, applySkillDisabled } from "../utils/skill-policy-writes";
import { browseFailureNotice, readBrowseBody, resetBrowseReadGates } from "../utils/browse-read";
import {
  closeChangeHistory,
  loadChanges,
  openChangeHistory,
  peekChange,
  restoreChange,
  undoChange,
  type ChangePreview
} from "./book-change-history";
import { bookDataFlushNotice, withBookDataFlush } from "../composables/bookDataRegistry";
import { openBookInto, pickAndOpenInto } from "../composables/book-open";

/**
 * 右栏同一格的三态（铁律 6：这条联合只有一份实现）。
 * 原先是 `state` 里的内联字面量联合，`markdown-snippets.ts` 与 `DocumentPane.vue` 还要各抄一遍 ⇒ 一律 import 这个类型。
 */
export type RightPaneMode = "manuscript" | "browse" | "dossier";

/** 文稿编辑视图的三态（编辑 / 分栏预览 / 只看预览）。 */
export type EditorViewMode = "edit" | "split" | "preview";

/** 写盘 IPC 的薄封装：模块级、不捕 `this`，`flushIOFor` 与 `saveActive` 都走这一个口子。 */
const writeDocIpc: FlushIO["write"] = (relPath, content, expectedFingerprint) =>
  window.mochen.writeDoc(relPath, content, expectedFingerprint);

/** 最后一次键入到自动保存之间的静默窗的**默认档**：设置页那排档位的兜底值（没有偏好时用它）。
 *  排程真身走 loadAutosaveDelay（偏好档：关/1/2/5 秒），这个常量只保证「没设置时行为与原版一字不变」。 */
export const AUTO_SAVE_DELAY_MS = AUTOSAVE_DEFAULT_DELAY_MS;

/** 定时器句柄放模块级：它不是视图状态，进 pinia state 只会被响应式代理白白包一层。 */
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useBookStore = defineStore("book", {
  state: () => ({
    rootPath: null as string | null,
    /**
     * 作品库（2026-10-21）：最近打开/新建过的书，按时间倒序；真身在主进程
     * （`book:open` / `book:create` 成功那一刻记账），这里只是只读镜像——渲染层不自己往里塞条目。
     */
    recentBooks: [] as RecentBookEntry[],
    /** 作品库清单的一次在读（切书后刷新用它，按钮据此禁用）。 */
    recentBooksLoading: false,
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
    /**
     * 浏览这一格上一次读盘的失败理由（2026-10-09 扫描总单 P1-9）。
     * 没有它，读失败之后中栏那一格会永远停在「正在读取…」——比空白更糟，因为它在撒谎。
     */
    browseErrors: {} as Record<string, string>,
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
     * 改稿历史面板的槽位（2026-10-05）：单格、不是页签堆——一次只看一条改动的「改前/改后」。
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
    changePreview: null as ChangePreview | null,
    /** 伏笔台账（2026-10-05）：判定在 contracts/foreshadow 与 utils/foreshadow，这里只存结果。 */
    foreshadowsOpen: false,
    foreshadowRows: [] as ForeshadowRow[],
    /** 台账登记的埋设章正文（C6 关键词回归用）；没打开台账就是空 Map。 */
    foreshadowChapterTexts: new Map<string, string>(),
    foreshadowsBusy: false,
    /**
     * 正文这一格的在途标志（2026-10-05）：`activeDocTab` 先换、`draft` 后换，中间那段会摆
     * 「新标题配旧正文」——这格标志让中栏改摆骨架。判定在 utils/editor-readout。
     */
    docLoading: false,
    /** 退出握手订阅的退订句柄：装配那一行先摘它、再写新的进去，所以屏上永远不会叠两层。 */
    quitFlushOff: null as (() => void) | null
  }),

  getters: {
    /**
     * T7-1：「有没有打开作品」的**单一真身**（判据取 meta）：权限档 / 作品资料 / 状态回报都要读 meta；
     * 此前 CenterColumn / useAgentStore 读 `meta !== null`、SlashPalette / useHotkeys 读 `rootPath !== null`。
     */
    hasBook: (state) => state.meta !== null
  },

  actions: {
    /** 用户取消时必须什么都不做——已打开的作品、草稿、标签一律保持原样。 */
    async pickAndOpen() {
      await pickAndOpenInto(this);
    },

    /**
     * 读回作品库（2026-10-21）。
     *
     * 读不到就保持现有清单、不弹错：作品库是「顺手再打开一本」的入口，
     * 不该因为它读失败而挡住正在写的这一本。主进程那边读坏也退空清单。
     */
    async loadRecentBooks() {
      if (this.recentBooksLoading) return;
      this.recentBooksLoading = true;
      try {
        const snapshot = await window.mochen.listRecentBooks();
        this.recentBooks = snapshot.books;
      } catch {
        // 见上面：静默保持现状。
      } finally {
        this.recentBooksLoading = false;
      }
    },

    /** 只从作品库清单里移除一条（不删书）。回执就是移除后的整份清单，直接换下本地镜像。 */
    async forgetRecentBook(rootPath: string) {
      try {
        const snapshot = await window.mochen.forgetRecentBook(rootPath);
        this.recentBooks = snapshot.books;
      } catch {
        // 同上：移除失败时不改本地清单，至少不会出现「界面没了、盘上还在」的假象。
      }
    },

    /** 打开一本作品；成功与失败两条路都在 `openBookInto` 里（失败时只说一句人话）。 */
    async openBook(rootPath: string) {
      await openBookInto(this, rootPath);
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
      this.browseErrors = {};
      this.rightPaneMode = "manuscript";
      this.editorViewMode = "edit";
      this.draftsByPath = {};
      // 线程级技能覆盖同属上一本书：线程键就是 relPath，不清的话同名章会继承上一本的口味。
      useAgentStore().skillPathsByThread = {};
      Object.assign(this, EMPTY_DOC);
      // 换书 = 上一本书的在途读全部作废。不作废的话，那次读回来会把**上一本书的正文**
      // 写进这一本的中栏：令牌对不上，`utils/doc-read` 那道闸会把它丢掉。
      bumpDocLoadToken();
      // 右栏「浏览」那条路同样要作废，而且用的是**另一枚号**（见 utils/browse-read 的注释：
      // 浏览的在途读不该因为中栏切了个标签就跟着报废，但换书时必须整体报废）。
      // 它同时清掉在途记账：上一本书那格还挂在 Set 里，这一本同 relPath 的那格就会被「已在途」挡掉，
      // 而挡住它的那次读又会被世代号丢掉——那一格就永久读不出来了。
      resetBrowseReadGates();
      this.docLoading = false;
      // 作品库（2026-10-21）：刚打开/新建的这一本在盘上已记了一笔，镜像跟着刷新一次。
      void this.loadRecentBooks();
    },

    /**
     * 新建一本书：主进程建骨架（book.json + 五个目录），成功后按 openBook 同款落点填充。
     * 目录选择（book:pick）由对话框先走完，这里只管建与开。
     *
     * `project` 是开书立项（W-07）的可选六格：省略时请求体里不出现这一项，
     * 旧调用方的行为与建书结果逐字不变。
     */
    async createBook(directory: string, title: string, project?: BookProject): Promise<boolean> {
      const input = { directory, title, ...(project === undefined ? {} : { project }) };
      const result = await withBookDataFlush(() => window.mochen.createBook(input));
      if (!result.ok) {
        this.notice = bookDataFlushNotice(result.message);
        return false;
      }
      this.applyOpened(result.book);
      this.notice = bookDataFlushNotice(`新书《${result.book.meta.title}》已建好，开始写吧。`);
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

    /**
     * 打开一篇文稿：标签与指针先换过去，正文交给 `utils/doc-read` 那条通路
     * （令牌闸住在那里，逐条钉在 `doc-read.test.ts`）；这里只把 store 那七八格摆好。
     */
    async openDocTab(relPath: string): Promise<void> {
      // P2-14：先取消上一篇排下的自动保存窗。这一格先换指针再 await 读盘，挂着的那一窗
      // 到点发的是「新路径 × 旧正文 × 旧指纹」——两篇内容恰好相同（新建章节的默认模板
      // 恰恰容易相同）时盘侧期望指纹闸也拦不住。没落盘的字不丢：下面 stashActive 存档。
      this.cancelAutoSave();
      this.stashActive();
      if (!this.docTabs.includes(relPath)) this.docTabs.push(relPath);
      this.activeDocTab = relPath;
      this.rightPaneMode = "manuscript";
      await readDocIntoTab(
        {
          stashed: (one) => this.draftsByPath[one] ?? null,
          read: (one) => window.mochen.readDoc(one),
          applyStashed: (_one, state) => {
            Object.assign(this, state);
          },
          applyLoaded: (one, loaded) => {
            this.draft = loaded.content;
            this.savedFingerprint = loaded.fingerprint;
            this.dirty = false;
            this.conflict = null;
            this.notice = "";
            this.draftsByPath[one] = docStateOf(this);
          },
          // 读不出来时**必须清空正文**：留着上一篇的正文，新标题底下就是撒谎，
          // 用户一打字就会把上一篇写进这一篇。空着 + 说明白哪一篇没打开，比错着强。
          // 清空走 EMPTY_DOC 那一份样子（与 closeTab 关到空、reloadActive 都同一处）。
          applyFailure: (one, reason) => {
            Object.assign(this, EMPTY_DOC);
            this.notice = `没能打开 ${one}：${reason}`;
          },
          setLoading: (value) => {
            this.docLoading = value;
          }
        },
        relPath
      );
    },

    /** 关标签（P0-3）：有没落盘的字就先写回盘上，写成了才允许它消失；判定与理由在 utils/draft-flush。 */
    async closeTab(relPath: string): Promise<FlushOutcome> {
      const outcome = await flushDocBeforeDrop(flushIOFor(this, writeDocIpc), relPath);
      if (!outcome.ok) {
        this.notice = outcome.message;
        return outcome;
      }
      this.docTabs = this.docTabs.filter((p) => p !== relPath);
      delete this.draftsByPath[relPath];
      if (this.activeDocTab !== relPath) return outcome;
      const next = this.docTabs[this.docTabs.length - 1] ?? null;
      // 指针先置空再交 openDocTab：它还装着 relPath 的内容，而 stashActive 认 activeDocTab。
      this.activeDocTab = null;
      if (next) void this.openDocTab(next);
      else Object.assign(this, EMPTY_DOC);
      return outcome;
    },

    /** 退出前的兜底落盘（P0-6）：每格没落盘的字都写回去，哪篇没成就点名；一篇失败不中断其余。 */
    async flushAllForQuit(): Promise<FlushAllResult> {
      this.cancelAutoSave();
      const relPaths = [...new Set([...this.docTabs, ...Object.keys(this.draftsByPath)])];
      // 设定那一族也走这道闸门（P0-7）：正文落了盘而笔记还挂在内存里，等于白兜一次。
      const result = await withBookDataFlush(() =>
        flushAllBeforeQuit(flushIOFor(this, writeDocIpc), relPaths)
      );
      if (!result.ok) this.notice = quitBlockedNotice(result.blocked);
      return result;
    },

    /** 退出握手（P0-6）装配点，根组件挂载时调一次。重复调用先摘旧再订新：屏上永远只有一只监听（叠两层就是一趟关闭落两遍盘、回两条话）。 */
    listenQuitFlush(): void {
      this.quitFlushOff?.();
      this.quitFlushOff = installQuitFlushListener(this, window.mochen);
    },

    /** Ctrl+1..9：越界返回 false 且不改状态。 */
    activateTab(index: number): boolean {
      const target = tabAtIndex(this.docTabs, index);
      if (target === null) return false;
      void this.openDocTab(target);
      return true;
    },

    /** Ctrl+PageUp/Down：环形切换；无标签时不动。取哪一枚的算术在 utils/doc-order。 */
    cycleTab(delta: 1 | -1): void {
      const target = nextTabInCycle(this.docTabs, this.activeDocTab, delta);
      if (target !== null) void this.openDocTab(target);
    },

    /**
     * 打开右栏「作品资料」页签：只改 rightPaneMode。
     * 绝不动 docTabs / activeDocTab / draft / dirty / saving——切过去再切回来，草稿与标签不受影响（反向用例守着）。
     */
    openDossier(): void {
      this.rightPaneMode = "dossier";
    },

    /**
     * 改稿历史（2026-10-05）：`docWrite` 每次覆盖前都存了改前备份并把句柄传回来，此前全仓没有一处读得回它——
     * 这里补上这条回程，即「AI 改坏了怎么办」的答案。三条动作都走 store 而不让组件直接摸 `window.mochen`：
     * 面板要同时管列表、预览与在途标记，散在组件里就散成三份状态。
     */
    async loadChanges(): Promise<void> {
      await loadChanges(this);
    },

    /** 打开面板并拉一次列表。没开书时列表是空表（主进程那边给的就是空表，不是错）。 */
    async openChangeHistory(): Promise<void> {
      await openChangeHistory(this);
    },

    closeChangeHistory(): void {
      closeChangeHistory(this);
    },
    /** 伏笔台账（2026-10-05）：读全文、读不到照列（tone=unknown）等纪律全在 `utils/foreshadow`。 */
    async loadForeshadows(): Promise<void> {
      if (this.docs.length === 0) {
        this.foreshadowRows = [];
        this.foreshadowChapterTexts = new Map();
        return;
      }
      this.foreshadowsBusy = true;
      try {
        // 读原文的并发与容错在 utils/foreshadow（与行组装同一处）；这里只摆状态。
        const raws = await readForeshadowRaws(this.docs, (relPath) =>
          window.mochen.readDoc(relPath)
        );
        this.foreshadowRows = foreshadowRows(this.docs, raws);
      } catch (err) {
        this.notice = `伏笔台账没读回来：${failureReasonOf(err)}`;
        this.foreshadowRows = [];
      } finally {
        this.foreshadowsBusy = false;
      }
    },

    /** 跨章回归（2026-10-22，C6）：读登记过的埋设章正文；读盘纪律见 `readPlantedChapters`。 */
    async loadForeshadowChapters(): Promise<void> {
      this.foreshadowChapterTexts = await readPlantedChapters(
        this.docs,
        this.foreshadowRows,
        (relPath) => window.mochen.readDoc(relPath)
      );
    },
    /** 点开一条：改前那份正文读回来，同时让主进程算出它与盘上此刻的逐行差别；回滚与否由人定。 */
    async peekChange(entry: ChangeEntry): Promise<void> {
      await peekChange(this, entry);
    },

    /** 回滚一条备份：守卫、现读现传的指纹、三档文案全在 `restoreBackupToDoc`，这里只摆状态。 */
    async restoreChange(entry: ChangeEntry): Promise<void> {
      await restoreChange(this, entry);
    },

    /** 一键撤销（P0-5）：先打开那一篇，再走与回滚同一条落盘通路（写盘与留备份都在主进程那条 IPC 上）。 */
    undoChange(entry: ChangeEntry): Promise<void> {
      return undoChange(this, entry);
    },

    /** 循环切换编辑视图三态：edit → split → preview → edit。 */
    cycleEditorViewMode(): void {
      const order: EditorViewMode[] = ["edit", "split", "preview"];
      const idx = order.indexOf(this.editorViewMode);
      this.editorViewMode = order[(idx + 1) % 3] as EditorViewMode;
    },

    /** 浏览：切到右栏浏览，绝不触碰文稿标签与草稿；读盘三道闸住在 `utils/browse-read`。 */
    browse(ref: DocRef) {
      if (!this.browseTabs.some((doc) => doc.relPath === ref.relPath)) this.browseTabs.push(ref);
      this.activeBrowse = ref.relPath;
      this.rightPaneMode = "browse";
      readBrowseBody(
        {
          hasCached: (relPath) => this.browseContents[relPath] !== undefined,
          // 中途关掉那一格：回包再回来也不许留缓存条目，否则重开那一格会看到旧快照而不是新读。
          isOpen: (relPath) => this.browseTabs.some((doc) => doc.relPath === relPath),
          read: (relPath) => window.mochen.readDoc(relPath),
          clearFailure: (relPath) => {
            delete this.browseErrors[relPath];
          },
          onResult: (relPath, content) => {
            this.browseContents[relPath] = content;
          },
          onFailure: (relPath, reason) => {
            this.browseErrors[relPath] = reason;
            this.notice = browseFailureNotice(relPath, reason);
          }
        },
        ref.relPath
      );
    },

    closeBrowse(relPath: string) {
      this.browseTabs = this.browseTabs.filter((doc) => doc.relPath !== relPath);
      delete this.browseContents[relPath];
      delete this.browseErrors[relPath];
      if (this.activeBrowse === relPath)
        this.activeBrowse = this.browseTabs[this.browseTabs.length - 1]?.relPath ?? null;
    },

    onEdit(content: string) {
      this.draft = content;
      this.dirty = true;
      this.stashActive();
      this.scheduleAutoSave();
    },

    /**
     * 自动保存的排程（唯一入口）：每次编辑都重置一次静默窗——「没有新编辑就不会有新尝试」，
     * 保存失败自然不会变成风暴。真身仍是 saveActive，自动与手动走同一条指纹链。
     * 静默窗读设置页那一档（utils/autosave-preference）：0 = 关（顺路把挂起那次也取消），只剩手动通路。
     */
    scheduleAutoSave(): void {
      this.cancelAutoSave();
      const delay = loadAutosaveDelay(autosavePreferenceStorage());
      if (delay <= 0) return;
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        void this.saveActive({ auto: true });
      }, delay);
    },

    /** 取消挂起的自动保存：排程、退出与切标签（P2-14）都调它（清句柄这件事只留这一处真身）。 */
    cancelAutoSave(): void {
      if (autoSaveTimer !== null) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
    },

    /**
     * 保存当前文稿（手动按钮与自动保存共用的唯一落盘通路）。
     * 两条 P0 在这里收口（2026-10-09 全仓扫描 P0-2）：`saving` 由 `finally` 收尾，
     * 抛错与 `ok:false` 走同一句理由上屏；摆态交给 `saveOutcomeOf`，逐条钉着在 utils/draft-flush。
     */
    async saveActive(options: { auto?: boolean } = {}) {
      if (!this.activeDocTab) return;
      if (options.auto === true && (this.saving || this.conflict !== null)) return;
      this.saving = true;
      const submitted = this.draft;
      let result: DocWriteResult;
      try {
        result = await writeDocIpc(this.activeDocTab, this.draft, this.savedFingerprint);
      } catch (err) {
        // IPC 抛错＝一个字都没落盘：理由上屏，指纹一步都不前进（前进就等于承认写成了）。
        // 这里**不**重排自动保存：持续失败的盘（EBUSY 一直是）会因此变成每两秒一次的写盘风暴。
        this.notice = `保存失败：${failureReasonOf(err)}`;
        this.stashActive();
        return;
      } finally {
        this.saving = false;
      }
      // 「拿到结果之后该怎么摆这一格」是纯判定，住在 utils/draft-flush 的 `saveOutcomeOf`：
      // 那里逐条钉着 dirty 何时能清、指纹何时能推进、谁才允许自己重排静默窗。这里只接线。
      const outcome = saveOutcomeOf({
        result,
        submitted,
        liveDraft: this.draft,
        auto: options.auto === true
      });
      Object.assign(this, outcome.patch);
      this.notice = outcome.notice;
      this.stashActive();
      if (outcome.reschedule) this.scheduleAutoSave();
    },

    async reloadActive() {
      if (!this.activeDocTab) return;
      const loaded = await window.mochen.readDoc(this.activeDocTab);
      this.draft = loaded.content;
      this.savedFingerprint = loaded.fingerprint;
      this.dirty = false;
      this.conflict = null;
      this.notice = "已重载盘上内容";
      this.draftsByPath[this.activeDocTab] = docStateOf(this);
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
          this.notice = `智能体已写入本章，但草稿同步失败：${failureReasonOf(err)}`;
        }
      } else this.notice = "智能体已写入本章";
      await this.refreshDocs();
    },

    stashActive() {
      if (this.activeDocTab) this.draftsByPath[this.activeDocTab] = docStateOf(this);
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

    /** book.json 可写字段的**唯一落盘通路**（铁律 6）：先写后回读，失败时 meta 一字不动、原因进 notice。 */
    async persistMeta(patch: Partial<BookMeta>, failPrefix: string): Promise<boolean> {
      if (!this.meta) return false;
      // IPC 的 send 端做结构化克隆，代理会抛「could not be cloned」⇒ 必须先 toRaw 再展开。
      const next: BookMeta = { ...toRaw(this.meta), ...patch };
      this.metaSaving = true;
      try {
        await window.mochen.saveMeta(next);
      } catch (err) {
        const reason = failureReasonOf(err);
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
     * 切权限档：判定在 `utils/meta-mode-step`，这里是渲染层唯一的 saveMeta 调用方。
     * 失败时一个字都不改（`persistMeta` 那条通路保证），原因进 notice。
     */
    async setPermissionMode(mode: PermissionMode): Promise<void> {
      const step = permissionModeStep(this.meta, mode);
      if (step.kind === "refuse") {
        this.notice = step.notice;
        return;
      }
      if (!(await this.persistMeta(step.patch, step.failPrefix))) return;
      this.notice = step.doneNotice;
      this.closePermissionMenu();
    },

    closePermissionMenu(): void {
      this.permissionMenuOpen = false;
    },

    /** 切工作模式（2026-10-05 批次 4）：先计划 ⇄ 直接动手，走 persistMeta 那一条通路。 */
    async setWorkMode(mode: WorkMode): Promise<void> {
      const step = workModeStep(this.meta, mode);
      if (step.kind === "refuse") {
        this.notice = step.notice;
        return;
      }
      if (!(await this.persistMeta(step.patch, step.failPrefix))) return;
      this.notice = step.doneNotice;
    },

    /** chip 那一枚：开着就关、关着就开。取反读 workModeOf，老书自然落在「动手」这一侧。 */
    async toggleWorkMode(): Promise<void> {
      await this.setWorkMode(workModeOf(this.meta ?? {}) === "plan" ? "act" : "plan");
    },

    /** #113c 切阶段：走 persistMeta 那一条落盘通路。刻意**不**碰 permissionMenuOpen（切阶段没资格替用户收它）。 */
    async setActiveStage(stageId: string): Promise<void> {
      const step = activeStageStep(this.meta, stageId);
      if (step.kind === "refuse") {
        this.notice = step.notice;
        return;
      }
      if (!(await this.persistMeta(step.patch, step.failPrefix))) return;
      this.notice = step.doneNotice;
    },

    /**
     * 切智能体档案（spec §5.1）：与 setActiveStage 同一条落盘通路。两条边界照设计原样：
     * 切档案**不换会话线程**（同一章仍是同一条线程），所以这里不碰任何 thread 状态；
     * 档案的 writeScope 只是上限，实际能不能落盘仍由 permissionMode 裁决（spec §5.1 约束 3）。
     */
    async setActiveProfile(profileId: string): Promise<void> {
      const step = activeProfileStep(this.meta, profileId);
      if (step.kind === "refuse") {
        this.notice = step.notice;
        return;
      }
      if (!(await this.persistMeta(step.patch, step.failPrefix))) return;
      this.notice = step.doneNotice;
    },

    setSkillDefault(id: string, on: boolean): Promise<void> {
      return applySkillDefault(this, id, on);
    },

    setSkillDisabled(id: string, disabled: boolean): Promise<void> {
      return applySkillDisabled(this, id, disabled);
    },

    /** 拖拽重排章节：先落盘，成功了屏上才跟着动（旧写法绕过唯一通路，会假重排 + 未处理拒绝）。 */
    async moveChapterByRelPath(fromRelPath: string, toIndex: number): Promise<void> {
      if (!this.meta) return;
      // 挪位与重排是纯计算，住在 utils/doc-order；这里只管「落盘 → 回读 → 屏上跟上」这一条通路。
      const order = moveOrderItem(toRaw(this.meta.chapterOrder), fromRelPath, toIndex);
      if (order === null) return;
      if (!(await this.persistMeta({ chapterOrder: order }, "章节顺序没存住"))) return;
      this.docs = sortDocsByOrder(this.docs, order);
    }
  }
});

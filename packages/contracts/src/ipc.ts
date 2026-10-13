import type { BookMeta, DocRef } from "./book.js";
import type {
  AgentOutbound,
  DecideInput,
  DecisionResult,
  SessionListItem,
  SessionLoadResult,
  StartTurnInput
} from "./agent-event.js";
import type { AppearanceSettings, AppearanceSettingsSnapshot } from "./appearance.js";
import type { ChangeEntry, ChangePruneReport } from "./changes.js";
import type { ChangeRetention, ChangeRetentionSnapshot } from "./change-retention.js";
import type { SkillContent, SkillRef, SkillSource } from "./skill.js";
import type { MarketListResult } from "./market.js";
import type { PluginListResult } from "./plugin.js";
import type { ContextKind } from "./agent-profile.js";
import type {
  ConnectionDraft,
  ModelListQuery,
  ModelListResult,
  ProfileDraft,
  ProviderSaveResult,
  ProviderView,
  VerifyResult
} from "./provider.js";
import type { ExportableDoc, ExportOptions, ExportResult } from "./export.js";
import type { BookDataKey, BookDataReadResult, BookDataWriteResult } from "./book-data.js";
import type {
  TxtImportCommitInput,
  TxtImportCommitResult,
  TxtImportPreviewResult
} from "./import.js";

export const IPC_CHANNELS = {
  bookOpen: "book:open",
  bookSaveMeta: "book:save-meta",
  docRead: "doc:read",
  docWrite: "doc:write",
  bookPick: "book:pick",
  bookCreate: "book:create",
  docCreate: "doc:create",
  /**
   * 只重算**一篇**文稿的 DocRef（P1-4 后半，2026-10-10）。
   *
   * 存在的理由就是省掉那一次整本重扫：改标题、吸收智能体写入这两条链路过去都靠 `openBook`
   * 把全本书每篇正文再读一遍，只为换树上那一根。主进程用与 `scanBook` 同一份判据算那一篇
   * （`fs-store` 的 `docRefFor`），顺手把它自己的快照也换成新值——两处同步，一次读盘。
   */
  docRefresh: "doc:refresh",
  agentStartTurn: "agent:start-turn",
  agentInterrupt: "agent:interrupt",
  agentDecide: "agent:decide",
  agentEvent: "agent:event",
  agentDiff: "agent:diff",
  providerGet: "provider:get",
  providerSave: "provider:save",
  providerConnectionRemove: "provider:connection-remove",
  providerVerify: "provider:verify",
  appOpenExternal: "app:open-external",
  appOpenWebSource: "app:open-web-source",
  providerListModels: "provider:list-models",
  providerProfileUpsert: "provider:profile-upsert",
  providerProfileRemove: "provider:profile-remove",
  providerProfileEnable: "provider:profile-enable",
  skillsList: "skills:list",
  skillsRead: "skills:read",
  /**
   * 技能市场三条（2026-10-07）。装/卸只收一个清单里的 dirName，
   * 渲染层不能传路径也不能传来源——路径由主进程按清单自己拼（见 skill-market-service.ts）。
   */
  marketList: "market:list",
  marketInstall: "market:install",
  marketUninstall: "market:uninstall",
  /**
   * 插件四条（2026-10-07 批次 5-㉚）。与技能市场同一条铁律：
   * 渲染层只递**安装名**（dirName），路径由主进程拼——传路径等于让渲染层决定读写哪。
   *
   * `plugins:toggle` 一条同时管停用与启用：`enabled: boolean` 说方向。
   * 合成一条而不是两条，是因为它们的实现只有一处差别（写/不写那份停用清单）。
   */
  pluginsList: "plugins:list",
  pluginsToggle: "plugins:toggle",
  pluginsUninstall: "plugins:uninstall",
  pluginsSource: "plugins:source",
  /** 改稿历史：列、读一条备份、回滚一条。回滚要走指纹闸，句柄就是 backupRelPath。 */
  changesList: "changes:list",
  changesRead: "changes:read",
  changesRestore: "changes:restore",
  /**
   * 保留上限（2026-10-06 批次 5-⑧）：读 / 写 / 立即清理。
   * 「立即清理」走的是**与自动淘汰同一份** `pruneChanges`——另开一条清理逻辑就等于
   * 两份「该删哪些」的判定，将来一处改了另一处不跟着（铁律 6）。
   */
  changesRetentionGet: "changes:retention-get",
  changesRetentionSave: "changes:retention-save",
  changesPruneNow: "changes:prune-now",
  agentLoadSession: "agent:load-session",
  agentListSessions: "agent:list-sessions",
  agentContextPreview: "agent:context-preview",
  appearanceGet: "appearance:get",
  appearanceSave: "appearance:save",
  saveFileExport: "file:save-export",
  buildExport: "file:build-export",
  appNotify: "app:notify",
  /**
   * 退出前的落盘握手（2026-10-09 全仓扫描 P0-6）。两条一对，方向相反：
   * `app:flush-quit-request` 是主进程**推**给渲染层的「先把稿子落盘」，
   * `app:flush-quit-done` 是渲染层**回**给主进程的结果。
   *
   * 为什么要一对而不是主进程自己写盘：未保存的字只在渲染进程的内存里，主进程看不见。
   * 为什么要拦这一次：`flushAllForQuit()` 早就存在且有用例，但主进程从来没人调它——
   * 用户点关闭时窗口直接销毁，那份兜底一行都没跑过。
   */
  appFlushQuitRequest: "app:flush-quit-request",
  appFlushQuitDone: "app:flush-quit-done",
  /**
   * 书内设定数据的读与写（2026-10-09 全仓扫描 P0-7）：笔记 / 故事圣经 / 写作目标
   * 从今往后落在**这本书的** `.mochen/data/` 里，不再住全局 localStorage。
   *
   * 两条都只收白名单里的键（`BOOK_DATA_KEYS`），路径由主进程拼——与 `market:install`、
   * `plugins:toggle` 同一条铁律。写的一侧必须把结果交回渲染层：原先三个 store 的
   * `save*()` 把失败 `catch {}` 吞掉，屏上永远显示「已保存」，这是第二条 P0-2 的病。
   */
  bookDataRead: "book-data:read",
  bookDataWrite: "book-data:write",
  /**
   * 检查应用更新（2026-10-10）。渲染层只有「关于」页那一颗按钮会调它；
   * 更新源没配置（MOCHEN_UPDATE_URL 为空）时返回 disabled，不报错——没配是常态不是故障。
   */
  updateCheck: "app:update-check",
  /**
   * 书稿回收站三条（2026-10-10）。与 `doc:trash` 同一条铁律：渲染层只递 relPath / trashName，
   * 路径由主进程按当前书根拼——「删了还能找回」靠的是移进 `<书>/.mochen/trash/`，
   * 不是 unlink。三条都与 docs 快照联动：删/还原后渲染层自己走 `doc:refresh` 重算那一篇。
   */
  docTrash: "doc:trash",
  trashList: "trash:list",
  trashRestore: "trash:restore",
  /**
   * 整书备份三条（2026-10-10）。备份 = 把整本书（`.mochen/` 除外）复制一份到
   * `<书>/.mochen/backups/book-<时间戳>/`——普通目录，Explorer 直开直拷，不赌 zip 的
   * 中文文件名编码。渲染层只递备份目录名（restore）与档位（create），路径全由主进程拼。
   */
  bookBackupCreate: "book-backup:create",
  bookBackupList: "book-backup:list",
  bookBackupRestore: "book-backup:restore",
  /**
   * TXT 导入两条（2026-10-11）。选文件与读字节只能在主进程（渲染层没有任意读盘的能力，
   * 这正是沙箱的意义），所以「预览」由主进程一次做完：弹选文件框 → 读字节 → 探编码 → 切章。
   * 「提交」只收标题与正文——`chapters/<标题>.md` 的路径由主进程用 planDocRelPath 拼，
   * 与 market:install、plugins:toggle 同一条铁律：渲染层递不了路径。
   */
  importPreview: "import:pick-preview",
  importCommit: "import:commit"
} as const;

/** 退出握手里有稿子没能落盘的那一篇：点名到文件与原因，好让人自己拍板走不走。 */
export interface FlushQuitBlocked {
  relPath: string;
  message: string;
}

/**
 * 渲染层对「先把稿子落盘」的回话。
 *
 * 这份形状与渲染层 `flushAllBeforeQuit()` 的返回值一致，但跨进程来的字段一律当不可信：
 * 判定（以及「形状不对就放行退出，不许把用户卡在应用里」）写在 `main/quit-flush.ts`。
 */
export interface FlushQuitReply {
  ok: boolean;
  blocked: FlushQuitBlocked[];
}

export interface BookOpenResult {
  rootPath: string;
  meta: BookMeta;
  docs: DocRef[];
}

/**
 * app:update-check 的返回（2026-10-10）。四档如实分报，不压成布尔：
 * - `dev`：开发版不检查；
 * - `disabled`：没配更新源（常态，不是故障）；
 * - `up-to-date` / `available`：远端 latest 与当前版本比对的结果；
 * - `error`：网络/解析失败，`note` 带一句能照着做的中文。
 * 自动下载刻意关掉：检查只「说」，下载与安装要用户自己动身。
 */
export interface UpdateCheckResult {
  status: "dev" | "disabled" | "up-to-date" | "available" | "error";
  version: string;
  latestVersion: string | null;
  note: string;
}

/** doc:trash 的返回：ok 侧带回收站里的条目名（渲染层不需要知道盘上完整路径）。 */
export type DocTrashResult =
  | { ok: true; trashName: string }
  | {
      ok: false;
      reason: "no-book" | "not-a-doc" | "invalid-path" | "outside-book" | "io-error";
      message: string;
    };

/** 回收站里的一条：title 用于显示，relPath 用于说明「还原会回到哪儿」。 */
export interface TrashEntry {
  trashName: string;
  relPath: string;
  title: string;
  trashedAt: string;
}

export type TrashListResult =
  { ok: true; entries: TrashEntry[] } | { ok: false; reason: "no-book"; message: string };

/** trash:restore 的返回：ok 侧带还原后的 relPath，渲染层拿它走 doc:refresh。 */
export type TrashRestoreResult =
  | { ok: true; relPath: string }
  | {
      ok: false;
      reason: "no-book" | "not-found" | "target-exists" | "io-error";
      message: string;
    };

/** 整书备份里的一条：name 是备份目录名（还原时原样递回），createdAt 是从名字里解出的人话时间。 */
export interface BookBackupEntry {
  name: string;
  createdAt: string;
}

/**
 * book-backup:create 的返回。`name: null` = daily 档发现今天已经备过，刻意没再备一份
 * （这是正常结果不是失败）；manual 档永远真的备一份。
 */
export type BookBackupCreateResult =
  | { ok: true; name: string | null; fileCount: number }
  | { ok: false; reason: "no-book" | "io-error"; message: string };

export type BookBackupListResult =
  | { ok: true; entries: BookBackupEntry[] }
  | { ok: false; reason: "no-book" | "io-error"; message: string };

/**
 * book-backup:restore 的返回：把选中的备份复制到**书旁的新目录**
 * （`<书名>-恢复自备份-<时间戳>`），绝不碰当前打开的这本书——恢复期间原书保持可写。
 */
export type BookBackupRestoreResult =
  | { ok: true; destName: string }
  | { ok: false; reason: "no-book" | "not-found" | "io-error"; message: string };

export interface DocContent {
  relPath: string;
  content: string;
  fingerprint: string;
}

export type DocWriteResult =
  | { ok: true; fingerprint: string; backupRelPath: string | null }
  | { ok: false; reason: "stale"; currentFingerprint: string }
  | { ok: false; reason: "invalid-path" | "outside-book" | "io-error"; message: string };

/**
 * doc:create 的返回：ok 侧带上新文件的指纹，渲染层拿它直接 openDocTab，不用再读一次盘。
 *
 * `doc` 是 P1-4 后半（2026-10-10）加的那一根：主进程建完这一篇**本来就算过**它的 DocRef
 * （`docRefFor`，与 `scanBook` 同一份判据），过去只更新自己的快照、不捎给渲染层，于是渲染层
 * 只能用 `refreshDocs()`＝再走一次 `openBook` 把整本书每篇正文读一遍来换这一根。
 *
 * - 它是**跨进程字段**，渲染层不默认相信：`docRefSchema`（contracts/book.ts）验形状，验不过就退回整本重扫；
 * - `null`＝主进程这次给不出这一篇的引用（写完却读不回、重扫也没有它）。这不是「没有这一章」：
 *   文件确实建成了，ok=true 说的是真话；缺的只是引用，渲染层必须自己重扫一次（失败要说话，不许挂假稿件）。
 */
export type DocCreateResult =
  | { ok: true; relPath: string; fingerprint: string; doc: DocRef | null }
  | {
      ok: false;
      reason:
        "no-book" | "invalid-path" | "outside-book" | "not-doc-dir" | "already-exists" | "io-error";
      message: string;
    };

/**
 * doc:refresh 的返回：只重算一篇，绝不带整本清单回来（那正是这一刀要省掉的读放大）。
 *
 * `doc: null`＝盘上这一篇读不回（外力删除、改名、占用）。这不是失败：请求本身做到了，
 * 如实说「算不出」，由渲染层退回整本温和重扫；在这儿倒推一根 DocRef 就是造假稿件（P0 那批病）。
 */
export type DocRefreshResult =
  | { ok: true; doc: DocRef | null }
  | {
      ok: false;
      reason: "no-book" | "invalid-path" | "outside-book" | "io-error";
      message: string;
    };

/** book:create 的输入：目录来自系统选目录对话框（book:pick），标题由用户起。 */
export interface BookCreateInput {
  directory: string;
  title: string;
}

/** book:create 的返回：成功侧直接复用 openBook 的标准结果，渲染层一套填充逻辑两用。 */
export type BookCreateResult = { ok: true; book: BookOpenResult } | { ok: false; message: string };

/**
 * agent:context-preview 的入参：**看**上下文要传什么。刻意不带任何正文——
 * 渲染层只想知道「会装多少」，正文由主进程自己在 startTurn 时装配。
 */
export interface ContextPreviewQuery {
  /** 当前打开的文稿；null = 独立线程（不带文稿上下文）。 */
  docRelPath: string | null;
  /** 书级当前档案 id；null 时由主进程按 阶段 → 阶段默认 → 兜底 解析。 */
  profileId: string | null;
  /** 显式挂入的文稿（@ 引用 / 加入当前上下文）。 */
  pinned?: readonly string[];
}

/** 预览里的一行：只有标签与字数，**不含正文**（渲染层不需要正文，也不该拿到）。 */
export interface ContextPreviewItem {
  kind: ContextKind;
  relPath: string;
  title: string;
  chars: number;
  active: boolean;
}

/**
 * 历史切片在占用条上的那一项（P1-3）。
 * 只回数字不回正文——与 ContextPreviewItem 同一口径：渲染层不需要也不该拿到历史正文。
 */
export interface ContextHistoryStat {
  /** 这一轮**实际发给模型**的历史条数（切片后的 kept）。 */
  entries: number;
  /** kept 的字符数：人话展示用「约 M 字」，不是 token。 */
  chars: number;
  /** kept 的 token 估算：占用条把历史这一格算进去，不许再当免费。 */
  approxTokens: number;
  /** 被切掉的条数/字数；0 或缺失＝没截断，不许谎报「丢了」。 */
  droppedCount?: number;
  droppedChars?: number;
}

/** agent:context-preview 的返回：占用条（spec §5「token 估算 + 已装配条目数」）的真身。 */
export interface ContextPreview {
  profileId: string;
  profileName: string;
  items: ContextPreviewItem[];
  chars: number;
  approxTokens: number;
  /** 没开书 / 装不出任何条目时为 true；渲染层据此隐藏整条占用条。 */
  empty: boolean;
  /**
   * 会话历史这一路的占用（P1-3 零截断）。
   * **可选**字段：老渲染层拿不到它就是 undefined，旧历史回放不受影响——
   * 新字段只加不改，契约里已有序列化路径一个字都不动。
   */
  history?: ContextHistoryStat;
}

export interface RendererApi {
  pickBookDirectory(): Promise<string | null>;
  openBook(rootPath: string): Promise<BookOpenResult>;
  /**
   * 在用户选好的目录里建新书骨架（book.json + 五个分组目录），成功返回与 openBook 同构的结果。
   * 目录非空或已有 book.json 会被拒绝——绝不往别人家的目录里盖东西。
   */
  createBook(input: BookCreateInput): Promise<BookCreateResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  /** 按已规划好的书内路径建一篇空文档（frontmatter title 用用户起的名字）；文件已存在会被拒绝，绝不盖写。 */
  createDoc(relPath: string, title: string): Promise<DocCreateResult>;
  /**
   * 只重算**一篇**文稿的 DocRef（P1-4 后半）。
   * 改完标题、吸收智能体写入之后要用它取代 `openBook` 那次整本温和重扫：主进程用与扫描同一份判据
   * 算这一篇，一次读盘；算不出（盘上没这一篇）回 `doc:null`，调用方自己退回重扫，不许在渲染层倒推。
   */
  refreshDoc(relPath: string): Promise<DocRefreshResult>;
  /**
   * 读这本书里的设定数据（笔记 / 圣经 / 目标），键必须在白名单里。
   *
   * 没打开作品目录时返回 `no-book`（**不是** `json:null`）：后者会被渲染层读成「这本书是空的」，
   * 于是把上一本书的内容迁移进来——串台正是这一波要治的病。
   */
  readBookData(key: BookDataKey): Promise<BookDataReadResult>;
  /** 整份写回某一枚键；失败带原因回来，调用方必须把它显示出来（不许再 `catch {}`）。 */
  writeBookData(key: BookDataKey, json: string): Promise<BookDataWriteResult>;
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interruptTurn(turnId: string): Promise<boolean>;
  decideProposal(input: DecideInput): Promise<DecisionResult>;
  /** 提案的统一 diff 文本；主进程算好，渲染层不 import agent-runtime（见 Task 1 的 agentDiff 说明）。 */
  proposalDiff(proposalId: string): Promise<string>;
  /**
   * 只读回放：把这条线程落盘的 JSONL 读回来，永不动盘、永不重建可批准的待审队列（D1）。
   * 传 sessionId 时精确读那一条（历史对话面板点开某次会话），并把这条线程的写入目标改到它；
   * 读不到就 found:false，绝不退化成「最近那条」。
   */
  loadSession(threadKey: string, sessionId?: string): Promise<SessionLoadResult>;
  /** 本书全部会话的一行概览（时间倒序）；没打开作品目录时是空数组。 */
  listSessions(): Promise<SessionListItem[]>;
  /**
   * 上下文占用条的数据源（spec §5「token 估算 + 已装配条目数」）。
   * 只回标签与字数、**不回正文**；没开书时返回 empty:true，渲染层据此隐藏整条。
   */
  contextPreview(query: ContextPreviewQuery): Promise<ContextPreview>;
  providerView(): Promise<ProviderView>;
  /**
   * 新建或改一条连接（地址 + 密钥 + 头形态）；apiKey null = 保留现有密钥、"" = 明确清空。
   *
   * **连着刚存进去那条的 id 一起回来**，别让调用方回头去视图里认。
   * 同一家供应商开第二个账号是常事，那时地址一模一样，靠地址反查必然认错那条，
   * 模型就会挂到用户没在配的那条连接上。
   */
  providerSave(draft: ConnectionDraft): Promise<ProviderSaveResult>;
  /** 删一条连接：挂在它下面的模型档案一起删，密钥一并清掉。 */
  providerConnectionRemove(connectionId: string): Promise<ProviderView>;
  /**
   * 拉远端可选模型名（`{baseURL}/models`，只在主进程出网）；失败回一句中文理由，不抛过 IPC。
   * query 是对话框里还没保存的草稿（地址/密钥/头形态），或指定一条已存连接按它体检。
   * 守卫在主进程——已存密钥只发往**它自己那条连接的地址**。
   */
  listModels(query?: ModelListQuery): Promise<ModelListResult>;
  /**
   * 连通性体检（软校验）：**只回答「现在连不连得上」，不决定能不能存**。
   * 硬校验会把「服务没起」「还没买套餐」「网络不通」统统变成死路，而用户完全可能
   * 想先把配置填好、回头再连。结果分三档，别压成布尔。
   */
  providerVerify(connectionId: string): Promise<VerifyResult>;
  /**
   * 打开某家供应商的「获取 API 密钥」页面。
   *
   * **只收 providerId，不收 URL**——这是本仓处理「让系统打开一个外部链接」的口径：
   * 渲染层递任意 URL 出去等于给了一条能把 `file://`、内网地址、
   * 或者别的应用的协议处理器一起叫醒的路子。收 id、由主进程查 `PROVIDER_PRESETS` 取那一行，
   * 表里没有就拒。预置表是唯一真身（铁律 6），这里不写第二份。
   */
  openProviderKeyPage(providerId: string): Promise<boolean>;
  /**
   * 点开一条联网搜索的来源（2026-10-06 批次 5-⑨）。
   *
   * **这是本仓唯一一条渲染层递 URL 出去的通道**，与上一条的口径刻意相反：
   * 密钥页地址全在预置表里，收 id 就够；来源地址是搜索站当场给的，预置表套不上，
   * 不给这条路用户就只能从纯文本里手抄链接。
   *
   * 安全靠协议白名单而不是「URL 可信」：只放行 http/https，其余（file/javascript/data/
   * 自注册 scheme）一律在主进程拒掉；带 `user:pass@` 的也不放行。
   * 判定实现见 `apps/desktop/src/main/web-source-link.ts`，那里有两条口径为什么相反的完整说明。
   */
  openWebSource(url: string): Promise<boolean>;
  /** 添加一条模型档案并设为启用（同一条连接里同名幂等）；连接还没配过会被拒绝。 */
  profileUpsert(draft: ProfileDraft): Promise<ProviderView>;
  /** 删除一条模型档案；删的是启用条时就没有启用模型了，发请求会得到诚实报错。 */
  profileRemove(id: string): Promise<ProviderView>;
  /** 启停一条模型档案（互斥：启用某条时其余自动停用）。 */
  profileEnable(id: string, enabled: boolean): Promise<ProviderView>;
  /**
   * 技能库只读浏览（spec §11）：全局与书内两个来源合并去重，**书内同名优先**。
   * 没开书时只回全局那一份（书内来源要书目录才谈得上）。
   */
  listSkills(): Promise<SkillRef[]>;
  /**
   * 读一份技能正文。只读、不写；relPath 必须逐字是 `<单层目录名>/SKILL.md`，
   * 解析后必须仍在该来源的 skills 目录内。超出 64 KB 截断并标 truncated。
   */
  readSkill(source: SkillSource, relPath: string): Promise<SkillContent>;
  /**
   * 技能市场：列内置清单（带「装没装」与「会不会被书内同名盖住」两态）。
   * 与 `listSkills` 分开是刻意的——那张表是**盘上有什么**（用户自己放的也在内），
   * 这张是**我们提供什么**；合成一份会让「市场里有的」和「你有的」再也分不清。
   */
  listMarket(): Promise<MarketListResult>;
  /** 装一条（只认清单里的 dirName）。返回一句中文结果，成功失败都是一句话。 */
  installMarketSkill(dirName: string): Promise<string>;
  /** 卸一条（只认清单里的 dirName，且只删全局那一份）。返回一句中文结果。 */
  uninstallMarketSkill(dirName: string): Promise<string>;
  /**
   * 插件清单（2026-10-07 批次 5-㉚）：盘上每个插件目录一条，含**装不装得上**、
   * 它带了哪几个工具、以及是不是内置随带的。停用的也在清单里（带 `disabled`），
   * 因为用户要看得见「有个东西我停用了」——把它从清单里藏起来就等于让人以为它没了。
   */
  listPlugins(): Promise<PluginListResult>;
  /**
   * 停用/启用一个插件。**停用之后模型那一轮真的调不到它的工具**：
   * 主进程在挂载前就不挂它，它的工具不进工具表（不是「还在、只是回一个失败」）。
   */
  togglePlugin(dirName: string, enabled: boolean): Promise<string>;
  /** 卸载一个插件（删掉它的整个目录）。内置的卸掉后下次启动会重新种回来。 */
  uninstallPlugin(dirName: string): Promise<string>;
  /** 读一个插件的源码，给卡片上的「看一眼它写了什么」用。只读，且只读插件目录内。 */
  readPluginSource(dirName: string): Promise<{ content: string; truncated: boolean }>;
  /**
   * 列出这本书的改稿历史，最新在前。每条都带 `backupRelPath`——那是从盘上读回来的句柄。
   * 没打开作品目录时是空表，不抛。
   */
  listChanges(): Promise<ChangeEntry[]>;
  /** 读一条备份的正文，给回滚前预览。只读。 */
  readChange(backupRelPath: string): Promise<{ content: string; fingerprint: string }>;
  /**
   * 把某篇文稿回滚到一条备份的内容。
   * `expectedFingerprint` 传**盘上此刻**的指纹（与 docWrite 同一口径）：对不上说明这之后还有人改过，
   * 回 `stale` 而不是盖掉。回滚本身也会先给当前内容存一份，所以「撤销撤销」还能回来。
   */
  restoreChange(
    backupRelPath: string,
    expectedFingerprint: string
  ): Promise<DocWriteResult & { restoredFrom: string }>;
  /**
   * 改稿历史的保留上限（2026-10-06 批次 5-⑧）。
   *
   * `persisted:false` 与外观同一口径：盘上还没有、或读回来不合法 —— 这时给的是默认档，
   * 界面上要如实说「当前是默认」，不能让人以为是自己设的。
   */
  changesRetentionGet(): Promise<ChangeRetentionSnapshot>;
  changesRetentionSave(retention: ChangeRetention): Promise<ChangeRetention>;
  /**
   * **立即按当前上限清理一次**，返回真删掉多少条。
   *
   * 走的是与自动淘汰**同一份** `pruneChanges`（fs-store）：另开一条清理逻辑就等于
   * 两份「该删哪些」的判定。回 `{removed, kept, freedBytes}` 让界面能说清「清了多少」，
   * 而不是只回一句「已清理」——清掉 0 条和清掉 300 条对用户是两件事。
   */
  changesPruneNow(): Promise<ChangePruneReport>;
  /** 返回取消订阅的函数；渲染层拿不到 ipcRenderer。 */
  onAgentEvent(listener: (payload: AgentOutbound) => void): () => void;
  /**
   * 退出握手（2026-10-09 P0-6）：主进程拦下这一次关闭，请渲染层把每篇脏稿落盘。
   * 渲染层收到后跑 `flushAllForQuit()`，结果经 `quitFlushDone` 递回来；
   * 不回话＝主进程超时后放行退出（拦死退出比丢字更糟）。
   */
  onQuitFlushRequest(listener: () => void): () => void;
  /** 把这一趟落盘的结果交给主进程，由它决定放行退出还是先问人。 */
  quitFlushDone(reply: FlushQuitReply): Promise<void>;
  /** 读外观设置（浅/深两套主题 + 字体 + 跟随系统模式）。persisted:false 表示盘上还没有或读不回，settings 是默认值。 */
  appearanceGet(): Promise<AppearanceSettingsSnapshot>;
  /** 整份写回外观设置；渲染层只递合法的 AppearanceSettings，主进程落 appearance.json。 */
  appearanceSave(settings: AppearanceSettings): Promise<void>;
  /**
   * 应用内导出文件 —— 主进程弹保存对话框并写文件。
   *
   * `content` 收 `string | Uint8Array`：EPUB 是个 zip 包（2026-10-05 批次 5-②），
   * 按 utf-8 写盘就是乱码。不新开通道，判据就落在这一行的联合类型上。
   */
  saveFile(content: string | Uint8Array, filename: string, title?: string): Promise<boolean>;

  /**
   * 组装导出内容（2026-10-05 批次 5-②）。
   *
   * **为什么组装挪到主进程**：EPUB 是 zip 包，要 `node:zlib`。渲染层 import 那条链
   * 会把 Node 模块打进浏览器 bundle ⇒ 首屏白屏（2026-10-05 批次 3 踩过同一个根因，
   * `tools/check-package-boundary.mjs` 当场报出来）。而且「跑字节的活在主进程」本来就对。
   * 渲染层只留纯函数（估大小、算文件名、markdown→html），走 `@mochen/fs-store/export-shared`。
   */
  buildExport(
    docs: ExportableDoc[],
    meta: BookMeta | null,
    options: Partial<ExportOptions>
  ): Promise<ExportResult>;
  /** 主进程系统通知 */
  notify(title: string, body: string): void;
  /**
   * 检查应用更新（2026-10-10）。更新源由主进程从 MOCHEN_UPDATE_URL 读，
   * 渲染层递不了 URL——与密钥页「只收 id 不收地址」同一条口径。
   * 结果四档如实分报（见 UpdateCheckResult），没有配置时回 disabled 而不是报错。
   */
  updateCheck(): Promise<UpdateCheckResult>;
  /**
   * 把一篇文稿移进这本书的回收站（`<书>/.mochen/trash/`，2026-10-10）。
   * 只认**扫描快照里真实存在**的文稿——递 book.json 或任意书内路径进来都会被拒。
   * 删除因此不需要「确认」弹窗：东西在回收站里，还原就有。
   */
  trashDoc(relPath: string): Promise<DocTrashResult>;
  /** 列回收站（这本书的）；没开书回 no-book，不抛。 */
  listTrash(): Promise<TrashListResult>;
  /** 还原一条到原路径；原路径已有人占位时回 target-exists，绝不盖写。 */
  restoreTrash(trashName: string): Promise<TrashRestoreResult>;
  /**
   * 整书备份（2026-10-10）。`mode: "manual"` 永远真备一份；`"daily"` 发现今天已备过
   * 就回 `{ ok: true, name: null }`（开书时的自动档用这个，一天至多一份）。
   */
  createBookBackup(mode: "manual" | "daily"): Promise<BookBackupCreateResult>;
  /** 列这本书的备份（新的在前）；没开书回 no-book，不抛。 */
  listBookBackups(): Promise<BookBackupListResult>;
  /** 把一份备份复制到书旁的新目录；目标目录已存在时自动加序号，绝不盖写任何已有内容。 */
  restoreBookBackup(name: string): Promise<BookBackupRestoreResult>;
  /**
   * TXT 导入预览（2026-10-11）：主进程弹选文件框、读字节、探编码、切章，一次带整份预览回来。
   * `canceled` 是用户点了取消——这是正常操作不是故障，渲染层照旧停在当前步。
   */
  importTxtPreview(): Promise<TxtImportPreviewResult>;
  /** 把预览确认后的章目落成 `chapters/` 下的文稿；重名在写盘前整批拦下（all-or-nothing）。 */
  importTxtCommit(input: TxtImportCommitInput): Promise<TxtImportCommitResult>;
}

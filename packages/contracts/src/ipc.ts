import type { BookMeta, DocRef } from "./book.js";
import type { BookProject } from "./book-project.js";
import type {
  AgentOutbound,
  DecideInput,
  DecisionResult,
  DiscardDraftsInput,
  DraftSetResult,
  PickDraftInput,
  SessionListItem,
  SessionLoadResult,
  StartTurnInput
} from "./agent-event.js";
import type { AppearanceSettings, AppearanceSettingsSnapshot } from "./appearance.js";
import type { ChangeDiffResult, ChangeEntry, ChangePruneReport } from "./changes.js";
import type { ChangeRetention, ChangeRetentionSnapshot } from "./change-retention.js";
import type { SkillContent, SkillRef, SkillSource } from "./skill.js";
import type { SkillRedeemResult } from "./skill-redeem.js";
import type {
  RemoteInstallResult,
  RemoteListResult,
  RemoteSkillPreview,
  SkillAuthorDraft,
  SkillAuthorResult,
  WebpageSkillResult
} from "./skill-source.js";
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
import type { RecentBooksSnapshot } from "./recent-books.js";
import type {
  TxtImportCommitInput,
  TxtImportCommitResult,
  TxtImportPreviewResult
} from "./import.js";
import type { MaterialsFetchResult, MaterialsSearchResult } from "./materials-web.js";
import type {
  WebdavConfigInput,
  WebdavConfigSnapshot,
  WebdavListResult,
  WebdavPullResult,
  WebdavPushResult,
  WebdavVerifyResult
} from "./webdav.js";

export { IPC_CHANNELS } from "./ipc-channels.js";

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
 * book:replace-all 的输入（2026-10-15）。
 *
 * 只收**要找的那段字面文本**与**换成什么**（外加「区不区分大小写」）：
 * 不收 relPath 清单——要动哪几篇由主进程按自己的文稿快照决定，理由写在通道表那一段注释里。
 */
export interface BookReplaceInput {
  /** 要找的字面文本。空串会被拒（空模式会匹配每一处间隙，那是切碎不是替换）。 */
  query: string;
  /** 换成什么。空串＝删掉，这是合法且常用的输入。 */
  replacement: string;
  /** 区分大小写；默认 false。 */
  caseSensitive?: boolean;
}

/**
 * 没被替换掉的那一篇：`stale` = 我读完之后有人改过它（没有盖掉别人的字）；
 * `failed` = 读或写这一步本身失败（含 realpath 判到书外）。
 */
export interface BookReplaceSkipped {
  relPath: string;
  title: string;
  reason: "stale" | "failed";
  message: string;
}

/**
 * book:replace-all 的回执（2026-10-15）。
 *
 * 【为什么不是全有全无】整本书一个事务在本仓没有实现（也没有意义）：真出事的时候，
 * 每篇改前的样子都已经在改稿历史里了，用户要的是**如实知道哪几篇没换成**，
 * 而不是「全书回滚」那一套（那会把期间用户自己保存的别的改动一起抹掉）。
 *
 * `ok:true` 说的是「这一趟跑完了」，**不是**「每一篇都换成了」——后者由 skipped 如实报出。
 */
export type BookReplaceResult =
  | {
      ok: true;
      /** 这一趟扫过几篇（当前书的文稿快照条数）。 */
      scannedDocs: number;
      /** 真正换掉内容的篇数（一处都没命中的篇不计）。 */
      changedDocs: number;
      /** 全书实际换掉的处数。 */
      replacedCount: number;
      skipped: BookReplaceSkipped[];
    }
  | { ok: false; reason: "no-book" | "invalid-input" | "io-error"; message: string };

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
  /** 开书立项（W-07）：可选六格；跳过立项时不传，建书流程与原流程逐字一致。 */
  project?: BookProject;
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
  /**
   * 本线程显式挂入的**技能 id**（`${source}:${dirName}`），与 startTurn 的 `skillPaths`
   * 同一个来源（渲染层传的就是 `skillPathsOf(threadKey)`）。
   *
   * 2026-11-10 复查时这条注释曾写作「显式挂入的文稿」，照着它去接技能库索引就会把
   * 「扣掉已挂入」写成「扣掉文稿」——两套 id 长得很像（都是字符串），错了也不会报错，
   * 只会让同一份技能在提示词里出现两遍。记在这里。
   */
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
  /**
   * 「技能库里还有哪些没挂入」那一段的计量（2026-11-10）。**可选**：老渲染层读不到就当没有。
   *
   * 它不属于 `items`——那些行是「进了上下文的正文或清单」，而这一段只有名字与一句说明。
   * 但它确实占了系统提示的字数，所以占用条必须把它算进分子，否则读数会少报一截。
   */
  skillIndex?: { chars: number; shown: number; total: number };
  /**
   * 占用条「窗口压力」那一行的**分母**（tokens）。
   *
   * 为什么由主进程递而不是渲染层自己算：那枚保守假设窗口住在
   * `packages/agent-runtime/src/history-window.ts`（`UPSTREAM_WINDOW_TOKENS`），而包边界闸
   * 禁止渲染层 import agent-runtime（它只在主进程跑）。历史切片用的就是这一个数——
   * 把百分比的分母也交同一条路递出来，「离被切还有多远」才是**真那个闸门的刻度**，
   * 而不是另起一套口径。**渲染层绝不许再抄一份 24000**（铁律 6）。
   *
   * **可选**且是**假设值**，不是模型真实上限：拿不到分母时压力行整条不显形，
   * 宁可缺一行读数，也不许拿一个猜出来的数骗人。
   */
  windowApproxTokens?: number;
}

export interface RendererApi {
  pickBookDirectory(): Promise<string | null>;
  openBook(rootPath: string): Promise<BookOpenResult>;
  /**
   * 在用户选好的目录里建新书骨架（book.json + 五个分组目录），成功返回与 openBook 同构的结果。
   * 目录非空或已有 book.json 会被拒绝——绝不往别人家的目录里盖东西。
   */
  createBook(input: BookCreateInput): Promise<BookCreateResult>;
  /**
   * 作品库（2026-10-21）：最近打开/新建过的书，按时间倒序。
   * 主进程在 `book:open` / `book:create` 成功那一刻自己记账，渲染层不需要也不允许再报一次。
   */
  listRecentBooks(): Promise<RecentBooksSnapshot>;
  /** 只把一条从作品库清单里移除（不删书、不碰盘上任何文件）；返回移除后的整份清单。 */
  forgetRecentBook(rootPath: string): Promise<RecentBooksSnapshot>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  /**
   * 全书替换（2026-10-15）：把当前这本书里每一篇的字面命中一次性换掉。
   *
   * 逐篇「读 → 换 → 写」，每篇都走 `doc:write` 那一套（指纹守卫 + 整篇备份 + 原子写）：
   * 谁在我读完之后改了那一篇，我就报 `stale` 不动它，绝不盖掉人家刚写的字。
   * 回执如实分报扫了几篇/改了几篇/共几处/哪几篇没动，**不是**全有全无。
   */
  replaceAllInBook(input: BookReplaceInput): Promise<BookReplaceResult>;
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
  /**
   * 选定多稿采样里的某一稿并落盘（P0-②）。只递句柄与稿序号——正文由主进程按集里存的
   * 原始事件经既有提案全链路落盘，渲染层递不回正文（见 `agentPickDraft` 通道那段注释）。
   * 同一集只能落一次：第二次回 `gone`。
   */
  pickDraft(input: PickDraftInput): Promise<DraftSetResult>;
  /** 丢弃整集候选：一个字都不落盘，只把集删掉。 */
  discardDrafts(input: DiscardDraftsInput): Promise<DraftSetResult>;
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
   * 兑换一段离线自包含的兑换码：只递一整串字符串，装到全局技能目录由主进程解码后自己拼。
   * 结果成功失败都带一句中文 notice（渲染层直接上屏），不抛过 IPC。
   */
  redeemSkill(code: string): Promise<SkillRedeemResult>;
  /**
   * 列一个网上技能源里有哪些技能（2026-11-10）。入参是「内置源的 id」或「一段地址」，
   * 两种都由主进程用 `sourceUrlOf` 归一成地址再解析——渲染层不拼 URL，也不猜目录名。
   * 正文不在这一条里：点开某一条才取（见 `previewRemoteSkill`），列表不该拖着一堆文本。
   */
  listRemoteSkills(idOrUrl: string): Promise<RemoteListResult>;
  /**
   * 取一份远端技能的预览：名字、说明、会写进盘的那份全文，以及**实际**从哪个地址取到的
   * （raw 走镜像回退时与粘进来的地址不同，这件事必须让人看见）。
   * 装之前先预览，是这个通道存在的唯一理由：不许出现「预览的是 A、装进来的是 B」。
   */
  previewRemoteSkill(url: string): Promise<RemoteSkillPreview>;
  /** 把远端那一份装进全局技能目录。已存在同名就拒，不覆盖用户手里那份。 */
  installRemoteSkill(url: string): Promise<RemoteInstallResult>;
  /**
   * 网页转技能（2026-11-10）：递一条网页 URL，主进程抓正文、剥纯文本、补 frontmatter
   * 落进全局技能目录。抓不到、剥不出正文、同名已装都回 ok=false 加一句中文原因；
   * 正文过长时只装前段并如实回报（`truncated`）。
   */
  convertWebpageSkill(url: string): Promise<WebpageSkillResult>;
  /**
   * 自己写一份技能并落盘（全局技能目录）。frontmatter 由主进程按名字/说明/阶段拼，
   * 不用手写 YAML；同名已存在时默认拒，`overwrite` 才覆盖。
   */
  saveAuthoredSkill(draft: SkillAuthorDraft): Promise<SkillAuthorResult>;
  /**
   * 删掉全局技能目录里的一份（要求该目录里真有 SKILL.md）。
   * 内置市场的卸载通道只认它自己的清单，网上装的与自写的都删不掉，这条补的就是它。
   */
  removeSkill(dirName: string): Promise<SkillAuthorResult>;
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
   * 把一条备份与**盘上此刻**的那一篇做逐行对比，返回 unified diff 文本。只读。
   *
   * 方向固定 `改前 → 现在`：于是 `+` 是现在才有的行、`-` 是现在已经没有的行，
   * 与提案卡那套 `proposalDiff` 同一读法（那边是 `原文 → 新稿`），界面不必两套颜色。
   * 为什么不在渲染层算：见 `contracts/changes.ts` 的 `ChangeDiffResult`。
   */
  diffChange(backupRelPath: string, docRelPath: string): Promise<ChangeDiffResult>;
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
  /**
   * 素材库联网搜索（2026-10-24）：面板里直接搜、结果直接加成素材卡——不绕对话、不等模型。
   * 出网仍只在主进程（`web-search.ts` 那条源链）；搜不着或源不能用时回 `{ ok:false, message }`，不抛。
   */
  materialsSearch(query: string): Promise<MaterialsSearchResult>;
  /**
   * 取一条网页的正文（2026-10-24）。搜索只给摘要，落卡前要抓全文——抓取在主进程
   * （`web-read.ts` 那条链），渲染层不碰网络。抓不到时回 `{ ok:false, message }`，不抛。
   */
  materialsFetch(url: string): Promise<MaterialsFetchResult>;
  /**
   * 读 WebDAV 配置快照（2026-10-15）。
   *
   * 密钥不回——`hasPassword` 是渲染层决定那一栏显示「已保存」还是「待填写」的全部依据。
   * 与 `appearanceGet` 同一档口径：盘上没有 / 读不回时 `persisted: false` + 默认空配置，
   * 不抛、不阻塞启动。
   */
  webdavConfigGet(): Promise<WebdavConfigSnapshot>;
  /**
   * 整份写回 WebDAV 配置；`password` 三态见 `WebdavConfigInput` 的注释。
   *
   * 与 `appearanceSave` 同款：失败带原因回来，渲染层必须显示出来，不许再 `catch {}`。
   */
  webdavConfigSave(input: WebdavConfigInput): Promise<void>;
  /**
   * 连通性体检（软校验）：**只回答「现在连不连得上」，不决定能不能存**。
   * 与 `providerVerify` 同一条铁律：硬校验会把「服务没起」「凭据不对」全压成死路，
   * 而用户完全可能想先把配置填好、回头再连。结果分五档如实报。
   */
  webdavVerify(): Promise<WebdavVerifyResult>;
  /**
   * 推一份新整书备份到远程：复用 `createBookBackup("manual")` 做本地新备份，
   * 然后递归 PUT 到 `<url>/<当前书 meta.id>/<book-时间戳>/`。回执如实分报推了多少文件。
   */
  webdavPush(): Promise<WebdavPushResult>;
  /**
   * 列远程这本书已有的备份（PROPFIND `<url>/<当前书 meta.id>/`，新的在前）。
   * 没开书 / 没配置都如实分档报，不抛。
   */
  webdavList(): Promise<WebdavListResult>;
  /**
   * 把远程某一份备份拉回本地（`restoreBookBackup` 的远程镜像）。
   *
   * 只递**远程目录名**（`book-<时间戳>` 那一串，由上面的 list 给出），不递服务器地址、
   * 不递盘上路径：落点与远程位置都由主进程按配置与当前书根自己拼。落到书的旁边一份新目录
   * （`<书名>-恢复自远程备份-<时间戳>`，重名顺位加号），**绝不盖写已有内容**。
   */
  webdavPull(name: string): Promise<WebdavPullResult>;
}

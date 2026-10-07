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

export const IPC_CHANNELS = {
  bookOpen: "book:open",
  bookSaveMeta: "book:save-meta",
  docRead: "doc:read",
  docWrite: "doc:write",
  bookPick: "book:pick",
  bookCreate: "book:create",
  docCreate: "doc:create",
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
  appNotify: "app:notify"
} as const;

export interface BookOpenResult {
  rootPath: string;
  meta: BookMeta;
  docs: DocRef[];
}

export interface DocContent {
  relPath: string;
  content: string;
  fingerprint: string;
}

export type DocWriteResult =
  | { ok: true; fingerprint: string; backupRelPath: string | null }
  | { ok: false; reason: "stale"; currentFingerprint: string }
  | { ok: false; reason: "invalid-path" | "outside-book" | "io-error"; message: string };

/** doc:create 的返回：ok 侧带上新文件的指纹，渲染层拿它直接 openDocTab，不用再读一次盘。 */
export type DocCreateResult =
  | { ok: true; relPath: string; fingerprint: string }
  | {
      ok: false;
      reason:
        "no-book" | "invalid-path" | "outside-book" | "not-doc-dir" | "already-exists" | "io-error";
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

/** agent:context-preview 的返回：占用条（spec §5「token 估算 + 已装配条目数」）的真身。 */
export interface ContextPreview {
  profileId: string;
  profileName: string;
  items: ContextPreviewItem[];
  chars: number;
  approxTokens: number;
  /** 没开书 / 装不出任何条目时为 true；渲染层据此隐藏整条占用条。 */
  empty: boolean;
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
}

import {
  IPC_CHANNELS,
  type AgentOutbound,
  type ConnectionDraft,
  type ContextPreviewQuery,
  type DecideInput,
  type ExportResult,
  type ModelListQuery,
  type ProfileDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";

type Invoke = (channel: string, ...args: unknown[]) => Promise<never>;
type On = (channel: string, listener: (payload: unknown) => void) => () => void;

/** ipcRenderer 的订阅面：只用到 on / removeListener，测试处传自记 listeners 的假对象。 */
interface IpcLike {
  on(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
}

/**
 * 造一个 On：包装后的「同一个引用」既交给 on 注册、也交给 removeListener 撤除。
 * electron 按引用移除——若把原始 listener 交给 removeListener，包装后的箭头撤不掉，
 * 监听器会永久泄漏。这条性质必须由本工厂（不 import electron）承载才能单测。
 */
export function createIpcOn(ipc: IpcLike): On {
  return (channel, listener) => {
    const wrapped = (...args: unknown[]) => listener(args[1]);
    ipc.on(channel, wrapped);
    return () => ipc.removeListener(channel, wrapped);
  };
}

export function createRendererApi(invoke: Invoke, on: On): RendererApi {
  return {
    pickBookDirectory: () => invoke(IPC_CHANNELS.bookPick),
    openBook: (rootPath) => invoke(IPC_CHANNELS.bookOpen, rootPath),
    createBook: (input) => invoke(IPC_CHANNELS.bookCreate, input),
    saveMeta: (meta) => invoke(IPC_CHANNELS.bookSaveMeta, meta),
    readDoc: (relPath) => invoke(IPC_CHANNELS.docRead, relPath),
    writeDoc: (relPath, content, expectedFingerprint) =>
      invoke(IPC_CHANNELS.docWrite, relPath, content, expectedFingerprint),
    createDoc: (relPath, title) => invoke(IPC_CHANNELS.docCreate, relPath, title),
    // 只重算一篇（P1-4 后半）：这一层照旧不加判定——递出去的就是那一条相对路径，
    // 「算不出就退回整本重扫」的分支住在渲染层，preload 里写第二份判据迟早与它分家。
    refreshDoc: (relPath) => invoke(IPC_CHANNELS.docRefresh, relPath),
    // 设定数据（P0-7）：只递键，路径由主进程按白名单拼。preload 这一层不做判定，也不加判定——
    // 在这里顺手 `if (!keys.includes(key))` 就是第二份白名单，将来两处迟早不一样。
    readBookData: (key) => invoke(IPC_CHANNELS.bookDataRead, key),
    writeBookData: (key, json) => invoke(IPC_CHANNELS.bookDataWrite, key, json),
    startTurn: (input: StartTurnInput) => invoke(IPC_CHANNELS.agentStartTurn, input),
    interruptTurn: (turnId) => invoke(IPC_CHANNELS.agentInterrupt, turnId),
    decideProposal: (input: DecideInput) => invoke(IPC_CHANNELS.agentDecide, input),
    proposalDiff: (proposalId) => invoke(IPC_CHANNELS.agentDiff, proposalId),
    loadSession: (threadKey, sessionId) =>
      invoke(IPC_CHANNELS.agentLoadSession, threadKey, sessionId),
    listSessions: () => invoke(IPC_CHANNELS.agentListSessions),
    contextPreview: (query: ContextPreviewQuery) => invoke(IPC_CHANNELS.agentContextPreview, query),
    providerView: () => invoke(IPC_CHANNELS.providerGet),
    providerSave: (draft: ConnectionDraft) => invoke(IPC_CHANNELS.providerSave, draft),
    providerConnectionRemove: (connectionId: string) =>
      invoke(IPC_CHANNELS.providerConnectionRemove, connectionId),
    // 第二实参永远留位（没传草稿是 undefined）：preload 偷偷丢参，census 一测就红。
    listModels: (query?: ModelListQuery) => invoke(IPC_CHANNELS.providerListModels, query),
    providerVerify: (connectionId: string) => invoke(IPC_CHANNELS.providerVerify, connectionId),
    // 只递 providerId，密钥页地址由主进程从预设表查——渲染层递不了任意 URL 出去。
    openProviderKeyPage: (providerId: string) => invoke(IPC_CHANNELS.appOpenExternal, providerId),
    // 唯一递 URL 的一条：主进程按 http/https 白名单放行，别的 scheme 一律拒
    // （策略与理由见 main/web-source-link.ts）。
    openWebSource: (url: string) => invoke(IPC_CHANNELS.appOpenWebSource, url),
    profileUpsert: (draft: ProfileDraft) => invoke(IPC_CHANNELS.providerProfileUpsert, draft),
    profileRemove: (id: string) => invoke(IPC_CHANNELS.providerProfileRemove, id),
    profileEnable: (id: string, enabled: boolean) =>
      invoke(IPC_CHANNELS.providerProfileEnable, id, enabled),
    appearanceGet: () => invoke(IPC_CHANNELS.appearanceGet),
    appearanceSave: (settings) => invoke(IPC_CHANNELS.appearanceSave, settings),
    listSkills: () => invoke(IPC_CHANNELS.skillsList),
    readSkill: (source, relPath) => invoke(IPC_CHANNELS.skillsRead, source, relPath),
    // 技能市场三条（2026-10-07）。装/卸只传清单里的 dirName 字符串，
    // 路径一律由主进程按清单自己拼——渲染层碰不到绝对路径（见 skill-market-service.ts）。
    listMarket: () => invoke(IPC_CHANNELS.marketList),
    installMarketSkill: (dirName) => invoke(IPC_CHANNELS.marketInstall, dirName),
    uninstallMarketSkill: (dirName) => invoke(IPC_CHANNELS.marketUninstall, dirName),
    // 插件四条（2026-10-07 批次 5-㉚）。与技能市场同一条：渲染层只递安装名，
    // 路径由主进程拼——它碰不到绝对路径，也就没有「传个 ../ 就能读到别处」这条路。
    listPlugins: () => invoke(IPC_CHANNELS.pluginsList),
    togglePlugin: (dirName, enabled) => invoke(IPC_CHANNELS.pluginsToggle, dirName, enabled),
    uninstallPlugin: (dirName) => invoke(IPC_CHANNELS.pluginsUninstall, dirName),
    readPluginSource: (dirName) => invoke(IPC_CHANNELS.pluginsSource, dirName),
    // 改稿历史六枚。回滚那条的第二实参是**盘上此刻**的指纹（与 docWrite 同一口径），
    // 少传一个不封 new Error：主进程边界自己会拒，渲染层不该在这里造第二套规则。
    listChanges: () => invoke(IPC_CHANNELS.changesList),
    readChange: (backupRelPath) => invoke(IPC_CHANNELS.changesRead, backupRelPath),
    // 逐行对比（2026-10-13）：diff 文本由主进程算好交回来，渲染层只染颜色——
    // 算法那份真身在 agent-runtime，而渲染层禁 import 它（判据见 contracts/ipc.ts 的 proposalDiff）。
    diffChange: (backupRelPath, docRelPath) =>
      invoke(IPC_CHANNELS.changesDiff, backupRelPath, docRelPath),
    restoreChange: (backupRelPath, expectedFingerprint) =>
      invoke(IPC_CHANNELS.changesRestore, backupRelPath, expectedFingerprint),
    // 保留上限三枚（2026-10-06 批次 5-⑧）。这里只转发：夹范围、判 persisted、挑删哪些
    // 全在主进程与 fs-store 那边，渲染层再写一遍就等于三处上限可能互不一致。
    changesRetentionGet: () => invoke(IPC_CHANNELS.changesRetentionGet),
    changesRetentionSave: (retention) => invoke(IPC_CHANNELS.changesRetentionSave, retention),
    changesPruneNow: () => invoke(IPC_CHANNELS.changesPruneNow),
    saveFile: (content, filename, title) =>
      invoke(
        IPC_CHANNELS.saveFileExport,
        content,
        filename,
        title ?? "保存文件"
      ) as Promise<boolean>,
    // 组装导出内容（2026-10-05 批次 5-②）：EPUB 要 node:zlib，只能在主进程跑。
    // 这里只做字面转发，不校验形状——与本文件其余方法同一条口径。
    buildExport: (docs, meta, options) =>
      invoke(IPC_CHANNELS.buildExport, docs, meta, options) as Promise<ExportResult>,
    notify: (title, body) => {
      void invoke(IPC_CHANNELS.appNotify, title, body);
    },
    onAgentEvent: (listener) =>
      on(IPC_CHANNELS.agentEvent, (payload) => listener(payload as AgentOutbound)),
    /**
     * 退出握手（2026-10-09 P0-6）两条。
     *
     * 去的这条是主进程→渲染层的推送，没有载荷：主进程只说「先把稿子落盘」，
     * 落哪几篇、怎么落全在渲染层自己的内存里。回的那条只递 `{ ok, blocked }`——
     * 渲染层能说明「哪一篇落不下去、为什么」，但递不出路径，也就决定不了主进程往哪儿写。
     */
    onQuitFlushRequest: (listener) => on(IPC_CHANNELS.appFlushQuitRequest, () => listener()),
    quitFlushDone: (reply) => invoke(IPC_CHANNELS.appFlushQuitDone, reply),
    // 更新检查（2026-10-10）：更新源由主进程读 env，渲染层递不了 URL——这里只转发。
    updateCheck: () => invoke(IPC_CHANNELS.updateCheck),
    // 回收站三条（2026-10-10）：只递 relPath / trashName，盘上路径由主进程按当前书拼。
    // 「删了能不能找回」的判定全在主进程 doc-trash.ts，preload 不加第二份。
    trashDoc: (relPath) => invoke(IPC_CHANNELS.docTrash, relPath),
    listTrash: () => invoke(IPC_CHANNELS.trashList),
    restoreTrash: (trashName) => invoke(IPC_CHANNELS.trashRestore, trashName),
    // 整书备份三条（2026-10-10）：只递档位 / 备份目录名，盘上路径由主进程按当前书拼。
    // 「备不备、备到哪、恢复到哪」的判定全在主进程 book-backup.ts，preload 不加第二份。
    createBookBackup: (mode) => invoke(IPC_CHANNELS.bookBackupCreate, mode),
    listBookBackups: () => invoke(IPC_CHANNELS.bookBackupList),
    restoreBookBackup: (name) => invoke(IPC_CHANNELS.bookBackupRestore, name),
    // TXT 导入两条（2026-10-11）：预览无参（选文件框、读字节、切章全在主进程）；
    // 提交只递标题+正文清单，`chapters/<标题>.md` 由主进程拼。preload 不加判定。
    importTxtPreview: () => invoke(IPC_CHANNELS.importPreview),
    importTxtCommit: (input) => invoke(IPC_CHANNELS.importCommit, input)
  };
}

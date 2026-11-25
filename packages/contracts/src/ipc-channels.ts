/**
 * IPC 通道名清单（2026-10-21 从 ipc.ts 拆出）。
 *
 * 通道注册表与「参数形状 / 回执类型」不共享状态：前者是一张字符串常量表，后者是类型契约。
 * 合在一份文件里已经贴到 800 行预算，所以按这条边界切开——RendererApi 的签名仍在 ipc.ts。
 */
export const IPC_CHANNELS = {
  bookOpen: "book:open",
  bookSaveMeta: "book:save-meta",
  docRead: "doc:read",
  docWrite: "doc:write",
  bookPick: "book:pick",
  bookCreate: "book:create",
  /**
   * 作品库两条（2026-10-21）：`recent` 读回「我写过哪几本」，`forget` 只把一条从清单里划掉。
   *
   * 为什么单开而不是让渲染层自己记 localStorage：书是盘上的目录，换机器/换渲染层存储
   * 就全丢；而且「打开过哪本」的真身发生在主进程（`book:open` / `book:create` 成功那一刻），
   * 让渲染层再报一次就是第二种记账通路，迟早与真实打开顺序对不上。
   * `forget` 只动清单，**绝不删书目录**。
   */
  bookRecent: "book:recent",
  bookForget: "book:forget",
  /**
   * 删除作品（2026-11-24）：把整本书目录移进系统回收站。
   *
   * 【为什么收 rootPath 而不是让主进程自己挑】删除的对象是「作品库清单里的某一本」，
   * 大多数时候**不是**当前打开的这一本——按当前书根拼路径反而删不了别人。
   * 【为什么是回收站不是 unlink】整本书目录一旦直删就一个字都找不回来；
   * `shell.trashItem` 进回收站，删错了还能在系统里还原。正文与设定一起走。
   * 【与 book:forget 的分工】forget 只划清单记录，盘上一个字节不动；
   * 这一条是真删——删除成功后清单同步移除该条（主进程一次做完，不给渲染层第二种通路）。
   * 若删的是当前打开的书，主进程先把书关掉（快照清空），渲染层随之回到未打开状态。
   */
  bookTrash: "book:trash",
  /**
   * 素材库联网搜索（2026-10-24）：面板里直接搜，结果直接加成素材卡。
   * 出网只在主进程（`web-search.ts` 那条源链），渲染层碰不到网络。
   */
  materialsSearch: "materials:search",
  /**
   * 素材库联网搜索的**取全文**那一步（2026-10-24）：搜索只给摘要，摘要当素材是纸片——
   * 落卡前要把这一页的正文抓回来。抓取复用主进程 `web-read.ts` 那条链，渲染层不碰网络。
   */
  materialsFetch: "materials:fetch",
  docCreate: "doc:create",
  /**
   * 只重算**一篇**文稿的 DocRef（P1-4 后半，2026-10-10）。
   *
   * 存在的理由就是省掉那一次整本重扫：改标题、吸收智能体写入这两条链路过去都靠 `openBook`
   * 把全本书每篇正文再读一遍，只为换树上那一根。主进程用与 `scanBook` 同一份判据算那一篇
   * （`fs-store` 的 `docRefFor`），顺手把它自己的快照也换成新值——两处同步，一次读盘。
   */
  docRefresh: "doc:refresh",
  /**
   * 改文件名（2026-11-20）。现有的「改标题」只动 frontmatter，文件名与 relPath 不变；
   * 名字起错了去资源管理器改，`chapterOrder` 与 `recaps` 的键立刻成孤儿。
   * 这一条由主进程一次做完：改名 + 迁移两处键 + 重扫，回执带上新 meta。
   */
  docRename: "doc:rename",
  agentStartTurn: "agent:start-turn",
  agentInterrupt: "agent:interrupt",
  agentDecide: "agent:decide",
  /**
   * 多稿采样的两条收尾动作（P0-②，2026-10-19）：选用某一稿 / 丢弃整集。
   *
   * 【为什么落盘要单开一条通道】候选稿**只在主进程内存里**（静默采样期间一个字都没落盘），
   * 渲染层手里只有预览文本。让它把选中的正文递回来再写盘，就是把「盘上写什么字」
   * 交给渲染层决定——那是第二种写盘通路。这一条只递句柄与稿序号，
   * 正文由主进程按集里存的原始事件（消息 + 提案）经**既有** `registerProposal` 全链路落盘。
   *
   * 【丢弃为什么不复用这条】丢弃是一个字都不写，成败判定与落盘那一条完全不同
   * （落盘要占线程、要发事件、要过指纹闸），合成一条只会让两边都说不清。
   */
  agentPickDraft: "agent:pick-draft",
  agentDiscardDrafts: "agent:discard-drafts",
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
  providerSetUtility: "provider:set-utility",
  skillsList: "skills:list",
  skillsRead: "skills:read",
  /**
   * 技能兑换码（离线自包含）：渲染层只递一整串码，主进程解码后把技能装进全局目录。
   * 不收路径、不收来源——码里带着技能本身，路径全由主进程按解码出的目录名拼
   * （与 market:install 同一条铁律，理由见 skill-redeem-service.ts）。
   */
  skillsRedeem: "skills:redeem",
  /**
   * 在线技能源三条（2026-11-10）：列源、取一份正文预览、把它装进全局技能目录。
   * 只收**一个地址字符串**——仓库坐标、目录名、落盘位置全由主进程解析
   * （见 skill-remote-service.ts），渲染层递不了路径，也就没有越界写这一条路。
   */
  skillsRemoteList: "skills:remote-list",
  skillsRemotePreview: "skills:remote-preview",
  skillsRemoteInstall: "skills:remote-install",
  /**
   * 网页转技能（2026-11-10 用户裁定「任意网页当技能」）：渲染层只递一个网页 URL，
   * 主进程抓正文、剥成纯文本、补上 frontmatter 落进全局技能目录。
   * 与 remote 三条同一条边界：不收路径、不收正文——抓什么、叫什么、写到哪，全由主进程判。
   */
  skillsWebpageConvert: "skills:webpage-convert",
  /**
   * 自己写技能：存一份（会在报已有同名时拒，除非显式 overwrite），删掉全局目录里的一份。
   * 删除必须在这里，不能并进 market:uninstall——市场那条只认内置清单，
   * 网上装的与自己写的都不在清单里，否则会「装得进来、删不掉」（见 skill-author-service.ts）。
   */
  skillsAuthorSave: "skills:author-save",
  skillsRemove: "skills:remove",
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
  /**
   * 逐行对比一条备份与盘上此刻的那一篇（2026-10-13）。
   * 与 `agent:diff` 同一口径：**主进程算，渲染层不 import agent-runtime**。
   */
  changesDiff: "changes:diff",
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
  importCommit: "import:commit",
  /**
   * 全书替换（2026-10-15）：按**字面**把当前这本书里每一篇的 query 换成 replacement。
   *
   * 【为什么不走「渲染层逐篇 doc:write」那条路】渲染层要自己换就得先把全书正文拉进内存
   * ——3000 章就是 3000 次 `doc:read` 加一整本书的文本驻在渲染进程里，而替换**一处在哪一篇**
   * 本来只有盘上那份字节说了算。主进程逐篇「读 → 换 → 写」既不多搬一次正文，又天然吃到
   * `readDocFile`/`writeDocFile` 已有的指纹守卫、整篇备份与原子写——判据一份都不新造。
   *
   * 【与「不做假控件」的关系】全文搜索面板上的处数是**封顶的**（200 处），
   * 所以这条通道不接「只替换命中的那几篇」——那会把第 201 处以后悄悄漏掉。
   * 它按当前书的整份文稿快照走，回执上如实报「扫了几篇 / 改了几篇 / 共几处 / 哪几篇没动」。
   */
  bookReplaceAll: "book:replace-all",
  /**
   * WebDAV 远程备份五条（2026-10-15）。
   *
   * 【这条通路不动正文、不动本地备份本体】
   * 远程仓库是「把已经做好的本地整书备份（`<书>/.mochen/backups/book-<时间戳>/`）推一份到
   * 用户自己配的 WebDAV 服务器」——备份本体与本地淘汰仍由 `book-backup` 那一套全权负责，
   * 这里只是字节搬运：MKCOL + 递归 PUT（push）/ PROPFIND（list）/ MKCOL+DELETE 探活（verify）。
   *
   * 【为什么不在渲染层 fetch】
   * 备份字节在主进程手里（`<书>/.mochen/backups/`），渲染层 fetch 还要先跨 IPC 把字节搬过去
   * 再绕回来出网——而 CSP（`renderer-csp.ts`）`connect-src` 打包态只放行 `'self'`，
   * 给 WebDAV 开域名白名单就等于把「远程域白名单」与 `provider-fetch` 那套口径分家（铁律 6）。
   * ⇒ 字节、网络、URL 白名单都在主进程，与 `book-backup` 同款。
   *
   * 【为什么配置与凭据分开存】
   * url / username 落 `<appData>/webdav-config.json`（与 appearance 同款原子写），
   * password 走 `credential-store`（ref = `WEBDAV_CRED_REF`）——与 provider 密钥同套加密分份。
   * 渲染层 `config-get` 拿到的快照只有 `hasPassword`，不回明文密钥（已在加密存好的密钥
   * 不再走 IPC 暴露在结构化克隆与渲染进程内存里）。
   *
   * 【pull 一起做的理由（2026-10-15 稍晚）】
   * 远程备份只推不拉是条半截路：命里那份备份在 NAS 上，本机盘坏掉时唯一的用法就是拉回来。
   * pull 是 `restoreBookBackup` 的远程镜像（逐层 PROPFIND Depth:1 → 递归 GET），
   * 落点与本地 restore 同一处（书的**旁边**一份新目录，绝不盖写）。它只递一个远程目录名，
   * 与 list 同一条铁律——渲染层递不出服务器地址，也就递不出去别的书别的份。
   */
  webdavConfigGet: "webdav:config-get",
  webdavConfigSave: "webdav:config-save",
  webdavVerify: "webdav:verify",
  webdavPush: "webdav:push",
  webdavList: "webdav:list",
  webdavPull: "webdav:pull"
} as const;

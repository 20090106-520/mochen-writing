import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type AgentOutbound,
  type AppearanceSettings,
  type BookMeta,
  type ContextPreviewQuery,
  type DecideInput,
  type ExportableDoc,
  type ExportOptions,
  type ConnectionDraft,
  type ProfileDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";
import { createIpcOn, createRendererApi } from "./renderer-api.js";

function harness() {
  const calls: { channel: string; args: unknown[] }[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  const api: RendererApi = createRendererApi(
    (channel, ...args) => {
      calls.push({ channel, args });
      // Invoke 的返回类型是 Promise<never>（工厂要它赋给任何 RendererApi 方法）；
      // 夹具桩返回真实对象，在此边界显式收口，不改任何断言。
      return Promise.resolve({ ok: true, turnId: "t1" }) as Promise<never>;
    },
    (channel, listener) => {
      listeners.add(listener);
      calls.push({ channel, args: ["subscribe"] });
      return () => listeners.delete(listener);
    }
  );
  return { api, calls, listeners };
}

describe("createRendererApi", () => {
  it("每个方法只走自己的通道", async () => {
    const { api, calls } = harness();
    await api.startTurn({
      threadKey: "a",
      docRelPath: "a",
      stageId: "draft",
      userText: "改",
      thinkingLevel: "off",
      webSearchEnabled: false,
      skillPaths: [],
      sampleCount: 1
    });
    await api.interruptTurn("t1");
    await api.decideProposal({ proposalId: "p1", decision: "cancel", guidance: "" });
    await api.proposalDiff("p1");
    await api.providerView();
    await api.providerSave({
      providerId: "custom",
      baseURL: "http://a/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      apiKey: null
    });
    expect(calls.map((call) => call.channel)).toEqual([
      IPC_CHANNELS.agentStartTurn,
      IPC_CHANNELS.agentInterrupt,
      IPC_CHANNELS.agentDecide,
      IPC_CHANNELS.agentDiff,
      IPC_CHANNELS.providerGet,
      IPC_CHANNELS.providerSave
    ]);
    expect(calls[3]?.args).toEqual(["p1"]);
  });

  it("订阅 agentEvent 后能收到推送，取消订阅后不再收到", () => {
    const { api, listeners, calls } = harness();
    const got: AgentOutbound[] = [];
    const off = api.onAgentEvent((payload) => got.push(payload));
    expect(calls.at(-1)?.channel).toBe(IPC_CHANNELS.agentEvent);
    const listener = [...listeners][0];
    listener?.({ type: "turn-end", turnId: "t1", threadKey: "a", status: "done", message: "" });
    expect(got.length).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });

  it("50 条通道各调一次：通道与参数逐条钉死（期望值全是字面量，不从 IPC_CHANNELS 派生）", async () => {
    const { api, calls } = harness();
    const meta: BookMeta = {
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: "read-only",
      chapterOrder: []
    };
    const startInput: StartTurnInput = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      userText: "改紧一点",
      thinkingLevel: "off",
      webSearchEnabled: false,
      skillPaths: [],
      sampleCount: 1
    };
    const decideInput: DecideInput = { proposalId: "p-1", decision: "cancel", guidance: "" };
    // 导出那组：三个实参逐个留位。EPUB 的 bytes 走主进程，这层只证明「原样出网、顺序不乱」。
    const exportDocs: ExportableDoc[] = [
      { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局", content: "正文一" }
    ];
    const exportOptions: Partial<ExportOptions> = { format: "epub" };
    const contextPreviewQuery: ContextPreviewQuery = {
      docRelPath: "chapters/01-开局.md",
      profileId: null,
      pinned: ["materials/潮汐表.md"]
    };
    const draft: ConnectionDraft = {
      providerId: "custom",
      baseURL: "http://127.0.0.1:8787/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      apiKey: null
    };
    // 建档按连接走（模型名 + 挂哪条连接），不再是一个裸模型名。
    const profileDraft: ProfileDraft = { model: "深渊-8B", connectionId: "c-1" };
    const appearanceSettings: AppearanceSettings = {
      mode: "system",
      // 2026-10-15 Wave 3：密度档住 settings 顶层，契约解析后恒有值（缺字段补 standard）。
      density: "standard",
      // 2026-11-09：液态玻璃也是顶层开关，缺字段补 auto（跟随皮肤自己的玻璃档）。
      liquidGlass: "auto",
      // 2026-11-10：浓度档同在顶层，缺字段补 calm（克制=出厂观感）。
      liquidGlassIntensity: "calm",
      // 2026-10-07 批次 5-㊴：质感四层与 skin 是 AppearanceThemeConfig 的一部分，
      // 夹具必须照抄出厂默认（appearance.json 里的老文件也正是这样被补齐的）。
      light: {
        preset: "codex",
        accent: "#339CFF",
        background: "#FFFFFF",
        foreground: "#1A1C1F",
        uiFontSize: 14,
        codeFontSize: 13,
        translucentSidebar: true,
        skin: "plain",
        backdrop: "plain",
        glass: "none",
        surface: "plain",
        grid: "none",
        art: "none",
        ornament: "none"
      },
      dark: {
        preset: "codex",
        accent: "#5EACFF",
        background: "#17191C",
        foreground: "#F3F4F6",
        uiFontSize: 14,
        codeFontSize: 13,
        translucentSidebar: true,
        skin: "plain",
        backdrop: "plain",
        glass: "none",
        surface: "plain",
        grid: "none",
        art: "none",
        ornament: "none"
      },
      uiFontFamily: "system",
      editorFontFamily: "song"
    };

    await api.pickBookDirectory();
    await api.openBook("/book");
    await api.createBook({ directory: "/new-book", title: "新书" });
    // 作品库（2026-10-21）：读回整份清单 / 只递书根划掉一条（不删书）。
    await api.listRecentBooks();
    await api.forgetRecentBook("/book");
    // 删除作品（2026-11-24）：只递书根，整本书目录由主进程移进系统回收站——
    // 先关书、清单同步移除都在主进程一次做完，preload 不判不拼。
    await api.trashBook("/book");
    // 读另一本书的设定条目（2026-11-24）：只递书根、只读；合并与写盘在渲染层当前书那侧。
    await api.biblePeek("/book-two");
    await api.saveMeta(meta);
    await api.readDoc("chapters/01-开局.md");
    await api.writeDoc("chapters/01-开局.md", "正文", "fp-1");
    await api.createDoc("chapters/02-新章.md", "新章");
    // 改文件名（2026-11-20）：只递旧路径与新标题；新路径与 chapterOrder/recaps 的迁移在主进程一次做完。
    await api.renameDoc("chapters/01-开局.md", "第一章 开局");
    // 只重算一篇（2026-10-10 P1-4 后半）：这一枚递的必须**只是**那一条相对路径，
    // 多递一个「整本清单」的参数、或把它接到 book:open 上，下面的通道名点名当场红。
    await api.refreshDoc("chapters/01-开局.md");
    // 设定数据两枚（2026-10-09 P0-7）：**只递键**，路径由主进程按白名单拼。
    // 这里多递一个参数、或者把键换成路径，下面的实参点名当场红。
    await api.readBookData("notes");
    await api.writeBookData("story-bible", "[]");
    await api.startTurn(startInput);
    await api.interruptTurn("t-1");
    await api.decideProposal(decideInput);
    // 多稿两枚（P0-②）：只递**候选集句柄 + 稿序号**，一个字的候选正文都不往回递——
    // 落盘写什么字由主进程按集里存的事件决定（多递一个正文参数，下面的实参点名当场红）。
    await api.pickDraft({ draftSetId: "set-1", index: 0 });
    await api.discardDrafts({ draftSetId: "set-1" });
    await api.proposalDiff("p-1");
    await api.loadSession("chapters/01-开局.md");
    await api.notify("title", "body");
    await api.saveFile("content", "file.txt");
    await api.buildExport(exportDocs, meta, exportOptions);
    await api.listSessions();
    await api.contextPreview(contextPreviewQuery);
    await api.providerView();
    await api.providerSave(draft);
    await api.providerConnectionRemove("c-1");
    await api.listModels();
    await api.providerVerify("c-1");
    await api.openProviderKeyPage("mimo");
    await api.openWebSource("https://baike.so.com/doc/5586742.html");
    await api.profileUpsert(profileDraft);
    await api.profileRemove("m-1");
    await api.profileEnable("m-1", true);
    // 后台杂活模型（2026-11-20）：只递档案 id；写作轮不受这一格影响。
    await api.setUtility("m-1");
    await api.appearanceGet();
    await api.appearanceSave(appearanceSettings);
    await api.listSkills();
    await api.readSkill("book", "伏笔/SKILL.md");
    await api.listChanges();
    await api.readChange(".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak");
    // 逐行对比（2026-10-13）：两枚实参一枚都不能少——备份在前、文稿在后，
    // preload 少递一枚或调倒顺序，主进程比的就是「两个都不该配的对象」。
    await api.diffChange(
      ".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak",
      "chapters/01-开局.md"
    );
    await api.restoreChange(
      ".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak",
      "fp-now"
    );
    // 保留上限三枚：通道与实参逐条钉死（save 递的是**整个对象**，一个字都不许在 preload 里拆）。
    await api.changesRetentionGet();
    await api.changesRetentionSave({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    await api.changesPruneNow();
    // 技能市场三枚（2026-10-07）：装/卸**只递 dirName**，不递路径也不递技能正文。
    // 路径由主进程按清单自己拼（skill-market-service.ts），所以这里多递一个参数就该红——
    // 渲染层拿到路径就意味着它能决定写哪儿，那道闸就没了。
    await api.listMarket();
    await api.installMarketSkill("chapter-intent");
    await api.uninstallMarketSkill("chapter-intent");
    // 在线技能源五条（2026-11-10）：三条只递**一段地址文本**，一条递草稿对象、一条递目录名。
    // 一律不递路径——落盘位置由主进程按解析出的目录名自己拼（skill-remote-service.ts）。
    await api.listRemoteSkills("anthropics/skills");
    await api.previewRemoteSkill("https://github.com/anthropics/skills/tree/main/skills/docx");
    await api.installRemoteSkill("https://github.com/anthropics/skills/tree/main/skills/docx");
    await api.saveAuthoredSkill({
      dirName: "scene-smell",
      displayName: "场景里的气味",
      description: "",
      stages: [],
      appliesTo: [],
      body: "正文",
      overwrite: false
    });
    await api.removeSkill("scene-smell");
    // 网页转技能（2026-11-10）：只递**一条网页 URL**——抓什么、转成什么名、写到哪全在主进程。
    await api.convertWebpageSkill("https://example.com/writing-guide");
    // 插件四枚（2026-10-07 批次 5-㉚）：与技能市场同一条铁律——
    // 渲染层只递**安装名**（dirName），不递路径。多递一个参数就该红：
    // 它拿到路径就能决定读哪、删哪，那道闸就没了。
    await api.listPlugins();
    await api.togglePlugin("rhythm", false);
    await api.uninstallPlugin("rhythm");
    await api.readPluginSource("rhythm");
    // 退出握手两枚（2026-10-09 P0-6）：回话只递 { ok, blocked }，路径与内容都不带——
    // 渲染层能决定「哪一篇落不下去」，但决定不了主进程往哪儿写。
    await api.quitFlushDone({
      ok: false,
      blocked: [{ relPath: "chapters/01-开局.md", message: "盘满" }]
    });
    api.onAgentEvent(() => {});
    api.onQuitFlushRequest(() => {});
    // 整书备份三条（2026-10-10）：create 只递档位；restore 只递备份目录名——
    // 多递一个路径参数下面的实参点名当场红（渲染层永远不决定写哪儿）。
    await api.createBookBackup("daily");
    await api.listBookBackups();
    await api.restoreBookBackup("book-2026-10-10-19-52-30");
    // TXT 导入两条（2026-10-11）：预览无参；提交递一章目清单（路径由主进程拼）。
    await api.importTxtPreview();
    await api.importTxtCommit({ chapters: [{ title: "第一章", content: "正文" }] });
    // 全书替换（2026-10-15）：只递「找什么 + 换成什么」——**一个 relPath 都递不出去**，
    // 要动哪几篇由主进程按自己的快照决定（这一列就是那道形状的证明）。
    await api.replaceAllInBook({ query: "小明", replacement: "阿明" });
    // WebDAV 远程备份六条（2026-10-15）：config-get / verify / push / list 无参；
    // config-save 只递配置草稿（密钥三态见 contracts），pull 只递**远程备份目录名**。
    // **一个服务器地址、一个盘上路径、一个 bookId 都不递**——
    // 落到哪台服务器、哪本书、哪一份、写回哪儿，全由主进程按配置与当前书根自己拼。
    await api.webdavConfigGet();
    await api.webdavConfigSave({ url: "https://nas.local/dav/", username: "alice" });
    await api.webdavVerify();
    await api.webdavPush();
    await api.webdavList();
    await api.webdavPull("book-2026-10-15-12-00-00");

    expect(calls.length).toBe(77);
    // 通道名必须逐字面量列出来：拿 IPC_CHANNELS 当期望值等于用被测常量证明被测常量本身，
    // 那种断言永不失败——把 openBook 改打到 doc:read 它照样绿。
    expect(calls.map((call) => call.channel)).toEqual([
      "book:pick",
      "book:open",
      "book:create",
      // 作品库（2026-10-21）：读整份清单 / 只递书根划掉一条。
      "book:recent",
      "book:forget",
      // 删除作品（2026-11-24）：整本书目录移进系统回收站，只收书根。
      "book:trash",
      // 读另一本书的设定条目（2026-11-24）：只读，复制式导入的数据源。
      "bible:peek",
      "book:save-meta",
      "doc:read",
      "doc:write",
      "doc:create",
      "doc:rename",
      "doc:refresh",
      "book-data:read",
      "book-data:write",
      "agent:start-turn",
      "agent:interrupt",
      "agent:decide",
      // 多稿两枚（P0-②）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "agent:pick-draft",
      "agent:discard-drafts",
      "agent:diff",
      "agent:load-session",
      "app:notify",
      "file:save-export",
      "file:build-export",
      "agent:list-sessions",
      "agent:context-preview",
      "provider:get",
      "provider:save",
      "provider:connection-remove",
      "provider:list-models",
      "provider:verify",
      // 密钥页走的是 app:open-external：渲染层递的是 providerId，地址由主进程查预设表。
      "app:open-external",
      // 搜索来源点开走 app:open-web-source（2026-10-06 批次 5-⑨）：**本仓唯一递 URL 的一条**，
      // 主进程按 http/https 白名单放行。它紧挨着上一条不是巧合——两条口径刻意相反，
      // 理由写在 main/web-source-link.ts 的文件头注释里，改之前先读那段。
      "app:open-web-source",
      "provider:profile-upsert",
      "provider:profile-remove",
      "provider:profile-enable",
      "provider:set-utility",
      "appearance:get",
      "appearance:save",
      "skills:list",
      "skills:read",
      "changes:list",
      "changes:read",
      // 逐行对比（2026-10-13）：与上面两条一样不许从 IPC_CHANNELS 派生。
      "changes:diff",
      "changes:restore",
      // 保留上限三枚的字面通道（2026-10-06 批次 5-⑧）——不许从 IPC_CHANNELS 派生：
      // 拿被测常量当期望值等于用常量证明常量本身，改错通道照样绿。
      "changes:retention-get",
      "changes:retention-save",
      "changes:prune-now",
      // 技能市场三枚（2026-10-07）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "market:list",
      "market:install",
      "market:uninstall",
      // 在线技能源五条（2026-11-10）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "skills:remote-list",
      "skills:remote-preview",
      "skills:remote-install",
      "skills:author-save",
      "skills:remove",
      // 网页转技能（2026-11-10）：同样只递一段 URL 文本，落盘位置由主进程解析。
      "skills:webpage-convert",
      // 插件四枚（2026-10-07 批次 5-㉚）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "plugins:list",
      "plugins:toggle",
      "plugins:uninstall",
      "plugins:source",
      // 退出握手的回程（2026-10-09 P0-6）：渲染层→主进程的一条 invoke。
      "app:flush-quit-done",
      "agent:event",
      // 握手去的这条是主进程→渲染层的推送：preload 里它只能被 on，不占 invoke 的位置。
      "app:flush-quit-request",
      // 整书备份三条（2026-10-10）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "book-backup:create",
      "book-backup:list",
      "book-backup:restore",
      // TXT 导入两条（2026-10-11）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "import:pick-preview",
      "import:commit",
      // 全书替换（2026-10-15）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "book:replace-all",
      // WebDAV 六条（2026-10-15）。同样不许从 IPC_CHANNELS 派生，理由同上。
      "webdav:config-get",
      "webdav:config-save",
      "webdav:verify",
      "webdav:push",
      "webdav:list",
      "webdav:pull"
    ]);
    expect(calls.map((call) => call.args)).toEqual([
      [],
      ["/book"],
      [{ directory: "/new-book", title: "新书" }],
      // 作品库（2026-10-21）：读清单不带实参；划掉一条只递书根。
      [],
      ["/book"],
      // 删除作品（2026-11-24）：只递书根，一个路径参数都不能多。
      ["/book"],
      // 读另一本书的设定条目（2026-11-24）：只递书根，一个路径参数都不能多。
      ["/book-two"],
      [meta],
      ["chapters/01-开局.md"],
      ["chapters/01-开局.md", "正文", "fp-1"],
      ["chapters/02-新章.md", "新章"],
      // 改文件名（2026-11-20）：旧路径 + 新标题；新路径与两处键的迁移都在主进程。
      ["chapters/01-开局.md", "第一章 开局"],
      ["chapters/01-开局.md"],
      ["notes"],
      ["story-bible", "[]"],
      [startInput],
      ["t-1"],
      [decideInput],
      // 多稿两枚的实参：选稿递句柄 + 稿序号，丢稿只递句柄——**正文一个字节都不出渲染层**。
      [{ draftSetId: "set-1", index: 0 }],
      [{ draftSetId: "set-1" }],
      ["p-1"],
      // 没指名的那一趟也把第二实参的位置留出来（值是 undefined）：preload 里偷偷丢掉 sessionId，
      // 这条断言就会红——面板点第几条却读回最近那条，是只有码流层才抓得到的错。
      ["chapters/01-开局.md", undefined],
      ["title", "body"],
      ["content", "file.txt", "保存文件"],
      [exportDocs, meta, exportOptions],
      [],
      [contextPreviewQuery],
      [],
      [draft],
      ["c-1"],
      // listModels 的草稿实参留位：没传也是 undefined，preload 丢参这里就红。
      [undefined],
      ["c-1"],
      ["mimo"],
      // 来源 URL 原样递出去，一个字都不许在 preload 里改写（主进程的白名单只认原串）。
      ["https://baike.so.com/doc/5586742.html"],
      [profileDraft],
      ["m-1"],
      ["m-1", true],
      [{ profileId: "m-1" }],
      [],
      [appearanceSettings],
      [],
      ["book", "伏笔/SKILL.md"],
      [],
      [".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak"],
      [".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak", "chapters/01-开局.md"],
      [".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak", "fp-now"],
      // 保留上限三枚：读与立即清理不带实参，存只递**整个对象**（preload 一个字都不许拆）。
      [],
      [{ maxCount: 10, maxBytes: 5 * 1024 * 1024 }],
      [],
      // 市场三枚的实参：listMarket 不收东西；装/卸各只收一个目录名字符串。
      [],
      ["chapter-intent"],
      ["chapter-intent"],
      // 在线技能源五条的实参（2026-11-10）：三条各只收一段地址文本，存收整个草稿对象，
      // 删收目录名。**一个落盘路径都不许出现**——位置由主进程按解析出的目录名自己拼。
      ["anthropics/skills"],
      ["https://github.com/anthropics/skills/tree/main/skills/docx"],
      ["https://github.com/anthropics/skills/tree/main/skills/docx"],
      [
        {
          dirName: "scene-smell",
          displayName: "场景里的气味",
          description: "",
          stages: [],
          appliesTo: [],
          body: "正文",
          overwrite: false
        }
      ],
      ["scene-smell"],
      // 网页转技能：只收一条 URL，**一个路径都不许出现**。
      ["https://example.com/writing-guide"],
      // 插件四枚的实参：listPlugins 不收；toggle 收「目录名 + 一个布尔」；
      // uninstall 与读源码各只收目录名。**一个路径都不许出现**——
      // 这一列就是那道闸的形状证明，多一个字符串（比如 "/root/plugins/x"）就说明闸漏了。
      [],
      ["rhythm", false],
      ["rhythm"],
      ["rhythm"],
      // 回程那一枚的实参：整个 { ok, blocked } 对象原样出网，preload 一个字都不许拆。
      [{ ok: false, blocked: [{ relPath: "chapters/01-开局.md", message: "盘满" }] }],
      ["subscribe"],
      ["subscribe"],
      // 备份三枚的实参：create 只递档位、list 不收东西、restore 只递备份目录名。
      // **一个盘上路径都不许出现**——恢复往哪儿写由主进程按书根拼。
      ["daily"],
      [],
      ["book-2026-10-10-19-52-30"],
      // 导入两枚的实参：预览不收东西（选文件框、读字节都在主进程）；
      // 提交只收标题+正文清单——**一个路径都不许出现**，chapters/<标题>.md 由主进程拼。
      [],
      [{ chapters: [{ title: "第一章", content: "正文" }] }],
      // 全书替换的实参：整个对象原样出网（preload 一个字都不许拆或补）。
      [{ query: "小明", replacement: "阿明" }],
      // WebDAV 六条的实参：config-get / verify / push / list 不收东西；
      // config-save 只递整个配置草稿（密钥三态见 contracts），pull 只递远程备份目录名——
      // **一个服务器地址、一个盘上路径、一个 bookId 都不递**。
      [],
      [{ url: "https://nas.local/dav/", username: "alice" }],
      [],
      [],
      [],
      ["book-2026-10-15-12-00-00"]
    ]);
    // 渲染层只拿到这些方法：invoke/on/ipcRenderer 一个字都不许泄漏成键。
    expect(Object.keys(api).sort()).toEqual([
      "appearanceGet",
      "appearanceSave",
      // 读另一本书的设定（2026-11-24）：只读通道也进点名册——名单与通道表一起对账。
      // 点名册按 Object.keys().sort() 的字母序断言，b 在 t 前面。
      "biblePeek",
      "buildExport",
      // 保留上限三枚（2026-10-06 批次 5-⑧）。它们决定写盘时删掉多少用户的历史，
      // 所以和其它改稿通道一样进这份点名册：少一枚 preload 就调不到，多一枚就是多开的口子。
      "changesPruneNow",
      "changesRetentionGet",
      "changesRetentionSave",
      "contextPreview",
      // 网页转技能（2026-11-10）：进点名册与其它技能通道同一规矩——多一枚就是多开的口子。
      "convertWebpageSkill",
      "createBook",
      // 整书备份三枚（2026-10-10）：「备不备/备到哪」的档位与目录名是渲染层仅有的发言权，
      // 和其它改稿通道一样进这份点名册：少一枚面板调不到，多一枚就是多开的口子。
      "createBookBackup",
      "createDoc",
      "decideProposal",
      // 逐行对比（2026-10-13）：改稿历史那一扇进这份点名册，与另外几枚改稿通道同一规矩。
      "diffChange",
      // 多稿两枚（P0-②）：选稿要把某一稿真的写进盘，丢稿是那集的收尾——
      // 进这份点名册的理由与别的改稿通道一致：少一枚面板点不到，多一枚就是多开的口子。
      "discardDrafts",
      // 作品库（2026-10-21）：清单读回与「划掉一条」。后者只动 appData 的一份 json，
      // 不进改稿通道那一档；进点名册是为了钉住 preload 的方法面（多一枚就是多开的口子）。
      "forgetRecentBook",
      // 技能市场三枚（2026-10-07 批次 5-㉖）。装/卸是**往用户磁盘写**的两枚通道，
      // 和其它改稿通道一样进这份点名册：少一枚面板调不到，多一枚就是多开的口子。
      "importTxtCommit",
      "importTxtPreview",
      "installMarketSkill",
      // 在线技能源（2026-11-10）：只递地址文本 / 草稿 / 目录名，落盘位置由主进程解析。
      "installRemoteSkill",
      "interruptTurn",
      "listBookBackups",
      "listChanges",
      "listMarket",
      "listModels",
      "listPlugins",
      // 作品库（2026-10-21）：最近打开/新建过的书，按时间倒序。
      "listRecentBooks",
      "listRemoteSkills",
      "listSessions",
      "listSkills",
      // 回收站三条（2026-10-10）：删=移动进 .mochen/trash，还原=按小抄搬回。
      // 进点名册的理由与别的改稿通道一致：少一枚面板调不到，多一枚就是多开的口子。
      "listTrash",
      "loadSession",
      // 素材库联网搜索（2026-10-24）：出网在主进程（web-search.ts 那条源链），渲染层只递一个搜索词。
      // 它不是改稿通道、不写盘——进点名册是为了钉住 preload 的方法面（多一枚就是多开的口子）。
      "materialsFetch",
      "materialsSearch",
      "notify",
      "onAgentEvent",
      // 退出握手两枚（2026-10-09 P0-6）：去的那枚只能订阅、回的那枚只能 invoke，
      // 一起进这份点名册——少一枚主进程就永远等不到回程。
      "onQuitFlushRequest",
      "openBook",
      "openProviderKeyPage",
      "openWebSource",
      "pickBookDirectory",
      "pickDraft",
      "previewRemoteSkill",
      "profileEnable",
      "profileRemove",
      "profileUpsert",
      "proposalDiff",
      "providerConnectionRemove",
      "providerSave",
      "providerVerify",
      "providerView",
      "quitFlushDone",
      // 设定数据两枚（2026-10-09 P0-7）：读与写各一条，键走白名单、路径由主进程拼。
      "readBookData",
      "readChange",
      "readDoc",
      "readPluginSource",
      "readSkill",
      // 技能兑换码（离线自包含）：只递一整串码，多一枚就是多开的口子。
      "redeemSkill",
      // 只重算一篇（2026-10-10 P1-4 后半）：它进这份点名册的理由与别的改稿通道一样——
      // 少一枚渲染层就调不到（退回整本重扫），多一枚就是多开的口子。
      "refreshDoc",
      "removeSkill",
      // 改文件名（2026-11-20）：改名 + 迁移 chapterOrder / recaps 两处键由主进程一次做完。
      // 进这份点名册与别的改稿通道同一规矩：少一枚 preload 调不到，多一枚就是多开的口子。
      "renameDoc",
      // 全书替换（2026-10-15）：这条通道会把整本书翻一遍，和其它改稿通道一样进这份点名册：
      // 少一枚面板点不到、多一枚就是多开的口子。
      "replaceAllInBook",
      "restoreBookBackup",
      "restoreChange",
      "restoreTrash",
      "saveAuthoredSkill",
      "saveFile",
      "saveMeta",
      "setUtility",
      "startTurn",
      "togglePlugin",
      // 删除作品（2026-11-24）：整本书目录进回收站是往用户磁盘写的一条，进点名册同一规矩。
      "trashBook",
      // 删除那一枚与「检查更新」一枚（2026-10-10）：检查只报告不下载，更新源在主进程 env 里。
      "trashDoc",
      "uninstallMarketSkill",
      "uninstallPlugin",
      "updateCheck",
      // WebDAV 六条（2026-10-15）：远程备份进这份点名册，与本地整书备份同一档理由——
      // 少一枚面板调不到、多一枚就是多开的口子。
      "webdavConfigGet",
      "webdavConfigSave",
      "webdavList",
      "webdavPull",
      "webdavPush",
      "webdavVerify",
      "writeBookData",
      "writeDoc"
    ]);
  });

  it("loadSession 指名 sessionId：两个实参按顺序原样出网", async () => {
    const { api, calls } = harness();
    await api.loadSession("chapters/02-潮信.md", "s-9");
    expect(calls).toEqual([
      { channel: "agent:load-session", args: ["chapters/02-潮信.md", "s-9"] }
    ]);
  });
});

describe("createIpcOn", () => {
  it("退订撤的是 on 注册的同一个引用：退订后推送不再送达", () => {
    // 假 ipc：自记 listeners，按引用注册/移除，并按 electron 语义以 (event, payload) 派发。
    const registered = new Map<string, (...args: unknown[]) => void>();
    let removedListener: ((...args: unknown[]) => void) | null = null;
    const ipc = {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        registered.set(channel, listener);
      },
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
        removedListener = listener;
        // 只有引用完全一致才真正撤除——对齐 electron 的按引用移除。
        if (registered.get(channel) === listener) registered.delete(channel);
      }
    };
    const emit = (payload: unknown) => {
      const listener = registered.get(IPC_CHANNELS.agentEvent);
      listener?.({}, payload);
    };

    const on = createIpcOn(ipc);
    const got: unknown[] = [];
    const off = on(IPC_CHANNELS.agentEvent, (payload) => got.push(payload));
    const wrapped = registered.get(IPC_CHANNELS.agentEvent);
    if (wrapped === undefined) throw new Error("on 必须把包装后的监听注册进去");

    emit({ type: "turn-start", turnId: "t1", threadKey: "a" });
    expect(got.length).toBe(1);

    off();
    // 核心断言：removeListener 收到的引用与 on 注册的必须是同一个。
    expect(removedListener).toBe(wrapped);

    emit({ type: "turn-start", turnId: "t2", threadKey: "a" });
    expect(got.length).toBe(1);
  });
});

describe("生产组合：createRendererApi + createIpcOn（真正进 contextBridge 的那一对接线）", () => {
  it("订阅→推送到达→退订→再推送不到达，且撤的就是注册的那个引用", () => {
    // 假 ipcRenderer：按引用注册/移除，并按 electron 语义以 (event, payload) 派发。
    const registered = new Map<string, (...args: unknown[]) => void>();
    const removed: { channel: string; listener: (...args: unknown[]) => void }[] = [];
    const fakeIpc = {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        registered.set(channel, listener);
      },
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
        removed.push({ channel, listener });
        if (registered.get(channel) === listener) registered.delete(channel);
      }
    };
    const emit = (payload: unknown) => {
      registered.get(IPC_CHANNELS.agentEvent)?.({}, payload);
    };

    const api = createRendererApi(
      () => Promise.resolve({ ok: true }) as Promise<never>,
      createIpcOn(fakeIpc)
    );
    const got: AgentOutbound[] = [];
    const off = api.onAgentEvent((payload) => got.push(payload));
    const wrapped = registered.get(IPC_CHANNELS.agentEvent);
    if (wrapped === undefined) throw new Error("onAgentEvent 必须经 createIpcOn 注册出监听器");

    emit({ type: "turn-start", turnId: "t1", threadKey: "a" });
    expect(got.map((payload) => payload.turnId)).toEqual(["t1"]);

    off();
    expect(removed.length).toBe(1);
    // 同引用断言：removeListener 拿到的必须是 on 注册的那个包装器，否则监听器永久泄漏。
    expect(removed[0]?.listener).toBe(wrapped);
    expect(removed[0]?.channel).toBe(IPC_CHANNELS.agentEvent);

    emit({ type: "turn-start", turnId: "t2", threadKey: "a" });
    expect(got.map((payload) => payload.turnId)).toEqual(["t1"]);
  });
});

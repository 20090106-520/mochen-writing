import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  safeStorage,
  shell
} from "electron";

// 开发期 Vite HMR 会重建渲染进程；旧 BrowserWindow 销毁后，主进程对它的 IPC _reply_ 会撞上 EPIPE。
// 这只在 dev 模式 reload 时弹出、生产构建从不发生。把 console 的落盘句柄包一层 EPIPE 吞掉，弹窗即消失。
const _rawError = console.error;
console.error = ((...args: unknown[]) => {
  try {
    _rawError(...args);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EPIPE") throw err;
  }
}) as typeof _rawError;
import { IPC_CHANNELS, splitSkillId } from "@mochen/contracts";
import type { BookMeta, ExportableDoc, ExportOptions, FlushQuitReply } from "@mochen/contracts";
import { buildExportContent } from "@mochen/fs-store/export-service";
import { parseFrontmatter } from "@mochen/fs-store";
import { createAgentService } from "./agent-service.js";
import { defaultPromptFor } from "./prompt-assembly.js";
import { registerAgentIpc, registerProviderIpc } from "./agent-ipc.js";
import { createAppearanceStore, registerAppearanceIpc } from "./appearance-store.js";
import { createChangeRetentionStore } from "./change-retention-store.js";
import { createBookService, registerBookIpc } from "./book-service.js";
import { installCrashGuard } from "./crash-guard.js";
import { installQuitFlush } from "./quit-flush.js";
import { createCredentialStore } from "./credential-store.js";
import { electronCipher } from "./electron-cipher.js";
import { registerPickDirectoryIpc } from "./pick-directory.js";
import { createProviderSettings } from "./provider-settings.js";
import { toProviderFetch } from "./provider-fetch.js";
import { createModelLister } from "./provider-models.js";
import { resolveTitleBarOverlayColors, resolveTitleBarPreferDark } from "./title-bar.js";
import { createSkillService, registerSkillIpc } from "./skill-service.js";
import { createSkillMarketService, registerSkillMarketIpc } from "./skill-market-service.js";
import { SKILL_CATALOG } from "./skill-catalog.js";
import { createPluginService, registerPluginIpc } from "./plugin-service.js";
import { seedBuiltinPlugins } from "./builtin-plugins.js";
import { createChangesService, registerChangesIpc } from "./changes-service.js";
import { registerWebSourceIpc } from "./web-source-link.js";
import { migrateLegacyAppData, migrationNotice } from "./app-data-migration.js";

/** F-4：品牌目录名。旧名只出现在迁移的入参里，源码别处一律用这两个常量。 */
const LEGACY_APP_DIR_NAME = "mochen-writing";
const APP_DIR_NAME = "mochen-ai";

/**
 * 进程级异常钩子（2026-10-09 全仓扫描 P0-6）：装在 `app.whenReady()` **之前**。
 *
 * 下面那条 `whenReady().then(async …)` 里任何一处抛——目录迁移、credential store、插件挂载——
 * 原本都会变成一个没人接的 rejection：**窗口永不出现、也永不提示**，用户唯一能看到的现象是
 * 「双击没反应」。钩子的三条规矩（留痕、只说第一次、自己绝不再抛）写在 `crash-guard.ts`，那边有用例。
 *
 * 日志落在**新品牌目录**的 `logs/crash.log`：这是诊断件，不参与 F-4 那条迁移（迁移只搬那三个已知文件），
 * 所以不需要跟着「kept-old 时仍读旧目录」那条判定走——写进新目录，下次报障时一眼找得到。
 */
const crashLogPath = path.join(app.getPath("appData"), APP_DIR_NAME, "logs", "crash.log");
/** 诊断件的唯一落点：崩溃钩子与退出握手都写这一份，报障时只看得到一个文件。 */
const appendCrashLine = (line: string): void => {
  mkdirSync(path.dirname(crashLogPath), { recursive: true });
  appendFileSync(crashLogPath, `${line}\n`, "utf8");
};
installCrashGuard({
  on: (event, handler) => {
    process.on(event, handler);
  },
  appendLine: appendCrashLine,
  notify: (title, detail) => {
    // 不带 parent：这一条常在「窗口根本没建起来」时发出去，那正是它要解释的那件事。
    dialog.showMessageBox({ type: "error", title, message: title, detail });
  },
  now: () => new Date().toISOString()
});

app.whenReady().then(async () => {
  // F-4：先把旧品牌目录搬走，**再建任何 store**。顺序反了的话这一次启动会先读旧目录，
  // 迁移变成「下次才生效」，而用户看到「已迁到」就会以为搬完了。
  const appDataBase = app.getPath("appData");
  const legacyDir = path.join(appDataBase, LEGACY_APP_DIR_NAME);
  const newSecretDir = path.join(appDataBase, APP_DIR_NAME);
  const migrationCipher = electronCipher(safeStorage);
  const report = await migrateLegacyAppData({
    oldDir: legacyDir,
    newDir: newSecretDir,
    copyFile: (src, dest) => copyFile(src, dest),
    readFile: (p) => readFile(p, "utf8"),
    readdir: async (p) => (await readdir(p)) as unknown as string[],
    rename: (from, to) => rename(from, to),
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    cipher: migrationCipher
  });
  // kept-old ⇒ 这一轮仍然用旧目录：应用必须继续读得到用户已经配好的东西。
  // 下面所有 store 都只认 activeDir，不认 newSecretDir——迁移失败时新目录是空的，
  // 照着它建 store 等于把用户已经配好的模型与密钥「读成没配过」。
  const activeDir = report.status === "kept-old" ? legacyDir : newSecretDir;
  const notice = migrationNotice(report, newSecretDir);
  if (notice !== null) {
    void dialog.showMessageBox({
      type: notice.type,
      message: "墨宸 AI · 设置目录",
      detail: notice.text
    });
  }

  // 外观设置与模型配置同住 activeDir（userData 一侧），坏了退默认值，不挡启动。
  // 外观要在窗口创建前先读一次：无边框窗口的窗控叠加区配色按主题上色（见下面 BrowserWindow）。
  const appearanceStore = createAppearanceStore({ dir: activeDir });
  const initialAppearance = (await appearanceStore.read()).settings;

  // 改稿历史的保留上限（2026-10-06 批次 5-⑧）：与外观同住 activeDir、同一套错误策略。
  //
  // **必须在建 BookService 之前**：写盘那次淘汰要现取这个上限，而 BookService 的
  // `retention` 是个必填的同步读口。缓存与刷新都住在 store 自己身上（`current()`），
  // 装配层只把它递下去——「存一份和改一份」这件事因此没有第二个可能出错的地方。
  const retentionStore = createChangeRetentionStore({ dir: activeDir });
  // 启动先读一次：读回来的是盘上的（或默认的），缓存即从这一份起步。
  await retentionStore.read();

  const service = createBookService({
    retention: () => retentionStore.current()
  });

  registerBookIpc(ipcMain, service);
  // dialog 的重载签名不好直接对接可测试的窄接口，这里做一层薄适配。
  registerPickDirectoryIpc(ipcMain, {
    showOpenDialog: (options) =>
      dialog.showOpenDialog({
        title: options.title,
        properties: options.properties as ("openDirectory" | "createDirectory")[]
      })
  });
  // 原生菜单栏（File/Edit/View/Window）没有一项是本产品的功能，整条去掉（用户裁定）。
  Menu.setApplicationMenu(null);
  // 无边框：原生标题条整条去掉（用户裁定，QQ/微信同款形态）。顶部拖动用渲染层栏头现成的
  // drag 区，右上角 —□× 走系统窗控叠加区（titleBarOverlay），高度对齐栏头的 50px，配色跟主题走。
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: "墨宸 AI",
    icon: fileURLToPath(new URL("../../resources/icon.ico", import.meta.url)),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      height: 50,
      ...resolveTitleBarOverlayColors(
        initialAppearance,
        resolveTitleBarPreferDark(initialAppearance.mode, nativeTheme.shouldUseDarkColors)
      )
    },
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win.show());

  // 窗控叠加区配色随主题刷新：外观保存（下面 wrapper）与系统深浅切换（这里）各一条通路。
  // Linux 没有 setTitleBarOverlay 这个方法，typeof 守卫跳过；mode 定死 light/dark 时
  // 系统切换算出的还是同色，刷新无副作用。
  let currentAppearance = initialAppearance;
  const applyTitleBarOverlay = () => {
    if (typeof win.setTitleBarOverlay !== "function") return;
    win.setTitleBarOverlay(
      resolveTitleBarOverlayColors(
        currentAppearance,
        resolveTitleBarPreferDark(currentAppearance.mode, nativeTheme.shouldUseDarkColors)
      )
    );
  };
  nativeTheme.on("updated", applyTitleBarOverlay);

  // 智能体全链：密钥与模型配置只在主进程，渲染层只收 turn-start / delta / event / turn-end。
  const credentials = createCredentialStore(activeDir, migrationCipher);
  const settings = createProviderSettings({ dir: activeDir, credentials });
  // 模型枚举只在这条线上出网：baseURL 与密钥都从 settings 里取，渲染层递不进任何一个字。
  const modelLister = createModelLister({ settings });
  // 挂入技能的读取走同一条真身（skill-service 的读取守卫），装配层不自己拼路径。
  const readSkillForTurn = async (id: string): Promise<{ title: string; text: string }> => {
    const parsed = splitSkillId(id);
    // 拆不出 id ⇒ 不猜来源、不去读盘：抛中文，让装配层把「读不到」如实说出去。
    if (parsed === null) throw new Error(`认不出这份技能：${id}。`);
    const content = await skillService.read(parsed.source, `${parsed.dirName}/SKILL.md`);
    // 【标题为什么不是目录名】占用条与给模型看的提示词块都用这个 title。
    // 目录名是给机器认的（chapter-intent），用户读到的是技能自己 frontmatter 里
    // 那个名字（落笔前先问清楚）——技能库那页显示的正是后者，
    // 两边不一致就成了「同一份技能，列表里一个名、上下文里另一个名」。
    // frontmatter 里没写 name 时才退回目录名：宁可显示机器名，也不要空着。
    // 只认字符串：frontmatter 的值类型是 `string | string[]`，写成列表的 name
    // 流进标题会变成「a,b」这种怪东西——宁可当它没写。
    const raw = parseFrontmatter(content.content).data.name;
    const named = typeof raw === "string" ? raw.trim() : "";
    return { title: named === "" ? parsed.dirName : named, text: content.content };
  };
  // 插件运行时（2026-10-07 批次 5-㉘）：扫 `<appData>/plugins/`，把按 DeepSeek Harness
  // 官方文档写的插件挂进来，它们注册的工具**叠加**到智能体工具表后面。
  // 只读全局目录，绝不往书目录里塞东西（与技能市场同一条铁律）。
  const pluginsDir = path.join(activeDir, "plugins");
  // 先把内置插件种进目录，**再**扫目录挂载——顺序反了就得等下次重启才认得它们。
  const planted = seedBuiltinPlugins(pluginsDir);
  if (planted.length > 0) {
    console.log(`[插件] 内置插件已就位：${planted.join("、")}`);
  }
  const plugins = createPluginService({
    pluginsDir,
    // 插件读书的入口。**每次现取**：插件挂在启动时，那时通常还没开书，
    // 用户随时会换书——在这里拍快照会让插件换书后还在读上一本（DocsService 头注释记着这条）。
    book: () => {
      const current = service.current();
      return current === null
        ? null
        : { root: current.root, docs: current.docs, title: current.meta.title };
    }
  });
  void plugins.mountAll().then((mounted) => {
    const failed = mounted.filter((one) => !one.ok);
    // 启动时只在**确有装不上的**时候说一句：一句一行，不刷屏。
    for (const one of failed) console.warn(`[插件] ${one.name}：${one.reason}`);
    if (mounted.some((one) => one.ok)) {
      console.log(`[插件] 已挂载 ${mounted.filter((one) => one.ok).length} 个`);
    }
  });
  registerPluginIpc((channel, fn) => ipcMain.handle(channel, fn), plugins);
  const agent = createAgentService({
    book: service,
    settings,
    fetchImpl: toProviderFetch((input) =>
      fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
        signal: input.signal
      })
    ),
    emit: (payload) => win.webContents.send(IPC_CHANNELS.agentEvent, payload),
    newId: () => randomUUID(),
    isoNow: () => new Date().toISOString(),
    promptFor: defaultPromptFor,
    readSkill: readSkillForTurn,
    plugins
  });
  registerAgentIpc((channel, fn) => ipcMain.handle(channel, fn), agent);
  registerProviderIpc((channel, fn) => ipcMain.handle(channel, fn), settings, modelLister);
  // 技能库只读：全局那份跟着 activeDir 走；书内那份跟着当前书走。
  // 注意（F-4 的已知边界）：§12 只搬那三个已知**文件**，全局 `skills/` 目录不在其中——
  // 用户自己放进去的技能会留在旧目录里（旧目录只改名不删除，所以没丢），需要时自取。
  const skillService = createSkillService({
    globalSkillsDir: path.join(activeDir, "skills"),
    bookRoot: () => service.current()?.root ?? null
  });
  registerSkillIpc((channel, fn) => ipcMain.handle(channel, fn), skillService);
  // 技能市场（2026-10-07）：列、装、卸。装卸**只写全局 skills 目录**，
  // 书目录是用户的作品，应用不往里塞文件（见 skill-market-service.ts 的三条守卫）。
  // 两个来源的技能根从只读那套 `dirOf` 借：`<appData>/skills` 与 `<书>/.mochen/skills`
  // 各只在一处拼，市场里再拼一遍就是第二份「技能在哪」的判定。
  const skillMarket = createSkillMarketService({
    catalog: SKILL_CATALOG,
    dirOf: (source) => skillService.dirOf(source)
  });
  registerSkillMarketIpc((channel, fn) => ipcMain.handle(channel, fn), skillMarket);
  // 改稿历史：列、读一条、把一篇文稿回滚到某条备份。回滚要落盘，所以它跟着**当前书**走——
  // 换书之后句柄就失效了，fs-store 那边的 realpath 守卫会直接拒掉越界的那条。
  const changesService = createChangesService({
    bookRoot: () => service.current()?.root ?? null,
    retention: retentionStore
  });
  registerChangesIpc((channel, fn) => ipcMain.handle(channel, fn), changesService);
  // 搜索来源的点开（批次 5-⑨）：本仓唯一递 URL 的一条，靠 http/https 白名单放行。
  registerWebSourceIpc((channel, fn) => ipcMain.handle(channel, fn), shell);
  // 外观读写仍走 appearance-store 同一份真身；保存成功后顺手刷新窗控叠加区配色。
  registerAppearanceIpc((channel, fn) => ipcMain.handle(channel, fn), {
    read: () => appearanceStore.read(),
    save: async (next) => {
      await appearanceStore.save(next);
      currentAppearance = next;
      applyTitleBarOverlay();
    }
  });

  // 导出内容组装（2026-10-05 批次 5-②）：EPUB 是 zip 包要 `node:zlib`，
  // 渲染层 import 那条链会把 Node 模块打进浏览器 bundle ⇒ 首屏白屏。
  // 所以「跑字节的」住主进程，渲染层只留纯函数（估大小 / 文件名 / markdown→html）。
  ipcMain.handle(
    IPC_CHANNELS.buildExport,
    async (_evt, docs: ExportableDoc[], meta: BookMeta | null, options: Partial<ExportOptions>) => {
      const result = buildExportContent(docs, meta, options);
      // Buffer 经 contextBridge 出去要变成 Uint8Array 才认得（Buffer 是它的子类，但结构化克隆按原型看）
      return { ...result, bytes: result.bytes === null ? null : new Uint8Array(result.bytes) };
    }
  );

  // 文件导出保存桥：渲染层递内容和文件名，主进程弹保存对话框并写盘。
  //
  // **content 收 `string | Uint8Array`**（2026-10-05 批次 5-②）：EPUB 是个 zip 包，
  // 按 utf-8 写盘就是一堆乱码。不新开一条 IPC 通道——那会让 preload / 通道表 / 边界守卫
  // 三处各多一份，而这里一个联合类型就够，且不新开通道＝不改 IPC 计数。
  ipcMain.handle(
    IPC_CHANNELS.saveFileExport,
    async (_evt, content: string | Uint8Array, filename: string, title?: string) => {
      const result = await dialog.showSaveDialog(win, {
        title: title ?? "保存文件",
        defaultPath: filename,
        filters: [{ name: "所有文件", extensions: ["*"] }]
      });
      if (result.canceled || !result.filePath) return false;
      const fs = await import("node:fs/promises");
      if (typeof content === "string") {
        await fs.writeFile(result.filePath, content, "utf-8");
      } else {
        // 字节直写：Buffer.from 复制一份，避免把渲染层那块内存直接交给 fs 去写
        await fs.writeFile(result.filePath, Buffer.from(content));
      }
      return true;
    }
  );

  // 系统通知桥
  ipcMain.handle(IPC_CHANNELS.appNotify, async (_evt, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });
  win.on("closed", () => agent.dispose());

  /**
   * 退出前的落盘握手（2026-10-09 全仓扫描 P0-6）：拦一次，请渲染层把每格没落盘的字写回盘，
   * 落成了才走、落不下去先问人、等不到回话就按原样放行。三条规矩与用例都在 `quit-flush.ts`。
   *
   * 为什么非得问渲染层：没保存的字只在那个窗口的内存里，主进程看不见，自己写不了。
   * 日志与崩溃钩子共用 `crash.log`——这两类事故本来就是同一次报障要看的两个现场。
   */
  installQuitFlush({
    onBeforeQuit: (handler) => {
      app.on("before-quit", handler);
    },
    onFlushReply: (handler) => {
      ipcMain.handle(IPC_CHANNELS.appFlushQuitDone, (_evt, reply: FlushQuitReply) => {
        handler(reply);
      });
    },
    sendFlushRequest: () => {
      win.webContents.send(IPC_CHANNELS.appFlushQuitRequest);
    },
    hasWindow: () => !win.isDestroyed(),
    askUser: (summary) =>
      // 默认停在「留下」，回车/取消也留在：这一趟的初衷就是别把还没落盘的字带走。
      dialog.showMessageBoxSync({
        type: "warning",
        title: "墨宸 AI · 有稿子没能落盘",
        message: "还有稿子没写回磁盘。仍要退出吗？",
        detail: summary,
        buttons: ["仍要退出", "留下"],
        defaultId: 1,
        cancelId: 1
      }) === 0
        ? "quit"
        : "stay",
    after: (ms, onElapsed) => {
      const timer = setTimeout(onElapsed, ms);
      return () => clearTimeout(timer);
    },
    log: appendCrashLine,
    quit: () => app.quit()
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
});

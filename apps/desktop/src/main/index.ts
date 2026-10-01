import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { IPC_CHANNELS } from "@mochen/contracts";
import { createAgentService, defaultPromptFor } from "./agent-service.js";
import { registerAgentIpc, registerProviderIpc } from "./agent-ipc.js";
import { createBookService, registerBookIpc } from "./book-service.js";
import { createCredentialStore } from "./credential-store.js";
import { electronCipher } from "./electron-cipher.js";
import { registerPickDirectoryIpc } from "./pick-directory.js";
import { createProviderSettings } from "./provider-settings.js";
import { toProviderFetch } from "./provider-fetch.js";

const service = createBookService();

app.whenReady().then(() => {
  registerBookIpc(ipcMain, service);
  // dialog 的重载签名不好直接对接可测试的窄接口，这里做一层薄适配。
  registerPickDirectoryIpc(ipcMain, {
    showOpenDialog: (options) =>
      dialog.showOpenDialog({
        title: options.title,
        properties: options.properties as ("openDirectory" | "createDirectory")[]
      })
  });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: "墨宸 AI",
    icon: fileURLToPath(new URL("../../resources/icon.ico", import.meta.url)),
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win.show());

  // 智能体全链：密钥与模型配置只在主进程，渲染层只收 turn-start / delta / event / turn-end。
  const secretDir = path.join(app.getPath("appData"), "mochen-writing");
  const credentials = createCredentialStore(secretDir, electronCipher(safeStorage));
  const settings = createProviderSettings({ dir: secretDir, credentials });
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
    promptFor: defaultPromptFor
  });
  registerAgentIpc((channel, fn) => ipcMain.handle(channel, fn), agent);
  registerProviderIpc((channel, fn) => ipcMain.handle(channel, fn), settings);
  win.on("closed", () => agent.dispose());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
});

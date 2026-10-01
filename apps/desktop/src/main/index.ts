import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createBookService, registerBookIpc } from "./book-service.js";
import { registerPickDirectoryIpc } from "./pick-directory.js";

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
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win.show());
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
});

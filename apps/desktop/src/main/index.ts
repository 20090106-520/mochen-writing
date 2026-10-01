import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { createBookService, registerBookIpc } from "./book-service.js";

const service = createBookService();

app.whenReady().then(() => {
  registerBookIpc(ipcMain, service);
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
});

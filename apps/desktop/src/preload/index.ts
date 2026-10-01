import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type RendererApi } from "@abyss/contracts";

const api: RendererApi = {
  openBook: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.bookOpen, rootPath),
  saveMeta: (meta) => ipcRenderer.invoke(IPC_CHANNELS.bookSaveMeta, meta),
  readDoc: (relPath) => ipcRenderer.invoke(IPC_CHANNELS.docRead, relPath),
  writeDoc: (relPath, content, expectedFingerprint) =>
    ipcRenderer.invoke(IPC_CHANNELS.docWrite, relPath, content, expectedFingerprint)
};

contextBridge.exposeInMainWorld("abyss", api);

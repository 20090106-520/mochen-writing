import { contextBridge, ipcRenderer } from "electron";
import { createIpcOn, createRendererApi } from "./renderer-api.js";

contextBridge.exposeInMainWorld(
  "mochen",
  createRendererApi(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args) as Promise<never>,
    createIpcOn(ipcRenderer)
  )
);

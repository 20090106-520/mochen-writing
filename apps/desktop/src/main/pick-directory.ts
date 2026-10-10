import { IPC_CHANNELS } from "@mochen/contracts";
// 连「弹一个目录选择框」都要问来源：不可信的帧能叫出这个对话框，就能拿它去试探用户（P1-7）。
import { handleTrusted, type IpcRegistrar } from "./ipc-guard.js";

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface DirectoryChooser {
  showOpenDialog(options: { title: string; properties: string[] }): Promise<OpenDialogResult>;
}

/** 只回一个目录路径；用户取消或系统没给路径时返回 null，渲染层据此什么都不做。 */
export function registerPickDirectoryIpc(
  ipcMain: { handle(channel: string, fn: (...args: unknown[]) => unknown): void },
  dialog: DirectoryChooser
): void {
  const register: IpcRegistrar = (channel, fn) => ipcMain.handle(channel, fn);
  // 这条没有参数（`IPC_NO_ARG_CHANNELS`），但来源照样要判：
  // 正常路径里 `book:open` 拿到的目录就是从这条对话框出来的，通道本身此前不认这个来源。
  handleTrusted(register, IPC_CHANNELS.bookPick, async () => {
    const result = await dialog.showOpenDialog({
      title: "选择作品目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
}

import { IPC_CHANNELS } from "@mochen/contracts";

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
  ipcMain.handle(IPC_CHANNELS.bookPick, async () => {
    const result = await dialog.showOpenDialog({
      title: "选择作品目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
}

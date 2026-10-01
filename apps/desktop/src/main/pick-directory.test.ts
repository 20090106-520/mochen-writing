import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@abyss/contracts";
import { registerPickDirectoryIpc } from "./pick-directory.js";

interface DialogStub {
  showOpenDialog(options: {
    properties: string[];
    title: string;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

function harness(result: { canceled: boolean; filePaths: string[] }) {
  const dialog: DialogStub = { showOpenDialog: vi.fn(async () => result) };
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle(channel: string, fn: (...args: unknown[]) => unknown) {
      handlers.set(channel, fn);
    }
  };
  registerPickDirectoryIpc(ipcMain, dialog);
  return {
    dialog,
    pick: () => handlers.get(IPC_CHANNELS.bookPick)?.({} as never) as Promise<string | null>
  };
}

describe("作品目录选择", () => {
  it("用户取消时返回 null 而不是空串", async () => {
    const { pick } = harness({ canceled: true, filePaths: [] });
    expect(await pick()).toBe(null);
  });

  it("取消标记优先：即使系统仍带回路径也不能当作选中", async () => {
    const { pick } = harness({ canceled: true, filePaths: ["D:/book"] });
    expect(await pick()).toBe(null);
  });

  it("选中目录时返回第一个路径", async () => {
    const { pick } = harness({ canceled: false, filePaths: ["D:/book", "D:/other"] });
    expect(await pick()).toBe("D:/book");
  });

  it("没取消但一个路径都没给时同样返回 null", async () => {
    const { pick } = harness({ canceled: false, filePaths: [] });
    expect(await pick()).toBe(null);
  });

  it("对话框必须声明只能选目录", async () => {
    const { dialog, pick } = harness({ canceled: true, filePaths: [] });
    await pick();
    const options = vi.mocked(dialog.showOpenDialog).mock.calls[0]![0];
    expect(options.properties).toEqual(["openDirectory", "createDirectory"]);
  });
});

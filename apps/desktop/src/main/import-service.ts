import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  TXT_IMPORT_MAX_BYTES,
  detectTxtEncoding,
  planImportRelPaths,
  splitTxtChapters,
  type TxtImportCommitInput,
  type TxtImportCommitResult,
  type TxtImportPreviewResult
} from "@mochen/contracts";
import { createDocFile, type AtomicWriteFs, defaultAtomicFs } from "@mochen/fs-store";
import { handleTrusted, type IpcRegistrar } from "./ipc-guard.js";

/**
 * TXT 导入服务（2026-10-11）。两条通道，各做一件事：
 * - `import:pick-preview`：弹选文件框 → 读字节 → 探编码 → 切章，一次带回整份预览。
 *   选文件与读字节只能在主进程——渲染层没有任意读盘的能力，这正是沙箱的意义。
 * - `import:commit`：把确认后的章目落成 `chapters/` 下的文稿。路径由主进程拼
 *   （planImportRelPaths → planDocRelPath，渲染层递不了路径），写盘走 `createDocFile`
 *   既有守卫（安全路径 / 文稿目录 / 已存在拒绝 / 原子写），不另写第二套。
 *
 * 重名语义是**整批先查、一个不写**：批内重名与盘上撞名都在落盘前拦下，
 * 把撞名标题点名交回预览——「导到一半停」比「一开始就不开始」糟得多。
 */

/** 与 pick-directory 同形的窄接口：dialog 的重载签名不好直接对接可测试的窄面。 */
export interface ImportDialogLike {
  showOpenDialog(options: {
    title: string;
    filters: { name: string; extensions: string[] }[];
    properties: string[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface ImportServiceDeps {
  /** 当前书的根与已有文稿清单（查盘上撞名用）；没开书返回 null。 */
  book: () => { root: string; docRelPaths: string[] } | null;
  dialog: ImportDialogLike;
  /** 读文件字节（测试缝）。 */
  readBytes?: (filePath: string) => Promise<Buffer>;
  /** 原子写 fs 缝（测试缝），与 book-service 同源。 */
  fs?: AtomicWriteFs;
  /** 章节数上限（防呆：一部 txt 切出五万「章」多半是切错了）。 */
  maxChapters?: number;
}

/** 单本 txt 切章的合理上限。网文长篇千章常见、万章罕见；超过多半是正文被误认成了标题。 */
const DEFAULT_MAX_CHAPTERS = 3000;

export interface ImportService {
  preview(): Promise<TxtImportPreviewResult>;
  commit(input: unknown): Promise<TxtImportCommitResult>;
}

export function createImportService(deps: ImportServiceDeps): ImportService {
  const readBytes = deps.readBytes ?? ((p: string) => readFile(p));
  const fs = deps.fs ?? defaultAtomicFs;
  const maxChapters = deps.maxChapters ?? DEFAULT_MAX_CHAPTERS;

  return {
    async preview(): Promise<TxtImportPreviewResult> {
      if (deps.book() === null)
        return { ok: false, reason: "no-book", message: "尚未打开作品目录，先在左栏打开一本书。" };
      const picked = await deps.dialog.showOpenDialog({
        title: "选择要导入的 TXT 文件",
        filters: [
          { name: "文本文件", extensions: ["txt"] },
          { name: "所有文件", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });
      if (picked.canceled || picked.filePaths.length === 0)
        return { ok: false, reason: "canceled", message: "" };
      const filePath = picked.filePaths[0]!;
      const info = await stat(filePath).catch(() => null);
      if (info === null || !info.isFile())
        return { ok: false, reason: "read-error", message: "读不到这个文件，换一个试试。" };
      if (info.size > TXT_IMPORT_MAX_BYTES)
        return {
          ok: false,
          reason: "too-large",
          message: `文件超过 ${Math.round(TXT_IMPORT_MAX_BYTES / 1024 / 1024)} MB 上限（这个文件约 ${Math.round(
            info.size / 1024 / 1024
          )} MB）——确认选的是单本书的 txt。`
        };
      const bytes = await readBytes(filePath).catch(() => null);
      if (bytes === null)
        return { ok: false, reason: "read-error", message: "读这个文件时出错，换一个试试。" };
      const encoding = detectTxtEncoding(bytes);
      const text = new TextDecoder(encoding).decode(bytes);
      const fileName = path.basename(filePath, path.extname(filePath));
      const chapters = splitTxtChapters(text, fileName);
      if (chapters.length === 0 || chapters.every((c) => c.content === ""))
        return {
          ok: false,
          reason: "empty",
          message: "这个文件里没有读到正文。"
        };
      if (chapters.length > maxChapters)
        return {
          ok: false,
          reason: "too-large",
          message: `切出了 ${chapters.length} 个章节（上限 ${maxChapters}）——多半是正文被误认成了章节标题，先整理一下这份 txt。`
        };
      return { ok: true, fileName, encoding, chapters };
    },

    async commit(raw: unknown): Promise<TxtImportCommitResult> {
      const book = deps.book();
      if (book === null)
        return { ok: false, reason: "no-book", message: "尚未打开作品目录，先在左栏打开一本书。" };
      // 跨进程来的参数当不可信：形状由这里判，不 cast 了事。
      const chapters = (raw as TxtImportCommitInput | null)?.chapters;
      if (
        !Array.isArray(chapters) ||
        chapters.length === 0 ||
        chapters.some(
          (c) =>
            c === null ||
            typeof c !== "object" ||
            typeof c.title !== "string" ||
            typeof c.content !== "string"
        )
      )
        return { ok: false, reason: "empty", message: "没有要导入的章节。" };
      const totalChars = chapters.reduce((sum, c) => sum + c.content.length, 0);
      if (totalChars > TXT_IMPORT_MAX_BYTES)
        return {
          ok: false,
          reason: "too-large",
          message: "这一批正文总量超出单次导入上限，分两次导。"
        };
      const planned = planImportRelPaths(chapters);
      if (!planned.ok) {
        const parts: string[] = [];
        if (planned.invalid.length > 0)
          parts.push(`这些标题当不了文件名：${planned.invalid.map((t) => `「${t}」`).join("、")}`);
        if (planned.conflicts.length > 0)
          parts.push(`批内有重名标题：${planned.conflicts.map((t) => `「${t}」`).join("、")}`);
        return {
          ok: false,
          reason: planned.invalid.length > 0 ? "invalid-title" : "name-conflict",
          message: `${parts.join("；")}。改好标题再导。`
        };
      }
      // 盘上撞名也**整批先查**：书稿快照可能落后于盘面，最终以 createDocFile 的
      // already-exists 为准——所以先按快照查一遍给用户看，写盘阶段再兜一遍底。
      const existing = new Set(book.docRelPaths);
      const onDisk = planned.relPaths.filter((rel) => existing.has(rel));
      if (onDisk.length > 0)
        return {
          ok: false,
          reason: "name-conflict",
          message: `书里已有同名文稿：${onDisk
            .map((rel) => `「${path.basename(rel, ".md")}」`)
            .join("、")}。改好标题再导，不会覆盖已有内容。`,
          conflicts: onDisk
        };
      const created: string[] = [];
      for (let i = 0; i < chapters.length; i += 1) {
        const chapter = chapters[i]!;
        const relPath = planned.relPaths[i]!;
        // createDocFile 建出的文件 = frontmatter(title) + body；守卫与行内新建同一份。
        // 「已存在拒绝」之外的真 IO 错（磁盘满、占用）会从原子写里抛出来——接住转成契约的
        // io-error 并带上已写入篇数；裸抛过 IPC 会让对话框悬死在 await 上。
        let result: Awaited<ReturnType<typeof createDocFile>>;
        try {
          result = await createDocFile(
            book.root,
            relPath,
            chapter.title.trim(),
            fs,
            chapter.content
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            reason: "io-error",
            message:
              created.length === 0
                ? `写入失败：${message}`
                : `已写入前 ${created.length} 篇后中断：${message}。再导一次剩下的即可（已导入的不会重复）。`
          };
        }
        if (!result.ok) {
          if (result.reason === "already-exists")
            return {
              ok: false,
              reason: "name-conflict",
              message: `「${chapter.title}」在书里已有人同名——前 ${created.length} 篇已导入，改好标题重导剩下的即可（已导入的不会重复）。`,
              conflicts: [relPath]
            };
          return {
            ok: false,
            reason: "io-error",
            message:
              created.length === 0
                ? `写入失败：${result.message}`
                : `已写入前 ${created.length} 篇后中断：${result.message}。再导一次剩下的即可（已导入的不会重复）。`
          };
        }
        created.push(relPath);
      }
      return { ok: true, created };
    }
  };
}

export function registerImportIpc(register: IpcRegistrar, service: ImportService): void {
  handleTrusted(register, IPC_CHANNELS.importPreview, () => service.preview());
  // commit 的入参由 service 自己按 unknown 判形状（上面 commit 里那段），闸不替它编理由。
  handleTrusted(register, IPC_CHANNELS.importCommit, (_event, input) => service.commit(input));
}

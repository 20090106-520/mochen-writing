import { describe, expect, it, vi } from "vitest";
import { RECAP_MAX_CHARS, type BookMeta } from "@mochen/contracts";
import type { ProviderFetch } from "@mochen/agent-runtime";
import {
  createChapterRecap,
  createRecapQueue,
  RECAP_SYSTEM_PROMPT,
  type RecapBook
} from "./chapter-recap.js";
import type { ProviderSettings } from "./provider-settings.js";

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("等不到期望状态");
}

function fakeBook(content = "正文"): { book: RecapBook; meta: () => BookMeta } {
  let meta: BookMeta = {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "full-access",
    chapterOrder: []
  };
  return {
    book: {
      current: () => ({ docs: [{ relPath: "chapters/01-开局.md", title: "第一章" }], meta }),
      readDoc: async () => ({ content }),
      saveMeta: async (next) => {
        meta = next;
      }
    },
    meta: () => meta
  };
}

/**
 * 章末摘要的生成端（2026-11-17 spec 阶段 C2）。
 * 这里只钉「失败必须安静、成功必须短」：上游长什么样由 provider-client 的测试管。
 */
const CONFIG = {
  baseURL: "https://mock.invalid/v1",
  model: "mock-model",
  authHeader: "bearer" as const,
  thinkingWire: "standard" as const,
  contextWindow: 64_000
};

function fakeSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    config: vi.fn(async () => CONFIG),
    apiKey: vi.fn(async () => "k"),
    ...overrides
  } as unknown as ProviderSettings;
}

function sseFetch(text: string): ProviderFetch {
  return vi.fn(async () => ({
    status: 200,
    errorText: "",
    stream: (async function* () {
      yield new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
      );
      yield new TextEncoder().encode("data: [DONE]\n\n");
    })()
  }));
}

describe("createChapterRecap", () => {
  it("成功时回裁好的摘要，且系统指令就是那一条", async () => {
    const fetchImpl = sseFetch("  林夜拿到船票，约定三日后出海。  ");
    const recap = createChapterRecap({ settings: fakeSettings(), fetchImpl });
    await expect(recap.summarize({ title: "第二章", content: "正文" })).resolves.toBe(
      "林夜拿到船票，约定三日后出海。"
    );
    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[0]![0].body) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]?.content).toBe(RECAP_SYSTEM_PROMPT);
  });

  it("超长摘要按 RECAP_MAX_CHARS 截断，不把全书摘要塞进 book.json", async () => {
    const recap = createChapterRecap({
      settings: fakeSettings(),
      fetchImpl: sseFetch("字".repeat(RECAP_MAX_CHARS + 50))
    });
    const text = await recap.summarize({ title: "第二章", content: "正文" });
    expect(text).toHaveLength(RECAP_MAX_CHARS);
  });

  it("没配置 / 没密钥 / 空正文一律回 null，且不发请求", async () => {
    const fetchImpl = sseFetch("不该到嘴");
    const noConfig = createChapterRecap({
      settings: fakeSettings({ config: vi.fn(async () => null) as never }),
      fetchImpl
    });
    const noKey = createChapterRecap({
      settings: fakeSettings({ apiKey: vi.fn(async () => null) as never }),
      fetchImpl
    });
    const empty = createChapterRecap({ settings: fakeSettings(), fetchImpl });

    await expect(noConfig.summarize({ title: "t", content: "正文" })).resolves.toBeNull();
    await expect(noKey.summarize({ title: "t", content: "正文" })).resolves.toBeNull();
    await expect(empty.summarize({ title: "t", content: "   " })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("摘要成功后才并入 book.json 的 recaps（只并这一章，不碰别的键）", async () => {
    const { book, meta } = fakeBook();
    const summarize = vi.fn(async () => "林夜拿到船票。");
    createRecapQueue({ book, recap: { summarize } }).queue(["chapters/01-开局.md"]);

    await until(() => meta().recaps?.["chapters/01-开局.md"] === "林夜拿到船票。");
    expect(summarize).toHaveBeenCalledWith({ title: "第一章", content: "正文" });
    expect(meta().title).toBe("深渊之下");
  });

  it("回 null / 抛错都不往 book.json 留空串，也不把异常甩给调用方", async () => {
    for (const summarize of [
      async () => null,
      async () => {
        throw new Error("上游挂了");
      }
    ]) {
      const { book, meta } = fakeBook();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      createRecapQueue({ book, recap: { summarize } }).queue(["chapters/01-开局.md"]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(meta().recaps).toBeUndefined();
      warn.mockRestore();
    }
  });

  it("同一章在跑时不重复排队：连给两次也只生成一次", async () => {
    const { book } = fakeBook();
    const summarize = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("摘要"), 10))
    );
    const queue = createRecapQueue({ book, recap: { summarize } });
    queue.queue(["chapters/01-开局.md"]);
    queue.queue(["chapters/01-开局.md"]);
    await until(() => summarize.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("上游报错或回空文本都回 null，绝不抛给调用方", async () => {
    const failing = vi.fn(async () => {
      throw new Error("连接断了");
    }) as unknown as ProviderFetch;
    const emptyText = sseFetch("   ");

    await expect(
      createChapterRecap({ settings: fakeSettings(), fetchImpl: failing }).summarize({
        title: "t",
        content: "正文"
      })
    ).resolves.toBeNull();
    await expect(
      createChapterRecap({ settings: fakeSettings(), fetchImpl: emptyText }).summarize({
        title: "t",
        content: "正文"
      })
    ).resolves.toBeNull();
  });
});

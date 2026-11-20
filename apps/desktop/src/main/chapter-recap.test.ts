import { describe, expect, it, vi } from "vitest";
import { RECAP_MAX_CHARS, type BookDigest, type BookMeta } from "@mochen/contracts";
import type { ProviderFetch } from "@mochen/agent-runtime";
import {
  createChapterRecap,
  createRecapQueue,
  DIGEST_SYSTEM_PROMPT,
  RECAP_SYSTEM_PROMPT,
  type ChapterRecap,
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
      mergeRecaps: async (relPath, text) => {
        meta = { ...meta, recaps: { ...(meta.recaps ?? {}), [relPath]: text } };
      },
      mergeDigest: async (digest) => {
        meta = { ...meta, digest };
      }
    },
    meta: () => meta
  };
}

/** 只关心摘要那条通路时，状态卡一律回 null（不写回、不干扰断言）。 */
function recapOf(
  summarize: ChapterRecap["summarize"],
  digestize: ChapterRecap["digestize"] = async () => null
): ChapterRecap {
  return { summarize, digestize };
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
  const configFor = vi.fn(async () => ({ config: CONFIG, apiKey: "k" }));
  return {
    configFor,
    config: async () => (await configFor()).config,
    apiKey: async () => (await configFor()).apiKey,
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

  it("没可用配置 / 空正文一律回 null，且不发请求", async () => {
    const fetchImpl = sseFetch("不该到嘴");
    const noConfig = createChapterRecap({
      settings: fakeSettings({ configFor: vi.fn(async () => null) as never }),
      fetchImpl
    });
    const empty = createChapterRecap({ settings: fakeSettings(), fetchImpl });

    await expect(noConfig.summarize({ title: "t", content: "正文" })).resolves.toBeNull();
    await expect(empty.summarize({ title: "t", content: "   " })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("摘要与状态卡都取「后台杂活」这条通路，不偷用写作轮配置", async () => {
    const settings = fakeSettings();
    const recap = createChapterRecap({ settings, fetchImpl: sseFetch("【全书摘要】林夜登船。") });
    await recap.summarize({ title: "t", content: "正文" });
    await recap.digestize({ title: "t", recap: "正文", previous: null });
    expect(vi.mocked(settings.configFor).mock.calls).toEqual([["utility"], ["utility"]]);
  });

  it("摘要成功后才并入 book.json 的 recaps（只并这一章，不碰别的键）", async () => {
    const { book, meta } = fakeBook();
    const summarize = vi.fn(async () => "林夜拿到船票。");
    createRecapQueue({ book, recap: recapOf(summarize) }).queue(["chapters/01-开局.md"]);

    await until(() => meta().recaps?.["chapters/01-开局.md"] === "林夜拿到船票。");
    expect(summarize).toHaveBeenCalledWith({ title: "第一章", content: "正文" });
    expect(meta().title).toBe("深渊之下");
  });

  it("只走 mergeRecaps，不再整份回写 meta（审计 R-4）", async () => {
    const mergeRecaps = vi.fn(async () => undefined);
    const saveMeta = vi.fn(async () => undefined);
    // saveMeta 已不是 RecapBook 的一部分：这里故意塞进去，钉住「队列不许再整份回写」。
    const book = {
      current: () => ({ docs: [{ relPath: "chapters/01-开局.md", title: "第一章" }], meta: {} }),
      readDoc: async () => ({ content: "正文" }),
      mergeRecaps,
      mergeDigest: async () => undefined,
      saveMeta
    } as unknown as RecapBook;

    createRecapQueue({ book, recap: recapOf(async () => "摘要句") }).queue(["chapters/01-开局.md"]);

    await until(() => mergeRecaps.mock.calls.length === 1);
    expect(mergeRecaps).toHaveBeenCalledWith("chapters/01-开局.md", "摘要句");
    expect(saveMeta).not.toHaveBeenCalled();
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
      createRecapQueue({ book, recap: recapOf(summarize) }).queue(["chapters/01-开局.md"]);
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
    const queue = createRecapQueue({ book, recap: recapOf(summarize) });
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

describe("createChapterRecap · 全书状态卡", () => {
  it("按两段解析成状态卡，并把上一份状态与本章摘要一起交给模型", async () => {
    const fetchImpl = sseFetch("【全书摘要】林夜抵达雾港。\n【人物状态】\n- 林夜：在找船。");
    const recap = createChapterRecap({ settings: fakeSettings(), fetchImpl });
    await expect(
      recap.digestize({
        title: "第三章",
        recap: "林夜登岸。",
        previous: { summary: "林夜出海。", cast: "- 林夜：在船上。" }
      })
    ).resolves.toEqual({ summary: "林夜抵达雾港。", cast: "- 林夜：在找船。" });

    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[0]![0].body) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]?.content).toBe(DIGEST_SYSTEM_PROMPT);
    expect(body.messages[1]?.content).toContain("林夜出海。");
    expect(body.messages[1]?.content).toContain("林夜登岸。");
  });

  it("模型没按两段输出 ⇒ null（不猜摘要）", async () => {
    const recap = createChapterRecap({
      settings: fakeSettings(),
      fetchImpl: sseFetch("林夜到了雾港，故事继续。")
    });
    await expect(
      recap.digestize({ title: "t", recap: "正文", previous: null })
    ).resolves.toBeNull();
  });

  it("没配置 / 空摘要 ⇒ null，且不发请求", async () => {
    const fetchImpl = sseFetch("不该到嘴");
    const noConfig = createChapterRecap({
      settings: fakeSettings({ configFor: vi.fn(async () => null) as never }),
      fetchImpl
    });
    const empty = createChapterRecap({ settings: fakeSettings(), fetchImpl });

    await expect(
      noConfig.digestize({ title: "t", recap: "正文", previous: null })
    ).resolves.toBeNull();
    await expect(empty.digestize({ title: "t", recap: "   ", previous: null })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createRecapQueue · 全书状态卡", () => {
  it("摘要落盘后更新状态卡；两章同时写完时串行拿到上一份，不互相覆盖", async () => {
    const { book, meta } = fakeBook();
    const digestize = vi.fn(
      async (input: { previous: BookDigest | null }): Promise<BookDigest> => ({
        summary: input.previous === null ? "A" : `A+${input.previous.summary}`,
        cast: ""
      })
    );
    createRecapQueue({ book, recap: recapOf(async () => "摘要句", digestize) }).queue([
      "chapters/01-开局.md",
      "chapters/02-夜航.md"
    ]);

    await until(() => meta().digest?.summary === "A+A");
    expect(digestize).toHaveBeenCalledTimes(2);
    // 第二次一定读到第一次写回的那份：否则状态卡会退回「上一章之前」的旧局面。
    expect(digestize.mock.calls[1]![0].previous).toEqual({ summary: "A", cast: "" });
  });
});

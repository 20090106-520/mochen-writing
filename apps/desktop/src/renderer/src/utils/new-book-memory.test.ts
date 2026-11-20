import { describe, expect, it } from "vitest";
import {
  EMPTY_NEW_BOOK_PROJECT,
  NEW_BOOK_MEMORY_STORAGE_KEY,
  hasRememberedProject,
  loadRememberedProject,
  parseRememberedProject,
  rememberedProjectSummary,
  saveRememberedProject,
  type NewBookProjectDraft
} from "./new-book-memory";

/** 一枚内存存储，行为跟 localStorage 一样（存字符串、读字符串）。 */
function memoryStorage(initial: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    data
  };
}

const FILLED: NewBookProjectDraft = {
  genre: "都市异能 · 男频",
  platform: "起点",
  length: "80–120 万字",
  cadence: "日更 2 章",
  taboos: "不写虐杀",
  pitch: "一个能看见他人剩余寿命的少年"
};

describe("新建作品 · 立项速记的记忆", () => {
  it("存进去读得回来，六格一字不差", () => {
    const storage = memoryStorage();
    expect(saveRememberedProject(storage, FILLED)).toBe(true);
    expect(loadRememberedProject(storage)).toEqual(FILLED);
  });

  it("存储键带 mochen 前缀，与其余偏好同族", () => {
    expect(NEW_BOOK_MEMORY_STORAGE_KEY.startsWith("mochen:")).toBe(true);
  });

  it("六格全空就不写 —— 免得把「上次跳过立项」记成一份空记忆", () => {
    const storage = memoryStorage();
    expect(saveRememberedProject(storage, { ...EMPTY_NEW_BOOK_PROJECT })).toBe(false);
    expect(storage.data[NEW_BOOK_MEMORY_STORAGE_KEY]).toBeUndefined();
  });

  it("读不到就当没记，不抛", () => {
    const storage = memoryStorage();
    expect(loadRememberedProject(storage)).toEqual(EMPTY_NEW_BOOK_PROJECT);
  });

  it("存坏了就当没记，不抛", () => {
    const storage = memoryStorage({ [NEW_BOOK_MEMORY_STORAGE_KEY]: "{不是 JSON" });
    expect(loadRememberedProject(storage)).toEqual(EMPTY_NEW_BOOK_PROJECT);
  });

  it("版本号不对 ⇒ 整份当没记（那是另一套形状的记录）", () => {
    const parsed = parseRememberedProject(JSON.stringify({ version: 2, genre: "玄幻" }));
    expect(parsed).toEqual(EMPTY_NEW_BOOK_PROJECT);
  });

  it("一格坏了只丢那一格，其余五格照旧", () => {
    const parsed = parseRememberedProject(
      JSON.stringify({ version: 1, genre: "玄幻", platform: 42, length: "80 万字" })
    );
    expect(parsed.genre).toBe("玄幻");
    expect(parsed.platform).toBe("");
    expect(parsed.length).toBe("80 万字");
  });

  it("写不进去如实返回 false，不假装存上了", () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("配额满了");
      }
    };
    expect(saveRememberedProject(broken, FILLED)).toBe(false);
  });
});

describe("新建作品 · 「上次的设定」那一行", () => {
  it("真记过才说有", () => {
    expect(hasRememberedProject(EMPTY_NEW_BOOK_PROJECT)).toBe(false);
    expect(hasRememberedProject(FILLED)).toBe(true);
  });

  it("摘要只取前四格（短的那些），雷点与卖点不进摘要", () => {
    expect(rememberedProjectSummary(FILLED)).toBe(
      "都市异能 · 男频 · 起点 · 80–120 万字 · 日更 2 章"
    );
    expect(rememberedProjectSummary(FILLED)).not.toContain("不写虐杀");
    expect(rememberedProjectSummary(FILLED)).not.toContain("少年");
  });

  it("一格都没填时摘要为空串（那一行整条不出现）", () => {
    expect(rememberedProjectSummary(EMPTY_NEW_BOOK_PROJECT)).toBe("");
  });
});

/**
 * 行内引用菜单的判定层用例（#106，纯函数，无 DOM）。
 * 脑子对齐 deepwrite：`utils/composerReferences.ts` 的触发/插入判定 +
 * `composables/useConversationComposer.ts` 的过滤/上下键/空态口径。
 * 本文件同时是「Enter 只插入/执行、绝不发送」这条裁定的证据：结果联合里根本没有 send 这一型。
 */
import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { SLASH_COMMANDS, SLASH_COMMAND_DESCRIPTIONS } from "./slash-commands";
import { BOOK_KIND_LABELS } from "./book-kinds";
import {
  REFERENCE_MENU_COPY,
  REFERENCE_OPTION_LIMIT,
  REFERENCE_TRIGGERS,
  clampReferenceIndex,
  findReferenceMatch,
  materialReferenceText,
  moveReferenceIndex,
  referenceEmptyText,
  referenceOptionPool,
  referenceVisibleOptions,
  resolveReferenceSelection,
  type ReferenceMenuPool
} from "./inline-reference-menu";

function doc(overrides: Partial<DocRef> = {}): DocRef {
  return { relPath: "chapters/ch01.md", kind: "chapter", title: "第一章", ...overrides };
}

/** `/` 侧的池：命令名只从 slash-commands 那张表传进来（本文件不写第二份命令名）。 */
function commandPool(commands: readonly string[] = SLASH_COMMANDS): ReferenceMenuPool {
  return { commands: commands as ReferenceMenuPool["commands"], docs: [] };
}

function docPool(docs: DocRef[]): ReferenceMenuPool {
  return { commands: [], docs };
}

describe("findReferenceMatch · 触发条件（deepwrite composerReferences 的原判定）", () => {
  it("`/` 后无空格且光标紧跟 ⇒ 打开 / 菜单，query 是空串", () => {
    expect(findReferenceMatch("帮我改 /", 5)).toEqual({
      trigger: "/",
      start: 4,
      caret: 5,
      query: ""
    });
  });

  it("词中光标也认：`第二段 @开` 停在字里 ⇒ trigger @ 与 query 开（不是整句）", () => {
    const match = findReferenceMatch("第二段 @开", 6);
    expect(match).not.toBeNull();
    expect(match?.trigger).toBe("@");
    expect(match?.start).toBe(4);
    expect(match?.query).toBe("开");
  });

  it("跨空格不算：触发词后面已经落了空格 ⇒ null；光标退回字里照样打开", () => {
    expect(findReferenceMatch("引用 @开 这一段", 7)).toBeNull();
    expect(findReferenceMatch("引用 @开 这一段", 5)).not.toBeNull();
  });

  it("光标在串首 / 整句没有触发符 ⇒ null（反向用例）", () => {
    expect(findReferenceMatch("正常的一句话", 6)).toBeNull();
    expect(findReferenceMatch("/model", 0)).toBeNull();
  });

  it("触发符紧跟英文、数字或路径字符 ⇒ null；紧跟中文 ⇒ 照常打开", () => {
    expect(findReferenceMatch("path/mod", 8)).toBeNull();
    expect(findReferenceMatch("user@name", 9)).toBeNull();
    expect(findReferenceMatch("v1@", 3)).toBeNull();
    // 中文没有词边界，`第二段/` 里那个斜杠就是用户真打的触发符——deepwrite 的前置黑名单只挡拉丁字符。
    expect(findReferenceMatch("第二段/", 4)?.trigger).toBe("/");
  });

  it("两个触发符并存时取离光标最近的那个", () => {
    const match = findReferenceMatch("/mod 与 @材", 10);
    expect(match?.trigger).toBe("@");
    expect(match?.start).toBe(7);
    expect(match?.query).toBe("材");
  });

  it("query 里再出现 / 或 @（路径、邮箱形态）⇒ 不打开菜单", () => {
    expect(findReferenceMatch("@a/b", 4)).toBeNull();
    expect(findReferenceMatch("@mod@x", 6)).toBeNull();
  });

  it("caret 越界一律钳到串长；只看光标之前，之后的文本不参与判定", () => {
    expect(findReferenceMatch("/mo", 99)).toEqual({
      trigger: "/",
      start: 0,
      caret: 3,
      query: "mo"
    });
    expect(findReferenceMatch("/model 收尾", 3)?.query).toBe("mo");
  });
});

describe("referenceOptionPool · 条目只从既有唯一真身来（铁律 6）", () => {
  it("`/` 的条目 = slash-commands 那张表的命令名 + 同一张说明表，label/detail 都不自造", () => {
    const match = findReferenceMatch("/", 1);
    expect(match).not.toBeNull();
    const options = referenceOptionPool(match!, commandPool(["model", "status"]));
    expect(options.map((option) => option.label)).toEqual(["model", "status"]);
    expect(options.map((option) => option.detail)).toEqual([
      SLASH_COMMAND_DESCRIPTIONS.model,
      SLASH_COMMAND_DESCRIPTIONS.status
    ]);
    expect(options[0]).toMatchObject({ trigger: "/", command: "model" });
  });

  it("`@` 的条目 = book store 的 DocRef 列表，detail 用 book-kinds 那张中文标签表（不再写一份）", () => {
    const match = findReferenceMatch("@", 1);
    const options = referenceOptionPool(
      match!,
      docPool([doc({ kind: "material", title: "灵感" })])
    );
    expect(options[0]?.label).toBe("灵感");
    expect(options[0]?.detail).toContain(BOOK_KIND_LABELS.material);
    expect(options[0]?.doc?.relPath).toBe("chapters/ch01.md");
  });

  it("无书 / 无文档时 `@` 的池是空的——空池不是假条目（反向用例）", () => {
    const match = findReferenceMatch("@", 1);
    expect(referenceOptionPool(match!, docPool([]))).toEqual([]);
  });
});

describe("referenceVisibleOptions · 过滤（大小写、中文、上限）", () => {
  const docs = [
    doc({ relPath: "a.md", title: "开篇" }),
    doc({ relPath: "b.md", title: "第二章 冲突" }),
    doc({ relPath: "c.md", title: "人物卡" })
  ];

  it("中文标题按包含过滤：query 开 只剩《开篇》", () => {
    const list = referenceVisibleOptions(findReferenceMatch("@开", 2)!, docPool(docs));
    expect(list.map((option) => option.label)).toEqual(["开篇"]);
  });

  it("拉丁标题大小写不敏感（zh-CN 口径对齐 deepwrite）", () => {
    const pool = docPool([doc({ title: "Chapter One" })]);
    expect(referenceVisibleOptions(findReferenceMatch("@chapter", 8)!, pool)).toHaveLength(1);
    expect(referenceVisibleOptions(findReferenceMatch("@CHAPTER", 8)!, pool)).toHaveLength(1);
  });

  it("detail 也参与过滤：kind 的中文名搜得到", () => {
    const pool = docPool([doc({ kind: "outline", title: "三幕" })]);
    const list = referenceVisibleOptions(findReferenceMatch("@大纲", 3)!, pool);
    expect(list.map((option) => option.label)).toEqual(["三幕"]);
  });

  it("条数上限 REFERENCE_OPTION_LIMIT（deepwrite 的 slice(0,12)）", () => {
    const many = Array.from({ length: REFERENCE_OPTION_LIMIT + 5 }, (_, index) =>
      doc({ relPath: `m${index}.md`, title: `素材${index}` })
    );
    const list = referenceVisibleOptions(findReferenceMatch("@素", 2)!, docPool(many));
    expect(list).toHaveLength(REFERENCE_OPTION_LIMIT);
  });

  it("过滤后空列表 ≠ 空池：两种空态文案不同，无文档那句逐字照 brief", () => {
    const match = findReferenceMatch("@zzz", 4);
    expect(referenceVisibleOptions(match!, docPool(docs))).toHaveLength(0);
    expect(referenceEmptyText(match!, docs.length)).toBe(REFERENCE_MENU_COPY["@"].queryEmpty);
    expect(referenceEmptyText(match!, 0)).toBe(REFERENCE_MENU_COPY["@"].poolEmpty);
    expect(REFERENCE_MENU_COPY["@"].poolEmpty).toBe("这本书里还没有可引用的文档，先在左栏建一篇");
  });
});

describe("moveReferenceIndex / clampReferenceIndex · 上下键环绕", () => {
  it("向下越界回到 0，向上越界回到末位（deepwrite 的取模写法）", () => {
    expect(moveReferenceIndex(2, 1, 3)).toBe(0);
    expect(moveReferenceIndex(0, -1, 3)).toBe(2);
    expect(moveReferenceIndex(1, 1, 3)).toBe(2);
  });

  it("空列表 ⇒ 恒 0，不出现 -1（反向用例）", () => {
    expect(moveReferenceIndex(0, 1, 0)).toBe(0);
    expect(moveReferenceIndex(4, -1, 0)).toBe(0);
    expect(clampReferenceIndex(9, 0)).toBe(0);
  });

  it("过滤后列表变短：高亮收回最后一行，不指着不存在的那条", () => {
    expect(clampReferenceIndex(9, 4)).toBe(3);
    expect(clampReferenceIndex(2, 4)).toBe(2);
  });
});

describe("resolveReferenceSelection · Enter 插入而不是发送", () => {
  it("`@` 选中 ⇒ kind insert，插入的是可读引用文本 @素材：标题（relPath）", () => {
    const value = "第二段 @开";
    const match = findReferenceMatch(value, value.length)!;
    const option = referenceOptionPool(match, docPool([doc({ title: "开篇" })]))[0]!;
    const result = resolveReferenceSelection(value, match, option);
    expect(result.kind).toBe("insert");
    if (result.kind !== "insert") return;
    expect(result.text).toBe("@素材：开篇（chapters/ch01.md）");
    expect(result.value).toBe(`第二段 ${result.text} `);
    expect(result.caret).toBe(result.value.length);
  });

  it("引用文本的构造口径：@ 前缀 + 全角括号里的 relPath，正文仍是一条 userText", () => {
    const text = materialReferenceText(doc({ relPath: "x/y.md", title: "人物" }));
    expect(text.startsWith("@素材：")).toBe(true);
    expect(text).toBe("@素材：人物（x/y.md）");
  });

  it("光标后紧跟标点或空白时不再补空格（deepwrite 的 needsTrailingSpace 正则）", () => {
    const value = "@开。后面";
    const match = findReferenceMatch(value, 2)!;
    const option = referenceOptionPool(match, docPool([doc({ title: "开篇" })]))[0]!;
    const result = resolveReferenceSelection(value, match, option);
    if (result.kind !== "insert") throw new Error("@ 必须走 insert");
    expect(result.value).toBe(`${result.text}。后面`);
    expect(result.caret).toBe(result.text.length);
  });

  it("插入只吃掉 token，token 前后的原话一个字都不丢", () => {
    const value = "先改开头 @开 再收尾";
    const match = findReferenceMatch(value, 7)!;
    const option = referenceOptionPool(match, docPool([doc({ title: "开篇" })]))[0]!;
    const result = resolveReferenceSelection(value, match, option);
    if (result.kind !== "insert") throw new Error("@ 必须走 insert");
    expect(result.value.startsWith("先改开头 ")).toBe(true);
    expect(result.value.endsWith(" 再收尾")).toBe(true);
  });

  it("`/` 选中 ⇒ kind execute 带上命令名，并把 /token 从草稿里消费掉", () => {
    const value = "先看 /mod";
    const match = findReferenceMatch(value, value.length)!;
    const option = referenceOptionPool(match, commandPool(["model"]))[0]!;
    const result = resolveReferenceSelection(value, match, option);
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.command).toBe("model");
    expect(result.value).toBe("先看 ");
    expect(result.caret).toBe(3);
  });

  it("结果联合只有 insert / execute 两型：这里根本没有「发送」那条路（裁定 D2 的反向证据）", () => {
    const kinds: string[] = [];
    const slash = findReferenceMatch("/", 1)!;
    const slashOption = referenceOptionPool(slash, commandPool(["model"]))[0]!;
    kinds.push(resolveReferenceSelection("/", slash, slashOption).kind);
    const mention = findReferenceMatch("@", 1)!;
    const mentionOption = referenceOptionPool(mention, docPool([doc()]))[0]!;
    kinds.push(resolveReferenceSelection("@", mention, mentionOption).kind);
    expect(kinds.sort()).toEqual(["execute", "insert"]);
  });
});

describe("REFERENCE_MENU_COPY · 标题/提示/空态/图标只有一份（铁律 6 穷尽表）", () => {
  it("每个触发符都有标题、提示与两档空态，缺一个键就编译不过", () => {
    expect(Object.keys(REFERENCE_MENU_COPY).sort()).toEqual([...REFERENCE_TRIGGERS].sort());
    for (const trigger of REFERENCE_TRIGGERS) {
      const copy = REFERENCE_MENU_COPY[trigger];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.hint.length).toBeGreaterThan(0);
      expect(copy.poolEmpty.length).toBeGreaterThan(0);
      expect(copy.queryEmpty.length).toBeGreaterThan(0);
      expect(copy.icon).not.toBe("");
    }
    expect(REFERENCE_MENU_COPY["/"].title).toBe("调用命令");
    expect(REFERENCE_MENU_COPY["@"].title).toBe("引用素材");
  });

  it("菜单图标取自本仓已有的图标表（deepwrite 用 sparkles / archive），判定不进模板", () => {
    expect(REFERENCE_MENU_COPY["/"].icon).toBe("sparkles");
    expect(REFERENCE_MENU_COPY["@"].icon).toBe("archive");
  });
});

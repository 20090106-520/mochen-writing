import { describe, expect, it } from "vitest";
import { findProfile, type BibleEntry } from "@mochen/contracts";
import {
  BIBLE_TOTAL_CHARS,
  PINNED_SKILL_CHARS,
  PRIOR_CHAPTER_TAIL_CHARS,
  assembleContext,
  estimateTokens,
  renderContextBlock
} from "../src/context.js";

const DOCS = [
  { relPath: "chapters/01-开篇.md", kind: "chapter", title: "开篇", opening: "第一章正文。" },
  { relPath: "chapters/02-暗流.md", kind: "chapter", title: "暗流", opening: "第二章正文。" },
  {
    relPath: "chapters/03-深渊之下.md",
    kind: "chapter",
    title: "深渊之下",
    opening: "第三章正文。"
  },
  { relPath: "chapters/04-回声.md", kind: "chapter", title: "回声", opening: "第四章正文。" },
  { relPath: "outline/全书.md", kind: "outline", title: "全书大纲" },
  { relPath: "characters/李深.md", kind: "character", title: "李深" },
  { relPath: "characters/周砚.md", kind: "character", title: "周砚" },
  { relPath: "materials/禁忌.md", kind: "material", title: "禁忌" },
  { relPath: "worldview/地理.md", kind: "worldview", title: "地理" }
];

const CONTENTS: Record<string, string> = {
  "chapters/01-开篇.md": "第一章正文。",
  "chapters/02-暗流.md": "第二章正文。",
  "chapters/03-深渊之下.md": "---\ntitle: 深渊之下\n---\n第三章正文。",
  "chapters/04-回声.md": "第四章正文。",
  "outline/全书.md": "三卷。",
  "characters/李深.md": "李深：主角。",
  "characters/周砚.md": "周砚：对手。",
  "materials/禁忌.md": "不可言说之物。",
  "worldview/地理.md": "九座城。"
};

const base = {
  // 「没开章」是合法输入（AssembleContextInput 收 string | null）——
  // 夹具类型放宽成联合，出场过滤那条用例才能传 null 进来。
  activeDocRelPath: "chapters/03-深渊之下.md" as string | null,
  docs: DOCS,
  contents: CONTENTS,
  pinned: [] as string[],
  // 书外的挂入物（技能）：默认空，但类型必须在 base 里声明，否则下面那些用例传进来的
  // pinnedExtra 会被 Partial<typeof base> 判成「不认识的字段」——vitest 不做类型检查，
  // 只有 tsc 那一关抓得到。
  pinnedExtra: [] as { relPath: string; title: string; text: string }[],
  // 故事圣经（W-01）同理：类型先声明，哪怕默认值就是空表。
  bible: [] as BibleEntry[],
  bibleCorpus: "",
  chapterOrder: [
    "chapters/01-开篇.md",
    "chapters/02-暗流.md",
    "chapters/03-深渊之下.md",
    "chapters/04-回声.md"
  ]
};

function assemble(profileId: string, extra: Partial<typeof base> = {}) {
  return assembleContext({ ...base, ...extra, profile: findProfile(profileId)! });
}

const paths = (items: { relPath: string }[]): string[] => items.map((i) => i.relPath);

describe("estimateTokens · 占用条上那个数字的唯一算法", () => {
  it("空串是 0，不是 0.4 这种被向上取整出来的假数", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("中文一字一 token", () => {
    expect(estimateTokens("深渊之下")).toBe(4);
  });

  it("英文四字符一 token（有零头就向上取整）", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("中英混排按各自口径累加", () => {
    expect(estimateTokens("中文abcd")).toBe(2 + 1);
  });
});

describe("assembleContext · 装什么由 profile.context 决定", () => {
  it("审稿要全章：当前章带完整正文，且不截断", () => {
    const long = "长".repeat(5000);
    const result = assemble("reviewer", {
      contents: { ...CONTENTS, "chapters/03-深渊之下.md": long }
    });
    const active = result.items.find((i) => i.active)!;
    expect(active.text).toBe(long);
    expect(active.chars).toBe(5000);
  });

  it("主笔的当前章是 excerpt：超长正文会被截断（续写接不上口吻是它的病根）", () => {
    const long = "长".repeat(5000);
    const lead = assemble("lead-writer", {
      contents: { ...CONTENTS, "chapters/03-深渊之下.md": long }
    }).items.find((i) => i.active)!;
    expect(lead.chars).toBeLessThan(long.length);
    expect(lead.chars).toBeLessThanOrEqual(4001);

    const continuer = assemble("continuer", {
      contents: { ...CONTENTS, "chapters/03-深渊之下.md": long }
    }).items.find((i) => i.active)!;
    expect(continuer.chars).toBe(long.length);
  });

  it("世界档案不装配整章正文（构思阶段不该被已有正文牵着走）", () => {
    expect(paths(assemble("world").items)).not.toContain("chapters/03-深渊之下.md");
  });

  it("世界档案要素材与设定，但不要人物卡", () => {
    const p = paths(assemble("world").items);
    expect(p).toContain("materials/禁忌.md");
    expect(p).toContain("worldview/地理.md");
    expect(p).not.toContain("characters/李深.md");
  });

  it("前情提要取本章之前的两章：前两章在，后面的章绝不提前剧透", () => {
    const p = paths(assemble("lead-writer").items);
    expect(p).toContain("chapters/01-开篇.md");
    expect(p).toContain("chapters/02-暗流.md");
    // 本章只以「当前章」这一档出现一次（scope ①），前情那一档不重复装它
    expect(p.filter((x) => x === "chapters/03-深渊之下.md")).toHaveLength(1);
    // 尚未写到的下一章不该进上下文
    expect(p).not.toContain("chapters/04-回声.md");
  });

  it("前情提要只取尾部 PRIOR_CHAPTER_TAIL_CHARS 字", () => {
    const long = "前".repeat(1000);
    const result = assemble("lead-writer", {
      contents: { ...CONTENTS, "chapters/02-暗流.md": long }
    });
    const prior = result.items.find((i) => i.relPath === "chapters/02-暗流.md")!;
    expect(prior.chars).toBeLessThanOrEqual(PRIOR_CHAPTER_TAIL_CHARS + 1);
  });

  it("第一章没有前情可取：只装当前章，后面的章一律不进", () => {
    const result = assemble("lead-writer", { activeDocRelPath: "chapters/01-开篇.md" });
    const p = paths(result.items);
    expect(p).toContain("chapters/01-开篇.md");
    expect(p).not.toContain("chapters/02-暗流.md");
    expect(p).not.toContain("chapters/04-回声.md");
    expect(
      result.items.every((i) => i.text !== ""),
      "不该有空壳条目"
    ).toBe(true);
  });

  it("总编要全书章节摘要（看节奏），但不要前情那一档", () => {
    const result = assemble("chief-editor");
    const chapters = result.items.filter((i) => i.kind === "chapter");
    expect(chapters.length).toBeGreaterThan(1);
    expect(paths(chapters)).toContain("chapters/01-开篇.md");
  });

  it("显式挂入的条目一定要装，且不受 scope 限制", () => {
    const result = assemble("world", { pinned: ["characters/周砚.md"] });
    expect(paths(result.items)).toContain("characters/周砚.md");
  });

  it("挂入一条装不出来的路径（contents 里没有正文）⇒ 静默跳过，不塞空壳", () => {
    const result = assemble("world", { pinned: ["materials/不存在.md"] });
    expect(result.items.some((i) => i.text === "")).toBe(false);
  });

  it("同一条不会被装两次（当前章既在 scope 里又被显式挂入）", () => {
    const result = assemble("lead-writer", { pinned: ["chapters/03-深渊之下.md"] });
    expect(paths(result.items).filter((p) => p === "chapters/03-深渊之下.md")).toHaveLength(1);
  });

  describe("挂入技能（spec §11：书外的挂入物）", () => {
    const SKILLS = [
      { relPath: "book:伏笔", title: "伏笔", text: "先埋线，三百字后收。" },
      { relPath: "global:节奏", title: "节奏", text: "一章一节拍。" }
    ];

    it("技能不在书内文稿树上，但挂了就一定装，且不受 scope 限制（单独成「技能」一类）", () => {
      // world 档案的 scope 里一条技能也没有，照装不误
      const result = assemble("world", { pinned: ["book:伏笔"], pinnedExtra: SKILLS });
      const hit = result.items.find((i) => i.relPath === "book:伏笔");
      expect(hit?.kind).toBe("skill");
      expect(hit?.text).toBe("先埋线，三百字后收。");
    });

    // 【这两条是 2026-10-07 真机撞出来的】技能原先走的是 clip(text, 800)，
    // 那是**书内文稿摘录**的额度。市场首批技能正文 981 字，第一条就超了，
    // 于是用户装上技能、方法却在结尾被砍掉，占用条还安静地报 801。
    it("技能不按书内摘录那 800 字截断：超过 800 的方法必须整份送到模型面前", () => {
      const long = "问".repeat(1200);
      const result = assemble("world", {
        pinned: ["book:长技能"],
        pinnedExtra: [{ relPath: "book:长技能", title: "长技能", text: long }]
      });
      const hit = result.items.find((i) => i.relPath === "book:长技能");
      expect(hit?.text).toBe(long);
      expect(hit?.text).not.toContain("…");
      expect(hit?.chars).toBe(1200);
    });

    it("真到额度上限才截断，且截了就说清楚（省略号在，尾部在）", () => {
      const huge = "问".repeat(PINNED_SKILL_CHARS + 500);
      const result = assemble("world", {
        pinned: ["book:巨技能"],
        pinnedExtra: [{ relPath: "book:巨技能", title: "巨技能", text: huge }]
      });
      const hit = result.items.find((i) => i.relPath === "book:巨技能");
      expect(hit?.text.endsWith("…")).toBe(true);
      expect(hit?.chars).toBe(PINNED_SKILL_CHARS + 1);
    });

    it("技能的 frontmatter 不混进给模型看的正文（与书内文稿同一套口径）", () => {
      // 技能文件与文稿一样是 SKILL.md，开头就有 name:/description:/stage:。
      // 原来这里用的是 extra.text 原样，元数据整块跟着方法一起发给了模型。
      const raw =
        "---\nname: 落笔前先问清楚\nstage:\n  - 构思\n---\n\n# 落笔前先问清楚\n\n一次只问一个。";
      const result = assemble("world", {
        pinned: ["book:有元数据"],
        pinnedExtra: [{ relPath: "book:有元数据", title: "有元数据", text: raw }]
      });
      const hit = result.items.find((i) => i.relPath === "book:有元数据");
      expect(hit?.text).toBe("# 落笔前先问清楚\n\n一次只问一个。");
      expect(hit?.text).not.toContain("stage:");
      expect(hit?.chars).toBe(
        raw.length - "---\nname: 落笔前先问清楚\nstage:\n  - 构思\n---\n\n".length
      );
    });

    it("书内与书外走同一遍：pinnedExtra 里没有的 relPath 不装（不留空壳）", () => {
      const result = assemble("world", { pinned: ["book:没给的"], pinnedExtra: SKILLS });
      expect(paths(result.items)).not.toContain("book:没给的");
      expect(result.items.some((i) => i.text === "")).toBe(false);
    });

    it("技能那条永远不是「本章」：active 只跟着当前文稿走", () => {
      const result = assemble("lead-writer", { pinned: ["book:伏笔"], pinnedExtra: SKILLS });
      expect(result.items.find((i) => i.relPath === "book:伏笔")?.active).toBe(false);
    });

    it("两枚技能都挂 ⇒ 两条都在，字数与 token 估算把它们算进去", () => {
      const bare = assemble("world", { pinned: [], pinnedExtra: [] });
      const withTwo = assemble("world", {
        pinned: ["book:伏笔", "global:节奏"],
        pinnedExtra: SKILLS
      });
      expect(
        paths(withTwo.items).filter((p) => p.startsWith("book:") || p.startsWith("global:"))
      ).toHaveLength(2);
      expect(withTwo.chars).toBeGreaterThan(bare.chars);
      expect(withTwo.approxTokens).toBeGreaterThan(bare.approxTokens);
    });

    it("给模型看的提示词块里，技能单独标「技能」而不是混进「挂入」", () => {
      const block = renderContextBlock(
        assemble("world", { pinned: ["book:伏笔"], pinnedExtra: SKILLS })
      );
      expect(block).toContain("【技能·伏笔】");
      expect(block).toContain("先埋线，三百字后收。");
    });
  });

  it("frontmatter 不混进给模型看的正文（否则字里行间都是 title:）", () => {
    const active = assemble("lead-writer").items.find((i) => i.active)!;
    expect(active.text).toBe("第三章正文。");
    expect(active.text).not.toContain("title:");
  });

  it("无书 / 无当前章时装出空包，不抛错", () => {
    const result = assembleContext({
      profile: findProfile("lead-writer")!,
      activeDocRelPath: null,
      docs: [],
      contents: {}
    });
    expect(result.items).toHaveLength(0);
    expect(result.chars).toBe(0);
    expect(result.approxTokens).toBe(0);
  });

  it("装出来的东西，chars 与 approxTokens 必须自洽（占用条不能自己跟自己打架）", () => {
    const result = assemble("lead-writer");
    expect(result.chars).toBe(result.items.reduce((s, i) => s + i.chars, 0));
    expect(result.approxTokens).toBe(estimateTokens(result.items.map((i) => i.text).join("\n")));
  });
});

describe("故事圣经进入上下文（2026-11-08 W-01）", () => {
  const makeEntry = (
    over: Partial<BibleEntry> & Pick<BibleEntry, "id" | "type" | "title">
  ): BibleEntry => ({
    content: "",
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    ...over
  });

  it("正常注入：相关人物带身份/别名/正文，kind 归在「设定」这一族", () => {
    const 林夜 = makeEntry({
      id: "c1",
      type: "character",
      title: "林夜",
      role: "主角",
      aliases: ["夜哥"],
      content: "码头守夜人，左手有旧伤。",
      tags: ["主线"]
    });
    const result = assemble("lead-writer", {
      bible: [林夜],
      // 正文里只出现别名——别名命中同样算「本章相关」
      bibleCorpus: "夜哥把灯挑亮。"
    });
    const item = result.items.find((one) => one.relPath === "bible:character:c1");
    expect(item).toBeDefined();
    expect(item?.kind).toBe("world");
    expect(item?.title).toBe("林夜");
    expect(item?.text).toContain("人物：林夜");
    expect(item?.text).toContain("身份：主角");
    expect(item?.text).toContain("别名：夜哥");
    expect(item?.text).toContain("设定：码头守夜人，左手有旧伤。");
    // 一条就装下了，不该报「未完整」
    expect(result.bibleOmitted).toBeUndefined();
  });

  it("按相关性筛选：本章提到的优先占额度，没提到的低重要性被舍弃", () => {
    // 每条正文不同：同文会被去重（见下面两条用例），这里要测的是「相关性」不是「去重」
    const long = (title: string) => `${title}的设定：${"设".repeat(700)}`;
    const matched = [
      makeEntry({ id: "c1", type: "character", title: "林夜", content: long("林夜") }),
      makeEntry({ id: "l1", type: "location", title: "码头", content: long("码头") }),
      makeEntry({ id: "c2", type: "character", title: "苏晚", content: long("苏晚") })
    ];
    const unused = makeEntry({
      id: "c3",
      type: "character",
      title: "沈砚",
      content: `沈砚的设定：${"冷".repeat(300)}`
    });
    const result = assemble("lead-writer", {
      bible: [...matched, unused],
      bibleCorpus: "林夜在码头遇见苏晚。"
    });
    const biblePaths = paths(result.items).filter((p) => p.startsWith("bible:"));
    expect(biblePaths).toContain("bible:character:c1");
    expect(biblePaths).toContain("bible:location:l1");
    expect(biblePaths).toContain("bible:character:c2");
    // 额度被「本章真要用的」占满，没提到的低重要性条目被舍弃
    expect(biblePaths).not.toContain("bible:character:c3");
    expect(result.bibleOmitted).toBe(1);
  });

  it("超预算舍弃：装不下的整条跳过，不半句截断，并留下「未完整」提示", () => {
    const entries = ["甲", "乙", "丙", "丁", "戊"].map((title, index) =>
      makeEntry({
        id: `c${index}`,
        type: "character",
        title,
        content: `${title}的设定：${"设".repeat(700)}`
      })
    );
    const result = assemble("lead-writer", {
      bible: entries,
      bibleCorpus: "甲、乙、丙、丁、戊都在。"
    });
    const bibleItems = result.items.filter((item) => item.relPath.startsWith("bible:"));
    expect(bibleItems.length).toBe(3);
    expect(bibleItems.every((item) => !item.text.endsWith("…"))).toBe(true);
    expect(bibleItems.reduce((sum, item) => sum + item.chars, 0)).toBeLessThanOrEqual(
      BIBLE_TOTAL_CHARS
    );
    expect(result.bibleOmitted).toBe(2);
    const block = renderContextBlock(result);
    expect(block).toContain("【设定库·未完整】");
    expect(block).toContain("另有 2 条设定");
  });

  it("与已引用文稿去重：同名人物卡已经装进来，设定不重复说第二遍", () => {
    const result = assemble("lead-writer", {
      contents: {
        ...CONTENTS,
        "chapters/03-深渊之下.md": "李深把刀放下了。第三章正文。"
      },
      bible: [
        makeEntry({
          id: "c-dup",
          type: "character",
          title: "李深",
          content: "另一段足够长的设定，不该在人物卡之外再讲一次。"
        })
      ],
      bibleCorpus: "李深把刀放下了。"
    });
    // 人物卡在，设定这一条被去重掉；去重不是「没带全」，不该报未完整
    expect(paths(result.items)).toContain("characters/李深.md");
    expect(paths(result.items)).not.toContain("bible:character:c-dup");
    expect(result.bibleOmitted).toBeUndefined();
  });

  it("与已引用文稿去重：设定正文与本章正文同文时不再注入", () => {
    const same = "李深是闸口的守夜人，左手有一道旧伤，夜里从不点灯，只靠一盏旧煤油灯认路。";
    const result = assemble("lead-writer", {
      contents: { ...CONTENTS, "chapters/03-深渊之下.md": same },
      bible: [makeEntry({ id: "t1", type: "timeline", title: "旧事", content: same })],
      bibleCorpus: same
    });
    expect(paths(result.items)).not.toContain("bible:timeline:t1");
    expect(result.bibleOmitted).toBeUndefined();
  });
});

describe("renderContextBlock · 空包不许产出空标题块", () => {
  it("没有条目时返回空串（调用方据此不注入）", () => {
    const empty = assembleContext({
      profile: findProfile("lead-writer")!,
      activeDocRelPath: null,
      docs: [],
      contents: {}
    });
    expect(renderContextBlock(empty)).toBe("");
  });

  it("当前章在块里被标成「本章」，让人和模型都知道正在写哪一章", () => {
    const block = renderContextBlock(assemble("lead-writer"));
    expect(block).toContain("正文（本章）·深渊之下");
  });
});

describe("出场人物卡按真出场过滤（2026-10-10 三段：给 AI 的上下文要聚焦）", () => {
  it("当前章只提到李深 ⇒ 只装李深的卡；没提到的周砚不占上下文", () => {
    const result = assemble("lead-writer", {
      contents: { ...CONTENTS, "chapters/03-深渊之下.md": "李深把刀放下了。第三章正文。" }
    });
    const cast = paths(result.items).filter((p) => p.startsWith("characters/"));
    expect(cast).toEqual(["characters/李深.md"]);
  });

  it("没开章时退回全装：补人物设定、全书审读仍要看全家福", () => {
    const result = assemble("lead-writer", { activeDocRelPath: null });
    const cast = paths(result.items).filter((p) => p.startsWith("characters/"));
    expect(cast).toEqual(["characters/李深.md", "characters/周砚.md"]);
  });

  it("挂入的人物卡不受出场过滤影响（用户显式点名的东西照装）", () => {
    const result = assemble("world", { pinned: ["characters/周砚.md"] });
    expect(paths(result.items)).toContain("characters/周砚.md");
  });

  it("只叫别名也算出场：这一章通篇「老李」，李深的卡照样装（2026-10-22）", () => {
    const result = assemble("lead-writer", {
      contents: {
        ...CONTENTS,
        "chapters/03-深渊之下.md": "老李把闸拉下来。第三章正文。",
        "characters/李深.md": "---\ntitle: 李深\naliases: [老李, 深爷]\n---\n李深：主角。"
      }
    });
    const cast = paths(result.items).filter((p) => p.startsWith("characters/"));
    expect(cast).toEqual(["characters/李深.md"]);
  });

  it("角色约束随卡交给提示词装配：voice 与 exit 原样带着（卡正文里已经剥掉了）", () => {
    const result = assemble("lead-writer", {
      contents: {
        ...CONTENTS,
        "chapters/03-深渊之下.md": "李深站着。第三章正文。",
        "characters/李深.md":
          "---\ntitle: 李深\nvoice: [少废话, 闸上不许跑]\nexit: chapters/04-回声.md\n---\n李深：主角。"
      }
    });
    expect(result.characterNotes).toEqual([
      { title: "李深", voice: ["少废话", "闸上不许跑"], exit: "chapters/04-回声.md" }
    ]);
    expect(result.items.find((one) => one.relPath === "characters/李深.md")?.text).not.toContain(
      "少废话"
    );
  });

  it("没声明 voice / exit 的卡不占 characterNotes（空表不注入空段）", () => {
    expect(assemble("lead-writer").characterNotes).toEqual([]);
  });
});

describe("各章开头句 openings（2026-10-10 四段 / 2026-10-15 改源：从 DocRef.opening 取）", () => {
  it("按章节顺序取每个 chapter 的 opening，截到 24 字；非 chapter 不进清单", () => {
    const result = assemble("lead-writer", {
      docs: [
        ...DOCS,
        {
          relPath: "chapters/05-夜潮.md",
          kind: "chapter",
          title: "夜潮",
          opening: "夜色像墨一样漫开，压住了整座港城的第一盏灯。"
        },
        { relPath: "chapters/06-骤雨.md", kind: "chapter", title: "骤雨", opening: "雨下个不停。" }
      ],
      chapterOrder: [
        "chapters/01-开篇.md",
        "chapters/02-暗流.md",
        "chapters/03-深渊之下.md",
        "chapters/04-回声.md",
        "chapters/05-夜潮.md",
        "chapters/06-骤雨.md"
      ]
    });
    expect(result.openings).toEqual([
      "第一章正文。",
      "第二章正文。",
      "第三章正文。",
      "第四章正文。",
      "夜色像墨一样漫开，压住了整座港城的第一盏灯。", // 22 字没到 24 截断线，句号在
      "雨下个不停。"
    ]);
  });

  it("opening 为空串的章不进清单；contents 缺了也不影响 openings（不再依赖全文）", () => {
    const docs04Empty = DOCS.map((d) =>
      d.relPath === "chapters/04-回声.md" ? { ...d, opening: "" } : d
    );
    const result = assemble("lead-writer", {
      docs: docs04Empty,
      contents: {} // 故意空：证明 openings 不再从 contents 取
    });
    expect(result.openings).toEqual(["第一章正文。", "第二章正文。", "第三章正文。"]);
  });

  it("预算读的不变量：删掉非预算章的 contents 不影响 items/chars/openings", () => {
    // lead-writer（active=03, priorChapters=2, chapterDigests=false）的预算章：
    // 03(当前) + 01,02(前2章) + outline + characters + materials。
    // 04 是非预算章（不是前2章、chapterDigests=false 不装全书摘要）——删它的 contents 不该影响装配。
    const full = assemble("lead-writer");
    const prunedContents = Object.fromEntries(
      Object.entries(CONTENTS).filter(([k]) => k !== "chapters/04-回声.md")
    );
    const pruned = assemble("lead-writer", { contents: prunedContents });
    expect(pruned.items).toEqual(full.items);
    expect(pruned.chars).toBe(full.chars);
    // openings 仍含 04（从 docs.opening 取，不靠 contents）——这条同时验证 openings 改源
    expect(pruned.openings).toEqual(full.openings);
    expect(pruned.openings).toContain("第四章正文。");
  });
});

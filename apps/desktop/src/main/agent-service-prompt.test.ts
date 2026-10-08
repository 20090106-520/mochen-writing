import { describe, expect, it } from "vitest";
import { defaultProfile, findProfile, type DocRef } from "@mochen/contracts";
import { renderContextBlock } from "@mochen/agent-runtime";
import {
  defaultPromptFor,
  PLAN_MODE_INSTRUCTION,
  WEB_SEARCH_INSTRUCTION
} from "./prompt-assembly.js";

/**
 * 系统提示词的**组装**这一层：它们全是纯函数，不起盘、不连 provider、不碰 IPC。
 * 与 agent-service.test.ts 分家是按「跑不跑得起来」分的——那边每条用例都真开一轮，
 * 把这些塞进去只会让 800 行预算先炸，也没人能从用例名看出提示词是怎么拼的。
 */
const CHAPTER: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };
const NO_CONTEXT = { items: [], chars: 0, approxTokens: 0 };

describe("defaultPromptFor · 拼装", () => {
  it("作品名、阶段名、当前文稿与权限档都进系统提示", () => {
    const text = defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: true
    });
    expect(text).toContain("《深渊之下》");
    expect(text).toContain("正文");
    expect(text).toContain("全开");
    expect(text).toContain("propose_patch");
  });

  it("直写目录制：写入靠 write_doc + web_search 联网，批准闸门那句话一字不改", () => {
    const text = defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: true
    });
    // 提示词已改为直写目录制：12 类目录清单 + write_doc 直写 + web_search 联网，不再有 mochen-patch 代码块。
    expect(text).toContain("提案只有在用户批准后才写入磁盘");
    expect(text).toContain("write_doc 写进对应目录");
    expect(text).toContain("web_search");
  });

  it("没打开文稿 ⇒ 如实说没打开，不编一个当前文稿出来", () => {
    expect(
      defaultPromptFor({
        title: "x",
        stageName: "构思",
        chapter: null,
        permissionLabel: "只读参考",
        workModeLabel: "直接动手",
        profile: defaultProfile(),
        context: NO_CONTEXT,
        webSearchEnabled: true
      })
    ).toContain("还没打开文稿");
  });
});

describe("defaultPromptFor · 先计划后动手（2026-10-05 批次 4）", () => {
  const build = (workModeLabel: string) =>
    defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel,
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: true
    });

  it("计划档 ⇒ 多一段「别动稿、只讲打算」", () => {
    expect(build("先计划")).toContain(PLAN_MODE_INSTRUCTION);
  });

  // 这段话是说给**模型**看的：模型看不到 writeVerdict 那个闸。不先告诉它，
  // 它会照常起草再吃一个拒，然后换个写法重试几轮——白烧 token 还把对话搅浑。
  it("计划档那段必须落在「可批准的东西」上：改哪几篇、改什么、为什么", () => {
    const t = build("先计划");
    expect(t).toContain("要改哪几篇");
    expect(t).toContain("为什么");
    expect(t).toContain("等用户批准");
  });

  it("动手档 ⇒ 一句都不加（摆一句「你可以直接写」反而像在鼓励它动手）", () => {
    expect(build("直接动手")).not.toContain(PLAN_MODE_INSTRUCTION);
    expect(build("直接动手")).not.toContain("先计划");
  });
});

describe("defaultPromptFor · 六档案", () => {
  it("档案提示词原文一字不差地进了系统提示（spec §5.1：换档案换的是人设，不是文案装饰）", () => {
    const reviewer = findProfile("reviewer")!;
    const text = defaultPromptFor({
      title: "x",
      stageName: "修订",
      chapter: null,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: reviewer,
      context: NO_CONTEXT,
      webSearchEnabled: true
    });
    expect(text).toContain(reviewer.prompt);
  });

  it("换档案换的真是那段人设：审稿与主笔的提示词互不相同", () => {
    const build = (id: string) =>
      defaultPromptFor({
        title: "x",
        stageName: "正文",
        chapter: null,
        permissionLabel: "全开",
        workModeLabel: "直接动手",
        profile: findProfile(id)!,
        context: NO_CONTEXT,
        webSearchEnabled: true
      });
    const reviewer = build("reviewer");
    const lead = build("lead-writer");
    expect(lead).not.toBe(reviewer);
    expect(reviewer).toContain(findProfile("reviewer")!.prompt);
    expect(lead).toContain(findProfile("lead-writer")!.prompt);
    expect(lead).not.toContain(findProfile("reviewer")!.prompt);
  });
});

describe("defaultPromptFor · 搜索那条要教模型怎么发 query（2026-10-06 批次 5-⑬）", () => {
  /**
   * 这条守卫守的是一个**会让功能整个废掉**的失效：必应源只认 query 开头的词
   * （实测「怎么写一个让读者害怕的反转」十条全塌成「怎么（汉语词语）」），
   * 所以覆盖率闸门会把它判成没搜着。模型要是继续发整句，闸门就一直响——
   * 搜索名义上接了源，实际一次都搜不成。
   *
   * 四种正则改写都量过了、全废（盲截断到 6 字对「民国军阀混战」有效，
   * 对「科幻小说常见的世界观设定有哪些」就剩半截话）。所以唯一的办法就是提示模型发关键词，
   * 而提示词是可以被无声改掉的——所以钉住。
   */
  const text = defaultPromptFor({
    title: "深渊之下",
    stageName: "正文",
    chapter: CHAPTER,
    permissionLabel: "全开",
    workModeLabel: "直接动手",
    profile: defaultProfile(),
    context: NO_CONTEXT,
    webSearchEnabled: true
  });

  it("明说 query 用 2–4 个关键词，并给一个正例子", () => {
    expect(text).toContain("web_search");
    expect(text).toContain("2–4 个关键词");
    expect(text).toContain("漕运制度");
  });

  it("说明为什么要用关键词——没有理由，模型就会当这句是客套", () => {
    expect(text).toContain("只认开头的词");
  });
});

describe("defaultPromptFor · 联网段跟着开关走（2026-10-08）", () => {
  const build = (webSearchEnabled: boolean) =>
    defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled
    });

  // 反向钉：关掉那一轮出站 tools 里根本没有 web_search（摘它的就是 wireToolsFor 那一处），
  // 提示词再教模型用它，等于让它去调一枚不存在的工具，回执只会是「没有这个工具」。
  it("开 ⇒ 那段联网措辞整段在；关 ⇒ 整段一个字都不留", () => {
    expect(build(true)).toContain(WEB_SEARCH_INSTRUCTION);
    expect(build(false)).not.toContain(WEB_SEARCH_INSTRUCTION);
    expect(build(false)).not.toContain("联网搜索用");
  });

  it("关掉不牵连别的段落：五枚书稿工具的措辞照旧", () => {
    const text = build(false);
    expect(text).toContain("propose_patch");
    expect(text).toContain("write_doc 写进对应目录");
  });
});

describe("renderContextBlock · 上下文块", () => {
  it("空包不产出「已装配的上下文」空标题（那是给模型看的噪声）", () => {
    expect(renderContextBlock(NO_CONTEXT)).toBe("");
  });

  it("有条目才追加上下文块：标题与正文都进得去", () => {
    const block = renderContextBlock({
      items: [
        {
          kind: "chapter",
          relPath: "chapters/01-开局.md",
          title: "开局",
          text: "雾从海面涌上来。",
          chars: 8,
          active: true
        }
      ],
      chars: 8,
      approxTokens: 8
    });
    expect(block).toContain("正文（本章）");
    expect(block).toContain("雾从海面涌上来。");
  });
});

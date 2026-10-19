import { describe, expect, it } from "vitest";
import { AGENT_PROFILES, defaultProfile, findProfile, type DocRef } from "@mochen/contracts";
import { renderContextBlock } from "@mochen/agent-runtime";
import {
  defaultPromptFor,
  PLAN_MODE_INSTRUCTION,
  WEB_SEARCH_INSTRUCTION,
  writeScopeSentence
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

  it("文风硬约束常驻（2026-10-10 去AI味）：点名词表来自 contracts，与体检同源不各抄一份", () => {
    const text = defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: false
    });
    // 联网关掉也不影响文风段：它不是 web_search 的邻居，是常驻的正文纪律。
    expect(text).toContain("文风硬约束");
    expect(text).toContain("嘴角勾起");
    expect(text).toContain("众所周知");
    expect(text).toContain("他知道，……");
    // 副词与句长是另口叮嘱的两条（词表不点名它们，提示词里得有）。
    expect(text).toContain("副词能删就删");
    expect(text).toContain("别让连续几句一样长");
  });

  it("结构级去味常驻（2026-10-16 融合技能库三条去味技能）", () => {
    const text = defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: false
    });
    // 这几条是从技能库「把 AI 腔一条条挑掉」「改 AI 味先判删」「别替读者下结论」里合出来的，
    // 原先是「用户挂入才生效」的技能文本；现在折进常驻约束，正文每一轮都吃到。
    expect(text).toContain("否定排比");
    expect(text).toContain("不是A，是B");
    expect(text).toContain("章末");
    expect(text).toContain("伏笔式预告");
    expect(text).toContain("给普通名词加戏");
    // 2026-10-16 §一百零七：补 deslop 里没折进来的那一条（反差模板）。
    expect(text).toContain("反差模板");
    // 2026-10-16 §一百零八：核对话技能（dialogue-voice）时补的两条未覆盖方法——
    // 「给每人定一句他绝不会说的话」的忌讳法，与「别靠语气词凑区别」这条纠偏。
    expect(text).toContain("他绝不会说");
    expect(text).toContain("语气词");
  });

  it("叙事手法常驻（2026-10-18 补心理/动作/环境/换场/节奏）：用户点名「潦草、跳、没描写」的那五样", () => {
    const text = defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: false
    });
    // ① 心理靠演不靠说（给情绪命名即违规）
    expect(text).toContain("别给情绪命名");
    // ② 动作拆节拍
    expect(text).toContain("拆成 2–4 个");
    // ③ 环境映心情 + 点名禁空泛环境套话（与扫描端新词同批）
    expect(text).toContain("夜色深沉");
    expect(text).toContain("寒风刺骨");
    // ④ 换场要有过渡锚
    expect(text).toContain("过渡锚");
    // ⑤ 快慢要分
    expect(text).toContain("通篇一个速度");
  });

  it("人性化创作常驻（2026-10-18 二段）：片段内容／语言表达／逻辑思维／细节把控四个正向维度", () => {
    const text = defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: false
    });
    // 这一段非加不可的理由：前四段九成是**禁止清单**（别写什么），管得住下限、提不了上限；
    // 而用户点名的四个维度里「片段内容」与「逻辑思维」**一条都没覆盖**——
    // 模型于是在这两处现原形：场次没有事件只有氛围、人物的决定没有来路、事件靠「然后」串。
    expect(text).toContain("人性化创作");
    // ① 逻辑思维：动机要推得出来、上一场的结果要带进下一场
    expect(text).toContain("他此刻想要什么、怕什么");
    expect(text).toContain("上一场的结果");
    // ② 片段内容：动笔前先定这一场的「那件事」，并禁概述式推进
    expect(text).toContain("每场戏都要有事发生");
    expect(text).toContain("概述式推进");
    // ③ 细节把控：与 QUALITY 的「写具体」分工不同——那条管写什么，这条管**留哪些、删哪些**
    expect(text).toContain("细节选得准、留得少");
    // ④ 语言表达（正向）：长短跟着情绪走，且允许毛边（真人写的有平句有笨句）
    expect(text).toContain("句子跟着情绪走");
    expect(text).toContain("毛边");
  });

  it("对话写法常驻（2026-10-19 三段）：四稿实测把人工创作特征从 59% 拉到 100% 的那三条", () => {
    const text = defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: NO_CONTEXT,
      webSearchEnabled: false
    });
    // 同一故事同一场戏连跑四稿，四稿比三稿只多了这三条改动，外部检测器的人工创作特征就从
    // 59.15% 跳到 100%——但此前它们只写在临时改的那版文案里，**一条都没落进仓**，
    // 重开应用用默认文案跑，模型根本看不到。这一段是把它们变成常驻。
    expect(text).toContain("对话写法要求");
    // ① 贴引号的「××说」写死上限（扫描端同一枚数字、退稿闸判退线 = 上限＋1）
    expect(text).toContain("一章最多三处");
    // ② 对话要有闲话与跑题
    expect(text).toContain("闲话");
    // ③ 允许说错／说重／改口
    expect(text).toContain("改口");
    // ④ 段落长度打散、不许每段都收在台词上
    expect(text).toContain("不许每段都收在台词上");
    // 落点在人性化创作那段之后：排在它后面，不抢已有五段的次序。
    expect(text.indexOf("对话写法要求")).toBeGreaterThan(text.indexOf("人性化创作"));
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

/**
 * 写入范围那一句（2026-10-10 从 agent-service.ts 搬来时补的用例——搬之前它一条测试都没有）。
 *
 * 三档措辞对应 `WriteScope` 的三种形状，说错了会直接误导模型：
 * 只读档说成「能改某类」它会去提写入提案，白吃闸；追加档说成「随便改当前章」它会动前文。
 */
describe("writeScopeSentence · 档案能写哪里", () => {
  const of = (id: string) => {
    const profile = AGENT_PROFILES.find((p) => p.id === id);
    if (profile === undefined) throw new Error(`夹具里的档案 id 不对：${id}`);
    return profile;
  };

  it("只读档（审稿）⇒ 明说只出提案、不改文稿", () => {
    expect(writeScopeSentence(of("reviewer"))).toContain("只出批注式提案，不直接改文稿");
  });

  it("当前章档（主笔）⇒ 只限当前章，且不带「文末追加」那句", () => {
    const text = writeScopeSentence(of("lead-writer"));
    expect(text).toContain("改动只限当前章");
    expect(text).not.toContain("追加");
  });

  it("追加档（续写）⇒ 多一句「改前文要单独提案」", () => {
    expect(writeScopeSentence(of("continuer"))).toContain("默认只在文末追加；改前文要单独提案");
  });

  it("指定类型档（角色）⇒ 把 kinds 逐条报出来，不含糊成「可以改设定」", () => {
    expect(writeScopeSentence(of("character"))).toContain("改动只限：character");
  });

  it("句子里带档案名：六个人设各说一句，不许串台", () => {
    for (const id of ["world", "chief-editor", "character", "lead-writer", "continuer"]) {
      expect(writeScopeSentence(of(id))).toContain(of(id).name);
    }
    expect(writeScopeSentence(defaultProfile())).toBe(writeScopeSentence(of("lead-writer")));
  });

  it("findProfile 拿到的同一份档案说的是同一句话（措辞只有一份出处）", () => {
    const byId = findProfile("reviewer");
    if (byId === null) throw new Error("findProfile 认不出内置档案 id");
    expect(writeScopeSentence(byId)).toBe(writeScopeSentence(of("reviewer")));
  });
});

describe("细腻度段 + 本书套话回流（2026-10-10 三段：给 AI 的写作质量）", () => {
  // 上下文参数直接取 defaultPromptFor 的形参类型——测试夹具与真身同形，不另造一份。
  const build = (context: Parameters<typeof defaultPromptFor>[0]["context"]) =>
    defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context,
      webSearchEnabled: false
    });

  it("细腻度五条常驻：五感 / 具体名词 / 对话节拍 / 角色声音 / 续写衔接，各给可执行判据", () => {
    const text = build(NO_CONTEXT);
    expect(text).toContain("细腻度要求");
    expect(text).toContain("非视觉");
    expect(text).toContain("具体名词");
    expect(text).toContain("对话节拍");
    expect(text).toContain("角色声音");
    expect(text).toContain("无缝");
  });

  it("已有两章以上 ⇒ 开头句点名回流，叮嘱换进法；不足两章不注入", () => {
    const mk = (kind: "chapter" | "character", relPath: string, text: string) => ({
      kind,
      relPath,
      title: relPath,
      text,
      chars: text.length,
      active: false
    });
    const withOpenings = {
      items: [
        mk("chapter", "chapters/01.md", "夜色像墨一样漫开。"),
        mk("chapter", "chapters/02.md", "雨下个不停。")
      ],
      chars: 20,
      approxTokens: 20,
      openings: ["夜色像墨一样漫开。", "雨下个不停。"]
    };
    const text = build(withOpenings);
    expect(text).toContain("换一种进法");
    expect(text).toContain("夜色像墨一样漫开");
    // 只有一章：谈不上套路，不注入。
    const one = { ...withOpenings, openings: ["夜色像墨一样漫开。"] };
    expect(build(one)).not.toContain("换一种进法");
    // 没有 openings 字段（老装配结果）也不炸。
    expect(build(NO_CONTEXT)).not.toContain("换一种进法");
  });

  it("上下文里已有高频套话 ⇒ 点名回流（这本书自己的病，不是天下通病）", () => {
    const flavored = {
      items: [
        {
          kind: "chapter" as const,
          relPath: "chapters/01-开局.md",
          title: "开局",
          text: "他嘴角勾起，眼底闪过一丝复杂的情绪。".repeat(6),
          chars: 200,
          active: true
        }
      ],
      chars: 200,
      approxTokens: 200
    };
    const text = build(flavored);
    expect(text).toContain("本书写法提醒");
    expect(text).toContain("嘴角勾起（");
    expect(text).toContain("次）");
  });

  it("上下文没有命中 ⇒ 不注入空段（没病不喂药）", () => {
    expect(build(NO_CONTEXT)).not.toContain("本书写法提醒");
  });
});

describe("本书腔调摘要（2026-10-19 六段 · P0-③ 作者风格档案下沉）", () => {
  const build = (context: Parameters<typeof defaultPromptFor>[0]["context"]) =>
    defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context,
      webSearchEnabled: false
    });
  /**
   * 够量的已完稿正文：每段 28 个非空白字（含一对破折号、一句对白），24 段 = 672 字。
   * 用的是**半角引号外的全角**，与出厂主笔的实际产出无关——这里守的是「量得出来就报」。
   */
  const TALK = "他把碗放下，手在桌沿停了停——她没抬头。「你先回去。」她说。";
  const chapter = (text: string) => ({
    kind: "chapter" as const,
    relPath: "chapters/01.md",
    title: "开局",
    text,
    chars: text.length,
    active: true
  });

  it("已完稿正文够量 ⇒ 四维摘要进提示词（句长／标点脾气／对白占比／段末收法）", () => {
    const text = build({ items: [chapter(TALK.repeat(24))], chars: 672, approxTokens: 672 });
    expect(text).toContain("本书腔调摘要");
    expect(text).toContain("标点脾气");
    expect(text).toContain("对白约占");
    expect(text).toContain("收在台词上");
  });

  it("摘要明说「这只是这本书的习惯」并以硬约束为上限（不给模型免死金牌）", () => {
    const text = build({ items: [chapter(TALK.repeat(24))], chars: 672, approxTokens: 672 });
    // 技能原文的纪律：手册只描述这本书自己的句子，不许变成「优秀小说的写法」。
    expect(text).toContain("不是「优秀小说该有的样子」");
    // 与文风硬约束冲突时硬约束优先——否则模型会拿「本书习惯」当借口去写禁句式。
    expect(text).toContain("硬约束优先");
    // 量不出来的两维如实说不报（叙述距离／冲突戏写情绪还是动作），不硬凑一个数。
    expect(text).toContain("这两样读不出来");
  });

  it("落在对话写法那段之后（同样是「本书现场」类动态段，与另三段并列）", () => {
    const text = build({ items: [chapter(TALK.repeat(24))], chars: 672, approxTokens: 672 });
    expect(text.indexOf("本书腔调摘要")).toBeGreaterThan(text.indexOf("对话写法要求"));
  });

  it("样本不足 ⇒ 不注入（开书之前没有样本可拆）；只有非 chapter 条目 ⇒ 也不注入", () => {
    expect(build(NO_CONTEXT)).not.toContain("本书腔调摘要");
    // 一章才写了两句：样本太少，立不出手册。
    expect(build({ items: [chapter(TALK)], chars: 28, approxTokens: 28 })).not.toContain(
      "本书腔调摘要"
    );
    // 人物卡写得再长也不是这本书的正文腔调——只数 kind === "chapter" 的条目。
    const card = {
      kind: "character" as const,
      relPath: "characters/陈砚.md",
      title: "陈砚",
      text: TALK.repeat(24),
      chars: 672,
      active: false
    };
    expect(build({ items: [card], chars: 672, approxTokens: 672 })).not.toContain("本书腔调摘要");
  });
});

describe("对话占比反馈（2026-10-10 五段：让模型知道本章是话痨还是闷罐）", () => {
  const build = (context: Parameters<typeof defaultPromptFor>[0]["context"]) =>
    defaultPromptFor({
      title: "深渊之下",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context,
      webSearchEnabled: false
    });
  const mk = (text: string) => ({
    kind: "chapter" as const,
    relPath: "chapters/01.md",
    title: "开局",
    text,
    chars: text.length,
    active: true
  });

  it("对话过密（>65%）⇒ 话太密提醒；几乎零对话 ⇒ 全叙述提醒", () => {
    // 每单元：引号内 29 字、引号外 14 字 → 占比约 67%（手算过线，0.65 是真阈值不是摆设）。
    const chatty = mk(
      "「你到底想说什么，直说就行，别兜圈子。」她把杯子推过去。「我说过了，没什么可说的。」他没碰杯子。".repeat(
        20
      )
    );
    expect(build({ items: [chatty], chars: 700, approxTokens: 700 })).toContain("话太密了");
    // 60 字零对话 × 12 = 720 字 → 占比 0 → 全叙述提醒。
    const silent = mk(
      "他推开院门，把锄头靠在墙边，转身去灶间生火，火苗窜起来，锅里的粥咕嘟作响，窗外的雨没有要停的意思。".repeat(
        12
      )
    );
    expect(build({ items: [silent], chars: 720, approxTokens: 720 })).toContain("几乎没有对话");
  });

  it("占比常态（3%~65%）⇒ 不吭声；不足 500 字 ⇒ 不判定", () => {
    // 每单元：引号内 25 字、引号外 45 字 → 占比约 36%，属常态。
    const balanced = mk(
      (
        "「你到底想说什么，直说就行。」她把杯子推过去，杯底磕在桌上，茶水晃出来一圈。" +
        "他没有接话，转身把窗关上，风声小了些，屋里的煤油灯稳住了火苗。"
      ).repeat(12)
    );
    expect(build({ items: [balanced], chars: 800, approxTokens: 800 })).not.toContain(
      "对话占比提醒"
    );
    // 太短不判定：哪怕全是引号。
    const tiny = mk("「行。」「不走？」「走。」");
    expect(build({ items: [tiny], chars: 12, approxTokens: 12 })).not.toContain("对话占比提醒");
  });
});

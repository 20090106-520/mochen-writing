/**
 * 批次 5-㉓ · 极端内容下的四条硬裁定。
 *
 * 这四条都是**真机量出来、放大截图看见**的，同一批读数见 docs/superpowers/plans/README.md
 * 「批次 5-㉓」一节。共同的病根是同一个家族：**容器收缩、装不下的那一格却钉死不缩**
 * ——于是要么省略号永远画不出来（硬切），要么中文按字断行（每字一行）。
 *
 * ① `.editor-breadcrumbs`：三段原本都是 `flex: 0 0 auto`。
 *    `text-overflow` 只裁元素**自己**的行盒内文本，对 flex 子项无效 ⇒ 裁成硬切；
 *    末段虽然单独立了省略号，可 `flex: 0 0 auto` 让它永不收缩，那个省略号一辈子画不出来。
 *    真机 1024 分栏：容器内容盒 130、内容 732（书名 439 + 「章节」37 + 章名 255），
 *    当前章节**整段不可见**。
 * ② `.conversation-header-actions`：与标题区共用一条只写 `min-width: 0` 的规则，
 *    作为 flex 子项默认 `flex: 0 1 auto` ⇒ 会被标题挤扁，中文按字断行。
 *    真机 1440 预览态：动作区 **y=-5 h=59** 而栏头只有 50 高（向上溢出到窗口外），
 *    按钮 w=52 的行宽 [7,12,12,12,12] ⇒ 每字一行。
 * ③ `.composer-context-bar` 的两段副文：`flex: 0 0 auto` / 根本没有规则，
 *    自动最小尺寸就是内容宽度。真机 1024 量到胶囊被分到 47px、副文要 74px ⇒ 溢出画到下一枚上；
 *    计量读数 107px 落进 30px 的胶囊里，在放大图里与末尾图标**叠印**。
 * ④ 读稿四面：textarea 由 Chromium UA 断长词，预览面断不了 ⇒ 两面不是一回事。
 *    真机分栏量到罪魁段 client=192 / scroll=2619（307 字符），被 `overflow-x: hidden` 裁掉。
 *
 * `.vue` 一律零自动化覆盖（铁律）：模板只**读源码钉形状**，样式只**读样式表钉声明**。
 * 反自欺：下面每条断言都真去读那两个文件，不拿自己写死的副本当源；
 * 每处锚点的命中次数也一并钉住，免得「扫不到东西 ⇒ 断言通过」。
 */
import { describe, expect, it } from "vitest";
import { countNeedle, ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

const EDITOR = styleSource("editor-pane.css");
const CONVERSATION = styleSource("conversation-pane.css");
const HISTORY = styleSource("conversation-history.css");
const CARD = styleSource("agent-pane.css");
// 2026-11-20：占用读数那一枚搬去了状态栏，它的规则跟着搬进 context-meter.css。
const METER = styleSource("context-meter.css");

/** 头部动作区（2026-11-20 自 CenterColumn 拆出）——「新建对话」那一枚的文案住在这里。 */
const HEADER_ACTIONS = templateSource("components/CenterHeaderActions.vue");
const HISTORY_MENU = templateSource("components/ConversationHistoryMenu.vue");

/**
 * `@container` / `@media` 块里有嵌套大括号，`ruleBlock` 的 `[^}]*` 读不了整块 ⇒ 按配对的花括号切。
 * 与 composer-toolbar-overflow.test.ts 是同一个问题，但**不复用它的导出**：
 * 那份是这个文件自己的局部工具，跨文件 import 测试工具只会把两条裁定绑成一条。
 */
function blocks(css: string, at: string): string[] {
  const out: string[] = [];
  let i = css.indexOf(at);
  while (i !== -1) {
    const open = css.indexOf("{", i);
    let depth = 0;
    let j = open;
    for (; j < css.length; j += 1) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(css.slice(open + 1, j));
    i = css.indexOf(at, j + 1);
  }
  return out;
}

/**
 * **独立**一条规则（选择器列表里没有别人）的正文。
 *
 * 为什么不用 `ruleBlock`：`ruleBlock` 取第一个匹配，于是 `.conversation-header-actions`
 * 会命中共享的那条 `.conversation-heading-start,\n.conversation-header-actions`，
 * 读回来是共享块的正文——`flex: 0 0 auto` 真真切切写在**下一条**规则里，断言照样红。
 * 这就是「断言读的是不是被测的那一块」的典型：红得对，但红的是错的块。
 *
 * 两边都归一化（拆逗号 → trim → 用 ", " 拼回）再比，是为了让 prettier 把选择器列表
 * 折成几行都不影响命中——5-㉑ 与本文件都踩过这一下。
 * 前奏里的 CSS 块注释要剥掉，否则注释里提一句选择器就会算成一条规则。
 *
 * **正文里的注释同样要剥掉**（5-㉔ 补的）：原来只剥前奏，于是规则正文里那句
 * 「必须配 min-width: 0」就能喂饱 `toContain("min-width: 0")`——
 * 把真正的声明删掉，断言照样全绿（实测：变异 N9 漏网）。
 * 与「断言读的是不是被测的那一块」是同一个病：比中的东西不在被测的位置上。
 */
function standaloneRule(css: string, selector: string): string {
  const norm = (s: string) =>
    s
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .join(", ");
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const want = norm(selector);
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = strip(m[1] ?? "");
    if (norm(prelude) === want) out.push(strip(m[2] ?? "").trim());
  }
  if (out.length !== 1) {
    throw new Error(`${selector} 的独立规则应当恰好一条，实得 ${out.length} 条`);
  }
  return out[0]!;
}

/**
 * 某一档 `@container` 里**包含指定选择器的那一块**。
 *
 * 不能直接 `blocks(css, at)[0]`：`@container composer (max-width: 380px)` 本来就有两块
 * （5-⑱ 工具栏那条 + 5-㉓ 上下文条这条），取第一块会读到别人的正文。
 */
function containerStep(css: string, at: string, selector: string): string {
  const hit = blocks(css, at).filter((b) => b.includes(selector));
  if (hit.length !== 1) {
    throw new Error(`${at} 里应当恰好一块管到 ${selector}，实得 ${hit.length} 块`);
  }
  return hit[0]!;
}

describe("5-㉓ ① 面包屑：省略号必须真画得出来", () => {
  it("三段都不许再钉成 flex: 0 0 auto——那正是省略号永远画不出来的原因", () => {
    const span = ruleBlock(EDITOR, ".editor-breadcrumbs span");
    expect(span).not.toContain("flex: 0 0 auto");
    // 锚点本身要真在文件里（命中 0 次 ⇒ 后面那些断言全是空转）。
    expect(countNeedle(".editor-breadcrumbs span {", EDITOR)).toBe(1);
  });

  it("每一段各自带 min-width: 0 + 省略号：容器的 text-overflow 裁不到 flex 子项身上", () => {
    const span = ruleBlock(EDITOR, ".editor-breadcrumbs span");
    expect(span).toContain("flex: 0 1 auto");
    expect(span).toContain("min-width: 0");
    expect(span).toContain("overflow: hidden");
    expect(span).toContain("text-overflow: ellipsis");
  });

  it("让位的是前两段，不是当前章节：前两段各留 3em 地板，末段吃剩余宽度", () => {
    expect(ruleBlock(EDITOR, ".editor-breadcrumbs span:not(:last-child)")).toContain(
      "min-width: 3em"
    );
    const last = ruleBlock(EDITOR, ".editor-breadcrumbs span:last-child");
    expect(last).toContain("flex: 1 1 auto");
    expect(last).toContain("min-width: 4em");
  });

  it("容器自己吃掉栏头剩余宽度，不许塌成 0（5-⑳ 的注释记过它被压成 0px 那一格）", () => {
    expect(ruleBlock(EDITOR, ".editor-breadcrumbs")).toContain("flex: 1 1 auto");
  });

  it("反自欺：这一格的模板还在渲染分段 span，规则不是挂在没人用的类上", () => {
    const tpl = templateSource("components/DocumentPane.vue");
    expect(countNeedle('class="editor-breadcrumbs"', tpl)).toBe(1);
    // 只看面包屑那一段：DocumentPane 里另有别的 v-for span，数全文件的次数没有鉴别力。
    const block = /<div class="editor-breadcrumbs">[\s\S]*?<\/div>/.exec(tpl)?.[0] ?? "";
    expect(block, "模板里没截到 .editor-breadcrumbs 那一段").not.toBe("");
    expect(countNeedle('<span v-for="(part, index) in breadcrumbs"', block)).toBe(1);
  });
});

describe("5-㉓ ② 会话栏头：控件不缩，文字缩", () => {
  it("动作区钉死不缩——它原先与标题区共用只写 min-width: 0 的那一条", () => {
    expect(standaloneRule(CONVERSATION, ".conversation-header-actions")).toContain(
      "flex: 0 0 auto"
    );
    expect(ruleBlock(HISTORY, ".conversation-history-control")).toContain("flex: 0 0 auto");
  });

  it("中文按钮不许按字断行：white-space: nowrap", () => {
    expect(ruleBlock(CONVERSATION, ".header-text-button")).toContain("white-space: nowrap");
  });

  it("产品名被挤时出省略号，不折成两行（真机那格是「墨宸 · 主 / 笔」）", () => {
    const strong = ruleBlock(CONVERSATION, ".conversation-heading-start strong");
    expect(strong).toContain("text-overflow: ellipsis");
    expect(strong).toContain("white-space: nowrap");
    expect(strong).toContain("min-width: 0");
  });

  it("窄栏那一级只藏文字、留图标——所以文案在模板里必须是元素，不能是裸文本节点", () => {
    const narrow = blocks(CONVERSATION, "@container conversation (max-width: 320px)");
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toContain(".header-text-button-label");
    expect(narrow[0]).toContain("display: none");
    // 裸文本节点 CSS 选不中：两枚按钮都得有这层 span，否则这条阶梯是死规则。
    expect(
      countNeedle('<span class="header-text-button-label">历史对话</span>', HISTORY_MENU)
    ).toBe(1);
    expect(
      countNeedle('<span class="header-text-button-label">新建对话</span>', HEADER_ACTIONS)
    ).toBe(1);
    // 三角与图标不许跟着藏：只许那一个类名进 display:none。
    const noneInNarrow = [...narrow[0]!.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)];
    expect(noneInNarrow).toHaveLength(1);
    expect(noneInNarrow[0]![1]).toContain(".header-text-button-label");
  });

  it("阶梯的基准是这一格自己的内容盒，不是视口", () => {
    expect(ruleBlock(CONVERSATION, ".conversation-pane")).toContain(
      "container: conversation / inline-size"
    );
  });
});

describe("5-㉓ ③ 上下文条：副文缩，不许溢出画到下一枚身上", () => {
  it("两段副文都可缩并带省略号——一个是钉死不缩，一个原先根本没有规则", () => {
    for (const [css, sel] of [
      [CARD, ".composer-doc-context .doc-context-kind"],
      // 2026-11-20：计量读数搬去状态栏之后，它的可缩规则也跟着搬进 context-meter.css
      //（选择器跟着改成 `.context-meter--compact`——那一枚不再挂在绑定条的胶囊上）。
      [METER, ".context-meter--compact .context-meter-text"]
    ] as Array<[string, string]>) {
      const rule = ruleBlock(css, sel);
      expect(rule, `${sel} 没读到规则块`).toContain("flex: 0 1 auto");
      expect(rule).toContain("min-width: 0");
      expect(rule).toContain("overflow: hidden");
      expect(rule).toContain("text-overflow: ellipsis");
    }
  });

  it("主标题也不许按字断行", () => {
    expect(ruleBlock(CARD, ".composer-context-item > strong")).toContain("white-space: nowrap");
  });

  it("每枚胶囊有地板：装到地板时图标仍要在盒里，不许塌到比图标还窄", () => {
    const item = ruleBlock(CARD, ".composer-context-item");
    expect(item).toContain("min-width: 34px");
    // 没有它，尾巴（✕ / ›）会画到胶囊外——真机 1024 量到 +10 / +19px。
    expect(item).toContain("overflow: hidden");
  });

  it("收缩次序钉死：缺额只砸两个标题，档案/计量/阶段三枚控件不缩", () => {
    // 反面样本：真机 1440 放大图里档案那枚只剩一个「：」、计量只剩「1 …」。
    const fixed = standaloneRule(CARD, ".composer-profile-context, .composer-stage-context");
    expect(fixed).toContain("flex: 0 0 auto");
    expect(fixed).toContain("max-width: 12em");
    // 2026-11-20：计量那一枚搬去了状态栏，它的「不缩」在 context-meter.css 的
    // `.context-meter--compact` 上（max-width 12em 同值，档位没变）。
    expect(ruleBlock(METER, ".context-meter--compact")).toContain("flex: 0 0 auto");
    expect(ruleBlock(METER, ".context-meter--compact")).toContain("max-width: 12em");
    expect(ruleBlock(CARD, ".composer-book-context")).toContain("flex: 0 1 auto");
  });

  it("末一档连尾巴一起收：尾巴是字形不是热区，解除绑定靠整枚胶囊的 @click", () => {
    const step = containerStep(
      CARD,
      "@container composer (max-width: 300px)",
      ".composer-context-item > strong"
    );
    expect(step).toMatch(/\.composer-context-item \.context-chevron\s*\{[^}]*display:\s*none/s);
  });

  it("窄栏递进：副文 → 计量读数 → 主标题，只藏文字", () => {
    // 逐条规则匹配，不是「整块里有没有 display: none」。
    // 【这一条是被变异逮出来的】第一版只断言整块含 display: none，
    // 而 300 那档里有**两条** display:none（主标题 + 尾巴），于是把主标题那条改成
    // display: block 之后整块照样含 display:none、断言照样绿——**漏网一条**。
    // 「红得对」不等于「验到了那一块」：块级断言会把同块的另一条当成自己的。
    // 2026-10-23：副文那一级的阈值从 460 提前到 800（中等宽度就该退场，实测见样式表注释）。
    // 2026-11-20：计量读数那一级撤掉了——占用读数搬去了状态栏，输入卡里已经没有它，
    // 那一档藏的是一个不存在的元素（留着就是一条死规则）。阶梯变成两级：副文 → 主标题。
    const steps: Array<[string, string]> = [
      ["@container composer (max-width: 800px)", ".composer-doc-context .doc-context-kind"],
      ["@container composer (max-width: 300px)", ".composer-context-item > strong"]
    ];
    for (const [at, sel] of steps) {
      const step = containerStep(CARD, at, sel);
      const re = new RegExp(
        `${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*display:\\s*none`,
        "s"
      );
      expect(re.test(step), `${at} 里 ${sel} 那条规则没有 display: none`).toBe(true);
    }
  });

  it("中等宽度那一档只退「屏上已有第二份」的两段字，整枚控件一枚不藏", () => {
    const step = containerStep(
      CARD,
      "@container composer (max-width: 800px)",
      ".composer-profile-context > strong"
    );
    // 档案名在对话栏顶上、文档的「章节 · N 字」在页脚，两处都是第二份。
    expect(step).toMatch(/\.composer-doc-context \.doc-context-kind\s*\{[^}]*display:\s*none/s);
    expect(step).toMatch(/\.composer-profile-context > strong\s*\{[^}]*display:\s*none/s);
    // 整枚胶囊（控件）仍然不许藏：`.composer-context-item { display: none }` 必须不出现。
    expect(step).not.toMatch(/\.composer-context-item\s*\{[^}]*display:\s*none/s);
  });

  it("每一档都还把间隙与内边距往回收——否则全藏光也装不下（固定开销 289 > 真机 284）", () => {
    for (const [at, sel] of [
      ["@container composer (max-width: 460px)", ".composer-context-bar"],
      // 2026-11-20：380 那一档原先挂在计量读数上，读数搬走之后它挂回绑定条本身
      //（那一档本来也收间隙与内边距，只是当时锚点选的是计量那一段）。
      ["@container composer (max-width: 380px)", ".composer-context-bar"],
      ["@container composer (max-width: 300px)", ".composer-context-item > strong"]
    ] as Array<[string, string]>) {
      const step = containerStep(CARD, at, sel);
      expect(step).toMatch(/\.composer-context-bar \{[^}]*gap:/);
      expect(step).toMatch(/\.composer-context-bar \{[^}]*padding-inline:/);
    }
  });
});

describe("5-㉓ ④ 读稿四面：长无空格串四面断得一样", () => {
  it("四面同名同值 break-word：textarea 的 UA 默认值被显式钉住，预览/浏览/mirror 对齐", () => {
    // textarea 与浏览面共用一条规则；按 `.document-preview` 这个成员去取——
    // 选择器列表怎么折行是 prettier 的事（与 editor-mirror-parity.test.ts 同一处考量）。
    expect(ruleBlock(EDITOR, ".document-preview")).toContain("overflow-wrap: break-word");
    expect(ruleBlock(EDITOR, ".markdown-body")).toContain("overflow-wrap: break-word");
    expect(ruleBlock(EDITOR, ".find-replace-mirror")).toContain("overflow-wrap: break-word");
  });

  it("镜像仍与 textarea 同为 word-break: normal（5-㉑ 那条不许被顺带改掉）", () => {
    expect(ruleBlock(EDITOR, ".find-replace-mirror")).toContain("word-break: normal");
  });

  it("代码块的长行仍然横向滚动：继承来的 break-word 必须在 pre 上写回 normal", () => {
    const pre = ruleBlock(EDITOR, ".markdown-body pre");
    expect(pre).toContain("overflow-x: auto");
    expect(pre).toContain("overflow-wrap: normal");
  });
});

/**
 * 批次 5-㉔ · 对话区：极端内容进到「浏览面板 + 对话区」这后两个面时撞出来的一条。
 *
 * 真机读数（1440，对话区 730 宽）：用户那条 414 字符的消息里含一串 200 字符的无空格链接，
 * `.user-text` 量到 **client 1442 / 容器 730**，而承载链
 * `.message-list → .agent-column → .agent-timeline → .agent-block → .user-line`
 * 全是 `overflow-x: visible`；再往上 `.conversation-scroll` 是 `overflow-x: hidden`。
 * 于是右半截不是「溢出到窗口外」，是**被裁掉且无法横向查看**——内容不可达。
 * （d4 把这一格报成「出视口」，但真正要说清的是它在滚动容器里被裁：这两种长得像，结论相反。）
 *
 * 修法两半，缺一不可：
 *   · `.agent-block` 挂 `overflow-wrap: break-word`——它是八种时间线块的共同祖先，一份实现盖住全部；
 *   · `.user-text` 挂 `min-width: 0`——**机制必需**：`.user-line` 是 flex，`.user-text` 是 flex item，
 *     它的地板是内容的 min-content 尺寸，而 `break-word` 按规范**不参与 min-content 计算**
 *     （`anywhere` 才参与）。只加祖先那一条，这一格照样 1442px，缺额纹丝不动。
 */
describe("5-㉔ 对话区：长无空格串必须断行，不许被裁成看不见", () => {
  it("共同祖先 .agent-block 挂 break-word：一份实现盖住八种块", () => {
    expect(countNeedle(".agent-block {", CARD)).toBe(1);
    const block = standaloneRule(CARD, ".agent-block");
    expect(block).toContain("overflow-wrap: break-word");
  });

  it(".user-text 必须自己掀掉 flex 自动地板（break-word 在 flex item 上不参与 min-content）", () => {
    expect(countNeedle(".user-text {", CARD)).toBe(1);
    const user = standaloneRule(CARD, ".user-text");
    expect(user).toContain("min-width: 0");
    // 反自欺：这条不许被换成 anywhere。anywhere 也断，但**改了内在尺寸**，
    // 会把同一段字在别处（工具卡、差异卡）的折行位置一并改掉——那是 5-㉓ 定过的口径。
    expect(user).not.toContain("overflow-wrap: anywhere");
  });

  it("两半都要在：只有 break-word 没有 min-width，或只有 min-width 没有 break-word，都不算修好", () => {
    const block = standaloneRule(CARD, ".agent-block");
    const user = standaloneRule(CARD, ".user-text");
    expect(block).toMatch(/overflow-wrap:\s*break-word/);
    expect(user).toMatch(/min-width:\s*0/);
  });

  it("反自欺：规则正文里的注释不许喂饱断言（注释里写「配 min-width: 0」曾让 N9 变异漏网）", () => {
    // 把 standaloneRule 的行为直接钉住：给它一段「只有注释里有那条声明」的规则。
    const fake = `.user-text {
  color: red;
  /* 必须配 min-width: 0 掀掉自动地板 */
}`;
    expect(standaloneRule(fake, ".user-text")).not.toContain("min-width: 0");
    // 真声明还在时必须读得到，否则这条工具就废了
    const real = `.user-text {
  min-width: 0;
  /* 注释里也提一句 min-width: 0 */
}`;
    expect(standaloneRule(real, ".user-text")).toContain("min-width: 0");
  });

  it("反自欺：这两条规则挂在真在渲染的类上（时间线上真有 .user-text / .agent-block）", () => {
    const tpl = templateSource("components/AgentTimeline.vue");
    expect(countNeedle('class="agent-block"', tpl)).toBe(1);
    expect(countNeedle('class="user-text"', tpl)).toBe(1);
  });
});

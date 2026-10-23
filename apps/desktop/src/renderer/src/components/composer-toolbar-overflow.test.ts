/**
 * #113f 输入卡 chip 行：窄栏只许「收缩 + 截断」，不许折行；≤1220px 的三栏收窄必须住在层叠最后一段。
 *
 * 依据是 deepwrite`styles.css` 的原值，不是我们的品味：
 * - 2611-2655：`.composer-tools{flex:1 1 0}`、`.composer-actions{flex:0 0 auto}`、
 *   `.composer-tools .conversation-model-config{flex:0 1 auto}`＋`{max-width:100%;min-width:0}`、
 *   `.composer-tools .conversation-model-config-label{min-width:0}`，
 *   以及 `@container composer (max-width: min(32rem, 560px))` 里那条 `max-width: 8em`。
 *   他整个 composer 段里**一处 flex-wrap 都没有**：窄了出省略号，永远一行（2026-10-22 起本仓不再照搬，见文末裁定）。
 * - 25-27 给默认三栏（286 / clamp(410px, 34vw, 650px) / 320），5071-5075 的 ≤1220px 收窄（262/395）
 *   写在**同一份文件末尾**——同一特异性的平手由顺序裁决，所以他那块真能盖住前面那三条默认值。
 * - 2643-2650 的 `@container` 块里 `max-width: 8em` 只落在 `.conversation-model-config-label` 一枚上；
 *   他那行除模型入口外只有 `flex: 0 0 auto` 的圆钮（2569-2575、293-323），所以**收缩范围本来就只有一枚**。
 *
 * 真机读数（2026-10-04，自起实例 :9237，日志 t113f-measure.log / t113f-cascade.log / t113f-smoke7.log）：
 * 1426 窗口下左端六件自然宽 448.7 + 右端 159 + 间隙 8 = 615.7，而 toolbar 内容盒 603 ⇒ 差 12.7px 整条折到第二行；
 * 同一实例把视口改到 1120（`matchMedia("(max-width:1220px)")` 当场 true）时 `--left-pane-width` 仍读 286px
 * ⇒ 那块媒体查询住在 theme-runtime.css，而 styles.css 的 @import 全在文件头部、自己的 `:root` 排在所有导入之后
 * ⇒ 导入方在平手里必输，收窄从没生效过。
 * 第三条是收缩范围搬宽了的实测后果（t113f-smoke7 的 OBSERVE 行）：把 `flex:0 1 auto` 铺到全部 chip 后，
 * 13px 缺额被五枚 chip 摊平，每枚只差 2~4px ⇒「关…」「联网…」「工…」「/…」齐出（截图 m113f-composer-1426.jpg），
 * 因为 `text-overflow: ellipsis` 差 1px 就要吃掉一个汉字。所以可缩的那一枚必须只有模型（唯一随数据变长的标签）。
 * 三条都是「对齐未复用全」，各自都要有钉子。
 *
 * 2026-10-05 用户裁定再改版：deepwrite 那套「只收模型 8em」到窄窗就全线糊成省略号（用户截图实锤），
 * 改成**逐级收标签、保图标**的阶梯（380 起右端参与收缩）——控件本体一个不藏，功能与 tooltip 全程在。
 * 同日用户第三次裁定：阶梯**次序按「图标能否自解释」排**（tools→palette→web-search→thinking 先收，
 * 模型名只截断永不隐藏）——判据从「谁最长」换成「藏掉文字还剩多少信息」。
 *
 * 2026-10-22 用户裁定反转「永远一行」（上面 2611-2655 那条 deepwrite 原值不再照搬）：
 * 1600 宽 + 右栏展开（容器 840）真机上左端五枚 + 右端整组放不下，摆出「联网…」「多…」「工…」一排残片——
 * 在**宽窗**就把标签读废，这已经不是「窄窗才付的代价」。改为 `.composer-toolbar` 自带 `flex-wrap: wrap`：
 * 左端 basis 取自然宽（auto）、放不下时右端整组 `margin-left: auto` 落到第二行。
 * 收缩阶梯（722/696/662/615/589）与窄档两级（620 分配 / 560 换行 + 收右端文字）原样保留。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  styleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const COMPOSER = "components/ComposerBox.vue";
const CARD = styleSource("agent-pane.css");
const CHIPS = styleSource("interaction.css");
const ROOT = vueSource("styles.css");

/**
 * `@container` / `@media` 块里有嵌套大括号，`ruleBlock` 的 `[^}]*` 读不了整块 ⇒ 按配对的花括号切。
 * 只在本文件的块级断言里用；规则级断言一律继续走 `ruleBlock`（铁律 6 那份真身）。
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
    i = css.indexOf(at, j);
  }
  return out;
}

describe("chip 行 · 放不下就折两行（2026-10-22 用户裁定，反转 deepwrite 的「永远一行」）", () => {
  it("工具栏允许折行；左端取自然宽 flex:1 1 auto，自身仍是单行（折行只发生在工具栏这一层）", () => {
    const bar = ruleBlock(CARD, ".composer-toolbar");
    expect(bar).toContain("flex-wrap: wrap");
    const body = ruleBlock(CARD, ".composer-toolbar-left");
    // 规则体内不留注释：下一条 not.toContain 的鉴别力全靠这一条守着（注释里写着 flex-wrap 不算做）。
    expect(body).not.toContain("/*");
    // basis 取 auto 而不是 0：折行判据问的是「左端自己放不放得下」，basis:0 让它永远「放得下」，
    // 折行轮不到、右端先被挤死。
    expect(body).toContain("flex: 1 1 auto");
    expect(body).toContain("min-width: 0");
    expect(body).not.toContain("flex-wrap");
    // 折行后右端整组落在第二行：单项目的行上 `justify-content: space-between` 等同 flex-start，
    // 必须靠 margin-left:auto 才靠右。
    expect(ruleBlock(CARD, ".composer-toolbar-right")).toContain("margin-left: auto");
  });

  it("左端每一枚都可让位：flex:0 1 auto + max-width:100%（钉成 0 0 auto 会在窄档溢出压到右端头上）", () => {
    const chip = ruleBlock(CARD, ".composer-toolbar-left .composer-chip");
    expect(chip).toContain("flex: 0 1 auto");
    expect(chip).toContain("max-width: 100%");
    // 真机读数（t113f-smoke9.log 第 3 行）：把非模型四枚钉成 `flex: 0 0 auto` 后，
    // 1120 窗口下左端 scrollWidth 比 clientWidth 多出 97px ⇒ 「/ 命令」画在「只读参考」上（m113f-window-1120.jpg）。
    expect(chip).not.toContain("flex: 0 0 auto");
  });

  it("地板分两档：文字可以让光，图标与下拉三角不能让（基链 min-width:0 会一路压穿）", () => {
    // 真机读数（t113f-smoke12.log）：只给模型那一枚配地板时，1120 窗口下「工具」被压到 37.9（内容溢出 4px）、
    // 「/ 命令」41.1（溢出 1px）⇒ 图标与三角画出盒子贴上下一个 chip。
    // 28 = 内边距 7+7 + 图标 14；44 = 再加间隙 5 + 下拉三角 11（`:has` 那条特异性更高才压得住）。
    const floorOf = (sel: string) => {
      const m = ruleBlock(CARD, sel).match(/min-width:\s*(\d+(?:\.\d+)?)px/);
      return m ? Number(m[1]) : 0;
    };
    expect(floorOf(".composer-toolbar-left .composer-chip")).toBeGreaterThanOrEqual(28);
    expect(floorOf(".composer-toolbar-left .composer-chip:has(.composer-chip-caret)")).toBe(44);
  });

  it("让位有先后：模型那一枚的 flex-shrink 远大于 1，13px 的小缺额全落在它身上，其余四枚保持自然宽", () => {
    const chip = ruleBlock(CARD, ".composer-toolbar-left .composer-chip--model");
    const factor = chip.match(/flex-shrink:\s*(\d+)/);
    expect(factor).not.toBeNull();
    expect(Number(factor?.[1])).toBeGreaterThanOrEqual(50);
  });

  it("label 层非零不可：min-width:0 才让 flex 把它压到 min-content 以下，nowrap 的文字才有省略号可出", () => {
    expect(ruleBlock(CARD, ".composer-toolbar-left .composer-chip-label")).toContain(
      "min-width: 0"
    );
  });

  it("图形与下拉三角不参与收缩（interaction.css 基链），右端容器默认整组不缩（他的 .composer-actions 是 0 0 auto）", () => {
    expect(ruleBlock(CHIPS, ".composer-chip-icon")).toContain("flex: 0 0 auto");
    expect(ruleBlock(CHIPS, ".composer-chip-caret")).toContain("flex: 0 0 auto");
    expect(ruleBlock(CARD, ".composer-toolbar-right")).toContain("flex: 0 0 auto");
  });

  /**
   * 2026-10-05 用户裁定改版：原方案只在 min(32rem,560px) 把模型 label 收到 8em，
   * 再窄全员压到 28/44 地板，整排糊成「关…/联网搜…/工…」的省略号泥浆——那不算适配。
   * 新口径：**逐级收标签、保图标**。控件本体/图标/三角一个不藏。
   *
   * 2026-10-05 用户再裁定（截图实锤「怎么切换模型看不见」）：阶梯**次序倒过来**。
   * 旧判据是「谁最长先收谁」⇒ 模型名第一个被收。但排序该问的是「藏掉文字还剩多少信息」：
   * 模型 chip 的立方体是纯装饰（任何模型同一个形），藏文字 = 控件什么都不告诉你；
   * 联网 🌐 / 工具 list / 命令 sparkles / 思考 brain 四个图形各自自解释，藏了仍认得出。
   * ⇒ 图标自解释的四枚先收，模型名只截断、永不 display:none。
   *
   * 2026-10-06 批次 5-⑪：**阈值整条重算**。旧值 680/620/560/500 是「只按左端算的」，
   * 而 @container 量的是整个 `.composer-wrap`。这中间右端长了一摞（工作模式 chip、麦克风、
   * 权限文案 3→5 字），真机实测右端 249px、左端只剩 354px ⇒ 整条梯子偏了约 80px：
   * 内容盒 628 只触发第一级，三枚齐出省略号，模型名被压到 5.6px。
   * 换算（`left = 内容盒 − 274`，左端五枚自然宽 448.3，详见 agent-pane.css 的注释）：
   * 448.3+274=722 / 422.3+274=696 / 388.7+274=662 / 341.7+274=615 / 315.7+274=589。
   * 踩过的坑记在这里：`clientWidth`(664) **含 padding**，@container 量的是**内容盒**(628)，
   * 拿 clientWidth 当基数会让整条梯子再偏 36px——第一次重算就是这么算歪的。
   */
  const LADDER: Array<["722px" | "696px" | "662px" | "615px", string]> = [
    ["722px", '.composer-toolbar-left .composer-chip[data-chip="tools"] .composer-chip-label'],
    ["696px", '.composer-toolbar-left .composer-chip[data-chip="palette"] .composer-chip-label'],
    ["662px", '.composer-toolbar-left .composer-chip[data-chip="web-search"] .composer-chip-label'],
    ["615px", '.composer-toolbar-left .composer-chip[data-chip="thinking"] .composer-chip-label']
  ];

  it("窄栏阶梯：四级各收一枚标签，按「图标能否自解释」排序（tools → palette → web-search → thinking），每级都钉在 @container composer 上", () => {
    for (const [width, selector] of LADDER) {
      const body = blocks(CARD, `@container composer (max-width: ${width})`);
      expect(body, `阶梯 ${width}`).toHaveLength(1);
      expect(body[0]).toContain(`${selector} {`);
      expect(body[0]).toContain("display: none");
    }
  });

  /**
   * 这一条钉的是**为什么**换次序，不是「阶梯长什么样」——LADDER 换成别的次序照样能绿，
   * 少了它就没人拦着把模型名再塞回第一级。
   */
  it("模型名永不 display:none：立方体是纯装饰，藏掉文字这枚控件就零信息（左端四枚图形自解释，模型这一个不自解释）", () => {
    for (const block of blocks(CARD, "@container")) {
      expect(block, "模型 label 不许进 display:none 名单").not.toMatch(
        /composer-chip--model[^{]*\.composer-chip-label \{[^}]*display:\s*none/
      );
    }
    // 窄到最狠的那一级也只收窄不消失（9em 截断，完整模型名仍在 title 里）。
    const last = blocks(CARD, "@container composer (max-width: 589px)")[0] ?? "";
    expect(last).toContain(".composer-toolbar-left .composer-chip--model .composer-chip-label");
    expect(last).toContain("max-width: 9em");
    expect(last).not.toContain("display: none");
  });

  /**
   * 批次 5-⑪：光有「次序」不够——次序答的是「先藏谁」，**阈值**答的是「什么时候藏」，
   * 而后者算错时不会报错，只会在真机上摆出一排省略号。这两条把「算错」的两种形态钉住：
   *   ① 阈值不再递减（后一级比前一级还宽 ⇒ 那一级永远轮不到先触发，等于没写）；
   *   ② 模型名没有地板（`flex-shrink:100` 会让它一路让到 5.6px——不是省略号，是几乎归零）。
   */
  it("阶梯阈值必须逐级递减，否则后一级永远轮不到", () => {
    const widths = LADDER.map(([width]) => Number.parseFloat(width));
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i], `第 ${i + 1} 级比上一级还宽`).toBeLessThan(widths[i - 1] ?? 0);
    }
  });

  it("模型名有地板：4.5em 认得出是个模型名，不至于被 flex-shrink 压成一根竖线", () => {
    const floor = ruleBlock(
      CARD,
      ".composer-toolbar-left .composer-chip--model .composer-chip-label"
    );
    expect(floor).toContain("min-width: 4.5em");
  });

  it("阶梯的钩子在模板里：data-chip 挂满两条循环，没有钩子的阶梯就是死规则", () => {
    const tpl = templateSource(COMPOSER);
    expect(countNeedle(':data-chip="chip.id"', tpl)).toBe(2);
  });

  it("权限档是状态，最后两级只收宽度不出局：589 收到 8em，380 起右端参与收缩", () => {
    const cap = blocks(CARD, "@container composer (max-width: 589px)")[0] ?? "";
    expect(cap).toContain(".composer-toolbar-right .composer-chip-label");
    expect(cap).toContain("max-width: 8em");
    const last = blocks(CARD, "@container composer (max-width: 380px)")[0] ?? "";
    expect(last).toContain(".composer-toolbar-right {");
    expect(last).toMatch(/\.composer-toolbar-right \{[^}]*flex: 0 1 auto/);
    expect(last).toMatch(/\.composer-toolbar-right \.composer-chip-label \{[^}]*min-width: 0/);
  });

  it("模板里 composer-chip--model 真出现（阶梯第一级与收缩加权都靠它）", () => {
    expect(countNeedle("composer-chip--model", templateSource(COMPOSER))).toBe(1);
  });

  it("反自欺（2026-10-05 新口径）：display:none 只许落在纯文字类上——按钮本体/图标/三角藏了就是假形似", () => {
    // 2026-10-05 定的口径是「控件一个不藏，只藏文字」，白名单当时只有工具栏那四枚 chip 的标签。
    // 批次 5-㉓ 给上下文条也加了三档阶梯，藏的是两段**纯文字**副文（文档胶囊的类型＋字数、
    // 计量读数），同样是文字而不是控件——所以按「白名单」改写，而不是把断言放宽成什么都不查。
    // 保证没有变小：不在白名单里的类藏一条红一条，上一版是「非 .composer-chip-label 一律红」。
    const TEXT_ONLY = new Set([
      "composer-chip-label", // 5-⑱ 阶梯：工具 / 调色 / 联网 / 思考四枚的标签
      "doc-context-kind", // 5-㉓ 阶梯第一级：文档胶囊的「章节 · N 字」
      "context-meter-text", // 5-㉓ 阶梯第二级：计量读数「≈M tokens」
      // 5-㉓ 末一档：胶囊的尾巴（✕ / ›）。**它不是控件，是控件里的字形**——
      // 解除绑定靠整枚胶囊的 @click、展开靠 aria-haspopup，藏掉字形不拿走任何功能，
      // title 上那句「点击解除绑定」也还在。真正的控件（.composer-context-item 本体）
      // 仍然不在白名单里，藏一枚整枚照样红。
      "context-chevron"
    ]);
    const hiddenClasses = (blockText: string): string[] =>
      [...blockText.matchAll(/([^{}]+)\{([^{}]*display:\s*none[^{}]*)\}/g)].flatMap((m) =>
        (m[1] ?? "")
          .trim()
          .split(",")
          .map(
            (sel) =>
              sel
                .trim()
                .split(/\s+/)
                .pop()
                ?.match(/\.([\w-]+)$/)?.[1] ?? ""
          )
          .filter(Boolean)
      );
    const hidden = blocks(CARD, "@container").flatMap(hiddenClasses);
    expect(hidden.filter((c) => !TEXT_ONLY.has(c))).toEqual([]);
    // 整枚 chip 藏掉仍然明令禁止（控件一个不丢）。
    const wholeChip = blocks(CARD, "@container").filter((b) =>
      /\.composer-chip \{[^}]*display:\s*none/.test(b)
    );
    expect(wholeChip).toEqual([]);
    // 5-㉓：上下文条那一侧的整枚胶囊同样不许藏。
    const wholeContextItem = blocks(CARD, "@container").filter((b) =>
      /\.composer-context-item \{[^}]*display:\s*none/.test(b)
    );
    expect(wholeContextItem).toEqual([]);
    // 白名单本身不许腐化：三段都必须真的被某一档用上，否则阶梯是死规则。
    expect(hidden.filter((c) => c === "doc-context-kind").length).toBeGreaterThan(0);
    expect(hidden.filter((c) => c === "context-meter-text").length).toBeGreaterThan(0);
    const tpl = templateSource(COMPOSER);
    expect(countNeedle('v-for="chip in chips', tpl)).toBe(2);
  });
});

describe("≤1220px 三栏收窄 · 必须排在 styles.css 自己的默认值与 .desktop-shell 规则之后", () => {
  const at = ROOT.indexOf("@media (max-width: 1220px)");

  it("整块搬进 styles.css，theme-runtime.css 里不留第二份（铁律 6：一处实现）", () => {
    expect(at).toBeGreaterThan(-1);
    expect(styleSource("theme-runtime.css")).not.toContain("max-width: 1220px");
  });

  it("块内就是他那三个收窄值 + 随行的两栏细节，一条不许少", () => {
    const body = blocks(ROOT, "@media (max-width: 1220px)")[0] ?? "";
    expect(body).toContain("--left-pane-width: 262px");
    expect(body).toContain("--right-pane-width: 395px");
    expect(body).toContain("--center-pane-min: 320px");
    expect(body).toContain("calc(100% - 34px)");
    expect(body).toContain(".context-caption");
  });

  it("顺序裁决：块在默认 token 之后、也在最后一条 .desktop-shell 规则之后，平手才轮得到它", () => {
    expect(at).toBeGreaterThan(ROOT.indexOf("--left-pane-width: 286px"));
    expect(at).toBeGreaterThan(ROOT.indexOf(".desktop-shell.is-left-collapsed"));
    expect(at).toBeGreaterThan(ROOT.indexOf(".desktop-shell.is-left-collapsed.is-right-collapsed"));
  });
});

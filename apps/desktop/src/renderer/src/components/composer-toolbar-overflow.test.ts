/**
 * #113f 输入卡 chip 行：窄栏只许「收缩 + 截断」，不许折行；≤1220px 的三栏收窄必须住在层叠最后一段。
 *
 * 依据是 deepwrite（Apache-2.0）`styles.css` 的原值，不是我们的品味：
 * - 2611-2655：`.composer-tools{flex:1 1 0}`、`.composer-actions{flex:0 0 auto}`、
 *   `.composer-tools .conversation-model-config{flex:0 1 auto}`＋`{max-width:100%;min-width:0}`、
 *   `.composer-tools .conversation-model-config-label{min-width:0}`，
 *   以及 `@container composer (max-width: min(32rem, 560px))` 里那条 `max-width: 8em`。
 *   他整个 composer 段里**一处 flex-wrap 都没有**：窄了出省略号，永远一行。
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
 * 三条都是「照搬没搬全」，各自都要有钉子。
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

const NARROW = "@container composer (max-width: min(32rem, 560px))";

describe("chip 行 · 收缩截断代替折行（deepwrite 的 toolbar 没有 flex-wrap）", () => {
  it("左端容器：flex:1 1 0 + min-width:0，整条规则里不许出现 flex-wrap", () => {
    const body = ruleBlock(CARD, ".composer-toolbar-left");
    // 规则体内不留注释：下一条 not.toContain 的鉴别力全靠这一条守着（注释里写着 flex-wrap 不算做）。
    expect(body).not.toContain("/*");
    expect(body).toContain("flex: 1 1 0");
    expect(body).toContain("min-width: 0");
    expect(body).not.toContain("flex-wrap");
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

  it("图形与下拉三角不参与收缩（interaction.css 基链），右端容器整组不缩（他的 .composer-actions 是 0 0 auto）", () => {
    expect(ruleBlock(CHIPS, ".composer-chip-icon")).toContain("flex: 0 0 auto");
    expect(ruleBlock(CHIPS, ".composer-chip-caret")).toContain("flex: 0 0 auto");
    expect(ruleBlock(CARD, ".composer-toolbar-right")).toContain("flex: 0 0 auto");
  });

  it("断点沿用他的 min(32rem, 560px)：两处（卡段 + 上下文条段），卡段那一处只把模型 label 收到 8em", () => {
    const narrow = blocks(CARD, NARROW);
    expect(narrow).toHaveLength(2);
    const withChipLabel = narrow.filter((b) =>
      b.includes(".composer-toolbar-left .composer-chip--model .composer-chip-label")
    );
    expect(withChipLabel).toHaveLength(1);
    expect(withChipLabel[0]).toContain("max-width: 8em");
    // 他的 8em 只落在模型那一枚（`.conversation-model-config-label`）；铺到全部 label 就是上一版的错。
    expect(withChipLabel[0]).not.toMatch(
      /\.composer-toolbar-left \.composer-chip-label\s*\{[^}]*max-width: 8em/
    );
  });

  it("模型那一枚有钩子：模板里 `composer-chip--model` 真出现（没有它，上面两条收缩规则就是死规则）", () => {
    expect(countNeedle("composer-chip--model", templateSource(COMPOSER))).toBe(1);
  });

  it("反自欺：窄栏只收文字，不许把控件藏起来（块内出现 .composer-chip 的 display:none 即为假形似）", () => {
    const hidden = blocks(CARD, "@container").filter((b) =>
      /\.composer-chip[^{]*\{[^}]*display:\s*none/.test(b)
    );
    expect(hidden).toEqual([]);
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

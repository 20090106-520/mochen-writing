/**
 * 皮肤圆角在工作区的覆盖面（2026-11-20 · 批次②：补设计系统真 bug）。
 *
 * 【病灶】皮肤的「表面层」出了三枚圆角 token（`--skin-radius-sm/md/lg`）。工作区里：
 *   - sm → 容器（`.desktop-shell`，theme-runtime.css:338）；
 *   - md → 卡片（`.extension-card` / `.skin-card` / `.proposal-card` / `.settings-card`，
 *     theme-runtime.css:453）；
 *   - lg → **一个消费者都没有**——面板族（panel-kit 那九个）与对话框写死 16px
 *     （`styles.css` 的 `--radius-panel: 16px` 与 `dialog.css` 的 `border-radius: 16px`）。
 *
 * 于是用户换皮肤时看到的是「皮肤广场预览已经直角了，回到工作区还是圆的」——
 * **换皮肤只变一半，比不变更糟**（theme-runtime.css 那段注释原话）。
 *
 * 【这一族钉三件事】
 * ① 四档圆角（控件 / 容器 / 卡片 / 面板）在工作区各有落点；
 * ② 面板层与控件层**不许写死像素**（写死 = 换皮肤只变一半）；
 * ③ 兜底值与今天的像素逐个相同——默认皮肤下界面一个字都不许变。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { skinStyleVariables } from "./appearanceSkinVisual";
import {
  ruleBlock,
  scopedStyleSource,
  styleSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/** 量一套皮肤产出的圆角 token（颜色三色固定成中性，免得每条断言都抄一遍）。 */
function radii(surface: string): Record<string, string> {
  return skinStyleVariables({
    backdrop: "plain",
    glass: "none",
    surface: surface as never,
    grid: "none",
    art: "none",
    ornament: "none",
    accent: "#5EACFF",
    ink: "#F3F4F6",
    paper: "#17191C",
    scheme: "dark"
  });
}

const rootCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const dialogCss = styleSource("dialog.css");
const panelKitCss = styleSource("panel-kit.css");

describe("皮肤圆角：四档在工作区各有落点", () => {
  it("皮肤表里有第四档「控件」：按钮 / 输入框 / 下拉那一层（原先只有容器·卡片·面板三档）", () => {
    const plain = radii("plain");
    // 控件档的兜底值必须与今天工作区里的像素相同（按钮 / 输入框是 8px），
    // 否则「让皮肤接管控件」这件事会让默认皮肤的界面凭空变形。
    expect(plain["--skin-radius-control"]).toBe("8px");
    // 四套皮肤的控制档各不相同，且全直角那档真的是 0px。
    const controls = ["plain", "square", "round-none", "dialogue"].map(
      (surface) => radii(surface)["--skin-radius-control"]
    );
    expect(new Set(controls).size, "四档控件圆角有重复 = 换表面没生效").toBe(4);
    expect(radii("square")["--skin-radius-control"]).toBe("0px");
    expect(radii("square")["--skin-radius-sm"]).toBe("0px");
    expect(radii("square")["--skin-radius-md"]).toBe("0px");
    expect(radii("square")["--skin-radius-lg"]).toBe("0px");
  });

  it("运行时真的把这一档写进 root：消费了却没定义 = 退回兜底值 = 换皮肤只变一半", () => {
    const runtime = typeScriptSource("composables/appearanceThemeRuntime.ts");
    expect(runtime).toContain('"--skin-radius-control"');
  });
});

describe("工作区的面板层跟皮肤走（lg 那一档原先一个消费者都没有）", () => {
  it("三枚工作区圆角 token 的源头都是皮肤 token，兜底值与今天的像素相同", () => {
    expect(rootCss).toContain("--radius-panel: var(--skin-radius-lg, 16px);");
    expect(rootCss).toContain("--radius-card: var(--skin-radius-md, 10px);");
    expect(rootCss).toContain("--radius-control: var(--skin-radius-control, 8px);");
  });

  it("对话框外框走面板那一档：写死 16px 就是「换了皮肤它不跟」", () => {
    expect(ruleBlock(dialogCss, ".workspace-dialog")).toContain(
      "border-radius: var(--radius-panel)"
    );
  });

  it("面板族（panel-kit 那九个 + 素材库 / 圣经简报 / 清单）走的是同一枚面板 token", () => {
    // panel-kit 早就在读 var(--radius-panel)——所以只要那枚 token 的源头换成皮肤，
    // 这一族九个面板自动跟上，不必逐个改（铁律 6：改一处，不改十处）。
    expect(panelKitCss).toContain("border-radius: var(--radius-panel);");
  });
});

describe("工作区的控件层跟皮肤走（按钮 / 输入框 / 下拉）", () => {
  it("主次按钮走控件那一档", () => {
    expect(dialogCss).toMatch(
      /\.dialog-primary-button,\s*\.dialog-secondary-button\s*\{[^}]*border-radius:\s*var\(--radius-control\)/
    );
  });

  const controls: Array<[string, string]> = [
    [".dialog-close", "关闭钮"],
    [".dialog-content textarea", "说明框"],
    [".appearance-segment-button", "分段钮"],
    [".appearance-select", "下拉"],
    [".new-book-dir-input", "目录输入框"]
  ];

  for (const [selector, name] of controls) {
    it(`${name}（${selector}）走控件那一档`, () => {
      expect(ruleBlock(dialogCss, selector)).toContain("border-radius: var(--radius-control)");
    });
  }

  it("立项速记那一块是卡片：走卡片档", () => {
    expect(ruleBlock(dialogCss, ".new-book-project")).toContain(
      "border-radius: var(--radius-card)"
    );
  });

  it("同一个输入框上的两条规则读同一枚 token：`.provider-field input` 的特异性更高，它说了算", () => {
    // 真机量出来的坑：新建作品的目录输入框同时命中 `.provider-field input`（0-1-1）
    // 与 `.new-book-dir-input`（0-1-0）——前者赢。于是只改 dialog.css 那条时，
    // 输入框的圆角纹丝不动（换「直角」皮肤它也是圆的）。
    // 修法不是删掉哪一条，而是两条读同一枚 token：谁赢都一样。
    const agentPane = styleSource("agent-pane.css");
    expect(ruleBlock(agentPane, ".provider-field input")).toContain(
      "border-radius: var(--radius-control)"
    );
    expect(ruleBlock(dialogCss, ".new-book-dir-input")).toContain(
      "border-radius: var(--radius-control)"
    );
  });

  it("首次引导那枚对话框也跟皮肤走（它是本批新接的入口，不能自己留一个 16px）", () => {
    const guide = scopedStyleSource("components/OnboardingGuide.vue");
    expect(ruleBlock(guide, ".ob-dialog")).toContain("border-radius: var(--radius-panel)");
    // 上沿那截进度条的两角要跟外框同一档，否则直角皮肤下会露出两个小圆角。
    expect(ruleBlock(guide, ".ob-progress")).toContain(
      "border-radius: var(--radius-panel) var(--radius-panel) 0 0"
    );
    expect(ruleBlock(guide, ".ob-next")).toContain("border-radius: var(--radius-control)");
    expect(ruleBlock(guide, ".ob-close")).toContain("border-radius: var(--radius-control)");
  });

  it("滚动条、胶囊开关与那个圆点不跟皮肤：它们是形状语言，不是表面层", () => {
    // 滚动条拇指：形状由滚动条自己定，跟着皮肤会变成一根方棍。
    expect(ruleBlock(dialogCss, ".dialog-content::-webkit-scrollbar-thumb")).toContain(
      "border-radius: 8px"
    );
    // 开关是胶囊（999px）、旋钮是圆点（50%）：这两处一跟皮肤，开关就变成方块。
    expect(ruleBlock(dialogCss, ".appearance-toggle")).toContain("border-radius: 999px");
    expect(ruleBlock(dialogCss, ".appearance-toggle::after")).toContain("border-radius: 50%");
  });
});

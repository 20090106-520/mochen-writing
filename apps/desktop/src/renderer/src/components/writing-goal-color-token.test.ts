import { describe, expect, it } from "vitest";
import { heatBorder, heatFill, ringStroke } from "../utils/writing-goal-heat";
import { scopedStyleSource, scriptSource, templateSource } from "../utils/vue-source-reader";

/**
 * 写作目标面板的颜色（2026-10-09 扫描总单·假控件表最后一行：面板内硬编码色绕过 token）。
 *
 * 病灶：热力格的五档颜色、进度圈那一枚 stroke、达成提示的字色全是抄在组件里的十六进制字面量
 * （`#40845a / #3a7a50 / #2d6a44 / #52a56e / #e8923a / rgba(108,158,255,…)`）。
 * 主题 token（`--success` / `--accent` / `--warning`）由 `appearanceThemeRuntime` 按明暗重算，
 * 而这些抄出来的值**永远不跟着变**——浅色主题下热力格就是按暗色主题挑的那几支深绿，
 * 对比度不由任何 token 保证。这不是"配色不好看"，是"同一套界面在另一套主题下没人验过"。
 *
 * 分档判定抽到 `utils/writing-goal-heat.ts`（纯函数，能逐档钉），
 * 本文件两件事：① 分档产物的颜色一律经 token；② 面板三份源里不再出现裸的十六进制字面量。
 */

/** 剥掉「`var(--token, #兜底)` 里那个兜底」之后，剩下的才是真正抄死的颜色。 */
function stripTokenFallbacks(src: string): string {
  return src.replace(/var\(\s*--[\w-]+\s*,\s*[^)]*\)/g, "var(token)");
}

function rawHexLiterals(src: string): string[] {
  return [...stripTokenFallbacks(src).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) =>
    m[0].toLowerCase()
  );
}

describe("heatFill · 热力格五档（判定住 utils）", () => {
  it("没有写过字的那天是透明的，不是一支「看不出来的暗色」", () => {
    expect(heatFill(0, false)).toBe("transparent");
  });

  it("达成那一档用的就是 --success 本体，不再抄一份 #40845a", () => {
    expect(heatFill(100, true)).toBe("var(--success)");
  });

  it("未达成的三档按 75 / 50 / 25 分层，且每一层都经 token", () => {
    for (const pct of [90, 60, 30]) {
      const fill = heatFill(pct, false);
      expect(fill, `${pct}% 那一档没产出颜色`).not.toBe("");
      expect(fill).toContain("var(--");
    }
    // 档位深浅必须分得开：同一支 token、递减的比例，反序就是"越努力越淡"。
    expect(heatFill(90, false)).not.toBe(heatFill(60, false));
    expect(heatFill(60, false)).not.toBe(heatFill(30, false));
  });

  it("低档走 --accent（蓝色那两支），不许再出现 rgba(108,158,255,…) 这种抄死的半透明", () => {
    expect(heatFill(10, false)).toContain("var(--accent)");
    expect(heatFill(10, false)).not.toContain("rgba(");
    expect(heatFill(100, false)).not.toContain("rgba(");
  });

  it("百分比越界不炸：负数按「没有数据」画，超过 100 仍按达成档", () => {
    // 负数不是"最低那一档"，而是压根没写过字——把它涂成有色格子就是凭空造数据。
    expect(heatFill(-5, false)).toBe("transparent");
    expect(heatFill(-5, true)).toBe("transparent");
    expect(heatFill(120, true)).toBe("var(--success)");
  });
});

describe("heatBorder · 空格子那圈描边", () => {
  it("空那天只留一圈 --border 描边，不带兜底白——半透明白在浅色主题下就是隐形", () => {
    expect(heatBorder(0)).toBe("1px solid var(--border)");
    expect(heatBorder(0)).not.toContain("rgba(");
  });

  it("有颜色的格子不再描边", () => {
    expect(heatBorder(42)).toBe("none");
  });
});

describe("ringStroke · 进度圈", () => {
  it("达成圈用 --success，未达成用 --accent（旧写法在模板里抄了 #40845a 与另一支蓝）", () => {
    expect(ringStroke(true)).toBe("var(--success)");
    expect(ringStroke(false)).toBe("var(--accent)");
  });
});

describe("② 面板三份源里不再有抄死的颜色", () => {
  const file = "components/WritingGoalPanel.vue";
  const src = [scriptSource(file), templateSource(file), scopedStyleSource(file)].join("\n");

  it("这一批点名的六支语义色，一份都不许留在 var() 兜底之外", () => {
    // `var(--accent, #6c9eff)` 那种是"token 优先 + 兜底"，不是绕过 token，不算违规；
    // 违规的是把色值当**答案**写死。所以扫之前先把兜底剥掉。
    const bare = stripTokenFallbacks(src);
    for (const dead of [
      "#40845a",
      "#3a7a50",
      "#2d6a44",
      "#52a56e",
      "#e8923a",
      "#6c9eff",
      "108, 158, 255",
      "108,158,255"
    ]) {
      expect(bare, `还按字面量写着 ${dead}`).not.toContain(dead.toLowerCase());
    }
  });

  it("剥掉 var() 兜底之后，整份面板一支裸 hex 都不留", () => {
    // 不留例外表：`--accent-contrast` 这类 token 本仓已经有真身（appearanceThemeRuntime 按 accent 算对比色），
    // 再开一张"允许裸色名单"就是给自己留第二条抄色的路。
    const left = rawHexLiterals(src);
    expect(left, `还留着这些裸色：${left.join(", ")}`).toEqual([]);
  });

  it("判定确实被面板用上了，而不是 utils 里另写一套没人读", () => {
    expect(scriptSource(file)).toContain('from "../utils/writing-goal-heat"');
    // 三枚判定都不许在 .vue 里再定义一遍（第二真身就是"改了一处、另一处还抄着旧色"那颗雷）。
    for (const name of ["heatFill", "heatBorder", "ringStroke", "heatColor"]) {
      expect(scriptSource(file), `面板里自己又定义了一个 ${name}`).not.toMatch(
        new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, "m")
      );
    }
    expect(templateSource(file)).toContain("heatFill");
    expect(templateSource(file)).toContain("ringStroke(");
  });

  it("达成提示的字色跟热力格同一支 token（同一件事在两处不同色就是没收口）", () => {
    const css = scopedStyleSource(file);
    expect(css).toContain("var(--success)");
    expect(css).toContain("var(--warning)");
    expect(css).not.toMatch(/stroke:\s*#52a56e/);
  });
});

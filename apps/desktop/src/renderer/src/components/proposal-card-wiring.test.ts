/**
 * 提案卡的接线契约（评审 Important 1 的载体，复审 M-1/M-2 归位）：
 * 本仓 `.vue` 零类型检查、零运行时覆盖（裸 tsc 不收 `.vue`，vitest 是 node 环境且没有 @vue/test-utils），
 * 所以「卡只发射 decide」「父侧只接 decide」钉成读源码断言，只钉存在性与唯一性，不假装能测渲染行为。
 * 位置放在 components/ 与卡片同名，不住 utils/hotkey-markers.test.ts——那份钉的是键盘标记，名实要相符。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

const card = "components/ProposalCard.vue";
const column = "components/CenterColumn.vue";

describe("ProposalCard · 唯一发射口是 decide（化石不许回来）", () => {
  // 变异证明：把卡里的 `emit("decide", …)` 改名成 `emit("interrupt", …)` ⇒ 下面第一条当场转红，
  // 三条父侧 @decide 计数也一起红（批准链断线在测试里就是可见的）。
  it("卡只发射 decide；running prop 与 interrupt 发射都已被删，注释里留下也不作数", () => {
    const script = scriptSource(card);
    expect(script).toContain('emit("decide"');
    // scriptSource 剥掉块注释与行注释，所以「只活在注释里的 interrupt」骗不过这条断言。
    expect(script).not.toContain("interrupt");
    expect(script).not.toContain("running");
  });

  it("父侧三处卡（在审 / 已收场 / 已过期）都只接 decide，一处不漏、一处不多", () => {
    const markup = templateSource(column);
    expect(markup.match(/@decide="\(decision, guidance\) => decide\(/g)?.length).toBe(3);
    expect(markup).not.toContain("@interrupt");
  });

  // 反向保护：`:running` 挂在 ComposerBox 上是真的（它要据此把发送键换成打断），不许被当成化石一并删掉。
  it("打断能力只住在输入区：CenterColumn 仍把 :running 喂给 ComposerBox", () => {
    const markup = templateSource(column);
    const composer = /<ComposerBox\b[\s\S]*?\/>/.exec(markup)?.[0] ?? "";
    expect(composer).toContain(':running="running"');
  });
});

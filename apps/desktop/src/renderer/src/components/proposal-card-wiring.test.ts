/**
 * 提案卡的接线契约（评审 Important 1 的载体，复审 M-1/M-2 归位）：
 * 本仓 `.vue` 零类型检查、零运行时覆盖（裸 tsc 不收 `.vue`，vitest 是 node 环境且没有 @vue/test-utils），
 * 所以「卡只发射 decide」「父侧只接 decide」钉成读源码断言，只钉存在性与唯一性，不假装能测渲染行为。
 * 位置放在 components/ 与卡片同名，不住 utils/hotkey-markers.test.ts——那份钉的是键盘标记，名实要相符。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

const card = "components/ProposalCard.vue";
const column = "components/CenterColumn.vue";
// 路径算法照抄 dead-css-guard.test.ts 的那份真身（铁律 6）：从 components/ 到仓库根要六层。
const CONTRACTS = fileURLToPath(
  new URL("../../../../../../packages/contracts/src/patch.ts", import.meta.url)
);

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

/**
 * 2026-10-05：七态里 pending / expired 一直没配色（走基线灰），
 * 于是「等你点同意」和「你已拒绝」在视觉上一样安静。
 *
 * 钉法与 dead-css-guard 同一个道理：**名单不写死**，现场解析 PROPOSAL_STATUSES 推导 ——
 * 写死七个数，枚举一改这里就悄悄过期，而过期的守卫比没有守卫更坏。
 * 反向鉴别：不是「pending 有配色」这一条，是**每个状态都必须在名单里**，
 * 否则把 pending 的规则删掉照样能绿。
 */
describe("提案卡 · 七态一个不缺", () => {
  const pane = styleSource("agent-pane.css");

  function statuses(): string[] {
    const src = fs.readFileSync(CONTRACTS, "utf8");
    const block = /PROPOSAL_STATUSES\s*=\s*\[([\s\S]*?)\]/.exec(src);
    expect(block, "patch.ts 里找不到 PROPOSAL_STATUSES").toBeDefined();
    return [...block![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
  }

  it("每个提案状态都有一条 .proposal-card.is-<状态> .proposal-status 规则（从 PROPOSAL_STATUSES 现场推导）", () => {
    const all = statuses();
    expect(all.length, "状态枚举解析不出取值").toBeGreaterThan(0);
    // 判据只认「这条选择器出现过」，不要求它自己带 `{`——同色态是合并写在一个块里的
    // （rejected + cancelled 共享一条），按 ruleBlock 逐个取会误判成「没有规则」。
    const missing = all.filter(
      (s) => !new RegExp(`\\.proposal-card\\.is-${s} \\.proposal-status`).test(pane)
    );
    expect(missing, "这些状态没有专属配色，会掉回基线灰").toEqual([]);
  });

  it("待审批是唯一等你回应的态，它不许和「已拒绝」一样是灰的", () => {
    const colorOf = (status: string) => {
      const m = new RegExp(
        `\\.proposal-card\\.is-${status} \\.proposal-status[^{]*\\{([^}]*)\\}`
      ).exec(pane);
      return /color:\s*([^;]+)/.exec(m?.[1] ?? "")?.[1]?.trim() ?? "";
    };
    expect(colorOf("pending"), "待审批没有专属色").not.toBe("");
    // 拒绝是你自己的决定、已成定局 ⇒ 灰；待审批是行动号召 ⇒ 两者不许撞成同一个色。
    expect(colorOf("pending")).not.toBe(colorOf("rejected"));
  });
});

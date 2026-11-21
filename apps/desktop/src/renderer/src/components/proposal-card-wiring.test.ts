/**
 * 提案卡的接线契约（评审 Important 1 的载体，复审 M-1/M-2 归位）：
 * 本仓 `.vue` 零类型检查、零运行时覆盖（裸 tsc 不收 `.vue`，vitest 是 node 环境且没有 @vue/test-utils），
 * 所以「卡只发射 decide」「父侧只接 decide」钉成读源码断言，只钉存在性与唯一性，不假装能测渲染行为。
 * 位置放在 components/ 与卡片同名，不住 utils/hotkey-markers.test.ts——那份钉的是键盘标记，名实要相符。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { countNeedle, scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

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

  it("父侧卡位（在审 / 已收场 / 已过期 × 正文 / 设定）都只接 decide，一处不漏、一处不多", () => {
    const markup = templateSource(column);
    // 2026-11-20 起两种卡各三处（正文提案 + 设定提案），同一枚处理器。
    expect(markup.match(/@decide="\(decision, guidance\) => decide\(/g)?.length).toBe(6);
    expect(markup).not.toContain("@interrupt");
  });

  // 反向保护：`:running` 挂在 ComposerBox 上是真的（它要据此把发送键换成打断），不许被当成化石一并删掉。
  it("打断能力只住在输入区：CenterColumn 仍把 :running 喂给 ComposerBox", () => {
    const markup = templateSource(column);
    const composer = /<ComposerBox\b[\s\S]*?\/>/.exec(markup)?.[0] ?? "";
    expect(composer).toContain(':running="running"');
  });
});

describe("ProposalCard · 本轮全部接受（2026-11-20）", () => {
  // 一轮五条提案不该点五次。批量入口刻意留在 CenterColumn（那里才有本线程待审列表），
  // 卡内不复制这颗按钮——每张卡各长一颗「全部接受（N 条）」只会更乱。
  it("两条以上待审才出场（含设定提案），按钮文案带条数", () => {
    const markup = templateSource(column);
    expect(markup).toContain("pendingTotal > 1");
    expect(markup).toContain("本轮全部接受");
    expect(markup).toContain("pendingTotal }} 条");
  });

  it("逐条走既有 decide（accept-once），不新造批量 IPC", () => {
    const script = scriptSource(column);
    expect(script).toMatch(/await agent\.decide\(id, "accept-once", ""\)/);
    expect(script).not.toContain("acceptAllProposals");
    expect(script).not.toContain("decideProposalBatch");
  });
});

describe("设定提案卡（2026-11-20）", () => {
  const bible = "components/BibleProposalCard.vue";

  it("卡只发射 decide，自己不调审批 IPC", () => {
    const script = scriptSource(bible);
    expect(script).toContain('emit("decide"');
    expect(script).not.toContain("decideProposal");
    expect(script).not.toContain("window.mochen");
  });

  it("三处卡位（待审 / 已裁决 / 已过期）都摆得出设定提案", () => {
    const markup = templateSource(column);
    expect(countNeedle("<BibleProposalCard", markup)).toBe(3);
    expect(countNeedle("openBibleCards", markup)).toBeGreaterThan(0);
  });

  it("档位不对时给的是能点的出路（切档 / 切权限），不是一句安慰话", () => {
    const script = scriptSource(bible);
    expect(script).toContain('book.setWorkMode("act")');
    expect(script).toContain('book.setPermissionMode("full-access")');
    // 审批按钮只在待审时出现：已写入 / 已失效的卡不许再给人点一次。
    expect(templateSource(bible)).toContain('v-if="pending"');
  });
});

describe("ProposalCard · 卡头写的是文稿标题，不是盘上地址", () => {
  // 真机上原先读作 `chapters/01-雾从海面升起来.md`：卡在等你审批，标题却是一串路径和扩展名。
  // 换名要连带把兜底留住（查不到真名时才退回路径），否则书被改过名就一片空白。
  it("模板插的是 docTitle，docRelPath 只许当兜底", () => {
    const markup = templateSource(card);
    expect(markup).toContain("{{ docTitle }}");
    expect(markup).not.toContain("{{ view.proposal.docRelPath }}");
    expect(scriptSource(card)).toContain(
      "book.refOf(props.view.proposal.docRelPath)?.title ?? props.view.proposal.docRelPath"
    );
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

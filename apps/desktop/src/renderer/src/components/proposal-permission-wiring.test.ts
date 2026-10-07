import { describe, expect, it } from "vitest";
import {
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * 提案卡「切档后再批准」入口的**接线契约**。
 *
 * 这个入口存在的理由：档位收紧时批准会被主进程拒掉，但 pending 不删（spec §5.1 约束 3），
 * 所以「换一档再按一次就能批」是成立的——卡上不给入口，用户就只能去猜左栏那个切换器。
 *
 * `.vue` 零自动化覆盖，只能读源文件钉。读法走 vue-source-reader（剥注释），
 * 否则「这里没有 X」这句话本身写着 X。
 */
const card = scriptSource("components/ProposalCard.vue");
const cardTpl = templateSource("components/ProposalCard.vue");
const util = typeScriptSource("utils/proposal-permission.ts");
const css = styleSource("agent-pane.css");

describe("入口挂在哪里", () => {
  it("只在判定给出 switch 时才渲染按钮（blocked 那档只摆原因）", () => {
    expect(cardTpl).toContain("v-if=\"permission.kind !== 'none'\"");
    expect(cardTpl).toContain("v-if=\"permission.kind === 'switch'\"");
    expect(cardTpl).toContain("v-else");
  });

  it("按钮走真动作 useBookStore.setPermissionMode，不是直接改状态（要落盘、要失败回退）", () => {
    expect(card).toContain("void book.setPermissionMode(permission.value.mode)");
    // 直接赋值状态 = 绕过落盘，重启就丢，而且失败没有回退
    expect(card).not.toContain("book.meta!.permissionMode =");
  });

  it("落盘在途时按钮禁用（busy 态与阶段/档案那一枚选择器同一口径）", () => {
    expect(card).toContain("const permissionSaving = computed(() => book.metaSaving)");
    expect(cardTpl).toContain(':disabled="permissionSaving"');
  });

  it("判定不在组件里重写：它 import utils 那一层，组件自己一个档位名都不许出现", () => {
    expect(card).toContain('from "../utils/proposal-permission"');
    expect(card).not.toContain("read-only");
    expect(card).not.toContain("chapter-write");
    expect(card).not.toContain("full-access");
  });
});

describe("判据与主进程同一份", () => {
  it("utils 那层用的是 contracts 的 writeVerdict，不是自己写的档位规则", () => {
    expect(util).toContain("writeVerdict");
    expect(util).not.toMatch(/mode === ["']read-only["']/);
  });

  it("「当前章」取活动标签（与主进程裁定 o：线程键恒等于文稿路径 同一口径）", () => {
    expect(card).toContain("currentChapter: book.activeDocTab");
  });
});

describe("样式", () => {
  it("提示条与按钮两条规则都非空壳", () => {
    expect(css).toContain(".proposal-permission-hint {");
    expect(css).toContain(".proposal-permission-switch {");
  });

  it("组件里不写 <style>：本仓样式全在 styles/ 下", () => {
    expect(css).toContain(".proposal-permission-hint");
  });
});

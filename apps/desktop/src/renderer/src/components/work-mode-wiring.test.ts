/// <reference types="node" />
/**
 * 「先计划后动手」的**接线契约**（2026-10-05 批次 4）。
 *
 * 判定本身在 contracts 的 writeVerdict（已单测），文案在 agent-runtime 的 checkWritePermission
 * （已单测），chip 的显示判定在 composer-chips（已单测）。这里钉的是最后一环：
 * **这四层真的接在一起了**——`.vue` 零自动化覆盖，只能读源文件。
 *
 * 少接一处会出的错，按危险程度排：
 * ① chip 的事件名不在 CHIP_EMIT 里 → 按了没反应（这枚「死按钮」是本仓红线）；
 * ② 提案卡的「切到直接动手」接到 setPermissionMode 上 → 用户点了什么都没变，
 *    而且卡上说的那句话变成了假话；
 * ③ store 没落盘 → 关掉重开又回到老样子，用户以为没保存；
 * ④ 提示词那一段没接 → 闸拦得住「落盘」，拦不住「白烧一轮 token 起草再吃拒」。
 *
 * 读法走 vue-source-reader（剥注释），否则「这里没有 X」这句话本身写着 X。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  scriptSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const boxScript = scriptSource("components/ComposerBox.vue");
const centerScript = scriptSource("components/CenterColumn.vue");
const centerTpl = templateSource("components/CenterColumn.vue");
const cardScript = scriptSource("components/ProposalCard.vue");
const cardTpl = templateSource("components/ProposalCard.vue");
const store = typeScriptSource("stores/useBookStore.ts");

describe("chip 那一枚", () => {
  it("ComposerBox 声明并转发 toggle-work-mode（CHIP_EMIT 里那枚事件名逐字一致）", () => {
    expect(boxScript).toContain('"toggle-work-mode": []');
    expect(centerTpl).toContain('@toggle-work-mode="void book.toggleWorkMode()"');
  });

  it("workMode 走 prop 进来，不在组件里自己判（判定下沉 utils/contracts）", () => {
    expect(boxScript).toContain("workMode: WorkMode");
    expect(boxScript).toContain("workMode: props.workMode");
  });

  it("装配处读的是 contracts 的 workModeOf（老书兜成动手档，兜底只住一处）", () => {
    expect(centerTpl).toContain(':work-mode="workModeOf(book.meta ?? {})"');
    expect(centerScript).toContain("workModeOf");
  });
});

describe("store 落盘通路", () => {
  // 2026-10-10：四档开关的判定（拒绝理由、要写的补丁、成功提示）搬进 `utils/meta-mode-step`，
  // 行为逐条钉在 `utils/meta-mode-step.test.ts`。这里钉的是接线与「只有一份真身」。
  const step = typeScriptSource("utils/meta-mode-step.ts");

  it("setWorkMode 走 saveMeta 且失败一个字不改（照 setPermissionMode 的形状）", () => {
    expect(store).toContain("async setWorkMode(mode: WorkMode)");
    expect(store).toContain("workModeStep(this.meta, mode)");
    expect(store).toContain("await this.persistMeta(step.patch, step.failPrefix)");
    expect(step).toContain("patch: { workMode: mode }");
    expect(step).toContain("工作模式没改过来");
    // store 里不许留第二份理由：留了就有两处口径，改一处红一处。
    expect(store).not.toContain("工作模式没改过来");
  });

  it("toggleWorkMode 取反读 workModeOf，不自己判「现在是哪一档」", () => {
    expect(store).toContain('workModeOf(this.meta ?? {}) === "plan" ? "act" : "plan"');
  });

  it("没开书时不改状态，只把原因说清楚（不给用户一颗按了没反应的按钮）", () => {
    expect(step).toContain("还没打开作品目录，工作模式改不了");
    // 而且这一支一个字都不落盘：refuse 分支的 return 排在 persistMeta 之前。
    const body =
      /async setWorkMode\(mode: WorkMode\): Promise<void> \{([\s\S]*?)\n {4}\}/.exec(store)?.[1] ??
      "";
    expect(body).not.toBe("");
    expect(body).toContain("this.notice = step.notice;");
    expect(body.indexOf("return;")).toBeLessThan(body.indexOf("persistMeta"));
  });
});

describe("提案卡的那一颗", () => {
  it("计划档走 switch-work-mode 分支，事件是 setWorkMode 而不是 setPermissionMode", () => {
    expect(cardTpl).toContain("v-else-if=\"permission.kind === 'switch-work-mode'\"");
    expect(cardScript).toContain("function switchToAct");
    expect(cardScript).toContain('void book.setWorkMode("act")');
  });

  // 反向钉：把工作模式接到切档上，用户点了会「切了档但还是批不了」——
  // 卡上那句「切完这张卡可以直接批准」当场变成假话。
  it("工作模式的按钮不许误接 setPermissionMode", () => {
    const fn = /function switchToAct\(\): void \{([\s\S]*?)\n\}/.exec(cardScript)?.[1] ?? "";
    expect(fn).not.toBe("");
    expect(fn).not.toContain("setPermissionMode");
  });

  it("卡上判 workMode 也走 workModeOf（与主进程同一份解析）", () => {
    expect(cardScript).toContain("workMode: workModeOf(book.meta ?? {})");
  });
});

describe("不引第二份判定", () => {
  it("「先计划/直接动手」这两个标签字面量不许出现在 .vue 里（读 WORK_MODE_LABELS）", () => {
    for (const file of [
      "components/ComposerBox.vue",
      "components/ProposalCard.vue",
      "components/CenterColumn.vue"
    ]) {
      const src = scriptSource(file) + templateSource(file);
      for (const label of ["先计划", "直接动手"]) {
        expect(countNeedle(label, src), `${file} 里写死了「${label}」`).toBe(0);
      }
    }
  });

  it("组件里不自己判 plan/act 分支（writeVerdict 是唯一真身）", () => {
    expect(countNeedle('"plan"', cardScript)).toBe(0);
  });
});

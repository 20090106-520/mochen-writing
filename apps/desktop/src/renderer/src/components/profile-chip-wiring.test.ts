/// <reference types="node" />
/**
 * 智能体档案接线契约（2026-10-05，六档案落地）。
 *
 * 守的是 §2.7：档案选择器不是摆设——它必须能报出「点下去调哪个函数」，
 * 而且那一枚真身必须在 utils/profile-options.ts 与 book.setActiveProfile 上，不许组件里自造判定。
 *
 * 这些是源码形状断言（.vue 模板在本仓零运行时覆盖，见 dead-css-guard 头注的口径说明），
 * 判定逻辑本身的正反用例在 packages/contracts/test/agent-profile.test.ts。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AGENT_PROFILES } from "@mochen/contracts";
import { scriptSource, vueSource } from "../utils/vue-source-reader";

const chip = vueSource("components/ProfileChip.vue");
const chipScript = scriptSource("components/ProfileChip.vue");
const bar = vueSource("components/ComposerContextBar.vue");
const optionsSource = readFileSync(new URL("../utils/profile-options.ts", import.meta.url), "utf8");
const bookStore = readFileSync(new URL("../stores/useBookStore.ts", import.meta.url), "utf8");

describe("ProfileChip · 六枚档案真的接进了输入卡的绑定条", () => {
  it("绑定条渲染了这一枚，不是把组件写完就放着", () => {
    expect(bar).toContain('import ProfileChip from "./ProfileChip.vue"');
    expect(bar).toContain("<ProfileChip");
  });

  it("点选走 book.setActiveProfile（落盘真身），组件不自己改 meta", () => {
    expect(chipScript).toContain("book.setActiveProfile(");
    // 组件里不许出现直接改 meta 的写法——那会绕过 saveMeta 与失败回滚
    expect(chipScript).not.toMatch(/book\.meta\s*=/);
  });

  it("setActiveProfile 真在 store 里，且走那条带忙态与失败回话的落盘通路", () => {
    expect(bookStore).toContain("async setActiveProfile(");
    // 2026-10-05 批次 4：忙态与 saveMeta 收进了 persistMeta（四个切档动作共用一条），
    // 所以这里核的是「setActiveProfile 确实调它」+「persistMeta 确实管忙态与落盘」两格，
    // 而不是「忙态写在 setActiveProfile 体内」——后者只是那时的形状，不是这份契约。
    expect(bookStore).toMatch(/setActiveProfile[\s\S]{0,900}persistMeta\(/);
    expect(bookStore).toMatch(/async persistMeta[\s\S]{0,900}metaSaving = true/);
    expect(bookStore).toMatch(/async persistMeta[\s\S]{0,900}window\.mochen\.saveMeta/);
    expect(bookStore).toMatch(/async persistMeta[\s\S]{0,900}failPrefix/);
  });

  it("切换收起与否由「有没有真落盘成功」裁决，不由组件猜（同阶段弹层的裁定）", () => {
    expect(chipScript).toMatch(/before !== id/);
  });

  it("判定全在 utils/profile-options.ts，组件里不许自造优先级", () => {
    expect(chipScript).toContain('from "../utils/profile-options"');
    // 组件里不该出现 resolveProfile / profilesForStage 这类判定真身
    expect(chipScript).not.toContain("resolveProfile");
    expect(chipScript).not.toContain("profilesForStage");
    expect(optionsSource).toContain("resolveProfile");
    expect(optionsSource).toContain("profilesForStage");
  });

  it("只有一枚可切时不给下拉，也不挂 aria-haspopup（点开只有一项 = 假控件）", () => {
    expect(chipScript).toContain("const switchable = computed(() => options.value.length > 1)");
    expect(chip).toContain('v-if="switchable"');
    expect(chip).toContain(":aria-haspopup=\"switchable ? 'dialog' : undefined\"");
  });

  it("弹层复用阶段那一枚，不造第二个", () => {
    expect(chip).toContain('import ComposerContextMenu from "./ComposerContextMenu.vue"');
    expect(chip).toContain("<ComposerContextMenu");
  });
});

describe("六枚档案 · 花名册与 UI 行一一对应", () => {
  it("每一枚档案都有图标映射，映射不到时退回 bot（不给半张空图标）", () => {
    for (const profile of AGENT_PROFILES) {
      // PROFILE_ICONS 里要么有它，要么有 bot 兜底这条真身
      expect(
        optionsSource.includes(`"${profile.id}":`) || optionsSource.includes('?? "bot"'),
        `${profile.name} 没有图标映射，也没有 bot 兜底`
      ).toBe(true);
    }
  });

  it("正文阶段可切的那两枚（主笔 / 续写）在绑定条上真的能列出", () => {
    // 阶段→档案的登记表住在 contracts（profile-options 只消费），所以这里读 contracts 那份。
    // 少一枚就等于「续写」这个功能没上线。
    const roster = readFileSync(
      new URL("../../../../../../packages/contracts/src/agent-profile.ts", import.meta.url),
      "utf8"
    );
    expect(roster).toContain('draft: ["lead-writer", "continuer"]');
  });
});

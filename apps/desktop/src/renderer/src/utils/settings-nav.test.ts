/**
 * 设置页左栏分组标题（2026-11-11）。
 *
 * 真机截图里「关于 / 关于」上下两行——分组名和它唯一的子项同名，侧栏读成两层。
 * 判据在 utils/settings-nav.ts，这里钉三件：纯函数的三条边界、设置页真的接了它、
 * 以及那行标题确实是条件渲染（写成 v-if 但恒真的形状也算没接）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { showsSectionLabel } from "./settings-nav";

const pageSource = readFileSync(
  fileURLToPath(new URL("../components/SettingsPage.vue", import.meta.url)),
  "utf8"
);

describe("分组标题该不该画", () => {
  it("多子项分组永远画标题（标题在这里就是分组的名字）", () => {
    expect(
      showsSectionLabel({ label: "偏好", categories: [{ label: "模型配置" }, { label: "外观" }] })
    ).toBe(true);
  });

  it("单子项且同名 ⇒ 不画（「关于 / 关于」就是这条）", () => {
    expect(showsSectionLabel({ label: "关于", categories: [{ label: "关于" }] })).toBe(false);
  });

  it("单子项但不同名 ⇒ 照画（标题还在提供信息）", () => {
    expect(showsSectionLabel({ label: "备份", categories: [{ label: "远程备份" }] })).toBe(true);
  });
});

describe("设置页接线", () => {
  it("标题是条件渲染，判据只读 showsSectionLabel", () => {
    expect(pageSource).toContain("showsSectionLabel(section)");
    expect(pageSource).toMatch(
      /<strong v-if="showsSectionLabel\(section\)" class="settings-section-label"/
    );
    // 空分组没有 v-for 之外的兜底：`v-if` 写反（恒真）时这条会红。
    expect(pageSource).not.toMatch(/<strong class="settings-section-label">\{\{/);
  });

  it("「关于」在 SECTIONS 里仍是分组名 + 子项名的真实数据（不是靠删数据绕过去）", () => {
    // 数据侧不动：改的是「同名就少画一行」，不是把分组拆了。
    expect(pageSource).toMatch(/id: "about",\s*\n\s*label: "关于"/);
    expect(pageSource).toMatch(/\{ id: "about", label: "关于", icon: "archive"/);
  });
});

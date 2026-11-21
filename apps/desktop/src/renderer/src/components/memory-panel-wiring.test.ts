/// <reference types="node" />
/**
 * 「AI 记忆」面板接线契约（2026-11-20）：
 * ① `book.json` 的 `digest` 与 `recaps` 过去在渲染层零入口，这一页是它们唯一的可视化；
 * ② 摘要可改，但落盘只走 `book.persistMeta`（全仓唯一 meta 通路），不直接调 IPC；
 * ③ 两道上限来自 contracts 常量，组件里不许再抄数字；
 * ④ `recaps` 是生成出来的派生物，只读列出——组件里不许出现绑到它的 `v-model`。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const script = scriptSource("components/MemoryPanel.vue");
const template = templateSource("components/MemoryPanel.vue");
const page = vueSource("components/SettingsPage.vue");
const layout = readFileSync(new URL("../stores/layoutStore.ts", import.meta.url), "utf8");

describe("MemoryPanel · AI 记忆的可见可改", () => {
  it("设置页有「AI 记忆」这一页：分类、分支、import 三件都在", () => {
    expect(page).toContain('id: "memory"');
    expect(page).toContain('label: "AI 记忆"');
    expect(page).toContain("<MemoryPanel v-else-if=\"settingsTab === 'memory'\" />");
    expect(page).toContain('import MemoryPanel from "./MemoryPanel.vue"');
    expect(layout).toContain('"memory"');
  });

  it("落盘只走 book.persistMeta，不直接调 window.mochen.saveMeta", () => {
    expect(script).toContain("book.persistMeta(");
    expect(script).not.toContain("window.mochen");
  });

  it("两格上限取 contracts 常量，组件里不出现第二份数字", () => {
    expect(script).toContain("BOOK_DIGEST_SUMMARY_MAX_CHARS");
    expect(script).toContain("BOOK_DIGEST_CAST_MAX_CHARS");
    expect(template).toContain("BOOK_DIGEST_SUMMARY_MAX_CHARS");
    expect(template).toContain("BOOK_DIGEST_CAST_MAX_CHARS");
    // 反向：模板里 `maxlength` 只许来自绑定，不许写成字面量。
    expect(template).not.toMatch(/maxlength="\d+"/);
  });

  it("前情摘要只读：模板里有列表，但没有绑到 recaps 的 v-model", () => {
    expect(template).toContain("recapRows");
    expect(template).not.toContain("recaps");
    expect(script).not.toMatch(/v-model="[^"]*recaps/);
  });
});

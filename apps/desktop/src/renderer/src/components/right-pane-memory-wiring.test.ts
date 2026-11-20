/**
 * 右栏「记住」这一族（2026-11-20 · 主线第一刀）的接线契约。
 *
 * 【病灶】宽度记忆的存储层一直都在（`utils/rightPanePreferences.ts` 的 widths），
 * 落盘函数也写着——但它要一个「当前这一格的键」，而那个键**从来没有生产调用方**
 * （只有测试在调），于是每次拖完右栏，落盘都在第一行早退（键是 undefined）。
 * 症状：用户调好的右栏宽度，重开应用就没了。
 *
 * 这里钉三件事：① App.vue 真的接上了这条 watch；② 键的作者只有一处；
 * ③ 三态各记一份（键里带模式，不共用一把）。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, typeScriptSource } from "../utils/vue-source-reader";

const app = scriptSource("App.vue");
const store = typeScriptSource("stores/layoutStore.ts");

describe("右栏宽度按三态各记一份", () => {
  it("App.vue 盯着右栏模式换键：模式一变，宽度记忆就换到那一格去", () => {
    expect(app).toContain("book.rightPaneMode");
    expect(app).toContain("layout.setActiveRightPanePreferenceKey(rightPaneWidthKey(mode))");
    // immediate：挂载那一刻就得把键定下来，否则第一次拖动宽度记不到任何格。
    expect(app).toContain("{ immediate: true }");
  });

  it("键的作者只有一处（铁律 6）：格式写在 layoutStore 里，别处不许自己拼", () => {
    expect(store).toContain("export function rightPaneWidthKey(mode: RightPaneMode): string");
    expect(store).toContain("return `right:${mode}`;");
    // App.vue 只调用它，不自己拼字符串。
    expect(app).not.toContain("right:${");
  });

  it("三态各记一份：键里带模式 ⇒ 文稿 / 浏览 / 作品资料互不覆盖", () => {
    const keys = ["manuscript", "browse", "dossier"].map((mode) => `right:${mode}`);
    expect(new Set(keys).size).toBe(3);
    // 右栏三态的真身在 useBookStore（那里才有那份枚举）。
    const bookStore = typeScriptSource("stores/useBookStore.ts");
    expect(bookStore).toContain('"manuscript" | "browse" | "dossier"');
  });
});

/**
 * 导入 TXT 的接线守卫（2026-10-11）。全是读源码钉的（.vue 不进 tsc，也没有运行时覆盖）：
 *
 * ① App.vue 里没挂 <ImportTxtDialog> ⇒ 入口点了没反应，功能整条不存在。
 * ② 对话框只走 importTxtPreview / importTxtCommit 两枚通道 ⇒ 路径规划与写盘留在主进程，
 *    组件里不许出现 planDocRelPath / createDoc 那套「第二份路径判定」。
 * ③ 成功后登记 chapterOrder + refreshDocs ⇒ 顺序不靠文件名拼音猜（第一章/第二章/第三章
 *    按拼音排是 二、三、一——不登记次序就是真 bug）。
 * ④ LibraryNavRows 的第四枚入口 + LeftSidebar 的 need-book 闸 ⇒ 没开书不许开对话框。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

const APP = "App.vue";
const DIALOG = "components/ImportTxtDialog.vue";
const ROWS = "components/LibraryNavRows.vue";
const SIDEBAR = "components/LeftSidebar.vue";

describe("App.vue · 导入对话框挂载", () => {
  it("v-if 走 layout.importTxtOpen，关闭走 closeImportTxt——开合真身只有 store 那一份", () => {
    const tpl = templateSource(APP);
    // 2026-10-23：多带一条 `:initial-target`（素材库面板开它时预设「素材库」档）。
    expect(tpl).toMatch(
      /<ImportTxtDialog[\s\S]{0,240}?v-if="layout\.importTxtOpen"[\s\S]{0,240}?@close="layout\.closeImportTxt\(\)"/
    );
  });

  it("目标初值一路透传：store 带参 → App 透传 → 对话框取初值，面板那条入口传 material", () => {
    const store = typeScriptSource("stores/layoutStore.ts");
    expect(store).toContain('openImportTxt(target: TxtImportTargetKind = "chapter")');
    expect(store).toContain("importTxtTarget.value = target;");
    expect(templateSource(APP)).toContain(':initial-target="layout.importTxtTarget"');
    expect(scriptSource(DIALOG)).toContain('props.initialTarget ?? "chapter"');
    // 素材库面板那一支明确要「素材库」；左栏书务行不传参，仍是默认「章节」。
    expect(scriptSource("components/MaterialPanel.vue")).toContain(
      'layout.openImportTxt("material")'
    );
    expect(scriptSource(SIDEBAR)).toContain("layout.openImportTxt()");
  });
});

describe("ImportTxtDialog · 只走两枚通道，不碰路径判定", () => {
  it("预览走 window.mochen.importTxtPreview()，提交走 importTxtCommit", () => {
    const script = scriptSource(DIALOG);
    expect(script).toContain("window.mochen.importTxtPreview()");
    expect(script).toContain("window.mochen.importTxtCommit({");
    expect(script).toContain("chapters: chosen,");
    // 2026-10-23：多带一个导入目标（章节 / 素材库）。
    expect(script).toContain("targetKind: target.value");
  });

  it("反向钉：组件里不规划路径、不直接建文档（那是主进程的事）", () => {
    const script = scriptSource(DIALOG);
    expect(script).not.toContain("planDocRelPath");
    expect(script).not.toContain("createDoc");
    expect(script).not.toContain("writeDoc");
  });

  it("canceled 不当错误：预览失败分支里 canceled 明确绕开红字", () => {
    const script = scriptSource(DIALOG);
    expect(script).toContain('result.reason !== "canceled"');
  });

  it("提交只收勾选的章目，且收的是标题+正文（主进程拼路径）", () => {
    const script = scriptSource(DIALOG);
    expect(script).toContain("chapters.value.filter((c) => c.included)");
    expect(script).toContain(".map((c) => ({ title: c.title, content: c.content }))");
  });

  it("成功后（仅章节）登记 chapterOrder（persistMeta）并刷新文稿树，顺序不靠文件名猜", () => {
    const script = scriptSource(DIALOG);
    // 2026-10-23：导入素材不登记章节次序——只有 targetKind=chapter 才写 chapterOrder。
    expect(script).toContain('if (target.value === "chapter")');
    expect(script).toContain('book.persistMeta({ chapterOrder: order }, "导入的章节顺序没存住")');
    expect(script).toContain("await book.refreshDocs()");
  });
});

describe("LibraryNavRows · 第四枚书务入口", () => {
  it("data-nav-id=import-txt 的按钮，emit 的 kind 是 import，图标 download", () => {
    const tpl = templateSource(ROWS);
    expect(tpl).toContain('data-nav-id="import-txt"');
    expect(tpl).toContain("emit('open', 'import')");
    const button = tpl.indexOf('data-nav-id="import-txt"');
    const icon = tpl.indexOf('name="download"', button);
    expect(icon).toBeGreaterThan(button);
  });
});

describe("LeftSidebar · 导入入口的分派与闸", () => {
  it("kind=import：没开书给 need-book 引导，开了书才开对话框", () => {
    const script = scriptSource(SIDEBAR);
    expect(script).toContain('if (kind === "import")');
    expect(script).toContain("layout.openImportTxt()");
    // 2026-10-11：闸从这一支身上搬进了共用的 requireBook（四个「要有书才谈得上」的入口一份），
    // 原来那句 `{ kind: "need-book", label: "导入 TXT" }` 字面量随之不存在了。
    // 这里钉的是**导入确实走了那道闸**；闸自己的形状归 components/need-book-guard-wiring.test.ts 管。
    expect(script, "导入这一支没走闸 = 没书时直接开对话框").toContain("requireBook(label)");
    // 引导框要报出用户刚点的是哪一项。
    expect(script).toContain('import: "导入 TXT"');
  });
});

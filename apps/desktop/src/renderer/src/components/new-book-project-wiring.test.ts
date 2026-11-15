import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 开书立项（W-07）的接线守卫。
 *
 * 真机症状：新书建出来只有空目录，模型每轮都要重新问「写给谁、发在哪、什么不能写」。
 * 这一轮把六格立项接到 book.json、创作约定文稿和系统提示上。这里只钉「界面→store→IPC」
 * 这条线有没有接上；字段语义在 contracts 的 book-project.test.ts，落盘在 fs-store 与
 * book-service 各自的用例里。
 */
const DIALOG = readFileSync(new URL("./NewBookDialog.vue", import.meta.url), "utf8");
const STORE = readFileSync(new URL("../stores/useBookStore.ts", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../styles/dialog.css", import.meta.url), "utf8");

describe("新建作品对话框 · 立项速记", () => {
  it("六格默认可跳过：折叠区写明「可跳过」，默认不展开", () => {
    expect(DIALOG).toContain('<details class="new-book-project">');
    expect(DIALOG).toContain("立项速记（可跳过）");
    // 不写 open：跳过立项的用户不该被六格挡住。
    expect(DIALOG).not.toMatch(/<details[^>]*\sopen[\s>]/u);
  });

  it("标签从 contracts 的 BOOK_PROJECT_LABELS 来，不在这里另抄一份中文", () => {
    expect(DIALOG).toContain("BOOK_PROJECT_LABELS[field]");
    expect(DIALOG).toContain("BOOK_PROJECT_LABELS.taboos");
    expect(DIALOG).toContain("BOOK_PROJECT_LABELS.pitch");
    // 四个短格两列排，雷点与卖点各占一行。
    expect(DIALOG).toMatch(
      /PROJECT_QUICK_FIELDS[^=]*=\s*\[[\s\S]*?"genre"[\s\S]*?"platform"[\s\S]*?"length"[\s\S]*?"cadence"[\s\S]*?\]/u
    );
    expect(DIALOG).toContain('v-model="projectDraft.taboos"');
    expect(DIALOG).toContain('v-model="projectDraft.pitch"');
  });

  it("提交时把六格归一后交给 createBook：空串不落盘、跳过时不传", () => {
    expect(DIALOG).toContain("normalizeBookProject(projectDraft)");
    expect(DIALOG).toMatch(
      /book\.createBook\(\s*directory\.value,\s*title\.value\.trim\(\),\s*normalizeBookProject\(projectDraft\)\s*\)/u
    );
  });
});

describe("useBookStore.createBook · 立项透传", () => {
  it("签名收可选 project，省略时请求体里不出现这一项", () => {
    expect(STORE).toMatch(
      /async createBook\(directory: string, title: string, project\?: BookProject\)/u
    );
    expect(STORE).toContain("...(project === undefined ? {} : { project })");
    expect(STORE).toContain("window.mochen.createBook(input)");
  });
});

describe("对话框样式 · 折叠区与两列布局", () => {
  it("折叠区有独立边框与展开态标记，不与书名输入混在一起", () => {
    expect(CSS).toContain(".new-book-project {");
    expect(CSS).toContain(".new-book-project[open] > summary::before");
    expect(CSS).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  it("两个自由文本格压在 58px，不把对话框撑成一屏", () => {
    expect(CSS).toMatch(/\.new-book-project textarea \{[^}]*min-height: 58px/u);
  });
});

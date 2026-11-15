import { describe, expect, it } from "vitest";
import {
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * 2026-11-15 三处 UI 细节的接线守卫。
 *
 * ① 作品库两行同名「新建文件夹」——显示层要逐级加长路径，直到能区分；
 * ② 状态栏「没能存进目录」——只报不救，要补「查看 / 重试保存」两枚按钮；
 * ③ 输入占位文案连写三个「输入」——换成一条顺口的话。
 *
 * 这里只钉「界面接上了没有」；路径唯一化与重试语义各自的单测在
 * utils/book-path.test.ts 与 composables/bookDataRegistry.test.ts。
 */
describe("作品库 · 同名目录辨识", () => {
  it("路径行走 uniqueRootPathLabels，不再各算各的 shortenRootPath", () => {
    const script = scriptSource("components/BookLibraryList.vue");
    expect(script).toContain(
      "uniqueRootPathLabels(book.recentBooks.map((entry) => entry.rootPath))"
    );
    const template = templateSource("components/BookLibraryList.vue");
    expect(template).toContain("{{ pathLabels[index] }}");
    expect(template).not.toContain("shortenRootPath(entry.rootPath)");
  });

  it("整行仍带完整路径的 title：加长后仍认错时，悬停能看全", () => {
    expect(templateSource("components/BookLibraryList.vue")).toContain(':title="entry.rootPath"');
  });
});

describe("状态栏 · 落盘失败可操作", () => {
  it("失败清单是响应式真身，重试成功才能把按钮收掉", () => {
    const registry = typeScriptSource("composables/bookDataRegistry.ts");
    expect(registry).toContain(
      "export const bookDataFlushFailedKeys = shallowRef<BookDataKey[]>([])"
    );
    expect(registry).toContain("export async function retryFailedBookData()");
  });

  it("状态栏给出「查看」与「重试保存」，重试走唯一实现", () => {
    const template = templateSource("components/CenterColumn.vue");
    expect(template).toContain('v-if="flushFailedNames"');
    expect(template).toContain(">查看<");
    expect(template).toContain("重试保存");
    expect(template).toContain('@click="retryFlush"');
    const script = scriptSource("components/CenterColumn.vue");
    expect(script).toContain("book.notice = await retryFailedBookData()");
    expect(script).toContain("revealFlushFailures");
  });

  it("按钮样式贴着状态栏字号，不用主按钮那套分量", () => {
    const css = styleSource("agent-pane.css");
    expect(css).toContain(".status-action {");
    expect(css).toContain(".status-flush {");
  });
});

describe("输入卡 · 占位文案", () => {
  it("不再连写三个「输入」", () => {
    const script = scriptSource("components/ComposerBox.vue");
    expect(script).toContain('"输入正文，/ 唤出命令，@ 引用素材……"');
    expect(script).not.toContain("随心输入，输入 / 唤出命令");
  });
});

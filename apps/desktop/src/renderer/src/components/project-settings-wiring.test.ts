import { describe, expect, it } from "vitest";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

/**
 * 设置 → 项目管理面板的数据源（2026-10-22 窄窗走查）。
 *
 * 原实现读 useProjectManagerStore——那份 localStorage 书签册的 registerProject /
 * registerAndActivate 全仓零调用点，清单永远为空：中栏明明开着书，面板仍写
 * 「当前作品：尚未打开 / 最近作品：还没有任何作品」。真身是主进程 recent-books.json
 * （book:recent / book:forget）在 useBookStore 里的那份镜像，当前书读同一份 book.meta。
 *
 * 同一次走查还发现「打开作品目录」只调 pickBookDirectory 并丢掉返回值——选完目录不开书。
 * 这里把四个接点一并钉住，免得下一版又接回一份没人写的账。
 */
const FILE = "components/ProjectSettingsPanel.vue";
const script = () => scriptSource(FILE);
const template = () => templateSource(FILE);

describe("设置 · 项目管理面板读作品库真身", () => {
  it("数据源是 useBookStore，不再挂那份从未写入的书签册", () => {
    const s = script();
    expect(s).toContain('import { useBookStore } from "../stores/useBookStore";');
    expect(s).not.toContain("useProjectManagerStore");
    expect(s).toContain("book.meta?.title");
    expect(s).toContain("book.loadRecentBooks()");
  });

  it("最近作品直接 v-for 主进程清单，换书 / 移除都走 book store", () => {
    const t = template();
    expect(t).toContain('v-if="book.recentBooks.length > 0"');
    expect(t).toContain('v-for="entry in book.recentBooks"');
    expect(t).toContain(':key="entry.rootPath"');
    expect(t).toContain("book.rootPath === entry.rootPath");
    expect(t).toContain("book.forgetRecentBook(entry.rootPath)");
    expect(script()).toContain("await book.openBook(entry.rootPath)");
  });

  it("打开作品目录 = 选目录 + 开书；只 pick 不 open 会丢掉回执", () => {
    const s = script();
    expect(s).toContain("book.pickAndOpen()");
    expect(s).not.toContain("window.mochen.pickBookDirectory()");
  });

  it("空态与清单同一条链（只剩 v-else）", () => {
    expect(template()).toContain('<p v-else class="settings-static-text">还没有任何作品');
  });
});

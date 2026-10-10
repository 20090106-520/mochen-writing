import { describe, expect, it } from "vitest";
import { BROWSING_LABEL, browseBodyOf, browseBodyViewOf } from "./browse-body";

/**
 * 右栏「浏览」那一格的正文三态（2026-10-09 全仓扫描 P1-9）。
 *
 * 旧写法是模板里一句 `book.browseContents[relPath] ?? "正在读取…"`：
 * 读盘失败时缓存里永远没有那一格，于是界面**永久停在「正在读取…」**上——
 * 比空着更糟，因为它在撒谎，用户只能干等一句永远不会兑现的话。
 * 这里把「读到了 / 读不动 / 还在读」三态判据抽成一份纯函数，面板只管挂上去。
 */
const contents = { "characters/a.md": "人物正文\n" };
const errors = { "characters/b.md": "EBUSY: resource busy or locked" };

describe("browseBodyOf · 浏览三态", () => {
  it("读到了就用读到的正文，哪怕同一格还留着旧的失败理由", () => {
    expect(
      browseBodyOf(
        { "characters/a.md": "人物正文\n" },
        { "characters/a.md": "上一轮的错" },
        "characters/a.md"
      )
    ).toBe("人物正文\n");
  });

  it("没这一格（没打开浏览）就是空串，不编出任何占位话术", () => {
    expect(browseBodyOf(contents, errors, null)).toBe("");
    expect(browseBodyOf(contents, errors, undefined)).toBe("");
  });

  it("还在读：只有既没正文也没理由时才说「正在读取…」", () => {
    expect(browseBodyOf({}, {}, "characters/c.md")).toBe(BROWSING_LABEL);
    expect(BROWSING_LABEL).toBe("正在读取…");
  });

  it("读不动：理由上屏，并当场给出那条真实存在的重试通路", () => {
    const body = browseBodyOf(contents, errors, "characters/b.md");
    expect(body).toContain("没能读到这一格的正文");
    expect(body).toContain("EBUSY: resource busy or locked");
    expect(body).toContain("再点一次");
    expect(body).not.toContain(BROWSING_LABEL);
  });

  it("空正文（那一篇本来就是空的）不许被当成「还没读回来」", () => {
    // 这一条是 `??` 写法的另一个塌点：空串走 `??` 是**能**出来的，但若判据写成
    // `if (content)` 就又把空稿读成「正在读取…」。这里钉住用的是 undefined 判定。
    expect(browseBodyOf({ "characters/d.md": "" }, {}, "characters/d.md")).toBe("");
  });

  it("四态各自说得出话：没这一格 / 读到了 / 读不动 / 还在读", () => {
    expect(browseBodyViewOf({}, {}, null).state).toBe("none");
    expect(browseBodyViewOf(contents, {}, "characters/a.md").state).toBe("ready");
    expect(browseBodyViewOf(contents, errors, "characters/b.md").state).toBe("failed");
    expect(browseBodyViewOf(contents, {}, "characters/z.md").state).toBe("browsing");
  });

  it("失败那一态的话术里带上重试通路，且不许再冒充「正在读取…」", () => {
    const view = browseBodyViewOf(contents, errors, "characters/b.md");
    expect(view.text).toContain("没能读到这一格的正文");
    expect(view.text).toContain("EBUSY: resource busy or locked");
    expect(view.text).toContain("再点一次");
    expect(view.text).not.toContain(BROWSING_LABEL);
  });

  it("文案与状态出自同一次判定：view.text 就是 browseBodyOf 的那句话", () => {
    for (const relPath of [null, "characters/a.md", "characters/b.md", "characters/z.md"]) {
      const view = browseBodyViewOf(contents, errors, relPath);
      expect(browseBodyOf(contents, errors, relPath)).toBe(view.text);
    }
  });
});

import { describe, expect, it } from "vitest";
import { shortenRootPath } from "./book-path";

/**
 * 作品库路径的显示口径（2026-10-22）：只留尾部。
 * 判据不是「好看」，是「别把认书的那一段切掉」——原来是从尾截的，
 * 屏幕上只剩下每台机器都一样的用户目录。
 */
describe("shortenRootPath", () => {
  it("长路径只留最后两段，前面用省略号收掉", () => {
    expect(shortenRootPath("C:\\Users\\17863\\Downloads\\新建文件夹")).toBe(
      "…\\Downloads\\新建文件夹"
    );
  });

  it("本来就短（段数不超过保留数）时原样给全，不加省略号", () => {
    expect(shortenRootPath("D:\\书稿")).toBe("D:\\书稿");
  });

  it("尾部分隔符先去掉：否则末段会是空串，省略号后面拖一根斜杠", () => {
    expect(shortenRootPath("C:\\Users\\17863\\Downloads\\")).toBe("…\\17863\\Downloads");
  });

  it("POSIX 路径按 `/` 拼回去，不改成反斜杠", () => {
    expect(shortenRootPath("/Users/mo/projects/归港")).toBe("…/projects/归港");
  });

  it("空串给空串：调用处会原样渲染，不该冒出「…\\」", () => {
    expect(shortenRootPath("")).toBe("");
    expect(shortenRootPath("///")).toBe("");
  });

  it("保留段数可调", () => {
    expect(shortenRootPath("C:\\a\\b\\c\\d", 3)).toBe("…\\b\\c\\d");
    expect(shortenRootPath("C:\\a\\b\\c\\d", 1)).toBe("…\\d");
  });
});

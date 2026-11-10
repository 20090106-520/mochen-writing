import { describe, expect, it } from "vitest";
import { basenameOf, bookDisplayTitle, looksLikePath, shortenRootPath } from "./book-path";

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

describe("basenameOf", () => {
  it("取末段；尾部分隔符不影响", () => {
    expect(basenameOf("C:\\Users\\x\\Desktop\\魔渊文件夹")).toBe("魔渊文件夹");
    expect(basenameOf("/Users/mo/projects/归港/")).toBe("归港");
  });

  it("空串与纯分隔符给空串", () => {
    expect(basenameOf("")).toBe("");
    expect(basenameOf("\\\\\\")).toBe("");
  });
});

/**
 * 书名兜底（2026-11-10）。
 * 真机撞到的那一格：左栏作品库两行字一模一样，因为 `book.json` 里的 title
 * 存的就是目录路径。显示层不改盘上那份数据，只保证「读起来是个书名」。
 */
describe("bookDisplayTitle", () => {
  it("正常书名原样返回", () => {
    expect(bookDisplayTitle("海雾手记", "C:\\books\\sea")).toBe("海雾手记");
  });

  it("标题是路径时取末段", () => {
    expect(bookDisplayTitle("1…/Desktop/新建文件夹", "C:\\Users\\潇潇\\Desktop\\魔渊文件夹")).toBe(
      "新建文件夹"
    );
    expect(bookDisplayTitle("D:\\书稿\\归港", "/tmp/x")).toBe("归港");
  });

  it("标题为空 → 作品目录末段 → 占位，三级兜底不留空标签", () => {
    expect(bookDisplayTitle("", "C:\\Users\\潇潇\\Desktop\\魔渊文件夹")).toBe("魔渊文件夹");
    expect(bookDisplayTitle("   ", "")).toBe("未命名作品");
  });

  it("标题整串只有分隔符时退到目录末段，不吐出空串", () => {
    expect(bookDisplayTitle("\\\\", "D:\\书稿\\归港")).toBe("归港");
  });

  it("判别只看形状：带盘符或分隔符就算路径", () => {
    expect(looksLikePath("C:\\books")).toBe(true);
    expect(looksLikePath("chapters/01.md")).toBe(true);
    expect(looksLikePath("第一卷：归港")).toBe(false);
    // 书名里带冒号是合法的（Windows 只禁盘符那一位），不能误判成路径。
    expect(looksLikePath("归港：上册")).toBe(false);
  });
});

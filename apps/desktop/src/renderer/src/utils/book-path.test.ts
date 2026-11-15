import { describe, expect, it } from "vitest";
import {
  basenameOf,
  bookDisplayTitle,
  looksLikePath,
  shortenRootPath,
  uniqueRootPathLabels
} from "./book-path";

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
 * 同名目录辨识（2026-11-15）。
 * 真机撞到的：两个父目录下各有一个「新建文件夹」，两行标题与两段路径完全一样。
 * 口径是「只给撞车的那几行逐级多留一段」，不是把整列路径都拉长。
 */
describe("uniqueRootPathLabels", () => {
  it("没有撞车时逐字沿用 shortenRootPath(2)", () => {
    const paths = ["C:\\Users\\x\\Desktop\\海雾", "D:\\书稿\\归港"];
    expect(uniqueRootPathLabels(paths)).toEqual(paths.map((path) => shortenRootPath(path)));
  });

  it("两个「新建文件夹」撞车 ⇒ 各自多留一段父目录，直到不同", () => {
    const labels = uniqueRootPathLabels([
      "C:\\Users\\x\\Desktop\\新建文件夹",
      "C:\\Users\\x\\Desktop\\新建文件夹2\\新建文件夹"
    ]);
    // 第二条的末两段是「新建文件夹2\\新建文件夹」，第一条的末两段是「Desktop\\新建文件夹」——
    // 本来就不撞；真正撞的是下面那条同末两段的用例。
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("末两段完全相同时，只把撞车的行加长到能区分", () => {
    const labels = uniqueRootPathLabels([
      "C:\\甲\\Desktop\\新建文件夹",
      "C:\\乙\\Desktop\\新建文件夹",
      "C:\\Users\\x\\Desktop\\海雾"
    ]);
    expect(labels[0]).toBe("…\\甲\\Desktop\\新建文件夹");
    expect(labels[1]).toBe("…\\乙\\Desktop\\新建文件夹");
    // 没撞的那行一个字符都不加长。
    expect(labels[2]).toBe("…\\Desktop\\海雾");
  });

  it("POSIX 路径同样逐段加长，分隔符不改写", () => {
    const labels = uniqueRootPathLabels(["/Users/a/Desktop/书稿", "/Users/b/Desktop/书稿"]);
    expect(labels).toEqual(["…/a/Desktop/书稿", "…/b/Desktop/书稿"]);
  });

  it("同一条目录被登记两次（理论上不该有）⇒ 补行号，绝不给出两行同字", () => {
    const labels = uniqueRootPathLabels(["C:\\书稿\\归港", "C:\\书稿\\归港"]);
    expect(new Set(labels).size).toBe(2);
  });

  it("空清单与单行照旧走两段口径", () => {
    expect(uniqueRootPathLabels([])).toEqual([]);
    expect(uniqueRootPathLabels(["C:\\书稿\\归港"])).toEqual(["…\\书稿\\归港"]);
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

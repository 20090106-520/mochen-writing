import { describe, expect, it } from "vitest";
import {
  MATERIAL_CARD_FALLBACK_TITLE,
  MATERIAL_CARD_TITLE_MAX,
  materialCardBody,
  materialCardHost,
  materialCardStamp,
  materialCardTitle,
  materialCardTitleVariant
} from "./material-card";

/**
 * 网搜结果 → 素材卡（2026-10-24）。
 * 这些判定的共同点：**错了不报错**——标题太长只是树里那一行难看、标题为空只是落一篇没名字的稿、
 * 正文少了出处只是三天后没人知道这行字从哪来。所以只能靠这里钉住。
 */
describe("materialCardTitle · 网页标题当文件名要收口", () => {
  it("空白压平、首尾修剪：网页标题常带换行与前后空格", () => {
    expect(materialCardTitle("  黑暗森林  法则\n是什么  ")).toBe("黑暗森林 法则 是什么");
  });

  it("超长截断并带省略号——树里那一行撑不住三四十字", () => {
    const long = "关".repeat(MATERIAL_CARD_TITLE_MAX + 20);
    const title = materialCardTitle(long);
    expect(title.length).toBe(MATERIAL_CARD_TITLE_MAX + 1);
    expect(title.endsWith("…")).toBe(true);
  });

  it("空标题兜底：宁可叫「网上搜到的素材」，也不落一篇没有名字的文稿", () => {
    expect(materialCardTitle("")).toBe(MATERIAL_CARD_FALLBACK_TITLE);
    expect(materialCardTitle("   \n  ")).toBe(MATERIAL_CARD_FALLBACK_TITLE);
  });

  it("Windows 不许进文件名的字符就地换成「-」——不许等落盘时才报错", () => {
    // 网页标题里 `:` `?` `|` `*` 都很常见。判据住在 contracts 的 sanitizeDocFileName（唯一一份），
    // 这里钉的是「面板这一层已经把标题收拾干净了」：落盘那条通路撞上非法字符只会回一句
    // 「这些标题当不了文件名……改好标题再导」——而这个界面上根本没有改标题的地方。
    // （全角 `：` 不在 Windows 的禁用集里，留着——那是书名里本来就有的符号。）
    expect(materialCardTitle("黑暗森林：法则 | 上部")).toBe("黑暗森林：法则 - 上部");
    expect(materialCardTitle("怎么写好开头?")).toBe("怎么写好开头-");
    expect(materialCardTitle("A/B*C")).toBe("A-B-C");
  });

  it("Windows 保留名（CON / NUL 之类）换成兜底名——那种名字落不了盘", () => {
    expect(materialCardTitle("CON")).toBe(MATERIAL_CARD_FALLBACK_TITLE);
    expect(materialCardTitle("nul")).toBe(MATERIAL_CARD_FALLBACK_TITLE);
  });
});

describe("materialCardTitleVariant · 撞名时自动改名", () => {
  it("加序号后缀，不覆盖已有内容", () => {
    expect(materialCardTitleVariant("黑暗森林", 1)).toBe("黑暗森林（2）");
    expect(materialCardTitleVariant("黑暗森林", 2)).toBe("黑暗森林（3）");
  });

  it("后缀也算进长度上限里——不然「标题（2）」反而比标题还长", () => {
    const long = "关".repeat(MATERIAL_CARD_TITLE_MAX);
    const variant = materialCardTitleVariant(long, 1);
    expect(variant.length).toBeLessThanOrEqual(MATERIAL_CARD_TITLE_MAX);
    expect(variant.endsWith("（2）")).toBe(true);
  });
});

describe("materialCardBody · 出处是这张卡里最不容易再生的一行", () => {
  it("出处与收录日期都写进正文，摘要跟在后面", () => {
    const body = materialCardBody(
      { title: "黑暗森林法则", url: "https://example.com/a", snippet: "宇宙社会学的两条公理。" },
      "2026-10-24"
    );
    expect(body).toContain("来源：https://example.com/a");
    expect(body).toContain("收录：2026-10-24");
    expect(body).toContain("宇宙社会学的两条公理。");
  });

  it("抓到正文时写正文，并说明「这是正文」——别让读者以为是搜索摘要", () => {
    const body = materialCardBody(
      { title: "x", url: "https://example.com/d", snippet: "摘要那一句" },
      "2026-10-24",
      { text: "这一页真正写了什么。", truncated: false }
    );
    expect(body).toContain("这一页真正写了什么。");
    expect(body).toContain("正文");
    expect(body).not.toContain("摘要那一句");
  });

  it("正文被截断时如实写明「只取前面一段」——读者会当全文引用", () => {
    const body = materialCardBody(
      { title: "x", url: "https://example.com/e", snippet: "" },
      "2026-10-24",
      { text: "前一段。", truncated: true }
    );
    expect(body).toContain("只取前面一段");
  });

  it("只有摘要时如实说「正文没取到」，并把摘要摆上——不编一句「暂无摘要」", () => {
    const body = materialCardBody(
      { title: "x", url: "https://example.com/b", snippet: "宇宙社会学的两条公理。" },
      "2026-10-24"
    );
    expect(body).toContain("正文没取到");
    expect(body).toContain("宇宙社会学的两条公理。");
  });

  it("什么也没给时不编内容，只指出下一步", () => {
    const body = materialCardBody(
      { title: "x", url: "https://example.com/f", snippet: "" },
      "2026-10-24"
    );
    expect(body).toContain("什么也没给");
    expect(body).toContain("https://example.com/f");
  });

  it("不给日期就不写那一行（调用方没给就别硬编一个今天）", () => {
    const body = materialCardBody({ title: "x", url: "https://example.com/c", snippet: "y" }, "");
    expect(body).not.toContain("收录：");
  });
});

describe("materialCardStamp · 收录日期", () => {
  it("按 YYYY-MM-DD 记（本地时区，够人判断新旧）", () => {
    expect(materialCardStamp(new Date(2026, 9, 4))).toBe("2026-10-04");
  });
});

describe("materialCardHost · 来源站点", () => {
  it("只取主机名并去掉 www. 前缀", () => {
    expect(materialCardHost("https://www.baike.com/wiki/x")).toBe("baike.com");
    expect(materialCardHost("https://zh.wikipedia.org/wiki/x")).toBe("zh.wikipedia.org");
  });

  it("解析不出来就空着——不编一个站点名", () => {
    expect(materialCardHost("不是一条链接")).toBe("");
  });
});

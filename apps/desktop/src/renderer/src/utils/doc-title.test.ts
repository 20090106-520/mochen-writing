import { describe, expect, it } from "vitest";
import { renameTitleInContent } from "./doc-title";

describe("renameTitleInContent", () => {
  it("改掉 title 行：围栏、正文与换行原样保留", () => {
    const raw = "---\ntitle: 旧名\n---\n\n正文第一段\n";
    const result = renameTitleInContent(raw, "新名");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.content).toBe("---\ntitle: 新名\n---\n\n正文第一段\n");
  });

  it("有围栏没 title 行：补在开栏之后第一行（与新建模板的键序一致）", () => {
    const raw = "---\nexcerpt: 摘要\n---\n\n正文\n";
    const result = renameTitleInContent(raw, "补个名");
    expect(result.ok).toBe(true);
    expect(result.content).toBe("---\ntitle: 补个名\nexcerpt: 摘要\n---\n\n正文\n");
  });

  it("只认 title 键本身：title_card: 这类近名键不误伤", () => {
    const raw = "---\ntitle_card: 别动我\ntitle: 真名\n---\n\n正文\n";
    const result = renameTitleInContent(raw, "只改真名");
    expect(result.ok).toBe(true);
    expect(result.content).toBe("---\ntitle_card: 别动我\ntitle: 只改真名\n---\n\n正文\n");
  });

  it("值里的冒号与引号原样写入：解析侧只按「键: 行内其余」读，往返一致", () => {
    const result = renameTitleInContent("---\ntitle: 旧\n---\n\n", '雾: "下沉"之后');
    expect(result.ok).toBe(true);
    expect(result.content).toBe('---\ntitle: 雾: "下沉"之后\n---\n\n');
  });

  it("空名字与纯空白：拒绝，内容原样", () => {
    for (const bad of ["", "   "]) {
      const result = renameTitleInContent("---\ntitle: 旧\n---\n\n正文", bad);
      expect(result).toEqual({
        ok: false,
        content: "---\ntitle: 旧\n---\n\n正文",
        reason: "empty"
      });
    }
  });

  it("名字带换行会破 YAML 行结构：拒绝", () => {
    const result = renameTitleInContent("---\ntitle: 旧\n---\n\n正文", "两行\n的名字");
    expect(result).toEqual({
      ok: false,
      content: "---\ntitle: 旧\n---\n\n正文",
      reason: "newline"
    });
  });

  it("没有合法围栏：拒绝并说明，半截元数据不替作者补", () => {
    for (const raw of ["正文没有围栏", "---\ntitle: 只有开栏\n正文"]) {
      const result = renameTitleInContent(raw, "新名");
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("no-fence");
      expect(result.content).toBe(raw);
    }
  });
});

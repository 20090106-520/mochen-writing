import { describe, expect, it } from "vitest";
import { applyPatch, countOccurrences } from "../src/apply-patch.js";

describe("countOccurrences", () => {
  it("不重叠计数", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1);
    expect(countOccurrences("雾霜雾", "雾")).toBe(2);
  });

  it("空 needle 直接返回 0（否则会原地打转）", () => {
    expect(countOccurrences("正文", "")).toBe(0);
  });

  it('空 needle 守卫对任意假 haystack 都返回 0（countOccurrences("anything", "")）', () => {
    expect(countOccurrences("anything", "")).toBe(0);
  });
});

describe("applyPatch", () => {
  it("锚点唯一时替换并给出结果全文", () => {
    const out = applyPatch(
      "前\n雾从海面涌上来。\n后",
      "anchor-replace",
      "雾从海面涌上来。",
      "雾从海面涌上来，铁锈味很冲。"
    );
    expect(out.status).toBe("unique");
    expect(out.content).toBe("前\n雾从海面涌上来，铁锈味很冲。\n后");
  });

  it("锚点出现两次判为歧义，不产出新文本（spec §6.1）", () => {
    const out = applyPatch("雾\n雾\n", "anchor-replace", "雾", "海雾");
    expect(out.status).toBe("ambiguous");
    expect(out.hits).toBe(2);
    expect(out.message).toContain("锚点在文中出现 2 次");
    expect(out.content).toBe("");
  });

  it("锚点找不到时判 missing 并提示模型先读全文", () => {
    const out = applyPatch("正文", "anchor-replace", "闸门", "铁闸");
    expect(out.status).toBe("missing");
    expect(out.message).toContain("文中找不到锚点");
  });

  it("空锚点不合法：必须给出被替换的原文", () => {
    const out = applyPatch("正文", "anchor-replace", "", "新增");
    expect(out.status).toBe("missing");
    expect(out.message).toContain("锚点为空");
  });

  it("doc-overwrite 整篇替换且不要求锚点", () => {
    const out = applyPatch("旧大纲", "doc-overwrite", "", "新大纲三幕");
    expect(out.status).toBe("unique");
    expect(out.content).toBe("新大纲三幕");
  });

  it("doc-overwrite 给空内容时拒绝：不允许把文稿清空", () => {
    const out = applyPatch("旧大纲", "doc-overwrite", "", "   ");
    expect(out.status).toBe("missing");
    expect(out.message).toContain("不能把文稿清空");
  });

  it("新文本里的 $ 序列按字面插入（不能走 String.prototype.replace 的替换模式）", () => {
    const out = applyPatch("前\n雾。\n后", "anchor-replace", "雾。", "$&$1`$'海雾。");
    expect(out.status).toBe("unique");
    expect(out.content).toBe("前\n$&$1`$'海雾。\n后");
  });
});

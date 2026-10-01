import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter.js";

describe("frontmatter 往返", () => {
  it("解析标量与列表", () => {
    const { data, body } = parseFrontmatter(
      "---\ntitle: 深渊之下\npov: 李深\ncharacters:\n  - 李深\n  - 周砚\n---\n正文第一段。\n"
    );
    expect(data.title).toBe("深渊之下");
    expect(data.characters).toEqual(["李深", "周砚"]);
    expect(body.trim()).toBe("正文第一段。");
  });

  it("无头部时整块是正文", () => {
    const { data, body } = parseFrontmatter("只有正文。\n");
    expect(data).toEqual({});
    expect(body).toBe("只有正文。\n");
  });

  it("只按首个 --- 闭合切分，正文里的 --- 不误伤", () => {
    const { body } = parseFrontmatter("---\ntitle: A\n---\n上文\n---\n下文\n");
    expect(body).toBe("上文\n---\n下文\n");
  });

  it("剥掉 Windows 编辑器塞进来的 BOM", () => {
    const { data, body } = parseFrontmatter("﻿---\ntitle: A\n---\n正文\n");
    expect(data.title).toBe("A");
    expect(body).toBe("正文\n");
  });

  it("序列化后再解析得到同一结果", () => {
    const data = { title: "A", characters: ["甲", "乙"] };
    const round = parseFrontmatter(serializeFrontmatter(data, "正文\n"));
    expect(round.data).toEqual(data);
    expect(round.body).toBe("正文\n");
  });
});

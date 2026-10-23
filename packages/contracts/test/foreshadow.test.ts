import { describe, expect, it } from "vitest";
import {
  FORESHADOW_STATUSES,
  parseForeshadowMeta,
  resolveForeshadowStatus
} from "../src/foreshadow.js";

/**
 * 伏笔台账的形状与规则（2026-10-05）。
 *
 * 为什么住 contracts：主进程（AI 写伏笔）与渲染层（台账显示）要对**同一份**状态机达成一致，
 * 而渲染层进不了 fs-store、前端也不能各自解析一遍 frontmatter。切分复用 frontmatter.ts 那一份真身。
 *
 * 一条伏笔就是一篇 `foreshadow/` 下的普通文稿，元数据走 frontmatter：
 * ```yaml
 * ---
 * title: 老枪的伤
 * status: planted      # planted 已埋 / paid 已回收 / dropped 已弃用
 * planted: chapters/01-开局.md
 * paid: chapters/05-归港.md
 * ---
 * 正文…
 * ```
 */

describe("parseForeshadowMeta", () => {
  it("读出三件元数据：状态、埋在哪、收在哪", () => {
    const raw = [
      "---",
      "title: 老枪的伤",
      "status: paid",
      "planted: chapters/01-开局.md",
      "paid: chapters/05-归港.md",
      "keywords: [老枪, 旧伤]",
      "---",
      "",
      "他一直没让人碰那处伤。"
    ].join("\n");
    expect(parseForeshadowMeta(raw)).toEqual({
      status: "paid",
      plantedIn: "chapters/01-开局.md",
      paidIn: "chapters/05-归港.md",
      keywords: ["老枪", "旧伤"],
      rawStatus: "paid"
    });
  });

  it("没写 keywords 就是空表：不拿标题去猜关键词", () => {
    const raw = ["---", "title: 老枪的伤", "status: planted", "---", "正文"].join("\n");
    expect(parseForeshadowMeta(raw).keywords).toEqual([]);
  });

  it("没有围栏 / 没有 status 键都不报错：默认按「已埋未收」算", () => {
    expect(parseForeshadowMeta("就是一段正文。").status).toBe("planted");
    expect(parseForeshadowMeta("").status).toBe("planted");
    const noStatus = ["---", "title: 无状态", "---", "正文"].join("\n");
    expect(parseForeshadowMeta(noStatus).status).toBe("planted");
  });

  it("写了不认识的 status 不静默吞掉，按「已埋」算并让调用方能看出原文", () => {
    const raw = ["---", "title: 脏数据", "status: 已完成", "---", "正文"].join("\n");
    const meta = parseForeshadowMeta(raw);
    expect(meta.status).toBe("planted");
    // 原始值原样带回，UI 才有办法说「这条的状态字段写错了」而不是假装没看见。
    expect(meta.rawStatus).toBe("已完成");
  });

  it("只有回收章没有状态键时，推不出回收——不猜", () => {
    // 这条纪律是本文件的核心：宁可显示「已埋未收」叫作者去看一眼，也不替作者把伏笔判死。
    const raw = ["---", "title: 悬着的", "paid: chapters/09-终章.md", "---", "正文"].join("\n");
    const meta = parseForeshadowMeta(raw);
    expect(meta.status).toBe("planted");
    expect(meta.paidIn).toBe("chapters/09-终章.md");
  });
});

describe("resolveForeshadowStatus", () => {
  it("三个状态各自的中文说法", () => {
    expect(resolveForeshadowStatus("planted")).toBe("已埋 · 待回收");
    expect(resolveForeshadowStatus("paid")).toBe("已回收");
    expect(resolveForeshadowStatus("dropped")).toBe("已弃用");
  });

  it("状态集合是穷尽的：加一档就编译不过（Record 口径）", () => {
    expect(FORESHADOW_STATUSES).toEqual(["planted", "paid", "dropped"]);
  });
});

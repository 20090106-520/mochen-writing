import { describe, expect, it } from "vitest";
import { AGENT_PROFILES, DEFAULT_PERMISSION_MODE, type BookMeta } from "@mochen/contracts";
import { activeProfileLabel, activeProfileOf, conversationTitleLabel } from "./profile-options";

/**
 * 智能体档案的显示层判定（2026-10-05）。
 *
 * 这个文件此前**零单测**：顶栏标题、会话页 h1、输入卡那枚 chip 全都读这里的判定，
 * 却没有一条断言把它们钉住——「顶栏写着什么」从来没被验证过。
 *
 * 本轮起因（用户裁定）：顶栏那个「正文智能体」是 `${stage.name}智能体` 拼出来的**功能泛称**，
 * 不是「现在是谁在写」。用户要看到 AI 的名字。修在这里而不是 `.vue` 里，
 * 因为 `.vue` 不进类型程序也没有组件测试环境（判定层必须下沉 utils）。
 */

function meta(overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: ["chapters/01-a.md"],
    ...overrides
  };
}

describe("conversationTitleLabel · 顶栏标题", () => {
  it("没开书时说「未选择作品」，不许报一枚档案名（没有书就没有正在写的 AI）", () => {
    expect(conversationTitleLabel(null)).toBe("未选择作品");
  });

  it("开书后报的是**档案名**，不是「阶段名 + 智能体」这种功能泛称", () => {
    const title = conversationTitleLabel(meta({ activeProfile: "reviewer" }));
    expect(title).toBe("墨宸 · 审稿");
    // 这条是本轮改动的核心：拼法一旦退回 `${stage.name}智能体`，这里立刻红。
    expect(title).not.toContain("智能体");
  });

  it("切档案，标题跟着换人（它是「谁在写」，不是「什么阶段」）", () => {
    const writer = conversationTitleLabel(meta({ activeProfile: "lead-writer" }));
    const world = conversationTitleLabel(meta({ activeProfile: "world" }));
    expect(writer).not.toBe(world);
    expect(writer).toBe("墨宸 · 主笔");
  });

  it("老书没写 activeProfile 字段时也报得出名字，不空着也不报阶段名", () => {
    const title = conversationTitleLabel(meta());
    expect(title).not.toBe("");
    expect(title).not.toContain("智能体");
    expect(title).toBe(activeProfileLabel(meta()));
  });

  it("档案名恒取自 AGENT_PROFILES，不许在显示层自己拼一个", () => {
    const names = AGENT_PROFILES.map((p) => p.name);
    expect(names).toContain(conversationTitleLabel(meta({ activeProfile: "chief-editor" })));
    expect(activeProfileOf(meta({ activeProfile: "continuer" })).name).toBe("墨宸 · 续写");
  });
});

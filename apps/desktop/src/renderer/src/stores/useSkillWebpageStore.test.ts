import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { WebpageSkillResult } from "@mochen/contracts";
import { useSkillWebpageStore } from "./useSkillWebpageStore";

/**
 * 网页转技能的渲染层用例（2026-11-10）。
 *
 * 判定全在主进程（见 skill-webpage-service.test.ts），这里只验三件渲染层自己的事：
 * 空输入不打主进程、结果句原样摆出来、成功之后真的去刷了技能库那张表
 * ——不给 `listSkills` 桩的话 refreshSkills 会把 TypeError 吞掉、断言照样绿，
 * 那种绿灯比红更坏（与 useSkillMarketStore.test.ts 同一条教训）。
 */

function webpageResult(over: Partial<WebpageSkillResult> = {}): WebpageSkillResult {
  return {
    ok: true,
    notice: "转好了《三幕结构的节奏表》（three-act-x1y2z3）。列表里点「挂入」才进这一轮上下文。",
    dirName: "three-act-x1y2z3",
    displayName: "三幕结构的节奏表",
    bytes: 2048,
    truncated: false,
    sourceUrl: "https://example.com/structure",
    ...over
  };
}

const api = {
  convertWebpageSkill: vi.fn(),
  listSkills: vi.fn()
};

beforeEach(() => {
  setActivePinia(createPinia());
  api.convertWebpageSkill.mockReset();
  api.listSkills.mockReset();
  api.listSkills.mockResolvedValue([]);
  vi.stubGlobal("window", { mochen: api });
});

describe("useSkillWebpageStore", () => {
  it("空输入：给一句提示，不打主进程", async () => {
    const store = useSkillWebpageStore();
    await store.convert();
    expect(api.convertWebpageSkill).not.toHaveBeenCalled();
    expect(store.ok).toBe(false);
    expect(store.result).toContain("网页链接");
  });

  it("转成功：结果与回执收下，技能库那张表真的刷过", async () => {
    api.convertWebpageSkill.mockResolvedValue(webpageResult());
    const store = useSkillWebpageStore();
    store.url = " https://example.com/structure ";
    await store.convert();
    expect(api.convertWebpageSkill).toHaveBeenCalledWith("https://example.com/structure");
    expect(store.ok).toBe(true);
    expect(store.result).toContain("转好了");
    expect(store.last?.dirName).toBe("three-act-x1y2z3");
    expect(api.listSkills).toHaveBeenCalled();
  });

  it("主进程判不行：ok 原样收下，不自己乐观成成功", async () => {
    api.convertWebpageSkill.mockResolvedValue(
      webpageResult({ ok: false, notice: "转不成：这一页剥不出正文。" })
    );
    const store = useSkillWebpageStore();
    store.url = "https://example.com/empty";
    await store.convert();
    expect(store.ok).toBe(false);
    expect(store.result).toContain("剥不出正文");
    expect(store.last).toBeNull();
  });

  it("通路抛错（IPC 没接上等）：翻成一句中文，不把英文技术串摆出来", async () => {
    api.convertWebpageSkill.mockRejectedValue(new TypeError("window.mochen is undefined"));
    const store = useSkillWebpageStore();
    store.url = "https://example.com/structure";
    await store.convert();
    expect(store.ok).toBe(false);
    expect(store.result).toContain("转不成");
    expect(store.busy).toBe(false);
  });
});

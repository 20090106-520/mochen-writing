import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { MarketEntry } from "@mochen/contracts";
import { useSkillMarketStore } from "./useSkillMarketStore";

function entry(over: Partial<MarketEntry> = {}): MarketEntry {
  return {
    dirName: "chapter-intent",
    displayName: "落笔前先问清楚",
    summary: "动笔前问清楚。",
    category: "构思",
    origin: "改编自 linhut/dsh-skills 的 brainstorming（MIT）",
    license: "MIT",
    skillMd: "---\nname: 落笔前先问清楚\n---\n\n正文\n",
    installed: false,
    shadowedByBook: false,
    ...over
  };
}

const api = {
  listMarket: vi.fn(),
  installMarketSkill: vi.fn(),
  uninstallMarketSkill: vi.fn(),
  // 装卸完要去刷技能库那张表（agent store 的 refreshSkills），所以这条通道也得在场。
  // 不给桩的话 refreshSkills 会在自己内部把 TypeError 吞掉、断言照样「通过」——
  // 那种绿灯比红光更坏，它证明不了刷过。
  listSkills: vi.fn()
};

beforeEach(() => {
  setActivePinia(createPinia());
  api.listMarket.mockReset();
  api.installMarketSkill.mockReset();
  api.uninstallMarketSkill.mockReset();
  api.listSkills.mockReset();
  api.listSkills.mockResolvedValue([]);
  vi.stubGlobal("window", { mochen: api });
});

describe("refresh", () => {
  it("把主进程判好的那张表原样收下", async () => {
    api.listMarket.mockResolvedValue({ entries: [entry()], listed: true, notice: "" });
    const store = useSkillMarketStore();
    await store.refresh();
    expect(store.listed).toBe(true);
    expect(store.visible.map((e) => e.dirName)).toEqual(["chapter-intent"]);
  });

  it("列不出来：标成没列出来并给出原因，**不假装市场是空的**", async () => {
    api.listMarket.mockRejectedValue(new Error("磁盘读不到"));
    const store = useSkillMarketStore();
    await store.refresh();
    expect(store.listed).toBe(false);
    expect(store.notice).toContain("磁盘读不到");
  });

  it("主进程回 listed:false 时照抄它，不自己乐观成 true", async () => {
    api.listMarket.mockResolvedValue({ entries: [], listed: false, notice: "技能目录没权限" });
    const store = useSkillMarketStore();
    await store.refresh();
    expect(store.listed).toBe(false);
    expect(store.notice).toContain("技能目录没权限");
  });
});

describe("install / uninstall", () => {
  it("装完**必须重列**，installed 那一态由主进程说了算——store 不自己翻", async () => {
    // 这条是市场那条铁律的可执行版本：主进程这一刻回的是「还没装上」，
    // store 若自己把 installed 翻成 true，卡片上就会亮起一个没装过的技能。
    api.installMarketSkill.mockResolvedValue("装好了《落笔前先问清楚》。");
    api.listMarket.mockResolvedValue({ entries: [entry()], listed: true, notice: "" });
    const store = useSkillMarketStore();
    await store.install("chapter-intent");
    expect(api.listMarket).toHaveBeenCalledTimes(1);
    expect(store.entries[0]?.installed).toBe(false);
  });

  it("主进程说装上了，重列后那一态才变 true", async () => {
    api.installMarketSkill.mockResolvedValue("装好了《落笔前先问清楚》。");
    api.listMarket
      .mockResolvedValueOnce({ entries: [entry()], listed: true, notice: "" })
      .mockResolvedValueOnce({ entries: [entry({ installed: true })], listed: true, notice: "" });
    const store = useSkillMarketStore();
    await store.refresh();
    await store.install("chapter-intent");
    expect(store.entries[0]?.installed).toBe(true);
    expect(store.notice).toContain("装好了");
  });

  it("装完把**技能库那张表**也刷一次——那是 agent store 的另一张表，不刷它就一直停在装之前", async () => {
    // 这里盯的是 `listSkills` 而不是 `listMarket`：两张表分属两个 store，
    // 只刷市场那张的话，用户切回「已有的」看到的是装之前的列表，而 notice 写着「装好了」。
    api.listMarket.mockResolvedValue({ entries: [entry()], listed: true, notice: "" });
    api.installMarketSkill.mockResolvedValue("装好了。");
    api.listSkills.mockResolvedValue([]);
    const store = useSkillMarketStore();
    await store.install("chapter-intent");
    expect(api.listSkills).toHaveBeenCalled();
  });

  it("卸也要刷技能库：盘上少了一个目录，那张表同样过期", async () => {
    api.listMarket.mockResolvedValue({ entries: [], listed: true, notice: "" });
    api.uninstallMarketSkill.mockResolvedValue("卸掉了。");
    api.listSkills.mockResolvedValue([]);
    const store = useSkillMarketStore();
    await store.uninstall("chapter-intent");
    expect(api.listSkills).toHaveBeenCalled();
  });

  it("只递目录名出去：路径由主进程按清单拼", async () => {
    api.installMarketSkill.mockResolvedValue("装好了。");
    api.listMarket.mockResolvedValue({ entries: [], listed: true, notice: "" });
    const store = useSkillMarketStore();
    await store.install("chapter-intent");
    expect(api.installMarketSkill).toHaveBeenCalledWith("chapter-intent");
    api.uninstallMarketSkill.mockResolvedValue("卸掉了。");
    await store.uninstall("chapter-intent");
    expect(api.uninstallMarketSkill).toHaveBeenCalledWith("chapter-intent");
  });

  it("失败只写一句中文，不摆一个假的成功态", async () => {
    api.installMarketSkill.mockResolvedValue("《落笔前先问清楚》已经装在全局技能目录里了。");
    api.listMarket.mockResolvedValue({ entries: [entry()], listed: true, notice: "" });
    const store = useSkillMarketStore();
    await store.install("chapter-intent");
    expect(store.notice).toContain("已经装在全局技能目录里了");
  });

  it("通道抛错：说清是没能装卸，且 busy 一定松开（否则按钮永远点不动）", async () => {
    api.installMarketSkill.mockRejectedValue(new Error("EPERM"));
    api.listMarket.mockResolvedValue({ entries: [], listed: true, notice: "" });
    const store = useSkillMarketStore();
    await store.install("chapter-intent");
    expect(store.notice).toContain("没能装卸这一条");
    expect(store.notice).toContain("EPERM");
    expect(store.busyDirName).toBe("");
    expect(store.isBusyOn("chapter-intent")).toBe(false);
  });

  it("同一时刻只跑一个：第二次调用被挡下，不重复写盘", async () => {
    let release: (v: string) => void = () => {};
    api.installMarketSkill.mockReturnValue(new Promise<string>((r) => (release = r)));
    api.listMarket.mockResolvedValue({ entries: [], listed: true, notice: "" });
    const store = useSkillMarketStore();
    const first = store.install("chapter-intent");
    expect(store.isBusyOn("chapter-intent")).toBe(true);
    await store.install("chapter-intent");
    expect(api.installMarketSkill).toHaveBeenCalledTimes(1);
    release("装好了。");
    await first;
    expect(store.busyDirName).toBe("");
  });
});

describe("筛选", () => {
  it("「全部」摆全部；选某一类只摆那一类——判定在 store，模板不自己 filter", async () => {
    api.listMarket.mockResolvedValue({
      entries: [
        entry({ dirName: "a", category: "构思" }),
        entry({ dirName: "b", category: "结构" }),
        entry({ dirName: "c", category: "文风" })
      ],
      listed: true,
      notice: ""
    });
    const store = useSkillMarketStore();
    await store.refresh();
    expect(store.visible).toHaveLength(3);
    store.setFilter("结构");
    expect(store.visible.map((e) => e.dirName)).toEqual(["b"]);
    store.setFilter("全部");
    expect(store.visible).toHaveLength(3);
  });
});

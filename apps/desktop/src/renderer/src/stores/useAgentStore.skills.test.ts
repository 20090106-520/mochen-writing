import { beforeEach, describe, expect, it } from "vitest";
import type { SkillRef } from "@mochen/contracts";
import { useLayoutStore } from "./layoutStore";
import {
  CH,
  contextPreview,
  listSkills,
  openChapter,
  readSkill,
  saveMeta,
  setupAgentFixture,
  started,
  store
} from "./agent-store-fixture";
import { useBookStore } from "./useBookStore";

/**
 * 技能挂入（spec §11）。这组用例钉的是三件事：
 * ① 「加入当前上下文」是**唯一**让技能进入上下文的动作；
 * ② 挂入是**按线程**记的：A 章挂的不跟着漏到 B 章；
 * ③ send 把它递出去，且只递 id 不递正文——正文由主进程按同一套读取守卫取。
 */
setupAgentFixture();

// 夹具只复位实现、不清调用次数（它按自己的规矩来）；这里断言的是「**这一趟**调没调」，
// 所以调用次数必须自己清，否则上一个用例的调用会算进这一条。
beforeEach(() => {
  listSkills.mockClear();
  readSkill.mockClear();
});

function ref(source: "global" | "book", dirName: string): SkillRef {
  return {
    id: `${source}:${dirName}`,
    source,
    dirName,
    displayName: dirName,
    description: `${dirName}的说明`,
    stages: [],
    appliesTo: [],
    relPath: `${dirName}/SKILL.md`
  };
}

describe("挂入与取下", () => {
  it("加进去 / 再按一次取下，判据是本线程那份数组", () => {
    const s = store();
    expect(s.skillPathsOf(CH)).toEqual([]);
    s.toggleSkillForThread(CH, "book:伏笔");
    expect(s.skillPathsOf(CH)).toEqual(["book:伏笔"]);
    s.toggleSkillForThread(CH, "book:伏笔");
    expect(s.skillPathsOf(CH)).toEqual([]);
  });

  it("取下最后一条 ⇒ 留一个**空覆盖**（P0-4：删键会退回书级默认，那就表达不出「本会话一个都不挂」）", () => {
    const s = store();
    s.toggleSkillForThread(CH, "book:伏笔");
    s.toggleSkillForThread(CH, "book:伏笔");
    expect(s.skillPathsOf(CH)).toEqual([]);
    expect(s.hasSkillOverride(CH)).toBe(true);
  });

  it("按线程隔离：A 章挂的不跟着漏到 B 章（挂入是每条线程的事）", () => {
    const s = store();
    s.toggleSkillForThread("chapters/01-a.md", "book:伏笔");
    s.toggleSkillForThread("chapters/02-b.md", "book:节奏");
    expect(s.skillPathsOf("chapters/01-a.md")).toEqual(["book:伏笔"]);
    expect(s.skillPathsOf("chapters/02-b.md")).toEqual(["book:节奏"]);
    expect(s.skillPathsOf("unbound")).toEqual([]);
  });

  it("同一份挂入里不会重复：再按一次已挂的 id 走的是「取下」不是「再挂一遍」", () => {
    const s = store();
    s.toggleSkillForThread(CH, "book:伏笔");
    s.toggleSkillForThread(CH, "book:节奏");
    s.toggleSkillForThread(CH, "book:伏笔");
    expect(s.skillPathsOf(CH)).toEqual(["book:节奏"]);
  });

  it("挂满 12 条后再挂被拒：不写覆盖、摆一句中文；取下不受限（2026-11-24）", () => {
    // 超限的那一轮 startTurn 会被 skillPathsSchema.max(12) 整轮拒收——
    // 用户看到的只是「消息发不出去」。所以第 13 枚必须在唯一挂入口就挡下。
    const s = store();
    const twelve = Array.from({ length: 12 }, (_, i) => `book:s${String(i).padStart(2, "0")}`);
    for (const id of twelve) s.toggleSkillForThread(CH, id);
    expect(s.skillPathsOf(CH)).toHaveLength(12);
    s.toggleSkillForThread(CH, "book:多出来的");
    expect(s.skillPathsOf(CH)).toHaveLength(12);
    expect(s.notice).toContain("最多 12 个");
    // 腾位置不受限：取下一枚后又能挂新的。
    s.toggleSkillForThread(CH, "book:s00");
    expect(s.skillPathsOf(CH)).toHaveLength(11);
    s.toggleSkillForThread(CH, "book:多出来的");
    expect(s.skillPathsOf(CH)).toHaveLength(12);
  });
});

describe("send 把挂入递出去", () => {
  it("只递 id，不递正文：正文由主进程读（渲染层不持有技能内容）", async () => {
    await openChapter();
    const s = store();
    s.toggleSkillForThread(CH, "book:伏笔");
    s.send("照这个技能改");
    expect(started.at(-1)?.skillPaths).toEqual(["book:伏笔"]);
    expect(JSON.stringify(started.at(-1))).not.toContain("技能正文");
  });

  it("没挂任何技能 ⇒ 空数组（字段必填，不许缺省成 undefined）", async () => {
    await openChapter();
    store().send("随便一句");
    expect(started.at(-1)?.skillPaths).toEqual([]);
  });

  /**
   * 递出网的那份**不是响应式 Proxy**（2026-10-07 真机撞出来的产品缺陷）。
   *
   * 【症状】挂入技能之后发任何一轮都起不来，报 `An object could not be cloned.`
   * 【成因】`skillPathsOf()` 读 store state，那是 Vue 的 reactive Proxy；
   * `contextBridge` 在**进入 preload 函数体之前**就序列化实参，Proxy 内部槽不在，当场被拒。
   * （preload 里摊平是**够不着**的：哨兵实测证明那段代码压根没被调用。）
   *
   * 【为什么断言必须是 `not.toBe`】夹具不做结构化克隆，Proxy 照样能被 `toEqual` 判成相等——
   * 只写 `toEqual(["book:伏笔"])`，这个缺陷改了也照样全绿。能咬住的是**引用变了**。
   *
   * 【为什么用原生 `new Proxy` 冒充 reactive】reactive 就是 `Proxy` 包一个普通目标：
   * 能骗过 `Array.isArray`、逐项读得出、没有内部槽。这里不必为此把 Vue 拉进单测。
   */
  it("递出去的 skillPaths 摊成了普通数组——响应式 Proxy 过不了 IPC 那道门", async () => {
    await openChapter();
    const s = store();
    // 直接把一份 Proxy 塞进 state，冒充 reactive：走的是与真机完全相同的形状。
    s.skillPathsByThread[CH] = new Proxy(["book:伏笔"], {}) as unknown as string[];
    const reactive = s.skillPathsOf(CH);
    expect(Array.isArray(reactive)).toBe(true); // Proxy 骗得过这一关，所以问题不在这里暴露
    s.send("照这个技能改");
    const sent = started.at(-1)?.skillPaths as unknown;
    expect(sent, "出去的还是同一个 Proxy 引用").not.toBe(reactive);
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toEqual(["book:伏笔"]);
  });
});

describe("refreshSkills", () => {
  it("列到的表落到 store，skillsListed 置位（「还没列过」与「一个都没有」分得开）", async () => {
    listSkills.mockResolvedValueOnce([ref("book", "伏笔"), ref("global", "节奏")]);
    const s = store();
    expect(s.skillsListed).toBe(false);
    await s.refreshSkills();
    expect(s.skills.map((one) => one.id)).toEqual(["book:伏笔", "global:节奏"]);
    expect(s.skillsListed).toBe(true);
  });

  it("列失败 ⇒ 摆一句中文，**不清空已显示的那张表**（读不到不等于没有技能）", async () => {
    listSkills.mockResolvedValueOnce([ref("book", "伏笔")]);
    const s = store();
    await s.refreshSkills();
    listSkills.mockRejectedValueOnce(
      new Error("Error invoking remote method 'skills:list': Error: 磁盘没插上")
    );
    await s.refreshSkills();
    expect(s.notice).toContain("技能库没有列出来");
    expect(s.skills.map((one) => one.id)).toEqual(["book:伏笔"]);
  });
});

describe("readSkill", () => {
  it("拆得出 id ⇒ 按来源读回正文与 truncated 标志", async () => {
    const s = store();
    const got = await s.readSkill("book:伏笔");
    expect(got?.relPath).toBe("伏笔/SKILL.md");
    expect(got?.truncated).toBe(false);
  });

  it("读不到 ⇒ 摆一句中文并回 null（不留一张空白的技能卡）", async () => {
    readSkill.mockRejectedValueOnce(new Error("读不到这份技能：伏笔/SKILL.md"));
    const s = store();
    expect(await s.readSkill("book:伏笔")).toBeNull();
    expect(s.notice).toContain("这份技能没有读出来");
  });

  it("id 拆不出来 ⇒ 连盘都不碰，先说清为什么（绝不猜一个来源去读）", async () => {
    const s = store();
    expect(await s.readSkill("乱七八糟")).toBeNull();
    expect(readSkill).not.toHaveBeenCalled();
    expect(s.notice).toContain("认不出这份技能");
  });
});

/**
 * 占用条那条路同样要摊平（2026-10-07 真机撞出来的第二个同类缺陷）。
 *
 * 【为什么必须单列一组】`send` 那条有守卫，`refreshContextPreview` 这条一度**没有**——
 * 变异验证当场抓到：把 `plainList(query.pinned)` 去掉，34 条守卫全绿。
 * 原因和上一条一模一样：夹具不做结构化克隆，Proxy 被 `toEqual` 判成相等。
 * ⇒ 断言只能咬「引用变了」与「结构化克隆过得去」。
 */
describe("refreshContextPreview 出网的那份", () => {
  beforeEach(() => {
    contextPreview.mockClear();
  });

  it("pinned 摊成普通数组——占用条这条路同样过不了响应式 Proxy", async () => {
    await openChapter();
    const s = store();
    // 冒充 computed 给出来的那份响应式数组：与真机同形（Proxy，无内部槽）。
    const reactive = new Proxy(["global:chapter-intent"], {}) as unknown as readonly string[];
    await s.refreshContextPreview({
      docRelPath: "chapters/01.md",
      profileId: null,
      pinned: reactive
    });
    const sent = contextPreview.mock.calls.at(-1)?.[0].pinned as unknown;
    expect(sent, "出去的还是同一个 Proxy 引用").not.toBe(reactive);
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toEqual(["global:chapter-intent"]);
    expect(() => structuredClone(sent as unknown)).not.toThrow();
  });

  it("不传 pinned 也照样出网（pinned 在契约里是可选的）", async () => {
    await openChapter();
    const s = store();
    // 【为什么必须单列】摊平那一步以前写的是 plainList(query.pinned)，
    // 而 query.pinned 可以是 undefined —— `[...undefined]` 直接抛。
    // 偏偏这个 try 是静默的：抛了不报，数字不更新，占用条于是**悄悄留着上一次那份**，
    // 看上去像「没挂任何技能」。tsc 是靠 `?? []` 这个改动之外的那条报错链才暴露它的。
    await s.refreshContextPreview({ docRelPath: "chapters/01.md", profileId: null });
    expect(contextPreview).toHaveBeenCalled();
    expect(contextPreview.mock.calls.at(-1)?.[0].pinned).toEqual([]);
  });
});

describe("/skills 命令", () => {
  it("把中栏切到技能那一处，**不挂入任何技能**（挂入只有那颗按钮）", () => {
    const s = store();
    const layout = useLayoutStore();
    expect(layout.centerView).toBe("chat");
    s.runSlashCommand("skills", "");
    // 【5-㉛ 改钉过一次、5-㉜ 再改一次】原先钉的是 `s.skillBrowserOpen === true`（开浮层），
    // 5-㉛ 改成钉整页（`currentView === "extensions"` + 页签落技能页），
    // 5-㉜ 用户指正「侧边栏还是有的，旁边变成技能库」⇒ 改为钉**中栏**。
    // 保证没有变小的那一半：左栏不消失（currentView 仍是 workspace）、落点仍是技能那一处。
    expect(layout.currentView).toBe("workspace");
    expect(layout.centerView).toBe("skills");
    // 真正没变的那一半：打开它只是浏览，**一个技能都没挂进去**。
    expect(s.skillPathsOf(CH)).toEqual([]);
  });

  it("/plugins 命令切到中栏的插件那一处（两处共用一个中栏，但各自指名）", () => {
    store().runSlashCommand("plugins", "");
    const layout = useLayoutStore();
    expect(layout.currentView).toBe("workspace");
    expect(layout.centerView).toBe("plugins");
  });
});

describe("书级策略与线程覆盖（P0-4）", () => {
  it("老书没有 skillPolicy ⇒ 两个清单都空，与升级前「开书一个都没挂」一致", async () => {
    await openChapter();
    expect(useBookStore().meta?.skillPolicy).toBeUndefined();
    expect(store().skillPathsOf(CH)).toEqual([]);
    expect(store().hasSkillOverride(CH)).toBe(false);
  });

  it("新会话继承书级默认：没有覆盖时直接读 enabled", async () => {
    await openChapter();
    useBookStore().meta!.skillPolicy = { enabled: ["book:伏笔", "global:节奏"], disabled: [] };
    const s = store();
    expect(s.skillPathsOf(CH)).toEqual(["book:伏笔", "global:节奏"]);
    // 继承不是覆盖：界面据此标「书级默认」。
    expect(s.hasSkillOverride(CH)).toBe(false);
  });

  it("线程覆盖只影响这一条会话，**不写回书**，也不影响别的会话", async () => {
    await openChapter();
    const book = useBookStore();
    book.meta!.skillPolicy = { enabled: ["book:伏笔"], disabled: [] };
    saveMeta.mockClear();
    const s = store();
    s.toggleSkillForThread(CH, "book:伏笔");
    expect(s.skillPathsOf(CH)).toEqual([]);
    expect(s.hasSkillOverride(CH)).toBe(true);
    // 书那一份一个字没动，也没发 IPC。
    expect(book.meta?.skillPolicy?.enabled).toEqual(["book:伏笔"]);
    expect(saveMeta).not.toHaveBeenCalled();
    // 另一条会话仍继承书级默认。
    expect(s.skillPathsOf("chapters/02-b.md")).toEqual(["book:伏笔"]);
  });

  it("恢复书级默认：删掉覆盖键，回到继承状态", async () => {
    await openChapter();
    useBookStore().meta!.skillPolicy = { enabled: ["book:伏笔"], disabled: [] };
    const s = store();
    s.toggleSkillForThread(CH, "book:伏笔");
    expect(s.hasSkillOverride(CH)).toBe(true);
    s.resetSkillOverride(CH);
    expect(s.hasSkillOverride(CH)).toBe(false);
    expect(s.skillPathsOf(CH)).toEqual(["book:伏笔"]);
  });

  it("已停用的技能即便写进默认清单也不生效（默认与覆盖两条路都滤）", async () => {
    await openChapter();
    useBookStore().meta!.skillPolicy = {
      enabled: ["book:伏笔", "global:节奏"],
      disabled: ["book:伏笔"]
    };
    const s = store();
    expect(s.skillPathsOf(CH)).toEqual(["global:节奏"]);
    s.skillPathsByThread[CH] = ["book:伏笔", "global:节奏"];
    expect(s.skillPathsOf(CH)).toEqual(["global:节奏"]);
  });
});

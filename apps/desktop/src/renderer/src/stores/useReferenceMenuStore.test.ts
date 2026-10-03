/**
 * 行内引用菜单的 store 侧真身断言（#106）。
 * 判定层已有 utils/inline-reference-menu.test.ts 单测，接线层有组件级源契约测试；
 * 这一份钉的是「菜单三态在真实 store 上跑出来的结果」：条目只出自 slash-commands 的可用性闸、
 * 选中 `@` 只改草稿、选中 `/` 只走 runSlashCommand 那唯一派发口，两条都不发送（裁定 D2）。
 * 复用 agent-store-fixture：book/agent 两个 store 与 window.mochen 桩都是现成的。
 */
import { describe, expect, it } from "vitest";
import { CH, openChapter, setupAgentFixture, startTurn, store } from "./agent-store-fixture";
import { useBookStore } from "./useBookStore";
import { useLayoutStore } from "./layoutStore";
import { useReferenceMenuStore } from "./useReferenceMenuStore";

setupAgentFixture();

const menu = () => useReferenceMenuStore();
const labels = () => menu().visibleOptions.map((option) => option.label);

describe("useReferenceMenuStore · 条目来源与可用性闸", () => {
  it('summon("/")：往草稿末尾补一个 `/`，菜单随同一套行内判定自己开', async () => {
    await openChapter();
    const agent = store();
    agent.setDraft(CH, "重写这段");
    menu().summon("/");
    expect(agent.draftOf(CH)).toBe("重写这段 /");
    expect(menu().isOpen).toBe(true);
    expect(menu().trigger).toBe("/");
    expect(menu().copy?.title).toBe("调用命令");
    // 光标口信落在斜杠之后，组件据此 focus + setSelectionRange
    expect(menu().caretRequest).toBe("重写这段 /".length);
  });

  it('summon("@")：`＋` 按钮与手打 @ 开的是同一张菜单——素材那一支', async () => {
    await openChapter();
    store().setDraft(CH, "参考");
    menu().summon("@");
    expect(store().draftOf(CH)).toBe("参考 @");
    expect(menu().trigger).toBe("@");
    expect(menu().copy?.title).toBe("引用素材");
  });

  it("末尾紧贴字母时先补空格：省掉那个空格会点出一次没反应的按钮（黑名单把 path/mod 判成词内部）", async () => {
    await openChapter();
    store().setDraft(CH, "mod");
    menu().summon("/");
    expect(store().draftOf(CH)).toBe("mod /");
    expect(menu().isOpen).toBe(true);
  });

  it("末尾已经是一枚活着的触发符：再点一次只把菜单摆回来，绝不在草稿里补出第二枚残渣", async () => {
    await openChapter();
    store().setDraft(CH, "/");
    menu().summon("/");
    expect(store().draftOf(CH)).toBe("/");
    expect(menu().isOpen).toBe(true);
    expect(menu().caretRequest).toBe(1);
    store().setDraft(CH, "重写这段 /");
    menu().summon("/");
    expect(store().draftOf(CH)).toBe("重写这段 /");
    expect(menu().isOpen).toBe(true);
  });

  it("草稿以空白收尾时不补多余空格：一个字都不许多", async () => {
    await openChapter();
    store().setDraft(CH, "重写这段 ");
    menu().summon("/");
    expect(store().draftOf(CH)).toBe("重写这段 /");
  });

  it("无书那一格只列接得通的命令：/stage 被通路闸掉，/permissions 与 /resume 因无书不列", () => {
    menu().summon("/");
    expect(labels()).toEqual(["model", "status", "clear"]);
  });

  it("那一轮正在跑：只剩 model / permissions / status / clear（与 slash-commands 同一道闸，不在这里再写一份）", async () => {
    await openChapter();
    store().viewOf(CH).running = true;
    menu().summon("/");
    expect(labels()).toEqual(["model", "permissions", "status", "clear"]);
  });

  it("前缀过滤吃的是闸后的集合：有书空闲时打 sta 只剩 status，被闸掉的 stage 搜也搜不出来", async () => {
    await openChapter();
    store().setDraft(CH, "/sta");
    menu().syncFrom("/sta", 4, true);
    expect(labels()).toEqual(["status"]);
    store().setDraft(CH, "/stag");
    menu().syncFrom("/stag", 5, true);
    expect(labels()).toEqual([]);
    expect(menu().emptyText).toBe("没有匹配的命令");
  });

  it("`@` 的池就是 book store 的文档：标题来自 DocRef，kind 中文名来自 book-kinds 那张表", async () => {
    await openChapter();
    store().setDraft(CH, "参考 @");
    menu().syncFrom(store().draftOf(CH), store().draftOf(CH).length, true);
    expect(menu().trigger).toBe("@");
    expect(labels()).toEqual(["开局", "转折"]);
    expect(menu().visibleOptions[0]?.detail).toBe("章节 · chapters/01-a.md");
  });
});

describe("useReferenceMenuStore · syncFrom 的开合与高亮", () => {
  it("焦点不在 composer ⇒ 收菜单，绝不让他家屏幕上飘着这一张", async () => {
    await openChapter();
    menu().syncFrom("参考 @开", 5, true);
    expect(menu().isOpen).toBe(true);
    menu().syncFrom("参考 @开", 5, false);
    expect(menu().isOpen).toBe(false);
  });

  it("词内部的 `/`（path/mod）不是触发位：菜单不开", () => {
    menu().syncFrom("path/mod", 8, true);
    expect(menu().isOpen).toBe(false);
  });

  it("同一 token 过滤变窄 ⇒ 高亮收回还在的最后一行；换了 token ⇒ 回到第一条", async () => {
    await openChapter();
    menu().syncFrom("参考 @", 4, true);
    menu().activate(1);
    expect(menu().activeIndex).toBe(1);
    menu().syncFrom("参考 @开", 5, true);
    expect(menu().activeIndex).toBe(0);
    expect(menu().selectedOption?.label).toBe("开局");
    // 再打出一条新的 token（起点挪了）⇒ 高亮从头一条开始
    menu().syncFrom("参考 @开 与 @转", 10, true);
    expect(menu().activeIndex).toBe(0);
    expect(menu().selectedOption?.label).toBe("转折");
  });

  it("↑↓ 环绕：首条再往上落到末条，末条再往下回到首条", async () => {
    await openChapter();
    menu().summon("/");
    menu().move(-1);
    expect(labels()[menu().activeIndex]).toBe("clear");
    menu().move(1);
    expect(menu().activeIndex).toBe(0);
  });

  it("空态两档：池子空（这本书没文档）与过滤没中的文案不同", async () => {
    await openChapter();
    menu().syncFrom("参考 @zzz", 7, true);
    expect(menu().visibleOptions).toEqual([]);
    expect(menu().emptyText).toBe("没有匹配的文档");
    useBookStore().docs = [];
    menu().syncFrom("参考 @", 4, true);
    expect(menu().optionPool).toEqual([]);
    expect(menu().emptyText).toBe("这本书里还没有可引用的文档，先在左栏建一篇");
  });
});

describe("useReferenceMenuStore · select 的两型与「绝不发送」", () => {
  it("`@` 型：引用文本经 setDraft 写进这一格草稿，菜单收，一轮都不起", async () => {
    await openChapter();
    const agent = store();
    agent.setDraft(CH, "参考 @");
    menu().syncFrom(agent.draftOf(CH), agent.draftOf(CH).length, true);
    menu().activate(1);
    const result = menu().select();
    expect(result?.kind).toBe("insert");
    expect(agent.draftOf(CH)).toBe("参考 @素材：转折（chapters/02-b.md） ");
    // 后文为空 ⇒ 补的那一个空格也算进光标，插入后接着打字不会粘连
    expect(menu().caretRequest).toBe(agent.draftOf(CH).length);
    expect(menu().isOpen).toBe(false);
    expect(startTurn).not.toHaveBeenCalled();
    expect(agent.threads[CH]?.items ?? []).toEqual([]);
  });

  it("`@` 型：紧跟句读时不补空格（deepwrite 的后文判据）", async () => {
    await openChapter();
    const agent = store();
    agent.setDraft(CH, "参考 @，后面");
    menu().syncFrom(agent.draftOf(CH), 4, true);
    expect(menu().trigger).toBe("@");
    const result = menu().select();
    expect(result?.kind).toBe("insert");
    expect(agent.draftOf(CH)).toBe("参考 @素材：开局（chapters/01-a.md），后面");
  });

  it("`/` 型：token 从草稿里吃掉，命令走唯一派发口执行（/model 真打开设置浮层）", async () => {
    await openChapter();
    const agent = store();
    agent.setDraft(CH, "/mod");
    menu().syncFrom(agent.draftOf(CH), 4, true);
    expect(labels()).toEqual(["model"]);
    const result = menu().select();
    expect(result?.kind).toBe("execute");
    expect(agent.draftOf(CH)).toBe("");
    expect(useLayoutStore().currentView).toBe("settings");
    expect(menu().isOpen).toBe(false);
    // 裁定 D2 的 store 侧证据：Enter 选中一条命令既不起轮也不落转录
    expect(startTurn).not.toHaveBeenCalled();
    expect(agent.threads[CH]?.items ?? []).toEqual([]);
  });

  it("没有可选项时 select 只收菜单：草稿一字不动，也不返回结果", async () => {
    await openChapter();
    const agent = store();
    agent.setDraft(CH, "参考 @zzz");
    menu().syncFrom(agent.draftOf(CH), agent.draftOf(CH).length, true);
    expect(menu().select()).toBeNull();
    expect(agent.draftOf(CH)).toBe("参考 @zzz");
    expect(menu().isOpen).toBe(false);
  });

  it("菜单没开时 select 直接返回 null（全局键位派发到这里的空转保护）", () => {
    expect(menu().select()).toBeNull();
  });
});

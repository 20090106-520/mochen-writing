/**
 * #113c 输入卡上方「书 / 阶段」绑定条的判定真身。
 * 这一档在本仓只有一份实现：`meta.stages` 找 `activeStage` 这一段，
 * CenterColumn 的 agentLabel、book-dossier 的 stageName 与这里的 stageLabelOf 必须共用 activeStageOf
 * （铁律 6；化石先例：档位中文名曾经在 contracts 之外被抄过一遍）。
 * 阶段侧有真契约（BookMeta.stages / activeStage + bookSaveMeta 通道），所以能开真弹层；
 * 书侧没有 recent-books/资料库注册表（全仓 grep 无 recentBook/libraryRoot/book:list），
 * 因此本文件不产「书目列表」——那一格在组件里退化成一个真动作，见 composer-context-bar-wiring.test.ts 的裁定。
 */
import { describe, expect, it } from "vitest";
import type { BookMeta } from "@mochen/contracts";
import {
  activeStageOf,
  showContextBar,
  stageContextOptions,
  stageLabelOf
} from "./composer-context";

const meta: BookMeta = {
  id: "b1",
  title: "海雾手记",
  schemaVersion: 1,
  stages: [
    { id: "draft", name: "正文" },
    { id: "revise", name: "修订" },
    { id: "final", name: "定稿" }
  ],
  activeStage: "revise",
  permissionMode: "chapter-write",
  chapterOrder: []
};

describe("activeStageOf · 阶段查表唯一真身", () => {
  it("按 activeStage 取到那一档，取的是声明顺序里的对象本体", () => {
    expect(activeStageOf(meta)).toBe(meta.stages[1]);
    expect(activeStageOf(meta)?.name).toBe("修订");
  });

  it("没有作品 ⇒ null，不捏造阶段", () => {
    expect(activeStageOf(null)).toBeNull();
  });

  it("activeStage 指向不存在的档 ⇒ null（盘上手改的书不能渲染出假档名）", () => {
    expect(activeStageOf({ ...meta, activeStage: "nope" })).toBeNull();
  });

  it("只看 id，绝不拿档名当键（改档名不改绑定的那一条契约）", () => {
    const renamed: BookMeta = {
      ...meta,
      stages: meta.stages.map((s) => ({ ...s, name: `${s.id}-改名` }))
    };
    expect(activeStageOf(renamed)?.id).toBe("revise");
  });
});

describe("stageLabelOf · 绑定条与工作台共用的一格文字", () => {
  it("有档 ⇒ 档名", () => {
    expect(stageLabelOf(meta)).toBe("修订");
  });

  it("无书 / 档查不到 ⇒ 「无」，与作品资料侧同一口径，不留空格也不写死档名", () => {
    expect(stageLabelOf(null)).toBe("无");
    expect(stageLabelOf({ ...meta, activeStage: "nope" })).toBe("无");
  });
});

describe("stageContextOptions · 弹层列表只由声明的档生成", () => {
  it("按 book.json 的声明顺序出全量，不做去重也不排序", () => {
    const list = stageContextOptions(meta, false);
    expect(list.map((o) => o.id)).toEqual(["draft", "revise", "final"]);
    expect(list.map((o) => o.label)).toEqual(["正文", "修订", "定稿"]);
  });

  it("只有当前档 current 为真（恰好一枚——反向：删掉 current 判定会两枚全假）", () => {
    const list = stageContextOptions(meta, false);
    expect(list.filter((o) => o.current).map((o) => o.id)).toEqual(["revise"]);
  });

  it("busy 只翻 disabled，不摘掉当前标记：落盘期间列表仍看得出自己在哪一档", () => {
    const busy = stageContextOptions(meta, true);
    expect(busy.every((o) => o.disabled)).toBe(true);
    expect(busy.find((o) => o.id === "revise")?.current).toBe(true);
  });

  it("无书 ⇒ 空列表，弹层不渲染假档名", () => {
    expect(stageContextOptions(null, false)).toEqual([]);
  });

  it("图标固定 wand：与绑定条上那枚同一枚图标，不在列表里换含义", () => {
    expect(stageContextOptions(meta, false).every((o) => o.icon === "wand")).toBe(true);
  });

  it("detail 一律空串：本仓没有阶段级说明可填，宁缺勿造（组件按 detail 空则不渲染小字）", () => {
    expect(stageContextOptions(meta, true).every((o) => o.detail === "")).toBe(true);
  });
});

describe("showContextBar · 绑定条只在「开书 + 空线程」显形", () => {
  it("真值表四行全钉：绑定了作品且这格还没消息才显示", () => {
    expect(showContextBar({ hasBook: true, threadEmpty: true })).toBe(true);
    expect(showContextBar({ hasBook: true, threadEmpty: false })).toBe(false);
    expect(showContextBar({ hasBook: false, threadEmpty: true })).toBe(false);
    expect(showContextBar({ hasBook: false, threadEmpty: false })).toBe(false);
  });

  it("无书时不显示：没有绑定可显示，禁用的一整条是装饰不是信息", () => {
    expect(showContextBar({ hasBook: false, threadEmpty: true })).toBe(false);
  });
});

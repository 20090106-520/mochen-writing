import { beforeEach, describe, expect, it } from "vitest";
import {
  CH,
  contextPreview,
  openChapter,
  setupAgentFixture,
  started,
  store
} from "./agent-store-fixture";
import { useBibleExclusionStore } from "./useBibleExclusionStore";

/**
 * 「本轮不带」（2026-11-20 W-01 补完）：输入区芯片里点掉一条设定，只影响下一轮装配。
 *
 * 这组用例钉三件事：
 * ① 排除表按**书 id** 分开记，切书不串味；同一条点两次不叠行。
 * ② 一条没排时，`excludedBible` 整条字段缺席——请求与从前一字不差（老链路零改动）。
 * ③ 出网的是普通数组：store 里那份是响应式代理，`contextBridge` 在进 preload 前就拒 Proxy。
 */

setupAgentFixture();

const ROW = { key: "bible:character:c1", title: "林夜", typeLabel: "人物", chars: 40 };

beforeEach(() => {
  contextPreview.mockClear();
});

describe("排除表本身", () => {
  it("排除 / 恢复按书 id 分开记；同一条点两次不会叠成两行", () => {
    const exclusion = useBibleExclusionStore();
    exclusion.exclude("b1", ROW);
    exclusion.exclude("b1", ROW);
    expect(exclusion.keysOf("b1")).toEqual([ROW.key]);
    expect(exclusion.rowsOf("b2")).toEqual([]);

    exclusion.include("b1", ROW.key);
    expect(exclusion.keysOf("b1")).toEqual([]);
    // 恢复一条不在表里的：什么都不改，也不凭空造一行。
    exclusion.include("b1", ROW.key);
    expect(exclusion.rowsOf("b1")).toEqual([]);
  });

  it("标题快照跟着条目一起存：主进程不再返回它，恢复列表也有名字可显示", () => {
    const exclusion = useBibleExclusionStore();
    exclusion.exclude("b1", ROW);
    expect(exclusion.rowsOf("b1")[0]).toMatchObject({
      key: ROW.key,
      title: "林夜",
      typeLabel: "人物"
    });
  });

  it("没有书 id 的排除请求什么都不写（还没开书时点不到那一行）", () => {
    const exclusion = useBibleExclusionStore();
    exclusion.exclude("", ROW);
    expect(exclusion.keysOf("")).toEqual([]);
  });
});

describe("出网的那一份", () => {
  it("一条没排 ⇒ 整条字段缺席；排了才递 key 表", async () => {
    await openChapter();
    const exclusion = useBibleExclusionStore();

    store().send("照原样写");
    expect(started.at(-1)).not.toHaveProperty("excludedBible");

    exclusion.exclude("b1", ROW);
    store().send("这一轮不带林夜");
    expect(started.at(-1)?.excludedBible).toEqual([ROW.key]);
  });

  it("递出去的不是 store 里那份响应式数组（Proxy 过不了 IPC 那道门）", async () => {
    await openChapter();
    const exclusion = useBibleExclusionStore();
    exclusion.exclude("b1", ROW);
    store().send("继续写");
    const sent = started.at(-1)?.excludedBible;
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).not.toBe(exclusion.byBook["b1"]);
  });

  it("占用条那份同样带上排除表——数字必须是「移除后」的真数字", async () => {
    await openChapter();
    const exclusion = useBibleExclusionStore();
    exclusion.exclude("b1", ROW);
    await store().refreshContextPreview({
      docRelPath: CH,
      profileId: null,
      pinned: [],
      excludedBible: exclusion.keysOf("b1")
    });
    expect(contextPreview.mock.lastCall?.[0]?.excludedBible).toEqual([ROW.key]);
  });
});

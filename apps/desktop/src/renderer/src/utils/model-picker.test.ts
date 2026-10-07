import { describe, expect, it } from "vitest";
import {
  MODEL_GROUP_LABELS,
  MODEL_PICKER_LIST_LIMIT,
  filterModels,
  groupModels,
  modelKindOf,
  shouldRevealSelected
} from "./model-picker";

/** agnes-ai 真机拉到的 12 个（2026-10-06 实测，见 .mochen-tmp/p2/probe-agnes.mjs）。 */
const AGNES = [
  "agnes-2.5-pro-alpha",
  "agnes-video-2.5-flash",
  "agnes-3.0-flash",
  "agnes-image-2.1-flash",
  "agnes-video-2.5",
  "agnes-2.0-flash",
  "agnes-image-2.0-flash",
  "agnes-2.5-flash",
  "agnes-2.5-pro",
  "agnes-2.5-pro-beta",
  "agnes-video-v2.0",
  "agnes-image-2.5-flash"
];

describe("model-picker · 按名字猜模态", () => {
  it("agnes 那 12 个：对话 6、图像 3、视频 3", () => {
    const groups = groupModels(AGNES);
    expect(groups.map((g) => g.kind)).toEqual(["chat", "image", "video"]);
    expect(groups.find((g) => g.kind === "chat")?.items).toHaveLength(6);
    expect(groups.find((g) => g.kind === "image")?.items).toHaveLength(3);
    expect(groups.find((g) => g.kind === "video")?.items).toHaveLength(3);
  });

  it("对话那组排第一：用户是来写稿的，不是来生成图的", () => {
    expect(groupModels(AGNES)[0]?.kind).toBe("chat");
  });

  // 这条是「宁可归其它也不误判」的根据：vision 是「能看图」，不是「生成图」。
  it("vision 算对话不是图像——它是能看图的模型，写稿时反而该选它", () => {
    expect(modelKindOf("gpt-4-vision")).toBe("chat");
    expect(modelKindOf("qwen2-vl")).toBe("chat");
  });

  it("认得中英文的图像 / 视频命名", () => {
    expect(modelKindOf("stability-image-xl")).toBe("image");
    expect(modelKindOf("绘图-v3")).toBe("image");
    expect(modelKindOf("video-gen")).toBe("video");
    expect(modelKindOf("可灵-视频")).toBe("video");
  });

  // 名字里没有 image/img 这些通用词、但确实是图像/视频的知名家族，另有一张猜测表。
  it("没有通用词的知名家族也认得（dall-e / sora 那种）", () => {
    expect(modelKindOf("dall-e-3")).toBe("image");
    expect(modelKindOf("sora-2")).toBe("video");
    expect(modelKindOf("midjourney-v6")).toBe("image");
  });

  // 误判的代价不对称：把能用的对话模型说成图像，可能让人不选它。
  it("猜不出的一律算对话（默认可用），不许藏起来", () => {
    expect(modelKindOf("deepseek-chat")).toBe("chat");
    expect(modelKindOf("mochen-mock")).toBe("chat");
    expect(modelKindOf("qwen-max")).toBe("chat");
  });

  it("组标题都带「像是」：分组是猜的，不把猜测说成事实", () => {
    for (const label of Object.values(MODEL_GROUP_LABELS)) {
      if (label === MODEL_GROUP_LABELS.other) continue;
      expect(label).toContain("像是");
    }
  });
});

describe("model-picker · 分组列表", () => {
  it("同名去重：有的 hub 会把同一模型列两遍", () => {
    const groups = groupModels(["a-chat", "a-chat", "b-chat"]);
    expect(groups[0]?.items).toEqual(["a-chat", "b-chat"]);
  });

  it("空串丢掉（上游偶尔给占位项）", () => {
    expect(groupModels(["", "  ", "x-chat"])[0]?.items).toEqual(["x-chat"]);
    expect(groupModels([])).toEqual([]);
  });

  it("组内保持上游顺序，不擅自排序", () => {
    const groups = groupModels(["z-chat", "a-chat", "m-chat"]);
    expect(groups[0]?.items).toEqual(["z-chat", "a-chat", "m-chat"]);
  });

  it("只有一组时不要渲染组标题那一行（少一行噪音）", () => {
    const groups = groupModels(["only-one"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe(MODEL_GROUP_LABELS.chat);
  });
});

describe("model-picker · 搜索", () => {
  it("空查询等于不过滤", () => {
    expect(filterModels(AGNES, "")).toHaveLength(12);
    expect(filterModels(AGNES, "   ")).toHaveLength(12);
  });

  it("忽略大小写与首尾空白", () => {
    expect(filterModels(AGNES, "  AGNES-2.5  ")).toContain("agnes-2.5-pro");
  });

  it("搜不到就给空数组，不回退成全量（那会让用户以为搜索坏了）", () => {
    expect(filterModels(AGNES, "zzz")).toEqual([]);
  });

  it("搜完再分组：过滤在前，分组在后", () => {
    const groups = groupModels(filterModels(AGNES, "image"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("image");
  });
});

describe("model-picker · 选完要看得见", () => {
  const visible = ["a", "b", "c", "d", "e"];
  const row = 32;

  it("选中的在可视区内 ⇒ 不用动", () => {
    expect(shouldRevealSelected("c", visible, 0, 160, row)).toBe(false);
  });

  it("选中的在下方视口外 ⇒ 要滚进视野", () => {
    expect(shouldRevealSelected("e", visible, 0, 96, row)).toBe(true);
  });

  it("选中的在上方视口外 ⇒ 要滚回视野", () => {
    expect(shouldRevealSelected("a", visible, 160, 96, row)).toBe(true);
  });

  it("没选 / 不在列表里 / 行高非正 ⇒ 什么都不做", () => {
    expect(shouldRevealSelected("", visible, 0, 160, row)).toBe(false);
    expect(shouldRevealSelected("zz", visible, 0, 160, row)).toBe(false);
    expect(shouldRevealSelected("a", visible, 0, 160, 0)).toBe(false);
    expect(shouldRevealSelected("a", [], 0, 160, row)).toBe(false);
  });

  it("铺开上限是个真实存在的数（几百个模型的 hub 才不会把对话框撑爆）", () => {
    expect(MODEL_PICKER_LIST_LIMIT).toBeGreaterThan(0);
    expect(MODEL_PICKER_LIST_LIMIT).toBeLessThan(1000);
  });
});

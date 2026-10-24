import { describe, expect, it } from "vitest";
import {
  MODEL_PICKER_LIST_LIMIT,
  MODEL_WRITABLE_ONLY_NOTE,
  filterModels,
  isWritableModel,
  modalityLabelOf,
  modelKindOf,
  splitByCurrentModel,
  writableModels
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

  /**
   * 名字里带 video 却是对话模型的那一族（2026-10-25）。
   *
   * 这两族是「能看视频」的对话模型。若让它们落进视频那一档，就会被 `writableModels`
   * **藏掉**——而藏掉一个能用的模型正是文件头「诚实边界」里说的**危险方向**
   * （能用的说成不能用，用户从此选不到它）。
   * ⇒ 判据的顺序是硬的：先查这一族，再查通用词。
   */
  it("名字带 video 却是对话模型的家族，先于视频判据查（藏掉能用的模型是危险方向）", () => {
    expect(modelKindOf("video-llama-3-2")).toBe("chat");
    expect(modelKindOf("video-llava-1.6")).toBe("chat");
    expect(isWritableModel("video-llama-3-2")).toBe(true);
    expect(isWritableModel("video-llava-1.6")).toBe(true);
    // 反向：真的视频模型还是视频。
    expect(modelKindOf("agnes-video-2.5")).toBe("video");
  });
});

describe("model-picker · 只列写作模型（2026-10-25 用户裁定）", () => {
  /**
   * 用户原话：「我这是写小说的，应该只显示写作模型，其他的模型不显示」。
   *
   * 这一刀比 2026-10-22 那版「分组 + 行尾标记」更彻底：标记只是提醒，藏掉才是根治。
   * agnes 那 12 个里 6 个是对话、6 个是图像/视频 ⇒ 名单应当从 12 变成 6。
   */
  it("agnes 那 12 个：只留 6 个能写对话的，图像 3 个与视频 3 个一个都不列", () => {
    expect(AGNES).toHaveLength(12);
    const kept = writableModels(AGNES);
    expect(kept).toHaveLength(6);
    expect(kept).toEqual([
      "agnes-2.5-pro-alpha",
      "agnes-3.0-flash",
      "agnes-2.0-flash",
      "agnes-2.5-flash",
      "agnes-2.5-pro",
      "agnes-2.5-pro-beta"
    ]);
    expect(kept.some((name) => name.includes("image"))).toBe(false);
    expect(kept.some((name) => name.includes("video"))).toBe(false);
  });

  it("顺序照上游（不擅自排序），同名只留一个（有些 hub 把同一模型列两遍）", () => {
    expect(writableModels(["z-chat", "a-chat", "m-chat"])).toEqual(["z-chat", "a-chat", "m-chat"]);
    expect(writableModels(["a-chat", "a-chat", "b-chat"])).toEqual(["a-chat", "b-chat"]);
  });

  it("空串丢掉（上游偶尔给占位项）", () => {
    expect(writableModels(["", "  ", "x-chat"])).toEqual(["x-chat"]);
    expect(writableModels([])).toEqual([]);
  });

  /**
   * **危险方向钉死**：判据是按名字猜的，猜错就等于藏了一个能用的模型。
   * ⇒ 规矩是「宁可多列一个不能写的，也不要藏掉一个能写的」：
   * 猜不出的一律算写作（对话）。这条一旦反过来，全仓的模型名猜不准都会变成「模型不见了」。
   */
  it("猜不出的一律算写作模型：宁可多列一个，也不能藏掉一个", () => {
    expect(isWritableModel("some-new-model-2026")).toBe(true);
    expect(isWritableModel("deepseek-v3.2")).toBe(true);
    expect(isWritableModel("agnes-image-2.1-flash")).toBe(false);
  });

  /**
   * 分组那一整套（`groupModels` / `MODEL_GROUP_LABELS` / `MODEL_GROUP_CAVEAT` /
   * `MODEL_MODALITY_WARNING`）在只列写作模型之后**没有存在理由**了：只剩一段，分什么组？
   *
   * 反向钉：不许悄悄加回来 —— 那会变成第二份「名单怎么排」的判定（铁律 6），
   * 而模型选择器与设置页档案名单两处都会用上它，走偏一处就露馅。
   */
  it("分组那一整套已经撤掉了，不许再加回来（同一判定不许有第二份实现）", async () => {
    const mod = await import("./model-picker");
    for (const gone of [
      "groupModels",
      "MODEL_GROUP_LABELS",
      "MODEL_GROUP_CAVEAT",
      "MODEL_MODALITY_WARNING"
    ]) {
      expect(Object.keys(mod), `${gone} 又回来了：只列写作模型之后没有分组的理由`).not.toContain(
        gone
      );
    }
  });
});

describe("model-picker · 模态标记的文案只有一份", () => {
  it("图像 / 视频各出自己的名字；对话模型不标（那是默认）", () => {
    expect(modalityLabelOf("agnes-image-2.1-flash")).toBe("图像");
    expect(modalityLabelOf("agnes-video-2.5")).toBe("视频");
    expect(modalityLabelOf("agnes-3.0-flash")).toBe("");
  });

  // 反向钉：这一段映射原先在对话框与设置页各手写一遍（两处字面量，迟早走偏）。
  it("组件里不许再留一份 kind → 字面量的映射", () => {
    expect(modalityLabelOf("dall-e-3")).toBe("图像");
    expect(modalityLabelOf("sora-2")).toBe("视频");
  });

  /**
   * 「图像/视频模型写不了对话」这句事实只此一份（2026-10-25）。
   * 两处界面各写一遍早晚会走偏：一个说「写不了对话」、一个说「不能用来写」。
   */
  it("那句事实只有一份（空态与设置页共用）", () => {
    expect(MODEL_WRITABLE_ONLY_NOTE).toContain("图像");
    expect(MODEL_WRITABLE_ONLY_NOTE).toContain("视频");
    expect(MODEL_WRITABLE_ONLY_NOTE.length).toBeGreaterThan(0);
  });
});

describe("model-picker · 「正在用」那一行的切分", () => {
  const names = ["a-chat", "b-chat", "c-image"];

  it("当前模型在名单里 ⇒ 它进「正在用」，其余进 rest（不重复出现）", () => {
    const split = splitByCurrentModel(names, "b-chat", true);
    expect(split.current).toEqual(["b-chat"]);
    expect(split.rest).toEqual(["a-chat", "c-image"]);
  });

  it("当前模型不在名单里（手填的模型名上游未必列得出来）⇒ 它照样进「正在用」", () => {
    const split = splitByCurrentModel(names, "hand-typed", true);
    expect(split.current).toEqual(["hand-typed"]);
    expect(split.rest).toEqual(names);
  });

  it("不摆它的时候（搜着且它不匹配）⇒ 名单原样交出去，一个都不许少", () => {
    const split = splitByCurrentModel(names, "b-chat", false);
    expect(split.current).toEqual([]);
    // 注意：这里 rest 仍含 b-chat —— 不摆「正在用」不等于把它从名单里剔掉。
    // （先前那版无条件剔除，于是「不摆它」时那一枚凭空消失：那是藏模型的形状。）
    expect(split.rest).toEqual(names);
  });

  it("没有当前模型 ⇒ 不开这一段", () => {
    const split = splitByCurrentModel(names, "", true);
    expect(split.current).toEqual([]);
    expect(split.rest).toEqual(names);
  });

  it("当前模型即使被 rest 排除，也**只**出现在 current 那一段里（不重复）", () => {
    const split = splitByCurrentModel(["x", "y"], "x", true);
    expect(split.current).toEqual(["x"]);
    expect(split.rest).toEqual(["y"]);
    expect([...split.current, ...split.rest].filter((n) => n === "x")).toHaveLength(1);
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

  it("搜的是**写作模型**那份名单（过滤发生在筛掉不能写的之后）", () => {
    // 「image」在上游名单里有三个，但它们已经被 `writableModels` 筛掉了，
    // 所以在写作名单里搜「image」应当**搜不到**。
    expect(filterModels(writableModels(AGNES), "image")).toEqual([]);
    expect(filterModels(writableModels(AGNES), "pro")).toHaveLength(3);
  });
});

describe("model-picker · 铺开上限", () => {
  it("铺开上限是个真实存在的数（几百个模型的 hub 才不会把对话框撑爆）", () => {
    expect(MODEL_PICKER_LIST_LIMIT).toBeGreaterThan(0);
    expect(MODEL_PICKER_LIST_LIMIT).toBeLessThan(1000);
  });

  /**
   * 【2026-10-25 删掉 `shouldRevealSelected` 的根据】
   * 那条「选中的要滚进视野」本来是给「当前模型混在名单里」准备的——
   * 2026-10-25 当前模型**单开一段摆在最上面**，永远在第一屏 ⇒ 「把它滚进来」这件事不存在了，
   * 于是那个函数连同它的用例一起成了**没人调用的死代码**（改之前全仓只有它自己的用例在用）。
   * 死代码 + 一份只测它的测试 = 下一位以为它还有用 ⇒ 一起删掉。
   * 真正在滚的是高亮那一行：`useListHighlight` 的 `reveal()`。
   */
  it("「滚进视野」现在归键盘高亮管，不再有一份独立的判据（死代码已删）", async () => {
    const mod = await import("./model-picker");
    expect(Object.keys(mod)).not.toContain("shouldRevealSelected");
  });
});

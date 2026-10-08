/**
 * 皮肤广场的浏览状态机（2026-10-08 批次 5-㊷ 补的预览与对比两半）。
 *
 * 【为什么单开一份 store 用例】
 * 预览与对比的**判据**都在这份 store 里（`overlayIsOpen` / `isComparing` / `closeTopLayer`），
 * 而 Esc 那条链读的就是它们。这一半是能真跑的（Pinia 直读），
 * 所以钉在这里；「页面有没有真的调它们」在 appearance-skin-plaza-wiring.test.ts（读源码那一半）。
 * 把两者混在一份里，纯函数那一半就会被 .vue 的读源码断言淹掉——那是本仓拆文件的既有口径。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AppearanceSkin } from "../composables/appearanceSkins";
import { appearanceSkins } from "../composables/appearanceSkins";
import { useSkinBrowseStore } from "./useSkinBrowse";

/* 广场此刻只有两套带画皮（5-㊷ 把没画的那批下架了）；
   需要「第三套」的判据都不靠表凑数——见下面 FIFO 那条的理由。 */

/** 表不足两套就直接抛错：本仓开了 `noUncheckedIndexedAccess`，
 *  解构出来是 `| undefined`，而「用 `!` 或兜底把它压掉」会把**表被改空**这件事
 *  伪装成一条看不出根因的类型断言。这一族用例只需要两套，所以判据也只有「至少两套」。 */
function twoSkins(): [AppearanceSkin, AppearanceSkin] {
  const [a, b] = appearanceSkins;
  if (a === undefined || b === undefined) {
    throw new Error("皮肤表不足两套：并排对比这一族用例没有素材可跑");
  }
  return [a, b];
}
const [first, second] = twoSkins();

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useSkinBrowse · 整窗预览", () => {
  it("预览只是一枚记号：set / toggle / clear 三种开合，再点同一枚 = 退出", () => {
    const browse = useSkinBrowseStore();
    browse.setPreview(first.id);
    expect(browse.previewId).toBe(first.id);
    expect(browse.previewSkin?.id).toBe(first.id);

    browse.togglePreview(first.id);
    expect(browse.previewId).toBeNull();

    browse.togglePreview(second.id);
    browse.clearPreview();
    expect(browse.previewSkin).toBeNull();
  });

  it("残留的 id 查不到时视为**没在预览**，绝不兜底成某一套", () => {
    const browse = useSkinBrowseStore();
    browse.setPreview("skin_that_no_longer_exists");
    // 兜底成 appearanceSkins[0] 会怎样：皮肤表改过之后，一次没人管的残留把整窗刷成另一套，
    // 而屏幕上没有任何一句解释。
    expect(browse.previewSkin).toBeNull();
    // 同一条判据也管着 Esc：看不见的那一层不算开着，不许白吃一次按键。
    expect(browse.overlayIsOpen).toBe(false);
  });
});

describe("useSkinBrowse · 并排对比", () => {
  /**
   * 【为什么这一族用合成 id，不拿皮肤表凑三套】
   * `toggleCompare` 记的是 id，不查表（查表在 `compareSkins` 那一步）；
   * 而广场此刻只有两套带画皮（5-㊷ 刚把没画的那批下架）。
   * 拿 `appearanceSkins.length < 3` 当跳过条件的写法我一开始就写了，跑出来是**如实的红**——
   * 那是把「表里有几套」当成了「这条判据测不测得了」，而上限两套这件事与表长什么样无关。
   * 表不足时的真实风险由另一条守分管（appearance-skins.test.ts 钉的是表非空与逐套齐全）。
   */
  it("上限两套：第三枚挤掉最早那一枚（FIFO），而不是拒绝点击", () => {
    const browse = useSkinBrowseStore();
    browse.toggleCompare("a");
    browse.toggleCompare("b");
    expect(browse.compareIds).toEqual(["a", "b"]);

    browse.toggleCompare("c");
    expect(browse.compareIds).toEqual(["b", "c"]);

    // 反向：上限不许被「点第三枚时拒绝」代替——拒绝点击在界面上是哑的。
    expect(browse.compareIds).not.toEqual(["a", "b"]);
  });

  it("点已勾的那枚 = 移出对比；勾满两套才算「在对比」", () => {
    const browse = useSkinBrowseStore();
    expect(browse.isComparing).toBe(false);

    browse.toggleCompare(first.id);
    // 只有一套时并排出两块空气没有意义，所以对比栏此刻还不该出现。
    expect(browse.isComparing).toBe(false);

    browse.toggleCompare(second.id);
    expect(browse.isComparing).toBe(true);

    browse.toggleCompare(second.id);
    expect(browse.compareIds).toEqual([first.id]);
    expect(browse.isComparing).toBe(false);
  });

  it("compareSkins 丢掉查不到的那一条（同预览的判据，不留空气块）", () => {
    const browse = useSkinBrowseStore();
    browse.$patch({ compareIds: [first.id, "ghost"] });
    expect(browse.compareSkins.map((one) => one.id)).toEqual([first.id]);
  });
});

describe("useSkinBrowse · Esc 收的是最外那一层", () => {
  it("预览与对比都开着：一次只退预览，对比栏留着", () => {
    const browse = useSkinBrowseStore();
    browse.toggleCompare(first.id);
    browse.toggleCompare(second.id);
    browse.setPreview(second.id);

    browse.closeTopLayer();
    expect(browse.previewId).toBeNull();
    expect(browse.compareIds).toHaveLength(2);

    browse.closeTopLayer();
    expect(browse.compareIds).toEqual([]);
    expect(browse.overlayIsOpen).toBe(false);
  });

  /* 只勾了一套时 `overlayIsOpen` 为假，Esc 那条链根本走不到 closeTopLayer
     （裁决在 escape-policy，实参在 useHotkeys，都读的是这一句）。
     所以这一条钉的是**判据**而不是收层动作：一套不算开着，不许白吃一次 Esc。 */
  it("只勾一套：不算「开着」，Esc 那一层不该出现", () => {
    const browse = useSkinBrowseStore();
    browse.toggleCompare(first.id);
    expect(browse.overlayIsOpen).toBe(false);
    expect(browse.isComparing).toBe(false);
  });

  it("什么都没开时 closeTopLayer 不改任何可见状态", () => {
    const browse = useSkinBrowseStore();
    browse.closeTopLayer();
    expect(browse.previewId).toBeNull();
    expect(browse.compareIds).toEqual([]);
  });

  it("离开广场：预览与对比一起收干净", () => {
    const browse = useSkinBrowseStore();
    browse.setPreview(first.id);
    browse.toggleCompare(first.id);
    browse.toggleCompare(second.id);

    browse.leaveGallery();
    expect(browse.previewId).toBeNull();
    expect(browse.compareIds).toEqual([]);
    expect(browse.overlayIsOpen).toBe(false);
  });

  it("预览或对比任一开着，overlayIsOpen 才为真（Esc 那条链只读这一句）", () => {
    const browse = useSkinBrowseStore();
    expect(browse.overlayIsOpen).toBe(false);
    browse.setPreview(first.id);
    expect(browse.overlayIsOpen).toBe(true);
    browse.clearPreview();
    browse.toggleCompare(first.id);
    browse.toggleCompare(second.id);
    expect(browse.overlayIsOpen).toBe(true);
  });

  it("筛选条件与预览/对比互不影响（离开页面才收浮层，清空条件不该退预览）", () => {
    const browse = useSkinBrowseStore();
    browse.setPreview(first.id);
    browse.setFilter("art", "abyss-hall-night");
    browse.clearConditions();
    expect(browse.previewId).toBe(first.id);
    expect(browse.conditions.art).toBe("");
  });
});

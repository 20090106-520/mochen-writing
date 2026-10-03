/**
 * 右栏两张文案表的唯一真身（修复轮 F5 / 评审 Minor #8）。
 * 为什么住 `.ts`：本仓 verify 用裸 `tsc`，`.vue` 的 `<script setup>` 既不进类型程序、也没有任何运行时覆盖
 * ⇒ 原先两张表写在 `DocumentPane.vue` 里，「作品资料」改个名能全绿通过。
 * 文案逐字与顺序在这里钉死，`.vue` 只 import 与渲染（与 `SNIPPET_LABELS` 同姿态）。
 */
import { describe, expect, it } from "vitest";
import { BAND_LABELS, VIEW_TABS } from "./right-pane-labels";

describe("right-pane-labels（三态文案唯一真身，铁律 6）", () => {
  it("BAND_LABELS 的键集恰是右栏三态，不多一枚也不少一枚", () => {
    expect(Object.keys(BAND_LABELS).sort()).toEqual(["browse", "dossier", "manuscript"]);
  });

  it("三枚页签的中文逐字钉死，mode 顺序就是右栏渲染顺序", () => {
    expect(VIEW_TABS.map((tab) => tab.label)).toEqual(["文稿", "浏览", "作品资料"]);
    expect(VIEW_TABS.map((tab) => tab.mode)).toEqual(["manuscript", "browse", "dossier"]);
  });

  it("两张表不许各自漂移：每个页签的 mode 都能从 BAND_LABELS 取到非空带名", () => {
    expect(VIEW_TABS.every((tab) => BAND_LABELS[tab.mode].length > 0)).toBe(true);
  });
});

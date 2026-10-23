/**
 * 素材库面板（2026-10-23）。
 *
 * 【为什么另立一个 store】与人物核对 / 时间线核对 / 伏笔台账同一个位置：`useBookStore` 管的是
 * 「当前打开的那一篇」，而素材库要列的是**全书 `materials/` 下的每一篇**——它不随当前标签变。
 *
 * 【为什么这一格只有一个布尔】清单不在这里存第二份：它直接从 `book.docs` 派生
 * （`docs` 已是扫描后的事实，kind === "material" 就是素材库）。存一份就是第二本账，
 * 迟早出现「盘上删了、面板还在」。
 */
import { defineStore } from "pinia";

export const useMaterialStore = defineStore("material", {
  state: () => ({
    /** 浮层是否开着。挂在那枚右栏头部按钮上（与人物核对同一套路子）。 */
    open: false
  }),

  actions: {
    toggle(): void {
      this.open = !this.open;
    },

    close(): void {
      this.open = false;
    }
  }
});

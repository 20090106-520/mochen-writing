import { describe, expect, it } from "vitest";
import { compileSfcSource } from "./sfc-compile";

/**
 * SFC 静态关卡的判据本身（2026-10-09 全仓扫描 P1-11）。
 *
 * 病灶：`.vue` 完全不进类型程序（`tsc --listFiles` 里 .vue 计数 = 0），模板与 props 零静态检查，
 * 165 个渲染层文件的正确性靠 65 份"读源码做正则断言"的守卫撑着——守卫一旦被重构换写法就漏检，
 * 台账 5-㊺ 那个「能添加不能切换」的 bug 正是这么躲过三道门的。
 *
 * 这一份补的是最便宜也最硬的那一格：**用 Vue 自己的编译器把每个 SFC 真编译一遍**。
 * 模板语法错、表达式语法错、`<script setup>` 里的重复声明、defineProps 形状不合法——
 * 全部会在编译期当场红，而不是等运行时白屏。
 * 诚实的边界：编译器只到**语法与绑定**这一层，不做类型检查（类型检查要 `vue-tsc`，本仓现在没有这个依赖，
 * 也没在离线环境里装得上）；所以 P1-11 里「props 全 any」那一半仍然开着，见台账。
 */
describe("compileSfcSource · SFC 编译关卡", () => {
  it("一个合法的最小 SFC 编译通过，且拿得到模板产物", () => {
    const result = compileSfcSource(
      `<script setup lang="ts">\nconst x = 1;\n</script>\n<template><p>{{ x }}</p></template>\n`,
      "Ok.vue"
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.templateCode).toContain("x");
  });

  it("模板语法错（未闭合的插值）必须当场红，而不是悄悄生成一份废码", () => {
    const result = compileSfcSource(`<template><p>{{ x }}</p><div></template>\n`, "BadTag.vue");
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("BadTag.vue");
  });

  it("模板表达式语法错必须红（正则守卫看这种字符串永远看不出问题）", () => {
    const result = compileSfcSource(
      `<script setup lang="ts">const a = 1;</script>\n<template><p>{{ a + }}</p></template>\n`,
      "BadExpr.vue"
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("<script setup> 里重复声明同一个名字必须红", () => {
    const result = compileSfcSource(
      `<script setup lang="ts">const a = 1;\nconst a = 2;</script>\n<template><p>{{ a }}</p></template>\n`,
      "Dup.vue"
    );
    expect(result.ok).toBe(false);
  });

  it("红信息里要带文件名：整仓扫 165 个文件时，说不出是哪个文件的红等于没红", () => {
    const result = compileSfcSource(`<template><p>{{ }</template>\n`, "Named.vue");
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("Named.vue");
  });

  it("没有 <template> 块不算红（纯逻辑型 SFC 与自定义块在仓里是合法形状）", () => {
    const result = compileSfcSource(`<script setup lang="ts">const a = 1;</script>\n`, "NoTpl.vue");
    expect(result.ok).toBe(true);
  });
});

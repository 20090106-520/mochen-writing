/// <reference types="node" />
/**
 * `.vue` 源码读取器（铁律 6：同一件事不留第二份实现）。
 * 本仓零 jsdom / @vue/test-utils，模板与接线的正确性只能靠「读源文件断言字符串」的源码契约测试来钉；
 * 这类读取原先在 utils/hotkey-markers.test.ts 与 components/left-sidebar-nav.test.ts 各写了一份，
 * 后一份还不剥注释——于是**只活在注释里的字符串也能让断言变绿**。这里收为一份，行为以 hotkey 那份为准：
 * ① 抽 `<template>` 后剥 HTML 注释；② 抽 `<script setup lang="ts">` 后剥块注释与行注释；
 * ③ 原文读取（不剥）只留给「全仓普查」型断言。抽取失败一律抛错，不静默返回空串——
 * 空串会让所有 toContain 断言一起变红，看不出真正缺的是哪一块。
 * ESM 没有 __dirname，路径一律由 import.meta.url 解出：`../` 回到 renderer/src，
 * 调用方传的是相对 src 的片段（如 "components/LeftSidebar.vue"）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 整份 SFC 原文，不剥注释：普查型断言（数出现次数、比对整文件字面量）用这个。 */
export function vueSource(componentPathRelativeToRendererSrc: string): string {
  const path = fileURLToPath(new URL(`../${componentPathRelativeToRendererSrc}`, import.meta.url));
  return readFileSync(path, "utf8");
}

/** 顶层 `<template>` 内容，HTML 注释已剥掉：标记名/属性/文案只有真写在标记里才算数。 */
export function templateSource(componentPathRelativeToRendererSrc: string): string {
  const match = /<template>([\s\S]*)<\/template>/.exec(
    vueSource(componentPathRelativeToRendererSrc)
  );
  if (match === null || match[1] === undefined) {
    throw new Error(`${componentPathRelativeToRendererSrc} 里没有 <template> 块`);
  }
  return match[1].replace(/<!--[\s\S]*?-->/g, "");
}

/** `<script setup lang="ts">` 内容，块注释与行注释已剥掉：注释里写着 needle 不等于真做了这件事。 */
export function scriptSource(componentPathRelativeToRendererSrc: string): string {
  const body = /<script setup lang="ts">([\s\S]*?)<\/script>/.exec(
    vueSource(componentPathRelativeToRendererSrc)
  )?.[1];
  if (body === undefined) {
    throw new Error(`${componentPathRelativeToRendererSrc} 里没有 <script setup lang="ts"> 块`);
  }
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

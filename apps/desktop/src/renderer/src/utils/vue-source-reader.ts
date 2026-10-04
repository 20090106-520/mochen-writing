/// <reference types="node" />
/**
 * 源码读取器（铁律 6：同一件事不留第二份实现）：`.vue` 的三段与 `styles/` 下的样式表都从这里读。
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

/** 剥掉块注释与行注释：SFC 的 script 段与散装 `.ts` 共用这一份剥法（铁律 6）。 */
function stripJsComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** `<script setup lang="ts">` 内容，块注释与行注释已剥掉：注释里写着 needle 不等于真做了这件事。 */
export function scriptSource(componentPathRelativeToRendererSrc: string): string {
  const body = /<script setup lang="ts">([\s\S]*?)<\/script>/.exec(
    vueSource(componentPathRelativeToRendererSrc)
  )?.[1];
  if (body === undefined) {
    throw new Error(`${componentPathRelativeToRendererSrc} 里没有 <script setup lang="ts"> 块`);
  }
  return stripJsComments(body);
}

/**
 * 散装 `.ts`（store、utils、composable）的代码本体，注释已剥掉——和 `scriptSource` 同一条理由：
 * 用整份原文去做 `not.toContain` 会被注释反咬（「这里没有 recent-books」这句话本身就写着 recent-books），
 * 而做 `toContain` 时注释里的宣称又能把没做的事判成绿。
 * 局限照抄 `scriptSource`：行注释剥法是 `//` 到行尾，源文件里带 `//` 的字符串（URL）会被吃掉后半行——
 * 现有断言涉及的 `.ts` 都没有这种字符串（加之前先 grep）。
 */
export function typeScriptSource(pathRelativeToRendererSrc: string): string {
  return stripJsComments(vueSource(pathRelativeToRendererSrc));
}

/**
 * 数 needle 出现的次数（铁律 6：原先 inline-reference-menu-wiring.test.ts 里自带一份）。
 * 存在的理由：`toContain` 只证明「至少一处写过」，两栏各渲染一次同一件东西时，
 * 其中一栏漏掉那件东西它照样绿——变异实验实测过（左栏 chip 循环的下拉三角整行删掉，
 * 22 条断言全过）。需要「每条循环都带全这一件套」的场合只能数次数。
 */
export function countNeedle(needle: string, haystack: string): number {
  if (needle === "") throw new Error("空针串数不出意义");
  return haystack.split(needle).length - 1;
}

/** 读 `styles/` 下的一份样式表原文（`file` 只写文件名）。CSS 没有类型关卡，规则只能这样钉。 */
export function styleSource(file: string): string {
  return readFileSync(new URL(`../styles/${file}`, import.meta.url), "utf8");
}

/**
 * 一条规则的正文（大括号以内）。原先 composer-card-wiring 与 inline-reference-menu-wiring 各写一份，
 * 这里收为第三份之前的那一份（铁律 6）。
 * 找不到规则一律抛错：返回空串会让后面每条 `toContain` 一起变绿，看不出缺的是哪条规则。
 */
export function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`样式表里找不到规则 ${selector}`);
  }
  return match[1];
}

/** #105 起从 deepwrite 照搬的输入卡样式全部住在这一枚分段标记之后。 */
export const CARD_STYLE_MARKER = "deepwrite-composer-card";

/**
 * 从分段标记切到文件末尾：照搬段的色值字面量关卡只扫这一段。
 * 标记不在文件里就抛错：静默返回整份 CSS 会让「这一段没有写死色值」的断言假绿。
 */
export function cardSection(file: string, marker: string = CARD_STYLE_MARKER): string {
  const css = styleSource(file);
  const at = css.indexOf(marker);
  if (at === -1) {
    throw new Error(`styles/${file} 里必须有 ${marker} 分段标记`);
  }
  return css.slice(at);
}

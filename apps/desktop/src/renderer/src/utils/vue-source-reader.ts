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
import { readFileSync, readdirSync } from "node:fs";
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
 * SFC 里 `<style scoped>`（或 `<style>`）的正文，注释已剥。
 *
 * **为什么需要**：16 个历史组件把样式内联在 SFC 里（55 个里占 16），它们的样式正确性同样钉不到，
 * 而 `styleSource` 只读 `styles/` 目录下的表——对着内联块它会直接抛错。CSS 没有类型关卡，
 * 「模板里用了某个 class、规则忘了写」这类错只有把两边对着读才抓得到
 * （批次 4-② 的 `.review-score-fineprint` 就是这么抓出来的：删了模板留了 CSS，反过来也一样）。
 *
 * 注释要剥的理由与 `ruleBlock` 相同：CSS 注释里那句「padding 是必须的」会把
 * 「规则里真的写了 padding」这条断言喂饱。
 */
export function scopedStyleSource(componentPathRelativeToRendererSrc: string): string {
  const body = /<style[^>]*>([\s\S]*?)<\/style>/.exec(
    vueSource(componentPathRelativeToRendererSrc)
  )?.[1];
  if (body === undefined) {
    throw new Error(`${componentPathRelativeToRendererSrc} 里没有 <style> 块`);
  }
  return stripJsComments(body);
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
 * 同一张样式表，**块注释已剥**——给「整份否定断言」用。
 *
 * **为什么需要**：`styleSource` 给的是原文，于是「这里没有 X」会被注释里那句
 * 「这里以前是 X，5-⑳ 删了」直接反咬。2026-10-06 批次 5-⑳ 实测：
 * 刚把 `.save-state` 两条规则删干净、并顺手在原地留了一段说明为什么删的注释，
 * `expect(css).not.toContain(".save-state.is-dirty")` 立刻红——红的正是那句注释。
 * 典型症状是断言信息里打出来的是一段人话而不是选择器。
 *
 * 为什么不在调用方写 `replace(/\/\*[\s\S]*?\*\//g, "")`：那是剥法的第二份实现
 * （铁律 6）。剥法只有 `stripJsComments` 这一份，这里只是把它暴露出去。
 */
export function strippedStyleSource(file: string): string {
  return stripJsComments(styleSource(file));
}

/**
 * 一条规则的正文（大括号以内，**注释已剥、首尾空白已剥**）。原先 composer-card-wiring 与 inline-reference-menu-wiring
 * 各写一份，这里收为第三份之前的那一份（铁律 6）。
 * 找不到规则一律抛错：返回空串会让后面每条 `toContain` 一起变绿，看不出缺的是哪条规则。
 * 为什么要 trim：`not.toBe("")` 这类「规则不许是空壳」的断言，挡不住 `selector {\n}`——正文是换行不是空串，
 * 空壳照样绿（#113d 的 M12 实测就是这样活下来的）。trim 之后空壳读出 `""`，断言才有鉴别力。
 * 为什么连注释一起剥：`styleSource` 读的是原文，规则正文里那几行「flex: none 是必须的」
 * 会把「规则里真的写了 flex: none」这条断言喂饱——2026-10-05 实测：把真的那行删掉，13 条断言照样全绿。
 * 剥法直接复用上面那个 `stripJsComments`（CSS 里 `//` 本来就不是注释，剥了也无害）。
 */
export function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null || match[1] === undefined) {
    throw new Error(`样式表里找不到规则 ${selector}`);
  }
  return stripJsComments(match[1]).trim();
}

/**
 * 模板里带某个 class 的标签，其**属性串**（`<tag …>` 的 `…`，不含标签名与尖括号）。
 *
 * **为什么需要它**：`toContain(整个模板, ":disabled 里要有 chapter.isLoose")` 这种写法分辨不出
 * 「在按钮的禁用条件里」和「在旁边的提示文案里」——同一个字符串在别处出现一次，断言就饱了。
 * 2026-10-06 变异实测就是这样活下来的：把 `chapter.isLoose` 从 `:disabled` 里删掉，
 * 面板照样把 loose 节标出来（提示文案还在），`volume-outline-wiring.test.ts` 22 条全绿。
 * 而且 prettier 会把 `:disabled` 折成多行，按行 grep 同样不成立——只有「按标签切开取属性」才稳。
 *
 * 切标签时**跳过引号内的 `>`**：属性值里出现比较符（`:disabled="a > b"`）不该把标签截断。
 * 一个标签都没找到就抛错：返回空数组会让「至少有一个」这类断言假绿。
 */
export function tagAttributes(template: string, className: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/<([a-zA-Z][\w-]*)\b/g)) {
    if (m.index === undefined) continue;
    let i = m.index + m[0].length;
    let quote = "";
    while (i < template.length) {
      const ch = template[i];
      if (quote !== "") {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      i += 1;
    }
    const attrs = template.slice(m.index + m[0].length, i);
    if (new RegExp(`class="[^"]*\\b${className}\\b`).test(attrs)) out.push(attrs);
  }
  if (out.length === 0) {
    throw new Error(`模板里找不到 class 含 ${className} 的标签`);
  }
  return out;
}

/**
 * `components/` 下的全部 `.vue`，**按文件名排序**。
 *
 * 【为什么需要它】有些问题只有**枚举整族**才答得上来：批次 5-㊵ 要问的是
 * 「凡是宣称 role="dialog" / aria-modal 的组件，焦点与 Esc 的真身接上了没有」。
 * 手写一份名单的写法，恰恰是 5-㊱ 与 5-㊲ 漏掉 ToolRoster 与八份贴 chip 下拉的原因——
 * 那两批都是按**族**扫的，而族是按根类名（`.dialog-backdrop` / `.xxx-overlay`）认的，
 * 于是根类名 `.tool-roster-mask` 的那一枚与 `.change-history` 那一族两批都不属于。
 * 名单只认名单里有的；目录不会。
 *
 * 返回值是**相对 src 的片段**（与 `vueSource` 的入参同一形状），所以调用方读文件时仍走本模块。
 */
export function listComponentFiles(): string[] {
  return readdirSync(fileURLToPath(new URL("../components/", import.meta.url)))
    .filter((name) => name.endsWith(".vue"))
    .sort()
    .map((name) => `components/${name}`);
}

/**
 * CSS 里每一条规则的**前导串与正文**（嵌套在 `@media` 里的内层规则也一并给出）。
 *
 * 【为什么需要它】守卫要回答「某个选择器在不在**关掉动效的那几段**里」这类问题，
 * 而那几段的正文都是 `{ animation: none !important; }`——只看字符串的话，
 * 「出现在别处的一句注释」与「真的写在那条规则里」分不开。这与 `ruleBlock` 同族，
 * 区别是它一次给**全部**规则、且保留前导串（`ruleBlock` 只给一条的正文）。
 *
 * 每帧记下「**下一个兄弟的前导串从哪儿起算**」：本层上一条规则收尾的 `}` 之后。
 * 两种起点混着来就会量错东西——嵌套规则若从**外层那一圈 `{`** 起算，
 * 前导串会变成「上一条兄弟的整条规则 + 本条的选择器」，
 * 于是「有没有 `@media` 闸」「有没有 opacity 0.7 那一档」这类问题永远量不到。
 * （本函数第一版就踩了这个：嵌套里的第二条规则量出来是一大坨。）
 *
 * 调用方要自己按需过滤：以 `@` 开头的是 at-rule 前奏（`@media` 本身也是一条），
 * 它那条的正文会把内层规则的正文整段裹进去。
 */
export function cssRules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const stack: { start: number; from: number; nextSibling: number }[] = [];
  let rootNextSibling = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "{") {
      const parent = stack[stack.length - 1];
      const from = parent === undefined ? rootNextSibling : parent.nextSibling;
      stack.push({ start: i + 1, from, nextSibling: i + 1 });
      continue;
    }
    if (css[i] === "}" && stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) continue;
      const parent = stack[stack.length - 1];
      // 本层的下一条兄弟从**这条的收尾之后**起算。
      if (parent === undefined) rootNextSibling = i + 1;
      else parent.nextSibling = i + 1;
      out.push({
        selector: css.slice(frame.from, frame.start - 1).trim(),
        body: css.slice(frame.start, i)
      });
    }
  }
  return out;
}

/** #105 起从 deepwrite 对齐的输入卡样式全部住在这一枚分段标记之后。 */
export const CARD_STYLE_MARKER = "deepwrite-composer-card";
/**
 * 从分段标记切到文件末尾：对齐段的色值字面量关卡只扫这一段。
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

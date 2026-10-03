/// <reference types="node" />
/**
 * 源码契约测试（评审 X4a）：本仓没有 jsdom / @vue/test-utils，模板层的标记正确性够不着运行时断言。
 * 于是改用 node:fs 直接读 .vue 源——Task 7 最怕的静默失败模式（改一处标记名不红不坏、键位整体失灵）
 * 在这里变成可失败的断言：
 * ① 五个标记名各钉一次字面量；② 模板里必须**以属性形态**出现这些名字（剥掉 HTML 注释，写在注释里不算）；
 * ③ 全渲染层 src 的 `document.addEventListener("keydown"` 有且只有一处且就在 useHotkeys.ts（裁定 G5）；
 * ④ ComposerBox 的 textarea 必须以 v-model 绑定，退回 `:value` + `@input` 即红（评审 T4-1：IME 组合守卫）。
 * ESM 没有 __dirname，路径一律由 import.meta.url 解出。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARD_ID_ATTR,
  CARD_MARKER,
  CARD_STATUS_ATTR,
  COMPOSER_MARKER,
  GUIDANCE_MARKER
} from "./hotkey-markers";
import { scriptSource, templateSource } from "./vue-source-reader";

/** src/renderer/src —— 本文件所在 utils 的上一级。 */
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));

/** 以「属性名」形态命中：前界为行首/空白/冒号（:data-* 绑定），后界为空白/=/>。 */
function hasAttribute(markup: string, name: string): boolean {
  return new RegExp(`(^|[\\s:>])${name}([\\s=>]|$)`, "m").test(markup);
}

/** 取 <textarea> 的开标签：只有真绑在这里的属性才算数（注释与脚本里的同名字串都不算）。 */
function textareaTag(relPath: string): string {
  const tag = /<textarea\b[^>]*>/.exec(templateSource(relPath))?.[0];
  if (tag === undefined) throw new Error(`${relPath} 的模板里没有 <textarea>`);
  return tag;
}

/** 递归列渲染层源码；跳过 *.test.ts——契约测试自己写着 needle 字符串，不该被自己数进去。 */
function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function countOccurrences(needle: string): { file: string; count: number }[] {
  const hits: { file: string; count: number }[] = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const text = readFileSync(file, "utf8");
    let count = 0;
    let index = text.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = text.indexOf(needle, index + needle.length);
    }
    if (count > 0) hits.push({ file: file.replace(/\\/g, "/"), count });
  }
  return hits;
}

describe("hotkey-markers · 模板必须真的带着这些标记名（评审 X4a）", () => {
  it("五个标记名钉一次字面量：改名要同时过模板契约与这两行，不存在静默的一半", () => {
    expect(COMPOSER_MARKER).toBe("data-mochen-composer");
    expect(CARD_MARKER).toBe("data-proposal-card");
    expect(CARD_ID_ATTR).toBe("data-proposal-id");
    expect(CARD_STATUS_ATTR).toBe("data-proposal-status");
    expect(GUIDANCE_MARKER).toBe("data-guidance");
  });

  it("ComposerBox 的模板属性里有 data-mochen-composer", () => {
    expect(hasAttribute(templateSource("components/ComposerBox.vue"), COMPOSER_MARKER)).toBe(true);
  });

  it("ProposalCard 的模板属性里有卡/id/status/guidance 四枚标记", () => {
    const markup = templateSource("components/ProposalCard.vue");
    for (const name of [CARD_MARKER, CARD_ID_ATTR, CARD_STATUS_ATTR, GUIDANCE_MARKER]) {
      expect(hasAttribute(markup, name)).toBe(true);
    }
  });

  /**
   * 评审 Important 1（F1）反向保护：删掉的 `running` prop 与 `interrupt` 发射不许化石化回来。
   * `scriptSource` 会剥掉块注释与行注释，所以「只活在注释里的 interrupt」骗不过这条断言。
   * 变异证明（先提交再变异）：把卡的 `emit("decide", …)` 改名为 `emit("interrupt", …)` ⇒ 下面
   * 的 `toContain('emit("decide"')` 当场转红——卡唯一真正发射的事件名就是 decide，改错等于批准链断线。
   */
  it("ProposalCard 只发射 decide，running/interrupt 两枚化石不许回来（F1）", () => {
    const script = scriptSource("components/ProposalCard.vue");
    expect(script).toContain('emit("decide"');
    expect(script).not.toContain("interrupt");
    expect(script).not.toContain("running");
  });
});

describe("hotkey-markers · 全局 keydown 监听有且只有一个（裁定 G5）", () => {
  it("addEventListener 与 removeEventListener 各命中一处，且都在 composables/useHotkeys.ts", () => {
    const add = countOccurrences('document.addEventListener("keydown"');
    expect(add.reduce((sum, hit) => sum + hit.count, 0)).toBe(1);
    expect(add.map((hit) => hit.file)).toEqual([
      expect.stringContaining("composables/useHotkeys.ts")
    ]);
    const remove = countOccurrences('document.removeEventListener("keydown"');
    expect(remove.reduce((sum, hit) => sum + hit.count, 0)).toBe(1);
    expect(remove.map((hit) => hit.file)).toEqual([
      expect.stringContaining("composables/useHotkeys.ts")
    ]);
  });
});

/**
 * 评审 T4-1：textarea 若退回 `:value` + `@input` 的裸绑定，Vue 的 IME 组合守卫就没了——
 * 组合期间的候选串会被任何一次 store 写入（Task 7 预填、切章）打断。本仓零 jsdom，
 * 于是把「用哪种绑定」本身钉成源码契约：改回裸写法当场转红，而不是等真机冒烟才发现。
 */
describe("ComposerBox · textarea 必须是 v-model 绑定（评审 T4-1）", () => {
  it("textarea 上是 v-model，没有 :value / @input —— 退回裸绑定即红", () => {
    const tag = textareaTag("components/ComposerBox.vue");
    expect(tag).toContain('v-model="draft"');
    expect(tag).not.toContain(":value=");
    expect(tag).not.toContain("@input=");
  });

  it("draft 的读写仍单向回 store：写回走 emit，不留 DOM 取值的第二份通路", () => {
    const script = scriptSource("components/ComposerBox.vue");
    expect(script).toContain('emit("update:modelValue"');
    expect(script).not.toContain("HTMLTextAreaElement");
  });
});

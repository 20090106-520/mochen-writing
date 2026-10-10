/// <reference types="node" />
/**
 * 中栏读稿的**接线契约**（2026-10-05 批次 3 尾巴）。
 *
 * 行为由 `stores/useBookStore.doc-loading.test.ts` 钉（真跑起来的状态），
 * 判定由 `utils/editor-readout.test.ts` 钉（纯函数）。这里钉的是第三块：
 * **组件与 store 真的接上了**——`.vue` 零自动化覆盖，只能读源文件。
 *
 * 三件事缺一件这功能就白做：
 * ① 骨架挂在**编辑区与预览区各自的 v-if** 上：只挡一处的话，
 *    分栏模式下右边预览会先摆出上一篇的渲染结果。
 * ② 空态不摆 textarea：摆一个空输入框，用户会以为是自己写空了。
 * ③ store 那道令牌闸：没有它，慢的那次读回来会把中栏**永久**停在错的那一篇。
 *
 * 读法走 vue-source-reader（剥注释），否则「这里没有 X」这句话本身写着 X。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
// store 是散装 `.ts`，没有 <script setup> 块——读它得用 typeScriptSource（老坑，第二次栽）。
const store = typeScriptSource("stores/useBookStore.ts");
const css = styleSource("editor-pane.css");

describe("判定来自 utils，不在组件里各写各的", () => {
  it("bodyState 走 editorBodyState，喂的是 store 那一格在途标志", () => {
    expect(paneScript).toContain("editorBodyState({ loading: book.docLoading");
    expect(paneScript).toContain("hasDoc: book.activeDocTab !== null");
  });

  it("话术也走 utils（EDITOR_EMPTY_HINT / editorLoadingLabel）", () => {
    expect(paneScript).toContain("editorLoadingLabel(title.value)");
    expect(paneTpl).toContain("EDITOR_EMPTY_HINT");
  });

  // 铁律 6：三格判定不许在 .vue 里再写一遍，改名能全绿通过。
  it("组件里不出现第二份判定：loading/empty/body 只在 utils 判一次", () => {
    for (const literal of ['"loading"', '"empty"', '"body"']) {
      expect(
        countNeedle(literal, paneScript),
        `${literal} 写在 DocumentPane.vue 里就是第二份真身`
      ).toBe(0);
    }
  });
});

describe("骨架要挡住编辑区**和**预览区", () => {
  it("两处 v-if 都挂了 bodyState 判定（只挡一处的话分栏模式会漏）", () => {
    expect(countNeedle("bodyState !== 'empty'", paneTpl)).toBe(2);
  });

  it("编辑区在途时摆骨架，骨架里没有 textarea", () => {
    expect(paneTpl).toContain("v-if=\"bodyState === 'loading'\"");
    expect(paneTpl).toContain('class="editor-skeleton"');
    expect(paneTpl).toContain('aria-busy="true"');
  });

  it("空态有自己的话术，不复用骨架也不复用预览", () => {
    expect(paneTpl).toContain("v-if=\"mode === 'manuscript' && bodyState === 'empty'\"");
    expect(paneTpl).toContain('class="editor-empty"');
  });
});

/**
 * store 那道闸不许被拆掉（2026-10-10：令牌判定搬进 `utils/doc-read`，接线仍在这里）。
 *
 * 搬走之后这里钉的是**两件事**：① 那条通路真的被 store 接上了（摆态、换书作废、失败清空
 * 都在 store 这一侧，不是 util 里自说自话）；② 判定只有一份真身——store 里不许再出现
 * `docLoadToken` 这个名字，否则就是第二份令牌闸，两处各有自己的号，竞态照样赢。
 * 判定本身逐条钉在 `utils/doc-read.test.ts`。
 */
describe("store 那道闸不许被拆掉", () => {
  const docRead = typeScriptSource("utils/doc-read.ts");

  it("读回来先对令牌：对不上就丢弃，不许盖掉后一次的结果", () => {
    expect(docRead).toContain("const token = (docLoadToken += 1);");
    expect(docRead).toContain("if (token !== docLoadToken) return;");
    // 失败那一路同样要对令牌：废弃的那次不许把理由写进新那一格。
    expect(countNeedle("if (token !== docLoadToken) return;", docRead)).toBe(2);
  });

  it("在途标志只有持有令牌的那次才收（废弃的那次会把骨架提前撤掉）", () => {
    expect(docRead).toContain("if (token === docLoadToken) io.setLoading(false);");
    // 而那个标志接的确实是 store 的 docLoading——不然骨架摆的是别处。
    expect(store).toContain("this.docLoading = value;");
  });

  it("换书作废上一本的在途读：不然那一次会把上一本的正文写进这一本", () => {
    expect(store).toContain("bumpDocLoadToken();");
    // 令牌只有一处真身：store 里再出现这个名字就是第二份闸。
    expect(store).not.toContain("docLoadToken");
  });

  it("读失败清空正文，不留上一篇在新标题底下（撒谎比空着更坏）", () => {
    // 2026-10-09 P0-3：清空不再逐字段抄一遍，改走 EMPTY_DOC 那一份样子。
    // 钉的是**这一对次序**——先把这一格归零、再说明白哪一篇没打开；少了归零就是撒谎。
    expect(store).toMatch(
      /Object\.assign\(this, EMPTY_DOC\);\s*\n\s*this\.notice = `没能打开 \$\{one\}/
    );
  });

  // 有暂存副本时不发 IPC 就不该进在途：否则中栏为一次同步赋值抖一下骨架。
  it("有暂存就零延迟换过去，不进在途态", () => {
    expect(docRead).toContain("if (stashed !== null) {");
    const stashBlock = /if \(stashed !== null\) \{([\s\S]*?)\n {2}\}/.exec(docRead)?.[1] ?? "";
    expect(stashBlock).not.toContain("setLoading");
    expect(stashBlock).toContain("io.applyStashed(relPath, stashed);");
  });
});

/**
 * 切行模板。按空白切会把 `minmax(0, 1fr)` 劈成两半，断言就数错根数——
 * 所以认一下括号深度（第一版就栽在这儿，数成 5 根而不是 7 根）。
 */
function splitRows(template: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of template) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur !== "") out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out;
}

const rowsOf = (selector: string): string[] =>
  splitRows(/grid-template-rows:\s*([^;]+);/.exec(ruleBlock(css, selector))?.[1] ?? "");

describe("右栏行模板必须容得下实际子元素", () => {
  // 回归（2026-10-05 真机撞到，症状极隐蔽）：
  // `.editor-pane` 写的是 5 行 `50/42/40/1fr/36`，实际有 6 个子元素，
  // 第 4 根 `1fr` 被**视图切换条**占去——它是个透明盒子，撑满 707px，
  // 屏幕上那片"空着的正文区"其实是它。真正的 `.editor-document` 落到 36px 那行，
  // textarea 被顶到 y=948，而视口只有 902px ⇒ **正文一直就没显示过**。
  // 这类 bug 静态扫不出来（CSS 规则都"有消费者"），只能把行号钉死。
  it("行模板留了两根 auto 给条件条（查找替换条 + 视图切换条可同时在场）", () => {
    const parts = rowsOf(".editor-pane");
    expect(parts, `行模板只有 ${parts.length} 根，容不下 7 个子元素`).toHaveLength(7);
    expect(parts.filter((p) => p === "auto")).toHaveLength(2);
    // 弹性行必须落在文档那一根上，不能是条件条
    expect(parts[5]).toBe("minmax(0, 1fr)");
  });

  it("文档与页脚写死行号，不靠「第几个子元素」顺推", () => {
    expect(ruleBlock(css, ".editor-pane > .editor-document")).toContain("grid-row: 6;");
    expect(ruleBlock(css, ".editor-pane > .editor-footer")).toContain("grid-row: 7;");
  });

  // 作品资料页少两根条（不渲染标签条与视图切换条），行号要跟着减，否则资料页又会错位。
  it("作品资料页另有行模板与行号", () => {
    expect(paneTpl).toContain("'is-dossier': mode === 'dossier'");
    expect(rowsOf(".editor-pane.is-dossier")).toHaveLength(4);
    expect(ruleBlock(css, ".editor-pane.is-dossier > .editor-document")).toContain("grid-row: 3;");
    expect(ruleBlock(css, ".editor-pane.is-dossier > .editor-footer")).toContain("grid-row: 4;");
  });
});

describe("样式在 styles/ 下，且不是空壳", () => {
  it("组件里不写 <style>", () => {
    expect(countNeedle("<style", vueSource("components/DocumentPane.vue"))).toBe(0);
  });

  it("骨架有空规则：行、标签、错峰动画都在", () => {
    expect(ruleBlock(css, ".editor-skeleton")).not.toBe("");
    expect(ruleBlock(css, ".editor-skeleton-line")).not.toBe("");
    expect(ruleBlock(css, ".editor-skeleton-label")).not.toBe("");
    expect(css).toContain("@keyframes editor-skeleton-pulse");
  });

  it("空态有真规则", () => {
    expect(ruleBlock(css, ".editor-empty")).not.toBe("");
  });

  // 回归（2026-10-05 真机截图）：`.editor-document` 是 grid，第 3 行 `minmax(0, 1fr)` 会吃光
  // 自由空间。空态若靠 `margin-top` 往下挪，就会被容器底边裁掉——DOM 里有、读得到文字、
  // 屏幕上什么都没有。跨轨居中才不依赖任何剩余空间。
  it("空态跨轨居中，不靠 margin 定位（margin 版会被 grid 行 + overflow 裁掉）", () => {
    const block = ruleBlock(css, ".editor-empty");
    expect(block).toContain("grid-row: 1 / -1");
    expect(block).toContain("align-self: center");
    expect(block).toContain("justify-self: center");
    expect(block).toContain("margin: 0;");
    expect(block).not.toMatch(/margin-top:\s*\d/);
  });

  // 骨架的呼吸感是动画，所以它必须落在 styles/motion.css 那道总闸的射程内——
  // 总闸是 `html[data-reduced-motion="true"] *`，只要是全局样式表就自动覆盖；
  // 这条钉的是「别哪天把动画搬进 .vue 的 scoped 块」，那样总闸就够不着了。
  it("骨架动画在全局样式表里（搬进 scoped 块就管不到了）", () => {
    expect(css).toContain("animation:");
    expect(vueSource("components/DocumentPane.vue")).not.toContain("editor-skeleton-pulse");
  });
});

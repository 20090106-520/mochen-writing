import { describe, expect, it } from "vitest";
import { scriptSource, styleSource, templateSource, vueSource } from "../utils/vue-source-reader";

/**
 * 素材库面板的接线（2026-10-23）。
 *
 * 起因（用户原话）：「素材库就是一个空壳……它不是一个单独的界面……」。
 * 真身是一篇篇 `materials/` 文稿（导入与「AI 能读到」两条链早已在盘上：`ImportTxtDialog`
 * 可导 `material`、`agent-runtime/context.ts` ⑥ 会注入它）。缺的是**一个能把它们列出来、
 * 并给两条真动作的地方**——本面板即那一处。
 *
 * 这里钉的是**接线**：`.vue` 不进类型程序，少挂一个 anchor、少调一个 store 动作，
 * tsc 与 build 都不报，只有用户点下去才发现没通路。
 */
const buttonScript = scriptSource("components/MaterialButton.vue");
const buttonTpl = templateSource("components/MaterialButton.vue");
const panelScript = scriptSource("components/MaterialPanel.vue");
const panelTpl = templateSource("components/MaterialPanel.vue");

describe("素材库 · 入口按钮（右栏头部的锚点）", () => {
  it("开合真身是 useMaterialStore，按钮就是浮层的锚点", () => {
    expect(buttonScript).toContain(
      'import { useMaterialStore } from "../stores/useMaterialStore";'
    );
    expect(buttonScript).toContain(
      "const anchor = computed<HTMLElement | null>(() => button.value ?? null);"
    );
    // 开合动作挂在按钮上（模板里那一颗），不是脚本里另调一次。
    expect(buttonTpl).toContain("material.toggle()");
    // 浮层只在「开着 + 锚点已挂」时渲染——没有锚点就没有定位依据。
    expect(buttonTpl).toContain('<MaterialPanel v-if="material.open && anchor" :anchor="anchor"');
    expect(buttonTpl).toContain('@close="material.close()"');
  });

  it("没开作品时按钮是禁用的（素材属于某一本书）", () => {
    expect(buttonTpl).toContain(':disabled="!book.meta"');
  });
});

describe("素材库 · 浮层本体", () => {
  it("清单是派生的：kind === material 的文稿，不存第二本账", () => {
    expect(panelScript).toContain('book.docs.filter((doc) => doc.kind === "material")');
    expect(panelTpl).toContain('v-for="doc in entries"');
    // 点某一篇 → 右栏打开它（与另外三张台账同一条口径）。
    expect(panelScript).toContain("await book.openDocTab(relPath);");
  });

  it("两条真动作：导入到素材库（走既有导入通路）、让 AI 整理入库（只预填不自动发送）", () => {
    // 导入不另造一套：直接开既有的导入对话框，并**预设到「素材库」档**（2026-10-23）。
    expect(panelScript).toContain('layout.openImportTxt("material");');
    // 整理入库只预填一句指令，发送权留在用户手里（与去 AI 味 / 书稿体检同一条纪律）。
    expect(panelScript).toContain("agent.prefillComposer(");
    expect(panelScript).not.toMatch(/prefillComposer\([\s\S]{0,200}\.send\(/);
    // 本线程的键由 threadKeyFor 给，不自己拼。
    expect(panelScript).toContain("threadKeyFor(book.activeDocTab)");
  });

  it("空态是诚实的引导，不假装有素材", () => {
    expect(panelTpl).toContain('v-if="entries.length === 0"');
    expect(panelTpl).toContain("这本书还没有素材");
  });

  it("浮层根类进了「弹层出场」动效表（overlay-chrome 从 useComposerContextPopover 反推）", () => {
    expect(panelScript).toContain("useComposerContextPopover(");
    expect(styleSource("motion.css")).toContain(".material-panel,");
  });

  it("样式表被 styles.css 引入（不引入 = 面板裸奔）", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/material-panel.css";');
  });
});

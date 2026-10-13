import { describe, expect, it } from "vitest";
import {
  countNeedle,
  MODAL_DIALOGS as DIALOGS,
  modalDialogTableDrift,
  scriptSource,
  tagAttributes,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * 弹层的焦点与 Esc：一份真身，四个弹层逐个点名（批次 5-㊱）。
 *
 * 【为什么需要这份守卫】这一族出过一次很典型的错：**守卫是绿的，行为是坏的**。
 * model-profile-dialog-wiring 早就钉了「是弹层就得有关闭通路：遮罩按下关、Esc 关、× 关、取消关」，
 * 钉法是「模板里有没有 keydown」。可 keydown 走冒泡——焦点不在这棵子树里就收不到，
 * 而四个弹层没有一处把焦点挪进去。真机实测三条同时红：焦点仍停在触发那颗按钮上、
 * 裸 Esc 纹丝不动、把焦点手动挪进去再按 Esc 依然不动（因为模板里根本没有 keydown）。
 * 形状对了不等于行为对，所以这里钉的是**接线本身**（谁提供裁决、根节点带没带 tabindex），
 * 行为本身由 `.mochen-tmp/p535/p536c-esc-dialog.mjs` 与 `p536d-modal-esc-family.mjs` 在真机上量。
 *
 * 【为什么逐个点名而不是查「全仓有几个 dialog-backdrop」】点名才有鉴别力：
 * 新加一个弹层时，前一种写法照样全绿（它没被点到），这一份会逼着把它写进表里。
 *
 * 【2026-10-11】那份名单搬到了 `utils/vue-source-reader.ts` 的 `MODAL_DIALOGS`：
 * 入场动效那份守卫（`dialog-spring-wiring.test.ts`）也要用同一份，
 * 留在本文件里就等于逼着那边抄一个——而抄出来的名单有一个安静的死法：
 * 加了第五个对话框，两边都不红。对账由下面的「表与目录对得上吗」那条判据负责。
 */
describe("弹层 · 焦点与 Esc 的真身只有一处", () => {
  it("登记表与目录对得上：模板里有 .workspace-dialog 的组件都必须登记在册", () => {
    const drift = modalDialogTableDrift();
    expect(
      drift.missingFromTable,
      "新加了对话框却忘了登记——焦点/Esc 与入场动效两份守卫都会开始漏掉它"
    ).toEqual([]);
    expect(drift.missingFromTemplate, "表里有、模板里已经不是那种对话框了，该从表里删掉").toEqual(
      []
    );
  });
  for (const dlg of DIALOGS) {
    it(`${dlg.name}：Esc 与焦点进出由 useModalFocus 独家提供`, () => {
      const script = scriptSource(dlg.file);
      expect(script).toContain('from "../composables/useModalFocus"');
      expect(script).toContain("useModalFocus({");
      // 第二处裁决不许有：组件里自己判 Escape 就是同一判定的第二份实现。
      expect(script).not.toContain('"Escape"');
      expect(templateSource(dlg.file)).not.toContain("@keydown");
    });

    it(`${dlg.name}：对话框根节点带 tabindex="-1" 且有模板 ref`, () => {
      const attrs = tagAttributes(templateSource(dlg.file), "workspace-dialog").join(" ");
      // 少了 tabindex，useModalFocus 兜底那处 el.focus() 静默失败——div 默认不可聚焦。
      expect(attrs).toContain('tabindex="-1"');
      expect(attrs).toMatch(/ref="[A-Za-z][\w]*"/);
      expect(scriptSource(dlg.file)).toMatch(/const [A-Za-z][\w]* = ref<HTMLElement>\(\)/);
    });

    it(`${dlg.name}：宣示了 aria-modal 就得真的把焦点关在里面`, () => {
      const attrs = tagAttributes(templateSource(dlg.file), "workspace-dialog").join(" ");
      expect(attrs).toContain('aria-modal="true"');
    });
  }

  it("弹层自己 v-if 的那两个必须传 isOpen；父组件 v-if 挂载的那两个不传", () => {
    for (const dlg of DIALOGS) {
      const script = scriptSource(dlg.file);
      const passes = script.includes("isOpen:");
      expect(passes).toBe(dlg.mustPassIsOpen);
    }
    // 不传 isOpen 的那种靠挂载即开，所以必须真的用了 ref 拿节点（见上一组断言）。
    expect(scriptSource("components/NewBookDialog.vue")).not.toContain("toRef");
  });
});

describe("useModalFocus 本体", () => {
  const SRC = "composables/useModalFocus.ts";
  const src = typeScriptSource(SRC);

  it("Esc 在这一处被吃掉：preventDefault + stopPropagation，绝不越级打断回合", () => {
    // stopPropagation 是关键：全局 utils/escape-policy 那条链里还有「打断正在跑的一轮」，
    // 弹层开着时按 Esc 若透过去，一次按键会先关弹窗再把对话打断。
    expect(src).toContain('if (event.key === "Escape")');
    expect(countNeedle("event.stopPropagation()", src)).toBe(1);
  });

  it("监听挂在弹层根上，不挂 document（裁定 G5：全局 keydown 监听全仓只允许一处）", () => {
    // 第一版挂的是 document，被 utils/hotkey-markers.test.ts 那条 G5 当场逮住（实测）。
    // 「焦点不在层内时收不到」那个老毛病由上面那条「焦点进层」治好，不靠监听的位置。
    expect(src).toContain('el.addEventListener("keydown", onKeydown, true)');
    expect(src).toContain('openedRoot?.removeEventListener("keydown", onKeydown, true)');
    expect(src).not.toContain('document.addEventListener("keydown"');
  });

  it("内部 v-if 那种必须 post 之后才接管：默认的 pre 段跑在 DOM 更新之前，root 还是 undefined", () => {
    expect(src).toContain('flush: "post"');
    // immediate 会在 setup 期就触发，那时 DOM 还不存在——所以不许有。
    expect(src).not.toContain("immediate: true");
  });

  it("焦点归位不是无脑 focus()：别的层已经接走焦点时不抢", () => {
    // need-book 引导点「新建作品」会在同一 tick 里开下一层；无条件还回去会把新弹层的焦点踢回左栏。
    expect(src).toContain("const target = opener");
    expect(src).toContain("rootAtClose.contains(active)");
    expect(src).toContain("if (!stillMine) return;");
  });

  it("只让最上面那层吃键：need-book 引导会在同一 tick 里换层", () => {
    expect(src).toContain("const openStack: symbol[] = []");
    // 钉**调用点**而不是定义：变异实验里把 onKeydown 开头那句 `|| !isTopmost()` 删掉、
    // 函数本身留着没删，断言照样全绿 —— 绿的是「定义还在」，不是「判定还在生效」。
    expect(src).toMatch(/if \(\s*el === undefined\s*\|\|\s*!\s*isTopmost\(\)\s*\)\s*return;/);
  });

  it("Tab 会被关在层内：宣示了 aria-modal 就得真的挡", () => {
    expect(src).toContain('if (event.key !== "Tab") return;');
    expect(src).toContain("last.focus()");
    expect(src).toContain("first.focus()");
  });
});

describe("退役的那些机制不许回来", () => {
  it("NewBookDialog 不许再挂 autofocus：动态插入的元素浏览器不保证接管焦点（实测确实没接管）", () => {
    const markup = templateSource("components/NewBookDialog.vue");
    expect(markup).not.toContain("autofocus");
    // 真身是 composable 里那一处显式 focus，不是 HTML 属性。
    expect(typeScriptSource("composables/useModalFocus.ts")).toContain("(first ?? el).focus()");
  });

  it("SaveConflictDialog 不许再在 backdrop 上挂 @keydown.esc", () => {
    expect(templateSource("components/SaveConflictDialog.vue")).not.toContain("@keydown");
  });

  it("ModelProfileDialog 不许再有自己那份 onKeydown", () => {
    expect(scriptSource("components/ModelProfileDialog.vue")).not.toContain("onKeydown");
  });
});

/**
 * 面板那一族（5-㊲）。与上面四个对话框是同一个病的另一半：
 * 八个 `.xxx-overlay` + `.xxx-panel` 的整屏浮层，形状一模一样地复制过去，
 * 而真机量测（p536h 之前那一版 p536g）实测**六处全部**：焦点从不在层内、Esc 一次也收不掉。
 *
 * 逐个点名而不是数「全仓有几个 -panel」：点名才有鉴别力，新加一个浮层时
 * 前一种写法照样全绿（它没被点到），这一份会逼着把它写进表里。
 */
const PANELS = [
  {
    file: "components/SearchPanel.vue",
    panel: "search-panel",
    overlay: "search-overlay",
    name: "全文搜索"
  },
  {
    file: "components/NotesPanel.vue",
    panel: "notes-panel",
    overlay: "notes-overlay",
    name: "笔记"
  },
  {
    file: "components/WordCountPanel.vue",
    panel: "wc-panel",
    overlay: "wc-overlay",
    name: "字数统计"
  },
  {
    file: "components/ExportDialog.vue",
    panel: "export-dialog",
    overlay: "export-overlay",
    name: "导出作品"
  },
  {
    file: "components/PromptTemplatePanel.vue",
    panel: "tpl-panel",
    overlay: "tpl-overlay",
    name: "提示词模板"
  },
  {
    file: "components/OutlinePanel.vue",
    panel: "outline-panel",
    overlay: "outline-overlay",
    name: "文档大纲"
  },
  {
    file: "components/WritingGoalPanel.vue",
    panel: "goal-panel",
    overlay: "goal-overlay",
    name: "写作目标"
  },
  {
    file: "components/StoryBiblePanel.vue",
    panel: "bible-panel",
    overlay: "bible-overlay",
    name: "故事圣经"
  }
] as const;

describe("面板族 · 焦点与 Esc 同样只由 useModalFocus 提供", () => {
  for (const p of PANELS) {
    it(`${p.name}：接线、面板根节点、以及遮罩那条鼠标路都在`, () => {
      const script = scriptSource(p.file);
      const markup = templateSource(p.file);
      expect(script, `${p.name} 没接 useModalFocus`).toContain(
        'from "../composables/useModalFocus"'
      );
      expect(script).toContain("useModalFocus({");
      // 八个全是「组件常驻 + 自己 v-if 那一格」⇒ 必须显式传 isOpen。
      expect(script).toContain("isOpen: toRef(() => props.visible)");
      expect(script).toContain('close: () => emit("close")');

      const attrs = tagAttributes(markup, p.panel).join(" ");
      expect(attrs, `${p.name} 面板根节点缺 ref="panelRoot"`).toContain('ref="panelRoot"');
      expect(attrs, `${p.name} 宣示了 aria-modal 就得真的把焦点关在里面`).toContain(
        'aria-modal="true"'
      );
      expect(attrs, `${p.name} 缺 tabindex="-1"，「层里没有可聚焦元素时」就落不了地`).toContain(
        'tabindex="-1"'
      );
      // 遮罩那条鼠标路必须留着：Esc 是补充，不是替换。
      expect(markup).toContain(`class="${p.overlay}"`);
      expect(markup).toContain(`@click.self="emit('close')"`);
    });

    it(`${p.name}：组件里不许自己再判一次 Escape`, () => {
      const script = scriptSource(p.file);
      const markup = templateSource(p.file);
      // 不钉「不许出现 @keydown」：SearchPanel 的搜索框本来就有一个 @keydown 管 ↑↓/Enter，
      // 那是**另一个判定**。这里钉的是「不许出现 Escape 这个键的判定」。
      expect(script, `${p.name} 自己判了 Escape`).not.toContain('"Escape"');
      expect(markup, `${p.name} 模板里自己判了 Escape`).not.toContain(".esc");
    });
  }

  it("OutlinePanel 那一处 @keydown.esc 已退役（它挂在搜索框上，而焦点从没进过面板）", () => {
    expect(templateSource("components/OutlinePanel.vue")).not.toContain("@keydown.esc");
    // 它那枚关闭钮还在——鼠标路不能少。
    expect(templateSource("components/OutlinePanel.vue")).toContain('aria-label="关闭大纲面板"');
  });

  it("SearchPanel 那处 setTimeout 聚焦已退役：它是同一件事的第二份实现，而且实测没生效", () => {
    const script = scriptSource("components/SearchPanel.vue");
    expect(script).not.toContain("inputRef.value?.focus()");
    // 打开时焦点落在它自己的搜索框上——真身是 composable 取「第一颗可聚焦元素」。
    expect(
      tagAttributes(templateSource("components/SearchPanel.vue"), "search-panel").join(" ")
    ).toContain('ref="panelRoot"');
  });

  it("WordCountPanel 的 defineProps 必须接住 props（接线要读 props.visible）", () => {
    // 原来是裸的 `defineProps<{ visible: boolean }>();` —— script 里拿不到 visible，
    // 于是「面板开着吗」这个判定就没法喂给 composable。
    expect(scriptSource("components/WordCountPanel.vue")).toContain(
      "const props = defineProps<{ visible: boolean }>();"
    );
  });

  it("OnboardingGuide 不在这张表里：它是引导流程，Esc 的语义是「跳过」而不是「关闭」", () => {
    // 说清为什么排除，免得下一个人看到「九个浮层九个没接线」就去把它也接上：
    // 它没有 close 通路（.ob-overlay 上没有 @click.self），只有「上一步 / 下一步 / 完成」。
    // 接上 useModalFocus 会凭空多一条 Esc 通路，而那不是这个组件的设计。
    const markup = templateSource("components/OnboardingGuide.vue");
    expect(markup).toContain('class="ob-overlay"');
    expect(markup).not.toContain("@click.self");
    expect(markup).not.toContain('class="ob-dialog" role="dialog" aria-modal="true"');
  });
});

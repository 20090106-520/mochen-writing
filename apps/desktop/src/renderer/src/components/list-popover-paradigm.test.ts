/**
 * 「挑一个选项」那一族浮层的**范式**（2026-10-25）。
 *
 * 【为什么要有这一份】
 * 用户原话：「我说的 UI，你也没有参考进行把我那个软件进行优化等其他东西」。
 * 勘察的结论是：墨宸里从一组东西里挑一个的浮层有四个（模型选择器 / 权限档 /
 * 阶段选择 / @ 引用菜单），而它们**键盘行为各不相同**——
 *   · @ 引用菜单：↑↓ 走高亮、Enter 插高亮那条、悬停与高亮同步、底部有键位提示行（做得最全）；
 *   · 模型选择器：↑↓ 搬真焦点（搬走了就打字打不进去）；
 *   · 权限档：**只有 Esc**，↑↓ 选不了、Enter 也选不了；
 *   · 阶段选择：↑↓ 搬真焦点，Enter 选的是**第一条**而不是正指着的那条。
 * 同一个产品里四套键盘行为，用户每开一个浮层都要重新学一遍——
 * 这不是「各有风格」，是同一件事有多份实现（铁律 6）。
 *
 * 【这一份钉什么】
 * 四件事，同一份判据：
 *   ① 高亮判据只有一份：`utils/list-highlight.ts`（上下键环绕 + 夹下标），
 *      合成器只有一份：`composables/useListHighlight.ts`。
 *      组件不许自己写一份，也**不许**直接引裸函数绕过合成器。
 *   ② ↑↓ 改的是**高亮**（下标），不是真焦点——焦点留在搜索框里（能边打字边选）。
 *   ③ Enter 选的是**高亮那条**，不是第一条。
 *   ④ 名单是 listbox/option + aria-selected + is-selected；底部一枚键位提示行，
 *      排版走共用的 `.list-keys`（styles.css 一处）。
 *
 * 【为什么用读源码断言而不是组件测试】
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`vue-shim.d.ts` 把 `*.vue` 声明成 any ⇒
 * 组件零类型检查，模板与接线只能钉成读源码断言（同律先例：model-select-wiring、
 * provider-settings-wiring）。注释会被剥掉：只在注释里宣称的接线不算数。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const MODEL_SELECT = "components/ModelSelect.vue";
const PERMISSION = "components/PermissionMenu.vue";
const CONTEXT_MENU = "components/ComposerContextMenu.vue";
const REFERENCE = "components/ComposerReferenceMenu.vue";
// P0-5 的「审稿」下拉也是「从一组入口里挑一个」，同一份范式。
const REVIEW = "components/ReviewMenu.vue";

/** 剥掉 CSS 注释（`ruleBlock` 只剥 JS 注释，剥不掉 CSS 的）。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** 组件的 keydown 处理函数体（用来钉「函数体里真的做了什么」，而不只是「函数名在文件里」）。 */
function keydownBody(script: string): string {
  return (
    /function (?:onKeydown|keydown)\(event: KeyboardEvent\): void \{[\s\S]*?\n\}/.exec(
      script
    )?.[0] ?? ""
  );
}

describe("范式 · 高亮判据只有一份", () => {
  /**
   * 组件不许直接引裸函数绕过合成器。
   *
   * 【为什么连这个也要钉】裸函数与合成器是**同一份判据**，但绕过合成器就意味着
   * 「名单变了把高亮收回落点」「把高亮行滚进视野」这两件事要各写一遍——
   * 于是又变成多份实现。合成器那两件事是这一族浮层共用的行为，不该由各家重写。
   */
  it("三个浮层都走共用的合成器，不许直接引裸判据函数", () => {
    for (const path of [MODEL_SELECT, PERMISSION, CONTEXT_MENU, REVIEW]) {
      const script = scriptSource(path);
      expect(script, `${path} 没接共用的高亮合成器`).toContain(
        'from "../composables/useListHighlight"'
      );
      expect(script, `${path} 绕过了合成器，直接引了裸判据`).not.toContain(
        'from "../utils/list-highlight"'
      );
      expect(script, `${path} 里出现了自己写的那份上下键判据`).not.toContain("moveHighlightIndex");
      expect(script, `${path} 里出现了自己写的那份夹下标判据`).not.toContain("clampHighlightIndex");
    }
  });

  /**
   * @ 引用菜单是**老**的那一份（它做得最全，所以是范式的源头），但它的键位裁决
   * 在全局那一条链上（utils/hotkeys.ts），组件本身不吃键。
   * ⇒ 它的**判据**也必须是共用那一份：store 引 utils/list-highlight。
   */
  it("引用菜单那一份的判据也是共用那份（store 引 utils/list-highlight）", () => {
    const store = vueSource("stores/useReferenceMenuStore.ts");
    expect(store).toContain('from "../utils/list-highlight"');
    expect(store).toContain("moveHighlightIndex");
    expect(store).toContain("clampHighlightIndex");
    // 组件不吃键（键位裁决在 utils/hotkeys.ts 那一条链上）——组件里出现 keydown 监听就是第二处裁决。
    // （它确实有一个 document 级监听，但那是 `selectionchange`：光标自己动了要重算行内匹配，不是键。）
    expect(scriptSource(REFERENCE), "引用菜单组件不该自己监听键").not.toContain('"keydown"');
  });
});

describe("范式 · ↑↓ 改高亮，不搬真焦点", () => {
  /**
   * 【为什么钉函数体而不是「模板里出现过 ↑↓」】
   * 键盘行为最容易走的歪路是「函数名还在、动作没了」。所以这里钉的是**函数体里
   * 真的调了共用的 `move`**，以及**函数体里没有 `.focus()`**。
   */
  it("三个浮层的 ↑↓ 都调共用的 move，且都不搬真焦点", () => {
    for (const path of [MODEL_SELECT, PERMISSION, CONTEXT_MENU, REVIEW]) {
      const body = keydownBody(scriptSource(path));
      expect(body, `${path} 的 keydown 读不到`).not.toBe("");
      expect(body, `${path} 的 ↑↓ 没有走共用的 move`).toContain("highlight.move(");
      expect(body, `${path} 把真焦点搬走了（焦点应当留在搜索框/容器上）`).not.toContain(".focus()");
    }
  });

  it("三个浮层的 Enter 都选高亮那条，不是第一条", () => {
    for (const path of [MODEL_SELECT, PERMISSION, CONTEXT_MENU, REVIEW]) {
      const body = keydownBody(scriptSource(path));
      expect(body, `${path} 的 Enter 没有选高亮那条`).toContain("highlight.pickActive()");
      // 旧形状（阶段选择那版）：Enter 选的是 buttons[0]。
      expect(body, `${path} 还在按第一条选`).not.toContain("buttons[0]");
    }
  });
});

describe("范式 · 名单是 listbox/option + aria-selected", () => {
  it("四个浮层的选项都是 option，且带 aria-selected 与 is-selected", () => {
    for (const path of [MODEL_SELECT, PERMISSION, CONTEXT_MENU, REFERENCE, REVIEW]) {
      const markup = templateSource(path);
      expect(markup, `${path} 里没有 option`).toContain('role="option"');
      expect(markup, `${path} 里没有 aria-selected`).toContain(":aria-selected=");
      expect(markup, `${path} 里没有 is-selected 高亮类`).toContain("'is-selected'");
    }
  });

  it("三个浮层的高亮初值落在「当前那一档」上（用户最可能要改的那一档）", () => {
    for (const path of [PERMISSION, CONTEXT_MENU]) {
      const script = scriptSource(path);
      expect(script, `${path} 没给高亮初值`).toContain("initialIndex:");
    }
    expect(scriptSource(PERMISSION)).toContain(
      "initialIndex: () => PERMISSION_MODES.indexOf(current.value)"
    );
    expect(scriptSource(CONTEXT_MENU)).toContain(
      "initialIndex: () => selectable.value.findIndex((option) => option.current)"
    );
  });
});

describe("范式 · 底部一枚键位提示行", () => {
  it("四个浮层都摆着键位提示行，且排版走共用的 `.list-keys`", () => {
    for (const path of [MODEL_SELECT, PERMISSION, CONTEXT_MENU, REFERENCE, REVIEW]) {
      const markup = templateSource(path);
      expect(markup, `${path} 没有键位提示行`).toContain("<kbd>");
      expect(markup, `${path} 的提示行没用共用的排版`).toContain("list-keys");
    }
  });

  /**
   * 键帽的**形状**只有一处（styles.css 的元素规则）。
   *
   * 【为什么这是「一份」而不是「几份配色」】描边、圆角、底、字色、字族、字号、字重
   * 这些是**同一种东西的样子**；六处各写一遍就是同一种东西六种长相
   * （描边粗细、圆角、字号全不一样），浮层之间一比就露馅。
   * 上下文只许覆写**颜色**（键位表那一枚是表格正文的一部分，字色跟正文走）。
   */
  it("键帽的形状只在 styles.css 一处，其余各处只许覆写颜色与字号", () => {
    // styles.css 在**根**上（不在 styles/ 目录里），所以读原文再剥注释。
    const root = stripCssComments(vueSource("styles.css"));
    const keycap = ruleBlock(root, "kbd");
    // 形状特征：底边比别边粗（键帽的立体感）——这一条是「形状集中在这里」的指纹。
    expect(keycap).toContain("border-bottom-width: 2px");
    expect(keycap).toContain("border-radius:");
    expect(keycap).toContain("font-family:");
    expect(keycap).toContain("font-weight:");

    // 引用菜单那份整条撤掉了（它现在只留页脚排版）。
    expect(strippedStyleSource("agent-pane.css")).not.toContain(".composer-reference-menu kbd");
    // 键位表那一枚只覆写颜色与字号：形状相关的 border-radius / font-weight 不许再出现。
    const table = ruleBlock(strippedStyleSource("dialog.css"), ".hotkeys-keys kbd");
    expect(table).not.toContain("border-radius");
    expect(table).not.toContain("font-weight");
    expect(table).not.toContain("font-family");
    // 面板里那两枚（大纲 / 全书搜索）同样只剩间距与字号。
    for (const path of ["components/OutlinePanel.vue", "components/SearchPanel.vue"]) {
      const scoped = stripCssComments(vueSource(path));
      const rule = /(\.[\w-]*footer kbd|\.search-shortcut)\s*\{([^}]*)\}/.exec(scoped)?.[2] ?? "";
      expect(rule, `${path} 的键帽规则读不到`).not.toBe("");
      expect(rule, `${path} 又画了一遍键帽的形状`).not.toContain("border");
      expect(rule, `${path} 又画了一遍键帽的形状`).not.toContain("border-radius");
      expect(rule, `${path} 又画了一遍键帽的形状`).not.toContain("background");
    }
  });
});

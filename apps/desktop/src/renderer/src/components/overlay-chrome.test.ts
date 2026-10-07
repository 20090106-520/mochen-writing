/// <reference types="node" />
/**
 * 浮层外壳的一致性契约（2026-10-05，批次 3）。
 *
 * 背景是真机撞到的两件事，都不是「某条 CSS 写错了」，而是**同一件事散在各处没人管**：
 *
 * ① 动效：`styles/motion.css` 里有一张「弹层出场」类名表，逐个列着哪些浮层该有入场动画。
 *    这张表是手维护的，于是这轮新加的改稿历史 / 去 AI 味 / 伏笔台账三个浮层全漏了，
 *    连更早的 `context-meter-panel` 与 `skill-browser` 也没在表里——它们弹出来是硬的，
 *    和旁边有动画的浮层并排时一眼就看出不对。
 *    光把这五个补进去只是治标：下一个浮层照样会漏。所以本测试**从组件反推要求**——
 *    谁用了 `useComposerContextPopover`，谁就是浮层，它的根类名就必须出现在那张表里。
 *
 * ② 叠压：toast 原本固定在 `top: 16px; right: 16px`，而本仓所有浮层都从右栏锚点向右展开，
 *    右上角是浮层的地盘。toast 一来就把浮层标题连同关闭按钮盖住（2026-10-05 真机截图）。
 *    所以 toast 挪到左上——那是全应用唯一没有浮层会去的角，z-index 保持最高不动。
 *    顺带把 `<style scoped>` 搬进 `styles/toast.css`，对齐本仓「样式不进 .vue」的规矩。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  templateSource,
  vueSource,
  styleSource
} from "../utils/vue-source-reader";

const COMPONENTS = fileURLToPath(new URL("./", import.meta.url));
const motionCss = styleSource("motion.css");

/**
 * toast.css 是本批次要新建的文件，所以这里容忍它不在：
 * 走 `styleSource` 会在**模块加载**时抛错，整份文件的断言一起熄灭，
 * 看不到「除了缺这份样式，动效表还差哪几个类名」。缺文件时下面每条 toast 断言各自红，
 * 红点才落在真正缺的那一处。
 */
const toastCss = ((): string => {
  try {
    return styleSource("toast.css");
  } catch {
    return "";
  }
})();

/** 用了 popover 定位合成器 = 这是个浮层（面板 / 菜单 / 浮窗），该有同一套出场与关闭手感。 */
const POPOVER_COMPOSABLE = "useComposerContextPopover(";

/** Teleport 到 body 的浮层根元素通常是 `<section ref="panel" class="xxx" :style="style">`，
 *  取第一个标签的静态 class —— 不吃 `:class`（那是运行期绑的，静态扫不出真身）。
 *  注意从 Teleport 标签**之后**开始找：否则第一个匹配是 `<Teleport to="body">` 自己，
 *  它没有 class，整层会被扫成 0 条（第一版就踩了这个，红得莫名其妙）。 */
function panelRootClass(source: string): string | null {
  const tpl = (/<template>([\s\S]*)<\/template>/.exec(source) ?? [])[1] ?? "";
  const open = '<Teleport to="body">';
  const at = tpl.indexOf(open);
  if (at < 0) return null;
  const first = /<[a-zA-Z][\w-]*((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(
    tpl.slice(at + open.length)
  )?.[1];
  if (first === undefined) return null;
  return /\sclass="([^"]+)"/.exec(first)?.[1]?.trim() ?? null;
}

const popoverPanels = ((): { file: string; rootClass: string }[] =>
  fs
    .readdirSync(COMPONENTS)
    .filter((f) => f.endsWith(".vue"))
    .map((f) => ({ file: f, src: vueSource(`components/${f}`) }))
    .filter((x) => x.src.includes(POPOVER_COMPOSABLE))
    .map((x) => ({ file: x.file, rootClass: panelRootClass(x.src) ?? "" }))
    .filter((x) => x.rootClass !== ""))();

/** motion.css 里所有 `animation: mochen-pop-in` 的规则的第一层选择器。 */
function popInSelectors(): string[] {
  const out: string[] = [];
  for (const m of motionCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/animation:\s*mochen-pop-in/.test(m[2] ?? "")) continue;
    for (const sel of (m[1] ?? "").split(",")) {
      const c = sel.trim();
      if (c.startsWith(".")) out.push(c);
    }
  }
  return out;
}

describe("推导本身先得成立（不然下面两条全是空断言）", () => {
  it("扫得出走 popover 的浮层，且这批浮层确实存在", () => {
    const files = popoverPanels.map((p) => p.file);
    expect(
      files.length,
      "一个走 useComposerContextPopover 的浮层都没扫到，正则口径坏了"
    ).toBeGreaterThan(3);
    for (const known of [
      "ChangeHistoryPanel.vue",
      "SlopPanel.vue",
      "ForeshadowPanel.vue",
      "ContextMeterPanel.vue"
    ]) {
      expect(files, `${known} 没被认成浮层`).toContain(known);
    }
    // 【5-㉛】SkillBrowserPanel 与 PluginPanel 曾在这张名单里，现在退役了：
    // 插件与技能改成独立整页（用户裁定「我想要的是这样的单独页面」），两个浮层连同
    // 各自的样式与守卫一起删掉。**这一条钉住退役本身**——不钉的话，将来谁把浮层
    // 拿回来，页面里就会同时有两套入口，而它们都自称是真身。
    expect(files).not.toContain("SkillBrowserPanel.vue");
    expect(files).not.toContain("PluginPanel.vue");
  });

  it("动画表读得出条目，且确实用的是那张 pop-in 关键帧", () => {
    const selectors = popInSelectors();
    expect(selectors.length, "motion.css 里读不到任何 mochen-pop-in 规则").toBeGreaterThan(3);
    expect(motionCss).toContain("@keyframes mochen-pop-in");
    expect(motionCss).toContain("var(--dur-pop)");
  });
});

describe("每个浮层都得挂在同一张出场表上", () => {
  it("走 popover 的浮层，根类名全都在 motion.css 的入场动画表里", () => {
    const selectors = new Set(popInSelectors());
    const missing = popoverPanels
      .filter((p) => !selectors.has(`.${p.rootClass}`))
      .map((p) => `${p.file} → .${p.rootClass}`);
    expect(
      missing,
      "这些浮层弹出来是硬的，和旁边有入场动画的浮层并排一眼就不对。" +
        "把它们的根类名补进 styles/motion.css 的「弹层出场」表（不是新写一份动画）。"
    ).toEqual([]);
  });

  it("本轮补的三个浮层确实在表里（点名，防止推导口径被放宽后集体失效）", () => {
    const selectors = popInSelectors();
    for (const cls of [".change-history", ".ai-slop", ".foreshadow-ledger"]) {
      expect(selectors, `${cls} 还没挂上进场动画`).toContain(cls);
    }
  });
});

describe("toast 挪到左上，不再压浮层标题", () => {
  it("组件里不写 <style>：本仓样式全在 styles/ 下", () => {
    expect(countNeedle("<style", vueSource("components/NotificationToast.vue"))).toBe(0);
  });

  // 回归：右上角是浮层的地盘（全部浮层都从右栏锚点向右展开），
  // toast 钉在那儿会把浮层标题连同关闭按钮盖住——2026-10-05 真机截图就是这个现象。
  it("toast 栈锚在左上（left），不锚右上（right）", () => {
    const stack = ruleBlock(toastCss, ".toast-stack");
    expect(stack).toContain("left:");
    expect(stack).not.toContain("right:");
  });

  it("z-index 仍然是全应用最高：提示要压得住任何浮层", () => {
    expect(ruleBlock(toastCss, ".toast-stack")).toContain("z-index: 9999");
  });

  it("入场方向跟着锚点改：从右滑入改成从左滑入", () => {
    expect(ruleBlock(toastCss, ".toast-enter-from")).toContain("translateX(-20px)");
    expect(ruleBlock(toastCss, ".toast-leave-to")).toContain("translateX(-20px)");
  });

  it("样式表接进了 styles.css，否则整份 toast.css 不会生效", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/toast.css";');
  });
});

describe("改稿历史：显示上限，不删盘上的备份", () => {
  it("面板用 changeListView 收口，不直接摊开整张表", () => {
    const script = scriptSource("components/ChangeHistoryPanel.vue");
    expect(script).toContain("changeListView(book.changeList)");
    // 钉的是「行从哪来」，不是「changeList 这个词出现过没有」——
    // onMounted 里那句 `book.changeList.length === 0` 是判断要不要拉，是合法的。
    expect(script, "行还直接摊着整张表，上限等于没接上").not.toContain(
      "computed(() => book.changeList)"
    );
  });

  it("头部计数报的是总数，不是切完之后的行数（否则它在说谎）", () => {
    expect(templateSource("components/ChangeHistoryPanel.vue")).toContain(
      "changeCountLabel(total)"
    );
  });

  it("折叠提示写在浮层里，且样式在 styles/change-history.css 有真规则", () => {
    const tpl = templateSource("components/ChangeHistoryPanel.vue");
    expect(tpl).toContain("hiddenNotice");
    expect(tpl).toContain('class="change-history-hidden"');
    expect(ruleBlock(styleSource("change-history.css"), ".change-history-hidden")).not.toBe("");
  });

  it("不引第二份判定：上限与文案只在 utils/change-history.ts 一处", () => {
    const panel = vueSource("components/ChangeHistoryPanel.vue");
    const hits = countNeedle("CHANGE_HISTORY_VISIBLE", panel);
    expect(hits, "上限写进了 .vue 就是第二份真身（铁律 6）").toBe(0);
  });
});

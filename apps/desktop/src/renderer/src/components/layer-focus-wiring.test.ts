import { describe, expect, it } from "vitest";
import {
  listComponentFiles,
  scriptSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 浮层的焦点与 Esc：**按 role 枚举整族**，不按根类名、不按名单（批次 5-㊵）。
 *
 * 【这一族为什么换了枚举方式】5-㊱ 修好了四个弹层、5-㊲ 修好了八个面板，两批都是按**族**扫的，
 * 而那两批的族是按**根类名**认的（`.dialog-backdrop` / `.xxx-overlay`）。于是：
 *   · `ToolRoster`（根类名 `.tool-roster-mask`）两批都不属于——漏了；
 *   · 七份贴 chip 下拉（`.change-history` / `.ai-slop` / …）两批都不属于——全漏了。
 * 真机 p536n 量到：九枚入口里**八枚的 Esc 按两下都不动**，焦点全停在锚点那枚 chip 上。
 * 同一个病（keydown 挂在面板根上，焦点不在那棵子树里就收不到）5-㊱ 已经治过一次，
 * 只是那一遍只治了名单里的四份。**类名是实现，role 是契约**；契约不会因为改个类名就漏。
 *
 * 【两个真身，判的是不同的契约，不许合并】
 *   · `useModalFocus` —— **模态层**：宣示 aria-modal，焦点必须进来，Tab 困在层内，Esc 收层，焦点归位。
 *   · `useComposerContextPopover` —— **贴锚点的浮层**：不困 Tab（Tab 触边交还触发钮并收起），
 *     但**焦点仍要进来**（否则挂在面板根的 Esc 永远收不到），并且要等面板真的可见了再挪。
 * useModalFocus 自己的注释里写明了这条界线，所以这里也按它分派，不合并成一份。
 *
 * 【行为由真机量】`.mochen-tmp/p535/p536n-popover-focus-esc.mjs`（九枚入口逐个真点，
 * 量「焦点在不在层内」与「Esc 一次能不能收」）与 `p536nb-context-menu-focus.mjs`
 * （逐帧量 visibility:hidden 窗口）。这份守卫钉的是**接线与形状**。
 */

/**
 * 例外表：宣称自己是 dialog / aria-modal，却**故意**不走那两份真身的。
 *
 * 【为什么不许留空理由】例外表最常见的死法是「先加进来，回头再修」——
 * 条目越来越多、理由越来越短，最后它变成第二份名单。所以理由必须是一句能判真假的话，
 * 且下面每条都有对应的断言钉住它的成立条件。
 */
const EXCEPTIONS: Record<string, string> = {
  FindReplacePanel:
    "Esc 由全局 escape-policy 的 close-find-replace 那一支收：它是 Ctrl+F 的落点，" +
    "走的是 composables/useHotkeys 那唯一一处全局监听，不是本地 keydown。",
  ConversationHistoryMenu:
    "它的 @keydown.esc 挂在 .conversation-history-control 上——那是**触发钮的祖先**，" +
    "焦点本来就在钮上，事件自然冒得到（p536n 量到它是九枚里 Esc 可收的一枚）。",
  OnboardingGuide:
    "引导流程：只有上一步/下一步/完成，Esc 在这里的语义是「跳过」，与「收层」不是一回事（5-㊲ 裁定）。"
};

const POPOVER_IMPORT = 'from "../composables/useComposerContextPopover"';
const MODAL_IMPORT = 'from "../composables/useModalFocus"';

/**
 * 【为什么钉 import 而不是名字】第一版写的是 `script.includes("useComposerContextPopover")`。
 * 变异 M2 只把 import 那一行换成注释、正文里的调用还在 —— 守卫照样绿（实测 GREEN）。
 * tsc 本来也会红，但守卫不能靠另一道关卡兜底：它得自己咬得住。
 */

/** 模板里宣称了对话框语义（按 role / aria-modal，两者是同一件事的两种写法）。 */
function claimsDialogSemantics(template: string): boolean {
  return (
    /role="dialog"|role='dialog'/.test(template) ||
    /aria-modal="true"|aria-modal='true'/.test(template)
  );
}

describe("浮层的焦点与 Esc · 按 role 枚举，每个都必须有一份真身", () => {
  const files = listComponentFiles();
  const dialogs = files.filter((f) => claimsDialogSemantics(templateSource(f)));

  it("枚举到这一族（枚举数为 0 说明 role 判据或目录读取坏了，不许静默全绿）", () => {
    expect(dialogs.length).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(40);
  });

  for (const file of dialogs) {
    const name = file.replace("components/", "").replace(".vue", "");
    if (name in EXCEPTIONS) continue;
    it(`${name}：焦点与 Esc 走两份真身之一`, () => {
      const script = scriptSource(file);
      const popover = script.includes(POPOVER_IMPORT);
      const modal = script.includes(MODAL_IMPORT);
      // 两份真身不许同时在场：它们判的是不同的契约，同时接就是「这一层到底算模态还是浮层」没人裁过。
      expect(popover && modal).toBe(false);
      expect(popover || modal).toBe(true);
    });
  }

  it("例外表里没有已经修好的（条目留着不删，例外表就成了第二份名单）", () => {
    const stale = Object.keys(EXCEPTIONS).filter((name) => {
      const file = `components/${name}.vue`;
      if (!files.includes(file)) return true;
      return (
        scriptSource(file).includes(MODAL_IMPORT) || scriptSource(file).includes(POPOVER_IMPORT)
      );
    });
    expect(stale).toEqual([]);
  });

  it("例外表里的理由不许是空串或占位（『回头再修』不是理由）", () => {
    for (const [name, why] of Object.entries(EXCEPTIONS)) {
      expect(why.length, `${name} 的例外理由太短`).toBeGreaterThan(20);
      expect(why, `${name} 的例外理由不许是占位`).not.toMatch(/TODO|待补|回头|暂时/);
    }
  });
});

describe("贴锚点的浮层 · 焦点必须真的进来，否则挂在面板根上的 Esc 是哑的", () => {
  const popovers = listComponentFiles().filter((f) => scriptSource(f).includes(POPOVER_IMPORT));

  it("这一族非空（为空说明判据写错了，守卫会变成永不触发的空跑）", () => {
    expect(popovers.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of popovers) {
    const name = file.replace("components/", "").replace(".vue", "");
    it(`${name}：面板根带 tabindex="-1"（一颗可聚焦的都没有时，焦点要落在根上）`, () => {
      const tpl = templateSource(file);
      const root = /<(section|div|aside)\b[\s\S]{0,400}?>/.exec(tpl)?.[0];
      expect(root, `${file} 的模板里切不出根标签`).toBeDefined();
      expect(root).toContain('ref="panel"');
      // 少了它，上面那句 `focus()` 静默失败（div/section 默认不可聚焦），
      // 症状是「焦点还是没进来」，也就是本族那个病。
      expect(root).toContain('tabindex="-1"');
    });

    it(`${name}：不许自己调 focus 把焦点请进来（真身在 composable 里）`, () => {
      // 同一件事的第二份实现：ComposerContextMenu 5-㊵ 之前就有一处，它落在面板还
      // visibility:hidden 的窗口里，静默失败且无人重试（p536nb 逐帧量到）。
      expect(scriptSource(file)).not.toMatch(/\w+\.value\?\.focus\(\)|\w+\.value!\.focus\(\)/);
    });
  }

  it("真身里「等可见」那一步不许被删（对 visibility:hidden 调 focus 是静默失败）", () => {
    const src = vueSource("composables/useComposerContextPopover.ts");
    expect(src).toContain("focusFirstWhenVisible");
    expect(src).toMatch(/getComputedStyle\(el\)\.visibility === "hidden"/);
    expect(src).toContain("requestAnimationFrame(retry)");
    // 退化成「nextTick 一次就 focus」就是回到那个静默失败的窗口里。
    expect(src).not.toMatch(/await nextTick\(\);\s*\n\s*\w+\.value\?\.focus\(\)/);
  });

  it("进层的完成判据是「焦点真的在层内」，不是「面板可见」（p536nd 埋点量到的第二层坑）", () => {
    const src = vueSource("composables/useComposerContextPopover.ts");
    // 面板 visible、按钮已渲染未禁用、面板在场，focus() 调了——activeElement 当场没动。
    // 只判「可见」就收工的实现，会在真机上继续失败而守卫全绿。
    expect(src).toMatch(/return el\.contains\(document\.activeElement\)/);
    // 少了重试预算，「下一帧再试」就是一句空话。
    expect(src).toMatch(/attempts >= \d+/);
  });
});

describe("模态层 · ToolRoster 已归 useModalFocus（它是这一族里唯一自己手写过的）", () => {
  it("ToolRoster 不再自带 Esc 裁决与进层 focus", () => {
    const src = scriptSource("components/ToolRoster.vue");
    expect(src).toContain(MODAL_IMPORT);
    // 自己再写一遍就是同一判定的第二份实现（5-㊵ 收编的理由）。
    expect(src).not.toMatch(/function onKeydown/);
    expect(src).not.toMatch(/onMounted\(\(\) => \w+\.value\?\.focus/);
    expect(templateSource("components/ToolRoster.vue")).not.toContain("@keydown");
  });
});

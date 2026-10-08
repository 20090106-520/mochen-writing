/**
 * 外观设置的接线契约（源码断言：本仓 verify 无 vue-tsc，.vue 零类型检查）。
 * 钉三件事：页签真身在 layoutStore、外观面板不直调 window.mochen、
 * 主题 preset 一键同时改写浅/深两套——只改一边就是「浅色墨宸、深色 Codex」的精神分裂。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const PAGE = "components/SettingsPage.vue";
const PANEL = "components/AppearancePanel.vue";

describe("设置中心 · 整页视图与分类", () => {
  it("分类真身仍在 layout.settingsTab，SettingsPage 不持第二份 tab 状态", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain("storeToRefs(layout)");
    expect(script).toContain("{ settingsTab }");
    expect(script).not.toMatch(/ref<SettingsTab>/);
  });

  it("四个分类挂在 SECTIONS 表与 template 挂载条件里（新增页不许绕开真身）", () => {
    const script = scriptSource(PAGE);
    const markup = templateSource(PAGE);
    expect(script).toContain('id: "model"');
    expect(script).toContain('id: "appearance"');
    expect(script).toContain('id: "shortcuts"');
    expect(script).toContain('id: "about"');
    // 钉组件名不带闭合尖括号：prettier 会把带 v-else-if 的自闭合标签折成多行。
    expect(markup).toContain("<ProviderSettings");
    expect(markup).toContain("<AppearancePanel");
    expect(markup).toContain("<HotkeysPanel");
    expect(markup).toContain("<AboutPanel");
    expect(markup).toContain("v-if=\"settingsTab === 'model'\"");
    expect(markup).toContain("v-else-if=\"settingsTab === 'appearance'\"");
    expect(markup).toContain("v-else-if=\"settingsTab === 'shortcuts'\"");
    expect(markup).toContain("v-else-if=\"settingsTab === 'about'\"");
  });

  it("侧栏搜索是真过滤：过滤逻辑读 SECTIONS 的 label+keywords，空结果有兜底文案", () => {
    const script = scriptSource(PAGE);
    const markup = templateSource(PAGE);
    expect(script).toContain("category.keywords");
    expect(script).toContain(".toLocaleLowerCase().includes(query)");
    expect(markup).toContain("没有匹配的设置项");
  });

  it("返回按钮调 layout.showWorkspace()，Esc 收起是同一条裁决链的 close-overlay 派发", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain("layout.showWorkspace()");
    expect(markup).toContain('aria-label="返回工作台"');
  });
});

describe("AppearancePanel · 改设置只经 useAppearanceStore.update", () => {
  it("不直调 window.mochen；皮肤名从 appearanceSkins 取（5-㊴ 起不再 import 运行时）", () => {
    const script = scriptSource(PANEL);
    expect(script).not.toContain("window.mochen");
    expect(script).toContain('from "../stores/useAppearanceStore"');
    // 5-㊴ 之前这里钉的是 appearanceThemeRuntime；那一版的配色网格退役之后，
    // 面板只需要「这套皮肤叫什么」——判据在 appearanceSkins，不在运行时。
    expect(script).toContain('from "../composables/appearanceSkins"');
    expect(script).not.toContain('from "../composables/appearanceThemeRuntime"');
  });

  it("applySkin 不在这个面板里了：配色网格随皮肤广场一起退役（2026-10-07 批次 5-㊴）", () => {
    // 这一条是**改钉**：原来这里钉的是 applyPreset 同时改写 light 与 dark 两套。
    // 5-㊴ 把「配色三色 + 质感四层」合成一条皮肤搬去皮肤广场，而网格留在这里
    // 就成了第二份可改的真相——用户在两处各换一次，两边显示的「当前」会各说各话。
    // 同款先例：5-㊜ 把技能/插件的两枚页签删掉而不是留成豁免。
    // 换皮肤要浅深两套一并应用那条保证**没有丢**，它搬到了
    // appearance-skins.test.ts 的「换皮肤一次写回三样」那一条里（逐项钉住）。
    const script = scriptSource(PANEL);
    expect(script).not.toContain("function applyPreset");
    expect(script).not.toContain("themePresets");
    const markup = templateSource(PANEL);
    expect(markup).not.toContain("appearance-preset-grid");
    expect(markup).not.toContain('@click="applyPreset');
  });

  it("面板改为只读地显示当前皮肤，并给一条去皮肤广场的路", () => {
    const script = scriptSource(PANEL);
    const markup = templateSource(PANEL);
    expect(script).toContain("currentSkinLabel");
    expect(script).toContain("findAppearanceSkin");
    expect(script).toContain('layout.showCenter("skins")');
    expect(markup).toContain("appearance-current-skin");
    expect(markup).toContain("去皮肤广场挑");
  });

  /**
   * 2026-10-08 第二刀：`appearanceTones.ts`（十套素面配色底版）**整份删除**。
   *
   * 【这一条为什么从「退回底版表」改成「不许再请出第二份表」】
   * 上一版在这里钉的是三级兜底：广场表 → 配色底版表 → 「未知」。
   * 用户看完那句裁定是「把没有皮肤没有图片的全删了，只保留有图片有皮肤的」，
   * 于是第二档连同它那张表一起没了。面板这里**不许再留任何一条通往素面配色的路径**：
   * 回落已经由 `useAppearanceStore.load()` 在数据层收口（`reconcileStoredSkin`），
   * 面板读到的 `settings.light.skin` 已经是表里真实存在的一套 ⇒ 那条兜底链一旦复活，
   * 它服务的就是「界面显示一套、屏幕上渲染另一套」，而这次删的正是这件事。
   *
   * 【最后一档「未知」为什么还留着】
   * 它今天不该被走到（load 已经回落），但它是**数据层以外那半条路的保险**：
   * `state.settings` 在 load 之前是 contracts 默认值，而 `sanitizeAppearanceTheme`
   * 之类的入口仍然可能带进一个陌生 id。留着并让它红，比编一个名字诚实。
   */
  it("回落归数据层，面板不许再 import 已删的配色底版表；已下架那套由 store 说实话", () => {
    const script = scriptSource(PANEL);
    const markup = templateSource(PANEL);
    for (const needle of ["appearanceTones", "findAppearanceTone", "素面配色，不在广场里卖"]) {
      expect(
        script,
        `面板里又出现了「${needle}」—— 那一族已经随「没有画面的皮肤」删掉了`
      ).not.toContain(needle);
    }
    // 面板仍然只认广场表这一个来源，且保留最后一档「未知」。
    expect(script).toContain("findAppearanceSkin");
    expect(script).toContain("未知的一套");
    // 说实话的那一句来自 store 的 `replacedSkinId`，不是面板自己查表猜的。
    expect(script).toContain("appearance.replacedSkinId");
    // 而且要说清**是哪一套**被换掉的：原 id 必须进文案（用户盘上的原话，不是我们编的名字）。
    expect(script).toMatch(/const retired = appearance\.replacedSkinId[\s\S]{0,220}\$\{retired\}/);
    /* 措辞跟着这一刀改口：那张表整个没了之后再说「已下架」，
       就是把「我们删了」说成「暂时没摆出来」——用户会去广场找那十套，一套都找不到。
       反向禁词读的是剥注释的 script，所以注释里那段历史交代不会反咬。 */
    expect(script).toContain("已经删除");
    for (const lie of ["已下架", "配色照旧能用", "仍可用"]) {
      expect(script, `面板那句还留着「${lie}」—— 素面那一族已经不存在了`).not.toContain(lie);
    }
    // 模板真渲染它，而那句 CSS 规则也在（本仓撞过「模板用了 class、规则忘了写」同一族）。
    expect(markup).toContain('v-if="retiredSkinNote"');
    expect(markup).toContain("appearance-retired-skin");
    const css = styleSource("settings-page.css");
    expect(ruleBlock(css, ".appearance-retired-skin")).toContain("var(--text-secondary)");
  });

  it("模式三态与两处字体下拉都落 update；模板没有硬编码颜色", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain("void appearance.update({ mode })");
    expect(script).toContain("void appearance.update({ uiFontFamily:");
    expect(script).toContain("void appearance.update({");
    expect(script).toContain("editorFontFamily: value as");
    const whole = vueSource(PANEL);
    expect(whole).not.toMatch(/(color|background|border)\s*:\s*#[0-9a-fA-F]/);
  });

  it("显示模式三态的选项是「跟随系统/浅色/深色」，顺序钉死", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain('{ value: "system", label: "跟随系统" }');
    expect(script).toContain('{ value: "light", label: "浅色" }');
    expect(script).toContain('{ value: "dark", label: "深色" }');
  });

  it("模式标签旁是 morphicons 变形钮：图标随 settings.mode 在 显示器/太阳/月亮 之间变形", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain('from "morphicons/vue"');
    expect(script).toContain('from "lucide"');
    // 三态图标映射是唯一一份（MODE_ICONS 表），modeIcon 从 store 派生。
    expect(script).toContain("MODE_ICONS = { system: Monitor, light: Sun, dark: Moon }");
    expect(script).toContain("computed(() => MODE_ICONS[appearance.settings.mode])");
    expect(templateSource(PANEL)).toContain("<MorphIcon");
    expect(templateSource(PANEL)).toContain(':icon="modeIcon"');
  });

  it("字号与半透明侧栏三项都落 update——它们住在 light/dark 两套主题里，写时一并应用、读浅色套", () => {
    const script = scriptSource(PANEL);
    // 2026-10-05 修复：这三个字段的 schema 位置是 light/dark 主题（不在 settings 顶层），
    // 旧写法 update({ uiFontSize }) 会被 zod 静默 strip——下拉永远空选、改了也从没生效过。
    expect(script).toContain("light: { ...appearance.settings.light, uiFontSize: value }");
    expect(script).toContain("dark: { ...appearance.settings.dark, uiFontSize: value }");
    expect(script).toContain("light: { ...appearance.settings.light, codeFontSize: value }");
    expect(script).toContain("dark: { ...appearance.settings.dark, codeFontSize: value }");
    expect(script).toContain(
      "light: { ...appearance.settings.light, translucentSidebar: enabled }"
    );
    expect(script).toContain("dark: { ...appearance.settings.dark, translucentSidebar: enabled }");
    // 顶层 patch 禁绝：写不存在的顶层键就是静默丢值（禁止摆设的变体）。
    expect(script).not.toContain("update({ uiFontSize:");
    expect(script).not.toContain("update({ codeFontSize:");
    expect(script).not.toContain("update({ translucentSidebar:");
    const markup = templateSource(PANEL);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain(':checked="appearance.settings.light.translucentSidebar"');
    expect(markup).toContain(':value="appearance.settings.light.uiFontSize"');
    expect(markup).toContain(':value="appearance.settings.light.codeFontSize"');
  });
});

/**
 * 「快捷键」「关于」两页的契约：键位文案与版本号都只能有一个真身——
 * 键位表真身在 utils/hotkey-guide.ts（一致性另有 hotkey-guide.test.ts 钉回判定层），
 * 版本真身在 electron.vite.config.ts 的 renderer.define（源头 package.json）。
 */
describe("HotkeysPanel / AboutPanel · 文案不抄第二份", () => {
  const HOTKEYS = "components/HotkeysPanel.vue";
  const ABOUT = "components/AboutPanel.vue";

  it("快捷键页只渲染 guide 表：模板里不许出现任何键位中文字面量或 Ctrl 键名", () => {
    const markup = templateSource(HOTKEYS);
    expect(markup).toContain("{{ group.title }}");
    expect(markup).toContain("{{ row.keys }}");
    expect(markup).toContain("{{ row.label }}");
    expect(markup).toContain("{{ ESCAPE_NOTE_PREFIX }}{{ ESCAPE_POLICY_SUMMARY }}");
    // 反向：键名（Ctrl/Enter/Shift/Esc…）与说明文字出现在 .vue 里 = guide 表之外的第二份抄写。
    for (const literal of ["Ctrl", "Enter", "Shift", "Esc", "打开作品目录", "排队", "批准"]) {
      expect(markup).not.toContain(literal);
    }
    expect(scriptSource(HOTKEYS)).toContain('from "../utils/hotkey-guide"');
  });

  it("关于页版本来自 import.meta.env.APP_VERSION 注入，事实表不写死版本号；归属文案不进 UI", () => {
    const script = scriptSource(ABOUT);
    expect(script).toContain("import.meta.env.APP_VERSION");
    expect(script).not.toMatch(/version:\s*"0\.\d/);
    // 归属/许可信息只住仓库文件（docs/ATTRIBUTION.md、LICENSE-DEEPWRITE.txt），UI 层不展示。
    const whole = vueSource(ABOUT);
    expect(whole).not.toContain("deepwrite");
    expect(whole).not.toContain("Apache");
  });
});

describe("AppearancePanel · 减少动效（2026-10-05 新增）", () => {
  it("开关走 utils/motion-preference：写偏好 + 落 <html> 属性，不碰 appearance:save", () => {
    const script = scriptSource(PANEL);
    const markup = templateSource(PANEL);
    expect(script).toContain('from "../utils/motion-preference"');
    expect(script).toMatch(
      /function setReducedMotion[\s\S]{0,180}saveReducedMotion\(storage, enabled\)/
    );
    expect(script).toMatch(
      /function setReducedMotion[\s\S]{0,220}applyReducedMotion\(document\.documentElement, enabled\)/
    );
    // 与半透明侧栏同一套开关形态（appearance-toggle + role=switch）；真身带 ($event)。
    expect(markup).toContain("减少动效");
    expect(markup).toMatch(
      /:checked="reducedMotion"[\s\S]{0,120}@change="setReducedMotion\(\$event\)"/
    );
  });

  it("面板里那枚 morphicons 的动效档跟着开关走（user ⇄ always），不再写死", () => {
    const markup = templateSource(PANEL);
    expect(markup).toContain(":reduced-motion=\"reducedMotion ? 'always' : 'user'\"");
  });

  it("App 挂载即应用档位；motion.css 有出场动画表 + html[data-reduced-motion] 总闸", () => {
    const app = vueSource("App.vue");
    expect(app).toContain(
      "applyReducedMotion(document.documentElement, loadReducedMotion(motionPreferenceStorage()))"
    );
    const css = styleSource("motion.css");
    expect(css).toContain("@keyframes mochen-pop-in");
    // 弹层出场挂的是同一张表（抽查四枚根类，含对话框）。
    for (const root of [
      ".tool-roster",
      ".model-select",
      ".conversation-history-panel",
      ".workspace-dialog"
    ]) {
      expect(css).toContain(root);
    }
    expect(css).toMatch(/html\[data-reduced-motion="true"\] \*,/);
    expect(css).toContain("animation-duration: 0.01ms !important");
    // 档位卡的按压手感也在这一层。
    expect(css).toContain(".agent-mode-card:active");
  });
});

/**
 * 2026-10-05 实机看下来的真 bug：暗色下白字压白底，按钮整个看不见。
 *
 * 成因是一对 token 走散了 —— `--neutral-solid` 会跟明暗翻（暗色下是
 * `foreground 92%` 混出来的近白一整块），而配对的 `--neutral-solid-contrast`
 * 在 styles.css 里被写死成 `#ffffff`，**没有暗色覆写**。于是暗色下
 * 「底色用 solid + 字色用 contrast」的所有地方（.send-button、.save-button、
 * .dialog-primary-button、.proposal-buttons .is-primary、编辑器 chip…）全是白压白。
 *
 * 这条测试钉住：这一对必须同时定义在同一个 `html[data-theme="dark"]` 块里。
 * 只补其中一个，下次谁动另一个就又瞎了。
 */
describe("实心键面 token · solid 与 contrast 必须一起翻", () => {
  const darkBlock = /html\[data-theme="dark"\]\s*{([^}]*)}/.exec(
    styleSource("theme-runtime.css")
  )?.[1];

  it("暗色块里 --neutral-solid 与 --neutral-solid-contrast 成对出现", () => {
    expect(darkBlock, 'theme-runtime.css 里找不到 html[data-theme="dark"] 块').toBeDefined();
    expect(darkBlock).toContain("--neutral-solid:");
    // 关键：contrast 必须跟着翻，否则暗色下白字压白底。
    expect(
      darkBlock,
      "暗色下 --neutral-solid-contrast 没有跟着翻 —— solid 在暗色是近白的一整块，" +
        "contrast 还钉死 #ffffff 就是白字压白底"
    ).toContain("--neutral-solid-contrast:");
  });

  it("contrast 不许被写死成 #ffffff（那正是暗色瞎掉的姿势）", () => {
    expect(darkBlock).not.toMatch(/--neutral-solid-contrast:\s*#fff/i);
  });
});

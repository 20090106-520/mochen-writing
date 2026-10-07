/**
 * #113c 输入卡上方「书 / 阶段」绑定条 + 阶段弹层 · 源码接线契约。
 * 真身：deepwrite ComposerContextBar.vue / ComposerContextMenu.vue / useComposerContextPopover.ts
 * 与 styles.css 的 .composer-context-* 段 + composer-context-menu.css。
 * 本仓 `.vue` 不进类型程序（裸 tsc + vue-shim），CSS 段更不在任何关卡覆盖内，所以结构、类名、
 * 接线与对齐的数值只能靠读源断言钉（先例：composer-card-wiring.test.ts、hotkey-markers.test.ts）。
 * vue-source-reader 会剥注释：只在注释里宣称「已经接上」不算数。
 *
 * 三条裁定一并反向钉：
 * R1 书那一格没有书目注册表契约（无 book:list 通道 / 无 recent-books），所以它退化为真动作
 *    pickAndOpen()，且**不许**挂 aria-haspopup、aria-expanded 或下拉三角——假弹层就是假控件。
 * R2 「找 activeStage 那一条」全仓只留 composer-context.ts 一份实现（铁律 6）。
 * R3 他的弹层有 book / library 两条本仓永不为真的分支，搬进来就得删干净；留着就是死路。
 */
import { describe, expect, it } from "vitest";
import {
  cardSection,
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const BAR = "components/ComposerContextBar.vue";
const MENU = "components/ComposerContextMenu.vue";
const POPOVER = "composables/useComposerContextPopover.ts";
const PLACEMENT = "utils/composer-context-placement.ts";
const CONTEXT = "utils/composer-context.ts";
const COMPOSER = "components/ComposerBox.vue";
const CENTER = "components/CenterColumn.vue";

function barMarkup(): string {
  return templateSource(BAR);
}

/**
 * 只看代码、不看注释的一份源：`.vue` 取剥过注释的 script + template 两段，散装 `.ts` 取剥过注释的全文。
 * 反着钉的断言（「这里没有 X」）必须用它——否则「这里没有 X」这句话自己写着 X 就能让断言红，
 * 而正着钉的断言用它则不会被注释里的宣称骗绿（先例：vue-source-reader 的诞生理由）。
 */
function codeOf(path: string): string {
  return path.endsWith(".vue") ? scriptSource(path) + templateSource(path) : typeScriptSource(path);
}

function tagOf(classNeedle: string): string {
  const m = barMarkup();
  return new RegExp(`<button[\\s\\S]*?${classNeedle}[\\s\\S]*?</button>`).exec(m)?.[0] ?? "";
}

describe("挂载点 · 条住在 .composer 的第一个子节点（照他的 v-if=messagesEmpty 位置）", () => {
  it("ComposerBox 只交出可见性与忙态，不自行判定线程空不空", () => {
    const m = templateSource(COMPOSER);
    const bar = m.indexOf("<ComposerContextBar");
    const surface = m.indexOf('class="composer-input-surface"');
    expect(bar).toBeGreaterThan(-1);
    expect(surface).toBeGreaterThan(bar);
    expect(m).toContain('<ComposerContextBar v-if="contextBarVisible" :running="running" />');
    expect(scriptSource(COMPOSER)).toContain("contextBarVisible: boolean");
    // 可见性只能是 prop：组件里没有第二份「线程空」判据。
    expect(scriptSource(COMPOSER)).not.toContain("threadEmpty");
  });

  it("CenterColumn 把六项条件收进 messagesEmpty 一个 computed，两个消费者共用", () => {
    const center = templateSource(CENTER);
    const script = scriptSource(CENTER);
    expect(center).toContain(':context-bar-visible="contextBarVisible"');
    expect(countNeedle("contextBarVisible", center), "绑定条只挂一次").toBe(1);
    expect(countNeedle("messagesEmpty", center), "空状态引用一次判据").toBe(1);
    // 门禁必须是 computed 的名字：六项条件裸写回模板就红（那会变成第二份实现）。
    const gate = /<div v-if="([^"]*)" class="conversation-empty">/.exec(center)?.[1];
    expect(gate, "空状态的门禁必须引用 messagesEmpty，不许把条件抄回模板").toBe("messagesEmpty");
    expect(script).toContain("const messagesEmpty = computed(");
    expect(script).toContain(
      "showContextBar({ hasBook: book.hasBook, threadEmpty: messagesEmpty.value })"
    );
  });
});

describe("绑定条两格 · 有真契约的那一格才许挂弹层（裁定 R1）", () => {
  it("条是 role=group 的一条三枚（书/阶段/文档），直接读 store，不再套一层 inject", () => {
    const m = barMarkup();
    const s = scriptSource(BAR);
    expect(m).toContain('class="composer-context-bar"');
    expect(m).toContain('role="group"');
    expect(countNeedle('class="composer-context-item', m)).toBe(3);
    expect(s).toContain("useBookStore()");
    expect(s).not.toContain("inject(");
    expect(m).toContain(':aria-label="`当前绑定：书籍 ${bookTitle}，阶段 ${stageLabel}`"');
  });

  it("书那一格：真入口 pickAndOpen，且没有假弹层的任何一件（haspopup/expanded/三角）", () => {
    const book = tagOf("composer-book-context");
    expect(book).toContain('class="composer-context-item composer-book-context"');
    expect(book).toContain('@click="void openAnotherBook()"');
    expect(book).toContain('title="打开另一部作品目录（与书架空态钮、Ctrl+O 同一个入口）"');
    expect(book).toContain('<AppIcon name="book" :size="16" />');
    expect(book).not.toContain("aria-haspopup");
    expect(book).not.toContain("aria-expanded");
    expect(book).not.toContain("chevron");
    expect(scriptSource(BAR)).toContain("await book.pickAndOpen()");
  });

  it("阶段那一格：haspopup + expanded + 下拉三角 + 弹层四件齐（这才叫有契约）", () => {
    const stage = tagOf("composer-stage-context");
    expect(stage).toContain('aria-haspopup="dialog"');
    expect(stage).toContain(':aria-expanded="menuOpen"');
    expect(stage).toContain('<AppIcon name="wand" :size="16" />');
    expect(stage).toContain('<AppIcon class="context-chevron" name="chevron" :size="12" />');
    expect(stage).toContain('@click="showMenu"');
    const m = barMarkup();
    expect(m).toContain("<ComposerContextMenu");
    expect(m).toContain('v-if="menuOpen && anchor"');
    expect(m).toContain('@select="void choose($event)"');
    expect(m).toContain('@close="menuOpen = false"');
  });

  it("忙态两枚一起禁用（书/阶段两枚，落盘在途或本轮在跑），disabled 判定只有一份来源", () => {
    const m = barMarkup();
    expect(countNeedle(':disabled="busy"', m)).toBe(2);
    expect(scriptSource(BAR)).toContain("book.metaSaving || props.running");
  });

  it("弹层收起只认「真的换成了点的那一档」：同档早退与被主进程拒绝都留着可见的 notice", () => {
    const s = scriptSource(BAR);
    expect(s).toContain("before !== id && book.meta?.activeStage === id");
    expect(s).toContain("await book.setActiveStage(id)");
  });

  it("写盘通路只有一条：store 的 setActiveStage 走 saveMeta，且非法档在渲染层先说清楚", () => {
    const store = typeScriptSource("stores/useBookStore.ts");
    expect(store).toContain("async setActiveStage(stageId: string): Promise<void>");
    expect(store).toContain("await window.mochen.saveMeta(next)");
    expect(store).toContain("这一档不在本书的阶段列表里，没去改。");
    expect(store).not.toContain("this.meta.activeStage = stageId");
  });
});

describe("阶段弹层真身 · 对齐他的 DOM 与键盘，删干净永不为真的分支（裁定 R3）", () => {
  it("Teleport 到 body 的 role=dialog：标题、搜索、列表、空态四段类名沿用他的", () => {
    const m = templateSource(MENU);
    expect(m).toContain('<Teleport to="body">');
    expect(m).toContain('class="composer-context-menu"');
    expect(m).toContain('role="dialog"');
    expect(m).toContain("选择本书阶段");
    expect(m).toContain('class="context-search"');
    expect(m).toContain('class="context-option"');
    expect(m).toContain("阶段列在作品目录的 book.json 里");
    expect(countNeedle('class="context-option-icon"', m)).toBe(1);
  });

  it("删掉的 book / library 分支不许随注释一起活回来：代码里找不到它们", () => {
    // 文件头的 HTML 注释里写了「删掉了 book / library 两个分支」，所以这条只能钉在剥过注释的代码上。
    expect(codeOf(MENU)).not.toContain("library");
    expect(codeOf(MENU)).not.toContain('kind === "book"');
    expect(codeOf(MENU)).not.toContain("bookTitle");
  });

  it("裸 Esc 走 popoverOwnsKey（输入法组合中不算），模板里不写裸比较", () => {
    const s = scriptSource(MENU);
    expect(s).toContain("popoverOwnsKey(event.key, mods, event.isComposing === true)");
    expect(s).not.toContain('"Escape"');
    expect(s).toContain('["ArrowDown", "ArrowUp"].includes(event.key)');
    expect(s).toContain("tab(event)");
  });

  it("跟随与收起住在 composable，五个数值住在纯函数（那里有测试，这里只钉分界）", () => {
    expect(scriptSource(MENU)).toContain("useComposerContextPopover(");
    expect(typeScriptSource(POPOVER)).toContain("composerPopoverPlacement({");
    expect(typeScriptSource(POPOVER)).not.toContain("320");
    expect(typeScriptSource(POPOVER)).not.toContain("260");
    expect(countNeedle("export const POPOVER_", typeScriptSource(PLACEMENT))).toBe(5);
    expect(typeScriptSource(PLACEMENT)).toContain('side: upward ? "bottom" : "top"');
  });

  it("注册表在 onMounted / onBeforeUnmount 成对拆干净（resize 与滚动都走同一调度）", () => {
    const s = typeScriptSource(POPOVER);
    for (const needle of [
      'document.addEventListener("pointerdown", outside)',
      'document.removeEventListener("pointerdown", outside)',
      'document.addEventListener("focusin", outside)',
      'document.removeEventListener("focusin", outside)',
      'document.addEventListener("scroll", schedulePosition, true)',
      'document.removeEventListener("scroll", schedulePosition, true)'
    ]) {
      expect(s, `${needle} 必须有对侧`).toContain(needle);
    }
  });
});

describe("裁定 R2 · 阶段查表全仓只留 composer-context.ts 一份", () => {
  it("stages.find 只住在 composer-context.ts 一份，消费者一律调命名查表", () => {
    // 裁定的本意是「查表只有一处实现」，不是「整个文件只许 find 一次」。
    // 2026-10-05 起本模块有两处具名查表：activeStageOf（当前阶段）与 matchStageName（按名反查，
    // 给 /stage 用）。两者都对外具名，所以真正要守的是下面那条：消费者一律不许自己 find。
    expect(countNeedle("stages.find(", typeScriptSource(CONTEXT))).toBeGreaterThanOrEqual(1);
    for (const name of ["activeStageOf", "matchStageName"]) {
      expect(
        typeScriptSource(CONTEXT),
        `阶段查表 ${name} 必须留在 composer-context.ts 并对外具名`
      ).toContain(`export function ${name}(`);
    }
    for (const file of [
      CENTER,
      BAR,
      MENU,
      "utils/book-dossier.ts",
      "stores/useAgentStore.ts",
      "stores/useBookStore.ts"
    ]) {
      expect(codeOf(file), `${file} 不许自己再 find 一次`).not.toContain("stages.find(");
    }
    // 2026-10-05：顶栏标题改报**档案名**（`profile-options.conversationTitleLabel`）之后，
    // CenterColumn 彻底不再消费阶段查表——它与阶段无关了。
    // 「标题不许退回 `${stage.name}智能体`」由 center-header-actions.test.ts 的顶栏那组钉着；
    // 这里只留它在名单里的事实：既没自己 find，也没把阶段拼回任何地方。
    expect(codeOf(CENTER), "CenterColumn 已与阶段无关，不该再出现 activeStageOf").not.toContain(
      "activeStageOf"
    );
    expect(typeScriptSource("utils/book-dossier.ts")).toContain("activeStageOf(meta)");
    expect(typeScriptSource("stores/useAgentStore.ts")).toContain(
      "stageName: stageLabelOf(book.meta)"
    );
  });

  it("选项表由 composer-context.ts 驱动：条里不出现第二份 icon/label 判定", () => {
    const s = scriptSource(BAR);
    expect(s).toContain("stageContextOptions(book.meta, busy.value)");
    expect(s).toContain("stageLabelOf(book.meta)");
    expect(barMarkup()).not.toContain("option.icon ?");
  });
});

describe("样式硬门禁 · 对齐他的原值，色值一律走 token", () => {
  it("绑定条的几何一字不改（scoped 与全局段撞到的属性落成净效果）", () => {
    const pane = cardSection("agent-pane.css");
    const bar = ruleBlock(pane, ".composer-context-bar");
    for (const value of [
      "gap: 8px",
      "width: calc(100% - 28px)",
      "min-height: 58px",
      "margin: 0 14px -15px",
      "padding: 5px 10px 20px",
      "border-radius: 21px"
    ]) {
      expect(bar, `.composer-context-bar 缺 ${value}`).toContain(value);
    }
    const item = ruleBlock(pane, ".composer-context-item");
    expect(item).toContain("min-height: 34px");
    expect(item).toContain("border: 1px solid transparent");
    expect(item).toContain("border-radius: 9px");
    expect(item).toContain("font-size: 0.857143rem");
    expect(ruleBlock(pane, ".composer-book-context")).toContain("max-width: min(58%, 360px)");
  });

  it("忙态不给 pointer 手势（与 .round-tool-button:disabled 同一条裁定），reduced-motion 有对应变体", () => {
    const pane = cardSection("agent-pane.css");
    const off = ruleBlock(pane, ".composer-context-item:disabled");
    expect(off).toContain("cursor: default");
    expect(off).toContain("opacity: 0.6");
    expect(pane).toContain("@media (prefers-reduced-motion: reduce)");
    expect(pane).toContain("@container composer (max-width: min(32rem, 560px))");
  });

  it("弹层样式整段搬进卡片分段，深色覆写用 html[data-theme=dark] 而不是 :global（非 scoped 表里 :global 会被丢掉）", () => {
    const pane = cardSection("agent-pane.css");
    const menu = ruleBlock(pane, ".composer-context-menu");
    expect(menu).toContain("z-index: 1000");
    expect(menu).toContain("border-radius: 18px");
    expect(menu).toContain("backdrop-filter: blur(18px) saturate(1.15)");
    expect(pane).toContain('html[data-theme="dark"] .composer-context-menu');
    expect(pane).not.toContain(":global(");
    for (const selector of [
      ".context-picker-heading",
      ".context-search",
      ".context-option",
      ".context-current",
      ".context-picker-empty"
    ]) {
      expect(ruleBlock(pane, selector), `${selector} 必须真有一条规则`).not.toBe("");
    }
  });

  it("底色与阴影住在 theme-runtime.css（卡片分段零色值字面量的门禁因此照样绿）", () => {
    const theme = styleSource("theme-runtime.css");
    const bar = ruleBlock(theme, "html[data-theme] .composer-context-bar");
    expect(bar).toContain("background: var(--surface-muted)");
    expect(bar).toContain("box-shadow:");
    expect(bar).not.toMatch(/rgba?\(/);
    expect(bar).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(countNeedle("html[data-theme] .composer-context-item >", theme)).toBe(2);
  });

  it("卡片分段继续零色值：新增的条与弹层没有夹进一个十六进制或 rgb()", () => {
    const pane = cardSection("agent-pane.css");
    expect(pane, "卡片分段含十六进制色值字面量").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(pane, "卡片分段含 rgb()/rgba()").not.toMatch(/\brgba?\(/);
  });
});

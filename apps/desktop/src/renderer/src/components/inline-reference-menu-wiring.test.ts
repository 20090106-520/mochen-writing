/**
 * 行内引用菜单 · 源码契约（#106）。
 * 本仓 `.vue` 不进类型程序（裸 tsc + vue-shim）、没有 jsdom，所以「菜单长在哪、条目从哪来、
 * 键在谁手里」这三件事只能靠读源钉死（先例：composer-card-wiring.test.ts、model-select-wiring.test.ts）。
 * 参考真身：deepwritecomponents/ConversationComposer.vue 的菜单段 +
 * composables/useConversationComposer.ts 的判定段 + styles.css 的 composer-reference-* 段。
 * 钉住的裁定：
 * D1 `/` 的真身只有一处——SlashPalette.vue 已删，命令条目与可用性闸（availableCommands）只有一个消费者；
 * D2 Enter/Esc 的裁决只在 utils/hotkeys.ts + utils/escape-policy.ts，组件里不出现内联键判断；
 * D3 Tab 排队不被菜单吃掉——源序里 Tab 判定必须先于菜单判定；
 * D4 菜单锚在 `.composer-input-surface`（向上开、整卡宽），不是 `.composer-toolbar-right` 的子节点，
 *    权限弹层的定位祖先仍是 `.composer-toolbar-right`。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
// 读 CSS 的三株助手住在 utils/vue-source-reader（原先与本文件各抄一份，铁律 6）。
import {
  cardSection,
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const MENU = "components/ComposerReferenceMenu.vue";
const COMPOSER = "components/ComposerBox.vue";
const CENTER = "components/CenterColumn.vue";
const STORE = "stores/useReferenceMenuStore.ts";
const UTIL = "utils/inline-reference-menu.ts";
const HOTKEYS = "utils/hotkeys.ts";
const ESCAPE = "utils/escape-policy.ts";
const SHELL = "composables/useHotkeys.ts";
const COMPONENT_DIR = new URL("../components/", import.meta.url);

/** 全组件目录的 .vue 原文（跳过测试文件：契约测试自己写着 needle，不该被自己数进去）。 */
function componentSources(): { file: string; text: string }[] {
  return readdirSync(COMPONENT_DIR)
    .filter((name) => name.endsWith(".vue"))
    .map((name) => ({
      file: name,
      text: readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8")
    }));
}

describe("菜单本体 · 对齐 deepwrite 的 composer-reference-* 骨架", () => {
  it("宿主组件存在，类名逐段对齐参考源（-menu/-heading/-trigger/-options/-icon/-copy/-token/-empty/-footer）", () => {
    const m = templateSource(MENU);
    for (const cls of [
      "composer-reference-menu",
      "composer-reference-heading",
      "composer-reference-trigger",
      "composer-reference-options",
      "composer-reference-icon",
      "composer-reference-copy",
      "composer-reference-token",
      "composer-reference-empty",
      "composer-reference-footer"
    ]) {
      expect(m, `菜单骨架缺 .${cls}`).toContain(`class="${cls}"`);
    }
    expect(m).toContain('role="listbox"');
    expect(m).toContain('role="option"');
    expect(m).toContain(":aria-selected=");
  });

  it("页脚两枚 span 各恰好一次：↑↓ 选择 与 Enter 插入；Esc 的 kbd 住在标题行（照参考源，不在页脚）", () => {
    const m = templateSource(MENU);
    const source = vueSource(MENU);
    expect(countNeedle("<kbd>↑</kbd><kbd>↓</kbd> 选择", m)).toBe(1);
    expect(countNeedle("<kbd>Enter</kbd> 插入", m)).toBe(1);
    expect(countNeedle("<kbd>Esc</kbd>", m)).toBe(1);
    // Esc 那枚 kbd 必须在 footer 之前（标题行），页脚里不许再长出第三个 kbd 组。
    expect(m.indexOf("<kbd>Esc</kbd>")).toBeLessThan(m.indexOf("composer-reference-footer"));
    expect(m.slice(m.indexOf("composer-reference-footer")).indexOf("<kbd>Esc</kbd>")).toBe(-1);
    expect(source).toContain("选择");
  });

  it("条目来自 store 的一份列表：模板里没有第二份命令表/标签表/引用文本", () => {
    const m = templateSource(MENU);
    const s = scriptSource(MENU);
    expect(m).toContain('v-for="(option, index) in menu.visibleOptions"');
    expect(m).not.toContain("素材："); // 引用文本的构造口径只住 utils
    for (const dead of ["SLASH_COMMANDS", "SLASH_COMMAND_DESCRIPTIONS", "BOOK_KIND_LABELS"]) {
      expect(s, `${dead} 属于 .ts 表，组件不许自持`).not.toContain(dead);
      expect(m).not.toContain(dead);
    }
  });

  it("标题/提示/图标全部由 REFERENCE_MENU_COPY 那张表驱动（模板不自行判定触发符）", () => {
    const m = templateSource(MENU);
    // 2026-10-05 起：根条件就是 menu.copy（开着 ⟺ 非空，copy 表按触发符全量），
    // 绑定全部非空——不许再出现给 AppIcon 喂可空值的 `?.`（空壳图标防线，icons-coverage 同口径）。
    expect(m).toContain('v-if="menu.copy"');
    expect(m).toContain("menu.copy.title");
    expect(m).toContain("menu.copy.hint");
    expect(m).toContain("menu.copy.icon");
    expect(m).not.toContain("menu.copy?.");
    expect(m).not.toContain('=== "/"');
    expect(m).not.toContain('=== "@"');
    // 触发符字符本身也从 store 来（标题行与每行右端的 token 共用同一份）。
    expect(m).toContain("menu.trigger");
  });

  it("点条目用 mousedown.prevent（保住 textarea 焦点），悬停挪高亮——deepwrite 的两条手势原样", () => {
    const m = templateSource(MENU);
    expect(m).toContain("@mousedown.prevent=");
    expect(m).toContain("@mouseenter=");
    expect(m).toContain("menu.select(option)");
    expect(m).toContain("menu.activate(index)");
  });
});

describe("裁定 D2 · 键位裁决只在 utils，组件里一份都不许留", () => {
  it("菜单组件不吃键：没有 keydown、没有 event.key、没有裸 Enter/Escape/ArrowUp 字面量", () => {
    const s = scriptSource(MENU);
    const source = vueSource(MENU);
    expect(s).not.toContain("keydown");
    expect(source).not.toContain(".key ===");
    expect(source).not.toContain("event.key");
    for (const key of ['"Enter"', '"Escape"', '"ArrowUp"', '"ArrowDown"', '"Tab"']) {
      expect(s, `组件里不许自持键名 ${key}`).not.toContain(key);
    }
  });

  it("新决策项进了既有枚举：HotkeyAction 三枚 + HotkeyFocus 一个标志 + EscapeAction 一枚", () => {
    const hotkeys = readFileSync(new URL(`../${HOTKEYS}`, import.meta.url), "utf8");
    for (const action of ["reference-insert", "reference-move-up", "reference-move-down"]) {
      expect(hotkeys).toContain(`"${action}"`);
    }
    expect(hotkeys).toContain("referenceMenuIsOpen: boolean");
    const escape = readFileSync(new URL(`../${ESCAPE}`, import.meta.url), "utf8");
    expect(escape).toContain('"close-reference-menu"');
    expect(escape).toContain("referenceMenuIsOpen: boolean");
  });

  it("裁决链的先后：Esc 收菜单排在收设置浮层与打断之前（一层一层收，Esc 不越级打断）", () => {
    const escape = readFileSync(new URL(`../${ESCAPE}`, import.meta.url), "utf8");
    // 钉的是**裁决语句**的先后，不是字段名：字段在 interface 里的声明顺序先于任何 return，
    // 用 indexOf("referenceMenuIsOpen") 会一直命中那行声明 ⇒ 把两支 return 对调也照样绿（变异轮实测）。
    expect(escape.indexOf('return "close-reference-menu"')).toBeLessThan(
      escape.indexOf('return "close-overlay"')
    );
    expect(escape.indexOf('return "close-overlay"')).toBeLessThan(
      escape.indexOf('return "interrupt"')
    );
  });

  it("接线层把三个动作与收菜单派到 store：dispatch 的 switch 里都有分支", () => {
    const shell = readFileSync(new URL(`../${SHELL}`, import.meta.url), "utf8");
    for (const needle of [
      'case "reference-move-up"',
      'case "reference-move-down"',
      'case "reference-insert"',
      'case "close-reference-menu"'
    ]) {
      expect(shell, `useHotkeys.ts 缺分支 ${needle}`).toContain(needle);
    }
    expect(shell).toContain("referenceMenuIsOpen");
  });
});

describe("裁定 D3 · Tab 排队不被菜单吃掉（源序即证据）", () => {
  it("hotkeys.ts 里 Tab 判定在菜单判定之前，菜单分支自己不碰 Tab", () => {
    const hotkeys = readFileSync(new URL(`../${HOTKEYS}`, import.meta.url), "utf8");
    const tab = hotkeys.indexOf('k === "Tab"');
    // 找派发点而不是找联合里的成员名：类型声明住在文件头部，比一切分支都早，拿它比序没有意义。
    const menu = hotkeys.indexOf('{ action: "reference-insert" }');
    expect(tab).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(tab);
    const block = hotkeys.slice(hotkeys.indexOf("referenceMenuIsOpen &&"), menu);
    expect(block).not.toContain('"Tab"');
  });
});

describe("裁定 D1 · `/` 的真身只有一个", () => {
  it("SlashPalette.vue 已退役：组件、挂载点、面板类名与样式段全部不见", () => {
    expect(existsSync(new URL("../components/SlashPalette.vue", import.meta.url))).toBe(false);
    expect(vueSource(CENTER)).not.toContain("SlashPalette");
    expect(vueSource(CENTER)).not.toContain("paletteOpen");
    const css = styleSource("interaction.css");
    for (const dead of [".slash-mask", ".slash-palette", ".slash-input", ".slash-list"]) {
      expect(css, `${dead} 是零消费者化石`).not.toContain(dead);
    }
  });

  it("命令表与可用性闸只有一个消费者：availableCommands 只在 store 里被调一次", () => {
    const hits = componentSources().filter((item) => item.text.includes("availableCommands"));
    expect(hits).toEqual([]);
    const store = readFileSync(new URL(`../${STORE}`, import.meta.url), "utf8");
    expect(countNeedle("availableCommands", store)).toBe(2); // import 一次 + 调用一次
    expect(store).toContain('from "../utils/slash-commands"');
  });

  it('三个唤起处全部接到行内菜单：chip 事件、裸 / 键、工作台 pill 都走 summon("/")', () => {
    const center = vueSource(CENTER);
    const app = vueSource("App.vue");
    // 热键监听随设置中心整页化上移到 App.vue（设置视图下 CenterColumn 会被卸载）：
    // 脚本里那处双引号（openPalette 回调）在 App.vue；CenterColumn 保留模板 chip 事件（单引号）
    // 与脚本里工作台 pill 的 handler（双引号）各一处。
    expect(countNeedle('summon("/")', center)).toBe(1);
    expect(countNeedle("summon('/')", center)).toBe(1);
    expect(app).toContain("openPalette: () => {");
    expect(app).toContain('referenceMenu.summon("/")');
    expect(center).toContain(`@open-palette="referenceMenu.summon('/')"`);
  });

  it("#112 卡上那枚 `＋` 接的是 @ 素材：它发出的事件必须落到 summon('@')，不是另一套自造菜单", () => {
    const center = vueSource(CENTER);
    expect(center).toContain(`@open-mention="referenceMenu.summon('@')"`);
    expect(countNeedle(`summon('@')`, center)).toBe(1);
  });

  it("命令仍由唯一派发口执行：组件里不许出现 runSlashCommand", () => {
    const hits = componentSources().filter((item) => item.text.includes("runSlashCommand"));
    expect(hits).toEqual([]);
    const store = readFileSync(new URL(`../${STORE}`, import.meta.url), "utf8");
    expect(store).toContain("runSlashCommand");
  });
});

describe("裁定 D4 / #105 不回归 · 锚点与卡骨架", () => {
  it("菜单挂在 .composer-input-surface 之内、.composer-toolbar-right 之外", () => {
    const m = templateSource(COMPOSER);
    const surface = m.indexOf('class="composer-input-surface"');
    const toolbar = m.indexOf('class="composer-toolbar"');
    const right = m.indexOf('class="composer-toolbar-right"');
    const mount = m.indexOf("<ComposerReferenceMenu");
    expect(surface).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(surface);
    expect(mount).toBeLessThan(toolbar);
    expect(mount).toBeLessThan(right);
  });

  it("权限弹层的定位祖先没被抢走：卡片段里仍只有 .composer-toolbar-right .permission-menu 这一条覆盖", () => {
    const pane = cardSection("agent-pane.css");
    expect(ruleBlock(pane, ".composer-toolbar-right")).toContain("position: relative");
    expect(pane).toContain(".composer-toolbar-right .permission-menu");
    expect(pane).not.toContain(".composer-toolbar-right .composer-reference-menu");
  });

  it("菜单锚在 surface：absolute 向上开、整卡宽、圆角 16、阴影两段走 color-mix", () => {
    const pane = cardSection("agent-pane.css");
    const block = ruleBlock(pane, ".composer-reference-menu");
    expect(block).toContain("position: absolute");
    expect(block).toContain("bottom: calc(100% + 8px)");
    expect(block).toContain("left: 0");
    expect(block).toContain("right: 0");
    expect(block).toContain("border-radius: 16px");
    expect(block).toContain("box-shadow");
  });

  it("新增 CSS 行零色值字面量（#105 的关卡继续咬得住）", () => {
    for (const file of ["agent-pane.css", "interaction.css"]) {
      const section = cardSection(file);
      expect(section, `${file} 卡片段含十六进制色值字面量`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(section, `${file} 卡片段含 rgb()/rgba()`).not.toMatch(/\brgba?\(/);
    }
    expect(cardSection("agent-pane.css")).toContain(".composer-reference-menu");
  });

  it("#105 三条裁定没被菜单顶掉：rows=1 自增高、textarea 不 disabled、发送/stop 仍同位互斥", () => {
    const m = templateSource(COMPOSER);
    const ta = /<textarea[\s\S]*?>/.exec(m)?.[0] ?? "";
    expect(ta).toContain('rows="1"');
    expect(ta).not.toContain(":disabled");
    expect(m).toContain('v-if="counter.over || counter.near"');
    expect(m).toContain('v-if="running"');
    expect(m).toContain("v-else");
  });
});

describe("store · 只做状态与接线，判定在 utils、DOM 在组件", () => {
  it("草稿只经 setDraft 写回，store 不碰 DOM，也不直接动 composerDrafts", () => {
    const store = readFileSync(new URL(`../${STORE}`, import.meta.url), "utf8");
    expect(store).toContain("setDraft(");
    expect(store).not.toContain("composerDrafts");
    for (const dom of ["document", "querySelector", "selectionStart", "focus("]) {
      expect(store, `store 不该出现 DOM：${dom}`).not.toContain(dom);
    }
  });

  it("判定层的三个真身都从这里 import，组件里没有第二份", () => {
    const store = readFileSync(new URL(`../${STORE}`, import.meta.url), "utf8");
    for (const needle of [
      "findReferenceMatch",
      "resolveReferenceSelection",
      "moveReferenceIndex",
      "REFERENCE_MENU_COPY"
    ]) {
      expect(store).toContain(needle);
    }
    const util = readFileSync(new URL(`../${UTIL}`, import.meta.url), "utf8");
    expect(util).toContain("SLASH_COMMAND_DESCRIPTIONS");
    expect(util).toContain("BOOK_KIND_LABELS");
    expect(util).toContain("@素材："); // 引用文本模板只住这一处
  });

  it("`@` 空态那句话仍由表来，组件模板不写第二份中文", () => {
    const m = templateSource(MENU);
    expect(m).toContain("menu.emptyText");
    expect(m).not.toContain("这本书里还没有");
  });
});

/**
 * #113e-4 「历史对话」浮层 · 源码接线契约。
 * 真身：deepwrite ConversationHistoryMenu.vue（324 行）+ styles/conversation-history.css（175 行全局表）。
 * 本仓 `.vue` 不进类型程序（裸 tsc + vue-shim），CSS 段更不在任何关卡覆盖内，所以结构、类名、
 * 接线与对齐的数值只能靠读源断言钉（先例：composer-context-bar-wiring.test.ts、hotkey-markers.test.ts）。
 * vue-source-reader 会剥注释：只在注释里宣称「已经接上」不算数。
 *
 * 三条裁定一并反向钉：
 * R1 他的面板有 delete / restore / export / 全部-已删除页签四件本仓没有通路的东西（没有软删通道、
 *    没有导出通道），一律不复用；搬进来就是点了没反应的假控件（铁律⑥）。
 * R2 行禁用的四句理由只有 session-row-action.ts 一份真身，组件只转达 `action.reason`，
 *    自己不再拼句子（铁律①）。
 * R3 时间格式化只有 utils/history-time.ts 一份，组件里不许出现第二个 toLocaleTimeString。
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

const MENU = "components/ConversationHistoryMenu.vue";
const CENTER = "components/CenterColumn.vue";
const TIME = "utils/history-time.ts";
const ROW = "utils/session-row-action.ts";

function markup(): string {
  return templateSource(MENU);
}

/**
 * 只看代码、不看注释的一份源：反着钉的断言必须用它——否则「这里没有已删除」这句话自己写着
 * 「已删除」就能让断言红；正着钉用它则不会被注释里的宣称骗绿。
 */
function codeOf(path: string): string {
  return path.endsWith(".vue") ? scriptSource(path) + templateSource(path) : typeScriptSource(path);
}

function cssRule(selector: string): string {
  return ruleBlock(styleSource("conversation-history.css"), selector);
}

describe("触发钮 · 弹层契约五件齐（这一格有真通路，才许挂 haspopup）", () => {
  it("header-text-button + history 图标 + 文案，a11y 五件一个不少", () => {
    const m = markup();
    // 触发钮是模板里的第一枚 `<button>`：按 tag 取而不是整份切片，否则弹层里的钮会把属性算到它头上。
    const trigger = /<button[\s\S]*?<\/button>/.exec(m)?.[0] ?? "";
    expect(m).toContain('class="conversation-history-control"');
    expect(trigger).toContain('class="header-text-button"');
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain(':aria-expanded="open"');
    expect(trigger).toContain(':aria-controls="panelId"');
    expect(trigger).toContain('aria-label="历史对话"');
    expect(trigger).toContain('<AppIcon name="history" :size="16" />');
    expect(trigger).toContain("历史对话");
  });

  it("没有书就没有历史可看：禁用判定直读 store 的 hasBook，理由写在 title 上", () => {
    const s = scriptSource(MENU);
    expect(markup()).toContain(':disabled="!book.hasBook"');
    expect(markup()).toContain(':title="triggerReason"');
    expect(s).toContain("useBookStore()");
    expect(s).toContain("还没有打开作品目录，没有历史对话可看。");
  });

  it("打开时拉一次总览：数据源只有 agent.refreshSessions 这一条通路", () => {
    const s = scriptSource(MENU);
    expect(s).toContain("watch(open");
    expect(s).toContain("await agent.refreshSessions()");
    expect(s).toContain("useAgentStore()");
  });
});

describe("面板真身 · 对齐他的 DOM 与 a11y，删干净永不为真的分支（裁定 R1）", () => {
  it("遮罩 + section[role=dialog] + 头部计数 + 关闭钮四件", () => {
    const m = markup();
    expect(m).toContain('class="conversation-history-dismiss"');
    expect(m).toContain('aria-hidden="true"');
    expect(m).toContain('@mousedown="open = false"');
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-label="历史对话"');
    expect(m).toContain(':id="panelId"');
    expect(m).toContain("<strong>历史对话</strong>");
    expect(m).toContain("{{ agent.sessions.length }} 条");
    expect(m).toContain('aria-label="关闭历史对话"');
    expect(m).toContain('<AppIcon name="close" :size="15" />');
  });

  it("收起只认 Esc 一条路：@keydown.esc.stop 挂在容器上，组件不自己 addEventListener", () => {
    const m = markup();
    expect(countNeedle('@keydown.esc.stop="open = false"', m)).toBe(1);
    expect(codeOf(MENU)).not.toContain("addEventListener");
    expect(scriptSource(MENU)).not.toContain('"Escape"');
  });

  it("删掉的四件不许随注释一起活回来：代码里找不到删除/恢复/导出/页签", () => {
    const code = codeOf(MENU);
    for (const dead of [
      "已删除",
      "恢复",
      "导出当前对话",
      "trash",
      "DeleteDialog",
      "managementAvailable"
    ]) {
      expect(code, ` ConversationHistoryMenu 里不该有 ${dead}`).not.toContain(dead);
    }
    expect(markup()).not.toContain("conversation-history-row");
    expect(markup()).not.toContain("conversation-history-manage");
    expect(markup()).not.toContain("conversation-history-tabs");
    expect(markup()).not.toContain("conversation-history-export");
  });
});

describe("每一行 · 判定只从 store 的 rowActionFor 取（裁定 R2）", () => {
  it("v-for 的键是 sessionId，当前行两件（is-current + aria-current），非 open 一律 disabled", () => {
    const m = markup();
    expect(m).toContain('v-for="item in agent.sessions"');
    expect(m).toContain(':key="item.sessionId"');
    expect(m).toContain('class="conversation-history-item"');
    expect(m).toContain(":class=\"{ 'is-current': rowOf(item).kind === 'current' }\"");
    expect(m).toContain(':aria-current="rowOf(item).kind');
    expect(m).toContain(":disabled=\"rowOf(item).kind !== 'open'\"");
    expect(m).toContain(':title="titleOf(item)"');
    expect(m).toContain('@click="pick(item)"');
  });

  it("行内三件套：标题、时间、文稿名——没有用户输入时说实话，不拿章名冒充", () => {
    const m = markup();
    expect(m).toContain('class="conversation-history-copy"');
    expect(m).toContain('class="conversation-history-title-row"');
    expect(m).toContain('item.title === "" ? "（这一条还没有用户输入）" : item.title');
    expect(m).toContain('<time :datetime="item.startedAt">');
    expect(m).toContain("formatHistoryTime(item.startedAt)");
    expect(m).toContain("<small>{{ docLabel(item) }}</small>");
  });

  it("标题取真文稿名，查不到就退回相对路径（不编一个好看的）", () => {
    const s = scriptSource(MENU);
    expect(s).toContain("book.refOf(");
    expect(s).toContain("?? item.docRelPath");
  });

  it("四句禁用理由一句都不在组件里：全部来自 session-row-action.ts", () => {
    const code = codeOf(MENU);
    for (const reason of [
      "回复完成或停止后可切换",
      "这条对话没有绑定文稿",
      "这条对话的文稿已经不在书里",
      "正在看这一条"
    ]) {
      expect(code, `${reason} 只能住在 ${ROW}`).not.toContain(reason);
    }
    expect(scriptSource(MENU)).toContain("agent.rowActionFor(");
    expect(scriptSource(MENU)).toContain("await agent.showSession(item)");
  });

  it("空态两条文案：正在读取 / 还没有历史对话", () => {
    const m = markup();
    expect(m).toContain('class="conversation-history-empty"');
    expect(m).toContain('{{ loading ? "正在读取对话" : "还没有历史对话" }}');
    expect(m).toContain('<AppIcon name="history" :size="22" />');
  });
});

describe("裁定 R3 · 时间格式化只有一份", () => {
  it("组件调 formatHistoryTime，且组件代码里没有 toLocaleTimeString/toLocaleDateString", () => {
    expect(scriptSource(MENU)).toContain('from "../utils/history-time"');
    const code = codeOf(MENU);
    expect(code).not.toContain("toLocaleTimeString");
    expect(code).not.toContain("toLocaleDateString");
  });

  it("工具里两条 Intl 各一次，且没有第二份 Date.parse 兜底", () => {
    const s = typeScriptSource(TIME);
    expect(countNeedle('toLocaleTimeString("zh-CN"', s)).toBe(1);
    expect(countNeedle('toLocaleDateString("zh-CN"', s)).toBe(1);
    expect(countNeedle("Date.parse(", s)).toBe(1);
  });
});

describe("挂载点 · 中栏头部，排在「新建对话」之前", () => {
  it("CenterColumn 只挂一次，且在同一个 actions 格里", () => {
    const m = templateSource(CENTER);
    const at = m.indexOf("<ConversationHistoryMenu />");
    const newChat = m.indexOf("新建对话");
    expect(at).toBeGreaterThan(-1);
    expect(newChat).toBeGreaterThan(-1);
    expect(at, "历史对话在 deepwrite 的头部里排在「新建对话」之前").toBeLessThan(newChat);
    expect(countNeedle("<ConversationHistoryMenu />", m)).toBe(1);
    expect(scriptSource(CENTER)).toContain(
      'import ConversationHistoryMenu from "./ConversationHistoryMenu.vue"'
    );
  });
});

describe("样式硬门禁 · 对齐他的原值，色值一律走 token", () => {
  it("面板几何一字不改：宽高上限、圆角、层级、挂载偏移", () => {
    const panel = cssRule(".conversation-history-panel");
    for (const value of [
      "z-index: 61",
      "top: calc(100% + 8px)",
      "width: min(370px, calc(100vw - 28px))",
      "max-height: min(560px, calc(100vh - 72px))",
      "border-radius: 12px",
      "flex-direction: column"
    ]) {
      expect(panel, `.conversation-history-panel 缺 ${value}`).toContain(value);
    }
    expect(cssRule(".conversation-history-dismiss")).toContain("position: fixed");
    expect(cssRule(".conversation-history-dismiss")).toContain("z-index: 60");
    expect(cssRule(".conversation-history-dismiss")).toContain("inset: 0");
    const control = cssRule(".conversation-history-control");
    expect(control).toContain("z-index: 62");
    expect(control).toContain("-webkit-app-region: no-drag");
  });

  it("行的三态：常态可点、当前行选中底、禁用 not-allowed + 0.48", () => {
    const item = cssRule(".conversation-history-item");
    expect(item).toContain("padding: 8px 10px");
    expect(item).toContain("border-radius: 8px");
    expect(cssRule(".conversation-history-item.is-current")).toContain("var(--surface-selected");
    const off = cssRule(".conversation-history-item:disabled");
    expect(off).toContain("cursor: not-allowed");
    expect(off).toContain("opacity: 0.48");
  });

  it("头部/列表/标题/时间/空态的字号与尺寸沿用他的原值", () => {
    expect(cssRule(".conversation-history-list")).toContain("overscroll-behavior-y: contain");
    expect(cssRule(".conversation-history-list")).toContain("padding: 6px");
    expect(cssRule(".conversation-history-panel > header")).toContain("padding: 10px 12px");
    expect(cssRule(".conversation-history-panel > header strong")).toContain(
      "font-size: 0.928571rem"
    );
    expect(cssRule(".conversation-history-panel > header > button")).toContain("width: 2rem");
    expect(cssRule(".conversation-history-title-row strong")).toContain("font-size: 0.821429rem");
    expect(cssRule(".conversation-history-title-row time")).toContain("font-size: 0.642857rem");
    expect(cssRule(".conversation-history-copy small")).toContain("font-size: 0.714286rem");
    expect(cssRule(".conversation-history-empty")).toContain("min-height: 190px");
  });

  it("搬进来的每一段都得有正文（空壳规则挡不住 not.toBe 不带 trim 的旧写法）", () => {
    for (const selector of [
      ".conversation-history-panel > :not(.conversation-history-list)",
      ".conversation-history-panel .conversation-history-heading",
      ".conversation-history-panel > header span",
      ".conversation-history-item:hover",
      ".conversation-history-copy",
      ".conversation-history-title-row",
      ".conversation-history-empty strong",
      ".conversation-history-panel > header > button:hover"
    ]) {
      expect(cssRule(selector), `${selector} 不许是空壳`).not.toBe("");
    }
  });

  it("未复用的四件不留规则：row / manage / tabs / export 一段都没有", () => {
    const css = styleSource("conversation-history.css");
    for (const dead of [
      ".conversation-history-row",
      ".conversation-history-manage",
      ".conversation-history-tabs",
      ".conversation-history-export",
      ".conversation-history-refresh"
    ]) {
      expect(css, `${dead} 属于没通路的功能，不该搬`).not.toContain(dead);
    }
  });

  it("全局表已经挂进 styles.css 的 import 列表", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/conversation-history.css";');
  });
});

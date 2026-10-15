/// <reference types="node" />
/**
 * 死面板守卫：App.vue 里每个 `:visible="…"` 都必须有**至少一个写者**。
 *
 * 问题（2026-10-05 批次 5-② 真机撞出来的两次，同一根因）：
 *   ① `exportOpen` —— App 持一个从不被置 true 的本地 ref，而 layoutStore 里
 *      `panelVisibility.export` 与 `openExport()` 一个写者都没有。
 *      两份状态、零个写者 ⇒ **整个导出功能从来没打开过**，
 *      批次 5-② 的 EPUB 差点就这么「交付」了。
 *   ② `wordCountOpen` —— 同一个模子，全书字数面板至今够不着。
 *
 * 为什么静态扫不出来：`<Panel :visible="x">` 这行在类型层面完全合法，
 * `x` 是一个合法的 ref，`tsc` / `eslint` / `vitest` 三关全绿；
 * 死掉的不是语法，是**没人写它**。同一族的其它引用还有
 * `layoutStore.openSearch/openNotes/...` 这种「有 API 无调用方」的形状。
 *
 * 口径（刻意分两类，不搞成一个）：
 *   - `:visible="layout.panelVisibility.X"` ⇒ X 必须有 open/toggle 动作，
 *     **且**那个动作在别处真的被调过（只有 API 没调用方，同样是死的）。
 *   - `:visible="xxxOpen"` ⇒ 全仓至少有一处 `xxxOpen.value =` 赋值
 *     （快捷键的 `panelShortcut` 就属于这一类，它是真的写者）。
 *
 * 这条守卫是**推导式**的：加一个新面板忘了接线，它会当场报出来，
 * 不需要谁去记得补一条断言。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const layoutSrc = readFileSync(new URL("../stores/layoutStore.ts", import.meta.url), "utf8");
const hotkeysSrc = readFileSync(new URL("../utils/hotkeys.ts", import.meta.url), "utf8");
const appScript = scriptSource("App.vue");
const appTpl = templateSource("App.vue");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 渲染层全部源码（注释不剥：这里找的是「有没有人写它」，注释里写了不算数，但误伤由下面逐条断言兜住）。 */
const ALL_SOURCES = walk(SRC)
  .filter((f) => !f.endsWith(".test.ts"))
  .map((f) => ({ path: f.replace(SRC, ""), text: readFileSync(f, "utf8") }));

/** App.vue 模板里所有 `:visible="…"` 及其所属组件名。 */
function visibleBindings(): { component: string; expr: string }[] {
  const out: { component: string; expr: string }[] = [];
  // 组件名与 :visible 可能被 prettier 折到两行，按整段模板扫 `<Name ... >` 的第一行取名字。
  for (const m of appTpl.matchAll(/<([A-Z][A-Za-z]*)([^>]*?)>/g)) {
    const [, name, attrs] = m;
    const vis = /:visible="([^"]+)"/.exec(attrs ?? "");
    if (name !== undefined && vis !== null && vis[1] !== undefined) {
      out.push({ component: name, expr: vis[1] });
    }
  }
  return out;
}

const BINDINGS = visibleBindings();

/** 全部 `.vue` 的模板——入口按钮不都在 App.vue 里（导出与字数那两枚在 DocumentPane 的右栏头部）。 */
const ALL_TEMPLATES = walk(SRC)
  .filter((f) => f.endsWith(".vue"))
  .map((f) => ({
    path: f.replace(SRC, "").replace(/^\//, ""),
    tpl: templateSource(f.replace(SRC, "").replace(/^\//, ""))
  }));

/** 快捷键能唤起的面板（`PanelShortcutId` 联合类型里那几枚）——键盘也是入口。 */
const SHORTCUT_PANELS = [
  ...(/export type PanelShortcutId =([^;]+);/.exec(hotkeysSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)
].map((m) => m[1] ?? "");

describe("App.vue 里每个 :visible 都有写者", () => {
  it("扫到了面板（守卫本身不许空转：一条都扫不到就说明正则坏了）", () => {
    expect(BINDINGS.length).toBeGreaterThanOrEqual(7);
  });

  it("走 layoutStore 那一格的面板：动作存在，且**在别处真的被调过**", () => {
    const viaStore = BINDINGS.filter((b) => b.expr.startsWith("layout.panelVisibility."));
    expect(viaStore.length).toBeGreaterThan(0);

    const dead: string[] = [];
    for (const { component, expr } of viaStore) {
      const key = expr.slice("layout.panelVisibility.".length);
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const actions = [`open${cap}`, `toggle${cap}`].filter((a) =>
        new RegExp(`\\bfunction\\s+${a}\\b`).test(layoutSrc)
      );
      if (actions.length === 0) {
        dead.push(`${component}: layoutStore 没有 open${cap}/toggle${cap}`);
        continue;
      }
      // 「有 API 无调用方」也是死的：动作得在 layoutStore 之外被调过。
      const called = ALL_SOURCES.some(
        (f) =>
          !f.path.endsWith("layoutStore.ts") &&
          actions.some((a) => new RegExp(`\\b${a}\\s*\\(`).test(f.text))
      );
      if (!called)
        dead.push(`${component}: ${actions.join(" / ")} 在 layoutStore 里定义但全仓没有调用方`);
    }
    expect(dead, `这些面板的可见态没人写：\n${dead.join("\n")}`).toEqual([]);
  });

  it("走本地 ref 的面板：全仓至少有一处 `<name>.value =` 赋值", () => {
    const viaLocal = BINDINGS.filter((b) => /^[a-zA-Z][A-Za-z0-9]*$/.test(b.expr));
    expect(viaLocal.length).toBeGreaterThan(0);

    const dead: string[] = [];
    for (const { component, expr } of viaLocal) {
      const written = ALL_SOURCES.some((f) =>
        new RegExp(`\\b${expr}\\s*\\.value\\s*=[^=]`).test(f.text)
      );
      if (!written) dead.push(`${component}: ${expr} 全仓没有任何一处赋值`);
    }
    expect(dead, `这些面板的可见态没人写：\n${dead.join("\n")}`).toEqual([]);
  });
});

/**
 * 「有写者」不等于「用户够得着」——这一层是 2026-10-06 变异实测补的。
 *
 * 上面两条守住的是「`panelVisibility.X` 有人置 true」。但把**入口按钮从右栏头部摘掉**，
 * 写者还在、动作还被调（快捷键、别处调用），守卫全绿，而面板从此在界面上消失。
 * 字数面板与导出面板连着两次都是「压根没人点得到」，所以这一层必须单独钉。
 *
 * 口径：**模板里某个元素的事件绑定真的调到了这一枚的开启动作**，
 * 或者这一枚在 `PanelShortcutId` 里（键盘也算入口）。
 * 只认具体的方法名与具体的那枚 key——`openPanel()` / `togglePanel()` 是通用函数，
 * 扫到它们不算任何面板有入口。
 */
describe("面板够得着：写者在，还得更有一条用户能走的路", () => {
  const storeBacked = BINDINGS.filter((b) => b.expr.startsWith("layout.panelVisibility."));

  it("扫到了走 store 的面板（守卫不许空转）", () => {
    expect(storeBacked.length).toBeGreaterThan(0);
    expect(ALL_TEMPLATES.length).toBeGreaterThan(10);
  });

  it("每枚走 store 的面板都有入口按钮或快捷键", () => {
    const unreachable: string[] = [];
    for (const { component, expr } of storeBacked) {
      const key = expr.slice("layout.panelVisibility.".length);
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      // 形如 `@click="layout.openWordCount()"` / `@click="layout.openPanel('wordCount')"`。
      // 方法名按**完整名字**匹配而不是 `open\b`：`.` 后没有词边界，`openWordCount` 里的
      // `open` 紧跟着 `W`，用 `\b` 收尾会一个都匹配不上（第一版就是这么写的，当场全判成死面板）。
      const byTemplate = ALL_TEMPLATES.some((f) =>
        new RegExp(
          `@(?:click|keydown|keyup)="[^"]*(?:\\bopen${cap}\\s*\\(|\\b(?:open|toggle)Panel\\(\\s*'${key}')`
        ).test(f.tpl)
      );
      if (!byTemplate && !SHORTCUT_PANELS.includes(key)) {
        unreachable.push(`${component}（${key}）：模板里没有调得到它的入口，快捷键表里也没有`);
      }
    }
    expect(unreachable, `这些面板用户根本点不开：\n${unreachable.join("\n")}`).toEqual([]);
  });

  it("右栏头部那两枚入口按钮真的在（变异实测：摘掉它们守卫原先一声不吭）", () => {
    const paneTpl = templateSource("components/DocumentPane.vue");
    expect(paneTpl).toContain('@click="layout.openWordCount()"');
    expect(paneTpl).toContain('@click="layout.openExport()"');
    // 入口要真有可点的样子：icon-button 那套 class，不是裸 button。
    expect(paneTpl).toMatch(/aria-label="字数统计"/);
    expect(paneTpl).toMatch(/aria-label="导出作品/);
  });
});

describe("可达之后才暴露的那些问题（面板开着就藏不住）", () => {
  it("字数面板读 DocRef.chars，不读那个根本不存在的 .content", () => {
    // `DocRef` 只有 excerpt / chars / relPath / kind / title。原先读的是 `c.content ?? ""`，
    // 于是每章恒为 0 字、全书总正文永远是「0 字」——不报错、不空、只是数字永远错。
    // 这是本仓最难自己发现的一类：面板以前够不着，谁也没看见它一直显示 0。
    const panel = scriptSource("components/WordCountPanel.vue");
    expect(panel).not.toMatch(/\.content\s*\?\?/);
    expect(panel).toContain("c.chars ?? 0");
    expect(panel).not.toContain("proseCharCount(splitFrontmatter(c.");
  });

  it("全书总正文不能由一个恒为 0 的量算出来（total 与逐章同一个来源）", () => {
    const panel = scriptSource("components/WordCountPanel.vue");
    // total 与每章字数必须来自同一份口径，否则会出现「章节数 1、总正文 0」这种自相矛盾
    expect(panel).toContain("chapters.reduce((sum, c) => sum + (c.chars ?? 0), 0)");
  });
});

describe("两条具体回归（都是真机撞出来的那两次）", () => {
  it("导出面板不再挂那个从不被置 true 的本地 ref", () => {
    expect(appScript).not.toMatch(/exportOpen\s*=\s*ref/);
    expect(appTpl).toContain(':visible="layout.panelVisibility.export"');
    expect(appScript).toContain('import ExportDialog from "./components/ExportDialog.vue";');
  });

  it("字数面板同样只认 store 那一格，且入口按钮在右栏头部", () => {
    expect(appScript).not.toMatch(/wordCountOpen\s*=\s*ref/);
    expect(appTpl).toContain(':visible="layout.panelVisibility.wordCount"');
    expect(appTpl).toContain("@close=\"layout.closePanel('wordCount')\"");
    const paneTpl = templateSource("components/DocumentPane.vue");
    expect(paneTpl).toContain('aria-label="字数统计"');
    expect(paneTpl).toContain('@click="layout.openWordCount()"');
  });

  it("**别顺手把 notes/search 也改成 store 那一格**（它们有真写者：快捷键）", () => {
    // 这条是反向钉：panelShortcut 里的 case 就是它们的写者，
    // 「统一风格」把它们搬走会让键盘快捷键失效，而 tsc 完全不会报。
    expect(appScript).toContain('case "notes":');
    expect(appScript).toContain('case "search":');
    expect(appScript).toMatch(/notesOpen\.value\s*=[^=]/);
  });

  it("本轮明确没动的：SearchPanel / NotesPanel / 模板 / 大纲 / 写作目标 / 故事大脑 都还在", () => {
    for (const name of [
      "SearchPanel",
      "NotesPanel",
      "PromptTemplatePanel",
      "OutlinePanel",
      "WritingGoalPanel",
      "StoryBiblePanel"
    ]) {
      expect(appScript, `${name} 不该被这一轮动过`).toContain(`import ${name} from`);
      expect(appTpl).toContain(`<${name}`);
    }
  });
});

/**
 * 【反向那一面】（2026-10-15 补）
 *
 * 上面几段都是**从模板出发**地问：这枚 `:visible` 有没有写者、有没有入口。
 * 于是留了一格谁也照不到——键写在 `panelVisibility` 里，模板却压根没读过它：
 * 没有 `:visible` 就进不了 BINDINGS，也就同时躲开了「少写者」和「够不着」两道断言。
 * 死在这一格里的东西**最彻底也最安静**：`versionHistory` 的面板键有、`openVersionHistory` 有、
 * 面板组件与写快照的 store 也在，而全仓没有一行 `panelVisibility.versionHistory`——
 * 直到把三处交叉读一遍才发现，写快照的 `createSnapshot` 连一个调用方都没有。
 * 同族被一并收掉的还有 `search` / `notes` / `templates`（App.vue 用局部 ref 干着同一件事，
 * 那三枚是从没被读过的重复状态；要动的不是它们的功能，是重复的那一份）。
 *
 * 口径：从 `layoutStore.ts` 的 `panelVisibility` 对象字面量**反向枚举键**，
 * 每枚键都必须被某个 `.vue` 模板读成 `panelVisibility.<键>`。
 * 这样新加一枚没人读的键，这刀会当场红，不必等谁想起来。
 */
describe("反向：panelVisibility 的每一枚键都得有模板读它（上面几段的盲区）", () => {
  const LITERAL = /const panelVisibility = ref\(\{([\s\S]*?)\}\);/m.exec(layoutSrc);
  const keys = [...(LITERAL?.[1] ?? "").matchAll(/(?:^|\n)\s*([A-Za-z][A-Za-z0-9]*)\s*:/g)].map(
    (m) => m[1] ?? ""
  );
  const templateTexts = [appTpl, ...ALL_TEMPLATES.map((f) => f.tpl)];

  it("解析器没空转（正则坏掉会一枚都枚举不到，那是绿的假绿）", () => {
    expect(LITERAL, "没能从 layoutStore 抠出 panelVisibility 字面量").not.toBeNull();
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain("wordCount");
    expect(keys).toContain("export");
  });

  it("每枚键都被某个模板读到", () => {
    const orphans = keys.filter(
      (key) => !templateTexts.some((t) => t.includes(`panelVisibility.${key}`))
    );
    expect(
      orphans,
      `这些面板键没有任何模板读过——既开不出来也关不掉，是死面板：\n${orphans.join(", ")}`
    ).toEqual([]);
  });
});

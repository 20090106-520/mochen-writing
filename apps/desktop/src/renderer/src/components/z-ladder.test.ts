/// <reference types="node" />
/**
 * 层级表与面板外框的「单一真相」契约（2026-11-11）。
 *
 * 病灶：z-index 的 23 档数值散在 styles/*.css、七个 Vue 组件的 <style> 块里，
 * 另有六份守卫把数字直接写进断言。谁压谁全靠读代码脑子里拼；任何一处改数字，
 * 别的守卫只会因为字符串对不上而红，不会告诉你该改成几。
 * 这一轮把**数值原样**收进 styles.css 的一张 --z-* 表（层叠行为一个没改），
 * 由本守卫把表、消费点、关键选择器的档位三者对齐。
 *
 * 同理，panel-kit.css 统一了九个整屏/锚定浮层的外框，却自己和另外三份 CSS
 * 都写着字面量圆角/投影（16px / 10px / 14px42px / 方向阴影），
 * 靠 @import 先后裁决。收成 --radius-panel / --shadow-panel 两枚 token。
 *
 * 【刻意没做】整屏面板历史上是 1500（六个 + 设定集）/ 1600（导出）/ 2000（搜索）
 * 三档，谁该压谁没裁定过。本守卫把三档**照原值钉死**，防止有人顺手调平——
 * 调平会改变真机上「两个面板叠着时谁在前」，要单独量过再定。
 * 数字字面量不从生产代码 import（与 skill-catalog.test.ts 的出处前缀同一条规矩）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const STYLES_DIR = path.join(SRC, "styles");
const COMPONENTS_DIR = path.join(SRC, "components");

interface Sheet {
  name: string;
  css: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function readSheet(name: string, file: string): Sheet {
  return { name, css: stripComments(readFileSync(file, "utf8")) };
}

/** 全站 CSS 源：styles/*.css、components/*.css、各 .vue 的 <style> 块、根 styles.css。 */
function sheets(): Sheet[] {
  const out: Sheet[] = [];
  for (const f of readdirSync(STYLES_DIR)) {
    if (f.endsWith(".css")) out.push(readSheet(`styles/${f}`, path.join(STYLES_DIR, f)));
  }
  for (const f of readdirSync(COMPONENTS_DIR)) {
    const file = path.join(COMPONENTS_DIR, f);
    if (f.endsWith(".css")) out.push(readSheet(`components/${f}`, file));
    if (!f.endsWith(".vue")) continue;
    const src = readFileSync(file, "utf8");
    let i = 0;
    for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      out.push({ name: `components/${f}#style${++i}`, css: stripComments(m[1] ?? "") });
    }
  }
  out.push(readSheet("styles.css", path.join(SRC, "styles.css")));
  return out;
}

const ALL_SHEETS = sheets();
const rootCss = ALL_SHEETS.find((sheet) => sheet.name === "styles.css")?.css ?? "";
const panelKit = ALL_SHEETS.find((sheet) => sheet.name === "styles/panel-kit.css")?.css ?? "";

/** 表里只认 :root 的 `--z-*: <整数>;`，注释已剥掉。 */
function zTable(): Record<string, number> {
  const table: Record<string, number> = {};
  for (const m of rootCss.matchAll(/^[ \t]*(--z-[a-z0-9-]+):[ \t]*(-?\d+);/gm)) {
    const key = m[1] ?? "";
    table[key] = Number(m[2]);
  }
  return table;
}

/** 一条 z-index 声明的值（剥注释后，认分号结尾的完整声明）。 */
function zDeclarations(): Array<{ sheet: string; value: string }> {
  const out: Array<{ sheet: string; value: string }> = [];
  for (const sheet of ALL_SHEETS) {
    for (const m of sheet.css.matchAll(/z-index[ \t]*:[ \t]*([^;]+);/g)) {
      out.push({ sheet: sheet.name, value: (m[1] ?? "").trim() });
    }
  }
  return out;
}

function ruleBlock(sheetName: string, selector: string): string {
  const css = ALL_SHEETS.find((sheet) => sheet.name === sheetName)?.css ?? "";
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

const PANEL_CLASSES = [
  "ci-panel",
  "outline-panel",
  "bible-panel",
  "notes-panel",
  "tpl-panel",
  "search-panel",
  "export-dialog",
  "tool-roster",
  "material-panel"
];

describe("层级表：23 档数值照抄历史，一个没改", () => {
  it("表逐字钉住（任何一档被悄悄改动立刻红）", () => {
    expect(zTable()).toEqual({
      "--z-under": -1,
      "--z-flat": 0,
      "--z-raise-1": 1,
      "--z-raise-2": 2,
      "--z-raise-3": 3,
      "--z-raise-5": 5,
      "--z-raise-6": 6,
      "--z-inline-floor": 10,
      "--z-inline-low": 20,
      "--z-inline-low-2": 21,
      "--z-inline-mid": 30,
      "--z-inline-high": 40,
      "--z-inline-top": 50,
      "--z-popover": 60,
      "--z-popover-2": 61,
      "--z-popover-3": 62,
      "--z-guide": 90,
      "--z-dialog": 100,
      "--z-menu": 1000,
      "--z-drawer": 1500,
      "--z-drawer-export": 1600,
      "--z-drawer-search": 2000,
      "--z-toast": 9999
    });
  });

  it("表的声明顺序就是层级顺序：严格递增，不能有人插队", () => {
    const values = Object.values(zTable());
    expect(values.length).toBeGreaterThan(0);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `第 ${i} 档 ${values[i]} 没比上一档 ${values[i - 1]} 高`).toBeGreaterThan(
        values[i - 1] as number
      );
    }
  });

  it("跨栏的全局档：浮层 < 对话框 < 菜单 < 整屏面板 < Toast", () => {
    const t = zTable();
    expect(t["--z-popover"]).toBeLessThan(t["--z-dialog"] as number);
    expect(t["--z-dialog"]).toBeLessThan(t["--z-menu"] as number);
    expect(t["--z-menu"]).toBeLessThan(t["--z-drawer"] as number);
    expect(t["--z-drawer"]).toBeLessThan(t["--z-toast"] as number);
    expect(t["--z-guide"]).toBeLessThan(t["--z-dialog"] as number);
  });
});

describe("消费点：CSS 与 Vue scoped 一律读 token，不许再写魔数", () => {
  it("没有裸数字 z-index，也没有表里查不到的 token", () => {
    const table = zTable();
    const declarations = zDeclarations();
    expect(declarations.length, "一条 z-index 都没扫到，说明读取口径坏了").toBeGreaterThan(40);
    for (const decl of declarations) {
      const hit = /^var\((--z-[a-z0-9-]+)\)$/.exec(decl.value);
      expect(hit, `${decl.sheet} 写了裸 z-index：${decl.value}`).not.toBeNull();
      expect(table, `${decl.sheet} 用了表里没有的 ${decl.value}`).toHaveProperty(hit?.[1] ?? "");
    }
  });

  it("表与消费双向对齐：没有僵尸 token，也没有漏登记的档位", () => {
    const used = new Set<string>();
    for (const decl of zDeclarations()) {
      const hit = /^var\((--z-[a-z0-9-]+)\)$/.exec(decl.value);
      if (hit?.[1]) used.add(hit[1]);
    }
    expect([...used].sort()).toEqual(Object.keys(zTable()).sort());
  });

  it("关键选择器各就各位（防止把对话框挪成浮层档）", () => {
    const cases: Array<[string, string, string]> = [
      ["styles/dialog.css", ".dialog-backdrop", "z-index: var(--z-dialog)"],
      ["styles/toast.css", ".toast-stack", "z-index: var(--z-toast)"],
      ["styles/material-panel.css", ".material-panel", "z-index: var(--z-popover)"],
      ["styles/agent-pane.css", ".composer-context-menu", "z-index: var(--z-menu)"],
      ["components/story-bible-panel.css", ".bible-overlay", "z-index: var(--z-drawer)"]
    ];
    for (const [sheet, selector, needle] of cases) {
      const block = ruleBlock(sheet, selector);
      expect(block, `${sheet} 里找不到 ${selector}`).not.toBe("");
      expect(block, `${sheet} 的 ${selector} 层级不对`).toContain(needle);
    }
  });
});

describe("面板外框：九张面板只读两枚 token", () => {
  it("token 有定义，panel-kit 自己也在读", () => {
    expect(rootCss).toContain("--radius-panel: 16px");
    expect(rootCss).toContain("--shadow-panel: 0 18px 48px var(--shadow-color)");
    expect(panelKit).toContain("border-radius: var(--radius-panel)");
    expect(panelKit).toContain("box-shadow: var(--shadow-panel)");
  });

  it("panel-kit 之外不许再给这九个类写圆角/投影字面量", () => {
    const offenders: string[] = [];
    for (const sheet of ALL_SHEETS) {
      if (sheet.name === "styles/panel-kit.css") continue;
      for (const cls of PANEL_CLASSES) {
        const block = ruleBlock(sheet.name, `.${cls}`);
        for (const decl of block.split(";")) {
          if (!/^[ \t]*(border-radius|box-shadow)[ \t]*:/.test(decl)) continue;
          if (!/:[ \t]*var\(--/.test(decl))
            offenders.push(`${sheet.name} · .${cls} · ${decl.trim()}`);
        }
      }
    }
    expect(offenders, "外框口径又分叉了").toEqual([]);
  });
});

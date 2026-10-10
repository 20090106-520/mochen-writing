import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 窗口的最小尺寸闸（2026-10-09 全仓扫描 P2-9）。
 *
 * 【要钉住的事实】`main/index.ts` 建窗口时只写了 `width: 1440, height: 900`，
 * **没有 `minWidth` / `minHeight`**——于是窗口可以一路拖到布局地板以下。而这套三栏布局在地板以下
 * 的行为不是「出现横向滚动条」，是**裁掉**：`.desktop-shell` 是 `grid` + `width: 100vw` + `overflow: hidden`，
 * 三根列各自有下限（`--left-pane-width` + `minmax(--center-pane-min, 1fr)` + `--right-pane-width`），
 * 加起来超过视口宽度时，多余的那部分直接被 `overflow: hidden` 吃掉——用户看到的是右栏凭空消失一截，
 * 而不是「窗口太窄，请拉大」。
 *
 * 【为什么判据不抄第二份】下限不从台账里那句「1000 左右」抄，而是**现读那份真身**：
 * `styles.css` 的 `@media (max-width: 1220px)` 窄档里三根列的实际像素。
 * 布局改了（比如右栏下限调宽），这条用例会自动要求窗口地板跟着调——这正是它存在的意义。
 *
 * 【读源码而不是跑 Electron】`new BrowserWindow` 要在真窗口里才成立，而本仓的装配点测试同源做法
 * 是读源码（见 `renderer-csp.test.ts` 读 `electron.vite.config.ts`、`unbound-single-source.test.ts`）。
 * 这里把对象字面量抠出来按字段判，字段名与数值都在，缺一个就红。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "index.ts"), "utf8");
const shellCss = readFileSync(path.join(here, "../renderer/src/styles.css"), "utf8");
const layoutSrc = readFileSync(path.join(here, "../renderer/src/stores/layoutStore.ts"), "utf8");

/** 抠出 `new BrowserWindow({ ... })` 的那一份参数对象文本（按大括号深度配对，不靠缩进猜）。 */
function windowOptions(): string {
  const start = indexSrc.indexOf("new BrowserWindow({");
  expect(start, "装配点里找不到 new BrowserWindow({").toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start + "new BrowserWindow".length; i < indexSrc.length; i += 1) {
    const ch = indexSrc[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return indexSrc.slice(start, i);
    }
  }
  throw new Error("new BrowserWindow({ 的大括号没闭合");
}

/** 读 `--某-token: 123px` 里的数字；读不到就抛，别让它静默变成 NaN 比较。 */
function pxToken(block: string, name: string): number {
  const m = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block);
  if (!m) throw new Error(`${name} 没在样式里出现，用例的判据源变了`);
  return Number(m[1]);
}

const narrowBlock = /@media \(max-width: 1220px\) \{([\s\S]*?)\n\}/.exec(shellCss)?.[1] ?? "";

describe("窗口最小尺寸", () => {
  it("窄档那段样式确实有三个列宽 token（抠空了下面的断言就是假的绿）", () => {
    expect(narrowBlock, "@media (max-width: 1220px) 那段没抠到").not.toBe("");
    for (const name of ["--left-pane-width", "--center-pane-min", "--right-pane-width"])
      expect(narrowBlock).toContain(`${name}:`);
  });

  it("minWidth / minHeight 都在场，而且初值不许小于自己的地板", () => {
    const options = windowOptions();
    const minWidth = /\bminWidth:\s*(\d+)/.exec(options)?.[1];
    const minHeight = /\bminHeight:\s*(\d+)/.exec(options)?.[1];
    expect(minWidth, "BrowserWindow 的 options 里没有 minWidth").toBeDefined();
    expect(minHeight, "BrowserWindow 的 options 里没有 minHeight").toBeDefined();
    const width = Number(/\bwidth:\s*(\d+)/.exec(options)?.[1]);
    const height = Number(/\bheight:\s*(\d+)/.exec(options)?.[1]);
    expect(width).toBeGreaterThanOrEqual(Number(minWidth));
    expect(height).toBeGreaterThanOrEqual(Number(minHeight));
  });

  it("地板至少容得下窄档那三根列之和（低于它就不是滚动，是裁掉）", () => {
    // 判据取自两处真身：左右两栏在窄档的**默认宽**与中栏的下限都住在 `styles.css`，
    // 右栏还能拖到多窄住在 `utils/rightPanePreferences.ts`。
    // 这里刻意按「不假设布局会替用户收窄两栏」的那一档算：三根列的默认宽 + 中栏下限 = 977，
    // 窗口比它窄时 `overflow: hidden` 就会把多出来的那截**裁掉**（不是出滚动条）。
    const 三列之和 =
      pxToken(narrowBlock, "--left-pane-width") +
      pxToken(narrowBlock, "--center-pane-min") +
      pxToken(narrowBlock, "--right-pane-width");
    const minWidth = Number(/\bminWidth:\s*(\d+)/.exec(windowOptions())?.[1]);
    expect(minWidth, `窄档三列之和是 ${三列之和}px，地板低于它就会裁掉右栏`).toBeGreaterThanOrEqual(
      三列之和
    );
  });

  it("地板不许高过「自动收起右栏」那一档（否则右栏还来不及收就撞墙）", () => {
    const collapse = Number(/export const NARROW_AUTO_COLLAPSE_WIDTH = (\d+)/.exec(layoutSrc)?.[1]);
    expect(collapse, "layoutStore 里那枚自动折叠档读不到").toBeGreaterThan(0);
    const minWidth = Number(/\bminWidth:\s*(\d+)/.exec(windowOptions())?.[1]);
    expect(minWidth, "窗口地板应落在自动折叠档之下").toBeLessThanOrEqual(collapse);
  });

  it("minHeight 容得下「扣掉头部与那一格的上限」之后剩下的正文高", () => {
    // 样式里最大的一笔竖向硬扣减：`max-height: min(360px, calc(100vh - 320px))`
    // （思考窗那一格）。视口低于 360 + 320 时它连自己设计的那 360px 都拿不到——
    // 那就是「界面在偷你的正文」的形状，所以地板取它之上的保守档。
    // 只看**常驻那一栏**的表：dialog.css 那种弹层是覆盖层，它的高度由遮罩管，不参与窗口地板。
    const paneCss = [
      "../renderer/src/styles/agent-pane.css",
      "../renderer/src/styles/conversation-history.css"
    ]
      .map((rel) => readFileSync(path.join(here, rel), "utf8"))
      .join("\n");
    const pairs = [...paneCss.matchAll(/max-height:\s*min\((\d+)px,\s*calc\(100vh - (\d+)px\)\)/g)];
    expect(pairs.length, "样式里那笔 calc(100vh - N) 扣减不见了，判据源变了").toBeGreaterThan(0);
    const 需要的高度 = Math.max(...pairs.map((m) => Number(m[1]) + Number(m[2])));
    const minHeight = Number(/\bminHeight:\s*(\d+)/.exec(windowOptions())?.[1]);
    expect(minHeight).toBeGreaterThanOrEqual(需要的高度);
  });
});

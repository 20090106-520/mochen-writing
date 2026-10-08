/// <reference types="node" />
/**
 * 主题 token 守卫：**消费了却没有定义的 CSS 变量**一律报出来。
 *
 * 问题（2026-10-06 真机撞出来的）：约 250 处样式消费 `--surface` / `--surface-dim` /
 * `--dropdown-bg` / `--border` / `--border-light` / `--text-muted` / `--text-dim` 这些名字，
 * **全仓从来没有定义过**。它们各自带着硬编码兜底值，于是：
 * ① 浅色主题下 11 个面板深字压深底（`--dropdown-bg` 的兜底是深色，文字却跟主题走）；
 * ② 暗色主题下 6 个浮层浅底浅字（`--surface` 的兜底是纯白）；
 * ③ 浅色主题下一片描边隐形（`--border*` 的兜底是半透明白）。
 *
 * 为什么三关全绿：死掉的不是语法，是「这个变量没人定义」。type system 看不见 CSS 变量。
 *
 * 口径分三类，各有各的理由，**不许把它们混成一坨**：
 *  - 主题别名（`--surface` / `--dropdown-bg` / `--border` / `--text-muted` …）
 *    ⇒ 必须在 `appearanceThemeRuntime` 里 setProperty。
 *  - 确定性常量（`--editor-leading` / `--font-mono` / `--fill` …）
 *    ⇒ 兜底值就是它的值，跟主题无关，白名单写清楚理由。
 *  - JS 内联注入（`--tree-depth`）⇒ 由组件用 `:style` 现场设，白名单注明出处。
 *
 * 「白名单不是写死的名单」这一点靠注释写理由：写死而无理由的白名单，
 * 半年后没人敢删，于是白名单自己变成下一个真相源。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));

/** 确定性常量：兜底值本身就是它的值，跟主题无关。 */
const DETERMINISTIC_CONSTANTS: Record<string, string> = {
  "--editor-font-size": "正文比界面大一档的排版常量（1.07143rem），不随主题变",
  "--editor-leading": "正文行高 1.95，排版常量，不随主题变",
  "--font-mono": "等宽字体栈，与主题无关",
  "--fill": "VolumeOutlinePanel 的完整度条，由 :style 现场按已写字段数算出"
};

/** JS 内联注入：不是主题变量，但也不是兜底兜出来的。 */
const INLINE_INJECTED: Record<string, string> = {
  "--tree-depth": "LeftSidebar.vue:579 用 :style 现场设树层级缩进",
  "--editor-measure":
    "DocumentPane.vue 编辑区用 :style 现场设列宽档（读 utils/editor-measure-preference），样式表兜底 none 就是原版式的不限宽",
  /* 整窗预览/并排对比那两块小面板的「纸」与「墨」（5-㊷）。
     它们**必须**跟着被预览的那一套皮肤走，而不是跟着当前主题：对比栏是同时摆两套皮肤，
     当前主题只有一个值，给不了第二套。所以由 `SkinGalleryPage.vue` 的 `previewTone()`
     现场写进 `:style`（那张卡的根节点上），运行时表里本来就不该有它们。
     「页面真的设了这两枚」由 appearance-skin-plaza-wiring.test.ts 钉（那里断言
     `"--window-paper": tone.background` 与 `"--window-ink": tone.foreground` 两个字面量），
     本条只负责不把它们误判成孤儿。 */
  "--window-paper":
    "SkinGalleryPage.vue 的 previewTone() 用 :style 逐张卡现场设纸色（每套皮肤各一版，不随当前主题）",
  "--window-ink":
    "SkinGalleryPage.vue 的 previewTone() 用 :style 逐张卡现场设墨色（整窗模型里那几条灰线用）"
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(css|vue|ts)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

const runtimeSrc = readFileSync(
  new URL("../composables/appearanceThemeRuntime.ts", import.meta.url),
  "utf8"
);

/**
 * 视觉四层那一族 token 的真身在 appearanceSkinVisual.ts（它是 `skinStyleVariables()`
 * 返回的那个对象的键）。5-㊵ 把它从 appearanceThemeRuntime.ts 拆出来之后，
 * 这个守卫只读后者 ⇒ `--skin-*` 整族被报成「消费了却从没定义」。
 *
 * ⇒ 两个文件一起扫。**只有这一处放宽**：下面 `legacyAliases` 那条正则
 *   仍然只对 `runtimeSrc` —— 它要定位的是一张具体的表，不是「任何文件里的 `var(`」。
 */
const skinVisualSrc = readFileSync(
  new URL("../composables/appearanceSkinVisual.ts", import.meta.url),
  "utf8"
);

/**
 * 运行时定义过的。**两种形态都要认**：
 * ① `setProperty("--x", …)` 字面量；
 * ② `legacyAliases` 那张表里的 `"--x": …` 键（2026-10-06 加的旧别名层是循环 setProperty 的，
 *    只认字面量会把这一族重新判成孤儿——守卫自己先坏了，就没人守它了）。
 */
/**
 * CSS 自定义属性名的匹配范围。
 *
 * **别把字符集写窄成 `[a-z-]`**：CSS 变量名大小写敏感，而且允许非 ASCII
 * （`--边距`、`--MyVar` 都是合法名字）。字符集一窄，扫出来的就不是「仓库实际用了哪些变量」，
 * 而是「仓库恰好只用了小写 ASCII 变量的那个子集」——守卫从此静默漏扫，
 * 而静默漏扫正是它被写出来要防的那件事（2026-10-06 变异实测撞出来的：
 * 把某个别名写成 `var(--根本不存在的那个)`，窄正则压根没匹配到，守卫一声不吭）。
 */
const runtimeDefined = new Set([
  ...[...runtimeSrc.matchAll(/setProperty\(\s*"(--[^"]+)"/g)].map((m) => m[1]),
  ...[...runtimeSrc.matchAll(/^\s*"(--[^"]+)":/gm)].map((m) => m[1]),
  // 视觉四层那一族在 appearanceSkinVisual.ts 里（5-㊵ 拆出去的那个文件）。
  ...[...skinVisualSrc.matchAll(/^\s*"(--[^"]+)":/gm)].map((m) => m[1])
]);

/** 静态样式表里真的定义过的（`--x:` 开头的声明）。 */
const cssDefined = new Set<string>();
for (const f of FILES) {
  if (!f.endsWith(".css")) continue;
  // 捕获组在 strict 下是 `string | undefined`；这里 `?? ""` 兜住——空串不会命中任何消费点，
  // 不兜的话这条断言的报错会指向 matchAll 而不是真正缺的那个变量。
  for (const m of readFileSync(f, "utf8").matchAll(/(--[^\s:;"']+)\s*:/g)) {
    if (m[1] !== undefined) cssDefined.add(m[1]);
  }
}

/** 被消费过的（带不带兜底都算——裸用的更阴：没定义时整条声明在计算值阶段作废）。 */
const consumed = new Map<string, { bare: number; fallback: number; files: Set<string> }>();
for (const f of FILES) {
  const rel = f.replace(SRC, "");
  for (const m of readFileSync(f, "utf8").matchAll(/var\(\s*(--[^)"\s,]+)\s*(,)?/g)) {
    if (m[1] === undefined) continue;
    const entry = consumed.get(m[1]) ?? { bare: 0, fallback: 0, files: new Set<string>() };
    if (m[2] === ",") entry.fallback += 1;
    else entry.bare += 1;
    entry.files.add(rel);
    consumed.set(m[1], entry);
  }
}

const orphans = [...consumed.entries()]
  .filter(([name]) => !runtimeDefined.has(name) && !cssDefined.has(name))
  .filter(([name]) => !(name in DETERMINISTIC_CONSTANTS) && !(name in INLINE_INJECTED))
  .sort();

describe("CSS 变量：消费了就得有定义", () => {
  it("扫到了变量（守卫不许空转：一个都没扫到说明正则坏了）", () => {
    expect(consumed.size).toBeGreaterThan(30);
  });

  it("没有「消费了却从没定义」的变量", () => {
    const detail = orphans
      .map(([name, e]) => {
        const n =
          e.fallback > 0
            ? `裸用 ${e.bare} / 带兜底 ${e.fallback}`
            : `裸用 ${e.bare}（失效时整条声明作废）`;
        return `  ${name}  ${n}\n    ${[...e.files].join(", ")}`;
      })
      .join("\n");
    expect(
      orphans.map(([n]) => n),
      `这些变量被消费但没人定义：\n${detail}`
    ).toEqual([]);
  });

  it("本轮修的那批主题别名真的在运行时被设了（少一条就等于没修）", () => {
    // 这 13 条各自对应的破相：前两条是「浅色主题下深字压深底」，
    // `--surface` / `--surface-dim` 是「暗色主题下浅底浅字」。
    for (const name of [
      "--surface",
      "--dropdown-bg",
      "--surface-dim",
      "--bg-secondary",
      "--border",
      "--border-light",
      "--border-hover",
      "--line-strong",
      "--hover-bg",
      "--text-muted",
      "--text-dim",
      "--warn",
      "--ok"
    ]) {
      expect(runtimeDefined, `${name} 没在运行时定义`).toContain(name);
    }
  });

  it("别名指向的是**已存在的** token，不是新造一个不存在的东西", () => {
    // `setProperty("--surface", "var(--不存在的)")` 会让这一整族重新变成孤儿，而且更难查。
    const block = /const legacyAliases[\s\S]*?\n {2}\};\n/.exec(runtimeSrc)?.[0] ?? "";
    expect(block, "找不到 legacyAliases 那一段").not.toBe("");
    for (const m of block.matchAll(/:\s*"var\((--[^)"\s]+)\)"/g)) {
      const target = m[1];
      if (target === undefined) continue;
      expect(
        runtimeDefined.has(target) || cssDefined.has(target),
        `--x 指向了 ${target}，而它自己也没有定义`
      ).toBe(true);
    }
    expect([...block.matchAll(/:\s*"var\(/g)].length).toBeGreaterThan(0);
  });

  it("白名单里的每一条都写得出理由（没理由的白名单半年后没人敢删）", () => {
    for (const [name, why] of [
      ...Object.entries(DETERMINISTIC_CONSTANTS),
      ...Object.entries(INLINE_INJECTED)
    ]) {
      expect(consumed.has(name), `${name} 在白名单里但没人消费`).toBe(true);
      expect(why.length, `${name} 缺理由`).toBeGreaterThan(6);
    }
  });
});

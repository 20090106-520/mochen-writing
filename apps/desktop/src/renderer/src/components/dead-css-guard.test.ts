/// <reference types="node" />
/**
 * 死 CSS 守卫（2026-10-05）。
 *
 * 问题：CSS 里的类名只要写了规则就算「存在」，可它可能一个元素都匹配不到。
 * 这层没人报警——删不掉、看不见、改不动，一轮轮攒下来。本仓清过两批：
 * 「更多功能」面板、分区操作菜单、钉住资源区、设置中心改整页视图前的浮层类、
 * 消息区改版前的 message-* 族、长文档演示态……合计几十条规则、几十个类名。
 * 更糟的是覆盖清单守卫 theme-runtime-coverage.test.ts 会把它们判成「有消费者」
 * （判据之一就是「CSS 里有真规则」），于是死规则反而给死条目发了通行证。
 *
 * 口径：styles/*.css 里出现过的每个类名，要么在 .vue/.ts 源码里被用到，
 * 要么属于「动态拼出来的类名」白名单——白名单不是写死的，是从
 * PROPOSAL_STATUSES 现场推导的，免得状态枚举变了这里悄悄过期。
 *
 * 两个坑写在下面，都是这轮真踩过的：
 *   ① 动态类名只有一个产生点：ProposalCard.vue 的 `:class="[\`is-${view.status}\`]`"。
 *      字面量搜不到 is-written / is-rejected / is-stale，删了提案卡状态配色就没了。
 *   ② `LeftSidebar.vue` 的 `tree-${docKind}` 看着同类，其实是喂 **data-nav-id** 的，
 *      从不生成 class。别被它骗进保护名单。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cssRules, strippedStyleSource } from "../utils/vue-source-reader";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const STYLES = path.join(SRC, "styles");
const CONTRACTS = fileURLToPath(
  new URL("../../../../../../packages/contracts/src/patch.ts", import.meta.url)
);
const PROVIDER_CONTRACTS = fileURLToPath(
  new URL("../../../../../../packages/contracts/src/provider.ts", import.meta.url)
);
/** markdown 渲染器：`hr` / `li` 这些标签是它在**运行时**造出来的，渲染层源码里一个都搜不到。 */
const MARKDOWN_RENDERER = fileURLToPath(
  new URL("../../../../../../packages/fs-store/src/export-shared.ts", import.meta.url)
);

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, " ");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * 动态产出的类名：
 * 1. 从 PROPOSAL_STATUSES 现场推导 `is-${status}`。
 * 2. 从 EditorViewMode 现场推导 `editor-document--${mode}`。
 * 3. 从 NotificationLevel 现场推导 `is-${level}`（NotificationToast 的 `` `is-${n.level}` ``）。
 * 4. 从 `<transition name="x">` / `<transition-group name="x">` 现场推导 Vue 那七个进出场类名。
 * 5. 从 contracts 的 VerifyResult 现场推导 `is-${state}`（体检三态，批次 5-⑤）。
 * 写死名单的话，枚举一改这里就悄悄过期——所以宁可多读两个文件。
 */
function dynamicClassNames(): Set<string> {
  const contracts = fs.readFileSync(CONTRACTS, "utf8");
  const providerContracts = fs.readFileSync(PROVIDER_CONTRACTS, "utf8");
  const block = /PROPOSAL_STATUSES\s*=\s*\[([\s\S]*?)\]/.exec(contracts);
  expect(block, "packages/contracts/src/patch.ts 里找不到 PROPOSAL_STATUSES").toBeDefined();
  const statuses = [...block![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
  expect(statuses.length, "PROPOSAL_STATUSES 解析不出取值").toBeGreaterThan(0);

  const out = new Set(statuses.map((s) => `is-${s}`));

  // DocumentPane 里 `:class="`editor-document--${viewMode}"` 是动态的——字面量搜不到
  // editor-document--edit / --split / --preview，得从 EditorViewMode 派生。
  const bookStorePath = path.join(SRC, "stores/useBookStore.ts");
  const bookStore = fs.existsSync(bookStorePath) ? fs.readFileSync(bookStorePath, "utf8") : "";
  const viewModeBlock = /EditorViewMode\s*=\s*([\s\S]*?);/.exec(bookStore);
  if (viewModeBlock) {
    const modes = [...viewModeBlock[1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
    for (const mode of modes) out.add(`editor-document--${mode}`);
  }

  // NotificationToast 拼的也是 `is-${n.level}`：info / success / warning / error
  // 这四个字面量在模板里一个都搜不到（那儿只有 `is-${n.level}`），
  // 于是那四条配色规则会被判成死 CSS（2026-10-05 批次 3 实际红过一次）。
  const notifyStore = fs.readFileSync(path.join(SRC, "stores/useNotificationStore.ts"), "utf8");
  const levelBlock = /NotificationLevel\s*=\s*([\s\S]*?);/.exec(notifyStore);
  expect(levelBlock, "useNotificationStore.ts 里找不到 NotificationLevel").toBeDefined();
  for (const level of [...levelBlock![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!)) {
    out.add(`is-${level}`);
  }

  // Vue 的 <transition> / <transition-group> 在**运行期**生成那七个类名，源码里只有
  // `name="toast"` 一处——.toast-enter-from 这类字面量一个都搜不到。
  // 扫出 name 再展开成 Vue 的后缀组合，这份名单就不会随着组件增删而腐坏。
  for (const file of walk(SRC).filter((f) => f.endsWith(".vue"))) {
    const tags = fs
      .readFileSync(file, "utf8")
      .matchAll(/<transition(?:-group)?\s[^>]*name="([^"]+)"/g);
    for (const m of tags) {
      const name = m[1]!;
      for (const phase of ["enter", "leave"]) {
        for (const state of ["active", "from", "to"]) out.add(`${name}-${phase}-${state}`);
      }
      out.add(`${name}-move`);
    }
  }

  // 体检三态（批次 5-⑤）：ProviderSettings.vue 与 ModelProfileDialog.vue 都是
  // `:class="`is-${verify.state}`"`，源码里没有 is-ok / is-unreachable / is-unverified
  // 任何一个字面量 ⇒ 三条配色规则会被判成死 CSS。从 contracts 的 VerifyResult 现场推导。
  //
  // 截取范围从 `VerifyResult =` 到**下一个顶层 export**：这个联合类型每个分支里
  // 都有分号（`{ state: "ok"; modelCount: number }`），按 `.*?;` 截会在第一个分支就断掉。
  const verifyAt = providerContracts.indexOf("VerifyResult");
  expect(verifyAt, "packages/contracts/src/provider.ts 里找不到 VerifyResult").toBeGreaterThan(-1);
  const nextExport = providerContracts.indexOf("\nexport ", verifyAt);
  const verifyBody = providerContracts.slice(verifyAt, nextExport === -1 ? undefined : nextExport);
  const states = [...verifyBody.matchAll(/state:\s*"([a-z-]+)"/g)].map((m) => m[1]!);
  expect(states.length, "VerifyResult 解析不出三档取值").toBe(3);
  for (const state of states) out.add(`is-${state}`);

  return out;
}

describe("死 CSS 守卫 · 类名不许写了规则却匹配不到任何元素", () => {
  it("styles/*.css 里的每个类名都有消费者，或属于动态拼出的白名单", () => {
    const dynamic = dynamicClassNames();

    const cssClasses = new Set<string>();
    for (const file of fs.readdirSync(STYLES).filter((f) => f.endsWith(".css"))) {
      const css = stripComments(fs.readFileSync(path.join(STYLES, file), "utf8"));
      for (const m of css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) cssClasses.add(m[1]!);
    }
    expect(cssClasses.size, "CSS 类名一个都没读到，解析口径坏了").toBeGreaterThan(100);

    // 排除 .test.ts：否则本文件提到的类名会把判定喂饱，这条测试就成了永动机。
    const codeText = walk(SRC)
      .filter((f) => /\.(ts|vue)$/.test(f) && !f.endsWith(".test.ts"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");

    const orphans = [...cssClasses].filter((c) => !dynamic.has(c) && !codeText.includes(c));

    expect(
      orphans.map((c) => `.${c}`).sort(),
      "CSS 里的孤儿类名：没有任何元素会带上它，规则一行也匹配不到。" +
        "确认是改版残留就删掉规则；若是有意留的预备样式，先接线再用；" +
        "若它只出现在 :not() 里（否定要求恒真、规则仍有效），把类名加进本测试的豁免说明再豁免。"
    ).toEqual([]);
  });

  // 白名单的地基：动态类名的产生点必须还在，否则上面那条推导出来的名单就是假的
  // （比如有人把 ProposalCard 的 `is-${view.status}` 改成写死的名字）。
  it("动态类名的产生点仍在：ProposalCard 用 `is-${view.status}` 拼状态类", () => {
    const card = fs.readFileSync(path.join(SRC, "components/ProposalCard.vue"), "utf8");
    expect(
      card,
      "ProposalCard.vue 不再拼 `is-${view.status}` 了 —— 本测试从 PROPOSAL_STATUSES 推导的" +
        "动态类名名单会与真实产生点脱节，请同步更新 dynamicClassNames()"
    ).toContain("is-${view.status}");
  });

  // 推导正则坏掉时是**静默**的：少推几条 → 那几条 CSS 被误判成死（红），
  // 多推几条 → 一律放行（绿，且永动机）。所以这里正反各钉一次。
  it("推导不是空转：真推出了 toast 的状态类与 Vue 进出场类", () => {
    const dynamic = dynamicClassNames();
    for (const expected of [
      "is-info",
      "is-success",
      "is-warning",
      "is-error",
      "toast-enter-from",
      "toast-leave-to",
      "toast-move"
    ]) {
      expect(dynamic.has(expected), `推导没推出 ${expected}`).toBe(true);
    }
    // 这条不是推导来的，是写死名单的反向检查：防止有人图省事把一长串类名硬塞进豁免表。
    expect(dynamic.has("totally-not-a-real-class")).toBe(false);
  });

  // 反向钉：LeftSidebar 的 `tree-${docKind}` 是 data-nav-id，不是 class。
  // 一旦有人把它改成真类名，本测试就会漏放一批孤儿——那时这条会红。
  it("别把 tree-${docKind} 当成动态类名：它喂的是 data-nav-id", () => {
    const sidebar = fs.readFileSync(path.join(SRC, "components/LeftSidebar.vue"), "utf8");
    const line = /return `tree-\$\{[^`]*`;/.exec(sidebar)?.[0] ?? "";
    expect(line, "LeftSidebar.vue 里找不到 `tree-${…}` 的返回语句").toBeTruthy();
    // 它必须出现在 navIdOf（data-nav-id 的计算）里，而不是 class 绑定上
    expect(sidebar).toContain(':data-nav-id="navIdOf(group, child)"');
    expect(sidebar).not.toMatch(/:class="[^"]*navIdOf/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   元素（标签）选择器的普查（2026-10-15，台账 §七十八）

   【为什么补这一层】上面那一组只认类名：`styles/*.css` 里 `.xxx` 有没有被源码用到。
   可标签选择器（`kbd` / `hr` / `blockquote` 这类）写不写都算「有规则」，
   而源码里一个 `<kbd` 都没有时**没有任何闸**——2026-10-15 那条 `.nav-row kbd`
   就是这样被人工看出来的（§七十六），当时留下一句「没有闸，要不要立，你说一句就行」。

   【谁算「会造出这个元素」】三份源码一起看：
   · 渲染层自己的 .vue/.ts（去掉 `*.test.ts`——否则本文件提到的标签会把判定喂饱，
     理由与类名那条一字不差）；
   · `renderer/index.html`：`<html>` / `<body>` / `<div id="app">` 只住在这里；
   · `packages/fs-store/src/export-shared.ts`：`markdownToSimpleHtml` 是**运行时**造 HTML 的那一支，
     `hr` 在渲染层源码里一个 `<hr` 都搜不到、只有它造（本轮实测：不把这份文件算进来，
     `.markdown-body hr` 会被误判成死规则）。

   【判定形状：`<tag`，不是裸词】裸词匹配（`\bhr\b`）对单字母标签是**静默的**——
   `a` / `i` / `p` 在任意一段英文注释或字符串里都能命中，死规则会被判成活的。
   换成要求 `<tag ` / `<tag>` / `<tag/` / `</tag` 这个形状之后，`a` 与 `blockquote` 当场露出来。

   【这一层不管的】`styles/*.css` 之外的内联 `<style>` 块（类名那条同样不管，口径一致）；
   源码注释里写的 `<p class="…">` 会把该标签喂成「有消费者」——与类名那条同一局限，
   只影响漏报、不影响误报（方向是绿的）。
   ───────────────────────────────────────────────────────────────────────── */
/** `@keyframes` 的帧关键字，不是标签选择器：抽标签时让开。 */
const KEYFRAME_FRAME_WORDS = new Set(["from", "to"]);

/**
 * 一条选择器里的元素（标签）选择器：每个复合选择器的首个裸词，前置不是 `.` `#` `:` `[`。
 * 属性选择器先剥掉——`[data-theme="dark"]` 的属性名与取值看着像词，都不是标签。
 * `:not(pre)` 这类伪类括号里的标签**不收**（保守：宁可漏报也不误报）。
 */
function typeSelectorsIn(selector: string): string[] {
  const out: string[] = [];
  for (const compound of selector.replace(/\[[^\]]*\]/g, "").split(/[\s>+~,]+/)) {
    const first = /^([a-z][a-z0-9]*)/.exec(compound.trim());
    if (first === null) continue;
    const tag = first[1]!;
    if (!KEYFRAME_FRAME_WORDS.has(tag)) out.push(tag);
  }
  return out;
}

/** 样式表 → 这一页写了哪些标签选择器（标签 → 出现在哪些文件名里，去重且按名字排序）。 */
function tagSelectorsInStyles(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of fs
    .readdirSync(STYLES)
    .filter((f) => f.endsWith(".css"))
    .sort()) {
    // 必须先剥注释再交给 cssRules：theme-runtime.css 的注释里就写着带大括号的规则片段，
    // 不剥的话那些片段会被当成真规则、抽出并不存在的标签。
    for (const rule of cssRules(strippedStyleSource(file))) {
      // at-rule 前奏不是选择器（`@keyframes` 的帧由上面那枚常量让开）。
      if (rule.selector.startsWith("@")) continue;
      for (const tag of typeSelectorsIn(rule.selector)) {
        const files = out.get(tag) ?? [];
        if (!files.includes(file)) files.push(file);
        out.set(tag, files);
      }
    }
  }
  return out;
}

/** 真会造出元素的源码正文（渲染层 .vue/.ts − 测试 + index.html + markdown 渲染器）。 */
function tagProducerSource(): string {
  return [
    ...walk(SRC)
      .filter((f) => /\.(ts|vue)$/.test(f) && !f.endsWith(".test.ts"))
      .map((f) => fs.readFileSync(f, "utf8")),
    fs.readFileSync(path.join(SRC, "..", "index.html"), "utf8"),
    fs.readFileSync(MARKDOWN_RENDERER, "utf8")
  ].join("\n");
}

/**
 * 一枚标签有没有产生点。**要求 `<tag` 这个形状**，不用裸词——理由见上面那段注释。
 * 单拎出来，是为了能在**合成输入**上证明它真的会咬（`isTagProduced("xyzzy", …)` 必须为 false）：
 * 一个恒返回 true 的实现会让孤儿集合恒为空，普查就成了永动机。
 */
function isTagProduced(tag: string, source: string): boolean {
  return new RegExp(`<\\s*/?\\s*${tag}(?=[\\s/>])`, "i").test(source);
}

describe("死 CSS 守卫 · 元素选择器不许写了规则却匹配不到任何元素", () => {
  it("styles/*.css 里的每个标签选择器都有产生点", () => {
    const source = tagProducerSource();
    const orphans: string[] = [];
    for (const [tag, files] of tagSelectorsInStyles()) {
      if (!isTagProduced(tag, source)) orphans.push(`${tag}  <-  ${files.join(", ")}`);
    }
    expect(
      orphans.sort(),
      "CSS 里的孤儿标签选择器：源码里没有任何 `<tag` 会落进这条规则，规则一行也匹配不到。" +
        "确认是改版残留、或渲染器根本不产的那种标签（如简易 markdown 渲染器不产 blockquote），" +
        "就删掉规则；若是有意留的预备样式，先接线（把元素真造出来）再用。"
    ).toEqual([]);
  });

  it("普查不是空转：抽到的标签是这些，且渲染器造的 hr 也算有产生点", () => {
    const tags = [...tagSelectorsInStyles().keys()];
    expect(tags.length, "一枚标签选择器都没抽到，解析口径坏了").toBeGreaterThan(20);
    for (const expected of [
      "html",
      "body",
      "button",
      "input",
      "textarea",
      "select",
      "svg",
      "hr",
      "kbd"
    ]) {
      expect(tags, `没抽到标签选择器 ${expected}`).toContain(expected);
    }
    // 反向：`.foo` / `#app` / `:hover` / `[data-theme]` 的碎片都不是标签，不许混进来。
    for (const notTag of ["foo", "app", "hover", "data-theme", "from", "to"]) {
      expect(tags, `${notTag} 不是标签选择器，被误抽进来了`).not.toContain(notTag);
    }
    // `hr` 的产生点在 markdown 渲染器里，这一条钉住那份文件真的进了语料（不然它会漏判成死）。
    expect(isTagProduced("hr", tagProducerSource()), "hr 的产生点没被读进来").toBe(true);
    // 反向：凭空一枚标签不能被当成有产生点——这是「判据真的会咬」的地基。
    expect(isTagProduced("xyzzy", tagProducerSource())).toBe(false);
  });
});

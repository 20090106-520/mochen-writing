import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

/**
 * 键位落点：热键判出来的动作，必须真有地方能看见（批次 5-㊴）。
 *
 * 【这一族出过什么错】不是死键——键位表全接上了，`dispatch` 里还有 `never` 穷尽守卫兜底。
 * 出错的是**动作接线了、在当前状态下却什么都不发生**，而且比死键更阴：
 * 它还会**推一个看不见的标记**，那个标记排在 `resolveEscape` 的前面，于是白吃掉一次 Esc。
 * 真机实测两处，两处的形状一模一样：
 *   ① `Ctrl+F`：`findReplace.visible = true`，而 FindReplacePanel 挂在 DocumentPane 里，
 *      设置页下 DocumentPane 整个不在 DOM 里 ⇒ 屏上零像素，`findReplaceIsOpen` 却成立
 *      ⇒ **第一次 Esc 像死键，要按第二下才出设置页**。
 *   ② `/` 行内引用菜单：菜单挂在 CenterColumn 的输入卡里，切去设置页时 ComposerReferenceMenu
 *      的 `onBeforeUnmount` 只摘监听、不 close ⇒ `match` 留着，`referenceMenuIsOpen` 同样成立
 *      ⇒ 又一次「第一下白按」。
 * 这两处此前都是「打开端判了落点、Esc 端没判」：5-㊴ 之前 `/` 的 `openPalette` 已经判过一次落点，
 * 而 Ctrl+F 连打开端都没判。**半截的修法等于没修**——只堵打开端，白吃的 Esc 还在。
 *
 * 【为什么判定归装配层】落点这个事实的真身是 App.vue 那份模板上的 `v-if`（DocumentPane 挂在哪一格、
 * CenterColumn 挂在哪一格）与 DocumentPane 里的 `mode === 'manuscript'`。
 * 在 useHotkeys 里复写那几条条件就是第二次实现，而第二次实现正是本缺陷的成因。
 * 与 `openPalette` 的既有裁定同款：判定在装配层（App.vue），这里只回调过去。
 *
 * 【这份守卫钉什么、不钉什么】钉的是**接线**（谁提供判据、判据在动作与 Esc 两端都读到了）与
 * **判据与它所镜像的那两处 v-if 的对应关系**。行为本身在真机上量：
 * `.mochen-tmp/p535/p536m-landing-esc.mjs`。`.vue` 零自动化覆盖是本仓铁律，
 * 所以「落点判据 == 模板 v-if」这条只能钉在两侧的字面上，靠变异实验证明它有鉴别力。
 */

const HOTKEYS = "composables/useHotkeys.ts";
const APP = "App.vue";
const PANE = "components/DocumentPane.vue";

/** 从 `typeScriptSource` 里切出一段 switch 的某个 case 分支；切不到就抛错（空串会让断言假绿）。 */
function caseBlock(source: string, label: string, nextLabel: string): string {
  const start = source.indexOf(`case "${label}":`);
  if (start === -1) throw new Error(`${HOTKEYS} 里没有 case "${label}"`);
  const end = source.indexOf(`case "${nextLabel}":`, start);
  if (end === -1) throw new Error(`${HOTKEYS} 里 case "${label}" 后面找不到 case "${nextLabel}"`);
  return source.slice(start, end);
}

/** 从 App.vue 的 script 里切出一个具名函数的函数体（花括号配平）；切不到就抛错。 */
function functionBody(source: string, name: string): string {
  const head = `function ${name}(`;
  const start = source.indexOf(head);
  if (start === -1) throw new Error(`${APP} 里没有 ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${APP} 里 ${name} 的花括号没配平`);
}

/**
 * `resolveEscape({…})` 那一次调用的实参块。
 * 【为什么必须切出这一块再断言】`referenceMenuIsOpen` 这个名字在两个接口里都出现：
 * `HotkeyFocusSources`（喂 deriveHotkeyFocus）与 `EscapeFocusState`（喂 resolveEscape）。
 * 全文件正则会把前者也吃进来——`referenceMenuIsOpen: reference.isOpen,` 那一句是**合法**的
 * （键位判定端另有 `composerIsFocused` 把关，输入卡不在时那三条本来就走不到），
 * 于是反向断言会对着正确代码报红。第一次跑就撞上了：8 条里红的那条正是它。
 */
function escapeInputs(source: string): string {
  const start = source.indexOf("resolveEscape({");
  if (start === -1) throw new Error(`${HOTKEYS} 里找不到 resolveEscape({`);
  const end = source.indexOf("});", start);
  if (end === -1) throw new Error(`${HOTKEYS} 里 resolveEscape({ 的实参块没闭合`);
  return source.slice(start, end);
}

/** 组件标签上的 `v-if` 取值。标签没有 class，tagAttributes 用不上（见下面「为什么不复用它」）。 */
function vIfOf(template: string, tag: string): string {
  const at = template.indexOf(`<${tag}`);
  if (at === -1) throw new Error(`模板里没有 <${tag}`);
  const head = template.slice(at, at + 200);
  const match = /v-if="([^"]*)"/.exec(head);
  if (match === null || match[1] === undefined) {
    throw new Error(`<${tag}> 上没有 v-if（或它排在 200 字符之外）`);
  }
  return match[1];
}

describe("键位落点 · 判据只有一个真身，且动作端与 Esc 端读的是同一份", () => {
  it("两个落点判据都是必填回调——少接一个编译就红，不给默认值兜底", () => {
    const src = typeScriptSource(HOTKEYS);
    expect(src).toContain("findReplaceHasLanding(): boolean;");
    expect(src).toContain("referenceMenuHasLanding(): boolean;");
    // 5-㊷ 第三枚：皮肤广场的浮层（整窗预览条 / 对比栏）。
    expect(src).toContain("skinGalleryHasLanding(): boolean;");
    // 带 `?` 就是「可以不接」：漏接的调用点会安静地少一层判据，正是本缺陷的形状。
    expect(src).not.toMatch(/findReplaceHasLanding\?\s*\(\)/);
    expect(src).not.toMatch(/referenceMenuHasLanding\?\s*\(\)/);
    expect(src).not.toMatch(/skinGalleryHasLanding\?\s*\(\)/);
  });

  it("装配层把三个判据都接上了（App.vue 是唯一调用点）", () => {
    const app = scriptSource(APP);
    const call = /useGlobalHotkeys\(\{([\s\S]*?)\n\}\)/.exec(app)?.[1];
    expect(call).toBeDefined();
    expect(call).toContain("findReplaceHasLanding");
    expect(call).toContain("referenceMenuHasLanding");
    expect(call).toContain("skinGalleryHasLanding: skinGalleryIsMounted");
    // 「已在当前目的地的那一枚」不适用于本族：落点不在就必须是 no-op，所以不许留兜底默认值。
    expect(call).not.toMatch(/HasLanding:\s*\(\)\s*=>/);
  });

  it("Ctrl+F：落点判据排在 preventDefault 与 store.open() 之前——没有落点就连标记都不落", () => {
    const block = caseBlock(typeScriptSource(HOTKEYS), "open-find-replace", "panel-shortcut");
    const gate = block.indexOf("handlers.findReplaceHasLanding()");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(block.indexOf("event.preventDefault()"));
    expect(gate).toBeLessThan(block.indexOf("findReplace.open()"));
  });

  it("Esc：两个标记都必须先问落点，否则看不见的标记会白吃一次 Esc", () => {
    // 只在 resolveEscape 的实参块里断言（见 escapeInputs 的理由）。
    const esc = escapeInputs(typeScriptSource(HOTKEYS));
    // 正向：实参是「开着 **且** 有落点」。
    expect(esc).toMatch(
      /findReplaceIsOpen:\s*findReplace\.visible\s*&&\s*handlers\.findReplaceHasLanding\(\)/
    );
    expect(esc).toMatch(
      /referenceMenuIsOpen:\s*reference\.isOpen\s*&&\s*handlers\.referenceMenuHasLanding\(\)/
    );
    // 5-㊷：皮肤浮层同一族——预览条挂在皮肤广场那一格里，人已经离开那一页时它不在屏上。
    expect(esc).toMatch(
      /skinOverlayIsOpen:\s*skins\.overlayIsOpen\s*&&\s*handlers\.skinGalleryHasLanding\(\)/
    );
    // 反向：钉住 5-㊴ 之前的那个形状本身（只读 visible 就当它开着）。
    expect(esc).not.toMatch(/findReplaceIsOpen:\s*findReplace\.visible\s*[,;}]/);
    expect(esc).not.toMatch(/referenceMenuIsOpen:\s*reference\.isOpen\s*[,;}]/);
    expect(esc).not.toMatch(/skinOverlayIsOpen:\s*skins\.overlayIsOpen\s*[,;}]/);
  });

  /**
   * 5-㊷ 新加的那一支动作有没有**真的落点**。
   *
   * 【为什么单钉这一条】这一族的失效形状不是「按了没反应」，而是「按了但关错了东西」：
   * 皮肤页的 `overlayIsOpen` 是个 store 记号，人切去对话页之后它可能还留着
   * （页面卸载与记号清除是两件事）。那时一次 Esc 会走 `close-skin-overlay`，
   * 把这一轮该做的事（比如打断）吞掉——屏幕上什么都没关，用户只看见「第一下没用」。
   */
  it("close-skin-overlay 这一支：动作就是收最外那一层，不关整页、不落盘", () => {
    const block = caseBlock(typeScriptSource(HOTKEYS), "close-skin-overlay", "close-overlay");
    expect(block).toContain("event.preventDefault()");
    expect(block).toContain("skins.closeTopLayer()");
    // 反向：这一族的两条老失效形状。
    // ① 把「收一层」写成「关整页」——用户退预览时连正在挑的那一页也没了（与 close-overlay 同义）；
    // ② 顺手写设置——预览是不落盘的临时刷写，落盘只该发生在「就用它」那一次。
    expect(block).not.toMatch(/layout\.showWorkspace\(\)/);
    expect(block).not.toMatch(/appearance|settings/i);
  });

  it("落点判据在实参那一侧（与另两支同形），case 里不重复第二份", () => {
    const block = caseBlock(typeScriptSource(HOTKEYS), "close-skin-overlay", "close-overlay");
    // 有落点才进得来这一支：判据已经写在 resolveEscape 的实参上（上面那条已钉）。
    // 这里钉的是**不许在 case 里再判一次**——两处判一处改就是「白吃 Esc」那一族的成因。
    expect(block).not.toContain("skinGalleryHasLanding");
  });

  it("`/` 的打开端判据留在装配层（openPalette 里那一次），useHotkeys 里不许再写第二份", () => {
    const app = scriptSource(APP);
    const palette = /openPalette:\s*\(\)\s*=>\s*\{([\s\S]*?)\n {2}\},/.exec(app)?.[1];
    expect(palette).toBeDefined();
    expect(palette).toMatch(/if \(\w+\(\)\) referenceMenu\.summon\("\/"\);/);
    const block = caseBlock(typeScriptSource(HOTKEYS), "open-palette", "open-find-replace");
    expect(block).not.toContain("referenceMenuHasLanding");
  });
});

describe("键位落点 · 判据必须与它所镜像的那两处 v-if 对得上", () => {
  it("中栏那一格：centerChatIsMounted 与模板里 CenterColumn 的 v-if 同源", () => {
    // 判据在 App.vue（装配层），落点的真身是同一份文件里那个 v-if——这是它唯一能对读的地方。
    const body = functionBody(scriptSource(APP), "centerChatIsMounted");
    expect(body).toContain('currentView.value === "workspace"');
    expect(body).toContain('centerView.value === "chat"');
    // 模板那一格：v-if 里出现过的每一个字面量，判据里都得有对应的读法。
    const vIf = vIfOf(templateSource(APP), "CenterColumn");
    expect(vIf).toContain("centerView === 'chat'");
    // 反向：模板那一格不在时判据必须为假，否则 Ctrl+F 会推一个看不见的标记。
    expect(body).not.toBe("");
    expect(functionBody(scriptSource(APP), "findReplaceHasLanding")).toContain(
      "centerChatIsMounted()"
    );
  });

  it("查找面板：findReplaceHasLanding 与 DocumentPane 那两处 v-if 一一对得上", () => {
    const body = functionBody(scriptSource(APP), "findReplaceHasLanding");
    expect(body).toContain("centerChatIsMounted()");
    expect(body).toContain("!rightCollapsed.value");
    expect(body).toContain('book.rightPaneMode === "manuscript"');

    // 宿主那一格（App.vue 模板）
    const host = vIfOf(templateSource(APP), "DocumentPane");
    expect(host).toBe("!rightCollapsed && centerView === 'chat'");
    // 面板自己那一格（DocumentPane 模板）
    const panel = vIfOf(templateSource(PANE), "FindReplacePanel");
    expect(panel).toBe("findVisible && mode === 'manuscript'");
  });

  it("皮肤广场那一格：skinGalleryIsMounted 与模板里 SkinGalleryPage 的 v-else-if 同源（5-㊷）", () => {
    const body = functionBody(scriptSource(APP), "skinGalleryIsMounted");
    expect(body).toContain('currentView.value === "workspace"');
    expect(body).toContain('centerView.value === "skins"');
    /* 【为什么这里不用 vIfOf】它找的是 `v-if="`，而这一格写的是 `v-else-if="`——
       `else-if` 前面是连字符，那一串里并没有 `v-if="` 这个子串。
       于是 vIfOf 从 `<SkinGalleryPage` 往后一路找到**下一条** v-if 上（DocumentPane 的
       `!rightCollapsed && centerView === 'chat'`），报的红完全不是这个标签的事——第一次跑就是这样。
       ⇒ 落点的真身要按它自己的写法读。 */
    const markup = templateSource(APP);
    const at = markup.indexOf("<SkinGalleryPage");
    expect(at, "App.vue 模板里没有 <SkinGalleryPage>").toBeGreaterThan(-1);
    expect(markup.slice(at, at + 120)).toContain(`v-else-if="centerView === 'skins'"`);
  });

  it("改了这几处 v-if 就得同步改判据——所以这里把 v-if 的字面值一并钉住", () => {
    // 这条断言存在的意义：上面两条钉的是「判据读了什么」，这条钉的是「落点的真身写了什么」。
    // 只钉前者的话，某天有人给 DocumentPane 的 v-if 加一个条件而忘了判据，守卫照样全绿。
    expect(vIfOf(templateSource(APP), "DocumentPane")).toBe(
      "!rightCollapsed && centerView === 'chat'"
    );
    expect(vIfOf(templateSource(APP), "CenterColumn")).toBe("centerView === 'chat'");
    expect(vIfOf(templateSource(PANE), "FindReplacePanel")).toBe(
      "findVisible && mode === 'manuscript'"
    );
  });
});

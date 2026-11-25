/**
 * 切模型这条链路的接线契约（#104；2026-10-07 改形）。
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`vue-shim.d.ts` 把 `*.vue` 声明成 any ⇒ 组件零类型检查，
 * 于是「chip 点得到 store、store 走对通道、弹层不撒谎」只能钉成读源码断言
 * （同律先例：provider-settings-wiring.test.ts、document-pane-wiring.test.ts）。
 * 注释会被 vue-source-reader 剥掉：只在注释里宣称的接线不算数。
 *
 * 【2026-10-07 三条断言改钉了，不是删掉】用户裁定「模型切换不该弹居中对话框，
 * 应该像参考图那样点 chip 弹出来、直接切换」，下面三条与旧形状直接冲突：
 *   ① 遮罩点空白关 / `role="dialog"` —— 模态那一套整套退役；
 *   ② 当前那行不是按钮 —— 改成整行可点 + 当前项带 ✓；
 *   ③ `open-model-select` 无载荷 —— 下拉要拿 chip 当锚点，元素只能从这里交上去。
 * 每一条后面都写了「保证没变小」的理由；判定只放松形状，不放松通路——
 * 关闭的四条路、切换的那一条路、以及「不能有按了没反应的行」，一条都没少。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  styleSource,
  tagAttributes,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const POPOVER = "components/ModelSelect.vue";
const CENTER = "components/CenterColumn.vue";
const COMPOSER = "components/ComposerBox.vue";
const SETTINGS = "components/ProviderSettings.vue";

describe("ModelSelect · 弹层本体", () => {
  /**
   * 改钉（2026-10-07，第 ① 条）：从「居中模态」改成「贴 chip 的下拉」。
   *
   * 保证没变小——旧的三条关闭通路一条没少，只是「点遮罩空白」升级成「点浮层外面」：
   *   · 点空白关 → **扩大**为 pointerdown / focusin 在浮层与锚点之外都关（旧遮罩只覆盖自己的全屏层）；
   *   · Esc 关 → 保留，只是判定改走共用的 `popoverOwnsKey`（裁定 G5：裸键比较只留一份）；
   *   · 关闭钮关 → 保留，只是从面板底部挪到头部（贴着输入卡时底部那颗会掉出视口）。
   * 还多了一条：Tab 触边即收起并把焦点还给 chip——那是共有的合成器带来的，不额外计价。
   * 反向钉：旧模态的痕迹（遮罩类名 / `role="dialog"` / `aria-modal`）在模板**与样式表**里都得消失，
   * 否则会留一段没人渲染的死样式，且下一个人会以为还有遮罩。
   */
  it("改成贴 chip 下拉后，关闭通路一条不少：点外面 / Esc / 关闭钮都还接在共用的收拢器上", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    // 四条通路的地基：定位/点外面/Esc/Tab/焦点归还全在这一处，不另造第二套收拢机制。
    expect(script).toContain("useComposerContextPopover(");
    expect(markup).toContain('<Teleport to="body">');
    expect(markup).toContain(':style="style"');
    // Esc：判定走 popoverOwnsKey 纯函数，模板里不写裸比较。
    // 【为什么要把整个函数体切出来钉，而不是 toContain 那一串调用】
    // 变异 #19 实测：`if (false && popoverOwnsKey(event.key, mods, ...))` 照样全绿——
    // 因为那一串字面还在，而 Esc 分支实际上已经死了。所以这里钉的是**控制流**：
    // 那一行必须真的是 `if (popoverOwnsKey(...)) {`，分支里必须真的调 close 并吞掉事件。
    const handler =
      /function onKeydown\(event: KeyboardEvent\): void \{[\s\S]*?\n\}/.exec(script)?.[0] ?? "";
    expect(handler, "onKeydown 读不到").not.toBe("");
    expect(handler).toContain("if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {");
    // 5-㊶：第三条参数只走真身；散写 isComposing 就是在别处又埋一份判据。
    expect(script).not.toContain("event.isComposing === true");
    expect(handler).toContain("event.stopPropagation();");
    expect(handler).toContain("close();");
    expect(handler).toContain(`if (event.key === "Tab") tab(event);`);
    expect(markup).toContain('@keydown="onKeydown"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('@click="close"');

    // 反向钉：旧模态的痕迹不许留在任何一侧。
    expect(markup).not.toContain("model-select-mask");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("aria-modal");
    const css = styleSource("interaction.css");
    expect(() => ruleBlock(css, ".model-select-mask")).toThrow();
    // 几何只由合成器以行内样式交给它：样式表里再写一遍就会有一份悄悄不生效。
    const panel = ruleBlock(css, ".model-select");
    expect(panel).not.toContain("width:");
    expect(panel).not.toContain("max-height:");
    expect(panel).toContain("position: fixed");
  });

  /**
   * 改钉（2026-10-07 第 ② 条，2026-10-25 续改）：从「当前行不是按钮」改成「整行可点 + 当前项带 ✓」，
   * 2026-10-25 又把**当前那一行从名单里挪出来**，单开一段「正在用」摆在最上面。
   *
   * 保证没变小——旧断言防的是「按了没反应的按钮」，新形状没有让这个问题回来的余地：
   *   · 两处行（当前那一行 + 分组里的行）都是 `<button role="menuitem">`，点击一律进 `pick()`；
   *   · `pick()` 里点当前项走的是 **close()**，也就是「按下去有反应」（收起），
   *     而不是把同一个模型名再写一遍——写一遍既无效果，又让人以为没生效；
   *   · 其余行走 `emit("select", name)`，切模型那条真路没变。
   * 反向钉：旧的「改用」按钮（`.model-select-pick`）与徽章（`.model-select-badge`）都得消失。
   *
   * 【为什么改成按标签切开数，而不是整份 toContain】
   * 变异的形状正是「把**某一枚**行按钮的 `@click` 摘掉」——整份里另一枚行按钮的 `@click`
   * 还在，`toContain` 照样饱。而 `split("<button")` 之后逐块看，摘掉哪一枚都看得见。
   */
  it("每一行都可点且点了必有反应：当前项单开一段带 ✓，点它收起而不是重复写同一个值", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    const rowChunks = markup
      .split("<button")
      .slice(1)
      .filter((chunk) => /class="model-select-row/.test(chunk));
    expect(rowChunks.length, "行按钮一枚都不剩").toBeGreaterThanOrEqual(2);
    for (const chunk of rowChunks) {
      // 2026-10-25：这一族浮层统一成 listbox/option + aria-selected（与 @ 引用菜单、
      // 权限档、阶段选择同一形状）⇒ 旧断言里的 role="menuitem" 改成 role="option"。
      expect(chunk, "有一枚行按钮不是选项").toContain('role="option"');
      expect(chunk, "有一枚行按钮点了不进货").toContain('@click="pick(name)"');
      // 高亮那一行要同时说给屏幕阅读器（aria-selected）与样式（is-selected）。
      expect(chunk, "有一枚行按钮没接上高亮").toContain(":aria-selected=");
      expect(chunk, "有一枚行按钮没接上高亮类").toContain("'is-selected'");
    }
    // 当前项那一行：静态类 + aria-current，右端带 ✓（不再是徽章）。
    expect(markup).toContain('class="model-select-row is-current"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain(`class="model-select-check" name="check"`);

    // 2026-11-20 第二刀（参考图同款）：两处行模板（当前 + 其余）行首各一枚通用图标徽章——
    // 各家 logo 我们没有资产也没有数据通路，放的是 model 图标，不放假 logo。
    // 类名刻意避开 model-select-badge（那是旧徽章时代的名字，下面那条反向钉管着）。
    const rowIconCount = markup.split('class="model-select-row-icon"').length - 1;
    expect(rowIconCount, "两处行模板各要一枚行首徽章").toBe(2);
    // 2026-11-20 第三刀（参考图同款的结构）：每一行右缘一枚元信息位——参考图那里是积分
    // 倍率（x0.8），本仓没有这个数据，放的是名字里自带的版本号（versionBadgeOf），
    // 不放假倍率。两处行模板各一枚；版本位是不是真「读名字」由 utils 的单测钉。
    const metaCount = markup.split('class="model-select-meta"').length - 1;
    expect(metaCount, "两处行模板各要一枚右缘元信息位").toBe(2);
    // 版本位是不是真「读名字」：import 在 script、调用在模板——两头都要有。
    expect(script).toContain("versionBadgeOf,");
    expect(markup).toContain("versionBadgeOf(name)");

    // 「按了有反应」那一半：钉在 pick 的函数体上，不靠读模板的 if。
    const pick = /function pick\(name: string\): void \{[\s\S]*?\n\}/.exec(script)?.[0] ?? "";
    expect(pick).toContain("if (name === props.current)");
    expect(pick).toContain("close();");
    expect(pick).toContain(`emit("select", name)`);
    // 旧形状的残留
    expect(markup).not.toContain("model-select-pick");
    expect(markup).not.toContain("model-select-badge");
  });

  it("忙态理由是看得见的文字，不是 disabled 按钮上的 title（Chromium 不给 disabled 弹提示）", () => {
    const markup = templateSource(POPOVER);
    expect(markup).toContain('v-if="switching"');
    expect(markup).toContain("正在写回模型名");
    expect(markup).not.toMatch(/:disabled="switching"[\s\n]+:title/);
  });

  it("失败时把主进程那句中文理由原样摆出来，并提供一次真的重试", () => {
    const markup = templateSource(POPOVER);
    expect(markup).toContain("{{ failReason }}");
    expect(markup).toContain(`@click="emit('retry')"`);
  });

  /**
   * 2026-10-05 用户截图实锤：报错写着「请在设置里重新填写 API Key」，弹窗却只有「再试一次」。
   * 坏密钥/空地址重试一万次也是同一个错——那句话当时只是一句指点路的话。
   * 钉的是「失败态有两条出路」，且去设置那条必须走 layout 的唯一真身。
   */
  it("失败态给两条出路：重试 + 去模型设置（后者是唯一真能解决坏密钥/空地址的那个）", () => {
    const markup = templateSource(POPOVER);
    expect(markup).toContain(`@click="emit('open-settings')"`);
    expect(markup).toContain("去模型设置");
    // 两条出路同在失败态那个 v-else 块里，不许把「去设置」藏到只有成功态才出现。
    const failBranch = /<template v-else>[\s\S]*?<\/template>/.exec(markup)?.[0] ?? "";
    expect(failBranch).toContain(`@click="emit('retry')"`);
    expect(failBranch).toContain(`@click="emit('open-settings')"`);
    // 装配处接的是 layout 真身，不另捏一份开设置的路；顺手把浮层关掉（整页视图会换掉宿主）。
    const center = vueSource("components/CenterColumn.vue");
    expect(center).toContain('@open-settings="openModelSettings"');
    const fn =
      /function openModelSettings\(\): void \{[\s\S]*?\}/.exec(
        scriptSource("components/CenterColumn.vue")
      )?.[0] ?? "";
    expect(fn).toContain("layout.showSettings(");
    expect(fn).toContain("modelsOpen.value = false;");
  });

  it("拉取与理由都只读 props：组件自己不碰 window.mochen，也不拼 {baseURL}/models", () => {
    const script = scriptSource(POPOVER);
    expect(script).not.toContain("window.mochen");
    expect(script).not.toContain("/models");
    expect(script).toContain('from "@mochen/contracts"');
  });

  it("title 报出通道名（铁律：报不出通道名的控件不进 UI）", () => {
    expect(templateSource(POPOVER)).toContain("provider:list-models");
  });

  /**
   * 2026-10-25 用户裁定：「我这是写小说的，应该只显示写作模型，其他的模型不显示」。
   *
   * 这一刀比 2026-10-22 那版「分组 + 行尾标记」更彻底：标记只是提醒，藏掉才是根治。
   * 保证没变小——「切换」那条真路一条没少（点哪一行还是切哪一行）；
   * 少掉的只是**不能写对话的那几行**（图像/视频模型选上去只会被上游 400 顶回来，
   * §167 真机事故就是这么来的）。
   *
   * 钉三件事：
   *   ① 名单只留写作模型，判据只有一份（utils/model-picker 的 writableModels）；
   *   ② 分组那一整套（groupModels / 组标题 / 行尾模态标记）**撤掉了**，不许悄悄加回来——
   *      那是第二份「名单怎么排」的判定（铁律 6）；
   *   ③ 「正在用」那一行**照常摆着**，哪怕当前在用的这一枚不是写作模型——
   *      那是「此刻在用的那一个」，不是「可选名单」，藏起来等于面板不认账；
   *      那一行行尾要标出模态（手填的模型名 / 早先误切留下的图像模型）。
   */
  it("只列写作模型：图像/视频一行都不画，分组那一整套也撤了", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    // ① 判据只有一份：组件引 utils 那份，不自己判「是不是图像模型」。
    expect(script).toContain('from "../utils/model-picker"');
    expect(script).toContain("writableModels(allModels.value)");
    expect(script).not.toContain("modelKindOf");
    // ② 分组那一整套不许回来（连组标题那个类名一起）。
    expect(script).not.toContain("groupModels");
    expect(script).not.toContain("MODEL_GROUP_CAVEAT");
    expect(script).not.toContain("MODEL_MODALITY_WARNING");
    expect(markup).not.toContain("model-select-group-head");
    // 名单下面那些行不再挂模态标记（它们按定义全是写作模型，恒为空 ⇒ 死标记）。
    // 标记只留在「正在用」那一行——那一枚**可能**不是写作模型。
    const restRows = markup.split("split.rest")[1] ?? "";
    expect(restRows, "名单里的行不该再挂模态标记").not.toContain("modalityLabelOf");
    // ③ 空态说清楚「上游给的模型里没有能用来写这一轮的」，那句话只有一份。
    expect(script).toContain("MODEL_WRITABLE_ONLY_NOTE");
    expect(markup).toContain("MODEL_WRITABLE_ONLY_NOTE");
  });

  /**
   * 「正在用」那一行是**唯一**还可能挂着模态标记的地方。
   *
   * 钉的是位置（那一行在 `split.current` 那段里），不是「模板里出现过 modalityLabelOf」——
   * 后者会让标记挂到名单的每一行上去（那里恒为空，是死标记）。
   */
  it("模态标记只挂在「正在用」那一行：当前在用的可能不是写作模型，标出来是诚实", () => {
    const markup = templateSource(POPOVER);
    const currentBlock = /v-for="name in split\.current"[\s\S]*?<\/li>/.exec(markup)?.[0] ?? "";
    expect(currentBlock, "「正在用」那一段读不到").not.toBe("");
    expect(currentBlock).toContain("modalityLabelOf");
    expect(currentBlock).toContain("model-select-tag");
  });

  /**
   * 面板自报宽高（2026-10-25）。
   *
   * 共用的合成器默认给 320 宽 / 380 高，那是给「挑一个选项」那类短菜单的。
   * 模型名单动辄十几个，380 会把列表切在半行上（真机读数：9 个模型只露 5 行，第五行是半截）。
   * ⇒ 本面板自报 380 宽 / 520 高，走的是合成器那对现成的口子（`widthPx` / `limitPx`），
   * **底线没松**：合成器那侧仍是 `min(limitPx, spacePx)`，贴窗口下沿打开不会跑到屏幕外。
   *
   * 几何只有一份：样式表里不许再写一遍 width / max-height（写两遍就会有一份悄悄不生效）。
   */
  it("面板自报宽高，样式表里不再写第二份几何", () => {
    const script = scriptSource(POPOVER);
    expect(script).toContain("widthPx: () => panelWidth.value");
    expect(script).toContain("limitPx: PANEL_MAX_HEIGHT");
    const css = styleSource("interaction.css");
    const panel = ruleBlock(css, ".model-select");
    expect(panel).not.toContain("width:");
    expect(panel).not.toContain("max-height:");
  });

  /**
   * 2026-10-25 那一刀的核心：当前模型**单开一段**摆到最上面。
   *
   * 真机读数（改之前）：当前那枚 `agnes-3.0-flash` 混在名单第 4 行——用户打开面板
   * 第一眼看不到「我现在用的是哪个」；名单一长（几十个模型）它还会被挤出视口。
   * Cursor / Claude Code 那一类切换器都把当前项单列，这是共识。
   *
   * 「不重复出现」也钉住：当前模型进了「正在用」那一段，就不许再出现在下面的分组里
   * （同一个名字出现两次，用户会以为有两个模型）。
   */
  it("当前模型单开一段「正在用」摆在最上面，且不在下面的名单里重复出现", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    // 切分只有一份判定：utils/model-picker 的 splitByCurrentModel。
    expect(script).toContain(
      'splitByCurrentModel(upstream.value, props.current, props.current !== "")'
    );
    // 高亮次序：当前那一行在最前，其余在后（不是把当前混在名单中间）。
    expect(script).toContain("...split.value.current,");
    expect(script).toContain("...split.value.rest");
    // 「正在用」那一段标题必须**挂在「有当前模型」这个条件上**。
    // 【为什么不能只钉「模板里出现过『正在用』三个字」】那三个字是静态文案，
    // 变异把条件摘掉（v-if="false"）之后它照样在模板里，`toContain` 照样绿——
    // 而那一段的真身是**条件**，不是那几个字。
    expect(markup).toMatch(/v-if="split\.current\.length"[^>]*>\s*正在用/);
  });

  /** 2026-11-21 用户裁定：名单上方不再摆搜索框，首屏只保留模型菜单。 */
  it("不提供搜索框；打开后焦点仍由共用合成器送进浮层", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    expect(markup).not.toContain("model-select-search");
    expect(markup).not.toContain('type="search"');
    expect(script).not.toContain("const query");
    expect(script).toContain("focusSelector: () =>");
    expect(script).toContain('return ".model-select-menu-row"');
    expect(script).not.toContain("querySelector");
  });

  /**
   * ↑↓ 走高亮、焦点留在搜索框、Enter 直接切（2026-10-25）。
   *
   * 改之前 ↑↓ 搬的是**真焦点**：一按 ↓，焦点就离开搜索框了，于是「再打两个字」变成打不动。
   * 改之后 ↑↓ 走的是一个**下标**（高亮），真焦点始终在搜索框里 —— 能边打字边选。
   *
   * 【2026-10-25 再收一刀：高亮判据抽成共用的一份】
   * 组件原先自己写了一份 `moveActive` / `watch(visibleNames)`——而 @ 引用菜单、
   * 权限档、阶段选择这三处各写各的，同一件事四份实现（铁律 6），
   * 于是「↑↓ 能不能用」在不同浮层里表现不一样（权限档干脆只有 Esc）。
   * ⇒ 现在都走 `composables/useListHighlight.ts` 那一份，
   *   组件里只剩接线（items / onPick / elementOf）。
   */
  it("↑↓ 仍走高亮，Enter 直接切；提示文字删掉后键盘功能不跟着删", () => {
    const script = scriptSource(POPOVER);
    expect(script).toContain('from "../composables/useListHighlight"');
    expect(script).toContain("useListHighlight<string>({");
    expect(script).toContain("items: () => visibleNames.value");
    expect(script).not.toContain("moveHighlightIndex");
    expect(script).not.toContain("clampHighlightIndex");
    expect(script).toContain('highlight.move(event.key === "ArrowDown" ? 1 : -1)');
    expect(script).toContain('if (event.key === "Enter" && ownsEnter)');
    expect(script).toContain("highlight.pickActive()");
    expect(script).toContain("highlight.reveal()");
  });

  /** 2026-11-21 用户裁定：底部「选择 / 切换 / 关闭」提示整行撤掉。 */
  it("底部没有键位提示行，Esc、Enter 与上下键仍由脚本接管", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    expect(markup).not.toContain("model-select-keys");
    expect(markup).not.toContain("<kbd>");
    expect(script).toContain("popoverOwnsKey");
    expect(script).toContain("highlight.pickActive()");
    expect(script).toContain("highlight.move");
  });

  /**
   * 2026-11-20（参考图同款的结构）：「刷新模型列表」从头部图标钮搬到底部**文字行**——
   * 排障动作与脚注说明同区，主路径只剩名单。通道名仍只进悬停提示（下面那条旧闸管着）。
   * 头部图标钮的形状（.model-select-icon-btn）随之退役，CSS 里也删了，dead-css-guard 盯着。
   */
  it("刷新留在名单底部，头部不重复放刷新图标钮", () => {
    const markup = templateSource(POPOVER);
    expect(markup).toContain('class="model-select-refresh"');
    expect(markup).toContain("刷新模型列表");
    const refreshAt = markup.indexOf('class="model-select-refresh"');
    const listAt = markup.indexOf('class="model-select-list"');
    expect(refreshAt, "刷新行不在名单后面").toBeGreaterThan(listAt);
    expect(markup).not.toContain("model-select-icon-btn");
  });

  it("不再显示名单来源脚注", () => {
    const markup = templateSource(POPOVER);
    expect(markup).not.toContain('class="model-select-foot"');
    expect(markup).not.toContain("名单来自");
    expect(markup).not.toContain("改地址、换密钥");
  });

  /**
   * 写回中与切换失败的理由必须排在列表**上面**（2026-10-25 挪位）。
   *
   * 改之前它们排在脚注前头，名单一长就被推到滚动区下面——用户看不见就只剩「点了没反应」。
   * 这条钉的是**位置**（索引比较），不是「文案出现过」：文案在文件里出现过一次，
   * 挪到列表底下照样满足 `toContain`。
   */
  it("写回中与切换失败的理由排在列表上面（切不过去时那行红字必须在第一屏）", () => {
    const markup = templateSource(POPOVER);
    const switchingAt = markup.indexOf(`v-if="switching"`);
    const errorAt = markup.indexOf(`v-if="switchError"`);
    const listAt = markup.indexOf(`class="model-select-list"`);
    expect(switchingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(-1);
    expect(switchingAt, "写回中的理由被排到列表后面了").toBeLessThan(listAt);
    expect(errorAt, "切换失败的理由被排到列表后面了").toBeLessThan(listAt);
  });

  /**
   * 可见文字里不再有通道名与 baseURL（2026-10-25 去术语）。
   *
   * 脚注原来写的是「名单来自 provider:list-models（主进程按模型设置里的 baseURL 出网）」——
   * 通道名、主进程、baseURL 三个词摊在正文上，对写作者一个都不解释。
   * ⇒ 脚注只说「去哪儿改」；通道名挪进「刷新」那颗钮的**悬停提示**（那是排查用的），
   * 铁律「报不出通道名的控件不进 UI」照样有着落——它要求的是**控件**报得出，不是正文摊着。
   */
  it("通道名只留在刷新钮的悬停提示，不再额外写一段来源说明", () => {
    const markup = templateSource(POPOVER);
    expect(markup).not.toContain('class="model-select-foot"');
    expect(markup).not.toContain("baseURL");
    expect(markup).not.toContain("主进程");
    expect(markup).toContain('title="重新拉取模型名单（provider:list-models）"');
  });

  it("不再按搜索词或前 N 条截断名单，超高列表由 CSS 滚动承接", () => {
    const script = scriptSource(POPOVER);
    const markup = templateSource(POPOVER);
    expect(script).toContain("splitByCurrentModel(upstream.value");
    expect(script).not.toContain("MODEL_PICKER_LIST_LIMIT");
    expect(script).not.toContain(".slice(0,");
    expect(markup).not.toContain("只列了前");
    const list = ruleBlock(styleSource("interaction.css"), ".model-select-list");
    expect(list).toContain("overflow-y: auto");
    expect(list).toContain("min-height: 0");
  });

  it("搜索框删除后，组件里没有遗留的查询状态或子串过滤", () => {
    const script = scriptSource(POPOVER);
    expect(script).not.toContain("filterModels");
    expect(script).not.toContain("query.value");
    expect(script).not.toContain("toLowerCase().includes(");
  });
});

describe("CenterColumn · chip → 事件 → store → 弹层一条线", () => {
  it("模型 chip 的事件有真 handler，并且打开弹层的同时真的去拉名单", () => {
    const markup = templateSource(CENTER);
    const script = scriptSource(CENTER);
    expect(markup).toContain(`@open-model-select="openModelSelect"`);
    expect(script).toContain("function openModelSelect");
    expect(script).toContain("provider.loadModels()");
    expect(markup).toContain("<ModelSelect");
    expect(markup).toContain('@close="modelsOpen = false"');
  });

  /**
   * 改钉（2026-10-08 批次 5-㊺）：这一条原来是 `expect(script).toContain("provider.select(")`。
   *
   * 那条断言正是**让这个 bug 活下来的原因**：CenterColumn 当时写的是 `provider.select(name)`
   * （裸模型名当草稿发下去，主进程 zod 拒收、抛 "Invalid input"、错误被吞进只在设置页渲染的
   * `error` ⇒ 真机点名单任何一行都没反应）。而守卫只问「方法名在不在」，
   * **参数形状一个字没问**——`.vue` 又不进 tsc 类型程序，于是全绿。
   *
   * 现在钉的是更强的形状：组件**不许自己拼草稿**。它知道的只有「用户点了一行」，
   * 连哪条连接都不该知道（那是 store 从「启用中那条」取的，也正是这份名单的来路）。
   */
  it("选中与重试都走 useProviderStore，组件里不出现第二份 providerSave", () => {
    const script = scriptSource(CENTER);
    const markup = templateSource(CENTER);
    expect(script).toContain('from "../stores/useProviderStore"');
    // 重试带 true = 强制重拉：缓存是否有效只由 store 的 models 是否为 null 判定，组件不另判一次。
    expect(markup).toContain("provider.loadModels(true)");
    expect(script).not.toContain("providerSave");
    expect(markup).not.toContain("providerSave");
  });

  it("**形状**：选中走 store 的 switchModel（只收模型名），组件不碰 select、不自己拼草稿", () => {
    const script = scriptSource(CENTER);
    expect(script).toContain("provider.switchModel(name)");
    // 反向钉：组件一旦又去直接调 select，就是那份「自己拼 ProfileDraft」的旧形状回来了。
    expect(script).not.toContain("provider.select(");
    // 草稿两个字段的字面量也不许出现在组件里（拼草稿这件事只有 utils/model-switch.ts 干）。
    expect(script).not.toContain("connectionId:");
    expect(script).not.toContain("model: name");
  });

  it("切换失败的理由被转交给浮层并渲染出来：点了没反应的反面", () => {
    const markup = templateSource(CENTER);
    expect(markup).toContain(':switch-error="provider.switchError"');
    const popover = templateSource(POPOVER);
    expect(popover).toContain('v-if="switchError"');
    expect(popover).toContain("{{ switchError }}");
    // 理由复用拉名单失败那一档红字，不另起一套视觉。
    expect(popover).toContain('class="model-select-error"');
  });

  it("写回成功才关浮层：失败时浮层留着，用户在原地看得见理由", () => {
    const script = scriptSource(CENTER);
    expect(script).toContain("if (await provider.switchModel(name)) modelsOpen.value = false;");
  });

  it("视图挂载即读配置并预拉模型清单（2026-10-11）：chip 报得出名字，点开下拉读缓存秒开", () => {
    expect(scriptSource(CENTER)).toContain("void provider.warmModelCache()");
  });
});

describe("ComposerBox · 只是转发，不自行判定", () => {
  /**
   * 改钉（2026-10-07，第 ③ 条）：`open-model-select` 现在带一个 `anchor: HTMLElement` 载荷。
   *
   * 保证没变小——「只是转发、不自行判定」这条没松：载荷不是判定，只是那枚按钮的 DOM 元素，
   * 而元素只有持有它的组件拿得到（`composer-chips` 那张表只有 id / 文案 / 图标）。
   * 组件仍然不碰 store、不判「该不该开」，连 store 名都不出现在这个组件里。
   * 反向钉两条：组件不许自己去 DOM 里搜锚点（`querySelector`）——
   * 那会在 chip 改名/重排时静默指空，浮层飞到屏幕角落，而代码上完全看不出原因；
   * 也不许把载荷写成可选（`anchor?:`），那等于允许一个没有锚点的下拉存在。
   */
  it("open-model-select 带锚点元素，且组件不自行判定、也不自己去 DOM 里搜锚点", () => {
    const script = scriptSource(COMPOSER);
    expect(script).toContain('"open-model-select": [anchor: HTMLElement]');
    expect(script).toContain("modelLabel: string");
    expect(script).toContain("baseUrl: string");
    expect(script).toContain("modelLabel: props.modelLabel");
    expect(script).toContain("baseURL: props.baseUrl");

    // 锚点元素是渲染期才有的东西，只能从模板的 ref 收集器里拿。
    expect(script).toContain("const modelChip = ref<HTMLElement | null>(null);");
    expect(script).toContain("function setChipRef(id: ComposerChipId, el: unknown): void {");
    // 【必须逐枚 chip 数，不能整份 toContain】变异 #18 实测：把左端那枚的 ref 摘掉，
    // 右端权限 chip 上同样的那一行还在，整份模板 `toContain` 照样绿。
    // 两端都收同一个收集器是刻意的（chip 哪天换栏位锚点不该跟着断），
    // 所以这条断言钉的是**每一枚** `.composer-chip` 都挂着它，而不是「模板里出现过」。
    //
    // 【为什么不能直接用 tagAttributes 的 className 过滤】它的匹配是 `class="[^"]*\bcomposer-chip\b`，
    // 而 `\b` 在「composer-chip-」的连字符前**也算边界**，于是 `<AppIcon class="composer-chip-icon">`
    // 一起被收进来。变异轮次里这条断言一度恒红（3 ≠ 2），恒红会让每一条变异都显示成真红——
    // 结论整个反过来。所以这里按 `class` 的完整值筛，只认两枚按钮本身。
    const chips = tagAttributes(templateSource(COMPOSER), "composer-chip").filter((a) =>
      /(^|\s)class="composer-chip"/.test(a)
    );
    expect(chips.map((a) => a.slice(0, 60))).toHaveLength(2);
    for (const attrs of chips) {
      expect(attrs, "有一枚 composer-chip 没挂 setChipRef 收集器").toContain(
        `:ref="(el) => setChipRef(chip.id, el)"`
      );
    }

    // 反向钉：锚点不许靠搜 DOM 取得。
    expect(script).not.toContain("querySelector");
    expect(scriptSource(POPOVER)).not.toContain("querySelector");
    // 浮层的锚点只有一个来源：prop。
    expect(scriptSource(POPOVER)).toContain("anchor: HTMLElement;");
    expect(templateSource(CENTER)).toContain(`:anchor="modelAnchor"`);
    // 没有锚点就不渲染下拉（不是弹一个没位置的）。
    expect(templateSource(CENTER)).toContain(`v-if="modelsOpen && modelAnchor"`);
  });

  // 真机冒烟抓到的原罪：`:base-url` 被 Vue camelize 成 `baseUrl`，而 prop 当时声明为 `baseURL`
  // ⇒ 组件收到 undefined，chip 的 title 拼出 `undefined/models`。源码契约只看字符串，两边都绿。
  // 这一条把「绑定名 camelize 之后必须等于声明名」钉住：改任何一边都必须同时改另一边。
  it("kebab 绑定 `:base-url` 的 camelize 结果必须就是声明的 prop 名", () => {
    const binding = /<ComposerBox[\s\S]*?\/>/.exec(templateSource(CENTER))?.[0] ?? "";
    const camelize = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const bound = [...binding.matchAll(/:([a-z][a-z0-9]*(?:-[a-z0-9]+)+)=/g)]
      .map((m) => m[1])
      .filter((k): k is string => k !== undefined && !k.startsWith("v-"));
    expect(bound.length).toBeGreaterThan(0);
    const declared = scriptSource(COMPOSER);
    for (const key of bound) {
      expect(declared).toContain(`${camelize(key)}:`);
    }
  });
});

describe("ProviderSettings · 视图唯一真身是 useProviderStore", () => {
  it("不再自己持有一份 ProviderView：否则浮层保存后 chip 还读旧值（同一个数两份口径）", () => {
    const script = scriptSource(SETTINGS);
    expect(script).toContain('from "../stores/useProviderStore"');
    expect(script).not.toContain("ref<ProviderView | null>");
    expect(script).not.toContain("window.mochen.providerView");
    expect(script).not.toContain("window.mochen.providerSave");
    expect(script).not.toContain("presentableProviderError");
  });

  it("弹层全文不出现硬编码颜色：样式一律走 interaction.css 的 token", () => {
    for (const path of [POPOVER, CENTER, SETTINGS]) {
      expect(vueSource(path)).not.toMatch(/(color|background|border)\s*:\s*#[0-9a-fA-F]/);
    }
  });
});

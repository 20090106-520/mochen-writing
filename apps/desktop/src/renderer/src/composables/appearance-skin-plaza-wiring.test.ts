/**
 * 皮肤广场与外观页的**接线守卫**（2026-10-08 批次 5-㊷ 从 appearance-skins.test.ts 拆出）。
 *
 * 【为什么要拆】
 * 5-㊷ 往皮肤守卫里加了「底版表」「筛选档派生」「面板兜底」三组钉，
 * 原文件冲到 1036 行，越过了本仓的源码行数预算（800）。
 * 拆点不是按行数硬切的，是按**钉的对象**切的：
 *   · 留在原文件的是**表与投影**——纯 TS，能被类型检查，读的是数据本身；
 *   · 这一份是**页面与样式表**——`.vue` 在本仓零类型检查（verify 用裸 tsc，
 *     vue-shim 把 `*.vue` 当 any），于是「这一页到底接没接上」只能钉成读源码断言，
 *     判据长得跟数据守卫完全不一样。
 *
 * 【原来那段注释头为什么换了话】
 * 搬过来这一组的旧标题写的是「运行时 · 四层换算成 `--skin-*`」，
 * 那是 5-㊵ 拆分时留下的错位——下面钉的其实是广场页的 CSS 与 .vue 接线，
 * 四层的**数值**守卫在 appearance-skin-visual.test.ts。标题顺着内容改回来了。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  styleSource,
  strippedStyleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/* ─────────────────────────────────────────────────────────────────────────
   皮肤广场页与外观页 · 接线

   【这一组为什么只能读源码】
   `.vue` 与 `.css` 在 verify 里不过类型关卡，于是「按钮接的是哪个函数」「这一页
   在不在 DOM 里」「那条 grid-row 有没有落」只能钉成源码断言。
   每条都写清了它防的是**哪一次真机撞到的坑**——不是为钉而钉。
 */
describe("皮肤广场页 · 接线（.vue 零类型检查，只能读源码）", () => {
  const PAGE = "components/SkinGalleryPage.vue";
  const NAV = "components/ExtensionsNavRow.vue";

  it("占中栏 + 右栏一整个页面：grid-column 2 / -1，跳过左栏那一列", () => {
    const css = styleSource("skin-gallery.css");
    const block = ruleBlock(css, ".skin-gallery");
    expect(block).toContain("grid-column: 2 / -1");
    // 同 extensions.css 那条教训：grid item 不给 min-width: 0 就不肯缩，
    // 而皮肤卡上的出处那行偏长（"改编自 ymh0000123/dsh-theme-endfield 的 纸墨色板与玻璃网格"）。
    expect(block).toContain("min-width: 0");
  });

  /* 2026-10-07 批次 5-㊴ 真机撞出来的真缺陷，先于本批就存在（extensions.css 一处）。

     `.desktop-shell` 是三列网格，而那两页只写了 `grid-column: 2 / -1`、没写 `grid-row`，
     网格于是把它们排到**第二行** ⇒ shell 从「一行三列」变成「两行三列」：
     左栏只占第一行第一格（真机量到 302px 高，视口 901px），
     `.editor-pane` 被挤到第三行。

     后果是**左栏后半截点不到**（`.left-sidebar` 是 overflow:hidden + 内部滚动）：
     y=392 往下的六枚钮全部落在可视区外，`elementFromPoint` 量到的是 `.desktop-shell`。

     没人早发现的缘故：真机流程几乎只点技能库、点进去就回来，
     从没在**那一页上**去量左栏的高度。 */
  it("三栏五处都显式钉 grid-row: 1（漏一处 shell 就从一行三列塌成两行）", () => {
    // 五处 = 左栏 / 中栏 / 右栏 / 插件技能页 / 皮肤广场。**每一处都要钉**：
    // 补齐 extensions 与 skin-gallery 之后，shell 塌成两行、但症状换了个样子 ——
    // `.conversation-pane` 与 `.editor-pane` 掉到第二行，于是「点左栏那枚钮进去」
    // 时中栏根本不在视口里（真机量到 y=459，视口 902），
    // 而 `.left-sidebar` 被压到 459px、y=428 往下的五枚钮落在 overflow 之外。
    // ⇒ 现象与根因分处两地，从症状根本看不出是哪一处漏了。
    const pinned: Array<[string, string]> = [
      ["left-nav.css", ".left-sidebar"],
      ["conversation-pane.css", ".conversation-pane"],
      ["editor-pane.css", ".editor-pane"],
      ["extensions.css", ".extensions-page"],
      ["skin-gallery.css", ".skin-gallery"]
    ];
    for (const [file, selector] of pinned) {
      const block = ruleBlock(styleSource(file), selector);
      expect(block, `${file} 的 ${selector} 没有钉住行`).toContain("grid-row: 1");
      // 反向断言**不能**写「不许有 grid-template-rows」：左栏与中栏/右栏各有自己的
      // 内部行划分（品牌行 / 滚动区 / 底部三行），那是它们**自己**的排版，与 shell 那一行无关。
      // 早先写成那样会立刻红，而红的原因是断言看错了对象（这已是本轮第三次「判据落错块」）。
      // 这里改成真正要禁的那件事：**不许出现会把自己放到多行的写法**。
      expect(block).not.toMatch(/grid-row:\s*1\s*\/\s*2|grid-row:\s*auto/);
    }
  });

  it("左栏那一枚「皮肤广场」与工作台争同一格高亮，四枚互斥", () => {
    const nav = templateSource(NAV);
    // 四枚都在这一个组件里，是因为它们与「工作台」共用一条 active 绑定链。
    for (const id of ["skills", "plugins", "skins"]) {
      expect(nav).toContain(`data-nav-id="${id}"`);
    }
    expect(nav).toContain(`layout.centerView === 'skins'`);
    expect(nav).toContain(`layout.showCenter('skins')`);
    // 「工作台」那一枚判的是 centerView === 'chat'，天然与 skins 互斥——
    // 这一条钉住它不许被改成「非空即亮」。
    expect(templateSource("components/LeftSidebar.vue")).toContain(
      "layout.currentView === 'workspace' && layout.centerView === 'chat'"
    );
  });

  it("App.vue：右栏与它的拖拽条仍只在对话那条路上（皮肤广场不配分栏）", () => {
    const app = templateSource("App.vue");
    /* 5-㊵ 改钉：`v-else` → `v-else-if="centerView === 'skins'"`。
       原写法在 `ExtensionsPage` 那条条件是 `centerView !== 'skins'` 时，
       等于「对话那条路上皮肤广场也在」——同样是把这一页渲染在不该它的地方。
       三个页面现在各自指名，互斥由构造保证。 */
    expect(app).toContain(`<SkinGalleryPage v-else-if="centerView === 'skins'" />`);
    expect(app).toContain(
      `<ExtensionsPage v-else-if="centerView === 'skills' || centerView === 'plugins'" />`
    );
    expect(app).toContain(`<DocumentPane\n        v-if="!rightCollapsed && centerView === 'chat'"`);
    expect(app).toMatch(
      /v-if="!rightCollapsed && centerView === 'chat'"\s*\n\s*class="pane-resizer pane-resizer-right"/
    );
    // 皮肤广场换的是中栏那一格，CenterColumn 仍只在中栏是 chat 时在。
    expect(app).toContain(`<CenterColumn\n        v-if="centerView === 'chat'"`);
  });

  /**
   * 5-㊵ 真机撞出来的**真缺陷**，也是「插件里的东西卡到工作台里了」那句反馈的根因。
   *
   * 【症状】用户说工作台里出现了插件的东西。
   * 【实测】工作台上 `.extensions-page` 与 `.conversation-pane` **完整重叠 664×902**
   *   ——两者都占 `grid-column: 2` + `grid-row: 1` 那一格。
   * 【为什么画面上看不出来】对话那格写在 ExtensionsPage 之后、盖在它上面，
   *   所以它「看不见但一直在」：网格与滚动容器占着位置、监听器照跑、还吃点击。
   * 【根因】`App.vue` 那行 `v-if="centerView !== 'skins'"` ——排除法写反了。
   *
   * ⇒ 钉「对话那条路上 ExtensionsPage 与 SkinGalleryPage 都不在 DOM 里」。
   *   只钉 `toContain` 是不够的：改回 `!== 'skins'` 时上面那条 `toContain` 会红，
   *   但那红的是「字符串不见了」；这一条钉的是**后果**（那一页真的不在）。
   */
  it("对话那条路上插件页与皮肤广场都不在 DOM 里（排除法写反过一次）", () => {
    const app = templateSource("App.vue");
    // 正向：三页各自指名，且互斥。
    expect(app).toContain(`v-if="centerView === 'chat'"`);
    expect(app).toContain(`v-else-if="centerView === 'skills' || centerView === 'plugins'"`);
    expect(app).toContain(`v-else-if="centerView === 'skins'"`);
    // 反向：任何「排除 skins 之外」式的写法都不许回来。
    expect(app, "centerView !== 'skins' 会让插件页在对话那条路上也渲染").not.toContain(
      `centerView !== 'skins'`
    );
  });

  /* 5-㊵ 改钉：旧守卫钉的是「texture/radius/outline/glow 四层一起写回」，
     新四层是 backdrop/glass/surface/grid —— 名字换了，**要写回的东西没变**，
     所以这条断言只换那四个名字，不换它的判据。

     5-㊷ 再改一次：那段拼法整块搬进了 `patchSettingsWithSkin`（因为「整窗预览」
     成了它的第二个调用方）。守卫跟着挪到那份函数上，并加一条**反向**断言——
     页面里再拼一遍就是两份真相，而这两份漂移的结局是「预览看到的 ≠ 换上得到的」。 */
  it("换上 = 调那一份共用拼法，页面里不许再出现第二份拼法", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain('from "../composables/appearanceSkinPreview"');
    expect(script).toContain(
      "void appearance.update(patchSettingsWithSkin(appearance.settings, skin))"
    );
    // 反向：这些字段名是那份函数**内部**的事，页面里出现就是又拼了一遍。
    for (const fragment of ["preset: skin.id,", "skin: skin.id,", "...skin.light,", "...visual"]) {
      expect(script, `页面里又出现了 ${fragment} —— 拼法该只有一份`).not.toContain(fragment);
    }
    // 面板不许直调 window.mochen（AppearancePanel 那条老规矩）。
    expect(script).not.toContain("window.mochen");
    // 换上之后预览必须退场：屏幕上留着两套「同一个来源」，收条那句「还没保存」立刻成假话。
    // 窗口取 260 字符：applySkin 的函数体连同那句注释在内，超出这个范围就说明它不在这个函数里。
    expect(script).toMatch(/function applySkin[\s\S]{0,260}?browse\.clearPreview\(\)/);
  });

  it("拼法那份函数真的浅深两套一起写、五层一起写（守卫跟着搬到这里）", () => {
    const src = typeScriptSource("composables/appearanceSkinPreview.ts");
    expect(src).toContain("light: { ...settings.light,");
    expect(src).toContain("dark: { ...settings.dark,");
    for (const layer of ["backdrop", "glass", "surface", "grid", "art"]) {
      expect(src, `拼法没写 ${layer}`).toMatch(new RegExp(`${layer}: skin\\.${layer}`));
    }
    // 五层必须是**同一个 visual 对象**展开两次，而不是各写两遍。
    expect(src.match(/\.\.\.visual/g)?.length).toBe(2);
  });

  /* 5-㊷ 波3 的第一条：预览的全部意义在于**它不是换上**。
     一旦预览也落盘，「退出预览就原样回来」那句收条文案就成了假话，
     而且用户在广场上逛一圈，设置已经被改了七八次。 */
  it("预览一个字节都不落盘：appearance.update 在页面上只有一处，且在 applySkin 里", () => {
    const script = scriptSource(PAGE);
    expect(script.match(/appearance\.update\(/g)?.length).toBe(1);
    const at = script.indexOf("appearance.update(");
    const head = script.lastIndexOf("function ", at);
    expect(script.slice(head, head + 24), "唯一那次 update 不在 applySkin 里").toContain(
      "function applySkin"
    );
    // 预览那条路只写记号与清记号，不碰设置。
    expect(script).toContain("browse.togglePreview(skin.id)");
  });

  it("预览中一定有收条，且收条说清「还没保存」、两个出口都在条上", () => {
    const markup = templateSource(PAGE);
    expect(markup).toContain('v-if="browse.previewSkin"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("还没保存");
    expect(markup).toContain("browse.clearPreview()");
    expect(markup).toContain("applySkin(browse.previewSkin)");
  });

  it("离开广场把浮层收干净（预览不落盘，留着就成了屏幕一套、设置一套）", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain("onBeforeUnmount(");
    expect(script).toContain("browse.leaveGallery()");
    // 「回到对话」那枚钮走的是 layout 真身，不自己改 centerView。
    expect(script).toContain("layout.showWorkspace()");
  });

  it("对比的开合判定只在 store 有一份：模板读 isComparing，不自己数长度", () => {
    const markup = templateSource(PAGE);
    const script = scriptSource(PAGE);
    expect(markup).toContain('v-if="browse.isComparing"');
    expect(markup).not.toMatch(/compareIds\.length/);
    expect(markup).toContain('v-for="skin in browse.compareSkins"');
    // 「勾进/移出」走的是页面上那层薄封装（它只把 id 递过去），判定仍在 store。
    expect(markup).toContain('@click="toggleCompare(skin)"');
    expect(script).toContain("browse.toggleCompare(skin.id)");
    expect(markup).toContain("browse.clearCompare()");
    // 反向：页面不许自己算「够不够两套」——那份判据在 store 的 isComparing 上只有一份。
    expect(script).not.toMatch(/compareIds\.length\s*[<>]/);
  });
  /* 5-㊷ 波3：并排对比里那两块是**一整扇窗**的模型。
     它们必须消费与真正应用时同一批 `--skin-*`，否则这块就是张示意图——
     而「卡片预览只画两条色带、看不出两套皮肤的差别」正是 5-㊵ 被用户指出来过的缺陷。
     这一段仍钉在同一个 describe 里：被测的还是这一页与这一张样式表，
     换个 describe 只是换个标题，判据的对象没有变。 */
  const CSS = "skin-gallery.css";

  it("五层各自的类都在模板里，且叠放顺序是 backdrop → art → grid（画必须在弥散光之上）", () => {
    const markup = templateSource(PAGE);
    const order = ["backdrop", "art", "grid"];
    let previous = -1;
    for (const layer of order) {
      const at = markup.indexOf(`skin-window-${layer}"`);
      expect(at, `模板里没有 .skin-window-${layer}`).toBeGreaterThan(-1);
      // DOM 里谁写在后面谁画在上面（三块都是绝对定位），所以顺序就是叠放顺序。
      // 反过来不会报错，只会得到「整窗一片浅色而 DOM 六层俱全」——5-㊷ 真机撞过的那次。
      expect(at, `${layer} 排在了不该压上去的位置`).toBeGreaterThan(previous);
      previous = at;
    }
  });

  it("每一层消费真 token，且与 theme-runtime.css 那边是同一批名字", () => {
    const css = strippedStyleSource(CSS);
    expect(ruleBlock(css, ".skin-window-backdrop")).toContain("var(--skin-backdrop)");
    const art = ruleBlock(css, ".skin-window-art");
    expect(art).toContain("var(--skin-art-image");
    expect(art).toContain("--skin-art-veil");
    const grid = ruleBlock(css, ".skin-window-grid");
    expect(grid).toContain("background-image: var(--skin-grid-image");
    expect(grid).toContain("background-blend-mode: var(--skin-grid-blend");
    const nav = ruleBlock(css, ".skin-window-nav");
    expect(nav).toContain("background-color: var(--skin-glass-sidebar-fill)");
    expect(nav).toContain("backdrop-filter: blur(var(--skin-glass-sidebar-blur");
    const side = ruleBlock(css, ".skin-window-side");
    expect(side).toContain("background-color: var(--skin-glass-card-fill)");
    expect(side).toContain("backdrop-filter: blur(var(--skin-glass-blur");
    // 圆角一律走 token：写死像素就是「换皮肤只变一半」那个老形状。
    expect(ruleBlock(css, ".skin-window")).toContain("border-radius: var(--skin-radius-sm)");
    expect(side).toContain("border-radius: var(--skin-radius-md)");
  });

  it("三块面板都 position: relative——不写就被绝对定位的叠层压在下面（看不见但不报错）", () => {
    const css = strippedStyleSource(CSS);
    // 选择器组包在 `:where(…)` 里（理由写在 skin-gallery.css 那边）：
    // needle 写成裸组的话，规则一改格式这里就会红在一个「其实写了」的地方。
    const panels = ruleBlock(css, ":where(.skin-window-nav, .skin-window-main, .skin-window-side)");
    expect(panels).toContain("position: relative");
  });

  it("中栏那块「带画才放行」与真规则同值同判据（52%），且读的是模型自己的 data-skin-art", () => {
    const css = strippedStyleSource(CSS);
    const rule = [
      ...css.matchAll(
        /\.skin-window\[data-skin-art\]:not\(\[data-skin-art="none"\]\)[^{]*\{[^}]*\}/g
      )
    ].map((one) => one[0]);
    expect(rule.length, "找不到整窗模型那条放行规则").toBeGreaterThan(0);
    expect(rule.join("\n")).toContain("52%");
    // 出处：theme-runtime.css 里那条真规则也是 52%，两处必须一起改。
    // 字面量收在 `RELEASE_BODY` 一份（下面那条「三张整页在放行名单里」的判据也认它）：
    // 两处各写一句的话，改档位时会红一个漏一个。
    const real = strippedStyleSource("theme-runtime.css");
    expect(real).toContain(RELEASE_BODY);

    // 模板那一格把这一套自己的 art 档写在模型上，而不是读 `<html>` 上那份当前的。
    expect(templateSource(PAGE)).toContain(':data-skin-art="skin.art"');
  });

  it("模型里那两块底色读预览自己的纸色，不覆写全局 --surface-main", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain('"--window-paper": tone.background');
    expect(script).toContain('"--window-ink": tone.foreground');
    // 反向：覆写一个全局 token 会把这一格里的别的消费（图标、边框）一起带跑。
    expect(script).not.toContain('"--surface-main"');
    expect(strippedStyleSource(CSS)).toMatch(/var\(--window-paper/);
  });

  it("收条挂在页面这一格（absolute + 页面是包含块），不挂视口", () => {
    const css = strippedStyleSource(CSS);
    expect(ruleBlock(css, ".skin-preview-bar")).toContain("position: absolute");
    expect(ruleBlock(css, ".skin-gallery")).toContain("position: relative");
    // 预览中给滚动体补出收条的高度，否则「换回去」压在卡片的「换上」上。
    expect(css).toContain(".skin-gallery:has(.skin-preview-bar) .skin-gallery-body");
  });

  /**
   * 【这一族为什么值得单钉】`--skin-*` 的作者只能有一个（App.vue 的 applyTheme）。
   * 预览一开始是在皮肤页里自己刷一遍 `<html>` 的写法：改字号、切深浅、系统换模式——
   * 任何一次 applyTheme 都会把预览刷掉，用户在预览里看到的自己变回去，而设置里从没写过那一套。
   * ⇒ 预览改成 applyTheme 的一个**输入**；这里钉的就是「输入那条路在，第二条路不在」。
   */
  it("预览的唯一作者是 App.vue 的 applyTheme，且它读 effectiveSettings", () => {
    const app = scriptSource("App.vue");
    expect(app).toContain(
      "const view = effectiveSettings(settings.value, skinBrowse.previewSkin);"
    );
    // 刷的是 view 的浅深两版与字体（不是 settings.value——那等于预览没生效）。
    expect(app).toMatch(/theme:\s*view\[scheme\]/);
    expect(app).toContain("uiFontFamily: view.uiFontFamily");
    // 预览记号一变就重刷；这条 watch 与那条深比较 watch 是两个输入，作者仍是同一个。
    expect(app).toMatch(/watch\(\s*\(\)\s*=>\s*skinBrowse\.previewId,\s*applyTheme/);
    expect(app).toContain("unwatchPreview?.()");
    // 反向：页面那边不许另开一条写 DOM 的路（两个作者写同一批 token）。
    // 注意不能钉 `document.documentElement`——页面读它取当前明暗是**合法**的（`prefersDark` 那一句），
    // 禁的是写：setProperty 与那条文档级刷写函数才是第二个作者。
    const page = scriptSource(PAGE);
    expect(page).not.toContain("setProperty(");
    expect(page).not.toContain("applyAppearanceThemeToDocument");
  });

  it("筛选与搜索的判定在 store 里，模板只 v-for", () => {
    const script = scriptSource(PAGE);
    const markup = templateSource(PAGE);
    expect(script).toContain("browse.visibleSkins(appearanceSkins)");
    // setFilter / submitSearch 是在**模板**里绑的（事件处理器），不在 script ——
    // 判据必须落在真正被测的那一块上，写成查 script 会量到一个本来就不该有它的地方。
    expect(markup).toContain("browse.setFilter(row.key, value)");
    expect(markup).toContain("browse.submitSearch()");
    // 模板里不许出现自己 filter / 自己的 include —— 那会与 store 各判一次。
    expect(markup).not.toMatch(/\.filter\(/);
    expect(markup).not.toMatch(/@click="[^"]*\.includes\(/);
    expect(markup).toContain('v-for="skin in skins"');
    expect(markup).toContain('v-for="value in row.values"');
  });

  it("空态与出处：出处不许被截，出处那行不许带许可以外的东西", () => {
    const css = strippedStyleSource("skin-gallery.css");
    const block = ruleBlock(css, ".skin-card-origin");
    // 同一块里出现 origin + license 两个字段，所以不许有截断。
    expect(block).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(block).not.toMatch(/line-clamp/);
    expect(templateSource(PAGE)).toContain("{{ skin.origin }} · {{ skin.license }}");
    expect(templateSource(PAGE)).toContain("没有匹配的皮肤");
  });

  /* 5-㊵ 新增：卡片预览必须是**真机渲染那一层效果**，不是画个示意图。
     5-㊴ 那一版预览只画了两条色带，用户看不出任何差别 ——
     而卡片存在的意义恰恰是「一眼看出两套皮肤的差别」。 */
  it("卡片预览真机渲染背景/图案/玻璃三层（不是只画两条色带）", () => {
    const markup = templateSource(PAGE);
    for (const cls of [
      "skin-card-preview-backdrop",
      "skin-card-preview-grid",
      "skin-card-preview-panel"
    ]) {
      expect(markup, `预览块里没有 ${cls}`).toContain(cls);
    }
    const css = styleSource("skin-gallery.css");
    // 三块必须各自消费与真正应用时**相同**的那些 token，否则卡片与实机对不上。
    expect(ruleBlock(css, ".skin-card-preview-backdrop")).toContain("var(--skin-backdrop)");
    expect(ruleBlock(css, ".skin-card-preview-grid")).toContain("var(--skin-grid-image)");
    const panel = ruleBlock(css, ".skin-card-preview-panel");
    expect(panel).toContain("var(--skin-glass-sheen)");
    expect(panel).toContain("backdrop-filter: blur(var(--skin-glass-capsule-blur))");
    expect(panel).toContain("var(--skin-radius-md)");
  });

  /* 预览的底色必须由模板内联：卡片上摆的是**别的那套**皮肤的颜色，
     而 `:root` 上那份是「当前生效的」那套 —— 不内联的话所有卡片都长成当前这套。 */
  it("预览的底色与字色由模板内联（不靠 :root 那份当前生效的）", () => {
    const script = scriptSource(PAGE);
    expect(script).toContain("function previewTone");
    expect(script).toContain("background: tone.background");
    expect(script).toContain("color: tone.foreground");
    expect(templateSource(PAGE)).toContain(':style="previewTone(skin)"');
  });

  it("previewStyle 必须把 accent / ink / paper / scheme 都传齐（漏一个就色值算成 NaN）", () => {
    const script = scriptSource(PAGE);
    // 这四个是 5-㊵ 扩出来的吃色相的量：玻璃的角落光要 accent，
    // 图案与对话框底要 ink/paper，而深浅两版取的是不同的值。
    for (const key of ["accent: tone.accent", "ink: tone.foreground", "paper: tone.background"]) {
      expect(script, `previewStyle 漏传 ${key}`).toContain(key);
    }
    expect(script).toMatch(/scheme:\s*prefersDark\.value\s*\?\s*"dark"\s*:\s*"light"/);
  });
});

/** 放行那条规则的**正文标记**：认到这一句才算找到那条规则（改档位要连这里一起改）。 */
const RELEASE_BODY = "color-mix(in srgb, var(--surface-main) 52%, transparent)";

/**
 * 那条「带画才放行」规则的**选择器串**（整组，不是某一条）。
 *
 * 【为什么单列一个函数】
 * 放行是一组并列选择器，写成一条 `toContain(".conversation-pane")` 只钉得住「这行字在文件里
 * 出现过一次」——注释里提一句同样的话就能把它喂饱。这里按「选择器里含 `data-skin-art`
 * 且正文里含那枚 52% 的 `color-mix`」把整组捞出来，断言只在这组**内部**成立。
 * 找不到那一组一律抛错：返回空串会让组内每条 `toContain` 一起变绿，看不出缺的是哪条规则
 * （与 `ruleBlock` 同一句理由）。
 */
function releasedSelectors(css: string): string {
  const groups: string[] = [];
  for (const one of css.matchAll(/([^{}]*html\[data-skin-art\][^{}]*)\{([^}]*)\}/g)) {
    const sel = one[1];
    const body = one[2];
    // `noUncheckedIndexedAccess` 下这两枚都带 `| undefined`。不显式判空而用 `?? ""` 兜底，
    // 会把「正则没抓到组」伪装成「抓到了但组是空的」——那时下面那条抛错就不会响。
    if (sel !== undefined && body !== undefined && body.includes(RELEASE_BODY)) {
      groups.push(sel);
    }
  }
  if (groups.length === 0) {
    throw new Error("theme-runtime.css 里找不到那条「带画才放行」（52% color-mix）的规则");
  }
  return groups.join(" ");
}

describe("视觉四层的消费 · 硬约束：背景与图案不落正文区", () => {
  /* 这一条是产品硬要求，不是审美：编辑器正文（.document-editor）与消息正文
     （.message-markdown）的背景**必须仍是纯 --surface-\***。背景一动，字的边缘就在抖，
     而这是长时间写作时实打实的疲劳源 —— 比「皮肤好不好看」重要。
     5-㊵ 把它从「纹理」扩成「背景 + 图案」两样：上游那套弥散光比纹理显眼得多，
     落在正文上的代价比 5-㊴ 那档高得多，所以这条守卫的判据也要跟着扩。 */
  it("theme-runtime.css 里 .document-editor 与 .message-markdown 都不带背景层与图案", () => {
    // **必须用 strippedStyleSource，不能用 styleSource**（5-㊵ 撞出来的）：
    // theme-runtime.css 那段说明的注释里就写着「编辑器正文（.document-editor）与
    // 消息正文（.message-markdown）」，而下面那条 `[^{}]*\.document-editor[^{}]*\{[^}]*\}`
    // 会从**注释里**那个词开始，一路吃到下一条真规则上——
    // 于是断言量到的是 `.desktop-shell` 那条规则，红得莫名其妙，
    // 而真被测的正文规则根本没进这次匹配。
    // `strippedStyleSource` 剥掉块注释，匹配才落在真规则上。
    const css = strippedStyleSource("theme-runtime.css");
    for (const selector of [".document-editor", ".message-markdown"]) {
      // 取该选择器所在的那条规则（不取整个文件——那会匹配到别的块）。
      const blocks = [...css.matchAll(new RegExp(`[^{}]*${selector}[^{}]*\\{[^}]*\\}`, "g"))].map(
        (one) => one[0]
      );
      expect(blocks.length, `theme-runtime.css 里找不到含 ${selector} 的规则`).toBeGreaterThan(0);
      for (const block of blocks) {
        // 它可以被改色（那是主题该管的），但不许出现背景层或图案。
        expect(block, `${selector} 上出现了背景层或图案 —— 正文区不许有背景纹`).not.toMatch(
          /--skin-backdrop|--skin-grid|repeating-linear-gradient/
        );
      }
    }
  });

  it("三张整页都在放行名单里 —— 页面这层不放行，整窗画就被自家面板盖死", () => {
    /* 2026-10-08 波3 真机量出来的：站在皮肤广场这一页做「整窗预览」，`.skin-gallery` 的
       计算底色是 `rgb(232, 246, 250)`、alpha **1**、`background-image: none`，
       而它占 1154×902、shell 只有 1440×902 —— 那一整幅画只剩左栏（alpha 0.3）
       和一条约 286px 的边能露出来。
       这与 5-㊵ 修掉的「画了等于没画」是同一族坑：DOM 上背景层六层俱全、控制台零报错，
       只有肉眼知道少了东西；而这次盖住画的正是**预览皮肤的那一页**自己。
       `.extensions-page`、`.settings-page` 与它同构（都是 `grid-column: 2 / -1; grid-row: 1`
       的整页，见 skin-gallery.css:7 / extensions.css:39 / settings-page.css:28 各自的
       `background: var(--surface-main)`），所以三张一起进名单，不留「这页放行那页不放行」的
       第二套规矩。
       可读性不比正文那一档差：页面放行 52% 之后，卡面还压着 `--surface-raised` 40%，
       合成实底 ≈ 0.4 + 0.6×0.52 ≈ 71%，比正文区单独那 52% 更厚。 */
    const group = releasedSelectors(strippedStyleSource("theme-runtime.css"));
    for (const page of [".skin-gallery", ".extensions-page", ".settings-page"]) {
      expect(group, `整页 ${page} 不在放行名单里 —— 画会被这一页盖成一整块实底`).toContain(page);
    }
    // 反向：正文区不许顺手加进这一组（它有上面那条独立守卫，这里只钉「别在同一张单子上」）。
    expect(group).not.toMatch(/\.document-editor|\.message-markdown/);
  });

  it("背景层与图案只挂在 .desktop-shell 那一层（容器，不是内容）", () => {
    const css = styleSource("theme-runtime.css");
    const shell = ruleBlock(css, `html[data-theme] .desktop-shell`);
    expect(shell, "背景层没挂在 shell 上").toContain("var(--skin-backdrop");
    // 图案挂在 shell 的 ::before 上（绝对定位、pointer-events: none）——
    // 写成 shell 的 background-image 会与背景层互相覆盖（同一条属性只能有一个值）。
    expect(css).toContain("html[data-theme] .desktop-shell::before");
    expect(css).toContain("var(--skin-grid-image");
    expect(ruleBlock(css, "html[data-theme] .desktop-shell::before")).toContain(
      "background-image: var(--skin-grid-image"
    );
  });

  it("玻璃挂在侧栏与卡面上，两块底色都走运行时算好的完整 rgba()", () => {
    const css = styleSource("theme-runtime.css");
    expect(ruleBlock(css, "html[data-theme] .left-sidebar")).toContain(
      "background-color: var(--skin-glass-sidebar-fill)"
    );
    expect(ruleBlock(css, "html[data-theme] .left-sidebar")).toContain(
      "backdrop-filter: blur(var(--skin-glass-sidebar-blur"
    );
    // 卡片那块用 :where(...) 合并写，所以判据落在那个完整选择器上。
    const cards = ruleBlock(
      css,
      "html[data-theme] :where(.extension-card, .skin-card, .proposal-card, .settings-card)"
    );
    expect(cards).toContain("background-color: var(--skin-glass-card-fill)");
    expect(cards).toContain("border-radius: var(--skin-radius-md)");
  });

  it("卡面圆角走 --skin-* token，不写死像素（写死 = 换皮肤只变一半）", () => {
    const skinCss = strippedStyleSource("skin-gallery.css");
    expect(ruleBlock(skinCss, ".skin-card")).toContain("border-radius: var(--skin-radius-md)");
    expect(ruleBlock(skinCss, ".skin-card-preview")).toContain(
      "border-radius: var(--skin-radius-sm)"
    );
  });

  it("对话框那套靠 <html data-skin-surface> 挂着（只有它给出真值，其余是 none）", () => {
    const css = styleSource("theme-runtime.css");
    // 判据要钉在**真的那条规则**上：条件是 data 属性，
    // 写成 `:where(.proposal-card)` 会匹配到不带那个 data 的规则，量错块。
    const dialogue = [
      ...css.matchAll(/html\[data-theme\]\[data-skin-surface="dialogue"\][^{]*\{[^}]*\}/g)
    ].map((one) => one[0]);
    expect(dialogue.length, "找不到 data-skin-surface 那条规则").toBeGreaterThan(0);
    expect(dialogue.join("\n")).toContain("var(--skin-dialogue-gradient");
    expect(dialogue.join("\n")).toContain("var(--skin-dialogue-underline");
  });

  /**
   * 5-㊵ 真机撞出来的**真缺陷**，它不属于任何一条「值对不对」，所以上面那些守卫都测不到。
   *
   * 【发生了什么】
   * 皮肤给侧栏配了 20px 的模糊（token 上确实写对了），
   * 而真机量到 DOM 上是 `blur(22px) saturate(1.25)` —— 那是一条**早就存在**的
   * `html[data-translucent-sidebar="true"] .left-sidebar` 里的写死值。
   *
   * 【为什么它永远赢】
   * 两条选择器**同特异性**：
   *   `html[data-theme] .left-sidebar`                   → 2 个 class 级 + 1 个类型级
   *   `html[data-translucent-sidebar="true"] .left-sidebar` → 2 个 class 级 + 1 个类型级
   * 同分时**写在后面的赢**，而那条老的写在后面。
   * 于是「用户拧半透明开关」与「皮肤配玻璃」**两个真身抢同一个属性**，
   * 用户拧开关有一处不跟。
   *
   * 【修法不是加 `!important`，是删掉一个真身】
   * 把开关折进运行时的 `--skin-glass-sidebar-blur`（关掉时给 0），CSS 那边不再判。
   * 这条守卫钉住「那条老规则不许回来」——它回来就是上面那个症状复发。
   */
  it("侧栏的模糊只有一个真身：那条老的 data 属性规则不许回来", () => {
    const css = strippedStyleSource("theme-runtime.css");
    const rules = [...css.matchAll(/html\[data-translucent-sidebar[^{]*\{[^}]*\}/g)].map(
      (one) => one[0]
    );
    for (const rule of rules) {
      // `.settings-sidebar` 那一条不换皮肤、不归这条管（它在 settings-page.css）；
      // 这里禁的是**给 `.left-sidebar` 再判一次模糊**。
      expect(
        rule,
        "侧栏的模糊又被 data 属性判了一次 —— 它与皮肤那条同特异性且写在后面，永远赢"
      ).not.toMatch(/backdrop-filter/);
    }
  });
});

describe("AppearancePanel · 配色网格退役，只剩只读的当前皮肤与一枚入口", () => {
  const PANEL = "components/AppearancePanel.vue";

  it("不再有任何预设网格与 applyPreset（那是第二份可改的真相）", () => {
    const script = scriptSource(PANEL);
    const markup = templateSource(PANEL);
    expect(script).not.toContain("function applyPreset");
    expect(script).not.toContain("themePresets");
    expect(markup).not.toContain("appearance-preset-grid");
    expect(markup).not.toContain("appearance-preset-card");
    // 只留只读的一行 + 入口钮。
    expect(markup).toContain("appearance-current-skin");
    expect(markup).toContain("去皮肤广场挑");
  });

  it("入口走 layout 真身，不自己派发 showCenter（多一条隐通路就多一份状态）", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain('from "../stores/layoutStore"');
    expect(script).toContain('layout.showCenter("skins")');
    expect(script).toContain("currentSkinLabel");
  });

  it("取不到皮肤时如实说「未知」，不静默显示空白", () => {
    // 用户点去广场之后会看到另一套，而这里什么都不说就成了两处互相矛盾。
    const script = scriptSource(PANEL);
    expect(script).toContain("未知的一套");
    expect(script).toContain("findAppearanceSkin");
  });
});

/* ── 2026-10-08 第二刀：删掉数据之后，界面上那两句也得跟着改口 ──────────────
   【为什么单独钉这一组，而不是靠上面那两条】
   上面钉的是「网格没了」「只剩只读一行」——那些是**结构**。
   这一刀真正会留下的烂账是**话**：文案还写着「下架不等于销毁」「配色底版仍可用」，
   而它指的那张表已经从仓库里删了。用户照着那句话去广场找那十套，一套都找不到，
   而**没有任何一处会报错**——这就是本仓反复说的「假控件」在文案层的同族。

   【为什么每条都配一句反向】
   `templateSource` / `scriptSource` 都剥注释（见 vue-source-reader），
   所以「这句话在注释里出现过」不会把反向断言喂饱——
   这两页的注释里恰恰大段写着上一版那句假话，正向读原文会当场反咬。 */
describe("第二刀 · 广场那句「外观页会说明是哪一套」说的是真话", () => {
  const PAGE = "components/SkinGalleryPage.vue";

  it("广场说明：写「已经整套删除」，回落点取 defaultAppearanceSkin.label", () => {
    const markup = templateSource(PAGE);
    /* 三条逐句断言读的都是**未经折行的原文**——这正是它们的价值：
       prettier 会把 `<p>` 里的长中文按 printWidth 折行并**在折点补一个空格**，
       于是上一版页面上画出了「』。 「设置 · 外观」，还把书名号词拦腰截断。
       现在每句各占一个 `<p>`，一行以内不会被折；哪天有人把它们合回一段长文，
       这里就会红在**断句**上（红对了：那句话确实不再逐句可钉）。 */
    expect(markup).toContain("没有画面的出厂配色，已经整套删除");
    /* 【这一刀真正会留下的第二种烂账：数值表那句交代】
       上一版这里还写着「它们从上游搬来的数值……运行时还得按原值渲染」。
       第二刀的回落会把四层连同三色整份覆写（`appearance-skin-preview.test.ts` 那条
       「三色与五层一起换」钉着），所以盘上那些老层取值**不再上屏**，这句话成了假话，
       而它说的偏偏是屏幕上看不出来的事。⇒ 已从用户可见文案里删掉，
       真实理由（只为「老 JSON 解析得动」而留）改由 `appearance-skins.test.ts` 那组钉。 */
    expect(markup, "广场还在说「按原值渲染」—— 回落会整份覆写四层，这句已经是假话").not.toMatch(
      /按原值渲染|还得按.{0,6}渲染/
    );
    // 那五条改编皮同样已经删除，所以「下架」这个词在说明里不该再出现（它指的两批都删了）。
    expect(markup, "说明里还留着「下架」—— 第二刀之后那批条目是删除，不是下架").not.toContain(
      "下架"
    );
    expect(markup).toContain("上一批那五条改编自上游的开源换装插件（MIT）");
    expect(markup).toContain("换上去读起来仍然只是「换了个色调」");
    // 回落点**不许写死皮肤名**：它是「广场第一套」，继续加带画皮肤时这一句要跟着自己变。
    expect(markup).toContain("{{ defaultAppearanceSkin.label }}");
    expect(markup, "回落点被写死成某个皮肤名 —— 表头插进新皮肤后这句话就成了假话").not.toMatch(
      /自动回到这里的『[^{]/
    );
    expect(markup).toContain(
      '<p class="skin-gallery-note">「设置 · 外观」那一页会说明是哪一套被换掉了。</p>'
    );
    // 反向：上一版那句「下架不等于销毁」与「配色底版仍可用」都不许留
    //（`templateSource` 剥 HTML 注释，所以这两页注释里大段的历史交代不会反咬）。
    for (const lie of ["下架不等于销毁", "配色底版", "作为配色底版可用"]) {
      expect(markup, `广场说明里还留着「${lie}」—— 那张表已经删了`).not.toContain(lie);
    }
    // 页面上不许出现 markdown 星号（`.vue` 的文本不是 markdown，星号会原样画出来）。
    expect(markup, "正文里出现 markdown 星号：页面会连星号一起显示").not.toContain("**");
  });

  it("多段说明之间的间距规则真的写了（六行贴排的短句读起来像表格）", () => {
    const css = strippedStyleSource("skin-gallery.css");
    expect(ruleBlock(css, ".skin-gallery-note + .skin-gallery-note")).toContain("margin-top:");
  });

  it("每句说明在源码里各占一行（prettier 一折行，屏幕上就多出一个半角空格）", () => {
    /* 【为什么钉「不折行」这件事本身】
       2026-10-08 真机量过一次：prettier 把 `<p>` 里的长中文按 printWidth 折行，
       折点那个换行被浏览器当**真空格**画出来，于是屏幕上出现「搬的都是参数， 换上去」
       「老用户盘上存着 那些四层取值」——源码看着没毛病，读起来像打错字。
       逐句 `toContain` 抓不到它（它读的是拼起来的原文），所以这里直接钉结构：
       **任何一句说明的源码里都不许出现「句中换行」**。哪天有人把两句合回一段长文，
       这条会红在断句之前，而不是等下次真机才发现。 */
    const markup = templateSource("components/SkinGalleryPage.vue");
    const paragraphs = [...markup.matchAll(/<p class="skin-gallery-note">([\s\S]*?)<\/p>/g)];
    expect(paragraphs.length, "广场说明一句都没读到 —— 类名改了，这条守卫已经空转").toBeGreaterThan(
      0
    );
    const folded = paragraphs.map((m) => (m[1] ?? "").trim()).filter((body) => body.includes("\n"));
    expect(folded, `有 ${folded.length} 句说明被折成多行：${JSON.stringify(folded)}`).toEqual([]);
  });

  it("广场页确实 import 了 defaultAppearanceSkin（模板引用没 import 是构建期才红的那种错）", () => {
    expect(scriptSource(PAGE)).toContain("defaultAppearanceSkin");
  });

  /* 这一组**只管广场页那一段说明**。
     面板那句实话（`replacedSkinId` 驱动、原 id 进了文案、那条 CSS 规则）
     归 `components/appearance-panel-wiring.test.ts` 钉——一条判据一份实现（铁律 6），
     这里再抄一遍就成了两处会各自漂移的守卫。 */
});

/**
 * 5-㊵ 撞出来的一个真回归，顺手钉住。
 *
 * 【发生了什么】
 * 重写 `appearanceThemeRuntime.ts` 时，我把字体四件的**名字**按「先主题后字体」的语序
 * 改成了 `--font-ui` / `--font-editor` / `--font-size-ui` / `--font-size-code`。
 * 而约 40 处样式消费的是 `--ui-font` / `--editor-font` / `--ui-font-size` / `--code-font-size`。
 *
 * **为什么它当时没立刻坏**：改名当天就被 `theme-token-guard.test.ts` 报成孤儿了；
 * 假如那条守卫不存在，那四处的表现就是「字号与字体不太对」——
 * 每处 CSS 都带着兜底值，而兜底值恰好接近，于是**界面只是有点不对，不报错**。
 *
 * 【为什么在这里钉，而不是指望那条守卫】
 * 那条守卫报的是「孤儿」，读的人要自己回溯是谁改的；
 * 这里直接把**四个名字**钉住，并说明「顺序不许换」，改名的当天就会红在原地。
 */
describe("运行时 · 字体四件的名字不许被「理顺语序」改掉", () => {
  it("按原名写入，且不按新名写（后者会让 40 处样式退回各自的兜底值）", () => {
    const runtime = typeScriptSource("composables/appearanceThemeRuntime.ts");
    for (const name of ["--ui-font", "--editor-font", "--ui-font-size", "--code-font-size"]) {
      expect(runtime, `${name} 没在运行时被写入`).toContain(`setProperty("${name}"`);
    }
    for (const wrong of ["--font-ui", "--font-editor", "--font-size-ui", "--font-size-code"]) {
      expect(
        runtime,
        `${wrong} 是我自造的别名：全仓没有消费它，而真名那边反而没人写了`
      ).not.toContain(`setProperty("${wrong}"`);
    }
  });

  it("半透明侧栏那一族没被重写时漏掉（漏掉 = 侧栏退回浅色兜底，深色主题下浅底浅字）", () => {
    const runtime = typeScriptSource("composables/appearanceThemeRuntime.ts");
    expect(runtime).toContain('setProperty(\n    "--sidebar-surface"');
    // 这枚 data 属性是 CSS 里 `[data-translucent-sidebar="true"]` 的开关。
    expect(runtime).toContain("root.dataset.translucentSidebar");
    // 窗口标题栏颜色。
    expect(runtime).toContain('meta[name="theme-color"]');
  });
});

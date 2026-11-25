/**
 * 输入卡 #105 · 对齐 deepwrite 那张卡的源码接线契约。
 * 结构真身（deepwrite ConversationComposer.vue + styles.css 的 composer 段）：
 * 圆角卡 composer-wrap/composer/composer-input-surface、rows=1 + field-sizing: content 自增高、
 * toolbar 左右分栏、同一位置的 发送↔stop 形变、忙态整卡 is-disabled 压暗。
 * 本仓 `.vue` 不进类型程序（裸 tsc + vue-shim），CSS 段更不在任何类型关卡覆盖内，
 * 所以这些只能靠读源断言钉死（先例：model-select-wiring.test.ts、hotkey-markers.test.ts）。
 * vue-source-reader 会剥注释：只在注释里宣称的结构不算数。
 * 三条裁定一并反向钉：A 计数条常态不占位、超限才有可见理由；B 忙态 textarea 绝不 disabled、Tab 通路不动；
 * C 两枚圆钮进卡后各接自己真有的通路（＋ 接引用素材；麦克风 2026-10-06 起接 Web Speech 语音输入，
 * 不再是 disabled 占位——它的接线细则与「降级理由必须看得见」在 composer-voice-wiring.test.ts）。
 */
import { describe, expect, it } from "vitest";
import { USER_TEXT_MAX_LEN } from "@mochen/contracts";
import {
  USER_TEXT_NEAR_RATIO,
  composerChips,
  composerCounter,
  type ComposerChipSlot
} from "../utils/composer-chips";
// styleSource / cardSection / ruleBlock 三株读 CSS 的助手原先在这里与 inline-reference-menu-wiring 各抄一份（铁律 6）。
import {
  cardSection,
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const COMPOSER = "components/ComposerBox.vue";
const CENTER = "components/CenterColumn.vue";

function markup(): string {
  return templateSource(COMPOSER);
}

function chipInput(over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return {
    hasBook: true,
    mode: "read-only" as const,
    // 2026-10-05 批次 4：工作模式必填（老书默认动手档），底座固定在这里。
    workMode: "act" as const,
    saving: false,
    thinkingLevel: "off" as const,
    thinkingWire: "standard" as const,
    webSearchEnabled: false,
    sampleCount: 1 as const,
    modelLabel: "mochen-mock",
    baseURL: "http://127.0.0.1:8787/v1",
    ...over
  };
}

function chip(id: string, over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return composerChips(chipInput(over)).find((item) => item.id === id);
}

function tagOf(classNeedle: string): string {
  return new RegExp(`<button[^>]*class="${classNeedle}"[^>]*>`).exec(markup())?.[0] ?? "";
}

describe("composer 卡骨架 · 对齐 deepwrite 的圆角卡", () => {
  it("textarea 在卡内自增高：rows=1 + field-sizing: content + max-height，封顶 150px，不许留 rows=3", () => {
    const m = markup();
    const ta = /<textarea[\s\S]*?>/.exec(m)?.[0] ?? "";
    expect(ta).toContain('class="composer-textarea"');
    expect(ta).toContain('rows="1"');
    expect(m).not.toContain('rows="3"');
    const pane = cardSection("agent-pane.css");
    expect(ruleBlock(pane, ".composer-textarea")).toContain("field-sizing: content");
    expect(ruleBlock(pane, ".composer-textarea")).toContain("max-height: 150px");
  });

  it("卡片三层骨架与容器查询都在：composer-wrap / composer / composer-input-surface", () => {
    const m = markup();
    expect(m).toContain('class="composer-wrap"');
    expect(m).toMatch(/<div class="composer" :class/);
    expect(m).toContain('class="composer-input-surface"');
    const pane = cardSection("agent-pane.css");
    expect(ruleBlock(pane, ".composer-wrap")).toContain("container: composer / inline-size");
    expect(pane).toContain("@container composer");
  });

  it("旧竖排 footer 的类名全部退役：agent-composer/composer-box/composer-chips 容器不再出现", () => {
    // #112 的两行提示都已按裁定退役（2026-10-04）：composer-chip-hint 是 toolbar 里那句
    // 「运行中按 Tab 可排队指令」，composer-hint 是卡下键位提示行——连同样式段一起删净。
    const m = markup();
    for (const dead of [
      "agent-composer",
      "composer-box",
      'class="composer-chips"',
      "composer-chip-hint",
      "composer-hint",
      "composer-send",
      "composer-stop"
    ]) {
      expect(m, `旧类名 ${dead} 必须已被卡片结构取代`).not.toContain(dead);
    }
    for (const file of ["agent-pane.css", "interaction.css"]) {
      for (const dead of [".composer-chip-hint", ".composer-hint"]) {
        expect(styleSource(file), `styles/${file} 里 ${dead} 无人消费`).not.toContain(dead);
      }
    }
  });

  /**
   * 裁定 C（#112 改判 → 2026-10-06 二次改判）：`＋` 与麦克风照参考图进卡，各带自己真有的通路或看得见的理由。
   *
   * **本轮撤销的旧钉（不是放宽，是它断言的东西已被用户裁定撤销）**：
   * 旧断言是「麦克风恒 `disabled`、理由写在 aria-label 里」——那正是 `ComposerBox.vue`
   * 顶部注释里「麦克风仍是参考仓自己那一枚 disabled 占位」所描述的形态。
   * 用户要求把它接成真通路（Web Speech API 语音输入），那枚死按钮连同它断言的东西一起退役了。
   * 保留一个「它必须恒 disabled」的断言，等于逼着实现继续装样子。
   *
   * **换成更强的钉**（细节在 components/composer-voice-wiring.test.ts）：麦克风的 `:disabled`
   * 必须绑到 voice 判定的那份输出、不许再是写死的 `disabled`，且降级理由必须落在
   * 卡下那行看得见的提示里——Chromium 不给 disabled 元素弹 title，靠 title 兜就是没有理由。
   */
  it("裁定 C（2026-10-06 二次改判）：`＋` 与麦克风照参考图进卡，各接自己真有的通路", () => {
    const m = markup();
    const plus = /<button[^>]*class="round-tool-button"[\s\S]*?<\/button>/.exec(m)?.[0] ?? "";
    expect(plus).toContain('aria-label="引用素材"');
    expect(plus).toContain(`@click="emit('open-mention')"`);
    expect(plus).toContain('name="plus"');
    // 麦克风：接的是语音判定，不再是写死的 disabled 占位（详见 composer-voice-wiring.test.ts）。
    const mic =
      /<button[^>]*:disabled="voice\.button\.disabled"[\s\S]*?<\/button>/.exec(m)?.[0] ?? "";
    expect(mic).toContain('name="mic"');
    expect(mic).toContain('@click="voice.toggle()"');
    expect(mic).not.toMatch(/(^|\s)disabled(\s|$|=)/);
    // 旧形态的 aria-label 不许回来：它说的是「后续开放」，与真通路并存就是两个矛盾的说法。
    expect(m).not.toContain("语音功能后续开放");
  });

  // 档位 chip 搬进卡右端后，头部那套 `.permission-chip` 就成了零消费者的化石（评审 F1）。
  // 铁律「不留化石」要有关卡：类名一旦在样式表里复活而无人使用，这条就红。
  it("档位 chip 的旧样式全退役：.permission-chip 在模板与样式表里都不许留", () => {
    for (const file of ["agent-pane.css", "interaction.css", "conversation-pane.css"]) {
      expect(
        styleSource(file),
        `styles/${file} 里 .permission-chip 是无人消费的化石`
      ).not.toContain(".permission-chip");
    }
    for (const component of [COMPOSER, CENTER]) {
      expect(vueSource(component)).not.toContain("permission-chip");
    }
  });
});

describe("composer-toolbar 左右分栏 · slot 决策只有 composer-chips.ts 一份", () => {
  it("toolbar 是两个容器，发送键住右端容器内", () => {
    const m = markup();
    const left = m.indexOf('class="composer-toolbar-left"');
    const right = m.indexOf('class="composer-toolbar-right"');
    const send = m.indexOf('class="send-button"');
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(right);
    // 左端容器里不得混进发送键（两段之间就是左端的全部）。
    expect(m.slice(left, right)).not.toContain("send-button");
  });

  it("运行中同一枚位置渲染 stop：v-if=running 与 v-else 发送互斥，不是并排两枚", () => {
    const stopTag = tagOf("send-button stop-button");
    expect(stopTag).toContain('v-if="running"');
    const sendTag = tagOf("send-button");
    expect(sendTag).not.toBe("");
    expect(sendTag).toContain("v-else");
  });

  it("slot 是 .ts 表的新字段：左=思考/联网/自动技能，右=模型/权限，more=四组低频开关（2026-11-09 参考图② + 11-10 裁定）", () => {
    const want: Record<string, ComposerChipSlot> = {
      // 2026-11-09 参考图②：模型名落在发送键左侧，slot 从 left 改到 right。
      model: "right",

      "web-search": "left",
      draft: "more",
      tools: "more",
      palette: "more",
      "auto-skills": "left",
      "work-mode": "more",
      permission: "right"
    };
    const slots = composerChips(chipInput()).map((c) => [c.id, c.slot]);
    // 顺序不许动：composer-chips.test.ts 钉死了 id 序，这里跟着同一序核 slot。
    expect(slots).toEqual([
      ["model", want.model],

      ["web-search", want["web-search"]],
      ["draft", want.draft],
      ["tools", want.tools],
      ["palette", want.palette],
      ["auto-skills", want["auto-skills"]],
      ["work-mode", want["work-mode"]],
      ["permission", want.permission]
    ]);
  });

  it("模板只渲染 chipsLeft/chipsRight/chipsMore（源自 chips computed 的过滤），不出现第二份顺序表", () => {
    const m = markup();
    const script = scriptSource(COMPOSER);
    expect(m).toContain('v-for="chip in chipsLeft"');
    expect(m).toContain('v-for="chip in chipsRight"');
    expect(m).toContain('v-for="chip in chipsMore"');
    expect(m).not.toContain('v-for="chip in chips"');
    expect(script).toContain('c.slot === "left"');
    expect(script).toContain('c.slot === "right"');
    expect(script).toContain('c.slot === "more"');
  });

  it("忙态：chip 一律禁用、整卡挂 is-disabled 且样式表把它压到 0.75；textarea 不 disabled（裁定 B）", () => {
    const m = markup();
    expect(m).toContain(`:class="{ 'is-disabled': running }"`);
    expect(m).toContain(':disabled="chip.disabled || running"');
    const ta = /<textarea[\s\S]*?>/.exec(m)?.[0] ?? "";
    expect(ta).not.toContain(":disabled");
    expect(ta).not.toContain("disabled");
    expect(ruleBlock(cardSection("agent-pane.css"), ".composer.is-disabled")).toContain(
      "opacity: 0.75"
    );
  });

  it("#112 图标与下拉三角由 .ts 表驱动：模板只按 chip.icon / chip.caret 渲染，不自行判定任何一档", () => {
    expect(chip("model")?.icon).toBe("model");
    expect(chip("model", { thinkingLevel: "high", webSearchEnabled: true })?.icon).toBe("model");

    expect(chip("web-search", { webSearchEnabled: true })?.icon).toBe("globe");
    const m = markup();
    // 三条循环（左端 / 右端 / 更多弹层）各自带全三件套 ⇒ 数次数而不是 toContain：
    // 实测把左栏循环里那行下拉三角整行删掉，22 条断言全绿（toContain 只看见右栏那一处）。
    expect(countNeedle(':name="chip.icon"', m), "三条 chip 循环都要渲染图标").toBe(3);
    // 首行两条用可截断的 `.composer-chip-label`；弹层行用同一手法的 `.composer-more-label`
    // （它不在 `.composer-toolbar-left` 里，不能复用 chip 的阶梯选择器）。
    expect(
      countNeedle('class="composer-chip-label"', m),
      "首行两条 chip 循环都要包一层可截断文字"
    ).toBe(2);
    expect(countNeedle('class="composer-more-label"', m), "弹层行也要包一层可截断文字").toBe(1);
    expect(countNeedle('v-if="chip.caret"', m), "三条 chip 循环都要按 caret 挂下拉三角").toBe(3);
    expect(countNeedle('name="chevron"', m)).toBe(3);
    // 合并口径与 badge 字段一起退役：模型名里再不许缀思考等级，也不许挂地球角标。
    expect(chip("model", { thinkingLevel: "high" })?.text).toBe("mochen-mock 高");
    expect(m).not.toContain("chip.badge");
  });
});

describe("裁定 A · 计数条常态不占位，超限理由必须看得见", () => {
  it("USER_TEXT_NEAR_RATIO 导出且等于 0.9", () => {
    expect(USER_TEXT_NEAR_RATIO).toBe(0.9);
  });

  it("near 的边界：90% 起亮，刚好到上限 near 仍真但 over 假，超上限 over 真且 near 假", () => {
    const below = Math.floor(USER_TEXT_MAX_LEN * USER_TEXT_NEAR_RATIO) - 1;
    expect(composerCounter("字".repeat(below)).near).toBe(false);
    expect(composerCounter("字".repeat(below + 1)).near).toBe(true);
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN))).toEqual({
      text: `${USER_TEXT_MAX_LEN}/${USER_TEXT_MAX_LEN}`,
      over: false,
      near: true
    });
    const over = composerCounter("字".repeat(USER_TEXT_MAX_LEN + 1));
    expect(over.over).toBe(true);
    expect(over.near).toBe(false);
  });

  it("模板：计数行只在 near/over 时出现，超限翻红 + 发送禁用 + 中文理由同时成立", () => {
    const m = markup();
    expect(m).toContain('v-if="counter.over || counter.near"');
    expect(m).toContain("已超出上限");
    expect(m).toContain("composer-counter--over");
    const sendTag = tagOf("send-button");
    expect(sendTag).toContain("counter.over");
  });
});

describe("样式硬门禁 · #105 新增段零色值字面量", () => {
  it("agent-pane.css 与 interaction.css 的卡片段不含 # 十六进制、rgb(、rgba(", () => {
    for (const file of ["agent-pane.css", "interaction.css"]) {
      const section = cardSection(file);
      expect(section, `${file} 卡片段含十六进制色值字面量`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(section, `${file} 卡片段含 rgb()/rgba()`).not.toMatch(/\brgba?\(/);
    }
  });

  it("发送键的底色走 --neutral-solid 对（本仓已有的实心键 token），不抄 deepwrite 的 --text-primary", () => {
    const block = ruleBlock(cardSection("agent-pane.css"), ".send-button");
    expect(block).toContain("var(--neutral-solid)");
    expect(block).toContain("var(--neutral-solid-contrast)");
  });

  it("#112 圆钮的圆角 50% 与 disabled 0.42 保留；尺寸已按 2026-10-17 设计稿放大到 38×38，disabled 不许画 pointer 手势", () => {
    const pane = cardSection("agent-pane.css");
    const round = ruleBlock(pane, ".round-tool-button");
    expect(round).toContain("width: 38px");
    expect(round).toContain("height: 38px");
    expect(round).toContain("border-radius: 50%");
    expect(round).toContain("place-items: center");
    const off = ruleBlock(pane, ".round-tool-button:disabled");
    expect(off).toContain("opacity: 0.42");
    // F2 裁定：deepwrite 那一枚 disabled 仍留 cursor: pointer，本仓不照抄这条（禁用的钮要说「不让按」）。
    expect(off).toContain("cursor: not-allowed");
  });

  it("#112 chip 从描边药丸改成无边框触发器（2026-11-08 UI 走查：字号抬到 0.857143rem，其余仍照 deepwrite 的 config-trigger）", () => {
    const chipRule = ruleBlock(styleSource("interaction.css"), ".composer-chip");
    expect(chipRule).toContain("height: 29px");
    expect(chipRule).toContain("border-radius: 8px");
    expect(chipRule).toContain("border: 0");
    expect(chipRule).toContain("font-size: 0.857143rem");
    expect(chipRule).toContain("padding: 0 7px");
    // 下拉三角：本仓 chevron 画的是「>」，靠 rotate 90° 才朝下（同一手法在 deepwrite 的 config-chevron）。
    expect(ruleBlock(styleSource("interaction.css"), ".composer-chip-caret")).toContain(
      "transform: rotate(90deg)"
    );
  });
});

describe("权限档弹层真身挂到卡右端（#105 目标形态 2：更多 + 发送同端）", () => {
  it("ComposerBox 渲染 PermissionMenu：开关走 prop，关闭走事件，本组件不自行判定档位", () => {
    const m = markup();
    const script = scriptSource(COMPOSER);
    expect(m).toContain("<PermissionMenu");
    expect(m).toContain('v-if="permissionMenuOpen"');
    expect(m).toContain(`@close="emit('close-permission-menu')"`);
    expect(script).toContain("permissionMenuOpen: boolean");
    expect(script).toContain('"close-permission-menu": []');
  });

  it("CenterColumn 同步传参：头部旧挂载点退役，弹层全仓只剩卡内这一份真身", () => {
    const center = templateSource(CENTER);
    expect(center).toContain(':permission-menu-open="book.hasBook && book.permissionMenuOpen"');
    expect(center).toContain(`@close-permission-menu="book.closePermissionMenu()"`);
    expect(center).not.toContain("permission-menu-actions");
    expect(center).not.toContain("<PermissionMenu");
  });

  it("弹层朝上翻：右端容器是锚点，卡片段里有把 .permission-menu 翻到上方的覆盖规则", () => {
    const pane = cardSection("agent-pane.css");
    expect(ruleBlock(pane, ".composer-toolbar-right")).toContain("position: relative");
    expect(pane).toContain(".composer-toolbar-right .permission-menu");
  });
});

/**
 * 2026-10-17 用户裁定（真机截图：「还有这么多大的位置，为什么会成这样？挤在一块被遮挡，不显示全部了」）。
 *
 * 病因是**卡宽不跟着栏宽走**：`.composer-wrap` 原先写
 * `padding: 10px max(18px, calc((100% - 760px) / 2)) 12px`——把卡硬截到 760px。
 * 1440 窗口、右栏折叠（本机默认：`wrap` 量到 1154）时，那条内边距算出 197px，
 * 于是**卡左右各空出 197px 死区**；而卡里那条 chip 行按 760 的容器算账，
 * 左端五枚自然宽 448.3 ＋ 右端 301 ＋ 卡内边距 17 ＋ 间隙 8 = 774.3 ⇒ **缺 14.3px**，
 * 缺额全按 `flex-shrink: 100` 砸在模型名上（真机读数：label 得 58px、内容要 77px）。
 * 「同一屏里一大片空的」与「挤出省略号」是同一个根因的两种表象，不是两个毛病。
 *
 * 修法不是把 760 换成一个新的写死数，而是**把这一个数收成 token**：
 * 卡（`.composer-wrap` 的两侧内边距帽）与消息列（`.message-list` 的版心宽）读同一个变量。
 * 这两条在本次编辑之前就是同一个数（都写着 760px）——分头写两个数会漂，
 * 而漂开的那一刻不会有任何东西报错，只会让输入卡和它上面的正文对不齐。
 *
 * 下限 1080 不是估的：1440 窗口右栏折叠时栏宽 1154/1178，卡宽取到这一档
 * 才既装得下上面那 774.3（模型名整条显示，不再出省略号），
 * 又不会在常见窗口下再留出成片死空（杀过的对照组见 agent-pane.css 那条规则上的注释）。
 *
 * ── 【2026-10-25 改钉】上面那句「两条逐档恒等」当时是**假的** ──
 * 它只对**注入量**成立，对**真渲染**不成立：正文列在**滚动容器**里，
 * 而滚动条是**布局内**的（12px）⇒ 正文列真值 = min(1120, 1154 − 12 − 48) = 1094，
 * 卡却还是 1154 − 48 = 1106 ⇒ **卡比正文宽 12px、左边缘齐而右边缘错开**。
 * 「注入量」量不到滚动条，所以那道复验量的是纸面值、不是屏上值。
 * ⇒ 改法从「两条读同一个变量」升级为「**两条用同一个公式 + 两个容器同宽**」：
 * 滚动条那条槽由 `scrollbar-gutter: stable` **永远**留着（宽度 = `--scrollbar-gutter`），
 * 输入卡这侧让的是同一个数 ⇒ 两个容器的可用宽度逐档相等 ⇒ 卡与正文列逐档同宽同左缘。
 */
describe("输入卡版心 · 与消息列同宽（2026-10-25 改钉：同一个公式 + 同一个容器宽度）", () => {
  const columnToken = (): number => {
    const m = /--conversation-column-width:\s*(\d+)px/.exec(vueSource("styles.css"));
    expect(m, "styles.css 的 :root 里必须定义 --conversation-column-width").not.toBeNull();
    return Number(m?.[1]);
  };

  it("卡宽不再写死：卡与消息列读同一个 token", () => {
    // 【为什么断言挪到 `.composer`】宽度原先写在 `.composer-wrap` 的**内边距帽**上，
    // 那一写法把「减多少」写死在内边距里，于是正文那侧减 48、卡这侧也减 48 却少减了滚动条那 12。
    // 现在宽度写在卡自己的容器 `.composer` 上，与 `.message-list` 同一个公式（下一条钉）。
    const composer = ruleBlock(styleSource("agent-pane.css"), ".composer");
    expect(composer).toContain("var(--conversation-column-width)");
    expect(composer).not.toContain("760px");
    // 反向：那条写死的内边距帽不许回来（它就是「少减了滚动条那 12」的来源）。
    const wrap = ruleBlock(styleSource("agent-pane.css"), ".composer-wrap");
    expect(wrap, "内边距帽回来了 ⇒ 卡宽又与正文列分家").not.toContain("calc((100% - var(");
  });

  it("消息列与卡同宽：两条用**一字不差**的公式（同一个 token、同一个留白、同一个 auto 居中）", () => {
    const composer = ruleBlock(styleSource("agent-pane.css"), ".composer");
    const list = ruleBlock(styleSource("conversation-pane.css"), ".message-list");
    const formula =
      "width: min(var(--conversation-column-width), calc(100% - var(--conversation-inline-inset) * 2));";
    for (const [name, block] of [
      [".composer", composer],
      [".message-list", list]
    ] as const) {
      expect(block, `${name} 的宽度公式与另一条不一致`).toContain(formula);
      expect(block, `${name} 没有 auto 居中`).toContain("margin: 0 auto");
      // 留白不许再写死成字面量：一旦哪一侧退回 `calc(100% - 48px)`，
      // 窄窗那条（≤1220px 的另一档留白）就跟它分家 ⇒ 卡比正文列窄 14px。
      expect(block, `${name} 又把两侧留白写死成字面量了`).not.toMatch(/calc\(100% - \d+px\)/);
    }
    expect(list).not.toContain("760px");
  });

  it("两侧留白来自同一个 token：默认每侧 12px、窄窗每侧 10px，窄窗只改这一个数", () => {
    // 【2026-10-25 窄档那一刀】原先窄窗（≤1220px）里正文列另起一条 `calc(100% - 34px)`，
    // 卡侧不跟 ⇒ 真机读数 1200 / 1000 / 860 三档卡比正文列窄 14px（每侧 7px），只有 1440 齐。
    // 【2026-11-09 用户裁定「两边边框太大了」】24/17 收到 12/10：参考图里卡几乎贴着中栏两缘。
    const root = vueSource("styles.css");
    const base = /--conversation-inline-inset:\s*(\d+)px/.exec(root);
    expect(base, "styles.css 的 :root 里必须定义 --conversation-inline-inset").not.toBeNull();
    expect(Number(base?.[1]), "默认两侧留白应当是每侧 12px（合计 24px）").toBe(12);
    // 窄窗只改这一个数（20px ÷ 2 = 每侧 10px）。
    const narrow =
      /@media \(max-width: 1220px\)\s*\{[\s\S]*?--conversation-inline-inset:\s*(\d+)px/.exec(root);
    expect(narrow, "窄窗那块必须改 --conversation-inline-inset").not.toBeNull();
    expect(Number(narrow?.[1]) * 2, "窄窗两侧留白合计应当是 20px").toBe(20);
    // 这个 token 只有两处定义：默认值一处、窄窗覆盖一处——再多一处就是分家的开始。
    const hits = root.match(/--conversation-inline-inset:/g) ?? [];
    expect(hits.length, "--conversation-inline-inset 的定义处不止「默认 + 窄窗」两处").toBe(2);
  });

  it("两个容器的可用宽度相等：滚动条那条槽永远留着，卡这侧让同一个数", () => {
    const scroll = ruleBlock(styleSource("conversation-pane.css"), ".conversation-scroll");
    // ① 正文容器永远让出滚动条那条槽（不写这条：线程一长正文列就窄 12px、线程一短又复原）。
    expect(scroll, "滚动条那条槽不是常驻的 ⇒ 正文列宽度随滚动状态变").toContain(
      "scrollbar-gutter: stable"
    );
    // ② 那条槽的宽度与卡侧让位读**同一个 token**（一个数两处读）。
    const bar = ruleBlock(
      styleSource("conversation-pane.css"),
      ".conversation-scroll::-webkit-scrollbar"
    );
    expect(bar).toContain("var(--scrollbar-gutter)");
    const wrap = ruleBlock(styleSource("agent-pane.css"), ".composer-wrap");
    expect(wrap, "卡侧让的不是那同一个数 ⇒ 卡与正文列各减各的").toContain(
      "var(--scrollbar-gutter)"
    );
    // ③ 那个 token 在 :root 里有且只有一个定义（styles.css 里数一次）。
    const root = vueSource("styles.css");
    const hits = root.match(/--scrollbar-gutter:/g) ?? [];
    expect(hits.length, "--scrollbar-gutter 的定义处不止一个").toBe(1);
  });

  it("这一档够宽：760 那档装不下左端五枚（缺 14.3px 全砸在模型名上），1080 起才有一整行不出省略号的余量", () => {
    expect(columnToken()).toBeGreaterThanOrEqual(1080);
  });
});

/**
 * 输入区不再留空带（2026-10-25 用户批注「对话框感觉还是不太行」）。
 *
 * 读数（1440 / 右栏折叠）：输入区 88px 而里面只有一行 34px 的 textarea ⇒ 上下共 54px 是净空。
 * 占位文字孤零零挂在卡的上沿，下面一整条空带，再往下才是那条发丝线——整卡上半部读起来
 * 是一块没写字的白板（卡总高 153px，却只是「一格字 + 一排开关」）。
 * ⇒ 输入区改成**按内容走**：上下内边距 16 / 10 ⇒ 16 + 34 + 10 = 60px，卡随内容长高。
 * （2026-11-09 参考图②：卡内发丝线撤掉，下沿从 14 收到 10，节奏改由内边距承担。）
 */
describe("输入区 · 按内容走，不留空带（2026-10-25）", () => {
  it("不再有撑高度的 min-height：那条最小高度容得下一行字，剩下的全是净空", () => {
    const zone = ruleBlock(cardSection("agent-pane.css"), ".composer-input-zone");
    expect(zone, "min-height 又回来了 ⇒ 上半部又变回一块空板").not.toContain("min-height");
  });

  it("上下内边距之和 ≤ 32px（16 + 10）：留白要撑得起呼吸，又不能撑成一条空带", () => {
    const zone = ruleBlock(cardSection("agent-pane.css"), ".composer-input-zone");
    const padding = /padding:\s*([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px/.exec(zone);
    expect(padding, "读不到 .composer-input-zone 的 padding").not.toBeNull();
    const top = Number(padding?.[1]);
    const bottom = Number(padding?.[3]);
    expect(top + bottom, "上下留白合计超过 32px ⇒ 输入区又是一条空带").toBeLessThanOrEqual(32);
  });

  it("输入区仍由 textarea 的自增高撑开（field-sizing: content），不是写死的高度", () => {
    const textarea = ruleBlock(cardSection("agent-pane.css"), ".composer-textarea");
    expect(textarea).toContain("field-sizing: content");
    expect(textarea).toContain("max-height: 150px");
  });
});

/**
 * 输入卡下方 · 「选择作品」一行（2026-11-09 参考图③）。
 * 参考图那一层是「选择文件夹 / 本地 + 场景预设」；本仓只落**有真通路**的一半：
 * 新建作品 / 打开作品目录 / 最近作品。远程项目、不需要项目、场景预设都没有契约，
 * 一条都不编（编出来就是点了没反应的假控件）。
 * 两条反向钉：① 这一行常驻——不许挂 v-if，尤其不许借卡上方绑定条的显隐；
 * ② 三个动作只许走既有入口，渲染层不许新开 IPC 或新数据字段。
 */
describe("输入卡下方 · 选择作品一行（2026-11-09 参考图③）", () => {
  const BAR = "components/ComposerProjectBar.vue";
  const OPTIONS = "utils/composer-project.ts";

  it("常驻在输入面之后：不挂 v-if，也不依赖卡上方绑定条", () => {
    const m = markup();
    const surface = m.indexOf('class="composer-input-surface"');
    const row = m.indexOf("<ComposerProjectBar");
    expect(surface, "读不到 .composer-input-surface").toBeGreaterThan(-1);
    expect(row, "参考图③那一行没有挂进卡里").toBeGreaterThan(surface);
    // 常驻 = 不开书时也在（那正是最需要它的时候）；挂 v-if 就会退回「只有开书后才看得见」。
    expect(m).not.toContain("<ComposerProjectBar v-if");
  });

  it("三个动作只走既有入口：新建作品 / 打开目录 / 最近作品", () => {
    const s = scriptSource(BAR);
    expect(s, "新建作品没走 left 栏 / 工作台同一个对话框入口").toContain("layout.openNewBook()");
    expect(s, "打开目录没走 Ctrl+O 那条真通路").toContain("book.pickAndOpen()");
    expect(s, "最近作品没走作品库那一行的打开方式").toContain("book.openBook(rootPath)");
    const options = typeScriptSource(OPTIONS);
    expect(options).toContain('export const PROJECT_NEW_ID = "new"');
    expect(options).toContain('export const PROJECT_PICK_ID = "pick"');
    expect(options).toContain('export const PROJECT_BOOK_PREFIX = "book:"');
  });

  it("弹层沿用同一份通用面：标题 / 搜索 / 键盘都不另起一份", () => {
    const m = templateSource(BAR);
    expect(m).toContain("<ComposerContextMenu");
    expect(m).toContain('heading="选择作品"');
    expect(m).toContain('search-placeholder="搜索作品名称"');
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).toContain("选择作品");
  });
});

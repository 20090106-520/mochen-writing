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

  it("slot 是 .ts 表的新字段：左=运行配置六枚，右=工作模式与权限（#112 定栏，批次 4 扩右端）", () => {
    const want: Record<string, ComposerChipSlot> = {
      model: "left",
      thinking: "left",
      "web-search": "left",
      draft: "left",
      tools: "left",
      palette: "left",
      "work-mode": "right",
      permission: "right"
    };
    const slots = composerChips(chipInput()).map((c) => [c.id, c.slot]);
    // 顺序不许动：composer-chips.test.ts 钉死了 id 序，这里跟着同一序核 slot。
    expect(slots).toEqual([
      ["model", want.model],
      ["thinking", want.thinking],
      ["web-search", want["web-search"]],
      ["draft", want.draft],
      ["tools", want.tools],
      ["palette", want.palette],
      ["work-mode", want["work-mode"]],
      ["permission", want.permission]
    ]);
  });

  it("模板只渲染 chipsLeft/chipsRight（源自 chips computed 的过滤），不出现第二份顺序表", () => {
    const m = markup();
    const script = scriptSource(COMPOSER);
    expect(m).toContain('v-for="chip in chipsLeft"');
    expect(m).toContain('v-for="chip in chipsRight"');
    expect(m).not.toContain('v-for="chip in chips"');
    expect(script).toContain('c.slot === "left"');
    expect(script).toContain('c.slot === "right"');
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
    expect(chip("thinking", { thinkingLevel: "low" })?.icon).toBe("brain");
    expect(chip("web-search", { webSearchEnabled: true })?.icon).toBe("globe");
    const m = markup();
    // 左右两条循环各自带全「图形 + 可截断文字 + 三角」三件套 ⇒ 数次数而不是 toContain：
    // 实测把左栏循环里那行下拉三角整行删掉，22 条断言全绿（toContain 只看见右栏那一处）。
    expect(countNeedle(':name="chip.icon"', m), "两条 chip 循环都要渲染图标").toBe(2);
    expect(
      countNeedle('class="composer-chip-label"', m),
      "两条 chip 循环都要包一层可截断文字"
    ).toBe(2);
    expect(countNeedle('v-if="chip.caret"', m), "两条 chip 循环都要按 caret 挂下拉三角").toBe(2);
    expect(countNeedle('name="chevron"', m)).toBe(2);
    // 合并口径与 badge 字段一起退役：模型名里再不许缀思考等级，也不许挂地球角标。
    expect(chip("model", { thinkingLevel: "high" })?.text).toBe("mochen-mock");
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

  it("#112 chip 从描边药丸改成无边框触发器（deepwrite 的 config-trigger 原值：高 29 / 圆角 7 / 字号 0.75rem）", () => {
    const chipRule = ruleBlock(styleSource("interaction.css"), ".composer-chip");
    expect(chipRule).toContain("height: 29px");
    expect(chipRule).toContain("border-radius: 7px");
    expect(chipRule).toContain("border: 0");
    expect(chipRule).toContain("font-size: 0.75rem");
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
 */
describe("输入卡版心 · 与消息列共用同一个列宽 token（2026-10-17 用户裁定）", () => {
  const columnToken = (): number => {
    const m = /--conversation-column-width:\s*(\d+)px/.exec(vueSource("styles.css"));
    expect(m, "styles.css 的 :root 里必须定义 --conversation-column-width").not.toBeNull();
    return Number(m?.[1]);
  };

  it("卡宽不再写死：.composer-wrap 的两侧内边距帽走 --conversation-column-width", () => {
    const body = ruleBlock(styleSource("agent-pane.css"), ".composer-wrap");
    expect(body).toContain("var(--conversation-column-width)");
    expect(body).not.toContain("760px");
  });

  it("消息列与卡同宽：.message-list 的版心宽读同一个变量（两条要一起动，否则卡会比正文宽出一截）", () => {
    const body = ruleBlock(styleSource("conversation-pane.css"), ".message-list");
    expect(body).toContain("min(var(--conversation-column-width)");
    expect(body).not.toContain("760px");
  });

  it("这一档够宽：760 那档装不下左端五枚（缺 14.3px 全砸在模型名上），1080 起才有一整行不出省略号的余量", () => {
    expect(columnToken()).toBeGreaterThanOrEqual(1080);
  });

  it("两条的兜底成对：卡侧每侧留白 ×2 = 正文版心的整体留白", () => {
    // 【为什么单开这一道】上面三条只钉到「两条读同一个变量」——读得到同一个变量、
    // 却各自加减不同的数，照样漂。真机构建（1440 / 右栏折叠 / 容器 1154 / token 1120）量到的正是这一形：
    // 卡侧兜底 18px ⇒ 卡面 1154 − 36 = 1118；正文那条 48px ⇒ min(1120, 1154 − 48) = 1106。
    // 两个值都"对"，但卡比它上面的正文每侧宽 6px，而屏幕上一句报错都没有。
    const card = ruleBlock(styleSource("agent-pane.css"), ".composer-wrap");
    const list = ruleBlock(styleSource("conversation-pane.css"), ".message-list");
    const floor = Number(/max\((\d+)px/.exec(card)?.[1]);
    const gutter = Number(/calc\(100% - (\d+)px\)/.exec(list)?.[1]);
    expect(floor, ".composer-wrap 那条 max() 兜底读不到").toBeGreaterThan(0);
    expect(gutter, ".message-list 那条 calc(100% - …px) 兜底读不到").toBeGreaterThan(0);
    expect(
      floor * 2,
      `卡侧每侧 ${floor}px 而正文整体留 ${gutter}px——容器落在 token 与 token + ${gutter} 之间时两条各减不同的数，卡与正文就会错开`
    ).toBe(gutter);
  });
});

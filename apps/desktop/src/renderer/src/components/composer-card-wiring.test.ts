/**
 * 输入卡 #105 · 照搬 deepwrite 那张卡的源码接线契约。
 * 结构真身（deepwrite ConversationComposer.vue + styles.css 的 composer 段，Apache-2.0）：
 * 圆角卡 composer-wrap/composer/composer-input-surface、rows=1 + field-sizing: content 自增高、
 * toolbar 左右分栏、同一位置的 发送↔stop 形变、忙态整卡 is-disabled 压暗。
 * 本仓 `.vue` 不进类型程序（裸 tsc + vue-shim），CSS 段更不在任何类型关卡覆盖内，
 * 所以这些只能靠读源断言钉死（先例：model-select-wiring.test.ts、hotkey-markers.test.ts）。
 * vue-source-reader 会剥注释：只在注释里宣称的结构不算数。
 * 三条裁定一并反向钉：A 计数条常态不占位、超限才有可见理由；B 忙态 textarea 绝不 disabled、Tab 通路不动；
 * C 附件(+)与麦克风没有通道，两枚控件连同其类名不得出现在本卡里。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_TEXT_MAX_LEN } from "@mochen/contracts";
import {
  USER_TEXT_NEAR_RATIO,
  composerChips,
  composerCounter,
  type ComposerChipSlot
} from "../utils/composer-chips";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

const COMPOSER = "components/ComposerBox.vue";
const CENTER = "components/CenterColumn.vue";
const CARD_MARKER = "deepwrite-composer-card";

function markup(): string {
  return templateSource(COMPOSER);
}

function styleSource(file: string): string {
  return readFileSync(new URL(`../styles/${file}`, import.meta.url), "utf8");
}

/** 从分段标记切到文件末尾：#105 新增的样式全部住在这一段，色值字面量关卡只扫这一段。 */
function cardSection(file: string): string {
  const css = styleSource(file);
  const at = css.indexOf(CARD_MARKER);
  expect(at, `styles/${file} 里必须有 ${CARD_MARKER} 分段标记`).toBeGreaterThan(-1);
  return css.slice(at);
}

function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(m, `样式表里找不到规则 ${selector}`).not.toBeNull();
  return m?.[1] ?? "";
}

function chipInput(over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return {
    hasBook: true,
    mode: "read-only" as const,
    saving: false,
    thinkingLevel: "off" as const,
    webSearchEnabled: false,
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

describe("composer 卡骨架 · 照搬 deepwrite 的圆角卡", () => {
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

  it("旧竖排 footer 的类名全部退役：agent-composer/composer-box/composer-chips 容器/composer-hint 不再出现", () => {
    const m = markup();
    for (const dead of [
      "agent-composer",
      "composer-box",
      'class="composer-chips"',
      "composer-hint",
      "composer-send",
      "composer-stop"
    ]) {
      expect(m, `旧类名 ${dead} 必须已被卡片结构取代`).not.toContain(dead);
    }
  });

  it("裁定 C：附件与麦克风没有通道，两枚控件的类名与图标都不许长进卡里", () => {
    const m = markup();
    expect(m).not.toContain("round-tool-button");
    expect(m).not.toContain('name="mic"');
    expect(m).not.toContain('aria-label="上传附件"');
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

  it("slot 是 .ts 表的新字段：左=model/tools/palette，右=thinking/web-search/permission（#105 裁定）", () => {
    const want: Record<string, ComposerChipSlot> = {
      permission: "right",
      thinking: "right",
      "web-search": "right",
      tools: "left",
      model: "left",
      palette: "left"
    };
    const slots = composerChips(chipInput()).map((c) => [c.id, c.slot]);
    // 顺序不许动：composer-chips.test.ts 钉死了 id 序，这里跟着同一序核 slot。
    expect(slots).toEqual([
      ["permission", want.permission],
      ["thinking", want.thinking],
      ["web-search", want["web-search"]],
      ["tools", want.tools],
      ["model", want.model],
      ["palette", want.palette]
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

  it("模型 chip 合并口径：文案是 模型名 · 思考等级，联网开着时带地球角标", () => {
    expect(chip("model")?.text).toBe("mochen-mock");
    expect(chip("model", { thinkingLevel: "low" })?.text).toBe("mochen-mock · 低");
    expect(chip("model", { thinkingLevel: "high" })?.text).toBe("mochen-mock · 高");
    expect(chip("model", { modelLabel: "", thinkingLevel: "medium" })?.text).toBe(
      "未配置模型 · 中"
    );
    expect(chip("model")?.badge).toBeNull();
    expect(chip("model", { webSearchEnabled: true })?.badge).toBe("globe");
    expect(chip("thinking", { thinkingLevel: "low" })?.badge).toBeNull();
    // 角标的真身在模板里渲染，且由表里的 badge 字段驱动（模板不自行判定联网状态）。
    const m = markup();
    expect(m).toContain("chip.badge === 'globe'");
    expect(m).toContain('name="globe"');
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

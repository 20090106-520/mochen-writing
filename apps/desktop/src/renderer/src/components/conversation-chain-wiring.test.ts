/**
 * 对话链（人机气泡链）与输入卡装饰的守卫（2026-10-17）。
 *
 * 用户原话：「对话框的装饰感觉不太行，还是缺少一些东西可以参考手机软件那种人机链对话框，
 * 反正就是要好看。你也可以直接使用开源的项目那种类型的组件，免费的组件使对话框更美观更好看」。
 *
 * **为什么这一类只能靠读源文件钉**：本仓零 jsdom / @vue/test-utils（见 `utils/vue-source-reader.ts`
 * 抬头那段），「自己的话在右、助手的话在左且带一枚头像」没有任何运行时可断言的落点——
 * 它是**两条 CSS 规则加一个模板元素**的静态关系，跑起来也只是一堆字符串。
 *
 * 取向也写在这里，免得下一个人以为「用户授权用开源组件」等于可以随手引库：
 * 本仓的输入卡与消息链是**同源结构 + 一套 token**（见 `ATTRIBUTION.md`），
 * 引 Naive UI / Element Plus 这类组件库会连带第二套 token 与第二份样式实现，
 * 与铁律「同一件事不留第二份实现」正面冲突，bundle 也白白胖一圈（现约 3.3MB）。
 * ⇒ 这一刀**借的是模式，不是依赖**：照着聊天链的骨架自己写这几条规则，零新依赖、零新色值。
 *
 * ⚠️ 改阈值/改断言之前先真机看一眼：气泡的观感是**目检项**，自动化只能钉住「这两条规则还在」，
 * 钉不住「好不好看」——这正是用户这一条反馈的原话（「感觉不太行」）。
 */
import { describe, expect, it } from "vitest";
import { countNeedle, ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

const CARD = styleSource("agent-pane.css");
const TPL = templateSource("components/AgentTimeline.vue");

/** 色值字面量（十六进制 / rgb / rgba）——新规则一个都不许写，全走 token 与 color-mix。 */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

/** 阴影层数：`var(--shadow-color)` 在一段 box-shadow 里出现的次数。 */
function shadowLayers(block: string): number {
  return (block.match(/var\(--shadow-color\)/g) ?? []).length;
}

describe("对话链 · 手机式人机气泡链（2026-10-17 用户裁定）", () => {
  it("助手那一行挂一枚头像，且排在正文之前（模板层）", () => {
    expect(countNeedle('class="message-avatar"', TPL), "助手头像没挂，或挂在两处").toBe(1);
    const lineAt = TPL.indexOf('class="message-line"');
    const avatarAt = TPL.indexOf('class="message-avatar"');
    const bodyAt = TPL.indexOf('class="message-body"');
    expect(lineAt, '模板里找不到 class="message-line"').toBeGreaterThan(-1);
    expect(avatarAt, "头像不在 .message-line 里").toBeGreaterThan(lineAt);
    expect(bodyAt, "头像排在正文之后——链上那一枚会掉到气泡下面").toBeGreaterThan(avatarAt);
  });

  it("自己的话换成 row-reverse：头像落右端、气泡贴右", () => {
    expect(
      ruleBlock(CARD, ".user-line"),
      "没有 row-reverse 时自己的话与助手的话都从左边开始，屏上就没有「谁说的」这一层了"
    ).toContain("flex-direction: row-reverse");
  });

  it("那枚「你」是一个圆头像，不是第二枚标签", () => {
    const tag = ruleBlock(CARD, ".user-tag");
    expect(tag).toContain("border-radius: 50%");
    expect(tag).toContain("width: 26px");
    expect(tag).toContain("height: 26px");
    expect(tag, "头像的底色与字色必须是那一对 solid/contrast，否则暗色皮肤下会糊成一块").toContain(
      "var(--neutral-solid)"
    );
    expect(tag).toContain("var(--neutral-solid-contrast)");
  });

  it("自己的话裹成气泡：底色 + 圆角 + 内边距 + 收窄，且仍是可断行的 flex item", () => {
    const user = ruleBlock(CARD, ".user-text");
    expect(user).toMatch(/background:/);
    expect(user).toContain("border-radius");
    expect(user).toContain("padding:");
    expect(user, "没有 max-width 时一条长问句会拉满整列，读起来不是气泡是通栏").toContain(
      "max-width:"
    );
    expect(user, "机制必需，原样保留：掀掉 flex 的自动地板，粘过来的长链接才断得开").toContain(
      "min-width: 0"
    );
    expect(
      user,
      "断长词靠祖先那条 overflow-wrap: break-word；这里再写一条 anywhere 就是第二份实现"
    ).not.toContain("overflow-wrap: anywhere");
  });

  it("助手那一行是并排的两列：头像不缩 + 正文按内容收缩", () => {
    expect(ruleBlock(CARD, ".message-line")).toContain("display: flex");
    const avatar = ruleBlock(CARD, ".message-avatar");
    expect(avatar, "少了这一行头像会被长正文挤扁").toContain("flex: 0 0 auto");
    expect(avatar).toContain("border-radius: 50%");
    expect(avatar).toContain("width: 26px");
    const body = ruleBlock(CARD, ".message-line .message-body");
    expect(
      body,
      "父级那条 .message-body{width:100%} 会赢：不写回 auto 的话短回复也成一张通栏大卡"
    ).toContain("width: auto");
    expect(body).toContain("border-radius");
    expect(body).toMatch(/background:/);
  });

  it("过程块缩进到助手那一列（头像 26 + 间隙 10 = 36），别顶格成「另一个人的发言」", () => {
    expect(
      ruleBlock(CARD, '.agent-block:not([data-kind="user"]):not([data-kind="message"])'),
      "思考/计划/工具卡从 x=0 开始，而正文裹在气泡里从 36px 开始——同一条链上两种左边距"
    ).toContain("padding-left: 36px");
  });

  it("这几条新规则里零色值字面量（全走 token 与 color-mix）", () => {
    const selectors = [
      ".user-line",
      ".user-tag",
      ".user-text",
      ".message-line",
      ".message-avatar",
      ".message-line .message-body"
    ];
    for (const selector of selectors) {
      expect(ruleBlock(CARD, selector), `${selector} 里写了色值字面量`).not.toMatch(COLOR_LITERAL);
    }
  });
});

describe("输入卡装饰 · 2026-10-17 用户裁定「缺少一些东西」", () => {
  it("卡面是三层阴影（贴沿 + 中景 + 远景），不是一层糊到底", () => {
    expect(
      shadowLayers(ruleBlock(CARD, ".composer-input-surface")),
      "阴影掉回两层时卡只有贴着边沿的一圈硬边，远处不扩散——屏上那张卡就「浮不起来」"
    ).toBeGreaterThanOrEqual(3);
  });

  it("聚焦态仍是同一条 box-shadow 规则、也有三层（主题层不许抢这层阴影）", () => {
    const focus = ruleBlock(CARD, ".composer:focus-within .composer-input-surface");
    expect(focus).toContain("box-shadow");
    expect(
      shadowLayers(focus),
      "聚焦只比常态多一点点的话，输入时看不出卡被「点亮」"
    ).toBeGreaterThanOrEqual(3);
  });

  it("正文与工具条之间有一条发丝分隔线", () => {
    expect(
      ruleBlock(CARD, ".composer-toolbar"),
      "上下两段同一种底色时整卡读成一块没有结构的白板——用户说的「缺少东西」就是这一格"
    ).toContain("border-top:");
  });

  it("发送键有手感：悬停抬一层、按下收回、还有 focus-visible 环", () => {
    const send = ruleBlock(CARD, ".send-button");
    expect(send).toContain("var(--neutral-solid)");
    expect(send).toContain("var(--neutral-solid-contrast)");
    expect(send).toContain("transition:");
    expect(CARD).toContain(".send-button:hover:not(:disabled)");
    expect(CARD).toContain(".send-button:active:not(:disabled)");
    expect(CARD, "键盘走到发送键时没有环，等于看不见焦点在哪").toContain(
      ".send-button:focus-visible"
    );
  });

  it("圆钮补上过渡与 focus-visible（两枚圆钮与发送键同一形状，不该只有一枚有手感）", () => {
    expect(ruleBlock(CARD, ".round-tool-button")).toContain("transition:");
    expect(CARD).toContain(".round-tool-button:focus-visible");
  });
});

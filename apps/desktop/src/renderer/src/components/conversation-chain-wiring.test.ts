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
import fs from "node:fs";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  styleSource,
  templateSource
} from "../utils/vue-source-reader";

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

  it("那枚「你」是一个圆头像，不是第二枚标签（2026-10-25 用户批注：圆标里换成真的头像）", () => {
    const tag = ruleBlock(CARD, ".user-tag");
    expect(tag).toContain("border-radius: 50%");
    expect(tag).toContain("width: 26px");
    expect(tag).toContain("height: 26px");
    // 圆裁由**这层**做：图铺满圆框、多余的裁掉。不在图上做圆角的话边缘会留锯齿。
    expect(tag, "圆裁没做在这一层 ⇒ 头像的四角会露出方角").toContain("overflow: hidden");
    // 底色与字色留着当兜底：图没加载出来时（离线 / 缓存失效）它就是那枚深色圆标。
    expect(tag, "兜底底色必须是那一对 solid/contrast，否则暗色皮肤下会糊成一块").toContain(
      "var(--neutral-solid)"
    );
    expect(tag).toContain("var(--neutral-solid-contrast)");
  });

  it("圆标里挂的是真头像：模板接了资产文件，资产在盘上", () => {
    const tpl = templateSource("components/AgentTimeline.vue");
    const script = scriptSource("components/AgentTimeline.vue");
    expect(tpl, "圆标里没有头像那张图").toContain('class="user-tag-image"');
    expect(tpl, "头像没接上那张图").toContain(':src="userAvatar"');
    // alt 保留原来的语义：这一格说的是「这是你自己说的话」。
    expect(tpl).toMatch(/class="user-tag-image"[^>]*alt="你"/);
    expect(script).toContain('import userAvatar from "../assets/avatar/user-avatar.png"');
    // 资产真的在盘上（引一个不存在的文件不会在构建期报错，只会在屏上出现一枚空圆）。
    expect(
      fs.existsSync(new URL("../assets/avatar/user-avatar.png", import.meta.url)),
      "assets/avatar/user-avatar.png 不在盘上"
    ).toBe(true);
  });

  it("头像那张图铺满圆框、不拉伸（object-fit: cover）", () => {
    const image = ruleBlock(CARD, ".user-tag-image");
    expect(image).toContain("width: 100%");
    expect(image).toContain("height: 100%");
    expect(image, "不裁切的话方图会被拉成椭圆").toContain("object-fit: cover");
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

  it("2026-11-09 参考图②：卡内不再画正文与工具条的分区线", () => {
    // 2026-10-17 的发丝线曾被用来解决「上下同底色读成一块白板」；参考图②的形态是
    // 一块连续的玻璃面 + 20px 内边距分段，所以这一刀把线撤掉，改由内边距承担节奏。
    expect(
      ruleBlock(CARD, ".composer-toolbar"),
      "参考图②里输入区与工具行之间没有线；还有 border-top 就是两套形态叠在一起"
    ).not.toContain("border-top:");
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

  // ===== 2026-10-17 用户上传设计稿（「玻璃拟态梦幻版 AI 输入框」）· 原话「用这个对话框」=====
  // 只落地卡片本体：设计稿的极光背景 / 光斑 / 星点是演示页画布，归皮肤广场，不在这一刀。
  // 尺寸与形状照设计稿逐字，颜色一律 token / color-mix（卡段零色值字面量硬门禁）。

  it("2026-11-09 参考图②：卡是 16px 圆角的玻璃面，顶沿有一道高光，三层景深仍在", () => {
    const surface = ruleBlock(CARD, ".composer-input-surface");
    expect(surface, "参考图②的卡是 16px 圆角（原 28px 的胶囊感撤掉）").toContain(
      "border-radius: 16px"
    );
    expect(
      surface,
      "玻璃卡的顶沿高光（设计稿的 inset 0 1px 0 rgba(255,255,255,.7)）没落成 token 消费"
    ).toContain("var(--glass-highlight)");
    expect(shadowLayers(surface), "顶沿高光不许把三层景深挤掉").toBeGreaterThanOrEqual(3);
  });

  it("2026-11-09 参考图②：工具条 48px 高，卡内无分区线", () => {
    const bar = ruleBlock(CARD, ".composer-toolbar");
    expect(bar, "参考图②的按钮行贴着输入区，工具条收到 48px").toContain("min-height: 48px");
    expect(bar, "参考图②里没有分区线").not.toContain("border-top:");
  });

  it("参考图②：发送键 34×34、两枚圆钮 38×38（圆钮命中区不变）", () => {
    const send = ruleBlock(CARD, ".send-button");
    expect(send, "参考图②的发送键是与麦克风同档的圆钮，不是卡上最大的面").toContain("width: 34px");
    expect(send).toContain("height: 34px");
    const round = ruleBlock(CARD, ".round-tool-button");
    expect(round, "加号 / 麦克风的 38×38 命中区不动").toContain("width: 38px");
    expect(round).toContain("height: 38px");
  });

  it("输入行没有装饰斜杠（2026-10-24 用户点名撤掉）：模板与样式表两处都不许再有它", () => {
    const m = templateSource("components/ComposerBox.vue");
    // 设计稿那个 `/` 前缀原先挂在这里；真机上它读起来像「我自己打了一个斜杠」，故撤。
    expect(countNeedle('class="composer-prefix"', m)).toBe(0);
    expect(m, "前缀撤了，输入框得还在").toContain('class="composer-textarea"');
    // 反向：样式表里那条只为它存在的规则也要一起删干净（否则是没人消费的死规则）。
    // 用剥注释版读：那条规则旁边就写着「`.composer-prefix` 随之删除」，原文读法会被这句注释反咬。
    expect(strippedStyleSource("agent-pane.css")).not.toContain(".composer-prefix");
  });

  it("设计稿：玻璃落在主题层——surface 已移出不透明组，另起一条同特异性规则", () => {
    const theme = styleSource("theme-runtime.css");
    const block = ruleBlock(theme, "html[data-theme] .composer-input-surface");
    expect(block, "玻璃底色走皮肤运行时 token").toContain("var(--skin-glass-card-fill)");
    expect(block, "模糊要真的戴上").toContain("backdrop-filter");
    expect(block).toContain("var(--skin-glass-sheen, none)");
    // 反向钉：它不许再躺在那条不透明 `:where(...)` 组里（否则玻璃永远被压掉）。
    expect(theme).not.toMatch(/:where\(\s*\.composer-input-surface/);
  });

  it("设计稿：激活 chip 是发光胶囊，深度紫 / 联网蓝各一枚光晕", () => {
    const interaction = styleSource("interaction.css");
    const on = ruleBlock(interaction, '.composer-chip[aria-pressed="true"]');
    expect(on, "设计稿激活态是 999px 胶囊").toContain("border-radius: 999px");
    expect(on).toContain("var(--glass-highlight)");
    const deep = ruleBlock(
      interaction,
      '.composer-chip[data-chip="thinking"][aria-pressed="true"]'
    );
    expect(deep, "深度那一枚用 --glow-deep 的紫光晕").toContain("var(--glow-deep)");
    const net = ruleBlock(
      interaction,
      '.composer-chip[data-chip="web-search"][aria-pressed="true"]'
    );
    expect(net, "联网那一枚用 --glow-net 的蓝光晕").toContain("var(--glow-net)");
  });

  // ===== 2026-10-17 用户上传截图（框住占位文字的那圈青绿方框）· 原话「这个框，不要」=====
  // 病灶是**特异性**，不是「没写」：全局 `styles.css` 那条 `textarea:focus-visible`（0,1,1）压过
  // 卡段的 `.composer-textarea { outline: none }`（0,1,0），所以那句 outline: none 从来没生效过——
  // 鼠标一点输入行，Chromium 就照全局那条给 textarea 画一圈 2px 方框（真机读数：方角、offset 1px、
  // color-mix(--focus 55%)，正是用户截图上那一圈）。收在**同一级**（也带伪类）才压得回去。
  it("输入框自己不画焦点环：点一下不许在卡里弹出一圈方框", () => {
    expect(
      styleSource("../styles.css"),
      "全局那条 textarea 焦点环是对话框表单字段的，它得留着（对话框字段没有光标，环是唯一提示）"
    ).toContain("textarea:focus-visible");
    expect(
      ruleBlock(CARD, ".composer-textarea:focus-visible"),
      "本卡没在自己的这一级把环收掉：光写 `.composer-textarea { outline: none }` 压不住全局那条伪类规则，点一下输入行就会弹出一圈方框"
    ).toContain("outline: none");
  });
});

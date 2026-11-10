/// <reference types="node" />
/**
 * 「对话自动往下拉」的接线契约（2026-11-10 用户原话：「对话自动往下拉」）。
 *
 * 本仓零 jsdom，`.vue` 连类型检查都没有——**滚动这件事在测试里跑不起来**，
 * 能钉的只有「接线有没有接上」与「有没有踩那三个已知的坑」。三个坑都是真机上量出来的：
 *
 * ① watch 的对象错了：`useAgentStore` 收 delta 是 `thread.streaming[deltaKind] += text`（就地改写），
 *    引用自始至终不变 ⇒ `watch(() => tail.value)` 一次都不响，跟随「写好了但不动」。
 *    能变的是**长度**，所以判据必须读 `.length`。
 * ② 卸载没摘 rAF：`requestAnimationFrame` 的句柄不随组件死掉，
 *    设置中心整页化会把中栏卸载（`App.vue` 的 `centerView === 'chat'`），
 *    留下的那一帧回调会对着已经卸掉的 DOM 写 `scrollTop`。
 * ③ 钮挂错了层：那枚「回到最新」若挂在滚动容器内部，用户一往上滚它就跟着滚出视口——
 *    而它只在那时才有用。所以它必须挂在 `scroll-shell` 上、且 `position: absolute`。
 *
 * 另外钉一条**不许**的事：跟随不许用 `scrollIntoView`。它会连同祖先一起滚
 * （中栏外面还有一层布局容器），而且默认带平滑动画——正在吐字时每帧一次，
 * 比直接跳更抖（真机推演过，见 `utils/stick-to-bottom.ts` 的注释）。
 */
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  templateSource
} from "../utils/vue-source-reader";

const COLUMN = "components/CenterColumn.vue";
const CSS = "conversation-pane.css";

describe("中栏 · 自动跟随的接线", () => {
  it("滚动容器自己报滚动（贴不贴底只能从它身上读）", () => {
    const template = templateSource(COLUMN);
    // 按 ref 认标签，不按 class：`.conversation-scroll-shell` 的前缀与它一字不差，按 class 抓会抓到外壳。
    const tag = /<div[^>]*ref="scrollEl"[^>]*>/.exec(template)?.[0];
    expect(tag, "模板里找不到挂着 scrollEl 的那个容器").toBeDefined();
    expect(tag).toContain('class="conversation-scroll');
    // passive：滚动是高频事件，监听里也不 preventDefault——挂上去不该拖慢滚动本身。
    expect(tag).toContain('@scroll.passive="onConversationScroll"');
  });

  it("watch 的是内容形状（长度），不是那个就地改写的流式对象", () => {
    const script = scriptSource(COLUMN);
    expect(script).toMatch(/watch\(\s*streamShape,/);
    // 三个长度都得读：正文、思考、条目数各是一条会改变底部位置的通路。
    expect(script).toContain("messageChars: tail.value.message.length");
    expect(script).toContain("reasoningChars: tail.value.reasoning.length");
    expect(script).toContain("itemCount: items.value.length");
    // 反向钉死：watch 那个对象等于没写（引用不变，一次都不会响）。
    expect(script).not.toMatch(/watch\(\s*\(\) => tail\.value/);
    expect(script).not.toMatch(/watch\(\s*tail\s*,/);
  });

  it("贴底只在一帧里做一次，且不做平滑滚动", () => {
    const script = scriptSource(COLUMN);
    expect(script).toContain("requestAnimationFrame");
    // 帧句柄重复进队会让一次 delta 被贴好几次，位置反而落后。
    expect(script).toContain("if (pinFrame !== 0) return;");
    // 跟随不许用 scrollIntoView：它会连祖先一起滚，且默认平滑（见文件头第 3 段）。
    expect(script).not.toContain("scrollIntoView");
    expect(script).not.toMatch(/behavior:\s*["']smooth["']/);
  });

  it("松手之后不抢滚动条，改成亮一枚能回去的钮", () => {
    const script = scriptSource(COLUMN);
    // 只有「不贴着底」时才置位，且只在跑的时候——回放历史不该弹「有新内容」。
    expect(script).toContain("if (running.value) unseenBelow.value = true;");
    const template = templateSource(COLUMN);
    const tag = /<button[^>]*class="scroll-to-bottom"[^>]*>/.exec(template)?.[0];
    expect(tag, "模板里找不到「回到最新」那枚钮").toBeDefined();
    // 有条件的钮：常驻的话就是一枚「底部什么都没长」时也在的假按钮。
    expect(tag).toContain('v-if="unseenBelow"');
    expect(tag).toContain('@click="jumpToBottom"');
  });

  it("发送时强制回到最新：自己那句必须在眼前", () => {
    const body = /function onComposerSend\(text: string\): void \{([\s\S]*?)\n\}/.exec(
      scriptSource(COLUMN)
    )?.[1];
    if (body === undefined) throw new Error("找不到 onComposerSend，判据失效");
    expect(body).toContain("sticking.value = true");
    expect(body).toContain("schedulePin()");
  });

  it("窗口不可见时不指望 rAF（后台不产帧），回前台再补一次", () => {
    // 真机撞到的第二件事：开发窗口被别的窗口挡住时 `visibilityState` 是 hidden，
    // `requestAnimationFrame` 的回调一次也不来——跟随会静静地停住，看起来像「写好了但不动」。
    const script = scriptSource(COLUMN);
    expect(script).toMatch(/if \(document\.visibilityState !== "visible"\) \{/);
    expect(script).toContain('document.addEventListener("visibilitychange", onWindowVisibility)');
    expect(script).toContain(
      'document.removeEventListener("visibilitychange", onWindowVisibility)'
    );
  });

  it("卸载时摘掉挂起的那一帧（设置中心会把中栏整块卸掉）", () => {
    const body = /onBeforeUnmount\(\(\) => \{([\s\S]*?)\}\);/.exec(scriptSource(COLUMN))?.[1];
    if (body === undefined) throw new Error("找不到 onBeforeUnmount，判据失效");
    expect(body).toContain("cancelAnimationFrame(pinFrame)");
  });
});

describe("中栏 · 「回到最新」的落位", () => {
  it("挂在外壳上（不是滚动容器里），靠 absolute 定在右下", () => {
    const block = ruleBlock(strippedStyleSource(CSS), ".scroll-to-bottom");
    expect(block).toContain("position: absolute");
    expect(block).toContain("bottom:");
    /* 「在滚动容器外面」这条只能数标签：从滚动容器开标签到那枚钮之间，
       `<div` 与 `</div>` 必须**配平**——钮要是落在容器里面，就会差一个没收尾的 div。
       光比「谁的下标靠后」证明不了嵌套关系（容器里任何一处内容都在它后面）。 */
    const template = templateSource(COLUMN);
    const ref = template.indexOf('ref="scrollEl"');
    const button = template.indexOf('class="scroll-to-bottom"');
    expect(ref, "模板里找不到滚动容器的 ref").toBeGreaterThan(-1);
    expect(button, "模板里找不到那枚钮").toBeGreaterThan(ref);
    // 切片要从那个 `div` 的开尖括号起算（ref 在标签内部，从 ref 切会少算这一层开标签）。
    const slice = template.slice(template.lastIndexOf("<div", ref), button);
    const opens = (slice.match(/<div\b/g) ?? []).length;
    const closes = (slice.match(/<\/div>/g) ?? []).length;
    expect(closes, "那枚钮还在滚动容器里：用户一往上滚，它自己也跟着滚出去了").toBe(opens);
  });

  it("chevron 是朝右的字形，所以要自己转 90°（不转就是一个指右的箭头写着「回到最新」）", () => {
    const block = ruleBlock(strippedStyleSource(CSS), ".scroll-to-bottom-icon");
    expect(block).toContain("rotate(90deg)");
  });

  it("有出场动效，且用的是本仓那一支（不是另造一帧）", () => {
    const block = ruleBlock(strippedStyleSource(CSS), ".scroll-to-bottom");
    expect(block).toContain("animation: mochen-pop-in");
  });
});

/// <reference types="node" />
/**
 * 对话链的动作条与失败条降调（2026-10-25 · §173）——**接线闸**。
 *
 * ## 这一刀为什么不是「照着 UI 改」
 *
 * 用户原话：「你光参考了 UI，没有参考它的功能，因为我那个对话的功能不全，还有很多问题。」
 * ⇒ 这一族补的是**功能**那一半：
 * ① 复制（助手回复 / 自己那句）——写稿最常干的一件事，而**改之前整仓一次剪贴板都没调过**；
 * ② 改一改再问 / 再问一次——把自己那句填回输入框，改完再发；
 * ③ 失败条降调——已经被后来的成功盖过的失败，不再用红底红字冒充「刚刚炸了」。
 *
 * ## 这条闸守的是什么
 *
 * - **判据只有一份**：动作清单在 `utils/message-actions.ts`，写入剪贴板在 `utils/clipboard.ts`。
 *   组件里不许自己写一份清单，也不许自己调 `navigator.clipboard`（那会变成第二份实现）。
 * - **草稿的唯一写者**：预填走 `useAgentStore.prefillComposer`（F-A 定的纪律）。
 * - **隐形按钮不许吃点击**：操作条平时 `pointer-events: none`，只在悬停/聚焦时可点。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const TIMELINE = "components/AgentTimeline.vue";
const CENTER = "components/CenterColumn.vue";
const CARD = styleSource("agent-pane.css");
/** 「写剪贴板」那一份的真身（反向扫只给它一张豁免票）。 */
const CLIPBOARD = "utils/clipboard.ts";

/** 源码里全部 `.ts` / `.vue`（不含测试文件），路径**相对 src**。 */
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(path.relative(SRC, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * 一份文件的**代码本体**：注释都剥掉。
 *
 * 【为什么必须剥】反向扫「写剪贴板只有那一份」时，注释里那句
 * 「两边各写一遍 `navigator.clipboard.writeText`」会把自己咬住——
 * `utils/clipboard.ts` 的文件头注释里就写着这串字，而 `ExportDialog.vue` 的
 * 行注释里也写着它。第一版没剥，整条反向扫永远红，**红的是解释而不是代码**。
 *
 * 剥法复用读取器那份（铁律 6：剥法只有一份）：`.vue` 取 template（剥 HTML 注释）
 * 与 script（剥 JS 注释）两段，`.ts` 取 `typeScriptSource`。
 */
function codeBody(rel: string): string {
  if (!rel.endsWith(".vue")) return typeScriptSource(rel);
  const parts = [templateSource(rel)];
  if (/<script setup lang="ts">/.test(vueSource(rel))) parts.push(scriptSource(rel));
  return parts.join("\n");
}

describe("动作条 · 判据只有一份（§173）", () => {
  it("组件引的是 utils 那份清单，模板读它，不自己判", () => {
    const script = scriptSource(TIMELINE);
    const tpl = templateSource(TIMELINE);
    expect(script).toContain('from "../utils/message-actions"');
    expect(tpl).toContain("actionsForSpeaker('user')");
    expect(tpl).toContain("actionsForSpeaker('assistant')");
    // 模板里不许再出现一遍文案（那就是第二份判据：改一边忘了另一边，按钮就与清单对不上）。
    expect(tpl, "模板里写了「复制」这个字面量 ⇒ 文案有两份").not.toContain(">复制<");
    expect(tpl, "模板里写了「改一改再问」这个字面量 ⇒ 文案有两份").not.toContain("改一改再问");
  });

  it("复制走 utils/clipboard：成没成两档都有话说，不许假装成功", () => {
    const script = scriptSource(TIMELINE);
    expect(script).toContain('from "../utils/clipboard"');
    expect(script).toContain("copyText(");
    expect(script).toContain("COPY_NOTICES.ok");
    expect(script).toContain("COPY_NOTICES.failed");
  });

  it("反向扫全源码：navigator.clipboard 只许出现在 utils/clipboard.ts 一处", () => {
    // 「写剪贴板只有那一份」最常见的破法是：谁方便谁顺手写一遍 navigator.clipboard.writeText。
    // 那时接线照样是 utils 那份、屏上也照样能复制——但两份实现已经开始漂。
    //
    // 扫的是**剥掉注释后的代码本体**：注释里解释「为什么只留一份」的那段话里
    // 写着这串字，不剥就会把注释当成第二份实现。
    const allowed = CLIPBOARD;
    const hits: string[] = [];
    for (const rel of walk(SRC)) {
      if (rel === allowed) continue;
      if (codeBody(rel).includes("navigator.clipboard")) hits.push(rel);
    }
    expect(hits, `写剪贴板出现了第二份实现：${hits.join("、")}`).toEqual([]);
  });

  it("反向扫的那份豁免是真身：utils/clipboard.ts 里那行代码确实在（豁免不是空口给的）", () => {
    // 上一条给了 utils/clipboard.ts 一张豁免票。豁免票本身也得有人验：
    // 万一哪天它被改成空壳（只剩一个注释说明），「只有一份」就变成「零份」——
    // 屏上复制会静默失效，而反向扫还照样绿。
    expect(typeScriptSource(CLIPBOARD)).toContain("navigator.clipboard.writeText");
  });
});

describe("动作条 · 接线（§173）", () => {
  it("「改一改再问」与「再问一次」走同一条通路：上装层填回输入框", () => {
    const tpl = templateSource(TIMELINE);
    const script = scriptSource(TIMELINE);
    const center = scriptSource(CENTER);
    // 两处都是同一个 emit：模板不许自己写草稿。
    // `emit("prefill")` 在 **script 段**（模板只绑 @click），去 template 里找会永远找不到。
    expect(script).toContain('emit("prefill"');
    expect(tpl).toContain("runAction(action, block.text)");
    expect(tpl, "失败条上的「再问一次」没绑 retryText").toContain("askAgain(block.retryText)");
    // 上装层那侧：接的是 prefill 事件，落点是 store 的预填入口（草稿的唯一写者）。
    expect(templateSource(CENTER)).toContain('@prefill="onPrefillFromTimeline"');
    expect(center).toContain("function onPrefillFromTimeline(");
    expect(center).toContain("agent.prefillComposer(threadKey.value, text)");
  });

  it("失败条上那枚「再问一次」只在有原话时才画（没有原话就没有可重问的东西）", () => {
    const tpl = templateSource(TIMELINE);
    expect(tpl).toContain('v-if="block.retryText"');
  });
});

/**
 * 空正文不挂动作（2026-10-25 · §173，真机复验查出来的）。
 *
 * 真机在这本书的真实历史里翻出**两条空正文的助手消息**（2026-10-08 / 10-09 落盘的那两轮，
 * `text: ""`）。原先动作条照挂 ⇒ 一枚「复制」钮点下去必然失败，只给用户一句「复制失败」。
 *
 * 注意空泡本身**留着**：那一轮什么都没产出，这就是一条看得见的异常
 * （藏起来就变成「助手那轮没来过」）⇒ 藏的是「复制钮」，不是「那一轮」。
 */
describe("动作条 · 空正文不挂（§173 真机复验）", () => {
  it("两侧的动作条都挂在那个判据上（自己那句与助手回复都要）", () => {
    const tpl = templateSource(TIMELINE);
    const script = scriptSource(TIMELINE);
    expect(script).toContain('from "../utils/message-text"');
    expect(script).toContain("hasMessageText");
    // 两处动作条各有一个闸：数出来必须是 2（少一个 ⇒ 有一侧空消息仍挂着复制钮）。
    const gates = tpl.match(/v-if="hasMessageText\(block\.text\)"/g) ?? [];
    expect(gates.length, "两侧动作条都得挂上空判据").toBe(2);
  });

  it("判据引的是 utils 那一份，不许在组件里自己 trim 一遍", () => {
    const script = scriptSource(TIMELINE);
    expect(script, "组件里自己判了一遍空 ⇒ 与写剪贴板那道闸会漂").not.toMatch(
      /block\.text\.trim\(\)\s*===\s*""/
    );
  });
});

describe("失败条降调 · 被盖过的失败不再冒充「刚刚炸了」（§173）", () => {
  it("模板读的是那个布尔，样式层据此换一套", () => {
    const tpl = templateSource(TIMELINE);
    expect(tpl).toContain("'is-stale': block.stale");
    const stale = ruleBlock(CARD, ".error-line.is-stale");
    expect(stale, "降调那一档没有样式").not.toBe("");
    // 红底是「刚刚炸了」的语气：降调那一档必须把底色撤掉。
    expect(stale, "降调那一档还留着红底").not.toContain("danger-soft");
    expect(stale, "降调那一档还留着红字").not.toContain("danger-text");
  });

  it("降调不是隐藏：底色撤了，字还在（失败必须看得见）", () => {
    const stale = ruleBlock(CARD, ".error-line.is-stale");
    expect(stale).toContain("background: none");
    expect(stale).toContain("border-left");
  });

  it("降调那一档的「再问一次」也跟着降调（条子不喊了，按钮不该还红着）", () => {
    const tone = ruleBlock(CARD, ".error-line.is-stale .error-retry");
    expect(tone, "降调那一档的按钮没有单独降调").not.toContain("danger-text");
  });
});

describe("动作条 · 隐形时不许吃点击（§173）", () => {
  it("平时 pointer-events: none，悬停/聚焦才可点", () => {
    const actions = ruleBlock(CARD, ".message-actions");
    expect(actions, "操作条没有 pointer-events 那一档").toContain("pointer-events: none");
    expect(CARD, "悬停/聚焦那一档没有把点击还回来").toMatch(
      /\.message-actions:focus-within\s*\{[^}]*pointer-events:\s*auto/
    );
    expect(CARD, "悬停那一档没有把点击还回来").toMatch(
      /\.agent-block:hover \.message-actions,\s*\.message-actions:focus-within\s*\{[^}]*pointer-events:\s*auto/
    );
  });

  it("自己那一侧的操作条靠右（气泡本来就靠右）", () => {
    expect(ruleBlock(CARD, ".message-actions--right")).toContain("justify-content: flex-end");
  });
});

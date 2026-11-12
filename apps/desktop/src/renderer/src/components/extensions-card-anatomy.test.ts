import { describe, expect, it } from "vitest";
import { ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

/**
 * 卡片解剖（2026-11-12）：技能库/插件两页的卡片，一行字该按什么顺序读。
 *
 * 真机上撞到的两件事，都不是「不够好看」，是**读不出来**：
 *
 * ① 出处排在标题与说明之间。市场条目的出处是「改编自 zenstory-ai/oh-story-claudecode 的
 *    story-long-write（章纲） · MIT」，在 269px 的卡里折成三行小灰字——于是「这枚技能是干什么的」
 *    被压到第四行之后，一卡七行灰字，分不清哪句是描述、哪句是版权。量到的距离：
 *    标题底 → 说明顶 48px，全是出处。
 *
 * ② 31 张卡左上都是同一枚书册图标。重复 31 次的零信息——而真正的分类（构思/结构/文风/校对/资料）
 *    被放在卡片最下面一行。现在左上按分类取六枚之一，扫一列卡片就知道哪一种活最多。
 */

/** 卡片 `<li>` 那一块：从 v-for 起，到紧跟的 `</li>` 止。 */
function cardBlock(markup: string, marker: string): string {
  const start = markup.indexOf(marker);
  expect(start, `模板里没有 ${marker}`).toBeGreaterThan(-1);
  const end = markup.indexOf("</li>", start);
  expect(end, `${marker} 那块没有收尾`).toBeGreaterThan(start);
  return markup.slice(start, end);
}

describe("技能卡/插件卡 · 一行字的读法", () => {
  const markup = templateSource("components/ExtensionsPage.vue");

  it("说明排在出处之前：先读「它干什么」，再读「它从哪来」", () => {
    const block = cardBlock(markup, 'v-for="row in skillRows"');
    const desc = block.indexOf("extension-card-desc");
    const origin = block.indexOf("extension-card-origin");
    expect(desc, "技能卡那块没有说明").toBeGreaterThan(-1);
    expect(origin, "技能卡那块没有出处").toBeGreaterThan(-1);
    expect(origin, "出处又跑到说明前面去了").toBeGreaterThan(desc);
  });

  it("插件卡不另写出处：标签「内置 · 第 2 版」已经说了同一件事", () => {
    const block = cardBlock(markup, 'v-for="one in pluginRows"');
    expect(block, "插件卡多了一条重复的出处").not.toContain("extension-card-origin");
  });

  it("出处不再挂在标题列里（挂回去就会把说明顶到第三行之后）", () => {
    const titles = [...markup.matchAll(/<div class="extension-card-title">([\s\S]*?)<\/div>/g)].map(
      (one) => one[1] ?? ""
    );
    expect(titles.length, "没找到标题列").toBeGreaterThan(0);
    for (const title of titles) {
      expect(title, "标题列里又塞进了出处").not.toContain("extension-card-origin");
    }
  });

  it("技能卡的图标按分类取，不是每张都画书册", () => {
    const block = cardBlock(markup, 'v-for="row in skillRows"');
    expect(block).toContain("skillCategoryIcon(row.categoryLabel)");
    expect(block, "又写死成一枚图标了").not.toContain('name="library"');
  });

  it("插件卡不再用加号：加号读作「添加」，而这一页列的是已经装上的", () => {
    const block = cardBlock(markup, 'v-for="one in pluginRows"');
    expect(block).not.toContain('name="plus"');
    expect(block).toContain('name="bot"');
  });

  it("出处仍是一字不截的一段（挪了位置，没有顺手加回截断）", () => {
    const origin = ruleBlock(styleSource("extensions.css"), ".extension-card-origin");
    expect(origin).not.toContain("text-overflow");
    expect(origin).not.toContain("-webkit-line-clamp");
    // 成了独立的一段：<p> 自带外边距会把这一行从上一段推开，必须归零。
    expect(origin).toContain("margin: 0;");
  });

  it("「挂入」按下去要有按下态：四枚钮里只有它带 aria-pressed", () => {
    const css = styleSource("extensions.css");
    const pressed = ruleBlock(css, '.extension-btn[aria-pressed="true"]');
    expect(pressed, "按下态用了 accent 之外的语义色").toContain("var(--accent)");
    // 基态不写 accent：否则没挂入的那几枚也跟着「生效」起来。
    expect(ruleBlock(css, ".extension-btn")).not.toContain("var(--accent)");
  });
});

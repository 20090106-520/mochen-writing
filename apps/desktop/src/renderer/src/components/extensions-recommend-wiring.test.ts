import { describe, expect, it } from "vitest";
import { scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

/**
 * 技能页「推荐」那条的**接线契约**（2026-10-17）。
 *
 * 打分与装配的判定在 `utils/skill-pick.ts`（20 条单测）与
 * `stores/useExtensionBrowse.recommend.test.ts`（5 条单测）里，本文件只钉「接没接上」：
 * ① 推荐现场三项（阶段名 / 文稿类 / 指令）真的从各自真身现取，没被写成常量；
 * ② 清单来自 `browse.skillRecommendations`，模板只 v-for；
 * ③ 挂入按钮走**唯一挂入真身** `useAgentStore.toggleSkillForThread`，且只在点击时发生——
 *    script 里一次都不许出现它（出现了就意味着有「自动挂入」的副作用，那越过了用户批准）。
 *
 * 读法走 vue-source-reader（剥注释），否则「这里没有 X」这句注释本身会凑出 X。
 */
const pageScript = scriptSource("components/ExtensionsPage.vue");
const pageTpl = templateSource("components/ExtensionsPage.vue");
const css = styleSource("extensions.css");

describe("推荐条接在哪", () => {
  it("清单来自 browse.skillRecommendations（判定在 store，模板只 v-for）", () => {
    expect(pageScript).toContain("browse.skillRecommendations({");
    expect(pageTpl).toContain('v-for="rec in recommendations"');
    expect(pageTpl).toContain('v-if="recommendations.length > 0"');
  });

  it("推荐现场三项各自取自真身：阶段名 / 文稿类 / 本线程指令", () => {
    expect(pageScript).toContain('stageName: activeStageOf(book.meta)?.name ?? ""');
    expect(pageScript).toContain(
      "docKind: book.docs.find((one) => one.relPath === book.activeDocTab)?.kind ?? null"
    );
    expect(pageScript).toContain("instruction: agent.draftOf(threadKey.value)");
    expect(pageScript).toContain("pinned: agent.skillPathsOf(threadKey.value)");
    expect(pageScript).toContain("library: agent.skills");
  });

  it("挂入只在点击里发生：按钮走唯一真身，script 里一次都不出现 toggleSkillForThread", () => {
    expect(pageTpl).toContain('@click="agent.toggleSkillForThread(threadKey, rec.id)"');
    expect(pageScript).not.toContain("toggleSkillForThread");
  });

  it("推荐给的是「为什么」不是空标签：理由摆上屏", () => {
    expect(pageTpl).toContain("rec.reasons.join(");
  });

  it("推荐条自己有样式，不与全库网格混成一格", () => {
    expect(css).toContain(".extensions-recommend-item");
    expect(css).toContain(".extensions-recommend-why");
  });
});

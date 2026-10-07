import { describe, expect, it } from "vitest";
import { MARKET_CATEGORIES, marketSkillSchema, type MarketSkill } from "@mochen/contracts";
import { parseFrontmatter } from "@mochen/fs-store";
import { SKILL_CATALOG } from "./skill-catalog.js";
import { IDEA_SKILLS } from "./skill-catalog-idea.js";
import { STRUCTURE_SKILLS } from "./skill-catalog-structure.js";
import { STYLE_SKILLS } from "./skill-catalog-style.js";
import { PROOF_SKILLS } from "./skill-catalog-proof.js";
import { RESEARCH_SKILLS } from "./skill-catalog-research.js";

/**
 * 清单本身的守卫（2026-10-07 写；5-㊱ 清单从 5 条扩到 20 条后重写了出处那两条）。
 *
 * 清单是**代码里的常量**，所以它不会被类型系统保护到「写得对」这一层：
 * 一条 origin 写空、目录名重名、正文不是 SKILL.md 的形状，全都能编译通过，
 * 装出去之后才在用户磁盘上炸。这一层把它们提前挡在代码里。
 *
 * 【为什么用 `parseFrontmatter` 而不是测试里再写一个 frontmatter 解析】
 * fs-store 那份是全仓唯一的实现（铁律 6）。这里自己切一遍 `---`，就会多出第二份
 * 「什么算 frontmatter」的判定，将来那份改了这份不跟着。
 *
 * 【下面这三份常量是**规则**，故意不 import 生产代码那一份】
 * 5-㊱ 之前，这条守卫是「origin 里含 dsh-skills 或 superpowers ⇒ MIT，否则本仓自有」。
 * 清单扩到 20 条、来自五个仓库之后那个判据立刻作废了，而它作废的方式很安静：
 * 新抄来的那些 origin 不含那两个名字，于是被判成「本仓原创」，
 * 守卫照样全绿，**代价是十几条抄来的技能全部冒领了「本仓自有」**。
 *
 * 所以判据换成了**前缀**：开头是「本仓原创」才算原创，否则必须是「改编自 <仓库> 的 …」。
 * 而这三个字面量**在这里另写一份**，不从 `skill-catalog-origins.ts` import：
 * 那份是被测代码，它今天写「本仓原创」、明天改成「本厂自研」，
 * 从它 import 的守卫会跟着改，然后继续全绿——**一个会跟着被测对象一起改的守卫不是守卫。**
 */

/** 原创的出处前缀。规则写在测试里，不从生产代码 import（理由见文件头）。 */
const OWN_PREFIX = "本仓原创";
/** 原创那几条的许可。 */
const OWN_LICENSE = "本仓自有";
/** 抄来的那几条统一照抄上游的许可（`skill-catalog-origins.ts` 的 `UPSTREAM` 里都是 MIT）。 */
const UPSTREAM_LICENSE = "MIT";

/** 这一条是原创的吗。**判据只有这一个**：出处开头的那个前缀。 */
function isOwn(skill: MarketSkill): boolean {
  return skill.origin.startsWith(OWN_PREFIX);
}

/**
 * 从出处里取上游仓库名（`改编自 <owner>/<repo> 的 …` 里 `/` 后面那一段）。
 * 取不到就是空串——**空串会让下面「正文里写明出处」那条直接红**，这正是要的：
 * 抄来的却没写清哪个仓库，用户读到的是一份说不出作者的文字。
 */
function upstreamRepo(origin: string): string {
  return /\/([A-Za-z0-9._-]+)/.exec(origin)?.[1] ?? "";
}

describe("SKILL_CATALOG", () => {
  it("每一条都过清单形状守卫（目录名、分类、出处、许可是必填）", () => {
    for (const skill of SKILL_CATALOG) {
      expect(marketSkillSchema.safeParse(skill), `${skill.dirName} 过不了形状守卫`).toEqual({
        success: true,
        data: skill
      });
    }
  });

  it("目录名不许重名：装出去就是一个目录，重名会让后一条永远装不上", () => {
    const names = SKILL_CATALOG.map((s) => s.dirName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("正文第一行就是 frontmatter 起点——装出去要能被 scanSkills 当技能读", () => {
    for (const skill of SKILL_CATALOG) {
      expect(skill.skillMd.startsWith("---\n"), `${skill.dirName} 的正文不是 SKILL.md 的形状`).toBe(
        true
      );
      expect(parseFrontmatter(skill.skillMd).body.trim(), `${skill.dirName} 没有正文`).not.toBe("");
    }
  });

  it("frontmatter 的 name 与清单的 displayName 必须是同一个——卡片与磁盘上不许两套名字", () => {
    for (const skill of SKILL_CATALOG) {
      const { data } = parseFrontmatter(skill.skillMd);
      expect(data.name, `${skill.dirName} 的 frontmatter name`).toBe(skill.displayName);
    }
  });

  it("frontmatter 的 description 就是那句 summary：读技能时看到的那句话与卡片上的一致", () => {
    for (const skill of SKILL_CATALOG) {
      const { data } = parseFrontmatter(skill.skillMd);
      expect(data.description, `${skill.dirName} 的 frontmatter description`).toBe(skill.summary);
    }
  });

  it("每个分类至少有一条：筛选条上那枚 chip 若永远点出空表，就是一枚死 chip", () => {
    for (const category of MARKET_CATEGORIES) {
      expect(
        SKILL_CATALOG.filter((s) => s.category === category).length,
        `分类「${category}」下没有技能`
      ).toBeGreaterThan(0);
    }
  });

  it("出处只有两种：开头是「本仓原创」，否则必须写成「改编自 <仓库> 的 <那一条>」", () => {
    for (const skill of SKILL_CATALOG) {
      if (isOwn(skill)) continue;
      expect(
        skill.origin,
        `${skill.dirName} 的出处既不是本仓原创，也没写成「改编自 <仓库> 的 <那一条>」`
      ).toMatch(/^改编自 \S+\/\S+ 的 \S+/);
      expect(upstreamRepo(skill.origin), `${skill.dirName} 的出处里取不到仓库名`).not.toBe("");
    }
  });

  it("本仓原创的许可是「本仓自有」，抄来的照抄上游许可——两头都不许含糊", () => {
    for (const skill of SKILL_CATALOG) {
      expect(skill.license, `${skill.dirName} 的许可`).toBe(
        isOwn(skill) ? OWN_LICENSE : UPSTREAM_LICENSE
      );
    }
    // 反向钉：冒领比含糊更坏。上一版守卫正是栽在这里——判据只认两个仓库名，
    // 于是所有不在那两个名字里的抄来条目都被放行成「本仓自有」，而守卫全绿。
    const claimedOwn = SKILL_CATALOG.filter(
      (s) => s.origin.startsWith("改编自") && s.license === OWN_LICENSE
    );
    expect(
      claimedOwn.map((s) => s.dirName),
      "有抄来的条目冒领了本仓自有"
    ).toEqual([]);
  });

  it("正文里写明出处：用户在技能库里读到的是「谁写的」，不是一段认不出来源的文字", () => {
    for (const skill of SKILL_CATALOG) {
      const { body } = parseFrontmatter(skill.skillMd);
      // 抄来的认仓库名，原创的认前缀——**判据跟着上面那个 isOwn 走**，
      // 不另写一份「哪些仓库算抄来的」。那份名单每加一个上游就要改一次，
      // 而漏改的那个会把新抄来的那条悄悄算成原创。
      const keyword = isOwn(skill) ? OWN_PREFIX : upstreamRepo(skill.origin);
      expect(body, `${skill.dirName} 的正文里没有交代出处`).toContain(keyword);
    }
  });

  it("正文里不许出现上游的命令名：墨宸没有那些通路，写进去等于教模型去调不存在的东西", () => {
    for (const skill of SKILL_CATALOG) {
      const { body } = parseFrontmatter(skill.skillMd);
      // oh-story 那套靠 `/story-long-write`、`$story-setup` 与 shell hook 协作，
      // 本仓的流程在软件里、不在命令行上。抄进来之后模型会照着找一个不存在的命令，
      // 而用户看到的只是一段「照着做就行」的说明。
      expect(body, `${skill.dirName} 的正文里带着上游的 slash 命令`).not.toMatch(
        /\/story-|\$story-|\/browser-cdp|storyctl\.py|tracking_commit\.py/
      );
    }
  });

  it("出处里不许带许可：卡片那一行是「出处 · 许可」两段拼的，写两遍就是同一行出现两次", () => {
    // 真机症状：出处写成「改编自 …的 story-long-write（MIT，钩子技法）」，
    // 而卡片把 `origin · license` 拼起来显示 ⇒ 用户读到「…（MIT，钩子技法）· MIT」。
    // 那是同一个词在同一行里出现两次，看起来像排版没排好，而不是两个字段各写一遍。
    for (const skill of SKILL_CATALOG) {
      expect(skill.origin, `${skill.dirName} 的出处里混进了许可`).not.toContain(UPSTREAM_LICENSE);
    }
  });

  it("推荐阶段与适用文稿都填了：全空的话那条推荐等于没说", () => {
    for (const skill of SKILL_CATALOG) {
      const { data } = parseFrontmatter(skill.skillMd);
      const stages = data.stage ?? [];
      const appliesTo = data.appliesTo ?? [];
      expect(Array.isArray(stages) && stages.length, `${skill.dirName} 没有 stage`).toBeGreaterThan(
        0
      );
      expect(
        Array.isArray(appliesTo) && appliesTo.length,
        `${skill.dirName} 没有 appliesTo`
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * 拆文件的规矩：一份文件只放一个分类。
 *
 * 为什么值得钉：清单一多，「这一条该放哪」就会变成一个每次都要重想一遍的问题，
 * 而想错的人只会把它放进「读着最顺的那个文件」——于是筛选条上的分类与文件对不上号，
 * 改分类时找不到那条技能。**分类是筛选用的标签，文件是按同一套标签切的，两边必须一致。**
 */
describe("五个分类文件各自只放自己那一类", () => {
  const pairs = [
    { name: "skill-catalog-idea", list: IDEA_SKILLS, category: "构思" },
    { name: "skill-catalog-structure", list: STRUCTURE_SKILLS, category: "结构" },
    { name: "skill-catalog-style", list: STYLE_SKILLS, category: "文风" },
    { name: "skill-catalog-proof", list: PROOF_SKILLS, category: "校对" },
    { name: "skill-catalog-research", list: RESEARCH_SKILLS, category: "资料" }
  ] as const;

  it("每一份里的每一条，category 都与文件名对得上", () => {
    for (const pair of pairs) {
      expect(pair.list.length, `${pair.name} 这一份是空的`).toBeGreaterThan(0);
      for (const skill of pair.list) {
        expect(skill.category, `${skill.dirName} 在 ${pair.name} 里却标着别的分类`).toBe(
          pair.category
        );
      }
    }
  });

  it("五个分类恰好覆盖 MARKET_CATEGORIES：少一个分类就没有文件承接它", () => {
    expect(pairs.map((p) => p.category)).toEqual([...MARKET_CATEGORIES]);
  });

  it("聚合出来的那份与五份拼起来的一样：接错顺序或漏接一份，这里会红", () => {
    expect(SKILL_CATALOG).toEqual(pairs.flatMap((pair) => pair.list as MarketSkill[]));
  });
});

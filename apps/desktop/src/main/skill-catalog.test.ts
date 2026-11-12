import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MARKET_CATEGORIES,
  marketSkillSchema,
  stripSkillOrigin,
  type MarketSkill
} from "@mochen/contracts";
import { parseFrontmatter } from "@mochen/fs-store";
import { SKILL_CATALOG } from "./skill-catalog.js";
import { CATALOG_ENTRIES } from "./skill-catalog-manifest.js";

/**
 * 清单本身的守卫（2026-10-07 写；2026-11-11 数据化后改判数据布局）。
 *
 * 清单的正文来自磁盘上的 md 数据文件、元数据来自 `skill-catalog-manifest.ts`，
 * 类型系统管不到「文件放没放、清单写没写、两处对不对得上」这一层。
 * 装配时 `skill-catalog.ts` 会对每条过 `marketSkillSchema`（缺文件/形状坏当场抛错），
 * 这里钉的是**结构层面**的可失败事：重名、正文形状、frontmatter 一致、
 * 出处句式、许可、以及「数据文件与清单一一对应」。
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

  /**
   * 出处的位置（2026-11-12）。
   *
   * 原先 24 份正文的第二段全是同一句模板：「改编自 <仓库> 的 <那一条>（<说明>，MIT）。
   * 只搬方法，不搬原文。」——句式一模一样，21 份连结尾那半句都逐字相同。模型 use_skill
   * 读一份技能，**第一段读到的不是方法，是版权**；读三份，就把同一句制式话读三遍。
   *
   * 现在出处搬到了文末的「## 出处」，开场第一段就是方法。落盘后的 SKILL.md 是用户盘上的
   * 独立文件（manifest 不跟着走），所以出处必须留在正文里——只是不该占开场。
   */
  it("出处写在文末，不在开场：第一段该是方法", () => {
    for (const skill of SKILL_CATALOG) {
      const { body } = parseFrontmatter(skill.skillMd);
      const lines = body.split("\n");
      // 跳过标题与空行，落在第一段正文上。
      let i = 0;
      let first = lines[i];
      while (first !== undefined && (first.trim() === "" || first.startsWith("#"))) {
        i += 1;
        first = lines[i];
      }
      expect(first ?? "", `${skill.dirName} 又把出处当开场白了`).not.toMatch(/^(改编自|本仓原创)/);
      // 文末必须有这一节：装出去之后它是这份技能唯一的出处记录。
      const tail = body.trimEnd().split("\n").slice(-6).join("\n");
      expect(tail, `${skill.dirName} 的文末没有「## 出处」`).toContain("## 出处");
    }
  });

  it("不再重复那句「只搬方法，不搬原文」：它原先 21 份各一份", () => {
    for (const skill of SKILL_CATALOG) {
      const { body } = parseFrontmatter(skill.skillMd);
      expect(body, `${skill.dirName} 的正文里又出现了那句模板`).not.toContain("只搬方法，不搬原文");
    }
  });

  /**
   * 出处搬到最后，是为了让它在**读给模型**的那一路能被一处规则摘掉（2026-11-12）。
   *
   * `stripSkillOrigin` 只认「文末最后一个小节是 ## 出处」，所以这一条守的是那个前提：
   * 24 份里只要有一份把出处写回了中间（或在后面又加了一节），剥的时候就摘不下来——
   * 而摘不下来不会报错，只会让模型继续读到一段版权声明。守卫必须钉在语料上，
   * 因为将来新增技能时人是照着旧文件抄结构的。
   */
  it("每一份都能被 stripSkillOrigin 摘干净：出处不许跑回中间", () => {
    for (const skill of SKILL_CATALOG) {
      const { body } = parseFrontmatter(skill.skillMd);
      const kept = stripSkillOrigin(body.trim());
      expect(kept, `${skill.dirName} 的出处没被摘掉`).not.toContain("## 出处");
      // 摘掉的必须**只是**出处那一节：方法正文不许跟着少。
      expect(kept.length, `${skill.dirName} 剥出处时吃掉了正文`).toBeGreaterThan(body.length * 0.6);
      expect(kept, `${skill.dirName} 剥完仍旧带着出处句`).not.toContain(skill.origin.slice(0, 8));
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
 * 数据布局的守卫（2026-11-11 数据化后接替原「五个分类文件」那组守卫）。
 *
 * 正文在 `skill-catalog-data/bodies/<分类>/<dirName>.md`，元数据在清单里。
 * 「这条技能的 md 放哪个目录」必须**没有得选**：目录按分类命名、文件用 dirName 命名，
 * 谁也不用每次加技能时重新想一遍「放哪、叫什么」。
 * 「数据文件与清单一一对应」也要钉：清单里写了、文件没放，装配器会抛错，
 * 但**文件放了、清单忘了写**不会抛任何错——那条技能只是安静地消失，
 * 这组守卫里第二条就是为这种事准备的。
 */
describe("数据布局：bodies/ 下的 md 与清单一一对应", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const BODIES_DIR = path.join(HERE, "skill-catalog-data", "bodies");

  it("条目数钉住：加/删技能是有意为之的事，改这个数字之前先过一遍守卫", () => {
    expect(SKILL_CATALOG.length).toBe(24);
  });

  it("每条的正文路径都是「<分类>/<dirName>.md」：md 落哪个目录没有得选", () => {
    for (const entry of CATALOG_ENTRIES) {
      expect(entry.body, `${entry.dirName} 的正文路径`).toBe(
        `${entry.category}/${entry.dirName}.md`
      );
    }
  });

  it("bodies/ 下的 md 与清单双向对齐：孤儿文件（写了没登记）与幽灵条目（登记了没写）都红", () => {
    const onDisk = readdirSync(BODIES_DIR, { recursive: true, encoding: "utf8" })
      .map((rel) => rel.split(path.sep).join("/"))
      .filter((rel) => rel.endsWith(".md"))
      .sort();
    const listed = CATALOG_ENTRIES.map((e) => e.body).sort();
    expect(onDisk, "磁盘上有 md 不在清单里（写了没登记）").toEqual(listed);
    expect(listed, "清单里有条目没有 md（登记了没写）").toEqual(onDisk);
  });

  it("每个分类恰好有一个数据目录：分类目录与 MARKET_CATEGORIES 一一对应", () => {
    const dirs = readdirSync(BODIES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([...MARKET_CATEGORIES].sort());
  });
});

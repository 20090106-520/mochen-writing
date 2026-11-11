import { marketSkillSchema, type MarketSkill } from "@mochen/contracts";
import { CATALOG_ENTRIES } from "./skill-catalog-manifest.js";

/**
 * 技能市场的内置清单装配器（2026-11-11 数据化后本文件只做拼装）。
 *
 * 【数据在哪儿】
 * 元数据在 `skill-catalog-manifest.ts`（类型化清单，出处句式走 `skill-catalog-origins.ts`），
 * 正文是 24 份真 md 文件：`skill-catalog-data/bodies/<分类>/<dirName>.md`。
 * 加一条新技能 = 往对应分类目录放一份 md + 在清单里加一条——两处缺一，
 * 下面的装配会当场抛错（缺正文）或守卫会红（正文没人引用），不会静默少一条。
 *
 * 【为什么用 `import.meta.glob` 而不是逐份 import】
 * 逐份 import 要在装配处写 24 行 `import ... from "...?raw"`——加技能的第三个改动点，
 * 正是「清单加了、import 忘了」这种事的发生地。glob 按目录形状收集，
 * 文件放对位置就必然被读到，缺文件的那条由 `bodyOf` 抛错兜住。
 *
 * 【为什么装配时就过 `marketSkillSchema`】
 * 清单现在是「数据 + 拼装」，`skillMd` 来自磁盘文件而非字面量，类型系统管不到文件内容。
 * 与其等装出去之后在用户磁盘上炸，不如在进程启动装配时就验一遍形状——
 * 数据坏了宁可起不来，也不给用户一个少几条的市场。
 */

const BODIES = import.meta.glob("./skill-catalog-data/bodies/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

/** 按清单条目里的相对路径取正文。取不到 = 清单写了、文件没放，抛错不放行。 */
function bodyOf(relPath: string): string {
  const md = BODIES[`./skill-catalog-data/bodies/${relPath}`];
  if (md === undefined) throw new Error(`技能市场正文数据缺这一份：${relPath}`);
  return md;
}

/**
 * 全部内置技能。**顺序无所谓**（`catalogView` 会按分类序重排）。
 * 形状不过守卫（目录名/分类/出处/许可）或正文不是 SKILL.md 的形状，都当场抛错。
 */
export const SKILL_CATALOG: MarketSkill[] = CATALOG_ENTRIES.map((entry) => {
  const { body, ...meta } = entry;
  const parsed = marketSkillSchema.safeParse({ ...meta, skillMd: bodyOf(body) });
  if (!parsed.success) {
    throw new Error(`技能市场数据过不了形状守卫：${entry.dirName}（${parsed.error.message}）`);
  }
  return parsed.data;
});

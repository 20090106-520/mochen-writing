/**
 * 门面守卫共用的**取文本**层（2026-10-13，第五十二节）。
 *
 * 存在的唯一理由：`tools/readme-claims.test.mjs` 在第十三道闸（CI 作业名）落地那一刻写到
 * **832 行**，越过门面自己那条「单文件 800 行预算」。`lint:budget` 当场红，所以这道闸必须在
 * 提交前把文件拆小——按 README 的拆法依据「**不共享状态**」切：读门面文字的那十一道留在原文件，
 * 拿着 `VERIFY_KINDS` 登记表对表脚本与作业名的两道搬去
 * `tools/readme-gate-composition.test.mjs`。两边都要用的只有这里这几样：仓库根、README 原文、
 * 「## 门禁」那一节的切法、把 `**` 与空白折叠成一个可读字符串的 `flatten`。
 *
 * 为什么不让几份测试各自写一遍：`gateSection()` 与 `flatten()` 是**判据的一部分**——它们决定了
 * 「门面上的一句话算不算这一节里的说法」。抄第二份就会漂移（锁定前提第 6 条：同一份判据只许一处实现，
 * 先例是 `tools/platform-anchors.mjs`，锚点也只在它那里存一份）。
 *
 * 2026-10-14 第五十九节：门面守卫从两份拆成三份（出处那一族六道搬去 `tools/readme-provenance.test.mjs`），
 * 于是这里多了一样共用件——「反引号十六进制」的取枚正则 `SHA` / `SHA_G`。它被两份守卫同用：
 * `readme-provenance.test.mjs` 拿它判「这条数配没配它所属那棵树的哈希」，`readme-claims.test.mjs`
 * 拿它筛同树声明点名的短哈希。本模块仍然**不含任何断言口径**（谁算合格、缺一枚要红不红，都只在测试里判）；
 * 它只认「门面上一枚反引号包着的十六进制串长什么样」这一件事。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

/** 根 `package.json`——`verify` 真身与脚本名清单都从这一份读，两份测试不许各读各的路径。 */
export const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/**
 * 门面「## 门禁」那一节的原文。找不到就**抛**而不是返回空串：返回空串会让所有基于它的判据
 * 在「门面改名」那一刻集体静默通过（每提取到 0 条主张，「每一条都合格」自然成立）。
 */
export function gateSection() {
  const start = readme.indexOf("## 门禁");
  if (start < 0) throw new Error("README 里找不到「## 门禁」这一节——门面改名的那一刻这条闸就该红");
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, next < 0 ? readme.length : next);
}

/** 去掉 `**` 并把所有空白折叠成单空格：判据量的是读者眼里的距离，不是磁盘上的原始下标。 */
export const flatten = (t) => t.replace(/\*\*/g, "").replace(/\s+/g, " ");

/**
 * 门面写哈希的取枚正则：**不带 `g`** 的那一枚（`SHA`）只判「这句里有没有」，
 * **带 `g`** 的那一枚（`SHA_G`）给需要数位置、逐个取出的判据用（`dateAttached` 量日期离哈希多远、
 * `treeHashes` 把每一枚都掏出来再按长度筛树哈希）。
 * 分成两枚是刻意的：带 `g` 的正则调 `.test()` 会把 `lastIndex` 留在两次判断之间，
 * 跨句复用会把第二条主张误判成「没有哈希」。
 */
export const SHA = /`[0-9a-f]{7,}`/;
export const SHA_G = /`[0-9a-f]{7,}`/g;

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

/**
 * 门面上反引号写出来的**门面守卫路径**的取枚正则。形状与 `SHA` / `SHA_G` 同源：不带 `g` 的只判
 * 「这句里有没有」，带 `g` 的给需要逐个取位置、量距离的判据用。
 * 只认 `.test.mjs` 结尾（`tools/readme-gate-facts.mjs`、`tools/platform-anchors.mjs` 这类**非测试**模块
 * 故意不在里面）：归属闸要判的是「某道闸住在哪份**测试**」，把共用模块也拉进来会把「锚点定义只在
 * `tools/platform-anchors.mjs` 存一份」这种句子误当成一次点名。
 */
export const GUARD_PATH = /`tools\/[\w.-]+\.test\.mjs`/;
export const GUARD_PATH_G = /`tools\/[\w.-]+\.test\.mjs`/g;

/**
 * 一份测试文件里**行首 `test(` 的标题文本**（第一对双引号之间的内容），返回 `[{ line, title }]`。
 *
 * 为什么在 `facts` 而不是各份守卫自己写：归属闸的判据落在**标题**上，而第十四道闸数的是同一批行——
 * 「什么算一条 `test(`」这句话有两份写法正是锁定前提第 6 条拦住的东西。
 * 判据也只能落在标题上：门面上「行号引用闸」那句话的词表是「第 N 行」「锚点」，而
 * `tools/readme-claims.test.mjs:29` 那份搬家说明的**正文**里同样写着「按行号点名时那一行必须真含着锚点」——
 * 按全文找，指错的那句照样绿。
 */
export function testTitles(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs
    .readFileSync(abs, "utf8")
    .split(/\r?\n/)
    .map((line, i) => {
      const m = line.match(/^test\(\s*"([^"]*)"/);
      return m ? { line: i + 1, title: m[1] } : null;
    })
    .filter(Boolean);
}

/**
 * 门面上「某道闸住在哪份文件」的**归属**登记表（唯一一份实现，2026-10-14 第六十节）。
 *
 * 起因不是假想的：第五十九刀把「出处」那一族六道整族搬进 `tools/readme-provenance.test.mjs` 之后，
 * 门面、锚点模块头、provenance 头里**三处**「谁核对行号」的句子全还指着 `readme-claims`，
 * 六道闸与当时十五道断言一条都不红（见 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 第五十九节
 * 「搬家留下的三条假指向」）。登记之外没有第二处口径：`key` 是门面上的**原话**（照抄，不许改写），
 * `titleWords` 是被点名那份文件**此刻标题里真能读到的词**（也是照抄，`grep -nE '^test\(' ` 回读）。
 *
 * `titleWords` 为什么要写成词表而不是一个词：同一道闸在标题里的可读到形状不止一处，
 * 例如「行号引用闸」的标题写的是「某文件的第 N 行」与「锚点」，**标题里没有「行号」两个字**。
 */
export const GATE_ATTRIBUTIONS = [
  {
    key: "行号引用闸",
    file: "tools/readme-provenance.test.mjs",
    titleWords: ["第 N 行", "锚点"]
  },
  {
    key: "数有没有出处",
    file: "tools/readme-provenance.test.mjs",
    titleWords: ["脏树", "run 页 ID"]
  },
  {
    key: "门禁由哪几段组成",
    file: "tools/readme-gate-composition.test.mjs",
    titleWords: ["那几道闸", "真身"]
  },
  {
    key: "作业名",
    file: "tools/readme-gate-composition.test.mjs",
    titleWords: ["作业名"]
  },
  {
    key: "守卫条数",
    file: "tools/readme-claims.test.mjs",
    titleWords: ["守卫条数"]
  },
  {
    key: "那笔账",
    file: "tools/platform-test-count.test.mjs",
    titleWords: ["平台分支"]
  },
  {
    key: "不吞码",
    file: "tools/ci-gate.test.mjs",
    titleWords: ["退出码"]
  }
];

/**
 * 归属句允许的最远距离（字符，`flatten` 之后）。**它不是判别器**：门面上有一句合法的历史说法
 * （第五十二节那段，转述为「第十三道闸（CI 作业名）落地那一刻，claims 那份写到 832 行」），
 * 它被反引号点名的路径离「作业名」只有 **7** 个字符，比合格那句的 **14** 更近，
 * 所以判据靠的是「指的文件对不对 + 中间夹不夹别的路径」（见
 * `tools/readme-provenance.test.mjs` 第十六道那段）。窗口只用来拒绝把整节门面（实测 5202 字符）当成一句话：
 * 合格归属句的实测距离是 2 / 4 / 11 / 11 / 14 / 26 / 56，取 100 给最大那枚留 44 个字符余量。
 */
export const ATTRIBUTION_WINDOW = 100;

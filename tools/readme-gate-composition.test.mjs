import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, rootPkg, gateSection, flatten } from "./readme-gate-facts.mjs";

/**
 * 门禁**组成**守卫（2026-10-13，第五十节立第一道，第五十二节加第二道）。
 *
 * 这两道闸从 `tools/readme-claims.test.mjs` 搬过来，原因很实在：第十三道落地那一刻原文件写到
 * 832 行，越过门面自己那条「单文件 800 行预算」，`lint:budget` 当场红。拆的依据是 README 写明的
 * 「不共享状态」——原文件那十一道读的是**门面文字**（指向、命令、出处、等式、行号、同树），
 * 而这两道读的是**门禁由哪几段组成**：`package.json` 的 `verify` 真身、门面「## 门禁」那一节的
 * 措辞、以及 `.github/workflows/verify.yml` 的作业名。三者共用的判据就是下面这张 `VERIFY_KINDS`
 * 登记表，它只在这里存一份（锁定前提第 6 条）。
 *
 * 一句话交代这道闸为什么值得单独有闸：门禁的「几道闸」一共有**三处口径**——脚本真身、门面正文、
 * CI 页面上那句作业名。前两处各有各的闸，第三处在本刀之前一个字都没人看着，而它恰好是读者最容易
 * 看到的一处（GitHub 的 run 列表每次都把它打在页面上）。
 */

/**
 * 第一道：门面**门禁组成**闸（2026-10-13，第五十节，原第十一道）。
 *
 * 病灶是门面上那句「一条命令串起五道闸」：`package.json` 的 `verify` 真身是**六类**
 * （prettier / 6 枚 tsc / eslint / 包边界 / 行数预算 / vitest）。数错本身不致命，致命的是它没有牙齿：
 * 往 `verify` 里再串一段普查脚本，前面十道闸一条都不会红
 * （M17 实测同跑的另 10 条 + `ci-gate` 6 条全绿），因为它们只认得门面上写过的东西——
 * 「六类 vs 五道闸」就是这种漂移已经发生过一次的证据。
 *
 * 判据四条，两头配平：
 * 1. **每段都要有归属**：`verify` 按 `&&` 切开（末尾那句 `echo` 是取码用的，不算一段），每一段必须
 *    **恰好**落进 `VERIFY_KINDS` 一类。落不进 = 新段没登记；落进两类 = 判据互相覆盖，两种都当场红。
 * 2. **每一类都要在门面上有写法**：登记表里的每一类，门面那一节必须写得出那句话——漏写即红。
 * 3. **每一类都要在 `verify` 里真有一段**：门面还写着、脚本里却被摘掉，同样红（第 2 条只管反方向）。
 * 4. **两个数要数得出来**：「串起 N 道闸」的 N = 实际出现的类别数；「`tsc --noEmit`（M 个类型程序）」的
 *    M = tsc 段数。两处都带实例声明（抓不到写法即红），中文数字与阿拉伯数字都认。
 *
 * 类别表 `VERIFY_KINDS` 只在这里存一份：`ci-gate.test.mjs` 钉的是「verify 仍然是 `&&` 串起来的、且含
 * vitest/eslint/prettier 这些片段」，属**形状**；这里钉的是**门面说的与脚本做的一段一段对应**，
 * 两不重复（锁定前提第 6 条管的是同一份判据不许抄两处，不是不许两条闸看同一个文件）。
 * 第五十二节给这张表加了第三列 `yml`（CI 作业名的写法），由下面那道闸看着同一个登记表。
 */
const VERIFY_KINDS = [
  {
    kind: "prettier 全仓格式",
    seg: /^prettier\s+\.\s+--check\b/,
    facade: /prettier 全仓格式/,
    yml: /格式/
  },
  {
    kind: "tsc --noEmit 类型程序",
    seg: /^tsc\s+--noEmit\s+-p\s+\S+/,
    facade: /`tsc --noEmit`（(\d+) 个类型程序）/,
    yml: /(\d+)\s*枚\s*tsc/
  },
  {
    kind: "eslint",
    seg: /^eslint\s+\.\s+--max-warnings=0\b/,
    facade: /eslint（`--max-warnings=0`）/,
    yml: /eslint/
  },
  {
    kind: "包边界检查",
    seg: /^node\s+tools\/check-package-boundary\.mjs\b/,
    facade: /包边界检查/,
    yml: /边界/
  },
  {
    kind: "单文件行数预算",
    seg: /^node\s+tools\/check-source-line-budget\.mjs\b/,
    facade: /单文件 800 行预算/,
    yml: /行数预算/
  },
  { kind: "全量测试 vitest run", seg: /^vitest\s+run\b/, facade: /`vitest run`/, yml: /全量测试/ }
];

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** `verify` 真身切成的段（末尾那句 `echo` 只是把退出码打在日志上，不是一道闸）。 */
function verifyStages() {
  return String(rootPkg.scripts.verify)
    .split("&&")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^echo\b/.test(s));
}

test("门面写的那几道闸与 `verify` 真身一段一段对得上，那两个数也数得出来", () => {
  const stages = verifyStages();
  expect(
    stages.length,
    "根 `package.json` 的 `verify` 切不出段来——要么它被改成 `;`／包进了 shell 包装（那是 ci-gate 的病灶），" +
      "要么这里的切分写坏了：两种都让这条闸静默失效"
  ).toBeGreaterThan(1);
  const text = flatten(gateSection().replace(/「[^」]*」/g, ""));

  const perKind = new Map(VERIFY_KINDS.map((k) => [k.kind, []]));
  const unclassified = [];
  const ambiguous = [];
  for (const s of stages) {
    const hits = VERIFY_KINDS.filter((k) => k.seg.test(s));
    if (hits.length === 0) unclassified.push(s);
    if (hits.length > 1) ambiguous.push(`${s} → ${hits.map((h) => h.kind).join(" / ")}`);
    for (const k of hits) perKind.get(k.kind).push(s);
  }
  expect(
    unclassified,
    `verify 里这些段没登记在「VERIFY_KINDS」：${unclassified.join(" ｜ ")}——门面对它们一无所知，` +
      "读者以为门禁只跑门面列的那几段；要么给这段加一句门面说法并在这里登记，要么把这段摘掉"
  ).toEqual([]);
  expect(
    ambiguous,
    `verify 里这些段同时落进两类：${ambiguous.join(" ｜ ")}——登记表里的判据互相覆盖了，` +
      "「一道闸」从此数不出来"
  ).toEqual([]);
  const absent = VERIFY_KINDS.filter((k) => perKind.get(k.kind).length === 0).map((k) => k.kind);
  expect(
    absent,
    `门面上还写着这几类闸，可 verify 真身里一段都没有（被摘掉或改名了）：${absent.join(" ｜ ")}——` +
      "门面在说一件不再发生的事"
  ).toEqual([]);
  const unwritten = VERIFY_KINDS.filter((k) => !k.facade.test(text)).map((k) => k.kind);
  expect(
    unwritten,
    `「## 门禁」那一节里找不到这几类闸的写法：${unwritten.join(" ｜ ")}——脚本里那段还在跑，` +
      "门面漏写了一整段（改门面措辞时要连这里一起改）"
  ).toEqual([]);

  const presentKinds = new Set();
  for (const s of stages) for (const k of VERIFY_KINDS) if (k.seg.test(s)) presentKinds.add(k.kind);
  const gateClaim = /串起\s*(\d+|[一二三四五六七八九十])\s*道闸/.exec(text);
  expect(
    gateClaim,
    "门面上找不到「一条命令串起 N 道闸」的写法了——这一臂此刻没有实例，等式之外的那个总数没人核（第四十二节那条教训）"
  ).not.toBeNull();
  const stated = /^[0-9]+$/.test(gateClaim[1]) ? Number(gateClaim[1]) : CN_NUM[gateClaim[1]];
  expect(
    stated,
    `门面说「串起 ${gateClaim[1]} 道闸」，可 verify 真身里出现的类别是 ${presentKinds.size} 类` +
      `（${[...presentKinds].join(" / ")}）——数目对不上，读者会按门面去数脚本、以为少跑或多跑了一段`
  ).toBe(presentKinds.size);

  const tscClaim = /`tsc --noEmit`（(\d+) 个类型程序）/.exec(text);
  expect(
    tscClaim,
    "门面上找不到「`tsc --noEmit`（N 个类型程序）」的写法了——这一臂同样没有实例，类型程序的数量没人核"
  ).not.toBeNull();
  const tscSegs = perKind.get("tsc --noEmit 类型程序");
  expect(
    Number(tscClaim[1]),
    `门面说 ${tscClaim[1]} 个类型程序，可 verify 里 tsc 段实际有 ${tscSegs.length} 段：${tscSegs.join(" ｜ ")}——` +
      "新增或删掉一个包的 tsconfig 时门面这一格要同改（`typecheck-coverage` 钉的是「每个包都在脚本里」，钉不到门面写的是几）"
  ).toBe(tscSegs.length);
});

/**
 * 第二道：CI **作业名**闸（2026-10-13，第五十二节，第十三道）。
 *
 * 病灶是门面上那句「六道闸」只有**两个**口径被看着（门面自己 + `verify` 真身），而仓库外还贴着
 * **第三个**口径：`.github/workflows/verify.yml` 的作业名。GitHub 的 run 列表每跑一次就把那句话
 * 打在页面上，读者看它比看 README 还勤——可它当时写的是「六路 typecheck + lint + boundary +
 * budget + 全量测试」：**prettier/格式那一段根本不在里面**，前面十一道闸一条都不红。
 * 后果不是难看，是**加段时的静默低估**：往 `verify` 里再串一段，门面那闸会红（第一道逼你登记），
 * 作业名却没人管，run 列表继续说一件比实际少一件事。
 *
 * 一句话先把上一刀的口径收回：第五十节我写过「作业名自己列的只有五件事却写着六路」，那句不准确——
 * `六路` 修饰的是 `typecheck`，而类型程序确实有六个，那五个 `+` 项也各自对应一段真脚本，缺的是
 * **格式那一段**，不是数字。真实病灶见本段第一句。
 *
 * 判据三层，都从同一张 `VERIFY_KINDS` 表取（锁定前提第 6 条：正则的第三种写法不另起一份定义）：
 * 1. **实例声明**：`verify.yml` 里缩进 4 格的 `name:` 必须**恰好一行**。0 行 = 作业被改名或整体重写，
 *    本闸空跑；≥2 行 = 出现了第二个作业，「那句作业名」当场没有唯一所指。两种都不许绿着过去。
 * 2. **一项一类、一类一项**：作业名按 `+` 切开，每一段必须**恰好**落进一类（落不进=新说法没登记，
 *    落进两类=判据互相覆盖）；反过来每一类必须**恰好**被一项写到（0 项=第三处口径漏了它，
 *    就是今天 prettier 那一格；≥2 项=同一类写了两遍，数不再唯一）。
 * 3. **tsc 那个数**：`N 枚 tsc` 的 N 必须等于 `verify` 真身里的 tsc 段数——这一臂与第一道的
 *    「（M 个类型程序）」是同一条事实的两个说法，两边各自对表，才不会出现「门面改了作业名没改」。
 */
const YML_REL = ".github/workflows/verify.yml";

/** 作业级的 `name:` 行（workflow 级那句顶格，写的是「门禁 pnpm verify」，不归本闸）。 */
function jobNameLines() {
  const yml = fs.readFileSync(path.join(ROOT, YML_REL), "utf8");
  return yml
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => /^ {4}name\s*:/.test(l));
}

/** 作业名按 `+` 切开的段（每段去掉首尾空白）。 */
function jobNameItems(nameText) {
  return nameText
    .split("+")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

test("CI 作业名按 `+` 数出来的每一路，都得是 `verify` 真身里真在跑的那一类闸", () => {
  const lines = jobNameLines();
  expect(
    lines,
    `${YML_REL} 里缩进 4 格的 \`name:\` 行有 ${lines.length} 行——本闸取的是「那一句作业名」，` +
      "0 行说明作业被改名或整个文件重写（闸空跑），≥2 行说明出现了第二个作业（没有唯一所指）：" +
      lines.map((l) => l.trim()).join(" ／ ")
  ).toHaveLength(1);
  const nameText = lines[0].replace(/^ {4}name\s*:/, "").trim();
  const items = jobNameItems(nameText);
  expect(
    items.length,
    `作业名「${nameText}」按 \`+\` 切不出段来——要么作业名被改成一句散文，要么这里的切分写坏了；` +
      "两种都让下面两条对表空转（第四十二节那条教训：提取写坏比文案写错更糟）"
  ).toBeGreaterThan(1);

  const perKind = new Map(VERIFY_KINDS.map((k) => [k.kind, []]));
  const unclassified = [];
  const ambiguous = [];
  for (const it of items) {
    const hits = VERIFY_KINDS.filter((k) => k.yml.test(it));
    if (hits.length === 0) unclassified.push(it);
    if (hits.length > 1) ambiguous.push(`${it} → ${hits.map((h) => h.kind).join(" / ")}`);
    for (const k of hits) perKind.get(k.kind).push(it);
  }
  expect(
    unclassified,
    `作业名里这些 \`+\` 项没登记在「VERIFY_KINDS」的 \`yml\` 列：${unclassified.join(" ｜ ")}——` +
      "要么它指的是没被门面/脚本承认的一段，要么登记表的写法覆盖不到实际文案；两种都让「按作业名数闸」失守"
  ).toEqual([]);
  expect(
    ambiguous,
    `作业名里这些 \`+\` 项同时落进两类：${ambiguous.join(" ｜ ")}——\`yml\` 列的判据互相覆盖了，` +
      "「一共几路」从此数不出来"
  ).toEqual([]);

  const missing = [...perKind].filter(([, its]) => its.length === 0).map(([kind]) => kind);
  expect(
    missing,
    `verify 真身里在跑、门面也写着，可作业名里一项都没提到：${missing.join(" ｜ ")}——` +
      "GitHub run 列表会少报一段，读者按作业名去核对门禁就核不上；改脚本写法时三处（脚本/门面/作业名）要同改"
  ).toEqual([]);
  const duplicated = [...perKind].filter(([, its]) => its.length > 1);
  expect(
    duplicated.map(([kind]) => kind),
    `作业名里这几类闸被写了两遍：${duplicated
      .map(([kind, its]) => `${kind}←${its.join("/")}`)
      .join(" ｜ ")}——同一类有两种写法，登记表就再也不是「一段一类」`
  ).toEqual([]);

  const stages = verifyStages();
  const tscSegs = stages.filter((s) =>
    VERIFY_KINDS.find((k) => k.kind === "tsc --noEmit 类型程序").seg.test(s)
  );
  const tscClaim = /(\d+)\s*枚\s*tsc/.exec(nameText);
  expect(
    tscClaim,
    `作业名里找不到「N 枚 tsc」的写法了（当前是「${nameText}」）——类型程序的数量在 CI 页面上没人说，` +
      "而登记表的 `yml` 列只有 tsc 那一项带数"
  ).not.toBeNull();
  expect(
    Number(tscClaim[1]),
    `作业名说 ${tscClaim[1]} 枚 tsc，可 verify 真身里 tsc 段有 ${tscSegs.length} 段：${tscSegs.join(" ｜ ")}——` +
      "门面那格「（M 个类型程序）」与本闸核的是同一事实，两边各自对表，只改一边当场红"
  ).toBe(tscSegs.length);
});

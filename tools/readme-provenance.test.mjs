import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LINE_ANCHORS, linesWith } from "./platform-anchors.mjs";
import { ROOT, readme, gateSection, flatten, SHA, SHA_G } from "./readme-gate-facts.mjs";

/**
 * 门面**出处**守卫（2026-10-14，第五十九节从 `tools/readme-claims.test.mjs` 拆出来）。
 *
 * 拆的原因与第五十二节那一次同形：原文件停在 **791/800**，再往里加任何一条断言都会踩上门面自己那条
 * 「单文件 800 行预算」。区别只在这一次不红等它——按 README 写明的判据（「不共享状态」）提前切。
 * 搬出来的这六道读的都是同一件东西：**门面上那些可核对的指向有没有出处**——测试数说没没说清跑在
 * 哪棵树上、run 页 ID 配没配它所属那棵树的哈希、按行号点名时那一行是不是真含着登记过的锚点。
 * 留在原文件里的是另一件东西：**门面自己算不算得过**（等式自洽、同树声明对表、守卫条数对表、
 * quoted 的 CI 原文对表）与**指向存不存在**（反引号路径、`pnpm <脚本>` 脚本名）。
 *
 * 两边共用「反引号十六进制」这一枚取枚写法（`SHA` / `SHA_G`），它现在住在
 * `tools/readme-gate-facts.mjs`，两份守卫各自 import——同一份正则抄第二份就会漂移
 * （锁定前提第 6 条：枚举与映射只许一份实现，先例是锚点只在 `tools/platform-anchors.mjs` 存一份）。
 *
 * 门面那句「`tools/readme-provenance.test.mjs`（6 道）」与「原文件留 7 道」不是手写的荣誉，
 * 第十四道闸（`tools/readme-claims.test.mjs`）拿三份文件此刻行首 `test(` 的行数当场核对它们。
 */

/**
 * 测试数的**出处**闸（2026-10-13 加，病根见 README 自己那段「以前写着 215 文件 / 3014 用例」）。
 * 只数「门禁」那一节里的数：那是门面**当前**在主张什么；反例都写在 `「…」` 里，先剥掉再判。
 *
 * 分两支，因为门面里有两种性质不同的数：
 * - **当成权威的数**（明写「干净 / 已提交 / 零脏项」）：必须带一枚反引号提交哈希。
 *   哈希是唯一能被 `git show` 追回去的东西，「当场读回零脏项」这句话本身不是——它会过期。
 * - **本来就声明自己不作数的数**（明写未跟踪 / 未入库 / 未提交）：允许不带哈希，只要求日期。
 *
 * 第一版把两支合成一句「有哈希**或**提到脏」，结果变异 R1（只删哈希、留着「零脏项」三字）**当场活下来**：
 * 「零脏项」里的「脏」满足了脏树词表，一句宣称干净的数反倒不需要出处了。所以两支必须分开判，
 * 而且 `未跟踪|未入库|未提交` 这三个词是刻意窄选的——它们只出现在「这棵树不干净」的句子里，
 * 「零脏项」「读回 0 条」这类**反义**写法一律落进干净支。
 *
 * 第二版只要求「同句内存在日期」，于是变异 R3（删掉紧邻那串数的 `2026-10-11`，留着同一句开头的
 * `2026-10-12 又补一条更细的教训：`）**活到了第三十九节之后**：那个 10-12 说的是「教训哪天补的」，
 * 不是「数哪天测的」，可判据只看同句有没有日期，分不出这两件事。所以现在日期还必须**挨着**它要说明的东西
 * （数或哈希，窗口见 `DATE_WINDOW`），并且下面那条实例声明要求两条路在门面上各得有真写法——
 * 一条路没有实例，就等于那条路没测。
 *
 * 取文本的四样东西（`ROOT`、`readme`、`gateSection`、`flatten`）连同「反引号十六进制」那两枚取枚正则
 * （`SHA` / `SHA_G`）住在 `tools/readme-gate-facts.mjs`——三份门面守卫认的是同一句「门面上的这句话算不算
 * 『## 门禁』那一节里的说法」与同一种哈希写法，抄第二份就会漂移（先例：锚点只在
 * `tools/platform-anchors.mjs` 存一份）。
 */

// 不带 `g`：这里只用 `.test()` 判断句子，带 `g` 会让 `lastIndex` 跨句残留，把第二条主张误判成没有。
const COUNT_CLAIM = /\d+\s*文件\s*\/\s*[\d,]+\s*(?:用例|passed)/;
const DATE = /\d{4}-\d{2}-\d{2}/;
/** 只有这三个词算「明写这棵树不干净」；见上面那段 R1 的教训。 */
const DIRTY_TREE = /未跟踪|未入库|未提交/;
/** 宣称树干净的写法：出现即要求哈希，哪怕同一句里还带着脏树词。 */
const CLEAN_TREE = /干净|零脏项|已提交|读回\s*0\s*条/;
// 带 `g` 的那一枚只给 `dateAttached` 数位置用：它与上面 `DATE` 同源，不另写第二份定义。
// 取枚用的 `SHA` / `SHA_G` 不在这里定义——它同时被 `tools/readme-claims.test.mjs` 的同树声明闸使用，
// 一份「反引号十六进制」的写法只该有一个定义处（见本文件开头那段与 `tools/readme-gate-facts.mjs`）。
const DATE_G = /\d{4}-\d{2}-\d{2}/g;

/**
 * 日期必须**挨着**它要说明的那个东西：要么挨着那串数，要么挨着那棵树的哈希（门面写法是 `` `sha`（date ``）。
 * 窗口取 12 个字符，是在当场量出来的两个数之间选的：门面上四条数走这两条路的实测距离是
 * 数←日期 **4 / 5** 与 哈希←日期 **1**，而把 `2026-10-11` 删掉的变异 R3 留下的孤儿日期是 **19**
 * ——12 离两边都有余量。`flatten` 先去掉 `**` 再把空白折叠，所以量的不是磁盘上的原始下标，
 * 而是读者眼里那段话的实际距离。
 */
const DATE_WINDOW = 12;

/** 这句里的日期是不是挨着数或挨着哈希；返回实测距离，错误信息要把它打出来。 */
function dateAttached(sentence) {
  const t = flatten(sentence);
  const claim = t.match(COUNT_CLAIM);
  if (!claim) return { ok: false, gapToNumber: null, gapToHash: null };
  const before = t.slice(0, claim.index);
  const dates = [...before.matchAll(DATE_G)];
  // 日期本身 10 个字符（`\d{4}-\d{2}-\d{2}`），所以从匹配末尾起量。
  const gapToNumber = dates.length
    ? flatten(before.slice(dates[dates.length - 1].index + 10)).length
    : null;
  let gapToHash = null;
  for (const h of before.matchAll(SHA_G)) {
    const seg = t.slice(h.index + h[0].length);
    const d = seg.match(DATE);
    if (!d) continue;
    const gap = flatten(seg.slice(0, d.index)).length;
    if (gapToHash === null || gap < gapToHash) gapToHash = gap;
  }
  const ok =
    (gapToNumber !== null && gapToNumber <= DATE_WINDOW) ||
    (gapToHash !== null && gapToHash <= DATE_WINDOW);
  return { ok, gapToNumber, gapToHash };
}

function testCountClaims() {
  // 「…」 里的是反例或历史说法，不当成当前主张。
  return gateSection()
    .replace(/「[^」]*」/g, "")
    .split(/[。；;]/)
    .filter((sentence) => COUNT_CLAIM.test(sentence));
}

/** 这句是不是走「脏树」那一支：明写不干净，且没有同时宣称干净。 */
const dirtyWorded = (s) => DIRTY_TREE.test(s) && !CLEAN_TREE.test(s);

test("门禁那一节的每条测试数都说清了跑在哪棵树：宣称干净必须有哈希，声明脏树才免", () => {
  const claims = testCountClaims();
  expect(
    claims.length,
    "「## 门禁」一节里一条测试数主张都没提取到——多半是 `N 文件 / M 用例` 的写法变了或整节被改名，" +
      "那比门面没数更糟：这条闸会静默失效"
  ).toBeGreaterThan(1);
  const naked = claims.filter((s) => {
    const treeStated = SHA.test(s) || dirtyWorded(s);
    return !(treeStated && dateAttached(s).ok);
  });
  expect(
    naked,
    "这些测试数没连着出处：要么没有日期，要么日期没挨着那串数（窗口 " +
      DATE_WINDOW +
      " 字符）也没挨着哈希，要么既没给反引号提交哈希、也没明写「未跟踪/未入库/未提交」" +
      "（宣称跑在干净或已提交的树上时，只有哈希算出处）——" +
      naked
        .map((s) => {
          const a = dateAttached(s);
          return (
            s.trim().slice(0, 60) +
            `[日期→数 ${a.gapToNumber ?? "无"}｜日期→哈希 ${a.gapToHash ?? "无"}]`
          );
        })
        .join(" ／ ")
  ).toEqual([]);
});

/**
 * 干净支的**实例声明**（与下面那条「日期附加两条路」同为只数实例、不判对错的断言）：
 * 上面那条规则的两支各有触发条件，而规则只对干净支加严；一旦门面上不再有任何带哈希的数，
 * 干净支就成了空转——「删哈希、留着『零脏项』」这类写法（变异 R1）会一路绿灯。
 * 所以这里要求：至少一条测试数带反引号哈希，且其中至少一条明写「干净/已提交/零脏项」。
 * 脏树支**故意不设实例要求**：那一支落空只会让规则更严（所有数都得带哈希），不会放水。
 */
test("出处闸的干净支在门面上得有实例：至少一条数带哈希，且其中一条明写干净", () => {
  const claims = testCountClaims();
  const withSha = claims.filter((s) => SHA.test(s));
  expect(
    withSha.length,
    "「## 门禁」一节里没有任何一条测试数带反引号提交哈希——那上面「干净提交树上的数以 CI 为准」" +
      "就退成了无出处的话，而且干净支的判据在此节里没有实例，等于没测"
  ).toBeGreaterThan(0);
  const cleanWorded = withSha.filter((s) => CLEAN_TREE.test(s));
  expect(
    cleanWorded.length,
    "带哈希的那几条数里没有一条明写「干净/已提交/零脏项」——干净支此刻在门面上没有实例，" +
      "它对 R1 那种变异不再有效，得连这条一起改"
  ).toBeGreaterThan(0);
});

/**
 * 「日期挨着谁」也有两条路（挨着数 / 挨着哈希），所以它同样需要**两条路各有实例**：
 * 一旦门面上只剩哈希写法的数，`gapToNumber` 那一支就此空转，R3 那种「同句另一头留个日期」的写法
 * 就又没人管了——这正是第三十八节那条教训（判据的一支没有实例 = 那一支没测）在这里复发。
 * 这条断言不判门面写得对不对，只数有没有实例，与上面那条同族。
 */
test("日期附加的两条路在门面上都得有实例：至少一条数挨着日期、至少一条数挨着哈希", () => {
  const claims = testCountClaims();
  const byNumber = claims.filter(
    (s) => dateAttached(s).gapToNumber !== null && dateAttached(s).gapToNumber <= DATE_WINDOW
  );
  const byHash = claims.filter(
    (s) => dateAttached(s).gapToHash !== null && dateAttached(s).gapToHash <= DATE_WINDOW
  );
  expect(
    byNumber.length,
    "门面上没有一条测试数是「日期直接写在数前面」的写法——挨着数那一支此刻没有实例，" +
      "R3 那种同句孤儿日期不再有人拦（实测距离见上一条断言的错误信息，窗口 " +
      DATE_WINDOW +
      " 字符）"
  ).toBeGreaterThan(0);
  expect(
    byHash.length,
    "门面上没有一条测试数的日期挨着它所属那棵树的哈希——挨着哈希那一支没有实例，" +
      "「`sha`（date」这种门面写法如果被改掉，此处应同步改判据而不是让它空转"
  ).toBeGreaterThan(0);
});

/**
 * run 页 ID 的**配对闸**（2026-10-13，第四十三节第三节那条口径从这里起才有牙齿）。
 *
 * 病根是本刀自己撞出来的：写门面时把 `38340568495`（`1e0c215` 在 fix 分支上的孪生）当成了 `6c1fb91`
 * 那一轮的页 ID。机制很日常——手里同时有两串 ID，而 run 列表快照**只有一列**，单抓一列必串台。
 * 上面那几条数闸对这种错法完全无感：句子里的哈希与日期都齐着，错的只是「ID 指的是哪棵树」。
 *
 * 判据选的是**最便宜且不会假绿**的那一条：一枚 run 页 ID（9–12 位、独立成词）所在的那一句，
 * 必须同时带着另一枚反引号提交哈希。为什么强调「另一枚」：`[0-9a-f]{7,}` 一样能匹配整串数字 ID，
 * 不先把 ID 本身抹掉，ID 就成了自己的出处——那正是这条闸要防的写法。
 *
 * **「独立成词」而不是「必须带反引号」是第二遍才补上的。** 第一版只认 `` `38346916366` ``，
 * 于是**把那对反引号摘掉，整条闸当场失明**——不是"过"，是根本没看见那枚 ID（变异 M3 实测 `EXIT=0`、
 * 7 条全过）。前后不挨字母或数字这条边界让放宽不误伤：`2026-10-13` 每段只有 4 位、
 * runner 镜像版本 `20261004.327.1` 首段 8 位、64 位 sha256 里的纯数字串必然挨着十六进制字母。
 * 第二条脱身通路是「藏进引号」：本节所有判据都先剥 `「…」`（免得门面里引来的原文误触数闸），
 * ID 写进引号里就跟着被剥掉 ⇒ 另数一遍**没剥引号**的枚数，两边不等即红（变异 M4）。
 * 它仍然不能证明 ID 与哈希**真是同一次跑**（那要开 run 页），靠的是第四十三节那条「三件套一起抓」的手法。
 */
const RUN_ID_T = /(?<![0-9a-zA-Z])\d{9,12}(?![0-9a-zA-Z])/;
// 由 T 派生，不手抄第二份：这两枚必须认同一个东西。判据先 `replace(RUN_ID_G, "")` 再找哈希，
// 一旦 G 比 T 窄（改了下限却只改一处），ID 就留在句里被 `SHA` 匹配上——**ID 自证成自己的出处**，
// 这条闸当场假绿。锁定前提第 6 条（枚举与映射只许一份实现）在正则上同理。
const RUN_ID_G = new RegExp(RUN_ID_T.source, "g");

function runIdSentences() {
  return gateSection()
    .replace(/「[^」]*」/g, "")
    .split(/[。；;]/)
    .filter((s) => RUN_ID_T.test(s));
}

test("门面上每个 run 页 ID 所在句都得配着另一枚提交哈希（ID 不能当自己的出处）", () => {
  const withIds = runIdSentences();
  expect(
    withIds.length,
    "「## 门禁」一节里一个 run 页 ID 都没提取到——要么门面不再引 CI 的页（那 CI 出处就退化成转述），" +
      "要么提取正则写坏了。两种都比门面写错更糟：这条闸会静默失效"
  ).toBeGreaterThan(0);
  const lonely = withIds.filter((s) => !SHA.test(s.replace(RUN_ID_G, "")));
  expect(
    lonely,
    "这些 run 页 ID 没配着它所属那棵树的提交哈希（抹掉 ID 之后同句找不到第二枚反引号哈希）——" +
      "读者拿这串数字打开的是一个无法核对是哪棵树的页面：" +
      lonely.map((s) => s.trim().slice(0, 60)).join(" ／ ")
  ).toEqual([]);
});

/**
 * 「藏进引号」那条通路的闸（与上面那条同族：只数枚数，不判门面写得对不对）。
 * 剥 `「…」` 是本节全部判据共用的预处理，所以任何藏进引号的东西对判据都不存在——
 * 引号内外的 ID 枚数不等，就说明门面上有一枚 CI 页码**只有读者能看见、闸看不见**。
 */
test("run 页 ID 不许藏进引号里：剥 `「…」` 前后数出来的枚数必须相等", () => {
  const sec = gateSection();
  const raw = [...sec.matchAll(RUN_ID_G)].map((m) => m[0]);
  const visible = [...sec.replace(/「[^」]*」/g, "").matchAll(RUN_ID_G)].map((m) => m[0]);
  expect(
    visible.length,
    "剥掉 `「…」` 之后一枚 run 页 ID 都不剩——那要么门面把页码全写进了引号（见下面那条），" +
      "要么提取正则写坏了：这条闸会静默失效"
  ).toBeGreaterThan(0);
  const hidden = raw.filter((v) => !visible.includes(v));
  expect(
    raw.length,
    "这些 run 页 ID 写在「」里（引号内外枚数 " +
      raw.length +
      " ≠ " +
      visible.length +
      "）：本节所有判据都先剥引号内容，藏进去等于从闸上摘走——" +
      "要么把它移出引号，要么这枚 ID 本就不该出现在门面上：" +
      hidden.join(" ／ ")
  ).toBe(visible.length);
});

/**
 * 门面上的**行号引用**闸（2026-10-13，第四十九节）。
 *
 * 病灶：门禁那一节点名「`packages/fs-store/test/changes.test.ts` 的第 247 与 302 行，都是书外软链的守卫」，
 * 而前面四类一条都管不到它——路径闸只管文件存不存在，不管第几行写的是什么。这一类坏得比路径安静：
 * 文件被删至少 `fs.existsSync` 会红，而行号不会因为**上面插了一条用例**而报错，只会整体下移；
 * 那时门面上的第 247 行是一行 `});`，读者按图看到别的东西，门面却还在替他保证「都是书外软链的守卫」。
 *
 * 判据三层，少一层就留一条脱身通路：
 * 1. **实例声明**：门面上至少得有一处「`某文件` 的第 N 行」的写法，提取不到即红（第四十二节那条教训：
 *    正则写坏了比门面写错更糟，守卫静默失效）。
 * 2. **锚点登记**：被点名的文件必须在 `LINE_ANCHORS` 里有锚点。没登记**不算跳过，算红**——
 *    否则门面新点名一个文件写行号就不需要负任何责任。
 * 3. **逐行 + 完整性**：每个被点名的行号，那一行确实含着锚点——这一头管门面**多写或写歪**（代码里摘掉一枚
 *    `skipIf`、而门面还留着两个行号时，被摘掉的那一行不含锚点，先在这里红；变异 M13 测的就是这一头）；
 *    并且锚点在文件里出现的**全部**行号必须等于被点名的那一组——这一头管**漏数**，两个方向各测一次：
 *    门面侧漏写（变异 M14，只写 247 不写 302）与代码侧新增（变异 M16，临时插第三枚 POSIX-only 用例，
 *    门面没跟上）。
 *
 * 锚点与逐行扫描 import 自 `tools/platform-anchors.mjs`，与 `platform-test-count.test.mjs` 用的是同一份
 * 判据（锁定前提第 6 条：枚举与映射只许一份实现）。这里扫全文而不只看「## 门禁」那一节，是因为行号引用
 * 出现在哪一节都该被核对；`「…」` 里的反例不剥——剥了等于给「把引用写进引号里」留通路（见上面 run 页 ID 那条）。
 */
const LINE_CITE = /`([^`\s]+\.[a-zA-Z]{1,6})`\s*的第\s*([0-9][0-9 与、，,和]*?)\s*行/;

function lineCitations() {
  return [...readme.matchAll(new RegExp(LINE_CITE.source, "g"))].map((m) => ({
    file: m[1],
    cited: [...m[2].matchAll(/[0-9]+/g)].map((n) => Number(n[0])),
    raw: m[0].trim()
  }));
}

test("门面上每一处「某文件的第 N 行」都得真指到登记过的锚点，而且不能漏数", () => {
  const cites = lineCitations();
  expect(
    cites.length,
    "README 里一处「`某文件` 的第 N 行」的引用都没提取到——要么门面不再按行号点名（那这一类判据就该连文件一起删），" +
      "要么提取正则写坏了：后者会让这条闸静默失效"
  ).toBeGreaterThan(0);
  for (const c of cites) {
    const anchor = LINE_ANCHORS[c.file];
    expect(
      anchor,
      `门面上按行号点名了 ${c.file}，可 ` +
        "`tools/platform-anchors.mjs` 的 `LINE_ANCHORS` 里没有它的锚点——「没登记就跳过」等于给门面开了「写行号不需要负责」的通路，" +
        "所以这里直接红：要么给这个文件登记锚点（并确认逐行判据真的能认出那一行），要么把行号改成能被前四类核对的写法"
    ).toBeTruthy();
    const abs = path.join(ROOT, c.file);
    expect(
      fs.existsSync(abs),
      `门面上「${c.raw}」点名的文件在仓库里不存在——路径闸（第一类）抓的是反引号路径，这里再钉一次：行号引用必须连着文件一起在场`
    ).toBe(true);
    const source = fs.readFileSync(abs, "utf8");
    const lines = source.split("\n");
    for (const n of c.cited) {
      const text = lines[n - 1] ?? "";
      expect(
        text,
        `门面上「${c.raw}」点到的第 ${n} 行其实是 ${JSON.stringify(text.trim().slice(0, 60))}，` +
          `不含锚点 ${anchor.source}——那一行上面每插一条用例，行号就整体下移，门面必须跟着改`
      ).toMatch(anchor);
    }
    const real = linesWith(source, anchor);
    const sorted = [...c.cited].sort((a, b) => a - b);
    const missed = real.filter((n) => !sorted.includes(n));
    expect(
      sorted,
      `门面上「${c.raw}」点名了 ${sorted.join("、")} 行，可 ${c.file} 里锚点实际出现在 ${real.join("、")} 行：` +
        `门面漏点了第 ${missed.join("、")} 行。多写的那一头由上面逐行那条判住（点名的行不含锚点就先红），` +
        "这里只管漏数——读者按门面只找到一处守卫"
    ).toEqual(real);
  }
});

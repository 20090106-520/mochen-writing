import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readme, rootPkg, gateSection, flatten, SHA_G } from "./readme-gate-facts.mjs";

/**
 * 门面主张守卫（2026-10-13）。
 *
 * 病灶是当场撞出来的：`README.md` 写着「皮肤像素闸在 `tools/`」，我照着去 `tools/` 找，
 * 那里**一个像素闸都没有**——真身在 `apps/desktop/scripts/check-scene-art.mjs`（三道闸 G1/G2/G3），
 * 生成器是同目录的 `gen-scene-svgs.mjs` + `scene-palettes.mjs`。门面指错路，下一个人就会
 * 在错的目录里得出「这闸不存在 / 这活儿没做」的结论；本仓反复出现的假话形态正是
 * 「东西在，说明指向别处」。所以这一条不测代码，只测**门面里那些可核对的指向**：
 *
 * 1. README 用反引号写出的、以 `apps/ | packages/ | tools/ | docs/ | .github/` 开头的路径，必须真的存在。
 *    只认这五个顶层前缀是刻意的：`.mochen/`（作品目录里那份）与 `.git/hooks`（工作树里 `.git` 是文件）
 *    都不该被当成仓库路径来断言，扩大匹配面只会让人学会关掉这条守卫。
 * 2. README 里**以命令形式写出的**每个 `pnpm <脚本>`（反引号整句或 ``` 代码块，含
 *    `pnpm --filter <包> <脚本>`），脚本名必须在根 `package.json` 或 `apps/desktop/package.json`
 *    的 `scripts` 里；`install` / `exec` 这类 pnpm 自带命令除外。散文里的「pnpm workspace」不算命令。
 *
 * 本文件此刻管的五类（第七道到第十五道里剩下的那一半）：
 * ① **指向存不存在**：反引号路径必须真在仓库里、`pnpm <脚本>` 必须在 `package.json` 的 `scripts` 里。
 * ② **等式自洽**（2026-10-13，第四十六节回填之后）：门面上跨格的算式自己得算得过，
 *    只 bump 一边当场红——免责段那句「只 bump 一边会把同树对照又拆掉」从这里起才有牙齿。
 * ③ **同树声明对表**（第五十一节，第十二道）、④ **守卫条数对表**（第五十五节，第十四道）、
 *    ⑤ **quoted 的 CI 原文对表**（第五十六节，第十五道）。
 * 另一族——**数有没有出处**（测试数必须说清跑在哪棵树上、日期必须挨着它说明的那个东西、run 页 ID
 * 必须配着另一枚提交哈希、按行号点名时那一行必须真含着锚点）——2026-10-14 第五十九节搬去
 * `tools/readme-provenance.test.mjs`；两族共用「反引号十六进制」这一枚取枚正则，它住在
 * `tools/readme-gate-facts.mjs`。
 * 每一类都带一条"提取到东西没有"的自我声明：正则写坏了会让守卫**空跑即绿**，那比没有守卫更糟。
 *
 * 2026-10-13 第五十二节：本文件一度写到 **832 行**，越过门面自己那条「单文件 800 行预算」
 * （`lint:budget` 当场红，所以这一刀必须在提交前拆）。按「不共享状态」切：**门禁由哪几段组成**的
 * 两道闸（`VERIFY_KINDS` 登记表、`verify` 真身、CI 作业名）搬到了 `tools/readme-gate-composition.test.mjs`，
 * 两边共用的取文本层搬到了 `tools/readme-gate-facts.mjs`。
 * 2026-10-14 第五十九节又切了一刀，切因是**余量**而不是超限：那一刀之前本文件停在 **791/800**，
 * 再加一条断言就红，于是**出处那一族六道**搬去 `tools/readme-provenance.test.mjs`，这里留 7 道。
 * 所以门面守卫的条数从第五十二节起要**数两份文件**、从第五十九节起数**三份**，
 * README 里那句「用例数从 3 条加到 11 条」只覆盖拆分之前那段。
 */

const TOP_DIRS = ["apps", "packages", "tools", "docs", ".github"];

/** 反引号里、以顶层目录开头的路径主张（允许结尾斜杠；带空格与花括号的不是路径）。 */
function readmePaths() {
  return [...readme.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1])
    .filter((t) => TOP_DIRS.some((d) => t.startsWith(`${d}/`)));
}

/**
 * `pnpm <脚本>` 与 `pnpm --filter <包> <脚本>` 点到的脚本名。
 * 只认**两种现场**：反引号里的整句命令，与 ``` 代码块里的行。散文里那句「pnpm workspace」
 * 是包管理器的形容词，不是脚本名——第一版没做这个区分，它当场被判成「不存在的脚本」，
 * 红得没错但红得没道理；守卫要咬的是指向，不是措辞。
 */
function pnpmScripts() {
  const names = [];
  for (const m of readme.matchAll(/`([^`]+)`/g)) {
    const cmd = /^pnpm\s+(?:--filter\s+\S+\s+)?([a-z][\w:-]*)\b/.exec(m[1].trim());
    if (cmd) names.push(cmd[1]);
  }
  for (const block of readme.matchAll(/```[\s\S]*?```/g)) {
    for (const m of block[0].matchAll(/\bpnpm\s+(?:--filter\s+\S+\s+)?([a-z][\w:-]*)\b/g)) {
      names.push(m[1]);
    }
  }
  return names;
}

/** pnpm 自带的命令——它们不是本仓的脚本，不该要求 package.json 里有同名条目。 */
const PNPM_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "run",
  "exec",
  "dlx",
  "list",
  "why",
  "store",
  "patch",
  "rebuild",
  "up",
  "update",
  "frozen",
  "version"
]);

function pkgAt(pkgJsonPath) {
  return JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
}

const rootScripts = new Set(Object.keys(rootPkg.scripts || {}));
const desktopScripts = new Set(
  Object.keys(pkgAt(path.join(ROOT, "apps/desktop/package.json")).scripts || {})
);

test("提取到的确实是门面里那些指向（否则本守卫只剩自我声明）", () => {
  const paths = readmePaths();
  expect(
    paths.length,
    "README 里没提取到任何以顶层目录开头的路径主张——多半是提取正则写坏了，不是门面变干净了"
  ).toBeGreaterThan(5);
  const scripts = pnpmScripts();
  expect(scripts.length, "README 里没提取到任何 pnpm 脚本名——同上，提取面塌了").toBeGreaterThan(2);
});

test("README 点到的仓库路径必须真实存在", () => {
  const missing = [...new Set(readmePaths())].filter((p) => {
    const target = path.join(ROOT, p.replace(/\/+$/, ""));
    return !fs.existsSync(target);
  });
  expect(
    missing,
    `门面上这些路径在仓库里找不到，读者会按图找不到东西：${missing.join(", ")}`
  ).toEqual([]);
});

test("README 点到的 pnpm 脚本必须在 package.json 里", () => {
  const unknown = [...new Set(pnpmScripts())].filter(
    (name) => !PNPM_BUILTINS.has(name) && !rootScripts.has(name) && !desktopScripts.has(name)
  );
  expect(
    unknown,
    `门面上写了不存在的 pnpm 脚本（改名或删掉的那一刻，README 必须同批改）：${unknown.join(", ")}`
  ).toEqual([]);
});

/**
 * 门面**等式自洽**闸（2026-10-13，第四十六节那次回填之后补的）。
 *
 * 出处那一族（`tools/readme-provenance.test.mjs`）管的是「每个数有没有出处」「ID 配没配哈希」，
 * 管的都是**一格一格**的写法；
 * 但门面上真正会漂移的东西是**跨格的算式**：免责段自己写了「回填不是每刀必做，做的时候两侧都要从
 * 同一棵树重读，**只 bump 一边会把同树对照又拆掉**」，而那句话此刻只是台账与门面里的字——
 * 把「Linux 侧 4110 条注册」改成 4111 而留着「= 本机 4113 − 3」，前面四条闸一条都不会红
 * （出处齐、日期挨着、ID 配着哈希），门面却当场说假话。这和三十八节「判据的一支没有实例＝那一支没测」
 * 是同一族病灶：规则写着，但没有东西替它算一遍。
 *
 * 所以这里只算门面上**已经写成等式**的那些处，不新增任何主张（条目数以 `EQUATIONS` 此刻的长度为准，
 * 门面守卫每加一处等式就在这里多一个对象——写死一个数就是下一枚会冻死的数）：
 * 每一处都配一条实例声明（正则抓不到就是红），免得某一处的写法被改掉之后这条闸静默失效。
 * 数字一律先过 `flatten`（剥 `**`、折空白）再匹配，且这些正则**不带 `g`**——道理见
 * `tools/readme-provenance.test.mjs` 开头那段（带 `g` 的 `.test()` 会把 `lastIndex` 留在句子之间）。
 *
 * 第四十八节回填时补上第二层：等式里的数还必须**等于它所描述的那一格**。第一版只算等式自己，
 * 于是「顶格改成 4111、下面那句还留着 4110 = 4113 − 3」这种状态它算得过（4110+3 确实等于 4113），
 * 门面却在说假话——回填时我正好就处在这一段里（先改完两格，隔了几分钟才回头改那句等式）。
 * 所以 `CELLS` 把两格读数各钉成一份实现，等式用 `ties` 指回它引用的那一格；对表用的正则与
 * 读格用的是同一枚，不另写第二份（锁定前提第 6 条）。Linux 那一侧两枚 `skipIf(win32)` 根本不注册，
 * 注册数＝用例数，所以第一处等式的第 1 个数对的就是 CI 那一格报的数。
 *
 * 第五十四节回填（顶格换绑到 `12b2bf0`）时动的是三处：`CELLS.linux` 不再把**文件数**钉死成 313
 * （硬编码等于把「回填」这件事变成「每次都要先来改守卫」），改成**读出来与本机那一格对表**——
 * 变异 M56 量的就是这个：只把 CI 那一格的文件数从 315 改成 314，门面守卫那三道文件（18 条）一条不红；
 * 装上对表后同一条变异当场红，而两侧**一起**改成 316 仍然绿（这条闸不钉值，只钉「同一棵树两侧同数」）。
 * 另外历史那处差值等式**摘掉 `ties`**、另起一处指着现况的：历史那句「从 4105 到 4113 差的 8 条」仍然
 * 算得过，但它描述的格已经不再是顶格，所以它只对自己算；顶格由新那处对表。
 *
 * 第五十七节回填（顶格换绑到 `a953b12`）就是把上面那套动作再做一遍：接手对表的那处换成「第十四道 1 条
 * \+ 第十五道 1 条」，而原本指着顶格的那处（「那一族 2 条 + CI 报数守卫 8 条」）就此退成历史，`ties` 摘掉。
 * 一处等式从「对表」退成「只算自己」时，门面上它那句必须还留得住——`re` 找不到实例时上面那条断言先红，
 * 所以摘 ties 与留句子是同一刀里的两件事，不能只改守卫不改门面（第四十二节那条教训）。
 * 第六十一节回填（顶格换绑到 `2f0808e`，Linux 侧 4130）第三次做同一套动作：接手的是「第十六道 5 条」那处，
 * 被摘掉 `ties` 的是上一处「第十四道 + 第十五道」，门面上两句都原样留着。
 */
const CELLS = {
  linux: {
    // 第 1 组是文件数：不钉死值，但两侧必须同值（见上面 M56 那段）。
    re: /报的数：(\d+) 文件 \/ (\d+) 用例/,
    files: 1,
    group: 2,
    name: "CI 那一格的用例数"
  },
  win: {
    re: /(\d+) 文件 \/ (\d+) passed \| (\d+) skipped（(\d+) 条注册）/,
    files: 1,
    group: 4,
    name: "本机那一格的注册数"
  }
};

const EQUATIONS = [
  {
    name: "Linux 侧注册数 = 本机注册数 − 平台多注册的那几条",
    re: /Linux 侧 (\d+) 条注册 = 本机 (\d+) − (\d+)/,
    check: ([linux, win, delta]) => linux + delta === win,
    ties: [
      { at: 1, cell: "linux" },
      { at: 2, cell: "win" }
    ]
  },
  {
    name: "本机 passed + skipped = 本机注册数",
    re: CELLS.win.re,
    check: ([, passed, skipped, reg]) => passed + skipped === reg
  },
  {
    // 历史那一轮（`6c1fb91` → `3a8dcc7`，拆分前只有一份门面守卫文件的年代）。第五十四节起顶格不再是
    // 4113，所以这一处**不再对表**——它只算自己那两句差值。对表由下面那处接手。
    name: "历史那一轮测试数之差 = 门面守卫那一文件的条数之差",
    re: /从 (\d+) 到 (\d+) 差的 (\d+) 条[^。；;]*?用例数从 (\d+) 条加到 (\d+) 条/,
    check: ([from, to, diff, tFrom, tTo]) => to - from === diff && tTo - tFrom === diff
  },
  {
    // 同样是历史那一轮：第五十七节把顶格换绑到 `a953b12`（4125）之后，4113/4123 那一格不再是顶格，
    // 所以这一处也**摘掉 `ties`**，只算自己那两句差值——与上一处同一形状，对表交给下面那处。
    name: "历史那一轮测试数之差 = 门禁组成族 + CI 报数守卫族",
    re: /从 (\d+) 到 (\d+) 差的 (\d+) 条[^。；;]*?那一族 (\d+) 条 \+ CI 报数守卫 (\d+) 条/,
    check: ([from, to, diff, split, reporter]) => to - from === diff && split + reporter === diff
  },
  {
    // 第五十七节回填（顶格换绑到 `a953b12`）新起的那处：门面守卫自己加的两条断言对上顶格那格的增量。
    // 第六十一节把顶格换绑到 `2f0808e`（4130）之后，4123/4125 那一格不再是顶格，所以这一处**摘掉 `ties`**、
    // 只算自己那两句差值——与上面两处同一形状，接手对表的是下面那处。门面上那句话照旧留着，`re` 抓不到就先红。
    name: "顶格那一轮测试数之差 = 第十四道 + 第十五道",
    re: /从 (\d+) 到 (\d+) 差的 (\d+) 条[^。；;]*?第十四道 (\d+) 条 \+ 第十五道 (\d+) 条/,
    check: ([from, to, diff, g14, g15]) => to - from === diff && g14 + g15 === diff
  },
  {
    // 第六十一节回填（顶格换绑到 `2f0808e`，Linux 侧 4130）新起的那处：4125→4130 那 5 条正是第六十节
    // 那 5 道归属闸。差值由 `git show` 两枚树上的 `^test(` 行数当场数得（092f648 的 6 道 → 2f0808e 的 11 道），
    // 与门面那句写的是同一件事。第一百零三节把顶格换绑到 `83f6eaa`（4683）、第一百零六节再换到 `19c3065`（4687）、
    // 第一百一十一节再换到 `2d26be3`（4720）之后，4130 这一格不再是顶格，而且 4130→4720 那 590 条跨了三十多个提交、
    // 不属于任何一门面守卫族，
    // 凑不出一条能自证的新差值等式，
    // 所以这一处**摘掉 `ties`**、只算自己那两句差值（与上面三处同一形状）。顶格那两格仍被 EQUATIONS 第 1 条
    // 与第十二、十五道钉着，不靠这一处对表。门面上那句话照旧留着，`re` 抓不到就先红。
    name: "顶格那一轮测试数之差 = 第十六道",
    re: /从 (\d+) 到 (\d+) 差的 (\d+) 条[^。；;]*?第十六道 (\d+) 条/,
    check: ([from, to, diff, g16]) => to - from === diff && g16 === diff
  }
];

test("门禁那一节写出来的每一处等式都得自己算得过，每一处都得还在门面上有实例，而且两侧同树那两格的文件数得对上", () => {
  const flat = flatten(gateSection().replace(/「[^」]*」/g, ""));
  const cells = {};
  const files = {};
  for (const [key, cell] of Object.entries(CELLS)) {
    const m = cell.re.exec(flat);
    expect(
      m,
      `门面上找不到${cell.name}的写法了——等式闸失去对表的参照，` +
        "「ties」那一层此刻一条也没测（第三十八节：判据的一支没有实例＝那一支没测）"
    ).not.toBeNull();
    cells[key] = Number(m[cell.group]);
    files[key] = Number(m[cell.files]);
  }
  // 「两侧同一棵干净提交树」这句话在门面上出现的地方，读数是**两格**，而用例文件的数目不随平台变
  // （变的只有一枚文件里注册几条，见 `tools/platform-test-count.test.mjs` 那笔 ±3 账）：
  // 所以两格的文件数不同 ⇒ 要么两侧根本不同树，要么有一侧的数不是读来的。
  expect(
    files.linux,
    `门面上 CI 那一格的文件数是 ${files.linux}，本机那一格是 ${files.win} —— 两侧都主张跑在同一棵干净提交树上，` +
      "可文件数目不随平台变，两边不一致就只有两种解释：不同树，或者其中一格是抄的（第五十四节 M56 量的就是这一条）"
  ).toBe(files.win);
  for (const eq of EQUATIONS) {
    const m = eq.re.exec(flat);
    expect(
      m,
      `门面上找不到「${eq.name}」的写法了——这一处此刻没有实例，等式闸对它静默失效。` +
        "要么把门面那一句改回可核对的写法，要么连这条判据一起改（第四十二节那条教训）"
    ).not.toBeNull();
    const nums = m.slice(1).map(Number);
    expect(
      eq.check(nums),
      `门面上这处等式算不过：读到的数是 ${nums.join(", ")}（原文「${m[0]}」）——` +
        "跨格的数只 bump 一边，门面就自己跟自己不一致了（免责段明说过的那件事）"
    ).toBe(true);
    for (const tie of eq.ties ?? []) {
      expect(
        nums[tie.at - 1],
        `「${eq.name}」的第 ${tie.at} 个数读成 ${nums[tie.at - 1]}，可它所描述的那一格（${CELLS[tie.cell].name}）现在是 ${cells[tie.cell]} —— ` +
          "顶格 bump 了而等式没跟着动（或反过来）。这一处该红的是「对表」，不是那句算术。"
      ).toBe(cells[tie.cell]);
    }
  }
});

/**
 * 门面**同树声明**闸（2026-10-13，第五十一节，第十二道）。
 *
 * 病灶是本刀自己撞出来的：把顶格两格从 `e5d4046` 换绑到 `3a8dcc7` 时，我先改完两格与平台账，
 * 隔了几分钟才回头改免责段那句「上面门禁那两格是在 … 上**两侧同树**读回的数」。中间那段门面上
 * 两格指着 `3a8dcc7`、免责段还留着上一刀的 `e5d4046`——说的就是假话，而前面十一道一条都不红
 * （变异 M25 实测：只把免责段那一枚哈希改回 `e5d4046`，11 条全绿）。
 * 等式闸对表的是**数字**跨格，可「这一组数跑在哪一棵树上」这句话在门面上出现三处（CI 那格、
 * 本机那格、免责段），一处也没跟另一处对过。而「同树」恰恰是那两格的全部前提：两侧不同树，
 * 那 1 条的平台差就无从解释，门面却还在替它担保。
 *
 * 判据两层，少一层就留一条脱身通路：
 * 1. **对表**：门禁那一节里既写着同树类主张（`同树` / `同一棵树` / `干净提交树`）、又点名了短哈希的
 *    那些句子，点名的必须是**同一枚**——bump 任何一处而忘另一处即红。
 * 2. **实例声明**：这样的句子至少 2 处。只剩一处时「全部相等」必然空转（第四十二节那条教训：
 *    提取写坏比门面写错更糟，守卫会静默失效）。
 *
 * 取枚用 `tools/readme-gate-facts.mjs` 导出的那枚 `SHA_G`（反引号十六进制），只加一道**长度**判据：
 * 门面上的树哈希固定写 7 位，
 * 于是 run 页 ID（11 位纯数字）与 64 位 sha256 都不会被当成树哈希——不另起第二份正则，是因为
 * 一份「反引号十六进制」的写法只该有一个定义处（锁定前提第 6 条）。真出现 8 位以上写法的树哈希时，
 * 这一臂会因实例数不足而红，届时要么统一门面写法，要么连这里一起改。
 */
const SAME_TREE_CLAIM = /同树|同一棵树|干净提交树/;

/** 句子里被反引号包着、长度正好 7 位的短哈希；run 页 ID 与 sha256 由长度这一道筛掉。 */
function treeHashes(sentence) {
  return [...sentence.matchAll(SHA_G)].map((m) => m[0].slice(1, -1)).filter((h) => h.length === 7);
}

function sameTreeSites() {
  const flat = flatten(gateSection().replace(/「[^」]*」/g, ""));
  return flat
    .split(/[。；;]/)
    .filter((s) => SAME_TREE_CLAIM.test(s))
    .map((s) => ({ sentence: s.trim().slice(0, 70), hashes: treeHashes(s) }))
    .filter((x) => x.hashes.length > 0);
}

test("门面上每一处同树声明点名的必须是同一枚短哈希，而且这样的声明不能只剩一处", () => {
  const sites = sameTreeSites();
  expect(
    sites.length,
    "「## 门禁」那一节里只有 " +
      sites.length +
      " 处「同树／同一棵树／干净提交树」的声明点名的短哈希——少于 2 处时「各处必须相等」会空转，" +
      "这一臂此刻等于没测：要么门面把同树说法改到不再带哈希，要么提取写坏了"
  ).toBeGreaterThan(1);
  const uniq = [...new Set(sites.flatMap((x) => x.hashes))];
  expect(
    uniq.length,
    "门面上的同树声明指向了 " +
      uniq.length +
      " 枚不同的短哈希：" +
      sites.map((x) => `${x.hashes.join("/")}←「${x.sentence}」`).join(" ／ ") +
      "——顶格两格 bump 了而免责段还留着旧树（或反过来）：两侧不同树，那 1 条平台差就没人解释了"
  ).toBe(1);
});

/**
 * 门面**守卫条数**闸（2026-10-14，第五十五节，第十四道）。
 *
 * 病灶登记在 §五十四 末段，本刀把它从"台账里的一次性回读"变成常驻闸：门面上按文件点名的条数
 * ——`tools/ci-gate.test.mjs`（6 条）、`tools/readme-gate-composition.test.mjs`（2 道）、以及拆分那一句里的
 * 「原文件留 N 道」——**全仓没有一条断言核对过它们**。M57 那一跑顺带证明了另一半：
 * 门面散文里的数与 quoted 的报数原文都不在判据眼里，只有写成等式的跨格算式才被第九道闸对表——
 * 而「某份守卫文件有几条」恰好既不是等式、也没有别的闸管。它的失效形态与 2026-10-09 那枚
 * 「当前 215 文件 / 3014 用例」一模一样：文件加了一条断言，门面上那句还在说旧数，
 * 而这句话正是下一个人决定「要不要再拆一份文件」的依据。
 *
 * 只管**现在时**的点名，两种写法分开：
 * 1. `` `tools/<file>.test.mjs`（N 条|道） `` —— 反引号紧跟全角括号里的数，读的是这份文件**此刻**几条。
 * 2. 「原文件留 N 道」—— 第五十二节拆分那一句留下的说法，指本文件自己。
 *
 * 历史那一族（「用例数从 3 条加到 11 条」「门禁组成那一族 2 条 + CI 报数守卫 8 条」）**故意不管**：
 * 它们各自写了 `git show <rev>:<file>`，对的是那枚树上的行数，不是此刻。这条分界有自己的脱身通路——
 * 给现役那句前缀一个 `git show …:` 就能躲开本闸——所以第 1 臂带实例声明（>1 站）：两站都前缀掉就红，
 * 与第十二道闸同一形状（判据的一支没有实例＝那一支没测，第三十八节）。
 *
 * 数法与门面那句说的是同一件东西：**行首 `test(` 的行数**。不在别处再写第二份定义（锁定前提第 6 条）；
 * `it(` 与 `describe(` 不计，因为门面上那些数说的就是一个文件里有几条 `test(`。
 */
const GUARD_COUNT_CLAIM = /`tools\/([\w.-]+\.test\.mjs)`（(\d+) [条道]）/g;
const SELF_COUNT_CLAIM = /原文件留 (\d+) 道/;

/** 一份守卫文件此刻有几条 `test(`——门面点名的那些数就对着它算。 */
function liveTestCount(relPath) {
  const abs = path.join(ROOT, relPath);
  expect(fs.existsSync(abs), `门面上点名了 ${relPath}，可仓库里没有这份文件`).toBe(true);
  return fs
    .readFileSync(abs, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("test(")).length;
}

/** 门面里「现在时」的条数点名：路径型站点 + 「原文件留 N 道」这一站。 */
function guardCountSites() {
  const flat = flatten(gateSection().replace(/「[^」]*」/g, ""));
  const sites = [];
  for (const m of flat.matchAll(GUARD_COUNT_CLAIM)) {
    const prefix = flat.slice(Math.max(0, m.index - 30), m.index);
    if (/git\s+show/.test(prefix)) continue;
    sites.push({ at: `tools/${m[1]}`, claimed: Number(m[2]), raw: m[0] });
  }
  const self = SELF_COUNT_CLAIM.exec(flat);
  if (self)
    sites.push({ at: "tools/readme-claims.test.mjs", claimed: Number(self[1]), raw: self[0] });
  return sites;
}

test("门面上按文件点名的守卫条数必须等于那份文件此刻的 test( 行数", () => {
  const sites = guardCountSites();
  expect(
    sites.length,
    "「## 门禁」那一节里只提取到 " +
      sites.length +
      " 处「`tools/*.test.mjs`（N 条/道）」或「原文件留 N 道」的点名——少于 2 处时这条闸会空转：" +
      "给现役那句前缀一个 `git show …:` 就能躲开本闸，所以门面至少要留两站现在时的点名"
  ).toBeGreaterThan(1);
  const checked = sites.map((s) => ({ ...s, live: liveTestCount(s.at) }));
  const drifted = checked.filter((s) => s.live !== s.claimed);
  expect(
    drifted,
    "门面上这些条数已经不是那份文件的真身：" +
      drifted
        .map((s) => `${s.at} 门面写 ${s.claimed} 条，此刻数 ${s.live} 条（「${s.raw}」）`)
        .join(" ／ ") +
      "——加断言的人没回头改门面，这就是 2026-10-09 那枚冻死的「当前 215 文件 / 3014 用例」的下一代"
  ).toEqual([]);
});

/**
 * 门面**quoted 的 CI 原文与「两侧都是 N」那句文件数**闸（2026-10-14，第五十六节，第十五道）。
 *
 * 病灶由 M57 量出来，不是猜的：门面上写着
 * 「两枚 run 各自把 `files=315 registered=4123 passed=4123 skipped=0 failures=0` 写成一条 annotation」
 * 和「文件数那一格两侧都是 315」这两句话，而**全仓没有一条断言读过括号里的数字**。
 * 第九道闸（等式）只看写成等式的跨格算式，且它对文件数那一臂钉的是「两格彼此相等」——
 * 于是把顶格两格**一起**从 315 改成 316，第九道照绿，而 quoted 的 CI 原文与那句散文还在说 315。
 * 这正是 M57 那一跑复现出来的形状：只 bump 一边的确会红，两边一起 bump 或引用侧不动，则一句假话都不报。
 *
 * 失效形态与 2026-10-09 那枚冻死的「当前 215 文件 / 3014 用例」同一件东西，只是这次坏在**引用侧**：
 * CI 报数原文是门面里唯一一处「不是手写读数、而是 CI 自己吐出来的字符串」，
 * 它一旦与顶格那两格脱钩，门面就在拿一份旧 annotation 替当下的树背书。
 *
 * 三层判据，少一层就留脱身通路（与第十、十三、十四道同一形状）：
 * 1. **实例声明**：quoted 原文与「两侧都是 N」两类站点各至少一处。提取不到即红——
 *    把现役那句删掉或改写就不测，是这一族最便宜的作弊法（第三十八节）。
 * 2. **文件数对表**：每处 quoted 原文的 `files=` 与每处「两侧都是 N」的 N，都必须等于顶格两格的文件数
 *    （两格本身由第九道钉成同值，这里取 Linux 那一格为参照）。
 * 3. **用例数对表**：每处 quoted 原文的 `registered=` 与 `passed=` 都必须等于 Linux 那一格的用例数。
 *
 * **本闸不钉历史**：门面上「CI 在 `05b1d53` 报 313 文件 / 4112 用例」那种连着哈希的历史句**不是**这两种形状，
 * 天然不在提取范围里；但**quoted 的 annotation 原文只许有一份现役**——若将来真要在门面引一枚历史 annotation，
 * 这一臂会当场红，那时要么把历史引用改写成不带 `files=…` 字面量的说法，要么连这条判据一起改（第四十二节那条教训）。
 * 数法与顶格两格共用 `CELLS` 那一份正则，不另写第二份定义（锁定前提第 6 条）。
 */
const ANNOTATION_QUOTE =
  /`files=(\d+) registered=(\d+) passed=(\d+) skipped=(\d+) failures=(\d+)`/g;
const BOTH_SIDE_FILES = /文件数[^。；;]*?两侧都是\s*(\d+)/g;

/** 顶格两格的文件数与 Linux 用例数——用第九道那两份正则读，不重写。 */
function liveFacadeCells() {
  const flat = flatten(gateSection().replace(/「[^」]*」/g, ""));
  const linux = CELLS.linux.re.exec(flat);
  const win = CELLS.win.re.exec(flat);
  expect(
    linux && win,
    "读不出顶格那两格了（`CELLS` 的两份正则有一条不匹配）——本闸失去参照，一条也测不到"
  ).toBeTruthy();
  return {
    linuxFiles: Number(linux[CELLS.linux.files]),
    linuxCases: Number(linux[CELLS.linux.group]),
    winFiles: Number(win[CELLS.win.files])
  };
}

test("门面 quoted 的 CI 原文与「两侧都是 N」那句文件数，必须与顶格那两格同枚", () => {
  const flat = flatten(gateSection().replace(/「[^」]*」/g, ""));
  const quotes = [...flat.matchAll(ANNOTATION_QUOTE)];
  const prose = [...flat.matchAll(BOTH_SIDE_FILES)];
  expect(
    quotes.length,
    "「## 门禁」那一节里提取到 " +
      quotes.length +
      " 处 quoted 的 CI annotation 原文（`` `files=… registered=… passed=…` ``）——一处都没有时本闸第二、三臂全部空转，" +
      "把那句改写或删掉就等于关掉本闸，所以实例声明先红"
  ).toBeGreaterThan(0);
  expect(
    prose.length,
    "「## 门禁」那一节里提取到 " +
      prose.length +
      " 处「文件数…两侧都是 N」的散文说法——一处都没有时本闸第二臂只剩 quoted 一半，" +
      "门面不该出现「两侧都是」这种没有数可对的句式"
  ).toBeGreaterThan(0);

  const cells = liveFacadeCells();
  const bad = [];
  for (const m of quotes) {
    const [, files, registered, passed] = m.map(Number);
    if (files !== cells.linuxFiles || files !== cells.winFiles)
      bad.push(`${m[0]} 的文件数是 ${files}，顶格两格是 ${cells.linuxFiles}/${cells.winFiles}`);
    if (registered !== cells.linuxCases)
      bad.push(`${m[0]} 报 registered=${registered}，Linux 那一格的用例数是 ${cells.linuxCases}`);
    if (passed !== cells.linuxCases)
      bad.push(`${m[0]} 报 passed=${passed}，Linux 那一格的用例数是 ${cells.linuxCases}`);
  }
  for (const m of prose) {
    if (Number(m[1]) !== cells.linuxFiles)
      bad.push(`「${m[0]}」说 ${m[1]}，顶格两格的文件数是 ${cells.linuxFiles}/${cells.winFiles}`);
  }
  expect(
    bad,
    "门面上这些引用侧的数已经不是顶格那两格的真身：" +
      bad.join(" ／ ") +
      "——引用侧与读数侧脱钩，门面就在拿一份旧 annotation 替当下的树背书（M57 量的正是这条通路）"
  ).toEqual([]);
});

import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * 三类主张（第三类是 2026-10-13 补的：「门禁」那一节里每条测试数必须说清跑在哪棵树上——
 * 宣称跑在干净/已提交的树上就得给一枚反引号提交哈希，只有明写未跟踪/未入库/未提交的数才免。
 * 只留一个裸数就是当年那枚「215 文件 / 3014 用例」的下一代）。
 * 每一类都带一条"提取到东西没有"的自我声明：正则写坏了会让守卫**空跑即绿**，那比没有守卫更糟。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

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

function scriptsOf(pkgJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  return new Set(Object.keys(pkg.scripts || {}));
}

const rootScripts = scriptsOf(path.join(ROOT, "package.json"));
const desktopScripts = scriptsOf(path.join(ROOT, "apps/desktop/package.json"));

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
 */
function gateSection() {
  const start = readme.indexOf("## 门禁");
  if (start < 0) throw new Error("README 里找不到「## 门禁」这一节——门面改名的那一刻这条闸就该红");
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, next < 0 ? readme.length : next);
}

// 不带 `g`：这里只用 `.test()` 判断句子，带 `g` 会让 `lastIndex` 跨句残留，把第二条主张误判成没有。
const COUNT_CLAIM = /\d+\s*文件\s*\/\s*[\d,]+\s*(?:用例|passed)/;
const DATE = /\d{4}-\d{2}-\d{2}/;
const SHA = /`[0-9a-f]{7,}`/;
/** 只有这三个词算「明写这棵树不干净」；见上面那段 R1 的教训。 */
const DIRTY_TREE = /未跟踪|未入库|未提交/;
/** 宣称树干净的写法：出现即要求哈希，哪怕同一句里还带着脏树词。 */
const CLEAN_TREE = /干净|零脏项|已提交|读回\s*0\s*条/;

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
  const naked = claims.filter((s) => !(DATE.test(s) && (SHA.test(s) || dirtyWorded(s))));
  expect(
    naked,
    "这些测试数没连着出处：要么缺日期，要么既没给反引号提交哈希、也没明写「未跟踪/未入库/未提交」" +
      "（宣称跑在干净或已提交的树上时，只有哈希算出处）——" +
      naked.map((s) => s.trim().slice(0, 70)).join(" ／ ")
  ).toEqual([]);
});

/**
 * 干净支的**实例声明**（本文件唯一一条不判对错、只数「门面里有没有这种写法」的断言）：
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

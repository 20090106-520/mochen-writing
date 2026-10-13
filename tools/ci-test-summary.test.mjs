import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  JUNIT_OUTPUT_FILE,
  NOTICE_TITLE,
  formatNoticeBody,
  parseJUnit
} from "./ci-test-summary.mjs";

/**
 * CI 自己报数（2026-10-14，第五十三节）。
 *
 * 病灶不是「CI 没跑」，是**CI 跑完没人读得到数**：门面那格 Linux 侧的用例数从第一天起就是
 * 「本机数 − 3」推出来的（§三十六 那笔平台账），要把它读成一个**数**只有两条路，两条都不可靠——
 * `actions/jobs/<id>/logs` 未认证 403，浏览器面板一隐藏 GitHub 就连日志都不抓
 * （§五十二 实测：`#check-step-7` 的 `innerText` 停在 17 字符）。同树回填因此每刀都卡在半边。
 *
 * 而 `check-runs/<id>/annotations` 这一条**当场探过是通的**（未认证 200，空数组）——
 * 也就是说 GitHub 早就给了一条能读的通路，缺的只是**把数写进去**。所以这份守卫钉的是四件可失败的事：
 * ① 数有人产（vitest 的内置 junit reporter 真在配置里，且路径**只有一处定义**）；
 * ② 数有人报（工具解析 junit、报不出数就当场炸，绝不空跑）；
 * ③ 报数那一步真接在 CI 上，且**不吞上面任何退出码**（`if: success()`：verify 红时它不该跑，
 *    跑出来的红会抢走归因）；
 * ④ 三处（config / 工具 / yml）说的是同一条路径与同一个标题——本仓的老规矩，
 *    一个事实散在多处就必须对表，否则改一处其余两处静默过期。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools", "ci-test-summary.mjs");
const CONFIG = path.join(ROOT, "vitest.config.ts");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "verify.yml");

/** 一份最小可用的 junit：两枚文件、6 条注册、1 条 skip。 */
const FIXTURE_OK = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="6" failures="0" errors="0" time="1.0">
    <testsuite name="a.test.ts" tests="4" failures="0" errors="0" skipped="1" time="0.5">
    </testsuite>
    <testsuite name="b.test.ts" tests="2" failures="0" errors="0" skipped="0" time="0.5">
    </testsuite>
</testsuites>`;

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s53-junit-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 起真身进程：只认退出码 + stdout/stderr，不 mock——本刀要钉的就是「炸得响亮」。 */
function runTool(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("junit 路径与 annotation 标题各只有一处定义，且工具真导出它们", () => {
  expect(JUNIT_OUTPUT_FILE, "路径必须是仓根相对的正斜杠写法（CI 与本机都要能用）").toBe(
    "test-results/junit.xml"
  );
  expect(NOTICE_TITLE, "标题是读者在 run 页认的那句话，不许随手改").toBe("CI 用例总数");
  const src = fs.readFileSync(TOOL, "utf8");
  // 第二份定义：同一枚字面量在工具里写两遍，改一处另一处照旧绿——本仓的锁定前提第 6 条。
  const pathDefs = [
    ...src.matchAll(/^\s*(?:export )?const \w+\s*=\s*["']test-results\/junit\.xml["']/gm)
  ];
  expect(pathDefs, `工具里 junit 路径被定义了 ${pathDefs.length} 次，应恰好 1 次`).toHaveLength(1);
});

test("parseJUnit 数得出文件数、注册数与 skip，passed 由减法派生", () => {
  const c = parseJUnit(FIXTURE_OK);
  expect(c).toEqual({ files: 2, registered: 6, skipped: 1, passed: 5, failures: 0 });
  expect(formatNoticeBody(c)).toBe("files=2 registered=6 passed=5 skipped=1 failures=0");
});

test("parseJUnit 对五种坏数据一律当场抛，不许静默报个数", () => {
  const bad = [
    ["整份没有 testsuites 头", '<?xml version="1.0"?><suites></suites>', /testsuites/],
    ["某枚文件缺 skipped 属性", FIXTURE_OK.replace(' skipped="1"', ""), /skipped/],
    [
      "逐文件之和不等于总数（截断的半份报告）",
      FIXTURE_OK.replace('tests="6"', 'tests="9"'),
      /不等于|对不上/
    ],
    [
      "一条用例都没注册（空跑）",
      FIXTURE_OK.replace(/tests="\d+"/g, 'tests="0"').replace('skipped="1"', 'skipped="0"'),
      /0/
    ],
    // 第五条是 `skipped > registered` 那一抛：前四条都拦不住它，而它一抛不出就等于
    // 「passed 由减法派生」时能算出负数——负数报上 run 页比不报更糟。
    [
      "skip 比注册数还大（减法会算出负 passed）",
      FIXTURE_OK.replace('skipped="0"', 'skipped="7"'),
      /对不上/
    ]
  ];
  for (const [label, xml, reason] of bad) {
    let threw = null;
    try {
      parseJUnit(xml);
    } catch (err) {
      threw = String(err.message ?? err);
    }
    // 先钉「抛没抛」再钉「理由对不对」：合成一句 `.toMatch` 时，没抛会让 vitest 自己
    // 抛 `TypeError: toMatch() expects a string`，把 `label` 那句中文理由整个吞掉——
    // M43 实测出这条差异（红是红了，但红了看不出是哪一种坏数据被放过）。
    expect(threw, `${label}：parseJUnit 没有抛——恒报数就是恒可能报错数`).toBeTypeOf("string");
    expect(threw, `${label}：抛了，但理由不是那句（当前：${threw}）`).toMatch(reason);
  }
});

test("工具真身：报告在场就报数，报告缺失就非零退出", () => {
  withTemp((dir) => {
    const good = path.join(dir, "junit.xml");
    fs.writeFileSync(good, FIXTURE_OK, "utf8");
    const ok = runTool(["--junit", good]);
    expect(ok.code, `真身退出码不是 0：${ok.out}`).toBe(0);
    expect(ok.out).toContain(`::notice title=${NOTICE_TITLE}::`);
    expect(ok.out).toContain("registered=6");

    const missing = runTool(["--junit", path.join(dir, "nope.xml")]);
    expect(missing.code, "找不到 junit 报告却退出 0——那等于让 CI 空跑装绿").not.toBe(0);
    expect(missing.out).toContain("test-results");
  });
});

test("GITHUB_STEP_SUMMARY 里也落同一份数（人看的那一面与机器读的那一面同源）", () => {
  withTemp((dir) => {
    const good = path.join(dir, "junit.xml");
    const summary = path.join(dir, "step-summary.md");
    fs.writeFileSync(good, FIXTURE_OK, "utf8");
    const r = runTool(["--junit", good], { GITHUB_STEP_SUMMARY: summary });
    expect(r.code, `带 summary 通路时退出码不是 0：${r.out}`).toBe(0);
    expect(fs.existsSync(summary), "设了 GITHUB_STEP_SUMMARY 却没写进去").toBe(true);
    const text = fs.readFileSync(summary, "utf8");
    expect(text).toContain("registered=6");
    expect(text).toContain(NOTICE_TITLE);
  });
});

test("vitest 配置真在产 junit，而且 default reporter 没被顶掉", () => {
  const text = fs.readFileSync(CONFIG, "utf8");
  expect(text, "vitest.config.ts 里没有 reporters 段——CI 就没有数可报").toMatch(/reporters/);
  // 只认「reporters 里有一枚 `["default"]`」这个形状，而且只在 `reporters` 之后的文里找：
  // 整份原文里 `default` 一词到处都是（第 3 行 `export default`、上面那句「default 给终端」的注释），
  // 拿宽正则当证据的话这条臂永远绿——M47 实测把 `["default"]` 删掉后用例照样绿，就是这个原因。
  const afterReporters = text.slice(text.indexOf("reporters"));
  expect(
    afterReporters,
    'reporters 里没有 ["default"]——逐文件条数只有 default reporter 看得见，CI 日志会只剩一个总数'
  ).toMatch(/\[\s*["']default["']\s*\]/);
  expect(text).toMatch(/junit/);
  // 路径对表：配置里写的 outputFile 必须等于工具认的那一枚。
  const out = text.match(/outputFile\s*:\s*["']([^"']+)["']/);
  expect(out, `vitest.config.ts 里找不到 outputFile 字面量——那 CI 读的是哪份文件？`).not.toBeNull();
  expect(out[1], `配置写「${out[1]}」而工具认「${JUNIT_OUTPUT_FILE}」——两边各说各话`).toBe(
    JUNIT_OUTPUT_FILE
  );
});

test("verify.yml 恰好一步跑这个工具，且那一步是 if: success() 而不是 always()", () => {
  const yml = fs.readFileSync(WORKFLOW, "utf8");
  const lines = yml.split("\n");
  const calls = lines.filter((l) => /node\s+tools\/ci-test-summary\.mjs/.test(l));
  expect(
    calls,
    `跑报数工具的步骤有 ${calls.length} 条——0 条=没接线（本闸空跑），≥2 条=没有唯一所指`
  ).toHaveLength(1);
  // 步骤块：从这条 run 往上找它的 name / if。
  const idx = lines.findIndex((l) => /node\s+tools\/ci-test-summary\.mjs/.test(l));
  const block = lines.slice(Math.max(0, idx - 6), idx + 1).join("\n");
  expect(block, "报数步骤没有 if: success()——verify 红时它也跑，多一枚红步骤会抢走归因").toMatch(
    /^\s*if:\s*success\(\)\s*$/m
  );
  expect(block).toMatch(/name:/);
  // 吞码写法在这一步同样不许出现（ci-gate 那条闸管的是整份 yml，这里管这一段新写的）。
  expect(block).not.toMatch(/\|\s*(tail|head|grep)\b/);
  expect(yml, "标题在 yml 里又写了一遍——那是第二处口径").not.toContain(NOTICE_TITLE);
});

test(".gitignore 收了 test-results/，否则本机每跑一次 test 就把仓库弄脏", () => {
  const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  expect(gitignore, ".gitignore 里没有 test-results/——跑一次 pnpm test 就脏一条").toMatch(
    /^\/?test-results\/?$/m
  );
});

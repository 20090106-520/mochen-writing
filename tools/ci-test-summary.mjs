import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI 自己把用例总数报成一条 annotation（2026-10-14，第五十三节）。
 *
 * 为什么要有这份文件：门面上 Linux 侧那个数**从第一天起就是推出来的**（本机注册数 − 平台那 3 条），
 * 想读回它只有两条路，两条都不可靠——`actions/jobs/<id>/logs` 未认证 403，浏览器面板一隐藏
 * GitHub 连日志都不抓（§五十二 实测 `#check-step-7` 的 `innerText` 停在 17 字符）。
 * 而 `check-runs/<id>/annotations` 当场探过是**未认证 200**：GitHub 早给了能读的通路，缺的只是把数写进去。
 *
 * 数从哪来：vitest 自带的 junit reporter（零新依赖）把逐文件与总数落进 `test-results/junit.xml`，
 * 本文件只读那份 XML，并把它**同时**报给两个读者——机器读的 `::notice::` 与人看的 `$GITHUB_STEP_SUMMARY`，
 * 两边都由同一个 `formatNoticeBody` 生成，不各写一份文案。
 *
 * 一条硬规矩：**报不出数就当场非零退出**，不许退成 0 附上一句"没有报告"。这一步接在 `pnpm verify` 之后
 * （`if: success()`），它自己红不会改变 job 结论；但要是它哪天在绿 verify 之后还红，那正是
 * 「配置里的 reporter 被谁摘了」这件真事第一次能被读到的时刻。
 */

/** junit 报告的路径（仓根相对、正斜杠）。这一枚字面量**只在这里定义一次**，config 与守卫都对表它。 */
export const JUNIT_OUTPUT_FILE = "test-results/junit.xml";

/** run 页上读者认的那句标题。同样只定义一次：yml 与门面都不许另写一份。 */
export const NOTICE_TITLE = "CI 用例总数";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function required(tag, name, label) {
  const raw = attr(tag, name);
  if (raw === null) throw new Error(`${label} 缺 "${name}" 属性——数不出来就不报，别拿半个数当真数`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} 的 "${name}" 读不成非负整数（当前是「${raw}」）`);
  }
  return n;
}

/**
 * 读一份 vitest junit，返回 { files, registered, skipped, passed, failures }。
 * 五种坏数据一律抛：没有 testsuites 头、逐文件缺属性、逐文件之和与总数对不上（截断的半份报告）、
 * 一条用例都没注册（空跑）、skip 比注册还大（减法会算出负 passed）。抛，而不是返回 0——
 * 恒报数的代码等于恒可能报错数。
 */
export function parseJUnit(xml) {
  const header = xml.match(/<testsuites\b[^>]*>/);
  if (!header) throw new Error("这份 junit 里没有 <testsuites> 头，读不出总数");
  const registered = required(header[0], "tests", "<testsuites> 头");
  const failures = required(header[0], "failures", "<testsuites> 头");
  const suites = [...xml.matchAll(/<testsuite\s[^>]*>/g)].map((m) => m[0]);
  if (suites.length === 0)
    throw new Error("junit 里一枚 <testsuite> 都没有：没有逐文件条数，总数无从对照");
  let sum = 0;
  let skipped = 0;
  for (const tag of suites) {
    const label = attr(tag, "name") ?? "<testsuite>";
    sum += required(tag, "tests", label);
    skipped += required(tag, "skipped", label);
  }
  if (sum !== registered) {
    throw new Error(
      `逐文件 tests 之和 ${sum} 不等于 <testsuites> 头的 ${registered}——半份报告（跑中断了？）不当数报`
    );
  }
  if (registered === 0) throw new Error("注册用例数是 0：一条都没跑上，这不能报成「门禁过了」");
  if (skipped > registered)
    throw new Error(`skipped ${skipped} 比注册 ${registered} 还大，XML 对不上`);
  return { files: suites.length, registered, skipped, passed: registered - skipped, failures };
}

/** 两个读者共用这一句文案：机器面（annotation）与人面（step summary）不许各长一份。 */
export function formatNoticeBody(c) {
  return `files=${c.files} registered=${c.registered} passed=${c.passed} skipped=${c.skipped} failures=${c.failures}`;
}

function resolveReportPath(argv) {
  const i = argv.indexOf("--junit");
  if (i !== -1) {
    const next = argv[i + 1];
    if (!next) throw new Error("--junit 后面要跟路径");
    return path.resolve(next);
  }
  return path.join(ROOT, JUNIT_OUTPUT_FILE);
}

export function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const file = resolveReportPath(argv);
  if (!fs.existsSync(file)) {
    throw new Error(
      `找不到 junit 报告：${file}\n（默认路径 ${JUNIT_OUTPUT_FILE}，由 vitest.config.ts 的 reporters 产出）`
    );
  }
  const counts = parseJUnit(fs.readFileSync(file, "utf8"));
  const body = formatNoticeBody(counts);
  process.stdout.write(`::notice title=${NOTICE_TITLE}::${body}\n`);
  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(summary, `**${NOTICE_TITLE}**（junit：${JUNIT_OUTPUT_FILE}）\`${body}\`\n`);
  }
  return counts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

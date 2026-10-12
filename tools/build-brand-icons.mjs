/**
 * 品牌图 → `icon.ico`（跨平台，零新依赖）。替代原先只在 Windows PowerShell 5.1 能跑的
 * `tools/build-brand-icons.ps1`（扫描总单 P2-12 可移植性那一子项）。
 *
 * 与那份脚本的**责任划分**说清楚，免得下一个人以为换了画师：
 * - 不裁切、不重绘、不另生成：源图整幅缩到各档边长（源图 1254×1254 是方的，所以是等比缩放，
 *   没有拉伸），遵循「用户提供的品牌图原样使用，只做格式转换」那条既定规则；
 * - 容器字段逐字对齐旧脚本（PNG 压缩条目、`planes=1`、`bits=32`、256 的宽高字节写 0），
 *   那份逻辑住在 `ico-container.mjs` 里，纯 Node、可单测、任何平台一样跑；
 * - **只有重采样需要图像栈**，于是一律交给本仓已经装着的 Electron `nativeImage`
 *   （目录里 `apps/desktop/node_modules/electron`，版本由 catalog 钉死）。
 *   这意味着这一刀的产物**不保证与旧 .ico 逐字节相同**（System.Drawing 的 HighQualityBicubic
 *   与 Chromium 的缩放核不是同一个核）——所以这台生成器**没有默认输出路径**：不带 `--out` 就当场失败，
 *   一行像素都不写。想覆盖盘上那枚已入库的 `resources/icon.ico` 必须点名它；像素口径要换，那是品牌
 *   资产的决定，得用户点头。
 *
 * 用法：
 *   node tools/build-brand-icons.mjs --out <路径>     # 必填；普通 Node 会自己把活儿交给 Electron 再跑一遍
 *   档位默认 16,24,32,48,64,128,256，可用 --sizes 16,32,256 改。
 *   没有默认输出路径：不带 `--out` 直接报错退出，一行像素都不写。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildIco, parseIco } from "./ico-container.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.join(
  ROOT,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "assets",
  "brand",
  "mochen-lockup.jpg"
);
const TRACKED_OUTPUT = path.join(ROOT, "apps", "desktop", "resources", "icon.ico");
const ELECTRON_PKG = path.join(ROOT, "apps", "desktop", "node_modules", "electron");
/** 旧脚本的默认档位，一字不改：换档位等于换图标在任务栏上的样子。 */
export const DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256];

export function parseArgs(argv) {
  // `out` 刻意不给默认值：已入库的那枚品牌资产只能由点名的人覆盖，判据在 runCli 那道闸里。
  const opts = { out: null, sizes: DEFAULT_SIZES };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.trim() === "")
        throw new Error("--out 后面要接一个路径");
      opts.out = path.resolve(value);
      i += 1;
    } else if (arg === "--sizes") {
      const value = argv[i + 1];
      const sizes = String(value ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (value === undefined || sizes.length === 0)
        throw new Error("--sizes 要接一组正整数，例如 16,32,256");
      if (sizes.some((n) => n > 256)) throw new Error("ICO 的条目边长上限是 256");
      opts.sizes = sizes;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else throw new Error(`不认识参数：${arg}`);
  }
  return opts;
}

/** 找到本仓装着的那台 Electron 的可执行文件；找不到就报出路子，不许静默降级成「那就不出图」。 */
function electronBinary() {
  if (!fs.existsSync(ELECTRON_PKG))
    throw new Error(`没装 Electron（${ELECTRON_PKG} 不存在）。先 pnpm install，再来出图标。`);
  const name = fs
    .readFileSync(path.join(ELECTRON_PKG, "path.txt"), "utf8")
    .trim()
    .replace(/\\/g, "/");
  const bin = path.join(ELECTRON_PKG, "dist", ...name.split("/"));
  if (!fs.existsSync(bin))
    throw new Error(
      `Electron 装了但二进制不在（期望 ${bin}）。八成是 install 时被 EPERM 卡在解压那一步。`
    );
  return bin;
}

async function runInsideElectron(opts) {
  const { app, nativeImage } = await import("electron");
  if (!fs.existsSync(SOURCE)) throw new Error(`没有源图：${SOURCE}`);
  const source = nativeImage.createFromBuffer(fs.readFileSync(SOURCE));
  if (source.isEmpty()) throw new Error("源图解不开（nativeImage 给的是空图）：" + SOURCE);
  const { width, height } = source.getSize();
  if (width !== height)
    throw new Error(
      `源图不是方的（${width}×${height}）：这份脚本只会等比缩到正方形，斜着拉会毁掉品牌图，先人工定裁法`
    );

  const entries = opts.sizes.map((size) => {
    const scaled = source.resize({ width: size, height: size, quality: "best" });
    if (scaled.isEmpty()) throw new Error(`缩到 ${size} 得到空图，这一条没有落盘`);
    const actual = scaled.getSize();
    if (actual.width !== size || actual.height !== size)
      throw new Error(`缩到 ${size} 实际是 ${actual.width}×${actual.height}，不写这种不自洽的条目`);
    return { size, png: new Uint8Array(scaled.toPNG()) };
  });

  const ico = buildIco(entries);
  // 写完立刻按同一份解析器读回来核一遍：条目数、表里声明的尺寸、PNG 自己的 IHDR、planes/bits。
  // 表与 IHDR 两份都要对得上——只核一份，就是「声明 256 实际 128」那种 OS 悄悄拉伸的条目能过关。
  const parsed = parseIco(ico);
  const checked = parsed.entries.map((entry, i) => ({ entry, want: opts.sizes[i] }));
  const problems = checked.filter(
    ({ entry, want }) =>
      entry.width !== want ||
      entry.height !== want ||
      entry.pngWidth !== want ||
      entry.pngHeight !== want ||
      entry.planes !== 1 ||
      entry.bits !== 32
  );
  if (problems.length > 0)
    throw new Error(
      // 报错只打条目表，不打 PNG：一条 256 档的载荷有上百 KB，把它一起塞进 JSON 的话这句话就没法读了
      // （失败要看得见，不是一屏十六进制）。
      `回读核对不过：${problems
        .map(({ entry, want }) => {
          const meta = { ...entry };
          delete meta.png;
          return `第 ${meta.index} 条想要 ${want}，读回 ${JSON.stringify(meta)}`;
        })
        .join("；")}`
    );
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, Buffer.from(ico));
  console.log(
    `ico → ${opts.out}（${parsed.count} 档：${parsed.entries.map((e) => e.width).join(", ")}；` +
      `源图 ${width}×${height} 整幅不裁；${ico.length} 字节）`
  );
  app.exit(0);
}

function reexecInElectron(opts) {
  const bin = electronBinary();
  const result = spawnSync(
    bin,
    [fileURLToPath(import.meta.url), "--out", opts.out, "--sizes", opts.sizes.join(",")],
    {
      stdio: "inherit",
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" }
    }
  );
  if (result.error) throw new Error(`起不来 Electron：${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`Electron 里失败（退出码 ${result.status}）——上面那几行就是它自己说的话`);
}

/**
 * 只有被直接调用时才动手出图。这份文件同时是 `tools/ico-container.test.mjs` 的导入对象
 * （参数解析与默认档位要能被单测），不加这道闸的话一次 `import` 就 spawn 出一台 Electron。
 * 判据用「argv 里出现本文件路径」而不是 `argv[1] === 本文件`：Electron 的 argv 以它自己的二进制开头，
 * Node 直接跑时 argv[1] 又可能是相对路径——两种入口都要认，比较时统一分隔符与大小写（Windows 上两者都不区分）。
 */
const pathKey = (p) => path.resolve(String(p)).replace(/\\/g, "/").toLowerCase();
const invokedDirectly = process.argv.some(
  (arg) => pathKey(arg) === pathKey(fileURLToPath(import.meta.url))
);

/**
 * 失败必须当场说一句话并留下非零码。尤其 Electron 那半边：实测未捕获的 rejection 只打一行日志、
 * 进程却继续挂着，调用方会以为「还在跑」——所以这里一律自己接住，再用 `app.exit(1)` 收掉。
 */
async function runCli() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("用法：node tools/build-brand-icons.mjs --out <路径> [--sizes 16,32,256]");
    return;
  }
  if (opts.out === null)
    throw new Error(
      `没有指定 --out，所以什么都没写。这台生成器不默认覆盖已入库的那枚 ` +
        `${path.relative(ROOT, TRACKED_OUTPUT).replace(/\\/g, "/")}：Chromium 的缩放核与旧脚本的 ` +
        `HighQualityBicubic 出的不是同一张像素，换像素口径等于换品牌资产，那要点头的是用户。` +
        `确实要覆盖就写全：--out ${TRACKED_OUTPUT}`
    );
  if (process.versions.electron) {
    await runInsideElectron(opts);
  } else {
    reexecInElectron(opts);
  }
}

if (invokedDirectly) {
  try {
    await runCli();
  } catch (error) {
    console.error(`出图失败：${error instanceof Error ? error.message : String(error)}`);
    if (process.versions.electron) {
      const { app } = await import("electron");
      app.exit(1);
    } else {
      process.exit(1);
    }
  }
}

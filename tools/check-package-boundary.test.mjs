import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RENDERER_DIR, findCrossLayerViolations } from "./check-package-boundary.mjs";

/**
 * 边界这道闸自己的守卫（2026-10-09 全仓扫描 P2-10：门禁盲区）。
 *
 * 这条 P2 说的不是"代码越界"，而是**闸漏看**：原先它只管两件事（packages 里不许 import electron、
 * 渲染层只许走 fs-store 在 exports 里声明过的子路径）。而 2026-10-05 那次白屏事故的形状其实是
 * 「渲染层把 Node 模块拖进 bundle」，同一件事还有另外三条通路，闸一条都不看：
 * ① 渲染层用**相对路径**跨出 `renderer/src`（`../../../main/agent-service.js` 这种，比 barrel 更直接）；
 * ② 渲染层相对路径进包源码（`packages` 底下那些），等于绕开那份 exports 白名单自定路径整包引；
 * ③ 主进程相对路径进渲染层（Node 侧去解析 .vue / 浏览器侧 store，构建产物里塞进一份永远跑不起来的东西）。
 *
 * 再加一条「闸扫的确实是真目录」——漏扫最阴的形状不是报错，是扫描为空然后打印「通过」。
 * 夹具一律走临时目录，不在真树上造违规文件；用例里的相对说明符**现算**，不手数「../」。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APPS = path.join("apps", "desktop", "src");

const posix = (p) => p.split(path.sep).join("/");

/** 造一棵临时目录树，返回根路径。 */
function fixture(tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-"));
  for (const [rel, body] of Object.entries(tree)) {
    const full = path.join(dir, posix(rel));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
  return dir;
}

/** 从 fromFile 引到 targetFile 的那行 import（说明符按真实相对位置算，跨平台不歪）。 */
function importLine(fromFile, targetFile, name) {
  const spec =
    posix(path.relative(path.dirname(fromFile), targetFile).replace(/\.(ts|vue)$/, ".js")) || ".";
  return `import { ${name} } from "${spec.startsWith(".") ? spec : "./" + spec}";\nexport const used = ${name};\n`;
}

test("渲染层相对跨进主进程：报", () => {
  const dir = fixture({});
  const apps = path.join(dir, APPS);
  const from = path.join(apps, "renderer/src/stores/useThing.ts");
  const target = path.join(apps, "main/agent-service.ts");
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "export function runTurn() {}\n", "utf8");
  fs.writeFileSync(from, importLine(from, target, "runTurn"), "utf8");
  try {
    const out = findCrossLayerViolations(apps, path.join(dir, "packages"));
    expect(
      out.some((v) => v.includes("useThing.ts") && /渲染层跨层/.test(v)),
      out.join("\n")
    ).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("渲染层相对跨进包源码（绕开 exports 白名单）：报", () => {
  const dir = fixture({});
  const apps = path.join(dir, APPS);
  const from = path.join(apps, "renderer/src/utils/leak.ts");
  const target = path.join(dir, "packages/fs-store/src/changes.ts");
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "export function readChange() {}\n", "utf8");
  fs.writeFileSync(from, importLine(from, target, "readChange"), "utf8");
  try {
    const out = findCrossLayerViolations(apps, path.join(dir, "packages"));
    expect(
      out.some((v) => v.includes("leak.ts") && /包源码/.test(v)),
      out.join("\n")
    ).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("主进程相对跨进渲染层：报", () => {
  const dir = fixture({});
  const apps = path.join(dir, APPS);
  const from = path.join(apps, "main/peek.ts");
  const target = path.join(apps, "renderer/src/utils/label.ts");
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'export const label = "x";\n', "utf8");
  fs.writeFileSync(from, importLine(from, target, "label"), "utf8");
  try {
    const out = findCrossLayerViolations(apps, path.join(dir, "packages"));
    expect(
      out.some((v) => v.includes("peek.ts") && /跨层 import/.test(v)),
      out.join("\n")
    ).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("测试文件免检是明写规则（main 的接线用例读 renderer 的读源工具，靠的就是这条豁免）", () => {
  const dir = fixture({});
  const apps = path.join(dir, APPS);
  const from = path.join(apps, "main/wiring.test.ts");
  const target = path.join(apps, "renderer/src/utils/vue-source-reader.ts");
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'export const scriptSource = () => "";\n', "utf8");
  fs.writeFileSync(from, importLine(from, target, "scriptSource"), "utf8");
  const 生产文件 = path.join(apps, "main/wiring.ts");
  fs.writeFileSync(生产文件, importLine(生产文件, target, "scriptSource"), "utf8");
  try {
    const out = findCrossLayerViolations(apps, path.join(dir, "packages"));
    // 同一份引用：测试形状免检、生产形状必须报——只报一条才算这条豁免是「明写的」而不是「漏扫的」。
    expect(out.length, out.join("\n")).toBe(1);
    expect(out[0]).toContain("wiring.ts");
    expect(out[0]).not.toContain("wiring.test.ts");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("层内相对引用不误报（闸不许变成噪音源）", () => {
  const dir = fixture({});
  const apps = path.join(dir, APPS);
  const pairs = [
    ["renderer/src/utils/a.ts", "renderer/src/utils/b.ts"],
    ["renderer/src/stores/s.ts", "renderer/src/utils/b.ts"],
    ["main/index.ts", "main/boot.ts"],
    ["preload/index.ts", "main/boot.ts"]
  ];
  for (const [fromRel, targetRel] of pairs) {
    const from = path.join(apps, posix(fromRel));
    const target = path.join(apps, posix(targetRel));
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, "export const b = 1;\n", "utf8");
    if (fromRel.endsWith("index.ts")) fs.writeFileSync(from, "export const boot = 1;\n", "utf8");
    else fs.writeFileSync(from, importLine(from, target, "b"), "utf8");
  }
  fs.writeFileSync(
    path.join(apps, "renderer/src/stores/s.ts"),
    'import { escapeHtml } from "@mochen/fs-store/export-shared";\nexport const s = escapeHtml;\n',
    "utf8"
  );
  try {
    const out = findCrossLayerViolations(apps, path.join(dir, "packages"));
    expect(out, out.join("\n")).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("仓库当前树过闸：跨层违规为空，且闸的默认扫描根是真的", () => {
  const out = findCrossLayerViolations(path.join(ROOT, APPS), path.join(ROOT, "packages"));
  expect(out, out.join("\n")).toEqual([]);
  expect(
    fs.existsSync(DEFAULT_RENDERER_DIR),
    `闸的默认根 ${DEFAULT_RENDERER_DIR} 不存在——它一直在空扫`
  ).toBe(true);
  const 台账 = path.join(ROOT, "docs", "superpowers", "plans", "README.md");
  expect(fs.existsSync(台账), "台账不在，判据源变了").toBe(true);
});

import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 「UI 没有组件库」这句话要有守卫（2026-10-09 全仓扫描 P2-11，2026-10-12 用户授权删除）。
 *
 * 病灶不是一行冗余配置，是**一行会让下一个人不必再决定的配置**：
 * `pnpm-workspace.yaml` 的 catalog 里挂着 `naive-ui: "2.44.1"`，而全仓零引用（`pnpm-lock.yaml`
 * 里连一次出现都没有 ⇒ 从没被任何包依赖过）。整个界面是手搓 CSS + 自绘组件，一致性全靠人盯。
 * catalog 的语义是「谁写 `catalog:` 就能拿到这个版本」，所以那枚死条目等于**一张随时能兑现的
 * 入场券**：下一个会话在某个 `.vue` 里顺手 `import { NButton } from "naive-ui"` 并给 package.json
 * 加一行 `"naive-ui": "catalog:"`，装得上、跑得起、门禁全绿——引入一个组件库这件本该由用户拍板的
 * 事，就在一次普通改动里被替用户决定了。而「不新增任何 npm 依赖」是这仓的硬约束。
 *
 * 所以这里钉三件可失败的事：条目确实不在 catalog 里、没有任何 package.json 依赖它、
 * 源码里没有任何一处 import 它。外加一条自证：闸喂一份明知违规的假名单时必须亮。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 组件库名单。只列**真会被人顺手引进来的**那些，不做全景枚举——
 * 长得数不过来的名单只会逼人为了过闸去改名单，那就是没闸。
 */
const COMPONENT_LIBRARIES = [
  "naive-ui",
  "element-plus",
  "element-ui",
  "ant-design-vue",
  "@arco-design/web-vue",
  "vuetify",
  "quasar",
  "tdesign-vue-next",
  "varlet"
];

/** 行级解析 catalog 段的键：本仓这份 yaml 只有平铺的 `键: "版本"`，没有嵌套、锚点与多行值。 */
function catalogKeys(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => l === "catalog:");
  if (start === -1) return null;
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^[ \t]/.test(line)) break; // 回到顶层键，catalog 段结束
    const m = line.match(/^[ \t]+"?([^":\s]+)"?\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** 真身 yaml 的 catalog 键；解析不出来就当场抛，绝不让「没有组件库」在空扫上算成绿。 */
function realCatalogKeys() {
  const keys = catalogKeys(fs.readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8"));
  if (keys === null)
    throw new Error("pnpm-workspace.yaml 里没有顶层 `catalog:` 段，本闸的判据源变了");
  for (const must of ["vue", "pinia", "vitest", "typescript", "zod"]) {
    if (!keys.includes(must)) {
      throw new Error(`catalog 解析漏掉了 ${must}：这份 yaml 的缩进或引号形状变了，本闸需要跟着改`);
    }
  }
  return keys;
}

function hits(list) {
  return COMPONENT_LIBRARIES.filter((name) => list.includes(name));
}

/** workspace 的 package.json 口径照 `pnpm-workspace.yaml` 的 packages：根 + apps/* + packages/*。 */
function manifestPaths() {
  const out = [path.join(ROOT, "package.json")];
  for (const group of ["apps", "packages"]) {
    const dir = path.join(ROOT, group);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const manifest = path.join(dir, entry.name, "package.json");
      if (entry.isDirectory() && fs.existsSync(manifest)) out.push(manifest);
    }
  }
  return out;
}

test("catalog 段在场且解析口径没漂（判据源变了要抛出来，不许算成绿灯）", () => {
  const keys = realCatalogKeys();
  expect(keys.length, "catalog 只解析出这么几条，不像真身").toBeGreaterThan(10);
});

test("catalog 里没有任何组件库条目（P2-11 那枚 naive-ui）", () => {
  const found = hits(realCatalogKeys());
  expect(
    found,
    `catalog 里挂着组件库：${found.join(", ")} —— 本仓 UI 是手搓 CSS，引入组件库要用户拍板`
  ).toEqual([]);
});

test("没有任何 package.json 依赖组件库（含 `catalog:` 协议）", () => {
  const files = manifestPaths();
  expect(files.length, "workspace 的 package.json 少于四份，判据源变了").toBeGreaterThanOrEqual(4);
  const offenders = [];
  for (const full of files) {
    const pkg = JSON.parse(fs.readFileSync(full, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (COMPONENT_LIBRARIES.includes(name)) {
          offenders.push(`${path.relative(ROOT, full)} 的 ${field} 里有 ${name}`);
        }
      }
    }
  }
  expect(offenders, offenders.join("；")).toEqual([]);
});

test("源码里没有任何一处 import 组件库", () => {
  const sources = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "out"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|vue|js|mjs)$/.test(entry.name)) sources.push(full);
    }
  };
  for (const group of ["apps", "packages"]) walk(path.join(ROOT, group));
  expect(sources.length, "apps/ 与 packages/ 下扫不到一百个源文件，判据源变了").toBeGreaterThan(
    100
  );
  const spec = new RegExp(`(?:from|require\\()\\s*["'](?:${COMPONENT_LIBRARIES.join("|")})["']`);
  const offenders = sources
    .map((full) => [path.relative(ROOT, full), fs.readFileSync(full, "utf8")])
    .filter(([, text]) => spec.test(text))
    .map(([rel]) => rel);
  expect(
    offenders,
    `源码里 import 了组件库：${offenders.join(", ")} —— 组件一律手搓，不引库`
  ).toEqual([]);
});

test("闸自己能亮：明知违规的 catalog 必须被逮住（防止判据写成空扫）", () => {
  const fake = ["catalog:", '  vue: "3.5.39"', '  naive-ui: "2.44.1"', "", "allowBuilds:"].join(
    "\n"
  );
  const keys = catalogKeys(fake);
  expect(keys, "连假 yaml 都没解析出 catalog，闸是空的").toContain("naive-ui");
  expect(hits(keys), "含 naive-ui 的 catalog 没被逮住").toEqual(["naive-ui"]);
  // 反向对照：干净的 catalog 不许误报，否则这条闸只会把人逼去改名单。
  const clean = ["catalog:", '  vue: "3.5.39"', '  zod: "4.4.3"', "", "allowBuilds:"].join("\n");
  expect(hits(catalogKeys(clean))).toEqual([]);
});

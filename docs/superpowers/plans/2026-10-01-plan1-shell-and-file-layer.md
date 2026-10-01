# 墨宸 AI · Plan 1（壳 + 文件层）实现计划

> **历史记录**：本文按执行当时的名字书写。Plan 1 交付后产品改名**墨宸 AI**，代码里的
> `@abyss/*` → `@mochen/*`、作品目录内 `.abyss/` → `.mochen/`、`window.abyss` → `window.mochen`
> 已整体替换；本文正文不回改，现状以代码为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起深渊写作的 Electron 三栏壳，并让它能打开真实作品目录、读取多文件 Markdown 文稿、在外部改动冲突时拒绝覆盖。

**Architecture:** pnpm monorepo 三层——`packages/contracts` 定义 zod 契约、`packages/fs-store` 做纯 node 的目录读写与冲突检测（禁止 import electron）、`apps/desktop` 用主进程组装并在 preload 只暴露白名单 API；渲染层 Vue 3 三栏（左树 / 中对话占位 / 右双标签文稿区）消费 IPC。

**Tech Stack:** Node 24、pnpm 11（corepack）、Electron 42.5.0、electron-vite 5.0.0、Vue 3.5.39、TypeScript 6.0.3、Pinia 3.0.4、naive-ui 2.44.1、zod 4.4.3、vitest 4.1.9。

**Spec:** `docs/superpowers/specs/2026-10-01-abyss-writing-workbench-design.md`（第 2/3/4/9 节 + 第 10 节测试要求）

**后续计划：** Plan 2 = S3 流式对话 + S4 提案写盘；Plan 3 = S5 键位与权限档 + S6 阶段装配。本计划不含模型调用。

## Global Constraints

每个任务都隐含满足以下约束（值取自 spec 逐字）：

- 依赖版本用 pnpm catalog 锁定：`electron: 42.5.0`、`electron-vite: 5.0.0`、`vue: 3.5.39`、`typescript: 6.0.3`、`pinia: 3.0.4`、`naive-ui: 2.44.1`、`zod: 4.4.3`、`vitest: 4.1.9`、`vite: 8.1.0`。
- `packages/contracts`、`packages/fs-store`、`packages/agent-runtime` 内**禁止** `import ... from "electron"`；只有 `apps/desktop/src/main` 可以。由 `tools/check-package-boundary.mjs` 强制。
- 所有面向用户的文案为简体中文；界面为深色毛玻璃（半透明 + 1px 亮边 + 背景模糊），禁用像素风。
- 任何写盘动作前必须先备份到 `.abyss/changes/<时间戳>/`；指纹不符则拒绝写入，绝不覆盖。
- 文稿一律以 UTF-8 + LF 读写。
- Windows 会话验证约定：本机 dev 在跑时全量 vitest 会假红灯，用 `--maxWorkers=4` 复核；`pnpm` 通过 `corepack pnpm` 调用；命令退出码不能被管道吞掉，跑门禁后要回读日志里的 `VERIFY_EXIT`。
- 计划内测试一律用真实临时目录（`node:fs` 写盘）而非 mock fs，因为本层唯一要证明的就是"文件有没有被改"。

---

## 文件结构（先定边界，再切任务）

```
深渊写作/
  package.json                      根：workspace 脚本
  pnpm-workspace.yaml               packages + apps + catalog
  tsconfig.base.json                严格模式共享配置
  vitest.config.ts                  projects: contracts / fs-store / desktop-node
  eslint.config.js  prettier.config.mjs  .editorconfig  .gitattributes
  tools/check-package-boundary.mjs  禁止 packages/* import electron
  tools/check-source-line-budget.mjs 单文件行数预算（防 WorkspaceShell 化）
  packages/contracts/
    package.json  tsconfig.json
    src/permission.ts               PermissionMode
    src/book.ts                     BookMeta / DocRef / bookMetaSchema
    src/patch.ts                    EditProposal / ProposalDecision
    src/ipc.ts                      IpcChannel 常量 + RendererApi 类型
    src/index.ts                    re-export
    test/book.test.ts
  packages/fs-store/
    package.json  tsconfig.json
    src/fingerprint.ts              sha256 指纹
    src/frontmatter.ts              YAML 头部往返（零依赖子集）
    src/paths.ts                    relPath 校验（防目录穿越）
    src/scan.ts                     扫目录 → DocRef[]，章节排序
    src/write.ts                    读/写/备份/冲突检测
    src/index.ts
    test/scan.test.ts  test/write.test.ts  test/frontmatter.test.ts
  apps/desktop/
    package.json  tsconfig.node.json  tsconfig.web.json
    electron.vite.config.ts
    src/main/index.ts               app ready、建窗、注册 IPC
    src/main/book-service.ts        fs-store → IPC 的适配层
    src/preload/index.ts            contextBridge 白名单
    src/renderer/index.html
    src/renderer/src/main.ts        createApp + Pinia + naive-ui 主题
    src/renderer/src/App.vue        三栏布局根
    src/renderer/src/styles/glass.css
    src/renderer/src/stores/useBookStore.ts
    src/renderer/src/components/
      LeftSidebar.vue               作品树（章节/大纲/人物/剧情/素材分组）
      CenterColumn.vue              对话占位 + 上下文条 + 状态行（Plan 2 换实现）
      ManuscriptTabs.vue  DocumentPane.vue  BrowsePane.vue  SaveConflictDialog.vue
    src/main/book-service.test.ts   （node 环境 vitest）
```

技能库列表与 `@` 引用挂上下文在 Plan 3（S6）落；本计划左栏只做五类文稿树，避免提前造无测试的组件。

---

### Task 1: 工作区脚手架与两道门禁

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`, `prettier.config.mjs`, `.editorconfig`, `.gitattributes`, `tools/check-package-boundary.mjs`, `tools/check-source-line-budget.mjs`, `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/fs-store/package.json`, `packages/fs-store/tsconfig.json`
- Test: `tools/check-package-boundary.mjs` 本身即门禁，用一次性 fixture 目录验证它能红

**Interfaces:**
- Consumes: 无
- Produces: 根脚本 `pnpm verify` = `format:check && typecheck && lint && test`；`check-package-boundary.mjs` 导出 `findViolations(dir): string[]` 供测试复用

- [x] **Step 1: 写 workspace 与 catalog**

`pnpm-workspace.yaml`：
```yaml
packages:
  - apps/*
  - packages/*

catalog:
  "@vitejs/plugin-vue": "6.0.7"
  electron: "42.5.0"
  electron-vite: "5.0.0"
  naive-ui: "2.44.1"
  pinia: "3.0.4"
  typescript: "6.0.3"
  vite: "8.1.0"
  vitest: "4.1.9"
  vue: "3.5.39"
  zod: "4.4.3"

allowBuilds:
  electron: true
  esbuild: true
```

`package.json`：
```json
{
  "name": "abyss-writing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": ">=24.0.0", "pnpm": ">=11.0.0" },
  "scripts": {
    "dev": "pnpm --filter @abyss/desktop dev",
    "build": "pnpm --filter @abyss/desktop build",
    "typecheck": "tsc --noEmit -p packages/contracts/tsconfig.json && tsc --noEmit -p packages/fs-store/tsconfig.json",
    "test": "vitest run --maxWorkers=4",
    "lint:boundary": "node tools/check-package-boundary.mjs",
    "lint:budget": "node tools/check-source-line-budget.mjs",
    "lint": "pnpm lint:boundary && pnpm lint:budget",
    "format:check": "prettier . --check",
    "verify": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && echo VERIFY_EXIT=$?"
  }
}
```

`tsconfig.base.json`：
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

- [x] **Step 1b: 其余根配置逐字写入（不留"参考 deepwrite"这类口头交代）**

`vitest.config.ts`：
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "tools/*.test.mjs"
    ],
    environment: "node",
    maxWorkers: 4
  }
});
```

`.editorconfig`：
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

`.gitattributes`：
```
* text=auto eol=lf
*.png binary
*.ico binary
```

`prettier.config.mjs`：
```js
export default {
  semi: true,
  singleQuote: false,
  printWidth: 100,
  trailingComma: "none",
  endOfLine: "lf"
};
```

`.prettierignore`：
```
pnpm-lock.yaml
node_modules
out
dist
docs/superpowers
```

`eslint.config.js`（只上语法级规则，首轮不引类型感知规则）：
```js
import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/out/**", "**/dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "vue/multi-word-component-names": "off"
    }
  },
  prettier
);
```

对应 devDependencies 追加到根 `package.json`：`"@eslint/js": "10.0.1"`、`"eslint": "10.8.1"`、`"eslint-config-prettier": "10.1.8"`、`"eslint-plugin-vue": "10.10.0"`、`"globals": "17.11.0"`、`"typescript-eslint": "8.67.0"`、`"prettier": "3.9.6"`，并在 scripts 里加 `"lint:eslint": "eslint . --max-warnings=0"`，`lint` 改为 `pnpm lint:eslint && pnpm lint:boundary && pnpm lint:budget`。

- [x] **Step 2: 写两个包骨架**

`packages/contracts/package.json`：
```json
{
  "name": "@abyss/contracts",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "catalog:" },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

`packages/contracts/tsconfig.json`：
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/fs-store/package.json`：
```json
{
  "name": "@abyss/fs-store",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@abyss/contracts": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

`packages/fs-store/tsconfig.json`：
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/contracts/tsconfig.json` 与它逐字相同。fs-store 不直接用 zod，`zod` 依赖只是让 `@abyss/contracts` 的类型在 workspace 内可解析；若 `pnpm typecheck` 报未使用依赖，删掉它而不是删掉 `@abyss/contracts`。

- [x] **Step 3: 写边界门禁脚本**

`tools/check-package-boundary.mjs`：
```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PACKAGES_DIR = path.resolve("packages");
const FORBIDDEN = /from\s+["']electron["']|require\(\s*["']electron["']\s*\)/;

export function findViolations(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findViolations(full));
    else if (/\.(ts|mts|vue)$/.test(entry.name) && FORBIDDEN.test(fs.readFileSync(full, "utf8")))
      out.push(path.relative(process.cwd(), full));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = findViolations(PACKAGES_DIR);
  if (v.length) {
    console.error("packages/* 禁止 import electron：\n" + v.join("\n"));
    process.exit(1);
  }
  console.log("边界检查通过");
}
```

`tools/check-source-line-budget.mjs`：单文件超过 800 行即失败（防止复刻 deepwrite 的 `WorkspaceShell.vue:2764` / `useProposalCoordinator.ts:4277` 巨石）：
```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const LIMIT = 800;
const ROOTS = ["packages", "apps/desktop/src"];

export function findOverruns(roots, limit = LIMIT) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|vue)$/.test(e.name)) {
        const lines = fs.readFileSync(full, "utf8").split("\n").length;
        if (lines > limit) out.push(`${full}  ${lines} 行 > ${limit}`);
      }
    }
  };
  for (const r of roots) walk(r);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = findOverruns(ROOTS);
  if (bad.length) { console.error("行数超限：\n" + bad.join("\n")); process.exit(1); }
  console.log("行数预算通过");
}
```

- [x] **Step 4: 写门禁的失败用例（证明它能红）**

`tools/boundary.selfcheck.test.mjs`：
```js
import { test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findViolations } from "./check-package-boundary.mjs";
import { findOverruns } from "./check-source-line-budget.mjs";

test("边界门禁能抓到 electron import", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abyss-bound-"));
  fs.writeFileSync(path.join(dir, "bad.ts"), 'import { app } from "electron";\n');
  expect(findViolations(dir)).toEqual(["bad.ts"]);
});

test("行数门禁能抓到超长文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abyss-budget-"));
  fs.writeFileSync(path.join(dir, "big.ts"), "x\n".repeat(801));
  expect(findOverruns([dir], 800)).toHaveLength(1);
});
```

Run: `corepack pnpm install --prefer-offline`（electron 走本地缓存 `%LOCALAPPDATA%\electron\Cache`）
Run: `corepack pnpm exec vitest run tools --maxWorkers=4`
Expected: 先 FAIL（脚本尚未创建时），Step 3 建好后 PASS 2 项。

- [x] **Step 5: 提交**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json tools packages apps 2>/dev/null; git add -A
git commit -m "chore: 工作区脚手架与边界/行数门禁"
```

---

### Task 2: contracts 数据契约

**Files:**
- Create: `packages/contracts/src/permission.ts`, `book.ts`, `patch.ts`, `ipc.ts`, `index.ts`
- Test: `packages/contracts/test/contract.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type PermissionMode = "read-only" | "chapter-write" | "full-access"`，`PERMISSION_MODES: readonly PermissionMode[]`，`DEFAULT_PERMISSION_MODE: PermissionMode = "read-only"`
  - `interface BookStage { id: string; name: string }`
  - `interface BookMeta { id: string; title: string; schemaVersion: 1; stages: BookStage[]; activeStage: string; permissionMode: PermissionMode; chapterOrder: string[] }`
  - `const BOOK_KINDS = ["chapter","outline","character","plot","material"]`、`type BookKind`
  - `interface DocRef { relPath: string; kind: BookKind; title: string }`
  - `const bookMetaSchema`（zod）、`parseBookMeta(raw: unknown): BookMeta`
  - `interface EditProposal { id: string; docRelPath: string; anchor: string; replace: string; why: string; source: "tool-call" | "text-block"; createdAt: string }`
  - `type ProposalDecision = "accept-once" | "accept-session" | "accept-prefix" | "deny-with-guidance" | "cancel"`
  - `const IPC_CHANNELS`、`interface RendererApi`（Task 5 preload 与 Task 6 渲染层都按它写）

- [x] **Step 1: 写失败测试**

`packages/contracts/test/contract.test.ts`：
```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  bookMetaSchema,
  parseBookMeta
} from "../src/index.js";

const valid = {
  id: "book_1",
  title: "深渊之下",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: ["chapters/01-开局.md"]
};

describe("bookMetaSchema", () => {
  it("接受合法 book.json", () => {
    expect(parseBookMeta(valid)).toEqual(valid);
  });

  it("缺 activeStage 时拒绝", () => {
    const { activeStage, ...rest } = valid;
    expect(() => parseBookMeta(rest)).toThrow(/activeStage/);
  });

  it("未知权限档时拒绝", () => {
    expect(() => parseBookMeta({ ...valid, permissionMode: "yolo" })).toThrow();
  });

  it("stage id 重复时拒绝", () => {
    expect(() =>
      parseBookMeta({
        ...valid,
        stages: [
          { id: "draft", name: "正文" },
          { id: "draft", name: "修订" }
        ]
      })
    ).toThrow(/重复/);
  });

  it("默认权限档是最保守的一档", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("read-only");
    expect(PERMISSION_MODES[0]).toBe("read-only");
    expect(bookMetaSchema.safeParse({ ...valid, permissionMode: "full-access" }).success).toBe(true);
  });
});
```

Run: `corepack pnpm exec vitest run packages/contracts --maxWorkers=4`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [x] **Step 2: 写实现**

`src/permission.ts`：
```ts
export const PERMISSION_MODES = ["read-only", "chapter-write", "full-access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const DEFAULT_PERMISSION_MODE: PermissionMode = "read-only";

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  "read-only": "只读参考",
  "chapter-write": "可改当前章",
  "full-access": "全开"
};
```

`src/book.ts`：
```ts
import { z } from "zod";
import { PERMISSION_MODES, type PermissionMode } from "./permission.js";

export const BOOK_KINDS = ["chapter", "outline", "character", "plot", "material"] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

export interface BookStage {
  id: string;
  name: string;
}

export interface BookMeta {
  id: string;
  title: string;
  schemaVersion: 1;
  stages: BookStage[];
  activeStage: string;
  permissionMode: PermissionMode;
  chapterOrder: string[];
}

export interface DocRef {
  relPath: string;
  kind: BookKind;
  title: string;
}

const stageSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });

export const bookMetaSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    schemaVersion: z.literal(1),
    stages: z.array(stageSchema).min(1),
    activeStage: z.string().min(1),
    permissionMode: z.enum(PERMISSION_MODES),
    chapterOrder: z.array(z.string().min(1))
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const stage of value.stages) {
      if (ids.has(stage.id))
        ctx.addIssue({ code: "custom", message: `stage id 重复：${stage.id}`, path: ["stages"] });
      ids.add(stage.id);
    }
    if (!value.stages.some((stage) => stage.id === value.activeStage))
      ctx.addIssue({ code: "custom", message: "activeStage 不在 stages 中", path: ["activeStage"] });
  });

export function parseBookMeta(raw: unknown): BookMeta {
  const result = bookMetaSchema.parse(raw);
  return structuredClone(result);
}
```

`src/patch.ts`：
```ts
export interface EditProposal {
  id: string;
  docRelPath: string;
  anchor: string;
  replace: string;
  why: string;
  source: "tool-call" | "text-block";
  createdAt: string;
}

export type ProposalDecision =
  | "accept-once"
  | "accept-session"
  | "accept-prefix"
  | "deny-with-guidance"
  | "cancel";
```

`src/ipc.ts`：
```ts
import type { BookMeta, DocRef } from "./book.js";

export const IPC_CHANNELS = {
  bookOpen: "book:open",
  bookSaveMeta: "book:save-meta",
  docRead: "doc:read",
  docWrite: "doc:write"
} as const;

export interface BookOpenResult {
  rootPath: string;
  meta: BookMeta;
  docs: DocRef[];
}

export interface DocContent {
  relPath: string;
  content: string;
  fingerprint: string;
}

export type DocWriteResult =
  | { ok: true; fingerprint: string; backupRelPath: string | null }
  | { ok: false; reason: "stale"; currentFingerprint: string }
  | { ok: false; reason: "invalid-path" | "outside-book" | "io-error"; message: string };

export interface RendererApi {
  openBook(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
}
```

`src/index.ts`：
```ts
export * from "./permission.js";
export * from "./book.js";
export * from "./patch.js";
export * from "./ipc.js";
```

- [x] **Step 3: 跑测试确认全绿 + 类型检查**

Run: `corepack pnpm exec vitest run packages/contracts --maxWorkers=4` → PASS 5 项
Run: `corepack pnpm typecheck` → 无错误

- [x] **Step 4: 变异实验（证明断言能失败）**

临时把 `bookMetaSchema` 的 `.superRefine(...)` 整段注释掉，重跑 Step 3 → 期望 "stage id 重复时拒绝" 与 "缺 activeStage 时拒绝" 转红。恢复后再跑一次确认转绿。记录两条红用例名到提交信息。

- [x] **Step 5: 提交**

```bash
git add packages/contracts
git commit -m "feat(contracts): 书籍元数据/提案/权限契约与 zod 校验"
```

---

### Task 3: fs-store 路径安全 + 指纹 + frontmatter

**Files:**
- Create: `packages/fs-store/src/paths.ts`, `fingerprint.ts`, `frontmatter.ts`, `index.ts`（仅导出前三个）
- Test: `packages/fs-store/test/paths.test.ts`, `packages/fs-store/test/frontmatter.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `assertSafeRelPath(relPath: string): string`（抛错类型 `invalid-path` / `outside-book`）
  - `makeFingerprint(content: string): string`（sha256 hex）
  - `parseFrontmatter(raw: string): { data: Record<string, string | string[]>; body: string }`
  - `serializeFrontmatter(data: Record<string, string | string[]>, body: string): string`

- [x] **Step 1: 写失败测试**

`test/paths.test.ts`：
```ts
import { describe, expect, it } from "vitest";
import { assertSafeRelPath, toPosixRelPath } from "../src/paths.js";

describe("assertSafeRelPath", () => {
  it.each([
    "chapters/01-开局.md",
    "characters/李深.md",
    ".abyss/skills/三幕/SKILL.md"
  ])("接受书内相对路径 %s", (p) => {
    expect(assertSafeRelPath(p)).toBe(p);
  });

  it("拒绝空串", () => expect(() => assertSafeRelPath("")).toThrow(/invalid-path/));
  it("拒绝绝对路径", () =>
    expect(() => assertSafeRelPath("C:/Windows/x.md")).toThrow(/invalid-path/));
  it("拒绝 .. 穿越", () =>
    expect(() => assertSafeRelPath("../secret.md")).toThrow(/outside-book/));
  it("拒绝穿越中段的 ..", () =>
    expect(() => assertSafeRelPath("chapters/../../secret.md")).toThrow(/outside-book/));
  it("拒绝反斜杠穿越", () =>
    expect(() => assertSafeRelPath("chapters\\..\\..\\secret.md")).toThrow(/outside-book/));

  it("把 Windows 分隔符归一成 POSIX", () =>
    expect(toPosixRelPath("chapters\\01-a.md")).toBe("chapters/01-a.md"));
});
```

`test/frontmatter.test.ts`：
```ts
import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter.js";

describe("frontmatter 往返", () => {
  it("解析标量与列表", () => {
    const { data, body } = parseFrontmatter(
      "---\ntitle: 深渊之下\npov: 李深\ncharacters:\n  - 李深\n  - 周砚\n---\n正文第一段。\n"
    );
    expect(data.title).toBe("深渊之下");
    expect(data.characters).toEqual(["李深", "周砚"]);
    expect(body.trim()).toBe("正文第一段。");
  });

  it("无头部时整块是正文", () => {
    const { data, body } = parseFrontmatter("只有正文。\n");
    expect(data).toEqual({});
    expect(body).toBe("只有正文。\n");
  });

  it("只按首个 --- 闭合切分，正文里的 --- 不误伤", () => {
    const { body } = parseFrontmatter("---\ntitle: A\n---\n上文\n---\n下文\n");
    expect(body).toBe("上文\n---\n下文\n");
  });

  it("序列化后再解析得到同一结果", () => {
    const data = { title: "A", characters: ["甲", "乙"] };
    const round = parseFrontmatter(serializeFrontmatter(data, "正文\n"));
    expect(round.data).toEqual(data);
    expect(round.body).toBe("正文\n");
  });
});
```

Run: `corepack pnpm exec vitest run packages/fs-store --maxWorkers=4`
Expected: FAIL — 模块不存在

- [x] **Step 2: 写实现**

`src/paths.ts`：
```ts
export function toPosixRelPath(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

export function assertSafeRelPath(relPath: string): string {
  if (!relPath || relPath.trim() === "") throw new Error("invalid-path: 空路径");
  const posix = toPosixRelPath(relPath);
  if (posix.startsWith("/") || /^[a-zA-Z]:\//.test(posix))
    throw new Error(`invalid-path: 需要书内相对路径，收到 ${relPath}`);
  const segments = posix.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) throw new Error(`outside-book: 路径越界 ${relPath}`);
  return segments.join("/");
}
```

`src/fingerprint.ts`：
```ts
import { createHash } from "node:crypto";

export function makeFingerprint(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
```

`src/frontmatter.ts`：
```ts
type FrontmatterData = Record<string, string | string[]>;

const FENCE = "---";

export function parseFrontmatter(raw: string): { data: FrontmatterData; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith(`${FENCE}\n`)) return { data: {}, body: text };
  const lines = text.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === FENCE) {
      close = i;
      break;
    }
  }
  if (close === -1) return { data: {}, body: text };
  return { data: parsePairs(lines.slice(1, close)), body: lines.slice(close + 1).join("\n") };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const lines = [FENCE];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else lines.push(`${key}: ${value}`);
  }
  lines.push(FENCE, body);
  return lines.join("\n");
}

function parsePairs(lines: string[]): FrontmatterData {
  const data: FrontmatterData = {};
  let pendingList: { key: string; items: string[] } | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = /^\s+- (.*)$/.exec(line);
    if (item && pendingList) {
      pendingList.items.push(item[1] ?? "");
      continue;
    }
    if (pendingList) {
      data[pendingList.key] = pendingList.items;
      pendingList = null;
    }
    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1] ?? "";
    const inline = (pair[2] ?? "").trim();
    if (inline === "") pendingList = { key, items: [] };
    else data[key] = inline;
  }
  if (pendingList) data[pendingList.key] = pendingList.items;
  return data;
}
```

`src/index.ts`：
```ts
export * from "./paths.js";
export * from "./fingerprint.js";
export * from "./frontmatter.js";
```

- [x] **Step 3: 跑测试 + typecheck**

Run: `corepack pnpm exec vitest run packages/fs-store --maxWorkers=4` → PASS
Run: `corepack pnpm typecheck` → 无错误

- [x] **Step 4: 变异实验**

把 `assertSafeRelPath` 里 `segments.some((s) => s === "..")` 改成恒 `false`，重跑 → 三条穿越用例必须转红；恢复转绿后提交信息里写明。

- [x] **Step 5: 提交**

```bash
git add packages/fs-store
git commit -m "feat(fs-store): 路径校验、内容指纹与 frontmatter 往返"
```

---

### Task 4: fs-store 目录扫描（章节排序 / 五类文稿）

**Files:**
- Create: `packages/fs-store/src/scan.ts`
- Test: `packages/fs-store/test/scan.test.ts`

**Interfaces:**
- Consumes: `DocRef`、`BookKind`（Task 2）、`parseFrontmatter`（Task 3）
- Produces:
  - `const DOC_DIRS: Record<Exclude<BookKind, "material">, string>` 映射章/纲/人/情到目录
  - `listDocDirs(kind: BookKind): string`
  - `scanBook(root: string): Promise<DocRef[]>`（递归 materials，跳过 `.abyss`）
  - `sortChapters(docs: DocRef[], chapterOrder: string[]): DocRef[]`

- [x] **Step 1: 写失败测试（真临时目录）**

`test/scan.test.ts`：
```ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanBook, sortChapters } from "../src/scan.js";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "abyss-scan-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "characters"), { recursive: true });
  await mkdir(path.join(root, "materials", "意象"), { recursive: true });
  await mkdir(path.join(root, ".abyss", "sessions"), { recursive: true });
  await writeFile(path.join(root, "chapters", "02-潮汐.md"), "---\ntitle: 潮汐\n---\n第二段\n");
  await writeFile(path.join(root, "chapters", "10-深渊之下.md"), "正文\n");
  await writeFile(path.join(root, "chapters", "01-开局.md"), "正文\n");
  await writeFile(path.join(root, "characters", "李深.md"), "---\ntitle: 李深\n---\n人物\n");
  await writeFile(path.join(root, "materials", "意象", "雾.md"), "素材\n");
  await writeFile(path.join(root, ".abyss", "sessions", "leak.md"), "不应出现\n");
  await writeFile(path.join(root, "README.md"), "不应出现\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanBook", () => {
  it("按目录归类且跳过 .abyss 与根文件", async () => {
    const docs = await scanBook(root);
    expect(docs.map((d) => d.relPath).sort()).toEqual([
      "chapters/01-开局.md",
      "chapters/02-潮汐.md",
      "chapters/10-深渊之下.md",
      "characters/李深.md",
      "materials/意象/雾.md"
    ]);
    expect(docs.find((d) => d.relPath === "characters/李深.md")?.kind).toBe("character");
    expect(docs.find((d) => d.relPath === "materials/意象/雾.md")?.kind).toBe("material");
  });

  it("标题优先取 frontmatter title，其次取文件名", async () => {
    const docs = await scanBook(root);
    expect(docs.find((d) => d.relPath === "chapters/02-潮汐.md")?.title).toBe("潮汐");
    expect(docs.find((d) => d.relPath === "chapters/10-深渊之下.md")?.title).toBe("深渊之下");
  });
});

describe("sortChapters", () => {
  it("按 chapterOrder 优先排序，未登记的序号补在末尾", async () => {
    const docs = await scanBook(root);
    const sorted = sortChapters(
      docs.filter((d) => d.kind === "chapter"),
      ["chapters/10-深渊之下.md", "chapters/01-开局.md"]
    );
    expect(sorted.map((d) => d.relPath)).toEqual([
      "chapters/10-深渊之下.md",
      "chapters/01-开局.md",
      "chapters/02-潮汐.md"
    ]);
  });
});
```

Run: `corepack pnpm exec vitest run packages/fs-store --maxWorkers=4` → FAIL — `scan.js` 不存在

- [x] **Step 2: 写实现**

`src/scan.ts`：
```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { BookKind, DocRef } from "@abyss/contracts";
import { parseFrontmatter } from "./frontmatter.js";
import { toPosixRelPath } from "./paths.js";

export const DOC_DIRS = {
  chapter: "chapters",
  outline: "outline",
  character: "characters",
  plot: "plot"
} as const satisfies Record<Exclude<BookKind, "material">, string>;

const KIND_BY_DIR: Record<string, BookKind> = Object.fromEntries(
  Object.entries(DOC_DIRS).map(([kind, dir]) => [dir, kind as BookKind])
);

const SKIPPED_DIRS = new Set([".abyss", "node_modules"]);

export async function scanBook(root: string): Promise<DocRef[]> {
  const docs: DocRef[] = [];
  await walk(root, root, docs);
  return docs;
}

async function walk(root: string, dir: string, out: DocRef[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") && entry.name !== ".abyss") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const rel = toPosixRelPath(path.relative(root, full));
    const kind = kindOf(rel);
    if (!kind) continue;
    out.push({ relPath: rel, kind, title: await titleOf(full, rel) });
  }
}

function kindOf(rel: string): BookKind | null {
  if (rel.startsWith("materials/")) return "material";
  const top = rel.split("/")[0] ?? "";
  return KIND_BY_DIR[top] ?? null;
}
async function titleOf(full: string, rel: string): Promise<string> {
  const fallback = (path.basename(rel, ".md").match(/^\d*[-_]?(.*)$/)?.[1] ?? "").trim() || rel;
  try {
    const { data } = parseFrontmatter(await readFile(full, "utf8"));
    const title = data.title;
    return typeof title === "string" && title.trim() ? title.trim() : fallback;
  } catch {
    return fallback;
  }
}

export function sortChapters(docs: DocRef[], chapterOrder: string[]): DocRef[] {
  const rank = new Map(chapterOrder.map((rel, index) => [rel, index]));
  return [...docs].sort((a, b) => {
    const ra = rank.get(a.relPath);
    const rb = rank.get(b.relPath);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.relPath.localeCompare(b.relPath, "zh-CN");
  });
}
```

`src/index.ts` 追加：`export * from "./scan.js";`

- [x] **Step 3: 跑测试 + typecheck**

Run: `corepack pnpm exec vitest run packages/fs-store --maxWorkers=4` → PASS
Run: `corepack pnpm typecheck` → 无错误

- [x] **Step 4: 变异实验**

把 `SKIPPED_DIRS` 清空 → "跳过 .abyss" 断言必须转红；把 `chapterOrder` 查找改成恒 `undefined` → 排序断言转红。恢复后转绿。

- [x] **Step 5: 提交**

```bash
git add packages/fs-store
git commit -m "feat(fs-store): 作品目录扫描与章节排序"
```

---

### Task 5: fs-store 读取 / 备份 / 指纹冲突写盘

**Files:**
- Create: `packages/fs-store/src/read-write.ts`
- Test: `packages/fs-store/test/read-write.test.ts`

**Interfaces:**
- Consumes: `assertSafeRelPath`、`makeFingerprint`、`DocWriteResult`
- Produces:
  - `readDocFile(root: string, relPath: string): Promise<{ content: string; fingerprint: string }>`
  - `writeDocFile(root: string, relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>`
  - 写入语义：读盘算实际指纹 → 不等于 `expectedFingerprint` 则返回 `{ok:false, reason:"stale", currentFingerprint}` 且**不改文件**；相等则先把原内容备份到 `.abyss/changes/<ISO 时间戳>/<relPath>.bak`（文件不存在时 `backupRelPath: null`），再写新内容，返回 `{ok:true, fingerprint, backupRelPath}`

- [x] **Step 1: 写失败测试**

`test/read-write.test.ts`：
```ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFingerprint } from "../src/fingerprint.js";
import { readDocFile, writeDocFile } from "../src/read-write.js";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "abyss-rw-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "01-a.md"), "原稿\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeDocFile", () => {
  it("指纹相符时写盘并备份原稿", async () => {
    const fp = makeFingerprint("原稿\n");
    const result = await writeDocFile(root, "chapters/01-a.md", "新稿\n", fp);
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, "chapters", "01-a.md"), "utf8")).toBe("新稿\n");
    if (!result.ok) throw new Error("unreachable");
    expect(result.backupRelPath).toMatch(/^\.abyss\/changes\/.+\/chapters\/01-a\.md\.bak$/);
    expect(await readFile(path.join(root, result.backupRelPath), "utf8")).toBe("原稿\n");
    expect(result.fingerprint).toBe(makeFingerprint("新稿\n"));
  });

  it("指纹不符时拒绝写入且文件一字不变", async () => {
    await writeFile(path.join(root, "chapters", "01-a.md"), "外部改过\n");
    const before = await readFile(path.join(root, "chapters", "01-a.md"), "utf8");
    const result = await writeDocFile(root, "chapters/01-a.md", "覆盖它\n", makeFingerprint("旧指纹"));
    expect(result).toEqual({
      ok: false,
      reason: "stale",
      currentFingerprint: makeFingerprint("外部改过\n")
    });
    expect(await readFile(path.join(root, "chapters", "01-a.md"), "utf8")).toBe(before);
  });

  it("穿越路径被拒绝", async () => {
    const result = await writeDocFile(root, "../evil.md", "x", makeFingerprint(""));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("outside-book");
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(path.dirname(root))).not.toContain("evil.md");
  });

  it("新建文件时没有备份但父目录自动创建", async () => {
    const result = await writeDocFile(root, "characters/新人物.md", "卡\n", makeFingerprint(""));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.backupRelPath).toBeNull();
    expect(await readFile(path.join(root, "characters/新人物.md"), "utf8")).toBe("卡\n");
  });

  it("readDocFile 报缺失文件为 io-error", async () => {
    await expect(readDocFile(root, "chapters/不存在.md")).rejects.toThrow();
  });
});
```

Run: `corepack pnpm exec vitest run packages/fs-store --maxWorkers=4` → FAIL — `read-write.js` 不存在

- [x] **Step 2: 写实现**

`src/read-write.ts`：
```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocWriteResult } from "@abyss/contracts";
import { makeFingerprint } from "./fingerprint.js";
import { assertSafeRelPath } from "./paths.js";

export async function readDocFile(
  root: string,
  relPath: string
): Promise<{ content: string; fingerprint: string }> {
  const safe = assertSafeRelPath(relPath);
  const content = await readFile(path.join(root, ...safe.split("/")), "utf8");
  return { content, fingerprint: makeFingerprint(content) };
}

export async function writeDocFile(
  root: string,
  relPath: string,
  content: string,
  expectedFingerprint: string
): Promise<DocWriteResult> {
  let safe: string;
  try {
    safe = assertSafeRelPath(relPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message.startsWith("outside-book") ? "outside-book" : "invalid-path",
      message
    };
  }

  const target = path.join(root, ...safe.split("/"));
  let current: string | null = null;
  try {
    current = await readFile(target, "utf8");
  } catch {
    current = null;
  }

  const currentFingerprint = makeFingerprint(current ?? "");
  if (currentFingerprint !== expectedFingerprint)
    return { ok: false, reason: "stale", currentFingerprint };

  let backupRelPath: string | null = null;
  if (current !== null) {
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    backupRelPath = `.abyss/changes/${stamp}/${safe}.bak`;
    const backupTarget = path.join(root, ...backupRelPath.split("/"));
    await mkdir(path.dirname(backupTarget), { recursive: true });
    await writeFile(backupTarget, current, "utf8");
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { ok: true, fingerprint: makeFingerprint(content), backupRelPath };
}
```

`src/index.ts` 追加：`export * from "./read-write.js";`

- [x] **Step 3: 跑测试 + typecheck**

Run: `corepack pnpm exec vitest run packages/fs-store --maxWorkers=4` → PASS 5 项
Run: `corepack pnpm typecheck` → 无错误

- [x] **Step 4: 变异实验（本任务最关键，必须做）**

抽掉备份分支（把 `if (current !== null)` 改成 `if (false)`）→ "写盘并备份原稿" 转红；
把指纹比较改成恒相等 → "拒绝写入且文件一字不变" 转红。两条都验证后恢复，重跑转绿。
在提交信息里写清"两条反向用例先红后绿 + 变异实验转红"。

- [x] **Step 5: 提交**

```bash
git add packages/fs-store
git commit -m "feat(fs-store): 指纹冲突检测写盘与落盘前备份"
```

---

### Task 6: 主进程 book-service + preload 白名单

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.node.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/book-service.ts`, `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/src/main/book-service.test.ts`

**Interfaces:**
- Consumes: `IPC_CHANNELS`、`BookOpenResult`、`DocWriteResult`（Task 2）、`scanBook`/`sortChapters`/`readDocFile`/`writeDocFile`（Task 4/5）
- Produces:
  - `createBookService(): BookService`，`interface BookService { open(rootPath): Promise<BookOpenResult>; saveMeta(meta): Promise<void>; readDoc(relPath): Promise<DocContent>; writeDoc(relPath, content, expectedFingerprint): Promise<DocWriteResult>; close(): Promise<void> }`
  - `registerBookIpc(ipcMain, service): void`
  - 模块级单例 `activeBookRoot: string | null`（未打开书时任何 doc 调用返回 `io-error` 且中文消息"尚未打开作品目录"）

- [x] **Step 1: 建 desktop 骨架**

`apps/desktop/package.json`：
```json
{
  "name": "@abyss/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run src/main --maxWorkers=4"
  },
  "dependencies": {
    "@abyss/contracts": "workspace:*",
    "@abyss/fs-store": "workspace:*"
  },
  "devDependencies": {
    "electron": "catalog:",
    "electron-vite": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

`apps/desktop/tsconfig.node.json`：
```json
{ "extends": "../../tsconfig.base.json", "include": ["src/main", "src/preload"] }
```

`apps/desktop/electron.vite.config.ts`：
```ts
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: { build: { lib: { entry: "src/main/index.ts" } } },
  preload: { build: { lib: { entry: "src/preload/index.ts" } } },
  renderer: {}
});
```

- [x] **Step 2: 写失败测试**

`src/main/book-service.test.ts`（node 环境，不启 electron）：
```ts
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { DEFAULT_PERMISSION_MODE } from "@abyss/contracts";
import { createBookService } from "./book-service";

let root = "";
let other = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "abyss-svc-"));
  other = await mkdtemp(path.join(tmpdir(), "abyss-svc2-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "01-a.md"), "正文\n");
  await writeFile(
    path.join(root, "book.json"),
    JSON.stringify(
      {
        id: "b1",
        title: "测试书",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      },
      null,
      2
    )
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

describe("bookService", () => {
  it("open 返回 meta 与按 chapterOrder 排好的文档列表", async () => {
    const service = createBookService();
    const opened = await service.open(root);
    expect(opened.rootPath).toBe(root);
    expect(opened.meta.title).toBe("测试书");
    expect(opened.docs.map((d) => d.relPath)).toEqual(["chapters/01-a.md"]);
    await service.close();
  });

  it("book.json 非法时 open 抛中文可读错误", async () => {
    await writeFile(path.join(other, "book.json"), "{ not json");
    const service = createBookService();
    await expect(service.open(other)).rejects.toThrow(/book\.json/);
    await service.close();
  });

  it("未打开书时 writeDoc 返回 io-error 且不崩", async () => {
    const service = createBookService();
    const result = await service.writeDoc("chapters/01-a.md", "x", "fp");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("io-error");
    expect(result.message).toContain("尚未打开作品目录");
  });

  it("writeDoc 走指纹冲突：外部改动后拒绝", async () => {
    const service = createBookService();
    await service.open(root);
    const first = await service.readDoc("chapters/01-a.md");
    await writeFile(path.join(root, "chapters", "01-a.md"), "外部改过\n");
    const result = await service.writeDoc("chapters/01-a.md", "覆盖\n", first.fingerprint);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("stale");
    await service.close();
  });
});
```

Run: `corepack pnpm install --prefer-offline && corepack pnpm exec vitest run apps/desktop/src/main --maxWorkers=4`
Expected: FAIL — `book-service` 不存在

- [x] **Step 3: 写实现**

`src/main/book-service.ts`：
```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  parseBookMeta,
  type BookMeta,
  type BookOpenResult,
  type DocContent,
  type DocWriteResult
} from "@abyss/contracts";
import { readDocFile, scanBook, sortChapters, writeDocFile } from "@abyss/fs-store";

export interface BookService {
  open(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(
    relPath: string,
    content: string,
    expectedFingerprint: string
  ): Promise<DocWriteResult>;
  close(): Promise<void>;
}

export function registerBookIpc(
  ipcMain: { handle(channel: string, fn: (...args: any[]) => unknown): void },
  service: BookService
): void {
  ipcMain.handle(IPC_CHANNELS.bookOpen, (_event, rootPath: string) => service.open(rootPath));
  ipcMain.handle(IPC_CHANNELS.bookSaveMeta, (_event, meta: BookMeta) => service.saveMeta(meta));
  ipcMain.handle(IPC_CHANNELS.docRead, (_event, relPath: string) => service.readDoc(relPath));
  ipcMain.handle(
    IPC_CHANNELS.docWrite,
    (_event, relPath: string, content: string, expectedFingerprint: string) =>
      service.writeDoc(relPath, content, expectedFingerprint)
  );
}

export function createBookService(): BookService {
  let root: string | null = null;

  const requireRoot = (message: string) => {
    if (!root) return message;
    return null;
  };

  return {
    async open(rootPath: string) {
      const raw = await readFile(path.join(rootPath, "book.json"), "utf8");
      let meta: BookMeta;
      try {
        meta = parseBookMeta(JSON.parse(raw));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法解析 book.json：${message}`);
      }
      const docs = sortChapters(await scanBook(rootPath), meta.chapterOrder);
      root = rootPath;
      return { rootPath, meta, docs };
    },

    async saveMeta(meta: BookMeta) {
      const missing = requireRoot("尚未打开作品目录，无法保存 book.json");
      if (missing) throw new Error(missing);
      parseBookMeta(meta);
      await writeFile(path.join(root as string, "book.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    },

    async readDoc(relPath: string) {
      if (!root) throw new Error("尚未打开作品目录");
      return { relPath, ...(await readDocFile(root, relPath)) };
    },

    async writeDoc(relPath, content, expectedFingerprint) {
      if (!root)
        return { ok: false, reason: "io-error", message: "尚未打开作品目录" };
      return writeDocFile(root, relPath, content, expectedFingerprint);
    },

    async close() {
      root = null;
    }
  };
}
```

`src/main/index.ts`（窗口在 Task 7 建，这里先最小可跑，保证 dev 不白屏）：
```ts
import { app, BrowserWindow, ipcMain } from "electron";
import { registerBookIpc, createBookService } from "./book-service";

const service = createBookService();

app.whenReady().then(() => {
  registerBookIpc(ipcMain, service);
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: `${app.getAppPath()}/out/preload/index.mjs`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once("ready-to-show", () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
});
```

`src/preload/index.ts`（只暴露白名单，不暴露 ipcRenderer）：
```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type RendererApi } from "@abyss/contracts";

const api: RendererApi = {
  openBook: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.bookOpen, rootPath),
  saveMeta: (meta) => ipcRenderer.invoke(IPC_CHANNELS.bookSaveMeta, meta),
  readDoc: (relPath) => ipcRenderer.invoke(IPC_CHANNELS.docRead, relPath),
  writeDoc: (relPath, content, expectedFingerprint) =>
    ipcRenderer.invoke(IPC_CHANNELS.docWrite, relPath, content, expectedFingerprint)
};

contextBridge.exposeInMainWorld("abyss", api);
```

- [x] **Step 4: 跑测试 + 边界门禁**

Run: `corepack pnpm exec vitest run apps/desktop/src/main --maxWorkers=4` → PASS 4 项
Run: `corepack pnpm lint:boundary` → 通过（electron import 只出现在 `apps/desktop`，不在 `packages/*`）

- [x] **Step 5: 变异实验**

把 `writeDoc` 的 `if (!root)` 保护删掉 → "未打开书时" 用例转红；
把 `open()` 里的 `parseBookMeta` 调用删掉 → "非法时抛中文错误" 转红。恢复转绿后提交。

- [x] **Step 6: 提交**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "feat(desktop): 主进程 book-service 与 preload 白名单 IPC"
```

---

### Task 7: 三栏壳 + 左树 + 右双标签 + 保存冲突

**Files:**
- Create: `apps/desktop/tsconfig.web.json`, `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/src/main.ts`, `App.vue`, `styles/glass.css`, `stores/useBookStore.ts`, `components/LeftSidebar.vue`, `components/CenterColumn.vue`, `components/ManuscriptTabs.vue`, `components/DocumentPane.vue`, `components/BrowsePane.vue`, `components/SaveConflictDialog.vue`, `env.d.ts`
- Test: `apps/desktop/src/renderer/src/stores/useBookStore.test.ts`（store 逻辑用 vitest 直测，UI 靠冒烟截图）

**Interfaces:**
- Consumes: `RendererApi`（Task 6 注入为 `window.abyss`）、`DocRef`/`DocContent`/`DocWriteResult`
- Produces:
  - `useBookStore()`：`state = { rootPath, meta, docs, docTabs: string[], browseTabs: DocRef[], activeDocTab, activeBrowseTab, draft, savedFingerprint, conflict: {current, incoming} | null }`
  - `actions = openBook(rootPath) / openDocTab(relPath) / closeTab(relPath) / browse(ref) / closeBrowse(relPath) / saveActive() / reloadActive() / onEdit(content) / refOf(relPath): DocRef | null`
  - **不变式（本任务要证明的）**：`browse()` 不改变 `docTabs`/`activeDocTab`/`draft`；`saveActive()` 在 `stale` 时设 `conflict` 且不更新 `savedFingerprint`

- [x] **Step 1: 建渲染层配置与入口**

`apps/desktop/tsconfig.web.json`：
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "jsx": "preserve", "types": ["vite/client"] },
  "include": ["src/renderer"]
}
```

`apps/desktop/src/renderer/env.d.ts`：
```ts
import type { RendererApi } from "@abyss/contracts";

declare global {
  interface Window {
    abyss: RendererApi;
  }
}

export {};
```

`apps/desktop/src/renderer/index.html`：
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>深渊写作</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`src/renderer/src/main.ts`：
```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/glass.css";

createApp(App).use(createPinia()).mount("#app");
```

`src/renderer/src/styles/glass.css`（深色毛玻璃，禁像素风）：
```css
:root {
  --bg: #0b0f16;
  --glass: rgba(255, 255, 255, 0.05);
  --glass-strong: rgba(255, 255, 255, 0.09);
  --edge: rgba(255, 255, 255, 0.12);
  --text: #dbe3ef;
  --text-dim: #8b98ad;
  --accent: #6fd3c7;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: radial-gradient(1200px 700px at 20% -10%, #16233a 0%, var(--bg) 55%),
    radial-gradient(900px 600px at 110% 110%, #1b1220 0%, var(--bg) 60%);
  color: var(--text);
  font: 14px/1.7 "Sarasa UI SC", "Microsoft YaHei UI", system-ui, sans-serif;
}
.panel {
  background: var(--glass);
  border: 1px solid var(--edge);
  backdrop-filter: blur(18px) saturate(140%);
  overflow: hidden;
}
.three-col {
  display: grid;
  grid-template-columns: 268px minmax(360px, 1fr) minmax(420px, 1.25fr);
  gap: 10px;
  padding: 10px;
  height: 100vh;
}
```

- [x] **Step 2: 写 store 的失败测试**

`src/renderer/src/stores/useBookStore.test.ts`：
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { RendererApi, BookOpenResult } from "@abyss/contracts";
import { useBookStore } from "./useBookStore";

const result: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "read-only",
    chapterOrder: ["chapters/01-a.md"]
  },
  docs: [
    { relPath: "chapters/01-a.md", kind: "chapter", title: "开局" },
    { relPath: "materials/雾.md", kind: "material", title: "雾" }
  ]
};

const readDoc = vi.fn(async (relPath: string) => ({ relPath, content: "正文\n", fingerprint: "fp-a" }));
const writeDoc = vi.fn(async () => ({ ok: false, reason: "stale", currentFingerprint: "fp-x" }) as const);
const api = {
  openBook: vi.fn(async () => result),
  saveMeta: vi.fn(async () => {}),
  readDoc,
  writeDoc
} satisfies RendererApi;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { abyss: api });
  readDoc.mockClear();
  writeDoc.mockClear();
});

describe("useBookStore", () => {
  it("打开文稿标签后草稿与指纹一起就位", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    expect(store.docTabs).toEqual(["chapters/01-a.md"]);
    expect(store.draft).toBe("正文\n");
    expect(store.savedFingerprint).toBe("fp-a");
  });

  it("浏览素材不打断当前文稿：标签、活动章、草稿都不变", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    const before = { tabs: [...store.docTabs], active: store.activeDocTab, draft: store.draft };
    store.browse(result.docs[1]!);
    expect(store.browseTabs.map((d) => d.relPath)).toEqual(["materials/雾.md"]);
    expect(store.docTabs).toEqual(before.tabs);
    expect(store.activeDocTab).toBe(before.active);
    expect(store.draft).toBe(before.draft);
    expect(readDoc).toHaveBeenCalledTimes(1);
  });

  it("指纹过期时报冲突、不改草稿、不更新已存指纹", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.draft = "我改的\n";
    await store.saveActive();
    expect(store.conflict?.currentFingerprint).toBe("fp-x");
    expect(store.draft).toBe("我改的\n");
    expect(store.savedFingerprint).toBe("fp-a");
  });

  it("reloadActive 用盘上内容覆盖草稿并清冲突", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    await store.saveActive();
    readDoc.mockResolvedValueOnce({ relPath: "chapters/01-a.md", content: "盘上的\n", fingerprint: "fp-x" });
    await store.reloadActive();
    expect(store.draft).toBe("盘上的\n");
    expect(store.conflict).toBeNull();
  });
});
```

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer --maxWorkers=4`
Expected: FAIL — `useBookStore` 不存在

- [x] **Step 3: 写 store**

`src/renderer/src/stores/useBookStore.ts`：
```ts
import { defineStore } from "pinia";
import type { DocRef } from "@abyss/contracts";

export const useBookStore = defineStore("book", {
  state: () => ({
    rootPath: null as string | null,
    meta: null as import("@abyss/contracts").BookMeta | null,
    docs: [] as DocRef[],
    docTabs: [] as string[],
    activeDocTab: null as string | null,
    browseTabs: [] as DocRef[],
    activeBrowse: null as string | null,
    browseContents: {} as Record<string, string>,
    draft: "",
    savedFingerprint: "",
    dirty: false,
    saving: false,
    conflict: null as { currentFingerprint: string } | null,
    notice: ""
  }),

  actions: {
    async openBook(rootPath: string) {
      const opened = await window.abyss.openBook(rootPath);
      this.rootPath = opened.rootPath;
      this.meta = opened.meta;
      this.docs = opened.docs;
    },

    refOf(relPath: string) {
      return this.docs.find((d) => d.relPath === relPath) ?? null;
    },

    async openDocTab(relPath: string) {
      if (!this.docTabs.includes(relPath)) this.docTabs.push(relPath);
      this.activeDocTab = relPath;
      const loaded = await window.abyss.readDoc(relPath);
      this.draft = loaded.content;
      this.savedFingerprint = loaded.fingerprint;
      this.dirty = false;
      this.conflict = null;
    },

    closeTab(relPath: string) {
      this.docTabs = this.docTabs.filter((p) => p !== relPath);
      if (this.activeDocTab !== relPath) return;
      const next = this.docTabs[this.docTabs.length - 1] ?? null;
      this.activeDocTab = next;
      if (next) void this.openDocTab(next);
      else {
        this.draft = "";
        this.savedFingerprint = "";
        this.dirty = false;
        this.conflict = null;
      }
    },

    /** 浏览：只动浏览标签集合，绝不触碰文稿标签与草稿。 */
    browse(ref: DocRef) {
      if (!this.browseTabs.some((d) => d.relPath === ref.relPath)) this.browseTabs.push(ref);
      this.activeBrowse = ref.relPath;
      if (this.browseContents[ref.relPath] === undefined) {
        void window.abyss.readDoc(ref.relPath).then((loaded) => {
          this.browseContents[ref.relPath as string] = loaded.content;
        });
      }
    },

    closeBrowse(relPath: string) {
      this.browseTabs = this.browseTabs.filter((d) => d.relPath !== relPath);
      delete this.browseContents[relPath];
      if (this.activeBrowse === relPath)
        this.activeBrowse = this.browseTabs[this.browseTabs.length - 1]?.relPath ?? null;
    },

    onEdit(content: string) {
      this.draft = content;
      this.dirty = true;
    },

    async saveActive() {
      if (!this.activeDocTab) return;
      this.saving = true;
      const result = await window.abyss.writeDoc(
        this.activeDocTab,
        this.draft,
        this.savedFingerprint
      );
      this.saving = false;
      if (result.ok) {
        this.savedFingerprint = result.fingerprint;
        this.dirty = false;
        this.conflict = null;
        this.notice = result.backupRelPath ? "已保存，原稿已备份" : "已保存";
        return;
      }
      if (result.reason === "stale") {
        this.conflict = { currentFingerprint: result.currentFingerprint };
        this.notice = "文件在外部被改过，已拒绝覆盖";
      } else this.notice = `保存失败：${result.message}`;
    },

    async reloadActive() {
      if (!this.activeDocTab) return;
      const loaded = await window.abyss.readDoc(this.activeDocTab);
      this.draft = loaded.content;
      this.savedFingerprint = loaded.fingerprint;
      this.dirty = false;
      this.conflict = null;
    }
  }
});
```

- [x] **Step 4: 跑测试确认绿 + 变异实验**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer --maxWorkers=4` → PASS 4 项
变异：把 `browse()` 里 `this.docTabs.push` 之类副作用加进去（误改文稿标签）→ "浏览不打断" 必须转红；把 `stale` 分支改成也更新 `savedFingerprint` → 冲突用例转红。恢复转绿。

- [x] **Step 5: 写三栏 UI（消费 store）**

`App.vue`：
```vue
<script setup lang="ts">
import LeftSidebar from "./components/LeftSidebar.vue";
import CenterColumn from "./components/CenterColumn.vue";
import ManuscriptTabs from "./components/ManuscriptTabs.vue";
import DocumentPane from "./components/DocumentPane.vue";
import BrowsePane from "./components/BrowsePane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
</script>

<template>
  <div class="three-col">
    <LeftSidebar class="panel" />
    <CenterColumn class="panel" />
    <section class="panel right">
      <ManuscriptTabs />
      <DocumentPane />
      <BrowsePane />
      <SaveConflictDialog />
    </section>
  </div>
</template>

<style scoped>
.right { display: flex; flex-direction: column; min-width: 0; }
</style>
```

`components/CenterColumn.vue`（本轮只放占位与状态行，Plan 2 换成对话流）：
```vue
<script setup lang="ts">
import { useBookStore } from "../stores/useBookStore";

const store = useBookStore();
</script>

<template>
  <div class="center">
    <header class="ctx">
      <span>{{ store.meta?.title ?? "未打开作品" }}</span>
      <span class="dim">权限档：{{ store.meta?.permissionMode ?? "read-only" }}</span>
    </header>
    <div class="placeholder">智能体对话区（Plan 2 接入）</div>
    <footer class="status">空闲 · 无待审提案</footer>
  </div>
</template>

<style scoped>
.center { display: flex; flex-direction: column; min-width: 0; }
.ctx { display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--edge); }
.placeholder { flex: 1; display: grid; place-items: center; color: var(--text-dim); }
.status { padding: 8px 14px; border-top: 1px solid var(--edge); color: var(--text-dim); font-size: 12px; }
.dim { color: var(--text-dim); }
</style>
```

`components/LeftSidebar.vue`（作品树 + 技能库占位；选中章=开文稿标签，选中素材/技能=浏览）：
```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { useBookStore } from "../stores/useBookStore";
import type { BookKind } from "@abyss/contracts";

const store = useBookStore();
const dir = ref("");

const KIND_LABEL: Record<BookKind, string> = {
  chapter: "章节",
  outline: "大纲",
  character: "人物",
  plot: "剧情",
  material: "素材"
};
const groups = computed(() => {
  const map = new Map<BookKind, typeof store.docs>();
  for (const doc of store.docs) {
    const list = map.get(doc.kind) ?? [];
    list.push(doc);
    map.set(doc.kind, list);
  }
  return [...map.entries()];
});

function pick(doc: (typeof store.docs)[number]) {
  if (doc.kind === "chapter" || doc.kind === "outline") void store.openDocTab(doc.relPath);
  else store.browse(doc);
}
</script>

<template>
  <nav class="side">
    <div class="row">
      <input v-model="dir" placeholder="作品目录绝对路径" />
      <button class="go" @click="store.openBook(dir)">打开</button>
    </div>
    <div v-for="[kind, docs] in groups" :key="kind" class="group">
      <h4>{{ KIND_LABEL[kind] }}</h4>
      <button
        v-for="doc of docs"
        :key="doc.relPath"
        class="node"
        :class="{ active: doc.relPath === store.activeDocTab || doc.relPath === store.activeBrowse }"
        @click="pick(doc)"
      >
        {{ doc.title }}
      </button>
    </div>
    <p v-if="!store.docs.length" class="dim">还没有文稿，先打开一个作品目录。</p>
  </nav>
</template>

<style scoped>
.side { display: flex; flex-direction: column; gap: 8px; padding: 12px; overflow: auto; }
.row { display: flex; gap: 6px; }
.row input {
  flex: 1; min-width: 0; background: var(--glass-strong); border: 1px solid var(--edge);
  border-radius: 6px; color: var(--text); padding: 6px 8px;
}
button { background: var(--glass-strong); border: 1px solid var(--edge); border-radius: 6px; color: var(--text); padding: 5px 9px; cursor: pointer; }
.node { display: block; width: 100%; text-align: left; margin-top: 4px; }
.node.active { border-color: var(--accent); color: var(--accent); }
h4 { margin: 10px 0 2px; font-size: 12px; color: var(--text-dim); font-weight: 600; letter-spacing: .08em; }
.dim { color: var(--text-dim); }
</style>
```

`components/ManuscriptTabs.vue`：
```vue
<script setup lang="ts">
import { useBookStore } from "../stores/useBookStore";

const store = useBookStore();
function titleOf(relPath: string) {
  return store.refOf(relPath)?.title ?? relPath;
}
</script>

<template>
  <div class="tabs">
    <button
      v-for="relPath of store.docTabs"
      :key="relPath"
      class="tab"
      :class="{ active: relPath === store.activeDocTab }"
      @click="store.openDocTab(relPath)"
    >
      {{ titleOf(relPath) }}
      <span class="close" @click.stop="store.closeTab(relPath)">×</span>
    </button>
    <span v-if="!store.docTabs.length" class="dim">文稿标签为空</span>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--edge); overflow: auto; }
.tab { display: inline-flex; gap: 6px; align-items: center; background: var(--glass-strong); border: 1px solid var(--edge); border-radius: 6px; color: var(--text); padding: 4px 8px; cursor: pointer; white-space: nowrap; }
.tab.active { border-color: var(--accent); }
.close { color: var(--text-dim); }
.dim { color: var(--text-dim); }
</style>
```

`components/DocumentPane.vue`：
```vue
<script setup lang="ts">
import { useBookStore } from "../stores/useBookStore";

const store = useBookStore();
</script>

<template>
  <div v-if="store.activeDocTab" class="doc">
    <textarea
      class="editor"
      spellcheck="false"
      :value="store.draft"
      @input="store.onEdit(($event.target as HTMLTextAreaElement).value)"
    />
    <footer class="bar">
      <span class="dim">{{ store.notice }}</span>
      <button :disabled="!store.dirty || store.saving" @click="store.saveActive()">
        {{ store.saving ? "保存中" : "保存" }}
      </button>
    </footer>
  </div>
  <p v-else class="empty dim">从左侧选择章节或大纲开始。</p>
</template>

<style scoped>
.doc { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.editor {
  flex: 1; width: 100%; resize: none; border: 0; padding: 18px 22px;
  background: transparent; color: var(--text); font: 15px/1.9 inherit;
}
.editor:focus { outline: none; }
.bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid var(--edge); }
button { background: var(--glass-strong); border: 1px solid var(--edge); border-radius: 6px; color: var(--text); padding: 5px 12px; cursor: pointer; }
button:disabled { color: var(--text-dim); cursor: default; }
.empty { padding: 24px; }
.dim { color: var(--text-dim); }
</style>
```

`components/BrowsePane.vue`（只读预览，明确标注只读）：
```vue
<script setup lang="ts">
import { useBookStore } from "../stores/useBookStore";

const store = useBookStore();
</script>

<template>
  <div v-if="store.activeBrowse" class="browse">
    <header>
      <span>浏览 · {{ store.refOf(store.activeBrowse)?.title }}（只读）</span>
      <button @click="store.closeBrowse(store.activeBrowse as string)">关闭</button>
    </header>
    <pre>{{ store.browseContents[store.activeBrowse] ?? "载入中…" }}</pre>
  </div>
</template>

<style scoped>
.browse { max-height: 40%; display: flex; flex-direction: column; border-top: 1px solid var(--edge); background: var(--glass); }
header { display: flex; justify-content: space-between; padding: 6px 12px; color: var(--text-dim); font-size: 12px; }
pre { flex: 1; margin: 0; padding: 10px 14px; overflow: auto; white-space: pre-wrap; font: 13px/1.7 inherit; color: var(--text); }
button { background: none; border: 0; color: var(--text-dim); cursor: pointer; }
</style>
```

`components/SaveConflictDialog.vue`：
```vue
<script setup lang="ts">
import { useBookStore } from "../stores/useBookStore";

const store = useBookStore();
</script>

<template>
  <div v-if="store.conflict" class="mask">
    <div class="box panel">
      <h3>文件在外部被改过</h3>
      <p>深渊写作不会覆盖你的改动。选一个：</p>
      <div class="actions">
        <button @click="store.reloadActive()">重载盘上内容</button>
        <button @click="store.conflict = null">保留我的草稿</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .55); }
.box { padding: 22px 26px; min-width: 380px; }
h3 { margin: 0 0 6px; }
.actions { display: flex; gap: 10px; margin-top: 14px; }
button { background: var(--glass-strong); border: 1px solid var(--edge); border-radius: 6px; color: var(--text); padding: 7px 14px; cursor: pointer; }
</style>
```

- [x] **Step 6: 起 dev 真窗口冒烟 + 截图验收**

```bash
corepack pnpm dev   # 后台起
```
用 computer-use 打开窗口，在左栏输入一个真实书目录（先用 `node -e` 在 `Desktop/.abyss-fixture/` 造一本：`book.json` + 两章），点"打开"，验证：
1. 三栏渲染、毛玻璃生效、无白屏（截图）。
2. 点章节 → 右栏出文稿标签与正文。
3. 点素材 → 只多出浏览区，文稿标签与草稿不变（对照 Step 4 的反向用例）。
4. 改正文点保存 → 落盘，`.abyss/changes/` 出现 `.bak`。
5. 外部改同一文件后再保存 → 弹"文件在外部被改过"，文件不被覆盖（读文件字节核对）。

注意：computer-use 的 UIA Invoke 不触发 Vue `@click`，用坐标点击；停 dev 后还要 `taskkill electron`。

- [x] **Step 7: 提交**

```bash
git add apps/desktop
git commit -m "feat(renderer): 三栏壳、作品树、文稿/浏览双标签与保存冲突守卫"
```

---

### Task 8: 全链门禁与首轮收尾

**Files:**
- Modify: `package.json`（`verify` 脚本补 `lint:eslint`）
- Create: `docs/superpowers/plans/README.md`（Plan 2/3 的入口说明）

- [x] **Step 1: 写计划索引**

`eslint.config.js`、`prettier.config.mjs`、`vitest.config.ts` 均已在 Task 1b 落地，本任务不重复创建；若 `pnpm lint:eslint` 报缺依赖，回到 Task 1b 的 devDependencies 清单补齐，不要新造规则集。

`docs/superpowers/plans/README.md`：
```markdown
# 实现计划索引

- Plan 1（本目录 `2026-10-01-plan1-shell-and-file-layer.md`）：三栏壳 + 文件层，对应 spec 的 S1/S2。
- Plan 2（待写）：流式对话 + 提案写盘，对应 S3/S4；依赖 Plan 1 的 `contracts`、`fs-store` 与 `RendererApi`。
- Plan 3（待写）：键位/权限档/打断排队 + 阶段装配与浏览不打断，对应 S5/S6。
```

- [x] **Step 2: 跑全量 verify 并回读退出码**

Run: `corepack pnpm verify 2>&1 | tee /tmp/abyss-verify.log; grep VERIFY_EXIT /tmp/abyss-verify.log`
Expected: `VERIFY_EXIT=0` 且测试总数 > 15。
**不要把管道末端 `tail`/`tee` 的退出码当门禁码**——必须回读日志里的 `VERIFY_EXIT` 与用例总数。

- [x] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: 根测试与门禁配置，Plan 1 收尾"
```

- [x] **Step 4: 交付核对表（人工过一遍）**

- [x] 能开真实作品目录、读五类文稿
- [x] 章节按 `chapterOrder` 排序，未登记章补末尾
- [x] 外部改动冲突时拒绝覆盖并备份原稿
- [x] 浏览素材不打断文稿（有测试 + 有截图）
- [x] `packages/*` 无 electron import（门禁绿）
- [x] 无单文件超 800 行（门禁绿）
- [x] 每个关键断言做过变异实验

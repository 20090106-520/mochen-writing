import { readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UNBOUND } from "@mochen/contracts";
// 主进程 tsconfig 走 node16 解析：跨层 import 必须带显式扩展名。
import { typeScriptSource } from "../renderer/src/utils/vue-source-reader.js";

/**
 * 「未绑定线程」哨兵只许有一份实现（铁律 6）。
 *
 * 这条哨兵是**跨进程契约**：主进程按 `threadKey === UNBOUND` 判「审批时没有当前章」，
 * 渲染层按它认「这一轮不属于任何文稿」。Plan 2 冒烟报告把它列进「未做真机 DevTools 操作」的四项里；
 * 本轮真机排查时顺着它往下查，发现更要命的一层：两侧当时是**两份独立的 `const UNBOUND = "unbound"`**，
 * 只靠渲染层一句「与主进程 agent-service.ts:38 的同名常量必须一致」维系——
 * 而那句话里的行号当场就漂了（实际在第 50 行）。注释不是类型系统，改一边另一边照样编译通过。
 *
 * 所以这里不只验「两边值相等」（那正是原来那条弱断言），而是钉住**三处源码的形状**：
 * contracts 定义、两侧都从它转出、两侧都不许再有本地 const。少任何一处都红。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const agentServiceSource = readFileSync(path.join(here, "agent-service.ts"), "utf8");
const contractsSource = readFileSync(
  path.join(repoRoot, "packages", "contracts", "src", "agent-event.ts"),
  "utf8"
);
// vue-source-reader 的调用约定：传相对 renderer/src 的片段（它自己从 utils/ 目录用 ../ 回退）。
const agentThreadSource = typeScriptSource("utils/agent-thread.ts");

/** 除定义点之外，任何生产代码里都不许再声明它。 */
const DEFINITION_FILE = path.join("packages", "contracts", "src", "agent-event.ts");

function localDeclarations(): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "out", "dist", ".git", ".mochen-tmp"].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|vue|mjs)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        if (path.relative(repoRoot, full) === DEFINITION_FILE) continue;
        if (/const UNBOUND\s*=/.test(readFileSync(full, "utf8"))) {
          hits.push(path.relative(repoRoot, full));
        }
      }
    }
  };
  walk(path.join(repoRoot, "apps"));
  walk(path.join(repoRoot, "packages"));
  return hits;
}

describe("UNBOUND 只许有一份", () => {
  it("contracts 是唯一定义点", () => {
    expect(contractsSource).toContain('export const UNBOUND = "unbound";');
    expect(UNBOUND).toBe("unbound");
  });

  it("渲染层从 contracts 拿，不再自己声明", () => {
    // 钉的是「先 import 进模块作用域、再 export 出去」这个形状：
    // 纯再导出（export { X } from "..."）不会在模块作用域建绑定，
    // 同文件的 threadKeyFor 会吃到 ReferenceError——这条钉的就是那个坑。
    expect(agentThreadSource).toMatch(
      /import \{[\s\S]*?\bUNBOUND\b[\s\S]*?\} from "@mochen\/contracts";/
    );
    expect(agentThreadSource).toContain("export { UNBOUND };");
    expect(agentThreadSource).not.toMatch(/const UNBOUND\s*=/);
  });

  it("主进程从 contracts 导入，不再自己声明（这条正对着当年那句漂了行号的注释）", () => {
    expect(agentServiceSource).not.toMatch(/const UNBOUND\s*=/);
    expect(agentServiceSource).toMatch(
      /import \{[\s\S]*?\bUNBOUND\b[\s\S]*?\} from "@mochen\/contracts";/
    );
  });

  it("全仓生产代码里再没有第二处 UNBOUND 赋值", () => {
    expect(localDeclarations()).toEqual([]);
  });
});

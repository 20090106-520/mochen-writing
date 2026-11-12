import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `openBook` 的失败分支（2026-11-12）。
 *
 * 真机症状：作品库里点一条目录已经不在的书 —— 界面一点反应都没有。
 * 成因不是「提示没写」，是**这条通路压根没有失败分支**：`book:open` 是抛错语义
 * （读不到 `book.json` 就 throw），而 `book:create` 返回 `{ ok, message }`。
 * `openBook` 既没 catch 也不看返回值，异常直接变成没人处理的 promise rejection。
 *
 * 这一族随后搬进了 `composables/book-open.ts`（`useBookStore.ts` 贴着 800 行预算，
 * 正好这时候该拆）。所以守卫读的是那一份，另加一条钉住 store 真的委托了过去——
 * 只测 composable 不够：`openBook` 哪天自己又写回一份，这条守卫得红。
 */
const OPEN = readFileSync(new URL("../composables/book-open.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("../stores/useBookStore.ts", import.meta.url), "utf8");

function fnBlock(source: string, name: string): string {
  return (
    new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`, "u").exec(source)?.[0] ?? ""
  );
}

describe("openBookInto 的失败分支", () => {
  it("try/catch 包住那次 IPC，catch 里用 openFailureText 说人话", () => {
    const block = fnBlock(OPEN, "openBookInto");
    expect(block, "没找到 openBookInto").not.toBe("");
    expect(block).toContain("try {");
    expect(block).toContain("catch (error)");
    expect(block).toContain("target.notice = openFailureText(error);");
  });

  it("失败时不清状态：只写一句 notice，不动当前这本书", () => {
    const block = fnBlock(OPEN, "openBookInto");
    const catchPart = block.slice(block.indexOf("catch (error)"));
    expect(catchPart, "catch 里又调了 applyOpened：打开失败却把半份结果填进去了").not.toContain(
      "applyOpened"
    );
    // 主进程的 snapshot 只在成功后才换，打开失败时当前这本书原样还在。
    expect(catchPart).not.toContain("rootPath");
    expect(catchPart).not.toContain("docs");
  });

  it("成功那条路还在：applyOpened 与「已打开」都在 try 里", () => {
    const block = fnBlock(OPEN, "openBookInto");
    const tryPart = block.slice(block.indexOf("try {"), block.indexOf("catch (error)"));
    expect(tryPart).toContain("applyOpened");
    expect(tryPart).toContain("已打开");
  });

  it("store 只委托，不再自己写一份：同一段逻辑只有一处", () => {
    const storeBlock =
      /async openBook\(rootPath: string\) \{[\s\S]*?\n {4}\},/u.exec(STORE)?.[0] ?? "";
    expect(storeBlock, "没找到 store 的 openBook").not.toBe("");
    expect(storeBlock).toContain("await openBookInto(this, rootPath);");
    // 委托之后这里不该再有第二份 try/catch —— 有两份就会有两套说法。
    expect(storeBlock).not.toContain("catch");
    expect(storeBlock).not.toContain("applyOpened");
  });
});

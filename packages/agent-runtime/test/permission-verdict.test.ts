import { checkWritePermission, WRITABLE_TOP_DIRS } from "../src/permission.js";
import {
  minimumModeFor,
  writeVerdict,
  type PermissionMode,
  type WriteVerdict,
  type WriteVerdictInput
} from "@mochen/contracts";
import { describe, expect, it } from "vitest";

/**
 * 档位闸的**判定**（contracts 的 writeVerdict / minimumModeFor）与**文案**（agent-runtime 的
 * checkWritePermission）必须说的是同一件事。
 *
 * 渲染层要靠判定来说「切到哪一档之后这条就能批」——如果它自己再写一遍规则，两边迟早漂：
 * 主进程放行而卡上还在劝用户切档，用户按了还是没反应。所以这个文件钉的是**两边一致**，
 * 而不只是各自自洽。
 */
const CH = "chapters/01-开局.md";
const OTHER = "characters/雾.md";

/**
 * 本文件钉的是**动手档**（= 改动前的行为）下的两边一致；
 * 计划档的判决与文案一致性由 contracts/test/permission-plan-mode.test.ts 与
 * 这里的「计划档也一致」那条一起管。
 * workMode 固定在这一层，免得每条断言都写一遍 workMode: "act" 把真正的断言淹掉。
 */
const verdict = (input: Omit<WriteVerdictInput, "workMode">): WriteVerdict =>
  writeVerdict({ ...input, workMode: "act" });

/** 判定与文案两条路给出的「能不能写」必须逐格相同。 */
function agrees(input: {
  mode: PermissionMode;
  docRelPath: string;
  currentChapter: string | null;
}): boolean {
  return (
    (verdict(input).kind === "allowed") ===
    checkWritePermission({ ...input, workMode: "act" }).allowed
  );
}

describe("writeVerdict · 判定", () => {
  it("三个档 × 三个目标的九格，判定与文案不许有一格不一致", () => {
    for (const mode of ["read-only", "chapter-write", "full-access"] as const) {
      for (const docRelPath of [CH, OTHER, "book.json"]) {
        for (const currentChapter of [CH, null]) {
          expect(
            agrees({ mode, docRelPath, currentChapter }),
            `${mode} / ${docRelPath} / ${currentChapter ?? "null"}`
          ).toBe(true);
        }
      }
    }
  });

  it("目标不在可写目录内 ⇒ outside-writable，再大的档也没用", () => {
    expect(verdict({ mode: "full-access", docRelPath: "book.json", currentChapter: CH })).toEqual({
      kind: "outside-writable"
    });
    expect(
      verdict({ mode: "full-access", docRelPath: ".mochen/changes/x.md", currentChapter: CH })
    ).toEqual({ kind: "outside-writable" });
  });

  it("只读档对任何可写目标都是 mode-too-tight，并报出够用的最低档", () => {
    expect(verdict({ mode: "read-only", docRelPath: CH, currentChapter: CH })).toEqual({
      kind: "mode-too-tight",
      needed: "chapter-write"
    });
    expect(verdict({ mode: "read-only", docRelPath: OTHER, currentChapter: CH })).toEqual({
      kind: "mode-too-tight",
      needed: "full-access"
    });
  });

  it("可改当前章档：不是当前章 ⇒ not-current-chapter；没选定当前章 ⇒ no-current-chapter", () => {
    expect(verdict({ mode: "chapter-write", docRelPath: OTHER, currentChapter: CH })).toEqual({
      kind: "not-current-chapter",
      currentChapter: CH
    });
    expect(verdict({ mode: "chapter-write", docRelPath: CH, currentChapter: null })).toEqual({
      kind: "no-current-chapter"
    });
    expect(verdict({ mode: "chapter-write", docRelPath: CH, currentChapter: CH })).toEqual({
      kind: "allowed"
    });
  });

  it("全开档对可写目录内的目标一律放行（不再看是不是当前章）", () => {
    expect(verdict({ mode: "full-access", docRelPath: OTHER, currentChapter: CH })).toEqual({
      kind: "allowed"
    });
    expect(verdict({ mode: "full-access", docRelPath: CH, currentChapter: null })).toEqual({
      kind: "allowed"
    });
  });
});

describe("minimumModeFor · 提案卡上那颗按钮指向哪一档", () => {
  it("目标就是当前章 ⇒ 可改当前章；否则 ⇒ 全开", () => {
    expect(minimumModeFor(CH, CH)).toBe("chapter-write");
    expect(minimumModeFor(OTHER, CH)).toBe("full-access");
    expect(minimumModeFor(CH, null)).toBe("full-access");
  });

  it("报出来的档真的能放行（不是「建议」而是「切过去就能批」）", () => {
    for (const docRelPath of [CH, OTHER]) {
      const needed = minimumModeFor(docRelPath, CH);
      expect(
        checkWritePermission({ mode: needed, docRelPath, currentChapter: CH, workMode: "act" })
          .allowed
      ).toBe(true);
    }
  });
});

describe("WRITABLE_TOP_DIRS 只剩一份", () => {
  it("agent-runtime 转出的那份就是 contracts 那份（引用相等，不是内容相等）", async () => {
    const contracts = await import("@mochen/contracts");
    expect(WRITABLE_TOP_DIRS).toBe(contracts.WRITABLE_TOP_DIRS);
    expect([...WRITABLE_TOP_DIRS]).toEqual([
      "chapters",
      "outline",
      "characters",
      "plot",
      "materials"
    ]);
  });
});

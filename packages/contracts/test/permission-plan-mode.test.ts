import { describe, expect, it } from "vitest";
import {
  PERMISSION_MODES,
  WORK_MODES,
  WORK_MODE_LABELS,
  minimumModeFor,
  workModeOf,
  writeVerdict,
  type BookMeta,
  type WorkMode
} from "../src/index.js";

/**
 * 「先计划后动手」的判定（2026-10-05 批次 4）。
 *
 * 为什么要进 `writeVerdict` 而不是另开一个闸：这份判定已经有**一个**真身，
 * 主进程批准提案、工具宿主放行 write_doc、渲染层提案卡提示「切到哪一档」——
 * 三处都调它（铁律 6）。另开一个闸就等于三处之外又多一个真身，
 * 总有一天它和档位闸各说各话：主进程放行了、卡上还在劝用户切档。
 *
 * 所以它必须是 `writeVerdict` 的一种判决，而不是它的兄弟。
 */
const CH = "chapters/01-开局.md";
const OUT = "book.json";

describe("writeVerdict · 先计划后动手", () => {
  it("计划档下任何档位都不落盘——连「全开」也不行", () => {
    for (const mode of PERMISSION_MODES) {
      expect(
        writeVerdict({ mode, docRelPath: CH, currentChapter: CH, workMode: "plan" }).kind,
        `${mode} 档在计划模式下不该放行`
      ).toBe("plan-mode");
    }
  });

  // 顺序不是随意的：计划档是**更硬**的那道闸。先报它，用户才知道「切档没用」；
  // 反过来先报档位，用户切完档发现还是落不了盘，像坏了。
  it("计划档优先于档位与目录判据（否则用户会白切一次档）", () => {
    expect(
      writeVerdict({ mode: "read-only", docRelPath: CH, currentChapter: null, workMode: "plan" })
        .kind
    ).toBe("plan-mode");
    expect(
      writeVerdict({ mode: "full-access", docRelPath: OUT, currentChapter: null, workMode: "plan" })
        .kind
    ).toBe("plan-mode");
  });

  it("动手档下判决与从前一字不差（五种判决都还在）", () => {
    const seen = new Set<string>();
    for (const mode of PERMISSION_MODES) {
      for (const docRelPath of [CH, OUT, "chapters/02-潮信.md"]) {
        for (const currentChapter of [CH, null]) {
          const v = writeVerdict({ mode, docRelPath, currentChapter, workMode: "act" });
          seen.add(v.kind);
        }
      }
    }
    expect([...seen].sort()).toEqual(
      [
        "allowed",
        "mode-too-tight",
        "no-current-chapter",
        "not-current-chapter",
        "outside-writable"
      ].sort()
    );
  });

  it("穷尽：档位 × 模式 × 目标，每一格都有确定判决，没有 undefined 漏网", () => {
    for (const mode of PERMISSION_MODES) {
      for (const workMode of WORK_MODES) {
        for (const docRelPath of [CH, OUT]) {
          for (const currentChapter of [CH, null]) {
            const kind = writeVerdict({ mode, docRelPath, currentChapter, workMode }).kind;
            expect(
              [
                "allowed",
                "mode-too-tight",
                "no-current-chapter",
                "not-current-chapter",
                "outside-writable",
                "plan-mode"
              ],
              `${mode}/${workMode}/${docRelPath} 判出了 ${kind}`
            ).toContain(kind);
          }
        }
      }
    }
  });
});

describe("workModeOf · 老书照样打得开", () => {
  const meta = (over: Partial<BookMeta> = {}): BookMeta =>
    ({
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: "full-access",
      chapterOrder: [CH],
      ...over
    }) as BookMeta;

  it("没有这一格的老书按「直接动手」——这就是改动前的行为，不该让老书一打开就被锁住", () => {
    expect(workModeOf(meta())).toBe("act");
    expect(workModeOf(meta({ workMode: undefined }))).toBe("act");
  });

  it("写了就认；写了不认识的值宁可回落到动手，也不猜", () => {
    expect(workModeOf(meta({ workMode: "plan" }))).toBe("plan");
    expect(workModeOf(meta({ workMode: "whatever" as WorkMode }))).toBe("act");
  });
});

describe("标签表穷尽（铁律 6）", () => {
  it("WORK_MODE_LABELS 覆盖每一个模式，一个不多一个不少", () => {
    expect(Object.keys(WORK_MODE_LABELS).sort()).toEqual([...WORK_MODES].sort());
  });

  it("两个标签说的是两件不同的事，不能重名", () => {
    expect(new Set(Object.values(WORK_MODE_LABELS)).size).toBe(WORK_MODES.length);
  });
});

describe("minimumModeFor 在计划档下不指路", () => {
  // 它回答的是「切到哪一档之后这条能批」。计划档下切任何一档都不行，
  // 指一个档位过去就是骗人——用户切完发现还是批不了。
  it("它只管档位，不管模式：返回的仍然是「够用的最低档」", () => {
    expect(minimumModeFor(CH, CH)).toBe("chapter-write");
    expect(minimumModeFor("characters/雾.md", CH)).toBe("full-access");
  });
});

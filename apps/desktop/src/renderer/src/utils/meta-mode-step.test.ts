import { describe, expect, it } from "vitest";
import { type BookMeta } from "@mochen/contracts";
import {
  activeProfileStep,
  activeStageStep,
  permissionModeStep,
  workModeStep,
  type MetaStep
} from "./meta-mode-step";

/**
 * book.json 那四枚可写档位（权限档 / 工作模式 / 阶段 / 档案）的**判定层**（2026-10-09 扫描总单 P2 批次）。
 *
 * 住 `.ts` 的理由与 `change-history.ts` 同款：本仓 verify 跑裸 `tsc`，`.vue` 不进类型程序；
 * 而更要紧的是——这四段曾逐条抄过同一件事，抄四份的代价不是难看，是第五份迟早漏掉一条边界
 * （`persistMeta` 那条「先写后回读」的坑在 9625c52 真实发生过）。判定抽成纯函数后，
 * 每条边界各有一处断言，store 那边只管「落盘 → 上屏」。
 *
 * 屏上那些原话由 `useBookStore.test.ts` 逐句钉着（那里跑的是真 store + 真 persistMeta）；
 * 这一份钉的是**哪句话在什么条件下说**，包括那几条容易写反的：
 * 没开书、已经是这一档、老书没有 `workMode` 字段、阶段不在列表里、档案 id 不存在。
 */
const STAGES = [
  { id: "draft", name: "正文" },
  { id: "revise", name: "修订" }
];

function meta(over: Partial<BookMeta> = {}): BookMeta {
  return {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: STAGES,
    activeStage: "draft",
    permissionMode: "read-only",
    chapterOrder: [],
    ...over
  };
}

/** 判定只有两种落点，用例把它们拆开写，免得「忘了判 kind」的用例悄悄通过。 */
function refuse(step: MetaStep): string {
  if (step.kind !== "refuse") throw new Error(`期望 refuse，拿到 ${step.kind}`);
  return step.notice;
}

function persist(step: MetaStep): Extract<MetaStep, { kind: "persist" }> {
  if (step.kind !== "persist") throw new Error(`期望 persist，拿到 ${step.kind}`);
  return step;
}

describe("permissionModeStep", () => {
  it("没开书：这一档是这本书的设置，改不了", () => {
    expect(refuse(permissionModeStep(null, "full-access"))).toBe(
      "还没打开作品目录，权限档改不了。"
    );
  });

  it("已经是这一档：报出档名，不发那次写盘", () => {
    expect(refuse(permissionModeStep(meta(), "read-only"))).toBe("已经是这一档了：「只读参考」。");
  });

  it("要改：patch 只带 permissionMode，成功那句报的是**要切去的那一档**", () => {
    const step = persist(permissionModeStep(meta(), "full-access"));
    expect(step.patch).toEqual({ permissionMode: "full-access" });
    expect(step.failPrefix).toBe("权限档没改过来");
    expect(step.doneNotice).toBe("权限档已切到「全开」，下一次审批就用这一档判断。");
  });
});

describe("workModeStep", () => {
  it("没开书：说得清为什么改不了（它是这本书的设置）", () => {
    expect(refuse(workModeStep(null, "plan"))).toBe(
      "还没打开作品目录，工作模式改不了（它是这本书的设置）。"
    );
  });

  it("老书没有 workMode 字段：缺省读法就是 act，请求 act 不算改动", () => {
    expect(refuse(workModeStep(meta(), "act"))).toBe("已经是这一档了：「直接动手」。");
  });

  it("切到先计划：成功那句要带上「批了也不落盘」这一句实话", () => {
    const step = persist(workModeStep(meta(), "plan"));
    expect(step.patch).toEqual({ workMode: "plan" });
    expect(step.failPrefix).toBe("工作模式没改过来");
    expect(step.doneNotice).toBe("工作模式已切到「先计划」：它只讲打算，提案批了也不落盘。");
  });

  it("从先计划切回直接动手：落盘那句要说「经你批准就会写入磁盘」", () => {
    const step = persist(workModeStep(meta({ workMode: "plan" }), "act"));
    expect(step.doneNotice).toBe("工作模式已切到「直接动手」：提案经你批准就会写入磁盘。");
  });
});

describe("activeStageStep", () => {
  it("没开书", () => {
    expect(refuse(activeStageStep(null, "revise"))).toBe("还没打开作品目录，阶段改不了。");
  });

  it("这一档不在本书的阶段列表里：先在渲染层说明白，省一次注定被主进程拒的写盘", () => {
    expect(refuse(activeStageStep(meta(), "ghost"))).toBe("这一档不在本书的阶段列表里，没去改。");
  });

  it("已经是这个阶段：报的是查表拿到的档名，不是传进来的 id", () => {
    expect(refuse(activeStageStep(meta(), "draft"))).toBe("已经是这个阶段了：「正文」。");
  });

  it("切换：patch 只带 activeStage，成功那句报阶段名", () => {
    const step = persist(activeStageStep(meta(), "revise"));
    expect(step.patch).toEqual({ activeStage: "revise" });
    expect(step.failPrefix).toBe("阶段没改过来");
    expect(step.doneNotice).toBe("阶段已切到「修订」，下一轮对话按这一档装配上下文。");
  });

  it("阶段列表里没有同名档时的兜底说法：列表关已拦下，这里不该走到", () => {
    // 「无」这个兜底字与 `stageLabelOf` 同源；列表校验先行，所以它只在**没有 meta** 时可能出现。
    expect(refuse(activeStageStep(meta({ stages: [] }), "draft"))).toBe(
      "这一档不在本书的阶段列表里，没去改。"
    );
  });
});

describe("activeProfileStep", () => {
  it("没开书", () => {
    expect(refuse(activeProfileStep(null, "reviewer"))).toBe("还没打开作品目录，档案改不了。");
  });

  it("id 不存在：点名是哪一枚，别让人以为切成功了", () => {
    expect(refuse(activeProfileStep(meta(), "no-such-profile"))).toBe(
      "没有这一枚档案：no-such-profile。"
    );
  });

  it("已经是这一枚", () => {
    expect(refuse(activeProfileStep(meta({ activeProfile: "lead-writer" }), "lead-writer"))).toBe(
      "已经是「墨宸 · 主笔」这一枚档案了。"
    );
  });

  it("书里没设过 activeProfile：切到默认档案也算一次真改动（要把这一格写进 book.json）", () => {
    const step = persist(activeProfileStep(meta(), "lead-writer"));
    expect(step.patch).toEqual({ activeProfile: "lead-writer" });
  });

  it("切换：patch 带的是档案自己的 id，成功那句报档案名", () => {
    const step = persist(activeProfileStep(meta({ activeProfile: "lead-writer" }), "reviewer"));
    expect(step.patch).toEqual({ activeProfile: "reviewer" });
    expect(step.failPrefix).toBe("档案没换过来");
    expect(step.doneNotice).toBe("已切到「墨宸 · 审稿」。下一轮对话按它的提示词与上下文包装配。");
  });
});

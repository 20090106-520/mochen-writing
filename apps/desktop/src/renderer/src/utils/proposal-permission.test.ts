import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS, WORK_MODE_LABELS, type PermissionMode } from "@mochen/contracts";
import { permissionHint } from "./proposal-permission";

const CH = "chapters/01-开局.md";
const OTHER = "characters/雾.md";

// 本文件其余用例测的全是「动手档」下的行为（= 改动前的行为），所以底座固定 workMode: "act"。
const base = {
  status: "pending",
  docRelPath: CH,
  currentChapter: CH,
  mode: "read-only" as PermissionMode,
  workMode: "act" as const
};

describe("permissionHint · 什么时候给「切档」入口", () => {
  it("全开档（或任何本来就够的档）⇒ 不给入口：没必要劝用户切档", () => {
    expect(permissionHint({ ...base, mode: "full-access" })).toEqual({ kind: "none" });
    expect(permissionHint({ ...base, docRelPath: CH, mode: "chapter-write" })).toEqual({
      kind: "none"
    });
  });

  it("卡已经不是 pending ⇒ 不给入口（已裁决/已过期的卡不该再劝人动设置）", () => {
    for (const status of ["approved", "rejected", "applied", "expired", "failed"]) {
      expect(permissionHint({ ...base, status }).kind).toBe("none");
    }
  });

  it("只读档 + 目标就是当前章 ⇒ 指向「可改当前章」", () => {
    expect(permissionHint(base)).toEqual({
      kind: "switch",
      mode: "chapter-write",
      label: `切到「${PERMISSION_LABELS["chapter-write"]}」`,
      detail: expect.stringContaining(PERMISSION_LABELS["chapter-write"])
    });
  });

  it("只读档 + 目标不是当前章 ⇒ 指向「全开」（可改当前章根本放行不了它）", () => {
    const hint = permissionHint({ ...base, docRelPath: OTHER });
    expect(hint.kind).toBe("switch");
    expect(hint).toMatchObject({ mode: "full-access" });
  });

  it("可改当前章档但目标不是当前章 ⇒ 同样指向「全开」，与只读档那一格同一条路", () => {
    expect(permissionHint({ ...base, mode: "chapter-write", docRelPath: OTHER })).toMatchObject({
      kind: "switch",
      mode: "full-access"
    });
  });
});

describe("permissionHint · 什么时候不给按钮", () => {
  it("目标不在作品文稿目录内 ⇒ blocked，**不给按钮**（切档解决不了）", () => {
    for (const docRelPath of ["book.json", ".mochen/changes/x.md", "notes/x.md"]) {
      const hint = permissionHint({ ...base, mode: "read-only", docRelPath });
      expect(hint.kind).toBe("blocked");
      expect(hint).not.toHaveProperty("mode");
    }
  });

  it("可改当前章档但没选定当前章 ⇒ blocked，同样不给按钮", () => {
    expect(permissionHint({ ...base, mode: "chapter-write", currentChapter: null })).toMatchObject({
      kind: "blocked"
    });
  });
});

describe("按钮指向的那一档，主进程一定认", () => {
  it("凡是给出 switch 的，切过去之后同样的输入在主进程判定里是 allowed", async () => {
    // 这条是本文件存在的全部理由：卡上说的「切到 X 就能批」必须为真。
    // 两边共用 contracts 的 writeVerdict，所以这里跑的是同一个函数；
    // 若将来有人把它拆成两份实现，本条会先红。
    const { writeVerdict } = await import("@mochen/contracts");
    for (const mode of ["read-only", "chapter-write", "full-access"] as PermissionMode[]) {
      for (const docRelPath of [CH, OTHER, "book.json"]) {
        const hint = permissionHint({ ...base, mode, docRelPath });
        if (hint.kind !== "switch") continue;
        expect(
          writeVerdict({ mode: hint.mode, docRelPath, currentChapter: CH, workMode: "act" }).kind
        ).toBe("allowed");
      }
    }
  });
});

describe("先计划后动手（2026-10-05 批次 4）", () => {
  it("计划档下指向工作模式，不指向任何档位", () => {
    const hint = permissionHint({ ...base, workMode: "plan" });
    expect(hint.kind).toBe("switch-work-mode");
    expect(hint).toMatchObject({ label: `切到「${WORK_MODE_LABELS.act}」` });
  });

  // 计划档是更硬的那道闸：连全开档也不落盘，所以卡上**不能**说「切到全开就能批」——
  // 用户切完发现还是批不了，像坏了。
  it("计划档优先于档位（连全开档也不给切档入口）", () => {
    for (const mode of ["read-only", "chapter-write", "full-access"] as PermissionMode[]) {
      expect(permissionHint({ ...base, mode, workMode: "plan" }).kind, mode).toBe(
        "switch-work-mode"
      );
    }
  });

  it("切到动手档之后，同一条提案在主进程判定里真的能批", async () => {
    const { writeVerdict } = await import("@mochen/contracts");
    for (const mode of ["read-only", "chapter-write", "full-access"] as PermissionMode[]) {
      const hint = permissionHint({ ...base, mode, workMode: "plan" });
      expect(hint.kind).toBe("switch-work-mode");
      // 卡上那句话在这里必须为真（同一条输入、主进程那一份判定）
      expect(
        writeVerdict({ mode: "full-access", docRelPath: CH, currentChapter: CH, workMode: "act" })
          .kind
      ).toBe("allowed");
    }
  });

  it("已裁决的卡不劝人切模式（同「已裁决的卡不劝人切档」）", () => {
    expect(permissionHint({ ...base, workMode: "plan", status: "approved" }).kind).toBe("none");
  });
});

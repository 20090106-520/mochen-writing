import { describe, expect, it } from "vitest";
import {
  WRITABLE_TOP_DIRS,
  checkWritePermission,
  type WritePermissionInput
} from "../src/permission.js";

/**
 * 本文件测的全是**档位**行为，也就是「动手档」下的行为。
 * 把 workMode 固定在这一层，免得每条断言都写一遍 workMode: "act" 把真正的断言淹掉。
 */
const act = (
  input: Omit<WritePermissionInput, "workMode">
): ReturnType<typeof checkWritePermission> => checkWritePermission({ ...input, workMode: "act" });

describe("checkWritePermission", () => {
  it("五目录之外的路径在任何档位都拒绝（book.json 与 .mochen 是天花板）", () => {
    for (const mode of ["read-only", "chapter-write", "full-access"] as const) {
      expect(act({ mode, docRelPath: "book.json", currentChapter: "chapters/01.md" }).allowed).toBe(
        false
      );
      expect(
        act({
          mode,
          docRelPath: ".mochen/sessions/a.jsonl",
          currentChapter: "chapters/01.md"
        }).allowed
      ).toBe(false);
      expect(
        act({ mode, docRelPath: "notes/x.md", currentChapter: "chapters/01.md" }).allowed
      ).toBe(false);
    }
    expect([...WRITABLE_TOP_DIRS]).toEqual([
      "chapters",
      "outline",
      "characters",
      "plot",
      "materials"
    ]);
  });

  it("只读参考档一律拒绝，且说明里点名当前档位", () => {
    const out = act({
      mode: "read-only",
      docRelPath: "chapters/01.md",
      currentChapter: "chapters/01.md"
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain("只读参考");
    // F-2：拒绝文案不许指向界面上不存在的入口——左栏权限档切换器属 Plan 3，
    // 当前版本根本没有，让用户去「左栏」切换等于让他做一件做不到的事。
    expect(out.reason).not.toContain("左栏");
    // P2-2：定稿指引句整句钉死（toBe 而非 toContain）——评审 M11 证明「只留 toContain(只读参考) +
    // not.toContain(左栏)」时，把第二句「可以先给出提案…把权限档切到…后再批准」整句删掉全量门禁照绿。
    // 2026-10-05：指引句从「切到「可改当前章」或「全开」」收窄成**只点名够用的那一档**。
    // 改动的原因不是措辞偏好：旧句对 `characters/雾.md` 这类目标也是这么说的，
    // 而「可改当前章」根本放行不了它——用户照着切了还是被拒。现在这一句与提案卡上
    // 那颗按钮要切过去的档严格同一份（contracts 的 minimumModeFor），文案与按钮不许各说各的。
    expect(out.reason).toBe(
      "当前权限档为「只读参考」，提案不会写入磁盘。" +
        "可以先给出提案与理由；确实要落盘时，把权限档切到「可改当前章」后再批准。"
    );
    // 目标不是当前章时，指的那一档必须是「全开」——这一格就是上面那段收窄的判据。
    expect(
      act({
        mode: "read-only",
        docRelPath: "characters/雾.md",
        currentChapter: "chapters/01.md"
      }).reason
    ).toBe(
      "当前权限档为「只读参考」，提案不会写入磁盘。" +
        "可以先给出提案与理由；确实要落盘时，把权限档切到「全开」后再批准。"
    );
  });

  it("可改当前章只放行当前章", () => {
    expect(
      act({
        mode: "chapter-write",
        docRelPath: "chapters/02.md",
        currentChapter: "chapters/01.md"
      }).allowed
    ).toBe(false);
    expect(
      act({
        mode: "chapter-write",
        docRelPath: "chapters/01.md",
        currentChapter: "chapters/01.md"
      }).allowed
    ).toBe(true);
  });

  it("没选定当前章时 chapter-write 一律拒绝（无锚可写）", () => {
    const out = act({
      mode: "chapter-write",
      docRelPath: "chapters/01.md",
      currentChapter: null
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain("尚未选定");
  });

  it("全开放行五个目录内的文稿", () => {
    expect(
      act({
        mode: "full-access",
        docRelPath: "characters/李深.md",
        currentChapter: null
      }).allowed
    ).toBe(true);
  });
});

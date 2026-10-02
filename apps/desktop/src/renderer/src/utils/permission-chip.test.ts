import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS } from "@mochen/contracts";
import { NO_BOOK_CHIP_LABEL, permissionChipView } from "./permission-chip";

describe("permissionChipView（无书时档位那一格说实话，缺陷②）", () => {
  it("无书但传了真实档位：文案仍是「未打开作品目录」且 disabled，绝不报任何档位名", () => {
    const view = permissionChipView({ hasBook: false, mode: "read-only", saving: false });
    expect(view.text).toBe(NO_BOOK_CHIP_LABEL);
    expect(view.disabled).toBe(true);
    // 鉴别力：文案不得等于三档里任何一个（波 1 报告捏造的正是「只读参考」这一档名）。
    expect(Object.values(PERMISSION_LABELS)).not.toContain(view.text);
  });

  it("无书且 mode 为 null（波 1 报告实读 chipText=只读参考 / chipDisabled=false 的原始形状）：同样不报档位名、同样 disabled", () => {
    const view = permissionChipView({ hasBook: false, mode: null, saving: false });
    expect(view.text).toBe(NO_BOOK_CHIP_LABEL);
    expect(view.disabled).toBe(true);
  });

  it("有书且非保存态：文案是真实档位名、可点（disabled=false）", () => {
    const view = permissionChipView({ hasBook: true, mode: "chapter-write", saving: false });
    expect(view.text).toBe(PERMISSION_LABELS["chapter-write"]);
    expect(view.disabled).toBe(false);
    expect(view.title).toContain(PERMISSION_LABELS["chapter-write"]);
  });

  it("有书但正在保存：文案仍是真实档位名，只是 disabled=true", () => {
    const view = permissionChipView({ hasBook: true, mode: "full-access", saving: true });
    expect(view.text).toBe(PERMISSION_LABELS["full-access"]);
    expect(view.disabled).toBe(true);
  });
});

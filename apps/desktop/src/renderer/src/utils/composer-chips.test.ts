import { describe, expect, it } from "vitest";
import { permissionChipView } from "./permission-chip";
import { composerChips } from "./composer-chips";

describe("composer-chips · 只放真开关，排队不做按钮（F-D）", () => {
  it("恰好两枚 chip，id 逐字 permission/palette（第三枚排队按钮不许长出来）", () => {
    expect(
      composerChips({ hasBook: true, mode: "read-only", saving: false }).map((c) => c.id)
    ).toEqual(["permission", "palette"]);
    // T9-1 反向钉：palette chip 的 title 不得再宣传不存在的 Ctrl+K 键位
    // （实测 utils/hotkeys.ts:78-96 的全局 Ctrl 族没有 k，面板真身是 :98-100 的裸 / 键）。
    const palette = composerChips({ hasBook: true, mode: "read-only", saving: false }).find(
      (item) => item.id === "palette"
    );
    expect(palette?.title).not.toContain("Ctrl");
  });

  it("联动用例：permission chip 与 permissionChipView 逐字段同值（防两份判定漂移）", () => {
    const inputs = [
      { hasBook: true, mode: "chapter-write" as const, saving: false },
      { hasBook: true, mode: "full-access" as const, saving: true },
      { hasBook: false, mode: null, saving: false }
    ];
    for (const input of inputs) {
      const view = permissionChipView(input);
      const chip = composerChips(input).find((item) => item.id === "permission");
      expect(chip).toEqual({
        id: "permission",
        text: view.text,
        disabled: view.disabled,
        title: view.title
      });
    }
  });

  it("无书 ⇒ permission chip disabled 且文案不是任何档位名（透传 permissionChipView 的诚实）", () => {
    const chip = composerChips({ hasBook: false, mode: null, saving: false }).find(
      (item) => item.id === "permission"
    );
    expect(chip?.disabled).toBe(true);
    expect(chip?.text).toBe("未打开作品目录");
    expect(chip?.text).not.toBe("只读参考"); // 波 1 缺陷②「捏造档位名」的反向钉
  });

  it("排队数字不在 chip 行出现（裁定 C：唯一真身是 composeStatusLine，不留第二份「数字→文案」）", () => {
    const chips = composerChips({ hasBook: true, mode: "read-only", saving: false });
    expect(chips.every((chip) => !chip.text.includes("排队"))).toBe(true);
    expect(Object.keys(chips[0] ?? {}).sort()).toEqual(["disabled", "id", "text", "title"]);
  });
});

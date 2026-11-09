import { describe, expect, it } from "vitest";
import { openChapter, saveMeta, setupAgentFixture } from "./agent-store-fixture";
import { useBookStore } from "./useBookStore";

/**
 * 技能书级策略的**写入口**（P0-4）。
 *
 * 判定（两个清单互斥、停用不挂回默认）在 `@mochen/contracts` 的纯函数里；
 * 这里钉的是「动作真的走 `persistMeta` 那条 IPC，并且落回 meta」——
 * 只改界面状态不回写的假动作，用户重启后就发现设置变了。
 */
setupAgentFixture();

describe("书级技能策略的写入口（P0-4）", () => {
  it("老书第一次写：没有策略也能补成完整形状，再走既有 saveMeta 通路", async () => {
    await openChapter();
    const book = useBookStore();
    expect(book.meta?.skillPolicy).toBeUndefined();
    saveMeta.mockClear();

    await book.setSkillDefault("global:rhythm", true);

    expect(saveMeta).toHaveBeenCalledTimes(1);
    const written = saveMeta.mock.calls[0]?.[0];
    expect(written?.skillPolicy).toEqual({ enabled: ["global:rhythm"], disabled: [] });
    // 本地镜像同步换新：界面读的就是它。
    expect(book.meta?.skillPolicy).toEqual({ enabled: ["global:rhythm"], disabled: [] });
  });

  it("设为默认与停用互斥：先停用再设默认，两个清单不会同时留着它", async () => {
    await openChapter();
    const book = useBookStore();
    book.meta!.skillPolicy = { enabled: [], disabled: ["global:rhythm"] };

    await book.setSkillDefault("global:rhythm", true);

    expect(book.meta?.skillPolicy).toEqual({ enabled: ["global:rhythm"], disabled: [] });
  });

  it("停用会从默认清单摘掉；重新启用不自动挂回默认", async () => {
    await openChapter();
    const book = useBookStore();
    book.meta!.skillPolicy = { enabled: ["global:rhythm"], disabled: [] };

    await book.setSkillDisabled("global:rhythm", true);
    expect(book.meta?.skillPolicy).toEqual({ enabled: [], disabled: ["global:rhythm"] });

    await book.setSkillDisabled("global:rhythm", false);
    expect(book.meta?.skillPolicy).toEqual({ enabled: [], disabled: [] });
  });
});

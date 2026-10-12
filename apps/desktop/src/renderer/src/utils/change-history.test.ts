import { describe, expect, it } from "vitest";
import type { ChangeDiffResult, ChangeEntry, DocWriteResult } from "@mochen/contracts";
import {
  CHANGE_HISTORY_VISIBLE,
  changeCountLabel,
  changeDiffCaption,
  changeHeadline,
  changeListView,
  changeTimeLabel,
  formatBytes,
  readChangePeek,
  restoreBackupToDoc,
  type ChangePeekIo,
  type ChangeRestoreIo
} from "./change-history";

function entry(overrides: Partial<ChangeEntry> = {}): ChangeEntry {
  return {
    stamp: "2026-10-05T12-34-31-168Z",
    docRelPath: "chapters/01-开局.md",
    backupRelPath: ".mochen/changes/2026-10-05T12-34-31-168Z/chapters/01-开局.md.bak",
    bytes: 2048,
    ...overrides
  };
}

describe("changeTimeLabel", () => {
  it("把定长时间戳翻成人看得懂的时分秒", () => {
    expect(changeTimeLabel("2026-10-05T12-34-31-168Z")).toBe("10-05 12:34:31");
    expect(changeTimeLabel("2026-01-09T00-05-00-007Z")).toBe("01-09 00:05:00");
  });

  it("形状不对就原样还回去：不替它编一个时间（编出来的比空更坏）", () => {
    for (const bad of ["", "昨天", "2026-10-05", "2026-10-05T12:34:31Z", "x-10-05T12-34-31-168Z"]) {
      expect(changeTimeLabel(bad)).toBe(bad);
    }
  });
});

describe("formatBytes", () => {
  it("三档：字节 / KB / MB", () => {
    expect(formatBytes(512)).toBe("512 字节");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("空与非法值说人话，不返回 NaN", () => {
    expect(formatBytes(0)).toBe("空文件");
    expect(formatBytes(-1)).toBe("空文件");
    expect(formatBytes(Number.NaN)).toBe("空文件");
  });
});

describe("changeHeadline", () => {
  it("文稿 + 时间 + 体积，一句话说清这条是什么", () => {
    expect(changeHeadline(entry())).toBe(
      "chapters/01-开局.md · 10-05 12:34:31 的改前版本（2.0 KB）"
    );
  });

  it("换一条就换掉那一句（不是固定文案）", () => {
    const other = changeHeadline(entry({ docRelPath: "chapters/02-潮信.md", bytes: 100 }));
    expect(other).toContain("chapters/02-潮信.md");
    expect(other).toContain("100 字节");
  });
});

describe("changeCountLabel", () => {
  // 头部那个计数不是装饰：列表是滚动区，滚出视野的几条全靠它告诉用户「一共这么多」。
  it("1 条 / 多条 / 0 条各有说法，不出现「1 次改动」这种别扭单数", () => {
    expect(changeCountLabel(0)).toBe("还没有记录");
    expect(changeCountLabel(1)).toBe("1 次改动");
    expect(changeCountLabel(5)).toBe("5 次改动");
    expect(changeCountLabel(120)).toBe("120 次改动");
  });

  it("负数与小数不摆出「-3 次改动」这种鬼话", () => {
    expect(changeCountLabel(-3)).toBe("还没有记录");
    expect(changeCountLabel(2.4)).toBe("2 次改动");
  });
});

/** 造 n 条：序号直接编进 docRelPath，好断言顺序没被重排。 */
function manyEntries(n: number): ChangeEntry[] {
  return Array.from({ length: n }, (_, i) =>
    entry({ docRelPath: `chapters/${String(i).padStart(3, "0")}.md` })
  );
}

describe("changeListView · 显示上限（不删盘上的备份）", () => {
  it("空的与不满上限的：全列，不出折叠说明", () => {
    for (const n of [0, 1, 17, CHANGE_HISTORY_VISIBLE]) {
      const v = changeListView(manyEntries(n));
      expect(v.rows).toHaveLength(n);
      expect(v.total).toBe(n);
      expect(v.hidden).toBe(0);
      expect(v.notice, `${n} 条不该出折叠说明`).toBeNull();
    }
  });

  it("超上限：只列最近的那些，折叠数算得准", () => {
    const v = changeListView(manyEntries(CHANGE_HISTORY_VISIBLE + 15));
    expect(v.rows).toHaveLength(CHANGE_HISTORY_VISIBLE);
    expect(v.total).toBe(CHANGE_HISTORY_VISIBLE + 15);
    expect(v.hidden).toBe(15);
    expect(v.notice).toContain("15");
  });

  it("total 报的是总数——头部计数靠它，说成 rows.length 就是在数字上撒谎", () => {
    const v = changeListView(manyEntries(200));
    expect(v.total).toBe(200);
    expect(v.rows).toHaveLength(CHANGE_HISTORY_VISIBLE);
    expect(changeCountLabel(v.total)).toBe("200 次改动");
  });

  it("截的是列不是序：最新那批一条不少、一条不乱", () => {
    const list = manyEntries(80);
    const v = changeListView(list);
    expect(v.rows.map((e) => e.docRelPath)).toEqual(
      list.slice(0, CHANGE_HISTORY_VISIBLE).map((e) => e.docRelPath)
    );
  });

  // 这条是这个功能最容易出的错：折叠说明一旦写成「已清理」，用户就以为老备份没了，
  // 哪天真要回滚到半年前那版时才发现，才是真的回不去。
  it("折叠说明不许承诺任何删除：只说「没删」和「还在哪儿」", () => {
    const v = changeListView(manyEntries(200));
    expect(v.notice).toContain("没删");
    expect(v.notice).toContain(".mochen/changes");
    expect(v.notice).not.toMatch(/已删|已清理|已丢弃|已移除|永久/);
  });

  it("返回的 rows 是副本：改它不改原表（store 里的 changeList 还要继续用）", () => {
    const list = manyEntries(3);
    const v = changeListView(list);
    v.rows.length = 0;
    expect(list).toHaveLength(3);
  });

  it("非数组输入说人话，不炸", () => {
    const v = changeListView(undefined as unknown as ChangeEntry[]);
    expect(v.total).toBe(0);
    expect(v.rows).toEqual([]);
  });
});

/**
 * 逐行对比这一档（2026-10-13）。
 *
 * 面板原先只把「改前的整篇」甩出来，用户看不出这次到底动了哪几行，
 * 于是这两个纯函数承担全部可判定的部分：**三档话说清楚**（没算出来 / 一个字都没差 / 有差别），
 * 以及把两份 IO 调用（读备份、主进程算 diff）编排成「一扇坏了不许把另一扇也带走」。
 */
const DIFF_TEXT = [
  "--- a/chapters/01-开局.md",
  "+++ b/chapters/01-开局.md",
  "@@ -1,3 +1,3 @@",
  " 第一章",
  "-雾从海面涌上来。",
  "+海雾涌上来，铁锈味很冲。",
  "+窗外传来敲铁的声音。"
].join("\n");

describe("changeDiffCaption", () => {
  it("没算出来（null）时不摆话：那一句由 notice 说，这里再说是第二份", () => {
    expect(changeDiffCaption(null)).toBeNull();
  });

  it("空串是**成功**：说「一个字都没差」，不许混进「没算出来」那种失败话", () => {
    const text = changeDiffCaption("");
    expect(text).toContain("一个字都没差");
    expect(text).not.toMatch(/没算出来|读不出|失败/);
  });

  it("有差别时报的是数出来的行数，并把 ± 的方向说死（改前 → 现在）", () => {
    const text = changeDiffCaption(DIFF_TEXT);
    expect(text).toContain("新增 2 行");
    expect(text).toContain("删除 1 行");
    expect(text).toContain("改前");
    expect(text).toContain("盘上此刻");
  });

  // 反向用例：文件头 `+++` / `---` 各一行，若被数进去就是 3 与 2。
  // 这一条同时钉住「计数与渲染共用一份分类」（diff-lines.ts）。
  it("行数只数改动行：文件头那两行一次都不算", () => {
    expect(changeDiffCaption(DIFF_TEXT)).not.toContain("3 行");
  });
});

describe("readChangePeek", () => {
  /** 两扇 IO 缝：读备份、让主进程算对比。哪一扇坏、坏成什么形状，都由用例点名。 */
  function peekIo(input: {
    content?: string;
    readFails?: boolean;
    diff?: ChangeDiffResult;
    diffFails?: boolean;
  }) {
    const calls: string[] = [];
    const io: ChangePeekIo = {
      readChange: async () => {
        calls.push("readChange");
        if (input.readFails) throw new Error("ENOENT: 备份不在了");
        return { content: input.content ?? "改前的正文\n", fingerprint: "fp-bak" };
      },
      diffChange: async () => {
        calls.push("diffChange");
        if (input.diffFails) throw new Error("EPERM: 盘不让读");
        return input.diff ?? { ok: true, diff: DIFF_TEXT };
      }
    };
    return { calls, io };
  }

  it("两扇都好：改前正文与逐行对比一起交回去，且不说任何失败话", async () => {
    const { io } = peekIo({});
    const result = await readChangePeek(io, entry());
    expect(result.preview).toEqual({ content: "改前的正文\n", diff: DIFF_TEXT });
    expect(result.notice).toBeNull();
  });

  it("备份本身读不出来：正文没得看，第二扇 IPC 一次都不许多发", async () => {
    const { io, calls } = peekIo({ readFails: true });
    const result = await readChangePeek(io, entry());
    expect(result.preview).toBeNull();
    expect(result.notice).toContain("这条备份读不出来");
    expect(calls).toEqual(["readChange"]);
  });

  it("对比失败不许把正文一起带走：diff 是 null（不是空串），notice 点名主进程那句话", async () => {
    const { io } = peekIo({ diff: { ok: false, message: "这一篇在书外面，读不到" } });
    const result = await readChangePeek(io, entry());
    expect(result.preview).toEqual({ content: "改前的正文\n", diff: null });
    expect(result.notice).toContain("逐行对比没算出来");
    expect(result.notice).toContain("这一篇在书外面，读不到");
  });

  it("对比那一扇抛了也只当「没算出来」：异常不许冒到 store 外面把在途标记卡住", async () => {
    const { io } = peekIo({ diffFails: true });
    const result = await readChangePeek(io, entry());
    expect(result.preview?.diff).toBeNull();
    expect(result.notice).toContain("逐行对比没算出来");
  });

  it("两边逐行相同回的是成功加空串，不报失败", async () => {
    const { io } = peekIo({ diff: { ok: true, diff: "" } });
    const result = await readChangePeek(io, entry());
    expect(result.preview).toEqual({ content: "改前的正文\n", diff: "" });
    expect(result.notice).toBeNull();
  });
});

describe("restoreBackupToDoc", () => {
  /** 回滚用的两扇 IO 缝：现读盘上此刻那一篇（拿指纹）、把备份落回去。返回值形状由用例点名。 */
  function restoreIo(input: {
    fingerprint?: string;
    result?: DocWriteResult;
    restoreFails?: boolean;
  }) {
    const seen: Array<string | [string, string]> = [];
    const io: ChangeRestoreIo = {
      readDoc: async (relPath) => {
        seen.push(relPath);
        return { fingerprint: input.fingerprint ?? "fp-now" };
      },
      restoreChange: async (backupRelPath, expectedFingerprint) => {
        seen.push([backupRelPath, expectedFingerprint]);
        if (input.restoreFails) throw new Error("EACCES: 盘不让写");
        return (
          input.result ?? {
            ok: true as const,
            fingerprint: "fp-after",
            backupRelPath: entry().backupRelPath
          }
        );
      }
    };
    return { seen, io };
  }

  it("没打开那一篇正文：两扇 IO 一次都不发，话说清楚为什么不动", async () => {
    const { io, seen } = restoreIo({});
    const result = await restoreBackupToDoc(io, entry(), null);
    expect(seen).toEqual([]);
    expect(result.refresh).toBe(false);
    expect(result.notice).toContain("先打开那一篇正文");
  });

  it("成功：指纹用的是**现读**那一篇的值（不是入参里带的旧的），refresh 才为真", async () => {
    const { io, seen } = restoreIo({ fingerprint: "fp-just-read" });
    const result = await restoreBackupToDoc(io, entry(), entry().docRelPath);
    expect(seen).toEqual([entry().docRelPath, [entry().backupRelPath, "fp-just-read"]]);
    expect(result.refresh).toBe(true);
    expect(result.notice).toContain("已回滚");
    expect(result.notice).toContain(entry().docRelPath);
  });

  it("被闸拒绝（stale）：refresh 为假——盘上什么都没变，不该重拉列表骗用户", async () => {
    const { io } = restoreIo({
      result: { ok: false, reason: "stale", currentFingerprint: "fp-other" }
    });
    const result = await restoreBackupToDoc(io, entry(), entry().docRelPath);
    expect(result.refresh).toBe(false);
    expect(result.notice).toContain("又被改过了");
  });

  it("拒绝但主进程没带 message（IPC 返回侧没有守卫，形状不保证）：兜底那句得上屏，不许是空白", async () => {
    const { io } = restoreIo({
      result: { ok: false, reason: "io-error" } as unknown as DocWriteResult
    });
    const result = await restoreBackupToDoc(io, entry(), entry().docRelPath);
    expect(result.notice).toBe("没能回滚。");
  });

  it("IO 直接抛了也不许冒出去：调用方的在途标记会卡在 true，面板从此点点不动", async () => {
    const { io } = restoreIo({ restoreFails: true });
    const result = await restoreBackupToDoc(io, entry(), entry().docRelPath);
    expect(result.refresh).toBe(false);
    expect(result.notice).toContain("没能回滚：");
    expect(result.notice).toContain("EACCES");
  });
});

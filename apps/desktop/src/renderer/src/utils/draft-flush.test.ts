import { describe, expect, it, vi } from "vitest";
import type { DocWriteResult } from "@mochen/contracts";
import {
  docStateOf,
  EMPTY_DOC,
  flushAllBeforeQuit,
  flushDocBeforeDrop,
  flushIOFor,
  hasPendingDraft,
  saveOutcomeOf,
  type DocState,
  type FlushIO
} from "./draft-flush";
/**
 * 「丢弃一篇之前先把它的字落盘」这一条判定（2026-10-09 全仓扫描 P0-3 / P0-2 / P0-6 的公共真身）。
 *
 * 丢字的三条路——关标签、切到别的产品面板、退出应用——以前各自都不查 `dirty`，
 * 于是同一句「这篇还有没落盘的字」被写了零遍。这里只留一份判定，三处都调它。
 *
 * 用例打在**纯函数**上：`FlushIO` 是注入点，所以「写盘失败」「IPC 抛错」「冲突未处理」
 * 这三种盘上复现不了的情况，都能在这里逐条钉死（store 那一层另有接线用例）。
 */

const A = "chapters/01-a.md";
const B = "chapters/02-b.md";

function dirtyState(draft: string): DocState {
  return { ...EMPTY_DOC, draft, savedFingerprint: "fp-a", dirty: true };
}

/** 一套可编程的注入：盘上结果 / 抛错 / 存档表都由用例自己摆。 */
function makeIO(
  states: Record<string, DocState>,
  write: (relPath: string, content: string, fp: string) => Promise<DocWriteResult>
): FlushIO & { cleaned: { relPath: string; fingerprint: string }[] } {
  const cleaned: { relPath: string; fingerprint: string }[] = [];
  return {
    cleaned,
    stateOf: (relPath) => states[relPath] ?? null,
    write: (relPath, content, fp) => write(relPath, content, fp),
    markClean: (relPath, fingerprint) => {
      cleaned.push({ relPath, fingerprint });
      const state = states[relPath];
      if (state) states[relPath] = { ...state, dirty: false, savedFingerprint: fingerprint };
    }
  };
}

// 写成结果给的是**普通异步函数**，不是 vi.fn：`vi.fn(一个 mock)` 会让每个用例的 mock 共用同一份调用史，
// 「不发写盘」这类断言会因此假红（本轮实测踩过一次）。
const wrote = async (): Promise<DocWriteResult> => ({
  ok: true,
  fingerprint: "fp-next",
  backupRelPath: null
});

/**
 * 带参数表的 spy。**不能写 `vi.fn(wrote)`**：那会照 `wrote` 的零参数把 `mock.calls` 推成 `[]`，
 * 于是 `c[0]`（取这次写的是哪一篇）在 tsc 那里是「元组里没有下标 0」——vitest 跑的是编译后的 JS，
 * 一路绿，只有 typecheck 关卡抓得到（本轮实测）。
 */
const spyWrote = () =>
  vi.fn<(relPath: string, content: string, fp: string) => Promise<DocWriteResult>>(wrote);

describe("flushDocBeforeDrop", () => {
  it("没有存档（这一篇压根没在渲染层待过）＝可安全丢弃，一个 IPC 都不发", async () => {
    const write = spyWrote();
    const io = makeIO({}, write);
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome).toEqual({ ok: true, flushed: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("干净的稿子＝可安全丢弃，不发写盘（关标签不该为没改过的字多跑一次盘）", async () => {
    const write = spyWrote();
    const io = makeIO({ [A]: { ...EMPTY_DOC, draft: "正文\n", savedFingerprint: "fp-a" } }, write);
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome).toEqual({ ok: true, flushed: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("脏稿先落盘：写的正是这一篇的稿子与指纹，成功后才判可丢弃并标干净", async () => {
    const write = spyWrote();
    const io = makeIO({ [A]: dirtyState("刚写的几百字\n") }, write);
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome).toEqual({ ok: true, flushed: true });
    expect(write.mock.calls[0]).toEqual([A, "刚写的几百字\n", "fp-a"]);
    expect(io.cleaned).toEqual([{ relPath: A, fingerprint: "fp-next" }]);
  });

  it("写盘被主进程拦下（io-error）＝判不可丢弃，理由带上失败原因，且绝不标干净", async () => {
    const io = makeIO({ [A]: dirtyState("刚写的几百字\n") }, async () => ({
      ok: false,
      reason: "io-error",
      message: "写 01-a.md 失败（EPERM），旧稿保持原样。"
    }));
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("写失败绝不能判成可丢弃");
    expect(outcome.message).toContain("EPERM");
    // 这条是「关标签」那条路的根：标了干净，稿子就没了，而盘上其实没写进去。
    expect(io.cleaned).toEqual([]);
    expect(io.stateOf(A)?.dirty).toBe(true);
  });

  it("写盘撞上外部改动（stale，这条返回里没有 message）＝理由说清「外部刚改过」，不许出现 undefined", async () => {
    const io = makeIO({ [A]: dirtyState("刚写的几百字\n") }, async () => ({
      ok: false,
      reason: "stale",
      currentFingerprint: "fp-external"
    }));
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("盘上已被别处改动，绝不能判成可丢弃");
    // stale 那一支的返回里**没有** message 字段：照抄 io-error 的拼法就得到「没能落盘：undefined」。
    expect(outcome.message).not.toContain("undefined");
    expect(outcome.message).toContain("外部");
    expect(outcome.reason).toBe("conflict");
    expect(io.cleaned).toEqual([]);
  });

  it("IPC 直接抛错（主进程 IO 一路上抛）＝同样判不可丢弃，理由是人话而不是 undefined", async () => {
    const io = makeIO({ [A]: dirtyState("刚写的几百字\n") }, async () => {
      throw new Error("EPERM: resource busy, rename");
    });
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("IPC 抛错绝不能判成可丢弃");
    expect(outcome.message).toContain("EPERM: resource busy, rename");
    expect(io.cleaned).toEqual([]);
  });

  it("抛的不是 Error（字符串、undefined 也照样落进理由）＝不许出现「保存失败：undefined」", async () => {
    const io = makeIO({ [A]: dirtyState("字\n") }, async () => {
      throw "磁盘忙";
    });
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("抛字符串也不能判成可丢弃");
    expect(outcome.message).toContain("磁盘忙");
    expect(outcome.message).not.toContain("undefined");
  });

  it("指纹冲突未处理＝不发写盘：绝不替用户覆盖外部改动，只说明白要先处理冲突", async () => {
    const write = spyWrote();
    const io = makeIO(
      { [A]: { ...dirtyState("字\n"), conflict: { currentFingerprint: "fp-x" } } },
      write
    );
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("冲突没处理完就判可丢弃，等于静默盖掉外部改动");
    expect(write).not.toHaveBeenCalled();
    expect(outcome.message).toContain("冲突");
  });

  it("冲突但字没改过＝照样拦：这时盘上内容跟内存不是一回事，丢弃就是把新改动读没了", async () => {
    const write = spyWrote();
    const io = makeIO({ [A]: { ...EMPTY_DOC, conflict: { currentFingerprint: "fp-x" } } }, write);
    const outcome = await flushDocBeforeDrop(io, A);
    expect(outcome.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("flushAllBeforeQuit", () => {
  it("三篇里两脏一净：只写那两篇脏的，全成就判 ok", async () => {
    const write = spyWrote();
    const io = makeIO(
      { [A]: dirtyState("甲\n"), [B]: dirtyState("乙\n"), "chapters/03-c.md": { ...EMPTY_DOC } },
      write
    );
    const result = await flushAllBeforeQuit(io, [A, B, "chapters/03-c.md"]);
    expect(result.ok).toBe(true);
    expect(write.mock.calls.map((c) => c[0])).toEqual([A, B]);
  });

  it("其中一篇落盘失败：其余的照旧救回来，结果里点名是哪一篇、为什么", async () => {
    const io = makeIO(
      { [A]: dirtyState("甲\n"), [B]: dirtyState("乙\n") },
      async (relPath): Promise<DocWriteResult> =>
        relPath === A
          ? { ok: false, reason: "io-error", message: "写 01-a.md 失败（ENOSPC）" }
          : { ok: true, fingerprint: "fp-next", backupRelPath: null }
    );
    const result = await flushAllBeforeQuit(io, [A, B]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("有一篇没落盘却判成全胜，退出就会把它丢掉");
    expect(result.blocked.map((one) => one.relPath)).toEqual([A]);
    expect(result.blocked[0]?.message).toContain("ENOSPC");
    // B 不许被 A 的失败带走：一篇坏了不等于其余的都不用救。
    expect(io.stateOf(B)?.dirty).toBe(false);
  });

  it("没有一篇是脏的：一次写盘都不发，直接放行退出", async () => {
    const write = spyWrote();
    const io = makeIO({ [A]: { ...EMPTY_DOC } }, write);
    const result = await flushAllBeforeQuit(io, [A]);
    expect(result.ok).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
});

/**
 * `saveActive` 拿到写盘结果之后**该怎么摆状态**（P0-2 的后半段）。
 *
 * 这段判定原先长在 store 里，与 pinia 的赋值缠在一起：`dirty` 什么时候能清、指纹什么时候能推进、
 * 哪一句该上屏——每条都要靠起 store 才能验。抽成纯函数后，「保存发出后、await 回来前用户又打了字」
 * 这条竞态在这里就能一对一钉死，store 那边只剩接线。
 */
describe("saveOutcomeOf", () => {
  const ok = (backupRelPath: string | null = null): DocWriteResult => ({
    ok: true,
    fingerprint: "fp-next",
    backupRelPath
  });

  it("写成了：指纹推进、dirty 落回 false、冲突清空，自动语境说「已自动保存」", () => {
    const outcome = saveOutcomeOf({
      result: ok(),
      submitted: "同一份稿子\n",
      liveDraft: "同一份稿子\n",
      auto: true
    });
    expect(outcome.patch).toEqual({ savedFingerprint: "fp-next", dirty: false, conflict: null });
    expect(outcome.notice).toBe("已自动保存");
    expect(outcome.reschedule).toBe(false);
  });

  it("手动保存且原稿有备份／没备份：两句屏显要分得开，用户据此知道旧稿还在不在", () => {
    expect(
      saveOutcomeOf({ result: ok("backup/01.md"), submitted: "a", liveDraft: "a", auto: false })
        .notice
    ).toBe("已保存，原稿已备份");
    expect(
      saveOutcomeOf({ result: ok(null), submitted: "a", liveDraft: "a", auto: false }).notice
    ).toBe("已保存");
  });

  it("await 期间用户又打了字：dirty 绝不落回 false，并且按自动语境重新排程", () => {
    const outcome = saveOutcomeOf({
      result: ok(),
      submitted: "发出去那一刻的稿子\n",
      liveDraft: "发出去那一刻的稿子＋刚打的字\n",
      auto: true
    });
    // 指纹照样推进（盘上确实写了 submitted），但内存领先 ⇒ dirty 是 true。
    expect(outcome.patch.savedFingerprint).toBe("fp-next");
    expect(outcome.patch.dirty).toBe(true);
    expect(outcome.reschedule).toBe(true);
  });

  it("手动保存时领先的那几个字：dirty 仍是 true，但不重排自动保存（手动通路不替用户开关排程）", () => {
    const outcome = saveOutcomeOf({ result: ok(), submitted: "a", liveDraft: "ab", auto: false });
    expect(outcome.patch.dirty).toBe(true);
    expect(outcome.reschedule).toBe(false);
  });

  it("指纹陈旧：记下盘上那份指纹、保住 dirty，一个字节都不写——绝不清成已保存", () => {
    const outcome = saveOutcomeOf({
      result: { ok: false, reason: "stale", currentFingerprint: "fp-external" },
      submitted: "我这份\n",
      liveDraft: "我这份\n",
      auto: false
    });
    expect(outcome.patch.conflict).toEqual({ currentFingerprint: "fp-external" });
    expect(outcome.patch.dirty).toBeUndefined();
    expect(outcome.patch.savedFingerprint).toBeUndefined();
    expect(outcome.notice).toBe("文件在外部被改过，已拒绝覆盖");
  });

  it("主进程判写失败：理由原样上屏，指纹与 dirty 一步都不动（动了就是承认写成了）", () => {
    const outcome = saveOutcomeOf({
      result: { ok: false, reason: "io-error", message: "磁盘满了" },
      submitted: "a",
      liveDraft: "a",
      auto: true
    });
    expect(outcome.patch).toEqual({});
    expect(outcome.notice).toBe("保存失败：磁盘满了");
    expect(outcome.reschedule).toBe(false);
  });
});

/**
 * `docStateOf`（2026-10-10 行数预算尾巴）：这份四格拷贝原先在 store 的 `snapshot()`
 * 与 `flushIOFor.stateOf` 各写了一遍，两处必须永远一致，所以只留一份实现。
 * 钉的是它**唯一不显然**的那件事：`conflict` 要另造一个对象。
 */
describe("docStateOf", () => {
  it("四格照抄，冲突那份另造对象：暂存副本与内存里那份不许共享同一个引用", () => {
    const subject = {
      activeDocTab: A,
      draft: "改到一半\n",
      savedFingerprint: "fp-a",
      dirty: true,
      conflict: { currentFingerprint: "fp-external" },
      draftsByPath: {}
    };
    const state = docStateOf(subject);
    expect(state).toEqual({
      draft: "改到一半\n",
      savedFingerprint: "fp-a",
      dirty: true,
      conflict: { currentFingerprint: "fp-external" }
    });
    expect(state.conflict).not.toBe(subject.conflict);
    // 共享引用的后果：外部再来一次改动，只改一处，另一处的判定跟着变。
    if (state.conflict) state.conflict.currentFingerprint = "fp-changed";
    expect(subject.conflict.currentFingerprint).toBe("fp-external");
  });

  it("没冲突时给 null，而不是一个空的 {}（hasPendingDraft 认的是 null）", () => {
    const subject = {
      activeDocTab: A,
      draft: "",
      savedFingerprint: "",
      dirty: false,
      conflict: null,
      draftsByPath: {}
    };
    expect(docStateOf(subject).conflict).toBeNull();
    expect(hasPendingDraft(docStateOf(subject))).toBe(false);
  });

  it("flushIOFor 读活动那一格走的也是这一处：拿到的冲突同样是另造的", () => {
    const subject = {
      activeDocTab: A,
      draft: "手上这份\n",
      savedFingerprint: "fp-a",
      dirty: true,
      conflict: { currentFingerprint: "fp-external" },
      draftsByPath: {}
    };
    const io = flushIOFor(subject, async () => ({
      ok: true,
      fingerprint: "fp-next",
      backupRelPath: null
    }));
    const live = io.stateOf(A);
    expect(live?.conflict).toEqual({ currentFingerprint: "fp-external" });
    expect(live?.conflict).not.toBe(subject.conflict);
    // 非活动那格仍取存档，取不到给 null——这条不许被这次合并带坏。
    expect(io.stateOf("chapters/99-没待过.md")).toBeNull();
  });
});

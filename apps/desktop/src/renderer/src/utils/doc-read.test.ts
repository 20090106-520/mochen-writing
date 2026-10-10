import { beforeEach, describe, expect, it } from "vitest";
import type { DocContent } from "@mochen/contracts";
import { bumpDocLoadToken, readDocIntoTab, type DocReadIO } from "./doc-read";
import type { DocState } from "./draft-flush";

/**
 * 中栏读稿的**令牌闸**（2026-10-05 批次 3 尾巴，判定抽在 utils/doc-read）。
 *
 * store 那边（`useBookStore.doc-loading.test.ts`）钉的是「真跑起来之后 `docLoading` / `draft` /
 * `notice` 落在哪」；这一份钉的是判定本身——三道只在时序上复现的规矩：
 * ① 有暂存副本 ⇒ 一次 IPC 都不发，也不许进在读态（为一次同步赋值抖骨架是错的）；
 * ② 连点两个标签 ⇒ 先发的那次回包整个作废：既不摆正文，也**不许顺手撤掉后一次的在途标志**；
 * ③ 读失败 ⇒ 理由原样递出去（清空正文由调用方做，那是状态侧的事）。
 * 三条都靠「挂住哪一次、放行哪一次」来验，所以假 IO 把每次调用都记成一条流水。
 */
const A = "chapters/01-开局.md";
const B = "chapters/02-潮信.md";

type Log = {
  read: string[];
  loaded: string[];
  failed: { relPath: string; reason: string }[];
  stashed: string[];
  loading: boolean[];
};

/** 一枚由用例点火的中栏：`hanging` 里的那些 relPath 会挂住，`release(relPath)` 才落地。 */
function harness(options: { stash?: Record<string, DocState>; failOn?: string[] } = {}) {
  const log: Log = { read: [], loaded: [], failed: [], stashed: [], loading: [] };
  const waiters = new Map<string, () => void>();
  let rejects: string[] = options.failOn ?? [];
  const doc = (relPath: string): DocContent => ({
    relPath,
    content: `${relPath} 的正文\n`,
    fingerprint: `fp-${relPath}`
  });
  const io: DocReadIO = {
    stashed: (relPath) => options.stash?.[relPath] ?? null,
    read: (relPath) => {
      log.read.push(relPath);
      if (rejects.includes(relPath)) {
        return Promise.reject(new Error(`${relPath} 盘上读不出来`));
      }
      return new Promise<DocContent>((resolve) => {
        waiters.set(relPath, () => resolve(doc(relPath)));
      });
    },
    applyStashed: (relPath) => void log.stashed.push(relPath),
    applyLoaded: (relPath) => void log.loaded.push(relPath),
    applyFailure: (relPath, reason) => void log.failed.push({ relPath, reason }),
    setLoading: (value) => void log.loading.push(value)
  };
  return {
    log,
    setFailOn: (relPaths: string[]) => {
      rejects = relPaths;
    },
    release: (relPath: string) => waiters.get(relPath)?.(),
    io
  };
}

/** 令牌是模块级记账：每条用例都从「没有别处在读」开始，才不会互相串台。 */
beforeEach(() => bumpDocLoadToken());

describe("① 有暂存副本", () => {
  it("不发 IPC，也不进在读态", async () => {
    const stash: Record<string, DocState> = {
      [A]: { draft: "内存里那份\n", savedFingerprint: "fp-a", dirty: true, conflict: null }
    };
    const h = harness({ stash });
    await readDocIntoTab(h.io, A);
    expect(h.log.read).toEqual([]);
    expect(h.log.loading).toEqual([]);
    expect(h.log.stashed).toEqual([A]);
  });

  it("没有暂存才读盘，读完把在途撤掉", async () => {
    const h = harness();
    const pending = readDocIntoTab(h.io, A);
    expect(h.log.read).toEqual([A]);
    expect(h.log.loading).toEqual([true]);
    h.release(A);
    await pending;
    expect(h.log.loaded).toEqual([A]);
    expect(h.log.loading).toEqual([true, false]);
  });
});

describe("② 连点两个标签的竞态", () => {
  it("先发的那次回包不许摆正文", async () => {
    const h = harness();
    const first = readDocIntoTab(h.io, A);
    const second = readDocIntoTab(h.io, B);
    h.release(B);
    await second;
    expect(h.log.loaded).toEqual([B]);

    h.release(A);
    await first;
    expect(h.log.loaded, "慢的那次回包必须整个作废").toEqual([B]);
  });

  it("废弃的那次不许顺手把在途标志也撤了（否则骨架提前消失）", async () => {
    const h = harness();
    const first = readDocIntoTab(h.io, A);
    const second = readDocIntoTab(h.io, B);
    h.release(A);
    await first;
    expect(h.log.loading, "A 那次落地只许留下它自己的 true").toEqual([true, true]);

    h.release(B);
    await second;
    expect(h.log.loading).toEqual([true, true, false]);
  });

  it("换书那次作废（bumpDocLoadToken）：在途回包一个字都不许落地", async () => {
    const h = harness();
    const pending = readDocIntoTab(h.io, A);
    bumpDocLoadToken();
    h.release(A);
    await pending;
    expect(h.log.loaded).toEqual([]);
    expect(h.log.stashed).toEqual([]);
  });
});

describe("③ 读失败", () => {
  it("理由原样递出去，在途照样收回去", async () => {
    const h = harness();
    h.setFailOn([A]);
    await readDocIntoTab(h.io, A);
    expect(h.log.failed).toEqual([{ relPath: A, reason: `${A} 盘上读不出来` }]);
    expect(h.log.loaded).toEqual([]);
    expect(h.log.loading).toEqual([true, false]);
  });

  it("抛的不是 Error 也要有人话理由（不许把 undefined 甩上屏）", async () => {
    const h = harness();
    h.io.read = () => Promise.reject("磁盘坏了");
    await readDocIntoTab(h.io, A);
    expect(h.log.failed[0]?.reason).toBe("磁盘坏了");
  });

  it("废弃的那次失败也不许把理由写进新那一格", async () => {
    const h = harness();
    h.setFailOn([A]);
    const first = readDocIntoTab(h.io, A);
    const second = readDocIntoTab(h.io, B);
    await first;
    expect(h.log.failed, "A 已被 B 作废，它的失败不该上屏").toEqual([]);

    h.release(B);
    await second;
    expect(h.log.loaded).toEqual([B]);
  });
});

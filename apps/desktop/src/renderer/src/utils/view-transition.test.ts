/**
 * 视图过渡真身的单测（批次 5-㊸）。
 *
 * **为什么要用假 document 而不是起 Electron**：真机上量到的那条最要命的分支
 * （文档不可见 ⇒ `ready` 以 `InvalidStateError` 拒绝）在 node 里就是
 * `ready: Promise.reject(new DOMException(..., "InvalidStateError"))`，一行就复现；
 * 而每次都起真机来验它，代价与稳定性都不成比例。真机那侧另有 P537B 的量测记录兜着。
 *
 * 另一个刻意的选择：**每条用例都必须把这一场的 `finished` 放掉**。
 * `runViewTransition` 里那份「在飞」是模块级状态，一旦某条用例留下一个没结算的 promise，
 * 后面每一条都会因为「并发不排队」那条判据而莫名其妙地走直连分支——红的地方和真正的原因隔着好几条。
 */
import { describe, expect, it } from "vitest";
import {
  runViewTransition,
  VIEW_TRANSITION_TYPES,
  viewTransitionInFlight,
  viewTransitionSupported,
  type ViewTransitionHost
} from "./view-transition";

interface FakeOptions {
  /** startViewTransition 同步抛（老引擎只认 callback 形状时就是这个形状）。 */
  throws?: boolean;
  readyRejects?: boolean;
  finishedRejects?: boolean;
  reducedByAttribute?: boolean;
  reducedBySystem?: boolean;
  /** 不给这个函数 = 引擎不支持。 */
  unsupported?: boolean;
}

function fakeHost(options: FakeOptions = {}): {
  host: ViewTransitionHost;
  calls: { update: () => unknown; types?: string[] }[];
  invoked: Promise<unknown>[];
  resolveReady: () => void;
  rejectReady: () => void;
  resolveFinished: () => void;
  rejectFinished: () => void;
} {
  const calls: { update: () => unknown; types?: string[] }[] = [];
  const invoked: Promise<unknown>[] = [];
  let resolveReady = (): void => {};
  let rejectReady = (): void => {};
  let resolveFinished = (): void => {};
  let rejectFinished = (): void => {};
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = () =>
      rej(new DOMException("Transition was aborted because of invalid state", "InvalidStateError"));
  });
  const finished = new Promise<void>((res, rej) => {
    resolveFinished = res;
    rejectFinished = () => rej(new Error("update callback threw"));
  });
  const host: ViewTransitionHost = {
    documentElement: {
      dataset: options.reducedByAttribute === true ? { reducedMotion: "true" } : {}
    },
    defaultView: { matchMedia: () => ({ matches: options.reducedBySystem === true }) }
  };
  if (options.unsupported !== true) {
    host.startViewTransition = (request) => {
      if (options.throws === true) throw new TypeError("只接受 callback");
      calls.push(request);
      // 浏览器在同一拍里就调用 update 回调（捕获完旧状态之后立刻调），假宿主照做。
      // 不照做的话，「并发那条」量到的会是「第一场的内容还没落地」，
      // 断言红的就不是「不排队」这件事，而是探针自己少了一步。
      invoked.push(Promise.resolve(request.update()).catch(() => {}));
      return { ready, finished };
    };
  }
  return { host, calls, invoked, resolveReady, rejectReady, resolveFinished, rejectFinished };
}

/** 让 promise 链走完若干拍。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

/** 每次跑之前确认没有上一条留下的「在飞」，否则红的位置会跑偏到别的用例上。 */
async function expectIdle(): Promise<void> {
  await settle();
  expect(viewTransitionInFlight(), "上一条用例留下了没结算的过渡").toBe(false);
}

describe("runViewTransition", () => {
  it("引擎不支持 ⇒ 直接执行，且一次 API 都不碰（界面绝不能因为没有动效就不动）", async () => {
    await expectIdle();
    const fake = fakeHost({ unsupported: true });
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    expect(ran).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("没有 document（node / 单测）⇒ 当作不支持，直接执行", async () => {
    await expectIdle();
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: null }
    );
    expect(ran).toBe(1);
  });

  it("应用内「减少动效」那档 ⇒ 不发起过渡（motion.css 的总闸只管样式，管不到「要不要发起」）", async () => {
    await expectIdle();
    const fake = fakeHost({ reducedByAttribute: true });
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    expect(ran).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("OS 级 prefers-reduced-motion ⇒ 同样不发起", async () => {
    await expectIdle();
    const fake = fakeHost({ reducedBySystem: true });
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    expect(ran).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("正常那一支：先改状态、**再**等 DOM 刷出来，顺序反了就拍到同一张快照（过渡白跑）", async () => {
    await expectIdle();
    const fake = fakeHost();
    const order: string[] = [];
    runViewTransition(
      () => {
        order.push("update");
      },
      {
        host: fake.host,
        flush: async () => {
          order.push("flush");
        }
      }
    );
    expect(fake.calls).toHaveLength(1);
    await fake.invoked[0];
    expect(order, "改状态必须排在等 DOM 之前").toEqual(["update", "flush"]);
    fake.resolveFinished();
    await settle();
    expect(viewTransitionInFlight()).toBe(false);
  });

  it("方向逐字传给 CSS：去=mochen-forward、回=mochen-back；不给方向时这个键缺席", async () => {
    await expectIdle();
    const fake = fakeHost();
    runViewTransition(() => {}, { host: fake.host, direction: "forward" });
    await fake.invoked[0];
    expect(fake.calls[0]?.types).toEqual([VIEW_TRANSITION_TYPES.forward]);

    fake.resolveFinished();
    await settle();

    runViewTransition(() => {}, { host: fake.host });
    await fake.invoked[1];
    expect(fake.calls[1]?.types, "无方向时不能给 undefined 当值传").toBeUndefined();

    fake.resolveFinished();
    await settle();
  });

  it("文档不可见那条：ready 以 InvalidStateError 拒绝，不许变成未处理的拒绝，且闸要复位", async () => {
    await expectIdle();
    const fake = fakeHost();
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    await fake.invoked[2];
    fake.rejectReady();
    fake.resolveFinished();
    // 这一条如果没接住 ready 的拒绝，vitest 会把它算成 unhandled rejection 直接把用例带红。
    await settle();
    expect(ran).toBe(1);
    expect(viewTransitionInFlight()).toBe(false);
  });

  it("finished 自己拒绝（update 回调抛了）⇒ 同样不炸、闸照样复位", async () => {
    await expectIdle();
    const fake = fakeHost();
    runViewTransition(() => {}, { host: fake.host });
    await fake.invoked[3];
    fake.rejectFinished();
    await settle();
    expect(viewTransitionInFlight()).toBe(false);
  });

  it("引擎不认这个形状（同步抛）⇒ 把改动照做，只是没有动画", async () => {
    await expectIdle();
    const fake = fakeHost({ throws: true });
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    expect(ran, "抛了就等于界面没动，那比没有动效严重得多").toBe(1);
    expect(viewTransitionInFlight()).toBe(false);
  });

  it("并发：第二场直接落地而不是排队（排队的后果是界面慢半拍追上来）", async () => {
    await expectIdle();
    const fake = fakeHost();
    let ran = 0;
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    runViewTransition(
      () => {
        ran += 1;
      },
      { host: fake.host }
    );
    expect(fake.calls, "第二场不许再开一次过渡").toHaveLength(1);
    expect(ran, "但第二场的内容必须已经落地").toBe(2);
    fake.resolveFinished();
    await settle();
    expect(viewTransitionInFlight()).toBe(false);
  });
});

describe("判据", () => {
  it("viewTransitionSupported 只认「是个函数」：undefined 与非函数都不算", () => {
    expect(viewTransitionSupported(null)).toBe(false);
    expect(viewTransitionSupported({})).toBe(false);
    expect(
      viewTransitionSupported({
        startViewTransition: null as unknown as () => never
      })
    ).toBe(false);
  });

  // 「两档减少动效」那条判定的用例在 2026-10-11 搬去了 `motion-preference.test.ts`——
  // 判定搬到了 `motion-preference.ts`（与 applyReducedMotion 同居），用例跟着搬。
  // 本文件上面那两条 `runViewTransition` 用例仍然从假宿主读那两档，它们钉的是
  // **接线**（这一层确实认了那个判定），判据本身的形状归新家管。
});

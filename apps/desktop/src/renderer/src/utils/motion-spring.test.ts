/**
 * 弹簧缓动的单测（2026-10-11 批次 6-①）。
 *
 * 【为什么这份是真函数单测而不是源码契约测试】曲线是一个纯函数，进出只有「归一化进度 → 缓动后进度」，
 * 没有任何 DOM 依赖。所以这里量的是**数值本身**，不是「源文件里有没有写某个形状」——
 * 这一族判据在本仓是有名的脆弱（见 view-transition.css 那条 34 段 `linear()` 的历史：
 * 源码形状全对，值被引擎判为非法，整条声明被丢弃，而当时那条 `@supports` 闸却是绿的）。
 * 搬进 JS 之后，「值非法」这一族风险整个消失，剩下的就是数学，该量数学。
 *
 * 【物理参数钉在哪几条】阻尼比与固有角频率写在 motion-spring.ts 里，这里量它们的**后果**：
 * 过冲多大、峰在哪儿、尾巴多久收住。参数本身由 dialog-spring-wiring 钉「搬家途中没被改过」。
 */
import { describe, expect, it } from "vitest";
import { gsap } from "gsap";
import { springEase } from "./motion-spring";

/** 在 [0,1] 上按固定步长采样。步长取 1e-4：峰顶那段的曲率是 O(ω_d²)，步长太大就量不准峰高。 */
function sample(step = 1e-4): { p: number; y: number }[] {
  const out: { p: number; y: number }[] = [];
  for (let p = 0; p <= 1 + 1e-12; p += step) out.push({ p, y: springEase(p) });
  return out;
}

describe("springEase · 两端必须精确落在端点上", () => {
  it("起点 0、终点 1，逐字相等（补间要精确落位，不差那 4e-4）", () => {
    expect(springEase(0)).toBe(0);
    expect(springEase(1)).toBe(1);
  });

  it("越界输入夹到端点（progress 会因浮点误差略微越过 1，那一下必须是 1）", () => {
    expect(springEase(-1)).toBe(0);
    expect(springEase(-0.001)).toBe(0);
    expect(springEase(1.0000001)).toBe(1);
    expect(springEase(2)).toBe(1);
    expect(springEase(1e6)).toBe(1);
    // NaN 不在这份判据里：GSAP 永远不会给 ease 喂 NaN（进度由它自己按总时长算），
    // 为一个不可能的输入加守卫，是给「防御」三个字找了个不会发生的工作量。
    // 真要防，症状会是补间整体不推进、且报在 GSAP 内部而不是这里——那时候读这个函数没用。
  });
});

describe("springEase · 形状：过冲有界、峰不跑偏", () => {
  const points = sample();

  it("过冲约 8%，且严格高于当年那条 34 点折线量出来的 1.0829", () => {
    const peak = Math.max(...points.map((s) => s.y));
    // 解析解的解析峰值 = 1 + exp(−ζπ/√(1−ζ²)) ≈ 1.08353。
    // 当年那条折线量到 1.0829，是因为峰值在 t≈30.8% 而均匀采样落在 27.3% 与 30.3%——
    // **真正的峰顶夹在两个采样点之间**，折线够不着。这是换掉采样的全部理由。
    expect(peak, "解析解的峰必须严格高于折线版，否则说明根本没换干净").toBeGreaterThan(1.0829);
    expect(peak, "过冲超过 9% 就不是弹而是晃了").toBeLessThanOrEqual(1.09);
  });

  it("峰值落在 30% 上下（π/ω_d ≈ 0.308），跑偏就是固有角频率被改过", () => {
    const peakAt = points.reduce((best, s) => (s.y > best.y ? s : best), points[0]!);
    expect(peakAt.p).toBeGreaterThan(0.29);
    expect(peakAt.p).toBeLessThan(0.33);
  });

  it("一次落位之后不再二次弹（只有一个峰）", () => {
    // 真正会担心的形状是「弹簧收不住、来回荡两下」。数一下超过 1.01 的区段有几段。
    const humps: number[] = [];
    let inHump = false;
    for (const s of points) {
      const above = s.y > 1.01;
      if (above && !inHump) {
        humps.push(s.p);
        inHump = true;
      } else if (!above && inHump) {
        inHump = false;
      }
    }
    expect(humps.length, "过冲区段不止一段 = 收不住").toBe(1);
  });

  it("起手到峰顶严格递增（不许中途先掉下去再上来）", () => {
    const peakAt = points.reduce((best, s) => (s.y > best.y ? s : best), points[0]!).p;
    const rising = points.filter((s) => s.p <= peakAt);
    for (let i = 1; i < rising.length; i += 1) {
      expect(rising[i]!.y, `t=${rising[i]!.p.toFixed(4)} 处掉下去了`).toBeGreaterThanOrEqual(
        rising[i - 1]!.y
      );
    }
  });

  it("全程不跌破 0（负的进度会让 GSAP 往反方向甩一小段）", () => {
    expect(Math.min(...points.map((s) => s.y))).toBeGreaterThanOrEqual(0);
  });
});

describe("springEase · 尾巴收得住", () => {
  it("后 10% 的偏差在 0.2% 以内（收不干净的弹簧看起来像还在抖）", () => {
    for (let p = 0.9; p <= 0.99; p += 0.005) {
      expect(
        Math.abs(springEase(p) - 1),
        `t=${p.toFixed(3)} 离 1 还差 ${springEase(p) - 1}`
      ).toBeLessThan(0.002);
    }
  });

  it("是纯函数：同一输入永远同一输出（补间中途 seek 才不会跳）", () => {
    for (const p of [0.13, 0.5, 0.87]) {
      expect(springEase(p)).toBe(springEase(p));
    }
  });
});

/**
 * **这一组是本文件存在的主要理由之一：源码守卫钉不到 GSAP 收不收这个形状。**
 *
 * 上面所有断言都只看这个函数自己；可真正要成立的是「GSAP 把它当成一条合法的 ease」。
 * 那是个跨库的契约——GSAP 哪天不再接受裸函数当 ease，只有这一组会红，
 * 而症状（补间悄悄用默认 ease）本身是看不见的。
 */
describe("springEase · GSAP 真的收这个形状", () => {
  it("parseEase 解析出来的缓动与手写曲线逐点相等（不是被悄悄换成默认 ease）", () => {
    const parsed = gsap.parseEase(springEase);
    let worst = 0;
    let worstAt = 0;
    for (let p = 0; p <= 1; p += 0.001) {
      const diff = Math.abs(parsed(p) - springEase(p));
      if (diff > worst) {
        worst = diff;
        worstAt = p;
      }
    }
    // 被换成默认 ease 的话，这个差是数量级级别的（~0.2），不是浮点尾数级别的。
    expect(
      worst,
      `GSAP 解析出来的 ease 与手写曲线不一致（最大差出现在 p=${worstAt}）`
    ).toBeLessThan(1e-12);
  });

  it("过冲那一下在 GSAP 侧也还在（不是被压平成单调曲线）", () => {
    const parsed = gsap.parseEase(springEase);
    let peak = 0;
    for (let p = 0; p <= 1; p += 0.001) peak = Math.max(peak, parsed(p));
    expect(peak, "GSAP 侧看不到过冲 = 曲线在中途被改了").toBeGreaterThan(1.08);
  });
});

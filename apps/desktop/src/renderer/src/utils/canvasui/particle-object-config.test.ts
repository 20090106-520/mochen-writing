/**
 * 粒子引擎配置合并的契约（2026-10-05）。
 *
 * 钉的是那个把画布打成空白的 bug：`ParticleObject.vue` 用
 * `defineProps<ParticleObjectOptions>()` 声明了全部 25 个键，宿主只传 7 个，
 * Vue 3 的 initProps 会把未传的声明 prop **显式写成 undefined 键**（不是省略键）。
 * 上游的 `{ ...DEFAULTS, ...options }` 于是把这些默认值全覆盖掉，
 * `config.spring === undefined` ⇒ `Math.max(undefined, 0.05)` = NaN
 * ⇒ simulate() 第一帧整条点云变 NaN ⇒ three 每帧报 computeBoundingSphere NaN、画布全空。
 *
 * 为什么是真行为测试而不是源码字符串匹配：mergeConfig 是纯函数、零依赖，
 * 单独成模块就是为了能直接 import 它跑断言（particle-object.ts 一 import 就拖进 three + addons）。
 * 变异实测：把它改回 `{ ...DEFAULTS, ...options }` 的语义（不过滤 undefined），
 * 第二条当场转红并点名 `spring`。
 */
import { describe, expect, it } from "vitest";
import { mergeConfig } from "./particle-object-config";
import { DEFAULTS, type ParticleObjectOptions } from "./particle-object-types";

/** Vue 3 的真实形状：声明了但没传的 prop 是「键存在、值为 undefined」。 */
function vuePropsLike(passed: ParticleObjectOptions): ParticleObjectOptions {
  const all: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS)) all[key] = undefined;
  Object.assign(all, passed);
  return all as ParticleObjectOptions;
}

describe("粒子配置合并 · undefined 不得覆盖默认值", () => {
  it("宿主只传 7 个 prop 时，没传的那些保住 DEFAULTS 的值（这就是 2026-10-05 那个 bug 的正面）", () => {
    const config: Required<ParticleObjectOptions> = { ...DEFAULTS };
    // BookWorkbench.vue:48-58 实际绑定的那些
    mergeConfig(
      config,
      vuePropsLike({
        src: "mochen-lockup.jpg",
        count: 5000,
        drift: 0.5,
        floatIntensity: 0.35,
        rotationIntensity: 0,
        orbit: false,
        zoom: false,
        onError: () => {}
      })
    );

    // 传了的用宿主值
    expect(config.count).toBe(5000);
    expect(config.drift).toBe(0.5);
    expect(config.rotationIntensity).toBe(0);
    expect(config.orbit).toBe(false);
    // 没传的必须保住默认值 —— 这一组正是被 undefined 吃掉的
    for (const key of [
      "spring",
      "damping",
      "swirl",
      "size",
      "fov",
      "scale",
      "cameraDistance"
    ] as const) {
      expect(config[key], `${key} 被 undefined 覆盖了`).toBe(DEFAULTS[key]);
    }
  });

  it("合并后的值能算出有限的物理系数：stiffness/decay 只要有一个 NaN，第一帧点云就全废", () => {
    const config: Required<ParticleObjectOptions> = { ...DEFAULTS };
    mergeConfig(config, vuePropsLike({ count: 5000 }));

    // 逐字照抄 particle-object.ts:339-341 的两行
    const stiffness = 60 * Math.max(config.spring, 0.05);
    const dampingRate = 3 + 12 * Math.min(Math.max(config.damping, 0), 1);
    const decay = Math.exp((-dampingRate * 1) / 60);

    expect(Number.isFinite(stiffness), "stiffness 是 NaN").toBe(true);
    expect(Number.isFinite(dampingRate), "dampingRate 是 NaN").toBe(true);
    expect(Number.isFinite(decay), "decay 是 NaN").toBe(true);
  });

  it("反向鉴别：若不过滤 undefined，这三个系数立刻全变 NaN（复现上游那条写法）", () => {
    // 这条不是测 mergeConfig，是把**旧写法**跑一遍，证明「守卫在咬的那条虫是真的」。
    const buggy = { ...DEFAULTS, ...vuePropsLike({ count: 5000 }) };
    const stiffness = 60 * Math.max(buggy.spring, 0.05);
    const dampingRate = 3 + 12 * Math.min(Math.max(buggy.damping, 0), 1);

    expect(Number.isNaN(stiffness), "旧写法本该产生 NaN；不产生说明复现失效，这条得重写").toBe(
      true
    );
    expect(Number.isNaN(dampingRate), "旧写法本该产生 NaN；不产生说明复现失效，这条得重写").toBe(
      true
    );
  });

  it("setOptions 那一路也走同一个合并：不会因为一次 props 变更把配置再打回 undefined", () => {
    const config: Required<ParticleObjectOptions> = { ...DEFAULTS };
    mergeConfig(config, vuePropsLike({ count: 5000 }));
    // 模拟 watch 触发的二次合并（ParticleObject.vue:36-39 的 `{ ...props }`）
    mergeConfig(config, vuePropsLike({ count: 5000 }));
    expect(config.spring).toBe(DEFAULTS.spring);
    expect(config.count).toBe(5000);
  });

  it("0 与 false 不许被当成「没传」吃掉（只有 undefined 才跳过）", () => {
    const config: Required<ParticleObjectOptions> = { ...DEFAULTS };
    mergeConfig(config, { rotationIntensity: 0, orbit: false, zoom: false, count: 16 });
    expect(config.rotationIntensity).toBe(0);
    expect(config.orbit).toBe(false);
    expect(config.zoom).toBe(false);
    expect(config.count).toBe(16);
  });
});

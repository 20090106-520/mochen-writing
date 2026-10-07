// 源码取自 canvas-ui（github.com/DavidHDev/canvas-ui）的 ParticleObject，MIT + Commons Clause。
// 为过本仓 800 行单文件预算拆为多模块；除 import/导出与注释外逻辑零改动。上游：canvasui.dev。
//
// 本仓本地新增（上游无此文件）：配置的 undefined-safe 合并。
// 单独成文件而不是塞进 particle-object.ts，是为了能**真的单测它**——
// particle-object.ts 一 import 就拖进 three 与 addons，node 环境里跑测试要付一大笔无谓代价；
// 而这里是纯函数、零依赖，直接 import type 即可。默认值的真身仍只有 DEFAULTS 一份（铁律 6）。
import type { ParticleObjectOptions } from "./particle-object-types";

/**
 * 把 options 合并进 config，**跳过值为 undefined 的键**。
 *
 * 上游原写法是 `{ ...DEFAULTS, ...options }`（setOptions 里则是 `Object.assign(config, next)`），
 * 而它的唯一调用方是 `ParticleObject.vue`：`defineProps<ParticleObjectOptions>()` 声明了全部
 * 25 个键，宿主（BookWorkbench）只传其中 7 个 —— 剩下 18 个在 props 对象里是**键存在、值为
 * undefined**（Vue 3 的 initProps 会显式写 `props[key] = void 0`，不是省略键）。
 *
 * 对象展开与 Object.assign 都会用这个 undefined **覆盖掉 DEFAULTS 里的默认值**，于是
 * `config.spring === undefined` ⇒ `Math.max(undefined, 0.05) === NaN` ⇒ stiffness / decay 全是
 * NaN ⇒ simulate() 的第一帧就把整条点云写成 NaN ⇒ three.js 每帧
 * `computeBoundingSphere(): Computed radius is NaN`、画布全空，宿主的静态图回退又等不到 onError。
 *
 * 语义与上游完全一致——「用户传了才用用户的，没传就用默认」——只是不再把「没传」
 * 误判成「传了个 undefined」。
 */
export function mergeConfig(
  target: Required<ParticleObjectOptions>,
  options: ParticleObjectOptions
): void {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    target[key as keyof ParticleObjectOptions] = value as never;
  }
}

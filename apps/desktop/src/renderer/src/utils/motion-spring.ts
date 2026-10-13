/**
 * 弹簧缓动（2026-10-11 批次 6-①）——本仓**唯一**的一条弹簧，从 CSS 搬到这里。
 *
 * ## 它是什么
 * 一个阻尼谐振子的**单位阶跃响应**，写成 GSAP 能直接吃的 `ease` 函数。
 * GSAP 的 `ease` 允许传普通函数（`gsap.to(el, { ease: myFn })`），
 * 所以**不需要 CustomEase 之类的插件**：曲线就在这里算，算完直接给。
 *
 * ## 为什么从 CSS 搬过来
 * 它原来住在 `view-transition.css` 里，是一条 34 停靠点的 `linear()` 字符串。
 * 那条字符串是本仓最贵的一次静默失效的现场（2026-10-10 真机撞出）：
 * 本机引擎（Electron 42）只认「逗号分隔的单个数字」这一种形式，写成别的形状
 * **整条声明在计算值阶段被丢弃**——`animation-name` 算出来是 `none`、
 * `getAnimations()` 为空、控制台一个字都没有。而当时那条 `@supports` 闸探的
 * 恰好是引擎唯一收的那种形式，**闸是过的，曲线从没生效过**。
 *
 * 搬过来之后这一族风险整个消失：JS 里算出来的数不存在「值非法被丢弃」这回事，
 * 没有 `@supports` 要探，也就没有「闸探的形状和实际取值不是同一个形状」那个坑。
 *
 * ## 为什么是解析解而不是继续采样 34 个点
 * 原来那条折线是 34 个均匀采样点拼的。峰值在 t=30.8% 处，而均匀采样落在 27.3% 与 30.3%——
 * **真正的峰顶正好夹在两个采样点之间**，于是折线量出来的最大过冲是 8.29%，
 * 而解析解是 8.36%。解析解没有这个误差，也不必再守着「停靠点必须是单个数字」那条形状规则。
 * 物理参数一个字没改（阻尼比 0.62、固有角频率 13），所以手感与原来一致，
 * 差别只在这 0.07% 的过冲上——那部分本来就是采样误差，不是设计意图。
 */

/** 阻尼比：越小过冲越大、尾巴越长。0.62 是原来那条 CSS 弹簧用的值，手感照旧。 */
export const SPRING_DAMPING_RATIO = 0.62;

/**
 * 固有角频率（弧度 / 归一化时长）。
 * 峰值时刻 π/ω_d ≈ 0.308 —— 原来注释里那句「峰值在 30%」量的就是它。
 */
export const SPRING_ANGULAR_FREQUENCY = 13;

/** 欠阻尼（ζ < 1）时的有阻尼固有角频率 ω_d = ω₀√(1 − ζ²)。 */
const DAMPED_FREQUENCY = SPRING_ANGULAR_FREQUENCY * Math.sqrt(1 - SPRING_DAMPING_RATIO ** 2);

/** 指数包络的衰减率 ζω₀：整个尾巴的收得快慢由它一个数决定。 */
const DECAY = SPRING_DAMPING_RATIO * SPRING_ANGULAR_FREQUENCY;

/** GSAP 认可的那种 ease 形状：收归一化进度、吐缓动后的进度。 */
export type EaseFunction = (progress: number) => number;

/**
 * 阶跃响应：
 *
 *   y(t) = 1 − e^(−ζω₀t) · [ cos(ω_d t) + (ζω₀/ω_d) · sin(ω_d t) ]
 *
 * 两端的短路不是修辞，是必要的：
 *  ① `progress >= 1` 直接给 1。解析解在 t=1 处是 1.000402 而不是 1（那段残余尾巴），
 *     强行收成 1 让补间**精确**落在目标值上，省掉一轮「差 4e-4 还要再抖一下才停」。
 *     代价是 t=1 处有 4e-4 的跳变：落在 6px 的位移上是 0.0024px，肉眼与像素都量不到。
 *  ② `progress <= 0` 给 0：t=0 处解析解本来就是 0，这里只是把边界写死，
 *     免得 GSAP 在起始帧用一个浮点余数算出 -1e-17。
 *
 * 注意 t 是**归一化**的（0→1 走完一整条曲线），秒数由调用方的 `duration` 定。
 * 原来 ω₀ = 13 也是按「一整条曲线」标定的，所以搬过来不需要重标。
 */
export const springEase: EaseFunction = (progress) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return (
    1 -
    Math.exp(-DECAY * progress) *
      (Math.cos(DAMPED_FREQUENCY * progress) +
        (DECAY / DAMPED_FREQUENCY) * Math.sin(DAMPED_FREQUENCY * progress))
  );
};

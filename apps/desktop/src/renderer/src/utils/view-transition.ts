/**
 * 视图过渡的真身（2026-10-08 批次 5-㊸）。
 *
 * ## 它是什么
 * `document.startViewTransition` —— 2026 年浏览器侧最被公认的一次 UI 升级：把 DOM 换页
 * 这件事从「一帧之内突变」变成「浏览器自己拍两张快照并插值」。本仓用它给三处换画面的动作
 * 加一层连贯感：左栏切中栏页面（工作台 → 插件 / 技能库 / 皮肤广场）、进设置中心、回工作区，
 * 外加**换皮肤**（同一套机制顺带把「啪地一下整屏变色」变成交叉淡入）。
 *
 * ## 为什么要有这么一份真身，而不是就地 `document.startViewTransition(...)`
 * 这一族有四个坑，每一个都得在**一处**处理，散在十几处调用里就是十几个漏点：
 *
 * ① **Vue 不会同步改 DOM。** 回调里改完 ref 就返回，浏览器在下一帧拍到的「新」快照和旧的一样，
 *    整段过渡等于没发生过（不报错，只是白跑一趟）。必须把 `nextTick()` 作为回调的返回值交出去。
 *
 * ② **文档不可见时 Chromium 直接跳过。** 【P537B 真机量到】窗口最小化时
 *    `document.visibilityState === "hidden"`，`startViewTransition` 的 `ready` 会以
 *    `InvalidStateError: Transition was aborted because of invalid state` 拒绝，而 `finished` 照样 resolve。
 *    不接住这个拒绝 ⇒ 一次未处理的 promise 拒绝落在控制台里，看起来像产品出错。
 *
 * ③ **不支持时不能冻结界面。** 引擎只认 callback 形状时会同步抛；那一支必须把改动照做，
 *    否则用户点了左栏什么也没发生——那是「功能坏了」，比没有动效严重得多。
 *
 * ④ **并发时不排队。** 快速连点两枚钮，第二次若排队，等第一次放完再放它，中间隔着几百毫秒，
 *    用户看到的是「界面慢半拍地追上来」。宁可第二次直接落地。
 *
 * ## 与「减少动效」的关系
 * 两个通路都要认：应用内那档偏好写在 `html[data-reduced-motion]`（utils/motion-preference.ts），
 * OS 级那条是 `prefers-reduced-motion` 媒体查询。任一为真 ⇒ 一次过渡都不起，直接改画面。
 * CSS 那侧还有第二道闸（styles/view-transition.css）——因为 motion.css 的总闸选择器是
 * `html[data-reduced-motion="true"] *`，而 `*` **匹配不到 `::view-transition-*` 伪元素**，
 * 光靠那份总闸关不掉视图过渡。
 */
import { nextTick } from "vue";

/** 过渡方向：进（去别处）为 forward，回（回工作台）为 back。只这两个，别的一律当进。 */
export type ViewTransitionDirection = "forward" | "back";

/** 交给 CSS 的类型名。CSS 侧 `html:active-view-transition-type(<name>)` 逐字钉着这两个。 */
export const VIEW_TRANSITION_TYPES = {
  forward: "mochen-forward",
  back: "mochen-back"
} as const;

/** startViewTransition 返回的那只对象，本仓只用到两个 promise。 */
export interface ViewTransitionHandle {
  ready: Promise<void>;
  finished: Promise<void>;
}

/**
 * 本仓只依赖上面这几个成员。写成结构类型而不是 `Document`，
 * 是为了让守卫能传一只假 document —— 真机那条（文档不可见 ⇒ InvalidStateError）
 * 在 node 里用 `ready: Promise.reject(...)` 就能复现，不必起 Electron。
 */
export interface ViewTransitionHost {
  startViewTransition?: (options: {
    update: () => unknown;
    types?: string[];
  }) => ViewTransitionHandle;
  documentElement?: { dataset?: Record<string, string | undefined> } | null;
  defaultView?: { matchMedia?: (query: string) => { matches: boolean } | null } | null;
}

export interface RunViewTransitionOptions {
  /** 进/退方向，决定 CSS 走哪一支滑入。省略 = 无方向的纯淡入淡出。 */
  direction?: ViewTransitionDirection;
  /** 注入宿主，单测与真机探针用；省略时取全局 document。 */
  host?: ViewTransitionHost | null;
  /** DOM 刷新的等待口径。省略时是 Vue 的 nextTick（生产里只走这一条）。 */
  flush?: () => Promise<void>;
}

function currentHost(): ViewTransitionHost | null {
  return typeof document === "undefined" ? null : (document as unknown as ViewTransitionHost);
}

/** 引擎认不认这个 API。 */
export function viewTransitionSupported(host: ViewTransitionHost | null): boolean {
  return host !== null && typeof host.startViewTransition === "function";
}

/** 两档「减少动效」任一为真，这一轮就不该有动画。 */
export function reducedMotionActive(host: ViewTransitionHost | null): boolean {
  if (host === null) return false;
  const byPreference = host.documentElement?.dataset?.reducedMotion === "true";
  const bySystem =
    host.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  return byPreference || bySystem;
}

/**
 * 有一场过渡正在放。并发的那一次直接落地（见文件头 ④）。
 * 只在本模块内写，别复制一份——这份状态跟着 startViewTransition 的生命周期走，
 * 复制出去就会变成两份各自的「在飞」。
 */
let inFlight = false;

/**
 * 跑一次视图过渡。**无论走哪一支，`update` 一定被执行且只执行一次**——
 * 那是「用户点了左栏有反应」这条底线，动效是加在上面的，不是加在它上面的。
 */
export function runViewTransition(
  update: () => void,
  options: RunViewTransitionOptions = {}
): void {
  const host = options.host === undefined ? currentHost() : options.host;

  if (!viewTransitionSupported(host) || reducedMotionActive(host) || inFlight) {
    update();
    return;
  }

  const flush = options.flush ?? (() => nextTick());

  inFlight = true;
  try {
    // exactOptionalPropertyTypes 开着：`types` 不能显式给 undefined，只能缺席或给值。
    const request: { update: () => unknown; types?: string[] } = {
      // ① 改完状态**不要立刻返回**：把 Vue 那一帧的 DOM 刷新等出来，浏览器才拍得到「新的」。
      update: () => {
        update();
        return flush();
      }
    };
    if (options.direction) request.types = [VIEW_TRANSITION_TYPES[options.direction]];
    const transition = (
      host as ViewTransitionHost & {
        startViewTransition: (o: {
          update: () => unknown;
          types?: string[];
        }) => ViewTransitionHandle;
      }
    ).startViewTransition(request);
    // ② 文档不可见 ⇒ ready 拒绝。不接住就是一次未处理的 promise 拒绝。
    void transition.ready.catch(() => {});
    void transition.finished
      .catch(() => {})
      .then(() => {
        inFlight = false;
      });
  } catch {
    // ③ 引擎不认这个形状（同步抛）：把改动照做，只是没有动画。
    inFlight = false;
    update();
  }
}

/** 供守卫读：此刻是否有一场过渡在飞（真机上用来确认「并发不排队」那条）。 */
export function viewTransitionInFlight(): boolean {
  return inFlight;
}

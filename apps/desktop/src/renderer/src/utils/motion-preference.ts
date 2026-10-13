/**
 * 「减少动效」的本机偏好（2026-10-05 外观页新增，配 quality/motion.css 那层动效而生）。
 *
 * 现状：CSS 只有 OS 级 `prefers-reduced-motion` 媒体查询；但动画由我们自己加的这一层
 * （弹层出场、卡片过渡）在弱机器/晕动症用户那里都可能嫌多，这一档把「要不要动」交给用户。
 * 与 autosave-preference 同一类本机偏好：走 localStorage，零新 IPC。
 *
 * 生效通路：App.vue 挂载时与外观页切换时调 applyReducedMotion，把状态写进
 * `html[data-reduced-motion]`，motion.css 据此让整层动效退场（morphicons 那两枚
 * 也读这一档，把 reduced-motion 从 "user" 换成 "always"）。
 */
export const MOTION_PREFERENCE_KEY = "mochen.reducedMotion";

export interface MotionPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 默认关：开箱动效全开（与「没这档偏好」时的观感一致）。 */
export const REDUCED_MOTION_DEFAULT = false;

export function loadReducedMotion(storage: MotionPreferenceStorage | null): boolean {
  if (storage === null) return REDUCED_MOTION_DEFAULT;
  // 只认写过的档：关=显式 "false"（要跟「没写过」区分开吗？不必——读档只回答开/关，关就是默认观感）。
  return storage.getItem(MOTION_PREFERENCE_KEY) === "true";
}

export function saveReducedMotion(storage: MotionPreferenceStorage, enabled: boolean): void {
  if (enabled) storage.setItem(MOTION_PREFERENCE_KEY, "true");
  else storage.removeItem(MOTION_PREFERENCE_KEY);
}

/**
 * 「现在该不该有动画」这件事的**唯一**判定：应用内那档偏好属性 + OS 级媒体查询，任一为真就是不要。
 *
 * 【2026-10-11 从 `view-transition.ts` 搬来这里】搬的理由是**归属**，不是实现变了：
 * 这两条通路认的都是 `applyReducedMotion` 写在 `html` 上的那个属性，与视图过渡无关，
 * 而下一个消费者是对话框入场（composables/useDialogMotion.ts）——让弹层动效去 import 一个
 * 「视图过渡」模块，读代码的人会以为弹窗和视图过渡有什么耦合。判定一个字没改，
 * 搬过来是为了让依赖方向对：认档的地方一律指向本模块。
 *
 * 入参写成结构类型而不是 `Document`：单测传一只普通对象即可，不必起 DOM。
 * `view-transition.ts` 的 `ViewTransitionHost` extends 本接口，两边不会各写一份形状。
 */
export interface ReducedMotionHost {
  documentElement?: { dataset?: Record<string, string | undefined> } | null;
  defaultView?: { matchMedia?: (query: string) => { matches: boolean } | null } | null;
}

/** 两档「减少动效」任一为真，这一轮就不该有动画。没有宿主（node / 单测）当作不减弱。 */
export function reducedMotionActive(host: ReducedMotionHost | null): boolean {
  if (host === null) return false;
  const byPreference = host.documentElement?.dataset?.reducedMotion === "true";
  const bySystem =
    host.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  return byPreference || bySystem;
}

/**
 * 浏览器侧的宿主。node / 单测里没有 `document` 时给 null，调用方按「不减弱」处理。
 *
 * 为什么值得收成一份：`typeof document === "undefined" ? null : document` 这一行，
 * 认档的地方（对话框入场、视图过渡）都要写一遍，写两遍就成两份实现——
 * 哪天其中一处忘了判，就只在一半的动画上失效，症状是「有的动效关不掉」。
 */
export function currentReducedMotionHost(): ReducedMotionHost | null {
  return typeof document === "undefined" ? null : (document as unknown as ReducedMotionHost);
}

/**
 * 把档位落到文档根上（motion.css 的退场开关就是这一个属性）。
 * 入参收窄成 dataset 一小块，测试传普通对象即可，不依赖 DOM 全局。
 */
export function applyReducedMotion(
  root: { dataset: Record<string, string | undefined> } | null,
  enabled: boolean
): void {
  if (root === null) return;
  if (enabled) root.dataset.reducedMotion = "true";
  else delete root.dataset.reducedMotion;
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function motionPreferenceStorage(): MotionPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Emotion Ball 接入层（2026-10-21）。
 *
 * 引擎本体来自 https://github.com/sam70361/aora-bot 的 emotion-ball/js/，四份脚本
 * **原样搬入、无逻辑改动**（只按本仓 prettier 规则重排过格式）：它们是按顺序求值的 IIFE，靠 window 上的三个全局互相接线——
 *   rings.js    → window.EB_RINGS（25 组 48 点眼环）
 *   emotions.js → window.EMOTION_SEED / EMOTION_GROUPS（32 种表情的纯数据）
 *   ball.js     → window.EmotionBall.createBall（SVG 骨架与逐帧渲染）
 *   engine.js   → window.EmotionBall.create（状态机 / 动画原语 / 兜底）
 * 所以这四行 import 的**先后不能动**，也不能被 tree-shake 掉（都是副作用导入）。
 *
 * 这里的 facade 只做两件事：把 window 上的裸全局收成一个带类型的入口；
 * 把「取不到引擎」收成 null 而不是让渲染层在挂载期抛未捕获异常。
 * 许可：引擎与表情数据非商业免费、商用需授权；球形角色视觉形象永不商用。
 * 原文见同目录 LICENSE 与 NOTICE.md。
 */
import "./rings.js";
import "./emotions.js";
import "./ball.js";
import "./engine.js";

/** 表情定义（emotions.js 的 EMOTION_SEED 一项）。id 就是对外契约，00-09 生命周期 / 10-29 情绪 / 30-49 代理状态。 */
export interface EmotionSeed {
  id: string;
  name: string;
  group: string;
  desc?: string;
  en?: { name: string; desc: string };
}

export interface EmotionGroup {
  key: string;
  name: string;
}

export interface EmotionBallOptions {
  /** 初始表情 id，默认 '02'。 */
  emotion?: string;
  /** 待机策略：true 用内置时长，也可传 { standbyAfter, sleepAfter, standbyId, sleepId }。 */
  idle?: boolean | Record<string, number | string>;
  /** 身体形态：blob / wedge / gem，默认 blob。 */
  shape?: "blob" | "wedge" | "gem";
  /** 主题色实例：体色 / 眼色，优先于表情自带的体色。 */
  color?: string;
  eyeColor?: string;
  /** 眼睛放大倍率；小尺寸实例建议 1.5~1.8。 */
  eyeScale?: number;
  /** 未知 id 的回退表情，默认 '02'。 */
  fallbackId?: string;
  /** false 时只渲染一张静态帧、不进 rAF（时间线里的历史消息用这个）。 */
  autostart?: boolean;
  /** 精简模式：关掉彩带 / 撒花。 */
  lite?: boolean;
  label?: string;
}

export interface EmotionBallInstance {
  setEmotion(id: string, opts?: { auto?: boolean }): void;
  setActive(active: boolean): void;
  renderStatic(): void;
  setGaze(nx: number, ny: number): void;
  destroy(): void;
  on(event: "change" | "tips" | "error", cb: (payload: unknown) => void): EmotionBallInstance;
}

export interface EmotionBallSdk {
  create(el: HTMLElement, opts?: EmotionBallOptions): EmotionBallInstance;
}

type EmotionBallWindow = Window & {
  EmotionBall?: EmotionBallSdk;
  EMOTION_SEED?: EmotionSeed[];
  EMOTION_GROUPS?: EmotionGroup[];
};

/** 引擎实例；脚本没加载成功时返回 null（调用方按「不画」处理，不要在挂载期抛错）。 */
export function emotionBall(): EmotionBallSdk | null {
  return (window as EmotionBallWindow).EmotionBall ?? null;
}

/** 全部 32 种表情的原始定义（顺序即编号顺序）。 */
export function emotionSeeds(): readonly EmotionSeed[] {
  return (window as EmotionBallWindow).EMOTION_SEED ?? [];
}

/** 三个分组（生命周期 / 情绪反应 / 代理工作状态）。 */
export function emotionGroups(): readonly EmotionGroup[] {
  return (window as EmotionBallWindow).EMOTION_GROUPS ?? [];
}

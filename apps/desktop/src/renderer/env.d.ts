import type { RendererApi } from "@mochen/contracts";
// 接缝处必须用**同一份**事件类型（不是各写一份形状）：函数的参数是逆变的，
// 声明成宽的 `SpeechRecognitionErrorEvent`（带 message/bubbles/…）时，
// 窄的 `VoiceErrorEvent` 处理器赋不上去，tsc 会在 useVoiceInput 那一行报 TS2322。
// 这一行 import 就是把那个接缝变成显式的、可被 tsc 咬住的一处，而不是两处手抄。
import type { VoiceErrorEvent, VoiceResultEvent } from "./src/composables/voice-input";

declare global {
  interface Window {
    mochen: RendererApi;
    /**
     * Web Speech API 的**识别**本体与它的构造器。
     *
     * 为什么在这里补一份：`lib.dom.d.ts` 只声明了识别**结果**那一族
     * （`SpeechRecognitionResult` / `ResultList` / `Alternative` / `SpeechRecognitionEvent` /
     * `SpeechRecognitionErrorEvent` / `SpeechRecognitionErrorCode`），唯独没有 `SpeechRecognition`
     * 本体与构造器——所以裸 tsc 下 `SpeechRecognition` 是未定义标识符。
     * 而本仓 verify 用的是裸 tsc（不是 vue-tsc）、`.vue` 又不进类型程序：
     * 写错一个成员名（`continuous` 拼成 `continous`）不会有任何关卡叫。
     *
     * 只声明本仓真用到的成员，不是规范抄本；`on*` 用属性而不是 `addEventListener`，
     * 因为摘回调就是「不留后台麦克风」的实现（`voice-input.ts` 的 `release()` 置 null）。
     * 不 `extends EventTarget`：我们只认这四个属性，混入 `addEventListener` 只会让人
     * 以为可以靠它摘干净。`onerror` / `onresult` 的事件类型直接引用 voice-input.ts 那两份
     * （见文件头的 import 注释：接缝只能有一份）。
     */
    SpeechRecognition?: SpeechRecognitionConstructor;
    /** 旧前缀名：只有需要兼容老内核时才存在，与标准名二选一。 */
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }

  interface SpeechRecognition {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null;
    onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
    onerror: ((this: SpeechRecognition, ev: VoiceErrorEvent) => unknown) | null;
    onresult: ((this: SpeechRecognition, ev: VoiceResultEvent) => unknown) | null;
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition;
  }
}

export {};

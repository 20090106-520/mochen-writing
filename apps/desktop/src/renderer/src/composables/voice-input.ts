/**
 * 语音输入（Web Speech API）的全部判定，纯逻辑、不碰 Vue、不碰 DOM。
 *
 * 为什么要单独一份：输入卡那枚麦克风的每一个判断——能不能按、该不该停、
 * 浏览器给的 error 码翻成人话、识别文本怎么追加、超限怎么截——
 * 都要能脱离浏览器单测，所以它们住在这里，`ComposerBox.vue` 只渲染与转发事件
 * （铁律：同一判定只有一份实现，判定下沉 utils/contracts 且有单测）。
 *
 * **本机大概率走不到「能用」那条路，这一点必须写在最前面**：
 * Web Speech 的**识别**部分（`SpeechRecognition` / `webkitSpeechRecognition`）只有
 * 带 Google 识别服务的 Chrome / Edge / Safari 实现了；Electron 自带的 Chromium
 * 和 Firefox 都没实现。于是：
 *  - 降级路径不是边角情况，是本仓的常态；
 *  - 但判定与接线仍按「有就真能用」写全，换成带识别的内核即刻生效，不留假接线；
 *  - 拿不准时宁可显式说「本机不支持」，也不把按钮画成可点、点了没反应。
 * 识别本身是 Chromium 内置能力，因此**不开新 IPC 通道**。
 *
 * 三个设计决定，各自有代价，写在这里免得半年后被人当成随手写的：
 *  ① 分段用换行而不是替你补标点：Web Speech 的 zh-CN 输出**没有标点**，
 *     自己往里塞句号等于伪造识别结果。每段落一行既保住了「能分句」，又不编内容。
 *  ② 去重只做「按下标只消费一次 + 只取第 0 个候选」，
 *     **不做文本级模糊去重**：用户真连说两句「好」时模糊去重会吞掉一句，那是丢内容。
 *  ③ 追加按码点截断，口径与 `composerCounter` / 主进程 `USER_TEXT_MAX_LEN` 同源。
 */
import { USER_TEXT_MAX_LEN, codePointLength } from "@mochen/contracts";

/** 浏览器给的错误码：直接用 lib.dom 那份联合类型，不在本仓手抄第二份（加新码时 tsc 会报）。 */
export type VoiceBrowserErrorCode = SpeechRecognitionErrorCode;

/**
 * 看得见的理由：浏览器给的 8 个码 + 本仓自己产生的 3 个。
 * `unsupported` / `truncated` / `startFailed` 不是浏览器码，
 * 但它们是用户真的会撞上的三种失败，同样不许被一句「语音失败了」吞掉。
 */
export type VoiceReason = VoiceBrowserErrorCode | "unsupported" | "truncated" | "startFailed";

/** 三个状态：空闲 / 听中 / 出错。没有第四个「装听中」——那正是要禁掉的假状态。 */
export type VoicePhase = "idle" | "listening" | "error";

export interface VoiceState {
  /** 降级判定结果：内核有没有实现语音识别。定下来就不再变。 */
  readonly supported: boolean;
  readonly phase: VoicePhase;
  /** 中间结果：正在变、还没定稿的那一句（只做轻量显示，不落进输入框）。 */
  readonly interim: string;
  /** 当前这一轮的理由：出错码、没听到声音、或「被上限截掉了」。null = 没有话要说。 */
  readonly reason: VoiceReason | null;
  /** 只给 `startFailed` 用的补充（浏览器当场抛的那个错名）。别的理由不填。 */
  readonly detail: string;
}

export const IDLE_VOICE_STATE: VoiceState = {
  supported: true,
  phase: "idle",
  interim: "",
  reason: null,
  detail: ""
};

/** 识别参数：任务拍板的默认值，连续 + 出中间结果。
 *  `maxAlternatives: 1` 是**去重的一半**——只取第 0 个候选，别的候选不是「另一种可能」，
 *  是同一句话的另外几种猜法，全拼进去等于同一段文字出现好几遍。 */
export const VOICE_RECOGNITION_DEFAULTS: Readonly<{
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
}> = Object.freeze({
  lang: "zh-CN",
  continuous: true,
  interimResults: true,
  maxAlternatives: 1
});

/** 识别段落之间的分隔：换行。理由见本文件抬头 ①。 */
export const VOICE_SEGMENT_BREAK = "\n";

/**
 * 错误码 → 看得见的中文。
 * `Record<VoiceReason, string>` 而不是 `Partial<Record<…>>`：新码没写文案时 tsc 当场拒绝编译，
 * 不会出现「点一下只回一句『语音失败了』」的漏网状态。
 */
export const VOICE_REASON_TEXT: Record<VoiceReason, string> = {
  aborted: "识别被中断了，这一段没接住。再点一次麦克风重说。",
  "audio-capture": "没打开麦克风，或这台机器上没有可用的录音设备。",
  "language-not-supported": "本机的识别服务不支持中文（zh-CN）这一路。",
  network: "连不上识别服务——Web Speech 的识别走网络、不是本机算的，断网或被代理挡了就认不出字。",
  "no-speech": "没听到声音。",
  "not-allowed": "麦克风权限被拒。到系统的隐私设置里放行麦克风，再点一次。",
  "phrases-not-supported": "本机的识别服务不支持「连续短句」这种识别方式。",
  "service-not-allowed": "这台机器上语音识别服务被禁用了（不是权限被拒，是服务本身没开）。",
  startFailed: "语音识别没能启动，浏览器当场拒了这次开启。换个带识别服务的内核再试。",
  truncated: `到输入上限（${USER_TEXT_MAX_LEN} 字）了，后面这段没接住——先删一点再继续说。`,
  unsupported:
    "这个内核没有提供语音识别接口（识别要引擎那一侧带服务，Chromium 未必带）。换 Chrome / Edge 打开本作品目录才能用。"
};

/**
 * 真机实测（2026-10-06 批次 5-⑧，Electron 42.5 / Chromium 148，CDP 里跑）：
 * `SpeechRecognition` 与 `webkitSpeechRecognition` **都在**，构造成功，`start()` 成功，
 * `onstart` → `audiostart` 都会来（麦克风真开了），随后 9 秒静默收到 `no-speech` + `end`。
 * **没有** `network` / `service-not-allowed` —— 也就是识别服务是通的，不存在「Electron 一律用不了」那回事。
 *
 * 顺带量到一条会影响体验的事实：**引擎在 `no-speech` 之后自己 `end`**（麦克风交还），
 * 哪怕设了 `continuous = true`。所以「安静一会儿」= 这一轮结束，不是「还在听」。
 * `voiceErrorOutcome` 对 `no-speech` 返回 `stay` 仍是对的（别的内核不一定立刻 end），
 * 而 `onend` 会把状态收回空闲——两条合起来，用户看到的是「没听到声音。」而不是永远停在「还在听」。
 * **未验证的部分**：真人的识别准确率与中文标点表现本轮无法测（探针里没人说话）。
 */

/** 听中的常驻说明。**必须把「不给标点」说出来**：否则用户会以为识别把标点也丢了。 */
export const VOICE_LISTEN_HINT =
  "在听。说完再点一次麦克风停止；识别不给标点，每段落一行，标点得自己补。";

/** 引擎报 `no-speech` 但会话还活着时说的话：别把「安静」说成「坏了」。 */
export const VOICE_LISTEN_NO_SPEECH = "没听到声音，还在听。";

/**
 * 收到一个 error 事件之后，这一轮该怎么办。
 * `ignore`：不是给用户看的（`aborted` 是我们自己 abort 出来的，拿它报错是冤枉人）。
 * `stay`：会话还活着（`no-speech` 在 continuous 下只是「这一段没听到」）。
 * `stop`：这一轮真的完了，按钮回到可按的出错态。
 */
export type VoiceErrorOutcome = "ignore" | "stay" | "stop";

export function voiceErrorOutcome(code: VoiceBrowserErrorCode): VoiceErrorOutcome {
  if (code === "aborted") return "ignore";
  if (code === "no-speech") return "stay";
  return "stop";
}

// ───────────────────────── 识别结果的读取（只读，不改引擎给的对象） ─────────────────────────

/** 结果条目：lib.dom 那几个类型的**最小结构子集**（只声明本文件真读的成员）。 */
export interface VoiceAlternative {
  readonly transcript: string;
}
export interface VoiceResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): VoiceAlternative;
}
export interface VoiceResultList {
  readonly length: number;
  item(index: number): VoiceResult;
}
export interface VoiceResultEvent {
  readonly resultIndex: number;
  readonly results: VoiceResultList;
}
/** 错误事件：只取 `error` 那个码（`message` 是英文原文，搬进中文界面只是噪声）。 */
export interface VoiceErrorEvent {
  readonly error: VoiceBrowserErrorCode;
}

export interface VoiceTranscripts {
  /** 本次新定稿的句子，已去掉空段。每一项是一段独立的话。 */
  readonly finals: string[];
  /** 本次还在变的那一句（显示用）。 */
  readonly interim: string;
  /**
   * 下一轮从哪一条开始扫（**含**）。
   * 这是去重的根据：`continuous` 模式下 `results` 只增不减，引擎会把同一条结果
   * 在后续事件里再发一次；不按下标记账就会把同一句话反复追加进输入框。
   */
  readonly nextIndex: number;
}

/** 归一化一段识别文本：去首尾空白，并把内部的空白串（含全角空格）压成一个空格。 */
export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 从 `event.results` 里取出「还没消费过的那部分」。
 * 从 `fromIndex` 起扫而不是只扫 `event.resultIndex`：引擎偶尔把下标发得比实际变更滞后，
 * 少扫一句就等于**丢字**——「不丢」比「不多」优先。
 */
export function voiceTranscriptsFrom(
  results: VoiceResultList,
  fromIndex: number
): VoiceTranscripts {
  const finals: string[] = [];
  let interim = "";
  let nextIndex = Math.max(0, fromIndex);
  for (let i = Math.max(0, fromIndex); i < results.length; i += 1) {
    const result = results.item(i);
    const text = normalizeTranscript(result.item(0).transcript);
    if (result.isFinal) {
      // isFinal 是终态：哪怕这次是空的也要把游标推过去，否则它会被永远重扫。
      nextIndex = i + 1;
      if (text !== "") finals.push(text);
    } else if (text !== "") {
      interim = interim === "" ? text : `${interim} ${text}`;
    }
  }
  return { finals, interim, nextIndex };
}

// ───────────────────────────────────── 追加与截断 ─────────────────────────────────────

export interface VoiceAppendInput {
  /** 输入框现有值。 */
  readonly current: string;
  /** 本次新定稿的句子。 */
  readonly incoming: readonly string[];
}

export interface VoiceAppendResult {
  /** 追加后应当写回输入框的值。 */
  readonly text: string;
  /** 有没有内容被 `USER_TEXT_MAX_LEN` 截掉（上限本来就已经超了也算）。 */
  readonly truncated: boolean;
  /** 值真的变了没有（全是空的、或早就满了，都该是 false）。 */
  readonly added: boolean;
}

function capByCodePoints(text: string): string {
  if (codePointLength(text) <= USER_TEXT_MAX_LEN) return text;
  return Array.from(text).slice(0, USER_TEXT_MAX_LEN).join("");
}

/**
 * 把新识别的句子追加到输入框现有值后面。
 * 段与段之间落一个换行（抬头 ①），并按 `USER_TEXT_MAX_LEN` 截断——
 * 与 `composerCounter` / 主进程那条 zod 边界同一个常量，计数条与拒发口径不会分裂。
 */
export function appendRecognizedText(input: VoiceAppendInput): VoiceAppendResult {
  const segments = input.incoming.map(normalizeTranscript).filter((text) => text !== "");
  if (segments.length === 0) return { text: input.current, truncated: false, added: false };

  let text = input.current;
  for (const segment of segments) {
    text =
      text === "" || text.endsWith(VOICE_SEGMENT_BREAK)
        ? `${text}${segment}`
        : `${text}${VOICE_SEGMENT_BREAK}${segment}`;
  }
  const capped = capByCodePoints(text);
  return {
    text: capped,
    truncated: capped !== text,
    // 早就填满时 capped === current ⇒ added:false，调用方不该白写一次。
    added: capped !== input.current
  };
}

// ─────────────────────────────── 视图判定（按钮 / 提示行） ───────────────────────────────

export interface VoiceButtonView {
  readonly disabled: boolean;
  readonly label: string;
  readonly pressed: boolean;
  /** 录音态：只给样式看的两态，`.vue` 不自己判。 */
  readonly recording: boolean;
  readonly title: string;
}

/**
 * 那一枚麦克风按钮的全部属性。
 * 降级时 **disabled 是有意的**：按钮不许画成可点、点了没反应；理由由 `voiceHintView`
 * 摆在卡下那行看得见的提示里（Chromium 还不给 disabled 元素弹 title，靠 title 兜就是没有理由）。
 */
export function voiceButtonView(
  state: VoiceState,
  context: { readonly running: boolean }
): VoiceButtonView {
  if (!state.supported) {
    return {
      disabled: true,
      label: "语音输入（本机不支持）",
      pressed: false,
      recording: false,
      title: "本机内核没有实现语音识别，按不了；理由写在卡下那行提示里。"
    };
  }
  if (context.running) {
    return {
      disabled: true,
      label: "语音输入（本轮生成中）",
      pressed: false,
      recording: false,
      title: "这一轮正在生成，先不让麦克风开着——这一轮结束时再说。"
    };
  }
  if (state.phase === "listening") {
    return {
      disabled: false,
      label: "停止语音输入",
      pressed: true,
      recording: true,
      title: "正在听。再点一次停止，已经说出口的字会留在输入框里。"
    };
  }
  return {
    disabled: false,
    label: "语音输入",
    pressed: false,
    recording: false,
    title: "点一下开始语音输入（连续听，再点一次停止）。"
  };
}

export interface VoiceHintView {
  readonly text: string;
  /** 只给样式看的两态，`.vue` 不自己判（与 `composer-counter--over` 同一手法）。 */
  readonly warn: boolean;
}

/**
 * 卡下那行可见提示。文案与出现与否全部在这里定：
 * 空串 = 这一格不占位（没有话可说的时候不占高度）。
 */
export function voiceHintView(state: VoiceState): VoiceHintView {
  if (!state.supported) return { text: VOICE_REASON_TEXT.unsupported, warn: true };
  if (state.phase === "error") {
    const reason = state.reason ?? "aborted";
    const detail = state.detail === "" ? "" : `（${state.detail}）`;
    return { text: `${VOICE_REASON_TEXT[reason]}${detail}`, warn: true };
  }
  if (state.phase === "listening") {
    const heard = state.interim === "" ? "" : `听到：「${state.interim}」`;
    // 截断是「这一刻丢了字」，它压过常驻那句：不然用户刚说完一段、末段被上限截掉，
    // 屏幕上却还是「在听…」，等于没告诉他。录音钮此刻是红的，「还在听」那一事实没丢。
    if (state.reason === "truncated") {
      return { text: `${VOICE_REASON_TEXT.truncated}${heard}`, warn: true };
    }
    const base = state.reason === "no-speech" ? VOICE_LISTEN_NO_SPEECH : VOICE_LISTEN_HINT;
    return { text: heard === "" ? base : `${base}${heard}`, warn: false };
  }
  if (state.reason === null) return { text: "", warn: false };
  return { text: VOICE_REASON_TEXT[state.reason], warn: state.reason === "truncated" };
}

// ─────────────────────────────────── 识别会话（生命周期） ───────────────────────────────────

/**
 * 识别器形状。
 *
 * 四个 `on*` 的**参数必须留着**（哪怕一个都不读）：真实引擎的类型是
 * `(ev) => unknown`，而「参数少的函数能塞进参数多的位置」反过来不成立——
 * 声明成 `() => void` 的话，真实 `SpeechRecognition` 连赋都赋不过来（TS2322 会在
 * `useVoiceInput` 那一行炸）。事件类型取各族的最小结构子集，`SpeechRecognitionErrorEvent`
 * / `SpeechRecognitionEvent` 都装得进去（env.d.ts 那份 ambient 声明的接缝就在这一行被 tsc 咬住）。
 */
export interface VoiceRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  /** 优雅停止：让最后一段定稿落地。 */
  stop(): void;
  /** 立刻掐掉：交还麦克风，不留后台（卸载/开始生成时走这条）。 */
  abort(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: VoiceErrorEvent) => void) | null;
  onresult: ((ev: VoiceResultEvent) => void) | null;
}

export type VoiceRecognizerFactory = () => VoiceRecognizer;

type VoiceRecognizerCtor = new () => VoiceRecognizer;

/** 降级判定看的就是这两个名字；两者都没有 ⇒ 本机内核没实现识别。 */
export interface VoiceScope {
  readonly SpeechRecognition?: VoiceRecognizerCtor | undefined;
  readonly webkitSpeechRecognition?: VoiceRecognizerCtor | undefined;
}

/**
 * 降级判定：`SpeechRecognition` 与 `webkitSpeechRecognition` 都没有就返回 null。
 * 传 scope 而不是读全局，是为了能单测「两种都没有」这一支——
 * 它在 Electron 上是常态，必须被测到，不能只靠真机。
 */
export function voiceRecognizerFactory(scope: VoiceScope): VoiceRecognizerFactory | null {
  const ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (ctor === undefined || ctor === null) return null;
  return () => new ctor();
}

export interface VoiceSessionDeps {
  /** null = 本机内核不支持（会话仍然建得出来，只是 start 永远不动）。 */
  readonly create: VoiceRecognizerFactory | null;
  readonly onState: (next: VoiceState) => void;
  /** 一次事件里新定稿的句子：交给上层按 `appendRecognizedText` 追加。 */
  readonly onFinal: (segments: readonly string[]) => void;
}

export interface VoiceSession {
  readonly state: VoiceState;
  /** 再点一次开始听；已经在听 / 本机不支持时是空操作。 */
  start(): void;
  /** 用户主动停：优雅停，让最后一段落地。 */
  stop(): void;
  /** 拆除（组件卸载 / 这一轮开始生成）：立刻 abort，不留后台麦克风。 */
  dispose(): void;
  /** 上层回报「这次追加被上限截掉了」，把理由摆到提示行。 */
  noteTruncated(): void;
}

/**
 * 一段语音识别会话。这里只管「引擎说什么 → 状态怎么变、哪些句子是新定稿的」；
 * 追加与截断的判定在上层的 `appendRecognizedText` 里（它要读输入框现有值）。
 */
export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  let state: VoiceState = { ...IDLE_VOICE_STATE, supported: deps.create !== null };
  let recognizer: VoiceRecognizer | null = null;
  /** 已经消费到第几条结果：去重的账本（见 `VoiceTranscripts.nextIndex`）。 */
  let consumed = 0;

  function patch(next: Partial<VoiceState>): void {
    state = { ...state, ...next };
    deps.onState(state);
  }

  /** 摘掉句柄并摘掉回调：迟到的 onend/onresult 写不进已经拆掉的会话。 */
  function release(): void {
    const rec = recognizer;
    recognizer = null;
    if (rec === null) return;
    rec.onstart = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onresult = null;
  }

  function wire(rec: VoiceRecognizer): void {
    rec.lang = VOICE_RECOGNITION_DEFAULTS.lang;
    rec.continuous = VOICE_RECOGNITION_DEFAULTS.continuous;
    rec.interimResults = VOICE_RECOGNITION_DEFAULTS.interimResults;
    rec.maxAlternatives = VOICE_RECOGNITION_DEFAULTS.maxAlternatives;
    rec.onresult = (event) => {
      const taken = voiceTranscriptsFrom(event.results, consumed);
      consumed = taken.nextIndex;
      if (taken.interim !== state.interim) patch({ interim: taken.interim });
      if (taken.finals.length === 0) return;
      // 先清上一句的理由再交上去：上层追加完可能马上回一句「被上限截了」，
      // 顺序反了会把那句截断提示一起清掉。
      if (state.reason !== null) patch({ reason: null });
      deps.onFinal(taken.finals);
      if (taken.interim === "") patch({ interim: "" });
    };
    rec.onerror = (event) => {
      const outcome = voiceErrorOutcome(event.error);
      if (outcome === "ignore") return;
      if (outcome === "stay") {
        patch({ reason: event.error });
        return;
      }
      // 这一轮到此为止：交还句柄，但**不**替引擎调 stop()/abort()——
      // 它自己在 error 之后会走 onend，多调一次只会再引一个 aborted 事件。
      release();
      patch({ phase: "error", reason: event.error, interim: "" });
    };
    rec.onend = () => {
      if (recognizer === null) return;
      // 出错后的 onend 不能把已经报给用户的理由擦掉。
      const wasError = state.phase === "error";
      release();
      if (!wasError) patch({ phase: "idle", interim: "" });
    };
  }

  return {
    get state() {
      return state;
    },
    start() {
      if (deps.create === null || recognizer !== null) return;
      consumed = 0;
      const rec = deps.create();
      wire(rec);
      recognizer = rec;
      patch({ phase: "listening", interim: "", reason: null, detail: "" });
      try {
        rec.start();
      } catch (error) {
        // 同步抛出来的那一支（非安全上下文、引擎当场拒绝）：报看得见的理由，不留半个会话。
        release();
        patch({
          phase: "error",
          reason: "startFailed",
          interim: "",
          detail: error instanceof Error ? error.name : ""
        });
      }
    },
    stop() {
      if (recognizer === null) return;
      // 优雅停：还没定稿的那一段由引擎补上 onresult，再由 onend 收回空闲态。
      recognizer.stop();
      patch({ interim: "" });
    },
    dispose() {
      if (recognizer === null) return;
      // 掐断而不是优雅停：卸载/开始生成时要把麦克风**立刻**交还，
      // 那半句没定稿的本来也还没进输入框，丢掉不算丢字。
      recognizer.abort();
      release();
      patch({ phase: "idle", interim: "" });
    },
    noteTruncated() {
      if (state.reason !== null) return;
      patch({ reason: "truncated" });
    }
  };
}

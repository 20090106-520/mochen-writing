/**
 * 语音输入纯逻辑的单测（真身：`composables/voice-input.ts`）。
 *
 * 为什么能测：`voice-input.ts` 不 import Vue、不碰 DOM、不读全局——
 * 识别器是注入进来的假对象，所以「本机内核不支持」「引擎报 not-allowed」
 * 「同一句话被引擎重发」这些真机上极难复现的分支，这里都能钉死。
 * `.vue` 那边的接线由 components/composer-voice-wiring.test.ts 读源码钉，本文件不碰组件。
 *
 * **注意 Electron 上最常见的那个事实**：本仓自带的 Chromium 没实现语音识别，
 * 所以「不支持」那一支才是真机常态——它必须被单测钉住，不能只靠真机观察。
 */
import { describe, expect, it } from "vitest";
import { USER_TEXT_MAX_LEN } from "@mochen/contracts";
import {
  IDLE_VOICE_STATE,
  VOICE_RECOGNITION_DEFAULTS,
  VOICE_SEGMENT_BREAK,
  appendRecognizedText,
  createVoiceSession,
  normalizeTranscript,
  voiceButtonView,
  voiceErrorOutcome,
  voiceHintView,
  voiceRecognizerFactory,
  voiceTranscriptsFrom,
  type VoiceErrorEvent,
  type VoiceReason,
  type VoiceRecognizer,
  type VoiceResultEvent,
  type VoiceResultList
} from "./voice-input";

// ───────────────────────────────── 假识别器 ─────────────────────────────────

/** 假的结果列表：只实现 `length` 与 `item()`（`VoiceResultList` 就只要求这两个成员）。 */
function resultList(items: readonly { readonly isFinal: boolean; readonly text: string }[]) {
  const list: VoiceResultList = {
    length: items.length,
    item: (index: number) => {
      const found = items[index];
      if (found === undefined) throw new RangeError(`假结果列表没有第 ${index} 条`);
      const alternative = { transcript: found.text };
      return {
        isFinal: found.isFinal,
        length: 1,
        item: (i: number) => {
          if (i !== 0) throw new RangeError("假结果只放了第 0 个候选");
          return alternative;
        }
      };
    }
  };
  return list;
}

/**
 * 假识别器。它同时是**可构造的**（`new FakeRecognizer()` 正好满足降级判定要的那个构造器类型），
 * 这样降级判定那一支也能不靠 `as` 就测到。
 */
class FakeRecognizer implements VoiceRecognizer {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  started = 0;
  stopped = 0;
  aborted = 0;
  onstart: ((ev: Event) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;
  onerror: ((event: VoiceErrorEvent) => void) | null = null;
  onresult: ((event: VoiceResultEvent) => void) | null = null;

  start(): void {
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
  abort(): void {
    this.aborted += 1;
  }
  fireStart(): void {
    this.onstart?.(new Event("start"));
  }
  fireEnd(): void {
    this.onend?.(new Event("end"));
  }
  fireError(code: SpeechRecognitionErrorCode): void {
    this.onerror?.({ error: code });
  }
  fireResult(results: VoiceResultList, resultIndex = 0): void {
    this.onresult?.({ resultIndex, results });
  }
}

/** 会话 + 假识别器 + 已落地句子的台账：一处起头，下面每条都从这里取。 */
function harness() {
  const rec = new FakeRecognizer();
  const finals: string[][] = [];
  const session = createVoiceSession({
    create: () => rec,
    onState: () => {},
    onFinal: (segments) => finals.push([...segments])
  });
  return { rec, session, finals };
}

// ───────────────────────────── 降级判定 ─────────────────────────────

describe("降级判定：两个名字都没有就是不支持（Electron 的常态，不是边角）", () => {
  it("两个都没有 ⇒ null（不给它一个永远不动的假会话）", () => {
    expect(voiceRecognizerFactory({})).toBeNull();
    expect(voiceRecognizerFactory({ SpeechRecognition: undefined })).toBeNull();
    expect(
      voiceRecognizerFactory({ SpeechRecognition: undefined, webkitSpeechRecognition: undefined })
    ).toBeNull();
  });

  it("标准名或前缀名任一存在就能造出识别器", () => {
    expect(voiceRecognizerFactory({ SpeechRecognition: FakeRecognizer })?.()).toBeInstanceOf(
      FakeRecognizer
    );
    expect(voiceRecognizerFactory({ webkitSpeechRecognition: FakeRecognizer })?.()).toBeInstanceOf(
      FakeRecognizer
    );
  });

  it("不支持时按钮是禁用的（不许画成可点、点了没反应），理由摆在看得见的提示行里", () => {
    const session = createVoiceSession({ create: null, onState: () => {}, onFinal: () => {} });
    expect(session.state.supported).toBe(false);
    const button = voiceButtonView(session.state, { running: false });
    expect(button.disabled).toBe(true);
    expect(button.recording).toBe(false);
    const hint = voiceHintView(session.state);
    // 文案在 5-⑧ 真机实测后改过一次：原文写「Electron 里用不了」，
    // 实测（Electron 42.5 / Chromium 148）API 在、构造成功、start 成功、麦克风真开了，
    // 只有静默才收到 no-speech + end——所以那句「一律用不了」是假的，已改成只说接口层面的话。
    expect(hint.text).toContain("没有提供语音识别接口");
    expect(hint.text).not.toContain("Electron 自带的 Chromium 里用不了");
    expect(hint.text).toContain("Chromium");
    expect(hint.warn).toBe(true);
  });

  it("不支持的会话 start 是空操作：不会凭空造出一个引擎，状态也不许假装在听", () => {
    const session = createVoiceSession({ create: null, onState: () => {}, onFinal: () => {} });
    session.start();
    expect(session.state.phase).toBe("idle");
    expect(voiceButtonView(session.state, { running: false }).recording).toBe(false);
    expect(voiceHintView(session.state).text).not.toBe("");
  });
});

// ───────────────────────────── 状态机与停止路径 ─────────────────────────────

describe("会话：空闲 / 听中 / 出错，以及每一条停止路径", () => {
  it("默认参数就是任务拍板的那一套：连续 + 出中间结果 + 只取第 0 个候选 + 中文", () => {
    const { rec, session } = harness();
    session.start();
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.maxAlternatives).toBe(1);
    expect(rec.lang).toBe("zh-CN");
    expect(VOICE_RECOGNITION_DEFAULTS.continuous).toBe(true);
    expect(VOICE_RECOGNITION_DEFAULTS.interimResults).toBe(true);
  });

  it("start 后是听中，按钮变录音态；stop 走优雅停（stop 而非 abort），引擎 end 后回空闲", () => {
    const { rec, session } = harness();
    session.start();
    expect(session.state.phase).toBe("listening");
    const listening = voiceButtonView(session.state, { running: false });
    expect(listening.recording).toBe(true);
    expect(listening.pressed).toBe(true);
    expect(listening.disabled).toBe(false);
    expect(listening.label).toBe("停止语音输入");

    session.stop();
    expect(rec.stopped).toBe(1);
    expect(rec.aborted).toBe(0);
    rec.fireEnd();
    expect(session.state.phase).toBe("idle");
    expect(voiceButtonView(session.state, { running: false }).recording).toBe(false);
  });

  it("dispose 走 abort 并摘掉回调：迟到的 onend/onresult 写不进已经拆掉的会话", () => {
    const { rec, session, finals } = harness();
    session.start();
    session.dispose();
    expect(rec.aborted).toBe(1);
    expect(rec.onresult).toBeNull();
    expect(rec.onend).toBeNull();
    expect(session.state.phase).toBe("idle");
    rec.fireResult(resultList([{ isFinal: true, text: "迟到的字" }]));
    expect(finals).toEqual([]);
  });

  it("再点一次不会开出第二段会话（已在听时 start 是空操作）", () => {
    const { rec, session } = harness();
    session.start();
    session.start();
    expect(rec.started).toBe(1);
  });

  it("这一轮开始生成时按钮禁用（忙态不许留着一颗开着的麦克风）", () => {
    const { session } = harness();
    session.start();
    const busy = voiceButtonView(session.state, { running: true });
    expect(busy.disabled).toBe(true);
    expect(busy.recording).toBe(false);
    expect(busy.title).toContain("正在生成");
  });

  it("start 同步抛错也报看得见的理由，不留半个「听中」的假状态", () => {
    const rec = new FakeRecognizer();
    rec.start = () => {
      const denied = new Error("denied");
      denied.name = "NotAllowedError";
      throw denied;
    };
    const session = createVoiceSession({
      create: () => rec,
      onState: () => {},
      onFinal: () => {}
    });
    session.start();
    expect(session.state.phase).toBe("error");
    expect(session.state.reason).toBe("startFailed");
    const hint = voiceHintView(session.state);
    expect(hint.text).toContain("没能启动");
    expect(hint.text).toContain("NotAllowedError");
    expect(voiceButtonView(session.state, { running: false }).disabled).toBe(false);
  });

  it("引擎自己走完 onend（没报错）时回空闲；出错后的 onend 不擦掉已经报给用户的理由", () => {
    const quiet = harness();
    quiet.session.start();
    quiet.rec.fireEnd();
    expect(quiet.session.state.phase).toBe("idle");

    const failing = harness();
    failing.session.start();
    failing.rec.fireError("not-allowed");
    expect(failing.session.state.phase).toBe("error");
    expect(failing.session.state.reason).toBe("not-allowed");
    failing.rec.fireEnd();
    // 引擎在 error 之后必定还会走一次 end：这一次不许把理由擦掉，否则用户刚看到的错就没了。
    expect(failing.session.state.phase).toBe("error");
    expect(voiceHintView(failing.session.state).text).toContain("麦克风权限被拒");
  });
});

// ───────────────────────────── 错误码翻人话 ─────────────────────────────

describe("错误码：八个码各自一句人话，不许被一句「语音失败了」吞掉", () => {
  it("任务点名的三个码各自说各自的理由", () => {
    const cases: [VoiceReason, string][] = [
      ["not-allowed", "麦克风权限被拒"],
      ["no-speech", "没听到声音"],
      ["network", "连不上识别服务"]
    ];
    for (const [code, needle] of cases) {
      const text = voiceHintView({ ...IDLE_VOICE_STATE, phase: "error", reason: code }).text;
      expect(text, `error 事件要原样翻成人话，${code} 这一支没有`).toContain(needle);
      expect(text).not.toContain("语音失败了");
    }
  });

  it("network 那句必须说清「识别走网络」——这是 Web Speech 本身带来的限制，不是我们的实现问题", () => {
    const text = voiceHintView({ ...IDLE_VOICE_STATE, phase: "error", reason: "network" }).text;
    expect(text).toContain("走网络");
  });

  it("no-speech 不结束会话：还在听，只把「没听到」摆出来（安静不等于坏）", () => {
    expect(voiceErrorOutcome("no-speech")).toBe("stay");
    const { rec, session, finals } = harness();
    session.start();
    rec.fireError("no-speech");
    expect(session.state.phase).toBe("listening");
    expect(session.state.reason).toBe("no-speech");
    expect(voiceHintView(session.state).text).toContain("还在听");
    // 会话还活着 ⇒ 后面说的话照样能落进输入框。
    rec.fireResult(resultList([{ isFinal: true, text: "现在听到了" }]));
    expect(finals).toEqual([["现在听到了"]]);
    expect(session.state.reason).toBeNull();
  });

  it("aborted 是我们自己 abort 出来的，不拿它当错误报给用户", () => {
    expect(voiceErrorOutcome("aborted")).toBe("ignore");
    const { rec, session } = harness();
    session.start();
    rec.fireError("aborted");
    expect(session.state.phase).toBe("listening");
  });

  it("除 aborted 与 no-speech 外，剩下六个码都终止这一轮", () => {
    const stops = [
      "audio-capture",
      "language-not-supported",
      "network",
      "not-allowed",
      "phrases-not-supported",
      "service-not-allowed"
    ] as const;
    for (const code of stops) expect(voiceErrorOutcome(code)).toBe("stop");
  });

  it("每一条终止型错误都写得出看得见的理由，不留空串", () => {
    const reasons: VoiceReason[] = [
      "aborted",
      "audio-capture",
      "language-not-supported",
      "network",
      "no-speech",
      "not-allowed",
      "phrases-not-supported",
      "service-not-allowed",
      "startFailed",
      "truncated",
      "unsupported"
    ];
    for (const code of reasons) {
      const view = voiceHintView({ ...IDLE_VOICE_STATE, phase: "error", reason: code });
      expect(view.text.length, `${code} 没有文案`).toBeGreaterThan(4);
      expect(view.warn).toBe(true);
    }
  });
});

// ───────────────────────── 读结果 / 去重 / 不丢字 ─────────────────────────

describe("读识别结果：同一段话不追加两次，迟到的旧结果不丢字", () => {
  it("中间结果只做显示，不落进 finals", () => {
    const taken = voiceTranscriptsFrom(
      resultList([
        { isFinal: false, text: "今天" },
        { isFinal: false, text: "今天写" }
      ]),
      0
    );
    expect(taken.finals).toEqual([]);
    expect(taken.interim).toBe("今天 今天写");
    expect(taken.nextIndex).toBe(0);
  });

  it("定稿的那条从 nextIndex 起就不再被扫第二遍（去重）", () => {
    const first = voiceTranscriptsFrom(resultList([{ isFinal: true, text: "写一段" }]), 0);
    expect(first.finals).toEqual(["写一段"]);
    expect(first.nextIndex).toBe(1);
    // 引擎在 continuous 下会把同一条结果再发一次：这次必须什么都不产出。
    const again = voiceTranscriptsFrom(
      resultList([
        { isFinal: true, text: "写一段" },
        { isFinal: true, text: "接着写" }
      ]),
      first.nextIndex
    );
    expect(again.finals).toEqual(["接着写"]);
  });

  it("同一条从中间结果变成定稿：中间那次的字被定稿这一次接走（不丢字也不重复）", () => {
    // 引擎是**原地翻面**：同一个下标从 isFinal:false 变成 true，不是新增一条。
    const interim = voiceTranscriptsFrom(resultList([{ isFinal: false, text: "写一段" }]), 0);
    expect(interim.interim).toBe("写一段");
    expect(interim.nextIndex).toBe(0);
    const final = voiceTranscriptsFrom(resultList([{ isFinal: true, text: "写一段" }]), 0);
    expect(final.finals).toEqual(["写一段"]);
    expect(final.nextIndex).toBe(1);
  });

  it("下标发得比实际变更滞后时照扫：宁可多扫也不丢字（不丢优先于不多）", () => {
    const taken = voiceTranscriptsFrom(
      resultList([
        { isFinal: true, text: "第一句" },
        { isFinal: true, text: "第二句" }
      ]),
      0
    );
    // 引擎这次把 resultIndex 报成 1（只说「第 1 条变了」），第 0 条仍要被取走。
    expect(taken.finals).toEqual(["第一句", "第二句"]);
  });

  it("定稿但空白的条目也要推进游标：否则它会被永远重扫", () => {
    const taken = voiceTranscriptsFrom(resultList([{ isFinal: true, text: "   " }]), 0);
    expect(taken.finals).toEqual([]);
    expect(taken.nextIndex).toBe(1);
  });

  it("**会话级**去重：引擎把同一条定稿重发一次，输入框里只该多一段", () => {
    // 上一条只钉了纯函数；这里钉的是会话自己那份游标账本——
    // 把 `consumed = taken.nextIndex` 改成 `consumed = 0`（变异实测）时，只有这条会红。
    const { rec, session, finals } = harness();
    session.start();
    rec.fireResult(resultList([{ isFinal: true, text: "写一段" }]));
    // 引擎在 continuous 下把结果列表留着，同一条会被后续事件再发一次。
    rec.fireResult(
      resultList([
        { isFinal: true, text: "写一段" },
        { isFinal: true, text: "接着写" }
      ]),
      0
    );
    expect(finals).toEqual([["写一段"], ["接着写"]]);
  });

  it("中间结果会清空：定稿之后不留上一句的残影", () => {
    const { rec, session, finals } = harness();
    session.start();
    rec.fireResult(resultList([{ isFinal: false, text: "说一句" }]));
    expect(session.state.interim).toBe("说一句");
    rec.fireResult(resultList([{ isFinal: true, text: "说一句" }]));
    expect(finals).toEqual([["说一句"]]);
    expect(session.state.interim).toBe("");
  });

  it("归一化：去首尾空白、内部空白串（含全角空格）压成一个", () => {
    expect(normalizeTranscript("  你好   世界 ")).toBe("你好 世界");
    expect(normalizeTranscript("你好　　世界")).toBe("你好 世界");
    expect(normalizeTranscript("\n")).toBe("");
  });
});

// ───────────────────────────── 追加 / 截断 ─────────────────────────────

describe("追加与截断：上限与主进程边界同一个常量", () => {
  it("空草稿 + 一句 ⇒ 原样落进去，不多写分隔符", () => {
    expect(appendRecognizedText({ current: "", incoming: ["你好"] })).toEqual({
      text: "你好",
      truncated: false,
      added: true
    });
  });

  it("分句：一段一行，不替用户编标点（zh-CN 识别本身不给标点）", () => {
    const out = appendRecognizedText({ current: "", incoming: ["第一句", "第二句"] });
    expect(out.text).toBe(`第一句${VOICE_SEGMENT_BREAK}第二句`);
    expect(out.text).not.toContain("。");
  });

  it("接在手打文字后面也是新起一行，不粘成一片", () => {
    const out = appendRecognizedText({ current: "手打的半句", incoming: ["说出来的半句"] });
    expect(out.text).toBe("手打的半句\n说出来的半句");
  });

  it("草稿已经以换行结尾时不叠出空行", () => {
    const out = appendRecognizedText({ current: "上一次的\n", incoming: ["这一句"] });
    expect(out.text).toBe("上一次的\n这一句");
  });

  it("全是空白的新内容：既不写回也不算截断（added:false 是调用方不白写的凭据）", () => {
    expect(appendRecognizedText({ current: "已有", incoming: ["", "   "] })).toEqual({
      text: "已有",
      truncated: false,
      added: false
    });
  });

  it("识别文本按码点算：一个 emoji 算一个字，且截断不会把代理对劈成半个乱码", () => {
    // 19998 字 + 段间换行 1 格 = 19999，第一个 emoji 正好占第 20000 格，第二个被截掉。
    const many = "字".repeat(USER_TEXT_MAX_LEN - 2);
    const out = appendRecognizedText({ current: many, incoming: ["🙂🙂"] });
    expect(out.text).toBe(`${many}${VOICE_SEGMENT_BREAK}🙂`);
    expect(out.truncated).toBe(true);
    // 半个代理对（孤立的高/低代理项）正是「按 UTF-16 截」会留下的东西：emoji 完整才算过。
    expect([...out.text].at(-1)).toBe("🙂");
    expect(out.text.includes("\uFFFD")).toBe(false);
  });

  it("超上限就截断并报出来（超了要截断、也要让用户知道）", () => {
    const full = "字".repeat(USER_TEXT_MAX_LEN);
    const out = appendRecognizedText({ current: full, incoming: ["再来一句"] });
    expect(out.text).toBe(full);
    expect(out.truncated).toBe(true);
    expect(out.added).toBe(false);
    const view = voiceHintView({ ...IDLE_VOICE_STATE, reason: "truncated" });
    expect(view.text).toContain(String(USER_TEXT_MAX_LEN));
    expect(view.warn).toBe(true);
  });

  it("会话回报截断后，提示行说得出「后面这段没接住」", () => {
    const rec = new FakeRecognizer();
    const full = "字".repeat(USER_TEXT_MAX_LEN);
    // 这里的自引用（onFinal 里用 session）与 useVoiceInput 的写法一致：闭包里读它不会踩 TDZ。
    const session = createVoiceSession({
      create: () => rec,
      onState: () => {},
      onFinal: (segments) => {
        const out = appendRecognizedText({ current: full, incoming: [...segments] });
        if (out.truncated) session.noteTruncated();
      }
    });
    session.start();
    rec.fireResult(resultList([{ isFinal: true, text: "塞不下的半句" }]));
    expect(session.state.reason).toBe("truncated");
    expect(voiceHintView(session.state).text).toContain("没接住");
  });
});

// ───────────────────────── 提示行 / 按钮的其余两态 ─────────────────────────

describe("提示行：没有话要说时不占位，诚实边界写在看得见的地方", () => {
  it("空闲且无理由 ⇒ 空串（这一格不占高度）", () => {
    expect(voiceHintView(IDLE_VOICE_STATE)).toEqual({ text: "", warn: false });
  });

  it("听中时那句常驻说明必须点明「识别不给标点」，否则用户会以为标点被吞了", () => {
    const view = voiceHintView({ ...IDLE_VOICE_STATE, phase: "listening" });
    expect(view.text).toContain("不给标点");
    expect(view.warn).toBe(false);
  });

  it("听中时中间结果看得见（轻量显示，不落进输入框）", () => {
    const view = voiceHintView({
      ...IDLE_VOICE_STATE,
      phase: "listening",
      interim: "写一首"
    });
    expect(view.text).toContain("写一首");
  });

  it("出错态没有 reason 时也不许给空串（宁可说 aborted 那句也不装没事）", () => {
    const view = voiceHintView({ ...IDLE_VOICE_STATE, phase: "error", reason: null });
    expect(view.text.length).toBeGreaterThan(4);
  });
});

/**
 * 语音输入薄壳的**运行期**形状（2026-10-06 批次 5-⑧ 真机补）。
 *
 * **为什么接线测试没抓住**：接线守卫读源码，看到模板里写着 `voice.button.disabled` 就放行。
 * 但 `<script setup>` 只解包 setup 返回值的**顶层** ref；返回 `{ button: computed, … }` 这样一个
 * 普通对象时，模板里的 `voice.button` 仍是那个 ComputedRef，`.disabled` 读出 **`undefined`**——
 * 不抛、不报、tsc 绿、接线守卫绿，真机上那枚按钮却是
 * `<button class="round-tool-button" type="button">`：没有 aria-label、没有 disabled，
 * **点下去什么也不发生**。
 *
 * 这条测试量的就是运行期那一层：返回值上的属性**必须是值本身**（布尔 / 字符串），不是 ref。
 * 这类「源码看着对、运行期是 undefined」的坑，只有把返回值真的取一遍才量得到。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { effectScope, isReactive, isRef } from "vue";
import { useVoiceInput } from "./useVoiceInput";

/** 在一个 effectScope 里跑（onBeforeUnmount 在没有组件实例时只会警告，不会抛）。 */
function inScope<T>(fn: () => T): T {
  const scope = effectScope();
  try {
    return scope.run(fn) as T;
  } finally {
    scope.stop();
  }
}

const source = {
  read: (): string => "",
  write: vi.fn(),
  running: (): boolean => false
};

/** 一枚够用的假识别器：只看「构造成功、那几个方法在」——真机上的行为由 voice-input 的单测覆盖。 */
function fakeRecognizerClass(): unknown {
  return class {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart: unknown = null;
    onend: unknown = null;
    onerror: unknown = null;
    onresult: unknown = null;
    start(): void {}
    stop(): void {}
    abort(): void {}
  };
}

/**
 * 自己 stub `window`，而不是靠测试环境。
 * 两条都要确定性地跑到：这条测试的半条价值就在于「不支持」那支必须被显式造出来，
 * 否则它在 CI 上是碰运气跑到的。
 */
function withWindow(members: Record<string, unknown>): void {
  vi.stubGlobal("window", members);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVoiceInput 的返回值：模板要拿到的是值，不是 ref", () => {
  it("返回值是响应式对象（代理会在取属性时把里面的 ref 解开）", () => {
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput(source));
    expect(isReactive(voice)).toBe(true);
  });

  it("button 不是 ref，且 disabled / pressed / recording 都是布尔", () => {
    // 这一条就是那枚按钮在真机上「没有 aria-label 也没有 disabled」的根因所在。
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput(source));
    expect(isRef(voice.button), "button 必须已经被代理解包").toBe(false);
    expect(typeof voice.button.disabled).toBe("boolean");
    expect(typeof voice.button.pressed).toBe("boolean");
    expect(typeof voice.button.recording).toBe("boolean");
  });

  it("label 与 title 是非空字符串（图标钮的可访问名与悬浮说明）", () => {
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput(source));
    expect(typeof voice.button.label).toBe("string");
    expect(voice.button.label.length).toBeGreaterThan(0);
    expect(typeof voice.button.title).toBe("string");
    expect(voice.button.title.length).toBeGreaterThan(0);
  });

  it("hint 不是 ref，且 text / warn 都是它该有的类型", () => {
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput(source));
    expect(isRef(voice.hint)).toBe(false);
    expect(typeof voice.hint.text).toBe("string");
    expect(typeof voice.hint.warn).toBe("boolean");
  });

  it("内核认得 Web Speech 时：按钮可按、不录音、且**没有**降级提示", () => {
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput(source));
    expect(voice.button.disabled).toBe(false);
    expect(voice.button.recording).toBe(false);
    expect(voice.hint.text).toBe("");
    expect(voice.hint.warn).toBe(false);
  });

  it("两个名字都没有时：按钮禁用，且理由摆在**看得见**的提示行里（不是 title）", () => {
    withWindow({});
    const voice = inScope(() => useVoiceInput(source));
    expect(voice.button.disabled).toBe(true);
    expect(voice.button.recording).toBe(false);
    expect(voice.hint.warn).toBe(true);
    expect(voice.hint.text).toContain("没有提供语音识别接口");
    // 关键：理由必须在 hint.text 里。Chromium 不给 disabled 元素弹 title，
    // 只写 title 的话这一支等于「按不了且不知道为什么」。
    expect(voice.hint.text.length).toBeGreaterThan(voice.button.title.length);
  });

  it("本轮生成中：按钮也禁用（不留后台麦克风），理由同样在提示行", () => {
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput({ ...source, running: () => true }));
    expect(voice.button.disabled).toBe(true);
    expect(voice.button.label).toContain("生成中");
  });

  it("toggle 是可调用的函数（按钮 @click 转发到它）", () => {
    withWindow({ SpeechRecognition: fakeRecognizerClass() });
    const voice = inScope(() => useVoiceInput(source));
    expect(typeof voice.toggle).toBe("function");
  });
});

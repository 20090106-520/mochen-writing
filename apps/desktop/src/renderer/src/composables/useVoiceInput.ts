/**
 * 语音输入的 Vue 薄壳：把 `voice-input.ts` 的判定接到 ref 上，并负责生命周期收口。
 *
 * 为什么分两份：判定（能不能按 / 错误码翻成什么话 / 怎么追加截断）全在 `voice-input.ts`，
 * 那里是纯逻辑、有单测、不依赖浏览器；本文件只做三件事——
 * 读输入框现有值、把新定稿的句子追加进去、卸载时交还麦克风。
 * `ComposerBox.vue` 里不出现任何语音判定（连「该不该停」都不判，只转发 `voice.toggle()`）。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  appendRecognizedText,
  createVoiceSession,
  voiceButtonView,
  voiceHintView,
  voiceRecognizerFactory,
  type VoiceState
} from "./voice-input";

export interface VoiceInputSource {
  /** 输入框现有值（ComposerBox 传它那个 draft computed 的 get）。 */
  readonly read: () => string;
  /** 写回输入框（ComposerBox 传同一个 computed 的 set，不新开第二条状态）。 */
  readonly write: (text: string) => void;
  /** 这一轮是不是在生成。开始生成时麦克风必须交还，不留后台。 */
  readonly running: () => boolean;
}

export function useVoiceInput(source: VoiceInputSource) {
  const session = createVoiceSession({
    // 降级判定在纯逻辑模块里，这里只把全局那两个名字交过去。本机内核两个都没有时
    // 它返回 null ⇒ 会话照建（提示行照实说理由），但 start 永远不动。
    create: voiceRecognizerFactory({
      SpeechRecognition: window.SpeechRecognition,
      webkitSpeechRecognition: window.webkitSpeechRecognition
    }),
    onState: (next) => {
      state.value = next;
    },
    onFinal: (segments) => {
      const appended = appendRecognizedText({ current: source.read(), incoming: segments });
      if (appended.added) source.write(appended.text);
      // 截断的理由要摆出来：光看输入框看不出末段丢了字。
      if (appended.truncated) session.noteTruncated();
    }
  });
  // 会话建好就带着判定结果（supported 在这一刻已经定了），初值直接取它那份。
  const state = ref<VoiceState>(session.state);

  const button = computed(() => voiceButtonView(state.value, { running: source.running() }));
  const hint = computed(() => voiceHintView(state.value));

  // 除卸载外还管一处：这一轮开始生成 ⇒ 交还麦克风（裁定：忙态整卡压暗，
  // 这时留着一颗开着的麦克风既看不见也费电，还和「Tab 排队」那条通路职责重叠）。
  watch(
    () => source.running(),
    (running, was) => {
      if (running && !was) session.dispose();
    }
  );
  onBeforeUnmount(() => session.dispose());

  /**
   * **必须用 `reactive` 裹一层**（2026-10-06 批次 5-⑧ 真机逮到，见下）。
   *
   * `<script setup>` 只对 setup 返回值里的**顶层**绑定做 ref 解包。返回 `{ button, hint }`
   * 这样一个普通对象时，模板里的 `voice.button` 拿到的仍是那个 `ComputedRef` 本身，
   * 于是 `voice.button.disabled` 读出的是 **`undefined`**——不报错、不抛、tsc 也过。
   *
   * 真机上的后果：那枚麦克风按钮渲染成
   * `<button class="round-tool-button" type="button">`，**没有 aria-label、没有 disabled、没有
   * aria-pressed、没有 title**，点下去什么也不发生。接线守卫是绿的（模板里确实写着
   * `voice.button.disabled`），因为它只读源码、不看运行期。
   *
   * `reactive` 的代理在取属性时会把 ref 解开，于是模板拿到的就是真正的视图对象。
   */
  return reactive({
    /** 那一枚按钮的全部属性（含 disabled / aria-pressed / 录音态）。 */
    button,
    /** 卡下那行可见提示：空串 = 不占位。 */
    hint,
    /** 再点一次：听中就停，否则开。按钮的 disabled 绑在 `button` 上，禁用的那颗点不到这里。 */
    toggle: (): void => {
      if (state.value.phase === "listening") session.stop();
      else session.start();
    }
  });
}

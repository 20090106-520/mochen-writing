/**
 * 语音输入这一枚麦克风的**接线契约**（2026-10-06）。
 *
 * 为什么是读源码：本仓 verify 用裸 tsc（没有 vue-tsc），`.vue` 零类型检查 ⇒ 模板里
 * 「按钮接的是哪个函数」「disabled 绑的是哪份判定」没有任何类型关卡咬得住，
 * 只能读源断言钉死（同律先例：composer-card-wiring、model-profile-dialog-wiring、
 * provider-settings-wiring）。读法一律走 utils/vue-source-reader：
 * 它会剥注释 ⇒ 只写在注释里的宣称不算数。
 *
 * **本轮撤销的一条旧钉（不是放宽，是它断言的东西被用户裁定撤销了）**：
 * 旧断言是「麦克风恒 `disabled`，理由写在 aria-label 里」（ComposerBox 的 disabled 占位）。
 * 用户明确要求接成真通路，那条断言断言的东西已经不存在了。取而代之的是**更强**的钉：
 * ① 它不许再是写死的 `disabled`；② 它的 `:disabled` 必须绑到 voice 判定的那一份输出上；
 * ③ 降级理由必须落在卡下那行**看得见的**提示里（Chromium 不给 disabled 元素弹 title，
 * 靠 title 兜等于没有理由）。旧断言在 composer-card-wiring.test.ts 里同处一并改判。
 *
 * **一个必须说清的诚实边界**：Web Speech 的识别只有带识别服务的 Chrome / Edge / Safari
 * 实现了，Electron 自带的 Chromium 没有。所以「本机不支持」不是边角情况而是常态，
 * 接线必须按「支持与不支持两条都接全」写，且**不许**在不支持时画成可点、点了没反应。
 * 判定与文案的真身是 composables/voice-input.ts（有单测），这里只钉接线。
 */
import { describe, expect, it } from "vitest";
import { USER_TEXT_MAX_LEN } from "@mochen/contracts";
import {
  cardSection,
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  tagAttributes,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";
import { VOICE_LISTEN_HINT, VOICE_SEGMENT_BREAK } from "../composables/voice-input";

const COMPOSER = "components/ComposerBox.vue";
const GLUE = "composables/useVoiceInput.ts";
const LOGIC = "composables/voice-input.ts";

/** prettier 折行免疫：先压空白再比。 */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/**
 * 两枚圆钮（`＋` 与麦克风）共用 `round-tool-button` 类名，所以按「哪一枚接了 voice 判定」区分。
 *
 * 注意不能用 `name="mic"` 定位：`tagAttributes` 取的是**标签自己的属性串**（到第一个引号外的 `>` 为止），
 * 麦克风那枚的 `name="mic"` 在它内部的 `<AppIcon>` 上，不在按钮的属性串里——
 * 2026-10-06 首次写这条时按图标名找，结果一个都匹配不到。绑定了 voice 判定的圆钮**恰好一枚**，
 * 这本身就是要钉的事实。
 */
function voiceRoundButton(): string {
  const tags = tagAttributes(templateSource(COMPOSER), "round-tool-button");
  const wired = tags.filter((attrs) => attrs.includes(':disabled="voice.button.disabled"'));
  expect(tags.length, "圆钮仍是两枚（＋ 与麦克风）").toBe(2);
  expect(wired.length, "接了 voice 判定的圆钮必须恰好一枚").toBe(1);
  return wired[0] ?? "";
}

/** 另一枚圆钮（`＋`）：它接的是引用素材，不许被顺手接到语音上去。 */
function mentionRoundButton(): string {
  const tags = tagAttributes(templateSource(COMPOSER), "round-tool-button");
  const other = tags.filter((attrs) => !attrs.includes(':disabled="voice.button.disabled"'));
  expect(other.length, "除麦克风外只有一枚圆钮").toBe(1);
  return other[0] ?? "";
}

/**
 * 麦克风按钮的**整块**（含它内部的 `<AppIcon name="mic">`）。
 * `tagAttributes` 只给标签自己的属性串，看不到内部子元素，所以图标那一行要靠这一段切出来。
 */
function voiceButtonBlock(): string {
  const markup = templateSource(COMPOSER);
  const at = markup.indexOf(':disabled="voice.button.disabled"');
  expect(at, "模板里找不到接了 voice 判定的按钮").toBeGreaterThan(-1);
  const to = markup.indexOf("</button>", at);
  expect(to, "那枚按钮没有闭合").toBeGreaterThan(at);
  return markup.slice(markup.lastIndexOf("<button", at), to);
}

describe("麦克风按钮 · 接的是哪份判定（不是写死的 disabled）", () => {
  it("按钮真的存在、图标还是 mic，位置仍在权限弹层与发送键之间", () => {
    const markup = templateSource(COMPOSER);
    expect(voiceButtonBlock()).toContain('name="mic"');
    expect(markup.indexOf('name="mic"')).toBeGreaterThan(markup.indexOf("<PermissionMenu"));
    expect(markup.indexOf('name="mic"')).toBeLessThan(markup.indexOf('class="send-button'));
  });

  it("两枚圆钮各接各的：＋ 接引用素材，麦克风接 voice 判定（不许长在一起）", () => {
    const mention = mentionRoundButton();
    expect(mention).toContain(`@click="emit('open-mention')"`);
    expect(mention).toContain('aria-label="引用素材"');
    expect(mention).not.toContain("voice.");
    const mic = voiceRoundButton();
    expect(mic).toContain('type="button"');
    expect(mic).not.toContain("open-mention");
  });

  it(":disabled 绑的是 voice.button.disabled（判定在 voice-input.ts，不在模板里）", () => {
    const attrs = voiceRoundButton();
    expect(attrs).toContain(':disabled="voice.button.disabled"');
    // 反向钉：模板里不许再出现写死的 disabled 占位。
    expect(attrs).not.toMatch(/(^|\s)disabled(\s|$|=)/);
    expect(typeScriptSource(LOGIC)).toContain("export function voiceButtonView(");
  });

  it("aria 语义跟着判定走：label / pressed / recording 三样都读 voice.button", () => {
    const attrs = voiceRoundButton();
    expect(attrs).toContain(':aria-label="voice.button.label"');
    expect(attrs).toContain(':aria-pressed="voice.button.pressed"');
    expect(attrs).toContain(':title="voice.button.title"');
    // 录音态走 class 绑定（样式表里那条 .is-recording），不是内联颜色。
    expect(attrs).toContain("'is-recording': voice.button.recording");
  });

  it("再点一次：@click 接的是 voice.toggle()，组件自己不判该不该停", () => {
    expect(voiceRoundButton()).toContain('@click="voice.toggle()"');
    const script = flat(scriptSource(COMPOSER));
    // 组件里不许出现相位判断或引擎成员——那是判定下沉的意思。
    expect(script).not.toContain('phase === "listening"');
    expect(script).not.toContain("SpeechRecognition");
    expect(script).not.toContain(".stop()");
    expect(script).not.toContain(".abort()");
  });

  it("组件里只交出三件事：读现有值、写回现有值、这一轮是否在生成", () => {
    const script = flat(scriptSource(COMPOSER));
    expect(script).toContain('from "../composables/useVoiceInput"');
    expect(script).toContain("const voice = useVoiceInput({");
    expect(script).toContain("read: () => draft.value");
    expect(script).toContain("draft.value = text;");
    expect(script).toContain("running: () => props.running");
    // 不新开第二条状态：语音走的就是那个 draft computed。
    expect(script).toContain("const draft = computed({");
  });
});

describe("卡下那行可见提示 · 降级与出错的理由不许靠 title 兜", () => {
  it("提示行存在、常态不占位（空串不渲染）、warn 态由判定给出", () => {
    const markup = flat(templateSource(COMPOSER));
    expect(markup).toContain('v-if="voice.hint.text"');
    expect(markup).toContain('class="composer-voice-hint"');
    expect(markup).toContain("'composer-voice-hint--warn': voice.hint.warn");
    expect(markup).toContain("{{ voice.hint.text }}");
    // 组件不许自己拼这句提示（文案真身在 voice-input.ts）。
    expect(scriptSource(COMPOSER)).not.toContain("本机没有语音识别能力");
  });

  it("提示行的文案真身带着「识别不给标点」这句诚实边界（组件与样式都不许另写一份）", () => {
    expect(VOICE_LISTEN_HINT).toContain("不给标点");
    expect(typeScriptSource(LOGIC)).toContain("export function voiceHintView(");
  });

  it("样式：提示行与录音态都走既有 token，零色值字面量（不新造颜色变量体系）", () => {
    const section = cardSection("interaction.css");
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\brgba?\(/);
    const hint = ruleBlock(section, ".composer-voice-hint");
    expect(hint).toContain("var(--text-faint)");
    expect(ruleBlock(section, ".composer-voice-hint--warn")).toContain("var(--danger-text)");
  });

  it("录音态：.is-recording 真的改了外观，且沿用圆钮既有形状（不加新的尺寸/圆角）", () => {
    const pane = cardSection("agent-pane.css");
    const recording = ruleBlock(pane, ".round-tool-button.is-recording");
    expect(recording).toContain("var(--danger-text)");
    // 只许改颜色/底色，不许顺手改形状——改形状就等于麦克风变了一枚。
    expect(recording).not.toMatch(/width:|height:|border-radius:/);
    // 旧圆钮规则原样保留（既有接线测试也在钉它们）。
    expect(ruleBlock(pane, ".round-tool-button")).toContain("border-radius: 50%");
    expect(styleSource("agent-pane.css")).toContain(".round-tool-button.is-recording");
  });

  it("麦克风的 disabled 只在真降级/忙态时成立：视觉与判定同源（都是 voice.button）", () => {
    // 圆钮 :disabled 那条不许被改成 pointer 手势（既有裁定），也不许被删掉。
    const off = ruleBlock(cardSection("agent-pane.css"), ".round-tool-button:disabled");
    expect(off).toContain("opacity: 0.42");
    expect(off).toContain("cursor: not-allowed");
  });
});

describe("不新开 IPC 通道 · 识别走渲染层内置能力", () => {
  it("语音这条路一个 preload 方法都不许用：Web Speech 是 Chromium 内置的，要用就留在渲染层", () => {
    const glue = typeScriptSource(GLUE);
    expect(glue).not.toContain("window.mochen");
    const logic = typeScriptSource(LOGIC);
    expect(logic).not.toContain("window.mochen");
    expect(logic).not.toContain("ipcRenderer");
    // 反向钉：识别参数（连续 / 中间结果 / 语言 / 候选数）是硬约定，不是默认值随缘。
    expect(logic).toContain("continuous: true");
    expect(logic).toContain("interimResults: true");
    expect(logic).toContain('lang: "zh-CN"');
    expect(logic).toContain("maxAlternatives: 1");
  });

  it("降级判定读的就是全局那两个名字（标准名在前，前缀名兜底）", () => {
    const glue = typeScriptSource(GLUE);
    expect(glue).toContain("SpeechRecognition: window.SpeechRecognition");
    expect(glue).toContain("webkitSpeechRecognition: window.webkitSpeechRecognition");
  });

  it("Vue 薄壳只做生命周期与接线：降级判定、追加截断、错误码映射都不许在这里重写", () => {
    const glue = typeScriptSource(GLUE);
    expect(glue).toContain("voiceRecognizerFactory(");
    expect(glue).toContain("appendRecognizedText(");
    expect(glue).toContain("voiceButtonView(");
    expect(glue).toContain("voiceHintView(");
    // 薄壳里不许自己判「该不该停 / 能不能按」——那是 start/stop 之外不该有的第二次判定。
    // 变异实测（2026-10-06）：在薄壳里塞一句 `if (code === "not-allowed")` 或自己拼一个
    // `disabled` 字段，上面的 not.toContain 两条就会红。
    expect(glue).not.toContain("not-allowed");
    expect(glue).not.toContain("no-speech");
    expect(glue).not.toContain("USER_TEXT_MAX_LEN");
    expect(glue, "disabled 只能由 voiceButtonView 一处产出").not.toContain("disabled");
    // 忙态判定原样透传：薄壳里再 `||` 一次就是第二份「忙态该不该禁用」的判定。
    expect(flat(glue)).toContain("voiceButtonView(state.value, { running: source.running() })");
    // 卸载必须交还麦克风（不留后台）。
    expect(flat(glue)).toContain("onBeforeUnmount(() => session.dispose())");
    expect(flat(glue)).toContain("if (running && !was) session.dispose();");
  });
});

describe("追加与截断 · 口径与计数条/主进程边界同源", () => {
  it("分句用换行（不替用户编标点），与 voice-input.ts 那份常量同源", () => {
    expect(VOICE_SEGMENT_BREAK).toBe("\n");
    expect(typeScriptSource(LOGIC)).toContain("export const VOICE_SEGMENT_BREAK");
  });

  it("截断文案里的上限是 USER_TEXT_MAX_LEN 本人，组件不许手抄那个数", () => {
    expect(USER_TEXT_MAX_LEN).toBe(20000);
    expect(scriptSource(COMPOSER)).not.toContain(String(USER_TEXT_MAX_LEN));
    expect(styleSource("interaction.css")).not.toContain(String(USER_TEXT_MAX_LEN));
  });

  it("整段识别文本只落一次：模板里不许出现第二处读识别结果的地方", () => {
    const script = scriptSource(COMPOSER);
    // 追加只经 voice-hint / voice.button 两个出口，组件不自己碰 transcript。
    expect(script).not.toContain("transcript");
    expect(countNeedle("voice.button", templateSource(COMPOSER))).toBeGreaterThanOrEqual(4);
  });
});

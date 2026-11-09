<!-- 中栏四层流式渲染：类名沿用 deepwrite 的 message/message-body（见 ATTRIBUTION.md），卡片样式自有 -->
<script setup lang="ts">
import { computed } from "vue";
import { sourceKey, type AgentEvent } from "@mochen/contracts";
import userAvatar from "../assets/avatar/user-avatar.png";
import {
  buildTimeline,
  SOURCE_LIST_PREVIEW,
  toolStatusLabel,
  type StreamingTail,
  type TimelineBlock
} from "../utils/timeline";
import { EMOTION_DONE } from "../utils/emotion-signal";
import EmotionAvatar from "./EmotionAvatar.vue";
import AppIcon from "./AppIcon.vue";
import ThinkingWindow from "./ThinkingWindow.vue";
import { THINKING_LIVE_LABEL, thinkingWindowState } from "../utils/thinking-window";
import { markdownToSimpleHtml } from "@mochen/fs-store/export-shared";
import { formatHistoryTime } from "../utils/history-time";
import { useNotificationStore } from "../stores/useNotificationStore";
import { copyText } from "../utils/clipboard";
import {
  ASK_AGAIN_VIEW,
  COPY_NOTICES,
  actionsForSpeaker,
  type MessageActionView
} from "../utils/message-actions";
import { hasMessageText } from "../utils/message-text";

const props = defineProps<{
  items: AgentEvent[];
  tail: StreamingTail;
  running: boolean;
  /** 助手头像这一刻该画哪种表情；判定唯一真身在 utils/emotion-signal.ts。 */
  emotion: string;
}>();
const blocks = computed<TimelineBlock[]>(() => buildTimeline(props.items, props.tail));

/**
 * 头像只给**最后一条**助手正文做「活的那一枚」（2026-10-21）。
 * 历史消息的球用 `autostart:false` 静态渲染：一条长对话里几十枚同时跑 rAF，
 * 只为让翻过去的旧消息眨眼，是纯烧电。
 * 用户 2026-10-21 补充裁定：「它那个表情是自动的，不需要我自己手动点击切换」
 * ⇒ 这里不设任何图鉴 / 钉住 / 点击入口，画哪张脸完全由 emotion prop 自动决定。
 */
const liveBlockId = computed(() => {
  for (let i = blocks.value.length - 1; i >= 0; i -= 1) {
    const block = blocks.value[i];
    if (block?.kind === "message") return block.id;
  }
  return "";
});

/**
 * 助手正文走 markdown 渲染（2026-10-10）。
 *
 * **这里此前压根没有渲染**：`.message-content` 的类名写着 `message-markdown`、
 * `theme-runtime.css` 里 `.message-markdown pre/code/a` 的样式也早就写好了，
 * 可模板是 `<p class="message-text">{{ block.text }}</p>`——纯文本插值。
 * 于是模型吐什么符号就显示什么符号：`**粗体**`、`## 标题`、`- 列表`、代码围栏，
 * 全部原样躺在屏上。用户报的就是这个。
 *
 * **用的是仓库里那一份**（`@mochen/fs-store/export-shared`，`DocumentPane.vue` 引的是同一个
 * 子路径），不是新写的第二份实现——那里面还住着 XSS 回归线（先整体 escapeHtml 再套规则，
 * 顺序不能反，见 `export-service-markdown.test.ts`）。渲染层不许引 fs-store 的 barrel
 * （会把 Node 模块拖进 bundle），子路径是边界检查明文声明的那条。
 *
 * 模板只调用它、自己不判定。
 */
function messageHtml(text: string): string {
  return markdownToSimpleHtml(text);
}
/**
 * 空窗期那一格（批次 5-㊹）。判据在 utils 里，模板只读 `open`——
 * 「当前这一轮还没产出」这件事只有那一处说了算。
 */
const thinkingWindow = computed(() =>
  thinkingWindowState({ running: props.running, items: props.items, tail: props.tail })
);

/**
 * 点开一条来源（2026-10-06 批次 5-⑨）。
 * 走 preload 那条唯一递 URL 的通道，主进程按 http/https 白名单放行（见 main/web-source-link.ts）。
 * 这里不 catch：失败会变成渲染层的一条未处理拒绝，用户点不动就是点不动，
 * 比弹一个「打开失败」更不打扰——那类提示条本仓还没做过，不在这一批里顺手发明一个。
 */
function openSource(url: string): void {
  void window.mochen.openWebSource(url);
}

/**
 * 消息操作条（2026-10-25 · §173）：一条消息上能做什么。
 *
 * **用户原话**：「你光参考了 UI，没有参考它的功能，因为我那个对话的功能不全，还有很多问题。」
 * ⇒ 这一族动作补的就是「功能」那一半：
 * ① 复制（助手回复 / 自己那句）——写稿最常干的一件事，原来**整仓一次剪贴板都没调过**；
 * ② 改一改再问（自己那句）——把原话填回输入框，用户改完再发（**不自动发**：
 * 已经发出去的话是历史，不该被偷偷改写）。
 *
 * 动作清单住在 `utils/message-actions.ts`（判据只有一份）；
 * 写入剪贴板走 `utils/clipboard.ts`（成功与失败只有那一份）；
 * 「填回输入框」交给**上装层**——它才有 store 与那格输入框。
 */
const emit = defineEmits<{ prefill: [text: string] }>();
const notif = useNotificationStore();

/** 复制一段话：成没成都说成人话（不许假装成功）。 */
async function copyMessage(text: string): Promise<void> {
  const ok = await copyText(text);
  notif.notify(ok ? COPY_NOTICES.ok : COPY_NOTICES.failed);
}

/** 「改一改再问」/「再问一次」：把那句话交给上装层填回输入框。 */
function askAgain(text: string): void {
  emit("prefill", text);
}

/** 动作分发：清单在 utils，这里只把 id 落到动作上。 */
function runAction(action: MessageActionView, text: string): void {
  if (action.id === "copy") {
    void copyMessage(text);
    return;
  }
  askAgain(text);
}
</script>

<template>
  <div class="agent-timeline">
    <section v-for="block in blocks" :key="block.id" class="agent-block" :data-kind="block.kind">
      <div v-if="block.kind === 'user'" class="user-block">
        <div class="user-line">
          <!-- 【2026-10-25 用户批注「随便从网上找一个好看的动漫女生头像，加用这个」】
               原来这里是一枚写着「你」的深色圆标。它在链上其实是**头像位**——助手那一侧有 Emotion Ball，
               自己这一侧却只有一个字，看着像「标签」不像「人」。
               现在换成一张真的头像（取自 Safebooru 的 `original` 原创插画，登记见 docs/ATTRIBUTION.md）。
               `alt="你"` 保留原来的语义：这一格说的是「这是你自己说的话」，
               圆标那层不再写字，字交给 alt（屏幕阅读器读到的还是「你」）。 -->
          <span class="user-tag">
            <img class="user-tag-image" :src="userAvatar" alt="你" />
          </span>
          <p class="user-text">{{ block.text }}</p>
        </div>
        <!-- 【§173】自己那句话上的操作条：复制 / 改一改再问。
             动作清单在 utils/message-actions.ts（判据只有一份），这里只接线。
             空的不挂动作（真机在这本书的历史里翻出过两条空正文的助手消息，
             挂一枚「复制」点下去必然失败）：判定是 utils 那边的 hasMessageText。 -->
        <div v-if="hasMessageText(block.text)" class="message-actions message-actions--right">
          <button
            v-for="action in actionsForSpeaker('user')"
            :key="action.id"
            type="button"
            class="message-action"
            :title="action.title"
            @click="runAction(action, block.text)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>

      <details v-else-if="block.kind === 'thinking'" class="thinking-card" :open="block.streaming">
        <summary>
          <AppIcon name="brain" :size="15" />
          <span>思考摘要</span>
          <em v-if="block.interrupted" class="tail-flag">已打断</em>
          <em v-else-if="block.streaming" class="tail-flag is-live">{{ THINKING_LIVE_LABEL }}</em>
          <!-- 批次 5-⑭：折起来时把摘要**露一行**。
               真机量到一整轮里三行「思考摘要」，每行 24px，summary 上的字只有标签、
               正文整段藏在折起来的身体里——三行加起来信息量是零，看着像卡住了。
               显不显示交给 CSS（`:not([open])`），模板不自己判一次。 -->
          <span class="thinking-peek">{{ block.text }}</span>
          <!-- 2026-11-08：折起来时这里是一行灰字、展开后是一张卡，形态变化要有一枚可读的开关标记。
               与 `.tool-raw` 同一个 chevron 语言（收=0°、开=90°），11px 不抢标题。 -->
          <AppIcon class="thinking-caret" name="chevron" :size="11" />
        </summary>
        <p class="thinking-text">{{ block.text }}</p>
      </details>

      <div v-else-if="block.kind === 'plan'" class="plan-card">
        <header class="card-head">
          <AppIcon name="list" :size="15" />
          <span>计划</span>
        </header>
        <ul class="plan-list">
          <li
            v-for="(item, index) in block.items"
            :key="`${block.id}-${index}`"
            :class="{ 'is-done': item.done }"
          >
            <AppIcon :name="item.done ? 'check' : 'minus'" :size="13" />
            <span>{{ item.text }}</span>
          </li>
        </ul>
      </div>

      <div
        v-else-if="block.kind === 'tool'"
        class="tool-card"
        :class="{ 'is-failed': block.status === 'failed', 'is-empty': block.status === 'empty' }"
      >
        <header class="card-head">
          <AppIcon name="terminal" :size="15" />
          <span class="tool-label">{{ block.label }}</span>
          <em>{{ toolStatusLabel(block.status) }}</em>
        </header>
        <!-- 2026-10-07 用户裁定「只显示文字，不用显示代码」：这一行是人话（toolArgsText 转过），
             所以不画等宽字体。**只动显示**：原始 args 仍原样留在工具事件里、也仍随会话落盘，
             那是给模型读与回放用的；解析不了 / 没登记人话版的参数原样摆回代码体——
             那张卡正是排查入口，换成漂亮话等于把线索毁了。判定在 utils/tool-args.ts。 -->
        <p v-if="block.args" class="tool-args" :class="{ 'is-plain': block.argsPlain }">
          {{ block.args }}
        </p>
        <!-- 批次 5-⑪：原始回执默认折起来，但**只在这张卡同时有来源清单时**折——
             那是同一批数据的两种排版，回执里还摊着 360 的跳转链（真机一张卡量到 398px 高，
             真正给人点的清单被压在它下面）。没有清单时（失败原因、换个词重搜）那句话就是要读的内容，
             折起来等于把唯一有用的信息藏了。判定在 utils/timeline.ts 的 rawFolded。
             折叠只影响显示，不影响这份文本出现在工具事件里（它本来就是给模型读的）。 -->
        <details v-if="block.resultText" class="tool-raw" :open="!block.rawFolded">
          <summary>
            <AppIcon name="chevron" :size="11" />
            <span>原始回执</span>
          </summary>
          <pre class="tool-result">{{ block.resultText }}</pre>
        </details>
        <div v-if="block.sources.length > 0" class="tool-sources">
          <p class="tool-sources-head">这次搜索找到 {{ block.sources.length }} 条来源</p>
          <ol class="source-list">
            <li
              v-for="(source, index) in block.sources.slice(0, SOURCE_LIST_PREVIEW)"
              :key="`${block.id}-src-${index}`"
            >
              <button
                type="button"
                class="source-open"
                :title="source.url"
                @click="openSource(source.url)"
              >
                <span class="source-key">{{ sourceKey(source.url) }}</span>
                <span class="source-title">{{ source.title }}</span>
              </button>
              <p v-if="source.snippet" class="source-snippet">{{ source.snippet }}</p>
            </li>
          </ol>
          <!-- 批次 5-⑭：剩下的折起来。十条全摊开时这张卡量到 874px、吃掉 70% 可视区，
               用户那句问和模型那句答都被挤没了（见 utils/timeline.ts 的 SOURCE_LIST_PREVIEW）。 -->
          <details v-if="block.sources.length > SOURCE_LIST_PREVIEW" class="source-more">
            <summary>展开其余 {{ block.sources.length - SOURCE_LIST_PREVIEW }} 条</summary>
            <ol class="source-list">
              <li
                v-for="(source, index) in block.sources.slice(SOURCE_LIST_PREVIEW)"
                :key="`${block.id}-src-rest-${index}`"
              >
                <button
                  type="button"
                  class="source-open"
                  :title="source.url"
                  @click="openSource(source.url)"
                >
                  <span class="source-key">{{ sourceKey(source.url) }}</span>
                  <span class="source-title">{{ source.title }}</span>
                </button>
                <p v-if="source.snippet" class="source-snippet">{{ source.snippet }}</p>
              </li>
            </ol>
          </details>
        </div>
      </div>

      <p v-else-if="block.kind === 'error'" class="error-line" :class="{ 'is-stale': block.stale }">
        <span class="error-at">{{ formatHistoryTime(block.at) }} ·</span>{{ block.text }}
        <!-- 【§173】失败条上的「再问一次」：把失败前那一句填回输入框，
             改完再发一次（失败必须看得见，而「看得见」要连着「能重问」）。 -->
        <button
          v-if="block.retryText"
          type="button"
          class="message-action error-retry"
          :title="ASK_AGAIN_VIEW.title"
          @click="askAgain(block.retryText)"
        >
          {{ ASK_AGAIN_VIEW.label }}
        </button>
      </p>

      <!-- 用量播报（2026-10-15）：文案已在 utils/token-usage 组好，这里只渲染 text。
           必须在末尾 `v-else`（message 分支）之前，否则 usage 块会掉进 message 渲染。 -->
      <p v-else-if="block.kind === 'usage'" class="usage-line">{{ block.text }}</p>

      <p v-else-if="block.kind === 'interrupted'" class="interrupted-line">
        已打断 · {{ block.pending }} 条提案仍在等待审批
      </p>

      <div v-else class="message-line" :class="{ 'is-streaming': block.streaming }">
        <!-- 【2026-10-21 用户裁定·助手头像】原先是品牌 sparkles 图标，现在换成 Emotion Ball：
             用户原话「对话的那个头像 32 种表情都要用」。球画哪种表情由 emotion prop 决定
             （utils/emotion-signal.ts 判定，组件不自己判）：最后一条正文那枚跟着本轮状态
             自动换脸（思考 / 调工具 / 搜索 / 写作 / 完成 / 出错 / 被打断），
             历史消息全部静态定格在「任务完成」；用户另有裁定「表情是自动的，不需要自己
             手动点击切换」⇒ 这里没有任何按钮或图鉴入口，脸只随状态走。
             球本身是装饰，谁说的由气泡位置说明，所以整块 aria-hidden。 -->
        <span class="message-avatar" aria-hidden="true">
          <EmotionAvatar v-if="block.id === liveBlockId" :emotion="props.emotion" />
          <EmotionAvatar v-else :emotion="EMOTION_DONE" :animated="false" />
        </span>
        <div class="message-body">
          <div class="message-content message-markdown">
            <!--
              **这一格从纯文本改成 markdown 渲染**（2026-10-10）：原先是 `{{ block.text }}`，
              模型吐什么符号就显示什么符号。`<p>` 换成 `<div>` 是必须的——
              渲染器的输出自带 `<p>`，再套一层 `<p>` 就是非法嵌套（浏览器会自动拆开，间距全乱）。
              `tail-flag` 仍在 `.message-content` 里、与正文平级，不受 v-html 影响（v-html 只接管它自己那一格）。
            -->
            <!-- eslint-disable vue/no-v-html -- 放行理由：与 DocumentPane 预览区同一条路径。
                 messageHtml 调的是 markdownToSimpleHtml（真身在 @mochen/fs-store/export-shared，
                 与 DocumentPane 的 previewHtml 是同一个函数），它先整体 escapeHtml 源文再套 markdown 规则，
                 裸标签进不来；回归线见 packages/fs-store/test/export-service-markdown.test.ts
                 与 packages/fs-store/test/markdown-ordered-list.test.ts。 -->
            <div class="message-text" v-html="messageHtml(block.text)" />
            <!-- eslint-enable vue/no-v-html -->
            <em v-if="block.interrupted" class="tail-flag">已打断</em>
          </div>
          <!-- 【§173】助手回复上的操作条：复制。
               写稿最常干的一件事（把写好的段落拿走），而原来整仓一次剪贴板都没调过。
               空正文不挂（同上：挂一枚点不成的钮只是噪音）。 -->
          <div v-if="hasMessageText(block.text)" class="message-actions">
            <button
              v-for="action in actionsForSpeaker('assistant')"
              :key="action.id"
              type="button"
              class="message-action"
              :title="action.title"
              @click="runAction(action, block.text)"
            >
              {{ action.label }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 空窗期那一行放在时间线**末尾**：它是这一轮的助手位，摆在最后才挨着输入卡，
         摆到开头会插在上一轮的回答中间（真机上时间线是追加的，开头那个位置属于上一轮）。 -->
    <ThinkingWindow :open="thinkingWindow.open" />
  </div>
</template>

<!-- 中栏四层流式渲染：类名沿用 deepwrite 的 message/message-body（见 ATTRIBUTION.md），卡片样式自有 -->
<script setup lang="ts">
import { computed } from "vue";
import { sourceKey, type AgentEvent } from "@mochen/contracts";
import {
  buildTimeline,
  SOURCE_LIST_PREVIEW,
  toolStatusLabel,
  type StreamingTail,
  type TimelineBlock
} from "../utils/timeline";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ items: AgentEvent[]; tail: StreamingTail }>();
const blocks = computed<TimelineBlock[]>(() => buildTimeline(props.items, props.tail));

/**
 * 点开一条来源（2026-10-06 批次 5-⑨）。
 * 走 preload 那条唯一递 URL 的通道，主进程按 http/https 白名单放行（见 main/web-source-link.ts）。
 * 这里不 catch：失败会变成渲染层的一条未处理拒绝，用户点不动就是点不动，
 * 比弹一个「打开失败」更不打扰——那类提示条本仓还没做过，不在这一批里顺手发明一个。
 */
function openSource(url: string): void {
  void window.mochen.openWebSource(url);
}
</script>

<template>
  <div class="agent-timeline">
    <section v-for="block in blocks" :key="block.id" class="agent-block" :data-kind="block.kind">
      <div v-if="block.kind === 'user'" class="user-line">
        <span class="user-tag">你</span>
        <p class="user-text">{{ block.text }}</p>
      </div>

      <details v-else-if="block.kind === 'thinking'" class="thinking-card" :open="block.streaming">
        <summary>
          <AppIcon name="brain" :size="15" />
          <span>思考摘要</span>
          <em v-if="block.interrupted" class="tail-flag">已打断</em>
          <em v-else-if="block.streaming" class="tail-flag is-live">正在想</em>
          <!-- 批次 5-⑭：折起来时把摘要**露一行**。
               真机量到一整轮里三行「思考摘要」，每行 24px，summary 上的字只有标签、
               正文整段藏在折起来的身体里——三行加起来信息量是零，看着像卡住了。
               显不显示交给 CSS（`:not([open])`），模板不自己判一次。 -->
          <span class="thinking-peek">{{ block.text }}</span>
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

      <p v-else-if="block.kind === 'error'" class="error-line">{{ block.text }}</p>

      <p v-else-if="block.kind === 'interrupted'" class="interrupted-line">
        已打断 · {{ block.pending }} 条提案仍在等待审批
      </p>

      <div v-else class="message-line" :class="{ 'is-streaming': block.streaming }">
        <div class="message-body">
          <div class="message-content message-markdown">
            <p class="message-text">{{ block.text }}</p>
            <em v-if="block.interrupted" class="tail-flag">已打断</em>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

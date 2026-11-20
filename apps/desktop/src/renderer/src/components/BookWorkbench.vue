<!-- 作品工作台（中栏空状态，示意稿 A）：hero + 五张能力卡 + 能力清单气泡 + 建议 pill。
     判定与文案全在 utils/workbench-state.ts（`.vue` 不过 tsc，表放这里就没有关卡）。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import ParticleObject from "./canvasui/ParticleObject.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import {
  WORKBENCH_CAPABILITIES,
  WORKBENCH_CARD_ICONS,
  WORKBENCH_HERO_QUOTE,
  WORKBENCH_SUGGESTION_TITLES,
  workbenchCardTitle,
  type WorkbenchCard,
  type WorkbenchCardId,
  type WorkbenchSuggestion
} from "../utils/workbench-state";
import { conversationBrief } from "../utils/conversation-brief";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import BookLibraryList from "./BookLibraryList.vue";

defineProps<{
  hasBook: boolean;
  agentLabel: string;
  cards: WorkbenchCard[];
  suggestions: WorkbenchSuggestion[];
}>();

// canvas-ui 品牌粒子：只在无书空状态跑（写作时不耗 GPU）；加载失败回退原图（原图原样用）。
const particleFailed = ref(false);
const emit = defineEmits<{
  pick: [id: WorkbenchCardId];
  suggestion: [suggestion: WorkbenchSuggestion];
}>();

const book = useBookStore();
const layout = useLayoutStore();

/**
 * 这本书现在到哪了（2026-11-20 对话区智能刀）。
 *
 * 判定全在 `utils/conversation-brief.ts`（`.vue` 不过 tsc，判定不写在模板里）。
 * 这一格原来没有：中栏摆的是一份静态产品说明书——五张能力卡 + 六条
 * 「我可以帮你做这些」，没有一句在说自己那本书的进度。
 */
const brief = computed(() =>
  conversationBrief({
    hasBook: book.hasBook,
    title: book.meta?.title ?? "",
    docs: book.docs,
    activeChapter: book.activeDocTab
  })
);

// 无书降级的「打开作品目录」走 book.pickAndOpen() —— 与输入卡书格、Ctrl+O 同一真身，不复制逻辑；
// 「新建作品」开的是 layout.newBookOpen 那一个对话框（开合真身唯一）。
async function openBook(): Promise<void> {
  await book.pickAndOpen();
}
</script>

<template>
  <div class="book-workbench">
    <section class="workbench-hero" :class="{ 'is-no-book': !hasBook }">
      <!-- 无书空状态：品牌图重建为可被光标搅动的粒子（canvas-ui，图片全幅不裁）；失败回退原图。 -->
      <ParticleObject
        v-if="!hasBook && !particleFailed"
        class="workbench-hero-art is-particle"
        :src="brandMark"
        :count="1600"
        :size="1.7"
        :drift="0.5"
        :float-intensity="0.35"
        :rotation-intensity="0"
        :orbit="false"
        :zoom="false"
        :on-error="() => (particleFailed = true)"
      />
      <img v-else class="workbench-hero-art" :src="brandMark" alt="墨宸 AI 品牌图" width="118" />
      <div class="workbench-hero-text">
        <h1>{{ agentLabel }}</h1>
        <p class="workbench-lead">
          说人话就行——它会自己读文档、给出逐条待审的改稿提案；你不点批准，它一个字也写不进作品目录。
        </p>
        <p class="workbench-quote">「{{ WORKBENCH_HERO_QUOTE }}」</p>
      </div>
    </section>

    <!-- 作品现状（2026-11-20 对话区智能刀）：章 / 字 / 人物三格 + 一句「接下来干什么」。
         空书那一档不摆三格零（全是 0，等于没信息），改说「这本书还空着」。 -->
    <section v-if="hasBook" class="workbench-brief" aria-label="作品现状">
      <p v-if="brief.stage === 'empty-book'" class="workbench-brief-head">{{ brief.headline }}</p>
      <dl v-else class="workbench-stats">
        <div v-for="stat in brief.stats" :key="stat.label" class="workbench-stat">
          <dt>{{ stat.label }}</dt>
          <dd>{{ stat.value }}</dd>
        </div>
      </dl>
      <p class="workbench-next">{{ brief.nextStep }}</p>
    </section>

    <nav v-if="cards.length" class="workbench-cards" aria-label="作品工作台">
      <button
        v-for="card in cards"
        :key="card.id"
        class="workbench-card"
        :class="{ 'is-empty': card.target === null }"
        type="button"
        :title="workbenchCardTitle(card)"
        @click="emit('pick', card.id)"
      >
        <span class="workbench-card-icon">
          <AppIcon :name="WORKBENCH_CARD_ICONS[card.id]" :size="18" />
        </span>
        <span class="workbench-card-label">{{ card.label }}</span>
        <span class="workbench-card-hint">{{ card.hint }}</span>
      </button>
    </nav>

    <div v-else class="workbench-empty-book">
      <p>还没有打开作品目录。先打开一个，或者直接建一本新书。</p>
      <div class="workbench-empty-actions">
        <button class="workbench-open-book is-primary" type="button" @click="openBook">
          <AppIcon name="directory" :size="16" />
          <span>打开作品目录</span>
        </button>
        <button class="workbench-open-book" type="button" @click="layout.openNewBook()">
          <AppIcon name="plus" :size="16" />
          <span>新建作品</span>
        </button>
      </div>
    </div>

    <!-- 最近的作品（2026-10-21）：工作台不再只有「打开 / 新建」两个按钮——
         写过哪几本、上一本叫什么，都摆在这里，点一本就切过去（同一份组件，左栏那份是 is-list）。 -->
    <section v-if="book.recentBooks.length" class="workbench-recent" aria-label="最近的作品">
      <header class="workbench-recent-head">
        <strong>最近的作品</strong>
        <span>点一本就换过去</span>
      </header>
      <BookLibraryList variant="cards" />
    </section>

    <!-- 能力清单：静态说明，不是对话项——本版没有「它先开口」这件事，所以不写时间戳。 -->
    <section v-if="hasBook" class="workbench-intro">
      <header class="workbench-intro-head">
        <span class="workbench-intro-mark">
          <img :src="brandMark" alt="" width="34" height="34" />
        </span>
        <strong>墨宸 AI</strong>
      </header>
      <p>我可以帮你做这些：</p>
      <ul class="workbench-capabilities">
        <li v-for="line in WORKBENCH_CAPABILITIES" :key="line">{{ line }}</li>
      </ul>
      <p>也可以直接在下面的输入区说一句。发出去之前，稿子一个字也不会动。</p>
    </section>

    <div v-if="suggestions.length" class="workbench-suggestions" role="group" aria-label="建议指令">
      <button
        v-for="item in suggestions"
        :key="item.id"
        class="workbench-suggestion"
        type="button"
        :title="WORKBENCH_SUGGESTION_TITLES[item.kind]"
        @click="emit('suggestion', item)"
      >
        {{ item.text }}
      </button>
    </div>
  </div>
</template>

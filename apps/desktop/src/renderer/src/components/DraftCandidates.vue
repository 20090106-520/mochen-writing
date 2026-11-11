<!-- 多稿候选面板（P0-②）：几稿并排摆在中栏转录区之上、输入区之前，一个字都还没落盘。
     挑一稿走 pickDraft、全不要就 discardDrafts；两条动作与失败中文住在 useAgentStore /
     utils/draft-candidates.ts，本组件只接线——面板不自己拼第二份句子、也不自己判成败（铁律 6）。
     推荐位不在这里算：`drafts` 是主进程按 rankDrafts 排好序交回来的，第 0 位就是推荐位。 -->
<script setup lang="ts">
import type { DraftCandidate } from "@mochen/contracts";
import {
  DRAFT_DEGENERATION_NOTE,
  DRAFT_DISCARD_LABEL,
  DRAFT_PANEL_TITLE,
  DRAFT_PICK_LABEL,
  DRAFT_RECOMMENDED_LABEL,
  DRAFT_VITALITY_NOTE,
  draftDegenerationLine,
  draftHeadline,
  draftPreview,
  draftReadingLine,
  draftVitalityLine
} from "../utils/draft-candidates";

// draftSetId 只落成面板的标识（data-draft-set），不作挑稿入参——挑稿只递位次（正文一个字都不往回递）。
defineProps<{ drafts: DraftCandidate[]; draftSetId: string }>();
const emit = defineEmits<{ pick: [index: number]; discard: [] }>();
</script>

<template>
  <section class="draft-candidates" :data-draft-set="draftSetId" aria-label="多稿候选">
    <p class="draft-candidates-title">{{ DRAFT_PANEL_TITLE }}</p>
    <p class="draft-candidates-vitality-note">{{ DRAFT_VITALITY_NOTE }}</p>
    <p class="draft-candidates-degeneration-note">{{ DRAFT_DEGENERATION_NOTE }}</p>
    <ul class="draft-candidate-list">
      <li v-for="(candidate, position) in drafts" :key="candidate.index" class="draft-candidate">
        <div class="draft-candidate-head">
          <span class="draft-candidate-ordinal">
            {{ draftHeadline(position, candidate.reading) }}
          </span>
          <span v-if="position === 0" class="draft-candidate-badge">
            {{ DRAFT_RECOMMENDED_LABEL }}
          </span>
        </div>
        <p class="draft-candidate-text">{{ draftPreview(candidate.text) }}</p>
        <p class="draft-candidate-reading">{{ draftReadingLine(candidate.reading) }}</p>
        <p class="draft-candidate-vitality">{{ draftVitalityLine(candidate.text) }}</p>
        <p class="draft-candidate-degeneration">{{ draftDegenerationLine(candidate.text) }}</p>
        <button class="draft-candidate-pick" type="button" @click="emit('pick', candidate.index)">
          {{ DRAFT_PICK_LABEL }}
        </button>
      </li>
    </ul>
    <div class="draft-candidates-foot">
      <button class="draft-candidates-discard" type="button" @click="emit('discard')">
        {{ DRAFT_DISCARD_LABEL }}
      </button>
    </div>
  </section>
</template>

<style scoped>
/* 颜色一律走既有 token（不新造一份字面量）；形状只写这一层需要的：三稿并排、窄栏自动换行。
   2026-11-08：与计划卡/工具卡收敛成同一族语言——发丝线 + 12px 圆角 + 侧栏底；
   标题与说明按「过程注脚」退半档，候选正文回到可读字号（0.8125 → 0.875），
   说明行从 9.6px 抬到 10.5px——密度收敛不等于把字缩到看不清。 */
.draft-candidates {
  margin: 0 0 10px;
  padding: 9px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: color-mix(in srgb, var(--sidebar) 42%, transparent);
}

.draft-candidates-title {
  margin-bottom: 6px;
  color: var(--text-soft);
  font-size: 0.785714rem;
}

.draft-candidates-vitality-note {
  margin-bottom: 6px;
  color: var(--text-faint);
  font-size: 0.785714rem;
  line-height: 1.5;
}

.draft-candidates-degeneration-note {
  margin-bottom: 6px;
  color: var(--text-faint);
  font-size: 0.785714rem;
  line-height: 1.5;
}

.draft-candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.draft-candidate {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
}

.draft-candidate-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.draft-candidate-ordinal {
  color: var(--text);
  font-size: 0.785714rem;
  font-weight: 600;
}

.draft-candidate-badge {
  padding: 0 5px;
  border-radius: 6px;
  /* 强调色走 --focus（皮肤层重定义的是它，--accent 只是它没被重定义时的兜底）：
     直接读 --accent 会让这枚徽标在换肤后停在默认蓝上，跟整块界面脱节。 */
  background: color-mix(in srgb, var(--focus) 14%, transparent);
  color: var(--focus);
  font-size: 0.785714rem;
}

.draft-candidate-text {
  margin-bottom: 6px;
  color: var(--text);
  font-size: 0.857143rem;
  line-height: 1.55;
}

.draft-candidate-reading {
  margin-bottom: 6px;
  color: var(--text-faint);
  font-size: 0.785714rem;
}

.draft-candidate-vitality {
  margin-bottom: 6px;
  color: var(--text-faint);
  font-size: 0.785714rem;
}

.draft-candidate-degeneration {
  margin-bottom: 6px;
  color: var(--text-faint);
  font-size: 0.785714rem;
}

.draft-candidate-pick,
.draft-candidates-discard {
  align-self: flex-start;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-size: 0.785714rem;
}

.draft-candidates-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.draft-candidates-discard {
  color: var(--text-soft);
}
</style>

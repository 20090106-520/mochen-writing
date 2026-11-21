<!-- 设定提案卡（2026-11-20）：模型提出的人物 / 地点 / 时间线，批准后才进设定库。
     与正文提案卡分开的原因：没有 diff、没有锚点，批复的是一条「新设定」而不是一处改写。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import {
  BIBLE_PROPOSAL_TYPE_LABELS,
  PERMISSION_LABELS,
  PROPOSAL_STATUS_LABELS,
  WORK_MODE_LABELS,
  workModeOf,
  type ProposalDecision
} from "@mochen/contracts";
import type { BibleProposalView } from "../stores/useAgentStore";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ view: BibleProposalView; turnLabel: string }>();
const emit = defineEmits<{
  decide: [decision: ProposalDecision, guidance: string];
}>();

const book = useBookStore();
const guidance = ref("");
const pending = computed(() => props.view.status === "pending");
const typeLabel = computed(() => BIBLE_PROPOSAL_TYPE_LABELS[props.view.proposal.type]);
const statusLabel = computed(() => PROPOSAL_STATUS_LABELS[props.view.status]);
// 与主进程 bible-approval 同一口径：策划档不落盘，设定库只认全开档。
const needsAct = computed(() => workModeOf(book.meta ?? {}) === "plan");
const needsFullAccess = computed(() => (book.meta?.permissionMode ?? "") !== "full-access");
const saving = computed(() => book.metaSaving);

function decide(decision: ProposalDecision): void {
  if (decision === "deny-with-guidance" && guidance.value.trim() === "") return;
  emit("decide", decision, guidance.value);
}

function switchToAct(): void {
  void book.setWorkMode("act");
}

function switchToFullAccess(): void {
  void book.setPermissionMode("full-access");
}
</script>

<template>
  <article
    class="proposal-card bible-card"
    :class="[`is-${view.status}`]"
    data-bible-proposal-card
    :data-proposal-id="view.proposal.id"
    :data-proposal-status="view.status"
  >
    <header class="card-head">
      <AppIcon name="book" :size="15" />
      <span class="card-turn">{{ turnLabel }}</span>
      <span class="proposal-title">{{ typeLabel }}「{{ view.proposal.title }}」</span>
      <span class="proposal-status">{{ statusLabel }}</span>
    </header>

    <p class="proposal-why">{{ view.proposal.why }}</p>
    <p v-if="view.proposal.content" class="bible-content">{{ view.proposal.content }}</p>
    <p v-if="view.message" class="proposal-message">{{ view.message }}</p>

    <!-- 批不了的两种档位各给一条真出路（走 store 落盘），不是一句安慰话。 -->
    <div v-if="pending && (needsAct || needsFullAccess)" class="proposal-permission-hint">
      <template v-if="needsAct">
        <span>现在是「{{ WORK_MODE_LABELS.plan }}」档：设定提案只停在计划里。</span>
        <button
          class="proposal-permission-switch"
          type="button"
          :disabled="saving"
          @click="switchToAct"
        >
          切到「{{ WORK_MODE_LABELS.act }}」
        </button>
      </template>
      <template v-else>
        <span>设定库是书级资料，批准需要「{{ PERMISSION_LABELS["full-access"] }}」权限。</span>
        <button
          class="proposal-permission-switch"
          type="button"
          :disabled="saving"
          @click="switchToFullAccess"
        >
          切到「{{ PERMISSION_LABELS["full-access"] }}」
        </button>
      </template>
    </div>

    <footer v-if="pending" class="proposal-actions">
      <textarea
        v-model="guidance"
        class="guidance-box"
        rows="2"
        placeholder="拒绝时写清该怎么改（Shift+Enter 换行）"
      />
      <div class="proposal-buttons">
        <button class="is-primary" type="button" @click="decide('accept-once')">加入设定库</button>
        <button
          class="is-danger"
          type="button"
          :disabled="guidance.trim() === ''"
          @click="decide('deny-with-guidance')"
        >
          拒绝并说明
        </button>
        <button type="button" @click="decide('cancel')">取消</button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.bible-content {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--editor);
  color: var(--text-soft);
  font-size: 0.857143rem;
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
}
</style>

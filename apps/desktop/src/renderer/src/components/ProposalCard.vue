<!-- 提案卡：逐条人审批的唯一入口。Esc 的第一优先级（spec §6.2）在卡内裁决。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { PROPOSAL_STATUS_LABELS, type ProposalDecision } from "@mochen/contracts";
import type { ProposalView } from "../stores/useAgentStore";
import { resolveEscape } from "../utils/escape-policy";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ view: ProposalView; running: boolean; turnLabel: string }>();
const emit = defineEmits<{
  decide: [decision: ProposalDecision, guidance: string];
  interrupt: [];
}>();

const guidance = ref("");
const pending = computed(() => props.view.status === "pending");
const expired = computed(() => props.view.status === "expired");
const statusLabel = computed(() => PROPOSAL_STATUS_LABELS[props.view.status]);
const modeLabel = computed(() =>
  props.view.proposal.mode === "doc-overwrite" ? "整篇替换" : "锚点替换"
);

function decide(decision: ProposalDecision): void {
  if (decision === "deny-with-guidance" && guidance.value.trim() === "") return;
  emit("decide", decision, guidance.value);
}

/** 卡内 Esc 先按 §6.2 裁决；落不到卡上的动作往上抛，由中栏处理打断。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const action = resolveEscape({
    hasFocusedProposal: true,
    focusedProposalPending: pending.value,
    guidanceIsDirty: guidance.value.trim() !== "",
    turnRunning: props.running
  });
  if (action === "none") return;
  event.preventDefault();
  event.stopPropagation();
  if (action === "keep-guidance") {
    (event.target as HTMLElement | null)?.blur();
    return;
  }
  if (action === "cancel-proposal") decide("cancel");
  if (action === "interrupt") emit("interrupt");
}
</script>

<template>
  <article
    class="proposal-card"
    :class="[`is-${view.status}`, { 'is-focused': pending }]"
    tabindex="0"
    @keydown="onKeydown"
  >
    <header class="card-head">
      <AppIcon name="replace" :size="15" />
      <span class="card-turn">{{ turnLabel }}</span>
      <span class="proposal-title">{{ view.proposal.docRelPath }}</span>
      <span class="proposal-mode">{{ modeLabel }}</span>
      <span class="proposal-status">{{ statusLabel }}</span>
    </header>

    <p class="proposal-why">{{ view.proposal.why }}</p>
    <pre v-if="view.diff" class="proposal-diff">{{ view.diff }}</pre>
    <p v-else-if="expired" class="proposal-diff-empty">这条历史提案的 diff 不再取回。</p>
    <p v-else class="proposal-diff-empty">diff 尚未取回</p>
    <p
      v-if="view.proposal.anchor && view.proposal.mode === 'anchor-replace'"
      class="proposal-anchor"
    >
      锚点：{{ view.proposal.anchor }}
    </p>
    <p v-if="view.message" class="proposal-message">{{ view.message }}</p>

    <footer v-if="pending" class="proposal-actions">
      <textarea
        v-model="guidance"
        class="guidance-box"
        rows="2"
        placeholder="拒绝时写清该怎么改（Shift+Enter 换行，Esc 先保住这段字）"
      />
      <div class="proposal-buttons">
        <button class="is-primary" type="button" @click="decide('accept-once')">
          仅这一次批准
        </button>
        <button type="button" @click="decide('accept-session')">本章不再问</button>
        <button type="button" @click="decide('accept-prefix')">同文档同类改动不再问</button>
        <button
          class="is-danger"
          type="button"
          :disabled="guidance.trim() === ''"
          @click="decide('deny-with-guidance')"
        >
          拒绝并说明
        </button>
        <button type="button" @click="decide('cancel')">取消（Esc）</button>
      </div>
    </footer>

    <footer v-else-if="expired" class="proposal-actions is-expired">
      <p class="expired-note">这一条要在新一轮里重新提出。</p>
      <div class="proposal-buttons">
        <button class="is-primary" type="button" disabled>仅这一次批准</button>
        <button type="button" disabled>本章不再问</button>
        <button type="button" disabled>同文档同类改动不再问</button>
        <button class="is-danger" type="button" disabled>拒绝并说明</button>
      </div>
    </footer>
  </article>
</template>

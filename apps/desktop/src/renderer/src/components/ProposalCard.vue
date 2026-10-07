<!-- 提案卡：逐条人审批的唯一入口。Esc 的裁决已上收全局唯一层（resolveEscape，spec §6.2），卡内不自裁决。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  PROPOSAL_MODE_LABELS,
  PROPOSAL_STATUS_LABELS,
  WORK_MODE_LABELS,
  workModeOf,
  type ProposalDecision
} from "@mochen/contracts";
import type { ProposalView } from "../stores/useAgentStore";
import AppIcon from "./AppIcon.vue";
import DiffHighlighter from "./DiffHighlighter.vue";
import { permissionHint } from "../utils/proposal-permission";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{ view: ProposalView; turnLabel: string }>();
const emit = defineEmits<{
  decide: [decision: ProposalDecision, guidance: string];
}>();

const book = useBookStore();
const guidance = ref("");
const pending = computed(() => props.view.status === "pending");
const expired = computed(() => props.view.status === "expired");
const statusLabel = computed(() => PROPOSAL_STATUS_LABELS[props.view.status]);
// 模式文案的唯一来源是 contracts 的穷尽表（铁律 6）：这里不写三元链，加模式不写文案直接编译不过。
const modeLabel = computed(() => PROPOSAL_MODE_LABELS[props.view.proposal.mode]);
/**
 * 「切档后再批准」的入口（Plan 2 冒烟 P3）。判定在 utils/proposal-permission.ts，
 * 判据用的就是主进程批准时那一份 writeVerdict——所以这里指的那一档，主进程一定认。
 * 「当前章」取活动标签：与主进程 `threadKey` 即文稿路径的裁定 o 同一口径。
 * 没开书时兜 DEFAULT_PERMISSION_MODE，不在组件里捏一个档位名——主进程那边
 * （agent-service 的 context 与 PermissionMenu）兜的是同一个常量，兜底一旦分叉，
 * 卡上就会说「切档就能批」而主进程拿着另一档在批。
 */
const permission = computed(() =>
  permissionHint({
    status: props.view.status,
    docRelPath: props.view.proposal.docRelPath,
    currentChapter: book.activeDocTab,
    mode: book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE,
    // 工作模式：老书没这一格时 workModeOf 兜成「直接动手」，与主进程同一份解析（铁律 6）。
    workMode: workModeOf(book.meta ?? {})
  })
);
const permissionSaving = computed(() => book.metaSaving);

/** 切档走 useBookStore.setPermissionMode（它带落盘与失败回退），不是这里直接改状态。 */
function switchPermissionMode(): void {
  if (permission.value.kind !== "switch") return;
  void book.setPermissionMode(permission.value.mode);
}

/**
 * 切工作模式（2026-10-05 批次 4）：同样走 store，落盘与失败回退都在那里。
 * 目标档位是**定死的** act——不是从视图反推，反推的话哪天 `permissionHint`
 * 多出一种模式分支，这里就会跟着指向一个不存在的档。
 */
function switchToAct(): void {
  if (permission.value.kind !== "switch-work-mode") return;
  void book.setWorkMode("act");
}

function decide(decision: ProposalDecision): void {
  if (decision === "deny-with-guidance" && guidance.value.trim() === "") return;
  emit("decide", decision, guidance.value);
}
</script>

<template>
  <!-- 三个 data-* 是全局键位层（useHotkeys）找卡、判状态、取 id 的唯一依据（裁定 G5）：
       少任一个标记，审批四键与 Esc 的卡态裁决都会静默失效。卡内不再有 @keydown 自裁决——
       Esc 一律冒泡到全局唯一裁决入口 resolveEscape（设计决定 1），杜绝两份优先级。 -->
  <article
    class="proposal-card"
    :class="[`is-${view.status}`, { 'is-focused': pending }]"
    tabindex="0"
    data-proposal-card
    :data-proposal-id="view.proposal.id"
    :data-proposal-status="view.status"
  >
    <header class="card-head">
      <AppIcon name="replace" :size="15" />
      <span class="card-turn">{{ turnLabel }}</span>
      <span class="proposal-title">{{ view.proposal.docRelPath }}</span>
      <span class="proposal-mode">{{ modeLabel }}</span>
      <span class="proposal-status">{{ statusLabel }}</span>
    </header>

    <p class="proposal-why">{{ view.proposal.why }}</p>
    <!-- 逐条人审批是全案最硬的铁律，diff 看得清是这套铁律的地基：
         新增行染绿、删除行染红、@@ 头单独着色，见 DiffHighlighter。 -->
    <DiffHighlighter v-if="view.diff" :diff="view.diff" />
    <p v-else-if="expired" class="proposal-diff-empty">这条历史提案的 diff 不再取回。</p>
    <p v-else class="proposal-diff-empty">diff 尚未取回</p>
    <p
      v-if="view.proposal.anchor && view.proposal.mode === 'anchor-replace'"
      class="proposal-anchor"
    >
      锚点：{{ view.proposal.anchor }}
    </p>
    <p v-if="view.message" class="proposal-message">{{ view.message }}</p>

    <!-- 切档入口：档位挡住的提案**不删 pending**，放开后这条还能直接批准（spec §5.1 约束 3），
         所以这里给的是一条真动作（setPermissionMode 落盘），不是一句安慰话。
         blocked 那一档只摆原因不给按钮——切档解决不了的事，给按钮是骗人（§2.7）。 -->
    <div v-if="permission.kind !== 'none'" class="proposal-permission-hint">
      <template v-if="permission.kind === 'switch'">
        <span>{{ permission.detail }}</span>
        <button
          class="proposal-permission-switch"
          type="button"
          :disabled="permissionSaving"
          :title="`切档并落盘；切完这张卡可以直接批准`"
          @click="switchPermissionMode"
        >
          {{ permission.label }}
        </button>
      </template>
      <!-- 先计划后动手（2026-10-05 批次 4）：这一颗走的是工作模式，不是档位。
           两者视觉刻意共用 `.proposal-permission-switch`（它们是同一族问题的两个闸），
           但事件不同——接到 setPermissionMode 上会让用户点完发现什么都没变。 -->
      <template v-else-if="permission.kind === 'switch-work-mode'">
        <span>{{ permission.detail }}</span>
        <button
          class="proposal-permission-switch"
          type="button"
          :disabled="permissionSaving"
          :title="`切到「${WORK_MODE_LABELS.act}」并落盘；切完这张卡可以直接批准`"
          @click="switchToAct"
        >
          {{ permission.label }}
        </button>
      </template>
      <template v-else>
        <span>{{ permission.detail }}</span>
      </template>
    </div>

    <footer v-if="pending" class="proposal-actions">
      <textarea
        v-model="guidance"
        data-guidance
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

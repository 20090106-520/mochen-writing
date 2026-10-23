<!-- 本章目标的页脚一格（2026-10-22）。
     为什么单独成组件：正文组件已经贴着 800 行门禁，而这一格自己带状态（读目标、写目标、算差额），
     塞回去等于把「编辑器」与「目标登记」两种职责绑死。
     判定在 utils/chapter-quota（纯函数），目标存在 useWritingGoalStore，这里只负责渲染与提交。 -->
<script setup lang="ts">
import { computed } from "vue";
import { chapterQuota } from "../utils/chapter-quota";
import { useWritingGoalStore } from "../stores/useWritingGoalStore";

const props = defineProps<{
  /** 当前这一篇的已写正文字数（父组件与页脚同一个数）。 */
  chars: number;
  /** 这一篇的书内相对路径：目标按路径存，换章自动换目标。 */
  relPath: string;
}>();

const goal = useWritingGoalStore();
const target = computed(() => goal.chapterTargetOf(props.relPath));
const quota = computed(() => chapterQuota(props.chars, target.value));

/** change 而不是 input：每敲一个数字都写一次盘会把目标文件刷成流水，改完再提交一次就够。 */
function commit(event: Event): void {
  goal.setChapterTarget(props.relPath, Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <span class="chapter-quota" :class="{ 'is-over': quota.over }">
    目标
    <input
      class="quota-input"
      type="number"
      min="0"
      step="500"
      :value="quota.target > 0 ? quota.target : ''"
      placeholder="未设"
      aria-label="本章目标字数"
      title="这一章打算写多少字（只存本机，不改正文）"
      @change="commit"
    />
    <span v-if="quota.target > 0">字</span><span v-if="quota.label"> · {{ quota.label }}</span>
  </span>
</template>

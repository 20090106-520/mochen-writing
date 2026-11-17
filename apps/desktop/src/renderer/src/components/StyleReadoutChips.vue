<!-- 读数胶囊（2026-11-16）：编辑器页脚与「去 AI 味」浮层共用。
     数字与文案全部来自 utils/style-readout（真身在 @mochen/contracts）；
     组件只负责把 label / value 摆成一行，悬停说明放在 title 上。 -->
<script setup lang="ts">
import type { ReadoutChip } from "../utils/style-readout";

defineProps<{ chips: ReadoutChip[] }>();
</script>

<template>
  <span class="style-chips" role="list" aria-label="腔调读数">
    <span
      v-for="chip in chips"
      :key="chip.key"
      class="style-chip"
      role="listitem"
      :title="chip.hint"
    >
      <b class="style-chip-label">{{ chip.label }}</b
      >{{ chip.value }}
    </span>
  </span>
</template>

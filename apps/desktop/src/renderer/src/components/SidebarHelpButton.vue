<!-- 左栏 footer 里的「?」：重新打开首次引导。
     引导末步说「随时可以点击左栏的「?」按钮重新查看这份引导」——所以那枚钮必须真的在这儿，
     而且调的是现成的 `onboarding.reopen()`（此前 reopen 全仓零生产调用方，是一具死函数）。

     为什么独立成组件而不是塞回 LeftSidebar：左栏贴着 800 行预算，而这一枚钮只管自己；
     它也只有「重新打开引导」这一个动作，与左栏其余导航无关。 -->
<script setup lang="ts">
import { useOnboardingStore } from "../stores/useOnboardingStore";

const onboarding = useOnboardingStore();

/** 重开引导：真身是 store 里的 reopen（它把状态拨回第一步并重新显示）。 */
function reopenOnboarding(): void {
  onboarding.reopen();
}
</script>

<template>
  <button
    class="icon-button account-help-button"
    type="button"
    aria-label="使用引导"
    title="使用引导"
    @click="reopenOnboarding"
  >
    ?
  </button>
</template>

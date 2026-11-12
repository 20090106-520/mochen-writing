<!-- 页面级的「这一页怎么算」折叠说明（2026-11-12）。

     【为什么要有这一件】
     技能库与皮肤广场的中栏里各躺着一段**六到九行的说明正文**，正文本身就是滤镜行与卡片之间
     最胖的一块：真机量到皮肤广场那九段合计 246.6px，卡片网格从 y=670 才开始，902px 高的窗口
     首屏只看得到一排卡。说明是真的（「一套皮肤 = 三色 + 四层 + 一层画面 + 一枚挂件」「挂入
     只对当前会话生效」），但它是**入场条件**，不是参观内容 —— 一直摊开就是把说明书摊在展厅门口。

     【为什么用原生 `<details>`】
     折叠这种东西自己写就是重造：展开态、键盘（Enter/Space）、屏读器「已收起/已展开」、
     浏览器内建的「Ctrl+F 命中折叠内容会自动展开」，全都要自己补一遍。`<details>` 一样不落，
     而且**不需要一个 keydown 监听**——裁定 G5（全局按键只有 `useHotkeys` 一处）在这里天然满足，
     `hotkey-markers.test.ts` 不会红。

     【为什么说明正文不搬走】
     说明里每一句都被守卫逐句钉着（`appearance-skin-plaza-wiring.test.ts` 有九条、
     `extensions-page-wiring.test.ts` 也认 `.extensions-note` 这个类）。这一件只换**外壳**：
     正文原样留在 `<slot />` 里、类名一个不改，守卫读源码照样读得到，CSS 也照样命中。
     收起只是视觉上不占位，不是把这九句从页面上抹掉。

     【为什么标题里要写具体的事】
     「说明」「了解更多」这种标题等于没说，用户得点开才知道值不值那一次点击。
     标题写的必须是**这一段答的那个问题**：「挂入、设为默认、停用各管什么」比「使用说明」有用得多。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

defineProps<{
  /** 收起时可见的那一行。写「这一段答的是什么问题」，不要写「说明」。 */
  summary: string;
}>();
</script>

<template>
  <details class="page-note">
    <summary class="page-note-summary">
      <AppIcon class="page-note-icon" name="info" :size="14" />
      <span class="page-note-label">{{ summary }}</span>
      <AppIcon class="page-note-caret" name="chevron" :size="11" />
    </summary>
    <div class="page-note-body"><slot /></div>
  </details>
</template>

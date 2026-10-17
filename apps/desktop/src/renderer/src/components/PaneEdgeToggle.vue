<!-- 左栏收起后左缘那枚图标钮（2026-10-17 建，同日从竖排文字竖条改成纯图标）。
     「展开左侧栏」这个动作在这里只有这一份。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

/**
 * 只递「点了」，不自己碰 store——与 LeftSidebar 的 `@collapse` 同款：
 * 组件不知道左栏怎么开，装配层（App.vue）知道。
 */
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <!-- 观感一律借左栏自己那枚「收起左侧栏」（`LeftSidebar.vue` 的 `.icon-button`：
       32×32、7px 圆角、透明底、hover 才上底），同一族控件不写第二套样式——
       于是旁边那枚长什么样，它就长什么样，不再挂竖排文字（用户 2026-10-17 那句
       「就不要显示展开侧边栏了，就和旁边的那个一样，点一下就行了」）。
       本组件只负责**它落在哪儿**，那一条在 `styles.css` 的 `.pane-edge-toggle`。 -->
  <button
    class="icon-button pane-edge-toggle"
    type="button"
    aria-label="展开左侧栏"
    title="展开左侧栏"
    @click="emit('toggle')"
  >
    <AppIcon name="panel-left" :size="18" />
  </button>
</template>

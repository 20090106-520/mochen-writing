<!-- 源自 deepwrite，仅改 import 路径；其 logo 分支已删，品牌标记直接用 assets/brand 下的墨宸原图（未裁切）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { IconName } from "../types/icons";

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 });

/**
 * 描边补偿（2026-10-05 质感统一）：字形按 24 viewBox 画，浏览器会把描边跟着缩放——
 * 14px 的图标 1.8 描边只剩约 1px，在 1.5 倍屏上跌破一个设备像素，看起来发虚。
 * 小于 16px 时提到 2（换算后与 1.8@16 相当），16px 及以上维持 1.8 不变。
 */
const strokeWidth = computed(() => (props.size >= 16 ? 1.8 : 2));
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'minus'">
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
    <template v-else-if="name === 'directory'">
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.5 9h17" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4M4 16l4 4" />
    </template>
    <!-- 「更多操作」的省略号（本仓自造一枚）：三枚实心圆点，与 list 字形同一种描边语言。 -->
    <template v-else-if="name === 'ellipsis'">
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'eye'">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'model'">
      <path d="m12 3 7 4v10l-7 4-7-4V7z" />
      <path d="m5 7 7 4 7-4M12 11v10" />
    </template>
    <template v-else-if="name === 'wand'">
      <path d="m15 4 5 5L9 20H4v-5zM13 6l5 5" />
      <path d="M6 3v3M4.5 4.5h3M19 15v4M17 17h4" />
    </template>
    <template v-else-if="name === 'panel-left'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </template>
    <template v-else-if="name === 'panel-right'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </template>
    <template v-else-if="name === 'panel-top'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
    </template>
    <template v-else-if="name === 'pin'">
      <path d="m8 3 8 8M14.5 4.5l5 5-3 1-4.5 4.5-1 4-6-6 4-1 4.5-4.5zM9 17l-5 5" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="m9 6 6 6-6 6" />
    </template>
    <!-- 以下六枚为本仓自造（侧边栏功能导航，2026-10-04）：描边语言与其余字形一致（24 viewBox / 1.8）。 -->
    <template v-else-if="name === 'house'">
      <path d="M4 11 12 4l8 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-6h4v6" />
    </template>
    <template v-else-if="name === 'bot'">
      <rect x="5" y="8.5" width="14" height="10.5" rx="3" />
      <path d="M12 8.5V5M9 5h6" />
      <circle cx="9.3" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'map'">
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </template>
    <template v-else-if="name === 'pen'">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </template>
    <template v-else-if="name === 'shield'">
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4.5" />
    </template>
    <template v-else-if="name === 'chart'">
      <path d="M5 20v-7M11 20V5M17 20v-10" />
      <path d="M3 20h18" />
    </template>
    <template v-else-if="name === 'book'">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"
      />
    </template>
    <template v-else-if="name === 'library'">
      <path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.5-1 3.5 14-3.5 1z" />
    </template>
    <template v-else-if="name === 'list'">
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
      <path d="M9 7h10M9 12h10M9 17h10" />
    </template>
    <template v-else-if="name === 'archive'">
      <path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M6 3.5h8l4 4V20H6zM14 3.5V8h4" />
    </template>
    <template v-else-if="name === 'image'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m5 18 5-5 3 3 2-2 4 4" />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </template>
    <template v-else-if="name === 'ledger'">
      <path d="M5 3.5h14V21H5zM8 3.5v17M11 8h5M11 12h5M11 16h4" />
    </template>
    <template v-else-if="name === 'sparkles'">
      <path
        d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM5 13l.8 2.2 2.2.8-2.2.8L5 19l-.8-2.2L2 16l2.2-.8z"
      />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M4 6v5h5M4.8 10A8 8 0 1 1 6 17.5" />
      <path d="M12 8v5l3 2" />
    </template>
    <template v-else-if="name === 'message'">
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-1-2V7a2 2 0 0 1 2-2Z" />
    </template>
    <template v-else-if="name === 'attach'">
      <path d="m8.5 12.5 5.7-5.7a3 3 0 0 1 4.2 4.2l-7.8 7.8a5 5 0 0 1-7.1-7.1l7.8-7.8" />
    </template>
    <template v-else-if="name === 'brain'">
      <path
        d="M9.5 5.5A3 3 0 0 0 4.8 8a3.2 3.2 0 0 0 .2 6 3 3 0 0 0 4.5 3.5M14.5 5.5A3 3 0 0 1 19.2 8a3.2 3.2 0 0 1-.2 6 3 3 0 0 1-4.5 3.5M12 4v16M8 10h4M12 14h4"
      />
    </template>
    <template v-else-if="name === 'temperature'">
      <path d="M10 14.8V5a2 2 0 0 1 4 0v9.8a4 4 0 1 1-4 0Z" />
      <path d="M12 8v8" />
    </template>
    <template v-else-if="name === 'mic'">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </template>
    <template v-else-if="name === 'arrow-left'">
      <path d="m11 7-5 5 5 5M6 12h12" />
    </template>
    <template v-else-if="name === 'arrow-up'">
      <path d="m7 11 5-5 5 5M12 6v12" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </template>
    <template v-else-if="name === 'undo'">
      <path d="m9 7-5 5 5 5" />
      <path d="M4 12h9a7 7 0 0 1 7 7" />
    </template>
    <template v-else-if="name === 'redo'">
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12h-9a7 7 0 0 0-7 7" />
    </template>
    <template v-else-if="name === 'replace'">
      <path d="M4 7h14m0 0-3-3m3 3-3 3" />
      <path d="M20 17H6m0 0 3-3m-3 3 3 3" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </template>
    <template v-else-if="name === 'save'">
      <path d="M5 3.5h12l2 2V20H5zM8 3.5v6h8v-6M8 20v-6h8v6" />
    </template>
    <template v-else-if="name === 'bold'">
      <path d="M8 5h5a4 4 0 0 1 0 8H8zM8 13h6a3.5 3.5 0 0 1 0 7H8z" />
    </template>
    <template v-else-if="name === 'italic'">
      <path d="M10 4h8M6 20h8M14 4 10 20" />
    </template>
    <!-- 「标题」的字形是本仓自造的一枚（deepwrite 的图标表里没有标题）：两竖一横的 H，
         不带层级数字——我们插入的是 `## `，画个 1 就成了假话。描边语言与其余字形一致。 -->
    <template v-else-if="name === 'heading'">
      <path d="M5 5v14M19 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'keyboard'">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </template>
    <template v-else-if="name === 'quote'">
      <path d="M5 8h5v5H6a4 4 0 0 1 4-4M14 8h5v5h-4a4 4 0 0 1 4-4" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12 4 4L19 6" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="11" height="12" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3" />
    </template>
    <template v-else-if="name === 'terminal'">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
    </template>
  </svg>
</template>

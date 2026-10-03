<!-- 右栏「作品资料」只读摘要：小说信息 + 按 kind 分组的文档卡。判断都在 utils，本组件只接线。 -->
<script setup lang="ts">
import type { DossierGroup, DossierSummary } from "../utils/book-dossier";

defineProps<{ summary: DossierSummary | null; groups: DossierGroup[] }>();
</script>

<template>
  <section class="book-dossier transient-scrollbar" aria-label="作品资料">
    <div v-if="!summary" class="dossier-empty">
      <p>还没打开作品目录。在左栏点「打开作品目录」，这里就会列出这本书的资料。</p>
    </div>
    <template v-else>
      <header class="dossier-meta">
        <h2 class="dossier-title">{{ summary.title }}</h2>
        <p class="dossier-facts">
          当前阶段：{{ summary.stageName }} · 权限档：{{ summary.permissionLabel }} · 章节
          {{ summary.chapterCount }} 篇 · 正文 {{ summary.chapterChars.toLocaleString("zh-CN") }} 字
        </p>
      </header>
      <div v-if="groups.length === 0" class="dossier-empty">
        <p>这本书里还没有归类好的文稿。</p>
      </div>
      <section v-for="group in groups" :key="group.kind" class="dossier-group">
        <h3 class="dossier-group-heading">{{ group.label }}</h3>
        <ul class="dossier-doc-list">
          <li v-for="doc in group.docs" :key="doc.relPath" class="dossier-doc-card">
            <span class="dossier-doc-title">{{ doc.title }}</span>
            <span class="dossier-doc-excerpt">{{ doc.excerpt ?? "" }}</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

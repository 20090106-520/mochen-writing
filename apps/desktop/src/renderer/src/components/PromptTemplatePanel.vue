<!-- 提示词模板面板：展示分类、搜索、一键填入输入框 -->
<script setup lang="ts">
import { computed, ref, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import { usePromptTemplateStore } from "../stores/usePromptTemplateStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: []; apply: [text: string] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊲）。
 * 这一层是整屏遮罩 + role="dialog"，功能上就是模态层；真机量测（p536g）实测六处一模一样：
 * 焦点从不在层内、Esc 一次也收不掉（连 OutlinePanel 那一处 @keydown.esc 也够不着——
 * 它挂在搜索框上，而焦点压根没进过面板）。
 * Esc 与焦点进出统一由那一处接管，本组件不再留第二份判定。
 */
const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const tplStore = usePromptTemplateStore();
const notif = useNotificationStore();

const { categories, recentlyUsed } = storeToRefs(tplStore);

const activeCategory = ref("continue");
const searchQuery = ref("");
const showCreateForm = ref(false);
const newTplName = ref("");
const newTplContent = ref("");
const newTplDesc = ref("");
const newTplCategory = ref("custom");

const filteredTemplates = computed(() => {
  if (searchQuery.value.trim()) {
    return tplStore.searchTemplates(searchQuery.value);
  }
  return tplStore.getTemplatesByCategory(activeCategory.value);
});

watch(
  () => props.visible,
  (vis) => {
    if (!vis) {
      showCreateForm.value = false;
      searchQuery.value = "";
    }
  }
);

function formatVars(content: string): string {
  return content.replace(/\{\{(\w+)\}\}/g, "…");
}

function applyTemplate(id: string): void {
  // 简单替换：{{text}} → 当前输入框内容（若为空则保留占位提示）
  const result = tplStore.applyTemplate(id);
  if (!result) return;
  emit("apply", result);
  emit("close");
  notif.notify({
    title: "已填入",
    message: "模板内容已填入输入框，可直接编辑后发送",
    level: "info"
  });
}

function createTemplate(): void {
  if (!newTplName.value.trim() || !newTplContent.value.trim()) return;
  tplStore.createTemplate({
    name: newTplName.value.trim(),
    category: newTplCategory.value,
    content: newTplContent.value.trim(),
    description: newTplDesc.value.trim()
  });
  newTplName.value = "";
  newTplContent.value = "";
  newTplDesc.value = "";
  showCreateForm.value = false;
  notif.notify({
    title: "模板已创建",
    message: "已添加到自定义模板库",
    level: "success"
  });
}

function deleteUserTemplate(id: string): void {
  tplStore.deleteTemplate(id);
}

function cloneTemplate(id: string, name: string): void {
  tplStore.cloneBuiltin(id, `${name}（副本）`);
}
</script>

<template>
  <div v-if="visible" class="tpl-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="tpl-panel"
      role="dialog"
      aria-modal="true"
      aria-label="提示词模板"
      tabindex="-1"
    >
      <header class="tpl-header">
        <h3>提示词模板</h3>
        <div class="tpl-header-actions">
          <button
            class="icon-btn"
            type="button"
            title="新建模板"
            @click="showCreateForm = !showCreateForm"
          >
            <AppIcon name="plus" :size="14" />
          </button>
          <button class="icon-btn" type="button" @click="emit('close')">
            <AppIcon name="close" :size="14" />
          </button>
        </div>
      </header>

      <!-- 搜索 -->
      <div class="tpl-search">
        <AppIcon name="search" :size="13" />
        <input v-model="searchQuery" type="text" placeholder="搜索模板…" class="tpl-search-input" />
      </div>

      <!-- 分类标签 -->
      <nav v-if="!searchQuery" class="tpl-categories">
        <button
          :class="['tpl-cat-btn', { 'is-active': activeCategory === 'recent' }]"
          type="button"
          @click="activeCategory = 'recent'"
        >
          最近使用
        </button>
        <button
          v-for="cat in categories"
          :key="cat.id"
          :class="['tpl-cat-btn', { 'is-active': activeCategory === cat.id }]"
          type="button"
          @click="activeCategory = cat.id"
        >
          {{ cat.name }}
        </button>
      </nav>

      <!-- 新建模板表单 -->
      <div v-if="showCreateForm" class="tpl-create-form">
        <input v-model="newTplName" type="text" placeholder="模板名称" class="tpl-create-input" />
        <select v-model="newTplCategory" class="tpl-create-select">
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">
            {{ cat.name }}
          </option>
        </select>
        <textarea
          v-model="newTplContent"
          placeholder="模板内容（可用 {{text}} 作为占位符）"
          rows="4"
          class="tpl-create-textarea"
        />
        <input
          v-model="newTplDesc"
          type="text"
          placeholder="简短描述（可选）"
          class="tpl-create-input"
        />
        <div class="tpl-create-actions">
          <button class="is-primary" type="button" @click="createTemplate">保存</button>
          <button type="button" @click="showCreateForm = false">取消</button>
        </div>
      </div>

      <!-- 模板列表 -->
      <div class="tpl-list">
        <div v-if="searchQuery && filteredTemplates.length === 0" class="tpl-empty">
          没有找到「{{ searchQuery }}」相关的模板。
        </div>

        <!-- 最近使用 -->
        <div v-else-if="activeCategory === 'recent' && !searchQuery">
          <div v-if="recentlyUsed.length === 0" class="tpl-empty">还没有使用过模板。</div>
          <div v-else class="tpl-card-list">
            <article v-for="tpl in recentlyUsed" :key="tpl.id" class="tpl-card">
              <div class="tpl-card-head">
                <span class="tpl-card-name">{{ tpl.name }}</span>
                <span class="tpl-card-count">使用 {{ tpl.usageCount }} 次</span>
              </div>
              <p class="tpl-card-preview">{{ formatVars(tpl.content.slice(0, 120)) }}…</p>
              <footer class="tpl-card-actions">
                <button class="is-primary" type="button" @click="applyTemplate(tpl.id)">
                  填入
                </button>
                <button type="button" @click="cloneTemplate(tpl.id, tpl.name)">复制</button>
              </footer>
            </article>
          </div>
        </div>

        <!-- 分类模板 -->
        <div v-else class="tpl-card-list">
          <div
            v-for="tpl in filteredTemplates"
            :key="tpl.id"
            class="tpl-card"
            :class="{ 'is-builtin': tpl.builtin }"
          >
            <div class="tpl-card-head">
              <span class="tpl-card-name">{{ tpl.name }}</span>
              <span v-if="tpl.builtin" class="tpl-badge">内置</span>
            </div>
            <p v-if="tpl.description" class="tpl-card-desc">{{ tpl.description }}</p>
            <p class="tpl-card-preview">{{ formatVars(tpl.content.slice(0, 120)) }}…</p>
            <footer class="tpl-card-actions">
              <button class="is-primary" type="button" @click="applyTemplate(tpl.id)">填入</button>
              <button v-if="tpl.builtin" type="button" @click="cloneTemplate(tpl.id, tpl.name)">
                复制
              </button>
              <button v-else type="button" @click="deleteUserTemplate(tpl.id)">删除</button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpl-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-drawer);
}

.tpl-panel {
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tpl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.tpl-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary, #e8e8e8);
}

.tpl-header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.icon-btn:hover {
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 6%, transparent);
}

.tpl-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px;
  padding: 6px 10px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  color: var(--text-muted, #777);
}

.tpl-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.857143rem;
}

.tpl-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px 8px;
}

.tpl-cat-btn {
  padding: 4px 10px;
  font-size: 0.785714rem;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.tpl-cat-btn.is-active {
  background: rgba(108, 158, 255, 0.12);
  border-color: var(--accent, #6c9eff);
  color: var(--text-primary, #e8e8e8);
}

.tpl-create-form {
  margin: 0 12px 8px;
  padding: 10px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 2%, transparent);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tpl-create-input,
.tpl-create-select {
  padding: 6px 8px;
  font-size: 0.857143rem;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  color: var(--text-primary, #e8e8e8);
  outline: none;
}

.tpl-create-textarea {
  padding: 6px 8px;
  font-size: 0.857143rem;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  color: var(--text-primary, #e8e8e8);
  resize: vertical;
  outline: none;
  font-family: inherit;
  line-height: 1.4;
}

.tpl-create-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.tpl-create-actions button {
  padding: 4px 10px;
  font-size: 0.785714rem;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.tpl-create-actions button.is-primary {
  background: var(--accent, #6c9eff);
  color: #fff;
  border-color: var(--accent, #6c9eff);
}

.tpl-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 12px;
}

.tpl-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 0.857143rem;
  color: var(--text-muted, #777);
}

.tpl-card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tpl-card {
  padding: 10px 12px;
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 2%, transparent);
}

.tpl-card.is-builtin {
  border-left: 2px solid rgba(108, 158, 255, 0.4);
}

.tpl-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
}

.tpl-card-name {
  font-size: 0.928571rem;
  color: var(--text-primary, #e8e8e8);
  font-weight: 500;
}

.tpl-card-count,
.tpl-badge {
  font-size: 0.714286rem;
  color: var(--text-muted, #777);
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
}

.tpl-badge {
  color: var(--accent, #6c9eff);
  background: rgba(108, 158, 255, 0.08);
}

.tpl-card-desc {
  margin: 0 0 4px;
  font-size: 0.785714rem;
  color: var(--accent, #6c9eff);
}

.tpl-card-preview {
  margin: 0 0 6px;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  line-height: 1.4;
  font-family: ui-monospace, "SF Mono", monospace;
  white-space: pre-wrap;
}

.tpl-card-actions {
  display: flex;
  gap: 6px;
}

.tpl-card-actions button {
  padding: 3px 10px;
  font-size: 0.785714rem;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.tpl-card-actions button.is-primary {
  background: var(--accent, #6c9eff);
  color: #fff;
  border-color: var(--accent, #6c9eff);
}
</style>

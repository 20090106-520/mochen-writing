<!-- 故事圣经面板：浮层侧边栏，管理世界观设定（人物、地点、时间线事件） -->
<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import {
  useStoryBibleStore,
  BIBLE_COLORS,
  type BibleEntry,
  type BibleEntryType
} from "../stores/useStoryBibleStore";
import { useModalFocus } from "../composables/useModalFocus";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊲）。
 * 这一层是整屏遮罩 + role="dialog"，功能上就是模态层；真机量测（p536g）实测六处一模一样：
 * 焦点从不在层内、Esc 一次也收不掉。
 * Esc 与焦点进出统一由那一处接管，本组件不再留第二份判定。
 */
const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const bible = useStoryBibleStore();

const filterTab = ref<"all" | BibleEntryType>("all");
const searchQuery = ref("");
const selectedId = ref<string | null>(null);
const editingId = ref<string | null>(null);

// 编辑态草稿
const editTitle = ref("");
const editContent = ref("");
const editTags = ref("");
const editColor = ref<string | undefined>(undefined);
const editAliases = ref("");
const editRole = ref("");
const editParentLocation = ref("");
const editEventDate = ref("");
const editImportance = ref<"high" | "medium" | "low">("medium");

// 新建态
const showNewForm = ref(false);
const newType = ref<BibleEntryType>("character");
const newTitle = ref("");
const newContent = ref("");

watch(
  () => props.visible,
  (vis) => {
    if (!vis) {
      editingId.value = null;
      showNewForm.value = false;
    }
  }
);

// 过滤后的条目列表
const filteredEntries = computed(() => {
  let list: BibleEntry[];
  if (searchQuery.value.trim()) {
    list = bible.searchEntries(searchQuery.value);
  } else {
    list = bible.activeEntries;
  }
  if (filterTab.value !== "all") {
    list = list.filter((e) => e.type === filterTab.value);
  }
  return list;
});

const selectedEntry = computed(
  () => filteredEntries.value.find((e) => e.id === selectedId.value) ?? null
);

function selectEntry(entry: BibleEntry): void {
  selectedId.value = entry.id;
  editingId.value = null;
}

function startEdit(entry: BibleEntry): void {
  editingId.value = entry.id;
  editTitle.value = entry.title;
  editContent.value = entry.content;
  editTags.value = entry.tags.join(", ");
  editColor.value = entry.color;
  if (entry.type === "character") {
    editAliases.value = (entry.aliases ?? []).join(", ");
    editRole.value = entry.role ?? "";
  }
  if (entry.type === "location") {
    editParentLocation.value = entry.parentLocation ?? "";
  }
  if (entry.type === "timeline") {
    editEventDate.value = entry.eventDate ?? "";
    editImportance.value = entry.importance ?? "medium";
  }
}

function saveEdit(): void {
  const id = editingId.value;
  if (!id) return;
  const entry = bible.entries.find((e) => e.id === id);
  if (!entry) return;

  const partial: Partial<BibleEntry> = {
    title: editTitle.value.trim() || "未命名",
    content: editContent.value,
    tags: editTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    color: editColor.value
  };

  if (entry.type === "character") {
    partial.aliases = editAliases.value
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    partial.role = editRole.value.trim() || undefined;
  }
  if (entry.type === "location") {
    partial.parentLocation = editParentLocation.value.trim() || undefined;
  }
  if (entry.type === "timeline") {
    partial.eventDate = editEventDate.value.trim() || undefined;
    partial.importance = editImportance.value;
  }

  bible.updateEntry(id, partial);
  editingId.value = null;
}

function cancelEdit(): void {
  editingId.value = null;
}

function confirmDelete(entry: BibleEntry): void {
  bible.removeEntry(entry.id);
  if (selectedId.value === entry.id) {
    selectedId.value = null;
    editingId.value = null;
  }
}

function createEntry(): void {
  if (!newTitle.value.trim()) return;
  const entry = bible.addEntry(newType.value, newTitle.value, newContent.value, {
    tags: []
  });
  showNewForm.value = false;
  newTitle.value = "";
  newContent.value = "";
  selectedId.value = entry.id;
}

function toggleColor(current: string | undefined, color: string): string | undefined {
  return current === color ? undefined : color;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

const typeLabel: Record<BibleEntryType, string> = {
  character: "人物",
  location: "地点",
  timeline: "时间线"
};

const importanceLabel: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低"
};
</script>

<template>
  <div v-if="visible" class="bible-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="bible-panel"
      role="dialog"
      aria-modal="true"
      aria-label="故事圣经"
      tabindex="-1"
    >
      <!-- 顶部栏 -->
      <header class="bible-header">
        <div class="bible-header-left">
          <AppIcon name="ledger" :size="16" />
          <h3>故事圣经</h3>
        </div>
        <div class="bible-header-actions">
          <button
            class="icon-btn"
            type="button"
            title="新建条目"
            @click="showNewForm = !showNewForm"
          >
            <AppIcon name="plus" :size="14" />
          </button>
          <button class="icon-btn" type="button" title="关闭" @click="emit('close')">
            <AppIcon name="close" :size="14" />
          </button>
        </div>
      </header>

      <!-- Filter Tabs -->
      <nav class="bible-tabs">
        <button
          v-for="t in ['all', 'character', 'location', 'timeline'] as const"
          :key="t"
          :class="['bible-tab', { 'is-active': filterTab === t }]"
          type="button"
          @click="filterTab = t"
        >
          {{ t === "all" ? "全部" : typeLabel[t] }}
        </button>
      </nav>

      <!-- 新建表单 -->
      <div v-if="showNewForm" class="bible-new-form">
        <div class="bible-new-type">
          <button
            v-for="t in ['character', 'location', 'timeline'] as const"
            :key="t"
            :class="['type-chip', { 'is-active': newType === t }]"
            type="button"
            @click="newType = t"
          >
            {{ typeLabel[t] }}
          </button>
        </div>
        <input
          v-model="newTitle"
          type="text"
          class="bible-input"
          :placeholder="`${typeLabel[newType]}名称…`"
        />
        <textarea v-model="newContent" class="bible-textarea" rows="3" placeholder="描述内容…" />
        <div class="bible-new-actions">
          <button class="btn-primary" type="button" @click="createEntry">创建</button>
          <button class="btn-ghost" type="button" @click="showNewForm = false">取消</button>
        </div>
      </div>

      <!-- 主体两栏 -->
      <div class="bible-body">
        <!-- 左侧列表 -->
        <aside class="bible-list-pane">
          <div class="bible-search">
            <AppIcon name="search" :size="13" />
            <input
              v-model="searchQuery"
              type="text"
              class="bible-search-input"
              placeholder="搜索人物、地点、事件…"
            />
          </div>
          <div class="bible-list">
            <div v-if="filteredEntries.length === 0" class="bible-empty">没有匹配的条目</div>
            <button
              v-for="entry in filteredEntries"
              :key="entry.id"
              :class="['bible-list-item', { 'is-selected': selectedId === entry.id }]"
              type="button"
              :style="entry.color ? { '--entry-color': entry.color } : undefined"
              @click="selectEntry(entry)"
            >
              <span
                class="bible-dot"
                :style="entry.color ? { background: entry.color } : undefined"
              />
              <span class="bible-item-text">
                <span class="bible-item-title">{{ entry.title }}</span>
                <span class="bible-item-meta">
                  <span class="bible-type-tag">{{ typeLabel[entry.type] }}</span>
                  <span class="bible-item-time">{{ formatTime(entry.updatedAt) }}</span>
                </span>
              </span>
            </button>
          </div>
        </aside>

        <!-- 右侧详情/编辑 -->
        <main class="bible-detail-pane">
          <template v-if="selectedEntry">
            <!-- 编辑态 -->
            <div v-if="editingId === selectedEntry.id" class="bible-edit">
              <div class="bible-edit-field">
                <label>名称</label>
                <input v-model="editTitle" type="text" class="bible-input" />
              </div>

              <!-- 人物专属字段 -->
              <template v-if="selectedEntry.type === 'character'">
                <div class="bible-edit-field">
                  <label>别名</label>
                  <input
                    v-model="editAliases"
                    type="text"
                    class="bible-input"
                    placeholder="逗号分隔多个别名"
                  />
                </div>
                <div class="bible-edit-field">
                  <label>角色身份</label>
                  <input
                    v-model="editRole"
                    type="text"
                    class="bible-input"
                    placeholder="主角 / 反派 / 配角"
                  />
                </div>
              </template>

              <!-- 地点专属字段 -->
              <template v-if="selectedEntry.type === 'location'">
                <div class="bible-edit-field">
                  <label>上级地点</label>
                  <input
                    v-model="editParentLocation"
                    type="text"
                    class="bible-input"
                    placeholder="所属区域 / 国家"
                  />
                </div>
              </template>

              <!-- 时间线专属字段 -->
              <template v-if="selectedEntry.type === 'timeline'">
                <div class="bible-edit-field">
                  <label>事件日期</label>
                  <input
                    v-model="editEventDate"
                    type="text"
                    class="bible-input"
                    placeholder="故事内日期描述"
                  />
                </div>
                <div class="bible-edit-field">
                  <label>重要度</label>
                  <div class="bible-importance-toggle">
                    <button
                      v-for="imp in ['high', 'medium', 'low'] as const"
                      :key="imp"
                      :class="[
                        'importance-btn',
                        `is-${imp}`,
                        { 'is-active': editImportance === imp }
                      ]"
                      type="button"
                      @click="editImportance = imp"
                    >
                      {{ importanceLabel[imp] }}
                    </button>
                  </div>
                </div>
              </template>

              <div class="bible-edit-field">
                <label>描述</label>
                <textarea v-model="editContent" class="bible-textarea" rows="6" />
              </div>

              <div class="bible-edit-field">
                <label>标签</label>
                <input
                  v-model="editTags"
                  type="text"
                  class="bible-input"
                  placeholder="逗号分隔标签"
                />
              </div>

              <div class="bible-edit-field">
                <label>颜色标记</label>
                <div class="bible-color-picker">
                  <button
                    v-for="color in BIBLE_COLORS"
                    :key="color"
                    :class="['bible-color-dot', { 'is-active': editColor === color }]"
                    type="button"
                    :style="{ background: color }"
                    @click="editColor = toggleColor(editColor, color)"
                  />
                  <button
                    v-if="editColor"
                    class="bible-color-clear"
                    type="button"
                    @click="editColor = undefined"
                  >
                    清除
                  </button>
                </div>
              </div>

              <div class="bible-edit-actions">
                <button class="btn-primary" type="button" @click="saveEdit">保存</button>
                <button class="btn-ghost" type="button" @click="cancelEdit">取消</button>
              </div>
            </div>

            <!-- 展示态 -->
            <div v-else class="bible-detail">
              <div class="bible-detail-head">
                <span
                  v-if="selectedEntry.color"
                  class="bible-detail-dot"
                  :style="{ background: selectedEntry.color }"
                />
                <h4 class="bible-detail-title">{{ selectedEntry.title }}</h4>
                <span class="bible-detail-type">{{ typeLabel[selectedEntry.type] }}</span>
                <div class="bible-detail-actions">
                  <button
                    class="icon-btn"
                    type="button"
                    title="编辑"
                    @click="startEdit(selectedEntry)"
                  >
                    <AppIcon name="pen" :size="13" />
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    title="归档"
                    @click="bible.archiveEntry(selectedEntry.id)"
                  >
                    <AppIcon name="archive" :size="13" />
                  </button>
                  <button
                    class="icon-btn-danger"
                    type="button"
                    title="删除"
                    @click="confirmDelete(selectedEntry)"
                  >
                    <AppIcon name="trash" :size="13" />
                  </button>
                </div>
              </div>

              <!-- 人物元信息 -->
              <div v-if="selectedEntry.type === 'character'" class="bible-meta-grid">
                <div v-if="selectedEntry.aliases?.length" class="bible-meta-item">
                  <span class="bible-meta-label">别名</span>
                  <span class="bible-meta-value">{{ selectedEntry.aliases.join("、") }}</span>
                </div>
                <div v-if="selectedEntry.role" class="bible-meta-item">
                  <span class="bible-meta-label">身份</span>
                  <span class="bible-meta-value">{{ selectedEntry.role }}</span>
                </div>
              </div>

              <!-- 地点元信息 -->
              <div
                v-if="selectedEntry.type === 'location' && selectedEntry.parentLocation"
                class="bible-meta-grid"
              >
                <div class="bible-meta-item">
                  <span class="bible-meta-label">上级地点</span>
                  <span class="bible-meta-value">{{ selectedEntry.parentLocation }}</span>
                </div>
              </div>

              <!-- 时间线元信息 -->
              <div v-if="selectedEntry.type === 'timeline'" class="bible-meta-grid">
                <div v-if="selectedEntry.eventDate" class="bible-meta-item">
                  <span class="bible-meta-label">事件日期</span>
                  <span class="bible-meta-value">{{ selectedEntry.eventDate }}</span>
                </div>
                <div v-if="selectedEntry.importance" class="bible-meta-item">
                  <span class="bible-meta-label">重要度</span>
                  <span :class="['bible-importance-badge', `is-${selectedEntry.importance}`]">
                    {{ importanceLabel[selectedEntry.importance] }}
                  </span>
                </div>
              </div>

              <p class="bible-detail-content">{{ selectedEntry.content }}</p>

              <div v-if="selectedEntry.tags.length" class="bible-detail-tags">
                <span v-for="tag in selectedEntry.tags" :key="tag" class="bible-tag">
                  {{ tag }}
                </span>
              </div>

              <div class="bible-detail-footer">
                <span>更新于 {{ formatTime(selectedEntry.updatedAt) }}</span>
              </div>
            </div>
          </template>

          <!-- 未选中 -->
          <div v-else class="bible-no-selection">
            <AppIcon name="ledger" :size="32" />
            <p>选择左侧条目查看详情</p>
            <span>或点击右上角 + 新建设定条目</span>
          </div>
        </main>
      </div>

      <!-- 底部快捷键提示 -->
      <footer class="bible-footer">
        <span><kbd>Esc</kbd> 关闭</span>
      </footer>
    </div>
  </div>
</template>

<style scoped src="./story-bible-panel.css"></style>

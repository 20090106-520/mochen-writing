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
import {
  BIBLE_SCOPES,
  BIBLE_TYPE_LABEL,
  bibleScopeEmptyText,
  visibleEntries,
  type BibleScope
} from "../utils/bible-scope";
import { parseTags } from "../utils/tag-input";
import { useModalFocus } from "../composables/useModalFocus";
import { BIBLE_DIVISION_NOTE } from "../utils/bible-brief";

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

/** 档位是 `BIBLE_SCOPES` 那五档（含「已归档」——归档不再是单向门）。 */
const filterTab = ref<BibleScope>("all");
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
const editVoice = ref("");
const editTaboo = ref("");
const editArc = ref("");
const editParentLocation = ref("");
const editEventDate = ref("");
const editImportance = ref<"high" | "medium" | "low">("medium");

// 新建态：类型、名称、描述、标签四件都能真的落库（建完直接进编辑态补类型专属字段）
const showNewForm = ref(false);
const newType = ref<BibleEntryType>("character");
const newTitle = ref("");
const newContent = ref("");
const newTags = ref("");

watch(
  () => props.visible,
  (vis) => {
    if (!vis) {
      editingId.value = null;
      showNewForm.value = false;
      newTags.value = "";
    }
  }
);

/**
 * 列表 = 档位 + 搜索叠在一起，判定住在 `utils/bible-scope`。
 * 旧写法是「store 的 searchEntries 或 activeEntries，再按类型 filter」，而归档件根本进不了这个视图——
 * 所以点过归档的条目既看不见也取不回。
 */
const filteredEntries = computed(() =>
  visibleEntries(
    filterTab.value,
    { active: bible.activeEntries, archived: bible.archivedEntries },
    searchQuery.value
  )
);

/**
 * 详情按 id 在**全量**里查，不在"筛完的列表"里查。
 *
 * 旧写法 `filteredEntries.find(...)` 有一个真实后果：选中一条人物后切到「地点」那一档，
 * 右侧整块立刻变成"未选中"占位——用户以为条目丢了，其实只是筛选把它挡掉了。
 */
const selectedEntry = computed(() => bible.entries.find((e) => e.id === selectedId.value) ?? null);

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
    editVoice.value = entry.voice ?? "";
    editTaboo.value = entry.taboo ?? "";
    editArc.value = entry.arc ?? "";
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
    // 标签与别名共用 `utils/tag-input` 那一份切法：中文逗号也认、去重、不产空标签。
    // 这里原本手抄了两份 `.split(",")`，作者用中文输入法打「伏笔，转折」就会被存成一整条。
    tags: parseTags(editTags.value),
    color: editColor.value
  };

  if (entry.type === "character") {
    partial.aliases = parseTags(editAliases.value);
    partial.role = editRole.value.trim() || undefined;
    // W-09 三格：留空就删掉（undefined），不做「空字符串也算设定」的半吊子状态。
    partial.voice = editVoice.value.trim() || undefined;
    partial.taboo = editTaboo.value.trim() || undefined;
    partial.arc = editArc.value.trim() || undefined;
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
    tags: parseTags(newTags.value)
  });
  showNewForm.value = false;
  newTitle.value = "";
  newContent.value = "";
  newTags.value = "";
  selectedId.value = entry.id;
  /*
   * 建完直接进编辑态。新建表单只收类型、名称、描述、标签四件，而人物别名/身份、地点上级、
   * 时间线日期与重要度这些**类型专属字段**只有编辑态才有输入框——不自动进编辑态，
   * 用户要么不知道有这些字段，要么得再点一次"编辑"。
   */
  startEdit(entry);
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

/** 类型标签的唯一一份在 `utils/bible-scope`；这里只留一个别名给模板用，避免第二处定义。 */
const typeLabel = BIBLE_TYPE_LABEL;

const emptyText = computed(() =>
  bibleScopeEmptyText({
    scope: filterTab.value,
    libraryEmpty: bible.activeEntries.length === 0,
    query: searchQuery.value
  })
);

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

      <!-- W-01：两套设定的分工写在这里，与输入卡弹层同读一句（不许各写一份）。 -->
      <p class="bible-division-note">{{ BIBLE_DIVISION_NOTE }}</p>

      <!-- Filter Tabs：档位表来自 utils/bible-scope，第五档「已归档」把取回通路摆在明面上 -->
      <nav class="bible-tabs">
        <button
          v-for="s in BIBLE_SCOPES"
          :key="s.id"
          :class="['bible-tab', { 'is-active': filterTab === s.id }]"
          type="button"
          @click="filterTab = s.id"
        >
          {{ s.label }}
        </button>
      </nav>

      <!-- 落盘失败必须上屏（P0-7）：原因住在 store.saveError，这一行是它唯一的出口。
           设定存不进这本书的目录时，条目列表照涨——屏上看着像存好了，盘上什么都没有。 -->
      <p v-if="bible.saveError" class="bible-save-error" role="status" aria-live="polite">
        {{ bible.saveError }}
      </p>

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
        <input
          v-model="newTags"
          type="text"
          class="bible-input"
          placeholder="标签，逗号分隔（可留空）"
        />
        <p class="bible-new-hint">
          创建后直接进编辑态，可以补上「{{ typeLabel[newType] }}」的专属字段。
        </p>
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
            <!-- 空态两行按状态分岔：整库空、这一档空、还是在搜一个筛不出来的词，是三件事 -->
            <div v-if="filteredEntries.length === 0" class="bible-empty">
              <p class="bible-empty-title">{{ emptyText.title }}</p>
              <p class="bible-empty-hint">{{ emptyText.hint }}</p>
            </div>
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
                <span class="bible-item-title" :title="entry.title">{{ entry.title }}</span>
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
                <!-- W-09 嗓音三格：写下来就会带进这一章的上下文，不写不影响老存档 -->
                <div class="bible-edit-field">
                  <label>说话风格</label>
                  <input
                    v-model="editVoice"
                    type="text"
                    class="bible-input"
                    placeholder="寡言、短句、从不说「请」"
                  />
                </div>
                <div class="bible-edit-field">
                  <label>绝不会做</label>
                  <input
                    v-model="editTaboo"
                    type="text"
                    class="bible-input"
                    placeholder="不哭、不求人、不解释自己"
                  />
                </div>
                <div class="bible-edit-field">
                  <label>本卷变化</label>
                  <input
                    v-model="editArc"
                    type="text"
                    class="bible-input"
                    placeholder="从独行到肯把后背交给别人"
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
                    v-if="selectedEntry.archived"
                    class="icon-btn bible-restore-btn"
                    type="button"
                    title="把这条取回设定列表"
                    @click="bible.restoreEntry(selectedEntry.id)"
                  >
                    取回
                  </button>
                  <button
                    v-else
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
                <div v-if="selectedEntry.voice" class="bible-meta-item">
                  <span class="bible-meta-label">说话</span>
                  <span class="bible-meta-value">{{ selectedEntry.voice }}</span>
                </div>
                <div v-if="selectedEntry.taboo" class="bible-meta-item">
                  <span class="bible-meta-label">绝不做</span>
                  <span class="bible-meta-value">{{ selectedEntry.taboo }}</span>
                </div>
                <div v-if="selectedEntry.arc" class="bible-meta-item">
                  <span class="bible-meta-label">本卷变化</span>
                  <span class="bible-meta-value">{{ selectedEntry.arc }}</span>
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

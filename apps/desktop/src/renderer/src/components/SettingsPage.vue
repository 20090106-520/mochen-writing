<!-- 整页设置中心：骨架（侧栏分组导航 + 搜索过滤 + 内容区大标题）取自 deepwrite
     的 SettingsPage.vue，规模裁到本仓真实功能。
     页签真身仍是 layout.settingsTab（左栏入口 / Ctrl+, / /model 决定打开哪一页），
     关闭真身是 layout.showWorkspace（Esc 裁决链的 close-overlay 派到这里）。
  面板：模型 ProviderSettings / 智能体 AgentSettingsPanel / 外观 AppearancePanel /
  写作 WritingPanel / 快捷键 HotkeysPanel / 关于 AboutPanel。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import AppIcon from "./AppIcon.vue";
import AgentSettingsPanel from "./AgentSettingsPanel.vue";
import AppearancePanel from "./AppearancePanel.vue";
import HotkeysPanel from "./HotkeysPanel.vue";
import AboutPanel from "./AboutPanel.vue";
import ProviderSettings from "./ProviderSettings.vue";
import WritingPanel from "./WritingPanel.vue";
import WritingGoalSettingsPanel from "./WritingGoalSettingsPanel.vue";
import ProjectSettingsPanel from "./ProjectSettingsPanel.vue";
import { useLayoutStore, type SettingsTab } from "../stores/layoutStore";
import type { IconName } from "../types/icons";
import WebdavPanel from "./WebdavPanel.vue";

const layout = useLayoutStore();
const { settingsTab } = storeToRefs(layout);

interface SettingsCategory {
  id: SettingsTab;
  label: string;
  icon: IconName;
  /** 搜索命中的补充关键词：只服务侧栏过滤，不与任何 store 文案重复。 */
  keywords: string;
}

interface SettingsSection {
  id: string;
  label: string;
  categories: SettingsCategory[];
}

const SECTIONS: SettingsSection[] = [
  {
    id: "preferences",
    label: "偏好",
    categories: [
      { id: "model", label: "模型配置", icon: "model", keywords: "baseURL 模型名 密钥 API 接口" },
      {
        id: "agent",
        label: "智能体",
        icon: "bot",
        keywords:
          "权限档 写盘 只读 审批 提案 联网 搜索 web_search 默认 思考档 记忆 发送键 回车 Ctrl+Enter 换行"
      },
      {
        id: "writing",
        label: "写作",
        icon: "pen",
        keywords:
          "自动保存 静默窗 保存 间隔 落盘 手动 行距 编辑器 正文 疏朗 紧凑 字号 特大 拼写检查 波浪线 列宽 每行字数 宽 窄 自动行为 清空 输入框 送出 批准 提案"
      },
      {
        id: "appearance",
        label: "外观",
        icon: "sparkles",
        keywords: "主题 字体 浅色 深色 跟随系统 界面字号 代码字号 半透明 侧栏 毛玻璃 减少动效 动画"
      },
      { id: "shortcuts", label: "快捷键", icon: "keyboard", keywords: "键位 Esc Ctrl 发送 审批" },
      {
        id: "goals",
        label: "写作目标",
        icon: "chart",
        keywords: "每日字数 连续天数 目标 进度 字数统计 写作目标环"
      },
      {
        id: "projects",
        label: "项目管理",
        icon: "folder",
        keywords: "多作品 切换 最近 项目 书架"
      },
      {
        id: "webdav",
        label: "远程备份",
        icon: "save",
        keywords: "WebDAV NAS 坚果云 Nextcloud 远程 备份 推送 整书"
      }
    ]
  },
  {
    id: "about",
    label: "关于",
    categories: [
      { id: "about", label: "关于", icon: "archive", keywords: "版本 归属 许可 密钥存储" }
    ]
  }
];

const searchQuery = ref("");

const visibleSections = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return SECTIONS;
  return SECTIONS.map((section) => ({
    ...section,
    categories: section.categories.filter((category) =>
      `${category.label} ${category.keywords}`.toLocaleLowerCase().includes(query)
    )
  })).filter((section) => section.categories.length > 0);
});

const activeLabel = computed(
  () =>
    SECTIONS.flatMap((section) => section.categories).find(
      (category) => category.id === settingsTab.value
    )?.label ?? "设置"
);

function selectCategory(id: SettingsTab): void {
  settingsTab.value = id;
}
</script>

<template>
  <div class="settings-page" data-testid="settings-page">
    <aside class="settings-sidebar">
      <button
        class="settings-back"
        type="button"
        aria-label="返回工作台"
        @click="layout.showWorkspace()"
      >
        <AppIcon name="chevron" :size="14" />
        <span>返回工作台</span>
      </button>

      <div class="settings-search">
        <AppIcon name="search" :size="14" />
        <input v-model="searchQuery" type="search" placeholder="搜索设置" aria-label="搜索设置" />
      </div>

      <nav class="settings-nav" aria-label="设置分类">
        <div v-for="section in visibleSections" :key="section.id" class="settings-section">
          <strong class="settings-section-label">{{ section.label }}</strong>
          <button
            v-for="category in section.categories"
            :key="category.id"
            class="settings-category"
            :class="{ 'is-active': settingsTab === category.id }"
            type="button"
            @click="selectCategory(category.id)"
          >
            <AppIcon :name="category.icon" :size="15" />
            <span>{{ category.label }}</span>
          </button>
        </div>
        <p v-if="visibleSections.length === 0" class="settings-search-empty">没有匹配的设置项</p>
      </nav>
    </aside>

    <main class="settings-content">
      <div class="settings-content-inner">
        <h1 class="settings-title">{{ activeLabel }}</h1>

        <ProviderSettings v-if="settingsTab === 'model'" />
        <AgentSettingsPanel v-else-if="settingsTab === 'agent'" />
        <WritingPanel v-else-if="settingsTab === 'writing'" />
        <AppearancePanel v-else-if="settingsTab === 'appearance'" />
        <HotkeysPanel v-else-if="settingsTab === 'shortcuts'" />
        <WritingGoalSettingsPanel v-else-if="settingsTab === 'goals'" />
        <ProjectSettingsPanel v-else-if="settingsTab === 'projects'" />
        <WebdavPanel v-else-if="settingsTab === 'webdav'" />
        <AboutPanel v-else-if="settingsTab === 'about'" />
      </div>
    </main>
  </div>
</template>

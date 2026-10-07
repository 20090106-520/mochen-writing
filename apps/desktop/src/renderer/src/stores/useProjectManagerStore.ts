/**
 * ProjectManagerStore —— 多作品管理
 *
 * 管理用户的所有写作项目（Works/Book），支持：
 * - 创建/切换/删除/重命名项目
 * - 每个项目独立的工作目录、元信息、最近访问时间
 * - 项目列表持久化（localStorage，与作品数据本身解耦）
 *
 * 注意：作品目录内的章节/资料数据仍归 fs-store 与 useBookStore 管；
 * 这一层只管「有哪些作品、当前看哪个」，是书签册不是文件柜。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** 项目记录（存书签册）—— 只放索引级字段，不重复 useBookStore 的运行时真身 */
export interface ProjectRecord {
  id: string;
  title: string;
  rootPath: string;
  kind: string;
  createdAt: number;
  lastOpenedAt: number;
  /** 作品卡在列表里展示的一句话摘要（空串 = 未开过、没统计过） */
  summary: string;
  /** 总字数（开过一次后统计并缓存，避免每次进列表都去读磁盘） */
  totalChars: number;
  /** 章节数（同上，展示用缓存） */
  chapterCount: number;
}

interface ProjectManagerState {
  projects: ProjectRecord[];
  activeProjectId: string | null;
}

const STORAGE_KEY = "mochen.project-manager.v1";

function loadFromStorage(): ProjectManagerState {
  if (typeof localStorage === "undefined") {
    return { projects: [], activeProjectId: null };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: [], activeProjectId: null };
    const parsed = JSON.parse(raw) as ProjectManagerState;
    if (!Array.isArray(parsed.projects)) return { projects: [], activeProjectId: null };
    return parsed;
  } catch {
    return { projects: [], activeProjectId: null };
  }
}

function saveToStorage(state: ProjectManagerState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 静默失败：书签册写不进不影响作品本身
  }
}

function genId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useProjectManagerStore = defineStore("projectManager", () => {
  const persisted = loadFromStorage();
  const projects = ref<ProjectRecord[]>(persisted.projects);
  const activeProjectId = ref<string | null>(persisted.activeProjectId);

  // 持久化：每次变更写回 localStorage（轻量，项目数一般两位数）
  watch(
    [projects, activeProjectId],
    () => {
      saveToStorage({
        projects: projects.value,
        activeProjectId: activeProjectId.value
      });
    },
    { deep: true }
  );

  /** 按最近打开时间倒序排列的项目列表（视图层直接 v-for） */
  const sortedProjects = computed(() =>
    [...projects.value].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  );

  const activeProject = computed(
    () => projects.value.find((p) => p.id === activeProjectId.value) ?? null
  );

  const hasProjects = computed(() => projects.value.length > 0);

  const projectCount = computed(() => projects.value.length);

  /**
   * 注册一个新项目（打开已有目录 / 新建作品后调一次）。
   * 已存在的 rootPath 不重复添加，只刷新 lastOpenedAt。
   */
  function registerProject(input: {
    title: string;
    rootPath: string;
    kind?: string;
  }): ProjectRecord {
    const existing = projects.value.find((p) => p.rootPath === input.rootPath);
    if (existing) {
      existing.lastOpenedAt = Date.now();
      return existing;
    }
    const record: ProjectRecord = {
      id: genId(),
      title: input.title,
      rootPath: input.rootPath,
      kind: input.kind ?? "novel",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      summary: "",
      totalChars: 0,
      chapterCount: 0
    };
    projects.value.push(record);
    return record;
  }

  /** 切换当前项目 */
  function setActiveProject(id: string): void {
    const proj = projects.value.find((p) => p.id === id);
    if (proj) {
      proj.lastOpenedAt = Date.now();
      activeProjectId.value = id;
    }
  }

  /** 移除项目记录（不删磁盘上的文件，只从书签册移除） */
  function removeProject(id: string): void {
    const idx = projects.value.findIndex((p) => p.id === id);
    if (idx === -1) return;
    projects.value.splice(idx, 1);
    if (activeProjectId.value === id) {
      activeProjectId.value = projects.value[0]?.id ?? null;
    }
  }

  /** 重命名项目 */
  function renameProject(id: string, newTitle: string): void {
    const proj = projects.value.find((p) => p.id === id);
    if (proj && newTitle.trim()) {
      proj.title = newTitle.trim();
    }
  }

  /** 更新项目统计缓存 */
  function updateProjectStats(
    id: string,
    stats: { totalChars?: number; chapterCount?: number; summary?: string }
  ): void {
    const proj = projects.value.find((p) => p.id === id);
    if (!proj) return;
    if (stats.totalChars !== undefined) proj.totalChars = stats.totalChars;
    if (stats.chapterCount !== undefined) proj.chapterCount = stats.chapterCount;
    if (stats.summary !== undefined) proj.summary = stats.summary;
  }

  /** 根据 rootPath 找项目 */
  function findByRootPath(rootPath: string): ProjectRecord | undefined {
    return projects.value.find((p) => p.rootPath === rootPath);
  }

  /** 初次开书时：注册 + 激活一次到位 */
  function registerAndActivate(input: {
    title: string;
    rootPath: string;
    kind?: string;
  }): ProjectRecord {
    const record = registerProject(input);
    activeProjectId.value = record.id;
    return record;
  }

  return {
    projects,
    activeProjectId,
    sortedProjects,
    activeProject,
    hasProjects,
    projectCount,
    registerProject,
    setActiveProject,
    removeProject,
    renameProject,
    updateProjectStats,
    findByRootPath,
    registerAndActivate
  };
});

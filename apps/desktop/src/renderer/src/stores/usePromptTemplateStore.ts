/**
 * PromptTemplateStore —— 提示词模板库
 *
 * 分类管理常用 AI 指令模板：
 * - 续写、润色、改写、头脑风暴、角色塑造等
 * - 支持变量占位（{{text}} / {{chapter}} 等）
 * - 内置模板 + 用户自定义
 * - 选中模板后一键填入输入框
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  content: string;
  /** 描述：这模板干嘛的 */
  description: string;
  /** true = 内置模板（不可删但可改副本） */
  builtin: boolean;
  /** 使用次数统计 */
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateCategory {
  id: string;
  name: string;
  icon: string;
  builtin: boolean;
}

const STORAGE_KEY = "mochen.prompt-templates.v1";

const BUILTIN_CATEGORIES: TemplateCategory[] = [
  { id: "continue", name: "续写", icon: "pen", builtin: true },
  { id: "polish", name: "润色", icon: "sparkles", builtin: true },
  { id: "rewrite", name: "改写", icon: "replace", builtin: true },
  { id: "brainstorm", name: "头脑风暴", icon: "lightbulb", builtin: true },
  { id: "character", name: "角色塑造", icon: "user", builtin: true },
  { id: "worldbuilding", name: "世界观", icon: "globe", builtin: true },
  { id: "dialogue", name: "对话改进", icon: "message", builtin: true },
  { id: "outline", name: "大纲规划", icon: "list", builtin: true },
  { id: "check", name: "检查纠错", icon: "check", builtin: true },
  { id: "custom", name: "自定义", icon: "folder", builtin: true }
];

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: "tpl_builtin_continue_scene",
    name: "续写当前场景",
    category: "continue",
    content:
      "请基于以下上下文，以第一人称视角续写接下来的场景。风格保持一致，节奏适中，200-500字。\n\n{{context}}",
    description: "接上一段继续写，适合卡在中间时推一把",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_polish_prose",
    name: "润色当前段落",
    category: "polish",
    content:
      "请润色以下文字，提升文学表现力但不改变原意。注意节奏、用词精准度和画面感。\n\n{{text}}",
    description: "让句子更有质感，保留原意",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_rewrite_dialogue",
    name: "改写对白风格",
    category: "rewrite",
    content: "请将以下对白改写成{{style}}风格，保持角色性格一致。\n\n{{dialogue}}",
    description: "切换对白风格：古风/现代/悬疑等",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_brainstorm_plot",
    name: "情节头脑风暴",
    category: "brainstorm",
    content:
      "基于以下设定，给出3-5个合理的情节发展方向，每个方向用一段话描述：\n\n当前情节：{{current_plot}}\n角色动机：{{motivation}}",
    description: "卡文时帮你想接下来可以怎么写",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_character_deepen",
    name: "角色深度塑造",
    category: "character",
    content:
      "请帮我深度分析这个角色，补充背景、动机、口头禅、恐惧与欲望：\n\n{{character_description}}",
    description: "展开角色设定，挖掘更多层次",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_worldbuilding_check",
    name: "世界观一致性检查",
    category: "worldbuilding",
    content: "请检查以下世界观设定是否有逻辑矛盾或规则冲突：\n\n{{worldbuilding}}",
    description: "帮忙找设定里的 bug",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_dialogue_naturalize",
    name: "让对白更自然",
    category: "dialogue",
    content: "以下对白读起来有些生硬，请改写成更口语化、符合角色身份的表达：\n\n{{dialogue}}",
    description: "去掉翻译腔 / 书面腔",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_outline_expand",
    name: "大纲细化",
    category: "outline",
    content: "请将以下大纲条目细化成具体的三到五个情节节拍：\n\n{{outline_item}}",
    description: "把一个大纲点展开成具体情节",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_check_consistency",
    name: "章节一致性检查",
    category: "check",
    content: "请检查以下章节中的时间线、人物状态、物品是否有前后矛盾：\n\n{{chapter_content}}",
    description: "找前后文不一致的地方",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "tpl_builtin_pacing_analysis",
    name: "节奏分析",
    category: "check",
    content:
      "分析以下章节的叙事节奏：哪里太快、哪里太慢、建议在哪些位置增加细节或加快进程。\n\n{{chapter_content}}",
    description: "诊断一章写得太赶还是太拖",
    builtin: true,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0
  }
];

function loadTemplates(): PromptTemplate[] {
  if (typeof localStorage === "undefined") return [...BUILTIN_TEMPLATES];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...BUILTIN_TEMPLATES];
    const userTemplates = JSON.parse(raw) as PromptTemplate[];
    const builtinIds = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    const merged = [...BUILTIN_TEMPLATES];
    for (const t of userTemplates) {
      if (!builtinIds.has(t.id)) merged.push(t);
    }
    return merged;
  } catch {
    return [...BUILTIN_TEMPLATES];
  }
}

function saveTemplates(templates: PromptTemplate[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const userOnly = templates.filter((t) => !t.builtin);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userOnly));
  } catch {
    // 静默
  }
}

function genId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const usePromptTemplateStore = defineStore("promptTemplates", () => {
  const templates = ref<PromptTemplate[]>(loadTemplates());

  watch(templates, (val) => saveTemplates(val), { deep: true });

  const categories = computed(() => {
    const userCats = new Map<string, TemplateCategory>();
    for (const t of templates.value) {
      if (!userCats.has(t.category) && !BUILTIN_CATEGORIES.find((c) => c.id === t.category)) {
        userCats.set(t.category, {
          id: t.category,
          name: t.category,
          icon: "folder",
          builtin: false
        });
      }
    }
    return [...BUILTIN_CATEGORIES, ...userCats.values()];
  });

  const templatesByCategory = computed(() => {
    const map = new Map<string, PromptTemplate[]>();
    for (const t of templates.value) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return map;
  });

  /** 最近使用（按 usageCount + updatedAt 排） */
  const recentlyUsed = computed(() =>
    [...templates.value]
      .filter((t) => t.usageCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
  );

  /** 最常用模板 */
  const mostUsed = computed(() =>
    [...templates.value].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5)
  );

  /** 获取某分类下的模板 */
  function getTemplatesByCategory(category: string): PromptTemplate[] {
    return templates.value.filter((t) => t.category === category);
  }

  /** 应用模板：替换变量，返回最终 prompt */
  function applyTemplate(id: string, variables: Record<string, string> = {}): string | null {
    const tpl = templates.value.find((t) => t.id === id);
    if (!tpl) return null;

    let result = tpl.content;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    // 更新使用统计
    tpl.usageCount++;
    tpl.updatedAt = Date.now();

    return result;
  }

  /** 创建模板 */
  function createTemplate(input: {
    name: string;
    category: string;
    content: string;
    description?: string;
  }): PromptTemplate {
    const now = Date.now();
    const tpl: PromptTemplate = {
      id: genId(),
      name: input.name,
      category: input.category,
      content: input.content,
      description: input.description ?? "",
      builtin: false,
      usageCount: 0,
      createdAt: now,
      updatedAt: now
    };
    templates.value.push(tpl);
    return tpl;
  }

  /** 修改模板（非内置） */
  function updateTemplate(
    id: string,
    updates: Partial<Pick<PromptTemplate, "name" | "category" | "content" | "description">>
  ): void {
    const tpl = templates.value.find((t) => t.id === id);
    if (!tpl || tpl.builtin) return;
    Object.assign(tpl, updates, { updatedAt: Date.now() });
  }

  /** 删除模板（非内置） */
  function deleteTemplate(id: string): void {
    const tpl = templates.value.find((t) => t.id === id);
    if (!tpl || tpl.builtin) return;
    const idx = templates.value.indexOf(tpl);
    if (idx !== -1) templates.value.splice(idx, 1);
  }

  /** 复制内置模板为用户模板 */
  function cloneBuiltin(id: string, newName: string): PromptTemplate | null {
    const tpl = templates.value.find((t) => t.id === id);
    if (!tpl) return null;
    const clone: PromptTemplate = {
      ...tpl,
      id: genId(),
      name: newName || `${tpl.name}（副本）`,
      builtin: false,
      usageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    templates.value.push(clone);
    return clone;
  }

  /** 搜索模板 */
  function searchTemplates(query: string): PromptTemplate[] {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return templates.value;
    return templates.value.filter(
      (t) =>
        t.name.toLocaleLowerCase().includes(q) ||
        t.content.toLocaleLowerCase().includes(q) ||
        t.description.toLocaleLowerCase().includes(q)
    );
  }

  return {
    templates,
    categories,
    templatesByCategory,
    recentlyUsed,
    mostUsed,
    getTemplatesByCategory,
    applyTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    cloneBuiltin,
    searchTemplates
  };
});

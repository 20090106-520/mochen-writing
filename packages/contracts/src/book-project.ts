/**
 * 开书立项（W-07）：新建作品时可选填的六项创作约定。
 *
 * 【为什么住在 contracts】同一份字段有三处要读：新建对话框（填）、主进程建书（落 book.json）、
 * 提示词装配（每轮告诉模型这本书写给谁、什么不能写）。任何一处自己抄一遍键名，迟早出现
 * 「界面上填了、盘上没有」或「盘上有、模型看不见」——那正是 W-07 要治的重复交代。
 * 键名、标签、上限与两份文案都只住这一处（铁律 6）。
 *
 * 【为什么全部可选】老书没有这一格，`parseBookMeta` 必须照样过得去；新书跳过立项也必须
 * 与原流程逐字一致。空串在 `normalizeBookProject` 里一律折成「没写」，不落进 book.json。
 */

export const BOOK_PROJECT_FIELDS = [
  "genre",
  "platform",
  "length",
  "cadence",
  "taboos",
  "pitch"
] as const;

export type BookProjectField = (typeof BOOK_PROJECT_FIELDS)[number];

/**
 * 立项速记：六格全部可选；没写的键不出现，不拿空串占位。
 * 显式写成 `| undefined`：zod 解析结果带 `undefined`，`exactOptionalPropertyTypes` 下才能原样交给 BookMeta。
 */
export type BookProject = {
  [K in BookProjectField]?: string | undefined;
};

export const BOOK_PROJECT_LABELS: Record<BookProjectField, string> = {
  genre: "题材 / 频道",
  platform: "目标平台",
  length: "预计篇幅",
  cadence: "更新节奏",
  taboos: "雷点 / 禁忌",
  pitch: "一句话卖点"
};

/** 单格上限。立项是速记，不是创作约定全文——太长会被模型当成正文读。 */
export const BOOK_PROJECT_MAX_CHARS = 200;

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

/**
 * 把界面上递来的六格归一成可落盘的立项：非字符串丢掉、空串折成没写、
 * 一律去首尾空白并截到上限。六格全空 ⇒ `undefined`（等同于没填，book.json 不出现这一格）。
 */
export function normalizeBookProject(raw: unknown): BookProject | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const project: BookProject = {};
  for (const field of BOOK_PROJECT_FIELDS) {
    const text = trimmed(source[field]);
    if (text !== undefined) project[field] = text.slice(0, BOOK_PROJECT_MAX_CHARS);
  }
  return Object.keys(project).length === 0 ? undefined : project;
}

/** 这一份立项里是否真有内容（跳过立项的书一律 false）。 */
export function hasBookProject(project: BookProject | undefined): boolean {
  return project !== undefined && normalizeBookProject(project) !== undefined;
}

/**
 * 提示词里那一句：只列填过的格子，按固定顺序，一句说完。
 * 没填任何一格就返回空串——调用方整句不加，不摆一句「本书立项：」的空壳。
 */
export function bookProjectBrief(project: BookProject | undefined): string {
  if (project === undefined) return "";
  const parts = BOOK_PROJECT_FIELDS.flatMap((field) => {
    const value = trimmed(project[field]);
    return value === undefined ? [] : [`${BOOK_PROJECT_LABELS[field]}：${value}`];
  });
  return parts.length === 0 ? "" : `本书立项：${parts.join("；")}。`;
}

/**
 * 「创作约定」初稿的正文（不含 frontmatter）。跳过立项时返回空串，建书不生成这份文稿。
 *
 * 六格照抄：填过的写值，没填的写「（未填）」——不替作者补设定，也不把空格藏起来。
 * 后面两段是空骨架，不是预生成内容：卷纲与人物卡等作者自己填。
 */
export function bookConventionBody(project: BookProject | undefined): string {
  if (!hasBookProject(project)) return "";
  const lines = [
    "> 新建作品时填的立项速记。写正文时以这份为准；设定要改，先改这里。",
    "",
    ...BOOK_PROJECT_FIELDS.map((field) => {
      const value = trimmed(project?.[field]);
      return `- **${BOOK_PROJECT_LABELS[field]}**：${value ?? "（未填）"}`;
    }),
    "",
    "## 卷纲骨架（空模板）",
    "",
    "1. 第一卷 · 卷名——这一卷把主角推到哪一步：",
    "2. 卷末转折：",
    "",
    "## 人物卡骨架（空模板）",
    "",
    "- 主角：目标 / 底线 / 说话方式",
    "- 对手：要什么、为什么挡路",
    "- 关键配角："
  ];
  return lines.join("\n");
}

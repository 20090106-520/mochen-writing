/**
 * 新建作品时那六格「立项速记」的记住与沿用（2026-11-20 · 新建作品智能刀）。
 *
 * 【为什么要记这一份】
 * 立项速记里的格子是**跨书不变的那部分**：同一个作者的题材频道、目标平台、
 * 更新节奏、雷点，十本书里九本是一样的。每一本都重打一遍，是纯粹的重复劳动。
 *
 * 【但不许偷偷预填】
 * 预填会**改掉一个已经写进代码的保证**：新建作品时「跳过立项」，建书请求体
 * 与旧版本逐字一致（不写 book.json 的这一格、不生成「创作约定.md」）。
 * 若记忆默认填好六格，"跳过"就悄悄变成了"照抄上次"——用户以为跳过了，
 * 盘上却多了一份他不想要的约定。
 *
 * ⇒ 所以记忆**只提供一条明面上的动作**：对话框里摆一行「上次的设定」，
 *   点一下才填进六格并展开那一段。没点过 ⇒ 六格仍是空的 ⇒ 跳过与原流程一致。
 *   记忆写盘也只发生在**用户真的填过并建了书**之后，绝不凭空造。
 *
 * 与 `utils/pane-layout-preferences.ts` 同族：存储键带 mochen 前缀、
 * 读不到就当没有、写不进去就如实返回 false。
 */

import { BOOK_PROJECT_FIELDS, type BookProjectField } from "@mochen/contracts";

/** 存储键。mochen 前缀，与其余偏好同族。 */
export const NEW_BOOK_MEMORY_STORAGE_KEY = "mochen:new-book-project:v1";

/** 六格的形状（界面上是 `reactive` 的那一份）。 */
export type NewBookProjectDraft = Record<BookProjectField, string>;

/** 空格 = 什么都没记。 */
export const EMPTY_NEW_BOOK_PROJECT: NewBookProjectDraft = {
  genre: "",
  platform: "",
  length: "",
  cadence: "",
  taboos: "",
  pitch: ""
};

interface NewBookMemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 一格的值：只收字符串，空串折成空。别的形状（数字、对象）一律当没填。 */
function fieldText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * 解析一份已存的立项。
 *
 * 版本号不对 ⇒ 整份当没记（那是另一套形状的记录，不该硬读）。
 * 版本对但某一格坏了 ⇒ **只当那一格没填**：坏一格不该把其余五格一起丢掉。
 */
export function parseRememberedProject(storedValue: string | null): NewBookProjectDraft {
  const empty = { ...EMPTY_NEW_BOOK_PROJECT };
  if (!storedValue) return empty;
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1) return empty;
    const draft = { ...empty };
    for (const field of BOOK_PROJECT_FIELDS) {
      draft[field] = fieldText(candidate[field]);
    }
    return draft;
  } catch {
    return empty;
  }
}

/** 读一份已记的立项；读不到（没有窗口 / 存储坏了）就当没记。 */
export function loadRememberedProject(
  storage: Pick<NewBookMemoryStorage, "getItem">
): NewBookProjectDraft {
  try {
    return parseRememberedProject(storage.getItem(NEW_BOOK_MEMORY_STORAGE_KEY));
  } catch {
    return { ...EMPTY_NEW_BOOK_PROJECT };
  }
}

/** 这一份里真有内容吗（六个格子全是空串 ⇒ 没记）。 */
export function hasRememberedProject(draft: NewBookProjectDraft): boolean {
  return BOOK_PROJECT_FIELDS.some((field) => draft[field].trim() !== "");
}

/**
 * 写一份。
 *
 * **全是空的就不写** —— 免得把「上次跳过立项」记成一份空记忆，
 * 下次对话框又摆出一行「上次的设定」而内容是空的。
 * 写不进去（配额满了 / 隐私模式）如实返回 false，不假装存上了。
 */
export function saveRememberedProject(
  storage: Pick<NewBookMemoryStorage, "setItem">,
  draft: NewBookProjectDraft
): boolean {
  if (!hasRememberedProject(draft)) return false;
  try {
    const payload: Record<string, string> = {};
    for (const field of BOOK_PROJECT_FIELDS) {
      const text = draft[field].trim();
      if (text !== "") payload[field] = text;
    }
    storage.setItem(NEW_BOOK_MEMORY_STORAGE_KEY, JSON.stringify({ version: 1, ...payload }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 一行摘要：给对话框那行「上次的设定」看的。
 *
 * 只取前四格（题材 / 平台 / 篇幅 / 节奏）——它们短，能挤进一行；
 * 雷点与卖点是长句，展开那一段就能看到，摘要里不重复。
 * 一格都没填 ⇒ 空串（那一行整条不出现）。
 */
export function rememberedProjectSummary(draft: NewBookProjectDraft): string {
  const fields: BookProjectField[] = ["genre", "platform", "length", "cadence"];
  const parts = fields.flatMap((field) => {
    const text = draft[field].trim();
    return text === "" ? [] : [text];
  });
  return parts.join(" · ");
}

/**
 * 浏览器里那份存储。
 *
 * `window.localStorage` 本身就可能抛（隐私模式 / 存储被禁 / 非浏览器环境），
 * 所以取它的那一步也在 try 里——组件里不该再写一遍 try/catch。
 */
export function browserRememberedProject(): NewBookProjectDraft {
  try {
    return loadRememberedProject(window.localStorage);
  } catch {
    return { ...EMPTY_NEW_BOOK_PROJECT };
  }
}

/** 写进浏览器那份存储；写不进去如实返回 false，不假装存上了。 */
export function browserRememberProject(draft: NewBookProjectDraft): boolean {
  try {
    return saveRememberedProject(window.localStorage, draft);
  } catch {
    return false;
  }
}

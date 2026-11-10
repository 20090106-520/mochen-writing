/**
 * 输入卡下方那行「选择作品」的选项表（2026-11-09 参考图③）。
 *
 * 参考图那一层是「选择文件夹 / 本地 + 场景预设」，本仓只落**有真通路**的那一半：
 * 新建作品、打开作品目录、最近作品。远程项目 / 不需要项目 / 场景预设都没有对应契约，
 * 这里一条都不编（编出来就是点了没反应的假控件）。
 *
 * 三项动作全部复用现成入口：
 * - `new`  → layout.openNewBook()（左栏「新建作品」与工作台降级区同一个对话框）；
 * - `pick` → book.pickAndOpen()（系统目录选择，与 Ctrl+O 同一个入口）；
 * - `book:<rootPath>` → book.openBook(rootPath)（作品库那一行的打开方式）。
 *
 * 判定落在这份 `.ts` 是为了进类型程序：`.vue` 的 `<script setup>` 不进裸 tsc，
 * 选项表写在组件里就等于没有关卡（与 composer-chips.ts 同一条纪律）。
 */
import type { RecentBookEntry } from "@mochen/contracts";
import { bookDisplayTitle, shortenRootPath } from "./book-path";
import type { ContextOption } from "./composer-context";

export const PROJECT_NEW_ID = "new";
export const PROJECT_PICK_ID = "pick";
export const PROJECT_EMPTY_ID = "empty";
export const PROJECT_BOOK_PREFIX = "book:";

/**
 * `book:<rootPath>` 里取回路径；不是作品行返回 null。
 *
 * 前缀必须由这份表定义（组件里不许再拼一次字符串）：拼接与解析分开写，
 * 将来改前缀时只会改一处，另一处不会静默按旧前缀解析。
 */
export function projectBookPath(id: string): string | null {
  if (!id.startsWith(PROJECT_BOOK_PREFIX)) return null;
  const path = id.slice(PROJECT_BOOK_PREFIX.length);
  return path === "" ? null : path;
}

/**
 * 弹层里的名单：两条动作恒在，作品库有记录就接在后面，没有就给一句引导（禁用行，不可选）。
 * `current` 让高亮初值落在「正在写的这一本」上——与阶段弹层同一条口径。
 */
export function projectPickOptions(input: {
  books: readonly RecentBookEntry[];
  /** 当前书根；没有开书时是 null，此时没有任何一行是「当前」。 */
  currentRoot: string | null;
  /** 生成中：动作行禁用（换书/建书都不该在出词途中插进来）。 */
  busy: boolean;
}): ContextOption[] {
  const options: ContextOption[] = [
    {
      id: PROJECT_NEW_ID,
      label: "新建作品",
      detail: "选一个目录，建 book.json 与目录骨架",
      icon: "plus",
      current: false,
      disabled: input.busy
    },
    {
      id: PROJECT_PICK_ID,
      label: "打开作品目录",
      detail: "选一个已有 book.json 的目录",
      icon: "folder",
      current: false,
      disabled: input.busy
    }
  ];
  if (input.books.length === 0) {
    // 引导行不参与高亮与选择（disabled），但它必须出现在名单里：
    // 只把「空」画成一个空白框，用户看不出是「还没有」还是「没加载出来」。
    options.push({
      id: PROJECT_EMPTY_ID,
      label: "还没有最近作品",
      detail: "新建或打开一本之后，会出现在这里",
      icon: "history",
      current: false,
      disabled: true
    });
    return options;
  }
  for (const entry of input.books) {
    options.push({
      id: `${PROJECT_BOOK_PREFIX}${entry.rootPath}`,
      label: bookDisplayTitle(entry.title, entry.rootPath),
      detail: shortenRootPath(entry.rootPath),
      icon: "book",
      current: entry.rootPath === input.currentRoot,
      disabled: input.busy
    });
  }
  return options;
}

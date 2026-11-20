export interface NewBookStructureItem {
  /** 屏上怎么叫（左栏里那个中文分组名）。 */
  label: string;
  /** 盘上真名。 */
  path: string;
  /** 干什么用。 */
  usage: string;
  /** 这一件是不是「填了立项才有」。 */
  conditional?: boolean;
}

/**
 * 建好之后目录里会长什么样（2026-11-20 新建作品智能刀）。
 *
 * 【为什么要摆这张表】
 * 对话框原先只用一句小灰字交代「会建出 book.json 和 章节 / 大纲 / 人物 / 剧情 / 素材库
 * 五个文件夹」——五个名字，一句带过。作者点完「创建并打开」之后，
 * 左栏树上冒出五个分组，每个分组放什么、为什么会有它，屏上一个字都没有。
 * ⇒ 这一张表把「建好之后你会得到什么」摆到眼前，每样一句话。
 *
 * 【这份表不许漂】
 * 路径与用法必须与 `packages/fs-store/src/create.ts` 真正建出来的东西一致。
 * 守卫 `new-book-structure.test.ts` 直接对着 fs-store 的 `DOC_DIRS` 与建书那几行逐条核：
 * 表里多一个盘上不存在的路径、或少一个真会建出来的目录，断言立刻红。
 * （写这份表时最易犯的错是凭印象写「五个文件夹」——真实名字是英文目录名，
 * 屏上那五个中文只是左栏的分组标题。）
 */
export const NEW_BOOK_STRUCTURE: readonly NewBookStructureItem[] = [
  {
    label: "作品设定",
    path: "book.json",
    usage: "书名、权限模式、章节顺序——以后改设置都写回这一份"
  },
  {
    label: "章节",
    path: "chapters/",
    usage: "正文按章放，一章一篇 Markdown"
  },
  {
    label: "大纲",
    path: "outline/",
    usage: "卷纲与章节骨架"
  },
  {
    label: "人物",
    path: "characters/",
    usage: "人物卡：目标、底线、说话方式"
  },
  {
    label: "剧情",
    path: "plot/",
    usage: "剧情线与伏笔"
  },
  {
    label: "素材库",
    path: "materials/",
    usage: "世界观、地点、设定条目"
  },
  {
    label: "创作约定",
    path: "outline/创作约定.md",
    usage: "你填的立项速记；以后每轮对话都会带上",
    conditional: true
  }
];

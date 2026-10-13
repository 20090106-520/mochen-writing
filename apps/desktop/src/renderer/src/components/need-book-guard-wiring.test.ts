/**
 * 「要有书才谈得上」的那一族入口（2026-10-11 P543 真机巡检后补）。
 *
 * 【实机量到的症状，证据在这里】没打开作品时点左栏「数据统计」，弹出来是十三行 0
 * （章节 / 分卷 / 大纲 / 世界观 / 人物 / 势力·组织 / 地图 / 时间线 / 剧情 / 素材库 /
 * 专有名词 / 伏笔 / 技能库，合计 0），底下写着「数字来自这本书的扫描结果：
 * 篇数是现有文档数，字数按正文非空白字符计」。截图见 `.mochen-tmp/p543/p04-stats.png`。
 *
 * 问题不在数字是 0——没书当然是 0。问题在于**没有任何一处说明这些 0 从哪来**：
 * 表格在、数字在、脚注也在，唯独「你现在没有打开作品」这件事只有你碰巧知道。
 * 用户看到的是一张「坏了的统计」。
 * 回收站 / 整书备份 / 书稿体检是同一族：没有书，它们能给的也只有一片空白。
 *
 * 【原来的样子】need-book 引导早就在 LeftSidebar 里（导入 TXT 那一支），
 * 但闸只装在那一个 kind 上——四个入口四种表现，同一件事说了四遍。
 *
 * 【为什么判据必须是 `book.hasBook`】`book.docs.length === 0` 说的是
 * 「**这本书还是空的**」，不是「没打开书」：一本刚建好、还没写一个字的书会被误判。
 * 导入 TXT 原来就踩在这上面——建完新书第一件事导入 TXT 会被挡在门外，
 * 提示还写着「先打开作品」，而书明明开着。
 * `book.hasBook` 是 useBookStore 里「有没有打开作品」这个概念的**单一真身**（判据取 meta）。
 *
 * 组件里只留一行指针，论证跟着判据放在这儿——`LeftSidebar.vue` 贴着 800 行预算
 * （HEAD 就是 799），长论证塞不进那个文件，塞进去就是拿预算换注释。
 */
import { describe, expect, it } from "vitest";
import { scriptSource } from "../utils/vue-source-reader";

const SIDEBAR = "components/LeftSidebar.vue";
const script = scriptSource(SIDEBAR);

/** 某个函数的函数体（含它自己那一圈花括号）；注释已由 scriptSource 剥掉。 */
function functionBody(source: string, name: string): string {
  const at = source.indexOf(`function ${name}`);
  expect(at, `源文件里找不到函数 ${name}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`函数 ${name} 的花括号没配平`);
}

describe("need-book 闸 · 判据只能是 hasBook", () => {
  it("闸读的是 book.hasBook（「有没有打开作品」那个单一真身）", () => {
    const body = functionBody(script, "requireBook");
    expect(body).toContain("book.hasBook");
  });

  it("**反向钉**：闸不许读 `docs.length`（那说的是「这本书还是空的」）", () => {
    const body = functionBody(script, "requireBook");
    expect(body, "用 docs.length 判「有没有书」会把刚建好、还没写字的新书挡在门外").not.toContain(
      "docs.length"
    );
  });

  it("闸给的是 need-book，且带上用户刚点的那一项的名字", () => {
    const body = functionBody(script, "requireBook");
    expect(body).toContain('kind: "need-book"');
    // label 从入参来：引导框要报出「你刚才点的是回收站 / 数据统计 …」
    expect(body).toMatch(/label\b/);
    expect(body).toContain("return false");
    expect(body).toContain("return true");
  });
});

describe("need-book 闸 · 四个入口都要过", () => {
  it("数据统计那支过闸（就是这张全 0 表格的来源）", () => {
    const body = functionBody(script, "openStats");
    expect(body).toContain('requireBook("数据统计")');
    // 闸没过不许落到那句 notice 上——顺序反了就等于闸形同虚设
    expect(body.indexOf("requireBook")).toBeLessThan(body.indexOf('kind: "stats"'));
  });

  it("回收站 / 整书备份 / 书稿体检 / 导入 TXT 四支共用同一道闸", () => {
    const body = functionBody(script, "openLibraryDialog");
    expect(body).toContain("requireBook(label)");
    // 名字表四个都在：少一个就有一个入口悄悄没有引导
    for (const [kind, label] of [
      ["trash", "回收站"],
      ["backup", "整书备份"],
      ["terms", "书稿体检"],
      ["import", "导入 TXT"]
    ]) {
      expect(body, `${kind} 这一支从名字表里掉了`).toContain(`${kind}: "${label}"`);
    }
    expect(body, "闸没过不许落到 notice 上").toMatch(
      /if \(requireBook\(label\)\) return;[\s\S]*notice\.value = \{ kind, label \}/
    );
  });

  it("**反向钉**：四个入口自己不许再判一次「有没有书」", () => {
    // 原先想钉「need-book 在整个文件里只写一次」——**那是个错的判据**：
    // `onChildAction`（左栏子项点击）也会写 need-book，那是**另一个触发源**
    // （世界观 / 人物 那些子项），对话框是同一个、判定各归各。
    // 真正该禁的是：入口函数里内联一份自己的判据，那就成了同一闸的第二份实现。
    for (const fn of ["openStats", "openLibraryDialog"]) {
      const body = functionBody(script, fn);
      expect(body, `${fn} 里出现了第二份「有没有书」的判定`).not.toContain("hasBook");
      expect(body, `${fn} 里出现了第二份「有没有书」的判定`).not.toContain("docs.length");
      expect(body, `${fn} 必须走 requireBook`).toContain("requireBook(");
    }
  });
});

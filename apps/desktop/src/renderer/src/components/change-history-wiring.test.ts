import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_CHANGE_RETENTION, changeRetentionNote } from "@mochen/contracts";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 改稿历史与回滚的**接线契约**。
 *
 * 这个功能要回答的是「AI 改坏了怎么办」，所以接线必须满足三件事，缺一件这条链就是摆设：
 * ① 入口挂在真按钮上，按钮调 store 动作，不是组件自己摸 `window.mochen`；
 * ② 回滚**先看改前**再给按钮——不摆预览就给一颗「回滚」太危险；
 * ③ 指纹传的是盘上此刻的值：那串从 `readDoc` 现读现传，传旧的等于把主进程那道闸关掉。
 *
 * `.vue` 零自动化覆盖，只能读源文件钉。读法走 vue-source-reader（剥注释），
 * 否则「这里没有 X」这句话本身写着 X。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const panelScript = scriptSource("components/ChangeHistoryPanel.vue");
const panelTpl = templateSource("components/ChangeHistoryPanel.vue");
const storeSource = readFileSync(
  fileURLToPath(new URL("../stores/useBookStore.ts", import.meta.url)),
  "utf8"
);
// 2026-10-21：五条动作的实现从 store 搬到 `book-change-history.ts`（store 贴到 800 行预算）。
// 搬的是代码位置，不是判据——下面仍钉同一批字符串，只是读的那份文件换成了搬去的地方。
const changeHistorySource = readFileSync(
  fileURLToPath(new URL("../stores/book-change-history.ts", import.meta.url)),
  "utf8"
);
const css = styleSource("change-history.css");

describe("入口挂在哪", () => {
  it("右栏头部真有一颗按钮，禁用条件是「没开书」而不是永远可点", () => {
    expect(paneTpl).toContain('aria-label="改稿历史"');
    expect(paneTpl).toContain('@click="toggleChangeHistory"');
    expect(paneTpl).toContain(':disabled="!book.meta"');
  });

  it("按钮切的是 store 那一格，不是组件自己持的布尔", () => {
    expect(paneScript).toContain("changeHistoryOpen");
    expect(paneScript).toContain("book.openChangeHistory()");
    expect(paneScript).toContain("book.closeChangeHistory()");
  });

  it("面板挂在 DocumentPane 里，锚点就是那颗按钮", () => {
    expect(paneTpl).toContain("<ChangeHistoryPanel");
    expect(paneTpl).toContain(':anchor="changeHistoryAnchor"');
    expect(paneScript).toContain("changeHistoryButton");
  });

  it("浮层走 Teleport 到 body（本仓弹层规矩）", () => {
    expect(panelTpl).toContain('<Teleport to="body">');
    expect(panelScript).toContain("useComposerContextPopover");
  });
});

describe("先看改前，才给回滚", () => {
  it("列表行调 peekChange（读改前正文），不是直接回滚", () => {
    expect(panelTpl).toContain('@click="book.peekChange(row)"');
    expect(panelTpl).not.toContain('@click="book.restoreChange(row)"');
  });

  it("回滚按钮要选中了某条、且改前正文已经读回来才在", () => {
    expect(panelTpl).toContain('v-if="selected"');
    expect(panelTpl).toContain("preview.content");
    expect(panelTpl).toContain('@click="book.restoreChange(selected)"');
  });

  // 2026-10-13：这一档把「改前的整篇」升级成「改前 ↔ 盘上此刻的逐行差别」，
  // 但 ② 那句老规矩一个字没松：**回滚按钮出现之前，用户看得见东西**。
  // 于是这里钉的是「diff 有真绑定」而不是「有个 pre 标签」——
  // 组件里写一颗摆不出内容的对比块（假控件）当场就该红。
  it("逐行对比摆的是主进程算好的那份 diff，用的是提案卡同一个渲染器", () => {
    expect(panelScript).toContain('import DiffHighlighter from "./DiffHighlighter.vue"');
    expect(panelTpl).toContain('<DiffHighlighter v-if="preview.diff" :diff="preview.diff" />');
    // 那句话由 utils 生成（行数是数出来的），不在组件里手写「+ 3 行」那种死文案。
    expect(panelScript).toContain("changeDiffCaption");
    expect(panelTpl).toContain("{{ diffCaption }}");
  });

  it("整篇改前正文仍然可达：一键展开，对比算不出来时直接摊开", () => {
    expect(panelTpl).toContain('@click="showFullText = !showFullText"');
    expect(panelTpl).toContain('v-if="showFullText" class="change-history-preview"');
    expect(panelTpl).toContain('v-if="preview.diff === null" class="change-history-preview"');
  });

  it("在途时按钮禁用：重复点不会发两次 IPC", () => {
    expect(panelTpl).toContain(':disabled="book.changesBusy"');
  });
});

/**
 * 一键撤销（P0-5）。
 *
 * 「提案落盘后能撤销这一次改动」在界面上是一颗按钮，在链路上必须是**真实写盘 + 真实改稿历史**：
 * ① 面板行右侧那颗走 store 的 `undoChange`，组件不摸 IPC；
 * ② `undoChange` 先把那一篇打开（回滚守卫要求活动标签就是它），再走 `restoreBackupToDoc`；
 * ③ 同一条 `changes:restore` 会在写回前给盘上此刻的正文留一份备份，所以撤销本身也是一条新记录。
 * 只改界面状态的那种实现（把列表里这一行划掉、盘上没动）在这里没有落脚点。
 */
describe("一键撤销某一次改动", () => {
  it("每一行右侧都有一颗「撤销」，接的是 store 的 undoChange", () => {
    expect(panelTpl).toContain('aria-label="撤销这次改动"');
    expect(panelTpl).toContain('@click="book.undoChange(row)"');
    // 行主体仍是「看改前」：这颗是另一颗键，不替换 peek。
    expect(panelTpl).toContain('@click="book.peekChange(row)"');
    expect(storeSource).toContain("undoChange(this, entry)");
  });

  it("撤销先打开那一篇，再走同一条回滚编排（不另开第二条写盘的路）", () => {
    expect(changeHistorySource).toContain("await host.openDocTab(entry.docRelPath);");
    expect(changeHistorySource).toContain("await restoreChange(host, entry);");
  });

  it("撤销那颗键的样式不是空壳", () => {
    expect(ruleBlock(css, ".change-history-undo")).not.toBe("");
  });
});

/**
 * 「跳到那一篇」（2026-10-13）。
 *
 * 它补的是这条链上真正的断点：`restoreChange` 要求先把那一篇打开（「先打开那一篇正文」那句拒绝），
 * 可面板里从来没有任何一颗键能把用户送到那一篇去——用户只能自己回左栏翻标签。
 * 这颗必须走 `book.openDocTab`：标签、正文、指纹闸都在那个动作里一起就位，
 * 组件自己摸 IPC 就是绕过 store 那一格的三处状态（列表 / 选中 / 草稿）。
 */
describe("跳到那一篇", () => {
  it("按钮调 jumpToDoc，jumpToDoc 走 store 的 openDocTab 并收起浮层", () => {
    expect(panelTpl).toContain('@click="jumpToDoc"');
    expect(panelScript).toContain("book.openDocTab(entry.docRelPath)");
    expect(panelScript).toContain("close();");
  });

  it("没选中任何一条时不发 IPC（return 在那颗动作前面）", () => {
    expect(panelScript).toContain("if (entry === null) return;");
  });
});

describe("回滚那三件事：这里只钉接线，行为用例住在运行时", () => {
  // 这三条原先钉的是 store 源码字符串（`const current = await window.mochen.readDoc(...)`、
  // 「这一篇在这之后又被改过了」、「先打开那一篇正文」）——那套写法的前提是逻辑住在
  // `.ts` 之外的 store 动作里、点不到运行时。2026-10-13 编排搬进 `utils/change-history.ts`
  // 的 `restoreBackupToDoc`，同一条链在 `change-history.test.ts`（守卫不发 IPC、指纹现读现传、
  // stale 与被拒的文案、抛错不冒出去）和 `useBookStore.changes.test.ts`（真跑 store 动作）里
  // 各有能失败用例 ⇒ 源码字符串就是第二份判据：搬一次家红三行，而它承诺的行为一条没变。
  // 所以只留「store 确实把那颗按钮接到了那份编排上」——这条不运行时验，因为它验的是接线。
  // 2026-10-21 搬家后再补一句：store 那颗动作必须真的把 `this` 递给编排模块，
  // 否则面板点了 store 动作、store 动作却没往下走，链子看着在、实则断在中间。
  it("restoreChange 用的就是那份编排，传的是此刻的当前正文标签", () => {
    expect(storeSource).toContain("restoreChange(this, entry)");
    expect(changeHistorySource).toContain(
      "restoreBackupToDoc(changeRestoreIpc, entry, host.activeDocTab)"
    );
    expect(changeHistorySource).toContain("host.notice = outcome.notice");
  });

  it("编排那两扇 IO 指的是 readDoc 与 restoreChange，不是别的通道", () => {
    expect(changeHistorySource).toContain("readDoc: (relPath) => window.mochen.readDoc(relPath)");
    expect(changeHistorySource).toContain(
      "window.mochen.restoreChange(backupRelPath, expectedFingerprint)"
    );
  });
});

describe("样式", () => {
  it("两条新规则的正文都非空壳", () => {
    expect(ruleBlock(css, ".change-history-preview")).not.toBe("");
    expect(ruleBlock(css, ".change-history-restore")).not.toBe("");
  });

  // 回归：面板是可滚的 flex 列，列表没写 flex: none 时会被压成「5 条只露 1 条」的高度
  // （2026-10-05 真机截图里就是这个现象）。计数 chip 则替滚出视野的那些条数作证。
  // 2026-10-05 批次 3：列表加了显示上限，计数因此改报**总数**（rows.length）——
  // 截到 60 条还写「60 次改动」就是骗人，那 10 条折叠掉的去哪了？
  it("列表与详情都不许被 flex 压扁，计数 chip 摆在标题旁边", () => {
    expect(ruleBlock(css, ".change-history-list")).toContain("flex: none");
    expect(ruleBlock(css, ".change-history-detail")).toContain("flex: none");
    expect(ruleBlock(css, ".change-history-count")).not.toBe("");
    expect(panelTpl).toContain("changeCountLabel(total)");
  });

  // 回归：浮层高度是定位算法按锚点周围空余给的（行内 maxHeight 盖过 CSS 的 520），
  // 窗口一小「回滚」就掉到折叠线以下（真机实测差 120px）。主操作必须吸底。
  it("回滚按钮吸底，不许被内容推到折叠线以下", () => {
    expect(ruleBlock(css, ".change-history-restore")).toContain("position: sticky");
  });

  it("组件里不写 <style>：本仓样式全在 styles/ 下", () => {
    expect(countNeedle("<style", vueSource("components/ChangeHistoryPanel.vue"))).toBe(0);
    expect(css).toContain(".change-history");
  });

  // 逐行对比这一档的三枚新东西都得有样式（空壳规则=渲染出来没排版，真机上一眼能看出没干活）。
  it("对比上方那句话、整篇开关、跳到那一篇：三枚样式正文都非空壳", () => {
    expect(ruleBlock(css, ".change-history-caption")).not.toBe("");
    expect(ruleBlock(css, ".change-history-toggle")).not.toBe("");
    expect(ruleBlock(css, ".change-history-jump")).not.toBe("");
  });

  // 反向守卫：这个浮层的每一次读盘都归 store（列表 / 选中 / 预览三格状态在那边），
  // 组件自己摸 window.mochen 就等于把同一件事的在途标记散成两份。
  it("面板不自己摸 window.mochen", () => {
    expect(panelScript).not.toContain("window.mochen");
  });
});

/**
 * 保留策略的接线（2026-10-06）。
 *
 * **这块守卫在批次 5-⑧ 换过一次判据**。原来面板那句上限是写死「50 份 / 32 MB」的死文案，
 * 于是这条守卫去比对「文案里的数字」与「fs-store 的常量」——靠人记得同步两份。
 * 上限做成设置页可调之后那个办法不成立了（用户调成 10 份，面板还会说 50 份），
 * 所以现在改成钉**数据流**：面板那句文案必须由 `changeRetentionNote(当前那份)` 生成，
 * 当前那份必须来自 retention store，而那个 store 必须从主进程读。
 * 文案只有一处生成，「面板说的」与「主进程做的」从此不是靠守望相助。
 */
describe("保留上限：面板说的是当前真实生效的那一份", () => {
  const fsStoreSource = readFileSync(
    // 从 components/ 退到仓根要 6 级：components → src → renderer → src → desktop → apps → 仓根
    fileURLToPath(new URL("../../../../../../packages/fs-store/src/changes.ts", import.meta.url)),
    "utf8"
  );

  it("面板那句话由 contracts 的 changeRetentionNote 生成，不在组件里手写数字", () => {
    expect(panelScript).toContain("changeRetentionNote");
    expect(panelTpl).toContain("changeRetentionNote");
    // 生成函数那句话里的两个数，必须来自传进去的那份上限而不是字面量。
    const generated = changeRetentionNote({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    expect(generated).toContain("10 份");
    expect(generated).toContain("5 MB");
    expect(generated).not.toContain(String(DEFAULT_CHANGE_RETENTION.maxCount));
    expect(generated).not.toContain(
      `${Math.round(DEFAULT_CHANGE_RETENTION.maxBytes / 1024 / 1024)} MB`
    );
  });

  it("面板确实把当前那份上限递进生成函数（不是调用了却递了别的）", () => {
    expect(panelTpl).toContain("changeRetentionNote(currentRetention)");
    expect(panelScript).toContain("useChangeRetentionStore");
    // 读的是主进程那份，不是 localStorage 里自己存的一份。
    expect(panelScript).toContain("retention.ensureLoaded()");
  });

  it("写盘那侧的上限来自主进程 store，而不是又抄了一份默认数", () => {
    // 从 components/ 退到 apps/desktop/ 是 4 级（components→src→renderer→src→desktop），
    // 再拼 src/main/ 进主进程那份源码（上面退到仓根是 6 级，多两级 apps + desktop）。
    const bookService = readFileSync(
      fileURLToPath(new URL("../../../../src/main/book-service.ts", import.meta.url)),
      "utf8"
    );
    expect(bookService).toContain("deps.retention()");
    const index = readFileSync(
      fileURLToPath(new URL("../../../../src/main/index.ts", import.meta.url)),
      "utf8"
    );
    // 装配处把 store 的同步读口递下去：写盘淘汰与设置页改的是同一个来源。
    expect(index).toContain("createChangeRetentionStore");
    expect(index).toContain("retentionStore.current()");
  });

  it("写盘与回滚两条路都挂了淘汰（回滚会攒备份，绕过上限就等于上限不存在）", () => {
    const readWrite = readFileSync(
      fileURLToPath(
        new URL("../../../../../../packages/fs-store/src/read-write.ts", import.meta.url)
      ),
      "utf8"
    );
    expect(readWrite).toContain("pruneChanges");
    expect(fsStoreSource).toContain("pruneChanges");
    // restoreChange 里也必须有——这条最容易漏，漏了就是「回滚攒出一堆回滚」
    const restoreBlock = /async function restoreChange[\s\S]*$/.exec(fsStoreSource)?.[0] ?? "";
    expect(restoreBlock.length).toBeGreaterThan(0);
    expect(restoreBlock).toContain("pruneChanges");
  });

  it("回滚那条路收的是当前上限（不收就等于能从上限外侧绕过去）", () => {
    const changesService = readFileSync(
      fileURLToPath(new URL("../../../../src/main/changes-service.ts", import.meta.url)),
      "utf8"
    );
    expect(changesService).toContain("deps.retention.read()");
  });

  it("面板不谎称「只有批准改稿才留」（实测：备份认的是每次写盘，含自动保存）", () => {
    expect(panelTpl).not.toContain("每批准一次改稿");
    expect(panelTpl).toContain("每写一次盘");
  });

  it("空态那句话不谎称要批准提案（只要你打字，2 秒后它自己就出现了）", () => {
    expect(panelTpl).not.toContain("批准一次提案之后");
  });
});

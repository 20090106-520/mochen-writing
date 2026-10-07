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
    expect(panelTpl).toContain('v-else class="change-history-preview"');
    expect(panelTpl).toContain('@click="book.restoreChange(selected)"');
  });

  it("在途时按钮禁用：重复点不会发两次 IPC", () => {
    expect(panelTpl).toContain(':disabled="book.changesBusy"');
  });
});

describe("指纹闸不许被绕过", () => {
  it("回滚的指纹现读现传，不许从别的格子抄一个旧的", () => {
    expect(storeSource).toContain("const current = await window.mochen.readDoc(entry.docRelPath);");
    expect(storeSource).toContain(
      "window.mochen.restoreChange(entry.backupRelPath, current.fingerprint)"
    );
  });

  it("stale 说人话：告诉用户是被谁抢先改了，而不是只丢一个 reason", () => {
    expect(storeSource).toContain("这一篇在这之后又被改过了");
  });

  it("没打开那一篇正文就不许回滚（否则刷新的是别的文稿）", () => {
    expect(storeSource).toContain("先打开那一篇正文");
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

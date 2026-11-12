/// <reference types="node" />
/**
 * 设置中心两张「表」的版式（2026-11-12）：快捷键页、关于页。
 *
 * 两处都是同一类毛病——**同一族卡片里它一个漏了**：
 *
 * ① 快捷键页 **文字贴着卡片边框**。`.settings-card` 的 padding 是 `6px 0`——那 0 是给
 *    `.settings-item` 那族留的，那些行自己带 `14px 18px`。而快捷键页是
 *    「组标题 + 表格」直接进来的，谁也没带那 18px：量到组标题与 `Ctrl ,`
 *    距卡片左边框 **1px**。同一族的关于页 dt 距边框 18.7px，一直是对的。
 *
 * ② 快捷键页 **组标题比它下面的字还弱**。它是 11px 的三级灰，而表里正文 12px——
 *    六个分组在屏上收成「六块没有名字的卡」，看不出这一组从哪儿开始。
 *
 * ③ 关于页 **一层 grid 被一层 flex 压掉**：`.about-fact` 写的是 `76px 1fr` 两栏，
 *    可它同时挂着 `.settings-item`（`display: flex` + 值靠右），grid 从未生效。
 *    说明最长的那行标签被挤成 0 宽、值吃下大半个卡片并右对齐。
 *
 * 另撤掉 `.settings-card:hover` 的高程抬档：这一族卡片一条点击都没有，
 * 鼠标划过却整张浮起来，是假的可点暗示（与 `.settings-item` 不写 cursor:pointer 同一条规矩）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ruleBlock,
  scopedStyleSource,
  strippedStyleSource,
  styleSource
} from "../utils/vue-source-reader";

const DIALOG = styleSource("dialog.css");
const SETTINGS = strippedStyleSource("settings-page.css");

describe("快捷键页 · 卡片里的字不许贴着框", () => {
  it("组标题左右内缩 18px（与 settings-item 同一条竖线）", () => {
    expect(ruleBlock(DIALOG, ".hotkeys-group-title")).toContain("padding: 0 18px");
  });

  it("首列补左内缩、末列补右内缩；中间列不动（那是列与列之间的沟）", () => {
    expect(ruleBlock(DIALOG, ".hotkeys-table th:first-child")).toContain("padding-left: 18px");
    expect(ruleBlock(DIALOG, ".hotkeys-table td:last-child")).toContain("padding-right: 18px");
    // 中间那一列若也补 18px，整张表会被推宽，键位列的 30% 跟着失真。
    // （选择器写作 `.hotkeys-table td`：两条选择器共用这一段声明，取后一条的块即可。）
    const middle = ruleBlock(DIALOG, ".hotkeys-table td");
    expect(middle).toContain("padding: 5px 8px 5px 0");
  });

  it("组标题比表里的行话更重：13px、正文档，不是 11px 三级灰", () => {
    const title = ruleBlock(DIALOG, ".hotkeys-group-title");
    expect(title).toContain("font-size: 0.928571rem");
    expect(title).toContain("color: var(--text)");
    expect(title, "11px 三级灰回来了 —— 组标题又比正文还弱").not.toContain(
      "font-size: 0.785714rem"
    );
  });
});

describe("设置卡片 · 不装可点", () => {
  it("没有 hover 高程规则（这一族卡片一条点击都没有）", () => {
    expect(SETTINGS).not.toContain(".settings-card:hover");
  });

  it("卡片本体的边与底仍在（只撤悬停，不是把卡片样式删了）", () => {
    const card = ruleBlock(SETTINGS, ".settings-card");
    expect(card).toContain("border: 1px solid var(--line-soft)");
    expect(card).toContain("box-shadow: var(--shadow-sm)");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   关于页 · 那四行不是「标签 …… 值」，是「标签 + 一句话说明」（2026-11-12）

   真机量到：`.about-fact` 同时挂着 `.about-fact`（`grid: 76px 1fr`）与 `.settings-item`
   （`display: flex`，值 `text-align: right`）。后者后写、特异性也高，grid 从来没生效：
   「版本」的 dt 占 414px、值缩在右缘；说明最长的那行「配置」dt 被挤成 **0 宽**
   （两个字竖着摞）、值吃下 643px 并右对齐——一段话右对齐，左边全是参差缺口。

   钉两件事：模板不许把 `.settings-item` 挂回这几行；网格与行距由 `.about-fact` 自己给。
   */
describe("关于页 · 标签 + 说明两栏左对齐", () => {
  const SFC = readFileSync(path.join(__dirname, "AboutPanel.vue"), "utf8");

  it("事实行不再挂 settings-item（挂回去就是 flex 压过 grid）", () => {
    const rows = [...SFC.matchAll(/class="about-fact([^"]*)"/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThan(0);
    for (const extra of rows) {
      expect(extra, "`settings-item` 挂在 about-fact 上了 —— 值又会被推到右缘").not.toContain(
        "settings-item"
      );
    }
  });

  it("两栏网格 + 顶端对齐 + 行自带 14px 18px 的内边距与分隔线", () => {
    const cell = ruleBlock(DIALOG, ".about-fact");
    expect(cell).toContain("display: grid");
    expect(cell).toContain("grid-template-columns: 76px 1fr");
    expect(cell).toContain("align-items: start");
    expect(cell).toContain("padding: 14px 18px");
    expect(ruleBlock(DIALOG, ".about-fact:not(:last-child)")).toContain(
      "border-bottom: 1px solid var(--line-soft)"
    );
  });

  it("「值靠右」这条通用规则已随最后一位消费者一起删掉", () => {
    expect(SETTINGS).not.toContain(".settings-item-value");
  });

  it("行标题与「更新」那张卡同一档（1rem / 590 / 正文档），不是 12px 三级灰", () => {
    const term = ruleBlock(DIALOG, ".about-term");
    expect(term).toContain("font-size: 1rem");
    expect(term).toContain("font-weight: 590");
    expect(term).toContain("color: var(--text)");
    // `<strong>` 的 UA bolder 会盖掉 590 —— 这一条是让它按继承走。
    expect(ruleBlock(DIALOG, ".about-term strong")).toContain("font-weight: inherit");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   写作目标 · 整页裸排，与同一栏目录里别的页两种版式（2026-11-12）

   这一页原先一组卡片都没有：模型配置 / 智能体 / 快捷键 / 关于 / 远程备份都是卡，
   只有它与外观裸排——同一栏目录里翻页像换了半个应用。
   更要紧的是开关那一行：`justify-content: space-between` 把勾选框推到 660px 外的
   内容列右缘，中间空着、没有行框也没有分隔线，读起来不像「一行」，
   而是「一句话」加「一个漂着的勾」。

   顺带把它从 deepwrite 时期的旧口径（`--border` / `--bg-secondary` / 6px 圆角 /
   写死的 `#fff` / `0.15s ease`）换成与全仓同一套令牌。
   */
describe("写作目标 · 三组装进卡片，控件回同一套令牌", () => {
  const GOAL = readFileSync(path.join(__dirname, "WritingGoalSettingsPanel.vue"), "utf8");
  const GOAL_CSS = scopedStyleSource("components/WritingGoalSettingsPanel.vue");
  const markup = GOAL.slice(GOAL.indexOf("<template>"), GOAL.lastIndexOf("</template>"));

  it("三组各套一张 settings-card（开关 / 字数 / 时长）", () => {
    expect(markup.split('class="settings-card').length - 1).toBe(3);
  });

  it("开关行内缩 14px 18px，与 settings-item 那一族同一条竖线", () => {
    expect(ruleBlock(GOAL_CSS, ".goal-toggle-row")).toContain("padding: 14px 18px");
  });

  it("预设钮圆角 8、面用 --surface-raised、线用 --line-soft（不再是 6px 的旧口径）", () => {
    const btn = ruleBlock(GOAL_CSS, ".goal-preset-btn");
    expect(btn).toContain("border-radius: 8px");
    expect(btn).toContain("background: var(--surface-raised)");
    expect(btn).toContain("border: 1px solid var(--line-soft)");
    expect(btn, "又回到 --border / --bg-secondary 那套旧令牌了").not.toContain("var(--border)");
  });

  it("选中档的字色取 --accent-contrast，不写死 #fff", () => {
    const active = ruleBlock(GOAL_CSS, ".goal-preset-btn.is-active");
    expect(active).toContain("var(--accent-contrast");
    expect(active).not.toContain("#fff;");
  });

  it("过渡时长走令牌，不写裸秒数", () => {
    expect(GOAL_CSS).not.toMatch(/\b0\.\d+s\b/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   远程备份 · 竖排之后 `align-items` 换了轴（2026-11-12）

   `.webdav-field` 是 `.settings-item` 加 `flex-direction: column`。`.settings-item` 的
   `align-items: center` 在横排时是「竖直居中」，竖排之后同一个值变成「横向居中」——
   真机量到「地址 / 用户名 / 密码」三个标签各自缩在卡片正中（离左边 330px），
   而下面的输入框满宽左对齐：一只标签浮在一只框的上方正中，读起来像错版。

   这一条钉住「竖排容器要撑满」：谁把 `align-items: stretch` 删了，三个标签立刻回中间。
   */
describe("远程备份 · 标签不许在卡片正中", () => {
  it("竖排字段行 align-items: stretch（标签贴左、输入框走 100%）", () => {
    const field = ruleBlock(SETTINGS, ".webdav-field");
    expect(field).toContain("flex-direction: column");
    expect(field, "删掉 stretch，三个标签又会各自飘到卡片正中").toContain("align-items: stretch");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   项目管理 · 「两段裸字 + 一张卡」（2026-11-12）

   这一页三组：当前作品 / 操作 / 最近作品。其中第三组那张清单本来就是一张卡
   （`.project-list` 自带描边、圆角、surface-card、shadow-sm），前两组却是裸的——
   一页里两种外壳，而同一栏目录的模型配置 / 智能体 / 快捷键 / 关于 / 远程备份全是卡。

   顺带把清单行的起算位从 4px 补到 10px（+ 行内 8px = 18px，与 `.settings-item` 同一竖线）：
   原先书名离卡片左边只有 12px，比同屏其它列表都紧一档。
   */
describe("项目管理 · 三组同一个外壳", () => {
  const PROJ = readFileSync(path.join(__dirname, "ProjectSettingsPanel.vue"), "utf8");
  const PROJ_CSS = scopedStyleSource("components/ProjectSettingsPanel.vue");
  const markup = PROJ.slice(PROJ.indexOf("<template>"), PROJ.lastIndexOf("</template>"));

  it("当前作品、操作两组也套 settings-card（最近作品那张清单自己就是卡）", () => {
    expect(markup.split('class="settings-card').length - 1).toBe(2);
    expect(markup).toContain('class="project-list"');
  });

  it("卡里那两行内缩 14px 18px", () => {
    expect(ruleBlock(PROJ_CSS, ".project-current")).toContain("padding: 14px 18px");
    expect(ruleBlock(PROJ_CSS, ".project-actions")).toContain("padding: 14px 18px");
  });

  it("清单行起算 10px（+ 行内 8px = 18px）", () => {
    expect(ruleBlock(PROJ_CSS, ".project-row")).toContain("padding: 1px 10px");
  });
});

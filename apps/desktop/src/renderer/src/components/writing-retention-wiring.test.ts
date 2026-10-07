/**
 * 「改稿历史保留」那一节的接线契约（2026-10-06 批次 5-⑧）。
 *
 * **为什么要单独钉这一节**：它与同一页其它几节不一样——那几节的偏好住 localStorage，
 * 写错最多是「这一格没生效」；这一节的上限**会决定写盘时删掉多少用户的历史**。
 * 三种「控件说了但没做」在这里都不是小事：
 * ① 高亮的档位是本地乐观值、盘上存的是另一个（用户以为留着 10 份，实际按 50 份删）；
 * ② 「立即清理」走的是另一套判定（等于有两份「该删哪些」）；
 * ③ 没开书时回一份 `removed: 0`，界面显示成「已清理」，用户以为白按了一次。
 *
 * 本仓 `.vue` 零自动化覆盖，所以这里读源码钉接线形状（用 `vue-source-reader`，不自己拼路径）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHANGE_RETENTION_COUNT_MAX,
  CHANGE_RETENTION_COUNT_MIN,
  CHANGE_RETENTION_MB_MAX,
  CHANGE_RETENTION_MB_MIN,
  DEFAULT_CHANGE_RETENTION,
  changePruneReportLine,
  changeRetentionCountOptions,
  changeRetentionMbOptions
} from "@mochen/contracts";
import { countNeedle, scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const panelScript = scriptSource("components/WritingPanel.vue");
const panelTpl = templateSource("components/WritingPanel.vue");
const css = readFileSync(
  fileURLToPath(new URL("../styles/settings-page.css", import.meta.url)),
  "utf8"
);

describe("档位表与文案只有 contracts 那一处", () => {
  it("面板从 contracts 取档位与文案，不在组件里手抄", () => {
    expect(panelScript).toContain("changeRetentionCountOptions");
    expect(panelScript).toContain("changeRetentionMbOptions");
    expect(panelScript).toContain("changeRetentionNote");
    // 组件里不该再出现这两个数字的硬写（档位与默认档都在 contracts）。
    expect(panelScript).not.toMatch(/\bmaxCount:\s*50\b/);
    expect(panelScript).not.toMatch(/\bmaxBytes:\s*32\s*\*/);
  });

  it("每档的份数与体积都落在 contracts 允许的范围里（不许摆出配不出去的档）", () => {
    for (const option of changeRetentionCountOptions()) {
      expect(option.value).toBeGreaterThanOrEqual(CHANGE_RETENTION_COUNT_MIN);
      expect(option.value).toBeLessThanOrEqual(CHANGE_RETENTION_COUNT_MAX);
      expect(option.note.length).toBeGreaterThan(0);
    }
    for (const option of changeRetentionMbOptions()) {
      const bytes = option.value * 1024 * 1024;
      expect(bytes).toBeGreaterThanOrEqual(CHANGE_RETENTION_MB_MIN * 1024 * 1024);
      expect(bytes).toBeLessThanOrEqual(CHANGE_RETENTION_MB_MAX * 1024 * 1024);
      expect(option.note.length).toBeGreaterThan(0);
    }
  });

  /**
   * **真机复验逮到的**：范围下界原先是 5，而档位表是 10/25/50/100/200/500。
   * 于是「配 5 份」在语义上合法、界面上却**没有任何一档能被选中**——两排卡片全是灰的，
   * 用户既不知道自己存了什么，也改不回去。
   *
   * 「允许一个选不出来的档」是自相矛盾的：范围必须与档位表**完全**一致。
   * 这条守卫把两侧的端点对着钉死。
   */
  it("份数范围与份数档位表完全一致（不许存在「配得出来、选不中」的档）", () => {
    const counts = changeRetentionCountOptions().map((o) => o.value);
    expect(Math.min(...counts)).toBe(CHANGE_RETENTION_COUNT_MIN);
    expect(Math.max(...counts)).toBe(CHANGE_RETENTION_COUNT_MAX);
  });

  it("默认档在两档位表里都能被选到（否则用户第一次进来看到的是「两排都没选中」）", () => {
    const counts = changeRetentionCountOptions().map((o) => o.value);
    const mbs = changeRetentionMbOptions().map((o) => o.value * 1024 * 1024);
    expect(counts).toContain(DEFAULT_CHANGE_RETENTION.maxCount);
    expect(mbs).toContain(DEFAULT_CHANGE_RETENTION.maxBytes);
  });
});

describe("改一格 → store.save，不是组件自己摸 IPC", () => {
  it("两份档位都走 store.save", () => {
    expect(panelScript).toContain("retention.save({ maxCount: value })");
    expect(panelScript).toContain("retention.save({ maxBytes: mb * 1024 * 1024 })");
    expect(panelScript).not.toContain("window.mochen.changesRetention");
  });

  it("高亮判的是 store 那份真值，不是点下去时先乐观拨过去的临时量", () => {
    // 两组卡片的 is-active 都读 retentionValue.maxCount / .maxBytes。
    expect(panelTpl).toContain("retentionValue.maxCount === option.value");
    expect(panelTpl).toContain("retentionValue.maxBytes === option.value * 1024 * 1024");
  });

  it("「不是用户设过的」那句只在 persisted 为假时出现", () => {
    expect(panelTpl).toContain('v-if="!retentionPersisted"');
    expect(panelScript).toContain("storeToRefs(retention)");
  });
});

describe("「立即清理」", () => {
  it("按钮调的是 store 那枚动作，不是组件自己碰 IPC", () => {
    expect(panelTpl).toContain('@click="retention.pruneNow()"');
    expect(panelScript).not.toContain("window.mochen.changesPruneNow");
  });

  it("没开书时按钮摆着但点不动，且**当面说清为什么**（不给一个点了没反应的按钮）", () => {
    expect(panelTpl).toContain(':disabled="pruning || !book.hasBook"');
    expect(panelTpl).toContain('v-if="!book.hasBook"');
    expect(panelTpl).toContain("改稿历史是每本书各自一份");
  });

  it("清理结果与错误各有一块地方摆（不塞进同一个字段里互相覆盖）", () => {
    expect(panelTpl).toContain('v-if="retention.pruneLine"');
    expect(panelTpl).toContain('v-if="retention.error"');
  });

  it("那条话由 contracts 生成，且**清掉 0 条与清掉多条说的不是同一句**", () => {
    const none = changePruneReportLine({
      removed: 0,
      kept: 8,
      freedBytes: 0,
      keptBytes: 100
    });
    const some = changePruneReportLine({
      removed: 12,
      kept: 38,
      freedBytes: 1000,
      keptBytes: 100
    });
    expect(none).not.toBe(some);
    expect(none).toContain("没什么可清");
    expect(some).toContain("删掉 12 份");
  });
});

describe("组件里不写 <style>：本仓样式全在 styles/ 下", () => {
  it("新按钮的类在样式表里有对应的一条，且不在组件里内联", () => {
    expect(countNeedle("<style", vueSource("components/WritingPanel.vue"))).toBe(0);
    expect(panelTpl).toContain("settings-action-button");
    expect(css).toContain(".settings-action-button");
    // 禁用态必须单独有：只做外观不写禁用，按钮点不动时用户看不出来为什么。
    expect(css).toMatch(/\.settings-action-button:disabled/);
  });
});

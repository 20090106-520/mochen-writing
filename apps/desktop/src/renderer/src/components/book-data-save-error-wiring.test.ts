import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scopedStyleSource,
  tagAttributes,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 设定落盘失败的可见性（2026-10-09 扫描总单 P0-7 的最后一格）。
 *
 * 通路本体（`composables/useBookFileData`）把失败原因留在 `saveError` 里，store 也把它交出去了，
 * 但**屏上没人读它**——那正是 P0-2 那一族的形状：代码知道自己失败了，界面却一言不发。
 * 这一枚钉的是**每一块会改设定数据的面板**（笔记 / 故事圣经 / 写作目标浮层 /
 * 设置页里的目标那一栏 / 字数统计那一格）都有一条真读 `saveError` 的提示，
 * 而不是只有 store 里有那个字段。
 *
 * 为什么用源码契约而不是挂组件跑：本仓没有 jsdom / @vue/test-utils（`.vue` 不进类型程序），
 * 少挂一个 `v-if`、错绑一个字段，tsc 与 build 都不报，只有读源文件才抓得住。
 */

type Panel = {
  file: string;
  /** 面板里那枚 store 的变量名：模板必须读它，读一个本地 ref 就等于把状态又造了一份。 */
  storeVar: string;
  cls: string;
  storeFile: string;
  /**
   * 样式住哪儿：多数面板是 SFC 内联 `<style scoped>`，故事圣经那一枚是
   * `<style scoped src="./story-bible-panel.css">`——内联块是空的，
   * 只读 SFC 就会把「规则写在外部表里」判成「没写规则」。
   */
  stylesheet: () => string;
};

const PANELS: Panel[] = [
  {
    file: "components/NotesPanel.vue",
    storeVar: "notes",
    cls: "notes-save-error",
    storeFile: "stores/useNotesStore.ts",
    stylesheet: () => scopedStyleSource("components/NotesPanel.vue")
  },
  {
    file: "components/StoryBiblePanel.vue",
    storeVar: "bible",
    cls: "bible-save-error",
    storeFile: "stores/useStoryBibleStore.ts",
    stylesheet: () => vueSource("components/story-bible-panel.css")
  },
  {
    file: "components/WritingGoalPanel.vue",
    storeVar: "store",
    cls: "goal-save-error",
    storeFile: "stores/useWritingGoalStore.ts",
    stylesheet: () => scopedStyleSource("components/WritingGoalPanel.vue")
  },
  // 另外两块也**会改**同一份目标数据（设置页改每日目标、字数面板改全书目标），
  // 只让浮层说话是不够的：作者在设置页点完保存，盘上没落而他看不见，仍然是 P0-2 那一族。
  {
    file: "components/WritingGoalSettingsPanel.vue",
    storeVar: "goalStore",
    cls: "goal-settings-save-error",
    storeFile: "stores/useWritingGoalStore.ts",
    stylesheet: () => scopedStyleSource("components/WritingGoalSettingsPanel.vue")
  },
  {
    file: "components/WordCountPanel.vue",
    storeVar: "goalStore",
    cls: "wc-save-error",
    storeFile: "stores/useWritingGoalStore.ts",
    stylesheet: () => scopedStyleSource("components/WordCountPanel.vue")
  }
];

for (const p of PANELS) {
  describe(`${p.file}：落盘失败必须上屏`, () => {
    const tpl = templateSource(p.file);
    const css = p.stylesheet();

    it(`store 把 saveError 交出来了（面板读的是它，不是自己另存一份）`, () => {
      expect(typeScriptSource(p.storeFile)).toContain("saveError,");
      // 三本 store 都走同一条通路，不是各自再抄一份落盘逻辑。
      expect(typeScriptSource(p.storeFile)).toContain("useBookFileData");
    });

    it(`模板里有一条读 ${p.storeVar}.saveError 的提示（v-if 让它只在真出错时出现）`, () => {
      expect(tpl).toContain(`v-if="${p.storeVar}.saveError"`);
      expect(tpl).toContain(`{{ ${p.storeVar}.saveError }}`);
      expect(countNeedle(`class="${p.cls}"`, tpl)).toBe(1);
    });

    it(`那条提示是动态出现的状态：role="status" + aria-live，与仓里既有写法同一种`, () => {
      const attrs = tagAttributes(tpl, p.cls);
      expect(attrs).toHaveLength(1);
      expect(attrs[0]).toContain('role="status"');
      expect(attrs[0]).toContain('aria-live="polite"');
    });

    it(`. ${p.cls} 有真规则，且颜色取自 --danger 而不是抄一支十六进制`, () => {
      const body = ruleBlock(css, `.${p.cls}`);
      expect(body).not.toBe("");
      expect(body).toContain("var(--danger");
      expect(body).toContain("font-size");
      // 字号一律 rem：写 px 的话用户调「界面字号」这一行不动，会被判定成设置坏了。
      expect(body).not.toMatch(/font-size:\s*[0-9.]+px/);
    });
  });
}

/**
 * W-06 源码接线契约：`.vue` 不进类型程序，装配层有没有真的把进度递给状态行，
 * 只能读源钉（vue-source-reader 会剥注释，只在注释里宣称「接上了」不算数）。
 *
 * 三条口径：① 状态文案唯一入口仍是 agent-thread.composeStatusLine；
 * ② 进度判定唯一真身是 utils/turn-progress，状态层不自己数事件；
 * ③ 「正文非空白字数」三处同读 bodyCharCount，不许再抄第四份 replace。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  scriptSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const CENTER = "components/CenterColumn.vue";
const STATUS = "utils/agent-thread.ts";
const PROGRESS = "utils/turn-progress.ts";
const CHARS = "utils/char-count.ts";
const GOAL = "stores/useWritingGoalStore.ts";
const SLOP = "utils/ai-slop.ts";

describe("状态行接线 · 进度与目标在装配层递给唯一入口", () => {
  it("CenterColumn 只装配一次 statusLine，第五参带进度读数与本章目标", () => {
    const script = scriptSource(CENTER);
    expect(countNeedle("composeStatusLine(", script), "状态行只在此装配").toBe(1);
    expect(script).toContain("const turnProgress = computed(() => turnProgressOf(thread.value))");
    expect(script).toContain("progress: turnProgress.value");
    expect(script).toContain("targetChars: goal.chapterTargetOf(book.activeDocTab ?? undefined)");
    expect(script).toContain("const goal = useWritingGoalStore()");
    expect(countNeedle("{{ statusLine }}", templateSource(CENTER)), "模板只挂一处").toBe(1);
  });

  it("composeStatusLine 仍是全仓状态文案的唯一真身", () => {
    expect(countNeedle("export function composeStatusLine(", typeScriptSource(STATUS))).toBe(1);
    expect(typeScriptSource(PROGRESS)).not.toContain("Esc 打断");
    expect(typeScriptSource(PROGRESS)).not.toContain("工作中");
  });

  it("进度判定只住 turn-progress：状态文案层不碰事件流与残字", () => {
    const status = typeScriptSource(STATUS);
    expect(status).not.toContain("streaming.message");
    expect(status).not.toContain("user-message");
    expect(status).not.toContain("thread.items");
    const progress = typeScriptSource(PROGRESS);
    expect(progress).toContain("user-message");
    expect(progress).toContain("streaming.message");
    expect(progress).toContain("thread.items");
  });
});

describe("字数口径 · 三处同读 bodyCharCount（铁律 6）", () => {
  it("写作目标、AI 腔密度、本轮进度都不许再写一份去空白计数", () => {
    for (const file of [GOAL, SLOP, PROGRESS]) {
      const source = typeScriptSource(file);
      expect(source, `${file} 必须引用唯一真身`).toContain("bodyCharCount");
      expect(source, `${file} 不许有第二份算法`).not.toContain("replace(/\\s/g");
    }
  });

  it("算法本体只留在 char-count.ts 一处", () => {
    expect(countNeedle('replace(/\\s/g, "").length', typeScriptSource(CHARS))).toBe(1);
  });
});

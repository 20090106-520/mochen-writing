import { describe, expect, it } from "vitest";
import {
  EDITOR_EMPTY_HINT,
  editorBodyState,
  editorLoadingLabel,
  type EditorBodyState
} from "./editor-readout";

/**
 * 中栏正文这一格的显示判定（2026-10-05 批次 3 尾巴）。
 *
 * 为什么要有这么一格判定：切标签时 `activeDocTab` 是**先**换的，正文 `draft` 要等
 * `await readDoc` 回来才换。那中间一段，中栏摆的是**新标题配旧正文**——
 * 不是空白，是撒谎，而且用户真照着改就会把上一篇的稿子写进这一篇。
 * 所以「正文有没有对上当前标签」这件事必须是一个判定，而不是各写各的。
 *
 * 文案与判定住 `.ts`：本仓 verify 跑裸 `tsc`，`.vue` 的 `<script setup>` 不进类型程序，
 * 写在组件里改名能全绿通过。这里被 vitest 钉死。
 */

const state = (loading: boolean, hasDoc: boolean): EditorBodyState =>
  editorBodyState({ loading, hasDoc });

describe("editorBodyState", () => {
  it("正在读 → 摆骨架，不摆正文（摆旧的等于撒谎）", () => {
    expect(state(true, true)).toBe("loading");
  });

  it("读完了且有这一篇 → 摆正文", () => {
    expect(state(false, true)).toBe("body");
  });

  it("没打开文稿 → 空态，不是一个空输入框", () => {
    expect(state(false, false)).toBe("empty");
  });

  // 边界：没开文稿时不该冒出骨架——没人在等一篇不存在的稿子。
  // 这格判成 loading 的话，冷启动会先抖一下骨架再退回空态，纯属自找的闪烁。
  it("又没开文稿又在读：判空态，不判骨架", () => {
    expect(state(true, false)).toBe("empty");
  });

  it("穷尽：四格输入各有一个确定结果，没有 undefined 漏网", () => {
    for (const loading of [true, false]) {
      for (const hasDoc of [true, false]) {
        expect(["loading", "empty", "body"]).toContain(state(loading, hasDoc));
      }
    }
  });
});

describe("editorLoadingLabel", () => {
  it("有标题就说清在读哪一篇", () => {
    expect(editorLoadingLabel("开局")).toBe("正在读《开局》…");
  });

  it("标题还没拿到就说人话，不摆一对空书名号", () => {
    for (const none of ["", "   "]) {
      expect(editorLoadingLabel(none)).toBe("正在读这一篇…");
    }
  });

  // 标题本身就带书名号（《开局》）时不再包一层，否则摆出「正在读《《开局》》…」这种破字。
  it("标题自带书名号就不重复包，两种写法读出来一样", () => {
    expect(editorLoadingLabel("《开局》")).toBe(editorLoadingLabel("开局"));
    expect(editorLoadingLabel("《开局》")).toBe("正在读《开局》…");
  });
});

describe("空态话术", () => {
  it("说的是「去左栏点一篇」，不是「没有内容」——后者会被读成用户写空了", () => {
    expect(EDITOR_EMPTY_HINT).toContain("左栏");
    expect(EDITOR_EMPTY_HINT).not.toMatch(/没有内容|空白|无内容/);
  });
});

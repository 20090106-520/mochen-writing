/**
 * W-08 源码接线契约：`.vue` 不进类型程序，检查区块有没有真接上、有没有偷偷读盘落盘，
 * 只能读源钉（vue-source-reader 会剥注释；只在注释里宣称「只读」不算数）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countNeedle,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const DIALOG = "components/ExportDialog.vue";
const CHECK = "utils/publish-check.ts";

describe("判定真身：只读本地事实，不内置词库", () => {
  it("判据里不碰 IPC / 网络 / 盘：零额外读盘是这一刀的前提", () => {
    const source = typeScriptSource(CHECK);
    for (const needle of ["window.mochen", "readDoc", "fetch(", "localStorage", "writeBookData"]) {
      expect(source, `判定层不该出现 ${needle}`).not.toContain(needle);
    }
    expect(source).toContain("chars: number");
    expect(source).toContain("checkedContentCount");
  });

  it("词表只从作者的输入来，词表为空就一个字都不查", () => {
    const source = typeScriptSource(CHECK);
    expect(source).toContain("export function parseBannedWords(input: string): string[]");
    expect(source).toContain("if (bannedWords.length > 0)");
    expect(source).toContain('typeof chapter.content !== "string"');
  });
});

describe("导出面板接线：结构项吃扫描结果，禁词吃已读正文", () => {
  it("检查数据从 DocRef.chars 与已加载正文拼，全仓还是只有原来那一次 readDoc", () => {
    const script = scriptSource(DIALOG);
    expect(script).toContain("chars: doc.chars ?? 0");
    expect(script).toContain(
      "new Map(docsWithContent.value.map((doc) => [doc.relPath, doc.content]))"
    );
    expect(script).toContain(
      "publishCheck(checkedChapters.value, parseBannedWords(bannedWordsInput.value))"
    );
    expect(script).toContain(
      "passingChapterPaths(checkedChapters.value, publishResult.value.issues)"
    );
    expect(countNeedle("window.mochen.readDoc(", script), "检查不许再发一轮读盘").toBe(1);
  });

  it("模板摆出覆盖度、逐条问题与「只勾检查通过的章」这个显式动作", () => {
    const template = templateSource(DIALOG);
    expect(template).toContain("发布前检查");
    expect(template).toContain("publishResult.checkedChapterCount");
    expect(template).toContain("publishResult.checkedContentCount");
    expect(template).toContain("词表不保存到书里");
    expect(template).toContain("PUBLISH_ISSUE_LABELS[issue.kind]");
    expect(template).toContain('@click="selectPassingChapters"');
    expect(template).toContain('placeholder="自定义禁词');
  });

  it("词表只活在这一次打开里：界面与脚本都不碰任何存储", () => {
    const code = scriptSource(DIALOG) + templateSource(DIALOG);
    for (const needle of ["localStorage", "writeBookData", "setChapterTarget", "sessionStorage"]) {
      expect(code, `不该出现 ${needle}`).not.toContain(needle);
    }
  });

  it("输入框有键盘焦点环，问题条复用 warning 色系", () => {
    const rootCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(rootCss).toContain('@import "./styles/publish-check.css";');
    const css = styleSource("publish-check.css");
    expect(css).toContain(".publish-check-words:focus-visible");
    expect(css).toContain("outline: 2px solid var(--accent)");
    expect(css).toContain(".publish-check-item");
    expect(css).toContain("var(--warning-soft");
    // 反向钉：这一节的样式不许留在 .vue 里（那会把面板顶过 800 行预算）。
    const dialogRaw = readFileSync(new URL("./ExportDialog.vue", import.meta.url), "utf8");
    expect(dialogRaw).not.toContain(".publish-check-summary {");
  });
});

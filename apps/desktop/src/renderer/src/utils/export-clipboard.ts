import type { ExportFormat } from "@mochen/contracts";

/**
 * 导出对话框里「复制到剪贴板」这一刀的**唯一判定**（2026-10-09 扫描总单「假控件」导出那一行）。
 *
 * 病灶：`copyToClipboard` 以前无条件 `writeText(previewResult.content)` 然后把按钮切成「已复制」。
 * 两种情况下内容本来就是空的——组装失败（`assembleError` 已上屏，内容被清成 ""），
 * 以及空选（见 `ExportDialog.vue` 里那条"空选不组装"的注释）。
 * 于是界面说「已复制」，剪贴板里是一个空串：用户贴出来才发现是空的。
 *
 * 判定住在这里而不是组件里，是因为 `.vue` 没有自动化覆盖（仓内既有分工：判定进 utils 出纯函数用例，
 * 接线进 *-wiring.test.ts 读源文件，行为进 store 用例）。
 */
export type CopyDecision =
  | { kind: "copy"; text: string }
  | { kind: "blocked"; title: string; message: string; level: "info" | "warning" };

export interface CopyInput {
  format: ExportFormat;
  /** 已经组装出来的文本内容。 */
  content: string;
  /** 组装失败时的那句中文；空串 = 没失败。 */
  assembleError: string;
}

export function decideCopy(input: CopyInput): CopyDecision {
  // 顺序有讲究：组装失败要压过 EPUB 那条说明——那时真正的原因是「没组装出来」，
  // 而不是格式不能复制。先报格式会把用户往错的方向引。
  if (input.assembleError !== "") {
    return {
      kind: "blocked",
      title: "现在复制不了",
      message:
        "导出内容没有组装成功，剪贴板里不许放一个空串让你以为复制好了。先照上面的提示重出一次。",
      level: "warning"
    };
  }
  if (input.format === "epub") {
    return {
      kind: "blocked",
      title: "不能复制",
      message: "EPUB 是打包出来的电子书文件，请点「导出」保存成 .epub。",
      level: "info"
    };
  }
  // 只有空白字符的内容同样按「没有内容」处理：复制一个空行进剪贴板，与复制空串是同一种谎。
  if (input.content.trim() === "") {
    return {
      kind: "blocked",
      title: "没有可复制的内容",
      message: "没勾选任何篇章，或勾选的那几篇是空的。勾上要导出的章节再复制。",
      level: "info"
    };
  }
  return { kind: "copy", text: input.content };
}

/**
 * 「这一次要不要真的去组装预览」的判定，同样只有一处。
 *
 * 服务层的口径是 `docRelPaths: [] = 全部章节`（`contracts/export.ts` 那行注释），
 * 而界面上的导出钮在空选时是**禁用**的——两处正好相反。旧写法把空选当"没选"传了个 `[]`，
 * 服务层就当"全部"组装，于是预览摆出全书、按钮不让点。
 * 现在空选根本不去组装（返回 false），预览区直说「没勾选任何篇章」。
 */
export function shouldAssemble(selectedCount: number): boolean {
  return selectedCount > 0;
}

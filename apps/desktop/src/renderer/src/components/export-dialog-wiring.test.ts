import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  countNeedle,
  ruleBlock,
  scopedStyleSource,
  scriptSource,
  templateSource
} from "../utils/vue-source-reader";

/**
 * EPUB 导出的**接线契约**（2026-10-05，批次 5-②）。
 *
 * zip 写入与 EPUB 装配本身在 `packages/fs-store/test/{zip,epub}.test.ts`（23 条真单测，含真解 zip），
 * 本文件只钉「接没接上」——本仓 `.vue` 不进类型程序，组件里写错一个 import 编译器不报、
 * 要到运行时才炸（批次 4-① 在 `CenterColumn.vue` 上真撞到过 `workModeOf` 未导入）。
 *
 * 钉的九件事，前两条是**白屏回归线**，它们比任何功能断言都贵：
 * ① 渲染层只许引零 Node 依赖的 `export-shared` 子路径，不许引 `export-service`（那条链经
 *    `epub.ts → zip.ts` 传递依赖 `node:zlib`，进浏览器 bundle 就是批次 3 撞过的首屏白屏）；
 * ② `export-shared.ts` 自身也必须零 `node:` 引用——它是「渲染层可引」这个结论的**唯一凭据**，
 *    它一沾 node 依赖，上面那条 import 断言照样绿而白屏照发；
 * ③ 组装走 IPC 到主进程，且主进程那侧真的注册了 handler（注册漏了 invoke 会一直挂着，
 *    表现成「点格式没反应」，不是报错）；
 * ④ `previewResult` 必须是 `ref` 而非 `computed`：组装是异步的，computed 里 await 拿不到结果；
 * ⑤ 竞态令牌在**成功与失败两条路上都要判**（数次数而不是 toContain）；
 * ⑥ 零章的 EPUB 拦住并说人话，不能给空壳文件；
 * ⑦ 二进制优先于文本：bytes 与 content 是二选一，拿 content 去写 zip 就是乱码；
 * ⑧ 复制按钮对 EPUB 要挡住（二进制包没有可复制的文本预览）；
 * ⑨ 组装失败要看得见，且那条 class 在内联样式里真的写了规则（钉死「删了模板留了 CSS」的反向）。
 */
const dialogScript = scriptSource("components/ExportDialog.vue");
const dialogTpl = templateSource("components/ExportDialog.vue");
const dialogCss = scopedStyleSource("components/ExportDialog.vue");

const sharedSrc = readFileSync(
  fileURLToPath(
    new URL("../../../../../../packages/fs-store/src/export-shared.ts", import.meta.url)
  ),
  "utf8"
);
const mainSrc = readFileSync(
  fileURLToPath(new URL("../../../main/index.ts", import.meta.url)),
  "utf8"
);
const preloadSrc = readFileSync(
  fileURLToPath(new URL("../../../preload/renderer-api.ts", import.meta.url)),
  "utf8"
);
const contractsExportSrc = readFileSync(
  fileURLToPath(new URL("../../../../../../packages/contracts/src/export.ts", import.meta.url)),
  "utf8"
);
const contractsIpcSrc = readFileSync(
  fileURLToPath(new URL("../../../../../../packages/contracts/src/ipc.ts", import.meta.url)),
  "utf8"
);
const appScript = scriptSource("App.vue");
const appTpl = templateSource("App.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const layoutSrc = readFileSync(
  fileURLToPath(new URL("../stores/layoutStore.ts", import.meta.url)),
  "utf8"
);

describe("入口够得着（2026-10-05 真机撞出来的既有缺陷）", () => {
  it("对话框的可见态只有 layoutStore 那一格，App 不再另持一份本地 ref", () => {
    // 当年的写法：App 挂一个 `exportOpen = ref(false)`，全仓没有任何一处把它置 true，
    // 而 layoutStore.panelVisibility.export + openExport() 一个写者都没有——
    // **整个导出功能（含批次 5-② 的 EPUB）从来没打开过**。
    expect(appScript).not.toMatch(/exportOpen\s*=\s*ref/);
    expect(appTpl).toContain(':visible="layout.panelVisibility.export"');
    expect(appTpl).toContain("@close=\"layout.closePanel('export')\"");
  });

  it("右栏头部有入口按钮，调的是 store 的 openExport（不是又一份本地布尔）", () => {
    expect(paneTpl).toContain('aria-label="导出作品"');
    expect(paneTpl).toContain('@click="layout.openExport()"');
    expect(layoutSrc).toContain('openPanel("export");');
  });

  it("入口图标名真实存在", () => {
    expect(paneTpl).toContain('<AppIcon name="download"');
  });

  it("App 里真的还渲染着 ExportDialog（修好接线不等于组件被删了）", () => {
    expect(appScript).toContain('import ExportDialog from "./components/ExportDialog.vue";');
    expect(appTpl).toContain("<ExportDialog");
  });
});

describe("白屏回归线：渲染层不许沾 Node 依赖", () => {
  it("组件引的是 export-shared 子路径，不是 export-service", () => {
    expect(dialogScript).toContain('from "@mochen/fs-store/export-shared"');
    expect(dialogScript).not.toContain("@mochen/fs-store/export-service");
  });

  it("组件本体不出现任何跑字节的符号（改回去拼 zip 是最容易犯的回头路）", () => {
    for (const needle of ["zlib", "buildZip", "buildEpub", "buildExportContent"]) {
      expect(dialogScript).not.toContain(needle);
    }
  });

  it("export-shared 自己零 node: 引用——「渲染层可引」这个结论就靠它", () => {
    // 连注释一起看：注释里出现 node: 不算破防，但也不能靠「只有注释里有」这种话术糊弄过去，
    // 所以这里剥掉注释之后再断言真的没有 import。
    const codeOnly = sharedSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/from\s+"node:/);
    expect(codeOnly).not.toContain("zlib");
    expect(codeOnly).not.toContain("export-service");
  });

  it("export-shared 的 package.json 子路径真的导出到那个文件", () => {
    const pkg = readFileSync(
      fileURLToPath(new URL("../../../../../../packages/fs-store/package.json", import.meta.url)),
      "utf8"
    );
    expect(pkg).toContain('"./export-shared"');
    expect(pkg).toContain("./src/export-shared.ts");
  });
});

describe("组装走 IPC 到主进程", () => {
  it("组件调的是 window.mochen.buildExport，三个实参按序出网", () => {
    expect(dialogScript).toContain("await window.mochen.buildExport(");
    expect(dialogScript).toContain("toRaw(docsWithContent.value),");
  });

  it("契约里那条通道是字面量 file:build-export（三处同名，值错了整条链断在暗处）", () => {
    expect(contractsIpcSrc).toContain('buildExport: "file:build-export"');
  });

  it("preload 转发到那条通道，主进程注册了同一个 handler", () => {
    expect(preloadSrc).toContain("invoke(IPC_CHANNELS.buildExport, docs, meta, options)");
    expect(mainSrc).toContain("ipcMain.handle(\n    IPC_CHANNELS.buildExport,");
    expect(mainSrc).toContain("buildExportContent(docs, meta, options)");
  });

  it("主进程把 Buffer 转成 Uint8Array 出桥（Buffer 直接过 contextBridge 结构化克隆会掉原型）", () => {
    expect(mainSrc).toContain("bytes: result.bytes === null ? null : new Uint8Array(result.bytes)");
  });

  it("saveFile 那条桥按类型分岔写盘：string 走 utf-8，二进制原样写", () => {
    expect(contractsIpcSrc).toContain(
      "saveFile(content: string | Uint8Array, filename: string, title?: string)"
    );
    expect(mainSrc).toContain(
      "async (_evt, content: string | Uint8Array, filename: string, title?: string)"
    );
    expect(mainSrc).toContain('await fs.writeFile(result.filePath, content, "utf-8")');
    expect(mainSrc).not.toMatch(
      /writeFile\(result\.filePath, content, "utf-8"\)\s*;?\s*\}?\s*else[\s\S]{0,80}utf-8/
    );
  });
});

describe("异步组装的两个易错点", () => {
  it("两个实参都先 toRaw（真机撞出来的：反应式代理过 IPC 直接抛「An object could not be cloned」）", () => {
    // 2026-10-05 批次 5-② 真机：`docsWithContent` 是 ref([])、`meta` 来自 storeToRefs，
    // 两者都是 Vue 反应式代理；Electron 在 IPC send 端做结构化克隆，代理当场抛。
    // 症状是「选了 EPUB 就组装不出来」，而 tsc / build / 全部单测都是绿的——
    // 没有这条钉子，下一个人会把 toRaw 删掉当无用代码。
    expect(dialogScript).toContain("toRaw(docsWithContent.value)");
    expect(dialogScript).toContain("meta.value === null ? null : toRaw(meta.value)");
    // 直接递代理的那一版（曾经真机上跑着的写法）
    expect(dialogScript).not.toContain("buildExport(docsWithContent.value, meta.value");
  });

  it("previewResult 是 ref 不是 computed：组装异步，computed 里等不出结果", () => {
    expect(dialogScript).toContain("const previewResult = ref<ExportResult>(");
    expect(dialogScript).not.toMatch(/const previewResult = computed/);
  });

  it("竞态令牌在成功与失败两条路上都判了（数次数，不是「至少有一处」）", () => {
    expect(countNeedle("if (token !== assembleToken) return;", dialogScript)).toBe(2);
  });

  it("选项一变就重拉，且首次也拉一次（immediate）", () => {
    expect(dialogScript).toContain("() => void refreshPreview()");
    expect(dialogScript).toMatch(/\{ immediate: true, deep: true \}/);
  });

  it("组装失败把提示写进 assembleError，不是静默留一份空预览", () => {
    expect(dialogScript).toContain("assembleError.value = `导出内容没组装出来：");
    expect(dialogScript).toContain(
      'previewResult.value = { ...previewResult.value, content: "", bytes: null, byteSize: 0 }'
    );
  });
});

describe("零章 / 二进制 / 复制 三处用户能撞上的岔路", () => {
  it("零章 EPUB 在保存之前就被拦住，并说了为什么", () => {
    const guard = 'if (result.bytes === null && result.format === "epub") {';
    expect(dialogScript).toContain(guard);
    // 顺序也钉：拦住的那段必须在 saveFile 之前，否则先弹了保存对话框再提示「导不出」。
    expect(dialogScript.indexOf(guard)).toBeLessThan(
      dialogScript.indexOf("await window.mochen.saveFile(")
    );
    expect(dialogScript).toContain("这本书还没有章节——EPUB 只包含章节正文。");
  });

  it("存盘与浏览器降级都让 bytes 优先于 content", () => {
    expect(dialogScript).toContain("result.bytes ?? result.content");
    // 两处：saveFile 的实参、Blob 构造的实参。少一处就是某条分支拿 utf-8 去写 zip。
    expect(countNeedle("result.bytes ?? result.content", dialogScript)).toBe(2);
  });

  it("复制对 EPUB 挡住并说清为什么", () => {
    expect(dialogScript).toContain('if (format.value === "epub") {');
    expect(dialogScript).toContain("EPUB 是打包出来的电子书文件，请点「导出」保存成 .epub。");
  });

  it("降级分支的 mime 认得 epub", () => {
    expect(dialogScript).toContain('"application/epub+zip"');
  });
});

describe("格式表与契约对齐", () => {
  it("formatOptions 的 id 双向对得上 ExportFormat：漏一个按钮、塞一个不存在的 id 都红", () => {
    const declared = /export type ExportFormat =([\s\S]*?);/.exec(contractsExportSrc)?.[1] ?? "";
    const formats = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(formats.length).toBeGreaterThan(0);

    const ids = [...dialogScript.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
    expect([...ids].sort()).toEqual([...formats].sort());
  });

  it("每个格式都有一句人话描述（不是空 desc）", () => {
    // 空白不敏感：epub 那条为了排版写成多行，`\{ id: "` 这种写法会静默漏掉它。
    const rows = [
      ...dialogScript.matchAll(/id:\s*"([a-z]+)",\s*label:\s*"([^"]*)",\s*desc:\s*"([^"]*)"/g)
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const [, id, label, desc] of rows) {
      // 捕获组在 strict 下是 string | undefined：拿 ?? "" 兜住，undefined 读出空串，
      // 下面两条照样红——不兜的话这条断言就成了空转。
      expect((label ?? "").length, `格式 ${id} 缺 label`).toBeGreaterThan(0);
      expect((desc ?? "").length, `格式 ${id} 缺 desc`).toBeGreaterThan(0);
    }
  });
});

describe("失败提示在模板与样式里都接上了", () => {
  it("模板渲染 assembleError，带上那枚 class", () => {
    expect(dialogTpl).toContain('v-if="assembleError"');
    expect(dialogTpl).toContain('class="export-assemble-error"');
  });

  it("那条 class 在内联样式里真的写了规则，且不是空壳", () => {
    const rule = ruleBlock(dialogCss, ".export-assemble-error");
    expect(rule).not.toBe("");
  });

  it("反向也钉住：class 在模板里出现了几次，样式里就得有几条规则对应（不留死 CSS）", () => {
    expect(countNeedle('class="export-assemble-error"', dialogTpl)).toBe(1);
    expect(countNeedle(".export-assemble-error", dialogCss)).toBe(1);
  });
});

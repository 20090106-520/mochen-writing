import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  countNeedle,
  ruleBlock,
  scopedStyleSource,
  scriptSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * EPUB 导出的**接线契约**（2026-10-05，批次 5-②）。
 *
 * zip 写入与 EPUB 装配本身在 `packages/fs-store/test/{zip,epub}.test.ts`（23 条真单测，含真解 zip），
 * 本文件只钉「接没接上」——本仓 `.vue` 不进类型程序，组件里写错一个 import 编译器不报、
 * 要到运行时才炸（批次 4-① 在 `CenterColumn.vue` 上真撞到过 `workModeOf` 未导入）。
 *
 * 钉的十一件事，前两条是**白屏回归线**，它们比任何功能断言都贵：
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
 * ⑧ 复制钮挡住不能复制的格式并说清为什么（2026-10-09 起判定住在 `utils/export-clipboard`，
 *    这里钉的是「组件把那道判定接上了」而不是「组件里也写了一份」）；
 * ⑨ 组装失败要看得见，且那条 class 在内联样式里真的写了规则（钉死「删了模板留了 CSS」的反向）；
 * ⑩ 空选**根本不去组装**——服务层口径是 `[] = 全部章节`，把「一枚都没勾」传成 `[]` 就是
 *    「预览摆全书、导出钮禁着」那处口径相反（扫描总单·假控件 导出行）；
 * ⑪ 复制的三道闸（组装失败 / EPUB / 空或全空白）只有一处判定真身，组件不许再自判一次——
 *    旧写法无条件 `writeText(content)` 后报「已复制」，剪贴板里其实是个空串。
 */
const dialogScript = scriptSource("components/ExportDialog.vue");
const dialogTpl = templateSource("components/ExportDialog.vue");
const dialogCss = scopedStyleSource("components/ExportDialog.vue");
/** 复制/组装两道判定的真身所在（注释已剥：只活在注释里的宣称不算做了这件事）。 */
const clipboardSrc = typeScriptSource("utils/export-clipboard.ts");

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
// 2026-10-21：通道名表从 ipc.ts 搬到 ipc-channels.ts（ipc.ts 贴到 800 行预算）。
// 下面「通道是字面量」那条读的是搬去的地方；签名类断言仍读 ipc.ts。
const contractsChannelsSrc = readFileSync(
  fileURLToPath(
    new URL("../../../../../../packages/contracts/src/ipc-channels.ts", import.meta.url)
  ),
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
    expect(contractsChannelsSrc).toContain('buildExport: "file:build-export"');
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

  it("复制对 EPUB 挡住并说清为什么（判定住在 util，组件只负责把它递过去）", () => {
    // 2026-10-09 假控件那一刀：这句文案原先写在组件里、由组件自己 `if (format === "epub")` 判，
    // 于是"组装失败/空选"这两条同样复制不了的路径全都没闸——文案搬进 util 之后，
    // 这里改钉**接线**：组件必须引 decideCopy，且 blocked 分支先于写剪贴板。
    // 【2026-10-25 · §173 再改钉一次】写入动作本身搬进了 `utils/clipboard`
    // （写剪贴板只有那一份：对话链的消息操作条也走它）。
    // ⇒ 断言的锚点从 `navigator.clipboard.writeText(` 换成 `copyText(`——
    // **次序这条没变**：blocked 分支仍然必须先于写入。变的只是写入落到哪一份实现。
    expect(dialogScript).toContain('from "../utils/export-clipboard"');
    expect(dialogScript).toContain('from "../utils/clipboard"');
    expect(dialogScript).toContain("const decision = decideCopy({");
    expect(dialogScript.indexOf('if (decision.kind === "blocked") {')).toBeLessThan(
      dialogScript.indexOf("await copyText(")
    );
    expect(clipboardSrc).toContain("EPUB 是打包出来的电子书文件，请点「导出」保存成 .epub。");
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

/**
 * 2026-10-09 扫描总单「假控件」里导出那一行：UI 说「没勾选 = 只导勾选的章节」，
 * 服务层的口径却是 `docRelPaths: [] = 全部章节`（`contracts/export.ts` 那行注释）。
 * 两处口径相反，后果是预览摆出全书、导出钮却禁着；复制钮更糟——空串也照写剪贴板、
 * 然后界面报「已复制」。这一族钉的是**接线**：判定只有 util 那一份，组件不许再自判一次。
 */
describe("空选与复制：判定只许有一处", () => {
  it("空选根本不去组装（而不是传个 [] 让服务层当「全部」组装）", () => {
    expect(dialogScript).toContain("if (!shouldAssemble(selectedChapters.value.size)) {");
    // 旧写法 `size > 0 ? [...] : []` 的那一枚 `: [];` 不许回来：它正是「空选=全部」这条假通路。
    expect(dialogScript).not.toContain(": [];");
    // 顺序也钉：早退必须排在真正组装之前，否则空选照样发一次 IPC。
    expect(dialogScript.indexOf("if (!shouldAssemble(")).toBeLessThan(
      dialogScript.indexOf("await window.mochen.buildExport(")
    );
    // 早退那条路要清空预览并抹掉失败态，不能留着上一轮的陈旧内容当本轮结果。
    const guard = dialogScript.slice(
      dialogScript.indexOf("if (!shouldAssemble("),
      dialogScript.indexOf("const docRelPaths =")
    );
    expect(guard).toContain('content: "", bytes: null, byteSize: 0');
    expect(guard).toContain('assembleError.value = "";');
  });

  it("勾选列表只在真有勾选时才递给服务层（`[...selectedChapters.value]` 那一句在早退之后）", () => {
    expect(dialogScript).toContain("const docRelPaths = [...selectedChapters.value];");
    // 不许出现第二份「组装请求」的构造点——否则空选那条路只是其中一条被堵上了。
    expect(countNeedle("await window.mochen.buildExport(", dialogScript)).toBe(1);
  });

  it("复制的三道闸（组装失败 / EPUB / 空或全空白）住在 util，且各只有一处", () => {
    expect(clipboardSrc).toContain('if (input.assembleError !== "") {');
    expect(clipboardSrc).toContain('if (input.format === "epub") {');
    expect(clipboardSrc).toContain('if (input.content.trim() === "") {');
    for (const needle of [
      'if (input.assembleError !== "") {',
      'if (input.format === "epub") {',
      'if (input.content.trim() === "") {'
    ]) {
      expect(countNeedle(needle, clipboardSrc), needle).toBe(1);
    }
    // 组件里不许再留一份自判：EPUB 那句从前就是写在组件里的。
    expect(dialogScript).not.toContain('if (format.value === "epub") {');
    expect(dialogScript).not.toContain('if (input.content.trim() === "") {');
    // 判定要的三件事实必须由组件递进去——少一件，util 那道闸就形同虚设。
    expect(dialogScript).toContain("const decision = decideCopy({");
    expect(dialogScript).toContain("content: previewResult.value.content,");
    expect(dialogScript).toContain("assembleError: assembleError.value");
  });

  it("复制钮在「没内容」与「组装失败」两档都禁用，条件就是那两件事", () => {
    expect(dialogTpl).toContain(`:disabled="previewResult.content === '' || assembleError !== ''"`);
    expect(
      countNeedle(`:disabled="previewResult.content === '' || assembleError !== ''"`, dialogTpl)
    ).toBe(1);
  });

  it("空选时预览区要有话说，且那条 class 在内联样式里真有规则", () => {
    expect(dialogTpl).toContain('v-if="selectedChapters.size === 0"');
    expect(dialogTpl).toContain("没勾选任何篇章——勾上要导出的章节才会有预览。");
    expect(ruleBlock(dialogCss, ".export-no-selection")).not.toBe("");
    expect(countNeedle('class="export-no-selection"', dialogTpl)).toBe(1);
    expect(countNeedle(".export-no-selection", dialogCss)).toBe(1);
  });
});

/**
 * 读不出来的正文本该看得见（`conventions/failures-must-be-visible.rule.md`）。
 *
 * 病灶：`loadDocsForExport` 以前只做「留 fulfilled、丢 rejected」这一步，
 * 于是一篇章节的 `readDoc` 抛了，它就从组装集里**无声消失**——屏上既不报错、
 * 也不提「少了一篇」，用户拿到的导出文件里那篇是空的，还以为书本来就这样。
 * 这一族钉的是「有章节读不出来时屏上必须出现一句可见中文」。
 */
describe("读不出来的正文要看得见（失败必须可见）", () => {
  it("loadDocsForExport 数得出 rejected 的篇数，并把它写进一句中文告警", () => {
    expect(dialogScript).toContain('r.status === "rejected"');
    // 把「真有 failed 才写告警」这层判定也钉住：只断言那两枚字面量的话，
    // 删掉下面那个 if 块照样绿——告警就永远不出现（也就是原来的静默 bug）。
    expect(dialogScript).toContain("failedCount > 0");
    expect(dialogScript).toContain("篇章节正文没读出来");
    expect(dialogScript).toContain("contentLoadError.value =");
  });

  it("模板渲染 contentLoadError，那条 class 在样式里真有规则（模板出现几次、样式几条）", () => {
    expect(dialogTpl).toContain('v-if="contentLoadError"');
    expect(dialogTpl).toContain('class="export-load-error"');
    expect(ruleBlock(dialogCss, ".export-load-error")).not.toBe("");
    expect(countNeedle('class="export-load-error"', dialogTpl)).toBe(1);
    expect(countNeedle(".export-load-error", dialogCss)).toBe(1);
  });

  it("全都读得出来时告警要清空（不许把上一轮的失败态留在屏上）", () => {
    // 数次数：两处赋空值——一次是「没有 rejected」的正常路，一次是早退/成功回填。
    expect(dialogScript).toContain('contentLoadError.value = ""');
  });
});

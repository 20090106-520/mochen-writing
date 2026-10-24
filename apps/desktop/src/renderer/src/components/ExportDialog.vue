<!-- 导出对话框：选择格式、选项、触发保存 -->
<script setup lang="ts">
import { computed, ref, toRaw, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import {
  estimateExportSize,
  formatByteSize,
  type ExportFormat,
  type ExportableDoc,
  type ExportResult
} from "@mochen/fs-store/export-shared";
import { useBookStore } from "../stores/useBookStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useModalFocus } from "../composables/useModalFocus";
import { decideCopy, shouldAssemble } from "../utils/export-clipboard";
import { copyText } from "../utils/clipboard";
import type { DocRef } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";

/** 有章节正文读不出来时的一句中文；空串 = 都读出来了。 */
const contentLoadError = ref("");

/**
 * 批量加载文档内容，构造 ExportableDoc 供导出使用。
 * 读不出来的那几篇**必须看得见**（`conventions/failures-must-be-visible.rule.md`）：
 * `Promise.allSettled` 只留 fulfilled 本身是对的（一篇坏了不该拖垮整次导出），
 * 但从前连「丢了几篇」都不提——用户拿到的那份文件里少了几篇、还以为书本来就这么短。
 */
async function loadDocsForExport(docs: DocRef[]): Promise<ExportableDoc[]> {
  const results = await Promise.allSettled(
    docs.map(async (doc) => {
      const loaded = await window.mochen.readDoc(doc.relPath);
      return {
        relPath: doc.relPath,
        kind: doc.kind,
        title: doc.title,
        content: loaded.content
      } satisfies ExportableDoc;
    })
  );
  // 先把上一轮的告警抹掉：本轮若没有读失败的，屏上不许还留着上一次那条。
  contentLoadError.value = "";
  const failedCount = results.filter((r) => r.status === "rejected").length;
  if (failedCount > 0) {
    contentLoadError.value = `有 ${failedCount} 篇章节正文没读出来，本次导出将不含它们。`;
  }
  return results
    .filter((r): r is PromiseFulfilledResult<ExportableDoc> => r.status === "fulfilled")
    .map((r) => r.value);
}

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊲）。
 * 这一层是整屏遮罩 + role="dialog"，功能上就是模态层；真机量测（p536g）实测六处一模一样：
 * 焦点从不在层内、Esc 一次也收不掉（连 OutlinePanel 那一处 @keydown.esc 也够不着——
 * 它挂在搜索框上，而焦点压根没进过面板）。
 * Esc 与焦点进出统一由那一处接管，本组件不再留第二份判定。
 */
const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const book = useBookStore();
const notif = useNotificationStore();
const { docs, meta } = storeToRefs(book);

const format = ref<ExportFormat>("markdown");
const includeFrontmatter = ref(false);
const separatorBetweenChapters = ref(true);
const includeMeta = ref(true);
const includePageNumbers = ref(false);
const selectedChapters = ref<Set<string>>(new Set());
const exporting = ref(false);
const copyDone = ref(false);

// 章节列表
const chapterDocs = computed(() => docs.value.filter((d) => d.kind === "chapter"));

const docsWithContent = ref<ExportableDoc[]>([]);
const loadingContent = ref(false);

/**
 * 组装结果**走 IPC 到主进程**（2026-10-05 批次 5-②）：EPUB 是 zip 包要 `node:zlib`，
 * 渲染层 import 那条链会把 Node 模块打进浏览器 bundle ⇒ 首屏白屏
 * （与 2026-10-05 批次 3 撞过的根因同类，`tools/check-package-boundary.mjs` 会报出来）。
 * 所以这里是异步的：任一选项一变就重拉一次，组件本地只留**最后一次**结果。
 */
const previewResult = ref<ExportResult>({
  content: "",
  bytes: null,
  format: "markdown",
  filename: "",
  byteSize: 0
});
/** 组装失败时的一句中文；空串 = 没失败。 */
const assembleError = ref("");

let assembleToken = 0;
async function refreshPreview(): Promise<void> {
  const token = (assembleToken += 1);
  /*
   * 空选**根本不去组装**（判定住在 `utils/export-clipboard` 的 `shouldAssemble`）。
   * 旧写法把「一枚都没勾」传成 `docRelPaths: []`，而服务层那一份口径是「[] = 全部章节」
   * （`contracts/export.ts` 里那句注释）——两处口径相反的直接后果：
   * 预览摆出全书内容，导出钮却禁着，用户看不出这两件事凭什么不一致。
   */
  if (!shouldAssemble(selectedChapters.value.size)) {
    previewResult.value = { ...previewResult.value, content: "", bytes: null, byteSize: 0 };
    assembleError.value = "";
    return;
  }
  const docRelPaths = [...selectedChapters.value];
  try {
    // **两个实参都必须先 toRaw**（2026-10-05 批次 5-② 真机撞出来的）：
    // `docsWithContent` 是 `ref([])`、`meta` 来自 storeToRefs，拿到的都是 Vue 的反应式代理；
    // Electron 在 IPC 的 send 端做结构化克隆，代理当场抛
    // 「An object could not be cloned.」⇒ 真机上选 EPUB 会直接组装失败。
    // 口径与 `useBookStore.saveMeta` 里那处一模一样，不是新发明。
    const result = await window.mochen.buildExport(
      toRaw(docsWithContent.value),
      meta.value === null ? null : toRaw(meta.value),
      {
        format: format.value,
        includeFrontmatter: includeFrontmatter.value,
        separatorBetweenChapters: separatorBetweenChapters.value,
        includeMeta: includeMeta.value,
        includePageNumbers: includePageNumbers.value,
        docRelPaths
      }
    );
    // 慢的那次不许盖掉后一次（连点选项时正是这样）
    if (token !== assembleToken) return;
    previewResult.value = result;
    assembleError.value = "";
  } catch (err) {
    if (token !== assembleToken) return;
    previewResult.value = { ...previewResult.value, content: "", bytes: null, byteSize: 0 };
    assembleError.value = `导出内容没组装出来：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
  }
}

watch(
  () => [
    docsWithContent.value,
    meta.value,
    format.value,
    includeFrontmatter.value,
    separatorBetweenChapters.value,
    includeMeta.value,
    includePageNumbers.value,
    selectedChapters.value
  ],
  () => void refreshPreview(),
  { immediate: true, deep: true }
);

const estimatedSize = computed(() =>
  docsWithContent.value.length === 0
    ? "计算中…"
    : formatByteSize(estimateExportSize(docsWithContent.value, format.value).approxBytes)
);

// 格式变化时：非 print 格式关闭页码
watch(format, (val) => {
  if (val !== "print") includePageNumbers.value = false;
});

// 打开对话框时：默认全选 + 加载内容
watch(
  () => props.visible,
  async (vis) => {
    if (!vis) return;
    // 默认全选
    if (selectedChapters.value.size === 0) {
      selectedChapters.value = new Set(chapterDocs.value.map((c) => c.relPath));
    }
    // 加载内容
    loadingContent.value = true;
    docsWithContent.value = await loadDocsForExport(
      docs.value.filter((d) => selectedChapters.value.has(d.relPath))
    );
    loadingContent.value = false;
  }
);

// 选择变更时重新加载内容
watch(
  selectedChapters,
  async (set) => {
    loadingContent.value = true;
    docsWithContent.value = await loadDocsForExport(docs.value.filter((d) => set.has(d.relPath)));
    loadingContent.value = false;
  },
  { deep: true }
);

function toggleChapter(relPath: string): void {
  const next = new Set(selectedChapters.value);
  if (next.has(relPath)) next.delete(relPath);
  else next.add(relPath);
  selectedChapters.value = next;
}

function selectAll(): void {
  selectedChapters.value = new Set(chapterDocs.value.map((c) => c.relPath));
}

function selectNone(): void {
  selectedChapters.value = new Set();
}

async function saveToFile(): Promise<void> {
  exporting.value = true;
  const result = previewResult.value;

  try {
    // 零章的书没有可导的正文（EPUB 只收章节）：先说清楚，别给一个空壳文件。
    if (result.bytes === null && result.format === "epub") {
      notif.notify({
        title: "导不出",
        message: "这本书还没有章节——EPUB 只包含章节正文。",
        level: "warning"
      });
      return;
    }
    // 走 Electron 主进程保存（通过 mochen.saveFile）；降级 Blob 下载
    if (window.mochen?.saveFile) {
      const saved = await window.mochen.saveFile(
        result.bytes ?? result.content,
        result.filename,
        "保存导出文件"
      );
      if (!saved) return; // 用户取消
    } else {
      // 浏览器降级
      const mime =
        result.format === "html" || result.format === "print"
          ? "text/html;charset=utf-8"
          : result.format === "docx"
            ? "application/msword;charset=utf-8"
            : result.format === "epub"
              ? "application/epub+zip"
              : "text/plain;charset=utf-8";
      // 二进制走 bytes，文本走 content —— 拿 content 去 new Blob 会把 zip 当 utf-8 解一遍
      const blob = new Blob([result.bytes ?? result.content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    notif.notify({
      title: "导出完成",
      message: `${result.filename}（${formatByteSize(result.byteSize)}）`,
      level: "success"
    });
    emit("close");
  } catch {
    notif.notify({
      title: "导出失败",
      message: "文件未能保存，请检查目录权限",
      level: "error"
    });
  } finally {
    exporting.value = false;
  }
}

async function copyToClipboard(): Promise<void> {
  /*
   * 判定住在 `utils/export-clipboard`（那里写着为什么）。
   * 旧写法只挡了 EPUB 一种，其余一律 `writeText(content)` 然后把按钮切成「已复制」——
   * 组装失败或空选时 `content` 本来就是空串，于是界面说「已复制」，剪贴板里什么也没有。
   */
  const decision = decideCopy({
    format: format.value,
    content: previewResult.value.content,
    assembleError: assembleError.value
  });
  if (decision.kind === "blocked") {
    notif.notify({
      title: decision.title,
      message: decision.message,
      level: decision.level
    });
    return;
  }
  // 写入走 `utils/clipboard`（§173）：**写剪贴板只有那一份**——
  // 对话链的消息操作条也用它，两边各写一遍 `navigator.clipboard.writeText`
  // 就会有两个失败处理（一个报「无法访问剪贴板」、一个什么都不说）。
  const written = await copyText(decision.text);
  if (!written) {
    notif.notify({
      title: "复制失败",
      message: "无法访问剪贴板",
      level: "warning"
    });
    return;
  }
  copyDone.value = true;
  setTimeout(() => (copyDone.value = false), 2000);
}

const formatOptions: { id: ExportFormat; label: string; desc: string }[] = [
  { id: "markdown", label: "Markdown (.md)", desc: "纯文本，保留章节标题与格式标记" },
  { id: "plaintext", label: "纯文本 (.txt)", desc: "无任何排版标记的纯文字" },
  { id: "html", label: "HTML 文档", desc: "浏览器打开，含内联样式与目录" },
  { id: "print", label: "打印友好", desc: "含 @media print 样式，支持页码" },
  { id: "docx", label: "Word (.doc)", desc: "Word 可直接打开，保留格式与目录" },
  {
    id: "epub",
    label: "电子书 (.epub)",
    desc: "导入 Kindle / iBooks / 微信读书等阅读器，自带目录"
  },
  { id: "json", label: "结构化 JSON", desc: "含元信息和各章节内容，适合备份" }
];
</script>

<template>
  <div v-if="visible" class="export-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="export-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="导出作品"
      tabindex="-1"
    >
      <header class="export-header">
        <h3>导出作品</h3>
        <button
          class="icon-btn"
          type="button"
          aria-label="关闭导出"
          title="关闭导出"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </header>

      <!-- 格式选择 -->
      <section class="export-section">
        <label class="export-section-label">导出格式</label>
        <div class="export-format-grid">
          <button
            v-for="opt in formatOptions"
            :key="opt.id"
            :class="['export-format-btn', { 'is-active': format === opt.id }]"
            type="button"
            @click="format = opt.id"
          >
            <span class="format-name">{{ opt.label }}</span>
            <span class="format-desc">{{ opt.desc }}</span>
          </button>
        </div>
      </section>

      <!-- 章节选择 -->
      <section class="export-section">
        <div class="export-section-head">
          <label class="export-section-label">导出范围</label>
          <div class="export-range-actions">
            <button class="link-btn" type="button" @click="selectAll">全选</button>
            <button class="link-btn" type="button" @click="selectNone">全不选</button>
          </div>
        </div>
        <div class="export-chapter-list">
          <label v-for="ch in chapterDocs" :key="ch.relPath" class="export-chapter-item">
            <input
              type="checkbox"
              :checked="selectedChapters.has(ch.relPath)"
              @change="toggleChapter(ch.relPath)"
            />
            <span class="export-chapter-title">{{ ch.title }}</span>
          </label>
        </div>
      </section>

      <!-- 选项 -->
      <section class="export-section">
        <label class="export-section-label">选项</label>
        <label class="export-option">
          <input v-model="includeMeta" type="checkbox" />
          <span>包含作品元信息（扉页信息）</span>
        </label>
        <label v-if="format === 'print'" class="export-option">
          <input v-model="includePageNumbers" type="checkbox" />
          <span>包含页码</span>
        </label>
        <label v-if="format !== 'json'" class="export-option">
          <input v-model="separatorBetweenChapters" type="checkbox" />
          <span>章节间加分隔符</span>
        </label>
        <label v-if="format !== 'json'" class="export-option">
          <input v-model="includeFrontmatter" type="checkbox" />
          <span>保留 frontmatter（如 title: …）</span>
        </label>
      </section>

      <!-- 预览信息 -->
      <div class="export-preview-info">
        <span>预计大小：{{ estimatedSize }}</span>
        <span>文件名：{{ previewResult.filename }}</span>
      </div>
      <!-- 组装失败要看得见：静默留一份空 preview，用户会以为「导出出来是空的」 -->
      <p v-if="assembleError" class="export-assemble-error">{{ assembleError }}</p>
      <!-- 有的章节正文没读出来也要看得见：静默丢几篇，用户会以为书本来就这么短 -->
      <p v-if="contentLoadError" class="export-load-error">{{ contentLoadError }}</p>
      <!-- 空选不摆全书预览（口径与下面那颗禁用钮一致了），所以要直说现在为什么是空的 -->
      <p v-if="selectedChapters.size === 0" class="export-no-selection">
        没勾选任何篇章——勾上要导出的章节才会有预览。
      </p>

      <!-- 操作按钮 -->
      <footer class="export-actions">
        <button
          type="button"
          :disabled="previewResult.content === '' || assembleError !== ''"
          @click="copyToClipboard"
        >
          {{ copyDone ? "已复制" : "复制到剪贴板" }}
        </button>
        <button
          class="is-primary"
          type="button"
          :disabled="exporting || selectedChapters.size === 0"
          @click="saveToFile"
        >
          <AppIcon v-if="!exporting" name="download" :size="13" />
          {{ exporting ? "导出中…" : "保存文件" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.export-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 24%, transparent);
  backdrop-filter: blur(8px) saturate(1.05);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1600;
}

.export-dialog {
  width: 560px;
  max-width: 90vw;
  max-height: 85vh;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  padding: 16px;
  overflow-y: auto;
}

.export-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.export-header h3 {
  margin: 0;
  font-size: 1.071429rem;
  color: var(--text-primary, #e8e8e8);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.icon-btn:hover {
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 6%, transparent);
}

.export-section {
  margin-bottom: 14px;
}

.export-section-label {
  display: block;
  font-size: 0.785714rem;
  color: var(--text-secondary, #999);
  margin-bottom: 6px;
  font-weight: 500;
}

.export-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.export-range-actions {
  display: flex;
  gap: 8px;
}

.link-btn {
  font-size: 0.785714rem;
  background: none;
  border: none;
  color: var(--accent, #6c9eff);
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.export-format-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.export-format-btn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 6px;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 2%, transparent);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  text-align: center;
  cursor: pointer;
}

.export-format-btn:hover {
  border-color: var(--border-hover, rgba(255, 255, 255, 0.2));
}

.export-format-btn.is-active {
  border-color: var(--accent, #6c9eff);
  background: rgba(108, 158, 255, 0.08);
}

.format-name {
  font-size: 0.857143rem;
  color: var(--text-primary, #e8e8e8);
}

.format-desc {
  font-size: 0.714286rem;
  color: var(--text-muted, #777);
}

.export-chapter-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 140px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
}

.export-chapter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 0.857143rem;
  color: var(--text-secondary, #bbb);
  cursor: pointer;
}

.export-chapter-item:hover {
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
}

.export-chapter-item input {
  accent-color: var(--accent, #6c9eff);
}

.export-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 0.857143rem;
  color: var(--text-secondary, #bbb);
  cursor: pointer;
}

.export-option input {
  accent-color: var(--accent, #6c9eff);
}

.export-assemble-error {
  margin: 0;
  padding: 6px 10px;
  font-size: 0.785714rem;
  color: var(--danger, #d64545);
  background: var(--danger-soft, rgb(214 69 69 / 12%));
  border-radius: 6px;
}

.export-load-error {
  margin: 0;
  padding: 6px 10px;
  font-size: 0.785714rem;
  color: var(--warning, #c28b35);
  background: var(--warning-soft, rgb(194 139 53 / 12%));
  border-radius: 6px;
}

.export-preview-info {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  border: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
  margin-bottom: 12px;
}

.export-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.export-actions button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  font-size: 0.857143rem;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.export-no-selection {
  margin: 0;
  padding: 6px 10px;
  /* 字号用 rem：`:root` 的 font-size 就是 --ui-font-size（styles.css:33），写 px 用户调字号界面不动。 */
  font-size: 0.785714rem;
  color: var(--text-on-state);
  background: var(--surface-hover, rgba(255, 255, 255, 0.04));
  border-radius: 6px;
}

.export-actions button:hover:not(:disabled) {
  border-color: var(--border-hover, rgba(255, 255, 255, 0.2));
}

.export-actions button.is-primary {
  background: var(--accent, #6c9eff);
  color: #fff;
  border-color: var(--accent, #6c9eff);
}

.export-actions button.is-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

<!-- 新建作品对话框：书名 + 选目录 + 建骨架。开合真身是 layout.newBookOpen（左栏与工作台降级区共用）。
     目录走 book:pick（系统选目录对话框，允许「新建文件夹」），盘上落地由主进程 createBook 兜底校验：
     目录必须为空——绝不往别人家的目录里盖文件。

     2026-11-20 新建作品智能刀，两处：
     ① 「上次的设定」：立项速记里跨书不变的那几格（题材 / 平台 / 篇幅 / 节奏 / 雷点）同一个作者十本书里九本一样，
        每本重打一遍是纯重复劳动 ⇒ 记下来，摆一行**明面上的动作**让用户点「沿用」。
        **不默认预填**：预填会把「跳过立项 ⇒ 建书请求体与旧版本逐字一致」这条保证偷换掉。
     ② 结构预览：把「建完会得到什么」摆到眼前（真目录名与用法由 utils/new-book-structure.ts 给出，
        守卫对着 fs-store 逐条核，不许漂）。 -->
<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  BOOK_PROJECT_FIELDS,
  BOOK_PROJECT_LABELS,
  normalizeBookProject,
  type BookProjectField
} from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";
import { NEW_BOOK_STRUCTURE } from "../utils/new-book-structure";
import {
  browserRememberProject,
  browserRememberedProject,
  rememberedProjectSummary
} from "../utils/new-book-memory";

const emit = defineEmits<{ close: [] }>();
const book = useBookStore();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊱）。本组件由 App.vue 的 `v-if="newBookOpen"` 挂载，
 * 所以不传 isOpen —— 挂载即开、卸载即关。
 *
 * 书名那一格的 `autofocus` 属性同一批删掉了：它是**动态插入**的元素，浏览器不保证替它接管焦点，
 * 真机实测焦点确实留在左栏那颗「+」上（p536d 量到 `.section-add`）。留着它等于留一个不生效的机制，
 * 而真身是 composable 里那一处显式 focus。
 */
const dialogRoot = ref<HTMLElement>();
useModalFocus({ root: dialogRoot, close: () => emit("close") });
// 入场动效：面板 + 背板同一条弹簧时间轴。由 App.vue 的 `v-if="newBookOpen"` 挂载，不传 isOpen。
useDialogMotion({ root: dialogRoot });

const title = ref("");
const directory = ref("");
const creating = ref(false);
/**
 * 开书立项（W-07）：六格全部可选，默认折叠。跳过时不传 `project`，
 * 建书请求体与旧版本逐字一致（主进程也不会写这一格、不会生成「创作约定」）。
 */
const projectDraft = reactive<Record<BookProjectField, string>>({
  genre: "",
  platform: "",
  length: "",
  cadence: "",
  taboos: "",
  pitch: ""
});
/** 两列排的前四格；雷点与卖点各占一行（可能是两句以上）。 */
const PROJECT_QUICK_FIELDS: readonly BookProjectField[] = [
  "genre",
  "platform",
  "length",
  "cadence"
];
const PROJECT_PLACEHOLDERS: Record<BookProjectField, string> = {
  genre: "例：都市异能 · 男频",
  platform: "例：起点 / 番茄",
  length: "例：80–120 万字",
  cadence: "例：日更 2 章",
  taboos: "例：不写虐杀、不写未成年恋爱；主角不圣母",
  pitch: "一句话说清这本书最吸引人的地方"
};

/**
 * 上次记下的立项（2026-11-20）。
 *
 * **只当建议，不当默认**：六格仍然是空的，直到用户点「沿用」。
 * 记的是**填过的**那一本 —— 记忆只发生在「真的填了并建了书」之后，
 * 跳过的书不留下一份空记忆。
 */
const remembered = browserRememberedProject();
const rememberedSummary = rememberedProjectSummary(remembered);
/** 「沿用」那一行只在真记过时出现。 */
const canReuseRemembered = computed(() => rememberedSummary !== "");
/** 立项速记那一段的展开状态：「沿用」要把它展开，否则填了看不见。 */
const projectDetails = ref<HTMLDetailsElement>();

function reuseRemembered(): void {
  for (const field of BOOK_PROJECT_FIELDS) {
    projectDraft[field] = remembered[field];
  }
  if (projectDetails.value !== undefined) projectDetails.value.open = true;
}

/**
 * 这一次创建失败的理由（本地持有，2026-10-10 巡检）。
 *
 * 为什么不直接读 `book.notice`：那是**全局**一格——新建文档、改名、外部改动同步都会写它。
 * 挂在弹窗上就出现两种假话：① 打开弹窗时上一件事的旧理由还杵在红字里；
 * ② 创建成功后 store 写的是「已新建 chapters/…」，这句好消息也跟着染成 provider-error 的红色。
 * 现在只在「自己的 createBook 返回 false」那一刻把 store 的理由抄进来，其余时候这格是空的。
 */
const createError = ref("");
/** 选完目录之前禁用创建；书名与目录两格都实了才许点（比点了再报错少一跳）。 */
const canCreate = ref(false);

function refreshCanCreate(): void {
  canCreate.value = title.value.trim() !== "" && directory.value !== "" && !creating.value;
}

async function pick(): Promise<void> {
  const picked = await window.mochen.pickBookDirectory();
  if (picked) directory.value = picked;
  refreshCanCreate();
}

async function create(): Promise<void> {
  creating.value = true;
  createError.value = "";
  const ok = await book.createBook(
    directory.value,
    title.value.trim(),
    normalizeBookProject(projectDraft)
  );
  creating.value = false;
  if (ok) {
    // 记下这一次填过的立项，下一本可以「沿用」。全空时 util 自己不写。
    browserRememberProject(projectDraft);
    emit("close");
    return;
  }
  createError.value = book.notice;
}
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        ref="dialogRoot"
        class="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-book-title"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">建在空目录里</span>
            <h2 id="new-book-title">新建作品</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭新建作品"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div class="dialog-content">
          <label class="provider-field">
            <span>书名</span>
            <input v-model="title" type="text" placeholder="海雾手记" @input="refreshCanCreate" />
          </label>
          <div class="provider-field">
            <span>作品目录</span>
            <div class="new-book-dir-row">
              <input
                class="new-book-dir-input"
                type="text"
                readonly
                :value="directory"
                placeholder="还没选——选一个空文件夹"
                aria-label="作品目录"
              />
              <button class="dialog-secondary-button" type="button" @click="pick">
                <AppIcon name="directory" :size="14" />
                选择…
              </button>
            </div>
            <p class="new-book-hint">目录必须为空——不是空的会被拒绝，不会盖掉任何已有内容。</p>
          </div>

          <!-- 上次的设定（2026-11-20）：明面上的动作，不偷偷预填。
               「沿用」点下去才把六格填上并展开立项速记。 -->
          <div v-if="canReuseRemembered" class="new-book-remembered">
            <span class="new-book-remembered-text">
              上次的设定：<strong>{{ rememberedSummary }}</strong>
            </span>
            <button class="new-book-remembered-button" type="button" @click="reuseRemembered">
              沿用
            </button>
          </div>

          <!-- 开书立项（W-07）：默认折叠，六格全部可选。填过才生成「创作约定」，跳过与原流程一致。 -->
          <details ref="projectDetails" class="new-book-project">
            <summary>
              <span>立项速记（可跳过）</span>
              <span class="new-book-project-hint">
                填了会写进 book.json，并生成一份「大纲/创作约定.md」；以后每轮对话都会带上
              </span>
            </summary>
            <div class="new-book-project-grid">
              <label v-for="field in PROJECT_QUICK_FIELDS" :key="field" class="provider-field">
                <span>{{ BOOK_PROJECT_LABELS[field] }}</span>
                <input
                  v-model="projectDraft[field]"
                  type="text"
                  :placeholder="PROJECT_PLACEHOLDERS[field]"
                />
              </label>
            </div>
            <label class="provider-field">
              <span>{{ BOOK_PROJECT_LABELS.taboos }}</span>
              <textarea
                v-model="projectDraft.taboos"
                rows="2"
                :placeholder="PROJECT_PLACEHOLDERS.taboos"
              ></textarea>
            </label>
            <label class="provider-field">
              <span>{{ BOOK_PROJECT_LABELS.pitch }}</span>
              <textarea
                v-model="projectDraft.pitch"
                rows="2"
                :placeholder="PROJECT_PLACEHOLDERS.pitch"
              ></textarea>
            </label>
          </details>

          <!-- 建好之后目录里长什么样（2026-11-20）：原先只有一句小灰字交代「五个文件夹」，
               作者点完创建之后每个分组放什么、为什么会有它，屏上一个字都没有。 -->
          <section class="new-book-structure" aria-label="建好之后目录里是这些">
            <h3 class="new-book-structure-title">建好之后，目录里是这些</h3>
            <ul class="new-book-structure-list">
              <li
                v-for="item in NEW_BOOK_STRUCTURE"
                :key="item.path"
                class="new-book-structure-item"
                :class="{ 'is-conditional': item.conditional }"
              >
                <code class="new-book-structure-path">{{ item.path }}</code>
                <span class="new-book-structure-label">{{ item.label }}</span>
                <span class="new-book-structure-usage">{{ item.usage }}</span>
                <span v-if="item.conditional" class="new-book-structure-flag">填了立项才有</span>
              </li>
            </ul>
          </section>

          <p v-if="createError !== '' && !creating" class="provider-error">{{ createError }}</p>
        </div>

        <div class="dialog-actions">
          <button class="dialog-secondary-button" type="button" @click="emit('close')">关闭</button>
          <button
            class="dialog-primary-button"
            type="button"
            :disabled="!canCreate"
            @click="create"
          >
            {{ creating ? "正在创建…" : "创建并打开" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<!-- 新建作品对话框：书名 + 选目录 + 建骨架。开合真身是 layout.newBookOpen（左栏与工作台降级区共用）。
     目录走 book:pick（系统选目录对话框，允许「新建文件夹」），盘上落地由主进程 createBook 兜底校验：
     目录必须为空——绝不往别人家的目录里盖文件。 -->
<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";

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
  const ok = await book.createBook(directory.value, title.value.trim());
  creating.value = false;
  if (ok) {
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
          </div>
          <p class="dialog-description">
            会在所选目录里建出 book.json 和 章节 / 大纲 / 人物 / 剧情 / 素材库 五个文件夹；
            目录不是空的会被拒绝，不会盖掉任何已有内容。
          </p>
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

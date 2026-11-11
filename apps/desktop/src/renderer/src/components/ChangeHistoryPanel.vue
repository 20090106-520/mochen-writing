<!-- 改稿历史与回滚（2026-10-05）。
     `docWrite` 每次覆盖正文前都把改前内容存成 `.mochen/changes/<时间戳>/…bak`，句柄一路传回渲染层——
     但此前全仓没有任何一处读得回它。这个浮层是那条回程唯一的入口：
     **AI 动手改了稿，改坏了从这里一键回得去。**

     三件事按这个顺序走，缺一不可：
     ① 列表是主进程排好的，不在渲染层重排；
     ② **先看改前的那份**（peek），回滚与否由人定——不摆预览就直接给一颗「回滚」按钮太危险；
     ③ 回滚传的是盘上此刻的指纹，主进程那道闸靠它判断「这之后还有人改过没有」。

     2026-10-13 补上「到底改了哪几行」：逐行对比由主进程算（`changes:diff` → agent-runtime 的
     `unifiedDiff`，与提案卡同一份真身），渲染层只染颜色与数行数（同一份分类在 utils/diff-lines.ts）。
     整篇改前正文没有消失，一键展开——它是对比算不出来时唯一还能看的东西。
     「跳到那一篇」那颗走 `book.openDocTab`：回滚本来就要求先把那一篇打开（`restoreBackupToDoc` 里
     那句「先打开那一篇正文」），以前用户只能自己回左栏翻，现在点一下就到位。

     判定与文案在 utils/change-history.ts，样式在 styles/change-history.css。 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { changeRetentionNote } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import DiffHighlighter from "./DiffHighlighter.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  changeCountLabel,
  changeDiffCaption,
  changeTimeLabel,
  changeHeadline,
  changeListView
} from "../utils/change-history";
import { useBookStore } from "../stores/useBookStore";
import { useChangeRetentionStore } from "../stores/useChangeRetentionStore";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const retention = useChangeRetentionStore();
const { retention: currentRetention } = storeToRefs(retention);
const panel = ref<HTMLElement>();

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 340 }
);

// 显示上限住在 utils/change-history.ts（铁律 6）：这里只拆开用。
// 头部的计数报 total 而不是 rows.length——截过之后报行数，数字上就在说谎。
const view = computed(() => changeListView(book.changeList));
const rows = computed(() => view.value.rows);
const total = computed(() => view.value.total);
const hiddenNotice = computed(() => view.value.notice);
const selected = computed(() => book.changeHistory);
const preview = computed(() => book.changePreview);

/** 改前整篇默认收起（逐行对比才是答案），对比算不出来时直接摊开——那时它是唯一还能看的东西。 */
const showFullText = ref(false);
// 换了另一条就回到「只看对比」：上一条展开过整篇不等于这一条也要展开。
watch(
  () => selected.value?.backupRelPath,
  () => {
    showFullText.value = false;
  }
);

/** diff 上方那句话：null（没算出来）时不摆——失败那句由 store 的 notice 说，这里再说是第二份。 */
const diffCaption = computed(() =>
  preview.value === null ? null : changeDiffCaption(preview.value.diff)
);

/**
 * 跳到那一篇：走 `book.openDocTab`，不在组件里自己摸 IPC。
 * 这颗不只是「看一眼」——回滚那条本来就要求先把那一篇打开（`restoreBackupToDoc` 开头那句
 * 「先打开那一篇正文」的拒绝），以前用户得自己回左栏翻标签，现在点一下就把标签、正文与指纹闸就位。
 */
function jumpToDoc(): void {
  const entry = selected.value;
  if (entry === null) return;
  void book.openDocTab(entry.docRelPath);
  // 跳过去之后浮层要收：它锚在右栏头部那颗按钮上，正文都换了还飘着，挡的就是用户要看的那一段。
  close();
}

function keydown(event: KeyboardEvent): void {
  const mods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  // 组合态里那一键归输入法：判据是 imeOwnsKey 这一份真身，不在下面再抄一遍裸比较。
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.preventDefault();
    close();
    return;
  }
  // Tab 在浮层里循环，不许跑到后面的正文输入框去（这层是真焦点陷阱）。
  if (event.key === "Tab") tab(event);
}

onMounted(() => {
  if (book.changeList.length === 0) void book.loadChanges();
  // 上限那句话要**当前真实生效**的那份（2026-10-06 批次 5-⑧）：它已经从写死的
  // 「50 份 / 32 MB」变成设置页可调，所以面板必须在挂载时现读一次主进程那份。
  void retention.ensureLoaded();
});
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="change-history"
      :style="style"
      tabindex="-1"
      role="dialog"
      aria-label="改稿历史"
      @keydown="keydown"
    >
      <header class="change-history-head titlebar-drag titlebar-inset-right">
        <strong>改稿历史</strong>
        <span class="change-history-count">{{ changeCountLabel(total) }}</span>
        <button class="context-picker-close" type="button" aria-label="关闭改稿历史" @click="close">
          <AppIcon name="close" :size="15" />
        </button>
      </header>

      <!-- 2026-10-06 改写：原文写「每批准一次改稿，改前的内容都会留一份」，**那是假的**。
           真机实测：在一篇 35 KB 的正文上按默认 2 秒自动保存档打 8 次字，
           `.mochen/changes/` 里就长出 8 个时间戳目录、8 份整篇备份，面板把「9 次改动」摆给用户。
           备份发生在 `writeDocFile` 的**每一次**写盘上（自动保存 / 手动保存 / 批准改稿 / 回滚都一样），
           「只有批准改稿才留」这个说法把 8 次自动保存说成了 0 次。
           这句话现在只说盘上真正发生的事：备份认的是「写盘」，不是「改稿」。
           后半句的保留上限**不再写死数字**（批次 5-⑧ 之后它是设置页可调的）：
           由 `changeRetentionNote(当前那份)` 生成，写盘那侧读的是同一个 store，
           所以用户调过之后这句话会跟着变，不会继续说一个过期的数。 -->
      <p class="change-history-note">
        每写一次盘（自动保存、手动保存、批准改稿、回滚），改前的内容都会留一份。回滚也会先留一份，所以撤销撤销还能回来。{{
          changeRetentionNote(currentRetention)
        }}
      </p>

      <p v-if="book.changesBusy && rows.length === 0" class="change-history-empty">
        正在读改稿历史…
      </p>
      <p v-else-if="rows.length === 0" class="change-history-empty">
        还没有记录。这一篇还没被覆盖保存过——改一个字并等它自动保存，这里就会出现改前的那一版。
      </p>

      <template v-else>
        <ul class="change-history-list">
          <li
            v-for="row in rows"
            :key="row.backupRelPath"
            class="change-history-item"
            :class="{ 'is-selected': selected?.backupRelPath === row.backupRelPath }"
          >
            <button
              class="change-history-row"
              type="button"
              :aria-current="selected?.backupRelPath === row.backupRelPath"
              @click="book.peekChange(row)"
            >
              <span class="change-history-doc" :title="row.docRelPath">{{ row.docRelPath }}</span>
              <span class="change-history-when">{{ changeTimeLabel(row.stamp) }}</span>
            </button>
            <!-- 一键撤销（P0-5）：不必先点开这一条，直接回到这条改前。撤销本身也会先留一份备份
                 （主进程 `changes:restore` 的规矩），所以撤销撤销还能回来；行内那颗仍是「看改前」。 -->
            <button
              class="change-history-undo"
              type="button"
              aria-label="撤销这次改动"
              title="撤销这一次改动：把这一篇写回这条改前的样子（撤销会先留一份，撤销还能撤销）"
              :disabled="book.changesBusy"
              @click="book.undoChange(row)"
            >
              撤销
            </button>
          </li>
        </ul>

        <!-- 折叠说明：只在真折叠了条数时才在（notice 为 null 时 v-if 不成立）。
             话术是「没删、在哪儿」，不是「已清理」——老备份还在，用户随时能回去找。 -->
        <p v-if="hiddenNotice" class="change-history-hidden">{{ hiddenNotice }}</p>

        <div v-if="selected" class="change-history-detail">
          <p class="change-history-headline">{{ changeHeadline(selected) }}</p>
          <p v-if="!preview" class="change-history-empty">
            {{ book.changesBusy ? "正在读改前的内容…" : "点上面那一条看改前的内容。" }}
          </p>
          <template v-else>
            <p v-if="diffCaption" class="change-history-caption">{{ diffCaption }}</p>
            <!-- 对比没算出来：为什么没算，提示那句话说的是真原因，这里不重复判一次，
                 只承认「这一条现在只能看整篇」。 -->
            <pre v-if="preview.diff === null" class="change-history-preview">{{
              preview.content
            }}</pre>
            <template v-else>
              <DiffHighlighter v-if="preview.diff" :diff="preview.diff" />
              <button
                class="change-history-toggle"
                type="button"
                :aria-expanded="showFullText"
                @click="showFullText = !showFullText"
              >
                {{ showFullText ? "收起整篇，只看逐行对比" : "展开改前的整篇" }}
              </button>
              <pre v-if="showFullText" class="change-history-preview">{{ preview.content }}</pre>
            </template>
            <button class="change-history-jump" type="button" @click="jumpToDoc">
              跳到那一篇，看它现在的样子
            </button>
          </template>
          <p class="change-history-caveat">
            回滚只换这一篇的正文；这之后谁又改过它，指纹对不上就会拒绝，不会盖掉。
          </p>
          <button
            class="change-history-restore"
            type="button"
            :disabled="book.changesBusy"
            @click="book.restoreChange(selected)"
          >
            把这一篇回滚到改前的样子
          </button>
        </div>
      </template>
    </section>
  </Teleport>
</template>

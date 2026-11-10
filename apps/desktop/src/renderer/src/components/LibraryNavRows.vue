<!-- 左栏书务入口（2026-10-10 三枚 + 2026-10-11 导入）。回收站与整书备份是「这本书的保险」：
     一个管删掉的文稿（还原回原位），一个管整本书的快照（恢复到书旁新目录）；
     书稿体检是「这本书的质检」——一次扫描出术语疑似 / 标点硬伤 / 重复句 / 角色出场；
     导入 TXT 是「这本书的进货口」——存量稿按章切好落进章节分组。
     按钮本体在这里；点击后的响应住在 LeftSidebar（导入走 ImportTxtDialog，其余走 notice 对话框）。

     【2026-10-11 整组收进「更多」】连同「数据统计」一起，被 LeftSidebar 包进一个默认收起的
     「更多」分组。分组的壳与那枚开合 ref 一并搬到这里，而不是留在 LeftSidebar：
     **这一组入口的归属地本来就是这个文件**，把壳也放进来，它就是一个自洽的组件，
     LeftSidebar 那头只剩一行调用，不必知道里面有几枚、怎么折叠。
     为什么收：左栏十几行全是同样重量的 14px 一行，「导入 TXT」与「写作」看起来一样重，
     而后者每天用、前者一年未必用一次——视觉权重不反映使用频率。 -->
<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { STATS_HINT } from "../utils/side-nav";
import { useLayoutStore } from "../stores/layoutStore";

/** `requireBook` 由 LeftSidebar 递进来：没开整本书时统一弹「未打开作品」，不另写一套。 */
defineProps<{ requireBook: (label: string) => boolean }>();
const layout = useLayoutStore();

const emit = defineEmits<{
  open: [kind: "trash" | "backup" | "terms" | "import"];
  stats: [];
}>();

/**
 * 「更多」分组的开合态：默认**收起**。默认收起而不是展开，是因为低频项对每个用户都低频，
 * 先把常用的（我的作品 / 写作 / 审核检查）露出来。
 * 判据只有这一枚 ref——箭头旋转与展开收起都由它驱动，不另立第二处。
 */
const moreOpen = ref(false);
</script>

<template>
  <section class="nav-group" :class="{ 'is-collapsed': !moreOpen }">
    <button
      class="section-toggle"
      type="button"
      :aria-expanded="moreOpen"
      @click="moreOpen = !moreOpen"
    >
      <AppIcon name="list" :size="17" />
      <span>更多</span>
      <AppIcon class="section-toggle-chevron" name="chevron" :size="13" />
    </button>

    <div v-show="moreOpen" class="nav-group-children">
      <!-- 存稿仪表（W-05）：整本书的章节状态 / 字数 / 最近改动。开合直接走既有 layout 开关；
           没开书时先过 LeftSidebar 递进来的 requireBook（与上面几枚同一道闸）。 -->
      <button
        class="nav-row"
        type="button"
        data-nav-id="inventory"
        title="按既有章节次序看每章状态、字数与最近改动"
        @click="requireBook('存稿仪表') || layout.openChapterStatus()"
      >
        <AppIcon name="ledger" :size="17" />
        <span>存稿仪表</span>
      </button>

      <!-- 数据统计（2026-10-11 随本组一起收进来）：数字全来自 book.docs 的扫描元数据，
           聚合真身在 utils/stats-rows；点它的响应仍住在 LeftSidebar 的 openStats。
           提示文案读 side-nav 的 STATS_HINT 那一份真身，不在此处另写一句。 -->
      <button
        class="nav-row"
        type="button"
        data-nav-id="stats"
        :title="STATS_HINT"
        @click="emit('stats')"
      >
        <AppIcon name="chart" :size="17" />
        <span>数据统计</span>
      </button>

      <button
        class="nav-row"
        type="button"
        data-nav-id="trash"
        title="删过的文稿在这里——还原一回，就回原位"
        @click="emit('open', 'trash')"
      >
        <AppIcon name="trash" :size="17" />
        <span>回收站</span>
      </button>

      <button
        class="nav-row"
        type="button"
        data-nav-id="backup"
        title="整本书的快照——恢复时书旁多一个目录、原书一个字不动"
        @click="emit('open', 'backup')"
      >
        <AppIcon name="save" :size="17" />
        <span>整书备份</span>
      </button>

      <button
        class="nav-row"
        type="button"
        data-nav-id="terms"
        title="一次扫描全书：术语疑似 / 标点硬伤 / 重复句 / 角色出场"
        @click="emit('open', 'terms')"
      >
        <AppIcon name="shield" :size="17" />
        <span>书稿体检</span>
      </button>

      <button
        class="nav-row"
        type="button"
        data-nav-id="import-txt"
        title="把存量的 txt 按章切好，导进这本书的章节分组"
        @click="emit('open', 'import')"
      >
        <AppIcon name="download" :size="17" />
        <span>导入 TXT</span>
      </button>
    </div>
  </section>
</template>

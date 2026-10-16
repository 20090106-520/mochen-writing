<!-- 插件与技能在中栏里的那一处（2026-10-07 批次 5-㉛ 接进来，5-㉜ 按用户指正改成占中栏）。

     【为什么在中栏而不是整页——5-㉜ 用户指正】
     5-㉛ 我把这两样做成 `currentView === "extensions"` 的整页，点进去**左栏整个消失**。
     用户指正：「不是重新创建侧边栏还是有的，然后旁边变成了那个技能库或插件」。
     缺的那层是：**左栏是恒定的导航**，任何时候都不该消失；
     技能库与插件是「左栏某两枚钮通向的那个地方」，它们换的只是**中栏那一格**。

     【为什么不再是一页两枚页签】
     用户同一句里说清了：「点开技能库就是技能库的单独页面，点开插件就是插件的单独页面」。
     既然左栏已经各有一枚钮、通向两个不同的地方，中栏再摆两枚页签就是让用户
     在一个地方选、再点一次才能到——而那正是它左栏那两枚钮已经替他做完的事。

     样式在 styles/extensions.css；搜索/筛选/去重的判定都在 stores/useExtensionBrowse.ts，
     模板只 v-for、只绑。 -->
<script setup lang="ts">
import { computed, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useSkillMarketStore } from "../stores/useSkillMarketStore";
import { useAgentStore, threadKeyFor } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { activeStageOf } from "../utils/composer-context";
import {
  INSTALLED_FILTER,
  PLUGIN_FILTERS,
  SKILL_FILTERS,
  useExtensionBrowseStore
} from "../stores/useExtensionBrowse";

const layout = useLayoutStore();
const plugins = usePluginStore();
const market = useSkillMarketStore();
const agent = useAgentStore();
const book = useBookStore();
const browse = useExtensionBrowseStore();

/** 落在哪一处只有一个真身（layout store）——左栏那两枚钮与两个斜杠命令都指着它。 */
const isSkills = computed(() => layout.centerView === "skills");
const page = computed(() => (isSkills.value ? "skills" : "plugins"));

/** 标题与筛选档都跟着那一处走：技能那页按市场分类筛，插件那页只有两档。 */
const title = computed(() => (isSkills.value ? "技能库" : "插件"));
const placeholder = computed(() => (isSkills.value ? "搜技能名或说明" : "搜插件名或它带的工具"));
const filters = computed(() => (isSkills.value ? SKILL_FILTERS : PLUGIN_FILTERS));

/** 两页各有一份条件（搜索词 + 筛选档）。绑定走它，于是来回切换不会把上一处的词/档带过来。 */
const conditions = computed(() => browse.pages[page.value]);
const hasConditions = computed(() => browse.hasConditions(page.value));

/** 挂入是按线程记的，所以「本轮已挂入」这个标记也按当前线程算：换章之后标记要跟着换。 */
const threadKey = computed(() => threadKeyFor(book.activeDocTab));

const pluginRows = computed(() => browse.pluginEntries(plugins, "plugins"));

/** 市场那一侧传 `entries` 全量：分类筛选由本 store 按 `categoryLabel` 判，不借市场那侧的 `filter`。 */
const skillRows = computed(() =>
  browse.skillEntries({
    library: agent.skills,
    pinned: agent.skillPathsOf(threadKey.value),
    market: market.entries,
    marketBusy: (dirName) => market.isBusyOn(dirName),
    page: "skills"
  })
);

/** 推荐现场（2026-10-17）：阶段名 + 当前文稿类别 + 本线程输入框里正敲的字。
    三项都现取——全在渲染层手里，不为推荐再打一次 IPC。 */
const recommendations = computed(() =>
  isSkills.value
    ? browse.skillRecommendations({
        library: agent.skills,
        pinned: agent.skillPathsOf(threadKey.value),
        stageName: activeStageOf(book.meta)?.name ?? "",
        docKind: book.docs.find((one) => one.relPath === book.activeDocTab)?.kind ?? null,
        instruction: agent.draftOf(threadKey.value)
      })
    : []
);

/** 回到对话。走 layout 真身——左栏「工作台」那枚钮、Esc 收起，都是同一条通路。 */
function backToChat(): void {
  layout.showWorkspace();
}

onMounted(() => {
  if (plugins.listed === null) void plugins.refresh();
  if (market.listed === null) void market.refresh();
  if (!agent.skillsListed) void agent.refreshSkills();
});
</script>

<template>
  <section class="extensions-page" :aria-label="title">
    <header class="extensions-head">
      <h2 class="extensions-title">{{ title }}</h2>
      <button
        class="icon-button extensions-close"
        type="button"
        aria-label="回到对话"
        title="回到对话"
        @click="backToChat"
      >
        <AppIcon name="close" :size="15" />
      </button>
    </header>

    <!-- 搜索与筛选两行。判定都在 store，模板只绑。
         搜索是「敲完按搜索」才生效的：draft 与 query 在 store 里分开，
         否则打到第三个字时结果已经变了，而用户还没按搜索。 -->
    <div class="extensions-tools">
      <form class="extensions-search" role="search" @submit.prevent="browse.submitSearch(page)">
        <AppIcon name="search" :size="15" />
        <input
          v-model="conditions.draft"
          type="search"
          class="extensions-search-input"
          :placeholder="placeholder"
          aria-label="搜索"
        />
        <button class="extensions-search-go" type="submit">搜索</button>
      </form>
      <div class="extensions-filters" role="group" aria-label="筛选">
        <button
          v-for="f in filters"
          :key="f"
          type="button"
          class="extensions-filter"
          :class="{ 'is-active': conditions.filter === f }"
          :aria-pressed="conditions.filter === f"
          @click="browse.setFilter(page, f)"
        >
          {{ f }}
        </button>
        <button
          v-if="hasConditions"
          class="extensions-filter is-clear"
          type="button"
          @click="browse.clearConditions(page)"
        >
          清空条件
        </button>
      </div>
      <p v-if="plugins.notice" class="extensions-notice" role="status">{{ plugins.notice }}</p>
      <p v-if="market.notice" class="extensions-notice" role="status">{{ market.notice }}</p>
    </div>

    <div class="extensions-body">
      <!-- 插件那一处 -->
      <template v-if="!isSkills">
        <p class="extensions-note">
          插件给对话加能力：它注册的工具会并进模型看得见的工具表。停用之后模型就调不到了，
          文件还在，随时可以再启用；卸载是删掉它——内置插件删掉后下次启动会自动装回来。
        </p>
        <p v-if="plugins.listed === null" class="extensions-empty">正在列插件…</p>
        <p v-else-if="plugins.listed === false" class="extensions-empty">
          插件清单没有列出来，原因在上面那句。插件目录在应用的全局数据里，你可以关掉它再试。
        </p>
        <p v-else-if="pluginRows.length === 0" class="extensions-empty">
          {{
            conditions.filter === INSTALLED_FILTER
              ? "现在没有在跑的插件。"
              : conditions.query === ""
                ? "还没有插件。插件是「一个目录 + 一份 client.js」，放进全局插件目录就会在下次启动时装上。"
                : `没有匹配「${conditions.query}」的插件。`
          }}
        </p>
        <ul v-else class="extensions-grid">
          <li v-for="one in pluginRows" :key="one.dirName" class="extension-card">
            <div class="extension-card-head">
              <span class="extension-icon" aria-hidden="true">
                <AppIcon name="plus" :size="16" />
              </span>
              <div class="extension-card-title">
                <strong :title="one.dirName">{{ one.title }}</strong>
                <span class="extension-card-origin">{{
                  one.builtin ? "内置随带" : "你自己装的"
                }}</span>
              </div>
              <span v-if="one.disabled" class="extension-badge is-stopped">已停用</span>
              <span v-else-if="!one.ok" class="extension-badge is-broken">装不上</span>
            </div>
            <p class="extension-card-desc">
              {{
                one.ok
                  ? `给模型加：${one.toolNames.join("、")}`
                  : one.reason || "这一轮没挂它，模型调不到它的工具。"
              }}
            </p>
            <div class="extension-card-foot">
              <span class="extension-card-tags">
                {{ one.builtin ? `内置 · 第 ${one.version} 版` : "本地目录" }}
              </span>
              <span class="extension-card-actions">
                <button
                  class="extension-btn is-toggle"
                  type="button"
                  :disabled="plugins.isBusyOn(one.dirName)"
                  @click="plugins.toggle(one.dirName, !one.disabled)"
                >
                  {{ one.disabled ? "启用" : "停用" }}
                </button>
                <button
                  class="extension-btn is-uninstall"
                  type="button"
                  :disabled="plugins.isBusyOn(one.dirName)"
                  @click="plugins.uninstall(one.dirName)"
                >
                  卸载
                </button>
                <button
                  class="extension-btn is-source"
                  type="button"
                  :disabled="plugins.readingDirName === one.dirName"
                  @click="plugins.openSource(one.dirName)"
                >
                  看源码
                </button>
              </span>
            </div>
            <pre v-if="plugins.sources[one.dirName]" class="extension-card-source">{{
              plugins.sources[one.dirName]
            }}</pre>
          </li>
        </ul>
      </template>

      <!-- 技能那一处。
           一张表 = 盘上有的 + 市场清单里的（按目录名并成一行，见 useExtensionBrowse.skillEntries）。
           每张卡两枚钮，**因为是两件事**：「装上/卸掉」写盘、全局到处能用；
           「挂入/取下」只对当前这条线程生效、重启清空。合成一枚就是把两者混成同一个「已安装」。 -->
      <template v-else>
        <p class="extensions-note">
          技能是一段提示词。装上就落在全局技能目录里、所有作品都能用；挂入只对当前这条线程生效，
          重启后清空。两者都只进这个应用，不写进书目录。
        </p>
        <!-- 推荐条：得分的判定全在 stores/useExtensionBrowse 的 skillRecommendations，
             模板只 v-for。**推荐不等于挂入**——点「挂入」才真正带进这一轮上下文（spec §11）。 -->
        <section
          v-if="recommendations.length > 0"
          class="extensions-recommend"
          aria-label="推荐技能"
        >
          <p class="extensions-recommend-head">
            这一轮也许用得上（按当前阶段、文稿与你在输入框里敲的字排出来的）：
            点「挂入」才会真正带进这一轮的上下文；不点就不带。
          </p>
          <ul class="extensions-recommend-list">
            <li v-for="rec in recommendations" :key="rec.id" class="extensions-recommend-item">
              <span class="extensions-recommend-title">
                <strong>{{ rec.displayName }}</strong>
                <span class="extensions-recommend-why">{{ rec.reasons.join("；") }}</span>
              </span>
              <button
                class="extension-btn is-pin"
                type="button"
                :title="`加入「${threadKey}」这条线程的上下文`"
                @click="agent.toggleSkillForThread(threadKey, rec.id)"
              >
                挂入
              </button>
            </li>
          </ul>
        </section>
        <p v-if="!agent.skillsListed && market.listed === null" class="extensions-empty">
          正在列技能…
        </p>
        <p v-else-if="market.listed === false" class="extensions-empty">
          市场清单没有列出来，原因在上面那句。盘上已经有的技能仍然列在下面。
        </p>
        <p v-else-if="skillRows.length === 0" class="extensions-empty">
          {{
            conditions.filter !== "全部" && conditions.filter !== INSTALLED_FILTER
              ? `「${conditions.filter}」这一类里现在没有技能。`
              : conditions.filter === INSTALLED_FILTER
                ? "现在还没有已安装的技能。"
                : conditions.query === ""
                  ? "盘上还没有技能，市场清单也是空的。技能是「一个目录 + 一份 SKILL.md」。"
                  : `没有匹配「${conditions.query}」的技能。`
          }}
        </p>
        <ul v-else class="extensions-grid">
          <li v-for="row in skillRows" :key="row.key" class="extension-card">
            <div class="extension-card-head">
              <span class="extension-icon" aria-hidden="true">
                <AppIcon name="library" :size="16" />
              </span>
              <div class="extension-card-title">
                <strong :title="row.displayName">{{ row.displayName }}</strong>
                <span class="extension-card-origin">{{ row.sourceLabel }}</span>
              </div>
              <!-- 三枚标记**穷尽**且互斥（真机撞出来才补齐的第三枚）：
                   重启之后「本轮已挂入」会清空，于是「已经安装但这一轮没带」那一种
                   一度没有任何徽标——那一行看上去和「可以装」的只差两颗钮的形状，
                   而「装没装」与「没装」是完全不同的两件事，藏起来就等于界面在少说一件事。
                   第二枚写「已安装」而不是「在盘上」：用户指正「技能库那边应该也加一个已安装」。
                   「在盘上」说的是事实，不是状态——它和这一页另一枚钮上的「装上」对不上，
                   而「已安装 / 卸掉」「可以装 / 装上」才是同一件事的两头。 -->
              <span v-if="row.pinned" class="extension-badge is-on">本轮已挂入</span>
              <span v-else-if="row.onDisk" class="extension-badge is-quiet">已安装</span>
              <span v-else class="extension-badge is-quiet">可以装</span>
            </div>
            <p v-if="row.summary" class="extension-card-desc">{{ row.summary }}</p>
            <!-- 书内同名那份会盖住全局这份（contracts 的 shadowedByBook）。
                 必须让它上屏：用户会以为市场那份生效了，而实际生效的是他自己放的那份。 -->
            <p v-if="row.shadowedByBook" class="extension-card-warn">
              这本书里已有一份同名的，合并时书内那份优先——市场这份暂时不会生效。
            </p>
            <div class="extension-card-foot">
              <span class="extension-card-tags">{{ row.categoryLabel }}</span>
              <span class="extension-card-actions">
                <!-- 挂入/取下：只在盘上才有得挂（onDisk 为假时这一枚不出现，
                     而不是出现一颗永远失败的钮）。 -->
                <button
                  v-if="row.onDisk"
                  class="extension-btn is-pin"
                  type="button"
                  :aria-pressed="row.pinned"
                  :title="
                    row.pinned
                      ? `从「${threadKey}」这条线程的上下文里取下`
                      : `加入「${threadKey}」这条线程的上下文`
                  "
                  @click="browse.togglePinned(row)"
                >
                  {{ row.pinned ? "取下" : "挂入" }}
                </button>
                <!-- 装上/卸掉：只在市场清单里才有得装。 -->
                <button
                  v-if="row.inMarket"
                  class="extension-btn is-install"
                  type="button"
                  :disabled="row.busy"
                  @click="browse.toggleInstalled(row)"
                >
                  {{ row.marketInstalled ? "卸掉" : "装上" }}
                </button>
              </span>
            </div>
            <!-- 正文预览。用原生 details/summary 而不是 ref 手动开关：开合与无障碍语义是浏览器给的，
                 少一份状态就少一份「关不掉」。摆的是**逐字原文**（含 frontmatter），
                 不另做一遍 markdown 解析——装上去的就是这一份，用户看什么他装到什么。 -->
            <details v-if="row.skillMd" class="extension-card-more">
              <summary>看看装上去的就是这份</summary>
              <pre class="extension-card-source">{{ row.skillMd }}</pre>
            </details>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

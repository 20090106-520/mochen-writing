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
import PageNote from "./PageNote.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useSkillMarketStore } from "../stores/useSkillMarketStore";
import { useAgentStore, threadKeyFor } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { activeStageOf } from "../utils/composer-context";
import { skillCategoryIcon } from "../utils/skill-category-icon";
import { decodeSkillRedeemCode, skillPolicyOf } from "@mochen/contracts";
import {
  INSTALLED_FILTER,
  PLUGIN_FILTERS,
  SKILL_FILTERS,
  useExtensionBrowseStore
} from "../stores/useExtensionBrowse";
import { useSkillRedeemStore } from "../stores/useSkillRedeemStore";
import SkillWorkshop from "./SkillWorkshop.vue";

const layout = useLayoutStore();
const plugins = usePluginStore();
const market = useSkillMarketStore();
const agent = useAgentStore();
const book = useBookStore();
const browse = useExtensionBrowseStore();
const redeem = useSkillRedeemStore();

/**
 * 兑换码的只读预览：解码用的仍是 contracts 那**同一个**纯函数，主进程落盘前也调它，
 * 所以这里显示的「将添加」与真的会装进来的那一条不会各说各话。
 * 预览只负责让人看清自己粘了什么，**成功与否一律以主进程那句中文为准**。
 */
const redeemPreview = computed(() => decodeSkillRedeemCode(redeem.code.trim()));

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

/** 书级技能策略（P0-4）：默认挂入清单 + 停用清单，都从 `book.json` 的唯一归一化入口读。 */
const skillPolicy = computed(() => skillPolicyOf(book.meta));
const skillDefaults = computed(() => skillPolicy.value.enabled);
const skillDisabled = computed(() => skillPolicy.value.disabled);
/** 本会话有没有临时改过挂入（决定界面上标「书级默认」还是「本会话临时改过」）。 */
const skillOverridden = computed(() => agent.hasSkillOverride(threadKey.value));

const pluginRows = computed(() => browse.pluginEntries(plugins, "plugins"));

/** 市场那一侧传 `entries` 全量：分类筛选由本 store 按 `categoryLabel` 判，不借市场那侧的 `filter`。 */
const skillRows = computed(() =>
  browse.skillEntries({
    library: agent.skills,
    pinned: agent.skillPathsOf(threadKey.value),
    defaults: skillDefaults.value,
    disabled: skillDisabled.value,
    overridden: skillOverridden.value,
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
        instruction: agent.draftOf(threadKey.value),
        disabled: skillDisabled.value
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
    <header class="extensions-head titlebar-drag titlebar-inset-right">
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

    <!-- 添加技能的两条真通路并排一行（2026-11-12）：
         从网上装 / 自己写、兑换 / 自制技能。
         先前是两块各占 39px 竖着摞（合计 78px），可它们是**平级的两个入口**，
         不是先后两步——竖排读起来像「先做这个再做那个」，还白占 39px 首屏。
         并成一行之后两块共用一条基线，卡片网格从 y=266 回到 227。

         两块的浮层各自锚在自己的触发钮下方（`.redeem-block` 仍是 `position: relative`），
         所以并排不动开合：左边那张 520px、右边那张 430px，都还在页宽之内。 -->
    <div v-if="isSkills" class="skill-entry-row">
      <!-- 从网上装 / 自己写（2026-11-10）。摆在左边：找技能是常态，兑一段码是偶发。
           与右边那张卡共用同一套骨架类，同族浮层只有一份圆角与标题行。 -->
      <SkillWorkshop />

      <!-- 兑换 / 自制技能（2026-11-09）。与输入卡「更多 → / 命令」同一张二级卡片骨架：
           同一条标题行、同一套圆角与实底、同一种页脚键位提示。
           两档各有真通路：兑换走 skills:redeem 真落盘；生成走 contracts 的编码器，
           兑换码自带技能全文，不发网、不需要账号。 -->
      <div class="redeem-block">
        <button
          class="redeem-trigger"
          :class="{ 'is-open': redeem.open }"
          type="button"
          :aria-expanded="redeem.open"
          aria-controls="redeem-sheet"
          @click="redeem.toggle()"
        >
          <AppIcon class="redeem-trigger-icon" name="sparkles" :size="14" />
          兑换 / 自制技能
          <AppIcon class="redeem-trigger-caret" name="chevron" :size="11" />
        </button>

        <div
          v-if="redeem.open"
          id="redeem-sheet"
          class="redeem-sheet composer-sheet"
          tabindex="-1"
          @keydown.esc.stop="redeem.toggle()"
        >
          <div class="composer-sheet-heading">
            <button
              class="composer-sheet-back"
              type="button"
              aria-label="收起"
              @click="redeem.toggle()"
            >
              <AppIcon name="close" :size="14" />
            </button>
            <span class="composer-sheet-icon"><AppIcon name="sparkles" :size="17" /></span>
            <div class="composer-sheet-heading-copy">
              <strong>{{
                redeem.mode === "redeem" ? "兑换技能" : "把 SKILL.md 打包成兑换码"
              }}</strong>
              <span>{{
                redeem.mode === "redeem"
                  ? "粘一段兑换码，技能就装进全局技能库"
                  : "自己写的技能也能编成码，发给别人兑"
              }}</span>
            </div>
            <kbd>Esc</kbd>
          </div>

          <div class="redeem-tabs" role="group" aria-label="兑换方式">
            <button
              class="redeem-tab"
              :class="{ 'is-active': redeem.mode === 'redeem' }"
              type="button"
              :aria-pressed="redeem.mode === 'redeem'"
              @click="redeem.setMode('redeem')"
            >
              兑换
            </button>
            <button
              class="redeem-tab"
              :class="{ 'is-active': redeem.mode === 'create' }"
              type="button"
              :aria-pressed="redeem.mode === 'create'"
              @click="redeem.setMode('create')"
            >
              生成兑换码
            </button>
          </div>

          <div class="redeem-body">
            <template v-if="redeem.mode === 'redeem'">
              <div class="redeem-field">
                <label class="redeem-label" for="redeem-code">兑换码</label>
                <textarea
                  id="redeem-code"
                  v-model="redeem.code"
                  class="redeem-textarea is-code"
                  placeholder="粘贴 MOCHEN-SKILL- 开头的兑换码"
                  spellcheck="false"
                ></textarea>
              </div>
              <p v-if="redeemPreview" class="redeem-preview">
                将添加：<span class="redeem-preview-name">《{{ redeemPreview.displayName }}》</span>
                ·
                {{ redeemPreview.description }}
              </p>
              <div class="redeem-actions">
                <button class="redeem-button" type="button" @click="redeem.fillExample()">
                  填入示例码
                </button>
                <button
                  class="redeem-button is-primary"
                  type="button"
                  :disabled="!redeem.code.trim() || redeem.busy"
                  @click="void redeem.redeem()"
                >
                  {{ redeem.busy ? "兑换中…" : "兑换并添加" }}
                </button>
              </div>
              <p class="redeem-hint">
                兑换码自带技能全文，离线可用；已装过的同名技能不会被覆盖。装好后在这张卡上点「挂入」才进本轮上下文。
              </p>
            </template>

            <template v-else>
              <div class="redeem-field">
                <label class="redeem-label" for="redeem-name">技能名</label>
                <input
                  id="redeem-name"
                  v-model="redeem.draft.displayName"
                  class="redeem-input"
                  placeholder="例：对话节奏把关"
                />
              </div>
              <div class="redeem-field">
                <label class="redeem-label" for="redeem-dir">目录名（选填，英文字母数字）</label>
                <input
                  id="redeem-dir"
                  v-model="redeem.draft.dirName"
                  class="redeem-input"
                  placeholder="留空会自动生成"
                />
              </div>
              <div class="redeem-field">
                <label class="redeem-label" for="redeem-desc">一句话说明（选填）</label>
                <input
                  id="redeem-desc"
                  v-model="redeem.draft.description"
                  class="redeem-input"
                  placeholder="它会在什么时候派上用场"
                />
              </div>
              <div class="redeem-field">
                <label class="redeem-label" for="redeem-md">SKILL.md 全文</label>
                <textarea
                  id="redeem-md"
                  v-model="redeem.draft.skillMd"
                  class="redeem-textarea"
                  placeholder="粘贴带 frontmatter 的 SKILL.md"
                ></textarea>
              </div>
              <div class="redeem-actions">
                <button class="redeem-button is-primary" type="button" @click="redeem.generate()">
                  生成兑换码
                </button>
                <button
                  v-if="redeem.generated"
                  class="redeem-button"
                  type="button"
                  @click="void redeem.copyGenerated()"
                >
                  {{ redeem.copied ? "已复制" : "复制兑换码" }}
                </button>
              </div>
              <textarea
                v-if="redeem.generated"
                class="redeem-code-out"
                readonly
                :value="redeem.generated"
                aria-label="生成的兑换码"
              ></textarea>
              <p class="redeem-hint">
                码里含技能全文，别贴到公开场合。生成后切回「兑换」可以自己先试一遍。
              </p>
            </template>

            <p
              v-if="redeem.notice"
              class="redeem-notice"
              :class="{ 'is-ok': redeem.ok }"
              role="status"
            >
              {{ redeem.notice }}
            </p>
          </div>

          <div class="composer-sheet-footer list-keys">
            <span class="composer-sheet-footnote">{{
              redeem.mode === "redeem"
                ? "装好 ≠ 这一轮生效，记得点「挂入」"
                : "兑换码离线自包含，不需要账号或联网"
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="extensions-body">
      <!-- 插件那一处 -->
      <template v-if="!isSkills">
        <PageNote summary="停用、卸载、内置插件各自是什么意思">
          <p class="extensions-note">
            插件给对话加能力：它注册的工具会并进模型看得见的工具表。停用之后模型就调不到了，
            文件还在，随时可以再启用；卸载是删掉它——内置插件删掉后下次启动会自动装回来。
          </p>
        </PageNote>
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
              <!-- 插件那一枚不是加号：加号读作「添加」，而这一页列的全是**已经装上**的。
                   bot 说的是「给模型加能力」，正是插件干的活。 -->
              <span class="extension-icon" aria-hidden="true">
                <AppIcon name="bot" :size="16" />
              </span>
              <div class="extension-card-title">
                <strong :title="one.dirName">{{ one.title }}</strong>
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
            <!-- 插件卡不另写出处：底部那枚标签已经写着「内置 · 第 2 版」/「本地目录」，
                 再补一行「内置随带」是同一件事说两遍（2026-11-12 真机：那行孤零零挂在卡底，
                 读起来像没写完的一句）。技能卡那边不能省——它的出处是「改编自某个仓库 + 许可」。 -->
            <pre v-if="plugins.sources[one.dirName]" class="extension-card-source">{{
              plugins.sources[one.dirName]
            }}</pre>
          </li>
        </ul>
      </template>

      <!-- 技能那一处。
           一张表 = 盘上有的 + 市场清单里的（按目录名并成一行，见 useExtensionBrowse.skillEntries）。
           每张卡最多四枚钮，**因为是四件不同的事**：「装上/卸掉」写盘、全局到处能用；
           「挂入/取下」只对当前这条会话生效；「设为默认」写 book.json 的书级默认清单；
           「停用/启用」写 book.json 的停用清单（停用的不进推荐、use_skill 也读不到）。 -->
      <template v-else>
        <!-- 2026-11-12：这段四行说明收进 `<PageNote>` 折叠条。
             它与下面那条「本会话临时改过」不是一类东西——那条是**当下状态**（说了就得看见），
             这条是**规矩**（看一次就够）。收起来之后搜索结果与卡片网格才落在首屏。 -->
        <PageNote summary="挂入、设为默认、停用各管什么">
          <p class="extensions-note">
            技能是一段提示词。装上就落在全局技能目录里、所有作品都能用；挂入只对当前这条会话生效，
            新会话继承这本书的「默认挂入」，在本会话改过之后会标「本会话临时改过」（不写回书）。
            「设为默认」与「停用」会写进这本书的 book.json。开着自动技能时，它会按输入里的字、
            当前阶段与文稿，自己把该用的那几枚挂上；你亲手取下的，它不会再自作主张加回来。
          </p>
        </PageNote>
        <!-- 本会话覆盖的还原入口：覆盖键在就说明「这一条会话不再跟着书级默认」，
             这里给一颗明确的「恢复书级默认」，而不是让用户自己一次次点回原样。 -->
        <p v-if="skillOverridden" class="extensions-note">
          本会话的技能挂入临时改过了，只影响「{{ threadKey }}」这一条会话，不写回书。
          <button class="extension-btn" type="button" @click="agent.resetSkillOverride(threadKey)">
            恢复书级默认
          </button>
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
              <!-- 分类图标（2026-11-12）：先前 31 张卡左上都是同一枚书册，重复了 31 次零信息。
                   现在按 `categoryLabel` 取六枚之一（见 utils/skill-category-icon.ts），
                   扫一眼卡片左缘就知道哪几枚是「校对」、哪几枚是「结构」。 -->
              <span class="extension-icon" aria-hidden="true">
                <AppIcon :name="skillCategoryIcon(row.categoryLabel)" :size="16" />
              </span>
              <div class="extension-card-title">
                <strong :title="row.displayName">{{ row.displayName }}</strong>
              </div>
              <!-- 状态标记 + 来源标记。状态四枚**穷尽**：停用 / 本轮已挂入 / 已安装 / 可以装。
                   来源那一枚（书级默认 / 本会话临时改过）回答的是另一件事：这一轮的挂入是谁定的。
                   ——「重启之后会清空」不再是事实：书级默认活在 book.json 里，重启后新会话照样继承。 -->
              <span v-if="row.disabled" class="extension-badge is-stopped">已停用</span>
              <span v-else-if="row.pinned" class="extension-badge is-on">本轮已挂入</span>
              <span v-else-if="row.onDisk" class="extension-badge is-quiet">已安装</span>
              <span v-else class="extension-badge is-quiet">可以装</span>
              <span v-if="row.onDisk && row.overridden" class="extension-badge is-quiet">
                本会话临时改过
              </span>
              <span v-else-if="row.onDisk && row.defaultOn" class="extension-badge is-quiet">
                书级默认
              </span>
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
                <!-- 挂入/取下：只在盘上、且没被停用时才有得挂（而不是给一颗永远失败的钮）。
                     标题随「书级默认」/「本会话临时改过」改口径，别让用户以为这一下会写回书。 -->
                <button
                  v-if="row.onDisk && !row.disabled"
                  class="extension-btn is-pin"
                  type="button"
                  :aria-pressed="row.pinned"
                  :title="
                    row.pinned
                      ? `从「${threadKey}」这条会话取下${row.overridden ? '（本会话临时覆盖）' : '（继承书级默认）'}`
                      : `加入「${threadKey}」这条会话的上下文${row.overridden ? '（本会话临时覆盖）' : ''}`
                  "
                  @click="browse.togglePinned(row)"
                >
                  {{ row.pinned ? "取下" : "挂入" }}
                </button>
                <!-- 书级默认：写 book.json，新会话继承。与「挂入」是两件事，所以是两枚钮。 -->
                <button
                  v-if="row.onDisk"
                  class="extension-btn"
                  type="button"
                  :title="
                    row.defaultOn
                      ? '取消这本书的默认挂入（新会话不再自动带上它）'
                      : '设为这本书的默认挂入（新会话自动带上它）'
                  "
                  :disabled="book.metaSaving"
                  @click="book.setSkillDefault(row.skillId, !row.defaultOn)"
                >
                  {{ row.defaultOn ? "取消默认" : "设为默认" }}
                </button>
                <!-- 全局启停（P0-4）：停用的技能不进推荐，use_skill 也读不到正文。 -->
                <button
                  v-if="row.onDisk"
                  class="extension-btn"
                  type="button"
                  :title="
                    row.disabled
                      ? '启用：重新让它参与推荐与 use_skill'
                      : '停用：不进推荐，本轮模型也读不到它的正文'
                  "
                  :disabled="book.metaSaving"
                  @click="book.setSkillDisabled(row.skillId, !row.disabled)"
                >
                  {{ row.disabled ? "启用" : "停用" }}
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
            <!-- 出处与许可落在**卡片最后**（2026-11-12）。
                 先前它跟在标题下面：「改编自 … 的 …（…） · MIT」在真机上是三行小灰字，
                 于是「这枚技能是干什么的」被推到第四行之后，一卡七行灰字分不清哪句是描述、
                 哪句是版权；它那段最长的不可断词（`zenstory-ai/oh-story-claudecode`）还把标题挤窄了。
                 现在：说明 → 操作 → 出处 → 原文。出处是这张卡的注脚，不是它的开场白；
                 顺序与「应用说明 / 许可信息」在应用商店里的位置一致。出处仍**一字不截**。 -->
            <p class="extension-card-origin">{{ row.sourceLabel }}</p>
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

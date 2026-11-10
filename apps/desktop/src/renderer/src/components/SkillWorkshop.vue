<!-- 添加技能的两条真通路（2026-11-10 用户裁定：
     「可以自己创建技能……再从网上寻找开源的或者好用的……不是模板的」）。

     【为什么这一张卡与「兑换 / 自制」并列，而不是把那张卡改大】
     兑换码那张卡解决的是「别人给你一份」，这一张解决的是「你自己去找 / 自己去写」。
     两件事的心智不同，塞进同一组页签会在「我要兑一段码」时先看到两个跟码无关的档。
     版式仍走同一套骨架类（.redeem-trigger / .redeem-sheet / .redeem-field…），
     同族浮层只有一份圆角与标题行。

     【这一张卡不写死任何技能正文】
     列表来自网络（GitHub），正文在点开某一条时才取。仓里没有一条「模板技能」，
     装进来的是什么，取决于用户指的那个源——这正是上一版被否掉的那一点。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useSkillFetchStore } from "../stores/useSkillFetchStore";
import { useSkillAuthorStore } from "../stores/useSkillAuthorStore";

const fetchStore = useSkillFetchStore();
const author = useSkillAuthorStore();

/** 两档：网上装 / 自己写。档位是这一张卡内部的状态，不往上提（提到 layout store 就成了全局状态）。 */
const tab = ref<"web" | "write">("web");

/** 预览里的正文给人看前 20 行——全文太长，列表里放不下；装进去的还是全文。 */
const previewBody = computed(() => {
  const text = fetchStore.preview?.skillMd ?? "";
  const lines = text.split("\n");
  return lines.slice(0, 20).join("\n") + (lines.length > 20 ? "\n…" : "");
});

const canSave = computed(
  () => author.draft.displayName.trim() !== "" && author.draft.body.trim() !== "" && !author.busy
);
</script>

<template>
  <div class="redeem-block">
    <button
      class="redeem-trigger"
      :class="{ 'is-open': fetchStore.open }"
      type="button"
      :aria-expanded="fetchStore.open"
      aria-controls="skill-workshop"
      @click="fetchStore.toggle()"
    >
      <AppIcon class="redeem-trigger-icon" name="globe" :size="14" />
      从网上装 / 自己写
      <AppIcon class="redeem-trigger-caret" name="chevron" :size="11" />
    </button>

    <div
      v-if="fetchStore.open"
      id="skill-workshop"
      class="redeem-sheet composer-sheet is-wide"
      tabindex="-1"
      @keydown.esc.stop="fetchStore.toggle()"
    >
      <div class="composer-sheet-heading">
        <button
          class="composer-sheet-back"
          type="button"
          aria-label="收起"
          @click="fetchStore.toggle()"
        >
          <AppIcon name="close" :size="14" />
        </button>
        <span class="composer-sheet-icon"><AppIcon name="globe" :size="17" /></span>
        <div class="composer-sheet-heading-copy">
          <strong>{{ tab === "web" ? "从网上装技能" : "自己写一个技能" }}</strong>
          <span>{{
            tab === "web"
              ? "直接读远端的 SKILL.md，装进你的全局技能库"
              : "填完就落盘，与手放、与装进来的完全同形"
          }}</span>
        </div>
        <kbd>Esc</kbd>
      </div>

      <div class="redeem-tabs" role="group" aria-label="添加方式">
        <button
          class="redeem-tab"
          :class="{ 'is-active': tab === 'web' }"
          type="button"
          :aria-pressed="tab === 'web'"
          @click="tab = 'web'"
        >
          从网上装
        </button>
        <button
          class="redeem-tab"
          :class="{ 'is-active': tab === 'write' }"
          type="button"
          :aria-pressed="tab === 'write'"
          @click="tab = 'write'"
        >
          自己写
        </button>
      </div>

      <div class="redeem-body">
        <!-- ── 从网上装 ── -->
        <template v-if="tab === 'web'">
          <div class="skill-source-row" role="group" aria-label="技能源">
            <button
              v-for="preset in fetchStore.presets"
              :key="preset.id"
              class="skill-source-chip"
              :class="{ 'is-active': fetchStore.sourceId === preset.id }"
              type="button"
              :aria-pressed="fetchStore.sourceId === preset.id"
              :title="`${preset.summary}（许可：${preset.license}）`"
              @click="void fetchStore.usePreset(preset.id)"
            >
              {{ preset.title }}
            </button>
          </div>
          <p class="redeem-hint">
            {{
              fetchStore.presets.find((one) => one.id === fetchStore.sourceId)?.fit ??
              "自己粘一个地址：任意 GitHub 仓库 / 技能目录 / 一份 SKILL.md 的链接。"
            }}
          </p>

          <form class="skill-url-row" @submit.prevent="void fetchStore.loadTyped()">
            <input
              v-model="fetchStore.url"
              class="redeem-input"
              type="text"
              placeholder="https://github.com/作者/仓库/tree/分支/技能目录"
              aria-label="技能地址"
              spellcheck="false"
            />
            <button class="redeem-button" type="submit" :disabled="fetchStore.loading">
              {{ fetchStore.loading ? "列…" : "列一下" }}
            </button>
          </form>

          <p v-if="fetchStore.notice" class="redeem-notice" role="status">
            {{ fetchStore.notice }}
          </p>
          <p
            v-else-if="fetchStore.listed === true && fetchStore.entries.length === 0"
            class="redeem-notice"
          >
            这个地址下没有技能。换到有 SKILL.md 的那一层再列一次。
          </p>

          <ul v-if="fetchStore.entries.length > 0" class="skill-entry-list">
            <li v-for="entry in fetchStore.entries" :key="entry.path" class="skill-entry">
              <div class="skill-entry-head">
                <button
                  class="skill-entry-name"
                  type="button"
                  :aria-expanded="fetchStore.openPath === entry.path"
                  @click="void fetchStore.openEntry(entry)"
                >
                  <AppIcon
                    name="chevron"
                    :size="11"
                    class="skill-entry-caret"
                    :class="{ 'is-open': fetchStore.openPath === entry.path }"
                  />
                  {{ entry.label }}
                </button>
                <span v-if="entry.installed" class="skill-entry-badge">已装</span>
                <button
                  class="redeem-button is-primary skill-entry-install"
                  type="button"
                  :disabled="fetchStore.installing !== ''"
                  @click="void fetchStore.install(entry)"
                >
                  {{ fetchStore.busyOn(entry.path) ? "装…" : "装" }}
                </button>
              </div>

              <div v-if="fetchStore.openPath === entry.path" class="skill-entry-body">
                <p v-if="fetchStore.previewBusy" class="redeem-hint">正在取那一份正文…</p>
                <template v-else-if="fetchStore.preview">
                  <p v-if="fetchStore.preview.ok" class="skill-entry-desc">
                    {{ fetchStore.preview.description || "（上游没写说明）" }}
                  </p>
                  <p v-if="!fetchStore.preview.ok" class="redeem-notice">
                    {{ fetchStore.preview.notice }}
                  </p>
                  <p v-if="fetchStore.preview.ok" class="skill-entry-meta">
                    {{ Math.round(fetchStore.preview.bytes / 102.4) / 10 }} KB ·
                    <span v-if="fetchStore.preview.stages.length > 0">
                      阶段：{{ fetchStore.preview.stages.join("、") }} ·
                    </span>
                    <span v-if="fetchStore.preview.appliesTo.length > 0">
                      文稿：{{ fetchStore.preview.appliesTo.join("、") }} ·
                    </span>
                    目录名 {{ fetchStore.preview.dirName }}
                  </p>
                  <pre v-if="fetchStore.preview.ok" class="skill-entry-md">{{ previewBody }}</pre>
                  <div class="redeem-actions">
                    <button
                      class="redeem-button is-primary"
                      type="button"
                      :disabled="!fetchStore.preview.ok || fetchStore.installing !== ''"
                      @click="void fetchStore.installOpen()"
                    >
                      {{ fetchStore.busyOn(entry.path) ? "装…" : "装进来" }}
                    </button>
                    <span v-if="fetchStore.preview.synthesized" class="redeem-hint">
                      上游没有 frontmatter，已补 name / description
                    </span>
                  </div>
                </template>
              </div>
            </li>
          </ul>

          <p v-if="fetchStore.result" class="redeem-notice is-ok" role="status">
            {{ fetchStore.result }}
          </p>
          <p class="redeem-hint">
            装的是上游原文，一个字都不改；同名不覆盖。装好在这张卡下面点「挂入」才进这一轮上下文。
          </p>
        </template>

        <!-- ── 自己写 ── -->
        <template v-else>
          <div class="redeem-field">
            <label class="redeem-label" for="author-name">技能名</label>
            <input
              id="author-name"
              v-model="author.draft.displayName"
              class="redeem-input"
              placeholder="例：场景里的气味"
            />
          </div>
          <div class="redeem-field">
            <label class="redeem-label" for="author-desc">一句话说明（它会进 frontmatter）</label>
            <input
              id="author-desc"
              v-model="author.draft.description"
              class="redeem-input"
              placeholder="什么时候该用它、它治什么问题"
            />
          </div>
          <div class="skill-field-pair">
            <div class="redeem-field">
              <label class="redeem-label" for="author-stage">阶段（选填）</label>
              <input
                id="author-stage"
                v-model="author.draft.stages"
                class="redeem-input"
                placeholder="正文、构思…"
              />
            </div>
            <div class="redeem-field">
              <label class="redeem-label" for="author-apply">文稿（选填）</label>
              <input
                id="author-apply"
                v-model="author.draft.appliesTo"
                class="redeem-input"
                placeholder="chapter、outline…"
              />
            </div>
          </div>
          <div class="redeem-field">
            <label class="redeem-label" for="author-body">正文（写给模型看的做法）</label>
            <textarea
              id="author-body"
              v-model="author.draft.body"
              class="redeem-textarea is-tall"
              placeholder="写清楚：什么情况下按什么步骤做、看哪几处、不要做什么。举例比形容词有用。"
            ></textarea>
          </div>
          <div class="redeem-field">
            <label class="redeem-label" for="author-dir">
              目录名（留空按技能名生成：{{ author.effectiveDirName }}）
            </label>
            <input
              id="author-dir"
              v-model="author.draft.dirName"
              class="redeem-input"
              placeholder="英文、数字、短横线"
              spellcheck="false"
            />
          </div>
          <label class="skill-check">
            <input v-model="author.draft.overwrite" type="checkbox" />
            覆盖已有的同名技能
          </label>
          <div class="redeem-actions">
            <button
              class="redeem-button is-primary"
              type="button"
              :disabled="!canSave"
              @click="void author.save()"
            >
              {{ author.busy ? "保存中…" : "保存进技能库" }}
            </button>
            <button class="redeem-button" type="button" @click="author.resetDraft()">清空</button>
          </div>
          <p
            v-if="author.notice"
            class="redeem-notice"
            :class="{ 'is-ok': author.ok }"
            role="status"
          >
            {{ author.notice }}
          </p>

          <div v-if="author.ownedSkills.length > 0" class="skill-owned">
            <p class="redeem-label">技能库里的全局技能（{{ author.ownedSkills.length }}）</p>
            <ul class="skill-owned-list">
              <li v-for="one in author.ownedSkills" :key="one.id" class="skill-owned-row">
                <span class="skill-owned-name">{{ one.displayName || one.dirName }}</span>
                <span class="skill-owned-dir">{{ one.dirName }}</span>
                <button
                  class="redeem-button skill-owned-remove"
                  type="button"
                  :disabled="author.removing !== ''"
                  @click="void author.remove(one.dirName)"
                >
                  {{ author.removing === one.dirName ? "删…" : "删" }}
                </button>
              </li>
            </ul>
            <p class="redeem-hint">
              删的是全局技能目录里那一份，删了就没了；书内的技能不在这一列。
            </p>
          </div>
        </template>
      </div>

      <div class="composer-sheet-footer list-keys">
        <span class="composer-sheet-footnote">
          {{
            tab === "web"
              ? "正文从上游现取，仓里不存副本"
              : "写好之后，开着自动技能它会自己按需挂上"
          }}
        </span>
      </div>
    </div>
  </div>
</template>

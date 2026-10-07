<!--
  写作设置页（设置浮层的「写作」页签，2026-10-05 新增）：自动保存静默窗四档 + 编辑器行距三档
  + 正文字号三档 + 拼写检查开关；2026-10-06 追加正文宽度六档、「自动行为」一节（两枚开关），
  以及改稿历史保留上限（份数六档 / 体积六档 + 立即清理）。
  都不新造真身：排程真身是 useBookStore.scheduleAutoSave（每次键入重读这一档，0 = 不排程）；
  行距/字号/列宽由 DocumentPane 写进 --editor-leading / --editor-font-size / --editor-measure 变量
  （样式表 var 缺席即原值），拼写检查直接绑 textarea 的 :spellcheck；正文字体的十档在外观页
  （appearance:save），这里不碰；保留上限住主进程 change-retention-store，写盘那次淘汰现取它。
  前四节偏好读写住 utils/autosave-preference / editor-leading-preference / editor-text-preference /
  editor-measure-preference / auto-behavior-preference（localStorage，零新 IPC）。
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import {
  autosaveOptions,
  loadAutosaveDelay,
  autosavePreferenceStorage,
  saveAutosaveDelay,
  type AutosaveDelay
} from "../utils/autosave-preference";
import {
  editorLeadingOptions,
  loadEditorLeading,
  editorLeadingPreferenceStorage,
  saveEditorLeading,
  type EditorLeading
} from "../utils/editor-leading-preference";
import {
  editorSizeOptions,
  loadEditorSize,
  loadEditorSpellcheck,
  editorTextPreferenceStorage,
  saveEditorSize,
  saveEditorSpellcheck,
  type EditorFontSize
} from "../utils/editor-text-preference";
import {
  editorMeasureOptions,
  loadEditorMeasure,
  editorMeasurePreferenceStorage,
  saveEditorMeasure,
  type EditorMeasure
} from "../utils/editor-measure-preference";
import {
  autoBehaviorOptions,
  autoBehaviorPreferenceStorage,
  loadAutoSwitch,
  saveAutoSwitch,
  type AutoSwitchId
} from "../utils/auto-behavior-preference";
import { storeToRefs } from "pinia";
import {
  changeRetentionCountOptions,
  changeRetentionMbOptions,
  changeRetentionNote
} from "@mochen/contracts";
import { useChangeRetentionStore } from "../stores/useChangeRetentionStore";
import { useBookStore } from "../stores/useBookStore";

const options = autosaveOptions();

// 偏好住 storage 不进响应式；这一份 ref 是「面板当前指着哪一档」的视图态，choose 时同步。
const current = ref<AutosaveDelay>(loadAutosaveDelay(autosavePreferenceStorage()));

function choose(value: AutosaveDelay): void {
  const storage = autosavePreferenceStorage();
  if (storage !== null) saveAutosaveDelay(storage, value);
  current.value = value;
}

const leadingOptions = editorLeadingOptions();
const currentLeading = ref<EditorLeading>(loadEditorLeading(editorLeadingPreferenceStorage()));

function chooseLeading(value: EditorLeading): void {
  const storage = editorLeadingPreferenceStorage();
  if (storage !== null) saveEditorLeading(storage, value);
  currentLeading.value = value;
}

const sizeOptions = editorSizeOptions();
const currentSize = ref<EditorFontSize>(loadEditorSize(editorTextPreferenceStorage()));
const spellcheck = ref(loadEditorSpellcheck(editorTextPreferenceStorage()));

function chooseSize(value: EditorFontSize): void {
  const storage = editorTextPreferenceStorage();
  if (storage !== null) saveEditorSize(storage, value);
  currentSize.value = value;
}

function toggleSpellcheck(event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  const storage = editorTextPreferenceStorage();
  if (storage !== null) saveEditorSpellcheck(storage, enabled);
  spellcheck.value = enabled;
}

/** 正文列宽档（每行多少字）：与行距/字号同一个读法，档位表只有 editor-measure-preference 一份。 */
const measureOptions = editorMeasureOptions();
const currentMeasure = ref<EditorMeasure>(loadEditorMeasure(editorMeasurePreferenceStorage()));

function chooseMeasure(value: EditorMeasure): void {
  const storage = editorMeasurePreferenceStorage();
  if (storage !== null) saveEditorMeasure(storage, value);
  currentMeasure.value = value;
}

/**
 * 「自动行为」两枚开关。id / 文案 / 关掉之后的后果全在 auto-behavior-preference 那张表里，
 * 面板只渲染，不抄第二份；改一格就写回那枚 key。
 */
const autoSwitches = autoBehaviorOptions();
const autoStates = ref<Record<AutoSwitchId, boolean>>({
  clearComposerAfterSend: loadAutoSwitch(autoBehaviorPreferenceStorage(), "clearComposerAfterSend"),
  autoCommitApproved: loadAutoSwitch(autoBehaviorPreferenceStorage(), "autoCommitApproved")
});

function toggleAuto(id: AutoSwitchId, event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  const storage = autoBehaviorPreferenceStorage();
  if (storage !== null) saveAutoSwitch(storage, id, enabled);
  autoStates.value = { ...autoStates.value, [id]: enabled };
}

/**
 * 改稿历史保留上限（2026-10-06 批次 5-⑧）。**这一节与「自动保存」是因果关系**，
 * 所以紧挨着它：上面那节每停手 2 秒写一次盘、每次都留一份整篇备份，这一节决定留多少。
 *
 * 档位表与说明文案全在 contracts（`changeRetentionCountOptions` / `changeRetentionMbOptions` /
 * `changeRetentionNote`），面板只渲染。**存失败时由 store 回滚视图态**，所以这里在
 * `await` 之后再把高亮拨到 `retention` 真值上，而不是乐观地先拨过去——否则界面会
 * 高亮一个盘上并没有的档位。
 */
const retention = useChangeRetentionStore();
const book = useBookStore();
const {
  retention: retentionValue,
  persisted: retentionPersisted,
  pruning
} = storeToRefs(retention);

void retention.ensureLoaded();

const countOptions = changeRetentionCountOptions();
const mbOptions = changeRetentionMbOptions();
const retentionNote = computed(() => changeRetentionNote(retentionValue.value));

async function chooseCount(value: number): Promise<void> {
  await retention.save({ maxCount: value });
}

async function chooseMb(mb: number): Promise<void> {
  await retention.save({ maxBytes: mb * 1024 * 1024 });
}
</script>

<template>
  <section class="settings-group">
    <h2 class="settings-group-title">自动保存</h2>
    <div class="agent-mode-grid" role="group" aria-label="自动保存静默窗">
      <button
        v-for="option in options"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': current === option.value }"
        type="button"
        :aria-pressed="current === option.value"
        @click="choose(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="current === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <p class="settings-group-note">
      停手满这一档时间就自动存一次；每次键入都会重置计时。改完从下一次键入起生效，
      已在路上的那一次保存照旧。关了之后只有手动保存（保存按钮 / Ctrl S）会落盘。
    </p>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">编辑器行距</h2>
    <div class="agent-mode-grid" role="group" aria-label="编辑器行距">
      <button
        v-for="option in leadingOptions"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': currentLeading === option.value }"
        type="button"
        :aria-pressed="currentLeading === option.value"
        @click="chooseLeading(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="currentLeading === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <p class="settings-group-note">
      只影响文稿正文的行间距离，标题、对话与界面不受影响；设置中心与正文是两个视图，
      回到正文就能看到新行距。
    </p>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">正文字号</h2>
    <div class="agent-mode-grid" role="group" aria-label="正文字号">
      <button
        v-for="option in sizeOptions"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': currentSize === option.value }"
        type="button"
        :aria-pressed="currentSize === option.value"
        @click="chooseSize(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="currentSize === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <p class="settings-group-note">
      只影响文稿正文的字号，界面与对话流用外观页的「界面字号」「代码字号」。
    </p>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">正文宽度</h2>
    <div class="agent-mode-grid" role="group" aria-label="正文宽度">
      <button
        v-for="option in measureOptions"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': currentMeasure === option.value }"
        type="button"
        :aria-pressed="currentMeasure === option.value"
        @click="chooseMeasure(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="currentMeasure === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <p class="settings-group-note">
      只收窄文稿正文那一列（一行铺多少字），标题、对话与界面宽度不动；查找高亮与正文同宽，
      不会错行。分栏模式下左栏比这一档还窄时看不出变化。
    </p>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">拼写检查</h2>
    <div class="settings-card">
      <div class="settings-item">
        <span class="settings-item-text">
          <strong>给正文开拼写检查</strong>
          <small
            >开着时浏览器会给疑似拼错的词画波浪线（对英文词有效，中文不标）；
            默认关着——写作时波浪线对不少人是干扰。</small
          >
        </span>
        <label class="provider-switch" aria-label="拼写检查">
          <input type="checkbox" :checked="spellcheck" @change="toggleSpellcheck" />
          <span class="provider-switch-slider" />
        </label>
      </div>
      <div class="settings-item">
        <span class="settings-item-text">
          <small>回到正文即可生效；这一档只管文稿编辑器，搜索框与对话输入不受影响。</small>
        </span>
      </div>
    </div>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">自动行为</h2>
    <div class="settings-card">
      <div v-for="option in autoSwitches" :key="option.id" class="settings-item">
        <span class="settings-item-text">
          <strong>{{ option.label }}</strong>
          <small
            >{{ option.note }}
            <template v-if="!autoStates[option.id]"
              >现在关着：{{ option.offEffect }}</template
            ></small
          >
        </span>
        <label class="provider-switch" :aria-label="option.label">
          <input
            type="checkbox"
            :checked="autoStates[option.id]"
            @change="toggleAuto(option.id, $event)"
          />
          <span class="provider-switch-slider" />
        </label>
      </div>
      <div class="settings-item">
        <span class="settings-item-text">
          <small
            >自动保存的静默窗在上面那节，两处指的是同一份偏好；这两枚只回答「开 / 关」，
            关掉的后果都写在标题下面。</small
          >
        </span>
      </div>
    </div>
  </section>
  <section class="settings-group">
    <h2 class="settings-group-title">改稿历史保留</h2>
    <div class="agent-mode-grid" role="group" aria-label="改稿历史保留份数">
      <button
        v-for="option in countOptions"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': retentionValue.maxCount === option.value }"
        type="button"
        :aria-pressed="retentionValue.maxCount === option.value"
        @click="chooseCount(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="retentionValue.maxCount === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <div class="agent-mode-grid" role="group" aria-label="改稿历史保留体积">
      <button
        v-for="option in mbOptions"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': retentionValue.maxBytes === option.value * 1024 * 1024 }"
        type="button"
        :aria-pressed="retentionValue.maxBytes === option.value * 1024 * 1024"
        @click="chooseMb(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon
            v-if="retentionValue.maxBytes === option.value * 1024 * 1024"
            name="check"
            :size="15"
          />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <p class="settings-group-note">
      {{ retentionNote }}
      <template v-if="!retentionPersisted">当前这档是墨宸的默认档，不是你设过的。</template>
    </p>
    <div class="settings-card">
      <div class="settings-item">
        <span class="settings-item-text">
          <strong>现在就按这档清理一遍</strong>
          <small
            >只清当前打开的这本书里超出的那些，最新那份永远留着。改完上限后平时也会自动淘汰，
            这一枚是「不等下一次保存，现在就清」。</small
          >
        </span>
        <button
          class="settings-action-button"
          type="button"
          :disabled="pruning || !book.hasBook"
          @click="retention.pruneNow()"
        >
          {{ pruning ? "正在清理…" : "立即清理" }}
        </button>
      </div>
      <div v-if="!book.hasBook" class="settings-item">
        <span class="settings-item-text">
          <small>还没打开作品目录，所以这一枚先摆着：改稿历史是每本书各自一份。</small>
        </span>
      </div>
      <div v-if="retention.pruneLine" class="settings-item">
        <span class="settings-item-text">
          <small>{{ retention.pruneLine }}</small>
        </span>
      </div>
      <div v-if="retention.error" class="settings-item">
        <span class="settings-item-text">
          <small>{{ retention.error }}</small>
        </span>
      </div>
    </div>
  </section>
</template>

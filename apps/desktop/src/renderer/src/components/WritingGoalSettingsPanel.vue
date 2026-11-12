<script setup lang="ts">
import { useWritingGoalStore } from "../stores/useWritingGoalStore";

const goalStore = useWritingGoalStore();

const wordTargetPresets = [500, 1000, 2000, 3000, 5000];
const timeTargetPresets = [15, 30, 45, 60, 90];

function toggleEnabled(): void {
  goalStore.updateGoal({ enabled: !goalStore.goal.enabled });
}

function setWordTarget(value: number): void {
  goalStore.updateGoal({ dailyWordTarget: value });
}

function setTimeTarget(value: number): void {
  goalStore.updateGoal({ dailyTimeTarget: value });
}

function onCustomWordTarget(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (value >= 100 && value <= 50000) {
    goalStore.updateGoal({ dailyWordTarget: value });
  }
}
</script>

<template>
  <div class="writing-goal-settings">
    <!-- 这一栏改的是**当前这本书**的目标（P0-7）：存不进书目录时要当场说出来——
         设置页与写作目标浮层不是同时开着的，只让浮层说话等于没说。 -->
    <p v-if="goalStore.saveError" class="goal-settings-save-error" role="status" aria-live="polite">
      {{ goalStore.saveError }}
    </p>

    <!-- 开关 -->
    <section class="settings-group">
      <h2 class="settings-group-title">写作目标</h2>
      <!-- 三组都套 .settings-card（2026-11-12）：这一页原先整页裸排，
           而设置中心里模型配置 / 智能体 / 快捷键 / 关于 / 远程备份都是卡片——
           同一栏目录里两种版式，翻页像换了半个应用。
           更要紧的是开关那一行：标签在左、勾选框被 `space-between` 推到 660px 外的
           内容列右缘，中间空着，没有行框也没有分隔线，读起来不像「一行」而是
           「一句话」加「一个漂着的勾」。套进卡片之后它就是「标签 + 行尾控件」那一行，
           与关于页「更新 [检查更新]」是同一件事。 -->
      <div class="settings-card">
        <label class="goal-toggle-row">
          <span>启用每日写作目标</span>
          <input type="checkbox" :checked="goalStore.goal.enabled" @change="toggleEnabled" />
        </label>
      </div>
      <p class="settings-group-note">启用后会在顶栏显示目标环，帮助你追踪每日进度。</p>
    </section>

    <!-- 字数目标 -->
    <section class="settings-group">
      <h2 class="settings-group-title">每日字数目标</h2>
      <div class="settings-card goal-card">
        <div class="goal-preset-grid">
          <button
            v-for="opt in wordTargetPresets"
            :key="opt"
            class="goal-preset-btn"
            :class="{ 'is-active': goalStore.goal.dailyWordTarget === opt }"
            type="button"
            @click="setWordTarget(opt)"
          >
            {{ opt }} 字
          </button>
        </div>
        <label class="goal-custom-row">
          <span>自定义：</span>
          <input
            type="number"
            :value="goalStore.goal.dailyWordTarget"
            min="100"
            max="50000"
            step="100"
            @change="onCustomWordTarget"
          />
          <span>字/天</span>
        </label>
      </div>
    </section>

    <!-- 时长目标 -->
    <section class="settings-group">
      <h2 class="settings-group-title">每日时长目标</h2>
      <div class="settings-card goal-card">
        <div class="goal-preset-grid">
          <button
            v-for="opt in timeTargetPresets"
            :key="opt"
            class="goal-preset-btn"
            :class="{ 'is-active': goalStore.goal.dailyTimeTarget === opt }"
            type="button"
            @click="setTimeTarget(opt)"
          >
            {{ opt }} 分钟
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.writing-goal-settings {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.goal-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 14px 18px 与 `.settings-item` 那族同一条竖线（卡片自己只有 6px 0）。 */
  padding: 14px 18px;
  cursor: pointer;
  user-select: none;
}

/* 网格与自定义行都装在这张卡里：内边距由卡给一次，里面的两行不再各留一份。 */
.goal-card {
  padding: 14px 18px;
}

.goal-toggle-row span {
  color: var(--text-primary);
  font-size: 0.928571rem;
}

.goal-toggle-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.goal-preset-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}

.goal-preset-btn {
  padding: 8px 4px;
  /* 令牌与圆角对齐全仓（2026-11-12）：这一页原先用 --border / --bg-secondary
     与 6px 圆角，是 deepwrite 时期的一套旧口径——同一条目录里别的页早就换成
     --line-soft / --surface-raised / 8px（按钮那一档），只有这里还是方的。 */
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.928571rem;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out-soft),
    border-color var(--dur-fast) var(--ease-out-soft),
    color var(--dur-fast) var(--ease-out-soft);
}

.goal-preset-btn:hover {
  border-color: var(--accent);
}

/* 选中档的字色用 `--accent-contrast`（皮肤会给它取值），不写死 #fff：
   深色皮肤下强调色会变浅，白字在那上头读不出来。 */
.goal-preset-btn.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast, #fff);
  font-weight: 500;
}

.goal-custom-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.928571rem;
  color: var(--text-primary);
}

.goal-custom-row input[type="number"] {
  width: 90px;
  padding: 4px 8px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 0.928571rem;
  transition: border-color var(--dur-fast) var(--ease-out-soft);
}

.goal-custom-row input[type="number"]:focus {
  border-color: var(--accent);
}

/* 目标没能落进这本书的目录（P0-7）：颜色走 --danger，字号用 rem（跟着「界面字号」一起缩放）。 */
.goal-settings-save-error {
  margin: 0 0 12px;
  padding: 6px 8px;
  border: 1px solid var(--danger);
  border-radius: 6px;
  color: var(--danger);
  font-size: 0.857143rem;
}
</style>

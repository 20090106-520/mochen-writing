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
    <!-- 开关 -->
    <section class="settings-group">
      <h2 class="settings-group-title">写作目标</h2>
      <label class="goal-toggle-row">
        <span>启用每日写作目标</span>
        <input type="checkbox" :checked="goalStore.goal.enabled" @change="toggleEnabled" />
      </label>
      <p class="settings-group-note">启用后会在顶栏显示目标环，帮助你追踪每日进度。</p>
    </section>

    <!-- 字数目标 -->
    <section class="settings-group">
      <h2 class="settings-group-title">每日字数目标</h2>
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
    </section>

    <!-- 时长目标 -->
    <section class="settings-group">
      <h2 class="settings-group-title">每日时长目标</h2>
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
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}

.goal-toggle-row span {
  color: var(--text-primary);
  font-size: 13px;
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
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.goal-preset-btn:hover {
  border-color: var(--accent);
}

.goal-preset-btn.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 500;
}

.goal-custom-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  font-size: 13px;
  color: var(--text-primary);
}

.goal-custom-row input[type="number"] {
  width: 90px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}

.goal-custom-row input[type="number"]:focus {
  border-color: var(--accent);
}
</style>

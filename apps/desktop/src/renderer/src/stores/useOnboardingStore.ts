/**
 * OnboardingStore —— 首次引导流程
 *
 * 管理新用户首次使用时的引导状态：
 * - 引导步骤追踪（创建作品 → 添加章节 → 第一次对话）
 * - 引导完成后不再显示
 * - 用户可手动重新开启引导
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export type OnboardingStep =
  "welcome" | "create-book" | "add-chapter" | "first-conversation" | "complete";

interface OnboardingState {
  /** true = 已完成引导 */
  completed: boolean;
  /** 当前步骤 */
  currentStep: OnboardingStep;
  /** 是否显示引导面板 */
  showGuide: boolean;
}

const STORAGE_KEY = "mochen.onboarding.v1";

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "create-book",
  "add-chapter",
  "first-conversation",
  "complete"
];

function load(): OnboardingState {
  if (typeof localStorage === "undefined") {
    return { completed: false, currentStep: "welcome", showGuide: true };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { completed: false, currentStep: "welcome", showGuide: true };
    }
    const parsed = JSON.parse(raw) as OnboardingState;
    if (parsed.completed) {
      return { ...parsed, showGuide: false };
    }
    return parsed;
  } catch {
    return { completed: false, currentStep: "welcome", showGuide: true };
  }
}

function save(state: OnboardingState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 静默
  }
}

export const useOnboardingStore = defineStore("onboarding", () => {
  const state = ref<OnboardingState>(load());

  watch(state, (val) => save(val), { deep: true });

  const isCompleted = computed(() => state.value.completed);
  const currentStep = computed(() => state.value.currentStep);
  const showGuide = computed(() => state.value.showGuide);
  const currentStepIndex = computed(() => STEP_ORDER.indexOf(state.value.currentStep));
  const totalSteps = computed(() => STEP_ORDER.length - 1);
  const progress = computed(() =>
    Math.round((currentStepIndex.value / (STEP_ORDER.length - 1)) * 100)
  );

  /** 前进到下一步 */
  function nextStep(): void {
    const idx = STEP_ORDER.indexOf(state.value.currentStep);
    const next = STEP_ORDER[idx + 1];
    if (next !== undefined) {
      state.value.currentStep = next;
      if (next === "complete") {
        state.value.completed = true;
        state.value.showGuide = false;
      }
    }
  }

  /** 跳到某步骤 */
  function goToStep(step: OnboardingStep): void {
    state.value.currentStep = step;
    state.value.showGuide = true;
  }

  /** 关闭引导 */
  function dismiss(): void {
    state.value.showGuide = false;
  }

  /** 标记完成 */
  function complete(): void {
    state.value.completed = true;
    state.value.currentStep = "complete";
    state.value.showGuide = false;
  }

  /** 重启引导 */
  function reopen(): void {
    state.value.completed = false;
    state.value.currentStep = "welcome";
    state.value.showGuide = true;
  }

  /** 完成某一步（外部触发，如用户创建第一个章节后） */
  function checkProgress(hasBook: boolean, hasChapter: boolean, hasConversation: boolean): void {
    if (state.value.completed) return;

    if (
      !hasBook &&
      state.value.currentStep !== "welcome" &&
      state.value.currentStep !== "create-book"
    ) {
      state.value.currentStep = "create-book";
    } else if (hasBook && !hasChapter && state.value.currentStep !== "add-chapter") {
      state.value.currentStep = "add-chapter";
    } else if (hasChapter && !hasConversation && state.value.currentStep !== "first-conversation") {
      state.value.currentStep = "first-conversation";
    }

    if (hasBook && hasChapter && hasConversation) {
      complete();
    }
  }

  return {
    state,
    isCompleted,
    currentStep,
    showGuide,
    currentStepIndex,
    totalSteps,
    progress,
    nextStep,
    goToStep,
    dismiss,
    complete,
    reopen,
    checkProgress
  };
});

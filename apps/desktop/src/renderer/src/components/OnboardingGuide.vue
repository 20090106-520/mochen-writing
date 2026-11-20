<!-- 首次引导流程：模态对话框，分步引导新用户 -->
<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useOnboardingStore, type OnboardingStep } from "../stores/useOnboardingStore";
import { useLayoutStore } from "../stores/layoutStore";
import AppIcon from "./AppIcon.vue";

const onboarding = useOnboardingStore();
const layout = useLayoutStore();

const { currentStep, progress, showGuide, currentStepIndex } = storeToRefs(onboarding);

interface StepContent {
  step: OnboardingStep;
  title: string;
  description: string;
  icon: string;
  tip: string;
}

const STEPS: StepContent[] = [
  {
    step: "welcome",
    title: "欢迎使用墨宸 AI",
    description:
      "墨宸 AI 是一款 AI 辅助创作工具。你只需说人话，AI 会自己读文档、给出逐条待审的改稿提案。你不点批准，它一个字也写不进作品目录。",
    icon: "sparkles",
    tip: "准备开始你的第一本书吧 →"
  },
  {
    step: "create-book",
    title: "创建第一部作品",
    description:
      "点击「新建作品」按钮，输入作品名和目录位置。也可以打开已有目录（含章节 .md 文件的文件夹）。",
    icon: "book",
    tip: "设置完成后，作品会出现在左上角的列表中。"
  },
  {
    step: "add-chapter",
    title: "添加第一个章节",
    description:
      "在左栏「章节」分组里点「+ 新建」，输入章节标题即可创建。也可以在文件管理器里直接放 .md 文件到章节目录。",
    icon: "pen",
    tip: "章节就是正文内容，其他资料（角色、世界观等）是给 AI 参考的素材。"
  },
  {
    step: "first-conversation",
    title: "开始第一次对话",
    description:
      "在底部输入框写一句指令，比如「帮我润色这一章」或「续写下一段」。AI 的回复会出现在这里，你可以批准或拒绝每一条提案。",
    icon: "message",
    tip: "记得先点开一个章节再对话，这样 AI 才知道改哪段。"
  },
  {
    step: "complete",
    title: "准备好了！",
    description:
      "你已经掌握了核心流程。随时可以点击左栏的「?」按钮重新查看这份引导。祝你写作愉快！",
    icon: "check",
    tip: ""
  }
];

const activeContent = computed(() => STEPS.find((s) => s.step === currentStep.value) ?? STEPS[0]);

function next(): void {
  if (currentStep.value === "create-book") {
    layout.openNewBook();
  }
  onboarding.nextStep();
}

function skip(): void {
  onboarding.complete();
}

function close(): void {
  onboarding.dismiss();
}

/** 完成屏那枚「新建作品」：先收掉引导（别挡住下面的新建对话框），再开新建。 */
function startNewBook(): void {
  onboarding.complete();
  layout.openNewBook();
}
</script>

<template>
  <div v-if="showGuide && currentStep !== 'complete'" class="ob-overlay">
    <div class="ob-dialog" role="dialog" aria-label="使用引导">
      <!-- 进度条 -->
      <div class="ob-progress">
        <div class="ob-progress-bar" :style="{ width: progress + '%' }" />
      </div>

      <div class="ob-step-indicator">步骤 {{ currentStepIndex + 1 }} / {{ STEPS.length - 1 }}</div>

      <div class="ob-icon-wrap">
        <AppIcon :name="activeContent.icon" :size="28" />
      </div>

      <h3 class="ob-title">{{ activeContent.title }}</h3>
      <p class="ob-desc">{{ activeContent.description }}</p>

      <p class="ob-tip">
        <AppIcon name="sparkles" :size="12" />
        {{ activeContent.tip }}
      </p>

      <footer class="ob-actions">
        <button class="ob-skip" type="button" @click="skip">跳过引导</button>
        <div class="ob-step-dots">
          <span
            v-for="(step, i) in STEPS.filter((s) => s.step !== 'complete')"
            :key="step.step"
            :class="['ob-dot', { 'is-active': i === currentStepIndex }]"
          />
        </div>
        <button class="ob-next" type="button" @click="next">
          {{ currentStepIndex === STEPS.length - 2 ? "完成" : "下一步" }}
          <AppIcon name="chevron" :size="12" />
        </button>
      </footer>

      <button class="ob-close" type="button" aria-label="关闭引导" title="关闭引导" @click="close">
        <AppIcon name="close" :size="12" />
      </button>
    </div>
  </div>

  <!-- 完成状态 -->
  <div v-if="currentStep === 'complete' && showGuide" class="ob-overlay">
    <div class="ob-dialog ob-complete" role="dialog" aria-label="引导完成">
      <div class="ob-icon-wrap ob-icon-success">
        <AppIcon name="check" :size="32" />
      </div>
      <h3>一切就绪！</h3>
      <p class="ob-desc">引导完成。去创建你的第一部作品吧。</p>
      <div class="ob-complete-actions">
        <button class="ob-next" type="button" @click="startNewBook">新建作品</button>
        <button class="ob-skip" type="button" @click="onboarding.complete()">稍后再说</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ob-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 32%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 90：低于 .dialog-backdrop 的 100（新建作品等对话框要能盖在引导上），高于常规浮层 60。
     原来 3000 会把引导里「下一步」打开的 NewBookDialog 整个压住且拦截点击——用户点不动、也退不出。 */
  z-index: var(--z-guide);
}

.ob-dialog {
  position: relative;
  width: 440px;
  max-width: 90vw;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  /* 2026-11-20 · 批次②：面板层跟皮肤走（写死 16px 的话，换「直角」皮肤时这个框不动）。
     兜底 16px = 今天的像素，默认皮肤下一字不变。 */
  border-radius: var(--radius-panel);
  padding: 24px;
  box-shadow: var(--shadow-lg);
}

.ob-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 6%, transparent);
  /* 上沿两角要跟对话框外框同一档，否则直角皮肤下会露出两个小圆角。 */
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  overflow: hidden;
}

.ob-progress-bar {
  height: 100%;
  background: var(--accent, #6c9eff);
  transition: width 0.3s ease;
}

.ob-step-indicator {
  font-size: 0.714286rem;
  color: var(--text-muted, #777);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 16px;
}

.ob-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(108, 158, 255, 0.1);
  color: var(--accent, #6c9eff);
  margin-bottom: 16px;
}

.ob-icon-success {
  background: rgba(80, 200, 120, 0.15);
  color: #50c878;
  margin: 0 auto 16px;
}

.ob-title {
  margin: 0 0 10px;
  font-size: 1.285714rem;
  color: var(--text-primary, #e8e8e8);
  font-weight: 600;
}

.ob-desc {
  margin: 0 0 12px;
  font-size: 0.928571rem;
  color: var(--text-secondary, #bbb);
  line-height: 1.6;
}

.ob-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 20px;
  padding: 8px 10px;
  font-size: 0.785714rem;
  color: var(--accent, #6c9eff);
  background: rgba(108, 158, 255, 0.06);
  border-radius: 6px;
}

.ob-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ob-skip {
  font-size: 0.857143rem;
  background: none;
  border: none;
  color: var(--text-muted, #777);
  cursor: pointer;
  padding: 4px 8px;
}

.ob-skip:hover {
  color: var(--text-secondary, #999);
}

.ob-step-dots {
  display: flex;
  gap: 5px;
}

.ob-dot {
  width: 6px;
  height: 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 15%, transparent);
  transition: all 0.2s;
}

.ob-dot.is-active {
  width: 18px;
  background: var(--accent, #6c9eff);
}

.ob-next {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: 0.928571rem;
  background: var(--accent, #6c9eff);
  border: none;
  /* 控件层跟皮肤走（兜底 8px = 全应用按钮那一档，阶梯上的「按钮、输入框、行」）。 */
  border-radius: var(--radius-control);
  color: #fff;
  cursor: pointer;
}

.ob-next:hover {
  opacity: 0.9;
}

.ob-close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: var(--radius-control);
  color: var(--text-muted, #777);
  cursor: pointer;
}

.ob-close:hover {
  color: var(--text-secondary, #999);
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
}

.ob-complete {
  text-align: center;
}

.ob-complete-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
</style>

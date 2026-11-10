<!--
  对话链里的助手头像（2026-10-21）。
  用户原话：「https://github.com/sam70361/aora-bot.git 可以把这个做进我这个软件里面，
  就是对话的那个头像 32 种表情都要用」。
  这一格只负责「把引擎画出来」：画哪一种由 utils/emotion-signal.ts 判定，
  32 种表情的数据住 vendor/emotion-ball/emotions.js，组件里没有任何表情编号字面量。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { emotionBall, type EmotionBallInstance } from "../vendor/emotion-ball";

const props = withDefaults(
  defineProps<{
    emotion: string;
    /** false = 只渲染一张静态帧（时间线里的历史消息不参与 rAF，长对话才不烧 CPU）。 */
    animated?: boolean;
    /** 眼睛放大倍率。34px 头像（2026-11-10 起）用 2.0：1.8 是按 26px 调的，
        尺寸上来后眼睛占比偏小，球看起来又是「空的」。 */
    eyeScale?: number;
  }>(),
  { animated: true, eyeScale: 2 }
);

const host = ref<HTMLDivElement | null>(null);
let ball: EmotionBallInstance | null = null;

onMounted(() => {
  const sdk = emotionBall();
  if (sdk === null || host.value === null) return;
  ball = sdk.create(host.value, {
    emotion: props.emotion,
    autostart: props.animated,
    eyeScale: props.eyeScale,
    lite: true
  });
});

watch(
  () => props.emotion,
  (id) => {
    if (ball === null) return;
    ball.setEmotion(id);
    // 静态实例不在 rAF 上：切完表情要自己补一帧，否则屏上还是旧的那张脸。
    if (!props.animated) ball.renderStatic();
  }
);

watch(
  () => props.animated,
  (on) => {
    if (ball === null) return;
    ball.setActive(on);
    if (!on) ball.renderStatic();
  }
);

onBeforeUnmount(() => {
  ball?.destroy();
  ball = null;
});
</script>

<template>
  <!-- aria-hidden 是必须的：这枚球不承载信息（谁说的由气泡位置与栏头说明），
       它的可读名只给「打开表情图鉴」那枚按钮，不给球本身。 -->
  <div ref="host" class="emotion-avatar" aria-hidden="true" />
</template>

<!--
  源码取自 canvas-ui（github.com/DavidHDev/canvas-ui）的 ParticleObject（Vue 壳），MIT + Commons Clause。
  效果：把 GLB/glTF 模型、SVG 或图片重建为一团粒子——光标推开、打旋、回弹。引擎在 utils/canvasui/。
  为过本仓 800 行单文件预算拆分；除 import 路径外零改动。上游：canvasui.dev。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createParticleObject,
  type ParticleObjectInstance,
  type ParticleObjectOptions
} from "../../utils/canvasui/particle-object";

const props = defineProps<ParticleObjectOptions>();

const canvasEl = ref<HTMLCanvasElement | null>(null);

let instance: ParticleObjectInstance | null = null;

onMounted(() => {
  if (canvasEl.value) {
    instance = createParticleObject({ canvas: canvasEl.value }, props);
    // 上游在 WebGL 不可用时静默返回 null——画布永远空白还不触发 onError。
    // 这里补上：null 也算失败，让宿主的回退（如静态品牌图）有机会接手。
    if (instance === null) {
      props.onError?.(new Error("WebGL 初始化失败，粒子画布不可用"));
    }
  }
});

onBeforeUnmount(() => {
  instance?.destroy();
  instance = null;
});

watch(
  () => ({ ...props }),
  (next) => instance?.setOptions(next),
  { deep: true }
);
</script>

<template>
  <div style="position: relative">
    <canvas
      ref="canvasEl"
      style="
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        touch-action: none;
      "
    />
  </div>
</template>

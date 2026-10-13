import { getCurrentInstance, onUnmounted, ref, watch, type Ref } from "vue";

/**
 * 「落后一拍」的值（2026-10-10 巡检，从 usePreviewDraft 里长出来的通用形状）。
 *
 * 【要解决的病】某些 computed 的产物是**全篇级**的：markdown 预览要转整篇 HTML、
 * 查找高亮层要转整篇再整段 `v-html` 重挂。源（草稿）每敲一个字动一次，
 * 这些产物若逐字跟上，大稿上每键就是几百毫秒——实测十万字：分栏预览 437ms/键、
 * 查找开着 500ms/键。它们都是**展示层**：落后一个静默窗再跟上，肉眼无感；
 * 逐字跟上却把打字拖死。
 *
 * 【为什么不各自手写 setTimeout】排程、追平、清定时器是三处必错的接线；
 * 「静默窗开着才等、其余立即追平」这个判定本身就有真伪两面。收在这里，
 * 用例拿真 reactivity 逐条跑（见 useTrailingValue.test）。
 *
 * **追平是红线，而且两路都要通**：
 * ① `delayMs()` 返回 0 的那一拍（预览切到纯预览、查找面板关了）——挂起的旧拍立即上屏；
 * ② delay 本身是响应式的：`delayMs()` 里读到的依赖**一起进 watch 源**（实现上把
 *   `source()` 与 `delayMs()` 放进同一个 getter）——「静默窗没走完就切走」这类
 *   只动档位不动值的时刻才追得到。只 watch 值的话，这一时刻永远漏掉。
 *
 * @param source  响应式源（getter）
 * @param delayMs 这一拍等多久，返回 0 表示立即追平；里面读响应式依赖有效
 */
export function useTrailingValue<T>(source: () => T, delayMs: () => number): Ref<T> {
  const lagged = ref(source()) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 值与档位放进同一个 getter：档位的依赖（viewMode / findVisible…）由此进 watch 源，
  // 「没等完就切档」的时刻才追得到（红线②）。
  watch(
    () => [source(), delayMs()] as const,
    ([value, delay]) => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (delay === 0) {
        lagged.value = value;
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        lagged.value = value;
      }, delay);
    }
  );

  // 挂清定时器只在真组件里登记：组件外（单测拿真 reactivity 直调）没有实例可挂，
  // Vue 只会告警——守一道，测试输出里就不许再有这条噪音。
  if (getCurrentInstance() !== null) {
    onUnmounted(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }

  return lagged;
}

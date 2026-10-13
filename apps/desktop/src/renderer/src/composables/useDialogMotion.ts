import { gsap } from "gsap";
import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from "vue";
import { currentReducedMotionHost, reducedMotionActive } from "../utils/motion-preference";
import { springEase } from "../utils/motion-spring";

/**
 * 对话框出场（2026-10-11 批次 6-①）——弹簧曲线从 CSS 搬进 GSAP 之后，这一层是它的真身。
 *
 * ## 为什么单独一个 composable，而不并进 useModalFocus
 * `useModalFocus` 有十三个消费者，四个对话框之外还有九个面板/浮层（它们各自是「浮层」不是「模态」）。
 * 把动效塞进去就等于**顺手把那九个也一起弹一遍**——而 2026-10-10 那次拆分就是为了不这么干
 * （motion.css 里对话框被特意从共用那张出场表里摘了出来）。所以这里独立一份、由四个对话框各自调用。
 *
 * ## 关键取舍：**CSS 里什么都不留，靠 GSAP 的自然态兜底**
 * 原来 `.workspace-dialog` / `.dialog-backdrop` 各有一条 CSS `animation`。现在两条都删掉了，理由是：
 * ① 两条动画与 GSAP 的补间会**同时**抢同一批属性（opacity / transform），屏幕上是一次抖动而不是一次入场；
 * ② 真要有「JS 没跑起来时的兜底」，自然态本身就是最好的兜底——元素默认就是可见的，
 *    GSAP 的 `fromTo` 用 `immediateRender` 在第一帧之前就把它压回透明，动画照放；
 *    万一 GSAP 没初始化，弹窗就是**没有动画地正常出现**，而不是永远卡在 opacity 0。
 *    为此专门在 CSS 里写一条 `opacity: 0` 等着 GSAP 来解除，是把「界面能不能用」押在动画库上，不能干。
 *
 * ## 时机：入场必须抢在第一帧之前（**已真机量过，2026-10-11 P542**）
 *
 * 要成立的是：GSAP 写入的起始态（`autoAlpha: 0`）必须落在**浏览器第一次 paint 这个弹窗之前**。
 * 否则症状是「先完整可见一帧、再瞬间消失、再弹出来」——闪一下，而闪一下比没有动画更难看。
 *
 * 靠的是两处调用时机：父组件 `v-if` 挂载的那两个走 `onMounted`，弹层自己 `v-if` 的两个走
 * `watch(flush: "post")`，与 `useModalFocus` 完全同一套形状。
 *
 * 【真机量的结论】逐帧 rAF 采样装在点开之前（`.mochen-tmp/p542/dialog-motion-warm.mjs`）：
 * 弹窗出现后的**第一帧**实测就是 `opacity: 0 / translateY(6px) / scale(0.985)`，
 * 即 GSAP 的起始态，没有任何一帧是被完整画出来的 ⇒ **不闪**。
 * 第二次（热）打开的采样里没有一个 >40ms 的帧间隔，且 `dt=7ms` 处实测 `ty=5.4895`
 * 与 200ms 补间在该进度的解析解 `6×(1−y(0.035))=5.490` 吻合 ⇒ 补间确实跑满设计时长。
 *
 * 【量到过一次「看着像 bug」的东西，不是 bug，值得记一笔】
 * 第一次（冷）打开时，采样显示「4ms 内 ty 从 6px 跳到 0.137px」，同一个缺口还有一处 64ms 丢帧。
 * 那是冷启动时主线程被设置页渲染占住——**浏览器阻塞期间同样没法 paint，用户并不会看到那 180ms**，
 * 而补间本身照样跑完（过冲峰值与热的那次一致）。判据用「连开两次」才分得开这两种解释；
 * 只量一次就会把它当成代码问题去改，改的还是没坏的地方。
 *
 * 【守卫钉的是接线，不是这一段】环境是 node、没有 DOM，所以上面那段量不到仓库里；
 * 守卫只钉「两处时机都在同一拍、中间没有 setTimeout / rAF 推迟」。
 * 哪天真看见闪，**先查有没有人在中途插过一拍**，而不是去怀疑 Vue 的调度顺序。
 *
 * 【顺带说明为什么不用 CSS 的 opacity: 0 去万无一失地兜住这一帧】
 * 那样确实什么都不会闪，但 GSAP 万一没初始化，弹窗就永远卡在透明——
 * 把「界面能不能用」押在动画库上，这个取舍的方向是反的。
 * 自然态可见 + GSAP 抢在第一帧前压暗，是有意选的那一边。
 *
 * ## 与「减少动效」的关系
 * CSS 的总闸（`html[data-reduced-motion="true"] *`）**管不到 GSAP**——它靠的是
 * `animation-duration` / `transition-duration` 两个 CSS 属性，JS 补间不经过它们。
 * 所以这一层必须自己认那两档，认的是 `reducedMotionActive`（与应用内偏好同一个判定）。
 * 认到就直接不建时间轴：元素停在自然态，也就是「正常出现、没有动画」，与那两档的语义一致。
 */

/** 背板类名：面板的直接父节点就是它，拿不到就不动背板（宁可少动一层，不许面板单独弹）。 */
const BACKDROP_CLASS = "dialog-backdrop";

/**
 * 出场总时长（秒）。原来写在 motion.css 的 `--dur-dialog: 200ms`，随 CSS 那两条动画一起搬过来。
 * 为什么对话框比浮层慢一档（浮层是 170ms）：对话框是一次性模态，面板得把弹簧那段过冲**跑完**，
 * 170ms 里过冲只落在头 50ms，读起来是「弹了一下」而不是「落到位」。
 */
const DIALOG_MOTION_SECONDS = 0.2;

/**
 * 面板的起始态：位移 6px、缩放 0.985。
 * 与 CSS 那条 `mochen-pop-in` 的 from 同形，但**不是同一个东西的两份实现**：
 * 浮层表（十四个小面板）走的是软曲线 + CSS 关键帧，对话框走的是弹簧 + 这里。
 * 2026-10-10 拆分时就已经把它们分成「存在性」与「手感」两件事了，这里接着拆。
 */
const PANEL_FROM = { autoAlpha: 0, y: 6, scale: 0.985 };

export interface DialogMotionOptions {
  /** `.workspace-dialog` 那一格的模板 ref。与 `useModalFocus` 收的是同一个 ref，不必另建一个。 */
  root: Ref<HTMLElement | undefined>;
  /**
   * 弹层自己 `v-if` 的那种传那个 ref（SideNavNoticeDialog / SaveConflictDialog）；
   * 由父组件 `v-if` 挂载的那种不传（ModelProfileDialog / NewBookDialog）——挂载即开。
   * 与 `useModalFocus` 的同名入参同一口径，别在这两层各发明一种。
   */
  isOpen?: Ref<boolean>;
}

export function useDialogMotion(options: DialogMotionOptions): void {
  const { root } = options;
  const opened = options.isOpen ?? shallowRef(true);

  /**
   * 用 `gsap.context` 而不是自己存一条 timeline 的引用：
   * `revert()` 除了杀掉补间，还会把 GSAP 写上去的行内样式一并摘掉。
   * 对话框是会重复开关的（连开两次之间留着行内 transform，下一次 `fromTo` 再覆盖一遍），
   * 摘干净比覆盖干净。
   */
  let ctx: gsap.Context | null = null;

  function backdropOf(el: HTMLElement): HTMLElement | null {
    const parent = el.parentElement;
    return parent !== null && parent.classList.contains(BACKDROP_CLASS) ? parent : null;
  }

  function play(el: HTMLElement): void {
    ctx?.revert();
    ctx = null;

    // 认到「减少动效」就不建时间轴：不写任何行内样式 = 元素停在自然态 = 直接可见。
    if (reducedMotionActive(currentReducedMotionHost())) return;

    const backdrop = backdropOf(el);
    ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { duration: DIALOG_MOTION_SECONDS, ease: springEase }
      });
      // 背板与面板**同起同落、同一段时长同一条曲线**：面板在弹、背板硬邦邦地出现，两层各自为政是最难看的那种。
      // 面板在前、背板在后这个顺序不重要（位置参数都是 0），写出来是为了两条都在 0 处、不靠追加顺序。
      if (backdrop !== null) {
        tl.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1 }, 0);
      }
      tl.fromTo(el, PANEL_FROM, { autoAlpha: 1, y: 0, scale: 1 }, 0);
    }, el);
  }

  // 弹层自己 v-if 的那种：`opened` 翻 true 时 DOM 才刚更新完（root.value 此刻才拿得到），
  // 所以监听必须 post 之后才跑，理由与 useModalFocus 那条一模一样。
  watch(
    opened,
    (isOn) => {
      if (!isOn) {
        // 关掉时把这一场收干净：弹层自己 v-if 的那种，组件还活着而那两格已经被摘掉了，
        // 留着一条补间就是让它继续往已脱离文档的节点上写样式。
        ctx?.revert();
        ctx = null;
        return;
      }
      const el = root.value;
      if (el !== undefined) play(el);
    },
    { flush: "post" }
  );

  // 父组件 v-if 挂载的那种：挂载即开，走 mounted。
  onMounted(() => {
    const el = root.value;
    if (el !== undefined && opened.value) play(el);
  });

  onBeforeUnmount(() => {
    ctx?.revert();
    ctx = null;
  });
}

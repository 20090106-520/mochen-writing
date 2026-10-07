import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from "vue";

/**
 * 弹层的键盘与焦点真身（2026-10-07 批次 5-㊱）。
 *
 * 【它修的是哪一族】四个弹层（SideNavNoticeDialog / NewBookDialog / SaveConflictDialog /
 * ModelProfileDialog）都写了 `aria-modal="true"`，也都至少有一条鼠标出路，但**没有一处把焦点挪进去**。
 * 后果是真机实测的（`.mochen-tmp/p535/p536c-esc-dialog.mjs` 与 `p536d-modal-esc-family.mjs`）：
 * 点「数据统计」弹窗开了，`document.activeElement` 仍是左栏那颗 `BUTTON.nav-row[data-nav-id=stats]`；
 * 按 Esc 弹窗纹丝不动；把焦点手动挪进弹窗再按 Esc，仍然不动——因为模板里根本没有 keydown。
 * NewBookDialog 连按一次 Tab 就跑到左栏 `BUTTON.nav-row.nav-group-toggle` 上去了。
 *
 * 【为什么形状对了不等于行为对】项目自己钉过「是弹层就得有关闭通路：遮罩按下关、Esc 关、× 关、取消关」
 * （components/model-profile-dialog-wiring.test.ts）。那条守卫量的是**模板里有没有 keydown**，
 * 而 `@keydown` 只在事件冒泡经过那棵子树时才收得到——焦点不在里面，就等于没写。
 *
 * 【为什么是这一份而不是四个组件各写各的】铁律 6：同一判定只留一份实现。
 * 四个弹层现在要判的是同一件事（这一层是不是最上面那层、焦点该不该被它接管），
 * 分成四份就是下一次只改三份的老路。所以 Esc、Tab、焦点进出全在这一处。
 *
 * 【与 utils/escape-policy 的分层】那条链管的是**工作区内**的层（设置整页、引用菜单、查找替换、打断回合）。
 * 弹层比它们更外一层：Esc 在这里被吃掉并 `stopPropagation`，全局链收不到，
 * 于是「弹窗开着时按 Esc」绝不会顺手把正在跑的那一轮打断掉——一层一层收，与那条链同一口径。
 *
 * 【模板上要配合的一件事】根节点那一格必须带 `tabindex="-1"`。
 * 它是「层里一颗可聚焦的都没有时」的落点，也是首屏没有按钮的弹层的落点；
 * 没有它，上面那条 `el.focus()` 会静默失败（div 默认不可聚焦），症状是「焦点还是没进来」。
 *
 * 【监听挂在层根上，不挂 document】裁定 G5：挂在 document 上的全局 keydown 监听全仓只允许一处，
 * 在 composables/useHotkeys.ts。这里第一版挂的是 document，被那条守卫当场逮住（批次 5-㊱ 的实测）。
 * 改挂层根不但合了裁定，还更对：监听的作用域就是这一层，不该在别的层开着的时候也还活着。
 * 至于「焦点不在层内时收不到」那个老毛病——它已经被上面那条「焦点进层」治好了，
 * 焦点既然保证在层内，事件就一定冒泡经过这棵子树。两件事各管一段，不必都靠监听的位置。
 *
 * （本段刻意不把那条字面量原样写出来：裁定 G5 那条守卫读的是**原文**且不剥注释，
 * 注释里把这串 API 写全，等于凭空多出第二处「全局监听」，当场把门禁弄红。
 * 同理也别在这里写完整的 CSS 自定义属性引用——theme-token-guard 会把注释里那句当成真的消费，
 * 报一个「被消费但没人定义」的孤儿变量。**守卫读原文，注释里的字面量会被当真**：这一条已经栽了两次。）
 */
export interface ModalFocusOptions {
  /** 弹层根节点的模板 ref（`.workspace-dialog` 那一格）。 */
  root: Ref<HTMLElement | undefined>;
  /** 收掉这一层的唯一动作：各弹层自己的 close 判定（写草稿、丢弃改动那些都在那边，不搬）。 */
  close: () => void;
  /**
   * 「这一层开着吗」。
   * 两种挂法都在支持：弹层由父组件 `v-if` 挂载的（NewBookDialog / ModelProfileDialog）不传，
   * 挂载即开、卸载即关；由弹层自己 `v-if` 的（SideNavNoticeDialog / SaveConflictDialog）传那个 ref。
   */
  isOpen?: Ref<boolean>;
}

/**
 * 弹层里可聚焦的那些。
 *
 * 为什么和 useComposerContextPopover 里那份不完全一样、且没有合并成一份：
 * 那份是**浮层**，故意只收 button 与 input——贴着锚点、随手一点就收，链接与自定义 tabindex 不在那一串里。
 * 这一份是**模态层**，它宣示了 `aria-modal`，Tab 必须被关在里面，于是凡是能吃到焦点的都算数。
 * 两处判的是不同的东西，不是同一个判定的两份实现。
 */
const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

/**
 * 开着的弹层栈（后开的在上面）。
 *
 * 为什么需要：LeftSidebar 的 need-book 引导里那枚「新建作品」会**同时**触发两件事——
 * 先 emit("newBook") 打开 NewBookDialog、再 emit("close") 收掉 SideNavNoticeDialog，
 * 两次状态写在同一个 tick 里。没有这个栈，同一次 Esc 会被两层各自处理一遍（下面那层跟着一起没了）。
 */
const openStack: symbol[] = [];

function focusablesOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0
  );
}

export function useModalFocus(options: ModalFocusOptions): void {
  const { root, close } = options;
  // 弹层由父组件 v-if 挂载的那种：不传 isOpen，挂载即开。
  const opened = options.isOpen ?? shallowRef(true);
  const token = Symbol("modal-focus");
  /** 打开那一刻的焦点：关掉时还给谁。存元素而不是选择器——触发钮随时可能被换掉。 */
  let opener: HTMLElement | null = null;
  /** 打开那一刻的根节点：卸载时组件 ref 已被清空，靠它判断「焦点还在不在我这一层里」。 */
  let openedRoot: HTMLElement | null = null;

  function enter(el: HTMLElement): void {
    const items = focusablesOf(el);
    const first = items.at(0);
    (first ?? el).focus();
  }

  /** 只有最上面那层才吃键：下面那层若也吃，一次 Esc 会把两层一起收掉。 */
  function isTopmost(): boolean {
    return openStack.at(-1) === token;
  }

  function onKeydown(event: KeyboardEvent): void {
    const el = root.value;
    if (el === undefined || !isTopmost()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key !== "Tab") return;
    const items = focusablesOf(el);
    const first = items.at(0);
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      // 一颗可聚焦的都没有：焦点停在层根上，别让它跑到背后的界面上。
      event.preventDefault();
      el.focus();
      return;
    }
    const active = document.activeElement;
    if (active === null || !el.contains(active)) {
      // 焦点不知怎么跑到层外了：从头（或从尾）把它请回来。
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * 把焦点还给触发它的那颗按钮。
   *
   * 什么时候**不**还：焦点已经被别的层接走了（need-book 引导点「新建作品」就是这种——
   * 下一层在同一 tick 里开了并把焦点收进去）。
   * 无条件还回去会把刚落进新弹层的焦点又踢回左栏，于是新弹窗开着、焦点却在它外面，
   * 又是同一个「弹层开着焦点不在里面」的病。故此按下面这个条件判断，而不是无脑 focus()。
   */
  function restoreFocus(): void {
    // 先把「还给谁」「哪一层」取到局部：下面那个 nextTick 跑到时，release() 早就把
    // opener / openedRoot 清空了——直接读闭包变量会读到 null，于是永远还不了。
    const target = opener;
    const rootAtClose = openedRoot;
    void nextTick(() => {
      const active = document.activeElement;
      const stillMine =
        active === null ||
        active === document.body ||
        (rootAtClose !== null && rootAtClose.contains(active));
      if (!stillMine) return;
      if (target !== null && target.isConnected) target.focus();
    });
  }

  function takeOver(el: HTMLElement): void {
    // 先记住「谁开的」再挪焦点：挪完之后 activeElement 就是我们自己了。
    const active = document.activeElement;
    opener = active instanceof HTMLElement ? active : null;
    openedRoot = el;
    if (!openStack.includes(token)) openStack.push(token);
    el.addEventListener("keydown", onKeydown, true);
    // 延到本轮 DOM 全部落定之后再挪：弹层可能是在同一 tick 里从上一层换下来的，
    // 先挪焦点会被上一层的 focus 归位覆盖掉。
    void nextTick(() => enter(el));
  }

  function release(): void {
    const index = openStack.indexOf(token);
    if (index !== -1) openStack.splice(index, 1);
    openedRoot?.removeEventListener("keydown", onKeydown, true);
    restoreFocus();
    opener = null;
    openedRoot = null;
  }

  // 弹层自己 v-if 的那种：`opened` 翻 true 时 DOM 还没更新（root.value 仍是 undefined），
  // 所以监听必须是 post 之后才跑。immediate 在这里反而有害——setup 期 DOM 还不存在。
  watch(
    opened,
    (isOn) => {
      if (!isOn) {
        release();
        return;
      }
      const el = root.value;
      if (el !== undefined) takeOver(el);
    },
    { flush: "post" }
  );
  // 父组件 v-if 挂载的那种：挂载即开，走 mounted 而不是 immediate watch（理由同上）。
  onMounted(() => {
    const el = root.value;
    if (el !== undefined && opened.value) takeOver(el);
  });
  onBeforeUnmount(release);
}

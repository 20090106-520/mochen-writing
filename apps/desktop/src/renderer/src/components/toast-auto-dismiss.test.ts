/// <reference types="node" />
/**
 * Toast 自动消失与分级驻留的守卫（2026-11-20 通知整修 A1+C1+A6）。
 *
 * 【这一轮修的三个真实缺陷】
 * ① A1：自动消失的 for 循环写在 `<script setup>` 顶层，只在挂载那一刻跑一次，
 *    而组件常驻挂载 ⇒ 启动后到达的新 toast 永远不会自动消失。
 * ② A6：error 的图标名写的 "x"，图标表里根本没有这一枚 ⇒ 错误通知的图标一直空白。
 * ③ C1：四级一律 4 秒。这三件事都不许再回来——本文件逐条钉住。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const toastScript = scriptSource("components/NotificationToast.vue");
const toastTemplate = templateSource("components/NotificationToast.vue");
const toastCss = strippedStyleSource("toast.css");

describe("A1：自动消失跟着 watch 走，不再只跑一次", () => {
  it("计时器安排挂在 watch(visibleToasts) 上，且 immediate 起跑（覆盖挂载那一代）", () => {
    expect(toastScript).toContain("watch(");
    expect(toastScript).toContain("visibleToasts");
    expect(toastScript).toContain("immediate: true");
  });

  it("不许再有 setup 顶层的 for 循环安排计时器（旧缺陷的形状）", () => {
    expect(toastScript, "for 循环安排计时器跑回顶层旧形状了").not.toContain(
      "for (const n of visibleToasts.value)"
    );
  });

  it("计时器按 id 收进 Map 去重，卸载时全部清掉", () => {
    expect(toastScript).toContain("new Map<");
    expect(toastScript).toContain("onBeforeUnmount(");
    expect(toastScript).toContain("clearTimeout");
  });

  it("离场的 toast 计时器必须跟着撤销，不许留空转", () => {
    expect(toastScript).toContain("!present.has(id)");
  });

  it("悬停中的 toast 不许被 watch 的重排续上计时（暂停是暂停，不是重置）", () => {
    // 2026-11-20 复审补钉：pauseDismiss 把计时器从 Map 删掉之后，任何其他 toast 进出
    // 都会重跑 watch 回调并给全体在场 toast 重新安排计时——悬停中的那条照样被续上，
    // 「悬停暂停」实际变成了「悬停重置」。修复后悬停集合挡在 scheduleDismiss 最前面。
    expect(toastScript, "悬停集合不见了——暂停又变成重置了").toContain("new Set<string>()");
    expect(toastScript, "scheduleDismiss 的第一道闸必须是悬停守卫").toMatch(
      /function scheduleDismiss\(id: string\): void \{\s*\n\s*if \(hovered\.has\(id\)\) return;/
    );
    // 卸载时悬停集合也要清（与计时器同一个生命周期）。
    expect(toastScript).toContain("hovered.clear()");
  });

  it("驻留时长读 utils/notification-dwell.ts 的分级表，不再写死一个数", () => {
    expect(toastScript).toContain("notificationDwellMs(");
    const ms = /setTimeout\(([^,]+),\s*([^)]+)\)/.exec(toastScript)?.[2] ?? "";
    expect(ms, "驻留毫秒必须是 notificationDwellMs(...) 的返回值").toContain("notificationDwellMs");
    expect(toastScript, "驻留里不许再出现写死的 4000").not.toContain("4000");
  });
});

describe("A6：错误通知的图标必须真的画得出来", () => {
  it('error 档不再引用图标表里不存在的 "x"', () => {
    expect(toastScript, 'error 图标又指回 "x" 了').not.toContain('return "x"');
    expect(toastScript).toContain('return "close"');
  });
});

describe("C5：排队徽章与 C2：动作按钮真的在模板里", () => {
  it("+N 徽章在栈里，点击带回工作台再开通知中心（Toast 常驻四页，面板只在中栏）", () => {
    expect(countNeedle("toast-queue-badge", toastTemplate)).toBe(1);
    // 复审补钉：设置页里点徽章若只开真身，中栏不在屏上就是「点了没反应」。
    expect(toastScript).toContain("layout.showWorkspace()");
    expect(toastScript).toContain("layout.openNotificationCenter()");
  });

  it("带动作的通知渲染真按钮，文案读 NOTIFICATION_ACTION_LABELS 表", () => {
    expect(toastTemplate).toContain("toast-action");
    // 按钮文案在模板里读表（script 只是 import 这张表）。
    expect(toastTemplate).toContain("NOTIFICATION_ACTION_LABELS[");
    expect(toastScript).toContain("runner.run(");
  });

  it("悬停暂停 / 移出恢复：长理由读一半被收走比不出现还糟", () => {
    expect(toastTemplate).toContain("pauseDismiss");
    expect(toastTemplate).toContain("resumeDismiss");
  });
});

describe("B1+B2+A4+B5：toast.css 的整修钉在这几条规则上", () => {
  it("形状并入浮层家族：12px 圆角、发丝线、浮层阴影", () => {
    const toast = ruleBlock(toastCss, ".toast");
    expect(toast).toContain("border-radius: 12px");
    expect(toast).toContain("var(--line-soft)");
    expect(toast).toContain("var(--shadow-color)");
  });

  it("级别区分不再画左侧粗色条（那一族粗条已死）", () => {
    expect(toastCss, "border-left 粗条回到了 toast 上").not.toContain("border-left: 3px");
  });

  it("error / warning 的正文放开为三行钳制", () => {
    const clamp = ruleBlock(toastCss, ".toast.is-error .toast-msg,\n.toast.is-warning .toast-msg");
    expect(clamp).toContain("-webkit-line-clamp: 3");
    expect(clamp).toContain("white-space: normal");
  });

  it("过渡曲线读 motion.css 的手感 token，不再自带 ease", () => {
    expect(ruleBlock(toastCss, ".toast-enter-active")).toContain("var(--ease-out-soft)");
    expect(ruleBlock(toastCss, ".toast-leave-active")).toContain("var(--dur-fast");
  });

  it("栈 gap 提到 8px", () => {
    expect(ruleBlock(toastCss, ".toast-stack")).toContain("gap: 8px");
  });

  it("锚点、层级、入场方向的既有守卫仍然成立（overlay-chrome.test.ts 同款）", () => {
    const stack = ruleBlock(toastCss, ".toast-stack");
    expect(stack).toContain("left:");
    expect(stack).toContain("z-index: var(--z-toast)");
    expect(ruleBlock(toastCss, ".toast-enter-from")).toContain("translateX(-20px)");
  });
});

describe("store 与组件的接口对上了", () => {
  it("AppNotification 里不再有死字段 actionLabel（剥注释后断言——注释里的史料不算数）", () => {
    expect(typeScriptSource("stores/useNotificationStore.ts")).not.toContain("actionLabel");
  });

  it("动作 kind 读回时校验现役表，坏字符串不递给执行器", () => {
    const store = vueSource("stores/useNotificationStore.ts");
    expect(store).toContain("isNotificationActionKind");
  });

  it("systemNotify 只在窗口失焦时发：前台正对着屏幕，原生弹窗是双重打扰", () => {
    const store = vueSource("stores/useNotificationStore.ts");
    expect(store).toContain("!document.hasFocus()");
  });
});

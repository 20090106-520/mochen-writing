/// <reference types="node" />
/**
 * 通知中心的守卫（2026-11-20 通知整修 A2+B4）。
 *
 * 【它为什么必须存在】useNotificationStore 从 2026-10 起就实现了
 * unreadCount / recentNotifications / markAllAsRead / remove / clearAll 五个 API，
 * 但界面上一直没有出口——攒了 50 条历史，用户一条都回看不了。
 * 这一轮 NotificationCenter.vue 把出口补上；本文件钉住「出口不许再消失」。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  popInSelectors,
  ruleBlock,
  scriptSource,
  strippedStyleSource,
  templateSource,
  vueSource
} from "../utils/vue-source-reader";

const centerScript = scriptSource("components/NotificationCenter.vue");
const centerTemplate = templateSource("components/NotificationCenter.vue");
const centerCss = strippedStyleSource("notification-center.css");
const motionCss = strippedStyleSource("motion.css");

describe("A2：store 的五个历史 API 终于有了消费者", () => {
  it("组件消费 recentNotifications 与 unreadCount", () => {
    expect(centerScript).toContain("recentNotifications");
    expect(centerScript).toContain("unreadCount");
  });

  it("头部有「全部已读」与「清空」，行内有删除", () => {
    expect(centerTemplate).toContain("notif.markAllAsRead()");
    expect(centerTemplate).toContain("notif.clearAll()");
    expect(centerTemplate).toContain("notif.remove(n.id)");
  });

  it("未读徽章在触发钮上：unreadCount 从此不是只算不看的数", () => {
    expect(centerTemplate).toContain("notification-center-dot");
  });

  it("切到设置页再回来，面板不许还开着（与历史对话同一行为）", () => {
    // 2026-11-20 复审补钉：开合真身住 layoutStore，中栏卸载不清它——
    // 切设置页回来面板自动开着，与隔壁「历史对话」（局部 ref，切页即消）行为不一致。
    // 修复形状：组件卸载时把真身关掉。真身关了再卸载（v-if 面板）不许重复写。
    expect(centerScript).toContain("onBeforeUnmount(");
    expect(centerScript).toMatch(
      /onBeforeUnmount\(\(\) => \{\s*\n\s*if \(open\.value\) open\.value = false;/
    );
  });

  it("带动作的通知在中心里也能执行（执行器与 Toast 同一份，不许各写一个 switch）", () => {
    expect(centerScript).toContain("useNotificationActionRunner");
    expect(centerTemplate).toContain("NOTIFICATION_ACTION_LABELS[");
    // 两处 UI 各真调用一次（import 路径里也含这个名字，所以数的是带调用括号的针串）；
    // 执行器的 switch 只有一份。
    expect(
      countNeedle("useNotificationActionRunner(", vueSource("components/NotificationToast.vue"))
    ).toBe(1);
    expect(countNeedle("useNotificationActionRunner(", centerScript)).toBe(1);
    expect(vueSource("composables/useNotificationActionRunner.ts")).toContain(
      'case "open-model-settings"'
    );
  });
});

describe("接线：入口、开合真身、图标", () => {
  it("中栏头部动作区挂了 NotificationCenter（2026-11-20 起住 CenterHeaderActions）", () => {
    const host = vueSource("components/CenterHeaderActions.vue");
    expect(host).toContain('import NotificationCenter from "./NotificationCenter.vue"');
    expect(templateSource("components/CenterHeaderActions.vue")).toContain(
      "<NotificationCenter />"
    );
    // 中栏骨架里不许留第二份（挂载点整块拆去了 CenterHeaderActions）。
    expect(templateSource("components/CenterColumn.vue")).not.toContain("<NotificationCenter />");
  });

  it("开合真身住 layoutStore（Toast 的 +N 徽章与触发钮开同一份布尔）", () => {
    const layout = vueSource("stores/layoutStore.ts");
    expect(layout).toContain("notificationCenterOpen");
    expect(layout).toContain("openNotificationCenter");
  });

  it("bell 图标进了表，AppIcon 画得出这一枚", () => {
    expect(vueSource("types/icons.ts")).toContain('"bell"');
    expect(vueSource("components/AppIcon.vue")).toContain("name === 'bell'");
  });
});

describe("B4：形态与材质照浮层家族", () => {
  it("根类名挂上了 motion.css 的 pop-in 出场表", () => {
    expect(popInSelectors(motionCss)).toContain(".notification-center");
  });

  it("样式表接进了 styles.css", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/notification-center.css";');
  });

  it("玻璃开着时与历史对话面板同一张面", () => {
    expect(strippedStyleSource("liquid-glass.css")).toContain(".notification-center");
  });

  it("面板形状：12px 圆角、发丝线、浮层阴影、370px 宽（历史对话同族）", () => {
    const panel = ruleBlock(centerCss, ".notification-center");
    expect(panel).toContain("border-radius: 12px");
    expect(panel).toContain("var(--line-soft)");
    expect(panel).toContain("var(--shadow-color)");
    expect(panel).toContain("min(370px");
  });

  it("焦点可达：头部动作与行内按钮都有 focus-visible 环", () => {
    expect(countNeedle("focus-visible", centerCss)).toBeGreaterThanOrEqual(3);
  });
});

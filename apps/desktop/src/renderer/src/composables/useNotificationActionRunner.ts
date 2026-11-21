/**
 * 通知动作执行器（2026-11-20 通知整修 A3+C2）。
 *
 * 【为什么执行器是一份 composable 而不是两个组件各写一个 switch】
 * Toast 与通知中心都要执行同一种 kind——两份 switch 迟早一份改了另一份忘（铁律 6）。
 * kind → 中文标签的那一层住 utils/notification-actions.ts（可序列化、可钉边界），
 * kind → 真动作的这一层住这里（拿得到 Pinia）。两处 UI 只调 run()。
 */
import { useLayoutStore } from "../stores/layoutStore";
import type { NotificationActionKind } from "../utils/notification-actions";

export function useNotificationActionRunner(): {
  run: (kind: NotificationActionKind) => void;
} {
  const layout = useLayoutStore();

  function run(kind: NotificationActionKind): void {
    switch (kind) {
      case "open-model-settings":
        layout.showSettings("model");
        break;
      case "open-project-settings":
        layout.showSettings("projects");
        break;
    }
  }

  return { run };
}

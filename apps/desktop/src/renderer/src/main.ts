import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { useNotificationStore } from "./stores/useNotificationStore";
import "./styles.css";

const pinia = createPinia();
const app = createApp(App).use(pinia);

/**
 * 渲染层的最后一道兜底（2026-11-20 审计 R-1）。
 *
 * 界面里大量「火忘型」异步（`void run(...)`）一旦抛到顶层，原先既没有提示、也没有落盘痕迹：
 * 用户只看到一次操作没反应。这里把它们收成一条应用内通知——不新增全局状态，也不吞掉
 * 控制台堆栈（排查时仍要能看到完整错误）；通知本身再失败就彻底放弃，兜底绝不允许二次抛。
 */
function reportRendererFailure(where: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[渲染层] ${where}：${reason}`, error);
  try {
    useNotificationStore(pinia).notify({
      title: "界面出了个错",
      message: `${where}：${reason}`,
      level: "error"
    });
  } catch {
    // 通知通路也坏了：这一层已无更外层可退，只能留在控制台。
  }
}

app.config.errorHandler = (error, _instance, info) => {
  reportRendererFailure(info, error);
};

window.addEventListener("unhandledrejection", (event) => {
  reportRendererFailure("一个后台任务失败了", event.reason);
});

app.mount("#app");

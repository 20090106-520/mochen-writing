import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { useNotificationStore } from "./stores/useNotificationStore";
import { useBookStore } from "./stores/useBookStore";
import { restoreLastSession } from "./utils/session-restore";
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

/**
 * 启动时静默恢复上次会话（2026-11-24）：挂载完成后把「最近一次打开的书」接回来，
 * 开成后顺带落一个文稿标签。接线放**入口**而不是根组件——根组件（App.vue）的挂载
 * 段是并行改动的高危区，而恢复需要的只是 pinia 实例与 preload，挂载后这里全都有；
 * 挂载先走完，恢复的 IPC 在其后异步回来，界面经既有 watch（hasBook / activeDocTab）
 * 自然就位，不会挡住首帧。
 *
 * 「上次是哪本」的信号、第一章的取舍、静默与降级的全部代价与边界，见
 * `utils/session-restore.ts` 头注释——这里只接线，不复制判据（铁律 6）。
 */
void restoreLastSession(
  (() => {
    const book = useBookStore(pinia);
    return {
      listRecent: () => window.mochen.listRecentBooks(),
      // 走 store 的 openBook（openBookInto 是开书通路的唯一一份：flush 上一本、失败文案）。
      // 失败时它把人话写进 notice 而不抛，这里以「手上有没有书」作成败判据交回去。
      open: async (rootPath: string) => {
        await book.openBook(rootPath);
        return book.hasBook;
      },
      clearNotice: () => {
        book.notice = "";
      },
      docs: () => book.docs,
      chapterOrder: () => book.meta?.chapterOrder ?? [],
      openDoc: (relPath: string) => book.openDocTab(relPath)
    };
  })()
);

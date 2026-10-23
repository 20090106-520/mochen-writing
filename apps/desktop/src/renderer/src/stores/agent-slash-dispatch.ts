/**
 * `/` 面板唯一派发口（spec §6）：命令落在哪个 store 动作上，只在这里决定一次。
 * 面板组件、快捷键接线都不允许再各写一份 switch。
 *
 * 2026-10-21 从 useAgentStore 拆出：那份文件贴到 800 行预算，而这张 switch 表与线程状态机
 * 不共享状态——它自己不存任何东西，只把命令转给别的 store 动作或本 store 的已有动作。
 */
import { PERMISSION_LABELS, PERMISSION_MODES } from "@mochen/contracts";
import {
  cardsCountOf,
  composeStatusReport,
  threadKeyFor,
  type ProposalView,
  type ThreadView
} from "../utils/agent-thread";
import { matchStageName, stageLabelOf } from "../utils/composer-context";
import { matchPermissionMode, type SlashCommand } from "../utils/slash-commands";
import { useLayoutStore } from "./layoutStore";
import { useBookStore } from "./useBookStore";

/** 派发表要读写的那几个字段：宿主（store）本身结构对得上就行，不给这里另造第二份视图。 */
export interface SlashDispatchHost {
  notice: string;
  threads: Record<string, ThreadView>;
  proposals: Record<string, ProposalView>;
  pendingOf(threadKey: string): number;
  ensureHydrated(threadKey: string): Promise<void>;
  clearThreadView(threadKey: string): void;
}

export function dispatchSlashCommand(
  host: SlashDispatchHost,
  command: SlashCommand,
  argument: string
): void {
  const book = useBookStore();
  const threadKey = threadKeyFor(book.activeDocTab);
  switch (command) {
    case "model":
      // 与 Ctrl+, 同一条通路（Task 7）：模型设置的唯一真身仍是 ProviderSettings 浮层。
      useLayoutStore().showSettings();
      return;
    case "permissions": {
      // 不带档名 ⇒ 只开菜单（popover 里逐档可点）；带档名 ⇒ 查表直接切档落盘（spec §6）。
      if (argument === "") {
        book.openPermissionMenu();
        return;
      }
      const mode = matchPermissionMode(argument);
      if (mode === null) {
        // 档名列一律来自 PERMISSION_LABELS，这里不手抄第二份中文。
        host.notice = `没有这一档：「${argument}」。可选：${PERMISSION_MODES.map((item) => PERMISSION_LABELS[item]).join(" / ")}。`;
        return;
      }
      void book.setPermissionMode(mode);
      return;
    }
    case "status": {
      host.notice = composeStatusReport({
        threadKey,
        thread: host.threads[threadKey],
        cards: cardsCountOf(host.proposals, threadKey),
        pending: host.pendingOf(threadKey),
        hasBook: book.hasBook,
        permissionMode: book.meta?.permissionMode ?? null,
        stageName: stageLabelOf(book.meta)
      });
      return;
    }
    case "resume":
      void host.ensureHydrated(threadKey);
      return;
    case "clear":
      host.clearThreadView(threadKey);
      return;
    case "skills":
      // 与左栏那枚「技能库」钮同一条真身：layout.showCenter("skills")。
      // 命令面板不许在组件里各派发一次，命令落到哪个动作上只在这里决定一次。
      // 5-㉜ 起它们换的是**中栏那一格**（左栏恒定），所以这里也切中栏——
      // 两处指同一处，否则会出现「命令进来落在整页、钮进来落在中栏」的两处真身。
      useLayoutStore().showCenter("skills");
      return;
    case "plugins":
      // 与左栏那枚「插件」钮同一条真身：layout.showCenter("plugins")。
      // 插件与技能都是「装在应用里的东西」，与当前书/线程都无关，
      // 而中栏显示什么是与书无关的布局状态，正是 layout 的作用域。
      useLayoutStore().showCenter("plugins");
      return;
    case "skins":
      // 与左栏那枚「皮肤广场」钮同一条真身：layout.showCenter("skins")。
      // 它与技能库/插件同属「左栏某枚钮通向的中栏那一格」，落点只能是中栏。
      useLayoutStore().showCenter("skins");
      return;
    case "export":
      // 与右栏头部那枚「导出」钮同一条真身：layout.openExport()（面板可见态住在 layout）。
      useLayoutStore().openExport();
      return;
    case "wordcount":
      // 与右栏头部那枚「字数统计」钮同一条真身：layout.openWordCount()。
      useLayoutStore().openWordCount();
      return;
    case "newbook":
      // 与左栏「+」同一条真身：layout.openNewBook()（开合真身是 layout.newBookOpen）。
      useLayoutStore().openNewBook();
      return;
    case "stage": {
      // 无参：报当前阶段 + 可选值（回一句实话，而不是「按了没反应」）。
      if (argument.trim() === "") {
        const options = (book.meta?.stages ?? []).map((s) => s.name).join(" / ");
        host.notice =
          options === ""
            ? "这本书还没有任何阶段。"
            : `当前阶段：${stageLabelOf(book.meta)}。可选：${options}（例：/stage ${(book.meta?.stages ?? [])[0]!.name}）。`;
        return;
      }
      const stage = matchStageName(book.meta, argument);
      if (stage === null) {
        const options = (book.meta?.stages ?? []).map((s) => s.name).join(" / ");
        host.notice = `没有这个阶段：「${argument}」。可选：${options || "（无）"}。`;
        return;
      }
      if (stage.id === book.meta?.activeStage) {
        host.notice = `已经在「${stage.name}」这一阶段。`;
        return;
      }
      void book.setActiveStage(stage.id);
      return;
    }
  }
}

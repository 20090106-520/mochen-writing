/**
 * 行内引用菜单的状态容器（#106）：打字时的匹配态、高亮位、条目列表与「选中之后干什么」。
 * 为什么住在 store 而不是组件里：键位裁决只有全局那一处（裁定 G5/D2），
 * useHotkeys.ts 拿不到组件的本地 ref ⇒ 菜单的开合与高亮必须是 store 态，否则 Enter 无人可派。
 * 判定一律在 utils/inline-reference-menu.ts（纯函数、可单测），浏览器对象一律不碰：
 * 光标位置由组件读好后当参数传进来，「插入后把光标放到哪、焦点还给谁」以口信（caretRequest）交回组件。
 * 草稿的唯一写者仍是 useAgentStore.setDraft（F-A 前置），这里不另开一条通路。
 */
import { defineStore } from "pinia";
import {
  REFERENCE_MENU_COPY,
  findReferenceMatch,
  referenceEmptyText,
  referenceOptionPool,
  referenceVisibleOptions,
  resolveReferenceSelection,
  type ReferenceMatch,
  type ReferenceMenuCopy,
  type ReferenceMenuPool,
  type ReferenceOption,
  type ReferenceSelection,
  type ReferenceTrigger
} from "../utils/inline-reference-menu";
// 上下键环绕与夹下标（2026-10-25）：从 utils/inline-reference-menu.ts 收到 utils/list-highlight.ts ——
// 它们与「引用菜单」无关，是「一组选项的高亮」这一族通用的一件事（铁律 6：判据只有一份）。
import { clampHighlightIndex, moveHighlightIndex } from "../utils/list-highlight";
import { availableCommands, type PaletteFocus, type SlashCommand } from "../utils/slash-commands";
import { threadKeyFor, useAgentStore } from "./useAgentStore";
import { useBookStore } from "./useBookStore";

export const useReferenceMenuStore = defineStore("reference-menu", {
  state: () => ({
    /** 行内匹配态；null = 菜单关着。 */
    match: null as ReferenceMatch | null,
    activeIndex: 0,
    /** 「插入/召唤之后光标该落到哪」的口信（码点下标）；组件落完就 clearCaretRequest 收回。 */
    caretRequest: null as number | null
  }),

  getters: {
    isOpen: (state) => state.match !== null,
    trigger: (state) => state.match?.trigger ?? null,
    /** 标题/提示/图标/两档空态的唯一表；关着的时候是 null，模板的 v-if 就是它。 */
    copy(): ReferenceMenuCopy | null {
      const match = this.match;
      return match === null ? null : REFERENCE_MENU_COPY[match.trigger];
    },

    /**
     * 条目来源的唯一汇合点（铁律 6）：`/` 取 slash-commands 那张表并过可用性闸，`@` 取 book store 的 DocRef。
     * 组件与派发都只读这里，谁都不许再拼一份列表。
     */
    pool(): ReferenceMenuPool {
      const book = useBookStore();
      const agent = useAgentStore();
      const focus: PaletteFocus = {
        hasBook: book.hasBook,
        turnRunning: agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false
      };
      return { commands: availableCommands(focus), docs: book.docs };
    },

    /**
     * 「更多 → / 命令」二级目录的命令名单（2026-11-09）。
     * 不是第二份命令表：它就是 pool 里那道可用性闸过滤后的结果，目录与行内菜单共用。
     */
    commandCatalog(): readonly SlashCommand[] {
      return this.pool.commands;
    },

    /** 过滤前的池子条数——空态文案要区分「池子空」与「没搜到」。 */
    optionPool(): ReferenceOption[] {
      const match = this.match;
      return match === null ? [] : referenceOptionPool(match, this.pool);
    },

    visibleOptions(): ReferenceOption[] {
      const match = this.match;
      return match === null ? [] : referenceVisibleOptions(match, this.pool);
    },

    /** 屏幕上高亮的那条；列表被过滤变短时收回最后一行，绝不指着不存在的那条。 */
    selectedOption(): ReferenceOption | null {
      const list = this.visibleOptions;
      if (list.length === 0) return null;
      return list[clampHighlightIndex(this.activeIndex, list.length)] ?? null;
    },

    emptyText(): string {
      const match = this.match;
      return match === null ? "" : referenceEmptyText(match, this.optionPool.length);
    }
  },

  actions: {
    /**
     * 组件每次草稿变化或光标变化时调它（值取 store，光标由组件读好传进来）。
     * `focused` 为假时直接收菜单：焦点已经不在 composer，菜单不该在别人家屏幕上飘着。
     */
    syncFrom(value: string, caret: number, focused: boolean): void {
      const next = focused ? findReferenceMatch(value, caret) : null;
      if (next === null) {
        this.close();
        return;
      }
      const previous = this.match;
      const sameToken =
        previous !== null &&
        previous.start === next.start &&
        previous.trigger === next.trigger &&
        previous.query === next.query;
      this.match = next;
      // 换了一个 token ⇒ 从头一条开始；同一 token 只是过滤变窄 ⇒ 高亮收回还在的最后一行。
      this.activeIndex = sameToken
        ? clampHighlightIndex(this.activeIndex, this.visibleOptions.length)
        : 0;
    },

    close(): void {
      this.match = null;
      this.activeIndex = 0;
    },

    activate(index: number): void {
      this.activeIndex = clampHighlightIndex(index, this.visibleOptions.length);
    },

    /** ↑↓：环绕由纯函数算（deepwrite 的取模写法），这里只写回。 */
    move(delta: number): void {
      this.activeIndex = moveHighlightIndex(this.activeIndex, delta, this.visibleOptions.length);
    },

    /**
     * Enter / 鼠标选中：`@` 把引用文本写进草稿，`/` 把 token 吃掉并交给唯一派发口 runSlashCommand。
     * 两条都**不发送**消息（裁定 D2）；返回的结果带着新光标，由接线处还给 composer。
     * 没有可选项时只收菜单——与 deepwrite 的 `if (option) select(option) else close()` 逐字同义。
     */
    select(option?: ReferenceOption | null): ReferenceSelection | null {
      const match = this.match;
      if (match === null) return null;
      const chosen = option ?? this.selectedOption;
      if (!chosen) {
        this.close();
        return null;
      }
      const agent = useAgentStore();
      const key = threadKeyFor(useBookStore().activeDocTab);
      const result = resolveReferenceSelection(agent.draftOf(key), match, chosen);
      agent.setDraft(key, result.value);
      this.caretRequest = result.caret;
      this.close();
      if (result.kind === "execute") agent.runSlashCommand(result.command, "");
      return result;
    },

    /**
     * 唤起真身（裁定 D1）：`/` 的三个入口（`/ 命令` chip、裸 `/` 键、工作台「更多功能」pill）与
     * `＋` 按钮（= `@` 引用素材）都走这里，全仓不再有第二块命令面板、也不再有第二份命令渲染。
     * 做法是往这一格草稿末尾补一个触发符并摆好光标——菜单由同一套行内判定自己开，
     * 于是按钮、键位与打字三条通路共用同一个 `findReferenceMatch`，没有第四份开合逻辑。
     */
    summon(trigger: ReferenceTrigger): void {
      const agent = useAgentStore();
      const key = threadKeyFor(useBookStore().activeDocTab);
      const current = agent.draftOf(key);
      // 末尾已经挂着一枚同型的触发符（上一枚没选完就再点一次）⇒ 只把菜单与光标摆回来。
      // 照直再补一枚会在草稿里留下「/ /」这种残渣，选完命令后那枚斜杠还赖在句子里。
      const tail = findReferenceMatch(current, current.length);
      if (tail !== null && tail.trigger === trigger) {
        this.caretRequest = current.length;
        this.syncFrom(current, current.length, true);
        return;
      }
      // 需要补一枚时才补，且只在末尾不是空白时先补一个空格：`findReferenceMatch` 的前置字符黑名单
      // 会把紧贴字母/数字的 `/`「@」判成词内部（path/mod、user@name），省掉那个空格会点出一次没反应的按钮。
      const pad = current === "" || /\s$/.test(current) ? "" : " ";
      const next = `${current}${pad}${trigger}`;
      agent.setDraft(key, next);
      this.caretRequest = next.length;
      this.syncFrom(next, next.length, true);
    },

    /**
     * 二级目录里选中一条命令（2026-11-09）。
     * 与行内菜单的 Enter 是同一个派发口 `agent.runSlashCommand`，命令落点仍只在
     * `agent-slash-dispatch.ts` 那张表决定一次；目录不改草稿、不补 `/` token、不发送消息。
     */
    runCommand(command: SlashCommand): void {
      this.close();
      useAgentStore().runSlashCommand(command, "");
    },

    clearCaretRequest(): void {
      this.caretRequest = null;
    }
  }
});

import { defineStore } from "pinia";
import { skillPolicyOf } from "@mochen/contracts";
import { useAgentStore, threadKeyFor } from "./useAgentStore";
import { useBookStore } from "./useBookStore";
import { activeStageOf } from "../utils/composer-context";
import { candidateOf, type SkillPick } from "../utils/skill-pick";
import { autoSkillPlanOf, preloadSkillIdOf, sameSkillIds } from "../utils/skill-auto";

/**
 * 自动识别 / 自动挂入技能（2026-11-09 用户裁定）。
 *
 * 【为什么不塞进 useAgentStore】
 * 那个 store 已经贴着 800 行的行数预算，而且自动挂入是**一层外挂策略**：
 * 它读 agent 的技能表与线程覆盖、写回同一份 `skillPathsByThread`，但不改
 * 「技能进上下文」的那条通路本身——`startTurn` 仍只认 `skillPathsOf(threadKey)`。
 * 于是判据在 utils/skill-auto.ts、装配在这里、写入口仍是 agent store 那一份。
 *
 * 【三条实话】
 * ① 默认开是用户要的「自动运用」，但开关常驻、挂了什么和为什么都在二级卡片里摆出来，
 *    不是黑箱；② 用户亲手取下的技能进本线程否决名单，不会再被自动加回来；
 * ③ 关掉开关时只撤走自己加的，用户手动挂的与书级默认原样留着。
 */
const STORAGE_KEY = "mochen.autoSkills.enabled";

function readEnabled(): boolean {
  try {
    // 只有显式关过才写 "0"；没写过时按「开」处理（用户默认要自动）。
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeEnabled(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // 隐私模式 / 禁用存储时不该让整个输入区挂掉：内存态照常工作，只是不跨重启。
  }
}

export const useAutoSkillStore = defineStore("autoSkill", {
  state: () => ({
    enabled: readEnabled(),
    /** 上一次由自动功能挂进去的 id，按线程记。撤也只撤这些。 */
    autoPinnedByThread: {} as Record<string, string[]>,
    /** 用户手动取下过的 id：本线程的否决名单。 */
    autoBlockedByThread: {} as Record<string, string[]>,
    /** 该线程的覆盖键是不是自动功能建的——是的话关掉开关就能删键，退回书级默认。 */
    autoOwnedOverride: {} as Record<string, boolean>,
    /** 「全部取下」后的本线程暂停闸：撤销必须显性（点「恢复自动推荐」），不能靠换个候选绕回来。 */
    autoPausedByThread: {} as Record<string, boolean>,
    /** 这一轮上榜的技能与理由，供二级卡片说明「为什么自动挂了它」。 */
    picksByThread: {} as Record<string, SkillPick[]>,
    /** 懒加载技能表的在途标记；失败后不再逐字重试（见 sync 的注释）。 */
    skillRefreshPending: false,
    skillRefreshFailed: false
  }),
  getters: {
    pinnedOf(state) {
      return (threadKey: string): string[] => state.autoPinnedByThread[threadKey] ?? [];
    },
    picksOf(state) {
      return (threadKey: string): SkillPick[] => state.picksByThread[threadKey] ?? [];
    },
    /**
     * 这一轮该预读哪一份正文（2026-11-17）：判据在 utils/skill-auto.ts 的
     * `preloadSkillIdOf`，这里只把线程的榜单递过去。空串 = 不预读。
     */
    preloadIdOf(state) {
      return (threadKey: string): string => preloadSkillIdOf(state.picksByThread[threadKey] ?? []);
    }
  },
  actions: {
    /**
     * 换书 / 关书时的整体作废（2026-11-24）。五张表全按线程键记，键里没有书——
     * 不清的话新书的自动挂入会继承上一本写下的否决名单与暂停闸，
     * 「新书里自动技能一枚不挂」这种说不清的状态就是这么来的。
     * 技能表本身是全局的（appData），`skillRefreshPending / Failed` 不在此列。
     */
    resetForBookSwitch(): void {
      this.autoPinnedByThread = {};
      this.autoBlockedByThread = {};
      this.autoOwnedOverride = {};
      this.autoPausedByThread = {};
      this.picksByThread = {};
    },

    /**
     * 重算这一轮的自动挂入。调用点：输入框草稿变化、技能表刷新、切回对话、开关打开。
     * 打分交给 utils/skill-auto.ts，这里只把计划落到 agent store 那一份线程覆盖上；
     * 清单没变就一个字都不写，免得每敲一个键都触发一轮响应式重渲染。
     */
    sync(threadKey: string): void {
      const agent = useAgentStore();
      const book = useBookStore();
      if (!this.enabled) return;
      // 「全部取下」是用户对**这一轮**下的令：只把当时挂着的那几枚记进否决名单不够，
      // 换个候选（比如第 4 名顶上来）下一秒又会自动挂一枚，用户看到的就是「点了没用」。
      // 暂停闸把整条 sync 挡住，唯一的解封入口是下面的 resetBlocked。
      if (this.autoPausedByThread[threadKey]) return;
      // 真机量出来的：对话页启动时**没人列过技能表**（原本只有技能库页 onMounted 会刷），
      // 于是先打开应用就直接打字时，自动识别对着一张空表算，一枚也挂不上——
      // 得先去技能库页逛一圈才生效。这里补一次懒加载：refreshSkills 成功后会回调 sync；
      // pending 挡并发，failed 挡「读不到就每敲一个字打一次 IPC」。
      if (!agent.skillsListed) {
        if (this.skillRefreshPending || this.skillRefreshFailed) return;
        this.skillRefreshPending = true;
        void agent.refreshSkills().finally(() => {
          this.skillRefreshPending = false;
          this.skillRefreshFailed = !useAgentStore().skillsListed;
        });
        return;
      }
      if (agent.skills.length === 0) return;
      const scene = {
        stageName: activeStageOf(book.meta)?.name ?? "",
        docKind: book.docs.find((one) => one.relPath === book.activeDocTab)?.kind ?? null,
        instruction: agent.draftOf(threadKey)
      };
      const plan = autoSkillPlanOf({
        candidates: agent.skills.map(candidateOf),
        scene,
        pinned: agent.skillPathsOf(threadKey),
        autoPinned: this.pinnedOf(threadKey),
        blocked: this.autoBlockedByThread[threadKey] ?? [],
        disabled: skillPolicyOf(book.meta).disabled
      });
      this.picksByThread[threadKey] = plan.picks;
      const current = agent.skillPathsOf(threadKey);
      if (!sameSkillIds(current, plan.desired)) {
        agent.skillPathsByThread[threadKey] = plan.desired;
        // 只在还没被用户接管过的线程上认领这个覆盖键。
        if (this.autoOwnedOverride[threadKey] === undefined)
          this.autoOwnedOverride[threadKey] = true;
      }
      this.autoPinnedByThread[threadKey] = plan.autoPinned;
    },

    setEnabled(value: boolean): void {
      if (this.enabled === value) return;
      this.enabled = value;
      writeEnabled(value);
      if (value) {
        // 亲手把总开关重新打开＝明确要自动，顺手解掉各线程的「全部取下」暂停，
        // 否则开了开关却一枚也不挂，看起来像开关坏了。
        this.autoPausedByThread = {};
        this.sync(threadKeyFor(useBookStore().activeDocTab));
        return;
      }
      const agent = useAgentStore();
      for (const threadKey of Object.keys(this.autoPinnedByThread)) {
        const auto = this.autoPinnedByThread[threadKey] ?? [];
        agent.skillPathsByThread[threadKey] = agent
          .skillPathsOf(threadKey)
          .filter((id) => !auto.includes(id));
        if (this.autoOwnedOverride[threadKey] === true) delete agent.skillPathsByThread[threadKey];
        delete this.autoOwnedOverride[threadKey];
      }
      this.autoPinnedByThread = {};
      this.picksByThread = {};
    },

    /**
     * 用户亲手挂入 / 取下某一枚。由 `useAgentStore.toggleSkillForThread` 转告，
     * 所以不管从技能库卡片、推荐条还是别处点，都走这一处，不会出现漏记的入口。
     */
    noteManual(threadKey: string, id: string, nowPinned: boolean): void {
      this.autoOwnedOverride[threadKey] = false;
      const blocked = new Set(this.autoBlockedByThread[threadKey] ?? []);
      if (nowPinned) blocked.delete(id);
      else blocked.add(id);
      this.autoBlockedByThread[threadKey] = [...blocked];
      this.autoPinnedByThread[threadKey] = this.pinnedOf(threadKey).filter((one) => one !== id);
    },

    /** 「全部取下」：本轮自动挂的都撤掉并加进否决名单，免得下一秒又被算回来。 */
    clearAll(threadKey: string): void {
      const auto = this.pinnedOf(threadKey);
      if (auto.length === 0) return;
      this.autoBlockedByThread[threadKey] = [
        ...new Set([...(this.autoBlockedByThread[threadKey] ?? []), ...auto])
      ];
      const agent = useAgentStore();
      agent.skillPathsByThread[threadKey] = agent
        .skillPathsOf(threadKey)
        .filter((id) => !auto.includes(id));
      this.autoPinnedByThread[threadKey] = [];
      this.picksByThread[threadKey] = [];
      this.autoPausedByThread[threadKey] = true;
    },

    /**
     * 单枚取下的旧入口**已撤**（2026-11-10）：技能卡改成整库可选之后，「挂上」与「取下」
     * 都由 `useAgentStore.toggleSkillForThread` 一句话办——它同样会走 `noteManual` 记否决。
     * 留两个方法做同一件事，迟早出现「卡片上取下了，技能库页还显示挂着」那种两套说法。
     */

    /** 重新给自动识别一次机会：解暂停 + 清掉本线程的否决名单（用户手动挂入的技能不动）。 */
    resetBlocked(threadKey: string): void {
      delete this.autoBlockedByThread[threadKey];
      delete this.autoPausedByThread[threadKey];
      this.sync(threadKey);
    }
  }
});

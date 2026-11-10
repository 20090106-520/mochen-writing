import { defineStore } from "pinia";
import { skillDirNameOf, type SkillAuthorDraft } from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";

/**
 * 「自己写技能」的渲染层状态（2026-11-10 用户裁定：
 * 「可以自己创建技能，然后自己根据需要的技能自己调用」）。
 *
 * 【为什么必须是一条写盘通路，而不是只生成兑换码】
 * 兑换码是发给别人的东西；自己写、自己用，最顺的路径是**填完就落盘**。
 * 这里填名字、说明、阶段、正文，落成与手放/市场装完全同形的
 * `<全局 skills>/<dirName>/SKILL.md`，之后走同一套 `scanSkills` 读出来。
 * frontmatter 由 contracts 的 `composeSkillMd` 拼——用户不该为了写个技能手写 YAML。
 *
 * 【删除也在这里】
 * 网上装的、自己写的都不在内置市场清单里，市场那条卸载通道拒删它们，
 * 不给删除入口就是「装得进来、删不掉」。删的判据在主进程：目录里必须真有 SKILL.md。
 */
export interface AuthorDraftState {
  dirName: string;
  displayName: string;
  description: string;
  stages: string;
  appliesTo: string;
  body: string;
  overwrite: boolean;
}

/** 一份空草稿。正文给一段骨架——不是模板技能，是让人知道「该写什么」的最小提示。 */
const EMPTY_DRAFT: AuthorDraftState = {
  dirName: "",
  displayName: "",
  description: "",
  stages: "",
  appliesTo: "",
  body: "",
  overwrite: false
};

export const useSkillAuthorStore = defineStore("skillAuthor", {
  state: () => ({
    open: false,
    draft: { ...EMPTY_DRAFT } as AuthorDraftState,
    busy: false,
    notice: "",
    ok: false,
    /** 正在删的目录名。 */
    removing: "",
    /** 已落盘的那一份（保存成功后显示「刚写好的是哪个目录」）。 */
    lastDirName: ""
  }),
  getters: {
    /**
     * 目录名：用户没填就按技能名生成（同一个名字永远同一个目录，改主意可以自己填）。
     * 判定用 contracts 的 `skillDirNameOf`，与主进程、与网上装的那条完全同一份。
     */
    effectiveDirName(state): string {
      const typed = state.draft.dirName.trim();
      return typed !== "" ? typed : skillDirNameOf(state.draft.displayName.trim() || "skill");
    },
    /**
     * 「我手上的技能」：全局来源那一份（书内技能属于这本书，不在这一屏管）。
     * 直接读 agent store 那张表——它已经是盘上实况，再打一次 IPC 就是第二份判据。
     */
    ownedSkills() {
      const agent = useAgentStore();
      return agent.skills.filter((one) => one.source === "global");
    }
  },
  actions: {
    toggle(): void {
      this.open = !this.open;
      this.notice = "";
    },
    resetDraft(): void {
      this.draft = { ...EMPTY_DRAFT };
      this.notice = "";
      this.ok = false;
    },
    building(): SkillAuthorDraft {
      const split = (text: string): string[] =>
        text
          .split(/[、,，\s]+/)
          .map((one) => one.trim())
          .filter((one) => one !== "")
          .slice(0, 8);
      return {
        dirName: this.effectiveDirName,
        displayName: this.draft.displayName.trim(),
        description: this.draft.description.trim(),
        stages: split(this.draft.stages),
        appliesTo: split(this.draft.appliesTo),
        body: this.draft.body,
        overwrite: this.draft.overwrite
      };
    },
    async save(): Promise<void> {
      if (this.busy) return;
      if (this.draft.displayName.trim() === "" || this.draft.body.trim() === "") {
        this.notice = "先填技能名和正文——空的技能装进去也帮不上忙。";
        this.ok = false;
        return;
      }
      this.busy = true;
      this.notice = "";
      this.ok = false;
      try {
        const result = await window.mochen.saveAuthoredSkill(this.building());
        this.notice = result.notice;
        this.ok = result.ok;
        if (result.ok) {
          this.lastDirName = result.dirName;
          // 存完就刷技能库：新技能要立刻出现在下面的列表里，否则「写好了但看不见」。
          await useAgentStore().refreshSkills();
        }
      } catch (err) {
        this.notice = `保存没有完成：${reasonOf(err)}`;
      } finally {
        this.busy = false;
      }
    },
    async remove(dirName: string): Promise<void> {
      if (this.removing !== "") return;
      this.removing = dirName;
      this.notice = "";
      try {
        const result = await window.mochen.removeSkill(dirName);
        this.notice = result.notice;
        this.ok = result.ok;
        if (result.ok) await useAgentStore().refreshSkills();
      } catch (err) {
        this.notice = `删除没有完成：${reasonOf(err)}`;
      } finally {
        this.removing = "";
      }
    }
  }
});

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

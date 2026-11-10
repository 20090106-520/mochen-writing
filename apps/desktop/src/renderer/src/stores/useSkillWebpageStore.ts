import { defineStore } from "pinia";
import type { WebpageSkillResult } from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";

/**
 * 网页转技能的渲染层状态（2026-11-10 用户裁定「任意网页当技能」）。
 *
 * 【判定一律不在这一层】抓不抓得到、转成什么名、写到哪、同名怎么办，
 * 全由主进程判并在 `notice` 里给一句中文；这里只存结果。
 * 转成之后刷新技能库那张表，与 fetch/redeem 两个 store 同一口径。
 */
export const useSkillWebpageStore = defineStore("skillWebpage", {
  state: () => ({
    url: "",
    busy: false,
    /** 最近一次的结果句（成功与失败都是它，is-ok 由 ok 分）。 */
    result: "",
    ok: false,
    /** 最近一次成功的回执（预览转出来的技能名与目录名）。 */
    last: null as WebpageSkillResult | null
  }),
  actions: {
    async convert(): Promise<void> {
      if (this.busy) return;
      const typed = this.url.trim();
      if (typed === "") {
        this.ok = false;
        this.result = "先粘一条网页链接：文章、教程、方法论都行。";
        return;
      }
      this.busy = true;
      this.result = "";
      try {
        const result: WebpageSkillResult = await window.mochen.convertWebpageSkill(typed);
        this.ok = result.ok;
        this.result = result.notice;
        if (result.ok) {
          this.last = result;
          await useAgentStore().refreshSkills();
        }
      } catch (err) {
        this.ok = false;
        this.result = `转不成：${err instanceof Error ? err.message : String(err)}`;
      } finally {
        this.busy = false;
      }
    }
  }
});

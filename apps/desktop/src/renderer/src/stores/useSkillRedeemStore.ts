import { defineStore } from "pinia";
import { encodeSkillRedeemCode, type SkillRedeemPayload } from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";
import { useSkillMarketStore } from "./useSkillMarketStore";
import { copyText } from "../utils/clipboard";

/**
 * 技能兑换框的渲染层状态（2026-11-09 用户裁定：「兑换框添加技能」）。
 *
 * 【为什么码里带技能本身】
 * 本仓没有账号、没有服务端，也不打算为一个输入框造一套授权后端。所以兑换码是
 * **离线自包含**的：码里就是一份完整的 SKILL.md，解码/校验/落盘全在 contracts 与主进程，
 * 渲染层既不判「码对不对」，也不自己拼目录路径——它只把那串字递过去，再把主进程那句
 * 中文原样上屏。校验码只挡抄漏字符，不是防伪造签名，这个文件不假装它是。
 *
 * 【为什么同时有「生成」那一档】
 * 只给一个兑换输入框、却没有能生成码的地方，那就是个死框：用户手上一枚码也没有。
 * 生成端把用户自己写的 SKILL.md 编成码，别人粘进兑换框就能装到自己的全局技能目录里——
 * 于是「添加自定义技能」这条原本缺失的通路也一并补上了，且没引入第二条写盘路径。
 *
 * 兑换成功后**两张表都要刷**：技能库（agent.skills）与市场（market.entries）是两份独立
 * 的读盘结果，只刷一张会出现「提示装好了、列表里却没有」的假象（同 useSkillMarketStore）。
 */
export type RedeemMode = "redeem" | "create";

export interface RedeemDraft {
  dirName: string;
  displayName: string;
  description: string;
  skillMd: string;
}

/** 开箱可试的一枚真技能：点「填入示例码」→「兑换并添加」，技能库里会真的多一行。 */
export const EXAMPLE_REDEEM_SKILL: SkillRedeemPayload = {
  dirName: "redeem-demo-dialogue",
  displayName: "对话节奏把关（示例）",
  description: "示例技能：检查对话推进、抢话与节奏松紧，逐处给出改法。",
  skillMd: `---
name: 对话节奏把关（示例）
description: 示例技能：检查对话推进、抢话与节奏松紧，逐处给出改法。
stage: 正文
appliesTo: chapter
---

这是一枚用兑换码装进来的示例技能，用来验证「兑换 → 落盘 → 出现在技能库 → 挂入本轮」这条链路是通的。

工作时只看**对话**：找出抢话、一人连说三段以上、每句都带动作描写导致节奏拖沓、
以及冲突还没铺开就和好的地方。逐处写清「原文位置 + 为什么拖 + 怎么改」，
没有发现就明说没有，不要为凑数编问题。真要动稿就提交替换提案，等我批准后才落盘。
`
};

/**
 * 中文技能名 → 合法目录名。目录名守卫是 contracts 的 `MARKET_DIR_NAME_RE`
 * （只允许 ASCII 字母数字开头 + `.` `_` `-`），中文名过不了；这里补一段稳定的哈希尾巴，
 * 同名总得同名、不同名基本不会撞，用户也可以自己填一个更好记的目录名。
 */
export function redeemDirNameOf(name: string, custom = ""): string {
  const typed = custom.trim();
  if (typed !== "") return typed;
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  let hash = 2166136261;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${ascii || "custom"}-${(hash >>> 0).toString(36).slice(0, 6)}`;
}

export const useSkillRedeemStore = defineStore("skillRedeem", {
  state: () => ({
    open: false,
    mode: "redeem" as RedeemMode,
    code: "",
    busy: false,
    notice: "",
    ok: false,
    addedName: "",
    draft: { dirName: "", displayName: "", description: "", skillMd: "" } as RedeemDraft,
    generated: "",
    copied: false
  }),
  actions: {
    toggle(): void {
      this.open = !this.open;
      if (this.open) this.notice = "";
    },
    setMode(mode: RedeemMode): void {
      this.mode = mode;
      this.notice = "";
      this.copied = false;
    },
    /** 示例码由 contracts 的同一个编码函数生成——不是手抄一串谁也兑不出的假码。 */
    fillExample(): void {
      this.mode = "redeem";
      this.code = encodeSkillRedeemCode(EXAMPLE_REDEEM_SKILL);
      this.notice = "示例码已填好，点「兑换并添加」就会真的装进技能库。";
      this.ok = false;
    },
    /** 主判据全在主进程：这里只递码、只上屏那句中文结果。 */
    async redeem(): Promise<void> {
      const code = this.code.trim();
      if (code === "" || this.busy) return;
      this.busy = true;
      this.notice = "";
      this.ok = false;
      try {
        const result = await window.mochen.redeemSkill(code);
        this.notice = result.notice;
        this.ok = result.ok;
        this.addedName = result.displayName;
        if (result.ok) {
          this.code = "";
          await useAgentStore().refreshSkills();
          await useSkillMarketStore().refresh();
        }
      } catch (err) {
        this.notice = `兑换没有完成：${reasonOf(err)}`;
      } finally {
        this.busy = false;
      }
    },
    /** 生成端：把一份 SKILL.md 打包成别人能兑的码。不写盘、不出网。 */
    generate(): void {
      const name = this.draft.displayName.trim();
      const skillMd = this.draft.skillMd.trim();
      if (name === "" || skillMd === "") {
        this.notice = "先填技能名，再把 SKILL.md 全文粘进下面的框。";
        this.generated = "";
        return;
      }
      try {
        this.generated = encodeSkillRedeemCode({
          dirName: redeemDirNameOf(name, this.draft.dirName),
          displayName: name,
          description: this.draft.description.trim() || name,
          skillMd
        });
        this.notice = "兑换码生成好了：复制发给别人，或切回「兑换」自己试一遍。";
        this.copied = false;
      } catch (err) {
        this.generated = "";
        this.notice = `生成失败：${reasonOf(err)}`;
      }
    },
    async copyGenerated(): Promise<void> {
      // 写剪贴板全仓只有 utils/clipboard 那一份真身（§173）：成没成都有一句人话，
      // 这里不自己碰平台 API，也不假装复制成功。
      const done = await copyText(this.generated);
      this.copied = done;
      this.notice = done
        ? "兑换码已复制，粘给对方就能用。"
        : "复制没成功：剪贴板没给权限或码是空的。可以手动全选下面那串码。";
    }
  }
});

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

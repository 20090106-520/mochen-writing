/// <reference types="node" />
/**
 * 自动识别 / 自动挂入的**人工干预闭环**（2026-11-09 真机复现后补）。
 *
 * 起因：点「全部取下」后提示行确实消失了，但再敲一个字又自动挂回一枚。原因是 clearAll
 * 只把「当时挂着的那几枚」记进否决名单，榜单第 4 名顺位顶上来就绕过了按钮上
 * 「别再自动挂回来」那句承诺。用户看到的是「点了没用」。
 *
 * 这里不 mock 判据：用真 agent / book store + 真 contracts + 真 rankSkills 跑一遍，
 * 钉住「撤销必须显性」这条边界。纯函数那半边另有 utils/skill-auto.test.ts。
 */
import { describe, expect, it } from "vitest";
import type { SkillRef } from "@mochen/contracts";
import { CH, listSkills, openChapter, setupAgentFixture } from "./agent-store-fixture";
import { useAgentStore } from "./useAgentStore";
import { useAutoSkillStore } from "./useAutoSkillStore";

setupAgentFixture();

function ref(dirName: string): SkillRef {
  return {
    id: `global:${dirName}`,
    source: "global",
    dirName,
    displayName: dirName,
    description: `${dirName}的说明`,
    stages: ["正文"],
    appliesTo: ["chapter"],
    relPath: `${dirName}/SKILL.md`
  };
}

const A = "global:skill-a";
const B = "global:skill-b";

/** 打开书 + 铺一张两枚都命中「正文 / chapter」的技能表，让 refreshSkills 走完整条 sync。
 *  光 openChapter 不会列技能表（真机上也是 refreshSkills 才列），漏掉这一步整组用例
 *  都会对着空表跑，绿灯比红光更坏。 */
async function ready() {
  listSkills.mockImplementation(async () => [ref("skill-a"), ref("skill-b")]);
  await openChapter();
  const agent = useAgentStore();
  await agent.refreshSkills();
  return agent;
}

describe("useAutoSkillStore · 撤销自动挂入必须是显性的", () => {
  it("识别到就挂进本轮上下文，写的是 startTurn 也读的那份 skillPaths", async () => {
    const agent = await ready();
    expect(agent.skillPathsOf(CH)).toEqual([A, B]);
    expect(useAutoSkillStore().pinnedOf(CH)).toEqual([A, B]);
  });

  it("全部取下后，再敲字也不会换个候选绕回来", async () => {
    const agent = await ready();
    const auto = useAutoSkillStore();
    auto.clearAll(CH);
    expect(agent.skillPathsOf(CH)).toEqual([]);
    expect(auto.autoPausedByThread[CH]).toBe(true);

    // 这一段就是真机上重现「点了没用」的那一下：草稿变了，sync 仍被暂停闸挡住。
    agent.setDraft(CH, "再帮我看看这段对话节奏");
    expect(agent.skillPathsOf(CH)).toEqual([]);
    expect(auto.pinnedOf(CH)).toEqual([]);
  });

  it("恢复自动推荐是唯一解封口：解暂停 + 清否决，技能才重新上榜", async () => {
    const agent = await ready();
    const auto = useAutoSkillStore();
    auto.clearAll(CH);
    expect(auto.autoBlockedByThread[CH]).toEqual([A, B]);

    auto.resetBlocked(CH);
    expect(auto.autoPausedByThread[CH]).toBeUndefined();
    expect(auto.autoBlockedByThread[CH]).toBeUndefined();
    expect(agent.skillPathsOf(CH)).toEqual([A, B]);
  });

  it("关总开关再开只解暂停，不冲掉手动否决：要真恢复还得点「恢复自动推荐」", async () => {
    const agent = await ready();
    const auto = useAutoSkillStore();
    auto.clearAll(CH);
    auto.setEnabled(false);
    auto.setEnabled(true);
    expect(auto.enabled).toBe(true);
    expect(auto.autoPausedByThread[CH]).toBeUndefined();
    // 否决名单是用户一条条下的令，不该被一次开关顺手抹掉。
    expect(auto.autoBlockedByThread[CH]).toEqual([A, B]);
    expect(agent.skillPathsOf(CH)).toEqual([]);
    auto.resetBlocked(CH);
    expect(agent.skillPathsOf(CH)).toEqual([A, B]);
  });

  it("单枚取下只否决那一枚，不扩大成整条暂停（另一枚照常留在上下文里）", async () => {
    const agent = await ready();
    const auto = useAutoSkillStore();
    // 走产品真身：技能卡上「再点一下」就是这一句。
    agent.toggleSkillForThread(CH, A);
    expect(auto.autoPausedByThread[CH]).toBeUndefined();
    expect(agent.skillPathsOf(CH)).toEqual([B]);

    agent.setDraft(CH, "继续写");
    expect(agent.skillPathsOf(CH)).toEqual([B]);
    expect(auto.pinnedOf(CH)).toEqual([B]);
  });
});

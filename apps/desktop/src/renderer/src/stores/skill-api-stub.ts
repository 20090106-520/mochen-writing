import type { RendererApi } from "@mochen/contracts";

/**
 * 技能相关新通道的**测试占位实现**（2026-11-10）。
 *
 * 【为什么抽成一份而不是每个测试各写一遍】
 * `RendererApi` 加了五条通道（列远端源 / 取预览 / 装远端 / 存自写 / 删），
 * 而渲染层的 store 测试里有八处「整份 API 的假对象」。五条各写一遍就是 8 × 18 行，
 * 其中 `useProviderStore.test.ts` 本来只剩 4 行余量，直接顶破 800 行预算——
 * 预算被顶破之后最容易被顺手放宽，那是比重写一遍更坏的结果。
 *
 * 【这里的返回值一律「什么都没做成功」】
 * 这些用例验的是别的东西（书、模型档案、自动保存），技能通道只要**不抛**、形状对就够。
 * 真验技能通路的用例在 `useSkillFetchStore.test.ts` 与主进程那两份里。
 */
export const SKILL_API_STUBS = {
  listRemoteSkills: async () => ({ entries: [], listed: false, notice: "", source: "" }),
  previewRemoteSkill: async () => ({
    ok: false,
    notice: "",
    dirName: "",
    displayName: "",
    description: "",
    stages: [],
    appliesTo: [],
    skillMd: "",
    synthesized: false,
    bytes: 0,
    fetchedFrom: ""
  }),
  installRemoteSkill: async () => ({ ok: false, notice: "", dirName: "", displayName: "" }),
  convertWebpageSkill: async () => ({
    ok: false,
    notice: "",
    dirName: "",
    displayName: "",
    bytes: 0,
    truncated: false,
    sourceUrl: ""
  }),
  saveAuthoredSkill: async () => ({ ok: false, notice: "", dirName: "", displayName: "" }),
  removeSkill: async () => ({ ok: false, notice: "", dirName: "", displayName: "" })
} satisfies Pick<
  RendererApi,
  | "listRemoteSkills"
  | "previewRemoteSkill"
  | "installRemoteSkill"
  | "convertWebpageSkill"
  | "saveAuthoredSkill"
  | "removeSkill"
>;

import { describe, expect, it } from "vitest";
import { SWITCH_NO_ACTIVE_CONNECTION, modelSwitchDraft } from "./model-switch";

/**
 * 「切模型」那条线的**线格式**守卫（2026-10-08 批次 5-㊺）。
 *
 * 这个纯函数存在的唯一理由：主进程 `upsertProfile` 收的是 `ProfileDraft`
 * （`{model, connectionId}`），而渲染层曾经把**裸模型名**当草稿发下去，
 * zod 当场拒收 ⇒ 真机点名单任何一行都「没反应」。WHY 全写在 model-switch.ts 的文件头。
 *
 * 这里钉的是**形状与理由**，不钉任何具体供应商/模型/连接 id：
 * 名单型判据一旦换名单就静默作废（这是本仓踩过的坑），所以断言只认前缀与字段。
 */
describe("modelSwitchDraft · 出站草稿的形状", () => {
  it("模型名 + 启用中那条连接 ⇒ { model, connectionId } 两个字段，不多不少", () => {
    const out = modelSwitchDraft("c-agnes", "agnes-2.0-flash");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(Object.keys(out.draft).sort()).toEqual(["connectionId", "model"]);
      expect(out.draft).toEqual({
        model: "agnes-2.0-flash",
        connectionId: "c-agnes"
      });
    }
  });

  it("模型名去掉首尾空白：出站的是 trim 后的那个", () => {
    const out = modelSwitchDraft("c-agnes", "  agnes-2.0-flash\n");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.model).toBe("agnes-2.0-flash");
  });

  it("连接 id 原样出站：判据与名单都在调用方，这里不做第二套归一", () => {
    const out = modelSwitchDraft("  c-agnes  ", "m");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.connectionId).toBe("  c-agnes  ");
  });

  it("反向钉：拿不到连接时**绝不**返回草稿——空 connectionId 会被 schema 的 min(1) 拒掉", () => {
    const out = modelSwitchDraft("", "agnes-2.0-flash");
    expect(out.ok).toBe(false);
    // 关键不是「返回了假」，是**压根没有 draft 这个键**：
    // 一旦有人写成 { ok: false, draft: {...} }，调用方一个 `!outcome.ok` 就把它吞了。
    expect(out).not.toHaveProperty("draft");
    expect(Object.keys(out).sort()).toEqual(["ok", "reason"]);
  });

  it("全空白连接 id 与空串同判（.trim()），不因为一个空格就放行", () => {
    expect(modelSwitchDraft("   ", "m").ok).toBe(false);
    expect(modelSwitchDraft("\t\n", "m").ok).toBe(false);
  });
});

describe("modelSwitchDraft · 失败理由必须是看得见的人话", () => {
  it("理由非空、且是引用得到的那一份常量（文案不在调用方各写一句）", () => {
    const out = modelSwitchDraft("", "m");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe(SWITCH_NO_ACTIVE_CONNECTION);
      expect(out.reason.trim()).not.toBe("");
    }
  });

  it("理由说的是「启用状态漂移」，不是主进程拉名单失败那句话——两件事不许共用一句", () => {
    // 主进程 provider-models.ts 的 ③ 分支：「当前没有启用中的模型，先在模型设置里启用一个。」
    // 那是「拉名单时就没有启用中的模型」；这一条是「名单拉出来之后启用状态变了」。
    expect(SWITCH_NO_ACTIVE_CONNECTION).not.toContain("当前没有启用中的模型");
    expect(SWITCH_NO_ACTIVE_CONNECTION).toContain("启用");
  });

  it("理由给出出路，不只是一句否定（用户拿到后知道下一步做什么）", () => {
    expect(SWITCH_NO_ACTIVE_CONNECTION).toContain("再点开一次");
  });
});

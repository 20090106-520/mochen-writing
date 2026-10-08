import type { ProfileDraft } from "@mochen/contracts";

/**
 * 「这一轮切到哪个模型」那条线上的**唯一**线格式判定（2026-10-08 批次 5-㊺）。
 *
 * ## 这条判定为什么要有
 *
 * 修的是一个真机撞出来的死功能：**点模型 chip、点名单里的一行，什么都没发生。**
 * 根因不在主进程，在渲染层传参的形状：
 *
 *   · 主进程 `provider-settings.ts` 的 `upsertProfile` 收的是 `ProfileDraft`
 *     （zod `profileDraftSchema` = `{ model: string; connectionId: string }`）；
 *   · 渲染层 `CenterColumn.chooseModel` 却把**裸模型名**当草稿发下去。
 *
 * 真机实测（.mochen-tmp/p537/p539e）：
 * `profileUpsert("agnes-2.0-flash")` ⇒ `Error: Invalid input`（schema 拒非对象），
 * 传对象 `{model, connectionId}` 才走得到连接查找那一步。
 * 抛错被 store 的 catch 吞进 `provider.error`，而那个字段**只在模型设置页渲染**，
 * 下拉浮层里一个字都没有 ⇒ 点了没反应、也不给理由。
 *
 * 「添加模型」那条对话框通路一直是好的（`ModelProfileDialog` 传的就是对象），
 * 所以现象是「能添加、不能切换」——这类半通不通最容易让人以为是自己点错了。
 *
 * ## 为什么住在 `.ts` 里
 *
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`.vue` 的 `<script setup>` 根本不进类型程序
 * ⇒ `provider.select(name)` 把 `string` 传给收 `ProfileDraft` 的函数，**tsc 全绿**。
 * 旧守卫只钉了 `toContain("provider.select(")`（方法名在就算过），参数形状压根没看。
 * 判定下沉到这里之后，形状由 tsc 守，接线由 `model-select-wiring.test.ts` 钉死参数。
 */

/**
 * 拿不到「启用中那条连接」时的理由。
 *
 * 这**不是**主进程那句「当前没有启用中的模型」的复述——主进程那句话回答的是
 * 「拉名单时没有启用中的模型」（`provider-models.ts` 的 ③ 分支），发生在点行之前；
 * 这一条回答的是「名单拉出来之后、点行之前，启用状态变了」，是渲染层自己看得见的漂移。
 * 两件事、两句话，分开写。
 */
export const SWITCH_NO_ACTIVE_CONNECTION =
  "这份模型名单是按当时的启用状态拉出来的，现在的启用状态已经变了。关掉这个浮层再点开一次重拉。";

export type ModelSwitchOutcome = { ok: true; draft: ProfileDraft } | { ok: false; reason: string };

/**
 * 模型名 + 当前启用的那条连接 ⇒ 出站草稿。
 *
 * **连接从哪来**：名单本身是按「启用中那条模型所在的连接」拉的
 * （主进程 `provider-models.ts`：没给 query 就走 `view.profiles.find(enabled).connectionId`）。
 * 所以下拉里列出来的每一个模型都属于那一条连接，切过去也该写回那一条——
 * 这里不是在猜，它复述的就是名单的来路。
 *
 * **不本地拦的其余情形**：地址/密钥对不对、连接还在不在，那都是主进程 know 的事，
 * 让它抛它自己那句话（store 单测里「不本地拦」是同一条规矩）。这里只拦
 * `connectionId` 为空那一种——空串会被 schema 的 `min(1)` 拒掉，而主进程给出的
 * 理由会是「connectionId 不能为空」这种用户读不懂的话；这一条得由看得见状态的一方说人话。
 */
export function modelSwitchDraft(connectionId: string, model: string): ModelSwitchOutcome {
  if (connectionId.trim() === "") return { ok: false, reason: SWITCH_NO_ACTIVE_CONNECTION };
  return { ok: true, draft: { model: model.trim(), connectionId } };
}

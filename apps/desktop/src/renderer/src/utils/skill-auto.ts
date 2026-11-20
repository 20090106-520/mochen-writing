import { rankSkills, type SkillCandidate, type SkillPick, type SkillPickScene } from "./skill-pick";

/**
 * 技能自动识别 / 自动运用（2026-11-09 用户裁定）。
 *
 * 【与 skill-pick.ts 的分工】
 * `rankSkills` 是「什么该上榜、上几分、怎么排」的**唯一判据**，本文件一行都不重算：
 * 它只负责把那张榜翻译成「这一次要往上下文里加哪几枚、撤哪几枚」。
 * 打分、关键词、权重仍只有一份，自动与手动推荐看到的理由完全一致。
 *
 * 【三条不能越过的线】
 * 1. **只增删自己加的**：`autoPinned` 记着上一次由自动功能挂进去的 id，撤也只撤这些。
 *    用户亲手挂入的、书级默认的技能动一下都是替用户改主意。
 * 2. **手动取下就是否决**：用户把某枚自动技能取下后，它进 `blocked`，之后不再自动加回来
 *    （否则「取不掉」就是个假按钮）；用户再亲手挂回去才解除否决。
 * 3. **停用的硬闸照旧**：书级 `disabled` 里的技能连候选都不进，自动识别不能绕过停用。
 *
 * 上一版 skill-pick.ts 的文件头写着「只建议、不自动挂入」，那是当时的裁定；
 * 现在用户明确要自动运用，所以判据复用、装配动作放在 store 里，这里仍是纯函数、可单测。
 */

/**
 * 一轮最多自动挂几枚。挂太多会把上下文额度吃光，也让人看不清到底用了什么。
 *
 * 【它是「至少收几条」而不是「最多收几条」】2026-11-12：`rankSkills` 改成同分不切档之后，
 * 这个数字只约束**不同分档**的条目数——截到第 3 条时如果第 4 条与它同分，会一并收下
 * （硬上限仍是 `SKILL_PATHS_MAX`）。原先一律切 3，而四条出厂审校技能得分完全相同，
 * 于是永远按 id 字典序砍掉 `check-style`：去 AI 味那条技能从来没被自动挂上过。
 */
export const AUTO_SKILL_LIMIT = 3;

export interface AutoSkillPlanArgs {
  candidates: readonly SkillCandidate[];
  scene: SkillPickScene;
  /** 当前这一轮已挂入的全部 id（手动 + 书级默认 + 上次自动的）。 */
  pinned: readonly string[];
  /** 上一次由自动功能挂进去的 id。 */
  autoPinned: readonly string[];
  /** 用户手动取下过的 id：本线程的否决名单。 */
  blocked: readonly string[];
  /** 书级停用清单。 */
  disabled: readonly string[];
  limit?: number;
}

export interface AutoSkillPlan {
  /** 这一轮上榜的技能（带中文理由），界面直接摆出来，不自己重排。 */
  picks: SkillPick[];
  /** 需要新挂进上下文的 id。 */
  add: string[];
  /** 需要撤掉的 id——只可能来自上一次自动挂入的那些。 */
  drop: string[];
  /** 本次之后由自动功能持有的 id（供下一次 sync 认领）。 */
  autoPinned: string[];
  /** 本次之后这一轮应有的完整清单。 */
  desired: string[];
}

/**
 * 把「当前现场」算成一次装配计划。纯函数：同输入永远同输出，不改任何入参。
 *
 * 榜单里**不排除上次自动挂入的**：它们仍要参与排名，否则一次 sync 之后
 * 「还该不该留着它」就没有依据，`drop` 也无从算起。只排除用户亲手挂入的那几枚，
 * 那是「已经在了，不用再推荐一遍」。
 */
export function autoSkillPlanOf(args: AutoSkillPlanArgs): AutoSkillPlan {
  const limit = Math.max(0, args.limit ?? AUTO_SKILL_LIMIT);
  const previous = [...args.autoPinned];
  const prevSet = new Set(previous);
  const blocked = new Set(args.blocked);
  const disabled = new Set(args.disabled);

  const manual = args.pinned.filter((id) => !prevSet.has(id));
  const manualSet = new Set(manual);
  const available = args.candidates.filter(
    (candidate) => !blocked.has(candidate.id) && !disabled.has(candidate.id)
  );
  // keepTies：这里的 limit 是产品默认值（「别一次挂太多」），不是谁的明确要求。
  // 同分时按 id 截断会静默淘汰一条——出厂四条审校技能得分完全相同，
  // 被淘汰的正好是 `check-style`（去 AI 味）。所以让 `rankSkills` 同分不切档。
  const picks = rankSkills(available, { ...args.scene, pinned: manual }, limit, manual, true);
  const topIds = picks.map((pick) => pick.id);
  const topSet = new Set(topIds);
  const pinnedSet = new Set(args.pinned);

  const add = topIds.filter((id) => !pinnedSet.has(id) && !manualSet.has(id));
  const drop = previous.filter((id) => !topSet.has(id) || blocked.has(id) || disabled.has(id));
  const keptAuto = previous.filter((id) => !drop.includes(id));

  return {
    picks,
    add,
    drop,
    autoPinned: [...keptAuto, ...add.filter((id) => !keptAuto.includes(id))],
    desired: [...manual, ...keptAuto, ...add.filter((id) => !keptAuto.includes(id))]
  };
}

/** 两个 id 清单是否同集合（顺序不影响上下文装配，但不必为此反复写响应式状态）。 */
export function sameSkillIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((id) => set.has(id));
}

/**
 * 这一轮要不要把榜首的**正文**也递过去（2026-11-17）。
 *
 * 自动挂入只摆清单行，模型仍要花一轮 `use_skill` 才读得到方法。既然自动识别已经挑出了
 * 「这一轮就该用它」，那一轮往返是白烧的。但只有**唯一榜首**才值得预读：
 * 并列第一意味着两条同样该用，挑谁都是替模型掷骰子；空榜则根本没有可预读的对象。
 * 只剩一条时它就是唯一榜首，照预读——不在这里另编一个「至少要多少分」的门槛，
 * 谁该上榜已经由 `rankSkills` 的「只留正分」说过一次。
 *
 * 判据是确定性的、不新编分数阈值：`rankSkills` 已按 score 降序排好，这里只看前两名是否同分。
 * 返回空串 = 不预读（与「没传字段」同义）。
 */
export function preloadSkillIdOf(picks: readonly SkillPick[]): string {
  const first = picks[0];
  if (first === undefined) return "";
  const second = picks[1];
  if (second !== undefined && second.score === first.score) return "";
  return first.id;
}

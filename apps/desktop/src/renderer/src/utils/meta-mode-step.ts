import {
  PERMISSION_LABELS,
  WORK_MODE_LABELS,
  findProfile,
  workModeOf,
  type BookMeta,
  type PermissionMode,
  type WorkMode
} from "@mochen/contracts";
import { activeStageOf } from "./composer-context";

/**
 * book.json 那四枚可写档位的**判定层**（权限档 / 工作模式 / 阶段 / 档案）。
 *
 * **为什么单独一处**：这四段在 store 里逐条抄过同一件事——「没开书 → 拦」「已经是这一档 → 拦并报档名」
 * 「这一枚压根不存在 / 不在列表里 → 拦」「否则才落盘」。抄四份的代价不是难看，是第五份迟早漏掉一条边界，
 * 而其中「先写后回读」那条坑（响应式代理与裸对象是同一个 target 两套拦截）在 9625c52 真实发生过。
 * 判定抽成纯函数后每条边界各有一处断言（`meta-mode-step.test.ts`），store 那边只剩
 * 「拿判定 → 走 `persistMeta` 那唯一通路 → 把话写上屏」。
 *
 * 措辞仍与原实现一字不差：那些句子由 `useBookStore.test.ts` 逐句钉着，这里换字会当场红。
 */

/** 一次档位改动的两种落点：要么当场说清楚为什么不改，要么给出要写的那几格。 */
export type MetaStep =
  | { readonly kind: "refuse"; readonly notice: string }
  | {
      readonly kind: "persist";
      /** 交给 `persistMeta` 的补丁：只带这一档那**一格**，别的全不碰。 */
      readonly patch: Partial<BookMeta>;
      /** 失败前缀：`persistMeta` 会拼成「{failPrefix}：{理由}」上屏。 */
      readonly failPrefix: string;
      /**
       * 落盘成功后那句话。
       * 这里报的是**这次要切去的那一档**——`persistMeta` 成功即意味着 `meta` 就是这份补丁盖上去的结果，
       * 所以不必（也不该）再回读一次来拼句子；原实现读的是 `this.meta` 里刚被赋值那一格，取到同一个值。
       */
      readonly doneNotice: string;
    };

/** 没开书时那一句：四档各有各的说法，因为「为什么改不了」各不相同。 */
function noBook(notice: string): MetaStep {
  return { kind: "refuse", notice };
}

export function permissionModeStep(meta: BookMeta | null, mode: PermissionMode): MetaStep {
  if (meta === null) return noBook("还没打开作品目录，权限档改不了。");
  if (meta.permissionMode === mode) {
    return noBook(`已经是这一档了：「${PERMISSION_LABELS[mode]}」。`);
  }
  return {
    kind: "persist",
    patch: { permissionMode: mode },
    failPrefix: "权限档没改过来",
    doneNotice: `权限档已切到「${PERMISSION_LABELS[mode]}」，下一次审批就用这一档判断。`
  };
}

export function workModeStep(meta: BookMeta | null, mode: WorkMode): MetaStep {
  if (meta === null) {
    return noBook("还没打开作品目录，工作模式改不了（它是这本书的设置）。");
  }
  // 缺省读法只有 `workModeOf` 一份：老书没有这一格 ⇒ act，也就是改动前的行为。
  if (workModeOf(meta) === mode) {
    return noBook(`已经是这一档了：「${WORK_MODE_LABELS[mode]}」。`);
  }
  return {
    kind: "persist",
    patch: { workMode: mode },
    failPrefix: "工作模式没改过来",
    doneNotice:
      mode === "plan"
        ? `工作模式已切到「${WORK_MODE_LABELS.plan}」：它只讲打算，提案批了也不落盘。`
        : `工作模式已切到「${WORK_MODE_LABELS.act}」：提案经你批准就会写入磁盘。`
  };
}

export function activeStageStep(meta: BookMeta | null, stageId: string): MetaStep {
  if (meta === null) return noBook("还没打开作品目录，阶段改不了。");
  const stage = meta.stages.find((one) => one.id === stageId);
  if (stage === undefined) {
    // 主进程的 bookSchema 会拒「activeStage 不在 stages 中」；先在渲染层说明白，省一次无谓写盘。
    return noBook("这一档不在本书的阶段列表里，没去改。");
  }
  if (meta.activeStage === stageId) {
    // 这一支里 stageId 就是当前档 ⇒ 走与别处同一条 `activeStageOf` 通路取档名，不抄第二份 find。
    return noBook(`已经是这个阶段了：「${activeStageOf(meta)?.name ?? "无"}」。`);
  }
  // 上一行已保证这一档在列表里，`?? "无"` 只是与 `stageLabelOf` 同源的兜底字，走不到。
  return {
    kind: "persist",
    patch: { activeStage: stageId },
    failPrefix: "阶段没改过来",
    doneNotice: `阶段已切到「${stage.name}」，下一轮对话按这一档装配上下文。`
  };
}

export function activeProfileStep(meta: BookMeta | null, profileId: string): MetaStep {
  if (meta === null) return noBook("还没打开作品目录，档案改不了。");
  const profile = findProfile(profileId);
  if (profile === null) return noBook(`没有这一枚档案：${profileId}。`);
  if (meta.activeProfile === profile.id) {
    return noBook(`已经是「${profile.name}」这一枚档案了。`);
  }
  return {
    kind: "persist",
    patch: { activeProfile: profile.id },
    failPrefix: "档案没换过来",
    doneNotice: `已切到「${profile.name}」。下一轮对话按它的提示词与上下文包装配。`
  };
}

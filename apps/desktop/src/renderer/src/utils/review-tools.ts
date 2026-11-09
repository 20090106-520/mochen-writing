import type { IconName } from "../types/icons";

/**
 * 右栏「审稿」下拉里的五项（P0-5）。
 *
 * 分组之前它们是八枚平铺按钮里的一半；收敛之后**入口一个都没少**，只是从平铺挪进了这颗
 * 「审稿」按钮下面。清单只住这一处：菜单行、图标、悬停那句都从这里读，
 * 组件与测试各抄一份的话，改一处就会有一处说旧话。
 */
export type ReviewToolId = "slop" | "review" | "timeline" | "cast" | "foreshadow";

export interface ReviewTool {
  id: ReviewToolId;
  /** 菜单行上的字（读屏与悬停也用这一句，不再另写一份）。 */
  label: string;
  icon: IconName;
  /** 说清它查什么，不是「打开面板」这种没有信息的话。 */
  hint: string;
}

export const REVIEW_TOOLS: readonly ReviewTool[] = [
  {
    id: "slop",
    label: "去 AI 味",
    icon: "wand",
    hint: "查这一篇里像 AI 写的句子，并给改写建议"
  },
  {
    id: "review",
    label: "审稿打分",
    icon: "chart",
    hint: "按维度给这一篇打分，指出最该改的地方"
  },
  {
    id: "timeline",
    label: "时间线核对",
    icon: "arrow-up",
    hint: "核对正文里的时间与事件顺序对不对得上"
  },
  {
    id: "cast",
    label: "人物设定核对",
    icon: "user",
    hint: "核对正文里的人物与设定表有没有冲突"
  },
  {
    id: "foreshadow",
    label: "伏笔台账",
    icon: "pin",
    hint: "看埋下的伏笔回收了没有，别漏在结局外"
  }
] as const;

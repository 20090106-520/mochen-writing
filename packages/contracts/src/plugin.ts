/**
 * 插件（2026-10-07 批次 5-㉚）：主进程那一侧已经能挂载并叠加工具，这一层是给渲染层的**只读清单 + 停用/卸载**。
 *
 * 【为什么插件的「已装」与技能的「已装」不一样】
 * 技能装上就是一份 `SKILL.md`，装卸是纯文件操作；插件装上是**一段已经跑起来的代码**
 * （它的工具此刻就在模型看得见的工具表里）。所以插件多出一个技能没有的档位：**停用**——
 * 文件还在，但那一轮它不该被调得到。把它和「卸载」混成一个动作，
 * 用户想「暂时别用它」就只能删文件。
 *
 * 【停用怎么做到「模型真的调不到」】
 * 不是隐藏按钮，是内核不挂它：停用清单由主进程在 `mountAll` **之前**应用，
 * 于是它的工具压根不进 `extraSpecsOf`，模型看不见它，派发也过不了 `isCallableTool`。
 * 这比「还在清单里、只是回一个失败」强——后者会让模型反复尝试一个注定失败的工具。
 */
import { z } from "zod";

/** 一个已装插件在界面上的样子。字段刻意少于主进程那份：界面不需要 mount 的内部细节。 */
export const pluginRefSchema = z.object({
  /** 落盘目录名（安装名）。停用/卸载只收它，主进程自己拼路径。 */
  dirName: z.string().min(1),
  /** 插件自报的名字。与安装名可能不同（类形态尤其明显：自报名是类名）。 */
  title: z.string().min(1),
  /** 它注册进来的工具名，界面拿它告诉用户「停用之后会少哪几个能力」。 */
  toolNames: z.array(z.string()),
  /** 装不装得上（内核认定）。false 时 `reason` 有话要说，`toolNames` 必为空。 */
  ok: z.boolean(),
  /** 装不上的中文理由，一句。 */
  reason: z.string(),
  /**
   * 是不是内置随带的。
   * 界面上要区别对待：内置的停用可以一键恢复，用户自己装的不然——
   * 这是「恢复出厂」那条用户自己能走通的路。
   */
  builtin: z.boolean(),
  /** 内置版本（仅内置有意义；用户自己装的是 0）。 */
  version: z.number().int().nonnegative(),
  /** 被停用了（文件还在，这一轮不挂）。 */
  disabled: z.boolean()
});
export type PluginRef = z.infer<typeof pluginRefSchema>;

/**
 * `plugins:list` 的返回。
 *
 * `listed` 与技能库同款：**空表**与**还没问过**要分得开。
 * 界面若把两者混为一谈，用户看到空列表会以为插件都坏了。
 */
export interface PluginListResult {
  entries: PluginRef[];
  listed: boolean;
}

/**
 * 停用/启用的入参。只收安装名（渲染层不许传路径，与技能市场同一条铁律）。
 * 用 `dirName` 这个名字而不是 `name`：插件自报名与安装名不是一回事。
 */
export const pluginDirNameSchema = z.string().min(1, "插件目录名不能是空的");

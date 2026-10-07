/**
 * 把插件工具**叠加**到智能体的工具表上（2026-10-07 批次 5-㉘）。
 *
 * 【为什么不写在 agent-service 里】那一写就多二十来行，
 * 而 agent-service.ts 本来就贴着 800 行的行数预算（824 > 800，门禁直接红）。
 * 拆出来还有个好处：这一层可以**单独单测**，不必拉起整个 agent 服务。
 *
 * 【叠加，不是替换】
 * 花名册那五个一个不少；插件的名字不许顶掉它们——
 * 顶掉的那份会在 agent-runtime 的 `extraSpecsOf` 里被丢掉（那里才有花名册的判定，
 * 这里是主进程侧，做不到「同值只留一份」）。
 * 没有插件时 `extraSpecs()` 返回空数组，这一层对外行为与插件之前逐字一致。
 */
import type { ChatToolSpec, ToolHost, ToolOutcome } from "@mochen/agent-runtime";

/** 插件运行时交给智能体的那一面（只两个动作：列规格、调用）。 */
export interface PluginTools {
  /** 交给模型的工具规格；没有插件就是空数组。 */
  extraSpecs(): ChatToolSpec[];
  /** 这个名字是不是插件的工具（决定 call 往哪边派）。 */
  has(name: string): boolean;
  /** 调一个插件工具。 */
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
}

export function withPlugins(base: ToolHost, plugins: PluginTools | undefined): ToolHost {
  if (plugins === undefined) return base;
  return {
    context: () => base.context(),
    extraSpecs: () => plugins.extraSpecs(),
    async call(name, args) {
      if (plugins.has(name)) return plugins.call(name, args);
      return base.call(name, args);
    }
  };
}

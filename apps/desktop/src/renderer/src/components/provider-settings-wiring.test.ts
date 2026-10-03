/**
 * 模型设置浮层的接线契约：错误文案的剥壳判定**不许住在组件里**。
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`tsconfig.web.json` 只收 `.ts`/`.d.ts`，
 * `vue-shim.d.ts` 把 `*.vue` 声明成 any ⇒ `.vue` 零类型检查、零运行时覆盖，
 * 所以「两处 catch 都过同一层剥壳」只能钉成读源码断言（同律先例：proposal-card-wiring.test.ts）。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

const dialog = "components/ProviderSettings.vue";

describe("ProviderSettings · 错误只经 presentableProviderError 一层", () => {
  it("读与保存两处 catch 都过剥壳，且组件里没有第二份剥壳逻辑", () => {
    const script = scriptSource(dialog);
    expect(script).toContain('from "../utils/provider-error"');
    // 2 = load 的 catch + save 的 catch。多出来一处就是有人在组件里另起炉灶。
    expect(script.match(/presentableProviderError\(/g)?.length).toBe(2);
    // 剥壳的判据（IPC 前缀、英文括注）一律不在这里造第二份。
    expect(script).not.toContain("Error invoking remote method");
  });

  it("错误那一行仍然由模板渲染 {{ error }}，不在模板里拼句子", () => {
    const markup = templateSource(dialog);
    expect(markup).toContain("{{ error }}");
    expect(markup).not.toContain("provider:get");
  });
});

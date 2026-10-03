/**
 * 模型设置那条通路上的错误文案契约：剥壳判定**不许住在组件里，也不许有第二份**。
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`tsconfig.web.json` 只收 `.ts`/`.d.ts`，
 * `vue-shim.d.ts` 把 `*.vue` 声明成 any ⇒ `.vue` 零类型检查、零运行时覆盖，
 * 所以只能钉成读源码断言（同律先例：proposal-card-wiring.test.ts）。
 * #104 之后这条通路多了第三个出口（模型名单的失败理由），三处 catch 合并进
 * useProviderStore 的一个 toReason——组件侧从「两处都过剥壳」变成「一处也不许过」，
 * 判据没变：中文理由的唯一真身永远只有一份实现。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const dialog = "components/ProviderSettings.vue";
const store = "stores/useProviderStore.ts";

describe("ProviderSettings · 错误只经 presentableProviderError 一层", () => {
  it("剥壳的唯一真身在 store：组件里零次，store 里恰好一处调用", () => {
    expect(scriptSource(dialog)).not.toContain("presentableProviderError");
    const owned = vueSource(store);
    expect(owned).toContain('from "../utils/provider-error"');
    expect(owned.match(/presentableProviderError\(/g)?.length).toBe(1);
  });

  it("IPC 前缀、英文括注这类判据不许在别处再造一份", () => {
    expect(scriptSource(dialog)).not.toContain("Error invoking remote method");
    expect(vueSource(store)).not.toContain("Error invoking remote method");
  });

  it("错误那一行仍由模板渲染，只是值从 store 来：不在模板里拼句子", () => {
    const markup = templateSource(dialog);
    expect(markup).toContain("{{ provider.error }}");
    expect(markup).not.toContain("provider:get");
  });
});

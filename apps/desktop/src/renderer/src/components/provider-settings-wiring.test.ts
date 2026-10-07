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

describe("ProviderSettings · 卡片面板的每一步都有真身（铁律：报不出函数名的控件不进 UI）", () => {
  it("「添加模型」与 ⋯ 菜单的编辑/删除各调一个真身，启停开关调 enableProfile", () => {
    const markup = templateSource(dialog);
    const script = scriptSource(dialog);
    // 添加入口按钮真挂着 openAdd；空态文案指路同一个入口，不是死胡同。
    expect(markup).toContain('@click="openAdd"');
    expect(markup).toContain("添加模型");
    // ⋯ 菜单两项：编辑连接（openEdit）与删除模型（removeProfile）。
    expect(markup).toContain('@click="openEdit(profile)"');
    expect(markup).toContain('@click="removeProfile(profile)"');
    expect(script).toContain("await provider.removeProfile(profile.id)");
    // 开关是 input checkbox 语义，change 上真有启停调用（互斥在主进程）。
    expect(markup).toMatch(/:checked="profile\.enabled"[\s\S]*?@change="toggle\(profile\)"/);
    expect(script).toContain("provider.enableProfile(profile.id, !profile.enabled)");
  });

  it("对话框只有一条活路：v-if 挂在 dialogMode 上，close/saved 都收回 null", () => {
    const markup = templateSource(dialog);
    expect(markup).toContain("<ModelProfileDialog");
    expect(markup).toMatch(/v-if="dialogMode !== null"[\s\S]*?@close="dialogMode = null"/);
    expect(markup).toMatch(/@saved="dialogMode = null"/);
  });

  it("面板不自己拉名单、不碰 provider:list-models（名单归输入卡的浮层与对话框）", () => {
    const markup = templateSource(dialog);
    expect(markup).not.toContain("loadModels");
    expect(markup).not.toContain("provider:list-models");
  });
});

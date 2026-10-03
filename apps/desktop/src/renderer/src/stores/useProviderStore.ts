import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { ModelListResult, ProviderDraft, ProviderView } from "@mochen/contracts";
import { presentableProviderError } from "../utils/provider-error";

function toReason(caught: unknown): string {
  return presentableProviderError(caught instanceof Error ? caught.message : String(caught));
}

/**
 * 模型配置在渲染层的唯一真身（#104）：输入区的「模型 ▾」、设置浮层、切模型这三条通路
 * 读同一个 `view`——之前 ProviderSettings.vue 自己持有一份，chip 再拿一份就是同一个数两个口径。
 * 明文密钥不经过这里：草稿里的 apiKey 只往主进程送，回来的视图只有掩码。
 */
export const useProviderStore = defineStore("provider", () => {
  const view = ref<ProviderView | null>(null);
  const error = ref("");
  /** null = 这一版配置下还没拉过列表；换过 baseURL 或被强制刷新时会回到 null。 */
  const models = ref<ModelListResult | null>(null);
  const modelsLoading = ref(false);
  const switching = ref(false);

  const modelLabel = computed(() => view.value?.model ?? "");
  /** 判的是「有没有一个能发出去的模型名」，不是「读没读到视图」——空 model 的配置发不动一轮。 */
  const configured = computed(() => (view.value?.model ?? "") !== "");

  async function refresh(): Promise<void> {
    try {
      view.value = await window.mochen.providerView();
      error.value = "";
    } catch (caught) {
      // 读失败不等于配置变了：留着上一次已知的视图，只把这一轮的错误摆出来。
      error.value = toReason(caught);
    }
  }

  async function save(draft: ProviderDraft): Promise<boolean> {
    try {
      view.value = await window.mochen.providerSave(draft);
      error.value = "";
      // 地址或模型换过之后，旧地址拉回来的列表就成了新地址的假选项。
      models.value = null;
      return true;
    } catch (caught) {
      error.value = toReason(caught);
      return false;
    }
  }

  async function loadModels(force = false): Promise<void> {
    if (models.value !== null && !force) return;
    modelsLoading.value = true;
    try {
      models.value = await window.mochen.listModels();
    } catch (caught) {
      // 主进程已经把出网失败收成理由了；走到这里的只剩 IPC 层本身被拒，同样摆成一句人话。
      models.value = { ok: false, reason: toReason(caught) };
    } finally {
      modelsLoading.value = false;
    }
  }

  /** 选中远端某一条 = 只改 model，baseURL 原样送回、apiKey 恒为 null（保留现有密钥）。 */
  async function select(model: string): Promise<boolean> {
    const current = view.value;
    if (current === null) {
      error.value = "还没读到本机配置，先在模型设置里看一眼地址与密钥。";
      return false;
    }
    switching.value = true;
    try {
      return await save({ baseURL: current.baseURL, model, apiKey: null });
    } finally {
      switching.value = false;
    }
  }

  return {
    view,
    error,
    models,
    modelsLoading,
    switching,
    modelLabel,
    configured,
    refresh,
    save,
    loadModels,
    select
  };
});

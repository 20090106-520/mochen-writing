import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ConnectionDraft,
  ModelListQuery,
  ModelListResult,
  ProfileDraft,
  ProviderView,
  VerifyResult
} from "@mochen/contracts";
import { presentableProviderError } from "../utils/provider-error";

function toReason(caught: unknown): string {
  return presentableProviderError(caught instanceof Error ? caught.message : String(caught));
}

/**
 * 模型配置在渲染层的唯一真身（#104；2026-10-06 批次 5-⑤ 改成多连接并存）。
 *
 * 输入区的「模型 ▾」、模型面板、切模型这三条通路读同一个 `view`。
 * 明文密钥不经过这里：草稿里的 apiKey 只往主进程送，回来的视图只有掩码。
 *
 * **地址与密钥不再是全局一份**：每条连接（一家供应商）各带各的，档案挂在某条连接上。
 * 「同时存着 DeepSeek 和 OpenAI、随时切」是这轮改动的目的。
 *
 * **体检结果不进 view**：view 是「盘上有什么」，出网是「现在连不连得上」，两件事分开存。
 * 把体检结果混进 view 会逼着每次读设置都出网一次——那既慢又会在离线时把设置页卡住。
 */
export const useProviderStore = defineStore("provider", () => {
  const view = ref<ProviderView | null>(null);
  const error = ref("");
  /** null = 这一版配置下还没拉过列表；换过地址或被强制刷新时会回到 null。 */
  const models = ref<ModelListResult | null>(null);
  const modelsLoading = ref(false);
  const switching = ref(false);
  /** 每条连接的体检结果（软校验，见 `providerVerify`）。 */
  const verify = ref<Record<string, VerifyResult>>({});

  /** 发请求用的模型 = 启用中那条档案；一条都没启用就是空串（configured 判定它）。 */
  const modelLabel = computed(
    () => view.value?.profiles.find((profile) => profile.enabled)?.model ?? ""
  );
  /** 判的是「有没有一个能发出去的模型名」，不是「读没读到视图」。 */
  const configured = computed(() => modelLabel.value !== "");

  /**
   * 启用中那条模型**自己那条连接**的地址（空串 = 没有启用中的模型，或那条连接已被删）。
   *
   * **2026-10-06 真机逮到的假提示**：输入卡那枚模型 chip 过去问的是 `provider.view?.baseURL`，
   * 而 `ProviderView` 里**根本没有 `baseURL` 这个字段**（只有 `connections` 与 `profiles`）——
   * 于是它恒为 `undefined`，`?? ''` 变成空串，chip 于是**永远**说
   * 「配置里还没有 API 地址……此刻拉不到名单」。哪怕配置完全正确也一样。
   * 与「把 TLS 证书失败说成地址填错」是同一类病：控件的提示在说自己都不信的话。
   *
   * 走连接才是对的：地址是**连接**的属性，模型档案只是挂在某条连接下。
   * 判定放这里（不在模板里写 `?? ''`）是铁律——`modelLabel` 也走的是同一份「找启用中那条」。
   */
  const activeBaseURL = computed(() => {
    const enabled = view.value?.profiles.find((profile) => profile.enabled);
    if (enabled === undefined) return "";
    return connectionOf(enabled.connectionId)?.baseURL ?? "";
  });

  function connectionOf(connectionId: string) {
    return view.value?.connections.find((connection) => connection.id === connectionId) ?? null;
  }

  async function refresh(): Promise<void> {
    try {
      view.value = await window.mochen.providerView();
      error.value = "";
    } catch (caught) {
      // 读失败不等于配置变了：留着上一次已知的视图，只把这一轮的错误摆出来。
      error.value = toReason(caught);
    }
  }

  /**
   * 新建或改一条连接。**不删旧连接**——切供应商是「再加一条」，不是「把原来那条改掉」，
   * 否则用户只是临时想用另一家，却把自己配好的那家弄丢了。
   *
   * 回执是**刚存那条的 id**（失败为 null）。调用方要拿它去挂模型、去做体检，
   * 别自作聪明回头按地址在 view 里认：同地址的两条连接并存时那必然认错。
   */
  async function saveConnection(draft: ConnectionDraft): Promise<string | null> {
    try {
      const saved = await window.mochen.providerSave(draft);
      view.value = saved;
      error.value = "";
      models.value = null;
      // 改过的连接要清掉旧体检结果：它现在的地址/密钥与刚存进去的可能完全不同，
      // 摆着上一次「连得上」等于骗人。
      if (draft.connectionId !== undefined) {
        const next = { ...verify.value };
        delete next[draft.connectionId];
        verify.value = next;
      }
      return saved.connectionId;
    } catch (caught) {
      error.value = toReason(caught);
      return null;
    }
  }

  async function removeConnection(connectionId: string): Promise<void> {
    try {
      view.value = await window.mochen.providerConnectionRemove(connectionId);
      error.value = "";
      const next = { ...verify.value };
      delete next[connectionId];
      verify.value = next;
    } catch (caught) {
      error.value = toReason(caught);
    }
  }

  /**
   * query = 对话框里还没保存的草稿：带草稿就绕过缓存现拉一把；
   * 不带草稿（输入卡「模型 ▾」）走启用中那条。
   *
   * **丢弃过期回包**：边打边拉会同时在飞两个请求（地址框失焦那一个还没密钥、
   * 防抖那一个已经带上了密钥）。谁先回谁说了算的话，先发的那个慢一拍回来
   * 就会把后发的正确结果盖掉——界面上于是挂着一句「密钥无效」，
   * 而密钥其实是对的。2026-10-06 真机上就是这么撞出来的（两次跑出来一次空一次 12 个）。
   */
  let modelsTicket = 0;

  async function loadModels(force = false, query?: ModelListQuery): Promise<void> {
    if (query === undefined && models.value !== null && !force) return;
    const ticket = ++modelsTicket;
    modelsLoading.value = true;
    try {
      const result = await window.mochen.listModels(query);
      if (ticket !== modelsTicket) return; // 已经有更新的请求了，这包不要了
      // 失败理由在进门时剥壳（经 toReason → presentableProviderError 唯一真身）：主进程收进
      // reason 的 credential/配置错误带英文括注，对话框与输入卡浮层两个消费方不该各自再剥。
      models.value = result.ok ? result : { ok: false, reason: toReason(result.reason) };
    } catch (caught) {
      if (ticket !== modelsTicket) return;
      // 主进程已经把出网失败收成理由了；走到这里的只剩 IPC 层本身被拒，同样摆成一句人话。
      models.value = { ok: false, reason: toReason(caught) };
    } finally {
      // 只有最新那一次能收 loading，否则慢的会把还在飞的标记收掉。
      if (ticket === modelsTicket) modelsLoading.value = false;
    }
  }

  /**
   * 连通性体检（软校验）。**只回答连不连得上，不决定能不能存**——
   * 2026-10-06 之前的「添加模型」不校验也不提示，用户存完以为配好了，
   * 直到真发请求才发现全挂；而那句唯一的红色提示还随对话框一起消失了。
   */
  async function verifyConnection(connectionId: string): Promise<VerifyResult> {
    try {
      const result = await window.mochen.providerVerify(connectionId);
      verify.value = { ...verify.value, [connectionId]: result };
      return result;
    } catch (caught) {
      const reason = toReason(caught);
      const result: VerifyResult = {
        state: "unreachable",
        reason,
        checkedAt: new Date().toISOString()
      };
      verify.value = { ...verify.value, [connectionId]: result };
      return result;
    }
  }

  /** 「改用」= 加档案并启用（同一条连接里同名幂等）：模型面板由此多出一张卡，chip 徽章跟到新模型。 */
  async function select(draft: ProfileDraft): Promise<boolean> {
    switching.value = true;
    try {
      view.value = await window.mochen.profileUpsert(draft);
      error.value = "";
      return true;
    } catch (caught) {
      error.value = toReason(caught);
      return false;
    } finally {
      switching.value = false;
    }
  }

  async function removeProfile(id: string): Promise<void> {
    try {
      view.value = await window.mochen.profileRemove(id);
      error.value = "";
    } catch (caught) {
      error.value = toReason(caught);
    }
  }

  /** 启停互斥在主进程保证；这里只把返回的新视图收下来。 */
  async function enableProfile(id: string, enabled: boolean): Promise<void> {
    try {
      view.value = await window.mochen.profileEnable(id, enabled);
      error.value = "";
    } catch (caught) {
      error.value = toReason(caught);
    }
  }

  return {
    view,
    error,
    models,
    modelsLoading,
    switching,
    verify,
    modelLabel,
    activeBaseURL,
    configured,
    connectionOf,
    refresh,
    saveConnection,
    removeConnection,
    loadModels,
    verifyConnection,
    select,
    removeProfile,
    enableProfile
  };
});

/** 界面上按连接摆模型时用：某条连接下面挂着哪些档案。 */
export function profilesOfConnection(
  view: ProviderView | null,
  connectionId: string
): { id: string; model: string; enabled: boolean }[] {
  return view?.profiles.filter((profile) => profile.connectionId === connectionId) ?? [];
}

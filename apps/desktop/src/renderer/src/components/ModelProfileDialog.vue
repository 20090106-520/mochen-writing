<!-- 添加/编辑模型对话框（2026-10-06 批次 5-⑤ 重做）。

     此前这里是两个**写死禁用**的下拉（供应商 / API 类型），底下什么分派逻辑也没有：
     卡片上那句「OpenAI Compatible」是硬编码字面量，用户换不了任何东西。
     现在供应商是真能切的——每家带自己的地址与密钥请求头，切换即自动填好。

     **API 类型不是下拉**。本仓出网只实现了一种协议（Chat Completions），
     摆一个能点、点了没用的下拉就是装样子，所以那一行改成只读的一行说明。
     以后真做了 Responses API，再把它变回可切的。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  CUSTOM_PROVIDER_ID,
  CUSTOM_PROVIDER_LABEL,
  LOCAL_MODEL_KEY_NOTE,
  OLLAMA_BASE_URL,
  OLLAMA_FILL_LABEL,
  PROVIDER_DIALOG_GROUPS,
  THINKING_WIRE_LABELS,
  detectProviderByBaseURL,
  presetOf,
  type AuthHeader,
  type ThinkingWire
} from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useModalFocus } from "../composables/useModalFocus";
import { useDialogMotion } from "../composables/useDialogMotion";
import { useProviderStore } from "../stores/useProviderStore";
import { MODEL_PICKER_LIST_LIMIT, filterModels, groupModels } from "../utils/model-picker";

const props = defineProps<{
  mode: "add" | "edit";
  /** 编辑态：要改哪条模型（顺带定位到它那条连接）。 */
  model?: string;
  /** 编辑态：要改哪条连接。 */
  connectionId?: string;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

const provider = useProviderStore();

const editingConnection = computed(
  () => provider.view?.connections.find((c) => c.id === props.connectionId) ?? null
);

const providerId = ref(editingConnection.value?.providerId ?? CUSTOM_PROVIDER_ID);
const baseURL = ref(editingConnection.value?.baseURL ?? "");
const authHeader = ref<AuthHeader>(editingConnection.value?.authHeader ?? "bearer");
const thinkingWire = ref<ThinkingWire>(editingConnection.value?.thinkingWire ?? "standard");
const apiKey = ref("");
const showKey = ref(false);
const keyTouched = ref(false);
const modelId = ref(props.mode === "edit" ? (props.model ?? "") : "");
const saving = ref(false);
/** 已保存的连接（刚存完那一条）：软校验结果挂在这里，别随对话框一起消失。 */
const savedConnectionId = ref<string | null>(props.connectionId ?? null);

const preset = computed(() => presetOf(providerId.value));

/**
 * 地址自动认服务商（2026-10-06 批次 5-⑧）。纯函数在 contracts，这里只消费。
 *
 * **只影响显示与提示**：认出来**不自动改用户填的地址、也不自动切 providerId**——
 * 用户在「自定义」里手填一个官方地址是常态，替他改掉下拉选择会让他不知道自己存成了哪一家。
 * 认出来的东西只摆出来让他看见（名字、该用哪个密钥头、去哪儿取密钥），改不改他自己定。
 */
const detected = computed(() => detectProviderByBaseURL(baseURL.value));

/** 「去取密钥」：认出来的那家有没有官方密钥页。聚合站（presetId 为空）不给——我们没有出处。 */
async function openDetectedKeyPage(): Promise<void> {
  const id = detected.value.presetId;
  if (id === "") return;
  try {
    // 走**现有**的 providerId 通道，不新开一条「渲染层递 URL 出去」的路：
    // 主进程那条只收 providerId 再自己查预设表（agent-ipc.ts），就是为了不放行 file:// 与内网地址。
    // 识别结果里的 keyUrl 只用来判断「这一家有没有页面」，不直接递出去。
    await window.mochen.openProviderKeyPage(id);
  } catch {
    /* 打不开就算了，名字已经摆在旁边了 */
  }
}
const isCustom = computed(() => providerId.value === CUSTOM_PROVIDER_ID);

const fetchReason = computed(() =>
  provider.models !== null && !provider.models.ok ? provider.models.reason : ""
);

/** 预置的常用模型名：拉不到名单时也能照着填一个对的。 */
const suggestedModels = computed<string[]>(() =>
  provider.models !== null && provider.models.ok
    ? provider.models.models
    : (preset.value?.models ?? [])
);

/* ── 选模型这块（2026-10-06 重做） ──────────────────────────────────────────
   此前是一个原生 <input list> + <datalist>：浏览器画的浮层、各平台长得都不一样，
   上百个模型的 hub 里也没法搜，而且图像/视频模型和对话模型平铺在一列，
   用户得自己认名字挑（agnes-ai 真机拉到 12 个，里面 6 个是对话、6 个是图像/视频）。
   现在是「可搜 + 分组 + 点一下就选中」，判定都在 utils/model-picker.ts。 */

/** 列表区是否展开。默认展开：用户点进来的目的多半就是挑模型。 */
const pickerOpen = ref(true);
/** 搜索词（只筛名单，不改已填的 modelId）。 */
const modelQuery = ref("");

/** 真从上游拉到了名单吗？（拉失败时那串「常用模型名」不是上游的东西，不能冒充名单） */
const hasRemoteList = computed(() => provider.models !== null && provider.models.ok);
/** 当前该展示的名单：有上游名单用它，否则退回预置常用名。 */
const visibleModels = computed<string[]>(() =>
  filterModels(suggestedModels.value, modelQuery.value)
);
/** 名单长到铺满对话框时不该把整页撑长，剩下的在列表里滚。 */
const cappedModels = computed(() => visibleModels.value.slice(0, MODEL_PICKER_LIST_LIMIT));
const cappedGroups = computed(() => groupModels(cappedModels.value));
const hiddenModelCount = computed(() => visibleModels.value.length - cappedModels.value.length);
const listEl = ref<HTMLElement | null>(null);

/** 选中的那条要看得见——列表还开着，看不见自己选了谁就等于没选。 */
async function revealSelected(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const el = listEl.value;
  if (el === null || modelId.value === "") return;
  const rows = [...el.querySelectorAll<HTMLElement>("[data-model-name]")];
  const target = rows.find((row) => row.dataset.modelName === modelId.value);
  target?.scrollIntoView({ block: "nearest" });
}

function chooseModel(name: string): void {
  modelId.value = name;
}

watch(modelId, () => {
  void revealSelected();
});

const verify = computed(() =>
  savedConnectionId.value === null ? null : (provider.verify[savedConnectionId.value] ?? null)
);

function fetchNow(): void {
  const url = baseURL.value.trim();
  const key = apiKey.value.trim();
  // 已有连接且只改了密钥框（地址没动）⇒ 按那条连接拉；否则拿草稿现拉一把。
  if (props.connectionId !== undefined && url === editingConnection.value?.baseURL) {
    void provider.loadModels(true, { connectionId: props.connectionId });
    return;
  }
  if (url === "" && key === "") return;
  void provider.loadModels(true, {
    baseURL: url,
    apiKey: key,
    authHeader: authHeader.value
  });
}

/**
 * 边打边拉。
 *
 * 此前只有 `@change`（失焦）才拉名单，于是「粘上密钥 → 看着下面的名单」这条最自然的
 * 路径**不成立**：得再点一下别处才刷新。2026-10-06 真机上就是这么撞到的——
 * 填完密钥名单纹丝不动，列表区还挂着上一次（空密钥）拉出来的「密钥无效」，
 * 那句话是**过期**的，比没有更误导人。
 *
 * 停顿 600ms 再拉：一次 51 位密钥要打 51 个字符，不防抖就是 51 次请求。
 */
const FETCH_DEBOUNCE_MS = 600;
let fetchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFetch(): void {
  if (fetchTimer !== null) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => {
    fetchTimer = null;
    fetchNow();
  }, FETCH_DEBOUNCE_MS);
}

// 只在「已经有密钥」时自动拉。没密钥就拉等于拿空凭据去问人家要名单，
// 回一句 401 显示在对话框里，用户会以为自己已经填错了什么。
watch([baseURL, apiKey], () => {
  if (apiKey.value.trim() !== "") scheduleFetch();
});

/**
 * 换供应商：**自动把地址与请求头带过来**。
 * 不这么做的话，选了 DeepSeek 还得自己去搜地址、手打一遍——那不叫快捷。
 * 自定义那一项不覆盖用户已经填好的地址（他们就是自己填的）。
 */
watch(providerId, (next) => {
  const picked = presetOf(next);
  if (picked !== null) {
    baseURL.value = picked.baseURL;
    authHeader.value = picked.authHeader;
  } else if (next === CUSTOM_PROVIDER_ID && baseURL.value === "") {
    authHeader.value = "bearer";
  }
});

/** 一键填本机 Ollama：它不是预置供应商（用户 2026-10-06 明确不要本机那批），
     但自定义地址最常见的用途就是它，所以留一颗快捷按钮。 */
function fillOllama(): void {
  providerId.value = CUSTOM_PROVIDER_ID;
  baseURL.value = OLLAMA_BASE_URL;
  authHeader.value = "bearer";
  apiKey.value = "";
  keyTouched.value = true;
  fetchNow();
}

async function openKeyPage(): Promise<void> {
  if (isCustom.value) return;
  try {
    await window.mochen.openProviderKeyPage(providerId.value);
  } catch (error) {
    provider.error = error instanceof Error ? error.message : "没能打开那家网站的密钥页面。";
  }
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  // **软校验**：存照存，存完立刻体检一次，把「配好了没有」摆在明面上。
  // 此前不校验也不提示，用户存完以为配好了，直到真发请求才发现全挂。
  const savedId = await provider.saveConnection({
    connectionId: props.connectionId,
    providerId: providerId.value,
    baseURL: baseURL.value.trim(),
    authHeader: authHeader.value,
    thinkingWire: thinkingWire.value,
    // 没碰过密钥框 ⇒ null（沿用）；碰过且清空 ⇒ ""（主进程据此 clear）。
    apiKey: keyTouched.value ? apiKey.value.trim() : null
  });
  if (savedId === null) {
    saving.value = false;
    return;
  }
  // 拿主进程回传的 id，**不要**回头按地址在 view 里找：同一家开第二个账号时地址一模一样，
  // find 会先命中用户没在配的那条，模型就挂错连接了。
  savedConnectionId.value = savedId;
  if (props.mode === "add") {
    const added = await provider.select({
      model: modelId.value.trim(),
      connectionId: savedConnectionId.value
    });
    if (!added) {
      saving.value = false;
      return;
    }
  }
  if (savedConnectionId.value !== null) void provider.verifyConnection(savedConnectionId.value);
  saving.value = false;
  emit("saved");
}

onMounted(() => {
  // 编辑态连接改了就重拉一次；添加态开箱即拉（预填的已存地址直接出名单）。
  fetchNow();
});

onUnmounted(() => {
  // 对话框关了还在防抖窗口里 ⇒ 那次请求会在没人的界面上跑完，白花一次配额。
  if (fetchTimer !== null) clearTimeout(fetchTimer);
});

/**
 * Esc 与焦点的真身在 useModalFocus（批次 5-㊱）。
 *
 * 原来是这一层自己在 `.workspace-dialog` 上挂 `@keydown="onKeydown"` 判 `event.key === "Escape"`：
 * 形状看着对，实际收不到——keydown 走冒泡，焦点不在这棵子树里就到不了这里，而本组件从没挪过焦点。
 * 真机量到的更绕：点「添加模型」后在设置页按 Esc，弹窗确实消失了，但**不是它自己关的**，
 * 是全局 escape-policy 的 `close-overlay` 把整个设置视图卸了（p536d 量到对话框关了、
 * 焦点掉到 body，而关闭路径根本没经过这一层）。同一个「关掉了」量了两种不同的东西。
 * 四个弹层现在统一由 composable 一处接管 Esc 与焦点进出，这一行连同 onKeydown 一起退役。
 */
const dialogRoot = ref<HTMLElement>();
useModalFocus({ root: dialogRoot, close: () => emit("close") });
// 入场动效：面板 + 背板同一条弹簧时间轴。本组件由父组件 v-if 挂载，不传 isOpen（挂载即开）。
useDialogMotion({ root: dialogRoot });
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        ref="dialogRoot"
        class="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-profile-title"
        tabindex="-1"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">
              {{ mode === "add" ? "选一家供应商，填上密钥就能用" : "改的是这条连接" }}
            </span>
            <h2 id="model-profile-title">
              {{ mode === "add" ? "添加模型" : "编辑连接" }}
            </h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')">
            ×
          </button>
        </header>
        <div class="dialog-content">
          <label class="provider-field">
            <span>供应商</span>
            <!-- 真能切：optgroup 按国内 / 国外 / 自定义分组。 -->
            <select v-model="providerId">
              <optgroup
                v-for="group in PROVIDER_DIALOG_GROUPS"
                :key="group.group"
                :label="group.label"
              >
                <option v-for="id in group.ids" :key="id" :value="id">
                  {{
                    id === CUSTOM_PROVIDER_ID ? CUSTOM_PROVIDER_LABEL : (presetOf(id)?.label ?? id)
                  }}
                </option>
              </optgroup>
            </select>
            <button
              v-if="!isCustom"
              class="dialog-secondary-button provider-key-link"
              type="button"
              @click="openKeyPage"
            >
              获取 API 密钥
            </button>
            <small v-if="preset && preset.note !== ''" class="provider-field-note">
              {{ preset.note }}
            </small>
          </label>

          <label class="provider-field">
            <span>接口地址（Base URL）</span>
            <input
              v-model="baseURL"
              type="text"
              placeholder="https://api.example.com/v1"
              @change="fetchNow"
            />
            <!--
              自动认服务商（2026-10-06 批次 5-⑧）。判据在 contracts 的 detectProviderByBaseURL
              （纯函数、离线、零延迟）。认出来就把**名字、密钥头、密钥页**一起摆出来——
              只给名字等于白认：小米 MiMo 的密钥走 `api-key` 头，用户在自定义里手填它的地址
              会永远 401，而界面不会告诉他原因。认不出来时**什么都不说**，不猜。
            -->
            <small v-if="detected.known" class="provider-field-note provider-detected">
              <AppIcon name="check" :size="13" />
              认出这家是 <strong>{{ detected.label }}</strong>
              <template v-if="detected.presetId !== ''">
                ·密钥走 <code>{{ detected.authHeader }}</code> 头 ·
                <button class="provider-inline-link" type="button" @click="openDetectedKeyPage">
                  去取密钥
                </button>
              </template>
            </small>
            <small v-else class="provider-field-note">
              自定义地址最常见的用途是本机端点：
              <button class="provider-inline-link" type="button" @click="fillOllama">
                {{ OLLAMA_FILL_LABEL }}
              </button>
            </small>
          </label>

          <label class="provider-field">
            <span>密钥放在哪个请求头</span>
            <!--
              这一格不是装饰：小米 MiMo 官方只认 api-key 头，发 Bearer 会永远 401。
              预置已经替你选对了，这里是给自填地址时兜底与覆盖用的。
            -->
            <select v-model="authHeader">
              <option value="bearer">Authorization: Bearer（绝大多数 OpenAI 兼容端点）</option>
              <option value="api-key">api-key（小米 MiMo 等）</option>
            </select>
            <small class="provider-field-note"
              >协议固定是 Chat Completions（OpenAI 兼容），暂不支持别的形态。</small
            >
          </label>

          <!--
            思考档的线格式（2026-10-09 批次 5-㊻）。与上面那格同一族：
            **「OpenAI 兼容」不等于字段值一样**。
            Agnes AI Hub 的真机回执原文——「Unexpected reasoning effort high.
            Supported types are xhigh (default), medium, and low.」：
            它照收 low / medium，唯独最高那一档叫 xhigh，我们发 high 上去**整笔请求 400**，
            症状是「地址密钥全对但一个字都发不出去」。
            分歧只在最高档（另两档各家一致），所以这一格只改那一档的字。
          -->
          <label class="provider-field">
            <span>深度思考在线上叫什么</span>
            <select v-model="thinkingWire">
              <option value="standard">{{ THINKING_WIRE_LABELS.standard }}</option>
              <option value="xhigh">{{ THINKING_WIRE_LABELS.xhigh }}</option>
            </select>
            <small class="provider-field-note"
              >只有「深度」那一档会变：选 xhigh 时本轮出站发
              <code>reasoning_effort=xhigh</code>，较低/标准两档照发 low / medium。</small
            >
          </label>

          <label class="provider-field">
            <span>API Key</span>
            <div class="provider-key-row">
              <input
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                autocomplete="off"
                placeholder="点「获取 API 密钥」去那家网站取"
                @input="keyTouched = true"
                @change="fetchNow"
              />
              <button
                class="dialog-secondary-button provider-key-toggle"
                type="button"
                :aria-label="showKey ? '隐藏密钥' : '显示密钥'"
                @click="showKey = !showKey"
              >
                <AppIcon name="eye" :size="15" />
              </button>
            </div>
            <small class="provider-field-note">
              密钥只进主进程、绝不回传。{{ LOCAL_MODEL_KEY_NOTE }}
              <b>动过这个框再留空保存＝清掉已存密钥</b>；没碰过就保存＝沿用原来那把。
            </small>
          </label>

          <div class="provider-field">
            <span>Model ID</span>
            <input v-if="mode !== 'add'" type="text" :value="model" disabled />

            <template v-else>
              <!--
                输入框保留：名单里没有的模型也能手填。有些 hub 的 /models 只回一部分，
                拿 datalist 一绑就把「手填」这条路也堵死了。
              -->
              <input
                v-model="modelId"
                type="text"
                class="model-picker-input"
                placeholder="点下面选一个，或直接手填模型名"
                autocomplete="off"
              />

              <div class="model-picker" :class="{ 'is-empty': visibleModels.length === 0 }">
                <div class="model-picker-bar">
                  <button
                    class="model-picker-toggle"
                    type="button"
                    :aria-expanded="pickerOpen"
                    @click="pickerOpen = !pickerOpen"
                  >
                    <AppIcon name="chevron" :size="14" class="model-picker-caret" />
                    {{ hasRemoteList ? "模型名单" : "常用模型名" }}
                    <span class="model-picker-count">{{ visibleModels.length }}</span>
                  </button>
                  <button
                    class="model-picker-refresh"
                    type="button"
                    :disabled="provider.modelsLoading"
                    @click="fetchNow"
                  >
                    {{ provider.modelsLoading ? "拉取中…" : "重新拉取" }}
                  </button>
                </div>

                <div v-if="pickerOpen" class="model-picker-body">
                  <input
                    v-model="modelQuery"
                    type="text"
                    class="model-picker-search"
                    :placeholder="hasRemoteList ? '搜模型名…' : '连接还没通，用下面这些常见名字'"
                    autocomplete="off"
                  />

                  <!-- 拉不到时明说来源：那是预置的常用名，不是上游给的名单 -->
                  <p v-if="!hasRemoteList" class="model-picker-hint">
                    {{
                      provider.models === null
                        ? "还没拉到名单。"
                        : `没拉到名单（${fetchReason}）。下面是常见模型名，填错了保存时也会告诉你。`
                    }}
                  </p>

                  <p v-if="visibleModels.length === 0" class="model-picker-hint">
                    没一个匹配「{{ modelQuery }}」。清空搜索，或直接在上面手填。
                  </p>

                  <ul v-else ref="listEl" class="model-picker-list">
                    <li v-for="group in cappedGroups" :key="group.kind" class="model-picker-group">
                      <p class="model-picker-group-title">{{ group.label }}</p>
                      <div class="model-picker-group-items">
                        <button
                          v-for="name in group.items"
                          :key="name"
                          type="button"
                          class="model-picker-item"
                          :class="{ 'is-chosen': name === modelId }"
                          :aria-pressed="name === modelId"
                          :data-model-name="name"
                          @click="chooseModel(name)"
                        >
                          {{ name }}
                        </button>
                      </div>
                    </li>
                  </ul>

                  <p v-if="hiddenModelCount > 0" class="model-picker-hint">
                    还有 {{ hiddenModelCount }} 个没列出来，搜名字能直接找到。
                  </p>
                </div>
              </div>
            </template>

            <small class="provider-field-note">
              {{
                mode === "add"
                  ? "模型名添加后不可改；要换模型就再添加一条。"
                  : "模型本身不可改；要换模型请新增一条。"
              }}
            </small>
          </div>

          <!--
 拉取状态不再单列一行：「正在拉取…」进了重新拉取那颗按钮，
 失败理由进了选择器里那句「没拉到名单（…）」——同一件事说两遍只会让人以为是两个问题。
-->
          <p v-if="provider.error && provider.error !== fetchReason" class="provider-error">
            {{ provider.error }}
          </p>

          <!--
            体检结果摆在这里而不是「保存后就没了」。
            此前那句「连不上」只在拉名单时出现，点保存就随对话框一起消失，
            用户看着像「配好了」，实际后果推迟到真发请求时才炸。
          -->
          <p
            v-if="verify"
            class="provider-verify"
            :class="`is-${verify.state}`"
            data-testid="provider-verify"
          >
            <template v-if="verify.state === 'ok'"
              >连得上，名单里有 {{ verify.modelCount }} 个模型。</template
            >
            <template v-else-if="verify.state === 'unreachable'">
              {{ verify.reason }}（配置已经存下来了，可以回头再连）
            </template>
            <template v-else>{{ verify.reason }}</template>
          </p>
        </div>

        <!--
          动作条在 `.dialog-content` **外面**：内容一长它就得能停在原地，
          塞在滚动区里会被顶出去（够不着），sticky 又会压住模型名单那几颗按钮。
          见 styles/dialog.css 里那段说明。
        -->
        <div class="dialog-actions">
          <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
          <button
            class="dialog-primary-button"
            type="button"
            :disabled="saving || (mode === 'add' && modelId.trim() === '')"
            @click="save"
          >
            {{ mode === "add" ? "保存并启用" : "保存" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<!-- 模型面板（设置中心「模型配置」分类的内容区）：按**连接**分组的卡片列表（2026-10-06 批次 5-⑤）。
     地址与密钥不再是全局一份：每家供应商一条连接，连接下面挂它能用的模型。
     卡片上常显「地址 / 有没有密钥 / 现在连不连得上」——此前这三样界面上一个都看不到，
     用户存完只能猜配没配好。密钥设置的唯一入口是对话框（spec §8）：明文只进主进程。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  OLLAMA_BASE_URL,
  type ProviderConnectionView,
  type ProviderProfileView
} from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import ModelProfileDialog from "./ModelProfileDialog.vue";
import { useProviderStore } from "../stores/useProviderStore";

const provider = useProviderStore();

/** null = 对话框没开；"add" = 新建；连接 id = 改那一条连接。 */
const dialogMode = ref<null | "add" | string>(null);
const editingModel = ref("");
/** ⋯ 菜单开在哪张模型卡上（null = 全关）。点卡片外自动收起。 */
const menuFor = ref<string | null>(null);

interface ConnectionGroup {
  connection: ProviderConnectionView;
  profiles: ProviderProfileView[];
}

const groups = computed<ConnectionGroup[]>(() =>
  (provider.view?.connections ?? []).map((connection) => ({
    connection,
    profiles: (provider.view?.profiles ?? []).filter((p) => p.connectionId === connection.id)
  }))
);

function openAdd(): void {
  editingModel.value = "";
  dialogMode.value = "add";
}

/** 编辑改的是**连接**（地址与密钥全部模型共用），模型本身只读展示。 */
function openEdit(profile: ProviderProfileView): void {
  menuFor.value = null;
  editingModel.value = profile.model;
  dialogMode.value = profile.connectionId;
}

async function removeProfile(profile: ProviderProfileView): Promise<void> {
  menuFor.value = null;
  await provider.removeProfile(profile.id);
}

async function removeConnection(connectionId: string): Promise<void> {
  menuFor.value = null;
  await provider.removeConnection(connectionId);
}

function toggle(profile: ProviderProfileView): void {
  void provider.enableProfile(profile.id, !profile.enabled);
}

/** 体检：软校验，连不上也只是把状态摆出来，不拦着用户继续用。 */
function check(connectionId: string): void {
  void provider.verifyConnection(connectionId);
}

/** 本机端点单独标一眼：它与预置供应商不是一回事，混在一起会让人以为「本地也是一种供应商」。 */
function isLocalBase(baseURL: string): boolean {
  return baseURL === OLLAMA_BASE_URL;
}

function onDocClick(event: MouseEvent): void {
  if (menuFor.value === null) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".provider-profile-card")) return;
  menuFor.value = null;
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  void provider.refresh();
  // 打开面板就把每条连接体检一次：用户最想知道的正是「现在能不能用」。
  for (const connection of provider.view?.connections ?? []) {
    void provider.verifyConnection(connection.id);
  }
});
onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
});
</script>

<template>
  <section class="settings-group provider-panel">
    <div class="provider-panel-head">
      <div>
        <h2 class="settings-group-title provider-panel-title">模型</h2>
        <p class="provider-panel-note">多家供应商可以并存，各用各的地址与密钥，随时切。</p>
      </div>
      <button class="dialog-primary-button provider-add-button" type="button" @click="openAdd">
        <AppIcon name="plus" :size="15" />
        添加模型
      </button>
    </div>

    <p v-if="provider.error" class="provider-error">{{ provider.error }}</p>

    <ul v-if="groups.length" class="provider-connection-list">
      <li v-for="group in groups" :key="group.connection.id" class="provider-connection-card">
        <header class="provider-connection-head">
          <div class="provider-connection-text">
            <strong>{{ group.connection.label }}</strong>
            <!-- 地址常显：此前界面上一个都看不到，用户无从判断自己配的是哪家。 -->
            <span class="provider-connection-url">{{ group.connection.baseURL }}</span>
            <span v-if="isLocalBase(group.connection.baseURL)" class="provider-connection-tag"
              >本机端点</span
            >
            <span
              class="provider-connection-key"
              :class="{ 'is-missing': !group.connection.hasKey }"
            >
              {{ group.connection.hasKey ? `密钥 ${group.connection.keyMask}` : "没有密钥" }}
            </span>
            <span
              v-if="group.connection.authHeader === 'api-key'"
              class="provider-connection-tag"
              title="小米 MiMo 那类端点只认 api-key 头"
            >
              api-key 头
            </span>
            <!-- 思考档的线格式同样常显（2026-10-09 批次 5-㊻）：Agnes 那类端点把最高档叫 xhigh，
                 发 high 上去整笔请求 400，而地址与密钥全对——不标出来用户只能靠撞报错反推。 -->
            <span
              v-if="group.connection.thinkingWire === 'xhigh'"
              class="provider-connection-tag"
              title="这条端点把「深度」叫 xhigh：发 reasoning_effort=high 会被它 400 拒收"
            >
              深度走 xhigh
            </span>
          </div>
          <div class="provider-connection-actions">
            <button
              class="dialog-secondary-button provider-check-button"
              type="button"
              :aria-label="`体检 ${group.connection.label} 的连接`"
              @click="check(group.connection.id)"
            >
              体检
            </button>
            <button
              class="icon-button"
              type="button"
              :aria-label="`删除 ${group.connection.label} 这条连接`"
              @click="removeConnection(group.connection.id)"
            >
              <AppIcon name="trash" :size="16" />
            </button>
          </div>
        </header>

        <!-- 体检结果常显在卡片上：软校验三档，别压成一个「已配置 / 未配置」。

             2026-10-06：连不上一支的前缀「连不上：」去掉了。主进程给的 reason 现在**自己就是
             一句完整的话**，而且分了类（证书对不上域名 / 域名解析不出来 / 没人监听 / 路由不到）。
             再套一个「连不上：」会把它说反——实测那台机器上出现过
             「连不上：连上了那台机器但没人监听这个端口」，前后两句自相矛盾（ModelProfileDialog
             同一处一起改）。reason 原样出网，分类那句话就是唯一的真身（铁律 6）。 -->
        <p
          v-if="provider.verify[group.connection.id]"
          class="provider-verify"
          :class="`is-${provider.verify[group.connection.id].state}`"
        >
          <template v-if="provider.verify[group.connection.id].state === 'ok'">
            连得上，名单里有 {{ provider.verify[group.connection.id].modelCount }} 个模型。
          </template>
          <template v-else-if="provider.verify[group.connection.id].state === 'unreachable'">
            {{ provider.verify[group.connection.id].reason }}
          </template>
          <template v-else>{{ provider.verify[group.connection.id].reason }}</template>
        </p>

        <ul v-if="group.profiles.length" class="provider-profile-list">
          <li v-for="profile in group.profiles" :key="profile.id" class="provider-profile-card">
            <span class="provider-profile-icon" aria-hidden="true">
              <AppIcon name="model" :size="18" />
            </span>
            <div class="provider-profile-text">
              <strong>{{ profile.model }}</strong>
            </div>
            <div class="provider-profile-actions">
              <button
                class="icon-button"
                type="button"
                :aria-label="`${profile.model} 的更多操作`"
                @click="menuFor = menuFor === profile.id ? null : profile.id"
              >
                <AppIcon name="ellipsis" :size="18" />
              </button>
              <!-- 开关 = 启用这条模型（互斥）：对话发请求用的就是启用中这条。 -->
              <label class="provider-switch" :aria-label="`启用 ${profile.model}`">
                <input type="checkbox" :checked="profile.enabled" @change="toggle(profile)" />
                <span class="provider-switch-slider" />
              </label>
            </div>
            <div v-if="menuFor === profile.id" class="provider-profile-menu" role="menu">
              <button type="button" role="menuitem" @click="openEdit(profile)">编辑连接</button>
              <button type="button" role="menuitem" @click="removeProfile(profile)">
                删除模型
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="provider-profile-empty">
          这条连接下还没有模型。点右上角「添加模型」，选回这家供应商加一个。
        </p>
      </li>
    </ul>
    <p v-else class="provider-profile-empty">
      还没有模型。点右上角「添加模型」，选一家供应商，填上密钥就能自动拉取名单。
    </p>

    <ModelProfileDialog
      v-if="dialogMode !== null"
      :mode="dialogMode === 'add' ? 'add' : 'edit'"
      :model="editingModel"
      :connection-id="dialogMode === 'add' ? undefined : dialogMode"
      @close="dialogMode = null"
      @saved="dialogMode = null"
    />
  </section>
</template>

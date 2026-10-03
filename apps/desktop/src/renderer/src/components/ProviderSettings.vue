<!-- 弹窗骨架取自 deepwrite 的 dialog-backdrop / workspace-dialog / dialog-actions -->
<!-- 密钥设置的唯一入口（spec §8）：明文只进主进程，渲染层永远拿不回已存的密钥。 -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ProviderDraft } from "@mochen/contracts";
import { useProviderStore } from "../stores/useProviderStore";

const emit = defineEmits<{ close: [] }>();
// ProviderView 的唯一真身在 useProviderStore：这里再持一份，浮层保存后模型 chip 就会读旧值。
const provider = useProviderStore();

const baseURL = ref("");
const model = ref("");
const apiKey = ref("");

async function load(): Promise<void> {
  await provider.refresh();
  const view = provider.view;
  // 读失败时输入格留空、当前那行退回「未能读取当前配置」；理由由 store 收成一句中文。
  if (view === null) return;
  baseURL.value = view.baseURL;
  model.value = view.model;
}

async function save(): Promise<void> {
  const draft: ProviderDraft = {
    baseURL: baseURL.value.trim(),
    model: model.value.trim(),
    // 空串 = 保留现有密钥：渲染层永远拿不回已存的明文。
    apiKey: apiKey.value.trim() === "" ? null : apiKey.value.trim()
  };
  // 写回成功才擦掉密钥输入格；失败时留着一把没存进去的密钥，比让用户重打一次诚实。
  if (await provider.save(draft)) apiKey.value = "";
}

onMounted(() => {
  void load();
});
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">只在本机</span>
            <h2 id="provider-title">模型设置</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭模型设置"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div class="dialog-content">
          <label class="provider-field">
            <span>baseURL（OpenAI 兼容，含 /v1）</span>
            <input v-model="baseURL" type="text" placeholder="http://127.0.0.1:8787/v1" />
          </label>
          <label class="provider-field">
            <span>模型名</span>
            <input v-model="model" type="text" placeholder="mochen-mock" />
          </label>
          <label class="provider-field">
            <span>密钥（留空则保留已存的那把）</span>
            <input v-model="apiKey" type="password" autocomplete="off" />
          </label>
          <p class="dialog-description">
            当前：{{
              provider.view
                ? `${provider.view.baseURL} · ${provider.view.model}`
                : provider.error
                  ? "未能读取当前配置"
                  : "读取中"
            }}
            {{
              provider.view && provider.view.hasKey
                ? ` · 密钥 ${provider.view.keyMask}`
                : " · 尚未存密钥"
            }}
          </p>
          <p v-if="provider.error" class="provider-error">{{ provider.error }}</p>
          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="emit('close')">
              关闭
            </button>
            <button class="dialog-primary-button" type="button" @click="save()">保存</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

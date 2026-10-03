<!-- 弹窗骨架取自 deepwrite 的 dialog-backdrop / workspace-dialog / dialog-actions -->
<!-- 密钥设置的唯一入口（spec §8）：明文只进主进程，渲染层永远拿不回已存的密钥。 -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ProviderDraft, ProviderView } from "@mochen/contracts";
import { presentableProviderError } from "../utils/provider-error";

const emit = defineEmits<{ close: [] }>();

const baseURL = ref("");
const model = ref("");
const apiKey = ref("");
const view = ref<ProviderView | null>(null);
const error = ref("");

async function load(): Promise<void> {
  error.value = "";
  try {
    view.value = await window.mochen.providerView();
  } catch (reason) {
    // provider:get 的读侧确实会抛（配置被占用、缺字段、密钥解不开都是主进程抛出的中文单句），
    // 这里不接住就是一条未处理的 rejection + 弹窗永远停在「读取中」。
    view.value = null;
    error.value = presentableProviderError(
      reason instanceof Error ? reason.message : String(reason)
    );
    return;
  }
  baseURL.value = view.value.baseURL;
  model.value = view.value.model;
}

async function save(): Promise<void> {
  error.value = "";
  const draft: ProviderDraft = {
    baseURL: baseURL.value.trim(),
    model: model.value.trim(),
    // 空串 = 保留现有密钥：渲染层永远拿不回已存的明文。
    apiKey: apiKey.value.trim() === "" ? null : apiKey.value.trim()
  };
  try {
    view.value = await window.mochen.providerSave(draft);
    apiKey.value = "";
  } catch (reason) {
    error.value = presentableProviderError(
      reason instanceof Error ? reason.message : String(reason)
    );
  }
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
              view ? `${view.baseURL} · ${view.model}` : error ? "未能读取当前配置" : "读取中"
            }}
            {{ view && view.hasKey ? ` · 密钥 ${view.keyMask}` : " · 尚未存密钥" }}
          </p>
          <p v-if="error" class="provider-error">{{ error }}</p>
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

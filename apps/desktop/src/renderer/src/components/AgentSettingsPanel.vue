<!--
  智能体设置页（设置浮层的「智能体」页签）：写盘权限档 + 发送键 + 联网搜索默认档 + 记住思考档。
  这些都不新造真身：权限档调 book.setPermissionMode（写进 book.json，与输入卡那枚 chip、
  /permission 命令同一处），联网档调 agent.toggleWebSearch，思考档记忆调 agent.toggleThinkingRemember
  （两枚记忆档都住 utils/*-preference，走 localStorage，零新 IPC）；发送键是键位裁决的输入，
  真身在 utils/hotkeys（resolveHotkey），这里只写偏好档、下次按键即生效。
  档位说明与选项表在 utils/*-preference / permission-settings——`.vue` 不过 tsc，文案表放这里就没有关卡。
  布局（2026-10-05 用户裁定修版）：档位选择是 agent-mode-grid 的可选卡——
  上一版把 settings-item（给 div 行设计的）直接套在 button 上，UA 按钮底色/居中/收缩全漏出来。
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { PermissionMode } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { permissionOptions } from "../utils/permission-settings";
import {
  loadSubmitKey,
  saveSubmitKey,
  submitKeyOptions,
  submitKeyPreferenceStorage,
  type SubmitKey
} from "../utils/send-key-preference";
import { useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const book = useBookStore();
const agent = useAgentStore();

const options = permissionOptions();
const currentMode = computed(() => book.meta?.permissionMode ?? null);

/**
 * 无书时不禁用按钮：点了是真响应——setPermissionMode 自己会回一句中文 notice（「还没打开作品目录…」）。
 * 禁用会把「为什么改不了」藏起来，那是本仓禁的那类灰按钮。
 */
function chooseMode(mode: PermissionMode): void {
  void book.setPermissionMode(mode);
}

function toggleWebSearchDefault(): void {
  agent.toggleWebSearch();
}

function toggleThinkingRemembered(): void {
  agent.toggleThinkingRemember();
}

/** 发送键（2026-10-05）：读偏好起档，点卡写偏好——键位裁决每次按键重读，下一键即生效。 */
const submitKeys = submitKeyOptions();
const currentSubmitKey = ref<SubmitKey>(loadSubmitKey(submitKeyPreferenceStorage()));

function chooseSubmitKey(value: SubmitKey): void {
  const storage = submitKeyPreferenceStorage();
  if (storage !== null) saveSubmitKey(storage, value);
  currentSubmitKey.value = value;
}
</script>

<template>
  <section class="settings-group">
    <h2 class="settings-group-title">写盘权限档</h2>
    <div class="agent-mode-grid" role="group" aria-label="写盘权限档">
      <button
        v-for="option in options"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': currentMode === option.value }"
        type="button"
        :aria-pressed="currentMode === option.value"
        @click="chooseMode(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="currentMode === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <!-- 档位真身住在每本书的 book.json（chooseMode 调 book.setPermissionMode）：
         无书时 currentMode 为 null，三张卡全不亮是**语义正确**的——但不说这句，
         用户只会觉得「选中态坏了」（2026-10-14 真机截图）。 -->
    <p v-if="currentMode === null" class="settings-group-note">
      三张卡都没亮是正常的：档位跟着每一本书走，还没打开作品就还没有「当前档」。选定后写进那本书。
    </p>
    <p class="settings-group-note">
      换档只影响之后发起的那几轮；已经生成待审的提案仍旧逐条等你批准。
    </p>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">发送键</h2>
    <div class="agent-mode-grid" role="group" aria-label="发送键">
      <button
        v-for="option in submitKeys"
        :key="option.value"
        class="agent-mode-card"
        :class="{ 'is-active': currentSubmitKey === option.value }"
        type="button"
        :aria-pressed="currentSubmitKey === option.value"
        @click="chooseSubmitKey(option.value)"
      >
        <span class="agent-mode-head">
          <strong>{{ option.label }}</strong>
          <AppIcon v-if="currentSubmitKey === option.value" name="check" :size="15" />
        </span>
        <small>{{ option.note }}</small>
      </button>
    </div>
    <p class="settings-group-note">改完下一下按键就生效；正在生成的轮次不受影响，排队仍用 Tab。</p>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">联网搜索</h2>
    <div class="settings-card">
      <div class="settings-item">
        <span class="settings-item-text">
          <strong>默认带上 web_search</strong>
          <small
            >关着的时候模型手上没有这枚工具，它只能用你书稿里的字和你自己打的字回答（跟模型 API
            本来就要出网是两回事）；输入卡那枚 chip
            仍可临时开关，切完就被记住，下次启动照这一档。</small
          >
        </span>
        <label class="provider-switch" aria-label="默认带上联网搜索">
          <input
            type="checkbox"
            :checked="agent.webSearchEnabled"
            @change="toggleWebSearchDefault"
          />
          <span class="provider-switch-slider" />
        </label>
      </div>
      <div class="settings-item">
        <span class="settings-item-text">
          <small>
            搜索走内置免费源，不需要 API Key：先试 DuckDuckGo，连不上自动退到 360
            搜索，回执里会写明这一条是谁答的。
            搜到的东西要留下，得让它整理成文稿写进素材库或技能库。
          </small>
        </span>
      </div>
    </div>
  </section>

  <section class="settings-group">
    <h2 class="settings-group-title">深度思考</h2>
    <div class="settings-card">
      <div class="settings-item">
        <span class="settings-item-text">
          <strong>记住思考档</strong>
          <small
            >开着时，输入卡上切完的思考档位会被记住，下次启动照那一档开始；
            关着则每次启动都从「关」开始，切档不留痕。</small
          >
        </span>
        <label class="provider-switch" aria-label="记住思考档">
          <input
            type="checkbox"
            :checked="agent.thinkingRemembered"
            @change="toggleThinkingRemembered"
          />
          <span class="provider-switch-slider" />
        </label>
      </div>
      <div class="settings-item">
        <span class="settings-item-text">
          <small>
            档位只在启动时生效一次；这一轮发什么仍由输入卡那枚 chip 说了算，两处不互相冒充。
          </small>
        </span>
      </div>
    </div>
  </section>
</template>

<!-- 关于面板（设置中心「关于」分类）。
     版本号真身是 apps/desktop/package.json，经 electron.vite.config 的 renderer.define
     注入 import.meta.env.APP_VERSION——这里不许写死第二份。
     第三方归属与许可信息住在仓库 docs/ATTRIBUTION.md 与 LICENSE-DEEPWRITE.txt，不进 UI 文案。
     「检查更新」（2026-10-10）：真身是主进程 auto-update.ts——更新源由 MOCHEN_UPDATE_URL 配，
     没配回 disabled（如实说「没配」，不报错）。检查只报告不下载，装不装是用户的决定。
     卡片外壳是 settings-page.css 的 settings-card。 -->
<script setup lang="ts">
import { ref } from "vue";
import type { UpdateCheckResult } from "@mochen/contracts";

const FACTS: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "版本",
    detail: `墨宸 AI ${import.meta.env.APP_VERSION}，运行在你自己的机器上。`
  },
  {
    term: "文稿",
    detail: "书籍文稿保存在你选定的文件夹，Ctrl+O 可随时更换目录。"
  },
  {
    term: "配置",
    detail:
      "外观设置与模型配置保存在本机 appData/mochen-ai；开发版另存一份在 appData/mochen-ai-dev，两份互不覆盖。外观数据损坏时自动退回默认值，不挡启动。"
  },
  {
    term: "密钥",
    detail: "密钥明文只进主进程落盘，渲染层永远读不回已存的明文，也不会随文稿写进任何文件。"
  }
];

const checking = ref(false);
const result = ref<UpdateCheckResult | null>(null);

/** 检查只「说」不下载：拿到哪一档就原样展示哪一档，文案在主进程那份里。 */
async function checkNow(): Promise<void> {
  checking.value = true;
  try {
    result.value = await window.mochen.updateCheck();
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <section class="settings-group">
    <dl class="about-facts settings-card">
      <div v-for="fact in FACTS" :key="fact.term" class="about-fact settings-item">
        <dt class="about-term settings-item-text">
          <strong>{{ fact.term }}</strong>
        </dt>
        <dd class="about-detail settings-item-value">{{ fact.detail }}</dd>
      </div>
    </dl>
    <div class="settings-card about-update">
      <div class="settings-item">
        <div class="settings-item-text">
          <strong>更新</strong>
          <p v-if="result !== null" class="about-detail">{{ result.note }}</p>
        </div>
        <button
          class="dialog-secondary-button"
          type="button"
          :disabled="checking"
          @click="checkNow"
        >
          {{ checking ? "检查中…" : "检查更新" }}
        </button>
      </div>
    </div>
  </section>
</template>

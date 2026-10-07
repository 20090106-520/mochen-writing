<!-- 关于面板（设置中心「关于」分类）。
     版本号真身是 apps/desktop/package.json，经 electron.vite.config 的 renderer.define
     注入 import.meta.env.APP_VERSION——这里不许写死第二份。纯信息页，没有按钮——没有动作就不摆按钮。
     第三方归属与许可信息住在仓库 docs/ATTRIBUTION.md 与 LICENSE-DEEPWRITE.txt，不进 UI 文案。
     卡片外壳是 settings-page.css 的 settings-card。 -->
<script setup lang="ts">
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
      "外观设置与模型配置保存在本机 appData/mochen-ai；外观数据损坏时自动退回默认值，不挡启动。"
  },
  {
    term: "密钥",
    detail: "密钥明文只进主进程落盘，渲染层永远读不回已存的明文，也不会随文稿写进任何文件。"
  }
];
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
  </section>
</template>

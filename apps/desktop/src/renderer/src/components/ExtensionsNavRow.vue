<!-- 技能库与插件在中栏里的那两处（2026-10-07 批次 5-㉚ 引入，5-㉛ 改成整页，5-㉜ 退回中栏）。
     这两枚钮指向**中栏的两个不同地方**，各自指名：点「技能库」进来就在技能库、
     点「插件」进来就在插件，不必进去再选一次。第三处「皮肤广场」照同一条裁定挂进来。

     为什么住在这个组件里（而不是几行写在 LeftSidebar 里）：
     ① 左栏贴着 800 行预算；② 更要紧的是**它们与「工作台」那一枚争同一格高亮**——
     左栏哪一枚亮着，就是在说「你在这儿」。四个入口的 active 判定因此必须一起改，
     分成两处的话，改一处忘一处就会出现两枚同时亮（用户批注里的那个坑）。
     于是「工作台 / 技能库 / 插件」这三枚的同一条绑定链全在这一块里。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { PLUGINS_HINT, SKILLS_HINT, SKINS_HINT } from "../utils/side-nav";

/**
 * 真身是 `layout.showCenter` —— 与 `/skills` `/plugins` 两个斜杠命令同一条通路，
 * 所以三处不许各派发一次动作（那会多出一条不在命令表里的隐通路）。
 */
const layout = useLayoutStore();
</script>

<template>
  <button
    class="nav-row"
    type="button"
    data-nav-id="skills"
    :title="SKILLS_HINT"
    :class="{ 'is-active': layout.centerView === 'skills' }"
    :aria-current="layout.centerView === 'skills' ? 'page' : undefined"
    @click="layout.showCenter('skills')"
  >
    <AppIcon name="library" :size="17" />
    <span>技能库</span>
  </button>

  <button
    class="nav-row"
    type="button"
    data-nav-id="plugins"
    :title="PLUGINS_HINT"
    :class="{ 'is-active': layout.centerView === 'plugins' }"
    :aria-current="layout.centerView === 'plugins' ? 'page' : undefined"
    @click="layout.showCenter('plugins')"
  >
    <AppIcon name="plus" :size="17" />
    <span>插件</span>
  </button>

  <!-- 皮肤广场（批次 5-㊴）。第四枚入口，于是它与上面三枚争的是**同一格高亮**——
       「工作台」的 active 判定在 LeftSidebar 里读 centerView === 'chat'，
       这一枚读 'skins'，两者互斥这件事只在这一条绑定链上判一次。 -->
  <button
    class="nav-row"
    type="button"
    data-nav-id="skins"
    :title="SKINS_HINT"
    :class="{ 'is-active': layout.centerView === 'skins' }"
    :aria-current="layout.centerView === 'skins' ? 'page' : undefined"
    @click="layout.showCenter('skins')"
  >
    <AppIcon name="wand" :size="17" />
    <span>皮肤广场</span>
  </button>
</template>

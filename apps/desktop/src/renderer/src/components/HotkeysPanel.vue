<!-- 设置中心「快捷键」分类：展示表数据真身在 utils/hotkey-guide.ts，
     判定真身在 utils/hotkeys.ts / escape-policy.ts（一致性由 hotkey-guide.test.ts 钉死）。
     本组件只渲染，不持有任何键位文案（铁律 6：同一文案只许一份实现）。
     卡片外壳是 settings-page.css 的 settings-card（deepwrite 设置中心形态）。 -->
<script setup lang="ts">
import { ESCAPE_NOTE_PREFIX, ESCAPE_POLICY_SUMMARY, HOTKEY_GUIDE } from "../utils/hotkey-guide";
</script>

<template>
  <section class="settings-group">
    <div v-for="group in HOTKEY_GUIDE" :key="group.title" class="settings-card">
      <h3 class="hotkeys-group-title">{{ group.title }}</h3>
      <table class="hotkeys-table">
        <tbody>
          <tr v-for="row in group.rows" :key="row.keys + row.label">
            <th class="hotkeys-keys" scope="row">
              <kbd>{{ row.keys }}</kbd>
            </th>
            <td class="hotkeys-label">{{ row.label }}</td>
            <td class="hotkeys-when">{{ row.when }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hotkeys-escape-note">{{ ESCAPE_NOTE_PREFIX }}{{ ESCAPE_POLICY_SUMMARY }}</p>
  </section>
</template>

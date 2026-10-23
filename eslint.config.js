import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // scratch/** 与 .mochen-tmp/** 是真机冒烟 / 抢救证据用的一次性文件：它们都住在 .gitignore 里，
  // 因此永远不可能被提交、不可能进产物——lint 它们只会逼人删证据或改窄门禁。
  // prettier 默认就跳过 gitignored 文件，eslint 不跳，所以只有这一段会咬。
  // .superpowers/** 同理，而且它是整目录被 .superpowers/sdd/.gitignore 兜住的：
  // 里面放的是 CDP 真机巡检脚本与矢量素材生成器，一次跑完就作废，不进任何产物。
  // .superdesign/** 是设计线（Superdesign 分享板）的本地草稿工作区：build-*.mjs 生成的示意稿
  // HTML/PNG 与导入回执，65 MB 全可再生，且那份 JSON 是 UTF-16 存的——prettier 逐字节读会当成坏文件。
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "scratch/**",
      ".mochen-tmp/**",
      ".superpowers/**",
      ".superdesign/**",
      // CodeArts 编辑工具的临时目录（检查点备份 / accept 快照）：会持续生成 .vue/.ts，
      // 且它自带 .gitignore、永不进版本控制——lint 它只会把工具产物当源码报错。
      ".codeartsdoer/**",
      // 第三方原样搬入的脚本（2026-10-21）：Emotion Ball 引擎是零依赖 IIFE，
      // 改它等于改上游源码；本仓自己的接线都在同目录的 index.ts facade 里。
      "apps/desktop/src/renderer/src/vendor/emotion-ball/*.js"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "vue/multi-word-component-names": "off"
    }
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser }
    }
  },
  prettier
);

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
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "scratch/**",
      ".mochen-tmp/**",
      ".superpowers/**"
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

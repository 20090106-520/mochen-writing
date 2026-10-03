import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // scratch/** 是真机冒烟用的一次性 CDP 探针：它住在 .gitignore 里，
  // 因此永远不可能被提交、不可能进产物——lint 它只会逼人删证据或改窄门禁。
  // prettier 默认就跳过 gitignored 文件，eslint 不跳，所以只有这一段会咬。
  { ignores: ["**/node_modules/**", "**/out/**", "**/dist/**", "scratch/**"] },
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

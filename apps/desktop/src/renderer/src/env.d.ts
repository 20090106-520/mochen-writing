// electron.vite.config.ts 的 renderer.define 注入的应用版本
// （单一真源：apps/desktop/package.json；展示处：components/AboutPanel.vue）。
interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

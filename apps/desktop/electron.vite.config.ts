import vue from "@vitejs/plugin-vue";
import { defineConfig } from "electron-vite";

export default defineConfig({
  // workspace 包发布的是 TS 源码，必须打进主进程产物，不能让 Electron 直接 import .ts
  main: {
    build: {
      lib: { entry: "src/main/index.ts" },
      externalizeDeps: { exclude: ["@mochen/contracts", "@mochen/fs-store"] }
    }
  },
  preload: {
    build: {
      lib: { entry: "src/preload/index.ts" },
      externalizeDeps: { exclude: ["@mochen/contracts"] }
    }
  },
  renderer: {
    plugins: [vue()]
  }
});

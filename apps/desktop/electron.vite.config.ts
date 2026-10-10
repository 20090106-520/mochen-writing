import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
// CSP 的策略与插入位置都在这一份里（P1-8）：开发态与打包态各一条，装配点只负责挂上。
import { rendererCspPlugin } from "./src/main/renderer-csp.js";

// 版本号的单一真源是 apps/desktop/package.json：这里读进来 define 进 import.meta.env，
// 渲染层「关于」页展示它——不许在页面里再写死一份版本字符串。
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")
) as { version: string };

export default defineConfig({
  // workspace 包发布的是 TS 源码，必须打进主进程产物，不能让 Electron 直接 import .ts
  main: {
    build: {
      lib: { entry: "src/main/index.ts" },
      externalizeDeps: {
        // plugin-kernel 必须在 exclude 里：它是**代码常量**的一部分（适配层要从全局取它），
        // 留在磁盘上被 externalize 的话，插件的 import 找不到任何一个能解析的文件。
        exclude: [
          "@mochen/contracts",
          "@mochen/fs-store",
          "@mochen/agent-runtime",
          "@mochen/plugin-kernel"
        ]
      }
    }
  },
  preload: {
    build: {
      lib: { entry: "src/preload/index.ts" },
      externalizeDeps: { exclude: ["@mochen/contracts"] }
    }
  },
  renderer: {
    // 顺序要紧：`rendererCspPlugin` 在 `configResolved` 里按 command 选策略，
    // 打包产物与开发服务端各自拿到自己那一条（两态共用一条会同时导致「白屏」与「白装」）。
    plugins: [vue(), rendererCspPlugin()],
    define: {
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version)
    }
  }
});

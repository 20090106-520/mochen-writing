import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";

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
    plugins: [vue()],
    define: {
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version)
    }
  }
});

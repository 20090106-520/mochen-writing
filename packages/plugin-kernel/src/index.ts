/**
 * 插件运行时（内核 + 装卸 + 事件）。
 *
 * 名字与导出刻意贴着官方文档用到的那些：插件源码写的是
 * `import { Service, defineTool, type Context } from "@deepseek-ai/cordis"`，
 * 装的时候把这句映射到本包（见 apps/desktop/src/main/plugin-loader.ts 的 import 改写），
 * 于是**按官方文档写的插件不用改一行**就能挂进来。
 */
export { createPluginApp } from "./app.js";
export type { MountedPlugin, PluginApp, PluginAppOptions } from "./app.js";
export { Service } from "./service.js";
export { defineTool, readPluginShape } from "./types.js";
export type {
  Context,
  DocsService,
  JsonSchema,
  PluginDoc,
  PluginModule,
  ServiceHandle,
  ToolDefinition,
  ToolResult,
  ToolsService
} from "./types.js";

export * from "./paths.js";
export * from "./atomic-write.js";
export * from "./write-queue.js";
export * from "./book-meta.js";
export * from "./book-data.js";
export * from "./fingerprint.js";
export * from "./frontmatter.js";
export * from "./scan.js";
export * from "./skills.js";
export * from "./read-write.js";
export * from "./changes.js";
// 默认档（`DEFAULT_CHANGE_RETENTION`）**刻意不**从这里再导出：contracts 里有一个同名同值的
// 导出，两个包一起用时同名符号会打架。它在 fs-store 内部用相对路径引就够了。
//
// 但**取值范围的四个界**要导出来：主进程那一侧的跨包一致性测试（change-retention-defaults.test.ts）
// 必须能同时 import 到两边的界，逐个比对数值——不导出来就只能拿源码正则比文本，
// 而文本比对会在 prettier 折行时假红（这坑 5-⑧ 已经踩过一次）。
// 名字与 contracts 那边刻意不同（CHANGE_KEEP_* vs CHANGE_RETENTION_*），不撞名。
export {
  CHANGE_KEEP_COUNT_MAX,
  CHANGE_KEEP_COUNT_MIN,
  CHANGE_KEEP_BYTES_MAX,
  CHANGE_KEEP_BYTES_MIN
} from "./retention-defaults.js";
export * from "./create.js";
export * from "./export-service.js";

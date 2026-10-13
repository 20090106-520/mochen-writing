import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/desktop/src/**/*.test.ts", "tools/*.test.mjs"],
    environment: "node",
    maxWorkers: 4,
    // 两份报告各管一个读者：default 给终端（逐文件条数只有它看得见），junit 给 CI 的报数通路
    // （`tools/ci-test-summary.mjs` 读 test-results/junit.xml 把总数写成 annotation——
    // Linux 侧那个数否则只能推，见扫描总单第五十三节）。路径与标题的真身在工具里，
    // 这里的字面量由 tools/ci-test-summary.test.mjs 对表，改一边当场红。
    reporters: [["default"], ["junit", { outputFile: "test-results/junit.xml" }]]
  }
});

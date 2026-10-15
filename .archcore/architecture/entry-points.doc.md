---
title: "Entry-point inventory"
status: accepted
tags:
  - "architecture"
  - "entry-points"
---

## Overview

本仓的可执行入口清单：三处进程入口、若干闸与生成器脚本、一个本地假模型服务、一条 CI 工作流。按改动类型定位入口用。

### Scope

包含：HTTP 端点、CLI 脚本、进程入口、CI 工作流。

不包含：测试文件本身（它们由 Vitest 发现，不走入口）；`scratch/deepwrite-ref/` 下的任何文件。

## Content

### HTTP

- `tools/mock-provider.mjs` — 本地假模型服务，OpenAI 兼容，默认端口 8787（`pnpm mock-provider`）。

### CLI

- `tools/check-package-boundary.mjs` — 包边界闸，`pnpm lint:boundary`。
- `tools/check-source-line-budget.mjs` — 单文件 800 行预算闸，`pnpm lint:budget`。
- `tools/build-brand-icons.mjs` — 品牌图标构建。
- `tools/ci-test-summary.mjs` — 把 CI 的测试数写成一条 check-run annotation。
- `apps/desktop/scripts/gen-scene-svgs.mjs` — 皮肤场景画生成器，配 `scene-palettes.mjs` 配色表。
- `apps/desktop/scripts/check-scene-art.mjs` — 三道像素闸 G1/G2/G3，`pnpm --filter @mochen/desktop check:scene-art`。

### Other

- `apps/desktop/src/main/index.ts` — Electron 主进程入口：服务编排、插件宿主、审批读取、提示词装配。
- `apps/desktop/src/preload/index.ts` — IPC 桥入口，界面能调的那一面在这里收口。
- `apps/desktop/src/renderer/src/main.ts` — 渲染层入口，Vue 3 应用挂载点。
- `.github/workflows/verify.yml` — CI：push 与 pull_request 上跑同一条 `pnpm verify`，`--frozen-lockfile` 装依赖，一步都不包进管道。

### Workers

无。本仓不含 Worker / 队列。

### Cron / scheduled

无。所有动作由界面或命令触发。

## Examples

### Example 1: 改出站形状时先看入口

出站字段名的唯一映射住在 `packages/agent-runtime/`，而请求由 `apps/desktop/src/main/` 装配。

```sh
pnpm --filter @mochen/agent-runtime test
```

### Example 2: 本地复现 CI

```sh
pnpm verify
```

## Best Practices

- 新增 CLI 脚本时同时进 `tools/`（闸类）或 `apps/desktop/scripts/`（产品资产类），不要混放。
- CI 只能证明推上去的那棵树是绿的；本机仍要自己跑一次 `pnpm verify`。
- 动 `verify.yml` 之前看门面那句作业名——它也是三处口径之一，有闸盯着。

## FAQ

### Q: 为什么没有定时任务入口？

本仓是本地桌面端，没有云端同步与多端；所有动作由界面或命令触发，数据就是本地文件。

### Q: 测试算不算入口？

不算。它们由 Vitest 按 `vitest.config.ts` 发现，不通过任何入口清单调用。

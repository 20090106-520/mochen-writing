---
title: "Running the project locally"
status: accepted
tags:
  - "onboarding"
---

## Overview

在一台新机器上把「墨宸 AI」跑起来：装依赖、起本地假模型服务、起开发实例、跑门禁。整条链路不联网也能通。

### Target Audience

- 首次克隆本仓库的贡献者：拿到可开发的实例。
- 排查门禁红项的贡献者：知道哪条命令复现。

### Time Estimate

首次约 10 分钟（装依赖占大头）。

## Prerequisites

### Required Knowledge

- Electron 主进程 / preload / 渲染进程三层的分工。
- pnpm workspace 过滤语法（`--filter`）。

### Required Tools

- Node.js >=24.0.0（见根 `package.json` 的 `engines`）。
- pnpm >=11.0.0，由 corepack 提供；实际锚定版本见 `packageManager` 字段（pnpm@11.7.0）。

### Required Access

- 无。模型地址与密钥在界面里配，仓库里没有也不该有凭据文件。

## Steps

1. 装依赖：`pnpm install`。

   ```sh
   pnpm install
   ```

   **Expected result:** workspace 各包链接完成，无 peer 冲突报错。

2. 起本地假模型服务，监听 8787。

   ```sh
   pnpm mock-provider
   ```

   **Expected result:** 终端打印监听端口，接口形状为 OpenAI 兼容。

3. 起开发实例。

   ```sh
   pnpm dev
   ```

   **Expected result:** Electron 窗口起来；模型地址与密钥在界面里配（连接 + 档案两层）。

4. 构建后起一次真实例做冒烟。

   ```sh
   pnpm build && pnpm smoke
   ```

   **Expected result:** 构建产物落地，真实例起窗无白屏。

5. 提交前跑门禁。

   ```sh
   pnpm verify
   ```

   **Expected result:** 六段全绿并打印 `VERIFY_EXIT=0`。

## Verification

1. `pnpm dev` 起的窗口里能切六个墨宸档案，切失败的理由摆在界面上而不是静默回退。
2. `pnpm mock-provider` 在场时发一轮对话，工具清单显示 6 枚（联网开）或 5 枚（联网关）。
3. `pnpm verify` 打印 `VERIFY_EXIT=0`。

## Common Issues

### Issue 1: `pnpm` 不是预期版本

**Cause:** 没走 corepack，用了系统里另一个 pnpm。

**Solution:**

```sh
corepack enable && corepack pnpm --version
```

### Issue 2: 界面空白或模型不回话

**Cause:** 模型端点没配或假模型服务没起。

**Solution:** 先起 `pnpm mock-provider`，再把界面里的连接指到 8787。吞掉异常换一次「看起来正常」的白屏，比报错严重——失败必须可见。

### Issue 3: 门禁在单文件行数那一段红

**Cause:** 某个文件贴到 800 行预算。

**Solution:** 跑 `pnpm lint:budget` 看是哪个文件，按「不共享状态」拆开，不是按「注释太多」拆。

## Next Steps

- 理解目录分工：见 `.archcore/architecture/top-level-map.doc.md`。
- 改动前先看约束：跑 `/archcore:context <path>`。
- 门禁由哪几段组成：见 README 的「门禁：`pnpm verify`」一节与 `tools/readme-gate-composition.test.mjs`。

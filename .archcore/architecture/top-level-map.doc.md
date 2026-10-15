---
title: "Top-level domain map"
status: accepted
tags:
  - "architecture"
  - "top-level-map"
---

## Overview

本仓库是 pnpm workspace 单仓多包：界面与主进程住在 `apps/desktop`，跨进程契约与两组运行时能力拆在 `packages/*`，闸与假模型服务住在 `tools/`。这份地图给改动前的定位用。

### Scope

包含：

- 五个顶层域的路径、模块规模与职责一句话。
- 约定俗成的根目录（apps / packages / tools / docs）。
- 需要深挖某个域时怎么走。

不包含：

- 单文件级的实现细节。
- 皮肤广场那套像素闸的内部判据。
- `scratch/deepwrite-ref/` 上游参照副本（不算本仓的域）。

## Content

### 顶层域

| Domain        | Path                     | Modules | Summary                                                                              |
| ------------- | ------------------------ | ------- | ------------------------------------------------------------------------------------ |
| desktop-app   | `apps/desktop`           | 145     | Electron 主进程（服务编排、插件宿主、审批读取、提示词装配）+ preload 桥 + Vue 3 界面 |
| contracts     | `packages/contracts`     | 13      | 跨进程共享的 zod 契约与工具 / 档案 / 皮肤的表                                        |
| fs-store      | `packages/fs-store`      | 9       | 作品目录读写、变更历史、技能装载                                                     |
| agent-runtime | `packages/agent-runtime` | 7       | 与模型对话的运行时：流式解析、工具调用、每轮出站字段                                 |
| plugin-kernel | `packages/plugin-kernel` | 2       | 插件宿主内核                                                                         |

模块数按 >100 LOC 的源码文件计（测试与生成产物不计入），2026-10-15 当场数得合计 176。

### 约定俗成的根

- workspace 范围由 `pnpm-workspace.yaml` 定为 `apps/*` 与 `packages/*`；两者之外的目录都不算包。
- `tools/` — 边界、行数、门面主张、图标容器这些闸的实现，以及本地假模型服务 `mock-provider.mjs`。
- `apps/desktop/scripts/` — 皮肤场景画生成器与三道像素闸 G1/G2/G3（刻意留在 `apps/` 下，不进 `tools/`）。
- `docs/superpowers/plans/` — 逐批实现计划与「本轮真机量到了什么」的账（中文）。

### 怎么深挖一个域

- `/archcore:context domain:<slug>` 把查询限定到某个域。
- `/archcore:init --domain=<name>` 对一个域做一轮聚焦的 seed。
- 某个热点模块单独成文：`/archcore:capture <path>`。

## Examples

### Example 1: 从现象定位到域

改动「审批前写盘」的行为时，按职责拆：审批读取与写盘闸在 `apps/desktop/src/main/`，待写入动作的形状在 `packages/contracts/`，实际落盘在 `packages/fs-store/`。

```sh
pnpm --filter @mochen/desktop test
```

### Example 2: 只跑一个包的门禁

```sh
pnpm --filter @mochen/desktop check:scene-art
```

## Best Practices

- 改代码前先跑 `/archcore:context <文件>`，看上来的规则与既有决定是否绑住这次改动。
- 跨进程数据形状一律回到 `packages/contracts`，不要在消费侧就地复制形状。
- 新增源码目录后立刻确认它被某个 tsconfig 覆盖，否则 `tools/typecheck-coverage.test.mjs` 会红。

## FAQ

### Q: 目录名为什么还叫「深渊写作」？

品牌定稿为「墨宸 AI」，仓库与本地目录沿用了旧名，这是故意的。

### Q: `scratch/` 里的 deepwrite-ref 算不算一个域？

不算。那是上游参照副本，只用于出处对照；真正的逐文件对照表在 `docs/ATTRIBUTION.md`。

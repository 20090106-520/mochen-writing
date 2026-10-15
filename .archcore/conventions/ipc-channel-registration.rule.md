---
title: "IPC channels register in three places"
status: accepted
tags:
  - "conventions"
  - "ipc"
---

## Description

新增 IPC 通道必须三处齐备：带参的进形状表，无参的进无参清单，失败回会按契约档配一条。

## Rule

1. WHEN 新增一条 IPC 通道，the 贡献者 MUST 把它登记进带参形状表或无参清单之一。Applies to `apps/desktop/src/**`.
2. WHEN 新增一条 IPC 通道，the 贡献者 MUST 为它配一条按契约的失败回会。Applies to `apps/desktop/src/main/**`.
3. WHEN 新增一条 RendererApi 方法，the 贡献者 MUST 同步补对应的 mock 夹具。Applies to 渲染层测试夹具.

## Rationale

「形状表 ∪ 无参清单 = 全部要收的通道」这条并集由用例钉着；漏一处就是一条没人看着的通道。渲染层夹具不同步，web 侧 tsc 会红一片。

## Examples

### Good

```ts
// 带参通道：进 IPC_ARG_SHAPES，并在 IPC_DENY_REPLIES 配回会
```

### Bad

```ts
// 只在 handler 里注册，三处登记表都没写
```

## Exceptions

- 无。

## Enforcement

- `tools/ipc-guard.test.ts` 的并集用例。
- 渲染层 mock fixture 的类型检查。

---
title: "800-line source budget is hard"
status: accepted
tags:
  - "budget"
  - "conventions"
---

## Description

单文件 800 行预算是硬的。贴到 800 行就拆，拆的依据是「不共享状态」，不是「注释太多」。

## Rule

1. WHEN 一个源码文件贴到 800 行，the 贡献者 MUST 先拆分再提交。Applies to `apps/**`, `packages/**`, `tools/**`.
2. WHEN 拆分，the 贡献者 MUST 按「不共享状态」切边界。Applies to `apps/**`, `packages/**`, `tools/**`.
3. IF 拆分只以减少注释为由，THEN the 贡献者 MUST NOT 采用该拆法。

## Rationale

这条预算第一次红在守卫自己身上：`tools/readme-claims.test.mjs` 写到 832 行被判红（2026-10-13 第五十二节），随后按「不共享状态」把「门禁由哪几段组成」那一族搬成 `tools/readme-gate-composition.test.mjs`。

## Examples

### Good

```sh
pnpm lint:budget   # 先看是哪个文件贴顶
```

### Bad

```sh
# 删注释腾行数：边界没变，下一刀还会红
```

## Exceptions

- 生成产物与上游参照副本不在预算内。

## Enforcement

- `tools/check-source-line-budget.mjs`，由 `pnpm lint:budget` 跑。

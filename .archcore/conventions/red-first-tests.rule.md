---
title: "Assertions must be able to prove themselves red"
status: accepted
tags:
  - "conventions"
  - "testing"
---

## Description

断言要能证明它会红。新功能一律先反向用例（先红）再实现（转绿），提交前自跑一次变异。

## Rule

1. WHEN 新增一项行为，the 贡献者 MUST 先写出能红的反向用例。Applies to `**/*.test.ts`.
2. WHEN 提交前，the 贡献者 MUST 自跑一次变异，验证边界逻辑。
3. WHEN 加一条断言，the 贡献者 MUST 给它一条可失败的路径。

## Rationale

只加绿断言的门禁会长成一堵不会红的墙：读起来像在看守，实际一次都不会响。

## Examples

### Good

```ts
// 把判据改坏，这条必须红
expect(verdict).toBe("guard");
```

### Bad

```ts
// 只写 happy path，判据改坏也不红
expect(verdict).toBeDefined();
```

## Exceptions

- 纯文案与纯样式改动。

## Enforcement

- 提交前自跑变异。
- `tools/readme-claims.test.mjs` 与 `tools/readme-provenance.test.mjs` 的用例数闸。

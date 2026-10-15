---
title: "One outbound field name maps in one place"
status: accepted
tags:
  - "api"
  - "conventions"
---

## Description

出站请求的每个字段名只允许有一处映射点。这条管的是「报不出出站字段名的控件不许进界面」那个失败模式。

## Rule

1. WHEN 新增或改动一个出站字段，the 贡献者 MUST 在同一处维护它的名称映射。Applies to `packages/agent-runtime/**`, `apps/desktop/src/main/**`.
2. IF 一个界面控件报不出它写入的出站字段名，THEN the 贡献者 MUST NOT 让它进界面。
3. WHEN 出站字段变了，the 贡献者 MUST 同步改盯它的闸与断言。

## Rationale

出站只允许一种形状 `{type:"function", function}` —— 这是真机 400/422 量出来的教训（账在 `docs/superpowers/plans/README.md` 批次 5-㊹、提交 `ef46153`）。字段名散到第二处时，线上只剩一个 400，看不出是谁写的。

## Examples

### Good

```ts
// 映射与消费同处：改一处两边同步
const OUTBOUND_FIELDS = { name: "name", args: "arguments" } as const;
```

### Bad

```ts
// 在界面里就地拼字段名，形成第二处真身
const payload = { name: tool.label, arguments: raw };
```

## Exceptions

- 无。

## Enforcement

- `packages/agent-runtime` 的出站形状测试。
- `manual review` — 新控件报不报得出它写入的字段名。

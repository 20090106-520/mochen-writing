---
title: "Failures must be visible"
status: accepted
tags:
  - "conventions"
  - "errors"
---

## Description

失败必须可见。吞掉异常换一次「看起来正常」的白屏，比报错严重。

## Rule

1. IF 一个操作可能失败，THEN the 贡献者 MUST 让失败以用户可见的方式呈现。Applies to `apps/**`, `packages/**`.
2. WHEN 写 catch，the 贡献者 MUST 至少给出可见回执或界面提示。
3. IF 档案切换失败，THEN the 应用 MUST 把失败理由摆在界面上。Applies to 档案切换.

## Rationale

静默回退把「哪一步坏了」从可诊断变成不可诊断：界面看着一切正常，日志里也没有那一次失败。

## Examples

### Good

```ts
// 失败带着理由回到界面
return { ok: false, reason: "endpoint unreachable" };
```

### Bad

```ts
try {
  await switchProfile();
} catch {}
```

## Exceptions

- 埋点上报失败不影响主流程，允许吞。

## Enforcement

- 各 store 的失败回执断言。
- `manual review` — 新增 catch 是否留了可见出口。

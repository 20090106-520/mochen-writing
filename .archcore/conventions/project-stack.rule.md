---
title: "Project stack"
status: accepted
tags:
  - "conventions"
  - "stack"
---

## Description

本仓库是「墨宸 AI」——长篇小说与长文写作的本地 Agent 桌面端，pnpm workspace 单仓多包。这条规则约束新增代码落在哪一层、用什么界面框架与状态层、用什么测试运行器，避免同一层出现两套并行实现。

## Rule

1. WHEN 编写应用代码，the 贡献者 MUST 使用 TypeScript。Applies to `packages/**`, `apps/**`.
2. WHEN 构建界面，the 贡献者 MUST 用 Vue 3 单文件组件手写实现。Applies to `apps/desktop/src/renderer/**`.
3. IF 需要一个新 UI 能力，THEN the 贡献者 MUST NOT 引入组件库。Applies to `apps/desktop/src/renderer/**`.
4. IF 需要一个新 UI 能力，THEN the 贡献者 MUST NOT 新增 npm 依赖。Applies to `apps/desktop/src/renderer/**`.
5. WHEN 需要跨组件共享状态，the 贡献者 MUST 用 Pinia store 承载。Applies to `apps/desktop/src/renderer/src/stores/**`.
6. WHEN 跨进程共享数据结构，the 贡献者 MUST 在 contracts 包用 zod 定义契约。Applies to `packages/contracts/**`.
7. WHEN 新增用例，the 贡献者 MUST 用 Vitest 作为唯一运行器。Applies to `**/*.test.ts`.

## Rationale

界面与交互层大量照搬开源项目 deepwrite 的同源实现，再叠写作向领域模型、皮肤广场与几道门禁。手写 CSS 自绘是这套栈的既定选择：任何组件库都会把上游的同源实现冲掉，并让出站字段名分散到第二处映射。契约集中在 contracts 包，是因为契约的形状（工具、档案、皮肤、IPC 通道）被主进程与渲染进程同时消费，形状只能有一处真身。

## Examples

### Good

```ts
// 界面自绘：手写 CSS 类，状态走 Pinia store
const busy = computed(() => book.drafting);
```

```ts
// 契约集中定义：zod schema 住在 contracts 包
export const PatchOp = z.object({ path: z.string(), body: z.string() });
```

### Bad

```ts
// 引入组件库顶掉同源实现
import { Button } from "some-ui-kit";
```

```vue
<!-- 在渲染层就地定义跨进程契约，形成第二处真身 -->
<script setup>
const shape = { path: String, body: String };
</script>
```

## Exceptions

- `apps/desktop/src/main/**` 的下游出站字段映射：那是唯一一处允许出现第二份字段名清单的地方，且由 `tools/` 下的闸盯着。
- `scratch/deepwrite-ref/`：上游参照副本，不适用本规则。

## Enforcement

- `tools/no-component-library.test.mjs` — 抓渲染层引入组件库。
- `tools/check-package-boundary.mjs` — 抓跨包越界引用，`pnpm lint:boundary` 跑。
- `tools/typecheck-coverage.test.mjs` — 抓新增源码目录没被任一 tsconfig 覆盖。
- `manual review` — 契约是否该进 contracts 包，仍需人看。

import { compileScript, compileTemplate, parse, type BindingMetadata } from "vue/compiler-sfc";

/**
 * 把一个 `.vue` 单文件组件真编译一遍（2026-10-09 全仓扫描 P1-11）。
 *
 * 为什么用 Vue 自己的编译器而不是再写一份正则守卫：正则守卫判的是"源码里有没有这串字"，
 * 重构换个写法就查不出来，而**编译器判的是这段模板/这段 setup 到底成不成立**。
 * `tsc --listFiles` 里 .vue 计数一直是 0，模板层从来没进过任何静态关卡——
 * 这一份把「语法与绑定」这一层补上，代价是零新依赖（`vue/compiler-sfc` 本来就随 `vue` 分发）。
 *
 * 边界要说清楚：这里**不做类型检查**（那要 `vue-tsc`，本仓没有、离线也装不上），
 * 所以 `vue-shim.d.ts` 把 props 全当 any 那一半问题仍在，见台账 P1-11 条目。
 */
export type SfcCompileResult = {
  readonly ok: boolean;
  /** 每条红都带文件名：整仓扫 165 个文件时，说不出是哪个文件等于没红。 */
  readonly errors: readonly string[];
  /** 模板编译产物（RenderFunction 的代码文本）；没有 <template> 时是空串。 */
  readonly templateCode: string;
};

export function compileSfcSource(source: string, filename: string): SfcCompileResult {
  const errors: string[] = [];
  const { descriptor, errors: parseErrors } = parse(source, { filename });
  for (const error of parseErrors) {
    errors.push(`${filename}: ${describeError(error)}`);
  }

  // `<script setup>` 编译：绑定元数据要在模板编译之前拿到，且它自己会当场报重复声明一类的错。
  let bindings: BindingMetadata | undefined;
  try {
    if (descriptor.scriptSetup || descriptor.script) {
      const script = compileScript(descriptor, { id: filename });
      bindings = script.bindings;
    }
  } catch (error) {
    errors.push(`${filename}: <script> ${describeError(error)}`);
  }

  let templateCode = "";
  if (descriptor.template) {
    const compiled = compileTemplate({
      source: descriptor.template.content,
      filename,
      id: filename,
      // `exactOptionalPropertyTypes: true`：不能把 `bindingMetadata: undefined` 递进去，
      // 只能按有没有分两条路——多写一行，换类型关卡站得住。
      compilerOptions: bindings
        ? { bindingMetadata: bindings, prefixIdentifiers: true }
        : { prefixIdentifiers: true }
    });
    templateCode = compiled.code;
    // 错误收在 `compiled.errors` 里而不是抛出：一个文件里可能有好几处，全列出来才省得来回跑。
    for (const error of compiled.errors) {
      errors.push(`${filename}: <template> ${describeError(error)}`);
    }
  }

  return { ok: errors.length === 0, errors, templateCode };
}

/** Vue 的编译错误有的是对象（带 msg/loc），有的是原生 Error；两种都要能读出一行人话。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as { msg?: string; message?: string; loc?: { start?: { line?: number } } };
    const line = record.loc?.start?.line;
    const message = record.msg ?? record.message ?? JSON.stringify(record);
    return line ? `${message}（模板第 ${line} 行）` : message;
  }
  return String(error);
}

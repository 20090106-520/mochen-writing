/**
 * 模型设置那条通路上的错误文案闸门：只剥两层外壳，不改写、不翻译、不发明新句子。
 * 中文句子始终住在抛它的那一行（主进程 credential-store.ts / provider-settings.ts 的 throw），
 * 屏上看到的脏东西来自两处**包装**：
 * 1. Electron 给每次 `ipcRenderer.invoke` 失败套的 `Error invoking remote method '<通道>': `，
 *    以及它后面那层异常名（`Error:` / `TypeError:`）；
 * 2. 主进程把内核原因插进括注的写法 `（${error.message}）`——里面往往是整段英文报错。
 * 反向边界也要钉住：短而不带空白的英文括注是**产品名**（如 `safeStorage`），不是报错，不许顺手删掉。
 */

const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/;
const EXCEPTION_NAME = /^(?:[A-Za-z][A-Za-z0-9_$]*)?(?:Error|Exception):\s+/;
const PARENTHETICAL = /（[^（）]*）|\([^()]*\)/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** 短到这个长度、又不含空白的括注按「专名」对待：`safeStorage` 要留下，`EBUSY: resource busy…` 要剥掉。 */
const PROPER_NOUN_MAX = 16;

const UNREADABLE = "模型设置没能完成，本机没有报出可读的原因。";

function isKernelNoise(inner: string): boolean {
  if (CJK.test(inner)) return false;
  return /\s/.test(inner) || inner.length > PROPER_NOUN_MAX;
}

export function presentableProviderError(raw: string): string {
  let text = raw.replace(IPC_WRAPPER, "").replace(EXCEPTION_NAME, "");
  text = text.replace(PARENTHETICAL, (whole) => {
    const inner = whole.slice(1, -1);
    return isKernelNoise(inner) ? "" : whole;
  });
  text = text.trim();
  return text === "" ? UNREADABLE : text;
}

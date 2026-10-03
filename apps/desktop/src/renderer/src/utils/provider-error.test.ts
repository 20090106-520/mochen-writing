import { describe, expect, it } from "vitest";
import { presentableProviderError } from "./provider-error";

/**
 * 模型设置那条通路上的错误文案闸门（用户实报：设置浮层把 `Error invoking remote method
 * 'provider:get': Error: …` 原样打在屏上，看完不知道该干什么）。
 * 主进程侧的句子本来就是中文单句（credential-store.ts / provider-settings.ts 的 throw），
 * 脏的是两层外壳：Electron 的 IPC 包装前缀，和 `（${error.message}）` 里夹带的英文内核报错。
 * 这里只剥壳，不改写、不翻译、不发明新句子——中文真身始终住在抛它的那一行。
 */
describe("presentableProviderError · 只剥两层外壳", () => {
  it("剥掉 Electron 的 IPC 包装前缀，并把夹在中间的英文内核报错去掉，中文句子逐字留下", () => {
    const raw =
      "Error invoking remote method 'provider:get': Error: " +
      "密钥读取失败（Unable to open decrypt handle. This should not be an error, please make sure the app has access.）；请在设置里重新填写 API Key。";
    expect(presentableProviderError(raw)).toBe("密钥读取失败；请在设置里重新填写 API Key。");
  });

  // 反向保护一：短且不含空白的括注是**产品名**（safeStorage），不是报错，剥掉它等于把该说的话删了。
  it("短的英文专名括注不许被当成内核报错剥掉", () => {
    const raw = "系统密钥保管不可用（safeStorage），密钥不会以明文落盘；请先在系统里启用凭据保护。";
    expect(presentableProviderError(raw)).toBe(raw);
  });

  // 反向保护二：没有包装前缀时一个字都不许多动——主进程直接抛给本进程的句子已经是成品。
  it("没有 IPC 包装前缀 ⇒ 原样返回，不做任何加工", () => {
    const raw = "模型设置没保存：baseURL 必须以 http:// 或 https:// 开头";
    expect(presentableProviderError(raw)).toBe(raw);
  });

  it("包装前缀后面还跟着 TypeError 这类异常名 ⇒ 一并剥掉", () => {
    const raw = "Error invoking remote method 'provider:save': TypeError: 参数不是合法的对象";
    expect(presentableProviderError(raw)).toBe("参数不是合法的对象");
  });

  it("剥完什么都不剩 ⇒ 给一句中文兜底，绝不把空串或裸英文交给屏上", () => {
    expect(presentableProviderError("Error invoking remote method 'provider:get': Error: ")).toBe(
      "模型设置没能完成，本机没有报出可读的原因。"
    );
    expect(presentableProviderError("")).toBe("模型设置没能完成，本机没有报出可读的原因。");
  });

  it("非全角括号里的英文长句同样剥掉（主进程两种括号都用过）", () => {
    const raw =
      "密钥文件读取失败(EBUSY: resource busy or locked, open 'C:\\x\\secrets.enc')；请检查密钥存储目录是否被占用或有访问权限。";
    expect(presentableProviderError(raw)).toBe(
      "密钥文件读取失败；请检查密钥存储目录是否被占用或有访问权限。"
    );
  });
});

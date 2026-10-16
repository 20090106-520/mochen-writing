import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "../src/export-shared.js";

/**
 * 导出默认文件名的净化：`buildExportContent` 拿它当保存对话框里的默认名
 * （`export-service.ts` 拼 `${safeName}.md`）。
 *
 * 这组用例补的是台账 §六十三 第 3 条留下的那半边——旧实现只换 `/ \ < > : " | * ?` 八样、
 * 截 80 位，比 contracts 的 `sanitizeDocFileName` 少删控制字符、少剥尾点尾空格、少挡
 * Windows 保留名，且全仓零用例。现在它与那一份吃同一档口径。
 */
describe("sanitizeFilename · 与 sanitizeDocFileName 同一档（2026-10-16 收口 §六十三 第 3 条）", () => {
  it("八样非法字符照样换掉，正常书名不误伤", () => {
    expect(sanitizeFilename('a/b\\c<d>e:f"g|h*i?j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeFilename("墨宸·深渊写作 v1.5")).toBe("墨宸·深渊写作 v1.5");
  });

  it("控制字符一律删（旧实现留着：这种名字能落盘，但资源管理器/别的程序一开就炸）", () => {
    expect(sanitizeFilename("开\u0000局\u001f卷")).toBe("开局卷");
  });

  it("尾部的点与空格剥掉（Windows 落盘时会吞掉它们，手写的名字与盘上那个对不上）", () => {
    expect(sanitizeFilename("卷名. ")).toBe("卷名");
    expect(sanitizeFilename("卷名...")).toBe("卷名");
  });

  it("撞 Windows 保留名退回兜底名，不许写成 CON.md（本机实测 fs.writeFile('nul.md') 不报错）", () => {
    expect(sanitizeFilename("CON")).toBe("未命名作品");
    expect(sanitizeFilename("com1.旧稿")).toBe("未命名作品");
  });

  it("净化后为空（纯空格/纯点/空串）退回兜底名，不给保存对话框一个空名", () => {
    expect(sanitizeFilename("   ")).toBe("未命名作品");
    expect(sanitizeFilename("...")).toBe("未命名作品");
    expect(sanitizeFilename("")).toBe("未命名作品");
  });

  it("长度仍封在 80 以内（导出名不进书目录，但要防超长路径）", () => {
    expect(sanitizeFilename("甲".repeat(120)).length).toBe(80);
  });
});

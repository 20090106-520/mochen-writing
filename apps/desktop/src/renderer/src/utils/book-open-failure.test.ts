import { describe, expect, it } from "vitest";
import { openFailureText } from "./book-open-failure";

/**
 * 打开失败的那句话（2026-11-12）。
 *
 * 这一格的输入全来自真实崩法：Electron 把主进程的异常包一层 IPC 前缀再抛到渲染层，
 * 所以原样显示的「错误提示」长这样——
 *
 *   Error invoking remote method 'book:open': Error: ENOENT: no such file or directory,
 *   open 'D:\旧盘\我的书\book.json'
 *
 * 用例因此分两半：英文那半要被翻掉，人话那半（主进程自己写的「无法解析 book.json」）要留着。
 */
describe("openFailureText", () => {
  it("目录被移动 / 删掉：说「找不到目录」，不是把那串 ENOENT 摊给用户", () => {
    const text = openFailureText(
      new Error(
        "Error invoking remote method 'book:open': Error: ENOENT: no such file or directory, open 'D:\\旧盘\\我的书\\book.json'"
      )
    );
    expect(text).toBe("找不到这本书的目录——可能被移动、改名或删掉了。");
    expect(text).not.toContain("ENOENT");
    expect(text).not.toContain("Error invoking");
  });

  it("没有权限：给的是下一步（去看文件夹权限），不是 EACCES", () => {
    const text = openFailureText(
      new Error("Error invoking remote method 'book:open': Error: EACCES: permission denied")
    );
    expect(text).toContain("没有权限");
    expect(text).not.toContain("EACCES");
  });

  it("book.json 坏了：主进程已经写了人话，只摘掉 IPC 前缀，别改写它", () => {
    const text = openFailureText(
      new Error(
        "Error invoking remote method 'book:open': Error: 无法解析 book.json：title 不能为空"
      )
    );
    expect(text).toBe("无法解析 book.json：title 不能为空");
  });

  it("什么都没有：也要给一句话，不许留空让界面哑掉", () => {
    expect(openFailureText(new Error(""))).toContain("打不开这本书");
    expect(openFailureText(undefined)).toContain("打不开这本书");
    expect(openFailureText(null)).toContain("打不开这本书");
  });

  it("不是 Error 而是裸字符串（IPC 异常有时就是字符串）：照样翻", () => {
    expect(openFailureText("ENOENT: no such file or directory")).toContain("找不到这本书的目录");
  });

  it("认不出的错误原样透出：编一句「未知错误」比真话更难查", () => {
    expect(openFailureText(new Error("磁盘配额不够"))).toBe("磁盘配额不够");
  });
});

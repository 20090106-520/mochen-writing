/**
 * 工具卡那一行的人话版（2026-10-07 用户裁定：只显示文字，不用显示代码）。
 *
 * 这份用例的形状与 `change-history.test.ts` 同一路数：**判定必须落在能进类型程序的 .ts 里**，
 * 因为本仓 verify 用裸 tsc（`.vue` 进不去），把它写在组件里就等于没有关卡。
 */
import { describe, expect, it } from "vitest";
import { toolArgsText } from "./tool-args";

const PATCH = JSON.stringify({
  doc: "chapters/01-开局.md",
  anchor: "雾从海面涌上来。 ",
  replace: "海雾涌上来，铁锈味很冲。 ",
  why: "补一层可感的细节"
});

describe("工具卡那一行：人话，不是 JSON", () => {
  it("用户截图那一格原样转成一句话：不再有花括号、引号与字段名", () => {
    const out = toolArgsText("propose_patch", PATCH);
    expect(out.plain).toBe(true);
    expect(out.text).toBe(
      "把《01-开局》里的「雾从海面涌上来。」改成「海雾涌上来，铁锈味很冲。」——补一层可感的细节。"
    );
    // 反自欺：不能只是「短了一点」，JSON 的任何一个记号都不许残留
    expect(out.text).not.toContain("{");
    expect(out.text).not.toContain('"');
    expect(out.text).not.toContain("anchor");
    expect(out.text).not.toContain("replace");
  });

  it("路径只留书名，why 缺席时不硬造一个破折号", () => {
    expect(
      toolArgsText(
        "propose_patch",
        JSON.stringify({ doc: "chapters/a.md", anchor: "甲", replace: "乙" })
      ).text
    ).toBe("把《a》里的「甲」改成「乙」。");
  });

  it("正文太长时首尾各留一段，中间收成省略号（卡上不该摊开整段稿子）", () => {
    const long = "海".repeat(200);
    const out = toolArgsText(
      "propose_patch",
      JSON.stringify({ doc: "d.md", anchor: long, replace: "短" })
    );
    expect(out.text).toContain("…");
    expect(out.text.length).toBeLessThan(120);
    // 尾部必须还在：被裁掉的正是中间，不是结尾
    expect(out.text).toContain("「短」");
  });

  it("另外三枚工具也各有自己的人话，不是同一个模板套", () => {
    expect(
      toolArgsText("write_doc", JSON.stringify({ doc: "plot/x.md", why: "补动机" })).text
    ).toBe("写入《x》——补动机。");
    expect(toolArgsText("read_doc", JSON.stringify({ doc: "chapters/01.md" })).text).toBe(
      "读《01》全文。"
    );
    expect(toolArgsText("web_search", JSON.stringify({ query: "潮汛 灯塔" })).text).toBe(
      "搜「潮汛 灯塔」。"
    );
  });

  /**
   * 兜底不许悄悄吞：参数写坏时那张卡正是排查入口。
   * 把坏 JSON 换成一句「已执行」，等于把唯一的线索毁了。
   */
  it("解析不了就原样摆（且标记它不是人话），绝不换一句漂亮话", () => {
    const broken = "{not json";
    expect(toolArgsText("propose_patch", broken)).toEqual({ text: broken, plain: false });
    expect(toolArgsText("propose_patch", "")).toEqual({ text: "", plain: false });
  });

  it("还没有人话版的工具照旧原样摆：不是所有参数都该被翻译", () => {
    const unknown = JSON.stringify({ foo: 1 });
    expect(toolArgsText("brand_new_tool", unknown)).toEqual({ text: unknown, plain: false });
    // 数组也不是对象，不许被当参数表硬解
    expect(toolArgsText("propose_patch", "[1,2]").plain).toBe(false);
  });
});

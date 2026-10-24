import { describe, expect, it } from "vitest";
import {
  FAILURE_PREFIX,
  humanizeUpstreamError,
  presentableFailureMessage,
  upstreamErrorHint,
  upstreamFailureMessage,
  upstreamMessageOf,
  upstreamSnippet
} from "../src/upstream-error.js";

/**
 * 上游错误 → 人话。**唯一真身**的用例（铁律 6）。
 *
 * 这份判据有两个消费者：主进程（新失败）、渲染层（盘上早就落下来的旧记录）。
 * 两边共用同一份 ⇒ 这里既要钉「新形状翻对了」，也要钉「旧形状也翻对了」。
 *
 * 旧形状是**逐字**从盘上抄的（`Documents\墨宸示例书\.mochen\sessions\2026\10\08\rollout-…jsonl`
 * 第 3 行与第 28 行），不是构造出来的——它们有三个关键特征：
 * ① 裹着 `***.BadRequestError: OpenAIException - ` 这层框架噪声；
 * ② JSON **没闭合**（200 字截断）；
 * ③ 消息裹在 `{"error":{"message":"…"}}` 里面（形状 B 则在顶层 `message`）。
 * 这三条任意一条不成立，判据就会走偏，所以逐字钉。
 */
const OLD_TOOLS_ERROR =
  '模型服务端返回 400：***.BadRequestError: OpenAIException - {"error":{"message":"Invalid JSON data: Failed to deserialize the JSON body into the target type: tools[9].function: missing field `parameters` at line 1 column …"}';
const OLD_THINKING_ERROR =
  '模型服务端返回 400：***.BadRequestError: OpenAIException - {"object":"error","message":"Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.","type":"BadRequest","param":null,"code":400…';

describe("上游错误 → 人话 · 主进程那条通路", () => {
  it("选到图像模型：说清是什么、能去哪换", () => {
    expect(
      humanizeUpstreamError(
        "Model agnes-image-2.1-flash is an image model. Use /v1/images/generations instead."
      )
    ).toBe(
      "「agnes-image-2.1-flash」是图像生成模型，不能用来对话；请在左下角齿轮（设置）里换一个对话模型。"
    );
  });

  it("选到视频模型：同一套说法，不把视频说成图像", () => {
    const message = humanizeUpstreamError("Model agnes-video-2.5 is a video model.");
    expect(message).toContain("视频生成模型");
    expect(message).not.toContain("图像生成模型");
  });

  it("工具清单被网关退回：指出第几个工具、缺什么字段、能去哪查", () => {
    const message = humanizeUpstreamError(
      "Failed to deserialize the JSON body into the target type: tools[9].function: missing field `parameters` at line 1 column 8706"
    );
    expect(message).toContain("第 10 个工具");
    expect(message).toContain("parameters");
    expect(message).toContain("插件");
    // 反向：内部异常的特征串一个都不许留。
    expect(message).not.toContain("Failed to deserialize");
    expect(message).not.toContain("tools[9]");
    expect(message).not.toContain("column 8706");
    expect(message).not.toContain("BadRequestError");
  });

  it("端点不认 high 这一档思考：说清它把最高档叫 xhigh，并指到真有的那个下拉", () => {
    const message = humanizeUpstreamError(
      "Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low."
    );
    expect(message).toContain("high");
    expect(message).toContain("xhigh");
    // 指的那句话必须与设置里那个下拉的标题一致，否则用户找不到地方改。
    expect(message).toContain("深度思考在线上叫什么");
    expect(message).not.toContain("Unexpected reasoning effort");
  });

  it("不认识的一律原样透传（乱猜一句中文比露出原文更糟）", () => {
    expect(humanizeUpstreamError("Bad request: unknown field")).toBe("Bad request: unknown field");
  });

  it("失败句的组装：前半句与状态码原样，正文是那句人话", () => {
    expect(upstreamFailureMessage(400, '{"error":{"message":"Model x is an image model."}}')).toBe(
      "模型服务端返回 400：「x」是图像生成模型，不能用来对话；请在左下角齿轮（设置）里换一个对话模型。"
    );
    expect(upstreamFailureMessage(500, "")).toBe("模型服务端返回 500：无响应体");
    expect(FAILURE_PREFIX).toBe("模型服务端返回");
  });

  it("取出来的那句 message 也受 200 字截断", () => {
    expect(upstreamErrorHint(JSON.stringify({ error: { message: "忙".repeat(250) } }))).toBe(
      `${"忙".repeat(200)}…`
    );
  });

  it("畸形 JSON 不许把整轮搞崩，退回压平截断", () => {
    expect(upstreamErrorHint('{"error":{"message":"x"')).toBe('{"error":{"message":"x"');
  });

  it("压平截断只留 200 字，尾部加省略号", () => {
    expect(upstreamSnippet("a".repeat(250))).toBe(`${"a".repeat(200)}…`);
    expect(upstreamSnippet("  多  空格  ")).toBe("多 空格");
  });
});

describe("渲染层那条通路 · 盘上早就落下来的旧记录也得翻成人话", () => {
  it("旧记录一（工具清单）：翻成同一句中文，原始英文异常一个字都不许留", () => {
    const shown = presentableFailureMessage(OLD_TOOLS_ERROR);
    expect(shown).toContain("工具清单被服务端退了");
    expect(shown).toContain("第 10 个工具");
    expect(shown).toContain("parameters");
    expect(shown).toContain("插件");
    expect(shown).not.toContain("BadRequestError");
    expect(shown).not.toContain("OpenAIException");
    expect(shown).not.toContain("Failed to deserialize");
    expect(shown).not.toContain("tools[9]");
    expect(shown).not.toContain("Invalid JSON data");
    // 前半句（状态码）原样保留：界面与落盘都按它认。
    expect(shown.startsWith("模型服务端返回 400：")).toBe(true);
  });

  it("旧记录二（思考档位叫法不同）：翻成一句能照着做的话", () => {
    const shown = presentableFailureMessage(OLD_THINKING_ERROR);
    expect(shown).toContain("xhigh");
    expect(shown).toContain("深度思考在线上叫什么");
    expect(shown).not.toContain("BadRequestError");
    expect(shown).not.toContain("Unexpected reasoning effort");
    expect(shown.startsWith("模型服务端返回 400：")).toBe(true);
  });

  it("幂等：主进程翻过的那批（含中文）原样不动，不会被翻第二遍", () => {
    const already =
      "模型服务端返回 422：工具清单被服务端退了：清单里第 10 个工具少一个必填字段（parameters）。";
    expect(presentableFailureMessage(already)).toBe(already);
    const chinese = "模型服务端返回 503：上游繁忙，请稍后再试";
    expect(presentableFailureMessage(chinese)).toBe(chinese);
  });

  it("不是失败句的（边界拒绝、连接失败）原样不动", () => {
    expect(presentableFailureMessage("输入内容过长（最多 20000 字）")).toBe(
      "输入内容过长（最多 20000 字）"
    );
    expect(presentableFailureMessage("无法连接模型服务端：fetch failed")).toBe(
      "无法连接模型服务端：fetch failed"
    );
    expect(presentableFailureMessage("")).toBe("");
  });

  it("翻不了的那一类：留上游自己的那句话，不留异常类名与整段 JSON", () => {
    const shown = presentableFailureMessage(
      '模型服务端返回 400：***.BadRequestError: OpenAIException - {"error":{"message":"Bad request: unknown field"}}'
    );
    expect(shown).toBe("模型服务端返回 400：Bad request: unknown field");
    expect(shown).not.toContain("BadRequestError");
    expect(shown).not.toContain("{");
  });

  it("从截断的 JSON 里挖消息：JSON 没闭合也要挖得出那句", () => {
    const body =
      '{"error":{"message":"Invalid JSON data: Failed to deserialize the JSON body into the target type: tools[9].function: missing field `parameters` at line 1 column …"}';
    const message = upstreamMessageOf(body);
    expect(message).toContain("Failed to deserialize");
    expect(message).toContain("tools[9].function");
  });
});

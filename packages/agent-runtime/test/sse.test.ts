import { describe, expect, it } from "vitest";
import { sseDataFrames } from "../src/sse.js";

async function* fromChunks(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

async function collect(bytes: AsyncIterable<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const frame of sseDataFrames(bytes)) out.push(frame);
  return out;
}

const enc = new TextEncoder();

describe("sseDataFrames", () => {
  it("一条消息被切成任意字节片段也要完整拼出", async () => {
    const bytes = fromChunks([enc.encode('data: {"a":'), enc.encode("1}\n\n")]);
    expect(await collect(bytes)).toEqual(['{"a":1}']);
  });

  it("一个 chunk 内含多条消息时按顺序产出", async () => {
    const one = enc.encode('data: {"i":1}\n\ndata: {"i":2}\n\n');
    expect(await collect(fromChunks([one]))).toEqual(['{"i":1}', '{"i":2}']);
  });

  it("CRLF 换行同样识别", async () => {
    expect(await collect(fromChunks([enc.encode("data: x\r\n\r\n")]))).toEqual(["x"]);
  });

  it("中文多字节字符跨 chunk 断开不能出乱码", async () => {
    const whole = enc.encode("data: 雾从海面涌上来\n\n");
    // 断开点落在「海」字三字节序列的内部（首字节之后一个字节）
    const cut = enc.encode("data: 雾从").byteLength + 1;
    expect(await collect(fromChunks([whole.slice(0, cut), whole.slice(cut)]))).toEqual([
      "雾从海面涌上来"
    ]);
  });

  it("多行 data 以换行拼接", async () => {
    expect(await collect(fromChunks([enc.encode("data: 一\ndata: 二\n\n")]))).toEqual(["一\n二"]);
  });

  it("注释与 event/id 字段被忽略，[DONE] 之后不再产出", async () => {
    const bytes = fromChunks([
      enc.encode(": ping\nevent: message\ndata: 一\n\ndata: [DONE]\n\ndata: 二\n\n")
    ]);
    expect(await collect(bytes)).toEqual(["一"]);
  });

  it("流结束时未闭合的尾帧仍然产出", async () => {
    expect(await collect(fromChunks([enc.encode("data: 尾")]))).toEqual(["尾"]);
  });
});

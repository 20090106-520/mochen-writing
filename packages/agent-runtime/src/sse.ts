const BOUNDARIES = ["\r\n\r\n", "\n\n", "\r\r"] as const;

function findBoundary(buffer: string): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null;
  for (const sep of BOUNDARIES) {
    const at = buffer.indexOf(sep);
    if (at >= 0 && (best === null || at < best.index)) best = { index: at, length: sep.length };
  }
  return best;
}

/** 一个帧内只取 data: 字段；其余（event/id/retry/注释）按 SSE 语义忽略。 */
function frameData(frame: string): string | null {
  const parts: string[] = [];
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line === "" || line.startsWith(":") || !line.startsWith("data:")) continue;
    parts.push(line.slice("data:".length).replace(/^ /, ""));
  }
  return parts.length === 0 ? null : parts.join("\n");
}

export async function* sseDataFrames(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for await (const chunk of bytes) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const boundary = findBoundary(buffer);
      if (boundary === null) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const data = frameData(frame);
      if (data === null) continue;
      if (data === "[DONE]") return;
      yield data;
    }
  }
  buffer += decoder.decode();
  const tail = frameData(buffer);
  if (tail !== null && tail !== "[DONE]") yield tail;
}

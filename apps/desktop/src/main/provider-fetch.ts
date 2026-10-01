import type { ProviderFetch, ProviderFetchInput, ProviderFetchResult } from "@mochen/agent-runtime";

function toAsyncIterable(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      const reader = body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return;
          yield chunk.value;
        }
      } finally {
        reader.releaseLock();
      }
    }
  };
}

/**
 * 全局 fetch → ProviderFetch 的适配。请求对象原样交给 send（密钥只在 headers 里，
 * 由 provider-client 拼好），本函数不碰 url、不碰 body、不写任何日志。
 * 网络错误一律原样抛出：streamChat 会按「是否已打断」分别处理（Task 3）。
 */
export function toProviderFetch(
  send: (input: ProviderFetchInput) => Promise<Response>
): ProviderFetch {
  return async (input): Promise<ProviderFetchResult> => {
    const response = await send(input);
    if (!response.ok) {
      return {
        status: response.status,
        stream: null,
        errorText: await response.text().catch(() => "")
      };
    }
    return {
      status: response.status,
      stream: response.body === null ? null : toAsyncIterable(response.body),
      errorText: ""
    };
  };
}

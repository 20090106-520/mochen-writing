import type { ProviderFetch, ProviderFetchInput, ProviderFetchResult } from "@mochen/agent-runtime";
import { ProviderError } from "@mochen/agent-runtime";
import type { WebFetchLike } from "./web-search.js";

/**
 * 上游请求的两个时限（P1-1 的①）——**只许住在这一处**，改数值只改这两个常量，
 * 句子由 `upstreamHangMessage` 从同一个常量生成，界面上说的和真正用的不会是两回事。
 *
 * 为什么是 30 秒（首字节）：这段等的是「连上了但上游一个字都不回」——排队、冷生成、
 * 网关挂起都在这里。正常的 OpenAI 兼容端点要么几秒内给响应头，要么立刻 4xx/5xx；
 * 30 秒已经给到「慢但活着」的余量，再长用户就只是在等一个不会来的答案。
 * 台账 README:6399 量到的是**挂 200 秒零响应零报错**，30 秒足够把那一类判死。
 *
 * 为什么是 60 秒（流式空闲）：这段判的是「两个字节之间静默多久」。深度思考档在真机上有
 * 几十秒不吐字的正常形态，而 SSE 的 keep-alive 注释帧也是字节、会把计时重置，
 * 所以阈值要显著高于思考静默，否则就是误杀。60 秒 = 首字节那一档的两倍：
 * 已经在流了的连接比刚建立的更值得多等一会儿。
 *
 * 为什么**不给整轮设硬总时长**：一章长回答本来就要跑几分钟，硬总时长会把正常的长答案掐掉，
 * 而用户看到的是「说到一半没了」——那比挂起更难解释。空闲判据只掐「没有任何新东西」，
 * 慢而活着的流永不被杀（有一条用例专门钉这件事）。
 */
export const UPSTREAM_FIRST_BYTE_TIMEOUT_MS = 30_000;
export const UPSTREAM_IDLE_TIMEOUT_MS = 60_000;

export type UpstreamHangStage = "first-byte" | "idle";

/**
 * 「上游多久没响应」那句人话（界面与模型读的都是它）。
 *
 * 走的是仓库既有通路：中文句子住在抛它的那一行，上层只剥 IPC 外壳不改写
 * （见渲染层 utils/provider-error.ts 的约定），而 `streamChat` 对 ProviderError 原样透传。
 * 秒/毫秒跟着真实阈值走——测试注入的是几十毫秒，那句话就不许谎称「30 秒」。
 */
export function upstreamHangMessage(ms: number, stage: UpstreamHangStage): string {
  const span = ms >= 1000 ? `${Math.round(ms / 1000)} 秒` : `${ms} 毫秒`;
  return stage === "first-byte"
    ? `模型服务端 ${span}没有给出任何响应，已停止等待。请检查网络，或在设置里换一个模型服务再发一次。`
    : `模型服务端已经 ${span}没有新内容传出，连接像是卡住了，已停止等待。你的文字没有被改动。`;
}

/**
 * 看门狗到点抛的那只错。
 *
 * 它**继承 ProviderError** 而不是普通 Error：provider-client 连接期对所有异常都套一句
 * `无法连接模型服务端：`，套在裸 `fetch failed` 上是对的，套在这句已经是人话的话上就变成
 * 两句叠在一起、还谎称「连不上」（真机情形是连上了、是它不回话）。类型就是让它认出来的记号。
 */
export class UpstreamHangError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamHangError";
  }
}

export interface UpstreamWatchdogOptions {
  /** 首字节（响应头）时限；不传用 `UPSTREAM_FIRST_BYTE_TIMEOUT_MS`。测试注入极小值真等。 */
  firstByteTimeoutMs?: number;
  /** 流式空闲时限（多久没有任何新字节）；不传用 `UPSTREAM_IDLE_TIMEOUT_MS`。 */
  idleTimeoutMs?: number;
}

/**
 * 把若干只 abort 信号并成一只：任何一只 abort，合并这只就跟着 abort。
 *
 * 为什么不直接用 `AbortSignal.any`：那是 Node 20.3+ 才有的静态方法，而这条链上最老的运行时
 * （Electron 打包进用户机器）没有它就要整条链挂掉；手写这只监听器一共十行，
 * 换来的是「合并」这件事在测试与生产是同一份代码，而不是一个有时生效的原语。
 * 只有一只时原样返回——不多包一层，用户自己的打断走的还是他那只 signal。
 */
export function mergeAbortSignals(
  signals: readonly (AbortSignal | undefined | null)[]
): AbortSignal {
  const live = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined && signal !== null
  );
  if (live.length === 0) return new AbortController().signal;
  // 走下面那条循环也能合并一只，但白造一个 controller。
  if (live.length === 1 && live[0] !== undefined) return live[0];
  const merged = new AbortController();
  for (const signal of live) {
    if (signal.aborted) {
      merged.abort(signal.reason);
      return merged.signal;
    }
    signal.addEventListener("abort", () => merged.abort(signal.reason), { once: true });
  }
  return merged.signal;
}

/** 一只可反复上弦的上游看门狗：到点既抛（await 当场有结论）也 abort（连接得放掉）。 */
class HangWatchdog {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 给 `work` 重新上弦并等它。上一根的计时器在这里清掉——所以「空闲」量的是
   * **距离上一个新字节**多久，不是距离请求发出多久（后者就是被否掉的整轮硬总时长）。
   */
  guard<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
    this.disarm();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.timer = null;
        const error = new UpstreamHangError(message);
        // 先 abort 再 reject：abort 让真 fetch 的 socket 与 reader 一起松手，
        // 只 reject 的话那只连接会一直挂着（泄漏的不只是这一次等待）。
        this.controller.abort(error);
        reject(error);
      }, ms);
      this.timer = timer;
      work.then(
        (value) => {
          if (this.timer === timer) this.disarm();
          resolve(value);
        },
        (error: unknown) => {
          if (this.timer === timer) this.disarm();
          reject(error);
        }
      );
    });
  }

  /** 摘弦：正常收尾、异常收尾、消费者提前退出都要走到这里，否则留一根会自己 abort 的计时器。 */
  disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * 带空闲看门狗的「响应体 → AsyncIterable」。
 *
 * 这里**不用假计时器**：用例把阈值注入成几十毫秒真等，量到的是 race 与 abort 这条真链路。
 * 全仓只有这一处把 ReadableStream 转成 AsyncIterable（原先的 `toAsyncIterable` 已并进来），
 * 免得出现「一条有看门狗、一条没有」的两份通路。
 */
function bodyWithIdleWatchdog(
  body: ReadableStream<Uint8Array>,
  watchdog: HangWatchdog,
  idleMs: number
): AsyncIterable<Uint8Array> {
  const message = upstreamHangMessage(idleMs, "idle");
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      const reader = body.getReader();
      try {
        for (;;) {
          const chunk = await watchdog.guard(reader.read(), idleMs, message);
          if (chunk.done) return;
          yield chunk.value;
        }
      } finally {
        watchdog.disarm();
        // 挂住时那只 read 还没落地，releaseLock 会抛 TypeError。这里挡掉是必须的：
        // 不挡的话真正的失败原因（空闲超时那句人话）会被一个 TypeError 盖掉。
        try {
          reader.releaseLock();
        } catch {
          // 这只读还在半途就被 abort：锁随流一起释放，交给下层去报错。
        }
      }
    }
  };
}

/**
 * 「这个上游地址允许出网吗」（2026-10-14 审计项 4）。
 *
 * 密钥与全文都走这一个地址：明文 http 等于把它们裸送给链路上的任何一台设备。
 * 只放行 https；本机回环的 http 除外——ollama / LM Studio 都长在 127.0.0.1 上，
 * 本机流量不出网卡，谈不上「明文外送」。
 *
 * 为什么闸在 provider-fetch（真正出网的那只手）而不是只在保存配置的 schema：
 * 旧配置文件里可能已经躺着一条明文 http 地址（读取 schema 必须保持宽松，
 * 收紧会把整份 store 判成坏文件）——存档读得进来，但请求发不出去，两头都诚实。
 */
export function assertUpstreamUrlAllowed(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderError(`模型服务端地址不是合法 URL：${rawUrl}`);
  }
  if (parsed.protocol === "https:") return;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(parsed.hostname);
  if (parsed.protocol === "http:" && loopback) return;
  throw new ProviderError(
    "模型服务端地址必须是 https://，或本机地址（localhost、127.0.0.1、::1）——" +
      "明文 http 会把 API Key 和全文原样裸送出去。"
  );
}

/**
 * 全局 fetch → ProviderFetch 的适配。请求对象原样交给 send（密钥只在 headers 里，
 * 由 provider-client 拼好），本函数不碰 url、不碰 body、不写任何日志。
 * 网络错误一律原样抛出：streamChat 会按「是否已打断」分别处理（Task 3）。
 *
 * 与旧版的差别只有一件：递给 send 的是「用户的打断 ∪ 看门狗」合并后的那只 signal，
 * 并给首字节与流式各上了一根弦。send 收到的其余字段一个字都没动。
 */
export function toProviderFetch(
  send: (input: ProviderFetchInput) => Promise<Response>,
  options: UpstreamWatchdogOptions = {}
): ProviderFetch {
  const firstByteMs = options.firstByteTimeoutMs ?? UPSTREAM_FIRST_BYTE_TIMEOUT_MS;
  const idleMs = options.idleTimeoutMs ?? UPSTREAM_IDLE_TIMEOUT_MS;
  return async (input): Promise<ProviderFetchResult> => {
    // 出网前的最后一道闸（审计项 4）：解析失败的与明文非本机的地址都在这里死掉。
    assertUpstreamUrlAllowed(input.url);
    const watchdog = new HangWatchdog();
    const signal = mergeAbortSignals([input.signal, watchdog.controller.signal]);
    let response: Response;
    try {
      response = await watchdog.guard(
        send({ ...input, signal }),
        firstByteMs,
        upstreamHangMessage(firstByteMs, "first-byte")
      );
    } catch (error) {
      watchdog.disarm();
      throw error;
    }
    if (!response.ok) {
      let errorText: string;
      try {
        // 错误体也要有看门狗：状态码回来了却读不到体，是同一种「零响应零报错」的挂死。
        errorText = await watchdog.guard(
          response.text(),
          idleMs,
          upstreamHangMessage(idleMs, "idle")
        );
      } catch (error) {
        watchdog.disarm();
        // 空闲超时原样上抛：那句「多久没新内容」比「返回 503：无响应体」更能告诉用户该干什么。
        if (error instanceof UpstreamHangError) throw error;
        // 其余读体失败仍按老行为吞成空串，由上层写「无响应体」——那是状态码已知、只是没解释。
        errorText = "";
      }
      return { status: response.status, stream: null, errorText };
    }
    return {
      status: response.status,
      stream: response.body === null ? null : bodyWithIdleWatchdog(response.body, watchdog, idleMs),
      errorText: ""
    };
  };
}

/**
 * 把「这一轮的打断」并进联网搜索真正出网那次 fetch 的 signal（P1-1 的②）。
 *
 * 为什么在 fetch 这一侧合而不是改 web-search.ts：`webSearch` 的每个源都在 `timedFetch` 里
 * 用 `AbortSignal.timeout(6000)` **覆写** init.signal，从上游递进来的信号会被丢掉；
 * 而那只 6 秒的有界超时是 5-⑨ 量出来防挂死的，不许拿掉。所以在最外面这一层把两只并成一只：
 * 单源 6 秒有界照旧成立，用户按打断时当场停下（三源串行 × 最多四轮，否则要等到天黑）。
 *
 * 不用全局状态读「有没有打断」：signal 是**这一轮**自己那只（agent-service 的
 * AbortController），换一轮就是另一只，与每轮开关同一口径。
 */
export function abortableFetch(send: WebFetchLike, signal: AbortSignal): WebFetchLike {
  return (url, init) => send(url, { ...init, signal: mergeAbortSignals([init?.signal, signal]) });
}

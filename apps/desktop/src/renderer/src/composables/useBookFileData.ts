import { ref, watch, type Ref } from "vue";
import type { BookDataKey, BookDataReadResult, BookDataWriteResult } from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import { registerBookDataFlusher } from "./bookDataRegistry";

/**
 * 设定数据的落盘通路（2026-10-09 扫描总单 P0-7）。
 *
 * 笔记 / 故事圣经 / 写作目标原先各抄一份「`localStorage.setItem` + `catch {}`」，
 * 于是有两个洞：① 键不带书标识，两本书共用一份设定；② 写失败静默，屏上永远像存好了一样。
 * 这一枚把两件事一次收掉：内容落进**当前这本书**的 `.mochen/data/`，失败留下一句人话。
 *
 * 三个不显然的口径，都是这条通路存在的理由：
 * - **读不懂 ≠ 没有**（`canWrite` 那道闸）：主进程回 `unreadable` 时把 data 当空库接着用，
 *   用户随手一改就用空数据盖掉了读不懂的那一份——那是二次丢数据，比第一次严重；
 * - **迁移成功才清旧键**：先清后写，中间断电或写失败就两头落空；
 * - **快照相同就不写**：读回来那一次赋值会惊动 deep watcher，没有这道闸每次开书都白写一遍，
 *   顺带把连改三次合成一次落盘。
 */

export interface BookFileDataOptions<T> {
  /** 白名单里的键：路径由主进程按这张表拼，渲染层拿不到路径。 */
  readonly key: BookDataKey;
  /** 迁移来源：旧的全局 localStorage 键名（不带书标识那一份）。 */
  readonly legacyStorageKey: string;
  /** 内容住在调用方那个 ref 里：store 的视图与 computed 继续读它，通路只负责搬。 */
  readonly data: Ref<T>;
  /** 盘上没有、旧键也没有时的起点。 */
  empty: () => T;
  /** 形状校验：认不得就返回 null，按「读不懂」处理（绝不将错就错当空库）。 */
  normalize: (parsed: unknown) => T | null;
  /** 这份值算不算「空的，没东西可迁」。默认：空数组算空，其余都算有内容。 */
  isEmpty?: (value: T) => boolean;
  /** 连改合并窗口。默认 600ms：写设定不是打字，不需要更勤。 */
  debounceMs?: number;
}

export interface BookFileDataHandle<T> {
  readonly data: Ref<T>;
  /** 上一次落盘/读取的失败原因；空串＝一切正常。面板拿它显示提示。 */
  readonly saveError: Ref<string>;
  /** 立刻落盘（换书与退出兜底走这条），返回是不是真的落到盘上了。 */
  flush: () => Promise<boolean>;
}

/** 只取通路用得上的那两枚方法，且容忍 `window` 根本不存在（node 用例、预加载未注入）。 */
type BookDataApi = {
  readBookData?: (key: BookDataKey) => Promise<BookDataReadResult>;
  writeBookData?: (key: BookDataKey, json: string) => Promise<BookDataWriteResult>;
};

function bookDataApi(): BookDataApi | null {
  const holder = (globalThis as { window?: { mochen?: BookDataApi } }).window;
  return holder?.mochen ?? null;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_DEBOUNCE_MS = 600;

/** `JSON.stringify` 对 Vue 的响应式代理是安全的（它会顺着 getter 取值）。 */
function snapshotOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // 循环引用之类的东西进不了 IPC，也进不了盘：返回空串由调用方拒写。
    return "";
  }
}

type LegacyRead<T> = { state: "none" } | { state: "bad" } | { state: "ok"; value: T };

export function useBookFileData<T>(options: BookFileDataOptions<T>): BookFileDataHandle<T> {
  const book = useBookStore();
  const saveError = ref("");
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const isEmpty =
    options.isEmpty ?? ((value: T) => (Array.isArray(value) ? value.length === 0 : false));

  /** 当前这份 data 属于哪本书；null 表示压根没开书，于是不读也不写。 */
  let loadedRoot: string | null = null;
  /** 只有「明确读过盘（或明确判定这本书没有这类数据）」才允许往盘上写。 */
  let canWrite = false;
  /** 换书代号：在途的读回来时若已换过书，结果直接作废。 */
  let epoch = 0;
  /** 最后一次落盘（或读回）的序列化快照：相同就不写。 */
  let lastSnapshot = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 写盘串行链：同一枚键的两个并发写会互相盖，谁后落地没人知道。 */
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue(work: () => Promise<boolean>): Promise<boolean> {
    const run = chain.then(work, work);
    chain = run.catch(() => false);
    return run;
  }

  function apply(value: T): void {
    options.data.value = value;
    lastSnapshot = snapshotOf(value);
  }

  function readLegacy(): LegacyRead<T> {
    if (typeof localStorage === "undefined") return { state: "none" };
    const raw = localStorage.getItem(options.legacyStorageKey);
    if (raw === null || raw === "") return { state: "none" };
    try {
      const normalized = options.normalize(JSON.parse(raw));
      return normalized === null ? { state: "bad" } : { state: "ok", value: normalized };
    } catch {
      return { state: "bad" };
    }
  }

  function clearLegacy(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(options.legacyStorageKey);
  }

  async function writeNow(mode: "save" | "migrate"): Promise<boolean> {
    if (loadedRoot === null || !canWrite) return false;
    const json = snapshotOf(options.data.value);
    if (json === "") {
      saveError.value = "这份设定序列化不出来，已停止写入（内容只在内存里）。";
      return false;
    }
    // 没变过就不写：读回来那一次赋值不算改动。迁移那一路例外，盘上此刻还没有文件。
    if (mode === "save" && json === lastSnapshot) return true;
    const api = bookDataApi();
    if (api?.writeBookData === undefined) {
      saveError.value = "这台环境没有设定落盘通路，改动只在内存里。";
      return false;
    }
    let result: BookDataWriteResult;
    try {
      result = await api.writeBookData(options.key, json);
    } catch (error) {
      saveError.value = `没能存进这本书：${reasonOf(error)}`;
      return false;
    }
    if (!result.ok) {
      saveError.value = `没能存进这本书：${result.message}`;
      return false;
    }
    lastSnapshot = json;
    saveError.value = "";
    return true;
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void enqueue(() => writeNow("save"));
    }, debounceMs);
  }

  async function flush(): Promise<boolean> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    return await enqueue(() => writeNow("save"));
  }

  async function loadFor(root: string | null): Promise<void> {
    const mine = ++epoch;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    loadedRoot = root;
    canWrite = false;
    saveError.value = "";
    if (root === null) {
      // 没开书：一条 IPC 都不发。尤其不许把 localStorage 那一份当成"当前这本书的"迁出去——
      // 迁给谁？下一本开起来的书会凭空长出上一本的设定，这正是这一波的病名。
      apply(options.empty());
      return;
    }
    const api = bookDataApi();
    if (api?.readBookData === undefined) {
      apply(options.empty());
      saveError.value = "这台环境没有设定落盘通路，改动只在内存里。";
      return;
    }
    let got: BookDataReadResult;
    try {
      got = await api.readBookData(options.key);
    } catch (error) {
      if (mine !== epoch) return;
      apply(options.empty());
      saveError.value = `读不回这本书的设定：${reasonOf(error)}`;
      return;
    }
    if (mine !== epoch) return;
    if (!got.ok) {
      apply(options.empty());
      // 三档各有各的话，共同点是都不开写的闸：读不懂时最坏的选择就是继续写。
      saveError.value =
        got.reason === "no-book"
          ? "还没打开作品目录，设定没地方落。"
          : got.reason === "invalid-key"
            ? `内部错误：${got.reason} 不在设定白名单里。`
            : `读不回这本书的设定：${got.message}。已停止写入，以免盖掉原来那份。`;
      return;
    }
    if (got.json !== null) {
      let normalized: T | null;
      try {
        normalized = options.normalize(JSON.parse(got.json));
      } catch {
        normalized = null;
      }
      if (normalized === null) {
        apply(options.empty());
        saveError.value = "这本书的设定文件读不懂，已停止写入，以免盖掉原来那份。";
        return;
      }
      canWrite = true;
      apply(normalized);
      return;
    }
    // 盘上确实没有：这本书还没写过这类数据——这是唯一允许"迁"的入口。
    canWrite = true;
    const legacy = readLegacy();
    if (legacy.state !== "ok") {
      apply(options.empty());
      // 旧键是坏 JSON 就当没有：不迁、不写，也不报成落盘失败（那是上一辈子的存档，不是这本书的）。
      return;
    }
    apply(legacy.value);
    if (isEmpty(legacy.value)) {
      // 空的没有可迁，但旧键该清掉——否则每个新书都会来看它一眼。
      clearLegacy();
      return;
    }
    const wrote = await enqueue(() => writeNow("migrate"));
    if (mine !== epoch) return;
    // 只有真的落到这本书的盘上了才清旧键；写失败留着它，用户还有唯一那一份。
    if (wrote) clearLegacy();
  }

  watch(
    () => book.rootPath,
    (next) => void loadFor(next),
    { immediate: true }
  );

  watch(
    options.data,
    () => {
      if (!canWrite) return;
      if (snapshotOf(options.data.value) === lastSnapshot) return;
      schedule();
    },
    { deep: true }
  );

  registerBookDataFlusher(options.key, flush);

  return { data: options.data, saveError, flush };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  parseVolumeOutline,
  type DocContent,
  type DocCreateResult,
  type DocRef,
  type DocWriteResult
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";
import { useVolumeOutlineStore } from "./useVolumeOutlineStore";

/**
 * `useVolumeOutlineStore` 的行为单测。
 *
 * **为什么这些能写单测而 `.vue` 不能**：store 是 `.ts`，进类型程序也进 vitest；
 * `.vue` 那边只有源码契约测试（`volume-outline-wiring.test.ts`），钉的是「接没接上」。
 *
 * **为什么非得补这一份**（2026-10-06 变异实测）：接线测试声称覆盖了三条行为，
 * 实测三条全是空转——把它说的东西逐个改坏，接线测试照样全绿：
 *   ① `toggleFor` 不判「同一篇」⇒ 点第二下变成重新读盘，浮层关不掉；
 *   ② `generateChapter` 的失败路静默 ⇒ 作者以为已经生成了；
 *   ③ loose 节照常给生成按钮（这一条已改成按标签取属性块钉在接线测试里，行为侧在这里钉）。
 * 守卫声称覆盖却没覆盖，比没有守卫更坏：它会让人以为这块有人看着。
 */

/** 一段真能拆出两章的卷纲：夹具走真解析，不手搓 ParsedChapter（手搓会与解析器的口径漂移）。 */
const VOLUME_MD = [
  "# 第一卷 潮信",
  "",
  "## 第一章 退潮",
  "- 视角：林砚",
  "- 目标：把船开出去",
  "- 字数：3200",
  "",
  "## 第二章 夜航",
  "- 视角：林砚"
].join("\n");

function docRef(over: Partial<DocRef> & Pick<DocRef, "relPath" | "title" | "kind">): DocRef {
  return { chars: 100, excerpt: "", ...over };
}

interface Bridge {
  readDoc: ReturnType<typeof vi.fn>;
  createDoc: ReturnType<typeof vi.fn>;
  writeDoc: ReturnType<typeof vi.fn>;
}

function makeBridge(over: Partial<Bridge> = {}): Bridge {
  return {
    // readDoc 形参要用：store 拿回的是「盘上那篇的正文」，按 relPath 回什么就该是什么。
    readDoc:
      over.readDoc ??
      vi.fn((relPath: string): Promise<DocContent> =>
        Promise.resolve({ relPath, content: VOLUME_MD, fingerprint: "fp-1" })
      ),
    // createDoc / writeDoc 的成功返回值与请求参数无关，用 mockResolvedValue，
    // 免得为了凑类型而声明一堆用不到的形参（eslint 的 no-unused-vars 会拦）。
    createDoc:
      over.createDoc ??
      vi.fn().mockResolvedValue({ ok: true, relPath: "outline/x.md", fingerprint: "fp-new" }),
    writeDoc:
      over.writeDoc ??
      vi.fn().mockResolvedValue({ ok: true, fingerprint: "fp-new", backupRelPath: null })
  };
}

function stubWindow(bridge: Bridge): void {
  vi.stubGlobal("window", { mochen: bridge });
}

function firstChapter(): ReturnType<typeof parseVolumeOutline>["chapters"][number] {
  const parsed = parseVolumeOutline(VOLUME_MD);
  const first = parsed.chapters[0];
  if (first === undefined) throw new Error("夹具自己拆不出章，说明 parseVolumeOutline 变了");
  return first;
}

/**
 * 起不了文件名的标题：非法字符是**替换成 `-`**而不是拒绝（`一/二章` 反而是合法的），
 * 所以只有清洗完变空串的那种才返回 null——纯空白就是。
 */
function unusableTitle(): ReturnType<typeof parseVolumeOutline>["chapters"][number] {
  return { ...firstChapter(), title: "   " };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("toggleFor：同一篇是「关」，换一篇才是「重读」", () => {
  it("开着同一篇时再点一次是关掉，**且不重读盘**", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const store = useVolumeOutlineStore();
    const doc = docRef({ relPath: "卷一.md", title: "卷一", kind: "volume" });

    await store.toggleFor(doc);
    expect(store.open).toBe(true);
    expect(bridge.readDoc).toHaveBeenCalledTimes(1);

    await store.toggleFor(doc);
    // 关掉的同时，解析结果要留着——再点回来不必重读盘。
    expect(store.open).toBe(false);
    expect(store.outline).not.toBeNull();
    expect(bridge.readDoc).toHaveBeenCalledTimes(1);
  });

  it("换一篇打开的才重读（两个不同操作，不合并成一个刷新）", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const store = useVolumeOutlineStore();

    await store.toggleFor(docRef({ relPath: "卷一.md", title: "卷一", kind: "volume" }));
    await store.toggleFor(docRef({ relPath: "卷二.md", title: "卷二", kind: "volume" }));

    expect(store.open).toBe(true);
    expect(store.sourceRelPath).toBe("卷二.md");
    expect(bridge.readDoc).toHaveBeenCalledTimes(2);
  });

  it("没打开任何文稿时点它：不读盘也不开浮层", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const store = useVolumeOutlineStore();
    await store.toggleFor(null);
    expect(store.open).toBe(false);
    expect(bridge.readDoc).not.toHaveBeenCalled();
  });

  it("读盘失败：说清是读不回来，busy 收干净，**不许看起来像「跑过了，没有章」**", async () => {
    const bridge = makeBridge({
      readDoc: vi.fn(async () => {
        throw new Error("盘上那篇不见了");
      })
    });
    stubWindow(bridge);
    const store = useVolumeOutlineStore();
    await store.toggleFor(docRef({ relPath: "卷一.md", title: "卷一", kind: "volume" }));

    expect(store.outline).toBeNull();
    expect(store.notice).toContain("卷纲没读回来");
    expect(store.notice).toContain("盘上那篇不见了");
    expect(store.busy).toBe(false);
  });
});

describe("generateChapter：每条失败路都要说人话，不许静默", () => {
  it("标题起不了文件名：当场回一句中文，**且不碰盘**", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const store = useVolumeOutlineStore();

    const result = await store.generateChapter(unusableTitle());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("起不了文件名");
    expect(bridge.createDoc).not.toHaveBeenCalled();
    expect(bridge.writeDoc).not.toHaveBeenCalled();
  });

  it("已有同名大纲：先挡一层，不把主进程那句 invalid-path 原样透给用户", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const book = useBookStore();
    const chapter = firstChapter();
    book.docs = [
      docRef({ relPath: "outline/第一章 退潮.md", title: "第一章 退潮", kind: "outline" })
    ];
    const store = useVolumeOutlineStore();

    const result = await store.generateChapter(chapter);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("已经有一篇");
    expect(result.message).not.toContain("invalid-path");
    expect(bridge.createDoc).not.toHaveBeenCalled();
  });

  it("建文件这一步失败：把主进程那句带出来", async () => {
    const bridge = makeBridge({
      createDoc: vi.fn(async (): Promise<DocCreateResult> => ({
        ok: false,
        reason: "already-exists",
        message: "同名文件已经在盘上了"
      }))
    });
    stubWindow(bridge);
    const store = useVolumeOutlineStore();

    const result = await store.generateChapter(firstChapter());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("同名文件已经在盘上了");
    expect(store.generating).toEqual([]);
  });

  it("写正文撞上 stale：说「别覆盖」，**不许调 written.message**（那一支没有它）", async () => {
    const bridge = makeBridge({
      writeDoc: vi.fn(async (): Promise<DocWriteResult> => ({
        ok: false,
        reason: "stale",
        currentFingerprint: "fp-别人改过的"
      }))
    });
    stubWindow(bridge);
    const store = useVolumeOutlineStore();

    const result = await store.generateChapter(firstChapter());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("别覆盖");
    expect(result.message).not.toContain("undefined");
  });

  it("写正文其它失败：带上原因", async () => {
    const bridge = makeBridge({
      writeDoc: vi.fn(async (): Promise<DocWriteResult> => ({
        ok: false,
        reason: "io-error",
        message: "磁盘只读"
      }))
    });
    stubWindow(bridge);
    const store = useVolumeOutlineStore();

    const result = await store.generateChapter(firstChapter());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("磁盘只读");
  });

  it("整个过程抛异常：也要说人话，且 generating 收干净（不能卡住按钮）", async () => {
    const bridge = makeBridge({
      createDoc: vi.fn(async () => {
        throw new Error("主进程没起来");
      })
    });
    stubWindow(bridge);
    const store = useVolumeOutlineStore();

    const result = await store.generateChapter(firstChapter());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("没生成");
    expect(result.message).toContain("主进程没起来");
    expect(store.generating).toEqual([]);
  });
});

describe("generateChapter：成功那一路", () => {
  it("建 → 写 → **重扫**，写回的是解析器读得出、拼装器认得的同一份形状", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const book = useBookStore();
    const refresh = vi.spyOn(book, "refreshDocs").mockResolvedValue(undefined);
    const store = useVolumeOutlineStore();
    const chapter = firstChapter();

    const result = await store.generateChapter(chapter);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("已生成");
    // 写进去的正文标题行必须是 `##`，`:created.fingerprint` 必须原样传给 writeDoc。
    const [, content, fingerprint] = bridge.writeDoc.mock.calls[0] ?? [];
    expect(String(content)).toContain("## ");
    expect(fingerprint).toBe("fp-new");
    // 生成完必须重扫：否则面板上「已有同名大纲」要等下次开书才变，作者会连点两次。
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.generating).toEqual([]);
  });

  it("在途标记真的在飞（面板据此禁用，不许重复点建出两篇同名）", async () => {
    const bridge = makeBridge();
    stubWindow(bridge);
    const book = useBookStore();
    vi.spyOn(book, "refreshDocs").mockResolvedValue(undefined);
    const store = useVolumeOutlineStore();
    const chapter = firstChapter();

    const flight = store.generateChapter(chapter);
    expect(store.generating).toEqual([chapter.order]);
    await flight;
    expect(store.generating).toEqual([]);
  });
});

describe("诚实边界那一支", () => {
  it("loose 判定来自解析结果，store 不自己另判一份（铁律 6）", async () => {
    // 一个字段都没写的节标成 loose；store 的 looseCount 只是数它，不重写规则。
    const parsed = parseVolumeOutline(
      ["## 分卷说明", "", "## 第二章 夜航", "- 视角：林砚"].join("\n")
    );
    const loose = parsed.chapters.find((c) => c.title === "分卷说明");
    expect(loose?.isLoose).toBe(true);

    const bridge = makeBridge({
      readDoc: vi.fn(async (relPath: string): Promise<DocContent> => ({
        relPath,
        content: ["## 分卷说明", "", "## 第二章 夜航", "- 视角：林砚"].join("\n"),
        fingerprint: "fp-1"
      }))
    });
    stubWindow(bridge);
    const store = useVolumeOutlineStore();
    await store.toggleFor(docRef({ relPath: "卷一.md", title: "卷一", kind: "volume" }));

    expect(store.looseCount).toBe(1);
    expect(store.verdict).toContain("1 节没写字段");
  });
});
